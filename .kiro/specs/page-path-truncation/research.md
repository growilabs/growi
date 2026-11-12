# Research & Design Decisions: page-path-truncation

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.
---

## Summary
- **Feature**: `page-path-truncation`
- **Discovery Scope**: Extension (existing system) — light discovery
- **Key Findings**:
  - The two "Research Needed" bridging problems identified during gap analysis (backward `LinkedPagePath` vs. forward `formatTruncatedPagePath` array; highlight-segment-boundary assumption) both resolve cleanly because `formatTruncatedPagePath`'s truncated layout is structurally fixed: it is always either "all ancestors" or exactly "first ancestor + ellipsis + last ancestor (parent)". No index-matching by text is needed.
  - The existing `PageListItemL` row already separates the ancestor breadcrumb (row 1, via `PagePathHierarchicalLink`) from the page name (row 2, a separate `<Clamp>`-wrapped H5 link). The new truncation behavior is scoped to row 1 only; row 2 is unaffected in structure, but its `DevidedPagePath` split point shifts when `evalDatePath` is unified (Requirement 7), which changes its displayed text for date-suffixed paths — this is the accepted, in-scope side effect Requirement 7.2 names.
  - `PageList.tsx` and `IdenticalPathPage.tsx` pass no path-truncation-related props to `PageListItemL` today, so a new prop defaulting to the current behavior leaves both untouched (confirmed by reading both call sites).

## Research Log

### Extension Point Analysis: where does the new behavior plug in?
- **Context**: Requirement 8 requires the change to be opt-in so only `/_search` is affected.
- **Sources Consulted**: `apps/app/src/client/components/PageList/PageListItemL.tsx`, `PageList.tsx`, `apps/app/src/client/components/IdenticalPathPage.tsx`, `apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx`.
- **Findings**: `PageListItemL` is the sole renderer of the ancestor breadcrumb (via `PagePathHierarchicalLink`, fed `pageData.path`'s "former" segment) across all three consumers. Only `SearchResultList.tsx` is exclusive to `/_search`.
- **Implications**: A new boolean prop on `PageListItemL`, read only by `SearchResultList.tsx`, is the minimal opt-in seam. `PagePathHierarchicalLink.tsx` itself stays untouched — the new component lives beside it, not inside it.

### Bridging backward `LinkedPagePath` with forward truncation output
- **Context**: Gap analysis Research-Needed item 1 — `LinkedPagePath.parent` walks leaf→root; `formatTruncatedPagePath`'s `parts` array is root→leaf.
- **Findings**: `formatTruncatedPagePath`'s truncation decision has exactly two shapes:
  1. units ≤ 3 → every ancestor segment appears, in root→leaf order.
  2. units ≥ 4 → exactly `ancestors[0]` (first), an ellipsis, `ancestors[length-1]` (parent), then the page name.
  There is never a partial/sliding-window case. This means the surviving ancestor *positions* are always either "all of them" or "the first and the last" — no text-based matching against the ancestors array is required.
- **Implications**: A small pure helper can flatten a `LinkedPagePath` chain into a root→leaf array once (`toRootFirstChain`), and the renderer picks index `0` and index `length - 1` directly for the truncated case, or the whole array for the untruncated case. This removes the need for any generic index-mapping abstraction.

### Highlight-segment-boundary assumption
- **Context**: Gap analysis Research-Needed item 2 — does `highlightedPath`'s `<em>` markup ever change where `/` segment boundaries fall relative to the plain path?
- **Findings**: `DevidedPagePath`'s `PATTERN_DEFAULT` regex already special-cases a `/` immediately following `</em>` so it is not misread as a segment boundary (`PagePathHierarchicalLink` already depends on this for its own dual-tree walk). Elasticsearch highlighting wraps only matched substrings *within* a path segment (segment text never contains a literal `/`), so segment count parity between the plain and highlighted chains holds for all realistic inputs.
- **Correction (PR #11743 review)**: The Findings above do not hold for the date-bundling regex (`evalDatePath`), which can match the `/` of `</em>` (e.g. `/<em>daily</em>/2024/01/02`) and shift the split. Highlights are therefore matched to plain-path segments by text instead (design.md), and the Implications below are superseded.
- **Implications**: Build the plain and highlighted `LinkedPagePath` chains in parallel (mirroring `PagePathHierarchicalLink`'s existing dual-tree pattern) and zip them by index. As a defensive fallback (not expected to trigger in practice, but cheap to guard), if the two chains ever differ in length, fall back to rendering the plain (non-highlighted) text for that ancestor rather than risking a misaligned zip or a crash.

### Row 1 (ancestor breadcrumb) vs. Row 2 (page name) scope
- **Context**: Requirement 1's acceptance criteria describe the truncated format as "first + ellipsis + parent + page name" — the Project Description's scope list (item 2), however, only asks for a new component that keeps ancestor-segment links, maps highlight markup for surviving ancestor segments, and adds a hover tooltip. It does not ask to change how the page name itself is rendered.
- **Findings**: `PageListItemL` already renders the page name in a structurally separate row (own `<Clamp lines={1}>` + H5 link, next to `UserPicture` and `PageListMeta`), which already guarantees single-line, non-overflowing page-name display. Folding the page name into row 1's markup would duplicate it visually and would require rebuilding the existing title row, which is out of the stated scope (Non-Goals: "検索クエリ挙動・データ取得ロジックの変更は対象外" plus the explicit two-bullet scope for the new component).
- **Selected Approach**: The unit-counting algorithm (ancestors + page name) from `formatTruncatedPagePath` is reused as-is to decide *whether/how much* to collapse the ancestor row, but the page-name segment it returns is dropped before rendering row 1. The hover tooltip (Requirement 4) still exposes the complete path *including* the page name via `fullPath`, so the full hierarchy remains discoverable even though the page name is not duplicated into row 1's text.
- **Rationale**: Matches the Project Description's explicit two-bullet scope for the new component, avoids an unrequested redesign of the title row, and keeps Requirement 9 (non-destructive of unrelated row elements) easy to satisfy.
- **Trade-off**: Requirement 1's literal wording ("...ページ名の形式で表示") is satisfied at the level of the row *pair* (breadcrumb ends at parent, title row shows the page name immediately below) rather than within a single DOM node.
- **Confirmed during `/kiro-validate-design`**: Presented both options (2-row split vs. folding the page name into row 1, which would duplicate it against the existing title row and require restructuring row 2) to the user with a concrete before/after example. User selected the 2-row split (this decision) explicitly. No further action needed on this point.

### Root-icon duplication vs. extraction
- **Context**: `PagePathHierarchicalLink`'s root case (home icon / trash icon + link) must still render identically when a search result has zero ancestors, but the Project Description frames `PagePathHierarchicalLink` as an unmodified, pre-existing component.
- **Alternatives Considered**:
  1. Extract the root-icon JSX into a small shared sub-component imported by both `PagePathHierarchicalLink` and the new component.
  2. Duplicate the ~15-line root-icon JSX block into the new component.
- **Selected Approach**: Option 2 (duplicate).
- **Rationale**: The block is small, has no independent behavior to unit-test beyond what `PagePathHierarchicalLink`'s existing tests already cover, and avoids touching a component the spec explicitly treats as stable/unmodified. Per the Simplification lens, introducing a shared abstraction for two call sites of a ~15-line static block is not justified.
- **Follow-up (revised after PR #11743 review)**: The copy drifted (it lost the `/` after the icon). Replaced by rendering `PagePathHierarchicalLink` itself with the root node, which reuses it without modifying it.
- **Trade-off**: If the icon block changes in the future, both places need updating. Acceptable given its size and low change frequency (it hasn't changed across the `search-modal-path-truncation` effort).

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Extend `PageListItemL` only | Branch inside `PageListItemL` between old/new rendering, no new component | Fewest new files | Adds a conditional to an already 380-line file; mixes concerns | Rejected: violates file cohesion guidance |
| B: New component only | New component, but no opt-in seam in `PageListItemL` | Clean separation | Every `PageListItemL` consumer would need its own call-site branching, duplicating the wiring 3x | Rejected: pushes the decision to the wrong layer |
| C: Hybrid (selected) | Opt-in prop on `PageListItemL` (Option A's seam) + dedicated new component for the ancestor row (Option B's separation) | Existing consumers (`PageList.tsx`, `IdenticalPathPage.tsx`) stay untouched; new logic is isolated and independently testable | One prop threading point to keep in sync | Matches gap-analysis recommendation |

## Design Decisions

### Decision: Track the "page path truncation" theme via `roadmap.md`, not a merged spec
- **Context**: `search-modal-path-truncation` (#141445, shipped), this spec (#188233/#188237), and at least one more future surface (`PagePathNav`/`PagePathHeader`/`PagePathNavSticky`, and possibly `RecentChangesSubstance`) all implement the same underlying truncation behavior. Reviewer feedback raised the concern that three-plus independent, uncoordinated specs for one theme is too fragmented, while also confirming that per-surface components should stay separate (different rendering needs).
- **Alternatives Considered**:
  1. Merge all surfaces into one spec (rejected earlier in this document — mixes independent responsibility boundaries, risks an oversized `design.md`, couples unrelated approval/task gates).
  2. Leave the specs fully independent with no cross-reference, relying on each new spec's author to rediscover the shared logic.
  3. Add a `roadmap.md` (matching the project's existing convention, e.g. `bulk-export-pdf-rendering/roadmap.md`, `search-filters/roadmap.md`) that names the phases, their dependency order, and the shared seams to watch, without merging their requirements/design/tasks lifecycles.
- **Selected Approach**: Option 3 — `roadmap.md` added to this spec's directory, phasing `search-modal-path-truncation` (done) → `page-path-truncation` (this spec) → `page-path-truncation-navigation` (future, working name, brief created just-in-time).
- **Rationale**: Matches actual project convention (not the possibly-stale `.kiro/steering/roadmap.md` location described in the `kiro-discovery` skill doc — this repo's real precedent keeps per-initiative roadmaps inside the current/anchor spec's own directory). Gives the theme a single place to look up phase status and shared-contract seams, without forcing unrelated approval gates together.
- **Trade-off**: The roadmap needs to be kept in sync manually (no tooling parses it automatically the way `/kiro-spec-batch` parses `.kiro/steering/roadmap.md`); acceptable since this is a 3-phase, human-paced initiative, not a batch-generated one.

### Decision: Relocate `formatTruncatedPagePath` without changing its contract
- **Context**: Requirement scope item 1 — move to a shared location, behavior unchanged.
- **Alternatives Considered**:
  1. Copy the function into a new shared module and keep the original as a re-export (compatibility shim).
  2. Move the file outright and update the single existing import site.
- **Selected Approach**: Option 2 — move `apps/app/src/features/search/client/utils/format-truncated-page-path.ts` (and its spec) to `apps/app/src/client/util/format-truncated-page-path.ts`, matching the existing flat `src/client/util/*.ts` + co-located `*.spec.ts` convention (e.g. `mongo-id.ts`). Update the one existing import in `SearchResultPagePath.tsx`.
- **Rationale**: There is exactly one existing consumer, so a compatibility shim would be pure indirection with no migration benefit (Simplification lens; also project guidance disfavors re-export shims for "removed" locations).
- **Trade-off**: None material — a single import line changes.

### Decision: New pure function to bridge truncation decision with linked/highlighted ancestor chains
- **Context**: The new ancestor-row component needs both *what to show* (from `formatTruncatedPagePath`) and *how to link/highlight it* (from `LinkedPagePath`).
- **Selected Approach**: A new pure function, `buildAncestorPathNodes(path, highlightedPath)`, internally calls `formatTruncatedPagePath(path)`, drops the trailing page-name part, builds the plain and highlighted `LinkedPagePath` chains via `toRootFirstChain`, and returns an ordered, React-agnostic list of `{ type: 'link', href, text, highlightedHtml? } | { type: 'ellipsis' }` plus `fullPath` and a `hasAncestors` flag (for the root-icon-only case). The rendering component only maps this list to JSX.
- **Rationale**: Follows the Pure Function Extraction principle — the non-trivial bridging logic becomes independently unit-testable (root case, short path, truncated path, highlight mapping, mismatched-length fallback) without React Testing Library.
- **Trade-off**: One more file, justified by testability.
- **Follow-up (revised after user review)**: Placed in `client/util/` (not `features/search/`), not `features/search`-scoped, because the bridging problem it solves (truncation decision ⇔ `LinkedPagePath` backward chain) is not specific to search — the requirements' own Non-Goals name `PagePathNav`/`PagePathHeader`/`PagePathNavSticky`/`RecentChangesSubstance` as deferred future consumers of the exact same truncation-with-links need. `highlightedPath` is an optional parameter so a future highlight-less caller can use the same function unmodified. Only the call site (this spec's `SearchResultAncestorPath`) stays scoped to search results — no other consumer is wired up in this spec. See the new `page-path-truncation-navigation` roadmap entry in `roadmap.md`.

### Decision: Opt-in prop name and default
- **Context**: Requirement 8 — non-search consumers of `PageListItemL` must be unaffected by default.
- **Selected Approach**: Add `isPathTruncationEnabled?: boolean` to `PageListItemL`'s `Props`, defaulting to `false` when omitted. Only `SearchResultList.tsx` passes `true`. When `true`, `PageListItemL` also switches `evalDatePath` to `true` for the `DevidedPagePath` calls that back both the ancestor row and the existing page-name row (Requirement 7's unification applies to both, since they are two views over the same former/latter split).
- **Rationale**: A single flag keeps the two Requirement-7-driven behavior changes (breadcrumb truncation, date-bundled page name) consistently gated together, matching "opt-in wholesale for `/_search`" rather than introducing two independently-toggleable flags nothing in requirements asks for.
- **Follow-up (revised after PR #11743 review)**: The boolean became a render prop, `renderTruncatedAncestorPath`. The flag forced the shared `PageListItemL` to import `features/search`, inverting the dependency direction. The prop is still the single opt-in switch.

## Risks & Mitigations
- **Risk**: The row-1/row-2 scope reading (see Research Log) turns out not to match reviewer intent. — **Mitigation**: Called out explicitly in `design.md` boundary section for confirmation before/at `/kiro-validate-design`.
- **Risk**: CSS `flex-shrink` priorities tuned for the modal's compact row (`SearchResultPagePath.module.scss`) do not directly transfer to `PageListItemL`'s wider, differently-composed row (checkbox + icon + "last update" sibling). — **Mitigation**: New, independent `.module.scss` for the new component; verified visually against the `/_search` page during implementation, not assumed from the modal's CSS.
- **Risk**: Highlighted/plain `LinkedPagePath` chain length mismatch (extremely unlikely per the highlight-boundary research, but not provably impossible for all ES outputs). — **Mitigation**: `buildAncestorPathNodes` falls back to plain text for the **entire** ancestor path (not per-node) when the two chains' total lengths differ, since a length mismatch gives no reliable way to know which index caused the drift — a partial/per-node fallback would risk silently misaligning the remaining nodes. (Corrected during `/kiro-validate-design`: the initial research/design wording said "fall back for that node," which implied a per-node granularity that isn't actually safe.) **Superseded (PR #11743 review)**: each segment is now verified by text, so falling back only for the segments that fail the check no longer risks misalignment.
- **Effort**: M (3–7 days) — unchanged from gap analysis; the bridging risk that drove this estimate is now resolved to a small, well-scoped pure function rather than an open design question.

## References
- `.kiro/specs/page-path-truncation/roadmap.md` — phased plan for the "page path truncation" theme across search modal / search results / future nav surfaces.
- `.kiro/specs/search-modal-path-truncation/design.md` — prior spec this one extends; source of `formatTruncatedPagePath` and its unit-counting algorithm.
- `packages/core/src/models/devided-page-path.ts` — `DevidedPagePath`, including the `evalDatePath` date-bundling rule and the `<em>`-aware segment regex.
- `apps/app/src/models/linked-page-path.ts` — `LinkedPagePath`, the backward-linked ancestor chain model reused (not modified) by the new component.

---

# Gap Analysis: 省略表記の統一（改訂 Requirement 1〜3、2026-11-12）

## 分析サマリ
- 改訂要件の中心は「実際の表示幅に収まるかどうかで、祖先セグメントの畳み込み段階を決める」こと。現行コードは判断ロジック・描画ともに DOM 計測を一切行わない前提で作られており、ここが最大のギャップ。
- 判断ロジック（`formatTruncatedPagePath`）とハイライト・リンクの橋渡し（`buildAncestorPathNodes`）は、「省略記号は高々 1 個」という不変条件を持つ。改訂後の段階（`先頭/…/親` → `…/親` → `…`）もすべて省略記号 1 個に収まるため、この不変条件と対応付けの仕組みはそのまま使える。
- 共通 CSS（`_truncated-path-row.scss`）は祖先セグメントを `flex-shrink: 100` と `min-width: 0` で幅 0 まで縮める設計で、要件 3.4・3.5 と正面から矛盾する。祖先セグメントは縮めない形に変える必要がある。
- 計測には、既存依存の `usehooks-ts`（2.16.0）の `useResizeObserver` が使える。新しいライブラリは不要。
- `/_search` は 1 ページ最大 200 行あり、行ごとの計測コストと jsdom（レイアウトなし・ResizeObserver なし）でのテスト方法が設計上の主要論点。

## 1. 現状
| 資産 | 場所 | 改訂要件との関係 |
|---|---|---|
| `formatTruncatedPagePath` | `apps/app/src/client/util/format-truncated-page-path.ts` | 表示単位数だけで基本形を決める純粋関数。幅に応じた段階（要件 3.2）を表す入力・出力が無い |
| `buildAncestorPathNodes` | `apps/app/src/client/util/build-ancestor-path-nodes.ts` | 省略記号の前は先頭から、後ろは末尾から数えて元の階層に対応付ける。省略記号 1 個の形なら段階が変わっても成り立つ |
| `SearchResultPagePath` | `features/search/client/components/` | 検索モーダル用。ページ名を含む 1 行 |
| `SearchResultAncestorPath` | 同上 | `/_search` 用。祖先のみ（ページ名は別行）。リンク・ハイライト付き、`memo` 化済み |
| 共通 CSS | `_truncated-path-row.scss`、`truncated-path-row-classes.ts` | 祖先・ページ名とも `text-truncate` と `flex-shrink: 100; min-width: 0`。区切りと省略記号は縮めない |
| 計測ユーティリティ | `usehooks-ts` 2.16.0（`useResizeObserver`、`useIsomorphicLayoutEffect`） | `useIsomorphicLayoutEffect` は app 内で使用実績あり。`useResizeObserver` は未使用 |

## 2. 要件ごとのギャップ
| 要件 | 状態 | ギャップ |
|---|---|---|
| 1.1–1.3 基本形 | 実装済み | 変更なし |
| 2.1–2.2 短いパス | 実装済み | 基本形としては変更なし（畳むのは 3.2 の段階で行う） |
| 3.2 先頭側から段階的に畳む | Missing | 段階を表すデータ表現と、段階を選ぶ仕組みが無い |
| 3.3 連続する省略記号をまとめる | 実質充足 | 段階の作り方を「先頭側から連続して畳む」にすれば、省略記号は常に 1 個になる |
| 3.4 / 3.5 祖先を文字単位で切らない・`//` を出さない | Constraint | 共通 CSS が祖先を幅 0 まで縮める。祖先は縮めず、溢れは段階の切り替えで解消する形に変える |
| 3.6 ページ名のみ文字単位で切る | 部分的 | モーダルのページ名は既に `text-truncate`。祖先を縮めなくなった後も、ページ名だけが縮む構成を確認する必要がある |
| 3.7 幅の変化で判定し直す | Missing | リサイズの検知が無い |
| 3.8 幅を超えない | 部分的 | 段階の判定が終わる前（初回描画・リサイズ直後）にも溢れを見せない仕組みが必要 |
| 3.9 両画面で同じ規則 | 部分的 | 判断ロジックは共有済み。段階の選び方も共有する必要がある |
| 4.1 ツールチップ | 実装済み | 常に `title` を付けているので変更不要 |
| 5 / 6 リンク・ハイライト | 実装済み | 段階が変わっても、残った祖先は従来通りリンク・ハイライトを保つ（対応付けの仕組みで成立） |

## 3. 実装アプローチの選択肢

### 段階の表現
- **A-1: `formatTruncatedPagePath` に「畳む段階」の引数を足す** — 変更箇所は少ない。既存の呼び出し側は段階 0 として今の動きを保てる。
- **A-2: 基本形から最大まで畳んだ形までの「段階の一覧」を返す純粋関数を新しく作る** — 描画側は一覧から 1 つ選ぶだけになる。段階の生成と選択を分けてテストできる。

### 収まるかどうかの判定（Research Needed）
- **M-1: 描画してから溢れを確認し、1 段ずつ進める** — `useLayoutEffect` 内で `scrollWidth > clientWidth` を確認し、溢れていれば次の段階で描画し直す。描画前に確定するのでちらつきは出にくい。実装は単純だが、行ごとに最大で数回描画し直す。幅が広がったときは段階 0 からやり直す必要がある。
- **M-2: 各セグメントの自然な幅を一度測り、計算で段階を決める** — 描画し直しは 1 回で済む。ただし計測用の要素（非表示の複製など）が必要で、ハイライト HTML を含む描画を二重に持つことになる。
- どちらも、判定部分を「幅の数値を受け取って段階を返す純粋関数」に切り出せば、jsdom でもテストできる。

### 描画・CSS
- 2 つのコンポーネントは別のまま（表現するものが異なるため。roadmap の方針どおり）とし、段階を選ぶ仕組み（フック）と CSS は共有する。
- 祖先セグメントは縮めない（`flex-shrink: 0`・文字単位の省略なし）。モーダルではページ名だけが縮む。行全体の `overflow: hidden` は、判定が終わる前の保険として残す。

### 推奨の方向性（design で確定）
段階の一覧を返す純粋関数（A-2）と、計測して段階を選ぶ薄いフックを共通の場所に置き、両コンポーネントがそれを使う構成。コーディング規約の「純粋関数を切り出し、フレームワーク側は薄いアダプタにする」に沿う。収まるかどうかの判定方式（M-1 / M-2）は、下記の調査事項を踏まえて design で決める。

## 4. Research Needed（design で確定する事項）
1. **計測方式**: M-1 と M-2 のどちらにするか。`/_search` の最大 200 行での描画し直しの回数と体感性能を確認する。
2. **ResizeObserver の数**: 行ごとに監視するか、一覧（またはモーダル）の幅を 1 回監視して全行で共有するか。全行が同じ幅になる前提が `/_search` で成り立つか（チェックボックス・アイコン・最終更新日などの兄弟要素の幅）。
3. **Web フォントの読み込み**: フォント読み込み後に文字幅が変わっても、コンテナの幅は変わらないため ResizeObserver は発火しない。`document.fonts.ready` などで判定し直す必要があるか。
4. **初回描画**: 判定前の描画（SSR を含む）で溢れや段階の飛びが見えないか。モーダルはクライアントのみで描画、`/_search` の結果もクライアント側の取得だが要確認。
5. **テスト**: jsdom には ResizeObserver もレイアウトも無い。判定の純粋関数の単体テストと、フックのモック方針（`essential-test-patterns` に従う）。
6. **ページ名の切り詰め（3.6）と省略記号の区別（1.3）**: ページ名を切り詰めたときの「…」と、祖先を畳んだ「…」が見分けられるか（区切り `/` で囲まれた独立要素かどうかで区別できる想定）。

## 5. 工数・リスク
- **Effort**: M（3〜7 日）— 判断ロジックは小さな拡張だが、計測フック・共通 CSS の組み替え・2 コンポーネントの改修・レイアウト依存のテスト方針が加わる。
- **Risk**: Medium — 既存の仕組みにない DOM 計測を導入する。実績のあるライブラリ（`usehooks-ts`）で賄え、範囲も検索モーダルと `/_search` の 2 か所に閉じているが、性能（最大 200 行）とフォント読み込みのタイミングは実機での確認が必要。

## Design Decisions（改訂: 省略表記の統一、2026-11-12）

### 段階の表現: `formatTruncatedPagePath` に `collapseLevel` 引数を追加（新関数は作らない）
- **Why**: 段階 0 が既存の基本形そのものなので、既存の関数を一般化すれば既存の呼び出しは無変更で済む。「段階の一覧を返す関数」を別に作る案（gap 分析の A-2）は、呼び出し側が 1 段階しか使わないため不要な層になる（Simplification）。
- 段階を上げるごとに先頭側から祖先を 1 つ畳む定義にしたことで、省略記号は常に 1 個・後ろの祖先は末尾と一致する。`buildAncestorPathNodes` の対応付け（前は先頭から、後ろは末尾から数える）を変えずに使える。

### 収まるかの判定: 描画してから溢れを確認し 1 段ずつ上げる（gap 分析の M-1）
- **Why**: 段階は最大 2 なので描画し直しは最大 2 回で、layout effect 内で終わるため途中の段階は表示されない。各セグメントの幅を事前に測る案（M-2）は、畳まれて描画されない祖先の幅を測るための複製 DOM（ハイライト HTML を含む）が必要になり、見合わない。
- 「収まらない」はコンテナの溢れとページ名の溢れの 2 か所だけで判定する。祖先を縮めない CSS にしたことで、祖先が収まらなければ必ずどちらかが溢れる。

### 幅の監視: `usehooks-ts` の `useResizeObserver` を行ごとに使う（Build vs Adopt: Adopt）
- 既存依存で、ResizeObserver の無い環境（jsdom・SSR）では何もしないため、既存テストへの影響がない。
- 一覧の幅を 1 回だけ測って全行で共有する案は、行ごとにチェックボックス・アイコン等の兄弟要素で使える幅が変わりうるため採らなかった。ResizeObserver 自体は 200 件程度の監視なら軽い。
- 幅が広がったときだけ段階 0 からやり直す。縮小中に毎回段階 0 へ戻すと、ドラッグ中にちらつくため。ResizeObserver の通知は描画のタイミングと揃わないことがあり、広がった直後に 1 フレームだけ基本形が `overflow: hidden` で切れて見える可能性があるが、`//` にはならないので許容する。

### Web フォントの読み込み: 対策しない
- フォント読み込みで文字幅が変わってもコンテナ幅は変わらず、判定し直されない。ただし行の `overflow: hidden` で横幅は超えず、祖先は縮まないので `//` も出ない。検索モーダル・`/_search` の結果はページ読み込み後に表示されるので、通常はフォント読み込み済み。発生しても次のリサイズまで畳み方が最適でないだけなので、`document.fonts` の監視は入れない（Simplification）。

### フックの置き場所: `features/search/client/hooks/`
- 現時点の消費者は `features/search` 内の 2 コンポーネントのみ。roadmap Phase 2（パンくず）で必要になった時点で共有の場所へ移す。
