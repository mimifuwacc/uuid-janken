// Thin client for a room's matchmaking WebSocket (see worker/index.ts's
// JankenRoom). Owns the socket lifecycle and turns server messages into
// callbacks; all room/UI state stays in views/room.ts. Mirrors online.ts's
// keepalive/teardown, minus the 1v1-specific requeue handshake — the server
// pushes the roster the moment we connect.

import type { RoomRosterPlayer, RoomServerMessage, RoomStartPlayer } from "./room-protocol";

export interface RoomHandlers {
  onRoster: (youId: string, players: RoomRosterPlayer[]) => void;
  onStart: (players: RoomStartPlayer[]) => void;
  onDisconnected: () => void;
}

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 15_000;

export function roomSocketUrl(roomId: string, loc: Location = window.location): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws/room/${encodeURIComponent(roomId)}`;
}

export class RoomConnection {
  private roomId: string;
  private handlers: RoomHandlers;
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private pongTimer = 0;
  private closedByUs = false;

  constructor(roomId: string, handlers: RoomHandlers) {
    this.roomId = roomId;
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (
      this.ws !== null &&
      this.ws.readyState !== WebSocket.CLOSING &&
      this.ws.readyState !== WebSocket.CLOSED
    ) {
      return;
    }

    this.closedByUs = false;
    const ws = new WebSocket(roomSocketUrl(this.roomId));
    this.ws = ws;

    const armPongTimeout = () => {
      clearTimeout(this.pongTimer);
      this.pongTimer = window.setTimeout(() => {
        if (ws !== this.ws) return;
        // Nothing came back after the last ping — force-close rather than trust
        // a socket that merely still looks open (see online.ts PONG_TIMEOUT_MS).
        ws.close();
      }, PONG_TIMEOUT_MS);
    };

    ws.addEventListener("open", () => {
      if (ws !== this.ws) return;
      this.pingTimer = window.setInterval(() => {
        ws.send("ping");
        armPongTimeout();
      }, PING_INTERVAL_MS);
    });

    ws.addEventListener("message", (e) => {
      if (ws !== this.ws) return;
      clearTimeout(this.pongTimer); // any traffic proves it's alive
      if (typeof e.data !== "string" || e.data === "pong") return;
      let msg: RoomServerMessage;
      try {
        msg = JSON.parse(e.data) as RoomServerMessage;
      } catch {
        return;
      }
      if (msg.type === "roster") this.handlers.onRoster(msg.youId, msg.players);
      else if (msg.type === "start") this.handlers.onStart(msg.players);
    });

    const onGone = () => {
      if (ws !== this.ws) return;
      this.stopPing();
      this.ws = null;
      if (!this.closedByUs) this.handlers.onDisconnected();
    };
    ws.addEventListener("close", onGone);
    ws.addEventListener("error", onGone);
  }

  sendReady(): void {
    this.send({ type: "ready" });
  }

  sendCancel(): void {
    this.send({ type: "cancel" });
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: { type: "ready" | "cancel" }): void {
    if (this.isOpen) this.ws!.send(JSON.stringify(msg));
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
    clearTimeout(this.pongTimer);
    this.pongTimer = 0;
  }
}
