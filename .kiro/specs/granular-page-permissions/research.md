# Gap Analysis: granular-page-permissions

> `/kiro-validate-gap` による既存コードとのギャップ分析。設計（`/kiro-spec-design`）の入力。
> 調査日: 2026-06-30。コードは読み取りのみ。

## Analysis Summary

- GROWI の権限は **read と edit が完全に一体化**。アクセス判定は `PageGrantService.isUserGrantedPageAccess()`（read 判定）のみで、**編集可否を判定する関数が存在しない**。
- 書き込みルートは **グローバル ROM ミドルウェア（`excludeReadOnlyUser`）＋ 削除時の `canDelete()`（author/admin）** でしか守られておらず、**「ページ単位の編集可否」チェック点が無い**。per-scope 編集ゲートは新規追加が必須（最大の作業）。
- データモデル `grantedGroups: [{ type, item }]` にロール／編集スコープの次元が無い。Req 1.2「閲覧=Public・編集=グループ」を満たすには **編集スコープを read scope と別に持つ**のが素直（後述 Option A）。
- 既存のツリー正規化・継承（`page-grant.ts` / `GrantedGroupsInheritanceSelectModal` / `overwriteScopesOfDescendants`）は read scope 前提。edit 次元を通す拡張が要る（Req 6）。
- UI は拡張点が揃っている：grant 保存パイプライン（`selectedGrantAtom` → `toPageUpdateGrantParams` → `IOptionsForUpdate`）、全グループ取得 `useSWRxUserGroupList`、⋮メニューの `additionalMenuItemRenderer`（growi-vault が前例）。

---

## Requirement-to-Asset Map

| Req | 必要な技術要素 | 既存資産 | ギャップ |
|-----|--------------|---------|--------|
| 1 閲覧/編集範囲の独立設定 | 編集スコープのデータモデル | `page.ts` grant スキーマ（`grant` / `grantedUsers` / `grantedGroups:[{type,item}]`）、`@growi/core` `IPage`/`IGrantedGroup`/`PageGrant` | **Missing**: 編集スコープを表す型・フィールド。edit ⊆ read、edit 非空の検証も無い |
| 2 実効ロールに基づく可否 | `isUserCanEditPage()` 的判定＋書き込みルートでの強制 | read 判定 `isUserGrantedPageAccess()`（`page-grant.ts:1153`）／書き込みは `excludeReadOnlyUser`＋`canDelete()`（author/admin）のみ | **Missing**: 編集可否判定関数が無い。**書き込みルートに per-page 編集ゲートが無い**（update/rename/move/duplicate/attachment は実質 read+ROM のみ） |
| 3 コメント可否の設定切替 | 新 config＋コメントルートでの per-page ロール判定 | `config-definition.ts` の `defineConfig` パターン、`excludeReadOnlyUserIfCommentNotAllowed`（`security:isRomUserAllowedToComment`） | **Missing**: per-page「閲覧のみロール」を見るコメントゲート。既存はグローバル ROM 前提。**Constraint**: コメントルートで対象ページの実効ロールを算出する必要 |
| 4 非所属グループ付与 | 全グループ候補の取得＋選択 | `useSWRxUserGroupList()`（`/api/v3/user-groups`）、`useSWRxExternalUserGroupList`、grant-data の `nonUserRelatedGrantedGroups`（表示のみ） | **Missing**: grant-data は `userRelatedGroups` のみ選択可。非所属を選択肢に出す導線。**Constraint**: 全ユーザー許可＝全グループが選択 UI に見える（開示の論点、要件で許容済み） |
| 5 ⋮から配下ツリー付与 | メニュー項目＋一括適用 | `PageItemControl` の `additionalMenuItemRenderer`（前例: growi-vault `PageReconcileMenuItem`）、`overwriteScopesOfDescendants`、`GrantedGroupsInheritanceSelectModal` | **Missing**: 「配下へ権限付与」項目と専用モーダル。**既存の配下上書き機構を入口化**すれば実装は薄い |
| 6 ツリー整合性とロール継承 | edit 次元を含む正規化・継承 | `isGrantNormalized` / `validateGrant` / `canOverwriteDescendants` / `generateUpdateGrantInfoToOverwriteDescendants`（`page-grant.ts`）、継承モーダル | **Constraint+Missing**: 既存は read のみ。edit ⊆ read、子孫 edit ⊆ 祖先 read の判定を追加 |
| 7 後方互換移行 | 既存 grant ⇒「編集可」相当へ | `grantedGroups` デフォルト `[]`、v5 マイグレーションのツリー巡回パターン（`page/v5.migration.integ.ts`） | **Constraint**: 観測アクセス不変が必須。**Unknown**: 一括移行 vs「edit スコープ未設定 ⇒ read=edit として遅延既定」のどちらにするか（設計判断） |
| 8 グローバル ROM との分離 | per-page ロールと `User.readOnly` の独立 | `exclude-read-only-user.ts`（`User.readOnly`） | **Low**: 別概念として併存。判定経路を混ぜないだけ |

---

## 現状の核心（なぜ enforcement 追加が必須か）

- **read = edit**: `isUserGrantedPageAccess()`（`page-grant.ts:1153-1170`）は read 判定のみ。`grant === GRANT_PUBLIC → true`、`GRANT_USER_GROUP → userRelatedGroups に該当`、等。**editable を判定する独立関数は無い**。
- **書き込みルートの実態**:
  - apiv3 `PUT /page`（`update-page.ts:209`）・`PUT /page/:id/grant`（`index.ts:835`）は `excludeReadOnlyUser`（**グローバル ROM のみ**）。
  - apiv1 `pages.remove`/`revertRemove`/`unlink`/`tags.update`、`attachments.remove` も `excludeReadOnlyUser` のみ。
  - 削除は `pageService.canDelete()` / `canDeleteCompletely()`（author/admin 観点）で追加判定。
  - → **「このページをこのユーザーが編集してよいか」を見る箇所がどこにも無い**。これは現状「閲覧できれば編集できる」を裏付けると同時に、本機能の主作業が **書き込み経路への per-page 編集ゲート新設** であることを意味する。
- **config の足し方**（Req 3）: `config-definition.ts` に `defineConfig<boolean>({ defaultValue, envVarName? })` を1件追加 → admin `security-settings`（`GET/PUT /api/v3/security-settings`）に read/write とバリデータを追加。`isRomUserAllowedToComment` が雛形。

---

## Implementation Approach Options

### データモデルの分岐（設計の主軸）

#### Option A: 編集スコープを read scope と別フィールドで持つ（推奨）
既存 `grant` / `grantedUsers` / `grantedGroups` を **read scope** としてそのまま維持し、
**edit scope** を別フィールド（例: `editGrant` / `editGrantedGroups` / `editGrantedUsers`、または
`editScope` サブドキュメント）として追加する。`editScope` 未設定は「read と同一＝全閲覧者が編集可」
として扱い、既存ページの挙動を保つ。

- ✅ Req 1.2「閲覧=Public・編集=グループ」が素直に表現できる（read grant=PUBLIC、edit scope=group）。
- ✅ read 経路（`generateGrantCondition` / 正規化 / 継承）を温存でき、移行が「未設定=read と同一」で済む（遅延既定）。
- ✅ `isUserGrantedPageAccess()`（read）はそのまま、`isUserCanEditPage()` を新設するだけ。
- ❌ スコープが2系統になり、正規化・継承・UI を2軸で扱う必要。フィールド増。

#### Option B: 付与グループ／ユーザーに role フラグを付ける（単一リスト）
`grantedGroups` / `grantedUsers` の各要素に `role: 'read' | 'edit'` を付与。read scope = grant＋全付与、
edit scope = role が edit の要素。

- ✅ スキーマ変更が小さい（1フィールド追加）。
- ❌ **「Public 閲覧＋グループ編集」を表現できない**（Public は grant 種別でありグループではない）→ Req 1.2 を特例対応しないと満たせない。
- ❌ read/edit の概念が grant 種別と grantedGroups に分散し判定が複雑化。

#### Option C: ハイブリッド／段階導入
read モデルは現状維持。edit scope を「未設定=全閲覧者が編集可」のオプション概念として導入し、
フェーズ1: グループ限定ページでの read/edit、フェーズ2: Public 閲覧＋限定編集まで拡張。

- ✅ 段階的にリスクを抑えられる。
- ❌ フェーズ間で UI/データの一貫性管理が必要。要件（Req 1.2）が初期から Public+限定編集を求めるため、フェーズ2を初回に含めざるを得ず分割の旨味が薄い。

> **推奨: Option A**。Req 1.2 を素直に満たし、read 経路を温存して移行を最小化できる。
> role-per-group（Option B）は「Public 閲覧＋グループ編集」を表現できない点が要件と衝突する。

### enforcement（書き込みゲート）の置き方

- **B-1 サービス層の単一チョークポイント**: `PageService` の更新/リネーム/移動/複製/削除と
  attachment 経路が必ず通る箇所に `isUserCanEditPage()` を挿す。漏れにくいが、全書き込み経路の
  棚卸しが前提。
- **B-2 ルートミドルウェア**: `requireEditPermission(pageId)` 的ミドルウェアを書き込みルートに付与
  （`excludeReadOnlyUser` と同様の付け方）。一覧性は高いが pageId の解決をミドルウェアで行う必要。
- → 設計で **「全書き込み経路の網羅」** を最優先に（1つでも漏れるとセキュリティホール）。

---

## Effort & Risk

| 領域 | Effort | Risk | 根拠 |
|------|--------|------|------|
| edit scope データモデル＋移行 | M | Medium | フィールド追加は容易だが「未設定=read」既定・後方互換の確証が要る |
| 編集可否判定 `isUserCanEditPage()`＋`generateGrantCondition` 拡張 | M–L | High | アクセス中核・セキュリティ critical。read 判定との一貫性 |
| 書き込み経路への per-page 編集ゲート新設 | M | High | 全書き込みルートの網羅が必須。漏れ=権限バイパス |
| 正規化・継承への edit 次元追加（Req 6） | L | High | `page-grant.ts` は複雑。2スコープのツリー整合 |
| コメント config ゲート（Req 3） | S–M | Medium | パターン既存。ただし per-page ロール算出をコメント経路で行う |
| UI（編集スコープ選択＋非所属グループ＋⋮配下付与） | M–L | Medium | 拡張点は揃う。2軸スコープの UX 設計が要 |
| グローバル ROM 分離（Req 8） | S | Low | 既存概念の併存のみ |

**総合: L（1–2週間超）／ Risk Medium–High。アクセス制御の中核に触れるセキュリティ critical な変更。**

---

## Recommendations for Design Phase

- **推奨アプローチ**: Option A（read scope と edit scope を別保持）＋ サービス層チョークポイントでの
  編集ゲート（B-1）。`isUserGrantedPageAccess()` は read として温存し、`isUserCanEditPage()` を新設。
- **鍵となる設計判断**:
  1. edit scope のスキーマ形（別フィールド群 vs `editScope` サブドキュメント）と `@growi/core`
     `IPage` / `IGrantedGroup` への反映。
  2. 後方互換: 一括マイグレーション vs「editScope 未設定 ⇒ read と同一」遅延既定（移行リスク最小）。
  3. 書き込み経路の**網羅的インベントリ**（update/save/rename/move/duplicate/delete/revert/unlink/
     tags/attachment add+remove）と、編集ゲートの単一チョークポイント。
  4. 正規化・継承に edit ⊆ read／子孫 edit ⊆ 祖先 read を追加する規則。
  5. コメントゲートが対象ページの実効ロールを得る経路（コメントルートは pageId を持つか）。
  6. 非所属グループの UI（「所属／その他」分割、ExternalUserGroup の扱い）と、全ユーザー許可に伴う
     グループ存在の開示（要件で許容済みだが明記）。
- **Research Needed（設計で詰める）**:
  - 遅延既定が `generateGrantCondition` の read フィルタやインデックスへ与える影響と性能。
  - 書き込みのたびに edit scope を算出する負荷（populate コスト）。
  - ExternalUserGroup を含む全経路でのロール整合。
  - 編集者不在（edit scope 非空）の検証を作成・更新・配下一括適用の各経路でどう一貫させるか。

---

## Touchpoints（設計の出発点となる具体ファイル）

- データ/型: `apps/app/src/server/models/page.ts`（grant スキーマ）、`packages/core/src/interfaces/page.ts`（`IPage` / `IGrantedGroup` / `PageGrant`）
- 判定/正規化: `apps/app/src/server/service/page-grant.ts`（`isUserGrantedPageAccess`, `isGrantNormalized`, `validateGrant`, `canOverwriteDescendants`, `generateGrantCondition`）
- 書き込み: `routes/apiv3/page/update-page.ts`、`routes/apiv3/page/index.ts`（grant 更新）、`routes/index.js`（apiv1 remove/unlink/tags/comments）、`page/index.ts`（`canDelete`）、`attachment.js`
- ミドルウェア/設定: `middlewares/exclude-read-only-user.ts`、`service/config-manager/config-definition.ts`、`routes/apiv3/security-settings`
- UI: `PageEditor/EditorNavbarBottom/GrantSelector.tsx`、`states/ui/editor/selected-grant.ts`（`toSelectedGrant`/`toPageUpdateGrantParams`/`IPageSelectedGrant`）、`stores/page.tsx`（`useSWRxCurrentGrantData`）、`stores/user-group.tsx`（`useSWRxUserGroupList`）、`GrantedGroupsInheritanceSelectModal/`、`SavePageControls.tsx`、`Common/Dropdown/PageItemControl.tsx`＋`Sidebar/PageTreeItem/use-page-item-control.tsx`

---

## Design Synthesis Outcomes (2026-06-30)

`/kiro-spec-design` 前の synthesis 3レンズの結論。設計（`design.md`）に反映済み。

### 1. Generalization
- read scope と edit scope を「ページに対する権限スコープ」という同一概念の2軸として一般化。
  edit scope は read scope の **narrowing（部分集合）** として定義し、`IGrantedGroup` を read/edit で
  再利用する。インターフェースのみ一般化し、実装は現要件の範囲に留める。

### 2. Build vs. Adopt
- 外部ライブラリ不要。既存 `PageGrantService` の read 判定・正規化・継承・grant 保存パイプライン・
  config-manager・⋮拡張点（`additionalMenuItemRenderer`）・`overwriteScopesOfDescendants` を **Adopt**。
  新規構築は「欠落している edit 判定」と「散在書き込み経路を守る単一ゲート」のみ。

### 3. Simplification（採用した重要判断）
- **`editScope` を任意フィールドにし、未設定 ⇒「編集権限 == 閲覧権限（全閲覧者が編集可）」と解釈**。
  → データ移行が不要になり、Req 7（後方互換）を遅延既定だけで満たす。ロールバックも `editScope`
  無視で従来挙動に戻る。
- **role 列挙（read/edit を各グループに付与する mode enum）を不採用**。Option B は「Public 閲覧＋
  グループ編集」を表現できず Req 1.2 と衝突するため。Option A（read/edit を別スコープ）を採用。
- 編集ゲートは **単一ミドルウェア `requirePageEditable`**（グローバル ROM の後段）に集約し、経路ごとの
  ばらばらな判定を避ける。純粋判定は `PageGrantService` に置き、ミドルウェアは薄い adapter。

### 設計に残した最重要リスク
- **書き込み経路の網羅**: `requirePageEditable` の適用漏れ＝権限バイパス。tasks で経路インベントリを
  固定し、各経路に統合テストを課す（design の Security/Testing に明記）。

---

## Gap Analysis 追補: ページ作成ゲート（Req 2.7–2.9）

要件追加（作成 ⟺ 親への EDIT）に伴う作成経路の追加調査。2026-06-30。

### 作成フローの現状
- **作成 API**: apiv3 `POST /page` → `routes/apiv3/page/create-page.ts`（`createPageHandlersFactory`）→
  `crowi.pageService.create()`（`page/index.ts:4847`）。apiv1 の作成経路は廃止済み。
- **現在の作成時チェック**: `loginRequiredStrictly` ＋ `excludeReadOnlyUser`（グローバル ROM）＋
  `accessTokenParser([SCOPE.WRITE.FEATURES.PAGE])`。**「親への編集権限」チェックは存在しない**。
- **親の解決は create 内で完了済み**: `Page.findNonEmptyClosestAncestor(path)` で `closestAncestor`
  を取得（`create()` 内、grant 継承のため既に算出）。`getParentAndFillAncestorsByUser()` が中間の
  empty page を自動生成。
- **作成時 grant 正規化**: `canProcessCreate` → `pageGrantService.isGrantNormalized()`。grant は
  `options.grant ?? closestAncestor?.grant ?? GRANT_PUBLIC` で継承。
- **複製/移動**: `duplicate()` / `renamePage()` も `getParentAndFillAncestorsByUser()` で移動先/複製先の
  親を解決 → 同じゲートを適用できる。

### ギャップ
| 項目 | 状態 |
|------|------|
| 作成時の親 EDIT 判定 | **Missing**: 親への編集権限を見る箇所が無い |
| 親解決ヘルパ | **既存・再利用可**: `findNonEmptyClosestAncestor` / `getParentAndFillAncestorsByUser` |
| empty page 親 | **Constraint**: 中間の自動生成 empty page が「親」になり得る。ゲートは empty ではなく **non-empty 最近祖先** に対して判定すべき。empty 生成パイプライン（`buildPipelineToCreateEmptyPagesByUser`）に editScope を伝播させる必要 |
| 複製/移動先の親 EDIT | **Missing**: duplicate 複製先・move 移動先の親に対する EDIT 判定 |

### 設計への含意（要反映）
- **作成ゲートはルートミドルウェアより `PageService.create()` 内のサービス層が自然**。理由: 親は
  `determinePath()` → 親解決の後にしか確定せず、`closestAncestor` は create 内で既に算出済み。
  design の `generateRequireParentPageEditable`（ミドルウェア）案は、作成に関しては
  **`create()` 内（`canProcessCreate` 直前）の実効ロール判定**へ置き換える方が漏れにくい。
  → 単一ページの更新/削除等は route ミドルウェア（`requirePageEditable`）、**作成/複製/移動先は
  サービス層チェック**、という二段構成が現実的。
- **判定対象は non-empty 最近祖先**（`findNonEmptyClosestAncestor`）。editScope 未設定なら従来どおり許可
  （Req 2.9）。
- **empty page への editScope 伝播**: 中間 empty page 生成時に non-empty 祖先の editScope を引き継ぐか、
  もしくは判定時に常に non-empty 祖先まで遡る方針を design/tasks で確定する。

### Effort & Risk（追補分）
- 作成/複製/移動先ゲート: **M / Risk High**（経路ごとに親解決＋判定。漏れ＝権限バイパス）。
- empty page の editScope 伝播: **S–M / Medium**（既存 grant 継承パイプラインに1次元追加）。
