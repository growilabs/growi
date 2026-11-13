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
- **一覧の API の 2 経路**: `GET /activity` と `POST /activity/list` の両方の validator に endpoint 条件の検証を足す必要がある（文字列の配列であることの検証。NoSQL injection の対策）。
- **部分失敗**: yuki さんのレビューでは、UI が field を 1 つしか送らない前提で、候補 API の部分失敗の処理（`allSettled`）を削った。種類ごとに失敗を見分けるには、この前提との関係を設計で決める必要がある。

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
