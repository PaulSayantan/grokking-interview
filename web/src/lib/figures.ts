/**
 * Per-row inventory figures for the marketing pages — isolated here so the
 * rounding policy is one line to flip after sign-off.
 *
 * Two rounding policies coexist deliberately, and they are NOT the same thing:
 *  - `ballparkText()` in index.astro rounds the page TOTALS (5,000-increments
 *    above 5k, so 28,064 -> "25,000+"). That is a headline figure.
 *  - `rowCount()` here rounds ONE ROW (two significant figures, so 6,611 ->
 *    "6,600+"). A row needs finer granularity or every big domain collapses to
 *    the same number.
 *
 * Deliberate asymmetry, accepted by the user: the 20 rows sum to more than the
 * hero's "25,000+", i.e. the headline under-promises and the inventory
 * over-delivers. That direction is the safe one.
 *
 * Import from "@lib/figures".
 */

/**
 * Floor to two significant figures (minimum step 10) so a per-row inventory
 * number never over-promises and never churns with an authoring session:
 *   6611 -> "6,600+"   1851 -> "1,800+"   456 -> "450+"   230 -> "230+"
 * Below 10 there is no rounding room left, so the exact value is used (matching
 * index.astro's long-standing `ballparkText()` behaviour); a non-positive or
 * non-finite input degrades to "0" rather than a nonsensical "0+".
 */
export function rowCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const v = Math.trunc(n);
  const mag = v < 10 ? 1 : v < 100 ? 10 : Math.pow(10, String(v).length - 2);
  return (Math.floor(v / mag) * mag).toLocaleString("en-US") + "+";
}

/**
 * The locked policy (index.astro's file header): every catalog number is a
 * rounded-DOWN ballpark, never an exact count. Flipping this to `true` prints
 * exact per-row counts instead — it needs user sign-off, so it stays `false`.
 */
export const EXACT_ROW_COUNTS = false;

/** The one function rows should call. Honours `EXACT_ROW_COUNTS`. */
export const fmtRow = (n: number): string =>
  EXACT_ROW_COUNTS ? n.toLocaleString("en-US") : rowCount(n);
