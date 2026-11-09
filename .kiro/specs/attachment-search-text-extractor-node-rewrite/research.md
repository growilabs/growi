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
| `RLIMIT_AS` の値と、緩めた分の守り | 決定 (`MAX_CHILD_RSS_MB` + 2,304MiB、既定で 2,624MiB。子の `env` に `MALLOC_ARENA_MAX=2` を足す。主な守りは RSS の監視。19 節) | 試作と計測 (Req 11.5) |
| 本文の受け取りと切断の検知の方法 | 決定 (`c.env.incoming` を上限と期限つきで直接読み、python-multipart と Starlette の文法と引数の解析を移した自前の解析器 1 つで分解する。ファイルは断片のまま連結しない。切断は `incoming` の `close` と `c.req.raw.signal`。16 節)。本文の形の例外 3 件 (37・d37・要求の `charset`) は、ユーザーの判断待ち (7.4) | 試作 (Req 11.6) |
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

### 7.4 本文の形の 3 つの例外の扱い (タスク 3.3、2026-11-05。ユーザーが判断した。7.5 に決定を記録した)

タスク 3.3 の作業者の案。ユーザーが判断するまで、崩したことにはしない。測った結果は 16.1 と 16.4 にある。**推奨は、3 つとも許容する (Python 版と同じにしない) こと。**

- **(a) 何を崩すか**: 対象 spec の design.md §Error Handling の表のうち、「本文の形が不正 → 422 `extraction_failed`」と、正しい本文なら変換する (200) という扱いを、次の 3 つの場合に限って Python 版と同じにしない。Req 1.3 の「同じ失敗の条件に同じコードとステータスを返す」を、この 3 つで崩すことになる。
  1. **`Content-Length` が実際の本文より小さい** (16.4 の 37 番)
     - Python 版: 422 `extraction_failed`
     - Node 版: 本文が空で `code` の無い `400 Bad Request` を返し、接続を閉じる
  2. **boundary に CR が入っている** (d37 番。`boundary*=UTF-8''a%0D%0Ab` のように RFC 2231 の形で書いたときだけ作れる)
     - Python 版: 200 (CRLF を含む区切りのまま分解する)
     - Node 版: 422
     - LF だけを含む boundary (m64 番) は、Node 版も Python 版と同じく受け付ける (200)。
  3. **要求の `Content-Type` の `charset` を、Node 版は使わない** (m58〜m61・d12・v01〜v20 番)
     - Python 版 (Starlette): 部品の名前・ファイル名・`mimeType` の値を、要求の `charset` で読む (無ければ UTF-8)。その名前の文字コードが Python に無いか、読めなければ latin-1 で読む。
     - Node 版: `charset` を見ず、いつも「UTF-8 として正しければ UTF-8、そうでなければ latin-1」で読む。
     - 影響は次の 5 種類ある。どれが起きるかは、送り手が名前を宣言した `charset` で本当に符号化しているかで決まる。
       - **Python 版 422、Node 版 200** (宣言だけして、名前は ASCII のまま送る送り手): `charset=utf-16` (m58・v18 番)、`charset=cp037` (m61 番)、`charset=utf-8; charset=utf-16` のように 2 つ書いて後ろが `utf-16` (v11 番) では、Python 版は部品の名前 `file` を別の文字に読み (`utf-16` では `楦敬`)、`file` が無いとして 422 `extraction_failed` を返す。Node 版は 200 で変換する。
       - **Python 版 200、Node 版 422** (宣言した `charset` で名前を正しく符号化してくる送り手): 名前とファイル名を `utf-16` (v01 番)、`cp037` (v02 番)、`utf-16-le` (v16 番) で符号化した要求は、Python 版は正しく `file` と読んで 200 で変換する。Node 版は部品の名前が `file` に読めず 422 にする。**この向きでは Python 版のほうが役に立つ動き**である。
       - **拡張子が変わる**: `charset=utf-7` でファイル名が `a.+AHQAeAB0-` (v07 番) のとき、Python 版は `a.txt` と読み、Node 版はそのまま読む。Node 版では形式の判定が変わり、変換すれば 400 `unsupported_format` になる見込み (試作は変換しないので、生の要求の状態はどちらも 200)。
       - **Python 版が 500**: `charset=punycode` (v10 番) では、Python 版は `_user_safe_decode` が捕まえない `UnicodeError` で `code` の無い 500 を返す。Node 版は 200。
       - **ファイル名の読み方が変わる** (状態は同じ 200): `charset=iso-8859-1` で名前が UTF-8 (m59 番)、知らない `charset` (m60 番) では、Python 版は名前を latin-1 で読んで崩し (`日本.txt` が `æ\x97¥æ\x9c¬.txt`)、Node 版は正しく `日本.txt` と読む。`charset=shift_jis` で名前が生の Shift_JIS (d12・v03 番)、`euc-jp` (v19 番)、`iso-2022-jp` (v20 番)、`cp1252` の 0x80 (v15 番) では、逆に Python 版が正しく、Node 版が崩す。`charset=us-ascii` で名前が UTF-8 (v06 番) は、Python 版が崩し、Node 版が正しい。どれも拡張子は同じで、形式の判定は変わらない。
- **(b) 守ると何がどう複雑になるか**:
  - 1 (`Content-Length` が小さい): 宣言より後ろに余ったバイトを、Node の HTTP の解析器が「次の要求」として読む。それが壊れているので 400 を返し、まだ書いていない応答 (ハンドラーが判定した 422) を捨てる。同じことは、`Connection: close` の要求の後ろに次の要求を続けて送った場合にも起きることがある (16.5)。合わせるには `server.on('clientError')` で Node の既定の処理を差し替える必要があり、応答を書いている途中の要求があるかを、Node 本体の内部の状態 (`socket._httpMessage`) で調べることになる。
  - 2 (boundary の CR): 解析器は、区切り (`\r\n--` + boundary) の中で CR が先頭にしか無いことを前提に、断片の切れ目をまたぐ区切りの候補を「最後の CR から後ろ」だけで持ち越している (16.8 の `parse-multipart.mjs`)。boundary に CR を許すと、この単純な判定が使えなくなり、python-multipart と同じ一般の照合 (候補を複数持つ形) に書き換えることになる。LF はこの前提に関わらないので許した。RFC 2046 は boundary に CR と LF を使うことを禁じている。
  - 3 (`charset`): Python の文字コードの名前と、Node の `TextDecoder` が受け付ける名前は一致しない。`iso-8859-1` は `TextDecoder` では windows-1252 として扱われ、`cp037` (EBCDIC) と `x-nope` は使えない (例外になる)。完全に同じにするには、Python の codecs の名前と変換表 (`utf-7`・`punycode` なども含む) を移すことになり、手軽ではない。Python の振る舞いは、宣言どおりに名前を符号化してくる送り手には役に立つ (v01・v02・v16) が、宣言だけの送り手では `file` の部品が見つからなくなり (m58・m61・v11・v18)、`punycode` では 500 になる (v10)。どちらの送り手も apps/app ではない。
- **(c) 下流の変更の範囲**: なし。
  - apps/app (axios) は、`Content-Length` を本文から計算して付ける (1 は起きない)。
  - axios は boundary を英数字と `-`・`_` だけで作り、`boundary*=` の形を使わない (2 は起きない)。
  - axios は multipart の `Content-Type` に `charset` を付けない (3 は起きない)。ファイル名は UTF-8 で送る。
  - 生成クライアントと OpenAPI の文書は変わらない。1 の 400 は、Node の HTTP の解析器が、ほかの壊れた HTTP の要求にも同じように返す本文の無い応答で、OpenAPI の文書が決める応答の外にある。
  - 運用者から見える変化: 1 の形の要求では、ハンドラーは 422 と判定するが、届く応答は Node の 400 になる。1 件ごとのログ (Req 1.7) の「結果」の欄が、実際の応答と食い違う。ログを書く位置 (ハンドラーが判定したときか、応答を送り終えたときか) で、出るログが変わる。6.x でログの位置を決めるときに確かめる。
- **崩したことにはしないが、理由つきで Python 版と違うもの** (16.1 の「理由つきで許容するもの」):
  - d36・m21 番 (`filename*=` と `filename*0=` を混ぜる): Python 版は捕まえていない例外で `code` の無い 500 を返す。Node 版は表どおりの 422 `extraction_failed`。Python 版が自分のエラーの表に外れているので、Node 版は表に合わせる。
- **反映先 (ユーザーが認めた場合)**:
  - この spec の design.md の Revalidation Triggers に、「本文の形の 3 つの例外 (`Content-Length` が小さい要求は `code` の無い 400、CR を含む boundary は 422、要求の `charset` は使わない)」を足す。
  - 取り込みのとき (Req 12) に、対象 spec の design.md §Error Handling の表に、この 3 行を書き足す。
  - 4.x と 6.x のテストは、この 3 つ (m58〜m61・d12・v01〜v20 番を含む) と d36・m21 番で、Python 版と期待を分ける。
  - 完了の報告でユーザーに示す。

### 7.5 ユーザーの判断 (タスク 3.3、2026-11-05)

7.4 の 3 件を、ユーザーは次のとおり決めた。どれも Req 1.10 の手続きで契約を崩す扱いにする。下流の変更は無い (apps/app (axios) はどの形も送らない)。

| # | 要求 | Python 版 | Node 版 | 決定 |
|---|---|---|---|---|
| 1 | `Content-Length` が実際の本文より小さい (37 番) | 422 `extraction_failed` | `code` の無い 400 (Node の HTTP の解析器が返す) | **許容する**。合わせるには Node の内部の状態 (`socket._httpMessage`) に頼る必要があり、複雑さに見合わない |
| 2 | boundary に CR が入っている (d37 番) | 200 | 422 | **許容する**。RFC 2046 が禁じる形。合わせると、区切りの持ち越しの単純な判定 (最後の CR だけを見る) を失う |
| 3 | 要求の `Content-Type` の `charset` (m58〜m61、v01・v02・v07・v10・v11・v16・v18、d12) | 部品の名前・ファイル名・`mimeType` を `charset` で読む | `charset` を使わない (UTF-8 として正しければ UTF-8、そうでなければ latin-1) | **許容する** (ユーザーの指示は「シンプルでコード量が少なく済む解にして」)。`charset` を使うには Python の codec 表を移す必要があり、Node の `TextDecoder` の名前と一致しない |

- Req 1.10 (a) 何を崩すか、(b) 守ると何が複雑になるか、(c) 下流の変更の範囲: 上の表と 7.4 のとおり。下流の変更は無い。
- 引き継ぎ: この spec の design.md の Revalidation Triggers に、「本文の形の例外 3 件 (`Content-Length` が小さい要求、boundary の CR、`charset` を使わないこと)」を足す。取り込み (Req 12) のとき、対象 spec の design.md の Error Handling の表と requirements に反映する。6.x の固定データ (16.9 (a)) には、この 3 件に当たる要求を「期待を分ける」ものとして入れる。
- 12 番 (`Connection: close` を付けて 2 件目を続けた場合に 422 が捨てられて 400 だけ届くことがある) は、1 と同じ仕組みで、同じ決定の範囲とする。
- **項目 1 への訂正の注記 (タスク 4.4 とそのレビュー、2026-11-09)**: 表の「Python 版: 422」は、測り直すと再現しなかった。Python 版 (uvicorn 0.46.0 + httptools、research.md 8 節の既定の設定) に、`Content-Length` を本文より 5・10・20・21・40・60・80・100 バイト小さくした multipart の要求を送ると、一度に送っても、見出しと本文を分けて送っても、毎回 `code` の無い 400 (本文は `Invalid HTTP request received.`) だった (4.4 の作業で 30 回、レビューで 8 通り)。1・2 バイトの差は終わりの区切りが削れないので 200。余りのバイトを 0.7 秒遅らせて送ると、Python 版も Node (Hono) も 200 の後に 400 を返した。httptools も、余りのバイトをすぐ「次の要求」として読んで 400 を返し、接続を閉じる (7.4 の (b) が Node について書いた仕組みと同じ)。つまり、この要求への状態は Python 版と Node 版で同じで、ユーザーが許容した Node 版の振る舞い (`code` の無い 400) は変わらず、契約は何も崩れていない。誤っていたのは「Python 版は 422」という前提だけである。ほかの送り方 (たとえば別の HTTP の実装の uvicorn、より大きな本文) は確かめていない。黒箱のテストに理由の id `7.5-1` は無い (22.5)。完了の報告 (Req 1.12) で、ユーザーに「7.5 の 1 は実際には差が無かった」と伝える。

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

## 16. 本文の受け取りと multipart の分解 (T4、タスク 3.3)

2026-11-05 に devcontainer (Node 24.21.0、16 コア、Linux) で、使い捨ての場所 (scratchpad) に試作を作って確かめた結果。

- 版: `hono` 4.13.16、`@hono/node-server` 2.1.6。比べた部品は `@fastify/busboy` 3.2.4、`busboy` 1.6.0。
- 比べる相手の Python 版: research.md 8 節の手順で uvicorn を起動したもの (Python 3.12.15、python-multipart 0.0.27、Starlette 1.0.0)。
- 変えていないもの: 抽出サービスの package、lockfile、`pnpm-lock.yaml`、本番の `src/`、Python 版。
- 数字はすべて **実測** (そうでないものは「未検証」と明記)。Node の slim image の中では測っていない。
- 4 回のレビュー (差し戻し) と、その間の根本原因の調べを受けて書き直した。2 つ前の版は「自分で書いた本文の形の検査 + `@fastify/busboy`」を採っていた。その形を捨てた理由は 16.7 と 16.10 にある。4 回目のレビューの指摘 (早めのエラー応答の後にソケットが残る、要求の `charset`、LF を含む boundary など) と直し方も 16.10 にある。

### 16.1 結論

**採る方法**: 本文を少しずつ分解する、**自分で書いた解析器 1 つ** (design.md の T4 の候補 (c)「自分で境界 (boundary) を探して分解する」)。本文の形の判定と、`file` と `mimeType` の取り出しを、同じ 1 つの解析器が同じ文法で行う。次の 5 つを組み合わせる。312 通りの生の要求と、上限・期限・切断の全場面を、この組み合わせのまま 1 つのサーバー (16.8 の手本を研究ノートから書き出したもの) で流して確かめた (16.4、16.5)。

1. **本文の読み方**: Node の要求のストリーム `c.env.incoming` を、`'data'` の受け手で直接読み、届いた断片をその場で解析器に渡す。
   - 本文全体の上限 (`MAX_FILE_SIZE_MB` + 64KiB) は、届いたバイト数で数える。
   - 期限 (`UPLOAD_TIMEOUT_S`) は受け取り全体に 1 つだけ掛ける。期限と切断の見張りは、結果が出るか失敗するまで外さない。解析器は同期的に動く (下の 2) ので、この見張りが働くのは遅い本文のときだけである。
   - 切断は、本文の途中なら要求のストリームが `complete` にならないまま閉じたことで、本文を受け取り終えた後なら `c.req.raw.signal` の `abort` で分かる。
   - `c.req.raw.body` (標準の `ReadableStream`) は使わない。`@hono/node-server` がこれを `Readable.toWeb` で作り、断片ごとに 1 回コピーするためである (16.6)。
2. **本文の分解** (自分で書いた解析器。状態の遷移と中身の持ち方が約 170 行、部品のヘッダーの引数の解析が約 90 行。16.8 に全文がある)。python-multipart 0.0.27 の `MultipartParser._internal_write` と、Starlette 1.0.0 の `MultiPartParser` (`extract_upload.py` と同じ設定) を読んで移した。文法と上限は次のとおり。
   - **先頭**: CR か LF で始まる本文は、最初の `-` まで読み飛ばす。それ以外の本文は、最初の区切り (`--` + boundary) で始まらなければならない。
     - python-multipart は、この読み飛ばしを**1 つの断片の中だけで**行う (`data.find(b"-", i)` が見つからなければ断片の残りを捨て、次の断片の先頭からは読み飛ばさない)。このため、前置きの文が断片の切れ目をまたぐと、Python 版では通るかどうかが変わる。
     - Node 版は、断片の切れ目に依らず「最初の `-` まで」読み飛ばす。前置きが最初の断片に収まる普通の場合 (e01・e02・r01・r02・r03・r05 番) は、Python 版と同じ 200 になる。前置きの中に `-` があれば、どちらも 422 (e02b 番)。
   - **区切りの直後**: 最初の区切りの直後は CRLF (部品が始まる) か `--` (空の本文) だけを許し、それ以外は 422 (空白の詰め物 e03・e33 番も 422)。2 つ目以降の区切り (`\r\n--` + boundary) の直後が CRLF でも `--` でもなければ、python-multipart と同じく、その並びを部品の中身として扱って続ける (e07 系・r20・r21・r23・r41 番。どれも Python 版と同じ大きさの中身になった)。
   - **部品のヘッダー**:
     - 各行は「名前 + `:` + 値 + CRLF」の形でなければならない。名前は空でなく、token の文字 (英数字と `` !#$%&'*+-.^_`|~ ``) だけ。名前と `:` の間の空白、CR の無い LF、行頭の空白 (折り返し)、`:` の無い行は 422。
     - 値の中の CR の後は LF でなければならない。
     - 1 行は 4,224 バイト (改行を除く) まで、1 つの部品のヘッダーは 8 行まで。
     - ヘッダーの終わりは空行 (CRLF)。
     - `Content-Disposition` が 2 行あれば、最後の行を使う (Python 版と同じ。r14 番)。
   - **部品のヘッダーの引数の解析**: python-multipart の `parse_options_header` が中で使う Python の `email` の処理 (`email.message._parseparam`、`email.utils.unquote`・`decode_params`) と、python-multipart の IE6 向けのパスの修正を、癖ごと移した。主な点は次のとおり。
     - `;` で区切るとき、引用符の内側かどうかを、Python と同じ数え方 (`"` の数から `\"` の数を引く) で判定する。
     - 引用符を外すときは `\\` と `\"` だけを戻し、`<...>` の形も外す。
     - 前後の空白の削り方は Python の定義に合わせる (`\x1c`〜`\x1f` と `\x85`、`\xa0` を含む)。
     - RFC 2231 / 5987 の形 (`filename*=`、分割した `filename*0*=`・`filename*1=` …) を番号の順につなぎ、`%XX` を戻し、`charset'language'` を外す。`filename*` があれば `filename` より優先する。番号の付いたものと付かないものが混ざると、Python と同じく読めない (下の d36)。
     - 引数の名前の判定 (`name*` の形か) は、Python の正規表現が `re.ASCII` で作られているので ASCII の英数字と `_` だけで行う。番号は桁数の制限なしに比べる (`BigInt`)。
     - ファイル名が `C:\` や `\\` で始まるときは、最後の `\` の後ろだけを残す (python-multipart の IE6 向けの修正)。`dir/sub/a.txt` はそのまま残す (05 番。Python 版と同じ)。
     - 結果は `Object.create(null)` に入れる (`__proto__` という名前の引数が普通のキーになる。d13・d14 番)。
     - 部品の名前とファイル名は、UTF-8 として正しければ UTF-8、そうでなければ latin-1 として読む (要求に `charset` が無いときの Starlette の `_user_safe_decode` と同じ)。
     - **要求の `Content-Type` の `charset` は使わない**。Starlette は `charset` があればそれで部品の名前・ファイル名・`mimeType` を読むので、`charset` の付いた要求では Python 版と違いうる (7.4 の 3 で諮る)。
   - **要求のヘッダーは `c.env.incoming.headers` から読む** (`authorization`・`content-length`・`content-type`・`expect`)。Hono の `c.req.header()` は Web の `Headers` を読むので、同じ名前のヘッダーが 2 行あると `, ` でつないだ 1 つの値を返す。Node の `incoming.headers` は、`authorization` と `content-type` の重複では最初の値を使い、Starlette と同じになる (w01・w13〜w15・w17〜w19 番。`Content-Length` の重複は、どちらも HTTP の層で 400 にする (w16 番))。
   - **Starlette の決まり**: すべての部品に、`name` の付いた `Content-Disposition` が要る。ファイル名があればファイル、無ければ普通の項目。ファイルは 1 個まで、項目は 1,000 個まで、1 つの項目は 1MiB まで (Starlette の既定と同じ値)。同じ名前の部品が 2 つあれば、最後に終わった方を使う。
   - **中身の持ち方**: 中身を持つのは、名前が `file` のファイルと `mimeType` の項目だけ。ほかの部品は大きさを数えるだけで捨てる。
     - 16KiB 以上の断片は、届いた `Buffer` をそのまま (写さずに) 持つ。
     - 16KiB 未満の断片は、64KiB の塊に写してまとめる。細かい TCP の断片で届いた本文が、数百万個の小さな `Buffer` になって溜まるのを防ぐためである (16.6 の「1 バイトずつ」)。
   - **終わり**: 本文が終わった時点で、終わった部品だけを使う (Starlette と同じ)。終わりの区切り (`--` + boundary + `--`) まで届いていなくても、`file` の部品が終わっていれば 200 になる (d15〜d17 番)。`file` の途中で切れていれば 422 (29・d18 番)。終わりの区切りの後ろ (後置き) は読み捨てる。
   - **`Content-Type`**: メディアタイプが `multipart/form-data` と 1 字も違わず一致することを確かめる (Python 版と同じく、大文字小文字を区別する)。boundary は同じ引数の解析で取り出すので、`boundary=` が 2 つあれば最後の値、`boundary*=` の形も読める (r31・d30 番)。**CR を含む boundary は 422 にする** (d37 番。7.4 で諮る)。LF だけを含む boundary は、Python 版と同じく受け付ける (m64 番)。
   - **ファイルの大きさ**: 分解が終わった後で `MAX_FILE_SIZE_MB` と比べる (Python 版の `enforce_size` と同じ位置)。
   - **失敗の伝え方**: 不正な本文は、すべて `write()` か `end()` の中で同期的に例外 (`InvalidMultipart`) を投げる。イベントで失敗を知らせる部品を使わないので、「`finish` も `error` も出さずに止まる」(16.10) ことが構造の上で起きない。`'error'` の受け手も要らない。
3. **ファイルの持ち方**: 上の断片と塊を配列のまま持ち、**親の中では 1 つの `Buffer` に連結しない**。子へは、長さの見出しの後に断片を順に書く。
4. **早めに返すエラー応答** (413 / 408 / 503 / 422 / 401): 応答の後に Node が接続を閉じる要求 (`c.env.outgoing.shouldKeepAlive === false`。HTTP/1.0 で keep-alive を頼んでいない要求と、`Connection: close` の要求) に限って、このソケットの `destroySoon` を差し替える。
   - 応答の後、Node はこの関数でソケットを閉じる (こちらの送信を終え (FIN)、送り終えたらソケットを壊す)。差し替えた関数は、読み残した本文を読み捨ててから、**元の `destroySoon` を呼んで Node の普通の閉じ方に戻す**。
   - 読み捨ての歯止めは 2 つある。本文を読み始めた後の経路 (chunked の途中の 413、422) では、64MiB を読み捨てた時点で切る (5 回目のレビューの計測では、約 75MB 送った時点で接続が切られた)。本文を一度も読んでいない経路 (宣言の 413、401) では、Node が先に本文を捨てる動き (`_dump`) にするので読み捨ての受け手に `'data'` が届かず、歯止めは 500ms のタイマーだけになる。このときメモリには何も溜まらない。
   - 読み捨ての後に `socket.end()` (こちらの送信を終えるだけ) で済ませてはいけない。http.Server のソケットは相手が送信を終えるまで受信側を開いたままにするので、FIN を送らない相手のソケットが閉じられずに残る。応答を返し終えた接続には Node のどの時間切れも掛からず、トークンの無い 401 でも起きる (前の版の手本の誤り。16.10)。
   - 差し替えた関数は、同じソケットで 1 回だけ動く (Node と `@hono/node-server` の両方が呼ぶことがあるため。ソケットを `WeakSet` に覚えておく)。
   - 応答の `Connection: close` はそのまま正しく返る。比べた案と副作用は 16.5 にある。
5. **`Expect: 100-continue`**: `server.on('checkContinue')` で受け、本文を読むと決めた後で `c.env.outgoing.writeContinue()` を呼ぶ。

順序は Python 版と同じで、次のとおり。

1. 認証
2. `Content-Length` の宣言が上限を超えたら 413 (枠を取らず、本文も読まない)
3. 枠を待たずに取る (空きがなければ 503)
4. 上限と期限つきで受け取りながら分解する
5. ファイルの大きさを `MAX_FILE_SIZE_MB` と比べる
6. 変換

**どの経路でも枠が返ることを確かめた** (16.5): 273 通りの要求を 5 つの送り方 (まとめて送って待つ、まとめて送って 400ms で切る、3 回に分けて送る、1 バイトずつ送る、半分送って切る) で送り、そのたびに使用中の枠の数と次の要求の応答を見た。1,326 回のどれでも、枠が戻らない・次の要求が 200 にならない・待っても応答が無い、は 0 回だった。早めのエラー応答の後に、FIN を送らない相手のソケットが残らないことも確かめた (16.5)。

**メモリ**: 50MiB を 3 件同時に送ったときの親の最大 RSS は、採る形で **218〜225MiB** (1 回)、**226〜285MiB** (3 回続けて)。Python 版は 263〜264MiB (前の計測)。同じ程度で、3 回続けての上の端は Python 版を少し上回った。

- 1 回は 7 回 (変換の代わりに 1.5 秒待つサーバーで 2 回 225MiB、16.8 の手本 (待ちなし) で 5 回 218〜225MiB)、3 回続けては 14 回 (待つサーバーで 2 回 248〜250MiB、手本で 12 回 226〜285MiB) 測った。手本の 12 回は 226・226・229・231・232・245・247・247・247・281・281・285MiB で、ばらつきが大きい。うち 4 回 (226〜247MiB) は、早めのエラー応答の閉じ方を直した後の手本で測った (直した部分は、この計測の経路を通らない)。

- ただし測っている範囲が違う。Python 版の値は子への受け渡しを含み、Node 版の値は子への書き込みを含まない (16.3)。
- このため design の T4 のメモリの基準 (「Python 版の 263MiB を大きく超えない」) は、3.7 で子と組み合わせて測り直すまで **「仮に満たす」** 扱いとする。
- 1 バイトずつの TCP で届く本文では、上の値と別の振る舞いになる (16.6)。採る形では、読み捨てるだけのサーバーと同じ程度に収まった。

**Python 版と違う点** (273 通りのうち、状態が違ったのは 13 通り。16.4):

- **7.4 でユーザーに諮るもの** (状態が変わり、合わせると仕組みが複雑になる):
  - (1) `Content-Length` が実際の本文より小さい (37 番): Python 版 422、Node 版は `code` の無い 400。
  - (2) boundary に CR が入っている (d37 番。`boundary*=UTF-8''a%0D%0Ab`): Python 版 200、Node 版 422。
  - (3) 要求の `Content-Type` の `charset` を Node 版は使わない。影響は 5 種類 (7.4 の 3): 宣言だけの `utf-16`・`cp037` (m58・m61・v11・v18 番) は Python 版 422 / Node 版 200、宣言どおりに符号化した名前 (v01・v02・v16 番) は逆に Python 版 200 / Node 版 422、`utf-7` (v07 番) は拡張子が変わる、`punycode` (v10 番) は Python 版が `code` の無い 500、ほかの 8 通り (m59・m60・d12・v03・v06・v15・v19・v20 番) はどちらも 200 でファイル名の読み方だけが違う。apps/app (axios) は `charset` を付けない (axios 1.15.0 の `formDataToStream.js` の 97 行で、`Content-Type` を `multipart/form-data; boundary=…` だけで作っている)。
- **理由つきで許容するもの**:
  - **番号の付いた `filename*0=` と付かない `filename*=` を混ぜた引数** (d36・m21 番): Python 版は `email.utils.decode_params` の `TypeError` を捕まえず、`code` の無い 500 を返す。Node 版は表どおりの 422 `extraction_failed` を返す。Python 版が自分の契約 (エラーの表) に外れているので、Node 版は表に合わせる。崩したことにはしない。
  - **前置きの文が断片の切れ目をまたぐ場合**: 上の 2 の「先頭」のとおり。Python 版の結果は断片の切れ目に依るが、Node 版は依らない。
  - **1 つの接続で続けて送った要求 (パイプライン)**: Node は 2 件を同時に処理し、それぞれが枠を 1 つずつ取る。接続を切ると 2 件とも止まる。uvicorn は 1 件ずつ処理し、切断の印は新しい方にしか付かない。Node 版のほうが、対象 spec の AC 2.9「切断したら止める」をよく満たす。apps/app (axios) はパイプラインを使わない。
- **試作が変換をしないために違って見えるもの** (違いではない): 07・r08・r36・d10・d33・d38・x08 番。Python 版は解析の後の変換で 400 `unsupported_format` か 422 になる。解析器だけで比べると、x08 番以外は、Node 版も Python 版と同じファイル名・大きさ・中身を取り出した (16.4)。x08 番 (chunked の本文) は解析器だけの比較に入れていないが、Python 版の応答は名前から形式が分からないときの 400 で、r08 番と同じ形の名前である。変換すれば同じ状態になる見込み。
- **解析器が Python 版と同じ文法で判定するもの**: 前の版で「本文の形の検査」で合わせていたもの (部品のヘッダーの長さと行数、ヘッダーの文法、名前の無い部品、前置き、大文字の `Content-Type`。19・20・28・31・33〜36・38・e02b・e06・e10〜e14・e22・e27・e31b・h1・h3 番) と、前の版で `@fastify/busboy` のために Python 版と違っていたもの (r01・r02・r05・r12・r14・r16・r31・r34・e15b・40・e07 系・r20・r21・r23・r41・03・05・42・d01〜d11 番など。16.4) は、どれも 1 つの解析器が同じ文法で判定するので、Python 版と同じになった。
- **設定で Python 版に合わせたもの**:
  - `Expect: 100-continue`: 100 を返さずに 413 を返す。
  - 応答の後に閉じる接続 (HTTP/1.0 と `Connection: close`) への早めの 413 が届かない件と、その直し方でソケットが残らないこと: 16.5。
- **Python 版と同じだったもの** (主なもの):
  - 後置き (39・e23・e25 番)
  - `mimeType` が 2 つあれば、どちらも最後の値を使う (41・d20 番)
  - `filename*` を `filename` より優先する (03 番)。ファイル名のパス `dir/sub/a.txt` はそのまま、`C:\Users\x\a.txt` は `a.txt` (05・06・d24 番)
  - 生の cp932 のファイル名は、どちらも同じ形に崩れ、拡張子は残る (42 番)
  - `Content-Transfer-Encoding: base64` の部品は、どちらも解かずに中身として扱う (43 番)
  - 宣言が実際の本文より大きい場合は、どちらも期限で 408 (16.5)
  - 入れ子の `multipart/mixed` は、どちらも中身をそのまま 145 バイトとして扱う (e16 番。Python 版の応答の 130 は変換の後の文字数で、CRLF が LF になった分だけ少ない)
  - 空の boundary・大文字の `BOUNDARY=`・`charset` つきの `Content-Type` など: e19・e20・e26・e28〜e30 番
  - 同じ名前のヘッダーが 2 行ある要求: `Content-Type` が 2 行 (w01・w13・w14・w17 番)、`Authorization` が 2 行 (w15・w18・w19 番) は、どれも最初の値を使い、Python 版と同じ (要求のヘッダーを `c.env.incoming.headers` から読むため。`c.req.header()` で読むと w01・w17 は 422、w15・w18 は 401 になった。16.10)
  - HTTP のヘッダーの癖 (w02〜w12・w16 番): `Transfer-Encoding` と `Content-Length` の両方、`Content-Length: +5`、`Content-Length` が 2 行 (同じ値でも違う値でも)、折り返したヘッダー、桁の多すぎる `Content-Length` は、どちらも 400 (`code` は無い)。小文字の `bearer` と空白 2 つの `Bearer` は、どちらも 401
- **部品の `Content-Type` (MIME)**: Python 版は部品の `Content-Type` を使わず、変換に渡すのは `mimeType` の項目 (手がかり) だけである。Node 版の解析器は、部品の `Content-Type` を取り出さない。
- **既知の別件**: apps/app のいまの呼び出しは、`file` をファイル名の無い普通の項目として送っている。生成クライアントの `FormData.append('file', buffer)` で、`Buffer` が文字列になるためである (リポジトリの axios 1.15.0 で送った生の本文で確かめた。バイナリは U+FFFD に置き換わって壊れる)。Python 版も Node 版も 422 にする (21 番)。既知の問題で、担当は attachment-search-indexing spec。この spec の範囲の外であり、Node 版をこの形でも受け付けるように変えてはいけない。

### 16.2 比べた候補

| 候補 | 中身 | ライセンス | 依存 | install のスクリプト | 大きさ | 最後のリリース | 結果 |
|---|---|---|---|---|---|---|---|
| (a) 標準の `Response.formData()` | 上限と期限つきで本文をメモリに読み切り、`new Response(body, { headers }).formData()` で分解する (Node に入っている undici の解析器)。Hono の `c.req.parseBody()` も中で `formData()` を使うので、同じ扱いになる | Node 本体 (追加の部品なし) | なし | なし | 0 | — | 採らなかった |
| (a') `busboy` / `@fastify/busboy` をメモリで | 本文を読み切ってから、まとめて部品に渡す | 下の行と同じ | | | | | 採らなかった |
| (b) 本文の形の検査 (自分で書いた約 160 行) + `@fastify/busboy` で少しずつ | 届いた断片を、検査と部品の両方に渡す (前の版の採用) | MIT (`package.json` に明記) | なし | なし | JS で 2,051 行 (テストとベンチマークを除く。npm の `unpackedSize` は 252,112 バイト) | 3.2.4 が 2026-10-22、3.2.3 が 2026-10-10 | 採らなかった |
| (b') `busboy` 1.6.0 で少しずつ | 同上 (検査なし) | MIT (LICENSE のファイル。**`package.json` に `license` の欄が無い**。依存の `streamsearch` 1.1.0 も同じ) | `streamsearch` | なし | 192KB + 60KB | 2022-04-19 | 採らなかった |
| **(c) 自分で書く解析器 (採用)** | 境界を探して部品を分け、本文の形の判定と `file`・`mimeType` の取り出しを 1 つで行う | (自分たちのコード) | なし | なし | 約 260 行 (状態の遷移と中身の持ち方 約 170 行、引数の解析 約 90 行。16.8) | — | **採用** |

- **(c) への反論**: 前の版では、(c) の全体 (中身の取り出しまで) を書かなかった。ファイル名の取り出しと `filename*` の符号化の解読 (RFC 2231 / 5987) を、攻撃を受けうる入口のコードとして自分たちで持ち続けることになるためだった。
  - **答え**: 引数の解析は約 90 行で、Python の `email` の処理を癖ごと移したものなので、正しさを Python と直接突き合わせられる。ランダムに作った 80 万件の引数で、python-multipart の `parse_options_header` と結果が 1 件も違わなかった (16.4)。
  - 部品に任せても、その部品と Python 版の決まりの違い (03・05・d01〜d11 番など。16.4) を自分たちで見張り続けることになり、手間は減らない。前の版では、検査と部品の 2 か所に決まりがあり、その間のずれが不具合になった (16.7)。
  - 依存を足さないので、ライセンスの確認、install のスクリプト (`allowBuilds`)、脆弱性の勧告の見張りの対象が増えない。
- `formidable` は一時ファイルに書く設計なので、メモリだけで受け取る要件 (Req 3.3) に合わず、外した (試していない)。
- (c) はファイルシステムを使わない (`node:buffer` 以外を読み込まない)。

### 16.3 比べ方

- **同じ生のバイト列を両方に送る**: 312 通りの要求 (HTTP のヘッダーと本文をそのままファイルにしたもの) を、上限 1MiB・期限 2 秒・枠 1 で起動した Python 版と、Node の試作に、生のソケットで 1 バイトも変えずに送った。ステータスと `code` と応答の長さを比べた (16.4)。内訳は次のとおり。
  - 1 回目に作った 46 通り (`cases.mjs`。1〜43 番、31 番は 4 通り)
  - 2 回目のレビューが作った 36 通り (e01〜e33) と、足した 3 通り (h1、h3、e33)
  - 3 回目のレビューが作った 42 通り (r01〜r42。`cases_r/`)
  - 根本原因の調べで足した 38 通り (d01〜d38。`cases_d/`。RFC 2231 の分割、引数の癖、途中で切れた本文、`__proto__` など)
  - 5 回目のレビューが作った 39 通り (`cases_v/` の v01〜v20 (要求の `charset`) と w01〜w12 (HTTP のヘッダーの癖)、`cases_w2/` の w13〜w19 (同じ名前のヘッダーが 2 行))。合わせて 312 通り
  - 4 回目のレビューが作った 108 通り (`cases_m/`。m01〜m86 の 97 通り (前置き、区切りの後の空白、boundary の長さ、引数の癖、大きな番号、要求の `charset`、LF を含む boundary など) と、HTTP の層の x01〜x12 の 11 通り (`Content-Length: 0`、`Content-Type` なし、chunked など))
- **解析器だけで比べる**: 同じ 165 通りの本文を、Python 版の解析器 (`py_oracle.py`。`extract_upload.py` と同じ設定の Starlette の `MultiPartParser`) と、Node の解析器 (`own_oracle.mjs`) に直接かけた。m 系の 97 通りは、4 回目のレビューの道具 (`mine.jsonl` を `pyo.py` と `nodeo.mjs` にかける) で同じように比べた。比べたのは、受け付けたかどうか、ファイル名、拡張子、`mimeType`、ファイルの大きさ、中身の sha1 である。変換をしない分、生の要求の比較より細かく比べられる。
- **引数の解析の突き合わせ** (`fuzz_params.mjs`): 部品のヘッダーの値になりそうな断片 (`;`、`=`、`"`、`\`、`*`、`'`、`%XX`、`<>`、Python だけが空白とみなす文字、`filename*0*` など) をランダムにつないだ値を作り、python-multipart の `parse_options_header` (Python の例外も含む) と Node の `parseHeaderParams` の結果を比べた。`fuzz_params2.mjs` は、断片に ASCII でない引数の名前と、2^53 を超える番号を足したもの。
- **断片の分け方** (`own_split.mjs`): 165 通りの本文について、解析器の結果 (受け付けたかどうか・名前・`mimeType`・大きさ・sha1) が、まとめて流したときと同じになるかを確かめた。64KiB 以下の本文はすべての 2 分割と 1 バイトずつ、全部の本文はばらばらの大きさの分割を 200 回ずつ。m 系の 97 通りは `split.mjs` (3,000 バイト以下の本文の 1 バイトずつとすべての 2 分割、決まった大きさの分割 10 通り、ランダムな分割 50 回)。
- **上限・期限・切断**: 生のソケットのクライアントで、次の場面を送った (16.5)。Python 版は上限 1MiB、枠 1、期限 2 秒で起動した。
  - 宣言だけ大きい要求、宣言なしで大きい本文、止まる本文、途中の切断
  - 273 通りの要求のそれぞれを 5 つの送り方で送った後に、枠が戻るか (`rv-hang.mjs`)
  - 早めのエラー応答の後にソケットが残らないか (`linger.mjs`): FIN を送らない (相手からの送信を終えない) クライアント 20 本から、トークンなしの `Connection: close` の要求、トークンなしの HTTP/1.0 の要求、上限超の 2MB の HTTP/1.0 の要求を送り、サーバーの開いている fd の数を 1.5 秒後と 15 秒後に数えた
  - 応答の後に閉じる接続 (HTTP/1.0 と `Connection: close`) への早めの 413 を 30 回ずつ 3 組 (`rep30.mjs`・`ab-close.mjs`)
- **メモリ**: 別のプロセスのクライアント (`node:http`、keep-alive なし) から、50MiB のファイルを 3 件同時に送り、サーバーの `/proc/self/status` の `VmHWM` (最大 RSS) を読んだ。
  - 測るたびにサーバーを起動し直した (上限 50MiB、枠 3、期限 15 秒)。
  - 試作のサーバーは、受け取った後 1.5 秒待ってから応答する (子での変換の代わり)。
  - Python 版の値は前の計測のもの (既定の設定、同じクライアント、uvicorn の PID の `VmHWM`)。
  - **条件の違い**: Python 版は、受け取ったファイル (`.bin`) を子へ渡して変換させる (子は 400 `unsupported_format` で終わる)。値はこの受け渡しを含む。Node の試作は子を起動せず、子への書き込みと結果の受け取りを含まない。
- **1 バイトずつの TCP** (`trickle.mjs`): 8MiB のファイルの本文を、`setNoDelay` の生のソケットから 1 バイトずつ書き、12 秒で送るのをやめて、サーバーの `VmHWM` を読んだ。比べる基準として、本文を読み捨てるだけのサーバー (`discard.mjs`) も測った。3 件同時にも送った。
- **断片の大きさを交互にする送信** (`alt.mjs`): 16KiB と 1 バイト、16,383 バイトと 16KiB を交互に書いた。サーバー側で届いた断片の大きさを数え (計測用の写し `server-hist.mjs`)、その形で届いたことを確かめた。

### 16.4 結果: Python 版との対応表 (同じ生のバイト列)

**解析器だけでの比較**: 165 通り中 **163 通り**、m 系 97 通り中 **93 通り** で、受け付けたかどうか・ファイル名・拡張子・`mimeType`・大きさ・sha1 がすべて同じだった。違ったのは次の 6 通りで、どれも 7.4 で諮る。

- d12・m59・m60 番 (要求の `charset` とファイル名の読み方): d12 は Python 版 `日本.txt` / Node 版 `ú{.txt`、m59・m60 は Python 版 `æ\x97¥æ\x9c¬.txt` / Node 版 `日本.txt`。拡張子は同じ `txt`。
- m58・m61 番 (`charset=utf-16`・`cp037`): Python 版は `file` の部品が見つからず失敗、Node 版は受け付ける。
- 5 回目のレビューの v 系 20 通り (要求の `charset`) は、同じ道具 (`pyo.py`・`nodeo.mjs`) で比べ、12 通り (v01〜v03・v06・v07・v10・v11・v15・v16・v18〜v20) が違った。どれも 7.4 の 3 の 5 種類のどれかに当たる。同じ `charset` を書いても名前が ASCII の範囲なら、どちらも同じ結果だった (v04・v05・v08・v09・v12〜v14・v17)。
- d37 番 (CR と LF を含む boundary): Python 版は受け付け、Node 版は 422。LF だけの boundary (m64 番) は、どちらも受け付ける。

**引数の解析の突き合わせ**: `fuzz_params.mjs` を 4 つの乱数の種 (12345・4242・777・31337) で 10 万件ずつ、`fuzz_params2.mjs` も同じ 4 つの種で 10 万件ずつ、計 80 万件流し、違いは 0 件だった。直す前の版の違いは 16.10 にある。

**断片の分け方**: `{"cases":165,"twoWay":355074,"oneByte":157,"random":33000,"mismatches":0}`。すべての 2 分割 355,074 通り、1 バイトずつ 157 通り、ばらばらの分割 33,000 通りで、結果 (sha1 まで) が一度も変わらなかった。m 系 97 通りも `{"cases":97,"checks":24881,"bad":0}`。

**生の要求**: 採る形で 312 通り中 **293 通り** のステータスと `code` が Python 版と同じだった (5 回目のレビューの 39 通りを除いた 273 通りでは 260 通り)。違ったのは次の 19 通りである。

| # | 要求 | Python 版 | 採る形 | 分類 |
|---|---|---|---|---|
| 07 | `filename=""` | 400 (変換で形式不明) | 200 | 試作は変換しないため。違いではない |
| r08 | 引用符の外の値に生の LF | 400 (変換で形式不明) | 200 (名前は Python 版の解析器と同じ) | 同上 |
| r36 | `a.txt/` (末尾の `/`) | 400 | 200 (同上) | 同上 |
| d10 | `filename*=` の後に `filename=`。名前は `b.pdf` で中身は文字 | 422 (PDF の変換の失敗) | 200 (同上) | 同上 |
| d33 | undici の `FormData` が作った本文 (`.pdf` の名前で中身は文字) | 422 (同上) | 200 (同上) | 同上 |
| d38 | 引用符の外の `\` | 400 | 200 (同上) | 同上 |
| 37 | `Content-Length` が本文より 20 バイト小さい | 422 | 400 (`code` なし) | 7.4 の 1 |
| d36 | `filename*=` と `filename*0=` を混ぜる | 500 (`code` なし) | 422 `extraction_failed` | 理由つきで許容 (16.1) |
| d37 | `boundary*=UTF-8''a%0D%0Ab` | 200 | 422 | 7.4 の 2 |
| x08 | chunked の本文で、ファイル名の値に生の LF | 400 (変換で形式不明) | 200 (名前は r08 番と同じ形) | 試作は変換しないため。違いではない |
| m21 | `filename*=` と `filename*0=` を混ぜる (d36 と同じ形) | 500 (`code` なし) | 422 `extraction_failed` | 理由つきで許容 (16.1) |
| m58 | `charset=utf-16` | 422 | 200 | 7.4 の 3 |
| m61 | `charset=cp037` | 422 | 200 | 7.4 の 3 |
| v11 / v18 | `charset=utf-8; charset=utf-16` / `charset=utf-16` (名前は ASCII のまま) | 422 | 200 | 7.4 の 3 |
| v01 / v02 / v16 | 名前とファイル名を `utf-16` / `cp037` / `utf-16-le` で符号化し、同じ `charset` を宣言 | 200 | 422 | 7.4 の 3 |
| v10 | `charset=punycode` | 500 (`code` なし) | 200 | 7.4 の 3 |

**前の版の採用 (検査 + `@fastify/busboy`) の結果** (同じ 165 通りを同じ設定で流した):

- 1〜46 番、e 系、r 系の 127 通りでは **106 通り** が同じだった (3 回目のレビューの値と同じ)。d 系を足した 165 通りでは 136 通り。
- 違いの原因は、本文を読む部品が 2 つあり、受け付ける形を別々の決まりで判定していたことにある (16.7)。
  - Python 版が 200 なのに、前の版が 422 にしたもの:
    - `@fastify/busboy` の決まりによるもの: r01・r02・r05 (最初の区切りの直前に CRLF を求める)、r12 (種類が `form-data` 以外の `Content-Disposition` を受け付けない)、r31 (boundary の最初の値を使う)、r34・e15b (253 字以上の boundary を受け付けない)、40 (`filename*` の CRLF)。
    - 検査によるもの: e07 系・r20・r21・r23・r41 (中身の中の区切りに似た並び。`@fastify/busboy` がそこでファイルを黙って短く切るのを防ぐために 422 にしていた)、r08 (引用符の外の値の中の LF)、d15〜d17 (終わりの区切りを求めた。Starlette は終わった部品を使う)。
    - 検査の誤り: r16 (2 つ目の部品の `Content-Disposition: form-data; name` のように値の無い `name` を、名前が無いとみなした。検査は `/;\s*name\s*=/` で名前の有無を見ていた) と d11 (`name*=UTF-8''file` を同じ理由で名前が無いとみなした)。
  - Python 版が 422 か 500 なのに、前の版が 200 にしたもの: r14 (`Content-Disposition` が 2 行あり、`@fastify/busboy` は最初の行 (`file`) を、Python 版は最後の行 (`mimeType`) を使う)、d36 (`@fastify/busboy` は分割した `filename*0=` を読まずに `filename*=` を使う)。
  - 200 のまま、ファイル名が Python 版と違った: 200 になった要求のうち、Python 版の解析器と名前が同じだったのは 79 通り中 61 通り (採る形は 99 通り中 98 通り。違いは d12 だけ)。d09 は `x.txt` が `z.pdf` に、d10 は `b.pdf` が `a.txt` に、d03 は `xA.txt` が `x` になり、**形式の判定が変わる**。03 (`filename*` より `filename` を使う)、05 (パスを削る)、42 (cp932 の名前の崩れ方が違う)、d01・d02・d07・d08 (RFC 2231 の分割を読めない)、d29・d34・d35・d38 も違った。

主な要求と結果 (「検査なし」の列は、前の版の計測で、`@fastify/busboy` だけで分解したもの):

| # | 要求 | Python 版 | **採る形** | 前の版の採用 | 検査なし |
|---|---|---|---|---|---|
| 01 | 普通 (`a.txt`、`mimeType=text/plain`) | 200 | 200 | 200 | 200 |
| 02 | 日本語の名前を UTF-8 のまま | 200 (`日本語の資料.txt`) | 200 (同じ名前) | 200 (同じ名前) | 200 |
| 03 | `filename="fallback.txt"; filename*=UTF-8''…` | 200 (日本語の名前) | 200 (日本語の名前) | 200 (`fallback.txt`) | 200 |
| 05 | `dir/sub/a.txt` | 200 (`dir/sub/a.txt`) | 200 (`dir/sub/a.txt`) | 200 (`a.txt`) | 200 |
| 12〜17 | `file` が無い・2 つ・普通の項目・名前なし・JSON・壊れた本文 | 422 | 422 | 422 | 422 |
| 19 / 20 | 5,000 字 / 17KiB の名前 | 422 | 422 | 422 | 200 |
| 23 | 項目が 1,001 個 | 422 | 422 | 422 | 422 |
| 25 / 26 | ファイルが 1MiB / 1MiB + 1 バイト | 200 / 413 | 200 / 413 | 200 / 413 | 200 / 413 |
| 28 | `Multipart/Form-Data` (大文字) | 422 | 422 | 422 | 200 |
| 29 | 終わりの区切りが無い (ファイルの途中で終わる) | 422 | 422 | 422 | 422 |
| 31 | `Content-Disposition` の行が 4,224 / 4,225 バイト | 200 / 422 | 200 / 422 | 200 / 422 | 200 / 200 |
| 33 / 34 | 部品のヘッダーが 9 行 / 2,500 行 | 422 | 422 | 422 | 200 (2,000 行を超えた分を黙って捨てる) |
| 35 | 90KiB のファイル名 | 422 | 422 | 422 | 200 (名前が 81,863 字に黙って切られ、拡張子が消える) |
| 38 | 前置きの文で始まる | 422 | 422 | 422 | 200 |
| 40 | `filename*` に `%0D%0A` | 200 | 200 | 422 | — |
| e01 / e02 / r01 / r02 / r05 | 先頭に CRLF・LF・前置きの文 | 200 | 200 | 200 / 200 / 422 / 422 / 422 | — |
| e02b | CRLF と `-` を含む前置きの文 | 422 | 422 | 422 | 200 |
| e03 / e33 | 最初の区切りの後に空白 (2 字 / 50,000 字) | 422 | 422 | 422 | 422 |
| e06 / h1 / h3 | ヘッダーの行末が LF だけ / ヘッダーの後の空行が無い / ヘッダーの直後に終わりの区切り | 422 | 422 | 422 | 期限で 408 (前の版の受け取りでは応答なし・枠が戻らない。16.10) |
| e07 系 | 中身に区切りに似た並び (`\r\n--` + boundary の後に `XYZ`) | 200 (並びを中身として扱う) | 200 (同じ大きさの中身) | 422 | 200 (ファイルが黙って短く切られる) |
| r20・r21・r23・r41 | 中身に区切りに似た並び (`\r\n--` + boundary の後に CR + 文字・`-` + 文字・空白・LF だけ) | 200 (同上) | 200 (同じ大きさの中身) | 422 | — |
| e10 / e11 / e27 | `:` の無い行 / 折り返したヘッダー / 名前の無いヘッダー | 422 | 422 | 422 | 200 |
| e12 | ヘッダーの無い部品の後にファイル | 422 | 422 | 422 | 200 |
| e15b / r34 | boundary が 5,000 字 / 253 字 | 200 | 200 | 422 | — |
| e22 | 引用符の中の生の CRLF | 422 | 422 | 422 | 200 (名前が `a` に切られ、拡張子が消える) |
| r12 | `Content-Disposition: attachment; name=…` | 200 | 200 | 422 | — |
| r14 | `Content-Disposition` が 2 行 (1 行目は `file` のファイル、2 行目は `mimeType`) | 422 | 422 | 200 | — |
| r16 | 2 つ目の部品が `Content-Disposition: form-data; name` (値の無い `name`) | 200 | 200 | 422 | — |
| r31 | `boundary=` が 2 つ | 200 (最後の値) | 200 | 422 | — |
| d01〜d03・d07〜d09 | RFC 2231 の分割 (`filename*0*=`・`filename*1=` など) | 200 (つないだ名前) | 200 (同じ名前) | 200 (名前が崩れる。d03・d09 は拡張子も変わる) | — |
| d15〜d17 | `file` の部品が終わった後で本文が切れる | 200 | 200 | 422 | — |
| d18 | `file` の途中で本文が切れる | 422 | 422 | 422 | — |
| m58 / m61 | 要求に `charset=utf-16` / `charset=cp037` | 422 | 200 | — | — |
| m59 / m60 | 要求に `charset=iso-8859-1` / 知らない `charset`、名前は UTF-8 の `日本.txt` | 200 (名前が崩れる) | 200 (`日本.txt`) | — | — |
| m64 | `boundary*=''a%0Ab` (LF だけを含む boundary) | 200 | 200 | — | — |
| m09 | boundary が 70・252・253・254・1,000 字 | 200 | 200 | — | — |
| v07 | `charset=utf-7` でファイル名が `a.+AHQAeAB0-` | 200 (`a.txt`) | 200 (`a.+AHQAeAB0-`。変換すれば形式不明の 400 の見込み) | — | — |
| w01 / w17 | `Content-Type` が 2 行 (正しい方が先) | 200 | 200 | — | — |
| w15 / w18 | 違う値の `Authorization` が 2 行 (正しい方が先) | 200 | 200 | — | — |
| w19 | 違う値の `Authorization` が 2 行 (正しい方が後) | 401 | 401 | — | — |
| d13 / d14 | `__proto__` という名前の引数 / 部品 | 200 | 200 | 200 | — |
| d26 / d27 | 項目が 1,000 個 / 1,001 個 | 200 / 422 | 200 / 422 | 200 / 422 | — |
| d31 / d32 | 項目が 1MiB / 1MiB + 1 バイト | 200 / 422 | 200 / 422 | 200 / 422 | — |

補足:

- 422 はすべて `extraction_failed` で、本文は `{code, message}` だけ (108 バイト)。312 通りのどれでも、送った中身 (目印の文字列) は応答に含まれなかった。
- Node 版で 422 にする条件は次のとおり。最初の 1 件だけを使って残りを黙って捨てることはせず、超えた分を黙って切り捨てることもしない。
  - 解析器の文法 (16.1 の 2) に外れる
  - ファイルの部品が 2 つ以上ある
  - `file` が無い、`file` にファイル名が無い (普通の項目として届く)
  - `mimeType` がファイルとして届く
  - 項目の数 (1,000)・項目の大きさ (1MiB) の上限を超える
  - multipart でない、boundary が無い、boundary に CR がある
  - 部品のヘッダーの引数が読めない (d36)
  - 本文の途中で切断される
- **解析の速さ** (何も動いていないときに測った。`perf-own.mjs`):
  - 50MiB のファイルを 64KiB の断片で: 7.6〜7.7ms。1KiB の断片で: 37〜41ms。
  - 中身が区切りに似た並び (`\r\n--` + boundary より 1 字短いもの) で埋まった 50MiB: 34〜37ms。
  - **最悪の形**: 区切りに完全に一致する並びの後に別の文字が続く並び (`\r\n--B` + `X` の繰り返し。e07 の形) で埋まった 50MiB は **2.4 秒** (64KiB の断片 1 つの処理は最大 14ms)。Python 版は同じ本文で 4.9 秒だった (`perf.mjs` / `pyperf.py`)。boundary が 10 字 (`rvb0undary`) なら Node 版 1.0 秒、Python 版 2.1 秒。`\r\n--B` + `\r` + `X` の繰り返しは Node 版 2.3 秒。CR だけで埋めた 50MiB は Node 版 0.28 秒、Python 版 0.14 秒。解析は同期的に動くので、この間ほかの要求の処理は断片 1 つ分 (最大 14ms) ずつ待たされる。上限 50MiB の中では Python 版より速く、受け入れられる。
  - 小さな項目が並んだ 50MiB: 1,001 個目の項目で 8〜11ms で失敗する (上限は項目 1,000 + ファイル 1)。最大の長さのヘッダーが並んだ 50MiB も 12ms で失敗する。
  - 1MiB を 1 バイトずつ流すと、boundary の長さ (70・250・5,000 字) に依らず約 200ms。
  - 引数の解析 (`perf-params.mjs`): 悪意のある 4KiB 前後の値で 1 回最大 0.56ms。Python の `parse_options_header` は同じ値で 1 回最大 2.3ms だった (`py_perf_params.py`)。

### 16.5 結果: 上限・期限・切断 (生のソケット)

採る形 (上限 1MiB、枠 1、期限 2 秒) の結果。Python 版も同じ設定で、同じ日に測った。Node 版の上の 9 行は、直した後の手本 (研究ノートから書き出したもの) でも取り直し、同じ結果だった (時間の差は数 ms)。

| 確かめたこと | Python 版 | Node 版 (採る形) |
|---|---|---|
| `Content-Length` 10GiB、本文なし | 413、2ms | 413、6ms。枠を取らない |
| `Content-Length` が上限超で、本文も送り続ける (2MiB×3 回、20MiB、100MiB) | 5 回とも 413 | 5 回とも 413 |
| 同じ要求を、apps/app と同じ axios 1.15.0 で 30 回ずつ (2MiB、20MiB、100MiB) | 2MiB で 30/30 が 413 | 90/90 が 413 (直した後の手本で取り直した) |
| 宣言なし (`Transfer-Encoding: chunked`) で 20MiB | 413 | 413 |
| 宣言なしで 200KiB (上限内) | 200 | 200 (204,800 バイトを受け取った) |
| 本文が途中で止まる (1MiB の宣言で 10 バイトだけ送る。宣言が実際より大きい場合に当たる) | 408、2,002ms | 408、2,002ms。枠を返した |
| 1 バイトずつ 200ms おきに送る | 408、2,002ms | 408、2,002ms (期限は、1 回の読み取りごとでなく、受け取り全体に掛かる) |
| 枠 1 を止まった本文が持っている間に 2 件目を送る | 503、1ms。1 件目を切ると 41ms で枠が戻った | 503、1ms。1 件目を切ると 11ms で枠が戻った |
| `Expect: 100-continue` で、宣言が上限超 / 上限内 | `413` だけ / `100` の後に 200 | `413` だけ / `100` の後に 200 |
| **273 通りの要求を 5 つの送り方で送った後に、枠が戻るか** (`rv-hang.mjs`) | — | 1,326 回 (165 通りで 797 回、m 系・x 系の 108 通りで 529 回。1 バイトずつは本文が 1,500 バイト以下の要求だけ) で、枠が戻らない・次の要求が 200 にならない・待っても応答が無い、のどれも 0 回 (`"bad":0`)。応答を待つ送り方では、応答は 200・422・413・400 (37 番) のどれかだった |
| **FIN を送らないクライアント 20 本に早めのエラー応答を返した後のサーバーの fd** (`linger.mjs`) | — | トークンなしの `Connection: close` (401)、トークンなしの HTTP/1.0 (401)、上限超の 2MB の HTTP/1.0 (413)、上限超の 2MB の `Connection: close` (413) のどれも、20 本に応答が届き、fd は 19 のまま (1.5 秒後も 15 秒後も)。前の版の手本 (読み捨ての後に `socket.end()`) では、401 の 2 つと 413 で 19 → 39 に増え、15 秒後も 39 のままだった (16.10) |
| 変換中 (受け取りの後) に切断。keep-alive で 1 件目の応答を受けてから 2 件目を送り、2 件目の変換中に切る | — | 2 件目の `signal` が発火し、変換の代わりの待ちが止まり、枠を返した。1 件目には何も起きない (前の版で測った値。採る形では取り直していない) |
| 2 件を続けて送って (パイプライン) から切断 | 新しい方にだけ切断の印が付く | 2 件とも `signal` が発火して止まった (前の版で測った値。採る形では取り直していない。16.1) |
| 一時ファイル | 作らない | 作らない (解析器は `node:buffer` しか読み込まない) |

**応答の後に閉じる接続への早めのエラー応答**:

Node は、応答の後に接続を閉じる要求 (HTTP/1.0 で keep-alive を頼んでいない要求と、`Connection: close` の要求) に早めのエラー応答を返すと、応答を書いた直後に、読み残しのある接続を閉じる (`socket.destroySoon`)。このとき接続のリセットが起き、クライアントがまだ読んでいない応答が捨てられる、と考えると結果に合う (パケットは見ていない)。受け取りの途中で返す 413 でも起きる。次の案を比べた。どれも、宣言が上限超の要求には、本文を最後まで送る。

- 0: 何もしない (Node の既定)
- 1: `c.env.outgoing.shouldKeepAlive = true` を立てる (2 回目のレビューの前の案)
- 2: 1 に加えて、`Connection: close` の要求なら、応答の後で読み残しを読み捨ててから `socket.end()`
- 3: 要求の `Connection` ヘッダーを正規表現で見て `close` なら、このソケットの `destroySoon` を「読み残しを読み捨ててから `socket.end()`」に差し替える (前の版の採用)
- 4: **`c.env.outgoing.shouldKeepAlive === false` なら、`destroySoon` を「読み残しを読み捨ててから、元の `destroySoon` を呼ぶ」に差し替える (採用)**。Node が「応答の後に閉じる」と決めた要求を、Node 自身の判定で選ぶ。差し替えた関数は 1 つのソケットで 1 回だけ動く

30 回送って 413 が届いた回数 (3 組):

| 要求 | Python 版 | 案 0 | 案 3 (2 つ前の版) | **案 4 (採用)** |
|---|---|---|---|---|
| HTTP/1.0 (`Connection` ヘッダーなし)、宣言が上限超の 2MiB (`30-http10.req`) | 30 / 30 / 30 | 28 / 27 / 26 | **15 / 1 / 1** | **30 / 30 / 30** |
| HTTP/1.1 + `Connection: close`、宣言が上限超の 2MiB (30 番) | 30 / 30 / 30 | 20 / 13 / 23 | 30 / 30 / 30 | 30 / 30 / 30 |
| 同、宣言が上限超の 2MiB を 1 回で書く (`ab-close.mjs declared`) | 30 | 17 | 30 | 30 |
| 同、宣言なし (chunked) 20MiB で受け取り途中の 413 (`ab-close.mjs chunked`) | 30 (うち 1 回は 413 を受けた後にリセット) | 22 | 30 | 30 |
| keep-alive の chunked 20MiB | 30 | 30 | 30 | 30 |

- 案 0 は、届かなかった回がすべて `EPIPE` (クライアントが書いている途中で接続が切られた) だった。
- **前の版の「計 300 回すべて届いた」は、HTTP/1.1 に `Connection: close` を付けた要求だけを数えた値だった**。HTTP/1.0 の要求には `Connection` ヘッダーが無いので、案 3 の正規表現に当たらず、差し替えが働かない。案 3 の HTTP/1.0 の値 (15 / 1 / 1) は案 0 と同じ動きで、そのばらつきの範囲と見る (4 回目のレビューの計測では、案 0 は HTTP/1.0 で 25 / 19 / 18、`Connection: close` で 25 / 3 / 8 とばらついた)。案 4 は、Node が閉じると決めたすべての要求を対象にするので、HTTP/1.0 でもすべて届いた。
- 応答の `Connection`: 案 4 でも、HTTP/1.0 と `Connection: close` の要求には `Connection: close`、keep-alive の要求には `keep-alive` が返った (正しい)。案 1 と 2 は、要求が `close` と言っているのに `keep-alive` と返す副作用があった (前の計測)。
- 同じ接続に続けて送った 2 件目 (案 4): `Connection: close` の要求への 413 の後に、2 件目へ 400 (`Connection: close`) が返った。`close` と言った後に送られた要求なので、400 は妥当。12 番 (すぐ 422 になる要求) に `Connection: close` を付けて 2 件目を続けると、422 が捨てられて 400 だけが返ることがある (今回は 5 回とも 400 だけ。4 回目のレビューの計測では 422 の後に 400 が届いた。時間の当たり方で変わる)。37 番と同じ仕組みである (7.4 の 1)。keep-alive なら、413 の後の 2 件目は 200 だった。
- 案 4 の弱点: `shouldKeepAlive` と `destroySoon` は型定義 (`@types/node`) にあるが、「応答の後に `shouldKeepAlive` を見て `destroySoon` を呼ぶ」という流れは、Node の文書が約束するものではない。将来の Node で流れが変わると、黙って案 0 に戻る。6.x では、HTTP/1.0 の要求と `Connection: close` の要求への 413 (宣言のものと受け取り途中のもの) が揺れずに届くこと (30 回以上の繰り返し) と、応答の `Connection` を、テストで必ず確かめる。この繰り返しのテストが守りになる。
- apps/app (axios。Node 24 の既定のエージェントは keep-alive) は `Connection: close` を付けず、HTTP/1.0 も使わないので、どの案でも影響は無い (axios で計 240 回すべて届いた。前の計測)。

### 16.6 結果: メモリとコピーの回数

50MiB のファイルを 3 件同時に送ったときの、親 (HTTP のプロセス) の最大 RSS (`VmHWM`)。待機時の最大 RSS は、Node の試作で 70MiB、Python 版で 61MiB だった。測った範囲の違いは 16.3 のとおり。

| 方法 | 1 回 (3 件) | 3 回続けて (9 件) | `arrayBuffers` の最大 | 親の中でのコピーの回数 (1 件あたり) |
|---|---|---|---|---|
| Python 版 (参考。子への受け渡しを含む。前の計測) | 263MiB | 264MiB | — | — |
| (a) `formData()` (前の計測) | 758MiB | 752MiB | 500MiB | 3 回以上 (本文の連結、undici が本文を読む、`File` を作る、`arrayBuffer()`) |
| (a') `busboy` / `@fastify/busboy` をメモリで (前の計測) | 391 / 394MiB | 423 / 427MiB | 251〜310MiB | 2 回 (本文の連結、ファイルの連結) + `toWeb` の分 |
| (b) `c.req.raw.body` を読み、最後に連結 (前の計測) | 410 / 416MiB | 425 / 426MiB | 302〜342MiB | 1 回 (ファイルの連結) + `toWeb` の分 |
| (b) `c.req.raw.body` を読み、連結しない (前の計測) | 250〜269MiB | 276〜308MiB | 167〜212MiB | `toWeb` の分だけ (断片ごとに 1 回) |
| (b) `c.env.incoming` を直接読み、連結しない (前の版の採用。検査 + `@fastify/busboy`) | 227〜228MiB (2 回) | 249〜252MiB (2 回) | 150〜169MiB | 0 回 |
| **(c) `c.env.incoming` を直接読み、連結しない (採用。自分で書いた解析器。変換の代わりに 1.5 秒待つ)** | **225MiB** (2 回) | **248〜250MiB** (2 回) | 150〜168MiB | 0 回 (16KiB 以上の断片。16KiB 未満の断片は 64KiB の塊に 1 回写す) |
| **(c) 16.8 の手本そのもの (待ちなし)** | **218〜225MiB** (5 回) | **226〜285MiB** (12 回。うち直した後の手本で 4 回 226〜247MiB) | — | 同上 |

**1 バイトずつの TCP** (8MiB のファイルを 1 バイトずつ書き、12 秒で送るのをやめた。どれも期限 15 秒で 408 になり、届いたのは 4.1〜4.6MiB):

| サーバー | 親の最大 RSS |
|---|---|
| 前の版の採用 (検査 + `@fastify/busboy`、断片を届いたまま持つ) | **987MiB** |
| (c) で、小さな断片を塊にまとめない形 (`SMALL_CHUNK = 0` にした写し) | **1,099MiB** |
| **(c) 採用 (16KiB 未満の断片を 64KiB の塊にまとめる)** | **83〜85MiB** (4 回) |
| 同、1 バイトずつを 3 件同時に (届いたのは各 3.8〜3.9MiB) | 93〜94MiB (2 回) |
| 本文を読み捨てるだけのサーバー (`discard.mjs`。基準) | 77〜78MiB (2 回) |

- 細かい TCP の断片で届くと、1 バイトごとに `Buffer` の入れ物が 1 つでき、実測では届いた 1 バイトあたり約 200 バイトを使った。届いたまま持つと、4MiB 余りの本文で親の RSS が 1GB 近くになる。枠 3 つで同時に送られると、メモリの予算 2Gi を超える。採る形は小さな断片を塊に写すので、読み捨てるだけのサーバーとほぼ同じになった。
**断片の大きさを交互にする送信** (採る形。どれも 200 で受け取り終えた。届いた断片の大きさは、サーバーで数えてその形になっていた):

| 送り方 | 親の最大 RSS |
|---|---|
| 8MiB を 16KiB と 1 バイトの交互で 1 件 / 3 件同時 | 85MiB / 103MiB |
| 32MiB を 16KiB と 1 バイトの交互で 1 件 / 3 件同時 | 111MiB / 184MiB |
| 8MiB を 16,383 バイトと 16KiB の交互で 1 件 | 89MiB |

- 16KiB 以上の断片は写さずに持ち、その間の 1 バイトは新しい 64KiB の塊に入る。このため断片 1 つあたりの持ち方は細切れになるが、どれも予算の中に収まった。4 回目のレビューの計測 (別の送り方) でも、16KiB と 1 バイトの交互で 1 件 133MiB・3 件 242MiB、16,383 バイトと 16KiB の交互で 145MiB、1 バイトずつの 3 件同時で 95MiB だった。
- **上の「(c) は Python 版と同じ程度」は、普通の速さで届く本文 (64KiB 前後の断片) だけの話である**。1 バイトずつの本文で、Python 版の RSS は測っていない。
- 待ちなしの手本で 3 回続けての値のばらつきが大きいのは、応答が早く返り、前の回の断片が GC される前に次の 3 件が届くためと考えられる (確かめていない)。

補足:

- **`toWeb` のコピー**: `@hono/node-server` 2.1.6 は、`c.req.raw.body` を `Readable.toWeb(incoming)` で作る (`dist/index.mjs` の 305 行付近)。届いた断片は、ここで 1 回ずつコピーされる (1 回目のレビューの実測で、元の `Buffer` と同じ領域ではなかった)。`c.env.incoming` を直接読むと、このコピーが無くなり、最大 RSS が約 30〜50MiB 下がり、ばらつきも小さくなった。
- **連結すると最大 RSS が高い理由**: ソケットから届いた断片 (使い終わってもすぐには GC されない) と、連結した 50MiB が同時にあるためである。GC を受け取りの後に強制しても、先に確保して写しても、下がらなかった (前の計測)。連結しなければ、届いた断片そのものがファイルの中身になる。
- **中身の確認**: 採る形の 50MiB の全回 (計 24 件) で、受け取った断片をつないだ sha256 が、送ったファイルと一致した。
- **応答の後の RSS**: 最大の値の近くにとどまり、待機時の値には戻らないことが多かった (Python 版は 64〜65MiB に戻った)。メモリの予算 (3.7) は、最大の値で組む。
- **予算の式との関係**: design.md の予算の式の「アップロード 2 × `MAX_FILE_SIZE_MB`」は、連結する形 (1 件あたり約 2 倍) に当たる。採る形の実測は、1 件あたり約 (250 − 70) ÷ 3 ≒ 60MiB 〜 (285 − 70) ÷ 3 ≒ 72MiB (ファイル 50MiB の約 1.2〜1.4 倍) だった。

### 16.7 選んだ理由と、選ばなかった理由

- **(c) 自分で書く解析器を選んだ理由**:
  - **判定の決まりが 1 つになる**。本文を読む部品が 1 つなので、「片方が通した本文を、もう片方が別の形で読む、または黙って短く切る」ことが起きない。前の版 (b) は、検査と `@fastify/busboy` の 2 か所で別々の決まりを持ち、165 通り中 29 通り (127 通り中 21 通り) で Python 版と違った。(c) は 273 通り中 260 通りが同じで、残りの 13 通りのうち 7 通りは試作が変換しないためだった (16.4)。残りは 7.4 で諮る 4 通り (37・d37・m58・m61) と、Python 版が 500 を返す 2 通り (d36・m21) である。
  - **Python 版と直接突き合わせられる**。文法と引数の解析を Python のソースから移したので、解析器だけの比較 (165 通り中 163 通り、m 系 97 通り中 93 通り) と、引数の解析の突き合わせ (80 万件で違い 0) で、同じ判定であることを確かめられた。違いの 2 通り (d12・d37) は理由が分かっている。
  - **失敗が同期的な例外だけになる**。前の版で起きた「`finish` も `error` も出さずに止まる」「`'error'` の受け手を付け忘れるとプロセスごと落ちる」(16.10) が、構造の上で起きない。
  - **細かい断片に強い**。小さな断片を塊にまとめる持ち方を、自分で決められる (1 バイトずつの TCP で 83〜85MiB。前の版は 987MiB。16.6)。
  - **普通の本文のメモリと速さは前の版と同じ程度**。50MiB × 3 件で 218〜285MiB (前の版は同じ条件で 227〜252MiB)、50MiB の解析は 64KiB の断片で 8ms 前後。
  - 依存が増えない。
- **(b) 検査 + `@fastify/busboy` (前の版の採用) を選ばなかった理由**:
  - 判定の決まりが 2 つになり、127 通り中 106 通りしか Python 版と同じにならなかった。ずれのいくつか (d03・d09・d10) は、ファイル名の拡張子が変わり、**形式の判定が変わる**。
  - 1 バイトずつ届く本文で、1 件 987MiB になった。
  - 依存が 2,051 行あり、2026-10 に脆弱性の勧告が 3 件出た (GitHub Advisory Database で確かめた)。
    - GHSA-xjh9-v7x6-24jw (high、2026-10-02 公開): 大きすぎる boundary によるサービス停止。3.2.1 で修正。
    - GHSA-x8mw-p69m-v3mx (high、2026-10-02 公開): `__proto__` などの名前の部品のヘッダーによるサービス停止。3.2.1 で修正。
    - GHSA-gxm5-99cw-xjw9 (medium、2026-10-05 公開): `Content-Disposition` の `filename` / `name` への CRLF の差し込み。3.2.2 で修正。
    - 前の版で 7.4 に挙げていた「`filename*` の CRLF を 422 にする」「253 字以上の boundary を 422 にする」は、どちらもこの勧告の修正から生まれた振る舞いだった。(c) では、どちらも Python 版と同じ 200 になる (40・r34・e15b 番)。
  - 検査を足しても、`@fastify/busboy` の内部の決まり (最初の区切りの前の CRLF、最初の `Content-Disposition`、最初の boundary、種類の名前) は外から変えられない。合わせるには部品の内部に手を入れることになり、版が変わると黙って壊れる。
- **(b') `busboy` 1.6.0 を選ばなかった理由**: (b) と同じ「2 つの決まり」の問題があり、さらに次の点で劣る。
  - `package.json` に `license` の欄が無い (3.8 のライセンスの確認で「不明」と出るおそれ)。
  - 最後のリリースが 2022 年。
  - 日本語の名前には `defParamCharset: 'utf8'` の指定が要る。
- **(a) `formData()` (Hono の `parseBody()` も同じ) を選ばなかった理由**: 親の最大 RSS が 758MiB で、予算に収まらない。項目の数と部品のヘッダーの長さに上限が無い (項目 1,001 個を 200 で通した)。本文を読み切ってからでないと分解を始められない。
- **(a') メモリに読み切ってから部品に渡す形を選ばなかった理由**: 本文全体の連結の分だけ、コピーが 1 回多い。(b) と同じ「2 つの決まり」の問題もある。

### 16.8 再現の手順と、試作のコードの要点

使い捨ての場所 (以下 `$T`) で行う。リポジトリの中では install しない。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$T" && cd "$T"
echo '{"name":"t4-proto","private":true,"type":"module"}' > package.json
npm install --ignore-scripts hono@4.13.16 @hono/node-server@2.1.6
```

(前の版との比較を取り直すときだけ、`busboy@1.6.0 @fastify/busboy@3.2.4` も足す。)

試作と道具は次のファイルからなる。

- 下の 3 つの手本 (`header-params.mjs`、`parse-multipart.mjs`、`server.mjs`): 採る形そのもの。
- 生の要求: `cases/` (46 通り)、`cases_e/` (39 通り)、`cases_r/` (42 通り)、`cases_d/` (38 通り)、`cases30/` (30 番と HTTP/1.0 の要求)。
- `send-cases.mjs`: 生のソケットで送る (応答 1 件を受け取ったら切る。`CASES_DIR` で場所を選ぶ)。
- `py_oracle.py` と `own_oracle.mjs`: 同じ本文を、Python 版の解析器と Node の解析器に直接かける。Python は `services/attachment-text-extractor/.venv/bin/python -I` で実行する。
- `own_split.mjs`: 断片の分け方を変えても、解析器の結果が変わらないことを確かめる (約 4〜5 分)。
- `fuzz_params.mjs` と `fuzz_params2.mjs`: 引数の解析の突き合わせ。`SEED` で乱数の種を変える。
- `perf-own.mjs`・`perf-params.mjs`・`py_perf_params.py`: 解析の速さ。
- `rv-hang.mjs`: 273 通り × 5 つの送り方の後に、枠が戻るか。
- 5 回目のレビューの道具: `cases_v/`・`cases_w2/` (39 通りの生の要求)。
- 4 回目のレビューの道具: `cases_m/` (108 通りの生の要求)、`mine.jsonl` (m 系 97 通りの本文)、`pyo.py`・`nodeo.mjs`・`split.mjs` (解析器だけの比較と断片の分け方)、`linger.mjs` (FIN を送らないクライアントでサーバーの fd を数える)、`alt.mjs` (断片の大きさを交互にする送信)、`perf.mjs`・`pyperf.py` (最悪の形の解析時間)。
- `server-hist.mjs`: 手本のサーバーに、届いた断片の大きさを数える受け手を足した計測用の写し。
- `probe.mjs` (`run-probes.sh`): 16.5 の各場面。
- `rep30.mjs`・`ab-close.mjs`・`reuse.mjs`: 応答の後に閉じる接続の比較。
- `mem-client.mjs`: 別のプロセスから 50MiB を 3 件同時に送る。`trickle.mjs`: 1 バイトずつ送る。`discard.mjs`: 読み捨てるだけの基準のサーバー。
- 前の版との比較に使ったもの: 前の版のサーバー (`server.mjs` を `PARSER=fbusboy GUARD=1 KEEPALIVE_FIX=3` で起動)、`multipart-guard.mjs`、`parse.mjs`。

サーバーは `setsid` で起動して PID をファイルに書き、`ps -o args= -p <PID>` で動いているファイルを確かめ、自分の PID だけを止めた。Python 版は research.md 8 節の手順で、`MAX_FILE_SIZE_MB=1 UPLOAD_TIMEOUT_S=2 MAX_CONCURRENCY=1` を足して起動した (ポートは 18733)。

```bash
PY=services/attachment-text-extractor/.venv/bin/python   # in the worktree; pass it as an absolute path
$PY -I py_oracle.py cases cases_e cases_r cases_d > o-py.jsonl
node own_oracle.mjs cases cases_e cases_r cases_d > o-own.jsonl      # 163 of 165 equal (d12, d37 differ)
node own_split.mjs                                                    # "mismatches":0
for s in 12345 4242 777 31337; do SEED=$s node fuzz_params.mjs 100000; SEED=$s node fuzz_params2.mjs 100000; done
# limits 1 MiB, deadline 2 s, one slot; TOKEN comes from a 600-mode file outside the repository
MAX_FILE_SIZE_MB=1 UPLOAD_TIMEOUT_S=2 MAX_CONCURRENCY=1 TOKEN="$(cat token)" setsid node server.mjs > run.out 2> run.log < /dev/null &
node rv-hang.mjs <port> "$(cat token)" cases cases_e cases_r cases_d            # "bad":0
node rep30.mjs <port> "$(cat token)" 30 30-http10.req                           # {"413":30}
node linger.mjs <port> <server pid> noauth 20 15000   # fdsAfterWait == fdsBefore; reads ./token, which must have no trailing newline
# memory: MAX_CONCURRENCY=3 UPLOAD_TIMEOUT_S=15, a fresh server per measurement
node mem-client.mjs <port> "$(cat token)" 50 3 3; node trickle.mjs <port> "$(cat token)" 8192 1 12
```

以下の 3 つの手本は、試作で**実際に動かしたもの**をそのまま載せた。この節のコードの塊を、1 行目の `// file:` の名前でファイルに書き出すと、そのまま動く。書き出しは次のとおり (`research.md` のパスは自分の環境に合わせる)。

```bash
node -e '
const fs = require("fs");
const md = fs.readFileSync(process.argv[1], "utf8");
for (const m of md.matchAll(/```js\n(\/\/ file: (\S+)\n[\s\S]*?)```/g)) fs.writeFileSync(m[2], m[1]);
' research.md
```

書き出したものを、解析器だけの比較 (165 通りと m 系 97 通り)、引数の解析の突き合わせ、断片の分け方、`rv-hang.mjs`、HTTP/1.0 の `rep30.mjs`、`linger.mjs` に通して確かめた (結果は 16.10 の最後)。

TypeScript にするときは、次の点に気を付ける。

- `new Hono<{ Bindings: HttpBindings }>()` で `c.env.incoming` / `c.env.outgoing` に型を付ける (`HttpBindings` は `@hono/node-server` から import する)。
- `serve()` の戻り値は `http.Server` に絞ってから `.on('checkContinue', …)` を呼ぶ。
- `/stats` の経路は計測の道具が読むためのもので、本番には入れない。変換の代わりの sha256 も同じ。

**引数の解析** (`header-params.ts` になる部分)

```js
// file: header-params.mjs
// Port of what python-multipart 0.0.27 parse_options_header returns (email.message._parseparam,
// email.utils.unquote / decode_params on Python 3.12), quirks included. Values are latin-1 strings.
export class InvalidMultipart extends Error {}
// Python raises an uncaught TypeError here (the service answers 500); we answer 422 like any bad body
export class UnreadableParams extends InvalidMultipart {}

// str.count(sub, start, end) with Python slice indices (a negative start counts from the end)
const count = (s, sub, from, to) => {
  const start = from < 0 ? Math.max(0, s.length + from) : from;
  let n = 0;
  for (let i = s.indexOf(sub, start); i !== -1 && i + sub.length <= to; i = s.indexOf(sub, i + sub.length)) n++;
  return n;
};
// Python's str.strip() whitespace within latin-1 (String#trim() lacks \x1c-\x1f and \x85)
const WS = '[\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0]+';
const strip = (v) => v.replace(new RegExp(`^${WS}|${WS}$`, 'g'), '');
const lstrip = (v) => v.replace(new RegExp(`^${WS}`), '');
const rstrip = (v) => v.replace(new RegExp(`${WS}$`), '');

// email.message._parseparam: split on ';' outside double quotes, counted the way Python counts them
function splitParams(value) {
  const s = `;${value}`;
  const out = [];
  let start = 0;
  while (s.indexOf(';', start) === start) {
    start += 1;
    let end = s.indexOf(';', start);
    let ind = start;
    let diff = 0;
    while (end > 0) {
      diff += count(s, '"', ind, end) - count(s, '\\"', ind, end);
      if (diff % 2 === 0) break;
      [end, ind] = [ind, s.indexOf(';', end + 1)];
    }
    if (end < 0) end = s.length;
    const f = s.slice(start, end);
    const i = f.indexOf('=');
    out.push(strip(i === -1 ? f : `${rstrip(f.slice(0, i)).toLowerCase()}=${lstrip(f.slice(i + 1))}`));
    start = end;
  }
  return out;
}

// email.utils.unquote
const unquote = (v) => {
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replaceAll('\\\\', '\\').replaceAll('\\"', '"');
  if (v.length > 1 && v.startsWith('<') && v.endsWith('>')) return v.slice(1, -1);
  return v;
};
const pctDecode = (v) => v.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
// email.utils.rfc2231_continuation is compiled with re.ASCII, so \w is [A-Za-z0-9_] here too
const RFC2231 = /^(\w+)\*(?:([0-9]+)\*?)?$/;
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// email.utils.decode_params: name*, name*0*, name*1, ... are joined in index order (BigInt: Python
// int has no precision limit), percent-decoded, and replace a plain parameter of the same name.
function joinExtended(segments) {
  const numbered = segments.filter((x) => x.n !== null).length;
  if (numbered !== 0 && numbered !== segments.length) throw new UnreadableParams('mixed RFC 2231 parameters');
  const sorted = [...segments].sort((x, y) => cmp(x.n ?? 0n, y.n ?? 0n) || cmp(x.v, y.v) || cmp(x.encoded, y.encoded));
  const joined = sorted.map((x) => (x.encoded ? pctDecode(x.v) : x.v)).join('');
  if (!sorted.some((x) => x.encoded)) return joined;
  const q = joined.split("'");
  return q.length >= 3 ? q.slice(2).join("'") : joined; // drop charset'language' (Starlette ignores the charset)
}

export function parseHeaderParams(value) {
  if (!value.includes(';')) return { type: strip(value.toLowerCase()), params: Object.create(null) };
  const pairs = splitParams(value).map((p) => {
    const eq = p.indexOf('=');
    return eq === -1 ? [strip(p), ''] : [strip(p.slice(0, eq)), strip(p.slice(eq + 1))];
  });
  const params = Object.create(null); // a part named "__proto__" must stay a plain key
  const extended = new Map();
  for (const [name, raw] of pairs.slice(1)) {
    const v = unquote(raw);
    const m = RFC2231.exec(name);
    if (m === null) params[name] = v;
    else extended.set(m[1], [...(extended.get(m[1]) ?? []), { n: m[2] === undefined ? null : BigInt(m[2]), v, encoded: name.endsWith('*') }]);
  }
  for (const [name, segments] of extended) params[name] = joinExtended(segments);
  // python-multipart's IE6 fix: a Windows path in filename keeps only its last segment
  const fn = params.filename;
  if (fn !== undefined && (fn.slice(1, 3) === ':\\' || fn.startsWith('\\\\'))) params.filename = fn.split('\\').pop();
  return { type: pairs[0][0], params };
}
```

**分解** (`parse-multipart.ts` になる部分)

```js
// file: parse-multipart.mjs
// One synchronous, incremental multipart/form-data parser for POST /extract. Grammar and limits follow
// python-multipart 0.0.27 as Starlette 1.0.0 drives it (extract_upload.py). Every malformed body throws
// InvalidMultipart from write() or end(); nothing is asynchronous, so there is no 'error' event to miss.
import { isUtf8 } from 'node:buffer';
import { InvalidMultipart, parseHeaderParams } from './header-params.mjs';

export { InvalidMultipart };

const CR = 0x0d, LF = 0x0a, HYPHEN = 0x2d, COLON = 0x3a, SPACE = 0x20;
const TOKEN = new Uint8Array(256);
for (const c of Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'*+-.^_`|~")) TOKEN[c] = 1;
const LIMITS = Object.freeze({ maxHeaderSize: 4224, maxHeaderCount: 8, maxFields: 1000, maxFiles: 1, maxFieldSize: 1024 * 1024 });
const BLOCK = 64 * 1024; // small chunks are copied into blocks of this size
const SMALL_CHUNK = 16 * 1024; // chunks of at least this size are kept as they arrived (no copy)

// Starlette's _user_safe_decode with its utf-8 default: utf-8 if valid, else latin-1
const decodeText = (latin1) => {
  const b = Buffer.from(latin1, 'latin1');
  return isUtf8(b) ? b.toString('utf8') : latin1;
};

// The boundary of a multipart/form-data request; the type is compared byte for byte, as Python does
export function boundaryOf(contentType) {
  const { type, params } = parseHeaderParams(contentType);
  if (type !== 'multipart/form-data' || params.boundary === undefined) throw new InvalidMultipart('not multipart/form-data');
  return params.boundary;
}

// Only `file` and `mimeType` keep their bytes; any other part is only counted
function createPartSink(kind, name, filename, keep) {
  const chunks = [];
  let size = 0, block = null, used = 0;
  const flush = () => {
    if (used > 0) chunks.push(used === BLOCK ? block : Buffer.from(block.subarray(0, used)));
    block = null;
    used = 0;
  };
  return {
    kind, name, filename, chunks,
    get size() { return size; },
    add(b) {
      if (b.length === 0) return;
      size += b.length;
      if (kind === 'field' && size > LIMITS.maxFieldSize) throw new InvalidMultipart('field too large');
      if (!keep) return;
      if (b.length >= SMALL_CHUNK) { flush(); chunks.push(b); return; }
      if (block === null || used + b.length > BLOCK) { flush(); block = Buffer.allocUnsafe(BLOCK); }
      b.copy(block, used);
      used += b.length;
    },
    close: flush,
  };
}

export function createMultipartParser(boundary) {
  // The carried-over delimiter match may only start at the last CR, so a boundary must not hold one (LF is fine)
  if (boundary.includes('\r')) throw new InvalidMultipart('CR in boundary');
  const opening = Buffer.from(`--${boundary}`, 'latin1');
  const delim = Buffer.from(`\r\n--${boundary}`, 'latin1');
  const fail = (why) => { throw new InvalidMultipart(why); };
  let state = 'start', idx = 0, matched = 0;
  let headerCount = 0, headerSize = 0, headerName = '', headerValue = '', disposition = null;
  let part = null, files = 0, fields = 0;
  let file = null, hint = null; // Starlette's FormData.get(): the last completed part of that name wins

  const startPart = () => { state = 'headerStart'; headerCount = 0; disposition = null; };
  const headersDone = () => {
    const p = disposition === null ? Object.create(null) : parseHeaderParams(disposition).params;
    if (p.name === undefined) fail('part without a name');
    const name = decodeText(p.name);
    if (p.filename !== undefined) {
      if (++files > LIMITS.maxFiles) fail('too many files');
      part = createPartSink('file', name, decodeText(p.filename), name === 'file');
    } else {
      if (++fields > LIMITS.maxFields) fail('too many fields');
      part = createPartSink('field', name, null, name === 'mimeType');
    }
  };
  const partEnd = () => {
    part.close();
    if (part.name === 'file') file = part;
    if (part.name === 'mimeType') hint = part;
    part = null;
  };
  // "\r\n--boundary" followed by neither CRLF nor "--" is part data (python-multipart), not a delimiter
  const notADelimiter = (consumed) => { part.add(Buffer.concat([delim, Buffer.from(consumed, 'latin1')])); state = 'data'; };

  const write = (chunk) => {
    let pos = 0;
    while (pos < chunk.length) {
      switch (state) {
        case 'start': // leading CR/LF: skip to the first '-' (python-multipart, but here independent of chunking)
          if (chunk[pos] === CR || chunk[pos] === LF) { state = 'skip'; pos++; } else state = 'opening';
          break;
        case 'skip': { const h = chunk.indexOf(HYPHEN, pos); if (h === -1) return; pos = h; state = 'opening'; break; }
        case 'opening':
          if (chunk[pos++] !== opening[idx++]) fail('no opening boundary');
          if (idx === opening.length) state = 'openingEnd';
          break;
        case 'openingEnd': { const c = chunk[pos++]; if (c === CR) state = 'openingLF'; else if (c === HYPHEN) state = 'emptyClose'; else fail('bad opening boundary'); break; }
        case 'openingLF': if (chunk[pos++] !== LF) fail('bad opening boundary'); startPart(); break;
        case 'emptyClose': if (chunk[pos++] !== HYPHEN) fail('bad closing boundary'); state = 'epilogue'; break;
        case 'headerStart':
          if (chunk[pos] === CR) { pos++; state = 'headersLF'; break; }
          if (++headerCount > LIMITS.maxHeaderCount) fail('too many part headers');
          headerSize = 0; headerName = ''; headerValue = ''; state = 'headerName';
          break;
        case 'headerName': {
          const c = chunk[pos++];
          if (++headerSize > LIMITS.maxHeaderSize) fail('part header too long');
          if (c === COLON) { if (headerName === '') fail('empty header name'); state = 'valueStart'; }
          else if (TOKEN[c] === 1) headerName += String.fromCharCode(c);
          else fail('bad header name');
          break;
        }
        case 'valueStart':
          if (chunk[pos] === SPACE) { pos++; if (++headerSize > LIMITS.maxHeaderSize) fail('part header too long'); } else state = 'value';
          break;
        case 'value': {
          const e = chunk.indexOf(CR, pos);
          const end = e === -1 ? chunk.length : e;
          headerSize += end - pos;
          if (headerSize > LIMITS.maxHeaderSize) fail('part header too long');
          headerValue += chunk.toString('latin1', pos, end);
          pos = end;
          if (e !== -1) {
            pos++;
            if (headerName.toLowerCase() === 'content-disposition') disposition = headerValue; // the last one wins
            state = 'valueLF';
          }
          break;
        }
        case 'valueLF': if (chunk[pos++] !== LF) fail('CR without LF in a part header'); state = 'headerStart'; break;
        case 'headersLF': if (chunk[pos++] !== LF) fail('bad end of part headers'); headersDone(); state = 'data'; matched = 0; break;
        case 'data': {
          // `matched` bytes of the delimiter ended the previous chunk. CR occurs only at delim[0] (a
          // boundary cannot hold CR), so on a mismatch those bytes are data and matching restarts here.
          if (matched > 0) {
            while (pos < chunk.length && matched < delim.length && chunk[pos] === delim[matched]) { pos++; matched++; }
            if (matched === delim.length) { matched = 0; state = 'afterDelim'; break; }
            if (pos === chunk.length) return;
            part.add(delim.subarray(0, matched));
            matched = 0;
          }
          const j = chunk.indexOf(delim, pos);
          if (j !== -1) { part.add(chunk.subarray(pos, j)); pos = j + delim.length; state = 'afterDelim'; break; }
          // keep back a tail that may begin a delimiter: it can only start at the last CR
          const cr = chunk.lastIndexOf(CR);
          const tail = chunk.length - cr;
          if (cr >= pos && tail < delim.length && chunk.subarray(cr).equals(delim.subarray(0, tail))) {
            part.add(chunk.subarray(pos, cr));
            matched = tail;
          } else part.add(chunk.subarray(pos));
          return;
        }
        case 'afterDelim': { const c = chunk[pos]; if (c === CR) { pos++; state = 'afterDelimLF'; } else if (c === HYPHEN) { pos++; state = 'afterDelimDash'; } else notADelimiter(''); break; }
        case 'afterDelimLF': if (chunk[pos] !== LF) { notADelimiter('\r'); break; } pos++; partEnd(); startPart(); break;
        case 'afterDelimDash': if (chunk[pos] !== HYPHEN) { notADelimiter('-'); break; } pos++; partEnd(); state = 'epilogue'; break;
        case 'epilogue': return; // ignored, as python-multipart does
        default: fail('unknown state');
      }
    }
  };
  // Like Starlette, only completed parts count: a body cut after the file part has ended still yields it
  const end = () => {
    if (file === null || file.kind !== 'file') fail('no file part');
    if (hint !== null && hint.kind !== 'field') fail('mimeType sent as a file');
    const mimeHint = hint === null ? null : decodeText(Buffer.concat(hint.chunks).toString('latin1'));
    return { chunks: file.chunks, size: file.size, filename: file.filename, mimeHint: mimeHint === '' ? null : mimeHint };
  };
  return { write, end };
}
```

**受け取りと早めのエラー応答** (`receive-upload.ts` と、ルートの組み立てになる部分。変換の代わりに sha256 を返す)

```js
// file: server.mjs
// Prototype of the HTTP intake for POST /extract: auth, early 413, slot, capped + deadlined read of
// c.env.incoming into the parser, early error answers. The conversion is replaced by a stand-in.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { boundaryOf, createMultipartParser, InvalidMultipart } from './parse-multipart.mjs';

const MIB = 1024 * 1024;
const MAX_FILE = Number(process.env.MAX_FILE_SIZE_MB ?? 50) * MIB;
const MAX_BODY = MAX_FILE + 64 * 1024; // same framing room as Python's MULTIPART_OVERHEAD_BYTES
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_S ?? 15) * 1000;
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 3);
const TOKEN = process.env.TOKEN;

class TooLarge extends Error {}
class UploadTimeout extends Error {}
class Disconnected extends Error {}

// One deadline for the whole body; the byte cap counts what arrived, not what was declared.
// The parser is synchronous, so the deadline and the disconnect listeners only matter for slow bodies.
function receiveIncoming(incoming, parser, signal) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let settled = false;
    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      incoming.off('data', onData).off('end', onEnd).off('error', onErr).off('close', onClose);
      signal.removeEventListener('abort', onAbort);
      if (err) { incoming.pause(); reject(err); } else resolve(value);
    };
    const onData = (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY) return settle(new TooLarge());
      try { parser.write(chunk); } catch (e) { settle(e); }
    };
    const onEnd = () => { try { settle(undefined, parser.end()); } catch (e) { settle(e); } };
    const onErr = () => settle(new Disconnected());
    const onClose = () => { if (!incoming.complete) settle(new Disconnected()); }; // gone mid-body
    const onAbort = () => settle(new Disconnected());
    const timer = setTimeout(() => settle(new UploadTimeout()), UPLOAD_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort);
    incoming.on('data', onData).on('end', onEnd).on('error', onErr).on('close', onClose);
  });
}

// Read and drop what is left of the request body, then let Node close the socket its usual way
// (destroySoon: end our side, destroy once written). Closing with unread input is what resets the
// connection. Node and @hono/node-server may both call destroySoon, so this runs once per socket.
const draining = new WeakSet();
function drainThenClose(incoming, destroySoon) {
  const sock = incoming.socket;
  if (draining.has(sock)) return;
  draining.add(sock);
  if (incoming.complete) { destroySoon.call(sock); return; }
  let n = 0;
  const giveUp = setTimeout(() => sock.destroy(), 500); // same bound as @hono/node-server's own drain
  incoming.on('data', (d) => { n += d.length; if (n > 64 * MIB) { clearTimeout(giveUp); sock.destroy(); } });
  incoming.once('end', () => { clearTimeout(giveUp); destroySoon.call(sock); });
  incoming.resume();
}

// When Node will close the connection after this answer (HTTP/1.0 without keep-alive, or
// "Connection: close"), it calls socket.destroySoon(); with unread body that resets the connection
// and the client can lose the answer. Undocumented path (shouldKeepAlive, destroySoon): test it (16.5).
const errorResponse = (c, status, code, message) => {
  if (c.env.outgoing.shouldKeepAlive === false) {
    const incoming = c.env.incoming;
    const destroySoon = incoming.socket.destroySoon;
    incoming.socket.destroySoon = () => drainThenClose(incoming, destroySoon);
  }
  return c.json({ code, message }, status);
};

let busy = 0;
const app = new Hono();
app.post('/extract', async (c) => {
  // For authorization and content-type, Node keeps the first of duplicated headers, as Starlette does
  // (a duplicated content-length is a 400 before this); c.req.header() joins duplicates with ', '
  const headers = c.env.incoming.headers;
  if (headers.authorization !== `Bearer ${TOKEN}`) return errorResponse(c, 401, 'unauthorized', 'Missing or invalid Bearer token');
  const declared = headers['content-length'];
  if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > MAX_BODY) {
    return errorResponse(c, 413, 'file_too_large', 'Request body exceeds the file size limit'); // before the slot, body unread
  }
  if (busy >= MAX_CONCURRENCY) return errorResponse(c, 503, 'service_busy', 'Service is at maximum concurrency');
  busy++;
  try {
    if (headers.expect?.toLowerCase() === '100-continue') c.env.outgoing.writeContinue();
    let upload;
    try {
      const parser = createMultipartParser(boundaryOf(headers['content-type'] ?? ''));
      upload = await receiveIncoming(c.env.incoming, parser, c.req.raw.signal);
    } catch (e) {
      if (e instanceof TooLarge) return errorResponse(c, 413, 'file_too_large', 'Request body exceeds the file size limit');
      if (e instanceof UploadTimeout) return errorResponse(c, 408, 'extraction_timeout', 'upload_timeout: the request body was not received in time');
      if (e instanceof InvalidMultipart || e instanceof Disconnected) {
        return errorResponse(c, 422, 'extraction_failed', "The request must be a multipart/form-data body with one 'file' part");
      }
      throw e;
    }
    if (upload.size > MAX_FILE) return errorResponse(c, 413, 'file_too_large', 'File exceeds the file size limit');
    // Stand-in for runner.run(): the chunks go to the child as they are (never Buffer.concat here)
    const sha = crypto.createHash('sha256');
    for (const ch of upload.chunks) sha.update(ch);
    return c.json({ sha: sha.digest('hex'), filename: upload.filename, mimeHint: upload.mimeHint, size: upload.size });
  } finally {
    busy--;
  }
});
// Prototype only: what the measurement scripts read (slots in use, peak RSS)
app.get('/stats', (c) => c.json({ busy, vmHWM: Math.round(Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]) / 1024) }));

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 0), hostname: '127.0.0.1' }, (info) => {
  process.stdout.write(`${JSON.stringify({ port: info.port, pid: process.pid })}\n`);
});
// Do not send "100 Continue" up front; the handler sends it once it decides to read the body
server.on('checkContinue', (req, res) => server.emit('request', req, res));
```

### 16.9 後のタスクへの引き継ぎ

- **3.7 (メモリの予算)**:
  - 親の最大 RSS は、50MiB × 3 件の同時の受け取りで 218〜285MiB だった (採る形。待機時 70MiB を含む。16.6)。
  - ただし、子へ書き込む間と、子からの結果 (最大 16MiB) を受け取る間の親のメモリを含まない。Python 版の 263MiB は子への受け渡しを含む (16.3)。3.7 で子と組み合わせて測り直し、T4 のメモリの基準の「仮に満たす」を確かめる。
  - 測り直すまでの見積もりは、`c.req.raw.body` を読む形のばらつき (最大 308MiB) と、16.8 の手本を変換の代わりの待ちなしで動かしたときの最大 285MiB (16.6) も考えて、**約 310MiB** を使う。
  - 予算の式の「アップロード 2 × `MAX_FILE_SIZE_MB`」は、採る形の実測 (1 件あたり約 60〜72MiB) より大きいので、そのままで安全側に入る。
  - 1 バイトずつの本文は、採る形で 1 件 83〜85MiB (4 回)、3 件同時で 93〜94MiB だった。16KiB と 1 バイトの交互は、32MiB を 3 件同時で 184MiB (4 回目のレビューの計測では 242MiB) だった (16.6)。
  - 応答の後も RSS が待機時に戻らないことが多い (16.6) ので、予算は最大の値で組む。
- **3.8 (部品を入れる)**: multipart の分解のための部品は入れない (`@fastify/busboy` も `busboy` も入れない)。入れるのは `hono` と `@hono/node-server` だけ。
- **6.8 (HTTP の層)**: 解析器は 2 つのファイルに分ける。
  - `header-params.ts`: 部品のヘッダーの引数の解析 (16.8 の `header-params.mjs`、約 90 行)。Python の `email` の処理の移植なので、Python の癖を直さない (直すと突き合わせの固定データと合わなくなる)。
  - `parse-multipart.ts`: 状態の遷移と中身の持ち方 (16.8 の `parse-multipart.mjs`、約 170 行)。
  - `receive-upload.ts` は 16.8 の `receiveIncoming` の形で書く。
    - `c.env.incoming` を直接読み、`c.req.raw.body` は触らない (触ると `toWeb` のストリームができる)。
    - 期限は受け取り全体に 1 つ掛け、結果が出るまで外さない。
    - 上限は届いたバイト数で数え、宣言は枠の前の早期の検査にだけ使う。
    - 途中の切断は `'close'` の時点で `incoming.complete` が false かどうかで、受け取りの後の切断は `signal` で判定する。
  - 早めのエラー応答は、16.8 の `errorResponse` の形にする (`shouldKeepAlive === false` の要求だけ `destroySoon` を差し替え、1 つのソケットで 1 回だけ動かす)。**読み捨てが終わったら、差し替える前の `destroySoon` を呼ぶ**。`socket.end()` だけで終えると、FIN を送らない相手のソケットが残り、fd が尽きると `/healthz` を含むすべての接続を受け付けられなくなる (16.10)。
  - 解析器は boundary の CR を 422 にし、LF は受け付ける。要求の `charset` は使わない (7.4 の判断で変わりうる)。
  - **要求のヘッダーは `c.env.incoming.headers` から読む**。`c.req.header()` は同じ名前のヘッダーを `, ` でつなぐので、`Content-Type` や `Authorization` が 2 行ある要求で Python 版と状態が変わる (16.10)。
  - `server.headersTimeout` と `server.requestTimeout` を明示して設定し、何も送らない接続がどれだけ残るかを記録する (いまの Node の既定では 60〜90 秒で 408 になる。uvicorn は 75 秒たっても閉じない。どちらも 5 回目のレビューの計測)。
  - `checkContinue` の受け手を置き、本文を読むと決めた後で `c.env.outgoing.writeContinue()` を呼ぶ。
  - **HTTP の層の細かい違い (6.8 で決めてテストに入れる。7.4 には諮らない)**: 重複ヘッダー以外の自作の 40 通りを Python 版 (uvicorn) と手本に送った結果 (6 回目のレビュー)、次の違いがある。apps/app (axios) は `POST /extract` に、正しい `Host` と `Expect` なしで送るので、どれも起きない。
    - `GET`・`PUT`・`OPTIONS`・`HEAD /extract` は Python 版が 405、手本は 404 (route が無い)。`POST /extract/` (末尾の `/`) は Python 版が 307 (FastAPI の redirect)、手本は 404。
    - `Expect: foo` (`100-continue` 以外) は Python 版が無視して 200、Node は 417 を返す。`Expect` が 2 行ある要求 (`100-continue` と `foo`) は、最終の状態は同じ 200 だが、Node は `incoming.headers.expect` が `, ` でつながるので 100 を返さない (Python 版は 100 の後に 200)。`server.on('checkExpectation')` を置くか、許容するかを 6.8 で決める。16.8 のコメントは `authorization` と `content-type` の重複だけを説明しているので、`checkExpectation` を置くなら `expect` のことも 1 行足す。
    - `Host` なしの HTTP/1.1 は Python 版が 200、Node は 400。
    - `Authorization: Bearer <token> ` (末尾に空白) は、Node が値の末尾の空白を削るので 200、Python 版は 401。Node のほうが HTTP の規則に合っているので直さない。
    - 6.8 の HTTP の層のテストには、この 9 通り (y01・y04・y12・y14・y15・y16・y22・y37・y38) を、Python 版の結果と、手本を変えた場合の期待に分けて入れる。
  - **ファイルは断片の配列と合計の大きさで持ち、`runner.run()` には断片のまま渡す** (design.md の Data Models の「親子の受け渡し」は、長さの見出しの後に断片を順に書けばよい)。**親で連結すると、メモリの基準を外れる**。16KiB 未満の断片を 64KiB の塊にまとめる持ち方も変えない (変えると、1 バイトずつの本文で 1GB を超える)。
  - ファイル名には CR・LF・NUL などがそのまま入りうる (40・r37 番。Python 版と同じ)。Python 版と同じく、ファイル名そのものをログに書かず、消毒した拡張子だけを書く。
  - `@hono/node-server` の `autoCleanupIncoming` (既定で有効) を切らない。
  - design.md の「継ぎ目」の表の「Hono では標準の `Request.body` を少しずつ読めばよい」は、`c.env.incoming` を読む形に変わる。design.md はこのタスクでは書き換えていない。7.4 の判断とあわせて直す。
- **6.x (HTTP の層のテスト)**: 「Python 版と 85 通りで同じ判定」を確かめる、という前の版の指示を、次のものに置き換える。
  - **(a) Python 版の結果を固定データにする**。Python 版はこの spec の終わりに撤去されるので、**動くうちに (6.x の最初に)** 次のものを JSON の固定データとして保存し、テストはその固定データと比べる。期待が Python 版と違うもの (37・d36・m21・d37・d12・m58〜m61 番) は、理由を書いて名前付きで別に並べる。
    - 312 通りの要求 (16.3 の生のバイト列。m 系・x 系・v 系・w 系を含む) について、Python 版の解析器の結果 (`py_oracle.py` と `pyo.py` の出力。受け付けたかどうか・ファイル名・拡張子・`mimeType`・大きさ・sha1)
    - 同じ 312 通りについて、生の要求に Python 版が返したステータスと `code` (`send-cases.mjs` の出力)
    - 要求の `charset` の場合 (m58〜m61・d12・v01〜v20 番。5 種類の影響のどれも含む) は、7.4 の判断に関わらず、Python 版の結果をそのまま残す (判断が「合わせる」になったときの期待になる)
    - 同じ名前のヘッダーが 2 行ある要求 (w01・w13〜w19 番) は、Python 版と同じ期待として入れる
    - 引数の解析の入力と Python の結果を 2,000 件程度 (`fuzz_params.mjs` と `fuzz_params2.mjs` で作る)。**ASCII でない引数の名前と、2^53 を超える番号を必ず含める** (直す前の手本の誤りは、この 2 つでしか出なかった。16.10)。
  - **(b) 断片の分け方を変えるテスト**: 165 通りと m 系 97 通りの本文で、すべての 2 分割 (64KiB 以下の本文)、1 バイトずつ、ランダムな分割。結果 (sha まで) が、まとめて流したときと同じであること。
  - **(c) 枠の戻り**: `rv-hang.mjs` と同じ形 (273 通り × 5 つの送り方の後に、使用中の枠が 0 で、次の要求が 200 になること)。
  - **(d) メモリの回帰テスト**: 50MiB × 3 件の同時の受け取り、1 バイトずつの送信 (1 件と 3 件同時)、16KiB と 1 バイトを交互に送る形 (塊にまとめる決まりのすき間を突く形)。
  - **(e) 応答の後に閉じる接続**: HTTP/1.0 の要求、`Connection: close` の要求、受け取り途中の 413 を、それぞれ 30 回以上繰り返し、すべて 413 が届くこと。応答の `Connection` が正しいこと。同じ接続に続けて送った要求が処理されないこと。
  - **(f)** `destroySoon` が 2 回呼ばれても、読み捨てと終わりの処理が 1 回しか動かないこと。
  - **(g) ソケットが残らないこと**: FIN を送らない (相手からの送信を終えない) クライアントへ、早めの 401 (トークンなし)・413 (宣言の上限超、受け取り途中の上限超、`Expect: 100-continue` つきの上限超)・422・408・503 を返した後、HTTP/1.0 の要求と `Connection: close` の要求の両方で、サーバーの開いている fd の数が約 1 秒で元に戻ること (`linger.mjs` と同じ形)。(e) と (f) だけでは、この誤りは見つからない。
- **4.x (テスト)**:
  - 16.4 の 312 通りの要求は、そのまま黒箱のテストの場合にできる (Python 版にも向けられる)。7.4 の 3 つ (m58〜m61・d12・v01〜v20 番を含む) と、d36・m21 番は、期待を分ける。
  - Python のテストの multipart の場合 (`tests/test_extract_router.py` の 334〜404 行、`tests/test_e2e_http.py` の 438〜460 行) は、どれも 165 通りの生の要求のどれかと同じ形だった (対応を読んで確かめただけで、Node 版に向けて実行はしていない)。2MiB の普通の項目を送るテストは、既定の上限 (50MiB) では d32 番と同じ決まり (項目は 1MiB まで) で 422 になる。
  - `test_live_server.py` の `TestIntakeOrder` の形 (`_request_head` と `_chunked_upload` が `Connection: close` を付ける) が前の版で揺れた件は、案 4 (16.5) で解消する。案 4 を入れたうえで揺れないことを、同じテストを数十回繰り返して確かめる。
  - 1 バイトずつ送る場面と、不正な本文の後に枠が戻ること (16.5) を足す。

### 16.10 RED (選定の前の状態と、差し戻された試作)

- 選定の記録が無かった: `grep -n "^## 16" research.md` は何も出さなかった (終了コード 1)。未決事項の表の「本文の受け取りと切断の検知の方法」は「未決」だった。
- 最初に失敗した試作は、`@fastify/busboy` のファイルの `stream` に `'error'` の受け手を付けなかったもの。終わりの区切りが無い本文 (29 番) 1 件で、親のプロセスごと落ちた (`Error: Unexpected end of form` → `Emitted 'error' event on FileStream instance`)。
- (a) `formData()` は、項目 1,001 個を 200 で通し、50MiB × 3 件で 758MiB になった。最後に連結する形は 416〜426MiB だった。
- **1 回目のレビューで差し戻された点**:
  - 検査の無い `@fastify/busboy` では、90KiB のファイル名が `{"case":"35-header-90KiB","status":200,…,"filename":"<81863 chars>"}` になった。2,500 行のヘッダー、9 行のヘッダー、4,225 バイトの行なども 200 だった (Python 版は 422)。
  - `Connection: close` の早めの 413 が、30 回中 26〜27 回しか届かなかった。
  - `c.req.raw.body` の断片を「コピーではない」と書いていた (実際は `toWeb` で 1 回)。
- **2 回目のレビューで差し戻された点** (直す前の採用した形の出力。枠 1、期限 2 秒):
  - **枠が永久に返らない**:
    ```
    {"mode":"wait","case":"e06-lf-headers-crlf-delims","status":null,"code":null,"ms":5004,"busyAfter":1,"nextStatus":503}
    {"mode":"wait","case":"h1-no-blank-line-after-headers","status":503,"code":"service_busy","ms":5007,"busyAfter":1,"nextStatus":503}
    {"mode":"cut","case":"h3-close-right-after-headers","status":null,"code":null,"ms":501,"busyAfter":1,"nextStatus":503}
    ```
    原因は 2 つ。前の版の受け取りが、最後のバイトが届いた時点で期限と切断の見張りを外していたこと。`@fastify/busboy` が、空行で終わらないヘッダーのまま本文が終わると、`finish` も `error` も出さないこと。
  - 前置きの扱い (e01・e02 番)、中身の中の区切りに似た並び (e07 系)、ヘッダーの文法 (e10・e11・e12・e27・e22) で、Python 版と違った。
  - `shouldKeepAlive = true` の案が、`Connection: close` の要求に `keep-alive` と返した。
- **3 回目のレビューで差し戻された点** (前の版の採用の形。今回、同じ 127 通りと同じ設定で取り直した):
  - **127 通り中 106 通りしか Python 版と同じでなかった** (前の版は「Python 版と同じ判定」を 85 通りでしか確かめておらず、記録ではそれをサービス全体に広げていた):
    ```
    $ node my-cmp.mjs my-r-py.jsonl my-r-a.jsonl 127
    r01-lf-lead: py=200 node=422 extraction_failed
    r12-attachment-disposition: py=200 node=422 extraction_failed
    r14-two-cd-headers: py=422 extraction_failed node=200 fn="a.txt"
    r16-name-without-value: py=200 node=422 extraction_failed
    r31-boundary-twice: py=200 node=422 extraction_failed
    … (21 行)
    {"total":127,"same":106,"echo":0}
    ```
  - **HTTP/1.0 の要求に 413 が届かない**: 案 3 (`Connection` ヘッダーの正規表現) では、`30-http10.req` を 30 回送って 413 が届いたのは `{"413":15,"none/EPIPE":15}`・`{"413":1,"none/EPIPE":29}`・`{"413":1,"none/EPIPE":29}` だった (3 回目のレビューでは 10〜20 回)。前の版の「300 回すべて届く」は、`Connection: close` を付けた HTTP/1.1 の要求だけを数えた値だった。
  - 根本原因は、本文を読む部品が 2 つあり、受け付ける形を別々の決まりで判定していたことだった (16.7)。検査を部品に合わせて直し続ける形では収束しないので、解析器を 1 つにした。
- **根本原因の調べで新たに見つかった点**:
  - **1 バイトずつの TCP**: 前の版の採用の形は、8MiB のファイルを 1 バイトずつ送ると (15 秒の期限までに届いたのは 4.3MiB)、親の最大 RSS が **987MiB** になった (`{"sentKiB":4366,"ms":15005,"status":"408","idleHWM":70,"hwm":987}`)。解析器を 1 つにしても、届いた断片をそのまま持つ形 (`SMALL_CHUNK = 0`) では **1,099MiB** だった。16KiB 未満の断片を 64KiB の塊にまとめて **84〜85MiB** になった (読み捨てるだけのサーバーは 77〜78MiB)。
  - 3 回目のレビューの担当が試しに書いた解析器は、ファイル名の取り出しに誤りがあった。06 番の `C:\Users\x\a.txt` が `C:Usersxa.txt` になった。引用符の中の `\X` をすべて外してから Windows のパスを削っていたためである (Python は `\\` と `\"` だけを外す)。採る形は Python と同じく `\\` と `\"` だけを外し、`a.txt` になる。
- **今回、手本を確かめて見つけた誤り** (根本原因の調べの手本の解析器):
  - 引数の名前が `name*` の形かどうかを、Unicode の文字を含めて判定していた (コメントにも「Python の `\w` は Unicode に対応する」とあった)。Python の `email.utils.rfc2231_continuation` は `re.ASCII` で作られている (flags が 256 であることを確かめた) ので、ASCII の英数字と `_` だけで判定するのが正しい。
  - 続きの番号を `Number` で比べていた。2^53 を超える番号は比べると同じになり、つなぐ順番が変わりうる。Python の `int` は桁数に制限が無いので、`BigInt` で比べる形に直した。
  - 直す前の手本では、`fuzz_params.mjs` の種 777 で 10 万件中 1 件 (`">;xéname*"` が Python は `xéname*`、手本は `xéname`) が違った。断片に ASCII でない名前と大きな番号を足した `fuzz_params2.mjs` では、種 4242 で 10 万件中 19,163 件が違った。直した後は、どちらも 4 つの種で 10 万件ずつ、違いは 0 件だった (16.4)。
  - 影響: ASCII でない引数の名前は、結果の `name` と `filename` を変えない (違うのは使わない引数の名前だけ)。2^53 を超える番号は、`filename` のつなぐ順番を変えうる。
- **4 回目のレビューで差し戻された点** (直す前の手本の出力):
  - **早めのエラー応答の後にソケットが残る**: 前の版の手本は、`destroySoon` の差し替えの中で、読み捨ての後に `socket.end()` だけを呼んでいた。Node の普通の閉じ方 (送信を終え、送り終えたらソケットを壊す) のうち「壊す」をしないので、FIN を送らない相手のソケットが残った。トークンが無くても起こせる。`linger.mjs` (FIN を送らないクライアント 20 本、15 秒待つ) の出力:
    ```
    {"kind":"noauth","n":20,"fdsBefore":19,"fdsAfter1_5s":39,"fdsAfterWait":39,"waitMs":15000,"got":20,"end":20,"close":0}
    {"kind":"noauth10","n":20,"fdsBefore":19,"fdsAfter1_5s":39,"fdsAfterWait":39,"waitMs":15000,"got":20,"end":20,"close":0}
    {"kind":"big10","n":20,"fdsBefore":19,"fdsAfter1_5s":39,"fdsAfterWait":39,"waitMs":15000,"got":20,"end":20,"close":0}
    ```
    (`big10` は 5 本でも 19 → 24 のまま。4 回目のレビューでは、5 本が 90 秒後 (Node の `headersTimeout` の 60 秒より長い) まで残った。) 読み捨ての後に元の `destroySoon` を呼ぶ形に直し、同じ 3 つで fd は 19 のまま (1.5 秒後も 15 秒後も) になった。
  - **要求の `charset` で状態が変わる入力が、分類から漏れていた**: 前の版は d12 番だけを見て「拡張子は同じで状態は変わらない」としていた。生の要求を Python 版 (uvicorn) と手本に送った出力:
    ```
    $ node my-cmp.mjs m-r-py.jsonl m-r-o.jsonl
    m21-star-and-star0-mixed: py=500 node=422 extraction_failed
    m58-charset-utf16: py=422 extraction_failed node=200 fn="a.txt"
    m61-charset-cp037: py=422 extraction_failed node=200 fn="a.txt"
    m64-boundary-lf-only: py=200 node=422 extraction_failed
    x08-chunked-malformed: py=400 unsupported_format node=200 fn="\"a.txt\"\nX"
    {"total":108,"same":103,"echo":0}
    ```
    m58・m61 は状態が入れ替わり、m59・m60 は名前の読み方が変わる。7.4 の 3 として諮る項目にした。
  - **LF だけの boundary** (m64 番): 前の版は CR と LF をまとめて 422 にし、理由に「区切りの持ち越しの判定」を挙げていたが、その理由は CR にしか当てはまらない。LF を許す形 (`boundary.includes('\r')` だけを 422) に直し、m64 は Python 版と同じ 200 になった。
  - **解析の速さの最悪の場合**を載せていなかった (16.4 の補足に足した。50MiB で 2.4 秒、Python 版は 4.9 秒)。
  - 案 3 の HTTP/1.0 の値を「案 0 より悪い」としていた (ばらつきの範囲と書き直した)。12 番の後の 422 が「捨てられた」と言い切っていた (「捨てられることがある」と書き直した)。
- **5 回目のレビューで差し戻された点** (直す前の手本の出力。Python 版 (uvicorn) と同じバイト列を送った):
  - **同じ名前のヘッダーが 2 行ある要求で状態が変わる**: 手本は `authorization`・`content-length`・`expect`・`content-type` を `c.req.header()` で読んでいた。これは Web の `Headers` を読むので、重複を `, ` でつないだ値を返す。273 通りに重複したヘッダーの要求が無く、見落としていた。
    ```
    $ node my-cmp.mjs vw-r-py.jsonl vw-r-o.jsonl
    w01-two-content-types: py=200 node=422 extraction_failed
    w15-auth-twice: py=200 node=401 unauthorized
    w17-ct-empty-second: py=200 node=422 extraction_failed
    w18-auth-valid-then-wrong: py=200 node=401 unauthorized
    ```
    4 つのヘッダーを `c.env.incoming.headers` から読む形に直し、重複したヘッダーの 8 通り (w01・w13〜w19) はすべて Python 版と同じになった。直す前と直した後の手本に 312 通りすべてを送り、結果 (ステータス・`code`・ファイル名・大きさ) が違ったのは w01・w15・w17・w18 の 4 通りだけだった (ほかへの波及は無い)。
  - **7.4 の 3 (要求の `charset`) の影響の説明が足りなかった**: 前の版は影響を「状態が Python 422 / Node 200 に入れ替わる」と「名前の読み方だけが変わる」の 2 種類とし、Python の振る舞いを「利用者に得の無いもの」と書いていた。5 回目のレビューの 20 通り (v01〜v20) で、ほかに 3 種類あった。
    ```
    v01-utf16-names-encoded: py=200 node=422 extraction_failed
    v02-cp037-names-encoded: py=200 node=422 extraction_failed
    v10-punycode: py=500 node=200 fn="a.txt"
    v11-charset-twice-last-utf16: py=422 extraction_failed node=200 fn="a.txt"
    v16-utf16le-names-encoded: py=200 node=422 extraction_failed
    v18-utf16-mimetype-only: py=422 extraction_failed node=200 fn="a.txt"
    ```
    v07 (`utf-7`) は、解析器だけの比較で Python 版のファイル名が `a.txt`、Node 版が `a.+AHQAeAB0-` (拡張子 `+ahqaeab0-`) だった。7.4 の 3 を 5 種類の影響で書き直した。推奨は「許容」のまま (apps/app は `charset` を付けない)。
  - 16.1 の読み捨ての歯止めを「最大 64MiB / 500ms」とだけ書いていた (本文を一度も読んでいない経路では 500ms だけが働く、と書き直した)。6.x (g) の確かめる応答に 422・408・503・`Expect` つきの 413 を足した。
- **書き出した手本の確認** (GREEN): 直した後の 16.8 のコードの塊を research.md から書き出したファイルで、次のことを確かめた。書き出した 3 つのファイルは、試作で動かした手本と 1 バイトも違わなかった。
  - (5 回目のレビューの後、ヘッダーの読み方を直した手本で取り直したもの) 312 通りの生の要求で 293 通りが Python 版と同じ (違いは 16.4 の表の 19 通り)。重複したヘッダーの 8 通りはすべて Python 版と同じ。ソケットが残らないこと (下の 4 種類) と、HTTP/1.0 と `Connection: close` の 413 (30 回 × 3 組) を取り直し、どれも同じ結果だった。そのほかの項目は、ヘッダーの読み方を直す前の手本で取った (312 通りの結果が重複したヘッダーの 4 通り以外で同じなので、解析器・枠の戻り・メモリの値は変わらないと見る)。
  - 解析器だけの比較: 165 通り中 163 通り (違いは d12・d37)、m 系 97 通り中 93 通り (違いは m58〜m61) が Python 版と同じ。
  - 引数の解析の突き合わせ: `fuzz_params.mjs` と `fuzz_params2.mjs` を 4 つの種で 10 万件ずつ、違い 0 件。
  - 断片の分け方: `{"cases":165,"twoWay":355074,"oneByte":157,"random":33000,"mismatches":0}` と、m 系の `{"cases":97,"checks":24881,"bad":0}`。
  - 生の要求 (上限 1MiB、期限 2 秒、枠 1): 273 通り中 260 通りが Python 版と同じ (違いは 16.4 の表の 13 通りと同じ)。応答に送った中身が含まれたものは 0。
  - 枠の戻り (`rv-hang.mjs`): 165 通りで `{"runs":797,"bad":0,"noAnswerWait":0,…}`、m 系・x 系の 108 通りで `{"runs":529,"bad":0,"noAnswerWait":0,…}`。
  - HTTP/1.0 の要求と `Connection: close` の要求 (30 番) への 413: どちらも 30 回 × 3 組ですべて届いた。`ab-close.mjs` の 4 つの組み合わせ (chunked / 宣言 × `Connection: close` あり / なし) も 30 回すべて届いた。
  - ソケットが残らないこと (`linger.mjs`、FIN を送らないクライアント 20 本): トークンなしの `Connection: close`・トークンなしの HTTP/1.0・上限超の 2MB の HTTP/1.0・上限超の 2MB の `Connection: close` (`linger.mjs` に 1 種類足した写し) のどれも、fd は 19 のまま。
  - 1 バイトずつの TCP: 親の最大 RSS 83MiB。
  - 50MiB × 3 件: 1 回 219・225MiB、3 回続けて 226〜247MiB (4 回)。
  - apps/app と同じ axios 1.15.0 で上限超 (2MiB・20MiB・100MiB) を 30 回ずつ: 90/90 が 413。

### 16.11 確かめなかったこと

- Node の slim image の中での値。
- 本物のネットワークの上で送った場合のメモリ (計測は同じホストの中で、届く速さが非常に速い)。
- 子への書き込みを含めた親の最大 RSS (3.7 で測る)。
- 1 バイトずつの本文と、断片の大きさを交互にする本文での、Python 版の RSS。
- FIN を送らないクライアントが大量 (fd の上限に近い数) に来た場合の振る舞い (20 本で fd が元に戻ることだけを確かめた)。
- 要求の `charset` の値のうち、測った 25 通り (m58〜m61・d12・v01〜v20 番) 以外のもの (apps/app は `charset` を送らないので、7.4 の 3 の判断に必要な範囲だけを測った)。
- Python 版の結果を固定データにすること (6.x の (a) の仕事)。
- 応答の後に閉じる接続で 413 が届かない仕組み (接続のリセットと見ているが、パケットを見ていない)。案 4 (`shouldKeepAlive` と `destroySoon`) が、Node の将来の版でも同じように働くか。
- `@hono/node-server` が 64MiB / 500ms を超えて接続を閉じたとき、または案 4 が 500ms で諦めたときに、応答 (413 など) がクライアントに届かない場合があるか (100MiB を axios で 30 回送った範囲では、すべて届いた)。
- curl の振る舞い。curl は 1MiB を超える本文に `Expect: 100-continue` を付けるので、`checkContinue` を受ける形なら、本文を送る前に 413 を受け取る見込み (curl では確かめていない)。
- HTTP/2。
- python-multipart の、前置きが断片の切れ目をまたぐ場合の振る舞い (ソースから読んだもので、Python 版に断片を分けて送って確かめてはいない)。
- Python の `email` の処理のうち、`fuzz_params.mjs` の断片で作れない形 (たとえば latin-1 の外の文字。部品のヘッダーは latin-1 として読むので、届くことはない)。

## 17. OpenAPI の作り方 (T5、タスク 3.4)

2026-11-05 に devcontainer (Node 24.21.0、Linux) で、使い捨ての場所 (scratchpad) に試作を作って確かめた結果。

- 版: `hono` 4.13.16、`@hono/node-server` 2.1.6、`@hono/zod-openapi` 1.6.3 (`@asteasolutions/zod-to-openapi` 9.1.0 を中で使う)、`hono-openapi` 1.5.0、`zod` 4.6.7、`ajv` 8.18.0 と 8.20.0、`orval` 7.2.0 (`packages/attachment-text-extractor-client` と同じ版)、biome 2.4.12 (リポジトリと同じ版)、TypeScript 5.9.3。
- 比べる相手: commit 済みの `packages/attachment-text-extractor-client/openapi.json` (Python 版の FastAPI が書き出し、biome で整えたもの) と、そこから作った `src/generated/index.ts`。
- 変えていないもの: 抽出サービスの package、lockfile、`pnpm-lock.yaml`、本番の `src/`、Python 版、`packages/attachment-text-extractor-client`。
- 数字と結果は、とくに書いていなければ **実測**。測っていないものは「未検証」、コードや文書を読んで考えたものは「推論」と書いた。

### 17.1 結論

**採る方法**: design.md の T5 の候補 (a)「commit 済みの文書を正とする」。具体的には次の形にする。

1. **文書は抽出サービスが持つ JSON のファイル** (`apps/attachment-text-extractor/src/http/openapi.json`)。中身は commit 済みの `openapi.json` に、17.6 の説明文の修正 5 件を当てたもの。説明文以外は commit 済みのものと 1 字も変えない (FastAPI が自動で付けた名前もそのまま残る)。
2. **`GET /openapi.json` はこのファイルをそのまま返す**。読み込みは `import openApiDocument from './openapi.json' with { type: 'json' };` の 1 行。コードから文書を作らないので、OpenAPI のための本番の依存は **0 個**。
3. **書き出しの手順** (`scripts/export-openapi.ts`) は、このファイルの中身を `--output` の場所に書く。
4. **drift 検知** (Req 7.3) は vitest のテストで行う。
   - 「サービスの文書と、commit 済みの `openapi.json` が JSON として同じ」を確かめる。撤去 (8.2) までは説明文を除いて比べ、8.2 で説明文を除く処理を消して完全な比較にする (17.7)。
   - 文書を手で持つので、「**コードが文書から外れていないか**」を別のテストで確かめる。対象は 4 つ: 経路の一覧、`ErrorCode` の値、エラー表の HTTP ステータス、実際の応答の形 (`ajv` を開発用の依存だけに入れて、文書のスキーマで検査する)。

**確かめた結果** (17.4):

- 説明文以外の差分は 0 件。
- orval で作り直した生成クライアントは、コメントを除くと差分 0 行。コメントの差分は 20 行で、すべて 17.6 の 5 件の説明文に当たる。
- 名前を合わせるためのコードは 0 行。
- drift と、コードが文書から外れることは、どちらもテストが失敗して分かる。わざと 7 種類の壊し方をして確かめた。

**契約は崩さない**。FastAPI の自動の名前 (`readyz_readyz_get`、`Body_post_extract_extract_post`、`Pagenumber` など) を守るのに、追加のコードが要らないためである (Req 1.9 / 7.6 の「守ると複雑になる」に当たらない)。research.md の 7 節には何も足さない。

### 17.2 比べた候補

| # | 方法 | 文書の出どころ | 試作 |
|---|---|---|---|
| (a) | 文書を正とする。サービスが JSON のファイルを持ち、そのまま返す。コードとの一致はテストで確かめる | 手で持つ JSON | した (`a/`) |
| (b1) | コードから作る: `@hono/zod-openapi` (`createRoute` と zod のスキーマ) | zod のスキーマと経路の定義 | した (`b1/`) |
| (b2) | コードから作る: `hono-openapi` (`describeRoute` と `resolver`。zod 4 自身の JSON Schema の変換を使う) | zod のスキーマと経路の定義 | した (`b2/`) |
| (c) | 文書を正とし、サービスの型を生成する (`@growi/attachment-text-extractor-client` の生成済みの型を type だけ import する、または openapi-typescript などで作る) | 手で持つ JSON | していない (17.5 で理由を書いた) |

`@asteasolutions/zod-to-openapi` だけを使う案 (Hono と結び付けず、登録簿だけで文書を作る案) は、(b1) の合わせた書き方で `/extract` に使った形 (`openAPIRegistry.registerPath` で文書だけに書く) と同じ部品なので、(b1) の結果に含めた。

### 17.3 比べ方

1. **orval の作り直しの再現を先に確かめた** (較正)。
   - 試作の場所で、commit 済みの `openapi.json` から orval 7.2.0 で作り直し、biome 2.4.12 で整えた。
   - 結果は、commit 済みの `src/generated/index.ts` と **1 バイトも違わなかった**。
   - 以後の「生成クライアントの差分」は、この手順で作ったものどうしを比べている。整形の違いは入っていない。
   - 試作の場所には、リポジトリの `biome.json` を写し、`vcs` を切り、`apps/app` 用の grit の plugin を外して置いた。外さないと biome が plugin のファイルを読めずに止まり、整形がされない。
2. **文書の比較** (`tools/doc-diff.mjs`、Req 7.1):
   - JSON として比べる。オブジェクトのキーの順は無視し (Python 版の `!=` と同じ)、配列の順は区別する (`required`・`enum`・`tags`)。
   - 違う所をすべて JSON Pointer で一覧にする。
   - 説明文を除くときは、注釈としての `description` だけを除く。`properties` の中の、`description` という名前の項目は除かない。いまの文書にこの名前の項目は無いが、将来その名前の項目が足されたときに、drift 検知が黙って見逃さないようにするためである。
3. **生成クライアントの比較** (`tools/client-diff.mjs`、Req 7.2):
   - 両方のファイルを TypeScript の printer に `removeComments: true` で通してから `diff -u` で比べる。
   - 差分が 0 行なら「コメントだけの差分」、1 行でもあれば「型・関数・引数の差分」と判定する。
   - 正規表現でコメントを消す方法は、文字列の中の `/*` などで誤るので使わなかった。
4. **名前を合わせるのに要るコードの量**: FastAPI の出力に合わせるために書いた指定と後処理を、種類ごとに数えた。
5. **drift 検知とコードとの一致の検査が働くか**: わざとコードか文書を壊し、テストが失敗するかを見た (17.4 の表 3)。

### 17.4 結果

**表 1: 文書と生成クライアント**

| 候補 | 説明文以外の差分 (件) | 生成クライアントの差分 (コメントを除く) | 名前を合わせるための指定と後処理 | 本番の依存 (足すもの) |
|---|---|---|---|---|
| (a) | **0** | **0 行** | **0** | **なし** |
| (b1) 何も合わせない書き方 | 26 | あり (`file: string` が `file?: unknown` になり、`formData.append('file', …)` が `if (… !== undefined)` で囲まれる) | 5 (スキーマ名) と 3 (`operationId`) | `@hono/zod-openapi`、`zod` (と下の 4 つ) |
| (b1) 合わせた書き方、スキーマの順を並べ替える前 | 0 | **あり** (宣言の順が入れ替わる。下の (ii)) | 下の行の 31 から並べ替えを除いた 30 | 同上 |
| (b1) 合わせた書き方 | **0** | **0 行** | **31** (`title` 15、スキーマ名 5、`operationId` 3、null を許す項目を `z.union([…, z.null()])` で書く 3、`contentMediaType` 1、`/extract` を登録簿だけに書く 1、生成された文書の後処理 3 (`webhooks` と空の `components.parameters` を消す、`components.schemas` を名前の順に並べる)) | 同上 |
| (b2) 1 回目 | 12 | 比べていない | `title` 15 ほか | `hono-openapi`、`zod` (と下の 4 つ) |
| (b2) 2 回目 | 7 | 0 行 (並べ替えた後) | 上と、`z.looseObject`、`z.union`、`minimum`・`maximum` の打ち消し。残りの 7 件 (`additionalProperties: false` が 3 件、null を許す項目が `anyOf` でなく `type: [..., "null"]` になる 4 件) は、スキーマの指定では消せなかった。消すには、生成された文書を書き換える後処理が要る | 同上 |

分かったこと:

- **(i) (b1) で `/extract` の本文のスキーマを zod で書くと、本文を検査する部品が付き、本文を先に読んでしまう** (`b1/validator-conflict.mjs`)。
  - `@hono/zod-openapi` 1.6.3 は、`createRoute` の本文のスキーマが **zod のときに限り**、本文を検査する部品 (と、Content-Type が違えば 415 を返す門番) を経路に付ける。スキーマが zod でなければ飛ばす (`dist/index.mjs` の 113〜130 行の `if (!isZod(schema)) continue;` など。コードを読んだ結果)。
  - zod で書いた試作では、この部品が本文を読み終えてしまった。2MiB のファイルを送ると、ハンドラーが `c.env.incoming` から読めたのは **0 バイト**だった。同じ本文を、検査の部品の無い経路に送ると 2,097,333 バイト読めた。`file` の無い本文には、部品が自分で `400` と `ZodError` を返した。エラー表の「422 `extraction_failed`」(Req 1.3) にならない。16 節の自前の解析器 (本文を少しずつ読み、上限・期限・切断を見る) と両立しない。
  - **本文のスキーマを zod でなく `$ref` (登録簿に素の JSON Schema として登録したもの) で書くと、検査の部品は付かない** (独立レビューの試作 `rev-probe/ref-body.mjs` を自分でも実行して再現した)。ハンドラーは `c.env.incoming` から 2,097,333 バイトを読め、`file` の無い本文も `ZodError` にならずにハンドラーまで届いた (200)。文書の `requestBody` は `"required": true` と `$ref` のまま出た。同じ書き方を TypeScript 5.9.3 の `tsc --noEmit` (strict) にかけると、型の誤りは出なかった (`ref-typecheck/ref-body.ts`。ハンドラーに型の誤りをわざと入れると `tsc` が失敗することも確かめた)。
  - ただしこの書き方では、`/extract` の本文のスキーマは zod から作られず、手で書いた JSON になる。(a) と同じ手間で、(b1) の利点である「コードの型から文書を作る」が、いちばん大事な `/extract` の本文では失われる。合わせた書き方 (表 1) で `/extract` を `registerPath` で文書だけに書いたのは、zod のスキーマを使い続けるためで、`$ref` で書けば経路の定義と文書は 1 か所にまとめられる。
- **(ii) JSON として同じでも、生成クライアントが変わることがある**。
  - orval は、`components.schemas` のキーの順に型の宣言を並べる。
  - (b1) が出す順 (`ExtractResponse`, `PageInfo`, …) は、FastAPI の順 (名前の順: `Body_…`, `ErrorCode`, …) と違う。そのため、JSON の比較では差分 0 件なのに、生成クライアントの宣言の順が入れ替わった。
  - コードから作る方法では、キーの順まで合わせる後処理が要る。(a) は文書をそのまま持つので、順も変わらない。
- **(iii) orval 7.2.0 は、型には影響しない違いを区別しない**。
  - null を許す項目を `anyOf: [{type}, {type: null}]` で書いても `type: [..., "null"]` で書いても、同じ `number | null` を作る。
  - `additionalProperties: false` の有無でも型は変わらない ((b2) の 2 回目の文書を並べ替えて作り直し、コメントを除いて差分 0 行)。
  - つまり Req 7.1 (説明文以外が JSON として同じ) は、Req 7.2 (型・関数・引数が同じ) より厳しい。(b) で 7.1 まで合わせるための指定のかなりの部分は、7.2 のためには要らない。7.1 を緩める判断 (7.6) をするときの材料になる。今回は (a) で 7.1 をそのまま満たせるので、緩めない。

**表 2: (a) の試作のコードの量** (空行とコメントを除いた行数)

| ファイル | 行数 | 中身 |
|---|---|---|
| `src/openapi.json` | 258 | 文書 (commit 済みのものと同じ行数。違うのは説明文 5 か所) |
| `src/openapi-route.ts` | 6 | JSON を import して `GET /openapi.json` で返す |
| `scripts/export-openapi.ts` | 6 | 文書を `--output` に書く |
| `src/contract.ts` | 25 | `ERROR_CODES` と `ExtractResponse`・`PageInfo`・`ErrorResponse` の型 (design.md の `contract/` に当たる) |
| `test/contract.test.ts` | 77 | drift 検知と、コードと文書の一致の検査 (17.7) |

比べると、(b1) の合わせた書き方は 56 行で、その中に上の 31 の指定と後処理がある。そのうえで `/extract` の本物のハンドラーと、`ajv` などの検査のテストは別に要る (文書がコードから作られても、`/extract` の応答が文書に合うことは、(b1) でもテストでしか分からない)。

**表 3: (a) の検査がコードと文書のずれを見つけるか** (`mut/` で 1 か所ずつ壊して、`node --test` を実行した)

| 壊し方 | 失敗したテスト |
|---|---|
| コードの `ERROR_CODES` に `new_code` を足す | `ErrorCode values in the code equal the documented enum` |
| `/extract` の 200 の応答に、文書に無い項目 `engine` を足す | `POST /extract matches the documented schema` |
| `pageNumber` を文字列 `'1'` で返す | `POST /extract matches the documented schema` |
| 文書に無い経路 `GET /metrics` を足す | `the routes the app serves are exactly the documented operations plus /openapi.json` |
| サービスの文書だけ `title` を `PageNumber` に変える | `exported document matches the committed client document (drift, 7.3)` |
| `/extract` のエラーの状態を、文書に無い 418 にする | `POST /extract?fail=1 matches the documented schema` |
| `/healthz` を 503 にする (503 を通すのが `/readyz` だけであることの確認) | `GET /healthz matches the documented schema` |
| (壊さない) | 10 件すべて通る (`/readyz` の 503 の場合を足した後。足す前は 9 件) |

- 最初の版のテストは、文書に無いステータスのエラーを `ErrorResponse` として通してしまっていた (418 にしても失敗しなかった)。
- 文書に書いていない応答のうち、通してよいのは次の 2 つである。どちらも Python 版の文書にも書いていない。文書 (契約) の中身は変えない。
  - 認証の部品が返す 401 (どのパスでも)。`ErrorResponse` で検査する。
  - 準備ができていないときの `/readyz` の 503 (`not_ready`。Python 版の `health.py` も返す)。文書の 200 のスキーマが `{}` なので、503 も形を問わない (`{}` で検査する)。
  - トークン付きで存在しないパスを呼んだときの 404 は、検査の関数が文書にあるパスにしか使われないので、ここには入れない。
- そこでこの 2 つだけを上のとおり検査し、それ以外の書いていないステータスは失敗にするよう直した。直した後で、`/readyz` の 503 の場合 (`/readyz?down=1`) を足して 10 件が通ること、「401 だけ」の決まりに戻すとこの 1 件が `not documented` で失敗すること、`/healthz` を 503 にすると失敗すること (503 を通すのは `/readyz` だけであること) を確かめた。

**完全な比較 (8.2 の後の形) で比べた結果**:

- 試作の文書と、いまの commit 済みの文書 (Python 版の説明文) を完全に比べると、説明文の 5 件だけが違い、drift のテストは失敗した。8.2 の前に完全な比較にしてはいけない理由がこれである。
- 8.2 の手順を試作の場所でなぞった。
  1. 書き出しの手順で書き出し、biome で整えた。結果は、サービスの `src/openapi.json` と **1 バイトも違わなかった**。
  2. それを commit 済みの文書として完全な比較のテストを流すと、すべて通った (`/readyz` の 503 の場合を足した後の 10 件でも確かめた)。
  3. そこから orval で作り直した生成クライアントは、コメントを除いて差分 0 行。コメントの差分は 20 行で、17.6 の 5 件だけだった。

### 17.5 選んだ理由と、選ばなかった理由

判断の基準は design.md の T5 の合否の基準と、Req 1 の「シンプルさ (保守性)」である。

**(a) を選んだ理由**:

- **Req 7.1 と 7.2 を、名前を合わせるコードなしで満たす**。文書がもともと FastAPI の名前を持っているので、守るための手間が 0 である。
- **本番の依存が増えない** (Req 4.4 の確認の手間も、image の大きさも増えない)。足すのは、テストだけで使う `ajv` 1 つである。`ajv` 8.18.0 は、すでに `pnpm-lock.yaml` に入っている (ほかの部品の依存として)。
- **16 節の自前の解析器と衝突しない**。経路は普通の `app.get` / `app.post` のまま書ける。
- **契約は凍結に近い**。経路は 4 つ、スキーマは 6 つで、apps/app が使うのは `postExtractExtractPost` と `ErrorCode` だけである。めったに変わらない小さな文書は、手で持つほうが読みやすく、直しやすい。
- **コードが文書から外れることは、テストで見つかる** (表 3)。手で持つ方法の弱点は、文書とコードが黙ってずれることである。応答と経路の側は 4 つの検査 (17.7 の 2) で埋めた。要求の側 (`file` と `mimeType` というフィールド名、`file` が必須であること、`mimeType` を省けること) は、この 4 つでは見ていない。4.4 の黒箱のテストで守る (17.10 の 4.4 / 4.6)。`mimeType` は形式を決めるヒントで、読めなくても拡張子で形式が決まる。そのため、拡張子とヒントが同じ形式を指す要求 (`a.pdf` に `application/pdf` を付けるなど) は、名前を取り違えていても通ってしまう。ヒントの有る無しで結果が変わる要求で確かめる。

**(b1) `@hono/zod-openapi` を選ばなかった理由**:

- 合わせるのに 31 の指定と後処理が要った。中身は FastAPI の出力を書き写すことと変わらない (たとえば `title: 'Extractedcharacters'`)。
- `/extract` の本文のスキーマを zod で書くと、検査の部品が本文を先に読む。`$ref` (素の JSON Schema) で書けば検査は付かないが、その場合 `/extract` の本文のスキーマは手で書いた JSON になり、(b1) の利点が `/extract` で失われる (17.4 の (i))。
- 本番の依存が 6 つ増える: `@hono/zod-openapi` と `zod`、それが引く `@asteasolutions/zod-to-openapi`・`openapi3-ts`・`yaml`・`@hono/zod-validator`。`zod` だけで約 8MB ある。
- スキーマの順を合わせる後処理も要る (17.4 の (ii))。

**(b2) `hono-openapi` を選ばなかった理由**:

- 本文を読まずに文書だけを書けるのは (b1) より良い (検査は別の部品で、付けなければ動かない)。
- しかし zod 4 の JSON Schema の変換が、`additionalProperties: false`、`type: [..., "null"]`、`minimum`・`maximum` (安全な整数の範囲)、`propertyNames` を足す。2 回直しても 7 件の差分が残った。
- 残りを消すには、生成された文書を書き換える後処理が要る。
- `hono-openapi` 1.5.0 は 2026-10-18 に出たばかりである (版の変化の速さは、公開日を見ただけの推論)。

**(c) を試作しなかった理由** (どれも推論。試作はしていない):

- サービスの型を生成クライアントの型から取る方法は、次の手間が増える。
  - 生成クライアントの `dist` を先に作る必要があり、turbo のビルドの順の指定が増える。
  - `ErrorCode` の値はエラー表で実行時に使う。クライアントの package から値も取るなら、それを本番の依存にする必要が出て axios が image に入る。型だけを取るなら、値の一覧は (a) と同じく自前の `ERROR_CODES` で別に持ち、テストで照合することになる (その形なら本番の依存は増えない)。
- openapi-typescript などで型を生成する方法は、生成の道具と生成物が 1 つずつ増える。
- 型の食い違いは、(a) では表 3 の検査で見つかる。(c) の利点は「型の食い違いを、テストを流す前の型の検査で見つける」ことだけで、手間に見合わない。

**名前を合わせることと、契約を崩すことの判断** (Req 1.9、1.10、7.6):

- (a) では、FastAPI の自動の名前を守るのに追加のコードが要らない。守っても複雑にならないので、**崩さない**。
- (b) を選んでいたら、31 の指定と後処理が「守ると複雑になる」に当たり、7.6 の手続きで名前を崩すかを判断することになっていた。崩した場合の下流の変更は、次のとおりだった (推論。apps/app と生成クライアントの import を grep で確かめた範囲)。
  - 生成クライアントの関数名と型名が変わる (例: `postExtractExtractPost` → `postExtract`)。
  - apps/app の `attachment-text-extractor.ts` とその spec の import を直す。
  - `attachment-search-indexing` spec の記述を直し、その spec を Amend target に加える。
- (a) を選んだので、この変更はどれも起きない。

### 17.6 説明文の修正の一覧 (Req 7.1、7.5)

commit 済みの文書には、注釈としての `description` が 19 か所ある。そのうち Python に固有の言葉か、Node 版に合わない内容を含む **5 か所**を直す。

| # | 場所 (JSON Pointer) | 直す前 | 直した後 | 直す理由 |
|---|---|---|---|---|
| 1 | `/paths/~1readyz/get/description` | ```200 ``ready`` when the forkserver runs and has loaded the conversion dependencies, else 503.```<br><br>`A not-ready cached state is re-verified (in a thread: it forks a probe child), so a pod that was taken out of service gets the call that brings it back. The body never carries paths or exception text.` | ``200 `ready` when `prlimit` can be run and a probe child process starts, else 503 `not_ready`.``<br><br>`The body never carries paths or exception text.` | forkserver・fork・thread は Python 版の仕組み。二重の逆引用符は Python の docstring (reStructuredText) の書き方。Node 版の準備完了の条件 (design.md の HTTP の層の「`prlimit` を起動できないとき、または確認用の子が起動できないときは 503」、Req 8.8) だけを書いた。部品を読み込めたかを条件にするか、キャッシュと再確認をするかは 6.x で決まるので書かない |
| 2 | `/paths/~1extract/post/description` | `Receive a multipart upload, enforce the slot and size limits, then convert.`<br><br>`Authentication is handled upstream by BearerAuthMiddleware; this handler will only be reached by authenticated requests.` | `Receive a multipart upload, enforce the slot and size limits, then convert it in a child process.`<br><br>`The Bearer token is checked before this operation runs; only authenticated requests reach it.` | `BearerAuthMiddleware` は Python 版のクラスの名前 |
| 3 | `/components/schemas/ErrorCode/description` | `Machine-readable error codes for all defined failure modes.`<br><br>`Extends str so that values serialize as plain JSON strings rather than enum objects, ensuring compatibility with FastAPI's OpenAPI generation.` | `Machine-readable error codes for all defined failure modes.` | 2 段落目は Python の `str` の Enum と FastAPI の説明で、API の利用者には関係がない |
| 4 | `/components/schemas/ExtractResponse/description` | `Successful extraction response returned by POST /extract.`<br><br>`extractedCharacters is the sum of len(page.content) across all pages and is provided for audit logging and metrics purposes (Req 1.1).` | `Successful extraction response returned by POST /extract.`<br><br>`extractedCharacters is the total number of characters (Unicode code points) in content across all pages and is provided for audit logging and metrics purposes.` | `len(...)` は Python の書き方。Python の `len` は文字 (コードポイント) の数を数えるので、意味を変えずに言葉で書いた。`(Req 1.1)` は対象 spec の要件の番号で、API の利用者には意味が無い |
| 5 | `/components/schemas/PageInfo/description` | `Information extracted from a single logical page or section of a document.`<br><br>`pageNumber and label are None when the source format has no positional page concept (e.g. plain text files).` | `Information extracted from a single logical page or section of a document.`<br><br>`pageNumber and label are null when the source format has no positional page concept (e.g. plain text files).` | `None` は Python の値。JSON では `null` |

- 表の文は読みやすさのために段落の中の改行を 1 行につないだ。**次の JSON を正とする** (改行の位置も含めて、文書の中の文字列そのもの)。`pointer` は直す場所、`before` は commit 済みの文書の文、`after` は直した後の文である。8.2 で文を変えた場合は、この JSON と上の表を直す。

```json
[
  {
    "pointer": "/paths/~1readyz/get/description",
    "before": "200 ``ready`` when the forkserver runs and has loaded the conversion dependencies, else 503.\n\nA not-ready cached state is re-verified (in a thread: it forks a probe child), so a pod that was\ntaken out of service gets the call that brings it back. The body never carries paths or\nexception text.",
    "after": "200 `ready` when `prlimit` can be run and a probe child process starts, else 503 `not_ready`.\n\nThe body never carries paths or exception text."
  },
  {
    "pointer": "/paths/~1extract/post/description",
    "before": "Receive a multipart upload, enforce the slot and size limits, then convert.\n\nAuthentication is handled upstream by BearerAuthMiddleware; this handler\nwill only be reached by authenticated requests.",
    "after": "Receive a multipart upload, enforce the slot and size limits, then convert it in a child process.\n\nThe Bearer token is checked before this operation runs; only authenticated requests reach it."
  },
  {
    "pointer": "/components/schemas/ErrorCode/description",
    "before": "Machine-readable error codes for all defined failure modes.\n\nExtends str so that values serialize as plain JSON strings rather than\nenum objects, ensuring compatibility with FastAPI's OpenAPI generation.",
    "after": "Machine-readable error codes for all defined failure modes."
  },
  {
    "pointer": "/components/schemas/ExtractResponse/description",
    "before": "Successful extraction response returned by POST /extract.\n\nextractedCharacters is the sum of len(page.content) across all pages and\nis provided for audit logging and metrics purposes (Req 1.1).",
    "after": "Successful extraction response returned by POST /extract.\n\nextractedCharacters is the total number of characters (Unicode code points) in content\nacross all pages and is provided for audit logging and metrics purposes."
  },
  {
    "pointer": "/components/schemas/PageInfo/description",
    "before": "Information extracted from a single logical page or section of a document.\n\npageNumber and label are None when the source format has no positional\npage concept (e.g. plain text files).",
    "after": "Information extracted from a single logical page or section of a document.\n\npageNumber and label are null when the source format has no positional\npage concept (e.g. plain text files)."
  }
]
```

- 試作は、この JSON の `before` が commit 済みの文書と 1 字も違わないことを確かめてから置き換えた (`a/apply-fixes.mjs`)。
- 直した後の文書に、`forkserver`・`fork`・`None`・`len(`・`BearerAuthMiddleware`・`FastAPI`・`Extends str`・二重の逆引用符が残っていないことを grep で確かめた (0 件)。

**直さない 14 か所**: 次の 14 か所は、Python に固有の言葉を含まないので直さない。

- `info.description`
- `/healthz` の説明
- 応答の説明 9 つ (3 つの経路の 200 の `Successful Response`、`/extract` の `Unsupported file format`・`Extraction timed out`・`File too large`・`Encrypted, malformed or over-limit document`・`Extraction process failed`・`All concurrency slots are busy`)
- `file` と `mimeType` の説明
- `ErrorResponse` の説明

`summary` (`Liveness probe` など) は `description` ではないので、Req 7.1 のとおり変えない。

**直す時期**:

- サービスの文書 (`src/http/openapi.json`) には、作るとき (6.8。tasks.md の 6.8 が `/openapi.json` を作る) から直した後の文を入れる。
- commit 済みの `packages/attachment-text-extractor-client/openapi.json` と生成クライアントは、8.2 で直す (design.md の「Python 版の残し方と、撤去の条件」)。
- それまでの間、drift のテストは説明文を除いて比べる。

### 17.7 drift 検知の作り方 (Req 7.3)

Python 版の CI は、`export_openapi.py` で書き出した文書と commit 済みの文書を `check_openapi_drift.py` で JSON として比べている。Node 版では、次のものを vitest のテストにする。Node 版の CI の `turbo run lint test` で一緒に動く。

1. **サービスの文書と commit 済みの文書の比較** (drift 検知そのもの):
   - サービスが返す文書 (`openApiDocument`) と、`../../packages/attachment-text-extractor-client/openapi.json` を、`assert.deepStrictEqual` (vitest なら `toStrictEqual`) で比べる。キーの順は無視され、配列の順は区別される。
   - **撤去 (8.2) まで**は、両方から注釈としての `description` を除いて比べる (17.3 の 2)。
   - **8.2 で**、説明文を除く処理 (約 10 行) を消して完全な比較にする。切り替えは、設定の旗で行わず、コードを消して行う。
   - 試作では、書き出しの手順 (`scripts/export-openapi.ts`) を子プロセスで実行して比べた。書き出しの手順が壊れていないことも同時に確かめられる。
2. **コードと文書の一致の検査** (文書を手で持つ方法の弱点を埋める):
   - **(i) 経路の一覧**: Hono の `app.routes` (`ALL` の、ミドルウェアの行を除く) が、文書の `paths` の「メソッド + パス」と `GET /openapi.json` に等しい。
   - **(ii) `ErrorCode` の値**: コードの `ERROR_CODES` が、文書の `components.schemas.ErrorCode.enum` と同じ順で同じ。
   - **(iii) エラー表のステータス**: 6.8 のエラー表 (`error-table.ts`) のすべての HTTP ステータスが、文書の `/extract` の `responses` にあるか 401 である。試作にはエラー表が無いので、(iv) の 418 の検査で代わりに確かめた。6.9 で表から直接確かめる形にする。
   - **(iv) 応答の形**: 実際に返した応答の本文を、文書のスキーマで `ajv` (2020-12 の方言、strict モード) にかける。
     - スキーマの中の `#/components/schemas/` を `#/$defs/` に置き換えて渡す。
     - テストの中だけで、`properties` を持つオブジェクトに `additionalProperties: false` を足した「厳しい見方」を使う。こうしないと、文書に無い項目をコードが足しても通ってしまう (文書そのものは変えない)。
     - 文書に書いていないステータスは失敗にする。ただし次の 2 つは通す (17.4 の表 3 の注)。認証の部品の 401 は `ErrorResponse` で検査する。準備ができていないときの `/readyz` の 503 は、200 と同じく `{}` (形を問わない) で検査する。トークン付きで存在しないパスへの 404 は、文書に無いパスなので、この検査の対象にならない。
     - `/readyz` のスキーマは `{}` なので、`dependencies` の実名 (D2) はどれでも通る。生成クライアントにも影響しない。
3. **CI の起動の条件**: `.github/workflows/ci-attachment-text-extractor.yml` の `paths:` に、`packages/attachment-text-extractor-client/openapi.json` を足す (6.12。tasks.md の 6.12 が Node 版の CI に OpenAPI の比較を足す)。Python 版の workflow と同じく、commit 済みの文書だけを変えた push でも drift 検知が動くようにするためである。
4. **turbo のキャッシュ**:
   - drift のテストは、package の外のファイル (クライアントの `openapi.json`) を読む。turbo はこのファイルをキャッシュの鍵に入れない。そのためローカルや、キャッシュを持ち越す CI では、クライアントの文書だけを変えたときにテストが飛ばされうる。
   - サービスの `turbo.json` の `test` に `inputs` (`$TURBO_DEFAULT$` と、クライアントの `openapi.json`) を足す。ルートの外のファイルの書き方 (`$TURBO_ROOT$/...`) が turbo 2.9 で使えるかは **未検証**で、6.9 で確かめる。
   - いまの Node 版の CI は turbo のキャッシュを持ち越していない (`actions/cache` が無い) ので、CI では起きない。
5. **生成クライアントの drift** は、今と同じく `ci-app.yml` の「Check attachment-text-extractor-client orval drift」(orval で作り直して `git diff --exit-code`) が見る。変えない。

image の中で返る文書の比較 (6.12 の「OpenAPI の比較 (説明文を除く)」) は、コンテナの `/openapi.json` を取ってきて、上の 1 と同じ比べ方で比べる。比べる処理を 1 つの関数にして、vitest のテストと、6.12 の CI の手順の両方から呼ぶ (Python 版の `check_openapi_drift.py` に当たる小さな CLI)。

### 17.8 部品とライセンス

| 部品 | 版と公開日 | ライセンス | install の時に動く処理 (`allowBuilds` への影響) | 保守の状況 | 採否 |
|---|---|---|---|---|---|
| `ajv` | 8.18.0 (2026-02-14、`pnpm-lock.yaml` に既にある)。最新は 8.20.0 (2026-04-24) | MIT | なし (`preinstall`・`install`・`postinstall` が無い)。依存の `fast-deep-equal` (MIT)、`fast-uri` (BSD-3-Clause)、`json-schema-traverse` (MIT)、`require-from-string` (MIT) にも無い | 広く使われ、更新が続いている | **採る** (開発用の依存だけ) |
| `@hono/zod-openapi` | 1.6.3 (2026-09-04) | MIT | なし | honojs/middleware の中の公式の部品 | 採らない |
| `@asteasolutions/zod-to-openapi` | 9.1.0 (2026-07-19) | MIT | なし (`prepare` はあるが、npm の登録簿から入れるときは動かない) | 更新が続いている | 採らない |
| `hono-openapi` | 1.5.0 (2026-10-18) | MIT | なし | rhinobase の部品 (1.5.0 は公開から 3 週間未満) | 採らない |
| `zod` | 4.6.7 (2026-10-12)。apps/app は 4.6.6 | MIT | なし | 更新が続いている | 採らない |
| `openapi3-ts` 4.6.2、`yaml` 2.9.1、`@hono/zod-validator` 0.9.1 ((b1) が引く) | — | MIT、ISC、MIT | なし | — | 採らない |

試作の場所の `npm install` は、`esbuild` と `@scarf/scarf` の install の時の処理について警告を出した。どちらも orval (開発の道具。リポジトリでは既にクライアントの package に入っている) が引くもので、上の候補とは関係がない。

### 17.9 再現の手順と、試作のコードの要点

試作の場所: `/tmp/claude-1000/-workspace-growi--claude-worktrees-bridge-cse-01FKZr5pM7xXdNyvSTYf1mR4/1f99ff8a-c248-52fe-bb9c-21f36680853c/scratchpad/t5/` (以下 `$S`、使い捨て)。

```sh
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
cd $S
# package.json: hono 4.13.16, @hono/node-server 2.1.6, @hono/zod-openapi 1.6.3, zod 4.6.7,
# hono-openapi 1.5.0, @hono/standard-validator 0.4.1, @asteasolutions/zod-to-openapi 9.1.0,
# ajv 8.18.0, orval 7.2.0, @biomejs/biome 2.4.12, typescript 5.9.3
npm install
cp <repo>/packages/attachment-text-extractor-client/openapi.json committed-openapi.json
# biome.json: repo の設定から vcs を切り、files.includes を ["**"] にし、overrides の plugins (apps/app 用の grit) を外す
node -e "const b=JSON.parse(require('fs').readFileSync('<repo>/biome.json','utf8'));b.vcs={enabled:false};delete b['\$schema'];b.files={includes:['**']};b.overrides=b.overrides.map(({plugins,...o})=>o);require('fs').writeFileSync('biome.json',JSON.stringify(b,null,2))"

# 較正: commit 済みの文書から作り直し、commit 済みの生成クライアントと 1 バイトも違わないこと
gen/gen.sh committed-openapi.json gen/baseline     # orval 7.2.0 + biome check --write
diff <repo>/packages/attachment-text-extractor-client/src/generated/index.ts gen/baseline/src/generated/index.ts

# (a)
node a/apply-fixes.mjs committed-openapi.json a/description-fixes.json a/src/openapi.json
node_modules/.bin/biome format --write --config-path=$S/biome.json a/src/openapi.json
node tools/doc-diff.mjs a/src/openapi.json committed-openapi.json                      # 0 difference(s)
node tools/doc-diff.mjs a/src/openapi.json committed-openapi.json --keep-description   # 5 difference(s)
COMMITTED_OPENAPI=$S/committed-openapi.json TMPDIR=$S node --test a/test/contract.test.ts   # pass 10
# 8.2 のなぞり: 書き出し → biome → それを commit 済みとして完全な比較 → orval
node a/scripts/export-openapi.ts --output sim82/openapi.json
node_modules/.bin/biome format --write --config-path=$S/biome.json sim82/openapi.json
cmp sim82/openapi.json a/src/openapi.json                                             # 同じ
OPENAPI_DRIFT=exact COMMITTED_OPENAPI=$S/sim82/openapi.json TMPDIR=$S node --test a/test/contract.test.ts
gen/gen.sh sim82/openapi.json gen/sim82
node tools/client-diff.mjs gen/baseline/src/generated/index.ts gen/sim82/src/generated/index.ts   # コメントだけ

# (b1) / (b2)
node b1/naive.mjs b1/naive.json && node tools/doc-diff.mjs b1/naive.json committed-openapi.json        # 26
node b1/matched.mjs b1/matched.json && node tools/doc-diff.mjs b1/matched.json committed-openapi.json  # 0
gen/gen.sh b1/matched.json gen/b1 && node tools/client-diff.mjs gen/baseline/src/generated/index.ts gen/b1/src/generated/index.ts
node b1/validator-conflict.mjs        # zod の本文: /extract の本文がハンドラーに 0 バイトしか届かない
node rev-probe/ref-body.mjs           # $ref の本文: 2097333 バイト届き、file が無くても 200 (検査が付かない)
(cd ref-typecheck && ln -sfn ../node_modules node_modules && ../node_modules/.bin/tsc -p tsconfig.json)   # 型の誤りなし
node b2/matched2.mjs b2/matched2.json && node tools/doc-diff.mjs b2/matched2.json committed-openapi.json # 7
```

`OPENAPI_DRIFT` は、試作で 2 つの段階を切り替えるための環境変数である。本番では使わない (17.7 の 1 のとおり、8.2 でコードを消して切り替える)。結果の記録は `$S/logs/` にある。

**比べるための道具** (この 4 つと上の `biome.json` があれば、17.4 の数字を作り直せる):

```sh
# gen/gen.sh
# usage: gen.sh <input openapi.json> <output dir>
# Regenerates the client exactly like packages/attachment-text-extractor-client (orval 7.2.0 + biome --write)
set -e
S=$(cd "$(dirname "$0")/.." && pwd)
IN=$(realpath "$1"); OUT=$2
mkdir -p "$OUT"
cat > "$OUT/orval.config.cjs" <<CFG
module.exports = {
  'attachment-text-extractor-client': {
    input: '$IN',
    output: { target: './src/generated/index.ts' },
    hooks: { afterAllFilesWrite: '$S/node_modules/.bin/biome check --write --config-path=$S/biome.json src/generated/' },
  },
};
CFG
cd "$OUT" && "$S/node_modules/.bin/orval" --config ./orval.config.cjs >/dev/null 2>&1
```

```js
// tools/doc-diff.mjs
// usage: node doc-diff.mjs A.json B.json [--keep-description]
// Lists every JSON difference between two OpenAPI documents.
// Object key order is ignored (same as Python's dict !=); array order is significant.
// Unless --keep-description, `description` is ignored where it is an annotation
// keyword, but NOT where it is a property name inside a `properties` map.
import { readFileSync } from 'node:fs';

const [a, b, flag] = process.argv.slice(2);
const keepDescription = flag === '--keep-description';

export const stripDescriptions = (node, parentKey) => {
  if (Array.isArray(node)) return node.map((v) => stripDescriptions(v, undefined));
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => parentKey === 'properties' || k !== 'description')
      .map(([k, v]) => [k, stripDescriptions(v, k)]),
  );
};

const diffs = [];
const walk = (x, y, path) => {
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) {
      diffs.push([path, x, y]);
      return;
    }
    x.forEach((v, i) => walk(v, y[i], `${path}/${i}`));
    return;
  }
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      walk(x[k], y[k], `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    }
    return;
  }
  if (x !== y) diffs.push([path, x, y]);
};

const load = (p) => {
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  return keepDescription ? doc : stripDescriptions(doc, undefined);
};
walk(load(a), load(b), '');
for (const [p, x, y] of diffs) {
  console.log(`${p || '/'}\n   A: ${JSON.stringify(x)}\n   B: ${JSON.stringify(y)}`);
}
console.log(`${diffs.length} difference(s)${keepDescription ? '' : ' (description ignored)'}`);
process.exitCode = diffs.length === 0 ? 0 : 1;
```

```js
// tools/client-diff.mjs
// usage: node client-diff.mjs A.ts B.ts
// Prints both generated clients with comments removed (TypeScript printer) and diffs them.
// A comment-only difference therefore reports 0 lines; any type/function/argument change shows up.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });
const normalize = (p) =>
  printer.printFile(ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true));

const [a, b] = process.argv.slice(2);
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'client-diff-'));
writeFileSync(join(dir, 'A.ts'), normalize(a));
writeFileSync(join(dir, 'B.ts'), normalize(b));
try {
  execFileSync('diff', ['-u', join(dir, 'A.ts'), join(dir, 'B.ts')], { stdio: 'inherit' });
  console.log('client: no difference except comments');
} catch {
  console.log('client: DIFFERENT outside comments');
  process.exitCode = 1;
}
```

```js
// a/apply-fixes.mjs
// Builds the service-owned document: the committed doc with the 7.1 description fixes applied.
import { readFileSync, writeFileSync } from 'node:fs';
const [committed, fixesPath, out] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(committed, 'utf8'));
const fixes = JSON.parse(readFileSync(fixesPath, 'utf8'));
for (const { pointer, before, after } of fixes) {
  const keys = pointer.slice(1).split('/').map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'));
  const last = keys.pop();
  const parent = keys.reduce((n, k) => n[k], doc);
  if (parent[last] !== before) throw new Error(`unexpected text at ${pointer}`);
  parent[last] = after;
}
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
```

`a/apply-fixes.mjs` に渡す `description-fixes.json` は、17.6 の JSON そのものである。

**(a) の要点** (6.8 / 6.9 の手本。import の拡張子はリポジトリの決まり (拡張子を書かない) に合わせて読み替える):

```ts
// src/http/openapi-route.ts
import type { Hono } from 'hono';

import openApiDocument from './openapi.json' with { type: 'json' };

export { openApiDocument };

export const registerOpenApiRoute = (app: Hono): void => {
  app.get('/openapi.json', (c) => c.json(openApiDocument));
};
```

```ts
// scripts/export-openapi.ts — usage: export-openapi --output <path>; then format the file with biome
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { openApiDocument } from '../src/http/openapi-route';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (values.output == null) throw new Error('--output is required');
writeFileSync(values.output, `${JSON.stringify(openApiDocument, null, 2)}\n`);
```

```ts
// drift and contract checks (excerpt of $S/a/test/contract.test.ts)
// `description` is dropped where it is an annotation, never where it names a property.
// Delete this helper and its call at 8.2 to compare exactly.
const stripDescriptions = (node: Json, parentKey?: string): Json => {
  if (Array.isArray(node)) return node.map((v) => stripDescriptions(v));
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => parentKey === 'properties' || k !== 'description')
      .map(([k, v]) => [k, stripDescriptions(v, k)]),
  );
};

// routes == documented operations + GET /openapi.json
const served = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
const documented = Object.entries(doc.paths).flatMap(([path, ops]) =>
  Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
assert.deepEqual(new Set(served), new Set([...documented, 'GET /openapi.json']));

// Test-only stricter view: undocumented response fields fail too.
const closeObjects = (node: Json): Json => {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (node === null || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, closeObjects(v)]));
  return 'properties' in node ? { ...out, additionalProperties: false } : out;
};
const toDefs = (s: Json) =>
  JSON.parse(JSON.stringify(closeObjects(s)).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv2020({ strict: true }); // import { Ajv2020 } from 'ajv/dist/2020'
// Responses the document leaves out on purpose, as the FastAPI version did.
const undocumentedSchema = (path: string, status: number): Json | undefined => {
  if (status === 401) return { $ref: '#/components/schemas/ErrorResponse' }; // auth middleware
  if (path === '/readyz' && status === 503) return {}; // not_ready; the 200 schema is {} as well
  return undefined;
};
const validatorFor = (path: string, method: string, status: number) => {
  const documented = doc.paths[path]?.[method]?.responses?.[String(status)];
  const schema = documented?.content?.['application/json']?.schema ?? undocumentedSchema(path, status);
  assert.ok(schema, `${method} ${path} ${status} is not documented`);
  return ajv.compile({ $defs: toDefs(doc.components.schemas), ...toDefs(schema) });
};
```

- `ajv` の strict モードは、OpenAPI 3.1 のスキーマに出てくる `title`・`contentMediaType`・`anyOf`・`additionalProperties` を受け付けた (8.18.0 と 8.20.0 の両方で、10 件が通り、表 3 のうち応答の形に関わる壊し方 (項目の追加、型の違い、文書に無いステータス、`/healthz` の 503) と、「401 だけ」の決まりに戻した版で失敗した)。
- JSON を `with { type: 'json' }` で import する書き方は、次の 4 つで動いた。どれも `src/` に JSON を置いた小さな試作 (`$S/a-build/`) で確かめた。
  - `tsc` 5.9.3 (`module: ESNext`、`moduleResolution: Bundler`、`resolveJsonModule`。リポジトリの `tsconfig.base.json` と同じ): `dist/` に `openapi.json` が写され、`node dist/main.js` で読めた。
  - `tsgo --noEmit`
  - リポジトリの `@swc-node/register/esm-register`
  - リポジトリの vitest 3
- 本番の起動のしかた (6.11) はまだ決まっていない。Docker の image の中で読めるかは、6.11 / 6.12 で確かめる。

### 17.10 後のタスクへの引き継ぎ

- **3.8 (部品を入れる)**:
  - OpenAPI のための本番の依存は入れない。
  - `ajv` を開発用の依存に入れる。8.18.0 (`pnpm-lock.yaml` に既にある版) と 8.20.0 の両方で試作が動いた。`^8.18.0` と書いたときに pnpm が既存の 8.18.0 を選ぶか、8.20.0 を新しく入れるかは **未検証**。lockfile の変化を小さくしたいなら、3.8 で入れた後の lockfile の差分を見て決める。
  - `zod` と OpenAPI の部品は入れない。
- **6.8 (HTTP の層)**:
  - `src/http/openapi.json` に、commit 済みの文書に 17.6 の JSON の置き換えを当て、biome で整えたものを置く (17.9 の `apply-fixes.mjs` で作れる)。
  - `http/openapi-route.ts` は 17.9 の形にする。
  - `/openapi.json` は認証なしで呼べる 3 つのパスの 1 つにする (1.6)。`/docs` と `/redoc` は作らない (D3)。
- **6.9 (組み立てと書き出し)**:
  - `scripts/export-openapi.ts` と、17.7 の 1 と 2 のテストを作る。(iii) はエラー表から直接確かめる。
  - (iv) の検査で文書に書かなくても通す応答は、認証の 401 と、準備ができていないときの `/readyz` の 503 の 2 つにする (17.9 の `undocumentedSchema`)。
  - 要求の側 (`file` と `mimeType` というフィールド名など) は 17.7 の 2 の検査では見ていない。4.4 の黒箱のテストで守る。送る要求は 17.10 の 4.4 / 4.6 の表にある。
  - package の script `export-openapi` を足す。書き出した後に biome で整える。
  - turbo の `inputs` を確かめる (17.7 の 4)。
- **6.x (変換の層とレスポンス)**:
  - `extractedCharacters` は、JavaScript の `string.length` (UTF-16 の単位の数) ではなく、**コードポイントの数** (たとえば `[...content].length` の合計) で数える。
  - Python 版の `len(str)` はコードポイントを数える。17.6 の 4 の説明文もそう書いた。`.length` で数えると、絵文字や、サロゲートペアになる漢字 (例: 𠮷) を含むページで数が増える。
  - 試作の `/extract` の代わりの応答には `こんにちは😀` を入れ、コードポイントで 6 と数えた (応答の検査は数の値までは見ない)。黒箱のテスト (4.4) に、サロゲートペアを含むページの `extractedCharacters` を入れる。
- **4.4 / 4.6 (黒箱のテスト。4.6 は Python 版に向けて流すタスクで、Req 6.3 に当たる)**:
  - 要求の側 (`file` と `mimeType` というフィールド名、`file` が必須であること、`mimeType` を省けること) は、17.7 の 2 の検査では見ていない。4.4 の黒箱のテストで、次の要求を送って守る。
  - 下の表の Python 版の応答は実測である (2026-11-05。research.md 8 節の手順で Python 版を起動し、curl で送った。ファイルの中身はどれも `hello extractor\n`)。Python 版の `formats.py` の `resolve_format` は「`mimeType` が表にあればそれ、無ければ拡張子」で形式を決め、どちらも無ければ `unsupported` を出し、`extract_errors.py` がそれを 400 `unsupported_format` にする (コードも読んで確かめた)。

    | 要求 | Python 版の応答 (実測) | 守るもの |
    |---|---|---|
    | `blob.unknown` (拡張子が表に無い) と `mimeType=text/plain` | 200。応答の `mimeType` は `text/plain` | `mimeType` という名前でヒントを読んでいること |
    | `blob.unknown`、`mimeType` なし | 400 `unsupported_format` | 上の 200 が、ヒントを読んだおかげであること (比べるための対照) |
    | `blob.unknown` と `mime_type=text/plain`、または `mimetype=text/plain` (名前を違えた) | 400 `unsupported_format` | 違う名前の項目をヒントとして読まないこと |
    | `a.txt`、`mimeType` なし | 200 (`text/plain`) | `mimeType` を省けること |
    | `file` の無い本文 | 422 `extraction_failed` (16.4 の 12〜17 番で実測済み) | `file` が必須であること |

  - `mimeType` の名前を確かめるのは、表の 1 行目と 2 行目の組である。`a.pdf` に `mimeType=application/pdf` を付けるように、拡張子とヒントが同じ形式を指す要求は、名前を取り違えても拡張子で同じ結果になるので、この確認には使わない。
  - `mimeType` が null を許すこと: 生成クライアントは `mimeType` が null のときに送らない (`src/generated/index.ts` の `!== undefined && !== null`)。サービスから見ると「`mimeType` の無い要求」になるので、表の 4 行目 (省いても拡張子で 200) で確かめる。この行は名前の取り違えは見つけない。
  - 参考 (実測): `a.txt` に `mimeType=application/pdf` を付けると 422 `extraction_failed` (ヒントが拡張子より優先される)。空の `mimeType=` は 400 `unsupported_format` (ヒントとして使われず、拡張子も表に無い)。
  - tasks.md の 4.4 (「不正な本文の 422」「エラー表のすべての行」、黒箱のテストを外のサービスにも向けられる形) と食い違わない。どれも Python 版で上の結果になるので、4.6 で Python 版に向けるときに外す目印 (付け方は 4.1 で決める) は要らない。Node 版で同じ結果になるかは、Node 版の実装 (6.x) の後で確かめる (未検証)。
  - 応答を文書のスキーマで検査する 17.7 の 2 (iv) の関数は、Python 版に向けても通ると推論している (Python 版の応答は文書に合うはずだが、測っていない)。黒箱のテストに入れるなら、外す目印は要らない。
  - 直した説明文 (17.6) の文言を確かめるテストを書く場合は、Python 版では通らないので、4.6 で外す目印 (付け方は 4.1 で決める) を付ける。
- **6.12 (Node 版の CI の image の確認)**:
  - コンテナの `/openapi.json` と commit 済みの文書を、説明文を除いて比べる (17.7 の最後の段落)。
  - `paths:` にクライアントの `openapi.json` を足す。
- **8.2 (撤去と切り替え)**: 次の 4 つを、ほかの撤去の作業と同じ 1 つの変更にする。
  1. `export-openapi` で `packages/attachment-text-extractor-client/openapi.json` を書き、biome で整える (試作では、サービスの文書と 1 バイトも違わない結果になった)。
  2. `pnpm -F @growi/attachment-text-extractor-client gen` で生成クライアントを作り直す (コメントだけが変わる。試作では 20 行)。
  3. drift のテストから説明文を除く処理を消し、完全な比較にする。
  4. Python 版の workflow の「Export OpenAPI」「Check OpenAPI drift」を workflow ごと消す。
  - 直した説明文ごとの「直す前と後」は 17.6 の表にある (Req 7.5)。8.2 で文を変えた場合は、この表を直す。
- **7.1 (実装のレビュー)**: 文書を手で持つので、文書を変える変更では、表 3 の検査が働いていることをレビューで確かめる。

### 17.11 RED (選定の前の状態と、最初に失敗した試作)

- **選定の記録が無い状態**: 作業の前に `grep -n "^## 17" research.md` の結果が 0 件 (終了コード 1) だった。
- **最初に失敗した試作**:
  - (b1) を何も合わせずに書いた文書: 説明文以外の差分が 26 件 (`title` の欠落 15 件、null を許す項目が `type: [..., "null"]` になる 3 件 × 2 (`type` と `anyOf`)、`file` の `type`・`contentMediaType`・`required`、`components.parameters` と `webhooks` の空の入れ物)。
  - そこから作り直した生成クライアント: `file: string` が `file?: unknown` になった (型・関数・引数の差分)。
  - (b1) で `/extract` を `createRoute` と zod の本文のスキーマで書いた試作: ハンドラーに本文が 0 バイトしか届かなかった。`file` の無い本文には `400` と `ZodError` を返した (17.4 の (i)。`$ref` で書けば検査は付かない)。
  - (a) のテストを「文書に書いていない応答で通すのは 401 だけ」で作った版: 準備ができていないときの `/readyz` の 503 を `not documented` で失敗にした (独立レビューの指摘。17.4 の表 3 の注で直した)。
  - (b1) を合わせた後、スキーマの順を並べる前: JSON の差分は 0 件なのに、生成クライアントの宣言の順が入れ替わった (17.4 の (ii))。
  - (b2): 1 回目 12 件、2 回目 7 件の差分が残った。
  - (a) の最初のテスト: 文書に無いステータス (418) のエラーを通してしまった (表 3 の注)。
  - (a) をいまの commit 済みの文書と完全な比較で比べた場合: 説明文の 5 件で失敗する (8.2 の前は説明文を除いて比べる理由)。
- **GREEN**: (a) で説明文以外の差分 0 件、生成クライアントの差分はコメントだけ、テスト 10 件が通り、表 3 の 7 つの壊し方でそれぞれ該当するテストが失敗した。「401 だけ」の決まりに戻すと `/readyz` の 503 の 1 件が失敗した。

### 17.12 確かめなかったこと

- Node の slim image の中で、`with { type: 'json' }` で import した JSON が読めること (6.11 / 6.12 で確かめる。`tsc` の出力と、swc-node・vitest では確かめた)。
- turbo 2.9 で、package の外のファイルをテストの `inputs` に書けるか (`$TURBO_ROOT$`) (17.7 の 4)。
- `@growi/attachment-text-extractor-client` の型を type だけ import する方法 ((c)) の試作。
- `$ref` で本文を書いた `createRoute` を、リポジトリの `tsgo` と biome で検査すること (`tsc` 5.9.3 の strict だけで確かめた)。また、その形で FastAPI の出力に合わせた文書全体を作り直すこと (`/extract` の部分だけを確かめた)。
- `hono-openapi` の残り 7 件を、後処理なしで消せる設定 (2 回の調整で消えなかった所で止めた)。
- orval 7.2.0 以外の版で作り直した場合の生成クライアント。
- 説明文の英語の文そのものの良し悪しを、英語を読む人に確かめること。

## 18. テキスト系の部品 (T6、タスク 3.5)

2026-11-05 に devcontainer (Node 24.21.0、ICU 78.3、Linux) で、使い捨ての場所 (scratchpad の `t6/`) に候補を入れて試した結果。

- 変えていないもの: 抽出サービスの package、`pnpm-lock.yaml`、本番の `src/`、`test/`、`benchmark/`、Python 版 (`.venv` は読むだけ。Python 版の関数を、サービスを起動せずに直接呼んだ)。
- 数字と結果は、とくに書いていなければ **実測**。測っていないものは「未検証」、コードや文書を読んで考えたものは「推論」と書いた。
- 「ベンチマークのテキスト系の指標」は、12・13 節の指標 (a)〜(d) のうち、テキスト系の形式 (txt・csv・html) の行と、ZIP と XML の部品が結果を左右する OOXML の形式 (xlsx・pptx) の行を指す。docx などの anydoc にそのまま渡す形式と、PDF (T1 の範囲) は、T6 の部品を通らない。

### 18.1 結論

| 分野 | 採るもの (npm の実名と版) | 一言で |
|---|---|---|
| HTML の解析 | **`htmlparser2` 12.0.0 の `Tokenizer`** (`Parser` は使わない) | タグの切り出しだけに使う。`Parser` は開いた要素の一覧を持ち、閉じない要素が多い HTML で 2 乗の時間になるので使わない (18.5.1)。読み飛ばす要素・改行・セルの空白・空白のまとめ方は、Python 版の `_TextExtractor` と `_LineJoiner` を写した自前の層で行う。`recognizeSelfClosing: true` を渡し (無いと `<script src="a.js"/>` の後ろの本文が消える)、Python 版の `HTMLParser` と違う 4 つの点 (`<x / >`、`<title>` の中の `<&`、Python が捨てる数値の文字参照、終わりのタグの引用符の中の `>`) を adapter で合わせる (18.5.1) |
| 文字コードの判定とデコード | **部品を使わない** | デコードは Node 標準の `TextDecoder` (full ICU)。判定は自前の関数 (空行を除いて 44 行)。UTF-32 も自前 (15 行)。Shift_JIS は、Python の cp932 と同じく単独の 0x80・0xA0・0xFD〜0xFF も読む自前の関数で読む。Python の codec のほうが狭い宣言 (`gb2312`・`euc-kr`・`big5`) は、Python が受け付けるバイトの範囲を先に見る (18.5.2) |
| ZIP の読み | **`yauzl` 3.4.0** | CRC-32 は yauzl が確かめないので、自前で `zlib.crc32` で確かめる |
| ZIP の書き | **`yazl` 3.3.1** | PPTX のスライドごとの package (無圧縮) と、XLSX の書き直し (圧縮方式を保って流しながら書く) の両方に使う。yauzl の読みの流れを yazl に直接つなぎ、200MiB の要素をピークの RSS +21MiB で書き直せた |
| DTD とエンティティを展開しない XML の解析 | **`@xmldom/xmldom` 0.9.12** (これより古い版は使わない。18.8) | xmldom の誤りの報告は `warning` も含めてすべて例外にする。xmldom が通してしまう壊れた XML を拒む検査 (裸の `&`、本文の `]]>`、XML で使えない字、それを指す数値の参照、名前空間の予約の誤り)、DOCTYPE の `<!ENTITY` を拒む検査、書き戻すときに DOCTYPE を消して XML 宣言を UTF-8 にする処理、バイト列から文字列への変換は自前 (18.9 に全文)。CDATA・コメント・処理命令を除く前処理は、入力の 2 乗の時間にならない 1 回の走査で行う。xmldom 自身が名前空間の宣言の深い入れ子で 2 乗の時間になるので、名前空間の宣言が 1,000 個を超える部品は `limit_exceeded` で拒む (除く前の本文で数える)。Python 版と通す / 拒むを比べると、自分で作った 93 件では 1 件、別に作った 92 件 (2 回目のレビューのレビュアーの入力) では 4 件が違い、どれも壊れた XML かまれな文字コードの宣言だった (18.5.4、18.7 の 9) |

確かめた結果:

- **ベンチマーク**: 採った部品で作った試作のスタブ (18.4 の 5) に、2.7 の道具 (`run-benchmark.ts`) を書き換えずに向けた。
  - PDF を除くすべての形式・すべての文書で、(a)〜(c) の表と文書ごとの判定が、Python 版のベースライン (`python-baseline.json`) と **1 字も違わなかった**。
  - さらに、PDF を除く 20 文書の `pages[]` を、Python 版の `convert()` の出力と文字単位で比べた。**20/20 が同じ** だった。
  - (d) Elasticsearch の段は、最初の回は devcontainer のディスクの使用率が 92% で測れなかった。6 回目のレビューの後の回 (`bench-r7.json`。ディスクの使用率 45%) では動き、PDF を含まない 24 行の検索の行と、PDF 以外の位置の問題 (`docx-ja.docx` の 1 件) がベースラインと同じだった。PDF の行と、PDF を含む「all」の行だけが違う (スタブが PDF を 500 にするため)。6 回目のレビューのレビュアーの回でも同じ結果だった。ただ、抽出した文字列が Python 版と同じなので、(d) も同じ結果になると推論する。
- **Python 版の単体テストから写した検査**: 採った部品は、HTML 33/33 (htmlparser2 の `Tokenizer` の形。4 回目のレビューの後で 4 件、5 回目のレビューの後で 6 件、6 回目のレビューの後で 2 件を足した)、文字コード 46/46 (5 回目のレビューの後で 2 件を足した)、ZIP の読み 27/27、ZIP の書き 5/5、XML 23/23 がすべて通った。
- **2.4 の文字コードのファイル** (コーパスの txt 7・csv 2・html 2): 採った自前の判定で 11/11 が、語句をすべて取れ U+FFFD が 0 だった。ほかの候補も 11/11 で、差は自分で作った 3 つの集まりで出た (18.5.2)。
- **ZIP 爆弾と XXE**: どちらも Python 版と同じ線で止まった (18.5.3、18.5.4)。XML の **エンティティ・DTD・XXE の線** は defusedxml の既定と同じにした (DTD そのものは通し、エンティティの宣言は使われていなくても拒み、外部の資源を読みに行かない)。
- **壊れた XML とまれな文字コードの扱い** は、エンティティの線とは別に Python 版 (expat) と比べた。自分で作った 93 件では 1 件、2 回目のレビューのレビュアーが別に作った 92 件では 4 件で、通す / 拒むが違った。違いは、展開した名前が同じ属性を持つ壊れた XML、WHATWG にだけある文字コードの名前 (`x-cp1252` など)、Python にだけある文字コードの名前 (`cp437`) である。どれも Req 2.3 のとおり記録だけにした (18.7 の 9)。実際の XLSX / PPTX に仕込んで Python 版の `convert()` と比べた 9 つのファイルでは、8 つが同じ結果だった。
- **悪意のある入力での時間**: XML の解析 (自前の前処理と xmldom の両方) を 30 種類の悪意のある形で、また HTML・文字コード・ZIP・XML の部品ごとに 39 種類の悪意のある形で、N・2N・4N の大きさで測った (18.5.4、18.5.8)。ZIP の書き直しだけは、yazl の中で要素の数の 2 乗の時間になる (4 万個で 3 秒。要素の数の上限で先に断る。18.5.3)。HTML を `Tokenizer` にし、名前空間の宣言を除く前の本文で数えるようにした後は、試した形ではどれも時間が入力にほぼ比例した。部品の中に、試していない形で 2 乗になる処理が残っていないかは未検証である。PPTX の分割の前処理も、スライドの数に対して Python 版より速く伸びが小さかった。
- **Python 版との出力の比べ直し** (5 回目のレビューの後。自分で作った 1,403 件と、レビュアーの 720 件。特殊なタグの自己終了の形、文字参照、宣言や処理命令、`<meta>` の書き方と宣言・中身の食い違い、壊れたバイトを中心にした): HTML は 1,380/1,403・714/720 が同じになり、6 回目のレビューの後に直した終わりのタグの読み方では、終わりのタグの集まり 2,000 件が 2,000/2,000 同じで、時間も比例した。試した集まりでは、本文が消える・語が割れる・文字参照が壊れる違いは残っていない (試していない形に残っていないかは未検証。18.12)。OOXML の構造を変えた 33 個 (欠けた要素・順序・空のシートとスライド・同じ名前の要素とシート) は 33/33 が同じだった。残る違いは 18.7 の 8 に記録した。
- **悪意のある入力でのメモリ**: xmldom の DOM は、入力の 100〜600 倍のメモリを使うことがある (閉じていない開始タグ 0.6MB で +361MiB、兄弟の要素の並び 2.7MB で +453MiB)。PPTX の分割のピークの RSS も Python 版の約 6 倍 (4,000 スライドで 370MiB 対 62MiB) である。子の RSS の上限で止まる (`memory_exceeded`) が、どこまでを受け付けるかは 3.7 で子の中で測る (18.10)。
- **ZIP の読みから書きへ流してつなぐ形**: 壊れた要素 (deflate の破損、大きさの偽り、方式 9・bzip2・LZMA) で誤りの受け手が無くプロセスが落ちる形だったので、受け手を付けて、どれも `malformed` (暗号化の flag は `encrypted`) で止まるようにした (18.5.3)。ZIP の書きの adapter も、元の流れが途中で失敗するとプロセスが落ちる形だったので直した。5 回目のレビューの後に、yazl が拒む名前 (`../x` など) の前に CRC の誤った要素がある約 300 バイトの XLSX でも落ちることが分かり、直した。直した後は、ZIP のバイト単位のファジング 8,000 件でプロセスが落ちなかった。6 回目のレビューの後に、ディレクトリの要素 (`xl/` など) を持つ正しい XLSX が 500 になることが分かり、書き直しでディレクトリの要素を飛ばすように直した (ディレクトリの要素を混ぜた 326 個で、末尾が `\` の決まりから外れた名前の 1 個と、スタブの限りの 4 個のほかは Python 版と同じ。18.5.3)。

**契約は崩さない。ユーザーの判断が要る事項もない** (6 回目のレビューの後に、ディレクトリの要素を持つ正しい XLSX が 500 になる反例が見つかり、直した。名前の末尾が `\` の要素は ZIP の名前の決まりから外れた形で、6.x で決める名前の扱いに残した。18.5.3)。ベンチマークに退行が無く (Req 2.14 に当たらない)、エンティティ・DTD・XXE の線は Python 版と同じだからである。Python 版との違い (18.7) は、Req 2.3 のとおり記録だけにする。どれも、正しい文書の抽出の結果を変えるものではなく、契約 (API・エラー・設定) を崩すものでもない (18.7 の各項目に影響を書いた)。

### 18.2 比べる元: Python 版が使っているもの

コードを読んで確かめた。defusedxml の既定は `.venv` で実測した。

| 分野 | Python 版 | 振る舞いの要点 |
|---|---|---|
| HTML | 標準の `html.parser` (`HTMLParser`、`convert_charrefs=True`) と自前の `_TextExtractor` | トークンを切り出すだけで、HTML5 の木は組まない。script / style / template / noscript / svg の中を捨てる。ブロック要素で改行し、td / th は空白でつなぐ。ASCII の空白だけをまとめる |
| 文字コード | `charset-normalizer` 3.5.2 (候補を cp932・euc_jp・iso2022_jp・cp1252 に絞る) と、Python 標準の codec | 順は BOM → 宣言 (HTML の `<meta>`、XML 宣言) → ISO-2022-JP のエスケープ → 厳密な UTF-8 → 絞った判定 → cp932 → latin-1 |
| ZIP | 標準の `zipfile` | 申告サイズの合計とエントリ数で先に断る。実際に展開したバイト数で上限を見る。CRC と長さが合わなければ `malformed` |
| OOXML の XML | `defusedxml` 0.7.1 (`xml.etree` と expat) | 既定は `forbid_dtd=False, forbid_entities=True, forbid_external=True`。名前空間の接頭辞を保って書き戻す (`register_prefixes`) |
| `.xml` のテキスト化 | 部品なし (正規表現でタグを除く) | 解析しないので、エンティティは展開しようがない。Node 版も同じ方針 (design.md の Security の節)。T6 の部品は要らない |

defusedxml の既定で、実際にどう振る舞うか (実測):

| 入力 | 結果 |
|---|---|
| `<!DOCTYPE r SYSTEM "x.dtd">`、`<!ELEMENT>` だけの DOCTYPE | 通る |
| 内部のエンティティの宣言 (使っていない宣言も)、外部のエンティティ (`SYSTEM "file:///etc/passwd"`)、パラメーターのエンティティ | `EntitiesForbidden` で拒む |
| 宣言の無いエンティティ (`&nope;`) | `ParseError` で拒む |
| `encoding="UTF-9"` | `LookupError` で拒む |
| UTF-8 のバイト列に `encoding="UTF-16"` が付いたもの | `ParseError` で拒む |
| `encoding="Shift_JIS"` | `ValueError` (multi-byte encodings are not supported) で拒む |
| BOM 付きの UTF-16 | 通る |
| `&amp;`・`&#x41;`・`&#12354;` (属性の中も) | 読める |

ipynb (`JSON.parse`) と CSV (anydoc) は部品が要らないので、T6 の範囲外とした。

### 18.3 比べた候補

版・ライセンス・依存の数・型定義・ESM は、npm の registry と、`npm install --ignore-scripts` で入れた中身 (`package.json` と LICENSE ファイル) の両方で確かめた。install のときに動く処理 (`preinstall`・`install`・`postinstall`・`binding.gyp`) は、推移的な依存も含めて **1 つも無かった** (18.8)。

| 分野 | 候補 | 版 (公開日) | ライセンス | 直接の依存 | 型 / ESM | 採否 |
|---|---|---|---|---|---|---|
| HTML | `htmlparser2` | 12.0.0 (2026-03-20) | MIT (推移的な依存 5 個は BSD-2-Clause 4 個と MIT 1 個。18.8) | 4 | 型あり / ESM だけ | **採る** |
| HTML | `parse5` | 8.1.0 | MIT | 1 | 型あり / ESM | 採らない |
| HTML | `node-html-parser` | 9.0.6 | MIT | 2 | 型あり / CJS | 採らない |
| 文字コード | 自前 (`TextDecoder` と点数づけ) | — | — | 0 | — | **採る** |
| 文字コード | `chardet` | 2.2.0 | MIT | 0 | 型あり / CJS | 採らない |
| 文字コード | `encoding-japanese` | 2.5.0 | MIT | 0 | 型あり / CJS | 採らない |
| 文字コード | `chardetng-wasm` (Firefox の chardetng の WASM 版) | 1.0.2 (2022-04) | Apache-2.0 | 0 | 型あり / WASM の ESM | 採らない |
| 文字コード | `jschardet` | 4.1.0 | 0BSD (3.x までは LGPL-2.1+) | 0 | — | 試さずに外した (18.8) |
| 文字コード | `iconv-lite` | 0.7.3 | MIT | 1 | — | 判定はできない。デコードでも要らない (18.5.2) |
| ZIP の読み | 自前 (中央ディレクトリ + `zlib.inflateRaw`) | — | — | 0 | — | 採らない (通ったが 18.6) |
| ZIP の読み | `yauzl` | 3.4.0 (2026-06-07) | MIT | 1 (`pend`) | `@types/yauzl` 3.4.0 / CJS | **採る** |
| ZIP の読み | `fflate` | 0.8.3 | MIT | 0 | 型あり / 両方 | 採らない |
| ZIP の読み | `adm-zip` | 0.6.1 | MIT | 0 | 型あり / CJS | 採らない |
| ZIP の読み | `jszip` | 3.10.2 | MIT または GPL-3.0 (選べる) | 4 | 型あり / CJS | 採らない |
| ZIP の書き | 自前 (`zlib.createDeflateRaw` + `crc32`) | — | — | 0 | — | 採らない (通ったが 18.6) |
| ZIP の書き | `yazl` | 3.3.1 (2024-11-23) | MIT | 1 (`buffer-crc32`) | `@types/yazl` 3.3.1 / CJS | **採る** |
| ZIP の書き | `fflate` (`Zip`) | 0.8.3 | MIT | 0 | 型あり | 採らない |
| XML | `@xmldom/xmldom` | 0.9.12 (2026-08-21) | MIT | 0 | 型あり / CJS | **採る** |
| XML | `saxes` | 6.0.0 (2022-05) | ISC | 1 | 型あり / CJS | 採らない (通ったが 18.6) |
| XML | `sax` | 1.6.1 | BlueOak-1.0.0 | 0 | — | 採らない |
| XML | `fast-xml-parser` | 5.12.0 | MIT | 6 | 型あり / 両方 | 採らない |

`htmlparser2`・`@xmldom/xmldom`・`yauzl` は、`pnpm-lock.yaml` にほかの package の依存として別の版 (`htmlparser2@8.0.2`、`@xmldom/xmldom@0.7.13`、`yauzl@2.10.0` / `3.1.3`) がすでにある。採る版とは違う。

### 18.4 比べ方

1. **検査を先に書いた (RED)**。Python 版の単体テストの入力と期待値を写した。
   - 4 分野の検査 (`probe/checks/{html,charset,zip,xml}.mjs`)。ZIP の書きの検査 (`zip-writer.mjs`) は後から足した。
   - 候補を 1 つも書いていない状態で動かし、全部が失敗することを確かめた (18.11)。
   - 写した元: `test_text.py` の HTML の部分、`test_charset.py` の全件、`test_archive_guard.py`、`test_ooxml_xml.py`、`test_xlsx_split.py` / `test_pptx_split.py` のエンティティ・未知の encoding・UTF-16 宣言の件。
   - 細工した ZIP は、リポジトリの `test/fixtures/crafted-zip.ts`・`crafted-docx.ts`・`crafted-pptx.ts`・`crafted-xlsx.ts`・`encrypted-office.ts` の生成器で作った。読むだけで変えていない。swc-node で一度ファイルに書き出し、そのファイルを検査が読む。
2. **候補ごとに違うのは部品の部分だけにした**。Python 版のコードを写した自前の層を、すべての候補で共通に使った。違いが部品から出ていると分かるようにするため。
   - `line-joiner.mjs`: `_LineJoiner` と、読み飛ばす要素・改行・セルの規則を写したもの。
   - `decode-pipeline.mjs`: `charset.decode` の順と `<meta>` / XML 宣言の読み取りを写したもの。判定の段だけを差し替えられる。
   - `archive-guard.mjs`: `archive_guard.py` を写したもの。候補は「エントリの一覧」と「1 つのエントリを上限つきで読む」だけを受け持つ。
   - `xml-bytes.mjs`: バイト列から文字列への変換を、expat が受け付けるものと同じ線にした関数。
3. **文字コードの正解率は 3 つの集まりで測った**。どれも Python の codec で符号化し、同じバイト列を Python 版の `decode()` にも通して比べた。
   - (i) 自分で書いた短文と長文 (184 件)。
   - (ii) GROWI の `ja_JP` / `fr_FR` の locale の文字列 (7,074 件)。
   - (iii) 調整に使わない **取り置きの集まり** (15,577 件)。自前の判定の重みは (ii) の結果を見て 1 回直したので、(iii) を作った。中身は、ほかの package の fr / de / es / it / pt / ja の locale (`@emoji-mart/data`・`yargs`・`speech-rule-engine`) と、このリポジトリの `.kiro/specs/*/requirements.md` の日本語の行。
4. **ベンチマーク**: 試作の部品で `POST /extract` を真似る小さなスタブ (`probe/bench/stub.mjs`、`split.mjs`) を作った。
   - txt・csv・html は採った文字コードと HTML の部品で処理する。
   - xlsx・pptx は `pptx_split.py` / `xlsx_split.py` を写したものを、yauzl・yazl・XML の候補と anydoc 0.2.4 で処理する。
   - docx などは anydoc にそのまま渡す。PDF は範囲外として 500 を返す。
   - スタブに `run-benchmark.ts` を `--es-url` 付きで向け (道具は書き換えていない)、`python-baseline.json` と形式ごと・文書ごとに機械で比べた。
   - そのうえで、Python 版の `convert()` の出力と `pages[]` を文字単位で比べた。
5. **大きな入力**: 20MiB の HTML (`MAX_HTML_BYTES` の既定)、20MiB の EUC-JP、200MiB の ZIP の要素で、時間とピークの RSS (`/proc/self/status` の `VmHWM`) を測った。
6. **読み込みの重さ**: 部品ごとに新しいプロセスで読み込み、`VmRSS`・`VmSize`・`VmPeak` の増え方を測った。3.6 の仮想メモリの上限の材料にする。

### 18.5 結果

#### 18.5.1 HTML

| 候補 | 検査 (33 件。6 回目のレビューの後) | Python 版と同じ出力 (32 件の追加の入力) | 20MiB の HTML の文字列の解析だけ: 時間 / ピークの RSS | 開いた要素を積む形 (下の表) |
|---|---|---|---|---|
| **htmlparser2 の `Tokenizer`** (採る形) | **33/33** | **32/32** | **約 720ms / 293〜295MiB** (読み・デコードを含む実際の流れは下の表) | 比例 |
| htmlparser2 の `Parser` | 23/33 | 32/32 | 842ms / 295MiB | **2 乗** |
| node-html-parser | 26/33 | 27/32 | 1,704ms / 1,139MiB | **2 乗** |
| parse5 | 27/33 | 31/32 | 1,270ms / 701MiB | **2 乗** (10 万段の入れ子に 44 秒) |
| (Python 版の html.parser) | — | — | 3,807ms / 138MiB (`ru_maxrss`) | — |

- 32 件の追加の入力は、表のセル・`<br>`・閉じていない `<p>`・`<pre>`・セミコロンの無い `&nbsp`・`<textarea>`・`<iframe>`・大文字のタグ・`</scr' + 'ipt>` を含む script・`--!>` で閉じるコメント・DOCTYPE と処理命令・`<math>`・属性の中の `>`・閉じていないコメントなど。Python 版の `_html_to_text` の出力と文字単位で比べた (`probe/html/inputs.json`)。
- node-html-parser が Python 版と違った 5 件: `<textarea>` と `<iframe>` の中のタグを捨てる。`<!-- c --!>`・`<!DOCTYPE html><?xml …?>`・閉じていないコメントを **本文として出す**。最後の 3 件は、タグの断片が検索の対象に混ざる形である。
- parse5 が違った点:
  - `<svg>SECRET <b>inner</b></svg>` の `inner` が本文に出た。HTML5 の木の組み立てでは、svg の中の `<b>` が svg の外に出されるため。
  - `<td>c1<td>c2` が `c1c2` になった。
  - いずれも、木を組む部品と、トークンを切り出すだけの Python 版との違いである。
- htmlparser2 の 20MiB のピークの RSS は、Python 版の 2 倍以上ある。
- 検査は 25 件にした (4 回目のレビューの後)。前の 21 件のうち「10 万段の入れ子を 10 秒未満」を「1 秒未満」に締め (10 秒では緩く、2 乗を見逃した)、開いた要素を積む 4 つの形 (下の表) で N=2 万と 8 万の時間の比が 6 倍未満、8 万で 1 秒未満、という 4 件を足した (21 + 4 = 25)。

**`Parser` か `Tokenizer` か** (4 回目のレビューの指摘。ソースと実測で確かめた):

- htmlparser2 12.0.0 の `Parser` (`dist/Parser.js`) は、開いた要素の一覧を `stack.unshift` で積み (299 行)、閉じタグごとに `indexOf` で探し (346 行)、`shift` で外す (391 行)。開いたままの要素の数に比例する手間が 1 つのタグごとにかかるので、閉じない要素の多い HTML では全体が 2 乗の時間になる。Python 版の `HTMLParser` は、開いた要素の一覧を持たない。
- `Tokenizer` は、タグ・本文・文字参照を切り出して callback に渡すだけで、一覧を持たない。`Callbacks` (`dist/Tokenizer.d.ts`) は `onopentagname`・`onselfclosingtag`・`onclosetag`・`ontext`・`ontextentity` (文字参照をコードポイントで渡す) と、属性・コメント・CDATA・宣言・処理命令の callback である。採る形は前の 5 つだけを使い、ほかは何もしない (18.9)。`<script>`・`<style>`・`<title>`・`<textarea>`・`<xmp>`・`<iframe>`・`<noembed>`・`<noframes>`・`<plaintext>` の中身は、`Tokenizer` 自身が本文として扱う (`Sequences` と `specialStartSequences`)。
- 開いた要素を積む形 (`probe/html/shapes-time.mjs`、`py-shapes.py`。N = 2.5 万 / 5 万 / 10 万):

  | 形 | `Tokenizer` (採る形) | `Parser` | Python 版 |
  |---|---|---|---|
  | 閉じない `<div>` の後に対応しない `</svg>` (最大 1.05MB) | 11 / 18 / 26ms | 1,267 / 5,391 / 19,440ms | 72 / 145 / 288ms |
  | 閉じない `<font>x` (古い HTML によくある形。最大 0.67MB) | 6 / 10 / 20ms | 198 / 254 / 637ms | 48 / 95 / 189ms |
  | 閉じた `<div>` の入れ子 (最大 1.05MB) | 11 / 19 / 38ms | 520 / 2,631 / 9,739ms | 83 / 165 / 327ms |
  | 閉じない `<span>` の入れ子 (最大 0.57MB) | 4 / 5 / 9ms | 38 / 1,360 / 596ms | 31 / 63 / 127ms |

  4 回目のレビューのレビュアーの実測では、`Parser` の形は 990KB の `stray-1m.html` で 20.9 秒 (Python 版 316ms)、HTML とデコードの流れのファジング 1,000 件強で 28 件が 1.5 秒を超え、最悪は 4.6MB で 188 秒だった。
- **出力の違い**: Python 版の `_html_to_text` と比べた。
  - 32 件の追加の入力: `Tokenizer` 32/32、`Parser` 32/32。
  - 4 回目のレビューのレビュアーのタグの崩れた HTML 602 件 (コーパスの HTML 2 件を含む。`$S/out/tagsoup-rv6.json`): **`Tokenizer` 602/602**、`Parser` 490/602。`Parser` は暗黙の閉じタグや開いた要素の扱いで Python 版と違い、本文がまるごと消える例もあった (Python 版 `"あ"` に対し `""`)。
  - 自分で作った別のタグの崩れた HTML 1,000 件 (`probe/html/gen-tagsoup.mjs`。種と断片をレビュアーのものと変え、`<textarea>`・`<title>`・`<iframe>`・`<xmp>`・`<plaintext>`・`<noembed>`、壊れたタグ `<p<`・`</p<`・`< p>`、閉じない引用符、文字参照を足した。`$S/out/tagsoup.json`): `Tokenizer` 982/1,000 (4 回目のレビューの後の形。5 回目のレビューの後の直しで 1,000/1,000。下の「自己終了の形の特殊なタグと…」)、`Parser` 839/1,000。

**自己終了の形の特殊なタグと、Python 版に合わせた 3 つの点** (5 回目のレビューの指摘。自分で再現してから直した):

- **直す前の形の誤り**: `Tokenizer` に `{ decodeEntities: true }` だけを渡していた。この設定では `recognizeSelfClosing` が false のままで、`Tokenizer` は `<script src="a.js"/>` の `/>` を無視し、`</script` が来るまでを中身を生で読む領域にした (`dist/Tokenizer.js` の `stateInSelfClosingTag`。callback の `onselfclosingtag` を呼んだ後で、その領域に入る)。`<title/>`・`<iframe …/>`・`<style/>`・`<textarea/>`・`<xmp/>`・`<noembed/>`・`<plaintext/>` も同じだった。Python 3.12.15 の `HTMLParser` は、`/>` で閉じたタグでは特殊な読み方に入らない (`html/parser.py` の `parse_starttag`。470〜481 行)。
- **再現** (`$S/r6/red-loss.txt`。直す前の形と Python 版の `_html_to_text` の出力):

  | 入力 | Python 版 | 直す前の Node 版 |
  |---|---|---|
  | `<noscript><iframe src="https://www.googletagmanager.com/…" height="0" width="0"/></noscript><p>会議の議事録</p><p>来期の計画</p>` (タグ管理の部品が埋め込む形) | `会議の議事録` / `来期の計画` | `""` (本文がまるごと消える) |
  | `<template><script src="a.js"/></template><h1>見出し</h1><p>本文</p>` | `見出し` / `本文` | `""` |
  | `<svg><style/></svg><p>本文が消える</p>` | `本文が消える` | `""` |
  | `<script src="a.js" /><p>Hello</p><script>var secret=1;</script><p>World</p>` | `Hello` / `World` | `<p>Hello</p><script>var secret=1;` / `World` (タグの断片と script のコードが本文に入る) |
  | `<p>前</p><textarea/><p>後 &amp; 続き</p>` | `前` / `後 & 続き` | `前` / `<p>後 & 続き</p>` |

  5 回目のレビューのレビュアーの 720 件 (手書き約 150 件・乱数の組み合わせ 500 件・文字コードの組み合わせ。バイト列からデコードして比べた) では、直す前の形は 498 件だけが (レビュアーの実測) Python 版と同じだった。それまでの 32 件・602 件・1,000 件には `<script/>` のような形が無かったので見つからなかった。
- **直したこと** (18.9 の `html/htmlparser2.mjs`):
  1. `recognizeSelfClosing: true` を渡す。`<script/>` などは特殊な読み方に入らない。
  2. **`/` と `>` の間に空白がある形** (`<script / >`・`<title/ >`): Python 版 (と WHATWG) では自己終了ではなく、ふつうの開始タグである。htmlparser2 は空白を飛ばして自己終了として扱う。`onselfclosingtag` に渡る `>` の位置の 1 つ前が `/` でなければ、閉じたことにせず、その 1 つのタグに限って `tokenizer.recognizeSelfClosing` を false にする。`Tokenizer` は、続く処理でこの値を見て、`>` の後と同じく中身を生で読む領域に入る (`stateInSelfClosingTag` が callback の後にこの値を読む)。次の開始タグの `onopentagname` で true に戻す。`recognizeSelfClosing` は型定義では `private readonly` だが、JavaScript では書き換えられる。htmlparser2 の版を上げたときに壊れうるので、6.x の検査にこの形を入れる (18.10)。
  3. **`<title>`・`<textarea>` の中で `<` の直後に来る文字参照** (`<title>a<&amp;b</title>`): `Tokenizer` は `<` の後で終わりのタグを探す状態になり、その間の `&` を文字参照として扱わない (`stateInSpecialTag`)。そのため `&amp;` が残った。この 2 つの要素の中の本文に `&` が残っていれば、`entities` の `decodeHTML` (htmlparser2 の依存。8.1.0、BSD-2-Clause) でもう一度直す。ほかの文字参照はすでに `ontextentity` で渡っているので、二重に直すことは無い。
  4. **Python が捨てる数値の文字参照**: Python の `html.unescape` は、`&#1;` などの制御文字と `&#xFFFF;`・`&#x10FFFF;` などの非文字を空にする (`html/__init__.py` の `_invalid_codepoints`)。htmlparser2 は残す。Python と同じ範囲 (U+0001〜U+0008、U+000B、U+000E〜U+001F、U+007F、U+FDD0〜U+FDEF、各面の U+xFFFE / U+xFFFF) を捨てるようにした。
  5. **終わりのタグの、`>` を含む引用符つきの属性** (6 回目のレビューの後に、読み方を下の「終わりのタグの読み方の直し」の形に替えた) (`</p a="><script>">本文`、`</p<<input value="<b>">`): Python 版は終わりのタグの属性も引用符を考えて読み、引用符の中の `>` を飛ばす (`locatetagend`)。htmlparser2 は名前の後を最初の `>` まで飛ばす (`stateAfterClosingTagName`)。そのため Node 版は `">` などの断片を本文に出し、引用符の中の `<script>` から後ろを script の中として読んで本文を落とした (`<p>前</p></p a="><script>">本文<p>後</p>` が Python 版 `前` / `本文` / `後`、直す前の Node 版 `前` だけ)。`onclosetag` で、Python 版の文法の正規表現 (`END_TAG_REST`。名前の後から、引用符つきの値を 1 つの塊として読む) を名前の後ろに当て、Python 版の終わりの `>` が最初の `>` より後ろなら、`Tokenizer` の位置 (`tokenizer.index`) をその手前に動かす。`Tokenizer` は続けてその `>` まで飛ばす。`index` も型定義では `private` で、2 と同じく htmlparser2 の版を上げたときに壊れうる (18.10)。正規表現は、名前の後ろから引用符の外の最初の `>` までしか読まないので、悪意のある形でも入力に比例した (18.5.8 の 3 つの形)。
- 検査は 31 件にした。5 回目のレビューのレビュアーが挙げた 2 件 (`<script src="a"/><p>x</p>` と `<noscript><iframe src="x" height="0"/></noscript><p>本文</p>`) と、上の 2〜5 の 4 件 (`<title / >`・`<&amp;`・`&#1;`・終わりのタグの引用符) を足した。期待値はどれも Python 版の出力で確かめた。採る形は 31/31。`Parser` の形は 22/31、parse5 は 26/31、node-html-parser は 25/31 (`$S/out/green-r6.txt`)。
- **出力の比べ直し** (直した後。Python 版の `_html_to_text` と、文字コードの組み合わせはバイト列から `decode` を通して比べた):

  | 集まり | 直す前 (`Tokenizer`、`decodeEntities` だけ) | 直した後 |
  |---|---|---|
  | 32 件の追加の入力 (`inputs.json`) | 32/32 | 32/32 |
  | 4 回目のレビューのレビュアーの 602 件 | 602/602 | 602/602 |
  | 自分の 1,000 件 (`tagsoup.json`) | 982/1,000 | **1,000/1,000** |
  | 5 回目のレビューのレビュアーの 720 件 (`rv7/html/mine.json`) | 499/720 (デコードの層は直した後のもの。レビュアーの数えでは 498) | **713/720** |
  | 同じレビュアーの本文が消える 6 件と、手書きの 19 件 | 0/6、9/19 | 6/6、19/19 |
  | **自分で作った 1,403 件** (`$S/r6/gen-html.py`。下の表) | 1,020/1,403 | **1,380/1,403** |

  自分で作った 1,403 件の内訳 (Python で作り、バイト列にした):

  | 中身 | 件数 | 直す前 | 直した後 |
  |---|---|---|---|
  | 特殊なタグ 13 種 (script・style・textarea・title・iframe・xmp・noembed・noframes・noscript・plaintext・template・svg・math) × 自己終了の書き方 12 種 (`/>`・` />`・`/ >`・` / >`・属性の中の `/`・引用符の無い属性値の後の `/`・大文字・改行の後の `/` など) × 2 種の前後 | 312 | 184 | **312** |
  | 特殊なタグを、svg・template・noscript・表のセル・head・title・textarea の中に入れた形 | 273 | 228 | **273** |
  | ふつうのタグの自己終了 (`<br/>`・`<p/>`・`<td/>` など 12 種) | 24 | 24 | 24 |
  | 文字参照 30 種 (`;` の欠けたもの、`&#1;`・`&#x10FFFF;`・`&#128;`・`&#xD800;`・`&#99999999;`、大文字の名前、`&amp;amp;` など) を本文・title・textarea・属性・`<` の直後に置いた形 | 120 | 89 | **120** |
  | `<![CDATA[`・`<?php ?>`・`<?xml ?>`・`<!DOCTYPE>`・`<!x>`・`<!-->`・`--!>`・`a < b`・`</ p>`・`</>`・文書の末尾の `<p` など 35 種 | 105 | 104 | 104 |
  | 上の断片の乱数の組み合わせ | 320 | 168 | **320** |
  | 文字コード (`<meta>` の書き方 9 種 × 宣言 18 種 × 実際のバイト列 4 種から選んだもの、BOM と宣言の食い違い、4096 バイトより後の `<meta>`、コメントの中の `<meta>`、末尾の壊れたバイト) | 249 | 223 | 227 |

  1,403 件の残る 23 件と、720 件の残る 7 件は 18.7 の 8 に記録した。本文がまるごと消える違いは、どの集まりでも残っていない。
- 直した後の時間は、開いた要素を積む 4 つの形と、新しく足した形 (`<title>` の中の `<&amp;` のくり返し、`<title / >` のくり返し、捨てる文字参照のくり返し) のどれも入力に比例した (18.5.8)。開いた要素を積む 4 つの形は、N = 2.5 万 / 5 万 / 10 万で 12 / 17 / 28ms、7 / 11 / 18ms、11 / 20 / 39ms、4 / 4 / 9ms (`$S/out/html-shapes-r6.txt`。下の表の `Tokenizer` の列とほぼ同じ)。20MiB の HTML (`$S/out/html20-r6.txt`。3 回ずつ): 実際の流れ (2) は 310 / 307 / 314MiB・801〜812ms、`--max-semi-space-size=4` で 203 / 215 / 204MiB、コピーしない形 (2'') は 304 / 303 / 296MiB、文字列の解析だけ (1) は 293MiB・約 778ms で、直す前 (下の表) とほぼ同じだった。

**終わりのタグの読み方の直し** (6 回目のレビューの指摘。レビュアーが試した形 `$SP/rv8fix/probe/html/htmlparser2.mjs` をそのまま取り入れた。`$SP` は scratchpad):

- **直す前の誤り** (5 回目のレビューの後に足した 5 つ目の点): 終わりのタグの名前の後ろを、1 本の正規表現 (`END_TAG_REST`) で Python 版の文法どおりに読んでいた。2 つの誤りがあった。
  1. Python 版の文法で `>` で閉じない終わりのタグ (`</a x=">"` など) では、正規表現が文書の最後まで読み、`Tokenizer` の位置は動かさない。`Tokenizer` は引用符の中の `>` から先を読み続け、次の終わりのタグで、また文書の最後まで読み直す。そのため時間が入力の 2 乗になった。
  2. 1 本の正規表現は、属性 1 つごとに戻り位置を積む。属性が約 220 万個ある 1 つの終わりのタグ (4.4MB) で `RangeError: Maximum call stack size exceeded` を投げた。本番では 500 になる見込みである。
- **再現** (`$S/r7/red-endtag.txt`。直す前の形は `$S/probe/html/htmlparser2-r6.mjs`):

  | 入力 | 直す前 | 直した後 | Python 版 (レビュアーの実測) |
  |---|---|---|---|
  | `</a x=">"` を 5 千 / 1 万 / 2 万 / 4 万個 (最大 360KB) | 363 / 1,440 / 5,593ms / 22.3 秒 (4 万個はレビュアーの実測) | 1 / 1 / 2 / 3ms | 4 万個で約 25ms |
  | 同じ形を 20 万個 (1.8MB) | (測っていない) | 15ms | — |
  | `<script>` の後ろに `</script x=">"` を 1 万 / 2 万個 | 1,587 / 6,255ms | 5 万 / 10 万 / 20 万個で 5 / 9 / 17ms | 5 万個で 74ms |
  | 属性が約 220 万個の終わりのタグ (`$SP/rv8/html/bigattr.html`、4.4MB) | `RangeError` | 62ms、出力は `本文の前` / `本文の後` | 385ms、同じ出力 |

- **直し方** (18.9 の `html/htmlparser2.mjs` の `endTagGt` と `onclosetag`):
  - 名前の後ろの区切り (`END_TAG_SEP`) と、属性 1 つ (`END_TAG_ATTR`) を、それぞれ sticky な正規表現にし、属性を 1 つずつ読む繰り返しにした (`endTagGt`)。読む文法は前の 1 本の正規表現と同じで、戻り位置が積み上がらない。
  - Python 版の文法で `>` で閉じない終わりのタグでは、`tokenizer.pause()` を呼んで残りを捨てる。Python 版も、閉じない終わりのタグから後ろを捨てる (`html/parser.py` の `goahead` は、`parse_endtag` が -1 を返し、文書の終わりなら残りを本文にしない)。
- **直した後の比べ直し** (Python 版の `_html_to_text` と):
  - 自分で作った終わりのタグの集まり (`$S/r7/gen-endtag.py`。種 7 と 8 で 1,000 件ずつ。引用符・`>`・`<`・`=`・改行・タブを混ぜた属性、属性が 60 個までの終わりのタグ、`<script>`・`<style>`・`<textarea>`・`<title>`・`<svg>`・`<p>`・`<td>` の中、`>` で閉じない終わりのタグ、それらの並び): **2,000/2,000**。直す前の形は 1,906/2,000 だった。
  - 時間の形 4 種 (レビュアーの `perf2.mjs` の形) と 4.4MB の入力の 13 件: 13/13。
  - 前の集まりは変わらないか、よくなった: 32/32、602/602、1,000/1,000、1,380/1,403、6/6、19/19、終わりのタグの引用符の 3 件 3/3。レビュアーの 720 件は 713 → 714/720 になった (文書の末尾の `</p<` の 1 件が、閉じない終わりのタグとして Python 版と同じく捨てられるようになった)。
  - 検査に 2 件を足した: 「`</a x=">"` を 4 万個並べても 1 秒未満」と「属性が 200 万個の終わりのタグで例外を出さない」。期待値は Python 版の出力 (`a`、`before` / `after`) で確かめた。
  - 18.5.8 に、この 2 つの形 (`</a x=">"` の並び、属性の多い終わりのタグ) を足した。N・2N・4N で比例した。
  - 開いた要素を積む 4 つの形 (`$S/out/html-shapes-r7.txt`) と 20MiB の HTML (`$S/out/html20-r7.txt`) も測り直し、直す前と同じだった (実際の流れは 313 / 314 / 306MiB・801〜819ms、`--max-semi-space-size=4` で 203 / 213 / 215MiB)。

**20MiB の HTML のピークの RSS (htmlparser2 の `Tokenizer`。4 回目のレビューの後に測り直した値)**:

ふつうの Node のプロセスで、それぞれ 3 回ずつ測った (`VmHWM`。開始時は約 58MiB。子プロセスと `prlimit` の下では測っていない)。入力は、`<meta charset="utf-8">`・script・style と、日本語の表の行をくり返した 20.0MiB の HTML。

| 形 | 中身 | V8 のオプション無し | `--max-semi-space-size=4` |
|---|---|---|---|
| (1) 文字列の解析だけ (`probe/bench/html-big.mjs`) | 組み立てた文字列を `htmlToText` に渡す | 293 / 295 / 293MiB (約 720ms) | 205 / 206 / 206MiB |
| (2) **実際の流れ** (`probe/bench/html-file.mjs`) | ファイルのバイト列を読み、`<meta>` を見てデコードし、解析する | **315 / 306 / 306MiB** (約 740ms) | **214 / 215 / 214MiB** |
| (2'') 同じ流れで、読み込んだバイト列をコピーしない形 (`probe/bench/html-file-nocopy.mjs`) | 同上 | 296 / 305 / 296MiB | 219 / 219 / 218MiB |
| (3) 64KiB ずつデコードして流し込む (`probe/bench/html-big-chunked.mjs`。先に `gc()` を呼ぶ。`Parser` の形で測った) | 文書全体の文字列を作らない | 268 / 282 / 284MiB | 178 / 180 / 181MiB |

- `MAX_CHILD_RSS_MB` 320 の 0.95 倍は 304MiB である (11.2 の余裕の基準)。**実際の流れ (2) は、V8 のオプションが無いと、この境に当たるか超える** (296〜315MiB)。`Tokenizer` にしても、`Parser` の形 (308〜316MiB) とほぼ同じだった。時間は少し短くなった (約 850ms → 約 740ms)。
- (2) と (2'') の差は、読み込んだバイト列を `new Uint8Array(readFileSync(…))` で 1 回多くコピーするかどうかの違いである (実測)。ただし `--max-semi-space-size=4` では、コピーを除いた形のほうが少し高かった。V8 の新しい世代の大きさと、コピーで早く起きる回収の兼ね合いと推論するが、確かめていない。1 回目のレビューのレビュアーの `rev/htmlfile.mjs` (コピーしない形) は、`Parser` の形で 296〜297MiB だった。
- どの形でも、オプション無しのピークは 296〜315MiB で、0.95 倍の境の前後にある。
- 子の中では、ここに anydoc などの読み込みの分が加わる (未検証)。3.7 で、HTML の最大の入力を基準のファイルに加えて、子の中で測る必要がある (18.10)。

#### 18.5.2 文字コード

**検査 (`test_charset.py` の全件などから 44 件。5 回目のレビューの後に 2 件を足して 46 件)**: 自前 46/46、chardetng-wasm 43/46、encoding-japanese 41/46、chardet 27/46。足した 2 件は、1 バイトの壊れた Shift_JIS と、`gb2312` の宣言の付いた Shift_JIS (下の見直し)。候補の部品の数は、共通の層 (`decode-pipeline.mjs`) を直した後の値である。

- chardet は、短い Shift_JIS (`日本語のテスト`、`①②③ ㈱テスト 髙橋`) と短い EUC-JP を取り違えた。
- encoding-japanese は、cp1252 を判定できない (候補に無い) うえに、長い EUC-JP を取り違えた。
- chardetng-wasm と encoding-japanese は、8 バイトの EUC-JP (`会議資料`) を取り違えた。

**2.4 の文字コードのファイル** (ベンチマークのコーパスの txt・csv・html の 11 ファイル。共通のデコードの順に候補の判定を差し込み、HTML は `<meta>` の宣言も渡した。各欄は「正解の語句のうち取れた数、U+FFFD の数」。Python 版は 13 節のベースラインの値):

| ファイル | 文字コード | Python 版 | 自前 | chardet | encoding-japanese | chardetng-wasm |
|---|---|---|---|---|---|---|
| `txt-shift-jis.txt` | shift_jis | 7/7、0 | 7/7、0 | 7/7、0 | 7/7、0 | 7/7、0 |
| `txt-euc-jp.txt` | euc-jp | 7/7、0 | 7/7、0 | 7/7、0 | 7/7、0 | 7/7、0 |
| `txt-iso-2022-jp.txt` | iso-2022-jp | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 |
| `txt-utf-8-bom.txt` | utf-8-bom | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 |
| `txt-utf-16le-bom.txt` | utf-16le-bom | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 |
| `txt-utf-16be-bom.txt` | utf-16be-bom | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 |
| `txt-utf-8.txt` | utf-8 | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 |
| `csv-utf-8.csv` | utf-8 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 |
| `csv-cp932.csv` | cp932 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 | 6/6、0 |
| `html-shift-jis-script-style.html` | shift_jis | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 | 5/5、0 |
| `html-euc-jp-http-equiv.html` | euc-jp | 4/4、0 | 4/4、0 | 4/4、0 | 4/4、0 | 4/4、0 |
| すべて取れたファイル | | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 |

コーパスの文書は、どの候補でも差が出ないくらい判定しやすい (文が長く、日本語の割合が高い)。そのため、候補の差は次の 3 つの集まりで測った。

**正解率** (Python の codec で符号化した元の文字列に戻った割合。表の「Python 版」は Python 版の `decode()`):

| 集まり | Python 版 | 自前 | chardet | encoding-japanese | chardetng-wasm |
|---|---|---|---|---|---|
| (i) 自分で書いた文 | 182/184 (98.9%) | **184/184 (100%)** | 153/184 | 154/184 | 171/184 |
| (ii) GROWI の locale | 7,023/7,074 (99.3%) | **7,069/7,074 (99.9%)** | 6,097 (86.2%) | 5,209 (73.6%) | 6,902 (97.6%) |
| (iii) 取り置き | 15,054/15,577 (96.6%) | **15,481/15,577 (99.4%)** | 15,005 (96.3%) | 11,602 (74.5%) | 15,193 (97.5%) |

(iii) の文字コードごとの内訳:

| 文字コード | 件数 | Python 版 | 自前 | chardet | encoding-japanese | chardetng-wasm |
|---|---|---|---|---|---|---|
| cp1252 | 3,859 | 3,732 | **3,856** | 3,768 | 1,006 | 3,628 |
| cp932 | 3,908 | 3,862 | **3,876** | 3,807 | 3,876 | 3,864 |
| euc_jp | 3,905 | 3,555 | **3,873** | 3,556 | 2,846 | 3,827 |
| iso2022_jp | 3,905 | **3,905** | 3,874 | 3,874 | 3,874 | 3,874 |

- Node のどの候補でも残った 31〜34 件の取りこぼしは、判定の誤りではない。**デコードの対応表の違い** (`〜`→`～`、`−`→`－`) である (18.7)。ISO-2022-JP は判定を通らないので、Node の 4 つが同じ数になる。
- 自前の判定の 1 回目は、(ii) の fr_FR の cp1252 で 397/1,092 だった。原因は、`é` (0xE9) と次の英字が Shift_JIS の 1 文字の漢字として読めてしまうこと (`autorisées` → `autoris馥s`)。「漢字・かなが ASCII の小文字に隣り合っていたら減点」を足して直した。直した後の数字は、調整に使っていない (iii) で確かめた。
- 自前の判定の 1 回目は、`[...text]` で配列を作っていた。そのため、20MiB の入力でピークの RSS が 819MiB になった。先頭の 64KiB だけで判定し (`stream: true` で、切れ目の字を誤りにしない)、文字列を添字で走査する形に直した。直した後は、判定 6ms、デコード全体 66ms、ピークの RSS 121MiB。chardet は 20MiB で 4,051ms、125MiB。

**重さ** (新しいプロセスで測った。1MiB の EUC-JP を判定した時間):

| 候補 | 判定の時間 | `VmSize` の増分 |
|---|---|---|
| 自前 | 86ms (全体を見たとき。64KiB の標本なら 6ms) | — |
| chardet | 232ms | +2MiB |
| encoding-japanese | 2ms | +3MiB |
| chardetng-wasm | 122ms | **+8,194MiB** (1,375MiB → 9,569MiB) |

- **chardetng-wasm は、読み込んだだけで仮想メモリを約 8GiB 予約する**。WASM のメモリの確保の仕方による。`RLIMIT_AS` の上限 (Req 11.5) と両立しない。
- また、Node 24 で読み込むと `ExperimentalWarning` (WASM を ES モジュールとして import する機能が実験的) が出る。

**`iconv-lite` 0.7.3**:

- `encodingExists('iso-2022-jp')` は false。`decode(…, 'iso-2022-jp')` は `Encoding not recognized` で失敗した。**ISO-2022-JP は読みもできない**。
- UTF-32 は読める。ただ、BOM の付いた UTF-32 だけのために足す価値は無い。UTF-32 は自前の 15 行で読める。
- iconv-lite はすでにテスト用の依存 (devDependency) にあるが、本番には入れない。

**`TextDecoder` (Node 24.21.0)**: `process.config.variables.icu_small` が false の full ICU だった。shift_jis・euc-jp・iso-2022-jp・utf-16le / be・windows-1252・koi8-r・gb18030・big5 のデコーダーがある。utf-32 は無い (`ERR_ENCODING_NOT_SUPPORTED`)。WHATWG の Encoding Standard に UTF-32 が無いため。

**1 バイトだけ壊れたファイル** (長い日本語の途中に 1 バイトを入れた。実測):

| ファイル | Python 版 | Node 版 (どの候補も) |
|---|---|---|
| Shift_JIS に 0xFF | 読める (Python の cp932 は 0xFF を私用領域の U+F8F3 にする) | 直す前は化けた (WHATWG の shift_jis が 0xFF を誤りにし、判定が windows-1252 を選んだ)。**5 回目のレビューの後に直し、Python 版と同じ出力になった** (下の見直し) |
| EUC-JP に 0x80 | 化ける | 読める (WHATWG の euc-jp が 0x80 を通す) |
| UTF-8 に 0xFF、最後の字を切った Shift_JIS | 化ける | 化ける |

どちらの版も、壊れたバイトに強いわけではない。違いは 18.7 に記録した。

**宣言と中身の食い違い、壊れたバイトを、自分で作った入力で見直した** (5 回目のレビューの後。上の 1,403 件のうち文字コードの 249 件と、`$S/out/corrupt.json`):

- **Shift_JIS の文書に、WHATWG の shift_jis が拒むバイトがある** (`<meta charset="shift_jis">` の Shift_JIS の本文の末尾に `0xFF 0xFE 0x80`、または途中に 0xFF): 直す前の Node 版は、文書全体が化けた。宣言の shift_jis が厳密に読めず、判定では厳密に読めるのが windows-1252 だけだったので、windows-1252 が選ばれた。Python 版は、charset-normalizer が何も選ばず、最後の cp932 で読む。Python の cp932 は、単独の 0x80・0xA0・0xFD〜0xFF を 1 字 (U+0080・U+F8F0〜U+F8F3) として読むからである (18.7 の 1 の表の「Python だけ読める 5 バイト」)。
  - 直し方 (18.9 の `decode-pipeline.mjs` の `cp932` と `own.mjs`): この 5 バイトを Python と同じ字にし、残りを WHATWG の shift_jis で厳密に読む関数を作った。壊れたバイトが多いときのメモリを抑えるため、1 つの `TextDecoder` を使い回し、区切った部分を 4,096 個ずつまとめてつなぐ (最初の形は 21MB で +577MiB。直した後は +116MiB・1.0 秒。18.10 の表)。判定の Shift_JIS の候補と、最後の段 (Python の cp932 の段) の両方で、この関数を使う。判定では、本文の大部分が読める Shift_JIS の点数が windows-1252 を上回り、Shift_JIS が選ばれる。
  - 正解率の 3 つの集まりは変わらなかった (184/184、7,069/7,074、15,481/15,577)。文字コードの検査 44 件も変わらない。
  - 試した別の直し方: 「windows-1252 の点数が負なら選ばない」は、`größer` (`ö` と `ß` が並ぶ) や `N°`・`« »` のような正しい cp1252 の文を落とし、(iii) が 15,481 → 15,429 になったので採らなかった。
- **宣言された文字コードが、Python の codec では狭く、WHATWG では広い**: `<meta charset="gb2312">` に Shift_JIS のバイト列。Python の gb2312 は厳密な GB2312 (EUC-CN) で、Shift_JIS の先頭のバイト (0x81〜0x9F) を拒み、判定に進んで正しく読む。WHATWG は `gb2312` を GBK として扱い、拒まずに読むので化けた (`擔杮岅偺…`)。`euc-kr` (WHATWG では windows-949)、`big5` (WHATWG では Big5-HKSCS を含む) も同じ関係にある。
  - 直し方: Python の codec が gb2312・euc_kr・big5 になる宣言の名前 (`gb2312`・`chinese`・`csiso58gb231280`・`iso-ir-58`、`euc-kr`・`korean`・`ks_c_5601-1987`・`ksc5601`、`big5`・`csbig5`。Python の `codecs.lookup` で確かめた) では、Python の codec が受け付ける先頭・後ろのバイトの範囲を先に見て、外れていれば宣言を使わない。範囲で見るだけなので、範囲の中の定義の無い符号までは合わせていない (推論。試していない)。
  - コメントの中の `<meta charset="gb2312">` も、Python 版と同じく宣言として読む (Python 版も先頭 4096 バイトをバイト列の正規表現で探す)。直した後は、どちらも判定に進み同じ結果になった。
- **見直した後の 1 バイトだけ壊れたファイル**: Shift_JIS に 0xFF は、Python 版と同じく読めるようになった (出力が 1 字も違わない)。EUC-JP に 0x80 は、Node 版だけが読める (WHATWG の euc-jp が 0x80 を通す)。UTF-8 に 0xFF と、最後の字を切った Shift_JIS は、どちらの版も同じに化ける。
- 文字コードの 249 件で残った違い (227/249 が同じ。どれも 18.7 に記録した):
  - `iso-8859-1`・`latin1` の宣言に日本語のバイト列 (16 件): Python 版は宣言どおり latin-1 で読んで化ける。Node 版は WHATWG のとおり windows-1252 として厳密に読み、未定義の 5 バイトがあれば失敗して判定に進むので、正しく読めることがある。未定義のバイトが無ければ、Node 版も化ける (18.7 の 2)。
  - `big5` の宣言に EUC-JP のバイト列 (5 件): どちらの版も化ける。先頭の 1 字の読み方だけが違う (Python 版 `ゥ呿賄…`、Node 版 `呿賄…`)。
  - EUC-JP の末尾に `0xFF 0xFE 0x80` (1 件): どちらの版も latin-1 / windows-1252 に落ちて化ける。最後の 1 字 (0x80) だけが違う。

#### 18.5.3 ZIP

**読み (`test_archive_guard.py` などから 27 件)**: 自前 27/27、**yauzl 27/27**、fflate 25/27、adm-zip 25/27、jszip 18/27。

主な検査:

- 必要な要素が無い・ZIP でない・途中で切れた・中央ディレクトリが無い・空・暗号化した OOXML (CFB) は、そのまま anydoc に渡す (`null`)。
- エントリの数と申告サイズの合計の上限は、必要な要素を探す前に見る。
- 520MiB の DOCX の爆弾 (zip64) は、申告サイズで `limit_exceeded` にする。
- 同じ名前の要素は、両方見えて、そのまま渡す。
- `../`・`/abs` の名前でも開ける。zip64 の要素を読める。
- 上限ちょうどは読め、1 バイト超えると `limit_exceeded` にする。
- 申告サイズを偽ったもの (5,000 バイトを 10 と申告) は、黙って切り詰めず `malformed` にする。
- 壊れた deflate・方式 9・bzip2・LZMA は `malformed`、暗号化の flag は `encrypted`。
- version-needed が 10.0 のもの、UTF-8 の flag があるのに名前が UTF-8 でないものは、Python の zipfile が開けないので、そのまま渡す (自前の層で再現した。18.10 の 6.x)。

200MiB の zip64 の爆弾を、1MiB の上限で読んだ結果:

| 候補 | 結果 | RSS の増分 | 時間 |
|---|---|---|---|
| 自前 | `limit_exceeded` | +0.5MiB | 4ms |
| **yauzl** | `limit_exceeded` | +0.0MiB | 2ms |
| adm-zip | `limit_exceeded` | **+328MiB** (全部を展開してから大きさを見る) | 508ms |
| jszip | `limit_exceeded` | 測れなかった (前の検査の解放と重なった) | 714ms |

- fflate が落ちた 2 件: `unzipSync` の `filter` に渡る zip64 の要素の大きさが `4294967295` (0xFFFFFFFF) のままで、zip64 の拡張の欄を読んでいない。また、flag も要素の位置も渡さない。読むには、自前の中央ディレクトリの読み取りが結局要る。`unzipSync` そのものは 200MiB の爆弾を上限なしで全部展開した (306ms、RSS 256MiB)。
- adm-zip が落ちた 2 件: 同じ名前の要素があると、`Duplicate entry name` で ZIP 全体を開けない。流しながら読む口が無い。
- jszip が落ちた 9 件: 壊れた deflate・方式 9・bzip2・LZMA・暗号化の flag の ZIP を、読み込みの時点で丸ごと拒む。そのため `malformed` と `encrypted` の区別も、そのまま渡すことも作れない。申告サイズの偽りを見つけない。同じ名前の要素を 1 つにまとめる。version と flag の欄を出さない。
- yauzl について (README とコードを読んだ結果と実測):
  - CRC-32 を確かめない (README の "No CRC-32 Checking")。adapter で `zlib.crc32` を使って確かめた。
  - 既定の `decodeStrings: true` では、`../` や絶対パスの名前を誤りにして、ZIP 全体を開けない。`decodeStrings: false` にして、名前は自前でデコードした。
  - 申告サイズの偽りは、yauzl 自身の `validateEntrySizes` でも捕まった。

**書き (5 件)**: 自前・**yazl**・fflate のどれも 5/5。

- XLSX と PPTX のコーパスを読んで書き直すと、anydoc の出力が元と同じだった。圧縮方式 (無圧縮か deflate か) も元と同じに保たれた。
- Python の zipfile の `testzip()` が `None` (壊れていない) を返した。日本語の名前には UTF-8 の flag が付いた。
- 200MiB の要素を 1MiB ずつ流して書いたときの RSS の増分と時間: 自前 +0.3MiB / 365ms、yazl +0.3MiB / 396ms、fflate +0.0MiB / 1,706ms。

**読みから書きへ流してつなぐ経路** (XLSX の書き直しの形。`probe/bench/pipe-repackage.mjs`):

- yauzl の `openReadStream` を、バイト数の予算を数え CRC-32 を積み上げる `Transform` を通して、yazl の `addReadStreamLazy` に直接つないだ。要素を丸ごとメモリに持たない形である。
- `bomb64.bin` の 200MiB の要素 (中身は 0):
  - 予算 512MiB: 書き直せた (出力 204,005 バイト、804ms、ピークの RSS 52MiB → 73MiB)。
  - 予算 100MiB: `limit_exceeded` で止まった (424ms、ピークの RSS 52MiB → 74MiB)。
- **最初の版は、予算を超えたときに止まらなかった**。`Transform` の誤りが yazl の `outputStream` に伝わらず、出力が終わらないまま待ち続けた (Node の終了コード 13 = 最上位の `await` が終わらなかった)。誤りのときに読みの流れと `outputStream` の両方を `destroy` するようにして直した。6.x の実装で必ず入れること (18.10)。
- ベンチマークのスタブは、簡単のため各要素を一度メモリに読んでから書いた。結果 (コーパスでの一致) は流してつないでも変わらないと推論する。

**壊れた要素での止まり方** (`pipe-repackage.mjs` を関数 `repackage` にした 3 回目のレビューの後の形。5 回目のレビューの後の直しは下の続き。予算 512MiB。3 回目のレビューのレビュアーの `scratchpad/rv5/pipe/*` と、細工した ZIP):

| 入力 | 前の形 (レビュアーの `pipe-any.mjs` と同じ作り) | 3 回目のレビューの後の形 |
|---|---|---|
| `bad-rels.xlsx` (`.rels` の要素の deflate を壊した XLSX。Python 版は 422 `malformed`) | **プロセスが落ちた** (終了コード 1、`invalid block type`) | `malformed` |
| `size-lie.zip` (中央ディレクトリが展開後の大きさを小さく偽る) | **落ちた** (`too many bytes in the stream`) | `malformed` |
| `method9` (方式 9) | **落ちた** (`unsupported compression method`) | `malformed` |
| `bad-deflate.zip` | `malformed` | `malformed` |
| `bad-btype.zip`、`corruptDeflate`、`bzip2`、`lzma`、`lying`、`truncated` | (試していない) | `malformed` |
| `encFlag` (暗号化の flag) | (試していない) | `encrypted` |
| `good.zip`、`storedXlsx` | — | 書き直せた |
| `bomb64.bin` の 200MiB の要素 | 予算 512MiB で書き直し、100MiB で `limit_exceeded` | 同じ (837ms・419ms、ピークの RSS 50MiB → 73MiB) |

- 落ちた原因は 2 つ: (a) `openReadStream` の誤り (方式 9 など) は、yazl の `ZipFile` が `'error'` として出す。しかもそれは最初の `addReadStreamLazy` の呼び出しの中で同期的に起きるので、受け手はその前に付ける必要がある。(b) `rs.pipe(guard)` の `pipe` は、読みの流れの誤り (deflate の破損、yauzl の大きさの検査) を `guard` に伝えない。最終の形は、(a) の受け手を最初の `addReadStreamLazy` の前に付け、(b) 読みの流れの誤りを `guard.destroy` に渡し、暗号化の flag を開く前に見る (18.9 に全文)。
- ZIP の書きの adapter (`zipw/yazl.mjs`) も、元の流れが途中で失敗すると `'error'` の受け手が無くプロセスが落ちた (終了コード 1。`probe/lin/writer-error.mjs`)。同じく受け手を付け、失敗は `writeZip` の拒否 (reject) として返すように直した。直した後も、書きの検査 5 件は通った。
- **4 回目のレビューの後の形にも、プロセスが落ちる道が残っていた** (5 回目のレビューの指摘。自分で再現してから直した):
  - `repackage` は要素を 1 つずつ `addReadStreamLazy` に渡す。yazl は、渡された時点で前の要素の読み取りを始める。途中の要素の名前が `../x`・`/abs`・`C:/x` だと、yazl が `addReadStreamLazy` の中から同期的に例外を投げ、`repackage` は `out.end()` と `outputStream` の読み取りに進む前に抜けていた。
  - すでに読み始めていた前の要素が、その後で CRC の誤りなどを出すと、`fail` が `outputStream.destroy(err)` を呼ぶ。`outputStream` を読む側がまだいないので `'error'` の受け手が無く、プロセスが終了コード 1 で落ちた。
  - 再現 (`$S/r6/red-zip.txt`): CRC の誤った要素の後ろに `../evil.txt` を置いた約 300 バイトの ZIP (`badcrc-then-dotdot.zip`)、`[Content_Types].xml` の CRC を誤らせ `C:/x.txt` を置いた ZIP (`badcrc-then-drive.zip`)。どちらも 3 回とも `Error: CRC mismatch` の `Unhandled 'error' event` で落ちた。CRC が正しい要素の後ろの `../evil.txt` (`good-then-dotdot.zip`) は落ちなかった。Python 版なら 422 `malformed` を返す入力で、本番では子プロセスが落ちて `crashed` (500) になる。
  - バイト単位のファジング (5 回目のレビューのレビュアーの `fuzz-zip-fix.mjs` の写し。下の 18.5.8 にコード): 直す前の形では、種 2000〜2999 の束が終了コード 1 で止まった (種 2586。`xl/` の 1 バイトが壊れて名前が `x:/worksheets/sheet2.xml` になった XLSX。`$S/r6/zf/red-2000.txt`)。
- **直し方** (18.9 の `pipe-repackage.mjs`): 要素を足す繰り返しを `try { … } catch` で囲み、例外が出ても `outputStream` を壊し、`out.end()` と `for await` で最後まで読む。読む側がいるので、後から出る前の要素の誤りにも受け手がある。
  - **名前の誤りには `kind` を付けない**。yazl の `Error` (`invalid relative path: ../evil.txt`・`absolute path: C:/x.txt`) のまま拒否として返す。`malformed` などに分類すると、18.10 で 6.x に残した (a)/(b)/(c) のうち 1 つを黙って選ぶことになるからである。
  - ZIP の書きの adapter (`zipw/yazl.mjs` の `writeZip`) も同じ形の繰り返しなので、同じ `try` / `catch` の形にそろえた。こちらは元のデータがメモリにあり、後から誤りが出ないので落ちはしなかったが、例外で抜けたときに `outputStream` が読まれずに残っていた。直した後は、`../evil.xml`・`/abs.xml`・`C:/x.xml` のどれも `kind` の無い拒否として返った。
- **直した後** (`$S/r6/green-zip.txt`、`$S/out/fuzz-zip-0.txt`、`$S/out/fuzz-zip-10000.txt`):
  - 再現の 3 つは、どれも 3 回とも拒否として返り、終了コード 0 だった (`badcrc-then-dotdot`・`good-then-dotdot` は `invalid relative path: ../evil.txt`、`badcrc-then-drive` は `absolute path: C:/x.txt`)。
  - 前の表の入力は同じ結果だった: `bad-rels.xlsx` は `malformed`、`corruptDeflate`・`bzip2` は `malformed`、`encFlag` は `encrypted`、`bomb64.bin` の 200MiB の要素は予算 512MiB で書き直せ (874ms、ピークの RSS 51MiB → 74MiB)、予算 100MiB で `limit_exceeded`。
  - バイト単位のファジング: 種 0〜3,999 と、種を変えた 10,000〜13,999 の 8,000 件 (1,000 件ずつ 8 つのプロセス) で、**8 つの束のすべてが終了コード 0** で終わった。1 件の最長は 25ms。分割 (`split`) の結果は `ok` 2,536・`malformed` 5,391・`limit_exceeded` 71・`encrypted` 2、書き直し (`pipe`) は `ok` 178・`malformed` 7,820・`encrypted` 1・`kind` の無い名前の誤り 1 (種 2586) だった。
- **書き直しの時間は、要素の数に対して比例より速く伸びる** (`$S/out/repack-entries.jsonl`。要素が空でない小さな XML の ZIP。新しいプロセスで 2 回ずつ):

  | 要素の数 | 5,000 | 10,000 | 20,000 | 40,000 |
  |---|---|---|---|---|
  | 時間 | 219 / 211ms | 418 / 428ms | 980 / 975ms | 2,886 / 3,003ms |
  | 増えたピークの RSS | 67 / 65MiB | 138 / 141MiB | 182 / 183MiB | 212 / 246MiB |

  - 倍ごとの時間の伸びは 1.9〜2.0 → 2.3 → 2.9〜3.1 倍である。CPU のプロファイル (`--cpu-prof`、4 万個) では、時間の 2,281ms が yazl の `pumpEntries` (`index.js` の 205 行) だった。`pumpEntries` は、1 つの要素を書き進めるたびに、まだ終わっていない最初の要素を一覧の先頭から探す (`getFirstNotDoneEntry`)。そのため要素の数の 2 乗の手間になる (コードを読んだ結果と、プロファイルの実測)。
  - 4 回目のレビューの後に「比例している」と書いたのは誤りだった (25,000 個から 100,000 個で 4.6 倍)。
  - 本番では、要素の数を `MAX_ARCHIVE_ENTRIES` (既定 10,000) で、書き直しの前に断る (archive_guard の写し)。既定の上限では 418〜428ms・+138〜141MiB に収まる。上限を大きくすると 2 乗で伸びる (18.10)。

- **ディレクトリの要素 (名前の末尾が `/`) で、正しい XLSX が 500 になっていた** (6 回目のレビューの指摘。自分で再現してから直した):
  - yazl は、名前の末尾が `/` の要素を `file path cannot end with '/'` で拒む。Office の外の道具で作り直した XLSX には、`xl/`・`xl/worksheets/` のようなディレクトリの要素が入ることがある (レビュアーの例: 展開して `zip -r` で作り直しただけの `$SP/rv8/dir/ziprx.xlsx`)。
  - 再現 (`$S/r7/red-dir.txt`): `ziprx.xlsx` と `withdirs.xlsx` は、分割の写し (`writeZip` を通る) と `repackage` の両方で、`kind` の無い誤り (本番では 500 の見込み) になった。`withdirs.pptx` は、分割は通ったが `repackage` が同じ誤りになった。Python 版はどれも 3 シート・3 スライドを返す (200)。
  - レビュアーが試した直し方は、ディレクトリの要素を yazl の `addEmptyDirectory` で書く形だった (`$SP/rv8fix/probe/zipw/yazl.mjs`、`pipe-repackage.mjs`)。**この形を取り入れて大量のディレクトリの要素を試すと、5,000 個でプロセスが落ちた** (`RangeError: Maximum call stack size exceeded`、終了コード 1。3,000 個は通った。要素の数の上限 `MAX_ARCHIVE_ENTRIES` (既定 1 万) の内側である。Python 版は 9,000 個でも 3 シートを返した)。yazl は、中身の無い要素 (`addEmptyDirectory`) を、前の要素を書き終えた callback の中から同期的に、再帰で続けて書くため (`pumpEntries` → `doFileDataPump` → `pumpEntries`。スタックの跡で確かめた)。
  - **そのため、レビュアーの形から 1 か所だけ変えた**: ディレクトリの要素は書かずに飛ばす (`continue`)。書き直した ZIP は anydoc だけが読み、anydoc はディレクトリの要素を使わない。コードは、レビュアーの形より短い 1 行である (18.9)。
- **直した後** (`$S/r7/green-dir.txt`、`$S/r7/dirs-cmp.txt`):
  - `ziprx.xlsx`・`withdirs.xlsx` は分割で 3 シート、`withdirs.pptx` は 3 スライドで、`repackage` もどれも書き直せた。
  - ディレクトリの要素の形を自分で作り (`$S/r7/gen-dirs.py`)、Python 版の `convert()` とスタブの結果を比べた: XLSX と PPTX のそれぞれで、ディレクトリの要素を前に置く・後ろに置く、関係の無い空のディレクトリ、200 段の深い階層、`xl/` (`ppt/`) だけを足す、ファイルと同じ名前のディレクトリ (`xl/workbook.xml/`)、末尾が `\` の名前、2,000 個と 9,000 個のディレクトリ、中身のあるディレクトリの要素、`./`、ディレクトリだけの ZIP、`[Content_Types].xml` とディレクトリだけの ZIP。**26 個のうち 21 個が同じ** だった。
  - 違った 5 個:
    - 末尾が `\` の名前 (`xl\`) を持つ XLSX 1 個: yazl は名前の `\` を `/` に変えてから拒むので、`kind` の無い誤りのままである。ZIP の名前は `/` で区切る決まりで、`\` を使うのは決まりから外れた ZIP である。6.x で決める名前の扱い (18.10 の (a)/(b)/(c)) に入れた。PPTX の同じ形は、分割が XML の部品だけを書くので Python 版と同じだった。
    - ディレクトリだけの ZIP と、`[Content_Types].xml` とディレクトリだけの ZIP (XLSX・PPTX で 4 個): 必要な部品が無いので、どちらの版も anydoc にそのまま渡し、anydoc が失敗する。Python 版は `malformed` (422)、スタブは anydoc の例外を分類しないので `internal_error` になった。anydoc の誤りの `code` は XLSX が `malformed`、PPTX が `missingPart` で、本番の `office.ts` が分類すれば同じになる見込み (18.7 の 9 の「途中で切れた ZIP」と同じスタブの限り)。
  - さらに、ディレクトリの要素を乱数で混ぜた 300 個 (`$S/r7/gen-dirs-random.py`。名前に日本語・空白・`.`・50 字の段・途中の `\`・`[Content_Types].xml` などを使い、深さ 1〜60 段、1〜200 個を前後に散らし、1 割は中身を持たせた): **300/300 が Python 版と同じ** で、分割と `repackage` を通す `real.mjs` はどれも終了コード 0 だった。
  - 9,000 個のディレクトリの要素でも、分割と `repackage` の両方で終了コード 0 だった。
  - ディレクトリの要素の数を N・2N・4N にした時間とピークの RSS の増分 (`$S/r7/dir-perf.jsonl`): `repackage` は 5,000 / 1 万 / 2 万 / 4 万個で 27 / 44 / 72 / 129ms・+17 / 30 / 44 / 69MiB、`writeZip` は 5 / 7 / 9 / 13ms・+2 / 6 / 13 / 20MiB で、比例した (要素を書かないので、yazl の要素の数の 2 乗にも当たらない)。
  - ZIP のバイト単位のファジング 8,000 件と前の表の入力は、下の 18.11 の GREEN のとおり。レビュアーが逆斜線の名前を見つけた種 30,000〜30,999 の束も、直した形で終了コード 0 だった (`kind` の無い誤りは、`\` を `/` に変えた名前の 1 件だけ。`$S/out/fuzz-zip-r7-30000.txt`)。
  - yazl が中身の無い要素を再帰で書くことが、ディレクトリでない中身の無いファイルの要素でも起きないかを確かめた (`$S/r7/empty-perf.txt`): 0 バイトの `f<i>.xml` を 5,000 / 1 万 / 2 万個、`writeZip` (中身は空の流れ) と `repackage` に通し、どれも終了コード 0 だった (時間は 139 / 271 / 756ms と 159 / 352 / 949ms で、要素の数の 2 乗の伸び。18.5.3 の上の表と同じ yazl の性質)。中身が流れで渡る要素は、空でも同期の再帰にならない (推論。yazl の `addReadStreamLazy` は流れの終わりを待つ)。

#### 18.5.4 XML

**検査 (`test_ooxml_xml.py` と分割のテストから 23 件)**: **@xmldom/xmldom 23/23**、saxes 23/23、sax 23/23、fast-xml-parser 20/23。

主な検査:

- 不正な XML、空、未知の encoding・`UTF-9`、UTF-8 のバイト列に UTF-16 の宣言が付いたもの、Shift_JIS の宣言は拒む。BOM 付きの UTF-16 は読める。
- 内部のエンティティの宣言 (使っていなくても)、billion laughs (1 秒未満で拒む)、外部のエンティティ (XXE)、パラメーターのエンティティ、宣言の無いエンティティは拒む。
  - XXE の検査では、指したファイルの中身の目印が、結果にも誤りの文にも出ないことを確かめた。
- `SYSTEM` だけの DOCTYPE と `<!ELEMENT>` だけの DOCTYPE は通す (defusedxml と同じ)。
- 属性の中の `&amp;`・`&lt;`・`&#x41;`・`&#12354;`・`&quot;`・`&apos;` を読める。
- Excel が書く形の workbook (`mc:Ignorable`、`x15ac:absPath`、`xr6:coherentId`、`definedName` の中の `'売上'!$A$1`) のシート名を目印に替えて `state` を visible にし、書き戻す。接頭辞・`mc:Ignorable`・ほかの中身が残り、`ns0` 風の接頭辞にならない。
- 書き換えた結果を、もう一度解析できる (サロゲートペアの字 `𠮷` をシート名に含めた)。
- 10 万段の入れ子、40 万個の属性、10MB の属性の値を、時間内に処理する。

fast-xml-parser が落ちた 3 件:

- 宣言の無いエンティティ (`&nope;`) を通した。
- 属性の中の数値の参照 (`&#x41;`) をデコードしなかった。
- 書き戻しで、`definedName` の `'` が `&apos;` になるなど、中身の書き方が変わった。

saxes と sax は木も書き出しの機能も持たない。そのため、元の文字列の位置を記録して、書き換える開始タグだけを差し替える自前の層 (`xml-splice.mjs`、27 行) を書いた。この層の最初の版は、saxes の位置が 1 字ずれていて (`<` の次から数えていた)、書き戻した XML が壊れた。検査を「書き戻した結果をもう一度解析する」形に強めて見つけ、直した。

**expat より緩く通す入力** (defusedxml の `fromstring` と xmldom の両方に通した。実測):

| 入力 | defusedxml | xmldom (`warning` を無視) | xmldom (すべて例外) | 採る形 (すべて例外 + 自前の検査) |
|---|---|---|---|---|
| `<a b=c/>` (引用符の無い属性の値) | 拒む | **通す** | 拒む | 拒む |
| `<a b="1"c="2"/>` (属性の間の空白が無い) | 拒む | **通す** | 拒む | 拒む |
| `<a>&</a>` (裸の `&`) | 拒む | **通す** | **通す** | 拒む |
| `<a>]]></a>` (本文の `]]>`) | 拒む | **通す** | **通す** | 拒む |
| `<a>\u0001</a>` (XML で使えない字) | 拒む | **通す** | **通す** | 拒む |
| `<a>&#0;</a>` (使えない字を指す数値の参照) | 拒む | **通す** | **通す** | 拒む |
| 同じ名前の属性 2 つ、宣言の無い接頭辞、ルートが 2 つ、ルートの後ろの文字、属性の値の中の `<`、XML 宣言が 2 つ、先頭に空白のある XML 宣言、空の名前空間に結んだ接頭辞、数字で始まる名前、閉じタグの大文字小文字の違い、コメントの中の `--` | 拒む | 拒む | 拒む | 拒む |
| コメント・処理命令・CDATA の中の `&` と `]]>`、属性の中の `&amp;`、`&#x1F600;`、`<!ELEMENT>` だけの DOCTYPE、CDATA | 通す | 通す | 通す | 通す |

- この表の 25 件 (`$S/out/strict-inputs.json`) では、採る形の通す / 拒むが defusedxml とすべて同じだった。23 件の検査も通ったまま。

**Python 版の `ooxml_xml.parse` と、さらに 2 つの入力の集まりで比べた** (どちらにも同じバイト列を渡し、Node は `xml-bytes.mjs` で文字列にしてから解析した。Python 版の判定は `.venv` で自分で出した):

| 集まり | 件数 | 通す / 拒むが Python 版と同じ | 違ったもの |
|---|---|---|---|
| 上の表の入力 (`$S/out/strict-inputs.json`) | 25 | 25 | — |
| 1 回目のレビューのレビュアーの 60 件に 8 件を足したもの (`$S/out/xml-inputs.json`、`$S/probe/xml60/`) | 68 | 67 | 展開した名前が同じ属性 |
| 2 回目のレビューのレビュアーが別に作った 92 件 (`$S/out/xml-inputs-rv2.json`。元は `scratchpad/rv2/xml/gen.mjs`) | 92 | 88 | `x-cp1252` と `x-mac-cyrillic` の宣言 (Node だけ通す)、`cp437` の宣言 (Node だけ拒む)、入れ子の要素の展開した名前が同じ属性 (Node だけ通す) |
| 2 回目のレビューのレビュアーの、引用符の中の印の 4 件 (`$S/out/xml-inputs-lit.json`) | 4 | 4 | — |

- 入力の内容: 内部・外部・パラメーターのエンティティ、外部の DTD (`file:`・`http:`)、ATTLIST・NOTATION・解析されないエンティティ、DOCTYPE の中のコメント・処理命令・引用符・離れた引用符に隠した `<!ENTITY`、範囲外・サロゲート・U+FFFE を指す数値の参照、UTF-8 として壊れたバイト列、ISO-8859-1・windows-1252・US-ASCII・`l1` などの宣言、BOM と宣言の食い違い、BOM の無い UTF-16、`standalone`・版の誤り、`<?xml` という名前の処理命令、宣言の無い接頭辞、同じ接頭辞の 2 回の宣言、展開した名前が同じ属性、`xmlns:xmlns`、`xml` の接頭辞の付け替え、DOCTYPE が 2 つ・ルートの後ろの DOCTYPE、閉じていない CDATA、ルートの外の文字、属性の値の中の `&`・`<`・`]]>`・`>`、NUL バイト、名前の中のタブ、`:` で始まる名前、本文の U+0085 / U+2028 など。
- 判定は同じで中身が違うもの: DOCTYPE の `<!ATTLIST>` の既定の属性を、expat は要素に付け、xmldom は付けない (4 件)。比べ方 (Python は最初の子の前の文字だけ、Node は子孫の文字すべて) による見かけの違いが 1 件あり、部品の違いではない。
- 残した違いと、その扱いは 18.7 の 9 の表にある。直したものも、そこに分けて書いた。

**実際の XLSX / PPTX に仕込んで、Python 版の `convert()` とスタブで比べた** (2 回目のレビューのレビュアーの 9 つ。`scratchpad/rv2/ooxml/build.py` で作ったもの。ほかに自分で作った DOCTYPE・rels の 3 つと、細工した 6 つ):

| ファイル | 中身 | 結果 |
|---|---|---|
| `x_utf8bom_latin1decl` | workbook.xml が UTF-8 の BOM に `encoding="ISO-8859-1"` の宣言 | 同じ (Python 版は BOM の後を latin-1 で読み、シート名が化けた 3 シートを返す。Node も同じにした) |
| `x_utf16le_nobom` | workbook.xml が BOM の無い UTF-16LE | 同じ (3 シート) |
| `x_cp1252_undefined` | windows-1252 の宣言で、cp1252 に定義の無い 0x81 | 同じ (`malformed`) |
| `x_whatwg_only_label` | `encoding="x-cp1252"` (WHATWG にだけある名前) | **違う** (Python 版は `malformed`、Node 版は 200 でシート名が化ける。18.7 の 9 に記録) |
| `x_many_comment_opens_closed_once` | `<!--` を 6 万個並べ、最後に 1 回だけ閉じる | 同じ (4ms) |
| `p_unclosed_comment_opens` | presentation.xml に閉じていない `<!--` を 10 万個 | 同じ (`malformed`、15ms) |
| `p_rels_quote_cdata_end`、`x_doctype_attlist_cdata_end`、`p_doctype_stray_quote_entity` | rels の `Target` の `'` と `]]>`、ATTLIST の値の `]]>`、離れた引用符の中の `<!ENTITY` | 同じ |
| 自分で作った 3 つ (`dtdAttlistXlsx`、`dtdExternalPptx`、`relsCdataEndPptx`) | ATTLIST の既定の `state="hidden"`、外部の DTD、rels の `]]>` | 同じ |
| 細工した 6 つ (`entityDeck`、`notesDeck`、`contractDeck`、`dupXlsx`、`storedXlsx`、`u16Pptx`) | 18.5.5 のもの | 同じ |
| `manySlides1000` | 1,000 スライドの PPTX (anydoc を含む実際の変換) | 同じ (1,000 要素) |

**書き戻すときの DOCTYPE と XML 宣言**:

- xmldom の `XMLSerializer` は DOCTYPE (外部の DTD の URL や ATTLIST を含む) と元の XML 宣言 (`encoding="UTF-16"` など) を書き戻す。Python の `tostring(encoding="UTF-8", xml_declaration=True)` は DOCTYPE を書かず、UTF-8 の宣言を新しく書く。試作は、解析の直後に DOCTYPE の節を消し、書き戻すときに XML 宣言を `<?xml version='1.0' encoding='UTF-8'?>` に置き換える。
- DOCTYPE は、解析の直後に 1 回だけ消す。xmldom は、DOCTYPE の節を消した後も `doc.doctype` が消した節を指したままで、もう一度消そうとすると例外になる (実測)。
- UTF-16 の部品を持つ PPTX (`u16Pptx`) は、宣言を置き換えないと anydoc が読めずに失敗した (Python 版は 3 スライドとも読めた)。置き換えた後は同じになった。
- 同じ細工の XLSX は、Python 版がセル数の事前の検査 (バイト列の走査。UTF-16 の BOM で始まる部品を `malformed` にする) で拒む。スタブはその検査を写していない (T6 の部品ではない) ので、比べていない。

**悪意のある入力での時間** (`$S/probe/lin/perf.mjs`。ふつうのプロセスで、入力の大きさ N と 2N を測った。比が 2 前後なら入力に比例、4 前後なら 2 乗):

| 入力 | N=10 万 | N=20 万 | 比 | 判定 |
|---|---|---|---|---|
| XML: 本文に閉じていない `<!--` | 15ms | 20ms | 1.3 | 拒む |
| XML: 本文に閉じていない `<?` | 5ms | 10ms | 1.9 | 拒む |
| XML: 本文に閉じていない `<![CDATA[` | 12ms | 25ms | 2.1 | 拒む |
| XML: 属性の値の中の `<!--` | 25ms | 41ms | 1.6 | 拒む |
| XML: SYSTEM の引用符の中の `<!--` (正しい XML) | 8ms | 15ms | 1.8 | 通す |
| XML: ATTLIST の既定の値の中の `<!--` | 8ms | 17ms | 2.1 | 拒む |
| XML: DOCTYPE の中の閉じていない `<!--` | 8ms | 15ms | 1.9 | 拒む |
| XML: DOCTYPE の中の引用符 (ATTLIST を N 個) | 674ms | 1,366ms | 2.0 | 通す |
| XML: 深い入れ子 | 367ms | 660ms | 1.8 | 通す |
| XML: 1 つのタグの属性 N 個 | 126ms | 291ms | 2.3 | 通す |
| XML: `;` の無い `&` を N 個 | 1ms | 3ms | 2.0 | 拒む |
| XML: 本文の `]]` を N 個 | 3ms | 6ms | 1.8 | 通す |
| XML: タグの中の閉じていない引用符 (4N 字) | 4ms | 8ms | 1.9 | 拒む |
| HTML: 閉じていない `<!--` を N 個 | 6ms | 8ms | 1.4 | — |
| HTML: 1 つのタグの属性 N 個 | 4ms | 6ms | 1.4 | — |
| HTML: `<a////…` (4N 字) | 6ms | 10ms | 1.7 | — |
| HTML: 空白と改行の並び | 4ms | 8ms | 2.1 | — |
| 文字コード: ESC のバイトを 4N 個 | 25ms | 42ms | 1.7 | — |
| 文字コード: UTF-32 の文 | 5ms | 8ms | 1.6 | — |

- 4MiB の入力 (2 回目のレビューのレビュアーが「数 KB の圧縮で作れる」と示した大きさ): 閉じていない `<!--` 100 万個 90ms、閉じていない `<?` 200 万個 109ms、閉じていない `<![CDATA[` 50 万個 69ms、SYSTEM の引用符の中の `<!--` 100 万個 87ms (正しい XML)、閉じた `<!--a-->` 50 万個 535ms。
- 前処理の、CDATA・コメント・処理命令 (と DOCTYPE の中の引用符) を除く部分は、正規表現の置き換え (`text.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '')`) だと、閉じていない開始の印ごとに文書の終わりまで探すので 2 乗の時間になる (実測: 閉じていない `<!--` 5 万個で 1,355ms、10 万個で 5,427ms)。試作は、同じ結果を返す 1 回の走査 (`probe/lib/strip-spans.mjs`) に置き換えた。終わりの印を `indexOf` で探し、終わりの印が見つからなかった種類は以後探さない (それより後の開始の印も閉じられないため)。
- 置き換えた走査と元の正規表現が同じ結果を返すことを、次で確かめた: 印の断片 (`<`・`!`・`--`・`<![CDATA[`・`]]>`・`?>`・引用符など) を並べた乱数の文字列 30 万個 × 2 種類 (本文用と DOCTYPE 用) で違いは 0 件 (`$S/probe/lin/fuzz.mjs`)。上の 4 つの集まりの判定も、置き換えの前と同じだった。
- XML の前処理のほかの部分 (`xml-bytes.mjs` の宣言の読み取りは先頭 200 字だけ、XML で使えない字・裸の `&`・数値の参照の正規表現は先読みが 1 つの参照の長さまで、本文の `]]>` の走査と名前空間の検査は 1 回の走査) と、文字コードのデコードの順 (`decode-pipeline.mjs`。`<meta>` と XML 宣言の読み取りは先頭 4096 / 256 バイト、判定は先頭 64KiB、ESC の探し方は `indexOf`)、HTML の共通の層 (`line-joiner.mjs`。空白は先にまとめるので、`[ \n]+$` のような正規表現は短い並びにしか当たらない) は、ソースを読んで 2 乗になる繰り返しが無いことを確かめ、上の表で測った。
- 「DOCTYPE の中の引用符」(ATTLIST を 20 万個、5MB) の 1.4 秒と、深い入れ子 (20 万段) の 0.7 秒は、入力に比例しているが、xmldom の中で使う時間である。OOXML の部品の大きさは ZIP の上限 (`MAX_ARCHIVE_UNCOMPRESSED_MB`) と子の時間の上限で抑えられる。

**名前空間を入れ子にした文書と、xmldom の中の時間** (3 回目のレビューの指摘):

- xmldom 0.9.12 は、要素ごとの名前空間の表を、親の表を継ぐ形で作る。各段で `xmlns:x="…"` を宣言する要素を深く入れ子にし、内側で祖先の接頭辞を使うと、名前を引くたびに継いだ表を根元まで辿るので、解析が深さの 2 乗の時間になる (自前の前処理ではなく、xmldom の `parseFromString` の中で時間を使う)。
- 実測 (自分で再現した。`nsDeepRootPrefix`): 深さ 2,500 / 5,000 / 10,000 で 75 / 266 / 975ms (倍ごとに約 3.6 倍)。Python 版 (defusedxml) は 3 / 5 / 10ms で通した。3 回目のレビューのレビュアーの実測では、1.6MB の XML で Node 32,446ms 対 Python 70ms、7.5KB の PPTX (`_rels/.rels` に 3 万段) で 4,742ms (RSS 246MiB)、workbook.xml に同じ形を入れた 5KB の XLSX は書き戻しで V8 のメモリが約 4GB に達してメモリ不足になった。
- 直し方: 解析の前に、**除く前の本文** で名前空間の宣言 (`xmlns` と `xmlns:…` の属性にあたる文字の並び) を数え、1,000 個を超えたら `limit_exceeded` で拒む (18.9 の `xmldom.mjs` の `tooManyDeclarations`。見つけた時点で止まる繰り返し)。上の例は、どの深さでも 2ms で拒むようになった。
- **除いた文字列で数えた形の抜け道** (4 回目のレビューの指摘。自分で再現した): CDATA・コメント・処理命令を除く処理 (`stripSpans`) は、DOCTYPE の SYSTEM / PUBLIC の文字列や ATTLIST の既定の値の中の `<!--`・`<?`・`<![CDATA[` も開始の印と取り違える。`<!DOCTYPE r SYSTEM "<!--">…本体…<!-- -->` と書くと本体がまるごと除かれ、宣言は 0 個と数えられる。xmldom は本体をそのまま解析するので、2 乗の時間が戻った (深さ 2,500 / 5,000 / 10,000 で 60 / 234 / 1,061ms)。レビュアーは 8KB の PPTX で 16.9 秒・335MiB、3.4KB の XLSX で RSS 2.6GiB を示した。除く前の本文で数える形にして、レビュアーの 7 つの形 (SYSTEM・PUBLIC の文字列の `<!--`・`<?`・`<![CDATA[`、ATTLIST の値と属性の値の `<!--`、空白の無い `z="1"xmlns:…`) は、深さ 4 万でも 1〜17ms で拒むようになった (`probe/lin/bypass-shapes.mjs`)。数え方の正規表現も、前に空白を求めない形にした。
- 数えすぎの影響: 本文やコメントに `xmlns=` という文字の並びが 1,000 回を超えて現れる部品も拒む。xmldom が読む部品 (rels・workbook.xml・presentation.xml・`[Content_Types].xml`) には利用者の文がほぼ入らない。コーパスと細工した OOXML の 2,261 部品では、除く前の本文で数えても 1 部品で多くて 5 個だった (18.7 の 9)。
- **前処理の検査の役割分担** (除く処理の取り違えで、ほかの検査が見る範囲もずれるかをソースで確かめた):
  - 安全のための検査 (除く前の本文で行う。抜け道を作らない): XML で使えない字 (`INVALID_CHAR`)、名前空間の宣言の数 (`tooManyDeclarations`)。エンティティの宣言の検査は、xmldom が切り出した DOCTYPE の内部サブセットに対して行うので、本文の除く処理の影響を受けない (内部サブセットの中の引用符・コメント・処理命令は、`SUBSET_VERBATIM` で正しく除く)。
  - Python 版と判定を合わせるだけの検査 (除いた後の文字列で行う): 裸の `&` (`BARE_AMPERSAND`)、使えない字を指す数値の参照 (`badReference`)、本文の `]]>` (`cdataEndInText`)。DOCTYPE の文字列に開始の印を書くと、これらは本体を見なくなり、壊れた XML を Node 版だけが通す (5 件を Python 版と比べた。18.7 の 9)。xmldom はそのまま解析するだけで、時間とメモリには影響しない。Python 版の `text.py` の `_skip_doctype` のように DOCTYPE を引用符と括弧を数えて読み飛ばす処理を足せば直せる (推論。試していない) が、Office は DOCTYPE を書かないので記録だけにした。
- 「宣言の総数」と「宣言の入れ子の深さ」のどちらで数えるか: 2 乗になるのは深さ (祖先の宣言の数) によるので、深さで数えるほうが正確で、平らな位置に宣言を多く持つ文書も受け付けられる。ただ深さを数えるには、開始タグと終了タグを対にして辿る処理が要る。総数は深さ以上になるので、総数で抑えれば深さも抑えられ、正規表現の数え方 1 つで済む。そのため、より小さい総数のほうを選んだ。
- 上限 1,000 で正しい文書を拒まないこと: ベンチマークのコーパスと細工した OOXML の 34 ファイル、2,261 個の XML の部品で、1 つの部品の宣言の数は多くて 5 個 (分割が読む workbook.xml・presentation.xml・rels・`[Content_Types].xml` では多くて 3 個) だった。Excel が書く workbook.xml の例 (18.5.4 の検査の `EXCEL_WB`) は 7 個である。上限との間に 100 倍以上の余裕がある。
- 上限ちょうどの悪意のある入力 (宣言を 1,000 段入れ子にし、その下に祖先の接頭辞を使う要素を N 個) は、下の表のとおり大きさに比例した (4.6MB で 1.8 秒)。名前を引くたびに辿る表の長さが 1,000 で抑えられるため。
- 失敗の種類: 3 回目のレビューのレビュアーが作った PPTX 3 つ (`ns30000`・`ns15000`・`nsall15000`) は、Python 版も anydoc の XML の深さの上限で `limit_exceeded` になり、Node 版の `limit_exceeded` と同じだった。XLSX (`ns40k`) は、Python 版が `internal` (500。書き戻しの再帰が深すぎると推論)、Node 版が `limit_exceeded` (422) で違った (18.7 の 9)。

**悪意のある入力の時間とメモリ (N・2N・4N。xmldom を含む XML の解析全体)** (`$S/probe/lin/gen.mjs`・`run1.mjs`。3 回目のレビューのレビュアーの生成器に 4 種類を足した。形ごと・大きさごとに新しいプロセスで、`decodeXmlPart` と `parse` (シートの例は書き戻しも) の時間と、ピークの RSS の増え方を測った):

| 入力 | N | 時間 (N / 2N / 4N) | 増えた RSS (N / 2N / 4N) | 4N の大きさ | 判定 |
|---|---|---|---|---|---|
| 各段で名前空間を宣言する深い入れ子 (祖先の接頭辞を使う) | 2,500 | 3 / 5 / 7ms | 6 / 12 / 11MiB | 0.3MB | 拒む |
| 同上 (各段の属性で祖先の接頭辞を使う) | 2,500 | 3 / 5 / 8ms | 6 / 12 / 12MiB | 0.3MB | 拒む |
| 1 つの要素に名前空間の宣言を N 個 | 2,500 | 1 / 2 / 3ms | 5 / 6 / 7MiB | 0.3MB | 拒む |
| 1 つのタグの属性 N 個 | 50,000 | 71 / 154 / 275ms | 46 / 98 / 185MiB | 2.2MB | 通す |
| 同上、最後に同じ名前の属性 | 50,000 | 35 / 78 / 154ms | 16 / 31 / 43MiB | 2.2MB | 拒む |
| 本文の数値の参照 N 個 | 50,000 | 17 / 32 / 62ms | 13 / 22 / 29MiB | 1.0MB | 通す |
| 属性の値の数値の参照 N 個 | 50,000 | 18 / 33 / 71ms | 14 / 23 / 28MiB | 1.1MB | 通す |
| `&amp;` N 個 | 50,000 | 13 / 26 / 48ms | 12 / 19 / 28MiB | 1.0MB | 通す |
| 長さ N の要素名 | 50,000 | 3 / 4 / 6ms | 6 / 7 / 7MiB | 0.2MB | 通す |
| 長さ 5N の本文 | 50,000 | 4 / 6 / 9ms | 7 / 6 / 7MiB | 1.0MB | 通す |
| 兄弟の要素 N 個 | 50,000 | 273 / 492 / 904ms | 203 / 293 / 453MiB | 2.7MB | 通す |
| 閉じたコメント N 個 | 50,000 | 67 / 123 / 210ms | 44 / 66 / 108MiB | 1.5MB | 通す |
| 閉じた処理命令 N 個 | 50,000 | 36 / 62 / 124ms | 38 / 55 / 121MiB | 1.3MB | 通す |
| CDATA N 個 | 50,000 | 60 / 108 / 191ms | 47 / 70 / 112MiB | 2.5MB | 通す |
| DOCTYPE の ATTLIST N 個 | 50,000 | 357 / 699 / 1373ms | 15 / 28 / 44MiB | 5.6MB | 通す |
| DOCTYPE の中のコメントの引用符 N 個 | 50,000 | 44 / 75 / 132ms | 23 / 24 / 24MiB | 2.3MB | 通す |
| DOCTYPE の ELEMENT N 個 | 50,000 | 271 / 542 / 1063ms | 14 / 25 / 16MiB | 4.1MB | 通す |
| `\r\n` N 個 | 50,000 | 5 / 10 / 31ms | 8 / 14 / 28MiB | 0.6MB | 通す |
| 属性の値の `<` N 個 | 50,000 | 9 / 9 / 14ms | 12 / 12 / 12MiB | 0.2MB | 拒む |
| 閉じていない開始タグ N 個 | 50,000 | 72 / 125 / 250ms | 102 / 194 / 361MiB | 0.6MB | 拒む |
| 対応しない閉じタグ N 個 | 50,000 | 11 / 16 / 28ms | 12 / 12 / 13MiB | 1.3MB | 拒む |
| タグの中の閉じていない引用符 (4N 字) | 50,000 | 3 / 4 / 7ms | 7 / 7 / 7MiB | 0.8MB | 拒む |
| 本文の `>` 4N 個 | 50,000 | 4 / 5 / 7ms | 7 / 7 / 7MiB | 0.8MB | 通す |
| `;` の無い `&a` N 個 | 50,000 | 1 / 2 / 3ms | 4 / 6 / 6MiB | 0.4MB | 拒む |
| workbook.xml のシート N 枚 (書き戻しも含む) | 50,000 | 379 / 723 / 1244ms | 273 / 450 / 660MiB | 13.4MB | 通す |
| rels の Relationship N 個 | 50,000 | 232 / 396 / 710ms | 201 / 272 / 393MiB | 11.2MB | 通す |
| 上限ちょうど (宣言 1,000 段の下に、祖先の接頭辞を使う要素を N 個) | 100,000 | 420 / 847 / 1785ms | 232 / 363 / 610MiB | 4.6MB | 通す |
| 名前空間なしの深い入れ子 N 段 | 50,000 | 228 / 397 / 723ms | 185 / 267 / 383MiB | 1.3MB | 通す |
| `xml:` の接頭辞の属性 N 個 | 50,000 | 120 / 233 / 501ms | 61 / 119 / 247MiB | 2.9MB | 通す |
| 定義済みの参照 5 種類を N 回 | 50,000 | 57 / 114 / 229ms | 39 / 58 / 114MiB | 4.8MB | 通す |

- 時間はどの形も倍ごとに 1.5〜2.4 倍で、入力にほぼ比例した。名前空間の 3 つの形は上限で拒むので、大きさに関係なく数 ms である。
- メモリは入力の何倍にもなる形がある: 閉じていない開始タグ (0.6MB で +361MiB。xmldom は誤りを返す前に DOM を作る)、兄弟の要素 (2.7MB で +453MiB)、深い入れ子 (1.3MB で +383MiB)、シート 20 万枚の workbook.xml (13.4MB で +660MiB)、上限ちょうどの名前空間 (4.6MB で +610MiB)。子の中では RSS の上限 (`MAX_CHILD_RSS_MB`) で止まり、`memory_exceeded` (422 `resource_limit_exceeded`) になる。分割が読む部品の大きさの目安は 3.7 で測る (18.10)。
- 数値の参照だけの 4MB の部品で、前処理の `badReference` が照合の結果をすべて配列にしていたため、ピークの RSS が 377MiB になった (`probe/lin/refmem.mjs`)。見つけた時点で止まる繰り返しに直し、161MiB になった (3 回目のレビューのレビュアーの指摘)。

**PPTX の分割の前処理の時間** (`$S/probe/lin/split-perf.mjs`。anydoc を、すぐに `'x'` を返す代わりの関数にして、分割の前処理だけを測った。スライドの数を変えた PPTX を作った。Python 版も同じく `convert_office` を差し替えて測った):

| スライドの数 (ZIP のエントリの数) | Python 版 | Node の試作 (直す前) | Node の試作 (直した後) |
|---|---|---|---|
| 1,000 (2,009) | 588ms | 7,794ms | 685ms |
| 2,000 (4,009) | 1,949ms | 38,516ms | 1,168ms |
| 4,000 (8,009) | 6,727ms | (2 分で打ち切った) | 2,793ms |

- 直す前の試作は、スライドごとに presentation.xml を解析し直し (1,000 スライドで 3.1 秒)、スライドの一覧が全部入った文書を書き戻していた (3.2 秒)。どちらもスライドの数の 2 乗になる。
- 直した点: presentation.xml は 1 回だけ解析し、スライドの一覧を 1 回だけ空にして、スライドごとにその 1 つを入れて書き戻し、取り出す (Python 版の `_presentation_with_only` と同じ形。`xmldom.mjs` の `keepOnlySlide`)。ZIP の要素は名前の `Map` で引く (`archive-guard.mjs`。前は読むたびにエントリの一覧を全部見ていた)。スタブの分割の写し (`split.mjs`) では、除く部品の集まりをスライドごとに作り直すのをやめ、`[Content_Types].xml` の `Default` を 1 回だけ組み立てた。
- 直した後も、スライドの数が 2 倍で時間は 2〜2.4 倍で、Python 版 (3.3〜3.5 倍) より伸びが小さい。残る伸びは、スライドごとに `[Content_Types].xml` の `Override` を全部見る処理などで、Python 版も同じ形である (推論)。
- 直した後で、1,000 スライドの PPTX を anydoc を含めて変換し、Python 版の `convert()` と同じ 1,000 要素になった (Node のスタブで 882ms)。
- ピークの RSS (`probe/lin/split-hwm.mjs`。分割の前処理だけ、新しいプロセスで測った): Node は 1,000 / 2,000 / 4,000 スライドで 199 / 280 / 370MiB、Python 版は 46 / 51 / 62MiB で、Node は約 4〜6 倍だった。原因は切り分けていない。xmldom の DOM と、スタブの写しが各スライドの package を作るたびに部品のバイト列とパッケージを作り直すこと、V8 の外のメモリ (ZIP の書きの出力) が関わると推論する。3 回目のレビューのレビュアーは、8,000 シートの XLSX の分割でも 352MiB 対 61MiB と測った。

**ベンチマークでの比較** (18.5.5): xmldom と saxes の両方で、PPTX と XLSX の結果が Python 版と同じになった。xmldom は、上の修正をすべて入れた後でもう一度測り (`$S/out/bench-xmldom-r3.json`)、同じ結果だった。

#### 18.5.5 ベンチマークと、Python 版の出力との比較

- `run-benchmark.ts` をスタブに向けた (XML の部品を xmldom にしたものと saxes にしたものの 2 つ)。PDF を除く 12 形式の (a)〜(c) の行と、20 文書の文書ごとの判定が、`python-baseline.json` と完全に一致した (`probe/bench/compare-baseline.mjs` で比べ、違いは Elasticsearch の段だけ)。
  - PDF の 3 文書は、スタブが 500 を返すので「失敗」になる (T6 の範囲外)。比べるのは形式ごとの行だけにした。
- Elasticsearch の段は、`The operation was aborted due to timeout` で飛ばされた。
  - 原因を調べた。`_cluster/allocation/explain` が `can_allocate: no` を返した。`_cat/allocation` ではディスクの使用率が 92% (39GB の空き) で、Elasticsearch のディスクの上限 (既定 90%) を超えていた。新しい index を置けず、作成の要求が 30 秒の期限に達した。
  - devcontainer の Elasticsearch は共有の環境なので、設定は変えていない。
  - 6 回目のレビューの後の回 (`$S/out/bench-r7.json`) ではディスクの使用率が 45% に下がっていて、Elasticsearch の段が動いた。PDF を含まない 24 行の検索の行 (kuromoji と GROWI の引用符つきの 2 通り) と、PDF 以外の位置の問題 (`docx-ja.docx` の `テレワーク勤務制度` の 1 件。ベースラインにも同じ 1 件がある) が、ベースラインと同じだった。違うのは PDF の行と PDF を含む「all」の行だけで、スタブが PDF を 500 にするためである。
- 20 文書の `pages[]` (`pageNumber`・`label`・`content`) を、Python 版の `convert()` (サービスを起動せずに `.venv` で呼んだ) と文字単位で比べた。xmldom と saxes の **どちらも 20/20 が同じ** だった。
- Python 版のテストの細工したファイルでも、Python 版の `convert()` と比べた。
  - エンティティの展開を仕込んだ rels の PPTX (`malformed`)、ノートのある PPTX、`_contract_deck` の PPTX (ノート・表・画像・グループ・非表示のスライド・空のスライド・スライドの順の入れ替え)、同じ名前の要素を持つ XLSX、無圧縮の要素の XLSX の 5 つは、結果が同じ。
  - DOCX の爆弾と暗号化した PPTX の 2 つは、Python 版が `limit_exceeded` / `encrypted` を返した。スタブは `internal_error` を返した。どちらも anydoc が出す例外の分類 (`office.ts` の仕事) をスタブが持たないためで、T6 の部品の違いではない。
  - UTF-16 の部品を持つ PPTX は同じ。UTF-16 の部品を持つ XLSX は、上の 18.5.4 のとおりスタブがセル数の検査を持たないため比べられなかった。
- xmldom・`xml-bytes.mjs`・`archive-guard.mjs`・スタブの分割を最終の形にした後で、ベンチマーク (Elasticsearch なし、`$S/out/bench-xmldom-r3.json`) と `pages[]` の比較、細工したファイルの比較をもう一度行った。PDF 以外はベースラインと一致し、`pages[]` は 20/20 が同じ、細工したファイルは 18.5.4 の表のとおり (`x_whatwg_only_label` のほかは Python 版と同じ) だった。

#### 18.5.6 読み込みの重さ

| 部品 | 読み込み (ms) | RSS の増分 (MiB) | VmSize の増分 (MiB) |
|---|---|---|---|
| **htmlparser2** | 11.6 | 12 | 5 |
| node-html-parser | 5.2 | 9 | 1 |
| parse5 | 11.6 | 11 | 5 |
| **yauzl** | 2.0 | 2 | 1 |
| **yazl** | 2.3 | 3 | 1 |
| fflate | 4.1 | 7 | 1 |
| adm-zip | 6.7 | 5 | 2 |
| jszip | 21.1 | 12 | 5 |
| **@xmldom/xmldom** | 13.8 | 7 | 10 |
| saxes | 1.8 | 2 | 1 |
| sax | 1.3 | 2 | 1 |
| fast-xml-parser | 18.6 | 13 | 6 |
| chardet | 3.4 | 3 | 1 |
| encoding-japanese | 4.2 | 4 | 2 |
| chardetng-wasm | 2.2 | 3 | **8,194** |

素の Node の `VmSize` は約 1,375MiB、`VmPeak` は 1,375〜1,438MiB だった (同じプロセスでも、実行のたびに 60MiB ほど揺れた)。採った 4 つを合わせても、`VmSize` の増分は約 17MiB である (足し算による推論。まとめて読み込んでは測っていない)。

#### 18.5.7 コード量

試作のコードを、空行を除いた行数で数えた (`grep -cv '^\s*$'`)。本番のコードの行数ではなく、候補ごとの手間を比べるための目安である。

候補ごとの adapter (部品を共通の形に合わせるためのコード):

| 分野 | 候補 | 行数 | 中身 |
|---|---|---|---|
| HTML | **htmlparser2 (`Tokenizer`)** | 64 | `Tokenizer` に 6 つの callback を渡し、ほかは何もしない。うち約 40 行は、5 回目と 6 回目のレビューの後に足した Python 版と合わせる処理 (自己終了の形、`<title>` の中の `<&`、捨てる数値の文字参照、終わりのタグの引用符。18.5.1)。4 回目のレビューの後の形は 24 行、`Parser` の形は 15 行だった |
| HTML | parse5 | 18 | 木を再帰なしで辿る |
| HTML | node-html-parser | 21 | 木を再帰なしで辿る |
| 文字コード | **自前** | 44 | 点数づけと判定 (18.9 に全文。Shift_JIS の候補は `decode-pipeline.mjs` の `cp932` で読む) |
| 文字コード | chardet / encoding-japanese / chardetng-wasm | 6 / 6 / 9 | 名前の対応だけ |
| ZIP の読み | 自前 | 79 | 中央ディレクトリの読み取り 47 + 読み 32 |
| ZIP の読み | **yauzl** | 28 | 名前のデコードと CRC-32 の確認を含む |
| ZIP の読み | fflate | 25 (+ 自前の中央ディレクトリの読み取り 47) | 一覧と位置に自前の読み取りが要る |
| ZIP の読み | adm-zip / jszip | 19 / 15 | — |
| ZIP の書き | 自前 | 33 | — |
| ZIP の書き | **yazl** | 31 | 元の流れと yazl の誤り、yazl が名前を拒む例外を、拒否 (reject) として返す処理と、ディレクトリの要素を飛ばす処理を含む |
| ZIP の書き | fflate | 17 | — |
| XML | **@xmldom/xmldom** | 115 | 壊れた XML を拒む自前の検査、名前空間の宣言の数の上限、名前空間の予約の検査、エンティティの宣言の検査、DOCTYPE の削除と宣言の置き換え、スライドの一覧を 1 回だけ空にする処理を含む。このうち部品を呼ぶ部分 (`parse` の本体) と書き戻し・OOXML の操作は 47 行、残りの 68 行が自前の検査 |
| XML | saxes / sax | 24 / 21 (+ 位置で書き換える自前の層 27) | — |
| XML | fast-xml-parser | 30 | — |

候補に依らない共通の自前の層 (Python 版を写したもの。本番でも同じものが要る):

| ファイル | 行数 | 中身 |
|---|---|---|
| `line-joiner.mjs` | 30 | `_LineJoiner` と、HTML の読み飛ばし・改行・セルの規則 |
| `decode-pipeline.mjs` | 104 | `charset.decode` の順、UTF-32、Python の厳密さに合わせる点 (Python の cp932 の読み方 19 行と、狭い codec の宣言の検査 16 行を含む)、`<meta>` と XML 宣言の読み取り |
| `archive-guard.mjs` | 34 | `archive_guard.py` の写し (要素は名前の `Map` で引く) |
| `strip-spans.mjs` | 20 | CDATA・コメント・処理命令・引用符で囲まれた部分を除く 1 回の走査 (正規表現の置き換えと同じ結果。除いた所に区切りの字を置くこともできる) |
| `bench/pipe-repackage.mjs` | 61 | ZIP の読みから書きへ流してつなぐ形 (関数 `repackage` と、試すためのコマンド) |
| `xml-bytes.mjs` | 38 | XML の部品のバイト列から文字列への変換 (BOM と宣言の食い違い、BOM の無い UTF-16、1 バイトの文字コード、cp125x の未定義のバイト) |
| `bench/split.mjs` | 98 | `pptx_split.py` と `xlsx_split.py` の写し (セル数の検査と予算の細かな扱いは除く) |

#### 18.5.8 部品ごとの悪意のある入力のファジング (4 回目のレビューの後。5 回目のレビューの後に形を足し、測り直した)

使うすべての部品 (htmlparser2 の `Tokenizer`・`TextDecoder` と自前の判定・yauzl・yazl・xmldom) について、悪意のある形を N・2N・4N の大きさで作り、形・大きさごとに新しいプロセスで、時間とピークの RSS (`VmHWM`) の増え方を測った。入力の生成器は `$S/probe/fuzz/shapes.mjs`、1 回の実行は `run.mjs`、全部を回すのは `sweep.sh` (結果は `$S/out/fuzz-sweep.jsonl`、5 回目のレビューの後は `fuzz-sweep-r6.jsonl`)。表は `table.mjs` で作る。通る道は 18.9 のコードそのもの (HTML は `decodeWith(detect)` と `htmlToText`、文字コードは `decodeWith(detect)`、ZIP は `inspectArchive` と yauzl の adapter と `repackage`、XML は `decodeXmlPart` と `parse`)。ZIP は、細工のために extra field も書ける小さな ZIP の書き手を生成器の中に持つ (テスト用の `test/fixtures/zip.ts` は使わない)。N は、名前空間の形は 2,500、ZIP のエントリの数は 2.5 万、ほかは 5 万。

生成器と測り方のコードは次のとおり (試作のファイルと同じもの)。

`probe/fuzz/shapes.mjs`:

```js
// Hostile inputs per component, built at size n. Each returns { kind, input } where kind picks the code path.
import { crc32 } from 'node:zlib';
const rep = (s, n) => s.repeat(n);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
// Minimal stored-entry ZIP writer with an optional extra field (the repo's fixture writer is test-only).
const zip = (entries) => {
  const out = []; const cen = []; let off = 0;
  for (const { name, data = Buffer.from('<x/>'), extra = Buffer.alloc(0) } of entries) {
    const nm = Buffer.from(name); const crc = crc32(data);
    const common = Buffer.concat([u16(20), u16(0x800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nm.length), u16(extra.length)]);
    const local = Buffer.concat([u32(0x04034b50), common, nm, extra]);
    out.push(local, data);
    cen.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(off), nm, extra]));
    off += local.length + data.length;
  }
  const cd = Buffer.concat(cen);
  return Buffer.concat([...out, cd, u32(0x06054b50), u16(0), u16(0), u16(Math.min(entries.length, 0xffff)), u16(Math.min(entries.length, 0xffff)), u32(cd.length), u32(off), u16(0)]);
};
const ns = (n) => `<a:r xmlns:a="u">${Array.from({ length: n }, (_, i) => `<a:e xmlns:p${i}="x${i}">`).join('')}${rep('</a:e>', n)}</a:r>`;
export const SHAPES = {
  // HTML (decode + htmlToText)
  'html: unclosed <div>': ['html', (n) => rep('<div>', n)],
  'html: open <div> then stray </svg>': ['html', (n) => rep('<div>', n) + rep('</svg>', n)],
  'html: unclosed <font>x': ['html', (n) => rep('<font>x', n)],
  'html: nested <div> closed': ['html', (n) => rep('<div>', n) + 'x' + rep('</div>', n)],
  'html: attributes in one tag': ['html', (n) => '<a' + rep(' b="c"', n) + '>t</a>'],
  'html: character references': ['html', (n) => '<p>' + rep('&#12354;&amp;&nbsp;', n) + '</p>'],
  'html: one huge line': ['html', (n) => '<p>' + rep('word ', n * 4) + '</p>'],
  'html: huge <script> body': ['html', (n) => '<script>' + rep('var x = "<p>";', n) + '</script><p>after</p>'],
  'html: many <': ['html', (n) => rep('<', n * 4)],
  'html: unclosed comments': ['html', (n) => rep('<!--', n)],
  'html: "<&" references in <title>': ['html', (n) => '<title>' + rep('<&amp;&#12354;', n) + '</title>'],
  'html: "<x / >" start tags': ['html', (n) => rep('<title / >t</title><p / >', n)],
  'html: end tags with ">" in a quoted attribute': ['html', (n) => rep('</p a=">">x', n)],
  'html: one end tag full of quotes': ['html', (n) => '</a ' + rep('"\'= x/', n) + '>t'],
  'html: end tags with quotes that pair across tags': ['html', (n) => rep('</a b="x></a c=\'y>', n)],
  'html: end tags not closed by ">" (</a x=">">)': ['html', (n) => rep('</a x=">"', n)],
  'html: one end tag with many attributes': ['html', (n) => '<p>before</p></a' + rep(' x', n * 10) + '><p>after</p>'],
  'html: numeric references Python drops': ['html', (n) => '<p>' + rep('&#1;&#xFFFF;', n) + '</p>'],
  // charset (decodeWith(detect))
  'charset: huge <meta charset> value': ['html', (n) => `<meta charset="${rep('a', n * 4)}"><p>x</p>`],
  'charset: BOM repeated': ['text', (n) => Buffer.concat([Buffer.alloc(n * 3, Buffer.from([0xef, 0xbb, 0xbf])), Buffer.from('x')])],
  'charset: huge <meta> tag': ['html', (n) => `<meta ${rep('a="b" ', n)} charset="utf-8"><p>x</p>`],
  'charset: ESC bytes': ['text', (n) => Buffer.alloc(n * 4, 0x1b)],
  'charset: Shift_JIS with one bad byte at the end': ['text', (n) => Buffer.concat([Buffer.alloc(n * 4, Buffer.from([0x82, 0xa0])), Buffer.from([0xff])])],
  'charset: Shift_JIS with 0xFF after every character': ['text', (n) => Buffer.alloc(n * 3, Buffer.from([0x82, 0xa0, 0xff]))],
  'charset: gb2312 declared over Shift_JIS bytes': ['html', (n) => Buffer.concat([Buffer.from('<meta charset="gb2312"><p>'), Buffer.alloc(n * 4, Buffer.from([0x93, 0xfa, 0x96, 0x7b]))])],
  // ZIP (inspectArchive with yauzl: list, then read the required part)
  'zip: many entries': ['zip', (n) => zip([{ name: 'xl/workbook.xml' }, ...Array.from({ length: n }, (_, i) => ({ name: `f${i}.xml`, data: Buffer.alloc(0) }))])],
  'zip: long names': ['zip', (n) => zip([{ name: 'xl/workbook.xml' }, ...Array.from({ length: Math.max(1, n / 1000) }, (_, i) => ({ name: `${i}${rep('a', 60000)}`, data: Buffer.alloc(0) }))])],
  'zip: deep paths': ['zip', (n) => zip([{ name: 'xl/workbook.xml' }, ...Array.from({ length: Math.max(1, n / 1000) }, (_, i) => ({ name: `${rep('d/', 30000)}${i}`, data: Buffer.alloc(0) }))])],
  'zip: huge extra fields': ['zip', (n) => zip([{ name: 'xl/workbook.xml' }, ...Array.from({ length: Math.max(1, n / 1000) }, (_, i) => ({ name: `e${i}`, data: Buffer.alloc(0), extra: Buffer.concat([u16(0xcafe), u16(65000), Buffer.alloc(65000)]) }))])],
  'zip: many entries, repackaged (stream)': ['repack', (n) => zip([{ name: 'xl/workbook.xml' }, ...Array.from({ length: n }, (_, i) => ({ name: `f${i}.xml` }))])],
  // XML (decodeXmlPart + parse)
  'xml: namespace nesting': ['xml', (n) => ns(n)],
  'xml: namespace nesting behind a DOCTYPE literal': ['xml', (n) => `<!DOCTYPE a:r SYSTEM "<!--">${ns(n)}<!-- -->`],
  'xml: ENTITY declarations': ['xml', (n) => `<!DOCTYPE r [${Array.from({ length: n }, (_, i) => `<!ENTITY e${i} "v">`).join('')}]><r/>`],
  'xml: ATTLIST declarations': ['xml', (n) => `<!DOCTYPE r [${Array.from({ length: n }, (_, i) => `<!ATTLIST r a${i} CDATA "v">`).join('')}]><r/>`],
  'xml: quotes in the subset': ['xml', (n) => `<!DOCTYPE r [${rep('<!-- " \' -->', n)}]><r/>`],
  'xml: attributes': ['xml', (n) => `<r ${Array.from({ length: n }, (_, i) => `a${i}="v"`).join(' ')}/>`],
  'xml: depth': ['xml', (n) => rep('<a>', n) + rep('</a>', n)],
  'xml: siblings': ['xml', (n) => `<r>${rep('<e a="1">t</e>', n)}</r>`],
  'xml: unclosed start tags': ['xml', (n) => `<r>${rep('<a>', n)}`],
};
```

`probe/fuzz/run.mjs`:

```js
// One shape at one size in this process: time and VmHWM growth. Prints one JSON line.
import { readFileSync } from 'node:fs';
import { SHAPES } from './shapes.mjs';
const [name, nStr] = [process.argv[2], Number(process.argv[3])];
const hwm = () => Math.round(parseInt(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024);
const [kind, make] = SHAPES[name]; const raw = make(nStr); const input = typeof raw === 'string' ? Buffer.from(raw) : raw;
const { decodeWith, htmlDeclared } = await import('../lib/decode-pipeline.mjs'); const { detect } = await import('../charset/own.mjs');
const { htmlToText } = await import('../html/htmlparser2.mjs'); const { decodeXmlPart } = await import('../lib/xml-bytes.mjs');
const X = await import('../xml/xmldom.mjs'); const reader = await import('../zip/yauzl.mjs'); const { inspectArchive } = await import('../lib/archive-guard.mjs');
const { repackage } = await import('../bench/pipe-repackage.mjs');
const LIM = { entries: 10_000_000, uncompressedBytes: 512 * 1024 * 1024 };
const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
const before = hwm(); const t = performance.now(); let result;
try {
  if (kind === 'html') { htmlToText(decodeWith(detect)(data, htmlDeclared(data))); result = 'ok'; }
  else if (kind === 'text') { decodeWith(detect)(data); result = 'ok'; }
  else if (kind === 'xml') { X.parse(decodeXmlPart(data)); result = 'accept'; }
  else if (kind === 'zip') { const a = await inspectArchive(reader, data, 'xl/workbook.xml', LIM); result = a ? `opened, read ${(await a.read('xl/workbook.xml', 1 << 20)).length}B` : 'pass-through'; }
  else if (kind === 'repack') { result = `repackaged ${(await repackage(Buffer.from(data), 512 << 20)).length}B`; }
} catch (e) { result = `refused (${e.kind ?? e.constructor.name})`; }
console.log(JSON.stringify({ name, n: nStr, bytes: input.length, ms: Math.round(performance.now() - t), mib: hwm() - before, result }));
```

`probe/fuzz/sweep.sh`:

```sh
#!/bin/sh
# Every shape at N, 2N, 4N, one process each; a run over 120 s is recorded as a timeout.
OUT=$1; : > "$OUT"
node --input-type=module -e "import { SHAPES } from './shapes.mjs'; for (const k of Object.keys(SHAPES)) console.log(k)" | while IFS= read -r name; do
  case "$name" in "xml: namespace nesting"*) n0=2500;; "zip: many entries"*) n0=25000;; *) n0=50000;; esac
  for k in 1 2 4; do
    timeout 120 node --no-warnings --stack-size=984 run.mjs "$name" $((n0 * k)) >> "$OUT" 2>/dev/null || echo "{\"name\":\"$name\",\"n\":$((n0 * k)),\"result\":\"timeout or crash (exit $?)\"}" >> "$OUT"
  done
done
```

`probe/fuzz/table.mjs`:

```js
// Markdown table for research.md 18.5.8 from a sweep.sh result (one JSON line per shape and size).
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const label = (r) => r.startsWith('ok') ? '完了' : r === 'accept' ? '通す' : r.startsWith('opened') ? '開いて読めた' : r.startsWith('repackaged') ? '書き直せた'
  : r.startsWith('refused') ? `拒む (${r.slice(9, -1)})` : r === 'pass-through' ? 'そのまま渡す' : r;
const esc = (s) => s.replace(/</g, '\\<').replace(/\|/g, '\\|');
const byName = new Map();
for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
console.log('| 部品 / 入力 | N | 大きさ (4N) | 時間 (N / 2N / 4N) | 4N / N | 増えた RSS (N / 2N / 4N) | 結果 |');
console.log('|---|---|---|---|---|---|---|');
for (const [name, rs] of byName) {
  const [a, , c] = rs;
  const ratio = c.ms == null ? '—' : (c.ms / Math.max(a.ms, 1)).toFixed(1);
  const res = [...new Set(rs.map((r) => label(r.result)))].join(' / ');
  console.log(`| ${esc(name)} | ${a.n.toLocaleString('en')} | ${c.bytes == null ? '—' : `${(c.bytes / 1048576).toFixed(1)}MiB`} | ${rs.map((r) => r.ms ?? '—').join(' / ')}ms | ${ratio} | ${rs.map((r) => r.mib ?? '—').join(' / ')}MiB | ${res} |`);
}
```

ZIP のバイト単位のファジング (5 回目のレビューのレビュアーの `fuzz-zip-fix.mjs` の写し。入力はコーパスと細工した XLSX / PPTX の 9 個 (`$S/out/zin`)。種ごとに 1〜12 バイトを書き換え、10 件に 1 件は途中で切る。分割の写し (`split.mjs`) と流してつなぐ書き直し (`repackage`) の両方に通す):

`probe/fuzz/fuzz-zip.mjs`:

```js
// Byte-level fuzzing of the OOXML flow (split.mjs over the 18.9 parts) and of repackage() (pipe-repackage.mjs). Copy of the 5th-round reviewer's script.
// A crash ends the batch before the 'done' line; cur-<pid>.txt names the case in progress.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { makeSplitters } from '../bench/split.mjs';
import { repackage } from '../bench/pipe-repackage.mjs';
const X = await import('../xml/xmldom.mjs');
const { convertPptx, convertXlsx } = makeSplitters(X, async () => 'x');
const dir = process.argv[4];
const files = readdirSync(dir).filter((f) => /\.(pptx|xlsx)$/.test(f)).map((f) => ({ f, b: readFileSync(`${dir}/${f}`) }));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const [from, to] = [Number(process.argv[2]), Number(process.argv[3])];
const kinds = {}; let maxMs = 0; let slow = 0;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('HANG'), { kind: 'HANG' })), ms).unref())]);
for (let seed = from; seed < to; seed++) {
  const r = mulberry(seed * 40503 + 7); const rnd = (n) => Math.floor(r() * n);
  const { f, b } = files[rnd(files.length)]; const m = Buffer.from(b);
  const flips = 1 + rnd(12);
  for (let i = 0; i < flips; i++) { const at = rnd(m.length); m[at] = rnd(3) === 0 ? 0xff : rnd(256); }
  const data = rnd(10) === 0 ? m.subarray(0, rnd(m.length)) : m;
  writeFileSync(`curz-${process.pid}.txt`, `${seed} ${f}`);
  for (const [label, run] of [['split', () => (f.endsWith('xlsx') ? convertXlsx : convertPptx)(new Uint8Array(data))], ['pipe', () => repackage(Buffer.from(data), 512 * 1048576)]]) {
    const t = performance.now(); let k;
    try { await withTimeout(run(), 5000); k = 'ok'; } catch (e) { k = e?.kind ?? `unkinded:${String(e?.message).slice(0, 40)}`; }
    const ms = performance.now() - t; maxMs = Math.max(maxMs, ms);
    if (ms > 1000 || k === 'HANG') { slow++; writeFileSync(`slowz-${seed}.${f.split('.').pop()}`, data); console.log(`SLOW/HANG ${label} seed=${seed} ${f} ${ms.toFixed(0)}ms ${k}`); }
    kinds[`${label}:${k}`] = (kinds[`${label}:${k}`] ?? 0) + 1;
  }
}
console.log(`done ${from}-${to}: max ${maxMs.toFixed(0)}ms slow ${slow}`, JSON.stringify(kinds));
```

`probe/fuzz/fuzz-zip.sh`:

```sh
#!/bin/sh
# Byte-level ZIP fuzzing in batches of 1,000 seeds, one process per batch; records each batch's exit code.
# usage: fuzz-zip.sh <first seed> <last seed (exclusive)> <dir of .pptx/.xlsx> <log>
FROM=$1; TO=$2; DIR=$3; LOG=$4; : > "$LOG"
s=$FROM
while [ "$s" -lt "$TO" ]; do
  e=$((s + 1000))
  node --no-warnings "$(dirname "$0")/fuzz-zip.mjs" $s $e "$DIR" >> "$LOG" 2>&1
  echo "batch $s-$e exit $?" >> "$LOG"
  s=$e
done
```

結果 (`$S/out/fuzz-sweep-r7.jsonl` から `table.mjs` で作った表。5 回目のレビューの後に HTML の 6 つの形と文字コードの 2 つの形を、6 回目のレビューの後に HTML の終わりのタグの 2 つの形を足した。39 種類):

| 部品 / 入力 | N | 大きさ (4N) | 時間 (N / 2N / 4N) | 4N / N | 増えた RSS (N / 2N / 4N) | 結果 |
|---|---|---|---|---|---|---|
| html: unclosed \<div> | 50,000 | 1.0MiB | 14 / 22 / 40ms | 2.9 | 5 / 6 / 6MiB | 完了 |
| html: open \<div> then stray \</svg> | 50,000 | 2.1MiB | 21 / 36 / 69ms | 3.3 | 6 / 6 / 8MiB | 完了 |
| html: unclosed \<font>x | 50,000 | 1.3MiB | 13 / 24 / 43ms | 3.3 | 4 / 6 / 10MiB | 完了 |
| html: nested \<div> closed | 50,000 | 2.1MiB | 27 / 49 / 93ms | 3.4 | 5 / 7 / 8MiB | 完了 |
| html: attributes in one tag | 50,000 | 1.1MiB | 5 / 7 / 13ms | 2.6 | 1 / 3 / 2MiB | 完了 |
| html: character references | 50,000 | 3.6MiB | 32 / 62 / 119ms | 3.7 | 12 / 22 / 41MiB | 完了 |
| html: one huge line | 50,000 | 3.8MiB | 32 / 87 / 140ms | 4.4 | 24 / 61 / 110MiB | 完了 |
| html: huge \<script> body | 50,000 | 2.7MiB | 4 / 8 / 12ms | 3.0 | 2 / 3 / 4MiB | 完了 |
| html: many \< | 50,000 | 0.8MiB | 22 / 41 / 80ms | 3.6 | 7 / 15 / 18MiB | 完了 |
| html: unclosed comments | 50,000 | 0.8MiB | 3 / 5 / 8ms | 2.7 | 2 / 2 / 2MiB | 完了 |
| html: "\<&" references in \<title> | 50,000 | 2.7MiB | 32 / 64 / 121ms | 3.8 | 12 / 24 / 41MiB | 完了 |
| html: "\<x / >" start tags | 50,000 | 4.8MiB | 50 / 98 / 191ms | 3.8 | 11 / 20 / 38MiB | 完了 |
| html: end tags with ">" in a quoted attribute | 50,000 | 2.1MiB | 23 / 46 / 89ms | 3.9 | 9 / 16 / 24MiB | 完了 |
| html: one end tag full of quotes | 50,000 | 1.1MiB | 4 / 6 / 11ms | 2.8 | 1 / 1 / 2MiB | 完了 |
| html: end tags with quotes that pair across tags | 50,000 | 3.4MiB | 10 / 17 / 26ms | 2.6 | 5 / 5 / 8MiB | 完了 |
| html: end tags not closed by ">" (\</a x=">">) | 50,000 | 1.7MiB | 5 / 9 / 14ms | 2.8 | 1 / 2 / 3MiB | 完了 |
| html: one end tag with many attributes | 50,000 | 3.8MiB | 17 / 27 / 53ms | 3.1 | 2 / 3 / 5MiB | 完了 |
| html: numeric references Python drops | 50,000 | 2.3MiB | 8 / 13 / 22ms | 2.8 | 4 / 4 / 5MiB | 完了 |
| charset: huge \<meta charset> value | 50,000 | 0.8MiB | 4 / 5 / 8ms | 2.0 | 1 / 2 / 2MiB | 完了 |
| charset: BOM repeated | 50,000 | 0.6MiB | 0 / 0 / 1ms | 1.0 | 0 / 0 / 1MiB | 完了 |
| charset: huge \<meta> tag | 50,000 | 1.1MiB | 5 / 7 / 12ms | 2.4 | 1 / 2 / 2MiB | 完了 |
| charset: ESC bytes | 50,000 | 0.8MiB | 12 / 22 / 40ms | 3.3 | 4 / 4 / 5MiB | 完了 |
| charset: Shift_JIS with one bad byte at the end | 50,000 | 0.8MiB | 7 / 8 / 13ms | 1.9 | 4 / 3 / 5MiB | 完了 |
| charset: Shift_JIS with 0xFF after every character | 50,000 | 0.6MiB | 19 / 26 / 40ms | 2.1 | 6 / 7 / 8MiB | 完了 |
| charset: gb2312 declared over Shift_JIS bytes | 50,000 | 0.8MiB | 10 / 12 / 14ms | 1.4 | 3 / 4 / 4MiB | 完了 |
| zip: many entries | 25,000 | 9.1MiB | 90 / 156 / 196ms | 2.2 | 41 / 55 / 45MiB | 開いて読めた |
| zip: long names | 50,000 | 22.9MiB | 10 / 15 / 19ms | 1.9 | 6 / 11 / 8MiB | 開いて読めた |
| zip: deep paths | 50,000 | 22.9MiB | 10 / 20 / 42ms | 4.2 | 7 / 8 / 8MiB | 開いて読めた |
| zip: huge extra fields | 50,000 | 24.8MiB | 6 / 7 / 7ms | 1.2 | 1 / 0 / 0MiB | 開いて読めた |
| zip: many entries, repackaged (stream) | 25,000 | 9.5MiB | 1308 / 3727 / 5875ms | 4.5 | 234 / 289 / 249MiB | 書き直せた |
| xml: namespace nesting | 2,500 | 0.3MiB | 3 / 5 / 6ms | 2.0 | 3 / 6 / 4MiB | 拒む (limit_exceeded) |
| xml: namespace nesting behind a DOCTYPE literal | 2,500 | 0.3MiB | 1 / 1 / 1ms | 1.0 | 1 / 1 / 1MiB | 拒む (limit_exceeded) |
| xml: ENTITY declarations | 50,000 | 3.9MiB | 503 / 1028 / 2057ms | 4.1 | 13 / 26 / 17MiB | 拒む (Error) |
| xml: ATTLIST declarations | 50,000 | 5.6MiB | 345 / 688 / 1386ms | 4.0 | 13 / 30 / 58MiB | 通す |
| xml: quotes in the subset | 50,000 | 2.3MiB | 41 / 76 / 133ms | 3.2 | 7 / 16 / 17MiB | 通す |
| xml: attributes | 50,000 | 2.2MiB | 74 / 155 / 302ms | 4.1 | 40 / 96 / 186MiB | 通す |
| xml: depth | 50,000 | 1.3MiB | 220 / 397 / 730ms | 3.3 | 178 / 251 / 377MiB | 通す |
| xml: siblings | 50,000 | 2.7MiB | 262 / 499 / 901ms | 3.4 | 196 / 289 / 452MiB | 通す |
| xml: unclosed start tags | 50,000 | 0.6MiB | 66 / 140 / 247ms | 3.7 | 94 / 188 / 305MiB | 拒む (ParseError) |

- 時間は、ZIP の書き直しを除き、4N / N の比がどの形も 1.0〜4.4 で、入力に比例する場合の 4 倍の前後にある (2 乗なら 16 倍)。ZIP の書き直しは 4.5 で、要素の数を細かく変えて測ると yazl の中で 2 乗に伸びていた (18.5.3)。それ以外に **2 乗になる形は見つからなかった**。
- ただし、比が 1.0〜2.0 の行のうち次のものは、部品が比例することを示していない。名前空間の 2 つの形は、宣言の数の上限で xmldom に渡す前に拒むので、測ったのは拒むまでの時間である (xmldom 自身の 2 乗は 18.5.4 のとおりで、上限で止めている)。「BOM repeated」(0ms) と「huge extra fields」(7ms) は時間が短すぎて、固定の手間と区別できない。「Shift_JIS with one bad byte at the end」(比 1.9)・「gb2312 declared over Shift_JIS bytes」(比 1.4)・「zip: many entries」(比 2.2) も、時間の大半が入力の大きさに依らない固定の手間 (プロセスの中の読み込みと、最初の `TextDecoder` の用意など。推論) で、比が小さいことは比例の証拠にならない。この 3 つは、比が 16 倍に届かないので 2 乗ではないとだけ言える。
- 重いもの:
  - ZIP のエントリ 10 万個を流してつなぐ書き直し (`repackage`) は、5.8 秒・+228〜293MiB。4 回目のレビューの後は「比例している」と書いたが、要素の数の 2 乗だった (18.5.3)。本番ではエントリの数を `MAX_ARCHIVE_ENTRIES` (既定 10,000) で先に断るので、この大きさは届かない (推論)。
  - XML の ENTITY の宣言 (3.9MB で 2.1 秒) は、xmldom が文書全体を解析した後でエンティティの宣言の検査が拒むので、拒むまでに時間がかかる。比例している。
  - XML の DOM のメモリ (深さ・兄弟・属性・閉じていない開始タグで、入力の 100〜600 倍) は 18.5.4 のとおり。
- HTML の「巨大な 1 行」(3.8MiB) の比は 4.4 で (5 回目のレビューの後の回では 5.2)、少し比例より大きいことがある。V8 のごみ集めの影響と推論する。
- 5 回目のレビューの後に足した HTML の形 (`<title>` の中の `<&`、`<x / >`、終わりのタグの引用符の 3 つ、捨てる数値の文字参照) と、文字コードの形 (0xFF を 1 字おきに置いた Shift_JIS、`gb2312` の宣言) は、どれも比 1.3〜3.9 で比例した。
- 6 回目のレビューの後に足した HTML の終わりのタグの 2 つの形 (`</a x=">"` の並びと、属性の多い終わりのタグ。どちらも 5 回目のレビューの後の形では 2 乗の時間か `RangeError` だった。18.5.1) は、比 2.8・3.1 で比例した。
- ZIP のバイト単位のファジング (`fuzz-zip.sh`。種 0〜3,999 と 10,000〜13,999 の 8,000 件): 8 つの束のすべてが終了コード 0 で終わった。1 件の最長は 25ms (18.5.3 に内訳)。直す前の `repackage` (`$S/out/pipe-repackage-r5.mjs`) では、種 2,000〜2,999 の束が終了コード 1 で止まった。

### 18.6 選んだ理由と、選ばなかった理由

判断の基準は、design.md の T6 の合否の基準 (指標がベースラインを下回らない、XXE と膨張を起こさない、許容的なライセンス) と、Req 1 の「シンプルさ (保守性)」である。

**HTML: htmlparser2 を採る。使うのは `Tokenizer` だけで、`Parser` は使わない**

- `Tokenizer` は、Python 版の `HTMLParser` と同じく「トークンを切り出すだけで、木も開いた要素の一覧も持たない」。そのため、Python 版の規則 (読み飛ばし・改行・セル) をそのまま写せる。32 件の追加の入力で Python 版と 1 字も違わず、タグの崩れた HTML では 602/602 (レビュアーの入力) と 1,000/1,000 (自分の入力)、5 回目のレビューの後の集まりでは 1,380/1,403 (自分) と 713/720 (レビュアー) が同じだった (18.5.1)。
- 代わりに背負うもの: Python 版と合わせるために、`Tokenizer` の `private` の値 (`recognizeSelfClosing` と `index`) を callback の中で書き換える所が 2 つある。htmlparser2 の版を上げたときに壊れうるので、その 2 つの形をテストで見張る (18.10)。htmlparser2 を使わずに Python の `HTMLParser` を写す案も考えられるが、試していない。
- 開いた要素を積む形でも、時間が入力に比例する (18.5.1。閉じない `<div>` と対応しない `</svg>` の 1MB で 26ms)。
- `Parser` は採らない。開いた要素の一覧を配列の先頭に積んで探すので、閉じない要素の多い HTML で 2 乗の時間になる (1MB で 19 秒)。また、暗黙の閉じタグを出すので、タグの崩れた HTML で Python 版と出力が違う (602 件中 112 件)。
- parse5 は採らない。HTML5 の木を組むので、svg の中の要素が外に出され、読み飛ばすべき文字が本文に出た。開いた要素を積む形で 2 乗の時間になる (10 万段の入れ子に 44 秒)。
- node-html-parser は採らない。閉じていないコメントや DOCTYPE をタグごと本文に出す。20MiB でピークの RSS が 1.1GiB になる。開いた要素を積む形で 2 乗の時間になる (閉じない `<font>x` 8 万個で 54 秒)。
- 3 つの候補の比較は `Parser` の形で行い、`Tokenizer` の形は 4 回目のレビューの後に足した。木を組む候補 (parse5・node-html-parser) と `Parser` は、どれも開いた要素の一覧を持つので、同じ 2 乗の形に弱い。

**文字コード: 部品を使わない (自前の判定 + `TextDecoder`)**

- 3 つの集まりのすべてで、Python 版と候補の部品のどれよりも正解率が高かった。(iii) の取り置きでは 99.4% (Python 版 96.6%)。
- 本番の依存とライセンスの確認が増えない。D2 の `/readyz` に出す「文字コードの判定の部品の名前」の枠も要らなくなる (Python 版の `charset-normalizer` に当たるものが無い)。
- 代わりに、点数づけの重み (40 行) を自分で持つ。重みは 1 回直した。直した後の数字は、調整に使っていない (iii) で確かめた。
- 5 回目のレビューの後に、WHATWG と Python の codec の違いで本文が化ける 2 つの形 (1 バイトの壊れた Shift_JIS、Python では狭い codec の宣言) を、共通の層で Python 版に合わせた (18.5.2)。正解率の 3 つの集まりの数は変わらなかった。
- 将来の誤判定に備える仕組み: 判定は「候補を厳密にデコードできたものの中から、それらしさの点数が高いもの」を選ぶだけである。点数を誤っても、厳密にデコードできないものは選ばれない (Python 版と同じく cp932 → latin-1 に落ちる)。
- chardet は採らない。短い Shift_JIS と EUC-JP に弱い ((ii) で 86%)。20MiB で 4 秒かかる。
- encoding-japanese は採らない。cp1252 を判定できない。EUC-JP の取り違えが多い ((iii) で 74.5%)。
- chardetng-wasm は採らない。仮想メモリを 8GiB 予約し、`RLIMIT_AS` と両立しない。2022 年から更新が無い。候補を絞れない。8 バイトの EUC-JP を取り違える。
- jschardet は採らない。ライセンスの経緯に争いがある (18.8)。
- iconv-lite は要らない。ISO-2022-JP を読めず、ほかは `TextDecoder` で足りる。

**ZIP の読み: yauzl を採る**

- 27 件すべてを、自前の CRC の確認と名前のデコードだけを足した 28 行の adapter で通した。
- 爆弾を 1MiB の上限で 2ms、RSS +0MiB で止める (流しながら読み、途中でやめられる)。
- 敵意のあるバイト列を読む部分なので、手で書いた解析 (自前は中央ディレクトリの読み取り 47 行 + 読み 32 行) より、広く使われ保守が続いている部品のほうが、見落としが少ないと判断した (推論)。自前は 27/27 を通したので、yauzl に問題が出たときの代わりにはなる。
- fflate は採らない。zip64 の大きさを読まない。flag を出さない。`unzipSync` は上限なしに展開する。結局、自前の中央ディレクトリの読み取りが要る。
- adm-zip は採らない。全部を展開してから大きさを見る (爆弾で RSS +328MiB)。同じ名前の要素で開けない。
- jszip は採らない。壊れた要素や暗号化の flag の ZIP を丸ごと拒み、`malformed` と `encrypted` の区別やそのまま渡す振る舞いを作れない。申告サイズの偽りを見つけない。

**ZIP の書き: yazl を採る**

- 3 つとも 5 件を通した。yauzl と同じ作者の対の部品で、流しながら書く API (`addReadStreamLazy`) が 10 行で使える。
- 自前の書き (33 行) も通ったが、ZIP の形式を本番のコードで手書きする量を増やさないことを優先した。テスト用の `test/fixtures/zip.ts` は D5 により本番から import できない。
- fflate の `Zip` は、200MiB を書くのに 4 倍の時間がかかった。
- yazl の弱み (5 回目のレビューの後に分かった): 書き直しの時間が要素の数の 2 乗で伸びる (4 万個で 3 秒。18.5.3)。名前を拒むときに同期的に例外を投げるので、受け手の付け方を誤るとプロセスが落ちる (18.5.3)。どちらも、要素の数の上限を先に見ることと、`try` / `catch` の後で `outputStream` を読み切ることで抑えられる。採る判断は変えない。

**XML: @xmldom/xmldom を採る**

- DOM で解析し、要素を書き換え、`XMLSerializer` で書き戻す。Python 版の ElementTree (`fromstring` → 書き換え → `tostring`) と同じ形である。adapter は 115 行で、そのうち部品を呼ぶ部分と OOXML の操作は 47 行、残りの 68 行は Python 版 (expat) と判定を合わせ、悪意のある入力を止めるための自前の検査である (18.5.7)。
- 23 件とベンチマーク・細工したファイルの比較を、すべて Python 版と同じ結果で通した。
- エンティティの宣言を拒む線は、自前の 1 行 (DOCTYPE の内部サブセットからコメント・処理命令・引用した文字列を除いた後に `<!ENTITY` があれば拒む) で defusedxml に合わせた。xmldom は外部の資源を読みに行かない (XXE の検査で、ファイルの中身が出ないことを確かめた)。billion laughs でも展開しなかった。
- xmldom は expat より緩い。誤りの報告をすべて例外にしても、壊れた XML を通すことがある (18.5.4)。自前の検査で、Python 版と通す / 拒むを比べた結果は、自分で作った 93 件のうち 92 件、2 回目のレビューのレビュアーが別に作った 92 件のうち 88 件が同じになった (18.5.4)。違いは壊れた XML とまれな文字コードの名前だけである (18.7 の 9)。この検査を持ち続けることが、xmldom を選ぶ代わりに背負う手間である。展開した名前が同じ属性は、xmldom の中で属性が上書きされるため、外からは見分けられない。
- 前処理は、悪意のある入力でも入力に比例する時間で終わるように書く必要がある。正規表現の `[\s\S]*?` で閉じていない開始の印を探す形は 2 乗の時間になった (18.5.4)。
- xmldom 自身にも、名前空間の宣言の深い入れ子で解析が 2 乗の時間になる処理がある (2026-11-06 の時点で、この形を扱う勧告は無い)。宣言の数の上限 (1,000) で止めた。xmldom の DOM は入力の 100〜600 倍のメモリを使うことがあり、子の RSS の上限で止まる (18.5.4)。この 2 つは、xmldom を選ぶ代わりに背負う手間と危うさである。それでも採るのは、Python 版の ElementTree と同じ「解析・書き換え・書き戻し」の形で、23 件の検査・判定の比較・ベンチマークをすべて同じ結果で通したからである。saxes の位置で書き換える方式なら DOM を作らないのでメモリは小さいと推論するが、試していない (18.12)。
- 書き戻しでは、DOCTYPE を消し、元の XML 宣言を UTF-8 のものに置き換える必要がある (18.5.4。saxes の位置で書き換える方式でも、元の宣言と DOCTYPE が残るので同じ処理が要る)。
- **保守と脆弱性** (GitHub Advisory Database を `gh api "/advisories?ecosystem=npm&affects=@xmldom/xmldom"` で調べた。2026-11-05):
  - xmldom への勧告は 23 件あり、そのうち 20 件は 2026 年に公開された。
  - 2026-09-08 に 14 件 (high 13・medium 1) がまとめて公開され、そのうち 0.9 系に当たるものは 0.9.11 または 0.9.12 で直っている。0.9.12 の公開は 2026-08-21 で、勧告の公開より前に直した版が出ていた。
  - 壊れた入力で時間やメモリが入力の 2 乗で増える勧告が 5 件ある (属性の重複を除く処理の 2 乗の時間 GHSA-8344-3jmq-59r6、2 乗のメモリ GHSA-965w-775f-mr7g、壊れた入力からの回復の処理の 2 乗の時間 GHSA-93r5-fhx6-vmg9、処理命令の正規表現の ReDoS GHSA-g53g-w8rj-fmg7、HTML の閉じタグによる出力の膨張 GHSA-6mj3-qw4j-hgrw)。また、書き戻しの再帰が深すぎて止まる勧告 (GHSA-2v35-w6hq-6mfw) は 0.9.10 で直っている。
  - **0.9.12 で直っていない勧告は無かった** (どの勧告の影響を受ける版の範囲も 0.9.11 以下)。
  - 勧告の多くは、DOM を組み立てて書き出す API (`createElement`・`setAttribute` など) での検査のすり抜けである。この使い方では、書き換える値は自分で作る目印 (英数字) と `visible` だけなので、当たらないと推論する。
  - 勧告がこの 1 年で多いことは、今後も版を上げる手間がかかることを意味する。3.8 では 0.9.12 より古い版を入れないこと、その後も勧告を見て上げることを引き継ぐ (18.10)。
- saxes は採らない。結果は同じだったが、元の文字列の位置で書き換える自前の層 (27 行) が要る。その層は位置の 1 字のずれで壊れた実例を作った。2022 年から更新が無い。expat より緩い点が saxes にもあるかは試していない。
- sax は採らない。saxes と同じ自前の層が要り、ライセンスの BlueOak-1.0.0 は Req 4.4 の列挙 (MIT / Apache-2.0 / BSD / ISC) に無い。
- fast-xml-parser は採らない。宣言の無いエンティティを通し、属性の中の数値の参照を読まず、書き戻しで中身の書き方が変わる。

### 18.7 Python 版との違い (Req 2.2 / 2.3 の記録)

ベンチマーク (PDF 以外) では違いが出なかった。次は、コーパスに無い入力で見つけた違いである。Req 2.3 のとおり、記録だけにする。

1. **デコードの対応表** (Python の codec と WHATWG の `TextDecoder` で、すべての 1〜3 バイトの符号を比べた。実測):

   | Python の codec | WHATWG | 同じ | Node だけ読める | Python だけ読める | 違う字になる |
   |---|---|---|---|---|---|
   | cp932 (判定のとき) | shift_jis | 11,528 | 0 | 5 (単独の 0x80・0xA0・0xFD〜0xFF) | 3 (単独の 0x1A・0x1C・0x7F の入れ替え) |
   | shift_jis (`<meta>` で宣言されたとき) | shift_jis | 8,802 | 2,725 (NEC / IBM の拡張文字) | 0 | 9 |
   | euc_jp | euc-jp | 17,378 | 478 | 0 | 7 |
   | iso2022_jp | iso-2022-jp | 8,373 | 457 | 0 | 6 |
   | cp1252 | windows-1252 | 251 | 5 (未定義の 5 バイト) | 0 | 0 |

   - 違う字になるのは、EUC-JP・ISO-2022-JP・宣言された Shift_JIS で、次の 6 字。
     - `〜` (U+301C) → `～` (U+FF5E)
     - `‖` (U+2016) → `∥` (U+2225)
     - `−` (U+2212) → `－` (U+FF0D)
     - `¢` → `￠`、`£` → `￡`、`¬` → `￢`
     - EUC-JP の JIS X 0212 のチルダ (U+007E) → `～`
   - 判定で選ばれた cp932 (Shift_JIS) では、Python も同じ `～` などになる。違いが出るのは「EUC-JP の文書」「ISO-2022-JP の文書」「`<meta charset="Shift_JIS">` の付いた HTML」である。
   - **検索への影響は無い (実測)**: devcontainer の Elasticsearch 9.3.3 の `_analyze` (index を作らないので、ディスクの上限の影響を受けずに動いた) で、GROWI の `japanese` analyzer と同じ組み合わせ (`kuromoji_tokenizer` + `icu_normalizer`) と `standard` の両方に通した。`9時〜18時`・`9時～18時`・`9時~18時` はどれも `9 / 時 / 18 / 時` になり、`A‖B` と `A∥B` は `a / b`、`5−3` と `5－3` は `5 / 3` になった。`¢£¬` と `￠￡￢`、`〜` と `～` だけの文はトークンが 0 個だった。つまり 6 字はどちらの字でも捨てられ、検索の結果は変わらない。1 回目のレビューのレビュアーも同じ結果を得ている。
   - 抽出した本文の字そのものは違うので、検索の結果の抜粋に出る字は変わる。Python 版と同じ字にしたければ、デコードした後にこの 6 字を戻す表を足せば済む (推論。試していない)。どちらが正しいかは文書を書いた道具による (JIS の規格では U+301C、Microsoft の対応表では U+FF5E)。検索に影響しないので、戻さないことを勧める。9.10 の決定で、コーパスにはこれらの字が無い。
2. **宣言された `iso-8859-1` / `latin1`**: WHATWG はこれらのラベルを windows-1252 として扱う。0x80〜0x9F が `€` などになる (Python の latin-1 は制御文字)。ブラウザと同じ振る舞いである。
3. **宣言された `ascii`**: WHATWG は `ascii` を windows-1252 のラベルとして扱い、決して失敗しない。そのままだと、`<meta charset="ascii">` の UTF-8 の日本語が化ける。Python では厳密な ascii が失敗し、判定に進む。**共通の層で Python と同じにした** (0x80 以上があれば宣言を使わない)。同じく、windows-1252 の厳密なデコードで、Python の cp1252 が拒む未定義の 5 バイト (0x81・0x8D・0x8F・0x90・0x9D) を拒むようにした。
4. **敵意のある宣言**: WHATWG の Encoding Standard には、どんな入力も 1 つの U+FFFD にする `replacement` デコーダーがあり、`iso-2022-kr`・`hz-gb-2312`・`csiso2022kr`・`iso-2022-cn`・`iso-2022-cn-ext`・`replacement` のラベルで選ばれる。ただし Node 24.21.0 の `TextDecoder` は、この 6 つのラベルをすべて知らない名前として例外にした (WHATWG の `encodings.json` のラベル 228 個を `TextDecoder` に通して確かめた。ほかのラベルは WHATWG のとおりの文字コードになった)。そのため Node では、これらの宣言は `resolveDeclared` で使われず、判定に進む。`x-user-defined` (0x80 以上を私用領域に写す) は Node でも使えるので、UTF-16 と合わせて、共通の層で宣言として使わないようにした (検査で確かめた)。
5. **1 バイトだけ壊れたファイル**: 18.5.2 の表のとおり。Shift_JIS に 0xFF は、5 回目のレビューの後に直して Python 版と同じになった。EUC-JP に 0x80 は Node 版だけが読める (Node 版のほうが読める向きの違い)。
6. **判定の標本**: Node の自前の判定は先頭の 64KiB だけを見る。charset-normalizer も標本で判定するが、取り方は違う。先頭と後ろで文字コードが違うファイルでは、結果が違いうる (未検証)。
7. **ZIP の名前**: UTF-8 の flag が無い名前は、Python の zipfile は cp437 で読む。試作は latin-1 で読んだ。OOXML の名前は ASCII なので、コーパスでは違いが出ない。`TextDecoder` に cp437 が無いので、どうするかは 6.x で決める (18.10)。
8. **HTML** (`Tokenizer` の形に、18.5.1 の 5 回目のレビューの後の直しを入れたもの): 32 件の追加の入力、レビュアーの 602 件、レビュアーの本文が消える 6 件と手書きの 19 件では違いが無かった。自分の 1,000 件と終わりのタグの 2,000 件では違いが無く、レビュアーの 720 件で 6 件 (6 回目のレビューの後。前は 7 件)、自分の 1,403 件で 23 件が違った。違いを、検索への影響で分けた (試した集まりでは、本文が消える・語が割れる・文字参照が壊れる違いは無く、Node 版だけが化けるものも無い。どちらの版も化ける違いは下の表に残る):

   | 違いの形 | 例 | Python 版 | Node 版 | 検索への影響 |
   |---|---|---|---|---|
   | 文書の末尾で閉じていない開始タグ (`…<p`。終わりのタグ `…</p<` は 6 回目のレビューの後に Python 版と同じになった) | 1,403 件と 720 件の 1 件ずつ | 何も出さない | タグの名前 (`p`) や `<` を本文の最後に出す | 本文の最後に 1 語増える。途中で切れたファイルだけで起きる |
   | `<!-->`・`<!--->` の後ろに `-->` がある形 (`<p>a</p><!-->本文--><p>b</p>`。6 回目のレビューの指摘。`$S/r7/cmt.json` で確かめた) | 6 回目のレビューの集まり | `<!-->` から後ろの `-->` までをコメントとして捨てる | `<!-->` で空のコメントとして閉じ (WHATWG と同じ)、`本文-->` を本文に出す | Node 版のほうが語が多い向きで、検索の再現率は下がらない。後ろに `-->` が無いとき (`<!-->本文`) は同じ出力 |
   | 宣言された `iso-8859-1`・`latin1` の文書の日本語 (文字コードの違い) | 1,403 件の 16 件、720 件の 5 件 | latin-1 で読んで化ける | 18.7 の 2 のとおり windows-1252 として読む。未定義の 5 バイトがあれば判定に進んで正しく読める。0x80〜0x9F は `€` などになる | Node 版のほうが読めることがある。逆 (Node 版だけが化ける) は、未定義のバイト (0x81・0x8D・0x9D) を入れた latin-1 のフランス語の HTML 4 件 (`$S/r6/latin1.json`) では起きず、4 件とも Python 版と同じ出力だった。ほかの組み合わせは試していない |
   | `big5` の宣言に EUC-JP のバイト列 | 1,403 件の 5 件 | 化ける | 化ける (先頭の 1 字だけ違う) | どちらも化ける。宣言が嘘の文書だけ |
   | EUC-JP の末尾に `0xFF 0xFE 0x80` | 1,403 件の 1 件 | latin-1 で化ける | windows-1252 で化ける (最後の 1 字だけ違う) | どちらも化ける |

   - 直したもの (直した後は、上の集まりで Python 版と同じ。18.5.1): 自己終了の形の特殊なタグ (`<script/>`・`<title/>`・`<iframe …/>` など。直す前は本文がまるごと消えた)、`/` と `>` の間に空白がある開始タグ (`<script / >`)、`<title>`・`<textarea>` の中で `<` の直後に来る文字参照 (直す前は `&amp;` が残り、`<&#12354;&#12356;` の `あい` が `&#12354;い` に割れた)、Python が捨てる数値の文字参照 (`&#1;`・`&#x10FFFF;`。直す前は制御文字が語の間に入り、`a&#1;b` の `ab` が割れた)、終わりのタグの `>` を含む引用符つきの属性 (直す前は `">` などの断片が本文に入り、引用符の中の `<script>` で後ろの本文が消えた)。
   - 4 回目のレビューの後に「残る違いは崩れたタグの中か、まれな要素の中だけ」と書いたのは誤りだった。`<script src="a.js"/>` のような、ふつうの道具が書く形で本文がまるごと消えていた (18.5.1)。
   - `Parser` の形から `Tokenizer` の形に替え、さらに 5 回目のレビューの後で直したことで、Python 版との違いは減った (Req 2.2 の記録。602 件で 112 件 → 0 件、自分の 1,000 件で 161 件 → 18 件 → 0 件、レビュアーの 720 件で 221 件 → 7 件)。Req 2.3 のとおり、退行ではないので記録だけにする。
9. **OOXML の XML** (18.5.4 で、Python 版の `ooxml_xml.parse` と 25 + 68 + 92 + 4 件、実際の XLSX / PPTX 19 個で比べた結果):

   直さずに記録だけにした違い:

   | 入力 | Python 版 | Node 版 | 影響 |
   |---|---|---|---|
   | 展開した名前が同じ属性を 2 つ持つ XML (`<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>`。入れ子の要素の中にあっても同じ) | 拒む (422 `extraction_failed`) | 通す。後の属性の値だけが残る | XML として壊れた部品なので、正しく作られた文書では起きない。Python 版で 422 になる壊れたファイルが、Node 版では書き換えて anydoc に渡され、200 になりうる (どうなるかは anydoc の読み方による。試していない) |
   | WHATWG にだけある 1 バイトの文字コードの名前の宣言 (`x-cp1252`・`x-mac-cyrillic`・`windows-874`・`iso88592`・`koi8-ru`・`mac` など。WHATWG の 1 バイトの文字コードのラベルのうち 55 個を expat が拒んだ) | 拒む (`malformed`) | 通す | XLSX (`x_whatwg_only_label`) で確かめた: Python 版は 422、Node 版は 200 で、UTF-8 のシート名を windows-1252 として読むので化ける。OOXML の部品を書く道具は UTF-8 か UTF-16 で書くのがふつうで、この名前を宣言することはまれである (推論) |
   | 同じ名前で、WHATWG と Python が別の表を指す宣言 (`iso-8859-9` 系の 7 個は WHATWG では windows-1254、Python では ISO-8859-9。`iso-8859-11`・`tis-620` は WHATWG では windows-874) | その表で読む | WHATWG の表で読む | 0x80〜0x9F のバイトの読み方だけが違う (推論。表を比べていない)。まれな宣言 |
   | 表の細かな違い (windows-1255 の 0xCA、koi8-u の 0xAE・0xBE) | 0xCA は拒む。0xAE・0xBE は別の字 | 0xCA を読む。別の字 | 1 バイトずつ全 256 バイトを比べた (`$S/out/sb-py.json`)。ほかの 1 バイトの文字コードは、下の cp125x の直しの後で全バイトが同じ |
   | Python に codec があるが WHATWG に無い 1 バイトの文字コードの宣言 (`cp437`・`mac-roman` など) | 読む | 拒む (`malformed`) | Python 版で読めるまれな部品が、Node 版で 422 になる。OOXML の部品でこの宣言を使うことはまれである (推論) |
   | DOCTYPE の `<!ATTLIST>` の既定の属性 | 要素に付く | 付かない (DOCTYPE も書き戻さない) | `state` の既定を `hidden` にした XLSX で確かめ、どちらも 3 シートが同じに出た。ほかの属性の既定で結果が変わるかは試していない。DTD に既定の属性を書く Office の文書は見たことがない (推論) |
   | 書き戻した XML のバイト列 | ElementTree の書き方 (属性の引用符は `"`、接頭辞は `register_prefixes` で保つ) | xmldom の書き方 (属性の順と元の名前空間の宣言を保つ) | バイト列は違いうる (比べていない)。anydoc を通した結果は、コーパスと細工したファイルで同じだった |
   | 名前空間の宣言が 1,000 個を超える部品 (たとえば各段で宣言する 2,500 段の入れ子) | 通す (2,500 段で 3ms) | 拒む (`limit_exceeded`) | xmldom の解析が 2 乗の時間になるのを止めるための上限 (18.5.4)。正しい OOXML の部品の宣言は多くて数個である。3 回目のレビューのレビュアーの PPTX 3 つは Python 版も anydoc の深さの上限で `limit_exceeded` になり同じだったが、XLSX (`ns40k`) は Python 版が `internal` (500)、Node 版が `limit_exceeded` (422) で違った |
   | DOCTYPE の SYSTEM の引用符の中の `&` や `&#0;` (`<!DOCTYPE r SYSTEM "a&b"><r/>`) | 通す | 拒む | 自前の検査が引用符の中も見るため。Office は DOCTYPE を書かないので記録だけにした |
   | 空要素のタグの `/` と `>` の間の空白 (`<r/ >`) | 拒む | 通す (xmldom が受け付ける) | 壊れた XML。記録だけにした |
   | DOCTYPE の SYSTEM / PUBLIC の文字列に `<!--`・`<?`・`<![CDATA[` を書き、本体に裸の `&`・本文の `]]>`・`&#0;` を持つ壊れた XML (`<!DOCTYPE r SYSTEM "<!--"><r>&</r><!-- -->` など 5 件) | 拒む (`malformed`) | 通す | Python 版と判定を合わせるための検査が、除く処理の取り違えで本体を見なくなる (18.5.4)。名前空間の数え方は除く前の本文で行うので、この手口で時間やメモリは増えない。Office は DOCTYPE を書かないので記録だけにした |
   | 本文やコメントに `xmlns=` という文字の並びが 1,000 回を超えて現れる部品 | 通す | 拒む (`limit_exceeded`) | 名前空間の宣言を除く前の本文で数えるための数えすぎ。xmldom が読む部品には利用者の文がほぼ入らず、コーパスと細工した OOXML の 2,261 部品では多くて 5 個だった |
   | 子の RSS の上限を超えるほど大きい DOM を作る壊れた XML (閉じていない開始タグの並びなど) | 拒む (`malformed`、422 `extraction_failed`) | 子の RSS の上限で止まる (`memory_exceeded`、422 `resource_limit_exceeded`) | HTTP の状態は同じ 422 で、エラーコードが違う。どの大きさから起きるかは子の中で測っていない (3.7) |

   直したもの (直した後は、上の集まりと実際のファイルで Python 版と同じ):

   | 入力 | 直す前の Node 版 | 直し方 |
   |---|---|---|
   | UTF-8 の BOM に `encoding="ISO-8859-1"` などの宣言 | 拒む | BOM の後のバイト列を、宣言の文字コードで読む (expat と同じ。Python 版は latin-1 で読むのでシート名が化け、Node 版も同じになる) |
   | UTF-8 の BOM に `encoding="US-ASCII"` の宣言 (中身は ASCII だけ) | 拒む (BOM の 3 バイトを 0x80 以上として数えた) | BOM の後のバイト列だけを見る |
   | BOM の無い UTF-16 (LE / BE。宣言が無い、`UTF-16`、または同じ向きの `UTF-16LE` / `UTF-16BE`) | 拒む | 最初の 2 バイトが `<` と 0 (または 0 と `<`) なら UTF-16 として読む。`UTF-8` の宣言は拒む (expat と同じ) |
   | windows-1250〜1258 の宣言で、Python の cp125x に定義の無いバイト (windows-1252 の 0x81 など) | 通す (WHATWG は C1 の制御文字にする) | デコードした結果に U+0080〜U+009F があれば拒む (1 バイトずつ全バイトを比べ、windows-1255 の 0xCA のほかは Python と同じになった) |
   | `l1`・`cp819`・`ibm819`・`csisolatin1`・`iso-ir-100`・`iso_8859-1` の宣言 | windows-1252 で読む | Python と同じく latin-1 で読む (WHATWG の windows-1252 のラベルのうち、Python が latin-1 にする名前をすべて並べた。`ansi_x3.4-1968` は ASCII として扱う) |
   | 本文の U+0085 (NEL) と U+2028 | `\n` に変える (xmldom の既定は XML 1.1 の改行の規則) | xmldom の `normalizeLineEndings` を、XML 1.0 の規則 (`\r\n` と `\r` だけを `\n` にする) に替える |
   | コメント・CDATA・処理命令や子の要素をまたいだ `]]` と `>` (`<r>]]<b/>></r>`、`<r>]]<!--c-->></r>`、`<r>]<b/>]></r>`) | 拒む (本文を全部つないでから `]]>` を探したため) | 本文の連続した部分ごとに探す。CDATA・コメント・処理命令を除いた所には区切りの字 (NUL) を置き、両側をつながない |

   ZIP の読み (スタブの分割の写しを通して、Python 版の `convert()` と比べた。4 回目のレビューのレビュアーの生成器 `probe/fuzz/corrupt.py` で、コーパスの PPTX と XLSX を壊した 50 個。30 個は同じ):

   | 入力 | Python 版 | Node 版 | 影響 |
   |---|---|---|---|
   | ローカルの見出しと中央ディレクトリで名前が違う要素 (`lhname`。PPTX・XLSX) | 拒む (`malformed`) | 通す (中央ディレクトリの名前で読む) | 壊れた ZIP。yauzl はローカルの見出しの名前を確かめない |
   | PPTX の中央ディレクトリの圧縮後の大きさを大きく偽る (`csize-big`) | 拒む | 通す | 壊れた ZIP。deflate の流れの終わりで読み終えるので、偽りに気づかない |
   | 中央ディレクトリの終わりの記録で、エントリの数 (`eocd-count`) や大きさ (`eocd-cdsize`) を偽る | 片方は分割、片方は 1 要素 | その逆 | どちらも文字は取れる。位置の情報 (ページ・シートの分け方) だけが違う |
   | XLSX の圧縮の方式 1・6・95・98・99 | `internal` (500。`NotImplementedError`) | `malformed` (422) | Node 版のほうが妥当な分類である |
   | 途中で切れた ZIP、データの途中を削った ZIP (8 個) | `malformed` | スタブは `internal_error` | スタブが anydoc の例外を分類しないため。anydoc の `code` は `malformed` で、本番の `office.ts` が分類すれば同じになる (確かめた) |
   | XLSX の要素の名前が `../../evil.txt`・`/abs/evil.txt`・`C:/x.txt` (4 回目のレビューのレビュアーの `add-entry.py`) | 3 シートを返す (200) | yazl が書き直しのときに `invalid relative path` / `absolute path` の `Error` を投げる。`kind` が無いので本番では `internal` (500) になる見込み。4 回目のレビューの後は「プロセスは落ちない」と書いたが、この名前の前に CRC の誤った要素があると落ちた (18.5.3)。直した後は、落ちずに拒否として返る (再現の 3 つと、ファジング 8,000 件で確かめた) | PPTX は、分割が XML の部品だけを集めて書くので、こうした名前の要素は書かず、Python 版と同じ 3 スライドになった。XLSX の扱いは 6.x で決める (18.10) |
   | 名前の末尾が `\` の要素 (`xl\`、`docs\sub\`) を持つ XLSX (`$S/r7/dirs/x-backslash-dir.bin`) | 3 シートを返す (200) | yazl が `\` を `/` に変えてから `file path cannot end with '/'` で拒み、`kind` の無い誤り (本番では 500 の見込み)。プロセスは落ちない | ZIP の名前の決まり (区切りは `/`) から外れた形。上の行と同じく 6.x の (a)/(b)/(c) で決める (18.10)。PPTX は分割が XML の部品だけを書くので同じ |
   | 中身を持つディレクトリの要素 (`data/` に `x`) の CRC-32 を偽った XLSX (`$S/r7/dirs/x-dir-with-data-badcrc.bin`) | 拒む (`malformed`、422) | 流してつなぐ書き直し (`repackage`) はディレクトリの要素を読まずに飛ばすので、CRC を確かめず書き直せる (200 の見込み)。スタブの分割の写し (要素をすべてメモリに読む) では `malformed` | 壊れた ZIP。上の `lhname`・`csize-big` と同じく Node 版が緩い向き。ディレクトリの要素に中身を持たせる道具はふつう無い (推論) |

   - 名前の末尾が `/` のディレクトリの要素 (`xl/` など) は、直す前は yazl が拒み、ディレクトリの要素を持つ正しい XLSX が 500 になった (Python 版は 200)。6 回目のレビューの後に、書き直しで飛ばすように直し、Python 版と同じ結果になった (18.5.3)。
   - 記録だけにした理由: Req 2.3 のとおり、ベンチマークに退行が無い違いは記録だけにする。上の表の違いは、どれも壊れた XML か、OOXML の部品ではまれな文字コードの名前の宣言で、正しく作られた文書の抽出の結果を変えない。WHATWG と Python の名前の対応を完全に合わせるには、200 個ほどの名前の表が要り、見合わない。展開した名前が同じ属性を見分けるには、xmldom の前に名前空間を自前で解く処理が要る。どれも契約 (API・エラーの表・設定) を変えるものではなく、Req 1.10 の手続き (契約を崩す判断) には当たらないと判断した。
10. **Python には codec があるが WHATWG にラベルが無い宣言** (HTML の `<meta charset>` と、`.xml` の XML 宣言。1 回目のレビューのレビュアーの指摘を受けて確かめた):
   - Python の codec の登録簿で、Python 版の `decode()` が宣言として使う名前は 586 個あった (別名と綴りの違いを含む)。そのうち、Node の `resolveDeclared` (18.9) が使えるのは 195 個で、101 個の codec の名前が使えなかった (`$S/probe/charset/py-labels.py`)。
   - 使えない名前の多くは綴りの違いで、判定で同じ結果に戻る。使えない名前の宣言を付けた HTML を、Python 版と Node 版に通した (実測。`$S/probe/charset/py-declared.py`):

     | 宣言 | 元の文 | Python 版 | Node 版 |
     |---|---|---|---|
     | `cp437` (DOS の米国) | Grüße aus München, café, naïve | 同じ | `Gráe aus Mnchen, caf, nave` (化ける) |
     | `cp850` (DOS の西欧) | 同上 / `Größe ÿ ñ` | 同じ | 化ける (`Gr”áe ˜ ¤`) |
     | `mac-roman` (古い Mac) | 同上 | 同じ | `GrŸ§e aus MŸnchen, cafŽ, na•ve` (化ける) |
     | `1252`、`latin9` | 同上 | 同じ | 同じ (判定で windows-1252 に戻った) |
     | `shiftjis`、`s-jis`、`ms-kanji`、`x-mac-japanese`、`u-jis`、`euc_jis_2004`、`shift_jis_2004`、`iso2022_jp_2` | 経営企画会議の議事録を共有します。 | 同じ | 同じ (判定で戻った) |
     | `cp500` (EBCDIC) | EBCDIC text | 化ける | 化ける (宣言そのものが EBCDIC で、どちらも読めない) |

   - **影響**: 化けるのは、DOS (cp437・cp850 など) と古い Mac (mac-roman など) の 1 バイトの文字コードを宣言した文書の、ASCII 以外の字だけである。ブラウザ (WHATWG) もこれらの名前を知らないので、ウェブで公開されてきた HTML にこの宣言が使われることはまれである (推論)。日本語の別名は判定で戻るので、日本語の文書には影響しない (JIS X 0213 の拡張の字を含む文書は、Shift_JIS / EUC-JP として厳密に読めず、判定の後の段に落ちる。試していない)。
   - **iconv-lite を足すかどうかの材料**: `iconv-lite` 0.7.3 (MIT。いまはテスト用の依存) は `cp437`・`cp850`・`macroman`・`mac-roman` を読める。`cp500`・`euc-jis-2004`・`shift_jis_2004`・`iso-2022-jp-2` は読めない (`encodingExists` で確かめた)。足せば DOS と Mac の文字コードは Python 版と同じになるが、本番の依存が 1 つ (`safer-buffer` を含めて 2 つ) 増える。
   - **判断**: 足さない。理由は、(1) 影響がまれな文書の ASCII 以外の字に限られ、ベンチマークには退行が無い (Req 2.3 の記録で足りる)、(2) ブラウザと同じ振る舞いである、(3) WHATWG に同じ文字コードが別名である `mac-roman` (WHATWG の `macintosh`) などは、`resolveDeclared` の別名の表に足せば部品なしで直せる (推論。試していない。6.x に引き継ぐ)。選ぶ部品を変えるものではないので、ユーザーの判断は要らないとした。

### 18.8 ライセンスと install のときに動く処理

採る部品と、その推移的な依存のすべて (`npm view <名前>@<版> dependencies` を順に辿り、入れた中身の `package.json` と LICENSE ファイルと突き合わせた。本番に入るのは 11 個。そのうち直接の依存は `htmlparser2`・`entities`・`@xmldom/xmldom`・`yauzl`・`yazl` の 5 個):

| 部品 | 何から入るか | ライセンス (registry / LICENSE ファイル) | install のときに動く処理 |
|---|---|---|---|
| `htmlparser2` 12.0.0 | 直接 | MIT / MIT | なし |
| `domhandler` 6.0.1 | htmlparser2、domutils、dom-serializer | BSD-2-Clause / BSD-2-Clause | なし |
| `domutils` 4.0.2 | htmlparser2 | BSD-2-Clause / BSD-2-Clause | なし |
| `dom-serializer` 3.1.1 | domutils | MIT / MIT | なし |
| `domelementtype` 3.0.0 | htmlparser2、domhandler、domutils、dom-serializer | BSD-2-Clause / BSD-2-Clause | なし |
| `entities` 8.1.0 | 直接 (HTML の adapter が `decodeHTML` を使う)、htmlparser2、dom-serializer | BSD-2-Clause / BSD-2-Clause | なし |
| `@xmldom/xmldom` 0.9.12 | 直接 (依存なし) | MIT / MIT | なし |
| `yauzl` 3.4.0 | 直接 | MIT / MIT | なし |
| `pend` 1.2.0 | yauzl | MIT / MIT (Expat) | なし |
| `yazl` 3.3.1 | 直接 | MIT / MIT | なし |
| `buffer-crc32` 1.0.0 | yazl | MIT / MIT | なし |
| `@types/yauzl` 3.4.0、`@types/yazl` 3.3.1 (開発用だけ) | 直接 | MIT (registry で確かめた。中身は入れていない) | — |

- 3.8 で lockfile と突き合わせるときは、この 11 個 (と開発用の 2 個) を使う。`dom-serializer` は htmlparser2 から直接ではなく domutils 4.0.2 を通して入るので、見落としやすい。
- `@xmldom/xmldom` は 0.9.12 を使い、これより古い版は使わない。0.9.11 以下には、壊れた入力で時間やメモリが 2 乗で増える勧告などが当たる (18.6)。

- 試した候補すべて (推移的な依存を含む 49 個) の `package.json` に `preinstall` / `install` / `postinstall` は無く、`binding.gyp` も無かった (`probe/audit.mjs`)。`allowBuilds` を足す必要は無い。
- **jschardet 4.x を試さずに外した理由**:
  - jschardet 4 は、Python の chardet 7 を TypeScript に移したものである (README に明記)。
  - chardet は 6.x まで LGPL-2.1 で、7.0.0 (2026 年 3 月) で書き直したとして MIT、のちに 0BSD に変えた。元の作者が「ライセンスを変える権利は無い」と異議を出している (GitHub の chardet の issue #327)。法的な結論は出ていない。
  - jschardet も 3.1.4 までは LGPL-2.1+ だった (registry で確かめた)。
  - 0BSD の表示は許容的だが、LGPL が及ぶおそれが残る。design.md の T6 の「LGPL のもの (たとえば文字コードの判定でよく使われる部品の一部) は除く」に当たると判断した。
  - 出典: [Chardet Maintainers Relicense Project Under MIT](https://letsdatascience.com/news/chardet-maintainers-relicense-project-under-mit-f0996a95)、[The chardet relicensing dispute](https://lilting.ch/en/articles/chardet-relicense-react-foundation-oss-governance)、[LWN の記事](https://lwn.net/Articles/1061466/)、[Heather Meeker の解説](https://heathermeeker.com/tag/lgpl/)。
- `sax` 1.6.1 は BlueOak-1.0.0 (許容的だが、Req 4.4 の列挙に無い)。`jszip` は「MIT または GPL-3.0」を選べる。どちらも採らないので判断は要らない。
- `chardetng-wasm` は Apache-2.0 (元の chardetng は Apache-2.0 または MIT)。採らない。

### 18.9 再現の手順と、試作のコードの要点

試作の場所: `/tmp/claude-1000/-workspace-growi--claude-worktrees-bridge-cse-01FKZr5pM7xXdNyvSTYf1mR4/1f99ff8a-c248-52fe-bb9c-21f36680853c/scratchpad/t6/` (以下 `$S`、使い捨て)。

ファイル構成:

| 場所 | 中身 |
|---|---|
| `$S/deps/` | 候補を入れた場所 (リポジトリの外。workspace に入らない) |
| `$S/probe/lib/` | 共通の自前の層 (`line-joiner.mjs`、`decode-pipeline.mjs`、`archive-guard.mjs`、`xml-bytes.mjs`、`xml-splice.mjs`、`harness.mjs`、`deps.mjs`) |
| `$S/probe/{html,charset,zip,zipw,xml}/` | 候補ごとの adapter |
| `$S/probe/checks/` | 検査 (`html`・`charset`・`zip`・`zip-writer`・`xml`) |
| `$S/probe/charset/` | 正解率の集まりを作る Python の script (`make-set.py`、`make-locale-set.py`、`make-holdout-set.py`)、`accuracy.mjs`、`corpus-table.mjs` (2.4 のファイルの表)、`table-py.py` / `table-compare.mjs` (対応表の比較)、`corrupt-py.py` (1 バイト壊れたファイル)、`cost.mjs` |
| `$S/probe/xml/strictness.py` | defusedxml に入力の一覧 (`$S/out/strict-inputs.json`、25 件) を通し、通す / 拒むを記録する |
| `$S/probe/xml60/` | Python 版の `ooxml_xml.parse` との 68 件の比較 (`gen-inputs.mjs` が入力を作り、`py-verdicts.py` が Python 版の判定を、`compare.mjs` が Node の判定と突き合わせる) |
| `$S/probe/fuzz/` | 部品ごとの悪意のある入力のファジング (`shapes.mjs` が入力を作り、`run.mjs` が 1 つを測り、`sweep.sh` が N・2N・4N を回し、`table.mjs` が表にする)、ZIP のバイト単位のファジング (`fuzz-zip.mjs`・`fuzz-zip.sh`。5 回目のレビューのレビュアーの写し。直す前の `repackage` に向けた `fuzz-zip-r5.mjs`)、壊れた ZIP の生成器 (`corrupt.py`。4 回目のレビューのレビュアーの写し) |
| `$S/probe/html/` の比較の道具 | タグの崩れた HTML の生成器 (`gen-tagsoup.mjs`)、Python 版の出力 (`py-batch.py`)、`Parser` の形と `Tokenizer` の形の比較 (`cmp-sets.mjs`)、開いた要素を積む形の時間 (`shapes-time.mjs`・`py-shapes.py`)、直す前の `Parser` の形 (`htmlparser2-parser.mjs`) |
| `$S/probe/lin/` | 悪意のある入力での時間 (`perf.mjs`、N・2N)、悪意のある XML の生成器と 1 つずつ測る道具 (`gen.mjs`・`run1.mjs`、N・2N・4N、`$S/out/sweep.jsonl`)、CDATA・コメントなどを除く走査と元の正規表現の突き合わせ (`fuzz.mjs`)、PPTX の分割の前処理の時間とピークの RSS (`split-perf.mjs`・`split-prof.mjs`・`split-hwm.mjs`)、数値の参照の多い部品のピークの RSS (`refmem.mjs`)、ZIP の書きの adapter が元の流れの失敗で落ちないこと (`writer-error.mjs`) |
| `$S/probe/charset/py-labels.py`、`py-declared.py` | Python が宣言として使える名前の一覧と、WHATWG に無い宣言を付けた HTML の Python 版の結果 |
| `$S/probe/bench/` | `stub.mjs`、`split.mjs` (PPTX / XLSX の分割の写し)、`compare-baseline.mjs`、`py-convert.py` / `diff-pages.mjs`、`py-crafted.py`、`pipe-repackage.mjs` (読みから書きへ流してつなぐ)、`html-big*.{mjs,py}`・`html-file.mjs`・`html-file-nocopy.mjs` (20MiB の HTML のピークの RSS)、`compare-crafted.mjs` (細工したファイルを Python 版の結果と比べる)、`pipe-old-structure.mjs` (直す前の流してつなぐ形。3 回目のレビューのレビュアーの `pipe-any.mjs` の写し)、`load-cost.mjs` |
| `$S/r6/` | 5 回目のレビューの後の比べ直し: HTML の 1,403 件の生成器 (`gen-html.py`)、バイト列からの比べ方 (`py-bytes.py`・`js-bytes.mjs`)、文字列の比べ方 (`str-cmp.mjs`)、違いの表示と分け方 (`show.mjs`・`classify.mjs`・`why.mjs`)、OOXML の構造を変えた 33 個の生成器 (`gen-ooxml.py`)、リポジトリの `buildZip` で CRC の誤った ZIP を作る `make-badcrc.cjs`、直す前の再現 (`red-loss.txt`・`red-zip.txt`・`red-charset.txt`)、まとめて測り直す `final.sh` |
| `$S/r7/` | 6 回目のレビューの後の比べ直し: 終わりのタグの集まりの生成器 (`gen-endtag.py`)、ディレクトリの要素の形の生成器 (`gen-dirs.py`)、時間の形 (`perf2.mjs`。レビュアーの写し)、分割と書き直しを通す `real.mjs` (レビュアーの写し)、ディレクトリの要素の時間 (`dir-perf.mjs`)、直す前の再現 (`red-endtag.txt`・`red-dir.txt`・`red-dir-rvform.txt`)、レビュアーの形を試した場所 (`rvform/`)、まとめて測り直す `final.sh` |
| 直す前の形 (6 回目のレビューの前) | `$S/probe/html/htmlparser2-r6.mjs`、`$S/probe/bench/pipe-repackage-r6.mjs`、`$S/r7/*-r6.mjs`、レビュアーの形 `$S/r7/yazl-rv8fix.mjs`・`pipe-repackage-rv8fix.mjs` |
| 直す前の形 (5 回目のレビューの前) | `$S/probe/html/htmlparser2-r5.mjs`、`$S/probe/lib/decode-pipeline-r5.mjs`、`$S/probe/charset/own-r5.mjs`、`$S/probe/bench/pipe-repackage-r5.mjs` (同じものを `$S/out/*-r5.mjs` にも置いた) |
| `$S/probe/make-fixtures.cjs` | リポジトリの細工した ZIP の生成器を swc-node で呼び、`$S/out/fixtures/*.bin` に書く |
| `$S/out/` | 結果 (`red.txt`、`green.txt`、`bench-*.{md,json}`、`py-*.json`、正解率の集まり) |

手順:

```sh
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
S=<上の場所>; R=<リポジトリ>; PY=$R/services/attachment-text-extractor/.venv/bin/python
# 1. 候補を入れる (install のときの処理を動かさない。ほかの pnpm / turbo と同時に動かさない)
cd $S/deps && echo '{"name":"t6-deps","private":true}' > package.json
npm install --ignore-scripts --save-exact htmlparser2@12.0.0 parse5@8.1.0 node-html-parser@9.0.6 \
  chardet@2.2.0 jschardet@4.1.0 encoding-japanese@2.5.0 iconv-lite@0.7.3 chardetng-wasm@1.0.2 \
  yauzl@3.4.0 yazl@3.3.1 fflate@0.8.3 adm-zip@0.6.1 jszip@3.10.2 \
  fast-xml-parser@5.12.0 saxes@6.0.0 sax@1.6.1 @xmldom/xmldom@0.9.12
node $S/probe/audit.mjs $S/deps          # licenses + install scripts of every installed package
# 2. crafted archives from the repo generators (swc-node; --import takes an absolute file URL)
REG=file://$(readlink -f $R/apps/attachment-text-extractor/node_modules/@swc-node/register)/esm/esm-register.mjs
(cd $R/apps/attachment-text-extractor && node --import $REG $S/probe/make-fixtures.cjs $S/out/fixtures)
# 3. charset sets, encoded and decoded by the Python service's own decode() (-I: PYTHONPATH ignored; path given as an argument)
$PY -I $S/probe/charset/py-bytes.py $R/services/attachment-text-extractor/src > $S/out/charset-py-bytes.json
$PY -I $S/probe/charset/make-set.py $R/services/attachment-text-extractor/src > $S/out/charset-set.json
$PY -I $S/probe/charset/make-locale-set.py $R/services/attachment-text-extractor/src $R/apps/app/public/static/locales > $S/out/charset-locale-set.json
$PY -I $S/probe/charset/make-holdout-set.py $R/services/attachment-text-extractor/src "<fr/de/es/it/pt の JSON をカンマで>" "<ja の JSON をカンマで>" "$R/.kiro/specs/*/requirements.md" > $S/out/charset-holdout-set.json
# 4. checks (each prints a PASS/FAIL matrix per candidate)
cd $S/probe/checks && for c in html charset zip zip-writer xml; do node --expose-gc --no-warnings $c.mjs; done
cd $S/probe/charset && node --no-warnings accuracy.mjs $S/out/charset-holdout-set.json
node --no-warnings corpus-table.mjs                       # Req 2.4 corpus files x detector
$PY -I $S/probe/xml/strictness.py $S/out/strict-inputs.json > $S/out/strict-py.json   # defusedxml verdicts to compare with xmldom.mjs
(cd $S/probe/bench && node --expose-gc --no-warnings pipe-repackage.mjs 512 && node --expose-gc --no-warnings pipe-repackage.mjs 100)
# XML: 68 inputs, Python's ooxml_xml.parse vs xmldom.mjs
(cd $S/probe/xml60 && node gen-inputs.mjs $S/out/xml-inputs.json && $PY -I py-verdicts.py $S/out/xml-inputs.json $R/services/attachment-text-extractor/src > $S/out/xml-py.json && node --no-warnings compare.mjs)
# hostile inputs at N and 2N, the linear stripper vs the regex it replaces, PPTX split preprocessing with 1,000-4,000 slides
(cd $S/probe/lin && node --no-warnings --stack-size=984 perf.mjs 100000 200000 && node fuzz.mjs 300000 && node --no-warnings split-perf.mjs)
# hostile inputs per component (HTML, charset, ZIP, XML) at N, 2N, 4N, one process each -> out/fuzz-sweep.jsonl
(cd $S/probe/fuzz && ./sweep.sh $S/out/fuzz-sweep.jsonl)
# HTML: Parser form vs Tokenizer form vs Python on tag soup, and the open-element shapes
(cd $S/probe/html && node gen-tagsoup.mjs $S/out/tagsoup.json && $PY -I py-batch.py $S/out/tagsoup.json $R/services/attachment-text-extractor/src > $S/out/tagsoup-py.json && node --no-warnings cmp-sets.mjs html32 tagsoup-rv6 tagsoup && node --no-warnings shapes-time.mjs htmlparser2)
# every hostile XML shape at N, 2N, 4N, one process each (N: 2,500 for the namespace shapes, 100,000 for the cap-saturating one, else 50,000)
(cd $S/probe/lin && node --no-warnings --stack-size=984 run1.mjs nsDeepRootPrefix 2500)
# corrupt ZIPs through the streaming repackage: every one must end as malformed / encrypted, never exit code 1
(cd $S/probe/bench && for f in <corrupt zips>; do node --no-warnings pipe-repackage.mjs 512 $f; done)
# 20 MiB HTML peak RSS, three times each, with and without --max-semi-space-size=4 (big.html: the html-big.mjs document written to a file)
(cd $S/probe/bench && node --no-warnings html-big.mjs htmlparser2 && node --no-warnings html-file.mjs $S/out/big.html && node --no-warnings --max-semi-space-size=4 html-file.mjs $S/out/big.html)
# hostile-shape table, and ZIP byte-level fuzzing in batches of 1,000 seeds (each batch must exit 0)
node $S/probe/fuzz/table.mjs $S/out/fuzz-sweep-r6.jsonl
(mkdir -p $S/r6/zf && cd $S/r6/zf && $S/probe/fuzz/fuzz-zip.sh 0 4000 $S/out/zin $S/out/fuzz-zip-0.txt && $S/probe/fuzz/fuzz-zip.sh 10000 14000 $S/out/zin $S/out/fuzz-zip-10000.txt)
# 5th-review HTML / charset sets: generated in Python, decoded and converted by both sides, compared
(cd $S/r6 && $PY -I gen-html.py 6 > mine6.json && $PY -I py-bytes.py mine6.json $R/services/attachment-text-extractor/src > mine6-py.json && node js-bytes.mjs mine6.json > mine6-js.json && node classify.mjs mine6.json mine6-py.json mine6-js.json && node why.mjs mine6.json mine6-py.json mine6-js.json)
# OOXML structure variants (missing parts, order, empty sheets / slides, duplicate names): Python convert() vs the stub
(cd $S/r6 && $PY -I gen-ooxml.py $S/out/zin $S/r6/ooxml > ooxml-specs.txt && $PY -I $S/probe/bench/py-crafted.py $R/services/attachment-text-extractor/src $S/r6/ooxml $(cat ooxml-specs.txt) > ooxml-py.json)
# (with the stub running) node $S/probe/bench/compare-crafted.mjs $S/r6/ooxml-py.json $S/r6/ooxml ${=$(cat $S/r6/ooxml-specs.txt)}
# 5. benchmark: stub on 18731, the unchanged runner pointed at it, compared with the baseline
XMLC=xmldom PORT=18731 node --no-warnings $S/probe/bench/stub.mjs &   # remember $! and kill only that PID afterwards
(cd $R/apps/attachment-text-extractor && node --import $REG benchmark/run-benchmark.ts --url http://127.0.0.1:18731 \
  --label t6-xmldom --token-file <600 権限のダミーのトークン> --es-url http://elasticsearch:9200 --json $S/out/bench-xmldom.json)
node $S/probe/bench/compare-baseline.mjs $S/out/bench-xmldom.json
$PY -I $S/probe/bench/py-convert.py $R/services/attachment-text-extractor/src $R/apps/attachment-text-extractor/benchmark > $S/out/py-pages.json
node $S/probe/bench/diff-pages.mjs $S/out/py-pages.json http://127.0.0.1:18731/extract
```

- 取り置きの集まりの元にした JSON: `node_modules/.pnpm/@emoji-mart+data@1.2.1/node_modules/@emoji-mart/data/i18n/{fr,de,es,it,pt,ja}.json`、`node_modules/.pnpm/yargs@17.7.3/node_modules/yargs/locales/{fr,de,es,it,pt,ja}.json`、`node_modules/.pnpm/speech-rule-engine@4.0.7/node_modules/speech-rule-engine/lib/mathmaps/{fr,de,es}.json`。
- `pnpm benchmark` ではなく `node --import …` で道具を呼んだ。pnpm が裏で install の確認を走らせないようにするため。
- swc-node は、`--import` で読み込むと scratchpad の `.mjs` まで CommonJS に変換する (名前つきの import が壊れる)。そのため、リポジトリの TypeScript の生成器は一度ファイルに書き出す形にし、検査は swc-node なしで動かした。

**採る形の全文 (6.x の実装の手本。試作のファイルをそのまま写した。コメントは英語)**

試作は `$S/deps` の部品を、次の小さな関数 (`probe/lib/deps.mjs`) を通して読む。本番では、ふつうの `import` に替える。

```js
import { createRequire } from 'node:module';
export const DEPS = new URL('../../deps/node_modules/', import.meta.url);
export const req = createRequire(new URL('../../deps/package.json', import.meta.url));
// ESM-only packages: import by absolute path of their entry.
export const esm = async (name) => import(req.resolve(name));
```

HTML の共通の層 (`probe/lib/line-joiner.mjs`。Python 版の `_LineJoiner` と `_TextExtractor` の規則の写し):

```js
// Port of the Python service's _LineJoiner (text.py): service-side code shared by every HTML candidate.
const LINE_BREAK = /\r\n?/g;
const BLANKS = /[ \t\f\v]+/g;
const LINE_EDGES = / ?\n[ \n]*/g;
export class LineJoiner {
  #out = []; #last = '\n';
  add(part) {
    let folded = part.replace(LINE_BREAK, '\n').replace(BLANKS, ' ').replace(LINE_EDGES, '\n');
    if (!folded) return;
    if (folded[0] === '\n' && this.#last === ' ') { this.#out[this.#out.length - 1] = this.#out.at(-1).replace(/ +$/, ''); this.#last = 'x'; }
    if (this.#last === '\n') folded = folded.replace(/^[ \n]+/, '');
    else if (this.#last === ' ') folded = folded.replace(/^ +/, '');
    if (!folded) return;
    this.#out.push(folded);
    const end = folded.at(-1);
    this.#last = end === '\n' || end === ' ' ? end : 'x';
  }
  result() { return this.#out.join('').replace(/[ \n]+$/, ''); }
}
export const SKIPPED = new Set(['script', 'style', 'template', 'noscript', 'svg']);
export const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'br', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'title', 'tr', 'ul']);
export const CELLS = new Set(['td', 'th']);
// Event sink with the Python handler's semantics (skip depth, block newline, cell space).
export class TextSink {
  lines = new LineJoiner(); #skip = 0;
  start(tag) { if (SKIPPED.has(tag)) this.#skip++; else this.#sep(tag); }
  end(tag) { if (SKIPPED.has(tag)) this.#skip = Math.max(0, this.#skip - 1); else this.#sep(tag); }
  text(t) { if (this.#skip === 0) this.lines.add(t); }
  #sep(tag) { if (this.#skip) return; if (BLOCKS.has(tag)) this.lines.add('\n'); else if (CELLS.has(tag)) this.lines.add(' '); }
}
```

HTML の adapter (`probe/html/htmlparser2.mjs`。htmlparser2 の `Tokenizer` だけを使う。`Parser` は使わない。Python 版の `HTMLParser` と合わせる処理を含む。18.5.1):

```js
// htmlparser2's Tokenizer alone: no open-element stack (the Parser's stack makes stray close tags cost
// O(open elements) each, quadratic overall). Python's HTMLParser keeps no stack either.
// recognizeSelfClosing: like Python, "<script/>" (and title, textarea, iframe, ...) opens no raw-text region;
// without it the rest of the document up to the next </script> is read as script.
import { esm } from '../lib/deps.mjs';
import { TextSink } from '../lib/line-joiner.mjs';
const { Tokenizer } = await esm('htmlparser2');
const { decodeHTML } = await esm('entities');
export const NAME = 'htmlparser2';
const ignore = () => {};
const RCDATA = new Set(['title', 'textarea']);
// Code points Python's html.unescape turns into '' when written as a numeric reference.
const droppedByPython = (cp) => cp <= 0x10ffff && ((cp >= 1 && cp <= 8) || cp === 0xb || (cp >= 0xe && cp <= 0x1f) || cp === 0x7f || (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe);
const NUMERIC_REFERENCE = /&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));?/g;
// The rest of an end tag after its name, in Python's grammar (html.parser.locatetagend): a quoted attribute value may
// hold ">", which htmlparser2 takes as the end of the tag.
const END_TAG_SEP = /[\t\n\r\f \/]*/y;
const END_TAG_ATTR = /(?<=['"\t\n\r\f \/])[^\t\n\r\f \/>][^\t\n\r\f \/=>]*(?:[\t\n\r\f ]*=[\t\n\r\f ]*(?:'[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?[\t\n\r\f \/]*/y;
// Same match as one regex (sep attr* >?), one attribute per exec: a single regex keeps a backtrack entry per
// attribute and throws RangeError on an end tag with ~2M attributes (4 MB).
const endTagGt = (markup, end) => {
  END_TAG_SEP.lastIndex = end; END_TAG_SEP.test(markup);
  let at = END_TAG_SEP.lastIndex;
  for (END_TAG_ATTR.lastIndex = at; END_TAG_ATTR.test(markup); END_TAG_ATTR.lastIndex = at) at = END_TAG_ATTR.lastIndex;
  return markup.charCodeAt(at) === 0x3e ? at : -1;
};
// The Tokenizer leaves a reference right after "<" inside title / textarea undecoded ("<&amp;"); every other
// reference there has already gone to ontextentity, so decoding the remaining text once is safe.
const decodeRcdataText = (text) => decodeHTML(text.replace(NUMERIC_REFERENCE, (ref, dec, hex) => (droppedByPython(dec ? Number(dec) : parseInt(hex, 16)) ? '' : ref)));
export const htmlToText = (markup) => {
  const sink = new TextSink();
  let tag = '';
  let rcdata = false;
  const tokenizer = new Tokenizer({ decodeEntities: true, recognizeSelfClosing: true }, {
    onopentagname: (start, end) => { tokenizer.recognizeSelfClosing = true; tag = markup.slice(start, end).toLowerCase(); sink.start(tag); },
    onopentagend: () => { rcdata = RCDATA.has(tag); },
    // "<br/>": the start tag above, then this end; "<svg/>" thus opens and closes its skipped region.
    // "<x / >" is a plain start tag for Python (and WHATWG); htmlparser2 alone calls it self-closing. Turning
    // recognizeSelfClosing off for this one tag makes the Tokenizer enter the raw-text region as after ">"; the
    // next start tag turns it back on.
    onselfclosingtag: (gt) => {
      if (markup.charCodeAt(gt - 1) === 0x2f) { sink.end(tag); return; }
      tokenizer.recognizeSelfClosing = false;
      rcdata = RCDATA.has(tag);
    },
    onclosetag: (start, end) => {
      const gt = endTagGt(markup, end);
      // An end tag Python's grammar does not close with ">": Python drops the rest of the document, and
      // continuing here would rescan the same tail at every later end tag (quadratic).
      if (gt < 0) { tokenizer.pause(); return; }
      rcdata = false;
      sink.end(markup.slice(start, end).toLowerCase());
      // Where Python ends this tag is past the first ">": move the Tokenizer there; it then skips to that ">".
      if (markup.indexOf('>', end) < gt) tokenizer.index = gt - 1;
    },
    ontext: (start, end) => { const text = markup.slice(start, end); sink.text(rcdata && text.includes('&') ? decodeRcdataText(text) : text); },
    ontextentity: (codePoint) => { if (!droppedByPython(codePoint)) sink.text(String.fromCodePoint(codePoint)); },
    onattribname: ignore, onattribdata: ignore, onattribentity: ignore, onattribend: ignore,
    oncomment: ignore, oncdata: ignore, ondeclaration: ignore, onprocessinginstruction: ignore, onend: ignore,
  });
  tokenizer.write(markup);
  tokenizer.end();
  return sink.lines.result();
};
```

文字コードのデコードの順 (`probe/lib/decode-pipeline.mjs`。Python 版の `charset.decode` と、`text.py` の `<meta>` / XML 宣言の読み取りの写し。判定の段は `detect` を差し込む):

```js
// Port of the Python service's charset.decode order; only the detection step is pluggable.
// BOM -> declared -> ISO-2022-JP escapes -> strict UTF-8 -> detect(restricted) -> strict cp932 -> latin-1.
// Python-strict semantics on top of WHATWG decoders: WHATWG windows-1252 never fails, Python's cp1252 rejects
// the five undefined bytes; 'ascii' is a WHATWG label for windows-1252, Python's ascii rejects bytes >= 0x80.
const CP1252_UNDEFINED = [0x81, 0x8d, 0x8f, 0x90, 0x9d];
const strict = (label, data) => {
  if (label === 'windows-1252' && CP1252_UNDEFINED.some((b) => data.includes(b))) return null;
  if (label === 'x-ascii') return data.every((b) => b < 0x80) ? new TextDecoder().decode(data) : null;
  try { return new TextDecoder(label, { fatal: true, ignoreBOM: false }).decode(data); } catch { return null; }
};
// Python's cp932 maps five single bytes that WHATWG Shift_JIS rejects (0x80, 0xA0, 0xFD-0xFF).
const CP932_SINGLE = new Map([[0x80, '\u0080'], [0xa0, '\uf8f0'], [0xfd, '\uf8f1'], [0xfe, '\uf8f2'], [0xff, '\uf8f3']]);
const isSjisLead = (b) => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
// stream: the detector's sample may end inside a character. One decoder for every run, and the runs joined in
// batches: a decoder, a concatenation or one array entry per stray byte cost 40-70 MiB per MB of input.
export const cp932 = (data, stream = false) => {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const joined = []; let batch = []; let start = 0;
  try {
    for (let i = 0; i < data.length;) {
      const single = CP932_SINGLE.get(data[i]);
      if (single === undefined) { i += isSjisLead(data[i]) ? 2 : 1; continue; }
      batch.push(decoder.decode(data.subarray(start, i)), single); start = ++i;
      if (batch.length >= 4096) { joined.push(batch.join('')); batch = []; }
    }
    batch.push(decoder.decode(data.subarray(start), { stream }));
  } catch { return null; }
  joined.push(batch.join(''));
  return joined.join('');
};
const startsWith = (data, bytes) => bytes.every((b, i) => data[i] === b);
const utf32 = (data, le) => {
  if ((data.length - 4) % 4 !== 0) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  for (let i = 4; i < data.length; i += 4) {
    const cp = view.getUint32(i, le);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
  }
  return out;
};
const BOMS = [
  [[0xef, 0xbb, 0xbf], (d) => strict('utf-8', d)],
  [[0xff, 0xfe, 0x00, 0x00], (d) => utf32(d, true)],
  [[0x00, 0x00, 0xfe, 0xff], (d) => utf32(d, false)],
  [[0xff, 0xfe], (d) => strict('utf-16le', d)],
  [[0xfe, 0xff], (d) => strict('utf-16be', d)],
];
// Python codec names that are not WHATWG labels.
const ALIASES = { cp932: 'shift_jis', ms932: 'shift_jis', windows_31j: 'shift_jis', euc_jp: 'euc-jp', eucjp: 'euc-jp', ujis: 'euc-jp', iso2022_jp: 'iso-2022-jp', cp1252: 'windows-1252' };
// Decoders a hostile <meta> must not select: 'replacement' turns the whole input into one U+FFFD.
const UNUSABLE = new Set(['replacement', 'x-user-defined', 'utf-16le', 'utf-16be']);
const ASCII_LABELS = new Set(['ascii', 'us-ascii', 'ansi_x3.4-1968', 'us', 'iso646-us', 'cp367', 'csascii']);
export const resolveDeclared = (name) => {
  const raw = name.trim().toLowerCase();
  if (ASCII_LABELS.has(raw)) return 'x-ascii';
  for (const label of [raw, ALIASES[raw.replaceAll('-', '_')], raw.replaceAll('_', '-')]) {
    if (!label) continue;
    try { const enc = new TextDecoder(label).encoding; return UNUSABLE.has(enc) ? null : enc; } catch { /* not a label */ }
  }
  return null;
};
// Python's codecs behind these labels are narrower than the WHATWG decoders (gb2312 -> GBK, euc-kr -> windows-949,
// big5 -> Big5-HKSCS): a byte pair outside Python's lead / trail ranges makes Python reject the declaration.
const GB2312 = [[0xa1, 0xf7], [[0xa1, 0xfe]]];
const EUC_KR = [[0xa1, 0xfe], [[0xa1, 0xfe]]];
const BIG5 = [[0xa1, 0xf9], [[0x40, 0x7e], [0xa1, 0xfe]]];
const PYTHON_NARROWER = new Map([['chinese', GB2312], ['csiso58gb231280', GB2312], ['gb2312', GB2312], ['iso-ir-58', GB2312], ['euc-kr', EUC_KR], ['korean', EUC_KR], ['ks-c-5601-1987', EUC_KR], ['ksc5601', EUC_KR], ['big5', BIG5], ['csbig5', BIG5]]);
const inRange = (b, [lo, hi]) => b >= lo && b <= hi;
const fitsPythonCodec = (name, data) => {
  const ranges = PYTHON_NARROWER.get(name.trim().toLowerCase().replaceAll('_', '-'));
  if (!ranges) return true;
  const [lead, trails] = ranges;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < 0x80) continue;
    if (!inRange(data[i], lead) || i + 1 >= data.length || !trails.some((t) => inRange(data[i + 1], t))) return false;
    i++;
  }
  return true;
};
const ISO2022JP_ESCAPES = [[0x1b, 0x24, 0x42], [0x1b, 0x24, 0x40], [0x1b, 0x28, 0x4a]];
const hasSeq = (data, seq) => { for (let i = data.indexOf(seq[0]); i >= 0 && i <= data.length - seq.length; i = data.indexOf(seq[0], i + 1)) if (seq.every((b, j) => data[i + j] === b)) return true; return false; };

export const CANDIDATES = ['shift_jis', 'euc-jp', 'iso-2022-jp', 'windows-1252'];

export const decodeWith = (detect) => (data, declared = null) => {
  for (const [bom, dec] of BOMS) if (startsWith(data, bom)) { const r = dec(data); if (r != null) return r.replace(/^﻿/, ''); }
  if (declared && fitsPythonCodec(declared, data)) { const enc = resolveDeclared(declared); if (enc) { const r = strict(enc, data); if (r != null) return r; } }
  if (ISO2022JP_ESCAPES.some((s) => hasSeq(data, s))) { const r = strict('iso-2022-jp', data); if (r != null) return r; }
  const u = strict('utf-8', data); if (u != null) return u.replace(/^﻿/, '');
  const guess = detect(data);
  if (guess && CANDIDATES.includes(guess)) { const r = strict(guess, data); if (r != null) return r; }
  const sj = cp932(data); if (sj != null) return sj;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('latin1');
};

// Ports of text.py's head scans (first 4096 / 256 bytes, ASCII regex on bytes).
const META = /<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]{1,64})/i;
const XMLDECL = /^\s*<\?xml\b[^>]*?encoding\s*=\s*["']([A-Za-z0-9_.:-]{1,64})["']/i;
const declaredIn = (head, re) => {
  const m = re.exec(Buffer.from(head).toString('latin1'));
  if (!m) return null;
  return /^(utf-16|utf-32|ucs-)/.test(m[1].toLowerCase().replaceAll('_', '-')) ? 'utf-8' : m[1];
};
export const htmlDeclared = (data) => declaredIn(data.subarray(0, 4096), META);
export const xmlDeclared = (data) => declaredIn(data.subarray(0, 256), XMLDECL);
```

文字コードの判定 (自前。`probe/charset/own.mjs`):

```js
// No dependency: strict-decode a sample with each candidate (TextDecoder) and score how much it looks like text.
import { cp932 } from '../lib/decode-pipeline.mjs';
export const NAME = 'own';
const CANDS = ['shift_jis', 'euc-jp', 'windows-1252'];
const SAMPLE_BYTES = 64 * 1024;
const isLower = (cp) => cp >= 0x61 && cp <= 0x7a;
const charScore = (cp, prevCp) => {
  if (cp < 0x80) return cp < 0x20 && cp !== 0x0a && cp !== 0x0d && cp !== 0x09 ? -5 : 0;
  if (cp >= 0x3041 && cp <= 0x30ff) return 3; // hiragana / katakana
  if (cp >= 0x4e00 && cp <= 0x9fff) return 2; // CJK ideographs
  if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff01 && cp <= 0xff5e)) return 1; // CJK punctuation / fullwidth
  if (cp >= 0xff61 && cp <= 0xff9f) return -2; // halfwidth katakana: typical of EUC-JP read as Shift_JIS
  if (cp >= 0xe000 && cp <= 0xf8ff) return -3; // private use (user-defined Shift_JIS rows)
  if (cp >= 0x80 && cp <= 0x9f) return -5; // C1 controls
  const runPenalty = prevCp >= 0x80 ? -1.5 : 0; // Latin-1 / cp1252 symbols are suspicious in runs (mojibake)
  if ((cp >= 0xc0 && cp <= 0xff) || '€‚„…†‡‰‹›‘’“”•–—™'.includes(String.fromCodePoint(cp))) return 0.5 + runPenalty;
  return -1 + runPenalty;
};
const score = (text, latin) => {
  let total = 0; let prev = 0; let prevPrev = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i); i += cp > 0xffff ? 2 : 1;
    total += charScore(cp, prev);
    // A kanji / kana glued to a lowercase ASCII letter is a Latin word read as a double-byte code.
    if (!latin && ((prev >= 0x3041 && (isLower(cp) || isLower(prevPrev))) || (cp >= 0x3041 && isLower(prev)))) total -= 4;
    prevPrev = prev; prev = cp;
  }
  return total;
};
export const detect = (data) => {
  const sample = data.subarray(0, SAMPLE_BYTES);
  let best = null; let bestScore = -Infinity;
  for (const label of CANDS) {
    let text;
    // stream: true so a character cut at the sample edge is not an error; the caller re-decodes all bytes strictly.
    const stream = sample.length < data.length;
    // Shift_JIS is read the way Python's cp932 reads it, so a few stray bytes do not hand the text to windows-1252.
    if (label === 'shift_jis') { text = cp932(sample, stream); if (text == null) continue; }
    else try { text = new TextDecoder(label, { fatal: true }).decode(sample, { stream }); } catch { continue; }
    const s = score(text, label === 'windows-1252');
    if (s > bestScore) { bestScore = s; best = label; }
  }
  return best;
};
```

ZIP の事前の検査 (`probe/lib/archive-guard.mjs`。`archive_guard.py` の写し。読み手は差し替えられる):

```js
// Port of archive_guard.py on top of a pluggable ZIP reader (the candidate).
// Reader contract: list(data) -> Promise<Entry[]> (throws when the bytes are not a readable ZIP);
// read(data, entry, maxBytes) -> Promise<Uint8Array> counting bytes actually inflated, throwing ConversionError.
export class ConversionError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
const utf8Ok = (raw) => { try { new TextDecoder('utf-8', { fatal: true }).decode(raw); return true; } catch { return false; } };
// CPython's zipfile refuses entries needing version > 6.3 and UTF-8-flagged names that do not decode.
const PY_MAX_EXTRACT_VERSION = 63;

export const inspectArchive = async (reader, data, requiredPart, limits) => {
  let entries;
  try { entries = await reader.list(data); } catch { return null; }
  if (entries.some((e) => e.versionNeeded != null && e.versionNeeded > PY_MAX_EXTRACT_VERSION)) return null;
  if (entries.some((e) => e.utf8Flag && e.nameRaw && !utf8Ok(e.nameRaw))) return null;
  if (entries.length > limits.entries) throw new ConversionError('limit_exceeded', 'archive has too many entries');
  const declared = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  if (declared > limits.uncompressedBytes) throw new ConversionError('limit_exceeded', 'archive expands beyond the size limit');
  if (entries.filter((e) => e.name === requiredPart).length !== 1) return null;
  // Built once: a per-read scan of the entry list makes splitting a deck of many slides quadratic.
  // Of duplicated names the last entry wins, as in CPython's zipfile.
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    read: async (name, maxBytes) => {
      const entry = byName.get(name);
      if (entry == null) throw new ConversionError('malformed', 'missing part');
      if (entry.flags != null && entry.flags & 1) throw new ConversionError('encrypted', 'archive part is encrypted');
      try {
        return await reader.read(data, entry, maxBytes);
      } catch (e) {
        if (e instanceof ConversionError) throw e;
        throw new ConversionError('malformed', `archive part could not be read (${e?.message?.slice(0, 60)})`);
      }
    },
  };
};
```

ZIP の読みの adapter (`probe/zip/yauzl.mjs`):

```js
import { crc32 } from 'node:zlib';
import { req } from '../lib/deps.mjs';
import { ConversionError } from '../lib/archive-guard.mjs';
const yauzl = req('yauzl');
export const NAME = 'yauzl';
const openZip = (data) => new Promise((res, rej) => yauzl.fromBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { lazyEntries: true, decodeStrings: false, validateEntrySizes: true, strictFileNames: false }, (e, z) => (e ? rej(e) : res(z))));
export const list = async (data) => {
  const zip = await openZip(data);
  return new Promise((res, rej) => {
    const out = [];
    zip.on('entry', (e) => {
      const utf8Flag = (e.generalPurposeBitFlag & 0x800) !== 0;
      out.push({ index: out.length, name: new TextDecoder(utf8Flag ? 'utf-8' : 'latin1').decode(e.fileName), nameRaw: e.fileName, utf8Flag, flags: e.generalPurposeBitFlag, versionNeeded: e.versionNeededToExtract & 0xff, method: e.compressionMethod, crc: e.crc32, compressedSize: e.compressedSize, uncompressedSize: e.uncompressedSize, raw: e, zip });
      zip.readEntry();
    });
    zip.on('end', () => res(out)); zip.on('error', rej); zip.readEntry();
  });
};
export const read = (data, entry, maxBytes) => new Promise((resolve, reject) => {
  entry.zip.openReadStream(entry.raw, (err, stream) => {
    if (err) return reject(new ConversionError('malformed', err.message));
    const chunks = []; let n = 0; let done = false;
    stream.on('data', (c) => { n += c.length; if (n > maxBytes) { done = true; stream.destroy(); reject(new ConversionError('limit_exceeded', 'over cap')); } else chunks.push(c); });
    stream.on('error', (e) => { if (!done) { done = true; reject(new ConversionError('malformed', e.message)); } });
    // yauzl does not check CRC-32 (its README); checked here.
    stream.on('end', () => { if (done) return; const out = Buffer.concat(chunks); if (crc32(out) !== entry.crc) reject(new ConversionError('malformed', 'CRC mismatch')); else resolve(out); });
  });
});
```

ZIP の書きの adapter (`probe/zipw/yazl.mjs`。元の流れと yazl の誤り、yazl が名前を拒む例外を、拒否として返す。ディレクトリの要素は飛ばす):

```js
import { Readable } from 'node:stream';
import { req } from '../lib/deps.mjs';
const yazl = req('yazl');
export const NAME = 'yazl';
// Every failure rejects: a source stream's error is not forwarded by yazl, and yazl's own 'error' event
// needs a listener before the first entry is added.
export const writeZip = async (entries) => {
  const z = new yazl.ZipFile(); let failed = null;
  const fail = (e) => { failed ??= e; z.outputStream.destroy(e); };
  z.on('error', fail);
  try {
    for (const e of entries) {
      // A directory entry ("xl/") holds nothing anydoc reads, and yazl refuses the name. Not addEmptyDirectory: yazl
      // writes those synchronously and recursively, and ~5,000 of them overflow the stack.
      if (e.name.endsWith('/')) continue;
      z.addReadStreamLazy(e.name, { compress: e.method !== 'stored', mtime: new Date(1980, 0, 1) }, (cb) => {
        const source = Readable.from(e.chunks);
        source.on('error', fail);
        cb(null, source);
      });
    }
  } catch (x) {
    // A name yazl refuses ("../x", "/abs", "C:/x") throws here; drain outputStream all the same.
    fail(x);
  }
  z.end();
  const chunks = [];
  try { for await (const c of z.outputStream) chunks.push(c); } catch (e) { failed ??= e; }
  if (failed) throw failed;
  return Buffer.concat(chunks);
};
```

ZIP の読みから書きへ流してつなぐ形 (`probe/bench/pipe-repackage.mjs`。XLSX の書き直しの手本。どの壊れ方でもプロセスを落とさず拒否として返す。読み書きの誤りは `kind` を持ち、yazl が拒む名前は `kind` の無い yazl の誤りのまま返す):

```js
// yauzl openReadStream piped straight into yazl addReadStreamLazy: bytes counted against a budget and CRC-32
// accumulated on the way, so no part is ever held whole. Every failure rejects (never an unhandled 'error' event):
// read and write failures with { kind }, an entry name yazl refuses ("../x", "/abs", "C:/x") with yazl's plain Error,
// whose kind is left to the caller (research.md 18.10). CLI `node pipe-repackage.mjs <budget MiB> [zip]`, defaulting to the
// 200 MiB part of bomb64.bin.
import { readFileSync } from 'node:fs';
import { Transform } from 'node:stream';
import { crc32 } from 'node:zlib';
import { req } from '../lib/deps.mjs';
const yauzl = req('yauzl'); const yazl = req('yazl');
const failure = (kind, message) => Object.assign(new Error(message), { kind });

export const repackage = async (src, budgetBytes) => {
  const zip = await new Promise((res, rej) => yauzl.fromBuffer(src, { lazyEntries: true, decodeStrings: false }, (e, z) => (e ? rej(failure('malformed', e.message)) : res(z))));
  // Listing collects every entry before any limit is checked; production stops at the entry limit (research.md 18.10).
  const entries = await new Promise((res, rej) => { const out = []; zip.on('entry', (e) => { out.push(e); zip.readEntry(); }); zip.on('end', () => res(out)); zip.on('error', (e) => rej(failure('malformed', e.message))); zip.readEntry(); });
  const out = new yazl.ZipFile(); let budget = budgetBytes; let first = null;
  const stop = (e) => { first ??= e; out.outputStream.destroy(first); };
  const fail = (e) => stop(e.kind ? e : failure('malformed', e.message));
  // Before the first addReadStreamLazy: an openReadStream error (method 9, bzip2, ...) is emitted by yazl as an
  // 'error' event synchronously from inside that call.
  out.on('error', fail);
  try {
    for (const e of entries) {
      // Directory entries are dropped as in zipw/yazl.mjs (yazl refuses the name; addEmptyDirectory recurses).
      if (Buffer.from(e.fileName).toString().endsWith('/')) continue;
      out.addReadStreamLazy(Buffer.from(e.fileName).toString(), { compress: e.compressionMethod !== 0 }, (cb) => {
        if (e.generalPurposeBitFlag & 1) return cb(failure('encrypted', 'archive part is encrypted'));
        zip.openReadStream(e, (err, rs) => {
          if (err) return cb(failure('malformed', err.message));
          let crc = 0;
          const guard = new Transform({
            transform(chunk, _enc, next) { budget -= chunk.length; if (budget < 0) return next(failure('limit_exceeded', 'over budget')); crc = crc32(chunk, crc); next(null, chunk); },
            flush(next) { next(crc === e.crc32 ? null : failure('malformed', 'CRC mismatch')); },
          });
          // pipe() does not forward source errors (corrupt deflate, yauzl's size checks): hand them to the guard.
          rs.on('error', (x) => guard.destroy(failure('malformed', x.message)));
          // yazl does not forward a source error to outputStream either; without this the output never ends.
          guard.on('error', (x) => { rs.destroy(); fail(x); });
          cb(null, rs.pipe(guard));
        });
      });
    }
  } catch (x) {
    // yazl throws on a name it refuses while earlier entries are already being read: still end and drain
    // outputStream below, so their later errors have a listener.
    stop(x);
  }
  out.end();
  const chunks = [];
  try { for await (const c of out.outputStream) chunks.push(c); } catch (x) { first ??= x; }
  if (first) throw first;
  return Buffer.concat(chunks);
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const hwm = () => Math.round(parseInt(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024);
  const budget = Number(process.argv[2] ?? 512) * 1024 * 1024;
  const src = readFileSync(process.argv[3] ?? new URL('../../out/fixtures/bomb64.bin', import.meta.url));
  const before = hwm(); const t = performance.now(); let result;
  try { result = `ok, ${(await repackage(src, budget)).length} bytes out`; } catch (e) { result = `failed (${e.kind ?? `unclassified: ${e.message}`})`; }
  console.log(`budget ${budget / 1048576} MiB: ${result}, ${(performance.now() - t).toFixed(0)} ms, VmHWM ${before} -> ${hwm()} MiB`);
}
```

XML の部品のバイト列から文字列への変換 (`probe/lib/xml-bytes.mjs`):

```js
// Bytes -> string for OOXML parts, matching what expat (behind defusedxml) accepts:
// UTF-16 (BOM, or "<" as the first code unit), UTF-8, US-ASCII, ISO-8859-1 and the other single-byte code
// pages; multi-byte code pages and unknown names are malformed, and so is a declaration contradicting UTF-16.
import { ConversionError } from './archive-guard.mjs';
const DECL = /^<\?xml\b[^>]*?\bencoding\s*=\s*(["'])([^"']*)\1/;
// WHATWG single-byte decoders (Python's expat takes any single-byte codec; multi-byte ones fail there).
const SINGLE_BYTE = new Set(['ibm866', 'iso-8859-2', 'iso-8859-3', 'iso-8859-4', 'iso-8859-5', 'iso-8859-6', 'iso-8859-7', 'iso-8859-8', 'iso-8859-10', 'iso-8859-13', 'iso-8859-14', 'iso-8859-15', 'iso-8859-16', 'koi8-r', 'koi8-u', 'macintosh', 'windows-874', 'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253', 'windows-1254', 'windows-1255', 'windows-1256', 'windows-1257', 'windows-1258', 'x-mac-cyrillic']);
// WHATWG decodes the bytes Python's cp125x leaves undefined as C1 controls; expat refuses those bytes.
const UNDEFINED_IN_PYTHON = /[\u0080-\u009f]/;
const HEAD_CHARS = 200;
const malformed = (why) => new ConversionError('malformed', why);
const strict = (label, bytes) => { try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { throw malformed(`XML part is not valid ${label}`); } };
const declaredIn = (head) => DECL.exec(head)?.[2].toLowerCase() ?? null;
const utf16Of = (b) => (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0x3c && b[1] === 0x00) ? 'utf-16le'
  : (b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0x00 && b[1] === 0x3c) ? 'utf-16be' : null;

export const decodeXmlPart = (bytes) => {
  const utf16 = utf16Of(bytes);
  if (utf16) {
    const text = strict(utf16, bytes);
    const enc = declaredIn(text.slice(0, HEAD_CHARS));
    if (enc != null && enc !== 'utf-16' && enc !== utf16) throw malformed('declaration contradicts UTF-16');
    return text;
  }
  // After a UTF-8 BOM expat still decodes the rest with the declared encoding.
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const enc = declaredIn(Buffer.from(body.subarray(0, HEAD_CHARS)).toString('latin1')) ?? 'utf-8';
  if (enc === 'utf-8' || enc === 'utf8') return strict('utf-8', body);
  // Python's ascii and latin-1, not WHATWG's (both labels mean windows-1252 there).
  if (['us-ascii', 'ascii', 'ansi_x3.4-1968'].includes(enc)) { if (body.some((b) => b >= 0x80)) throw malformed('non-ASCII byte'); return strict('utf-8', body); }
  // Every WHATWG label of windows-1252 that Python resolves to latin-1 (checked against the WHATWG label list).
  if (['iso-8859-1', 'iso8859-1', 'iso_8859-1', 'latin1', 'latin-1', 'l1', 'cp819', 'ibm819', 'csisolatin1', 'iso-ir-100'].includes(enc)) return Buffer.from(body).toString('latin1');
  let label = null;
  try { label = new TextDecoder(enc).encoding; } catch { /* not a WHATWG label */ }
  if (label == null || !SINGLE_BYTE.has(label)) throw malformed(`unsupported XML encoding ${enc.slice(0, 20)}`);
  const text = strict(label, body);
  if (label.startsWith('windows-125') && UNDEFINED_IN_PYTHON.test(text)) throw malformed(`byte undefined in ${label}`);
  return text;
};
```

CDATA・コメント・処理命令・引用符で囲まれた部分を除く 1 回の走査 (`probe/lib/strip-spans.mjs`。正規表現の置き換えと同じ結果を、入力に比例する時間で返す):

```js
// Same output as text.replace(/<o1>[\s\S]*?<c1>|<o2>[\s\S]*?<c2>|.../g, gap) for literal open/close pairs,
// in linear time: closers are found with indexOf, and a kind whose closer is missing is never searched
// again (no later opener of that kind can be closed either).
export const stripSpans = (text, kinds, gap = '') => {
  const firstChars = new Set(kinds.map(([open]) => open[0]));
  const dead = new Set(); let out = ''; let from = 0;
  for (let i = 0; i < text.length;) {
    if (!firstChars.has(text[i])) { i++; continue; }
    let next = -1;
    for (const [open, close] of kinds) {
      if (dead.has(open) || !text.startsWith(open, i)) continue;
      const end = text.indexOf(close, i + open.length);
      if (end < 0) { dead.add(open); continue; }
      next = end + close.length; break;
    }
    if (next < 0) { i++; continue; }
    out += text.slice(from, i) + gap; from = next; i = next;
  }
  return out + text.slice(from);
};
```

XML の adapter (`probe/xml/xmldom.mjs`。壊れた XML を拒む自前の検査、名前空間の宣言の数の上限、名前空間の予約の検査、エンティティの宣言の検査、DOCTYPE の削除と宣言の置き換え、スライドの一覧を 1 回だけ空にする処理を含む):

```js
import { req } from '../lib/deps.mjs';
import { stripSpans } from '../lib/strip-spans.mjs';
import { ConversionError } from '../lib/archive-guard.mjs';
const { DOMParser, XMLSerializer } = req('@xmldom/xmldom');
export const NAME = 'xmldom';
// What expat refuses but xmldom lets through even with every report thrown (measured: research.md 18.5.4).
const INVALID_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;
const BARE_AMPERSAND = /&(?!(?:[A-Za-z_:][\w.:-]*|#[0-9]+|#x[0-9A-Fa-f]+);)/;
// CDATA sections, comments and processing instructions may hold '&' and ']]>' legally.
const VERBATIM = [['<![CDATA[', ']]>'], ['<!--', '-->'], ['<?', '?>']];
const NUMERIC_REF = /&#(?:x([0-9A-Fa-f]+)|([0-9]+));/g;
const isXmlChar = (cp) => cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
const badReference = (markup) => {
  NUMERIC_REF.lastIndex = 0;
  for (let m; (m = NUMERIC_REF.exec(markup));) if (!isXmlChar(m[1] ? parseInt(m[1], 16) : Number(m[2]))) return true;
  return false;
};
// Where stripSpans removed a CDATA section, comment or PI: NUL cannot occur in XML text (INVALID_CHAR), and
// the text on both sides of the gap stays separate, as it is for expat.
const GAP = '\u0000';
// ']]>' inside one run of character data. Tags are skipped with their quoted attribute values (']]>' is legal
// there). One pass; the next ']]>' position only moves forward, so hostile markup stays linear.
const cdataEndInText = (markup) => {
  let next = markup.indexOf(']]>');
  if (next < 0) return false;
  let from = 0; let inTag = false; let quote = '';
  const inRun = (end) => { while (next >= 0 && next < from) next = markup.indexOf(']]>', next + 1); return next >= 0 && next + 3 <= end; };
  for (let i = 0; i < markup.length; i++) {
    const c = markup[i];
    if (quote) { if (c === quote) quote = ''; } else if (inTag) { if (c === '"' || c === "'") quote = c; else if (c === '>') { inTag = false; from = i + 1; } } else if (c === '<' || c === GAP) { if (inRun(i)) return true; inTag = c === '<'; from = i + 1; }
  }
  return !inTag && inRun(markup.length);
};
// xmldom chains each element's namespace map to its parent's, so every name lookup walks the declaring
// ancestors: deeply nested declarations make parsing quadratic. OOXML parts carry a handful of declarations.
// Counted on the raw text, not on the stripped markup: a '<!--' inside a DOCTYPE literal would make stripSpans
// drop the whole body while xmldom still parses it. Over-counting (text, comments) only errs toward refusing.
const MAX_NAMESPACE_DECLARATIONS = 1000;
const NAMESPACE_DECLARATION = /xmlns(?::[^\s=>/]*)?\s*=/g;
const tooManyDeclarations = (markup) => {
  NAMESPACE_DECLARATION.lastIndex = 0;
  for (let n = 0; NAMESPACE_DECLARATION.exec(markup);) if (++n > MAX_NAMESPACE_DECLARATIONS) return true;
  return false;
};
// Comments, processing instructions and quoted literals of the internal subset may mention '<!ENTITY'.
const SUBSET_VERBATIM = [['<!--', '-->'], ['<?', '?>'], ['"', '"'], ["'", "'"]];
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
// Namespace rules expat enforces and xmldom does not: reserved prefixes and duplicate expanded attribute names.
const namespaceError = (root) => {
  for (const stack = [root]; stack.length;) {
    const el = stack.pop(); const seen = new Set();
    for (const a of Array.from(el.attributes)) {
      const isDecl = a.name === 'xmlns' || a.name.startsWith('xmlns:');
      if (isDecl) {
        if (a.name === 'xmlns:xmlns' || a.value === XMLNS_NS) return true;
        if ((a.name === 'xmlns:xml') !== (a.value === XML_NS)) return true;
        continue;
      }
      const key = `${a.namespaceURI ?? ''} ${a.localName}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 1) stack.push(n);
  }
  return false;
};
export const parse = (text) => {
  const markup = stripSpans(text, VERBATIM, GAP);
  if (INVALID_CHAR.test(text) || BARE_AMPERSAND.test(markup) || cdataEndInText(markup) || badReference(markup)) throw new Error('not well-formed');
  // A limit, not malformed XML: the same files fail in the Python service on anydoc's XML depth limit.
  if (tooManyDeclarations(text)) throw new ConversionError('limit_exceeded', 'too many namespace declarations');
  const doc = new DOMParser({
    onError: (level, msg) => { throw new Error(`${level}: ${msg}`); },
    // XML 1.0 line ends only; xmldom's default also turns U+0085 / U+2028 into '\n' (XML 1.1), expat does not.
    normalizeLineEndings: (s) => s.replace(/\r\n?/g, '\n'),
  }).parseFromString(text, 'text/xml');
  if (doc.doctype && /<!ENTITY/i.test(stripSpans(doc.doctype.internalSubset ?? '', SUBSET_VERBATIM))) throw new Error('entity declarations are refused');
  if (!doc.documentElement) throw new Error('no element');
  if (namespaceError(doc.documentElement)) throw new Error('namespace error');
  // Removed once here (xmldom keeps doc.doctype pointing at the removed node, so a second removal throws).
  if (doc.doctype) doc.removeChild(doc.doctype);
  return doc;
};
// Written back as UTF-8 without the DOCTYPE (removed by parse), as Python's tostring(encoding="UTF-8", xml_declaration=True) does.
const serialize = (doc) => {
  return `<?xml version='1.0' encoding='UTF-8'?>\n${new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '')}`;
};
const kids = (el, local) => Array.from(el?.childNodes ?? []).filter((n) => n.nodeType === 1 && n.localName === local);
export const rootLocalName = (doc) => doc.documentElement.localName;
export const relationships = (doc) => kids(doc.documentElement, 'Relationship').map((e) => ({ Id: e.getAttribute('Id') ?? '', Type: e.getAttribute('Type') ?? '', Target: e.getAttribute('Target') ?? '', TargetMode: e.getAttribute('TargetMode') || 'Internal' }));
export const markSheets = (doc, token) => {
  const sheets = kids(kids(doc.documentElement, 'sheets')[0], 'sheet');
  const names = sheets.map((s) => (s.hasAttribute('name') ? s.getAttribute('name') : null));
  sheets.forEach((s, i) => { s.setAttribute('name', `ZZ${token}${i + 1}ZZ`); if (s.hasAttribute('state')) s.setAttribute('state', 'visible'); });
  return { xml: serialize(doc), names };
};
// The slide list is emptied once per document; each call puts one entry back, writes, and takes it out again,
// so one presentation is parsed once and each package costs only its own (small) serialization.
const emptiedSlideLists = new WeakMap();
export const keepOnlySlide = (doc, keep) => {
  let state = emptiedSlideLists.get(doc);
  if (state == null) {
    const list = kids(doc.documentElement, 'sldIdLst')[0];
    const ids = kids(list, 'sldId');
    ids.forEach((n) => list.removeChild(n));
    state = { list, ids };
    emptiedSlideLists.set(doc, state);
  }
  const entry = state.ids[keep];
  state.list.appendChild(entry);
  try { return serialize(doc); } finally { state.list.removeChild(entry); }
};
export const rootChildren = (doc) => Array.from(doc.documentElement.childNodes).filter((n) => n.nodeType === 1).map((n) => ({ local: n.localName, attrs: Object.fromEntries(Array.from(n.attributes).map((a) => [a.name, a.value])) }));
export const slideIds = (doc) => kids(kids(doc.documentElement, 'sldIdLst')[0], 'sldId').map((n) => Array.from(n.attributes).find((a) => a.namespaceURI?.endsWith('relationships') && a.localName === 'id')?.value ?? null);
```

正解率の集まり (i) を作った script (`probe/charset/make-set.py`。元の文を含む。Python 版の `decode()` の結果も同時に記録する):

```python
# Builds the charset accuracy set: texts encoded with Python's codecs, plus what the Python
# service's decode() returns for each (the reference behaviour).
import json, sys
sys.path.insert(0, sys.argv[1])
from app.conversion.charset import decode

JA = [
    "経営企画会議の議事録を共有します。来期の販売戦略について大阪支店から提案がありました。",
    "システム障害が発生したため、データベースサーバーを再起動しました。原因は調査中です。",
    "ご注文いただいた商品は、明日の午前中に発送いたします。お届けまで少々お待ちください。",
    "テレワーク勤務制度を新設し、セキュリティポリシーを改定する。",
    "ひらがなばかりのぶんしょうでもただしくよめるかをたしかめます。",
    "株式会社サンプル　総務部　山田太郎（内線１２３４）",
    "第３四半期の売上高は前年同期比１２％増の４５億円となった。",
    "会議資料", "日本語のテスト", "東京都", "ありがとう", "カタカナ", "了解", "議事録",
]
EU = [
    "Price: €5 – “quoted” café résumé naïve",
    "The “quarterly” report shows revenue of €1,250,000 – up 12% – and the café’s résumé.",
    "Grüße aus München – Straße, Größe, Übermaß.",
    "Très élégant, déjà vu, à la carte.",
]
MIXED = [
    "id,name,dept\n1,山田太郎,営業\n2,佐藤花子,総務\n",
    "ERROR 2026-11-05 12:00:00 接続失敗 host=db01 port=5432\n",
]
LENGTHS = [2, 4, 8, 16, 32, 64]
items = []
def add(text, enc, kind):
    try:
        data = text.encode(enc)
    except UnicodeEncodeError:
        return
    try:
        py = decode(data)
    except Exception as e:  # noqa: BLE001
        py = f"<error {e}>"
    items.append({"kind": kind, "encoding": enc, "text": text, "hex": data.hex(), "python": py})
for base in JA:
    for n in LENGTHS:
        t = base[:n]
        if len(t) < n and n != LENGTHS[0] and len(base) < n:
            continue
        for enc in ["cp932", "euc_jp", "iso2022_jp", "utf-8"]:
            add(t, enc, f"ja{len(t)}")
for t in EU:
    for enc in ["cp1252", "utf-8"]:
        add(t, enc, "eu")
for t in MIXED:
    for enc in ["cp932", "euc_jp", "iso2022_jp", "utf-8"]:
        add(t, enc, "mixed")
# de-duplicate identical (text, enc)
seen = set(); uniq = []
for it in items:
    k = (it["text"], it["encoding"])
    if k in seen: continue
    seen.add(k); uniq.append(it)
json.dump(uniq, sys.stdout, ensure_ascii=False)
```

集まり (iii) を作った script (`probe/charset/make-holdout-set.py`。(ii) の `make-locale-set.py` も同じ作りで、`apps/app/public/static/locales` の `ja_JP` を cp932・euc_jp・iso2022_jp に、`fr_FR` を cp1252 にした):

```python
# Hold-out set (never used to tune the own detector): strings of third-party fr/de/ja JSON
# locales, plus Japanese lines of this repo's .kiro/specs requirements.md files.
import glob, json, sys
sys.path.insert(0, sys.argv[1])
from app.conversion.charset import decode
def strings(o):
    if isinstance(o, str): yield o
    elif isinstance(o, dict):
        for v in o.values(): yield from strings(v)
    elif isinstance(o, list):
        for v in o: yield from strings(v)
latin, ja = set(), set()
for f in sys.argv[2].split(","):
    latin.update(s for s in strings(json.load(open(f, encoding="utf-8"))) if any(ord(c) > 127 for c in s))
for f in sys.argv[3].split(","):
    ja.update(s for s in strings(json.load(open(f, encoding="utf-8"))) if any(ord(c) > 127 for c in s))
for f in glob.glob(sys.argv[4]):
    ja.update(line.strip()[:120] for line in open(f, encoding="utf-8") if any(ord(c) > 0x3000 for c in line))
items = []
for group, encs in ((sorted(latin), ["cp1252"]), (sorted(ja), ["cp932", "euc_jp", "iso2022_jp"])):
    for s in group:
        for enc in encs:
            try: data = s.encode(enc)
            except UnicodeEncodeError: continue
            items.append({"encoding": enc, "text": s, "hex": data.hex(), "python": decode(data)})
json.dump(items, sys.stdout, ensure_ascii=False)
```


**この節のコードだけから作り直せることの確認** (2026-11-06、6 回目のレビューの後で直した版で行った):

- 1 回目のレビューのレビュアーが作った `extract.mjs` (この節のコードの囲みを順にファイルへ書き出す小さな script) で書き出し、試作と同じ置き場所の形 (`$S/rebuild7/probe/…`) に並べた。12 個の JS のファイルは、試作のファイルと 1 バイトも違わなかった。18.5.8 の 6 つの囲み (`shapes.mjs`・`run.mjs`・`sweep.sh`・`table.mjs`・`fuzz-zip.mjs`・`fuzz-zip.sh`) も同じように書き出し、1 バイトも違わなかった。
- 作り直した置き場所で動かした結果は、試作と同じだった:
  - HTML: 終わりのタグの集まり 1,000/1,000・1,000/1,000、時間の形と 4.4MB の入力の 13/13、自分のタグの崩れた 1,000 件で 1,000/1,000。`</a x=">"` を 5 万 / 10 万 / 20 万個並べた入力で 5 / 8 / 15ms。
  - ZIP: `ziprx.xlsx` とディレクトリの要素を 9,000 個持つ XLSX は、分割と `repackage` の両方で 3 シート・書き直しができ、終了コード 0。CRC の誤った要素の後に `../evil.txt` を置いた ZIP 2 つは `kind` の無い拒否で、終了コード 0。
- 検査の `checks/*.mjs`、比べる道具 (`r7/*.mjs`)、スタブの分割の写し (`bench/split.mjs`) はこの節に載せていないので、試作から写して使った。部品は `$S/deps` (18.9 の手順の 1 で入れたもの) を使った。

### 18.10 後のタスクへの引き継ぎ

- **3.6 (仮想メモリの上限)**:
  - 採った 4 つの部品は、読み込んでも `VmSize` が合わせて約 17MiB しか増えない (18.5.6。足し算の推論)。仮想メモリの上限を決める主な要因にはならない見込み。
  - chardetng-wasm のような WASM の部品は、8GiB を予約する。採らないが、将来 WASM の部品 (PDF の部品を含む) を足すときは、この増え方を測ること。
  - 20MiB の HTML の文字列を解析したときの `VmPeak` は 1,645MiB だった (htmlparser2、ふつうのプロセスで測った。素の Node から +約 270MiB。`--max-semi-space-size=4` を付けると 1,522MiB)。
- **3.7 (子の RSS と既定値)**:
  - **20MiB の HTML (`MAX_HTML_BYTES` の既定) は、`MAX_CHILD_RSS_MB` 320 の 0.95 倍 (304MiB) の境に当たる**。ファイルを読み、デコードし、解析する実際の流れのピークの RSS は、`Tokenizer` の形で、V8 のオプション無しで 296〜315MiB だった (18.5.1 の表。ふつうのプロセスで 3 回ずつ測った。`Parser` の形でも 296〜316MiB で、ほぼ同じ)。Python 版は 138MiB。子の中では anydoc などの読み込みの分がさらに加わる (未検証)。
  - V8 の新しい世代の領域を小さくする (`--max-semi-space-size=4`) と、同じ流れで 214〜219MiB (`Tokenizer` の形) に下がった。入力を 64KiB ずつデコードして流し込む形にも変えると 178〜181MiB になった (`Parser` の形で測った)。流し込むだけ (オプション無し) では 268〜284MiB で、あまり下がらなかった。
  - 3.7 では、**HTML の最大の入力 (20MiB) を基準のファイルに加え**、子の中で、`prlimit` の上限の下で測ること。子の Node に付ける V8 のオプション (`--max-semi-space-size` など) と、流し込む形にするかどうかも、そこで決める。
  - 流し込む形 ((3)。64KiB ずつデコードして `Tokenizer` に渡す) は、`Parser` の形で、5 回目のレビューの後に足した Python 版と合わせる 5 つの点 (18.5.1) が無い状態で測った。いまの adapter は、デコードした文書全体の文字列を前提にしている (`markup.slice`、`onselfclosingtag` の位置の 1 つ前の字、`endTagGt` が最初の `>` より先を読むこと、`tokenizer.index` を文書の中の位置として書き換えること)。流し込む形を選ぶときは、この 5 つの点を作り直し、18.5.1 の集まりで Python 版との比べ直しをやり直す必要がある。
  - ZIP を一覧できない XLSX (たとえば、中身の無い無圧縮の要素 1 つの申告サイズを偽ったもの) は、yauzl の一覧で失敗するので `inspectArchive` が `null` を返し、ZIP がそのまま anydoc に渡る。このときセル数・要素数・申告サイズの上限は通らない (7 回目のレビュアーの実測: 約 1MB の XLSX・30 万セルで 864ms・ピークの RSS 686MiB、200 万セルで 944ms・1,029MiB。Python 版は同じ XLSX を 20ms で `limit_exceeded` にするが、version-needed を 64 にした要素を 1 つ足すと Python 版も同じ XLSX を anydoc に渡して 764ms・676MiB を使った)。新しい種類の危険ではなく、どちらも子の RSS の上限が最後の守りになる。3.7 の測定と 6.x の分割では、「ZIP をそのまま anydoc に渡す経路はセル数の上限を通らず、RSS の上限で止まる」ことを前提にする。
  - それでも 0.95 倍の余裕が取れない場合に当たる手続き (requirements.md と tasks.md の 3.7 を読んで確かめた):
    - Req 11.11 と tasks.md の 3.7 が下げてよいとするのは、`MAX_CHILD_RSS_MB` と `MAX_XLSX_CELLS` の既定値だけで、上げることは認めない。RSS の上限を下げると、20MiB の HTML はかえって早く止められるので、この手続きでは余裕は取れない。
    - (i) 普通の 20MiB の HTML が RSS の上限で止められるなら、対象 spec の対応形式 (HTML) の AC を満たせないおそれがある。Req 11.10 と tasks.md の 3.7 の「対象 spec の AC や不変条件を満たせないことが分かったら、ユーザーに諮り、答えが research.md に記録されるまで 3.8 と 4.x に進まない」に当たる。
    - (ii) 解決の案として `MAX_HTML_BYTES` の既定値 (20MiB) を下げる場合は、Req 1.4 (環境変数を同じ名前・同じ既定値で受け付ける) を崩すことになり、Req 1.9 / 1.10 の手続き (崩すかの判断と research.md への記録) が要る。
    - 参考 (Python 版の `services/attachment-text-extractor/CLAUDE.md` の Known Limits): Python 版でも、普通の 20MiB の HTML のピークは約 245MB、属性の多い病的な HTML は 4MB で数百 MB を使い、RSS の上限で止められる (`resource_limit_exceeded`) と書いてある。
  - 文字コードの判定とデコードは、20MiB の EUC-JP でピークの RSS 121MiB。
  - **OOXML の分割と XML の解析のメモリも、子の中で測ること**。ふつうのプロセスでの実測 (18.5.4): PPTX の分割のピークの RSS は 1,000 / 2,000 / 4,000 スライドで 199 / 280 / 370MiB (Python 版は 46 / 51 / 62MiB)。3 回目のレビューのレビュアーは 8,000 シートの XLSX の分割で 352MiB (Python 版 61MiB) と測った。xmldom の DOM は入力の 100〜600 倍になることがある (兄弟の要素 2.7MB で +453MiB、閉じていない開始タグ 0.6MB で +263〜361MiB。4 回目のレビューのレビュアーは閉じていない開始タグ 1.2MB で +616MiB と測った)。ZIP のエントリ 10 万個を流してつなぐ書き直しは +231〜286MiB (18.5.8)。原因は切り分けておらず、xmldom の DOM、スタブの写しがスライドごとに部品とパッケージを作り直すこと、V8 の外のメモリが関わると推論する。
  - 3.7 では、大きなデッキ (数千スライド)、シートの多いブック (数千シート)、兄弟の要素の多い XML の部品を基準のファイルに加え、子の中で最大 RSS を測る。分割の流れを 1 つずつ開く形 (スライドごとの package を作って anydoc に渡したら、すぐに手放す。XLSX は流してつなぐ形) にできるかも確かめる。正しい文書が `MAX_CHILD_RSS_MB` で止められる大きさが分かれば、上の HTML と同じく Req 11.10 の手続きに当たる。
- **3.8 (部品を入れる)**: 次を 1 つずつ入れ、lockfile の差分がこれだけであることを確かめる。`allowBuilds` の変更は要らない。
  - 本番の依存: `htmlparser2@12.0.0`、`entities@8.1.0` (HTML の adapter が `decodeHTML` を直接使う。pnpm では直接の依存にしないと `import` できない)、`@xmldom/xmldom@0.9.12`、`yauzl@3.4.0`、`yazl@3.3.1` の 5 個。
  - 開発用の依存: `@types/yauzl@3.4.0`、`@types/yazl@3.3.1`。
  - lockfile には別の版 (htmlparser2 8.0.2 など) がすでにあるので、新しい版として加わる。推移的な依存を含めて本番に入る 11 個は 18.8 の表にある。
  - `@xmldom/xmldom` は 0.9.12 より古い版を入れない (`^0.9.12` のように下限を 0.9.12 にする)。0.9.11 以下には 2026-09-08 に公開された勧告が当たる (18.6)。入れた後も、勧告が出たら版を上げる。
  - 文字コードの部品は入れない。`iconv-lite` は今のままテスト用の依存に留める。
  - htmlparser2 12 は ESM だけで、`engines` は `node >=20.19.0`。
- **4.x (テスト)**: 18.4 の 1 の検査の入力と期待値 (Python 版のテストからの写し。`$S/probe/checks/*.mjs`) を、`conversion/text/*.spec.ts` と `conversion/ooxml/*.spec.ts` の手本に使える。
  - 次も加える: 敵意のある宣言 (`replacement` になるラベル、`ascii`)、WHATWG と Python の違い (cp1252 の未定義のバイト、latin-1 への落ち方)、書き戻した XML をもう一度解析する検査、yauzl の CRC の確認。6 回目のレビューの後に見つけた形 (`</a x=">"` の並び、属性が 200 万個の終わりのタグ、ディレクトリの要素を持つ XLSX、ディレクトリの要素を 9,000 個持つ XLSX) と、5 回目のレビューの後に見つけた形 (自己終了の形の特殊なタグ、`<x / >`、`<title>` の中の `<&`、捨てる数値の文字参照、終わりのタグの引用符の中の `>`、0xFF を含む Shift_JIS、`gb2312` の宣言の付いた Shift_JIS、CRC の誤った要素の後に yazl が拒む名前を置いた ZIP) も、Python 版の出力を期待値にして加える。
  - 文字コードの判定には、18.4 の 3 の (iii) の一部を固定のテスト素材として持つと、重みを変えたときの退行を捕まえられる (推論)。
- **6.x (変換の層の実装)**:
  - `conversion/text/charset.ts`: 18.9 の判定とデコードの順で作る。共通の層で直した点 (`ascii`、windows-1252 の未定義の 5 バイト、使わないラベル、UTF-32、`Buffer#toString('latin1')`) を落とさない。
    - Shift_JIS は、Python の cp932 と同じく単独の 0x80・0xA0・0xFD〜0xFF を 1 字として読む関数 (`cp932`) で、判定の候補と最後の段の両方を読む。WHATWG の shift_jis だけで読むと、この 5 バイトが 1 つあるだけで文書全体が windows-1252 として化ける (18.5.2)。
    - 宣言の名前が Python で gb2312・euc_kr・big5 の codec になるときは、Python の codec が受け付けるバイトの範囲を先に見て、外れていれば宣言を使わない (`fitsPythonCodec`。WHATWG はより広い GBK・windows-949・Big5-HKSCS で読んでしまう。18.5.2)。
  - 18.7 の 1 の 6 字 (`〜` など) は戻さないことを勧める (検索のトークンに影響しないと実測した)。戻さない場合は Req 2.3 の記録として残す。
  - `resolveDeclared` の別名の表に、WHATWG に同じ文字コードが別名であるもの (`mac-roman`・`macroman` → `macintosh`、`1252` などの番号だけの名前) を足すかどうかを決める (18.7 の 10。試していない)。DOS の文字コード (cp437・cp850 など) は WHATWG に無く、iconv-lite を足さない判断をした。
  - `conversion/text/html.ts`: htmlparser2 の **`Tokenizer` を直接使う** (18.9 の `html/htmlparser2.mjs`)。`Parser` は使わない (開いた要素の一覧で 2 乗の時間になる。18.5.1)。`onopentagname`・`onopentagend`・`onselfclosingtag`・`onclosetag`・`ontext`・`ontextentity` を自前の層 (`TextSink`) につなぎ、ほかの callback は何もしない。タグの名前は、渡された範囲を本文から切り出して小文字にする。次の 5 つを必ず入れる (どれかが欠けると、Python 版と出力が違い、1 つ目は本文がまるごと消える。5 つ目の読み方を誤ると、時間が入力の 2 乗になるか、例外で 500 になる。18.5.1):
    - `new Tokenizer({ decodeEntities: true, recognizeSelfClosing: true }, …)`。`recognizeSelfClosing` が無いと、`<script src="a.js"/>`・`<iframe …/>`・`<title/>` の後ろを特殊な要素の中として読む。
    - `<x / >` (`/` と `>` の間に空白) は自己終了にしない。`onselfclosingtag` に渡る位置の 1 つ前が `/` でなければ、閉じたことにせず、その 1 つのタグに限って `recognizeSelfClosing` を false にし、次の `onopentagname` で true に戻す。
    - `<title>`・`<textarea>` の中の本文に `&` が残っていれば、`entities` の `decodeHTML` でもう一度直す (`entities` は htmlparser2 の依存。本番では直接の依存に足す。8.1.0、BSD-2-Clause、install のときに動く処理は無い。18.8)。
    - Python の `html.unescape` が捨てる数値の文字参照 (`droppedByPython`) を捨てる。
    - 終わりのタグの後ろを Python 版の文法で読み (18.9 の `endTagGt`)、Python 版の終わりが最初の `>` より後ろなら、`Tokenizer` の位置を動かす。**属性は 1 つずつ sticky な正規表現で読む** (1 本の正規表現で読むと、属性が約 220 万個の終わりのタグでスタックが溢れる)。**Python 版の文法で `>` で閉じない終わりのタグでは、`tokenizer.pause()` を呼んで残りを捨てる** (Python 版と同じ。続けると、終わりのタグごとに文書の最後まで読み直し、時間が入力の 2 乗になる)。
    - 2 つ目と 5 つ目は、型定義では `private` の `recognizeSelfClosing` と `index` を書き換える。TypeScript では型の主張が要り、htmlparser2 の版を上げたときに壊れうる。**この 2 つの形 (`<title / >` と、終わりのタグの引用符の中の `>`) をテストに入れ、版を上げたときに気づけるようにする**。代わりの案 (htmlparser2 を使わず、Python の `HTMLParser` の状態の遷移を自前で写す) は試していない (推論では 300 行前後)。
    - テストには、18.5.1 の検査 33 件 (`</a x=">"` を 4 万個並べた入力を 1 秒未満、属性が 200 万個の終わりのタグで例外を出さない、の 2 件を含む) と、開いた要素を積む 4 つの形を、N と 4N の時間の比 (6 倍未満) と上限 (8 万で 1 秒未満) で入れる。18.5.1 の HTML の集まり (`$S/out/tagsoup-rv6.json`・`tagsoup.json`、`$S/r6/mine6.json`、5 回目のレビューのレビュアーの `rv7/html/mine.json` と、それぞれの Python 版の出力 `*-py.json`) も素材に使える。終わりのタグの集まり (`$S/r7/gen-endtag.py`) と、その Python 版の出力 (`$S/r7/end7-py.json`・`end8-py.json`) も使える。残る違い (18.7 の 8) は、Python 版と違う期待値として明記する。
  - `conversion/ooxml/archive-guard.ts`: Python 版と同じ振る舞いのために、次を自前で持つ。
    - version-needed が 63 より大きい要素、または UTF-8 の flag があるのに名前が UTF-8 でない要素があれば、ZIP をそのまま anydoc に渡す。
    - 暗号化の flag (bit 0) を `encrypted` にする。
    - CRC-32 を確かめる。
    - UTF-8 の flag の無い名前を cp437 で読むかどうかを決める。`TextDecoder` に cp437 は無いので、表を持つか、ASCII 以外を含む名前は一致しないものとして扱うかを選ぶ。
  - `conversion/ooxml/safe-xml.ts`: 18.9 の `xmldom.mjs` の形にする。
    - `onError` は `warning` も含めてすべて例外にする。`normalizeLineEndings` は XML 1.0 の規則 (`\r\n` と `\r` だけ) にする。
    - 解析の前に、XML で使えない字、裸の `&`、使えない字を指す数値の参照を見る。`&` と数値の参照は、CDATA・コメント・処理命令を除いてから見る。
    - CDATA・コメント・処理命令 (と DOCTYPE の中の引用符) を除く処理は、`strip-spans.mjs` の 1 回の走査で行う。`[\s\S]*?` を使う正規表現の置き換えは、閉じていない開始の印で 2 乗の時間になるので使わない (18.5.4)。
    - `]]>` は、引用符を考慮して開始タグを除いた本文だけで探す (属性の値の中の `]]>` は正しい XML)。
    - DOCTYPE の `<!ENTITY` は、内部サブセットからコメント・処理命令・引用した文字列を除いてから探す。
    - 解析の前に、**除く前の本文** で名前空間の宣言 (`xmlns` と `xmlns:…` の属性にあたる文字の並び) を数え、1,000 個を超えたら `limit_exceeded` で拒む (xmldom の解析が宣言の深い入れ子で 2 乗の時間になるため。18.5.4)。CDATA・コメントなどを除いた後の文字列で数えると、DOCTYPE の文字列の `<!--` で本体ごと除かれて抜け道になる。数えるのも、見つけた時点で止まる繰り返しで行う。
    - 安全のための検査 (使えない字、名前空間の宣言の数) は除く前の本文で、Python 版と判定を合わせるだけの検査 (裸の `&`、数値の参照、本文の `]]>`) は除いた後の文字列で行う (18.5.4 の役割分担)。後者を DOCTYPE の文字列で外せる違いは 18.7 の 9 に記録した。
    - 数値の参照の検査は、照合の結果を配列にせず、見つけた時点で止まる繰り返しで行う (配列にすると、4MB の部品でピークの RSS が 377MiB になった)。
    - `]]>` は本文の連続した部分ごとに探し、CDATA・コメント・処理命令を除いた所には区切りの字 (NUL) を置く (子の要素やコメントをまたいでつなぐと、正しい XML を拒む)。
    - 解析の後に、名前空間の予約の誤りを拒み、DOCTYPE の節を 1 回だけ消す。
    - 書き戻すときは、XML 宣言を `<?xml version='1.0' encoding='UTF-8'?>` に置き換える。
    - バイト列から文字列への変換は `xml-bytes.mjs` の線にする (BOM の無い UTF-16、UTF-8 の BOM の後の宣言、1 バイトの文字コード、cp125x の未定義のバイト)。
    - 18.5.4 の入力の集まり (`$S/out/strict-inputs.json`、`xml-inputs.json`、`xml-inputs-rv2.json`、`xml-inputs-lit.json`) と、Python 版の判定 (`strict-py.json`、`xml-py.json`、`xml-py-rv2.json`、`xml-py-lit.json`) をテストの素材に使える。残した違い (18.7 の 9) は、Python 版と違う期待値として明記する。
    - 18.5.4 の「悪意のある入力での時間」の表の入力を、時間の上限つきのテスト (N と 2N の比を見るか、4MiB で 1 秒未満など) にすることを勧める (推論。上限の値は試していない)。
  - XLSX の書き直し: yauzl の読みの流れを yazl に直接つなぐ (18.9 の `pipe-repackage.mjs` の `repackage`)。次の 6 つを必ず入れる (どれかが欠けると、壊れた要素で変換が終わらないか、子のプロセスが落ちて `crashed` (500) になる。18.5.3):
    - yazl の `ZipFile` の `'error'` の受け手を、**最初の `addReadStreamLazy` より前に**付ける (`openReadStream` の誤りは、その呼び出しの中で同期的に `'error'` として出る)。
    - 読みの流れ (`rs`) の `'error'` を `guard.destroy` に渡す (`pipe` は読みの流れの誤りを伝えない)。
    - 予算を超えたときや CRC が合わないときは、読みの流れと yazl の `outputStream` の両方を `destroy` する (yazl は入力の流れの誤りを `outputStream` に伝えない)。
    - 暗号化の flag は開く前に見て `encrypted` にする。
    - **要素を足す繰り返し (`addReadStreamLazy`) を `try` / `catch` で囲み、例外が出ても `outputStream` を壊したうえで `out.end()` と `for await` で最後まで読む**。yazl は名前を拒むとき (`../x`・`/abs`・`C:/x`) に同期的に例外を投げる。そのとき前の要素の読み取りはもう始まっていて、その後で CRC の誤りなどが出ると、読む側のいない `outputStream` の `'error'` でプロセスが落ちる (約 300 バイトの XLSX で再現した。18.5.3)。PPTX のスライドごとの package を書く `writeZip` も同じ形にする。
    - **名前の末尾が `/` の要素 (ディレクトリの要素) は書かずに飛ばす**。yazl はこの名前を拒むので、そのまま渡すと、ディレクトリの要素を持つ正しい XLSX が 500 になる。`addEmptyDirectory` で書く形は、ディレクトリの要素が 5,000 個あるとスタックが溢れてプロセスが落ちる (18.5.3)。PPTX のスライドごとの package を書く `writeZip` も同じにする。テストには、`xl/`・`xl/worksheets/` を持つ XLSX (Python の `zipfile.ZipInfo("xl/")` で作れる。`$S/r7/gen-dirs.py`) と、ディレクトリの要素を 9,000 個持つ XLSX を入れる。
  - ZIP の書き (PPTX のスライドごとの package): 18.9 の `zipw/yazl.mjs` のとおり、yazl の `'error'` と元の流れの `'error'` に受け手を付け、拒否として返す。
  - ZIP の要素の名前: yazl は `../`・`/` で始まる・`C:/` のような名前を書かずに `Error` を投げる。XLSX の書き直し (全部の要素を写す) で、こうした名前の要素があると `kind` の無い誤りになり、本番では `internal` (500) になる見込み (Python 版は 200。18.7 の 9)。名前の末尾が `\` の要素 (`xl\`) も、yazl が `\` を `/` に変えてから拒むので、同じく `kind` の無い誤りになる (Python 版は 200。ZIP の名前の決まりから外れた形。18.5.3)。名前の末尾が `/` の要素は、上の 6 つ目のとおり飛ばすので、ここには入らない。扱い方は 6.x で次から選ぶ: (a) 名前を確かめて、こうした要素は書き直しで読み飛ばす (anydoc は workbook.xml からたどれる部品しか読まないので、結果は変わらない見込み。推論)、(b) `malformed` として拒む、(c) `kind` を付けて投げる。Python 版に近いのは (a) である。PPTX の分割は XML の部品だけを書くので、この問題は起きない (確かめた)。
    - 試作 (18.9) は、名前の誤りに `kind` を付けずに yazl の `Error` のまま拒否として返す。どの `kind` にするかは決めていない。
    - **(b) か (c) を選ぶと、Python 版で 200 だった XLSX が 422 か 500 になるので、Req 1.9 / 1.10 の手続き (契約を崩すかの判断と research.md への記録) が要る**。(a) なら Python 版と同じ 200 になる見込み (推論)。
    - どれを選んでも、プロセスが落ちないことをテストで確かめる。素材は、リポジトリのテスト用の生成器 `test/fixtures/zip.ts` の `buildZip` で作れる (`$S/r6/make-badcrc.cjs`): 1 つ目の要素は `xl/workbook.xml` (中身は `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>`) を `deflated: { body: deflateRawSync(wb), crc32: crc32(wb) ^ 1, uncompressedSize: wb.length }` で渡して CRC-32 を 1 ビット違え、2 つ目は名前が `../evil.txt`・中身 `x` の無圧縮の要素にする。この 312 バイトの ZIP で、直す前の形は 3 回とも終了コード 1 で落ち、直した後は 3 回とも拒否として返った (実測)。2 つ目を `C:/x.txt` にしたものと、1 つ目の CRC を正しくしたものも足す。
  - ZIP の一覧: yauzl の一覧は、試作ではエントリをすべて集めてから数の上限を見る。本番では、エントリの数が `MAX_ARCHIVE_ENTRIES` を超えた時点で読みをやめる (3 回目のレビューのレビュアーの実測: 20 万エントリで 317MiB、Python 版 171MiB)。
  - yazl の書き直しの時間は、要素の数の 2 乗で伸びる (`pumpEntries` が、まだ終わっていない最初の要素を一覧の先頭から探すため。4 万個で 2.9〜3.0 秒。18.5.3)。**要素の数の上限 (`MAX_ARCHIVE_ENTRIES`、既定 10,000) は、書き直しより前に見る** (既定の上限では 0.4 秒・+140MiB)。上限の既定を上げるときは、この伸び方を測り直す。
  - **18.9 のコードのファイルごとの見直し** (3 回目のレビューの後、(i) 悪意のある入力で 2 乗の時間になる所、(ii) 受け手の無い `'error'` や捕まえていない例外、(iii) メモリが入力の何倍になるか、をソースを読んで洗い出し、測れるものは測った):

    | ファイル | (i) 2 乗の時間 | (ii) 誤りの扱い | (iii) メモリ | 対応 |
    |---|---|---|---|---|
    | `line-joiner.mjs` | 無し (空白は先にまとめる。HTML の悪意のある形で比例を実測) | 例外を出さない | 出力の 2〜3 倍 (部品の配列と最後の `join`。推論) | そのまま |
    | `html/htmlparser2.mjs` | **`Parser` の形は開いた要素の一覧で 2 乗だった。`Tokenizer` の形に直した**。**5 回目のレビューの後に足した終わりのタグの読み方が、`>` で閉じない終わりのタグの並びで 2 乗だった (4 万個で 22 秒)。6 回目のレビューの後に、閉じないタグで残りを捨てる形に直した**。開いた要素を積む形、終わりのタグの 5 つの形、`<title>` の中の `<&`、`<x / >` を含め 18 種類の形で比例 (実測。18.5.1、18.5.8) | **1 本の正規表現で終わりのタグを読む形は、属性が約 220 万個のタグで `RangeError` を投げた。属性を 1 つずつ読む形に直した**。いまの形で例外は見つかっていない (試した形の中で) | 20MiB で約 250MiB 増 (18.5.1) | 3.7 で子の中で測る。`private` の 2 つの値を書き換えるので、版を上げたときにテストで確かめる |
    | `decode-pipeline.mjs` | 無し (宣言の読み取りは先頭だけ、ESC は `indexOf`、`cp932` と `fitsPythonCodec` は 1 回の走査。実測) | `TextDecoder` の例外は捕まえる | 文字コードを試すたびに文字列を作る (入力の 2 倍程度を数回。推論)。20MiB で 121MiB。`cp932` は、壊れたバイトで区切った部分を 4,096 個ずつまとめてつなぐ。最初の形 (区切りごとに `TextDecoder` を作り、文字列を `+=` でつなぐ) は、0xFF を 1 字おきに置いた Shift_JIS で入力 1MB あたり約 70MiB を使い、21MB で +577MiB・4.7 秒だった。1 つの `TextDecoder` を使い回し、部分を配列に集めて 1 回でつなぐ形でも +869MiB (小さな文字列が 1,400 万個残る)。まとめてつなぐ形で +116MiB・1.0 秒になった (20MiB の EUC-JP の 121MiB と同じ程度。実測) | 1 バイトの壊れた Shift_JIS と、狭い codec の宣言を、5 回目のレビューの後に Python 版に合わせた |
    | `charset/own.mjs` | 無し (先頭 64KiB だけ) | 捕まえる | 64KiB 分だけ | Shift_JIS の候補を `cp932` で読むように直した |
    | `archive-guard.mjs` | 無し (名前の `Map`) | 読みの誤りは `ConversionError` に包む | エントリの一覧 | そのまま |
    | `zip/yauzl.mjs` | 無し | 一覧と読みの誤りは拒否に、読みの流れの `'error'` は受け止める | 一覧はエントリを全部集める。読みは要素を上限までメモリに持つ (Python 版の `read_part` と同じ) | 6.x で上限を超えた時点で一覧をやめる |
    | `zipw/yazl.mjs` | yazl の中で要素の数の 2 乗 (`pumpEntries`。PPTX のスライドごとの package は要素が少ないので当たらない) | **直した** (受け手が無く落ちていた。5 回目のレビューの後に、名前の例外でも `outputStream` を読み切る形にそろえた。6 回目のレビューの後に、ディレクトリの要素を飛ばすようにした。`addEmptyDirectory` は yazl の中の再帰で 5,000 個からスタックが溢れる) | 出力の ZIP をメモリに持つ (Python 版と同じ) | — |
    | `bench/pipe-repackage.mjs` | **yazl の中で要素の数の 2 乗** (4 万個で 3 秒。要素の数の上限で先に断る。18.5.3)。ディレクトリの要素は書かないので当たらない (4 万個で 129ms) | **直した** (受け手が無く落ちていた。5 回目のレビューの後に、名前の例外の後で前の要素の誤りが出る形も直した。6 回目のレビューの後に、ディレクトリの要素で正しい XLSX が 500 になる形を直した) | 要素を持たず流す (200MiB の要素で +23MiB)。要素 1 万個で +140MiB | 6.x で要素の数の上限を書き直しの前に見る |
    | `xml-bytes.mjs` | 無し (宣言は先頭 200 字だけ) | `ConversionError` を出す | 文字列を 1 つ作る | そのまま |
    | `strip-spans.mjs` | 無し (乱数の文字列で正規表現と同じ結果、悪意のある形で比例を実測) | 例外を出さない | 出力の文字列 1 つ | そのまま |
    | `xml/xmldom.mjs` | **名前空間の深い入れ子で 2 乗 (xmldom の中)。宣言の数の上限で止めた。数えるのは除く前の本文で、DOCTYPE の文字列の抜け道も塞いだ**。ほかの 30 種類と、部品ごとのファジングの 9 種類の形は比例 (実測) | 解析の誤りは `Error` (名前空間の上限は `limit_exceeded`)。書き戻し (`markSheets`・`keepOnlySlide`) の例外は、呼び出し側が `internal` にする (Python 版で予期しない例外が `internal` になるのと同じ) | DOM が入力の 100〜600 倍になることがある (実測)。数値の参照の検査は直した | 3.7 で子の中で測る |
  - XLSX のセル数の数え方と `.xml` のテキスト化は、Python 版と同じくバイト列 / 文字列の走査で行い、XML の部品は使わない。
  - 試作の `pptx_split` / `xlsx_split` の写し (`$S/probe/bench/split.mjs`) は、コーパスと細工したファイルで Python 版と同じ結果になった。ただし、セル数の事前の検査、予算の細かな扱い、例外の分類は入っていない。
  - PPTX の分割は、スライドの数の 2 乗にならない形で書く (18.5.4 の表)。presentation.xml は 1 回だけ解析し、スライドの一覧を 1 回だけ空にして、スライドごとに 1 つを入れて書き戻す。ZIP の要素は名前の `Map` で引く (`archive-guard.mjs`)。除く部品の集まりをスライドごとに作り直さない。Python 版の写しをそのまま書くと、Python では速い集まりの演算が Node では遅く、1,000 スライドで 7.8 秒かかった (直す前の試作)。
- **D2 (`/readyz` の `dependencies`) の T6 の分: ユーザーが決めた (2026-11-06)。T6 の部品の名前は出さない (「出さない: 重い部品だけ」)**。
  - 決定: `dependencies` に出す名前は `@firecrawl/anydoc`、PDF の部品 (T1 の結果の実名。14 節の `@embedpdf/pdfium`)、`prlimit`、`converter` の 4 つ。T6 の部品 (`htmlparser2`・`@xmldom/xmldom`・`yauzl`・`yazl`) は名前で出さず、`converter` にまとめる。これらが子で読み込めなかったときは `converter` を `missing` にする。
  - ユーザーが挙げた理由:
    - 4 つとも純 JavaScript で、サーバーが起動していれば必ず読み込めている。名前で出しても、運用者に新しい情報にならない。
    - Python 版も、重い部品 (`anydoc`・`pypdfium2`・`charset-normalizer`) だけを名前で出し、子が読み込むそのほかの部品 (`defusedxml` を含む) は `converter` にまとめていた (Python 版の `routers/health.py` の `_PUBLIC_NAMES`)。
    - 認証なしで呼べる口 (`/readyz`) に出す情報が増えない。
  - T6 では文字コードの判定に部品を使わないので、design.md の D2 の「文字コードの判定などに部品を使う場合は『T6 の結果の実名』」に当たる名前も無い。Python 版の `charset-normalizer` が出なくなることは、research.md の 7.3 の記録と合う。
  - 引き継ぎ: 6.x の `/readyz` の実装と、port-back (Req 12) で、この決定を design.md の D2 (と §HealthRouter の `dependencies` の記述) に反映する。この作業では design.md を変えていない。
- **6.11 / 6.12 (image)**:
  - `node:24-slim` の Node が full ICU かどうかは、devcontainer に docker が無く確かめていない。
  - 公式の Node のビルドは full ICU が既定なので同じと推論するが、image の中で `new TextDecoder('euc-jp')` と `new TextDecoder('iso-2022-jp')` が例外にならないことを確かめること。small ICU だと、Shift_JIS などのデコーダーが無いおそれがある。

### 18.11 RED (選定の前の状態と、最初に失敗した試作)

- **選定の記録が無い状態**: 作業の前に `grep -n "^## 18" research.md` の結果は 0 件 (終了コード 1)。
- **検査を先に書き、候補が 1 つも無い状態で動かした** (`$S/out/red.txt`): HTML 3 候補 0/21、文字コード 4 候補 0/44、ZIP 5 候補 0/27、XML 4 候補 0/22 (すべて `not implemented`)。
- **最初に失敗した試作**:
  - 文字コードの共通の層の最初の版: `ascii` の宣言で UTF-8 の日本語が化けた。未定義のバイトを含む入力が latin-1 に落ちなかった。WHATWG と Python の厳密さの違いで、直した (18.7 の 3)。
  - 自前の判定の 1 回目: fr_FR の cp1252 で 397/1,092 (18.5.2)。20MiB でピークの RSS 819MiB。
  - saxes の位置の 1 字のずれで、書き戻した XLSX と PPTX がベンチマークで全滅した (xlsx の語句 0/6、pptx は失敗)。XML の検査に「書き戻した結果をもう一度解析する」件を足すと、この検査が saxes で失敗した。直した後は通った。
  - parse5 の svg と 10 万段の入れ子、node-html-parser のタグの漏れ、fflate の zip64、adm-zip の同じ名前と爆弾、jszip の 9 件、fast-xml-parser の 3 件 (18.5)。
  - xmldom の最初の adapter (`warning` を無視): defusedxml が拒む 25 件の入力のうち 6 件を通した (18.5.4 の表)。すべて例外にすると 4 件、自前の検査を足すと 0 件になった。検査のうち `&` と `]]>` は、最初はコメントと処理命令の中まで見て、正しい XML を拒んでいた (入力を足して見つけ、直した)。
  - xmldom の最初の書き戻し: UTF-16 の部品を持つ PPTX で、宣言が `encoding="UTF-16"` のまま中身が UTF-8 になり、anydoc が失敗した (Python 版は読めた)。宣言を置き換えて直した。
  - 読みから書きへ流してつなぐ最初の版: 予算を超えても止まらず、出力を待ち続けた (18.5.3)。
- **1 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - xmldom の adapter (`$S/out/xmldom-v2.mjs`) は、Python 版との 68 件の比較で 12 件の判定が違った (うち 6 件は正しい XML を拒むもの)。レビュアーの入力に 8 件を足して自分でも再現し、直した後は 67/68 になった (18.5.4)。
  - 20MiB の HTML のピークの RSS の「`--max-semi-space-size=4` で 177MiB」は、測った形 (64KiB ずつ流し込む形) を書いていなかった。実際の流れでは 205〜223MiB で、オプション無しでは 296〜316MiB と 0.95 倍の境に当たる (18.5.1)。
  - 6 字の対応表の違いが検索に影響するという推論は誤りだった (`_analyze` で確かめた。18.7 の 1)。
  - WHATWG にラベルが無い宣言 (cp437 など) の違いを書き漏らしていた (18.7 の 10)。
  - 依存の表に `dom-serializer` が抜けていた (18.8)。
- **2 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - **CDATA・コメント・処理命令を除く正規表現の置き換えが、入力の 2 乗の時間だった** (`$S/out/xmldom-v3.mjs`)。閉じていない `<!--` 5 万個で 1,355ms、10 万個で 5,427ms (自分で再現した)。レビュアーは、presentation.xml に閉じていない `<!--` を 10 万個入れた 6.8KB の PPTX で、Python 版 1ms に対しスタブが 4,418ms かかることを示した。18.5.4 で測った性能の入力は、この正規表現に当たる形を含んでいなかった。1 回の走査に置き換え、同じ PPTX は 15ms になった。
  - ソースを読み直して、**PPTX の分割の前処理がスライドの数の 2 乗だった** ことを自分で見つけた。1,000 スライドで 7,794ms、2,000 スライドで 38,516ms (Python 版は 588ms・1,949ms)。直した後は 685ms・1,168ms。
  - XML の判定の違いは、1 回目の後に書いた「93 件中 1 件」だけではなかった。レビュアーが別に作った 92 件では 9 件が違った (直す前)。そのうち、UTF-8 の BOM と宣言、BOM の無い UTF-16、cp125x の未定義のバイト、`l1` などの名前、本文の U+0085 / U+2028 を直し、4 件の違いが残った (18.7 の 9)。
  - DOCTYPE を消す処理を書き戻しのたびに行う形は、presentation.xml を 1 回だけ解析する形に直した後、DOCTYPE を持つ PPTX で例外になった (xmldom は消した後も `doc.doctype` が消した節を指したまま)。23 件の XML の検査は通っていて、実際のファイルを Python 版と比べる手順 (`compare-crafted.mjs`) で見つけた。消す処理を解析の直後の 1 回に移して直した。
  - 3.7 への引き継ぎが、当てはまらない手続き (Req 11.11) を指していた (18.10 の 3.7)。
  - xmldom の勧告の内訳を「high 12・medium 2」と書いていた。正しくは high 13・medium 1 (18.6)。
  - 20MiB の HTML の (2) と (2') の差の原因を推論のままにしていた。コピーの有無で測り、実測にした (18.5.1)。
  - Node 24.21.0 の `TextDecoder` は WHATWG の `replacement` のラベルを知らない (例外にする) のに、18.7 の 4 で「`replacement` デコーダーで選ばれる」と書いていた。
  - 18.1・18.5.1・18.7 に、直す前の値や推論の経緯を書いていた。この節 (18.11) に寄せた。前の版の 18.5.1 は「`--max-semi-space-size=4` で 177MiB」と、測った形 ((3) の流し込む形) を書かずに載せていた。18.7 の 1 は「Python 版は `〜` で、Node 版は `~` で検索に当たる」と推論していたが、`_analyze` で誤りと分かった。
- **3 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - **xmldom 0.9.12 自身が、名前空間の宣言を深く入れ子にした文書で解析が 2 乗の時間になる**。直す前の形 (`$S/out/xmldom-v4.mjs`) は、深さ 2,500 / 5,000 / 10,000 で 75 / 266 / 975ms (自分で再現した。Python 版は 3 / 5 / 10ms)。レビュアーは 14KB の PPTX で 32,848ms、5KB の XLSX の書き戻しでメモリ不足を示した。2 回目の後に書いた「悪意のある入力は、どれも入力の大きさに比例」は、自前の前処理だけを測った結果で、xmldom の中の 2 乗を見ていなかった。宣言の数の上限を入れ、30 種類の形を N・2N・4N で測り直した (18.5.4)。
  - **ZIP の読みから書きへ流してつなぐ形が、壊れた要素で子のプロセスを落とした**。直す前の作り (`$S/probe/bench/pipe-old-structure.mjs`) は、`bad-rels.xlsx`・`size-lie.zip`・方式 9 で終了コード 1 だった (自分で再現した)。予算を超えたときと CRC の違いしか試していなかった。受け手を付けて直した (18.5.3)。
  - 自分で見つけた同じ種類の誤り: ZIP の書きの adapter も、元の流れが失敗するとプロセスが落ちた (`writer-error.mjs` で終了コード 1)。本文の `]]>` の検査が、子の要素やコメントをまたいで本文をつないでいたため、正しい XML (`<r>]]<b/>></r>` など 3 件) を拒んでいた (Python 版はどれも通す)。数値の参照の検査が照合の結果を全部配列にしていた (4MB で 377MiB)。
  - 18.6 と 18.5.7 で xmldom の adapter の行数が食い違っていた。直した後の行数 (113 行、うち 47 行が部品を呼ぶ部分と OOXML の操作) にそろえた。
- **4 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - **名前空間の宣言の数え方が、DOCTYPE の文字列ですり抜けられた**。CDATA・コメント・処理命令を除いた後の文字列で数えていたので、DOCTYPE の SYSTEM の文字列に `<!--` を書くと本体ごと除かれ、深さ 2,500 / 5,000 / 10,000 で 60 / 234 / 1,061ms と 2 乗の時間が戻った (直す前の形は `$S/out/xmldom-v5.mjs`。自分で再現した)。3 回目の後に書いた「数える処理で止めた」は、この取り違えを見ていなかった。除く前の本文で数える形に直した (18.5.4)。
  - **htmlparser2 の `Parser` が、開いた要素の数の 2 乗の時間だった**。閉じない `<div>` と対応しない `</svg>` で、2.5 万 / 5 万 / 10 万個に 1,267 / 5,391 / 19,440ms (自分で再現した。直す前の形は `probe/html/htmlparser2-parser.mjs`)。前の検査の「10 万段の入れ子を 10 秒未満」は緩すぎて見逃した。`Tokenizer` を直接使う形に直し、検査を時間の比と 1 秒の上限で見る形に強めた (18.5.1)。前の 18.10 の表の htmlparser2 の行は「2 乗 無し (実測)」と書いていたが、その実測は閉じた入れ子と 1 行の大きな文だけで、開いた要素を積む形を測っていなかった。
  - タグの崩れた HTML で、`Parser` の形は Python 版と出力が違っていた (レビュアーの 602 件で 112 件) のに、記録していなかった。`Tokenizer` の形で 602/602 になった (18.5.1、18.7 の 8)。
  - `pipe-repackage.mjs` の注釈「どの壊れ方でも `kind` を持つ誤りで終わる」は誤りだった。yazl が名前を拒むときは `kind` の無い `Error` になる (18.7 の 9 に記録し、注釈を直した)。
  - ZIP の判定の違い (名前の食い違い、大きさの偽り、方式の分類) と、DOCTYPE の文字列で外れる検査の違い (Node 版が通す向き) を記録していなかった (18.7 の 9)。
- **5 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - **自己終了の形の特殊なタグで、HTML の本文がまるごと消えた**。`Tokenizer` に `recognizeSelfClosing` を渡していなかったので、`<script src="a.js"/>`・`<noscript><iframe …/></noscript>` の後ろを特殊な要素の中として読んだ (自分で再現した。`$S/r6/red-loss.txt` で 8 件すべてが Python 版と違い、4 件は本文が空、残りはタグの断片や script のコードが本文に入った)。それまでの比べる入力に、この形が無かった。直す前の形は `$S/out/htmlparser2-r5.mjs`。
  - 自分で作った 1,403 件 (`$S/r6/gen-html.py`) で、同じ種類の違いをさらに 4 つ見つけて直した: `/` と `>` の間に空白がある開始タグ、`<title>`・`<textarea>` の中で `<` の直後の文字参照、Python が捨てる数値の文字参照、終わりのタグの `>` を含む引用符つきの属性 (直す前は 1,020/1,403、直した後は 1,380/1,403。18.5.1)。最後のものは、4 回目のレビューの後に「本文に断片が出るだけ」と記録していたが、引用符の中の `<script>` で後ろの本文が消える形があった。
  - **約 300 バイトの XLSX で、ZIP の書き直しのプロセスが落ちた**。名前を yazl が拒む要素の前に CRC の誤った要素を置くと、`outputStream` を読む前に抜けて、後から出た誤りの受け手が無くなった (自分で再現した。`$S/r6/red-zip.txt`、ファジングの種 2586 は `$S/r6/zf/red-2000.txt`。直す前の形は `$S/out/pipe-repackage-r5.mjs`)。4 回目の後に書いた「どの壊れ方でもプロセスが落ちなかった」は、名前の誤りと CRC の誤りの組み合わせを試していなかった (18.5.3)。
  - **Shift_JIS に 1 バイトの壊れがあると、文書全体が化けた**。WHATWG の shift_jis が拒む 0xFF などがあると、判定が windows-1252 を選んだ (`$S/r6/red-charset.txt`。直す前の形は `$S/out/decode-pipeline-r5.mjs`・`own-r5.mjs`)。18.5.2 では「Node 版は化ける」と記録だけにしていたが、本文が化ける違いなので直した。同じく、`gb2312` の宣言の付いた Shift_JIS の文書が化けた。
  - ZIP の書き直しの時間を「比例している」と書いていたが、yazl の中で要素の数の 2 乗だった (18.5.3)。18.5.8 の「Shift_JIS with one bad byte at the end」の行は、比が小さいのは時間の大半が固定の手間だからで、比例を示していない (18.5.8 の注意書きに足した)。
- **6 回目の独立レビュー (Opus) の差し戻しで見つかった誤り** (どれも、この節の該当する所を直した):
  - **5 回目のレビューの後に足した終わりのタグの読み方が、時間を入力の 2 乗にし、例外も出した**。`>` で閉じない終わりのタグ (`</a x=">"`) の並びで 5 千 / 1 万 / 2 万個に 363 / 1,440 / 5,593ms、属性が約 220 万個の終わりのタグで `RangeError` (自分で再現した。`$S/r7/red-endtag.txt`)。18.5.8 で足した終わりのタグの 3 つの形は、どれも `>` で閉じる形だった。レビュアーの形 (属性を 1 つずつ読み、閉じないタグで残りを捨てる) をそのまま取り入れた (18.5.1)。
  - **ディレクトリの要素を持つ正しい XLSX が 500 になった**。yazl が名前の末尾の `/` を拒むことを、`../` などの名前の問題と同じ「6.x で決めること」に入れていて、正しい文書が当たることを見ていなかった (`$S/r7/red-dir.txt`)。レビュアーの形 (`addEmptyDirectory`) は、ディレクトリの要素が 5,000 個でプロセスが落ちることを自分で見つけた (`$S/r7/red-dir-rvform.txt`) ので、1 か所だけ変えて、ディレクトリの要素を飛ばす形にした (18.5.3)。
  - 3.8 の本番の依存の一覧に `entities` が抜けていた (18.8 と 6.x では足すと書いていた)。5 個にそろえた (18.10)。
  - `<!-->` の後ろに `-->` がある形の違いを記録していなかった (18.7 の 8)。
- **GREEN** (`$S/out/green.txt`、4 回目のレビューの後は `green-r5.txt`、5 回目のレビューの後は `green-r6.txt`、6 回目のレビューの後は `$S/out/green-r7.txt`): 採った部品は、HTML 33/33 (`Tokenizer` の形。自己終了の形、終わりのタグの 2 つの悪意のある形、開いた要素を積む 4 つの形の比例を含む)、文字コード 46/46、ZIP の読み 27/27、書き 5/5、XML 23/23。ベンチマーク (`bench-r7.json`) は PDF を除くすべての形式・文書でベースラインと同じで、今回は Elasticsearch の段 (d) も動き、PDF を含まない行が同じだった。`pages[]` は 20/20 が Python 版と同じ。HTML は Python 版と 32/32・602/602・1,000/1,000・714/720・1,380/1,403・終わりのタグの 2,000/2,000 で同じ出力 (違いは 18.7 の 8)。OOXML の構造を変えた 33 個は 33/33、ディレクトリの要素の形 26 個は 21/26 (違いは 18.5.3)、ディレクトリの要素を乱数で混ぜた 300 個は 300/300 が Python 版と同じ。xmldom の最終の形は、Python 版と 25/25・67/68・88/92・4/4 で同じ判定 (3 回目と 4 回目のレビューで足した 12 件・9 件は 9/12・4/9。違いは 18.7 の 9 に記録)。悪意のある入力は、XML の 30 種類 (18.5.4) と部品ごとの 39 種類 (18.5.8) の形で、N・2N・4N の時間が入力にほぼ比例した (ZIP の書き直しの要素の数を除く)。ZIP のバイト単位のファジング 8,000 件 (`$S/out/fuzz-zip-r7-*.txt`) で、流してつなぐ形と分割のプロセスは落ちなかった (yazl が拒む名前は `kind` の無い誤りになる)。

### 18.12 確かめなかったこと

- **(d) Elasticsearch での検索**: ディスクの空きによって回せる時と回せない時があった。回せた回 (`bench-r7.json`) では PDF を含まない行がベースラインと同じだった (18.1)。PDF の行は T1 の範囲で、ここでは測っていない。
- `node:24-slim` の image の中の ICU (18.10 の 6.11)。
- 子プロセスの中、`prlimit` の上限の下で動かすこと (3.6・3.7 の仕事)。ここでの数字は、ふつうの Node のプロセスで測った。
- 自前の判定の、ここで使った 3 つの集まり以外の文書 (長い業務文書、Shift_JIS と EUC-JP が混ざったもの、先頭 64KiB と後ろで文字コードが違うもの) での正解率。
- 18.7 の 1 の 6 字を戻す表と、18.7 の 10 の別名の表の試作。
- Python 版の `test_archive_guard.py` の「開いた後でデータが切れた」2 件。Node ではバイト列を後から縮められないので、写していない。
- HTML の部品に `<meta charset>` を任せる案。Python 版と同じく、先頭 4096 バイトへの正規表現で行う形だけを試した。
- yauzl・yazl・xmldom の版を上げたときの振る舞い。xmldom の勧告は GitHub Advisory Database で、どの版で直ったかまで確かめた (18.6)。勧告の中身がこの使い方に当たらないことは、勧告の題名と範囲を読んだ推論で、それぞれを試してはいない。yauzl・yazl・htmlparser2 の勧告は調べていない。
- XML: 18.5.4 の 4 つの集まり (189 件) の外に、xmldom (最終の形) と expat で通す / 拒むが違う入力が残っていないか。WHATWG と Python で同じ名前が別の表を指す宣言の、表の違い (18.7 の 9)。saxes が expat より緩いか。xmldom と Python の ElementTree の書き戻しのバイト列の違い (anydoc を通した結果だけを比べた)。展開した名前が同じ属性を持つ壊れた部品を、anydoc がどう扱うか。
- UTF-16 の部品を持つ XLSX の比較 (スタブにセル数の検査が無いため。18.5.4)。
- ベンチマークのスタブで、XLSX の書き直しを流してつなぐ形にしたときの結果 (スタブは要素を一度メモリに読んだ。流してつなぐ形は 200MiB の要素だけで確かめた)。
- 20MiB の HTML のピークの RSS の、子の中・`prlimit` の下での値。`--max-semi-space-size=4` を付けたときに、コピーを除いた形のほうがピークが高くなる理由。
- 悪意のある入力の時間を、子の中・CPU の時間の上限の下で測ること。ここで試した形 (XML の 30 種類、部品ごとの 39 種類、HTML の開いた要素を積む 4 種類) の外で、xmldom・htmlparser2 の `Tokenizer`・yauzl・yazl の中に時間が入力の 2 乗になる処理が残っていないか (試した形では比例したが、部品の中のすべてを確かめてはいない)。
- 本番の `office.ts` が anydoc の例外を分類したときに、途中で切れた ZIP などが Python 版と同じ `malformed` になること (スタブでは確かめられない。anydoc の `code` が `malformed` であることだけを確かめた)。
- DOCTYPE を読み飛ばして Python 版と XML の判定を合わせる直し (18.5.4。試していない)。
- HTML: 5 回目のレビューの後の直しは、自分の 1,403 件とレビュアーの集まりで確かめた。Python の `HTMLParser` の状態の遷移をすべて写したわけではないので、ここで作った形 (特殊なタグ 13 種・自己終了の書き方 12 種・文字参照 30 種・宣言や処理命令 35 種と、その組み合わせ) の外に違いが残っていないかは未検証である。`recognizeSelfClosing` と `index` を書き換える形が、htmlparser2 の次の版でも同じに動くか (12.0.0 だけで確かめた)。
- HTML の終わりのタグ: Python 版の文法で `>` で閉じない終わりのタグの後ろを捨てる振る舞いは、文書の終わりまで閉じない場合だけを Python 版と比べた (終わりのタグの集まり 2,000 件)。yazl の `addEmptyDirectory` の再帰のほかに、中身の無い要素を続けて書く形 (`addBuffer` の空の要素など) で同じ再帰が起きるかは確かめていない (いまの形は使っていない)。
- 文字コード: `fitsPythonCodec` は、Python の gb2312・euc_kr・big5 の受け付けるバイトの範囲だけを見る。範囲の中の定義の無い符号、ほかの狭い codec (Python の `iso2022_jp` の別名など) は比べていない。`big5` の宣言に EUC-JP のバイト列の先頭の 1 字の違い (18.7 の 8) の原因は調べていない。
- yazl の書き直しが要素の数の 2 乗になることを、yazl に報告するかどうか (調べただけで、報告していない)。
- 分割と XML の解析のメモリを、子の中で測ること (3.7)。xmldom の DOM の代わりに、DOM を作らない読み方 (saxes の位置で書き換える方式など) にした場合のメモリ。
- yauzl の一覧を上限で打ち切る形と、そのときのメモリ (試作では打ち切っていない)。
- XLSX の分割の前処理を、シートの数や要素の数を増やして測ること (PPTX だけを測った)。
- Windows / macOS での動作。

## 19. 仮想メモリの上限 (T3、タスク 3.6)

2026-11-06 に devcontainer (Node 24.21.0、16 コア、Linux 6.8、util-linux 2.41.3 の `/usr/bin/prlimit`、glibc) で、使い捨ての場所 (scratchpad の `t3/`) に試作を作って測った結果。

- 変えていないもの: 抽出サービスの package、`pnpm-lock.yaml`、本番の `src/`、`test/`、`benchmark/`、Python 版、design.md。
- 数字は、とくに書いていなければ **実測**。測っていないものは「未検証」、コードや文書を読んで考えたものは「推論」と書いた。
- 「必要な仮想メモリ」は、`prlimit --as` の値を 64MiB 刻みで二分探索し、上限なしのときと同じ結果 (成功なら `pages` の JSON の SHA-256、失敗なら失敗の種類) が **3 回続けて** 出る最小の値とした。この探索を入力ごとに 3 回くり返した。`VmPeak` は使わない。V8 は上限に合わせて予約の大きさを変えるので、上限なしの `VmPeak` (PDFium を読み込んだ子で約 9.4GB) は必要量を表さないためである。

### 19.1 結論

- **上限の値: `RLIMIT_AS` = `MAX_CHILD_RSS_MB` + 2,304MiB (既定の `MAX_CHILD_RSS_MB` 320 で 2,624MiB)**。Python 版と同じ「RSS の上限 + コードの定数」の形にする (Python 版は `ADDRESS_SPACE_HEADROOM_MB` = 512 で 832MB)。新しい環境変数は足さない (design.md の Configuration の決定のとおり)。親は、この値を自分の hard の上限で切り詰めてから `prlimit` に渡す (15.7 の (b))。
- **子の `env` に `MALLOC_ARENA_MAX=2` を足す** (`RAYON_NUM_THREADS=1` と同じ扱い。運用者向けの設定ではない)。glibc の malloc は、スレッドごとに 64MiB の予約 (arena) を作る。Node の子は 10 前後のスレッドを持つので、予約が 6〜10 個でき (19.4)、必要な仮想メモリが 300〜800MiB 増え、しかも実行ごとに揺れた (同じ PPTX で 1,600 / 2,240 / 1,856MiB)。`MALLOC_ARENA_MAX=2` で、出力 (81 入力のハッシュ) も、子の最大 RSS も、変換の時間も変わらず、必要量が下がって揺れがほぼ消えた (19.3、19.4)。変わる点は 1 つで、上限に当たったときの `Buffer` の確保の失敗が、例外 (`RangeError` → `internal`) ではなく SIGABRT (`crashed`) になることが多くなった (19.8)。HTTP の応答はどちらも 500 で、違うのはログの `result=` だけである。
- **すべての正常な変換が、この値で失敗しない** (実測): 子の最大 RSS が 320MB 以下の 71 入力を各 5 回 (計 355 回)、上限なしと同じ結果になった。正常な入力で必要量が最も大きかったのは 1,984MiB (7 万セル 1 シートの XLSX と、50MiB の cp932 の TXT。後者は結果が 16MiB を超えて正しく `limit_exceeded` になる入力) で、2,624MiB まで 640MiB (64MiB 刻みで 10 段) の余地がある。
- **RSS の監視が主な守りで、`RLIMIT_AS` は最後の歯止め** であることを実測で確かめた: 2,624MiB の下で、触れながらメモリを増やす 6 つの合成の形 (JavaScript のヒープ・文字列・`Buffer`・PDFium の中の `malloc`) と、上限を超える 9 つの本物の入力が、各 3 回すべて RSS の監視 (`memory_exceeded`、止めた時点の RSS 321〜442MB) で止まった。逆に、`RLIMIT_AS` が先に効くのは「予約するが触らない」確保で、1.5GiB / 3GiB の `Buffer.allocUnsafeSlow` は上限なしなら RSS を増やさずに成功し (VmSize 11〜12GB)、2,624MiB の下では `RangeError` (`internal`) になった。この形を起こす本物の入力は、試した中には無かった (19.6)。
- **k8s のメモリの上限には影響しない** (実測、cgroup v2): PDF の部品まで読み込んだ子 3 つを止めておいたとき、`memory.current` の増え方は、上限なしで VmSize の合計 28,128MiB のときも、2,624MiB で 5,088MiB のときも、約 169MiB で同じだった (19.7)。
- **契約は崩さない**。`RLIMIT_AS` は Python 版でも環境変数ではなく、`MAX_CHILD_RSS_MB` から計算するコードの定数だった (`platform_guards.py`)。子の `env` は Req 1.4 の環境変数の契約の外にある。ただし design.md の書き換えが 2 か所要る (19.10)。
- **`MALLOC_ARENA_MAX=2` を採らない場合の値**: `MAX_CHILD_RSS_MB` + 3,072MiB (既定で 3,392MiB)。同じ決め方 (19.5) で出した値で、確かめた結果は 19.5 の最後に書いた。

### 19.2 測り方

子は 15.5 の形にそろえた (`t3/child.mjs`、`t3/supervise.mjs`)。

| 項目 | 試作の値 | 本物 (design と 15 節) との関係 |
|---|---|---|
| 起動 | `/usr/bin/prlimit --as=<値> --cpu=60:65 --core=1 -- node --wasm-max-mem-pages=8192 child.mjs` | 15.5 と同じ。CPU は `TIMEOUT_S` 55 + 5 と、さらに + 5 (Python 版の `cpu_time_limits`) |
| `env` | `{ RAYON_NUM_THREADS: '1' }`、比べる側は `MALLOC_ARENA_MAX: '2'` を足したもの | トークンと `NODE_OPTIONS` は入れない (15.4 の (6)) |
| fd | 0: 入力 (長さを先に付けた見出しと本文)、3: 結果 (1 回だけ書く)、4: 親の見張り | 15.5 と同じ |
| 見張りの worker | 入力を読む前に立てる。`net.Socket` で fd 4 を読む。`resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2, codeRangeSizeMb: 4 }` | 15.5 と同じ |
| `oom_score_adj` | 最初に 1000 を書く | 15.5 と同じ |
| 部品の読み込み | (1) **all**: anydoc・`@embedpdf/pdfium`・テキスト系の部品をすべての子で読み込む。(2) **pdf-only**: PDF の要求のときだけ PDFium を読み込む | どちらにするかは 3.7 で決める (19.10)。上限は、多く要る all で決めたので、どちらを選んでも足りる |
| 変換 | PDF は 14.10 の関数、OOXML の分割と書き直しは 18.9 の試作 (`t6/rebuild7/probe`)、HTML・文字コードは 18 節の部品、XML と ipynb は `text.py` を写したもの (XML は DOCTYPE の内部の部分を普通のタグとして飛ばす近似)、ほかは anydoc | 本番の層 (6.2〜6.5) はまだ無い。XLSX のセル数の事前の検査は入れていない (19.9) |
| 結果 | `pages` の UTF-8 の合計が 16MiB を超えたら `limit_exceeded`、そうでなければ `JSON.stringify` して fd 3 に書く | Python 版の `ConversionCore` と同じ順 |
| 親 | 15.5 の見張り (50ms ごとに `/proc/<pid>/status`、期限 55 秒、結果の枠の上限 32MiB + 64KiB)。分類は (1) 結果あり (2) 親が決めた (3) SIGXCPU なら `timeout`、ほかは `crashed` | 本番の親 (6.7) はまだ無い。分類は **T2 の試作の親** で行った |

入力 (85 個。`t3/gen.ts`・`gen2.ts` が 2.3 / 2.4 の生成器で作る):

- 普通のファイル: ベンチマークのコーパス 23 文書、旧形式の DOC / PPT の fixture 2 つ、小さな EPUB・TSV・MD・LOG・JSON・YAML・XML・ipynb。
- 大きなファイル: 7 万セル 1 シートの XLSX (`buildOneSheetAtCellLimitXlsx`)、7 万セル 5 シート、7 万 1 セル、200 シート、画像 12 枚の 48MB の DOCX (`buildTwelveImagesDocx`)、画像の多い DOCX / PPTX (各約 46MB)、15MiB の文字の DOCX (結果が `MAX_RESULT_BYTES` に近い)、3,000 スライドの PPTX、5,000 ページの PDF (`MAX_PDF_PAGES`)、48MiB の画像の PDF・1 ページ 100 万 / 200 万 / 400 万字の PDF・8,000 字 × 500 ページの PDF (14 節の入力)、7 万 / 30 万セルの XLS、2MiB の文の RTF (5.5MB)、10 万段落の ODT、7 万セルの ODS、1,000 ページの ODP、200 章の EPUB、20MiB の HTML (`MAX_HTML_BYTES` の直前) と 190 万段の入れ子の HTML、8MiB の CSV (`MAX_CSV_BYTES` の直前。日本語のものと、小さなセルが約 420 万個のもの)、50MiB 近い cp932 の TXT (52,287,500 バイト)、15MiB の UTF-8 の TXT、48MiB の XML、16MB の ipynb、150MiB の pivot cache を持つ XLSX (`buildLargePivotCacheXlsx`)、30 万セルの XLSX を anydoc に直接渡すもの (ZIP を一覧できない XLSX が anydoc に直接渡る経路。18.10)。
- 悪意のある形: ZIP 爆弾の DOCX、10 万段の入れ子の DOCX、エンティティを展開させる PPTX、暗号化した DOCX / XLSX / PPTX / PDF、所有者パスワードだけの PDF、壊れた PDF、展開すると 256MiB / 1GiB になる FlateDecode の PDF (デコンプレッション爆弾)、zip64 の 200MiB 要素、大きさを偽った ZIP、`\bin2000000000` を宣言する RTF、対角の 2 セルだけで巨大な範囲を宣言する XLSX 3 つ (Z1000000、ZZ1048576、XFD1048576) と ODS (100 万行 × 1,000 列の繰り返し)。

### 19.3 結果: 入力ごとに必要な仮想メモリ

列の意味: 「最大 RSS」は上限なしの子の最大 RSS (MB。左が arena の制限なし、右が `MALLOC_ARENA_MAX=2`。各 1 回)。「必要量」は 19 節の頭の定義の値 (MiB。3 回の探索の結果を並べた)。「pdf-only」は部品の読み込みを (2) にしたときの必要量 (`MALLOC_ARENA_MAX=2`、探索 1 回) と、そのときの最大 RSS。この表の最大 RSS は上限なしで測った値で、上限の下では下がることがある (3,000 スライドの PPTX で 363〜365MB → 338〜340MB、1,000 スライドの PPTX で 264〜268MB → 231〜239MB。`t3/timing-as.mjs`、各 5 回)。「2,624MiB の下」は、19.1 の値と `MALLOC_ARENA_MAX=2` と RSS の監視 320MB の下で 3 回動かした結果 (3 回とも同じだった)。

| 入力 | 最大 RSS | 必要量 (arena 制限なし) | 必要量 (`MALLOC_ARENA_MAX=2`) | pdf-only (最大 RSS) | 2,624MiB の下 |
|---|---|---|---|---|---|
| (コーパス) pdf-ja-horizontal.pdf | 102 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (81) | ok |
| (コーパス) pdf-ja-line-break.pdf | 101 / 101 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (81) | ok |
| (コーパス) pdf-ja-vertical.pdf | 102 / 101 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (74) | ok |
| pdf-4m-long-page.pdf | 523 / 517 | 2112 / 2112 / 2112 | 1728 / 1728 / 1728 | 1728 (510) | memory_exceeded |
| pdf-5000-pages.pdf | 127 / 123 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (113) | ok |
| pdf-corrupt.pdf | 82 / 81 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | failed:malformed |
| pdf-flate-bomb-1g.pdf | 559 / 542 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (556) | memory_exceeded |
| pdf-flate-bomb-256m.pdf | 300 / 359 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (308) | memory_exceeded |
| pdf-image-only.pdf | 81 / 100 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (78) | ok |
| pdf-owner-only.pdf | 102 / 100 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (69) | ok |
| pdf-t1-big-12-images.pdf | 183 / 171 | 1728 / 1728 / 1728 | 1408 / 1408 / 1408 | 1408 (213) | ok |
| pdf-t1-long-page-inside.pdf | 512 / 509 | 2112 / 2112 / 2112 | 1728 / 1728 / 1728 | 1728 (502) | memory_exceeded |
| pdf-t1-one-page-1m.pdf | 185 / 203 | 1664 / 1664 / 1664 | 1344 / 1344 / 1344 | 1344 (181) | ok |
| pdf-t1-one-page-2m.pdf | 296 / 298 | 1792 / 1792 / 1792 | 1472 / 1472 / 1472 | 1472 (305) | ok |
| pdf-t1-pages-500x8k.pdf | 126 / 122 | 1536 / 1536 / 1536 | 1280 / 1280 / 1280 | 1216 (114) | ok |
| pdf-user-password.pdf | 71 / 80 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (59) | failed:encrypted |
| (コーパス) docx-ja.docx | 77 / 76 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| docx-12-images-48mb.docx | 287 / 288 | 2176 / 2176 / 2176 | 1920 / 1920 / 1920 | 1344 (244) | ok |
| docx-deep-nested.docx | 106 / 109 | 1984 / 1984 / 1984 | 1408 / 1408 / 1408 | 1216 (69) | failed:anydoc:resourceLimit |
| docx-encrypted.docx | 81 / 72 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | failed:anydoc:encrypted |
| docx-large-images.docx | 190 / 194 | 2176 / 2176 / 2176 | 1920 / 1920 / 1920 | 1280 (240) | ok |
| docx-text-15m.docx | 380 / 379 | 2432 / 2432 / 2432 | 1984 / 1984 / 1984 | 1472 (382) | memory_exceeded |
| docx-zip-bomb.docx | 73 / 81 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (74) | failed:anydoc:resourceLimit |
| (コーパス) xlsx-ja-multi-sheet.xlsx | 100 / 99 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | ok |
| xlsx-200-sheets.xlsx | 148 / 146 | 2368 / 2368 / 2368 | 1408 / 1408 / 1408 | 1280 (131) | ok |
| xlsx-300k-raw.xlsx | 735 / 733 | 2816 / 2816 / 2816 | 2368 / 2368 / 2368 | 1856 (717) | memory_exceeded |
| xlsx-70k-five-sheets.xlsx | 179 / 177 | 2304 / 2240 / 2304 | 1408 / 1536 / 1536 | 1280 (159) | ok |
| xlsx-70k-one-sheet.xlsx | 317 / 313 | 2496 / 2496 / 2496 | 1984 / 1984 / 1984 | 1408 (297) | ok |
| xlsx-encrypted.xlsx | 76 / 100 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (71) | failed:anydoc:encrypted |
| xlsx-lying-sizes.xlsx | 80 / 99 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | failed:anydoc:malformed |
| xlsx-over-cell-limit.xlsx | 260 / 258 | 2496 / 2496 / 2496 | 1856 / 1920 / 1856 | 1344 (240) | ok |
| xlsx-pivot-cache.xlsx | 405 / 404 | 2624 / 2624 / 2624 | 2048 / 2048 / 2048 | 1536 (387) | memory_exceeded |
| xlsx-zip64-bomb-part.xlsx | 76 / 80 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (68) | failed:anydoc:malformed |
| (コーパス) pptx-ja-multi-slide.pptx | 101 / 100 | 2240 / 1600 / 1856 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| pptx-3000-slides.pptx | 365 / 366 | 2688 / 2624 / 2624 | 2048 / 2048 / 2048 | 1472 (351) | memory_exceeded |
| pptx-encrypted.pptx | 81 / 82 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | failed:anydoc:encrypted |
| pptx-entity-expansion.pptx | 101 / 99 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | failed:malformed |
| pptx-large-images.pptx | 151 / 152 | 1984 / 1984 / 1984 | 1280 / 1280 / 1280 | 1216 (152) | ok |
| (コーパス) xls-ja.xls | 82 / 101 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (71) | ok |
| xls-300k.xls | 216 / 214 | 2240 / 2240 / 2240 | 1920 / 1920 / 1856 | 1344 (196) | ok |
| xls-70k.xls | 129 / 129 | 2176 / 2176 / 2176 | 1408 / 1408 / 1408 | 1216 (109) | ok |
| (コーパス) doc-legacy.doc | 82 / 82 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | ok |
| fixture-simple-table.doc | 74 / 81 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | ok |
| (コーパス) ppt-legacy.ppt | 102 / 75 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (71) | ok |
| fixture-text-shapes.ppt | 73 / 98 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| rtf-10m.rtf | 193 / 190 | 2240 / 2240 / 2240 | 1920 / 1920 / 1856 | 1344 (175) | ok |
| rtf-bin-2g.rtf | 81 / 75 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (73) | ok |
| (コーパス) odt-ja.odt | 83 / 82 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (75) | ok |
| odt-10m.odt | 204 / 201 | 2304 / 2240 / 2304 | 1920 / 1920 / 1920 | 1344 (184) | ok |
| (コーパス) ods-ja.ods | 81 / 81 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| ods-70k.ods | 188 / 186 | 2240 / 2240 / 2240 | 1856 / 1856 / 1920 | 1344 (167) | ok |
| (コーパス) odp-ja.odp | 73 / 81 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| odp-1000-pages.odp | 79 / 82 | 1984 / 1984 / 1984 | 1408 / 1408 / 1408 | 1216 (70) | ok |
| epub-200-chapters.epub | 147 / 145 | 2176 / 2176 / 2176 | 1408 / 1408 / 1408 | 1280 (114) | ok |
| epub-small.epub | 81 / 72 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| (コーパス) html-euc-jp-http-equiv.html | 82 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | ok |
| (コーパス) html-shift-jis-script-style.html | 82 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (74) | ok |
| html-20m.html | 230 / 243 | 2240 / 2240 / 2240 | 1856 / 1920 / 1920 | 1280 (223) | ok |
| html-deep-nesting.html | 148 / 145 | 1856 / 1856 / 1856 | 1216 / 1280 / 1280 | 1216 (127) | ok |
| (コーパス) csv-cp932.csv | 81 / 76 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (74) | ok |
| (コーパス) csv-utf-8.csv | 82 / 77 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (72) | ok |
| csv-8m-japanese.csv | 200 / 197 | 2176 / 2240 / 2176 | 1792 / 1856 / 1408 | 1344 (179) | ok |
| csv-8m-tiny-cells.csv | 1295 / 1289 | 3328 / 3328 / 3328 | 2944 / 2944 / 2944 | 2368 (1274) | memory_exceeded |
| tsv-small.tsv | 71 / 79 | 1600 / 1600 / 1600 | 1408 / 1408 / 1408 | 1216 (75) | ok |
| (コーパス) txt-euc-jp.txt | 72 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (71) | ok |
| (コーパス) txt-iso-2022-jp.txt | 83 / 71 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (73) | ok |
| (コーパス) txt-shift-jis.txt | 73 / 81 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | ok |
| (コーパス) txt-utf-16be-bom.txt | 76 / 76 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | ok |
| (コーパス) txt-utf-16le-bom.txt | 74 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (63) | ok |
| (コーパス) txt-utf-8-bom.txt | 72 / 81 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (69) | ok |
| (コーパス) txt-utf-8.txt | 81 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (66) | ok |
| txt-15m-utf8.txt | 153 / 154 | 1984 / 1984 / 1984 | 1280 / 1280 / 1280 | 1216 (157) | ok |
| txt-50m-cp932.txt | 250 / 249 | 2304 / 2304 / 2304 | 1984 / 1984 / 1984 | 1408 (226) | failed:limit_exceeded |
| md-small.md | 78 / 78 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (73) | ok |
| log-small.log | 72 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | ok |
| json-small.json | 75 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (71) | ok |
| yaml-small.yaml | 75 / 81 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (66) | ok |
| xml-50m.xml | 354 / 336 | 2304 / 2304 / 2304 | 1920 / 1920 / 1920 | 1408 (305) | memory_exceeded |
| xml-small.xml | 101 / 78 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (70) | ok |
| ipynb-10m.ipynb | 241 / 242 | 2240 / 2240 / 2240 | 1856 / 1920 / 1920 | 1344 (227) | ok |
| ipynb-small.ipynb | 99 / 82 | 1536 / 1536 / 1536 | 1216 / 1216 / 1216 | 1216 (72) | ok |

読み方:

- **arena の制限なしでは、必要量が入力の大きさにあまり関係なく 1,536〜2,688MiB に散らばり、揺れる**。コーパスの PPTX (最大 RSS 101MB) が 1,600 / 2,240 / 1,856MiB、`xlsx-200-sheets` (148MB) が 2,368MiB を要した。探索で見つけた値の 1 段下で通る回もあった (コーパスの PPTX、3,000 スライドの PPTX)。「3 回の最大」はこの揺れを押さえきれない。
- **`MALLOC_ARENA_MAX=2` では揺れがほぼ消えた**。81 入力のうち、3 回の値が違ったのは 9 入力で、7 入力は 1 段 (64MiB)、残りは `xlsx-70k-five-sheets.xlsx` (1,408 / 1,536 / 1,536MiB) と `csv-8m-japanese.csv` (1,792 / 1,856 / 1,408MiB) だった。出力のハッシュは 81 入力すべて arena の制限なしと同じだった。
- **「必要量 − 最大 RSS」(以下「土台」)** は、arena の制限なしで最大 2,323MiB (3,000 スライドの PPTX)、`MALLOC_ARENA_MAX=2` で最大 1,735MiB (50MiB の cp932 の TXT)。上限はこの土台の上に RSS の上限を足した値を下回ってはいけない (19.5)。
- **PDF の部品を読み込むかどうかで、PDF 以外の必要量が約 200〜600MiB 変わる** (pdf-only の列)。PDFium の WASM のメモリ (`--wasm-max-mem-pages=8192` で 512MiB) の予約の分と見られる (推論)。pdf-only を採れば PDF 以外の子は軽くなるが、上限は PDF の子にも掛かるので、値は all で決めた。pdf-only の結果のハッシュは all と同じだった。
- 1.4 の調べ (何もしない 1,200MB、anydoc の XLSX 2,000MB、PDFium の WASM 3,000MB 以上) との対応: 何もしない Node は 1,150MiB (14.5 の (2))、7 万セル 1 シートの XLSX は arena の制限なしで 2,496MiB / `MALLOC_ARENA_MAX=2` で 1,984MiB、PDF の最大は 400 万字の 1 ページの 2,112 / 1,728MiB。「3,000MB 以上」は、14.5 の (2) と同じく再現しなかった (`--wasm-max-mem-pages=8192` で WASM の予約が小さいため)。15.9 に残っていた「`--wasm-max-mem-pages=8192` を付けたときに、48MiB の PDF とベンチマークの PDF が今までどおり変換できるか」は、PDF の 16 入力をこの引数なし・上限なしで 1 回ずつ動かして比べた (`t3/nowasm.mjs`)。15 入力は種類もハッシュも同じだった。違ったのは 256MiB に展開する FlateDecode の PDF だけで、引数なしでは RSS 622MB まで伸びて変換を終え、引数ありでは RSS 300MB で WASM のメモリを増やせず `internal` になった。どちらにしても本番では RSS の上限 (320MB) を超える入力なので、扱いは変わらない (19.6)。1GiB の爆弾は引数なしでも同じ失敗 (RSS 1,088MB)。

### 19.4 arena の数を数えた結果と、時間・RSS への影響

**仕組みの裏づけ** (実測): 変換の終わりに子の `/proc/self/maps` を読み、「64MiB の境目で終わる、読み書きできない名前の無い領域」(glibc のスレッドごとの arena の予約の形) を数えた (`t3/arenas.mjs`。上限なし、各 3 回、3 回とも同じ値)。

| 入力 | arena の制限なし | `MALLOC_ARENA_MAX=2` |
|---|---|---|
| コーパスの UTF-8 の TXT | 6 | 1 |
| コーパスの PPTX | 10 | 1 |
| `xlsx-200-sheets` | 10 | 1 |
| 7 万セル 1 シートの XLSX | 9 | 1 |
| 3,000 スライドの PPTX | 10 | 1 |
| 20MiB の HTML | 6 | 1 |

コーパスの TXT の必要量の差 (1,536 → 1,216MiB = 320MiB) は 5 個 × 64MiB と合う。どのスレッドがいつ malloc するかで予約の数と時期が変わるので、必要量が揺れると見られる (揺れの原因の細部は推論)。

**上限を掛けたときの遅れ** (14.8 で 3.6 に引き継がれた「上限を掛けたときの約 1 割の遅れ」への答え。`MALLOC_ARENA_MAX=2`、RSS の監視なし、各 5 回の中央値と範囲。`t3/timing-as.mjs`):

| 入力 | 上限なし | 2,624MiB | 差 |
|---|---|---|---|
| 3,000 スライドの PPTX | 2,799ms (2,546〜2,837) | 3,128ms (2,987〜3,165) | +12% |
| 8,000 字 × 500 ページの PDF | 919ms (910〜933) | 1,008ms (1,000〜1,022) | +10% |
| 1 ページ 200 万字の PDF | 621ms (605〜630) | 668ms (656〜674) | +8% |
| 1,000 スライドの PPTX | 971ms (962〜985) | 1,037ms (1,033〜1,056) | +7% |
| 7 万セル 1 シートの XLSX | 423ms (388〜435) | 423ms (412〜432) | 0% |

子の V8 のヒープの上限 (`heap_size_limit`) は、上限なしで 4,288MiB、2,624MiB の下で 1,504MiB だった (実測)。ヒープの上限が小さいと、V8 がごみ集めを早めに行うので遅くなると見られる (推論。ごみ集めの回数は測っていない)。長い変換ほど遅れ、独立のレビューでも 3,000 スライドの PPTX で 2,735ms → 3,093ms、2,000 ページの PDF で 2,413ms → 2,767ms (約 11〜13%) だった。

**時間と RSS** (上限なし、RSS の監視なし、各 5 回の中央値と範囲。`t3/timing.mjs`):

| 入力 | 時間: 制限なし | 時間: `MALLOC_ARENA_MAX=2` | 最大 RSS: 制限なし | 最大 RSS: `MALLOC_ARENA_MAX=2` |
|---|---|---|---|---|
| 7 万セル 1 シートの XLSX | 421ms (416〜449) | 418ms (409〜425) | 317MB (316〜317) | 314MB (313〜315) |
| 画像 12 枚の 48MB の DOCX | 216ms (215〜221) | 219ms (211〜228) | 299MB (298〜301) | 291MB (280〜302) |
| 3,000 スライドの PPTX | 2,759ms (2,676〜2,899) | 2,822ms (2,750〜2,942) | 363MB | 363MB |
| 20MiB の HTML | 785ms (778〜793) | 779ms (769〜782) | 234MB (223〜242) | 240MB (231〜251) |
| 1 ページ 200 万字の PDF | 611ms (597〜635) | 610ms (603〜623) | 309MB (287〜311) | 294MB (284〜298) |
| コーパスの PPTX | 125ms | 125ms | 101MB | 100MB |
| 8MiB の日本語の CSV | 364ms | 366ms | 199MB | 197MB |

時間の差は範囲が重なる程度 (3,000 スライドの PPTX で中央値 +2%)。RSS は変わらないか少し下がった。anydoc の中は `RAYON_NUM_THREADS=1` で 1 本なので、arena を絞っても malloc の取り合いはほとんど起きないと見られる (推論)。

### 19.5 値の決め方と余裕の根拠

**式の形**: 上限で止まるまでに RSS がどこまで増やせるか (以下「伸びしろ」) を、上限の値を変えて測った (RSS の監視なし、各 3 回。`t3/room.mjs`、all、`MALLOC_ARENA_MAX=2`)。数字は止まったときの最大 RSS (MB)。

| 増やし方 | 2,304MiB | 2,624MiB | 3,136MiB | 3,648MiB |
|---|---|---|---|---|
| JavaScript のヒープ (16MiB ずつ) | 618〜682 | 1,018〜1,019 | 1,468〜1,480 | 1,852〜1,899 |
| JavaScript のヒープ (1MiB ずつ) | 638〜647 | 1,007〜1,017 | 1,534〜1,538 | 1,862〜1,919 |
| 文字列 | 689〜706 | 1,009〜1,025 | 1,419〜1,420 | 1,875〜1,907 |
| `Buffer.alloc` (16MiB ずつ) | 693〜761 | 986〜1,081 | 1,548〜1,570 | 2,034〜2,086 |
| PDFium の中の `malloc` (16MiB ずつ) | 548〜562 | 520〜532 | 536〜552 | 513〜547 |
| 30 万セルの XLSX を anydoc に直接 | 716〜738 | 731 (変換できた) | 731 (変換できた) | 731 (変換できた) |
| 小さなセル 420 万個の CSV (anydoc) | 735〜739 | 1,038〜1,058 | 1,290 (結果が 16MiB を超えて `limit_exceeded`) | 1,290 (同) |

- 伸びしろは上限とほぼ同じだけ増える (2,624MiB から 3,648MiB に 1,024MiB 上げると、増やし方ごとに約 860〜1,000MB 増えた)。つまり「上限 − 伸びしろ」は上限によらずほぼ一定 (約 1,550〜1,800MiB) で、**運用者が `MAX_CHILD_RSS_MB` を変えたときも、上限を同じだけ動かせば同じ余裕が保てる**。そのため、固定の値ではなく「`MAX_CHILD_RSS_MB` + 定数」の形にした。固定の値にすると、`MAX_CHILD_RSS_MB` を大きくした環境で `RLIMIT_AS` が RSS の監視より先に効き、`memory_exceeded` (422) になるはずのものが `crashed` (500) になる。
- PDFium の中の `malloc` は、上限によらず 513〜562MB で止まる。`--wasm-max-mem-pages=8192` の 512MiB に当たり、PDFium が `RuntimeError: Aborted` (`internal`) か `malloc` の 0 (14.10 の関数で `internal`) になるためである。PDF の経路には、`RLIMIT_AS` と RSS の監視とは別の 3 つ目の歯止めがある。
**`check-rss-first` の 15 の形** (19.5 の検査、19.9 の道具で使う。どれも RSS を実際に増やす):

| 名前 | 何をする形か |
|---|---|
| JavaScript のヒープ (16MiB ずつ / 1MiB ずつ) | 数値の配列を作り続けて保持する (2 つ) |
| 文字列 | 文字列をつなげて長くし続ける |
| `Buffer.alloc` (16MiB ずつ / 256MiB ずつ) | 中身を書いた `Buffer` を作り続けて保持する (2 つ) |
| PDFium の中の `malloc` (16MiB ずつ) | WASM のメモリの中で確保して書き込み続ける |
| 400 万字の 1 ページの PDF (2 つ) | `buildLongPagePdf` と、全部の行をページの内側に置いたもの (14 節) |
| 1GiB に展開する FlateDecode の PDF | PDFium が展開した内容の流れを読む |
| 30 万セルの XLSX を anydoc に直接 | anydoc の中で表を作る |
| 小さなセル 420 万個の 8MiB の CSV | anydoc の中で表を作り、16MiB を超える結果を作る |
| 15MiB の文字の DOCX | anydoc の結果と、それを `JSON.stringify` した文字列 |
| 3,000 スライドの PPTX | 18.9 の分割で、スライドごとに package を作って anydoc に渡す |
| 150MiB の pivot cache の XLSX | 18.9 の書き直しで要素をメモリに読む |
| 48MiB の XML | デコードと `text.py` を写したタグの除去 |

- arena の制限なし (all) では、上限 2,560 / 3,072 / 3,584 / 4,096MiB でヒープの伸びしろが 604〜653 / 1,101〜1,152 / 1,624〜1,670 / 2,095〜2,148MB だった (`t3/out/room-all.txt`)。15.4 の (4) の「8,192 ページ・3GiB でヒープ約 1,136MB」と合う。

**定数 2,304MiB の内訳**: 定数 = 正常な入力と大きな入力の土台の最大 (1,735MiB、19.3) + 512MiB を、256MiB 単位に切り上げた値 (2,247 → 2,304)。512MiB は、Python 版の `ADDRESS_SPACE_HEADROOM_MB` (RSS の上限の上に残す幅) を引き継いで切り上げた目安である。値が足りていることの根拠は、512 の内訳ではなく、決めた値で実際に確かめた次の 2 つの余裕に置く。

- 正常な入力の必要量の最大 (1,984MiB) との差が 640MiB ある (64MiB 刻みで 10 段)。3 回の探索で見えた残りの揺れの最大 (`csv-8m-japanese.csv` の 1,408〜1,856MiB、448MiB) も、その最大の 1,856MiB から 2,624MiB まで 768MiB 残る。
- 伸びしろの最小 (PDFium を除く) が 986MB ある。RSS の監視が止めるのに要るのは、上限 320MB と監視の遅れ (一気に確保する子で最大 145MB。15.4 の (9)) を足した 465MB で、それを 521MB 上回る。この節の計測では、監視が止めた時点の RSS は最大 442MB (上限 + 122MB) だった。

Python 版の 512 は Python 自身の土台 (Python は `RLIMIT_AS` 300MB でも動く。1.4) を含んだ値なので、RSS の上限の上に実際に残る幅は Python 版より Node 版のほうが広い (推論。Python 版の土台は測っていない)。

**決めた値で確かめたこと** (`MALLOC_ARENA_MAX=2`、all):

| 検査 | 結果 |
|---|---|
| `check-all-pass 2624` (子の最大 RSS が 320MB 以下の 71 入力 × 5 回。RSS の監視なし) | **PASS** (355 回。すべて上限なしと同じ結果とハッシュ) |
| `check-rss-first 2624` (6 つの合成の形 + 9 つの本物の入力 × 3 回。RSS の監視 320MB) | **PASS** (45 回すべて `memory_exceeded`。止めた時点の RSS 321〜442MB) |
| 本番の条件 (`prod.mjs 2624`。85 入力 × 3 回。RSS の監視 320MB) | `ok` 180、`memory_exceeded` 30、`failed:anydoc:resourceLimit` 18、`failed:anydoc:encrypted` 9、`failed:anydoc:malformed` 6、`failed:malformed` 6、`failed:encrypted` 3、`failed:limit_exceeded` 3。**`crashed` と `internal` は 0**。入力ごとに 3 回とも同じ結果 (19.3 の表の右の列) |
| 正常な入力の必要量の最大 (1,984MiB) との差 | 640MiB |
| 伸びしろの最小 (PDFium を除く) | 986MB (= RSS の上限 320 + 666MB) |

`MAX_CHILD_RSS_MB` を下げた場合も、上限は 2,304MiB を下回らず、正常な入力の必要量の最大 (1,984MiB) を超える。

**`MALLOC_ARENA_MAX=2` を採らない場合**: 同じ決め方で、土台の最大 2,323MiB + 512MiB = 2,835MiB を 256MiB 単位に切り上げて、定数は 3,072MiB (既定で 3,392MiB)。`check-all-pass 3392` (arena の制限なしの最大 RSS が 320MB 以下の 72 入力 × 3 回、216 回) と `check-rss-first 3392` (45 回すべて `memory_exceeded`) は **PASS** だった。より低い 2,880MiB でも、`check-all-pass` は PASS (216 回)、`check-rss-first` は 45 回のうち 44 回が `memory_exceeded` で、残りの 1 回は 48MiB の XML が RSS 305MB で `limit_exceeded` を返した (上限なしと同じ種類の結果で、`RLIMIT_AS` によるものではない)。ただし arena の揺れは「malloc するスレッドの数 × 64MiB」まで広がりうるので (19.4)、3 回の探索では最悪を見ていない可能性が残る。

### 19.6 悪意のある入力での挙動

RSS の監視 320MB の下で、上限なしと 2,624MiB で 1 回ずつ動かした (`t3/hostile.mjs`、`MALLOC_ARENA_MAX=2`)。`check-rss-first` の 9 入力は 19.5 の表のとおり。

| 入力 | 上限なし | 2,624MiB | どの守りが止めたか |
|---|---|---|---|
| 対角の 2 セルの XLSX (Z1000000 / ZZ1048576 / XFD1048576) | `anydoc:resourceLimit` (RSS 99〜100MB) | 同じ | anydoc 自身の上限 |
| 100 万行 × 1,000 列を繰り返す ODS | `anydoc:resourceLimit` (78MB) | 同じ | anydoc 自身の上限 |
| `\bin2000000000` の RTF | `ok` (72MB) | 同じ | 確保しない (宣言の大きさで予約しない) |
| ZIP 爆弾の DOCX、10 万段の入れ子の DOCX | `anydoc:resourceLimit` | 同じ | anydoc 自身の上限 |
| 190 万段の入れ子の HTML | `ok` (144MB、約 950ms) | 同じ | — (`Tokenizer` は段を積まない。18.5.1) |
| エンティティを展開させる PPTX | `malformed` | 同じ | XML の検査 (18.5.4) |
| zip64 の 200MiB 要素 (XLSX として) | `anydoc:malformed` | 同じ | anydoc |
| 256MiB に展開する FlateDecode の PDF | `internal` (WASM のメモリを増やせない。RSS 301MB) | `memory_exceeded` (326MB) | RSS の監視か WASM の上限 (時期による) |
| 1GiB に展開する FlateDecode の PDF | `memory_exceeded` (356MB) | `memory_exceeded` (327MB) | RSS の監視 |
| `Buffer.allocUnsafeSlow` で 1.5GiB / 3GiB を予約 (合成) | 成功 (RSS 82MB のまま、VmSize 11〜12GB) | `RangeError` → `internal` | **`RLIMIT_AS`** |

- **`RLIMIT_AS` が RSS の監視より先に効く本物の入力は、試した中には無かった**。宣言の大きさで一気に確保させる形 (XLSX・ODS の巨大な範囲、RTF の `\bin`) は、anydoc 自身の上限で止まるか、確保されなかった。「予約するが触らない」確保は合成の形でだけ示した。
- 画像のデコンプレッション爆弾は、試した部品では効かないと見られる。anydoc は 46MB の画像を含む DOCX / PPTX で RSS 190 / 151MB、PDFium は 48MiB の画像の PDF で 183MB で、画像を展開していない (推論。部品のコードは読んでいない)。

### 19.7 k8s のメモリの上限との関係

`RLIMIT_AS` は 1 つのプロセスの「アドレスの範囲の予約」の上限で、k8s の `limits.memory` は cgroup が数える「実際に使っているメモリ」の上限である。別物であることを、cgroup v2 の `memory.current` で確かめた (`t3/cgroup.mjs`。PDF の部品まで読み込んだ子 3 つを 3 秒止めておき、前後の `memory.current` の中央値の差を取った。各 5 回):

| 上限 | 3 つの VmSize の合計 | 3 つの VmRSS の合計 | `memory.current` の増え方 |
|---|---|---|---|
| なし | 28,126〜28,128MiB | 321〜322MiB | 162〜171MiB |
| 2,624MiB | 5,087〜5,090MiB | 315〜316MiB | 168〜173MiB |

予約が 23GB 違っても cgroup の数え方は変わらず、増え方は RSS の合計より小さかった (node の実行ファイルなど、共有されるページが一度しか数えられないためと見られる。推論)。したがって **`RLIMIT_AS` を上げても k8s の OOMKill は起きやすくならない**。ただし、k8s の上そのもので確かめたわけではない (推論)。メモリの予算 (Req 3.14) は RSS の監視と子の最大 RSS で決まり、3.7 の仕事である。

### 19.8 失敗の分類 (`RLIMIT_AS` に当たったときに子の中で起きること)

上限が足りないときに実際に起きたこと。分類は **T2 の試作の親** (15.5、15.6 の順) で行った。

| 起きたこと | 親から見える `(code, signal)` と結果の有無 | 種類 | HTTP (対象 spec の design.md の表) |
|---|---|---|---|
| anydoc (Rust) の確保の失敗。標準エラーに `memory allocation of N bytes failed` | `(null, 'SIGABRT')`、結果なし | `crashed` | 500 |
| C++ の確保の失敗 (`std::bad_alloc`。V8・Node の内部) | `(null, 'SIGABRT')`、結果なし | `crashed` | 500 |
| V8 のヒープを増やせない、V8 の内部の予約の失敗 | `(null, 'SIGABRT')` / `(null, 'SIGTRAP')`、結果なし | `crashed` | 500 |
| Node の `ERR_MEMORY_ALLOCATION_FAILED`、入力の `Buffer` を作れない (上限 1,536MiB 以下で 48MB の入力) | `(1, null)`、結果なし | `crashed` | 500 |
| `Buffer.alloc` / `allocUnsafeSlow` の失敗 | 例外 `RangeError` を捕まえて結果を返す → 親が SIGKILL | `internal` | 500 |
| 同上、`MALLOC_ARENA_MAX=2` で少しずつ増やした場合 | 多くは `(null, 'SIGABRT')`、結果なし | `crashed` | 500 |
| PDFium の WASM のメモリを増やせない | 例外 `RuntimeError: Aborted` (標準エラーに `growMemory: … Unable to grow`) → 結果を返す | `internal` | 500 |
| **anydoc が確保の失敗を「壊れたファイル」として返す** (上限 2,048MiB・arena の制限なしで、10 万段の入れ子の DOCX、15MiB の文字の DOCX、7 万セルの ODS、10 万段落の ODT、7 万セル 1 シートの XLSX) | 例外 `code: malformed` → 結果を返す | `malformed` | **422** (`extraction_failed`) |

- 1 行目で、15.9 の未検証 (anydoc の中の Rust の abort を `process.abort()` で代わりにしていた) を閉じた。本物の abort も SIGABRT で、15.6 の分類と合う。
- **最後の行は 15.6 に無い経路**。上限がきついと、利用者からは「壊れたファイル」(422) に見え、運用者は資源の不足に気付けない。上限を必要量ぎりぎりにしてはいけない理由の 1 つである。2,624MiB と `MALLOC_ARENA_MAX=2` では、355 回 + 本番の条件の 255 回で一度も起きなかった (`anydoc:malformed` 6 回は、上限なしでも同じ結果になる壊れた入力)。
- Python 版は `MemoryError` を捕まえて `internal` にしていた (15.1 の (b))。Node 版では大半が `crashed` になるが、HTTP の応答は同じ 500 で、違うのはログの `result=` だけである。

### 19.9 再現の手順

使い捨ての場所 (以下 `$T`) で行う。リポジトリの中では install しない。T6 の試作 (`$T/../t6/rebuild7/probe` と `$T/../t6/deps`。18.9 の手順で作る) を子から読み込む。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$T"/{inputs,inputs-hostile,out} && cd "$T"
echo '{"name":"t3","private":true,"type":"module"}' > package.json
npm install --ignore-scripts --save-exact @firecrawl/anydoc@0.2.4 @embedpdf/pdfium@2.15.1
# inputs: the repo generators through swc-node (REG = file URL of @swc-node/register/esm/esm-register.mjs)
(cd <repo>/apps/attachment-text-extractor && node --import $REG $T/gen.ts $T/inputs && node --import $REG $T/gen2.ts $T/inputs-hostile)
for f in big-12-images long-page-inside one-page-1m one-page-2m pages-500x8k; do cp $T/../t1/inputs/$f.pdf $T/inputs/pdf-t1-$f.pdf; done   # 14.10 の入力
A='{"RAYON_NUM_THREADS":"1","MALLOC_ARENA_MAX":"2"}'
node ref.mjs all out/ref-all.json; CHILD_ENV=$A node ref.mjs all out/ref-all-arena2.json        # 上限なしの正解
node minas.mjs all out/ref-all.json out/minas-all.json . 3 4                                      # 必要量 (arena の制限なし)
CHILD_ENV=$A node minas.mjs all out/ref-all-arena2.json out/minas-all-arena2.json . 3 4          # 必要量 (MALLOC_ARENA_MAX=2)
CHILD_ENV=$A node check-all-pass.mjs 2624 all out/ref-all-arena2.json 5
CHILD_ENV=$A node check-rss-first.mjs 2624 all 3
CHILD_ENV=$A node prod.mjs 2624 3 out/prod-2624-arena2.json
CHILD_ENV=$A node room.mjs all 2304,2624,3136,3648 3; CHILD_ENV=$A node hostile.mjs unlimited,2624 1
CHILD_ENV=$A node cgroup.mjs unlimited 5; node arenas.mjs; node timing.mjs 5; node nowasm.mjs
```

道具の要点:

- `gen.ts` / `gen2.ts`: 19.2 の入力を `test/fixtures/index.ts` の生成器で書く。FlateDecode の爆弾は、`buildPdf` の追加の object に `/Type /XObject /Subtype /Form … /Filter /FlateDecode` の流れ (PDF のコメントの行を 256MiB / 1GiB 並べて `deflateSync`) を置き、ページの内容から `/Fm0 Do` で呼ぶ。対角の 2 セルの XLSX は、`xlsxParts` の `xl/worksheets/sheet1.xml` の `<sheetData>` を `editPart` で A1 と対角のセルの 2 つだけに書き換える。
- `child.mjs`: 15.5 の子の入口 (`oom_score_adj` → 見張りの worker → fd 0 から入力 → 変換 → fd 3 に 1 回 → `process.exit(0)`) に、19.2 の変換をつないだもの。`header.mode` で、変換のほかに合成の増やし方 (`grow-heap`・`grow-string`・`grow-buffer`・`grow-wasm`・`reserve-buffer`・`hold`) を選ぶ。結果には `/proc/self/status` と arena の数 (19.4) を足すが、親は `pages` (または失敗の種類) だけをハッシュにする。
- `supervise.mjs`: 15.5 の親。`prlimit` の引数、`env`、`--wasm-max-mem-pages=8192` を 19.2 の表のとおりに明示する。
- `minas.mjs`: 1,024〜4,096MiB を 64MiB 刻みで二分探索し、見つけた値で 3 回続けて同じ結果になるまで 1 段ずつ上げる。これを 3 回くり返す。
- `check-all-pass.mjs <値>`: 上限なしの最大 RSS が 320MB 以下の入力を、RSS の監視なしで N 回ずつ動かし、上限なしと同じ結果とハッシュかを見る。`check-rss-first.mjs <値>`: 19.5 の 15 の形を RSS の監視 320MB の下で N 回ずつ動かし、すべて `memory_exceeded` かを見る。

### 19.10 後のタスクへの引き継ぎ

- **design.md の書き換えが要る (この作業では書き換えていない)**:
  - Configuration の「`RLIMIT_AS` の値は環境変数にせず、T3 で決めた値をコードの定数にする」→ 「`MAX_CHILD_RSS_MB` + 2,304MiB (コードの定数) にする」。
  - 同じ節の `RAYON_NUM_THREADS=1` の行に、`MALLOC_ARENA_MAX=2` を子の `env` に足すことを並べる (Dockerfile には要らない。HTTP のプロセスでは測っていない)。
  - 未決事項の表 (5 節の後) の「`RLIMIT_AS` の値と、緩めた分の守り」の行は、更新した。
- **取り込み (Req 12) で対象 spec (`attachment-search-text-extractor`) を直す先**: design.md 289 行の「`RLIMIT_AS` (仮想メモリの上限) を「RSS の上限 + 512MB」にする」、tasks.md 134 行の「仮想メモリの上限 (RSS の上限 + 512MB)」、design.md 440 行の `RAYON_NUM_THREADS=1` の説明 (`MALLOC_ARENA_MAX=2` を並べる)。行番号は 2026-11-06 に grep で確かめたもの。
- **6.13 (ベンチマーク)**: Node 版の時間は、上限 (2,624MiB) を掛けた子で測る。上限なしより 7〜12% 遅い (19.4)。
- **3.7 (子の最大 RSS の基準とメモリの予算)**:
  - **7 万セル 1 シートの XLSX は、all の子で最大 RSS 313〜317MB だった** (19.3、19.4。0.95 倍の 304MB を超える)。pdf-only の子では 297MB (1 回)。部品をいつも読み込むか (all / pdf-only) で基準を満たすかどうかが変わる。ただしこの子は XLSX の書き直しに 18.9 の試作を使い、セル数の事前の検査を持たない。本番の形で測り直すこと。
  - 画像 12 枚の 48MB の DOCX は all で 287〜299MB、pdf-only で 244MB。
  - 結果が `MAX_RESULT_BYTES` に近い 15MiB の文字の DOCX は 379〜382MB で `memory_exceeded` になる。同じ大きさの結果でも、TXT (15MiB) は 154MB で通る。
  - 小さなセルの 8MiB の CSV は 1,289〜1,295MB まで伸び、`MAX_CSV_BYTES` の事前の判定は通ったうえで `memory_exceeded` になる (Python 版の config.py の説明と同じ性質)。
  - 150MiB の pivot cache の XLSX が 404MB になったのは、18.9 の試作が要素を一度メモリに読むため。本番は流してつなぐ形 (18.10) で測り直す。
  - `MALLOC_ARENA_MAX=2` は子の最大 RSS を変えない (19.4)。
  - 19.3 の最大 RSS は上限なしで測った値で、上限の下では下がることがある (19.3 の注)。基準の値は、18.10 にあるとおり、子の中で `prlimit` の上限の下で測ること。
  - 普通の PPTX でも、スライドの数が多いと 320MB に近づく。独立のレビューでは、1.8MB・1,000 スライドの PPTX が all の子で 316〜320MB だった。この節の 0.9MB・1,000 スライドの PPTX (`gen3.ts`。1 枚に題と 2 行) は 264〜268MB だった。
  - **部品の読み込み方 (all か pdf-only か) は 3.7 で決める**。上限の値は all で決めたので、どちらを選んでも足りる。一方、7 万セル 1 シートの XLSX の最大 RSS が 0.95 倍 (304MB) を超えるかは、この選び方で変わる (all 313〜317MB 対 pdf-only 297MB)。tasks.md の 3.7 は「基準のファイルで子の最大 RSS を測り、既定値を決める」で、この判断はその一部になる。15.7 の「3.6 で合わせて決める」と、14.5 の (3) と 15.4 の (4) の「6.x で決める」の食い違いは、この決め方で置き換える。
  - 上限を掛けると長い変換が 7〜12% 遅くなる (19.4)。タイムアウトの最悪の合計の見積もりに入れる。
- **6.6 / 6.7 (子の入口と実行管理)**:
  - `prlimit-args.ts`: `--as=<(MAX_CHILD_RSS_MB + 2,304) × 1MiB を、親の /proc/self/limits の Max address space の hard で切り詰めた値>`。
  - 子の `env`: `{ RAYON_NUM_THREADS: '1', MALLOC_ARENA_MAX: '2' }`。
  - `--wasm-max-mem-pages=8192` はそのまま (19.5 で、PDF の経路の 3 つ目の歯止めとして働くことを確かめた)。
  - anydoc の `malformed` は、上限が足りないときにも返る (19.8)。上限の値を変えるときは、19.9 の `check-all-pass` をやり直す。
- **4.3 (実行管理の結合テスト)**: `/proc/<pid>/limits` の `Max address space` が `(MAX_CHILD_RSS_MB + 2,304) MiB` であること、子の `env` に `MALLOC_ARENA_MAX` があること、`reserve-buffer` のような「予約するが触らない」確保が `internal` で返ることをテストにできる。RSS の監視が先に効くことは、`check-rss-first` の合成の形 (JavaScript のヒープを 16MiB ずつ増やす子) で確かめられる。
- **6.11 / 6.12 (Dockerfile と image の確認)**: 値は devcontainer の glibc で測った。`node:24-slim` の image の中で、本物の実行管理と変換の層に対して、19.5 と同じ合格の条件 (すべての入力が上限なしと同じ種類とハッシュになる。メモリを増やす 15 の形がすべて RSS の監視で止まる) で 1 回ずつ流すこと。musl を使う image (alpine など) では `MALLOC_ARENA_MAX` は効かない (推論)。
- **18.10 から 3.6 への引き継ぎの 3 項目**: 「採った 4 つの部品の `VmSize` は合わせて約 17MiB」と「20MiB の HTML の `VmPeak` 1,645MiB」は、子の中で `prlimit` の上限の下で測った必要量 (19.3。20MiB の HTML は 1,856〜1,920MiB) で置き換えた。残る「WASM の部品は大きな予約をする」は、将来 WASM の部品を足すときに、19.9 の `check-all-pass` と `check-rss-first` を流し直し、必要量が上がっていないかを確かめること (chardetng-wasm は読み込むだけで約 8GiB を予約した。18.5)。
- **8.x (配布物)**: 運用者が `MAX_CHILD_RSS_MB` を変えても、上限は同じだけ動くので、別の設定は要らない。コンテナの `ulimit -v` (hard) を 2,624MiB より低くすると、親が切り詰めた値で子が起動し、19.8 の失敗 (とくに 422 の `malformed`) が起きうる。

### 19.11 RED (値を決める前の状態と、先に書いた検査)

- 記録が無かった: `grep -n "^## 19" research.md` は何も出さなかった (exit 1)。5 節の後の未決事項の表で「`RLIMIT_AS` の値と、緩めた分の守り」は「未決」だった。
- 先に `check-all-pass.mjs` と `check-rss-first.mjs` を書き、低い値で落ちることを確かめた。
  - arena の制限なし・1,536MiB: `check-all-pass ... FAIL (81 runs, 55 inputs differ from the unlimited reference)`。コーパスの DOCX などが `crashed {"signal":"SIGABRT"}`、PDF が `failed:internal:RuntimeError:Aborted`、48MB の入力が `crashed {"code":1}`。
  - arena の制限なし・2,048MiB: `check-all-pass ... FAIL (81 runs, 30 inputs differ ...)` (コーパスの PPTX が `memory allocation of 7 bytes failed` の SIGABRT、7 万セル 1 シートの XLSX などが `failed:anydoc:malformed`)、`check-rss-first ... FAIL (11 runs stopped by something other than the RSS monitor)` (JavaScript のヒープが RSS 104〜134MB で SIGABRT、`Buffer` が `RangeError`)。
  - `MALLOC_ARENA_MAX=2`・1,856MiB: `check-all-pass ... FAIL (71 runs, 4 inputs differ ...)` (20MiB の HTML が `std::bad_alloc`、7 万セル 1 シートの XLSX が `memory allocation of 352 bytes failed`)、`check-rss-first ... FAIL (11 runs ...)`。
- GREEN は 19.5 の表 (2,624MiB で両方 PASS)。

### 19.12 確かめなかったこと

- `node:24-slim` の image の中での値。devcontainer の glibc は 2.43 (Ubuntu。`ldd --version`) で、image の glibc の版は確かめていない。版が違えば arena の扱いが変わりうる。スレッドの数が違えば arena の数も変わる。k8s の上での cgroup の数え方 (19.7 は devcontainer の cgroup v2)。
- 本番の変換の層 (6.2〜6.5) と本番の親 (6.7) での値。XML の経路は `text.py` を写した近似で、XLSX のセル数の事前の検査は入れていない。
- `RLIMIT_AS` が RSS の監視より先に効く本物の入力 (合成の形でだけ示した)。anydoc と PDFium の中のすべての確保の形を試したわけではない。
- arena の揺れの原因の細部 (どのスレッドがいつ予約を作るか)。`MALLOC_ARENA_MAX=2` で残った揺れ (`csv-8m-japanese.csv` の 1,408〜1,856MiB) の原因。
- 子を同時に 3 つ動かしたときの必要量 (計測は 4 つ並べて動かしたが、互いの影響は見ていない)。
- 大きな DOC と PPT (旧形式は生成器が無く、commit 済みの小さなファイルだけ)。大きな TSV・MD・LOG・JSON・YAML (TXT・CSV と同じ経路なので、50MiB の TXT と 8MiB の CSV で代わりにした)。
- 2,624MiB で `MALLOC_ARENA_MAX` を付けない場合 (採らない場合の値は 3,392MiB とした)。

## 20. 子の最大 RSS とメモリの予算 (タスク 3.7)

2026-11-06 に devcontainer (Node 24.21.0、16 コア、Linux 6.8、glibc 2.43、THP は `madvise`、ホストのスワップは使い切り) で、使い捨ての場所 (scratchpad の `t37/`) に試作を作って測った結果。

- 変えていないもの: 抽出サービスの package、`pnpm-lock.yaml`、本番の `src/`、`test/`、`benchmark/`、Python 版、design.md、この文書の 1〜19 節と未決事項の表。
- 数字は、とくに書いていなければ **実測**。測っていないものは「未検証」、コードや文書を読んで考えたものは「推論」、2 点から線を引いたものは「外挿」と書いた。
- 「MB」は、対象 spec の書き方に合わせて MiB (1,048,576 バイト) の意味で使う (Python 版の `child_peak_rss_mb` も KiB を 1024 で割っている)。

### 20.1 結論

- **既定値は変えない**: `MAX_CHILD_RSS_MB` 320、`MAX_XLSX_CELLS` 70,000、`MAX_HTML_BYTES` 20MiB を保つ。上げも下げもしない。
- **そのために、子の形を次のように決める** (どれも子の中のことで、環境変数の契約 (Req 1.4) の外にある)。
  1. **部品の読み込み方は pdf-only**。PDF の要求の子は anydoc と PDFium を読み込み、テキスト系の部品 (htmlparser2・xmldom・yauzl/yazl など) は読み込まない。それ以外の要求の子は anydoc とテキスト系の部品を読み込み、PDFium は読み込まない (試作の `child37.mjs` の形。20.3 と 20.5 の値はこの形のもの)。all では、7 万セル 1 シートの XLSX が 302〜310MB、画像 12 枚の 48MB の DOCX が 297〜311MB になり、0.95 倍 (304MB) を超える (20.3)。
  2. **子の node に `--max-semi-space-size=4` を付ける** (`--wasm-max-mem-pages=8192` と並べる)。20MiB の HTML (18.5.1 の入力を 20MiB に切り詰めたもの) が 308〜309MB → 220〜240MB、3,000 スライドの PPTX が 320〜326MB → 219〜233MB に下がった。XLSX・DOCX・PDF (メモリの多くが V8 の外) は変わらない。時間はほぼ変わらない (20.5)。
  3. **子は受け取った入力を写さない** (3.6 の試作は `new Uint8Array(…)` で写していた。48MB の DOCX で約 +50MB)。
  4. **XLSX は、DOM を作らないセル数の事前の検査と、流し込みの書き直し (workbook.xml だけを差し替える) で渡す** (18.10 の形)。150MiB の pivot cache の XLSX が 401〜402MB → 105〜107MB に下がった。
- **この形で、対象 spec の基準のファイル (Python 版のテストが 0.95 倍で縛る 7 つ。Python と Node で作ったものの両方) と 20MiB の HTML のすべてが、各 5 回、304MB 未満で成功した** (`check-baselines … PASS`)。最も近いのは 7 万セル 1 シートの XLSX の 289〜291MB (余裕 13MB) と、画像 12 枚の 48MB の DOCX の 277〜297MB (子が自分で読んだ `VmHWM`。297 は独立のレビューの再測。余裕 7MB。対象 spec と同じ 50ms ごとの見回りの値では 243〜271MB)。
- **出力は変わらない**: 79 入力について、3.6 の形・all・pdf-only・`--max-semi-space-size` の有無で、結果の JSON のハッシュがすべて同じだった。
- **3.6 の上限 (`RLIMIT_AS` = `MAX_CHILD_RSS_MB` + 2,304MiB) はこの形でも成り立つ**: `check-all-pass 2624` が PASS (267 回)、`check-rss-first 2624` は、メモリを増やし続ける 12 の形がすべて RSS の監視で止まった (止めた時点の RSS 320〜468MB) (20.6)。
- **メモリの予算は (A) の形 (親は応答を少しずつ書き、結果を一括の入れ物で受け取る) に決めた** (20.10。ユーザーが決めた、2026-11-09)。最も重い負荷の実測は 1,135〜1,285MiB (cgroup の増え方 + 待機時。5 回 = この作業の 3 回と独立のレビューの 2 回。Python 版 1,230MiB、今の形 `c.json` の Node 版 1,402MiB) で、2Gi まで約 760MiB 余る。すべての項を最悪の値で足す見積もりは 2,089〜2,131MiB で 2Gi を 41〜83MiB 超えるが、2Gi を守る根拠は実測にすることを、ユーザーが承認した (20.7a、20.10)。
- **最悪の合計時間は約 70 秒** (受信 15 秒 + 変換 55 秒 + 停止と回収 6〜12ms、回収の待ちの上限 2 秒を足しても 72 秒)。apps/app の既定 `timeoutMs` 90 秒と、k8s の `terminationGracePeriodSeconds` 85 秒より短い (20.8)。
- **2 節の食い違いの原因** (20.4): (a) 1.5 の「Python 167MB / Node 193MB」は、対象 spec の基準のファイルとは別の 7 万セルのファイル (推論で、素のプロセスで測ったもの)。(b) 対象 spec の「285MB」は、**測るスクリプトの一番外側の import の違い**で再現した。Python 版の子は親の `__main__` (起動したスクリプト) を子の中でもう一度 import するので、テスト用の生成器 (openpyxl・python-docx など) を一番外側で import するスクリプトで測ると、子の土台が約 40〜45MB 重くなり、7 万セルの XLSX で 285MB になる。標準ライブラリだけのスクリプトでは 237MB、本番と同じ uvicorn の起動では 242MB。Node 版の子は毎回新しく起動するので、この影響を受けない。
- **ユーザー判断が要る事項: なし** (メモリの予算は 20.10 で決まった)。対象 spec の AC を満たせないものは見つからなかった。
- **Python 版は通すが Node 版は RSS の上限で止める入力の範囲** がある (1 つの要素が約 48MiB の画像を持つ XLSX、結果の字数の多い ASCII の DOCX、1 ページの文字の多い PDF)。どれも対象 spec の約束の外なので止めないが、検索の対象が狭まることとして報告し、6.6 に引き継ぐ (20.9)。

### 20.2 測り方

| 項目 | 値 | 本物 (design と 15・19 節) との関係 |
|---|---|---|
| 起動 | `/usr/bin/prlimit --as=2624MiB --cpu=60:65 --core=1 -- node --wasm-max-mem-pages=8192 [--max-semi-space-size=4] child37.mjs` | 19.1 の値 |
| `env` | `{ RAYON_NUM_THREADS: '1', MALLOC_ARENA_MAX: '2' }` | 19.1 |
| fd・見張りの worker・`oom_score_adj` | 15.5 と同じ (`t37/child37.mjs` は `t3/child.mjs` の写し) | 同じ |
| 入力の渡し方 | 長さを先に付けた見出しと本文を fd 0 に書く。親で連結しない形 (断片のまま) も試した (20.7) | 16.9 |
| XLSX | 20.1 の 4 (yauzl で全部の要素を流して `<c` を数える (`xlsx_split.py` の `_CELL_START` と同じ正規表現)。超えたら `limit_exceeded`。yazl で workbook.xml だけ差し替えて流してつなぐ) | 18.10 |
| 同時実行 | 1 件ずつ順に動かす (20.3〜20.5)。同時 3 件は 20.7 | — |
| RSS の監視 | 測るときは止めない (止める値を十分大きくする)。本番の判定は 320MB で別に確かめた (20.6) | — |

**「最大 RSS」の取り方**: 対象 spec と同じく、親が 50ms ごとに `/proc/<pid>/status` を読み、`VmRSS` と `VmHWM` の大きいほうを KiB で取り、1024 で割って切り上げる (Python 版 `child_supervision.py` の `_sample_rss` と `peak_rss_mb`)。ただしこの方法は、**終わる直前の 50ms 以内の山を取り逃がす** (Python 版の画像 12 枚の DOCX は、同じファイルで 134〜233MB とばらついた)。そのため、子が結果を書く直前に自分の `VmHWM` を読んだ値も取り、**表の「最大 RSS」は両方の大きいほう**にした。対象 spec と同じ見回りだけの値は「見回り」と別に書く。各サンプルで `VmSwap` も読み、**すべての計測で 0 だった** (ホストのスワップが使い切りでも、子のページはスワップに出ていない)。

回数: 基準のファイルは各 5 回、ほかは各 3 回。Python 版は 8 節の venv で、本物の `ConversionRunner.from_settings(Settings())` を scratchpad のスクリプト (`t37/py/py_measure.py`) から呼んで測った (Python 版のテストと同じ入口)。Python 版のテストそのもの (`test_the_default_limits_let_large_legitimate_files_through`) にも、`child_peak_rss_mb` を表示するだけの pytest の部品 (`t37/py/t37plugin.py`) を付けて 3 回流した。

### 20.3 対象 spec の基準のファイル

Python 版の `test_child_isolation.py` の `test_the_default_limits_let_large_legitimate_files_through` が `child_peak_rss_mb < 0.95 × MAX_CHILD_RSS_MB` で縛る 7 つ。「Py 作」は Python 版のテストの生成器 (openpyxl、python-docx、python-pptx) で作ったファイルそのもの、「Node 作」は 2.x の Node の生成器で作ったもの。単位は MB、範囲は回ごとの最小〜最大。

| 入力 | Python 版 (今日、見回り) | Node: 3.6 の形 (all、写しあり、全部読む XLSX) | Node: all | Node: pdf-only | **Node: 採る形 (pdf-only + `--max-semi-space-size=4`)** (見回り) |
|---|---|---|---|---|---|
| 7 万セル 1 シートの XLSX (Py 作) | 237 | 305〜310 | 302〜307 | 290〜291 | **290〜291** (290〜291) |
| 同 (Node 作) | 237 | 307〜310 | 303〜308 | 289〜291 | **289〜291** (289〜291) |
| 7,000 行 × 10 列の XLSX (Py 作) | 183〜184 | 250〜252 | 253〜254 | 235〜236 | **235〜237** |
| 5 シート × 1 万 4 千行 (Py 作 / Node 作) | 97〜98 | 172〜175 / 168〜174 | 166〜169 / 166〜171 | 151〜152 / 150〜151 | **151 / 150〜151** |
| 画像 12 枚の 48MB の DOCX (Py 作) | 134〜233 | 348〜355 | 300〜307 | 278〜279 | **278〜280** (243〜259) |
| 同 (Node 作) | 150〜229 | 338〜358 | 297〜311 | 283〜296 | **277〜297** (246〜271。297 は独立のレビューの再測) |
| 画像の多い 46MB の DOCX (Py 作 / Node 作) | 124〜215 | 328〜334 / 318〜335 | 278〜289 / 274〜294 | 262〜263 / 258〜279 | **262〜264 / 257〜277** |
| 画像の多い 46MB の PPTX (Py 作 / Node 作) | 75〜120 | 194〜198 / 190〜191 | 153〜155 / 147〜148 | 134〜136 / 130〜131 | **135〜136 / 131〜134** |
| 150MiB の pivot cache の XLSX (Py 作 / Node 作) | 34 | 401〜402 / 401〜402 | 122〜142 / 122〜137 | 105〜107 | **106〜107 / 105〜107** |
| 20MiB の HTML (18.5.1 の入力を 20,971,520 バイト以内に切り詰めたもの) | 137〜149 | — | 324 (切り詰める前) | 308〜309 | **220〜240** |
| 20MiB の HTML (2.x の生成器のもの。同じく切り詰めた) | 102〜116 | — | 226〜241 (切り詰める前) | 211〜219 | **170〜184** |

- **all か pdf-only か**: all では XLSX と DOCX の 2 つが 304MB を超える。PDFium を読み込む分 (約 15〜25MB。待機中の子で all 93〜97MB、pdf-only 78〜83MB) が、そのまま基準のファイルに乗るためである。pdf-only なら超えない。`MAX_XLSX_CELLS` を下げても DOCX は直らないので、**pdf-only を採る**。15.7 の「3.6 で合わせて決める」、14.5 の (3) と 15.4 の (4) の「6.x で決める」は、この決定で置き換える。上限 (`RLIMIT_AS`) は all で決めたので、pdf-only でも足りる (19.10)。
- **入力を写さない効果**: 48MB の DOCX で 3.6 の形 338〜358MB → 写さない形 297〜311MB (all どうし)。
- **流し込みの XLSX の効果**: pivot cache で 401〜402MB → 105〜142MB。7 万セルの XLSX でも 3〜5MB 下がった。セル数の事前の検査を足しても、7 万セルの XLSX の最大 RSS は増えなかった (検査は anydoc の前に終わる)。
- **Python 版との差**: 採る形の Node は、Python 版 (今日) より 7 万セルの XLSX で +53MB、7,000 × 10 列で +52MB。子の土台の差 (待機中の子が Node 78〜83MB、Python 28〜30MB) がほぼそのまま乗っている。
- 64KiB ずつ流し込む HTML の形 (18.5.1 の (3)) は採らない。`--max-semi-space-size=4` だけで 304MB を十分に下回り、Python 版と合わせる 5 点 (18.10) を作り直す必要がないため。

### 20.4 2 節の食い違いの原因

2 節は「対象 spec の 285MB (7 万セル 1 シートの XLSX、上限の 89%)」と「1.5 の Python 167MB」の食い違いだった。同じ 7 万セル 1 シートのファイル (Python 版の `write_xlsx_cells([("Data", 70000, 1)])`) で、2 × 2 で測り直した。

| 測り方 | Python 版 | Node 版 |
|---|---|---|
| 本物の子 (Python: `ConversionRunner`、forkserver の子、見回り。測るスクリプトは軽い形。下の (b)) | **237** (5 回とも。`python -m pytest` で Python 版のテストそのものを流しても 3 回とも 237) | 採る形で 289〜291 |
| 素のプロセス (ファイルを読み、anydoc を 1 回呼び、`VmHWM`) | 225 (3 回とも。読む前は 23) | 252 (3 回とも。読む前は 50) |
| 1.5 の記録 | 167 | 193 |
| 対象 spec の記録 (2026-10-28、`1e530f8fea`) | 285 | — |

- **1.5 の数字は別のファイル**: 1.5 は出力を 964,002 字と書いているが、対象 spec の基準のファイルの出力は 898,898 字だった (Python と Node で同じ)。素のプロセスの Node と Python の差は、1.5 が +26MB、今日が +27MB で同じ。このことから、1.5 は素のプロセスで測ったもので、ファイルだけが違うと見られる (推論。1.5 の測り方の記録は無く、どのファイルかも見つからなかった)。
- **285MB は、測るスクリプトの一番外側の import で再現する**: Python 版の子は、multiprocessing の仕組みで、親の `__main__` (起動したスクリプト) を子の中でもう一度 import する (対象 spec の design.md の Performance & Scalability にも「子を作るたびに uvicorn の起動スクリプトを読み直す」とある)。そのため、測るスクリプトが一番外側で何を import しているかで、子の土台と最大 RSS が変わる。本物の `ConversionRunner.from_settings(Settings())` を、同じ機械・同じ日に、スクリプトだけを替えて動かした。

| 入力 | 重い形 (一番外側でテスト用の生成器 `fixture_files` を import) | 軽い形 (一番外側は標準ライブラリだけ) | 本番と同じ uvicorn の起動 (8 節の手順。ログの `child_peak_rss_mb`) | 対象 spec の記録 |
|---|---|---|---|---|
| 待機中の子 | この作業 73 / レビュー 69〜71 | この作業 28 / レビュー 28 | 28 | 約 80 |
| 7 万セル 1 シートの XLSX | この作業 285 (3 回とも) / レビュー 285 (3 回とも) | この作業 236〜237 / レビュー 237 | 242 (3 回とも) | 285 |
| 7,000 行 × 10 列 | この作業 232 / レビュー 231 | この作業 183〜184 / レビュー 183〜184 | 189 (3 回とも) | 231 |
| 5 シート × 1 万 4 千行 | この作業 145 / レビュー 145〜146 | この作業 97 / レビュー 97〜98 | — | 146 |
| 画像 12 枚の 48MB の DOCX | この作業 198〜242 / レビュー 220〜282 | この作業 150〜233 | — | 281 |

  - 重い形では、対象 spec の記録の値がそのまま出る。差の約 48〜50MB は、測るスクリプトの違いで説明できる。対象 spec の research.md には 285MB を測ったスクリプトの記録が無いので、「対象 spec がこの方法で測った」とは断定しない。「この仕組みで数字が完全に再現する」までを書く。
  - この作業の道具は、`t37/py/py_measure.py` (軽い形) と、それを一番外側で `fixture_files` と一緒に import する `t37/py/py_measure_heavy.py` (重い形)。レビュアーの道具は `rv37/pyrun.py` (重い形) と `rv37/pyrun_lean.py` (軽い形)。
  - 前の版のこの節にあった「環境による差と見られる」は誤りだった。`RAYON_NUM_THREADS`・glibc の THP の設定・記録した commit (`1e530f8fea`) のコードでも値が変わらなかったのは、どれも軽い形のスクリプトで測っていたためである。
  - **Python 版の本来の子の最大 RSS** (7 万セル 1 シートの XLSX) は、軽い形で 237MB、本番と同じ uvicorn の起動で 242MB。Node 版の採る形 (289〜291MB) は、これより約 50MB 多い。
  - **Node 版はこの影響を受けない**: Node 版の子は、親の `__main__` を読み込まず、毎回 `prlimit` から新しく起動するプロセスである (15 節)。

- **扱い**: 基準の値は記録ではなく、**同じ日に同じ環境で測った値どうし**で比べる。そのうえで、0.95 倍 (304MB) の判定は Node 版の値そのものに掛ける。この節の Node 版の値は、対象 spec の記録の 285 にも、今日の Python 版の 237 にも依らない。
- **本番の image での測り直し**: Node 版の余裕 (XLSX 13MB、DOCX 7MB) は薄い。本番の image (`node:24-slim`) の glibc とメモリの割り当て方は devcontainer と違いうる (差の大きさは未知) ので、本番の image の中で測り直すこと (20.12 の 6.11 / 6.12)。

### 20.5 追加のファイル

採る形 (pdf-only + `--max-semi-space-size=4`、各 3 回) の最大 RSS と、Python 版 (今日、各 3 回、見回り)。「約束」は、対象 spec のテストか AC が成功を約束しているかどうか (基準の 7 つは 20.3。ここにあるものはどれも約束の外)。「判定」は、本番の RSS の監視 (320MB) の下での結果。

| 入力 | 大きさ | Python 版 | Node 版 (採る形) | Node: pdf-only のみ | 判定 (Node / Python) |
|---|---|---|---|---|---|
| 20MiB の HTML (レビュアーのもの) | 20.0MiB | 106〜116 | 183〜185 | 202〜206 | 成功 / 成功 |
| 190 万段の入れ子の HTML | — | 72 | 124〜125 | 123〜124 | 成功 / 成功 |
| 1,000 スライドの PPTX (0.9MB / レビュアーの 1.8MB) | — | 42 / 50 | 139〜143 / 164〜165 | 189〜194 / 248〜256 | 成功 / 成功 |
| 3,000 スライドの PPTX (2 種類) | 2.7MB | 54 | 219〜233 | 320〜326 | **成功** / 成功 (semi=4 なしだと Node は止まる) |
| 200 シート / 2,000 シートの XLSX | — | 53〜56 / 62〜63 | 118〜119 / 159〜200 | 110〜121 / 183〜200 | 成功 / 成功 |
| 5,000 ページの PDF | — | 50〜53 | 113 | 109〜113 | 成功 / 成功 |
| 48MiB の画像 12 枚の PDF | 48MiB | 128 | 236 | 236〜237 | 成功 / 成功 |
| 2,000 ページ × 6,000 字の PDF (レビュアーのもの) | 12MB | 94〜115 | 164〜193 | 181〜201 | 成功 / 成功 |
| 1 ページ 100 万字 / 200 万字の PDF | — | 145 / 253〜256 | 190〜191 / 293〜294 | 189〜190 / 293〜296 | 成功 / 成功 |
| 画像 12 枚の DOCX (レビュアーのもの) | 48.05MiB | 134〜224 | 277〜289 | 288〜295 | 成功 / 成功 |
| ASCII の文字の DOCX (結果 1,530 万字。`MAX_RESULT_BYTES` の近く) | — | **312〜313** | **358〜380** | 359〜380 | **止まる (`memory_exceeded`)** / 成功 |
| 日本語の文字の DOCX (レビュアーのもの。結果 583 万字・UTF-8 で 16.4MB、`MAX_RESULT_BYTES` の直前) | 0.25MB | 207〜208 | 253〜262 | 253〜275 | 成功 / 成功 |
| ASCII の文字の DOCX (結果 1,020 万字 / 1,275 万字) | — | 220 / 266 | 266〜295 / 312 | — | 成功 / 成功 (1,275 万字は 304MB を超えるが 320MB の内側) |
| 8MiB の日本語の CSV (2 種類。上限以内に切り詰めたもの) | 8.0MiB | 126〜138 | 168〜195 | 168〜198 | 成功 / 成功 |
| 50MiB 近い cp932 の TXT | 49.9MiB | 147〜182 | 231〜232 | 228〜232 | 結果超過 / 結果超過 |
| 15MiB の UTF-8 の TXT | 15MiB | 87〜91 | 112〜116 | 113〜115 | 成功 / 成功 |
| 48MiB の XML | 48MiB | 248 | 262〜263 | 318〜319 | 結果超過 / 結果超過 |
| 16MB の ipynb、10MB の RTF・ODT、10 万段落の ODT、7 万セルの ODS、50 シートの ODS | — | 119〜158 | 165〜195 | 165〜222 | 成功 / 成功 |
| 7 万 / 30 万セルの XLS、6 万セルの XLS (レビュアーのもの) | — | 60〜148 | 107〜195 | 105〜195 | 成功 / 成功 |
| 200 章 / 1,500 章の EPUB、1,000 ページの ODP | — | 30〜68 | 83〜120 | 83〜120 | 成功 / 成功 |
| 50MiB 上限いっぱいの DOCX (画像 13 枚) | 49.2MiB | 148〜165 | 281〜288 | 281〜301 | 成功 / 成功 |
| 同、PPTX (画像 13 枚) | 49.2MiB | 81〜82 | 135〜137 | 137 | 成功 / 成功 |
| 同、PDF (画像 13 枚) | 49.2MiB | 130〜134 | 239〜240 | 239 | 成功 / 成功 |
| 同、XLSX (7 万セル + 48MiB の無圧縮の画像の要素) | 48.5MiB | 87〜129 | 226〜227 | 227〜228 | 上限超過 / 上限超過 (下の注) |
| 同、XLSX (6 万 9 千セル + `<` を含まない 48MiB の画像の要素) | 48.5MiB | **333〜370** | **427〜433** | — | 止まる / 止まる |
| XLSX (100 / 2 万 / 4 万セル + `<` を含まない 48MiB の画像の要素) | 48MiB | 128 / 236 / 294 | **324〜325 / 325〜326 / 342〜346** (見回りでは 269〜300 / 325〜326 / 342〜346) | — | **止まる** (100 セルは見回りの時期によって通る) / 成功 |
| 同、書き直す package から XML 以外の要素 (画像) を外した場合 (6.6 への案。出力のハッシュは 8 入力で同じ) | 48MiB | — | 224〜227 / 284〜285 / 344〜345 | — | 成功 / 成功 / 止まる |
| ベンチマークのコーパス (23 文書) | 小 | 30 | 79〜94 | 78〜95 | 成功 / 成功 |
| 細工: `[Content_Types].xml` に兄弟の要素 6 万個の PPTX | 0.3MB | 68 | 233〜238 | — | 成功 / 成功 |
| 細工: `presentation.xml` に閉じない開始タグ 20 万個の PPTX | 5KB | 84〜87 | 321〜336 | — | **止まるか `malformed`** (回による) / `malformed` |
| 細工: workbook.xml に `definedName` 6 万個の XLSX | 0.16MB | 91 | **306〜318** | — | 成功 (上限の際) / 成功 |

注と読み方:

- **3,000 スライドの PPTX は、`--max-semi-space-size=4` で止まらなくなった** (320〜326 → 219〜233MB)。18.10 の「正しい文書が `MAX_CHILD_RSS_MB` で止められる大きさ」の PPTX は、3,000 スライドまでは無い。4,000 スライドより大きいデッキは測っていない (未検証)。
- **20MiB の HTML は、どの入力でも 304MB を十分に下回った** (採る形で最大 240MB)。18.10 の「20MiB の HTML が上限の際に当たる」は、`--max-semi-space-size=4` を付けない子の話だった。**`MAX_HTML_BYTES` を下げる必要は無く、Req 1.4 / 1.9 / 1.10 の手続きも要らない**。なお、18.5.1 の入力 (20,971,684 バイト) と 3.6 の HTML の入力 (20,971,525 バイト) は `MAX_HTML_BYTES` (20,971,520) をわずかに超えていて、本番では子を作る前に断られる。上の表の値は、上限以内に切り詰めたもので測った。8MiB の日本語の CSV (8,388,660 バイト) も同じく切り詰めた。
- **50MiB の XLSX の 2 つ**: (1) 7 万セルちょうどに 48MiB の乱数の画像を足すと、画像のバイト列の中に `<c` に一致する並びがあり、セル数の検査で `limit_exceeded` になる。Python 版も同じ結果で、すべての要素を数える既存の振る舞い (`xlsx_split.py`) である。(2) `<` を除いた画像にすると検査は通るが、Node 版 427〜433MB、Python 版 333〜370MB で、**どちらも RSS の上限で止まる**。書き直した package と元の入力と anydoc の中の写しに、48MiB の画像が 3 重に乗るためと見られる (推論)。この 6 万 9 千セルの形は、Node 版で新しく止まる入力ではない。**ただし、もっと少ないセル数では Python 版は通り、Node 版は止まる** (100 セルでも 324〜325MB。次の項)。
- **大きな画像を持つ XLSX** (止まるのは、1 つの要素が約 48MiB の画像を持つ形と、画像の合計が 45MiB 級でセルも多い形): Python 版は 4 万セルでも 294MB で通るが、Node 版は、1 つの要素が約 48MiB の画像のとき、100 セルで 324〜325MB (レビュアーの再測 319〜325MB)、2 万セルで 325〜326MB になり、RSS の上限で止まる。独立のレビューの実測では、**5MiB ずつの画像に分けたものは通った** (30MiB の画像と 2 万セルで 232MB、45MiB の画像と 1,000 セルで 261〜270MB)。45MiB の画像と 4 万セルは Node 版 334〜336MB、Python 版 332〜333MB で、どちらも止まった。画像の無い 7 万セルの XLSX (289〜291MB) より重いので、`MAX_XLSX_CELLS` を下げても直らない。書き直す package から画像などの XML でない要素を外すと、100 セルで 224〜227MB、2 万セルで 284〜285MB に下がり、出力は 8 入力 (画像の XLSX 4 つ、コーパス、7 万セル、200 シート、pivot cache) で同じだった。4 万セルは外しても 344〜345MB で止まる。外す形は 6.6 への案とし、ここでは採ると決めない (anydoc が画像の要素を読まないことを、版を固定した契約テストで確かめてから採る)。同じ大きさの画像の DOCX (277〜297MB) と PPTX (131〜137MB) は通る。
- **結果の字数の多い ASCII の DOCX** と **1 ページの文字の多い PDF** は、Python 版は通り、Node 版は止まる範囲がある (20.9)。
- **閉じない開始タグの PPTX** は、Python 版は `malformed` (422 `extraction_failed`)、Node 版は RSS の監視と XML の誤りのどちらが先かで、`memory_exceeded` (422 `resource_limit_exceeded`) か `malformed` になる。18.7 の表に記録済みの違いと同じ。
- **workbook.xml の `definedName` 6 万個** は、xmldom の DOM で 306〜318MB になり、320MB の際に当たった (3 回とも成功したが、環境によっては止まりうる)。普通のブックの名前の数 (数十〜数百) からは遠い細工である。
- 時間は、どの入力でも採る形で 3.1 秒以内 (最長は 3,000 スライドの PPTX の 2.7〜3.1 秒)。`--max-semi-space-size=4` の有無で、時間の差は回ごとのばらつきの中だった (20MiB の HTML で 1,016〜1,054ms 対 1,050〜1,074ms)。

### 20.6 決めた値と、3.6 の検査のやり直し

| 項目 | 決めた値 | 根拠 |
|---|---|---|
| `MAX_CHILD_RSS_MB` | **320 (変えない)** | 基準のファイルがすべて 304MB 未満 (20.3)。予算は実測で 2Gi に収まる (20.7a、20.10)。下げても見積もりの超過は解けない (基準のファイルが 0.95 倍を超える) |
| `MAX_XLSX_CELLS` | **70,000 (変えない)** | 7 万セル 1 シートの XLSX が 289〜291MB (20.3)。画像の無い (小さい) XLSX では、検索の対象になる範囲は変わらない。**48MiB 級の画像を持つ XLSX は、セル数の上限より手前で RSS の上限に当たる** (20.5、20.9)。これはセル数の上限を下げても直らないので、`MAX_XLSX_CELLS` の値の問題ではない |
| `MAX_HTML_BYTES` | **20MiB (変えない)** | 20MiB の HTML が最大 240MB (20.3、20.5) |
| 部品の読み込み | **pdf-only** | all では基準のファイル 2 つが 304MB を超える (20.3) |
| 子の node の引数 | **`--wasm-max-mem-pages=8192 --max-semi-space-size=4`** | HTML と PPTX の分割で 70〜100MB 下がる。出力と時間は変わらない (20.3、20.5) |
| 子の入口 | **入力を写さない** | 48MB の入力で約 50MB 下がる (20.3) |
| XLSX の書き直し | **流し込み (18.10 の形) と、DOM を作らないセル数の検査** | pivot cache の XLSX で 400MB → 106MB (20.3) |
| 下げるときの予備の値 | `MAX_XLSX_CELLS` 65,000 (274〜275MB) / 60,000 (261〜262MB) | 採る形で各 5 回。20.12 の image での測り直しで 7 万セルが 304MB を超えたときに使う。Req 11.11 の範囲なので、諮らずに下げてよい |

**3.6 の検査を採る形でやり直した** (`t37/ref.mjs`・`check-all-pass.mjs`・`check-rss-first.mjs`。3.6 の道具を `supervise37.mjs` に向け、`preload=pdf-only`、`--max-semi-space-size=4`、流し込みの XLSX にした):

| 検査 | 結果 |
|---|---|
| `check-all-pass 2624 pdf-only` (上限なしの子の最大 RSS が 320MB 以下の入力 89 個 × 3 回、RSS の監視なし) | **PASS** (267 回。すべて上限なしと同じ種類とハッシュ) |
| `check-rss-first 2624 pdf-only` (14 の形 × 3 回、RSS の監視 320MB) | **PASS** (42 回。止めた時点の RSS は 321〜457MB)。3.6 の 15 の形のうち、3,000 スライドの PPTX・pivot cache の XLSX・48MiB の XML の 3 つは、採る形ではメモリを増やし続けなくなった (最大 233MB・107MB・263MB で、成功・成功・結果超過で終わる) ので、`check-all-pass` の側 (上の行) で確かめ、ここからは外した。代わりに、いまもメモリが増え続ける本物の入力 2 つ (6 万 9 千セルと 48MiB の画像の XLSX、閉じない開始タグの PPTX) を足した。後者は XML の誤りが先に出る回があるので、`memory_exceeded` か `malformed` を合格とした (3 回のうち 1 回が `malformed`) |
| 同、外す前の 15 の形での 1 回目 | 12 の形 (36 回) はすべて `memory_exceeded` (止めた時点の RSS 320〜468MB)。外した 3 つは上のとおり成功・成功・結果超過。`crashed` と `internal` は 0 |

2 回の計測を通した、止めた時点の RSS の最大 468MB (= 320 + 148。`Buffer.alloc` を 256MiB ずつの形) は、3.6 の 442MB より大きかった。予算 (20.7) にはこの 148MB を使う。

### 20.7 メモリの予算

**親の待機時と、3 件の同時の実測** (`t37/load37.mjs`。16.8 の受け取りの手本 (`rv36/v2/server.mjs`) の代わりの変換を本物の子に替えた `t37/srv/server.mjs` に、3 件を同時に 3 回続けて送る。20ms ごとに親の `VmRSS`、子の `VmRSS` の合計、cgroup v2 の `memory.current` を読む。各条件を 3 回 (交互の送信は 2 回))。単位は MiB。

| 送ったもの | 親の最大 RSS (`VmHWM`) | 子の RSS の合計の最大 | 親 + 子の最大 | cgroup の増え方の最大 (待機中の親を除く) | 親のイベントループの遅れの最大 |
|---|---|---|---|---|---|
| (待機中) | 69 | — | — | — | — |
| 7 万セル 1 シートの XLSX × 3 | 89〜108 | 878〜887 | 961〜969 | 756〜764 | 17〜21ms |
| 画像 12 枚の 48MB の DOCX × 3 | 243〜246 | 742〜786 | 988〜1,030 | 772〜813 | 16〜24ms |
| 20MiB の HTML (18.5.1 の入力) × 3 | 343〜352 | 689〜704 | 885〜952 | 756〜819 | 70〜79ms |
| 49.2MiB の DOCX × 3、子は 16,000,000 バイトの日本語の結果を返す | 451〜480 | 482〜484 | 790〜855 | 644〜719 | 84〜148ms |
| 同、**子は制御文字 550 万字の結果を返す** (UTF-8 で 5.5MB なので子の 16MiB の検査を通るが、JSON では 1 字 6 バイトになり、結果の枠が上限 32MiB + 64KiB の直前の 33MB になる。**結果の最も重い形**) | **568〜639** | 587〜590 | 919〜967 | 825〜849 | 199〜208ms |
| 同、親が応答を少しずつ書く形 (下の注) | 503〜540 | 572〜588 | 911〜950 | 756〜794 | 179〜194ms |
| 上の制御文字の結果の 3 件と、上限まで伸びる子 3 件 (`Buffer.alloc` を 256MiB ずつ) を交互に 4 回 (**最も重い組み合わせ**) | 550〜636 | 847〜983 | 1,199〜1,334 | 1,068〜1,231 | 198〜365ms |
| 50MiB を 16KiB と 1 バイトの交互で × 3、16MB の日本語の結果 (`rv36/tools/alt.mjs`) | 437〜445 | — | — | — | — |
| 同、子へ書き終えたら親が受け取った断片を手放す形 | 442〜488 | — | — | — | — |
| 同、制御文字の結果 / 応答を少しずつ書く形 | 552〜617 / 508〜517 | — | — | — | — |

- 結果を返す要求はすべて 200、上限まで伸びる子は 422 (`memory_exceeded`) で、`VmSwap` は 0 だった。
- **16.9 の T4 の「仮に満たす」**: 子への書き込みを含めた 50MB 級 × 3 件の親の最大 RSS は 243〜246MB で、Python 版の 263MiB (子への受け渡しを含む) を超えない。T4 のメモリの基準は満たす。
- **親が最も膨らむのは、3 件の大きな結果を同時に受け取って JSON を解き、応答を作るとき**。結果の枠 (最大 33MB) を文字列にしたもの、解いたもの、応答の文字列 (`c.json` がもう一度 33MB を作る)、送る `Buffer` が同時にある。受け取った断片を子へ書き終えた時点で手放しても下がらなかった (GC の時期による)。
- **親が応答を少しずつ書く形** (`STREAM_RESPONSE=1`): 応答の JSON を、ページごと・本文 64Ki 字ごとに `JSON.stringify` して `ReadableStream` で書く (送る中身は同じ 33,000,125 バイト)。応答の文字列を丸ごと作らないので、親の最大が 568〜639 → 503〜540MiB に下がった。
- 子 1 つずつの値は記録していない。同時 3 件の子の合計 (7 万セルの XLSX で最大 887MiB) を 3 で割ると約 296MiB で、1 件ずつ測った値 (289〜291MB) とほぼ同じだった。
- 子の RSS の合計より cgroup の増え方が小さいのは、node の実行ファイルなどの共有のページが一度しか数えられないためと見られる (19.7 と同じ。推論)。

**予算の式** (Python 版の式「ワーカー数 × 120MB + ワーカー数 × `MAX_CONCURRENCY` × (`MAX_CHILD_RSS_MB` + 100MB + アップロード 2 × `MAX_FILE_SIZE_MB` + 結果 16MiB × 3)」の、Node 版の形。ワーカーの項は D1 で無くなった)。各項を、それぞれの最悪の値で足す (`t37/check-budget.mjs`):

```
上限の見積もり = 親の待機時 + MAX_CONCURRENCY × (MAX_CHILD_RSS_MB + 監視の遅れ + 親の 1 件あたりの受け取りと結果) + /tmp の tmpfs

親が応答を 1 つの文字列に組む形 (c.json):  69 + 3 × (320 + 148 + 190) + 64 = 2,107MiB  > 2,048MiB (2Gi)、59MiB 超える
親が応答を少しずつ書く形:                  69 + 3 × (320 + 148 + 157) + 64 = 2,008MiB  ≤ 2,048MiB、余裕 40MiB
```

(この 2 行は、子が合成の結果 (`big-result`) を返す形で測った値から出したもの。本物の変換の結果で測り直した値と、Python 版との比べ方は 20.7a にある。本物の変換では、少しずつ書く形でも 2,125MiB になる。)

| 項 | 値 | 出どころ |
|---|---|---|
| 親の待機時 | 69MiB | 実測 (上の表)。本番の親はログの部品などで少し増えうる (推論) |
| `MAX_CHILD_RSS_MB` | 320 | 既定値 |
| 監視の遅れ | 148MiB | 実測。RSS の監視が止めた時点の RSS の最大 468MB − 320 (20.6) |
| 親の 1 件あたり | 190MiB / 157MiB | 実測。(親の最大 − 待機時 69) ÷ 3 を切り上げた。親の最大は、1 つの文字列に組む形で 639MiB、少しずつ書く形で 540MiB |
| `/tmp` の tmpfs | 64MiB | k8s の例の `sizeLimit`。Node 版の子は `/tmp` に書かないが (T2)、何かが書いた場合の上限として足した |
| 実測の cgroup の最大 (待機中の親を含む) | 1,300MiB | 上の表の最も重い組み合わせの 1,231 + 69 |

- **この式は安全側に倒れている**。同じ枠の子と結果は同時にない (親が結果の JSON を解くのは、子が終わって回収された後)。ただ、親は応答の後も RSS を待機時に戻さない (16.6) ので、前の要求の結果の分が、次の子と重なることはある。最も重い組み合わせの実測 (1,334MiB、cgroup 1,300MiB) は、その重なりを含んでいる。
- この節の式と値は、子が合成の結果を返す形で出したもの。本物の変換の結果で測り直した値、Python 版との比べ方、決めた形 (A) の値は 20.7a にあり、決定は 20.10 にある。
- 同時実行数 3 は、Req 3.14 の「既定の設定 (枠 3)」のとおり。`MAX_FILE_SIZE_MB` も 50 のまま。
- 運用者が `MAX_CONCURRENCY` や `MAX_CHILD_RSS_MB` を変えたら、同じ式で limits を計算し直す (k8s の例の deployment.yaml の頭の注の式を、8.x でこの式に置き換える)。
- k8s の CPU の上限 2 で 3 件が同時に動くと、変換は遅くなる (推論。2 コアの制限の下では測っていない)。メモリの量は変わらない見込み。

### 20.7a Python 版 (書き換える前) との比べ方と結果

2026-11-09 に、20.7 と同じ式・同じ道具・同じ入力で Python 版を測り、Node 版と並べた (ユーザーの求め: 「2Gi を 59MiB 超える」ことが Python 版と比べてどうかが分からないと判断できない)。

**結論**:

- **同じ式で見積もると、Python 版は 1,987MiB で 2Gi に収まる (余裕 61MiB)。Node 版は今の形 (`c.json`) で 2,188MiB になり、140MiB 超える**。Node 版は Python 版より約 200MiB 悪い。
- **実測の最悪 (大きな結果と上限まで伸びる子を交互に流す) は、Python 版 1,230MiB、Node 版 1,402MiB** (cgroup の増え方に待機時を足した値)。Node 版が約 170MiB (14%) 多い。どちらも 2Gi まで 600MiB 以上の余裕がある。
- 差のほとんどは**親が大きな結果を受け取って応答にする所**にある。1 件あたり、Python 版 75MiB、Node 版 155MiB。Python は使い終えた写しを参照の数え方ですぐ手放すが、V8 は GC まで手放さないためと見られる (推論。コードを読んだ範囲と、下の写しを減らす試作の効き方から)。
- 応答を少しずつ書く形 (A) と、結果を 1 つの入れ物に受け取る直し (下の「一括で受け取る形」) で、Node 版の見積もりは 2,089〜2,131MiB まで下がった。それでも Python 版の 1,987MiB には届かず、2Gi を 41〜83MiB 超える。一方、実測の最悪は 1,135〜1,285MiB (5 回) で、Python 版 (1,230MiB) と同じ程度まで下がった (2026-11-09 に追加で測った)。20.7 の「(A) で 2,008MiB に収まる」は、合成の結果 (`big-result`) での値だった。本物の変換の結果ではこの節の値になる。

**同じにした条件**:

- 入力:
  - (S1) 制御文字 (0x01) だけの 5.5MB の TXT。変換の結果は 550 万字で、JSON にすると約 33MB になる。Python 版も Node 版も、本物の変換でこの結果を返した。
  - (S2) S1 の TXT と、上限まで伸びて止められる 8MiB の CSV (1 字のセルが約 420 万個) を交互に流す。Python 版は 343〜350MB、Node 版は 336〜349MB で止められる。
  - (S3) 49.2MiB の DOCX (受け取りの重さを測る)。
- 同時実行は 3 件。S1 と S3 は 3 回続けて送り、S2 は 4 回続けて送った。
- 子の上限は 320MB。Node 版は採る形 (pdf-only、`--max-semi-space-size=4`)。
- 計測は、どちらも同じ道具 (`t37/load37x.mjs`) で、20ms ごとに読んだ。読んだのは、サーバーのプロセスの `VmRSS`、その下のすべてのプロセスの `VmRSS` の合計 (Python 版は forkserver・resource tracker・子)、`VmSwap`、cgroup の `memory.current`。
- サーバーは条件ごとに起動し直した。Python 版は 8 節の手順で起動した (`t37/pyup.sh` と `pydown.sh`。自分で起動したプロセスのグループだけを止めた)。
- 回数: S1 は 9 回 (A + 一括で受け取る形は 12 回)、S2 と S3 は 3 回 (A + 一括で受け取る形の S2 は、この作業の 3 回と独立のレビューの 2 回の計 5 回)。`VmSwap` は、すべての回で 0 だった。

**実測** (MiB。範囲は回ごとの最小〜最大):

| 条件 | 項目 | Python 版 | Node 版 (`c.json`) | Node 版 (A: 少しずつ書く) | Node 版 (A + 一括で受け取る) |
|---|---|---|---|---|---|
| 待機時 | 親 / 親の下のプロセス | 61 / 56 (forkserver と resource tracker) | 69 / 0 | 69 / 0 | 69 / 0 |
| S1: 33MB の結果 × 3 | 親の最大 | **243〜284** | **411〜532** | 390〜469 | **372〜435** |
| | 親 + 子の最大 | 456〜488 | 721〜845 | 721〜841 | 671〜791 |
| S2: 最も重い組み合わせ | 親 + 子の最大 | **1,149〜1,234** | **1,365〜1,404** | 1,281〜1,407 | **1,216〜1,365** (5 回) |
| | cgroup の増え方 (待機時を除く) | 1,101〜1,113 | 1,219〜1,333 | 1,128〜1,257 | 1,066〜1,216 (5 回) |
| S3: 49.2MiB の受け取り × 3 | 親の最大 | 260 | 253 | 241〜254 | 247〜296 |
| 子が止められた時点の RSS の最大 | (本物の入力 5 種 × 5 回 / 20.6) | 460 (1 ページ 400 万字の PDF) | 468 (`Buffer.alloc` 256MiB ずつ。本物の入力では 371) | 同じ | 同じ |

- 「一括で受け取る形」(`LEAN_RESULT=1`): 子から届く結果を、先頭の長さが分かった時点で 1 つの入れ物に確保し、届くたびに写す (Python 版の `bytearray(length)` と同じ形)。届いた断片を持ったまま最後に連結する形をやめたもの。応答は少しずつ書く (A)。
- 応答の中身は、Python 版が 33,000,111 バイト、Node 版が 33,000,125 バイトだった (違いは `mimeType` などの短い文字列)。

**見積もり** (20.7 と同じ式。親の 1 件あたりは、「受け取り」と「結果」を別々に測って足した。受け取りは (S3 の親の最大 − 待機時) ÷ 3、結果は (S1 の親の最大 − 待機時) ÷ 3):

| 項 | Python 版 | Node 版 (`c.json`) | Node 版 (A) | Node 版 (A + 一括で受け取る) |
|---|---|---|---|---|
| 親の待機時 | 117 (61 + 56) | 69 | 69 | 69 |
| `MAX_CHILD_RSS_MB` | 320 | 320 | 320 | 320 |
| 監視の遅れ | 140 | 148 | 148 | 148 |
| 親の 1 件あたり: 受け取り | 67 | 62 | 62 | 62〜76 (注) |
| 親の 1 件あたり: 結果の受け取りと組み立て | **75** | **155** | 134 | 122 |
| 同時 3 件の掛け算 | 3 × 602 = 1,806 | 3 × 685 = 2,055 | 3 × 664 = 1,992 | 3 × 652〜666 = 1,956〜1,998 |
| `/tmp` の tmpfs | 64 | 64 | 64 | 64 |
| **合計** | **1,987 (2Gi まで 61 余る)** | **2,188 (140 超える)** | **2,125 (77 超える)** | **2,089〜2,131 (41〜83 超える)** |
| 参考: 実測の最悪 (S2 の cgroup + 待機時) | 1,230 | 1,402 | 1,326 | **1,285** (5 回の最大。最小は 1,135) |

(注) 受け取りの分は、ほかの Node 版の形の S3 (最大 254MiB) で数えると 62MiB、この形の S3 の 3 回のうち 1 回 (296MiB。残りの 2 回は 247MiB・260MiB) で数えると 76MiB。受け取りの作りは形の間で同じなので、この差は GC の時期によるばらつきと見られる (推論)。ユーザーに示した値は 2,089MiB で、ばらつきを入れると 2,131MiB になる。

- **対象 spec が自分で出していた見積もり**: design.md の「メモリ上限の目安」の式で、「ワーカー数 × 120MB + ワーカー数 × `MAX_CONCURRENCY` × (`MAX_CHILD_RSS_MB` + 100MB + アップロード 2 × `MAX_FILE_SIZE_MB` + 結果 16MiB × 3)」。既定では「120 + 3 × (320 + 100 + 100 + 48) ≒ 約 1.8GB」(1,824MiB) で、k8s の例の limits は 2Gi。この式は結果を 16MiB × 3 としていて、JSON で 6 倍に膨らむ結果 (33MB の枠) を数えていない。同じ式に Node 版の待機時 (69) を入れると 1,773MiB で、こちらの式では Node 版のほうが小さい。
- **Python 版の各項の出どころ** (コードを読んだ範囲。`runner/child_supervision.py`、`runner/wire.py`、`routers/extract.py`):
  - 結果は、長さの分の `bytearray` に読み、`bytes(...)` で 1 回写す。
  - それを UTF-8 の文字列にし、`json.loads` で解く。
  - FastAPI が `ExtractResponse` を `json.dumps` で 1 つの文字列にし、バイト列にして返す。
  - どの段でも 33MB 級の写しを作る数は Node 版と同じくらいだが、前の段の写しは参照が無くなった時点で手放される。そのため、同時にあるのは 2 つ前後で済むと見られる (推論。実測の 1 件あたり 75MiB ≒ 33MB の約 2 倍と合う)。
- **Node 版の 1 件あたりが多い理由** (推論):
  - 届いた断片、連結した `Buffer`、`toString` した文字列、解いたもの、応答の文字列、送る `Buffer` が、GC まで残る。
  - 応答を少しずつ書くと後ろの 2 つが無くなり、一括で受け取ると断片が無くなって、それぞれ約 20MiB / 約 12MiB ずつ下がった (1 件あたり 155 → 134 → 122)。残りは、文字列にした 33MB と GC の遅れと見られる。
- **OOMKill の記録**:
  - 対象 spec (requirements.md・design.md・research.md・tasks.md) とこの文書に、Python 版が本番 (GROWI.cloud など) で 2Gi を超えて OOMKill された記録は無い。
  - 対象 spec の requirements.md は、k8s の上でのメモリの上限の振る舞いを「実際のクラスタでは確かめていない」と書いている (Req 2 の残存ギャップ)。
  - Python 版は、devcontainer で測られただけで、本番で動いた記録も無い (記録なし)。

### 20.7a の比べ方から見た判断材料

- (i) **Python 版に OOMKill の記録は無い**。本番で動いた記録も無いので、「Python 版で問題が起きていない」ことの裏づけにはならない。
- (ii) **Node 版の今の形 (`c.json`) は Python 版より悪い**。見積もりで約 200MiB (1,987 → 2,188)、実測の最悪で約 170MiB (1,230 → 1,402) 多い。Python 版は見積もりで 2Gi に収まり、Node 版は収まらない。
- (iii) **(A) を採っても、Python 版より良くはならない**。見積もりは 2,125MiB で、一括で受け取る直しを足しても 2,089〜2,131MiB。Python 版 (1,987MiB) との差は 200MiB から約 100〜140MiB に縮むが、2Gi は超えたままである。実測の最悪は 1,135〜1,285MiB (5 回) で、Python 版 (1,230MiB) と同じ程度になる。
- (iv) **選択肢を Python 版との比べ方で書き直すと** (ユーザーに示した形。決定は 20.10):
  - (A) 応答を少しずつ書く (+ 一括で受け取る): 契約は変わらない。Python 版より悪いまま (見積もり +約 100MiB)。2Gi は超える。
  - (B) 実測で判断し、今の形を保つ: Python 版より見積もりで約 200MiB、実測で約 170MiB 悪いまま。
  - (C) 結果の枠の上限を下げる: Node 版の結果の分が減り、Python 版と同じ水準か、それより良くできる。ただし、制御文字や `\` の多い文書の結果が、Python 版より早く `resource_limit_exceeded` になる (振る舞いが Python 版と変わる)。
  - (D) `MAX_CONCURRENCY` を 2 にする: 見積もり 69 + 2 × 685 + 64 = 1,503MiB で、Python 版 (3 件) よりずっと少ない。ただし全体の処理量が 3 分の 2 になり、既定値の契約を崩す。

### 20.8 タイムアウトの内訳

| 区間 | 値 | 種類 |
|---|---|---|
| 本文の受信 | 最大 15 秒 (`UPLOAD_TIMEOUT_S`) | 設計の値。15 秒で 408 になることは 16.5 で実測済み |
| 子の起動 (部品の読み込みまで) | pdf-only で 73〜79ms (TXT)、all で 102〜110ms。PDF の要求は all と同じ部品を読むので約 105ms (推論) | 実測 (`t37/timeout37.mjs`、各 7 回) |
| 49.2MiB を 64KiB ずつ子へ書き、子が読み終えるまで (起動を含む) | 98〜108ms | 実測 |
| 変換 | 最大 55 秒 (`TIMEOUT_S`) | 設計の値 |
| 期限から子が止まって回収されるまで | 6〜12ms (変換中の子、RSS 130〜160MB、期限を 1 秒にして 14 回) | 実測。回収の待ちの上限は 2 秒 (対象 spec の design) |
| エラー応答 | 1ms 未満 (推論) | — |
| **最悪の合計** | **15 + 55 + 0.012 ≒ 70.0 秒** (回収の待ちの上限 2 秒を足しても 72 秒) | — |

- apps/app の既定 `timeoutMs` は 90,000ms (`apps/app/src/server/service/config-manager/config-definition.ts` の `app:attachmentFullTextSearch:timeoutMs`。axios の `timeout` として、送信を含む要求全体に掛かる)。最悪の合計はこれより約 18 秒短い。対象 spec の「約 74 秒 (回収 約 4 秒)」より短い。apps/app の既定を見直す必要はない (design.md の Revalidation Triggers の「タイムアウトの合計 (3.13)」には当たらない)。
- k8s の例の `terminationGracePeriodSeconds` 85 秒も、最悪の合計 (72 秒) より長い。
- **期限の数え始め**: Python 版は本文を受け取った後、子を作るときから 55 秒を数える。試作の親は子の起動から数える。どちらでも、子の起動と入力の書き込み (約 0.1 秒) は 55 秒の内側に入る。本番 (6.7) も子の起動の時点から数え始めれば、合計は変わらない。
- **上限 (`RLIMIT_AS`) の下の遅れ (3.6 の 7〜12%)** は、合計を変えない (期限で切るため)。変わるのは「55 秒の内に終わる最大の入力」で、今回の入力の最長は 3.1 秒なので、どの正常な入力も期限から遠い。
- **CPU 時間の上限 (`prlimit --cpu=60:65`)**: 見張りの worker や V8 の GC のスレッドで、CPU 時間が壁時計より速く進むことがある。55 秒の壁時計の期限より先に 60 秒の CPU 時間に当たると SIGXCPU になり、`timeout` (408) に分類されるので、応答は同じ (推論)。
- **probe**: 親のイベントループの遅れは、3 件の大きな結果と上限まで伸びる子を交互に処理するときに最大 365ms だった (20.7)。liveness の `timeoutSeconds` 5 秒、readiness の 15 秒に対して十分小さい。

### 20.9 Python 版は通すが Node 版は止める入力 (報告。ユーザー判断は要らない)

対象 spec の AC は「上限を超えたら止めて `resource_limit_exceeded` を返す」ことを求めるだけで、次の入力を通すことは約束していない (Python 版のテストにも、成功を期待するものは無い。`grep` で `result_too_large`・`MAX_RESULT_BYTES`・`ConversionSuccess` と大きな fixture の組み合わせを探して確かめた)。Req 11.10 の「AC を満たせない」には当たらないので、ユーザーには諮らず、範囲の変化として記録する。

| 入力 | Python 版 | Node 版 | 範囲 (外挿) |
|---|---|---|---|
| ASCII (英数字) の文字の多い DOCX (結果 1,020 万 / 1,275 万 / 1,530 万字の 3 点) | 220 / 266 / 312〜313MB | 266〜295 / 312 / 358〜380MB | **結果が約 1,310 万字を超える ASCII の DOCX は、Node 版では止まる** (Python 版は約 1,570 万字まで通るので、`MAX_RESULT_BYTES` (16MiB) まではほぼ通る)。1,530 万字の点で semi=4 は効かなかった。anydoc が返す文字列、正規化した文字列、JSON にした文字列、`Buffer` が同時にあるためと見られる (推論)。日本語の DOCX は、結果が `MAX_RESULT_BYTES` の直前 (583 万字・16.4MB) でも 253〜262MB で通る (JS の文字列の長さで決まり、日本語は字数が少ないため。推論) |
| 1 つの要素が約 48MiB の画像を持つ XLSX (100 / 2 万 / 4 万 / 6 万 9 千セル) | 128 / 236 / 294 / 333〜370MB | 324〜325 / 325〜326 / 342〜346 / 427〜433MB | **Node 版は、1 つの要素が約 48MiB の画像なら、セルが少なくても止まる** (100 セルは見回りの値が 269〜300MB で、回によって通る)。Python 版は約 5 万セルまで通る (外挿)。5MiB ずつの画像に分けた形 (合計 30〜45MiB) は、独立のレビューの実測で、2 万セル / 1,000 セルまで通った。45MiB の画像と 4 万セルは、Python 版も止まった (332〜333MB)。書き直す package から画像を外せば、Node 版も約 3 万セルまで通る (外挿。20.5) |
| 1 ページに文字の多い PDF (100 万字 / 200 万字の 2 点) | 145 / 253〜256MB | 190〜191 / 293〜294MB | **1 ページ約 226 万〜260 万字の範囲で、Python 版は通り、Node 版は止まる** (320MB で見た値。0.95 倍の 304MB で見ると約 211 万〜245 万字)。14.12 の外挿 (235 万〜250 万字) を、子の中の値で取り直した |

文字の多い DOCX と PDF は、普通の文書 (1 ページ数千字、DOCX の本文が数百万字まで) からは遠い。画像の多い XLSX は普通にありうるが、Python 版でも 6 万 9 千セルと 48MiB の画像では止まっていた。6.6 で結果の組み立てと XLSX の書き直しのメモリを減らす余地がある (20.12)。

### 20.10 メモリの予算の決定 (ユーザーが決めた、2026-11-09)

**決定: (A) 親の作りを軽くする**。契約 (送るバイト列・`ErrorCode`・設定) も既定値 (`MAX_CHILD_RSS_MB` 320、`MAX_CONCURRENCY` 3、`MAX_FILE_SIZE_MB` 50、結果の枠の上限 2 × `MAX_RESULT_BYTES` + 64KiB) も変えない。

- **親が守ること**:
  - **6.7 (実行管理)**: 子からの結果は、先頭の長さが分かった時点で、その長さの入れ物を 1 つ確保し、届くたびにそこへ写す。届いた断片を持ち続けて最後に連結することはしない。解いた後は、入れ物と文字列への参照を手放す。
  - **6.8 (HTTP の層)**: 応答の JSON を 1 つの文字列に組まない。ページごと・本文の一定の字数ごとに JSON にして、少しずつ書く。送るバイト列は、1 つの文字列に組んだ場合と同じにする。
- **根拠** (20.7a):
  - Python 版 (書き換える前) と同じ式・同じ入力・同じ測り方で比べた。最悪の足し算の見積もりは、Python 版 1,987MiB、Node 版の今の形 (`c.json`) 2,188MiB、(A) 2,089〜2,131MiB。
  - 最も重い負荷の実測 (cgroup の増え方 + 待機時) は、Python 版 1,230MiB、Node 版の今の形 1,402MiB、(A) 1,135〜1,285MiB (5 回 = この作業の 3 回と独立のレビューの 2 回。親と子の RSS の合計は 1,216〜1,365MiB)。(A) で Python 版と同じ程度になり、最大でも 2Gi まで約 760MiB 余る。ユーザーに示した値 (最大 1,201MiB) を、レビューの 1 回目が 84MiB 上回ったが、承認の前提 (実測で 2Gi に十分な余裕がある) は変わらない。
  - **見積もりは (A) でも 2Gi を 41MiB 超える (ばらつきを入れると 83MiB)。2Gi (Req 3.14、Req 1.13 で崩せない不変条件) を守る根拠は、見積もりではなく実測にすることを、ユーザーが承認した**。Req 3.14 は「3 件が同時に動いている間の実メモリを 2Gi 以内に収める (計測の方法は Req 11.2)」で、実測で満たしている。見積もりは、3 つの子が同時に監視の遅れいっぱいまで伸び、同時に 3 件の最大の結果の写しが GC 待ちで残る、という同時には起きにくい形を足したもの (20.7)。
- **却下した選択肢と理由** (ユーザーに示した比べ方の表は 20.7a にある):
  - (B) 今の形 (`c.json`) のまま、実測を根拠にする: Python 版より見積もりで約 200MiB、実測で約 170MiB 悪いまま。(A) は契約を変えずにこの差を減らせる。
  - (A) と (C) (結果の枠の上限を下げる) を合わせる: 見積もりも Python 版と同じ水準にできる見込みだが (外挿)、制御文字や `\`・`"` の多い文書の結果が Python 版より早く `resource_limit_exceeded` になり、振る舞いが変わる (Req 1.9 / 1.10 の手続きが要る)。実測では (A) だけで Python 版と同じ程度になるので、振る舞いを変える必要は無い。
  - (D) `MAX_CONCURRENCY` を 2 に下げる: 全体の処理量が 3 分の 2 になり、既定値の契約を崩す。
- 3.8 と 4.x に進める (tasks.md の 3.7 の条件を満たした)。

### 20.11 再現の手順

使い捨ての場所 (以下 `$T` = scratchpad の `t37/`) で行う。リポジトリの中では install しない。3.6 の `t3/node_modules` (anydoc と `@embedpdf/pdfium`)、`t3/inputs`、3.5 の `t6/rebuild7/probe` と `t6/deps`、3.3 の `t4/node_modules` (hono)、レビュアーの `rv36/inputs` と `rv36/v2` を使う。

```bash
export PATH=/usr/local/share/nvm/versions/node/v24.21.0/bin:$PATH
cd "$T"; ln -s ../t3/node_modules node_modules          # inputs/ は t3/inputs・rv36/inputs・t6/out/big.html への symlink
PY=<repo>/services/attachment-text-extractor/.venv/bin/python
$PY py/py_measure.py gen inputs-py                     # Python 版のテストの生成器で基準のファイルを作る
(cd <repo>/apps/attachment-text-extractor && node --import $REG $T/gen37.ts $T/inputs-limit && node --import $REG $T/gen37b.ts $T/inputs-limit && node --import $REG $T/gen37d.ts $T/inputs-limit && node --import $REG $T/gen37e.ts $T/inputs-limit && node --import $REG $T/gen37c.ts $T/inputs-hostile)
node measure37.mjs 5 all:proto,all,pdf-only <基準のファイル> > out/baseline7.jsonl    # 20.3
node measure37.mjs 5 pdf-only:semi=4 <基準のファイル> > out/final-baselines.jsonl
node check-baselines.mjs pdf-only:semi=4 320 out/final-baselines.jsonl
node measure37.mjs 3 pdf-only:semi=4 $(cat extra-files.txt) > out/final-extra.jsonl     # 20.5
node measure37.mjs 3 pdf-only:semi=4,pdf-only:semi=4:drop inputs-limit/xlsx-img48-*.xlsx …   # 画像の XLSX と、画像を外す案
$PY py/py_measure.py runner 3 <同じファイル>; $PY py/py_measure.py bare 3 <ファイル>; node bare-node.mjs <ファイル> xlsx   # 20.4
CHILD_NODE_ARGS=--max-semi-space-size=4 node ref.mjs pdf-only out/ref-final.json
CHILD_NODE_ARGS=--max-semi-space-size=4 node check-all-pass.mjs 2624 pdf-only out/ref-final.json 3
CHILD_NODE_ARGS=--max-semi-space-size=4 node check-rss-first.mjs 2624 pdf-only 3                # 20.6
node load37.mjs <file>[,<file2>] 3 3 PRELOAD=pdf-only CHILD_NODE_ARGS=--max-semi-space-size=4 [MODE=big-result RESULT_BYTES=16000000 | RESULT_CHARS=5500000] [STREAM_RESPONSE=1]
node load37.mjs inputs-limit/limit-docx-50m.docx,inputs-misc/grow-docx-50m.docx 3 4 … MODE=big-result RESULT_CHARS=5500000   # 最も重い組み合わせ
./altrun.sh <label> PRELOAD=pdf-only CHILD_NODE_ARGS=--max-semi-space-size=4 MODE=big-result [RESULT_CHARS=5500000] [RELEASE_UPLOAD=1] [STREAM_RESPONSE=1]
node check-budget.mjs out/load-all-json.jsonl out/alt-all.jsonl out/check-rss-first-all.txt    # 20.7 (1 つの文字列に組む形)
node check-budget.mjs out/load-stream.jsonl out/alt-stream.jsonl out/check-rss-first-all.txt   # 20.7 (少しずつ書く形)
./cmp-run.sh py 3; ./cmp-run.sh node 3; ./cmp-run.sh node-stream 3                              # 20.7a (S1〜S3。Python 版は pyup.sh / pydown.sh で 8 節の手順どおり起動・停止)
./cmp-run-s1.sh py 6; ./cmp-run-s1.sh node 6; ./cmp-run-s1.sh node-stream 6; ./cmp-run-s1.sh node-lean 9   # 20.7a (S1 の追加の回)
./cmp-run.sh node-lean 3                                                                       # 20.7a (決めた形 (A) の S1〜S3)
node timeout37.mjs 7                                                                          # 20.8
```

道具の要点:

- `child37.mjs`: 3.6 の `child.mjs` に、(1) 入力を写さない (見出しの `copyBody` で 3.6 の形に戻せる)、(2) `xlsxMode: 'stream'` で 20.2 の XLSX の形、(3) 16MB の日本語の結果か、制御文字の結果 (`resultChars`) を返す `big-result` の形、(4) 書き直す package から XML でない要素を外す実験 (`dropBinaryParts`)、を足したもの。`srv/server.mjs` は、ファイル名が `grow-` で始まる要求だけ、子を `Buffer.alloc` 256MiB ずつで伸ばす。
- `supervise37.mjs`: 3.6 の `supervise.mjs` に、`VmSwap` の記録、断片のままの入力 (`bodyChunks`)、本番の既定 (2,624MiB、`MALLOC_ARENA_MAX=2`) を足したもの。
- `measure37.mjs`: 1 件ずつ順に動かし、見回りの最大と、子が自分で読んだ `VmHWM` と、結果のハッシュを出す。形は `<preload>[:proto][:semi=N][:rss=N][:drop]` で選ぶ。
- `py/py_measure.py`: Python 版の `ConversionRunner` をそのまま呼ぶ (`SVC_DIR` で、`git archive` で取り出した古い版にも向けられる)。`py/t37plugin.py` は、Python 版のテストの中の `child_peak_rss_mb` を表示するだけの pytest の部品 (`PYTHONPATH=$T/py pytest -p t37plugin -s`)。

### 20.12 後のタスクへの引き継ぎ

- **port-back (最後のタスク) で、design.md に足すべき文** (この作業では design.md を書き換えていない):
  - **Revalidation Triggers** に次の 2 つを足す。
    - 「**子の最大 RSS の基準 (11.2)**: Node 版の既定値 (`MAX_CHILD_RSS_MB` 320、`MAX_XLSX_CELLS` 70,000、`MAX_HTML_BYTES` 20MiB) は、部品の読み込みを pdf-only にし、子の node に `--max-semi-space-size=4` を付けた形で、対象 spec の基準のファイルが 0.95 倍 (304MB) に収まることに依っている (research.md 20 節。余裕は XLSX 13MB、DOCX 7MB)。部品の読み込み方、子の node の引数、anydoc・PDFium・テキスト系の部品の版、Node の版、本番の image (glibc) のどれかを変えたら、`check-baselines` を流し直す。7 万セル 1 シートの XLSX が超えたら `MAX_XLSX_CELLS` を 65,000 (それでも超えたら 60,000) に下げ (11.11)、検索の対象になる XLSX の範囲が狭まることを運用者に知らせる。画像 12 枚の 48MB の DOCX が超えたら、セル数では直らないので、ユーザーに諮る (11.10)」
    - 「**検索の対象の範囲 (Node 版で狭まったもの)**: 1 つの要素が約 48MiB の画像を持つ XLSX (セルが少なくても。5MiB ずつに分けた画像なら合計 45MiB 級でも通る)、結果が約 1,310 万字を超える ASCII の DOCX、1 ページに約 226 万字を超える PDF は、Python 版では通ったが Node 版では RSS の上限で `resource_limit_exceeded` になる (research.md 20.9)。apps/app のコードは変わらないが、運用者に知らせる。6.6 で画像の XLSX を直したら、この文を直す」
    - 「**メモリの予算 (3.14)**: 2Gi を守る根拠は、最も重い負荷 (33MB の結果 3 件と、上限まで伸びる子 3 件を交互に流す) の実測で、1,135〜1,285MiB (cgroup + 待機時。5 回)。最悪の足し算の見積もり (親の待機時 + `MAX_CONCURRENCY` × (`MAX_CHILD_RSS_MB` + 監視の遅れ 148MiB + 親の 1 件あたり) + `/tmp` の tmpfs) は 2,089〜2,131MiB で 2Gi を超えるが、ユーザーが実測を根拠にすることを承認した (research.md 20.10、2026-11-09)。親の応答の書き方 (少しずつ書く)、結果の受け取り方 (一括の入れ物)、結果の枠の上限、同時実行数、`MAX_CHILD_RSS_MB`、Node の版を変えたら、最も重い負荷の実測をやり直し、Python 版の 1,230MiB と比べる」
  - **Configuration** の `RAYON_NUM_THREADS=1` の行 (19.10 で `MALLOC_ARENA_MAX=2` を並べることにした行) に、子の node の引数 `--wasm-max-mem-pages=8192 --max-semi-space-size=4` と、部品の読み込みを pdf-only にすることを並べる。
  - **Configuration のメモリの予算** の段落 (「計算した結果が 2Gi を超えるなら、既定値を下げる」とある) を、決定 (20.10) に合わせて書き直す: 最悪の足し算の見積もりは 2Gi を 41MiB (ばらつきを入れて 83MiB) 超えるが、実測の最重負荷は約 1.2GiB (Python 版 1,230MiB と同じ程度) で、ユーザーが実測を根拠にすることを承認した。親は応答を少しずつ書き、結果を一括の入れ物で受け取る。Req 1.13 の「メモリの予算 2Gi」は崩していない (実測で守る) ことも書く。
  - 対象 spec (`attachment-search-text-extractor`) の design.md の「メモリ上限の目安」(「120 + 3 × (320 + 100 + 100 + 48) ≒ 約 1.8GB」) は、結果を 16MiB × 3 とし、JSON で 6 倍に膨らむ結果 (33MB の枠) を数えていない。port-back でこの段落を、Node 版の式・見積もり・実測と、上の決定に置き換える。k8s の例の deployment.yaml の頭の注の式も同じ (8.x)。「待機時の親の RSS は未計測」(Performance & Scalability) は「69MiB (実測)」にする。
  - **Revalidation Triggers の「タイムアウトの合計 (3.13)」** に、内訳 (約 70 秒、回収の待ちの上限を足して 72 秒。20.8) を書く。
  - 対象 spec (`attachment-search-text-extractor`) には、design.md の Testing Strategy の「既定の上限での余裕 (基準値)」(285MB / 281MB) を、Node 版の値 (289〜291MB / 277〜297MB) と測り方 (見回りの値と子の `VmHWM`) に書き直し、Configuration の `MAX_XLSX_CELLS` の説明の「約 285MB」と `MAX_CHILD_RSS_MB` の説明の値を合わせる。research.md §2.8 の「7 万行 × 1 列 285MB」などの数字には、次の注記を付けて移す: 「この値は、測るスクリプトが一番外側でテスト用の生成器を import していたため、子の土台が約 40〜45MB 重くなった値と見られる (Python 版の子は親の `__main__` を読み直す。この spec の research.md 20.4 で、同じ仕組みで数字が再現した)。Python 版の本来の子の最大 RSS は 237MB (軽いスクリプト) 〜 242MB (本番と同じ uvicorn の起動) 付近」。Node 版に置き換えた本文 (Node 版が最初からそうだったように書く。Req 12.1) では、Python 版の値は research.md の比べ方の記録にだけ残す。
- **親 (タスクの進行役) へ**: 5 節の後の未決事項の表の「7 万セルの XLSX の RSS の食い違い (2 節)」は、「解決 (285MB は測るスクリプトの一番外側の import で子の土台が重くなった値。167MB は別のファイル。20.4)」にできる。
- **3.8 (部品を入れる)**: 追加の部品は無い (`--max-semi-space-size` は V8 の引数)。
- **4.x (テストの書き換え)**:
  - 基準の 7 つのテスト (`test_the_default_limits_let_large_legitimate_files_through`) の `child_peak_rss_mb < 0.95 × MAX_CHILD_RSS_MB` は、そのまま移せる。ただし Python 版の `vm_peak_mb < 0.8 × as_limit_mb` は移せない (V8 は上限に合わせて予約の大きさを変える。19 節)。
  - 見回りの値は、終わる直前の山を取り逃がす (DOCX で最大 50MB 少なく出る)。基準のテストが本当の最大で余裕を見るなら、子に `VmHWM` を結果と一緒に返させるか、テストの側で子の `VmHWM` を読む。
  - `test_a_large_docx_sent_as_text_is_stopped_by_the_child_limits` (46MB の DOCX を HTML / CSV として送る) は、Node 版でも `big.html` が結果超過、`big.csv` が `memory_exceeded` になった (`t37/out/docx-as-text.jsonl`)。
  - 閉じない開始タグの PPTX は、Node 版では `memory_exceeded` と `malformed` が回によって入れ替わる (20.5)。テストに入れるなら、どちらでも 422 になることを確かめる形にする。
- **6.6 (子の入口と変換の層)**:
  - 入力を写さない (`readFrame` で得た `Buffer` をそのまま変換に渡す)。
  - 部品の読み込みは pdf-only。PDF の要求の子は anydoc と PDFium だけ、それ以外の子は anydoc とテキスト系の部品だけを読み込む (20.1。PDF の子にテキスト系の部品も読み込むと、20.5 の PDF の値が変わるので測り直す)。XLSX は 20.2 の形 (流し込みの書き直しと、DOM を作らないセル数の検査)。
  - 48MiB 級の画像を持つ XLSX を通すために、書き直す package から XML でない要素を外す案がある (20.5。100 セルで 324 → 224MB、出力は 8 入力で同じ)。採る前に、anydoc が XLSX の画像の要素を読まないことを、版を固定した契約テストで確かめる。
  - 結果が `MAX_RESULT_BYTES` を超えたときの種類を、試作の `limit_exceeded` ではなく、Python 版と同じ `result_too_large` にする (応答は同じ 422 だが、ログの `result=` が違う)。
  - 結果が約 1,310 万字を超える ASCII の DOCX (20.9) を通したいなら、結果の組み立て (正規化・JSON・`Buffer`) で同時に持つ写しを減らす余地がある (未検証)。
  - workbook.xml の `definedName` を数万個持つ XLSX は、xmldom の DOM で 320MB の際に当たる (20.5)。workbook.xml の解析を DOM でない形にするか、要素の数の上限を置くかを検討する (未検証)。
- **6.7 (実行管理)**: `/readyz` の確認用の子 (8.8) は、部品の読み込み方に関わらず、PDFium を含むすべての部品を読み込んで確かめる (pdf-only の普通の子だけでは、D2 の `dependencies` の PDFium が読み込めることを確かめられない)。子の node の引数は `process.execPath` の後ろに `--wasm-max-mem-pages=8192 --max-semi-space-size=4` を置く (`NODE_OPTIONS` は使わない。15.7)。期限は子の起動の時点から数える (20.8)。子へ書き終えた断片を手放しても親の最大 RSS は下がらなかったので、そのための処理は要らない (20.7)。**子からの結果は一括の入れ物で受け取る** (20.10 の決定。試作は `t37/supervise37.mjs` の `LEAN_RESULT`)。
- **6.8 (HTTP の層)**: **応答の JSON を 1 つの文字列に組まず、ページごと・本文の一定の字数ごとに書く** (20.10 の決定。試作は `t37/srv/server.mjs` の `STREAM_RESPONSE`。試作は本文を 64Ki 字で切るので、本番はサロゲートの対の途中で切らないようにする)。テストを 2 つ置く。(1) 送るバイト列が、1 つの文字列に組んだ場合 (`JSON.stringify`) と同じであること (日本語・制御文字・サロゲートの対・空のページを含む)。(2) メモリの回帰テスト (16.9 の (d) に足す): 33MB の結果 (制御文字 550 万字) を 3 件同時に受け取ったときの親の最大 RSS が、基準以内であること。基準は、試作の実測 (S1 で 372〜435MiB) に余裕を足した値 (たとえば 480MiB) とし、本番の親で測り直して決める。tasks.md の 6.8 の記述 (HTTP の層を作り、4.4 の HTTP の層のテストを通す) と矛盾しない。
- **6.11 / 6.12 (image)**: `node:24-slim` の image の中で、(A) の形の本番の親と子に対して、`check-baselines` (基準のファイル) と、最も重い負荷の実測 (20.7a の S1〜S3。`load37x.mjs` の形) を 1 回ずつ流す。理由は、image の glibc とメモリの割り当て方が devcontainer と違いうるため (差の大きさは未知)。基準のファイルが超えたら上の Revalidation Triggers の文のとおりにする。6.11 の「メモリの requests / limits を 3.7 の予算に合わせる」は、limits 2Gi のまま (決定のとおり) でよい。
- **【抜けの補足】2Gi を守る根拠の実測を、本番の親で取り直すタスクが無い**: 2Gi を守る根拠は実測 (20.10) だが、tasks.md の 6.12 には image の大きさ・起動・`/readyz`・`POST /extract`・`prlimit`・OpenAPI の確認しか無く、最も重い負荷を測る記述が無い (2026-11-09 に tasks.md を読んで確かめた)。6.11 にも無い。**進行役が tasks.md の 6.12 に足す文** (案):
  - 「(A) の形 (応答を少しずつ書き、結果を一括の入れ物で受け取る) の本物の親で、最も重い負荷を本番の image の中で測る: (1) S1 = 制御文字だけの 5.5MB の TXT (結果は JSON で約 33MB) を 3 件同時に 3 回続けて送る、(2) S2 = S1 の TXT と、上限まで伸びて止められる 8MiB の CSV (1 字のセルが約 420 万個) を交互に 4 回送る。各 3 回以上。コンテナの cgroup の `memory.current` の増え方に待機時を足した値が 2Gi (2,048MiB) に収まり、Python 版の実測 (1,230MiB) と同じ程度であることを確かめ、値を research.md に記録する。収まらなければ、3.7 の決定 (research.md 20.10) をユーザーに諮り直す」
  - 足す先は 6.12 (image の確認のジョブ) を第一とし、CI の時間が問題なら、手で流す確認の手順として 6.11 の受け入れ条件に置く。
- **6.13 (ベンチマーク)**: Node 版は、(A) の形の親 (応答を少しずつ書き、結果を一括で受け取る) と、pdf-only と `--max-semi-space-size=4` の子で動かす。子の時間はほぼ変わらない (20.5)。応答を少しずつ書く形で、応答の時間が変わらないことも見る (測っていない)。
- **8.x (配布物)**: k8s の例の deployment.yaml の頭の注の予算の式を、20.7 の式に置き換える。requests 512Mi / limits 2Gi はそのままでよい (待機時の親 69MiB)。`/tmp` の tmpfs の注の「forkserver socket only」は Node 版に当たらない (Node 版は `/tmp` に書かない。T2)。

### 20.13 RED (決める前の状態と、先に書いた検査)

- 記録が無かった: `grep -n "^## 20" research.md` は何も出さなかった (exit 1)。
- 先に `check-baselines.mjs` (基準のファイルと 20MiB の HTML のすべてが 5 回とも成功し、最大 RSS が 0.95 × 320 = 304MB 未満で、`VmSwap` が 0) と `check-budget.mjs` (20.7 の上限の見積もりと実測の cgroup が 2,048MiB 以内) を書いた。
  - `check-baselines all:proto 320` (3.6 の形): **FAIL (10)**。7 万セルの XLSX 310MB (2 種)、画像 12 枚の DOCX 355 / 358MB、画像の多い DOCX 334 / 335MB、pivot cache の XLSX 402MB (2 種)、HTML は未計測。
  - `check-baselines all 320`: **FAIL (6)**。7 万セルの XLSX 307 / 308MB、画像 12 枚の DOCX 307 / 311MB、HTML は未計測。
  - `check-baselines pdf-only 320`: 未計測の HTML の 2 つで FAIL。HTML は、`--max-semi-space-size` なしで 308〜309MB (20.3) なので、測っても FAIL になる。
  - `check-budget` (計測の前): **FAIL (not measured …)**。
  - `check-rss-first 2624 pdf-only` (3.6 の 15 の形のまま): **FAIL (9 runs stopped by something other than the RSS monitor)**。採る形では 3 つの入力がメモリを増やし続けなくなったためで、`RLIMIT_AS` が先に効いたものは無い (20.6)。15 の形を 20.6 のとおり入れ替えて流し直した。
- GREEN: `check-baselines pdf-only:semi=4 320: PASS (15 inputs, all < 304 MiB)`、`check-all-pass as=2624MiB preload=pdf-only: PASS (267 runs, 0 inputs differ from the unlimited reference)`、`check-rss-first as=2624MiB preload=pdf-only: PASS (0 runs stopped by something other than the RSS monitor)`。
- `check-budget` は、1 つの文字列に組む形で **FAIL (upper bound 2107 MiB > 2048)**、少しずつ書く形で **PASS** (2,008MiB、余裕 40MiB。実測の cgroup の最大は前者の計測で 1,300MiB)。ただしこの PASS は合成の結果での値で、本物の変換の結果で測り直すと 2,125MiB、決めた形 (A) で 2,089〜2,131MiB だった (20.7a。Python 版は同じ式で 1,987MiB)。見積もりの超過は、実測を根拠にユーザーが承認した (20.10)。

### 20.14 確かめなかったこと

- `node:24-slim` の image の中と、k8s の上での値 (devcontainer の cgroup v2 と glibc 2.43 だけで測った)。k8s の CPU の上限 2 の下での時間。
- 対象 spec が 285MB を測ったときのスクリプト (記録が無い。20.4 では同じ仕組みで再現しただけ)。1.5 で使ったファイルと測り方。
- 本番の変換の層 (6.2〜6.5) と本番の親 (6.7、6.8) での値。親はログの部品などを足すと待機時が増えうる。
- 4,000 スライドより大きいデッキ、2,000 シートより多いブック (試したのは 3,000 スライドと 2,000 シートまで)。大きな DOC と PPT (旧形式の生成器が無い)。
- 3 つの子がちょうど同じ時に上限まで伸びて止められる場面 (20.7 の最も重い組み合わせでは、3 つの子の合計は最大 983MiB で、3 × 468 には届かなかった)。
- `--max-semi-space-size` を 4 より小さくした値、`--max-old-space-size` などのほかの V8 の引数。
- ASCII の DOCX と 1 ページの文字の多い PDF の境目 (20.9) は、2〜3 点からの外挿。
- 決めた形 (A) の本番の親 (6.7 / 6.8) での最も重い負荷の値 (試作の `srv/server.mjs` と `supervise37.mjs` の `STREAM_RESPONSE` / `LEAN_RESULT` で測った)。応答を少しずつ書く形の応答の時間。(C) を足した場合の見積もり (外挿のまま)。

## 21. 採用した部品の導入 (タスク 3.8)

2026-11-09 に devcontainer (Node 24.21.0、pnpm 11.1.1) で、3.1〜3.5 で採った部品を `apps/attachment-text-extractor/package.json` に 1 つずつ入れた結果。数字は、とくに書いていなければ **実測**。

### 21.1 入れたもの

| 部品 | 書いた版 | 分類 | ライセンス (registry / 入った LICENSE ファイル) | install のときに動く処理 | lockfile で増えた項目 |
|---|---|---|---|---|---|
| `htmlparser2` | `=12.0.0` | 本番 | MIT / MIT | なし | 6 (自分と `domhandler` 6.0.1・`domutils` 4.0.2・`dom-serializer` 3.1.1・`domelementtype` 3.0.0・`entities` 8.1.0) |
| `entities` | `^8.1.0` | 本番 | BSD-2-Clause / BSD-2-Clause | なし | 0 (htmlparser2 が引いた 8.1.0 と同じもの) |
| `@xmldom/xmldom` | `^0.9.12` | 本番 | MIT / MIT | なし | 1 |
| `yauzl` | `^3.4.0` | 本番 | MIT / MIT | なし | 1 (`pend` 1.2.0 は lockfile に既にあった) |
| `yazl` | `^3.3.1` | 本番 | MIT / MIT | なし | 2 (自分と `buffer-crc32` 1.0.0) |
| `@embedpdf/pdfium` | `=2.15.1` | 本番 | MIT / `LICENSE` (MIT) と `LICENSE.pdfium` (PDFium の BSD-3-Clause と Apache-2.0) | なし | 1 |
| `@types/yauzl` | `^3.4.0` | 開発 | MIT / MIT | なし | 1 (`@types/node` は既存の 24.19.2 に解決) |
| `@types/yazl` | `^3.3.1` | 開発 | MIT / MIT | なし | 1 |
| `@types/emscripten` | `^1.41.6` | 開発 | MIT / MIT | なし | 1 |
| `ajv` | `^8.18.0` | 開発 | MIT / MIT | なし | 0 (既存の 8.18.0 に解決。依存の 4 個も既存) |

- 推移的な依存のライセンスと install のときの処理 (入った実物の `package.json` と LICENSE を読んだ): `domhandler`・`domutils`・`domelementtype` は BSD-2-Clause、`dom-serializer`・`pend` (Expat)・`buffer-crc32` は MIT。どれも `preinstall` / `install` / `postinstall` と `binding.gyp` が無い。`ajv` の依存 (`fast-uri` BSD-3-Clause、ほか 3 個 MIT) も同じ。
- lockfile で増えた項目は合わせて 14 個。消えた行は 0。importer の変更は `apps/attachment-text-extractor` だけで、`apps/app` や `packages/*` の項目、`lockfileVersion`、`settings`、`overrides`、`packageManager` は変わっていない。
- `pnpm install` は「ignored build scripts」の警告を出さなかった。`pnpm-workspace.yaml` の `allowBuilds` には触っていない。
- 1.2 で入った `hono`・`@hono/node-server`・`@firecrawl/anydoc` と、テスト専用の `officecrypto-tool`・`cfb`・`iconv-lite` (9.10、18.10) は変えていない。

### 21.2 research.md の部品の一覧との照合

- 本番の直接の依存 (18.10 の 5 個と 14.8 の 1 個)、本番に入るテキスト系の 11 個 (18.8)、開発用の `@types/yauzl`・`@types/yazl` (18.10) と `ajv` (17.10) は、一覧と版まで一致した。却下した部品 (`busboy`・`@fastify/busboy`・`zod`・`@hono/zod-openapi`・`hono-openapi`・`jschardet`・`parse5`・`cheerio` など) は入れていない。
- **一覧に無かったもの: `@types/emscripten` (開発用)**。`@embedpdf/pdfium` の型定義は `/// <reference types="emscripten" />` を前提にしており (この package 自身も開発用の依存に持つ)、無いと `HEAPU8` などの型が欠けて `tsgo` が通らない。6.x の PDF の変換も `HEAPU8` を使う (14.8) ので足した。依存は 0 個。
- 17.10 の未検証 (`^8.18.0` のときに pnpm が既存の 8.18.0 を選ぶか) は、**8.18.0 を選んだ** (lockfile の項目は増えなかった)。

### 21.3 版の書き方の方針

- **固定 (`=`) にしたもの**: `@embedpdf/pdfium` (14.6・14.8。保守する人が 1 人で、中の PDFium の版が分からないため、上げるときはベンチマークを回す) と `htmlparser2` (18.10。adapter が `Tokenizer` の位置の値を書き換えるなど、内部の振る舞いに依っている)。書き方は、同じ `dependencies` にある `@firecrawl/anydoc` の `=0.2.4` と `apps/pdf-converter` の `=8.5.0` に合わせた。
- **`^` にしたもの**: ほかはこの package の慣習 (`^`) に合わせた。`@xmldom/xmldom` は 18.10 のとおり下限を 0.9.12 にした (`^0.9.12` は 0.10 未満まで)。`entities` は htmlparser2 の依存の指定 (`^8.0.0`) と同じ版に解決されるので、重複しない。
- 入れ方は「`package.json` に 1 つ書いて `pnpm install`」。`pnpm --filter … add` で入れると、関係の無い `vitest-mock-extended` の lockfile の鍵 (循環する peer の `@vitest/ui@3.2.4(vitest@3.2.6)` の書き方) が 2 つの importer で書き換わった。版は同じで、続けて `pnpm install` を流すと元に戻った。後で部品を足すときも、この入れ方にすると差分が部品の分だけになる。

### 21.4 ネイティブと WASM の platform

- `@embedpdf/pdfium` は WASM だけで、platform ごとの部品は無い (`dist/pdfium.wasm` 4.6MB)。
- `@firecrawl/anydoc` 0.2.4 は napi-rs の optional の依存として 7 つの platform の部品が lockfile にある (既存の状態。3.8 で変わっていない): `darwin-arm64`、`darwin-x64`、`linux-arm64-gnu`、`linux-arm64-musl`、`linux-x64-gnu`、`linux-x64-musl`、`win32-x64-msvc`。devcontainer に入ったのは `linux-x64-gnu` だけ。linux-arm64 の image でも lockfile から入る (未検証。6.11 / 6.12 で確かめる)。
- テキスト系の部品と `ajv` は JavaScript だけ。

### 21.5 PDFium の WASM の中の第三者の部品 (14.8 の宿題)

- `strings` で WASM の中の文字列を見た結果 (推論。ビルドの構成は読んでいない): FreeType (`FREETYPE_PROPERTIES`)、OpenJPEG (`openjpeg.h`、JPEG 2000 の誤りの文)、libpng (`libpng-`)、zlib (`zlib version`)、libc++ / libc++abi (LLVM)、Adobe のフォントの寸法の表 (`Copyright (c) 1990-1994 Adobe Systems Incorporated`。PDFium の一部)。JPEG と色の管理の部品は文字列からは特定できなかった。pypdfium2 の一覧 (下の libjpeg_turbo の IJG と lcms) から見て、同じ PDFium を作ったものなら入っている見込み (推論)。IJG のライセンスは、文書の中に「Independent JPEG Group の成果に基づく」という表示を求める。
- これらのライセンスは、どれも許容的なもの (FreeType は FTL を選べる。OpenJPEG は BSD-2-Clause、libpng と zlib はそれぞれの許容的なライセンス、LLVM は Apache-2.0 の LLVM 例外つき) で、コピーレフトは無い。
- ただし package に入っているのは `LICENSE` と `LICENSE.pdfium` だけで、FreeType の FTL が求める「文書の中で FreeType を使ったことを示す」表示や、OpenJPEG の BSD の著作権の表示の文は同梱されていない。比べると、Python 版の pypdfium2 5.14.0 の wheel は `licenses/data/linux_x64/BUILD_LICENSES/` に freetype・libjpeg_turbo (IJG)・libopenjpeg・libpng・zlib・lcms・agg23・icu・abseil・llvm-libc などの文を持っている (devcontainer の `.venv` で確かめた)。Python 版の image も同じ wheel を入れるので表示を持っていた見込み (推論。image の中は確かめていない) だが、Node 版の image は持たない。この表示は、Req 4.4 ですでに受け入れた許容的なライセンス (BSD の再配布の条件、FreeType の FTL の表示、IJG の表示) に付く条件で、選ぶ余地が無い。したがってユーザー判断は要らず、6.11 の Dockerfile が image に表示のファイルを入れる (tasks.md の 6.11 に足した)。配布物にも置くかは 8.x で決める。表示のファイルの出どころは未決で、6.11 で `@embedpdf/pdfium` 自身のビルド (package の `repository.directory` の packages/pdfium、`wasm:build`) から特定する。Python 版の pypdfium2 の `BUILD_LICENSES` は参考にとどめる (部品の版が違いうるため)。

### 21.6 検証

- RED (部品を入れる前): `pnpm vitest run smoke.spec` は 6 件が `Cannot find package '@embedpdf/pdfium'` (同じく `htmlparser2`・`entities`・`@xmldom/xmldom`・`yazl`・`ajv`) で失敗し、既存の部品の 4 件は通った。
- GREEN: `src/smoke.spec.ts` の 10 件が通る。部品ごとに、import と最低限の呼び出しを確かめる (Hono の要求、`getRequestListener` で Node の HTTP サーバーにつないだ要求、anydoc の CSV、PDFium の WASM を `wasmBinary` で渡して 2 ページの PDF のページ数、`Tokenizer` の本文、`decodeHTML`、xmldom の解析、yazl で書いた ZIP を yauzl で読み戻す往復、ajv の検査の可否)。
- `turbo run lint test --filter @growi/attachment-text-extractor`: 2 つのタスクが成功 (biome 109 ファイル、`tsgo --noEmit`、テスト 38 ファイル・444 件が通り、12 件は benchmark の既存の skip)。
- `pnpm install --frozen-lockfile` は成功した。`git status` で変わったのは `apps/attachment-text-extractor/package.json`・`src/smoke.spec.ts`・`pnpm-lock.yaml` とこの文書だけ。
- `pnpm --filter @growi/attachment-text-extractor list --prod --depth 0` の本番の依存は 9 個 (`@embedpdf/pdfium`・`@firecrawl/anydoc`・`@hono/node-server`・`@xmldom/xmldom`・`entities`・`hono`・`htmlparser2`・`yauzl`・`yazl`)。型定義と `ajv` は入らない。

### 21.7 後のタスクへの引き継ぎ

- **4.x / 6.x**: 部品はすべて入った。PDFium は `createRequire(import.meta.url).resolve('@embedpdf/pdfium/pdfium.wasm')` で場所を得て、`init({ wasmBinary })` に `ArrayBuffer` を渡す (`@types/emscripten` の型では `Buffer` をそのまま渡せない)。vitest の中では `import.meta.resolve` が使えない。anydoc の形式は `Format` が ambient の const enum なので、`formatFromExtension` で実行時に得る (`test/fixtures/spec-support/anydoc.ts` と同じ)。
- **6.11 (Dockerfile)**: `pnpm deploy --prod` で入る本番の依存は、直接の 9 個と推移的な 6 個 (`domhandler`・`domutils`・`dom-serializer`・`domelementtype`・`pend`・`buffer-crc32`) と、anydoc の platform の部品 1 つ。install のときに動く処理を持つ部品は無いので、`allowBuilds` も `--ignore-scripts` の扱いも変えなくてよい。21.5 の第三者のライセンス表示のファイルを image に入れる (ユーザー判断は要らない。出どころは 21.5 のとおり 6.11 で特定する)。
- **6.11 / 6.12**: linux-arm64 の image を作るなら、anydoc の `linux-arm64-gnu` が入ることを確かめる。`node:24-slim` は glibc なので `-gnu` の部品が選ばれる (推論。6.12 の image の中の `/readyz` と抽出の確認で、部品が欠けていれば見つかる)。PDFium は WASM なので CPU を選ばない。
- **8.x**: 21.5 の表示を配布物にも置くかを決める。
- **版を上げるとき**: `@embedpdf/pdfium` と `htmlparser2` は固定なので、上げる変更ではベンチマークと 18.5.1 の比べ方をやり直す。`@xmldom/xmldom` は勧告が出たら上げる (18.10)。

## 22. テストの対応表 (タスク 4.1)

2026-11-09 に、Python のテストの全ファイルを読み (`.py` 49 ファイル、`pytest --collect-only` で 1222 件)、対応表と、Python 版に向けるときに外すテストの目印を決めた。数字はとくに書いていなければ実測。測っていないものは「未確認」、読んで考えたものは「推論」と書いた。Python 版のコードと Node 側のファイルは変えていない (research.md への追記だけ)。

### 22.1 結論

- **Python のテスト 49 ファイルのすべて** (テスト 42 ファイル、補助 7 ファイル、テスト用の固定ファイル) の行き先を 22.3 に決めた。「対応させない」には、理由と、その性質を Node 版で守る場所 (または守らなくてよい理由) を書いた。
- **目印の方法 (推奨は 1 つ)**: 黒箱のテストは `test/http/blackbox-target.ts` の `describeNodeOnly(理由の id, 名前, 本体)` / `itNodeOnly(...)` で包む。環境変数 `BLACKBOX_TARGET=python` のときだけ `skipIf` で飛ばす。vitest 3.2.6 には `tags` が無い (22.4) ので、この包みが design.md 614 行の「vitest のタグ」の代わりをする。
- **外すテスト**は 22.5 の 8 行。理由の id は表の行と 1 対 1 で、`vitest list test/http` の出力と機械で突き合わせられる。
- **ユーザー判断が要る事項は無い**。ただし進行役 (親) と 6.x の担当に、決めてほしい点が 4 つと、環境の注意が 1 つある (22.8)。決めてほしい点のうち 2 つは、7 節に記録が無い点である (XLSX の ZIP の `../` 名は未決、16.9 の HTTP 層の 9 通りは未記録)。d36・m21 は 7.4 (research.md 208・212 行) と 16.1 に記録があり決定済みである。

### 22.2 テストの分け方と置き場所の規則

**黒箱のテストの規則** (4.4 が `test/http/*.integ.ts` に置く。4.6 が Python 版に向ける):
- 黒箱のテストは、外から 1 つのサービスの 1 つの設定 (**既定の設定**) に、HTTP だけで確かめられるものに限る。向け先の URL とトークンは環境変数で渡す。
- 次のものは黒箱に置かない。**HTTP の層のテスト (4.4、`src/http/`) に置く。これらは Python 版に向けないので目印は要らない**。
  - 既定でない上限が要るもの (`MAX_FILE_SIZE_MB=1`、`MAX_PDF_PAGES=2` など)
  - 偽の子プロセスが要るもの (落ちる子、固まる子、メモリを増やす子)
  - 1 秒未満の期限 (環境変数は整数なので渡せない)
  - ログの捕捉が要るもの (外のサービスのログは読めない)
- 向け先の環境変数 (名前をここで決める): `BLACKBOX_URL` (向け先。無ければ Node 版をテストの中で既定の設定で起動する)、`BLACKBOX_TOKEN` (向け先を起動したときのトークン。`BLACKBOX_URL` があるときは必須)、`BLACKBOX_TARGET` (`node` が既定。`python` を選ぶと目印の付いたテストを飛ばす。`python` は `BLACKBOX_URL` が無いと即座に失敗する)。ベンチマークの `BENCHMARK_URL` / `BENCHMARK_TOKEN` と同じ形で、トークンは引数でなく環境変数で渡す。
- 6.12 は、同じ黒箱のテスト (`/readyz` が準備完了、PDF と DOCX の `POST /extract`) を `BLACKBOX_URL` でコンテナに向けて使える (推論。6.12 の担当が決める)。

**置き場所と名前** (design.md の File Structure Plan と `.claude/rules/testing.md` の「テストは隣に置く」に従う):
- 単体 (子プロセスも本物の HTTP も使わない): ソースの隣の `*.spec.ts`。
- 子プロセスや本物の HTTP サーバーを使う: ソースの隣の `*.integ.ts`。黒箱も `*.integ.ts` (`test/http/` に置く。Node 版を自分で起動するときも本物の HTTP と子を使うため)。
- `vitest.config.ts` の変更 (**4.3 と 4.4 のどちらかが最初に 1 回だけ行う。この 4.1 では変えていない**): 現在の設定は `*.integ.ts` を拾わない (scratchpad に写した設定で `src/runner/x.integ.ts` を置いて確かめた。`vitest run` は `a.spec.ts` の 1 件だけ動かした)。`test.include` を `['**/*.{spec,integ}.ts']` にする (同じ設定で `x.integ.ts` も動いた)。
- テスト用の補助 (偽の子など) は `spec-support/` に置く (`benchmark/spec-support/` と同じ名前)。
- 層の依存の向き (6.10) を守るため、`src/conversion/**` のテストは実行管理の層と HTTP の層を import しない。

### 22.3 Python のテストと Node のテストの対応表

担当の略: 4.2 = 共有層・設定・変換の層、4.3 = 実行管理 (子プロセス)、4.4 = HTTP の層と黒箱、4.5 = 配備物、既存 = すでに Node にある、対 = 対応させない。件数は Python 版の `pytest --collect-only` の件数 (合計 1222)。

**変換 (`tests/conversion/`、14 ファイル 599 件)**

| Python のテスト (件数) | 何を確かめるか | 担当 | Node のテスト | 備考 |
|---|---|---|---|---|
| `test_archive_guard.py` (46) | ZIP の要素数・申告サイズの上限、zip でない入力はそのまま通す、暗号化、読み出しの上限、壊れた圧縮 | 4.2 | `src/conversion/ooxml/archive-guard.spec.ts` | 流してつなぐ書き直し (`copy_part` 系 8 件) は `xlsx-split.spec.ts` へ。research.md 18.10 の追加項目 (version-needed 64 以上、UTF-8 の flag の不一致、CRC、末尾が `/` の要素は飛ばす、yazl の `'error'`) も足す。ZIP の名前に `../` が入る XLSX は未決 (22.8 の 2) |
| `test_charset.py` (42) | 文字コードの判定 (UTF-8/16/32、Shift_JIS、EUC-JP、ISO-2022-JP、cp1252)、宣言の扱い、BOM | 4.2 | `src/conversion/text/charset.spec.ts` | 18.10 の追加: 敵意のある宣言、WHATWG と Python の違い。Python と違う期待は 22.6 |
| `test_core.py` (54) | 入口: 経路の選択、正規化、空の要素の規則、失敗の種類、結果の大きさの上限、想定外の例外は `internal` | 4.2 | `src/conversion/convert.spec.ts` | `process_control_exceptions_propagate` (2、`SystemExit` 系) は対: Node に当たる例外が無い。子の中の `process.exit` は結果なしの終了で、4.3 の「結果なしで終わると `crashed`」(15.6) が守る。`sample.txt` を使う 1 件は、文字列を直接書く |
| `test_formats.py` (119) | 形式の判定の表 (MIME・拡張子・大文字小文字・`xls` を `xlsx` で渡す・非対応) | 4.2 | `src/formats/format-table.spec.ts` | 表は design.md の対象 spec の §FormatResolver と同じ |
| `test_input_size.py` (32) | CSV / HTML の大きさの事前判定 (ちょうどは通り、1 バイト超は `limit_exceeded`、他の形式は無制限、detail にサイズと名前を出さない) | 4.2 | `src/formats/input-size.spec.ts` | 最後の class (5) は入口が自分でも上限を守ること → `convert.spec.ts` |
| `test_normalize.py` (29) | 改行の統一、日本語の間の詰め | 4.2 | `src/conversion/normalize.spec.ts` | 詰めは PDF だけ (Req 2.5) |
| `test_office.py` (32) | anydoc の呼び出し (形式を明示、OCR なし)、暗号化・壊れた・上限の分類、detail に中身を出さない | 4.2 | `src/conversion/office.spec.ts` | `PanicException` (`BaseException`) の class と `interpreter_exits_are_not_swallowed` (2) は対 (理由は `test_core.py` と同じ)。投げられた値が `Error` でなくても `internal` になること (文字列・オブジェクト) を足す |
| `test_ooxml_xml.py` (10) | 安全な XML の解析 (DTD・実体の展開を拒む、壊れた XML は `malformed`、接頭辞を保つ) | 4.2 | `src/conversion/ooxml/safe-xml.spec.ts` | 18.10 の項目 (使えない字、名前空間の宣言 1,000 個、書き戻しの XML 宣言) を足す。Python と違う期待は 22.6 |
| `test_pdf.py` (14) | ページごとの要素、ページ数の上限、パスワード付き・所有者パスワードだけ・画像だけ・壊れた PDF、日本語の詰め | 4.2 | `src/conversion/pdf.spec.ts` | 期待は 14.8 のとおりそのまま成り立つ。`malloc` が 0 を返す、`Aborted` は `internal` (14.8) を足す |
| `test_pptx_split.py` (65) | スライドごとの分割、自動代替テキストの除去、相対・絶対の参照、安全でない参照、上限、壊れた XML | 4.2 | `src/conversion/ooxml/pptx-split.spec.ts` | 「ピン止めした版」と「分割して足したものは全体を一度に変換した結果と同じ」(計 6) は `anydoc-contract.spec.ts` へ |
| `test_text.py` (67) | プレーン (6)、HTML (23)、XML (14)、ipynb (11)、CSV / TSV (6)、HTML と XML 共通 (2)、サロゲート (5) | 4.2 | `src/conversion/text/{plain-text,html,xml-text,ipynb,csv}.spec.ts` | `csv.ts` は design.md の File Structure Plan に無い。6.2 が CSV / TSV の前処理のファイルを足し、`csv.spec.ts` を隣に置く。HTML は 18.10 の検査 33 件と時間の比の検査を足す |
| `test_types.py` (8) | 失敗の種類、値の不変性、経路の型、設定から上限を作る | 4.2 | `src/config/load-settings.spec.ts` | 型の部分は `tsgo --noEmit` (`Record<FailureKind, …>` で漏れを見つける。Req 5.5)。「設定から上限を作る」(2) だけテストにする。ipynb の 1 出力の上限は固定の値 (design.md の `ConversionLimits` に項目が無いので、6.1 が置き場所を決める) |
| `test_xlsx_split.py` (50) | シートごとの分割、非表示・グラフだけ・空のシート、元の順序、マーカー、書き直し、上限 | 4.2 | `src/conversion/ooxml/xlsx-split.spec.ts` | 契約の 6 件 (ピン止め、本文が元と同じ、マーカー) は `anydoc-contract.spec.ts` へ。ZIP の名前が `../` の要素は 22.8 の 2 |
| `test_xlsx_split_precheck.py` (31) | セル数の数え方 (70,000 で通り 70,001 で拒む)、ZIP の分割をまたぐタグ、メモリが増えない | 4.2 | `src/conversion/ooxml/xlsx-cell-count.spec.ts` | |
| 契約テスト (上の行から集める) | 版をピン止めした anydoc の挙動: PPTX の分割、XLSX の目印、XLS を `xlsx` で渡す、例外の分類 | 4.2 | `src/conversion/anydoc-contract.spec.ts` | tasks.md 4.2 の記述どおり。`test_dependencies.py` の「anydoc の版」もここ。anydoc を通す分割の契約は 6.5 で通る |

**実行管理 (`tests/runner/`、7 ファイル 174 件 + 補助 3 ファイル)**

| Python のテスト (件数) | 何を確かめるか | 担当 | Node のテスト | 備考 |
|---|---|---|---|---|
| `test_child_entry.py` (17) | 子の入口: 失敗の種類と detail を送る、想定外は `internal`、長すぎる detail は切る、結果が大きすぎる、不正な入力を拒む、親が消えたら 2 秒以内に終わる、上限は入力を読む前に掛かっている | 4.3 | `src/child/child-entry.integ.ts` | `exit_requests_are_re_raised` (2) は対 (`SystemExit`)。親の消失は 1 秒以内 (Req 3.11、15.4)。上限は `/proc/<pid>/limits` で確かめる |
| `test_child_isolation.py` (27) | 本物の変換で: 時間切れ、RSS 超過、CPU 時間、異常終了、親の強制終了、既定の上限で大きな正常ファイルが通る、セル数の上限、テキストの爆発、巨大な PDF のページ | 4.3 | `src/runner/child-isolation.integ.ts` | 基準 (`child_peak_rss < 0.95 × MAX_CHILD_RSS_MB`) の 7 件は移せる。**`vm_peak < 0.8 × as_limit` は移さない** (V8 は上限に合わせて予約を変える。20.12)。子の `VmHWM` を結果と一緒に返させるか、テストが子の `VmHWM` を読む (見回りは山を取り逃がす。20.12) |
| `test_conversion_runner.py` (48) | 1 件 1 子: 分類 (結果・時間切れ・RSS・結果の枠・異常終了・プロトコル違反・SIGXCPU)、子の起動失敗、大きさの事前判定、中止、200 回で fd・スレッド・子が漏れない、一時ファイルが残らない | 4.3 | `src/runner/conversion-runner.integ.ts` | `classify_exit` (7) → `src/runner/child-exit.spec.ts`、`parse_status_memory` (1) → `src/runner/linux/proc-rss.spec.ts` (単体)。対: `just_died_forkserver_is_crashed` (1、forkserver)、`from_settings` / `partial_request_limits` / `run_without_request_limits` (3、Python の引数の形で、TypeScript の型が防ぐ)。15.6 の表の各行をそのまま場合にする |
| `test_extract_with_real_runner.py` (2) | 本物の子で `POST /extract`、トークンが子の環境に無い | 4.3 | `src/runner/child-env.spec.ts` + `conversion-runner.integ.ts` | トークンが子の `env` に無いことは `child-env` の単体と、子が自分の `process.env` を返す偽の子 (結合) の 2 段で確かめる (Req 3.8) |
| `test_forkserver.py` (19) | forkserver の起動・事前読み込み・再起動・固まったときの時間制限・準備完了 | 4.3 (一部) | `src/runner/readiness.integ.ts`、`src/runner/child-env.spec.ts` | **対 12 件**: forkserver は Node 版に無い (子は 1 件ごとに `prlimit` で起動する。15 節)。起動・停止・再起動・pidfd・事前読み込みの保持など、forkserver の寿命に関する 12 件 (定義の順の 1・3・7・8・9・10・12・13・14) を移さない。**移す 5 件** (定義の順): 準備完了は `prlimit` と確認用の子で決まる (2、8.8)、確認用の子が読み込めないと準備未完了 (11)、確認用の子が固まっても期限内に答える (15・16)、子の `env` は `RAYON_NUM_THREADS=1` と `MALLOC_ARENA_MAX=2` (5、19.10)。**別の担当が守る 2 件**: 「運営者が設定した `RAYON_NUM_THREADS` を尊重する」(6) は 6.7 が決める (子の `env` は明示した値だけにする設計)、「事前読み込みが HTTP の層を読まない」(4) は 6.10 の依存の検査が守る |
| `test_platform_guards.py` (8) | 子の上限: 仮想メモリ、CPU 時間の soft < hard、既存の hard を超えない、Linux 以外では何もしない、`/proc` で見える | 4.3 | `src/runner/linux/prlimit-args.spec.ts`、`platform.spec.ts`、`process-limits.integ.ts` | **値は変わる**: 仮想メモリの上限は `MAX_CHILD_RSS_MB` + **2,304MiB** (Python 版の +512 ではない。19.10)、親の hard で切り詰める。コアダンプは `--core=1` (15.1)。`oom_score_adj` も確かめる |
| `test_wire.py` (53) | 長さ付きの枠 (4 バイト big-endian、上限、切れた枠)、結果の JSON の形、不正な本文・形の違反を拒む、部分読み・部分書き | 4.2 | `src/wire/length-prefixed-json.spec.ts` | 全件を移せる。「サロゲートの片割れを符号化できない」(1) は、Node では `JSON.stringify` が例外にしないので、期待は 6.1 が決める (変換の層が片割れを結果に出さないことは `text/*.spec.ts` のサロゲートの 6 件が守る) |
| `child_targets.py`、`isolation_worker.py`、`conftest.py` (補助) | 偽の子 (abort・segfault・固まる・大きな結果ほか 20 種)、別プロセスの親、forkserver の後始末 | 4.3 | `src/runner/spec-support/child-targets.ts` ほか | 偽の子の差し替え口 (子の実行ファイルの引数) は 4.7 の空の実装で決める (未決)。`conftest.py` は forkserver 用なので対 |

**HTTP・設定・配備物・その他 (`tests/` の直下、21 ファイル 449 件 + 補助 4 ファイル)**

| Python のテスト (件数) | 何を確かめるか | 担当 | Node のテスト | 備考 |
|---|---|---|---|---|
| `test_bearer_auth.py` (13) | 認証 (正しい・無い・違う・形の違うトークン)、認証なしの 3 パス、トークンの確認は処理より前 | 4.4 | `src/http/bearer-auth.spec.ts` | `TestMiddlewareImport` (3、import できるか) は対。存在しないパスも 401 (Req 1.6)、比較は `timingSafeEqual` を足す |
| `test_integration_auth.py` (7) | アプリ全体で認証、大きなファイル + 違うトークンは 401 | 4.4 | `test/http/auth.integ.ts` (黒箱) | |
| `test_ci_workflow.py` (17) | CI の workflow の静的な検査 (名前・timeout・権限・trigger・手順の順・400MB・read-only/uid/ネットワークなし・`if:` の注釈) | 対 | — | **Node 版の CI の workflow の静的テストを書く 4.x のタスクが無い** (4.5 は Dockerfile・compose・k8s)。守るもの: 6.12 (image の確認の手順)、8.3 (実行の job 数が 0 より多いこと)、`.claude/rules/github-actions-workflows.md` (`if:` の注釈)。足すなら 4.5 に `test/deploy/ci-workflow.spec.ts` (約 10 項目)。**4.5 の範囲は広げていない** (22.8 の 4) |
| `test_client_disconnect.py` (6) | 切断で変換を止めて後始末を待つ、キャンセル、偽の ASGI の受信 | 4.4 | `src/http/extract-route.spec.ts` (中止の合図の節) | 偽の runner と `AbortController` で、切断 → `signal` の中止 → 後始末を待つ → 枠を返す (3 件)。ASGI の `receive` が壊れる・切断以外のメッセージ (2 件) は対 (Hono には無い。切断は `c.req.raw.signal`) |
| `test_config.py` (48) | トークンが無い・空・空白で起動しない、既定値、整数、環境変数での上書き、`LOG_LEVEL` の正規化、不正な値は起動時に失敗 | 4.2 | `src/config/load-settings.spec.ts` | 型の確認 (`is_int` など 13 件) は TypeScript の型が守る (対)。`max_extracted_bytes_is_removed` (1) は Python の履歴で対。**`WORKERS` を読まない**を足す (D1) |
| `test_dependencies.py` (14) | 部品が import できる (11)、anydoc の版、ネットワークなしで CSV を変換、本番の依存に外部コマンドを使う部品が無い | 既存 + 4.2 + 4.5 | `src/smoke.spec.ts` (既存、10 件)、`anydoc-contract.spec.ts`、`test/deploy/production-dependencies.spec.ts` | 本番の依存の一覧が許可した 9 個 (21.2) だけで、禁止の部品 (外部コマンドや OCR) が無いことを 4.5 が確かめる (tasks.md 4.5 の「本番に不要なものを含まない」) |
| `test_deploy_config.py` (14) | Dockerfile (版のピン止め、uid 10001、ワーカー数)、compose (read-only、tmpfs、メモリ、healthcheck、ネットワーク) | 4.5 | `test/deploy/dockerfile.spec.ts`、`compose.spec.ts` | 逆になるもの: `WORKERS` が**無い** (D1)。Python 固有で対: uv の版・`--extra dev`・`.pyc` の 3 件と、`TMPDIR` の部分 (要るかは T2 の結果で、6.x が決める)。足す: 最終の段で `prlimit` を実行、`RAYON_NUM_THREADS=1`、`/dev/shm` を使わない。compose の `context` は 8.2 で Node 版に切り替わるまで通らない (tasks.md 6.11) |
| `test_e2e_http.py` (94) | 本物の runner で HTTP: 形式の表、日本語の詰め、エラー表、衛生、リクエストの形、各種の上限、時間切れ、子の失敗、枠 | 4.4 | 黒箱 (既定の設定) と HTTP の層 (設定を変えるもの) に分ける。22.7 | 黒箱: 形式 36、詰め 5、エラー表 17、衛生のうち応答の 5 (ログの側は `request-log.spec.ts`)、リクエストの形 7、既定の上限の CSV 1 = 71 件 (「失敗が次を壊さない」の子が残らない部分は黒箱では見えず、4.3 の 200 回のテストが守る)。HTTP の層 (`src/http/extract-limits.integ.ts` ほか): 上限の行 6、入力の大きさの上限の 7、時間切れ 2、子の失敗 5、枠 1、衛生のうちログの 2 = 23 件 |
| `test_export_openapi.py` (9) | 書き出しの手順 (ファイルを書く・親ディレクトリを作る・JSON・トップのキー・必須のスキーマ・`$ref`・サブプロセス・エラーのステータス) | 4.4 | `test/openapi/export-openapi.spec.ts` | 手順は `scripts/export-openapi.ts` (6.9)。17.7 の検査 (i)〜(iv) は `test/openapi/openapi-document.spec.ts` |
| `test_extract_router.py` (35) | 偽の runner で `POST /extract`: 成功、失敗の対応 (9 種)、枠の解放、ログ、認証、入力の上限、不正な multipart | 4.4 | `src/http/extract-route.spec.ts`、`error-table.spec.ts`、`parse-multipart.spec.ts` | 不正な multipart の 8 件は `parse-multipart.spec.ts` へ。16.9 の固定データ (22.7) の一部になる |
| `test_fixture_files.py` (30) | テスト用ファイルの生成器が名前どおりの性質を持つ | 既存 | `test/fixtures/*.spec.ts` (2.3 / 2.4 で作成済み) | Python 版のテストへの差し替えは 10 節 (1222 件が同じ結果) |
| `test_health.py` (11) | `/healthz` (200・認証なし)、`/readyz` (準備完了 200、未完了 503、公開する名前、内部の名前を出さない) | 4.4 | `src/http/health-routes.spec.ts` + 黒箱 `test/http/health.integ.ts` | 再確認の 2 件 (未完了のキャッシュを再確認して新しい答えを返す・再確認後も未完了なら 503) は forkserver の仕組みだが、**守りたい性質は残る: `/readyz` は準備未完了から戻れる** (対象 spec の design.md 258 行「準備できていない間は確かめ直す」)。6.7 が判定を覚えて使い回す形にすると、起動時に一度だけ失敗した Pod が 503 のままになり、`/healthz` は 200 なので k8s は再起動もせず、サービスにも戻さない。**4.4 の `health-routes.spec.ts` が、偽の runner の `readiness()` が 1 回目は未完了、2 回目は準備完了を返すとき、2 回目の `/readyz` が 200 を返すこと (503 のままにならない) を確かめる** (再確認の 2 件の Node 版)。名前の実名は D2 (22.5) |
| `test_infrastructure.py` (10) | pytest の fixture (トークンの注入) と固定ファイルの存在 | 対 | — | pytest 固有。Node は設定を引数で渡し (`process.env` を書き換えない)、固定ファイルは `test/fixtures/*.spec.ts` が守る |
| `test_k8s_manifests.py` (27) | k8s の例: 安全設定、メモリ・CPU、環境変数、probe、更新、HPA、NetworkPolicy、共有メモリを使わない | 4.5 | `test/deploy/k8s-manifests.spec.ts` | `WORKERS` が無い (D1)、requests / limits は 20.10 (512Mi / 2Gi)、予算の式は 20.7 に合わせる |
| `test_limits.py` (18) | 同時実行の枠 (空きがなければ待たずに 503、解放)、届いたバイト数で大きさを数える、本文の上限 | 4.4 | `src/http/concurrency-slots.spec.ts`、`receive-upload.spec.ts` | 例外 class の 2 件は対。`file_too_large_message_contains_limit` (1) は応答の文言が同じであること |
| `test_live_disconnect.py` (4) | 本物のサーバーで、変換の途中で切断すると子が止まり枠が戻る、30 回で漏れない | 4.4 | `src/http/client-disconnect.integ.ts` | 偽の子が要るので黒箱ではない |
| `test_live_server.py` (11) | 本物のサーバーで: 一時ディレクトリを使わない、宣言の大きさで早く 413、chunked の上限、枠、受信の時間切れ、認証が先、ログ | 4.4 | `src/http/receive-upload.integ.ts` | 「一時ファイルを作らない」は、サーバーの `os.tmpdir()` を見るので黒箱にしない。ログの 2 件は `request-log.spec.ts`。宣言の大きさの 413 は既定の上限で足りるので黒箱にも置ける (`test/http/intake.integ.ts`) |
| `test_main.py` (27) | アプリ全体の `/healthz` `/readyz` `/openapi.json` 認証、lifespan (forkserver の起動と停止)、ログの設定 | 4.4 | `health-routes.spec.ts`、`openapi-route.spec.ts`、黒箱 | **対 (6 件)**: lifespan のうち `app.state.runner`・forkserver の停止・forkserver そのものの自己回復の 3 件 (forkserver は Node 版に無い。守りたい性質 = `/readyz` が戻れることは、上の `test_health.py` の行のとおり 4.4 が守る)、Python の `logging` の設定 3 件 (Node はロガー。`LOG_LEVEL` が効くことは `request-log.spec.ts`)。lifespan の残り 3 件 (部品が読み込めて準備完了・内部の名前を出さない・部品が無いと準備未完了 503) は `runner.readiness()` の結果を 200 / 503 の形にするテストとして `health-routes.spec.ts` に移す |
| `test_schemas.py` (39) | Pydantic のモデル (`PageInfo` `ExtractResponse` `ErrorCode` 8 値 `ErrorResponse`) | 対 (一部 4.4) | `test/openapi/openapi-document.spec.ts` | Pydantic の型検査 (必須・任意・型) は TypeScript の型 (`tsgo --noEmit`) が守る。`ErrorCode` が 8 値で同じ順 → 17.7 の (ii)、応答の形 → 17.7 の (iv)。`extractedCharacters` はコードポイントの数 (17.10) |
| `test_security.py` (7) | XXE の対策の bootstrap (標準の XML 解析を `defusedxml` に替える) | 対 | `safe-xml.spec.ts`、`xml-text.spec.ts` | Node には標準の XML 解析が無い。XXE と billion laughs は `safe-xml.spec.ts` (DTD・実体を拒む) と `xml-text.spec.ts` (展開しない) が守る (test_ooxml_xml / test_text の項目) |
| `test_smoke_extract.py` (8) | CI の補助 script (`smoke_extract.py`、`check_openapi_drift.py`): 応答の確認、multipart の本体、drift の比較 | 4.4 (一部) | `test/openapi/openapi-drift.spec.ts` | 比較の関数 (形の違いは drift でない・内容の違いは drift・commit 済みの文書と同じ) は 17.7 の 1 のとおり 4.4 が書く。smoke の 5 件は、6.12 が黒箱のテストを `BLACKBOX_URL` でコンテナに向ける形にするか、小さな script を書く (6.12 が決める。script を書くなら 6.12 が隣にテストを置く) |
| `conftest.py`、`fixture_files.py`、`live_apps.py`、`live_server.py` (補助) | トークンと `TestClient`、生成器、偽の子つきのアプリ、uvicorn の起動 | 既存 / 4.4 | `test/fixtures/` (既存)、`src/http/spec-support/` | `fixture_files.py` は `test/fixtures/` が代わる (2 節、10 節)。`live_server.py` / `live_apps.py` は Node では `createApp` + `serve` をポート 0 で起動する補助に替わる |
| `fixtures/`: `sample.txt`、`sample.json`、`README.md`、`legacy/*` (8 ファイル。`legacy/` は 5) | 固定の入力 | 既存 / 対 | `test/fixtures/legacy/` (既存、出所は `PROVENANCE.md`) | `sample.*` と `README.md` は対 (文字列を直接書く)。`legacy/` は移し済み |

- `__pycache__` に残る `*_tmp`、`test_zz_probe*`、`test_e2e_extract` などは `.py` の元が無い古いキャッシュで、テストではない (`find tests -name '*.py'` は 49 件)。

### 22.4 目印の方法の決め方と、動かして確かめた結果

**候補と結果** (vitest 3.2.6、Node 24.22.2。scratchpad で動かした):

| 方法 | 動いたか | 向かない点 |
|---|---|---|
| (a) vitest の `tags` | **使えない**。`vitest run --tags-filter='!node-only'` は `CACError: Unknown option --tagsFilter`。`{ tags: [...] }` は無視され、全件が動く | — |
| (b) ファイル名 (`*.node-only.integ.ts`) と `--exclude '**/*.node-only.*'` | 動いた (`health.blackbox.spec.ts` だけが動き、`node-only` の側は動かなかった) | 話題ごとに目印の有無でファイルを割る必要がある。ファイル名の書き違いで黙って外れる。外したテストが報告に出ない |
| (c) テスト名の印と `-t '^(?!.*\[node-only\])'` | 動いた (飛ばした 3 件が `↓` で出た) | 名前の正規表現に頼る。包みを使わずに名前だけ真似ても外れる |
| **(d) 環境変数 `BLACKBOX_TARGET` と `describe.skipIf` / `it.skipIf` の包み (推奨)** | 動いた (下) | 包み (1 ファイル約 40 行) を 1 つ持つ |

**(d) を選ぶ理由**: (1) 飛ばしたテストが `↓` と `Tests N skipped` で報告に出て、理由の id が名前に入る。(2) 理由の id を型 (`NodeOnlyReason`) にするので、表にない理由を付けるとコンパイルで落ちる。(3) 話題ごとにファイルを割らなくてよい。(4) `vitest list test/http | grep -o '\[node-only:[^]]*\]'` で一覧が取れ、22.5 の表と機械で突き合わせられ、Python 版で落ちたテストの集まりとも突き合わせられる (付けすぎと付け忘れの検出。4.6 の手順)。**期待を向け先で切り替える仕組み (`byTarget` など) は置かない**: 目印のないテストが Python 版でも同じ期待で通ることが 4.6 (Req 6.3) の検査なので、期待を切り替えると検査が空になる。違いは目印を付けて外す。

**最小の例** (scratchpad の `vt/test/http/blackbox-target.ts` と `health.spec.ts`。4.4 がこの形で `test/http/blackbox-target.ts` に置く):

```typescript
export type BlackboxTarget = 'node' | 'python';
export type NodeOnlyReason =
  '17.6' | 'D2' | 'D3' | '7.5-2' | '7.5-3' | '16.1' | '16.9';

export const readTarget = (env: Readonly<Record<string, string | undefined>>): BlackboxTarget => {
  const raw = env.BLACKBOX_TARGET ?? 'node';
  if (raw !== 'node' && raw !== 'python') throw new Error(`BLACKBOX_TARGET must be node or python, got: ${raw}`);
  if (raw === 'python' && (env.BLACKBOX_URL ?? '') === '') throw new Error('BLACKBOX_TARGET=python needs BLACKBOX_URL');
  return raw;
};
const target: BlackboxTarget = readTarget(process.env); // not exported: a test must not branch its expectation on the target

export const describeNodeOnly = (reason: NodeOnlyReason, name: string, body: () => void): void => {
  describe.skipIf(target === 'python')(`[node-only:${reason}] ${name}`, body);
};
export const itNodeOnly = (reason: NodeOnlyReason, name: string, body: () => void | Promise<void>): void => {
  it.skipIf(target === 'python')(`[node-only:${reason}] ${name}`, body);
};
```

**実際の Python 版に向けて動かした結果** (research.md 8 節のとおり Python 版を `127.0.0.1:18010` で起動した。起動した PID だけを止め、`pgrep -g` が空でポートが解放されたことを確かめた):

```
Python 版: GET /readyz -> {"status":"ready","dependencies":{"anydoc":"ok","pypdfium2":"ok","charset-normalizer":"ok","converter":"ok"}}
Python 版: GET /docs (トークンなし) -> 401、(トークンあり) -> 200、GET /redoc (トークンあり) -> 200

(1) 目印を無視して全部動かした (BLACKBOX_TARGET=node のまま Python 版へ。BLACKBOX_URL=http://127.0.0.1:18010):
    ✓ /healthz answers ok without a token  ✓ /readyz is ready and lists the converter  ✓ /docs without a token is 401 on both
    × [node-only:D2] readyz dependency names > lists the real package names   (配列 4 つが期待の 4 つと違う)
    × [node-only:D3] GET /redoc with a token is not served                     (expected 200 to be 404)
    Tests  2 failed | 3 passed (5)
(2) BLACKBOX_TARGET=python BLACKBOX_URL=http://127.0.0.1:18010 vitest run test/http --reporter=verbose:
    ✓ (上の 3 件)  ↓ [node-only:D2] readyz dependency names  ↓ [node-only:D3] GET /redoc with a token is not served
    Tests  3 passed | 2 skipped (5)
(3) BLACKBOX_URL なしで vitest list test/http | grep -o '\[node-only:[^]]*\]' | sort | uniq -c:   1 [node-only:D2]   1 [node-only:D3]  (飛ばした 2 件と一致)
```

ほかに確かめたこと: `BLACKBOX_TARGET=python` で `BLACKBOX_URL` が無いと `BLACKBOX_TARGET=python needs BLACKBOX_URL` で即座に失敗する。`BLACKBOX_TARGET=pythn` は「node か python のどちらか」と失敗する。`vitest list test/http` は `BLACKBOX_TARGET` を付けない (`node`) 状態で、目印の付いた全テストの名前を出す (`BLACKBOX_TARGET=python` で出すと飛ばすテストは出ないので、突き合わせは付けない状態で行う)。飛ばした件数 (`Tests N skipped`) は、この一覧の件数と一致した (2 件)。この例の `health.spec.ts` は、4.4 が書く本物の黒箱のテストの代わりに置いた最小の例である。

**4.6 の手順**:
1. Python 版を research.md 8 節の既定の設定で 1 回起動する。
2. **`BLACKBOX_TARGET` を付けずに (`node` のまま)**、`BLACKBOX_URL=http://127.0.0.1:<port> BLACKBOX_TOKEN=<起動のトークン> ./node_modules/.bin/vitest run test/http` を Python 版に向けて 1 回流す。`BLACKBOX_URL` を設定すると、`vitest.config.ts` の `fileParallelism` がファイルの並列を切る (枠 3 つのサービスに 10 ファイルが同時に要求を送ると、偶然の 503 で落ちるため。タスク 4.4)。`--no-file-parallelism` を付ける必要は無い。6.12 がコンテナに向けるときも同じ。`BLACKBOX_URL` なし (Node 版をファイルごとに自分で起動する) の通常の実行は、従来どおりファイルを並べて動かす。
3. **落ちたテストの集まりが、目印の付いたテストの集まり (`BLACKBOX_URL` なしで `vitest list test/http` が出す `[node-only:<id>]` の名前) と完全に一致する**ことを確かめる。
   - 目印が付いているのに通ったテストは、目印を外す (**付けすぎ**。`BLACKBOX_TARGET=python` で流すと飛ばされ、何も警告が出ないので、この手順でしか見つからない)。
   - 目印が無いのに落ちたテストは調べる (付け忘れ、またはテストの間違い)。
4. 理由の id が 22.5 の表と 1 対 1 であること (`vitest list` の id の集合 = 22.5 の id の集合。7 つ: `17.6`・`D2`・`D3`・`7.5-2`・`7.5-3`・`16.1`・`16.9`) を確かめる。
5. 最後に `BLACKBOX_TARGET=python` で流し、目印の付いたテストだけが飛ばされ、残りが通ることを確かめる。

**手順 3 を動かした結果** (scratchpad の `check-markers.mjs`。`vitest list --json` と `vitest run --reporter=json` の結果を突き合わせる約 20 行の script。Python 版は 127.0.0.1:18010 に起動し、起動した PID だけを止めた。ポートの解放を確認した):

```
付けすぎ (GET /healthz に D3 を付けた) と付け忘れ (/docs のテストに目印なし) を入れた例:
  marked: [D2 の 1 件, D3 の GET /healthz]    failed: [D2 の 1 件, 目印なしの /docs]
  OVER-MARKED: [ '[node-only:D3] GET /healthz is 200 (wrongly marked)' ]
  FORGOTTEN:   [ 'both services > /docs with a token is not served' ]        exit=1
直した後 (付けすぎを外し、/docs のテストに D3 を付けた):
  OVER-MARKED: []   FORGOTTEN: []                                           exit=0
```

付けすぎと付け忘れの両方を検出できた。この script は 4.6 の担当が必要なら `scripts/` か作業の記録に置く (置くかは 4.6 が決める)。

### 22.5 Python 版に向けて動かすときに外すテストと根拠

理由の id は `NodeOnlyReason` の値で、行と 1 対 1。黒箱 (`test/http/*.integ.ts`) の中のテストだけが対象 (黒箱でないテストは Python 版に向けないので、目印は要らない)。

| id | 外すテスト (Node 版の黒箱) | Python 版の振る舞い | 根拠 |
|---|---|---|---|
| `17.6` | `/openapi.json` の説明文 5 か所が直した後の文であること (`/readyz` `/extract` `ErrorCode` `ExtractResponse` `PageInfo`) | 直す前の文 (forkserver、`None` など) | Req 7.1 / 7.5、17.6 の JSON。説明文を除いた比較 (drift) は両方で通るので目印は付けない |
| `D2` | `/readyz` の `dependencies` の名前が `@firecrawl/anydoc` `@embedpdf/pdfium` `prlimit` `converter` の 4 つであること | `anydoc` `pypdfium2` `charset-normalizer` `converter` | D2、7.3、18.10 (T6 の部品は名前で出さない)。`converter` が `ok`、内部の名前が出ない、`pdf_strategy` が無い、は両方で通る (目印なし) |
| `D3` | トークンありの `GET /docs` `GET /redoc` が 404 | 200 (画面が出る)。トークンなしは両方 401 (目印なし) | D3、7.2 |
| `7.5-2` | boundary に CR を含む要求 (d37 番) が 422 | 200 | 7.4 の 2、7.5 の 2 |
| `7.5-3` | 要求の `charset` で**状態が変わる**もの: m58・m61・v11・v18 (Python 422、Node 200)、v01・v02・v16 (Python 200、Node 422)、v10 (Python 500、Node 200)。v07 (拡張子が変わる) は、4.4 で作り直した要求に `mimeType=text/plain` を付けたので、どちらも 200 になり目印を付けない (実際に目印が付くのはこの 8 通り) | 左の列のとおり | 7.4 の 3、7.5 の 3。**状態が同じ 200 でファイル名の読み方だけが違うもの (m59・m60・d12・v03・v06・v15・v19・v20) は目印を付けない** (拡張子が同じで、状態から見えない。形式の判定を確かめるテストを置くときだけ付ける) |
| `16.1` | `filename*=` と `filename*0=` を混ぜた要求 (d36・m21 番) が 422 `extraction_failed` | 500 (`code` なし) | 16.1 と 7.4 の「崩したことにはしないが、理由つきで Python 版と違うもの」(208 行)。**決定済み**: Node 版がエラー表に合わせ、4.x / 6.x のテストは Python 版と期待を分ける (212 行) |
| `16.9` | HTTP の層の細かい違い 9 通り (y01・y04・y12・y14・y15・y16・y22・y37・y38): `GET`/`PUT`/`OPTIONS`/`HEAD /extract` が 404 (Python 405)、`POST /extract/` が 404 (Python 307)、`Expect: foo` が 417 (Python 200)、`Host` なしが 400 (Python 200)、`Authorization` の末尾の空白が 200 (Python 401) | 括弧のとおり | 16.9 の「HTTP の層の細かい違い」。**7 節の記録が無く、扱いは 6.8 が決める** (22.8 の 3)。黒箱に置くときだけ付ける |

**黒箱でないので目印が要らないもの** (参考): `WORKERS` を読まない (D1) は HTTP から見えない。4.2 の設定のテスト (`WORKERS` を設定しても読まない) と 4.5 の配備物のテスト (compose と k8s に `WORKERS` が無い) が守り、どちらも Python 版に向けない。ZIP の名前が `../` の XLSX は 4.2 の単体で、黒箱に置かない (22.8 の 2)。ログの 1 行、設定を変えるもの、偽の子を使うものは HTTP の層のテスト (22.2)。

**黒箱に置かない入力** (Python 版と Node 版で結果が違い、目印を付けても意味が薄いもの): 結果が約 1,310 万字を超える ASCII の DOCX、1 つの要素が約 48MiB の画像を持つ XLSX、1 ページに約 226 万字を超える PDF (どれも Python 版は通り Node 版は `resource_limit_exceeded`。20.9)。HTML は 18.7 の 8 の違い (閉じていない開始タグで終わる文書など) を避ける。

### 22.6 Python と違う期待で書く Node 版の単体テスト (外すのではなく、Node の期待を明記)

単体テストは Python 版に向けないので目印は要らない。期待が Python 版と違う点を、テストの名前か理由の 1 行で書く。

- 18.7 の 1 (デコードの表: `〜` → `～` など 6 字)、2・3・4 (宣言 `iso-8859-1`・`ascii`、`replacement` のラベル)、7 (ZIP の名前は latin-1)、8 (HTML: 末尾の閉じていない開始タグ、`<!-->`)、9 (OOXML の XML: 同名の属性、WHATWG にだけある文字コード名、名前空間の宣言 1,000 個の上限、DOCTYPE の引用符、`ATTLIST`)、10 (`cp437` などの宣言) → `charset.spec.ts` `html.spec.ts` `safe-xml.spec.ts`。**Python 版で失敗する期待は、理由を付けた名前にする。Python 版と同じ振る舞いに戻すテストは書かない** (Req 2.3 の記録だけ)。
- ZIP の読み (18.7 の 9 の表): ローカルの見出しと中央ディレクトリの名前の違い、圧縮後の大きさの偽り → Node 版のほうが緩い向き。テストは「落ちずに結果を返す」を確かめる。
- 結果が上限を超えたときの種類は `result_too_large` (20.12。試作の `limit_exceeded` ではない)。
- wire (タスク 4.2 で決めた): 片割れのサロゲートを含む結果は、`encodeResult` が送る前に `WireProtocolError` で拒む (22.3 では「6.1 が決める」としていた)。Node のまま書くと、`JSON.stringify` は `\ud800` の形で出して親の側で拒まれ、`TextEncoder` は黙って U+FFFD に置き換えるので、どちらも原因が見えなくなる。Python 版の厳密な UTF-8 と同じく、子の側で止める。
- wire (タスク 4.2 で決めた): `pageNumber` が小数の行は、Python のテストの `1.0` を Node では `1.5` に替えた。`JSON.parse` は `1.0` と `1` を区別せず、`1.0` は正しいページ番号の 1 として通る (害は無い)。
- 変換の層はログを出さない (タスク 4.2 で決めた)。Python 版の XLSX の分割の「目印で説明できない出力のときに警告をちょうど 1 回出し、シート名をログに出さない」(`test_xlsx_split.py` 504〜506 行) と `test_well_formed_output_is_not_logged` (524 行) は移していない。Node 版の子の標準出力と標準エラーは、親が大きさの上限を付けて読み捨てる設計 (design.md 554 行) なので、変換の層のログは運用者に届かない。XLSX の分割が全体を 1 要素で返すことは、ログではなく結果 (`xlsx-split.spec.ts` の fallback の 7 件) で確かめる。
- 設定の読み方 (タスク 4.2 で決めた。Req 1.9 の作業者の判断で、7 節の崩した契約には入れない): Python 版 (pydantic-settings) は環境変数の名前の大文字・小文字を区別せず、作業ディレクトリの `.env` も読む (`config.py` の `model_config`)。Node 版の `loadSettings(env)` は、渡された環境変数を大文字の名前でだけ読み、`.env` も `process.env` も自分では読まない。運用者は壊れない: この 2 つは公開された契約 (対象 spec の design.md の Configuration の表) に無い。compose の `env_file: .env` は compose 自身が読んで環境変数に入れる仕組みで、image に `/app/.env` は無い。k8s の例と `.env.example` は大文字の名前だけを使う。7.4 の d36・m21 と同じ「崩したことにはしないが、理由つきで Python 版と違うもの」として、取り込み (Req 12) のときに運用者に知らせる。

### 22.7 担当ごとの「書くテスト」の一覧

各行は、テストファイルが確かめる項目の見出し。件数の目安は Python 版の件数 (22.3)。

**4.2 共有層・設定・変換の層** (`src/formats/`、`src/wire/`、`src/config/`、`src/conversion/**`)
- `format-table.spec.ts`: MIME だけ・拡張子だけ・大文字小文字・MIME の引数・総称の MIME から拡張子へ・MIME が表にあれば拡張子より優先・非対応の 8 種・`xls` を `xlsx` で渡す
- `input-size.spec.ts`: CSV / TSV 8MiB と HTML 20MiB の境 (ちょうど / 1 バイト超)・他の形式は無制限・detail にサイズと名前を出さない
- `length-prefixed-json.spec.ts`: 4 バイトの長さ・部分読み書き・上限・切れた枠・結果の JSON の形・不正な本文と形を拒む (子が送るデータをコードとして扱わない。Req 3.9)
- `load-settings.spec.ts`: トークンが無い・空・空白で失敗 (Req 1.5)・12 項目の既定値 (`MAX_CHILD_RSS_MB` 320、`MAX_XLSX_CELLS` 70,000 など)・整数・上書き・`LOG_LEVEL`・不正な値は起動時に失敗・**`WORKERS` を設定しても読まない**・設定から変換の上限を作る
- `convert.spec.ts`: 経路ごとの要素の数・番号・label・空の要素の規則・最低 1 要素・結果の上限 (UTF-8 のバイト数)・失敗の種類・想定外の例外は `internal` (文字列やオブジェクトを投げても)・入口が CSV / HTML の上限を自分でも守る
- `normalize.spec.ts` / `pdf.spec.ts` / `office.spec.ts`: 22.3 のとおり
- `text/*.spec.ts`: `charset` (42)、`plain-text` (6)、`html` (23 + 18.10 の追加)、`xml-text` (14)、`ipynb` (11、サロゲートの 1 件を含む)、`csv` (6)、HTML と XML 共通 (2)、サロゲート (5)
- `ooxml/*.spec.ts`: ZIP の事前検査、安全な XML、PPTX の分割、XLSX のセル数と分割
- `anydoc-contract.spec.ts`: 版が 0.2.4 に固定、PPTX の分割 (足したものは全体と同じ)、XLSX の目印、XLS を `xlsx` で渡す、例外の `ConvertErrorCode` から失敗の種類への対応

**4.3 実行管理 (子プロセス)** (`src/runner/**`、`src/child/**`、Linux のみ。`describe.skipIf(process.platform !== 'linux')`)
- 単体: `child-exit.spec.ts` (終わり方 → 失敗の種類。15.6 の表)、`linux/prlimit-args.spec.ts` (仮想メモリ = RSS + 2,304MiB を親の hard で切る、CPU の soft < hard、コア 1)、`linux/proc-rss.spec.ts`、`child-env.spec.ts` (トークンなし、`RAYON_NUM_THREADS=1`、`MALLOC_ARENA_MAX=2`)
- 結合 (本物の子): 時間切れ・RSS 超過・abort / segfault・結果なしの終了・SIGXCPU・親の消失 (1 秒以内)・結果の上限・中止で子が止まり回収される・200 回で漏れない・一時ファイルが残らない・`/proc/<pid>/limits` と `oom_score_adj`・トークンが子の環境に無い・子が送ったデータをコードとして扱わない・`prlimit` が無いと準備未完了・確認用の子が固まっても期限内に答える・基準のファイル (7 万セル XLSX、画像 12 枚の 48MB DOCX) の子の最大 RSS が 0.95 倍以内・同時に動かしてすべて成功する・入力の大きい子を見張る間も親のイベントループが応答する (Node の親は 1 本のスレッドで、見張りが止まると `/healthz` も止まる。Python 版の `test_concurrent_runs_all_succeed` と `test_supervising_a_slow_child_with_a_large_input_keeps_the_event_loop_responsive`)・変換の途中で切断された後も子と fd が残らない (黒箱の「失敗が次を壊さない」では見えない部分。200 回の漏れのテストが守る)
- 結合 (本物の子、タスク 4.2 のレビューで足した): 上限 (`MAX_ARCHIVE_UNCOMPRESSED_MB` 512MiB) を超えて展開される部品を持つ PPTX / XLSX (申告の大きさを偽った ZIP 爆弾) を本物の子に通すと、`limit_exceeded` で返り、`memory_exceeded` にならない。部品を全部展開してから大きさを比べる実装は RSS の上限に当たるので、失敗の種類で見分けられる。Python 版は `test_archive_guard.py` 289〜297 行で、読み出しの最大のメモリを `tracemalloc` で 10MiB 未満と確かめていた。単体の側では、`archive-guard.spec.ts` が「上限の手前で読みをやめる」ことを、4MiB の後ろに壊れた deflate のブロックを置いた部品で確かめる (上限で止まれば `limit_exceeded`、全部を展開すれば `malformed`)。tasks.md の 4.3 の「RSS の超過」「結果の上限」と同じ子の失敗の分類の範囲で、4.3 の記述と矛盾しない。

**4.4 HTTP の層と黒箱**
- `src/http/` 単体: `bearer-auth` (3 パスだけ認証なし、存在しないパスも 401)、`concurrency-slots`、`receive-upload` (届いたバイト数で上限)、`parse-multipart` + `header-params` (16.9 の固定データ)、`extract-route` (偽の runner。失敗の対応・枠の解放・中止の合図・`extractedCharacters` はコードポイント)、`error-table` (全失敗の種類)、`health-routes` (200 / 503 `not_ready`、`/healthz` は 200 のまま、**未完了の後に準備完了になれば `/readyz` が 200 に戻る**)、`request-log` (出す項目と出さない項目)、`openapi-route`
- `src/http/*.integ.ts` (本物のサーバーと子、設定を変える): `extract-limits` (上限の行・入力の大きさの上限・時間切れ・子の失敗・枠)、`receive-upload` (宣言の大きさで早く 413・chunked・枠・受信の時間切れ・一時ファイルを作らない)、`client-disconnect`
- `test/openapi/`: 17.7 の 1 (説明文を除いた drift) と 2 の (i)〜(iv)、書き出しの手順、比べる関数。17.10 はこれを 6.9 が作ると書くが、TDD の順 (Req 6.1) と tasks.md の 4.4 (`/openapi.json`) に従い 4.4 が先に書き、6.9 で通る。`test/openapi/` と `test/deploy/` はこの表で決めた置き場所 (design.md の File Structure Plan には無い)
- **multipart の固定データ (16.9 の (a))**: 312 通りの生の要求と、Python 版の結果 (受け付けたか・ファイル名・拡張子・`mimeType`・大きさ・sha1・状態と `code`)。試作の道具 (`cases*`、`py_oracle.py` など) は research.md の 16.8 のコードの断片にしか無く、リポジトリには無い (scratchpad は消えている。未確認だが、この作業では見つからなかった)。作り直しには Python 版が要る。**tasks.md にこの作業の担当が書かれていない** (22.8 の 3)
- `test/http/*.integ.ts` (黒箱): `auth` (認証)、`health` (`/healthz` `/readyz`、トークンなしの `/docs` `/redoc` は 401、トークンありは 404 (D3))、`formats` (形式の表 36、サロゲートペアを含むページの `extractedCharacters` はコードポイントの数 (17.10。tasks.md の 4.4 の黒箱の範囲と矛盾しない))、`line-breaks` (5)、`errors` (エラー表 13 行 + 401 + 失敗が次を壊さない)、`request-shape` (`file` が無い・空のファイル・ファイル名なし・`mimeType` の名前。17.10 の表)、`hygiene` (応答に中身とファイル名が無い。同じ Python のテストにある「ログにも出ない」の側は外のサービスのログが読めないので `request-log.spec.ts` へ)、`intake` (宣言の大きさで早く 413)、`openapi` (drift、応答の形)、`multipart-raw` (固定データのうち Python 版と同じ状態のもの)

**4.5 配備物**
- `dockerfile.spec.ts`: Node 24 の slim の版を固定、uid 10001、最終の段で `prlimit` を実行 (Req 8.7)、`RAYON_NUM_THREADS=1`、`pnpm deploy --prod`、`WORKERS` が無い、`/dev/shm` を使わない
- `compose.spec.ts`: read-only と tmpfs、uid と capabilities、メモリ、healthcheck と init、永続ボリュームなし、外向き通信の遮断、`WORKERS` が無い (`context` は 8.2 まで通らない)
- `k8s-manifests.spec.ts`: 27 項目 (安全設定、requests 512Mi / limits 2Gi、probe、HPA、NetworkPolicy、共有メモリなし、`WORKERS` なし)
- `production-dependencies.spec.ts`: 本番の依存が許可した 9 個だけ

### 22.8 親と 6.x の担当に決めてほしい点 (ユーザー判断は要らない)

1. **`vitest.config.ts` の `include`**: 22.2 のとおり `*.integ.ts` を拾う設定に変える必要がある。4.2〜4.5 は並行して進める (P) ので、並行の前に親が 1 回だけ変えるのが安全 (推論)。この 4.1 は変えていない。
2. **ZIP の名前が `../` などの XLSX の扱い**: 18.10 が 6.x の (a) 読み飛ばす / (b) `malformed` / (c) `kind` を付けて投げる、から選ぶとしていて、**7 節に記録が無く未決**。4.2 のテストは (a) (Python 版と同じ 200。18.10 の推奨) で書く。(b) か (c) を選ぶなら、Req 1.9 / 1.10 の記録 (7 節) と、黒箱に置く場合の目印が要る。
3. **16.9 の HTTP 層の 9 通り** (405 → 404、307 → 404、`Expect: foo` の 417、`Host` なしの 400、末尾の空白の `Authorization` の 200): Python 版と状態が違うのに 7 節 (Req 1.10) に記録が無い。16.9 は「7.4 には諮らない」とし、Req 1.2 / 1.3 / 1.6 / 7.x の約束の外で、Req 1.9 は崩すかを作業者が判断するとしている。(a) 7 節に足して崩した契約として扱う、(b) Node 版も Python 版に合わせる、のどちらかを 6.8 で決める。決まるまで、黒箱に置くときは目印 `16.9` を付ける。**d36・m21 は決定済み** (7.4 の 208・212 行、16.1): Python 版は `code` の無い 500 を返すので、(b) で合わせると Req 1.3 とエラー表に反する。Node 版は表どおりの 422 で、目印 `16.1` を付けて外す。また 16.9 の (a) の固定データ (312 通り) を作る担当が tasks.md に無い。Python 版を撤去 (8.2) する前に作る必要があるので、4.4 に含めるのが自然 (推論)。
4. **Node 版の CI の workflow の静的テスト**: 22.3 の `test_ci_workflow.py` のとおり、書く 4.x のタスクが無い。既定は「対応させない」。足すなら 4.5 に約 10 項目。4.5 の範囲は広げていない。
5. **環境の注意 (4.6 の担当へ)**: リポジトリの `services/attachment-text-extractor/.venv/bin/python` は、存在しない uv の Python (`/home/vscode/.local/share/uv/python/`) を指す壊れたリンクで、research.md 8 節の `.venv/bin/uvicorn` の起動は、そのままでは動かない。この作業では scratchpad に `UV_PYTHON_INSTALL_DIR` と `UV_PROJECT_ENVIRONMENT` を向けて `uv sync --frozen --extra dev` した (Python 3.12 をネットワークから取得した。リポジトリの `.venv` と `git status` は変わっていない)。`pytest --collect-only` は 0.59 秒で 1222 件。4.6 も同じ手順を使える。
6. **7.5 の 1 は実際には差が無かった (タスク 4.4)**: 7.5 の項目 1 の訂正の注記のとおり、`Content-Length` が本文より小さい要求には Python 版も `code` の無い 400 を返す。理由の id `7.5-1` は外した (22.5)。完了の報告 (Req 1.12) で、ユーザーにこのことを伝える。

### 22.9 確かめたこと・確かめなかったこと

- 確かめた (実測): Python のテストの全ファイルと件数 (49 ファイル、1222 件、`pytest --collect-only`)。vitest 3.2.6 に `tags` が無いこと。(b)(c)(d) の 3 つの方法が動くこと。(d) が実際の Python 版 (`/readyz` `/docs` `/redoc`) に対して、目印なしで失敗し、目印ありで通ること。現在の `vitest.config.ts` が `*.integ.ts` を拾わないこと。
- 確かめなかった: Node 版のテストの本体 (この 4.1 は表と方法を決めただけ)。黒箱のテストの中身が Python 版で通るか (4.6)。`test_dependencies.py` の「本番の依存に外部コマンドを使う部品が無い」の Node 版の許可・禁止の一覧の中身 (4.5 が決める)。16.9 の 9 通りが、実際に Python 版と何が違うかの再測定 (16.9 の記述を写した)。
- RED (対応表の作成前): `grep -n "^## 22" research.md` は出力なし (終了コード 1) だった。

## 23. テストが決めた実装の名前と形 (タスク 4.2)

2026-11-09 に、4.2 の単体テスト (`apps/attachment-text-extractor/src/**/*.spec.ts` の 22 ファイル、981 件) が import する名前と型をまとめた。**テストが import する名前が、4.7 (空の実装) と 6.x (実装) の仕様になる**。design.md の File Structure Plan と Components and Interfaces に無いものは (新) と書いた。下の一覧は、テストファイルの import を読んで確かめた。

### 23.1 モジュールごとの export

- `contract/` (型だけを持つ末端の層。`index.ts` は型だけを export する)
  - `failure-kind.ts`: `FailureKind` (9 つの値。design.md のとおり)
  - `extract-response.ts`: `PageInfo { readonly pageNumber: number | null; readonly label: string | null; readonly content: string }`、`ConversionOutcome` (`{ kind: 'ok'; mimeType; pages }` か `{ kind: 'failed'; failure: FailureKind; detail }`)
  - `conversion-limits.ts` (新しい置き場所): `ConversionLimits` (`maxXlsxCells`、`maxPdfPages`、`maxArchiveEntries`、`maxArchiveUncompressedBytes`、`maxResultBytes`、`maxCsvBytes`、`maxHtmlBytes`。すべて readonly の number。項目は design.md の 7 つのまま)
- `formats/`
  - `format-table.ts`: `resolveFormat(fileName: string, mimeHint: string | null): ResolvedFormat | null` (null は非対応)。型 `Route`、`AnydocFormat` (11 の値)、`TextKind = 'plain' | 'html' | 'xml' | 'ipynb' | 'csv'` (新)。`ResolvedFormat { route; mimeType; anydocFormat: AnydocFormat | null; textKind: TextKind | null }` (`textKind` は新)
  - `input-size.ts`: `checkInputSize(format: ResolvedFormat, size: number, limits: Pick<ConversionLimits, 'maxCsvBytes' | 'maxHtmlBytes'>): InputSizeViolation | null` (新)。`InputSizeViolation = { readonly failure: 'limit_exceeded'; readonly detail: string }` (新)
- `config/load-settings.ts`
  - `loadSettings(env: Readonly<Record<string, string | undefined>>): Settings`。不正な値は `Error` を投げ、メッセージに環境変数の名前を含める。整数は前後の空白を除いて読み、`abc` と `1.5` は拒む。`WORKERS` と `IPYNB_OUTPUT_MAX_CHARS` は読まない。`process.env` と `.env` を自分では読まない (22.6)
  - `Settings` (すべて readonly): `serviceToken`、`maxFileSizeMb`、`timeoutS`、`uploadTimeoutS`、`maxConcurrency`、`maxChildRssMb`、`maxXlsxCells`、`maxResultBytes`、`maxPdfPages`、`maxArchiveEntries`、`maxArchiveUncompressedMb`、`maxCsvBytes`、`maxHtmlBytes`、`logLevel`。`logLevel` は Python の logging の名前を大文字にしたもの (`CRITICAL` `FATAL` `ERROR` `WARN` `WARNING` `INFO` `DEBUG` `NOTSET`)。Node のロガーの段階への読み替えは `request-log` が受け持つ
  - `toConversionLimits(settings: Settings): ConversionLimits` (新)。`maxArchiveUncompressedBytes` は `MAX_ARCHIVE_UNCOMPRESSED_MB` × 1MiB
- `wire/length-prefixed-json.ts` (Python の `runner/wire.py` の写し)
  - `class WireProtocolError extends Error`
  - `encodeFrameHeader(length: number): Buffer` (4 バイトの big-endian。範囲の外は `RangeError`)
  - `readFrame(stream: Readable, maxLength: number): Promise<Buffer>` (枠を 1 つだけ読み、続きのバイトは流れに残す。上限を超える長さと切れた枠は `WireProtocolError`)
  - `writeFrame(stream: Writable, body: Uint8Array): Promise<void>`
  - `maxResultFrameBytes(maxResultBytes: number): number`
  - `encodeResult(outcome: ConversionOutcome): Buffer` (片割れのサロゲートは `WireProtocolError`。22.6)、`decodeResult(body: Uint8Array): ConversionOutcome` (形の違反・重複したキー・`__proto__` などのキー・`NaN` / `Infinity` は `WireProtocolError`)
  - 送る JSON の形は Python と同じ `{ ok: true, pages, mimeType }` / `{ ok: false, kind, detail }`。親が自分で決める種類 (`timeout` など) は子から受け付けない
- `conversion/`
  - `conversion-error.ts` (新): `class ConversionError extends Error { readonly kind: FailureKind; readonly detail: string; constructor(kind, detail) }`。内部の変換の関数はこれを投げ、`convert` だけが結果の値に変える
  - `convert.ts`: `convert(bytes, fileName, mimeHint, limits): Promise<ConversionOutcome>` (例外を投げない。想定外の例外は `internal` で、detail は例外の `name` だけ。文字列やただのオブジェクトが投げられても `internal`)
  - `normalize.ts`: `normalizeNewlines(text: string): string`、`joinBrokenJapanese(text: string): string`
  - `pdf.ts`: `convertPdf(bytes: Uint8Array, limits: ConversionLimits): Promise<PageInfo[]>`。`malloc` が 0 を返したときと、PDFium の `abort` (`RuntimeError`) は `internal` (14.8)
  - `office.ts`: `convertOffice(bytes: Uint8Array, format: AnydocFormat): Promise<string>`。`ConvertErrorCode` から失敗の種類へ: `encrypted` → `encrypted`、`resourceLimit` → `limit_exceeded` (detail には `(max_…)` の名前だけを残す)、`malformed` と `missingPart` → `malformed`、`unsupported` → `unsupported`、そのほか (`needsOcr`・`hosted`・`io`、`code` の無い Error、Error でない値) → `internal`
- `conversion/text/`
  - `charset.ts`: `decodeText(bytes: Uint8Array, declared?: string | null): string`
  - `plain-text.ts`: `plainToText(bytes)`、`html.ts`: `htmlToText(bytes)` (`<meta charset>` を自分で読む)、`xml-text.ts`: `xmlToText(bytes)` (XML 宣言の encoding を自分で読む)。どれも `string` を返す
  - `ipynb.ts`: `ipynbToText(bytes: Uint8Array, outputMaxChars: number): string` と定数 `IPYNB_OUTPUT_MAX_CHARS = 10_000` (新)。1 出力の上限は `ConversionLimits` に入れず、`convert` がこの定数を渡す (`convert.spec.ts` で確かめる)
  - `csv.ts` (新しいファイル。22.3 のとおり): `csvToText(bytes: Uint8Array): Promise<string>`
- `conversion/ooxml/`
  - `archive-guard.ts`: `inspectArchive(bytes: Uint8Array, requiredPart: string, limits: ArchiveLimits): Promise<OoxmlArchive | null>`。`ArchiveLimits = Pick<ConversionLimits, 'maxArchiveEntries' | 'maxArchiveUncompressedBytes'>`。`ArchiveEntry { readonly name: string; readonly declaredSize: number; readonly isDirectory: boolean }` (名前は、UTF-8 の印があれば UTF-8、無ければ latin-1 で読む)。`OoxmlArchive { readonly entries: readonly ArchiveEntry[]; readPart(name: string, maxBytes: number): Promise<Buffer>; openEntry(entry: ArchiveEntry): Promise<Readable>; close(): void }` (`entries` は中央ディレクトリの順で、同じ名前もすべて残す。`readPart` の失敗は、上限を超えると `limit_exceeded`、暗号化の印 (bit 0) は `encrypted`、部品が無い・CRC-32 が合わない・展開できない・閉じた後は `malformed`。上限の手前で読みをやめる)
  - `safe-xml.ts`: `parseXmlPart(bytes: Uint8Array, label: string): Document` (`Document` は `@xmldom/xmldom` のもの。壊れた XML は `malformed`、名前空間の宣言が 1,000 個を超えると `limit_exceeded`)、`serializeXmlPart(document: Document): Buffer` (XML 宣言を `<?xml version='1.0' encoding='UTF-8'?>` にし、DOCTYPE を書き戻さない)
  - `xlsx-cell-count.ts`: `enforceCellLimit(archive: OoxmlArchive, limits: Pick<ConversionLimits, 'maxXlsxCells' | 'maxArchiveUncompressedBytes'>): Promise<void>`
  - `pptx-split.ts`: `convertPptx(bytes, limits): Promise<PageInfo[]>`、`xlsx-split.ts`: `convertXlsx(bytes, limits): Promise<PageInfo[]>`
  - `index.ts` は `convertPptx` と `convertXlsx` だけを export する
- テスト用の補助 (`src/conversion/spec-support/`、本番から import しない): `conversionLimits(overrides)` (本番の既定値に上書きを重ねる)、`conversionErrorOf(run)` (投げられた `ConversionError` を返し、それ以外ならテストを失敗させる)

### 23.2 design.md の File Structure Plan と違う点

- `ConversionLimits` を `contract/` に置いた。formats/ (大きさの事前判定) と runner/ (子への見出し) も使い、この 2 つは conversion/ を import できない (判断 1・2)。`contract/` は型だけを持つ末端の層で、6.10 の依存の検査が禁じる向きに当たらない。
- 足したファイル: `conversion/conversion-error.ts`、`conversion/text/csv.ts`、`conversion/spec-support/`。テストのファイルは、800 行を超えないように `text/html-adversarial.spec.ts` (18.10 の悪意のある入力・自己終了・終わりのタグの読み方) と `ooxml/xlsx-split-repackage.spec.ts` (Python の `copy_part` 系と、ZIP の名前・ディレクトリの要素) に分けた。
- `anydoc-contract.spec.ts` は src を何も import せず、anydoc 0.2.4 そのものの性質だけを確かめる (今すぐ通る)。「分割して足すと全体を一度に変換した結果と同じ」の 8 件は、`convertPptx` / `convertXlsx` を呼ぶので `pptx-split.spec.ts` / `xlsx-split.spec.ts` に置いた (6.5 で通る)。22.3 では契約テストに置く予定だった。

### 23.3 実装が守ること (守らないとテストが黙って意味を失うか、落ちる)

- `vi.mock` は import の指定子で差し替える。実装は次の場所から import すること。
  - `convert.ts` は経路の関数を `./pdf` の `convertPdf`、`./ooxml/pptx-split` の `convertPptx`、`./ooxml/xlsx-split` の `convertXlsx` から呼ぶ (barrel の `./ooxml` 経由でも、同じファイルが読まれるので差し替えは効く見込み。未確認)。`convert.spec.ts` の 13 件がここを差し替える。
  - anydoc の `toMarkdownBytes` は `'@firecrawl/anydoc'` から import する (`office.spec.ts` と split のテストが、本物を包んで呼び出しを記録する)。
  - PDFium は `'@embedpdf/pdfium'` の `init` で読み込み、`malloc` / `free` は `init` が返した値の `pdfium.wasmExports` から呼び、PDFium の関数 (`FPDF…`) は `init` が返した値から呼ぶ (`pdf.spec.ts` が `init` を包んで、`malloc` の 0 と `abort` を起こす。14.8 の試作の形で通ることを確かめた)。
- `inspectArchive` は中央ディレクトリだけを読んで archive を返し、部品のデータは `readPart` のときに読む (「データが申告より早く終わる部品は `readPart` で `malformed`」の件の前提)。
- 変換の層はログを出さない (22.6)。

### 23.4 取り込み (Req 12) のとき

- design.md の Components and Interfaces の節 (共有層・変換の層の型の素案) を、この節の名前と形に合わせて直す。File Structure Plan は design.md の冒頭の注のとおり実装の後に削るので移さないが、`ConversionLimits` の置き場所の理由 (23.2) は「層の分け方の判断」に移す。

### 23.5 タスク 4.3 のテストが決めた実行管理の層と子の側の名前と形

2026-11-09 に、4.3 のテスト (`src/runner/**` と `src/child/**` の 12 ファイル、142 件) が import する名前と、テストが前提にする振る舞いをまとめた。design.md の Components and Interfaces にある名前 (`ConversionRunner`、`RunInput`、`RunOutcome`、`run(input, signal)`、`readiness()`、`createConversionRunner`) はそのまま使った。(新) は design.md に無い名前。

- `runner/conversion-runner.ts`
  - `ChildEntry { readonly path: string; readonly nodeArgs: readonly string[] }` (新): 子として起動するファイルと、そのファイルの前に置く node の引数。
  - `ConversionRunnerOptions` (新): `limits: ConversionLimits`、`maxChildRssMb`、`timeoutS` (小数を許す。設定の `TIMEOUT_S` は整数なので、1 秒未満の期限はここで渡す)、`maxInputBytes`、任意の `childEntry` (既定は本物の子の入口)、任意の `prlimitPath` (既定は `/usr/bin/prlimit`)、任意の `probeTimeoutS` (準備完了の確認用の子の期限)。`childEntry` は `run()` と `readiness()` の確認用の子の両方に使う。テストが偽の子を差し込む口はこの 1 つだけ。
  - `runnerOptionsFromSettings(settings: Settings): ConversionRunnerOptions` (新): 設定から作る。`MAX_CHILD_RSS_MB` と `TIMEOUT_S` が子の上限に、`toConversionLimits` の値が子に渡る。
  - `Readiness` (新): 4.3 が確かめるのは `ready: boolean` だけ。`dependencies` などの形は 4.4 / 6.8 が決める。
  - `createConversionRunner(options): ConversionRunner`。
- 子の起動 (テストが `/proc/self/limits` などで外から確かめる): `prlimitPath --as=… --cpu=<soft>:<hard> --core=1 -- <process.execPath> --wasm-max-mem-pages=8192 --max-semi-space-size=4 <childEntry.nodeArgs…> <childEntry.path>`。子の環境変数は `buildChildEnv()` の値だけ。stdio は 0 入力、1 / 2 ログ (読み捨てる)、3 結果、4 生存管。
- `run()` が守ること: 戻った時点で (成功でも失敗でも) 子は回収済みで、`/proc/<親>/task/*/children` にゾンビも残らない。CSV / HTML の大きさの事前判定に当たったとき (形式が分からない入力は子まで届く) と `prlimit` を起動できないときの `childPeakRssMb` は `null`。`prlimit` を起動できないときは `crashed`。中止の合図 (`AbortSignal`) では、`run()` が解決しても拒否してもよいが、合図から 2 秒以内に終わり、子は回収済みで、同じ runner で次の変換ができる。すでに中止された合図でもすぐに終わる。子の標準出力と標準エラーは読み捨てる (8MiB ずつ書く子でも結果が届く)。`childPeakRssMb` は、`VmHWM` を含めて見回った最大の値 (結果を受け取った直後、止める前にもう 1 回読むと山を取り逃がしにくい)。
- 入力の枠の順 (design.md の Data Contracts): 見出しの枠、本体の枠の 2 つ。偽の子は見出しの中身を読まない (見出しの JSON の項目は 6.6 / 6.7 が決める)。
- `runner/child-exit.ts`: `classifyExit(code: number | null, signal: NodeJS.Signals | null): FailureKind` (新)。結果が届かなかった子だけを分類する (`SIGXCPU` だけが `timeout`、ほかは `crashed`)。結果の有無と、親が決めた種類の優先 (15.6 の順) は結合テストが確かめる。
- `runner/child-env.ts`: `buildChildEnv(): Readonly<Record<string, string>>` (新)。値は `{ RAYON_NUM_THREADS: '1', MALLOC_ARENA_MAX: '2' }` ちょうど。Python 版のテスト `test_operator_set_rayon_threads_is_respected` (運用者が設定した値を尊重する) は移さない (design.md の「子の `env` は明示した値だけ」に従う)。
- `runner/linux/prlimit-args.ts` (新): `PRLIMIT_PATH = '/usr/bin/prlimit'`、`addressSpaceLimitBytes(maxChildRssMb)` (= (`maxChildRssMb` + 2,304) MiB)、`cpuTimeLimits(timeoutS): { soft; hard }` (soft = 切り上げた期限 + 5 秒、hard = soft + 5 秒。Python 版の `cpu_time_limits` と同じ。19.2 の表の `--cpu=60:65`)、`HardLimits { addressSpaceBytes; cpuSeconds }` (`unlimited` は `Infinity`)、`parseHardLimits(procLimitsText): HardLimits`、`prlimitArgs({ maxChildRssMb, timeoutS, hardLimits, command }): string[]` (`--` より前に 3 つの上限、後ろに `command`。上限は親の hard で切り詰める)。
- `runner/linux/platform.ts`: `limitedCommand(input & { prlimitPath }, platform: NodeJS.Platform): SpawnCommand` と `SpawnCommand { file; args }` (新)。Linux では `prlimit` で包み、それ以外では `command` をそのまま起動する。
- `runner/linux/proc-rss.ts`: `StatusMemory { rssKib: number | null; hwmKib: number | null }`、`parseStatusMemory(statusText)`、`readStatusMemory(pid): StatusMemory | null` (プロセスが無ければ `null`) (新)。
- `child/parent-watch.ts`: `startParentWatch(): Promise<void>` (新)。見張りのスレッドが fd 4 を読み始めたら解決する。見張りは、子が自分で終わる経路 (`process.exit`、捕まらない例外、捕まらない Promise の失敗) を止めない (15.3)。
- `child/child-result.ts` (新しいファイル): `encodeChildResult(outcome: ConversionOutcome, maxResultBytes: number): Buffer`。親だけが決める種類 (`timeout`・`crashed`・`memory_exceeded`) と、wire が符号化できない結果 (片割れのサロゲート) は `internal` に、長すぎる `detail` は親が受け付ける長さに切り、枠の上限 (`maxResultFrameBytes`) を超える結果は `result_too_large` にする。Python 版の `child_entry.run_conversion` の単体テストの写し。
- `child/child-entry.ts`: 読み込むと動き出す入口の script。入力を読む前に `oom_score_adj` を 1000 にし、見張りを立てる。長さが不正な入力と途中で切れた入力では、結果を送らずに終わる。テストは swc の register で直接起動する (`src/child/spec-support/direct-child.ts`)。
- **本物の子をテストの中でどう起動するか (決定)**: 理由と決めたことは、この節の下の「本物の子の起動のしかたの決定」にある。既定の `childEntry` は、ビルドで作った JavaScript (`dist/child/child-entry.js`) を register なしで起動する形にする。
- テスト用の補助 (本番から import しない): `src/runner/spec-support/` (偽の子 `stand-in-child.mjs` と `silent-child.mjs`、別のプロセスの親 `runner-host.ts`、ZIP 爆弾 `zip-bombs.ts`、`/proc` の読み取りと後始末)、`src/child/spec-support/` (直接起動 `direct-child.ts`、見張りの確認用の子 `watch-then.ts`、親を消すテスト用の子 `watched-busy-child.ts`)。偽の子の動き方は、ファイルの本体の 1 行目 (`<mode> <argument> <trace>`) で選ぶ。子の側の補助は runner の補助を import しない (層の向きを試験の補助でも守る)。

**本物の子の起動のしかたの決定 (タスク 4.3 のレビューを受けて決めた)**

**理由 (実測)**: テストの中で本物の子の入口 (TypeScript) を swc の register (`--import @swc-node/register/esm-register`) で起動すると、子の RSS が約 100MB 増える。anydoc を読み込んだだけの子で、register なしは 50〜52MB、ありは 150〜160MB だった (この作業で 2 回、レビューで再測定)。register で起動したままだと、基準のファイルの 0.95 倍 (304MB) の検査と、セル数の上限・ZIP 爆弾の 0.4 倍 (128MB) の検査が、起動のしかただけで落ちるか意味を失う。試作では、子の側を JavaScript に変換して起動すると、これらの検査が通った。

**今の状態 (2026-11-09 に実物で確かめた)**:
- `apps/attachment-text-extractor/package.json` に `build` スクリプトは無い (scripts は `lint:biome`、`lint:typecheck`、`lint`、`test`、`benchmark`、`benchmark:generate`)。design.md の File Structure Plan の package.json の説明には `dev/build/lint/test/export-openapi/benchmark` とあり、`build` を足すことは設計どおり。
- `tsconfig.json` は `outDir: "dist"`、`rootDir: "."`、`include` に `src`・`test`・`benchmark` を持つ。継承元の `tsconfig.base.json` は `noEmit: true`、`module: "ESNext"`、`moduleResolution: "Bundler"`。このまま `tsc` で出力すると、子の入口は `dist/src/child/child-entry.js` になり、テストの補助も一緒に出力される。
- src の import は拡張子を書かない (4.2 / 4.3 のテストもそう書いている)。`tsc` は指定子をそのまま出力するので、出力した JavaScript は Node の ESM ではそのまま動かない。リポジトリの前例: `apps/app` は出力の後に `bin/add-js-extensions.ts` (拡張子の無い相対の指定子に `.js` または `/index.js` を足す) を流している。`apps/pdf-converter` は `tsc -p tsconfig.build.json` (`noEmit: false`、`test` を除く) で、指定子に `.js` を書いている。
- `turbo.json` の `build` の出力は `dist/**`。`vitest.config.ts` は `pool` を指定していない (既定の pool)。design.md には子の JavaScript のパス (`dist/...`) の記述は無い (grep で確かめた)。tasks.md の 6.6・6.7・6.11・6.12 にも、ビルドや子の起動のパスの記述は無い。下の決定は、どれとも矛盾しない。

**決定**:
1. 既定の `childEntry` は、パッケージ直下の `dist/child/child-entry.js` を、node の追加の引数なし (`nodeArgs: []`) で起動するものにする。本番の image と同じ JavaScript を、テストでも起動する。
2. `build` スクリプトを足す。`tsconfig.build.json` (`extends: ./tsconfig.json`、`noEmit: false`、`rootDir: "src"`、`outDir: "dist"`、`include: ["src/**/*"]`、`*.spec.ts`・`*.integ.ts`・`spec-support/` を除く) で `tsc` を流し、続けて拡張子の無い相対の指定子に `.js` / `/index.js` を足す手順を流す (`apps/app` の `bin/add-js-extensions.ts` と同じ規則。app をまたいで import はせず、このパッケージに置く)。`rootDir: "src"` なので、出力は `dist/child/child-entry.js`、`dist/main.js` になる。
3. vitest の `globalSetup` (すべてのテストの前に 1 回だけ動く準備の処理) で、この `build` を流す。`vitest` を直接呼んでも、`turbo run test` から呼んでも、`dist/` がいつも今の src から作り直される。`globalSetup` からは `pnpm run` を呼ばず、`tsc` と拡張子を足す手順を直接起動する (pnpm は依存の確認のために中で `pnpm install` を起動することがあり、並行して動く pnpm と衝突するため。`.claude/rules/devcontainer.md`)。
4. `dist/child/child-entry.js` が無いときに、swc の register での起動に戻らない。戻ると、メモリの検査が黙って意味を失うか、古い `dist/` で動いてしまうためである。無ければ、`readiness()` は準備未完了、`run()` は `crashed` になる (子の入口を読めない子と同じ扱い。4.3 の「node が読めない入口は `crashed`」「確認用の子が入口を読めないと準備未完了」の件がこの振る舞いを確かめる)。
5. 受け持ち:
   - 6.6: `tsconfig.build.json`、`build` スクリプト、拡張子を足す手順。子の入口が `dist/child/child-entry.js` に出力されること。
   - 6.7: 既定の `childEntry` (決定 1・4) と、`vitest.config.ts` の `globalSetup` (決定 3)。
   - 4.7: 空の実装の子の入口を `src/child/child-entry.ts` に置く。6.6 より前なので `dist/` はまだ無い。既定の入口で起動できずに落ちるのも、RED として記録してよい (テストの中身の食い違いで落ちる件と区別して書く)。
   - 6.11: Dockerfile のビルドの段で `build` を流し、`dist/` を image に入れる。起動は `node dist/main.js`。
   - 6.12: CI の `turbo run lint test` で `globalSetup` のビルドが動き、実行管理の結合テストが register なしの子で通ることを確かめる (CI に別のビルドの手順は無い)。
6. **tasks.md に足す一文の案** (親が足す。この作業では tasks.md を変えていない):
   - 6.7 に: 「既定の子の入口は `build` で作った JavaScript (`dist/child/child-entry.js`) で、テストも swc の register を使わずに起動する。vitest の `globalSetup` で `build` を流し、`dist/` が無いときに register の起動に戻らない (research.md 23.5)」
   - 6.6 に: 「`build` スクリプト (`tsconfig.build.json` の `tsc` と、拡張子の無い相対の指定子に `.js` を足す手順) を足し、子の入口を `dist/child/child-entry.js` に出力する (research.md 23.5)」
   - 6.11 に: 「ビルドの段で `build` を流し、`dist/` を image に入れる (research.md 23.5)」

**Python 版と違う期待で書いたもの (理由つき)**:
- 病的な HTML の 3 件 (`<a` の後に `/` が 400 万個、200 万個の属性を持つ終わりのタグ、200 万個の属性を持つ開始タグ): Python 版の期待は `memory_exceeded` (標準の `html.parser` が膨らむため)。Node 版は「子の中で収まる (成功か、422 になる種類のどれか) こと、次の変換が成功すること」に緩めた。htmlparser2 はこれらを膨らまずに処理できる (18.5 の悪意のある入力の比べ方、18.7)。
- 申告の大きさを偽った ZIP 爆弾 (部品の申告は 4KiB、実際は 520MiB に展開される PPTX / XLSX): `limit_exceeded` と `malformed` のどちらも許す。4.2 の `archive-guard.spec.ts` が「申告の大きさの偽りは、黙って切り詰めずに `malformed`」と決めているためである。どちらの場合も、`memory_exceeded` にならないこと (子の最大 RSS が 0.4 倍の 128MB 未満) を確かめる。申告どおりの大きさの爆弾 (申告の合計が 512MiB を超える) は `limit_exceeded` だけを許す。
- 許容値を緩めたもの:
  - 期限の件の経過時間: 3.5 秒未満 (期限 0.5 秒)。Python 版は 2 秒未満 (期限 0.3 秒)。Node の子は起動に約 25〜70ms かかり、CI が混んだときも余裕を残すため。
  - イベントループの応答: 間隔の最大が 250ms 未満。Python 版は 100ms 未満。実測は最大約 2ms (15.4 の (7))。同期で 50MiB を書く親は約 1 秒止まるので、250ms でも見分けられる。
  - fd の増加: 200 回で 10 未満。Python 版は 0。1 回に 1 つ漏れれば 200 増えるので、見分ける力は落ちない。vitest 自身が開く fd の揺れを許す。
  - 親のメモリ (大きな入力で 3 回時間切れにした後の RSS の増加): 66MB 未満。Python 版は 24MB 未満。レビューの実測では、同じ入力を使い回す形 (このテストの形) では増加はほぼ 0MiB。入力を毎回作る形では、正しい実装でも 44〜132MiB 増えた (V8 が片付ける時期の都合)。66MB は、まだ片付いていない入力の写しを 1 つ (44MB) だけ許す余裕で、毎回の写しを持ち続ける実装 (3 回で 132MB) は落ちる。
- 「子が残らない」の判定は、テストのプロセスの子 (`/proc/<pid>/task/*/children`) を見る。これは、vitest がテストのファイルごとにプロセスを分ける既定の設定 (`pool` の既定) に頼っている。`pool` を threads などに変えると、他のファイルの子が混ざって成り立たなくなる。
- 準備完了のテストが確かめるのは `ready` の真偽だけで、確認用の子が anydoc と PDFium を本当に読み込むこと (20.12) は 4.3 では確かめない。最後の守りは、6.12 の image の中での `/readyz` と `POST /extract` (PDF と DOCX) の確認である。

### 23.6 タスク 4.4 のテストが決めた HTTP の層の名前と形

2026-11-09 に、4.4 のテスト (`src/http/**` と `test/http/**`、`test/openapi/**`) が import する名前と、テストが前提にする振る舞いをまとめた。design.md の File Structure Plan の `http/` のファイル名はそのまま使った。(新) は design.md に無い名前。

- `contract/error-code.ts`: `ERROR_CODES` (17.7 の 2 (ii) の名前。8 つの値の読み取り専用の配列で、OpenAPI の `ErrorCode.enum` と同じ順) と `ErrorCode = (typeof ERROR_CODES)[number]`。`contract/` の中で唯一の値になる。`contract/index.ts` は型だけを export したままにし、値はファイルから直接 import する。Suggestion (決めなくてよい): 値の置き場所を `http/error-table.ts` にする案もある (`contract/` を型だけの層に保てる)。
- `http/index.ts`: `createApp` と `startServer` (新) を export する。
- `http/create-app.ts`: `createApp(deps: AppDeps)`。`AppDeps { settings: Settings; runner: ConversionRunner; writeLog?: (line: string) => void }`。`writeLog` (新) は 1 件ごとのログの 1 行の書き先で、省くと標準エラーに書く。テストは `process.env` も標準出力も触らずに、ここでログを受け取る。
- `http/start-server.ts` (新しいファイル): `startServer(app, { port, hostname }): Promise<StartedServer>`、`StartedServer { readonly port: number; close(): Promise<void> }`。`@hono/node-server` の `serve` を包み、本番と同じ配線 (`checkContinue` の受け手、`headersTimeout` / `requestTimeout` など。16.9) をここで行う。`main.ts` もテストもこれを使う。ポート 0 を渡すと OS が選んだポートを `port` に返す。`close()` は待機中の接続も閉じて解決する。
- `http/error-table.ts`: `ERROR_TABLE: Readonly<Record<FailureKind, { code: ErrorCode; status: number; message: string }>>`。design.md の `{ code, status }` に、Python 版の決まった文 (`extract_errors.py`。`<kind>: <決まった文>` の形) の `message` を足した。
- `http/concurrency-slots.ts`: `createConcurrencySlots(max: number)` が返すもの (`tryAcquire(): (() => void) | null`) (新)。空きが無ければ待たずに `null`。返す関数を 2 回呼んでも 1 つしか戻さない。
- `http/parse-multipart.ts`: `boundaryOf(contentType: string): string`、`createMultipartParser(boundary: string)` (`write(chunk: Buffer): void` と `end(): { chunks: readonly Buffer[]; size: number; filename: string; mimeHint: string | null }`)、`InvalidMultipart` (16.8 の名前のまま)。不正な本文はすべて `InvalidMultipart` を投げる (`boundaryOf`・`write`・`end` のどれから投げてもよい)。
- `http/header-params.ts`: `parseHeaderParams(value: string): { type: string; params: Record<string, string> }`、`InvalidMultipart`、`UnreadableParams extends InvalidMultipart` (16.8 の名前のまま)。
- `http/openapi-route.ts`: `openApiDocument` (17.9 の名前のまま)。`/openapi.json` はこれをそのまま返す。
- `scripts/export-openapi.ts`: `--output <path>` に文書を書き、親のディレクトリが無ければ作る。`--output` が無ければ 0 でない終了コードで終わる。テストは `node --import <swc の register>` で別のプロセスとして起動する。
- `scripts/check-openapi-drift.ts` (新しいファイル。17.7 の「比べる処理を 1 つの関数にした小さな CLI」): `openApiDrift(actual: unknown, committed: unknown): readonly string[]`。違う所の JSON Pointer の一覧を返す (オブジェクトのキーの順は無視し、配列の順は区別する。注釈としての `description` を除く。`properties` の中の `description` という名前の項目は除かない)。import しただけで CLI の処理が動かないようにする (6.12 の CI の手順は CLI として呼ぶ)。
- `/readyz`: 200 の本文は `{ status: 'ready', dependencies: { '@firecrawl/anydoc': 'ok', '@embedpdf/pdfium': 'ok', prlimit: 'ok', converter: 'ok' } }` ちょうど (D2)。準備未完了は 503 で `status: 'not_ready'` (このときの `dependencies` の値はテストで決めていない。`Readiness` は `{ ready: boolean }` のまま)。要求のたびに `runner.readiness()` を呼び、結果を覚えて使い回さない (未完了から戻れること。22.3 の `test_health.py` の行)。
- 1 件ごとのログ: `writeLog` に渡す行の末尾が `extract format=<f> size=<n> duration_ms=<n> result=<r> child_peak_rss_mb=<n|unknown>` (行の頭に時刻などを付けてもよい)。`format` は成功なら応答の `mimeType`、それ以外はファイル名の拡張子を小文字にして英数字以外を除き 10 字までにしたもの (無ければ `unknown`。Python 版の `_format_of`)。`result` は `ok`、失敗の種類、HTTP の層が自分で返した `file_too_large`・`service_busy`・`invalid_upload` (`upload_timeout`・`client_disconnected`・`internal` も Python 版と同じ名前)。`LOG_LEVEL` が `INFO`・`DEBUG`・`NOTSET` なら書き、`WARNING`・`ERROR`・`CRITICAL` なら書かない。行は応答の後に書いてもよい (テストは行が現れるのを待つ)。
- 413 の `message` は上限の MiB の数を含む (`50 MiB` など。Python 版の文と同じ)。
- `RunInput`: テストは偽の runner が受け取った中身を `Buffer.from(input.bytes)` で読む (`http/spec-support/fake-runner.ts` の `forwardedBytes` の 1 か所)。16.9 の「断片のまま渡す」に合わせて 6.7 / 6.8 が `RunInput` の形を変えるなら、この関数と 4.3 のテストを一緒に直す。

**design.md・22.7 と違う点**:
- `/extract` を通るテストは、本物のサーバーをポート 0 で起こす (要求の本文を `c.env.incoming` から読むので、Hono の `app.request()` では確かめられない)。22.2 の決まりのとおり `*.integ.ts` にした: `bearer-auth`・`health-routes`・`openapi-route`・`extract-route`・`request-log` (22.7 では「単体」の一覧にあった)。子プロセスも本物の HTTP も使わない純関数 (`error-table`・`concurrency-slots`・`parse-multipart`・`header-params`) は `*.spec.ts`。
- 足したテストのファイル: `src/http/early-answer.integ.ts` (16.9 の (e)〜(g))、`src/http/slot-return.integ.ts` (16.9 の (c))、`test/openapi/openapi-document.integ.ts` (17.7 の 2。(iv) で本物のサーバーを使う)、`test/openapi/export-openapi.integ.ts` (書き出しの手順を別のプロセスで動かす)。
- 固定データ: `test/http/multipart-oracle.json` (生の要求 179 通りへの Python 版の応答と、解析器だけの結果。d33・d33b・d33c は undici の `FormData` が書く本文そのもので、固定の boundary を使う。Node 24 の `FormData` の出力と 1 バイトも違わないことを確かめた。d33 は Python 版で 422 `extraction_failed`)、`test/http/header-param-oracle.json` (引数の解析 2,000 件)。要求の中身は生成器 (`test/http/multipart-builders.ts`・`multipart-cases*.ts`・`header-param-samples.ts`) が作り、固定データには結果と要求の sha1 だけを置く。
- 生の要求の番号 (`01`・`e07a`・`d37`・`v01` など) は 16.3 / 16.4 の名前を借りたもので、元のバイト列は残っていなかったので説明から作り直した。中身は元のものと同じではない (たとえば 07・r08・v07 は `mimeType` を付けたので Python 版も 200、37 は Python 版も 400)。m 系のうち研究記録に説明の無いものは作っていない。期待は、この作り直した要求に Python 版が返した結果 (2026-11-09 に実測) で、16.4 の表の値ではない。

**引数の解析の固定データの中身 (レビューを受けて作り直した)**: 生成器は `form-data` の後に `; key=value` の組を 1〜4 個つなぐ。キーは `name`・`filename`・`filename*`・`filename*N`・`filename*N*`・`filename*00`・2^53 前後の番号・`name*`・ASCII でない名前 (`xé*`・`naïve`)・`__proto__` など、値は 16.3 の断片 (ときどき引用符つき)。2,000 件の内訳 (Python 版の結果を 2026-11-09 に取得): ファイル名つき 1,573 件、値の入った引数を持つもの 1,471 件、例外 (TypeError。番号の付いた引数と付かない引数が混ざったもの) 149 件、ASCII でない名前を含むもの 444 件、2^53 前後の番号を含むもの 630 件。16.8 の手本の解析器は 2,000 件すべて一致した。手本を 1 か所ずつ壊すと、番号の比べ方 (`BigInt` を `Number`) で 6 件 + 個別の 1 件、空白の削り方 (`\s` にする) で 768 件、引用符の数え方 (`\"` を引かない) で 163 件のテストが落ちた。個別の 2^53 の件は、壊しても通ってしまう形だったので、倍精度で同じ値になる 2 つの番号の値の並び順で区別する形に直した。

**ほかに決めたこと (タスク 4.4 のレビューを受けて)**:
- 理由の id は 7 つ (`17.6`・`D2`・`D3`・`7.5-2`・`7.5-3`・`16.1`・`16.9`)。`7.5-1` は外した。7.5 の項目 1 の訂正の注記のとおり、`Content-Length` が本文より小さい要求には Python 版も `code` の無い 400 を返し、差が無い。完了の報告 (Req 1.12) で、ユーザーに「7.5 の 1 は実際には差が無かった」と伝える。
- `vitest.config.ts` に `fileParallelism: (process.env.BLACKBOX_URL ?? '') === ''` を足した。`BLACKBOX_URL` で外のサービス (Python 版や 6.12 のコンテナ) に向けるときだけ、ファイルの並列を切る。枠 3 つのサービスに 10 ファイルが同時に要求を送ると、偶然の 503 で落ちるためである。Node 版に向けるとき (`BLACKBOX_URL` なし) は、ファイルごとに自分でサービスを起動するので、従来どおり並べて動かす。
- 応答の後に閉じる接続への 413 を 30 回送るテスト (HTTP/1.0、`Connection: close`、chunked) は、クライアントを別のプロセス (`src/http/spec-support/repeat-upload-client.mjs`。16.5 の `rep30.mjs` の形) で動かす。サーバーと同じプロセスでは、案 0 (`destroySoon` を差し替えない形) でも 413 が先に読み取られ、後戻りを見つけられない (レビューの実測)。参考実装 (scratchpad) を案 0 に壊すと 3 件とも落ち、壊さなければ 3 回続けて通った (1 回 約 2.5 秒)。
- 一時ファイルを作らないこと (Req 3.3) は、`receive-upload.integ.ts` の Linux 限定の件で確かめる。25MiB の 3 件の同時のアップロードを、本文の途中 (20MiB まで送った時点) と変換の途中 (`holdingRunner` で止めた時点) で止め、このプロセスの `/proc/self/fd` が `os.tmpdir()` の下の新しい通常のファイルを指さないことを 500ms の間見る (`/tmp` の一覧は他のプロセスと共有するので比べない)。参考実装を「受け取りながら本文を一時ファイルに書く」形に壊すと落ちた。書いてすぐ閉じる形 (開いている時間が見回りの間隔より短い) は、この方法では見つからない。
- 16.9 の HTTP の層の 9 通り (y01・y04・y12・y14・y15・y16・y22・y37・y38) の Node の期待は、試作の値 (Hono と Node の既定の振る舞い) で固定している。Hono / Node の版が上がると落ちることはありうる。目印 `16.9` で Python 版には向けない。6.8 が Python 版に合わせる (22.8 の 3 の (b)) と決めたら、`multipart-raw.integ.ts` の `NODE_ANSWERS` の y の行を消せば足りる。
- 20.12 の 2 件 (応答のバイト列が一括で組んだ場合と同じこと、33MB の結果 3 件での親の最大 RSS) と、16.9 (d) のメモリの回帰テストは 6.8 の担当 (20.12 の決定)。4.4 では書いていない。親が tasks.md の 6.8 に一文を足す。
