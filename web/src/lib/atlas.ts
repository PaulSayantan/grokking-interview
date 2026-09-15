/**
 * The `.atl` foundation's build-time half: one channel colour per page.
 *
 * atlas states one channel per surface (CONTRACT.md §13). The colour reaches
 * every primitive as a single custom property, `--atl-ch`, exactly the way
 * `--ins-ch` reaches the marketing components — so every recipe stays
 * accent-agnostic and none of them names a hex.
 *
 * THE ONE TRANSLATION THIS FILE EXISTS FOR. `@lib/channels` gives the Design
 * track the token `var(--ins-brand)`, which resolves ONLY inside a `.ins`
 * wrapper. Used verbatim on a `.atl` page it resolves to nothing, and an empty
 * `--atl-ch` silently paints the channel marks transparent — a whole
 * orientation device gone, with no error anywhere. `atlasChannel()` maps that
 * one token onto `--atl-brand`, which the foundation declares in both themes.
 *
 * Import from "@lib/atlas". Build-time only: nothing here ships to the client.
 */
import { TRACKS, trackFor } from "./channels";
import { getAuthoredDomains } from "./catalog";

/** The `--ins-*`-scoped tokens in `@lib/channels`, and their `.atl` equivalents. */
const SCOPED: Record<string, string> = {
  "var(--ins-brand)": "var(--atl-brand)",
};

/**
 * The fallback when a domain is in no track. `--topic-accent` is what the study
 * page already sets per group; `--color-primary` is global.css's own default.
 * Both are always resolvable, so `--atl-ch` can never end up empty.
 */
export const ATLAS_CHANNEL_FALLBACK = "var(--topic-accent, var(--color-primary))";

/**
 * A CSS value for `--atl-ch` that is guaranteed to resolve inside `.atl`.
 * Always a `var(--…)` reference, never a hex, so the light theme's deepened
 * accents apply automatically.
 */
export function atlasChannel(domainSlug: string): string {
  const token = trackFor(domainSlug)?.token;
  if (!token) return ATLAS_CHANNEL_FALLBACK;
  return SCOPED[token] ?? token;
}

/**
 * The inline `style` value for a `.atl` page wrapper. Kept here rather than
 * template-interpolated per page so all three surfaces set the channel the
 * same way and a future token addition lands in one place.
 */
export function atlasChannelStyle(domainSlug: string): string {
  return `--atl-ch: ${atlasChannel(domainSlug)};`;
}

/**
 * The track's plain-English name, or null. atlas never conveys a distinction by
 * colour alone — the channel always appears beside its name in words — so the
 * label is part of the same lookup rather than a second import at each call
 * site.
 */
export function atlasChannelLabel(domainSlug: string): string | null {
  return trackFor(domainSlug)?.label ?? null;
}

/**
 * WHERE THIS DOMAIN SITS, stated as a place rather than a percentage.
 *
 * The position is taken WITHIN THE TRACK, not across all twenty domains, for
 * one reason: `TRACKS[].domains` is an editorially ordered list ("Domain slugs,
 * in display order") whereas the catalog's own domain order is the order sync
 * happened to emit. "Domain 01 of 05 · Platform & Ops" is therefore a true
 * statement about a sequence somebody designed; "domain 12 of 20" would be a
 * true statement about an accident.
 *
 * `total` counts only AUTHORED domains, so a track that later lists a
 * coming-soon slug cannot inflate the denominator behind a reader's back.
 */
export interface AtlasTrackPosition {
  /** 1-based position among the track's authored domains. */
  index: number;
  total: number;
  /** The track's plain-English name. */
  label: string;
  /** Anchor for the track head on `/catalog`. */
  href: string;
}

export function atlasTrackPosition(domainSlug: string): AtlasTrackPosition | null {
  const track = trackFor(domainSlug);
  if (!track) return null;
  const authored = new Set(getAuthoredDomains().map((d) => d.slug));
  const domains = track.domains.filter((s) => authored.has(s));
  const index = domains.indexOf(domainSlug);
  if (index < 0) return null;
  return {
    index: index + 1,
    total: domains.length,
    label: track.label,
    href: `/catalog#track-${track.key}`,
  };
}

/**
 * The NAMED route out of a domain page — atlas's rule that every page ends in a
 * destination with a name, never a bare "back to top".
 *
 * The next authored domain in the same track; at the end of a track, the first
 * authored domain of the NEXT track (wrapping at the last), which is why
 * `sameTrack` is reported rather than inferred — the card has to say "Next in
 * Platform & Ops" or "New track · Language & Runtime" and those are different
 * sentences. Returns null only if the corpus has exactly one authored domain.
 */
export interface AtlasNextDomain {
  slug: string;
  /** Is this still the same track the reader is on? */
  sameTrack: boolean;
  /** The destination's track name. */
  trackLabel: string;
  /** 1-based position of the destination within its own track. */
  index: number;
  total: number;
}

export function atlasNextDomain(domainSlug: string): AtlasNextDomain | null {
  const authored = new Set(getAuthoredDomains().map((d) => d.slug));
  const tracks = TRACKS.map((t) => ({
    track: t,
    domains: t.domains.filter((s) => authored.has(s)),
  })).filter((t) => t.domains.length > 0);

  const at = tracks.findIndex((t) => t.domains.includes(domainSlug));
  if (at < 0) return null;

  const here = tracks[at];
  const i = here.domains.indexOf(domainSlug);

  // Still inside this track: the very next leg of the same journey.
  if (i + 1 < here.domains.length) {
    return {
      slug: here.domains[i + 1],
      sameTrack: true,
      trackLabel: here.track.label,
      index: i + 2,
      total: here.domains.length,
    };
  }

  // End of the track: hand off to the next one, wrapping so the last domain of
  // the last track still has somewhere to go.
  const next = tracks[(at + 1) % tracks.length];
  if (next.domains[0] === domainSlug) return null; // a one-domain corpus
  return {
    slug: next.domains[0],
    sameTrack: next.track.key === here.track.key,
    trackLabel: next.track.label,
    index: 1,
    total: next.domains.length,
  };
}
