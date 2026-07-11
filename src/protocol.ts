// Shared between the browser client (online.ts) and the Cloudflare Worker
// (worker/index.ts). Must stay free of DOM- and Workers-specific APIs so both
// tsconfigs can type-check it.

import { v7 as uuidV7 } from "uuid";

export type UuidVersion = "v4" | "v7";

// Client → server. "ready" doubles as the rematch request; "requeue" asks for
// a new opponent after the previous one left or after a reconnect.
export type ClientMessage = { type: "ready"; version: UuidVersion } | { type: "requeue" };

// Server → client, in rough lifecycle order. "start" carries both UUIDs up
// front — the reveal is pure presentation, the outcome is already decided.
export type ServerMessage =
  | { type: "waiting" }
  | { type: "matched" }
  | { type: "opponent_ready" }
  | { type: "start"; version: UuidVersion; uuid: string; opponentUuid: string }
  | { type: "opponent_left" };

// Two back-to-back argument-less v7() calls: the uuid package's internal
// monotonic state guarantees the second one always sorts higher, and a coin
// flip decides which side gets it, so the outcome is a fair 50/50 and never a
// draw. This is the same construction as race.ts's fallback pair — the online
// server always uses the coin flip (there is no cross-client thread race).
export function coinFlipUuidV7Pair(): [string, string] {
  const lower = uuidV7();
  const higher = uuidV7();
  return Math.random() < 0.5 ? [higher, lower] : [lower, higher];
}

export function buildUuidPair(version: UuidVersion): [string, string] {
  if (version === "v4") {
    return [crypto.randomUUID(), crypto.randomUUID()];
  }
  return coinFlipUuidV7Pair();
}
