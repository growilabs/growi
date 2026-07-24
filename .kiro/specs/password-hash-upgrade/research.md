# Research & Design Decisions

---

## Summary

- **Feature**: `password-hash-upgrade`
- **Discovery Scope**: Extension / Complex Integration（セキュリティ影響範囲が広い既存認証システムへの改修）
- **Key Findings**:
  - 現行実装は `SHA-256(PASSWORD_SEED + plaintext)` — ユーザー単位ソルトなし。CodeQL `js/insufficient-password-hash`（CWE-916）の対象
  - `node:crypto` の scrypt は Node 組み込み（OpenSSL）で新規依存ゼロ・Alpine でネイティブビルド不要・memory-hard。`argon2`（native binding）は Alpine で既知の互換性問題あり（GitHub issues #223, #302, #402, #413）。`bcryptjs`（Pure JS）も Alpine 互換だが third-party 依存が増え memory-hard ではない → **scrypt を採用**
  - User model は JavaScript（`.js`）で、4つ以上のメソッドが `generatePassword()` を呼び出す。scrypt 移行で全メソッドが async になる
  - `findUserByEmailAndPassword()` は DB を password hash で検索（`{ email, password: hashedHash }`）しており、scrypt（ソルトにより非決定論的）移行後はこのパターンが使えない

---

## Research Log

### パスワードハッシュアルゴリズムの選定

- **Context**: SHA-256 → 適応型 KDF への移行ライブラリ選定
- **Sources Consulted**:
  - [npm-compare: argon2 vs bcrypt vs bcryptjs](https://npm-compare.com/argon2,bcrypt,bcrypt-nodejs,bcryptjs)
  - [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
  - [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- **Findings**:
  - `node:crypto` scrypt: Node 組み込み（OpenSSL）、依存追加ゼロ、node-gyp 不要、memory-hard。OWASP 推奨順で bcrypt より上位
  - `bcryptjs`（Pure JS）: ~3.2M weekly downloads、Alpine 互換、node-gyp 不要。ただし third-party 依存、memory-hard ではない
  - `bcrypt`（native C++）: ~1.8M weekly downloads、bcryptjs より高速だが node-gyp / Python3 が必要
  - `argon2`（node-argon2）: OWASP 最推奨アルゴリズムだが、GROWI の Alpine ベース Dockerfile では prebuilt バイナリが musl/glibc 不一致で失敗する既知問題が継続中
- **Implications**: GROWI は Alpine ベース Docker をメインサポートする。native build 不要かつ依存追加ゼロで memory-hard な `node:crypto` scrypt を採用し、シンプルな Dockerfile と強い KDF を両立する（当初は bcryptjs を選定していたが scrypt が候補漏れだったため再評価して変更）

### CodeQL アラート詳細

- **Context**: どの CodeQL ルールが対象か、何をもって「修正済み」と判定されるか
- **Sources Consulted**: [CodeQL: js/insufficient-password-hash](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- **Findings**:
  - Query ID: `js/insufficient-password-hash`、CWE-916
  - `crypto.createHash('sha256')` でパスワードフィールドへデータが流れる場合にフラグ
  - 修正: `bcrypt.hash()`、`scrypt`、`argon2.hash()`、`pbkdf2` のいずれかへの置き換え
- **Implications**: `node:crypto` の `scrypt` を使用することでアラートが解消される

### User Model の影響範囲

- **Context**: `generatePassword()` の置き換えで影響を受けるコード範囲の特定
- **Findings**:
  - `generatePassword(password)`: モジュールスコープの private 関数
  - 呼び出し箇所: `isPasswordValid`、`setPassword`、`findUserByEmailAndPassword`（DB 検索クエリ内）、`createUserByEmailAndPasswordAndStatus`
  - `findUserByEmailAndPassword` は `{ email, password: sha256Hash }` で DB 検索 → scrypt 移行後はこのパターン不可（scrypt はソルトにより非決定論的）。fetch-then-compare に変更必要
  - User model ファイルは `.js`（TypeScript ではない）。新規サービスファイルは `.ts` で作成

### ダウングレード安全策のパターン

- **Context**: scrypt 移行後にダウングレードした場合のログイン継続性
- **Findings**:
  - 一方向ハッシュの性質上、scrypt → SHA-256 の変換は不可能（平文を知らない限り）
  - 主流のアプローチ: (A) 旧ハッシュを別フィールドに保持 + 新ハッシュを新フィールドに書き込む (B) ダウングレード前にパスワードリセット
  - Magento の教訓: 条件反転バグで bcrypt ハッシュを SHA-256 で上書きした事例あり（migrated ユーザーのハッシュを壊す）
- **Implications**: デュアルフィールド方式（`password` = SHA-256保持、`passwordHash` = scrypt格納）を採用。旧フォーマットが既存フィールドに残るため、ダウングレード後も旧バージョンがそのまま機能する

---

## Architecture Pattern Evaluation

| Option | 説明 | 強み | リスク・制限 | 評価 |
|--------|------|------|------------|------|
| **Single-field overwrite** | `password` フィールドを SHA-256→scrypt に上書き | シンプル | ダウングレード後にログイン不可、cleanup migration が実質 no-op | 不採用 |
| **Dual-field 方式** | `password`（SHA-256保持） + `passwordHash`（新フィールド追加、scrypt 格納） | ダウングレード安全、旧バージョンはそのまま機能、明確な移行状態管理 | User schema に新フィールド追加が必要 | **採用** |
| **passwordHashVersion フィールド** | バージョンフラグを別フィールドで管理 | 明示的 | フィールドが増え、hash 自体で判別可能な情報を重複管理 | 不採用（hash prefix で判別可能） |
| **argon2id** | OWASP 最推奨 | 最高セキュリティ | Alpine Docker での native build 問題が継続 | 不採用（依存ゼロの scrypt を優先） |

---

## Design Decisions

### Decision: Dual-field approach（デュアルフィールド方式）

- **Context**: ダウングレード安全性とシームレスな lazy migration の両立
- **Alternatives Considered**:
  1. Single-field overwrite — `password` を scrypt で上書き。シンプルだがダウングレード安全なし
  2. Dual-field — `password`（SHA-256）保持 + `passwordHash` 追加（採用）
  3. Format detection by prefix — 1フィールドに両フォーマット混在、prefix で判別
- **Selected Approach**: `password` フィールドは SHA-256 ハッシュをそのまま保持。ログイン時に `passwordHash` フィールドへ scrypt ハッシュを書き込む。新規ユーザーは `passwordHash` のみ設定（`password` なし）
- **Rationale**: 旧バージョンは `password` フィールドのみを参照するため、ダウングレード後も未マイグレーションユーザーがログイン可能。Cleanup migration 実行前はダウングレード安全が維持される
- **Trade-offs**: Schema に `passwordHash` フィールド追加が必要。Migration スクリプトでフィールド存在を基準に判定できる（正規表現より明確）
- **Follow-up**: `isPasswordSet()` の実装を両フィールドチェックに更新

### Decision: scrypt（node:crypto）採用（再評価により変更）

- **Context**: 適応型 KDF の選定。当初 `bcryptjs` を選定していたが、レビューで **Node.js 標準の `crypto.scrypt` が候補から漏れていた**ことが判明したため再評価した。
- **Alternatives Considered**:
  1. `node:crypto` の **scrypt** — Node 組み込み（OpenSSL）、新規依存ゼロ、memory-hard、Alpine でネイティブビルド不要（**採用**）
  2. `bcryptjs` — Pure JS、Alpine 互換、no native build。ただし third-party 依存が増え、memory-hard ではない
  3. `bcrypt`（native C++）— 高速だが Alpine で node-gyp / Python3 が必要
  4. `argon2` — OWASP 最推奨だが Alpine のネイティブビルド互換性問題が継続（不採用のまま）
- **Selected Approach**: `node:crypto` の `scrypt`。パラメータ **N=131072 (2^17), r=8, p=1（OWASP 最小推奨）**、keylen=64。自己記述形式 `scrypt$N$r$p$salt$hash` で保存。検証は `timingSafeEqual`。`maxmem` は消費メモリ（≈128MB）を上回る ≥192MB に設定（Node 既定 32MB のままだと throw）
- **Rationale**:
  - **新規依存ゼロ**（Node 組み込み）で、argon2 を諦めた理由である Alpine のネイティブビルド問題を最初から回避。サプライチェーン・バージョン保守の負担もなし
  - **memory-hard** で GPU/ASIC ブルートフォース耐性が bcrypt より高い（OWASP でも bcrypt より上位）
  - CWE-916 解消という目的は bcrypt でも達成できるが、「新規依存を増やさずより強く」という本フィーチャーの狙いに scrypt が最も合致する
- **Trade-offs**:
  - bcrypt の自己記述フォーマット（`$2b$…`）が使えないため、salt+パラメータの符号化・分解を**自前実装**する（数十行）
  - OWASP 最小推奨（N=2^17, r=8）では1回あたり約128MB を消費し、`maxmem` を ≥192MB に上げる必要がある（Node 既定 32MB では throw）。非同期 `crypto.scrypt` は libuv スレッドプールで同時実行数が頭打ちになり、ピークは概ね「スレッド数 × 128MB ≒ 512MB」。この一時確保をコンテナのメモリ予算に織り込む（逼迫時は代替 N=2^16, r=8, p=2 ≒ 64MB/回 を検討）（Security Considerations 参照）
- **Follow-up**: scrypt パラメータを環境変数で調整可能にし、下限クランプと `maxmem` 上限を設定。ログインエンドポイントのレート制限を推奨

### Decision: Synthesis — PasswordHashService を独立サービスに分離

- **Context**: `generatePassword()` がモジュールスコープの private 関数で直接置き換えが困難
- **Selected Approach**: `src/server/service/password-hash.ts` として独立したサービスモジュールを作成。User model から依存注入（`crowi.passwordHashService` or 直接 import）
- **Rationale**: ハッシュロジックを User model から分離することでテスト容易性向上。`PasswordHashService` 単体でユニットテスト可能。将来的なアルゴリズム変更も１ファイルの修正で済む

---

## Risks & Mitigations

- **`findUserByEmailAndPassword` の DB 検索パターン** — scrypt 非決定論的ハッシュで query-by-hash 不可能 → fetch-then-compare パターンに変更。既存コードが `{ email, password: hash }` をクエリに使っている箇所を全て特定・修正
- **Passport LocalStrategy の async 化** — 現行は同期コールバック。async 化でエラーハンドリングが変わる → try/catch で done(err) を明示的に呼ぶ
- **scrypt のメモリ消費（運用）** — OWASP 最小推奨（N=2^17=131072, r=8）では1回あたり約128MB。`maxmem` を ≥192MB に設定必須（Node 既定 32MB では throw）。非同期 `crypto.scrypt` は libuv スレッドプールで同時実行数が頭打ちになりピークは概ね「スレッド数 × 128MB ≒ 512MB」。この一時確保をコンテナのメモリ予算に織り込み、逼迫時は `UV_THREADPOOL_SIZE` を絞るか代替 N=2^16, r=8, p=2 ≒ 64MB/回 を検討。ログインエンドポイントのレート制限も推奨（scrypt は bcrypt のような 72 バイト切り詰め制限は持たない）
- **Legacy ユーザーが長期ログインしない** — lazy migration のみでは永遠に SHA-256 のまま残るユーザーが存在しうる → Status migration で定期的に確認し、一定期間後に強制リセットを別途検討（本スコープ外）
- **ユーザー列挙タイミング攻撃（scrypt 化で顕在化）** — 存在しないユーザーは即時返却、存在するユーザーは scrypt 再計算により数十〜数百 ms かかるため、応答時間差でユーザーの存在を推測できる。SHA-256 時代より差が顕著になる。緩和: ユーザー不存在時もダミー scrypt 比較を実行する（本スコープではログインエンドポイントのレート制限が既存か確認を推奨。なければ別タスク）
- **legacy SHA-256 パスの非定数時間比較** — `this.password === generatePassword(password)` は厳密な定数時間比較ではないが、平文ではなくハッシュ同士を比較しているため実際の攻撃リスクは極めて低い。`PasswordHashService.verify()` の legacy パスで `crypto.timingSafeEqual` を使うことで完全に解消可能（必須ではない）

---

## References

- [CodeQL: js/insufficient-password-hash (CWE-916)](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- [bcryptjs npm](https://www.npmjs.com/package/bcryptjs)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
- [Migrating from SHA to bcrypt — DevToolbox](https://www.dev-toolbox.tech/tools/bcrypt-generator/examples/bcrypt-migration-strategy)

---

## Gap Analysis: 既存コードとの統合点検証（scrypt 版・2026-07-17）

要件 ↔ 既存コードベースのギャップを実コード照合で検証した（`/kiro-validate-gap`）。

### 確認済み（前提は実在）

| 統合点 | 確認結果 |
|--------|---------|
| `isPasswordValid` 呼び出し元 | `passport.ts:285` / `personal-setting/index.js:432` の 2 箇所（sync boolean）✅ |
| `setPassword` 呼び出し元 | `user/index.js` の 5 メソッド（208/277/575/591/683）✅ |
| `password == null` 代用判定 | `login.js:145` / `personal-setting:702` / `user-activation.ts:278` ✅ |
| `findUserByEmailAndPassword` | 定義のみ・呼び出し元ゼロ（デッドコード）✅ |
| `omitInsecureAttributes()` | `password`/`apiToken`/`email` のみ除外、`passwordHash` 未除外 ✅（要追加） |
| `statusDelete()` | `password=''` のみスクラブ、`passwordHash` 未消去 ✅（要追加） |
| migrate-mongo | `src/migrations/`（49 本）+ `dev:migrate-mongo` script 実在 ✅ |
| `PasswordResetOrder` | `src/server/models/password-reset-order.ts` に `createPasswordResetOrder(email)` static 実在 ✅ |
| Crowi bootstrap（standalone） | `src/server/repl.ts` が `new Crowi()`+`crowi.init()` パターン。`pnpm run ts-node <file>` で起動 ✅ |
| mailService | `crowi.mailService.send(...)`（forgot-password.js が使用）✅ |
| scrypt | `node:crypto` 組み込み・依存ゼロ ✅ |

### 検出したギャップ（実装時に対応）

1. **`src/server/scripts/` ディレクトリが未存在**: cleanup / downgrade-prep はこのディレクトリに新規作成。standalone 実行手段は `repl.ts` と同じ `pnpm run ts-node src/server/scripts/<name>.ts`（`ts-node` script が `dotenv-flow` + `tsconfig-paths` を読み込む）。**package.json に実行用 script エントリを追加するか、実行コマンドを README/design に明記する**必要がある。
2. **リセットメール送信ロジックが再利用不可**: `sendPasswordResetEmail()` は `forgot-password.js` 内のローカル関数で **export されていない**。downgrade-prep からは直接再利用できないため、(a) 共有ヘルパーに抽出するか、(b) `mailService.send()` 呼び出し + テンプレートをスクリプト内に複製する必要がある。design の「既存メールサービスでリセットメール送信」はこの点を明示していない。
3. **`PasswordResetOrder` は Mongoose/Prisma が併存**: `src/generated/prisma/models/passwordresetorders.ts` も存在するが、`forgot-password.js` は Mongoose 版（`~/server/models/password-reset-order`）を使用。本スペックも Mongoose 版に統一して整合を取る（Prisma 版は使用しない）。

### Implications
- 前提の大半は実在し、scrypt 移行を阻む統合上のブロッカーはない。
- 上記ギャップ 1・2 は downgrade-prep（task 4.3）の実装詳細に影響するため、design/tasks に反映すると実装がスムーズ。
