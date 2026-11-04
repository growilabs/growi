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
- **未検証**: `prlimit` を使うことが、対象 spec の AC 1.7 の「外部バイナリを要求しない」に当たるかどうか。AC 1.7 は ffmpeg や exiftool のような変換用の外部ツールを入れないことが元の意図だったが、判断はユーザーに仰ぐ (requirements の Req 11.9)。

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
- **OpenAPI の名前**: commit 済みの `openapi.json` には、FastAPI が自動で付けた名前 (`operationId` の `post_extract_extract_post`、スキーマ名の `Body_post_extract_extract_post`、`title` の `Pagenumber` など) が入っている。orval の生成物 (`src/generated/index.ts`) の型の名前 (`BodyPostExtractExtractPost` など) はこれから作られるので、Hono 用の仕組みが既定で付ける名前のままだと生成クライアントが変わる。requirements の Req 7.1 で、これらの名前も含めて同じ文書を出すことを求めている。
- **OpenAPI の説明文**: **実測**: 説明文にも Python 版の言葉が入っている (`/readyz` の説明の「forkserver が動き…probe child を fork する」、`PageInfo` の説明の「None」)。orval はこれらを `src/generated/index.ts` の JSDoc コメントに写している。説明文を Node 版に合わせて直すと、型は変わらなくても生成クライアントのコメントに差分が出る。残すか直すかは requirements の Req 11.9 でユーザーが決める。

## 4. 対象 spec に入っていない、運用者から見える振る舞い

requirements を書く途中で、対象 spec の AC と OpenAPI の文書では決まっていないが、運用者から見えるものが見つかった。どれも requirements の Req 11.9 でユーザーの判断を仰ぐ。

- **`WORKERS`**: uvicorn のワーカー数を指す環境変数。Node には同じ仕組みが無いので、意味をどうするか (無視する、Node の cluster の数にする、廃止する) を決める必要がある。
- **`/readyz` の `dependencies`**: いまは `anydoc` / `pypdfium2` / `charset-normalizer` / `converter` の名前を出している。OpenAPI の文書ではこの応答の形を決めていない (スキーマが `{}`) ので、名前を変えても生成クライアントは変わらない。
- **`/docs` と `/redoc`**: FastAPI が既定で出している API の説明画面。認証が要るパスとして出ており、テストでは確かめていない。
- **1 件ごとのログ**: `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…` の形の 1 行。requirements の Req 1.7 で、出す項目と出さない項目を保つことを求めている。
