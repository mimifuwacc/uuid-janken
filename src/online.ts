// Thin client for the online matchmaking WebSocket (see worker/index.ts).
// Owns the socket lifecycle and translates server messages into callbacks;
// all game/UI state stays in main.ts.

import type { ClientMessage, ServerMessage, UuidVersion } from "./protocol";

export interface OnlineHandlers {
  onWaiting: () => void;
  onMatched: () => void;
  onOpponentReady: () => void;
  onStart: (version: UuidVersion, uuid: string, opponentUuid: string) => void;
  onOpponentLeft: () => void;
  onDisconnected: () => void;
}

// Keepalive interval — answered by the server's WebSocket auto-response
// without waking the Durable Object, and keeps idle waits alive through
// proxies that reap quiet connections.
const PING_INTERVAL_MS = 20_000;

export function onlineSocketUrl(loc: Location = window.location): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}

export class OnlineConnection {
  private handlers: OnlineHandlers;
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private closedByUs = false;

  constructor(handlers: OnlineHandlers) {
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closedByUs = false;
    const ws = new WebSocket(onlineSocketUrl());
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (ws !== this.ws) return;
      this.pingTimer = window.setInterval(() => ws.send("ping"), PING_INTERVAL_MS);
    });

    ws.addEventListener("message", (e) => {
      if (ws !== this.ws || typeof e.data !== "string" || e.data === "pong") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "waiting":
          this.handlers.onWaiting();
          break;
        case "matched":
          this.handlers.onMatched();
          break;
        case "opponent_ready":
          this.handlers.onOpponentReady();
          break;
        case "go":
          // Ack immediately — the server decides the v7 winner by whichever
          // side's ack arrives first, so any delay here costs the race.
          this.send({ type: "go_ack" });
          break;
        case "start":
          this.handlers.onStart(msg.version, msg.uuid, msg.opponentUuid);
          break;
        case "opponent_left":
          this.handlers.onOpponentLeft();
          break;
      }
    });

    // "error" is normally followed by "close"; the ws !== this.ws guard makes
    // whichever fires second a no-op.
    const onGone = () => {
      if (ws !== this.ws) return;
      this.stopPing();
      this.ws = null;
      if (!this.closedByUs) this.handlers.onDisconnected();
    };
    ws.addEventListener("close", onGone);
    ws.addEventListener("error", onGone);
  }

  sendReady(version: UuidVersion): void {
    this.send({ type: "ready", version });
  }

  sendRequeue(): void {
    this.send({ type: "requeue" });
  }

  sendLeave(): void {
    this.send({ type: "leave" });
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: ClientMessage): void {
    if (this.isOpen) this.ws!.send(JSON.stringify(msg));
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }
}
