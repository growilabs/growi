# Gap Analysis: legacy-password-hash-cleanup

_実施日: 2026-10-21 / 対象: requirements.md（未承認の段階で実施）_

## 1. 現状調査

### 再利用できる資産
| 資産 | 場所 | 内容 |
|---|---|---|
| 形式分類フィルタ | `apps/app/src/server/models/user/password-hash-format-filters.ts` | `upgradedOnlyFilter` / `bothFilter` / `legacyOnlyFilter` / `noPasswordFilter` / `activeUserFilter` / `nonActiveUserFilter` / `scopeFilter`。status migration と 3 つのスクリプトで共有している唯一の定義で、空文字や null は「値なし」とみなす |
| cleanup の中核処理 | `apps/app/src/server/scripts/password-hash-cleanup.ts` `runPasswordHashCleanup(usersCollection, baseFilter)` | ① 未移行ユーザーを ACTIVE とそれ以外に分けて数える → ② ACTIVE が 1 人以上いれば中止 → ③ `updateMany(bothFilter, $unset password)`。③ はステータスで絞らない。`process.exit` は呼ばず、結果をオブジェクトで返す |
| status の集計 | `apps/app/src/migrations/20260724000001-password-hash-status.js` `reportPasswordHashFormatDistribution(baseFilter)` | 4 区分を Prisma の `$runCommandRaw({count})` で数える。ステータスでは分けない |
| 管理画面のセキュリティ設定 | `client/components/Admin/Security/SecurityManagementContents.jsx` | `mb-5` + `h2.border-bottom` のセクションを縦に並べる構成。状態管理は unstated container が中心 |
| サーバー側の設定 API | `server/routes/apiv3/security-settings/index.js`（1778 行） | `/_api/v3/security-setting` に mount。参照は `accessTokenParser(READ.ADMIN.SECURITY) + loginRequiredStrictly + adminRequired`、更新はさらに `addActivity` と `activityEvent.emit('update', …)` を付ける |
| 一括削除 UI の前例 | `ShareLinkSetting.tsx` + `DeleteAllShareLinksModal.jsx`、サーバー側は `routes/apiv3/share-links.js:357-369` | 対象が 0 件ならボタンを無効にする。確認モーダル → 削除 → `deletedCount` をトーストで表示 → `ACTION_SHARE_LINK_ALL_DELETE` を記録 |
| 汎用の確認モーダル | `client/components/Admin/App/ConfirmModal.tsx` | `V5PageMigration.tsx` で警告文付きで使われている |
| feature 単位で作った管理機能の前例 | `features/growi-vault/{client/admin, server/routes/vault-admin.ts}` | 独立した router（`/vault`）と管理画面コンポーネントを持つ |
| 監査ログ | `interfaces/activity.ts`（`SupportedAction` / `LargeActionGroup`）、`models/activity.ts`（`snapshot`） | 新しい action を足すには、定数・`SupportedAction`・`LargeActionGroup`・`admin.json` 5 ロケールのラベルの追加が要る。`snapshot` は判別共用体で、既定は `{ username? }` だけ |

### 慣例
- 管理機能のテストは `*.integ.ts` で、`baseFilter`（テスト用マーカー）を使って共有の `users` コレクションに触れない形が定着している（`password-hash-cleanup.integ.ts` など）。
- スクリプト本体は「中核の処理を返り値付きの関数にし、CLI は薄い wrapper にする」方針（coding-style の Pure Function Extraction）。

## 2. 要件と資産の対応

| 要件 | 使える資産 | ギャップ |
|---|---|---|
| R1.1 4 区分の件数 | 形式分類フィルタ、status の集計 | **Missing**: HTTP から呼べる集計関数がない（集計は migration ファイルの中にある） |
| R1.2 未移行ユーザーの ACTIVE 内訳 | `activeUserFilter` / `nonActiveUserFilter` | **Missing**: 内訳を数える処理（cleanup の中にはあるが、集計関数としては公開されていない） |
| R1.3–1.5 対象件数の明示・削除後の更新・取得失敗時の扱い | — | **Missing**: UI と取得 API |
| R2.1–2.3 ステータスを問わず削除し、中止しない | `runPasswordHashCleanup` の ③ | **Constraint**: 既存関数は ①→②（中止）→③ がひとつにまとまっている。R5.1 で中止する挙動は残す必要があるので、③ だけを呼べる形に分ける必要がある |
| R2.4 削除件数の表示 | `updateResult.modifiedCount` | 返せばよいだけ |
| R2.5–2.7 0 件のときの無効化・冪等性・エラー表示 | share-link の前例 | 前例に倣えばよい |
| R2.8 現行バージョンでのログイン | `passwordHashService.verify` は新形式を優先する | ギャップなし（既存の挙動を確かめるテストを足すだけ） |
| R3 確認ダイアログと警告 | `ConfirmModal` / `DeleteAllShareLinksModal` | **Missing**: 警告文。ダイアログを新しく作るか、既存を使うかは設計で決める |
| R4.1–4.2 管理者だけに許可 | `adminRequired` と SCOPE | ギャップなし |
| R4.3 監査ログ | `addActivity` / `activityEvent` | **Missing**: 新しい `SupportedAction`、`LargeActionGroup` への登録、5 ロケールのラベル。**Unknown**: 削除件数も記録するなら snapshot の新しい variant が要る |
| R4.4 ハッシュ値を出さない | — | 件数だけを返す API にすれば満たせる |
| R5.1 スクリプトの挙動を変えない | `password-hash-cleanup.integ.ts` | **Constraint**: 分割しても、既存の integ テストがそのまま通ること |
| R5.2–5.3 判定基準の共有 | 形式分類フィルタ | 同じフィルタを使えば満たせる |
| R6 多言語対応 | `public/static/locales/*/admin.json` | **Missing**: 5 ロケール分の文言 |

## 3. 実装方針の選択肢

### Option A: 既存ファイルを拡張する
- `runPasswordHashCleanup` に、未移行の ACTIVE ユーザーがいても中止しないオプションを足す（例: `{ abortOnActiveLegacyOnly: false }`）。
- `security-settings/index.js` に `GET /password-hash-status` と `DELETE /legacy-passwords` を足す。
- `Admin/Security/` にセクションのコンポーネントを足し、`SecurityManagementContents.jsx` に並べる。
- ✅ 新しく作るファイルが最小で済み、既存の SCOPE や監査ログの使い方にそのまま乗れる
- ❌ `security-settings/index.js` はすでに 1778 行あり、JS のまま肥大化する
- ❌ 管理画面のサーバー処理が `server/scripts/` を import することになり、依存の向きが不自然（スクリプトは CLI の入口という位置づけ）
- ❌ 中止するかどうかを真偽値のオプションで切り替えるのは、coding-style の「モードの分岐をフラグで持たない」方針に反する

### Option B: 新しい feature として作る
- `features/password-hash-cleanup/`（仮の名前）に server（router、service）と client（セクション、モーダル、SWR hook）をまとめる。
- 集計と削除の中核処理も feature 内に新しく書き、既存のスクリプトはそのまま残す。
- ✅ 責務がはっきり分かれ、TS で書ける。growi-vault という前例がある
- ❌ 中核処理を二重に持つことになり、R5.2「同じ基準」が実装のうえで保証されない（フィルタを共有するだけになる）。プロジェクト説明の「削除ロジックを共有する」にも反する

### Option C: 中核処理を共有の場所に切り出し、入口だけ新しく作る（ハイブリッド）
- **共有の中核処理**: `server/models/user/`（または `server/service/password-hash/`）に、次の 2 つの関数を置く。
  - `countPasswordHashFormats(collection, baseFilter)`: 4 区分の件数と、未移行ユーザーの ACTIVE 内訳を返す
  - `unsetLegacyPasswordOfMigratedUsers(collection, baseFilter)`: ③ に当たる処理。削除件数を返す
- **既存スクリプト**: `runPasswordHashCleanup` は、①② の中止判定を残したまま ③ だけを上の関数に置き換える。挙動は変わらない。status migration の集計も、同じ関数に寄せるかどうかを検討する。
- **新しい入口**: 小さな TS の router（`security-settings` の下に別ファイルで作るか、feature のディレクトリに置く）と、管理画面のセクション。
- ✅ 削除の基準をコードとして 1 か所で持てる（R5.2）。スクリプトは薄いままで、既存の integ テストが回帰の検出に使える
- ✅ 1778 行の JS ファイルを大きくしない
- ❌ 既存スクリプトのリファクタが含まれるので、変更範囲が少し広がる

## 4. 設計フェーズで調べること（Research Needed）
1. **監査ログに削除件数を残すか**: `snapshot` に新しい variant を足すか、action の記録だけにするか。activity-log-snapshot spec の型付け方針に合わせて決める。activity-log（記録ゲート）spec で、新しい action を記録対象として扱う方法も確認する。
2. **status migration の集計を共通化するか**: migration は `.js` で Prisma の `$runCommandRaw` を使い、スクリプトは mongoose の `Collection` を使う。集計を 1 か所にまとめられるか、それとも区分のフィルタを共有するだけにとどめるか。
3. **API の置き場所とパス**: `/security-setting` の下に置くか、独立した router にするか。SCOPE は `ADMIN.SECURITY` を使い回せるか。
4. **クライアントの状態管理**: 既存のセキュリティ設定画面は unstated container が中心。新しいセクションは SWR を使うのが方針どおりだが、混在しても問題ないか確認する。
5. **同時実行**: 削除の最中に遅延移行（ログイン）で未移行から両形式に変わるユーザーがいても、`updateMany` は 1 回で済み、冪等なので問題ないはず。設計で一言触れておく。

## 5. 規模とリスク
- **規模: M（3–5 日）**。サーバー（中核処理の切り出し、API 2 本、監査ログの action）、クライアント（セクションとモーダル）、5 ロケールの文言、integ テストを合わせた量。どれも既存のパターンに沿う。
- **リスク: Low**。データへの書き込みは既存の cleanup と同じ `$unset` で、新しい技術は使わない。注意が要るのはリファクタによる既存スクリプトの退行で、既存の integ テストで検出できる。

## 6. 設計フェーズへの提言
- 第一候補は **Option C**。「削除ロジックを共有する」という決定を、コードとして 1 か所に置く形で満たせる。
- 設計で決めること:
  - 共有する中核処理の置き場所と、その名前
  - 中止判定を「スクリプト側の方針」として呼び出し元に残す形にすること（中核処理にモードを持たせない）
  - 監査ログの snapshot に件数を含めるか
  - API のパス

---

# Design Discovery & Decisions（/kiro-spec-design, 2026-10-21）

## Summary
- **Feature**: `legacy-password-hash-cleanup`
- **Discovery Scope**: Extension（light discovery）
- **Key Findings**:
  - apiv3 の配下には、エンドポイントごとに TS の handler factory を作り、JS の index から登録する前例がある（`personal-setting/delete-all-access-tokens.ts`）。1778 行の `security-settings/index.js` を大きくせずに済む。
  - 管理画面の新しい機能は `stores/admin/*` の SWR hook（`useSWRxExportStatus` + `useSWRImmutable` + `mutate`）で作られている。汎用の `ConfirmModal` には、警告文と補足文を差し込める。
  - route の integ テストは、supertest でミドルウェアを差し替える形（`app-settings/file-upload-setting.integ.ts`）。サービスの integ テストは、`baseFilter` マーカーで共有の `users` コレクションに触れない形が定着している。

## Design Decisions

### Decision: 中止判定は入口側に置き、共有サービスには持たせない
- **Context**: スクリプトは未移行の ACTIVE ユーザーがいると中止し（5.1）、画面からは中止せずに削除する（2.3）。
- **Alternatives**: (1) `runPasswordHashCleanup` に `abortOnActiveLegacyOnly` フラグを足す (2) 集計と除去を共有サービスに出し、中止判定はスクリプトだけが持つ
- **Selected**: (2)
- **Rationale**: coding-style の「モードをフラグで分岐させない」方針に合う。除去の基準（`bothFilter`）が 1 か所に置かれる。
- **Trade-offs**: スクリプトの内部をリファクタする必要がある。既存の integ テストで回帰を検出できる。

### Decision: CLI では中止し、画面では中止しない理由
- **Context**: CLI は、未移行の ACTIVE ユーザーがいると削除を中止する。画面は中止しない（2.3）。既存スクリプトのコメントは、中止の理由を「今削除すると、ダウングレードした後に認証できなくなるユーザーが出る」と書いている。upgrade spec の design.md は、cleanup を「全員の移行を確認したあとの最終段階（Phase 3）」と位置づけている。入口ごとに挙動が違う理由を残しておかないと、将来どちらかに揃えられてしまう。
- **中止判定が守っているもの**: ユーザーの資格情報ではない。削除の対象は両形式を持つユーザーだけで、未移行ユーザーの `password` には触れない。だから、中止してもしなくても、未移行ユーザーがダウングレード後にログインできるかどうかは変わらない。ダウングレード後にログインできなくなるのは削除された両形式のユーザー（削除後は新形式だけになる）で、中止判定はこのユーザーを守らない。スクリプトのコメントにある理由は、実際の効果とは合っていない。中止判定が実際に担っているのは、upgrade spec の運用手順における「全員の移行を確認してから最終段階に進む」という合図である。
- **画面では中止しなくても安全な理由**: 上のとおり、中止しなくても、どのユーザーの資格情報も新たに失われない。削除によって起きる影響（ダウングレード後に、削除したユーザーがログインできなくなること。再アップグレード準備スクリプトの前に実行すると、そのユーザーを直せなくなること）は、中止判定の有無とは関係ない。この影響は確認ダイアログの警告で伝える（3.3）。また、LDAP / OAuth / SAML でサインインするユーザーなど、ACTIVE のまま永久に未移行で残るユーザーがいると、中止判定がある限り削除を実行できなくなる。シェルに入れない管理者にとっては、これが画面を作る目的そのものを妨げる。
- **それでも CLI で中止を残す理由**: この spec の範囲を、画面の追加に限るため。CLI の中止をやめることは、upgrade spec の Req 3.4 と運用手順（Phase 3）を変えることになり、この spec が持つべき変更ではない（Out of Boundary）。CLI を使う管理者の手順も変えずに済む。CLI の中止をやめるなら、upgrade spec を改める別の変更として行う。
- **Revalidation**: upgrade spec の Req 3.4 や Phase 3 の位置づけが変わったら、この Decision を見直す。

### Decision: status migration は書き換えない
- **Context**: 5.3 は「区分の定義を同じにする」こと。migration は `.js` で Prisma の `$runCommandRaw` を使っており、すでに適用済みの migration でもある。
- **Selected**: フィルタを共有することで 5.3 を満たし、migration のコードには触れない。
- **Rationale**: 適用済みの migration を変えるリスクと、得られるものが釣り合わない。

### Decision: 監査ログには件数を残さない（サーバーログに残す）
- **Context**: ユーザーと相談して決めた。前例（`SHARE_LINK_ALL_DELETE`）も件数を記録していない。
- **Selected**: action だけを記録し、snapshot は既定のままにする。除去した件数は、サービスの `logger.info` で出す。

### Decision: API の置き場所
- **Selected**: `/_api/v3/security-setting/password-hash-status`（GET）と `/_api/v3/security-setting/legacy-passwords`（DELETE）。handler は `security-settings/` の下に別ファイルで置く。
- **Rationale**: 権限と SCOPE をセキュリティ設定と揃えられる。独立した router を作るほどの規模ではない（Simplification）。

### Synthesis
- **Generalization**: 「件数の取得」と「除去」は、どちらも「形式分類フィルタで users を扱う」という同じ問題の変種。1 つのサービスにまとめる。
- **Build vs Adopt**: 新しい依存は入れない。UI の部品は既存の `ConfirmModal` と toastr を使う。
- **Simplification**: feature ディレクトリや独立した router、モーダルの新規作成はやめた。

## Risks & Mitigations
- スクリプトのリファクタで退行する: 既存の integ テストを変えずに通すことを完了の条件にする。
- activity-log の記録ゲートで新しい action が落とされる: Revalidation Trigger として design.md に書いた。
- 途中で失敗すると一部だけが除去される: 冪等なので再実行で回復する。クライアントは失敗した後に件数を取り直す。

## Design Review 反映（/kiro-validate-design, 2026-10-21）
- **監査ログの記録範囲**: `AUDIT_LOG_ENABLED` の既定値は false、`AUDIT_LOG_ACTION_GROUP_SIZE` の既定値は SMALL で、既存の管理者操作はすべて `LargeActionGroup` にだけ入っている（`service/activity.ts` の `getAvailableActions`）。ユーザーと相談し、前例どおり LARGE に入れると決めた。R4.3 は「監査ログが有効で記録対象のとき」という条件付きに改め、設定にかかわらず実行者と件数をサーバーログに出す R4.5 を追加した。
- **管理者以外のアクセスへの応答**: `adminRequired` は、管理者でないユーザーを 403 ではなく `/` への 302 リダイレクトで拒否する。API の契約とテストをこの挙動に合わせた。

## Design Review 2 回目の反映（/kiro-validate-design, 2026-10-21）
- **i18n の検証方法**: このブランチの apps/app には `lint:i18n` スクリプトがない。`features/growi-vault/client/i18n-reconcile.spec.ts` に倣い、5 ロケールにキーが揃っているかを確かめる spec を 6.1 の検証とした。
- **route のトップレベル制約**: `lint:route-guard` は、route モジュールのトップレベルでの副作用を禁止している。`users` コレクションは handler の中で、リクエストごとに `mongoose.connection.collection('users')` から取得する。
- **確認ダイアログ**: 既存の `ConfirmModal` には手を加えずに使う（ユーザーが選択）。実行ボタンは青のままで、処理中も無効化しない。二重実行は、サーバー側の削除が冪等なので許容する。

## Design Review 3 回目の反映（/kiro-validate-design, 2026-10-21）
- **失敗時の監査ログ**: `addActivity` を通ったリクエストがステータス 400 以上で終わると、`registerFailsafeFinalizer` → `recordFailsafeAttempt` が `ACTION_UNSETTLED` の試行記録を 1 行残す。「失敗時は監査ログを記録しない」という設計の記述は正確ではなかったので、「`ADMIN_LEGACY_PASSWORD_DELETE` を emit しない（試行記録は基盤の既存の挙動）」に直した。

## PR #12101 レビューの反映（2026-10-23）
- **失敗時のステータス**: `res.apiv3Err` はステータスを省くと 400 を返す。設計が約束している 500 は、明示して渡すと design.md と tasks.md（3.1 / 3.2）に書いた。
- **中止判定の理由**: Design Decisions に「CLI では中止し、画面では中止しない理由」を追加した。
- **再アップグレード準備との順序**: 確認ダイアログの警告（3.3）に、「ダウングレードから戻した直後は、再アップグレード準備スクリプトを先に実行すること」を加えた。
- **activity の emit の順序**: `apps/app/.claude/rules/activity-recording.md` の Rule 1（emit は `res.apiv3()` の前に行う）を、design.md と tasks.md の 3.2 に明記した。
- **activity の drift テスト**: `activity-recording.md` の Rule 1 は、activity を emit する route に drift テストを求めている。route の integ テストは `add-activity` をモックしているので、emit の順序の不具合を検出できない。そこで `page/create-page.integ.ts` に倣った drift テストを、design.md の Testing Strategy と tasks.md の 3.2 に追加した。
- **amend spec かどうか**: amend spec ではないと判断した（`.claude/rules/spec-lifecycle.md`）。upgrade spec の cleanup スクリプトの要件（Req 3.3 / 3.4）と挙動は変えず、2 つ目の入口を追加するだけだからである。design.md の Out of Boundary に明記した。
- **既存スクリプトのコメント**: 中止の理由として書かれている「ダウングレード後に認証できなくなる」は、実際の効果と合っていない。そのため、tasks.md の 2.2 でこのコメントを Decision を指す一文に置き換える。

## Design Review 6 回目の反映（独立レビュー, 2026-10-23）
- **route テストの土台**: 前例の `file-upload-setting.integ.ts` は、`apiv3Err` の既定ステータスを 500 にした自前の実装を使っている。本物の既定値は 400 なので、これをまねると、handler が 500 を渡し忘れてもテストが通ってしまう。本物の `response.js` を組み込み、500 の指定を消すと落ちることを mutation で確かめる、と design.md と tasks.md に書いた。
- **失敗後の再取得**: Error Handling 節（失敗時も `mutate()` する）と、client 節・テスト・タスク 4.2（エラートーストだけ）が食い違っていた。途中まで削除されている可能性があるので、失敗時も再取得する方に揃えた。
- **共有 DB でのテスト**: route の handler はコレクション全体を対象にし、integ テストは同じ worker で DB を共有する。件数はマーカー付きのユーザーの変化で検証し、サービスは `vi.importActual` で部分モックにする。
- **その他**: `ConfirmModal` は自分では閉じないので、セクション側で閉じる。logger は `vi.mock` で差し替えて検証する。302 で HTML が返った場合は、hook で取得エラーとして扱う。Testing Strategy で drift テストの下に入っていた 302 と 500 の項目を、routes の項目に移した。

## Design Review 7 回目の反映（独立レビュー, 2026-10-23）
判定は GO で、重大な問題はなかった。前回追加したテストの土台の指示（本物の `response.js`、サービスの部分モック、logger のモック、マーカーでの差分検証、drift テスト）は、どれもこのコードベースで実現できることを確認した。細かい指摘を 4 件反映した。
- タスク 4.2 の完了条件に、「レスポンスに `counts` がない場合のエラー表示」と「確定時にモーダルが閉じること」を加えた
- logger のモックは `adminRequired` の warn にも効くので、回数ではなく `info` の呼び出しの内容で検証する
- テスト用の DB は worker ごとに分かれている（`growi_test_${VITEST_WORKER_ID}`）。「同じ worker で DB を共有する」という記述を正確にした
- 500 のテスト項目を、GET（1.5）と DELETE（2.7）に分けた

## 催促が必要なユーザーの一覧と、セクションの非表示（2026-10-26）
- **背景**: ユーザーから、移行を催促するには誰が未移行なのかがわからないといけない、という指摘を受けた。ただし LDAP などでログインするユーザーは、ログインしても移行しないので催促しても意味がない。そこで、催促が必要なユーザーだけを一覧に出すことにした。
- **一覧の対象**: 旧形式のみを持ち、`externalaccounts` に連携がないユーザー。ステータスは問わない（ユーザーが選択）。#12076 は外部アカウントの有無を目印として表示するだけで、一覧からは外していなかった。この spec では外す。外部アカウントを持っていてもローカルでログインする人はいるが、催促の相手からは外れる、と割り切った。
- **一覧の項目**: ユーザー名、メール、最終ログイン（ユーザーが選択）。並び順は #12076 に倣って最終ログインの新しい順にした。
- **件数の表示**: 変えない（ユーザーが選択）。件数表の「旧形式のみ」は外部アカウントの有無を問わないので、一覧の総数とは一致しないことがある。
- **セクションの非表示**: 両形式と旧形式のみがどちらも 0 人なら、セクションを表示しない（ユーザーが選択）。取得中は表示せず、取得に失敗したら隠さずにエラーを出す。
- **R4.4 の変更**: 「表示するのはユーザー数だけ」を、一覧の 3 項目も表示してよいように改めた。メールアドレスを返すのは、管理者だけが見られる既存のユーザー管理画面と同じ範囲である。
