import { describe, expect, it } from "vite-plus/test";
import { buildUuidPair, coinFlipUuidV7Pair } from "./protocol";
import { compareUuids } from "./uuid";

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("オンライン対戦用UUIDペア", () => {
  it("v4では両者とも有効なUUID v4で、互いに異なる", () => {
    const [a, b] = buildUuidPair("v4");
    for (const uuid of [a, b]) {
      expect(uuid).toMatch(HEX);
      expect(uuid[14]).toBe("4");
    }
    expect(a).not.toBe(b);
  });

  it("v7では両者ともバージョン7で、必ず勝敗が決まる", () => {
    const [a, b] = buildUuidPair("v7");
    for (const uuid of [a, b]) {
      expect(uuid).toMatch(HEX);
      expect(uuid[14]).toBe("7");
    }
    expect(compareUuids(a, b)).not.toBe("draw");
  });

  it("コイントスにより先手・後手どちらの勝ちも起こり得る", () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 200 && outcomes.size < 2; i++) {
      const [a, b] = coinFlipUuidV7Pair();
      outcomes.add(compareUuids(a, b));
    }
    // 200回連続で同じ側が勝つ確率は 2^-199 — 事実上起こらない。
    expect(outcomes).toEqual(new Set(["a", "b"]));
  });
});
