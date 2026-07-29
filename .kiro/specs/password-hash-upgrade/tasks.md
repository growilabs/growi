# Implementation Plan

- [ ] 1. Foundation: PasswordHashService（scrypt）の構築
- [x] 1.1 scrypt が新規依存なしで利用できることを確認する
  - scrypt は `node:crypto` 組み込みのため **package.json への依存追加は不要**（`bcryptjs` / `@types/bcryptjs` も追加しない）
  - `import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'` が TypeScript で型エラーなく解決されることを確認する
  - 非同期 `scrypt` を Promise 化して使う方針を確認する（`util.promisify(scrypt)` など）
  - _Requirements: 1.1_

- [x] 1.2 PasswordHashService を実装する
  - `hash(plaintext)` を実装: `randomBytes(16)` でソルト生成 → `scrypt(plaintext, salt, 64, {N, r, p, maxmem})` → `scrypt$N$r$p$<salt base64>$<hash base64>` に符号化して返す（keylen=64）。PASSWORD_SEED は不使用
  - scrypt パラメータは既定 **N=131072 (2^17), r=8, p=1（OWASP 最小推奨）**。環境変数で調整可能とし、**下限（N=2^17）未満はクランプして起動時 WARNING を出力**する
  - `maxmem` を明示的に **≥192MB** に設定する（N=2^17 は約128MB を消費し、Node 既定 `maxmem=32MB` のままだと `scrypt` が throw するため必須）。パラメータ上限もクランプする（極端な N によるメモリ枯渇・DoS 防止）
  - 消費メモリ（約128MB/回、スレッドプール4 でピーク〜512MB）をコンテナのメモリ予算に織り込む旨を確認する
  - `verify(plaintext, scryptHash, legacyHash, passwordSeed)` を実装:
    - `scryptHash` あり → `scrypt$…` を分解して N/r/p/salt を取得し `scrypt` で再計算 → `timingSafeEqual` で比較（`needsRehash: false`）
    - （任意拡張）保存パラメータが現行既定より弱ければ `needsRehash: true` を返す（パラメータ更新時の自動再ハッシュ。Req 1.1 維持のための任意拡張・必須ではない）
    - `scryptHash` なし・`legacyHash` あり → `SHA-256(SEED + plaintext)` で検証（`needsRehash: true`）
    - 両フィールドなし（パスワード未設定 = 正常系）→ `isValid: false` を返す。**WARNING ログは出力しない**（外部認証専用・未有効化ユーザーの正常状態。Req 2.5）
    - フィールドは存在するが内容が既知フォーマット（`scrypt$…` / SHA-256 hex）に一致しない（異常系）→ `isValid: false` を返し WARNING ログを出力（ユーザー識別子含む。Req 2.4）
  - `VerifyResult` インターフェース（`isValid: boolean; needsRehash: boolean`）をエクスポートする
  - `hash()` 呼び出しで `scrypt$` プレフィックスの自己記述ハッシュが返ってくることが確認できる
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [x] 1.3 PasswordHashService のユニットテストを作成する
  - `hash()`: 同一平文で 2 回呼び出すと異なるハッシュが返ること（per-user salt）を確認する
  - `hash()`: 返り値が `scrypt$` で始まる（SHA-256 の 64 文字 hex でない）ことを確認する
  - `verify()`: scrypt パス → `{ isValid: true, needsRehash: false }` を確認する
  - `verify()`: SHA-256 legacy パス（`legacyHash` あり）→ `{ isValid: true, needsRehash: true }` を確認する
  - `verify()`: 無効な認証情報 → `{ isValid: false }` を確認する
  - `verify()`: 両フィールドなし（パスワード未設定）→ `{ isValid: false }` かつ **WARNING ログが出力されない**ことを確認する（Req 2.5）
  - `verify()`: フィールド内容が既知フォーマットに一致しない異常系 → `{ isValid: false }` かつ WARNING ログ出力を確認する（Req 2.4）
  - `verify()`（任意拡張）: 現行既定より弱いパラメータ（例: 小さい N）で作った scrypt ハッシュ → `{ isValid: true, needsRehash: true }` を確認する（パラメータ更新時の自動再ハッシュ）
  - `pnpm vitest run password-hash.spec` が全 PASS することが確認できる
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [ ] 2. User モデルとパスワード関連呼び出し元の刷新
- [x] 2.1 User schema に passwordHash フィールドを追加し isPasswordSet を更新する
  - Mongoose スキーマ定義に `passwordHash: { type: String }` フィールドを追加する
  - `isPasswordSet()` を `!!(this.passwordHash || this.password)` に更新して両フィールドを確認するようにする
  - MongoDB フィールド追加は既存ドキュメントに影響しない（自動マイグレーション不要）
  - 既存の `password` フィールドが変更されておらず、`passwordHash` が新たに追加されていることが確認できる
  - _Requirements: 2.2, 2.3_
  - _Boundary: User Model_

- [x] 2.2 isPasswordValid、setPassword、updatePassword を async 化し PasswordHashService に委譲する
  - `isPasswordValid(password)` を async 化: `PasswordHashService.verify(password, this.passwordHash, this.password, SEED)` を呼び出し `VerifyResult` を返す
  - `setPassword(password)` を async 化: `this.passwordHash = await PasswordHashService.hash(password)` のみ設定し、`password`（SHA-256）フィールドは変更しない（ダウングレード安全のため保持）
  - `setPassword` を呼ぶ **実在 5 メソッドすべて**の呼び出しを `await` 付きに更新する（未 await のまま `save()` すると passwordHash 未設定で保存されログイン不能になるため）:
    - `updatePassword`（v8: setPassword 呼び出し line ~230）
    - `activateInvitedUser`（v8: line ~299）— 招待ユーザー有効化。**欠落すると当該ユーザーがログイン不能**
    - `resetPasswordByRandomString`（v8: line ~598）
    - `createUserByEmail`（v8: line ~614）— メール招待ユーザー作成。**欠落すると当該ユーザーがログイン不能**
    - `createUserByEmailAndPasswordAndStatus`（v8: line ~706）
  - `setPassword()` 後に `passwordHash` が設定されており、`password` フィールドが変更されておらず、5 つの呼び出し元すべてが TypeScript コンパイルエラーなく動作することが確認できる
  - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - _Boundary: User Model_

- [x] 2.3 findUserByEmailAndPassword（デッドコード）を削除する
  - `findUserByEmailAndPassword(email, password)` はリポジトリ全体で呼び出し元が存在しないデッドコードのため削除する（`grep -rn findUserByEmailAndPassword apps/app/src packages` で呼び出し元ゼロを確認済み）
  - DB を password hash でクエリするこのメソッドは scrypt 移行後に動作不能だが、呼び出し元がないため fetch-then-compare リファクタではなく削除が適切（実装工数の無駄を避ける）
  - 万一、削除前の再 grep で呼び出し元が発見された場合に限り、`{ email }` 検索 + `await user.isPasswordValid()` の fetch-then-compare にリファクタする
  - メソッド定義が削除され、TypeScript コンパイル・既存テストが通ることが確認できる
  - _Requirements: 2.1, 2.3_
  - _Boundary: User Model_

- [x] 2.4 passwordHash の API レスポンス漏洩を防止する（@growi/core）
  - `packages/core/src/models/serializers/user-serializer.ts` の `omitInsecureAttributes()` の omit リストに `passwordHash` を追加する（現状は `password`/`apiToken`/`email` のみ除外しており新フィールドが漏洩する）
  - `packages/core/src/interfaces/user.ts` の `IUser` に `passwordHash?: string` を追加する
  - `@growi/core` は published package のため `npx changeset` で patch bump を作成する
  - シリアライズ後のユーザーオブジェクトに `passwordHash` が含まれないこと、および `IUser` 型で `passwordHash` が参照できることが確認できる
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [x] 2.5 isPasswordValid の外部呼び出し元（personal-setting）を async 化する
  - `apps/app/src/server/routes/apiv3/personal-setting/index.js`（v8: line ~441）の
    `if (user.isPasswordSet() && !user.isPasswordValid(oldPassword)) {` を
    `if (user.isPasswordSet() && !(await user.isPasswordValid(oldPassword)).isValid) {` に置換する
  - **CRITICAL**: `isPasswordValid` が `Promise<VerifyResult>` を返すため、`!Promise` は常に `false` となり旧パスワード検証がスキップされる（= 現在のパスワードを知らなくても新パスワードに変更できる認証バイパス）。必ず `await` + `.isValid` 参照にする
  - 当該ハンドラが async であること、および旧パスワードが誤っている場合に変更が拒否されることが確認できる
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.2_
  - _Boundary: User Model_

- [x] 2.6 password == null 代用のパスワード設定判定を isPasswordSet() に置換する
  - passwordHash-only ユーザー（`password` unset、`passwordHash` set）を誤判定するため、以下 3 箇所を `isPasswordSet()` ベースに置換する:
    - `apps/app/src/server/routes/login.js`（line ~145）: `userData.password == null` → `!userData.isPasswordSet()`（全 passwordHash-only ユーザーが毎回 `/me#password_settings` へ誤リダイレクトされるのを防ぐ）
    - `apps/app/src/server/routes/apiv3/personal-setting/index.js`（v8: line ~715）: `user.password == null && count <= 1` → `!user.isPasswordSet() && count <= 1`（LDAP アカウント切り離しの誤ブロックを防ぐ）
    - `apps/app/src/server/routes/apiv3/user-activation.ts`（line ~278）: `userData.password != null` → `userData.isPasswordSet()`（リダイレクト先の誤判定を防ぐ）
  - 各判定が `isPasswordSet()` に置換され、passwordHash-only ユーザーで誤リダイレクト・誤ブロックが発生しないことが確認できる
  - _Requirements: 2.2, 2.3_
  - _Depends: 2.1_
  - _Boundary: User Model_

- [x] 2.7 statusDelete で passwordHash を消去する
  - `statusDelete()`（`apps/app/src/server/models/user/index.js` v8: line ~371、`this.password = ''` は line ~379）に `this.passwordHash = undefined;` を追加し、削除ユーザーが有効な scrypt 認証情報ハッシュを保持しないようにする（既存の `this.password = ''` と同じ意図）
  - `''` ではなく `undefined`（unset）にする理由: verify() が `noPassword`（正常系）として扱い、フォーマット不一致の Req 2.4 WARNING を誤発火させないため
  - 既存の統合テスト `user.integ.ts`（削除ユーザーの属性検証、`password` の空文字を確認している箇所）に `passwordHash` が unset されている検証を追加する
  - 削除後のユーザードキュメントに有効な `passwordHash` が残らないことが確認できる
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [x] 2.8 パスワード変更フローの認証バイパス回帰テストを作成する
  - 旧パスワードが正しい場合のみパスワード変更が成功し、誤っている/未指定の場合は拒否されることを確認する（task 2.5 の回帰防止）
  - passwordHash-only ユーザーのログイン後に `/me#password_settings` へ誤リダイレクトされないことを確認する（task 2.6 の回帰防止）
  - `pnpm vitest run` で当該テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.5, 2.6_
  - _Boundary: User Model_

- [ ] 3. (P) Passport LocalStrategy の async 化と lazy migration 統合
- [x] 3.1 Passport LocalStrategy を async 化し lazy migration をトリガーする
  - `findUserByUsernameOrEmail` をコールバックスタイルから Promise ベース（async/await）に変更またはラップする
  - LocalStrategy コールバックを async 関数に変更し、try/catch で全エラーを `done(err)` に渡す
  - `VerifyResult.needsRehash === true` の場合（legacy 認証成功時）: `await user.setPassword(password)` + `await user.save()` を実行してから `done(null, user)` を返す
  - lazy migration の `save()` 失敗時はエラーログを記録するが、ログイン自体は成功させる（次回ログインでリトライ可能）
  - `isValid === false` の場合は `done(null, false)` を返す
  - SHA-256 ハッシュを持つユーザーで初回ログインすると DB の `passwordHash` フィールドが設定されることが確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2, 2.3_
  - _Boundary: Passport LocalStrategy_

- [x] 3.2 ログインフローの統合テストを作成する
  - legacy SHA-256 ユーザーのログイン成功 + lazy migration 後に `passwordHash` が DB に書き込まれることを確認する
  - scrypt ユーザーのログイン成功 + rehash が発生しないことを確認する
  - 無効な認証情報でのログイン失敗を確認する
  - パスワード未設定（両フィールドなし）ユーザーのローカルログイン失敗を確認し、**WARNING ログが出力されない**ことを確認する（Req 2.5）
  - `pnpm vitest run` で統合テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: Passport LocalStrategy_

- [ ] 4. (P) マイグレーションスクリプトの実装
- [x] 4.1 (P) Status migration script を実装する
  - `20260724000001-password-hash-status` マイグレーションを作成する（**v8: 既存最新 `20260721103639` より後のタイムスタンプにする**。旧 `20260514000001` は過去日付になり migrate-mongo が out-of-order 扱いするため不可）
  - `up()` 内で以下 4 区分のユーザー数を集計する（DB 書き込みなし）:
    - upgradedOnly（`passwordHash` あり、`password` なし）: 完全移行済み
    - both（両フィールドあり）: 移行中
    - legacyOnly（`passwordHash` なし、`password` あり）: 未移行
    - noPassword（両フィールドなし）: パスワード未設定
  - 集計結果を `logger.info` で標準出力に出力する
  - マイグレーション実行後に DB へ一切書き込まれておらず、4 区分のカウントが logger.info に出力されることが確認できる
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [x] 4.2 (P) Cleanup standalone script を実装する
  - `apps/app/src/server/scripts/password-hash-cleanup.ts` を作成する（migrate-mongo 対象外の standalone スクリプト）
  - スクリプト開始時に `legacyOnly` ユーザー数（`passwordHash` なし・`password` あり）を取得する
  - `legacyOnly > 0` の場合: エラーメッセージ（件数含む）を出力して process.exit(1) する（Req 3.4）
  - `legacyOnly === 0` の場合: `updateMany({ passwordHash: { $exists: true }, password: { $exists: true } }, { $unset: { password: '' } })` を実行する（Req 3.3）
  - `legacyOnly > 0` 時に abort されて DB に変更が加えられておらず、エラーメッセージに件数が含まれていることが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [x] 4.3 (P) Downgrade prep standalone script を実装する
  - `apps/app/src/server/scripts/password-hash-downgrade-prep.ts` を作成する（Crowi bootstrap が必要な standalone スクリプト）
  - スクリプト内でダウングレード後にログイン不可になるユーザー数（`passwordHash` あり・`password` なし）を集計してログ出力する（Req 4.1）
  - 環境変数 `SEND_RESET_EMAILS` が `'true'` の場合:
    - 対象ユーザーごとに `PasswordResetOrder` を作成して既存メールサービスでリセットメールを送信する（Req 4.2）
    - **メール送信成功を確認してから**、成功したユーザーのみ `passwordHash` を `$unset`（フィールドごと削除）してログイン不可化する（Req 4.3）
    - **CRITICAL**: `null` 代入ではなく `$unset` を使う。`$exists` ベースの分類（status/cleanup）では `null` 値もフィールド「存在」扱いとなり、当該ユーザーが `upgradedOnly` に残留してカウント不正確化・再実行時の二重メール送信を招くため
    - 送信失敗ユーザーは unset しない（次回再実行でリトライ可能）
    - 成功・失敗件数を INFO/WARNING でそれぞれログ出力する
  - `SEND_RESET_EMAILS` 未設定時に集計カウントのみ出力されて DB が変更されないことが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_

- [ ] 5. マイグレーションスクリプトの統合テスト
- [x] 5.1 (P) Status migration script の統合テストを作成する
  - テスト DB に 4 区分（upgradedOnly、both、legacyOnly、noPassword）のユーザーを用意する
  - `up()` 実行後に各カウントが期待値と一致することを確認する
  - `up()` 実行後に DB のユーザードキュメントが一切変更されていないことを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [x] 5.2 (P) Cleanup standalone script の統合テストを作成する
  - `legacyOnly` ユーザーが存在する状態でスクリプト実行が中断し、ユーザードキュメントが変更されないことを確認する
  - 全ユーザーが `passwordHash` 移行済みの状態で `password` フィールドが `$unset` されることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [x] 5.3 (P) Downgrade prep standalone script の統合テストを作成する
  - `SEND_RESET_EMAILS` 未設定時に DB が変更されずカウントのみ出力されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `PasswordResetOrder` が作成されることを確認する
  - `SEND_RESET_EMAILS=true` 時にメール送信成功ユーザーのみ `passwordHash` が `$unset`（フィールド不在）になり、送信失敗ユーザーの `passwordHash` が変更されないことを確認する
  - `$unset` 後のユーザーが status migration で `noPassword` に分類され `upgradedOnly` に残留しないことを確認する（二重メール送信の回帰防止）
  - 統合テストが PASS することが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_

- [ ] 6. CodeQL アラート（CWE-916 / #541）解消の確認
- [ ] 6.1 実装後に CodeQL を再スキャンしアラート状態を確認する
  _Manual/CI: CodeQL は GitHub Actions 上で実行するため devcontainer では確認不可。ブランチ push 後に CI の CodeQL 再スキャンで #541 の状態を確認すること。_
  _コードレベルの裏付け（本ランで確認済み）: パスワード**保存**経路は scrypt のみ（`password-hash.ts` の `hash()` は scrypt、`setPassword` は `hash()` に委譲）。SHA-256 は legacy **検証**パス（`password-hash.ts:248` `verifyLegacy` 内の `SHA256(SEED+plaintext)`）にのみ残存し、Req 2.1 後方互換のため除去不可。`user/index.js:163` の sha256 は `generateApiToken`（スコープ外）。→ CWE-916 の保存経路脆弱性は解消済み。legacy 検証行が CodeQL に再フラグされたら「移行期間限定・新規保存未使用・Cleanup 後除去」の dismissal を付与、完全緑化は Cleanup フェーズ後。_
  - 保存経路が scrypt 化されたことで `js/insufficient-password-hash`（アラート #541）が解消されるか、CodeQL の再スキャンで確認する
  - legacy 検証パス（`verify()` 内の `SHA256(SEED + plaintext)`）が再フラグされる場合は、当該箇所に**正当理由付きの dismissal** を付与する（例: 「移行期間限定の legacy ハッシュ検証専用。新規保存には未使用。Cleanup 後に除去予定」）
  - SHA-256 計算は後方互換（Req 2.1）のため除去不可であり、完全な緑化は Cleanup フェーズで legacy 検証コードを削除した時点で達成される旨を PR / Issue に記録する
  - CodeQL 上でアラートが解消（または正当な dismissal 付与）されていることが確認できる
  - _Requirements: 1.1, 1.3_
  - _Boundary: PasswordHashService_

## v8（8.0.x 系）実装メモ

本 spec は 8.0.x 系（`feat/170496-password-hash-algorithm-v8` → `feat/170496-183017-password-hash-upgrade-v8`）で実装する。v7 と異なり以下の前提に従うこと（`apps/app/.claude/rules/` 準拠）:

- **import は拡張子なし**（相対 / `~/` 指定子に `.js`・`.jsx` を書かない。`.js` は build 出力時のみ付与）。`password-hash.ts` や各修正ファイルの import はこの規約に従う。
- **User モデルは v8 でも Mongoose の `.js`**（`src/server/models/user/index.js`）。Prisma 移行されていないため設計どおり Mongoose メソッドを編集する。
- **standalone スクリプト（4.2 / 4.3）**: `src/server/scripts/` は v8 に未存在なので新規作成。実行は `pnpm run tsrun <path>`（`ts-node` ではなく、`bin/runtime/dev-esm-resolver.mjs` + `bin/runtime/env-preload.mjs` を `--import` する ESM ランナー）。downgrade-prep の Crowi bootstrap も ESM 下で動作させる。
- **migrate-mongo（4.1）**: v8 の config は `config/migrate-mongo-config.cjs`（トリガー `pnpm run migrate:migrate-mongo` 自体は不変）。migration ファイルは `.js`、co-located 統合テストは `.integ.ts`（既存例 `20260721103639-backfill-users-timestamps.integ.ts` に倣う）。タイムスタンプは既存最新（`20260721103639`）より後にする。
- **server-boot-imports**: `PasswordHashService` は `node:crypto` のみ（追加コストなし）なので top-level import で可。重量級 SDK の遅延ロード規約には抵触しない。
- **activity-recording**: 本 spec は既存ルート（login / personal-setting / user-activation）内の条件式を編集するのみで、ルート追加・middleware 順序変更はないため activity 記録の変更は不要。
- タスク内の行番号は v8 実コードに合わせた近似値（`~`）。実装時は該当パターンを grep で確認してから編集する。

## Implementation Notes（実装ログ）

- **1.1 (v8)**: `bcryptjs`/`@types/bcryptjs` は v8 package.json に不在（scrypt は `node:crypto` 組み込み、新規依存不要）。`util.promisify(scrypt)` は options 付きオーバーロードを落とすため（TS2554）、`new Promise` の手動ラッパーで `scrypt(pw, salt, keylen, {N,r,p,maxmem}, cb)` を呼ぶこと。v8 tsconfig（`tsgo --noEmit`）で型チェック通過を確認済み。型チェックは v8 では `tsgo`（`tsc` ではない）。
- **1.2 (v8)**: `createPasswordHashService(params)` ファクトリ + env バインド既定シングルトン `passwordHashService`（env 名 `PASSWORD_SCRYPT_N/R/P`）をエクスポート。既定 N=2^17/r=8/p=1、`maxmem=Math.max(192MB, 128*N*r*2)`。ファクトリは floor クランプなし（テストで小 N 注入可、上限クランプのみ）／env パスは floor+ceiling クランプ + 起動時 WARNING。`verify()` は verifyScrypt/verifyLegacy に委譲し throw しない。biome の `useAwait` 警告回避のため verifyLegacy は同期メソッド。task 2.2 で User model からは既定シングルトン `passwordHashService` を import。**import は拡張子なし**（v8 規約）。
- **PROCESS (v8)**: サブエージェントは重い `tsgo --noEmit`（~400s）をスキップしがちで、**biome/vitest は型エラーを検出しない**ため型エラーが commit をすり抜けた（tasks 1.2/2.2）。実際に発生: ①pino の `logger.warn` は**オブジェクトを第1引数**に（`logger.warn({ error }, 'msg')`。文字列第1・オブジェクト第2 は TS2769）②`mockDeep<Crowi>()` の `crowi.env` は proxy 型なので `crowi.env = {…}` 代入は不可、`crowi.env.PASSWORD_SEED = …` とプロパティ設定する。**各グループ完了時に `pnpm exec tsgo --noEmit` を1回流すこと**（`lint:typecheck` = `tsgo --noEmit`）。
- **3.1 (v8)**: LocalStrategy の verify ロジックを exported 純関数 `verifyLocalCredentials(User, username, password, done)` に抽出し `setupLocalStrategy` を薄いアダプタ化。`findUserByUsernameOrEmail`（callback）は passport.ts 内で Promise ラップ（User model は不変＝境界維持）。`needsRehash` 時に `setPassword`+`save`、その save 失敗は log のみでログイン成功継続。全エラーは try/catch→`done(err)`。
- **2.4 (v8)**: `omitInsecureAttributes()` は destructure-drop（`const { password, passwordHash, apiToken, email, ...rest }`）で runtime 除外。`IUserSerializedSecurely` の Omit union にも passwordHash 追加。`IUser` に `passwordHash?: string`。changeset は `.changeset/password-hash-omit.md`（@growi/core patch）。**@growi/core は consumer が `dist` を import するため、app レベルの integ テスト（2.8/3.2）前に `turbo run build --filter @growi/core` が必要**。注意: サブエージェントのツール実行で `.claude/settings.json` に grep/echo 許可が混入する（boundary 外）→ コミット前に `git checkout -- .claude/settings.json` で戻すこと。
- **2.2 (v8)**: User model は `import { passwordHashService } from '~/server/service/password-hash';`（拡張子なし）で既定シングルトンを利用。`isPasswordValid` は `crowi.env.PASSWORD_SEED`（= 既存 generatePassword と同じアクセサ）を verify に渡し `Promise<VerifyResult>` を返す（boolean ではない → 外部呼び出し元は 2.5/3.1 で await 化）。`setPassword` は `this.passwordHash` のみ設定し `this.password` は不変。5 呼び出し元（updatePassword/activateInvitedUser/resetPasswordByRandomString/createUserByEmail/createUserByEmailAndPasswordAndStatus）すべて await 済み。`generatePassword` は 2.3 まで残す（findUserByEmailAndPassword が最後の呼び出し元）。この変更で updatePassword/activateInvitedUser の pre-existing useAwait 警告が2件解消。
- **1.3 (v8)**: 1.3 の必須マトリクス全ケース + 任意拡張（弱パラメータ→needsRehash:true）を 1.2 で作成済みの `password-hash.spec.ts`（全12件）が網羅済み。追加テストは不要と確認し 1.3 完了。noPassword は空文字も不在扱い、malformed は scrypt envelope 不正 / legacy 非 hex / corrupt envelope の3ケースを検証。
