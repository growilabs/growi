# Gap Analysis: activity-log（記録ゲート）

> `/kiro-validate-gap` の成果。要件（対象外 action を今後永続化しない／既存挙動維持／記録ゲートの責務分離）と既存コードのギャップを分析し、design フェーズの判断材料を残す。方式（defer-create / delete-at-settle）の最終決定は design で行う。

## 1. 現状（Current State）

### 記録フロー（更新系＝非 GET）
- `apps/app/src/server/middlewares/add-activity.ts:22-39` — 非 GET で**無条件に** `ACTION_UNSETTLED` の仮行を `prisma.activities.createByParameters` で作成し、`res.locals.activity` に格納。action 判定なし。
- 各ルートが `activityEvent.emit('update', activityId, parameters, …)` を発火（**37 箇所 / 19 ファイル**、`.spec`/`.integ` 除く）。第1引数は実質すべて `res.locals.activity._id`（唯一 `apiv3/logout.js:39` が変数経由だが元は `:37` の `res.locals.activity._id`）。
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

### 前提: UNSETTLED 行の3分類と fail-safe（重要）
middleware がルート本体の**前**（apiv3 認証チェーン内）で無条件に UNSETTLED を作るのは、**「危険な処理を実行する前に、API call が起きた事実（誰・いつ・どのエンドポイント・IP）を最低限焼き付ける fail-safe」** と読める。ルート／サービスが例外を投げても、あるいはミューテーション成功後 settle 直前にプロセスが落ちても、「操作が試みられた」痕跡が残る。監査・コンプライアンス機能としては、この「失敗・中断した試行の記録」自体に価値がある。

UNSETTLED 行は起源が3種類あり、混同してはいけない:

| 起源 | emit | 現状 | 位置づけ |
|---|---|---|---|
| ① 対象内 action | あり | 実 action に settle | 正常・保持 |
| ② **対象外 action** | あり | UNSETTLED のまま残る | **要件が消したい「ノイズ」** |
| ③ 例外／no-op で emit せず | なし | UNSETTLED のまま残る | **fail-safe の試行記録（残す価値あり）** |

要件「対象外を save しない」が指すのは **② のみ**（emit は来たが記録可否で弾かれたもの）。② は必ず emit が来るので settle 時に判定して落とせる。③（fail-safe）は emit が来ないので settle 起点の処理では触れない。**② と ③ を分けて考えることが、方式選定の肝**。

前提: いずれも既存構造の **Extend**。差は「対象外行を作らない(A)」「作って消す(B)」「失敗時だけ後から作る(C)」。

### Option A — defer-create（middleware は id 採番のみ、settle 時に対象内だけ create）
- **要改修**:
  1. `add-activity.ts`: DB 書込みをやめ、ObjectId を採番して `res.locals.activity = { _id }` を残す（**109 箇所の `res.locals.activity._id` と `update-page.ts:125` の `getIdStringForRef` を無改修で温存**）。
  2. update リスナー: 対象内なら `updateByParameters` の代わりに **create（id 指定）**。既存 `createActivity`（gated-create, `:256-270`）と同型で流用可。`createByParameters` は `_id` 指定 create を受け付ける（activity-log-snapshot 設計の記載）。
  3. 第2作成源 `page/index.ts:2819` の自前 create も遅延化。
- **未 settle**: 構造的に「作らない」。ただし②だけでなく**③の fail-safe も丸ごと失う**（クラッシュ耐性ゼロ＝例外・中断時の試行記録が残らない）。監査観点では劣化。
- **書き込み**: ②＋③のリクエスト分は減る。ただし①（大多数の正常操作）は結局1回 create するので、write 削減効果は「②＋③の比率」次第で限定的なこともある。
- **凝集度(R3)**: settle が create に変わるのを機に `settleActivity()` 抽出が自然。contribution は activityId 非依存（3）で分離容易。
- **リスク**: 広く使われ 109 箇所が `res.locals.activity` の形に依存 → 採番変種で回避可だが要検証。`add-activity.spec.ts:44-62`（無条件作成の契約）と `activity.spec.ts:247-267`（block 時非更新）の**テスト契約を改訂**。`updateByParameters` を復元/連動系で使い続けるか整理要。
- **Effort: M（3–7日）／ Risk: Medium**（依存箇所は多いが回避策明確・単一情報源は既存）。

### Option B — delete-at-settle（事前作成は残し、対象外は settle 時に削除）
- **要改修**:
  1. **activity extension に delete メソッドを新設**（現状 `deleteBy*`/`deleteMany` 無し）。
  2. リスナーの `if (!shoudUpdate)` 分岐で該当行を delete（contribution は `:124-145` で先行確定済み・4 より常に settle される行なので実害小）。
- **未 settle（③）**: 意図的に**残す**（emit が来ない仮行は消えない）。②（emit 済み対象外）だけを削除するので、「対象外は消す／試行記録は残す」という fail-safe 意図に最も素直。クラッシュ耐性あり。
- **書き込み**: write→delete で**回数は減らない**（保管量＝②の行数だけ減る）。負荷が write-IOPS なら効果薄、stored-size なら効く。
- **凝集度(R3)**: 同リスナーに削除責務が増え肥大化 → 責務分離（後述）と併せると良い。
- **リスク**: 既存 read/emit を温存でき**低リスク**。fail-safe を保つ点は (A) より監査上優れる。
- **Effort: S–M（2–5日）／ Risk: Low–Medium**。

### Option C — lazy fail-safe（先には作らず、①は settle 時 create・③は例外時のみ create）
- **要改修**: middleware は事前作成せず（(A) 同様 id 採番のみ）。①は settle 時に create（対象内のみ）。② は何もしない。**③はエラーハンドラ（Express error middleware / finish フック）で UNSETTLED を後から create**。
- **未 settle（③）**: 「正常に失敗した試行」は残る。ただし **pre-execution ではないためクラッシュ（プロセス即死・エラーハンドラ未到達）は取りこぼす**（(B) との差）。
- **書き込み**: ②を書かず、①は1回、③はエラー時のみ → **write 削減と失敗監査を両立**。
- **凝集度(R3)**: 記録ライフサイクルを1ユニットに集約しやすい。ただしエラーハンドラという新たな結合点が増える。
- **リスク**: エラー経路の網羅・二重作成防止（settle と error の両立ち回避）の設計が要る。**Risk: Medium**（新経路）。
- **Effort: M（3–7日）／ Risk: Medium**。

### 併せて検討（全案共通・R3）
- update リスナーの責務分離（contribution / 記録ライフサイクル / 通知）。記録可否の責務を薄いユニットに抽出すると R3（凝集度・不要な責務依存の排除）を満たしやすい。**Effort: S–M**。
- 一覧 where の UNSETTLED 明示除外（6）。**Effort: S**。

## 8. design フェーズへの申し送り

**方式選定は「pre-execution の fail-safe（③＝失敗・中断した操作の試行記録、クラッシュ含む）をどれだけ重視するか」で決まる**（当初 (A) 寄りとしていたが、③の監査価値を踏まえ中立に修正）:
- クラッシュ含めて試行記録を残したい → **(B)**（保管量だけ減る／write は減らない）。要件「対象外を消す」に最も素直で低リスク。
- 「正常な失敗」までで十分・write も減らしたい → **(C)**（クラッシュは取りこぼす）。
- 試行記録は不要・とにかく write 最小 → **(A)**（fail-safe を全放棄）。
- contribution は activityId 非依存（3・4）なので、(A)(C) で行を遅延させても貢献度は壊れない。

**決定済み（2026-07-07・ユーザー判断）**: ③（失敗・中断した操作の試行記録）を fail-safe として**残す方針を要件化**した（requirements.md **Requirement 4**）。これにより **(A) defer-create は不可**（③を全放棄するため）。方式は **(B) 中心**（クラッシュ含め試行記録を残せる・保管量減・低リスク）、書き込み回数も削りたい場合のみ **(C)**（クラッシュ時の試行記録は取りこぼしうる、というトレードオフを許容する場合）。要件（Requirement 1＝②を永続化しない／Requirement 4＝③を残す）はどちらの方式でも満たせるが、クラッシュ時の網羅度で (B) が優れる。

**Research Needed（design で決める）**:
1. ~~③（fail-safe 試行記録）を残すか~~ → **決定済み: 残す（Requirement 4）。(A) は除外。**
2. 「負荷」の主眼が write-IOPS か stored-size か。→ **(B)（size減・クラッシュ耐性）** と **(C)（write減・クラッシュ取りこぼし）** の選択に効く。
3. (B) vs (C) の最終決定（クラッシュ時の試行記録網羅度 vs 書き込み削減）。
4. 一覧 where の UNSETTLED 除外を本 spec と viewer spec のどちらが持つか。
5. 第2作成源（`page/index.ts:2819` 復元フロー）の統一的な扱い。
6. (A)/(C) 採用時: `res.locals.activity` 消費者が特定2種以外に無いことの最終確認、`updateByParameters` を復元/連動系で継続使用するかの整理。
7. update リスナーの責務分離をどこまで design に含めるか（R3 の担保方法）。

## 9. Effort / Risk サマリ
- Option A（defer-create）: **M / Medium** — write 削減は②③分のみ・単一情報源は既存流用。ただし fail-safe(③)を全放棄。テスト契約改訂が必要。
- Option B（delete-at-settle）: **S–M / Low–Medium** — 既存温存・低リスク・fail-safe 維持。delete メソッド新設要・write は減らない（size のみ減）。
- Option C（lazy fail-safe）: **M / Medium** — write 削減と失敗監査を両立だがクラッシュ取りこぼし・エラー経路の新結合点。
- 共通改善（責務分離・一覧除外）: **S–M / Low**。

---

## 10. Design 決定（design フェーズ / 2026-07-07）

`/kiro-spec-design` で Research Needed を解決した結果。実コードを再確認したうえでの確定事項。

### Decision 1: 方式は Option B（delete-at-settle）に確定（Research Needed #2, #3 を解決）

- **選定**: **Option B**。事前作成した `ACTION_UNSETTLED` 行は温存し、`update` リスナーで「記録可否が確定して対象外（②）」の行だけを削除する。
- **根拠**: 要件 4（例外・**中断（クラッシュ含む）**で確定しなかった操作の試行記録を残す）が、リクエスト本体の実行**前**に行を焼き付ける現行の事前書き込みを事実上必須にする。
  - (A) defer-create は事前書き込みをやめるため ③（試行記録）を全放棄 → 要件 4 と両立不可（既に除外済み）。
  - (C) lazy fail-safe はエラーハンドラ到達時のみ ③ を作るため、**プロセス即死などエラーハンドラ未到達のクラッシュを取りこぼす** → 要件 4.1 の「中断」に対して弱い。
  - (B) は事前書き込みをそのまま残すので、例外・中断・クラッシュのいずれでも ③ が確実に残る。
- **副次的な利点（重要）**: ② を削除することで、残存する `ACTION_UNSETTLED` 行から「確定して対象外だった②」が除かれる。残るのは ③（失敗・中断・クラッシュした試行）と、加えて emit が来ない no-op（`shouldGenerateUpdate=false` で更新自体は成功したが記録を抑制したケース）である。これにより要件 4.2（未確定の行を「確定して対象外だった操作＝②」と区別する）が構造的に満たされる。**注意**: 「残存 UNSETTLED＝失敗した試行」ではない（成功した抑制更新を含む）。この点は viewer spec への申し送り（design.md Revalidation Triggers）に明記した。validate-design（2026-07-07）で `update-page.ts:140` の no-emit 経路を実コード確認して補正。
- **トレードオフ（受容済み）**: B は create→delete なので**書き込み回数（write-IOPS）は減らない**。減るのは**保管量（stored document 数）**のみ。要件 1 の目的（MongoDB 負荷軽減）のうち保管量には効き、write-IOPS には効かない。ユーザー判断（§8）で「(B) 中心・write も削りたい場合のみ (C)」と合意済みであり、要件 4 が加わったことで B が確定。write-IOPS 削減を優先したくなった場合の逃げ道は (C) だが、その場合クラッシュ時の試行記録を諦めることになる（本 spec では採らない）。

### Decision 2: 第2作成源（復元フロー）は追加改修不要（Research Needed #5 を解決）

- `service/page/index.ts` の `revertDeletedPage`（現行 L2830 付近）は middleware を通らず自前で `createByParameters` で `ACTION_UNSETTLED` を作るが、**その id で同じ `activityEvent.emit('update', ...)` を発火する**（L2847 / 2912 / 2990）。
- B は削除判定を `update` リスナー1箇所に集約するため、復元フローの ②（対象外確定）も同じリスナーで削除される。③（emit 前に throw）は事前作成行が残る＝middleware 経路と同じ fail-safe 挙動。**復元フロー側のコードは変更不要**。
- なお復元の action（`ACTION_PAGE_REVERT` / `ACTION_PAGE_RECURSIVELY_REVERT`）は essential かつ contribution action なので実効ゲート上は常に対象内（§4）。つまり復元行が②になるケースは現行設定意味論では発生しないが、リスナーが単一情報源で判定する以上、特別扱いは不要（要件 3.3）。

### Decision 3: 一覧 where の `ACTION_UNSETTLED` 除外は本 spec の対象外（Research Needed #4 を解決）

- B 適用後、残存する `ACTION_UNSETTLED` 行は要件 4 が保持を求める「試行記録」である。要件 4.1 は監査ログに**残す**ことを求めており、一覧のデフォルト表示から機械的に隠すのは監査意図に反しうる。
- 「一覧・画面でどう見せるか（隠す／整形する）」は**表示の責務＝`activity-log-snapshot-viewer` の担当**。本 spec（記録ゲート）は「どの行が DB に残るか」だけを決める。→ `build-activity-list-where.ts` は**変更しない**。viewer spec へ申し送る（design.md の Revalidation Triggers 参照）。

### Decision 4: R3 の担保 — 記録ライフサイクルの薄い抽出（Research Needed #7 を解決）

- 現行 `update` リスナーは contribution／settle（更新）／notify を1関数に同居。B で「削除」分岐が増えるため、**記録ライフサイクル（対象内なら更新・対象外なら削除）を薄い純関数 `settleActivityRecord` に抽出**する。
- この関数は記録可否の判断結果（`shouldPersist: boolean`）を**引数で受け取り**（`getAvailableActions`/`shoudUpdateActivity` という単一情報源を自分で複製しない）、contribution・notification の内部詳細に一切依存しない。これで要件 3.1/3.2 のシームが明示される。過剰な抽象化は避け、1関数・1ファイル（既存 `service/activity/` に同居）に留める。

### 実コード再確認で確定した事実
- **Prisma extension に delete メソッドは未実装**（`models/activity.ts`）。ただし snapshot spec の設計コメントが既に「（updateByParameters の改修・**直接削除の保存口**）」と予約済み。本 spec で `deleteById(activityId)` を新設し、この予約を実体化する。テストの後始末で使う `prisma.activities.deleteMany` は Prisma ネイティブで別物。
- **contribution は行の存在に非依存**（Research Needed #6 の残り）: `resolveContributor` は `contributor?._id != null` で即 return（`contribution-migration-service.ts:86-88`）。contribution は別コレクション `Contribution` に記録されるため、activity 行を削除しても集計は不変（要件 2.4 安全）。
- `add-activity` middleware は非 GET で `ip / endpoint / user / action=UNSETTLED / snapshot.username` を書く（要件 4.1 の「操作者・時刻・エンドポイント・IP」を満たす。時刻は `createdAt` 自動）。B ではこの middleware を**変更しない** → 既存の契約テスト `add-activity.spec.ts` はグリーンのまま（A なら要改訂だった差分）。
- 二重 settle の懸念なし（各 activity は emit 1回）。ただし `deleteById` は冪等（`deleteMany` 相当で not-found でも throw しない）、`updateByParameters` は P2025→null で、二重発火や行消失にも頑健。

### 改訂が必要な既存テスト契約
- `service/activity.spec.ts` の「skips prisma and does not emit "updated" when gate blocks」（L247-267）: 現状は「update を呼ばない」を主張。B では**「対象外 → `deleteById` を呼ぶ・`updated` は emit しない」**へ契約を更新する。
- `add-activity.spec.ts`: **変更不要**（middleware 温存）。

### 残課題（実装フェーズで確認）
- `settleActivityRecord` の抽出時、`update` リスナーの「contribution 先行 → settle → 対象内かつ行ありのときのみ notify」という**順序と notify 条件を厳密に保存**する（要件 2.3/2.4 の回帰防止）。
- delete 失敗時（DB エラー）は現行の update 失敗時と同様に logger.error して notify せず、リクエスト本体を止めない（記録は best-effort な副系）。
