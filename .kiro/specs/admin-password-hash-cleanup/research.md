# Gap Analysis — admin-password-hash-cleanup

_2026-10-13 時点、ブランチ `feat/170496-189870-admin-password-hash-cleanup`（PR #11980、`master` から 7 コミット先行）に対する分析。_

## 結論

**この機能は greenfield ではない。既にこのブランチ上に実装されている。** `requirements.md` の受入基準 36 件のうち **32 件が実装済みで、かつ現時点で通過しているテストに覆われている**。したがって gap は「何が欠けているか」ではなく、ほぼ全面的に **Requirement 3** に集中している。そして Requirement 3 が求めているのは、現に存在し意図的にテストされている挙動の **削除** — `password-hash-upgrade` Requirement 3.4 から継承した中断ゲートの撤廃である。

この反転は実装フェーズの計画に影響する。大半のタスクは追加ではなく、**9 ファイルとそのテストに波及する削除**である。

## 1. 現状

### 既存資産（すべてこのブランチ上）

| レイヤ | 資産 | 役割 |
|---|---|---|
| 共有コア | `server/service/password-hash-cleanup.ts` | クリーンアップ本体。純粋関数的: `users` コレクションと任意のスコープフィルタを受け取り `{ aborted, legacyOnly, legacyOnlyNonActive, unset }` を返す。exit せず、env を読まず、自前で接続を開かない。 |
| 共有コア | `server/service/password-hash-format-distribution.ts` | 4 状態の集計と、未移行人数の ACTIVE / 非 ACTIVE 内訳。5 回の逐次カウント（メモリのため意図的に逐次）。 |
| 共有コア | `server/service/password-hash-unmigrated-users.ts` | ページング付き一覧。最終サインイン降順、1 ページあたり外部アカウントを 1 回のバッチ検索で解決。 |
| 分類 | `server/models/user/password-hash-format-filters.ts` | 「旧形式のみ / 両形式 / 新形式のみ / なし」がクエリとして何を意味するかの単一の出どころ。`''` と `null` を「不在」として扱う — 過去の `statusDelete()` が `password: ''` を書いていたため、そうしないと永久に未移行として数えられてしまう。 |
| CLI 入口 | `server/scripts/password-hash-cleanup.ts` | 薄いラッパ: 接続し、コアを呼び、`aborted` を終了コードへ変換し、ロガーを drain する。 |
| API 入口 | `routes/apiv3/security-settings/password-hash.ts` | 3 ハンドラ: status / cleanup / unmigrated-users。 |
| ルーティング | `routes/apiv3/security-settings/index.js` (L1782–1849) | スコープ付きアクセストークン解析・`loginRequiredStrictly`・`adminRequired`、POST には `addActivity` を付けて 3 ルート登録。 |
| クライアント状態 | `stores/admin/password-hash-migration.ts`, `stores/admin/password-hash-unmigrated-users.ts` | SWR フック。一覧側は `isEnabled` ゲートを持ち、開かれるまで fetch しない。 |
| UI | `client/components/Admin/Security/PasswordHashMigration/` | `PasswordHashMigration.tsx`, `UnmigratedUserList.tsx`, `CleanupConfirmModal.tsx` と co-located spec。`LocalSecuritySettingContents.tsx` からマウント。 |
| 監査 | `interfaces/activity.ts` | `ACTION_ADMIN_PASSWORD_HASH_CLEANUP` を宣言し、サポート対象アクション一覧にも登録済み。 |
| i18n | `public/static/locales/{en_US,fr_FR,ja_JP,ko_KR,zh_CN}/admin.json` | `security_settings.password_hash_migration` 配下に各 38 キー。 |

### 既に従っている規約

- **入口は 2 つ、コアは 1 つ。** 操作はどちらの呼び出し側でもなく `service/` に置かれている — リポジトリの「executors take their work-set as input」ルールであり、Requirement 7 を規律ではなく構造によって真にしているのはこれである。
- **アクティビティは `res.apiv3()` の前に emit**（`rules/activity-recording.md`）。`addActivity` は認可チェーンの後ろに置かれており、未認証の拒否が監査されない。
- **テストの co-location**、実 MongoDB に対する `.integ.ts`、ユニット／コンポーネント用の `.spec.ts(x)`。
- **相対 / `~/` 指定子に `.js` を書かない**（`rules/import-convention.md`）。

### 結合面

- `users` コレクション: `password`（旧）と `passwordHash`（新）— この 2 フィールドの有無が 4 状態を定義する。
- `externalaccounts` コレクション: ディスク上のフィールド名は **`user`** であり `userId` ではない。`userId` は Prisma 側のエイリアスにすぎない（`@map("user")`）。一覧実装はこれに依存しており、ずれると全員について「外部アカウントなし」を黙って返す。
- apiv3 スコープ `SCOPE.READ.ADMIN.SECURITY` / `SCOPE.WRITE.ADMIN.SECURITY`。

## 2. Requirement と資産の対応

凡例: ✅ 充足 · ⚠️ 部分的 · ❌ 欠落 · 🔒 制約

### Requirement 1 — 可視化 · **完全充足**

| AC | 状態 | 資産 |
|---|---|---|
| 1.1 | ✅ | `countPasswordHashFormatDistribution` → `DistributionTable` |
| 1.2 | ✅ | 分布上の `legacyOnlyActive` / `legacyOnlyNonActive` |
| 1.3 | ✅ | SWR `error` 時の `status_load_failed` アラート |
| 1.4 | ✅ | クリーンアップ成功後の `mutate()` |
| 1.5 | ✅ | `adminRequired` + `SCOPE.READ.ADMIN.SECURITY` |

### Requirement 2 — クリーンアップ実行 · **1 件の未テスト境界を除き充足**

| AC | 状態 | 資産 |
|---|---|---|
| 2.1 | ✅ | `updateMany(bothFilter, { $unset: { password: '' } })` |
| 2.2 | ✅ | `CleanupConfirmModal` で同意チェックボックスが実行ボタンを制御 |
| 2.3 | ✅ | コミット `d0e066c2db` で確定した文言。ダウングレードが不可能になると主張するのではなく、影響を受けたユーザーが旧ビルド上で既存パスワードでサインインできなくなることを述べている |
| 2.4 | ✅ | `unset` を返し、`cleanup_succeeded` トーストで提示 |
| 2.5 | ✅ | `apiv3Err` → `toastError` |
| 2.6 | ✅ | `addActivity` + `res.apiv3()` 前の emit + `ACTION_ADMIN_PASSWORD_HASH_CLEANUP` |
| 2.7 | ✅ | `adminRequired` + `SCOPE.WRITE.ADMIN.SECURITY` |
| 2.8 | ✅ | `disabled={… || data.distribution.both === 0}` |
| 2.9 | ⚠️ **未確認** | 冪等性は機構的には成立する（空集合に対する `updateMany` は `modifiedCount: 0`）が、**それを主張するテストが存在しない**。しかも現状のゲートは、無害な 2 回目の実行を 409 に変えうる。Requirement 3 の実装後にテストが必要。 |

### Requirement 3 — 未移行者が残っていても実行する · **本当の gap**

| AC | 状態 | 詳細 |
|---|---|---|
| 3.1 | ❌ **欠落** | `password-hash-cleanup.ts` L97–103 が、ACTIVE な未移行ユーザーが 1 人でも存在すると `updateMany` に到達する前に `{ aborted: true, unset: 0 }` を返す。 |
| 3.2 | ✅ | 既に成立している。書き込みは `bothFilter` のみを対象とするため、未移行ユーザーの資格情報には決して触れない — Requirement 3 が依拠する安全性は **既に** 保証されている。 |
| 3.3 | ❌ **欠落** | `scripts/password-hash-cleanup.ts` が `process.exitCode = result.aborted ? 1 : 0` としている。 |
| 3.4 | ⚠️ **部分的** | `blocked` の文言は未移行者を *処理を阻むもの* として枠づけている。Requirement 3.4 が求めるのは逆の枠づけ — 彼らは *影響を受けない* 側である。追加ではなく書き換え。 |
| 3.5 | ✅ | `migration_trigger_note`（コミット `6a62b3eb3c`）が、外部プロバイダ利用者と長命セッション利用者は GROWI を使い続けるだけでは移行しないことを既に説明している。 |

**これが重要である生きた裏付け。** 2026-10-13 に開発 DB へ投入した状態:

```
legacy-ldap       status=2 (ACTIVE)  未移行    ← LDAP の外部アカウントを保持
legacy-old        status=2 (ACTIVE)  両形式    ← サインインにより移行済み
legacy-suspended  status=3           未移行
```

`legacy-old` は移行済みで、その旧形式資格情報は削除可能である。それでもクリーンアップは拒否される。`legacy-ldap` が ACTIVE かつ未移行だからである。そして `legacy-ldap` は LDAP で認証するため、決して移行しない。このゲートはクリーンアップを遅らせているのではなく、**恒久的に阻止している**。これはまさに、この spec が救おうとしているホスティング管理者の状況そのものである。

**ゲート撤廃の影響範囲** — 9 ファイルと、置き換えられる側の spec:

| # | ファイル | 変更 |
|---|---|---|
| 1 | `service/password-hash-cleanup.ts` | 分岐を削除。`aborted` は恒久的に `false` となり、`legacyOnly` は「阻害要因」という意味を失う → 結果型が変わる。 |
| 2 | `service/password-hash-cleanup.integ.ts` | 中断を主張するテストが反転する: 同じ fixture で、両形式ユーザーが削除されることを期待する形へ。 |
| 3 | `scripts/password-hash-cleanup.ts` | 終了コードが `aborted` 由来でなくなる。 |
| 4 | `routes/apiv3/security-settings/password-hash.ts` | 409 分岐が消え、`isCleanupRunnable` が定数になる。 |
| 5 | `routes/apiv3/security-settings/index.js` | 文書化された `409` レスポンスが消える。 |
| 6 | `routes/apiv3/security-settings/password-hash.spec.ts` | 409 のケースが反転する。 |
| 7 | `PasswordHashMigration.tsx` | `StatusBanner` の `!isCleanupRunnable` 分岐が消え、ボタンの `disabled` が `both === 0` だけに縮む。 |
| 8 | `PasswordHashMigration.spec.tsx` | 「クリーンアップを提供しない」ケースが反転する。 |
| 9 | locales × 5 | `blocked` を書き換えるか置き換える。 |
| — | `.kiro/specs/password-hash-upgrade/requirements.md` | Requirement 3.4 は置き換えられたので、その旨を記載すべき。 |

### Requirement 4 — 未移行者一覧 · **完全充足**

| AC | 状態 | 資産 |
|---|---|---|
| 4.1 | ✅ | `listPasswordHashUnmigratedUsers` + `PaginationWrapper`。`totalCount` は集合全体を数える |
| 4.2 | ✅ | username / email / lastLoginAt / hasExternalAccount |
| 4.3 | ✅ | `.sort({ lastLoginAt: -1 })` — MongoDB は昇順で欠損値を先頭に置くため、降順にすると未サインインが末尾に来る |
| 4.4 | ✅ | `UserRow` の非 ACTIVE バッジ |
| 4.5 | ✅ | SWR の `isEnabled` ゲート。折りたたみは既定で閉じている |
| 4.6 | ✅ | `list_load_failed` |
| 4.7 | ✅ | `MAX_LIMIT = 100` でクランプ（拒否ではなくクランプ） |
| 4.8 | ✅ | `adminRequired` |

### Requirement 5 — パネルの寿命 · **充足。Req 3 により簡素化される**

| AC | 状態 | 資産 |
|---|---|---|
| 5.1 | ✅ | `isCleanupCompleted = both === 0 && legacyOnly === 0` |
| 5.2 | ✅ | `if (isLoading || …) return <></>` |
| 5.3 | 🔒 **制約** | `nothing_to_remove` は存在するが、`StatusBanner` は現在 `blocked` を先に判定している。ゲート撤廃によりその分岐が消え、バナーは 2 状態に畳まれる。5.3 と 3.4 は 1 つの変更として計画すべき。 |

### Requirement 6 — 開示内容 · **充足。ただし無防備**

| AC | 状態 | 資産 |
|---|---|---|
| 6.1 | ✅ | 全 5 ロケールを `sha-?256` / `scrypt` で走査: **0 件** |
| 6.2 | ✅ | `password-hash:` / `downgrade-prep` / `reupgrade-prep` / `pnpm run` で走査: **0 件**（コミット `530b665d6e`） |
| 6.3 | ✅ | コミット `0b1a3d2593` で「パスワード保存の強化」として再構成 |
| 6.4 | ✅ | 38 キー × 5 ロケール、未使用キーなし |
| — | ❌ **欠落** | **自動ガードがない。** 上記の走査はその場限りのものであり、将来の文言がアルゴリズム名やスクリプト名を再び持ち込むのを止めるものは何もない。Requirement 6.1 と 6.2 は本 spec で唯一機械的に検査可能な受入基準であり、ロケールファイルに対する drift spec は安価である。 |

### Requirement 7 — 2 経路の一致 · **構造により充足**

| AC | 状態 | 資産 |
|---|---|---|
| 7.1 | ✅ | 両入口が同一の `runPasswordHashCleanup` を呼ぶ。どちらも選択規則を再実装していない |
| 7.2 | ✅ | 両者とも `unset` = `modifiedCount` を報告する |

## 3. 実装方針の選択肢

### Option A — 既存実装を spec に合わせて改訂する

ブランチを基準線として扱う。タスクは次のようになる: Requirement 3 を充足させる（9 ファイルに波及する削除）、Requirement 2.9 の冪等性テストを追加する、Requirement 6 のロケール drift ガードを追加する、残る 32 の受入基準を既存テストに照らして検証し証跡を記録する。

- ✅ 既存のテスト群を保持できる。完了判定のリグレッションテストは mutation 検証済み（修正を戻すとちょうどその 2 本が落ちることを確認済み）である。
- ✅ レビュー中にユーザー自身が見つけて修正した 5 つの判断を保持できる — ダウングレード文言の自己矛盾、早すぎる「完了」バナー、CLI スクリプト名、アルゴリズム名、ACTIVE でも未移行になる理由の注記。これらはいずれも spec の文面から導出できない。画面を見て見つかったものである。
- ✅ spec としての筋は通る。Requirement 3 は実際に未実装であり、検証タスクは主張ではなく証跡を生む。
- ❌ 「１から実装」の文字どおりの読みには合致しない。
- ❌ 追認に堕するリスク。「もうできています」とだけ言う検証タスクは、それを証明するテストを名指ししない限り何の価値もない。

**Effort: S**（1–3 日） — 既存ファイル内での 1 つの挙動変更と 2 本のテスト。**Risk: Low** — 変更は削除であり、安全性（3.2）は独立に既に保証されており、反転するテストは mutation 検証が容易である。

### Option B — spec に対してゼロから作り直す

ブランチをリセットし、`/kiro-impl` でタスクごとに RED を出しながら全ファイルを再導出する。

- ✅ 依頼への文字どおりの適合。すべての行が spec 由来の来歴を持つ。
- ✅ おそらくより整った形になる。ゲート撤廃により、現在それを抱えているいくつかのインタフェース（`aborted`、`isCleanupRunnable`、409）が簡素化されるため。
- ❌ 動作し、レビューを受け、テストされている約 1,400 行を捨てて、ほぼ同じものを再導出することになる。
- ❌ レビューで見つかった 5 つの文言判断は、それを生んだ解像度では spec に入っていないため、再発見するか手作業で持ち越す必要がある。
- ❌ PR #11980 はレビュー履歴とともに開いている。force-push すればその文脈が失われる。

**Effort: L**（1–2 週間） **Risk: Medium** — 技術的なリスクは高くないが、決着済みの判断を再び開くことになり、リグレッション群を同じ水準まで作り直す必要がある。

### Option C — ハイブリッド: サーバコアを残し、管理画面側を再導出する

3 つの `service/` モジュールとその integ テスト（Requirement 7 が依拠し、CLI と共有している部分）を残し、ルートハンドラ・ストア・コンポーネントを spec から再導出する。

- ✅ 作り直しが最も困難な部分（MongoDB を使う integ テスト）を保持し、最も安価な部分を再導出する。
- ❌ 切れ目が恣意的。Requirement 3 はこの境界をまたいで、コア・ルート・UI を一度に触る。
- ❌ 文言判断の半分は UI 側にあり、やはり失われる。

**Effort: M**（3–7 日） **Risk: Medium**

## 4. 設計フェーズへの推奨

**推奨は Option A。** ただし設計書は新規機能であるかのように書き（spec が単体で成立し、`password-hash-upgrade` の置き換えが正しく記録されるように）、タスク一覧は *挙動変更* タスクと *検証* タスクに分ける。

設計で決着させるべき論点:

1. **`aborted` を何に置き換えるか。** 結果型は、もはや存在しない判断を表現している。選択肢: フィールドごと削除する、あるいは `legacyOnly` / `legacyOnlyNonActive` を純粋に情報として報告し続ける。CLI の終了コードと API のレスポンス形状の両方に影響する。
2. **`isCleanupRunnable` を API に残すか。** これは `both > 0` と同値になり、クライアントは既に分布から同じ情報を持っている。削除は apiv3 レスポンスの変更として文書化が必要である（唯一の利用者が自前のパネルであっても）。
3. **CLI の終了コードの意味**。中断しえなくなった以降は、完了時 `0`、エラー時のみ非ゼロ、という想定でよいか。
4. **`password-hash-upgrade` Requirement 3.4 をどう退役させるか。** 同 spec の requirements.md に置き換えの注記を入れるか、記録を本 spec 側だけに留めるか。未修正のまま残すと、2 つの spec が矛盾する規則を述べることになる。
5. **ゲート撤廃後のバナー状態。** 3 状態が 2 つ（`ready_to_cleanup`、`nothing_to_remove`）に畳まれる。4 つ目が不要であることを確認する。

### Research Needed

- **R1 — コンポーネントテストがローカルで実行できない。** ワークスペースルートが `@testing-library/react` を宣言しているのに `react` / `react-dom` の peer を持たないため、この環境ではすべての `.spec.tsx` が実行に失敗する（CI では問題なく通る）。`kiro-impl` は各タスクで RED 出力の取得を必須とするため、**UI タスクにはその証跡をローカルで作る手段がない。** 実装前に方針を決めること: ルートの peer を修正する（ユーザーは以前この修正のコミットを見送っている）、UI spec を CI でのみ実行する、あるいは TDD ゲートをサーバタスクに限定する。実装フェーズを止める可能性が最も高いのはこれである。
- **R2 — `PasswordHashCleanupResult.aborted` の他の利用者がいないことの確認。** リポジトリ全体の grep では 2 つの入口とそのテストしか出てこないが、downgrade-prep と re-upgrade-prep のスクリプトは `script-runner` のヘルパを共有しているため、影響がないことを確認すべき。
- **R3 — Requirement 3 の上に積む前にレビュワーの合意を取ること。** `yuki-takei` 氏が指摘し、ユーザーもその方向に同意しているが、PR #11980 上での明示的な承認は記録されていない。Requirement 3 は唯一の実質的な残作業であり、これが覆ると spec は存在理由を失う。

---

# Design Discovery — 2026-10-14

_`/kiro-spec-design` の Light Discovery（既存システムの拡張）として実施。開発 DB 上の実測を伴う。_

## 調査スコープ

requirements.md を書いた時点では未検証だった**性能と一貫性**を、`explain` と実データで確認した。gap 分析（上記）が挙動面の穴を洗ったのに対し、ここは非機能面を洗っている。

## 実測した事項

### I-1. `users` の既存インデックス

```
_id_ / name_1 / username_1 / email_1 / slackMemberId_1 / apiToken_1
status_1 / lastLoginAt_1 / admin_1 / username_ci (username+status)
```

`password` / `passwordHash` にインデックスは無い。`lastLoginAt_1` は存在し、**sparse ではない**（`isSparse: false`）。

インデックス宣言は Mongoose 側（`src/server/models/user/index.js:94`）にある。`.claude/rules/model.md` のとおり、全モデルの Prisma 移行が完了するまでインデックス生成は Mongoose が担当する。したがって追加インデックスもスキーマ宣言で行う。

### I-2. クエリプラン（`explain('queryPlanner')`）

| クエリ | プラン |
|---|---|
| `legacyOnly` カウント | `COLLSCAN` |
| `both` カウント | `COLLSCAN` |
| `legacyOnly` + `sort({ lastLoginAt: -1 })` + `limit(20)` | `LIMIT <- FETCH <- IXSCAN(lastLoginAt_1, backward)` |

一覧はインデックスを使うため、メモリソート 32MB 上限による失敗は起きない。**ただしこれは安全性の話であって効率の話ではない。** `lastLoginAt_1` が sparse でないため欠損値は降順スキャンの最後尾に来る。未移行者は定義上ログインしていないので `lastLoginAt` が古いか欠損しており、**UX のために選んだ並び順（4.3）がインデックス走査にとって最悪の順序**になっている。移行終盤に 1 ページ目を埋めるだけでほぼ全件 FETCH しうる。

### I-3. 部分インデックスの採用可否（実測）

開発 DB に次を作成して `explain` し、作成前の状態へ戻した。

```
{ lastLoginAt: -1 }, partialFilterExpression: { password: { $exists: true } }
```

| クエリ | プラン |
|---|---|
| `legacyOnly` + sort + limit | `LIMIT <- FETCH <- IXSCAN(部分インデックス)` ✅ 採用される |
| `legacyOnly` カウント | `COLLSCAN` ❌ 採用されない |
| `both` カウント | `COLLSCAN` ❌ 採用されない |

カウントで採用されないのは、述語に `lastLoginAt` が含まれずインデックスキーが絞り込みに寄与しないためである。**つまり一覧の問題は部分インデックスで解けるが、カウントの問題は解けない。** 別の手段が要る。

> 注意: 開発 DB の件数は 5 件であり、プランナのコスト推定は大規模コレクションを代表しない。「採用される」ことは確認できたが、「どの規模から有利になるか」はここからは言えない。

### I-4. 集約 1 パスによるカウント（実測）

`$group` + `$cond` で 4 状態と ACTIVE 内訳を 1 パスで算出し、既存の逐次 `countDocuments` と突き合わせた。

```
集約1パス : {both:1, legacyOnly:2, upgradedOnly:2, noPassword:0, legacyOnlyActive:1}
逐次count  : {both:1, legacyOnly:2, upgradedOnly:2, noPassword:0, legacyOnlyActive:1}
=> 一致
```

### I-5. クリーンアップ後に旧ハッシュは復活しない（コード確認）

`user/index.js:220-226` の `setPassword` は `options.keepLegacyHash` が真のとき `this.password` に**触れない**（消さないだけで、書き込みもしない）。かつ `passport.ts:124` の遅延移行は `needsRehash`（旧経路で検証が成立したとき）にのみ走る。クリーンアップ後のユーザーは新形式のみを持つため旧経路に入らず、`needsRehash` は真にならない。

さらに Mongoose の `save()` は変更済みパスのみを送るため、遅延移行とクリーンアップが競合しても `password` が書き戻されることはない。

→ **Requirement 5.1（旧形式が無くなったらパネルが消える）は恒久的に成立する。** 懸念は解消。

## Design Decisions

### D-1. 中断分岐を撤廃し、`aborted` を結果型から除去する

gap 分析の実測（`legacy-ldap` が `legacy-old` の削除を恒久的に阻止）が根拠。「中断したか」という問いが消えるため、フィールドを残せば呼び出し側に恒久的に偽の分岐点を残すことになる。`legacyOnly` は `legacyOnlyActive` に改名する — 旧名は「阻害要因の数」を含意しており、その意味は失われた。

副次的に 409 応答と `isCleanupRunnable` が不要になる（D-3）。

### D-2. カウントを集約 1 パスへ置換する — 性能ではなく**正しさ**が理由

当初は I-2 の COLLSCAN × 5 を性能問題として検討したが、調査中により重大な問題が判明した。

**逐次カウントは各クエリが別時点を見る。** 遅延移行がカウント間に発生すると、そのユーザーはどの状態にも数えられない（`both` のカウント時点では未移行、`legacyOnly` のカウント時点では移行済み）。最悪の場合、`both` と `legacyOnly` がともに 0 と読まれ、`isCleanupCompleted` が真になって**旧形式資格情報が残っているのにパネルが消える**。

単一の集約パスはこの窓を閉じる。走査回数が 5 → 1 になるのは副次的な利点にすぎない。

現行コードの「メモリのため逐次」という注記はこの置換を妨げない。固定個数のカウンタによる `$group` の所要メモリは入力件数に依存しないためである。

**採用に伴うリスク**: 分類規則がクエリフィルタと集約式の 2 形式で表現される。ずれると「分布だけが誤り、削除は正しい」という発見しにくい不整合になる。I-4 の突き合わせを drift テストとして固定することを必須とする。

### D-3. `isCleanupRunnable` を API レスポンスから除去し、`isCleanupCompleted` は残す

中断撤廃後、`isCleanupRunnable` は `both > 0` と同値になる。クライアントは `distribution` から同じ判断ができるため、残すと「サーバが別の規則を持っている」という誤った示唆になる。

一方 `isCleanupCompleted` は `both === 0 && legacyOnly === 0` という非自明な規則であり、過去にクライアント側で `both === 0` と誤導出して「未移行者しかいないのに完了」と表示する不具合を起こしている（コミット `ac35dddf8d`）。サーバ側に置くことが再発防止であるため残す。

### D-4. 部分インデックスを追加する

I-3 で採用を実測確認済み。移行が進むほどインデックスが縮小し、完了時に空になるという性質が、一度きりの移行という本機能の性格に合う。MongoDB 4.2 以降インデックス構築はつねにバックグラウンドのため、大規模な既存コレクションでも書き込みを止めない。

### D-5. クリーンアップ本体は最適化しない

`bothFilter` の COLLSCAN + `updateMany` はそのままとする。一度きりの管理操作であり、対象集合は移行完了に向けて単調に減少する。ここにインデックスを足すと、不要になった時点で残骸が残る。

## Synthesis

**Generalization**: 4 状態 + ACTIVE 内訳は「資格情報フィールドの有無による分類」という単一の問題の変種である。ただし D-2 によりこれが 2 つの表現形式（クエリフィルタ / 集約式）を持つことになるため、一般化ではなく**同一性の固定（drift テスト）**で扱う。

**Build vs Adopt**: 集約パイプラインと部分インデックスはいずれも MongoDB のネイティブ機能であり、構築するものは無い。`PaginationWrapper`・SWR・`toastr` も既存。**新規ライブラリ依存はゼロ。**

**Simplification**: 中断撤廃により `aborted`・`isCleanupRunnable`・409 経路・バナーの 1 状態が消える。正味で構成要素が減る設計である。新規コンポーネントは作らない。

## 未解決

- **R1**: `.spec.tsx` がローカルで実行できない（ルートに `react` / `react-dom` の peer が無い）。`kiro-impl` の RED 証跡を UI タスクで取得できないため、実装着手前に方針決定が必要。
- **R3**: Requirement 3 の上流合意が未記録。design.md がその資料を兼ねる。
- `PASSWORD_SEED` の撤去案内。移行完了後に不要となるが、テナント管理者の権限外であり本 spec では扱わない。

---

# Design Validation — 2026-10-14

_`/kiro-validate-design` による設計レビューと、その過程での前提の訂正。_

## D-2 の改訂: `$group` ではなく `$facet` を採る

当初の D-2 は `$group` + `$cond` による集約を採用し、分類規則をクエリフィルタとは別の集約式として再表現することを前提にしていた。これは「発見しにくい不整合」を生むリスクを伴い、それを支えるための drift テストを必須としていた。

レビューで `$facet` + `$match` という代替を検討し、実測した。

```
$facet(既存フィルタを $match に流用): {both:1, legacyOnly:2, upgradedOnly:2, noPassword:0, legacyOnlyActive:1}
逐次countDocuments                  : {both:1, legacyOnly:2, upgradedOnly:2, noPassword:0, legacyOnlyActive:1}
=> 一致
```

`$match` は通常のクエリ構文を受け取るため、`password-hash-format-filters.ts` の輸出を**そのまま**渡せる。単一スナップショット・単一パスという利点は `$group` 版と同じで、分類規則の重複はゼロになる。`$facet` が `$group` を支配するため、D-2 を差し替え、専用の drift テストを設計から削除した。

**あわせて D-2 の論拠を訂正した。** 当初「正しさが理由」と書いたが、これは誇張だった。最悪ケース（パネルが消える）は「旧形式を持つユーザーがちょうど 1 人、かつカウント間のミリ秒窓で移行」という条件を要し、再読み込みで自己修復する。データは失われない。実際の価値は**表示の内部整合性**（分布表の合計がユーザー総数と合う、一覧の件数と一致する）であり、そちらを主たる理由に改めた。

## D-6（新規）: クリーンアップ結果から報告用の集計を外す

`PasswordHashCleanupResult` が保持していた `legacyOnlyActive` / `legacyOnlyNonActive` を削除し、`{ unset }` のみとした。理由は 2 つ。

1. 中断撤廃後これらは分岐に使われず、API 経路は破棄する。CLI のログ行のためだけに 2 回の追加走査を払っていた。
2. より重要な点として、これらは `updateMany` の**前に別クエリで**取得される。すなわち D-2 で問題視したのと同じ「別時点のスナップショット」を、同じ設計の中に残していた。論拠が自分自身に適用されていなかった。

CLI が報告を要する場合は `countPasswordHashFormatDistribution` を別途呼ぶ。削除と報告が分離され、報告側は一貫スナップショットの恩恵を受ける。

## R1 の撤回: 依存関係の問題ではなく、ローカル環境の不整合だった

本セッションを通じて「コンポーネントテストはローカルで実行できない。ルートが `@testing-library/react` を宣言しているのに `react` / `react-dom` の peer を持たないためで、CI では通る」という前提で進めてきた。この前提を検証した結果、**誤りだった**。

**調査の経緯:**

1. ローカルで `PasswordHashMigration.spec` が `Cannot find module 'react'` で失敗（`Tests: no tests` — 1 件も実行されない）。
2. **master に元からある** `VaultAdminSettings.spec.tsx` も同じエラーで失敗 → ブランチ固有ではなく、ローカルの全コンポーネントテストが壊れている。
3. master の CI は success。実際のログを確認:

```
ci-app-test  $ vitest run --project=app-components
  ✓ app-components  src/features/growi-vault/client/admin/VaultAdminSettings.spec.tsx (42 tests) 2237ms
```

ローカルで 0 件のファイルが、CI では 42 件すべて通っている。

4. CI のインストールログは `+ @testing-library/dom 10.4.2`。一方ローカルの解決は `@testing-library+react@16.0.1_@testing-library+dom@10.4.1_...` で **10.4.1**。peer のハッシュが異なるため別スナップショットになり、ローカル側では `react` がリンクされていない。
5. `pnpm install` も `pnpm install --force` も「Already up to date」と報告して再リンクしない。pnpm は lockfile のハッシュのみを見るため、この種の乖離を検知できない。

**結論**: 依存関係の宣言には問題がない。CI がそれを証明している。壊れているのはこの開発環境の `node_modules` であり、おそらく以前ルートに `react` を追加して revert した際の残骸である。package.json の変更は不要で、`node_modules` の作り直しで解消する。

したがって当初検討していた 2 案 — 「ルートに react/react-dom を追加」「UI テストを CI 専用とし TDD ゲートをサーバタスクに限定」 — は、いずれも存在しない問題への対処だった。両案とも破棄する。

**教訓**: 「CI では通る」を前提として受け取りながら、それが何を含意するか（ローカルとの差分はどこか）を詰めていなかった。前提そのものを一度も検証していない状態で、その上に 2 つの対処案を設計していた。
