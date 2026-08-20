# Gap Analysis — search-result-infinite-scroll

対象: 検索結果ページ（フルページ `/_search`）の結果一覧を infinite scroll 化する。
分析日: 2026-07-24 / language: ja

## 1. 現状把握（Current State）

### データ取得層
- `useSWRxSearch`（`src/stores/search.tsx`）は **通常の `useSWR`** を使用。SWR キー `['/search', keyword, fixedConfigurations]`（offset/limit を含む）で、offset が変わると別キー＝別取得となり、前ページは保持されず**丸ごと差し替え**。`keepPreviousData: true`。
- レスポンス `IFormattedSearchResult = { data: IPageWithSearchMeta[], meta: { total, hitsCount, took } }`。`meta.total` = ヒット総数、`meta.hitsCount` = 今回返却件数。
- サーバは Elasticsearch delegator が `from`/`size`（offset/limit）で問い合わせ（`src/server/service/search-delegator/elasticsearch.ts` L804-806）。**offset/limit 方式は infinite scroll でもそのまま流用可能**。

### 表示・状態管理層
- `SearchPage.tsx` … offset/limit を useState 保持、`PaginationWrapper` で番号切替（L324-341）。
- `SearchPageBase.tsx` … 「現在ページ1ページ分の `pages`」前提。以下が append と衝突する:
  - **選択リセット useEffect（L157-172）**: `pages` が変わるたびに `selectedPageIdsByCheckboxes.clear()`。append のたびに走ると選択が消える。
  - **右ペイン先頭選択 useEffect（L147-154）**: `pages` が変わるたびに `pages[0]` を選択。append のたびに先頭へ戻る。
  - **全選択（L102-126）**: `selectAll` は `pages` を走査して Set に add。`pages` が累積リストなら機能するが、上記リセット effect が阻害。
  - **選択件数の分母（L139-144）**: `onSelectedPagesByCheckboxesChanged(size, pages.length)` の `pages.length` は「累積件数」にする必要。
- `usePageDeleteModalForBulkDeletion（L274-321）` … 単一 `data: IFormattedSearchResult` を受け、`data.data.filter(...)` で削除対象抽出。累積リストを渡す形に要変更。

### 既存の infinite scroll 資産（再利用可能）
- **`InfiniteScroll`（`src/client/components/InfiniteScroll.tsx`）** … `SWRInfiniteResponse<T>` を受け、IntersectionObserver でセンチネル交差時に `!isValidating && !isReachingEnd` なら `setSize(size => size + 1)`。`children` に累積リスト、`isReachingEnd` の計算は**消費側の責務**。既定の LoadingIndicator あり。
- **確立された利用パターン**（`RecentChanges`, `PageTimeline`）:
  - hook 側 `useSWRInfinite`、`getKey` は「前ページが空なら null（＝停止）」＋ offset を `previousPageData.offset + previousPageData.pages.length` で算出（RecentChanges 方式）。
  - 消費側で `data.flatMap(r => r.pages)` で平坦化して描画。
  - `isReachingEnd` は「最終ページが満杯でない」で判定。**ただし検索結果は `meta.total` を持つため、`累積件数 >= meta.total` で判定できる（RecentChanges より明快）**。

## 2. 要件↔資産マップ（Requirement-to-Asset Map）

| Req | 必要な能力 | 既存資産 | ギャップ判定 |
|---|---|---|---|
| 1 追加読み込み | useSWRInfinite 化・センチネル・停止条件 | `InfiniteScroll`（Asset）、確立パターン、`meta.total`（Asset） | **Missing**: 検索用 useSWRInfinite フック新設 |
| 1.3 読込中表示 | ローディングインジケータ | `InfiniteScroll` 既定 LoadingIndicator | 充足 |
| 1.4 total 到達で停止 | isReachingEnd 計算 | `meta.total` 利用可 | Constraint: 累積件数の集計が必要 |
| 1.5 0件表示 | 0件時の表示 | 既存 `SearchResultListHead` の0件表示 | 充足（流用） |
| 1.6 追加読込失敗時のエラー/再試行 | エラー surface・再試行 | `InfiniteScroll` はエラー非対応（setSize 抑止のみ） | **Unknown（Research Needed）** |
| 2 番号ページャ廃止 | PaginationWrapper 除去 | `SearchPage` の `searchPager` slot | 充足（除去のみ） |
| 3 チャンク20固定 | limit 固定 | `INITIAL_PAGIONG_SIZE=20` 既存 | Constraint: 現状 `limit = showPageLimitationL ?? 20`。固定20と config の扱いを設計判断 |
| 4 選択・全選択（累積） | 累積前提の選択/indeterminate | `SearchPageBase` の Set・`OperateAllControl` | **Missing/Constraint**: リセット effect の再設計、分母を累積件数に |
| 5 一括削除（累積） | 累積リストを削除対象に | `usePageDeleteModalForBulkDeletion` | **Missing/Constraint**: 単一 data 前提。共有フックのため両消費者に配慮 |
| 6 プレビュー維持 | append 時に先頭へ戻さない | `SearchPageBase` L147-154 | **Missing**: リセット条件を「新規検索時のみ」に |
| 7 条件変更でリセット | 累積破棄・先頭再読込・選択クリア | `searchInvokedHandler` の `setOffset(0)` | Constraint: useSWRInfinite では `setSize(1)`＋mutate＋選択クリア |

### 横断的制約（Constraint）— アプローチを決定づける
- **C1: `useSWRxSearch` は6ファイルで共有**（`SearchResultMenuItem`／`SearchTypeahead`／`AiAssistantManagementKeywordSearch`／`PrivateLegacyPages`／`SearchPage`／内部）。これらは単一ページ取得（モーダル/タイプアヘッド/AI）を前提とするため、**このフックを useSWRInfinite に変換してはならない**。infinite scroll 用の**新フックを別途新設**する必要がある。
- **C2: `SearchPageBase`／`usePageDeleteModalForBulkDeletion` は `PrivateLegacyPages` と共有**。`PrivateLegacyPages` は番号ページャ・表示件数セレクタ（20/50/100/200）を**意図的に維持**する画面。`SearchPageBase` の既存挙動（pages 変化での選択/プレビューのリセット）を無条件に変えると `PrivateLegacyPages` に副作用が出る。

## 3. 実装アプローチ（Options）

### Option A: 既存を直接改変（Extend in place）
`useSWRxSearch` を useSWRInfinite に変換し、`SearchPageBase` のリセット effect を直接書き換える。
- ✅ 新規ファイル最少
- ❌ **C1 に抵触**（6消費者が破損）／**C2 に抵触**（PrivateLegacyPages 破損）。条件分岐で吸収すると `SearchPageBase` が肥大化。**非推奨**。

### Option B: 完全新規（Parallel components）
新フック＋新 `SearchPageBase` 派生＋新ページを並置。
- ✅ 既存への副作用ゼロ、隔離してテスト容易
- ❌ `SearchResultList`／右ペインプレビュー／選択ロジックの**重複**が大きい。保守二重化。

### Option C: ハイブリッド（推奨）
1. **新フック `useSWRINFxSearch`（仮）** を `src/stores/search.tsx` に追加。`useSWRInfinite`＋既存 apiv1 `/search`（offset/limit）を利用し、`getKey` は「前ページ空なら null」＋ offset 算出、`isReachingEnd` は `累積件数 >= meta.total` で計算。`useSWRxSearch` は**そのまま温存**（C1 回避）。
2. **`SearchPageBase` を最小拡張**: 累積 `pages`（`data.flatMap(r => r.data)`）と infinite-scroll 描画スロットを受け取れるようにする。選択リセット／先頭プレビューの effect を、**`pages` 参照ではなく「検索アイデンティティ（keyword＋conditions）」をキー**に発火させることで、append では発火せず新規検索でのみリセットする。`PrivateLegacyPages` は従来どおり単一 data＋`searchPager`（番号ページャ）を渡し**既存挙動を維持**（C2 回避）。
3. **`usePageDeleteModalForBulkDeletion` を累積リスト対応**に一般化（両消費者が各自のリストを渡す）。
4. `SearchPage.tsx` は `searchPager`（PaginationWrapper）を廃し、`InfiniteScroll` でリストをラップ。
- ✅ 既存共有資産を壊さず、重複も最小。既存の GROWI パターン（RecentChanges）を踏襲。
- ❌ 計画がやや緻密（新旧経路の両立設計が必要）。

## 4. 工数・リスク（Effort / Risk）

- **Effort: M（3–7日）** — `InfiniteScroll`＋確立パターンの再利用で新規実装は小さいが、共有 `SearchPageBase` の選択/プレビュー/削除ロジックの再設計と新旧両立が中心作業。
- **Risk: Medium** — 技術は既知・パターン確立済みでリスクを下げるが、①共有フック/共有コンポーネントの多消費者影響、②選択状態の append 非リセット化、③追加読込失敗時の挙動（Req1.6）が主リスク。

## 5. 設計フェーズへの申し送り（Recommendations）

- **推奨アプローチ: Option C（ハイブリッド）**。
- **確定済みの意思決定**（要件フェーズでユーザー承認済み）:
  - 全選択の対象 = 読み込み済み全件
  - 番号ページャは完全廃止（切替式は持たない）
  - チャンクサイズ = 固定20、表示件数セレクタは復活させない
- **Research Needed（設計で解消すべき論点）**:
  1. **Req1.6**: `InfiniteScroll` は追加読込失敗を surface しない。SWR の `error` を用いた通知と「次スクロールで再試行」をどう実現するか（`InfiniteScroll` を拡張するか、消費側で `error` を監視するか）。
  2. **チャンクサイズの出所**: 固定20とするが、既存の `showPageLimitationL`（admin config）を無視するか尊重するかを設計で明記。
  3. **`SearchPageBase` の新旧両立方式**: モードフラグを足すか、リセットを「検索アイデンティティ」キーに切り替えるか。`PrivateLegacyPages` への非回帰を担保する設計にする。
  4. **IntersectionObserver とレイアウト**: 既存の `overflow-y-scroll` コンテナ（SearchPageBase L221）と2ペインレイアウト内でセンチネルが正しく交差するかを設計/実装で確認。
  5. **削除後の再取得**: useSWRInfinite での `mutate`／`setSize(1)` によるリセットの具体手順。

---

# Design Synthesis（設計フェーズ）

分析日: 2026-07-24 / discovery: light（Extension）

## Research 項目の確定（RN1–RN5）
- **RN1 追加読込失敗**: `isReachingEnd = 累積>=total || hasError` でエラー時に自動 `setSize` を停止（タイトなリトライループ防止）。`endingIndicator` にエラー＋「再試行」ボタンを出し、`mutate()` で復帰。要件 1.6 の「再試行できる状態を維持」を満たす。
- **RN2 チャンクサイズ**: `showPageLimitationL ?? INITIAL_PAGIONG_SIZE(20)` を固定チャンクとして採用。既存の admin config を尊重しつつ既定 20・セレクタ非提供（要件 3.1/3.2 と整合。3.1 の「20」は config 未設定時の既定）。
- **RN3 新旧両立**: モード名ハードコードを避け、`SearchPageBase` に `resetKey`（データ駆動）を導入。リセット系 effect を `[pages]`→`[resetKey]` へ。削除後の選択クリアは削除完了ハンドラで明示実行し、`[pages]` 依存を排除。
- **RN4 IntersectionObserver × レイアウト**: `InfiniteScroll` を既存 `overflow-y-scroll` コンテナ内に配置（`RecentChanges` 先例）。2ペイン構成での交差は実機確認を Validation Hook 化。
- **RN5 削除後リセット**: `setSize(1)` + `mutate()` で先頭チャンクから再取得。

## Synthesis 3 レンズ
1. **Generalization**: 要件 4/6/7 は「累積に対するリセット契機の違い」に一般化 → `resetKey` 一本で選択・プレビュー双方のリセットを表現。
2. **Build vs Adopt**: infinite scroll 機構は既存 `InfiniteScroll` + `useSWRInfinite` を **Adopt**（`RecentChanges`/`PageTimeline` 実績）。自作しない。純粋関数（`getSearchInfiniteKey`/`mergeInfiniteSearchResult`）のみ **Build**（テスト容易性のため）。
3. **Simplification**: `SearchPageBase` を派生/複製せず、`resetKey` と任意 `infiniteScroll` prop の追加のみで両経路を吸収（新規コンポーネント最小）。番号ページャ切替・全件選択バナーは非スコープで持ち込まない。

## 確定した意思決定（要点）
- `useSWRxSearch` は温存し、`useSWRINFxSearch` を新設（key 名前空間 `'/search/infinite'` で分離）。
- `usePageDeleteModalForBulkDeletion` の第1引数を `IPageWithSearchMeta[] | undefined` に一般化（両消費者が各自のリストを渡す）。
- 依存方向: interfaces → stores → util → SearchPageBase → SearchPage。

---

# Design Review 結果（validate-design）

判定: **GO（条件付き→反映済み）**。2件の Critical Issue を design.md に反映済み。
- **Issue 1（6.1/6.3）**: プレビュー初期選択は `[resetKey]` 単純付け替え不可（データ依存）。→ 2段構成（resetKey 変化でクリア＋初回データ到着で一度だけ先頭選択、適用済み resetKey を ref 記録）。
- **Issue 2（4.5/4.6）**: append 後に select-all の checked↔indeterminate が更新されない。→ 累積件数変化を契機に選択件数/累積件数を親へ再通知する effect を追加。
Strength: 共有資産の非破壊設計（`useSWRxSearch` 温存・名前空間分離）、純粋関数抽出によるテスト容易性。
