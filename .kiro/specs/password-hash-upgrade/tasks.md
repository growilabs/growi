# Implementation Plan

- [ ] 1. Foundation: bcryptjs 依存関係と PasswordHashService の構築
- [ ] 1.1 apps/app/package.json に bcryptjs を dependencies として追加する
  - `bcryptjs` ^3.x を `apps/app/package.json` の `dependencies` に追加する（Turbopack SSR externalization rule: サーバーサイドの static import はすべて `dependencies` へ）
  - `@types/bcryptjs` は追加しない（bcryptjs v3 は型定義を本体にバンドル済み。`@types/bcryptjs` は v2 API 向けのため型不整合を招く）
  - `pnpm install` を実行してロックファイルを更新する
  - `import bcrypt from 'bcryptjs'` が TypeScript で型エラーなく解決されることが確認できる
  - _Requirements: 1.1_

- [ ] 1.2 PasswordHashService を実装する
  - `hash(plaintext)` を実装: `bcrypt.hash(plaintext, BCRYPT_COST)` — 常に bcrypt のみ使用、PASSWORD_SEED は不使用。`BCRYPT_COST` は環境変数でカスタム可能（デフォルト 12）
  - `BCRYPT_COST` が 12 未満の場合は 12 にクランプし、起動時に WARNING ログを出力する
  - `BCRYPT_COST` が 15 を超える場合は 15 にクランプし、起動時に WARNING ログを出力する（DoS リスク軽減）
  - `verify(plaintext, bcryptHash, legacyHash, passwordSeed)` を実装:
    - `bcryptHash` あり → `bcrypt.compare()` で検証（`needsRehash: false`）
    - `bcryptHash` なし・`legacyHash` あり → `SHA-256(SEED + plaintext)` で検証（`needsRehash: true`）
    - 両フィールドなし（パスワード未設定 = 正常系）→ `isValid: false` を返す。**WARNING ログは出力しない**（外部認証専用・未有効化ユーザーの正常状態。Req 2.5）
    - フィールドは存在するが内容が既知フォーマット（bcrypt `$2b$…` / SHA-256 hex）に一致しない（異常系）→ `isValid: false` を返し WARNING ログを出力（ユーザー識別子含む。Req 2.4）
  - `VerifyResult` インターフェース（`isValid: boolean; needsRehash: boolean`）をエクスポートする
  - `hash()` 呼び出しで `$2b$` プレフィックスの bcrypt ハッシュが返ってくることが確認できる
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [ ] 1.3 PasswordHashService のユニットテストを作成する
  - `hash()`: 同一平文で 2 回呼び出すと異なるハッシュが返ること（per-user salt）を確認する
  - `hash()`: 返り値が `$2b$` で始まる（SHA-256 の 64 文字 hex でない）ことを確認する
  - `verify()`: bcrypt パス → `{ isValid: true, needsRehash: false }` を確認する
  - `verify()`: SHA-256 legacy パス（`legacyHash` あり）→ `{ isValid: true, needsRehash: true }` を確認する
  - `verify()`: 無効な認証情報 → `{ isValid: false }` を確認する
  - `verify()`: 両フィールドなし（パスワード未設定）→ `{ isValid: false }` かつ **WARNING ログが出力されない**ことを確認する（Req 2.5）
  - `verify()`: フィールド内容が既知フォーマットに一致しない異常系 → `{ isValid: false }` かつ WARNING ログ出力を確認する（Req 2.4）
  - `pnpm vitest run password-hash.spec` が全 PASS することが確認できる
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [ ] 2. User モデルとパスワード関連呼び出し元の刷新
- [ ] 2.1 User schema に bcryptPassword フィールドを追加し isPasswordSet を更新する
  - Mongoose スキーマ定義に `bcryptPassword: { type: String }` フィールドを追加する
  - `isPasswordSet()` を `!!(this.bcryptPassword || this.password)` に更新して両フィールドを確認するようにする
  - MongoDB フィールド追加は既存ドキュメントに影響しない（自動マイグレーション不要）
  - 既存の `password` フィールドが変更されておらず、`bcryptPassword` が新たに追加されていることが確認できる
  - _Requirements: 2.2, 2.3_
  - _Boundary: User Model_

- [ ] 2.2 isPasswordValid、setPassword、updatePassword を async 化し PasswordHashService に委譲する
  - `isPasswordValid(password)` を async 化: `PasswordHashService.verify(password, this.bcryptPassword, this.password, SEED)` を呼び出し `VerifyResult` を返す
  - `setPassword(password)` を async 化: `this.bcryptPassword = await PasswordHashService.hash(password)` のみ設定し、`password`（SHA-256）フィールドは変更しない（ダウングレード安全のため保持）
  - `setPassword` を呼ぶ **実在 5 メソッドすべて**の呼び出しを `await` 付きに更新する（未 await のまま `save()` すると bcryptPassword 未設定で保存されログイン不能になるため）:
    - `updatePassword`（line ~208）
    - `activateInvitedUser`（line ~277）— 招待ユーザー有効化。**欠落すると当該ユーザーがログイン不能**
    - `resetPasswordByRandomString`（line ~575）
    - `createUserByEmail`（line ~591）— メール招待ユーザー作成。**欠落すると当該ユーザーがログイン不能**
    - `createUserByEmailAndPasswordAndStatus`（line ~683）
  - `setPassword()` 後に `bcryptPassword` が設定されており、`password` フィールドが変更されておらず、5 つの呼び出し元すべてが TypeScript コンパイルエラーなく動作することが確認できる
  - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - _Boundary: User Model_

- [ ] 2.3 findUserByEmailAndPassword（デッドコード）を削除する
  - `findUserByEmailAndPassword(email, password)` はリポジトリ全体で呼び出し元が存在しないデッドコードのため削除する（`grep -rn findUserByEmailAndPassword apps/app/src packages` で呼び出し元ゼロを確認済み）
  - DB を password hash でクエリするこのメソッドは bcrypt 移行後に動作不能だが、呼び出し元がないため fetch-then-compare リファクタではなく削除が適切（実装工数の無駄を避ける）
  - 万一、削除前の再 grep で呼び出し元が発見された場合に限り、`{ email }` 検索 + `await user.isPasswordValid()` の fetch-then-compare にリファクタする
  - メソッド定義が削除され、TypeScript コンパイル・既存テストが通ることが確認できる
  - _Requirements: 2.1, 2.3_
  - _Boundary: User Model_

- [ ] 2.4 bcryptPassword の API レスポンス漏洩を防止する（@growi/core）
  - `packages/core/src/models/serializers/user-serializer.ts` の `omitInsecureAttributes()` の omit リストに `bcryptPassword` を追加する（現状は `password`/`apiToken`/`email` のみ除外しており新フィールドが漏洩する）
  - `packages/core/src/interfaces/user.ts` の `IUser` に `bcryptPassword?: string` を追加する
  - `@growi/core` は published package のため `npx changeset` で patch bump を作成する
  - シリアライズ後のユーザーオブジェクトに `bcryptPassword` が含まれないこと、および `IUser` 型で `bcryptPassword` が参照できることが確認できる
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [ ] 2.5 isPasswordValid の外部呼び出し元（personal-setting）を async 化する
  - `apps/app/src/server/routes/apiv3/personal-setting/index.js`（line ~432）の
    `if (user.isPasswordSet() && !user.isPasswordValid(oldPassword)) {` を
    `if (user.isPasswordSet() && !(await user.isPasswordValid(oldPassword)).isValid) {` に置換する
  - **CRITICAL**: `isPasswordValid` が `Promise<VerifyResult>` を返すため、`!Promise` は常に `false` となり旧パスワード検証がスキップされる（= 現在のパスワードを知らなくても新パスワードに変更できる認証バイパス）。必ず `await` + `.isValid` 参照にする
  - 当該ハンドラが async であること、および旧パスワードが誤っている場合に変更が拒否されることが確認できる
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.2_
  - _Boundary: User Model_

- [ ] 2.6 password == null 代用のパスワード設定判定を isPasswordSet() に置換する
  - bcrypt-only ユーザー（`password` unset、`bcryptPassword` set）を誤判定するため、以下 3 箇所を `isPasswordSet()` ベースに置換する:
    - `apps/app/src/server/routes/login.js`（line ~145）: `userData.password == null` → `!userData.isPasswordSet()`（全 bcrypt-only ユーザーが毎回 `/me#password_settings` へ誤リダイレクトされるのを防ぐ）
    - `apps/app/src/server/routes/apiv3/personal-setting/index.js`（line ~702）: `user.password == null && count <= 1` → `!user.isPasswordSet() && count <= 1`（LDAP アカウント切り離しの誤ブロックを防ぐ）
    - `apps/app/src/server/routes/apiv3/user-activation.ts`（line ~278）: `userData.password != null` → `userData.isPasswordSet()`（リダイレクト先の誤判定を防ぐ）
  - 各判定が `isPasswordSet()` に置換され、bcrypt-only ユーザーで誤リダイレクト・誤ブロックが発生しないことが確認できる
  - _Requirements: 2.2, 2.3_
  - _Depends: 2.1_
  - _Boundary: User Model_

- [ ] 2.7 statusDelete で bcryptPassword を消去する
  - `statusDelete()`（`apps/app/src/server/models/user/index.js` line ~349）に `this.bcryptPassword = undefined;` を追加し、削除ユーザーが有効な bcrypt 認証情報ハッシュを保持しないようにする（既存の `this.password = ''` と同じ意図）
  - `''` ではなく `undefined`（unset）にする理由: verify() が `noPassword`（正常系）として扱い、フォーマット不一致の Req 2.4 WARNING を誤発火させないため
  - 既存の統合テスト `user.integ.ts`（削除ユーザーの属性検証、`password` の空文字を確認している箇所）に `bcryptPassword` が unset されている検証を追加する
  - 削除後のユーザードキュメントに有効な `bcryptPassword` が残らないことが確認できる
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [ ] 2.8 パスワード変更フローの認証バイパス回帰テストを作成する
  - 旧パスワードが正しい場合のみパスワード変更が成功し、誤っている/未指定の場合は拒否されることを確認する（task 2.5 の回帰防止）
  - bcrypt-only ユーザーのログイン後に `/me#password_settings` へ誤リダイレクトされないことを確認する（task 2.6 の回帰防止）
  - `pnpm vitest run` で当該テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.5, 2.6_
  - _Boundary: User Model_

- [ ] 3. (P) Passport LocalStrategy の async 化と lazy migration 統合
- [ ] 3.1 Passport LocalStrategy を async 化し lazy migration をトリガーする
  - `findUserByUsernameOrEmail` をコールバックスタイルから Promise ベース（async/await）に変更またはラップする
  - LocalStrategy コールバックを async 関数に変更し、try/catch で全エラーを `done(err)` に渡す
  - `VerifyResult.needsRehash === true` の場合（legacy 認証成功時）: `await user.setPassword(password)` + `await user.save()` を実行してから `done(null, user)` を返す
  - lazy migration の `save()` 失敗時はエラーログを記録するが、ログイン自体は成功させる（次回ログインでリトライ可能）
  - `isValid === false` の場合は `done(null, false)` を返す
  - SHA-256 ハッシュを持つユーザーで初回ログインすると DB の `bcryptPassword` フィールドが設定されることが確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2, 2.3_
  - _Boundary: Passport LocalStrategy_

- [ ] 3.2 ログインフローの統合テストを作成する
  - legacy SHA-256 ユーザーのログイン成功 + lazy migration 後に `bcryptPassword` が DB に書き込まれることを確認する
  - bcrypt ユーザーのログイン成功 + rehash が発生しないことを確認する
  - 無効な認証情報でのログイン失敗を確認する
  - パスワード未設定（両フィールドなし）ユーザーのローカルログイン失敗を確認し、**WARNING ログが出力されない**ことを確認する（Req 2.5）
  - `pnpm vitest run` で統合テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: Passport LocalStrategy_

- [ ] 4. (P) マイグレーションスクリプトの実装
- [ ] 4.1 (P) Status migration script を実装する
  - `20260514000001-password-hash-status` マイグレーションを作成する
  - `up()` 内で以下 4 区分のユーザー数を集計する（DB 書き込みなし）:
    - bcryptOnly（`bcryptPassword` あり、`password` なし）: 完全移行済み
    - both（両フィールドあり）: 移行中
    - legacyOnly（`bcryptPassword` なし、`password` あり）: 未移行
    - noPassword（両フィールドなし）: パスワード未設定
  - 集計結果を `logger.info` で標準出力に出力する
  - マイグレーション実行後に DB へ一切書き込まれておらず、4 区分のカウントが logger.info に出力されることが確認できる
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [ ] 4.2 (P) Cleanup standalone script を実装する
  - `apps/app/src/server/scripts/password-hash-cleanup.ts` を作成する（migrate-mongo 対象外の standalone スクリプト）
  - スクリプト開始時に `legacyOnly` ユーザー数（`bcryptPassword` なし・`password` あり）を取得する
  - `legacyOnly > 0` の場合: エラーメッセージ（件数含む）を出力して process.exit(1) する（Req 3.4）
  - `legacyOnly === 0` の場合: `updateMany({ bcryptPassword: { $exists: true }, password: { $exists: true } }, { $unset: { password: '' } })` を実行する（Req 3.3）
  - `legacyOnly > 0` 時に abort されて DB に変更が加えられておらず、エラーメッセージに件数が含まれていることが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [ ] 4.3 (P) Downgrade prep standalone script を実装する
  - `apps/app/src/server/scripts/password-hash-downgrade-prep.ts` を作成する（Crowi bootstrap が必要な standalone スクリプト）
  - スクリプト内でダウングレード後にログイン不可になるユーザー数（`bcryptPassword` あり・`password` なし）を集計してログ出力する（Req 4.1）
  - 環境変数 `SEND_RESET_EMAILS` が `'true'` の場合:
    - 対象ユーザーごとに `PasswordResetOrder` を作成して既存メールサービスでリセットメールを送信する（Req 4.2）
    - **メール送信成功を確認してから**、成功したユーザーのみ `bcryptPassword` を `$unset`（フィールドごと削除）してログイン不可化する（Req 4.3）
    - **CRITICAL**: `null` 代入ではなく `$unset` を使う。`$exists` ベースの分類（status/cleanup）では `null` 値もフィールド「存在」扱いとなり、当該ユーザーが `bcryptOnly` に残留してカウント不正確化・再実行時の二重メール送信を招くため
    - 送信失敗ユーザーは unset しない（次回再実行でリトライ可能）
    - 成功・失敗件数を INFO/WARNING でそれぞれログ出力する
  - `SEND_RESET_EMAILS` 未設定時に集計カウントのみ出力されて DB が変更されないことが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_

- [ ] 5. マイグレーションスクリプトの統合テスト
- [ ] 5.1 (P) Status migration script の統合テストを作成する
  - テスト DB に 4 区分（bcryptOnly、both、legacyOnly、noPassword）のユーザーを用意する
  - `up()` 実行後に各カウントが期待値と一致することを確認する
  - `up()` 実行後に DB のユーザードキュメントが一切変更されていないことを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [ ] 5.2 (P) Cleanup standalone script の統合テストを作成する
  - `legacyOnly` ユーザーが存在する状態でスクリプト実行が中断し、ユーザードキュメントが変更されないことを確認する
  - 全ユーザーが `bcryptPassword` 移行済みの状態で `password` フィールドが `$unset` されることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [ ] 5.3 (P) Downgrade prep standalone script の統合テストを作成する
  - `SEND_RESET_EMAILS` 未設定時に DB が変更されずカウントのみ出力されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `PasswordResetOrder` が作成されることを確認する
  - `SEND_RESET_EMAILS=true` 時にメール送信成功ユーザーのみ `bcryptPassword` が `$unset`（フィールド不在）になり、送信失敗ユーザーの `bcryptPassword` が変更されないことを確認する
  - `$unset` 後のユーザーが status migration で `noPassword` に分類され `bcryptOnly` に残留しないことを確認する（二重メール送信の回帰防止）
  - 統合テストが PASS することが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_
