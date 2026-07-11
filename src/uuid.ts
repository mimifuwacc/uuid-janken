import { raceUuidV7Pair } from "./race";

export type UuidVersion = "v4" | "v7";

export function generateUuidV4(): string {
  return crypto.randomUUID();
}

// v7 UUIDs sort by generation order: the uuid package's internal monotonic
// state guarantees that of two back-to-back v7() calls the second one always
// sorts higher (seq increments within a millisecond, the timestamp grows
// across milliseconds). The win/loss is therefore decided by which player
// gets the later-generated UUID, which the actual thread race determines
// (see race.ts).
export async function generateRaceUuids(version: UuidVersion): Promise<[string, string]> {
  if (version === "v4") {
    return [generateUuidV4(), generateUuidV4()];
  }
  return raceUuidV7Pair();
}

export function compareUuids(a: string, b: string): "a" | "b" | "draw" {
  const n = (s: string) => s.replace(/-/g, "").toUpperCase();
  const na = n(a),
    nb = n(b);
  if (na > nb) return "a";
  if (na < nb) return "b";
  return "draw";
}
