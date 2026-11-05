# Research: attachment-search-text-extractor-node-rewrite

_最終更新: 2026-11-04 (requirements フェーズ)_

この文書は、抽出サービスを Node.js + Hono + `@firecrawl/anydoc` に書き換えるにあたって、requirements の時点で分かっていることと、まだ分かっていないことをまとめたものである。各項目に **実測** (手元で動かして確かめた) か **未検証** (調べただけ、または見込み) かを付ける。design フェーズで requirements の Req 11 の計測を行い、この文書を更新する。

この spec が消えるときに、決定と理由は対象 spec (`attachment-search-text-extractor`) の research.md に移す (requirements の Req 12.3)。

## 1. 分かっていること

### 1.1 anydoc (npm 版)

- **実測**: `@firecrawl/anydoc@0.2.4` は npm にあり、napi-rs で作ったネイティブ部品として配られている。呼び方は `toMarkdownBytes(bytes, format)`。
- **実測**: 70,000 セルの XLSX を変換した出力は、Python 版と文字数まで同じ (964,002 字)。
- **未検証 (根拠あり)**: Python 版と同じ Rust の核を使うので、XLSX と PPTX の文書化されていない挙動 (PPTX の分割したパッケージを受け付けること、XLSX のシート名の目印が見出しとして出ること) は、対象 spec の research.md の知見がそのまま使えると見込む。版を固定した契約テストで確かめる。
- **実測**: エラーは `ConvertErrorCode` を持つ `Error` として投げられる。Python 版の例外の型 (`EncryptedError` など) との対応は design で確かめる。

### 1.2 PDF

- **実測**: `@hyzyla/pdfium` (PDFium を WASM にしたもの) で、ページごとのテキストを取り出せた。ただし試したのは英語の 5 ページの PDF だけ。
- **未検証**: 日本語の PDF の品質 (語の途中の改行、縦書き、文字の抜け)。Python 版の pypdfium2 は PDFium のネイティブ版なので、同じ PDFium でも WASM 版と出力が同じとは限らない。
- **未検証**: パスワード付き PDF とオーナーパスワードだけの PDF の区別 (対象 spec の AC 1.10 / 1.12) が、各候補で取れるかどうか。
- 他の候補: pdfjs-dist、pdfium-native など。比べていない。

### 1.3 子プロセスと OS の上限

- **実測**: Node には `setrlimit` (プロセスが自分に資源の上限を掛ける仕組み) が無い。
- **実測**: util-linux の `prlimit` (上限を掛けてから別のコマンドを起動するコマンド) は slim image に最初から入っており、これで子プロセスを包める。
- **実測**: RSS (プロセスが実際に使っている物理メモリ) の監視と `oom_score_adj` の設定は、Python 版と同じく `/proc` を読み書きして行える。
- **決定 (2026-11-04、ユーザー判断)**: `prlimit` は対象 spec の AC 1.7 の「外部バイナリ」に当たらない。AC 1.7 は ffmpeg や exiftool のような変換用の外部ツールを入れないことが元の意図だったため。ただし「slim image に入っている」という前提は、Dockerfile のビルド時、CI の image の確認、起動時の `/readyz` の 3 か所で確かめる (requirements の Req 8.7、8.8、9.5)。
- **未検証**: 採用する Node の slim image の版で `prlimit` が入っていること。上の調べはある版の slim image で確かめたもので、版を固定したうえで Req 8.7 のビルド時の検査で守る。

### 1.4 仮想メモリの上限 (`RLIMIT_AS`)

- **実測**: Python 版は `RLIMIT_AS` を 300MB にしても動く。
- **実測**: Node は、何もしない状態で 1,200MB、anydoc で XLSX を変換すると 2,000MB、PDFium WASM を使うと 3,000MB 以上の `RLIMIT_AS` が必要になる。これは実メモリではなく、仮想メモリの予約 (まだ使っていないが確保だけしているアドレスの範囲) による。
- このため、Python 版で「RSS の上限 + 512MB」にしていた最後の歯止めは、Node 版では同じ値にできない。Node 版では `RLIMIT_AS` を大きく緩め、RSS の監視が主な守りになる。
- k8s の limits は実メモリで数えるので、仮想メモリの予約の大きさは k8s の limits には影響しない。

### 1.5 メモリと起動時間

- **実測**: 70,000 セルの XLSX を変換したときの子プロセスの最大 RSS は、Python 167MB、Node 193MB (Node が約 26MB 多い)。
- **実測**: 何もしない状態の RSS は、Node 45MB、Python 28MB。
- **実測**: Python 版の子プロセスの起動 (forkserver) は約 29ms。
- **未検証**: Node 版の子プロセスの起動時間。40〜60ms ほどと見込んでいるが、測っていない。

### 1.6 採らなかった実行環境

- **実測**: Bun は挙動が不安定だった。
- **実測**: Deno は `RLIMIT_AS` を 5GB にしても動かなかった。
- どちらも採らない。

## 2. 食い違っている数字 (未解決)

対象 spec の design.md と research.md は、「7 万セル 1 シートの XLSX で子の最大 RSS 285MB (上限 320MB の 89%)」としている。一方、1.5 の実測では「70,000 セルの XLSX で Python 167MB」である。

同じ 7 万セルでも、使ったファイル (行と列の形、セルの中身) か測り方 (子プロセスの作り方、待機中の子の RSS を含めるかどうか) が違うと考えられるが、どちらが原因かは確かめていない。メモリの予算 (requirements の Req 3.14) と RSS の上限の余裕は、この数字を基に組み立ててはいけない。requirements の Req 11.2 のとおり、対象 spec の基準値を取ったのと同じファイルと同じ方法で Node 版を測り直してから決める。

## 3. 対象 spec の判断のうち、前提が変わるもの

- **配置**: 対象 spec が `services/` を pnpm workspace の外に置いた理由は、「Python を workspace に混ぜると `pnpm install` や `turbo run build` が複雑になる」「`package.json` の無いディレクトリを workspace から外す設定が要る」という Python に固有のものだった (対象 spec の research.md §2.9、§3.7)。Node 版ではこの理由は当てはまらないので、workspace に入れるかどうかは改めて比べる (requirements の Req 11.8)。
- **anydoc を Node から使わなかった理由**: 対象 spec が不採用にしたのは「anydoc を apps/app のプロセスの中で Node から使う」案で、理由は重い処理と異常終了を apps/app から切り離すためだった (対象 spec の research.md §2.9、§3)。この書き換えでも別のコンテナで動かす形は変えないので、この判断とは矛盾しない。
- **OpenAPI の名前**: commit 済みの `openapi.json` には、FastAPI が自動で付けた名前 (`operationId` の `post_extract_extract_post`、スキーマ名の `Body_post_extract_extract_post`、`title` の `Pagenumber` など) が入っている。orval の生成物 (`src/generated/index.ts`) の型の名前 (`BodyPostExtractExtractPost` など) はこれから作られるので、Hono 用の仕組みが既定で付ける名前のままだと生成クライアントが変わる。requirements の Req 7.1 で、これらの名前も含めて同じ文書を出すことを既定の方針として求めている。名前を同じに作ることでかえって複雑になる場合は、Req 7.6 の手続きで崩してよい。
- **OpenAPI の説明文**: **実測**: 説明文にも Python 版の言葉が入っている (`/readyz` の説明の「forkserver が動き…probe child を fork する」、`PageInfo` の説明の「None」)。orval はこれらを `src/generated/index.ts` の JSDoc コメントに写している。説明文を Node 版に合わせて直すと、型は変わらなくても生成クライアントのコメントに差分が出る。ユーザーは説明文だけを直すことを決めた (5 節)。

## 4. 対象 spec に入っていない、運用者から見える振る舞い

requirements を書く途中で、対象 spec の AC と OpenAPI の文書では決まっていないが、運用者から見えるものが見つかった。`WORKERS`、`/readyz` の `dependencies`、`/docs` と `/redoc` は、design でユーザーが決めた (design.md の D1〜D3。決定の記録は 7 節)。

- **`WORKERS`**: uvicorn のワーカー数を指す環境変数。Node には同じ仕組みが無いので、意味をどうするか (無視する、Node の cluster の数にする、廃止する) を決める必要がある。
- **`/readyz` の `dependencies`**: いまは `anydoc` / `pypdfium2` / `charset-normalizer` / `converter` の名前を出している。OpenAPI の文書ではこの応答の形を決めていない (スキーマが `{}`) ので、名前を変えても生成クライアントは変わらない。
- **`/docs` と `/redoc`**: FastAPI が既定で出している API の説明画面。認証が要るパスとして出ており、テストでは確かめていない。
- **1 件ごとのログ**: `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…` の形の 1 行。requirements の Req 1.7 で、出す項目と出さない項目を保つことを求めている。

## 5. ユーザーの決定 (2026-11-04)

- **既定値を下げてよい**: Node 版で `MAX_CHILD_RSS_MB` 320 や `MAX_XLSX_CELLS` 70,000 が成り立たない場合は、既定値を下げてよい。下げた場合は、下げた値・根拠の計測・検索の対象になる XLSX の範囲の変化を、この文書の「6. 計測の結果」(design フェーズで作る) に記録する。メモリの予算 (2Gi) を超えることと、既定値を上げることは認めない (requirements の Req 11.11)。
- **OpenAPI の説明文を直す**: Python 版に固有の言葉 (forkserver、fork、None など) を説明文から取り除く。型・名前・関数・引数は変えない。直した説明文ごとに、直す前と後の文をこの文書に記録する (requirements の Req 7.1、7.5)。
- **`prlimit` を使ってよい**: 上の 1.3 を参照。
- **契約の維持は既定の方針**: API・エラー・設定・OpenAPI・生成クライアントを変えないこと (requirements の Req 1、Req 7) は、作業を単純にするための既定の方針とする。守ると apps/app や抽出サービスが複雑になるなら崩してよい。判断の基準はシンプルさ (保守性) で、判断するのは作業者。崩したときは、何を崩したか・守ると何がどう複雑になったか・下流の変更の範囲を、この文書の「7. 崩した契約」(崩したときに作る) に記録する。セキュリティ上の性質、メモリの予算 2Gi、対応形式と位置情報つきの抽出は崩さない (requirements の Req 1.9〜1.13)。
- **出力の同一性は求めず、検索の品質で測る**: anydoc を使った結果として自然な出力なら、Python 版と一字一句同じでなくてよい。代わりに、検索で見つかるべき語句と位置の正解を付けたベンチマークで、Node 版が Python 版のベースラインを下回らないことを求める (requirements の Req 2.7〜2.15)。ベンチマークの結果は、この文書の「6. 計測の結果」に記録する。

## 未決事項

| 項目 | 状態 | 決め方 |
|---|---|---|
| `WORKERS` の Node での意味 | 決定 (廃止。7 節) | ユーザー判断 (design.md の D1) |
| `/readyz` の `dependencies` に出す名前 | 決定 (部品の実名と `prlimit`。7.3 節) | ユーザー判断 (design.md の D2)。PDF などの実名は T1・T6 の試作で確定する |
| `/docs` と `/redoc` を残すかどうか | 決定 (出さない。7 節) | ユーザー判断 (design.md の D3) |
| 配置 (pnpm workspace に入れるか) | 決定 (`apps/attachment-text-extractor/` に移して workspace に入れる) | ユーザー判断 (design.md の D4) |
| PDF のライブラリ | 決定 (`@embedpdf/pdfium` 2.15.1。14 節) | 試作と計測 (Req 11.3) |
| 子プロセスの作り方 | 決定 (`/usr/bin/prlimit` で包んだ `spawn` と、子の中の見張り専用の worker thread。15 節)。コアダンプの上限を `--core=1` にするかはユーザーの判断待ち (15.1 の (d)) | 試作と計測 (Req 11.4) |
| `RLIMIT_AS` の値と、緩めた分の守り | 未決 | 試作と計測 (Req 11.5) |
| 本文の受け取りと切断の検知の方法 | 未決 | 試作 (Req 11.6) |
| OpenAPI の作り方 | 未決 | 試作 (Req 11.7) |
| 7 万セルの XLSX の RSS の食い違い (2 節) | 未解決 | 同じファイル・同じ方法で測り直す (Req 11.2) |
| ベンチマークで Python 版を下回った形式の扱い | 未決 (下回ったときだけ) | 原因を示し、ユーザーが直すか受け入れるかを決める (Req 2.14、11.12) |
| ベンチマークの絶対値の合格の基準 | 未決 | ベースラインを測った後にユーザーが決める (Req 2.13) |
| 実際の Elasticsearch (kuromoji) で検索を測れるか | 未検証 | ベンチマークを作るときに確かめる (Req 2.10) |
| 日本語 PDF の検索の品質 (pypdfium2 と WASM の PDFium の差) | 確かめた (コーパスの PDF 3 個では差なし。14 節。サービス全体での測定は 6.13) | ベンチマークと PDF のライブラリの選定で測る (Req 2.12、11.3) |
| Follow-ups のどれを直すか | 未決 | 取り込みの前にユーザーが決める (Req 12.6) |
| テスト用のファイルの作り方 | 決定 (すべて Node で作り直す。旧形式の DOC / PPT だけは commit 済みのものを使う) | ユーザー判断 (design.md の D5) |
| Node で作れないテスト用のファイル (暗号化した Office と PDF、XLS、細工した ZIP) | 決定: 作れないものは無い (9 節)。暗号化した Office は `officecrypto-tool` を採る (9.10、2026-11-04) | なし |

## 6. 計測の結果 (design フェーズ)

design を書くために、小さな試作で次のことを確かめた。**どれも devcontainer (Node 24.21.0、16 コア、Linux) で測ったもので、Node の slim image の中では測っていない**。image の中での値は、タスクの試作で取り直す。

### 6.1 Hono での本文の受け取りと切断の検知 (実測)

版: `hono` 4.13.16、`@hono/node-server` 2.1.6。生の TCP で要求を送って確かめた。

| 試したこと | 結果 |
|---|---|
| `Content-Length` が上限を超える要求を、本文を送らずに投げる | ハンドラーは本文を読む前にヘッダーを見て 413 を返せた |
| `Transfer-Encoding: chunked` で、宣言なしに上限を超える本文を送る | `c.req.raw.body` を少しずつ読み、届いたバイト数を数えて、上限を超えた時点で読むのをやめて 413 を返せた |
| 本文を送り終えた後、変換中 (ハンドラーが待っている間) に接続を切る | `c.req.raw.signal` の `abort` が発火した。これを使って変換の取り消しにつなげられる |
| 本文の途中で接続を切る | `abort` が発火し、本文の読み取りが例外で終わった |

分かったこと: Python 版で必要だった「FastAPI の `UploadFile` を使わず自分で本文を読む」「ASGI の `receive()` で切断を待つ」といった回り道は、Hono では標準の `Request` の `body` と `signal` だけで書ける見込みが高い。

**未検証**: multipart の分解の仕方。Hono の `c.req.parseBody()` は標準の `Request.formData()` を使うので、本文を全部受け取ってから分解すると考えられ、大きさの上限を自分で掛けられない (確かめていない)。上限つきでメモリに読み込んだ後に分解する方法と、少しずつ分解する部品 (busboy など) を使う方法を、タスクの試作で比べる。

### 6.2 `prlimit` で包んだ子プロセス (実測)

- slim ではない devcontainer の `prlimit` は util-linux 2.41.3。
- `spawn('prlimit', ['--as=…', '--cpu=60:65', '--core=0', '--', node, child])` で起動した子の `/proc/self/limits` は、仮想メモリ・CPU 時間 (soft 60 / hard 65 に分けられた)・コアダンプの上限が設定どおりになった。対象 spec の research にある「soft と hard が同じだと SIGXCPU より先に SIGKILL が届く」問題は、`--cpu=soft:hard` の書式で避けられる。
- `--as=300000000` (300MB) では、Node は起動できずに SIGTRAP で終わった (1.4 の調べと合う)。
- 子の起動から終了までの時間 (中央値、7〜10 回): `fork` 22.9ms、`spawn` 22.6ms、`prlimit` で包んだ `spawn` 21.8ms。`prlimit` を挟んでも時間はほとんど変わらなかった。
- anydoc を読み込む子を `prlimit` で包んで起動したとき: 中央値 26.8ms、anydoc の import は 2.7ms、読み込んだ直後の RSS は 51MB。

**未検証**: 変換の部品をすべて読み込んだ子の起動時間 (PDF の部品を含む)、image の中での値、1 件の変換の最大 RSS。

### 6.3 既存の Node のマイクロサービスの前例 (コードの確認)

- `apps/pdf-converter` は Node のマイクロサービスで、pnpm workspace の中 (`apps/*`) にあり、専用の CI (`ci-pdf-converter.yml`) と Dockerfile (`node:24-slim` を元にし、`pnpm deploy --prod` で本番の依存だけを取り出す multi-stage) を持つ。生成クライアント `packages/pdf-converter-client` も orval で作っている。
- ルートの `vitest.workspace.mts` は `apps/*/vitest.config.ts` と `packages/*/vitest.config.ts` を自動で拾う。`services/*` は拾わない。
- ルートの `biome.json` は `**` を対象にしているので、`services/` の下の TypeScript も、workspace に入れるかどうかにかかわらず biome の対象になる。
- ルートの `package.json` の `engines.node` は `^24`。

### 6.4 テスト用のファイルの作り方 (コードの確認)

- Python 版のテスト用のファイルは、テストの実行中に Python のテスト専用のライブラリ (openpyxl、python-pptx、python-docx、msoffcrypto-tool、xlwt、pypdf) で作っている (`tests/fixture_files.py`)。リポジトリに入れているのは小さなテキスト 2 つと、旧形式の DOC / PPT (Apache POI 由来) だけ。
- Python を撤去すると、この作り方は使えなくなる。暗号化した Office ファイルや XLS を Node で作る部品は調べていない (**未検証**)。
- **決定 (2026-11-04、ユーザー判断)**: すべて Node で作り直す (design.md の D5)。作り直しの難しさと確かめ方は design.md の T7 にある。

### 6.5 anydoc のネイティブ部品の大きさ (実測)

- npm で `@firecrawl/anydoc@0.2.4` を入れると、本体 (76KB) と、環境に合ったネイティブ部品の package (devcontainer では `@firecrawl/anydoc-linux-x64-gnu`、7.9MB) が入る。D4 で workspace に入れると、全開発者の `pnpm install` にこの大きさが加わる。arm64 などほかの環境の部品の大きさは測っていない。

## 7. 崩した契約 (requirements の Req 1.10 の記録)

既定の方針 (Req 1、Req 7) のうち、ユーザーの判断で崩したもの。判断の基準は「シンプルさ (保守性) が上がるか」。

### 7.1 `WORKERS` の廃止 (design.md の D1、2026-11-04)

- **(a) 何を崩すか**: 対象 spec の design.md §Configuration の `WORKERS` (uvicorn のワーカー数、既定 1)。Req 1.4 の「同じ名前・同じ意味で受け付ける」を崩す。Node 版はこの環境変数を読まない。
- **(b) 守ると何がどう複雑になるか**: Node には uvicorn のワーカーに当たる仕組みが無い。同じ意味を保つには、node:cluster で親を N 個に分け、それぞれが同時実行の枠と子の監視を持つ形にする必要があり、プロセスの管理が 1 段増える。さらに、Python 版で分かっていた弱点 (ワーカーが 2 つ以上だと OS の接続の振り分けが偏り、空きがあっても 503 が返る) も引き継ぐ。既定は 1 で、スケールは k8s の HPA で Pod を増やすのが本来の方法なので、ワーカーの数を持つ利点は小さい。
- **(c) 下流の変更の範囲**: `infra/docker/compose.yaml` と `deploy/k8s/deployment.yaml` から `WORKERS` を消し、メモリの予算の式からワーカー数の項を消す (この spec の中)。apps/app のコード、生成クライアント、下流 spec の契約は変わらない。運用者から見える変化: `WORKERS` を設定していても無視される。2 以上にしていた場合は、同時実行の全体の上限が `MAX_CONCURRENCY` だけになる。
- **反映先**: design.md の Revalidation Triggers。取り込みのときに対象 spec の design.md §Configuration から `WORKERS` を消し、メモリの目安の式を書き直す (対象 spec の AC には `WORKERS` が出てこないので、AC の文言の変更は要らない)。完了の報告でユーザーに示す。

### 7.2 `/docs` と `/redoc` の廃止 (design.md の D3、2026-11-04)

- **(a) 何を崩すか**: FastAPI が既定で出していた API の説明画面 `/docs` (Swagger UI) と `/redoc`。どちらも認証が要るパスだった。Req 1.2 の 4 つのエンドポイントと `/openapi.json` は変わらない。
- **(b) 守ると何がどう複雑になるか**: Hono で同じ画面を出すには、Swagger UI と ReDoc を配る部品 (またはその HTML と JS) を本番の依存に足す必要がある。apps/app はこの画面を使っておらず、テストも無いので、足す部品は保守の手間だけを増やす。`/openapi.json` が残るので、画面が要る人はそれを手元の道具で開ける。
- **(c) 下流の変更の範囲**: なし。apps/app も生成クライアントも、この 2 つのパスを使っていない (apps/app と生成クライアントのコードを検索し、`/docs` と `/redoc` を呼ぶ箇所が無いことを確かめた)。運用者から見える変化: この 2 つのパスは 401 (トークンなし) か 404 (トークンあり) になる。
- **反映先**: design.md の Revalidation Triggers。対象 spec の requirements と design には `/docs` と `/redoc` の記述が無いので、取り込みで直す本文は無い。完了の報告でユーザーに示す。

### 7.3 `/readyz` の `dependencies` の名前の変更 (design.md の D2、2026-11-04)

- **(a) 何を崩すか**: `/readyz` の応答の `dependencies` のキー。いまの `anydoc` / `pypdfium2` / `charset-normalizer` / `converter` を、Node 版が実際に使う部品の実名 (npm の package 名。`@firecrawl/anydoc`、T1 で決まる PDF の部品、T6 で部品を使う場合はその名前) と `prlimit`、内部のモジュールをまとめた `converter` に変える。Python 版の名前は、Node 版で使わないので出さない。
- **(b) 守ると何がどう複雑になるか**: 今の名前のままにすると、使っていない部品 (`pypdfium2` など) の名前で、別の部品が読み込めたかどうかを表すことになり、見た人を誤らせる。名前と中身を合わせるほうが単純で、保守の手間も増えない。役割の名前 (`pdf` など) にする案もあったが、ユーザーは「正しい部品の名前を入れる」ことを選んだ。
- **(c) 下流の変更の範囲**: なし。OpenAPI のスキーマは `{}` なので生成クライアントは変わらない。apps/app は `/readyz` を呼んでいない。k8s と compose の health の確認は HTTP のステータスだけを見て本文を見ないので影響しない。運用者から見える変化: curl などで本文を見たときの表示が変わる。
- **反映先**: design.md の Revalidation Triggers と、6.3 で Python 版に向けるときに外すテスト。取り込みのときに対象 spec の design.md §HealthRouter の `dependencies` の記述を書き直す。完了の報告でユーザーに示す。

## 8. Python 版を devcontainer で起動する手順 (タスク 1.3)

後続タスク (2.5 の差し替え確認、2.8 のベンチマーク基準の計測、4.x の黒箱テスト) が、そのままコピーして実行するための手順。Python 版のコードは変えない。2026-11-04 に devcontainer で実際に実行して確かめた (Python 3.12.15、uv 0.12.24、ネットワーク取得は不要だった)。サービスの既存の説明は `services/attachment-text-extractor/CLAUDE.md` にある。ここはその「起動して試す」部分だけを、Node 版との比較に使える形にまとめたもの。

**使い方**: 8.2〜8.5 は同じシェルで続けて実行するのが基本。別のシェルで 8.3 以降だけを貼っても、各ブロックの先頭の既定値 (`PORT` `PIDFILE` `LOG` `TOKENFILE`) が同じなので動く。8.3・8.4・8.5 は cwd に依存しない (どのディレクトリからでも実行できる)。8.2 だけは git のリポジトリ内のどこかで実行する (スクリプトが `git rev-parse` でルートを探して `services/attachment-text-extractor` へ移動する)。ポートやファイルの場所を変えるときは、4 つの変数を全てのブロックで同じ値にする。

### 8.1 前提と依存の入れ方

- `services/attachment-text-extractor/.venv` が既にあれば何もしなくてよい。無い、または壊れたときは次を実行する。`uv.lock` どおりに入れる (`--frozen` はロックを書き換えない)。テスト用の部品 (pytest など) も `--extra dev` で入る。

  ```bash
  cd services/attachment-text-extractor
  uv sync --frozen --extra dev     # 既に揃っていれば数 ms で終わる
  ```

- このサービスは pnpm の workspace の外にある。`pnpm install` は要らず、Node の PATH にも依存しない。
- devcontainer の `python3` (3.14) は使わない。必ず `.venv/bin/python` (3.12) を使う。この確認の時点では `python3 -c "import json"` は通ったので、メモリの「json モジュール欠落」は再現しなかったが、`.venv` の Python を使えば関係ない。

### 8.2 起動 (バックグラウンド、PID の取り方、ログ)

トークンは `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` の環境変数で渡す。無いと起動時に `ValidationError ... ATTACHMENT_EXTRACTOR_SERVICE_TOKEN Field required` で落ちる (Python 版の「起動時に必ず落ちる」設計。Node 版でも同じ振る舞いを比べられる)。トークンは毎回作る使い捨ての値で、リポジトリには置かない。後のブロックが別シェルでも読めるように、`/tmp` の 600 権限のファイル (`TOKENFILE`) に書く。使い終わったら 8.5 で消える。

次のブロックは**スクリプトとして実行する** (`bash <<'SCRIPT'` で包んであるので、そのまま貼ってよい。対話シェルに `exit` を直接貼ると端末が閉じるため、この形にしている)。

```bash
bash <<'SCRIPT'
PORT=${PORT:-18000}                              # 3000 は使わない
PIDFILE=${PIDFILE:-/tmp/py-extractor.pid}
LOG=${LOG:-/tmp/py-extractor.log}
TOKENFILE=${TOKENFILE:-/tmp/py-extractor.token}

cd "$(git rev-parse --show-toplevel)/services/attachment-text-extractor" || exit 1
if ss -ltn | grep -q ":$PORT "; then echo "port $PORT in use; set another PORT"; exit 1; fi
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running (pid $(cat "$PIDFILE"))"; exit 1; fi

umask 077
echo "dummy-$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$TOKENFILE"
ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=$(cat "$TOKENFILE") \
  setsid nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT" \
  >"$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
echo "started pid=$(cat "$PIDFILE") port=$PORT log=$LOG"
SCRIPT
```

- `.venv/bin/uvicorn` を直接起動する (`uv run` を挟むと、`$!` が uv の PID になり、止めるべき PID が分からなくなる)。`src` は venv の editable install で path に入るので、`--app-dir` も `PYTHONPATH` も要らない。`.env` は cwd から読まれるので、スクリプトは必ずサービスのディレクトリに移動してから起動する。
- `setsid` で新しいプロセスグループを作るので、`$!` がそのまま uvicorn の PID かつグループ ID になる。uvicorn の下に、`multiprocessing` の resource_tracker と forkserver (どちらも同じグループ) がぶら下がる。
- `--workers` は付けない (既定は 1。Dockerfile の `WORKERS` の既定と同じ)。`--reload` (poe の `dev`) も付けない (ファイル監視のプロセスが増えて、止めたときの確認が面倒になる)。
- 設定の上限 (`MAX_CONCURRENCY` など) を変えたいときは、`ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=...` と同じ行に環境変数を足す。

### 8.3 ready の待ち方 (ポーリング)

forkserver の起動を待つので、起動の直後は 503 または接続拒否になる。実測では約 1 秒で 200 になった。

```bash
PORT=${PORT:-18000}; PIDFILE=${PIDFILE:-/tmp/py-extractor.pid}; LOG=${LOG:-/tmp/py-extractor.log}
for i in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/readyz)
  [ "$c" = 200 ] && break
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || { echo "process died"; tail -20 "$LOG"; break; }
  sleep 0.5
done
echo "readyz=$c"
```

### 8.4 動作確認 (実測した出力)

```bash
PORT=${PORT:-18000}; TOKENFILE=${TOKENFILE:-/tmp/py-extractor.token}
[ -r "$TOKENFILE" ] || echo "token file $TOKENFILE not found: run 8.2 first"
TOKEN=$(cat "$TOKENFILE")
curl -s http://127.0.0.1:$PORT/healthz        # {"status":"ok"}
curl -s http://127.0.0.1:$PORT/readyz         # {"status":"ready","dependencies":{"anydoc":"ok","pypdfium2":"ok","charset-normalizer":"ok","converter":"ok"}}
printf 'hello extractor\n' > /tmp/py-extractor-sample.txt
curl -s -w ' [%{http_code}]\n' -H "Authorization: Bearer $TOKEN" \
  -F 'file=@/tmp/py-extractor-sample.txt;type=text/plain' http://127.0.0.1:$PORT/extract
# {"pages":[{"pageNumber":null,"label":null,"content":"hello extractor\n"}],"mimeType":"text/plain","extractedCharacters":16} [200]
curl -s -w ' [%{http_code}]\n' -F 'file=@/tmp/py-extractor-sample.txt' http://127.0.0.1:$PORT/extract
# {"code": "unauthorized", "message": "Missing or invalid Bearer token"} [401]
```

`/healthz` と `/readyz` はトークン無しで 200。`/extract` はトークンが要る。

### 8.5 停止の仕方 (自分で起動した PID だけを止める)

```bash
PORT=${PORT:-18000}; PIDFILE=${PIDFILE:-/tmp/py-extractor.pid}; TOKENFILE=${TOKENFILE:-/tmp/py-extractor.token}
PID=$(cat "$PIDFILE")
kill -TERM "$PID"                                      # uvicorn が forkserver 等も後始末して終わる (実測 約 1 秒)
for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
pgrep -g "$PID"; echo "pgrep rc=$? (1 なら残りなし)"    # 同じグループに残りが無いこと
ss -ltnp | grep ":$PORT " || echo "port released"
rm -f "$PIDFILE" "$TOKENFILE" /tmp/py-extractor-sample.txt
```

- `pkill uvicorn` のような名前での広い停止はしない。ほかの作業の uvicorn も巻き込むため。
- TERM で止まらないときだけ `kill -KILL -- -"$PID"` (グループ全体)。
- 実測では、停止後に `pgrep -g` は何も返さず、ポートも解放された。

### 8.6 Python 版のテストを実行する

```bash
cd services/attachment-text-extractor
.venv/bin/python -m pytest -q          # 約 85 秒
.venv/bin/python -m pytest -q tests/test_extract_router.py   # 個別 (部分名で一致)
```

- ネットワーク不要で動く (テスト用のファイルは pytest の fixture が実行時に生成する)。トークンは `tests/conftest.py` の autouse fixture が入れるので、環境変数は要らない。`uv run pytest` でも同じだが、`.venv/bin/python -m pytest` のほうが uv の再同期が走らず速い。
- 2026-11-04 (コミット `9cf01c716d` の後) の結果: `1222 passed` (失敗 0、エラー 0、約 84 秒)。
- 注意: Node 版の CI ジョブは、Python 用の workflow (`.github/workflows/attachment-text-extractor.yml`) の外にある別の workflow (`.github/workflows/ci-attachment-text-extractor.yml`) に置いてある。Python 版の `tests/test_ci_workflow.py` が「Python 用 workflow のジョブは 1 つだけで、全ジョブに `permissions` がある」ことを前提にしているため、Python 用 workflow に Node のジョブを足すとこのテストが壊れる。Python 版を撤去するタスクで、この workflow とテストを一緒に消すときの手掛かりにする。

### 8.7 はまりどころ

- **トークン未設定**: 起動時に `ValidationError` で落ちる。ログ (`$LOG`) の末尾に `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN  Field required` と出る。
- **cwd**: `.env` と相対パスは cwd 基準。8.2 は自分でサービスのディレクトリへ移動する。
- **`/tmp/pymp-*`**: SIGTERM で止めると、multiprocessing が作る空の `/tmp/pymp-*` ディレクトリが残る (サービスの CLAUDE.md の Known Limits にある既知の挙動)。害は無い。残りの確認には使わない (`pgrep -g` と `ss` で確認する)。
- **ポート**: 3000 は GROWI 本体の開発サーバーが使うので、18000 などを使う。8.2 が `ss` で空きを確かめる。
- **`uv run` で起動しない**: `$!` が uv の PID になり、止めるときに uvicorn が残る恐れがある。
- **`--reload` を付けない**: 監視用の子プロセスが増え、グループ単位で止めない限り残る。
- **`/docs` `/redoc`**: Python 版は 401 (トークン無し) を返し、トークンを付けると画面が出る。Node 版は 7.2 のとおり無くなる (差し替え確認で差として出る)。

## 9. テスト用のファイルを Node で作れるか (T7、タスク 2.1)

2026-11-04 に devcontainer (Node 24.21.0) で試作した結果。試作は使い捨ての場所 (リポジトリの外の scratchpad) で、独自の `package.json` に `npm install` して行った。リポジトリの workspace・lockfile・`apps/attachment-text-extractor` には何も足していない。生成器の本実装はタスク 2.3 / 2.4 で行う。

### 9.1 結論 (実測)

- **Node で作れないものは無い**。`tests/fixture_files.py` のうちファイルを作る fixture 28 個 (旧形式の DOC / PPT の 2 個は対象外)、テストのファイルの中で作っている細工したファイル 37 個、追加で数え直して作ったファイル 15 個の **計 80 ファイル**と、文字コードの入力 20 個のバイト列を、Node で作れた。ほかに、`test_xlsx_split.py` と `test_pptx_split.py` が openpyxl / python-pptx で作っているブック・デッキの全部 (9.5.3) も Node で作り直し、テスト本体を変えずに通した。
- 確かめ方は 5 つあり (9.2)、どれも Python 版のファイルと同じ結果になった。
  - `fixture_files.py` の分で anydoc に通す 25 個、細工したファイル 37 個、追加のファイル 15 個は、Node 版と Python 版の両方の anydoc で、Python 版のファイルと **判定が同じで、成功するものは Markdown 全文の SHA-256 も同じ**だった (4 通りすべて同じ)。
  - Python 版の `tests/test_fixture_files.py` は Node のファイルで 30 件すべて通った。
  - Python 版の `tests/conversion/` の全体 (599 件) は、ファイルから読む fixture を Node のものに差し替えて、すべて通った。`test_xlsx_split.py` (50 件) と `test_pptx_split.py` (65 件) は、ブック・デッキを作る関数も Node のものに差し替えて、すべて通った。
  - 文字コードの 20 個は、1 個 (cp932 の「髙」) を除いてバイト列まで同じで、Python 版のサービスの `decode()` の結果は 20 個とも同じだった。
- 部品で作れないところは自前で書いた。書いた量は ZIP の書き出しが約 50 行、OOXML (XLSX / DOCX) が約 90 行、PPTX が約 60 行、PDF の組み立てと暗号化が約 70 行、XLS (BIFF8) が約 30 行、ISO-2022-JP が約 15 行。
- ただし次の 6 つは、そのままでは動かず、手当てが要った (9.4・9.5・9.7 に詳しく書く)。
  1. 暗号化した Office と XLS は、部品 (`officecrypto-tool`、SheetJS) が書き出す OLE のファイル (Office の古い入れ物の形式) を、anydoc が「壊れている」と判定した。原因は、両方の部品が使っている `cfb` (OLE を書く部品) の書き方にある。書き出した後に 11 行の修正をかけると直る。
  2. XLS は、SheetJS で書くと、Python 版の性質のテスト (`test_xls_is_an_ole_biff8_workbook_with_two_sheets`) のうち、ファイルの中から ASCII の `First` などを探す部分だけが通らなかった。SheetJS が文字列を UTF-16 で書くため。そこで、文字列を 1 バイトで書く最小の BIFF8 の書き出しを自前で書いた (約 30 行。OLE の入れ物は `cfb` と上の修正)。これで Python 版のテストは変えずに通り、anydoc の出力も Python 版のファイルと同じになった。SheetJS は使わない。
  3. bzip2 / LZMA で圧縮した部品が壊れている ZIP は、Node の標準に bzip2 / LZMA の圧縮が無い。そこで、圧縮の方式の番号だけを書き、本体には壊れたバイト列を置く方法に替えた。判定 (`malformed`) は Python 版と同じになった。
  4. **ISO-2022-JP のテキストは `iconv-lite` で書けない** (`Encoding not recognized: 'iso-2022-jp'`)。`test_charset.py` と Req 2.4 が求める入力なので、EUC-JP の出力から作る自前の関数を書いた。`test_charset.py` の入力と、10 通りの例、BMP (U+0000〜U+FFFF、サロゲートを除く) の 1 字ごとの比較では、**Python の `iso2022_jp` と同じバイト列**になった。ただし BMP のうち 13 字は同じにならない (Node だけが拒否する 8 字、Python だけが拒否する 5 字)。`test_charset.py` の入力には含まれない (9.7)。
  5. **PPTX の関係の ID は `rId<数字>` にする**。最初の Node の PPTX は `rIdS1` と書いており、Python 版の `test_slide_entry_pointing_at_no_relationship_is_malformed` (正規表現 `r:id="rId\d+"/></p:sldIdLst>` で `presentation.xml` を書き換える) が通らなかった (`1 failed, 64 passed`)。ID を `rId<数字>` にすると 65 件すべて通った。この種の「正規表現やバイト置換で書き換える」テストの入力は、Node 側の書き方を openpyxl / python-pptx と同じにそろえる必要がある (9.5.4)。
  6. 最初の試作では、判定の比較だけを見て「同じ」としていた。Markdown の全文を比べると、細工したファイル 11 個で違っていた。Node 側の中身を Python 版と同じに直して、全文の SHA-256 が一致するようにした (9.5)。あわせて、DOCX の段落の中の改行を `<w:br/>` にしないと python-docx と違うこと、シートに `state="visible"` が要ること、cp932 の「髙」の符号が iconv-lite と Python で違うことも見つかった (9.5、9.7)。

### 9.2 確かめ方

anydoc の判定が同じでも、テストが確かめたい性質を持っているとは限らない。たとえばセル数の上限の検査、ZIP の申告サイズの検査、展開後の大きさの検査は、anydoc ではなくサービスが自分で行う。そこで、次の 5 つの判定役で確かめた。

| 判定役 | 対象 | やり方 |
|---|---|---|
| (a) anydoc の判定 | anydoc に渡す fixture 25 個 | Python 版のファイル (Python 版の `fixture_files.py` の関数をそのまま呼んで作ったもの) と Node のファイルのそれぞれを、Node 版の anydoc (`@firecrawl/anydoc@0.2.4` の `toMarkdownBytes`) と Python 版の anydoc (`.venv` の `anydoc.to_markdown_bytes`) に通す。4 通りの判定 (失敗の種類、または成功) を比べ、成功したものは **Markdown 全文の SHA-256 (と UTF-8 の長さ)** も比べる。XLS は両方とも形式 `xlsx` で渡す (Python 版のサービスと同じ) |
| (b) 性質のテスト | 同じ 25 個と、テキスト 3 個、`*_path` の大きなファイル | Python 版の `tests/test_fixture_files.py` (30 件) を使い捨ての場所に写し、fixture を「Node で作ったファイルを読む」形に差し替えた `conftest.py` で動かす。Python 版のコードは変えていない。openpyxl・python-docx・python-pptx・msoffcrypto (パスワードでの復号)・pypdf・pypdfium2 で開いて確かめる |
| (c) Python 版の守りの関数 | テストのファイルの中で作っている細工したファイル (37 個のうち 32 個) | Python 版のサービスの関数 (`inspect_archive`、`read_part`、`enforce_cell_limit`、`convert_xlsx`、`convert_pptx`) に、Python 版のテストの関数で作ったものと Node で作ったものの両方を通し、結果 (`ConversionError` の種類、ページの中身) を比べる |
| (d) 文字コード | 20 個のバイト列 | Python の `str.encode(...)` と Node の符号化 (`iconv-lite` ほか) の結果を 16 進で比べ、Python 版のサービスの `decode()` に両方を通して結果を比べる |
| (e) Python 版のテスト本体 | `tests/conversion/` の全体、`test_xlsx_split.py`、`test_pptx_split.py` | (1) `conversion/` の 599 件を、fixture の読み込みだけ Node のファイルに替えて動かす。(2) `test_xlsx_split.py` と `test_pptx_split.py` は、ブックやデッキを作る関数 (`_book`、`_stale_reference_book`、`Presentation()` を使う関数と、テストの中の `Presentation()`) を、Node で作ったものを返す関数に替えた写しを動かす。テストの本体 (assert) は変えない |

### 9.3 RED (作る前の一覧と、最初に失敗した試作)

作る前は、9.4 と 9.5 の一覧にあるものが **すべて「Node ではまだ作れていない・確かめていない」状態** だった。最初の試作で失敗したもの:

| 試したこと | 結果 |
|---|---|
| pdf-lib (1.17.1、MIT) で PDF を暗号化する | `PDFDocument` に暗号化の関数が無い (`typeof doc.encrypt` は `undefined`)。`save({ userPassword, ownerPassword })` と渡しても出力に `/Encrypt` が無い。pdf-lib では暗号化できない |
| `officecrypto-tool` (0.0.19) で DOCX / XLSX / PPTX を暗号化する | 両方の anydoc が `encrypted` ではなく `malformed` を返した (Python 版のファイルは `encrypted`)。ただし msoffcrypto ではパスワードで復号でき、中身も正しかった |
| SheetJS (0.20.3) で XLS (BIFF8) を書く | 両方の anydoc が `malformed`。Node 版の anydoc のメッセージは `not an OLE2 compound file: Malformed FAT (FAT has 128 entries, but file has only 12 sectors)` |
| pptxgenjs (4.0.1、MIT) で PPTX を作る | anydoc では読めたが、python-pptx の `slide.shapes.title` が `None` になり、Python 版の性質のテストが 3 件失敗した。pptxgenjs はタイトルの placeholder を `idx="100"` で書き、python-pptx はタイトルを `idx` が 0 の placeholder として探すため |
| 最初の ISO-2022-JP の自前の関数 (EUC-JP の出力から作る。書けない字の検査なし) | BMP の 1 字ごとに Python の `iso2022_jp` と比べると、同じは 7,001 字だけで、**50,349 字は Python が拒否するのに Node は黙って `?` を書き**、8 字はバイト列が違った。iconv-lite は EUC-JP に無い字を例外にせず `?` (0x3F) に置き換えるため。修正は、1 字ごとに EUC-JP へ符号化し、復号して元の字に戻ることを確かめ、2 バイトの先頭が JIS X 0208 の範囲 (0xA1〜0xA8、0xB0〜0xF4) のときだけ JIS として書く (9.7) |
| `iconv-lite` で ISO-2022-JP を符号化する | `Encoding not recognized: 'iso-2022-jp'` (searched as: `iso2022jp`)。iconv-lite は ISO-2022-JP を書けない (読むこともできない) |
| 細工したファイルを、判定だけで比べる | 判定は 37 個すべて同じだったが、Markdown の全文を比べると 11 個が違った (ノート用のデッキの本文の placeholder と、`xs_stored` のセルの値。9.5)。判定だけの比較は見落としが出る |
| Node の PPTX の関係の ID を `rIdS1` のまま、Python 版の `test_pptx_split.py` を通す | `1 failed, 64 passed` (`test_slide_entry_pointing_at_no_relationship_is_malformed`。正規表現 `r:id="rId\d+"/></p:sldIdLst>` が `rIdS1` に当たらない)。`rId<数字>` に直すと `65 passed` |
| 最初の Node のファイルに (b) の性質のテストを通す | `4 failed, 26 passed` (PPTX の 3 件と XLS の 1 件)。PPTX は XML から組み立てる方法に、XLS は自前の BIFF8 に替えて `30 passed` |

### 9.4 `fixture_files.py` の fixture ごとの結果 (実測)

「方法」の列で、**自前** は自分で書いたコード (Node の標準の `node:zlib` / `node:crypto` だけを使う)、**部品** は npm の package を使ったもの。「判定」は (a) の 4 通り (Python 版・Node のファイル × Node 版・Python 版の anydoc) で、失敗の種類、または成功した出力の全文の SHA-256 がすべて同じだったかどうか。「性質」は (b) のテストの結果。

| fixture | 方法 | 判定 (a) | 性質 (b) |
|---|---|---|---|
| `xlsx_multi_sheet` / `xlsx_single_sheet` / `xlsx_hidden_sheet` | 自前: XML の文字列から組み立てて自前の ZIP に入れる。文字列はセルの中に直接書く (`t="inlineStr"`)。非表示は `<sheet state="hidden">` | 同じ (成功。全文の SHA-256 も同じ) | 通る |
| `xlsx_chart_sheet` | 自前: グラフだけのシート (`xl/chartsheets/`)、drawing、グラフ (`xl/charts/chart1.xml`) を XML で書く。SheetJS と exceljs はグラフだけのシートを書けない | 同じ (成功。全文の SHA-256 も同じ) | 通る (openpyxl が `chartsheets` を見つける) |
| `xlsx_over_cell_limit_path` (70,001 セル) / `xlsx_large_for_timeout_path` (5 シート × 14,000 行) | 自前 (上と同じ) | 同じ (成功。全文の SHA-256 も同じ) | 通る (セル数がちょうど一致) |
| `pptx_multi_slide` | 自前: マスター・レイアウト・テーマ各 1 つと、タイトル (`idx` 0) と本文の placeholder を持つスライドを XML で書く。本文を箇条書きにするため、マスターの `bodyStyle` に行頭の記号を置く (置かないと Markdown の `- ` が付かず、Python 版と違う出力になる) | 同じ (成功。全文の SHA-256 も同じ) | 通る |
| `docx_large_images_path` / `pptx_large_images_path` | 自前: PNG (画素が乱数で圧縮が効かないもの) を `node:zlib` で書き、DOCX / PPTX に 11 枚入れる。乱数は種を固定した自前の関数 (mulberry32)。Python の `random` と同じ並びは作れないが、テストが要るのは「圧縮が効かない」「40MiB 以上 50MB 未満」だけ。PPTX の画像には代替テキスト `descr="image.png"` を付ける (python-pptx と同じ出力にするため) | 同じ (成功。全文の SHA-256 も同じ) | 通る (44MiB 前後) |
| `docx_zip_bomb_path` | 自前: `word/document.xml` (約 520MiB) を `createDeflateRaw` に少しずつ流して圧縮し、圧縮後の 0.7MB だけをメモリに持つ。CRC も少しずつ計算する | 同じ (`resourceLimit`) | 通る (申告サイズが上限を超える) |
| `docx_deeply_nested` | 自前: `<w:sdt><w:sdtContent>` を 10 万段重ねた XML を文字列で作る | 同じ (`resourceLimit`) | 通る |
| `docx_encrypted` / `xlsx_encrypted` / `pptx_encrypted` | 部品: `officecrypto-tool` で ECMA-376 の agile encryption (`EncryptionInfo` の版が 4.4) をかけ、その後に自前の FAT の修正 (9.7) をかける | 同じ (`encrypted`) | 通る (msoffcrypto が `office-test-password` で復号でき、中から `encrypted marker` が出る) |
| `pdf_text` / `pdf_image_only` | 自前: Python 版の `_build_pdf` をそのまま移した | 同じ (成功 / `needsOcr`) | 通る。**Python 版とバイト列まで同じ** |
| `pdf_user_password` / `pdf_owner_password_only` | 自前: PDF の Standard security handler (revision 3、RC4 128bit。pypdf の `RC4-128` と同じ方式) を書いた。Node 24 の OpenSSL 3 は `rc4` を使えない (`ERR_OSSL_EVP_UNSUPPORTED`) ので RC4 も自前 (10 行) | 同じ (`encrypted` / 成功) | 通る。pypdf でも Python 版と同じ: ユーザーパスワード付きは空のパスワードで開けず (`NOT_DECRYPTED`)、所有者パスワードだけのものは空のパスワードで開ける (`USER_PASSWORD`)。どちらも所有者パスワードで `OWNER_PASSWORD` になる |
| `pdf_corrupt` | 自前: `pdf_text` の先頭 + 乱数 512 バイト | 同じ (`malformed`) | 通る |
| `text_shift_jis` / `text_euc_jp` | 部品: `iconv-lite` で符号化する (Node の標準は Shift_JIS / EUC-JP の符号化ができない。復号は `TextDecoder` でできる。ISO-2022-JP は iconv-lite でも書けないので 9.7 の自前の関数) | 対象外 (anydoc に渡さない) | 通る。Python 版とバイト列まで同じ |
| `text_utf8_bom` | 自前: BOM + UTF-8 | 対象外 | 通る。バイト列まで同じ |
| `odt` / `ods` / `odp` / `epub` | 自前: Python 版の文字列をそのまま移し、`mimetype` を先頭に無圧縮で入れる | 同じ (成功。全文の SHA-256 も同じ) | 通る |
| `rtf` | 自前: Python 版の `_rtf_escape` を移した | 同じ (成功。全文の SHA-256 も同じ) | 通る。バイト列まで同じ |
| `xls` | 自前: BIFF8 のレコード (BOF、CODEPAGE、FONT、XF、BOUNDSHEET、DIMENSIONS、LABEL、NUMBER、EOF) を書き、文字列は 1 バイトの文字で書く (xlwt と同じ)。OLE の入れ物は部品 `cfb` で書き、9.7 の FAT の修正をかける。先に試した SheetJS (`bookType: 'biff8'`) は、FAT の修正で anydoc は通ったが、文字列を UTF-16 で書くため Python 版のテストが 1 件通らなかった | 同じ (成功。全文の SHA-256 も同じ) | 通る (OLE の印、`Workbook` のストリーム名、BIFF8 の BOF レコード、ASCII の `First` / `Second` / `XLS cell marker`) |
| `office_password` / `pdf_password` | 定数 | — | — |
| `legacy_doc` / `legacy_ppt` / `legacy_fixture_sha256` | 対象外 (D5 の例外。commit 済みのファイルを出所の記録と一緒に移す: タスク 2.3) | — | 移したファイルで通る見込み (ファイルは同じもの) |

### 9.5 テストのファイルの中で作っているファイルの結果 (実測)

#### 9.5.1 一覧の作り方

`fixture_files.py` の外で、テストのファイルの中で作っているファイルは、`tests/` を grep して数えた。次のコマンドで、ファイルを作る道具 (openpyxl、python-pptx、python-docx、xlwt、pypdf、msoffcrypto、`zipfile` の書き込み、`struct.pack`、手組みの PDF、文字コードの符号化、BOM、バイト置換、`make_docx` などの fixture の関数) を使っている行を、ファイルごとに数える。出た 16 ファイルを 1 つずつ読み、作っているものをすべて下の表に入れた。

```bash
cd services/attachment-text-extractor/tests   # bash で実行する
grep -rnE 'Presentation\(\)|openpyxl\.Workbook|Document\(\)|xlwt|PdfWriter|msoffcrypto\.|zipfile\.ZipFile\(.*"[wa]"|struct\.pack|_build_pdf\(|_pdf_stream\(|\.encode\("(cp932|euc_jp|iso2022_jp|cp1252|koi8-r|shift_jis|utf-16|utf-32)|codecs\.BOM|re\.(sub|compile|findall|search)\(rb|\.replace\(b|make_docx\(|make_pptx\(|make_text_pdf\(|write_xlsx_cells\(|_random_images\(' \
  --include='*.py' . | grep -v __pycache__ | grep -v fixture_files.py | cut -d: -f1 | sort | uniq -c
```

結果 (2026-11-04): `conversion/` の `test_archive_guard` 9、`test_charset` 18、`test_core` 2、`test_office` 5、`test_pdf` 3、`test_pptx_split` 20、`test_text` 4、`test_xlsx_split` 18、`test_xlsx_split_precheck` 5 行。`runner/` の `test_child_entry` 3、`test_child_isolation` 10、`test_conversion_runner` 5、`test_wire` 1 行。ほかに `test_dependencies` 1、`test_e2e_http` 4、`test_live_server` 1 行。`test_core`、`test_conversion_runner`、`test_child_entry`、`test_e2e_http` の `make_docx(...)` と `make_text_pdf(...)` の呼び出しは、下の DOCX と PDF の行と同じ作り方 (段落の文字列だけ違う)。`test_wire` の `struct.pack` は、ファイルではなく通信の枠。`test_live_server` と `test_dependencies` の行は、ファイルの生成ではない。

文字列やバイト列を書くだけで済むもの (HTML、XML、ipynb、CSV、TSV、JSON、YAML の短い文字列、`b"x" * N` の埋め草、アップロード用の 1MiB〜70MiB の本文など) は、Node でも同じ文字列を書くだけなので、ファイルとしては作っていない。

分類:

| 組 | 数 | どこで確かめたか |
|---|---|---|
| 細工したファイル (`ag_` / `pc_` / `ps_` / `xs_` / `ci_`) | 37 ファイル | 9.5.2 の前半の表 |
| 追加で作ったファイル (`of_` / `rx_` / `rp_` / `hy_`) | 15 ファイル | 9.5.2 の後半の表 |
| ブック・デッキ (`test_xlsx_split.py` と `test_pptx_split.py` の中の関数が作るもの) | 関数と、テストの中での作成 | 9.5.3 |
| 文字コードの入力 | 20 個のバイト列 | 9.5.5 |

`fixture_files.py` の 28 ファイルと合わせて、**ファイルとして 80 個**と、文字コードのバイト列 20 個を Node で作った。

判定の確かめ方:
- 「判定 (c)」: Python 版のサービスの守りの関数に、Python 版のテストの関数で作ったものと Node で作ったものを通した結果。
- 「両 anydoc」: 同じファイルを、Python 版のファイル・Node のファイルのそれぞれで、Node 版と Python 版の anydoc に通した 4 通りの結果。**判定の一致に加えて、成功したものは Markdown 全文の SHA-256 も比べた**。形式は名前の先頭で決めた (`ag_` と `ps_` は pptx、`pc_` と `xs_` と `rx_` は xlsx、`ci_` と `of_` は docx、`rp_` と `hy_` は pdf)。

結果: 前半の 37 個と後半の 15 個は、**どれも 4 通りの結果が同じ** (判定が同じで、成功する 15 + 9 個は全文の SHA-256 も同じ)。(c) の判定は前半の 32 個すべてで同じ。

最初の試作では、細工したファイル 11 個 (`ps_notes_deck` 系の 10 個と `xs_stored`) で判定は同じなのに Markdown が違った。原因は、Node 版のノート用のデッキに本文の placeholder (`body`) を入れていたこと (Python 版はタイトルだけ) と、`xs_stored` のセルの値が `a` ではなく `first copy` だったこと。判定だけの比較では見えなかったので、全文を比べる形に替え、Node 側を Python 版と同じ中身に直した。

anydoc 自身の判定は、`test_archive_guard.py` と `test_xlsx_split_precheck.py` の分は `malformed` / `missingPart` / `resourceLimit` (中身が本物の PPTX / XLSX ではないため)、`test_pptx_split.py` の分はすべて成功だった。後者のうち、関係の XML のエンティティの展開と `encoding="UTF-9"` は、Python 版のサービスの守りでは `malformed` になるが、anydoc 自身は変換に成功する。これらを拒否するのは anydoc ではなくサービスの守りだということで、Node 版でも同じ守りを自分で持つ必要がある (T6 の材料)。

#### 9.5.2 細工したファイルと追加のファイル

| 元のテスト | 作るもの | 方法 | 判定 (Python 版 = Node) |
|---|---|---|---|
| `test_archive_guard.py` | deflate のブロックの種類を壊す / 圧縮の方式を 9 にする / ZIP の暗号化の印を立てる / UTF-8 の印付きで UTF-8 でない名前 / 必要な版を 10.0 にする | 自前の ZIP にバイトの書き換え (Python 版と同じ位置) | `malformed` / `malformed` / `encrypted` / 素通し / 素通し |
| 同上 | 申告サイズを偽った ZIP | 自前: 無圧縮の部品の local header と central directory の「5000, 5000」を「10, 10」に書き換える (Python 版と同じ手) | `malformed` |
| 同上 | 名前の重複 / `../../evil.txt` と `/abs/evil.txt` の名前 / zip64 の部品 / 展開すると 200MiB になる部品 (zip64) | 自前の ZIP (重複も書ける)。zip64 は 0x0001 の追加欄を自前で書く (約 15 行) | 素通し / 読める / 読める / `limit_exceeded` |
| 同上 | bzip2 / LZMA の部品が壊れている | 自前: 方式の番号 (12 / 14) と壊れた本体を書く (9.1 の 3) | `malformed` / `malformed` |
| 同上 | 開いた後に中身が切り詰められる | ファイルではなく、メモリ上の入力を開いた後で短くするテスト。Node 版の ZIP の読み方 (T6) に合わせて書き直す | 対象外 (ファイルとしての fixture ではない) |
| `test_xlsx_split_precheck.py` | 非標準の場所のシート: `xl/worksheets/sub/sheet1.xml`、`xl/custom/sheet1.xml`、大文字の拡張子 `sheet1.XML`、パッケージ直下の `sheet1.xml`、`.bin`、拡張子なし | 自前の ZIP | 150 セルで通り、上限 149 で `limit_exceeded` (6 個とも) |
| 同上 | UTF-16 (LE / BE) のシート / 同じ名前のシートが 2 つ / 圧縮の流れを壊したシート | 自前 (UTF-16 BE は `Buffer.swap16()`) | `malformed` / `limit_exceeded` / `malformed` |
| `test_xlsx_split.py` | 部品の重複 (後ろの方だけ別の値) / すべて無圧縮 / 150MiB の pivot cache (セルではない大きな部品) | 自前 (pivot cache は流しながら圧縮。ファイルは 0.15MB) | `second copy` が読まれる / 無圧縮のまま 2 シート / 2 シート |
| 同上 | シート名・`state` の書き換え (`_renamed`、`_with_states`) | 自前: `buildXlsx` が `workbook.xml` に `state="visible"` をシートごとに書く (openpyxl と同じ。最初は書いていなかったので、`_with_states` の正規表現が当たらなかった)。名前は XML の特殊文字 (`"`、`&`、`<`) を含むものを含めて Python 版の関数 `_renamed` で書き換えた | `convert_xlsx` のページの番号とラベルが Python 版のファイルと同じ (実測) |
| `test_pptx_split.py` | 契約の確認用のデッキ (ノート、表、画像、グループ、非表示のスライド、空のスライド、並べ替えたスライドの一覧) | 自前の PPTX に、表 (`a:tbl`) とグループ (`p:grpSp`) の XML を足し、`presentation.xml` のスライドの並びを書き換える | `convert_pptx` のページ 6 枚の中身が Python 版と同じ |
| 同上 | 関係 (relationship) の行き先: `../../../outside.xml`、`/../outside.xml`、外部の URL、存在しない部品、絶対パス `/ppt/...` | 自前: `slide1.xml.rels` を書き換え、パッケージ直下に `outside.xml` を足す | 5 個とも Python 版と同じ (ノートは読まれ、`outside marker` は入らない) |
| 同上 | 関係の XML でのエンティティの展開 / XML 宣言の `encoding="UTF-9"` (3 か所) | 自前の書き換え | `malformed` (4 個とも) |
| `runner/test_child_isolation.py` | 画像 12 枚の 48MB の DOCX (RSS の基準のファイル) | 9.4 の大きな DOCX と同じ方法 (`ci_docx_12_images.docx`) | 48.0MiB で、4 通りの結果が同じ (成功、全文の SHA-256 も同じ)。RSS の計測はタスク 3.x の仕事 |
| 同上 | `_write_xlsx(dest, 7000, 10)` (7 万セルの 10 列)、`one_sheet_at_the_cell_limit_path` (7 万行 1 列。Req 11.2 の RSS の基準の「7 万セル 1 シートの XLSX」)、`_pivot_workbook` (150MiB の pivot cache を含む) | 自前の XLSX (シート名 `Data`、セルの値 `r{行}c{列}`)。pivot は `xs_pivot_150mb` と同じ方法 | 実測: 3 個とも両 anydoc の判定が同じ (成功)、全文の SHA-256 も同じ。**ただし ZIP の中身は同じではない** (9.7) |
| `conversion/test_office.py` | 途中で切った DOCX / XML が壊れた DOCX (`<w:document <<<`) / `word/document.xml` の無い DOCX | 自前: 普通の DOCX のバイト列の前半だけ / `word/document.xml` を置き換え / その部品を除いて作り直す (`of_truncated`、`of_broken_xml`、`of_no_document_part`) | 実測: `malformed` / `malformed` / `missingPart`。両 anydoc とも Python 版のファイルと同じ |
| `test_office.py`、`test_e2e_http.py`、`test_child_entry.py` | 日本語の DOCX (`障害対応メモ ...`)、`docx marker 日本語`、改行を含む DOCX (`情報シス\nテム`) | 自前の DOCX。**段落の中の `\n` は `<w:br/>` に変える** (python-docx と同じ。最初は `<w:t>` の中に改行をそのまま書いていた) | 実測: 3 個とも両 anydoc の判定が同じ (成功)、全文の SHA-256 も同じ |
| `test_e2e_http.py`、`runner/test_child_entry.py` | 壊れた入力: `PK\x03\x04` + 文字列 (DOCX / XLSX として)、`%PDF-1.4\n` + 文字列、`%PDF-1.7\n` + `\x00garbage` の繰り返し | バイト列の連結 (`of_hygiene_corrupt.docx`、`hy_corrupt_pdf`、`hy_garbage.pdf`) | 実測: 3 個とも `malformed`。両 anydoc とも Python 版と同じ |
| `conversion/test_pdf.py`、`test_e2e_http.py` | 日本語の行を Type0 のフォントと ToUnicode で書いた PDF (2 種類) | Python 版の `_japanese_lines_pdf` を移した (Node の `buildPdf` に Type0 / CIDFontType2 / ToUnicode の部品を渡す) | 実測: 2 個とも両 anydoc の判定が同じ (成功)、全文の SHA-256 も同じ |
| `runner/test_child_isolation.py` | 1 ページに 400 万字を書いた PDF | `(aaaa…1000字) Tj 0 -1 Td` を 4000 回 | 実測: 両 anydoc の判定が同じ (成功、707,707 字)、全文の SHA-256 も同じ |
| `runner/test_child_isolation.py` | 20MB の CSV | `a,b,c,d\n` の繰り返し | 文字列の繰り返しだけ (ファイル形式の生成は要らない)。ファイルとしては作っていない |

#### 9.5.3 `test_xlsx_split.py` と `test_pptx_split.py` のブックとデッキ (実測)

この 2 つのテストファイルは、openpyxl と python-pptx で作ったブックとデッキを、ZIP の中で書き換える形のテストが多い。Python 版のテストの写しを作り、ブックとデッキを作る関数だけを Node で作ったものに替えて、テストの本体は変えずに動かした。

| 元の関数・テスト | 作るもの | Node での作り方 |
|---|---|---|
| `test_xlsx_split.py` の `_book(sheets)` | シートごとの A 列の値。値が無いシートはセルを持たない (空のシート、すべて空のブック) | `buildXlsx` (XML から組み立てる)。空のシートは `<sheetData>` だけ |
| 同 `_stale_reference_book` | `definedNames` (印刷タイトル `'Alpha'!$1:$1` と `named_cell` → `Beta!$A$1`)、キャッシュ付きの別シート参照の式セル | `buildXlsx` に `definedNames` と `{ formula, cached }` のセルを足した (openpyxl と同じ書き方: `<definedName name="_xlnm.Print_Titles" localSheetId="0">`) |
| 同 `_renamed`・`_with_states`・`_awkward_book`・`_plain_book`・`_secret_book` | シート名・state の書き換え (正規表現)、変わった名前、日本語名 | `_book` の結果を Python 版の書き換え関数にそのまま通す |
| 同 `<sheet\b[^>]*/>` の並べ替えと 50,000 個の複製、`<sheets>` の前の 1.2MB のコメント、workbook.xml の途中切断・不明な符号化・エンティティの展開、workbook の無い ZIP、Excel 風の workbook.xml | ZIP の中の書き換え | Python 版の書き換え関数にそのまま通す (Node の `workbook.xml` が `<sheet …/>` の自己終了タグ、属性なしの `<sheets>`、先頭の XML 宣言を持つので当たる) |
| `test_pptx_split.py` の `_contract_deck`・`_notes_deck` | ノート、表、画像、グループ、非表示、空のスライド、並べ替えたスライドの並び / ノートだけのデッキ | `buildPptxXml` と、表・グループ・並べ替えの XML の追加 (9.5.2 の契約デッキ) |
| 同 `_artefact_deck`・`_deck_with_pictures`・`_deck_with_text` | 自動の代替テキスト、著者の行、スライドをまたぐ改行 (`\v`)、グループの中の画像と文字 | `buildPptxXml` に、段落 (`\n`)・改行 (`\v` → `<a:br/>`)・テキストボックス・画像の `descr`・`<p:grpSp>` を足した。図形の並びは python-pptx と同じ (画像、グループ、テキストボックスの順) にする必要があった (最初は逆にしていて 1 件失敗) |
| 同 テストの中の `Presentation()` | タイトルだけのスライド 2 枚 (ハイパーリンクのデッキ)、1 枚 (スライド一覧の複製)、40 万字のテキストボックス (読み取りの上限)、ノートの定型文、スライドの無いデッキ | 写しの中で、`Presentation()`・`_title_slide`・`_save` を Node のデッキを作る小さな代用品に替えた |

結果: `test_xlsx_split.py` は **50 件すべて通った** (Python で作ったもので 50 件、Node で作ったもので 50 件)。`test_pptx_split.py` は **65 件すべて通った** (同じく 65 件と 65 件)。`tests/conversion/` の全体 (599 件) も、ファイルから読む fixture を Node のものにして 599 件すべて通った。

#### 9.5.4 正規表現・バイト置換で書き換えるテストの入力 (Node 側の書き方をそろえる印)

Python 版のテストの helper が、openpyxl / python-pptx の XML を正規表現やバイト置換で書き換えるものは、Node で作る XML の書き方が違うと当たらない (当たらなくても例外にならず、テストが別の理由で落ちたり、何も確かめない形で通ったりする)。次のものが該当する。**印を付けた項目は、Node 側の生成器を同じ書き方にそろえる必要がある**。

| 書き換え | Node 側で必要な書き方 | 結果 |
|---|---|---|
| **`re.sub(rb'r:id="rId\d+"/></p:sldIdLst>', …)`** (`test_pptx_split.py`) | `presentation.xml` の `<p:sldId>` の `r:id` が `rId<数字>`。最後の要素の直後が `</p:sldIdLst>` | `rIdS1` では 1 件失敗、`rId<数字>` で通る (実測) |
| **`re.search(rb"<p:sldId [^>]*/>", …)`** の複製 | スペースの直後に属性が続く自己終了タグ | 通る (実測) |
| **`re.findall(rb"<sheet\b[^>]*/>", …)`** と **`re.search`** (`test_xlsx_split.py`) | `<sheet …/>` の自己終了タグ | 通る (実測) |
| **`_SHEET_NAME_ATTR`・`_SHEET_STATE_ATTR`** (`(<sheet\b[^>]*?\bname=)"…"`) | `name=` と **`state=` を全シートに書く** (openpyxl は `state="visible"` を書く) | `state` を書かないと `_with_states` が何も変えない (実測。`buildXlsx` を直した) |
| **`body.replace(b"</c></row>", …)`** (`_stale_reference_book`) | セルが `</c>` で閉じ、その直後に `</row>` | 通る (実測。インライン文字列のセルでも成り立つ) |
| **`b"'Alpha'!$1:$1" in workbook_xml`** | `definedNames` の印刷タイトルを、openpyxl と同じ `'Alpha'!$1:$1` で書く | 通る (実測) |
| `body.replace(b"<sheets>", …)` | 属性の無い `<sheets>` | 通る (実測) |
| `re.sub(rb"^<\?xml[^>]*\?>", …)`、`re.compile(rb"encoding=…")` | XML 宣言が先頭にあり、`encoding="UTF-8"` を持つ | 通る (実測) |
| `body.replace(b'Target="../', b'Target="/ppt/')`、`_with_relationship` (`</Relationships>` の直前に挿入) | rels の `Target="../…"` と `</Relationships>` で終わる書き方 | 通る (実測) |
| `honest.replace(struct.pack("<II", 5000, 5000), …)` (`test_archive_guard.py`) | local header と central directory の両方に、圧縮後・展開後のサイズを書く | 通る (実測。自前の ZIP) |

#### 9.5.5 文字コード (`conversion/test_charset.py`、`test_text.py`)

Node で符号化したバイト列を、Python で符号化したバイト列と比べ、さらに Python 版のサービスの `decode()` に通して同じ結果になるかを確かめた (20 個、実測)。

| 入力 | Node での作り方 | バイト列 | `decode()` の結果 |
|---|---|---|---|
| UTF-16 LE / BE の BOM 付き、UTF-32 LE / BE の BOM 付き | `Buffer.from(…, 'utf16le')` と `swap16()`、UTF-32 は 4 バイトずつ自前 | 4 個とも同じ | 同じ |
| cp932 (長い文、短い語、短い文) / EUC-JP (同じ 3 つ) / cp1252 (2 種類) / koi8-r / Shift_JIS の CSV / UTF-8 BOM 付きの CSV / HTML の `<meta charset="shift_jis">` | `iconv-lite` | 同じ (13 個) | 同じ |
| cp932 の拡張文字 (`①②③ ㈱テスト 髙橋`) | `iconv-lite` | **違う**: 「髙」を iconv-lite は `0xFBFC`、Python は `0xEEE0` で書く (cp932 には同じ字の符号が 2 つある)。他の字は同じ | 同じ (どちらも「髙」に戻る) |
| ISO-2022-JP (長い文、短い語、短い文) | **iconv-lite は書けない** (`Encoding not recognized: 'iso-2022-jp'`)。自前の関数 (9.7) | 同じ (3 個。9.7 に、ほかの 7 つの例と、BMP の全部の字での比較) | 同じ |


### 9.6 部品とライセンス

| 部品 | 版 | ライセンス | 使い道 | 付いてくる依存 (ライセンス) |
|---|---|---|---|---|
| `officecrypto-tool` | 0.0.19 | MIT | 暗号化した DOCX / XLSX / PPTX (agile encryption) | `cfb` 1.2.2 (Apache-2.0)、`adler-32` / `crc-32` (Apache-2.0)、`crypto-js` 4.2.0 (MIT)、`xml2js` 0.6.2 (MIT)、`sax` 1.6.1 (BlueOak-1.0.0、許容的)、`xmlbuilder` (MIT) |
| `cfb` | 1.2.2 | Apache-2.0 | XLS の OLE の入れ物 (自前の BIFF8 を入れる)。`officecrypto-tool` の依存としても入る | `adler-32` / `crc-32` (Apache-2.0) |
| `iconv-lite` | 0.7.3 | MIT | Shift_JIS / cp932 / EUC-JP / cp1252 / koi8-r の符号化。**ISO-2022-JP は書けない (実測: `Encoding not recognized: 'iso-2022-jp'`)**。ISO-2022-JP は 9.7 の自前の関数で作る | `safer-buffer` (MIT) |
| `fflate` | 0.8.3 | MIT | 試作で ZIP を読み直すのに使った (書き出しは自前)。本実装では、T6 で選ぶ ZIP の部品か自前の読み取りで足りれば要らない | なし |
| (使わない候補) `xlsx` (SheetJS Community Edition) | 0.20.3 (配布先の tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) | Apache-2.0 | XLS は書けたが、文字列を UTF-16 で書き、Python 版のテストが 1 件通らない (9.4)。npm の registry の最後の版は 0.18.5 で古い (脆弱性の修正を含まないとされるが、`npm audit` などで確かめてはいない: **未検証**) | なし |
| (使わない候補) `pdfkit` | 0.20.2 | MIT | PDF の暗号化はできた (ユーザーパスワード付きは両方の anydoc で `encrypted`、所有者パスワードだけは成功)。ただし依存が多く (fontkit など 15 個)、自前の 70 行で Python 版と同じ形の PDF が作れるので採らない | `png-js` は package.json にライセンスの記載が無いが、LICENSE ファイルは MIT |
| (使わない候補) `pptxgenjs` | 4.0.1 | MIT | タイトルの `idx` が python-pptx と合わず (9.3)、グループの図形も書けない | `jszip` は `(MIT OR GPL-3.0-or-later)` (MIT を選べる) |
| (使わない候補) `pdf-lib` | 1.17.1 | MIT | 暗号化できない (9.3) | — |

- `officecrypto-tool` は版が 0.0.x で、作者は 1 人。テストの専用の依存なので本番には入らない。
- 暗号化した Office を部品に頼らず自前で書く場合の見積り (**未検証**): agile encryption (鍵の導出、AES-CBC での暗号化、`EncryptionInfo` の XML、HMAC) が 150〜250 行、OLE の入れ物は `cfb` を使う。部品で動いたので、試作では書いていない。

### 9.7 気を付けること (タスク 2.3 / 2.4 への引き継ぎ)

- **`cfb` の FAT の修正が要る**。`officecrypto-tool` と自前の XLS (と、試した SheetJS) はどれも `cfb` で OLE を書く。`cfb` は、OLE の中の割り当て表 (FAT) の使っていない欄を「鎖の終わり」(0xFFFFFFFE) で埋める。仕様では「空き」(0xFFFFFFFF) で、Python の xlwt / olefile が書くファイルはそうなっている。anydoc の OLE の読み取りは、ファイルの末尾より先を指す欄が「空き」でないと拒否する。書き出した後に次の修正をかけると、両方の anydoc が期待どおりに判定した。暗号化したファイルには `cfb` が自分で入れる `\u0001Sh33tJ5` という空のストリームが残るが、anydoc の判定と msoffcrypto の復号に影響は無い。Python 版のファイルにある `\u0006DataSpaces` のストリームは無くても判定は変わらなかった。

```js
// cfb.js pads unused FAT entries with ENDOFCHAIN (0xFFFFFFFE); strict readers
// (anydoc) want FREESECT (0xFFFFFFFF) past the last real sector.
export function fixCfbFat(input) {
  const b = Buffer.from(input); const sectorSize = 1 << b.readUInt16LE(0x1e);
  const sectors = (b.length - sectorSize) / sectorSize; const nFat = b.readUInt32LE(0x2c);
  for (let k = 0; k < Math.min(nFat, 109); k++) {
    const off = sectorSize + b.readUInt32LE(0x4c + 4 * k) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) if (k * (sectorSize / 4) + i >= sectors) b.writeUInt32LE(0xffffffff, off + 4 * i);
  }
  return b;
}
```

- **PDF の暗号化は自前で 30 行ほど**。鍵の作り方は ISO 32000-1 の 7.6.3 (Standard security handler、revision 3) のとおり。

```js
// OpenSSL 3 in Node 24 refuses 'rc4' without the legacy provider, so RC4 is written out.
function rc4(key, data) {
  const s = [...Array(256).keys()]; let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length); let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...b) => createHash('md5').update(Buffer.concat(b)).digest();
const padPw = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
const rc4x20 = (key, data) => { let d = rc4(key, data); for (let i = 1; i <= 19; i++) d = rc4(key.map((b) => b ^ i), d); return d; };
export function standardSecurity({ user, owner, id, P = -3904 }) {
  let ok = md5(padPw(owner || user)); for (let i = 0; i < 50; i++) ok = md5(ok);
  const O = rc4x20(ok, padPw(user));
  const p = Buffer.alloc(4); p.writeInt32LE(P);
  let key = md5(padPw(user), O, p, id); for (let i = 0; i < 50; i++) key = md5(key);
  const U = Buffer.concat([rc4x20(key, md5(PAD, id)), Buffer.alloc(16)]);
  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 16);
  const dict = `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${O.toString('hex')}> /U <${U.toString('hex')}> >>`;
  return { dict, encrypt: (num, data) => rc4(objKey(num), data) }; // each stream is encrypted with its object key
}
// trailer gets: /Encrypt <n> 0 R /ID [<id> <id>]
```

- **ISO-2022-JP は自前の関数で作る** (約 15 行)。iconv-lite の EUC-JP の出力から、各バイトの最上位ビットを落とし、`ESC $ B` ... `ESC ( B` で挟む。**iconv-lite は EUC-JP に無い字を例外にせず `?` に置き換える**ので、1 字ごとに EUC-JP へ符号化して復号し、元の字に戻らなければ例外にする。さらに、2 バイトの先頭が JIS X 0208 の範囲 (0xA1〜0xA8、0xB0〜0xF4) のものだけを JIS として書く (NEC 13 区や IBM 拡張の符号 (①㈱髙 など) は 0xAD や 0xFA 以降の先頭なので例外になる)。

```js
import iconv from 'iconv-lite';

// iconv-lite cannot write ISO-2022-JP; derive it from its EUC-JP output, JIS X 0208 only.
// iconv-lite turns unmappable characters into '?', so every character is round-tripped.
export function encodeIso2022jp(text) {
  const out = [];
  let inJis = false;
  for (const ch of text) {
    const euc = iconv.encode(ch, 'EUC-JP');
    if (iconv.decode(euc, 'EUC-JP') !== ch) throw new Error(`not representable in ISO-2022-JP: ${ch}`);
    const jis = euc.length === 2 && ((euc[0] >= 0xa1 && euc[0] <= 0xa8) || (euc[0] >= 0xb0 && euc[0] <= 0xf4)) && euc[1] >= 0xa1 && euc[1] <= 0xfe;
    if (euc.length !== (jis ? 2 : 1) || (!jis && euc[0] >= 0x80)) throw new Error(`not in JIS X 0208 or ASCII: ${ch}`);
    if (jis !== inJis) { out.push(...(jis ? [0x1b, 0x24, 0x42] : [0x1b, 0x28, 0x42])); inJis = jis; }
    out.push(...(jis ? [euc[0] & 0x7f, euc[1] & 0x7f] : [euc[0]]));
  }
  if (inJis) out.push(0x1b, 0x28, 0x42);
  return Buffer.from(out);
}
```

Python の `iso2022_jp` との比較 (実測):
- `test_charset.py` の 3 つの入力 (長い文・短い語・短い文) と、ほかの 7 つの例 (日本語と ASCII の混在 4 通り、ASCII だけ、改行 (`\n`、`\r\n`) を含む文、空文字列) は、**10 / 10 が同じバイト列**。
- BMP (U+0000〜U+FFFF、サロゲートの 2,048 字を除く 63,488 字) の **全部の字を 1 字ずつ** Python の `iso2022_jp` と比べた結果:

| 結果 | 字数 |
|---|---|
| 同じバイト列 | 7,001 |
| 両方が拒否 | 56,474 |
| Node だけが拒否 | 8 |
| Python だけが拒否 | 5 |
| 違うバイト列 | 0 |

- 残る差の 13 字 (**`test_charset.py` の入力には含まれない。2.6 のコーパスでも使わない字として扱う**。使うときは、この表を見て写像を足す)。
  - Node だけが拒否する 8 字: `U+00A2` ¢、`U+00A3` £、`U+00A5` ¥、`U+00AC` ¬、`U+2016` ‖、`U+203E` ‾、`U+2212` −、`U+301C` 〜。Python は ¢ £ ¬ ‖ − 〜 を JIS X 0208 の符号で書き、¥ と ‾ は JIS ローマ字 (`ESC ( J`) で書く。iconv-lite の EUC-JP は、これらの字を別の符号 (全角形の ￠ ￡ ￢ ∥ － ～ に当たるもの) に対応づけているため、書けない。**〜 (U+301C) は日本語の文書でよく使う字だが、全角チルダ ～ (U+FF5E) も iconv-lite では JIS X 0212 の符号 (`8fa2b7`) になり、自前の関数が例外にする (Python も ～ を拒否する)。つまり 〜 を ～ に替えて避けることはできず、2.6 のコーパスの ISO-2022-JP の文書では 〜 と ～ のどちらも使わない**。なお ¥ と ‾ は iconv-lite が ASCII の 0x5C / 0x7E に対応づけるため、上の「全角形」の括弧書きには当たらない。どの字も例外で止まるので、黙って別の字に化けることはない。
  - Python だけが拒否する 5 字: `U+2225` ∥、`U+FF0D` －、`U+FFE0` ￠、`U+FFE1` ￡、`U+FFE2` ￢。Node はこの 5 字を、Python が ¢ £ ¬ ‖ − に使う符号で書いてしまう。

- **cp932 の「髙」は符号が違う** (実測)。iconv-lite は `0xFBFC`、Python は `0xEEE0` で書く。どちらも cp932 の正しい符号で、Python 版のサービスの `decode()` は同じ「髙」に戻す。`test_charset.py` の `test_shift_jis_with_cp932_extension_characters` を Node で書き直すときは、バイト列を固定して比べず、復号した結果を比べる。
- **DOCX の段落の中の改行は `<w:br/>` にする**。`<w:t>` の中に `\n` をそのまま書くと python-docx と違う文書になる。`test_e2e_http.py` の「日本語の途中の改行が残る」テストの入力に影響する。`buildXlsx` は、シートごとに `state="visible"` を書く (openpyxl と同じ。`test_xlsx_split.py` の `_with_states` の正規表現がこの属性に当たる)。
- **Req 11.2 の RSS の基準ファイルは、Node で作ったものと同じではない**。基準は Python 版の `tests/fixture_files.py` と同じ関数で作ったファイルで取っている。
  - 7 万セル 1 シートの XLSX: `write_xlsx_cells(dest, [("Data", 70000, 1)])` (openpyxl の write-only モード。285MB)。
  - 画像 12 枚の 48MB の DOCX: `make_docx("docx with twelve images", _random_images(12, 2048, seed=48))` (python-docx。281MB)。
  - Node で作った XLSX は、ZIP の部品が 5 個で、openpyxl が作るもの (9 個) にある `docProps/app.xml`、`docProps/core.xml`、`xl/theme/theme1.xml`、`xl/styles.xml` が無い。セルの数、シートの名前、セルの値は同じで、圧縮後の大きさも同程度 (0.54MB 前後)。
  - 12 枚の画像の DOCX も同じで、python-docx のものは ZIP の部品が 29 個 (画像を除くと 17 個: `docProps`、`styles`、`stylesWithEffects`、`settings`、`webSettings`、`fontTable`、`theme`、`customXml`、`numbering`、サムネイルなど)、Node のものは 17 個 (画像を除くと 5 個) で、画像の合計の大きさ (約 48MiB) は同じ。
  - anydoc の出力は同じだが、**子プロセスの RSS は同じ値になるとは限らない**。タスク 3.x で Node 版の RSS を測るときは、上の 2 つの関数をそのまま呼んで作ったファイル (Python 版の `fixture_files.py` を使うので、Python 版が残っているうちに作って置いておく) を Node 版に渡した値を、基準との比較に使う。Node で作ったファイルの値は参考として別に取る。

- **ZIP は書き出しを自前にする**。部品 (fflate など) は、名前の重複、申告サイズの偽り、zip64 の強制、展開すると大きくなる部品を少しずつ書くこと、をそのままではできない。自前なら、ヘッダーの欄をすべて自分で決められ、細工はバイトの書き換えで済む。展開すると大きくなる部品は、`createDeflateRaw` に流しながら `zlib.crc32(chunk, prev)` で CRC を足していく。
- **PPTX と XLSX は部品を使わず XML から組み立てる**。部品 (pptxgenjs、exceljs、SheetJS) は、テストが要る形 (タイトルの `idx` 0、グラフだけのシート、グループの図形、シートのファイル名と順序) を書けないか、書き方を細かく決められない。XML から組み立てても、Markdown は Python 版のファイルと同じになった。
- **乱数**: Python の `random.Random(seed)` と同じ並びは Node では作れない。テストが要るのは「圧縮が効かない」ことと大きさだけなので、種を固定した自前の乱数で足りる。
- **作る時間**: 9.4 の 28 個 (大きなファイルを含む) を作るのに約 6 秒 (Python 版で同じものを作ると約 4 秒)。
- **XLS の文字列は 1 バイトの文字だけ**。自前の BIFF8 は Latin-1 の範囲の文字だけを書く (範囲の外は例外にする)。日本語のシート名や値が要るときは、文字列の印 (`fHighByte`) を 1 にして UTF-16 で書く形に広げる (タスク 2.3)。

### 9.8 作れなかったもの (タスク 2.2 への材料)

作れなかったファイルは無い。Python 版のテストは、次の範囲では **テストを変えずに** Node で作った入力で通る (実測。9.1 の 5 つの確かめ方): `test_fixture_files.py` の 30 件、`tests/conversion/` の 599 件 (fixture の読み込みを替えたもの)、`test_xlsx_split.py` の 50 件と `test_pptx_split.py` の 65 件 (ブック・デッキを作る関数も替えたもの)。ただし、通るためには Node 側の生成器が Python 版の XML の書き方 (PPTX の関係の ID が `rId<数字>`、全シートの `state`、`<sheet …/>` の自己終了タグなど。9.5.4) にそろっている必要があり、最初の試作では PPTX の ID が違って 1 件通らなかった。**`runner/` と `test_e2e_http.py` などの、サーバーや子プロセスを動かすテストは、この確認の範囲に入れていない** (入力の作り方は 9.5.2 の表で確かめたが、テスト本体は 2.5 で通す)。タスク 2.2 で扱いを決める必要があるファイルは無い。ただし次の 2 つは判断の対象になるので、ユーザーの判断を記録しておくとよい。

| 項目 | いまの案 | 代わりの案 (採らない場合) |
|---|---|---|
| 暗号化した Office を `officecrypto-tool` (0.0.x、作者 1 人) と FAT の修正で作る | テスト専用の依存として採る | 自前で agile encryption を書く (150〜250 行、未検証)。または Python 版で作ったファイルを出所の記録つきで commit する (D5 の例外を増やす) |
| ISO-2022-JP のテキストの一部の字 (〜 U+301C など 13 字、9.7) が、Node の自前の関数と Python で違う | `test_charset.py` の入力には含まれないので、2.6 のコーパスでこれらの字を避ける。使うなら写像を足す | iconv-lite の代わりに、JIS X 0208 の表を持つ部品を探す (未調査) |

### 9.9 試作の再現手順 (試作時の実行記録)

試作のコードはリポジトリに残さない (後続タスク 2.3 / 2.4 で本実装する) ので、この手順は後からそのまま再実行できない。記録として、使った部品・比べ方・期待した出力を残している。

**bash で実行する** (zsh では `$PY` が 1 つの語として扱われ、動かない)。次の手順を、空の `out/` と `res/` から順に実行して、下の「期待する出力」のとおりになることを確かめた (2026-11-04)。試作のコード (`src/*.mjs`、`py/*.py`、`pycheck*/`) は使い捨ての場所にだけあり、残さない (リポジトリにも入れていない)。作り方は 9.4〜9.7 に書いたとおりで、キーとなる部分のコードは 9.7 に載せた。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH   # Node 24
SCRATCH=<リポジトリの外の使い捨ての場所>; mkdir -p "$SCRATCH/t7" && cd "$SCRATCH/t7"
echo '{ "name": "t7-proto", "private": true, "type": "module" }' > package.json
npm install --no-audit --no-fund @firecrawl/anydoc@0.2.4 fflate officecrypto-tool iconv-lite \
  https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz pdf-lib pdfkit pptxgenjs exceljs docx   # 最後の 6 つは採らなかった候補
# (cfb は officecrypto-tool の依存として入る)

SVC=<repo>/services/attachment-text-extractor; PY="$SVC/.venv/bin/python -I"; T7=$PWD
mkdir -p out res

# (a) fixture_files.py の 28 ファイルを Node と Python で作り、両方の anydoc に通す
node src/gen-node.mjs out/node
$PY py/dump_py.py "$SVC" out/py                       # Python 版の関数でそのまま作る
for s in py node; do
  node src/verdict-node.mjs out/$s > res/$s-on-node.json                 # Node 版の anydoc: 判定と Markdown 全文の SHA-256
  $PY py/verdict_py.py out/$s > res/$s-on-py.json                        # Python 版の anydoc: 同じ
done
node src/compare.mjs res/py-on-node.json res/py-on-py.json res/node-on-node.json res/node-on-py.json

# (b) Python 版の性質のテスト (test_fixture_files.py と、fixture を FIXTURE_DIR のファイルに差し替える conftest.py を pycheck/ に置く)
(cd pycheck && SVC=$SVC FIXTURE_DIR=$T7/out/node $SVC/.venv/bin/python -m pytest -q -p no:cacheprovider --rootdir=$T7/pycheck test_fixture_files.py)

# (c) 細工したファイル 37 個: Python 版のサービスの守りで判定し (32 個)、Python 版の同名のファイルと両方の anydoc で比べる
node src/gen-crafted.mjs out/crafted-node
node src/gen-contract-deck.mjs out/crafted-node/ps_contract_deck.pptx
node src/gen-xlsx-crafted.mjs out/crafted-node
$PY py/crafted_oracle.py "$SVC" out/crafted-node      # out/crafted-py も書き出す
for s in crafted-py crafted-node; do node src/verdict-node.mjs out/$s > res/$s-on-node.json; $PY py/verdict_py.py out/$s > res/$s-on-py.json; done
node src/compare.mjs res/crafted-py-on-node.json res/crafted-py-on-py.json res/crafted-node-on-node.json res/crafted-node-on-py.json

# (d) 追加の 15 ファイルと文字コードの 20 個
node src/gen-extra.mjs out/extra-node
$PY py/dump_extra.py "$SVC" out/extra-py
$PY py/charset_oracle.py "$SVC" out                   # バイト列と decode() の結果を比べる
for s in extra-py extra-node; do                       # charsets.json は anydoc の入力ではないので除く
  mv out/$s/charsets.json out/$s.charsets.json
  node src/verdict-node.mjs out/$s > res/$s-on-node.json; $PY py/verdict_py.py out/$s > res/$s-on-py.json
  mv out/$s.charsets.json out/$s/charsets.json
done
node src/compare.mjs res/extra-py-on-node.json res/extra-py-on-py.json res/extra-node-on-node.json res/extra-node-on-py.json

# (e) ISO-2022-JP: 10 例と、BMP の全部の字
node src/try-iso.mjs out/iso-node.json               # iconv-lite の失敗を出し、自前の関数の 10 例を書く
$PY -c "import json; d=json.load(open('out/iso-node.json')); print(sum(v.encode('iso2022_jp').hex()==d['hex'][k] for k,v in d['samples'].items()), '/', len(d['samples']))"
node src/bmp-iso.mjs out/bmp-iso-node.json && $PY py/bmp_iso.py out/bmp-iso-node.json out/bmp-iso-diff.json

# (f) Python 版のテスト本体を、Node で作った入力で動かす
#   pycheck2/: test_xlsx_split.py と test_pptx_split.py の写し。ブック・デッキを作る関数を、src/book.mjs と src/deck.mjs (stdin の JSON から作る) を呼ぶ関数に替える
#   pycheck3/: tests/conversion/ の全体の写しと、(b) と同じ conftest.py
(cd pycheck2 && $PY make_xlsx_split_node.py && $PY make_pptx_split_node.py \
 && BOOK_MJS=$T7/src/book.mjs SVC=$SVC FIXTURE_DIR=$T7/out/node $SVC/.venv/bin/python -m pytest -q -p no:cacheprovider --rootdir=$T7/pycheck2 test_xlsx_split_node.py \
 && DECK_MJS=$T7/src/deck.mjs CONTRACT_MJS=$T7/src/gen-contract-deck.mjs SVC=$SVC FIXTURE_DIR=$T7/out/node $SVC/.venv/bin/python -m pytest -q -p no:cacheprovider --rootdir=$T7/pycheck2 test_pptx_split_node.py)
(cd pycheck3 && SVC=$SVC FIXTURE_DIR=$T7/out/node $SVC/.venv/bin/python -m pytest -q -p no:cacheprovider --rootdir=$T7/pycheck3 .)
```

`compare.mjs` は、4 通りの結果 (失敗の種類、または成功した出力の UTF-8 の長さと **Markdown 全文の SHA-256 の先頭 8 文字**) がすべて同じなら `SAME` とする (3 回目のレビューで全桁でも比べ直し、同じ結果だった)。`verdict-node.mjs` と `verdict_py.py` が、それぞれの anydoc の出力全文の SHA-256 を計算する (Node は `crypto`、Python は `hashlib`)。

期待する出力 (実測):

| 手順 | 出力 |
|---|---|
| (a) | `25 SAME` (判定と全文の SHA-256 が 4 通りで同じ) |
| (b) | `30 passed` (SheetJS で作った XLS だと `29 passed, 1 failed`。9.4) |
| (c) `crafted_oracle.py` | `32 SAME` |
| (c) 両 anydoc | `37 SAME` |
| (d) `charset_oracle.py` | 19 個が `SAME-BYTES SAME-DECODE`、1 個 (cp932 の拡張文字) が `DIFF-BYTES SAME-DECODE` |
| (d) 両 anydoc | `15 SAME` |
| (e) | `iconv-lite iso-2022-jp: Encoding not recognized`、`10 / 10`、`{'same': 7001, 'both_reject': 56474, 'node_only_reject': 8, 'python_only_reject': 5, 'different_bytes': 0}` |
| (f) | `50 passed` (xlsx_split)、`65 passed` (pptx_split)、`599 passed` (conversion の全体) |

### 9.10 ユーザーの判断 (タスク 2.2、2026-11-04)

- 9.1 のとおり、Node で作れないテスト用のファイルは無かったので、ファイルごとに扱いを決める必要はなかった。
- 残っていた判断は、暗号化した Office (DOCX / XLSX / PPTX) の作り方だけだった。ユーザーは **`officecrypto-tool` (0.0.19、MIT、作者 1 人) を採る** と決めた。テスト専用の依存にして、本番の image には入れない。`cfb` が OLE の FAT の未使用欄を埋める問題は、9.7 の 11 行の修正で直す (2.3 / 2.4 で必ず入れる)。選ばなかった案: 暗号化を自前で実装する (150〜250 行、未検証)、作ったファイルを出所つきで commit する。
- ISO-2022-JP の 13 字 (9.7) は、判断を求めずに「2.6 のコーパスでは使わない」と扱う (〜 U+301C と ～ U+FF5E のどちらも使わない)。使う必要が出たら、そのときにユーザーに諮る。
- 〜 (U+301C) は、iconv-lite の Shift_JIS と EUC-JP でも書けない (実測。iconv-lite の Shift_JIS は cp932 の表を使い、① 髙 ㈱ ～ は書けて 〜 − ¥ ‾ は書けない。EUC-JP も 〜 は書けない)。2.6 のコーパスでは、Shift_JIS・EUC-JP・ISO-2022-JP のどの文書でも 〜 を使わない。

## 10. Node で作ったファイルを Python 版のテストに差し替えた結果 (タスク 2.5)

2026-11-04 に devcontainer (Node 24.21.0、Python 3.12 の `.venv`) で確かめた結果 (Req 10.5、design.md の D5)。Python 版のコード (`src/app/**`) とテストのファイルは変えていない。差し替えは使い捨ての場所 (scratchpad) に作ったテストの写しの上だけで行い、リポジトリには何も足していない。Node の生成器 (`apps/attachment-text-extractor/test/fixtures/`) も直していない (直す必要が無かった)。

### 10.1 結論 (実測)

- **Python 版のテスト全体 (1222 件) が、Node で作ったファイルを入力にしても、差し替えの前と同じ結果になった**。差し替え前は `1222 passed`、差し替え後も `1222 passed` で、通ったテストの ID の集まりも同じだった (どちらにも無いテストも、片方にだけあるテストも 0 件)。
- テスト本体 (assert) は変えていない。変えたのは「入力を作るところ」だけで、例外は 2 か所 (10.5 の「テストから外した部分」)。
- 1222 件のうち、Node で作ったファイル・バイト列を実際に入力として使ったテストは **385 件** (10.4)。残りはファイルを入力にしないテスト (設定、認証、子プロセスの制御、通信の枠、HTML・CSV などの短い文字列だけを送るものなど) で、差し替えの対象が無い。
- 次の 2 通りの差し替え方 (10.2) の **どちらでも 1222 件すべて通った**。
  - **crafted 版**: Node の生成器が「テストの細工」まで含んでいるところは、式ごと Node の生成器に置き換える。
  - **edit 版**: 同じところで、土台のファイルだけを Node で作り、テスト自身の細工 (バイトの書き換え、正規表現、zipfile での作り直し) は Python のまま掛ける。9.5.4 の「Python のテストが openpyxl / python-pptx / zipfile の書き方を前提にしている」心配を確かめるためのもの。
- 差し替えたつもりで Python のファイルが使われていないことを、仕組みで確かめた (10.2 の「見張り」)。Python の文書の書き出しを止めた状態で、**差し替えていない元のテスト** を動かすと `161 failed, 846 passed, 61 errors` (と、収集の段階のエラー 3 件) になった。差し替えたテストでは 0 件。
- Node の生成器を直す必要は無かった。(a) 生成器の不具合 は 0 件、(c) 意図した違い で通らないもの も 0 件。通らなかったテストの原因は (b) 差し替えの仕組みの不備 の 1 種類 (5 件) だけで、仕組みを直して通った (10.6)。ほかに (b) として、テストの一部 (Python の zipfile が書くときに出す警告の確認) を外したところが 2 か所ある (10.5)。この 2 か所の扱いは、親タスクの判断を待つ。

### 10.2 方法 (再現できる粒度)

確認に使ったスクリプト (写しを作る `make_copy.py`、見張りの `node_guard.py`、Node の常駐プロセス `gen-server.mjs` など) はリポジトリに残していない。やり直すときは、この節 (10.2) と 10.5 の表から作り直す。

**置き場所** (`$S` は scratchpad。どれも使い捨てで、リポジトリには入れていない):

| もの | 中身 |
|---|---|
| `$S/mirror/` | テストを動かす場所。リポジトリの `.github`・`packages`・`infra` への symlink と、`services/attachment-text-extractor/` (中の `src`・`scripts`・`deploy`・`Dockerfile`・`pyproject.toml`・`uv.lock`・`.venv` などは元への symlink、`tests/` だけは写し)。テストが `Path(__file__).parents[1]` や `parents[3]` で `Dockerfile`・`.github/workflows`・`packages/.../openapi.json` を読むので、同じ深さに置く。`app` は `.venv` の editable install でリポジトリの `src/app` を読む |
| `$S/node/gen-server.mjs` | Node の常駐プロセス。jiti (`node_modules/.pnpm/jiti@2.7.0`) で `test/fixtures/index.ts` (と、`buildPdf` のために `pdf.ts`) を読み込み、標準入力の 1 行 1 件の JSON `{"fn": 名前, "args": [...], "out": 書き出し先?}` を受けて、その export を呼ぶ。バイト列は `{"$b64": ...}` でやり取りする。`"plain:<キー>"` は `PLAIN_DOCUMENTS[キー].build()` を呼ぶ。`out` があれば結果をファイルに書く (40MB を超える画像入りの文書など) |
| `$S/py/nodegen.py` | Python から gen-server を呼ぶ関数 `call(fn, *args, out=None)`。pytest のプロセスで最初に呼んだときに 1 つだけ起動し、終わるときに止める。返したバイト列を覚えておき、「このテストは Node の入力を使ったか」の記録に使う |
| `$S/py/fixture_files_node.py` | Python 版の `tests/fixture_files.py` と同じ名前の関数・fixture・定数を持つ写し。中身はすべて gen-server を呼ぶ。写しの `tests/fixture_files.py` をこれで上書きする。パスワードや印の文字列は、Node 側の定数と同じであることを読み込み時に確かめる |
| `$S/py/pptx_shim.py` | `test_pptx_split.py` がテストの中で使う `Presentation()` の代わり。タイトルだけのスライド・テキストボックス・ノートを記録し、保存のときに Node の `buildPptx` で作る。それ以外の使い方をすると例外にする |
| `$S/py/make_copy.py` | `tests/` を写し、次の表のとおりに書き換える。置き換えは「元の文字列がちょうど n 回現れる」ことを確かめてから行う (元のテストが変わっていたら止まる)。関数をまるごと替えるところは `ast` で関数の範囲を求める |
| `$S/py/node_guard.py` | pytest のプラグイン (`-p node_guard`)。見張りと記録 (下) |
| `$S/run.sh` | 写しを作って実行する。`bash run.sh <crafted\|edit\|none> <名前>` |

**実行** (bash):

```bash
# S は scratchpad。差し替えの前 (リポジトリそのまま) — ベースライン
cd services/attachment-text-extractor && .venv/bin/python -m pytest -q -p no:cacheprovider -rA
# 差し替え後 — run.sh の中身
python -I $S/py/make_copy.py <repo>/services/attachment-text-extractor/tests $S/mirror/services/attachment-text-extractor/tests crafted   # または edit
cd $S/mirror/services/attachment-text-extractor && env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=$S/py \
  NODE_GEN_SERVER=$S/node/gen-server.mjs NODE_GUARD_TESTS_DIR=$PWD/tests NODE_GUARD_LOG=$S/res/<名前>.calls.jsonl \
  NODE_GUARD_ALLOWED_ZIP_WRITERS=_rewrite,_add_member \
  .venv/bin/python -m pytest -q -p no:cacheprovider -p node_guard -rA
```

- `PYTHONDONTWRITEBYTECODE=1` を付ける (`src` はリポジトリへの symlink なので、付けないと `__pycache__` がリポジトリ側に書かれる)。
- 比べ方: `-rA` の出力の `PASSED` 行からテストの ID を取り出して並べ、ベースラインと `comm -3` で比べる。件数だけでは比べない。
- 鏡の場所そのものが結果を変えないことを、先に確かめた: 差し替えずに写しただけのテストを鏡で動かすと `1222 passed` で、ID の集まりもベースラインと同じ。

**見張り** (`node_guard.py`。差し替え漏れが黙って通らないようにする):

- Python の文書の書き出しを例外にする: `openpyxl.Workbook.save`、`docx.document.Document.save`、`pptx.presentation.Presentation.save`、`xlwt.Workbook.save`、`msoffcrypto.format.ooxml.OOXMLFile.encrypt`、`pypdf.PdfWriter.write`。読む側 (`openpyxl.load_workbook`、msoffcrypto での復号、`PdfReader` など) は止めない。`test_fixture_files.py` が確かめ役として使うため。
- `zipfile.ZipFile` を書き込み (`w` / `a` / `x`) で開くのは、Python 版のサービスのコードと、テスト自身の編集の手順 (`_rewrite`、`_add_member`。edit 版ではほかに 2 つ、10.5) からだけ許す。テストのファイルの中のそれ以外の場所から開くと例外にする。
- 対照実験: 差し替えていない元のテストに見張りだけを掛けると、`161 failed, 846 passed, 61 errors` と収集のエラー 3 件 (`--continue-on-collection-errors` を付けて実行)。見張りが Python で作るファイルを確かに止めることが分かる。
- 見張れないもの: `str.encode(...)` での文字コードの変換と、`b"%PDF-..."` のようなバイト列の書き方。これらは写しを grep して、残っているものを 10.7 に挙げた。

**記録**: テストごとに「そのテストの間に呼んだ Node の生成器」「使った fixture (`request.getfixturevalue` で取ったものを含む)」「Node で作ったバイト列がパラメータ (または、パラメータの名前で引くモジュールの表の行) に入っているか」を JSON で書き出す。どれかがあれば「Node の入力を使った」と数える。

### 10.3 件数

| 実行 | 結果 | ベースラインと ID が違うテスト |
|---|---|---|
| ベースライン (リポジトリのまま) | `1222 passed` (84 秒) | — |
| 鏡で、差し替えずに写しただけ | `1222 passed` | 0 |
| 鏡で、差し替えずに写しただけ + 見張り (対照実験) | `161 failed, 846 passed, 61 errors` (+ 収集のエラー 3) | — |
| crafted 版 (最初の実行) | `1222 passed` | 0 |
| edit 版 (最初の実行) | `5 failed, 1217 passed` (原因は 10.6。差し替えの仕組みの不備) | 5 |
| crafted 版 (最後の実行) | `1222 passed` (83 秒) | 0 |
| edit 版 (最後の実行) | `1222 passed` (83 秒) | 0 |

crafted 版は 4 回、edit 版は直した後に 3 回動かし、どれも `1222 passed` だった (子プロセスの RSS や時間で判定するテストを含む)。

### 10.4 テストファイルごとの結果

「Node の入力」は、Node で作ったファイル・バイト列を入力に使ったテストの数 (10.2 の記録)。edit 版で数が少ないファイルは、テストがバイト列を書き換えた写しを使うため、記録が追えなかった分 (`test_archive_guard.py` の 8 件。テスト自体は Node の ZIP を書き換えた入力で通っている)。

| テストファイル | ベースライン | crafted 版 | edit 版 | Node の入力 (crafted) | Node の入力 (edit) |
|---|---|---|---|---|---|
| `conversion/test_archive_guard.py` | 46 | 46 | 46 | 44 | 36 |
| `conversion/test_charset.py` | 42 | 42 | 42 | 33 | 33 |
| `conversion/test_core.py` | 54 | 54 | 54 | 20 | 20 |
| `conversion/test_formats.py` | 119 | 119 | 119 | 0 | 0 |
| `conversion/test_input_size.py` | 32 | 32 | 32 | 0 | 0 |
| `conversion/test_normalize.py` | 29 | 29 | 29 | 0 | 0 |
| `conversion/test_office.py` | 32 | 32 | 32 | 21 | 21 |
| `conversion/test_ooxml_xml.py` | 10 | 10 | 10 | 0 | 0 |
| `conversion/test_pdf.py` | 14 | 14 | 14 | 12 | 12 |
| `conversion/test_pptx_split.py` | 65 | 65 | 65 | 63 | 63 |
| `conversion/test_text.py` | 67 | 67 | 67 | 8 | 8 |
| `conversion/test_types.py` | 8 | 8 | 8 | 0 | 0 |
| `conversion/test_xlsx_split.py` | 50 | 50 | 50 | 49 | 49 |
| `conversion/test_xlsx_split_precheck.py` | 31 | 31 | 31 | 31 | 31 |
| `runner/test_child_entry.py` | 17 | 17 | 17 | 4 | 4 |
| `runner/test_child_isolation.py` | 27 | 27 | 27 | 20 | 20 |
| `runner/test_conversion_runner.py` | 48 | 48 | 48 | 6 | 6 |
| `runner/test_extract_with_real_runner.py` | 2 | 2 | 2 | 0 | 0 |
| `runner/test_forkserver.py` | 19 | 19 | 19 | 0 | 0 |
| `runner/test_platform_guards.py` | 8 | 8 | 8 | 0 | 0 |
| `runner/test_wire.py` | 53 | 53 | 53 | 0 | 0 |
| `test_bearer_auth.py` | 13 | 13 | 13 | 0 | 0 |
| `test_ci_workflow.py` | 17 | 17 | 17 | 0 | 0 |
| `test_client_disconnect.py` | 6 | 6 | 6 | 0 | 0 |
| `test_config.py` | 48 | 48 | 48 | 0 | 0 |
| `test_dependencies.py` | 14 | 14 | 14 | 0 | 0 |
| `test_deploy_config.py` | 14 | 14 | 14 | 0 | 0 |
| `test_e2e_http.py` | 94 | 94 | 94 | 42 | 42 |
| `test_export_openapi.py` | 9 | 9 | 9 | 0 | 0 |
| `test_extract_router.py` | 35 | 35 | 35 | 0 | 0 |
| `test_fixture_files.py` | 30 | 30 | 30 | 30 | 30 |
| `test_health.py` | 11 | 11 | 11 | 0 | 0 |
| `test_infrastructure.py` | 10 | 10 | 10 | 0 | 0 |
| `test_integration_auth.py` | 7 | 7 | 7 | 0 | 0 |
| `test_k8s_manifests.py` | 27 | 27 | 27 | 0 | 0 |
| `test_limits.py` | 18 | 18 | 18 | 0 | 0 |
| `test_live_disconnect.py` | 4 | 4 | 4 | 0 | 0 |
| `test_live_server.py` | 11 | 11 | 11 | 0 | 0 |
| `test_main.py` | 27 | 27 | 27 | 0 | 0 |
| `test_schemas.py` | 39 | 39 | 39 | 0 | 0 |
| `test_security.py` | 7 | 7 | 7 | 0 | 0 |
| `test_smoke_extract.py` | 8 | 8 | 8 | 2 | 2 |
| 合計 | 1222 | 1222 | 1222 | 385 | 377 |

- `test_smoke_extract.py` の 2 件は、`scripts/smoke_extract.py` の `generate` が `fixture_files` の `make_docx` / `make_text_pdf` を import するので、写しの Node 版が使われた。
- `test_fixture_files.py` の 30 件 (fixture の性質を openpyxl・python-docx・python-pptx・msoffcrypto・pypdf・pypdfium2 で確かめるテスト) は 2.1 の (b) と同じく通った。旧形式の DOC / PPT は Node 側に移したファイル (`test/fixtures/legacy/`) を使い、Python 版の README の SHA-256 と同じだった。

### 10.5 差し替えた場所

**`tests/fixture_files.py` (ファイルごと)**: `conftest.py` が読み込む fixture 33 個 (うちファイルを作るものは 28 個。残りはパスワード 2 個、旧形式の DOC / PPT のパス 2 個、その SHA-256 の表) と、テストが import する関数を、すべて Node で作る形にした。

| Python 版 | Node 版 |
|---|---|
| `xlsx_*`・`pptx_multi_slide`・`pdf_text`・`pdf_image_only`・`text_*`・`odt`・`ods`・`odp`・`epub`・`rtf`・`xls` | `PLAIN_DOCUMENTS` の同じ名前のもの |
| `docx_deeply_nested`、`docx_encrypted` / `xlsx_encrypted` / `pptx_encrypted`、`pdf_user_password`、`pdf_owner_password_only`、`pdf_corrupt` | `buildDeeplyNestedDocx`、`buildEncrypted{Docx,Xlsx,Pptx}`、`buildUserPasswordPdf`、`buildOwnerPasswordOnlyPdf`、`buildCorruptPdf` |
| `*_path` の 5 個 | `buildOverCellLimitXlsx`、`buildLargeForTimeoutXlsx`、`buildLargeImagesDocx`、`buildLargeImagesPptx`、`buildZipBombDocx` (ファイルに直接書く) |
| `legacy_doc` / `legacy_ppt` | `LEGACY_DOC_PATH` / `LEGACY_PPT_PATH` (SHA-256 の表は Python 版の README のまま) |
| `make_docx`・`make_pptx`・`make_text_pdf`・`write_xlsx_cells`・`_random_images`・`_build_pdf`・`_pdf_stream` | `buildDocx`・`buildPptx`・`buildTextPdf`・`buildXlsxCells`・`randomGrayPngs`・`buildPdf` (`_pdf_stream` は `buildPdf` に渡す形を持たせたバイト列を返す) |

**テストのファイルの中** (「両方」は crafted 版と edit 版の両方。「crafted」は crafted 版だけで、edit 版では土台を Node で作ってテスト自身の細工を Python のまま掛けた):

| テストファイル | 元の作り方 | Node 版 | 版 |
|---|---|---|---|
| `test_archive_guard.py` | `_zip` (zipfile) | `buildZip` (圧縮の有無は同じ) | 両方 |
| 同 | `b"PK\x03\x04" + b"\x00" * 10` | `zipSignatureFollowedBy` | 両方 |
| 同 | `_craft_zip` + 位置での書き換え 5 種 (deflate を壊す、圧縮の方式 9、暗号化の印、UTF-8 の印、必要な版 10.0) | `buildCorruptDeflateZip` など 5 個 | crafted (edit 版は `_craft_zip` の ZIP だけを Node で作り、Python の `_patch_u16` / `_central_header_offset` で書き換えた) |
| 同 | 名前の重複 (zipfile が書く)、`force_zip64` の ZIP、200MiB に展開される部品 (2 か所)、bzip2 / LZMA の部品を壊す | `buildDuplicateNameZip`、`buildZip64Zip`、`buildZip64BombPartZip`、`buildCorruptBzip2Zip` / `buildCorruptLzmaZip` | 両方 (zipfile でしか書けない形なので) |
| 同 | 切り詰めた ZIP、`..` などの名前、申告サイズを偽る (2 か所) | `buildTruncatedZip`、`buildTraversalNamesZip`、`buildLyingSizesZip` | crafted (edit 版は Node の `_zip` に Python の切り詰め・`struct.pack` の置換を掛けた) |
| `test_xlsx_split_precheck.py` | `_package` (zipfile) | `buildCellCountPackage` | 両方 |
| 同 | 同じ名前のシートを 2 つ (zipfile が書く) | `buildDuplicateSheetPartsPackage` | 両方 |
| 同 | UTF-16 のシート、シートの圧縮の流れを位置で壊す | `buildUtf16SheetPackage`、`buildCorruptSheetStreamPackage` | crafted (edit 版は Node の `_package` に Python の符号化・位置での書き換え) |
| `test_xlsx_split.py` | `_book` (openpyxl) | `buildXlsx` | 両方 |
| 同 | `_stale_reference_book` | `buildStaleReferenceXlsx` | crafted (edit 版は `buildXlsx` に `definedNames` を渡し、式のセルは Python の `_rewrite` で `</c></row>` を置換) |
| 同 | 部品の重複、150MiB の pivot cache、すべて無圧縮、workbook の無い ZIP | `buildDuplicatedEntryXlsx`、`buildLargePivotCacheXlsx`、`buildStoredEntriesXlsx`、`buildZip` | 両方 |
| `test_pptx_split.py` | `_contract_deck`・`_artefact_deck`・`_deck_with_pictures`・`_deck_with_text`・`_notes_deck` (python-pptx) | `buildContractDeck`・`buildArtefactDeck`・`buildDeckWithPictures`・`buildDeckWithText`・`buildNotesDeck` | 両方 |
| 同 | テストの中の `Presentation()` (タイトルだけのスライド、40 万字のテキストボックス、ノート、スライドの無いデッキ) | `pptx_shim.Presentation` → `buildPptx` | 両方 |
| 同 | 絶対パスの関係、危ない行き先 (4 種) と `outside.xml`、関係でのエンティティの展開、XML 宣言の `UTF-9` (3 部品) | `buildAbsoluteTargetDeck`、`buildUnsafeTargetDeck`、`buildEntityExpansionRelationshipsDeck`、`buildUnknownEncodingDeck` | crafted (edit 版は `buildNotesDeck` に Python の `_rewrite` / `_with_relationship` / `_add_member`) |
| `test_office.py` | 半分に切った DOCX、XML が壊れた DOCX、`word/document.xml` の無い DOCX | `buildTruncatedDocx`、`buildBrokenXmlDocx`、`buildDocxWithoutDocumentPart` | crafted (edit 版は Node の `make_docx` に Python の切り詰め・zipfile での作り直し) |
| `test_pdf.py`・`test_e2e_http.py` | `_japanese_lines_pdf` | `buildJapaneseLinesPdf` | crafted (edit 版は Node の `_build_pdf` / `_pdf_stream` で同じ PDF を組む) |
| `test_pdf.py` | `b"%PDF-1.4\n" + secret + b"\n garbage"` | `pdfHeaderFollowedBy` | 両方 |
| `test_charset.py`・`test_text.py` | `.encode("cp932" / "shift_jis" / "euc_jp" / "iso2022_jp" / "cp1252" / "koi8-r" / "utf-8-sig")` (14 + 5 か所)、`codecs.BOM_UTF8 + ….encode("utf-8")` (2)、`bom + ….encode("utf-16-le" など)` (2) | `encodeText` (`utf-16le-bom` などは、先頭がテストの BOM と同じことも確かめる) | 両方 |
| `runner/test_child_isolation.py` | `_write_xlsx`・`_pivot_workbook` (openpyxl)、画像 12 枚の DOCX、400 万字の PDF | `buildXlsxCells`・`buildLargePivotCacheXlsx`、`buildTwelveImagesDocx`、`buildLongPagePdf` | 両方 (400 万字の PDF だけ crafted。edit 版は Node の `_build_pdf`) |
| `runner/test_child_entry.py`・`runner/test_conversion_runner.py`・`test_e2e_http.py` | `b"%PDF-1.7\n" + b"\x00garbage" * 100`、`b"%PDF-1.4\n…"`、`b"PK\x03\x04…"` (3 か所) | `buildGarbagePdf`、`pdfHeaderFollowedBy`、`zipSignatureFollowedBy` | 両方 |

**外した `pytest.warns` の根拠 (独立レビューで確認)**: この警告は Python の `zipfile.ZipFile._writecheck` が ZIP を**書くとき**に出す `Duplicate name` で、Node 製の ZIP を zipfile で読んでも出ない。サービスの契約 (Req 2.x / 4.x) とは無関係。「入力に同名の部品がある」ことの確認は、Node の生成器の spec (`crafted-zip.spec.ts` の重複名のテスト、`crafted-xlsx.spec.ts` の重複シートのテスト) が持っている。段階 1 の vitest では警告の確認は持ち込まず、サービスの振る舞い (素通しになる、`ConversionError` になる) の確認だけを残す。なお `test_duplicate_part_names_are_all_scanned` は、上限 5・10 セルの片方だけでも上限を超えるので、元から「両方を数えた」ことまでは証明していない。書き換えるときは、1 つずつなら通り、合計だと超える上限にする。

**テストから外した部分 (2 か所)**: `test_archive_guard.py::test_duplicate_required_part_passes_through` の `pytest.warns(UserWarning, match="Duplicate name")` と、`test_xlsx_split_precheck.py::test_duplicate_part_names_are_all_scanned` の `pytest.warns(UserWarning)`。この警告は、Python の zipfile が **書くときに** 出すもので、サービスのコードの振る舞いでもファイルの性質でもない。Node で書くと出ないので外した。サービスの振る舞いを確かめる assert (`inspect_archive(...) is None`、`ConversionError` になる) はそのまま残し、通った。分類は (b) 差し替えの方法に伴うもの。この 2 か所を外してよいかは、まだ判断を受けていない (タスク 2.5 の報告で確認を求めた)。Node 版のテストに書き直すときに、この警告の確認を持ち込まなくてよいかを、書き直すタスクで判断する。

**Python のまま残したテスト自身の編集の手順** (両方の版): `test_xlsx_split.py` の `_rewrite`・`_renamed`・`_with_states`・`<sheet …/>` の並べ替えや複製など、`test_pptx_split.py` の `_rewrite`・`_add_member`・`_with_relationship`・`_repeat_slide_entries`、edit 版の `test_office.py` の `_docx_with_document_xml` と `test_docx_without_its_document_part_is_malformed` の中の作り直し。どれも 2.1 と同じ線引きで、Node で作った文書を読み、正規表現やバイトの置換で書き換え、zipfile で ZIP に戻す。このため、これらのテストでは **ZIP の外側は Python の zipfile が書き、中の部品は Node が書いたもの** になっている。書き換えの正規表現が Node の XML に当たること (9.5.4 の印の付いた項目) は、これで確かめられた。

### 10.6 通らなかったものと原因

最後の実行では、どちらの版でも通らなかったテストは無い。途中で通らなかったものは次の 1 種類だけ。

| 実行 | 通らなかったテスト | 原因 | 分類 | 対応 |
|---|---|---|---|---|
| edit 版の最初の実行 | `test_pdf.py` の 2 件、`test_e2e_http.py` の 2 件 (日本語の行の PDF)、`runner/test_child_isolation.py` の 1 件 (400 万字の PDF) | 写しの `_build_pdf` が呼ぶ Node の `buildPdf` が、`test/fixtures/index.ts` から export されていない (`no such export: buildPdf`)。テスト用の生成器の公開の範囲として正しく、生成器の不具合ではない | (b) 差し替えの方法の不備 | gen-server が `pdf.ts` も直接読むようにした。生成器は変えていない。その後は 5 件とも通った |

- (a) Node の生成器の不具合: 0 件。生成器は変えていないので、2.3 / 2.4 の出力と spec に影響は無い。
- (c) Node の生成器の性質が意図して違うために通らないもの: 0 件。9.7 に書いた違い (Node の XLSX は openpyxl より ZIP の部品が少ない、12 枚の画像の DOCX は python-docx より部品が少ない、cp932 の「髙」の符号が違う、乱数の並びが違う) は、どれも Python 版のテストの結果を変えなかった。RSS で判定する子プロセスのテスト (`test_child_isolation.py`。7 万セルの XLSX、12 枚の画像の DOCX、セル数の上限を超える XLSX、400 万字の PDF、150MiB の pivot cache) も、Node のファイルで通った。

### 10.7 確かめなかった範囲

- **「Node の入力を使ったテスト」の数 (385 件・377 件) は少なめ**: module 単位で使い回す fixture `pivot_workbook` (`runner/test_child_isolation.py`) は見張りの対象に入っておらず、最初に使う 1 件だけが数えられている。同じ値を使い回す 2 件 (`test_a_crashing_child_is_crashed_while_a_concurrent_conversion_succeeds[segfault]`、`test_the_default_limits_let_large_legitimate_files_through[pivot_workbook]`) は 0 と記録されている。実際は 387 件以上。テストの合否には関係しない。
- **差し替えずに残した入力 (追加)**: `test_e2e_http.py` の `b"\xd0\xcf\x11\xe0 outlook message"` (OLE の先頭の印に文字列をつないだ、MSG が対応外と判定されることを確かめる入力)。commit 済みの `tests/fixtures/sample.txt` と `sample.json` (`test_extract_router.py` と `test_infrastructure.py` が直接読む)。

- **見張りで止められない入力**: 次のものは Python のまま残した。
  - UTF-8 (BOM なし) の `.encode("utf-8")`・`.encode()`。文字列のバイト列そのもので、Node でも `Buffer.from(text)` で同じになる。`test_charset.py` の 5 か所、HTML・ipynb・JSON の本文など。
  - HTML・XML・CSV・TSV・JSON・YAML・ipynb の短い文字列、`b"x" * N` などの埋め草、アップロードの大きさを試すだけの本文。9.5.1 と同じく、Node でも同じ文字列を書くだけなので差し替えの対象にしていない。
  - `test_xlsx_split_precheck.py` の `_sheet` / `_cells` (シートの XML の文字列。ZIP の外側は Node の `buildCellCountPackage`)。
  - `test_pptx_split.py` の `_png` (crafted 版・edit 版とも、もう呼ばれない) と `runner/test_wire.py` の `struct.pack` (通信の枠で、ファイルではない)。
- **Python 版のテストに対応する入力が無い Node の生成器**: `buildDotDotTargetSheetXlsx` と `buildZipWithoutCentralDirectory` は、Python 版のテストに同じ入力が無いので、この方法では確かめられない (Node 版のテストで使うときに確かめる)。`buildOneSheetAtCellLimitXlsx` / `buildOneSheetOverCellLimitXlsx` は直接は呼んでいないが、同じ中身を `buildXlsxCells` (`write_xlsx_cells` の差し替え) で作って使った。
- **テスト自身の編集の手順** は 10.5 のとおり Python のまま。Node 版のテストでは、この手順を `editPart` と `buildZip` で書き直すことになる。その形での確かめは、テストの書き換えのタスクで行う。
- **記録の数え方の限界**: 「Node の入力を使ったテスト」は、Node が返したバイト列そのもの (同じオブジェクト) を追って数えている。テストがそれを書き換えた写しを使うと追えない (edit 版の `test_archive_guard.py` の 8 件)。テストが通ったかどうかには関係しない。

### 10.8 リポジトリの状態

確かめた後、`git status` で変わっているのはこの research.md だけだった。Python 版のテストとコード、Node の生成器は変えていない。gen-server と pytest のプロセスは残っていない (`pgrep -f gen-server.mjs` で 0 件)。

## 11. ベンチマークのコーパスと正解 (タスク 2.6)

2026-11-04 に devcontainer (Node 24.21.0) で作り、Python 版のサービス (8 節の手順、ポート 18000) の応答と突き合わせた結果。置き場所は `apps/attachment-text-extractor/benchmark/`。測る道具 (`run-benchmark.ts`) とベースラインの測定は 2.7 / 2.8 の仕事で、ここでは作っていない。

### 11.1 結論

- 形式ごとに日本語を含む文書 **23 個** (PDF 3、TXT 7、CSV 2、HTML 2、DOCX・XLSX・PPTX・XLS 各 1、ODT・ODS・ODP 各 1、旧形式の DOC・PPT 各 1) と、正解 (`answers.json`、語句は合計 118 個) を作った。Req 2.4 が求める日本語の PDF (横書き・縦書き・語の途中の改行)、Shift_JIS / EUC-JP / ISO-2022-JP / BOM 付き UTF-8 / UTF-16 (LE と BE) のテキスト、`<meta charset>` を持つ HTML、script / style を含む HTML をすべて含む。旧形式の DOC / PPT は Apache POI 由来のファイル (2.3 で `test/fixtures/legacy/` に移したもの) をそのまま写したもので、日本語は含まない。
- **Python 版のサービスの実際の応答で、23 個すべての `pages[]` の要素の数・`pageNumber`・`label` が正解と一致し、正解の語句 118 個すべてが、正解の位置の要素 (だけ) に現れた**。HTML の script / style の中の語句は、Python 版の出力に現れなかった。
- 日本語の PDF の作り方は design の想定 (Chromium + Noto CJK) から 1 点だけ変えた。**フォントは Noto CJK ではなく BIZ UDゴシック** (同じく SIL Open Font License 1.1) にした。Noto CJK で作ると、Chromium が文字を「Type3」(字の形を図形として描く方式) で書き出したため (実測、11.3)。Office などが書き出す PDF は、TrueType のフォントを CIDFontType2 (字の番号で引く普通の埋め込み方) で埋め込むことが多いと見込み (未検証)、それに近い形にした。**design の「Noto CJK」の記述を直すかどうかは、ユーザーの判断に任せる**。
- PDF は Chromium の版とフォントで中身が変わりうるので、**生成した PDF を commit する** (11.6)。PDF 以外の文書は生成器が決定的 (同じバイト列) なので、テストが「生成器の出力と commit したファイルが同じ」ことを確かめる。

### 11.2 Chromium の選び方と入れ方

- **使うもの: `playwright-core` 1.64.1** (Apache-2.0)。`apps/attachment-text-extractor` のテスト・開発専用の依存 (devDependency) に入れた。本番の依存には入れない。Dockerfile (6.11) は `pnpm deploy --prod` で本番の依存だけを取り出す予定 (design の D4) なので、image には入らない。
- 理由:
  - ルートの `@playwright/test` が同じ 1.64.1 で、そのブラウザ (Chromium の revision 1248) がすでに devcontainer に入っている。版をそろえれば、新しくブラウザを取得しなくて済む。版は `^` ではなく `1.64.1` に固定した (ルートと版がずれると、別の revision のブラウザが要る)。
  - `playwright-core` はブラウザを操作する部分だけを持つ package で、install のときの処理 (scripts) を持たない (`playwright` 1.64.1 も同じ。どちらもブラウザは `playwright install` で別に入れる)。
  - `apps/pdf-converter` の `puppeteer ^23` は、install の後の処理 (`postinstall: node install.mjs`) で自分用の Chrome を取りに行く作り。ただしこのリポジトリでは `pnpm-workspace.yaml` の `allowBuilds` で `puppeteer: false` になっていて、その処理は動かない。実際に `~/.cache/puppeteer` は無く、puppeteer 用の Chrome は devcontainer に入っていない。`puppeteer-core` に Playwright のブラウザの場所を渡す方法もあるが、ブラウザの場所を手で書くことになるので採らなかった。
- ブラウザの場所 (実測): 指示にあった `/opt/pw-browsers` は存在しなかった。実際は `~/.cache/ms-playwright/` の `chromium-1248` (Chrome for Testing 156.0.8078.4) と `chromium_headless_shell-1248`。`chromium.launch()` は headless shell の方を使う。PDF の Producer は `Skia/PDF m156`。
- ブラウザが無い環境では、リポジトリのルートで `pnpm exec playwright install chromium` を実行する (ルートの `@playwright/test` が `playwright` のコマンドを持つ)。
- TypeScript の生成スクリプトは `node --import @swc-node/register/esm-register` で動かす (`apps/pdf-converter` と `apps/growi-vault-manager` の前例と同じ)。`test/fixtures/` は拡張子なしで import しているが、この方法で解決できることを確かめた。`@swc-node/register` と `@swc/core` も devDependency に入れた (`apps/pdf-converter` と `apps/growi-vault-manager` と同じ指定の `^1.10.9` / `^1.9.2`。ルートの `@swc/core` は `^1.5.25` だが、lockfile ではどれも既存の 1.10.9 / 1.16.1 になり、入る版は変わらない)。

### 11.3 フォントの選び方・ライセンス・入手先

**比べた結果 (実測、同じ HTML を Chromium で PDF にした)**:

| フォント | 形式 | PDF の中のフォントの形 | 採否 |
|---|---|---|---|
| Noto Sans JP (noto-cjk の `Sans2.004`、`SubsetOTF/JP/NotoSansJP-Regular.otf`、OFL 1.1) | OpenType (CFF) | **Type3 が 25 個** (字の形を図形で描く) | 採らない |
| Noto Sans JP の可変フォント (`Variable/TTF/Subset/NotoSansJP-VF.ttf`) | TrueType (可変) | **Type3 が 25 個** | 採らない |
| BIZ UDゴシック Regular (google/fonts、OFL 1.1) | TrueType (静的) | `Type0` + `CIDFontType2` (字の番号で引く普通の埋め込み方) | **採る** |
| IPAゴシック (システムの `fonts-ipafont-gothic`) | TrueType (静的) | `Type0` + `CIDFontType2` | 採らない (IPA フォントライセンスで OFL ではない。システムに入っているかどうかに左右される) |

- noto-cjk の配布物のうち試したのは、CFF の OpenType と可変の TrueType の 2 つで、どちらも Chromium (Skia) は PDF に埋め込めず、Type3 で書き出した (noto-cjk の `Sans2.004` には静的な TrueType は見当たらなかったが、ほかの配布元までは探していない)。Type3 の PDF からも文字は取れる (ToUnicode の表が付く)。ただ、Office などが書き出す PDF は TrueType を CIDFontType2 で埋め込むことが多いと見込まれ (未検証)、Type3 だけの PDF は利用者の PDF と形が違う可能性が高いので、ベンチマークの PDF としてはふさわしくないと判断した。design の「Noto CJK など」の「など」の範囲で、同じ OFL の静的な TrueType のフォントに替えた。
- 見出しの太字も、太字のフォントを読み込まないと Chromium が太らせた字を Type3 で書き出す (実測で 5 個)。そこで、標準の太さだけを読み込み、見出しも標準の太さにし、`font-synthesis: none` を付けた。
- **採ったフォント**:
  - 名前: BIZ UDゴシック (BIZ UDGothic) Regular、版 1.05 (`fontversion` 68813)
  - 入手先: `https://raw.githubusercontent.com/google/fonts/01ac47e0b1cddbc298334c69a5dfafb0205ffa28/ofl/bizudgothic/BIZUDGothic-Regular.ttf` (google/fonts のコミットで固定。そのファイルの最後の変更のコミット、2022-05-11)
  - SHA-256: `709fcd41e3209fb765da750472f55ccdf925653e9fa7e1eb007cb65c8f749c75` (4,667,376 バイト)
  - ライセンス: SIL Open Font License 1.1。全文は同じコミットの `ofl/bizudgothic/OFL.txt` (`https://raw.githubusercontent.com/google/fonts/01ac47e0b1cddbc298334c69a5dfafb0205ffa28/ofl/bizudgothic/OFL.txt`、SHA-256 `e753d7155d53c747d037a445e584c8ecfca6dd79846db610417e282a736b28bc`)。著作権表示は、フォント本体の name テーブル (nameID 0) の "Copyright 2022 The BIZ UDGothic Project Authors (https://github.com/googlefonts/morisawa-biz-ud-gothic)"。(同じコミットの `OFL.txt` の先頭行は元の配布の書き間違いで `morisawa-biz-ud-mincho` になっているが、字体は BIZ UDゴシック。)OFL は、文書に埋め込むこと (PDF に字の一部を入れること) を制限しない。
- フォント本体 (約 4.5MB) は **commit しない**。生成器 (`benchmark/benchmark-font.ts`) が初回に上の URL から取得し、SHA-256 を確かめて `apps/attachment-text-extractor/node_modules/.cache/attachment-text-extractor-benchmark/` に置く。2 回目からはそれを使う。
- 生成器は、PDF にした後で「埋め込まれたフォントが BIZ UDゴシックの部分集合 (`ABCDEF+BIZUDGothic-Regular` の形の名前) だけで、Type3 が 0 個」であることを確かめ、違えば失敗する。フォントの読み込みに失敗すると Chromium がシステムのフォント (IPAゴシックなど) で黙って描くので、それを捕まえるため。同じことをテストでも確かめる。
- `fc-list` にある日本語のフォントは、IPAゴシック / IPA Pゴシック、WenQuanYi Zen Hei (中国語向け)、Unifont (ビットマップ由来) だけで、Noto CJK は入っていない (`fonts-noto-color-emoji` だけ)。生成器はシステムのフォントを使わない。

### 11.4 コーパスの一覧

作り方の欄の「生成器」は `test/fixtures/` の関数。サイズはバイト。「位置」は期待する `pages[]` の要素の数。

| ファイル | 形式 | 文字コード | 特徴 | サイズ | 位置 | 語句 | 作り方 |
|---|---|---|---|---|---|---|---|
| `pdf-ja-horizontal.pdf` | pdf | — | 横書き、3 ページ、英数字の混在 (`ISO/IEC 27001`、`CSIRT`) | 26012 | 3 | 9 | HTML を Chromium で PDF に (`benchmark/pdf-documents.ts`) |
| `pdf-ja-vertical.pdf` | pdf | — | 縦書き (`writing-mode: vertical-rl`)、2 ページ | 20313 | 2 | 6 | 同上 |
| `pdf-ja-line-break.pdf` | pdf | — | 横書き、10 字幅の段で語の途中で改行 (4 語) | 18389 | 1 | 6 | 同上 |
| `txt-shift-jis.txt` | txt | shift_jis (CRLF) | 議事録 | 260 | 1 | 7 | `encodeText` |
| `txt-euc-jp.txt` | txt | euc-jp | 障害報告書 | 261 | 1 | 7 | 同上 |
| `txt-iso-2022-jp.txt` | txt | iso-2022-jp | メールの本文 | 255 | 1 | 5 | 同上 (9.7 の自前の関数) |
| `txt-utf-8-bom.txt` | txt | utf-8-bom | 〜 (U+301C) を含む | 194 | 1 | 6 | 同上 |
| `txt-utf-16le-bom.txt` | txt | utf-16le-bom | | 160 | 1 | 5 | 同上 |
| `txt-utf-16be-bom.txt` | txt | utf-16be-bom | | 160 | 1 | 6 | 同上 |
| `txt-utf-8.txt` | txt | utf-8 (BOM なし) | 英語の固有名詞の混在 | 195 | 1 | 5 | `Buffer.from` |
| `csv-utf-8.csv` | csv | utf-8 | 社員名簿 | 154 | 1 | 6 | 同上 |
| `csv-cp932.csv` | csv | cp932 (CRLF) | ㈱ と 髙 (cp932 の拡張文字) | 143 | 1 | 6 | `encodeText` |
| `html-shift-jis-script-style.html` | html | shift_jis | `<meta charset="Shift_JIS">`、script と style | 421 | 1 | 5 (+出てはいけない語句 2) | 同上 |
| `html-euc-jp-http-equiv.html` | html | euc-jp | `<meta http-equiv="Content-Type" content="...; charset=EUC-JP">`、表 | 355 | 1 | 4 | 同上 |
| `docx-ja.docx` | docx | — | 段落の中の改行 (`<w:br/>`) | 1820 | 1 | 6 | `buildDocx` |
| `xlsx-ja-multi-sheet.xlsx` | xlsx | — | 日本語のシート名 3 枚 | 2644 | 3 | 6 | `buildXlsx` |
| `pptx-ja-multi-slide.pptx` | pptx | — | 3 スライド | 6409 | 3 | 7 | `buildPptx` |
| `xls-ja.xls` | xls | — | 日本語のシート名 2 枚、文字列は UTF-16 (fHighByte=1) | 3072 | 1 | 4 | `buildXls` |
| `odt-ja.odt` | odt | — | | 875 | 1 | 3 | `buildOpenDocument` |
| `ods-ja.ods` | ods | — | 日本語のシート名 2 枚 | 873 | 1 | 2 | 同上 |
| `odp-ja.odp` | odp | — | | 882 | 1 | 2 | 同上 |
| `doc-legacy.doc` | doc | — | 日本語なし (Apache POI) | 19456 | 1 | 2 | `test/fixtures/legacy/simple-table.doc` の写し |
| `ppt-legacy.ppt` | ppt | — | 日本語なし (Apache POI) | 11264 | 1 | 3 | `test/fixtures/legacy/text_shapes.ppt` の写し |

- 合計: コーパス 23 ファイルで **114,567 バイト** (うち PDF 3 個で 64,714 バイト、Apache POI の写し 2 個で 30,720 バイト)。`answers.json` は 19,701 バイト。大きなバイナリは無い。
- Shift_JIS・cp932・EUC-JP・ISO-2022-JP の文書には 〜 (U+301C) と ～ (U+FF5E) を入れていない (9.10 のユーザーの決定)。テストでも確かめる。〜 は BOM 付き UTF-8 の文書にだけ入れた (`9時〜18時` を語句にした)。
- 語句は、文書の中身から、検索に実際に使う語 (複合語、固有名詞、カタカナ語、人名、英数字の混じった語) を選んで手で書いた。生成器の定数から作っていない。
- 複数ページ・スライド・シートの文書では、各語句がその位置の要素に **だけ** 現れるように選んだ (位置の正しさを測れるようにするため。テストで確かめる)。
- Apache POI の 2 ファイルは Apache License 2.0。ライセンスと NOTICE は `test/fixtures/legacy/` にあり、`answers.json` の `source` にその場所を書いた。コーパスの中に写しを置いたのは、「コーパスのファイルをそのまま送って測る」形を全部の文書でそろえるため。

### 11.5 正解 (`answers.json`) の形と、作り方

- 型と検証の関数は `benchmark/answers.ts` の 1 ファイルで公開する (`BenchmarkAnswers`、`DocumentAnswer`、`ExpectedPage`、`ExpectedPhrase`、`parseBenchmarkAnswers`、`loadBenchmarkAnswers`、`BENCHMARK_CORPUS_DIR`)。2.7 の `run-benchmark.ts` はこれを import して使う。検証の関数は `unknown` から型を絞る自前の関数で、型の主張 (`as`) を使わない。
- 文書ごとの欄: `fileName` (corpus/ の直下のファイル名)、`format`、`mimeType` (`POST /extract` に付けて送る MIME。たとえば CSV は `text/csv` を送る。`.csv` に `application/vnd.ms-excel` が付くと XLS として扱われる既知の制約 (Req 2.6) を避けるため)、`source` (作り方の出所)、`encoding` (テキスト系だけ)、`features` (横書き・縦書き・語の途中の改行・`<meta charset>`・script / style・段落の中の改行。2.7 の表を特徴ごとにまとめるのに使える)、`expectedPages` (期待する `pages[]` の各要素の `pageNumber` と `label`。XLSX はシート名 `sheetName` も)、`phrases` (語句 `text`、位置 `page` (`expectedPages` の 1 始まりの番号)、語の途中の改行の位置 `lineBreakAfter` (PDF の段組で、語句の何文字目の後で行が変わるか。文字は Unicode のコードポイントで数える))、`absentPhrases` (script / style の中にあって、抽出に出てはいけない語句)。
- 文字化けと語の分断を数えるための情報: 分断は「正解の語句の文字の間に空白や改行が入ったもの」で、2.7 の道具が語句ごとに一般的に数えられる。`lineBreakAfter` は、元の文書で行が変わる場所を示すので、分断がどこで起きやすいかを報告に出せる。文字化けは置き換え文字 (U+FFFD) と、語句が取れないこと (再現率) で測れる。語句の外の字の文字化けを数えるため、2.7 で文書ごとの `sourceCharacters` を足した (12.4)。`encoding` で、どの文字コードの文書かを報告に出せる。
- **正のもの (single source of truth) は `benchmark/*-documents.ts` の宣言** (文書の中身と正解を 1 か所に並べて書く)。`pnpm benchmark:generate` が宣言からコーパスと `answers.json` を書き出す。`answers.json` は生成物なので biome の対象から外した (`benchmark/biome.json`。コーパスも、Shift_JIS などの HTML を biome が UTF-8 として読めずに失敗するので外した。このリポジトリで初めての入れ子の biome の設定。commit の前に lefthook が呼ぶ形 (ルートから、ファイルのパスを並べて `pnpm biome check --write ...`) でも、`answers.json` とコーパスのファイルが対象から外れることを確かめた)。
- 依存の向き: `benchmark/` は `test/fixtures/` の生成器を import する。どちらもテスト・開発専用で、本番の `src/` からは import しない (`src/` に `benchmark` と `test/fixtures` への import が無いことを確かめた)。design の D5 (「生成器はテストからだけ使い、本番のコードからは import しない」) に反しない。

### 11.6 PDF を commit する理由

- 2.8 (Python 版のベースライン) と 6.13 (Node 版の測定) で **同じファイル** を測る必要がある。PDF は Chromium の版 (今は m156) とフォントで中身 (字の配置、埋め込み方) が変わりうるので、作り直すと比べる条件がずれる。
- PDF には作った日時 (`/CreationDate`) が入るので、同じ Chromium でも作るたびにバイト列が変わる。
- 3 個で 64,714 バイトと小さい (フォントは使った字だけが埋め込まれる)。
- 今の PDF の SHA-256: `pdf-ja-horizontal.pdf` `8a757369271d0348202f5df3c9822d41a74ab3603a46752715d4628f49411a13`、`pdf-ja-vertical.pdf` `28d642ad0fc0217f55b26fc1b1b1c6cd98dbcbae6f63ed2c4752a5f38c188892`、`pdf-ja-line-break.pdf` `9c9a4f216fd43a0fa2748f004b44ebb65577c1a7be9de1b76974871f1d4ab1b7`。
- PDF 以外は生成器が決定的なので、作り直しても同じバイト列になる。それでもコーパスに置くのは、2.7 の道具が生成器なしにファイルだけで測れるようにするため。
- `benchmark/corpus/.gitattributes` に `* binary` を置いた。Shift_JIS・UTF-16・CRLF のファイルを、git の改行の変換 (`core.autocrlf` など) が書き換えないようにするため。`git check-attr` で `text: unset` になることを確かめた。

### 11.7 `pages[]` の約束の確認 (Python 版の実際の応答)

8 節の手順で Python 版を起動し (PID・トークン・ログのファイルは scratchpad に置き、終わったら止めた。`pgrep -g` で残りが無く、ポートが空いたことを確かめた)、コーパスの 23 ファイルを `answers.json` の `mimeType` を付けて `POST /extract` に送った。最後の生成の後にもう一度送り、同じ結果だった。

| 形式 | `pages[]` (実際の応答) |
|---|---|
| PDF | ページごとに 1 要素。`pageNumber` は 1 始まりの番号、`label` は番号の文字列 (`"1"`、`"2"`…) |
| PPTX | スライドごとに 1 要素。`pageNumber` と `label` は PDF と同じ形 |
| XLSX | シートごとに 1 要素。`pageNumber` は 1 始まりの番号、**`label` はシート名** (`"売上実績"` など)。最初は番号の文字列と見込んでいたが、実際の応答に合わせて正解を直した |
| それ以外 (TXT、CSV、HTML、DOCX、XLS、ODT、ODS、ODP、DOC、PPT) | 1 要素。`pageNumber` も `label` も `null`。複数のシートを持つ XLS と ODS も 1 要素 |

- 正解の語句 118 個は、すべて、正解の位置の要素に (そしてその要素だけに) 現れた。縦書きの PDF も、Python 版 (pypdfium2) は正しい順で読めた。語の途中の改行は、Python 版の正規化 (PDF だけにかける、日本語の間の改行の詰め) でつながっていた。
- HTML の script / style の中の語句 (`スタイル定義`、`スクリプト内部の文字列`) は、Python 版の出力に現れなかった。
- 気付いたこと (2.8 の材料): Python 版の PDF の出力では、見出しと次の段落が改行なしでつながる (`情報セキュリティ基本方針当社は…`)。日本語の間の改行を詰める正規化の結果。語句の検索には影響しないが、見出しの末尾と本文の先頭がつながった語ができる。
- これはベースラインの測定ではない (2.8 で行う)。ここで確かめたのは、正解の位置と要素の数が実際の応答と矛盾しないことだけ。

### 11.8 Node 版の anydoc (0.2.4) で PDF を読んだ結果

テスト (d) の材料として、Node 版の anydoc (`toMarkdownBytes(bytes, 'pdf')`、中身は pdf-inspector) でも読んだ (実測)。

- 横書き: 語句はすべて取れた。ページの区切りは出力に無い。
- 語の途中の改行: 行の境目に **空白が入る** (`基幹シス テム`)。分断として数えられる形で、ベンチマークが測りたいことそのもの。
- 縦書き: **字の順が崩れる** (複数の列を横に読んで、`当 皆 創 社 様 業…` のように字の間に空白が入る)。語句はほとんど取れない。Node 版で PDF の部品を選ぶ (T1、3.1) ときの重要な材料になる。
- このため、テストで PDF の語句と位置を確かめるのには anydoc を使わず、Chromium が書く PDF の中身 (ページごとの描画の命令と、フォントの ToUnicode の表) を直接読む小さな関数 (`benchmark/spec-support/pdf-text.ts`) を使った。Chromium は、1 行 (縦書きでは 1 列) を 1 つのテキストの塊として、読む順に字を書くので、ページごとの文字列と、行の変わり目が取れる。anydoc は横書きの PDF で語句が取れることだけを確かめる。

### 11.9 テストで確かめていること

`pnpm test` (vitest) で動く。Chromium は使わない (PDF は commit したものを読むだけ)。

- `benchmark/answers.spec.ts`: `answers.json` がスキーマに合う。コーパスのファイルと正解が 1 対 1 で、正解はコーパスの外を指さない。`answers.json` が宣言から書き出したものと同じ (古いままになっていない)。Req 2.7 の 8 形式それぞれに日本語の語句を持つ文書がある。Req 2.4 の文字コードと特徴 (縦書き・語の途中の改行・`<meta charset>`・script / style など) がそろっている。検証の関数が、おかしな入力 (知らない形式、位置がページの数を超える、語句が空、改行の位置が語句の外、ファイル名にディレクトリが入る、同じファイルの正解が 2 つ など) を、どの欄が悪いかを示して拒否する。
- `benchmark/corpus-documents.spec.ts` (PDF 以外の 20 個): 生成器が 2 回とも同じバイト列を作り、それが commit したファイルと同じ。正解の語句が、生成器と独立した読み方 (テキストは `TextDecoder` で厳密に復号、OOXML / OpenDocument は cfb の ZIP の読み取りと、パッケージの関係の表からシート・スライドの順を求めて XML の文字を取り出す、XLS・DOC・PPT は anydoc) で、正解の位置にだけある。XLSX のシート名と順が正解どおり。テキストの文字コードどおりに復号でき、BOM の有無が正しい。Shift_JIS などの文書を UTF-8 として読むと語句が取れない (文字コードの判定が必要な文書になっている)。Shift_JIS などに 〜 ～ が無い。`<meta charset>` が実際の文字コードを指す。script / style の中に「出てはいけない語句」が実際にある。
- `benchmark/pdf-documents.spec.ts` (PDF 3 個): `%PDF-` で始まり、ページ数が正解どおり。埋め込まれたフォントが BIZ UDゴシックの部分集合だけで、Type3 が無い。正解の語句が、正解のページにだけある (11.8 の関数で読む)。語の途中の改行が、正解の `lineBreakAfter` の位置に実際にある。横書きの PDF では Node 版の anydoc でも語句が取れる。
- わざと壊して失敗することを確かめた (その後戻した): 語句を文書に無いものに替える、PDF の語句のページを替える、改行の位置を 1 字ずらす、コーパスに余分なファイルを置く。どれも該当のテストが失敗した。

### 11.10 再現の手順

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
# Chromium が無ければ (リポジトリのルートで。ルートの @playwright/test と同じ 1.64.1 の revision 1248)
pnpm exec playwright install chromium
cd apps/attachment-text-extractor
pnpm benchmark:generate                 # コーパス (PDF を含む) と answers.json を書き出す。初回はフォントを取得する
pnpm benchmark:generate --without-pdf   # Chromium が無いとき: commit 済みの PDF を残し、ほかだけを作り直す
pnpm vitest run benchmark               # 確かめる
```

- 生成の出力をパイプで `head` などに渡さない。途中で読み手が終わると、書き出しの途中でプロセスが止まり、ファイルが空のまま残ることがあった (実測。テストが失敗して気付く)。
- 宣言 (`benchmark/*-documents.ts`) を変えたら、必ず生成し直して `answers.json` とコーパスを一緒に commit する (テストが食い違いを捕まえる)。PDF を作り直したら、2.8 のベースラインを測り直す必要がある。

### 11.11 確かめなかったこと

- Word や PowerPoint が実際に書き出した日本語の PDF は加えていない (design の「ライセンスの問題がない公開の日本語の PDF を 1 つ以上加えることも検討する」)。Chromium の PDF と同じ癖を持つかは分からない。BIZ UDゴシックで `CIDFontType2` の形にそろえたが、字の配置の仕方 (1 字ずつの位置の指定など) は Office と違いうる。
- Chromium の版を上げたときに PDF の中身がどう変わるか。Windows・macOS で生成を動かすこと。
- 太字のフォントを読み込んだ PDF (見出しを太字にした場合) は作っていない。
- 縦書きの PDF の中で、Chromium は横書きと同じ `Identity-H` で字を書いている (縦書き用の `Identity-V` ではない)。縦書き用の字形 (句読点の位置など) が使われているかは確かめていない。
- cp932 の 髙 は iconv-lite が `0xFBFC` (IBM 拡張の側) で書く。Python の cp932 は `0xEEE0` (NEC 選定 IBM 拡張の側) で書く (9.5.5)。どちらも Python 版のサービスと `TextDecoder` で 髙 に戻る。
- Elasticsearch (kuromoji) での確認 (2.7 の仕事)。ベースラインの数値 (2.8 の仕事)。
- `pnpm install` で lockfile のうち、新しく足した 3 つの依存のほかに、`vitest-mock-extended` の peer の書き方 (`@vitest/ui@3.2.4(vitest@3.2.6)` → `@vitest/ui@3.2.4`) が 3 か所変わった (ルートの importer、この package の importer、snapshots のキー)。pnpm が書き方をそろえただけで、入る版は変わらない。

## 12. ベンチマークを測る道具 (タスク 2.7)

2026-11-04 に devcontainer (Node 24.21.0、Elasticsearch 9.3.3) で作り、Python 版 (8 節の手順、ポート 18000) とテストのためのスタブに向けて動かした。置き場所は `apps/attachment-text-extractor/benchmark/`。ベースラインの数値は 2.8 で記録するので、ここには書かない。

### 12.1 使い方

```bash
cd apps/attachment-text-extractor
# トークンは引数では受け取らない (ps やシェルの履歴に残るため)。環境変数か --token-file で渡す
BENCHMARK_TOKEN=$(cat "$TOKENFILE") pnpm benchmark \
  --url http://127.0.0.1:18000 --label python \
  --es-url http://elasticsearch:9200 --json /path/to/report.json > report.md
```

- `--url` (または `BENCHMARK_URL`): 抽出サービスの URL。`--label`: 結果の見出しに付ける名前 (`python` / `node` など。必須)。`--es-url` (または `BENCHMARK_ES_URL`): Elasticsearch。無ければ Elasticsearch の段は飛ばす。`--json`: 結果の全部を JSON でも書く。`--timeout-ms`: 1 文書あたりの待ち時間 (既定 120000)。
- 標準出力に Markdown の表を出す。中身は、実行の日時・ラベル・サービスの URL、形式ごとの (a)〜(c) の表 (最後の行が全体)、(d) Elasticsearch の表と、正しい位置だけで見つかったのではない語句の一覧、文書ごとの表、コーパスの PDF の SHA-256。JSON はこれに加えて、全ファイルの SHA-256 と、語句ごとの判定を持つ。
- 文書は 1 つずつ順に送る。並行して送ると、サービスの同時実行数の上限で 429 / 503 が返り、計測がぶれるため。
- **利用者名やパスワードを含む URL (`http://user:pass@host/` の形) は、`--url` / `--es-url` / 環境変数のどれで渡しても受け付けない** (エラーのメッセージにも URL を出さない)。Node の `fetch` はこの形の URL を拒み、その拒否のメッセージに URL がそのまま入るため、受け付けると失敗の理由の欄から認証情報が表や JSON に漏れる。
- 同じ道具を Python 版と Node 版の両方に向ける。比べる条件は「同じコーパスのファイルを、`answers.json` の MIME を付けて `POST /extract` に送る」で揃う。

### 12.2 ファイル構成

`benchmark/` の中に、責務ごとに分けて置いた。

| ファイル | 責務 |
|---|---|
| `run-benchmark.ts` | CLI の入口 (引数を読み、実行し、表を出す)。`pnpm benchmark` |
| `run-options.ts` | 引数と環境変数の解釈 |
| `benchmark-run.ts` | 1 回の計測の流れ (ファイルを読む → 送る → 採点 → 集計 → Elasticsearch) |
| `extract-client.ts` | `POST /extract` の呼び出し。失敗はすべて「失敗」という結果として返し、例外にしない |
| `extraction.ts` | 応答の型 (`pages[]` の要素と、成功・失敗の結果) |
| `scoring/` | 採点 (`phrase-match.ts` 語句の照合、`character-problems.ts` 文字化け、`score-document.ts` 文書 1 つの採点、`summarize.ts` 形式ごとの集計) |
| `elasticsearch/` | `es-queries.ts` (index の設定・クエリ・recall の計算。純関数)、`es-client.ts` (REST の呼び出し)、`measure-es-recall.ts` (一時 index を作って測り、消す) |
| `report-markdown.ts` | Markdown の表の組み立て |

### 12.3 指標の定義 (Req 2.9)

語句の照合は、`pages[]` の要素ごとに行う (GROWI は要素ごとに Elasticsearch の文書を作るので、要素をまたいだ語句は検索で見つからない)。文書全体での判定は、要素ごとの判定のうち最もよいもの。これとは別に、**正解の要素だけでの判定**も記録する (正解の要素では分断されているが、別の要素ではそのまま出ている、という場合を見逃さないため)。

**語句の照合の方針 (正規化)**: 次の 5 段階のどれかに判定する。

| 判定 | 意味 |
|---|---|
| `exact` | 抽出したテキストに、語句がそのまま (何も変えずに) ある |
| `whitespace-differs` | 語句の中に元からある空白の場所だけが違う (`ISO/IEC 27001` が `ISO/IEC\n27001` や `ISO/IEC27001` になった)。分断ではない |
| `split-at-line-break` | 語句の字の間に空白や改行が入っている。その場所が、`lineBreakAfter` (元の文書で行が変わった位置) だけ |
| `split-elsewhere` | 語句の字の間に空白や改行が入っている。`lineBreakAfter` 以外の場所にもある |
| `missing` | 空白を無視しても見つからない |

- 空白とは JavaScript の `\s` (半角の空白、タブ、改行、全角の空白 U+3000 などを含む)。空白のほかは何も変えない。**NFKC (全角・半角や互換文字をそろえる正規化) はかけない**。理由: 正解の語句とコーパスは元の字のまま書いてあり、抽出で字が別の字 (全角と半角の違い、部首の字 `⽇` など) に替わったら、それは抽出の違いとして表に出したい。検索のときの正規化 (GROWI の `japanese` analyzer は `icu_normalizer` で NFKC をかける) が効くかどうかは、(d) の Elasticsearch の段で別に測る。字が替わったことは、(c) の「元の文に無い文字」にも数として出る。
- 照合は、語句の字を順に並べ、字と字の間に「空白が 0 個以上」を許す正規表現で行う (語句の中の記号は文字どおりに扱う)。字と字の間に空白が入ったかどうかを、その場所ごとに記録して判定に使う。字の位置は Unicode のコードポイントで数える (`lineBreakAfter` と同じ数え方)。

**(a) 再現率**: 2 つ出す。
- 「そのまま」: `exact` の語句の割合。
- 「空白を除く」: `missing` 以外の語句の割合。

Node 版で PDF の部品が替わると、語の途中の改行が空白として出ることがある (11.8 の anydoc の例 `基幹シス テム`)。2 つを並べると、「字は取れているが空白で切れている」のか「字が取れていない」のかが分かる。

**(b) 位置の正しさ**:
- 要素の数が正しい文書: `pages[]` の要素の数が、正解の数と同じ文書の数。
- 番号とラベルが正しい要素: 正解の要素と、応答の要素を先頭から順に組にし (数が違うときは短い方まで)、`pageNumber` と `label` の両方が正解と同じものの数。分母は正解の要素の数。
- シート名がある要素 (XLSX だけ): 正解の `sheetName` が、その要素の `label` と同じか、`content` の中にあるもの。応答には `sheetName` という欄が無い。シート名を `label` に入れるかどうかはサービスの選び方なので、`label` が番号に変わっても、シート名が本文から分かれば検索では見つかる。そのため `label` の正しさとは別に数える。
- 正しい位置にある語句: 語句が、正解の位置 (`page` 番目の要素) で `missing` 以外に判定されたもの。要素の番号やラベルが正しいかは、ここでは見ない (上の 2 つの数で別に測る)。
- 別の位置にだけある語句: 見つかったが、正解の位置には無いもの。
- 正しい位置と別の位置の両方にある語句: 正解の位置で見つかり、ほかの要素でも見つかったもの。ページやシートの境目がずれて本文が別の要素にも入ると、検索で別のページやシートも当たる。これは位置の劣化だが、「正しい位置にある語句」の数は下がらないので、別に数える。コーパスは、各語句が正解の要素にだけ現れるように作ってある (11.4) ので、正しい抽出ではこの数は 0 になる。

**(c) 文字化けと語の分断**:
- U+FFFD: 置き換え文字の数 (出てきた回数)。
- 元の文に無い文字: 抽出したテキストの字のうち、空白・印字できる ASCII・U+FFFD のどれでもなく (ただし U+FEFF (BOM) は、JavaScript の `\s` には入るが、ここでは空白とみなさずに数える。BOM を取り除き忘れた出力を見逃さないため)、文書の元の文 (`sourceCharacters`。12.4) にも無いものの数 (出てきた回数)。ASCII の制御文字 (タブ・改行などの空白を除く) はここに数える。文書ごとの表に、その字の見本 (最大 20 種類) を出す。
- 分断 (改行の位置) と分断 (それ以外): 文書全体での判定 (最もよい要素での判定) が `split-at-line-break` と `split-elsewhere` の語句の数。
- 正しい位置での分断 (改行の位置 / それ以外): 正解の要素だけでの判定が `split-at-line-break` と `split-elsewhere` の語句の数。
- 出てはいけない語句の混入: `absentPhrases` (HTML の script / style の中の語句) のうち、空白を無視して出力に見つかったものの数 / 全体の数。

**失敗した文書**: HTTP の 4xx / 5xx、通信の失敗、時間切れ、200 でも形がおかしい応答は「失敗」とし、理由 (`HTTP 500 (internal_error)` など。トークンは含めない) を記録して次の文書へ進む。失敗した文書の語句は、再現率の分母に残し、見つからなかったものとして数える。分母から外すと、失敗が多いほど再現率が上がって見えるため。失敗した文書の数は (a) の表に別の列で出す。

### 12.4 「正解に無い文字の混入」の数え方 (2.6 のレビューの宿題 (i))

- **決めたこと**: `answers.json` の文書ごとに、任意の欄 **`sourceCharacters`** を足した。文書の元の文 (宣言 `benchmark/*-documents.ts` に書いてある中身) の字のうち、空白でも印字できる ASCII でもないものを、重ねずにコードポイント順に並べた文字列。抽出結果のうち、この集合に無い字を「元の文に無い文字」として数える。
- 作り方: 宣言から `pnpm benchmark:generate` が書き出す (`sourceCharactersOf`、`benchmark/corpus-document.ts`)。テキスト・CSV・HTML はファイルにする前の文全体、DOCX は段落、XLSX と XLS はシート名とセル、PPTX はスライドのタイトルと本文、OpenDocument は `content.xml` の文字列、PDF は各ページの HTML から作る。タグなどの記法は ASCII なので、そのまま渡してよい。
- Apache POI の DOC / PPT は、元の文が宣言に無いので、この欄を持たない。この 2 つは「元の文に無い文字」を数えず、表では `—` とする (日本語を含まない文書なので、文字化けを測る意味も小さい)。日本語の語句を持つ文書がすべてこの欄を持つことを `answers.spec.ts` で確かめる。
- 宣言とファイルの食い違いを防ぐため、`corpus-documents.spec.ts` と `pdf-documents.spec.ts` で、「コーパスのファイルを生成器と別の読み方で読んだときの字が、すべて `sourceCharacters` に入っている」ことを確かめる。PDF は 11.8 の関数 (ToUnicode の表から字を取る) で読む。
- **理由**: (1) answers.json は語句しか持っていなかったので、語句の外の字 (語句に入っていない本文) の文字化けを数えられなかった。(2) 「想定外の文字種 (ラテン文字の補助など) だけを数える」案も考えたが、どの文字種を想定外とするかの線引きが恣意的になる。シフト JIS を別の文字コードとして読むと、もっともらしい漢字に化けることもある。文書ごとの「元の文にある字」との比較なら、線引きが要らず、別の漢字に化けたものも数えられる。(3) 計測の道具は、生成器を使わずに `answers.json` とコーパスのファイルだけで動く (11.6)。字の集合を `answers.json` に入れておけば、この形を崩さない。(4) Node 版の anydoc で読んだ結果から字の集合を作る案は採らなかった。Node 版の出力を、同じ Node 版の部品から作った基準で採点することになり、違いが出ないのが当然の比べ方になるため。
- 限界: HTML の `sourceCharacters` は script / style の中の字も含む (元の文全体から作るため)。script / style の中身が出力に漏れたことはこの数では分からないが、`absentPhrases` の混入の数で別に測る。また、元の文にある字に化けた場合 (別の位置の字に入れ替わるなど) は数えられない。その場合は (a) の再現率で見つける。

### 12.5 HTML の「出てはいけない語句」が本文に無いこと (2.6 のレビューの宿題 (ii))

`corpus-documents.spec.ts` に、script / style を持つ HTML について「script / style の部分を取り除いた残り (本文とタグ) に、`absentPhrases` が空白を無視しても無い」ことを確かめるテストを足した。本文にも同じ語句があると、正しい抽出 (本文は残し、script / style は捨てる) が「混入」として減点されてしまうため。わざと本文に `<p>スタイル 定義</p>` を足して生成し直すと、このテストが失敗することを確かめた (その後、元に戻して生成し直し、コーパスのファイルが元と同じバイト列であることを確かめた)。

### 12.6 Elasticsearch での計測 (Req 2.10)

- **kuromoji は使える (実測)**。devcontainer の Elasticsearch は 9.3.3。`GET /_cat/plugins?format=json` に `analysis-kuromoji` 9.3.3 と `analysis-icu` 9.3.3 がある。`_analyze` (tokenizer `kuromoji_tokenizer`、char_filter `icu_normalizer`) で `基幹システムの本格稼働` は `基幹 / システム / の / 本格 / 稼働` に分かれた。道具は実行のたびに同じ確認をして、結果を表に出す。`analysis-kuromoji` が無いときは、Elasticsearch の段を飛ばし、「(a)〜(c) だけで判定する」と表に書く。`analysis-icu` だけが無いときは、`icu_normalizer` を外して測り、その旨を表に書く。
- **index の設定**: GROWI の添付ファイルの index (`apps/app/src/features/search-attachments/server/mappings/attachments-mappings-es9.ts`) の `japanese` analyzer (`kuromoji_tokenizer` + `icu_normalizer`) と、`content` / `content.ja` の定義を写して使う (`elasticsearch/es-queries.ts`)。apps/app はこの package の外なので import できない。写したことは、そのファイルのコメントにも書いた。GROWI の側を変えたら、ここも合わせる。`content.en` (英語の edge n-gram) は日本語の語句の計測に関係しないので写していない。
- **文書の単位**: `pages[]` の要素ごとに 1 つの Elasticsearch の文書を作る (GROWI の `buildDocId` と同じ単位)。欄は `fileName` (keyword)、要素の番号 `elementIndex`、`content`。`_bulk` は `refresh=true` で入れる (直後の検索で見えるようにするため)。
- **クエリ** (語句ごと、文書の `fileName` で絞り込む):
  - `kuromoji-phrase`: `content.ja` への `match_phrase`。kuromoji で分けた語が、同じ順で並んでいるか。Req 2.10 の「kuromoji の解析器を使う設定で検索したとき」にあたる主な指標。
  - `growi-quoted-phrase`: `content` (標準の解析器) への `match_phrase`。GROWI で利用者が語句を `"…"` で囲んで検索したときのクエリ (`attachment-keyword-query.ts` の phrase の扱い) と同じ。ただし標準の解析器は漢字を 1 字ずつに分け、空白を捨てるので、漢字の間の分断には反応しない (レビューで、語の途中に空白を入れた出力でも 101/118 が見つかった)。**Python 版と Node 版を比べるときは、このクエリを主な判定にせず、(a)〜(c) と `kuromoji-phrase` を主にする**。
  - GROWI の通常の検索 (`multi_match` の `most_fields`、既定の OR) は採らなかった。語のどれか 1 つが合えば当たるので、どんな出力でも recall がほぼ 100% になり、違いを測れないため。
- **数えるもの**: 形式ごと・クエリごとに、語句のうち「その文書が見つかった」(どれかの要素に当たった) 割合、「正しい位置で見つかった」(正解の要素に当たった) 割合、「正解以外の位置に当たった」(正解の要素以外のどれかに当たった) 語句の数。最後の数は、正解の要素にも当たったかどうかを問わない (正しい抽出では 0)。(b) の表の「正しい位置と別の位置の両方にある語句」は正解の位置でも見つかったものだけを数えるが、この列は正解の位置に当たらず別の位置にだけ当たったものも含めて数える。失敗した文書は index に入れないので、その語句は見つからなかったものとして数える。正解の要素だけに当たったのではない語句 (正解の要素に当たらなかった、または別の要素にも当たった) は、一覧にして出す。
- **index の後始末**: index の名前は `benchmark-<時刻>-<乱数>` (小文字だけ。`--label` からは作らない)。計測の後は、成功しても失敗しても削除する。計測が失敗し、削除も失敗したときは、計測の失敗を主な理由とし、削除の失敗をその後ろに書き足す (削除の失敗で元の原因が隠れないようにするため)。Ctrl-C (SIGINT) のときも、削除を試みてから終わる (この経路は手で止めて確かめてはいない)。Python 版に向けた動作確認の後、`_cat/indices/benchmark-*` が空であることを確かめた。
- **テスト**: クエリの組み立て、応答の読み取り、recall の計算は純関数としてテストする。実際の Elasticsearch に当てるテスト (`measure-es-recall.spec.ts`) は、環境変数 `BENCHMARK_ES_URL` があるときだけ動く (CI には Elasticsearch が無いので飛ばす)。devcontainer で `BENCHMARK_ES_URL=http://elasticsearch:9200` を付けて動かし、kuromoji の確認、正しい位置での検索、空白で切れた語句が見つからないこと、index が消えたことを確かめた。

### 12.7 テストで確かめていること

`pnpm test` (vitest) で動く。

- 採点 (`scoring/*.spec.ts`): 正解と出力を手で合わせた小さな例で、完全に一致すれば全部 `exact`・位置も正しいこと、語句が 1 つ欠けること、語句の途中に空白が入ったもの (改行の位置とそれ以外を分けて数える)、語句に元からある空白の違いは分断としないこと、記号を文字どおりに扱うこと、U+FFFD を元の文に無い文字と別に数えること、元の文に無い文字 (部首の字 `⽇`、`ã`、制御文字、出力に残った BOM) を数え、ASCII と空白は数えないこと、正解の語句が別のページに出たもの、正解のページと別のページの両方に出たもの、正解の要素では分断され別の要素ではそのまま出たもの (正解の要素だけでの判定で分断として数える)、要素の数の違い、`pageNumber` や `label` の違い、XLSX のシート名、空の抽出、失敗した文書、HTML の出てはいけない語句の混入 (空白で切れていても数える)、形式ごとの集計 (失敗した文書の語句が分母に残ること)。期待値は例を読んで手で数えた値で、採点の関数を動かして作ったものではない。
- `POST /extract` の呼び出し (`extract-client.spec.ts`): テストの中で `node:http` の小さなサーバーを立て、multipart の欄 `file` にファイル名・MIME・中身が入ること、`Authorization: Bearer`、4xx / 5xx を「失敗」にして状態コードとエラーコードを理由に残すこと、JSON でない 500、形のおかしい 200、時間切れ、つながらないサーバー (理由にトークンが入らないこと) を確かめる。
- 計測の流れ (`benchmark-run.spec.ts`): 同じスタブに、コーパスの 3 文書を送り、各文書が 1 回ずつ `answers.json` の MIME で送られること、1 つが 500 でも残りを採点すること、PDF の SHA-256 が 11.6 の値と同じであること、Elasticsearch の URL が無いとき・つながらないとき・`analysis-kuromoji` が無いときは、その段を飛ばして理由を残し、抽出の採点はふだんどおり行うこと、結果にトークンが入らないことを確かめる。
- 表 (`report-markdown.spec.ts`)、引数 (`run-options.spec.ts`。トークンを引数で渡すと拒否する。利用者名やパスワードを含む URL と読めない URL を、URL を繰り返さずに拒否する)、Elasticsearch の純関数 (`elasticsearch/es-queries.spec.ts`。別の要素にも当たった語句の数え方を含む)、index の作成も削除も失敗したときに、作成の失敗が理由の先頭にあり `cause` に入ること、計測が成功して削除だけが失敗したときもエラーになること (`measure-es-recall.spec.ts`。`node:http` の偽の Elasticsearch を使う)。

### 12.8 確かめなかったこと

- Node 版にはまだ向けていない (段階 3 以降)。Python 版とスタブでだけ動かした。
- 数値の意味づけ (ベースライン) は 2.8 で行う。
- `sourceCharacters` は、元の文にある字への化け (字の入れ替わり) を数えられない (12.4 の限界)。

## 13. Python 版のベースライン (タスク 2.8)

2026-11-04 に devcontainer で、いまの Python 版 (変更なし) に 2.7 の道具 (12 節) を向けて測った。Node 版にはまだ向けていない。この節の数値が、Node 版と比べるときの基準 (Req 2.11) になる。保存したもの: この節と、結果の全部を機械で読める形にした `apps/attachment-text-extractor/benchmark/baseline/python-baseline.json` (13.7)。

### 13.1 実行条件

| 項目 | 内容 |
|---|---|
| 日時 | 2026-11-04 (UTC) 17:19:57 〜 17:20:03 に 3 回。1 回あたり約 1.5 秒 |
| リポジトリのコミット | `3836a0c721` (ベンチマークの道具を含む)。**Python 版 (`services/attachment-text-extractor/`) の最後の変更コミットは `30be383b81`** で、作業ツリーに変更は無かった (`git status` で確認) |
| Python 版 | Python 3.12.15 (`.venv`)、firecrawl-anydoc 0.2.4、pypdfium2 5.14.0、charset-normalizer 3.5.2、fastapi 0.136.1、uvicorn 0.46.0。起動は 8 節の手順どおり (`127.0.0.1:18000`、`--workers` なし。トークンは使い捨てのダミーを scratchpad の 600 権限のファイルに置き、終了後に消した) |
| Elasticsearch | 9.3.3 (`http://elasticsearch:9200`)。`analysis-kuromoji` 9.3.3 と `analysis-icu` 9.3.3 の両方あり。`基幹システムの本格稼働` が `基幹 / システム / の / 本格 / 稼働` に分かれる確認も毎回通った |
| 道具 | Node 24.21.0 (`/usr/local/share/nvm/versions/node/v24.21.0`) |
| 実行コマンド | `cd apps/attachment-text-extractor && pnpm benchmark --label python-baseline --url http://127.0.0.1:18000 --token-file <トークンのファイル> --es-url http://elasticsearch:9200 --json <出力先>` |
| コーパス | 23 文書 (失敗 0)、語句 118 個。11.4 のとおり |
| PDF の SHA-256 | 3 回とも、11.6 の値と同じ: `pdf-ja-horizontal.pdf` `8a757369271d0348202f5df3c9822d41a74ab3603a46752715d4628f49411a13`、`pdf-ja-vertical.pdf` `28d642ad0fc0217f55b26fc1b1b1c6cd98dbcbae6f63ed2c4752a5f38c188892`、`pdf-ja-line-break.pdf` `9c9a4f216fd43a0fa2748f004b44ebb65577c1a7be9de1b76974871f1d4ab1b7` |

### 13.2 3 回の一致の確認

同じ起動中のサービスに、続けて 3 回測った (出力は Markdown と JSON)。Markdown は、実行の日時の行と一時 index の名前の行 (`benchmark-<時刻>-<乱数>`) だけが違い、ほかは 1 字も違わなかった。JSON も、`startedAt`、`finishedAt`、`elasticsearch.indexName` の 3 つだけが違い、数値と判定 (語句ごとの `match`、`foundOnPages` なども) はすべて同じだった。**決定的である (3 回とも同じ)。違う指標は無い。**

### 13.3 結果の表 (形式ごと・指標ごと)

2.7 の出力の表をそのまま写した。列名も 2.7 の最終版のとおり。指標の定義は 12.3、Elasticsearch の測り方は 12.6。

#### (a) 語句の再現率

| 形式 | 文書 | 失敗 | 語句 | 再現率 (そのまま) | 再現率 (空白を除く) |
| --- | --- | --- | --- | --- | --- |
| pdf | 3 | 0 | 21 | 21/21 (100.0%) | 21/21 (100.0%) |
| docx | 1 | 0 | 6 | 6/6 (100.0%) | 6/6 (100.0%) |
| xlsx | 1 | 0 | 6 | 6/6 (100.0%) | 6/6 (100.0%) |
| pptx | 1 | 0 | 7 | 7/7 (100.0%) | 7/7 (100.0%) |
| xls | 1 | 0 | 4 | 4/4 (100.0%) | 4/4 (100.0%) |
| csv | 2 | 0 | 12 | 12/12 (100.0%) | 12/12 (100.0%) |
| html | 2 | 0 | 9 | 9/9 (100.0%) | 9/9 (100.0%) |
| txt | 7 | 0 | 41 | 41/41 (100.0%) | 41/41 (100.0%) |
| doc | 1 | 0 | 2 | 2/2 (100.0%) | 2/2 (100.0%) |
| ppt | 1 | 0 | 3 | 3/3 (100.0%) | 3/3 (100.0%) |
| odt | 1 | 0 | 3 | 3/3 (100.0%) | 3/3 (100.0%) |
| ods | 1 | 0 | 2 | 2/2 (100.0%) | 2/2 (100.0%) |
| odp | 1 | 0 | 2 | 2/2 (100.0%) | 2/2 (100.0%) |
| 全体 | 23 | 0 | 118 | 118/118 (100.0%) | 118/118 (100.0%) |

#### (b) 位置の正しさ

| 形式 | 要素の数が正しい文書 | 番号とラベルが正しい要素 | シート名がある要素 | 正しい位置にある語句 | 別の位置にだけある語句 | 正しい位置と別の位置の両方にある語句 |
| --- | --- | --- | --- | --- | --- | --- |
| pdf | 3/3 (100.0%) | 6/6 (100.0%) | — | 21/21 (100.0%) | 0 | 0 |
| docx | 1/1 (100.0%) | 1/1 (100.0%) | — | 6/6 (100.0%) | 0 | 0 |
| xlsx | 1/1 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) | 6/6 (100.0%) | 0 | 0 |
| pptx | 1/1 (100.0%) | 3/3 (100.0%) | — | 7/7 (100.0%) | 0 | 0 |
| xls | 1/1 (100.0%) | 1/1 (100.0%) | — | 4/4 (100.0%) | 0 | 0 |
| csv | 2/2 (100.0%) | 2/2 (100.0%) | — | 12/12 (100.0%) | 0 | 0 |
| html | 2/2 (100.0%) | 2/2 (100.0%) | — | 9/9 (100.0%) | 0 | 0 |
| txt | 7/7 (100.0%) | 7/7 (100.0%) | — | 41/41 (100.0%) | 0 | 0 |
| doc | 1/1 (100.0%) | 1/1 (100.0%) | — | 2/2 (100.0%) | 0 | 0 |
| ppt | 1/1 (100.0%) | 1/1 (100.0%) | — | 3/3 (100.0%) | 0 | 0 |
| odt | 1/1 (100.0%) | 1/1 (100.0%) | — | 3/3 (100.0%) | 0 | 0 |
| ods | 1/1 (100.0%) | 1/1 (100.0%) | — | 2/2 (100.0%) | 0 | 0 |
| odp | 1/1 (100.0%) | 1/1 (100.0%) | — | 2/2 (100.0%) | 0 | 0 |
| 全体 | 23/23 (100.0%) | 30/30 (100.0%) | 3/3 (100.0%) | 118/118 (100.0%) | 0 | 0 |

#### (c) 文字化けと語の分断

| 形式 | U+FFFD | 元の文に無い文字 | 分断 (改行の位置) | 分断 (それ以外) | 正しい位置での分断 (改行の位置) | 正しい位置での分断 (それ以外) | 出てはいけない語句の混入 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pdf | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| docx | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| xlsx | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| pptx | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| xls | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| csv | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| html | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 |
| txt | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| doc | 0 | — | 0 | 0 | 0 | 0 | 0/0 |
| ppt | 0 | — | 0 | 0 | 0 | 0 | 0/0 |
| odt | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| ods | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| odp | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 |
| 全体 | 0 | 0 | 0 | 0 | 0 | 0 | 0/2 |

#### (d) Elasticsearch での検索

一時 index に、`pages[]` の要素ごとに 1 文書として入れて測った。測り終えた後、index は削除された (測定のあとで `_cat/indices/benchmark-*` が空であることを確かめた)。

| 形式 | クエリ | 語句 | 文書が見つかった | 正しい位置で見つかった | 正解以外の位置に当たった |
| --- | --- | --- | --- | --- | --- |
| pdf | kuromoji-phrase | 21 | 21/21 (100.0%) | 21/21 (100.0%) | 0 |
| docx | kuromoji-phrase | 6 | 5/6 (83.3%) | 5/6 (83.3%) | 0 |
| xlsx | kuromoji-phrase | 6 | 6/6 (100.0%) | 6/6 (100.0%) | 0 |
| pptx | kuromoji-phrase | 7 | 7/7 (100.0%) | 7/7 (100.0%) | 0 |
| xls | kuromoji-phrase | 4 | 4/4 (100.0%) | 4/4 (100.0%) | 0 |
| csv | kuromoji-phrase | 12 | 12/12 (100.0%) | 12/12 (100.0%) | 0 |
| html | kuromoji-phrase | 9 | 9/9 (100.0%) | 9/9 (100.0%) | 0 |
| txt | kuromoji-phrase | 41 | 41/41 (100.0%) | 41/41 (100.0%) | 0 |
| doc | kuromoji-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| ppt | kuromoji-phrase | 3 | 3/3 (100.0%) | 3/3 (100.0%) | 0 |
| odt | kuromoji-phrase | 3 | 3/3 (100.0%) | 3/3 (100.0%) | 0 |
| ods | kuromoji-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| odp | kuromoji-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| pdf | growi-quoted-phrase | 21 | 21/21 (100.0%) | 21/21 (100.0%) | 0 |
| docx | growi-quoted-phrase | 6 | 6/6 (100.0%) | 6/6 (100.0%) | 0 |
| xlsx | growi-quoted-phrase | 6 | 6/6 (100.0%) | 6/6 (100.0%) | 0 |
| pptx | growi-quoted-phrase | 7 | 7/7 (100.0%) | 7/7 (100.0%) | 0 |
| xls | growi-quoted-phrase | 4 | 4/4 (100.0%) | 4/4 (100.0%) | 0 |
| csv | growi-quoted-phrase | 12 | 12/12 (100.0%) | 12/12 (100.0%) | 0 |
| html | growi-quoted-phrase | 9 | 9/9 (100.0%) | 9/9 (100.0%) | 0 |
| txt | growi-quoted-phrase | 41 | 41/41 (100.0%) | 41/41 (100.0%) | 0 |
| doc | growi-quoted-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| ppt | growi-quoted-phrase | 3 | 3/3 (100.0%) | 3/3 (100.0%) | 0 |
| odt | growi-quoted-phrase | 3 | 3/3 (100.0%) | 3/3 (100.0%) | 0 |
| ods | growi-quoted-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| odp | growi-quoted-phrase | 2 | 2/2 (100.0%) | 2/2 (100.0%) | 0 |
| 全体 | kuromoji-phrase | 118 | 117/118 (99.2%) | 117/118 (99.2%) | 0 |
| 全体 | growi-quoted-phrase | 118 | 118/118 (100.0%) | 118/118 (100.0%) | 0 |

| ファイル | クエリ | 語句 | 期待の位置 | 見つかった位置 |
| --- | --- | --- | --- | --- |
| docx-ja.docx | kuromoji-phrase | テレワーク勤務制度 | 1 | なし |

#### 文書ごと

| ファイル | 結果 | 再現率 (そのまま / 空白を除く) | 要素の数 (期待 / 実際) | U+FFFD | 元の文に無い文字 | 見つからない・分断・位置ずれの語句など |
| --- | --- | --- | --- | --- | --- | --- |
| pdf-ja-horizontal.pdf | ok | 9 / 9 / 9 | 3 / 3 | 0 | 0 |  |
| pdf-ja-vertical.pdf | ok | 6 / 6 / 6 | 2 / 2 | 0 | 0 |  |
| pdf-ja-line-break.pdf | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| txt-shift-jis.txt | ok | 7 / 7 / 7 | 1 / 1 | 0 | 0 |  |
| txt-euc-jp.txt | ok | 7 / 7 / 7 | 1 / 1 | 0 | 0 |  |
| txt-iso-2022-jp.txt | ok | 5 / 5 / 5 | 1 / 1 | 0 | 0 |  |
| txt-utf-8-bom.txt | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| txt-utf-16le-bom.txt | ok | 5 / 5 / 5 | 1 / 1 | 0 | 0 |  |
| txt-utf-16be-bom.txt | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| txt-utf-8.txt | ok | 5 / 5 / 5 | 1 / 1 | 0 | 0 |  |
| csv-utf-8.csv | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| csv-cp932.csv | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| html-shift-jis-script-style.html | ok | 5 / 5 / 5 | 1 / 1 | 0 | 0 |  |
| html-euc-jp-http-equiv.html | ok | 4 / 4 / 4 | 1 / 1 | 0 | 0 |  |
| docx-ja.docx | ok | 6 / 6 / 6 | 1 / 1 | 0 | 0 |  |
| xlsx-ja-multi-sheet.xlsx | ok | 6 / 6 / 6 | 3 / 3 | 0 | 0 |  |
| pptx-ja-multi-slide.pptx | ok | 7 / 7 / 7 | 3 / 3 | 0 | 0 |  |
| xls-ja.xls | ok | 4 / 4 / 4 | 1 / 1 | 0 | 0 |  |
| odt-ja.odt | ok | 3 / 3 / 3 | 1 / 1 | 0 | 0 |  |
| ods-ja.ods | ok | 2 / 2 / 2 | 1 / 1 | 0 | 0 |  |
| odp-ja.odp | ok | 2 / 2 / 2 | 1 / 1 | 0 | 0 |  |
| doc-legacy.doc | ok | 2 / 2 / 2 | 1 / 1 | 0 | — |  |
| ppt-legacy.ppt | ok | 3 / 3 / 3 | 1 / 1 | 0 | — |  |

結果の読み方: 全体の行は、(a)〜(c) はすべて理想の値 (再現率 118/118、位置の問題 0、文字化け・分断・混入 0)。(d) は `growi-quoted-phrase` が 118/118、`kuromoji-phrase` が 117/118 で、足りない 1 語句は次の 13.4 のとおり。

### 13.4 文書ごとの特記事項

- **`docx-ja.docx` の `テレワーク勤務制度` が `kuromoji-phrase` で見つからない (唯一の取りこぼし)**。抽出は正しい (再現率はそのまま 6/6、語句は `exact`)。Python 版の抽出結果は `第2条（テレワーク勤務）\` + 改行 + `テレワーク勤務制度を新設し…` の形 (段落の中の改行 `<w:br/>` が、Markdown の改行の印 `\` と改行になる。9 節の「段落の中の改行」の件)。
  - 原因の観察 (2.7 の報告では「改行の印 `\` の直後で分ける」としていたが、**測り直すと `\` は関係なかった**): Elasticsearch の `_analyze` (`kuromoji_tokenizer` + `icu_normalizer`) で、`テレワーク勤務制度を新設し` だけを入れると `テレワーク / 勤務 / 制度 / を / 新設 / し` と分かれるが、**その前に改行 (`\n`) があると**、`\` が無くても (`）` + 改行 + `テレワーク勤務制度…` でも、改行 + `テレワーク勤務制度…` だけでも) `テレ / ワーク / 勤務 / 制度 / を …` と分かれた。改行ではなく句点 `。` で続けた場合 (`）。テレワーク勤務制度を`) は分かれなかった。つまり、**改行の直後に来た `テレワーク` を kuromoji が `テレ / ワーク` に分ける** (同じ段落の 1 つ目の `（テレワーク勤務）` は分かれない)。2.8 の独立レビューで条件を広げて測り直した結果、改行に限らず、**文の先頭と句点 `。` の直後以外では分かれうる** (先頭の空白、読点 `、`、半角スペースの後でも `テレ / ワーク` に分かれた。`icu_normalizer` の有無は無関係)。検索の語句 `テレワーク勤務制度` は `テレワーク / 勤務 / 制度` に分かれるので、順序が合わず `match_phrase` が当たらない。
  - 意味: これは抽出サービスの欠陥ではなく、**kuromoji の癖と、文書の中身 (行の先頭にある語) の組み合わせ**。Node 版が同じ文面 (改行・空白・読点の直後に語が来る形) を返すなら、同じ取りこぼしになるはず (未確認。Node 版の結果で確かめる)。文面が空白や読点を挟む形に変わっても同じことが起きうる。この語句は `growi-quoted-phrase` (標準の解析器) では見つかる (6/6)。
  - Node 版との比較での扱い: この語句が見つかって 6/6 になっても退行ではなく、見つからなくても 5/6 はベースラインと同じなので退行ではない。**ただし割合ではなく語句の集合で比べる**: 見つからない語句の集合が、ベースラインの集合 (`テレワーク勤務制度` だけ) に含まれることを条件にする (JSON の `elasticsearch.positionProblems[]` に見つからなかった語句の一覧がある)。同じ docx の別の語句を 1 つ落として 5/6 のままになる場合は退行として扱う。結果が違うときは、抽出した文面の違い (改行の位置など) を調べる材料になる。
- **縦書き PDF (`pdf-ja-vertical.pdf`)**: Python 版 (pypdfium2) は、2 ページとも正しい順で読めた。語句 6/6、要素の数 2/2、番号とラベルも 2/2 で正しい。ページ内の見出しと本文は改行なしでつながる (`沿革昭和五十年横浜市にて創業…`)。11.7 に書いた「日本語の間の改行を詰める正規化」の結果で、語句の検索には影響しなかった (語句は 6/6 が正しい位置で見つかった)。
- **語の途中で改行する PDF (`pdf-ja-line-break.pdf`)**: 10 字幅の段で語が途中で折り返されているが、Python 版の抽出結果は `当社の新しい基幹システムは来年度から本格稼働する予定である。` のように、語がつながった形で出た。語句 6/6 が `exact`、分断 0。この PDF では、Python 版は「語の途中の改行」の影響を受けない (正規化で日本語の間の改行が詰められるため)。Node 版の PDF の部品で、語の途中の改行が空白や改行として残ると、(a) の「空白を除く」と「そのまま」に差が出て、(c) の分断 (改行の位置) の数も増える。ここは PDF の部品を替えるときに退行が出やすい所の候補。
- **HTML の script / style の語句**: `html-shift-jis-script-style.html` の `absentPhrases` 2 個は、どちらも出力に現れなかった (混入 0/2)。ほかの形式は `absentPhrases` が無いので 0/0。
- **文字コード**: Shift_JIS、EUC-JP、ISO-2022-JP、BOM 付き UTF-8、UTF-16 (LE / BE)、BOM なし UTF-8、cp932 の CSV、Shift_JIS と EUC-JP の HTML を含む txt 7 個・csv 2 個・html 2 個の 11 文書は、すべて語句 100% (そのまま)、U+FFFD 0、元の文に無い文字 0、分断 0。
- **XLSX**: 3 シートに分かれ、`label` はシート名。「シート名がある要素」は 3/3 (12.3 のとおり、`label` か `content` にシート名がある数)。
- **DOC / PPT (Apache POI の旧形式)**: 「元の文に無い文字」は数えない (`—`。12.4)。語句は 100%、U+FFFD は 0。

### 13.5 Node 版との比較の合否の考え方 (Req 2.12、2.14、2.15)

比べる単位は、**形式 (表の行) × 指標 (表の列) のすべて**。比較の道具 (6.13) と、人が読むときは、次の規則を使う。

| 種類 | 規則 (Node 版が下回る = 退行) |
|---|---|
| 割合の指標 (再現率の 2 つ、(b) の要素の数・番号とラベル・シート名・正しい位置にある語句、(d) の「文書が見つかった」「正しい位置で見つかった」) | Node 版の割合が、ベースラインの同じ形式・同じ指標の割合以上。いまの値は、**docx の `kuromoji-phrase` (5/6) を除き、すべて 100%**。つまり、実質は「すべて 100% を保つ」ことになる |
| 少ないほどよい数 ((b) の「別の位置にだけある語句」「正しい位置と別の位置の両方にある語句」、(c) の U+FFFD・元の文に無い文字・分断 4 列・出てはいけない語句の混入、(d) の「正解以外の位置に当たった」) | ベースラインがすべて **0** なので、Node 版も **0**。1 つでも出たら退行 (別の位置にも出る語句、文字化け、分断、混入) |
| 失敗した文書の数 | 0 |
| 位置の指標 | Req 2.15 により、PDF のページ、PPTX のスライド、XLSX のシートの位置の指標 ((b) の列) は、品質の一部として下回ってはならない。ベースラインは 100% なので、要素の数と `pageNumber` / `label` が 1 つでもずれたら退行 |

- 退行が見つかったら、Req 2.14 のとおり、形式・指標・原因 (部品の違い) を research.md に記録し、直すか受け入れるかをユーザーに諮る。ユーザーの判断なしに受け入れない。
- 割合の比較は、分母が同じ (同じコーパス) ことが前提。コーパスを変えたら、ベースラインを測り直す。
- Node 版のほうがベースラインより高い値になるのは退行ではない (docx の `kuromoji-phrase` が 6/6 になる、など)。

### 13.6 結果の読み方 (どの指標が劣化に敏感か)

- **最も敏感なのは (a) の 2 つの再現率と、(c) の分断の 4 列**。PDF の部品を替えると、語の途中の改行が空白として残る (11.8 の `基幹シス テム` の例)、縦書きの順序が崩れる、字が欠ける、といった形で最初に出るのは、(a) の「そのまま」と「空白を除く」の差、(c) の分断。両方を並べれば、「字は取れているが空白で切れている」か「字が取れていない」かが分かる。
- **(b) の位置**は、ページ・スライド・シートの境目が替わる (たとえば PPTX のスライドを 1 つにまとめる、XLSX のシート名を `label` に入れない) と動く。正しい位置と別の位置の両方にある語句は、境目がずれて本文が別の要素にも入ったときに出る。
- **(c) の「元の文に無い文字」と U+FFFD** は、文字コードの判定が替わる (テキスト系の部品。T6) と動く。
- **(d)** は検索の結果に近いが、次の注意がある (12.6 のとおり)。`growi-quoted-phrase` は標準の解析器が漢字を 1 字ずつに分け、空白を捨てるので、**漢字の間の分断に反応しない**。語の途中に空白が入った出力でも見つかってしまうので、比べるときは (a)(b)(c) と `kuromoji-phrase` を主にする。`kuromoji-phrase` は分断に反応するが、13.4 のように、抽出が正しくても kuromoji の癖で取りこぼす語句がある (docx の 1 語句)。
- コーパスは小さい (23 文書、118 語句。PDF は 3 個で 21 語句、縦書き 6、語の途中の改行 6)。1 語句の違いは全体の約 0.85 ポイント、PDF の縦書きなら約 17 ポイント。割合で大きく見えても、実際は語句 1〜2 個の違いのことがある。

### 13.7 保存したもの

- `apps/attachment-text-extractor/benchmark/baseline/python-baseline.json` (約 61KB)。2.7 の `--json` の出力 (1 回目) を、`benchmark/biome.json` の整形に合わせて `biome format` で整形したもの (中身は同じ。JSON として読んだ結果が、整形前と一致することを確かめた)。URL は、サービスの `http://127.0.0.1:18000` と ES の `http://elasticsearch:9200` (devcontainer 内のホスト名) だけで、利用者名・パスワード・トークンは入っていない (トークンの値で全文を検索して 0 件)。
- 中身 (主なもの): `label` (`python-baseline`)、`service`、`startedAt` / `finishedAt`、`corpus[]` (全ファイルのバイト数と SHA-256)、`formats` (形式ごとの集計)、`total` (全体)、`documents[]` (文書ごとの語句の判定、`pages`、`characters`、`absentPhrases`)、`elasticsearch` (`recall[]`、`positionProblems`)。後の比較では、`startedAt`、`finishedAt`、`elasticsearch.indexName`、`label`、`service` は比べない (実行ごとに違う)。
- Node 版を測った JSON も、同じ形で `benchmark/baseline/` に置いて比べられる。

### 13.8 絶対値の基準を置くかを 2.9 で決めるための材料

Req 2.13 のとおり、ベースラインに加えて、絶対値の下限を置くかどうかは、ユーザーが決める。決めるための観察:

1. **ベースラインはほぼ天井**。(a)(b)(c) は全体で理想の値 (100% と 0)、(d) の `growi-quoted-phrase` も 118/118。`kuromoji-phrase` だけ 117/118 で、足りない 1 語句は抽出の問題ではなく kuromoji の癖 (13.4)。
2. 13.5 のとおり、Node 版は「ベースライン以下にならない」を満たすために、実質的に **すべての (a)(b)(c) の指標で理想の値を保つ**必要がある。したがって、絶対値の下限を (a)(b)(c) に別に置いても、同じ条件になる (「下限 100%」と「ベースライン以上」が一致する)。別の値 (たとえば 95%) を置いても、Req 2.13 は「ベースラインに**加えて**」下限を置くので Req 2.12 の「下回らない」は残る。つまり 95% の下限は、ベースライン以上に包含されて意味がなくなるだけである。
3. 絶対値の基準に意味が出るのは、ベースラインが天井でない指標だけ。いまはそれは、docx の `kuromoji-phrase` (5/6、約 83%) だけ。ここに「100%」のような下限を置くと、抽出が正しくても Node 版が通れなくなる (kuromoji の癖で必ず取りこぼすため)。
4. このコーパスで測れるのは、Python 版でも読める普通の形式の小さな文書だけ。実際の利用者の PDF (Word や PowerPoint から書き出したもの)、スキャン画像、大きな文書は含まれない (design.md の「日本語の PDF の用意」の注意)。ベースラインが天井のため、**Node 版が良くなる方向の差は、このベンチマークでは見えない**。
5. 数値の基準でなく、運用の基準 (たとえば「PDF の部品や anydoc の版を替えるたびに、このベンチマークを回し、ベースライン以上であること」) を置く案もある。

### 13.9 確かめたこと

- Python 版を 8 節の手順で起動し (ポート 18000)、`/readyz` が 200 になってから測った。Python 版は 1 度も落ちず、23 文書とも `ok` (失敗 0)。
- ES の段は 3 回とも `measured` で動いた (kuromoji と ICU の両方あり)。
- PDF 3 個の SHA-256 が 11.6 の値と一致した (3 回とも)。
- 出力 (Markdown、JSON、標準エラー、Python 版のログ) にトークンの値は含まれなかった (値で検索して 0 件)。
- 測定の後、`_cat/indices/benchmark-*` は空 (一時 index は残らなかった)。
- 測定の後、自分で起動した Python 版だけを TERM で止めた。同じプロセスグループに残りは無く (`pgrep -g` が空)、ポート 18000 は解放され、トークンと PID のファイルは消した。
- Python 版のコードと、ほかの Python 版のファイルは変更していない。
- `pnpm run lint` (biome と tsgo) は、JSON を置いた状態で通る。

### 13.10 確かめなかったこと

- Node 版との比較 (段階 3 以降の 6.13)。
- 実際の利用者の PDF での品質 (コーパスの外)。
- Python 版の性能 (時間、メモリ)。ここは品質のベースラインだけ。

### 13.11 ユーザーの判断 (タスク 2.9、2026-11-05)

- ベンチマークの合格の基準に、絶対値の下限は**置かない**。合格は Req 2.12 の「すべての形式・すべての指標で Python 版のベースライン以上」だけとする (13.5 の扱い。ベースラインが 0 の「悪い方の数」は Node 版も 0。docx の `kuromoji-phrase` は、見つからない語句の集合がベースラインの集合 (`テレワーク勤務制度` だけ) に含まれることを条件にする)。
- 理由 (13.8): ベースラインがほぼ天井のため、「ベースライン以上」は実質「全指標で今の水準を保つ」になる。95% のような下限は意味がなく、100% の下限は docx の `kuromoji-phrase` で抽出が正しくても落ちる。
- ベンチマークで Python 版を下回った形式が出た場合は、Req 2.14 のとおり、原因を調べて記録し、直すか受け入れるかをユーザーに諮る (勝手に受け入れない)。

## 14. PDF の部品の選定 (T1、タスク 3.1)

2026-11-05 に devcontainer (Node 24.21.0、Intel i7-12650H 16 コア、Linux) で、使い捨ての場所 (scratchpad) に候補を入れて試した結果。抽出サービスの package、lockfile、`pnpm-lock.yaml`、本番の `src/`、Python 版は変えていない。数字はすべて **実測** (書いていないものは「未検証」と明記)。Node の slim image の中では測っていない。

### 14.1 結論

- **採る部品: `@embedpdf/pdfium` 2.15.1** (npm の package 名。PDFium を WebAssembly (WASM) にしたもの。MIT。中の PDFium は BSD-3-Clause)。`/readyz` の `dependencies` に出す実名 (design.md の D2) もこの名前にする。
- ベンチマークの PDF 3 個で、(a)〜(d) のすべての指標が Python 版のベースライン (13 節) と同じ (語句 21/21 が `exact`、位置 6/6、文字化け・分断・混入 0、kuromoji-phrase 21/21)。**ベースラインを下回る指標は無い**ので、ユーザーに諮る必要は無い (Req 2.12、2.14)。
- 対象 spec の PDF の AC (1.4、1.9、1.10、1.11、1.12) と、ページ数の上限の扱いを、Python 版のテスト (`tests/conversion/test_pdf.py`) と同じ入力で確かめ、**すべて Python 版と同じ結果**になった (14.4)。
- 同じ水準を満たした候補は、ほかに `@hyzyla/pdfium` 3.0.0 (WASM) と `pdfium-native` 0.10.0 (ネイティブ) があった。選んだ理由と選ばなかった理由は 14.6。

### 14.2 比べた候補

ライセンスは npm の `license` の欄と、同梱のライセンスのファイルで確かめた。GPL / AGPL の部品は候補にしていない。

| 候補 (版) | 中身 | ライセンス | 扱い |
|---|---|---|---|
| `@embedpdf/pdfium` 2.15.1 | PDFium の WASM。PDFium の C の関数 (`FPDF_*`) をそのまま呼ぶ形 | MIT (同梱の `LICENSE`)。PDFium は `LICENSE.pdfium` (BSD-3-Clause と Apache-2.0 の本文) | 測った。**採る** |
| `@hyzyla/pdfium` 3.0.0 | PDFium の WASM。ページや文書のクラスで包んだ形 | MIT | 測った |
| `pdfium-native` 0.10.0 | PDFium (chromium/7749) のネイティブの共有ライブラリと、N-API (Node のネイティブ部品の仕組み) の部品 | MIT。PDFium は BSD-3-Clause (`THIRD-PARTY-NOTICES.md`) | 測った |
| `pdfjs-dist` 6.5.438 | Mozilla の pdf.js (JavaScript だけで書かれている)。Node では `legacy/build/pdf.mjs` を使う | Apache-2.0 | 測った |
| `@firecrawl/anydoc` 0.2.4 の PDF | Rust の pdf-inspector。`toMarkdownBytes(bytes, 'pdf')` | MIT | 測った (11.8 の観察の取り直し) |
| `pdfium-node` 1.2.1 | PDFium のネイティブ部品 | MIT | 測らずに外した。README の Known Limitations に「テキストの取り出しは対象外」「パスワード付きの PDF は拒否」とある。部品は linux x64 と macOS arm64 だけ |
| `unpdf` 2.1.0、`pdf-parse` 2.4.5 | 中身は pdf.js | MIT / Apache-2.0 | `pdfjs-dist` と同じ中身なので、別には測っていない |
| `mupdf` 1.28.1 | MuPDF の WASM | AGPL-3.0-or-later | ライセンスが許容的でないので対象外 |

Python 版の `pypdfium2` 5.14.0 が使っている PDFium は `156.0.8076.0` (chromium/8076)。`pdfium-native` は chromium/7749。**WASM の 2 つの中の PDFium の版は、package の中に書かれておらず、分からなかった (未検証)**。

### 14.3 比べ方

- 各候補を同じ形の小さな関数 (文書を開く → ページ数を見る → ページごとにテキストを取る → 閉じる) で包み、その後ろに **Python 版と同じ正規化** をかけた。正規化は `services/attachment-text-extractor/src/app/conversion/normalize.py` を 1 字も変えずに写した: 改行を LF にそろえる (`normalize_newlines`)、日本語の字の間の 1 字分の空白または改行を取り除く (`join_broken_japanese`。字の範囲は `ぁ-ゖゝ-ゟァ-ヺー-ヿ㐀-䶿一-鿿々`、`u` フラグ付きの正規表現で同じ先読み・後読み)。そのうえで `core.py` の `_assemble` と同じく、空のページは捨て、全部が空なら `pageNumber` / `label` が null の要素を 1 つだけ返す。
- **正解の文字列**: Python 版の `convert_pdf` と `_assemble` を、サービスを起動せずに `.venv/bin/python -I` から直接呼んだ出力。候補の出力を、ファイルごと・ページごとにこれと比べた。Python 版の出力をベンチマークで採点すると、13 節のベースラインの PDF の行と同じ値になった (比べ方が正しいことの確認)。
- **ベンチマーク**: 候補ごとの `pages[]` を、`apps/attachment-text-extractor/benchmark/` の採点の関数 (`scoreDocument`、`summarizeByFormat`) と `answers.json` で採点し、`baseline/python-baseline.json` の PDF の行と比べた。Elasticsearch の段 (d) は、同じ道具の `measureEsRecall` を `http://elasticsearch:9200` (9.3.3、kuromoji と ICU あり) に向けて測った。測った後、`_cat/indices/benchmark-*` が空であることを確かめた。
- **AC の確認の入力**: 2.4 の生成器 (`test/fixtures/`) で作った。3 ページの英字の PDF、ユーザーパスワード付き (`buildUserPasswordPdf`)、所有者パスワードだけ (`buildOwnerPasswordOnlyPdf`)、壊れた PDF (`buildCorruptPdf`)、ゴミの PDF (`buildGarbagePdf`)、ヘッダーの後に `TOPSECRET-BODY` を書いたもの (`pdfHeaderFollowedBy`)、空のバイト列、`not a pdf at all`、画像だけの PDF (`buildImageOnlyPdf`)、日本語の 2 行 (`buildJapaneseLinesPdf(['日本','語です'])` と `(['日本','ABC'])`)、`Hello world`、4 百万字の 1 ページ (`buildLongPagePdf`)。
- **最大 RSS**: 子の最後に自分の `/proc/self/status` の `VmHWM` (そのプロセスの実メモリの最大値) を読んだ。Python は `getrusage` の `ru_maxrss`。Python の値はサービスの子ではなく、取り出しの関数 (`convert_pdf` と `_assemble`) **だけ**を、1 つの入力ごとに新しいプロセスで呼んだときの値 (2 回測って同じ値)。正解の文字列を作るときは、比べるために同じプロセスで PDFium の生の出力ももう一度取り出しているので、そのプロセスの RSS は取り出し 2 回分になり、ここには使わない。
- **必要な仮想メモリ**: `/usr/bin/prlimit --as=N -- node …` で子を動かし、上限なしのときと同じ結果で正常に終わる最小の N を、64MiB 刻みの二分探索で求めた。見つけた値で 3 回続けて動くことも確かめた。
- **時間**: 子を起動してから終わるまでの時間 (親から見た時間) の中央値 (11 回)。中身の内訳として、部品の読み込み (WASM の準備を含む) と、変換だけの時間も子の中で測った。

### 14.4 結果: ベンチマークと AC

**(1) ベンチマークの PDF の指標** (コーパスの 3 個、語句 21 個。列の意味は 12.3)

| 候補 | 再現率 (そのまま / 空白を除く) | 要素の数が正しい文書 | 番号とラベルが正しい要素 | 正しい位置にある語句 | 別の位置に出た語句 | U+FFFD / 元の文に無い文字 | 分断 (4 列の合計) | kuromoji-phrase (正しい位置) | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| Python 版 (ベースライン) | 21 / 21 | 3/3 | 6/6 | 21/21 | 0 | 0 / 0 | 0 | 21/21 | — |
| `@embedpdf/pdfium` | 21 / 21 | 3/3 | 6/6 | 21/21 | 0 | 0 / 0 | 0 | 21/21 | 下回らない |
| `@hyzyla/pdfium` | 21 / 21 | 3/3 | 6/6 | 21/21 | 0 | 0 / 0 | 0 | 21/21 | 下回らない |
| `pdfium-native` | 21 / 21 | 3/3 | 6/6 | 21/21 | 0 | 0 / 0 | 0 | 21/21 | 下回らない |
| `pdfjs-dist` | 21 / 21 | 3/3 | 6/6 | 21/21 | 0 | 0 / 0 | 0 | 21/21 | 下回らない |
| anydoc | 15 / 15 | 1/3 | 0/6 | 9/21 | 6 (別の位置にだけ) | 0 / 0 | 0 | 9/21 | **下回る** |

growi-quoted-phrase も、anydoc 以外は 21/21 (正解以外の位置に当たった語句 0)。

文字列として Python 版と比べると:

- `@hyzyla/pdfium` と `pdfium-native` は、すべての入力で Python 版と **1 字も違わなかった**。
- `@embedpdf/pdfium` は、縦書きの PDF の 2 ページ目だけが違った。`昭和五十年　横浜市にて創業` のように、**元の文にある全角の空白 (U+3000) が残る** (Python 版は消える)。元の HTML にはこの全角の空白があるので、元の文に近いのは `@embedpdf/pdfium` の方。採点では空白として扱われ (12.3)、語句の判定にも Elasticsearch の検索にも影響しなかった。PDFium の版の違い (14.2 のとおり版は未検証) によると考えられる。
- `pdfjs-dist` は、縦書きの 1 ページ目で句点 `。` の前に改行が入った (`…感謝申し上げます\n。`)。語句には影響しなかった。

**正規化の効き方 (正規化をかけない場合の確認)**: 正規化をかけずに採点すると、PDFium の 3 つと Python 版は、語の途中で改行する PDF の 4 語句がすべて「分断 (改行の位置)」になる (語句そのままの再現率 17/21)。つまり語の途中の改行は、部品ではなく、Python 版から写した正規化でつながっている。`pdfjs-dist` は、これに加えて縦書きの 6 語句も分断になる (縦書きを **1 字ずつ改行で区切って** 返し、正規化で日本語の字の間の改行が消えてつながる)。

**(2) 対象 spec の AC と、ページ数の上限** (Python 版の `test_pdf.py` と同じ入力)

| 確かめたこと (対象 spec の AC) | Python 版 | `@embedpdf/pdfium` | `@hyzyla/pdfium` | `pdfium-native` | `pdfjs-dist` | anydoc |
|---|---|---|---|---|---|---|
| 3 ページ → ページごとに 1 要素、`pageNumber` 1〜3、`label` "1"〜"3" (1.4) | 通る | 通る | 通る | 通る | 通る | **ページに分かれない** (1 要素) |
| 改行が LF だけ、日本語の間の改行を詰める・日本語と ASCII の間は残す・ASCII だけの文は変えない (1.9) | 通る | 通る | 通る | 通る | 通る | 見出しの記号 (`## `) と空行が入る |
| ユーザーパスワード付き → `encrypted` (1.10) | 通る | 通る (`FPDF_GetLastError` が 4) | 通る | 通る (`PDFiumPasswordError`) | 通る (`PasswordException`) | 通る (`encrypted`) |
| 所有者パスワードだけ → 3 ページ読める (1.12) | 通る | 通る | 通る | 通る | 通る | 読めるがページに分かれない |
| 壊れた PDF・ゴミ・ヘッダーの後がゴミ・空・PDF でないもの → `malformed` (1.11) | 通る | 通る | 通る | 通る | 通る | 通る |
| 画像だけ → 中身が空の 1 要素 (`pageNumber` と `label` は null) | 通る | 通る | 通る | 通る | 通る | **失敗** (`needsOcr` のエラー) |
| ページ数が上限ちょうど (3 ページで上限 3) は通り、上限 2 は `limit_exceeded` | 通る | 通る | 通る | 通る | 通る | ページ数が取れない |
| ページを読む前にページ数が取れる (細工した巨大なページの木で時間とメモリを使わせないため) | `len(document)` | `FPDF_GetPageCount` | `getPageCount()` | `doc.pageCount` | `doc.numPages` | 取れない |
| ToUnicode の表で字を U+0000 に対応づけた PDF (`buildJapaneseLinesPdf(['日本\u0000語です'])`) で、後ろの字が落ちない | `日本` + U+FFFE + `語です` | 同じ | 同じ | 同じ | 測っていない | 測っていない |

- 失敗の詳細の文には、決まった文だけを入れる (Python 版と同じ方針)。部品が出す文は使わない。`TOPSECRET-BODY` を書いた入力でも、詳細に中身は入らなかった。
- `@embedpdf/pdfium` で開けなかったときの `FPDF_GetLastError` の値は、ユーザーパスワード付きが 4 (`FPDF_ERR_PASSWORD`)、壊れた PDF・ゴミ・PDF でないもの・空のバイト列が 3 (`FPDF_ERR_FORMAT`) だった。空のバイト列も特別扱いなしで `malformed` になる。`@hyzyla/pdfium` は空の入力に PDFium に渡す前に独自の文で例外を投げるので、自分で `malformed` に対応づける必要がある。

### 14.5 結果: メモリ・時間・大きさ

**(1) 子の最大 RSS** (`VmHWM`。Python は `ru_maxrss`)

| 入力 | Python 版 | `@embedpdf/pdfium` | `@hyzyla/pdfium` | `pdfium-native` | `pdfjs-dist` | anydoc |
|---|---|---|---|---|---|---|
| 読み込むだけ (変換しない) | — | 73MB | 71MB | 52MB | 83MB | 51MB |
| 横書きの PDF (`pdf-ja-horizontal.pdf`) | 43MB | 80MB | 72MB | 55MB | 107MB | 56MB |
| 100 万字の 1 ページ | 152MB | 179MB | **249MB** | 165MB | — | — |
| 200 万字の 1 ページ (3 回とも同じ値) | 263MB | 284MB | **424MB** | 278MB | — | — |
| 4 百万字の 1 ページ (`buildLongPagePdf`) | 484MB | 491MB | **778MB** | 502MB | 135MB (※) | 94MB (※) |
| 4 百万字の 1 ページ (全部の行をページの内側に置いたもの。※) | 483MB | 490MB | — | — | 162MB | 123MB |
| 8,000 字 × 500 ページ (合計 4 百万字) | 56MB | 104MB | 102MB | 82MB | — | — |
| 48MiB の PDF (12 ページ、各ページに 4MiB の無圧縮の画像と 1 行の文。2 回とも同じ値) | 138MB | 222MB | 236MB | 246MB | — | — |

- 普通のファイル (横書きの PDF) では、どの候補も `MAX_CHILD_RSS_MB` 320 の 0.95 倍 (304MB) に十分収まる (design の T1 の基準)。
- **ファイルが大きい PDF では、Node の候補はどれも Python 版より 85〜110MB ほど多い**。48MiB の PDF (`MAX_FILE_SIZE_MB` 50 の内側。対象 spec の基準の「画像 12 枚の 48MB の DOCX」と同じ性格の入力として作った) で、Python 版 138MB に対し、`@embedpdf/pdfium` 222MB、`@hyzyla/pdfium` 236MB、`pdfium-native` 246MB。Node 側でファイルを読んだ Buffer と、部品に渡す写し (WASM のメモリへの写し、または `Buffer.from` の写し) が同時にあるためと見られる (内訳は未検証)。どれも 304MB の内側で、`@embedpdf/pdfium` が Node の候補の中で最も少ないので、選定は変わらない。ただし余裕は 82MB で、実際のサービスでは本文の受け取りのしかた (3.3) で写しが増えうるので、3.7 で子に anydoc も読み込んだ状態で測り直す。
- **`@hyzyla/pdfium` は、字の多い 1 ページで Python 版の約 1.6 倍のメモリを使う** (100 万字で 249MB 対 152MB、200 万字で 424MB 対 263MB)。200 万字の 1 ページは、Python 版なら 320MB の上限の内側で読めるが、`@hyzyla/pdfium` では上限を超えて `memory_exceeded` になる。Python 版で読めていた PDF が読めなくなる。原因 (WASM の作り方の違い。メモリの確保の仕方など) は調べていない (未検証)。
- **`@embedpdf/pdfium` も、字の多い 1 ページで Python 版より約 20〜27MB (約 8〜18%) 多い** (100 万字で 179MB 対 152MB、200 万字で 284MB 対 263MB)。`pdfium-native` も同じくらい多い (165MB、278MB)。2 点から直線で外挿すると (外挿で、実測ではない)、320MB に達するのは Python 版が 1 ページ約 250 万字、`@embedpdf/pdfium` が約 235 万字、`pdfium-native` が約 237 万字。つまり **1 ページ約 235 万〜250 万字の狭い範囲では、Python 版は読めるが `@embedpdf/pdfium` は `memory_exceeded` になる**。これはベンチマークの指標 (Req 2.12) でも対象 spec の AC でもない (AC は上限を超えたら止めることを求めるだけ) ので、ユーザーには諮らず、3.7 への引き継ぎにする (14.8)。`pdfium-native` もほぼ同じなので、候補の順位は変わらない。
- 4 百万字の 1 ページは、Python 版も含めて PDFium の 3 つはどれも 320MB を超える。Python 版のテスト (`test_child_isolation.py` の `test_a_pdf_page_with_four_million_characters_is_stopped_and_the_next_run_succeeds`) が期待する `memory_exceeded` は、`@embedpdf/pdfium` でも変わらない見込み (4.x でテストを写すときに、子に anydoc も読み込んだ状態で確かめる)。
- (※) `buildLongPagePdf` は 1 行ごとに 1pt ずつ下へずらして 4,000 行を書くので、y=0 より下の約 3,300 行は **ページの外** に置かれている。`pdfjs-dist` はこのページで (空白以外) 681,372 字、anydoc は (空白以外) 707,000 字 (総文字数は 682,072 字と 707,707 字) しか返さなかったが、これはページの内側 (y=700〜0) の行だけを返し、ページの外の字を返さないため。同じ 400 万字をすべてページの内側に置いた PDF (0.1pt の字で、行の間を 0.17pt にしたもの) では、`pdfjs-dist` も anydoc も空白以外の字を 4,000,000 字すべて返した (`@embedpdf/pdfium` と Python 版も同じ)。つまり「ページの外に置かれた字を返さない (PDFium と Python 版は返す)」という振る舞いの違いで、字を黙って落とす不具合ではない。`buildLongPagePdf` の行の `pdfjs-dist` と anydoc の RSS は、取り出した量が違うので他の候補と比べられない。

**(2) 必要な仮想メモリ** (`prlimit --as` で正常に動く最小値。64MiB 刻み。3 回続けて動くことを確かめた)

| 入力 | `@embedpdf/pdfium` | `@hyzyla/pdfium` | `pdfium-native` | `pdfjs-dist` | anydoc |
|---|---|---|---|---|---|
| 読み込むだけ | 1,472MiB | 1,472MiB | 1,152MiB | 2,560MiB (この値では 3 回のうち失敗あり) | 1,152MiB |
| 横書きの PDF | 1,472MiB | 1,472MiB | 1,472MiB | 3,712MiB | 1,472MiB |
| 4 百万字の 1 ページ | 2,048MiB | 2,560MiB | 2,176MiB | 3,712MiB | 1,600MiB |
| 48MiB の画像の多い PDF | 1,664MiB (1,600MiB では abort) | — | — | — | — |

- 何もしない Node は 1,150MiB で動き、1,100MiB では動かなかった (1.4 の「1,200MB」とほぼ合う)。
- **1.4 の「PDFium の WASM は 3,000MB 以上が要る」は再現しなかった**。上限を掛けないと、WASM の 2 つは仮想メモリの予約が約 9.6GB (`VmPeak`) になる (V8 が WASM のメモリの前後に、範囲外の読み書きを捕まえるための大きな領域を予約する)。上限を掛けると V8 は予約を小さくして動き、普通のファイルは 1,472MiB、4 百万字の 1 ページは `@embedpdf/pdfium` で 2,048MiB で動いた。上限 3GiB で動かしたときの変換の時間は、上限なしに比べて約 1 割遅かった (横書きの PDF 10.1ms → 11.6ms、4 百万字 938ms → 1,019ms)。予約を小さくしたときに V8 が範囲の確認をどう行っているか (遅くなる理由) は確かめていない (未検証)。
- Node の `--disable-wasm-trap-handler` (範囲外の読み書きを、予約した領域ではなく命令で確かめる設定) を付けても、最小値は変わらなかった。付ける必要は無い。
- **上限が足りないときの落ち方**: `RLIMIT_AS` の下で WASM のメモリを増やせないとき、プロセスが OS に殺されるのではなく、JavaScript の例外になる。48MiB の PDF を上限 1,600MiB で読むと、PDFium の中で `RuntimeError: Aborted(native code called abort())` が投げられた。標準エラーには `growMemory: … Unable to grow instance memory` の行が出る。また、埋め込まれた `malloc` は失敗しても例外を投げずに **0 を返す** (上限 1,472MiB で `malloc(1.5e9)` が 0)。0 を確かめずに使うと、入力が WASM のメモリより大きければ `RangeError: offset is out of bounds` で落ち、小さければ 0 番地から書き込んで PDFium の内部のデータを壊したまま動き続ける (上限 1,472MiB で、`malloc` が 0 を返した後に 0 番地へ短いバイト列を書くと、例外なしに先頭の 16 バイトが書き換わることを確かめた)。14.10 の関数は 0 を確かめて内部の失敗にする。
- 上限の値そのものは 3.6 で、anydoc と T6 の部品も合わせて決める。

**(3) 時間** (中央値、11 回)

| | 子の起動から終了まで (読み込むだけ) | 同 (横書きの PDF を変換) | うち部品の読み込み | うち変換 |
|---|---|---|---|---|
| 何もしない Node | 20.1ms | — | — | — |
| `@embedpdf/pdfium` | 51.7ms | 69.1ms | 27.4ms | 9.8ms |
| `@hyzyla/pdfium` | 53.0ms | 69.3ms | 28.3ms | 10.2ms |
| `pdfium-native` | 28.5ms | 34.2ms | 4.3ms | 3.1ms |
| `pdfjs-dist` | 84.0ms | 148.9ms | 58.5ms | 61.9ms |
| anydoc | 28.1ms | 31.8ms | 2.6ms | 3.9ms |

- WASM の 2 つは、読み込み (WASM の翻訳と準備) に約 27ms かかる。子は 1 件ごとに作り直す (design の判断。常駐させない) ので、**PDF の要求 1 件ごとに約 35ms 上乗せ**される (`pdfium-native` との差)。PDF の部品は PDF のときだけ読み込むようにすれば、ほかの形式には上乗せされない (読み込み方は 6.x の実装で決める)。
- 4 百万字の 1 ページの変換は、PDFium の 3 つと Python 版で約 0.9〜1.0 秒とほぼ同じ。

**(4) 大きさ** (`du`。依存を含む)

| 候補 | node_modules の大きさ | 主なもの |
|---|---|---|
| `@embedpdf/pdfium` | 7.2MB | `pdfium.wasm` 4.6MB。依存なし |
| `@hyzyla/pdfium` | 13.5MB | `pdfium.wasm` 5.3MB と、同じものを base64 にした JS 7.1MB の二重持ち。依存なし |
| `pdfium-native` | 9.3MB + 依存 0.4MB | `libpdfium.so` 6.7MB、`pdfium.node` 0.5MB。依存は `node-addon-api` (ソースから作るときの部品)、`p-limit` |
| `pdfjs-dist` | 35.9MB | CMap、標準フォント、画像の復号の部品など |
| anydoc (参考。すでに依存にある) | 7.8MB (linux x64 の部品) | |

### 14.6 選んだ理由と、選ばなかった理由

PDFium を使う 3 つ (`@embedpdf/pdfium`、`@hyzyla/pdfium`、`pdfium-native`) は、ベンチマークと AC の両方で Python 版と同じだった。そこで、品質以外の点で比べた。

**`@embedpdf/pdfium` を選んだ理由**

1. **メモリ**: Node の候補の中では、`pdfium-native` と並んで少ない。字の多い 1 ページでは Python 版より約 20〜27MB 多く (200 万字で 284MB 対 263MB)、1 ページ約 235 万〜250 万字の狭い範囲だけは Python 版が読めて `@embedpdf/pdfium` が上限を超える (外挿。14.5 の (1))。`@hyzyla/pdfium` (約 1.6 倍) のように 200 万字のページで上限を超えることはない。ファイルの大きい PDF (48MiB) では Python 版より多いが、Node の候補の中では最も少ない (222MB)。
2. **install の時の処理が無い**: npm の package に WASM の本体が入っているだけで、install の時にファイルを取りに行く処理も、ソースから作る処理も無い。このリポジトリは `pnpm-workspace.yaml` の `allowBuilds` で install の時の処理を許可制にし、`sharp` のように「CPU ごとの完成品を optional の依存で配る」部品は処理を止めて使っている。`@embedpdf/pdfium` ならこの方針のままで入れられ、開発者全員の `pnpm install` と CI にも、ネットワークやコンパイラの条件が増えない。
3. **CPU を選ばない**: WASM なので、linux の x64 でも arm64 でも同じファイルが動く。
4. **守りが 1 段増える**: PDFium は C++ で書かれていて、細工した PDF で PDFium の中のメモリが壊れる種類の不具合が起きうる。WASM の中で動くと、壊れるのは WASM の中のメモリだけで、子のプロセスのほかの部分には届かない。子プロセスで隔離する守り (Req 3 の上限) はそのまま残る。
5. **エラーの種類を公開の関数で取れる**: `FPDF_GetLastError` を直接呼べるので、パスワード (4) とセキュリティ (5) を Python 版と同じ数値で区別できる。
6. **小さい**: 7.2MB で、測った候補の中で最も小さい。
7. **使われている量**: `npm view` と npm の downloads API (2026-11-05 に確認) で、`@embedpdf/pdfium` は 2025-03-19 に作られ、89 版あり、直近 1 週間のダウンロードは 1,428,509 回。PDF の表示の部品 (embed-pdf-viewer) の一部として作られている。npm の maintainer は 1 人 (bobsingor)。比べると `pdfium-native` は 2026-03-28 に作られたばかりで 25 版、1 週間 3,390 回 (maintainer 1 人、xonaman)。`@hyzyla/pdfium` は 2023-06-09 から 25 版、1 週間 911,253 回 (maintainer 1 人、hyzyla)。どれも maintainer は 1 人なので、版は固定し、上げるときはベンチマークを回す。

代わりに受け入れること:

- PDF の要求 1 件ごとに約 35ms 遅くなる (14.5 の (3))。design の Risks の「WASM の読み込みで起動が遅くなる」にあたり、常駐する子は隔離の理由で採らない方針どおり受け入れる。
- PDFium の C の関数をそのまま呼ぶので、WASM のメモリの確保と解放 (入力の PDF を WASM のメモリに写す、テキストの受け取りの領域を取る) を自分のコードで書く必要がある (試作では約 40 行)。PDF の入力のメモリは、文書を閉じるまで解放してはいけない (`FPDF_LoadMemDocument` はそのメモリを読み続ける)。
- 中の PDFium の版が分からない (14.2)。版を上げたときに出力が変わったかは、ベンチマークを回して確かめる (13.8 の 5 の運用の基準)。
- 本来はブラウザ向けの package。Node では WASM のファイルを自分で読んで `init({ wasmBinary })` に渡す形で動いた。渡さない場合でも、Node では package の中の `pdfium.wasm` をファイルとして読むコードになっている (コードを読んで確認。ネットワークを止めた状態では確かめていない)。外向きの通信を起こさないよう、本番では必ず `wasmBinary` を渡す。

**選ばなかった理由**

- **`@hyzyla/pdfium` 3.0.0**: 字の多い 1 ページで Python 版の約 1.6 倍のメモリを使い、200 万字の 1 ページが 320MB の上限を超える (14.5 の (1))。Python 版で読めていた PDF が読めなくなる。ほかに、エラーの種類を取るには公開されていない `module` の欄 (`library.module._FPDF_GetLastError()`) を使うか、例外の文で見分けるしかない。WASM の本体を二重に持つので大きい (13.5MB)。出力の文字列は Python 版と完全に同じで、API も扱いやすかった。
- **`pdfium-native` 0.10.0**: 最も速く (PDF の要求 1 件で約 35ms 速い)、メモリも少なく、出力も Python 版と完全に同じだった。選ばなかったのは、**install の時に GitHub の release から完成品を取りに行く処理 (`scripts/install.mjs`) を持ち、無ければソースからコンパイルする** ため。採ると `allowBuilds` で許可する必要があり、許可すると開発者全員の `pnpm install` と、この package を含む CI のすべてが GitHub の release に依存する。許可しなければ部品が入らず動かない。Docker のビルドでも外への通信が要る (動いている間の外向き通信は要らないので、AC 1.7 には反しない)。また、ネイティブの PDFium が子のプロセスの中で直接動く (Python 版と同じ危険の度合い)。採る場合は `allowBuilds` の判断をユーザーに諮ることになる。
- **`pdfjs-dist` 6.5.438**: ベンチマークは満点だった。ページの外に置かれた字は返さない (PDFium と Python 版は返す。14.5 の (1) の ※)。縦書きを 1 字ずつ改行で区切って返すため、縦書きの中の数字や英字 (例: `年1回`) は、日本語の字の間だけを詰める正規化ではつながらず、分断になると見込まれる (コーパスに例が無く、未検証)。部品の読み込みと変換が遅く (子 1 件 149ms)、仮想メモリも多く要り (3,712MiB)、package も大きい (35.9MB)。採る場合は、フォントの中の命令を `eval` で動かす機能を切る設定 (`isEvalSupported: false`。pdf.js の任意のコードを動かせる脆弱性 CVE-2024-4367 の対策) と、フォントを埋め込まない日本語の PDF のための CMap の場所 (`cMapUrl`) を必ず渡す必要がある。
- **anydoc の PDF**: ページに分かれない (AC 1.4 を満たせない)、縦書きの字の順が崩れる (縦書きの語句 0/6)、画像だけの PDF をエラーにする (`needsOcr`)。ベンチマークで下回る (14.4 の (1))。正規化をかける前の出力では、語の途中の改行に空白が入る (`基幹シス テム`。11.8 と同じ)。
- **`pdfium-node` 1.2.1**: テキストを取り出す API が無い (14.2)。

### 14.7 縦書きなど、どの候補でも取れないもの

- コーパスの縦書きの PDF は、PDFium の 3 つと `pdfjs-dist` で正しい順に読めた。**どの候補でも取れない、または Python 版より劣る PDF は、このコーパスには無かった**。前処理や別の読み方は要らない。
- 縦書きで劣るのは anydoc だけ。anydoc は PDF には使わない (design のとおり、PDF は T1 の部品でページごとに読む)。
- 確かめていないこと: 縦書きの中に数字や英字が混じる PDF、Word や PowerPoint が書き出した日本語の PDF、フォントを埋め込まない日本語の PDF (11.11、13.10 と同じく、コーパスの外)。PDFium の 3 つは同じ PDFium なので同じ傾向と見込むが、版の違い (U+3000 の扱いの違いのように) はありうる。

### 14.8 後のタスクへの引き継ぎ

- **3.6 (仮想メモリの上限)**: `@embedpdf/pdfium` は普通の PDF で 1,472MiB、48MiB の画像の多い PDF で 1,664MiB、4 百万字の 1 ページで 2,048MiB あれば動く (14.5 の (2)。最大は 4 百万字の 2,048MiB)。上限を掛けると V8 は WASM の予約を小さくするので、上限は「3GB 以上」にしなくてよい。上限を掛けたときの約 1 割の遅れも 3.6 の材料にする。上限が足りないと、WASM のメモリを増やせないことが `RuntimeError: Aborted` や `RangeError` の **例外** として出て、プロセスは殺されない (`malloc` は 0 を返す)。子はこれを捕まえて内部の失敗として返すことになるので、`RLIMIT_AS` を最後の歯止めとして見るときは「例外で終わる」前提で考える。
- **3.7 (RSS の基準値)**: 200 万字の 1 ページで 284MB (Python 版は 263MB)、4 百万字で 491MB、48MiB の画像の多い PDF で 222MB (Python 版は 138MB)。PDF は文字の多さとファイルの大きさでメモリが増えるので、PDF の基準のファイル (48MiB 級の PDF と、字の多い 1 ページ) を足すかどうかを 3.7 で考える。どちらも、子に anydoc も読み込み、本文を 3.3 で選ぶ方法で受け取った状態で測り直す。1 ページ約 235 万〜250 万字の範囲で Python 版は上限の内側、`@embedpdf/pdfium` は外になる見込み (外挿) なので、測り直した値でこの範囲を確かめ、検索の対象になる PDF の範囲の変化として記録する。
- **3.8 (package に入れる)**: `@embedpdf/pdfium@2.15.1` を版を固定して入れる。package の中のライセンスのファイルは `LICENSE` (MIT) と `LICENSE.pdfium` (PDFium の BSD-3-Clause と Apache-2.0) だけで、WASM の中に入っている FreeType・OpenJPEG・zlib・libpng などの第三者のライセンスの文は同梱されていない (WASM の中の文字列に名前がある)。3.8 でライセンスを確かめるときに、これらがすべて許容的なライセンス (FreeType は FTL を選べる) であることと、表示の要否を確かめる (未検証)。
- **6.x (PDF の変換の実装)**: 使う関数は `init({ wasmBinary })`、`PDFiumExt_Init`、`FPDF_LoadMemDocument(ptr, size, '')`、`FPDF_GetLastError`、`FPDF_GetPageCount`、`FPDF_LoadPage`、`FPDFText_LoadPage`、`FPDFText_CountChars`、`FPDFText_GetText`、`FPDFText_ClosePage`、`FPDF_ClosePage`、`FPDF_CloseDocument`、`pdfium.wasmExports.malloc` / `free`、`pdfium.HEAPU8`。`malloc` は失敗すると 0 を返す (例外にならない) ので、必ず 0 を確かめて内部の失敗 (`internal`。Python 版で `MemoryError` が `internal` になるのと同じ扱い) にする。PDFium の中の `abort` は `RuntimeError` として投げられるので、これも `internal` になる。WASM のメモリを増やせなかったときの `growMemory: …` の行は標準エラーに出る (ファイルの中身は含まない)。`FPDF_GetLastError` が 4 (`FPDF_ERR_PASSWORD`) と 5 (`FPDF_ERR_SECURITY`) なら `encrypted`、それ以外で開けなければ `malformed`。WASM のファイルの場所は `require.resolve('@embedpdf/pdfium/pdfium.wasm')` (package の `exports` にある)。試作の取り出しの関数は 14.10 にある。
  - テキストの復号: 候補を比べた試作では emscripten の `UTF16ToString` を使ったが、この関数は U+0000 の字で読むのをやめる。U+0000 に対応づけた字は PDFium が U+FFFE に置き換えて返したので、試作の入力では字は落ちなかった (14.4 の (2))。ただ、PDFium がほかの経路で U+0000 を返さないとは確かめていないので、14.10 の関数は `FPDFText_GetText` が返した長さ (終わりの NUL を含む UTF-16 の単位の数) で `HEAPU8` の範囲を切り、`TextDecoder('utf-16le')` で復号する形にした (`@hyzyla/pdfium` と同じ形)。本番もこの形にする。
- **4.x (テストの書き換え)**: Python 版の `test_pdf.py` の期待値は、`@embedpdf/pdfium` でもそのまま成り立つ (14.4 の (2))。縦書きの全角の空白 (14.4 の (1)) は、ベンチマークの合否には影響しないが、Python 版との出力の比較 (Req 2.2) では違いとして記録する。

### 14.9 RED (選定の前の状態と、最初に失敗した試作)

- 選定の記録が無かった: `grep -c "^## 14\." research.md` は `0`。未決事項の表の「PDF のライブラリ」は「未決」だった。
- 最初に失敗した試作は anydoc の PDF。コーパスの縦書きの PDF の出力 (正規化の後) は `当皆創社様業社はの五地ご十長域支周社援年挨会にをと心迎拶とよえもりてに感歩謝ん申でしま上いげりまますし 。 た 。` で、採点は語句 `社長挨拶`・`創業五十周年`・`地域社会`・`横浜市`・`株式会社に改組`・`本社を川崎市へ移転` がすべて `missing`、要素の数は 1/2、PDF 全体で再現率 15/21・番号とラベルが正しい要素 0/6 (ベースラインはすべて満点)。画像だけの PDF は `needsOcr` のエラーになった。

### 14.10 再現の手順

使い捨ての場所 (以下 `$T`) で行う。リポジトリの中では `pnpm` 以外の install をしない。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$T/candidates" "$T/inputs" "$T/out" && cd "$T/candidates"
echo '{"name":"t1","private":true,"type":"module"}' > package.json
npm install --save-exact @embedpdf/pdfium@2.15.1 @hyzyla/pdfium@3.0.0 pdfjs-dist@6.5.438 @firecrawl/anydoc@0.2.4
npm install --save-exact pdfium-native@0.10.0   # install の処理で GitHub から完成品を取る
```

1. 入力を作る: `apps/attachment-text-extractor` で `node --import @swc-node/register/esm-register <スクリプト> "$T/inputs"`。スクリプトは `test/fixtures/index.ts` の生成器 (14.3 の一覧) で PDF を書き、`benchmark/corpus/` の PDF 3 個を写す。字の多いページは `test/fixtures/pdf.ts` の `buildPdf` で、`(aaa…1000 字) Tj 0 -1 Td` を 1,000 行 (100 万字)・2,000 行 (200 万字) 並べた 1 ページと、8 行のページを 500 枚並べたものを作る。
2. 候補ごとの取り出し: 14.3 の形 (開く → `pageCount` → ページごとにテキスト → 閉じる) の関数を候補ごとに書き、正規化と `_assemble` の動きを足し、ファイルごとの `{ok, pages}` または `{ok:false, kind}` と、最後に `/proc/self/status` の `VmHWM` を JSON で出す (`node extract.mjs <候補> <ファイル,…> [ページ数の上限]`)。
3. Python 版の正解: `services/attachment-text-extractor/.venv/bin/python -I <スクリプト>`。スクリプトは `sys.path` に `services/attachment-text-extractor/src` を足し、`app.conversion.pdf.convert_pdf` と `app.conversion.core._assemble` を呼んで同じ形の JSON を出す。Python 版の RSS は、これとは別に、この 2 つの関数だけを 1 つの入力ごとに新しいプロセスで呼び、`ru_maxrss` を読んで測る (比べるための生の出力の取り出しを同じプロセスでしない)。
4. 採点: `apps/attachment-text-extractor` で `node --import @swc-node/register/esm-register <スクリプト>`。スクリプトは `benchmark/answers.ts` の `loadBenchmarkAnswers`、`benchmark/scoring/index.ts` の `scoreDocument` / `summarizeByFormat`、`benchmark/elasticsearch/measure-es-recall.ts` の `probeElasticsearch` / `measureEsRecall` を import し、`baseline/python-baseline.json` の PDF の行と比べる。
5. 仮想メモリ: `/usr/bin/prlimit --as=<バイト> -- node extract.mjs …` を、上限なしと同じ結果になるかで二分探索する (64MiB 刻み)。
6. 後片付け: Elasticsearch の一時 index が残っていないこと (`curl http://elasticsearch:9200/_cat/indices/benchmark-*` が空) と、`git status` に変更が無いことを確かめる。

**採った部品の取り出しの関数 (試作)**: 6.x の実装の出発点として残す。この形のまま、14.4 の (2) のすべての入力で Python 版と同じ結果 (縦書きの全角の空白だけが違う) になり、ページ数の上限 2 で `limit_exceeded`、U+0000 の字の PDF でも後ろの字が落ちないこと、`malloc` が 0 を返す状況 (上限 1,472MiB の下で 48MiB の PDF を読む) で `RangeError` ではなく `internal` の失敗になること (上限なしでは 12 要素を読める) を確かめた。本番では TypeScript にし、失敗の種類は対象 spec の `ConversionError` の種類に合わせる。

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';

// Same character class as normalize.py's _JA (do not edit the ranges by hand).
const JA = 'ぁ-ゖゝ-ゟァ-ヺー-ヿ㐀-䶿一-鿿々';
const JA_GAP = new RegExp(`(?<=[${JA}])[ \\n](?=[${JA}])`, 'gu');
const toLf = (text) => text.replace(/\r\n?/g, '\n');
const normalize = (text) => toLf(text).replace(JA_GAP, '');

const FPDF_ERR_PASSWORD = 4;
const FPDF_ERR_SECURITY = 5;

// The embedded malloc returns 0 instead of throwing when WASM memory cannot grow
// (e.g. under RLIMIT_AS); writing through address 0 would corrupt PDFium state.
const allocate = (pdfium, size) => {
  const ptr = pdfium.wasmExports.malloc(size);
  if (ptr === 0) throw new PdfFailure('internal');
  return ptr;
};

export class PdfFailure extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

export const loadPdfium = async () => {
  const require = createRequire(import.meta.url);
  // Always pass the binary: never let the loader look for it elsewhere.
  const m = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  m.PDFiumExt_Init();
  return m;
};

const pageText = (m, doc, index) => {
  const { pdfium } = m;
  const page = m.FPDF_LoadPage(doc, index);
  if (!page) throw new PdfFailure('malformed');
  const textPage = m.FPDFText_LoadPage(page);
  try {
    const count = m.FPDFText_CountChars(textPage);
    if (count <= 0) return '';
    const ptr = allocate(pdfium, (count + 1) * 2);
    try {
      // Returns UTF-16 units written, including the terminating NUL.
      const units = m.FPDFText_GetText(textPage, 0, count, ptr);
      if (units <= 1) return '';
      return new TextDecoder('utf-16le').decode(pdfium.HEAPU8.subarray(ptr, ptr + (units - 1) * 2));
    } finally { pdfium.wasmExports.free(ptr); }
  } finally {
    m.FPDFText_ClosePage(textPage);
    m.FPDF_ClosePage(page);
  }
};

/** One element per page, as the Python service's convert_pdf + _assemble. */
export const extractPdf = (m, data, maxPages) => {
  const { pdfium } = m;
  const ptr = allocate(pdfium, data.length);
  pdfium.HEAPU8.set(data, ptr);
  try {
    // PDFium reads from ptr until the document is closed.
    const doc = m.FPDF_LoadMemDocument(ptr, data.length, '');
    if (!doc) {
      const code = m.FPDF_GetLastError();
      throw new PdfFailure(code === FPDF_ERR_PASSWORD || code === FPDF_ERR_SECURITY ? 'encrypted' : 'malformed');
    }
    try {
      const count = m.FPDF_GetPageCount(doc);
      if (count > maxPages) throw new PdfFailure('limit_exceeded');
      const pages = [];
      for (let i = 0; i < count; i++) {
        const content = normalize(pageText(m, doc, i));
        if (content !== '') pages.push({ pageNumber: i + 1, label: String(i + 1), content });
      }
      return pages.length > 0 ? pages : [{ pageNumber: null, label: null, content: '' }];
    } finally { m.FPDF_CloseDocument(doc); }
  } finally { pdfium.wasmExports.free(ptr); }
};
```

- 結果の合計の大きさの上限 (`MAX_RESULT_BYTES`) は、Python 版と同じく変換の層の外 (結果をまとめる所) で掛ける。この関数には入れていない。

### 14.11 確かめなかったこと

- Node の slim image の中での値 (時間、RSS、仮想メモリ)。
- サービス全体 (`POST /extract`) を通したベンチマーク (6.13 で行う)。ここでは変換の層だけを比べた。
- 子に anydoc と PDF の部品の両方を読み込んだときの RSS と起動の時間。
- WASM の 2 つの中の PDFium の版。`@hyzyla/pdfium` のメモリが多い原因。上限を掛けたときに WASM の変換が約 1 割遅くなる原因。
- ネットワークを止めた状態での `@embedpdf/pdfium` の初期化 (`unshare -n` が devcontainer で許されなかった)。
- Type3 のフォント (字の形を図形で描く方式) の PDF と、ToUnicode の表が欠けている・不完全な PDF での取り出し (11.3 のとおりコーパスは CIDFontType2 で作った)。
- 縦書きの中の数字・英字、Office が書き出した PDF、フォントを埋め込まない日本語の PDF、スキャンした画像の PDF (コーパスの外)。

### 14.12 3.7 への補足 (3.1 の 2 回目のレビュー)

- 外挿の「1 ページ約 235 万〜250 万字」は、実際に子を止める閾値 (`MAX_CHILD_RSS_MB` 320MB) で見たもの。design の余裕の基準 (0.95 倍 = 304MB) で見ると、範囲は約 220 万〜238 万字に下がる。3.7 で測り直すときに、この両方の基準で記録する。

## 15. 子プロセスの作り方 (T2、タスク 3.2)

2026-11-05 に devcontainer (Node 24.21.0、16 コア、Linux、util-linux 2.41.3 の `/usr/bin/prlimit`) で、使い捨ての場所 (scratchpad) に試作を作って確かめた結果。子の中身には `@firecrawl/anydoc@0.2.4` と `@embedpdf/pdfium@2.15.1` を npm で入れて使った。抽出サービスの package、lockfile、`pnpm-lock.yaml`、本番の `src/`、Python 版は変えていない。数字はすべて **実測** (書いていないものは「未検証」と明記)。Node の slim image の中では測っていない。

### 15.1 結論

- **採る方法: (A) `/usr/bin/prlimit` で包んだ `child_process.spawn`** (`spawn('/usr/bin/prlimit', ['--as=…', '--cpu=<soft>:<hard>', '--core=1', '--', process.execPath, <子の入口>], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], env: <明示したもの> })`)。fd 3 を結果の専用のパイプ、fd 4 を親を見張るパイプにする。コアダンプの上限は 0 ではなく 1 にする (理由は (d))。
- **親が先に終わったら子も終わる仕組みは、子の中に見張り専用の worker thread (Node のスレッド) を 1 つ立て、その worker 自身のイベントループで fd 4 を `net.Socket` として読み (止まる読み方の `fs.readSync` は使わない)、読み終わり (EOF) で `process.kill(process.pid, 'SIGKILL')` を呼ぶ形にする**。子のメインのスレッドが同期の処理 (PDFium の WASM、長い文字列の処理など) で止まっていても働く。Python 版の「見張りのスレッドから `os._exit`」と同じ考え方である。worker の中で止まる読み方 (`fs.readSync`) を使うと、子の `process.exit()` と捕まえていない例外による終了が返らなくなる (15.3)。
- 確かめた項目 (1)〜(9) はすべて満たした (15.4)。親を SIGKILL したとき、同期の処理で止まっている子 3 つが **3〜10ms で終わり**、孤児は残らなかった (基準は 1 秒)。
- **Python 版の振る舞いと違いが出る点** (対象 spec の AC を満たせなくなるものは無い。ただし (d) はユーザーの判断が要る):
  - (a) **見張りのスレッドの分だけ、子の RSS が約 12MB、必要な仮想メモリが約 64MiB 増える** (15.4 の (3)、(4))。worker の設定で `resourceLimits.codeRangeSizeMb: 4` を渡さないと、PDF の部品を読み込んだ子で必要な仮想メモリが約 576MiB 増える (1,472MiB → 2,048MiB)。3.6 と 3.7 の材料。
  - (b) **`RLIMIT_AS` に当たったときの失敗の種類が、場合によって変わる**。Python 版では `MemoryError` を捕まえて `internal` になった。Node 版では、`Buffer` や WASM のメモリを増やせない場合は例外 (`RangeError`) で `internal` になるが、JavaScript のヒープを増やせない場合と V8 の内部の予約が失敗した場合はプロセスが SIGABRT / SIGTRAP で終わり、`crashed` になる。どちらも HTTP の応答は 500 `extraction_failed` で同じ (対象 spec の表で `internal` と `crashed` は同じ行き先)。違うのは 1 件ごとのログの `result=` の値だけ。
  - (c) **`@embedpdf/pdfium` を読み込んだ子は、何もしないと `RLIMIT_AS` 3GiB でも JavaScript のヒープが RSS 約 126MB までしか増えない** (15.4 の (4))。原因は、`pdfium.wasm` が WASM のメモリの上限を 32,768 ページ (2,048MiB) と宣言しており、V8 がその分と範囲外の読み書きを捕まえる領域を、`RLIMIT_AS` の残りのほぼ全部を使って予約することにある。子の node の引数に `--wasm-max-mem-pages=8192` (512MiB) を渡すと、上限 3GiB でヒープが約 1,136MB まで増え、1 ページ 400 万字の PDF も変換できた。値は 3.6 で決める。T2 の選定は変えない。Python 版にはこの制約は無かった。
  - (d) **コアダンプの上限は `--core=0` ではなく `--core=1` にする (実測)**。この devcontainer の `/proc/sys/kernel/core_pattern` は `|/usr/share/apport/apport -p%p … -- %E` (コアをプログラムに渡す設定)、`core_pipe_limit` は 10 だった。この設定では `RLIMIT_CORE` の 0 は無視され、コアは渡し先のプログラムに送られる (man7.org の core(5): 「However, RLIMIT_CORE will be ignored if the system is configured to pipe core dumps to a program.」)。実測では、`--core=0` の子に SIGABRT / SIGSEGV / SIGXCPU を送ると、回収まで 73〜77ms かかった (コアを書かない SIGTERM は 2.4〜2.9ms)。`--core=1` では SIGABRT / SIGSEGV / SIGXCPU とも 2.7〜3.2ms で、SIGTERM と同じだった (15.4 の (1') の表)。カーネル (Linux v6.8 の `fs/coredump.c` の `do_coredump`) は、渡し先がプログラムのとき `cprm.limit == 1` を「再帰したクラッシュを止めるための特別な値」として扱い、警告を 2 行ログに出してコアを作らずに終わる (ソースの引用は 15.4 の (1'))。ファイルに書く設定のときは、`cprm.limit < binfmt->min_coredump` (ELF では `ELF_EXEC_PAGESIZE`、4,096 バイト) で書かない (ソースを読んだ。実測していない)。Python 版は `RLIMIT_CORE` を (0, 0) にするだけなので、プログラムに渡す設定ではコアが渡っていた見込みが高い (Python 版では測っていない)。**`--core=1` を採れば、Python 版より守りが強くなる。採るかどうかをユーザーに諮る**。代わりの方法として、コアダンプそのものを止める `prctl(PR_SET_DUMPABLE, 0)` は、Node の標準の機能には無い (ネイティブの追加部品を足せば呼べる)。`--core=1` で足りるなら追加部品は要らない。

### 15.2 比べた方法

| | (A) `prlimit` で包んだ `spawn` | (B) `fork` (または `spawn`) の後に親から `prlimit --pid` | (C) `sh -c 'ulimit …; exec node …'` |
|---|---|---|---|
| 上限が掛かる時点 | `prlimit` が自分に上限を掛けてから node を exec する (同じ PID)。node の起動の前 | 子が動き出した後。間に隙がある | 起動の前 |
| 子の自己確認で見えた上限 (15.4 の (1)) | 設定どおり (`prlimit` が node の exec の前に掛けるので、順序が仕組みで保証される) | 10 回すべて設定どおり (node の起動に約 18ms かかり、`prlimit --pid` は約 1.5ms で終わるため)。ただし順序の保証は無い | 試していない |
| 追加の部品・プロセス | `prlimit` の exec だけ (要求ごとに 1 プロセス) | 要求ごとに `prlimit --pid` のプロセスがもう 1 つ。隙を確実に塞ぐには、子が「上限を掛けた」の合図を待つ手順が要る。`fork` は IPC の通り道 (追加の fd と直列化) も作る | `sh` という別の外部コマンドが要る |
| Req 4.8 (外部コマンドは `prlimit` だけ) | 満たす | 満たす | **満たさない** |
| 起動の時間 | 15.4 の (4) | (A) とほぼ同じ + 約 1.5ms | 測っていない |

**(A) を選んだ理由**: 上限が node の起動の前に必ず掛かり (順序が仕組みで保証される)、要求ごとのプロセスと手順が最も少ない。`prlimit` を挟んでも起動の時間は変わらなかった (15.4 の (4))。

**選ばなかった理由**:
- **(B)**: 今回の 10 回では隙は表に出なかったが、それは node の起動が `prlimit --pid` より遅いという偶然の順序に頼っている。親のイベントループが混んで `prlimit --pid` の起動が遅れると、上限の無いまま子が変換を始めうる。塞ぐには子が合図を待つ手順と、その失敗の扱いが要り、(A) より複雑になる。利点は無い。
- **(C)**: Req 4.8 に反する (`sh` を使う)。
- 参考: util-linux の `setpriv --pdeathsig KILL` を使えば、親が終わったときに OS が子を止める (`PR_SET_PDEATHSIG`) ので見張りのスレッドが要らなくなる。ただし `prlimit` 以外の外部コマンドを使うことになり Req 4.8 に反するので、試していない。採る場合はユーザーの判断が要る。

### 15.3 親が終わったときの見張りの方法の比較

| 方法 | 親を SIGKILL してから子が終わるまで | 備考 |
|---|---|---|
| 子のメインのスレッドで fd 4 を `net.Socket` として読み、`'end'` で自分を止める | **子が同期の処理をしている間は終わらない** (3 秒待っても 3 つとも動き続けた。PDFium の WASM を回し続ける子も同じ) | 最初に失敗した試作 (15.8)。何もしていない子なら終わる |
| 見張りなし | 終わらない (3 秒以上) | 対照 |
| 子の中の worker thread で fd 4 を止まる読み方 (`fs.readSync`) で読み、EOF で `process.kill(process.pid, 'SIGKILL')` | 3〜10ms (同期の処理で止まっている子 3 つを同時に、計 14 回。PDFium の WASM を回し続ける子、`RLIMIT_AS` 1,600MiB の下でも同じ) | **採らない**。worker が読み取りで止まった後は、子の `process.exit()` が返らない (下の表) |
| **子の中の worker thread で、worker 自身のイベントループで fd 4 を `net.Socket` として読み、`'end'` / `'close'` / `'error'` で `process.kill(process.pid, 'SIGKILL')`** | **3〜7ms** (同じ条件で計 6 回。うち 3 回は PDFium の WASM を回し続ける子と `RLIMIT_AS` 1,600MiB) | **採る**。worker の中の `process.exit()` は worker だけを終わらせるので使わない |

- anydoc の `toMarkdownBytes` は Promise を返す (変換は Node の裏のスレッドで動き、メインのスレッドは空く)。一方 `@embedpdf/pdfium` は同期の WASM で、1 ページ 400 万字の変換は約 1 秒メインのスレッドを止める (14.5 の (3))。T6 の部品や結果の JSON 化も同期で動く。どの部品を使っても働くように、見張りは常に worker で行う。
- **止まる読み方の worker では、子の `process.exit()` が返らない**。worker が `fs.readSync(4)` で止まった後にメインのスレッドが `process.exit()` を呼ぶと、子は自分では終わらなくなる。結果を送ってから `process.exit(0)` するまでの待ちを変え、親は 3 秒たったら SIGKILL する形で測った (`--core=1`、`RLIMIT_AS` 3GiB、各 1 回):

  | 子の中身と終わり方 | 止まる読み方 (`fs.readSync`) の worker | `net.Socket` の worker |
  |---|---|---|
  | 結果の直後に `process.exit(0)` | 6.9ms で `(0, null)` | 6.8ms で `(0, null)` |
  | 結果の 20ms 後に `process.exit(0)` | **3 秒を超えて止まる** | 30.2ms で `(0, null)` |
  | 結果の 100ms 後に `process.exit(0)` | **3 秒を超えて止まる** | 109ms で `(0, null)` |
  | 結果の 300ms 後に `process.exit(0)` | **3 秒を超えて止まる** | 310.7ms で `(0, null)` |
  | anydoc を読み込み、結果の直後に `process.exit(0)` | 4.4ms で `(0, null)` | 4.6ms で `(0, null)` |
  | anydoc と `@embedpdf/pdfium` を読み込み、結果の直後に `process.exit(0)` | **3 秒を超えて止まる** | 3.4ms で `(0, null)` |
  | 読み込みの 300ms 後に、結果なしで `process.exit(0)` / `process.exit(1)` / 捕まらない例外 / 捕まらない Promise の失敗 / 見出しだけ送って `process.exit(0)` | **すべて 3 秒を超えて止まる** | `(0, null)` / `(1, null)` / `(1, null)` / `(1, null)` / `(0, null)` で、すべて約 330〜340ms で終わる |

  - 止まったときの子のスレッドの状態 (`/proc/<pid>/task/*/wchan`): メインのスレッドは `futex_wait_queue` (ほかのスレッドを待っている)、worker のスレッド (`WorkerThread`) は `unix_stream_data_wait` (ソケットの読み取りでカーネルの中で待っている)。
  - 理由: Node の `src/api/environment.cc` の `DefaultProcessExitHandlerInternal` (`process.exit()` と捕まらない例外による終了が通る処理) は、`env->stop_sub_worker_contexts();` を呼んでから終わる (ソースを読んだ。v24.x)。`src/env.cc` の `stop_sub_worker_contexts` は、worker ごとに終了を頼んでからそのスレッドの終わりを待つ (join) (取得の道具が本文の引用を返さなかったので、要約で読んだ)。worker の終了の依頼は JavaScript の実行を止めるもので、カーネルの中の読み取りで止まっているスレッドは起こせない。そのため、メインのスレッドが worker を待ち続ける。`net.Socket` の worker はイベントループの待ちにいるだけなので、終了の依頼で止まる。
  - 結果の直後なら止まらなかったのは、worker が起動を終えて読み取りに入る前だったため (worker の起動から準備完了まで約 23ms。15.4 の (4))。レビューの再現では待ち 20ms でも終わったが、この試作では 20ms で止まった。worker の起動の時間による差と見られる。
  - 親の分類への影響 (試作の `runChild`、期限 3 秒、anydoc と `@embedpdf/pdfium` を読み込んだ子、読み込みの 300ms 後に終わる): 止まる読み方の worker では、結果なしの `process.exit(0)` / `process.exit(1)` / 捕まらない例外 / 見出しだけ送って `process.exit(0)` が、**すべて期限まで待ってから `timeout`** (`(null, 'SIGKILL')`、3,007〜3,013ms) になった。`net.Socket` の worker では、すべて `crashed` (`(0, null)` か `(1, null)`、380〜390ms) になった。`net.Socket` の worker で `process.exit(1)`、捕まらない例外、`process.exit(0)` をそれぞれ 20 回繰り返しても、すべて `crashed` で、止まった回は無かった (最大 260ms。`'close'` の処理が SIGKILL に変えることも無かった)。
  - 試作の `e9-exit.mjs` は子の起動の直後に `process.exit` するので、worker が読み取りに入った後の条件は測れない。この確かめには `e19-exit.mjs` を使う。
- **別の直し方として、子が自分で終わるときに必ず `process.kill(process.pid, 'SIGKILL')` を使う形も試した** (止まる読み方の worker のまま、結果を書いた後と、`uncaughtException` / `unhandledRejection` の処理で自分に SIGKILL を送る)。その経路はすべて 330〜385ms で `(null, 'SIGKILL')` → `crashed` になり、30MiB の結果も壊れずに届いた。ただし、その処理を通らない `process.exit()` の直接の呼び出し (部品の中の呼び出しを含む) は止まったままで、`@embedpdf/pdfium` を読み込んだ子では期限まで待って `timeout` (`(null, 'SIGKILL')`、3,004ms) になった。原因 (止まる読み方) を取り除く `net.Socket` の worker のほうが、補う処理を足さずに済み、すべての終わり方で正しく分類されるので、こちらを採る。
- `net.Socket` の worker の費用は止まる読み方の worker と同じだった: 起動から結果まで anydoc で 27.6ms 対 26.7ms、anydoc と `@embedpdf/pdfium` で 70.6ms 対 70.1ms (11 回の中央値)、worker の準備完了の後の RSS は 65MB 対 64MB、80MB 対 79MB (8 回の中央値)、anydoc と `@embedpdf/pdfium` を読み込んだ子の仮想メモリの最小値はどちらも 1,536MiB。
- 親が消えたことを検知できるのは worker の準備完了 (起動から約 23ms) の後からである。それより前に親が消えた場合は、worker が準備完了したときに fd 4 の EOF をすぐに受け取って子を止める。また、入力の読み取り (fd 0) も EOF で失敗する。
- 15.4 の数字のうち、親の消失、終わり方、仮想メモリの最小値、RSS、起動の時間は `net.Socket` の worker でも測り直した (上の数字)。そのほかの計測 (コアダンプ、RSS の見張りの遅れ、15.6 の多くの行) は止まる読み方の worker で測ったが、見張りの形に関係しない (子が自分で終わる経路を含まない) ので測り直していない。
- 子 3 つを同時に動かしても 3 つとも終わったので、ある子の見張りのパイプの書き込み側を、別の子が受け継いでしまうことは無い (実測: 親の側のソケットの fd 5 つは、`/proc/<親>/fdinfo` の flags がすべて `02004002` で、`O_CLOEXEC` (exec のときに閉じる設定) が付いていた。レビューでも確認された)。

### 15.4 確かめた項目の結果

**(1) 上限が変換の開始の前に掛かること**: 子の入口の最初の文で `/proc/self/limits` を読んだ結果は、`--as=3221225472 --cpu=60:65 --core=0` に対して `Max address space` 3221225472 / 3221225472、`Max cpu time` 60 / 65、`Max core file size` 0 / 0 だった (soft と hard を分けられる)。子の `process.pid` は `spawn` が返した PID と同じ (`prlimit` は子を作らずに node を exec する)、`process.ppid` は親の PID だった。

- CPU 時間の上限 `--cpu=1:3` で同期の処理を回し続けると、約 1.0 秒で **SIGXCPU** で終わった (→ `timeout`)。`--cpu=1:1` (soft と hard が同じ) では **SIGKILL** で終わった (→ `crashed` と区別できない)。soft < hard を必ず守る。
- **親の hard の上限より大きい hard を頼むと `prlimit` が失敗する**: 親を `--cpu=100:100` の下で動かし、子に `--cpu=60:200` を頼むと、`prlimit: failed to set the CPU resource limit: Operation not permitted` を出して exit code 1 で終わった (→ 結果なしで `crashed`)。Python 版の `clamp_to_hard_limit` と同じく、親は自分の `/proc/self/limits` の hard を読んで、仮想メモリ (`--as`) と CPU 時間 (`--cpu`) の両方を、それを超えない値に切り詰めてから渡す (仮想メモリの hard を下げた環境では試していないが、同じ仕組みで失敗する見込み)。devcontainer では hard はすべて unlimited。

**(1') コアダンプの上限の値** (`core_pattern` は `|/usr/share/apport/apport …`、`core_pipe_limit` は 10。各 3 回)

| 子の `--core` (子の `/proc/<pid>/limits`) | 外から送った合図 | 合図から `'exit'` まで | 子の中で起こした異常 | `spawn` から `'exit'` まで (起動の約 25ms を含む) |
|---|---|---|---|---|
| `--core=0` (`0 0 bytes`) | SIGABRT | 74.0〜76.9ms | `process.abort()` | 99.6〜100.3ms |
| `--core=0` | SIGSEGV | 72.9〜73.6ms | 本物のスタックのあふれ (`--stack-size=60000` と `--stack=8388608` で V8 の上限を OS の上限より大きくし、再帰させた。SIGSEGV で終わる) | 111.3〜115.1ms |
| `--core=0` | SIGXCPU | 74.9〜77.0ms | — | — |
| `--core=0` | SIGTERM (コアを作らない合図) | 2.4〜2.9ms | 自分に SIGTERM | 22.9〜24.6ms |
| `--core=1` (`1 1 bytes`) | SIGABRT | 2.8〜3.2ms | `process.abort()` | 23.8〜28.5ms |
| `--core=1` | SIGSEGV | 2.7〜3.1ms | 本物のスタックのあふれ | 35.5〜36.7ms |
| `--core=1` | SIGXCPU | 3.0〜3.2ms | — | — |
| `--core=1` | SIGTERM | 2.8〜2.9ms | 自分に SIGTERM | 22.3〜28.0ms |

- `--core=0` だけ約 70ms 長いのは、カーネルがコアを渡し先のプログラム (apport) に送り終えるまで回収できないため (`core_pipe_limit` が 0 でないと、カーネルは渡し先が終わるのを待つ。core(5))。`--core=1` は SIGTERM と同じ時間で、コアを作っていない。終わり方 (`(null, 'SIGABRT')` など) と失敗の種類 (`crashed`) は `--core` の値で変わらない。
- 根拠 (Linux v6.8 の `fs/coredump.c`、`do_coredump` の中。GitHub の torvalds/linux で読んだ): `.limit = rlimit(RLIMIT_CORE),` で上限を取り、渡し先がプログラムのとき (`ispipe`) は `if (cprm.limit == 1) {` の中に「Normally core limits are irrelevant to pipes, since we're not writing to the file system, but we use cprm.limit of 1 here as a special value, this is a consistent way to catch recursive crashes.」とあり、`printk(KERN_WARNING "Process %d(%s) has RLIMIT_CORE set to 1\n", …)` と `printk(KERN_WARNING "Aborting core\n")` の後に `goto fail_unlock;` する。1 以外の値なら `cprm.limit = RLIM_INFINITY;` に置き換えて送る (だから 0 は効かない)。ファイルに書く場合は `if (cprm.limit < binfmt->min_coredump) goto fail_unlock;` で、`fs/binfmt_elf.c` の `elf_format` は `.min_coredump = ELF_EXEC_PAGESIZE`。
- 上の `printk` の 2 行は v6.8 の文言で、v6.12 では `coredump_report_failure("RLIMIT_CORE is set to 1, aborting core");` の 1 行に変わっている (v6.12 のソースも読んだ。`goto fail_unlock;` は同じで、動作は変わらない)。
- `--core=1` の副作用: 異常終了のたびに、ホストのカーネルのログに警告が出る見込み (この devcontainer では `dmesg` が `Operation not permitted` で、確かめられなかった)。

**(2) 追加のパイプが `prlimit` を通った後も子に引き継がれること**: `stdio` の 4 番目 (fd 3) と 5 番目 (fd 4) は、`prlimit` → node の 2 回の exec の後も子に残り、fd 3 で 30MiB の結果を壊れずに受け取れ、fd 4 の EOF で子が終わった。子の側の fd 0 / 3 / 4 は止まる読み書きの設定 (`/proc/self/fdinfo` の flags に `O_NONBLOCK` が無い) だったので、`fs.readSync` / `fs.writeSync` がそのまま使える。Node の `'pipe'` は実際には UNIX ドメインのソケットの組で、どちら向きにも使える。flags には `O_CLOEXEC` も付いていた (子がさらに別のプロセスを起動しても、これらの fd は渡らない。誰が付けたかは確かめていない)。

**(3) 親が SIGKILL されたときに子が 1 秒以内に終わること**: 15.3 のとおり 3〜10ms。終わった後に、子の起動の引数に付けた目印で `/proc` を探し、残った子が無いことを確かめた。

**(4) 起動の時間** (11 回の中央値。`RLIMIT_AS` 3GiB。「結果まで」は `spawn` を呼んでから fd 3 で結果を受け取るまで、「回収まで」は SIGKILL を送って `'exit'` を受け取るまで)

| 子の中身 | 結果まで | 回収まで | 部品の読み込み | 子の RSS (結果の時点) |
|---|---|---|---|---|
| node を直接 `spawn` (prlimit なし)、見張りなし | 21.5ms | 23.1ms | — | 49MB |
| `prlimit` で包む、見張りなし | 21.0ms | 22.0ms | — | 49MB |
| `prlimit` + 見張りの worker | 24.5ms | 26.0ms | — | 50MB (※) |
| `prlimit` + worker + anydoc | 28.3ms | 30.1ms | 2.5ms | 56MB (※) |
| `prlimit` + worker + anydoc + `@embedpdf/pdfium` の初期化 | 71.2ms | 73.9ms | 45.7ms | 82MB |
| 同上、`RLIMIT_AS` 2GiB | 89.0ms | 91.7ms | 64.3ms | 83MB |
| 見張りなし + anydoc + `@embedpdf/pdfium`、`RLIMIT_AS` 2GiB | 87.1ms | 89.6ms | 63.0ms | 70MB |

- research.md 6.2 の「anydoc を読み込む子を `prlimit` で包んで 26.8ms」と、上の「`prlimit` + worker + anydoc」28.3ms はほぼ合う。見張りの worker の上乗せは約 3.5ms。
- `@embedpdf/pdfium` の読み込み (WASM のファイルを読む + `init` + `PDFiumExt_Init`) は上の表で 45.7ms で、14.5 の (3) の 27.4ms より長かった。**原因は `RLIMIT_AS` そのもの**で、上限を絞るほど遅くなる (anydoc を先に読み込むかどうかは関係ない)。9 回の中央値 (worker あり):

  | `RLIMIT_AS` | `@embedpdf/pdfium` だけ | anydoc の後に `@embedpdf/pdfium` |
  |---|---|---|
  | 上限なし (`--as=unlimited`) | 27.8ms | 29.1ms |
  | 3GiB | 43.7ms | 43.4ms |
  | 2GiB | 61.7ms | 65.1ms |
  | 3GiB + 子の node に `--wasm-max-mem-pages=8192` | 26.8ms | 26.9ms |

  上限を掛けると、V8 は WASM のメモリの予約を上限の残りに合わせて作り直すと見られる (仕組みは確かめていない)。WASM のメモリの上限を `--wasm-max-mem-pages` で小さくすると、上限なしと同じ速さに戻った。PDF の部品は PDF の要求のときだけ読み込めば、ほかの形式の起動は約 30ms で済む (読み込み方は 6.x で決める)。
- (※) この 2 行は、worker の起動が終わる前に結果を返している。worker の起動を待ってから測ると (8 回の中央値)、子の RSS は見張りなし 49MB → worker あり 62MB、anydoc + `@embedpdf/pdfium` で 68MB → 79MB だった。**見張りの worker の分、子 1 つにつき約 11〜13MB 増える** (同時に 3 件で約 36MB)。3.7 のメモリの予算に入れる。
- `spawn()` の呼び出しが親のイベントループを止める時間は約 1.0ms だった。

**仮想メモリの最小値** (`prlimit --as` で 3 回続けて結果を返す最小値。64MiB 刻み)

| 子の中身 | 最小値 |
|---|---|
| 見張りなし | 1,152MiB |
| worker (設定なし) | 1,152MiB |
| 見張りなし + anydoc + `@embedpdf/pdfium` | 1,472MiB (14.5 の (2) と同じ) |
| worker (設定なし) + anydoc + `@embedpdf/pdfium` | **2,048MiB** |
| worker (`resourceLimits: { codeRangeSizeMb: 4 }`) + anydoc + `@embedpdf/pdfium` | **1,536MiB** |
| worker (`maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2` だけ) + anydoc + `@embedpdf/pdfium` | 2,048MiB |

- 足りないときは、worker の V8 の初期化 (`v8::Isolate::Initialize`) が `FatalOOM` で失敗し、子全体が **SIGTRAP** で終わった。worker の起動を待ってから部品を読み込む順にしても、最小値は 2,048MiB のままだった。効いたのは、worker の機械語を置く領域の予約を小さくする `codeRangeSizeMb: 4` だった。見張りの worker は数行のコードしか動かさないので、この設定で困ることは無い (15.3 の計測はこの設定で行った)。
- 上の値は「読み込むだけ」のもの。変換の入力ごとの値は 3.6 で、この worker を含めた子で測り直す。
- **起動できる最小値の近くでは、JavaScript のヒープがほとんど増やせない**。子に配列を増やし続けさせ (V8 のメモリ不足で SIGABRT になるまで)、そのときの最大 RSS を測った (worker は `codeRangeSizeMb: 4` の設定、起動を待ってから。各 1 回):

  | `RLIMIT_AS` | 何も読み込まない | anydoc だけ | anydoc + `@embedpdf/pdfium` |
  |---|---|---|---|
  | 1,536MiB | 139MB | — | 111MB |
  | 2,048MiB | 651MB | 646MB | 111MB |
  | 3,072MiB | 1,599MB | 1,602MB | 126MB |
  | 4,096MiB | — | — | 626MB |
  | 8,192MiB | — | — | 2,130MB |

  `@embedpdf/pdfium` を読み込むと、上限 3GiB でもヒープは RSS 約 126MB までしか増えなかった。**原因**: `pdfium.wasm` のメモリの節は、最初 284 ページ・上限 32,768 ページ (2,048MiB。1 ページ 64KiB) と宣言している (WASM のファイルを読んで確かめた)。`RLIMIT_AS` を掛けずに初期化すると、`VmSize` が約 8,216〜8,280MB 増えた (範囲外の読み書きを捕まえるための見張りの領域の予約)。上限を掛けると、V8 は上限の残りのほぼ全部をこの予約に使う (`VmSize` は上限 3GiB で 2,946〜3,025MB、2GiB で 1,930〜2,009MB)。そのため JavaScript のヒープの余地が残らない。

  **使える手: 子の node に `--wasm-max-mem-pages=<ページ数>` を渡して、WASM のメモリの上限を小さくする**。worker あり、anydoc と `@embedpdf/pdfium` を読み込んだ子で、ヒープを増やし続けたときの最大 RSS と、1 ページ 400 万字の PDF (0.1pt の字で全部の行をページの内側に置いたもの。子の中で全文を取り出して `JSON.stringify` まで行う) の結果 (各 1 回):

  | `--wasm-max-mem-pages` | `RLIMIT_AS` | ヒープの余地 (最大 RSS) | 400 万字の 1 ページ |
  |---|---|---|---|
  | 指定なし (32,768 = 2GiB) | 3GiB | 126MB | **SIGABRT** (確保に失敗して abort。RSS 488MB) |
  | 指定なし | 2GiB | 111MB | **SIGABRT** (RSS 488MB) |
  | 16,384 (1GiB) | 3GiB | 625MB | 変換できた (4,000,000 字、最大 RSS 516MB、`VmSize` 2,534MB) |
  | 16,384 | 2GiB | 119MB | **SIGABRT** |
  | 12,288 (768MiB) | 3GiB | 900MB | 変換できた (最大 RSS 504MB) |
  | 12,288 | 2GiB | 234MB | **`RuntimeError`** (WASM のメモリを増やせない → `internal`) |
  | 8,192 (512MiB) | 3GiB | 1,136MB | 変換できた (最大 RSS 503MB、`VmSize` 2,022MB) |
  | 8,192 | 2GiB | 115MB | **SIGABRT** |
  | 4,096 (256MiB) | 3GiB | 1,403MB | **`RuntimeError`** (PDFium に 256MiB では足りない → `internal`) |
  | 4,096 | 2GiB | 372MB | **`RuntimeError`** |

  - 指定なしの SIGABRT は、レビューの再現では標準エラーに `node::Realloc ... Assertion failed` (`TextDecoder` が文字列のための領域を確保できなかった) と出た。同じく、`@embedpdf/pdfium` を読み込んだ指定なしの子で 30MiB の結果を作ると、3 回とも SIGABRT で終わり、`--wasm-max-mem-pages=8192` では 3 回とも結果が届いた。`MAX_RESULT_BYTES` に近い大きさの結果を作るには、PDF の部品を読み込んだ子にこの設定が実際上必要になる。
  - 注意 (a): 値は、400 万字の 1 ページを変換できるかを測って決める。4,096 (256MiB) ではヒープは増えるが、400 万字の 1 ページが `RuntimeError` で失敗した。上の表では 8,192 と `RLIMIT_AS` 3GiB の組み合わせが、ヒープの余地と変換の両方を満たした。上限 2GiB では、どの値でも 400 万字の 1 ページは失敗した (どれも 1 回だけの計測)。実際のサービスでは、400 万字の 1 ページは RSS が 320MB を超えるので、その前に RSS の見張りが `memory_exceeded` で止める (14.5 の (1))。それでも、上限を超えない入力が 確保に失敗して abort (`crashed`) にならないことを、3.6 で入力ごとに確かめる必要がある。
  - 注意 (b): 子の `env` には `NODE_OPTIONS` を入れない (15.4 の (6))。この設定は、`prlimit` の引数の `process.execPath` の後ろ (子の入口のパスの前) に置く。PDF の部品を読み込んだ子で JavaScript の側の処理 (結果の文字列や JSON) が大きくなると、RSS の上限 (320MB) より手前で確保に失敗して abort (`crashed`) しうる。何も読み込まない子と anydoc だけの子では、ヒープは「上限 − 約 1.4GB」まで増やせた (2GiB で約 650MB、3GiB で約 1,600MB)。設定なしの worker で同じことをした最初の試作でも、上限 2GiB で RSS 約 140MB で SIGABRT になった。

**(5) `oom_score_adj` の設定**: 子の入口の最初の文で `/proc/self/oom_score_adj` に 1000 を書くと成功し、読み直すと 1000 だった (入力を読む前、つまり変換の前)。親からも同じ uid の子の `/proc/<pid>/oom_score_adj` に書けた (0 → 500 に上げられ、500 → 0 に戻すこともできた。0 より下には自分のものでも下げられなかった)。ただし親から書くと、子が動き出した後になる (順序の保証が無い) ので、**子が自分で書く形にする** (design.md の「子プロセスの中の流れ」のとおり)。`prlimit` には `oom_score_adj` を設定する機能が無い。

**(6) 子の環境変数と標準出力**:
- 親を `EXTRACTOR_TOKEN=secret-xyz NODE_OPTIONS=--max-old-space-size=123` で起動し、子に `env: { RAYON_NUM_THREADS: '1' }` を渡すと、子の `process.env` のキーは `RAYON_NUM_THREADS` だけで、トークンも `NODE_OPTIONS` も入らなかった。子の `process.execArgv` も空だった。`PATH` は要らない (`prlimit` も node も絶対パスで起動するため)。
- 子が結果の前に標準出力と標準エラーへ 1MiB ずつ書いても、親が上限つきで読み捨てていれば、fd 3 の結果は壊れずに届いた。親が標準出力と標準エラーの読み取りを止めた (`pause()`) ままでも、1MiB では子は止まらずに結果を返した (Node の側の読み込みの単位か、ソケットの組の送り側の領域が吸収したと見られるが、どこまで吸収するかは確かめていない)。ただ、どこかで溜まりきれば子の書き込みが止まり、時間切れと誤って分類されうるので、本番では必ず読み捨てる。
- 子が異常終了して読まないまま、親が標準入力に 50MB を書いても、親に `'error'` の処理を付けておけば親は落ちなかった (結果は `crashed`)。**標準入力・標準出力・標準エラー・fd 3・fd 4 のすべてに `'error'` の処理を付ける**。付けないと EPIPE (読み手のいないパイプへの書き込み) の例外で HTTP のプロセスごと落ちる。`prlimit` が無いとき (パスの誤り) は `spawn` の `'error'` が `ENOENT` で届く (→ `crashed`)。

**(7) 子の停止と回収**:
- 同期の処理で止まっている子に `child.kill('SIGKILL')` を送ってから `'exit'` を受け取るまで、中央値 2.31ms、最大 2.75ms (11 回)。対象 spec の「2 秒を上限に回収」に十分収まる。回収の後、目印で探して残った子もゾンビ (終わったが回収されていないプロセス) も無かった。
- 中止の合図 (`AbortSignal`) を 300ms で送ると、303ms で子を止めて回収して戻った。
- `detached` は既定 (false) のままにする。子は親と同じプロセスグループに入り (実測: 親のプロセスグループ 2937862、子のプロセスグループ 2937862)、端末の Ctrl+C などグループへの合図は子にも届く。親が終わったときに子を止めるのは見張りの worker の役目で、グループには頼らない。
- 親のイベントループは止まらない: RSS が約 300MB の子 3 つを同時に見張った間の遅れは、中央値 1.08ms、99 パーセンタイル 1.48ms、最大 2.05ms だった。
- **PID の取り違えの防ぎ方** (コードの読みによる。実測ではない): Node には pidfd (PID の使い回しに影響されないプロセスの手がかり) が無い。代わりに、libuv (Node のイベントループの部品) は子の回収 (`waitpid`) をイベントループの中でだけ行い、同じ処理の中で `child.exitCode` / `child.signalCode` を設定する。そこで、`child.exitCode === null && child.signalCode === null` を確かめてから **同期で** (`readFileSync`) `/proc/<pid>/status` を読めば、その間に回収と PID の使い回しが起きることは無い (回収されていないゾンビなら `VmRSS` の行が無いので読み飛ばす)。非同期で読む場合は、読み終わった後に終了を確かめ直して、終わっていれば値を捨てる (試作はこの形にした)。

**(8) 終わり方と失敗の種類の対応**: 子の終わり方は `'exit'` の `(code, signal)` で取れる。Python 版の `classify_exit` と同じ順で分類した結果が次の表 (15.6)。

**(9) RSS の監視**:
- `/proc/<pid>/status` を 1 回読んで `VmRSS` と `VmHWM` を取り出す時間は、`readFileSync` で 8.2µs、`fs.promises.readFile` で 47.8µs (2,000 回の平均)。50ms ごと × 3 件でも負荷は無視できる。
- **一気に確保する子がどこまで上限を超えるか**: 上限 320MB で、子が 1GiB を 16 / 64 / 256 / 1,024MiB ずつ (`Buffer.alloc(…, 1)` で中身も書いて) 確保すると、20 回すべて `memory_exceeded` で止まり、止めた時点に親が見た RSS は 419〜465MB だった (**上限を最大 145MB 超えた**)。50ms の間に書き込める量 (約 3GB/秒) の分だけ超える。Python 版も同じ 50ms の見張りなので、この性質は変わらない。違うのは最後の歯止めで、Python 版は `RLIMIT_AS` が「RSS の上限 + 512MB」(832MB) だったが、Node 版は 1,536MiB 以上にしかできない (3.6 で決める)。
- 1 回で 1.5GiB を確保しようとした子は、`RLIMIT_AS` 2GiB の下で `RangeError: Array buffer allocation failed` の例外になり、RSS はほとんど増えなかった (歯止めは例外として働き、プロセスは生きている)。

### 15.5 再現の手順と、試作のコードの要点

使い捨ての場所 (以下 `$T`) で行う。リポジトリの中では install しない。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$T" && cd "$T"
echo '{"name":"t2","private":true,"type":"module"}' > package.json
npm install --save-exact @firecrawl/anydoc@0.2.4 @embedpdf/pdfium@2.15.1
```

試作は `child.mjs` (子の入口)、`supervise.mjs` (親の見張り)、計測ごとの小さなスクリプト (上限と環境変数、親の消失、終わり方、仮想メモリの最小値、起動の時間、RSS、`fork` + `prlimit --pid`、`oom_score_adj`、EPIPE と中止と回収、hard の上限) からなる。子の起動の引数には `--t2-tag=<目印>` を付け、後片付けでは目印の付いた自分の子の PID だけを止めた。親の消失の計測は、HTTP のプロセスの代わりの親を別のプロセスとして起動し、その親を SIGKILL して、子の `/proc/<pid>/stat` が消えるかゾンビになるまでの時間を 2ms ごとに見た。

**親: 子の起動** (6.7 の実装の手本)

```js
const PRLIMIT = '/usr/bin/prlimit'; // never looked up through PATH
const child = spawn(
  PRLIMIT,
  [
    `--as=${asBytes}`,
    `--cpu=${cpuSoft}:${cpuHard}`, // soft < hard: SIGXCPU (timeout) before SIGKILL; both clamped to our own hard limits
    '--core=1', // not 0: with a piped core_pattern the kernel ignores 0 but treats 1 as "no core"
    '--',
    process.execPath,
    '--wasm-max-mem-pages=8192', // node flags go here: the child env never carries NODE_OPTIONS (value decided in 3.6)
    childEntryPath,
  ],
  {
    // 0: input frames, 1/2: logs (read and discard, capped), 3: result frame, 4: liveness (never written)
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    env: { RAYON_NUM_THREADS: '1' }, // explicit: no token, no NODE_OPTIONS
  },
);
for (const s of child.stdio) s?.on('error', () => {}); // EPIPE must not crash the HTTP process
child.on('error', onSpawnError); // ENOENT when prlimit is missing -> crashed
child.on('exit', (code, signal) => onExit(code, signal));
child.stdin.write(frame(headerJson));
child.stdin.end(frame(fileBytes));
```

**親: 見張りの骨格**

```js
// Parent decisions are recorded before the kill, so our own SIGKILL is never read back as a crash.
const decide = (kind) => { decided ??= kind; if (exit === null) child.kill('SIGKILL'); };
const deadline = setTimeout(() => decide('timeout'), timeoutMs);
const poll = setInterval(() => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let text;
  try { text = readFileSync(`/proc/${child.pid}/status`, 'utf8'); } catch { return; } // same tick: pid not yet reaped
  const rss = matchKib(text, 'VmRSS');
  peakKib = Math.max(peakKib, rss ?? 0, matchKib(text, 'VmHWM') ?? 0);
  if (rss !== null && rss > maxRssMb * 1024) decide('memory_exceeded');
}, 50);
signal.addEventListener('abort', () => decide('aborted'), { once: true });
// fd 3: read the 4-byte length first; over the ceiling -> decide('result_too_large') without buffering.
// On a complete frame: keep it, then SIGKILL anyway. Finish only after 'exit' AND (frame complete or fd 3 ended),
// with a 2 s cap on waiting for 'exit' after the kill. Then destroy stdio[1..4] and clear the timers.
```

**子: 入口の最初の部分** (6.6 の実装の手本)

```js
// 1. Self-check before reading any input: limits are already in place (prlimit set them before exec).
const limits = readFileSync('/proc/self/limits', 'utf8'); // prototype only: see the note below
writeFileSync('/proc/self/oom_score_adj', '1000'); // raising needs no privilege; throw vs warn-and-continue: decided in 6.6

// 2. Liveness: a dedicated thread with its own event loop, so it works while the main thread is stuck in synchronous code.
const watcher = new Worker(
  `const { Socket } = require('node:net');
   const die = () => process.kill(process.pid, 'SIGKILL'); // process.exit() here would end only the worker
   const s = new Socket({ fd: 4, readable: true, writable: false });
   s.on('data', () => {});
   s.on('end', die);
   s.on('close', die);
   s.on('error', die);`, // never a blocking readSync: the main thread's process.exit() would wait on it forever
  { eval: true, resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2, codeRangeSizeMb: 4 } },
);
watcher.on('error', () => process.kill(process.pid, 'SIGKILL')); // no watcher -> do not convert (this path was not exercised)
watcher.unref();

// 3. Read the framed input from fd 0 with readSync (blocking), convert, write one frame to fd 3 with writeSync.
```

- 子の入口では、見張りの worker を入力を読む前に立てる (試作では見出しを読んだ直後に立てたが、本番では最初に立てる)。親が入力を送る前に消えた場合は、fd 0 の読み取りが EOF で失敗して子が終わる。
- `oom_score_adj` の書き込みが失敗したときの扱いは 6.6 で決める。上の断片のままだと例外で子が終わり、すべての要求が `crashed` になる。Python 版は警告を出して変換を続けていた (`platform_guards.py` の `GuardResult`)。
- `/proc/self/limits` の自己確認は試作の計測のためのもので、値が合わないときの動作は決めていない。`prlimit` は上限を掛けられないと exit code 1 で終わり、node を起動しない (15.4 の (1)) ので、子が起動した時点で上限は掛かっている。本番では省くか、テストの側で `/proc/<pid>/limits` を外から確かめる形にできる。

### 15.6 終わり方と失敗の種類 (`FailureKind`) の対応

`--core` の値 (0 か 1 か) は、どの行の終わり方と種類も変えない (15.4 の (1'))。子が自分で終わる行 (`exit(0)`、`process.exit(1)`、捕まらない例外、見出しだけ送る) は、採った `net.Socket` の見張りの worker での結果である。止まる読み方の worker では、worker が読み取りに入った後 (PDF の部品を読み込んだ後など) は、これらがすべて止まって期限切れの `timeout` になる (15.3)。分類の順は Python 版の `child_supervision.py` と同じ: (1) 結果を最後まで受け取った → 結果のとおり、(2) 親が決めて止めた → その種類、(3) 結果なしで終わった → SIGXCPU なら `timeout`、それ以外は `crashed`。

| 起きたこと (試作で起こしたもの) | 親から見える `(code, signal)` | 種類 | Python 版 |
|---|---|---|---|
| `process.abort()` (Rust の panic による abort の代わり) | `(null, 'SIGABRT')` | `crashed` | 同じ |
| 自分に SIGSEGV を送る | `(null, 'SIGSEGV')` | `crashed` | 同じ |
| 本物の segfault (V8 の上限を OS のスタックより大きくしてスタックをあふれさせる) | `(null, 'SIGSEGV')` | `crashed` | 同じ |
| 結果を送らずに `exit(0)` (読み込みの直後と、`@embedpdf/pdfium` を読み込んで 300ms 後) | `(0, null)` | `crashed` | 同じ |
| 結果を送らずに `process.exit(1)` (`@embedpdf/pdfium` を読み込んで 150〜300ms 後) | `(1, null)` | `crashed` | 同じ |
| 捕まらない例外 / 捕まらない Promise の失敗 (同上) | `(1, null)` | `crashed` | 同じ |
| 長さは正しいが、中身が JSON として読めない結果 (`{not json`) | `(null, 'SIGKILL')` (結果を受け取った後に親が止めた) | `crashed` | 同じ (`_BAD_RESULT`) |
| 長さの見出し (100 バイト) の後に 10 バイトだけ送って `exit(0)` (読み込みの直後と、`@embedpdf/pdfium` を読み込んで 300ms 後) | `(0, null)` | `crashed` | 同じ (`classify_exit`) |
| 外からの SIGKILL (OS のメモリ不足による強制終了の代わり) | `(null, 'SIGKILL')` | `crashed` | 同じ |
| CPU 時間の soft の上限 (`--cpu=1:3`) | `(null, 'SIGXCPU')` (約 1.0 秒) | `timeout` | 同じ |
| CPU 時間の soft = hard (`--cpu=1:1`) | `(null, 'SIGKILL')` | `crashed` | 同じ (だから soft < hard にする) |
| 親の期限 (500ms) | `(null, 'SIGKILL')`、親が先に決めた | `timeout` | 同じ |
| RSS の上限 (200MB で 1GiB を確保) | `(null, 'SIGKILL')`、親が先に決めた | `memory_exceeded` | 同じ |
| 結果の長さが上限を超える (上限 1MiB に 2MiB) | `(null, 'SIGKILL')`、親が先に決めた | `result_too_large` | 同じ |
| 中止の合図 | `(null, 'SIGKILL')`、親が先に決めた | (HTTP の層が応答しない。切断) | 同じ |
| JavaScript のヒープが増やせない (`RLIMIT_AS` 2GiB の下で配列を増やし続ける) | `(null, 'SIGABRT')` (V8 の致命的なメモリ不足) | `crashed` | **違う** (Python 版は `MemoryError` → `internal`)。応答は同じ 500 |
| `Buffer.alloc(3e9)` / `Buffer.alloc(1.5GiB)` が `RLIMIT_AS` に当たる | 例外 `RangeError: Array buffer allocation failed`。子は生きていて、捕まえて結果を返せる | `internal` | 同じ |
| WASM のメモリを増やせない (`WebAssembly.Memory.grow`) | 例外 `RangeError: … Unable to grow instance memory`。PDFium の中なら `RuntimeError: Aborted` (14.5 の (2)) | `internal` | 同じ |
| node が起動できない (`--as=300MB`) / 見張りの worker の V8 の初期化が失敗 | `(null, 'SIGTRAP')` | `crashed` | — (Python 版には無い) |
| `prlimit` が上限を掛けられない (hard を上げようとした) | `(1, null)`、標準エラーに `prlimit: failed to set …` | `crashed` | — |
| `prlimit` が無い | `spawn` の `'error'` (`ENOENT`) | `crashed` | — |
| 結果の前に標準出力・標準エラーへ 1MiB ずつ | 結果は壊れずに届く | 結果のとおり | 同じ |

### 15.7 後のタスクへの引き継ぎ

- **3.6 (`RLIMIT_AS` の値)**: 子は見張りの worker を必ず持つので、仮想メモリは worker を含めて測る。worker には `resourceLimits: { codeRangeSizeMb: 4 }` (と小さなヒープ) を渡す。この設定で、anydoc と `@embedpdf/pdfium` を読み込んだ子の最小値は 1,536MiB (worker なしより 64MiB 多い)。足りないと worker の初期化で子全体が SIGTRAP で終わる (`crashed`) ので、上限には余裕を持たせる。`RLIMIT_AS` を絞ると `@embedpdf/pdfium` の読み込みが遅くなる (上限なし 27.8ms、3GiB 43.7ms、2GiB 61.7ms。`--wasm-max-mem-pages=8192` なら 3GiB で 26.8ms。15.4 の (4))。RSS の見張りは一気に確保する子に対して最大約 145MB 遅れる (15.4 の (9))。**`@embedpdf/pdfium` を読み込んだ子は、上限 3GiB でも JavaScript のヒープが RSS 約 126MB までしか増えない** (15.4 の (4) の表)。原因は WASM のメモリの予約で、子の node に `--wasm-max-mem-pages` を渡すと直る (8,192 と上限 3GiB で、ヒープ約 1,136MB、400 万字の 1 ページも変換できた。15.4 の (4) の表)。`RLIMIT_AS` の値、`--wasm-max-mem-pages` の値 (400 万字の 1 ページを変換できる値。4,096 では足りない)、PDF の部品を PDF の要求のときだけ読み込むかどうかを、合わせて決める。`--wasm-max-mem-pages` は `NODE_OPTIONS` ではなく、`prlimit` の引数の `process.execPath` の後ろに置く。
- **設計への波及 (design.md は書き換えていない)**: この spec の design.md の Security Considerations の「子のコアダンプは `prlimit --core=0` で禁止する (3.12)」と、File Structure Plan の `runner/linux/prlimit-args.ts` の説明「RLIMIT_AS / CPU soft:hard / core 0 -> argv」と、対象 spec の design.md の ChildEntry の「`RLIMIT_CORE` を 0 にする。… コンテナの rootfs を読み取り専用にしても防げず、利用者のファイルの中身がホストのディスクに残るため」は、コアをプログラムに渡す設定では 0 が無視されるという事実と合わない。ユーザーが `--core=1` を採ると決めた後に、この spec の design.md を改めるか、取り込み (Req 12) で対象 spec に反映する。
- **3.7 (RSS の基準とメモリの予算)**: 見張りの worker の分、子 1 つにつき約 11〜13MB 増える。基準のファイルは worker を含めた子で測る。予算の式の「子の最大 RSS」にこの分が入る。
- **6.6 (子の入口)**: 15.5 の「子: 入口の最初の部分」の順 (上限の自己確認 → `oom_score_adj` → 見張りの worker → 入力 → 変換 → fd 3 に 1 回書く → `process.exit(0)`) で書く。fd 0 / 3 は止まる読み書きの設定なので、メインのスレッドでは `readSync` / `writeSync` でよい。**見張りの worker の中では止まる読み方 (`fs.readSync`) を使わず、`net.Socket` で fd 4 を読む** (止まる読み方にすると、`process.exit(0)` も捕まらない例外による終了も返らず、結果なしで終わる経路がすべて期限まで待って `timeout` に分類される。15.3)。worker の中で `process.exit()` を使わない。worker の `'error'` で自分を止める。`oom_score_adj` の書き込みに失敗したときに止めるか続けるか、`/proc/self/limits` の自己確認を残すかを決める (15.5 の注)。
- **6.7 (実行管理)**: 15.5 の「親」の 2 つの断片の形で書く。必ず守ること: (a) `/usr/bin/prlimit` を絶対パスで起動し、コアダンプの上限は `--core=1` にする (ユーザーが採ると決めた場合。0 はコアをプログラムに渡す設定で無視される。15.4 の (1'))、(b) CPU の soft < hard にし、仮想メモリと CPU 時間の両方を親の hard の上限で切り詰める (`/proc/self/limits` を読む)、(c) `env` を明示する、(d) すべての stdio に `'error'` の処理を付け、標準出力と標準エラーは上限つきで読み捨てる、(e) 結果の受け取りと `'exit'` の両方がそろってから分類する (`'exit'` が fd 3 の読み終わりより先に来ることがある)、(f) `/proc/<pid>/status` は終了していないことを確かめてから同期で読む、(g) 結果を受け取った後も必ず SIGKILL して回収する。`TMPDIR` は要らない (Node 版は名前の付いたソケットのファイルを作らない)。準備完了の判定 (8.8) は、同じ起動の仕方で部品を読み込むだけの子を起動して、結果が返るかで行える (起動から結果まで、anydoc と PDF の部品を読み込んで約 70〜90ms)。
- **4.3 (実行管理の結合テスト)**: 15.6 の表の各行が、そのままテストの場合になる。子が自分で終わる行は、見張りの worker が準備完了した後 (起動から 100ms 以上、または PDF の部品を読み込んだ後) に終わらせる形で書く (起動の直後に終わらせると、止まる読み方の worker でも通ってしまう)。`--core=1` を採るなら、`/proc/<pid>/limits` の `Max core file size` が `1 1` であることと、abort した子の回収が SIGTERM と同じ速さで終わることを確かめるテストを置ける (時間で確かめるテストは揺れやすいので、置くかどうかは 4.3 で決める)。親の消失は「同期の処理で止まっている子」で確かめる (何もしていない子では、見張りが壊れていても通ってしまう)。Python 版の `test_force_killing_the_worker_ends_its_converting_child_within_2s` の 2 秒は、Node 版の実測 (3〜10ms) なら 1 秒にしても余裕がある。

### 15.8 RED (選定の前の状態と、最初に失敗した試作)

- 選定の記録が無かった: `grep -c "^## 15\." research.md` は `0`。未決事項の表の「子プロセスの作り方」は「未決」だった。
- 最初に失敗した試作は、子のメインのスレッドで見張る方法。親を SIGKILL した後の結果: `{"watcher":"eventloop","modes":["busy","busy","busy"],"endedAfterMs":["ALIVE>3000","ALIVE>3000","ALIVE>3000"],"leftAliveWithTag":[{"pid":2921802,"state":"R"},…]}`、PDFium の WASM を回し続ける子も `["ALIVE>3000"]`。子は親の消失に気付かずに動き続けた (試作の後片付けで、目印の付いた自分の子だけを止めた)。
- コアダンプ: RED は `--core=0` の子が SIGABRT で 74.0〜76.9ms、SIGSEGV で 72.9〜73.6ms (コアが apport に送られている)。GREEN は `--core=1` で 2.8〜3.2ms / 2.7〜3.1ms、SIGTERM (2.4〜2.9ms) と同じ (15.4 の (1'))。
- 子が自分で終わる経路: RED は止まる読み方の worker で、結果の 100ms 後の `process.exit(0)` が `{"case":"echo, exit 100ms after result","result":true,"endedBy":"HUNG>3000ms (parent SIGKILL)",…,"stuckThreads":["MainThread:S:futex_wait_queue",…,"WorkerThread:S:unix_stream_data_wait"]}`、`@embedpdf/pdfium` を読み込んだ子の結果なしの `exit(0)` が `{"mode":"late-exit0","load":"anydoc+pdfium","kind":"timeout","exit":{"code":null,"signal":"SIGKILL"},"totalMs":3013}`。GREEN は `net.Socket` の worker で、前者が 109ms で `(0, null)`、後者が `{"kind":"crashed","exit":{"code":0,"signal":null},"totalMs":382}` (15.3)。
- 次に失敗したのは、設定なしの worker で見張る子に PDF の部品を読み込んだ場合で、`RLIMIT_AS` 1,600MiB で `FatalOOM` → SIGTRAP で子全体が終わった (15.4 の (4))。`codeRangeSizeMb: 4` で解消した。

### 15.9 確かめなかったこと

- Node の slim image の中での値 (時間、RSS、仮想メモリ、`prlimit` の版)。
- anydoc の中の Rust の panic による abort (`process.abort()` で代わりにした)。ネイティブの部品の中の segfault (スタックのあふれによる本物の SIGSEGV で代わりにした)。
- `--core=1` の扱いは core(5) の man ページには書かれておらず、カーネルのソースのコメント (v6.8、v6.12 で読んだ。レビューでは v3.10 から v6.12 まで確認された) だけに頼っている。将来のカーネルで変わる可能性は否定できない。
- コアをファイルに書く設定の `core_pattern` で、`--core=1` のときにコアが作られないこと (カーネルのソースでは 4,096 バイトより小さい上限では書かない。実測していない)。
- `--core=1` のときにホストのカーネルのログに警告 (`has RLIMIT_CORE set to 1` / `Aborting core`) が出るかどうか (`dmesg` が許されなかった)。
- Python 版で、プログラムに渡す設定のときに実際にコアが渡っていたか。
- 本物の変換 (大きな XLSX や PDF) の途中で親を消した場合 (同期の処理で止まっている子で確かめた。anydoc の変換はメインのスレッドを止めないので、それより条件は易しい)。
- apport が `--core=0` の子から受け取ったコアをどう扱ったか (ホストの側を見られない)。
- PID の取り違えが起きないこと (15.4 の (7) はコードの読みによる)。
- k8s の上で親が PID 1 として動き、親が終わったときにコンテナの中のプロセスがまとめて止まること (見張りの worker とは別の守りになる見込み。確かめていない)。
- JavaScript のヒープの余地と 400 万字の 1 ページの変換 (15.4 の (4) の表) は各 1 回だけ測った。V8 が WASM の予約を上限の残りに合わせる仕組みと、`RLIMIT_AS` で読み込みが遅くなる仕組みは確かめていない。`--wasm-max-mem-pages` を付けたときに、ほかの PDF (ベンチマークのもの、48MiB の PDF) が今までどおり変換できるか。
- `net.Socket` の見張りの worker で、子が自分で終わる経路は 20 回ずつ繰り返したが、本物の変換 (大きな XLSX や PDF) の途中で `process.exit` が呼ばれる場合は確かめていない。
- `codeRangeSizeMb: 4` の worker が長い時間 (数十秒) 動いたときの振る舞い (計測は最大 60 秒の同期の処理の途中で親を消すもので、問題は出なかった)。

### 15.10 3.2 の 3 回目のレビューでの補足

- `process.exit()` が worker の終了を待つことは、Node v24.21.0 のソースで確かめた。`src/env.cc` の `stop_sub_worker_contexts` は、worker ごとに `Exit()` を呼んだ後 `JoinThread()` (`uv_thread_join`) で終わりを待つ。`Exit()` は、そのスレッドで JavaScript の実行を止め、イベントループを起こして `uv_stop` を頼む。カーネルの中で読み取りを待っているスレッドには、どちらも届かない。
- worker が fd 4 を `net.Socket` として開くと、fd 4 に `O_NONBLOCK` が付く (実測: `02000002` → `02004002`)。fd 0 と fd 3 は変わらない。メインのスレッドでは fd 4 を `readSync` しない。
- worker 自身のヒープが足りなくなると (`ERR_WORKER_OUT_OF_MEMORY`)、子全体は落ちず、メインのスレッドに `'error'` が届く。ただしメインが同期の処理をしている間は届かない (メインを 1,500ms 止めたら 1,502ms に届いた)。その間は親の消失を検知できない。何もしない小さな worker なので起こる見込みは低い。**既知の限界**として、6.6 の実装とテストで扱う。
- 手本の worker は、`eval: true` の素の JavaScript の文字列。TypeScript にしても変わらない。子の入口は `process.execPath` で直接起動するので、ビルド後の JavaScript (または Node 24 の型の取り除き) を指すパスの解決を 6.6 で決める。
- 15.3 の表の「結果の 20ms 後」の行は、実行によって止まる場合と止まらない場合がある (worker の起動に約 23ms かかり、どちらが先かで変わる)。再現では 23.5ms で終わった回があった。
- worker の準備ができる前に親が消えた場合、子は 46〜50ms で終わった (5 回)。

### 15.11 ユーザーの判断 (タスク 3.2、2026-11-05)

- 子のコアダンプの上限は **`--core=1` を採る**。理由: `--core=0` は、コアダンプをプログラム (apport など) に渡す `core_pattern` の環境で無視され、コアの中身が外に流れる。`--core=1` なら、そのような環境でも、カーネルが渡し先を起動せずコアを作らずに終わる (15.1 (d)、15.4 (1'))。Python 版 (`RLIMIT_CORE` を 0 にするだけ) より守りが強くなり、Req 3.12 (Req 1.13 で崩せない不変条件) をより確実に守る。追加の部品は要らない。
- `--core=1` は man (core(5)) に記述が無く、カーネルのソースのコメントだけに頼る挙動 (Linux v3.10〜v6.12 で確認)。この点は 15.9 に書いてある。
- 6.6 の実装は、`prlimit-args.ts` で `--core=1` を使う。4.3 のテストは、`/proc/<pid>/limits` で `1 1` を外から確かめる。
- 設計への反映: この spec の design.md の Security Considerations と `prlimit-args.ts` の説明は直した。対象 spec の design.md の ChildEntry の「`RLIMIT_CORE` を 0 にする」の説明は、取り込みのとき (Req 12) に直す (Follow-ups)。

