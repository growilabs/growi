# Brief: attachment-search-text-extractor-node-rewrite

> この spec は **amend spec** (完了済みの spec の契約を変えるための一時的な spec) である。扱いは [.claude/rules/spec-lifecycle.md](../../../.claude/rules/spec-lifecycle.md) に従う。実装が終わっても完了ではなく、変更を対象の spec に取り込み、この spec のディレクトリを削除した時点で完了とする。

## Amend target

対象の spec は 1 つだけ: **`attachment-search-text-extractor`** ([../attachment-search-text-extractor/](../attachment-search-text-extractor/))。

### 変わる契約

対象 spec のうち、次の部分を書き換える。

| 変わるもの | いま (対象 spec の記述) | この spec のあと |
|---|---|---|
| 実行基盤の言語とフレームワーク | Python 3.12 + FastAPI + Uvicorn | Node.js + Hono (`@hono/node-server`) |
| Office 系の変換ライブラリの入手先 | PyPI の `firecrawl-anydoc` | npm の `@firecrawl/anydoc` (版は同じ 0.2.4 に固定) |
| PDF の変換ライブラリ | pypdfium2 | 未決 (候補は `@hyzyla/pdfium`、pdfjs-dist など。requirements の Req 11 で決め方を定める) |
| テキスト系の処理に使う部品 | Python 標準の `html.parser`、charset-normalizer、defusedxml | Node 側の同等の部品 (design で決める) |
| 配置とツールチェーン | `services/attachment-text-extractor/` を pnpm workspace と turbo の外に置き、uv / pytest / ruff で完結させる | `apps/attachment-text-extractor/` (`@growi/attachment-text-extractor`) に移し、pnpm workspace に入れる。`apps/pdf-converter` と同じ形 (ユーザー判断。design.md の D4) |
| Dockerfile | `python:3.12-slim-bookworm` + uv の multi-stage | Node の slim image を元にした multi-stage (400MB 以下、read-only rootfs、uid 10001、ネットワークなしで動くことは変えない) |
| CI | `.github/workflows/attachment-text-extractor.yml` の Python 用ジョブ (ruff / pytest / image のビルドと起動確認) | 同じ workflow を Node 用 (lint / vitest / image のビルドと起動確認) に置き換える |
| 配備物 | docker-compose のエントリ、`deploy/k8s/` の例 | 中身を Node 版に合わせる。推奨する安全設定は変えない |
| OpenAPI の書き出し手順 | `scripts/export_openapi.py` (FastAPI が自動で作る文書を書き出す) | Hono 用の手順に置き換える。書き出す `openapi.json` の中身は変えない (Req 7) |
| 子プロセスの作り方と上限の掛け方 | Python の forkserver、子の中での `setrlimit` | Node では `setrlimit` が使えないため、作り方と仮想メモリ上限の掛け方は未決 (Req 11) |
| 設計の根拠 (research.md / design.md の理由づけ) | Python のライブラリと実行環境の挙動に基づく | Node 版での計測結果に基づいて書き直す |

### 既定では変えない契約 (複雑になるなら崩してよい)

次のものは **既定では変えない**。これは書き換えの作業を単純にするための方針である。ユーザーの判断 (2026-11-04) により、守ろうとすると apps/app や書き換えた後の抽出サービスが複雑になる場合は崩してよい。シンプルさは保守性を上げるからである。判断の基準は「シンプルさ (保守性) が上がるか」で、判断するのはこの spec の作業者である。崩すときの手続き (何を崩すか、守ると何がどう複雑になるか、下流の変更の範囲を research.md に記録する。下流の変更を同じ作業に含める。Revalidation Triggers と取り込みに反映し、完了の報告でユーザーに明示する) は requirements の Req 1.9〜1.12 と Req 7.6 にある。

- HTTP の API: `POST /extract` (multipart、`file` と任意の `mimeType`)、`GET /healthz`、`GET /readyz`、`GET /openapi.json` (FastAPI が既定で出している `/docs` と `/redoc` の画面は契約に含めず、残すかどうかを Req 11 で決める)
- `ErrorCode` の 8 つの値と、対象 spec の design.md §Error Handling の表 (どの失敗がどのコードとどの HTTP ステータスになるか)
- `pages[]` の規則 (単位、`pageNumber` / `label` の付け方、空の要素を除き最低 1 要素を返すこと)
- 対象 spec の requirements.md の Acceptance Criteria 1.1〜4.2 のすべて (番号もそのまま)
- 対象 spec の design.md §Configuration の環境変数の名前と既定値。例外は次の 2 つ: `WORKERS` は uvicorn のワーカー数を指すので、Node 版では廃止する (ユーザー判断。design.md の D1。契約を崩すので research.md の 7 節に記録した)。`MAX_CHILD_RSS_MB` と `MAX_XLSX_CELLS` は、Node 版の計測で成り立たないと分かった場合に限り **下げてよい** (ユーザー判断。Req 11.11)
- 書き出し済みの `packages/attachment-text-extractor-client/openapi.json` の型・名前・操作と、そこから orval が作る生成クライアント (`src/generated/`) の型・関数・引数。説明文 (`description`) だけは、Python 版に固有の言葉 (forkserver、None など) を取り除いて直す。そのため生成クライアントのコメントには差分が出るが、これは認める (ユーザー判断。Req 7)
- 変換の出力は、Python 版と一字一句同じである必要はない (anydoc を使った結果として自然な出力ならよい)。検索の品質は、正解を付けた評価用の文書の集まり (ベンチマーク) で Python 版を下回らないことで守る (Req 2)

### 崩せない不変条件

次のものは、上の例外の対象にならない (Req 1.13)。

- セキュリティ上の性質: 認証、サービスのトークンを子プロセスに渡さないこと、子プロセスでの隔離、ファイルの中身や入力を返さないエラー応答とログ
- メモリの予算 2Gi
- 対象 spec の本質的な機能: 対応形式と、位置情報 (ページ・スライド・シート) つきの抽出

### 条件つきの Amend target

既定の方針を崩した結果、下流 spec (`attachment-search-indexing` など) の記述を変える必要が出た場合は、その spec をこの節に Amend target として加え、同じく取り込みの対象にする (Req 1.11)。

### 対象 spec の AC 1.7 の解釈 (ユーザー承認済み)

対象 spec の AC 1.7 は「運用環境で外部バイナリおよびネットワーク egress を要求せずに動作する」と定めている。Node には `setrlimit` が無いので、子プロセスに上限を掛けるために util-linux の標準コマンド `prlimit` で子を包む。**`prlimit` は追加の外部バイナリに当たらない、という解釈をユーザーが承認した** (2026-11-04)。AC 1.7 が防ぎたかったのは、ffmpeg や exiftool のような変換用の外部ツールを image に足すことだからである。

この解釈は「`prlimit` が元の image に入っている」ことを前提にしている。前提が崩れたら黙って守りが外れないよう、次の 3 か所で確かめる: Dockerfile の最終の段で `prlimit` を実行してビルドを失敗させる (Req 8.7)、CI で本番と同じ条件で `prlimit` を実行する (Req 9.5)、起動時に `prlimit` が使えなければ `/readyz` を not-ready にする (Req 8.8)。`prlimit` 以外の外部コマンドは使わない (Req 4.8)。

### Revalidation Triggers (下流の見直しが要る条件) への影響

対象 spec の design.md §Revalidation Triggers に挙がっている項目 (`ErrorCode`、同じコードが複数の HTTP ステータスを持つこと、`pages[]` の規則、health / readiness の応答の形、`label` の中身、タイムアウトの順序、サイズと時間の上限の既定値) は、**既定では変えない**。既定のままなら、この spec は下流 (`attachment-search-indexing`、apps/app) の見直しを起こさない。既定の方針を崩した場合は、崩した項目を design.md の Revalidation Triggers に書き、下流の変更を同じ作業で行う (Req 1.11、1.12)。

既定の方針を崩したもの (ユーザー判断): `WORKERS` の廃止 (compose と k8s の例から `WORKERS` を消す。運用者が設定していても無視される) と、`/docs` と `/redoc` の廃止 (2 つのパスが 401 か 404 になる)。どちらも apps/app と生成クライアントには影響しない。記録は research.md の 7 節。

このほか、次の 4 点は、この書き換えで触れる可能性がある。

- **タイムアウトの順序**: 子プロセスの起動と停止にかかる時間が Python 版 (forkserver で約 29ms、停止と回収に最大約 4 秒) と変わる。最悪の合計 (本文の受信 15 秒 + 変換 55 秒 + 停止と回収) が apps/app の既定 `timeoutMs` 90000ms より短いことを、Node 版でも確かめる (Req 3)。
- **サイズ・時間の上限の既定値**: Node 版の子プロセスは Python 版より RSS が大きい (1.5 の計測で 70,000 セルの XLSX が約 26MB 多い)。対象 spec の基準値 (7 万セルで 285MB、上限 320MB) にこの比率を当てはめると上限を超える見込みがあり、`MAX_CHILD_RSS_MB` か `MAX_XLSX_CELLS` の既定値を下げる必要が出るかもしれない。**ユーザーは、成り立たない場合に既定値を下げることを認めた** (Req 11.11)。下げた場合は Revalidation Trigger に当たる。`MAX_XLSX_CELLS` を下げると、検索の対象になる XLSX の範囲が狭くなる。下げた値、根拠の計測、範囲の変化を research.md と design.md の Revalidation Triggers に記録し、取り込みで対象 spec に反映し、完了の報告でユーザーに明示する。上げることと、メモリの予算 (2Gi) を超えることは認めない。
- **OpenAPI の説明文**: commit 済みの `openapi.json` の説明文には Python 版の言葉 (`/readyz` の「forkserver」、`PageInfo` の「None」) が入っており、orval はこれを生成クライアントのコメントに写している。**ユーザーは説明文だけを直すことを決めた** (Req 7.1)。型は変わらないが、クライアントのコメントには差分が出る。apps/app のコードには影響しない。
- **health / readiness の応答**: `/readyz` の `dependencies` に出す名前 (`pypdfium2` / `charset-normalizer` など) はライブラリの名前なので、そのままでは残せない。OpenAPI の文書ではこの応答の形を決めていない (中身は `{}`) ため生成クライアントは変わらないが、名前は **未回答** で、暫定の既定は役割の名前 (`anydoc`、`pdf`、`converter`、`prlimit`) (design.md の D2)。

## Problem

抽出サービス `services/attachment-text-extractor/` は GROWI の monorepo でただ 1 つの Python のコードである (src 約 3,700 行、tests 約 11,300 行、テスト 1,222 件)。monorepo のほかの部分はすべて Node / TypeScript で書かれているため、このサービスだけ別の言語・別の道具 (uv / pytest / ruff) ・別の CI で保守し続けることになる。

## Current State

- 対象 spec は実装がほぼ終わり、cleanup も済んでいる (残りは人が確かめる配布物と CI の確認、対象 spec の tasks 8.1 / 8.3 / 9.2)。
- 対象 spec を作った当時、anydoc を Node から使う案は「apps/app のプロセスの中で動かす」形で検討され、重い処理と異常終了を apps/app から切り離すために不採用になった (対象 spec の research.md §3)。別のコンテナで動かす形の Node 版は検討していない。
- `services/` を pnpm workspace の外に置いた理由 (対象 spec の research.md §2.9 と §3.7) は「Python を workspace に混ぜると `pnpm install` や `turbo run build` が複雑になる」という Python に固有のものだった。Node 版ではこの理由がそのままでは当てはまらない。
- `@firecrawl/anydoc@0.2.4` は npm にあり、Python 版と同じ Rust の核を使う。70,000 セルの XLSX で出力が文字数まで同じ (964,002 字) ことを確かめた。

## Desired Outcome

- 抽出サービスが Node.js + Hono + `@firecrawl/anydoc` で動き、monorepo のほかの部分と同じ言語・同じ種類の道具で保守できる。
- 外から見える振る舞い (HTTP の API、エラーの分類、`pages[]` の規則、上限と隔離の守り方) は、既定では Python 版と同じで、下流の apps/app と生成クライアントには変更が要らない。守るとかえって複雑になる部分は崩してよく、そのときは下流の変更も同じ作業で行う。
- 添付ファイルは、書き換えの前と同じかそれ以上に検索で見つかる (ベンチマークで確かめる)。
- Python の資産 (pyproject、uv.lock、ruff、pytest、Python 用 CI) はリポジトリから消える。Python 版と Node 版を並べて運用する期間は作らない。

**目的は言語の統一による保守のしやすさであり、性能や抽出の質の向上ではない。** 性能が少し落ちることが分かった場合も、それだけで書き換えをやめる理由にはしない。検索の品質は、ベンチマークで Python 版を下回った形式があればユーザーに諮り、勝手に受け入れない (Req 2.14)。

## Approach

ユーザーが決めた進め方 (requirements の Req 6 に制約として残し、tasks の骨組みにする):

0. **検索の品質のベンチマークを作り、Python 版で測る**。Python 版が残っているうちに測る必要があるので、1 より前か、1 と同時に行い、3 より前に終える (Req 6.8)。
1. **テストを先に書き換える**。TDD のリファクタとして、Python のテストを Node (vitest) に書き換える。
2. **テストのレビューを通す**。書いた人とは別の担当が、`essential-test-design` と `essential-test-patterns` の 2 つの skill を使ってレビューする。
3. **実装を書き換える**。凝集度を高くする: 1 ファイル 1 責務、重い処理は純関数として抜き出す、層の依存は一方向、barrel (`index.ts`) が外に見せるものは最小にする。`.claude/rules/coding-style.md` に従う。
4. **実装のレビューを通す**。実装した人とは別の担当が、Opus の model で、粗探しをする立場 (敵対的) でレビューする。

## Scope

### In

- 抽出サービスを Node 版として `apps/attachment-text-extractor/` に作り直し (src、tests、Dockerfile、`deploy/k8s/`、CLAUDE.md、scripts、テスト用のファイルの Node の生成器)、`services/attachment-text-extractor/` の Python 版を消すこと
- OpenAPI の書き出しと、書き出した文書がいまのものと同じであることの検査
- 検索の品質のベンチマーク (評価用の文書と正解) の作成と、Python 版・Node 版での計測
- 既定の方針を崩した場合に限り、その結果として要る下流 (apps/app の呼び出し側、生成クライアント、下流 spec の記述) の変更
- `.github/workflows/attachment-text-extractor.yml` の置き換えと、docker-compose のエントリ (`infra/docker/compose.yaml`) の追従
- `apps/` に移すことに伴う変更 (`pnpm-lock.yaml`、package ごとの `turbo.json`、compose の build の `context`、CI の `paths`)
- Python の資産の撤去
- 未決事項を試作と計測で決めること (Req 11)

### Out (非目標)

- 機能の追加 (新しい形式への対応や新しい設定項目を含む)
- HTTP の契約の変更。ただしこれは既定の方針で、守るとかえって複雑になる場合は崩してよい (Req 1.9)
- Python 版と Node 版の並行運用
- Bun / Deno / Rust での実装 (Bun は挙動が不安定、Deno は仮想メモリ上限 5GB でも動かなかったため不採用)
- 下流 spec (`attachment-search-indexing`、`attachment-search-ui`) と apps/app の変更。既定では契約が同じなので要らない (生成クライアントの型・関数・引数が変わらないことは Req 7 で確かめる)。既定の方針を崩した場合だけ、その結果として要る変更を同じ作業に含める (Req 1.11)
- 抽出サービスを apps/app のプロセスの中で動かすこと (対象 spec の判断を変えない)

## Port-back (対象 spec への取り込み) の前提

この spec の tasks.md の最後のタスクは、spec-lifecycle.md の手順どおり「対象 spec に取り込み、この spec を自己削除する」ものにする。取り込み方は次のとおり。

- **requirements.md**: 対象 spec の既存の番号 (Req 1〜4、AC 1.1〜4.2) は一切変えない。この spec の要件のうち、書き換えの後も成り立ち続けるもの (Req 4: 実行基盤の制約、Req 5: コードの構成、Req 7: OpenAPI と生成クライアント) は、対象 spec の末尾に **Req 5 以降として追加** する。番号の対応は design フェーズで確定し、この brief に追記する。
- **既定の方針を崩した場合**: 崩した契約に当たる対象 spec の AC は、番号を振り直さずに文言を更新する。design.md の該当箇所も書き直す。以前の文言や崩した経緯は本文に残さない (Req 1.12)。
- **取り込まない要件**: 書き換えの間だけ意味を持つもの (Req 6: 進め方、Req 10: Python 資産の撤去、Req 11: 未決事項の決め方、Req 12: 取り込みと自己削除) は対象 spec に移さない。Req 1〜3 (Python 版との同等性) は、対象 spec の既存の AC がすでに同じことを言っているので移さない。Req 2 のベンチマークの結果 (ベースラインと Node 版の値) は research.md に移す。Req 8 / Req 9 (配備物と CI) の中身は、対象 spec の design.md の配布物と CI の記述を書き直す形で取り込む。
- **research.md**: Req 11 で計測した結果と決定の理由は、対象 spec の research.md に移す。Python に固有の知見 (forkserver が `__main__` を先読みできない、`UploadFile` が本文を `TMPDIR` に書き出す、など) は、Node 版で意味を失うものを消し、まだ判断の材料になるもの (なぜ別コンテナで動かすか、など) は残す。
- **本文は、書き換えが最初からそうだったように書く** (「以前は Python だった」のような経緯は書かない。経緯は git に残る)。

## Follow-ups (いまは触らないが、取り込みのときに直す候補)

spec-lifecycle.md の手順 2 に従い、実装の途中では対象 spec の本文に書き込みをしない。次のものは取り込みのときにまとめて直す候補として記録しておく。直すかどうか、どこまで直すかはユーザーが決める。

- `.kiro/steering/structure.md` の「`services/` は Node 以外のマイクロサービスを置く場所で、pnpm workspace の外」という記述
- `.kiro/steering/tech.md` の末尾の、Python のツールチェーンに触れた更新記録
- `services/attachment-text-extractor/CLAUDE.md` (Python / uv / poe 前提の内容。実装のタスクで書き直す)
- umbrella `attachment-search/README.md` と、下流 `attachment-search-indexing` の brief / requirements / design / research に残る「Python FastAPI 抽出サービス」という書き方 (契約には関係しない)
- ルートの `AGENTS.md` / `.claude/rules/project-structure.md` の monorepo の一覧に `apps/attachment-text-extractor/` を書き足すかどうか。`services/` が無くなるので、`structure.md` の `services/` の節は消すことになる
- umbrella と下流 spec に残る `services/attachment-text-extractor/` というパスの記述 (契約には関係しない)

## Constraints

- **ライセンス**: 依存は MIT / Apache-2.0 / BSD などの許容的なライセンスに限る (GPL / AGPL / LGPL は使わない)。対象 spec と同じ。
- **image の大きさ**: 400MB 以下。
- **外部バイナリと外向き通信**: 対象 spec の AC 1.7 を守る。util-linux の標準コマンド `prlimit` で子プロセスを包むことは、AC 1.7 に反しないとユーザーが認めた (上の「対象 spec の AC 1.7 の解釈」)。
- **メモリ**: Node は Python より仮想メモリの予約が大きい (何もしなくても 1,200MB、anydoc の XLSX で 2,000MB、PDFium WASM で 3,000MB 以上の `RLIMIT_AS` が要る)。仮想メモリは k8s の limits (実メモリで数える) には影響しないが、Python 版で最後の歯止めにしていた `RLIMIT_AS` は同じ値では使えない。実メモリ (RSS) の監視が主な守りになる。
- **upstream の依存**: anydoc は 0.x 系なので版を 0.2.4 に固定する。PPTX の分割と XLSX の目印は文書化されていない挙動に頼るので、対象 spec と同じく版を固定した契約テストで変化を検知する。

## ユーザーの決定と、残っている未決事項

### 決まったこと (2026-11-04)

- spec の名前は `attachment-search-text-extractor-node-rewrite` のままにする
- `WORKERS` を廃止する (D1)。`/docs` と `/redoc` を出さず、`/openapi.json` は残す (D3)。どちらも既定の方針を崩すので、1.10 の記録を research.md の 7 節に置いた
- 置き場所を `apps/attachment-text-extractor/` に移し、pnpm workspace に入れる (D4)。全開発者の `pnpm install` に anydoc のネイティブ部品 (linux x64 で約 8MB) が入る
- テスト用のファイルはすべて Node で作り直す (D5)。撤去の前に、Node で作ったファイルを Python 版のテストでも使えることを確かめる (Req 10.5)
- `prlimit` で子プロセスを包んでよい。元の image に入っていることを、ビルド・CI・起動時の 3 か所で確かめる (Req 8.7、8.8、9.5)
- `MAX_CHILD_RSS_MB` と `MAX_XLSX_CELLS` は、Node 版で成り立たなければ下げてよい。メモリの予算 (2Gi) は変えない (Req 11.11)
- OpenAPI の説明文だけを直し、生成クライアントのコメントの差分を認める。型・名前・関数・引数は既定では変えない (Req 7)
- 契約の維持 (Req 1、Req 7) は既定の方針とし、守ると apps/app や抽出サービスが複雑になるなら崩してよい。判断の基準はシンプルさ (保守性) で、判断するのはこの spec の作業者。不変条件は崩さない (Req 1.9〜1.13、7.6)
- 変換の出力は Python 版と一字一句同じでなくてよい。代わりに検索の品質のベンチマークで Python 版を下回らないことを確かめる (Req 2.7〜2.15)

### 未決 (決め方は requirements に書いてある)

| 項目 | 決め方 |
|---|---|
| `/readyz` の `dependencies` に出す名前 | **未回答**。暫定の既定は役割の名前 (`anydoc`、`pdf`、`converter`、`prlimit`)。design の承認の前に答えをもらう (design.md の D2、Req 11.9) |
| テスト用のファイルのうち Node で作れないものが残った場合の扱い | 試作 (design.md の T7) で分かったらユーザーに諮る |
| PDF のライブラリ、子プロセスの作り方、仮想メモリ上限の値、本文の受け取り方、OpenAPI の作り方 | design の承認の前に試作と計測で決める (Req 11.2〜11.7) |
| ベンチマークで Python 版を下回った形式の扱い | 原因を調べて示し、直すか受け入れるかをユーザーが決める。決まるまで Python 資産を撤去しない (Req 2.14、11.12)。下回らない違いは記録するだけ (Req 2.3) |
| ベンチマークの絶対値の合格の基準を置くか、その値 | ベースラインを測った後にユーザーが決める (Req 2.13) |
| 実際の Elasticsearch (kuromoji) での検索の計測を行えるか | ベンチマークを作るときに、動かす環境で使えるかを確かめる (Req 2.10) |
| どの契約を崩すか | 作業者が「シンプルさが上がるか」で判断し、記録して完了の報告でユーザーに示す (Req 1.9〜1.12) |
| Follow-ups のどれを直すか | 取り込みのタスクの前に一覧を示してユーザーが決める (Req 12.6) |
