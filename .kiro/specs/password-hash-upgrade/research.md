# Research & Design Decisions

---

## Summary

- **Feature**: `password-hash-upgrade`
- **Discovery Scope**: Extension / Complex Integration（セキュリティ影響範囲が広い既存認証システムへの改修）
- **Key Findings**:
  - 現行実装は `SHA-256(PASSWORD_SEED + plaintext)` — ユーザー単位ソルトなし。CodeQL `js/insufficient-password-hash`（CWE-916）の対象
  - `bcryptjs`（Pure JS）は Alpine/musl 環境で問題なく動作。`argon2`（native binding）は Alpine で既知の互換性問題あり（GitHub issues #223, #302, #402, #413）
  - User model は JavaScript（`.js`）で、4つ以上のメソッドが `generatePassword()` を呼び出す。bcrypt 移行で全メソッドが async になる
  - `findUserByEmailAndPassword()` は DB を password hash で検索（`{ email, password: hashedHash }`）しており、bcrypt（非決定論的）移行後はこのパターンが使えない

---

## Research Log

### パスワードハッシュアルゴリズムの選定

- **Context**: SHA-256 → 適応型 KDF への移行ライブラリ選定
- **Sources Consulted**:
  - [npm-compare: argon2 vs bcrypt vs bcryptjs](https://npm-compare.com/argon2,bcrypt,bcrypt-nodejs,bcryptjs)
  - [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
  - [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- **Findings**:
  - `bcryptjs`（Pure JS）: ~3.2M weekly downloads、Alpine 互換、node-gyp 不要
  - `bcrypt`（native C++）: ~1.8M weekly downloads、bcryptjs より高速だが node-gyp / Python3 が必要
  - `argon2`（node-argon2）: OWASP 最推奨アルゴリズムだが、GROWI の Alpine ベース Dockerfile では prebuilt バイナリが musl/glibc 不一致で失敗する既知問題が継続中
- **Implications**: GROWI は Alpine ベース Docker をメインサポートするため `bcryptjs` を採用。native build 問題を排除しシンプルな Dockerfile を維持できる

### CodeQL アラート詳細

- **Context**: どの CodeQL ルールが対象か、何をもって「修正済み」と判定されるか
- **Sources Consulted**: [CodeQL: js/insufficient-password-hash](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- **Findings**:
  - Query ID: `js/insufficient-password-hash`、CWE-916
  - `crypto.createHash('sha256')` でパスワードフィールドへデータが流れる場合にフラグ
  - 修正: `bcrypt.hash()`、`scrypt`、`argon2.hash()`、`pbkdf2` のいずれかへの置き換え
- **Implications**: `bcryptjs` の `bcrypt.hash()` を使用することでアラートが解消される

### User Model の影響範囲

- **Context**: `generatePassword()` の置き換えで影響を受けるコード範囲の特定
- **Findings**:
  - `generatePassword(password)`: モジュールスコープの private 関数
  - 呼び出し箇所: `isPasswordValid`、`setPassword`、`findUserByEmailAndPassword`（DB 検索クエリ内）、`createUserByEmailAndPasswordAndStatus`
  - `findUserByEmailAndPassword` は `{ email, password: sha256Hash }` で DB 検索 → bcrypt 移行後はこのパターン不可（bcrypt は非決定論的）。fetch-then-compare に変更必要
  - User model ファイルは `.js`（TypeScript ではない）。新規サービスファイルは `.ts` で作成

### ダウングレード安全策のパターン

- **Context**: bcrypt 移行後にダウングレードした場合のログイン継続性
- **Findings**:
  - 一方向ハッシュの性質上、bcrypt → SHA-256 の変換は不可能（平文を知らない限り）
  - 主流のアプローチ: (A) 旧ハッシュを別フィールドに保持 + 新ハッシュを新フィールドに書き込む (B) ダウングレード前にパスワードリセット
  - Magento の教訓: 条件反転バグで bcrypt ハッシュを SHA-256 で上書きした事例あり（migrated ユーザーのハッシュを壊す）
- **Implications**: デュアルフィールド方式（`password` = SHA-256保持、`bcryptPassword` = bcrypt格納）を採用。旧フォーマットが既存フィールドに残るため、ダウングレード後も旧バージョンがそのまま機能する

---

## Architecture Pattern Evaluation

| Option | 説明 | 強み | リスク・制限 | 評価 |
|--------|------|------|------------|------|
| **Single-field overwrite** | `password` フィールドを SHA-256→bcrypt に上書き | シンプル | ダウングレード後にログイン不可、cleanup migration が実質 no-op | 不採用 |
| **Dual-field 方式** | `password`（SHA-256保持） + `bcryptPassword`（新bcryptフィールド追加） | ダウングレード安全、旧バージョンはそのまま機能、明確な移行状態管理 | User schema に新フィールド追加が必要 | **採用** |
| **passwordHashVersion フィールド** | バージョンフラグを別フィールドで管理 | 明示的 | フィールドが増え、hash 自体で判別可能な情報を重複管理 | 不採用（hash prefix で判別可能） |
| **argon2id** | OWASP 最推奨 | 最高セキュリティ | Alpine Docker での native build 問題が継続 | 不採用（bcryptjs を優先） |

---

## Design Decisions

### Decision: Dual-field approach（デュアルフィールド方式）

- **Context**: ダウングレード安全性とシームレスな lazy migration の両立
- **Alternatives Considered**:
  1. Single-field overwrite — `password` を bcrypt で上書き。シンプルだがダウングレード安全なし
  2. Dual-field — `password`（SHA-256）保持 + `bcryptPassword` 追加（採用）
  3. Format detection by prefix — 1フィールドに両フォーマット混在、prefix で判別
- **Selected Approach**: `password` フィールドは SHA-256 ハッシュをそのまま保持。ログイン時に `bcryptPassword` フィールドへ bcrypt ハッシュを書き込む。新規ユーザーは `bcryptPassword` のみ設定（`password` なし）
- **Rationale**: 旧バージョンは `password` フィールドのみを参照するため、ダウングレード後も未マイグレーションユーザーがログイン可能。Cleanup migration 実行前はダウングレード安全が維持される
- **Trade-offs**: Schema に `bcryptPassword` フィールド追加が必要。Migration スクリプトでフィールド存在を基準に判定できる（正規表現より明確）
- **Follow-up**: `isPasswordSet()` の実装を両フィールドチェックに更新

### Decision: bcryptjs 採用

- **Context**: 適応型 KDF ライブラリの選定
- **Alternatives Considered**:
  1. `bcryptjs` — Pure JS、Alpine 互換、no native build（採用）
  2. `bcrypt` — Native C++、高速だが Alpine で node-gyp が必要
  3. `argon2` — 最高セキュリティだが Alpine 互換性問題が継続
- **Selected Approach**: `bcryptjs` v3.x、cost factor 12
- **Rationale**: GROWI は Alpine ベース Docker を公式サポート。native build 不要の Pure JS ライブラリで Docker 環境の複雑さを最小化
- **Trade-offs**: `bcrypt` native より ~2-3x 遅い。ただしログインは低頻度操作であり影響軽微（典型的な cost 12 で ~200-400ms）
- **Follow-up**: `BCRYPT_COST` 環境変数で cost factor を設定可能にし、高負荷環境でのチューニングを可能にする

### Decision: Synthesis — PasswordHashService を独立サービスに分離

- **Context**: `generatePassword()` がモジュールスコープの private 関数で直接置き換えが困難
- **Selected Approach**: `src/server/service/password-hash.ts` として独立したサービスモジュールを作成。User model から依存注入（`crowi.passwordHashService` or 直接 import）
- **Rationale**: ハッシュロジックを User model から分離することでテスト容易性向上。`PasswordHashService` 単体でユニットテスト可能。将来的なアルゴリズム変更も１ファイルの修正で済む

---

## Risks & Mitigations

- **`findUserByEmailAndPassword` の DB 検索パターン** — bcrypt 非決定論的ハッシュで query-by-hash 不可能 → fetch-then-compare パターンに変更。既存コードが `{ email, password: hash }` をクエリに使っている箇所を全て特定・修正
- **Passport LocalStrategy の async 化** — 現行は同期コールバック。async 化でエラーハンドリングが変わる → try/catch で done(err) を明示的に呼ぶ
- **bcryptjs の 72 バイト制限** — bcrypt は 72 バイト超を切り捨て。GROWI のパスワードポリシーが 72 バイト超を許可する場合に問題 → 要確認。通常の日本語ユーザーが入力するパスワードでは問題になりにくい
- **Legacy ユーザーが長期ログインしない** — lazy migration のみでは永遠に SHA-256 のまま残るユーザーが存在しうる → Status migration で定期的に確認し、一定期間後に強制リセットを別途検討（本スコープ外）

---

## References

- [CodeQL: js/insufficient-password-hash (CWE-916)](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- [bcryptjs npm](https://www.npmjs.com/package/bcryptjs)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
- [Migrating from SHA to bcrypt — DevToolbox](https://www.dev-toolbox.tech/tools/bcrypt-generator/examples/bcrypt-migration-strategy)

---

## Gap Analysis — 実装ギャップ調査（2026-05-26）

### 分析サマリー

- **スコープ**: User モデル（JS）+ Passport LocalStrategy（TS）+ 3本 migration script の新規作成
- **最大リスク**: `isPasswordValid` の戻り値型変更（`boolean` → `Promise<VerifyResult>`）により、既存呼び出し側で認証が完全にバイパスされる。セキュリティクリティカル
- **カバー漏れ**: タスクリストに記載されていない `setPassword` 呼び出し箇所が 2 箇所存在（`activateInvitedUser`、`createUserByEmail`）
- **アーキテクチャ整合性**: デザイン方針（デュアルフィールド + lazy migration）は適切。実装上の接続点の粒度が不足
- **推奨**: tasks.md のタスク 2.2 および 3.1 を補完し、カバー漏れ箇所とコールバック→ Promise 変換の明示が必要

---

### Critical Issues

#### [CRITICAL-1] `isPasswordValid` の戻り値型変更が既存呼び出し側でサイレントバグを引き起こす

**現状**:
```javascript
// user/index.js:175（現行）
userSchema.methods.isPasswordValid = function (password) {
  return this.password === generatePassword(password); // sync boolean
};
```

**変更後の問題**:
```javascript
// 変更後: async Promise<VerifyResult> を返す
userSchema.methods.isPasswordValid = async function (password) {
  return PasswordHashService.verify(...); // Promise<VerifyResult>
};
```

**影響箇所**:

| ファイル | 行 | コード | 影響 |
|---------|-----|--------|------|
| `service/passport.ts` | 285 | `if (!user \|\| !user.isPasswordValid(password))` | `!Promise` = `false` → 認証が常に成功 → **全員ログイン可能** |
| `routes/apiv3/personal-setting/index.js` | 432 | `if (user.isPasswordSet() && !user.isPasswordValid(oldPassword))` | `!Promise` = `false` → 旧パスワード検証をスキップ → **誰でもパスワード変更可能** |

**修正方針**: 両呼び出し箇所を `await` + `VerifyResult.isValid` を参照するように変更する。

---

#### [CRITICAL-2] `setPassword` のタスクリスト未記載の呼び出し箇所

**タスク 2.2 に記載されている呼び出し箇所**（対応済み扱い）:
- `updatePassword`（line 208）
- `createUserByEmailAndPasswordAndStatus`（line 683）
- `resetPasswordByRandomString`（line 575）

**タスクリストに記載されていない呼び出し箇所**:

| メソッド | ファイル・行 | 問題 |
|---------|-----------|------|
| `activateInvitedUser` | `user/index.js:277` | `this.setPassword(password)` が await なし → `bcryptPassword` 未設定で save → 招待ユーザーにパスワードが設定されない |
| `createUserByEmail` | `user/index.js:591` | `newUser.setPassword(password)` が await なし → 一括招待機能でパスワード設定失敗 |

さらに `activateInvitedUser` は `this.save()` をコールバックスタイルで呼び出しており（line 286）、async/await への移行も必要。

---

#### [CRITICAL-3] `updatePassword` の `setPassword` が await なしのまま

`updatePassword`（line 207–211）はタスク 2.2 の対象だが、現行コードは:
```javascript
userSchema.methods.updatePassword = async function (password) {
  this.setPassword(password);        // ← await なし（現行は sync なので問題ない）
  const userData = await this.save(); // ← save 前に setPassword が完了していない
  return userData;
};
```
`setPassword` が async 化された後は `await this.setPassword(password)` が必須。タスクの検証条件に明示が必要。

---

### Medium Issues

#### [MEDIUM-1] `findUserByEmailAndPassword` のコールバック→async 変換

デザインでは `findUserByEmailAndPassword` を fetch-then-compare に変更するとされているが、変更後は `await user.isPasswordValid()` を内部で呼ぶ必要がある。現行はコールバック API のため、Promise/async への変換が必須。既存の呼び出し側も確認が必要（現時点では passport.ts 以外の呼び出し側は確認できていない）。

#### [MEDIUM-2] `findUserByUsernameOrEmail` のコールバック→async 変換

`passport.ts:280` で使用している `User.findUserByUsernameOrEmail(username, password, callback)` もコールバック形式。LocalStrategy を async 化する際、このメソッドも Promise ベースに変換するか、`util.promisify` でラップする必要がある（タスク 3.1 に記載あり）。

---

### 要件→実装資産マップ（ギャップ付き）

| 要件 | 実装資産 | ステータス |
|------|---------|----------|
| 1.1 bcrypt ハッシュ生成 | `PasswordHashService.hash()` | 新規作成（OK） |
| 1.3 新パスワードに SHA-256 不使用 | `setPassword` → bcryptPassword のみ | OK（全 await 漏れは task 2.2 に明記済み） |
| 2.1 Legacy 検証継続 | `PasswordHashService.verify()` + `isPasswordValid` | OK（design・task 修正済み） |
| 2.2 ログイン時自動 rehash | Passport LocalStrategy async 化 | OK（task 3.1 に変更パターン明記済み） |
| 2.3 両フォーマット透過処理 | `verify()` の分岐ロジック | OK（設計正しい） |
| 2.4 不明フォーマット → WARNING | `verify()` の else 節 | OK（設計正しい） |
| — | `activateInvitedUser` での `setPassword` | OK（task 2.2 に追記済み） |
| — | `createUserByEmail` での `setPassword` | OK（task 2.2 に追記済み） |
| — | `personal-setting` の `isPasswordValid` 変更 | OK（task 3.1a として追加済み） |

---

### 実装アプローチ評価

**採用済み: Option C（Hybrid）**
- 新規: `PasswordHashService`（`service/password-hash.ts`）
- 変更: `user/index.js`（既存メソッドの async 化 + フィールド追加）
- 変更: `passport.ts`（async LocalStrategy）
- 変更: `routes/apiv3/personal-setting/index.js`（isPasswordValid 呼び出し修正）
- 新規: 3 本の migration scripts

**Effort**: M（3–7 日）  
**Risk**: Medium（認証パス全体の async 化が必要だが、gap analysis で全呼び出し元を特定済み。設計レベルの抜け漏れは解消）

---

### 対処済みアクション（実施完了）

1. ✅ **tasks.md タスク 2.2 を更新**: `activateInvitedUser`（index.js:277）と `createUserByEmail`（index.js:591）を明示追加
2. ✅ **tasks.md タスク 3.1 を更新**: `isPasswordValid` の正しい変更パターン（`await` + `.isValid` 参照）をコード例付きで明記
3. ✅ **tasks.md タスク 3.1a を追加**: `personal-setting/index.js:432` の `isPasswordValid` 変更を独立タスクとして追加
4. ✅ **design.md の Modified Files を更新**: 全 5 箇所の `setPassword` 呼び出し元と `personal-setting` ルートを追記
5. ✅ **design.md の Implementation Notes を更新**: `isPasswordValid`・`setPassword` の全呼び出し元リストと変更が必須な理由を明記
6. ✅ **design.md Security Considerations を修正**: 72バイト制限の説明を実際のバリデーター（ASCII限定）に基づいた正確な記述に更新

---

## Gap Analysis — 再検証ラウンド（Opus、2026-06-03）

前回ラウンド（Sonnet）の発見を実コードで再検証した結果、**前回見落とされていた本物の CRITICAL** を 1 件発見し、前回 CRITICAL/MEDIUM とされていた一部が事実誤認であったことを確認した。

### [CRITICAL-4 / NEW] `bcryptPassword` が API レスポンスとシリアライズ経路で漏洩する

**前回ラウンドの見落とし。最も重大。**

新フィールド `bcryptPassword` を User schema に追加すると、bcrypt ハッシュが API レスポンスへ流出する。

**根拠（実コード確認済み）**:
- `@growi/core` の `omitInsecureAttributes()`（`packages/core/src/models/serializers/user-serializer.ts:16`）は `password`, `apiToken`, `email` のみを除去し、**`bcryptPassword` は除去しない**
- この関数は 2 つの経路で使われる:
  1. `serializeUserSecurely()` — `apps/app/src/server/routes/apiv3/users.js` で 6 箇所以上、`revision-serializer.js` 等で呼び出し
  2. **User schema の `toObject` transform**（`user/index.js:78-82`）が `omitInsecureAttributes(ret)` を直接呼んでいる → `user.toObject()` する全経路
- `IUser` インターフェース（`packages/core/src/interfaces/user.ts:10`）にも `password` はあるが `bcryptPassword` フィールド定義がない
- `IUserSerializedSecurely` 型（同 `user-serializer.ts:6-9`）の `Omit<U, 'password' | 'apiToken' | 'email'>` にも `bcryptPassword` が含まれない

**影響**: bcrypt ハッシュ（`$2b$12$...`）がユーザー一覧 API・管理画面・リビジョン author 等のレスポンスに含まれ、クライアントへ漏洩する。bcrypt はオフライン総当たり耐性があるとはいえ、ハッシュの公開は重大なセキュリティ後退であり、CWE-916 改修の趣旨に反する。

**修正方針（修正は 1 箇所で全経路を塞げる）**:
1. `omitInsecureAttributes()` の分割代入に `bcryptPassword` を追加（`const { password, bcryptPassword, apiToken, email, ...rest } = leanDoc;`）
2. `IUserSerializedSecurely` の `Omit` に `'bcryptPassword'` を追加
3. `IUser` インターフェースに `bcryptPassword?: string;` を追加
4. **`@growi/core` は published package のため changeset が必要**（`npx changeset`、patch bump）

**境界への影響**: design.md の Out of Boundary に「`@growi/core` のシリアライザ・型定義」が含まれていたが、これは **誤り**。`bcryptPassword` を安全に追加するには `@growi/core` の変更が必須であり、スコープに含めねばならない。

---

### [訂正] 前回 MEDIUM-1（`findUserByEmailAndPassword` リファクタ）は不要 — デッドコード

**前回の事実誤認を訂正。**

`findUserByEmailAndPassword`（`user/index.js:482`）の**呼び出し元は全コードベースに存在しない**（grep で定義行のみヒット、動的呼び出しも `findUserBy*` 系を全数確認したが該当なし）。

- design.md の File Structure Plan と Components、tasks.md タスク 2.3 はこのメソッドの fetch-then-compare リファクタに工数を割いているが、**呼び出し元がないため動作不能になっても誰も困らない**
- 推奨: タスク 2.3 を「`findUserByEmailAndPassword` を削除する（デッドコード、bcrypt 移行で query-by-hash が破綻するため残す理由がない）」に変更。リファクタより削除のほうが安全かつ低工数
- research.md 冒頭の Key Findings / Risks に書かれた「`findUserByEmailAndPassword` が DB を password hash で検索」も、事実だが「使われていない」点が抜けていた

---

### [確認済み・非問題] export サービスによる `bcryptPassword` ダンプ

`exportCollectionToJson()`（`export.ts:209-213`）は `mongoose.connection.collection(name).find()` の生カーソルで全フィールドをダンプするため、`password`（既存）も `bcryptPassword`（新規）もそのまま出力される。

- これは**既存の `password` フィールドと完全に一貫した挙動**であり、バックアップ／リストアには `bcryptPassword` の出力がむしろ必要
- meta.json に `passwordSeed` を含める既存仕組みと整合
- design.md が「export meta.json 問題は本スコープ外」としているのは妥当。**新たな対処は不要**

---

### 再検証ラウンドの結論

| 項目 | 前回（Sonnet） | 再検証（Opus） |
|------|--------------|---------------|
| serializeUserSecurely の `bcryptPassword` 漏洩 | 見落とし | **CRITICAL-4 として発見・要対処** |
| `findUserByEmailAndPassword` | MEDIUM（リファクタ要） | デッドコード、削除推奨に訂正 |
| export の生ダンプ | 言及なし | 確認の結果、非問題 |
| isPasswordValid 呼び出し元バイパス（CRITICAL-1） | 発見済み・対処済み | 再確認、正しい |
| setPassword await 漏れ（CRITICAL-2/3） | 発見済み・対処済み | 再確認、正しい |

**残作業**: CRITICAL-4 への対処（`@growi/core` のシリアライザ・型・changeset）を design.md と tasks.md に反映する。→ 反映済み（design Modified Files / Security Considerations / task 2.4）。

---

## Design Review — 検証ラウンド（Opus、2026-06-03）

design レビュー時にログインフロー周辺の実コードを精査し、**さらにもう 1 件の CRITICAL を発見**した。

### [CRITICAL-5 / NEW] `password == null` をパスワード未設定の代用に使う 3 箇所がデュアルフィールドで破綻

**根拠（実コード確認済み）**:
旧モデルでは `password` フィールドの null 判定が「ローカルパスワード未設定」（external-account 専用ユーザー）の代用として機能していた（PR #6670 で password を optional 化した際の名残）。デュアルフィールド化で新規ユーザー・cleanup 後の全ユーザーが `password == null`（`bcryptPassword` のみ）になるため、以下が誤動作する:

| ファイル・行 | コード | 破綻内容 |
|------------|--------|---------|
| `routes/login.js:145` | `if (userData.password == null)` → `/me#password_settings` | 新規登録ユーザー（bcrypt-only）が登録直後にパスワード設定画面へ誤リダイレクト |
| `routes/apiv3/user-activation.ts:278` | `userData.password != null ? '/' : '/me#password_settings'` | 招待有効化ユーザー（`activateInvitedUser` は bcryptPassword のみ設定）が誤リダイレクト |
| `routes/apiv3/personal-setting/index.js:702` | `if (user.password == null && count <= 1)` | bcrypt 移行済みユーザーが最後の LDAP アカウントを解除不能（パスワードがあるのに「ない」と判定） |

**影響**: Req 2.3「ユーザー操作不要で透過的処理」に反する機能リグレッション。`login-passport.js` のメインログインハンドラ（`passport.authenticate('local')` 経路）は `password == null` 判定を使っていないため安全だが、登録・招待・LDAP 解除の 3 経路が影響を受ける。

**修正方針**: 3 箇所すべてを `isPasswordSet()`（task 2.1 で `!!(this.bcryptPassword || this.password)` に更新済み）に置換。低工数・低リスク。

**反映**: design Modified Files / Security Considerations、task 2.5 として追加済み。

### 検証範囲の記録（誤検知防止のため確認した非問題）

- `findUserByUsernameOrEmail` の呼び出し元は `passport.ts:280` のみ（task 3.1 の async 変換でカバー済み、他経路なし）
- `login-passport.js` の `loginSuccessHandler`（メインのローカル/外部ログイン成功経路）は `password == null` 判定を含まず、影響なし
- `findUserByEmailAndPassword` は呼び出し元ゼロ（CRITICAL-4 ラウンドで確認、削除方針）

---

## Gap Analysis — 実装足回り検証ラウンド（Opus、2026-06-03）

migration script の実装足回り（実行コンテキスト・依存サービスの可用性）を実コードで検証し、**設計の実現可能性に関わる CRITICAL を 1 件発見**した。

### [CRITICAL-6 / NEW] downgrade-prep をメール送信付き migrate-mongo migration にできない

**根拠（実コード確認済み）**:

1. **migrate-mongo migration は素の `db`（native driver）しか受け取らない**: 既存 migration（例: `*-rename-pageId-to-page.js`）は `async up(db)` で、必要なら `await mongoose.connect()` / `configManager.loadConfigs()` を自前で呼ぶ。**crowi アプリインスタンスは渡されない**。
2. **メール送信には crowi 起動が必須**: `MailService`（`service/mail/mail.ts:38`）の constructor は `crowi.appService` / `crowi.configManager` / `crowi.s2sMessagingService` に依存。`forgot-password.js` のメール送信も `crowi.mailService` と `crowi.appService.getTzoffset()` / `appUrl` を使う。standalone な migration からは取得できない。
3. **crowi の standalone 起動の前例は `repl.ts`**: `new Crowi(); await crowi.init();` でフル起動して service 群にアクセスしている。つまりメールを使う処理は **migration ではなく、この bootstrap を行う standalone スクリプト**で実装すべき。
4. **`migrate-mongo up` は pending migration を全件自動実行する**（`package.json:21` の `migrate:migrate-mongo up`）。単一 migration だけを選んで実行する手段がない。
   - → downgrade-prep を日付付き migration ファイルにすると、**次回デプロイの `migrate up` で自動実行されてしまう**。`SEND_RESET_EMAILS=true` だと全 bcrypt ユーザーへリセットメール送信 + `bcryptPassword` を null 化する処理がデプロイ時に勝手に走る。設計意図（「ダウングレード前に管理者が手動実行」）と矛盾。
   - → cleanup も同様の問題: 日付付き migration にすると、`legacyOnly > 0` で `throw` する設計が **デプロイの migrate ステップ自体を失敗させる**。全ユーザー移行完了まで該当リリースをデプロイできなくなる。

**影響**: Req 4.2（リセットメール送信）/ Req 4.3（リセット必須マーク）/ Req 3.3（cleanup）。現行の File Structure Plan は 3 本すべてを `src/migrations/*.js` に置くが、**cleanup と downgrade-prep は migrate-mongo migration という器に適合しない**。

**修正方針（実装アプローチの再選択）**:

| スクリプト | 必要なコンテキスト | 適切な器 |
|----------|-----------------|---------|
| status（読み取り専用集計） | mongoose のみ | migrate-mongo migration のまま可（自動実行・冪等で安全） |
| cleanup（`$unset password`） | mongoose のみ。ただし「全員移行後に管理者が明示実行」が意図 | **standalone admin スクリプト**（`pnpm run` 経由）。自動実行 migration だと abort がデプロイを壊す |
| downgrade-prep（集計 + メール + マーク） | **crowi 起動が必須**（mailService・appService） | **standalone admin スクリプト**で `new Crowi(); await crowi.init()`（`repl.ts` パターン）。migration 不可 |

- 代替案として「downgrade-prep を集計 + `PasswordResetOrder` 作成のみに留め、メール送信は既存の forgot-password フローに委譲」も可能だが、Req 4.2 が「スクリプトがメール送信オプションを提供」を要求しているため、crowi 起動型の standalone スクリプトが要件に最も忠実。

**反映予定**: design の File Structure Plan / Technology Stack / 各 migration script の Trigger と Contracts、tasks 4.2・4.3・5.2・5.3 を「standalone admin スクリプト」前提に修正。

### 検証範囲の記録（確認した事実）

- env var `BCRYPT_COST` は `process.env` 直読みで取得可能（`crowi.env = process.env`、中央登録不要）。`PasswordHashService` は standalone module として `process.env.BCRYPT_COST` を読めばよい
- `PASSWORD_SEED` は `verify()` の引数として User model（factory 内で `crowi.env` にアクセス可）から渡す設計で問題なし
- `configManager.loadConfigs()` は migration から standalone 呼び出しの前例あり（`*-generate-service-instance-id.js`）。cleanup スクリプトが config を要する場合に利用可
- mongoose は `^6.13.9`（callback API 継続サポート）。design の async 変換は破壊的でない
- `PasswordResetOrder.createPasswordResetOrder()` は static model メソッドで mongoose のみで動作（メール送信部分のみが crowi 依存）

---

## Gap Analysis — 収束確認ラウンド（Opus、2026-06-03）

未検証だった呼び出し元・テスト・初期化フローを精査した結果、**新たな Critical はなし**。これまでの修正で全経路がカバーされていることを確認した。本フィーチャーのギャップ分析は収束した。

### 確認した事項（いずれも対処済み or 非問題）

- **`User.createUser`（installer.ts:190 で初期管理者作成）**: `createUserByEmailAndPasswordAndStatus` のラッパーで `setPassword` を直接呼ばない → task 2.2 で透過的にカバー済み
- **`User.createUserByEmailAndPassword`（登録 login.js / 招待 user-activation.ts）**: 同じく `createUserByEmailAndPasswordAndStatus` のラッパー → 透過的にカバー済み
- **`createUserByEmailAndPasswordAndStatus` 本体**: 既に `async function`。`setPassword` 呼び出し（index.js:683）に `await` を追加すれば十分。末尾の callback-style `newUser.save(cb)` は mongoose `^6.13.9` で継続動作し、変更不要
- **`activateInvitedUser` の呼び出し元（invited.ts:104）**: 既に `await` 済み。設計の `await this.save()` 化は既存の潜在バグ（save 完了前に async 関数が return）も是正
- **`user.integ.ts:124` の `password` フィールド検証**: ユーザー削除時のフィールドクリア検証であり、ハッシュ形式に非依存。bcrypt 化の影響なし

### 収束判定

4 ラウンドの検証で計 6 件の Critical（CRITICAL-1〜6）を発見・反映し、本ラウンドで残存呼び出し元がすべて transitively カバー済みであることを確認した。**これ以上のギャップ分析反復は新規発見の限界効用が低い**。実装フェーズ（`/kiro-spec-tasks` でタスク承認 → `/kiro-impl`）へ進むことを推奨する。

| ラウンド | モデル | 主な発見 |
|---------|-------|---------|
| 1 | Sonnet | CRITICAL-1〜3（認証バイパス・setPassword await 漏れ） |
| 2 | Opus | CRITICAL-4（bcryptPassword 漏洩）、findUserByEmailAndPassword デッドコード訂正 |
| 3 | Opus | CRITICAL-5（password==null 破綻 3 箇所） |
| 3' | Opus | CRITICAL-6（migration 器ミスマッチ: mail/crowi・自動実行） |
| 4 | Opus | 新規 Critical なし（収束確認） |
