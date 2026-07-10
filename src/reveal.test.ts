import { describe, expect, it } from "vite-plus/test";
import {
  getRevealDelay,
  getRevealFrequency,
  getRevealUpgrade,
  REVEAL_CHARACTER_COUNT,
} from "./reveal";

describe("UUID表示演出", () => {
  it("上位桁ほど表示間隔を長くする", () => {
    expect(getRevealDelay(0)).toBeLessThan(getRevealDelay(18));
    expect(getRevealDelay(18)).toBeLessThan(getRevealDelay(REVEAL_CHARACTER_COUNT - 1));
  });

  it("上位桁ほど高い音を鳴らす", () => {
    expect(getRevealFrequency(0)).toBeLessThan(getRevealFrequency(18));
    expect(getRevealFrequency(18)).toBeLessThan(getRevealFrequency(REVEAL_CHARACTER_COUNT));
  });

  it("ゾロ目を昇格演出として判定する", () => {
    expect(getRevealUpgrade("12345678-1234-4abc-8def-1234567899ab", 4)).toBe("pair");
  });

  it("3連続をゾロ目より強い昇格演出として判定する", () => {
    expect(getRevealUpgrade("12345678-1234-4abc-8def-123456789aaa", 3)).toBe("triple");
  });
});
