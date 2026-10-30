// Merging several GROWIs' search answers into one list (design.md's
// `SearchFusion`, Requirements 3.2, 3.3, 3.8).
//
// **Not implemented as a plain interleave**, even though an interleave is what
// the result looks like in the ordinary case. design.md: 「単なる交互配置として
// 実装しない。`weight / (k + 順位)`（`k = 60`）の式のまま持つ」. The reason the
// distinction matters is Requirement 3.8: an operator who raises one GROWI's
// weight has to see that GROWI's pages move up, and an interleave has nowhere
// to put a weight. Keeping the score as an expression means 3.8 is a change of
// input, not a change of algorithm.
//
// Because each GROWI owns a disjoint set of documents, equal weights make
// every source's rank-1 item score identically, and a stable sort then lays
// them out exactly as an interleave would -- which is why the two agree in the
// common case without either being implemented in terms of the other.
//
// **The order is by fused score, not by relevance.** Nothing here can compare
// how well one GROWI's rank-3 matches the words against another's; only each
// GROWI knows that about its own corpus. design.md accepts this outright
// (「関連度順ではないことは受け入れる」).
//
// This module is pure and knows nothing about relations: `weight` arrives as a
// number, so reading `Relation.searchWeight` stays the caller's job and this
// file can be exercised without a database or a GROWI.

import type { SearchResultItem } from '@growi/chat';

export interface FusionSource {
  readonly relationId: string;
  readonly growiLabel: string;
  /** `Relation.searchWeight`, applied by the caller. */
  readonly weight: number;
  readonly items: ReadonlyArray<SearchResultItem>;
}

export interface FusedResult {
  readonly item: SearchResultItem;
  /** Requirement 3.3: every line says which GROWI it came from. */
  readonly relationId: string;
  readonly growiLabel: string;
  readonly score: number;
}

export interface FusionOptions {
  readonly k?: number;
  readonly limit?: number;
}

/**
 * The constant that decides how quickly the score falls off with rank. 60 is
 * the value design.md names. Kept module-private on purpose: a caller that
 * wanted a different fall-off passes `options.k`, and exporting the default
 * would put a second name for the same number into the layer's public surface.
 */
const DEFAULT_K = 60;

/**
 * `item.rank` is GROWI's own answer to "which position is this", carried as a
 * field of its own precisely so a consumer reads it (Requirement 3.9: 「順位・
 * パス・タイトル・URL・更新日時を個別に取り出せる形で返す」). Re-deriving the
 * rank from the array index would ignore the one field the contract added for
 * this purpose, and would silently disagree with GROWI whenever the two differ --
 * nothing in `parseCommandResponse` requires `items` to arrive in rank order.
 */
const scoreOf = (item: SearchResultItem, weight: number, k: number): number =>
  weight / (k + item.rank);

export const fuseResults = (
  sources: ReadonlyArray<FusionSource>,
  options?: FusionOptions,
): ReadonlyArray<FusedResult> => {
  const k = options?.k ?? DEFAULT_K;

  // Flattened source-major, then sorted. `Array.prototype.sort` is required to
  // be stable, so items that tie -- which is exactly what equal weights
  // produce for equal ranks -- keep this source order, and the result is
  // deterministic instead of depending on which GROWI answered first.
  const fused = sources
    .flatMap((source) =>
      source.items.map((item) => ({
        item,
        relationId: source.relationId,
        growiLabel: source.growiLabel,
        score: scoreOf(item, source.weight, k),
      })),
    )
    .sort((a, b) => b.score - a.score);

  // Cut AFTER merging: trimming per GROWI first would drop a heavily weighted
  // GROWI's fourth result in favour of a lightly weighted one's first.
  return options?.limit == null ? fused : fused.slice(0, options.limit);
};
