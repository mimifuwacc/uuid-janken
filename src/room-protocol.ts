// Shared between the browser client (roomConnection.ts / views/room.ts) and the
// Cloudflare Worker (worker/index.ts JankenRoom). Must stay free of DOM- and
// Workers-specific APIs so both tsconfigs can type-check it (same rule as
// protocol.ts). Rooms are always UUID v4 — an N-way "one shot, largest wins"
// lottery, so there's no per-pair race like the 1v1 v7 mode.

// A roster entry as broadcast to every member. `num` is a stable join number
// (never reused while the room lives) shown as "プレイヤー{num}"; `color` is a
// palette colour kept distinct per member where possible.
export interface RoomRosterPlayer {
  id: string;
  num: number;
  color: string;
  ready: boolean;
}

// One player's assigned UUID for a round, delivered in the "start" message.
export interface RoomStartPlayer {
  id: string;
  uuid: string;
}

// Client → server. "ready" arms this player for the next round (all connected
// members ready + at least two present ⇒ the round begins); "cancel" disarms it
// again while still in the lobby. Leaving needs no message — closing the socket
// drops the member and the server re-broadcasts the roster.
export type RoomClientMessage = { type: "ready" } | { type: "cancel" };

// Server → client. "roster" is pushed on every membership/ready change; "start"
// delivers every player's UUID at once (the reveal is pure presentation — the
// ranking is already decided). Clients rank with rankByUuid().
export type RoomServerMessage =
  | { type: "roster"; youId: string; players: RoomRosterPlayer[] }
  | { type: "start"; players: RoomStartPlayer[] };

// Distinct, roughly evenly-spaced neon hues; the server hands them out so each
// member is visually separable, cycling once there are more players than hues.
export const ROOM_COLORS = [
  "#00ff88",
  "#ff5f35",
  "#00cfff",
  "#ffdd00",
  "#ff66cc",
  "#a855f7",
  "#7CFC00",
  "#ff3b6b",
];

const normalizeUuid = (uuid: string): string => uuid.replace(/-/g, "").toUpperCase();

// Ranks players by UUID magnitude, largest first (rank 1 = winner) — the same
// "bigger UUID wins" rule as the 1v1 compareUuids(), generalised to N players.
// v4 UUIDs collide with negligible probability, so ties effectively never
// happen; a stray tie keeps the players' input order (stable sort).
export function rankByUuid<T extends RoomStartPlayer>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const na = normalizeUuid(a.uuid);
    const nb = normalizeUuid(b.uuid);
    if (na > nb) return -1;
    if (na < nb) return 1;
    return 0;
  });
}
