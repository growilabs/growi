# Brief: attachment-search-text-extractor

> 本ファイルは spec の概要である。design.md / requirements.md の記述と相違がある場合はそちらを優先する。

> 3-way split の第 1 spec。詳細背景・既存コード調査は [../attachment-search/research.md](../attachment-search/research.md) を参照。

## Problem

GROWI には添付ファイル (PDF / Office 等) のテキストを抽出する能力が存在しない。全文検索機能 (attachment-search-indexing, attachment-search-ui) を実現するには、対応形式のバイト列から構造化されたテキスト (ページ/スライド/シート単位) を取り出す独立マイクロサービスが必要。

## Current State

- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない。ただし「`apps/` に置く Node のマイクロサービス + OpenAPI から orval で作る生成クライアント」という形の前例になる
- Office 系を Markdown に変換するライブラリ (`@firecrawl/anydoc`) と、PDF からページ単位でテキストを取り出す部品 (PDFium の WASM である `@embedpdf/pdfium`) が npm から利用可能。選定の理由は [research.md](./research.md) の §1「決定事項」と §2「採用理由と根拠」
- 要件を完全に満たす既製の抽出 REST API の image は無い (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

## Desired Outcome

- 添付ファイルのバイト列を HTTP multipart で受け取り、**ページ/スライド/シート単位に分割した Markdown テキスト** を JSON で返す独立マイクロサービスが存在する
- サービスは **ステートレス** で、k8s の共有 Deployment として運用でき、Docker image を使う OSS の環境でも動かせる
- 外部バイナリ・ネットワーク egress を要求せず、npm から取得できる部品 (ビルド済みのネイティブ部品と WASM を含む) だけで完結する (子プロセスに上限を掛ける util-linux の `prlimit` は例外として認める)
- 悪意ある大容量/ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限) が組み込まれている
- GROWI.cloud で 1 つのサービスを複数の app で共有するとき、運用者がログの行から呼び出し元の app を、`/metrics` から処理中の件数・応答の数・所要時間を見られる
- Image サイズは 400MB 以下に収まる
- 経路の定義から作る OpenAPI の文書を、`packages/attachment-text-extractor-client` (orval で生成) 向けに書き出せる
- monorepo のほかの部分と同じ言語 (TypeScript) と道具 (pnpm / turbo / vitest / biome) で保守できる

## Approach

**apps/attachment-text-extractor/** (`@growi/attachment-text-extractor`) に Node.js 24 + Hono (`@hono/node-server`) の独立サービスを置く。

- **ディレクトリ配置**: `apps/pdf-converter` と同じく pnpm workspace の一員とし、package ごとの `turbo.json` を持つ
- **抽出エンジン** (決定の内容は [research.md](./research.md) §1「決定事項」):
  - Office 系 (DOCX / XLSX / RTF / EPUB / CSV / 旧形式 DOC・XLS・PPT / OpenDocument): `@firecrawl/anydoc` (版を固定)。OCR は使わない (既定の `reject` のまま、外部には送らない)
  - PPTX: スライドごとに 1 枚の PPTX パッケージに分けてから anydoc に渡す
  - PDF: `@embedpdf/pdfium` でページごとに抽出
  - HTML / TXT / JSON / XML / YAML / MD / LOG / ipynb: サービス自身で処理 (文字コード判定、HTML は `htmlparser2` でタグを切り出して script / style を除く)
  - Outlook MSG: 対象外
- **位置情報**: PDF はページ単位、PPTX はスライド単位、XLSX はシート単位、その他は単一要素 (`pageNumber=null, label=null`)
- **日本語の正規化**: 全経路の後に改行コードを揃える。PDF の経路では、日本語の間に入った 1 文字分の半角空白・改行も詰める
- **リソース保護**: 最大サイズ制限、同時実行上限に加え、変換をリクエストごとの子プロセス (`prlimit` で上限を掛けて起動) で実行し、タイムアウトとメモリ超過で確実に止める。細工ファイル (展開後サイズ・入れ子の深さ) は上限で打ち切る
- **Dockerfile**: `node:24-slim` 系の multi-stage (build の段で pnpm workspace から build し、`pnpm deploy --prod` で本番の依存だけを取り出す)、非 root (uid 10001) 実行
- **セキュリティと運用の条件**: read-only rootfs、非 root、capabilities drop、権限を上げない、外向き通信の遮断を、運用者向けの文書 `docker/README.md` に理由つきで書く。k8s の manifest の例は持たない
- **OpenAPI**: 経路の定義の横に書いた zod のスキーマから `hono-openapi` で文書を作り、`scripts/export-openapi.ts` で書き出す。CI が commit 済みの文書との食い違いを検知する

## Scope

### In
- `apps/attachment-text-extractor/` ディレクトリ全体 (package 設定 / src / テスト / scripts / ベンチマーク / Dockerfile / `docker/README.md` / `AGENTS.md`)
- Hono アプリ: `POST /extract` (multipart と任意のヘッダー `X-Growi-App-Id`)、`GET /healthz`、`GET /readyz`、`GET /openapi.json`、`GET /metrics` (Prometheus のテキスト形式)
- 呼び出し元の app を `/extract` のログの行に出すことと、稼働状況の指標
- 形式別の変換と形式の対応表
- リソース保護 (size / timeout / 同時実行の枠)
- API のスキーマ (ExtractResponse / PageInfo / ErrorResponse / ErrorCode)
- 日本語テキストの正規化 (後処理)
- 変換処理を子プロセスで実行する仕組み
- Dockerfile (multi-stage + 非 root + セキュリティハードニング対応) と運用者向けの文書
- 経路の定義から作る OpenAPI の文書とその書き出し。文書が変わったときの生成クライアントの作り直しと、apps/app の呼び出し側の名前と型の書き方の修正
- 専用 CI workflow (`.github/workflows/ci-attachment-text-extractor.yml`: lint / 型の検査 / vitest / image の確認)
- サービス単体テストと、検索の品質のベンチマーク

### Out
- GROWI 側との統合 (AttachmentService ハンドラ登録、ES インデックス化等) — `attachment-search-indexing` spec の責務
- orval の設定と、生成クライアントを使う側の振る舞い — `attachment-search-indexing` spec の責務
- 検索結果 UI / 管理画面 UI — `attachment-search-ui` spec の責務
- k8s の manifest の例と、本番の環境への適用
- 第三者の部品のライセンスの表示を image やリポジトリに置くこと (依存が許容的なライセンスであることは調べて research.md に記録する)
- 画像 OCR / 音声動画文字起こし / YouTube / Azure DI / ZIP 再帰 / Docling 等の高精度抽出
- Outlook MSG

## Boundary Candidates

1. **HTTP の層** (`src/http/`) — エンドポイント、認証、本文の受け取り、エラーの表、OpenAPI
2. **実行管理の層** (`src/runner/`) — 子プロセスの起動・監視・停止
3. **子の入口** (`src/child/`) — 親の見張りと、変換の呼び出し
4. **変換の層** (`src/conversion/`) — 形式別の変換と正規化。純関数
5. **共有の層** (`src/contract/`、`src/formats/`、`src/wire/`) と設定 (`src/config/`)
6. **配布物** (Dockerfile / `docker/README.md` / CI workflow)

## Out of Boundary

- `packages/attachment-text-extractor-client` の orval の設定 (別 spec)
- apps/app の Crowi 初期化や AttachmentService ハンドラ (別 spec)
- Elasticsearch スキーマや検索クエリ (別 spec)
- 添付ファイル一覧モーダル UI や検索結果 UI (別 spec)

## Upstream / Downstream

### Upstream (依存先)
- `@firecrawl/anydoc` (npm、版を固定)
- `@embedpdf/pdfium` (npm、版を固定)
- `hono` / `@hono/node-server` / `hono-openapi` / `zod` / `@prometheus-io/client` (npm)
- Node.js 24 / pnpm / Docker build runtime / util-linux の `prlimit`
- 既存 `apps/pdf-converter` のマイクロサービス運用パターン (Dockerfile 構造、CI の形) — 参考のみ、コード依存なし

### Downstream (影響先)
- `attachment-search-indexing` spec — OpenAPI の文書、生成クライアント、Docker image を消費
- OSS 配布 (Docker image) と GROWI.cloud (k8s) 運用
- 将来の抽出エンジン差し替え (anydoc がページ・スライド区切りを返すようになった場合の一本化、Docling 等) — 契約 (pages[] 構造) を保つ前提

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: `attachment-search-indexing` (下流の消費者)、umbrella `attachment-search` (設計資料)

## Constraints

- **ランタイム/言語**: Node.js 24 + TypeScript。monorepo のほかの部分と同じ。Bun / Deno は対象にしない
- **ライセンス**: 依存は MIT / Apache-2.0 / BSD / ISC などの許容的なライセンスのみ採用 (GPL / AGPL / LGPL 系は禁止)
- **Image size 目標**: 400MB 以下
- **メモリ**: 1 件の変換の最大メモリは入力によって大きく変わる (6MB の XLSX で約 620MB)。コンテナのメモリ上限 (2Gi) は、1 件の変換に許すメモリの上限と同時実行数から design で定める
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること
- **互換性**: API 契約 (ExtractResponse の pages[] 構造) は破壊的変更を避ける。変更時は下流 spec (attachment-search-indexing) の再検証を要する
- **upstream 依存のリスク**: anydoc は 0.x 系で公開から日が浅く、PPTX の分割は文書化されていない挙動に頼る。版を固定し、出力の契約テストで更新時の変化を検知する
