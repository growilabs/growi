# Research & Design Decisions

## Gap Analysis（2026-11-13）

### 前提の状態

- 候補 API の endpoint 対応（`field=endpoint`、`AUDITLOG_SUGGESTION_FIELDS` への追加、MongoDB フォールバック、`endpoint_1` インデックスの migration）は PR #12119 で入る。spec のブランチ（ベース: `feat/179911-url-fuzzy-search`）にはまだ含まれていない。実装は PR #12119 のマージ後になる。
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
| 1. URL を候補から選んで絞り込む | URL の候補の取得、選択済みの値の表示、一覧への反映 | 候補の取得は `useSWRxAuditlogSuggestions('endpoint', q)` で足りる（PR #12119 後）。**Missing**: URL を選ぶ入力欄、`ISearchFilter` の endpoint 条件 |
| 2. URL の一致の仕方 | パス部分の完全一致（`?` 以降は無視）、大文字小文字の区別 | **Missing**: `buildActivityListWhere` の endpoint 条件。保存値は `?` 以降を含むので、「値が一致」または「値が `<パス>?` で始まる」の OR になる。`endpoint_1` インデックスで前方一致を絞れる見込み（**Research Needed**: Prisma の `startsWith` が MongoDB でどんな `$regex` になり、インデックスが効くか） |
| 3. 1 つの検索欄 | 「絞り込みを選択」、種類ごとの見出し付きの候補、種類の違う値を選択済みとして並べる | **Missing**: 種類の違う候補を混ぜて扱う入力欄。今の `UsernameTypeahead` はユーザー名専用で、全文検索ページとも共有している |
| 4. 取得失敗の表示 | 種類ごとの失敗の検知と表示 | **Missing**: 失敗の表示。今は失敗を画面に出していない。候補 API は field を複数指定すると 1 つの失敗で全体が 500 になる（PR #12119 で `Promise.all` に戻した） |
| 5. 既存の操作との整合 | 1 ページ目に戻す、AND 条件、リセット | 既存の仕組み（`setActivePageNumber(1)`、`clearButtonPushedHandler`、`where` の各条件の AND）を延ばせば足りる |
| 6. 多言語 | 5 ロケールの文言 | 既存の `admin.json` に追加する |
| Amend target | `activity-log-snapshot/design.md` の段落の書き直し | 文書のみ。コードの変更なし |

### 制約

- **共有コンポーネント**: `UsernameTypeahead` は全文検索ページ（`SearchUsernameTypeahead`）も使う。監査ログ用に作り直す変更が、全文検索ページの動きを変えてはいけない。
- **エクスポートのモーダル**: `AuditLogUsernameTypeahead` を使い続ける（範囲外）。監査ログ画面から `AuditLogUsernameTypeahead` を外しても、モーダル側では残す。
- **一覧の API の 2 経路**: `GET /activity` と `POST /activity/list` の両方で、endpoint 条件が文字列の配列であることを検証する必要がある（NoSQL injection の対策）。検証の置き場所は設計で決める。
- **部分失敗**: 候補 API は複数 field の部分失敗を扱わない（1 つでも失敗したら 500）。種類ごとに失敗を見分けるには、この契約との関係を設計で決める必要がある。

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
- 候補の取得: 種類ごとに `useSWRxAuditlogSuggestions` を別々に呼ぶ（「すべて」ならユーザー名と URL の 2 リクエスト）。種類ごとの失敗を SWR の `error` で個別に見分けられ、候補 API の契約（1 つでも失敗したら 500）を変えずに済む。種類ごとの件数の上限も、`limit` の指定で自然に決まる。
- 一覧の絞り込み: `ISearchFilter` に endpoint の配列を足し、`build-search-filter.ts` → validator → `resolveActivityListWhere` → `buildActivityListWhere` の順に延ばす。
- ✅ 部分失敗の扱いを、サーバーの変更なしで満たせる。既存の純粋関数の形にそろう。
- ❌ 「すべて」のときのリクエストが 2 倍になる（キー入力ごと。`delay=400` で間引かれる）。

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
  - 部分失敗を種類ごとのリクエストで扱うか（候補 API の契約を変えないか）
  - 「すべて」のときの種類ごとの件数
  - 一覧の API の `ISearchFilter` に足す項目名
- 依存: PR #12119 のマージ。

---

## Design Discovery（2026-11-13）

### Summary
- **Feature**: `auditlog-endpoint-search`
- **Discovery Scope**: Extension（既存の監査ログ画面・一覧 API への追加）
- **Key Findings**:
  - Prisma 6.19 の MongoDB コネクタは `findMany` の条件を `$expr` の集約に変換する。`startsWith` は `$regexMatch` になり、**値の正規表現記号をエスケープしない**。
  - 今の一覧の絞り込み（username・action）も含め、Prisma 経由の一覧クエリは `COLLSCAN` で実行されている。endpoint の条件を足しても、走査の種類は変わらない。
  - 候補の取得を field ごとに別リクエストにすれば、候補 API の契約（1 つでも失敗したら 500）を変えずに、種類ごとの失敗を見分けられる。

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

### Decision: 候補は field ごとに別リクエストで取得する
- **Context**: 要件 4.1（一部の種類だけ失敗したとき、取れた種類は出す）。
- **Alternatives Considered**:
  1. 1 リクエストで `field=username&field=endpoint` を送り、サーバーで部分失敗を返す — 候補 API の契約（1 つでも失敗したら 500）を変えることになる。
  2. field ごとに `useSWRxAuditlogSuggestions` を呼ぶ — 失敗を SWR の `error` で種類ごとに見分けられる。
- **Selected Approach**: 2。
- **Trade-offs**: 「すべて」のときはキー入力ごとのリクエストが 2 本になる（入力欄の `delay` で間引かれる）。

### Decision: 「取得できなかった」の表示は、候補のリクエスト自体の失敗に限る
- **Context**: 要件 4。候補 API は、全文検索サーバーが使えずデータベースでの検索も失敗したとき（時間切れなど）、warn ログを出して空の候補を 200 で返す（PR #12119 の契約）。画面からは「該当なし」と区別できない。
- **Alternatives Considered**:
  1. 要件 4 の対象をリクエスト自体の失敗に限り、データベースでの検索の失敗は既知の制約とする。
  2. 候補 API が field ごとに失敗を示す印を返すようにする — 要件 4 の目的を完全に満たすが、PR #12119 の契約を変え、本 spec の範囲を越える。
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
- **Selected Approach**: field ごとのリクエストの `limit` を 5 にする（`useSWRxAuditlogSuggestions` の既定値と同じ）。種類を 1 つに絞ったときも同じ 5 件にして、定数を 1 つにする。
- **Rationale**: field ごとにリクエストを分けるので、件数の上限がそのまま種類ごとの上限になる。一方の種類が他方を押し出すことはない。

### Decision: 古い候補は `filterBy` で除き、失敗のグループは `renderMenu` で出し分ける
- **Context**: 要件 1.1, 1.5, 4.2。`react-bootstrap-typeahead` 6.3.2 は、キーボード操作をメニューに描いた内容ではなく `filterBy` を通した結果で処理する。
  - Tab や → で確定する候補（`initialItem`）を更新するのは、実際に描かれた先頭（`position === 0`）の `MenuItem` だけ（`es/behaviors/item.js`）。
  - `initialItem` が消えるのは、`filterBy` を通した結果が 0 件のときだけ（`es/core/TypeaheadManager.js`）。
  - 入力補完のヒントは `initialItem` から作られ、`multiple` でも出る。ヒントがあれば Tab か →（カーソルが入力の末尾にあるとき）で `onAdd(initialItem)` が呼ばれる（`es/utils/defaultSelectHint.js`）。
  - Enter で確定するのは矢印キーで選んだ `activeItem` で、矢印キーで移動できるのは実際に描かれた `MenuItem` だけなので、描かれていない候補は Enter では確定されない。
- **Alternatives Considered**:
  1. `filterBy` はすべて通し、古い候補と選択済みの値は `renderMenu` の中だけで除く — 古い候補が `filterBy` の結果に残るので `initialItem` が消えず、メニューに出ていない古い候補を Tab で確定できてしまう。
  2. 候補ごとの除外は `filterBy`、失敗のグループの出し分けは `renderMenu` で行い、どちらも同じ判定（`isFreshForText`）を使う。
- **Selected Approach**: 2。既存の `UsernameTypeahead`（`filterBy` で `shouldShowUsernameSuggestion` を使う）と同じ形。
- **Rationale**: 失敗は候補ではないので `filterBy` を通らず、`renderMenu` で出し分けるしかない。判定を 1 つの純粋関数にまとめれば、2 か所で判定がずれない。

### Synthesis
- **Generalization**: 「検索対象の種類」をデータ（`AUDITLOG_SEARCH_SCOPES` の表）で持ち、種類ごとの取得・見出し・トークンの表示をその表から引く。IP を後で足すときは、表に 1 行足して候補の取得を足すだけで済む。ただし、実装するのは今回の要件のユーザーと URL だけにする。
- **Build vs. Adopt**: 入力欄は既存の `react-bootstrap-typeahead` を使う。新しい依存はない。
- **Simplification**: 候補 API とサーバー側の候補の検索は変えない。エクスポートのモーダルは既存の `AuditLogUsernameTypeahead` のまま残す。

## Risks & Mitigations
- Prisma のバージョンアップで `startsWith` がエスケープするようになり、二重エスケープで一致しなくなる — 正規表現の記号を含むパスと `/_api/v3/pages` の除外を確かめる integ テストで検知する。
- 一覧のクエリが全件走査のまま — 今の username・action の絞り込みと同じ水準。activities は既定で 30 日で消える。改善は本 spec の範囲外。
- PR #12119 が未マージ — 候補 API の `endpoint` に依存するタスクは、PR #12119 のマージ後に着手する。
- `react-bootstrap-typeahead` 6.3.2 は、候補一覧を開くかを `isShown`（`open` / `minLength` / `showMenu` / `text`）だけで決め、結果の件数は見ない。フィルタ後の結果が 0 件でも `renderMenu` は呼ばれる — `renderMenu` が結果が空のときに早期 return すると、失敗表示だけの場合（要件 4.2）が消える。早期 return せず、コンポーネントテストで固定する。
