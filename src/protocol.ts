// Shared between the browser client (online.ts) and the Cloudflare Worker
// (worker/index.ts). Must stay free of DOM- and Workers-specific APIs so both
// tsconfigs can type-check it.

import { v7 as uuidV7 } from "uuid";

export type UuidVersion = "v4" | "v7";

// Client → server. "ready" doubles as the rematch request; "requeue" asks to
// (re)join the matchmaking queue — sent right after connecting, and again
// whenever the version toggle changes while still unmatched — carrying the
// version so matching only ever pairs two players who both want the same
// one (see worker/index.ts's enqueue()). "go_ack" is sent the instant "go" is
// received, to race against the opponent's — see ServerMessage's "go" and
// worker/index.ts's v7 handling. "leave" voluntarily ends the current pairing
// (opponent still connected) to look for someone else, distinct from
// "requeue" which only applies once already unpaired.
export type ClientMessage =
  | { type: "ready"; version: UuidVersion }
  | { type: "requeue"; version: UuidVersion }
  | { type: "go_ack" }
  | { type: "leave"; version: UuidVersion };

// Server → client, in rough lifecycle order. "start" carries both UUIDs up
// front — the reveal is pure presentation, the outcome is already decided.
// "go" only fires for v7 rounds: it releases both clients from the server's
// barrier at the same instant, mirroring race.ts's Atomics.notify — whichever
// "go_ack" reaches the server first decides the winner (see worker/index.ts).
export type ServerMessage =
  | { type: "waiting" }
  | { type: "matched" }
  | { type: "opponent_ready" }
  | { type: "go" }
  | { type: "start"; version: UuidVersion; uuid: string; opponentUuid: string }
  | { type: "opponent_left" };

export function buildUuidV4Pair(): [string, string] {
  return [crypto.randomUUID(), crypto.randomUUID()];
}

// Two back-to-back argument-less v7() calls: the uuid package's internal
// monotonic state guarantees the second one always sorts higher. Used as the
// v7 pair whenever there's no real race to decide the order — race.ts's
// fallback (no SharedArrayBuffer / worker race failed) and worker/index.ts's
// round-timeout fallback (opponent's "go_ack" never arrived) — so a coin flip
// picks the side, keeping the outcome a fair 50/50 and never a draw.
export function coinFlipUuidV7Pair(): [string, string] {
  const lower = uuidV7();
  const higher = uuidV7();
  return Math.random() < 0.5 ? [higher, lower] : [lower, higher];
}
