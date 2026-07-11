// Cloudflare Worker for online play. Serves the static build for every path
// except /ws, which upgrades to a WebSocket handled by a single global
// JankenLobby Durable Object that pairs random opponents and referees rounds.

import {
  buildUuidPair,
  type ClientMessage,
  type ServerMessage,
  type UuidVersion,
} from "../src/protocol";

export interface Env {
  ASSETS: Fetcher;
  LOBBY: DurableObjectNamespace;
}

export default {
  fetch(request, env): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      // One lobby for everyone — a single Durable Object instance is plenty
      // for this game's scale and makes matchmaking trivial.
      return env.LOBBY.get(env.LOBBY.idFromName("lobby")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Per-socket state, persisted via (de)serializeAttachment so it survives
// hibernation. "waiting" sockets sit in the matchmaking queue; "alone" means
// the opponent left mid-room — the client must explicitly send "requeue" so a
// fresh match can never barge in while its reveal animation is still playing.
type Attachment =
  | { state: "waiting" }
  | { state: "alone" }
  | { state: "paired"; roomId: string; readyVersion?: UuidVersion };

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
    this.enqueue(server);
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
    if (!att) return;

    if (msg.type === "requeue") {
      // Ignored while still paired — requeueing is only for abandoned players.
      if (att.state !== "paired") this.enqueue(ws);
      return;
    }

    if (msg.type === "ready" && att.state === "paired") {
      const partner = this.partnerOf(ws, att.roomId);
      if (!partner) {
        // Opponent vanished without a close event reaching us.
        setAttachment(ws, { state: "alone" });
        this.send(ws, { type: "opponent_left" });
        return;
      }
      const partnerAtt = getAttachment(partner);
      if (partnerAtt?.state === "paired" && partnerAtt.readyVersion) {
        // Both ready. The player who readied first picks the UUID version.
        const version = partnerAtt.readyVersion;
        const [mine, theirs] = buildUuidPair(version);
        this.send(ws, { type: "start", version, uuid: mine, opponentUuid: theirs });
        this.send(partner, { type: "start", version, uuid: theirs, opponentUuid: mine });
        // Clear ready flags but keep the room for a rematch.
        setAttachment(ws, { state: "paired", roomId: att.roomId });
        setAttachment(partner, { state: "paired", roomId: att.roomId });
      } else {
        setAttachment(ws, { state: "paired", roomId: att.roomId, readyVersion: msg.version });
        this.send(partner, { type: "opponent_ready" });
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.handleLeave(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.handleLeave(ws);
  }

  handleLeave(ws: WebSocket): void {
    const att = getAttachment(ws);
    if (att?.state !== "paired") return;
    const partner = this.partnerOf(ws, att.roomId);
    if (partner) {
      setAttachment(partner, { state: "alone" });
      this.send(partner, { type: "opponent_left" });
    }
  }

  enqueue(ws: WebSocket): void {
    setAttachment(ws, { state: "waiting" });
    this.send(ws, { type: "waiting" });
    const other = this.ctx
      .getWebSockets()
      .find((o) => o !== ws && getAttachment(o)?.state === "waiting");
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
      return att?.state === "paired" && att.roomId === roomId;
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
