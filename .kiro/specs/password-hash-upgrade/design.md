# Design Document: password-hash-upgrade

## Overview

GROWI のローカル認証システムにおけるパスワードハッシュを SHA-256（グローバル `PASSWORD_SEED` ペッパー、ユーザー単位ソルトなし）から `bcryptjs`（cost factor 12、ユーザー単位ランダムソルト）へ移行する。これにより CodeQL `js/insufficient-password-hash`（CWE-916）アラートを解消する。

移行は **遅延マイグレーション（lazy migration）** として実装する。既存ユーザーは再ログイン時に自動的に bcrypt ハッシュへ再ハッシュされ、パスワードリセット不要でシームレスに移行する。**デュアルフィールド方式**（`password` = SHA-256保持、`bcryptPassword` = bcrypt格納）により、Cleanup migration 実行前はダウングレードしても旧バージョンが SHA-256 ハッシュで認証継続可能。

**Users**: GROWI 管理者（移行ライフサイクル管理）、エンドユーザー（透過的移行）。  
**Impact**: User model に `bcryptPassword` フィールド追加、パスワード検証を全スタックで async 化、1本の読み取り専用 migrate-mongo マイグレーション（status）と 2本の standalone 管理スクリプト（cleanup・downgrade-prep）追加。

### Goals

- CodeQL `js/insufficient-password-hash`（CWE-916）アラート解消
- 新規パスワードおよびパスワード変更時に bcrypt（cost ≥ 12、per-user salt）を適用
- 既存 SHA-256 ユーザーがパスワードリセットなしにシームレスにログイン継続
- Cleanup migration 実行前はダウングレード時に SHA-256 ユーザーの認証が継続
- 移行進捗の可視化・管理・クリーンアップ・ダウングレード対応のためのマイグレーションスクリプト群

### Non-Goals

- LDAP、OAuth、SAML、Passkey 等の外部認証プロバイダー
- `apiToken` フィールドのハッシュ化改善
- `PASSWORD_SEED` 環境変数の即時廃止
- 全ユーザーの一括強制マイグレーション（バッチ rehash）
- 72 バイト超のパスワードに対する特殊対応（GROWI のパスワードポリシーの範囲内で問題なし）

---

## Boundary Commitments

### This Spec Owns

- `PasswordHashService`（`src/server/service/password-hash.ts`）: bcrypt ハッシュ生成・検証・legacy 判定
- User model のパスワード関連メソッド（`isPasswordValid`、`setPassword`、`updatePassword`、`isPasswordSet`）の async 化と `bcryptPassword` フィールド追加
- `findUserByEmailAndPassword` の fetch-then-compare リファクタリング
- Passport LocalStrategy の async 化と lazy migration トリガー
- 1本の読み取り専用 migrate-mongo マイグレーション（status）と 2本の standalone 管理スクリプト（cleanup・downgrade-prep）
- `bcryptjs` 依存関係の追加（`apps/app/package.json`）

### Out of Boundary

- 外部認証プロバイダー（LDAP、OAuth、SAML、Passkey）のパスワード処理
- `apiToken` フィールドのハッシュ化
- パスワードリセットメール送信インフラ（既存の `PasswordResetOrder` + メールサービスを利用）
- 全ユーザー強制マイグレーション（lazy migration のみ。未ログインユーザーは SHA-256 のまま残る）
- `PASSWORD_SEED` 環境変数の廃止（Cleanup migration 後も legacy 検証パスで使用済みのハッシュは不存在になるが、環境変数設定自体の廃止は別途）

### Allowed Dependencies

- `bcryptjs` ^3.0（新規依存、Pure JS、`apps/app/package.json` の `dependencies` に追加）
- `node:crypto`（built-in、SHA-256 legacy 検証パスで継続使用）
- 既存 `PasswordResetOrder` model（downgrade-prep スクリプトでリセット発行に使用）
- 既存メールサービス（downgrade-prep スクリプトでリセットメール送信）
- `migrate-mongo`（既存マイグレーションインフラ、status migration のみ）
- Crowi bootstrap（`new Crowi(); await crowi.init()`、downgrade-prep standalone スクリプトでの mailService 初期化）

### Revalidation Triggers

- User model の `password` / `bcryptPassword` フィールド定義変更
- `PasswordHashService` の `verify()` / `hash()` インターフェース変更
- Passport LocalStrategy のコールバックシグネチャ変更
- `user/index.js` を TypeScript に移行する場合（型定義の更新が必要）

---

## Architecture

### Existing Architecture Analysis

```
generatePassword(password)          // private function, SHA-256(SEED + plain) → hex
  ↓ called by
User.isPasswordValid(password)     // sync, string compare
User.setPassword(password)         // sync, sets this.password
User.updatePassword(password)      // async, calls setPassword + save
User.findUserByEmailAndPassword()  // queries DB by { email, password: hash } ← 問題
User.createUserByEmailAndPasswordAndStatus()

Passport LocalStrategy callback    // sync, calls user.isPasswordValid inline
```

**改修が必要な理由**:
1. SHA-256 は fast hash（CWE-916）
2. `findUserByEmailAndPassword` は DB に password hash でクエリしているため bcrypt 移行後は動作不能（bcrypt は非決定論的）
3. 全 password メソッドが同期的なため bcrypt（async）に対応不可

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    Passport[Passport LocalStrategy async] -->|isPasswordValid| UserModel[User Model]
    UserModel -->|hash / verify| PHS[PasswordHashService]
    PHS -->|bcrypt.hash / bcrypt.compare| Bcryptjs[bcryptjs]
    PHS -->|createHash sha256| NodeCrypto[node crypto]
    UserModel -->|save bcryptPassword| MongoDB[(MongoDB)]
    StatusScript[Status Migration] -->|countDocuments| MongoDB
    CleanupScript[Cleanup Migration] -->|updateMany unset password| MongoDB
    DowngradeScript[Downgrade Prep Migration] -->|count + PasswordResetOrder| MongoDB
```

**New architecture**:
- `PasswordHashService`: bcrypt/legacy 両対応の薄いサービス層。User model と Passport は直接 crypto に依存しない
- User model: `bcryptPassword` フィールド追加、全パスワードメソッドを async 化
- Passport LocalStrategy: async callback。verify 結果の `needsRehash` を受けて lazy migration をトリガー
- Migration scripts: `migrate-mongo` 既存インフラ上で動作する 3 本

### Technology Stack

| Layer | Choice / Version | Role | Notes |
|-------|-----------------|------|-------|
| Backend / Auth | `bcryptjs` ^3.x | bcrypt ハッシュ生成・検証 | Pure JS、Alpine 互換、no native build。`dependencies` に追加（Turbopack SSR rule） |
| Backend / Auth | `node:crypto` (built-in) | Legacy SHA-256 検証 | 既存コードと同じ API。移行期間のみ使用 |
| Backend / Model | Mongoose（既存） | User schema + `bcryptPassword` フィールド追加 | — |
| Backend / Auth | Passport.js（既存） | LocalStrategy の async 化 | — |
| Infrastructure | `migrate-mongo`（既存） | 3 本のマイグレーションスクリプト実行 | — |

---

## File Structure Plan

### New Files

```
apps/app/src/server/service/
└── password-hash.ts                        # PasswordHashService (bcrypt + legacy verify, hash)

apps/app/src/migrations/
└── 20260514000001-password-hash-status.js     # Req 3.1, 3.2: hash format count report (read-only, migrate-mongo)

apps/app/src/server/scripts/
├── password-hash-cleanup.ts                   # Req 3.3, 3.4: remove legacy password (standalone admin script)
└── password-hash-downgrade-prep.ts            # Req 4.1, 4.2, 4.3: count + optional reset email (standalone, Crowi bootstrap)
```

> **standalone スクリプト化の理由（CRITICAL-6）**: cleanup は migrate-mongo 自動実行時に `throw` でデプロイを破壊するリスク、downgrade-prep は mailService のために Crowi bootstrap が必要。いずれも migrate-mongo コンテナでは実現できないため standalone スクリプトとする。

### Modified Files

```
apps/app/src/server/models/user/index.js
  — Add bcryptPassword: String to Mongoose schema
  — Update isPasswordSet() to check either field
  — Make isPasswordValid(password) async → delegates to PasswordHashService.verify()
  — Make setPassword(password) async → writes bcryptPassword via PasswordHashService.hash()
  — findUserByEmailAndPassword() → remove query-by-hash, change to fetch-then-compare
  — createUserByEmailAndPasswordAndStatus() → await setPassword()

apps/app/src/server/service/passport.ts
  — Make LocalStrategy callback async
  — Trigger lazy migration (await user.setPassword + save) when needsRehash is true

apps/app/package.json
  — Add bcryptjs to dependencies (server-side runtime, SSR reachable)
```

---

## System Flows

### ログイン時 Lazy Migration フロー

```mermaid
sequenceDiagram
    participant Client
    participant Passport as Passport LocalStrategy
    participant User as User Model
    participant PHS as PasswordHashService
    participant DB as MongoDB

    Client->>Passport: POST /login (username, password)
    Passport->>DB: findOne by username or email
    DB-->>Passport: User document
    Passport->>User: isPasswordValid(plaintext)
    User->>PHS: verify(plaintext, bcryptPassword, legacyPassword, SEED)
    alt bcryptPassword フィールドが存在
        PHS->>PHS: bcrypt.compare(plaintext, bcryptPassword)
        PHS-->>User: VerifyResult isValid needsRehash=false
    else bcryptPassword なし password フィールド存在
        PHS->>PHS: SHA256(SEED + plaintext) compare with password
        PHS-->>User: VerifyResult isValid needsRehash=true
    else 両フィールドなし
        PHS-->>User: VerifyResult isValid=false needsRehash=false
    end
    User-->>Passport: VerifyResult
    alt isValid=false
        Passport-->>Client: 401 Unauthorized
    else isValid=true and needsRehash=true
        Passport->>User: setPassword(plaintext)
        User->>PHS: hash(plaintext)
        PHS->>PHS: bcrypt.hash(plaintext, BCRYPT_COST)
        PHS-->>User: bcryptHash
        User->>DB: save bcryptPassword=bcryptHash
        Note over DB: password フィールドは保持
        Passport-->>Client: 200 OK
    else isValid=true and needsRehash=false
        Passport-->>Client: 200 OK
    end
```

### Migration Lifecycle フロー

```mermaid
flowchart TD
    A[User: password=sha256, bcryptPassword=null] -->|新バージョンで初回ログイン| B[Lazy Migration]
    B --> C[User: password=sha256, bcryptPassword=bcrypt]
    C -->|Admin: cleanup migration 実行| D{unmigrated users 存在?}
    D -->|Yes: legacyOnly > 0| E[Cleanup ABORT + 警告ログ]
    D -->|No: 全ユーザー移行済| F[Cleanup: password フィールドを unset]
    F --> G[User: password=null, bcryptPassword=bcrypt]
    G -->|Admin: downgrade-prep 実行| H[移行済みユーザー数報告]
    H -->|SEND_RESET_EMAILS=true| I[PasswordResetOrder 発行 + メール送信]
    A -->|未ログイン ダウングレード| A2[旧バージョンが password SHA256 で認証 OK]
```

---

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | 新パスワードは bcrypt cost≥12 + per-user salt | PasswordHashService | `hash()` | setPassword flow |
| 1.2 | 自己記述型フォーマット（`$2b$`プレフィックス） | PasswordHashService | `hash()` | — |
| 1.3 | 新パスワードに SHA-256+SEED を使用しない | PasswordHashService, User model | `hash()`, `setPassword()` | — |
| 1.4 | 同一平文 → 異なるハッシュ（per-user salt） | PasswordHashService | `hash()` | — |
| 2.1 | Legacy SHA-256 ユーザーがログイン継続 | PasswordHashService, Passport | `verify()` | Login flow |
| 2.2 | Legacy ログイン成功時に自動 rehash | Passport, User model | Lazy migration trigger | Login flow |
| 2.3 | 両フォーマット透過的処理 | PasswordHashService | `verify()` | Login flow |
| 2.4 | 不明フォーマット → reject + WARNING ログ | PasswordHashService | `verify()` | Login flow |
| 3.1 | Status migration: フォーマット別ユーザー数報告（読み取り専用） | Status migration script | Batch | — |
| 3.2 | Status migration: 標準出力へカウント出力 | Status migration script | Batch | — |
| 3.3 | Cleanup: 移行済みユーザーから `password` フィールド削除 | Cleanup migration script | Batch | — |
| 3.4 | Cleanup: 未移行ユーザーが残る場合は abort | Cleanup migration script | Batch | — |
| 4.1 | Downgrade prep: bcrypt 移行済みユーザー数報告 | Downgrade prep script | Batch | — |
| 4.2 | Downgrade prep: リセットメール送信オプション | Downgrade prep script, PasswordResetOrder | Batch | — |
| 4.3 | Downgrade prep: bcrypt-only ユーザーをリセット必須状態にマーク | Downgrade prep script, PasswordResetOrder | Batch | — |

---

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|-----------|-------------|--------|--------------|------------------|-----------|
| PasswordHashService | Server / Auth | bcrypt ハッシュ生成・検証・legacy 判定 | 1.1–1.4, 2.1–2.4 | bcryptjs (P0), node:crypto (P0) | Service |
| User model (password methods) | Server / Model | async パスワード操作、`bcryptPassword` フィールド | 1.1, 1.3, 2.2 | PasswordHashService (P0) | Service |
| Passport LocalStrategy | Server / Auth | async 検証、lazy migration オーケストレーション | 2.1–2.3 | User model (P0) | Service |
| Status migration script | Infrastructure | フォーマット別ユーザー数集計（読み取り専用） | 3.1, 3.2 | MongoDB (P0) | Batch |
| Cleanup migration script | Infrastructure | 移行済みユーザーから `password` フィールド削除 | 3.3, 3.4 | MongoDB (P0) | Batch |
| Downgrade prep migration script | Infrastructure | 移行済みユーザー数報告 + リセットメール発行 | 4.1–4.3 | MongoDB (P0), PasswordResetOrder (P1) | Batch |

---

### Server / Auth Layer

#### PasswordHashService

| Field | Detail |
|-------|--------|
| Intent | bcrypt ハッシュ生成と両フォーマット（bcrypt / legacy SHA-256）検証の単一責任境界 |
| Requirements | 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4 |

**Responsibilities & Constraints**

- `hash(plaintext)`: `bcrypt.hash(plaintext, BCRYPT_COST)` — 常に bcrypt、SEED は不使用
- `verify(plaintext, bcryptHash, legacyHash, passwordSeed)`:
  - `bcryptHash` が存在 → `bcrypt.compare(plaintext, bcryptHash)` → `{ isValid, needsRehash: false }`
  - `bcryptHash` が存在せず `legacyHash` が存在 → `SHA256(SEED + plaintext) === legacyHash` → `{ isValid, needsRehash: true }`
  - 両フィールドが存在しない → `{ isValid: false, needsRehash: false }`（WARNING ログ出力）
- `BCRYPT_COST`: 環境変数 `BCRYPT_COST`（デフォルト 12）から取得
- `bcryptjs` のみが `bcryptHash` を生成・検証。`node:crypto` は legacy パスのみ

**Dependencies**

- External: `bcryptjs` ^3.x — bcrypt 生成・検証（P0）
- External: `node:crypto` (built-in) — legacy SHA-256 検証（P0）
- Inbound: User model, Passport strategy（P0）

**Contracts**: Service [x]

```typescript
// apps/app/src/server/service/password-hash.ts

export interface VerifyResult {
  isValid: boolean;
  needsRehash: boolean;
}

export interface IPasswordHashService {
  hash(plaintext: string): Promise<string>;
  verify(
    plaintext: string,
    bcryptHash: string | undefined,
    legacyHash: string | undefined,
    passwordSeed: string,
  ): Promise<VerifyResult>;
}
```

- **Preconditions**: `plaintext` は非空文字列。`BCRYPT_COST` は 12 以上
- **Postconditions**: `hash()` は `$2b$` プレフィックスの bcrypt ハッシュを返す。`verify()` は必ず `VerifyResult` を返す（throw しない）
- **Invariants**: `needsRehash: true` は `isValid: true` のときのみ

**Implementation Notes**

- `BCRYPT_COST` が 12 未満の場合は起動時に WARNING ログを出力し、12 にクランプして使用（セキュリティ基準を下回る設定の検出）
- `BCRYPT_COST` が 15 を超える場合は起動時に WARNING ログを出力し、15 にクランプして使用（ログインエンドポイントの DoS リスク軽減。cost 16 以上はログイン 1 件あたり数秒超となり攻撃ベクタになりうる）
- 不明なフォーマット（両フィールドなし）は `isValid: false` を返し、WARNING レベルでユーザー ID を含むログを出力（Req 2.4）
- `bcryptjs` は SSR 実行コードから static import されるため `dependencies` に追加（Turbopack externalization rule 準拠）

---

#### User Model (password methods)

| Field | Detail |
|-------|--------|
| Intent | `PasswordHashService` への委譲 + `bcryptPassword` フィールド管理 |
| Requirements | 1.1, 1.3, 2.2 |

**Responsibilities & Constraints**

- Schema に `bcryptPassword: String` フィールドを追加
- `isPasswordSet()`: `!!(this.bcryptPassword || this.password)` で両フィールドを確認
- `isPasswordValid(password)`: async。`PasswordHashService.verify(password, this.bcryptPassword, this.password, SEED)` を呼び出す
- `setPassword(password)`: async。`bcryptPassword = await PasswordHashService.hash(password)` のみ設定。`password`（SHA-256）フィールドは変更しない（ダウングレード安全維持）
- `findUserByEmailAndPassword(email, password)`: `{ email }` のみで検索後、`isPasswordValid()` で verify。DB クエリに `password` フィールドを含まない

**Dependencies**

- Outbound: PasswordHashService — hash / verify（P0）
- External: MongoDB via Mongoose — `bcryptPassword` フィールド永続化（P0）

**Contracts**: Service [x]

```typescript
// User Mongoose document 追加メソッド（既存の .js ファイルに追加）

isPasswordSet(): boolean
isPasswordValid(password: string): Promise<VerifyResult>
setPassword(password: string): Promise<this>
updatePassword(password: string): Promise<UserDocument>
```

**Implementation Notes**

- `findUserByEmailAndPassword` の query-by-hash パターンを除去する。この変更により、同メソッドを使用する他のコードパスが存在する場合は合わせて更新が必要
- `createUserByEmailAndPasswordAndStatus` は `await setPassword()` に変更

---

#### Passport LocalStrategy

| Field | Detail |
|-------|--------|
| Intent | async 検証 + needsRehash 時の lazy migration トリガー |
| Requirements | 2.1, 2.2, 2.3 |

**Responsibilities & Constraints**

- LocalStrategy コールバックを async 化（try/catch で done(err) を保証）
- `isPasswordValid(password)` の `VerifyResult` を受け取り:
  - `isValid=false` → `done(null, false)` を返す
  - `isValid=true, needsRehash=true` → `await user.setPassword(password); await user.save()` 後に `done(null, user)` を返す
  - `isValid=true, needsRehash=false` → そのまま `done(null, user)` を返す

**Dependencies**

- Outbound: User model — `findOne`, `isPasswordValid`, `setPassword`, `save`（P0）

**Contracts**: Service [x]

```typescript
passport.use(
  new LocalStrategy(
    { usernameField, passwordField },
    async (username: string, password: string, done: StrategyCallback): Promise<void> => { ... }
  )
);
```

**Implementation Notes**

- `findUserByUsernameOrEmail` を Promise ベースに変更するか、async/await ラッパーを使用
- lazy migration の `save()` が失敗してもログイン自体は成功させる（rehash 失敗はログに記録し、次回ログイン時にリトライ可能）

---

### Infrastructure Layer (Migration Scripts)

#### Status Migration Script

| Field | Detail |
|-------|--------|
| Intent | フォーマット別ユーザー数を読み取り専用で集計・報告 |
| Requirements | 3.1, 3.2 |

**Contracts**: Batch [x]

```
Trigger: pnpm run migrate:migrate-mongo（起動時の通常マイグレーション実行）
Input: MongoDB Users コレクション（読み取りのみ）
Output: 標準出力（logger.info）へカウント出力
Idempotency: 常に読み取りのみ、何度実行しても安全
```

**カウント対象**:
- `bcryptOnly`: `{ bcryptPassword: { $exists: true }, password: { $exists: false } }` — 完全移行済み
- `both`: `{ bcryptPassword: { $exists: true }, password: { $exists: true } }` — 移行中（両フィールドあり）
- `legacyOnly`: `{ bcryptPassword: { $exists: false }, password: { $exists: true } }` — 未移行
- `noPassword`: `{ bcryptPassword: { $exists: false }, password: { $exists: false } }` — パスワード未設定

#### Cleanup Migration Script

| Field | Detail |
|-------|--------|
| Intent | 移行済みユーザー（bcryptPassword あり）から legacy `password` フィールドを削除 |
| Requirements | 3.3, 3.4 |

**Contracts**: Batch [x]

```
Trigger: 管理者が手動実行する standalone スクリプト（migrate-mongo 自動実行対象外）
  理由: abort throw がデプロイを破壊するリスクを避けるため
Input: MongoDB Users コレクション
Output: password フィールドを unset（移行済みユーザーのみ）
Idempotency: password が既に存在しないユーザーへの updateMany は no-op
```

**処理フロー**:
1. `legacyOnly` カウントを取得
2. `legacyOnly > 0` の場合: エラーメッセージ（件数含む）をログ出力して処理中断（Req 3.4）
3. `legacyOnly === 0` の場合: `User.updateMany({ bcryptPassword: { $exists: true }, password: { $exists: true } }, { $unset: { password: '' } })` を実行

**Risks**: Cleanup 実行後は `password` フィールドが消えるため、ダウングレードすると `bcryptPassword` のみのユーザーはログイン不可になる。管理者はダウングレード前に downgrade-prep スクリプトを実行する必要がある

#### Downgrade Prep Migration Script

| Field | Detail |
|-------|--------|
| Intent | ダウングレード前に移行済みユーザー数を報告し、リセットメール送信オプションを提供 |
| Requirements | 4.1, 4.2, 4.3 |

**Contracts**: Batch [x]

```
Trigger: ダウングレード前に管理者が手動実行する standalone スクリプト（Crowi bootstrap が必要）
  理由: mailService 初期化に Crowi.init() が必要なため migrate-mongo コンテナでは実行不可
Input: MongoDB Users コレクション、環境変数 SEND_RESET_EMAILS=true（省略可）
Output: 移行済みユーザー数ログ、SEND_RESET_EMAILS=true 時はリセット発行
Idempotency: カウントのみなら冪等。SEND_RESET_EMAILS=true は重複実行に注意（既存 PasswordResetOrder の確認を推奨）
```

**処理フロー**:
1. `bcryptOnly` ユーザー数（`bcryptPassword` あり、`password` なし）を集計・ログ出力（Req 4.1）
2. 環境変数 `SEND_RESET_EMAILS` が `'true'` でない場合: 警告メッセージを出力して終了
3. `SEND_RESET_EMAILS=true` の場合:
   - 対象ユーザーごとに `PasswordResetOrder` を作成（既存インフラ）
   - リセットメール送信（既存メールサービス）
   - **メール送信に成功したユーザーのみ** `bcryptPassword` フィールドを `null` に設定してログイン不可化（Req 4.3）
   - 送信失敗ユーザーは null 化しない（次回再実行でリトライ可能）
   - 成功・失敗件数を INFO/WARNING でそれぞれログ出力

---

## Data Models

### Domain Model

```
User aggregate:
  password: String | undefined        — legacy SHA-256 ハッシュ（移行期間中保持）
  bcryptPassword: String | undefined  — bcrypt ハッシュ（新フィールド）

Migration state (derived from field existence):
  - legacyOnly:  password=set,   bcryptPassword=unset  → 未移行
  - both:        password=set,   bcryptPassword=set    → 移行中（ログイン済み）
  - bcryptOnly:  password=unset, bcryptPassword=set    → 完全移行
  - noPassword:  password=unset, bcryptPassword=unset  → パスワード未設定
```

### Logical Data Model

**Schema 変更（Mongoose）**:

```javascript
// apps/app/src/server/models/user/index.js に追加
bcryptPassword: { type: String },  // bcrypt hash ($2b$12$...)
// 既存フィールド:
// password: String  — SHA-256 ハッシュ、移行期間中保持、cleanup 後に削除
```

**Index**: `bcryptPassword` フィールドにインデックス不要（パスワード検証は fetch-then-compare のため DB クエリに使用しない）

---

## Error Handling

### Error Strategy

- `PasswordHashService.verify()`: 内部エラーは呼び出し元に throw せず、`{ isValid: false, needsRehash: false }` を返す。エラーは ERROR レベルでログ記録
- Passport LocalStrategy: try/catch で全エラーを `done(err)` に渡す
- Lazy migration 失敗: rehash 保存の失敗はログに記録するが、ログイン自体は成功させる（次回ログイン時にリトライ可能）

### Error Categories

| シナリオ | 分類 | 対応 |
|---------|------|------|
| 無効な認証情報 | 401 | `done(null, false)` — 既存挙動と同じ |
| 不明フォーマットの password フィールド | 認証拒否 + WARNING ログ | Req 2.4 |
| bcryptjs ライブラリエラー | 500 → `done(err)` | エラーログ記録 |
| Lazy migration save 失敗 | ログ記録のみ | ログイン成功を継続 |
| Cleanup script: 未移行ユーザー存在 | Migration abort | エラーメッセージ + affected count ログ |

### Monitoring

- `PasswordHashService`: `needsRehash: true` 発生時に INFO レベルでログ（移行進捗の可視化）
- Passport: lazy migration 成功/失敗を INFO/ERROR でログ
- Migration scripts: 各カウントを INFO で logger 出力

---

## Testing Strategy

### Unit Tests

1. `PasswordHashService.hash()`: 返り値が `$2b$` プレフィックスで始まる、同一平文で異なるハッシュを返す（Req 1.1, 1.4）
2. `PasswordHashService.verify()`: bcrypt パス（`needsRehash=false`）、SHA-256 パス（`needsRehash=true`）、無効認証情報、両フィールドなし（`isValid=false`）のケース（Req 2.1–2.4）
3. `User.isPasswordValid()`: verify 結果を正しく委譲する
4. `User.setPassword()`: `bcryptPassword` フィールドのみ更新し `password` フィールドを保持することを確認（Req 1.3）

### Integration Tests

1. Passport LocalStrategy: legacy SHA-256 ユーザーのログイン成功 → `bcryptPassword` が書き込まれていることを確認（Req 2.1, 2.2）
2. Passport LocalStrategy: 既存 bcrypt ユーザーのログイン成功 → rehash が発生しないことを確認（Req 2.3）
3. Passport LocalStrategy: 無効な認証情報 → 401 を確認
4. Status migration script: フィールドパターン別ユーザー数が正しく集計される
5. Cleanup migration script: legacyOnly ユーザーが存在する場合は abort、全員移行済みなら `password` フィールドを削除（Req 3.3, 3.4）

### Security Tests

1. `PasswordHashService.hash()` が SHA-256 ハッシュを返さないこと（hex のみ 64 文字でないことを確認）
2. Cost factor 12 未満の設定時に起動時警告が出ることを確認

---

## Security Considerations

- **CWE-916 解消**: `PasswordHashService.hash()` は `bcrypt.hash()` のみを使用し、`crypto.createHash('sha256')` はハッシュ生成に使用しない
- **Per-user salt**: bcrypt はソルトを自動生成してハッシュに埋め込むため、追加のソルト管理が不要
- **PASSWORD_SEED の役割限定**: 移行後、`PASSWORD_SEED` は legacy SHA-256 ハッシュの検証のみに使用。新規ハッシュは `PASSWORD_SEED` に依存しない
- **Cleanup 後の PASSWORD_SEED**: 全ユーザーが `bcryptPassword` に移行し cleanup migration 実行後、`PASSWORD_SEED` は login 検証に不要。ただし既存の export `meta.json` 問題は本スコープ外
- **bcryptjs の 72 バイト制限**: 通常のパスワードポリシー（256 文字以下）では問題なし
- **ユーザー列挙タイミング攻撃（既知の制限）**: bcrypt 導入により「存在しないユーザー」は即時返却・「存在するユーザー」は ~200-400ms となり、時間差でユーザー存在を推測できる。ダミー bcrypt 比較で緩和可能だが、本スコープではログインエンドポイントのレート制限が既存か確認し、なければ別タスクで対応を検討する
- **legacy SHA-256 検証の非定数時間比較（低リスク）**: `===` は厳密な定数時間比較ではないが、ハッシュ同士の比較のため実際の攻撃リスクは極めて低い。必要であれば `crypto.timingSafeEqual` で代替可能

---

## Migration Strategy

```mermaid
flowchart LR
    A[新バージョンリリース] -->|通常デプロイ| B[Status migration 自動実行]
    B --> C[Lazy migration 開始]
    C -->|全ユーザーログイン後| D{Cleanup 実行可能?}
    D -->|legacyOnly > 0| E[Cleanup ABORT]
    D -->|legacyOnly = 0| F[Cleanup migration 実行]
    F --> G[PASSWORD_SEED 不要化]
```

- **Phase 1** (新バージョンリリース直後): Status migration 自動実行、lazy migration 開始。`PASSWORD_SEED` は引き続き必要
- **Phase 2** (移行期間): 全ユーザーがログインするまで自然に移行。Status migration で進捗確認
- **Phase 3** (任意): 全ユーザー移行確認後、管理者が Cleanup migration を含むリリースをデプロイ。`password` フィールドを削除
- **ダウングレードが必要な場合** (Phase 3 前): Downgrade prep script を実行して影響範囲を確認。必要に応じてリセットメール送信

**Rollback**: Phase 3（Cleanup）前であれば `password` フィールドが保持されているためコードロールバックで即時復旧可能。Phase 3 後は Downgrade prep script でリセットメールを送信する必要がある。
