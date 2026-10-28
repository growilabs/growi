# Brief: attachment-search-text-extractor

> 3-way split の第 1 spec。詳細背景・既存コード調査は [../attachment-search/research.md](../attachment-search/research.md) を参照。

## Problem

GROWI には現在、添付ファイル (PDF / Office 等) のテキストを抽出する能力が存在しない。全文検索機能 (attachment-search-indexing, attachment-search-ui) を実現するには、対応形式のバイト列から構造化されたテキスト (ページ/スライド/シート単位) を取り出す独立マイクロサービスが必要。

## Current State

- GROWI monorepo には Python コードが存在せず、抽出ライブラリも未採用
- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない
- Office 系を Markdown に変換するライブラリ (firecrawl/anydoc、microsoft/markitdown など) と、PDF からページ単位でテキストを取り出すライブラリが PyPI から利用可能。選定の理由は [research.md](./research.md) の §1「決定事項」と §2「採用理由と根拠」
- Microsoft 公式の REST API 実装は存在しない (CLI / MCP のみ)。サードパーティ pre-built image も要件を完全に満たすものは不在 (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

## Desired Outcome

- 添付ファイルのバイト列を HTTP multipart で受け取り、**ページ/スライド/シート単位に分割した Markdown テキスト** を JSON で返す独立マイクロサービスが存在する
- サービスは **ステートレス** で、k8s Deployment + HPA の共有サービス方式で運用でき、OSS docker-compose でも同梱できる
- 外部バイナリ・ネットワーク egress を要求せず、PyPI から取得できる Python パッケージ (ネイティブ拡張を含む wheel を含む) のみで完結する
- 悪意ある大容量/ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限) が組み込まれている
- Image サイズは 400MB 以下に収まる
- FastAPI の OpenAPI spec が `packages/attachment-text-extractor-client` (別 spec で使用) 向けに export できる

## Approach

**services/attachment-text-extractor/** に Python 3.12 + FastAPI + Uvicorn の独立サービスを新設する。

- **ディレクトリ配置**: `services/` は本プロジェクトで新設されるトップレベルディレクトリ。**pnpm workspace と turbo pipeline の対象外** (pnpm-workspace.yaml / turbo.json は変更しない)
- **抽出エンジン** (決定の内容は [research.md](./research.md) §1「決定事項」):
  - Office 系 (DOCX / XLSX / RTF / EPUB / CSV / 旧形式 DOC・XLS・PPT / OpenDocument): firecrawl/anydoc。OCR は使わない (`ocr='reject'` のまま、Firecrawl Parse には送らない)
  - PPTX: スライドごとに 1 枚の PPTX パッケージに分けてから anydoc に渡す
  - PDF: pypdfium2 でページごとに抽出
  - HTML / TXT / JSON / XML / YAML / MD / LOG / ipynb: サービス自身で処理 (文字コード判定、HTML は標準の `html.parser` で script / style を除いてタグを除去)
  - Outlook MSG: 対象外
- **位置情報**: PDF はページ単位、PPTX はスライド単位、XLSX はシート単位、その他は単一要素 (`pageNumber=null, label=null`)
- **日本語の正規化**: 全経路の後に、改行コードを揃え、日本語の間に入った 1 文字分の空白・改行を詰める
- **リソース保護**: 最大サイズ制限、同時実行上限に加え、変換を kill できる子プロセスで実行してタイムアウト時に確実に止める。細工ファイル (展開後サイズ・入れ子の深さ) は上限で打ち切る
- **Dockerfile**: `python:3.12-slim-bookworm` + `uv` multi-stage (builder stage で `uv sync --locked --no-dev` → runtime stage に `.venv` だけコピー)、非 root (uid 10001) 実行
- **セキュリティ**: k8s で `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, `capabilities: drop: [ALL]`, `allowPrivilegeEscalation: false`, seccomp `RuntimeDefault`, `/tmp` を size-limited tmpfs、NetworkPolicy で外部 egress 遮断
- **OpenAPI**: `scripts/export_openapi.py` で `/openapi.json` を JSON ファイルとしてエクスポート (別 spec の orval 入力)

## Scope

### In
- `services/attachment-text-extractor/` ディレクトリ全体 (Dockerfile / pyproject.toml / uv.lock / src / tests / scripts / AGENTS.md / README.md)
- FastAPI app: `POST /extract` (multipart)、`GET /healthz`、`GET /readyz`、`GET /openapi.json`
- 形式別 extractor と MIME whitelist
- リソース保護 (size / timeout / semaphore) middleware
- Pydantic schemas (ExtractResponse / PageInfo / ErrorResponse / ErrorCode)
- 日本語テキストの正規化 (後処理)
- 変換処理を子プロセスで実行する仕組み
- Dockerfile (uv + multi-stage + 非 root + セキュリティハードニング対応)
- OpenAPI export script (別 spec が消費する)
- docker-compose エントリ (growi-docker-compose に追加する service)
- k8s manifest 例 (Deployment + Service + HPA + NetworkPolicy + securityContext)
- Python 用 CI job (lint: ruff / test: pytest / image build)
- サービス単体テスト (形式別 extractor、limits、エラーコード)

### Out
- GROWI 側との統合 (AttachmentService ハンドラ登録、ES インデックス化等) — `attachment-search-indexing` spec の責務
- TS クライアントの生成 — `attachment-search-indexing` spec の責務 (ただし OpenAPI spec の出力はこの spec の責務)
- 検索結果 UI / 管理画面 UI — `attachment-search-ui` spec の責務
- 画像 OCR / 音声動画文字起こし / YouTube / Azure DI / ZIP 再帰 / Docling 等の高精度抽出
- Outlook MSG

## Boundary Candidates

1. **FastAPI アプリ本体** (main.py / routers/extract.py) — HTTP エンドポイントと入力バリデーション
2. **抽出オーケストレータ** (services/extraction_service.py) — MIME 判定 → 形式別 extractor への dispatch → limits 強制
3. **形式別 extractor** (services/extractors/*.py) — PDF / PPTX / XLSX / simple の 4 モジュール、純粋関数
4. **契約 schemas** (schemas.py) — Pydantic モデル、OpenAPI の source of truth
5. **運用設定** (config.py / limits.py) — 環境変数と動的制限値
6. **インフラ artifacts** (Dockerfile / docker-compose 抜粋 / k8s manifests) — デプロイ可能な成果物

## Out of Boundary

- `packages/attachment-text-extractor-client` の生成パイプライン (別 spec)
- apps/app の Crowi 初期化や AttachmentService ハンドラ (別 spec)
- Elasticsearch スキーマや検索クエリ (別 spec)
- 添付ファイル一覧モーダル UI や検索結果 UI (別 spec)

## Upstream / Downstream

### Upstream (依存先)
- `firecrawl-anydoc` (PyPI、版を固定)
- `pypdfium2` (PyPI)
- `fastapi` / `uvicorn` (PyPI)
- Python 3.12 / uv / Docker build runtime
- 既存 `apps/pdf-converter` のマイクロサービス運用パターン (Dockerfile 構造、health check 流儀) — 参考のみ、コード依存なし

### Downstream (影響先)
- `attachment-search-indexing` spec — OpenAPI spec と Docker image を消費
- OSS 配布 (growi-docker-compose) と GROWI.cloud (k8s) 運用
- 将来の抽出エンジン差し替え (anydoc がページ・スライド区切りを返すようになった場合の一本化、Docling 等) — 契約 (pages[] 構造) を保つ前提

## Existing Spec Touchpoints

- **Extends**: なし (Python サービスは本プロジェクトで初めて GROWI monorepo に入る)
- **Adjacent**: `attachment-search-indexing` (下流の消費者)、umbrella `attachment-search` (設計資料)

## Constraints

- **ランタイム/言語**: Python 3.12+ を新規導入。既存 Node/Java スタックに加え GROWI monorepo の 3 言語目となる
- **ライセンス**: 依存は MIT / Apache-2.0 / BSD 互換のみ採用 (GPL / AGPL 系は禁止。PyMuPDF は AGPL のため不可)
- **Image size 目標**: 400MB 以下
- **メモリ**: 1 件の変換の最大メモリは入力によって大きく変わる (6MB の XLSX で約 620MB)。コンテナのメモリ上限は、1 件の変換に許すメモリの上限と同時実行数から design で定める
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること
- **互換性**: API 契約 (ExtractResponse の pages[] 構造) は破壊的変更を避ける。変更時は下流 spec (attachment-search-indexing) の再検証を要する
- **upstream 依存のリスク**: anydoc は 0.x 系で公開から日が浅く、PPTX の分割は文書化されていない挙動に頼る。版を固定し、出力の契約テストで更新時の変化を検知する
