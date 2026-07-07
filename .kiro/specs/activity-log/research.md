# Gap Analysis: activity-log（記録ゲート）

> `/kiro-validate-gap` の成果。要件（対象外 action を今後永続化しない／既存挙動維持／記録ゲートの責務分離）と既存コードのギャップを分析し、design フェーズの判断材料を残す。方式（defer-create / delete-at-settle）の最終決定は design で行う。

## 1. 現状（Current State）

### 記録フロー（更新系＝非 GET）
- `apps/app/src/server/middlewares/add-activity.ts:22-39` — 非 GET で**無条件に** `ACTION_UNSETTLED` の仮行を `prisma.activities.createByParameters` で作成し、`res.locals.activity` に格納。action 判定なし。
- 各ルートが `activityEvent.emit('update', activityId, parameters, …)` を発火（**109 箇所 / 37 ファイル**、`.spec`/`.integ` 除く）。第1引数は実質すべて `res.locals.activity._id`（唯一 `apiv3/logout.js:39` が変数経由だが元は `:37` の `res.locals.activity._id`）。
- update リスナー `apps/app/src/server/service/activity.ts:101-179` が `shoudUpdateActivity(action)` で判定。対象内なら `updateByParameters` で実 action へ更新し `updated` を emit、**対象外なら何もせず UNSETTLED のまま残す**。
- GET 経路は `createActivity`（`activity.ts:256-270`）が保存前に判定し、対象外なら作らない（＝既に要望どおり）。

### 記録可否の単一情報源
- `getAvailableActions()`（`activity.ts:182-242`）が監査ログ設定（`app:auditLogEnabled` / `app:auditLogActionGroupSize` / `app:auditLogAdditionalActions` / `app:auditLogExcludeActions`）から記録対象集合を算出。`shoudUpdateActivity(action) = getAvailableActions().includes(action)`（`:244-246`）。**判定は既にこの単一関数に集約**されており、要件 R1-4（二重定義しない）は「この関数を使い続ける」ことで満たせる。

### TTL・残骸
- 未確定行の明示的な掃除処理はなし。TTL インデックス `createTtlIndex`（`activity.ts:272-309`、`app:activityExpirationSeconds` 既定 2592000＝30日）で消えるのみ。

### update リスナーの責務同居（凝集度・R3 関連）
- `activity.ts:101-179` は **contribution 処理（:124-145）／settle（:147-177 の updateByParameters＋notify）** を1つのリスナーに同居。contribution は `shoudUpdate` と独立に**先行実行**される。

## 2. 要件 ↔ 資産マップ（ギャップ）

| 要件 | 既存資産 | ギャップ |
|---|---|---|
| R1-1 対象外を永続化しない（非 GET） | update リスナーの `shoudUpdate` 分岐 | **Missing**: 対象外時に「作らない」or「消す」処理が無い（今は放置） |
| R1-2 対象内は従来どおり記録 | `updateByParameters`（settle） | 維持（方式により create/update いずれか） |
| R1-3 GET 経路の維持 | `createActivity` gated-create | **既充足**（変更しない） |
| R1-4 判定の単一情報源・二重定義しない | `getAvailableActions` / `shoudUpdateActivity` | **既充足**（再利用するだけ。Constraint: この関数を分岐で複製しない） |
| R2-1 essential 常時記録 | `AllEssentialActions` を常に union（`:234-239`, exclude 後） | 維持（ゲートは essential を必ず含む） |
| R2-2 `auditLogEnabled=false`→essential のみ | `getAvailableActions` 冒頭 `:197-199` | 維持 |
| R2-3 通知の維持 | `updated` emit（`:171-176`） | 維持（対象内 settle 時のみ） |
| R2-4 貢献度集計を変えない | `resolveContributor`/`addContribution`、集計は `$match action∈Contribution`（`activity-aggregation-service.ts:28-30`, UNSETTLED 除外済み） | **安全**（下記3・4） |
| R2-5 グループ構成不変 | `interfaces/activity.ts` の各グループ定義 | 変更しない |
| R3 記録ゲートの責務分離 | 現状リスナーが contribution/settle/notify 同居 | **Constraint/改善余地**: 記録可否の責務を分離（settle 抽出） |

## 3. contribution は activityId 非依存（(A) の主障害が消える）

- `resolveContributor(activityId, contributor)`（`contribution-migration-service.ts:82-104`）は **`contributor?._id != null` なら即 return し DB を引かない**（`:86-88`）。null のときだけ `findUnique({ where:{ id: activityId }})`（`:95-98`）。
- contribution を生む emit 5 種はすべて `contributor: req.user` を同梱（`comment.js:304`, `create-page.ts:225`, `update-page.ts:151`, `pages/index.js:854`, `page/index.ts:2813/2997`）。
- → **DB フォールバックは contribution 経路では発火しない。行が存在しなくても貢献度は壊れない**。`ensureUserHasMigrated`/`addContribution` も user と `_id` のみ使用。**(A) で行を遅延作成しても R2-4 は満たせる。**

## 4. contribution action は実効ゲート上「常に対象内」（矛盾なし）

- `ContributionGraphActions`（`supported-actions.ts:9-15`）= PAGE_CREATE / PAGE_UPDATE / PAGE_DUPLICATE / PAGE_REVERT / COMMENT_CREATE。
- 素の `SmallActionGroup`（`interfaces/activity.ts:495-508`）に入るのは PAGE_CREATE のみ。だが `getAvailableActions` は最後に必ず `AllEssentialActions` を union（`:234-239`、exclude より後で消せない）。
- `EssentialActionGroup`（`:462-485`）に **5 個の contribution action がすべて含まれる**。
- → 設定に依らず contribution action は常に settle される。**「対象外だが貢献度は数えたい」ケースは現行設定意味論では発生しない** → (A)(B) とも gate と contribution の競合を心配しなくてよい。

## 5. 未 settle 経路（settle 保証はない）

- middleware は非 GET で無条件に仮行を作るが、emit は各ルート任せで**フレームワーク上の保証なし**。
- 実在パス: `update-page.ts:127-140` は `shouldGenerateUpdate` が false のとき emit しない → 仮行が UNSETTLED のまま残る。ほか emit 前 throw、middleware は付くが emit 無しのルートも一般に存在。
- **第2の作成源**: ページ復元 `page/index.ts:2819` が middleware を通らず**自前で** `ACTION_UNSETTLED` を create（`:2830`）し、その id で emit（`:2847/2912/2990`）。→ **両案ともこの経路を別途扱う必要あり。**
- 含意: **(B) は emit が来たときしか消せない** → 未 settle 残骸を除去できない（TTL 頼み）。**(A) は作らないので未 settle 残骸が構造的に消える。**

## 6. 既定一覧に UNSETTLED が混入（付随課題）

- 一覧 API `apiv3/activity.ts:290-308` の `where` は `buildActivityListWhere` 由来。action 句は `actions != null` のときだけ付く（`build-activity-list-where.ts:75-77`）。**無フィルタだと UNSETTLED 行がそのまま一覧に出る**。action フィルタ指定時は `getAvailableActions(false)` と intersect され除外。
- 集計（contribution）は `$match` で UNSETTLED 除外済みで安全（3）。
- **Research Needed（cross-spec）**: 一覧 where に `action: { not: UNSETTLED }` を足す防御は、記録ゲート spec と `activity-log-snapshot-viewer`（表示）のどちらが持つか design で決める。小さく防御的なので、行の存在を減らす本 spec と合わせて入れる選択肢もある。

## 7. 実装アプローチ

前提: いずれも既存構造の **Extend**。差は「対象外行を作らない(A)」か「作って消す(B)」か。

### Option A — defer-create（middleware は id 採番のみ、settle 時に対象内だけ create）
- **要改修**:
  1. `add-activity.ts`: DB 書込みをやめ、ObjectId を採番して `res.locals.activity = { _id }` を残す（**109 箇所の `res.locals.activity._id` と `update-page.ts:125` の `getIdStringForRef` を無改修で温存**）。
  2. update リスナー: 対象内なら `updateByParameters` の代わりに **create（id 指定）**。既存 `createActivity`（gated-create, `:256-270`）と同型で流用可。`createByParameters` は `_id` 指定 create を受け付ける（activity-log-snapshot 設計の記載）。
  3. 第2作成源 `page/index.ts:2819` の自前 create も遅延化。
- **未 settle**: 構造的に解決（作らない）。**書き込み回数自体が減る**（負荷軽減の狙いに合致）。
- **凝集度(R3)**: settle が create に変わるのを機に `settleActivity()` 抽出が自然。contribution は activityId 非依存（3）で分離容易。
- **リスク**: 広く使われ 109 箇所が `res.locals.activity` の形に依存 → 採番変種で回避可だが要検証。`add-activity.spec.ts:44-62`（無条件作成の契約）と `activity.spec.ts:247-267`（block 時非更新）の**テスト契約を改訂**。`updateByParameters` を復元/連動系で使い続けるか整理要。
- **Effort: M（3–7日）／ Risk: Medium**（依存箇所は多いが回避策明確・単一情報源は既存）。

### Option B — delete-at-settle（事前作成は残し、対象外は settle 時に削除）
- **要改修**:
  1. **activity extension に delete メソッドを新設**（現状 `deleteBy*`/`deleteMany` 無し）。
  2. リスナーの `if (!shoudUpdate)` 分岐で該当行を delete（contribution は `:124-145` で先行確定済み・4 より常に settle される行なので実害小）。
- **未 settle**: **未解決**（emit が来ない仮行は消えない＝TTL 頼み）。一覧混入（6）も emit 済み対象外行のみ解消。
- **書き込み**: write→delete で**回数は減らない**（保管量は減る）。
- **凝集度(R3)**: 同リスナーに削除責務が増え肥大化。
- **リスク**: 既存 read/emit を温存でき**低リスク**。ただし目的の達成度が (A) に劣る。
- **Effort: S–M（2–5日）／ Risk: Low–Medium**。

### 併せて検討（両案共通・R3）
- update リスナーの責務分離（contribution / 記録ライフサイクル / 通知）。記録可否の責務を薄いユニットに抽出すると R3（凝集度・不要な責務依存の排除）を満たしやすい。**Effort: S–M**。
- 一覧 where の UNSETTLED 明示除外（6）。**Effort: S**。

## 8. design フェーズへの申し送り

**推奨の初期姿勢**: 目的「対象外を永続化しない＋未 settle 残骸も出さない＋書き込み削減」を最も満たすのは **(A)**。contribution が activityId 非依存（3・4）と判明したため、要件段階で懸念した (A) の主障害は「middleware を採番のみにする変種」で回避できる。(B) は低リスクだが未 settle 残骸を残し delete メソッド新設が要る。design で書き込み回数・実装リスク・復元/連動経路（第2作成源）の扱いを計測・比較して確定する。

**Research Needed（design で決める）**:
1. (A) vs (B) の最終決定（書き込み回数への効果を含めて）。
2. 一覧 where の UNSETTLED 除外を本 spec と viewer spec のどちらが持つか。
3. 第2作成源（`page/index.ts:2819` 復元フロー）の統一的な扱い。
4. (A) 採用時: `res.locals.activity` 消費者が特定2種以外に無いことの最終確認、`updateByParameters` を復元/連動系で継続使用するかの整理。
5. update リスナーの責務分離をどこまで design に含めるか（R3 の担保方法）。

## 9. Effort / Risk サマリ
- Option A: **M / Medium** — 依存 109 箇所は採番変種で回避、単一情報源は既存流用、未 settle を構造解決。テスト契約改訂が必要。
- Option B: **S–M / Low–Medium** — 既存温存で低リスクだが delete 新設要・未 settle 未解決。
- 共通改善（責務分離・一覧除外）: **S–M / Low**。
