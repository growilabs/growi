# Research & Design Decisions

## Gap Analysis（2026-11-13）

### 前提の状態

- 候補 API は `field=endpoint` に対応している（`AUDITLOG_SUGGESTION_FIELDS`、`search-auditlog-suggestions.ts` の MongoDB フォールバック、`endpoint_1` インデックスの migration）。本 spec はこれを前提とし、変更しない。
- ES の監査ログのインデックスには `username` と `endpoint` が入っている（`mappings-auditlog-properties.ts`）。`ip` は入っておらず、本 spec の範囲外。

### 現状の資産

| 領域 | ファイル | 現状 |
|---|---|---|
| 画面 | `client/components/Admin/AuditLogManagement.tsx`（363 行） | フィルター行に `AuditLogUsernameTypeahead`・`DateRangePicker`・`SelectActionDropdown`・リセット・エクスポートを並べる。選択状態は `useState`、リセットは `typeaheadRef.current?.clear()` |
| ユーザー名の入力欄 | `client/components/UsernameTypeahead/UsernameTypeahead.tsx`（242 行） | `react-bootstrap-typeahead` の `AsyncTypeahead`（`multiple`、`delay=400`、自由入力なし）。候補の取得元は `useUsernameSuggestions` として注入する。Active / Inactive を見出し付きで出す `renderMenu`、古い応答を隠す `filterBy` を持つ |
| ユーザー名の入力欄の利用箇所 | `AuditLogUsernameTypeahead`（監査ログ画面・エクスポートのモーダル）、`SearchUsernameTypeahead`（全文検索ページ） | 共有コンポーネント。全文検索ページも使っている |
| 候補の取得 | `stores/activity.ts` の `useSWRxAuditlogSuggestions(field, q, limit = 5)` | field を 1 つ指定して `GET /activity/suggestions` を呼ぶ。q が空なら呼ばない |
| 候補の取得失敗 | `username-suggestions.ts` の `toUsernameSuggestions` | エラー時は読み込み中の表示を止めるだけで、失敗したことは画面に出ない |
| 一覧の絞り込み条件（画面側） | `client/components/Admin/AuditLog/build-search-filter.ts` | `ISearchFilter`（`usernames` / `dates` / `actions`）を組み立てる純粋関数 |
| 一覧の絞り込み条件（サーバー側） | `routes/apiv3/fetch-activity-list.ts`（`resolveActivityListWhere`）、`routes/apiv3/build-activity-list-where.ts`（`buildActivityListWhere`） | `ISearchFilter` を Prisma の `where` に変換する純粋関数。username は `snapshot.is.username.in` |
| 一覧の API | `routes/apiv3/activity.ts` | `GET /activity`（クエリの `searchFilter`）と `POST /activity/list`（本文の `searchFilter`）の 2 経路が上の関数を共有する |
| 一覧の URL 列 | `client/components/Admin/AuditLog/ActivityTableRow.tsx` | URL の表示とコピーボタン（`react-copy-to-clipboard`）が既にある |
| 多言語 | `public/static/locales/{en_US,fr_FR,ja_JP,ko_KR,zh_CN}/admin.json` | `audit_log_management.*` に監査ログ画面の文言がある |

### 要件ごとのギャップ

| 要件 | 必要なもの | ギャップ |
|---|---|---|
| 1. URL を候補から選んで絞り込む | URL の候補の取得、選択済みの値の表示、一覧への反映 | 候補の取得は `useSWRxAuditlogSuggestions('endpoint', q)` で足りる。**Missing**: URL を選ぶ入力欄、`ISearchFilter` の endpoint 条件 |
| 2. URL の一致の仕方 | パス部分の完全一致（`?` 以降は無視）、大文字小文字の区別 | **Missing**: `buildActivityListWhere` の endpoint 条件。保存値は `?` 以降を含むので、「値が一致」または「値が `<パス>?` で始まる」の OR になる。`endpoint_1` インデックスで前方一致を絞れる見込み（**Research Needed**: Prisma の `startsWith` が MongoDB でどんな `$regex` になり、インデックスが効くか） |
| 3. 1 つの検索欄 | 「絞り込みを選択」、種類ごとの見出し付きの候補、種類の違う値を選択済みとして並べる | **Missing**: 種類の違う候補を混ぜて扱う入力欄。今の `UsernameTypeahead` はユーザー名専用で、全文検索ページとも共有している |
| 4. 取得失敗の表示 | 失敗の検知と表示 | **Missing**: 失敗の表示。今は失敗を画面に出していない。候補 API は field を複数指定すると 1 つの失敗で全体が 500 になる（`search-auditlog-suggestions.ts` の `Promise.all`） |
| 5. 既存の操作との整合 | 1 ページ目に戻す、AND 条件、リセット | 既存の仕組み（`setActivePageNumber(1)`、`clearButtonPushedHandler`、`where` の各条件の AND）を延ばせば足りる |
| 6. 多言語 | 5 ロケールの文言 | 既存の `admin.json` に追加する |
| 関連文書の修正 | `activity-log-snapshot/design.md` の依存先の説明の修正 | 文書のみ。コードの変更なし |

### 制約

- **共有コンポーネント**: `UsernameTypeahead` は全文検索ページ（`SearchUsernameTypeahead`）も使う。監査ログ用に作り直す変更が、全文検索ページの動きを変えてはいけない。
- **エクスポートのモーダル**: ユーザー名の欄は `AuditLogUsernameTypeahead` を使い続ける（範囲外）。監査ログ画面から `AuditLogUsernameTypeahead` を外しても、モーダル側では残す。URL は一覧から引き継いだ値の表示と解除だけを足す。
- **一覧の API の 2 経路**: `GET /activity` と `POST /activity/list` の両方で、endpoint 条件が文字列の配列であることを検証する必要がある（NoSQL injection の対策）。検証の置き場所は設計で決める。
- **失敗の扱い**: 候補 API は複数 field を 1 回で受け付け、1 つでも例外になれば 500 を返す。ただし field ごとの検索は、全文検索サーバーとデータベースのどちらでも失敗したときに空の候補を返すので、例外になるのはデータベース自体が止まっている場合などに限られる。失敗をどの単位で表示するかは設計で決める。

### 実装の選択肢

#### 選択肢 A: 既存を拡張する

- `UsernameTypeahead` に、URL の候補と「絞り込みを選択」を足して汎用化する。
- ✅ 新しいファイルが少ない。
- ❌ 全文検索ページと共有しているので、監査ログ固有の機能（URL、種類の切り替え）が全文検索ページにも入り込む。242 行のコンポーネントが、さらに複雑になる。

#### 選択肢 B: 監査ログ用の検索欄を新しく作る

- 監査ログ画面用の検索欄（例: `AuditLogSearchTypeahead`）を新しく作る。ユーザー名と URL の候補を 1 つの候補一覧にまとめ、「絞り込みを選択」を持つ。
- 再利用するもの: `UsernameTypeahead` の Active / Inactive の見出しの出し方、古い応答を隠す `filterBy` の判定（`shouldShowUsernameSuggestion`）、`useSWRxAuditlogSuggestions`。
- ✅ 全文検索ページとエクスポートのモーダルに影響しない。
- ❌ 見出し付きの候補一覧や選択済みの値の扱いを、もう一度書くことになる。共通にできる部分の切り出しが必要。

#### 選択肢 C: 組み合わせ（推奨候補）

- 画面: B と同じく、監査ログ用の検索欄を新しく作る。`UsernameTypeahead` から純粋なロジック（見出しの分類、古い応答の判定）だけを切り出して共有する。
- 候補の取得: 検索対象の field をまとめて、候補 API を 1 回呼ぶ。`limit` は field ごとに効くので、種類ごとの件数の上限もそのまま決まる。
- 一覧の絞り込み: `ISearchFilter` に endpoint の配列を足し、`build-search-filter.ts` → validator → `resolveActivityListWhere` → `buildActivityListWhere` の順に延ばす。
- ✅ 候補 API を変えずに済む。既存の純粋関数の形にそろう。
- ❌ `useSWRxAuditlogSuggestions` が field を 1 つしか受け取らないので、配列を受け取れるようにする必要がある。

### 調べる必要があること（Research Needed）

- Prisma の MongoDB での `startsWith` の変換結果（エスケープ、`endpoint_1` インデックスが効くか）。パス部分の完全一致を `equals` ＋ `startsWith('<パス>?')` の OR で書いたときのクエリ計画。
- `react-bootstrap-typeahead` で、種類の違うオプションを 1 つの候補一覧に混ぜ、選択済みの値を種類ごとに見分けて表示する方法（`labelKey`、`renderToken`、`renderMenu`）。
- 選択済みの値を種類ごとに持ちつつ、`IClearable` によるリセットとどう組み合わせるか。

### 規模とリスク

- **規模: M（3〜7 日）**。サーバー側（一覧の絞り込み）は既存の純粋関数を延ばすだけで小さい。画面側の 1 つにまとめた検索欄が大半を占める。
- **リスク: 中**。新しい UI のパターン（種類の違う候補を 1 つの欄で扱う）を作る。全文検索ページと共有しているコンポーネントへの影響を避ける必要がある。

### 設計フェーズへの推奨

- 選択肢 C を軸に検討する。
- 決めること:
  - 候補の取得の失敗を、種類ごとに表示するか、1 つの表示にするか
  - 「すべて」のときの種類ごとの件数
  - 一覧の API の `ISearchFilter` に足す項目名

---

## Design Discovery（2026-11-13）

### Summary
- **Feature**: `auditlog-endpoint-search`
- **Discovery Scope**: Extension（既存の監査ログ画面・一覧 API への追加）
- **Key Findings**:
  - Prisma 6.19 の MongoDB コネクタは `findMany` の条件を `$expr` の集約に変換する。`startsWith` は `$regexMatch` になり、**値の正規表現記号をエスケープしない**。
  - 今の一覧の絞り込み（username・action）も含め、Prisma 経由の一覧クエリは `COLLSCAN` で実行されている。endpoint の条件を足しても、走査の種類は変わらない。
  - 候補 API の field ごとの検索は失敗しても空の候補を返すので、片方の種類だけがリクエストの失敗になる場面はほぼない。候補は 1 回のリクエストで取得し、失敗は 1 つの表示にできる。

## Research Log

### Prisma の `startsWith` が MongoDB でどう実行されるか
- **Context**: 一覧の絞り込みを「パス部分の完全一致」にするには、保存値が `<パス>` と等しいか、`<パス>?` で始まるかを判定する必要がある。
- **Sources Consulted**: 一時的な integ テストで `prisma.activities.findMany` を実行し、MongoDB のプロファイラ（`profile: 2`）で実際に送られたコマンドと実行計画を記録した（テストは確認後に削除）。
- **Findings**:
  - `{ endpoint: { in: [...] } }` は `$expr` の `$eq` の `$or`、`{ endpoint: { startsWith: s } }` は `$expr` の `$regexMatch: { regex: "^" + s }` になる。
  - `s` はエスケープされない。`(` を含む値でクエリ自体が失敗した（`Invalid Regex in $regexMatch: missing closing parenthesis`）。`?` も量指定子として解釈され、`startsWith('/_api/v3/page?')` は `/_api/v3/pag` で始まる値にも一致する。
  - `escapeStringForMongoRegex(パス) + '\\?'` を渡すと期待どおりに一致した（`/_api/v3/page` と `/_api/v3/page?x=1` に一致し、`/_api/v3/pages` には一致しない。`(` を含むパスも一致した）。
  - 実行計画は、endpoint の条件の有無にかかわらず `COLLSCAN`。`$expr` で包まれるため、`endpoint_1` インデックスは使われない。
- **Implications**:
  - `startsWith` に渡す値は、呼び出し側で `escapeStringForMongoRegex` でエスケープする（`.claude/rules/mongodb-regex.md` の対象）。Prisma が将来エスケープするようになると二重エスケープで一致しなくなるので、この振る舞いを integ テストで固定する。
  - 一覧の絞り込みの性能は、今と同じ水準（全件走査＋ページング）にとどまる。インデックスを効かせるには `aggregateRaw` などへの書き換えが必要だが、一覧の既存の仕組みを変えることになるため、本 spec では行わない。

### `react-bootstrap-typeahead` 6.3 で種類の違う候補を扱う
- **Context**: ユーザーと URL の候補を 1 つの入力欄で扱う（要件 3）。
- **Findings**:
  - オプションは任意のオブジェクトでよく、`labelKey` を関数にすれば種類ごとに表示を変えられる。`renderMenu` で `Menu.Header` を使った見出し付きの一覧は、既存の `UsernameTypeahead` が既に使っている。`renderToken` で選択済みの値（トークン）の見た目を変えられる。
  - 既存の `UsernameTypeahead` は全文検索ページとも共有しているので、監査ログ用の変更を入れると全文検索ページに影響する。
- **Implications**: 監査ログ用の検索欄は新しいコンポーネントとして作り、同じライブラリの同じ API を使う。新しい依存は増えない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|---|---|---|---|
| 既存の `UsernameTypeahead` を汎用化 | URL と種類の切り替えを足す | ファイルが少ない | 全文検索ページに監査ログ固有の機能が入り込む |
| 監査ログ用の検索欄を新設（採用） | 候補の組み立てを純粋関数に切り出し、コンポーネントは薄くする | 全文検索ページとエクスポートのモーダルに影響しない | 見出し付きの候補一覧を新しく書く |

## Design Decisions

### Decision: 候補は 1 回のリクエストで取得し、失敗は種類ごとに分けない
- **Context**: 要件 3.3〜3.5 と 4.1。「すべて」ではユーザーと URL の候補を同時に出す。
- **Alternatives Considered**:
  1. field ごとに `useSWRxAuditlogSuggestions` を呼び、失敗を種類ごとに表示する — 片方の種類だけが失敗する場面のための仕組みになる。
  2. 対象の field をまとめて 1 回のリクエストで取得し、失敗は 1 つの表示にする。
- **Selected Approach**: 2。`useSWRxAuditlogSuggestions` に field の配列を受け取る形を足す。
- **Rationale**: 候補 API の field ごとの検索は、全文検索サーバーとデータベースのどちらでも失敗したときに空の候補を返す（`search-auditlog-suggestions.ts`）。リクエストが失敗するのは、通信の失敗・ログイン切れ・データベース自体の停止など、どの種類にも同じように起きる場合に限られる（`q` は送る前に上限の長さに切るので、上限超えの 400 は起きない）。種類ごとに失敗を見分けても、表示が変わる場面がほぼない。
- **Trade-offs**: field ごとの検索が将来、失敗時に例外を投げるようになると、「すべて」では片方の失敗で両方の候補が出なくなる（design.md の Revalidation Triggers に記載）。

### Decision: 「取得できなかった」の表示は、候補のリクエスト自体の失敗に限る
- **Context**: 要件 4。候補 API は、全文検索サーバーが使えずデータベースでの検索も失敗したとき（時間切れなど）、warn ログを出して空の候補を 200 で返す（候補 API の契約）。画面からは「該当なし」と区別できない。
- **Alternatives Considered**:
  1. 要件 4 の対象をリクエスト自体の失敗に限り、データベースでの検索の失敗は既知の制約とする。
  2. 候補 API が field ごとに失敗を示す印を返すようにする — 要件 4 の目的を完全に満たすが、候補 API の契約を変え、本 spec の範囲を越える。
- **Selected Approach**: 1。要件 4 を「候補の取得要求が失敗した」場合に限る形に書き換え、データベースでの検索の失敗は Boundary Context に既知の制約として書く。
- **Rationale**: 候補 API の失敗時の振る舞いは、失敗と 0 件を区別しないことを受け入れたうえで決まっている。画面側だけで区別する手段はない。

### Decision: `searchFilter` の型の検証は `buildActivityListWhere` の 1 か所で行う
- **Context**: 要件 1.3 と、一覧 API の 2 経路（GET はクエリの JSON 文字列、POST は本文のオブジェクト）。
- **Selected Approach**: validator は足さず、`buildActivityListWhere` で `Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string')` を満たすときだけ条件を付ける。同じ関数の既存の `usernames` の判定も同じ形に直す（今は `"abc"` のような文字列が来ると `.every` がなく TypeError になる）。
- **Rationale**: GET と POST はどちらも `resolveActivityListWhere` → `buildActivityListWhere` を通る。GET の `searchFilter` は validator の時点では JSON 文字列で、中身を検証するには route で一度パースしてから検証する必要がある。型の判定を両経路が必ず通る純粋関数に置けば、1 か所で済み、単体テストで固定できる。

### Decision: パス部分の完全一致は `in` と、エスケープした `startsWith` の OR で表す
- **Context**: 要件 2.1〜2.4。
- **Alternatives Considered**:
  1. `aggregateRaw` / `findRaw` で `$regex` を直接書く — インデックスを使えるが、一覧の取得の仕組みを Prisma の `findMany` から書き換えることになる。
  2. 保存時に `?` 以降を除いたパスを別フィールドに持つ — データモデルの変更と既存データの移行が必要。
  3. `in` と、`escapeStringForMongoRegex` でエスケープした `startsWith('<パス>\\?')` の OR — 既存の `where` の組み立てに収まる。
- **Selected Approach**: 3。
- **Trade-offs**: Prisma がエスケープしないという振る舞いに依存する。integ テストで固定する。性能は今の一覧と同じ水準。

### Decision: 「すべて」のときの候補は種類ごとに 5 件まで
- **Context**: 要件 3.5。
- **Selected Approach**: リクエストの `limit` を 5 にする（`useSWRxAuditlogSuggestions` の既定値と同じ）。種類を 1 つに絞ったときも同じ 5 件にして、定数を 1 つにする。
- **Rationale**: 候補 API は `limit` を field ごとに適用するので、1 回のリクエストでも件数の上限がそのまま種類ごとの上限になる。一方の種類が他方を押し出すことはない。

### Decision: 古い候補は `filterBy` で除き、失敗のグループは `renderMenu` で出し分ける
- **Context**: 要件 1.1, 1.5, 4.1。`react-bootstrap-typeahead` 6.3.2 は、キーボード操作をメニューに描いた内容ではなく `filterBy` を通した結果で処理する。
  - Tab や → で確定する候補（`initialItem`）を更新するのは、実際に描かれた先頭（`position === 0`）の `MenuItem` だけ（`es/behaviors/item.js`）。
  - `initialItem` が消えるのは、`filterBy` を通した結果が 0 件のときだけ（`es/core/TypeaheadManager.js`）。
  - 入力補完のヒントは `initialItem` から作られ、`multiple` でも出る。ヒントがあれば Tab か →（カーソルが入力の末尾にあるとき）で `onAdd(initialItem)` が呼ばれる（`es/utils/defaultSelectHint.js`）。
  - Enter で確定するのは矢印キーで選んだ `activeItem` で、矢印キーで移動できるのは実際に描かれた `MenuItem` だけなので、描かれていない候補は Enter では確定されない。
- **Alternatives Considered**:
  1. `filterBy` はすべて通し、古い候補と選択済みの値は `renderMenu` の中だけで除く — 古い候補が `filterBy` の結果に残るので `initialItem` が消えず、メニューに出ていない古い候補を Tab で確定できてしまう。
  2. 候補ごとの除外は `filterBy`、失敗のグループの出し分けは `renderMenu` で行い、どちらも同じ判定（`isFreshForText`）を使う。
- **Selected Approach**: 2。既存の `UsernameTypeahead`（`filterBy` で `shouldShowUsernameSuggestion` を使う）と同じ形。
- **Rationale**: 失敗は候補ではないので `filterBy` を通らず、`renderMenu` で出し分けるしかない。判定を 1 つの純粋関数にまとめれば、2 か所で判定がずれない。

### Decision: 送る q は、検索文字列（`?` 以降と前後の空白を除いた入力）の先頭 100 文字 1 つにする
- **Context**: 要件 1.6、1.7。候補 API の validator は `q` を `isLength({ max: 100 })` で検証し、超えると 400 を返す。一覧の URL 列からコピーした値はクエリ文字列を含み、100 文字を超えることがある。
- **Selected Approach**: `toSuggestionQuery` が、入力の最初の `?` 以降を除き、前後の空白を除いて検索文字列を作る。2 文字未満なら空にし、それ以外は先頭 `AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH` 文字に切る。q は 1 つで、ユーザーと URL のどちらの候補の検索にも使う。上限は `interfaces/activity.ts` の定数として持ち、候補 API の validator と画面の両方が使う。
- **Rationale**:
  - 検索文字列全体に前方一致する endpoint は、その先頭 100 文字にも前方一致するので、先頭 100 文字で検索しても目的の endpoint は検索結果から漏れない。
  - `?` 以降を画面で除くので、クエリ文字列が長くてもパス部分全体で検索できる。候補 API が q の `?` 以降をどう扱うかに依存しない。
  - ユーザーと URL で同じ q を使うので、1 回のリクエストにまとめる Decision（q は 1 つ）と両立する。
  - 2 文字未満の判定も `?` を除いた後の長さで行うので、判定の対象と送る q が一致する。
- **Trade-offs**: 古さの判定も `toSuggestionQuery` で正規化した値どうしで比べる必要がある。生の入力で比べると、101 文字以上の入力やクエリ文字列を含む入力では取得に使った q と一致せず、候補が常に古いと判定される。ユーザー名を検索するときも `?` 以降は使われない。

### Decision: 2 文字未満の入力は、検索対象にかかわらず画面で止める
- **Context**: 要件 1.6。候補 API のデータベースでの検索は、field ごとに最小文字数（`AUDITLOG_SUGGESTION_FIELD_SPECS` の `fallbackMinQueryLength`。username は 2、endpoint は 1）を持ち、全文検索サーバーには最小文字数がない。そのため 1 文字の入力では、全文検索サーバーの稼働状況と種類によって候補が出たり出なかったりする。
- **Selected Approach**: 画面の `AUDITLOG_SEARCH_MIN_QUERY_LENGTH = 2` で、検索文字列が 2 文字未満ならリクエストしない（`toSuggestionQuery` が空を返す）。
- **Rationale**: サーバーの `fallbackMinQueryLength` は field ごとに値が違う、サーバー内のデータベースでの検索だけの設定で、画面からは参照しない。要件は種類にかかわらず同じ長さで止めることを求めるので、画面に 1 つの定数として持つ。値は username の最小文字数と同じにし、全文検索サーバーが止まっていても 2 文字以上ならどちらの種類も検索される。

### Decision: 一致なしの表示は、候補 API が返した件数で決める
- **Context**: 要件 4.3。`renderMenu` が受け取る結果は `filterBy` を通した後で、古い候補と選択済みの値が除かれている。
- **Alternatives Considered**:
  1. `filterBy` を通した後の件数が 0 なら一致なしを出す
  2. 候補 API が返した件数（`SearchSuggestionsResult.options.length`）が 0 で、結果が新しく、取得待ちでも失敗でもなく、送る q が空でないときだけ一致なしを出す
- **Selected Approach**: 2。`buildSuggestionGroups` が `state: 'empty'` のグループを返し、`renderMenu` が失敗の表示と同じく選べない `Menu` の子として本機能の文言で描く。
- **Rationale**: 1 では、返った候補がすべて選択済みのときや、取得待ちで古い候補が除かれたときにも一致なしが出る。要件 4.3 は、候補 API が 0 件を返した場合に限る。空の `Menu` に頼るとライブラリの既定の英語の文言（"No matches found."）が出るので、自前のグループとして描く。

### Decision: エクスポートの endpoint の条件は、一覧と同じ関数で組み立てる
- **Context**: 要件 7.3、7.4。エクスポートのジョブは `features/audit-log-bulk-export` にあり、一覧の `where` の組み立ては `server/routes/apiv3` にある。
- **Selected Approach**:
  - パス部分の完全一致の条件を `buildEndpointWhere` として `server/service/activity` に置き、一覧の `buildActivityListWhere` とジョブの `exportAuditLogsToFsAsync` の両方が使う。
  - ジョブの `filters` のスキーマに `endpoints: [String]` を足す。
  - 重複判定の `canonicalizeFilters` には、`endpoints` が空でないときだけ並べ替えた配列を足す。
- **Rationale**:
  - 一致の仕方とエスケープを 1 か所に置けば、一覧とエクスポートで出る記録がずれない。
  - `features/` から `server/routes/apiv3/` のロジックを読み込むとルートの層に依存するので、どちらにも属さない activity のサービスに置く。
  - ジョブの `filters` は型付きのサブドキュメントで、スキーマにない項目は保存時に黙って捨てられるため、スキーマへの追加が必須。
  - endpoint が空のときに項目を足さなければ、URL を含まないエクスポートのハッシュは今と同じになり、進行中のジョブとの重複判定も変わらない。

### Decision: デコード済みの形の入力は変換しない
- **Context**: 記録された endpoint は `req.originalUrl` で、パーセントエンコードされた形。デコード済みの形（`/日本語ページ` など）で入力すると前方一致しない。
- **Alternatives Considered**:
  1. 変換せず、既知の制約とする
  2. 送る前に ASCII 以外の文字だけをパーセントエンコードする
- **Selected Approach**: 1。
- **Rationale**: ページの URL を endpoint として記録するのは、ページの表示の記録（`pages/utils/activity.ts`。アクションは `PAGE_VIEW` / `PAGE_USER_HOME_VIEW` / `PAGE_NOT_FOUND` / `PAGE_FORBIDDEN` / `PAGE_NOT_CREATABLE`）で、これらは Small / Medium / Large のどの記録グループにも入っておらず、`AUDIT_LOG_ADDITIONAL_ACTIONS` で足したときだけ記録される。既定で記録される API のパスで日本語が入るのは主にクエリ文字列で、候補はクエリ文字列を除いて検索する。一覧の URL 列のコピーボタンは記録された形をそのままコピーする。
- **Follow-up**: ページの表示を記録する運用での要望が出たら、2 を要件として足す。2 では先頭 100 文字の切り出しをエンコードした後の長さで行う（日本語 1 文字が 9 文字になる）。

### Decision: `activity-log-snapshot` の design.md は本 spec で直し、amend spec にしない
- **Context**: `activity-log-snapshot/design.md` の Allowed Dependencies にある `findSnapshotUsernamesByUsernameRegex` の説明が、候補の検索の変更（呼び出し元と最小文字数の判定の位置）に追随していない。
- **Selected Approach**: 本 spec のタスクとして、その段落を依存先として今成り立っている事実だけに縮める。
- **Rationale**: この関数は `activity-log-snapshot` が所有するものではなく、依存先として記述しているだけなので、直しても同 spec の契約は変わらない。`.claude/rules/spec-lifecycle.md` の amend spec は、完了済み spec の契約を変える変更が対象。段落にある変更の経緯の記述は、同ルールの「本文に経緯を残さない」に合わせて削る。

### Synthesis
- **Generalization**: 「検索対象の種類」をデータ（`AUDITLOG_SEARCH_SCOPES` の表）で持ち、種類ごとの取得・見出し・トークンの表示をその表から引く。IP を後で足すときは、表に 1 行足して候補の取得を足すだけで済む。ただし、実装するのは今回の要件のユーザーと URL だけにする。
- **Build vs. Adopt**: 入力欄は既存の `react-bootstrap-typeahead` を使う。新しい依存はない。
- **Simplification**: 候補 API とサーバー側の候補の検索は変えない。エクスポートのモーダルのユーザー名の欄は既存の `AuditLogUsernameTypeahead` のまま残し、URL は一覧から引き継いだ値の表示と解除だけにする。

## Risks & Mitigations
- Prisma のバージョンアップで `startsWith` がエスケープするようになり、二重エスケープで一致しなくなる — 正規表現の記号を含むパスと `/_api/v3/pages` の除外を確かめる integ テストで検知する。
- 一覧のクエリが全件走査のまま — 今の username・action の絞り込みと同じ水準。activities は既定で 30 日で消える。改善は本 spec の範囲外。
- `react-bootstrap-typeahead` 6.3.2 は、候補一覧を開くかを `isShown`（`open` / `minLength` / `showMenu` / `text`）だけで決め、結果の件数は見ない。フィルタ後の結果が 0 件でも `renderMenu` は呼ばれる — `renderMenu` が結果が空のときに早期 return すると、失敗表示（要件 4.1）が消える。一方で、空の `Menu` を描くと、`Menu` が `emptyLabel` を描き（`es/components/Menu/Menu.js`）、`AsyncTypeahead` がそれを状況に応じて "Type to search..." / "Searching..." / "No matches found." に差し替える（`es/behaviors/async.js` の `getEmptyLabel`）。そのため、空を返すかどうかは `buildSuggestionGroups` の戻り値で決める（失敗のグループか一致なしのグループがあれば描き、何もなければ空のフラグメントを返す）。`emptyLabel` などに空文字を渡すと中身のない無効な項目が残るので使わない。コンポーネントテストで固定する。
