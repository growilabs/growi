# Requirements Document

## Project Description (Input)

`otel:anonymizeInBestEffort` を有効にしたとき、GROWI サーバーが受け取る HTTP リクエストのトレースに、利用者データ（ページパス・検索キーワード・タグ名・ユーザー名）と秘密の値（共有リンク ID・各種トークン）が平文で残らないようにする。どの URL をどう扱うかを一覧表として明文化し、一覧表・コード・テストのずれを自動で検出できるようにする。`opentelemetry` spec の Layer 4（HTTP Anonymization）を本 spec に移し、以後は本 spec が匿名化の契約を持つ。問題・現状・範囲・判断の経緯は [brief.md](./brief.md) を参照。

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
  - 匿名化を有効・無効にしたときの挙動と、匿名化した値をすべての URL 属性に反映すること。
  - 利用者データと秘密の値を、パスまたはクエリに含むすべての URL の形。Next.js の画面内遷移用データ URL（`/_next/data/...`）を含む。
  - 一覧表の作成と、一覧表と実際の挙動・実際のルートとのずれを検出する自動テスト。
- **Out of scope**:
  - GROWI サーバーから外へ出ていくリクエスト（Elasticsearch・外部サービスなどへのクライアント側の span）。
  - リクエストボディ、リクエストヘッダ、ログ。
  - HTTP 以外の instrumentation（MongoDB・Mongoose・Express）が記録する属性。Express が付ける span 名とルートの型（`/page/:id` のような形）は利用者データを含まないため、対象外とする。
- **Adjacent expectations**:
  - SDK の初期化と、HTTP の計測部品への匿名化処理の受け渡しは `opentelemetry` spec が担う。本 spec は受け渡された後の匿名化処理を担う。
  - ページパスとして扱えるかの判定には、`@growi/core` のページパス関連の関数を引き続き利用する。その関数の仕様は本 spec の対象外。
  - 受信側（監視基盤）のダッシュボードやクエリは、既存の置換形式（`[HASHED:...]`、`[USERNAME_HASHED:...]`、`[ANONYMIZED]`）に依存している可能性がある。

## Requirements

### Requirement 1: 匿名化の有効化と URL 属性への反映

**Objective:** 運用者として、設定 1 つで匿名化を有効・無効にでき、有効なときは匿名化した値がトレースのどの URL 属性にも行き渡ることを確認したい。属性の一部だけが匿名化され、ほかの属性から元の URL が読めてしまう状態を防ぐため。

#### Acceptance Criteria

1. While `otel:anonymizeInBestEffort` が `true` のとき, the GROWI server shall 受け取った HTTP リクエストごとに、一覧表に基づいて URL を匿名化する。
2. If `otel:anonymizeInBestEffort` が `false`, the GROWI server shall URL 属性を一切書き換えず、HTTP の計測部品の標準の記録だけを行う。
3. When リクエストの URL を匿名化したとき, the GROWI server shall `http.target` と `http.url` の両方に、匿名化した後の値を記録する。`http.url` には、元の URL のスキームとホストに匿名化した後のパスとクエリをつないだ値を記録する。
4. Where 環境変数 `OTEL_SEMCONV_STABILITY_OPT_IN` で HTTP の新しい形式の属性が有効になっている, the GROWI server shall `url.path` と `url.query` にも、匿名化した後の値を記録する。
5. When リクエストの URL が匿名化の対象に当てはまらないとき, the GROWI server shall URL 属性を書き換えない。

### Requirement 2: 匿名化対象の一覧表

**Objective:** GROWI 開発者として、利用者データや秘密の値を URL に含むリクエストの扱いを 1 か所の一覧表で確認したい。ルートを追加・改名したときに、匿名化の追加・修正が必要かをすぐ判断できるようにするため。

#### Acceptance Criteria

1. The opentelemetry-anonymization spec shall 利用者データまたは秘密の値をパスかクエリに含む URL の形を、一覧表に 1 行ずつ記載する。各行には、行 ID、URL の形、利用者データまたは秘密の値が入る場所（パスの位置またはクエリパラメータ名）、扱い（匿名化する／意図的にそのまま残す／未対応）、置換後の形を記載する。どの URL に付いていても匿名化するクエリパラメータは、その名前の一覧を 1 行として記載する。
2. The opentelemetry-anonymization spec shall 「意図的にそのまま残す」とした行に、残してよい理由を記載する。
3. The opentelemetry-anonymization spec shall 「未対応」とした行に、未対応である理由と、塞がないことによる影響を記載する。
4. The GROWI server shall 一覧表で「匿名化する」とした各行について、その行の URL の形に当てはまるリクエストの URL 属性に、利用者データと秘密の値を平文で残さない。
5. The GROWI server shall 一覧表で「意図的にそのまま残す」とした各行について、その行の URL の形に当てはまるリクエストの URL 属性のパス部分を書き換えない（どの URL に付いていても匿名化するクエリパラメータは除く）。

### Requirement 3: 一覧表と実際の挙動・ルートとのずれの検出

**Objective:** GROWI 開発者として、一覧表と実際の匿名化の挙動、および実際のルートとの食い違いに、自動テストで気づきたい。handler に書いた URL が実在しないルートを指したまま放置される状態を防ぐため。

#### Acceptance Criteria

1. The GROWI server test suite shall 一覧表の各行に対応するテストケースを持ち、そのケースではリクエストを匿名化の入口（HTTP instrumentation から呼ばれる処理）に通して、最終的な URL 属性を確かめる。
2. If 一覧表の行に対応するテストケースが無い、または実際の挙動が一覧表と食い違う, the GROWI server test suite shall 失敗する。
3. If 一覧表に API の URL として記載したパスが、GROWI サーバーに登録されたルートのどれとも一致しない, the GROWI server test suite shall 失敗し、一致しなかったパスを示す。

### Requirement 4: 検索キーワードの匿名化

**Objective:** プライバシ保護担当者として、利用者が入力した検索キーワードが、検索の方法（検索画面の直接表示・画面内遷移・API 呼び出し）によらずトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When 全文検索のキーワードを含むリクエストを受け取ったとき, the GROWI server shall キーワードを含むクエリパラメータの値を `[ANONYMIZED]` に置き換える。対象は、検索画面の直接表示（`/_search`）、画面内遷移用のデータ URL（`/_next/data/<buildId>/_search.json`）、検索 API（`/_api/search`）、非公開の旧形式ページ一覧（`/_private-legacy-pages` とその画面内遷移用のデータ URL）とする。
2. When 名前付き検索の名前（`nq`）を含む検索リクエストを受け取ったとき, the GROWI server shall その値を `[ANONYMIZED]` に置き換える。
3. When タグ名の入力補完のリクエストを受け取ったとき, the GROWI server shall 入力途中のタグ名を含むクエリパラメータの値を `[ANONYMIZED]` に置き換える。
4. The GROWI server shall 検索 URL の、キーワード以外の部分（エンドポイントのパス、ページ番号、並び順など利用者データでないパラメータ）を読める形のまま残す。

### Requirement 5: ユーザー名の匿名化

**Objective:** プライバシ保護担当者として、ユーザー名やその入力途中の断片がトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When ユーザー名またはその断片をクエリパラメータに含むリクエスト（メンション候補の検索、ユーザー名の入力補完、ユーザー名の重複確認、管理画面のユーザー検索、監査ログの絞り込み候補、ユーザーグループに追加するユーザーの検索）を受け取ったとき, the GROWI server shall そのパラメータの値を `[ANONYMIZED]` に置き換える。
2. When ユーザー名をパスに含む API リクエスト（ユーザーグループへのユーザーの追加・削除）を受け取ったとき, the GROWI server shall パスの中のユーザー名を置き換え、エンドポイントの残りの部分は読める形のまま残す。
3. When ユーザーページ（`/user/<ユーザー名>` とその配下）へのリクエストを受け取ったとき, the GROWI server shall ユーザー名とその配下のパスを、それぞれ `[USERNAME_HASHED:...]` と `[HASHED:...]` に置き換える。これはユーザー名やページ名に `.` を含む場合と、画面内遷移用のデータ URL の場合にも適用する。

### Requirement 6: ページパスの匿名化

**Objective:** プライバシ保護担当者として、閲覧・操作したページのパスが、アクセスの方法（直接表示・画面内遷移・API 呼び出し）によらずトレースに平文で残らないことを保証したい。

#### Acceptance Criteria

1. When ページ表示のリクエストを受け取ったとき, the GROWI server shall パス部分を `[HASHED:...]` に置き換える。ページ名に `.` を含む場合と、ゴミ箱内のページ（`/trash/` 配下）の場合も同様とする。
2. When 画面内遷移用のデータ URL（`/_next/data/<buildId>/<ページパス>.json`）へのリクエストを受け取ったとき, the GROWI server shall ページパスの部分を置き換え、`/_next/data/<buildId>/` の部分は読める形のまま残す。
3. The GROWI server shall 同じページへの直接表示と画面内遷移とで、置き換え後のページパスの部分を同じ値にする。
4. When ページパスをクエリパラメータに含む API リクエスト（現在のページの取得、ページの存在確認、移動・複製先のパスの確認、作成先の権限確認、同じパスのページ一覧、ページ一覧・配下一覧・子ページ一覧、子孫ページ数の取得、更新通知先の取得など）を受け取ったとき, the GROWI server shall そのパラメータの値を `[ANONYMIZED]` に置き換える。複数のページパスを受け取るパラメータ（`paths` など）では、すべての値を置き換える。
5. When ページの Markdown 形式の取得（`<ページパス>.md`）のリクエストを受け取ったとき, the GROWI server shall `.md` を除いたページパスの部分を、同じページの表示と同じ `[HASHED:...]` に置き換え、末尾の `.md` は残す。
6. The GROWI server shall パーマリンク（ObjectId 形式のパス）、トップページ（`/`）、ユーザー一覧のトップ（`/user`）、静的ファイル（画像・スタイルシート・スクリプトなど）の URL を書き換えない。

### Requirement 7: 秘密の値の匿名化

**Objective:** プライバシ保護担当者として、知っているだけでアクセスや操作ができてしまう値が、トレースから読み取れないことを保証したい。

#### Acceptance Criteria

1. When 共有リンクのページ表示、その画面内遷移用のデータ URL、または共有リンク ID を含む API リクエストを受け取ったとき, the GROWI server shall 共有リンク ID を、値によらない固定の文字列に置き換える。
2. When パスワード再設定またはユーザー有効化のトークンを含むリクエストを受け取ったとき, the GROWI server shall トークンを、値によらない固定の文字列に置き換える。
3. The GROWI server shall 秘密の値を、元の値から計算したハッシュに置き換えない。ハッシュ値から元の値を総当たりで割り出せないようにするため。

### Requirement 8: 複数の扱いに当てはまる URL

**Objective:** プライバシ保護担当者として、ある URL が複数の匿名化の対象に当てはまるとき、どれか 1 つの結果がほかの結果を打ち消さないことを保証したい。

#### Acceptance Criteria

1. When 1 つの URL がパスとクエリの両方に利用者データを含むとき, the GROWI server shall パスとクエリの両方を匿名化した URL を記録する。
2. If 1 つの URL が複数の匿名化の対象に当てはまる, the GROWI server shall どの対象についても、匿名化された部分を平文に戻さない（例: 途中に `_search` を含むページパスへの検索クエリ付きリクエストで、キーワードもページパスも平文で残さない）。

### Requirement 9: 既存の置換形式との互換性

**Objective:** 運用者として、本 spec の変更後も、既存のダッシュボードやクエリが参照している置換後の値の形が変わらないことを確認したい。

#### Acceptance Criteria

1. The GROWI server shall 既存の置換形式（ページパスの `[HASHED:<16 桁の 16 進数>]`、ユーザー名の `[USERNAME_HASHED:<16 桁の 16 進数>]`、クエリパラメータの `[ANONYMIZED]`）を変えない。
2. The GROWI server shall 変更前から匿名化されていたページ表示の URL について、置き換え後の値を変更前と同じにする。

## 匿名化対象一覧

各行の ID は、コード側の例（coverage examples）の ID と一致させる（要件 3.2）。「規則」はコード側の規則の ID。`<id>` は 24 桁の 16 進数（ObjectId）、`<BID>` は Next.js の buildId、`<locale>` は `AllLang` のいずれか。置換後の `[ANONYMIZED]` はクエリ中では `%5BANONYMIZED%5D` とパーセントエンコードされる。

### どの URL に付いていても匿名化するクエリパラメータ

| ID | パラメータ名 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|
| `Q01` | `q`、`nq`、`path`、`paths`、`fromPath`、`toPath`、`searchText`、`searchWord`、`username`、`shareLinkId`、`searchFilter`（`name[]` 形式を含む） | 匿名化する | `sensitive-query-params` | 値を `[ANONYMIZED]`（JSON 配列なら `["[ANONYMIZED]"]`） |

### ページ表示

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `P01` | `/<ページパス>`（非 ASCII を含む） | ページパス（パス） | 匿名化する | `page-view` | `/[HASHED:...]` |
| `P02` | `/<ページパス>`（ASCII のみ。変更前と同じ値） | ページパス（パス） | 匿名化する | `page-view` | `/[HASHED:...]` |
| `P03` | `/<ページパス>?<クエリ>` | ページパス（パス） | 匿名化する。Q01 以外のクエリは残す | `page-view` | `/[HASHED:...]?<クエリ>` |
| `P04` | `/<. を含むページパス>` | ページパス（パス） | 匿名化する | `page-view` | `/[HASHED:...]` |
| `P05` | `/user/<ユーザー名>` | ユーザー名（パス） | 匿名化する | `page-view` | `/user/[USERNAME_HASHED:...]` |
| `P06` | `/user/<ユーザー名>/<配下>`（ユーザー名に `.` を含む場合を含む） | ユーザー名・ページパス（パス） | 匿名化する | `page-view` | `/user/[USERNAME_HASHED:...]/[HASHED:...]` |
| `P07` | `/trash/<ページパス>` | ページパス（パス） | 匿名化する | `trash-page` | `/trash/[HASHED:...]`（ゴミ箱内のユーザーページは `/trash/user/[USERNAME_HASHED:...]/[HASHED:...]`） |
| `P08` | `/<ページパス>.md`、`/user/<ユーザー名>.md` | ページパス・ユーザー名（パス） | 匿名化する | `page-markdown` | `/[HASHED:...].md`（ハッシュは P01 と同じ値）、`/user/[USERNAME_HASHED:...].md` |
| `P09` | `/<途中に _search を含むページパス>?q=<キーワード>` | ページパス（パス）・キーワード（`q`） | 匿名化する | `page-view`、`sensitive-query-params` | `/[HASHED:...]?q=[ANONYMIZED]` |
| `P10` | `/`、`/user` | なし | 意図的にそのまま残す（利用者データを含まない） | `kept-pages` | 変更なし |
| `P11` | `/<id>`、`/<id>.md`（パーマリンク） | ページ ID（パス） | 意図的にそのまま残す（ObjectId は利用者データでなく、閲覧には権限が要る） | `kept-pages` | 変更なし |
| `P12` | `@growi/core` の `isCreatablePage` が作成不可とするシステムページ（`/admin/...`、`/me`、`/login`、`/tags`、`/trash`、`/share`、`/_search`（キーワードなし）、`/_private-legacy-pages`（キーワードなし）、`/attachment/<id>`、`/_api/...` など） | なし | 意図的にそのまま残す（利用者データを含まない） | （規則なし） | 変更なし |
| `P13` | `/download/<id>`、`/ogp/<id>`、`/invited`、`/forgot-password`（トークンなし）、`/passport/...` など、作成可能なページパスと区別できないシステムのルート | なし | 匿名化する（利用者データは含まないが、ページ表示と区別できないためハッシュ化される。変更前と同じ） | `page-view` | `/[HASHED:...]` |

### 画面内遷移用のデータ URL

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `N01` | `/_next/data/<BID>/<locale>/<ページパス>.json?path=<区切り>&...` | ページパス（パスとクエリ） | 匿名化する | `next-data`、`sensitive-query-params` | `/_next/data/<BID>/<locale>/[HASHED:...].json?path=[ANONYMIZED]&...`（ハッシュは P01 と同じ値） |
| `N02` | `/_next/data/<BID>/<locale>/user/<ユーザー名>.json?path=...` | ユーザー名（パスとクエリ） | 匿名化する | `next-data`、`sensitive-query-params` | `/_next/data/<BID>/<locale>/user/[USERNAME_HASHED:...].json?path=[ANONYMIZED]&...` |
| `N03` | `/_next/data/<BID>/<locale>/trash/<ページパス>.json?path=...` | ページパス（パスとクエリ） | 匿名化する | `next-data`、`sensitive-query-params` | `/_next/data/<BID>/<locale>/trash/[HASHED:...].json?path=[ANONYMIZED]&...` |
| `N04` | `/_next/data/<BID>/<locale>/_search.json?q=<キーワード>` | キーワード（`q`） | 匿名化する | `next-data`、`sensitive-query-params` | `/_next/data/<BID>/<locale>/_search.json?q=[ANONYMIZED]` |
| `N05` | `/_next/data/<BID>/<locale>/_private-legacy-pages.json?q=<キーワード>` | キーワード（`q`） | 匿名化する | `next-data`、`sensitive-query-params` | `.../_private-legacy-pages.json?q=[ANONYMIZED]` |
| `N06` | `/_next/data/<BID>/<locale>/share/<共有リンク ID>.json?path=<共有リンク ID>` | 共有リンク ID（パスとクエリ） | 匿名化する | `next-data`、`sensitive-query-params` | `/_next/data/<BID>/<locale>/share/[ANONYMIZED].json?path=[ANONYMIZED]` |
| `N07` | `/_next/data/<BID>/<locale>.json`（トップページ） | なし | 意図的にそのまま残す | `next-data` | 変更なし |

### 検索・タグ・ユーザー名

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `S01` | `GET /_search?q=` | キーワード（`q`） | 匿名化する | `sensitive-query-params` | `q=[ANONYMIZED]` |
| `S02` | `GET /_api/search?q=&nq=` | キーワード・名前付き検索の名前（`q`・`nq`） | 匿名化する。`limit` などは残す | `sensitive-query-params` | `q=[ANONYMIZED]&nq=[ANONYMIZED]` |
| `S03` | `GET /_private-legacy-pages?q=` | キーワード（`q`） | 匿名化する | `sensitive-query-params` | `q=[ANONYMIZED]` |
| `S04` | `GET /_api/tags.search?q=` | 入力途中のタグ名（`q`） | 匿名化する | `sensitive-query-params` | `q=[ANONYMIZED]` |
| `U01` | `GET /_api/v3/users?searchText=` | ユーザー名の断片（`searchText`） | 匿名化する | `sensitive-query-params` | `searchText=[ANONYMIZED]` |
| `U02` | `GET /_api/v3/users/usernames?q=` | ユーザー名の断片（`q`） | 匿名化する | `sensitive-query-params` | `q=[ANONYMIZED]` |
| `U03` | `GET /_api/v3/check-username?username=` | ユーザー名（`username`） | 匿名化する | `sensitive-query-params` | `username=[ANONYMIZED]` |
| `U04` | `GET /_api/v3/activity/suggestions?field=username&q=` | ユーザー名の断片（`q`） | 匿名化する | `sensitive-query-params` | `q=[ANONYMIZED]` |
| `U05` | `GET /_api/v3/activity?searchFilter=` | ユーザー名を含む JSON（`searchFilter`） | 匿名化する | `sensitive-query-params` | `searchFilter=[ANONYMIZED]` |
| `U06` | `GET /_api/v3/user-groups/<id>/unrelated-users?searchWord=` | ユーザー名の断片（`searchWord`） | 匿名化する | `sensitive-query-params` | `searchWord=[ANONYMIZED]` |
| `U07` | `POST/DELETE /_api/v3/user-groups/<id>/users/<ユーザー名>` | ユーザー名（パス） | 匿名化する。グループの `<id>` は残す | `api-path-segments` | `/_api/v3/user-groups/<id>/users/[ANONYMIZED]` |

### ページパスを受け取る API

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `A01` | `GET /_api/v3/page?path=` | ページパス（`path`） | 匿名化する。`pageId`・`revisionId` は残す | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A02` | `GET /_api/v3/page/exist?path=` | ページパス（`path`） | 匿名化する | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A03` | `GET /_api/v3/page/exist-paths?fromPath=&toPath=` | ページパス（`fromPath`・`toPath`） | 匿名化する | `sensitive-query-params` | `fromPath=[ANONYMIZED]&toPath=[ANONYMIZED]` |
| `A04` | `GET /_api/v3/page/non-user-related-groups-granted?path=` | ページパス（`path`） | 匿名化する | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A05` | `GET /_api/v3/page/page-paths-with-descendant-count?paths[]=` | ページパス（`paths[]`） | 匿名化する | `sensitive-query-params` | `paths[]=[ANONYMIZED]` |
| `A06` | `GET /_api/v3/page-listing/children?path=`、`/info?path=`、`/item?path=` | ページパス（`path`） | 匿名化する | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A07` | `GET /_api/v3/pages/list?path=`、`/subordinated-list?path=` | ページパス（`path`） | 匿名化する。`limit` などは残す | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A08` | `GET /_api/pages.updatePost?path=` | ページパス（`path`） | 匿名化する | `sensitive-query-params` | `path=[ANONYMIZED]` |
| `A09` | `/_api/v3/page/info?pageId=`、`/_api/v3/revisions/<id>` など、API で ID だけを含む URL | ページ・版の ID | 意図的にそのまま残す（ObjectId は利用者データでなく、閲覧には権限が要る） | （規則なし） | 変更なし |

### 秘密の値

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `K01` | `GET /share/<共有リンク ID>` | 共有リンク ID（パス） | 匿名化する | `secret-path-segments` | `/share/[ANONYMIZED]` |
| `K02` | `GET /forgot-password/<トークン>` | パスワード再設定トークン（パス） | 匿名化する | `secret-path-segments` | `/forgot-password/[ANONYMIZED]` |
| `K03` | `GET /user-activation/<トークン>` | ユーザー有効化トークン（パス） | 匿名化する | `secret-path-segments` | `/user-activation/[ANONYMIZED]` |
| `K04` | `GET /_api/v3/page/shared?shareLinkId=&pageId=`、`/_api/v3/page/info?shareLinkId=`、`/_api/v3/comments?shareLinkId=` | 共有リンク ID（`shareLinkId`） | 匿名化する。`pageId` は残す | `sensitive-query-params` | `shareLinkId=[ANONYMIZED]` |
| `K05` | `DELETE /_api/v3/share-links/<共有リンク ID>` | 共有リンク ID（パス） | 匿名化する | `api-path-segments` | `/_api/v3/share-links/[ANONYMIZED]` |

### 静的ファイル

| ID | URL の形 | データの種類と場所 | 扱い | 規則 | 置換後の形 |
|---|---|---|---|---|---|
| `F01` | `/_next/static/...`、`/_drawio-assets/...`、`/uploads/...`、`/vault.git/...`、`/favicon.ico`、`/favicon.svg`、最後の区切りが静的ファイルの拡張子（`png`・`jpg`・`jpeg`・`gif`・`svg`・`ico`・`webp`・`css`・`js`・`mjs`・`map`・`json`・`woff`・`woff2`・`ttf`・`otf`・`eot`）で終わる `/static/...`・`/images/...` | なし | 意図的にそのまま残す（利用者データを含まない） | `static-files` | 変更なし |
| `F02` | F01 に当てはまらない `/static/<ページパス>`・`/images/<ページパス>`（`/images/v1.2` のように `.` を含むページ名を含む） | ページパス（パス） | 匿名化する（静的ファイルが無ければページ表示になるため） | `page-view` | `/[HASHED:...]` |

### 未対応（既知の残課題）

なし。範囲外の経路（リクエストボディ、ヘッダ、GROWI から外へ出るリクエスト、HTTP 以外の instrumentation）は Boundary Context を参照。新しい名前のクエリパラメータで利用者データを受け取るエンドポイントが追加された場合、Q01 に名前を足すまで匿名化されない（design.md の Revalidation Triggers）。
