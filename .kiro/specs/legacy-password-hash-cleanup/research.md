# Research & Design Decisions

---

## Summary

- **Feature**: `legacy-password-hash-cleanup`
- **Discovery Scope**: Extension（既存の管理画面セクションの追加。新規依存なし）
- **Key Findings**:
  - password-hash-upgrade が「新形式を書くとき旧形式を同じ保存で除去する」方針になったため、ユーザーは常に 3 区分のいずれか 1 つに属し、「両形式を持つ」状態は到達不能になった。この機能が当初持っていた削除操作は、対象になるデータが構造的に存在しなくなる
  - 残る旧形式パスワードは未移行ユーザーのものだけで、それはそのユーザーの唯一の資格情報である。管理者が消せば本人がログインできなくなるため、削除操作は提供しない
  - 一覧の外部アカウント除外を `externalaccounts.distinct('user')` + `$nin` で実装すると、連携ユーザー数に比例して配列が大きくなり、BSON の 16MB 上限を超えた環境で一覧が 500 になる
  - 分類の定義は `password-hash-format-filters.ts` に集約済みで、status migration も同じものを使う。画面と CLI の数字を一致させるには、この単一の正を参照する以外の実装をしてはならない

---

## Research Log

### 管理画面セクションの追加方法

- **Context**: セキュリティ設定にセクションを足す際の既存の型
- **Findings**:
  - `SecurityManagementContents.jsx` が設定セクションを並べる構成で、セクション単位の追加・非表示が可能
  - 管理者向け apiv3 ルートは `accessTokenParser` → `loginRequiredStrictly` → `adminRequired` の順で固定（`security-settings/index.js`）
  - 管理画面のサーバーデータ取得は SWR（`~/stores/admin/*`）に集約されている
- **Implications**: 新しい構成を作らず、既存のセクション追加の型にそのまま乗せる

### 分類の定義をどこに置くか

- **Context**: 画面の件数と status migration の件数が食い違わないようにする方法
- **Findings**:
  - `password-hash-format-filters.ts` が `upgradedOnlyFilter` / `legacyOnlyFilter` / `noPasswordFilter` と `activeUserFilter` / `nonActiveUserFilter` を公開しており、status migration が参照している
  - フィールドは「存在し、かつ空でない」ときだけ PRESENT と数える。`password: ''` に退避された削除済みユーザーは `noPassword` に数えられる
- **Implications**: 件数サービスは条件を書き写さず、このフィルタを参照する

### 未移行ユーザー一覧のクエリ

- **Context**: 「旧形式のみ、かつ外部アカウントと連携していない」ユーザーを、最終ログインの新しい順に返す方法
- **Findings**:
  - `externalaccounts` は `user` でユーザーを参照する。除外は (a) `distinct('user')` の結果を `$nin` に渡す (b) `$lookup` + `$match` の 2 通り
  - (a) は中間結果をアプリケーション側に載せるため、連携ユーザーが多い環境で BSON 16MB 上限に当たる
  - `lastLoginAt` は同値・欠損が起きるため、単独キーの並びではページ送りで行の重複・欠落が起こる
  - 未移行者は定義上ログインしていないため `lastLoginAt` が古いか欠損しており、全ユーザー対象の `lastLoginAt` 索引では降順走査の最後尾に来る
- **Implications**: 除外は `$lookup`、並びは `lastLoginAt` + `_id`、走査の限定は旧形式保持者のみを含む部分索引で行う

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Assessment |
|--------|-------------|-----------|---------------------|------------|
| 件数 + 一覧 + 削除操作 | 移行状況を見せ、移行済みユーザーの旧形式を一括削除できるようにする | シェルに入れない管理者が弱いハッシュを自分で消せる | 上位 spec の方針変更により削除対象が存在しない。残る旧形式は未移行者の唯一の資格情報で、消せばログイン不能になる | 却下 |
| 件数 + 一覧（読み取りのみ） | 進み具合と、催促すべき相手を見せる | 取り消し不能な操作を持たないため、確認ダイアログ・監査記録・二重実行防止が不要になる | 旧形式を能動的に減らす手段は提供しない（催促は管理者の運用） | **採用** |
| 件数のみ | 件数表だけを出す | 最小 | 人数だけでは管理者が動けない（誰に連絡すればよいか分からない） | 却下 |

---

## Design Decisions

### Decision: 削除操作を提供しない

- **Context**: password-hash-upgrade がログイン・設定・変更・リセットのすべてで旧形式を同時に除去する方針になった
- **Alternatives Considered**:
  1. 移行済みユーザーの旧形式を一括削除する操作を残す
  2. 削除操作を持たず、状況の可視化に徹する（採用）
- **Selected Approach**: 2
- **Rationale**: 1 の削除対象（両形式を持つユーザー）は構造的に存在しなくなる。残る旧形式は未移行ユーザーのものだけで、それが唯一の資格情報であるため削除はログイン不能を意味する
- **Trade-offs**: 弱いハッシュを管理者の操作で減らす手段は無くなる。減らすには本人のログインかパスワードリセットが必要で、その相手を示すのが一覧の役割になる

### Decision: 件数は 3 区分とし、「両形式」を持たない

- **Context**: 当初は 4 区分（新形式のみ / 両形式 / 旧形式のみ / 未設定）だった
- **Selected Approach**: `upgradedOnly` / `legacyOnly`（アクティブと非アクティブの内訳つき） / `noPassword` の 3 区分
- **Rationale**: 新形式を保存するリリースは旧形式を必ず除去し、旧バージョンは新形式を保存しないため、両形式を同時に持つユーザーは存在しない
- **Follow-up**: 本 spec の作業は `PasswordHashFormatCounts` から `both` を外すところまで。区分の集合を定義しているのは親 spec（Requirement 3.1）であり、status migration を 3 区分に合わせる作業は親 spec の tasks に属する

### Decision: 外部アカウントの除外は `$lookup` で行う

- **Context**: 一覧の抽出で、外部アカウントと連携しているユーザーを除く必要がある
- **Alternatives Considered**:
  1. `externalaccounts.distinct('user')` の結果を `$nin` に渡す
  2. `$lookup` + `$match` で結合する（採用）
- **Rationale**: 1 は連携ユーザー数に比例して中間配列が大きくなり、BSON 16MB 上限を超えると一覧が 500 になる。2 は中間結果をアプリケーション側に載せない
- **Trade-offs**: 結合のぶんクエリは複雑になるが、一覧は管理者が開いたときだけ実行される低頻度の読み取りである

### Decision: 並び順の第 2 キーに `_id` を加える

- **Rationale**: `lastLoginAt` は同値・欠損が起きるため、単独キーではページ送りで行が重複・欠落する
- **Follow-up**: ページを跨いだ重複・欠落が起きないことをテストで担保する

### Decision: 旧形式保持者のみの部分索引を用意する

- **Rationale**: 全ユーザー対象の `lastLoginAt` 索引では、未移行者が降順走査の最後尾に来るため、1 ページ目を埋めるだけで実質全件を読む
- **Trade-offs**: 索引が 1 つ増える。移行が完了すれば対象行は 0 件に近づくため、索引自体も小さくなる
- **制約**: `partialFilterExpression` は `$exists: false` を受け付けないため、条件は `{ password: { $exists: true } }` とする。両形式を同時に持つユーザーが存在しないため、これは旧形式保持者と一致する
- **Follow-up**: 索引の作成は migrate-mongo のマイグレーションで行う。`.claude/rules/model.md` の文面（索引作成は Mongoose が持つ）とは一見食い違うが、その趣旨は Prisma へ早期に移さないことであり、マイグレーションで索引を作る前例は既にある（auditlog の unique index）。Mongoose スキーマに `partialFilterExpression` を書いた前例は無い

### Decision: 件数と一覧のエラー状態を分ける

- **Rationale**: 一覧の失敗が件数表を巻き込まないことを要件が求めている（7.8）。状態を 1 つにまとめると、片方の失敗で両方が消える
- **Follow-up**: 「取得中なので出さない」と「失敗して分からない」を区別する（8.3 と 8.4）

### Synthesis

- **一般化**: Req 1（件数）と Req 7（一覧）は「まだ旧形式を持っているのは誰か」という同じ問いの粒度違いであり、1 つのセクションの 2 つの読み取りとして構成する
- **Build vs Adopt**: 分類は既存の `password-hash-format-filters.ts`、結合は MongoDB の `$lookup`、取得は既存の SWR 規約を採用し、独自実装を作らない
- **単純化**: 削除操作を外した結果、確認ダイアログ・監査ログ action・二重実行防止・成功メッセージ・削除フックが不要になった。残るのは読み取り 2 本と表示のみで、書き込み経路を持たない

---

## Risks & Mitigations

- **旧形式が永久に残る** — 外部認証のみのユーザー・非アクティブなユーザー・戻ってこないユーザーは移行しない。この機能は減らす手段を持たないため、残存数の可視化と催促対象の特定までが守備範囲になる（`PASSWORD_SEED` もその間は外せない）
- **一覧に個人情報が載る** — ユーザー名・メールアドレス・最終ログイン日時を返すため、管理者専用であることをミドルウェア連鎖で担保する。パスワードとハッシュの値は射影にもレスポンスにも含めない
- **分類の定義がずれる** — 件数の条件をサービス側に書き写すと、CLI と画面の数字が食い違う。単一の正を参照する実装から外れていないかをレビューで確認する

---

## References

- `password-hash-upgrade` spec（Requirement 1.5 / 2.2 が旧形式の除去を規定、Requirement 4 がダウングレードの方針）
- `apps/app/src/server/models/user/password-hash-format-filters.ts`（分類の単一の正）
- PR #12145 レビュー（2026-10-29）— 削除機能の撤去、残す機能、性能上の指摘
