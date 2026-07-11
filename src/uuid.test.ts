import { v7 as uuidV7 } from "uuid";
import { describe, expect, it } from "vite-plus/test";
import { compareUuids, generateRaceUuids, generateUuidV4 } from "./uuid";

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("UUID生成", () => {
  it("v4はバージョン4・バリアント10のUUIDを生成する", () => {
    const uuid = generateUuidV4();
    expect(uuid).toMatch(HEX);
    expect(uuid[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });
});

describe("連続して生成したv7 UUIDの決定的な大小関係", () => {
  // ここが核心の不変条件: 同一モジュールインスタンスで連続して呼んだ
  // v7()は、uuidパッケージの内部状態（updateV7State）が単調増加を保証する
  // （同一ミリ秒内はseqをインクリメントし、ミリ秒が進めばタイムスタンプで
  // 大きくなる）ため、後に呼ばれた方が必ずcompareUuids上で勝つ（＝大きい方
  // になる）。レース勝敗の割り当て（race.ts）はこの性質に順序性を委ねている
  // ので、数百回の反復で決定的に成立することを確認する。
  it("後に生成した側が、乱数ビットの値によらず必ずcompareUuidsで勝つ", () => {
    for (let i = 0; i < 500; i++) {
      const loser = uuidV7();
      const winner = uuidV7();
      expect(compareUuids(winner, loser)).toBe("a");
      expect(compareUuids(loser, winner)).toBe("b");
    }
  });
});

describe("対戦UUIDの生成", () => {
  it("v7では両者ともバージョン7・バリアント10のUUIDになる", async () => {
    const [a, b] = await generateRaceUuids("v7");
    for (const uuid of [a, b]) {
      expect(uuid).toMatch(HEX);
      expect(uuid[14]).toBe("7");
      expect(["8", "9", "a", "b"]).toContain(uuid[19]);
    }
  });

  it("v7では勝敗が必ずどちらかに決まり、引き分けにならない", async () => {
    const [a, b] = await generateRaceUuids("v7");
    expect(compareUuids(a, b)).not.toBe("draw");
  });

  it("v4では両者とも有効なUUID v4になる", async () => {
    const [a, b] = await generateRaceUuids("v4");
    expect(a[14]).toBe("4");
    expect(b[14]).toBe("4");
  });
});
