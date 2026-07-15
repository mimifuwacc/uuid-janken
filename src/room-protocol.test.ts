import { describe, expect, it } from "vite-plus/test";
import { rankByUuid, ROOM_COLORS } from "./room-protocol";

describe("部屋モードのUUIDランキング", () => {
  it("大きいUUIDが1位（降順）に並ぶ", () => {
    const players = [
      { id: "a", uuid: "00000000-0000-4000-8000-000000000001" },
      { id: "b", uuid: "ffffffff-ffff-4fff-bfff-ffffffffffff" },
      { id: "c", uuid: "88888888-8888-4888-8888-888888888888" },
    ];
    expect(rankByUuid(players).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("ダッシュ・大文字小文字を無視して比較する", () => {
    // 一方は大文字＋ダッシュ、もう一方は小文字。正規化後は 0B0B > 0A0A。
    const players = [
      { id: "low", uuid: "0A0A0A0A-0000-4000-8000-000000000000" },
      { id: "high", uuid: "0b0b0b0b00004000800000000000000" },
    ];
    expect(rankByUuid(players)[0].id).toBe("high");
  });

  it("入力配列を破壊せず新しい配列を返す", () => {
    const players = [
      { id: "a", uuid: "11111111-1111-4111-8111-111111111111" },
      { id: "b", uuid: "22222222-2222-4222-8222-222222222222" },
    ];
    const snapshot = [...players];
    const ranked = rankByUuid(players);
    expect(players).toEqual(snapshot);
    expect(ranked).not.toBe(players);
  });

  it("色パレットは重複がなく、妥当な6桁hex", () => {
    expect(new Set(ROOM_COLORS).size).toBe(ROOM_COLORS.length);
    for (const c of ROOM_COLORS) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
