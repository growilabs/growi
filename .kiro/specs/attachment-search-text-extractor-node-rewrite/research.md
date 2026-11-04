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
| PDF のライブラリ | 未決 | 試作と計測 (Req 11.3) |
| 子プロセスの作り方 | 未決 (`prlimit` は使ってよいと決まった) | 試作と計測 (Req 11.4) |
| `RLIMIT_AS` の値と、緩めた分の守り | 未決 | 試作と計測 (Req 11.5) |
| 本文の受け取りと切断の検知の方法 | 未決 | 試作 (Req 11.6) |
| OpenAPI の作り方 | 未決 | 試作 (Req 11.7) |
| 7 万セルの XLSX の RSS の食い違い (2 節) | 未解決 | 同じファイル・同じ方法で測り直す (Req 11.2) |
| ベンチマークで Python 版を下回った形式の扱い | 未決 (下回ったときだけ) | 原因を示し、ユーザーが直すか受け入れるかを決める (Req 2.14、11.12) |
| ベンチマークの絶対値の合格の基準 | 未決 | ベースラインを測った後にユーザーが決める (Req 2.13) |
| 実際の Elasticsearch (kuromoji) で検索を測れるか | 未検証 | ベンチマークを作るときに確かめる (Req 2.10) |
| 日本語 PDF の検索の品質 (pypdfium2 と WASM の PDFium の差) | 未検証 | ベンチマークと PDF のライブラリの選定で測る (Req 2.12、11.3) |
| Follow-ups のどれを直すか | 未決 | 取り込みの前にユーザーが決める (Req 12.6) |
| テスト用のファイルの作り方 | 決定 (すべて Node で作り直す。旧形式の DOC / PPT だけは commit 済みのものを使う) | ユーザー判断 (design.md の D5) |
| Node で作れないテスト用のファイル (暗号化した Office と PDF、XLS、細工した ZIP) | 実測済み: 作れないものは無い (9 節)。部品の採用はユーザー判断を待つ (9.8) | 試作 (design.md の T7)。扱いはタスク 2.2 でユーザーが決める |

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
