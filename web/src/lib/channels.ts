/**
 * The seven tracks ("channels") that group the 20 authored domains on the two
 * marketing pages. Build-time only — nothing here ships to the client.
 *
 * Why seven and not twenty: twenty domains mapped to twenty colours is noise;
 * twenty mapped to seven tracks is information. The grouping is the editorial
 * spine of `04 / The library` on `/` and of the `/catalog` grid.
 *
 * TOKEN DISCIPLINE (see CONTRACT.md §12): `token` is ALWAYS a `var(--…)`
 * reference and NEVER a hex literal, so the light theme's deepened accent
 * values apply automatically — `--accent-amber` is #F59E0B in dark but #9a6700
 * in light, and only the token form picks that up. The six accents used here are
 * exactly the six that have verified `[data-theme="light"]` overrides;
 * `--accent-orange/-purple/-red/-pink` have none and are deliberately avoided.
 * `--ins-brand` resolves only inside a `.ins` wrapper, which is where these
 * values are consumed.
 *
 * A channel colour is only ever a thin rule / tick / bar fill — never a
 * background wash and never behind text — so no text contrast depends on it,
 * and every row also carries its full name in words (nothing is conveyed by
 * colour alone).
 *
 * Import from "@lib/channels".
 */
import { getAuthoredDomains } from "./catalog";

export interface Track {
  /** Internal id only — never rendered. */
  key: string;
  /** Rendered: plain words. No "CH-01" style codes. */
  label: string;
  /** One short sentence. Replaces the truncated blurb column. */
  blurb: string;
  /** A CSS custom-property reference, e.g. "var(--accent-green)". Never a hex. */
  token: string;
  /** Domain slugs, in display order. */
  domains: string[];
}

export const TRACKS: Track[] = [
  {
    key: "design",
    label: "Design",
    token: "var(--ins-brand)",
    blurb: "Architecture, trade-offs and the whiteboard round.",
    domains: ["system-design", "lld-and-ood", "system-design-case-studies"],
  },
  {
    key: "frameworks",
    label: "Frameworks",
    token: "var(--accent-green)",
    blurb: "The Spring and JPA stack, end to end.",
    domains: ["spring-boot", "spring-core", "hibernate-jpa"],
  },
  {
    key: "interfaces",
    label: "Interfaces",
    token: "var(--accent-teal)",
    blurb: "How services talk — HTTP, gRPC, the wire.",
    domains: ["rest-api-design", "grpc", "networking"],
  },
  {
    key: "platform",
    label: "Platform & Ops",
    token: "var(--accent-amber)",
    blurb: "Ship it, run it, keep it up.",
    domains: [
      "docker",
      "kubernetes",
      "devops-cicd",
      "reliability-ops",
      "observability",
    ],
  },
  {
    key: "runtime",
    label: "Language & Runtime",
    token: "var(--accent-blue)",
    blurb: "The JVM, and the code you write on it.",
    domains: ["java-jvm", "dsa-coding"],
  },
  {
    key: "assurance",
    label: "Assurance",
    token: "var(--accent-rose)",
    blurb: "Proving it works, and proving it's safe.",
    domains: ["testing", "security"],
  },
  {
    key: "craft",
    label: "Craft & Data",
    token: "var(--accent-violet)",
    blurb: "Storage, queues, and the human round.",
    domains: ["interview-craft", "messaging-databases"],
  },
];

/** The track a domain belongs to, or undefined if it is unmapped. */
export function trackFor(slug: string): Track | undefined {
  return TRACKS.find((t) => t.domains.includes(slug));
}

/**
 * Every problem with the mapping, as human-readable strings. Pure so it can be
 * unit-tested in both directions; `assertTrackCoverage()` is the throwing form.
 *
 * Catches all three ways the mapping can rot:
 *  - a newly authored domain nobody added to a track (it would silently vanish
 *    from the index),
 *  - a slug listed in two tracks (it would render twice),
 *  - a slug in a track that no longer exists in the catalog (a typo or a rename).
 */
export function trackCoverageErrors(authoredSlugs: string[]): string[] {
  const errors: string[] = [];
  const known = new Set(authoredSlugs);

  const unmapped = authoredSlugs.filter((s) => !trackFor(s));
  if (unmapped.length) {
    errors.push(`channels.ts is missing: ${unmapped.join(", ")}`);
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  const unknown: string[] = [];
  for (const t of TRACKS) {
    for (const s of t.domains) {
      if (seen.has(s)) dupes.add(s);
      seen.add(s);
      if (!known.has(s)) unknown.push(`${s} (in "${t.key}")`);
    }
  }
  if (dupes.size) {
    errors.push(`channels.ts lists twice: ${[...dupes].join(", ")}`);
  }
  if (unknown.length) {
    errors.push(`channels.ts references unknown domains: ${unknown.join(", ")}`);
  }

  return errors;
}

/**
 * Build-time completeness gate. Throws — so an authoring session that adds a
 * 21st domain fails the build with a precise message instead of quietly
 * dropping it out of the library index.
 */
export function assertTrackCoverage(authoredSlugs: string[]): void {
  const errors = trackCoverageErrors(authoredSlugs);
  if (errors.length) throw new Error(errors.join("; "));
}

// Self-check, evaluated the moment any page imports this module, so the gate
// cannot be forgotten by a future consumer. Build-time only.
assertTrackCoverage(getAuthoredDomains().map((d) => d.slug));
