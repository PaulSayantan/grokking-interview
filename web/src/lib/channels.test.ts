import { describe, it, expect } from "vitest";
import {
  TRACKS,
  trackFor,
  trackCoverageErrors,
  assertTrackCoverage,
} from "@lib/channels";
import { getAuthoredDomains } from "@lib/catalog";

const authoredSlugs = getAuthoredDomains().map((d) => d.slug);

describe("TRACKS", () => {
  it("covers every authored domain exactly once", () => {
    expect(trackCoverageErrors(authoredSlugs)).toEqual([]);
    const mapped = TRACKS.flatMap((t) => t.domains);
    expect(mapped).toHaveLength(authoredSlugs.length);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...authoredSlugs].sort());
  });

  it("has seven tracks with unique keys and labels", () => {
    expect(TRACKS).toHaveLength(7);
    expect(new Set(TRACKS.map((t) => t.key)).size).toBe(7);
    expect(new Set(TRACKS.map((t) => t.label)).size).toBe(7);
  });

  it("uses only CSS custom-property tokens, never a hex literal", () => {
    for (const t of TRACKS) {
      expect(t.token).toMatch(/^var\(--[a-z0-9-]+\)$/);
      expect(t.token).not.toMatch(/#/);
    }
    expect(new Set(TRACKS.map((t) => t.token)).size).toBe(7);
  });

  it("gives every track a one-sentence blurb", () => {
    for (const t of TRACKS) {
      expect(t.blurb.length).toBeGreaterThan(20);
      expect(t.blurb.length).toBeLessThan(80);
      expect(t.blurb.endsWith(".")).toBe(true);
    }
  });
});

describe("trackFor", () => {
  it("resolves a known slug and rejects an unknown one", () => {
    expect(trackFor("docker")?.key).toBe("platform");
    expect(trackFor("system-design")?.key).toBe("design");
    expect(trackFor("not-a-domain")).toBeUndefined();
  });
});

describe("the coverage gate", () => {
  it("reports a newly authored domain that nobody mapped", () => {
    const errors = trackCoverageErrors([...authoredSlugs, "brand-new-domain"]);
    expect(errors.join(" ")).toContain("missing: brand-new-domain");
    expect(() => assertTrackCoverage([...authoredSlugs, "brand-new-domain"])).toThrow(
      /brand-new-domain/,
    );
  });

  it("reports a slug that vanished from the catalog", () => {
    const errors = trackCoverageErrors(authoredSlugs.filter((s) => s !== "grpc"));
    expect(errors.join(" ")).toContain("unknown domains: grpc");
  });
});
