# Gap Analysis: admin-permission-delegation

> Phase: requirements → design の間の gap 分析（brownfield・**高リスク spec**）。
> 要件 [requirements.md](./requirements.md) と既存コードの差分を洗い、変更範囲・懸念・実装案を提示する。
> 依存: base sub-spec `authorization-core`（`authorize()` / Role / capability カタログ）。

## Analysis Summary

- **朗報**: 各管理ルートは既に `accessTokenParser([SCOPE.READ|WRITE.ADMIN.<section>])` で**必要な
  capability（＝SCOPE）を1経路ずつ宣言済み**。ゲート置換は「新 capability を発明して配線」ではなく
  「その経路が既に宣言しているスコープを `authorize()` で要求する」に落ちる → 大幅に低リスク化。
- **変更範囲は広い**: `adminRequired` は**28–29 ファイル / 約 145 経路**に per-route で散在（router
  レベルの一括ゲートは無い）。1経路の付け忘れ＝バイパス。**網羅が最重要**。
- **クライアントに capability が届いていない**: admin ナビは**ハードコードの静的リストで per-item
  ゲート無し**、画面ゲートは `AdminPageFrame` が `currentUser.admin` を見るだけ。ナビ事前反映（R5）
  には**ユーザーの capability 集合を client へ配る新経路**が要る（現状 `admin` bool しか届かない）。
- **除外経路の取り扱いが安全性の要**: `/healthcheck`・`/installer`（ブートストラップ）・vault user
  API（login のみ）は**capability ゲートを付けてはいけない**。誤って付けると起動/初期設定を締め出す。
- 推奨は **Option C（新 `requireCapability` ミドルウェア＋既存 SCOPE 注釈の再利用＋curated
  インベントリ＋client capability 配信＋段階置換）**。総じて **XL / High**（面と安全性）。

## 1. Current State（確定した実態）

| 項目 | 実態 | 位置 |
|---|---|---|
| 管理ゲート | `adminRequired`＝`req.user.admin` 二値。**router 一括ゲートは無く per-route のみ** | `middlewares/admin-required.ts`、`routes/apiv3/index.js`（routerForAdmin は grouping のみ） |
| 経路数 | **約 145 経路 / 28–29 ファイル**（server core 21＋feature 7＋SSR page gate） | §7 下記 |
| **capability 注釈** | 各経路に `accessTokenParser([SCOPE.<R/W>.ADMIN.<section>])` が**既に宣言済み** | 例 `admin-home.ts:92`, `activity.ts:220` |
| チェーン順 | `accessTokenParser(scope) → loginRequiredStrictly → adminRequired → handler` | 全 admin ルート共通 |
| token と admin | 独立ゲート。token は `req.user` を埋めるだけ。**token 経由でも user.admin が真でないと通らない** | `access-token-parser`, `access-token.ts:47` |
| client admin ナビ | **静的ハードコードリスト・per-item ゲート無し**（全項目表示） | `components/Admin/Common/AdminNavigation.tsx:221-332` |
| client 画面ゲート | `AdminPageFrame` が `isAccessDeniedForNonAdminUser`(=`!currentUser.admin`)→Forbidden | `pages/admin/_shared/AdminPageFrame.tsx:36`, `get-server-side-common-props.ts:36` |
| client への権限配信 | **`currentUser.admin`(bool) と `readOnly` のみ。capability/scope 集合は届いていない** | `common-props/commons.ts`, `states/global/global.ts` |
| 除外経路 | `/healthcheck`・`/installer`（ゲート無し）、vault user API（login のみ）、test-mode passthrough | `apiv3/index.js:92,169-172,203` |
| 流用できる管理 CRUD UI | UserGroup 管理（一覧/作成/編集/削除/メンバー付与） | `client/components/Admin/UserGroup/`, `stores/user-group.tsx`, `apiv3/user-group.js` |

## 2. Requirement-to-Asset Map（要件↔資産、gap タグ）

| 要件 | 使える資産 | Gap（Missing / Unknown / Constraint） |
|---|---|---|
| R1 セクション capability 定義 | **既存 SCOPE の ADMIN 分類がそのまま使える** | **Constraint**: 各経路の宣言済みスコープを capability として採用。**Unknown**: read/write 粒度をロールでどう束ねるか |
| R2 ロール管理（CRUD） | authorization-core の `Role`、UserGroup 管理 UI パターン | **Missing**: ロール管理 API＋画面 |
| R3 付与・解除 | authorization-core の `RoleAssignment`、UserGroupRelation UI パターン | **Missing**: 付与 API＋画面 |
| R4 アクセス制御（網羅・token 互換） | 各経路の SCOPE 注釈、`authorize()` | **Missing**: `adminRequired`→`requireCapability` 置換（**~145 経路**）。**Constraint**: 除外経路を誤ってゲートしない。**Unknown**: token 経路の意味（後述 DD-B） |
| R5 ナビ/画面の事前反映 | `AdminNavigation`、`AdminPageFrame`、`currentUserAtom` | **Missing**: **client への capability 集合配信**（新 SSR prop/API）、ナビ per-item ＋ frame の capability ゲート化 |
| R6 後方互換 | authorization-core の `admin ⇒ 全 capability` | **Constraint**: 置換後も admin/非 admin の観測が不変。移行不要 |
| R7 昇格防止 | — | **Missing**: ロール管理操作自体のゲート、「自身の持たない capability を付与不可」検証 |

## 3. Blast Radius（変更範囲マップ）＋ 5項目チェック

### 変更範囲

| レイヤー | 触るか | 内容 | リスク |
|---|---|---|---|
| Server ミドルウェア | 新規＋置換 | `requireCapability` 新設、`adminRequired` を **~145 経路**で置換 | **High**（網羅漏れ＝バイパス） |
| Server ルート（管理 API） | 変更 | 28–29 ファイルの per-route ゲート差し替え | High |
| Server ルート（除外） | 触らない | `/healthcheck`・`/installer`・vault user は据え置き | 中（誤置換＝ロックアウト） |
| ロール管理 API | 新規 | ロール CRUD＋付与（apiv3） | 中 |
| DB | 既存利用 | authorization-core の `roles`/`roleassignments` を使用（本 spec で新設なし） | 低 |
| Client（ナビ/画面） | 変更＋新規 | capability 集合の受領、ナビ per-item＋frame ゲート、ロール管理画面 | 中 |
| 権限挙動 | **変更**（ここで初めて挙動が変わる） | admin ゲートが capability ベースに | High（後方互換必須） |

### 名指し領域への影響（前回と同じ観点）
- **Page / Revision / Elasticsearch / Plugin 機構本体**: 🟢 **触らない**。ただし **plugin の*管理ルート***
  （`growi-plugin/.../admin` 5 経路）と mastra/vault/external-user-group/news の feature 系管理ルートは
  **置換対象に含める**（見落とし注意）。プラグインの読み込み・配信機構自体は不変。

### 5項目チェック（authorization-core と対照）

| 観点 | 評価 | 中身 |
|---|---|---|
| パフォーマンス | 🟡 | admin 経路で判定毎にロール＋グループ解決。admin は低トラフィックだが、**ナビ表示で全 capability を1回算出**。→ request/session スコープでキャッシュ。悪化は限定的 |
| セキュリティ | 🔴 **最重要** | 付け忘れ＝**CWE-862/863 権限バイパス**。除外経路の誤ゲート＝ロックアウト。R7 の**昇格防止**。client 配信は enforcement に使わない（server 権威）。fail-closed。→ 経路インベントリ固定＋回帰＋段階置換で管理 |
| 運用コスト | 🟡 | 3 概念（admin/readOnly/ロール）＋ロール管理画面。問い合わせ増・ドキュメント要。粒度を粗く始めて緩和 |
| 互換性 | 🟡 | **token API 利用者**（DD-B）と**既存フル管理者**を壊さない。feature 系管理ルートの取りこぼしが互換の穴 |
| 保守性 | 🟢〜🟡 | 置換後は「経路にスコープ宣言＋`requireCapability`」で一貫（既存 accessTokenParser 注釈と同型）。**注釈とゲートのドリフト検出テスト**を入れれば保守性は上がる |

## 4. Implementation Approach Options

### Option A: `adminRequired` を各経路でその場改造
- 既存の `adminRequired` 適用箇所を1つずつ capability チェックに書き換え。
- ✅ 構造変更が小。❌ 145 箇所を個別編集＝レビュー負荷大・一貫性が崩れやすい。

### Option B: 汎用 `requireCapability(scope)` を新設し各経路に明示適用
- 新ミドルウェアを per-route で付与、`adminRequired` は撤去。
- ✅ 明示的で読みやすい。❌ 145 箇所の付与を手作業＝網羅は結局同じ課題。

### Option C: `requireCapability` ＋ **既存 SCOPE 注釈の再利用** ＋ curated インベントリ ＋ client 配信（本命）
- 新 `requireCapability` は、その経路が既に宣言している `accessTokenParser` のスコープを**必要 capability
  として再利用**（多重宣言を避ける）。除外経路は明示リストで除く。
- client には user の実効 capability 集合を SSR prop/API で配信し、ナビ per-item＋`AdminPageFrame` を
  capability ゲート化。ロール管理画面は UserGroup UI を踏襲。
- 後方互換（admin=全 capability）で無害化しつつ**ファイル単位で段階置換**、各段で回帰。
- ✅ 目的（網羅・一貫・既存資産再利用）に最適。❌ 計画が最も要る（インベントリ＋client 配信の新設）。

## 5. Effort & Risk

| 項目 | Effort | Risk | 一言 |
|---|---|---|---|
| `requireCapability` ミドルウェア | S–M | Medium | authorize を呼ぶ薄い adapter |
| **~145 経路の置換（段階）** | **L–XL** | **High** | 網羅＝安全性。ファイル単位＋回帰 |
| 除外経路の保護 | S | **High** | 誤ゲート＝ロックアウト。明示除外リスト |
| ロール管理 API＋UI | M–L | Medium | UserGroup パターン流用 |
| client capability 配信＋ナビ/frame ゲート | M | Medium | 新 SSR prop/atom。enforcement は server |
| 後方互換回帰 | M | **High** | admin/非 admin×代表経路のスナップショット |
| **合計** | **XL** | **High** | 面と安全性が支配的 |

## 6. Recommendations for Design Phase

- **採用**: Option C。
- **Key decisions（design で確定・承認時に確認）**:
  - **DD-A（推奨）**: 必要 capability は**各経路の既存 SCOPE 注釈を再利用**（新規宣言しない）。
    read/write 粒度は宣言済みスコープ（`READ.ADMIN.X`/`WRITE.ADMIN.X`）をそのまま採用。
  - **DD-B**: token 経路の意味。**現状維持（token の user が capability を持つ場合に許可＝admin は従来
    どおり通過、委譲ユーザーも capability があれば通る後方互換な拡張）**を推奨。「token スコープ単体で
    付与」は意味変更のため不採用。token 評価パス自体は変更しない。
  - **DD-C**: client への capability 配信方式（SSR prop に per-section 真偽マップ or 実効 capability 集合）。
    enforcement はサーバー、client は表示用。
  - **DD-D**: ロール管理操作のゲート capability（導入時はフル admin 限定、将来 `manage:roles` 的 capability へ）。
- **Research Needed（design で調査）**:
  - **経路インベントリの確定表**（経路→宣言スコープ→必要 capability）。スコープ未宣言の管理経路が無いか
    確認（例外の healthcheck/installer を除外リストへ）。
  - feature 系管理ルート（growi-plugin/mastra/vault/external-user-group/news）の網羅。
  - client capability 配信の粒度と SSR コスト。
  - 注釈とゲートの**ドリフト検出テスト**（全 admin 経路が「スコープ＋capability ゲート」を持つことを保証）。
- **段階置換の順序案**: 影響小・独立性高いファイルから（例 markdown-setting → customize → notification →
  … → users/user-group）。各段で「admin/非 admin の観測不変」回帰を必須化。

## 7. 経路カウント（確定）
- 管理ゲート適用ファイル: **28–29**（server core 21＋feature 7＋SSR page gate 1）。
- `adminRequired` 適用サイト: **約 145**（per-route 143＋`adminRequiredIfInstalled` 1＋array 形 1）。
- feature 系管理ルートファイル: **7**。
- 除外（capability ゲート対象外）: `/healthcheck`・`/installer`＋vault user API（login のみ）。

---

# Design Synthesis Outcomes（design フェーズで確定）

## 1. Generalization（一般化）
- 145 のゲート置換は「その経路が既に宣言するスコープを要求する」同一操作 → 単一
  `requireCapability(capability)` に集約。per-route の個別ロジックを書かない。
- ロール管理は subject 種別（user/group）で汎用化。nav 事前反映は per-item を capability で汎用フィルタ。

## 2. Build vs Adopt（採用判断）
- **Adopt**: `authorization-core`（authorize/Role/RoleAssignment/catalog）、**各経路の既存 SCOPE 注釈**を
  必要 capability として再利用、UserGroup 管理 UI パターン、`accessTokenParser` チェーン位置、
  `currentUser` SSR 配信。
- **Build**: `requireCapability`、ロール管理 API/UI、client capability 配信、単一インベントリ＋
  ドリフト検出テスト。
- **Reject**: 経路ごとに新 capability を発明（既存スコープ注釈と二重化）。

## 3. Simplification（単純化）
- 新 capability は原則作らず既存 SCOPE を再利用。追加は**ロール管理用の1つ**（`write:admin:role_management`）のみ。
- 除外経路は明示リストで管理（自動判定に頼らない）。
- client capability は表示用のみ（enforcement はサーバー）。role 管理は導入時 admin 限定で単純化。

## Design Decisions（承認時に確認したい pivotal 決定）
- **DD-A**: 必要 capability = 各経路の既存 SCOPE 注釈の再利用（read/write 粒度もそのまま）。
- **DD-B**: token 経路は現状維持（token スコープ ∧ user capability）。token 評価パス不変。
- **DD-C**: client へ実効 capability を SSR prop 配信し nav/frame をゲート（表示用・サーバー権威）。
- **DD-D**: ロール管理は `write:admin:role_management` を要求（導入時 admin 限定・将来委譲可）。

## Risks carried to tasks
- **網羅（4.3）**: 単一インベントリ＋ドリフト検出テスト＋段階置換＋回帰で「未適用経路ゼロ」を保証。
- **除外経路のロックアウト防止**: healthcheck/installer/vault user を明示除外しテストで保護。
- **段階置換順**: 影響小の独立ファイルから、最後に users/user-group。各段で admin/非 admin 観測不変の回帰。
- feature 系管理ルート（growi-plugin/mastra/vault/external-user-group/news）の置換取りこぼし防止。

## Design Review 反映（/kiro-validate-design, GO 条件付き → 反映済み）
- **Issue 1（網羅の接地）**: ドリフト検出を GROWI 既存の route-middleware スナップショット＋
  `route-middleware-baseline.json` に接地。**変種ゲート形**（vault 配列 / g2g `adminRequiredIfInstalled` /
  news 条件付き）をインベントリに明示列挙。design「admin-capability-inventory」「Testing」に反映。
- **Issue 2（粒度）→ DD-E 追加**: enforcement は per-scope のまま、構成/表示は**セクション束
  `AdminSection`** 単位。`RoleForm` はセクションごと `none/view/manage` を選び read/write スコープへ展開。
  design「DD-E」「admin-capability-inventory」「AdminNavigation/AdminPageFrame」「Role 管理 UI」に反映。
- **Issue 3（後方互換の接地）**: 回帰を `authz-matrix-baseline.json`（＋`ws-authz-baseline.json`）に接地。
  design「Testing/後方互換回帰」に反映。

---

# Pre-Tasks 懸念分析（5観点）

## 観点1: 変更範囲 — 見落とし層「HTTP ルート以外の admin 判定」（最重要の新発見）

`adminRequired` の置換だけでは届かない admin 権威が散在。ただし**本 spec は admin フラグを温存
（admin===true ⇒ 全 capability）**するため、多くは「壊れない」が「委譲ユーザーには効かない」。
スコープの線引きが要る:

| 箇所 | 位置 | 判定 |
|---|---|---|
| ページ削除権限 `operator.admin` | `service/page/index.ts:307,405`（canDelete系） | ページ権限側。admin 温存で不変 → **Out（granular 領域）** |
| admin 存在確認 `findAdmins` / `checkSetupStrategiesHasAdmin` | `models/user/index.js:459`, `security-settings/checkSetupStrategiesHasAdmin.ts` | admin フラグ温存で不変。admin 廃止時のみ問題 → **将来注意** |
| ルート内 inline `req.user.admin` | `users.js:145,175,1593,1605`・`share-links.js:420` | ルート通過後の**フィールド/挙動ゲート**。委譲ユーザーは非 admin 分岐に落ちる → **要スコープ判断** |
| **socket-io admin namespace** | `socket-io.ts:114-122`（`adminRequired` を socket MW に再利用） | 置換が**推移的に波及**。socket は単一ゲート＝必要 capability を決める要 → **In（要決定）** |
| admin フラグ mutator | `models/user/index.js:316-340` grant/revokeAdmin | 温存・併存（ロール付与が supplement） → 不変 |
| client 操作ゲート | `states/context.ts:36`(`useIsAdmin`)、Maintenance/GrantSelector/ShareLink/AccessTokenScopeSelect | nav 以外の admin 操作ゲート。委譲ユーザーは非 admin 表示 → **要スコープ判断（初期は据え置き可）** |
| 並行 transport = access-token SCOPE | 各 admin ルートに `SCOPE.*.ADMIN.*` 既宣言 | DD-A/DD-B を再確認。GraphQL は無し |

→ **スコープ明確化が必要**（下記「要決定」）。

## 観点2: 類似機能・失敗パターンからの類推

**GROWI 内部（git/コードの実績）**:
- **page-grant は null/空コレクション由来のバグ常連**（`grantedUsers` 空、optional user、guest ロジック
  で `fix` 多数）。→ `composeCapabilities` は**空ロール・所属グループ無し・削除済みグループ参照**に
  null-safe 必須。
- **multi-group / duplication の不具合クラスタ**、**user-group 削除のエッジ**（削除時の巻き込み）。
  → **UserGroup/ExternalUserGroup 削除時に RoleAssignment を cascade**（孤児付与を残さない）必須。
- **NoSQL injection / CodeQL 修正**の履歴。→ capability はカタログ由来のみ（自由入力を query に入れない）、
  ロール名/クエリはパラメタライズ。
- **`Scope` 型の TS2589「型が深すぎる」エラーが再発履歴あり**。→ **DD-A（SCOPE 流用）の保守性リスク**。
  capability は既存 SCOPE を*参照*するに留め、型の深さを増やさない（新ジェネリック階層を足さない）。
- comment 権限は**作成者のみ・admin override 無し**、readOnly は後付けで**コメント例外**が生えた。
  → capability ゲートは特例が accrete しやすい。特例は config/明示リストで一元管理。

**OSS 一般（RBAC の定番の落とし穴）**:
- 権限/ロール爆発（細かすぎて UI 破綻）→ **DD-E セクション束**で緩和。
- admin ロックアウト（最後の管理者/ロール管理者を失う）→ **admin フラグを最終権威に温存**。
- 権限変更の反映遅れ（キャッシュ）→ GROWI は**権限キャッシュ無し＝常に最新**（B8）で低リスク。
- 「なぜ見えない/触れない」の混乱（部分付与・read/write）→ **DD-E view/manage** で緩和。
- 移行時の既存連携破壊 → **後方互換（admin=全）＋段階置換**。
- 自己昇格 → **R7.3**。

## 観点3: 非機能チェックリスト（机上）

| 観点 | 評価 | メモ |
|---|---|---|
| パフォーマンス | 🟡 | **権限キャッシュは存在しない**（B8）。判定毎に populate。admin は低トラフィックだが nav 表示で実効 capability を1回算出。→ request スコープ memo を検討 |
| セキュリティ | 🔴 | 経路網羅（CWE-862/863）、**非ルート判定の取りこぼし（観点1）**、socket ゲート、昇格（R7.3）、fail-closed。injection 履歴に倣いカタログ束縛 |
| 運用コスト | 🟡 | 3 概念＋ロール UI。**「委譲admin なのに X が見えない」問い合わせ**（inline `.admin` 由来）。ドキュメント必須 |
| 互換性 | 🟡 | token 利用者（DB-B 温存）、既存フル admin 不変、feature 系ルート網羅。**TS2589 保守ハザード** |
| 保守性 | 🟡 | 置換後は一貫。ただし SCOPE 型深さ・特例 accrete・cascade 忘れがドリフト源 → ドリフト検出＋cascade テスト |

## 観点4: 「誰が困るか」

- **OSS セルフホスト**: 移行はゼロタッチ必須（admin=全 で不変）。admin API トークン自動化は user が admin
  なら不変（DB-B）。新ロール UI は学習コスト。
- **GROWI.cloud 顧客**: 委譲 admin は価値だが、テナント越え漏れ厳禁（capability は user 単位、テナント分離
  は既存に依拠）。cloud 運用が admin フラグ前提の自動化を持つ場合の影響確認。
- **開発チーム**: 145 経路移行・ドリフト検出保守・TS2589・回帰ベースライン整備・cascade。負荷は XL。
- **サポート**: 「アクセス喪失」「部分 admin の作り方」。inline `.admin` 由来の“中途半端に見えない”混乱。

## 観点5: モック/シーケンスで見えるエッジケース

1. 委譲ユーザーが、通過できるルート内の **inline `req.user.admin` フィールドゲート**に当たり、静かに劣化データ
   （例 `users.js:175` forceIncludeAttributes）→ 挙動を決める。
2. **socket-io admin namespace**：import 進捗等を emit。委譲 import-admin は socket を受けられるべきか
   →必要 capability を決める（暫定「admin capability を1つ以上」）。
3. **admin/user 両マウントのルート**（`search.js`・`pages`・`share-links`）：admin op のみ per-route ゲート。
   置換時に user op を壊さない。
4. **最後のロール管理者/admin ロックアウト**：admin フラグ温存で回避。
5. **UserGroup 削除 → グループ付与ロールの孤児 RoleAssignment**：cascade 必須。
6. **カタログから消えた capability を Role が参照**：authorize は fail-closed で拒否、UI は警告表示。
7. **token 委譲ユーザー**：`accessTokenParser`（token scope）＋`requireCapability`（user capability）両通過で
   admin API 利用可（新挙動・後方互換な拡張）→ 意図確認。

## 要決定（tasks 前 or tasks の制約として）
- **DEC-1**: 非ルート admin 判定の扱い。推奨＝サービス層 `operator.admin`（ページ削除）は **Out**（admin 温存で不変）。
  inline `.admin` フィールドゲート・client 操作ゲート（Maintenance/GrantSelector/ShareLink）は**初期据え置き**
  （委譲ユーザーは非 admin 挙動）とし、既知の制約として明記。
- **DEC-2**: **socket-io admin namespace** は「admin capability を1つ以上」で許可（＝管理シェルと同基準）。**In**。
- **DEC-3**: **cascade**（UserGroup/ExternalUserGroup/User 削除時に RoleAssignment を除去）を design/tasks に追加。
  authorization-core の RoleAssignment 所有だが、削除フックの接続先は本 spec が触れる範囲と重なるため要調整。
- **DEC-4**: **TS2589 対策**：capability は SCOPE を参照するのみ・型の深さを増やさない、を design 制約に明記。
- **DEC-5**: **null-safety**：`composeCapabilities` の空ロール/無所属/削除済み参照を必須ユニットテストに。
