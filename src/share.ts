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

// Online play matches strangers, so even a loss is worth sharing (there's no
// one to lose face in front of) — loserUuid/opponentUuid are named from the
// loser's own point of view.
export function createLoserShareUrl(
  loserUuid: string,
  opponentUuid: string,
  gameUrl: string,
): string {
  return createShareUrl(
    `UUIDじゃんけんで惜しくも敗北……\n\n${loserUuid}\nvs\n${opponentUuid}\n\n${gameUrl}\n#UUIDじゃんけん`,
  );
}
