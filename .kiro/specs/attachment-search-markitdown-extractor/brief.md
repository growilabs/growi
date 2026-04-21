# Brief: attachment-search-markitdown-extractor

> 3-way split の第 1 spec。詳細背景・既存コード調査は [../attachment-search/research.md](../attachment-search/research.md) を参照。

## Problem

GROWI には現在、添付ファイル (PDF / Office 等) のテキストを抽出する能力が存在しない。全文検索機能 (attachment-search-indexing, attachment-search-ui) を実現するには、対応形式のバイト列から構造化されたテキスト (ページ/スライド/シート単位) を取り出す独立マイクロサービスが必要。

## Current State

- GROWI monorepo には Python コードが存在せず、抽出ライブラリも未採用
- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない
- microsoft/markitdown (Python、MIT、v0.1.x) が PDF/Office/テキスト系を Markdown に変換する公式ライブラリとして利用可能
- Microsoft 公式の REST API 実装は存在しない (CLI / MCP のみ)。サードパーティ pre-built image も要件を完全に満たすものは不在 (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

## Desired Outcome

- 添付ファイルのバイト列を HTTP multipart で受け取り、**ページ/スライド/シート単位に分割した Markdown テキスト** を JSON で返す独立マイクロサービスが存在する
- サービスは **ステートレス** で、k8s Deployment + HPA の共有サービス方式で運用でき、OSS docker-compose でも同梱できる
- 外部バイナリ・ネットワーク egress を要求せず、pure Python のみで完結する
- 悪意ある大容量/ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限) が組み込まれている
- Image サイズは 250〜400MB に収まる
- FastAPI の OpenAPI spec が `packages/markitdown-client` (別 spec で使用) 向けに export できる

## Approach

**services/markitdown-extractor/** に Python 3.12 + FastAPI + Uvicorn の独立サービスを新設する。

- **ディレクトリ配置**: `services/` は本プロジェクトで新設されるトップレベルディレクトリ。**pnpm workspace と turbo pipeline の対象外** (pnpm-workspace.yaml / turbo.json は変更しない)
- **抽出エンジン**: microsoft/markitdown `>=0.1.5`、extras は `[pdf,docx,xlsx,pptx,outlook]` のみ (`[all]` は絶対不使用、OCR/音声/YouTube/Azure DI を引き込むため)
- **初期化**: `MarkItDown(enable_plugins=False)` + `llm_client=None` で LLM/OCR を明示的にオフ
- **位置情報**:
  - PPTX: markitdown 出力の `<!-- Slide number: N -->` HTML コメントを解析してスライド単位分割
  - XLSX: markdown 見出しをパースしてシート単位分割
  - PDF: markitdown PR #1263 (`extract_pages=True`) が stable リリース済みなら採用、未リリースなら `pdfminer.six` 直接呼び出しのフォールバック (推定 30〜50 行)
  - DOCX/HTML/CSV/TSV/JSON/XML/YAML/TXT/RTF/EPub/Jupyter/MSG: 単一要素 (`pageNumber=null, label=null`)
- **リソース保護**: FastAPI middleware で最大サイズ制限、`asyncio.wait_for` でタイムアウト強制、グローバル semaphore で同時実行上限
- **Dockerfile**: `python:3.12-slim-bookworm` + `uv` multi-stage (builder stage で `uv sync --locked --no-dev` → runtime stage に `.venv` だけコピー)、非 root (uid 10001) 実行
- **セキュリティ**: k8s で `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, `capabilities: drop: [ALL]`, `allowPrivilegeEscalation: false`, seccomp `RuntimeDefault`, `/tmp` を size-limited tmpfs、NetworkPolicy で外部 egress 遮断
- **OpenAPI**: `scripts/export_openapi.py` で `/openapi.json` を JSON ファイルとしてエクスポート (別 spec の orval 入力)

## Scope

### In
- `services/markitdown-extractor/` ディレクトリ全体 (Dockerfile / pyproject.toml / uv.lock / src / tests / scripts / AGENTS.md / README.md)
- FastAPI app: `POST /extract` (multipart)、`GET /healthz`、`GET /readyz`、`GET /openapi.json`
- 形式別 extractor (pdf / pptx / xlsx / simple) と MIME whitelist
- リソース保護 (size / timeout / semaphore) middleware
- Pydantic schemas (ExtractResponse / PageInfo / ErrorResponse / ErrorCode)
- `pdfminer.six` 直接呼び出しの PDF ページ分割フォールバック実装
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
- markitdown のバージョン 0.0.x への対応 (`>=0.1.5` のみサポート)

## Boundary Candidates

1. **FastAPI アプリ本体** (main.py / routers/extract.py) — HTTP エンドポイントと入力バリデーション
2. **抽出オーケストレータ** (services/extraction_service.py) — MIME 判定 → 形式別 extractor への dispatch → limits 強制
3. **形式別 extractor** (services/extractors/*.py) — PDF / PPTX / XLSX / simple の 4 モジュール、純粋関数
4. **契約 schemas** (schemas.py) — Pydantic モデル、OpenAPI の source of truth
5. **運用設定** (config.py / limits.py) — 環境変数と動的制限値
6. **インフラ artifacts** (Dockerfile / docker-compose 抜粋 / k8s manifests) — デプロイ可能な成果物

## Out of Boundary

- `packages/markitdown-client` の生成パイプライン (別 spec)
- apps/app の Crowi 初期化や AttachmentService ハンドラ (別 spec)
- Elasticsearch スキーマや検索クエリ (別 spec)
- 添付ファイル一覧モーダル UI や検索結果 UI (別 spec)

## Upstream / Downstream

### Upstream (依存先)
- `microsoft/markitdown >=0.1.5` (PyPI)
- `pdfminer.six` (フォールバック用、PyPI)
- `fastapi` / `uvicorn` (PyPI)
- Python 3.12 / uv / Docker build runtime
- 既存 `apps/pdf-converter` のマイクロサービス運用パターン (Dockerfile 構造、health check 流儀) — 参考のみ、コード依存なし

### Downstream (影響先)
- `attachment-search-indexing` spec — OpenAPI spec と Docker image を消費
- OSS 配布 (growi-docker-compose) と GROWI.cloud (k8s) 運用
- 将来の高品質抽出エンジン差し替え (Docling 等) — 契約 (pages[] 構造) を保つ前提

## Existing Spec Touchpoints

- **Extends**: なし (Python サービスは本プロジェクトで初めて GROWI monorepo に入る)
- **Adjacent**: `attachment-search-indexing` (下流の消費者)、umbrella `attachment-search` (設計資料)

## Constraints

- **ランタイム/言語**: Python 3.12+ を新規導入。既存 Node/Java スタックに加え GROWI monorepo の 3 言語目となる
- **ライセンス**: markitdown は MIT、依存も MIT/Apache-2.0 互換のみ採用 (GPL/AGPL 系は禁止)
- **Image size 目標**: 250〜400MB (extras 絞り込みと multi-stage build で達成)
- **メモリ目標**: 1 worker idle ~120MB、処理中 ~500MB ピーク。k8s resources は requests 256Mi / limits 1Gi 推奨
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること (markitdown の YouTube/外部 URL 機能が誤って呼ばれても失敗することを許容)
- **互換性**: API 契約 (ExtractResponse の pages[] 構造) は破壊的変更を避ける。変更時は下流 spec (attachment-search-indexing) の再検証を要する
- **upstream 依存のリスク**: markitdown PR #1263 が未マージの場合、PDF ページ分割はフォールバック実装で吸収する
