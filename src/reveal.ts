export const REVEAL_CHARACTER_COUNT = 36;

export type RevealUpgrade = "pair" | "triple" | null;

const MIN_REVEAL_DELAY_MS = 55;
const MAX_REVEAL_DELAY_MS = 280;
const LOWEST_REVEAL_FREQUENCY = 220;
const MAX_REVEAL_SHAKE_DISTANCE = 10;

export function getRevealDelay(revealedCount: number): number {
  const progress = revealedCount / (REVEAL_CHARACTER_COUNT - 1);
  return Math.round(
    MIN_REVEAL_DELAY_MS + (MAX_REVEAL_DELAY_MS - MIN_REVEAL_DELAY_MS) * progress ** 3,
  );
}

export function getRevealFrequency(revealedCount: number): number {
  return LOWEST_REVEAL_FREQUENCY * 2 ** (revealedCount / (REVEAL_CHARACTER_COUNT / 2));
}

export function getRevealShakeDistance(revealedCount: number): number {
  const progress = revealedCount / (REVEAL_CHARACTER_COUNT - 1);
  return Math.round(MAX_REVEAL_SHAKE_DISTANCE * progress ** 5);
}

export function getRevealUpgrade(uuid: string, revealedCount: number): RevealUpgrade {
  const revealIndex = uuid.length - revealedCount;
  const digit = uuid[revealIndex];
  if (!digit || digit === "-") return null;
  if (digit === uuid[revealIndex + 1] && digit === uuid[revealIndex + 2]) return "triple";
  if (digit === uuid[revealIndex + 1]) return "pair";
  return null;
}
