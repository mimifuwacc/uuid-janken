import { describe, expect, it } from "vite-plus/test";
import { getRevealDelay, getRevealFrequency, REVEAL_CHARACTER_COUNT } from "./reveal";

describe("UUID表示演出", () => {
  it("上位桁ほど表示間隔を長くする", () => {
    expect(getRevealDelay(0)).toBe(55);
    expect(getRevealDelay(0)).toBeLessThan(getRevealDelay(18));
    expect(getRevealDelay(18)).toBeLessThan(getRevealDelay(REVEAL_CHARACTER_COUNT - 1));
    expect(getRevealDelay(REVEAL_CHARACTER_COUNT - 1)).toBe(280);
  });

  it("上位桁ほど高い音を鳴らす", () => {
    expect(getRevealFrequency(0)).toBe(220);
    expect(getRevealFrequency(0)).toBeLessThan(getRevealFrequency(18));
    expect(getRevealFrequency(18)).toBeLessThan(getRevealFrequency(REVEAL_CHARACTER_COUNT));
    expect(getRevealFrequency(REVEAL_CHARACTER_COUNT)).toBe(440);
  });
});
