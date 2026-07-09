# Gap Analysis: authorization-core

> Phase: requirements → design の間の gap 分析（brownfield）。要件
> [requirements.md](./requirements.md) と既存コードの差分を洗い、design 判断の材料を提供する。
> 決定はしない（options と research-needed を提示する）。

## Analysis Summary

- **capability の語彙は「発明」ではなく「既存資産の再利用」になり得る。** `SCOPE`
  （`packages/core/src/interfaces/scope.ts`）が既に `{action}:{category}:{sub}`（例
  `read:admin:security` / `write:admin:user_group_management`）で admin セクションを列挙し、
  `accessTokenParser([SCOPE...])` とクライアント `parseScopes({scopes,isAdmin})` に配線済み。
  authorization-core の権限カタログはこれと**統合/整合**させるのが最有力。
- **`authorize()` の住処は新規サービス**。既存 `aclService` は wiki-mode/guest 専用で user/
  resource を受けず、判定入口には不適。`new AuthorizationService(crowi)` を Crowi に足す既存
  パターンがある。
- **Role の永続化は Mongoose / Prisma の実選択**。Prisma は既に runtime 稼働（bookmarks /
  externalaccounts）。User/UserGroup は Mongoose 主で移行途中。新規 `Role` はどちらでも作れる。
- **後方互換は既存の `isAdmin` 特別扱いに素直に乗る**。admin===true を全 capability とする扱いは、
  クライアント `parseScopes` が既に `isAdmin` 時に ADMIN/ALL scope を素通しする挙動と一貫。
- 全体として **Option C（ハイブリッド：新規サービス＋モデル ＋ 既存 SCOPE 語彙の再利用＋既存
  page 判定への委譲）** が本命。総じて **L / Medium**。

## 1. Current State（現状の関連資産）

| 領域 | 既存資産 | 位置 |
|---|---|---|
| admin ゲート | `adminRequired`（`req.user.admin` 二値）。chain は `accessTokenParser(scope) → loginRequiredStrictly → adminRequired → handler` | `middlewares/admin-required.ts`、22 apiv3 + 3 feature ルート |
| **capability 語彙** | **`SCOPE`（`SCOPE_SEED_ADMIN`/`SCOPE_SEED_USER`、`ACTION={READ,WRITE}`）**。admin セクション網羅（security/markdown/customize/import_data/export_data/data_transfer/user_management/user_group_management/audit_log/plugin/full_text_search 等） | `packages/core/src/interfaces/scope.ts` |
| scope 消費 | `accessTokenParser([SCOPE.READ.ADMIN.TOP])`、client `parseScopes({scopes,isAdmin})` | `admin-home.ts:94`、`client/util/scope-util.ts:64` |
| ページ判定 | `PageGrantService.isUserGrantedPageAccess()`（真偽）。`editScope`/`resolveEffectiveRole` は**未実装** | `service/page-grant.ts:1153` |
| グループ解決 | `getUserRelatedGroups(user)` → `UserGroupRelation.findAllGroupsForUser` ＋ external | `service/page-grant.ts:1056` |
| ROM | `excludeReadOnlyUser` / `...IfCommentNotAllowed`（config `security:isRomUserAllowedToComment`） | `middlewares/exclude-read-only-user.ts` |
| ACL | `aclService`（wiki-mode/guest のみ、user/resource 非受領、config 駆動の singleton） | `service/acl.ts` |
| サービス登録 | `crowi.xxxService` 定義代入。singleton attach か `new XxxService(this)`（順序依存） | `crowi/index.ts:122-138, 747, 855` |
| Role 相当 | **なし**（`user.admin` boolean のみ）。ロール/権限コレクション不在 | `packages/core/src/interfaces/user.ts:15` |
| 現在ユーザー→client | SSR props `currentUser: IUserHasId(admin 含む)` → `currentUserAtom` → `useCurrentUser`。専用 SWR なし | `pages/common-props/commons.ts:99,173`、`states/global/global.ts:16,24` |
| ORM | User/UserGroup=Mongoose 主。Prisma は schema 全モデル＋runtime 稼働（bookmarks/externalaccounts） | `prisma/schema.prisma`、`utils/prisma.ts:152` |

## 2. Requirement-to-Asset Map（要件↔資産、gap タグ）

| 要件 | 既存で使える資産 | Gap（Missing / Unknown / Constraint） |
|---|---|---|
| R1 単一判定 | サービス登録パターン、`aclService` の形（ただし住処は新規） | **Missing**: `authorize(user,action,resource?)` そのもの。**Constraint**: guest/未認証と action 種別の扱いを明確化 |
| R2 capability/ロール/カタログ | **`SCOPE` 分類が capability 語彙の下地**。`ACTION`、admin セクション列挙 | **Missing**: Role モデル、カタログ API。**Unknown**: SCOPE と capability を*同一語彙に統合*するか、別途 capability を定義して SCOPE と対応付けるか（設計判断） |
| R3 付与/合成 | `getUserRelatedGroups`（グループ解決）、UserGroupRelation/External | **Missing**: user/group への role 付与の保存、実効 capability 合成。**Unknown**: 合成のキャッシュ（判定毎のグループ解決コスト） |
| R4 後方互換 | client `parseScopes` の `isAdmin` 素通し（前例）、`user.admin` | **Constraint**: admin===true⇒全 capability、ロール未設定時に既存決定と完全一致。**Missing**: 回帰の基準（既存挙動スナップショット） |
| R5 page 委譲 | `isUserGrantedPageAccess`（read 委譲先） | **Constraint**: `page:edit` 委譲先（`resolveEffectiveRole`）は granular 依存で**未実装**＝Where 条件で吸収済み。granular の残す/消す未決 |
| R6 ROM 分離 | `readOnly` / `excludeReadOnlyUser` は不変 | **Constraint**: capability 判定は readOnly を根拠にしない。分離の明示 |
| R7 消費者提供 | scope chain（`accessTokenParser`）が並走 | **Unknown**: token scope と role capability の**評価の統合**（両者とも「許可される action 集合」を表す）をどこまでやるか |

## 3. Implementation Approach Options

### Option A: 既存を拡張（aclService / adminRequired に相乗り）
- aclService に判定を足す、または adminRequired を capability 対応に拡張。
- ✅ 新規ファイル最小。❌ aclService は config 専用で責務が汚れる／`authorize` の一般形に合わず破綻。判定点の集約という目的に反する。**非推奨**。

### Option B: 全面新規（SCOPE も無視して独自 capability 体系）
- 新 `AuthorizationService` ＋ 新 capability 名前空間（例 `admin:usergroup:manage`）を SCOPE と別に定義。
- ✅ クリーン。❌ **SCOPE と二重の語彙**が生まれ、token scope と role capability が別分類になって整合コスト・混乱。access-control umbrella の「1つの基盤」志向に逆行。

### Option C: ハイブリッド（本命）
- **新規** `AuthorizationService(crowi)`（判定入口）＋ **新規** `Role` モデル（capability 集合の付与保存）。
- **既存 SCOPE を capability 語彙として再利用/整合**（admin/account 系 action は SCOPE 文字列、または SCOPE から導出した capability に対応付け）。
- **ページ系は既存 `PageGrantService` へ委譲**（read=`isUserGrantedPageAccess`、edit=Where 条件で granular へ）。
- **後方互換**は admin===true⇒全 capability の遅延既定（データ移行不要）。
- ✅ 目的（単一判定・1語彙・既存資産温存）に最も合致。token scope と role capability を将来1つの評価に寄せられる。❌ 計画が最も要る（SCOPE 統合の設計、Role 永続化の ORM 選択）。

## 4. Effort & Risk

| 項目 | Effort | Risk | 一言 |
|---|---|---|---|
| AuthorizationService＋`authorize()` 骨格 | M | Medium | 新サービスだが登録パターンは既存 |
| Role モデル＋付与保存 | M | Medium | ORM 選択（Prisma/Mongoose）が後戻りコスト |
| SCOPE との語彙統合/整合 | M | **High** | 既存 token 認可への影響。整合を誤ると token 権限に波及 |
| 実効 capability 合成（直接∪グループ） | S–M | Medium | グループ解決は既存ヘルパ再利用可。キャッシュは要検討 |
| 後方互換＋回帰テスト | M | **High** | 網羅漏れ＝権限バイパス。基準スナップショットが要る |
| page:* 委譲アダプタ | S | Low | read は既存 API に薄く委譲。edit は granular 待ち（Where） |
| **合計** | **L** | **Medium** | 骨格＋モデル＋語彙整合＋回帰 |

## 5. Recommendations for Design Phase

- **採用アプローチ**: Option C（新規サービス＋Role モデル＋SCOPE 語彙の再利用＋page 委譲）。
- **Key decisions（design で確定）**:
  1. **SCOPE と capability の関係** — (a) capability = SCOPE 文字列そのものを採用、(b) capability を新設し SCOPE へマッピング、(c) SCOPE を拡張して account 系（例 comment）を足す。→ 「1つの基盤」志向なら (a)/(c) が有力。token scope 評価と role capability 評価を**同じ語彙**に寄せられるか design で判断。
  2. **Role の永続化 ORM** — Prisma（移行方向・runtime 実績あり）か Mongoose（User/UserGroup と同居）。`mongoose-to-prisma` skill と整合。
  3. **実効 capability のキャッシュ** — admin 判定毎のグループ解決コストを request スコープで吸収するか。
  4. **guest/未認証の扱い** — action 種別（admin/account/page）ごとの既定（admin/account は deny、page は委譲で public 許容）。
  5. **後方互換の回帰基準** — 導入前の admin/非 admin の観測アクセスをスナップショットし、導入後一致を検証する仕組み。
- **Research Needed（design で調査）**:
  - token scope（`accessTokenParser`）と role capability を単一評価に統合する場合の影響範囲と後方互換。
  - Prisma で `Role` を新設した場合の Mongoose 併存（User は Mongoose）でのリレーション表現。
  - client の admin ナビ表示（現状 `useCurrentUser().admin`）を capability ベースへ寄せる際の SSR props / atom 拡張（本 spec 範囲外だが下流 `admin-permission-delegation` の前提として記録）。

## 6. 要件への軽微なフィードバック（任意）

- R2 の例示 `admin:usergroup:manage` は、既存 `SCOPE`（`write:admin:user_group_management`）と
  語彙がずれている。design で SCOPE 再利用に倒すなら、requirements の例示も SCOPE 準拠へ
  更新すると一貫する（挙動要件は不変）。今すぐの必須修正ではない。

---

# Design Synthesis Outcomes（design フェーズで確定）

## 1. Generalization（一般化）
- R1–R7 は「ユーザー × action（× resource）で許可か」の単一問題に集約。admin ゲートと
  アカウントロールは capability メンバーシップ判定の特殊化として、単一 `authorize()` ＋ action
  名前空間ディスパッチで表現。
- token scope 判定（`accessTokenParser`）と role capability 判定は、どちらも「許可される action
  集合に含まれるか」で同型 → **capability 語彙を SCOPE に一般化**（DD1）。ただし*評価パスの
  一本化*は現要件に無いため実装せず、語彙共有のみ（interface レベルの一般化に留める）。

## 2. Build vs Adopt（採用判断）
- **Adopt**: `SCOPE`（capability 語彙）、`PageGrantService.isUserGrantedPageAccess`（page:read 委譲）、
  `getUserRelatedGroups`（グループ解決）、Crowi サービス登録・`getOrCreateModel`。
- **Build**: `AuthorizationService`（欠落していた単一判定）、`Role`/`RoleAssignment`（付与の永続化）、
  `composeCapabilities`（合成）、`PageAccessPort`（委譲接合）。
- **Reject**: 独自 capability 名前空間の新設（SCOPE と二重語彙になり同期コスト）。

## 3. Simplification（単純化）
- 条件付き/ABAC・deny ルール・ロール階層は現要件に無いため作らない（capability メンバーシップのみ）。
- `PageAccessPort` はメソッド2つ（canRead/canEdit）の薄い Port に留め、プラグイン機構化しない。
  `canEdit` は暫定で `canRead` と同義（DD3）＝現状「閲覧可＝編集可」を保つ後方互換で、投機ではない。
- capability カタログは既存 `SCOPE` を包むのみ（別レジストリを新設しない）。

## Design Decisions（承認時に確認したい pivotal 決定）
- **DD1**: capability 語彙 = 既存 `SCOPE`。代替（独自 capability＋SCOPE マッピング）は二重語彙のため不採用。
- **DD2**: Role/RoleAssignment の永続化 = Mongoose（User/UserGroup と同居、cross-ORM 参照回避）。
  Prisma 移行は User/UserGroup と同時に（`mongoose-to-prisma`）。
- **DD3**: `page:edit` は当面 `page:read` と同一判定（後方互換）。`granular-page-permissions` の
  `canEdit` 提供時に `PageAccessPort` 実装差し替えで移行。

## Risks carried to tasks
- 後方互換回帰（4.3）の網羅：admin/非 admin × 代表 action のスナップショット比較を必須テストに。
- `Scope` 型の正確な導出（`SCOPE` const から string-union 型を得る）は実装時に確認。
- token scope と role capability の評価一本化は Non-Goal（将来 Revalidation Trigger）。
