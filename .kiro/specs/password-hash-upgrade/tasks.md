# Implementation Plan

- [ ] 1. Foundation: bcryptjs 依存関係と PasswordHashService の構築
- [ ] 1.1 apps/app/package.json に bcryptjs を dependencies として追加する
  - `bcryptjs` ^3.x と `@types/bcryptjs` を `apps/app/package.json` の `dependencies` に追加する（Turbopack SSR externalization rule: サーバーサイドの static import はすべて `dependencies` へ）
  - `pnpm install` を実行してロックファイルを更新する
  - `import bcrypt from 'bcryptjs'` が TypeScript で型エラーなく解決されることが確認できる
  - _Requirements: 1.1_

- [ ] 1.2 PasswordHashService を実装する
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

- [ ] 2.2 isPasswordValid、setPassword、updatePassword を async 化し PasswordHashService に委譲する
  - `isPasswordValid(password)` を async 化: `PasswordHashService.verify(password, this.bcryptPassword, this.password, SEED)` を呼び出す
  - `setPassword(password)` を async 化: `this.bcryptPassword = await PasswordHashService.hash(password)` のみ設定し、`password`（SHA-256）フィールドは変更しない（ダウングレード安全のため保持）
  - `updatePassword`、`createUserByEmailAndPasswordAndStatus`、`resetPasswordByRandomString` 内の `setPassword` 呼び出しをすべて `await` 付きに更新する
  - `setPassword()` 後に `bcryptPassword` が設定されており、`password` フィールドが変更されておらず、3 つの呼び出し元すべてが TypeScript コンパイルエラーなく動作することが確認できる
  - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - _Boundary: User Model_

- [ ] 2.3 findUserByEmailAndPassword を fetch-then-compare パターンに変更する
  - `findUserByEmailAndPassword(email, password)` の DB クエリから `password` フィールドを除去して `{ email }` のみで検索するように変更する
  - ユーザー取得後に `await user.isPasswordValid(password)` で検証するように変更する
  - メソッドを async 化して `await` を使用する
  - DB クエリに `password` フィールドが含まれなくなっており、bcrypt ユーザーでも正しく検証できることが確認できる
  - _Requirements: 2.1, 2.3_
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
  - 両フィールドなしのユーザーでのログイン失敗と WARNING ログ出力を確認する
  - `pnpm vitest run` で統合テストが全 PASS することが確認できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
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

- [ ] 4.2 (P) Cleanup migration script を実装する
  - `20260514000002-password-hash-cleanup` マイグレーションを作成する
  - `up()` 開始時に `legacyOnly` ユーザー数（`bcryptPassword` なし・`password` あり）を取得する
  - `legacyOnly > 0` の場合: `throw new Error(...)` でマイグレーションを中断し、件数をエラーメッセージに含める（Req 3.4）
  - `legacyOnly === 0` の場合: `updateMany({ bcryptPassword: { $exists: true }, password: { $exists: true } }, { $unset: { password: '' } })` を実行する（Req 3.3）
  - `legacyOnly > 0` 時に abort されて DB に変更が加えられておらず、エラーメッセージに件数が含まれていることが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [ ] 4.3 (P) Downgrade prep migration script を実装する
  - `20260514000003-password-hash-downgrade-prep` マイグレーションを作成する
  - `up()` 内でダウングレード後にログイン不可になるユーザー数（`bcryptPassword` あり・`password` なし）を集計してログ出力する（Req 4.1）
  - 環境変数 `SEND_RESET_EMAILS` が `'true'` の場合:
    - 対象ユーザーごとに `PasswordResetOrder` を作成して既存メールサービスでリセットメールを送信する（Req 4.2）
    - 対象ユーザーの `bcryptPassword` を `null` に設定してログイン不可化する（Req 4.3）
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

- [ ] 5.2 (P) Cleanup migration script の統合テストを作成する
  - `legacyOnly` ユーザーが存在する状態で `up()` が abort し、ユーザードキュメントが変更されないことを確認する
  - 全ユーザーが `bcryptPassword` 移行済みの状態で `password` フィールドが `$unset` されることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [ ] 5.3 (P) Downgrade prep migration script の統合テストを作成する
  - `SEND_RESET_EMAILS` 未設定時に DB が変更されずカウントのみ出力されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `PasswordResetOrder` が作成されることを確認する
  - `SEND_RESET_EMAILS=true` 時に対象ユーザーの `bcryptPassword` が `null` になっていることを確認する
  - 統合テストが PASS することが確認できる
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_
