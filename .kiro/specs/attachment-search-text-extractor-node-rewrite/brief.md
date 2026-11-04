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
| 配置とツールチェーン | `services/attachment-text-extractor/` を pnpm workspace と turbo の外に置き、uv / pytest / ruff で完結させる | Node の package にする。workspace に入れるかどうかは未決 (Req 11) |
| Dockerfile | `python:3.12-slim-bookworm` + uv の multi-stage | Node の slim image を元にした multi-stage (400MB 以下、read-only rootfs、uid 10001、ネットワークなしで動くことは変えない) |
| CI | `.github/workflows/attachment-text-extractor.yml` の Python 用ジョブ (ruff / pytest / image のビルドと起動確認) | 同じ workflow を Node 用 (lint / vitest / image のビルドと起動確認) に置き換える |
| 配備物 | docker-compose のエントリ、`deploy/k8s/` の例 | 中身を Node 版に合わせる。推奨する安全設定は変えない |
| OpenAPI の書き出し手順 | `scripts/export_openapi.py` (FastAPI が自動で作る文書を書き出す) | Hono 用の手順に置き換える。書き出す `openapi.json` の中身は変えない (Req 7) |
| 子プロセスの作り方と上限の掛け方 | Python の forkserver、子の中での `setrlimit` | Node では `setrlimit` が使えないため、作り方と仮想メモリ上限の掛け方は未決 (Req 11) |
| 設計の根拠 (research.md / design.md の理由づけ) | Python のライブラリと実行環境の挙動に基づく | Node 版での計測結果に基づいて書き直す |

### 変わらない契約

次のものは **一切変えない**。この spec の要件は、これらが変わっていないことを確かめる形で書く。

- HTTP の API: `POST /extract` (multipart、`file` と任意の `mimeType`)、`GET /healthz`、`GET /readyz`、`GET /openapi.json` (FastAPI が既定で出している `/docs` と `/redoc` の画面は契約に含めず、残すかどうかを Req 11 で決める)
- `ErrorCode` の 8 つの値と、対象 spec の design.md §Error Handling の表 (どの失敗がどのコードとどの HTTP ステータスになるか)
- `pages[]` の規則 (単位、`pageNumber` / `label` の付け方、空の要素を除き最低 1 要素を返すこと)
- 対象 spec の requirements.md の Acceptance Criteria 1.1〜4.2 のすべて (番号もそのまま)
- 対象 spec の design.md §Configuration の環境変数の名前と既定値 (ただし `WORKERS` は uvicorn のワーカー数を指すので、Node での意味は未決。また、メモリの計測で既定値が成り立たないと分かった場合は、ユーザーの判断で変える。Req 11)
- 書き出し済みの `packages/attachment-text-extractor-client/openapi.json` の型・名前・操作と、そこから orval が作る生成クライアント (`src/generated/`) の型・関数・引数 (説明文の扱いは Req 11 で決める)

### Revalidation Triggers (下流の見直しが要る条件) への影響

対象 spec の design.md §Revalidation Triggers に挙がっている項目 (`ErrorCode`、同じコードが複数の HTTP ステータスを持つこと、`pages[]` の規則、health / readiness の応答の形、`label` の中身、タイムアウトの順序、サイズと時間の上限の既定値) は、**変えないことを前提にする**。前提どおりなら、この spec は下流 (`attachment-search-indexing`、apps/app) の見直しを起こさない。

ただし次の 4 点は、この書き換えで触れる可能性がある。触れると分かった時点で、進める前にユーザーの判断を仰ぐ (requirements の Req 11.9〜11.11)。

- **タイムアウトの順序**: 子プロセスの起動と停止にかかる時間が Python 版 (forkserver で約 29ms、停止と回収に最大約 4 秒) と変わる。最悪の合計 (本文の受信 15 秒 + 変換 55 秒 + 停止と回収) が apps/app の既定 `timeoutMs` 90000ms より短いことを、Node 版でも確かめる (Req 3)。
- **サイズ・時間の上限の既定値**: Node 版の子プロセスは Python 版より RSS が大きい (1.5 の計測で 70,000 セルの XLSX が約 26MB 多い)。対象 spec の基準値 (7 万セルで 285MB、上限 320MB) にこの比率を当てはめると上限を超える見込みがあり、`MAX_CHILD_RSS_MB` か `MAX_XLSX_CELLS` の既定値を変える必要が出るかもしれない。`MAX_XLSX_CELLS` を変えると、検索の対象になる XLSX の範囲も変わる。
- **OpenAPI の説明文**: commit 済みの `openapi.json` の説明文には Python 版の言葉 (`/readyz` の「forkserver」、`PageInfo` の「None」) が入っており、orval はこれを生成クライアントのコメントに写している。説明文を直すと、型は変わらなくてもクライアントのコメントに差分が出る。
- **health / readiness の応答**: `/readyz` の `dependencies` に出す名前 (`pypdfium2` / `charset-normalizer` など) はライブラリの名前なので、そのままでは残せない。OpenAPI の文書ではこの応答の形を決めていない (中身は `{}`) ため生成クライアントは変わらないが、名前を変えるかどうかは決める必要がある (Req 11)。

## Problem

抽出サービス `services/attachment-text-extractor/` は GROWI の monorepo でただ 1 つの Python のコードである (src 約 3,700 行、tests 約 11,300 行、テスト 1,222 件)。monorepo のほかの部分はすべて Node / TypeScript で書かれているため、このサービスだけ別の言語・別の道具 (uv / pytest / ruff) ・別の CI で保守し続けることになる。

## Current State

- 対象 spec は実装がほぼ終わり、cleanup も済んでいる (残りは人が確かめる配布物と CI の確認、対象 spec の tasks 8.1 / 8.3 / 9.2)。
- 対象 spec を作った当時、anydoc を Node から使う案は「apps/app のプロセスの中で動かす」形で検討され、重い処理と異常終了を apps/app から切り離すために不採用になった (対象 spec の research.md §3)。別のコンテナで動かす形の Node 版は検討していない。
- `services/` を pnpm workspace の外に置いた理由 (対象 spec の research.md §2.9 と §3.7) は「Python を workspace に混ぜると `pnpm install` や `turbo run build` が複雑になる」という Python に固有のものだった。Node 版ではこの理由がそのままでは当てはまらない。
- `@firecrawl/anydoc@0.2.4` は npm にあり、Python 版と同じ Rust の核を使う。70,000 セルの XLSX で出力が文字数まで同じ (964,002 字) ことを確かめた。

## Desired Outcome

- 抽出サービスが Node.js + Hono + `@firecrawl/anydoc` で動き、monorepo のほかの部分と同じ言語・同じ種類の道具で保守できる。
- 外から見える振る舞い (HTTP の API、エラーの分類、`pages[]` の規則、上限と隔離の守り方) は Python 版と同じで、下流の apps/app と生成クライアントには何の変更も要らない。
- Python の資産 (pyproject、uv.lock、ruff、pytest、Python 用 CI) はリポジトリから消える。Python 版と Node 版を並べて運用する期間は作らない。

**目的は言語の統一による保守のしやすさであり、性能や抽出の質の向上ではない。** 計測で性能や質が少し落ちることが分かった場合も、それだけで書き換えをやめる理由にはしない (ただし、落ち方はユーザーに示して判断を仰ぐ)。

## Approach

ユーザーが決めた進め方 (requirements の Req 6 に制約として残し、tasks の骨組みにする):

1. **テストを先に書き換える**。TDD のリファクタとして、Python のテストを Node (vitest) に書き換える。
2. **テストのレビューを通す**。書いた人とは別の担当が、`essential-test-design` と `essential-test-patterns` の 2 つの skill を使ってレビューする。
3. **実装を書き換える**。凝集度を高くする: 1 ファイル 1 責務、重い処理は純関数として抜き出す、層の依存は一方向、barrel (`index.ts`) が外に見せるものは最小にする。`.claude/rules/coding-style.md` に従う。
4. **実装のレビューを通す**。実装した人とは別の担当が、Opus の model で、粗探しをする立場 (敵対的) でレビューする。

## Scope

### In

- `services/attachment-text-extractor/` の中身を Node 版に置き換えること (src、tests、Dockerfile、`deploy/k8s/`、CLAUDE.md、scripts)
- OpenAPI の書き出しと、書き出した文書がいまのものと同じであることの検査
- `.github/workflows/attachment-text-extractor.yml` の置き換えと、docker-compose のエントリ (`infra/docker/compose.yaml`) の追従
- 配置の決定に伴う `pnpm-workspace.yaml` / `turbo.json` / `biome.json` の変更 (workspace に入れると決めた場合だけ)
- Python の資産の撤去
- 未決事項を試作と計測で決めること (Req 11)

### Out (非目標)

- HTTP の契約の変更、機能の追加 (新しい形式への対応や新しい設定項目を含む)
- Python 版と Node 版の並行運用
- Bun / Deno / Rust での実装 (Bun は挙動が不安定、Deno は仮想メモリ上限 5GB でも動かなかったため不採用)
- 下流 spec (`attachment-search-indexing`、`attachment-search-ui`) と apps/app の変更。契約が同じなので要らない。ただし生成クライアントを作り直さなくてよいことは確かめる (Req 7)
- 抽出サービスを apps/app のプロセスの中で動かすこと (対象 spec の判断を変えない)

## Port-back (対象 spec への取り込み) の前提

この spec の tasks.md の最後のタスクは、spec-lifecycle.md の手順どおり「対象 spec に取り込み、この spec を自己削除する」ものにする。取り込み方は次のとおり。

- **requirements.md**: 対象 spec の既存の番号 (Req 1〜4、AC 1.1〜4.2) は一切変えない。この spec の要件のうち、書き換えの後も成り立ち続けるもの (Req 4: 実行基盤の制約、Req 5: コードの構成、Req 7: OpenAPI と生成クライアント) は、対象 spec の末尾に **Req 5 以降として追加** する。番号の対応は design フェーズで確定し、この brief に追記する。
- **取り込まない要件**: 書き換えの間だけ意味を持つもの (Req 6: 進め方、Req 10: Python 資産の撤去、Req 11: 未決事項の決め方、Req 12: 取り込みと自己削除) は対象 spec に移さない。Req 1〜3 (Python 版との同等性) は、対象 spec の既存の AC がすでに同じことを言っているので移さない。Req 8 / Req 9 (配備物と CI) の中身は、対象 spec の design.md の配布物と CI の記述を書き直す形で取り込む。
- **research.md**: Req 11 で計測した結果と決定の理由は、対象 spec の research.md に移す。Python に固有の知見 (forkserver が `__main__` を先読みできない、`UploadFile` が本文を `TMPDIR` に書き出す、など) は、Node 版で意味を失うものを消し、まだ判断の材料になるもの (なぜ別コンテナで動かすか、など) は残す。
- **本文は、書き換えが最初からそうだったように書く** (「以前は Python だった」のような経緯は書かない。経緯は git に残る)。

## Follow-ups (いまは触らないが、取り込みのときに直す候補)

spec-lifecycle.md の手順 2 に従い、実装の途中では対象 spec の本文に書き込みをしない。次のものは取り込みのときにまとめて直す候補として記録しておく。直すかどうか、どこまで直すかはユーザーが決める。

- `.kiro/steering/structure.md` の「`services/` は Node 以外のマイクロサービスを置く場所で、pnpm workspace の外」という記述
- `.kiro/steering/tech.md` の末尾の、Python のツールチェーンに触れた更新記録
- `services/attachment-text-extractor/CLAUDE.md` (Python / uv / poe 前提の内容。実装のタスクで書き直す)
- umbrella `attachment-search/README.md` と、下流 `attachment-search-indexing` の brief / requirements / design / research に残る「Python FastAPI 抽出サービス」という書き方 (契約には関係しない)
- ルートの `AGENTS.md` / `.claude/rules/project-structure.md` に `services/` を書き足すかどうか (配置の決定次第)

## Constraints

- **ライセンス**: 依存は MIT / Apache-2.0 / BSD などの許容的なライセンスに限る (GPL / AGPL / LGPL は使わない)。対象 spec と同じ。
- **image の大きさ**: 400MB 以下。
- **外部バイナリと外向き通信**: 対象 spec の AC 1.7 を守る。ただし `prlimit` (util-linux に含まれ、slim image に最初から入っているコマンド) で子プロセスを包む案は、AC 1.7 の「外部バイナリを要求しない」に当たるかどうかの判断が要る (Req 11)。
- **メモリ**: Node は Python より仮想メモリの予約が大きい (何もしなくても 1,200MB、anydoc の XLSX で 2,000MB、PDFium WASM で 3,000MB 以上の `RLIMIT_AS` が要る)。仮想メモリは k8s の limits (実メモリで数える) には影響しないが、Python 版で最後の歯止めにしていた `RLIMIT_AS` は同じ値では使えない。実メモリ (RSS) の監視が主な守りになる。
- **upstream の依存**: anydoc は 0.x 系なので版を 0.2.4 に固定する。PPTX の分割と XLSX の目印は文書化されていない挙動に頼るので、対象 spec と同じく版を固定した契約テストで変化を検知する。
