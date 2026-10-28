# Research: attachment-search-text-extractor

_最終更新: 2026-10-28_

この文書は、`services/attachment-text-extractor` (添付ファイルからテキストを取り出す Python サービス) の技術選定について、調べたことと決めたことをまとめたものである。下流 spec (apps/app への組み込み、UI) に関わる調査は含めない。

読む順番:

1. **決定事項** — いま決まっていること。実装はここに従う
2. **採用理由と根拠** — なぜそう決めたか。予備案と、判断に使った計測値
3. **不採用にした選択肢** — 検討して採らなかったものと、その理由の一覧
4. **既存実装とのギャップ分析** — design フェーズの入力。design に入る前の未決事項は §4.5 (すべて確定済み)
5. **経緯** — 判断が変わってきた流れの要約と、参考にした外部記事

umbrella 側の資料: [../attachment-search/research.md](../attachment-search/research.md) (末尾の「抽出アーキテクチャ選択の根拠」)、[../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md) (既製の Docker image の調査)。

---

## 1. 決定事項

### 1.1 形式ごとの抽出方法

| 対象 | 抽出方法 | 返す単位 (`pages[]`) |
|---|---|---|
| DOCX / RTF / EPUB / CSV | firecrawl/anydoc | 1 要素 |
| XLSX | `xl/workbook.xml` の中でシート名を一意な目印に置き換え、全シートを表示状態にしてから anydoc を 1 回だけ呼び、出力を目印の見出しで切る (全シートのセル数が 10 万を超えるものは変換の前に上限超過のエラーにする) | シートごと |
| PPTX | スライドごとに 1 枚だけの PPTX パッケージに分けてから、それぞれを anydoc に渡す | スライドごと |
| 旧形式 PPT | 分けられない (ZIP ではない) ので、丸ごと anydoc に渡す | 1 要素 |
| 旧形式 DOC / XLS、OpenDocument (ODT / ODS / ODP) | anydoc (XLS は anydoc の形式名 `xlsx` を明示して渡す) | 1 要素 |
| PDF | pypdfium2 でページごとに取り出す。開くのにパスワードが要らない (オーナーパスワードのみの) PDF は抽出する | ページごと |
| CSV / TSV | 文字コードを判定して UTF-8 にしてから、anydoc に形式 `csv` を明示して渡す (区切り文字は anydoc が判定する) | 1 要素 |
| HTML | サービス自身で処理する。Python 標準の `html.parser` で script / style を除き、タグを取り除く | 1 要素 |
| TXT / MD / LOG / JSON / YAML | サービス自身で処理する。文字コードを判定してデコードしたテキストをそのまま返す (JSON / YAML は解析しない) | 1 要素 |
| XML | サービス自身で処理する。DOCTYPE を取り除き、タグを取り除いたテキストを返す (エンティティは展開しない) | 1 要素 |
| ipynb | サービス自身で処理する。セルの source と、テキストの出力 (stream、text/plain) を取り出す。画像の base64 は捨て、出力ごとに文字数の上限を設ける | 1 要素 |
| Outlook MSG | 対象外。サポート対象外のエラーを返す | — |

- markitdown と pdfminer.six は依存に入れない。
- 改行コードを LF に揃える処理は、すべての経路の最後にかける。
- 日本語の文字 (ひらがな・カタカナ・漢字) の間に入った 1 文字分の半角空白・改行を取り除く処理は、PDF の経路だけにかける (Req 1.9)。語の途中の切れが見つかったのは PDF の抽出だけで、TXT や DOCX などの改行・空白は書き手が入れたものだから。全角空白と段落の区切り (2 つ以上続く改行) は残す。
- どちらの後処理も、入出力が文字列だけの純粋関数にする。
- 後処理の後に中身が空になった要素は `pages[]` から除く。ただし `pages[]` は最低 1 要素を必ず返す (全部が空なら中身が空の 1 要素)。下流の indexing は `pages[]` の要素ごとに検索文書を作り、ファイル名だけの文書は失敗したときにしか作らないため、空の配列を返すと画像だけの PDF や空のブックがファイル名でも見つからなくなる。
- 文字コードの判定は、BOM → UTF-8 (厳密) → charset-normalizer (候補を `cp932` / `euc_jp` / `iso2022_jp` / `cp1252` に絞る) → cp932 → latin-1 の順に試す。HTML は先頭の `<meta charset>` を優先する。

### 1.2 ライブラリごとの使い方の条件

**anydoc**

- 版を固定する。0.x 系で公開から日が浅く、PPTX の分割は文書化されていない挙動に頼るため。
- 形式は中身から判定させず、呼び出し側で明示して渡す。
- `ocr='hosted'` は使わない。指定すると文書全体を外部の Firecrawl Parse に送ってしまう。既定の `reject` のまま使う。
- 例外は `Exception` ではなく `BaseException` まで捕まえる。Rust 側の panic (Rust の異常終了) は `pyo3_runtime.PanicException` として上がり、これは `BaseException` 系なので `except Exception` では捕まらない。
- anydoc は変換できない部分が 1 か所でもあると、文書全体をエラーにする (暗号化されたファイル、壊れたファイルなど)。部分的な結果は返らない。
- anydoc には処理時間の上限を指定する手段がない。時間切れの打ち切りは、子プロセスごと止めることで実現する (§1.3)。

**PPTX の分割 (分けてから anydoc に渡す方式)**

- `presentation.xml` のスライド一覧を、対象の 1 枚だけに書き換えたパッケージを作る。書き換えは正規表現ではなく、defusedxml で XML として解析して行う (名前空間の接頭辞や Strict OOXML の違いに左右されないようにするため)。
- パッケージには、対象スライドと、そのスライドが参照する部品だけを入れる。文字の抽出に要らない画像などは入れない。他のスライドの XML まで入れると、処理量が「スライド数 × XML 全体」に膨らむ。
- XML 部品を展開するときは、部品ごとと合計の両方について、実際に展開したバイト数に上限を設ける (宣言上のサイズではなく、実際に展開した量で数える)。
- 契約テストを置く。「スライドごとに分けて変換した結果をつなぎ直すと、丸ごと anydoc に渡した結果と一致する」ことを確かめる。参照から外したスライドや画像の抜けたパッケージを anydoc が受け付けるのは文書化されていない挙動なので、anydoc の版を上げるたびにこのテストで変化を検知する。
- anydoc が出力する PowerPoint の自動生成の代替テキスト (「AI 生成コンテンツは誤りを含む可能性があります」など) と、改行の印として出る `\` を後処理で取り除く。
- 旧形式の .ppt は ZIP ではないため分けられない。丸ごと anydoc で変換し、1 要素として返す。

**pypdfium2**

- 改行が `\r\n` で出るので、日本語の後処理の前に LF に揃える。
- PDFium (pypdfium2 の中身) は、1 つのプロセスの中で複数のスレッドから同時に使うことを想定していない。スレッドではなく、別々のプロセスから使う。
- 開くのにパスワードが要る PDF は `PdfiumError` (err_code 4 / 5) になる。これを暗号化として扱う。オーナーパスワードだけの PDF は普通に開けるので抽出する (Req 1.12)。
- 画像だけの PDF は例外にならず、全ページで `count_chars()` が 0 になる。空の結果として扱う (上の「最低 1 要素」の規則に従う)。
- 壊れた PDF は err_code 1 / 2 / 3 になるが、PDFium が修復して全文を取り出せることもある。ページ数の上限はサービス側で設ける (空白ページ 10 万枚で 1.3 秒・155MB)。

**XLSX のシート分割**

- `xl/workbook.xml` の中で、各シートの名前を `ZZ<リクエストごとの乱数><連番>ZZ` に置き換え、非表示のシートを表示状態に戻してから、anydoc を 1 回だけ呼ぶ。出力を `## 目印` の行で切り、目印から元のシート名に戻す。30 シートのファイルで 205ms。
- 元のシート名は、XML の文字参照 (`&lt;` など) を元に戻してから使う。
- `pageNumber` は workbook.xml に並んでいる順番 (1 始まり、非表示・空・グラフのシートも数える) にし、`label` は元のシート名にする。空のシートは返さないので番号が飛ぶことがある。非表示のシートは、ファイルを開いた人なら誰でも表示に戻せるので対象に含める。
- シートが 1 枚だけのブックでは anydoc は見出しを出さないので、出力全体を 1 要素とし、`pageNumber=1`、`label` を workbook.xml のシート名にする。空のシートとグラフだけのシートは目印が現れないが、返さないシートなので問題にしない。
- 置き換えていない目印が出てくる、目印の順番が食い違う、最初の目印より前に空でないテキストがある、のどれかに当たるときだけ、XLSX 全体を 1 要素として返し、ログに残す (別のシート分割処理を持たない)。
- anydoc の版を固定した比較テストを置く。

**ZIP を書き換える経路の前提**

- PPTX と XLSX は、`zipfile.is_zipfile` が真で、必要な部品 (`ppt/presentation.xml` / `xl/workbook.xml`) があるときだけ書き換えの経路に入れる。暗号化された OOXML や旧形式は ZIP ではない (中身は CFB 形式) ので、書き換えずに形式を明示して anydoc にそのまま渡す。こうすると anydoc から型の付いた例外 (`EncryptedError` など) が返る。
- ZIP を開く前に、`infolist()` でエントリ数と、申告された展開後のサイズの合計を確かめる。CPython は申告されたサイズを超えて展開しない (超えると CRC エラーになる) ことを確かめたので、申告値の検査で足りる。

### 1.3 サービスの構成

- **動かす場所**: apps/app のプロセスの中では動かさない。独立したコンテナとして動かし、apps/app からは HTTP (multipart) で呼ぶ。
- **配布**: GROWI.cloud では k8s の共有 Deployment + HPA (負荷に応じて Pod 数を自動で増減する仕組み) として、テナント間で共有する。OSS 版は docker-compose に 1 コンテナとして同梱する。サービスは状態を持たない。
- **変換の実行**: 変換は、リクエストごとに 1 つの子プロセスで実行する。子プロセスは Python 標準の multiprocessing の forkserver 方式 (起動時に小さな親プロセスを 1 つ立てておき、変換のたびにそこから子を複製する方式) で作る。
  - 時間切れのときは親が子に SIGKILL を送る。これで変換そのものが止まり、同時実行の枠とメモリが解放される (Req 2.5)。
  - 1 件の異常終了は、その子の中で閉じる (Req 2.7)。
  - メモリの主な守りは、親が子の RSS (プロセスが実際に使っている物理メモリの量) を 50ms ごとに見張り、上限を超えたら止める方式にする。OS の仮想メモリ上限 (`RLIMIT_AS`) は最後の歯止めとして、RSS の上限より大きめに設定する。
  - 親と子のやり取りは Pipe だけで行い、子から親へは JSON を 1 回送る (pickle は使わない)。共有メモリ (`/dev/shm`) は使わない。
  - uvicorn のワーカーが落ちたときに子が残らないよう、子は「依頼元のワーカーだけが書き込み側を持つパイプ」を見張り、それが閉じたら自分で終了する。CPython の非公開属性には頼らない。
  - 全体の同時実行数は「uvicorn のワーカー数 × ワーカーごとの枠の数」になる。既定はワーカー 1 つとし、`MAX_CONCURRENCY` がそのまま全体の上限になるようにする。
- **HTTP フレームワーク**: Python 3.12 + FastAPI + Uvicorn。
- **ビルドツール**: uv。`uv.lock` で依存を固定し、`uv sync --locked --no-dev` で入れる。
- **Dockerfile**: `python:3.12-slim-bookworm` をベースにした multi-stage 構成 (ビルド用の段と実行用の段を分け、実行用には成果物だけをコピーする構成)。ビルド用の段で uv を使って `.venv` を作り、実行用の段には `.venv` だけをコピーする。ffmpeg や exiftool などの外部バイナリは入れない。
- **実行ユーザー**: 非 root (uid 10001)。k8s の `readOnlyRootFilesystem: true` / `runAsNonRoot: true` / `capabilities: drop: [ALL]` / `allowPrivilegeEscalation: false` / seccomp `RuntimeDefault`、`/tmp` はサイズ上限つきの tmpfs、という設定で動くようにする。
- **image の大きさ**: 400MB 以下を目標にする。
- **置き場所**: リポジトリ直下に `services/` を新設し、`services/attachment-text-extractor/` に置く。`services/` は pnpm workspace と turbo の対象にしない (`pnpm-workspace.yaml` / `turbo.json` は変更しない)。Python 側は uv / pytest / ruff で完結させる。
- **CI**: このサービス専用の GitHub Actions workflow (`.github/workflows/attachment-text-extractor.yml`) を新しく作る。既存の Node 系 workflow には手を入れない。
- **OpenAPI → TS クライアント**: Pydantic のスキーマ (`ExtractResponse` / `PageInfo` / `ErrorResponse` / `ErrorCode`) を API 契約の正本とする。`scripts/export_openapi.py` で `/openapi.json` をファイルに書き出し、下流 spec がそれを入力に orval で `packages/attachment-text-extractor-client` を生成する。書き出しまでが本 spec の責務。

### 1.4 外部とのつながりとライセンス

- **OCR と LLM は使わない**。画像の文字認識も、LLM による補助もしない。
- **外向き通信 (egress) なしで動く**。k8s では NetworkPolicy で外向き通信を遮断する。anydoc の `ocr='hosted'` を使わないのはこのため (§1.2)。
- **外部バイナリを使わない**。依存は PyPI から入る Python パッケージだけにする。ネイティブ拡張を含む wheel (ビルド済みの配布パッケージ) は使ってよい。anydoc と pypdfium2 はこれにあたる。
- **ライセンスは MIT / Apache-2.0 / BSD / PSF などの許容的なライセンスのものだけ**を採用する (defusedxml などは PSF)。GPL / AGPL 系は使わない。LGPL の `pebble` も使わないことにした (§3.7)。anydoc の wheel に同梱された SBOM の 113 部品も MIT / Apache / BSD / Zlib 系のみ。

| 採用した依存 | ライセンス |
|---|---|
| firecrawl/anydoc (`firecrawl-anydoc`) | MIT |
| pypdfium2 | BSD-3 / Apache-2.0 |
| uv | Apache-2.0 |
| charset-normalizer | MIT |

anydoc・pypdfium2・charset-normalizer は、いずれも linux x86_64 / aarch64 の manylinux_2_17 用 wheel がある (anydoc は musllinux 用も、abi3)。`python:3.12-slim-bookworm` (glibc 2.36) で問題なく動く。

### 1.5 見直しの条件

次のことが起きたら、この決定を見直す。

- **anydoc がページ・スライドの区切りを返すようになったとき**: anydoc 上流には、ページ単位の抽出を作っているとみられる未マージのブランチ `feat/pdf-pages` がある。これが取り込まれ、PDF のページ区切り (さらに PPTX のスライド区切り) を anydoc が返すようになれば、pypdfium2 と PPTX の分割処理をなくして anydoc に一本化できる。取り込まれた時点で置き換えを検討する。
- **anydoc の版上げで PPTX 分割の契約テストが通らなくなったとき**: PPTX は python-pptx に切り替える (§2.6)。
- **pypdfium2 が使えなくなったとき**: PDF は pypdf に切り替える (§2.5)。
- **表の多い PDF の品質を上げたくなったとき**: Docling を候補にする (いまは image の大きさの条件で不採用、§3.2)。

### 1.6 未決事項

なし。§4.5 の各項目は design で確定した (確定先を §4.5 の各項目に書いてある)。エラーコードの対応、設定の既定値、配備の条件は design.md に書く。

---

## 2. 採用理由と根拠

### 2.1 計測の方法

- **環境**: 16 コアの開発コンテナ 1 台。Python 3.12 の仮想環境に `markitdown[pdf,docx,xlsx,pptx]==0.1.9` / `firecrawl-anydoc==0.2.4` / `pdfminer.six==20260107` などを入れた。
- **メモリと速度**: 1 回の変換ごとに新しいプロセスを起動して測った (各 3 回、メモリは最大値、時間は中央値)。メモリは RSS (プロセスが実際に使っている物理メモリの量) で見た。
- **サンプル**: デジタル庁の公開資料 6 件 (PDF 3 件: 116 / 47 / 41 ページ、PPTX 1 件: 61 スライド、XLSX 2 件) と、生成したファイル (日本語の DOCX 2 件: 40 段落 / 6,000 段落 + 表 40 個、PPTX 1 件: 300 スライド、XLSX 1 件: 5 シート × 2 万行 × 10 列、6MB)。これとは別に、実ファイル 29 件 (DOCX 12 / PPTX 8 / XLSX 9)、実物の PDF 5 件 (1〜116 ページ)、実物の PPTX 8 件 (2〜112 スライド) でも比べた。
- **日本語の品質**: 別の手段で取り出したテキストを基準にした (PPTX は python-pptx で図形・表・ノート、XLSX は openpyxl、DOCX は python-docx、PDF は PyMuPDF)。NFKC 正規化 (全角英数などを標準の字形に揃える処理) をかけたうえで日本語 (ひらがな・カタカナ・漢字) だけを抜き出し、4 文字の並びがどれだけ一致するかを見た。PyMuPDF は計測の基準として使っただけで、依存には入れない。

### 2.2 Office 系に anydoc を使う理由

比べた相手は、それまで採用していた markitdown (`[pdf,docx,xlsx,pptx]`) である。

**待機時のメモリ** (ライブラリを読み込んだだけの状態。サービスの Pod の数だけかかる):

| 構成 | 待機時 |
|---|---|
| markitdown + PDF のページ分割用の pdfminer | 148.7MB |
| anydoc + pdfminer | 35.3MB |

- markitdown は読み込んだ時点で、ファイル種別を判定する機械学習モデル (magika / onnxruntime) と pandas / numpy まで読み込むため重い。
- 読み込みにかかる時間とメモリは anydoc 0.05 秒・35MB、markitdown 0.39 秒・149MB。変換を子プロセスで動かす (§1.3) と、子プロセスを作るときにこの費用がかかるので、軽いほうが有利になる。
- 依存の大きさは anydoc 8.4MB に対し markitdown 286MB。依存パッケージの数は anydoc 0 個に対し markitdown 36 個。

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

- Office 系では anydoc が 10〜30 倍速い。実ファイル 29 件 (DOCX / PPTX / XLSX) では 20〜40 倍速く、メモリは約 6 分の 1 だった。
- anydoc は変換中に GIL (Python で同時に 1 つのスレッドしか Python のコードを実行できないようにする仕組み) を手放すので、4 並列にすると 3.1 倍速くなった。
- markitdown は内部のファイル種別判定 (magika / onnxruntime) が、変換のたびに約 10 コア分のスレッドを空回りさせる。98KB の XLSX で、経過時間 0.34 秒に対し CPU 時間が 3.4 秒かかった。共有サービスでは他の変換の CPU を奪う。
- PDF は 3 件中 2 件で anydoc のほうが 2〜3 倍遅い。ただし PDF は anydoc にも markitdown にも任せず pypdfium2 で取り出す (§2.5) ので、この差は判断に影響しない。

**細工したファイルへの耐性**:

| 入力 | markitdown | anydoc |
|---|---|---|
| 750KB の DOCX (展開すると 300MB) | メモリが 1.5GB を超え、強制終了された | 0.01 秒で上限エラー |
| 47KB の DOCX (10 万段の入れ子) | CPU を 90 秒以上占有 | 0.01 秒で上限エラー |

- anydoc は Rust 製でメモリ安全であり、fuzz テスト (壊した入力を大量に与えて異常を探す試験) を行っている。展開後のサイズ・入れ子の深さ・ノード数に固定の上限がある。
- 壊したファイル 8 件では、どちらのライブラリも 7 件で失敗した。外部記事にある「anydoc は厳格・markitdown は寛容」という差は、この試験では見られなかった。anydoc は失敗の種類ごとに例外の型が分かれている (`EncryptedError` / `MalformedError` / `MissingPartError` / `ResourceLimitError` / `UnsupportedError`) ので、エラーコードに対応づけやすい。

**出力の質**:

- XLSX の雑音 (`NaN` が 340 個、`Unnamed: N` という列名など) は markitdown のほうが多い。
- markitdown は PPTX の改行コード (垂直タブ `\x0b`) を出力にそのまま残す。
- anydoc は PPTX の一部で行の順番を入れ替える (表紙の日付と組織名が逆になった)。
- anydoc は、シートが 1 枚だけのブックではシート名を出さない。非表示のシートと空のシートは出力しない (§4.5 の 2 で扱う)。

**機能の違い**:

| 観点 | markitdown | anydoc |
|---|---|---|
| Office 系 | DOCX / XLSX / PPTX | 加えて DOC / XLS / PPT / XLSB / OpenDocument |
| その他 | PDF / MSG / HTML / JSON / XML / CSV / EPUB / ipynb など | PDF / RTF / EPUB / CSV のみ。HTML / JSON / TXT / MSG は扱えない (`anydoc.Format` で確認) |
| PDF | pdfminer 系で取り出す | 自社の pdf-inspector で直接 Markdown にする。画像だけのページがあるとページ番号つきでエラーになる |
| 区切り | PPTX は `<!-- Slide number: N -->` を出す。PDF のページ区切りは無い | PPTX のスライド区切りも PDF のページ区切りも無い |
| OCR | 使わない設定にできる | 手元では行わない。`ocr='hosted'` を指定したときだけ外部に送る |
| 安全面 | Python。XXE (XML の外部参照を悪用する攻撃) 対策は抽出サービス側で defusedxml を使って入れる | Rust でメモリ安全。fuzz テストと固定の上限あり。処理時間の上限は指定できない |

anydoc は旧形式 Office と OpenDocument も扱えるので、対象形式を増やせた (Req 1.8)。

### 2.3 テキスト系をサービス自身で処理する理由

- anydoc は HTML / JSON / TXT を扱えない。
- HTML のためだけに markitdown を残すと、待機時のメモリが markitdown 構成の水準 (約 150MB) に戻ってしまう。HTML から検索用の文字を取り出すだけなら、Python 標準の `html.parser` で足りる。
- TXT / JSON / XML / YAML / MD / LOG / ipynb は、文字コードを判定してそのまま返せばよく、変換ライブラリは要らない。

### 2.4 子プロセスで変換する理由

- 旧実装の `extraction_service.extract()` は `async def` の中で同期の変換関数を直接呼んでいる。変換中はイベントループが止まるため、`asyncio.wait_for` によるタイムアウトは変換が終わるまで発火しない (コードを読んで確認)。
- 変換をスレッドに逃がしても、Python ではスレッド上の処理を外から止められない。Req 2.5 (処理そのものを止めて、枠とメモリを解放する) を満たすには、kill できる子プロセスに分けるしかない。これはライブラリの選択に関係なく必要になる。
- anydoc の panic (`PanicException`) は、Python から再現した範囲ではプロセスを落とさなかった (issue #189 相当)。それでも想定外の異常終了を他のリクエストに波及させないため、子プロセスで隔離する。
- PDFium は 1 プロセス内の複数スレッドからの同時利用を想定していない (§1.2)。

### 2.5 PDF に pypdfium2 を使う理由

実物の PDF 5 件 (1〜116 ページ) を、PyMuPDF のページごとの出力を基準にして比べた。「見つかる率」は、日本語の後処理をかけた後に、基準の 4 文字の並びが空白を挟まずに出力に現れる割合である。方式どうしを比べるための値で、基準側も表のセルの境目などをまたぐため、最大でも 0.76〜0.83 にとどまる。

| 方式 | ライセンス | 116 ページの時間 | 最大メモリ | 文字の取りこぼし | 見つかる率 | 判定 |
|---|---|---|---|---|---|---|
| **pypdfium2** | BSD-3 / Apache-2.0 | 0.19 秒 | 34MB | なし | 最上位と同じ | **採用** |
| pypdf | BSD-3 | 1.7 秒 | 53MB | なし | わずかに低い | 純 Python の予備案 |
| pdfminer でページごとに取り出す (旧設計) | MIT | 10.7 秒 | 65MB | なし | 最上位と同じ | 不採用 (遅い) |
| pdfminer で全ページを一度に取り出す | MIT | 3.7 秒 | 45MB | あり (約 9% 欠落) | 同等 | 不採用 |
| kreuzberg | MIT | 0.39 秒 | 65MB | なし | 最上位と同じ | 不採用 (§3.2) |
| pdf-inspector | MIT | 1.8〜3.4 秒 | 40MB | あり (1 件で約 14% 欠落) | 低い | 不採用 |
| pdf-oxide | MIT / Apache-2.0 | 0.32 秒 | 82MB | あり (約 11% 欠落) | 低い | 不採用 |
| PyMuPDF | AGPL | 0.18 秒 | 146MB | なし | 同等 | 不採用 (ライセンス) |

- pypdfium2 は速さ・メモリ・取りこぼしのなさのすべてで最上位にいて、ライセンスの条件も満たす。
- 予備は pypdf。純 Python なので wheel やプラットフォームの心配がない。速さは pypdfium2 の約 9 分の 1 だが、取りこぼしは無い。
- PDF をページ単位の別経路で取り出す方針は、外部の評価 (markitdown の PDF は表と見出しが弱い、§5.2) とも合う。

### 2.6 PPTX をスライドごとに分けてから anydoc に渡す理由

anydoc の出力にはスライドの区切りが無い。見出しを手がかりに区切ろうとすると、本文の約 23% が隣のスライドに入ってしまい、スライド番号を確実に戻せない。そのため、スライド単位で取り出す方法を別に比べた (実物の PPTX 8 件 (2〜112 スライド) と生成 1 件)。

| 方式 | スライド数 | 取り出した文字 | 112 スライドの時間 / 最大メモリ | 追加の依存 | 備考 |
|---|---|---|---|---|---|
| **スライドごとに 1 枚の PPTX に分けて anydoc に渡す** | 全件正しい | つなぎ直すと、丸ごと anydoc に渡した結果と 1 文字も違わない | 0.53 秒 / 56MB | なし | **採用** |
| python-pptx | 全件正しい | 基準 | 0.22 秒 / 110MB | lxml + Pillow (35MB) | 予備案。垂直タブ `\x0b` が残る。結合で隠れたセルの重複文字も拾う |
| 標準ライブラリだけで書いた自前の読み取り (約 50 行) | 全件正しい | python-pptx と全 9 件で 1 文字も違わない | 0.08 秒 / 28MB | なし | 不採用 (§3.3) |
| kreuzberg | 300 スライドを 2 ページとして返した | — | — | — | 不採用 |

採用した方式の利点:

- 追加の依存が要らない。
- 結合セルの文字を 1 回だけ出す。表は Markdown で出るので、他の Office 形式と書式が揃う。
- 文字の出方が、丸ごと anydoc で変換した場合と完全に同じになる。

予備は python-pptx。anydoc の版上げで分割方式が動かなくなった場合に切り替える。

### 2.7 日本語の正規化をかける理由と範囲

- **文字化けは見つからなかった**。U+FFFD (置き換え文字)、`(cid:N)`、私用領域の文字、康煕部首 (「⽇」のような部首用の文字)、Latin-1 として読み違えた崩れのいずれも、両ライブラリ・全ファイルで 0 件だった。
- **欠落も少ない**。基準の 4 文字の並びのうち出力に含まれる割合は、DOCX / XLSX / 生成 PPTX で 0.9995〜1.0、実物の PDF で 0.986〜0.997 (両ライブラリでほぼ同じ)。実物の PPTX で anydoc 0.988 / markitdown 0.949 と差が出たが、これは並び順の違いによるもので、並び順を問わない指標では両方とも 1.0 だった。文字が失われていたわけではない。
- **PDF では、単語の途中で文字列が切れる問題がどの抽出方法にもある**。PDF の折り返し位置で、anydoc は日本語の間に空白を入れ (116 ページの PDF で 2,558 か所)、markitdown は改行を残す (同 1,904 か所)。pdfminer でページごとに取り出す経路でも、日本語の間に空白が入る箇所が 986 か所あった。
- 語の途中に入った空白は、kuromoji (Elasticsearch で使っている日本語の単語区切りの仕組み) が語を 2 つに割る原因になる。ES の `_analyze` で確かめた。116 ページの PDF で検索語の出現数を数えると、両ライブラリとも基準より 5〜10% ほど少なかった (例: 「情報システム」は基準 478 件に対し anydoc 443 件・markitdown 443 件)。
- 日本語の間の 1 文字分の空白・改行を詰める後処理をかけると、116 ページの PDF での語の一致率は次のように上がった。

| 経路 | 後処理なし | 後処理あり |
|---|---|---|
| pdfminer でページごと | 0.966 | 0.997 |
| markitdown | 0.884 | 0.982 |
| anydoc | 0.878 | 0.981 |

ライブラリを替えても PDF の語の途中の切れ目は残るので、後処理はライブラリの選択と関係なく必要になる。一方、DOCX / XLSX / PPTX の anydoc の出力には、抽出で入った切れ目は見つからなかった (日本語の間の空白の数が基準のテキストと同じだった)。そこで、詰める処理は PDF の経路だけにかけ、書き手が入れた改行や空白を消さないようにした。

### 2.8 大きな XLSX のメモリ

- 6MB の XLSX (5 シート × 2 万行) で、どちらのライブラリも約 620MB まで膨らむ。4 並列で変換すると anydoc 2.4GB / markitdown 1.9GB に達した。
- アップロードの上限 (`maxFileSizeBytes`、既定 50MB) ではこのメモリを抑えられない。コンテナのメモリ上限は「入力に対するメモリの倍率 × 同時に変換する数」で決まり、ライブラリを替えても解決しない。
- 対策として、形式ごとのサイズ上限ではなく、子プロセスの RSS の上限で止める方式にした。入力の大きさとメモリの関係は形式や中身でばらつくため、実際に使ったメモリで止めるほうが確実だから。RSS の上限 300MB に対して、実際に止まったのは 309〜315MB だった。既定の上限は 320MB にした (2026-10-28 ユーザー判断)。XLSX 以外の最悪値は、画像の多い 40MB の DOCX / PPTX で 188MB / 184MB (50MB なら約 225MB の見込み)、実物のファイル 29 件で最大 69MB、PDF 116 ページで 34MB だった。
- XLSX は anydoc がセル数に比例してメモリを使う (1 セルあたり約 1.9KB。2 万セル 63MB、5 万セル 119MB、10 万セル 214MB、20 万セル 404MB。1 シート 50 万セル以上は anydoc の `max_xml_nodes` の上限でエラー)。そこで、anydoc に渡す前に全シートのセル数を数え、10 万セルを超えるものは上限超過のエラーにする (2026-10-28 ユーザー判断)。大きな XLSX は検索の対象にならない。
- 同時実行は 3 件にし、コンテナのメモリを節約する (2026-10-28 ユーザー判断)。目安は 120MB + 3 × (320 + 100 + 50 + 48) MB ≒ 1.7GB。

### 2.9 サービスの構成を選んだ理由

**apps/app の外で、別コンテナで動かす**

- apps/app のイベントループの上で重い変換をすると、他のリクエストが止まる。メモリ不足で落ちたときに apps/app も巻き込まれる。
- 別コンテナにすると、テナント間のリソースの境界を保てる。クラッシュしても apps/app は生き残る。言語ごとのランタイムも分けられる。
- anydoc は Node からも使えるが、プロセス内で動かさないことをユーザーが決めた (2026-10-27)。採用するライブラリを替えても、別コンテナで動かす構成は保つ。
- 入力は添付のバイト列、出力は短いテキストという短いリクエストなので、HTTP multipart で完結する。apps/pdf-converter のような、FUSE によるファイルシステムの共有は要らない。
- apps/pdf-converter で確立した「マイクロサービス + OpenAPI から自動生成するクライアント」の型をそのまま使える。

**テナントごとのサイドカーではなく、共有 Deployment + HPA にする**

- サイドカー方式 (テナントの Pod ごとに抽出コンテナを 1 つずつ付ける方式) だと、待機中のメモリがテナントの数だけかかる。umbrella の試算 (2026-04 の markitdown 構成での見積もり) では、100 テナント × 待機時 約 120MB = 12GB に対し、共有で 2 レプリカ × 約 500MB ≈ 1GB で済む。負荷が増えたときだけ HPA で増やす。いまの構成では 1 つあたりの待機時メモリが小さくなる (§2.2) が、テナントの数だけ積み上がる点は変わらない。

**FastAPI**

- Pydantic v2 と一体になっており、`ExtractResponse` / `ErrorResponse` のスキーマがそのまま OpenAPI の正本になる。
- `/openapi.json` を自動で作るので、下流の orval の入力として追加の手間なく書き出せる。
- multipart/form-data の受け取りが標準で備わっている。
- FastAPI の TestClient で統合テストを書きやすい。
- タイムアウトは FastAPI の仕組み (`asyncio.wait_for`) には頼らない。同期の変換を呼んでいる間は効かないため (§2.4)、子プロセスを止めることで実現する。

**uv**

- Rust 製で速く、CI の時間が短くなる。
- `uv.lock` で、毎回同じ依存を入れること (`uv sync --locked --no-dev`) を強制できる。
- multi-stage の Dockerfile で、ビルド用の段で `.venv` を作って実行用の段にコピーするやり方が、公式の手順として用意されている。
- Python 本体を含めた lockfile を作れ、pip + pip-tools + virtualenv の役割を 1 つにまとめられる。

**`python:3.12-slim-bookworm` + multi-stage**

- Debian 12 ベースで glibc を使い、apt も使える。
- 実行用の段には `.venv` だけをコピーするので、image を小さくできる。
- 非 root (uid 10001) で動かし、`readOnlyRootFilesystem: true` と両立する。

**`services/` に置く**

- `apps/` と `packages/` は pnpm workspace と turbo の管理対象で、Node 系が前提になっている。Python を混ぜると `pnpm install` や `turbo run build` の依存関係が複雑になる。
- `services/` を新しく作り、pnpm workspace と turbo の外に置けば、Python 側の道具 (uv / pytest / ruff) だけで完結できる。
- `services/` という一般的な名前にしておけば、将来ほかの言語のサービスが増えても同じ置き方で揃えられる。

**既製の image を使わず自前でビルドする**

- 要件 (余計な機能を含まない軽い構成、health の確認口、認証、ビルド済みの配布) をすべて満たす既製の image は無かった (§3.6)。自前でビルドするほうが早く、工数は半日程度と見積もった。

### 2.10 この根拠の限界

- 実物は 6 件で、実物の DOCX は無い (再検証の 29 件を除く)。大きなファイルはすべて生成したもの。
- 品質は文字の一致で見ており、表の構造や読み順が正しいかは、目で少し確かめただけ。
- 計測は開発コンテナ 1 台で行った。本番のコンテナでの値ではない。
- 遅い側の処理時間 (p95) とコンテナ image の大きさは測っていない。
- pypdfium2 については、細工した PDF への耐性と、文字のない PDF での挙動をまだ確かめていない (§4.5 の 5)。

---

## 3. 不採用にした選択肢

「出典」は、その理由を確かめた場所を示す。「旧比較」は、2026-04 時点の依存 (markitdown + pdfminer) を物差しにした比較で、いまの依存 (anydoc + pypdfium2) で測り直してはいない。

### 3.1 抽出をどこで動かすか

| 選択肢 | 不採用の理由 | 出典 |
|---|---|---|
| Elasticsearch の ingest-attachment (Apache Tika) | GROWI.cloud は Elasticsearch のクラスタをテナント間で共有している。ingest ノードに Tika の CPU・メモリの負荷が集中し、他テナントの検索やインデックス更新に影響する。プラグインを足す運用の負担もある。Java ランタイムと Tika サーバのプロセスを k8s に足すことになり、Python のほうが image が軽く、言語の境界もはっきりする。Req 4.1 (共有 ES の ingest ノードでは抽出しない) にも反する | umbrella |
| apps/app の中で Node のライブラリ (unpdf + officeparser など) を使う | 重い変換が apps/app のイベントループを占有し、他のリクエストに影響する。メモリ不足で落ちると apps/app も巻き込まれる。Office 系、特に PPTX / XLSX の構造を保った抽出の品質が markitdown より劣っていた (旧比較)。Python のほうがテキスト抽出のライブラリが豊富で、将来の差し替えの余地も広い。ただし将来の差し替え先としての余地は残す | umbrella |
| markitdown の TypeScript 移植版 (markitdown-ts / markitdown-js / markitdown-node) で Node の中で完結させる | いずれも個人のメンテナンス。markitdown-ts は PPTX に対応していない。中身は Node ライブラリの薄いラッパーで、独自の価値が小さい。markitdown-js / markitdown-node は更新が止まっていて未成熟。本家の Python 版と挙動がずれていく心配もある。本番には向かない | umbrella |
| anydoc を apps/app のプロセス内で (Node から) 使う | ユーザーが不採用と決めた (2026-10-27)。上の Node ライブラリの案と同じく、重い処理と異常終了を apps/app から切り離すため | 本 spec |
| テナントごとのサイドカー | 待機時のメモリがテナントの数だけかかる (100 テナントで約 12GB 対 共有で約 1GB、§2.9) | umbrella (旧比較) |

### 3.2 抽出エンジン (ライブラリ全体)

| 選択肢 | 不採用の理由 | 出典 |
|---|---|---|
| microsoft/markitdown (2026-04 に採用、2026-10 に外した) | **メモリ**: 待機時 148.7MB (anydoc 構成は 35.3MB)。読み込み時に magika / onnxruntime / pandas / numpy まで読み込む。読み込みに 0.39 秒・149MB かかり、子プロセス方式と相性が悪い。**CPU**: ファイル種別判定が変換のたびに約 10 コア分のスレッドを空回りさせる (98KB の XLSX で経過 0.34 秒に CPU 3.4 秒)。**速さ**: Office 系で anydoc より 10〜30 倍遅い (実ファイル 29 件では 20〜40 倍)。**安全面**: 750KB の DOCX (展開すると 300MB) でメモリが 1.5GB を超えて強制終了、47KB の 10 万段入れ子の DOCX で CPU を 90 秒以上占有した (anydoc はどちらも 0.01 秒で上限エラー)。依存が 36 個・286MB と多く、攻撃を受けうる範囲が広い。**出力**: XLSX に `NaN` や `Unnamed: N` の雑音が多く、PPTX に垂直タブが残る。**PDF**: ページ単位の抽出を足す PR #1263 は、v0.1.9 の時点でも未マージ (最終更新 2026-06)。外部のベンチマークで PDF の総合評価が 12 エンジン中下から 2 番目 (§5.2)。**保守**: PDF のページ単位の抽出を足す PR #1263 は、2026-04 の時点で未マージ、v0.1.9 の時点 (2026-10) でも未マージのまま (最終更新 2026-06) で、ページ区切りのために pdfminer を別に抱え続ける必要があった。0.x のベータ版。なお、長期保守の観点だけで見れば markitdown を続ける案を推す評価もあった (§5.1) | 本 spec の計測 |
| Docling | レイアウトや表の構造まで高い精度で取り出せるが、Docker image が数 GB 規模になり、400MB の目標に収まらない。PyTorch などの重い機械学習部品 (場合により GPU) が要り、k8s の Pod に割り当てるリソースが跳ね上がる。検索用の文字を取り出す目的には、そこまでの精度は要らない。表の多い PDF の品質を上げたくなったときの候補として残す (§1.5) | 旧比較、本 spec |
| Unstructured | 対応形式は多いが、extras (追加機能ごとの依存のまとまり) が細かく分かれておらず、要らない依存を切り落としにくい。メンテナンスの姿勢と API の安定性が、比較した当時の markitdown (Microsoft 公式) より読みにくかった | 旧比較 |
| kreuzberg | PDF の中身は PDFium で、速さと品質は pypdfium2 と同じ水準 (0.39 秒 / 65MB) だが、PDF だけなら pypdfium2 で足りる。配布ファイルが 37MB と大きい。実物の PPTX 1 件で失敗した。300 スライドの PPTX を 2 ページとして返し、スライド単位にならなかった | 本 spec の計測 |
| extractous | 更新が止まっている (最終リリース v0.3.0 が 2024-12-21)。Apache-2.0、配布ファイル 40.3MB。2026-10 の候補選びの段階で、PyPI の情報をもとに除外した。実測はしていない | PyPI の情報 |

### 3.3 PDF と PPTX の抽出方法

| 選択肢 | 不採用の理由 | 出典 |
|---|---|---|
| pdfminer.six でページごとに取り出す (旧設計) | 品質は最上位と同じだが、ページごとに文書全体を読み直すため遅い (116 ページで 10.7 秒、pypdfium2 は 0.19 秒)。待機時から 11〜30MB 増え、1.1〜7.2 秒かかった | 本 spec の計測 |
| pdfminer.six で全ページを一度に取り出す | 文字の約 9% を取りこぼす。ページの区切りも得られない | 本 spec の計測 |
| PyMuPDF | 速さ・品質とも良いが、AGPL なのでライセンスの方針に合わない。最大メモリも 146MB と大きい | 本 spec の計測 |
| pdf-inspector (anydoc の PDF の中身) | 1 件で文字の約 14% を取りこぼした。見つかる率も低い。1.8〜3.4 秒と遅め | 本 spec の計測 |
| pdf-oxide | 文字の約 11% を取りこぼした。見つかる率も低い。最大メモリ 82MB | 本 spec の計測 |
| pypdf | 不採用ではなく予備案。純 Python で取りこぼしは無いが、pypdfium2 より遅い (1.7 秒) | 本 spec の計測 |
| python-pptx | 不採用ではなく予備案。スライド数は全件正しく、0.22 秒と速いが、lxml + Pillow (35MB) の依存が増え、最大メモリ 110MB。垂直タブ `\x0b` が残り、結合で隠れたセルの文字を重ねて拾う。表の書式が他の Office 形式と揃わない | 本 spec の計測 |
| 標準ライブラリだけで書いた自前の PPTX 読み取り (約 50 行) | 使える水準 (python-pptx と 9 件すべてで 1 文字も違わず、0.08 秒 / 28MB、依存なし)。ただし SmartArt・グラフ・レイアウトから継承される文字と Strict OOXML を扱わない。抽出の仕組みを自前で持ち続けることになり、Office 系の書式を anydoc に揃える採用案のほうが良い | 本 spec の計測 |
| anydoc に PPTX を丸ごと渡し、見出しで区切る | 本文の約 23% が隣のスライドに入り、スライド番号を確実に戻せない | 本 spec の計測 |
| PPTX を 1 文書として扱う | 「1 添付 = スライドごとの N 文書」の設計 (Req 1.2) が崩れる | 本 spec |
| PPTX だけ markitdown のまま残す | 待機時のメモリが markitdown 構成の水準に戻り、markitdown を外す利点の大半が失われる | 本 spec |

### 3.4 形式とライブラリの部分的な残し方

| 選択肢 | 不採用の理由 | 出典 |
|---|---|---|
| Outlook MSG を扱う | anydoc が MSG に対応していない。対象から外すことをユーザーが了承し、Req 1.5 から外した | 本 spec |
| HTML だけ markitdown で処理する | 待機時のメモリが markitdown 構成の水準に戻る。標準の `html.parser` で足りる (§2.3) | 本 spec |

### 3.5 markitdown の extras (2026-04 の構成で外したもの)

markitdown 自体を外したので、いまは参考の記録である。PyPI の markitdown の extras は `all / audio-transcription / az-doc-intel / docx / outlook / pdf / pptx / xls / xlsx / youtube-transcription` の 10 種。当時は `[pdf,docx,xlsx,pptx,outlook]` だけを選んだ。

| extra | 外した理由 |
|---|---|
| `xls` | 当時の要件の対象外 (旧形式の XLS)。いまは anydoc で XLS を扱う |
| `audio-transcription` | ffmpeg を引き込み、image が 600MB を超える。音声は対象外で、外部バイナリを使わない方針にも反する |
| `youtube-transcription` | 外部の URL から取り込むので、外向き通信を遮断する要件に合わない |
| `az-doc-intel` | Azure Document Intelligence (外部 API) を呼ぶので、外向き通信の要件に反する |
| `all` | 上のすべてを引き込む。image が 600MB〜1GB に膨らむ |

### 3.6 既製の Docker image

umbrella の [research-docker-image.md](../attachment-search/research-docker-image.md) の調査 (2026-04)。どれも markitdown を REST API にしたもので、要件 (余計な機能を含まない軽い構成、health の確認口、認証、ビルド済みの配布) をすべて満たすものは無かった。

| image / プロジェクト | 不採用の理由 |
|---|---|
| Microsoft 公式 (リポジトリ内の Dockerfile) | REST API が無い (CLI と MCP サーバ用だけ)。`markitdown[all]` を入れ ffmpeg / exiftool も含むので 375〜378MB。公式のレジストリへの配布も無い |
| `mcp/markitdown` (Docker Hub) | Docker 社が MCP カタログ用にまとめたもので、Microsoft 公式ではない。MCP プロトコルを話すもので REST ではない。`markitdown[all]` で音声や OCR まで引き込み、378.5MB |
| `ghcr.io/dezoito/markitdown-api` | 最有力だった (MIT、ビルド済み、FastAPI + uv)。ただし health の確認口が無く、認証も無く、ポートが 8490 固定、バージョンを固定せずビルド時の最新を取る。本番に入れるには手直しが要る |
| elbruno/MarkItDownServer | 本番向けの作り (環境変数、`/health`、レート制限) だが、markitdown `0.0.1a2` という古い alpha 版に固定されている。ビルド済みの配布が無い |
| bon5co/markitdown-api-auth | Bearer 認証はあるが、ライセンスとリポジトリの情報を確かめられなかった |
| adampraszywka/MarkItDownApi | ASP.NET Core から Python を呼ぶ構成で、二つのランタイムを抱えて image が大きくなる。2025-01 から更新が止まり気味 |
| 9bow/markitdown-api-fly-io | 設計は良い (health、API キー、タイムアウト) が、Fly.io で動かす前提の作りで、ビルド済みの配布が無い。小規模 |
| Saluana/markitdown-rest | YouTube 字幕・音声・ZIP・画像 OCR を全部入れていて image が大きい。ライセンスが書かれておらず、再配布できるか分からない |
| pig4cloud/markitdown | GPT-4V を使う画像 OCR 専用で、OpenAI のキーが必須。PDF / Office 全般には対応しない |
| melchiorb/markitdown-api、Kolosal-RMS-MarkItDown | 要件に合わないか、判断できるだけの情報が無い |

### 3.7 構成の部品

| 選択肢 | 不採用の理由 |
|---|---|
| Flask | 非同期の対応が弱く、OpenAPI を作るには別の拡張が要る |
| Tornado / aiohttp | OpenAPI を自動で作れず、Pydantic との連携も薄い |
| Poetry | 安定しているが uv より遅い。multi-stage の Docker ビルドの公式の手順が乏しい |
| pip + pip-tools | 素朴だが、lockfile と実際の環境が合っていることを自分で保証する必要がある |
| `python:3.12-alpine` | musl libc なので、当時の依存 (pdfminer.six / markitdown) でビルドの問題が出るおそれがあり、CI の時間も伸びやすい (旧比較)。いまの依存 (ネイティブ拡張を含む wheel) で musl 向けの wheel があるかは確かめていない |
| `distroless/python3` | シェルが一切無く、問題の調べ方が難しい。当時の依存が実行時に glibc に頼る点を確かめる手間も大きい (旧比較) |
| `apps/attachment-text-extractor/` に置く | pnpm workspace に Python を混ぜると `turbo run build` が壊れる。`package.json` の無いディレクトリを workspace から外す設定が要る |
| `packages/attachment-text-extractor/` に置く | `packages/` は「TS のライブラリ」を置く慣習が強く、実行するサービスを置くのは GROWI の既存の設計から外れる |
| `pebble` (子プロセスのタイムアウト管理によく使われるライブラリ) | LGPL なのでライセンスの方針に合わない |

### 3.8 変換の実行方式と細かな処理方法 (design の調査で見送ったもの)

| 選択肢 | 不採用の理由 |
|---|---|
| 変換をスレッドで実行する | スレッドは外から止められず、Req 2.5 を満たせない。PDFium は 1 プロセス内の複数スレッドから使えない |
| multiprocessing の fork 方式 | スレッドを持つ親 (uvicorn) から複製するため、子が止まることがあり、Python 3.12 で DeprecationWarning が出る。1 回あたりの上乗せは 3.5ms と最も小さかった |
| 常駐ワーカーのプール (自作) | 大きな XLSX の変換後、ワーカーが 609MB を持ったまま返さない。CPU 時間の上限が仕事ごとではなく累積で効く |
| `concurrent.futures.ProcessPoolExecutor` | 実行中の仕事を止められない。ワーカーが 1 つ落ちると、実行中の他の仕事と次の依頼まですべて失敗する (BrokenProcessPool) ので Req 2.7 を満たさない。共有メモリ (`/dev/shm`) も必要 |
| subprocess で小さな CLI を起動する方式 (次点) | 隔離は最も素直だが、起動と import で 1 回あたり約 50ms かかり (forkserver の約 4 倍)、CPU もそのぶん使う |
| `RLIMIT_AS` (仮想メモリの上限) を主なメモリの守りにする | anydoc (Rust) は確保に失敗すると abort し、親からは異常終了と区別できない。最後の歯止めにとどめる |
| CPython の非公開属性 `_forkserver_alive_fd` を閉じて、ワーカーが落ちたときの子の残留を防ぐ | 非公開属性なので Python の版上げで壊れうる。依頼元だけが持つパイプを子が見張る方式にした |
| `PDEATHSIG` (親が死んだら子も止める OS の設定) で子の残留を防ぐ | forkserver の子では「親」が forkserver になり、uvicorn のワーカーが落ちても効かない |
| ファイル本体を Process の引数で子に渡す | pickle がイベントループを止める (6MB で 55〜68ms)。別の Pipe に非同期で書き込む |
| XLSX: anydoc の `## シート名` の見出しをそのまま突き合わせる | 見出しを出す規則が一定しない (2 枚でも片方が非表示だと出ない、グラフシートだと出る)。シート名の先頭の空白が削られ、`<` は `\<` になる。非表示と空のシートは出力されない |
| XLSX: シートごとに 1 枚だけのブックに分けて変換する | 正確だが、共有文字列をシートごとに読み直すため遅い (30 シート・共有文字列 5.4MB のファイルで 0.17 秒 → 1.3 秒)。グラフシートだけのパッケージは MalformedError になる |
| XLSX: anydoc の `to_document()` で構造データを受け取る | 非表示のシートは同じように落ちる。Markdown への変換を自前で書く必要があり、埋め込み画像のバイト列も持ち続ける |
| 文字コード: UTF-8 → cp932 → latin-1 の順に試すだけ | EUC-JP と cp1252 が文字化けしたまま通ってしまう |
| 文字コード: charset-normalizer を候補を絞らずに使う | 短い Shift_JIS が big5、latin-1 が utf_16_be と誤判定された |
| JSON / YAML を解析して値だけ取り出す | 深い入れ子の JSON は `json.loads` で RecursionError になり、YAML はエイリアスの展開で膨らむ。デコードしたテキストをそのまま使えば検索には十分 |
| オーナーパスワードだけの PDF を暗号化として拒否する | 開くのにパスワードが要らず、誰でも読める内容なので、拒否すると検索できる文書が減るだけになる (Req 1.12 として要件に明記した) |
| XLSX を少しずつ読む自前の処理 (シートの XML を先頭から順に読み、セルの文字を取り出す。約 100 行) | 実測ではメモリが小さく (100 万セルで 54MB、6MB の大きな XLSX で 43MB)、速さは anydoc と同程度、日本語の文字数も一致した (ふりがな `<rPh>` を除く処理が要る)。ユーザー判断 (2026-10-28) で、自前の XLSX 解析を持たずに anydoc とセル数の上限で扱う案 (大きな XLSX は検索の対象外) を選んだ。大きな XLSX も検索したくなったときの第一候補 |
| XLSX を対象外にする | Excel の添付が一切検索できなくなる |
| 1 件のメモリ上限を 768MB にする (6MB の大きな XLSX が通る値) | 大きすぎる。XLSX 以外は 320MB で足りる |
| 同時実行を 2 件にする / 4 件にする | 2 件 (上限 768MB) ではコンテナに約 2.1GB 要る。4 件 (上限 320MB) では約 2.2GB。3 件で約 1.7GB に抑える |

---

## 4. 既存実装とのギャップ分析 (2026-10-28)

承認済みの requirements.md と §1 の決定に対して、`services/attachment-text-extractor/` の既存実装 (旧 tasks.md 28 件中 17 件が完了した時点のコード) がどこまで使えるかを調べた。

### 4.1 既存実装の現状

旧設計は「HTTP の受け口」と「変換の中身」がはっきり分かれた構成で、受け口側はほぼ完成している。変換の中身は、単純な形式を markitdown に通す仮の実装だけ。

| 部品 | ファイル | 状態 | 刷新後の扱い |
|---|---|---|---|
| 設定の読み込み | `src/app/config.py` | 完成 (`MAX_FILE_SIZE_MB` / `TIMEOUT_S` / `MAX_CONCURRENCY` / `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` / `MAX_EXTRACTED_BYTES`、トークン未設定で起動失敗) | 流用。形式別のサイズ上限などを足す可能性あり |
| API の型 | `src/app/schemas.py` | 完成 (`PageInfo` / `ExtractResponse` / `ErrorCode` / `ErrorResponse`) | 流用。`ErrorCode` に暗号化と上限超過を追加 (Req 1.10 / 2.6) |
| Bearer 認証 | `src/app/middleware/bearer_auth.py` | 完成 (`hmac.compare_digest`) | そのまま流用 |
| XXE 対策の起動処理 | `src/app/security.py` | 完成 (`defusedxml.defuse_stdlib()` + lxml の API 確認) | 流用。lxml は markitdown 経由の依存なので、外れた後は lxml の確認部分が空振りになる。整理が要る |
| リソース制限 | `src/app/limits.py` | サイズ上限と同時実行数は機能する。**タイムアウトは機能しない** (§2.4) | 同時実行数とサイズ上限は流用。タイムアウトは作り直し |
| 抽出の振り分け | `src/app/services/extraction_service.py`、`extractors/__init__.py` | MIME の解決と、MIME → 抽出関数の対応表 (whitelist) は完成 | 振り分けの仕組みは流用。対応表の中身は入れ替え (MSG を外し、旧形式 Office / OpenDocument を足す) |
| 単純形式の抽出 | `extractors/simple_extractor.py` | markitdown で全形式を 1 要素に変換。リクエストごとに `MarkItDown()` を作り直している | 作り直し (Office 系は anydoc、テキスト系は自前) |
| PDF / PPTX / XLSX の抽出 | (なし) | 未着手。対応表では仮に simple_extractor に流している | 新規 |
| ルーター | `routers/extract.py`、`routers/health.py` | 完成。health は markitdown のページ抽出の有無を返す `pdf_strategy` を持つ | extract は流用 (呼び出し先の変更のみ)。health は markitdown を前提にした項目を外す |
| アプリの組み立て | `src/app/main.py` | 完成。起動時に markitdown の PDF 対応を調べる `_probe_pdf_strategy()` がある | 流用。markitdown を前提にした処理を外す |
| OpenAPI の出力 | `scripts/export_openapi.py` | 完成 | そのまま流用 |
| Dockerfile | `Dockerfile` | 完成 (multi-stage、uid 10001、`--workers ${WORKERS:-2}`)。uv の image が `latest` 指定 | 流用。uv の版の固定は §4.5 の 10 |
| docker-compose | `infra/docker/compose.yaml` | 完成 (read-only rootfs、tmpfs `/tmp` 512MB、uid 10001) | 流用 |
| k8s manifest | (なし) | 未着手 | 新規 (Req 3.2 / 3.3) |
| Python 用 CI | (なし) | 未着手。Node 側の CI に orval の差分検知だけはある | 新規 |
| 構造化ログ | (なし) | 未着手 (旧タスク 4.4) | 新規 |
| 展開量の上限 (`MAX_EXTRACTED_BYTES`) | 設定値だけある | 未実装 (旧タスク 2.4) | Req 2.6 で作り直し |
| テスト | `tests/` 15 ファイル、229 件成功 | 認証・設定・スキーマ・制限・ルーター・OpenAPI 出力は有効。markitdown を前提にしたテスト (`test_extract_simple.py` など) がある | 前者は流用、後者は作り直し |

**タイムアウトが機能しない理由**: `extraction_service.extract()` は `async def` だが、中で同期の抽出関数を直接呼んでいる。変換中はワーカーのイベントループが止まるため、`asyncio.wait_for` は変換が終わるまで発火しない。スレッドへ逃がしても、スレッド上の変換は止められないので、Req 2.5 (処理そのものを止めて枠とメモリを解放する) は満たせない (§2.4)。

### 4.2 要件と既存資産の対応

| 要件 | 既存資産 | ギャップ |
|---|---|---|
| 1.1 `pages[]` で返す | schemas / extract ルーター | なし |
| 1.2 PPTX をスライド単位で | なし | **新規**: スライドごとに分けて anydoc に渡す処理 |
| 1.3 XLSX をシート単位で | なし | **新規**。anydoc はシートが 1 枚だとシート名を出さず、非表示シートと空シートを出力しない。シートの区切りとシート名の取り方は §4.5 の 2 |
| 1.4 PDF をページ単位で | なし | **新規**: pypdfium2 でページごとに抽出 |
| 1.5 単純形式を 1 要素で | simple_extractor (markitdown) | **作り直し**: DOCX / RTF / EPUB / CSV は anydoc、HTML / TXT / JSON / XML / YAML / MD / LOG / ipynb は自前 |
| 1.6 対象外の形式を拒否 | 対応表 + `UnsupportedFormatError` | 対応表から MSG を外すだけ |
| 1.7 外部バイナリ・egress 不要 | — | 新しい依存 (anydoc / pypdfium2) は wheel で入る。anydoc の `ocr='hosted'` を使わないことの保証が要る |
| 1.8 旧形式 Office / OpenDocument | なし | **新規**: 対応表への追加と anydoc での変換 |
| 1.9 日本語の正規化 | なし | **新規**: 改行コードの統一と、日本語の間の空白・改行の除去 (純粋関数) |
| 1.10 暗号化ファイル | なし | **新規**: エラーコード追加と、anydoc の `EncryptedError` / pypdfium2 のパスワード例外の変換 |
| 1.11 壊れたファイル | `extraction_failed` | anydoc の `MalformedError` / `MissingPartError` などの対応づけ |
| 2.1 サイズ上限 | `Limits.enforce_size` | なし。形式別の上限 (大きな XLSX 対策) を足すかは §4.5 の 9 |
| 2.2 タイムアウト | `Limits.with_timeout` | **作り直し** (4.1 のとおり機能していない) |
| 2.3 同時実行上限 | `Limits.acquire_slot` | 流用。ただし枠はワーカー (プロセス) ごとなので、全体の上限は「ワーカー数 × 枠」になる |
| 2.4 egress 遮断下で動く | compose の network 設定 | k8s の NetworkPolicy が未作成 |
| 2.5 タイムアウト時に処理を止める | なし | **新規**: kill できる子プロセスで変換する仕組み |
| 2.6 細工ファイルの上限 | `MAX_EXTRACTED_BYTES` (未実装) | **新規**: anydoc の組み込み上限 + PPTX 分割処理での展開量上限 + 子プロセスのメモリ上限 |
| 2.7 1 件の異常終了を波及させない | `except Exception` のみ | **新規**: 子プロセスでの隔離。`PanicException` (`BaseException` 系) を捕まえる |
| 3.1 compose 同梱 | compose.yaml | なし |
| 3.2 / 3.3 k8s での配布と安全設定 | なし | **新規**: k8s manifest 例 |
| 3.4 ステートレス | 設計上そうなっている | なし |
| 4.1 / 4.2 マルチテナント隔離 | 同時実行上限 | なし |

下流 (indexing spec) への影響: apps/app の `attachment-text-extractor.ts` は `ErrorCode` で `switch` し、知らないコードは `null` を返す。暗号化・上限超過のコードを足すと、orval で再生成したうえで apps/app 側に対応を足す必要がある。

### 4.3 実装方針の選択肢

**A. 既存コードをその場で直す**
- 変更箇所: `simple_extractor.py` の書き換え、`extractors/` への PDF / PPTX / XLSX / テキスト系の追加、`limits.py` のタイムアウトの書き換え、`extraction_service.py` への子プロセス実行の組み込み
- ✅ 変更が最小で、既存テストの多くがそのまま効く
- ❌ 子プロセス実行・正規化・形式別抽出が既存のモジュールに入り込み、`extraction_service.py` と `limits.py` の責務がぼやける

**B. サービスを一から作り直す**
- ✅ 新方針に完全に合わせた構成にできる
- ❌ 完成済みで問題のない受け口側 (認証・設定・スキーマ・OpenAPI 出力・Dockerfile・compose) と、そのテスト約 150 件を捨てることになる。作り直す理由がない

**C. 受け口は残し、変換の中身を新しいモジュールとして作る (組み合わせ)**
- 残す: `main.py` / `config.py` / `schemas.py` / `middleware/` / `security.py` / `routers/` / `scripts/` / Dockerfile / compose と、それらのテスト
- 新しく作る: 形式別の抽出、日本語の正規化、子プロセスでの実行 (タイムアウト・メモリ上限・異常終了の隔離) を、受け口から独立した変換モジュールとしてまとめる。ルーターは今の `extract()` の代わりにこのモジュールを呼ぶ
- 消す: markitdown を前提にしたコード (`simple_extractor.py`、`_probe_pdf_strategy()`、health の `pdf_strategy`) とそのテスト
- ✅ 受け口の資産を活かしつつ、変換側を新方針で素直に組める。子プロセスとの境界は「バイト列と形式を渡し、`pages[]` かエラー種別を受け取る」形にでき、単体テストしやすい
- ❌ 受け口と変換モジュールの間の取り決め (渡すもの、返すもの、エラーの種類) を design で決める必要がある

### 4.4 規模とリスク

- 規模: **M (3〜7 日)**。受け口側はほぼ完成しているが、子プロセスでの実行、形式別の抽出 4 種、正規化、k8s manifest、Python 用 CI が新規
- リスク: **中**
  - 子プロセスでの実行は、read-only rootfs、tmpfs、uvicorn のワーカー数、同時実行の枠と組み合わさるため、未知の点がある
  - PPTX の分割は anydoc の文書化されていない挙動に頼る (§1.2)

### 4.5 design で調べること (Research Needed)

この節は、design に入る前に未決だった事項の一覧である。すべて design で確定した (各項目の末尾に確定先を書いてある)。

1. **子プロセスでの実行方式**
   - リクエストごとに子プロセスを作るか、あらかじめ作ったプロセスの集まりを使い、止めたら作り直すか
   - fork と spawn のどちらを使うか
   - uvicorn のワーカー数・同時実行の枠との関係
   - read-only rootfs の下で multiprocessing が使う共有メモリ (`/dev/shm`) と一時領域が足りるか
   - 子プロセスのメモリ上限 (`RLIMIT_AS`) が anydoc (Rust) と PDFium の下で期待どおり効くか
   - 補足: 子プロセスのタイムアウト管理によく使われる `pebble` は LGPL なので使えない (§3.7)
   - → 確定: forkserver で 1 リクエスト 1 子プロセス (§1.3、§3.8)
2. **XLSX のシート単位の分割**: シート名と区切りの取り方。案は 2 つ。
   - `xl/workbook.xml` からシート名を読み、anydoc の見出しと突き合わせる
   - PPTX と同じく、シートごとに分けて anydoc に渡す
   - あわせて、非表示シートを対象にするかを決める
   - → 確定: シート名を目印に置き換えて 1 回だけ変換する。非表示シートは含め、空のシートは除く (§1.1、§1.2)
3. **テキスト系の扱い**: 文字コード判定に使うライブラリ (charset-normalizer は MIT)、ipynb で何を取り出すか (セルのソースだけか、出力も含むか)、JSON / XML / YAML をそのまま返すか
   - → 確定 (§1.1、§1.2、§3.8)
4. **エラーの対応づけ**: anydoc の例外 (`EncryptedError` / `MalformedError` / `MissingPartError` / `ResourceLimitError` / `UnsupportedError` / `PanicException`) と pypdfium2 の例外を `ErrorCode` に対応づける。追加するコードの名前と HTTP ステータス
   - → 確定: `file_encrypted` / `resource_limit_exceeded` を追加 (design.md のエラー処理の節)
5. **pypdfium2 の挙動**: 暗号化された PDF、文字のない (画像だけの) PDF、細工した PDF での振る舞い
   - → 確定 (§1.2)
6. **health と readiness の中身**: markitdown を前提にした項目を外した後に何を返すか (OpenAPI の変更を伴う)
   - → 確定: `pdf_strategy` を外す。apps/app は health / readiness を呼んでいない (design.md)
7. **image の大きさと arm64**: anydoc と pypdfium2 の linux arm64 用 wheel の有無と、実際の image の大きさ
   - → 確定: arm64 用 wheel はある (§1.4)。image の大きさは CI で上限を検査する (design.md)
8. **抽出の失敗を下流でどう扱うか**: anydoc は暗号化・破損などで文書全体を失敗にし、部分的な結果を返さない (§1.2)。pypdfium2 でも、暗号化された PDF ではパスワードの例外が上がる (詳しい挙動は 5 で確かめる)。これらの失敗を、indexing spec の Req 2.4 (失敗時はメタデータだけの文書を登録する) にどう対応づけるか。下流 spec と合わせて決める
   - → 確定: エラーとして返し、下流がメタデータだけの文書を作る。成功時は最低 1 要素を返す (§1.1)。下流で直す箇所は design.md の「再検証が必要になる条件」に書く
9. **大きな XLSX のメモリ対策**: XLSX だけ受け付けるサイズの上限を下げるか、同時に変換する数を絞るか。コンテナのメモリ上限をどう決めるか (§2.8)
   - → 確定: 子プロセスの RSS の上限で止める (§1.3、§2.8)。メモリ上限の式は design.md
10. **uv の image の版の固定**: Dockerfile で uv の image が `latest` 指定になっている
    - → 確定: 版を固定する (design.md)
11. **CI の具体的なコマンド**: `uv sync --locked` / `uv run pytest` / `uv run ruff check` / `docker build` を、どの順でどう組むか
    - → 確定 (design.md)
12. **TSV の扱い**: Req 1.5 は TSV を対象に含むが、§1.1 の表には TSV の経路が無い。CSV と同じく anydoc に形式を明示して渡すのか、テキストとして返すのかを決める
    - → 確定: CSV と同じく、デコードしてから anydoc に `csv` を明示して渡す (§1.1)

---

## 5. 経緯

### 5.1 年表

- **2026-04-17**: umbrella spec `attachment-search` を 3 つに分け、本 spec ができた。抽出エンジンは microsoft/markitdown を採用し、markitdown が PDF のページ区切りを返さない (PR #1263 が未マージ) 間のつなぎとして、pdfminer.six でページごとに取り出す処理を同梱する方針にした。FastAPI + uv + multi-stage Dockerfile、`services/` への配置、既製 image を使わず自前でビルドすることも、このとき決めた。
- **2026-08**: Firecrawl が Rust 製の変換ライブラリ firecrawl/anydoc (MIT) を公開した ([gihyo.jp の紹介記事](https://gihyo.jp/article/2026/08/anydoc))。Node / Python / Rust から使え、自社の計測では markitdown より速く品質も高いとされた。
- **2026-10-27**: 抽出エンジンを再評価した。外部の比較記事を調べ (§5.2)、自分たちで計測し (§2)、観点の異なる 5 者 (SRE / 検索品質 / セキュリティ / 長期保守 / 再検証) に、A (markitdown を続ける) / B (anydoc に全面的に切り替える) / C (Office 系は anydoc、PPTX は別の方法でスライド単位、markitdown は外す) の 3 案を独立に判定させた。5 者中 4 者が C を選び、長期保守の担当だけが A を選んだ。長期保守の担当は「anydoc は実質停止している」と述べたが、これは言い過ぎだった。主作者は 2026-08-27 以降コミットがなく v0.2.4 以降のリリースも無いが、10 月にも別の 3 人が main にコミットしている。この時点の状況は、anydoc が v0.2.4・貢献者 9 人、markitdown が v0.1.9 で PR #1263 は未マージ (最終更新 2026-06)。この後、PDF と PPTX の取り出し方を別に比べ (§2.5 / §2.6)、ユーザーが §1 の内容に決めた。MSG を対象から外すこと、anydoc を apps/app のプロセス内で動かさないことも、このときユーザーが決めた。
- **2026-10-27**: markitdown 固有の名前を、エンジンに依存しない名前に変えた (spec 名 `attachment-search-markitdown-extractor` → `attachment-search-text-extractor`、`services/markitdown-extractor` → `services/attachment-text-extractor`、`@growi/markitdown-client` → `@growi/attachment-text-extractor-client`、環境変数 `GROWI_MARKITDOWN_*` → `GROWI_ATTACHMENT_EXTRACTOR_*` など)。あわせて、新しい方針で作り直すために spec をリセットした。
- **2026-10-28**: 新しい requirements.md を承認した (MSG を外し、旧形式 Office / OpenDocument、日本語の正規化、暗号化、壊れたファイル、処理の停止、細工ファイルの上限、異常終了の隔離を追加)。既存実装とのギャップ分析 (§4) を行った。

### 5.2 外部の比較記事 (2026-10-27 時点)

自分たちで計測した記事や、日本語の文書を扱った記事は見つからなかった。本 spec の用途には §2 の実測のほうが近い。

| 記事 | 要点 | 注意点 |
|---|---|---|
| [anydoc vs MarkItDown (file2markdown.ai, 2026-08-05)](https://www.file2markdown.ai/blog/anydoc-vs-markitdown) | anydoc は「正しく変換するか、はっきり失敗する」、markitdown は崩れた結果でも返す。一般的な Office 文書の本番処理は anydoc、形式の幅を重視するなら markitdown、PDF 中心なら PDF 専用エンジン | 競合サービスの運営元 (OverXceed Ltd) の記事。数値の計測なし。「厳格と寛容」の差は本 spec の試験では見られなかった (§2.2) |
| [firecrawl anydoc review (Wavect, 2026-08-10、09-02 更新)](https://wavect.io/blog/firecrawl-anydoc-review/) | Firecrawl のベンチマークを批判 (評価文書が非公開、LLM による採点が人間の判断と合うか未確認、初回起動・p95・コンテナの大きさを測っていない)。自社の文書で試験導入し、受理率・p50/p95・障害率を見るべきとする | 数値は Firecrawl の公表値で、独自の計測なし |
| [anydoc の bench/README](https://github.com/firecrawl/anydoc/blob/main/bench/README.md) | 比較相手は markitdown / pandoc / docling / unstructured / mammoth / LibreOffice。品質は構造要素の数と、Claude による 1 組ずつの判定 (表示順を入れ替えて 2 回) で見ている | PDF は対象外。anydoc と markitdown はプロセスの起動時間を含まず、pandoc と LibreOffice は含む |
| [MarkItDown 調査 (yage.ai, 2026-04-12)](https://yage.ai/share/markitdown-survey-en-20260412.html) | PDF 変換 12 エンジンの比較 (OpenDataLoader Benchmark) で、markitdown は下から 2 番目。総合 0.589 (Docling 0.882)、表の再現 0.273、見出しの階層 0.000、読み順 0.844 | AI が生成した記事。anydoc は比較対象外 |
