# Research & Design Decisions

## Summary

- **Feature**: `activity-log-snapshot-viewer`
- **Discovery Scope**: Extension（既存の監査ログ画面 `ActivityTable` への表示機能追加）
- **Key Findings**:
  - 表示に必要なデータ契約（型・型ガード・API 応答）はすべて既存で、**表示側は無加工で消費できる**。`interfaces/activity.ts` に判別可能ユニオン `ISnapshot` と型ガード `isAttachmentRemoveActivity` が既にあり（PR #11393）、`apiv3/activity` は snapshot を `...rest` で無加工返却する。よって本 spec は「型・API・記録側を一切変更しない、純粋な read/UI 増分」に閉じる。
  - action ごとの整形コンポーネントは**現状ゼロ**。action 名の i18n 変換（`admin:audit_log_action.<action>`）のみ存在する。整形表示の仕組み自体を新設する必要がある。
  - 添付追加（`ACTION_ATTACHMENT_ADD`）の snapshot capture は上流（`activity-log-snapshot`）で**未実装**（要件段階の将来増分）。よって viewer が ADD 整形を初回スコープから除外するのは上流状況と整合する。

## Research Log

### 監査ログ UI の現状（統合先）
- **Context**: 既存の監査ログ画面のどこに、どう手を入れるかを確定する。
- **Sources Consulted**（すべて `apps/app/src` 配下、行番号は調査時点）:
  - `client/components/Admin/AuditLog/ActivityTable.tsx` — フラットな `<table>`（`table table-default table-bordered table-user-list`）。1 activity = 1 `<tr data-testid="activity-table">`。props は `activityList: IActivityHasId[]`。
  - `client/components/Admin/AuditLogManagement.tsx` — `<ActivityTable activityList={activityList} />` を描画（フィルタ・`PaginationWrapper`・`AuditLogExportModal` を含む）。データは `useSWRxActivity(PAGING_LIMIT, offset, searchFilter)`。
  - `pages/admin/audit-log.page.tsx` — `AuditLogManagement` を `dynamic(..., { ssr: false })` で読み込む（SSR しない）。
  - `stores/activity.ts` — `useSWRxActivity` は `GET /activity` を叩き `PaginateResult<IActivityHasId>` を返す。
- **Findings**:
  - 現在の列は user / date / action / ip / url の 5 列。ヘッダは `t('admin:audit_log_management.{user|date|action|ip|url}')`。
  - snapshot は **`activity.snapshot?.username` のみ**を user セル内で描画。`originalName` / `pagePath` / `pageId` / `fileSize` は一切描画されていない（データはあるが見えない）。
  - action の表示は JS のマップではなく **i18n キー lookup のみ**：`t(`admin:audit_log_action.${activity.action}`)`。
  - `useTranslation()` を引数なしで使い、`admin:` 前置キーで参照している。
- **Implications**:
  - 表示追加は `ActivityTable` への列/展開追加で足りる。API もフックも型も変更不要。
  - 「action ごとに描き分ける」仕組みは新規。ハードコード分岐ではなく宣言的レジストリで作る（coding-style の data-driven 原則）。
  - `dynamic(ssr:false)` なので、追加コンポーネントに SSR 制約はかからない（`pretty-bytes` 等をクライアントで自由に使える）。

### snapshot のデータ契約（消費する型）
- **Context**: 表示側が narrow・整形するために、正確な型と欠損条件を確定する。
- **Sources Consulted**: `apps/app/src/interfaces/activity.ts`、`apps/app/src/server/routes/apiv3/activity.ts`、隣接 spec `activity-log-snapshot`（design.md / requirements.md）、`activity-log`（design.md / requirements.md）。
- **Findings**:
  - 型（`interfaces/activity.ts`）:
    ```ts
    export type DefaultSnapshot = Partial<Pick<IUser, 'username'>>;      // { username? }
    export type AttachmentRemoveSnapshot = {
      username?: string; originalName?: string; pagePath?: string;
      pageId?: string; fileSize?: number;
    };
    export type ISnapshot = DefaultSnapshot | AttachmentRemoveSnapshot;   // 全フィールド optional
    ```
    `IActivity.snapshot?: ISnapshot`（optional）、`IActivityHasId = IActivity & HasObjectId`（クライアント型）。型ガード `isAttachmentRemoveActivity(activity)` は **`activity.action === ACTION_ATTACHMENT_REMOVE` のみ**で判定する（snapshot の中身は見ない）。
  - action 定数：`ACTION_ATTACHMENT_ADD = 'ATTACHMENT_ADD'`、`ACTION_ATTACHMENT_REMOVE = 'ATTACHMENT_REMOVE'`。`SupportedAction`（`as const`）に約 185 の action が集約。
  - API（`apiv3/activity.ts` GET `/_api/v3/activity`, admin 限定）は `{ user, ...rest }` を返し、**snapshot をそのまま透過**（`snapshot._id` も含む）。OpenAPI は `originalName` / `pagePath` / `pageId` / `fileSize` を明記。
  - 欠損条件（上流 spec 由来）: `pagePath`/`pageId` は対象ページが削除済み・attachment 実体喪失・page→pageId マッピング失敗時に silently `undefined`。`username` は user 無し削除経路（cascade / empty-trash）で欠損しうる。`fileSize` は bytes 数値（通常存在するが型は optional）。
- **Implications**:
  - narrow は必ず既存の `isAttachmentRemoveActivity` を経由する（判別子は `action`）。表示側で独自の判別フィールドを発明しない。
  - 全フィールド optional 前提で、各フィールドに欠損フォールバックを用意する（要件 3）。
  - `fileSize` は bytes → 人間可読へ整形が必要（要件 2.2）。

### 再利用可能な既存資産（build vs adopt）
- **Context**: 整形表示に必要な部品を自作せず既存に寄せる。
- **Findings**:
  - `pretty-bytes` は依存に入っており、`client/components/ReactMarkdownComponents/RichAttachment.tsx` で `prettyBytes(fileSize)` として使用済み。バイト整形の前例。
  - ページパスのリンクは `components/Common/PagePathHierarchicalLink/`（`new LinkedPagePath(path)` を渡す）。`LinkedPagePath`（`models/linked-page-path.ts`）が href エンコード・trash 判定を持つ。
  - i18n は `admin` namespace（`public/static/locales/{en_US,ja_JP,ko_KR,zh_CN,fr_FR}/admin.json`）。既存キー群 `audit_log_management.*`（列見出し）・`audit_log_action.*`・`audit_log_action_category.*`。欠落時は i18next の既定フォールバックに従う。
- **Implications**:
  - バイト整形＝`pretty-bytes` を採用。ページリンク＝`PagePathHierarchicalLink` + `LinkedPagePath` を採用（エンコード・trash を既存実装に委譲）。i18n＝既存 `admin` namespace にキーを追記。いずれも新規依存なし。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 宣言的 per-action renderer レジストリ | `{ canRender, Component }[]` を単一ソースで宣言し、dispatcher が先頭一致を選び、無ければ raw fallback | action 追加が1エントリ追記で済む（consumer 不変）。coding-style の data-driven 原則に合致。判別子=`action` の契約を1箇所に閉じ込める | エントリが現状1件なので過剰に見えうる | **採用**。ADD 増分が控えており interface を一般化する価値が高い。実装は最小（1エントリ）に留める |
| dispatcher 内ハードコード分岐（`if (guard) ... else raw`） | 型ガードで直接分岐 | 最小コード・TS narrow が自然 | action 追加のたび dispatcher を編集。分岐が増えると mode 分岐アンチパターン化 | 却下（拡張時に consumer を触る） |
| ActivityTable に直接 attachment 整形を埋め込む | テーブル本体に条件分岐で描画 | ファイル増えない | 単一責務違反・raw/整形/欠損が1ファイルに混在・テスト困難 | 却下 |

## Design Decisions

### Decision: per-action renderer を宣言的レジストリで dispatch する
- **Context**: 要件 1.2（未対応 action は raw フォールバック）と要件 2（添付削除の整形）を、将来の action 追加（特に上流の ADD 増分）に耐える形で満たす。
- **Alternatives Considered**:
  1. dispatcher 内ハードコード分岐 — 拡張時に consumer を編集する必要。
  2. 宣言的レジストリ — action 追加は宣言の1エントリ追記のみ。
- **Selected Approach**: `snapshot-detail-renderers.ts` に `SnapshotDetailRenderer[]` を単一ソースで宣言。`ActivitySnapshotDetail`（dispatcher）が `find(r => r.canRender(activity))` で先頭一致を選ぶ。一致すれば整形と raw を**タブで併存表示**（既定=整形、raw タブは常に到達可能。整形は raw を置き換えない＝要件 1.5）、一致が無ければ raw のみを表示する。登録は `defineRenderer(guard, Component)` ファクトリ経由とし、型ガードの絞り込み型を Component の props 型に結び付ける。これにより (a) guard と Component の action 取り違えがコンパイルエラーになり（登録の型安全）、(b) 整形コンポーネントは絞り込み済み型を直接受け取れて**再 narrow が不要**になる。homogeneous 配列で失われる型述語↔props 相関は、この factory 内 1 箇所の局所的 widening cast で橋渡しする（`any` は使わない。dispatcher が `canRender` 通過を保証するため cast は健全）。
- **Rationale**: coding-style「executors/loaders は work-set を入力として受け取り、consumer で特別扱いしない」「data-driven control」に合致。判別子=`action` の契約が dispatcher とレジストリの1箇所に閉じ、他所へ漏れない。
- **Trade-offs**: 現状エントリ1件で軽い over-engineering に見えるが、interface のみ一般化し実装は最小に保つ（synthesis の simplification に従い、動的登録・優先度・プラグイン機構などは作らない）。
- **Follow-up**: ADD 整形は、上流が (1) ADD 用 snapshot capture と (2) ADD 用型ガードを提供した後に、レジストリへ1エントリ追記＋新 renderer 追加で対応（本 spec では未実装）。

### Decision: snapshot 詳細は「行の展開（disclosure）」で表示する
- **Context**: 要件 1.1「管理者が snapshot 詳細表示を要求する」・1.4「既存 5 列を維持しつつ詳細を追加表示」。監査ログは 1 ページ最大 100 行。
- **Alternatives Considered**:
  1. 常時インラインの詳細列 — 実装単純だが 100 行が縦に肥大化し可読性が落ちる。「要求する」の含意（オンデマンド）とも弱い整合。
  2. 行の展開（disclosure）— 既定は折りたたみ、caret で展開すると全幅の詳細サブ行を表示。UX 良好・「要求する」に整合。
- **Selected Approach**: `ActivityTable` の各行を `ActivityTableRow` へ抽出し、行ローカルの展開 state（`useState<boolean>`）を持たせる。先頭に disclosure（caret）列を1つ追加（既存 5 列は不変＝要件 1.4）。展開時のみ `<td colSpan>` の詳細サブ行に `ActivitySnapshotDetail` を描画（未展開時は詳細を mount しない＝軽量）。
- **Rationale**: 既存テーブル構造・`data-testid` を保ちつつ最小追加。行ローカル state なので全行再描画を招かない。
- **Trade-offs**: 行コンポーネント抽出で1ファイル増えるが、coding-style（小さく凝集した多数ファイル）に沿う。
- **Follow-up**: `data-testid` は既存（`activity-table`）を保持し、詳細サブ行に別 testid を付す。

### Decision: raw ビューアは snapshot の全フィールドをそのまま key-value 表示する
- **Context**: 要件 1.1「snapshot に含まれる全フィールドをキーと値の対で表示」・1.3/3.4（欠損・不在でも例外を出さない）。
- **Selected Approach**: `RawSnapshotDetail` が `Object.entries(snapshot)` を列挙し、各キー/値を `<dl>` 等で描画。値は文字列化して React のテキストとして出す（自動エスケープ）。snapshot が `null`／空なら「詳細なし」プレースホルダを描画（例外を投げない）。API が透過する `snapshot._id`/`id`（Prisma composite の内部 id）も raw の性質上そのまま表示する。
- **Rationale**: 要件文言（「全フィールド」）に忠実。フィルタ等の特別扱いを入れないことで単純さと予測可能性を保つ。
- **Trade-offs**: 内部 id が raw 表示に混ざるが、raw ビューアの目的（記録の生確認）と矛盾しない。
- **Follow-up**: 値が object/array のケース（現状 snapshot には無いが将来）に備え、文字列化は `String(v)` ではなく安全な整形（object は `JSON.stringify`）を実装時に検討。

### Decision: ページリンクとバイト整形は既存資産を採用する
- **Context**: 要件 2.2（人間可読サイズ）・2.3（ページリンク）。
- **Selected Approach**: サイズは `pretty-bytes`（前例あり）。ページは `PagePathHierarchicalLink` + `new LinkedPagePath(pagePath)`（エンコード・trash 判定を委譲）。`pagePath` 欠損時はリンクを張らずフォールバック文言（要件 3.2）。添付削除は実体が無いため**ダウンロードリンクを一切出さない**（要件 2.4）。
- **Rationale**: build-vs-adopt で adopt。新規依存ゼロ・GROWI 既存の描画規約に整合。

### Decision: i18n は英語ファースト＋翻訳を後続タスクへ分離する
- **Context**: 要件 4 は全 5 ロケール提供を求めるが、新ラベルのたびに 5 ファイルを触るのは負担になりうる（ユーザ指摘）。また i18n の増分は「新 action 対応」ではなく「その action の整形表示を作るか」に紐づく（raw フォールバックはキー名を出すだけでラベル不要）。
- **Alternatives Considered**:
  1. 初回から全 5 ロケールを埋める — 要件 4.1 に即合致だが、翻訳待ちでコード完成がブロックされうる。
  2. 英語のみ追加し他は i18next フォールバック、翻訳は後続タスク — コードは英語で完成・検証でき、翻訳は疎結合に切り出せる。
- **Selected Approach**: 初回実装は `en_US/admin.json` に英語ラベルを追加。ja/ko/zh/fr は i18next の欠落時フォールバック（要件 4.3）で英語表示となり機能は成立。4 ロケール翻訳は独立した後続タスクとし、実施要否・時期は後から判断する。要件 4.1 は維持（後続タスク完了で充足）。
- **Rationale**: 翻訳が UI ロジックを変えないため疎結合に分離できる。コード実装のゲートに翻訳未了を含めない＝完成・検証を妨げない。
- **Trade-offs**: 翻訳未了の間、非英語 UI でも該当ラベルは英語表示になる（フォールバックで破綻はしない）。恒久的に非英語を提供しない判断をする場合は requirements.md 4.1 の更新が必要。
- **Follow-up**: tasks 生成時、翻訳追記を末尾の独立タスク（受け入れ条件＝4 ロケールにキー存在）として切る。

## Risks & Mitigations
- **リスク: レジストリの型述語と Component props 型を homogeneous 配列で相関できない** → `defineRenderer(guard, Component)` ファクトリで型を結び付け、唯一の widening cast を factory 内 1 箇所に閉じ込める。既存 `isAttachmentRemoveActivity` の引数型は `Pick<IActivity,'action'|'snapshot'>`・述語は snapshot を `AttachmentRemoveSnapshot` に絞る形なので、factory のジェネリック制約がこの型ガードを受理できることを実装時の型検査で確認する（噛み合わない場合は制約調整か明示型引数。上流の型ガード定義は変えない）。
- **リスク: 将来 `canRender` が非排他になると先頭一致で silent shadow** → 「`action` 判別・互いに排他・1 action=1 エントリ・配列順=優先順」を design の不変条件として明記し、レビューで担保する。
- **リスク: raw 表示・整形表示がユーザ制御文字列（`originalName`/`pagePath`）を描画** → React のテキスト自動エスケープに委ね、`dangerouslySetInnerHTML` を使わない。href エンコードは `LinkedPagePath` に委譲。画面は admin 限定ルートで既にガード済み。
- **リスク: ADD の snapshot が未記録のまま viewer が ADD 整形を期待するとデータ不一致** → ADD 整形を初回スコープから除外（未対応 action は raw fallback）。上流の ADD capture 完了までレジストリに ADD を登録しない。
- **リスク: 既存 `username` のみ／snapshot 無しの旧レコードと新レコードの混在** → dispatcher は `action` で分岐し、非添付は raw/プレースホルダへ。既存 user 列・action 列の描画は不変（要件 5）。
- **注記（上流申し送り、本 spec スコープ外）**: 記録ゲート導入後、新規 `ACTION_UNSETTLED` 行は「失敗・中断した試行」を意味し、旧データの残骸と TTL 満了まで併存する。viewer は UNSETTLED を特別扱いせず、非添付 action として raw fallback で描画するだけであり、本設計に影響しない。

## References
- PR #11393 — 添付削除 snapshot の capture・API 露出（消費するデータの出所）
- 隣接 spec: `.kiro/specs/activity-log-snapshot/`（snapshot 記録・型・API）、`.kiro/specs/activity-log/`（記録ゲート）
- `apps/app/src/interfaces/activity.ts` — `ISnapshot` / `AttachmentRemoveSnapshot` / `isAttachmentRemoveActivity` / `SupportedAction`
- `apps/app/src/server/routes/apiv3/activity.ts` — `GET /_api/v3/activity`（snapshot 透過）
- `.claude/rules/coding-style.md` — data-driven control / executors take work-set / module public surface
