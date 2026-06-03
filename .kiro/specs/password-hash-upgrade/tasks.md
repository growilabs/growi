# Implementation Plan

- [ ] 1. Foundation: bcryptjs 依存関係と PasswordHashService の構築
- [x] 1.1 apps/app/package.json に bcryptjs を dependencies として追加する
  - `bcryptjs` ^3.x と `@types/bcryptjs` を `apps/app/package.json` の `dependencies` に追加する（Turbopack SSR externalization rule: サーバーサイドの static import はすべて `dependencies` へ）
  - `pnpm install` を実行してロックファイルを更新する
  - `import bcrypt from 'bcryptjs'` が TypeScript で型エラーなく解決されることが確認できる
  - _Requirements: 1.1_

- [x] 1.2 PasswordHashService を実装する
  - `hash(plaintext)` を実装: `bcrypt.hash(plaintext, BCRYPT_COST)` — 常に bcrypt のみ使用、PASSWORD_SEED は不使用。`BCRYPT_COST` は環境変数でカスタム可能（デフォルト 12）
  - `BCRYPT_COST` が 12 未満の場合は起動時に WARNING ログを出力する
  - `verify(plaintext, bcryptHash, legacyHash, passwordSeed)` を実装:
    - `bcryptHash` あり → `bcrypt.compare()` で検証（`needsRehash: false`）
    - `bcryptHash` なし・`legacyHash` あり → `SHA-256(SEED + plaintext)` で検証（`needsRehash: true`）
    - 両フィールドなし → `isValid: false` を返し WARNING ログを出力（ユーザー識別子含む）
  - `VerifyResult` インターフェース（`isValid: boolean; needsRehash: boolean`）をエクスポートする
  - `hash()` 呼び出しで `$2b$` プレフィックスの bcrypt ハッシュが返ってくることが確認できる
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4_
  - _Boundary: PasswordHashService_

- [ ] 1.3 PasswordHashService のユニットテストを作成する
  - `hash()`: 同一平文で 2 回呼び出すと異なるハッシュが返ること（per-user salt）を確認する
  - `hash()`: 返り値が `$2b$` で始まる（SHA-256 の 64 文字 hex でない）ことを確認する
  - `verify()`: bcrypt パス → `{ isValid: true, needsRehash: false }` を確認する
  - `verify()`: SHA-256 legacy パス（`legacyHash` あり）→ `{ isValid: true, needsRehash: true }` を確認する
  - `verify()`: 無効な認証情報 → `{ isValid: false }` を確認する
  - `verify()`: 両フィールドなし → `{ isValid: false }` かつ WARNING ログ出力を確認する
  - `omitInsecureAttributes()` / `serializeUserSecurely()` の戻り値に `bcryptPassword` が含まれないことを確認する
  - `pnpm vitest run password-hash.spec` が全 PASS することが確認できる
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4_
  - _Boundary: PasswordHashService_

- [ ] 2. User モデルのパスワード処理刷新
- [ ] 2.1 User schema に bcryptPassword フィールドを追加し isPasswordSet を更新する
  - Mongoose スキーマ定義に `bcryptPassword: { type: String }` フィールドを追加する
  - `isPasswordSet()` を `!!(this.bcryptPassword || this.password)` に更新して両フィールドを確認するようにする
  - MongoDB フィールド追加は既存ドキュメントに影響しない（自動マイグレーション不要）
  - 既存の `password` フィールドが変更されておらず、`bcryptPassword` が新たに追加されていることが確認できる
  - _Requirements: 2.2, 2.3_
  - _Boundary: User Model_

- [ ] 2.2 isPasswordValid、setPassword とその全呼び出し元を async 化し PasswordHashService に委譲する
  - `isPasswordValid(password)` を async 化: `PasswordHashService.verify(password, this.bcryptPassword, this.password, SEED)` を呼び出す
  - `setPassword(password)` を async 化: `this.bcryptPassword = await PasswordHashService.hash(password)` のみ設定し、`password`（SHA-256）フィールドは変更しない（ダウングレード安全のため保持）
  - 以下の **setPassword 呼び出し元すべて** に `await` を追加する（漏れると bcryptPassword が未設定のまま save される）:
    - `updatePassword`（index.js:208）: `await this.setPassword(password)`
    - `activateInvitedUser`（index.js:277）: `await this.setPassword(password)` かつ `this.save(callback)` を `await this.save()` + try/catch に変更
    - `resetPasswordByRandomString`（index.js:575）: `await user.setPassword(newPassword)`
    - `createUserByEmail`（index.js:591）: `await newUser.setPassword(password)`
    - `createUserByEmailAndPasswordAndStatus`（index.js:683）: `await newUser.setPassword(password)`
  - `setPassword()` 後に `bcryptPassword` が設定されており、`password` フィールドが変更されておらず、上記 5 つの呼び出し元すべてが正しく動作することが確認できる
  - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - _Boundary: User Model_

- [ ] 2.3 (P) findUserByEmailAndPassword（デッドコード）を削除する
  - `findUserByEmailAndPassword`（index.js:482）は**コードベース全体に呼び出し元が存在しない**ことを再確認する（grep で定義行のみヒット）
  - query-by-hash パターンは bcrypt 移行後に動作不能になるため、リファクタではなく**メソッドごと削除**する
  - 削除後に TypeScript コンパイル・既存テストが通ることを確認する（呼び出し元がないため影響なし）
  - _Requirements: 2.1, 2.3_
  - _Boundary: User Model_

- [ ] 2.4 (P) @growi/core のシリアライザと型に bcryptPassword を追加し漏洩を防ぐ
  - `packages/core/src/models/serializers/user-serializer.ts` の `omitInsecureAttributes()` の分割代入に `bcryptPassword` を追加する: `const { password, bcryptPassword, apiToken, email, ...rest } = leanDoc;`（**重要**: これを怠ると bcrypt ハッシュが API レスポンスと `toObject` transform 経由で漏洩する）
  - 同ファイルの `IUserSerializedSecurely` 型の `Omit<U, 'password' | 'apiToken' | 'email'>` に `'bcryptPassword'` を追加する
  - `packages/core/src/interfaces/user.ts` の `IUser` 型に `bcryptPassword?: string;` を追加する
  - `npx changeset` を実行して `@growi/core` の patch bump 用 changeset を作成する（published package のため必須）
  - シリアライズ後のユーザーオブジェクト（`serializeUserSecurely()` の戻り値および `user.toObject()`）に `bcryptPassword` が含まれないことが確認できる
  - _Requirements: 1.1, 1.2_
  - _Boundary: User serializer (@growi/core)_

- [ ] 2.5 `password == null` 代用判定を isPasswordSet() に置換する（後方互換）
  - デュアルフィールド化で新規・移行済みユーザーは `password == null`（bcryptPassword のみ）になるため、`password` の null 判定を「パスワード未設定」の代用に使う箇所を `isPasswordSet()` に置換する
  - `routes/login.js:145`: `if (userData.password == null)` → `if (!userData.isPasswordSet())`（登録直後の bcrypt-only ユーザーが `/me#password_settings` へ誤リダイレクトされるのを防ぐ）
  - `routes/apiv3/user-activation.ts:278`: `userData.password != null ? '/' : '/me#password_settings'` → `userData.isPasswordSet() ? '/' : '/me#password_settings'`（招待ユーザー有効化後の誤リダイレクト防止）
  - `routes/apiv3/personal-setting/index.js:702`: `if (user.password == null && count <= 1)` → `if (!user.isPasswordSet() && count <= 1)`（bcrypt 移行済みユーザーが最後の LDAP アカウントを解除できなくなるのを防ぐ）
  - bcryptPassword のみを持つユーザーで上記 3 フローが「パスワード設定済み」として正しく扱われることが確認できる
  - _Requirements: 1.1, 2.3_
  - _Depends: 2.1_
  - _Boundary: User Model_

- [ ] 3. Passport LocalStrategy の async 化と lazy migration 統合
- [ ] 3.1 (P) Passport LocalStrategy を async 化し lazy migration をトリガーする
  - `findUserByUsernameOrEmail` をコールバックスタイルから Promise ベース（async/await）に変更またはラップする
  - LocalStrategy コールバックを async 関数に変更し、try/catch で全エラーを `done(err)` に渡す
  - `isPasswordValid` の呼び出しを `await` + `VerifyResult` 参照に変更する（**重要**: `!user.isPasswordValid(password)` のままだと Promise が常に truthy となり認証が完全にバイパスされる）:
    ```typescript
    // ❌ 変更前（バグ）
    if (!user || !user.isPasswordValid(password)) { return done(null, false); }
    // ✅ 変更後
    const verifyResult = await user.isPasswordValid(password);
    if (!user || !verifyResult.isValid) { return done(null, false); }
    ```
  - `VerifyResult.needsRehash === true` の場合（legacy 認証成功時）: `await user.setPassword(password)` + `await user.save()` を実行してから `done(null, user)` を返す
  - lazy migration の `save()` 失敗時はエラーログを記録するが、ログイン自体は成功させる（次回ログインでリトライ可能）
  - `verifyResult.isValid === false` の場合は `done(null, false)` を返す
  - SHA-256 ハッシュを持つユーザーで初回ログインすると DB の `bcryptPassword` フィールドが設定されることが確認できる
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2_
  - _Boundary: Passport LocalStrategy_

- [ ] 3.2 (P) personal-setting ルートの isPasswordValid 呼び出しを async に修正する
  - `routes/apiv3/personal-setting/index.js:432` の `isPasswordValid` 呼び出しを `await` + `VerifyResult.isValid` 参照に変更する（**重要**: 変更しないと旧パスワード検証がスキップされ、誰でも他人のパスワードを変更できる）:
    ```javascript
    // ❌ 変更前（バグ）
    if (user.isPasswordSet() && !user.isPasswordValid(oldPassword))
    // ✅ 変更後
    const verifyResult = await user.isPasswordValid(oldPassword);
    if (user.isPasswordSet() && !verifyResult.isValid)
    ```
  - 変更後にパスワード変更エンドポイントで旧パスワード不一致の場合は 400 エラーが返ることが確認できる
  - _Requirements: 2.1_
  - _Depends: 2.2_
  - _Boundary: Passport LocalStrategy, User Model_

- [ ] 3.3 ログインフローの統合テストを作成する
  - legacy SHA-256 ユーザーのログイン成功 + lazy migration 後に `bcryptPassword` が DB に書き込まれることを確認する
  - bcrypt ユーザーのログイン成功 + rehash が発生しないことを確認する
  - 無効な認証情報でのログイン失敗を確認する
  - 両フィールドなしのユーザーでのログイン失敗と WARNING ログ出力を確認する
  - `pnpm vitest run` で統合テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: Passport LocalStrategy_

- [ ] 4. (P) マイグレーション／管理スクリプトの実装
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

- [ ] 4.2 (P) Cleanup standalone 管理スクリプトを実装する
  - **migrate-mongo migration ではなく standalone スクリプト**として `src/server/scripts/password-hash-cleanup.ts` を作成する（理由: abort 時の `throw` がデプロイの migrate ステップを壊すため、自動実行 migration にしてはならない。research CRITICAL-6 参照）
  - mongoose 接続のみで動作させる（`getMongoUri()`/`mongoOptions` で接続。crowi 起動は不要）
  - `package.json` に実行用スクリプト（例: `script:password-hash-cleanup`）を追加する（`repl` スクリプトと同様の `ts-node` 実行形式）
  - 開始時に `legacyOnly` ユーザー数（`bcryptPassword` なし・`password` あり）を取得する
  - `legacyOnly > 0` の場合: エラーメッセージ（件数を含む）を出力して**データ変更せず中断**する（Req 3.4）
  - `legacyOnly === 0` の場合: `updateMany({ bcryptPassword: { $exists: true }, password: { $exists: true } }, { $unset: { password: '' } })` を実行する（Req 3.3）
  - `legacyOnly > 0` 時に中断されて DB に変更が加えられておらず、エラーメッセージに件数が含まれていることが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup script_

- [ ] 4.3 (P) Downgrade prep standalone 管理スクリプトを実装する
  - **migrate-mongo migration ではなく standalone スクリプト**として `src/server/scripts/password-hash-downgrade-prep.ts` を作成する（理由: 自動実行されてはならない & メール送信に crowi 起動が必要。research CRITICAL-6 参照）
  - `new Crowi(); await crowi.init()` でフル起動し `crowi.mailService` / `crowi.appService` にアクセスする（`src/server/repl.ts` パターン）
  - `package.json` に実行用スクリプト（例: `script:password-hash-downgrade-prep`）を追加する
  - ダウングレード後にログイン不可になるユーザー数（`bcryptPassword` あり・`password` なし）を集計してログ出力する（Req 4.1）
  - 環境変数 `SEND_RESET_EMAILS` が `'true'` の場合:
    - 対象ユーザーごとに `PasswordResetOrder.createPasswordResetOrder()` を作成し、`crowi.mailService` でリセットメールを送信する（Req 4.2、`forgot-password.js` の送信ロジックを参考）
    - 対象ユーザーの `bcryptPassword` を `null` に設定してログイン不可化する（Req 4.3）
  - `SEND_RESET_EMAILS` 未設定時に集計カウントのみ出力されて DB が変更されないことが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep script_

- [ ] 5. (P) マイグレーション／管理スクリプトの統合テスト
- [ ] 5.1 (P) Status migration script の統合テストを作成する
  - テスト DB に 4 区分（bcryptOnly、both、legacyOnly、noPassword）のユーザーを用意する
  - `up()` 実行後に各カウントが期待値と一致することを確認する
  - `up()` 実行後に DB のユーザードキュメントが一切変更されていないことを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [ ] 5.2 (P) Cleanup スクリプトの統合テストを作成する
  - コア処理（abort 判定 + `$unset`）を crowi 非依存の関数として抽出し、テスト可能にする
  - `legacyOnly` ユーザーが存在する状態で中断し、ユーザードキュメントが変更されないことを確認する
  - 全ユーザーが `bcryptPassword` 移行済みの状態で `password` フィールドが `$unset` されることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup script_

- [ ] 5.3 (P) Downgrade prep スクリプトの統合テストを作成する
  - コア処理（集計 + リセット発行 + マーク）を mailService をモック注入できる関数として抽出し、テスト可能にする
  - `SEND_RESET_EMAILS` 未設定時に DB が変更されずカウントのみ出力されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `PasswordResetOrder` が作成されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `bcryptPassword` が `null` になっていることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep script_
