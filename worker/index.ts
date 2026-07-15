// Cloudflare Worker for online play. Serves the static build for every path
// except the WebSocket endpoints: /ws (random 1v1 matchmaking, single global
// JankenLobby) and /ws/room/:id (a named JankenRoom Durable Object per room,
// for the N-player "みんなで対戦" mode).

import { v7 as uuidV7 } from "uuid";
import {
  buildUuidV4Pair,
  coinFlipUuidV7Pair,
  type ClientMessage,
  type ServerMessage,
  type UuidVersion,
} from "../src/protocol";
import {
  ROOM_COLORS,
  type RoomClientMessage,
  type RoomRosterPlayer,
  type RoomServerMessage,
} from "../src/room-protocol";

export interface Env {
  ASSETS: Fetcher;
  LOBBY: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
}

const ROOM_WS_PATH = /^\/ws\/room\/([^/]+)$/;

export default {
  fetch(request, env): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      // One lobby for everyone — a single Durable Object instance is plenty
      // for this game's scale and makes matchmaking trivial.
      return env.LOBBY.get(env.LOBBY.idFromName("lobby")).fetch(request);
    }
    const roomMatch = ROOM_WS_PATH.exec(url.pathname);
    if (roomMatch) {
      // One Durable Object per room id (from the shareable /room/:id URL).
      const roomId = decodeURIComponent(roomMatch[1]);
      return env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// A v7 round times out (falls back to coinFlipUuidV7Pair) if the opponent's
// go_ack never arrives — e.g. a dropped connection with no close event yet.
// Real round trips settle in well under a second; this only needs to be
// generous enough to not misfire on ordinary network latency (race.ts's
// same-machine equivalent, ROUND_TIMEOUT_MS, can be far stricter at 1000ms
// since there's no network in between).
const ROUND_TIMEOUT_MS = 4000;

// Per-socket state, persisted via (de)serializeAttachment so it survives
// hibernation. "waiting" sockets sit in the matchmaking queue, tagged with
// the version they want to play — enqueue() only ever pairs two sockets with
// the same tag, so two players can never be matched wanting different
// versions in the first place. "alone" means the opponent left mid-room —
// the client must explicitly send "requeue" so a fresh match can never barge
// in while its reveal animation is still playing. "racing" is a v7 round in
// flight: both sides were sent "go" at goSentAt, and firstUuid gets filled in
// the instant one side's go_ack arrives (see webSocketMessage's "go_ack"
// handling).
type Attachment =
  | { state: "waiting"; version: UuidVersion }
  | { state: "alone" }
  | { state: "paired"; roomId: string; readyVersion?: UuidVersion }
  | { state: "racing"; roomId: string; goSentAt: number; firstUuid?: string };

const getAttachment = (ws: WebSocket): Attachment | null =>
  ws.deserializeAttachment() as Attachment | null;
const setAttachment = (ws: WebSocket, att: Attachment): void => {
  ws.serializeAttachment(att);
};

export class JankenLobby {
  ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    // Keepalive pings from clients are answered without waking the DO.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    // No auto-enqueue here — the client sends its own "requeue" (carrying
    // its chosen version) right after connecting, so even the very first
    // queue entry is already version-tagged.
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    const att = getAttachment(ws);

    if (msg.type === "requeue") {
      // Allowed with no prior state at all (att === null, the very first
      // message after connecting) or once actually unpaired — ignored
      // mid-round (paired/racing), which would abandon a round in progress.
      if (att === null || att.state === "waiting" || att.state === "alone") {
        this.enqueue(ws, msg.version);
      }
      return;
    }

    if (!att) return; // anything else needs prior state

    if (msg.type === "ready" && att.state === "paired") {
      this.handleReady(ws, att, msg.version);
      return;
    }

    if (msg.type === "go_ack" && att.state === "racing") {
      this.handleGoAck(ws, att);
    }
  }

  handleReady(
    ws: WebSocket,
    att: Extract<Attachment, { state: "paired" }>,
    chosenVersion: UuidVersion,
  ): void {
    const partner = this.partnerOf(ws, att.roomId);
    if (!partner) {
      // Opponent vanished without a close event reaching us.
      setAttachment(ws, { state: "alone" });
      this.send(ws, { type: "opponent_left" });
      return;
    }
    const partnerAtt = getAttachment(partner);
    if (partnerAtt?.state !== "paired" || !partnerAtt.readyVersion) {
      // First to ready: record the version choice and wait for the partner.
      setAttachment(ws, { state: "paired", roomId: att.roomId, readyVersion: chosenVersion });
      this.send(partner, { type: "opponent_ready" });
      return;
    }

    // Both ready. Matchmaking only ever pairs same-version players (see
    // enqueue()) and the client locks its version toggle once matched, so
    // chosenVersion and partnerAtt.readyVersion are guaranteed equal here.
    const version = partnerAtt.readyVersion;
    if (version === "v4") {
      const [mine, theirs] = buildUuidV4Pair();
      this.send(ws, { type: "start", version, uuid: mine, opponentUuid: theirs });
      this.send(partner, { type: "start", version, uuid: theirs, opponentUuid: mine });
      setAttachment(ws, { state: "paired", roomId: att.roomId });
      setAttachment(partner, { state: "paired", roomId: att.roomId });
      return;
    }

    // v7: decide the winner with a real race, the same way the local
    // same-device implementation (race.ts) does — release both sides from a
    // synchronized "go" and let whichever "go_ack" reaches this Durable
    // Object first (genuine network/client timing, not an RNG) receive the
    // earlier, lower-sorting UUID. See handleGoAck.
    const goSentAt = Date.now();
    setAttachment(ws, { state: "racing", roomId: att.roomId, goSentAt });
    setAttachment(partner, { state: "racing", roomId: att.roomId, goSentAt });
    this.send(ws, { type: "go" });
    this.send(partner, { type: "go" });
    void this.scheduleTimeoutAlarm(goSentAt + ROUND_TIMEOUT_MS);
  }

  handleGoAck(ws: WebSocket, att: Extract<Attachment, { state: "racing" }>): void {
    if (att.firstUuid !== undefined) return; // duplicate ack, ignore

    const partner = this.partnerOf(ws, att.roomId);
    if (!partner) {
      setAttachment(ws, { state: "alone" });
      this.send(ws, { type: "opponent_left" });
      return;
    }
    const partnerAtt = getAttachment(partner);
    if (partnerAtt?.state !== "racing") return; // stale ack — round already resolved

    if (partnerAtt.firstUuid === undefined) {
      // First ack to arrive: issuing the UUID now guarantees it sorts lower
      // (and loses) once the partner's is issued after it, below.
      setAttachment(ws, { ...att, firstUuid: uuidV7() });
      return;
    }

    // Second ack: this UUID is issued strictly after the partner's, so the
    // uuid package's monotonic v7 state guarantees it sorts higher (wins).
    const winnerUuid = uuidV7();
    const loserUuid = partnerAtt.firstUuid;
    this.send(ws, { type: "start", version: "v7", uuid: winnerUuid, opponentUuid: loserUuid });
    this.send(partner, { type: "start", version: "v7", uuid: loserUuid, opponentUuid: winnerUuid });
    setAttachment(ws, { state: "paired", roomId: att.roomId });
    setAttachment(partner, { state: "paired", roomId: att.roomId });
  }

  // Only one alarm can be scheduled per Durable Object, so it's always set to
  // the earliest deadline among all in-flight rounds; alarm() re-schedules
  // for whatever's next after resolving anything due.
  async scheduleTimeoutAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) {
      await this.ctx.storage.setAlarm(at);
    }
  }

  // Alarms (unlike plain setTimeout) survive hibernation, so a round can
  // never hang forever even if the Durable Object was evicted from memory
  // mid-round — this is the same safety net as race.ts's ROUND_TIMEOUT_MS.
  async alarm(): Promise<void> {
    const now = Date.now();
    let nextDeadline: number | null = null;

    for (const ws of this.ctx.getWebSockets()) {
      const att = getAttachment(ws);
      if (att?.state !== "racing") continue;

      if (att.goSentAt + ROUND_TIMEOUT_MS > now) {
        nextDeadline =
          nextDeadline === null
            ? att.goSentAt + ROUND_TIMEOUT_MS
            : Math.min(nextDeadline, att.goSentAt + ROUND_TIMEOUT_MS);
        continue;
      }

      const partner = this.partnerOf(ws, att.roomId);
      const [uuid, opponentUuid] = coinFlipUuidV7Pair();
      this.send(ws, { type: "start", version: "v7", uuid, opponentUuid });
      setAttachment(ws, { state: "paired", roomId: att.roomId });
      if (partner) {
        this.send(partner, {
          type: "start",
          version: "v7",
          uuid: opponentUuid,
          opponentUuid: uuid,
        });
        setAttachment(partner, { state: "paired", roomId: att.roomId });
      }
    }

    if (nextDeadline !== null) await this.ctx.storage.setAlarm(nextDeadline);
  }

  webSocketClose(ws: WebSocket): void {
    this.handleLeave(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.handleLeave(ws);
  }

  handleLeave(ws: WebSocket): void {
    const att = getAttachment(ws);
    if (att?.state !== "paired" && att?.state !== "racing") return;
    const partner = this.partnerOf(ws, att.roomId);
    if (partner) {
      setAttachment(partner, { state: "alone" });
      this.send(partner, { type: "opponent_left" });
    }
  }

  enqueue(ws: WebSocket, version: UuidVersion): void {
    setAttachment(ws, { state: "waiting", version });
    this.send(ws, { type: "waiting" });
    // Only ever pairs sockets wanting the same version — see the Attachment
    // type comment. Different-version waiters simply keep waiting until a
    // like-minded opponent (or a version toggle) comes along.
    const other = this.ctx.getWebSockets().find((o) => {
      if (o === ws) return false;
      const oAtt = getAttachment(o);
      return oAtt?.state === "waiting" && oAtt.version === version;
    });
    if (!other) return;
    const roomId = crypto.randomUUID();
    setAttachment(ws, { state: "paired", roomId });
    setAttachment(other, { state: "paired", roomId });
    this.send(ws, { type: "matched" });
    this.send(other, { type: "matched" });
  }

  partnerOf(ws: WebSocket, roomId: string): WebSocket | undefined {
    return this.ctx.getWebSockets().find((o) => {
      if (o === ws) return false;
      const att = getAttachment(o);
      return (att?.state === "paired" || att?.state === "racing") && att.roomId === roomId;
    });
  }

  send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; its close handler tidies up.
    }
  }
}

// Per-socket state for a room member, persisted via (de)serializeAttachment so
// it survives hibernation. `num` is a stable join number (max existing + 1, so
// it's never reused while the room lives) surfaced as "プレイヤー{num}"; `ready`
// arms the member for the next round.
interface RoomAttachment {
  playerId: string;
  num: number;
  color: string;
  ready: boolean;
}

const getRoomAttachment = (ws: WebSocket): RoomAttachment | null =>
  ws.deserializeAttachment() as RoomAttachment | null;
const setRoomAttachment = (ws: WebSocket, att: RoomAttachment): void => {
  ws.serializeAttachment(att);
};

// One Durable Object per room id. Members join by opening /ws/room/:id; the room
// starts a round the instant every connected member is ready and at least two
// are present, deals one v4 UUID per member, and the clients rank them locally
// (largest wins — see rankByUuid). Between rounds "ready" arms again.
export class JankenRoom {
  ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Assign a stable join number and a distinct colour based on who's already
    // here (computed before accepting so the new socket isn't counted yet).
    const existing = this.members();
    const num = existing.reduce((max, ws) => Math.max(max, getRoomAttachment(ws)!.num), 0) + 1;
    const usedColors = new Set(existing.map((ws) => getRoomAttachment(ws)!.color));
    const color =
      ROOM_COLORS.find((c) => !usedColors.has(c)) ?? ROOM_COLORS[(num - 1) % ROOM_COLORS.length];

    this.ctx.acceptWebSocket(server);
    setRoomAttachment(server, { playerId: crypto.randomUUID(), num, color, ready: false });
    this.broadcastRoster();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message !== "string") return;
    let msg: RoomClientMessage;
    try {
      msg = JSON.parse(message) as RoomClientMessage;
    } catch {
      return;
    }
    const att = getRoomAttachment(ws);
    if (!att) return;

    if (msg.type === "ready" && !att.ready) {
      setRoomAttachment(ws, { ...att, ready: true });
      // If this readies the whole room, start immediately without a stale
      // roster flash; otherwise let everyone see the updated ready state.
      if (!this.maybeStartRound()) this.broadcastRoster();
      return;
    }

    if (msg.type === "cancel" && att.ready) {
      setRoomAttachment(ws, { ...att, ready: false });
      this.broadcastRoster();
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.handleGone(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.handleGone(ws);
  }

  // A member left: re-broadcast the roster, and — since their departure may
  // have left everyone else already ready — check whether the round can start.
  handleGone(ws: WebSocket): void {
    if (!getRoomAttachment(ws)) return;
    if (!this.maybeStartRound(ws)) this.broadcastRoster();
  }

  // Starts a round iff at least two members are present and all are ready.
  // Returns whether a round was started. `leaving` is a socket that's on its
  // way out (a close in flight) and must be excluded from the round.
  maybeStartRound(leaving?: WebSocket): boolean {
    const members = this.members().filter((ws) => ws !== leaving);
    if (members.length < 2) return false;
    if (!members.every((ws) => getRoomAttachment(ws)!.ready)) return false;

    const players = members.map((ws) => ({ ws, id: getRoomAttachment(ws)!.playerId }));
    const dealt = players.map((p) => ({ id: p.id, uuid: crypto.randomUUID() }));
    const start: RoomServerMessage = { type: "start", players: dealt };
    for (const p of players) {
      this.send(p.ws, start);
      // Disarm for the next round; clients re-arm via "ready" after the result.
      const att = getRoomAttachment(p.ws)!;
      setRoomAttachment(p.ws, { ...att, ready: false });
    }
    return true;
  }

  broadcastRoster(): void {
    const members = this.members();
    const players: RoomRosterPlayer[] = members.map((ws) => {
      const a = getRoomAttachment(ws)!;
      return { id: a.playerId, num: a.num, color: a.color, ready: a.ready };
    });
    for (const ws of members) {
      const a = getRoomAttachment(ws)!;
      this.send(ws, { type: "roster", youId: a.playerId, players });
    }
  }

  members(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => getRoomAttachment(ws) !== null);
  }

  send(ws: WebSocket, msg: RoomServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; its close handler tidies up.
    }
  }
}
