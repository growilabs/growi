# Research: attachment-search-markitdown-extractor

_Generated: 2026-04-17 (3-way split; derived from umbrella `attachment-search`)_

本ドキュメントは、`services/markitdown-extractor` の設計判断に関わる調査のみを umbrella の [research.md](../attachment-search/research.md) と [research-docker-image.md](../attachment-search/research-docker-image.md) から抽出・再構成したものである。下流 spec (apps/app 統合、UI) に関わる調査は含めない。

## Scope of this Research

以下 6 点の設計判断について、採用根拠と代替案の比較を記録する:

1. 抽出エンジン: microsoft/markitdown / pdfminer.six の採用理由と代替案 (Apache Tika / Docling / Unstructured)
2. markitdown PR #1263 (PDF ページ分割) の状況とフォールバック設計の根拠
3. FastAPI + uv + multi-stage Dockerfile 構成の選定理由
4. extras `[pdf,docx,xlsx,pptx,outlook]` 選定の根拠
5. `services/` ディレクトリ配置と pnpm workspace 境界の決定経緯
6. 抽出エンジンの再比較と決定: anydoc + pypdfium2 (メモリ・速度・日本語の抽出品質・安全性、2026-10)

---

## 1. 抽出エンジンの採用理由

> 2026-04 時点の判断の記録。抽出エンジンは 2026-10 の再評価で anydoc + pypdfium2 に置き換えた (§6.11)。

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

## 6. 抽出エンジンの再比較と決定: anydoc + pypdfium2 (2026-10)

### 6.1 経緯と比較の前提

- 2026-08 に Firecrawl が Rust 製の変換ライブラリ [firecrawl/anydoc](https://github.com/firecrawl/anydoc) (MIT) を公開した ([gihyo.jp の紹介記事](https://gihyo.jp/article/2026/08/anydoc))。Node / Python / Rust から使え、自社計測では markitdown より高速・高品質とされる。2026-10-27 時点で v0.2.4、貢献者 9 人
- ユーザー判断 (2026-10-27):
  - apps/app のプロセス内では動かさない。anydoc を採用する場合も、抽出サービスを別コンテナで動かす現在の構成を維持し、中で使うライブラリだけを替える
  - Outlook MSG は対象外にしてよい (anydoc は MSG に非対応)。requirements.md の Req 1.5 からの削除は、エンジンの採否と合わせて決める
- markitdown 側の状況 (2026-10-27 時点): 最新は v0.1.9。PDF のページ単位抽出を足す PR #1263 は未マージのまま (最終更新 2026-06)

### 6.2 anydoc の特徴 (markitdown との違い)

| 観点 | markitdown | anydoc |
|---|---|---|
| Office 系 | DOCX / XLSX / PPTX | 加えて DOC / XLS / PPT / XLSB / OpenDocument |
| その他 | PDF / MSG / HTML / JSON / XML / CSV / EPUB / ipynb など | PDF / RTF / EPUB / CSV のみ。HTML / JSON / TXT / MSG は非対応 (`anydoc.Format` で確認) |
| PDF | pdfminer 系で抽出 | 自社の pdf-inspector で直接 Markdown 化。画像だけのページがあるとページ番号付きでエラー |
| 区切り | PPTX は `<!-- Slide number: N -->` を出す。PDF のページ区切りは無い | PPTX のスライド区切りも PDF のページ区切りも無い |
| OCR | 使わない設定 | 手元では行わない。`ocr='hosted'` を指定すると文書全体を Firecrawl Parse に送るため、無効 (既定の `reject`) のまま使う |
| 安全面 | Python。抽出サービス側で defusedxml による XXE 対策を入れている | Rust でメモリ安全。fuzz テストと、展開サイズ・入れ子の深さ・ノード数の固定上限あり。タイムアウトの指定手段は無い |

HTML / JSON / TXT を anydoc で扱えない点は、抽出サービス側で次のように補える:

- TXT / JSON / XML / YAML / MD / LOG / ipynb: 文字コードを判定 (Shift_JIS を含む) してテキストとして返す
- HTML: Python 標準の `html.parser` で script / style を除きタグを取り除く。markitdown を HTML のためだけに残すと、待機時メモリ (6.3) が markitdown 構成の水準に戻る
- CSV: anydoc に形式を明示して渡す

### 6.3 メモリと速度の実測

方法: Python 3.12 の仮想環境に `markitdown[pdf,docx,xlsx,pptx]==0.1.9` / `firecrawl-anydoc==0.2.4` / `pdfminer.six==20260107` を入れ、1 回の変換ごとに新しいプロセスを起動して計測した (各 3 回、メモリは最大値、時間は中央値)。メモリは RSS (プロセスが実際に使っている物理メモリの量)。16 コアの開発コンテナ 1 台。

サンプル: デジタル庁の公開資料 6 件 (PDF 3 件: 116 / 47 / 41 ページ、PPTX 1 件: 61 スライド、XLSX 2 件) と、日本語の文章を生成した DOCX 2 件 (40 段落 / 6,000 段落 + 表 40 個)、PPTX 1 件 (300 スライド)、XLSX 1 件 (5 シート × 2 万行 × 10 列、6MB)。

**待機時のメモリ** (ライブラリを読み込んだだけの状態。サービスの台数分かかる):

| 構成 | 待機時 |
|---|---|
| 現在の設計 (markitdown + PDF ページ分割用の pdfminer) | 148.7MB |
| anydoc + pdfminer | 35.3MB |

markitdown は読み込み時点でファイル種別判定用の機械学習モデル (magika / onnxruntime) と pandas / numpy まで読み込むため重い。

**変換中の最大メモリと時間**:

| ファイル | 大きさ | markitdown | anydoc |
|---|---|---|---|
| PDF 116 ページ | 2.3MB | 158MB / 3.1 秒 | 44MB / 7.7 秒 |
| PDF 47 ページ | 3.2MB | 158MB / 2.2 秒 | 44MB / 6.5 秒 |
| PDF 41 ページ | 4.8MB | 161MB / 0.86 秒 | 50MB / 0.07 秒 |
| PPTX 61 スライド | 5.6MB | 192MB / 0.29 秒 | 49MB / 0.04 秒 |
| XLSX 小 (2 件) | 20KB | 152MB / 0.04 秒 | 25MB / 0.002 秒 |
| DOCX 小 (生成) | 40KB | 165MB / 0.19 秒 | 30MB / 0.006 秒 |
| DOCX 大 (生成) | 0.4MB | 202MB / 1.7 秒 | 59MB / 0.05 秒 |
| PPTX 300 スライド (生成) | 0.4MB | 154MB / 0.59 秒 | 28MB / 0.01 秒 |
| XLSX 5 シート × 2 万行 (生成) | 6MB | 617MB / 36.5 秒 | 623MB / 2.1 秒 |

現在の設計の PDF 経路 (pdfminer で 1 ページずつ抽出) は、待機時から 11〜30MB 増え、1.1〜7.2 秒かかった。

### 6.4 日本語の抽出品質

方法: 基準となるテキストを別の手段で取り出し、各出力と比べた。基準は PPTX が python-pptx (図形・表・ノート)、XLSX が openpyxl、DOCX が python-docx、PDF が PyMuPDF。NFKC 正規化後の日本語 (ひらがな・カタカナ・漢字) だけを抜き出し、4 文字の並びがどれだけ一致するかを見た。

- **文字化けは見つからなかった**: U+FFFD、`(cid:N)`、私用領域の文字、康煕部首 (「⽇」のような部首用の文字)、Latin-1 として読み違えた崩れ、のいずれも、両ライブラリ・全ファイルで 0 件
- **欠落も少ない**: 基準の 4 文字の並びのうち出力に含まれる割合は、DOCX / XLSX / 生成 PPTX で 0.9995〜1.0、実物の PDF で 0.986〜0.997 (両ライブラリでほぼ同じ)。実物の PPTX の差 (anydoc 0.988 / markitdown 0.949) は並び順の違いによるもので、並び順を問わない指標では両方とも 1.0 だった (§6.8 の再検証)
- **単語の途中で文字列が切れる**: PDF の折り返し位置で、anydoc は日本語の間に空白を入れ (116 ページの PDF で 2,558 か所)、markitdown は改行を残す (同 1,904 か所)。どちらも kuromoji の単語区切りを壊すため、検索語の一致が減る。116 ページの PDF で検索語の出現数を数えると、両ライブラリとも 5〜10% 程度少なかった (例: 「情報システム」は基準 478 件に対し anydoc 443 件・markitdown 443 件)。pdfminer で 1 ページずつ抽出する経路でも、日本語の間に空白が入る箇所が 986 か所あった (「情報システム」1 語の件数は基準と一致したが、語全体の一致率は 0.966)
- **その他**: markitdown は PPTX の改行コード (垂直タブ `\x0b`) を出力にそのまま残す。anydoc は PPTX の一部で行の順番を入れ替える (表紙の日付と組織名が逆)

### 6.5 結果からの判断材料

- 待機時メモリは anydoc 構成で約 4 分の 1 になる。サービスを並べた台数分効く
- 大きな XLSX はどちらのライブラリでも約 620MB まで膨らむ。6MB の入力でこの量なので、アップロード上限 (`maxFileSizeBytes`、既定 50MB) ではメモリを抑えられない。コンテナのメモリ上限は「この倍率 × 同時変換数」で決まり、ライブラリを替えても解決しない。design で扱う
- 速さは Office 系で anydoc が 10〜30 倍速い。PDF は 3 件中 2 件で anydoc が 2〜3 倍遅い (記事のベンチマークは PDF を対象外にしていた)
- PDF はどちらのライブラリを選んでもページ単位で抽出する別経路を使うため、エンジン選択に左右されない。ページ単位の抽出方法は §6.9 で別に比較した
- PPTX を anydoc に替えるとスライド区切りが失われ、「1 添付 = スライドごとの N 文書」の設計が崩れる。PPTX だけ別の方法で分ける / 1 文書として扱う / PPTX は markitdown のまま (待機時メモリは markitdown 構成の水準に戻る) のいずれかを選ぶ必要がある
- どの抽出方法でも、日本語の間に入った 1 文字分の空白・改行を詰める後処理が要る。116 ページの PDF で語の一致率が、pdfminer の経路 0.966 → 0.997、markitdown 0.884 → 0.982、anydoc 0.878 → 0.981 に上がった (§6.8 の検索品質担当の計測)。語の途中の空白は kuromoji で語を割ることを ES の `_analyze` で確かめた

### 6.6 この比較の限界

- 実物は 6 件で、実物の DOCX は無い。大きなファイルはすべて生成したもの
- 品質は文字の一致で見ており、表の構造や読み順の正しさは目で少し確かめただけ
- 計測は開発コンテナ 1 台で行った。本番のコンテナでの値ではない
- 遅い側の処理時間 (p95) とコンテナ image の大きさは測っていない

### 6.7 外部の比較記事 (2026-10-27 時点)

自分たちで計測した記事・日本語文書を扱った記事は見つからなかった。6.3 / 6.4 の実測のほうが本用途に近い。

| 記事 | 内容 | 注意点 |
|---|---|---|
| [anydoc vs MarkItDown (file2markdown.ai, 2026-08-05)](https://www.file2markdown.ai/blog/anydoc-vs-markitdown) | anydoc は「正しく変換するか、はっきり失敗する」、markitdown は崩れた結果でも返す。一般的な Office 文書の本番処理は anydoc、形式の幅重視は markitdown、PDF 中心なら PDF 専用エンジン | 競合サービスの運営元 (OverXceed Ltd) による記事。数値の計測なし |
| [firecrawl anydoc review (Wavect, 2026-08-10、09-02 更新)](https://wavect.io/blog/firecrawl-anydoc-review/) | Firecrawl のベンチマークを批判 (評価文書が非公開、LLM 採点で人間との一致が未確認、初回起動・p95・コンテナの大きさを測っていない)。自社文書での試験導入を推奨し、受理率・p50/p95・障害率を見るべきとする | 数値は Firecrawl の公表値で、独自計測なし |
| [anydoc の bench/README](https://github.com/firecrawl/anydoc/blob/main/bench/README.md) | 比較相手は markitdown / pandoc / docling / unstructured / mammoth / LibreOffice。品質は構造要素の数と、Claude による 1 組ずつの判定 (表示順を入れ替えて 2 回) | PDF は対象外。anydoc と markitdown はプロセス起動時間を含まず、pandoc と LibreOffice は含む |
| [MarkItDown 調査 (yage.ai, 2026-04-12)](https://yage.ai/share/markitdown-survey-en-20260412.html) | OpenDataLoader Benchmark (PDF 変換 12 エンジン) で markitdown は下から 2 番目。総合 0.589 (Docling 0.882)、表の再現 0.273、見出しの階層 0.000、読み順 0.844 | AI 生成の記事。anydoc は比較対象外 |

本 spec への示唆:

- PDF を markitdown に頼らずページ単位の別経路で抽出する方針は、外部の評価 (markitdown の PDF は表と見出しが弱い) とも合う。検索用の文字取り出しが目的なので表の構造は問わないが、表の多い PDF の品質を上げる場合は Docling が候補になる
- anydoc は変換できない部分があると全体をエラーにする (暗号化・壊れたファイル・画像だけのページを含む PDF)。採用する場合は、indexing spec の Req 2.4 (失敗時はメタデータのみの文書を登録) への対応づけを決める

### 6.8 性格の異なる 5 評価者による総合評価 (2026-10-27)

A (markitdown を続ける) / B (anydoc に全面切替) / C (Office 系は anydoc、PPTX は別の方法でスライド単位に抽出、markitdown は依存から外す) の 3 案を、観点の異なる評価者 5 者に独立に判定させた。実測を行ったのは再検証担当とセキュリティ担当のみ。

| 評価者 | 判定 | 確信度 | 主な根拠 |
|---|---|---|---|
| SRE | C | 中 | 一括の作り直しでの CPU 時間とイメージの大きさが一桁違う (依存ツリー 286MB 対 8.4MB)。タイムアウトで確実に止めるには変換を kill できる子プロセスに分ける必要があり、その費用は anydoc が安い (import 0.05 秒・35MB 対 0.39 秒・149MB) |
| 検索品質 | C | 中 | anydoc の出力からはスライド番号を確実に戻せない (見出しで区切ると本文の約 23% が隣のスライドに入る)。XLSX の雑音 (`NaN` 340 個、`Unnamed: N` など) は markitdown が多い |
| セキュリティ | C | 中 (markitdown を外す点は高) | markitdown は 750KB の DOCX (展開後 300MB) でメモリ 1.5GB 超・強制終了、47KB の 10 万段入れ子 DOCX で CPU 90 秒以上占有。anydoc はどちらも 0.01 秒で上限エラー。依存は markitdown 36 個に対し anydoc 0 個 |
| 長期保守 | A | 中 | anydoc の主作者は 2026-08-27 以降コミットがなく、v0.2.4 以降リリースもない。ただし 10 月にも別の 3 人が main にコミットしており、停止はしていない (評価者の「実質停止」は言い過ぎだった) |
| 再検証 | C | 中 | 実ファイル 29 件 (DOCX 12 / PPTX 8 / XLSX 9) で anydoc は 20〜40 倍速く、メモリ約 1/6。GIL を手放すため 4 並列で 3.1 倍速くなる。markitdown は内部のファイル種別判定 (magika / onnxruntime) が変換のたびに約 10 コア分のスレッドを空回りさせる (98KB の XLSX で経過 0.34 秒に CPU 3.4 秒) |

評価の過程で判明した、ライブラリ選択とは別に対処が要る事項:

- 現在の `extraction_service.extract()` は `async def` の中で同期の変換関数を直接呼ぶため、変換中はイベントループが止まりタイムアウトが働かない (コード読みで確認)。どのライブラリでもスレッド上の変換は中断できないので、kill できる子プロセスに分ける
- anydoc の Rust 側 panic は `pyo3_runtime.PanicException` (`BaseException` 系) として上がり、`except Exception` では捕まらない (issue #189 相当を Python から再現、プロセスは落ちなかった)
- 大きな XLSX は 4 並列で anydoc 2.4GB / markitdown 1.9GB に達する。XLSX だけ受け付けるサイズ上限を下げるか同時実行数を絞る
- 壊したファイル 8 件ではどちらも 7 件失敗し、「anydoc は厳格・markitdown は寛容」という差は見られなかった。anydoc は失敗の種類ごとに例外の型が分かれる
- anydoc はシートが 1 枚のブックではシート名を出さず、非表示シートと空シートを出力しない

### 6.9 PDF のページ単位抽出の候補比較 (2026-10-27)

実物の PDF 5 件 (1〜116 ページ) を、PyMuPDF をページごとの基準にして比べた。「見つかる率」は日本語の間の空白・改行を詰める後処理をかけた後に、基準の 4 文字の並びが空白を挟まずに出力に現れる割合で、方式間の相対比較用 (基準側も表のセル境界などをまたぐため最大でも 0.76〜0.83)。

| 方式 | ライセンス | 116 ページの時間 | 最大メモリ | 文字の取りこぼし | 見つかる率 | 判定 |
|---|---|---|---|---|---|---|
| pdfminer でページごとに抽出 (旧設計) | MIT | 10.7 秒 | 65MB | なし | 最上位と同じ | 品質は良いが、ページごとに文書を読み直すため遅い |
| **pypdfium2** | BSD-3 / Apache-2.0 | 0.19 秒 | 34MB | なし | 最上位と同じ | **採用** |
| pypdf | BSD-3 | 1.7 秒 | 53MB | なし | わずかに低い | 純 Python の予備案 |
| kreuzberg | MIT | 0.39 秒 | 65MB | なし | 最上位と同じ | 中身は PDFium。配布 37MB と大きく、実物の PPTX で失敗した |
| pdf-inspector | MIT | 1.8〜3.4 秒 | 40MB | あり (1 件で約 14% 欠落) | 低い | 見送り |
| pdf-oxide | MIT / Apache-2.0 | 0.32 秒 | 82MB | あり (約 11% 欠落) | 低い | 見送り |
| pdfminer で全ページを一度に抽出 | MIT | 3.7 秒 | 45MB | あり (約 9% 欠落) | 同等 | 見送り |
| PyMuPDF | AGPL | 0.18 秒 | 146MB | なし | 同等 | ライセンス条件で対象外 |

pypdfium2 の注意点: 改行が `\r\n` で出るため後処理の前に揃える。PDFium は 1 プロセス内の複数スレッドからの同時利用を想定しないため、子プロセスに分ける構成で使う。細工した PDF への耐性と、文字のない PDF での挙動は未確認。

### 6.10 PPTX のスライド単位抽出の候補比較 (2026-10-27)

実物の PPTX 8 件 (2〜112 スライド) と生成 1 件で比べた。

| 方式 | スライド数 | 取り出した文字 | 112 スライドの時間 / 最大メモリ | 追加の依存 | 備考 |
|---|---|---|---|---|---|
| python-pptx | 全件正しい | 基準 | 0.22 秒 / 110MB | lxml + Pillow (35MB) | 垂直タブ `\x0b` が残る。結合で隠れたセルの重複文字も拾う |
| 標準ライブラリによる自前の読み取り (約 50 行) | 全件正しい | python-pptx と全 9 件で 1 文字も違わない | 0.08 秒 / 28MB | なし | SmartArt・グラフ・レイアウト継承の文字、Strict OOXML は扱わない |
| **スライドごとに 1 枚の PPTX に分けて anydoc に渡す** | 全件正しい | つなぎ直すと丸ごと anydoc に渡した結果と 1 文字も違わない | 0.53 秒 / 56MB | なし | **採用**。結合セルを 1 回だけ出し、表は Markdown で他の Office 形式と書式が揃う |
| kreuzberg | 300 スライドを 2 ページとして返した | — | — | — | 見送り |

分けてから anydoc に渡す方式の実装上の条件:

- `presentation.xml` のスライド一覧を 1 枚だけに書き換えたパッケージを作る。試作は正規表現で書き換えたが、名前空間の接頭辞や Strict OOXML に依存しないよう defusedxml で XML として解析して書き換える
- 文字の抽出に不要な画像などは入れず、対象スライドとそれが参照する部品だけに絞る (他スライドの XML まで入れると処理量が「スライド数 × XML 全体」で増える)
- XML 部品の展開は、部品ごとと合計の両方で、実際に展開した量に上限を設ける
- 参照から外したスライドや画像の抜けたパッケージを anydoc が受け付けるのは文書化されていない挙動なので、anydoc の版を固定し、「分けた結果をつなぐと丸ごと変換と一致する」ことを確かめる契約テストを置く
- anydoc が出す PowerPoint 自動生成の代替テキスト (「AI 生成コンテンツは誤りを含む可能性があります」など) と改行の印 `\` を後処理で除く
- 旧形式の .ppt は ZIP ではないため分けられない。丸ごと anydoc で変換し 1 文書として扱う
- 予備案は python-pptx (anydoc の更新で分割方式が動かなくなった場合)

### 6.11 決定 (2026-10-27、ユーザー判断)

| 対象 | 抽出方法 |
|---|---|
| DOCX / XLSX / RTF / EPUB / CSV / 旧形式 Office / OpenDocument | anydoc |
| PPTX | スライドごとに 1 枚の PPTX に分けてから anydoc |
| PDF | pypdfium2 でページごとに抽出 |
| HTML / TXT / JSON / XML / YAML / MD / LOG / ipynb | サービス自身で処理 (文字コード判定、HTML は標準の `html.parser` で script / style を除いてタグを除去) |
| Outlook MSG | 対象外 |

- markitdown と pdfminer.six は依存から外す
- 全経路の後に、改行コードを揃え、日本語の間の 1 文字分の空白・改行を詰める後処理をかける
- 将来への期待: anydoc 上流にはページ単位の抽出を作っているとみられる未マージのブランチ `feat/pdf-pages` がある。これが取り込まれ、PDF のページ区切り (さらに PPTX のスライド区切り) を anydoc が返すようになれば、pypdfium2 と PPTX の分割処理をなくし anydoc に一本化できる。取り込まれた時点で置き換えを再検討する
- 未反映: この決定は requirements.md (Req 1.5 の MSG 削除を含む)・design.md・tasks.md、サービス名 (`markitdown-extractor`) と関連する設定名 (`GROWI_MARKITDOWN_*` など) にはまだ反映していない

---

## Summary

本 spec の技術選定は「外部 egress 不要」「軽量な image」「GROWI 既存 Node 系ビルドに非侵襲」という umbrella 由来の制約の組み合わせから導出されている。抽出エンジンは 2026-04 時点では microsoft/markitdown + pdfminer.six を選んだが、2026-10 の再評価で anydoc + pypdfium2 に置き換えた (§6.11)。FastAPI + uv + `services/` 配置は変わらない。

設計判断の背景詳細 (採用 / 不採用の比較表、Docker image 実測、既製 image 調査の網羅結果) は umbrella の以下を参照:

- [../attachment-search/research.md](../attachment-search/research.md) — gap analysis / design phase discovery / implementation approach options
- [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md) — Microsoft 公式 / サードパーティ 8 件の pre-built image 比較、自前ビルドリファレンス Dockerfile
