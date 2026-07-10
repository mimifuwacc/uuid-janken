import { describe, expect, it } from "vite-plus/test";
import { createWinnerShareUrl } from "./share";

describe("勝者の共有URL", () => {
  it("対戦したUUIDとゲームURLを含むXの共有URLを作る", () => {
    const url = new URL(
      createWinnerShareUrl(
        "123e4567-e89b-42d3-a456-426614174000",
        "123e4567-e89b-42d3-a456-426614174001",
        "https://uuid-janken.example.com/",
      ),
    );

    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(url.searchParams.get("text")).toBe(
      "UUIDじゃんけんで遊びました！\n123e4567-e89b-42d3-a456-426614174000\nvs\n123e4567-e89b-42d3-a456-426614174001\n\nhttps://uuid-janken.example.com/\n#UUIDじゃんけん",
    );
  });
});
