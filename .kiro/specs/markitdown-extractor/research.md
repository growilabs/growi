# Research: markitdown-extractor

_Generated: 2026-04-17 (3-way split; derived from umbrella `full-text-search-for-attachments`)_

本ドキュメントは、`services/markitdown-extractor` の設計判断に関わる調査のみを umbrella の [research.md](../full-text-search-for-attachments/research.md) と [research-docker-image.md](../full-text-search-for-attachments/research-docker-image.md) から抽出・再構成したものである。下流 spec (apps/app 統合、UI) に関わる調査は含めない。

## Scope of this Research

以下 5 点の設計判断について、採用根拠と代替案の比較を記録する:

1. 抽出エンジン: microsoft/markitdown / pdfminer.six の採用理由と代替案 (Apache Tika / Docling / Unstructured)
2. markitdown PR #1263 (PDF ページ分割) の状況とフォールバック設計の根拠
3. FastAPI + uv + multi-stage Dockerfile 構成の選定理由
4. extras `[pdf,docx,xlsx,pptx,outlook]` 選定の根拠
5. `services/` ディレクトリ配置と pnpm workspace 境界の決定経緯

---

## 1. 抽出エンジンの採用理由

### 1.1 microsoft/markitdown (採用)

- **ライセンス**: MIT
- **バージョン**: `>=0.1.5` を要求 (`0.0.x` は alpha、API 不安定なため)
- **採用理由**:
  - PDF / Office / テキスト系 (HTML / CSV / JSON / XML / YAML / RTF / EPub / Jupyter / MSG) を単一 API (`convert_stream`) でカバー
  - 出力が Markdown で、検索インデックス化に親和的 (構造情報が緩く保持される)
  - Microsoft 公式メンテナンス、活発な commit とリリース (2025-12 に v0.1.4、PyPI で 0.1.5 配布中)
  - pure Python で完結する extras (`[pdf,docx,xlsx,pptx,outlook]`) のみを選択可能。外部バイナリ (ffmpeg 等) や外部 API (Azure DI) への依存を切り離せる

### 1.2 pdfminer.six (フォールバック採用)

- **ライセンス**: MIT
- **役割**: markitdown の PDF 抽出がページ番号情報を返さない版 (PR #1263 未マージ時) のための、ページ分割用直接呼び出し
- **採用理由**:
  - pure Python、追加外部依存なし
  - `high_level.extract_text_to_fp(page_numbers=[i])` で任意ページのみ抽出でき、ページ境界を自前でループ制御可能
  - 実装量は 30〜50 行程度と小さい

### 1.3 不採用: Apache Tika (ES ingest-attachment)

- **不採用理由**:
  - GROWI.cloud は共有 Elasticsearch クラスタ構成のため、ingest ノードに抽出負荷を載せるとマルチテナント間で干渉する (umbrella research.md の Current State 参照)
  - Java ランタイムと Tika サーバプロセスを k8s に追加することになり、Python の方が image が軽く言語境界も clean
  - 本 spec は umbrella の R14.2 (「抽出は共有 ES ingest ノードでは実行しない」) を要件として継承している

### 1.4 不採用: Docling

- **不採用理由**:
  - 高精度 (レイアウト / 表構造) だが image が大きく (数 GB 規模の Docker image)、image 250〜400MB 目標に乗らない
  - GPU or 重い ML 依存 (PyTorch 等) で k8s Pod の resource requests が跳ね上がる
  - 検索用途では markitdown の markdown 出力で十分、高精度抽出は将来 enhancement

### 1.5 不採用: Unstructured

- **不採用理由**:
  - 対応形式は豊富だが extras が細分化しておらず、不要依存を切り落としにくい
  - メンテナンス姿勢と API 安定性が markitdown (Microsoft 公式) より不確実

### 1.6 不採用: apps/app 内で Node ライブラリ直接抽出

- 候補: unpdf + officeparser 等
- **不採用理由**:
  - Office 抽出品質 (特に PPTX / XLSX の構造保持) が markitdown 比で劣る
  - apps/app のイベントループ上で重い抽出を行うと他リクエストに影響
  - Python エコシステムの方がテキスト抽出ライブラリが豊富で、将来 Docling 等への差し替え余地も広い

### 1.7 不採用: markitdown TS ポート

- **不採用理由**:
  - 個人メンテナのみで実装が未成熟、Node ライブラリの薄いラッパで独自価値が小さい
  - Microsoft 公式の Python 版と乖離するリスク

---

## 2. markitdown PR #1263 の状況とフォールバック

### 2.1 現状

- **PR**: microsoft/markitdown#1263 `extract_pages=True` オプションを PDF converter に追加
- **状態** (2026-04-17 時点): OPEN、2026-03-28 最終更新、1 件 APPROVAL review
- **マージ見込み**: 不明 (Microsoft の review pace 依存)

### 2.2 フォールバック設計の根拠

本 spec リリース時点で PR #1263 が stable released されている保証がないため、**`pdfminer.six` 直接呼び出しによる PDF ページ分割を初期実装に同梱する**方針を採用する。

- 実装場所: `src/app/services/extractors/pdf_extractor.py`
- 実装量: 推定 30〜50 行
- 切替方針:
  1. 第一選択: markitdown の `convert_stream()` を呼び、レスポンスにページ情報 (PR #1263 の API) があればそれを使用
  2. フォールバック: ページ情報が無ければ `pdfminer.six.high_level.extract_text_to_fp` を `page_numbers=[i]` で繰り返し呼び、自前で `PageInfo(pageNumber=i, label=f"Page {i}", content=...)` を構築

### 2.3 PPTX / XLSX はフォールバック不要

- **PPTX**: 現行 stable の markitdown が既に `<!-- Slide number: N -->` HTML コメントを出力 (確認済み)。regex パースで分割可能
- **XLSX**: 現行 stable の markitdown が `## SheetName` 形式の markdown 見出しで各シートを出力。見出しパースで分割可能

### 2.4 Revalidation Trigger

PR #1263 がマージ + markitdown stable リリースに到達した場合、pdfminer.six フォールバックコードは削除して markitdown API 直接利用に切り替え可能。本 spec の Open Questions に記録 (design.md 参照)。

---

## 3. FastAPI + uv + multi-stage Dockerfile 構成の選定理由

### 3.1 HTTP Framework: FastAPI

- **採用理由**:
  - 非同期 (asyncio) native で `asyncio.wait_for` による timeout 強制が自然に書ける (悪意ある PDF のハング対策: R2.2)
  - Pydantic v2 との統合で、`ExtractResponse` / `ErrorResponse` が OpenAPI schema の source of truth になる
  - `/openapi.json` を自動生成、下流 spec の orval 入力として追加コストなく export 可
  - multipart/form-data handling が標準装備
  - FastAPI TestClient で統合テストが書きやすい
- **代替案**:
  - Flask: 非同期サポートが弱く、OpenAPI 生成は別 extension 必要
  - Tornado / aiohttp: OpenAPI 自動生成がなく、Pydantic 統合も薄い

### 3.2 ビルドツール: uv (Astral)

- **ライセンス**: Apache-2.0
- **採用理由**:
  - Rust 実装で高速、CI 時間短縮
  - `uv.lock` による reproducible build が強制できる (`uv sync --locked --no-dev`)
  - multi-stage Dockerfile の builder stage で venv を作成し、runtime stage にコピーするパターンが公式 recipe にある
  - Python 3.12 を含めた complete lockfile を生成 (pip + pip-tools + virtualenv の責務を一本化)
- **代替案**:
  - Poetry: 安定しているが uv より遅く、multi-stage docker build の公式 recipe が薄い
  - pip + pip-tools: 素朴だが lockfile 整合性を自前で担保する必要あり

### 3.3 Dockerfile: `python:3.12-slim-bookworm` + multi-stage

- **ベース image**: `python:3.12-slim-bookworm` (Debian 12 ベース、glibc、apt 利用可能)
- **採用理由**:
  - multi-stage で builder stage に `uv` を入れて `.venv` を生成、runtime stage には `.venv` だけコピーすることで image を最小化
  - 非 root ユーザ (uid 10001) で実行、`readOnlyRootFilesystem: true` 互換
  - ffmpeg / exiftool 等は入れない (audio-transcription extras を選ばないため不要、markitdown 公式 Dockerfile はこれらを含むため重い)
  - 目標 image サイズ 250〜400MB を達成 (umbrella research-docker-image.md の実測ベース)
- **代替案と不採用理由**:
  - `python:3.12-alpine`: musl libc で pdfminer.six / markitdown 依存に build 問題が出る恐れ、CI 時間も伸びがち
  - `distroless/python3`: 完全 non-shell で debug が困難、pdfminer.six の実行時 glibc 依存確認コスト高
  - Microsoft 公式 image (`mcp/markitdown`): 378.5MB だが `markitdown[all]` フル構成のため audio/OCR を引き込み image が膨らむ、かつ MCP 用途で REST API 非対応

### 3.4 既製 image を採用しなかった理由

umbrella research-docker-image.md の調査結論:

- **Microsoft 公式**: REST API を提供していない (CLI / MCP 用途のみ)
- **サードパーティ**: 要件 (軽量 extras 指定 / health probe / 認証 / pre-built) を**全て満たす** image は 0 件
- 最有力候補 `ghcr.io/dezoito/markitdown-api` は pre-built で MIT だが、health probe 欠如、バージョン pin なし、本番投入に改修要
- **結論**: 要件を厳密に満たすには自前ビルドが最も早い (半日程度)。本 spec はこの結論を採用する

---

## 4. extras `[pdf,docx,xlsx,pptx,outlook]` 選定の根拠

### 4.1 PyPI の markitdown extras 一覧

`all / audio-transcription / az-doc-intel / docx / outlook / pdf / pptx / xls / xlsx / youtube-transcription`

### 4.2 本 spec の選定と除外

| Extra | 採否 | 理由 |
|-------|------|------|
| `pdf` | **採用** | PDF 対応 (R1.4) |
| `docx` | **採用** | DOCX 対応 (R1.5) |
| `xlsx` | **採用** | XLSX 対応 (R1.3)。`xls` は legacy なので XLSX のみ |
| `pptx` | **採用** | PPTX 対応 (R1.2) |
| `outlook` | **採用** | Outlook MSG 対応 (R1.5) |
| `xls` | 不採用 | 要件外 (legacy XLS は対象外) |
| `audio-transcription` | **不採用** | ffmpeg を引き込み image が 600MB 超に膨らむ。音声対応は要件外 (R1.7 外部バイナリ不要原則) |
| `youtube-transcription` | **不採用** | 外部 URL 取り込み、egress 遮断要件 (R2.4) と非整合 |
| `az-doc-intel` | **不採用** | Azure Document Intelligence (外部 API)、egress 要件違反 |
| `all` | **絶対不採用** | 上記すべてを引き込む |

### 4.3 extras 指定なしでカバーする形式

`HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (.txt, .log, .md) / RTF / EPub / Jupyter Notebook (.ipynb)` は markitdown コアがサポートするため extras 不要。

> ただし **RTF** は markitdown コアの対応が限定的な可能性あり。実装時に要確認。必要なら `markitdown-sample-plugin` 相当の軽量依存を追加するか、または単純な RTF-to-text 変換ロジックを `simple_extractor.py` 内に組み込む。

### 4.4 初期化方針

```python
from markitdown import MarkItDown
md = MarkItDown(enable_plugins=False)  # プラグイン不使用
# llm_client は渡さない → 画像 OCR / LLM 補助は完全オフ
```

- `enable_plugins=False`: sample-plugin 等を呼ばない
- `llm_client=None` (default): markitdown が画像に対して GPT-4V 等の LLM を呼ぶ経路を閉じる
- これにより EXIF メタデータ抽出のみに留まり、外部 egress / API キー不要で動作

---

## 5. `services/` ディレクトリ配置の決定経緯

### 5.1 umbrella `/kiro-validate-design` での結論

umbrella design.md で議論された配置候補:

- Option A: `apps/markitdown-extractor/` (既存 `apps/pdf-converter` と同列)
- Option B: `packages/markitdown-extractor/`
- Option C: **`services/markitdown-extractor/` (採用)**

### 5.2 採用理由

- **言語境界の明示**: `apps/` / `packages/` は pnpm workspace と turbo pipeline の管理対象で Node 系前提。Python を混ぜると `pnpm install` / `turbo run build` の依存グラフが複雑化する
- **workspace 外ディレクトリ**: `services/` を新設し、**`pnpm-workspace.yaml` / `turbo.json` は変更しない**。Python 独自のツールチェーン (uv / pytest / ruff) で自己完結させる
- **将来の追加 Python / Java サービスに拡張可能**: `services/` という一般名を使うことで、将来他言語のマイクロサービスが追加されても同じ慣習で配置可能

### 5.3 不採用理由

- **Option A (`apps/`)**: pnpm workspace に Python を混ぜると `turbo run build` が壊れる、`package.json` のないディレクトリを workspace から除外する設定が必要になる
- **Option B (`packages/`)**: packages は「TS ライブラリ」の慣習が強く、ランタイムサービスを置くのは GROWI の既存設計から逸脱する

### 5.4 CI 配線

- `services/markitdown-extractor/` 用の GitHub Actions workflow を**独立して新設** (`.github/workflows/markitdown-extractor.yml`)
- 既存 Node 系 workflow には影響しない
- 具体コマンド (`uv sync --locked` / `uv run pytest` / `uv run ruff check` / `docker build`) は実装時に確定 (Open Question)

---

## Summary

本 spec の技術選定はすべて「pure Python 完結」「外部 egress 不要」「image 250〜400MB」「GROWI 既存 Node 系ビルドに非侵襲」という umbrella 由来の制約の組み合わせから導出されている。microsoft/markitdown + pdfminer.six (フォールバック) + FastAPI + uv + `services/` 配置の組み合わせが、これらを同時に満たす唯一に近い解である。

設計判断の背景詳細 (採用 / 不採用の比較表、Docker image 実測、既製 image 調査の網羅結果) は umbrella の以下を参照:

- [../full-text-search-for-attachments/research.md](../full-text-search-for-attachments/research.md) — gap analysis / design phase discovery / implementation approach options
- [../full-text-search-for-attachments/research-docker-image.md](../full-text-search-for-attachments/research-docker-image.md) — Microsoft 公式 / サードパーティ 8 件の pre-built image 比較、自前ビルドリファレンス Dockerfile
