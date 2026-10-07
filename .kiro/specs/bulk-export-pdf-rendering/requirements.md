# Requirements Document

## Introduction

一括エクスポート（bulk export）の PDF 出力（中間 HTML を介する）における **サーバ側 Markdown
レンダリング** を、GROWI の Web 表示に「寄せて」リッチ化する。現状は Web レンダラとは別系統の
最小パイプラインのため、テーブル以外（GitHub アラート/ディレクティブ/数式/見出し ID 等）が
未対応で、出力がブラウザ印刷版より著しく貧弱になっている。

本施策のゴールは、GROWI 実レンダラが対象とする **npm 由来の Markdown 機能集合** を現行サーバ
環境で再利用し、GROWI 共通のデザインシステム由来のスタイルを当てることで、**より少ない継続
改修で、Web 表示に近い構造とスタイル** を得ること。GROWI テーマの完全再現は目的としない。

発端は PR #11288。背景・スコープ決定・将来フェーズ（`support/esm` 完了後のローカルプラグイン
再利用）の詳細は [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - 一括エクスポート PDF（中間 HTML 経由）のサーバ側 Markdown レンダリングのリッチ化
  - GFM テーブル / 数式 / 見出し ID / frontmatter / 引用・コード等 標準 Markdown 要素の扱い
  - 絵文字ショートコード（`:smile:` 等）→ 絵文字グリフへの変換
  - CSV / TSV コードブロック → 表への変換
  - ディレクティブ記法（`:foo[...]` / `::bar` 等の text/leaf ディレクティブ）の可読テキスト化
  - GROWI 共通デザインシステム由来のスタイル適用
  - 出力 HTML のサニタイズ（安全性）
  - スコープ外記法のグレースフルな劣化
  - bulk-export と Web レンダラが対象とする機能集合の整合検知（ドリフト防止）
- **Out of scope**:
  - リポジトリ全体の ESM 化（`support/esm`）そのもの
  - **装飾（色付き）コールアウト描画**。色付きコールアウトの見た目は React コンポーネント
    （`CalloutViewer`）駆動のため本 spec では再現しない（将来フェーズ renderer-convergence）。
    GitHub アラート（`> [!NOTE]` 等）は blockquote のまま描画する。これを `:::note` ディレクティブへ
    変換する `remark-github-admonitions-to-directives` は **callout 不在ではアラート種別ラベルを失い
    無名ブロックに劣化する（blockquote のままより視認性が下がる）ため、本 spec では採用しない**
  - コードのシンタックスハイライト配色 / drawio・plantuml・lsx・mermaid・attachment-refs のライブ
    描画（React コンポーネント / ブラウザ DOM 駆動。ESM 化後の将来フェーズ renderer-convergence）
  - GROWI テーマ・レイアウト・画面 chrome（サイドバー・パンくず等）の再現
  - 再生成 dedup キャッシュの無効化（`revisionListHash` のレンダラ版反映）── 運用対応とする
  - pdf-converter 側でのレンダリング（Markdown を渡す契約への変更）
  - md 形式エクスポートの出力内容の変更
- **Adjacent expectations**:
  - PDF への変換は引き続き pdf-converter が担う（HTML を読み描画する既存契約は不変）
  - スタイルは GROWI 共通デザインシステム（`@growi/core-styles`）から供給する想定
  - 既存の bulk-export パイプライン（スナップショット作成・ストリーミング・resume・圧縮アップ
    ロード）は不変
  - 本文は `<div class="wiki">` でラップし、GROWI 本文スタイル（`.wiki` 由来 + `@growi/core-styles`）
    をプリコンパイルした CSS を注入して、素の HTML 要素（table/blockquote/h*/code 等）を装飾する

## Requirements

### Requirement 1: リッチな Markdown 構造のレンダリング

**Objective:** As a エクスポート利用者, I want エクスポート文書内で Markdown が Web 表示同様に構造化されて描画されること, so that 生の Markdown 記法を読まずに内容を把握できる

#### Acceptance Criteria
1. When ページ本文に GFM テーブルが含まれる状態で一括エクスポートが PDF を生成する, the Bulk Export Renderer shall 当該テーブルを行・列・ヘッダを持つ構造化された表として描画する。
2. When ページ本文に GitHub アラート記法（`> [!NOTE]` 等）が含まれる, the Bulk Export Renderer shall それを引用ブロック（blockquote）として描画する。
3. When ページ本文に数式記法が含まれる, the Bulk Export Renderer shall それを数式として描画する。
4. When ページ本文に見出しが含まれる, the Bulk Export Renderer shall 各見出しに一意な識別子（id）を付与する。
5. When ページ本文に frontmatter が含まれる, the Bulk Export Renderer shall それを出力本文に露出させない。
6. The Bulk Export Renderer shall in-scope の Markdown 機能について、GROWI Web レンダラと構造的に整合する HTML を生成する。
7. When ページ本文に絵文字ショートコード（`:smile:` 等）が含まれる, the Bulk Export Renderer shall それを対応する絵文字グリフに変換する。未知のショートコードは元のテキストのまま残す。
8. When ページ本文に CSV/TSV コードブロック（`csv` / `csv-h` / `tsv` / `tsv-h`）が含まれる, the Bulk Export Renderer shall それを行・列を持つ構造化された表として描画する。

### Requirement 2: 出力のスタイル適用（Web 表示への接近）

**Objective:** As a エクスポート利用者, I want エクスポート文書が読みやすくスタイルされること, so that ブラウザ印刷版に近い体裁で閲覧・配布できる

#### Acceptance Criteria
1. When レンダリングされた表・コールアウト・コードブロック・見出し・引用が出力に含まれる, the Bulk Export Renderer shall 各要素に視認可能なスタイル（枠線・背景・余白・配色等）を適用する。
2. The Bulk Export Renderer shall GROWI 共通デザインシステム由来のスタイルを出力に適用する。
3. When 出力にスタイルを適用する, the Bulk Export Renderer shall GROWI のテーマ・レイアウト・画面 chrome（サイドバー・パンくず等）は再現しない。

### Requirement 3: 未対応機能のグレースフルな劣化

**Objective:** As a エクスポート利用者, I want 本施策で未対応の記法があっても出力が壊れないこと, so that 一部機能が未対応でも文書全体を取得できる

#### Acceptance Criteria
1. If ページ本文にスコープ外機能に依存する記法（コンテナディレクティブ `:::note` 等・drawio/plantuml/lsx/mermaid フェンス等）が含まれる, then the Bulk Export Renderer shall エクスポートを失敗させず、当該箇所の内部テキストを保持した可読なブロックまたはコードブロックとして出力する。
1a. When ページ本文に text/leaf ディレクティブ（`:foo[...]` / `::bar` 等）が含まれる, the Bulk Export Renderer shall ディレクティブ記法の属性構文（`{...}`）を生のまま露出させず、可読なテキストとして出力する。
2. If Markdown 変換中にエラーが発生する, then the Bulk Export Service shall 既存のエラーハンドリングに従ってジョブ状態を更新し、無効な出力をサイレントに完了扱いしない。

### Requirement 4: 出力の安全性（サニタイズ）

**Objective:** As a 管理者, I want エクスポート出力が安全に生成されること, so that 悪意ある Markdown により PDF 生成や閲覧で不正動作が起きない

#### Acceptance Criteria
1. The Bulk Export Renderer shall 出力 HTML をサニタイズし、許可されない要素・属性を除去する。
2. While pdf-converter が PDF 生成時に HTML エスケープに依存する状態, the Bulk Export Renderer shall HTML エスケープを無効化しない。
3. If ページ本文に危険な埋め込み（スクリプト等）が含まれる, then the Bulk Export Renderer shall それらを出力から除去または無害化する。

### Requirement 5: 既存エクスポートパイプライン契約の維持

**Objective:** As a 運用者, I want レンダリング変更が既存のエクスポート/変換フローを壊さないこと, so that 既存のジョブ・再開・PDF 変換が従来どおり動作する

#### Acceptance Criteria
1. The Bulk Export Renderer shall 変換結果を pdf-converter が読み取れる静的 HTML ファイルとして出力する。
2. When エクスポート形式が md である, the Bulk Export Service shall 本施策の HTML レンダリングを適用せず、従来どおり Markdown を出力する。
3. The Bulk Export Service shall 既存のページ走査・ストリーミング・再開（resume）挙動を維持する。
4. The Bulk Export Renderer shall リポジトリ全体の ESM 化を前提とせず、現行のサーバ実行環境で動作する。

### Requirement 6: レンダラ整合の維持（ドリフト防止）

**Objective:** As a メンテナ, I want bulk-export と Web レンダラのレンダリング対象が乖離しないことを検知できること, so that 将来 Web レンダラ側が変わっても出力品質の乖離に気づける

#### Acceptance Criteria
1. The Bulk Export Renderer shall 対象とする Markdown 機能の集合を Web レンダラの選定と整合させる。
2. If bulk-export と Web レンダラが対象とする Markdown 機能の集合・適用順が乖離する, then the テストスイート shall その不整合を検知して失敗する。
