import { describe, it, expect } from "vitest";
import { rowCount, fmtRow, EXACT_ROW_COUNTS } from "@lib/figures";

describe("rowCount", () => {
  it("floors to two significant figures", () => {
    expect(rowCount(6611)).toBe("6,600+");
    expect(rowCount(1851)).toBe("1,800+");
    expect(rowCount(456)).toBe("450+");
    expect(rowCount(230)).toBe("230+");
  });

  it("never over-promises (the rounded value is <= the real one)", () => {
    for (const n of [230, 456, 784, 1086, 1555, 6611, 28064]) {
      const shown = Number(rowCount(n).replace(/[,+]/g, ""));
      expect(shown).toBeLessThanOrEqual(n);
    }
  });

  it("is monotonic across a magnitude boundary", () => {
    expect(rowCount(99)).toBe("90+");
    expect(rowCount(100)).toBe("100+");
    expect(rowCount(999)).toBe("990+");
    expect(rowCount(1000)).toBe("1,000+");
  });

  it("degrades sanely below 10 and at zero", () => {
    expect(rowCount(7)).toBe("7+");
    expect(rowCount(0)).toBe("0");
    expect(rowCount(-5)).toBe("0");
    expect(rowCount(Number.NaN)).toBe("0");
  });
});

describe("fmtRow", () => {
  it("stays on the rounded policy until sign-off", () => {
    expect(EXACT_ROW_COUNTS).toBe(false);
    expect(fmtRow(6611)).toBe("6,600+");
  });
});
