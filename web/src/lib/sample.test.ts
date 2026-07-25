import { describe, it, expect } from "vitest";
import { mulberry32, hashSeed, seededShuffle, pickN } from "@lib/sample";

describe("seededShuffle", () => {
  it("is deterministic for a given seed", () => {
    const a = seededShuffle([1, 2, 3, 4, 5], 42);
    const b = seededShuffle([1, 2, 3, 4, 5], 42);
    expect(a).toEqual(b);
  });

  it("is a permutation (no drops, no dupes)", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = seededShuffle(input, 123);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [1, 2, 3];
    seededShuffle(input, 7);
    expect(input).toEqual([1, 2, 3]);
  });

  it("different seeds generally give different orders", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 1);
    const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 2);
    expect(a).not.toEqual(b);
  });
});

describe("mulberry32 / hashSeed", () => {
  it("mulberry32 yields values in [0,1)", () => {
    const rand = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hashSeed is stable and non-negative", () => {
    expect(hashSeed("system-design")).toBe(hashSeed("system-design"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    expect(hashSeed("anything")).toBeGreaterThanOrEqual(0);
  });
});

describe("pickN", () => {
  it("returns n items when the pool is large enough", () => {
    expect(pickN([1, 2, 3, 4, 5], 3, 1)).toHaveLength(3);
  });
  it("returns the whole pool (shuffled) when n exceeds the pool", () => {
    const out = pickN([1, 2, 3], 10, 1);
    expect(out).toHaveLength(3);
    expect(out.slice().sort()).toEqual([1, 2, 3]);
  });
  it("clamps a negative n to an empty selection", () => {
    expect(pickN([1, 2, 3], -5, 1)).toEqual([]);
  });
});

// The critical scoring invariant: PracticeSession shuffles each question's
// options and remaps the correct index via `order.indexOf(answer)`. A bug here
// would grade every learner's correct answers as wrong, invisibly. This
// reproduces that exact remap and asserts it always points at the original
// correct option's TEXT.
describe("answer-remap invariant (option shuffle)", () => {
  function remap(options: string[], answer: number, seed: number) {
    const order = seededShuffle(
      options.map((_, i) => i),
      seed,
    );
    const shuffled = order.map((i) => options[i]);
    const correctIndex = order.indexOf(answer);
    return { shuffled, correctIndex };
  }

  it("the remapped index always points at the original correct text", () => {
    const options = ["alpha", "bravo", "charlie", "delta"];
    for (let answer = 0; answer < options.length; answer++) {
      for (let seed = 0; seed < 200; seed++) {
        const { shuffled, correctIndex } = remap(options, answer, seed);
        expect(shuffled[correctIndex]).toBe(options[answer]);
        expect(correctIndex).toBeGreaterThanOrEqual(0);
        expect(correctIndex).toBeLessThan(options.length);
      }
    }
  });

  it("preserves the full option set (no dropped/duplicated options)", () => {
    const options = ["a", "b", "c", "d", "e"];
    const { shuffled } = remap(options, 2, 55);
    expect(shuffled.slice().sort()).toEqual(options.slice().sort());
  });
});
