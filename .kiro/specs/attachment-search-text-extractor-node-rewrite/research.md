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

requirements を書く途中で、対象 spec の AC と OpenAPI の文書では決まっていないが、運用者から見えるものが見つかった。`WORKERS`、`/readyz` の `dependencies`、`/docs` と `/redoc` は **未決** で、design で選択肢を示してユーザーが決める (requirements の Req 11.9)。

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
| `WORKERS` の Node での意味 | 未決 | design でユーザーが決める (Req 11.9) |
| `/readyz` の `dependencies` に出す名前 | 未決 | 同上 |
| `/docs` と `/redoc` を残すかどうか | 未決 | 同上 |
| 配置 (pnpm workspace に入れるか) | 未決 | 試作で比べ (Req 11.8)、design でユーザーが決める (Req 11.9) |
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
| テスト用のファイルの作り方 (Python の生成器が撤去で使えなくなる) | 未決 | design.md の D5 でユーザーが決める (推奨: 小さなものは Python 版で一度作って commit、大きなものは Node で組み立てる) |

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
- Python を撤去すると、この作り方は使えなくなる。暗号化した Office ファイルや XLS を Node で作る部品は調べていない (**未検証**)。この扱いはユーザーの判断が要る (design.md の「ユーザーの判断を待つ項目」)。
