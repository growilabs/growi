# Brief: opentelemetry-anonymization

## Problem

`otel:anonymizeInBestEffort` を有効にして GROWI のトレースを外部の監視基盤へ送っている運用者と、そのデータを扱うプライバシ保護担当者は、「検索キーワード・ページパス・ユーザー名がトレースに平文で残らない」ことを期待している。しかし実際に匿名化されているのは一部の URL だけで、ページを表示するたび・検索するたびに平文が送られている。

あわせて、ルートを追加・改名する GROWI 開発者には、匿名化の追加・修正が必要かを判断する手がかりが無い。どの URL をどう扱うかの一覧がどこにも無く、handler に書かれた URL が実在するルートと一致しているかを確かめる手段も無い。

## Current State

- 匿名化は `apps/app/src/features/opentelemetry/server/anonymization/` にあり、4 つの handler（search / page-listing / page API / page access）が URL の文字列判定で対象を選んでいる。契約は `opentelemetry` spec の要件 6 と design.md の Layer 4 に書かれている。
- 2026-10-27 の調査で、匿名化されていない主な経路が見つかった。
  - 検索: `/_next/data/<buildId>/_search.json?q=`（画面内遷移での検索・タグクリック）、`/_private-legacy-pages?q=`、`/_api/tags.search?q=`、ユーザー名の検索・入力補完（`/_api/v3/users?searchText=`、`/_api/v3/users/usernames?q=` など）。
  - ページパス: `GET /_api/v3/page?path=`（ページ表示のたび）、`/_next/data/<buildId>/<ページパス>.json`（画面内のページ移動のたび）、`/_api/v3/page/exist?path=`、`.` を含むページ名、`/trash/*`、`<ページパス>.md`。
  - 秘密の値: 共有リンク ID（`/share/:id`）、パスワード再設定・ユーザー有効化のトークン。
- handler に書かれた URL の一部（`page/check-page-existence`、`page/get-page-paths-with-descendant-count`、`page-listing/ancestors-children`）は実在するルートと一致せず、何も匿名化していない。
- 途中に `_search` を含むページパスへの検索クエリ付きリクエストでは、page access の handler が search の handler の結果を上書きし、キーワードが平文に戻る。
- `http.url`・`url.path`・`url.query` に元の URL が残る問題は、`opentelemetry` spec の既存の契約の範囲内の不具合として PR #12151 で修正済み（本 spec はその修正を前提にする）。

## Desired Outcome

- 利用者データ（ページパス・検索キーワード・タグ名・ユーザー名）と秘密の値を URL に含むすべてのリクエストについて、トレースの URL 属性に平文が残らない。
- どの URL をどう扱うか（匿名化する／意図的にそのまま残す／未対応）が本 spec の一覧表で 1 か所にまとまっている。
- 一覧表・コード・hook を通したテストが 1 対 1 で対応し、食い違いや実在しないルートの記載があれば自動テストが失敗する。

## Approach

`opentelemetry` spec の Layer 4（HTTP Anonymization）を、本 spec に**恒久的に移す**。

- 匿名化は、ほかの Layer（SDK・Resource・メトリクス）と変更のきっかけ・読み手が違う。ほかの Layer は SDK の更新やメトリクスの追加で変わり、匿名化はアプリ全体のルートの追加・改名で変わる。一覧表を保守し続ける場所として、独立した spec が適している。
- 不採用: 修正用の spec（amend spec）として作り、完了後に `opentelemetry` spec へ書き戻す案。一覧表がルートの変更のたびに SDK の spec の更新を求めることになるため。
- 不採用: `opentelemetry` spec を直接書き換える案。完了済みの spec を直接書き換えることになり、`.claude/rules/spec-lifecycle.md` に反するため。

## Scope

- **In**:
  - Layer 4 全体の契約（hook の基本動作、無効時は何も書き換えないこと、既存の search / page-listing / page API / page access の扱いを含む）。
  - 匿名化対象の一覧表と、一覧表と実際の挙動・実在するルートとの食い違いを検出する自動テスト。
  - 上記 Current State の漏れを塞ぐこと（検索・タグ名・ユーザー名・ページパス・秘密の値）。
  - 実在するルートと食い違っている handler の URL の修正。
  - handler の URL 判定を、「URL の形 → 匿名化する部分」を並べた宣言的な一覧に寄せること。
  - `opentelemetry` spec から要件 6 と Layer 4 を取り除き、本 spec への参照を残すこと（本 spec の最終タスク）。
- **Out**:
  - URL 属性すべてを匿名化済みの値で上書きする仕組み（PR #12151 で修正済み。本 spec に移した後は本 spec の契約として記載する）。
  - GROWI サーバーから外へ出ていくリクエスト（クライアント側の span）。
  - リクエストボディ、リクエストヘッダ、ログ。
  - HTTP 以外の instrumentation（MongoDB・Mongoose・Express）が記録する属性。ページパスなどを記録していないかは未調査。

## Boundary Candidates

- **何を匿名化するか（一覧表）** と **どう匿名化するか（置換の仕組み）** を分ける。ルートの追加で変わるのは前者だけにする。
- **URL 属性への反映**（どの属性を上書きするか）は、置換の仕組みのさらに外側に置く。instrumentation-http の semconv の変更で変わるのはここだけにする。

## Out of Boundary

- `@growi/core` のページパス関連の関数（`isCreatablePage` など）の仕様。本 spec は利用するだけ。
- 受信側（監視基盤）のダッシュボード・クエリ。
- SDK のライフサイクル、Resource、Custom Metrics、Diag Logger、SemConv のローカルコピー（`opentelemetry` spec に残る）。ただし `semconv.ts` への定数の追加は本 spec から行ってよい。

## Upstream / Downstream

- **Upstream**: `opentelemetry` spec（NodeSDK の初期化と、HTTP instrumentation への `httpInstrumentationConfig` の受け渡し）、`@opentelemetry/instrumentation-http`（hook の呼び出しと URL 属性の生成）、`@growi/core` のページパス関連の関数、GROWI サーバーのルート定義（一覧表と照合する相手）。
- **Downstream**: 今後ルートを追加・改名するすべての機能開発。一覧表の確認がその手順に加わる。

## Existing Spec Touchpoints

- **Extends**: `opentelemetry` — 要件 6、design.md の Layer 4・Extension Templates「新規 Anonymization Handler の追加」・Revalidation Triggers「新規 anonymization 対象パス／パラメータ追加要望」、research.md の「Anonymization Handler の登録順とパターン」「Decision: Anonymization は best-effort, module-based, opt-in」を本 spec に移し、`opentelemetry` 側には Out of Boundary の 1 行（「HTTP の匿名化は `opentelemetry-anonymization` を参照」）を残す。research.md の「複数 module が同一 URL を匿名化することは現状無い」という記述は誤りなので、移す際に正す。
- **Adjacent**: `page-markdown-endpoint`（`<ページパス>.md` のルートを持つ）。

## Constraints

- 既存の置換形式（`[HASHED:<16 桁の 16 進数>]`、`[USERNAME_HASHED:...]`、`[ANONYMIZED]`）と、すでに匿名化されていたページ表示のハッシュ値を変えない（受信側のダッシュボードが依存している可能性がある）。
- 新しい npm 依存は追加しない（`opentelemetry` spec の Allowed Dependencies に従う）。
- 一覧表と実在するルートを照合するテスト（要件 3.3 の案）が実現できるかは、設計の段階で確かめる。
