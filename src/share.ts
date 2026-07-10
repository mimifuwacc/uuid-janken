const X_INTENT_URL = "https://x.com/intent/tweet";

function createShareUrl(text: string): string {
  const url = new URL(X_INTENT_URL);
  url.searchParams.set("text", text);
  return url.toString();
}

export function createWinnerShareUrl(
  player0Uuid: string,
  player1Uuid: string,
  gameUrl: string,
): string {
  return createShareUrl(
    `UUIDじゃんけんで遊びました！\n\n${player0Uuid}\nvs\n${player1Uuid}\n\n${gameUrl}\n#UUIDじゃんけん`,
  );
}

export function createDrawShareUrl(
  player0Uuid: string,
  player1Uuid: string,
  gameUrl: string,
): string {
  return createShareUrl(
    `UUIDじゃんけんで遊びました！\n結果はまさかのあいこ！？\n\n${player0Uuid}\nvs\n${player1Uuid}\n\n${gameUrl}\n#UUIDじゃんけん`,
  );
}
