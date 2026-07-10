const X_INTENT_URL = "https://x.com/intent/tweet";

export function createWinnerShareUrl(
  player0Uuid: string,
  player1Uuid: string,
  gameUrl: string,
): string {
  const url = new URL(X_INTENT_URL);
  url.searchParams.set(
    "text",
    `UUIDじゃんけんで遊びました！\n${player0Uuid}\nvs\n${player1Uuid}\n\n${gameUrl}\n#UUIDじゃんけん`,
  );
  return url.toString();
}
