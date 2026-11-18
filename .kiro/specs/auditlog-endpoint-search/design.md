# Design Document

## Overview

**Purpose**: 監査ログ画面（`/admin/audit-log`）で、管理者が特定の URL（activity に記録された endpoint）に対する操作だけを一覧に絞り込めるようにする。

**Users**: 監査ログで操作の痕跡を調べる管理者。ユーザーと URL を 1 つの検索欄で検索し、候補から選んだ値で一覧を絞り込む。

**Impact**: 監査ログ画面のフィルター行のユーザー名の入力欄を、ユーザーと URL を扱う 1 つの検索欄に置き換える。一覧の絞り込み条件（`ISearchFilter`）に endpoint を足す。候補 API・エクスポート・全文検索ページのユーザー名の入力欄は変えない。

### Goals
- 候補から選んだ URL で、一覧をパス部分の完全一致で絞り込める（要件 1, 2）
- ユーザーと URL を 1 つの検索欄で扱い、「絞り込みを選択」で検索対象を切り替えられる（要件 3）
- 候補の取得に失敗したときに、「該当なし」と区別できる表示を出す（要件 4）

### Non-Goals
- IP アドレスの検索（後続のタスク）
- エクスポートのモーダルの絞り込みの変更
- URL を貼り付けたときの正規化、自由入力による絞り込み
- 候補 API とサーバー側の候補の検索の変更（validator の `q` の上限値を共有の定数に置き換えることだけは行う。上限値と契約は変えない）
- 一覧のクエリの性能改善（インデックスを効かせる書き換え）

## Boundary Commitments

### This Spec Owns
- 監査ログ画面の検索欄（ユーザーと URL の候補の表示、検索対象の切り替え、選択済みの値の管理、候補の取得失敗の表示）
- 一覧の絞り込み条件の endpoint（`ISearchFilter.endpoints`）と、その一致の仕方（パス部分の完全一致）
- 監査ログ画面のリセット・ページ番号との連携
- 本機能で追加する文言（`admin` 名前空間）の 5 ロケール分
- `useSWRxAuditlogSuggestions`（`stores/activity.ts`）に field の配列を受け取る形を足すこと
- `.kiro/specs/activity-log-snapshot/design.md` の Allowed Dependencies にある `findSnapshotUsernamesByUsernameRegex` の説明の修正。依存先の説明を今のコードに合わせるだけで、`activity-log-snapshot` の契約は変えない（amend spec にしない理由は `research.md` の Decision を参照）

### Out of Boundary
- 候補 API（`GET /_api/v3/activity/suggestions`）の契約とサーバー側の検索（`search-auditlog-suggestions.ts`）
- 共有の `UsernameTypeahead` と、それを使う全文検索ページ・エクスポートのモーダル
- 監査ログのエクスポート（`features/audit-log-bulk-export`）
- activity の記録内容（`activity-log` / `activity-log-snapshot` が所有）
- IP アドレスの検索

### Allowed Dependencies
- 候補 API の `field=username` / `field=endpoint`（1 回のリクエストで複数の field を指定でき、`limit` は field ごとに効く）。画面からは `useSWRxAuditlogSuggestions` を通してのみ呼ぶ
- 候補 API の field ごとの検索が、全文検索サーバーとデータベースのどちらでも失敗したときに、例外ではなく空の候補を返すこと（`search-auditlog-suggestions.ts`）。「すべて」を 1 回のリクエストにまとめる設計は、これに依存する
- データベースでの URL 候補の検索が使う `endpoint_1` インデックス（migration `20261111120000-add-endpoint-index-to-activities`）
- `react-bootstrap-typeahead`（既存の依存、6.3 系）
- `@growi/core` の `escapeStringForMongoRegex`
- 既存の一覧の取得の仕組み（`buildActivitySearchFilter` → `POST /activity/list` / `GET /activity` → `resolveActivityListWhere` → `buildActivityListWhere` → Prisma `findMany`）
- 依存の方向: 型（`interfaces/activity.ts`）→ サーバーの `where` の組み立て → ルート、型 → 画面の純粋関数 → フック → コンポーネント。サーバーと画面は型だけを共有する

### Revalidation Triggers
- 候補 API のレスポンスの形（`username` / `endpoint` のキー）や、失敗時の振る舞い（500 か空の候補か）が変わったとき。特に、field ごとの検索が失敗時に空の候補を返さず例外を投げるようになると、「すべて」では片方の種類の失敗で両方の候補が出なくなる
- `endpoint_1` インデックスを作る migration が変わったとき
- `ISearchFilter` の項目名が変わったとき（一覧の GET 経路を使う外部の呼び出し元にも影響する）
- Prisma のバージョンアップで、MongoDB での `startsWith` の変換（エスケープの有無）が変わったとき
- IP の検索を足すとき（`AUDITLOG_SEARCH_SCOPES` に行を足す）

## Architecture

### Existing Architecture Analysis
- 一覧の絞り込みは、画面の純粋関数 `buildActivitySearchFilter` が `ISearchFilter` を組み立て、サーバーの純粋関数 `resolveActivityListWhere` → `buildActivityListWhere` が Prisma の `where` に変換する。GET と POST の 2 経路が同じ関数を共有する。
- Prisma の MongoDB コネクタは `where` を `$expr` の集約に変換するため、一覧のクエリは今も全件走査で実行されている。`startsWith` は `$regexMatch` になり、値をエスケープしない（調査の詳細は `research.md`）。
- ユーザー名の入力欄 `UsernameTypeahead` は、候補の取得元を注入する共有コンポーネントで、全文検索ページとエクスポートのモーダルも使う。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph Client
        AuditLogManagement --> AuditLogSearchTypeahead
        AuditLogSearchTypeahead --> UseAuditLogSearchSuggestions
        AuditLogSearchTypeahead --> SearchSuggestionOptions
        UseAuditLogSearchSuggestions --> UseSWRxAuditlogSuggestions
        AuditLogManagement --> BuildActivitySearchFilter
        AuditLogManagement --> UseSWRxActivity
    end
    subgraph Server
        ActivityRoute --> ResolveActivityListWhere
        ResolveActivityListWhere --> BuildActivityListWhere
        BuildActivityListWhere --> PrismaFindMany
        SuggestionsRoute
    end
    UseSWRxAuditlogSuggestions --> SuggestionsRoute
    UseSWRxActivity --> ActivityRoute
```

- **Selected pattern**: 既存の「純粋関数＋薄いアダプタ」を延ばす。検索欄の判断（候補の組み立て、見出し、表示の可否）は純粋関数に置き、コンポーネントとフックは薄くする。
- **新しい構成要素**: `AuditLogSearchTypeahead`（検索欄）、`useAuditLogSearchSuggestions`（検索対象に応じた候補の取得）、`search-suggestion-options`（候補一覧の組み立て）、`search-scopes`（検索対象の種類の表）。
- **残す既存のパターン**: 候補の取得は `useSWRxAuditlogSuggestions` 経由、一覧は `useSWRxActivity` 経由。`where` の組み立ては純粋関数。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|---|---|---|---|
| Frontend | React 18、`react-bootstrap-typeahead` 6.3、SWR | 検索欄、候補の取得 | 新しい依存はない |
| Backend | Express（apiv3）、Prisma 6.19 | 一覧の絞り込み条件の変換 | `startsWith` の値は呼び出し側でエスケープする |
| Data | MongoDB `activities` | 一覧の検索対象 | スキーマ・インデックスの変更はない |

## File Structure Plan

### Directory Structure
```
apps/app/src/client/components/Admin/AuditLog/AuditLogSearchTypeahead/
├── index.ts                                   # barrel: AuditLogSearchTypeahead と型だけを公開
├── AuditLogSearchTypeahead.tsx                # 検索欄（入力、「絞り込みを選択」、候補一覧、トークン）
├── AuditLogSearchTypeahead.spec.tsx           # コンポーネントテスト
├── search-scopes.ts                           # 検索対象の種類の表（scope → 対象 field、文言キー）
├── search-suggestion-options.ts               # 純粋関数: 種類ごとの取得結果から候補一覧のグループを組み立てる
├── search-suggestion-options.spec.ts
├── use-auditlog-search-suggestions.ts         # フック: scope の対象の field をまとめて候補を取得する
├── use-auditlog-search-suggestions.spec.tsx
└── search-labels-locale-drift.spec.ts         # 追加した文言キーが 5 ロケールすべてにあることを確かめる
```

### Modified Files
- `apps/app/src/interfaces/activity.ts` — `ISearchFilter` に `endpoints?: string[]` を足す。候補 API の `q` の上限 `AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH`（100）を足す
- `apps/app/src/server/routes/apiv3/build-activity-list-where.ts` — endpoint の条件（パス部分の完全一致）を足す。`usernames` / `endpoints` の型の判定を `Array.isArray` を含む形にする
- `apps/app/src/server/routes/apiv3/build-activity-list-where.spec.ts` — endpoint の条件の単体テストを足す
- `apps/app/src/server/routes/apiv3/fetch-activity-list.ts` — `resolveActivityListWhere` で `endpoints` を受け渡す
- `apps/app/src/server/routes/apiv3/fetch-activity-list.integ.ts`（新規） — 実際の MongoDB で、パス部分の完全一致と正規表現の記号のエスケープを確かめる
- `apps/app/src/server/routes/apiv3/activity.ts` — OpenAPI の `searchFilter` の説明に `endpoints` を足す。候補 API の validator の `q` の上限を、リテラルの 100 から `AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH` に置き換える（値は変えない）
- `apps/app/src/stores/activity.ts` — `useSWRxAuditlogSuggestions` が field の配列も受け取れるようにする。単一の field での既存の呼び出し（エクスポートのモーダルが使う `use-auditlog-username-suggestions.ts`）は変えない
- `apps/app/src/client/components/Admin/AuditLog/build-search-filter.ts` / `.spec.ts` — `endpoints` を受け取る
- `apps/app/src/client/components/Admin/AuditLogManagement.tsx` — `AuditLogUsernameTypeahead` を `AuditLogSearchTypeahead` に置き換え、選択済みの endpoint を状態に持ち、リセットで検索欄を初期状態に戻す
- `apps/app/public/static/locales/{en_US,fr_FR,ja_JP,ko_KR,zh_CN}/admin.json` — `audit_log_management.search.*` の文言を足す
- `.kiro/specs/activity-log-snapshot/design.md` — Allowed Dependencies の `findSnapshotUsernamesByUsernameRegex(WithTotalCount)` の段落を、依存先として今成り立っている事実（呼び出し元が `search-auditlog-suggestions.ts` であること、マッチの仕方、最小文字数の判定が呼び出し側にあること）だけに縮める。変更の経緯（「撤去し」「新設された」など）は残さない。`spec.json` の `updated_at` を更新する

`AuditLogUsernameTypeahead` と `UsernameTypeahead` は変更しない（エクスポートのモーダルと全文検索ページが使い続ける）。

## System Flows

```mermaid
sequenceDiagram
    participant Admin
    participant SearchBox as AuditLogSearchTypeahead
    participant Hook as useAuditLogSearchSuggestions
    participant SuggestAPI as Suggestions API
    participant Screen as AuditLogManagement
    participant ListAPI as Activity List API
    Admin->>SearchBox: 文字を入力
    SearchBox->>Hook: keyword と scope
    Hook->>SuggestAPI: 対象の field をまとめて 1 リクエスト
    SuggestAPI-->>Hook: field ごとの候補、または失敗
    Hook-->>SearchBox: 候補と失敗の有無
    SearchBox-->>Admin: 見出し付きの候補一覧
    Admin->>SearchBox: 候補を選ぶ
    SearchBox->>Screen: onChange usernames と endpoints
    Screen->>ListAPI: searchFilter に usernames と endpoints
    ListAPI-->>Screen: 絞り込んだ一覧の 1 ページ目
```

- 「すべて」のときは username と endpoint を 1 回のリクエストで取得する。候補 API の field ごとの検索は失敗しても空の候補を返すので、リクエストが失敗するのは、通信の失敗・ログイン切れ・データベース自体の停止など、どの種類にも同じように起きる場合に限られる。そのため失敗は種類ごとに分けず、1 つの表示にする。
- 検索対象の切り替えは候補の取得だけに効き、選択済みの値と一覧の絞り込みは変えない。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|---|---|---|---|---|
| 1.1 | 入力に前方一致する URL 候補 | useAuditLogSearchSuggestions, search-suggestion-options | 候補 API `field=endpoint` | 入力 → 候補 |
| 1.2 | 選んだ URL をトークン表示し一覧を絞り込む | AuditLogSearchTypeahead, AuditLogManagement | `onChange` | 選択 → 一覧 |
| 1.3 | 複数選択、いずれかに一致 | AuditLogSearchTypeahead, BuildActivityListWhere | `ISearchFilter.endpoints` | — |
| 1.4 | 選択を外すと条件から外れる | AuditLogSearchTypeahead, AuditLogManagement | `onChange` | — |
| 1.5 | 候補から選んだ値だけが条件 | AuditLogSearchTypeahead, search-suggestion-options | 自由入力なし（`allowNew` を使わない）、古い候補を `filterBy` で除く | — |
| 1.6 | 空のときは候補を出さない | useAuditLogSearchSuggestions | 空の keyword ではリクエストしない | — |
| 1.7 | 100 文字を超える入力では取得しない | useAuditLogSearchSuggestions | `AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH` | — |
| 2.1 | パス部分の完全一致 | BuildActivityListWhere | `buildEndpointWhere` | — |
| 2.2 | クエリ文字列を除いて判定 | BuildActivityListWhere | `buildEndpointWhere` | — |
| 2.3 | 前方一致だけの別 URL を含めない | BuildActivityListWhere | `buildEndpointWhere` | — |
| 2.4 | 大文字小文字を区別 | BuildActivityListWhere | `buildEndpointWhere` | — |
| 3.1 | 1 つの検索欄 | AuditLogSearchTypeahead | — | — |
| 3.2 | 「すべて／ユーザー／URL」、初期値「すべて」 | AuditLogSearchTypeahead, search-scopes | `AUDITLOG_SEARCH_SCOPES` | — |
| 3.3 | 「すべて」は見出し付きで混在表示 | search-suggestion-options | `buildSuggestionGroups` | 入力 → 候補 |
| 3.4 | 種類を絞ると、その種類だけ | useAuditLogSearchSuggestions, useSWRxAuditlogSuggestions, search-scopes | scope → fields | — |
| 3.5 | 種類ごとの件数の上限 | useAuditLogSearchSuggestions, useSWRxAuditlogSuggestions | field ごとに効く `limit = 5` | — |
| 3.6 | ユーザーを選ぶと既存と同じ絞り込み | AuditLogManagement | `ISearchFilter.usernames` | — |
| 3.7 | Active / Inactive の区別 | search-suggestion-options, AuditLogSearchTypeahead | `SuggestionOption.status` | — |
| 3.8 | 同種は OR、異種は AND | BuildActivityListWhere | `where` の AND | — |
| 3.9 | 切り替えても選択済みの値を保つ | AuditLogSearchTypeahead | scope と選択の状態を分ける | — |
| 4.1 | 取得失敗の表示 | useAuditLogSearchSuggestions, search-suggestion-options | `SearchSuggestionsResult.error` | 入力 → 候補 |
| 4.2 | 失敗しても選択と一覧を変えない | AuditLogSearchTypeahead | 失敗は候補一覧の中だけで扱う | — |
| 5.1 | 選択・解除で 1 ページ目 | AuditLogManagement | `setActivePageNumber(1)` | — |
| 5.2 | 期間・アクションと AND | BuildActivityListWhere | `where` の AND | — |
| 5.3 | リセットで選択を外し「すべて」に戻す | AuditLogManagement, AuditLogSearchTypeahead | `IClearable.clear` | — |
| 6.1 | 5 ロケールの文言 | admin.json, search-labels-locale-drift.spec | `audit_log_management.search.*` | — |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|---|---|---|---|---|---|
| BuildActivityListWhere（拡張） | Server / pure | `ISearchFilter` を Prisma `where` に変換する。endpoint の条件を足す | 1.3, 2.1–2.4, 3.8, 5.2 | Prisma（P0）、`escapeStringForMongoRegex`（P0） | Service |
| ResolveActivityListWhere（拡張） | Server / pure | `endpoints` を受け渡す | 1.3 | BuildActivityListWhere（P0） | Service |
| search-scopes | Client / data | 検索対象の種類の表 | 3.2, 3.4 | — | State |
| search-suggestion-options | Client / pure | 候補を出すかの判定と、候補一覧のグループの組み立て | 1.1, 1.5, 3.3, 3.7, 4.1 | search-scopes（P0） | Service |
| useSWRxAuditlogSuggestions（拡張） | Client / store | field の配列を 1 回のリクエストで取得する | 3.4, 3.5 | 候補 API（P0） | Service |
| useAuditLogSearchSuggestions | Client / hook | scope の対象の field をまとめて候補を取得する | 1.1, 1.6, 1.7, 3.4, 3.5, 4.1 | `useSWRxAuditlogSuggestions`（P0） | Service |
| AuditLogSearchTypeahead | Client / UI | 検索欄 | 1.2, 1.4, 1.5, 3.1, 3.2, 3.9, 4.2, 5.3 | search-scopes・search-suggestion-options・useAuditLogSearchSuggestions（P0）、`react-bootstrap-typeahead`（P0） | State |
| AuditLogManagement（変更） | Client / UI | 選択済みの値を一覧の条件に渡す | 1.2, 3.6, 5.1, 5.3 | AuditLogSearchTypeahead（P0）、`buildActivitySearchFilter`（P0） | — |

### Shared Types

```typescript
// interfaces/activity.ts（追加）
export type ISearchFilter = {
  usernames?: string[];
  endpoints?: string[]; // path part only; matched exactly, query string ignored
  dates?: { startDate: string | null; endDate: string | null };
  actions?: SupportedActionType[];
};

// Upper bound of the suggestion API's `q`. Shared by the route validator and
// the client so the client never sends a query the server would reject.
export const AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH = 100;
```

### Server

#### BuildActivityListWhere（拡張）

| Field | Detail |
|---|---|
| Intent | 一覧の絞り込み条件を Prisma `where` に変換する純粋関数に、endpoint の条件を足す |
| Requirements | 1.3, 2.1, 2.2, 2.3, 2.4, 3.8, 5.2 |

**Responsibilities & Constraints**
- `usernames` と `endpoints` は、`Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string')` を満たすときだけ条件を足す。既存の `usernames` の判定（`x.length > 0 && x.every(...)`）は、文字列が来ると `.every` がなく TypeError になるため、同じ形に直す。
- endpoint の条件は「値が選んだパスのいずれかと等しい」または「値が `<パス>?` で始まる」の OR。前方一致の値は `escapeStringForMongoRegex(パス) + '\\?'` とする。Prisma は `startsWith` の値をエスケープせずに `$regexMatch` に渡すため、呼び出し側でのエスケープが必須（`.claude/rules/mongodb-regex.md`）。
- 大文字小文字は区別する（`mode: 'insensitive'` を使わない）。
- 他の条件（username・action・期間）とは AND で結合する。endpoint の OR は `where.AND` の要素（`AND: [{ OR: [...] }]`）として足し、トップレベルの `OR` は使わない。今後、別の OR 条件（IP など）を足しても衝突しない。

**Contracts**: Service [x]

```typescript
export type ActivityListFilterInput = {
  usernames: string[] | undefined;
  endpoints: string[] | undefined; // added
  actions: string[] | undefined;
  startDate: Date | undefined;
  endDate: Date | undefined;
};

// Pure: builds the endpoint clause, exported for unit tests.
export function buildEndpointWhere(
  paths: readonly string[],
): Prisma.activitiesWhereInput;
```
- Preconditions: `paths` は空でない。各要素は文字列。
- Postconditions: 返す条件は、保存値のパス部分が `paths` のいずれかと完全に一致する行だけに一致する。

**Implementation Notes**
- Validation: 一覧の GET 経路は `searchFilter` を JSON 文字列として受け取り、POST 経路はオブジェクトとして受け取る。validator は足さず、中身の型は両経路が必ず通る `buildActivityListWhere` の判定 1 か所で守る（GET の `searchFilter` は validator の時点では JSON 文字列で、中身を検証できないため）。判定を満たさない値は、その条件を付けずに無視する。値は Prisma にリテラルとして渡り、正規表現の部分はエスケープするので、NoSQL / 正規表現の注入は起きない。
- Risks: Prisma が将来 `startsWith` をエスケープするようになると二重エスケープで一致しなくなる。integ テストで検知する。

#### ResolveActivityListWhere（拡張）
- `parsedSearchFilter.endpoints` を `buildActivityListWhere` に受け渡すだけ。summary のみ。

### Client

#### search-scopes

| Field | Detail |
|---|---|
| Intent | 検索対象の種類（scope）と、それぞれが候補を取る field・文言キーを 1 か所で宣言する |
| Requirements | 3.2, 3.4 |

**Contracts**: State [x]

```typescript
export type AuditLogSearchField = 'username' | 'endpoint';
export type AuditLogSearchScope = 'all' | AuditLogSearchField;

export const AUDITLOG_SEARCH_SCOPES: readonly {
  readonly scope: AuditLogSearchScope;
  readonly fields: readonly AuditLogSearchField[];
  readonly labelKey: string; // admin:audit_log_management.search.scope.*
}[];

export const DEFAULT_AUDITLOG_SEARCH_SCOPE: AuditLogSearchScope; // 'all'
```
- 表の順序が「絞り込みを選択」の選択肢の順序と、候補一覧のグループの順序になる（ユーザー → URL）。

#### search-suggestion-options

| Field | Detail |
|---|---|
| Intent | 候補を出すかどうかの判定と、候補一覧に出すグループの組み立てを行う純粋関数 |
| Requirements | 1.1, 1.5, 3.3, 3.7, 4.1 |

**Contracts**: Service [x]

```typescript
export type SuggestionOption =
  | { kind: 'username'; value: string; status: 'active' | 'inactive' }
  | { kind: 'endpoint'; value: string };

export type SearchSuggestionsResult = {
  fields: readonly AuditLogSearchField[]; // the scope's fields, in AUDITLOG_SEARCH_SCOPES order
  options: readonly SuggestionOption[];
  error: boolean;
  isLoading: boolean;
};

export type SuggestionGroup =
  | { state: 'options'; field: AuditLogSearchField; options: readonly SuggestionOption[] }
  | { state: 'error' };

// The single staleness predicate: results fetched for an older keyword are stale.
export function isFreshForText(args: {
  currentText: string; // text currently in the input
  fetchedForKeyword: string; // keyword the results were fetched for
}): boolean;

// Used as the typeahead's filterBy: hides stale and already-selected options.
export function shouldShowSuggestionOption(args: {
  option: SuggestionOption;
  currentText: string;
  fetchedForKeyword: string;
  selected: readonly SuggestionOption[];
}): boolean;

// Used inside renderMenu: groups the options that passed filterBy, or returns
// the single error group when the request failed.
export function buildSuggestionGroups(args: {
  visibleOptions: readonly SuggestionOption[]; // renderMenu's results (after filterBy)
  fields: readonly AuditLogSearchField[]; // group order
  error: boolean;
  currentText: string;
  fetchedForKeyword: string;
}): SuggestionGroup[];

export function isSameSuggestion(a: SuggestionOption, b: SuggestionOption): boolean;
```
- 古い応答の判定は `isFreshForText` の 1 つだけで、次の 2 か所がこれを使う。
  - **候補ごとの除外（`filterBy`）**: `shouldShowSuggestionOption` が、古い候補と選択済みの値（`kind` と `value` が一致するもの）を除く。既存の `UsernameTypeahead` の `shouldShowUsernameSuggestion` と同じ形。候補が全部除かれると `filterBy` を通した結果が 0 件になり、ライブラリが Tab で確定する候補（`initialItem`）も消える。
  - **失敗のグループの出し分け（`renderMenu`）**: 失敗は候補ではないので `filterBy` を通らない。`buildSuggestionGroups` が `isFreshForText` で判定し、古いときは失敗のグループを出さない。
- `buildSuggestionGroups` の Postconditions:
  - `error` が true で、`isFreshForText` が true のときは、`state: 'error'` のグループ 1 つだけを返す。古いときは失敗のグループを出さない。
  - それ以外は、`fields` の順序（= `AUDITLOG_SEARCH_SCOPES` の順序）でグループを返す。各グループの候補は `visibleOptions` のうちその種類のもの。表示する候補が 0 件の field はグループを返さない。

#### useAuditLogSearchSuggestions

| Field | Detail |
|---|---|
| Intent | scope と keyword から、scope の対象の field をまとめて候補 API を 1 回呼び、`SearchSuggestionsResult` を返す |
| Requirements | 1.1, 1.6, 1.7, 3.4, 3.5, 4.1 |

**Contracts**: Service [x]

```typescript
export const AUDITLOG_SEARCH_SUGGESTION_LIMIT = 5;

export function useAuditLogSearchSuggestions(
  keyword: string,
  scope: AuditLogSearchScope,
): SearchSuggestionsResult;
```
- scope の対象の field の配列（`AUDITLOG_SEARCH_SCOPES` の順）を `useSWRxAuditlogSuggestions(fields, q, AUDITLOG_SEARCH_SUGGESTION_LIMIT)` に渡す。`limit` は候補 API で field ごとに効くので、「すべて」でも種類ごとに 5 件が上限になり、一方の種類が他方を押し出さない（3.5）。
- 空の keyword ではリクエストしない（`useSWRxAuditlogSuggestions` は空の keyword でキーを `null` にする）。前後の空白を除いた keyword が `AUDITLOG_SUGGESTION_QUERY_MAX_LENGTH` を超えるときも空の keyword を渡してリクエストしない。結果は候補 0 件・失敗なし・読み込み中なしになり、候補も失敗の表示も出ない（1.7）。候補 API は前後の空白を除いた q を受け取るので（`useSWRxAuditlogSuggestions` が trim する）、比べる長さも trim した後の長さにする。
- username の結果は `activeUsernames` / `inactiveUsernames` から `status` 付きのオプションに、endpoint の結果は `endpoint.endpoints` からオプションに変換する。
- SWR の `error` があれば `error: true` を返す。読み込み中の判定は既存の `toUsernameSuggestions` と同じく、エラー時は読み込み中にしない。

#### useSWRxAuditlogSuggestions（拡張）

| Field | Detail |
|---|---|
| Intent | 候補 API を呼ぶ既存の SWR フックに、field の配列を受け取る形を足す |
| Requirements | 3.4, 3.5 |

**Contracts**: Service [x]

```typescript
export const useSWRxAuditlogSuggestions = (
  field: AuditlogSuggestionField | readonly AuditlogSuggestionField[],
  q: string,
  limit?: number,
): SWRResponse<AuditlogSuggestionsResponse, Error>;
```
- 配列は `field` のクエリにそのまま載せる。axios の `qs.stringify` が `field[0]=…&field[1]=…` にし、サーバーの `qs.parse` が配列に戻す。候補 API の validator は配列を受け付ける。
- 単一の field の呼び出しは、引数もリクエストも今のまま。

#### AuditLogSearchTypeahead

| Field | Detail |
|---|---|
| Intent | ユーザーと URL を 1 つの入力欄で検索し、選択済みの値を種類ごとに親へ通知する |
| Requirements | 1.2, 1.4, 1.5, 3.1, 3.2, 3.9, 4.2, 5.3 |

**Contracts**: State [x]

```typescript
export type AuditLogSearchSelection = {
  usernames: string[];
  endpoints: string[];
};

export type AuditLogSearchTypeaheadProps = {
  onChange: (selection: AuditLogSearchSelection) => void;
};

// forwardRef<IClearable, AuditLogSearchTypeaheadProps>
```
- State model: `scope`（初期値 `'all'`）、`selected: SuggestionOption[]`、`searchKeyword`。scope と選択は独立した状態で、scope を変えても `selected` は変えない（3.9）。
- 入力欄は `AsyncTypeahead` を `multiple` で使い、`allowNew` は使わない（1.5）。
- 候補一覧の描き方: `react-bootstrap-typeahead` 6.3 は、Tab や →（カーソルが入力の末尾にあるとき）による入力補完のヒントの確定と、その確定に使う `initialItem` の消去を、メニューに描いた内容ではなく `filterBy` を通した後の結果に依存して行う。そのため、古い候補と選択済みの値は `filterBy`（`shouldShowSuggestionOption`）で除き、メニューに出ない候補がキーボード操作で確定されないようにする。`renderMenu` は、第 1 引数の結果（`filterBy` を通した後）と第 3 引数の `state.text` を `buildSuggestionGroups` に渡し、見出し付きのグループと失敗のグループを組み立てる。
- `error` のグループには取得できなかった旨の文言を出す（4.1）。ユーザーの候補には Active / Inactive のバッジを付ける（requirements.md の Introduction にある Figma のデザインに合わせる）。`renderToken` で種類が分かるトークンを描く。
- 読み込み中の表示: `useAuditLogSearchSuggestions` の結果の `isLoading` を、`AsyncTypeahead` の `isLoading` に渡す。
- 「絞り込みを選択」は入力欄の右に置くドロップダウンで、`AUDITLOG_SEARCH_SCOPES` から選択肢を作る。
- `IClearable.clear()` は選択と入力を空にし、scope を `'all'` に戻す（5.3）。
- 候補の取得に失敗しても、`selected` と `onChange` は呼ばない（4.2）。

**Implementation Notes**
- Risks:
  - `AsyncTypeahead` は同じ keyword の再検索で `onSearch` を呼ばないため、既存と同じく `useCache={false}` にする。
  - `renderMenu` は、`filterBy` を通した結果が 0 件でも呼ばれる。空を返す（`Menu` を描かない）かどうかは、`filterBy` を通した結果ではなく `buildSuggestionGroups` の戻り値で決める。
    - 戻り値が空なら、空のフラグメントを返す。空の `Menu` を描くと、ライブラリが既定の英語の文言（入力が空なら "Type to search..."、読み込み中なら "Searching..."、それ以外は "No matches found."）を出し、6.1 に反するうえ、取得待ちや 1.7 の場面が「該当なし」に見える。候補が 0 件のときは、既存の `UsernameTypeahead` と同じく何も表示しない（「該当なし」の文言は出さない）。
    - 戻り値が失敗のグループの場合は空ではないので、`Menu` を描いて失敗の表示を出す（4.1）。
    - 読み込み中は、`AsyncTypeahead` が入力欄のスピナーを出し続ける。
    - `emptyLabel` / `promptText` / `searchText` に空文字を渡す方法は使わない。中身のない無効な項目が一覧に残るため。

#### AuditLogManagement（変更）
- `AuditLogUsernameTypeahead` を `AuditLogSearchTypeahead` に置き換える。`onChange` で `selectedUsernames` と `selectedEndpoints` を更新し、1 ページ目に戻す（5.1）。
- `buildActivitySearchFilter` に `endpoints` を渡す。リセットでは `selectedEndpoints` も空にし、検索欄の `clear()` を呼ぶ（5.3）。
- エクスポートのモーダルへの `initialSelectedUsernames` の受け渡しは今のまま（endpoint は渡さない）。

## Data Models

### Data Contracts & Integration

**一覧 API（`POST /_api/v3/activity/list`、`GET /_api/v3/activity`）**

| 項目 | 型 | 説明 |
|---|---|---|
| `searchFilter.endpoints` | `string[]`（省略可） | 選んだ URL のパス部分。空または省略なら endpoint で絞り込まない |

- 一致の仕方: 保存値が要素のいずれかと等しい、または要素の後ろに `?` が続く値で始まる。大文字小文字を区別する。
- 既存の項目（`usernames` / `dates` / `actions`）の意味は変えない。項目を足すだけなので、既存の呼び出し元に影響しない。

**候補 API（既存の契約、変更しない）**: `GET /_api/v3/activity/suggestions?field=<username|endpoint>&q=<q>&limit=5`。`field` は配列で複数指定でき、`limit` は field ごとに効く。レスポンスは `{ username?: { activeUsernames, inactiveUsernames }, endpoint?: { endpoints } }`。

## Error Handling

- **候補の取得要求の失敗**: SWR の `error` を、候補一覧の中の「取得できませんでした」の表示 1 つにする。選択済みの値と一覧には影響させない（4.1, 4.2）。
- **候補 API が空の候補を返す場合**: 全文検索サーバーが使えずデータベースでの検索も失敗したとき、候補 API は warn ログを出して空の候補を 200 で返す（候補 API の契約）。画面からは区別できないため「該当なし」と同じ表示になる。要件の Boundary Context に既知の制約として書いており、サーバーのログで追う。
- **一覧の取得失敗**: 既存のまま（`toastError('Failed to get Audit Log')`）。
- **不正な `usernames` / `endpoints`**: 配列でない、または文字列でない要素を含む場合は、その条件を付けずに無視する。例外は投げない。

## Testing Strategy

### Unit Tests
- `buildActivityListWhere` / `buildEndpointWhere`: `endpoints` があるときに等しい値と `<パス>?` の前方一致の OR が `AND` の要素として付くこと、正規表現の記号を含むパスがエスケープされること、`endpoints` が空・未指定・文字列でない要素を含むときは条件が付かないこと、username・action・期間と同時に指定したときに AND になること（2.1–2.4, 3.8, 5.2）
- `buildActivityListWhere` の型の判定: `usernames` / `endpoints` に配列でない値（`"abc"` など）が来ても例外を投げず、その条件を付けないこと（1.3）
- `shouldShowSuggestionOption`: 入力中の文字と取得に使った keyword が違うときは候補を出さないこと、選択済みの値（`kind` と `value` が一致）は出さないこと、種類が違えば同じ `value` でも出すこと（1.1, 1.5）
- `buildSuggestionGroups`: 「すべて」で username → endpoint の順のグループになること、表示する候補が 0 件の field はグループにならないこと、失敗したときは失敗のグループ 1 つだけになること。入力中の文字と取得に使った keyword が違うときは、失敗のグループを出さないこと（3.3, 4.1）
- `buildActivitySearchFilter`: `endpoints` が `ISearchFilter` に入ること（1.3）

### Integration Tests
- `fetch-activity-list.integ.ts`（実際の MongoDB）: `/_api/v3/page` を選ぶと `/_api/v3/page` と `/_api/v3/page?x=1` が返り、`/_api/v3/pages` と `/_API/v3/page` は返らないこと。`(` や `.` を含むパスも一致すること（Prisma の `startsWith` がエスケープしない振る舞いの固定）（2.1–2.4）
- `useAuditLogSearchSuggestions`: scope が「すべて」なら 1 回のリクエストで 2 field を、「URL」なら endpoint だけをリクエストすること。空の keyword ではリクエストしないこと。前後の空白を除いて 101 文字以上の keyword ではリクエストせず、失敗も返さないこと（100 文字ちょうどならリクエストすること）。リクエストが失敗すると `error: true` を返すこと（1.6, 1.7, 3.4, 4.1）
- `useSWRxAuditlogSuggestions`: field の配列を渡すと、1 回のリクエストに全 field が載ること。単一の field の呼び出しのリクエストが変わらないこと（3.4）

### Component Tests
- `AuditLogSearchTypeahead`:
  - URL の候補を選ぶと、トークンが表示され、`onChange` に `endpoints` が渡ること。トークンを外すと `endpoints` から消えること（1.2, 1.4）
  - 候補を選ばずに Enter を押しても `onChange` が呼ばれないこと（1.5）
  - 「すべて」で見出し付きの候補一覧が出て、ユーザーの候補に Active / Inactive のバッジが出ること（3.3, 3.7）
  - 値を選んだまま scope を切り替えても、トークンが残ること（3.9）
  - 取得に失敗すると、失敗表示が 1 つ出て、選択済みのトークンが残ること（4.1, 4.2）
  - 入力を続けて、表示中の候補が古い keyword のものになったときは、その候補を出さないこと（1.1）
  - 候補を取得したあと入力を短くして候補が古くなった状態で、Tab・→・Enter を押しても、古い候補が選択されないこと（1.1, 1.5）
  - 入力を止めた直後（取得を待っている間）、空の入力欄にフォーカスしたとき、101 文字の入力のときに、候補一覧（`listbox`）も、ライブラリの既定の英語の文言（"Type to search..." / "Searching..." / "No matches found."）も出ないこと（1.6, 1.7, 6.1）
  - `clear()` でトークンが消え、scope が「すべて」に戻ること（5.3）
- locale drift: `audit_log_management.search.*` の全キーが 5 ロケールの `admin.json` にあること（6.1）

## Security Considerations
- `endpoints` の値は正規表現として MongoDB に渡る部分を `escapeStringForMongoRegex` でエスケープする。`RegExp.escape` は使わない（`.claude/rules/mongodb-regex.md`）。
- 一覧 API と候補 API の認可（管理者のみ）は既存のまま。

## Performance & Scalability
- 一覧のクエリは、Prisma の変換により今も全件走査で実行されている。endpoint の条件を足しても走査の種類は変わらない。activities は既定で 30 日で消える（`ACTIVITY_EXPIRATION_SECONDS`）。インデックスを効かせる書き換えは本 spec の範囲外。
- 候補のリクエストは、「すべて」でも入力ごとに 1 本。入力欄の `delay`（400ms）と SWR のキャッシュで間引く。
