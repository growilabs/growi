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
- **ユーザー列挙タイミング攻撃（bcrypt 化で顕在化）** — 存在しないユーザーは即時返却、存在するユーザーは bcrypt.compare() により ~200-400ms かかるため、応答時間差でユーザーの存在を推測できる。SHA-256 時代より差が桁違いに顕著になる。緩和: ユーザー不存在時もダミー bcrypt 比較を実行する（本スコープではログインエンドポイントのレート制限が既存か確認を推奨。なければ別タスク）
- **legacy SHA-256 パスの非定数時間比較** — `this.password === generatePassword(password)` は厳密な定数時間比較ではないが、平文ではなくハッシュ同士を比較しているため実際の攻撃リスクは極めて低い。`PasswordHashService.verify()` の legacy パスで `crypto.timingSafeEqual` を使うことで完全に解消可能（必須ではない）

---

## References

- [CodeQL: js/insufficient-password-hash (CWE-916)](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- [bcryptjs npm](https://www.npmjs.com/package/bcryptjs)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
- [Migrating from SHA to bcrypt — DevToolbox](https://www.dev-toolbox.tech/tools/bcrypt-generator/examples/bcrypt-migration-strategy)
