# Research & Design Decisions

## Summary

- **Feature**: `opentelemetry-anonymization`
- **Discovery Scope**: Extension（既存の `features/opentelemetry/server/anonymization/` を作り直す。外部依存の追加なし）
- **Key Findings**:
  - 既存の 4 handler は URL 文字列の部分一致で対象を選んでおり、3 つの URL が実在するルートと一致していなかった。また複数 handler が当てはまると最後の結果が前の結果を上書きしていた（途中に `_search` を含む URL でキーワードが平文に戻る）。
  - Next.js の画面内遷移は `/_next/data/<buildId>/<locale>/<ページパス>.json?<元のクエリ>&path=<区切り1>&path=<区切り2>…` を要求する。ページパスはパスとクエリの両方に入る。
  - トークンを URL に含むのはページ表示のルート（`/forgot-password/:token`、`/user-activation/:token`）だけで、apiv3 はトークンをリクエストボディで受け取る。

## Research Log

### 匿名化されていない経路の洗い出し

- **Context**: 要件 6（旧）の目的に対して、実際にどこまで匿名化されているか。
- **Sources Consulted**: `apps/app/src/server/routes/index.js`、`server/routes/apiv3/**`、`server/routes/*.js`、クライアントの呼び出し元（`states/page/use-fetch-current-page.ts`、`stores/*.tsx`、`states/search/keyword-manager.ts` ほか）。
- **Findings**:
  - 匿名化されていない主な経路: `GET /_api/v3/page?path=`（ページ表示ごと）、`/_next/data/...`（画面内遷移ごと）、`/_next/data/.../_search.json?q=`、`/_api/v3/page/exist?path=`、`/_api/tags.search?q=`、`/_api/v3/users?searchText=`、`/_api/v3/users/usernames?q=`、`/_api/v3/check-username?username=`、`/_api/v3/activity/suggestions?q=`、`/_api/v3/activity?searchFilter=`、`/_api/v3/user-groups/:id/unrelated-users?searchWord=`、`/_api/v3/user-groups/:id/users/:username`、`/_api/v3/page/exist-paths?fromPath=&toPath=`、`/_api/v3/page/non-user-related-groups-granted?path=`、`/_api/v3/page-listing/info?path=`、`/_api/pages.updatePost?path=`、`.` を含むページ名、`/trash/*`、`<ページパス>.md`、`/share/:linkId`、`/forgot-password/:token`、`/user-activation/:token`、`shareLinkId` クエリ。
  - 実在しないルートを指していた handler の URL: `/_api/v3/page/check-page-existence`（実際は `/page/exist`）、`/_api/v3/page/get-page-paths-with-descendant-count`（実際は `/page/page-paths-with-descendant-count`）、`/_api/v3/page-listing/ancestors-children`（該当ルートなし）。いずれもファイル名から URL を推測した誤りと見られる。
- **Implications**: URL ごとに handler を書く方式では、ルートの改名・追加に追随できない。宣言した一覧と、実在するルートとの照合を自動化する必要がある。

### Next.js の画面内遷移用データ URL

- **Context**: `/_next/data/...` のどこにページパスが入るか。
- **Sources Consulted**: `node_modules/next`（16.4.1）の `client/page-loader.js` `getDataHref`、`shared/lib/router/router.js`、`utils/interpolate-as.js`。実際に関数を呼んで出力を確認した。`next.config.ts` の i18n 設定（`config/next-i18next.config.mjs`、`AllLang`）。
- **Findings**:
  - 形式は `/_next/data/<buildId>/<locale>/<各区切りを encodeURIComponent したページパス>.json`。i18n が有効なため、`en_US` を含め locale の区切りが常に入る。
  - 動的ルートの値が `?path=<区切り>` として区切りごとに繰り返し付く。元のクエリ（`revisionId` など）はその前に残る。
  - トップページは `/_next/data/<buildId>/<locale>.json`（クエリなし）。末尾の `/` は取り除かれる。
  - 共有リンクは `/_next/data/<buildId>/<locale>/share/<linkId>.json?path=<linkId>`、検索は `/_next/data/<buildId>/<locale>/_search.json?q=...`。
- **Implications**: データ URL は「ページ表示の URL をラップしたもの」として扱える。中のページ URL に同じ規則を当て、外側を付け直せば、直接表示と同じハッシュ値になる（要件 6.3）。`path` クエリは全 URL 共通のクエリパラメータとして匿名化する。

### 静的ファイルの配信元

- **Context**: 既存の page access handler は `.` を含むパスをすべて静的ファイルとみなして除外しており、`.` を含むページ名が漏れていた。
- **Sources Consulted**: `server/crowi/express-init.js:102-112`、`apps/app/public/`（`favicon.ico`、`favicon.svg`、`images/`、`static/`）、`server/routes/index.js:95,208`。
- **Findings**: 静的ファイルの配信元は `/_next/`（`/_next/data/` を除く）、`/static/`、`/images/`、`/favicon.ico`、`/favicon.svg`、`/_drawio-assets/`、`/uploads/`（常に 403）、`/vault.git` に限られる。ルート直下に `robots.txt` などは無い。
- **Implications**: `.` による除外をやめ、上記の配信元だけを「そのまま残す」とする。将来ルート直下に静的ファイルが増えた場合は、ページパスとしてハッシュ化される（プライバシ上の害は無く、ファイル名が読めなくなるだけ）。

### 秘密の値が入る場所

- **Sources Consulted**: `server/routes/index.js:376-405`、`server/routes/apiv3/forgot-password.js`、`user-activation.ts`、`invited.ts`、`share-links.ts`、`page/get-page-by-share-link.ts`、`page/get-page-info.ts`、`features/comment/server/routes/list.ts`、`middlewares/certify-shared-page.js`。
- **Findings**: URL に入るのは `/share/:linkId`、`/forgot-password/:token`、`/user-activation/:token`、`DELETE /_api/v3/share-links/:id`、クエリ `shareLinkId`（`/_api/v3/page/shared`、`/page/info`、`/comments`、apiv1 の `certifySharedPage` 配下）。apiv3 のトークンはすべてリクエストボディ。共有ページの添付ファイルは Referer ヘッダで共有リンク ID を渡す（URL 属性ではないので範囲外）。
- **Implications**: 共有リンク ID は ObjectId で、作成時刻からある程度推測できる。ハッシュにすると総当たりで元の値を割り出せるため、値によらない固定の文字列（`[ANONYMIZED]`）に置き換える。

### ユーザー名に使える文字

- **Sources Consulted**: `server/middlewares/register-form-validator.ts:12`、`server/models/user/index.js:80`、`server/models/external-account.ts`。
- **Findings**: ローカル登録は `/^[\da-zA-Z\-_.]+$/` で `.` を許す。外部認証（LDAP・SAML・OIDC・GitHub・Google）経由のユーザー名には制約が無い。
- **Implications**: ユーザーページの判定で `.` を除外してはいけない。

### 一覧表と実在するルートの照合（要件 3.3）

- **Sources Consulted**: `apps/app/tools/snapshot-route-middleware.ts:60-233`（`walkStack`、`extractMountPrefix`、フル起動の手順）、`server/routes/apiv3/index.js:84-94,186-188`、`features/ai-usage/server/routes/apiv3/ai-usage.integ.ts:28-108`、`test/setup/crowi.ts`。Express 4.21.0。
- **Findings**:
  - `tools/snapshot-route-middleware.ts` は Crowi をフル起動して `app._router.stack` を辿り、登録済みのルートを列挙できている（MongoDB が必要）。CLI であり、テストではない。
  - apiv3 のメインルーター（`/page`、`/pages`、`/page-listing`）はテスト内で単独に組み立てた前例が無く、`app:installed` が偽だと組み立てられない。単独で組み立てられるかは未確認。
  - ステータスコードでの判定は使えない（一致しない apiv3 の GET は Next.js に流れて 200 や 302 を返す）。
  - パラメータを含むルート（`/:pageId/...`）に URL を当てると誤って一致することがあるため、ルートの型の文字列どうしを等しさで比べる。
- **Implications**: 照合テストは、ルートを列挙する処理を `tools/` と共有し、一覧表の各行に書いたルートの型が列挙結果に含まれるかを等しさで確かめる。apiv1・ページ表示のルートも対象にするため、フル起動の手順を第一候補とし、テスト環境で起動できない場合は apiv3 ルーターの単独組み立てに切り替える（最初のタスクで確かめる）。

### HTTP 以外の instrumentation

- **Sources Consulted**: `@opentelemetry/instrumentation-mongoose` 0.67.0 `build/src/mongoose.js`、`@opentelemetry/instrumentation-mongodb` 0.70.0 `build/src/instrumentation.js`、`node-sdk-configuration.ts:56-57`。
- **Findings**: Mongoose は `dbStatementSerializer` を設定したときだけ `db.statement` を記録する。GROWI は設定していない。MongoDB は `enhancedDatabaseReporting` が既定で無効で、クエリの値を記録しない。
- **Implications**: 現在の設定では DB の span からページパスなどは漏れない。これらの設定を変える場合は再確認が必要（Revalidation Triggers に記載）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| URL ごとの handler（現状） | handler ごとに `canHandle` / `handle` を実装し、配列順に評価する | 1 つの handler の変更が局所的 | URL 文字列の推測ミスが残る、結果が上書きされる、一覧が無い | 不採用 |
| パスの規則＋全 URL 共通のクエリパラメータ（採用） | パスは宣言した規則の最初に当てはまったもので変換し、クエリは決めた名前のパラメータをどの URL でも匿名化する。両者を独立に適用して最後につなぐ | 一覧表と 1 対 1、上書きが起きない、新しいエンドポイントが既知の名前のパラメータを使えば自動で匿名化される | 新しい名前のパラメータで利用者データを受け取るエンドポイントは、名前を足すまで漏れる | **採用** |
| エンドポイントごとのクエリ規則 | API ごとに匿名化するパラメータを並べる | 一覧表が API ごとに完全に対応する | 新しいエンドポイントは規則を足すまで漏れる。エンドポイント数だけ規則が増える | 不採用（例として一覧表に残す） |

## Design Decisions

### Decision: handler 群を宣言的な規則と 1 つの実行関数に置き換える

- **Context**: 4 つの handler が独自に URL を判定し、結果を `Object.assign` で重ねていた。
- **Alternatives Considered**:
  1. handler を残し、URL の誤りだけ直す。
  2. 規則を宣言し、実行関数が規則を受け取って適用する。
- **Selected Approach**: 2。パスの規則（順序付き、最初に当てはまったものを使う）と、全 URL 共通で匿名化するクエリパラメータ名の一覧を宣言する。実行関数はパスとクエリを分けて変換し、最後につなぐ。
- **Rationale**: 規則と一覧表が 1 対 1 で対応し、テストが規則を順に流すだけで網羅を確かめられる。パスとクエリを分けるので、ある変換が別の変換の結果を打ち消さない（要件 8）。
- **Trade-offs**: `AnonymizationModule` を使った拡張方法（旧 Extension Template）は廃止になる。
- **Follow-up**: `opentelemetry` spec の Extension Templates「新規 Anonymization Handler の追加」を本 spec への参照に置き換える（最終タスク）。

### Decision: クエリパラメータは名前で匿名化する

- **Context**: エンドポイントごとにパラメータを並べると、新しいエンドポイントのたびに規則の追加が要る。GROWI では `path`・`q` などの名前が多くのエンドポイントで同じ意味に使われている。
- **Selected Approach**: `q`、`nq`、`path`、`paths`、`fromPath`、`toPath`、`searchText`、`searchWord`、`username`、`shareLinkId`、`searchFilter` を、どの URL に付いていても `[ANONYMIZED]` に置き換える。
- **Rationale**: 新しいエンドポイントが既存の名前を使う限り、規則の追加なしで匿名化される。途中に `_search` を含むページ URL の `q` のような、どの規則も想定していない組み合わせも匿名化される。
- **Trade-offs**: 利用者データでない `q` や `path` も匿名化される（トレースの読みやすさが少し落ちるだけで、害は無い）。新しい名前のパラメータは名前を足すまで漏れる（Revalidation Triggers に記載）。要件 2.5 を「パス部分を書き換えない」に改めた。
- **Follow-up**: 一覧表の各 API 行は、この名前の一覧が実際にそのエンドポイントを覆っていることを示す例として残す。

### Decision: 置き換えたパラメータ以外のクエリを再エンコードしない

- **Context**: 既存の `anonymizeQueryParams` は `URLSearchParams` でクエリ全体を組み立て直しており、同じ名前のパラメータが 1 つにまとまり、ほかのパラメータも再エンコードされていた（`tags[]` が `tags%5B%5D` になる、空白が `+` になる）。
- **Selected Approach**: クエリを `&` で区切り、対象の名前（`name` または `name[]`）の値だけを `%5BANONYMIZED%5D` に置き換える。ほかの区切りは元の文字列のまま残す。値が JSON 配列なら従来どおり `%5B%22%5BANONYMIZED%5D%22%5D`（`["[ANONYMIZED]"]`）にする。
- **Rationale**: 置き換え後の値の形（`[ANONYMIZED]`）は変えずに、無関係な部分を変えない。
- **Trade-offs**: 変更前に API の URL で再エンコードされていたほかのパラメータは、元の形のまま記録されるようになる（値の匿名化には影響しない）。

### Decision: 秘密の値はハッシュにしない

- **Selected Approach**: 共有リンク ID・トークンは `[ANONYMIZED]` に置き換える。
- **Rationale**: ObjectId は推測可能で、ハッシュからでも総当たりで割り出せる（要件 7.3）。

### Decision: 匿名化の処理が失敗したら、URL を残さない

- **Context**: 既存の handler は例外時に `null` を返し、元の URL がそのまま記録されていた。
- **Selected Approach**: 実行関数が想定外の例外を捕まえたときは、`http.target` を固定の `/[ANONYMIZATION_FAILED]` にし、警告を記録する。
- **Rationale**: best-effort であっても、失敗時に平文を送らない方が要件 2.4 の目的に合う。

### Decision: 一覧表は requirements.md に置き、テストで規則と突き合わせる

- **Selected Approach**: 一覧表（行 ID・URL の例・データの種類と場所・規則・置換後の形）は `requirements.md` の「匿名化対象一覧」に置く。コード側の例（coverage examples）は同じ行 ID を持つ。単体テストが `requirements.md` から行 ID の列だけを読み取り、コードの例と集合として一致するかを確かめる。
- **Trade-offs**: アプリのテストが spec のファイルの場所に依存する。`/kiro-spec-cleanup` や将来の spec 整理で表の場所・形が変わるとテストが失敗する（それ自体が「一覧表とコードがずれた」ことの検出になる）。ファイルの場所は 1 つの定数にまとめる。

### Decision: ルートの列挙は `tools/` と共有する

- **Selected Approach**: `tools/snapshot-route-middleware.ts` の `walkStack` / `extractMountPrefix` を `src/test-utils/express-route-walker.ts` に移し、ツールとテストの両方から使う。
- **Rationale**: 3 つ目の walker を作らない。

## Synthesis Outcomes

- **Generalization**: 画面内遷移用データ URL は「ページ表示の URL を包んだもの」として、同じパスの規則を中のパスに当てる。直接表示とデータ URL の規則を二重に持たない。
- **Build vs. Adopt**: ルートの型（`/:id`）の照合に `path-to-regexp` を直接使うことも考えたが、`apps/app` の直接の依存ではなく、規則で使う型は「`:name` が 1 区切りに一致する」だけで足りるため、小さな照合関数を作る。
- **Simplification**: `AnonymizationModule` インターフェースと handler 4 つを廃止する。`handle()` が受け取っていた `IncomingMessage` は、URL 属性の組み立て（PR #12151 の `buildUrlAttributes`）以外では使われていなかった。

## Risks & Mitigations

- 一覧表と実在するルートの照合テストがテスト環境で動かない — 最初のタスクで起動方法を確かめ、だめなら apiv3 ルーターの単独組み立てに切り替える。
- 新しい名前のパラメータで利用者データを受け取るエンドポイントが追加される — Revalidation Triggers に記載し、ルートを追加する開発者が一覧表を確認する手順を `opentelemetry` spec からも参照できるようにする。
- 変更前に匿名化されていた URL が、変更後に平文で出る — 変更前の handler と新しい規則に同じ URL の集合（70 件以上）を流して比べ、「変更前に匿名化されていて変更後に平文」が 0 件であることを実装のタスクで確かめる。
- PR #12151（URL 属性への反映）が未マージ — 本 spec の実装は #12151 のマージ後に、その上で行う。

## References

- PR #12123 / issue #11688 — 非 ASCII のページパスの匿名化
- PR #12151 — `http.url` などへの匿名化した値の反映
- `.kiro/specs/opentelemetry/` — 匿名化を切り出す元の spec
