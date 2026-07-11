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

// If nothing at all (not even a "pong") arrives within this long after a
// ping, the connection is treated as dead even though the browser hasn't
// fired "close"/"error" yet — e.g. a silent Wi-Fi drop or a switch to
// cellular can leave a WebSocket looking OPEN for a while with no traffic
// actually getting through. Forcing a close here is what lets a player
// stuck on "対戦相手を探しています…" (no button to click, nothing to
// retry) eventually see a reconnect prompt instead of waiting forever.
const PONG_TIMEOUT_MS = 15_000;

export function onlineSocketUrl(loc: Location = window.location): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}

export class OnlineConnection {
  private handlers: OnlineHandlers;
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private pongTimer = 0;
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

    const armPongTimeout = () => {
      clearTimeout(this.pongTimer);
      this.pongTimer = window.setTimeout(() => {
        if (ws !== this.ws) return;
        // See PONG_TIMEOUT_MS: nothing came back after the last ping, so
        // force-close rather than trust a WebSocket that merely still
        // *looks* open. This close funnels into the same onGone() path
        // as a real close/error event below.
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
      clearTimeout(this.pongTimer); // any traffic at all proves it's alive
      if (typeof e.data !== "string" || e.data === "pong") return;
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
    if (this.isOpen) {
      this.ws!.send(JSON.stringify(msg));
      return;
    }
    // A caller (a result-screen button click, typically) tried to act on a
    // connection that's already unusable but hadn't been noticed yet — e.g.
    // "close" hasn't been dispatched, or the UI wasn't refreshed after it
    // was. Surface the disconnect now instead of silently doing nothing, so
    // the click always leads to either the action or a reconnect prompt.
    if (this.ws === null || this.ws.readyState === WebSocket.CLOSED) {
      if (this.ws !== null) {
        this.stopPing();
        this.ws = null;
      }
      if (!this.closedByUs) this.handlers.onDisconnected();
    }
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
    clearTimeout(this.pongTimer);
    this.pongTimer = 0;
  }
}
