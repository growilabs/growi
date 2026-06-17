# Implementation Plan

> スコープ: bulk-export（PDF）のサーバ側 Markdown レンダリング。callout/ローカルプラグインの
> 再実装は行わない（design 参照）。新規実装は test-first（red→green）で進める。

- [ ] 1. Foundation: bulk-export 用プリコンパイル CSS
- [x] 1.1 `.wiki` 本文スタイルを単一 CSS アセットへプリコンパイルする
  - `_wiki.scss` ＋ `@growi/core-styles`（bootstrap 基盤）＋ KaTeX CSS を読み込む自己完結エントリを用意し、ビルド時に単一 CSS へコンパイルする。既存 vendor-styles はブラウザ `document.head` 注入用（出力は `*.prebuilt.ts`）でサーバ `fs` 読み込み用ではないため、出力形態の異なる新規ビルドステップとして作る
  - 見た目が成立する条件まで生成物に含める: (a) `_wiki.scss` が参照する `--bs-*` カスタムプロパティ群、(b) `@extend .link-offset-2` 等で継承される bootstrap ユーティリティ class 定義、(c) KaTeX の `@font-face`（フォントは `src` を base64 data URI でインライン化し、外部 `url()` 参照を残さない）
  - 生成 CSS に `.wiki table` / `.wiki blockquote` / `.wiki h1`..`h6` / `.wiki code` / KaTeX のルールに加え、`--bs-*` カスタムプロパティ定義と `@extend` 先 class が含まれることをテストで確認する（observable）
  - _Requirements: 1.3, 2.1, 2.2, 2.3_
- [x] 1.2 生成 CSS とその依存の本番可用性を固定する
  - 生成 CSS アセット（および新規ランタイム依存）をサーバ実行環境から解決でき、本番 deploy・Turbopack 外部化で欠落しないよう `dependencies` 分類を確定する（tech.md）
  - KaTeX フォントは base64 data URI で生成 CSS にインライン化し、外部フォント配信に依存しない（Puppeteer の単体 HTML 文脈でパス解決不要）
  - ビルド/CI で「生成 CSS がサーバランタイムから解決可能」かつ「生成 CSS に外部フォント `url()` 参照が残っていない（フォントが data URI で同梱されている）」ことを検査するチェックを追加する（observable）
  - _Requirements: 1.3, 2.1, 2.2_
  - _Depends: 1.1_

- [ ] 2. Core: プラグイン選定と ESM ローダ
- [x] 2.1 採用プラグイン集合と意図的除外一覧を宣言する
  - 採用（remark-gfm, remark-frontmatter, remark-math, remark-rehype, rehype-raw, rehype-slug, rehype-sanitize, rehype-katex, rehype-stringify）の名前・順序・オプションを宣言として保持する
  - Web `generateCommonOptions` 由来で本 spec が採用しないプラグインを「意図的除外」として列挙する
  - 宣言モジュールが採用/除外の両集合を機械可読に公開する（observable）
  - _Requirements: 1.6, 6.1_
  - _Boundary: plugin-set_
- [x] 2.2 ESM プラグインローダを dynamicImport ＋キャッシュで実装する
  - 宣言された全プラグインを `dynamicImport` で取得し、初回ロードをキャッシュする
  - ts-node/CJS ランタイムで全プラグインが `ERR_REQUIRE_ESM` なくロードできることをテストで確認する（observable）
  - _Requirements: 5.4, 1.6_
  - _Boundary: EsmPluginLoader_
  - _Depends: 2.1_

- [ ] 3. Core: Markdown→HTML レンダラ（TDD）
- [x] 3.1 in-scope レンダリング契約の失敗テストを先に書く（red）
  - GFM 表→`<table>` / `> [!NOTE]`→`<blockquote>` / `$x$`→KaTeX マークアップ / 見出し→`id` 付与 / frontmatter→本文非露出 の各契約テストを用意する
  - 未実装のレンダラに対しテストが失敗する状態を確認する（observable: red）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - _Boundary: BulkExportMarkdownRenderer_
  - _Depends: 2.2_
- [x] 3.2 レンダラパイプラインを実装し契約テストを通す（green）
  - `parse → gfm/frontmatter/math → remark-rehype(allowDangerousHtml) → rehype-raw → rehype-slug → rehype-sanitize → rehype-katex → rehype-stringify` を組み立て、パイプライン/モジュールを一度だけ構築してページ間で再利用する
  - 3.1 の全契約テストが green になる（observable）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Boundary: BulkExportMarkdownRenderer_
- [x] 3.3 サニタイズ／安全性の挙動を担保する（test-first）
  - `<script>` 等の危険入力が除去され、raw HTML が必ず sanitize を通り、HTML エスケープを無効化しないことをテストで先に固定してから満たす
  - 許可リストは `services/renderer/recommended-whitelist.ts` の `tagNames` / `attributes` を `dynamicImport` で再利用し（`recommended-whitelist.ts` 自体も `hast-util-sanitize` ESM 依存のため dynamicImport 経由）、in-scope の数式コンテナ等のみ上乗せする。bulk-export 側で許可リストを独自に書き起こさない（Web と二重管理にしない）
  - 危険入力テストが green、許可リストの出所が `recommended-whitelist` 単一であること、かつ allowlist が in-scope 要素（表/数式コンテナ/見出し id 等）を通すことをテストで確認する（observable）
  - _Requirements: 4.1, 4.2, 4.3, 6.1_
  - _Boundary: BulkExportMarkdownRenderer_
- [x] 3.4 未対応記法のグレースフル劣化を担保する（test-first）
  - `:::note` 等のディレクティブや drawio フェンスが throw せず、可読テキスト/blockquote として出力されることをテストで確認する（observable）
  - _Requirements: 3.1_
  - _Boundary: BulkExportMarkdownRenderer_

- [ ] 4. Core: スタイルプロバイダ
- [x] 4.1 (P) `BulkExportStyleProvider`（getCss / wrap）を実装する
  - プリコンパイル CSS を読み込んで返し、本文を `<style>…</style>\n<div class="wiki">…</div>` でラップする
  - `wrap()` 出力が `.wiki` ラッパと `<style>` を含むことをテストで確認する（observable）
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: BulkExportStyleProvider_
  - _Depends: 1.1_

- [ ] 5. Integration: bulk-export エクスポートステップへの統合
- [x] 5.1 `export-pages-to-fs-async` の独自変換をレンダラ呼び出しに置換する
  - `getBootstrapCssForBulkExport` / `bulkExportAdditionalCss` / `wrapHtmlWithBulkExportStyles` / `convertMdToHtml` と `getPageWritable` 内の独自 unified 構築を削除し、`BulkExportMarkdownRenderer` ＋ `BulkExportStyleProvider` 呼び出しに置き換える
  - md 形式分岐・resume（`lastExportedPagePath`）・ストリーミング・エラー時のジョブ状態更新を維持する
  - 配線が完了し、pdf 形式で `.wiki` ラップ＋`<style>` 入りの HTML が所定パスへ出力される（スモーク確認。md 不変・reject 時エラー化・resume の回帰検証は 7.1 が担う）（observable）
  - _Requirements: 3.2, 5.1, 5.2, 5.3_
  - _Boundary: export-pages-to-fs-async_
  - _Depends: 3.2, 4.1_

- [ ] 6. Validation: レンダラ整合（ドリフト）テスト
- [x] 6.1 (P) Web プラグイン選定との集合ドリフト検知テストを実装する
  - 参照元は `generateCommonOptions` と `generateSSRViewOptions` の両方（math/katex/slug/sanitize は後者で追加されるため、前者だけでは監視の死角になる）
  - 両参照元の各プラグインが bulk-export 側で included / intentionally-excluded のいずれかに分類済みであること、かつ bulk-export が採用する全プラグイン（math/katex/slug/sanitize 含む）が Web 側のいずれかの選定段に対応づくことを検査し、未分類の新規プラグイン出現で失敗する（observable）
  - _Requirements: 6.1, 6.2_
  - _Boundary: RendererParityGuard_
  - _Depends: 2.1_

- [ ] 7. Validation: 結合テストと実機検証
- [x] 7.1 エクスポートステップの結合テスト
  - pdf 形式で `.wiki`＋`<style>` 入り HTML を所定パスへ出力 / md 形式は不変 / 変換 reject 時のジョブエラー化 / resume 挙動維持 を検証する（observable）
  - _Requirements: 5.1, 5.2, 5.3, 3.2_
  - _Depends: 5.1_
- [x]* 7.2 実機 bulk export（PDF）の描画検証
  - 実際に PDF を生成・描画し、表・引用・見出しが `.wiki` スタイル（枠線色等の `--bs-*` 由来含む）で描画され、数式が KaTeX フォントで崩れず描画されることを目視で確認する（dedup キャッシュは対象外のため、検証時はページ編集等でハッシュを変える）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_
  - _Depends: 5.1_

## Implementation Notes

> 全タスク実装済み・検証済み（pipeline + feature テスト green / typecheck PASS / 本番ビルド PASS）。
> 以下は将来のメンテ・リファクタで参照すべき、タスクをまたぐ恒久的な実装知識（事実）。

### N1. CSS は job ごとの共有スタイルシート（ページ間で重複させない）
`BulkExportStyleProvider.wrap(fragment, cssHref)` は CSS を `<style>` でインラインせず、相対
`<link rel="stylesheet">` を出力する。`export-pages-to-fs-async` が job ごとに `_bulk-export.css` を 1 回
書き出し、各ページは自身の深さに応じた相対 href を算出する。pdf-converter は `setContent` ではなく
`page.goto(pathToFileURL(...))` でページを読むため相対 `<link>` が解決し、job dir の走査は `*.html` のみに
絞って共有 CSS を変換対象・完了判定から除外する。KaTeX フォントは Chromium が解せる **woff2 のみ**を
base64 data URI でインライン化（woff/ttf 代替は破棄、生成 CSS ~757KB）。
_Boundary: BulkExportStyleProvider, export-pages-to-fs-async, pdf-converter(HTML 読み込み機構)_

### N2. プラグイン宣言は plugin-set.ts が単一出所（追加は 1 ファイル編集）
採用プラグインは `plugin-set.ts` の `ADOPTED_PLUGINS` に宣言として集約する。`BulkExportMarkdownRenderer`
が `loadPlugins(baseDir, ADOPTED_PLUGINS)` で宣言を渡し、`EsmPluginLoader` は**与えられた宣言をロードする
だけ**（何をロードするかは知らない＝責務分離。モジュールキャッシュも持たず、build-once は renderer の
`cachedProcessor` が担保）。renderer は読み込み順に `.use()` する。よってプラグインの追加・削除・並べ替えは
**plugin-set.ts の 1 ファイル編集のみ**（loader/renderer は不変）。`PluginDeclaration` は `name`（parity 用の
正規名）/ `specifier`（npm 名 or 相対パス）/ `exportName`（default 以外）/ `options` を持ち、npm プラグインも
ローカル再利用プラグインも同一の宣言で表現する。
_Boundary: plugin-set, EsmPluginLoader, BulkExportMarkdownRenderer_

### N3. ドリフト検知は renderer.tsx の AST import 解析
`renderer-parity.spec.ts` は TypeScript コンパイラ API で `renderer.tsx`（`generateCommonOptions` /
`generateSSRViewOptions`）の **import 宣言を AST 抽出**し、各プラグインが bulk-export 側で adopted /
intentionally-excluded のいずれかに分類済みであることを検査する。手書きブロックリストは持たず、解析不能時は
loud に失敗する。Web レンダラのプラグイン集合・順序が変わると検知される（Revalidation Trigger）。
_Boundary: RendererParityGuard_

### N4. ローカル .ts プラグインは「再実装」ではなく「再利用」
表の枠線・絵文字・CSV/TSV 表・ディレクティブ劣化は、Web と同一実装のローカル .ts プラグイン
（add-class / emoji / xsv-to-table / echo-directive）を相対パス `dynamicImport` で再利用して実現する
（コピー再実装・手書き CSS・位置の特殊分岐は持たない）。`add-class` は `<table>` に `table table-bordered`
（Bootstrap クラス）を付与し生成済み表 CSS を当てる（`.wiki table` 単体では枠線が出ない）。採用順は Web の
選定順に合わせる: `gfm → emoji → remark-directive → echo-directive → frontmatter → math → xsv-to-table →
remark-rehype → … → sanitize → katex → add-class → stringify`。emoji は `:smile:` を直接ディレクティブと
誤認させないため remark-directive より前、xsv-to-table は produced `<table>` が add-class の枠線を受けるため
remark-rehype より前に置く。`remark-github-admonitions-to-directives` は不採用（callout 不在では `> [!NOTE]`
を匿名 `<div>` に変換しアラート種別ラベルを失い、blockquote のままより劣化が悪化。research.md I7）。
_Boundary: plugin-set_

### N5. ディレクティブ劣化の責務分担（echo は text/leaf のみ）
`echo-directive` は text/leaf ディレクティブのみを可読テキスト化する（container は callout の領分）。callout を
持たない本パイプラインでは container ディレクティブ（`:::note` 等）は内部テキストを保持した素ブロックへ自然
劣化する。echo はディレクティブ属性（`:foo{...}`）を `hProperties` に転写するが、後段の rehype-sanitize
（単一出所 allowlist）が許可外属性（`onclick` 等）を除去するため、Web と同一のサニタイズ境界が保たれる。

### N6. 本番依存分類（dynamicImport 経路の実行時解決）
bulk-export cron はローカル .ts プラグインを `.ts` のまま `dynamicImport` し、その**実行時**に依存を
node_modules から解決する。よって emoji.ts が値 import する `mdast-util-find-and-replace` は
**`dependencies`** に置く（`pnpm deploy --prod` が devDependencies を除外すると `ERR_MODULE_NOT_FOUND`
になる。package-dependencies.md）。type-only import（echo-directive の `mdast-util-directive` 等）は型消去
されるため devDependencies のままで可。

### N7. インラインコードの枠線も Web の単一出所を再利用
インラインコードの枠線・余白・角丸は Web の `src/styles/atoms/_code.scss`
（`code:not([class^='language-'])`、主アプリも `style-app.scss` から取り込む単一出所）由来。bulk-export の
CSS ビルド（`bin/build-bulk-export-css.ts`）のエントリ SCSS が `@use 'styles/atoms/code'` でこれを再利用する
（`@use 'styles/...'` 解決のため Sass loadPaths に `src/` を追加）。これが無いと Bootstrap の code 色だけが
当たり、枠線付きピル表示にならない。
_Boundary: BulkExportStyleProvider（生成 CSS）_
