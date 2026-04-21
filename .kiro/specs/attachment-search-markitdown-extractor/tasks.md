# 実装計画

> 本 spec は pnpm workspace / turbo pipeline の対象外である `services/markitdown-extractor/` 配下の Python マイクロサービスを対象とする。すべてのタスクは Python (uv / FastAPI / pytest / ruff) ツールチェーンで完結する。

## 1. Foundation: プロジェクト基盤と設定

- [ ] 1.1 Python プロジェクトスキャフォールドと依存管理基盤を作成
  - `services/markitdown-extractor/` ディレクトリを新設し、`.python-version` (3.12) / `pyproject.toml` / `uv.lock` を配置
  - `pyproject.toml` で `markitdown[pdf,docx,xlsx,pptx,outlook]>=0.1.5` / `fastapi` / `uvicorn` / `pydantic>=2` / `pydantic-settings` / `pdfminer.six` / `defusedxml` / dev-deps (`pytest` / `httpx` / `ruff`) を宣言
  - `[all]` extras と GPL/AGPL 依存を取り込まないことを宣言 (コメントで根拠明記)
  - ruff 設定 (`[tool.ruff]`) を `pyproject.toml` に記述
  - 完了条件: `uv sync --locked --no-dev` が成功し、`uv run python -c "import markitdown, fastapi, pdfminer, defusedxml"` が 0 exit で完了する
  - _Requirements: 1.7_
  - _Boundary: Project scaffold_

- [ ] 1.2 設定ローダ (`config.py`) を実装
  - `pydantic-settings` ベースで `MAX_FILE_SIZE_MB` (default 50) / `TIMEOUT_S` (default 60) / `MAX_CONCURRENCY` (default `max(2, workers*2)`) / `MAX_EXTRACTED_BYTES` (default 500*1024*1024) / `LOG_LEVEL` (default `INFO`) / `MARKITDOWN_SERVICE_TOKEN` (必須、未設定で起動失敗) を環境変数から読み込み
  - `MARKITDOWN_SERVICE_TOKEN` が未設定または空文字の場合、設定生成時に例外を raise し fail fast
  - 完了条件: 環境変数未設定でインスタンス化すると `ValidationError` (or 同等) が raise され、すべて設定した状態では全フィールドが型付きで参照できる
  - _Requirements: 2.1, 2.2, 2.3, 3.3_
  - _Boundary: Config_

- [ ] 1.3 Pydantic スキーマ (`schemas.py`) を定義
  - `PageInfo` (`pageNumber: int | None`, `label: str | None`, `content: str`) を定義
  - `ExtractResponse` (`pages: list[PageInfo]`, `mimeType: str`, `extractedCharacters: int`) を定義
  - `ErrorCode` 列挙型に `unauthorized` / `unsupported_format` / `file_too_large` / `extraction_timeout` / `service_busy` / `extraction_failed` を定義
  - `ErrorResponse` (`code: ErrorCode`, `message: str`) を定義
  - 完了条件: `ExtractResponse.model_json_schema()` が `pages`/`mimeType`/`extractedCharacters` を含む JSON Schema を返し、`ErrorCode` 全 6 値が enum として確認できる
  - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 3.3_
  - _Boundary: Schemas_

- [ ] 1.4 pytest 設定と共通 fixture 基盤を整備
  - `tests/conftest.py` に FastAPI TestClient fixture と `MARKITDOWN_SERVICE_TOKEN` をテスト用に注入する fixture を実装
  - `tests/fixtures/` ディレクトリを作成し、サンプル PDF / PPTX / XLSX / DOCX / TXT / JSON を配置する placeholder と生成スクリプトを含む
  - ruff config を pytest が参照できる状態にし、`uv run pytest --collect-only` が通るダミーテストを配置
  - 完了条件: `uv run pytest` がテスト 0 件成功 (または placeholder 1 件 pass) で終了し、TestClient fixture が以降のタスクから import 可能
  - _Requirements: 1.1_
  - _Boundary: Test infrastructure_

## 2. Core: リソース保護とセキュリティ中核

- [ ] 2.1 リソース制限モジュール (`limits.py`) を実装
  - グローバル `asyncio.Semaphore(MAX_CONCURRENCY)` を non-blocking 取得 (`acquire_nowait` 相当) で試行し、失敗時に `ServiceBusy` 例外を raise
  - multipart ストリーム受信時の累積バイト数計測で上限超過時に `FileTooLarge` 例外を raise (`Content-Length` 詐称対策を含む)
  - `asyncio.wait_for(coro, TIMEOUT_S)` で extractor 呼び出しをラップし、超過時に `ExtractionTimeout` 例外を raise
  - semaphore が常に release されることを `AsyncContextManager` で保証
  - 完了条件: 単体テストで semaphore 満杯→`ServiceBusy`、サイズ超過→`FileTooLarge`、タイムアウト→`ExtractionTimeout` の 3 経路が green
  - _Requirements: 2.1, 2.2, 2.3, 4.2_
  - _Boundary: Limits_

- [ ] 2.2 Bearer 認証 middleware (`middleware/bearer_auth.py`) を実装
  - `Authorization: Bearer <token>` ヘッダを `hmac.compare_digest` で `MARKITDOWN_SERVICE_TOKEN` と照合
  - `POST /extract` には適用、`GET /healthz` / `GET /readyz` / `GET /openapi.json` は bypass
  - 不一致/欠落時は size check / semaphore 取得の**前**に 401 `unauthorized` + `ErrorResponse` を返却
  - `ALLOW_UNAUTHENTICATED` 等の opt-out を一切提供しない
  - 完了条件: 単体テストで token 正 → 後続 handler に到達、欠落/不一致 → 401 が size check より先に返ることを assert
  - _Requirements: 3.3_
  - _Boundary: BearerAuthMiddleware_

- [ ] 2.3 XXE ハードニングブート処理を実装
  - app factory の起動パスで `defusedxml.defuse_stdlib()` を呼び `xml.etree` / `xml.sax` / `xml.dom` を差し替え
  - `lxml` が import 可能な場合、`XMLParser(resolve_entities=False, no_network=True)` が default であることを assert し、違反時は fail fast
  - 起動時 assertion が通過したことを INFO log に記録
  - 完了条件: 単体テストで defuse が適用済みであることを確認 (`xml.etree.ElementTree` の parser が defusedxml 版に差し替えられている)
  - _Requirements: 1.7, 2.4_
  - _Boundary: Security bootstrap_

- [ ] 2.4 zip bomb ガード (`MAX_EXTRACTED_BYTES`) を実装
  - extractor レイヤで展開後バイト数を累積し、`config.MAX_EXTRACTED_BYTES` 超過で `ExtractionFailed` (zip bomb 由来の理由を message に含む) を raise
  - OOXML / EPub の zip 展開経路に適用 (markitdown 呼び出し前後でサイズ計測ポイントを設置)
  - 完了条件: 50MB 圧縮/数 GB 展開を模した fixture で 500 `extraction_failed` が返り、プロセスメモリが limits 以内に収まることを単体テストで確認
  - _Requirements: 2.1, 2.2_
  - _Boundary: Limits, Extractors_

## 3. Core: 形式別 Extractor

> 全 extractor は framework 非依存の純粋関数 (`bytes → list[PageInfo]`) として実装する。依存は markitdown / pdfminer.six のみ。

- [ ] 3.1 (P) PDF extractor を実装
  - 起動時 capability probe (`inspect.signature(MarkItDown().convert_stream)`) で `extract_pages` parameter の有無を判定し、module global に `PDF_EXTRACTION_STRATEGY` (`markitdown` | `pdfminer_fallback`) をキャッシュ
  - `markitdown` 経路: `convert_stream(..., extract_pages=True)` を呼び、ページ毎の markdown を `PageInfo(pageNumber=i, label=f"Page {i}", content=md)` で組み立て
  - `pdfminer_fallback` 経路: `pdfminer.high_level.extract_text_to_fp` を `page_numbers=[i]` で繰り返し呼び同形式で組み立て
  - 採用 strategy を INFO log に 1 行出力
  - 完了条件: 3 ページの PDF fixture で `pages[].pageNumber == [1, 2, 3]` かつ全 content が非空になるユニットテストが 2 strategy (mock で切替) の両方で green
  - _Requirements: 1.4, 1.7_
  - _Boundary: PDF Extractor_

- [ ] 3.2 (P) PPTX extractor を実装
  - markitdown 出力の `<!-- Slide number: N -->` HTML コメントを regex でパースしスライド単位に分割
  - 各スライドを `PageInfo(pageNumber=N, label=f"Slide {N}", content=slide_md)` として返却
  - 完了条件: 5 スライド PPTX fixture で `len(pages) == 5` かつ `[p.label for p in pages] == ["Slide 1", ..., "Slide 5"]` のユニットテストが green
  - _Requirements: 1.2, 1.7_
  - _Boundary: PPTX Extractor_

- [ ] 3.3 (P) XLSX extractor を実装
  - markitdown 出力の `## SheetName` 見出しで分割
  - 各シートを `PageInfo(pageNumber=i, label=sheet_name, content=sheet_md)` (1 始まり序数、label にシート名) として返却
  - 完了条件: 2 シート XLSX fixture で `pages[].label` が実際のシート名列と一致するユニットテストが green
  - _Requirements: 1.3, 1.7_
  - _Boundary: XLSX Extractor_

- [ ] 3.4 (P) Simple extractor (単一要素形式) を実装
  - DOCX / HTML / CSV / TSV / JSON / XML / YAML / `.txt` `.log` `.md` / RTF / EPub / Jupyter Notebook (.ipynb) / Outlook MSG の 14 種を扱う
  - markitdown を `enable_plugins=False` + `llm_client=None` で呼び、結果を単一要素 `PageInfo(pageNumber=None, label=None, content=md)` として返却
  - 完了条件: 上記各形式の代表 fixture で `len(pages) == 1` かつ `pageNumber is None` / `label is None` が満たされるユニットテストが green
  - _Requirements: 1.5, 1.7_
  - _Boundary: Simple Extractor_

- [ ] 3.5 Extractor registry と `ExtractionService` オーケストレータを実装
  - `services/extractors/__init__.py` で MIME → extractor callable の whitelist registry を定義
  - `services/extraction_service.py` で MIME ヘッダ優先 + 拡張子フォールバックの判定を行い、whitelist 外は `UnsupportedFormat` を raise
  - 対応 extractor に `(bytes, filename)` を渡し `list[PageInfo]` を受け取る
  - 完了条件: 対応 MIME を全て dispatch でき、非対応 MIME (`application/x-custom`) で `UnsupportedFormat` が raise されるユニットテストが green
  - _Requirements: 1.1, 1.6_
  - _Boundary: ExtractionService, Extractors registry_
  - _Depends: 3.1, 3.2, 3.3, 3.4_

## 4. Core: HTTP レイヤ (FastAPI app)

- [ ] 4.1 Health ルータ (`routers/health.py`) を実装
  - `GET /healthz` はプロセス生存確認のみで `{"status": "ok"}` を返却
  - `GET /readyz` は semaphore 余裕 + 依存モジュール import 成功 + PDF strategy (`pdf_extraction_strategy`) を応答 JSON に含めて返却。未 ready なら 503 `not_ready`
  - 両エンドポイントは認証不要
  - 完了条件: TestClient で `/healthz` → 200、`/readyz` → 200 かつ `pdf_extraction_strategy` フィールドを含むことを確認
  - _Requirements: 3.2, 3.4_
  - _Boundary: HealthRouter_

- [ ] 4.2 Extract ルータ (`routers/extract.py`) を実装
  - `POST /extract` を multipart で受け付け、`file` (必須) / `mimeType` (任意 hint) パラメータを扱う
  - 処理順序: Bearer 認証 → semaphore 取得 → サイズ check → MIME 判定 → extractor dispatch (timeout 包み) → `ExtractResponse` 組み立て (`extractedCharacters` は全 pages content 合計長)
  - 例外 → `ErrorResponse` + 対応 HTTP ステータス (400/401/408/413/500/503) のマッピングを一貫適用
  - 完了条件: TestClient で正常系 PDF → 200 + `ExtractResponse` 構造が返ることを確認
  - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 3.3_
  - _Boundary: ExtractRouter_
  - _Depends: 2.1, 2.2, 3.5_

- [ ] 4.3 FastAPI app factory (`main.py`) を実装
  - 起動時に `config` 読み込み (token 未設定で fail fast) → defusedxml 適用 → PDF capability probe → ルータ配線 → BearerAuthMiddleware 配線 → 構造化 JSON ログ middleware 配線
  - `/openapi.json` が Pydantic schema ベースの OpenAPI 3.x を返すことを確認 (FastAPI 自動生成)
  - 完了条件: `uv run uvicorn app.main:app --port 8000` で起動し、`/healthz` / `/readyz` / `/openapi.json` / `/extract` (auth 必須) が期待どおり応答
  - _Requirements: 1.1, 3.3, 3.4_
  - _Boundary: FastAPI app_
  - _Depends: 2.2, 2.3, 4.1, 4.2_

- [ ] 4.4 構造化 JSON ログ middleware を実装
  - `requestId` / `method` / `path` / `statusCode` / `latencyMs` / `fileSize` / `mimeType` / `errorCode?` を stdout に JSON 1 行で出力
  - 完了条件: TestClient リクエスト 1 件で captured stdout に上記フィールドを含む JSON が出力されることを確認
  - _Requirements: 2.1, 2.2, 2.3, 3.3_
  - _Boundary: Logging middleware_
  - _Depends: 4.3_

## 5. OpenAPI エクスポートスクリプト

- [ ] 5.1 `scripts/export_openapi.py` を実装
  - `--output <path>` で書き出し先を指定可能。`app.openapi()` の結果を JSON として指定パスに出力
  - CI から `--output ../../packages/markitdown-client/openapi.json` で呼ばれることを想定 (本 spec は書き出しのみ担当、パッケージ配置は下流 spec 責務)
  - 完了条件: `uv run python scripts/export_openapi.py --output /tmp/openapi.json` 実行で有効な OpenAPI 3.x JSON が生成され、`ExtractResponse` / `ErrorResponse` / `ErrorCode` の全 schema を含む
  - _Requirements: 1.1_
  - _Boundary: OpenAPI Export_
  - _Depends: 4.3_

## 6. 統合テスト (FastAPI TestClient)

- [ ] 6.1 (P) 認証パスの統合テスト
  - 正しい token → 200、欠落 → 401、不一致 → 401、大容量 (size check より前) でも token 不一致なら 401 が優先されること
  - 完了条件: 上記 4 ケースすべて green で `/healthz` `/readyz` `/openapi.json` が認証なしで 200 になることも別途 assert
  - _Requirements: 3.3_
  - _Boundary: ExtractRouter, BearerAuthMiddleware_
  - _Depends: 4.3_

- [ ] 6.2 (P) 形式別抽出 E2E テスト
  - PDF / PPTX / XLSX / DOCX / TXT / JSON の各 fixture で `POST /extract` → 200 + `ExtractResponse` が期待どおり (pages 数、label、pageNumber)
  - サポート外形式 (`application/x-custom`) → 400 `unsupported_format`
  - 完了条件: 全形式テストが green
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Boundary: ExtractRouter, ExtractionService_
  - _Depends: 4.3_

- [ ] 6.3 (P) リソース制限 E2E テスト
  - 大容量 (> `MAX_FILE_SIZE_MB`) → 413 `file_too_large`
  - ハング fixture + `TIMEOUT_S=1` → 408 `extraction_timeout`
  - 並列 10 リクエスト + `MAX_CONCURRENCY=2` → 8 リクエストが 503 `service_busy`
  - 完了条件: 3 シナリオすべて green
  - _Requirements: 2.1, 2.2, 2.3, 4.2_
  - _Boundary: Limits, ExtractRouter_
  - _Depends: 4.3_

- [ ] 6.4 (P) XXE / zip bomb セキュリティテスト
  - DOCX に `<!DOCTYPE foo SYSTEM "http://attacker/">` を埋め込んだ fixture で外部エンティティが解決されず、attacker への通信が発生しない (network stub で assert) または 500 `extraction_failed`
  - 50MB 圧縮 / 数 GB 展開の OOXML zip bomb fixture で 500 `extraction_failed` かつメモリが pod limit 以内
  - 完了条件: 両シナリオが green で network stub に外部通信記録がない
  - _Requirements: 1.7, 2.1, 2.4_
  - _Boundary: Security, Extractors_
  - _Depends: 4.3_

- [ ] 6.5 起動時 fail-fast テスト
  - `MARKITDOWN_SERVICE_TOKEN` 未設定で app factory を呼ぶと起動時例外が raise されること
  - defusedxml 未適用状態が検出されると起動失敗すること (mock で強制)
  - 完了条件: 両 fail-fast が green
  - _Requirements: 3.3_
  - _Boundary: FastAPI app, Security bootstrap_
  - _Depends: 4.3_

## 7. コンテナ化と配布 artifacts

- [ ] 7.1 Dockerfile (multi-stage) を作成
  - Builder stage: `python:3.12-slim-bookworm` + `uv` で `uv sync --locked --no-dev` 実行し `.venv` 生成
  - Runtime stage: `python:3.12-slim-bookworm`、`.venv` のみコピー、非 root (uid 10001) で起動、WORKDIR `/app`
  - `USER 10001`、entrypoint `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-2}`
  - apt パッケージは最小限 (ffmpeg 等不要)、`/tmp` は tmpfs 前提で書き込み
  - 完了条件: `docker build -t markitdown-extractor:ci .` が成功、`docker run` で `/healthz` 200、image サイズ 450MB 未満
  - _Requirements: 3.1, 3.3, 3.4_
  - _Boundary: Dockerfile_
  - _Depends: 4.3_

- [ ] 7.2 docker-compose エントリを追加
  - `infra/docker/compose.yaml` に `markitdown-extractor` service を追加 (build/image、env、depends_on 不要)
  - `networks:` に `internal: true` の user-defined bridge を定義し egress を遮断 (default 構成で opt-in 不要)
  - `MARKITDOWN_SERVICE_TOKEN` を env file 経由で注入する書式を同梱 (値は空欄の `.env.example`)
  - 完了条件: `docker compose up markitdown-extractor` で起動 + ヘルスチェック通過、他サービスと同一 network で疎通
  - _Requirements: 3.1_
  - _Boundary: docker-compose_
  - _Depends: 7.1_

- [ ] 7.3 k8s manifests を作成 (必須成果物、NetworkPolicy 同梱)
  - `infra/k8s/markitdown-extractor/deployment.yaml`: Deployment + `securityContext` (`readOnlyRootFilesystem: true` / `runAsNonRoot: true` / `runAsUser: 10001` / `capabilities.drop: [ALL]` / `allowPrivilegeEscalation: false` / seccomp `RuntimeDefault`) / `/tmp` を tmpfs (`emptyDir.sizeLimit: 512Mi`) / resources (requests 256Mi / limits 1Gi) / `MARKITDOWN_SERVICE_TOKEN` を k8s Secret から env 注入
  - `service.yaml`: ClusterIP
  - `hpa.yaml`: CPU 60% target、`minReplicas: 2`、`maxReplicas: 20`
  - `network-policy.yaml`: **必須**。egress は cluster DNS のみ、ingress は apps/app label 経由のみ許可 (opt-in ではなく default 提供)
  - `secret.example.yaml`: token 注入雛形 (値は空欄)
  - 完了条件: 全 manifest が `kubectl apply --dry-run=client -f` で有効と判定される
  - _Requirements: 3.2, 3.3, 3.4, 4.1, 4.2, 2.4_
  - _Boundary: k8s manifests_
  - _Depends: 7.1_

## 8. CI ワークフロー (品質ゲート)

- [ ] 8.1 Python 専用 GitHub Actions workflow を実装
  - `.github/workflows/markitdown-extractor.yml` を新設
  - `paths: ['services/markitdown-extractor/**', 'packages/markitdown-client/openapi.json']` で発火
  - 必須 jobs (すべて required status check、いずれか fail で merge 不可):
    - lockfile 整合性 (`uv sync --locked --no-dev`)
    - Lint (`uv run ruff check .`)
    - Format (`uv run ruff format --check .`)
    - Unit tests (`uv run pytest`)
    - Docker build (`docker build -t markitdown-extractor:ci .`)
    - Image size check (`docker image inspect` が **450MB 超**で fail)
    - Trivy scan (`trivy image --severity CRITICAL,HIGH --exit-code 1 markitdown-extractor:ci`)
    - OpenAPI drift 検知 (`uv run python scripts/export_openapi.py --output ../../packages/markitdown-client/openapi.json && git diff --exit-code packages/markitdown-client/openapi.json`)
  - main branch 限定で `docker push ghcr.io/growilabs/markitdown-extractor:<tag>` を実行
  - 既存 Node workflow (`pnpm-workspace.yaml` / `turbo.json`) は**一切変更しない**
  - 完了条件: PR 上で全 job が実行され、意図的に lint エラーを入れた PR で workflow が fail、正常 PR で全 green
  - _Requirements: 3.3_
  - _Boundary: CI workflow_
  - _Depends: 5.1, 7.1_

## 9. 最終統合と検証

- [ ] 9.1 全タスク統合検証
  - 全形式 E2E (6.2) + 認証 (6.1) + リソース (6.3) + セキュリティ (6.4) + fail-fast (6.5) を一括実行
  - Docker image smoke test: `docker build` → image size 測定 (250〜400MB 目標 / 450MB 上限) → コンテナ起動 → `/healthz` 200 → `readOnlyRootFilesystem: true` で起動可能 → egress 全遮断下で `POST /extract` (PDF) 成功
  - OpenAPI drift 検知のローカル実行と生成物の schema 完全性確認 (`ExtractResponse` / `ErrorResponse` / `ErrorCode` を含む)
  - Requirements トレーサビリティ再確認 (1.1-1.7, 2.1-2.4, 3.1-3.4, 4.1-4.2 全タスクへのマッピング)
  - 完了条件: すべての統合テストと smoke test が green、image size が目標帯に収まり、egress 遮断テストが成功
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2_
  - _Boundary: Integration (all)_
  - _Depends: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 8.1_
