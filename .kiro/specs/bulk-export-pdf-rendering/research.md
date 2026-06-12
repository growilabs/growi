# Research Log: bulk-export-pdf-rendering

## Discovery Scope

Extension（既存 bulk-export への統合）。対象は bulk-export の **サーバ側 Markdown→HTML 変換**。
発端 PR #11288。診断セッションで判明済みの事実を確定情報として再利用し、設計に必要な追加調査
（特に「ディレクティブ/アラートの描画経路」）を行った。

## Key Investigations

### I1. 現行 bulk-export 変換パイプライン
- **Finding**: [export-pages-to-fs-async.ts](../../../apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/steps/export-pages-to-fs-async.ts) が `remark-parse → remark-gfm → remark-html` をアドホックに構築。ESM は `@cspell/dynamic-import` の `dynamicImport` で読み込む。PR #11288 は `remark-gfm` 追加＋Bootstrap 全量＋手書き表 CSS 注入。
- **Implication**: dynamicImport 方式は実証済みで再利用可能。`remark-html` ステップと CSS 注入を置換する。

### I2. CJS サーバでの ESM 静的 import 不可（実測）
- **Finding**: `node -r ts-node/register/transpile-only` 環境で `services/renderer/renderer.tsx` を import → `ERR_REQUIRE_ESM`（`@growi/remark-growi-directive` 等）。React/SCSS を除いたプラグインのみのモジュールでも同様に失敗。ts-node が `import`→`require` 変換するため。
- **Source**: 実測（2 回）。
- **Implication**: Web レンダラや GROWI ローカル .ts プラグインを **静的 import で再利用することは不可**。サーバ側は npm ESM を `dynamicImport` で個別に読む方式が必須。
- **訂正（改訂 5, 2026-06-12）**: 上記の失敗は **`renderer.tsx`（多数の ESM/React/SCSS を静的 import するモジュール）を import した場合**に限る。**個別プラグインファイルを `dynamicImport` する経路では成立しない** — 改訂 4 で `add-class.ts`（ローカル .ts）を相対パス `dynamicImport` で本番 cron に正常ロードできた実例が反証となる。よって「ローカル .ts は読めない」という当初の一般化は**誤り**。実体が **React/DOM 非依存の純粋な AST 変換**であるローカルプラグイン（emoji, xsv-to-table, echo-directive）は add-class と同一パターンで再利用可能。除外すべきは「読めないから」ではなく「React/DOM が必須だから（callout, mermaid 等）」または「本 spec で不要だから」である。

### I3. リッチなアラート/コールアウトは React コンポーネント駆動
- **Finding**:
  - GitHub アラート `> [!NOTE]` は `remark-github-admonitions-to-directives`（npm）で `:::note` ディレクティブへ変換。
  - `~/features/callout` の [callout.ts](../../../apps/app/src/features/callout/services/callout.ts) が既知コールアウト名の directive に `data.hName='callout'`、`hProperties`（type 等）を設定 → `<callout>` 要素ノード化。sanitize 許可タグに `callout` を追加。
  - 実際の見た目（色・アイコン・タイトル/本文レイアウト）は React [CalloutViewer.tsx](../../../apps/app/src/features/callout/components/CalloutViewer.tsx) が `div.callout.callout-{type}` / `.callout-indicator` / `.callout-title` / `.callout-content` ＋ `CalloutViewer.module.scss` で描画。
  - ローカル `echo-directive` は **スタイル描画ではなくディレクティブ構文をテキストでエコーするだけのフォールバック**。
- **Implication**: サーバ HTML 生成（React なし）ではコールアウトの見た目を再利用できない。忠実再現には
  React SSR が必要（ESM 化では解決しない）。**本 spec ではコールアウト描画を行わない**（非ゴール）。
  アラートは blockquote、ディレクティブは可読テキストへ劣化（Req3）。色付きコールアウトは Phase 2
  renderer-convergence（React SSR ベース）へ。

### I4. テーブルのクラス付与もローカルプラグイン
- **Finding**: Web レンダラは [add-class.ts](../../../apps/app/src/services/renderer/rehype-plugins/add-class.ts)（ローカル、`hast-util-select` 依存）で `<table>` に `table table-bordered` を付与。
- **Implication**: bulk-export では `<table>` への class 付与を小さなインライン変換で再現（または CSS で素の `table` を直接装飾）。

### I5. CSS の出所
- **Finding**: `@growi/core-styles` は Bootstrap ベースのデザインシステム（SCSS）。Markdown 本文固有の体裁は app 側 SCSS（`styles/organisms/_wiki.scss` 等）と `CalloutViewer.module.scss` に分散。core-styles 単体にはコールアウト/`.wiki` 体裁は無い。
- **Implication**: 注入 CSS は「core-styles（Bootstrap 基盤: 表/タイポ）＋ in-scope 要素（表/コールアウト/コード/見出し/引用）の最小 `.wiki` 系ルール」をビルド時にプリコンパイルした静的 CSS とする。本文を `.wiki` でラップして適用。リポジトリの vendor-styles プリコンパイル方式（`vendor-styles-components` skill）に倣う。

### I6. Web レンダラのプラグイン構成（ドリフト基準）
- **Finding**: 共有基盤は `generateCommonOptions`（[renderer.tsx](../../../apps/app/src/services/renderer/renderer.tsx)）= remark: gfm, emoji, pukiwikiLikeLinker, growiDirective, remarkDirective, echoDirective, remarkFrontmatter, codeBlock / rehype: relativeLinks×2, raw, addClass, addInlineProperty。各 view（`client/.../renderer.tsx`）が math, xsvToTable, admonitions, callout, lsx, drawio 等を追加。
- **Implication**: bulk-export は npm かつ HTML 文字列化に意味のある部分集合＋インライン等価物を採用。drift テストは「Web 共通集合の各プラグインが、bulk-export 側で included / intentionally-excluded のいずれかに分類済み」を検査し、未分類の新規プラグイン出現で失敗させる。

### I7. directive 劣化の実測（改訂 5, 2026-06-12）
- **目的**: callout（React）抜きで `remark-directive` + `echo-directive`（+ `remark-github-admonitions-to-directives`）を通したとき、`> [!NOTE]` / `:::note` / text/leaf ディレクティブが実際にどう描画されるかを確定する。
- **方法**: npm パッケージ（unified, remark-gfm, remark-directive, admonitions, remark-rehype, rehype-raw, rehype-stringify）＋ echo-directive 同等ロジックで実 HTML を出力（apps/app 内で実行）。
- **Finding**（sanitize 前の素の出力）:
  | 入力 | admonitions あり | admonitions なし（採用案） |
  |---|---|---|
  | `> [!NOTE]\n> 本文` | `<div><p>本文</p></div>`（**NOTE ラベル喪失・匿名 div**） | `<blockquote><p>[!NOTE] 本文</p></blockquote>`（**ラベルがテキストで残る**） |
  | `:::note\n本文\n:::`（container） | `<div><p>本文</p></div>`（ラベル喪失） | 同左 |
  | `::youtube[Video]{#id}`（leaf） | `<div id="id"><span>::youtube</span><span>[Video]</span></div>` ✅ 可読 | 同左 ✅ |
  | `:abbr[HTML]{title="…"}`（text） | `<span title="…"><span>:abbr</span><span>[HTML]</span></span>` ✅ 可読 | 同左 ✅ |
  - emoji: `:smile:`→😄, `:+1:`→👍, 未知の `:xxx:` は不変（安全）。
  - xsv: `csv-h`/`tsv-h`→ヘッダ付き `<table>`、`csv`（ヘッダ無し）は空 `<th>`（Web と同一挙動）。
  - XSS: `:foo{onclick="evil()"}` は echo が onclick 属性を付与するが、後段 sanitize が除去（実パイプラインでは onclick は残らない）。
- **Implication**:
  - **echo-directive は text/leaf にのみ効く**（callout.ts が container を担当）。`remark-directive` + `echo-directive` は text/leaf を可読テキスト化でき、属性 `{...}` の生露出も防げる → **採用**。
  - **admonitions は callout 不在では逆効果**（`> [!NOTE]` がラベルを失い匿名 div に劣化、blockquote のままより悪化）→ **不採用**。GitHub アラートは blockquote のまま残す方が劣化として良い。
  - container ディレクティブ（`:::note`）は専用処理せず、内部テキストを保持した素ブロックへ自然劣化（callout 化は Phase 2）。
  - **ユーザー決定（2026-06-12）**: emoji + xsv-to-table + remark-directive + echo-directive を採用、admonitions は不採用、callout/mermaid/drawio/lsx/plantuml は Phase 2 据え置き。

## Architecture Pattern Evaluation

- **採用**: 既存の dynamicImport ベース単一 unified パイプラインを bulk-export feature 内に閉じて構築（サーバ専用 converter モジュール）。Web レンダラのコードは import しない（CJS/ESM 制約 I2）。
- **却下**: (a) `renderer.tsx` 直接再利用 → I2 で不可。(b) react-markdown を `renderToStaticMarkup` で SSR → React コンポーネント群が client 専用依存（next/link, module.scss, 重い highlighter）で CJS 不可・高コスト。(c) pdf-converter 側でレンダリング → 契約変更大、将来フェーズ。

## Design Decisions (build vs adopt / synthesis)

> **Decision（ユーザー確定）**: コールアウト（アラート）は本 spec で行わない。理由: 視覚は React
> `CalloutViewer`（JSX）駆動で HTML 文字列としての再利用元が存在せず、忠実再現には React SSR が要る
> （ESM 化では解決しない、I3）。これにより **インライン変換・ローカル再実装が一切不要**になり、
> 「同一機能が 2 箇所」を完全に回避できる。table-bordered は I-table の通り CSS のみで解決。

- **Adopt（dynamicImport）**: remark-gfm, remark-frontmatter, remark-math, remark-rehype, rehype-raw, rehype-slug, rehype-sanitize, rehype-katex, rehype-stringify。**改訂 5 で追加**: emoji, xsv-to-table, remark-directive, echo-directive（いずれも React/DOM 非依存。emoji/xsv/echo はローカル .ts を add-class と同一の相対パス `dynamicImport` で再利用）。
- **No local reimplementation（再実装はしない／再利用はする）**: テーブル/見出し/引用/コード等は素の HTML を
  出力し `.wiki` 由来 CSS で装飾（I-table, I5）。emoji/xsv/echo-directive は**コピー再実装ではなく Web と同一実装を
  `dynamicImport` で再利用**する（改訂 5）。admonitions/callout プラグインは採用しない（I7 / Phase 2）。
- **Degrade**: GitHub アラート `> [!NOTE]` → blockquote のまま（admonitions 不採用、I7）。text/leaf ディレクティブ
  → echo で可読テキスト化（属性 `{...}` 非露出）。container `:::note` → 内部テキスト保持の素ブロック。仕様上の
  グレースフル劣化（Req3, 3.1a）。
- **Defer（Phase 2 / renderer-convergence）**: 色付きコールアウト, github-admonitions（callout 前提）,
  シンタックスハイライト配色, drawio/lsx/mermaid/plantuml/attachment-refs。忠実なコールアウト等は
  React SSR ベースの収れんで扱う。（emoji / xsv-to-table は改訂 5 で Phase 1 へ前倒し採用）

### I-table. テーブルはロジック不要（CSS のみ）← ⚠️ 誤り（改訂 4 で訂正）
- **当初の Finding（誤り）**: `.wiki table {}` が素の表を装飾するのでクラス付与は不要、と判断した。
- **訂正（実機 PDF 検証 2026-06-11）**: [_wiki.scss](../../../apps/app/src/styles/organisms/_wiki.scss#L120) の
  `.wiki table` は **`font-size: 0.95em` のみ**で枠線を持たない。GROWI の表の枠線・ヘッダ背景・セル余白は
  Web レンダラの `add-class` が付与する **`table table-bordered`（Bootstrap クラス）由来**。PR #11288 が表を
  描画できていたのは**手書き表 CSS** があったためで、それを削除した本 spec の実装では実機で表が無装飾になった。
- **Implication（訂正後）**: 表は **`<table>` への `table table-bordered` クラス付与が必要**。**Web の
  `add-class` プラグインを再利用**して付与する（`add-class.ts` の実行時依存は `hast-util-select` ESM のみ＝
  `recommended-whitelist.ts` と同じ再利用パターン。ローカル再実装はしない）。add-class は `plugin-set.ts` の
  `ADOPTED_PLUGINS` に正規エントリとして宣言し（`specifier`=相対パス, `exportName`='rehypePlugin'）、loader が
  汎用的にロード・renderer が順序どおり適用する。これで生成済み Bootstrap 表 CSS（`.table`/`.table-bordered`）
  が当たる。手書き表 CSS は導入しない。表以外（引用/見出し/コード）は素要素＋`.wiki` CSS で従来どおり装飾される。

## Risks

- **R-css**: 注入 CSS のプリコンパイル機構（`_wiki.scss` ＋ `@growi/core-styles` ＋ KaTeX CSS の
  SCSS/CSS→単一 CSS、CJS サーバからの読み込み、Turbopack/deploy への影響）。`dependencies` 分類・
  `.next/node_modules` 検証が必要（tech.md）。
- **R-katex**: 数式を出すなら KaTeX CSS の同梱が必須（無いと崩れる）。不要なら remark-math/rehype-katex
  ごと外す選択も可（タスクで確定）。
- **R-sanitize**: sanitize の許可リストが in-scope 要素（数式コンテナ, table, 見出し id 等）を通す必要。
  エスケープ無効化は禁止（pdf-converter `--no-sandbox`）。

## Boundary Decisions

- **Owns**: bulk-export サーバ側変換パイプライン・注入 CSS（`.wiki` ラップ）・drift テスト。
- **Out**: Web レンダラ改修（drift テスト用のプラグイン選定参照を除く）、インライン変換/ローカル再実装、
  コールアウト描画、ローカル .ts プラグイン本体、ESM 化、dedup キャッシュ無効化、pdf-converter 内部。
- **Revalidation triggers**: pdf-converter が読む HTML ファイル契約の変更／Web `generateCommonOptions` のプラグイン集合変更（drift テストが検知）／ESM 化完了（Phase 2 着手の合図）。
