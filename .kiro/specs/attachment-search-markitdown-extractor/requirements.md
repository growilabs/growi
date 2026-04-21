# Requirements Document

## Project Description (Input)

### 問題

GROWI monorepo には添付ファイル (PDF / Office / テキスト系) から構造化されたテキストを取り出す能力が存在しない。全文検索機能 (下流の `attachment-search-indexing` / `attachment-search-ui`) を実現する前提として、対応形式のバイト列を受け取ってページ / スライド / シート単位に分割した Markdown テキストを返す独立マイクロサービスが必要である。

### 現状

- GROWI monorepo には Python コードが存在せず、抽出ライブラリも未採用
- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない
- microsoft/markitdown (Python、MIT、v0.1.x) が PDF / Office / テキスト系を Markdown に変換する公式ライブラリとして利用可能
- Microsoft 公式の REST API 実装は存在せず、要件を完全に満たすサードパーティ pre-built image も不在 (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

### 達成したい姿

- 添付ファイルのバイト列を HTTP multipart で受け取り、ページ / スライド / シート単位に分割した Markdown テキストを JSON で返す独立マイクロサービスが存在する
- サービスはステートレスで、k8s Deployment + HPA の共有サービス方式で運用でき、OSS docker-compose でも同梱できる
- 外部バイナリ・ネットワーク egress を要求せず、pure Python のみで完結する
- 悪意ある大容量 / ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限) が組み込まれている
- Image サイズは 250〜400MB に収まる
- FastAPI の OpenAPI spec を下流 spec (`attachment-search-indexing`) の TS クライアント生成入力として export できる

### アプローチ

`services/markitdown-extractor/` に Python 3.12 + FastAPI + Uvicorn の独立サービスを新設する。`services/` は本プロジェクトで新設されるトップレベルディレクトリで、**pnpm workspace / turbo pipeline の対象外** (`pnpm-workspace.yaml` / `turbo.json` は変更しない)。抽出エンジンは microsoft/markitdown `>=0.1.5` を extras `[pdf,docx,xlsx,pptx,outlook]` のみで採用し、`[all]` は絶対に使用しない (OCR / 音声 / YouTube / Azure DI を引き込むため)。`MarkItDown(enable_plugins=False)` + `llm_client=None` で LLM / OCR を明示的にオフ。位置情報は PPTX はスライド単位、XLSX はシート単位、PDF はページ単位 (markitdown PR #1263 未マージなら `pdfminer.six` 直接呼び出しでフォールバック)、その他形式は単一要素で扱う。Dockerfile は `python:3.12-slim-bookworm` + `uv` multi-stage、非 root (uid 10001) 実行、セキュリティハードニング (read-only rootfs / capabilities drop / egress 遮断 / tmpfs `/tmp`) に対応する。

### スコープ

- **In**: `services/markitdown-extractor/` ディレクトリ全体 (Dockerfile / pyproject.toml / uv.lock / src / tests / scripts / AGENTS.md / README.md) / FastAPI app (`POST /extract` multipart、`GET /healthz`、`GET /readyz`、`GET /openapi.json`) / 形式別 extractor と MIME whitelist / リソース保護 middleware / Pydantic schemas / `pdfminer.six` フォールバック / Dockerfile / OpenAPI export script / docker-compose エントリ / k8s manifest 例 / Python 用 CI job / サービス単体テスト
- **Out**: GROWI 側統合 (AttachmentService ハンドラ登録、ES インデックス化、TS クライアントの consumer 実装、検索結果 UI、管理画面、抽出失敗ログの Mongo 永続化等) は下流 spec の責務。画像 OCR / 音声動画文字起こし / YouTube / Azure DI / ZIP 再帰展開 / Docling 等は本 spec のスコープ外

### 制約

- **ランタイム / 言語**: Python 3.12+ を新規導入。GROWI monorepo の 3 言語目 (Node / Java / Python)
- **ライセンス**: markitdown は MIT、依存も MIT / Apache-2.0 互換のみ採用 (GPL / AGPL 系は禁止)
- **Image size 目標**: 250〜400MB
- **メモリ目標**: 1 worker idle ~120MB、処理中 ~500MB peak。k8s resources は requests 256Mi / limits 1Gi 推奨
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること
- **互換性**: API 契約 (`ExtractResponse.pages[]` 構造) は破壊的変更を避ける。変更時は下流 spec (`attachment-search-indexing`) の再検証を要する
- **upstream 依存リスク**: markitdown PR #1263 が未マージの場合、PDF ページ分割はフォールバック実装で吸収する

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は、GROWI の添付ファイル全文検索機能 (umbrella `attachment-search`) を 3-way split した結果のうち、**添付ファイルからテキストを抽出する Python マイクロサービス**単体を対象とする。`services/markitdown-extractor/` 配下の FastAPI アプリケーション、Dockerfile、デプロイ artifacts、OpenAPI export スクリプトを一つの閉じた成果物として完成させる。

抽出サービスは純粋に「バイト列 → `pages[]` 構造の Markdown テキスト」への変換のみを責務とする。形式判定、形式別の位置情報抽出 (PDF ページ / PPTX スライド / XLSX シート)、リソース保護 (サイズ / タイムアウト / 同時実行)、外部 egress 遮断下での動作、k8s 向けセキュリティハードニング、OpenAPI spec の export が本 spec の範囲である。

GROWI 本体 (apps/app) との統合、TS クライアント消費、Elasticsearch インデックス化、検索結果 UI、管理画面は下流 spec (`attachment-search-indexing` / `attachment-search-ui`) の責務であり、本 spec には含めない。本 spec が安定した API 契約と Docker image を提供することで、下流 spec が並行して開発可能となる。

## Boundary Context

- **In scope (feature responsibility)**:
  - `services/markitdown-extractor/` 配下の FastAPI アプリケーション実装
  - PDF / DOCX / XLSX / PPTX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter Notebook / Outlook MSG に対応する形式別 extractor
  - 位置情報付き `pages[]` 構造の返却 (PDF = ページ / PPTX = スライド / XLSX = シート、その他は単一要素)
  - リソース保護 (最大ファイルサイズ / タイムアウト / 同時実行上限 semaphore)
  - 外部 egress 遮断下での動作と pure Python 依存
  - Pydantic schemas (`ExtractResponse` / `PageInfo` / `ErrorResponse` / `ErrorCode`) と API 契約
  - Dockerfile (uv multi-stage、非 root、セキュリティハードニング対応)
  - k8s manifest 例 (Deployment + Service + HPA + NetworkPolicy + securityContext)
  - docker-compose エントリ (OSS 配布向け)
  - OpenAPI export script (`scripts/export_openapi.py`) — 下流 spec への成果物インタフェース
  - Python 用 CI job (ruff lint / pytest / image build)
  - サービス単体テスト
- **Out of scope (explicitly not owned)**:
  - apps/app 側の統合実装 (AttachmentService ハンドラ登録、抽出結果の ES 取り込み、失敗ログ Mongo 永続化、検索クエリの multi-index 集約、admin API、検索結果 UI、添付ファイル一覧モーダル、管理画面拡張)
  - `packages/markitdown-client` の生成 / 配布パイプライン (OpenAPI spec の export のみ本 spec が行い、orval 設定と生成成果物の消費は下流 spec)
  - 画像 OCR / 音声動画文字起こし / YouTube 取り込み / Azure Document Intelligence / ZIP 再帰展開 / Docling 等の高精度抽出
  - markitdown `<0.1.5` への対応
  - Elasticsearch / MongoDB への直接アクセス (サービスはステートレス、DB 依存ゼロ)
- **Adjacent expectations (this feature relies on these)**:
  - microsoft/markitdown `>=0.1.5` が PyPI から取得可能である
  - `pdfminer.six` が PyPI から取得可能である (フォールバック用)
  - Docker / Kubernetes のランタイム (cgroups / seccomp / NetworkPolicy 対応 CNI) が前提
  - 下流 spec (`attachment-search-indexing`) は本 spec が export する OpenAPI spec を入力として orval で TS クライアントを生成し、HTTP multipart で `POST /extract` を呼ぶ

## Requirements

### Requirement 1: 添付ファイルからのテキスト抽出

<!-- derived from umbrella Requirement 1 -->

**Objective:** As a 抽出サービス利用者 (下流の GROWI apps/app および将来のクライアント), I want 対応形式の添付ファイルから構造化されたテキスト抽出結果を取得する, so that 全文検索インデックスへの投入と位置情報表示 (ページ / スライド / シート単位) を可能にする

#### Acceptance Criteria

1. When 対応形式の添付ファイルが抽出サービスに渡される, the 抽出サービス shall 抽出結果を `pages` 配列 (各要素は `pageNumber` / `content` / `label`) として返却する <!-- derived from umbrella R1.1 -->
2. When PPTX ファイルが抽出サービスに渡される, the 抽出サービス shall スライド単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にスライド番号表示文字列を設定する <!-- derived from umbrella R1.2 -->
3. When XLSX ファイルが抽出サービスに渡される, the 抽出サービス shall シート単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にシート名を設定する <!-- derived from umbrella R1.3 -->
4. When PDF ファイルが抽出サービスに渡される, the 抽出サービス shall ページ単位で `pages` 配列を返却し、各要素の `pageNumber` にページ番号を、`label` にページ番号表示文字列を設定する <!-- derived from umbrella R1.4 -->
5. When DOCX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (`.txt`, `.log`, `.md`) / RTF / EPub / Jupyter Notebook / Outlook MSG のいずれかが抽出サービスに渡される, the 抽出サービス shall 単一要素の `pages` 配列を返却し、`pageNumber` と `label` を null とする <!-- derived from umbrella R1.5 -->
6. If サポート対象外の形式が抽出サービスに渡される, the 抽出サービス shall 抽出を行わず、サポート対象外を示すエラーコードを返却する <!-- derived from umbrella R1.6 -->
7. The 抽出サービス shall 運用環境で外部バイナリおよびネットワーク egress を要求せずに動作する <!-- derived from umbrella R1.7 -->

### Requirement 2: 抽出処理のリソース保護と隔離

<!-- derived from umbrella Requirement 2 (AC 2.1, 2.2, 2.3, 2.6 のみ。2.4/2.5 は apps/app 側責務として attachment-search-indexing spec へ) -->

**Objective:** As a SRE / 抽出サービス運用者, I want 悪意ある大容量添付や破損ファイルが抽出サービスを不安定化させないよう、抽出処理に上限と隔離を設ける, so that サービス全体の可用性とマルチテナント公平性を保つ

#### Acceptance Criteria

1. If 添付ファイルサイズが設定された上限を超える, the 抽出サービス shall 抽出を行わず、ファイルサイズ超過を示すエラーコードを返却する <!-- derived from umbrella R2.1 -->
2. If 抽出処理が設定されたタイムアウトを超える, the 抽出サービス shall 当該リクエストを打ち切り、タイムアウトを示すエラーコードを返却する <!-- derived from umbrella R2.2 -->
3. While 抽出サービスが設定された同時リクエスト上限に達している, the 抽出サービス shall 以降のリクエストを受理せず、サービスビジーを示すエラーコードを返却する <!-- derived from umbrella R2.3 -->
4. The 抽出サービス Pod / コンテナ shall 外部ネットワーク egress が遮断された状態で正常動作する <!-- derived from umbrella R2.6 -->

### Requirement 3: デプロイメントとセキュリティハードニング

<!-- derived from umbrella Requirement 13 (AC 13.1, 13.2, 13.3, 13.5 のみ。13.4 は apps/app 側責務として attachment-search-indexing spec へ) -->

**Objective:** As a GROWI 配布者 (OSS / GROWI.cloud), I want 抽出サービスを既存の配布体系 (docker-compose / k8s) に合流させ、セキュリティ強制された形で運用する, so that 既存運用者の導入負担を抑えつつ、コンテナエスケープや外部通信による情報漏洩リスクを低減する

#### Acceptance Criteria

1. The OSS docker-compose 配布 shall 抽出サービスを単一コンテナとして同梱し、既存の compose 体系に追加する <!-- derived from umbrella R13.1 -->
2. The GROWI.cloud (k8s) 配布 shall 抽出サービスを共有 Deployment として提供し、負荷に応じて HPA により自動スケールする <!-- derived from umbrella R13.2 -->
3. The 抽出サービスのデプロイ構成 shall read-only root filesystem、非 root 実行、capabilities drop、network egress 遮断、tmpfs ベースの一時領域を推奨設定として提供する <!-- derived from umbrella R13.3 -->
4. The 抽出サービス shall 状態を持たず (ステートレス)、任意のレプリカ数でスケール可能である <!-- derived from umbrella R13.5 -->

### Requirement 4: マルチテナント隔離

<!-- derived from umbrella Requirement 14 (AC 14.2, 14.3 のみ。14.1/14.4/14.5 は apps/app / ES index 側責務として attachment-search-indexing / attachment-search-ui spec へ) -->

**Objective:** As a GROWI.cloud 運用者, I want 抽出処理がマルチテナント共有基盤の他テナントに波及しないよう分離する, so that 共有 ES クラスタへの抽出負荷集中と、特定テナントによる他テナント抽出の停止を防ぐ

#### Acceptance Criteria

1. The 添付テキスト抽出処理 shall 共有 Elasticsearch クラスタの ingest ノード上では実行しない <!-- derived from umbrella R14.2 -->
2. While あるテナントからの抽出要求が集中している, the 抽出サービス shall 設定された全体同時実行上限により、他テナントの抽出要求を完全停止させない <!-- derived from umbrella R14.3 -->
