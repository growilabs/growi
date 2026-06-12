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

## Post-Implementation Revisions (2026-06-11)

> 初回実装のレビューで挙がった保守性・効率の指摘 3 点への改訂。design.md の「実装改訂ノート」と各
> Boundary/Component 節に反映済み。全テスト green（feature 92 tests / pdf-converter 3 tests）、両アプリ
> typecheck PASS。

- [x] R1. CSS のページ間重複を排除（per-page inline → per-job 共有ファイル）
  - `BulkExportStyleProvider.wrap(fragment, cssHref)` は `<style>` インラインをやめ相対 `<link rel="stylesheet">` を出力。`export-pages-to-fs-async` が job ごとに `_bulk-export.css` を 1 回書き出し、各ページの深さに応じた相対 href を算出する
  - KaTeX フォントは woff2 のみインライン化（woff/ttf 破棄）。生成 CSS ~1.8MB→~757KB、かつ job あたり 1 ファイルのみ（1 ページあたりの HTML は `<link>` 1 行＋本文）
  - pdf-converter（越境・承認済み）: cluster task を `setContent`→`page.goto(pathToFileURL(...))` に変更し相対 `<link>` を解決。job dir 走査を `*.html` のみに絞り、共有 CSS を変換対象・完了判定から除外
  - _Requirements: 2.1, 2.2, 5.1_ / _Boundary: BulkExportStyleProvider, export-pages-to-fs-async, pdf-converter(HTML 読み込み機構)_
- [x] R2. プラグイン宣言の単一出所化（3 ファイル編集 → 1 ファイル編集）
  - `EsmPluginLoader` は `ADOPTED_PLUGINS`（plugin-set.ts）を走査して `dynamicImport` し順序付きリストを返す。`BulkExportMarkdownRenderer` は読み込み順に `.use()` する。プラグイン追加は plugin-set.ts のみで完結。旧 loader↔plugin-set の逆方向アサーションは削除
  - _Requirements: 1.6, 5.4_ / _Boundary: plugin-set, EsmPluginLoader, BulkExportMarkdownRenderer_
- [x] R3. ドリフトテストの堅牢化（正規表現 → AST）
  - `renderer-parity.spec.ts` を TypeScript コンパイラ API による import 宣言の AST 抽出へ置換。手書きブロックリストを撤廃し、解析不能時は loud に失敗
  - _Requirements: 6.1, 6.2_ / _Boundary: RendererParityGuard_
- [x] R4. 表の枠線が出ない不具合の修正（実機 PDF 検証で発覚）
  - 原因: research.md I-table の前提が誤り。`.wiki table` は枠線を持たず、GROWI の表枠線は `add-class` が付ける `table table-bordered`（Bootstrap クラス）由来。手書き表 CSS を削除した本 spec 実装では実機で表が無装飾になっていた
  - 修正: Web の `add-class` プラグインを**再利用**(`add-class.ts` の実行時依存は `hast-util-select` ESM のみ＝`recommended-whitelist.ts` と同じパターン)。**`plugin-set.ts` の `ADOPTED_PLUGINS` に正規エントリとして宣言**(`specifier`=相対パス, `exportName`='rehypePlugin', `options`=`{ table: 'table table-bordered' }`、sanitize 後・stringify 前に配置)し、loader/renderer が汎用処理。ローカル再実装も位置の特殊分岐も手書き CSS も持たず、生成済み Bootstrap 表 CSS を再利用。research.md I-table・design.md・plugin-set.ts の関連記述を訂正
- [x] R5. 責務分離: loader は「ロードする」責務に純化
  - `EsmPluginLoader` から `ADOPTED_PLUGINS` への依存を除去し、`loadPlugins(baseDir, declarations)` と宣言注入に変更(何をロードするかは呼び出し元=renderer が渡す)。冗長なモジュールキャッシュも撤廃(build-once は renderer の `cachedProcessor` が担保)。`PluginDeclaration` に `specifier`/`exportName` を追加し npm/ローカル両方を同一宣言で表現
  - _責務: EsmPluginLoader = 純粋なロード / plugin-set = 何をロードするか / renderer = 合成_
  - _Requirements: 1.1, 2.1_ / _Boundary: BulkExportMarkdownRenderer_

## 改訂 5: React 非依存プラグインの追加採用 (2026-06-12)

> emoji / xsv-to-table / remark-directive / echo-directive を `ADOPTED_PLUGINS` に追加採用する。除外理由の
> 「ローカル .ts は読めない」を訂正し（add-class の実例で反証）、admonitions は callout 不在で劣化が悪化する
> ため不採用とする（research.md I2 訂正 / I7）。新規変更は test-first（red→green）。

- [ ] 8. 追加プラグイン採用（emoji / xsv / directive+echo）
- [ ] 8.1 追加プラグインの描画契約の失敗テストを先に書く（red）
  - `:smile:`→絵文字グリフ（未知ショートコードは不変）/ `csv-h` フェンス→ヘッダ付き `<table>` / text・leaf ディレクティブ→可読テキスト（属性 `{...}` 非露出）/ ディレクティブ属性の `onclick` 等危険属性が sanitize で除去される、の各契約テストを `bulk-export-markdown-renderer.spec.ts` に追加する
  - 採用前のレンダラに対しテストが失敗することを確認する（observable: red）
  - _Requirements: 1.7, 1.8, 3.1a, 4.3_
  - _Boundary: BulkExportMarkdownRenderer (spec)_
- [ ] 8.2 4 プラグインを `ADOPTED_PLUGINS` に正規エントリとして宣言する（green）
  - emoji（remark, ローカル `remarkPlugin`、gfm の後・remark-directive の前）、remark-directive（npm, default）、echo-directive（remark, ローカル `remarkPlugin`、remark-directive の後）、xsv-to-table（remark, ローカル `remarkPlugin`、math の後・remark-rehype の前）を Web の選定順に合わせて宣言する。loader/renderer は不変（宣言追加のみ）
  - 本番可用性: emoji.ts が値 import する `mdast-util-find-and-replace` を devDependencies→dependencies へ移動する（bulk-export cron は emoji.ts を `.ts` のまま dynamicImport し実行時に解決するため。`pnpm deploy --prod` で除外されると `ERR_MODULE_NOT_FOUND` になる。package-dependencies.md）。echo-directive の `mdast-util-directive` は type-only import なので devDependencies のままで可
  - 8.1 の全契約テストが green になる（observable）
  - _Requirements: 1.7, 1.8, 3.1a, 1.6, 5.4_
  - _Boundary: plugin-set_
- [ ] 8.3 意図的除外一覧と分類テストを更新する
  - `INTENTIONALLY_EXCLUDED_PLUGINS` から emoji / xsv-to-table / remark-directive / echo-directive を除去。`github-admonitions` の除外理由を「callout 不在で劣化悪化」に訂正。`plugin-set.spec.ts` の除外期待リストを更新し、ドリフトテスト（`renderer-parity.spec.ts`）が全 Web プラグインを分類済みに保つことを確認する（observable）
  - _Requirements: 1.6, 6.1, 6.2_
  - _Boundary: plugin-set, RendererParityGuard_
- [ ] 8.4 インラインコードの枠線を Web と揃える（実機 PDF 検証で発覚）
  - 症状: PDF のインラインコードが Bootstrap の code 色（赤）だけで、Web のような枠線付きピル表示にならない。原因は枠線を付ける `src/styles/atoms/_code.scss`（`code:not([class^='language-'])`）が bulk-export の生成 CSS に含まれていなかったため（エントリは bootstrap apply + `_wiki.scss` のみ取り込み）
  - 修正: `bin/build-bulk-export-css.ts` のエントリ SCSS に `@use 'styles/atoms/code'` を追加し Web の単一出所ルールを**再利用**。`@use 'styles/...'` 解決のため loadPaths に `src/` を追加。生成 CSS を再生成。`bulk-export-css.spec.ts` に `code:not([class^=language-])` ルールの存在アサーションを追加（observable）
  - _Requirements: 2.1, 2.2_
  - _Boundary: BulkExportStyleProvider（生成 CSS）_
