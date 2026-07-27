# Gap Analysis — search-modal-path-truncation

## 1. 現状調査（Current State）

### 対象のレンダリング連鎖
- [SearchModal.tsx](../../../apps/app/src/features/search/client/components/SearchModal.tsx) — reactstrap `Modal size="lg"` + Downshift コンボボックス。
- [SearchResultMenuItem.tsx](../../../apps/app/src/features/search/client/components/SearchResultMenuItem.tsx) — `useSWRxSearch` で結果取得（`limit: 10`）。各行を `SearchMenuItem` にマップ。パスは以下でレンダリング（70-72 行目）:
  ```tsx
  <span className="ms-3 text-break text-wrap">
    <PagePathLabel path={item.data.path} />
  </span>
  ```
  - `PagePathLabel` に `isPathIncludedHtml` を**渡していない** → モーダルのパスは**プレーン文字列**（キーワードハイライトの HTML は含まれない）。※全文検索結果ページ（`/_search`）はハイライトを含むが、モーダルは別。
- [SearchMenuItem.tsx](../../../apps/app/src/features/search/client/components/SearchMenuItem.tsx) — 行は `<li className="d-flex align-items-center px-2 py-1 ...">`。子は `UserPicture` → パス span → footprint（既読数）span の 3 要素の flex row。
- [PagePathLabel.tsx](../../../packages/ui/src/components/PagePath/PagePathLabel.tsx)（@growi/ui, **共有コンポーネント**）— props 無指定時は `former/` + `<strong>{latter}</strong>` を 1 つの `<span>` に出力。**セグメント分割はせず**、`former`/`latter` の 2 分割のみ。省略・truncation は一切なし。
- [SearchMenuItem.module.scss](../../../apps/app/src/features/search/client/components/SearchMenuItem.module.scss) — hover/active 背景のみ。overflow 制御なし。

### パス分割モデル
- [DevidedPagePath](../../../packages/core/src/models/devided-page-path.ts)（@growi/core）— `former`/`latter` の 2 分割。`evalDatePath=true` 時は末尾の日付（`/YYYY`, `/YYYY/MM`, `/YYYY/MM/DD`）を 1 つの `latter` に束ねる。`PagePathLabel` は `new DevidedPagePath(path, false, true)` を使うので**日付束ね有効**。
- [LinkedPagePath](../../../apps/app/src/models/linked-page-path.ts)（apps/app）— `DevidedPagePath(path)`（**日付束ねなし**）を再帰し、`pathName`（最終セグメント）+ `parent`（連結リスト）+ `href` を提供。**セグメント配列相当**を得られる既製モデル。全文検索結果ページのパンくず（`PagePathHierarchicalLink`）はこれを使う。

### 既存の truncation 資産
- 中間省略（middle-ellipsis）のユーティリティ・コンポーネントは**存在しない**。
- CSS truncation は `/_search` 側のみ（`text-truncate`、`<Clamp>`）。モーダルには無い。
- `PagePathLabel` / `DevidedPagePath` の**テストは存在しない**（新規テストを足す余地）。

### レイアウト観点
- 行は flexbox。単一行 + ellipsis 化には、パス span に `min-width: 0`（flex アイテムの縮小許可）+ 子セグメントへの `text-overflow: ellipsis` が必要。現状の `text-break text-wrap` を置き換える。

## 2. 要件→資産マップ（Requirement-to-Asset Map）

| 要件 | 使える資産 | ギャップ | 種別 |
|---|---|---|---|
| R1 中間省略（先頭+…+親+ページ名） | `LinkedPagePath`（セグメント列を取得可能） | 中間省略のレンダリング/判定ロジックが無い | Missing |
| R2 省略判定（4 セグ以上）/ルート/ちょうど4 | `LinkedPagePath` の深さ、`DevidedPagePath.isRoot` | 判定純粋関数が無い | Missing |
| R3 1 行固定・横幅安全網 | flex 行, SCSS module パターン | `min-width:0` + per-segment ellipsis の CSS が無い（現状 `text-break text-wrap`） | Missing / Constraint |
| R4 ホバーでフルパス | ネイティブ `title` 属性 or reactstrap `Tooltip` | 付与箇所が無い | Missing |
| R5 非破壊（遷移/既読数/リクエスト） | 既存 `SearchMenuItem` 構造、`item.data.path` | パス span 内だけの差し替えで担保可能 | Constraint |

## 3. 実装アプローチ（Options）

### Option A: 共有 `PagePathLabel`（@growi/ui）を拡張
`isMiddleTruncated` 等の prop を追加し、セグメント分割・中間省略を共有側に実装。
- ✅ 一箇所で全消費者に効かせられる
- ❌ `PagePathLabel` は多数の消費者を持つ**共有コンポーネント**。API 拡大と回帰リスク大。@growi/ui は `LinkedPagePath`（apps/app）を持たないため、セグメント分割を @growi/core 側に新設する必要があり波及が広い。今回のスコープ（モーダル限定）に対し過剰。

### Option B: 検索フィーチャー内に新規プレゼンテーションコンポーネント（推奨）
`features/search/client/components/` に `SearchResultPagePath.tsx`（仮）を新設し、`SearchResultMenuItem` のパス span を差し替える。中間省略の**判定は純粋関数**に切り出し（例: `path → { firstSegment, hasEllipsis, parentSegment, pageName }`）、コンポーネントは薄いアダプタに。CSS は同居の `*.module.scss`（`min-width:0` + segment ごとの ellipsis）。フルパスは `title`。
- ✅ 共有コンポーネント非改変・回帰リスク最小、フィーチャーローカルで完結
- ✅ coding-style（多数の小さいファイル / 純粋関数抽出 / フィーチャー単位）に合致、純粋関数はユニットテスト容易
- ✅ セグメント源として `LinkedPagePath` を再利用可能（**日付束ねなし＝純粋セグメント**の挙動になり、R1/R2 と整合）
- ❌ モーダル以外に将来展開する場合は再度共有化が必要（YAGNI 上は許容）

### Option C: ハイブリッド（純粋関数を @growi/core、表示を apps/app）
中間省略の判定純粋関数を @growi/core（`DevidedPagePath` 隣接）に置き、表示コンポーネントは apps/app。
- ✅ ロジックの再利用性・テスト容易性が最も高い
- ❌ 現時点で消費者はモーダルのみ。共有化は時期尚早の可能性。まずは B で feature-local に置き、必要になれば core へ昇格が無難。

**推奨: Option B（判定は純粋関数として feature-local に抽出）。** 純粋関数が将来 core へ昇格しやすい形にしておく。

## 4. 設計フェーズへ持ち越す論点（Research Needed / 決定事項）

1. **日付パスの「ページ名」定義**: 現行 `PagePathLabel` は `evalDatePath` で末尾日付（例 `.../2024/01/01`）を 1 単位の `latter` として太字にする。セグメント分割（`LinkedPagePath`）に切り替えると、日付ページはページ名＝最終セグメント（`01`）となり**現行表示から微変化**する。R1「先頭+…+親+ページ名」の「ページ名」を (a) 純粋な最終セグメントとするか、(b) 日付束ねを踏襲するか、を design で確定する。→ 推奨: セグメント方針に一貫させ (a)。ただし影響有無を design で明記。
2. **セグメントのカウント/抽出方法**: `LinkedPagePath` の parent チェーン walk で first/parent/pageName と深さを算出する純粋関数の仕様（root, 1〜3 セグメント, ちょうど 4 セグメントの分岐）を確定。
3. **ツールチップ実装**: ネイティブ `title`（最小・`useId` 落とし穴回避）を推奨。reactstrap `Tooltip` を使う場合は [ui-pitfalls](../../../apps/app/.claude/rules/ui-pitfalls.md) の「`target` に `useId()` 文字列を渡さない（ref を使う）」に注意。「省略が発生した時のみ」提示する条件分岐の持ち方も design で確定。
4. **CSS 安全網の配分**: 先頭/親/ページ名のうち、どれを優先的に残すか（ページ名を最優先で最大幅、先頭・親は縮小許容など）。1 行を絶対に超えない flex 構成（`min-width:0` の付与箇所、`text-truncate` の適用単位）を design で確定。ライト/ダーク両テーマで検証。
5. **テスト方針**: 純粋関数のユニットテスト（root / 短い / 4 セグ / 深い / 長い CJK / 日付パス）。コンポーネントは RTL で「1 行・省略記号・title 付与・クリック遷移維持」を contract として検証（essential-test-design / essential-test-patterns に従う）。

## 5. 複雑度・リスク

- **Effort: S（1〜3 日）** — フィーチャーローカルの表示変更 1 コンポーネント + 純粋関数 + CSS。サーバ/データ変更なし、既存パターン踏襲。
- **Risk: Low** — 共有コンポーネント非改変、familiar tech、スコープ明確。注意点は CSS の 1 行 truncation の詰め（テーマ差・CJK）と日付パスの微挙動のみ。

## 6. 設計フェーズへの推奨

- **採用アプローチ**: Option B。判定を純粋関数に抽出し、`SearchResultMenuItem` のパス span を新規プレゼンテーションコンポーネントに差し替え。セグメント源は `LinkedPagePath` を再利用。
- **確定すべき鍵**: 上記論点 1〜4。
- **持ち越し研究**: 日付パスの扱い（論点 1）、CSS 安全網の優先度配分（論点 4）。

---

## 7. Design Synthesis 結果（design フェーズ）

- **一般化**: root / 短い（≤3）/ ちょうど4 / 深い の全ケースを単一純粋関数 `formatTruncatedPagePath` で処理。ケースごとの別関数は作らない。
- **Build vs Adopt**:
  - セグメント分割は `normalizePath` + `path.split('/')`（`LinkedPagePath` の連結リスト walk より単純・テスト容易）。
  - 中間省略の描画は CSS flexbox（`min-width:0` + per-segment `text-overflow: ellipsis` + `flex-shrink` 優先度）。ライブラリ追加なし。
  - ツールチップはネイティブ `title` 属性（reactstrap `Tooltip` は `useId`→`target` 落とし穴があり不採用）。
- **単純化**: 共有 `PagePathLabel`（@growi/ui）は非改変。新規は純粋関数1 + 表示コンポーネント1 + CSS module1 + 各テスト。`SearchResultMenuItem` はパス span の差し替え + flex 調整のみ。

### 確定した設計判断（research 論点への回答）
1. **日付パスのページ名定義** → **(b) 日付束ねを踏襲**（ユーザー判断で確定）。`new DevidedPagePath(path, false, true)` の `latter` をページ名とし、末尾日付（`/YYYY[/MM[/DD]]`）は 1 単位のページ名として太字表示する現行挙動を維持。中間省略は祖先パスにのみ適用。→ 浅いパスは現行完全一致、深いパスは日付ページ名を保ったまま祖先中間のみ `…`。（当初の (a) 純粋最終セグメントは日付ページで意味が失われるため不採用）。
2. **セグメント抽出** → ページ名 = `DevidedPagePath.latter`。祖先 = `former` を `normalizePath` 後 `/` 分割・空要素除去。表示単位数 = 祖先数 + 1。判定は `<=3` 全表示 / `>=4` 中間省略、ちょうど 4 は中間の祖先 1 個。
3. **ツールチップ** → ルート要素に `title={fullPath}` を常時付与（CSS ellipsis は実行時幅依存のため DOM 計測を避け、常時付与で 4.1 を満たす最小実装）。
4. **CSS 安全網** → 先頭・親を先に縮め、ページ名は `flex-shrink` を小さくして最後に縮む。区切り `/`・`…` は縮小/折り返し不可。ライト/ダーク検証は実装時。
