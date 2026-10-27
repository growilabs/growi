# Requirements Document

## Project Description (Input)

**誰が困っているか**: `otel:anonymizeInBestEffort` を有効にして GROWI のトレースを外部の監視基盤へ送っている運用者と、そのデータを扱うプライバシ保護担当者。あわせて、匿名化の対象を今後追加・変更する GROWI 開発者。

**現状**:

- 完了済みの `opentelemetry` spec（要件 6）は「検索キーワード・ページパス・ユーザー名がトレースに平文で残らないこと」を目的にしているが、実際に匿名化されているのは一部の URL だけである。2026-10-27 の調査で、次の経路から平文が送られていることが分かった。
  - 検索: Next.js の画面内遷移で呼ばれる `/_next/data/<buildId>/_search.json?q=`、`/_private-legacy-pages?q=`、途中に `_search` を含む URL（page access 用の handler が search 用の handler の結果を上書きする）、`/_api/tags.search?q=`、`/_api/v3/users?searchText=`、`/_api/v3/users/usernames?q=`。
  - ページパス: `GET /_api/v3/page?path=`（ページ表示のたび）、`/_next/data/<buildId>/<ページパス>.json`（画面内のページ移動のたび）、`/_api/v3/page/exist?path=`、`.` を含むページ名、`/trash/*` など。
- handler に書かれた URL の一部（`page/check-page-existence`、`page/get-page-paths-with-descendant-count`、`page-listing/ancestors-children`）は実際のルートと食い違っており、何にも一致していない。
- どの URL をどう匿名化するかの一覧がどこにも無く、ルートの追加・改名に handler が追随しているかを確かめる手段が無い。
- `http.url`・`url.path`・`url.query` に元の URL が残る問題は、既存の契約の範囲内の不具合として PR #12151 で別途修正する（本 spec の対象外）。

**何を変えたいか**:

1. ユーザーが入力したデータ（ページパス・検索キーワード・タグ名・ユーザー名）を URL に含むリクエストを一覧にし、それぞれを「匿名化する（どう匿名化するか）」「意図的にそのまま残す（permalink や ObjectId だけを含む API など）」「未対応（既知の残課題）」のどれかに分類して spec に記載する。
2. 検索に関する上記の漏れを塞ぐ。
3. 同じ調査で見つかったページパスの漏れについて、対応するか・残課題とするかを決め、対応するものを塞ぐ。実際のルートと食い違っている handler の URL を直す。
4. handler の URL 判定を、「URL の形 → 匿名化するパラメータ」を並べた宣言的な一覧に寄せる。spec の一覧表・コード・hook を通したテストが 1 対 1 で対応し、ずれたら気づける状態にする。

**Amend target**: `.kiro/specs/opentelemetry/`（要件 6「HTTP リクエストの best-effort anonymization」と、design.md の Layer 4 / Extension Templates / Revalidation Triggers、research.md の handler 登録順に関する記述）。本 spec は一時的な修正用 spec であり、最後のタスクで変更内容を `opentelemetry` spec に書き戻し、本 spec を削除する（`.claude/rules/spec-lifecycle.md`）。

## Introduction

`otel:anonymizeInBestEffort` が `true` のとき、GROWI サーバーが受け取った HTTP リクエストのトレースには URL が記録される。本 spec は、その URL に含まれる利用者のデータ（ページパス・検索キーワード・タグ名・ユーザー名）と、アクセス権の代わりになる秘密の値（共有リンク ID・各種トークン）が平文で外部へ送られないようにする。あわせて、どの URL をどう扱うかを一覧表として明文化し、ルートの追加・改名に匿名化が追随しているかを自動テストで確かめられる状態にする。

用語:

- **利用者データ**: ページパス、検索キーワード（名前付き検索の名前を含む）、タグ名、ユーザー名、およびそれらの入力途中の断片。
- **秘密の値**: 知っているだけでアクセスや操作ができてしまう値。共有リンク ID、パスワード再設定トークン、ユーザー有効化トークン。
- **URL 属性**: トレースの span に記録される、リクエスト URL を含む属性。`http.target`、`http.url`、`url.path`、`url.query`。
- **一覧表**: 本 spec の「匿名化対象一覧」節。URL の形ごとに扱いを定める。

## Boundary Context

- **In scope**:
  - GROWI サーバーが受け取る HTTP リクエスト（サーバー側の span）の URL 属性。
  - 利用者データと秘密の値を、パスまたはクエリに含むすべての URL の形。Next.js の画面内遷移用データ URL（`/_next/data/...`）を含む。
  - 一覧表の作成と、一覧表と実際の挙動・実際のルートとのずれを検出する自動テスト。
- **Out of scope**:
  - URL 属性すべてを匿名化済みの値で上書きする仕組みそのもの（PR #12151 で修正済み）。本 spec はその仕組みが働いている前提で、「どの URL を匿名化するか」を扱う。
  - GROWI サーバーから外へ出ていくリクエスト（Elasticsearch・外部サービスなどへのクライアント側の span）。
  - リクエストボディ、リクエストヘッダ、ログ。
  - HTTP 以外の instrumentation（MongoDB・Mongoose・Express）が記録する属性。Express が付ける span 名とルートの型（`/page/:id` のような形）は利用者データを含まないため、対象外とする。
  - `otel:anonymizeInBestEffort` が `false` のときの挙動（従来どおり、何も書き換えない）。
- **Adjacent expectations**:
  - ページパスとして扱えるかの判定には、`@growi/core` のページパス関連の関数を引き続き利用する。その関数の仕様は本 spec の対象外。
  - 受信側（監視基盤）のダッシュボードやクエリは、既存の置換形式（`[HASHED:...]`、`[USERNAME_HASHED:...]`、`[ANONYMIZED]`）に依存している可能性がある。

## Requirements

### Requirement 1: 匿名化対象の一覧表

**Objective:** GROWI 開発者として、利用者データや秘密の値を URL に含むリクエストの扱いを 1 か所の一覧表で確認したい。ルートを追加・改名したときに、匿名化の追加・修正が必要かをすぐ判断できるようにするため。

#### Acceptance Criteria

1. The otel-anonymization-coverage spec shall 利用者データまたは秘密の値をパスかクエリに含む URL の形を、一覧表に 1 行ずつ記載する。各行には、URL の形、利用者データまたは秘密の値が入る場所（パスの位置またはクエリパラメータ名）、扱い（匿名化する／意図的にそのまま残す／未対応）、置換後の形を記載する。
2. The otel-anonymization-coverage spec shall 「意図的にそのまま残す」とした行に、残してよい理由を記載する。
3. The otel-anonymization-coverage spec shall 「未対応」とした行に、未対応である理由と、塞がないことによる影響を記載する。
4. The GROWI server shall 一覧表で「匿名化する」とした各行について、その行の URL の形に当てはまるリクエストの URL 属性に、利用者データと秘密の値を平文で残さない。
5. The GROWI server shall 一覧表で「意図的にそのまま残す」とした各行について、その行の URL の形に当てはまるリクエストの URL 属性を書き換えない。

### Requirement 2: 一覧表と実際の挙動・ルートとのずれの検出

**Objective:** GROWI 開発者として、一覧表と実際の匿名化の挙動、および実際のルートとの食い違いに、自動テストで気づきたい。handler に書いた URL が実在しないルートを指したまま放置される状態を防ぐため。

#### Acceptance Criteria

1. The GROWI server test suite shall 一覧表の各行に対応するテストケースを持ち、そのケースではリクエストを匿名化の入口（HTTP instrumentation から呼ばれる処理）に通して、最終的な URL 属性を確かめる。
2. If 一覧表の行に対応するテストケースが無い、または実際の挙動が一覧表と食い違う, the GROWI server test suite shall 失敗する。
3. If 一覧表に API の URL として記載したパスが、GROWI サーバーに登録されたルートのどれとも一致しない, the GROWI server test suite shall 失敗し、一致しなかったパスを示す。

### Requirement 3: 検索キーワードの匿名化

**Objective:** プライバシ保護担当者として、利用者が入力した検索キーワードが、検索の方法（検索画面の直接表示・画面内遷移・API 呼び出し）によらずトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When 全文検索のキーワードを含むリクエストを受け取ったとき, the GROWI server shall キーワードを含むクエリパラメータの値を `[ANONYMIZED]` に置き換える。対象は、検索画面の直接表示（`/_search`）、画面内遷移用のデータ URL（`/_next/data/<buildId>/_search.json`）、検索 API（`/_api/search`）、非公開の旧形式ページ一覧（`/_private-legacy-pages` とその画面内遷移用のデータ URL）とする。
2. When 名前付き検索の名前（`nq`）を含む検索リクエストを受け取ったとき, the GROWI server shall その値を `[ANONYMIZED]` に置き換える。
3. When タグ名の入力補完のリクエストを受け取ったとき, the GROWI server shall 入力途中のタグ名を含むクエリパラメータの値を `[ANONYMIZED]` に置き換える。
4. The GROWI server shall 検索 URL の、キーワード以外の部分（エンドポイントのパス、ページ番号、並び順など利用者データでないパラメータ）を読める形のまま残す。

### Requirement 4: ユーザー名の匿名化

**Objective:** プライバシ保護担当者として、ユーザー名やその入力途中の断片がトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When ユーザー名またはその断片をクエリパラメータに含むリクエスト（メンション候補の検索、ユーザー名の入力補完、ユーザー名の重複確認、管理画面のユーザー検索、監査ログの絞り込み候補、ユーザーグループに追加するユーザーの検索）を受け取ったとき, the GROWI server shall そのパラメータの値を `[ANONYMIZED]` に置き換える。
2. When ユーザー名をパスに含む API リクエスト（ユーザーグループへのユーザーの追加・削除）を受け取ったとき, the GROWI server shall パスの中のユーザー名を置き換え、エンドポイントの残りの部分は読める形のまま残す。
3. When ユーザーページ（`/user/<ユーザー名>` とその配下）へのリクエストを受け取ったとき, the GROWI server shall ユーザー名とその配下のパスを、それぞれ `[USERNAME_HASHED:...]` と `[HASHED:...]` に置き換える。これはユーザー名やページ名に `.` を含む場合と、画面内遷移用のデータ URL の場合にも適用する。

### Requirement 5: ページパスの匿名化

**Objective:** プライバシ保護担当者として、閲覧・操作したページのパスが、アクセスの方法（直接表示・画面内遷移・API 呼び出し）によらずトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When ページ表示のリクエストを受け取ったとき, the GROWI server shall パス部分を `[HASHED:...]` に置き換える。ページ名に `.` を含む場合と、ゴミ箱内のページ（`/trash/` 配下）の場合も同様とする。
2. When 画面内遷移用のデータ URL（`/_next/data/<buildId>/<ページパス>.json`）へのリクエストを受け取ったとき, the GROWI server shall ページパスの部分を置き換え、`/_next/data/<buildId>/` の部分は読める形のまま残す。
3. The GROWI server shall 同じページへの直接表示と画面内遷移とで、置き換え後のページパスの部分を同じ値にする。
4. When ページパスをクエリパラメータに含む API リクエスト（現在のページの取得、ページの存在確認、移動・複製先のパスの確認、作成先の権限確認、同じパスのページ一覧、ページ一覧・配下一覧・子ページ一覧、子孫ページ数の取得、更新通知先の取得など）を受け取ったとき, the GROWI server shall そのパラメータの値を `[ANONYMIZED]` に置き換える。複数のページパスを受け取るパラメータ（`paths` など）では、すべての値を置き換える。
5. When ページの Markdown 形式の取得（`<ページパス>.md`）のリクエストを受け取ったとき, the GROWI server shall `.md` を除いたページパスの部分を、同じページの表示と同じ `[HASHED:...]` に置き換え、末尾の `.md` は残す。
6. The GROWI server shall パーマリンク（ObjectId 形式のパス）、トップページ（`/`）、ユーザー一覧のトップ（`/user`）、静的ファイル（画像・スタイルシート・スクリプトなど）の URL を書き換えない。

### Requirement 6: 秘密の値の匿名化

**Objective:** プライバシ保護担当者として、知っているだけでアクセスや操作ができてしまう値が、トレースから読み取れないことを保証したい。

#### Acceptance Criteria

1. When 共有リンクのページ表示、その画面内遷移用のデータ URL、または共有リンク ID を含む API リクエストを受け取ったとき, the GROWI server shall 共有リンク ID を、値によらない固定の文字列に置き換える。
2. When パスワード再設定またはユーザー有効化のトークンを含むリクエストを受け取ったとき, the GROWI server shall トークンを、値によらない固定の文字列に置き換える。
3. The GROWI server shall 秘密の値を、元の値から計算したハッシュに置き換えない。ハッシュ値から元の値を総当たりで割り出せないようにするため。

### Requirement 7: 複数の扱いに当てはまる URL

**Objective:** プライバシ保護担当者として、ある URL が複数の匿名化の対象に当てはまるとき、どれか 1 つの結果がほかの結果を打ち消さないことを保証したい。

#### Acceptance Criteria

1. When 1 つの URL がパスとクエリの両方に利用者データを含むとき, the GROWI server shall パスとクエリの両方を匿名化した URL を記録する。
2. If 1 つの URL が複数の匿名化の対象に当てはまる, the GROWI server shall どの対象についても、匿名化された部分を平文に戻さない（例: 途中に `_search` を含むページパスへの検索クエリ付きリクエストで、キーワードもページパスも平文で残さない）。

### Requirement 8: 既存の置換形式との互換性

**Objective:** 運用者として、本 spec の変更後も、既存のダッシュボードやクエリが参照している置換後の値の形が変わらないことを確認したい。

#### Acceptance Criteria

1. The GROWI server shall 既存の置換形式（ページパスの `[HASHED:<16 桁の 16 進数>]`、ユーザー名の `[USERNAME_HASHED:<16 桁の 16 進数>]`、クエリパラメータの `[ANONYMIZED]`）を変えない。
2. The GROWI server shall 変更前から匿名化されていたページ表示の URL について、置き換え後の値を変更前と同じにする。
3. The GROWI server shall 一覧表に当てはまらない URL の URL 属性を書き換えない。

## 匿名化対象一覧

<!-- The table is filled in during the design phase from the 2026-10-27 survey, then kept in sync with the code and the hook-level tests (Requirement 2). -->

設計フェーズで、2026-10-27 の調査結果をもとに行を確定する。列は「URL の形」「データの種類と場所」「扱い」「置換後の形」「理由（そのまま残す・未対応の場合）」とする。
