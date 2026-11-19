# Brief: attachment-search-text-extractor-ops-1-1

> この spec は **amend spec** (完了済みの spec の契約を変えるための一時的な spec) である。扱いは [.claude/rules/spec-lifecycle.md](../../../.claude/rules/spec-lifecycle.md) に従う。実装が終わっても完了ではない。変更を対象の spec に取り込み、この spec のディレクトリを削除した時点で完了とする (tasks.md の最後のタスク)。

## Amend target

対象の spec は 2 つある。

### 1. `attachment-search-text-extractor` ([../attachment-search-text-extractor/](../attachment-search-text-extractor/))

抽出サービス `apps/attachment-text-extractor` (Docker image `growilabs/attachment-text-extractor:1.0.0`) の spec。次の契約が変わる。

| 変わるもの | いま (対象 spec の記述) | この spec のあと |
|---|---|---|
| `POST /extract` の要求の契約 | 渡す項目は multipart の `file` と `mimeType` だけ | 任意のヘッダー `X-Growi-App-Id` が加わる。OpenAPI の文書に任意のヘッダーとして載る。生成クライアントの関数と型は変わらない (research.md §2) |
| `/extract` の 1 件ごとのログの行 | `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…` | 行の最後に ` app=<値>` が付く。ヘッダーが無ければ `app=-`、形が正しくなければ `app=(invalid)` |
| エンドポイントの一覧と、トークンの要らないパス | `/extract`・`/healthz`・`/readyz`・`/openapi.json`。トークンなしで答えるのは `/healthz`・`/readyz`・`/openapi.json` の 3 つだけ | `GET /metrics` (Prometheus のテキスト形式) が加わり、トークンなしで答える (守りはネットワークの制限で行う。`/readyz` と同じ) |
| ログと監視の記述 | 「アクセスログは出さない。401 の要求、存在しないパス、probe の呼び出しは 1 行も残らない」 | ログの行はこれまでどおり出さない。ただし、Hono が返したすべての応答 (401 と 404 を含む) を `/metrics` のカウンタで数える |
| `/readyz` の結果 | 「結果は覚えない」。呼ぶたびに確認用の子を起動する | 確認を終えた時点から 10 秒間、その結果 (準備完了・未完了のどちらも) を使い回す |
| ZIP の上限 (`MAX_ARCHIVE_ENTRIES`・`MAX_ARCHIVE_UNCOMPRESSED_MB`・`MAX_XLSX_CELLS`) | PPTX / XLSX が「ZIP で、必要な部品がちょうど 1 つある」形でなければ、ファイル全体を検査なしで anydoc に渡す | ファイル全体を anydoc に渡すのは「ZIP ではない」ときだけにする。ZIP なのに一覧を読み切れない、必要な部品が無い、必要な部品が 2 つ以上ある、のどれかなら `extraction_failed` (422) で断る |
| 結果の大きさの上限 (`MAX_RESULT_BYTES`) を確かめる時点 | 全ページを読んでから、最後にまとめて確かめる | PDF と PPTX は、ページ (スライド) を 1 つ読むたびに、それまでの合計を確かめ、超えた時点で止める。最後の確かめはそのまま残す |
| 子プロセスと親の環境変数についての記述 | 「トークンは子に渡らない」 | 「トークンは子に渡さない。ただし同じ uid で動く子は、親の環境変数 (トークンを含む) を `/proc` から読める」(手元の実験で確かめた範囲で書く。research.md §5) |

### 2. `attachment-search-indexing` ([../attachment-search-indexing/](../attachment-search-indexing/))

apps/app のサーバ側の spec。変わるのは抽出サービスを呼ぶ側だけである。

| 変わるもの | いま | この spec のあと |
|---|---|---|
| `POST /extract` を送るときのヘッダー | `Authorization: Bearer <token>` だけ | 設定 `app:growiAppIdForCloud` (環境変数 `GROWI_APP_ID_FOR_GROWI_CLOUD`) に値があるときだけ、`X-Growi-App-Id: <値>` を加える。値が無い app (OSS の利用者) は何も加えない |

ほかの契約 (抽出の結果の扱い、エラーの分類、索引の作り方) は変わらない。

### Revalidation Triggers (下流の見直しが要る条件) への影響

**`attachment-search-text-extractor` の design.md §Revalidation Triggers** のうち、次の項目に触れる。

- **API と応答の形 / 生成クライアントの名前**: `POST /extract` に任意のヘッダーが加わる。必須の項目、応答の型、`ErrorCode` の値は変わらない。生成クライアントの関数名と型名も変わらない (orval 7.2 はヘッダーの引数を関数に足さないことを確かめた。research.md §2)。OpenAPI の文書の `info.version` を `1.1.0` に上げるので、生成クライアントの先頭のコメントの版の行だけが変わる。
- **`code` を持たない応答**: `/metrics` の応答は JSON ではなく Prometheus のテキスト形式である。apps/app は `/metrics` を呼ばない。
- **health / readiness の応答**: 応答の形は変わらない。変わるのは、確認の結果が最大 10 秒古いことがある点である。運用者が決める確認の間隔と期限 (`docker/README.md` の 20 秒と 15 秒) は変えなくてよい (research.md §4)。
- **運用者から見える振る舞い (ログ)**: ログの行の最後に `app=` が付く。行を正規表現で読む道具 (抽出サービスの中では `scripts/image-check/memory/report.ts`。外では GROWI.cloud の運用の道具) は、行末を `child_peak_rss_mb=…` と決めつけていれば直す必要がある。
- **新しく足す Revalidation Trigger** (取り込みのときに対象 spec に足す): `/metrics` のメトリクスの名前とラベル (運用者のダッシュボードと自動スケールの設定が読む)、ログの `app=` の位置と、`-` と `(invalid)` の意味。

**`attachment-search-indexing` の design.md §Revalidation Triggers** のうち、「上流 API 契約の変更」に触れる。`POST /extract` の要求のスキーマに任意のヘッダーが加わるので、生成クライアントを作り直し、送る側 (`AttachmentTextExtractorService`) がヘッダーを付ける。応答とエラーの扱いは変わらないので、`mapAxiosErrorToOutcome` などの正規化の見直しは要らない。

下流の利用者は apps/app と、運用者向けの文書 (GROWI の外で管理している運用の手引き) である。運用の手引きに反映してほしい変更は、tasks.md の最後の確認のタスクで一覧にする。

### 取り込みのときの番号の付け方 (Port-back の前提)

対象 spec の要件の番号は変えず、末尾に足す (spec-lifecycle.md の (a))。

| この spec の要件 | 取り込み先 |
|---|---|
| Req 1 (呼び出し元の app をログに出す) | `attachment-search-text-extractor` の新しい Req 8 (AC 8.1〜8.7。この spec の 1.1〜1.7 と同じ順) |
| Req 2 (apps/app が app の ID を送る) | `attachment-search-indexing` の Req 1 の末尾の AC 1.5〜1.8 (この spec の 2.1〜2.4) |
| Req 3 (`/metrics`) | `attachment-search-text-extractor` の新しい Req 9 (AC 9.1〜9.9。3.1〜3.9 と同じ順) |
| Req 4 (`/readyz` の結果の使い回し) | `attachment-search-text-extractor` の Req 3 の末尾の AC 3.5〜3.8 (4.1〜4.4) |
| Req 5 (ZIP の上限の回避を塞ぐ) | `attachment-search-text-extractor` の Req 2 の末尾の AC 2.10〜2.13 (5.1〜5.4) |
| Req 6 (ページごとの結果の大きさ) | `attachment-search-text-extractor` の Req 2 の末尾の AC 2.14〜2.16 (6.1〜6.3) |
| Req 7 (子と親の環境変数の文書) | `attachment-search-text-extractor` の Req 3 の末尾の AC 3.9〜3.11 (7.1〜7.3) |
| Req 8 (古い要件番号のコメントの削除) | 取り込まない (1 回限りの片づけ。理由は research.md §6) |
| Req 9 (1.1.0 としての公開) | 取り込まない (1 回限りの作業。公開の仕組みは対象 spec の design.md「image の公開」にすでにある) |
| Req 10 (取り込みと削除) | 取り込まない |

## Problem

GROWI.cloud で 1 つの抽出サービスを複数の顧客 (GROWI の app) で共有して動かすには、運用者が負荷を見る手段が足りない。

- 抽出サービスのログの行に、どの app からの要求かを見分ける情報が無い。顧客ごとの負荷は、それぞれの app の側でしか分からない。
- 処理中の件数、応答の数、所要時間を、監視システム (Prometheus) が集める形で出していない。自動スケールの指標に使える値 (埋まっている枠の数) も無い。CPU は目安にしかならない (枠がすべて埋まったコンテナは 503 を返すだけで CPU を使わない)。

あわせて、レビューで見つかり先送りにした抽出サービス側の項目 (roadmap の (f) の抽出サービス側) が残っている。

- トークンなしで `/readyz` を呼び続けられると、最大で約 1 コアを使う。
- PPTX / XLSX で、ZIP の形を少し崩すと、エントリ数・展開後の大きさ・XLSX のセル数の上限を通らずに anydoc に届く (手元の実験で、10 万セルの XLSX と 12,000 エントリの ZIP が上限を通らずに変換された。research.md §3)。
- PDF と PPTX は、結果の大きさの上限を全ページを読んだ後に確かめるので、上限を大きく超える結果でも最後まで読み続ける。
- 変換の子プロセスは親と同じ uid で動くので、親の環境変数 (トークンを含む) を読める。このことが文書に書かれていない。
- コードのコメント約 108 か所が、すでに削除した作業用の spec の要件番号を引いており、いまの requirements.md の番号と合わない。

## Current State

- 抽出サービスは版 1.0.0 として Docker Hub に公開済みである (linux/amd64 と linux/arm64)。
- apps/app は抽出サービスを `packages/attachment-text-extractor-client` の生成クライアント (`postExtract`) で呼ぶ。ヘッダーは axios の引数 (`headers`) で渡している。
- 設定 `app:growiAppIdForCloud` は、型の宣言は `number | undefined` だが、既定値が無いため環境変数の文字列がそのまま値になる (`config-loader.ts` の `parseEnvValue` は既定値の型で読み方を決める。research.md §2)。

## Desired Outcome

- 抽出サービスのログの行から、要求を送った app が分かる (自己申告の値であることを前提にする)。
- 運用者が `/metrics` から、処理中の件数と上限、エンドポイントとステータスごとの応答の数、結果ごとの件数と所要時間、プロセスの CPU・メモリ・イベントループの遅れを集められる。
- 上の (f) の抽出サービス側の 5 項目が片づいている。
- これらを版 1.1.0 として 1 回で公開する。

## Approach

- app の ID: apps/app が `X-Growi-App-Id` ヘッダーで送り、抽出サービスが形を確かめてログの行の最後に出す。値は認可・上限・判断のどれにも使わない。
- `/metrics`: `@prometheus-io/client` を本番の依存に加える (理由は research.md §1)。応答の数は、`bearerAuth` より前に置く Hono の middleware で数える。
- `/readyz`: 同時の呼び出しで 1 回の確認を共有する今の仕組みに、終わった確認の結果を 10 秒覚える働きを足す。
- ZIP: 「ZIP ではない」ときだけファイル全体を anydoc に渡し、ZIP なのに検査を通せない形は断る。
- 結果の大きさ: 合計の数え方を 1 つの関数にまとめ、PDF と PPTX の繰り返しと最後の確かめが同じ関数を使う。
- 子の環境変数: 手元で実験し (research.md §5)、確かめた範囲だけを `docker/README.md` に書く。対策 (`MAX_CONCURRENCY=1`、顧客ごとのサービス、OS による隔離) は決めない (roadmap の (h) に残す)。
- コメント: 要件番号を引く部分を消す。理由が要るコメントは番号なしで書き直す。

## Scope

### In

- `apps/attachment-text-extractor/` の上の変更と、そのテスト、`docker/README.md`、`AGENTS.md`
- `packages/attachment-text-extractor-client/openapi.json` と生成クライアントの作り直し
- apps/app の `apps/app/src/features/search-attachments/server/services/attachment-text-extractor.ts` (送る側) とそのテスト
- `.github/workflows/ci-attachment-text-extractor.yml` のコメント 1 か所
- changeset 1 つ (`@growi/attachment-text-extractor` の minor。1.1.0 になる)
- 取り込みと、この spec の削除。`.kiro/specs/attachment-search/roadmap.md` の (f) と (h) の書き換え

### Out

- apps/app の task 3.4 (`attachment-search-indexing` の Req 8.2。抽出の成功・失敗の件数を apps/app 側で公開する)
- app ごとの同時実行の上限、トークンの入れ替え、抽出サービスの宛先を顧客の管理者が変えられないようにすること (roadmap の (h) のほかの項目)
- 子プロセスが親の環境変数やほかの要求のファイルを読めることへの対策 (roadmap の (h)。この spec は事実を文書に書くだけ)
- Python 版に由来する仕様の是正 (roadmap の (g))
- コメントが引く `research.md N.M` の節の番号と `D1`〜`D5` (約 190 か所)。対象 spec の research.md §8.1 の対応表で読めるので、この spec では触らない
- app の ID を使ったメトリクスのラベル (自己申告の値でラベルの種類が際限なく増えるため)
