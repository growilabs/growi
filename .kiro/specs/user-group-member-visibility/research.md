# Gap Analysis: user-group-member-visibility

対象要件: [requirements.md](./requirements.md)
スコープ: GrantSelector(ページ公開範囲=グループ限定の選択 UI)上で、選択肢の各グループのメンバー(氏名・ユーザー名)を表示する。

## 1. 現状調査(Current State)

本機能は**既存の確立されたデータフローの拡張**に位置づく。グループ選択 UI とその供給データは既に存在し、メンバー表示用の TODO まで埋め込まれている。

### 既存のデータフロー(GrantSelector)

```
GrantSelector.tsx (modal)
  └─ useSWRxCurrentGrantData(pageId)        stores/page.tsx:298-313
       └─ GET /api/v3/page/grant-data       routes/apiv3/page/index.ts:532-620
            ├─ auth: accessTokenParser([SCOPE.READ.FEATURES.PAGE]) + loginRequiredStrictly
            └─ pageGrantService.getPageGroupGrantData(page, user)   service/page-grant.ts:951-1051
                 └─ getUserRelatedGroups(user)   page-grant.ts:1056-1067
                      ├─ UserGroupRelation.findAllGroupsForUser(user)
                      └─ ExternalUserGroupRelation.findAllGroupsForUser(user)
```

- **型**: `GroupGrantData = { userRelatedGroups: UserRelatedGroupsData[]; nonUserRelatedGrantedGroups: {...}[] }`（[interfaces/page.ts:45-60](../../../apps/app/src/interfaces/page.ts)）
  - `UserRelatedGroupsData = { id, name, type, provider?, status }` ← 現状メンバー情報を持たない
- **UI**: モーダルは `userRelatedGroups`（自分の所属グループ＝選択可能）と `nonUserRelatedGrantedGroups`（既付与だが未所属＝無効表示）を別々に描画。**メンバー一覧の TODO は [GrantSelector.tsx:338,357](../../../apps/app/src/client/components/PageEditor/EditorNavbarBottom/GrantSelector.tsx)**（`userRelatedGroups` 側）にある。

### メンバー取得の部品(既存)

| 用途 | メソッド | 場所 |
|---|---|---|
| UserGroup のメンバー(populate 済) | `UserGroupRelation.findAllRelationForUserGroup(group)` → `relatedUser` populate | models/user-group-relation.ts:106-110 |
| 複数グループのユーザーID(重複排除) | `UserGroupRelation.findAllUserIdsForUserGroups(ids)` | models/user-group-relation.ts:112-121 |
| 外部グループ | `ExternalUserGroupRelation`（同名 static を委譲）| features/external-user-group/server/models/external-user-group-relation.ts:77-78 |
| 機微情報の除去 | `serializeUserSecurely(user)` → `password/apiToken/email` を除去（email は `isEmailPublished` 時のみ復元）| packages/core/src/models/serializers/user-serializer.ts:28-42 |

- `IUser` の `name`/`username` は [packages/core/src/interfaces/user.ts:7-8](../../../packages/core/src/interfaces/user.ts)。

### 既存の管理者向けメンバー一覧
`GET /api/v3/user-groups/:id/users` は **adminRequired + SCOPE.*.ADMIN.USER_GROUP_MANAGEMENT** で本機能(一般ユーザー)には使えない。認可モデルが異なるため流用不可（ただし serialize/active 絞り込みの実装パターンは参考になる）。

## 2. 要件→資産マップ(Requirement-to-Asset Map)

| 要件 | 利用できる既存資産 | ギャップ種別 |
|---|---|---|
| R1.1 GrantSelector でグループごとにメンバー提示 | grant-data フロー一式・TODO 箇所が確定済 | **Missing**: `UserRelatedGroupsData` にメンバー配列が無い／UI 未実装 |
| R1.2 / R3.4 氏名・ユーザー名のみ表示 | `serializeUserSecurely` | **Constraint**: serializer は name/username 以外(image, introduction 等)も返す。**name+username だけに絞る射影が別途必要** |
| R1.3 UserGroup と ExternalUserGroup 両方 | `findAllRelationForUserGroup`(内部) / 外部は ID ベース委譲 | **Unknown**: 外部グループに「populate 済メンバー」を返す対称メソッドがあるか要確認（無ければ ID→User 取得で統一） |
| R1.4 自分のみのグループの提示 | — | **Missing**: 空(自分のみ)表現の UI |
| R2.1 直接所属グループのみ | `getUserRelatedGroups`(= 直接所属) | ✅ 適合 |
| R2.2 親子グループのメンバーを含めない | 各グループの relation を直接引く（再帰なし）| ✅ 適合（再帰展開を実装しないことが要件） |
| R2.3 アクティブユーザーのみ | 管理者 API の active 絞り込みパターン | **Missing**: relation populate は status 無条件。`status: STATUS_ACTIVE` フィルタが必要 |
| R3.1 ログイン必須 | grant-data は `loginRequiredStrictly` | ✅ 適合 |
| R3.2 未所属グループのメンバー非表示 | `nonUserRelatedGrantedGroups` は別配列 | ✅ 適合（こちらにメンバーを付与しないだけ）|
| R3.3 管理者権限不要 | grant-data は非管理者スコープ | ✅ 適合 |
| R3.5 常時有効(設定なし) | — | ✅ 適合（追加設定を作らない）|

## 3. 実装アプローチ案

### Option A: grant-data を拡張（eager）
`UserRelatedGroupsData` に `members: { name, username }[]` を追加し、`getPageGroupGrantData` 内で各 `userRelatedGroups` のメンバーを取得・射影して同梱。UI は既存 TODO 箇所で `members` を描画。
- ✅ 1 往復で完結、新規エンドポイント不要、TODO 箇所にそのまま実装
- ✅ 型・フックの変更が最小（既存 `useSWRxCurrentGrantData` を再利用）
- ❌ モーダルを開かなくても grant-data 呼び出し毎に全所属グループのメンバーを取得しオーバーヘッド増
- ❌ grant-data の責務(grant 判定)にメンバー表示の関心が混入

### Option B: 専用エンドポイントを新設（lazy）
`GET /api/v3/user-groups/:id/members`（非管理者・ログイン必須・**呼び出しユーザーが当該グループの直接メンバーであることを検証**）を新設し、モーダルを開いた時／グループ展開時にだけ取得。
- ✅ 関心の分離、grant-data を汚さない、遅延取得でコスト最小
- ✅ 単体テストしやすい（認可境界が明確）
- ❌ 新規ルート＋SWR フック＋認可チェックの実装が増える
- ❌ UserGroup/ExternalUserGroup の両 ID 体系を 1 エンドポイントで扱う設計判断が必要

### Option C: ハイブリッド（型は拡張・取得は遅延）
`UserRelatedGroupsData` に `members?` を任意で持たせつつ、実取得は Option B の専用エンドポイントでモーダル展開時に行う。
- ✅ UX/性能/分離のバランスが良い
- ❌ 設計の調整が最も必要（どこまで eager/lazy にするかの線引き）

## 4. 複雑度・リスク

- **Effort**: **S〜M**（1〜5日）。データ部品は出揃っており、主作業は「型拡張＋メンバー取得・射影＋UI 描画」。Option B/C は新規ルート分やや増。
- **Risk**: **Low〜Medium**。
  - Medium 要因: (1) 「name+username のみ」のプライバシー射影を serialize 後にさらに絞る必要、(2) 外部グループのメンバー取得対称性、(3) eager 取得時(Option A)の性能、(4) active ユーザー絞り込みの漏れ。
  - Low 要因: 認可は既存の非管理者スコープに自然に乗る／直接所属のみで再帰不要。

## 5. 設計フェーズへの申し送り

**推奨**: パフォーマンスと関心分離の観点から **Option B または C** を軸に検討（grant-data の責務肥大と無駄な eager 取得を避ける）。小さく早く出すなら Option A も可。

**Research Needed（design で確定）**:
1. `ExternalUserGroupRelation` に populate 済メンバーを返す対称メソッドの有無 → 無ければ「ID 取得 → User 一括取得 → 射影」で UserGroup/External を統一する方針。
2. 「氏名・ユーザー名のみ」を保証する射影の置き場所（専用シリアライザ／DTO 射影）。`serializeUserSecurely` だけでは過剰フィールドが残る点に注意。
3. アクティブユーザー絞り込み（`status === STATUS_ACTIVE`）の適用箇所。
4. eager(Option A) か lazy(B/C) か。判断材料として、想定グループ数・1グループあたりメンバー数の規模感。
5. メンバー数が多い場合の表示方針（件数上限・「ほか N 名」等）。要件に上限が無いため、design で UX を確認。

---

## Design Synthesis 結論 (kiro-spec-design)

確定したコード上の事実:
- `findAllUserIdsForUserGroups` は UserGroupRelation / ExternalUserGroupRelation 共通(外部は委譲)。ただし active 絞り込みはしない。
- 外部グループには `findAllRelationForUserGroup`(populate版)が無いため、両種別を **relations 取得 → User を `status: UserStatus.STATUS_ACTIVE` 絞り込み + `.select('name username')`** で統一する。
- `UserStatus.STATUS_ACTIVE`(=2) は `apps/app/src/server/models/user/conts.ts`。既存 `findUserByNotRelatedGroup`([user-group-relation.ts:233-240](../../../apps/app/src/server/models/user-group-relation.ts)) が同パターンを使用。
- 兄弟エンドポイント `GET /user/related-groups`([get-related-groups.ts](../../../apps/app/src/server/routes/apiv3/user/get-related-groups.ts)) が `accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true })` + `loginRequiredStrictly` + `pageGrantService.getUserRelatedGroups(req.user)` の factory パターン。新規 API はこれに倣う。
- 既存 hook `useSWRxUserRelatedGroups`([stores/user.tsx:77](../../../apps/app/src/stores/user.tsx))の隣に新 hook を追加。

### 1. Generalization
3要件は「現在ユーザーの直接所属グループ(両種別)について active メンバーを name/username に射影し GrantSelector に描画」に集約。internal/external の差異は per-type relation クエリで吸収し、User 取得段で統一。

### 2. Build vs Adopt
- 採用: `getUserRelatedGroups`(直接所属・両種別・再帰なし)、relations クエリ、User active 射影パターン、`useSWRxUserRelatedGroups` の SWR パターン。
- 不採用: 管理者 API `/user-groups/:id/users`(adminRequired・full serialize で要件不一致)。`serializeUserSecurely`(email を条件付きで含めうるため、より厳格な `.select('name username')` を採用)。

### 3. Simplification
- グループ集合をサーバ側でセッションから導出(クライアント id を受理しない)→ 認可チェック簡素化・IDOR 排除(3.2/3.3 を構造担保)。
- メンバー情報を grant-data と分離した独立契約・遅延取得とし、grant 判定の責務肥大と eager 取得コストを回避(research の Option B を、集合のセッション導出で強化した形)。
- name/username 射影を DB クエリ段で実施 → プライバシー(1.2/3.4)を構造担保。

### 未解決(Open Questions)
- メンバー多数時の表示上限/「ほか N 名」(要件に上限なし、初版は全件)。
- 自分を一覧に含める/除外する/ハイライトの UI 判断(設計はメンバー全件返却、UI が username 一致で 1.4 を判定)。
