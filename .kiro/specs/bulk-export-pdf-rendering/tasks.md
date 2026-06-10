# Implementation Plan

> スコープ: bulk-export（PDF）のサーバ側 Markdown レンダリング。callout/ローカルプラグインの
> 再実装は行わない（design 参照）。新規実装は test-first（red→green）で進める。

- [ ] 1. Foundation: bulk-export 用プリコンパイル CSS
- [ ] 1.1 `.wiki` 本文スタイルを単一 CSS アセットへプリコンパイルする
  - `_wiki.scss` ＋ `@growi/core-styles`（bootstrap 基盤）＋ KaTeX CSS を読み込む自己完結エントリを用意し、ビルド時に単一 CSS へコンパイルする
  - 生成 CSS に `.wiki table` / `.wiki blockquote` / `.wiki h1`..`h6` / `.wiki code` と KaTeX のルールが含まれることをテストで確認する（observable）
  - _Requirements: 1.3, 2.1, 2.2, 2.3_
- [ ] 1.2 生成 CSS とその依存の本番可用性を固定する
  - 生成 CSS アセット（および新規ランタイム依存）をサーバ実行環境から解決でき、本番 deploy・Turbopack 外部化で欠落しないよう `dependencies` 分類を確定する（tech.md）
  - ビルド/CI で「生成 CSS がサーバランタイムから解決可能」であることを検査するチェックを追加する（observable）
  - _Requirements: 2.1, 2.2_
  - _Depends: 1.1_

- [ ] 2. Core: プラグイン選定と ESM ローダ
- [ ] 2.1 採用プラグイン集合と意図的除外一覧を宣言する
  - 採用（remark-gfm, remark-frontmatter, remark-math, remark-rehype, rehype-raw, rehype-slug, rehype-sanitize, rehype-katex, rehype-stringify）の名前・順序・オプションを宣言として保持する
  - Web `generateCommonOptions` 由来で本 spec が採用しないプラグインを「意図的除外」として列挙する
  - 宣言モジュールが採用/除外の両集合を機械可読に公開する（observable）
  - _Requirements: 1.6, 6.1_
  - _Boundary: plugin-set_
- [ ] 2.2 ESM プラグインローダを dynamicImport ＋キャッシュで実装する
  - 宣言された全プラグインを `dynamicImport` で取得し、初回ロードをキャッシュする
  - ts-node/CJS ランタイムで全プラグインが `ERR_REQUIRE_ESM` なくロードできることをテストで確認する（observable）
  - _Requirements: 5.4, 1.6_
  - _Boundary: EsmPluginLoader_
  - _Depends: 2.1_

- [ ] 3. Core: Markdown→HTML レンダラ（TDD）
- [ ] 3.1 in-scope レンダリング契約の失敗テストを先に書く（red）
  - GFM 表→`<table>` / `> [!NOTE]`→`<blockquote>` / `$x$`→KaTeX マークアップ / 見出し→`id` 付与 / frontmatter→本文非露出 の各契約テストを用意する
  - 未実装のレンダラに対しテストが失敗する状態を確認する（observable: red）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - _Boundary: BulkExportMarkdownRenderer_
  - _Depends: 2.2_
- [ ] 3.2 レンダラパイプラインを実装し契約テストを通す（green）
  - `parse → gfm/frontmatter/math → remark-rehype(allowDangerousHtml) → rehype-raw → rehype-slug → rehype-sanitize → rehype-katex → rehype-stringify` を組み立て、パイプライン/モジュールを一度だけ構築してページ間で再利用する
  - 3.1 の全契約テストが green になる（observable）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Boundary: BulkExportMarkdownRenderer_
- [ ] 3.3 サニタイズ／安全性の挙動を担保する（test-first）
  - `<script>` 等の危険入力が除去され、raw HTML が必ず sanitize を通り、HTML エスケープを無効化しないことをテストで先に固定してから満たす
  - 危険入力テストが green、かつ allowlist が in-scope 要素（表/数式コンテナ/見出し id 等）を通す（observable）
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: BulkExportMarkdownRenderer_
- [ ] 3.4 未対応記法のグレースフル劣化を担保する（test-first）
  - `:::note` 等のディレクティブや drawio フェンスが throw せず、可読テキスト/blockquote として出力されることをテストで確認する（observable）
  - _Requirements: 3.1_
  - _Boundary: BulkExportMarkdownRenderer_

- [ ] 4. Core: スタイルプロバイダ
- [ ] 4.1 (P) `BulkExportStyleProvider`（getCss / wrap）を実装する
  - プリコンパイル CSS を読み込んで返し、本文を `<style>…</style>\n<div class="wiki">…</div>` でラップする
  - `wrap()` 出力が `.wiki` ラッパと `<style>` を含むことをテストで確認する（observable）
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: BulkExportStyleProvider_
  - _Depends: 1.1_

- [ ] 5. Integration: bulk-export エクスポートステップへの統合
- [ ] 5.1 `export-pages-to-fs-async` の独自変換をレンダラ呼び出しに置換する
  - `getBootstrapCssForBulkExport` / `bulkExportAdditionalCss` / `wrapHtmlWithBulkExportStyles` / `convertMdToHtml` と `getPageWritable` 内の独自 unified 構築を削除し、`BulkExportMarkdownRenderer` ＋ `BulkExportStyleProvider` 呼び出しに置き換える
  - md 形式分岐・resume（`lastExportedPagePath`）・ストリーミング・エラー時のジョブ状態更新を維持する
  - 配線が完了し、pdf 形式で `.wiki` ラップ＋`<style>` 入りの HTML が所定パスへ出力される（スモーク確認。md 不変・reject 時エラー化・resume の回帰検証は 7.1 が担う）（observable）
  - _Requirements: 3.2, 5.1, 5.2, 5.3_
  - _Boundary: export-pages-to-fs-async_
  - _Depends: 3.2, 4.1_

- [ ] 6. Validation: レンダラ整合（ドリフト）テスト
- [ ] 6.1 (P) `generateCommonOptions` との集合ドリフト検知テストを実装する
  - Web 共通集合の各プラグインが bulk-export 側で included / intentionally-excluded のいずれかに分類済みであることを検査し、未分類の新規プラグイン出現で失敗する（observable）
  - _Requirements: 6.1, 6.2_
  - _Boundary: RendererParityGuard_
  - _Depends: 2.1_

- [ ] 7. Validation: 結合テストと実機検証
- [ ] 7.1 エクスポートステップの結合テスト
  - pdf 形式で `.wiki`＋`<style>` 入り HTML を所定パスへ出力 / md 形式は不変 / 変換 reject 時のジョブエラー化 / resume 挙動維持 を検証する（observable）
  - _Requirements: 5.1, 5.2, 5.3, 3.2_
  - _Depends: 5.1_
- [ ]* 7.2 実機 bulk export（PDF）の描画検証
  - 実際に PDF を生成・描画し、表・引用・数式・見出しが `.wiki` スタイルで描画されることを確認する（dedup キャッシュは対象外のため、検証時はページ編集等でハッシュを変える）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_
  - _Depends: 5.1_
