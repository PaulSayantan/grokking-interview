/**
 * `@lib/atlas` — one channel colour per atlas page.
 *
 * The bug this file exists to prevent is silent: `@lib/channels` gives the
 * Design track `var(--ins-brand)`, which resolves to NOTHING outside a `.ins`
 * wrapper. Set as `--atl-ch` on a learning page it paints every channel mark
 * transparent — the eyebrow tick, the route segments, the meter fill, the folio
 * — with no error in the console and no failing build.
 */
import { describe, it, expect } from "vitest";
import { TRACKS } from "./channels";
import { getAuthoredDomains } from "./catalog";
import {
  atlasChannel,
  atlasChannelLabel,
  atlasChannelStyle,
  atlasNextDomain,
  atlasTrackPosition,
  ATLAS_CHANNEL_FALLBACK,
} from "./atlas";

describe("atlasChannel", () => {
  it("never returns an `--ins-*` token, which resolves to nothing off `.ins`", () => {
    for (const t of TRACKS) {
      for (const d of t.domains) {
        expect(atlasChannel(d), `${d} leaks a .ins-scoped token`).not.toContain("--ins-");
      }
    }
  });

  it("returns a var() reference for every authored domain — never a hex", () => {
    for (const t of TRACKS) {
      for (const d of t.domains) {
        const v = atlasChannel(d);
        expect(v).toMatch(/^var\(--[a-z0-9-]+\)$/);
        expect(v, "a hex literal silently fails one theme").not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });

  it("maps the Design track onto the foundation's own brand token", () => {
    // system-design is the Design track's first domain and the only track whose
    // token is `.ins`-scoped.
    expect(atlasChannel("system-design")).toBe("var(--atl-brand)");
  });

  it("passes the six global accent tokens straight through", () => {
    expect(atlasChannel("docker")).toBe("var(--accent-amber)");
    expect(atlasChannel("spring-boot")).toBe("var(--accent-green)");
    expect(atlasChannel("grpc")).toBe("var(--accent-teal)");
    expect(atlasChannel("java-jvm")).toBe("var(--accent-blue)");
    expect(atlasChannel("testing")).toBe("var(--accent-rose)");
    expect(atlasChannel("interview-craft")).toBe("var(--accent-violet)");
  });

  it("falls back to something always resolvable for an untracked domain", () => {
    expect(atlasChannel("not-a-domain")).toBe(ATLAS_CHANNEL_FALLBACK);
    expect(ATLAS_CHANNEL_FALLBACK).toContain("--topic-accent");
    // A nested fallback, so an unset --topic-accent still paints.
    expect(ATLAS_CHANNEL_FALLBACK).toContain("--color-primary");
  });
});

describe("atlasChannelStyle", () => {
  it("emits exactly one custom property, ready for an inline style attribute", () => {
    const s = atlasChannelStyle("docker");
    expect(s).toBe("--atl-ch: var(--accent-amber);");
    // Nothing that could break out of a style attribute.
    expect(s).not.toMatch(/["'<>]/);
  });
});

describe("atlasChannelLabel", () => {
  it("names the channel in words, because colour is never the only carrier", () => {
    expect(atlasChannelLabel("docker")).toBe("Platform & Ops");
    expect(atlasChannelLabel("system-design")).toBe("Design");
    expect(atlasChannelLabel("not-a-domain")).toBeNull();
  });
});

/**
 * The /domain eyebrow prints "Domain 01 of 05 · Platform & Ops". Both numbers
 * are read by a learner as a promise about a sequence, so both are asserted:
 * an off-by-one index or a denominator that counts an unauthored slug is a page
 * that lies quietly.
 */
describe("atlasTrackPosition", () => {
  const authored = getAuthoredDomains().map((d) => d.slug);

  it("places a domain within its own track, 1-based", () => {
    const docker = atlasTrackPosition("docker")!;
    expect(docker.label).toBe("Platform & Ops");
    // channels.ts orders the track docker → kubernetes → devops-cicd → …
    expect(docker.index).toBe(1);
    expect(docker.total).toBe(5);
    expect(atlasTrackPosition("kubernetes")!.index).toBe(2);
    expect(atlasTrackPosition("observability")!.index).toBe(5);
  });

  it("links the waypoint at the track head that actually exists on /catalog", () => {
    // catalog.astro renders `<h2 id={`track-${t.key}`}>` per track group.
    expect(atlasTrackPosition("docker")!.href).toBe("/catalog#track-platform");
  });

  it("every authored domain has a position, and it is inside its own bounds", () => {
    for (const slug of authored) {
      const p = atlasTrackPosition(slug);
      expect(p, `${slug} has no track position`).toBeTruthy();
      expect(p!.index).toBeGreaterThanOrEqual(1);
      expect(p!.index).toBeLessThanOrEqual(p!.total);
      expect(p!.total).toBeLessThanOrEqual(authored.length);
    }
  });

  it("counts only authored domains, so the denominator cannot inflate", () => {
    const total = TRACKS.reduce(
      (n, t) => n + t.domains.filter((s) => authored.includes(s)).length,
      0,
    );
    expect(total).toBe(authored.length);
  });

  it("returns null for an untracked slug rather than guessing", () => {
    expect(atlasTrackPosition("not-a-domain")).toBeNull();
  });
});

/**
 * "Every page ends in a NAMED route onward" is only true if this never returns
 * null and never returns the page you are already on.
 */
describe("atlasNextDomain", () => {
  const authored = getAuthoredDomains().map((d) => d.slug);

  it("continues inside the track when there is more of it", () => {
    const n = atlasNextDomain("docker")!;
    expect(n.slug).toBe("kubernetes");
    expect(n.sameTrack).toBe(true);
    expect(n.trackLabel).toBe("Platform & Ops");
    expect(n.index).toBe(2);
    expect(n.total).toBe(5);
  });

  it("hands off to the next track at the end of one, and says so", () => {
    // observability is last in Platform & Ops; Language & Runtime follows.
    const n = atlasNextDomain("observability")!;
    expect(n.sameTrack).toBe(false);
    expect(n.trackLabel).toBe("Language & Runtime");
    expect(n.slug).toBe("java-jvm");
    expect(n.index).toBe(1);
  });

  it("wraps at the very last domain, so no page is a dead end", () => {
    const lastTrack = TRACKS[TRACKS.length - 1];
    const last = lastTrack.domains[lastTrack.domains.length - 1];
    const n = atlasNextDomain(last)!;
    expect(n).toBeTruthy();
    expect(n.slug).toBe(TRACKS[0].domains[0]);
  });

  it("every authored domain routes onward to a DIFFERENT authored domain", () => {
    for (const slug of authored) {
      const n = atlasNextDomain(slug);
      expect(n, `${slug} is a dead end`).toBeTruthy();
      expect(n!.slug, `${slug} routes onward to itself`).not.toBe(slug);
      expect(authored, `${slug} routes onward to an unauthored domain`).toContain(n!.slug);
      expect(n!.index).toBeGreaterThanOrEqual(1);
      expect(n!.index).toBeLessThanOrEqual(n!.total);
    }
  });

  it("returns null for an untracked slug", () => {
    expect(atlasNextDomain("not-a-domain")).toBeNull();
  });
});
