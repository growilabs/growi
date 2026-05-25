# 開発時動作確認手順（ローカルデバッグ専用）

> ## ⚠️ このドキュメントは「タスク完了基準」ではない
>
> このファイルは **ローカルで手動デバッグするときに参照する手順書** である。
> 以下の用途で利用してはいけない:
>
> - タスク完了の根拠（`/kiro-verify-completion` などの完了判定）
> - 回帰検出 — 手動手順は走らないことを前提に設計せよ
> - リリース前の検証 — CI が緑であることが唯一の合格判定
>
> GROWI Vault の**回帰検出はすべて CI に集約される**:
>
> - 単体テスト: `apps/app/src/features/growi-vault/**/*.spec.ts`、`apps/growi-vault-manager/src/**/*.spec.ts`（CI で常時実行）
> - 統合テスト: `apps/app/src/features/growi-vault/__tests__/*.integ.ts`、`apps/growi-vault-manager/src/__tests__/*.integ.ts`（CI で常時実行、`describe.skip` 禁止）
>
> 「`describe.skip` で運用する」「`/kiro-spec-tasks` で承認済み」のような形で
> 回帰検出を放棄する判断は本ドキュメントの責任範囲外であり、無効である。

> **目的（このファイルが助ける範囲）**: ローカルで `git clone` が動かない・bootstrap が止まる等の症状を診断するときに、デバッグ手順を素早く再現するための備忘録。
>
> **対象**: devcontainer 上でのインタラクティブ調査。本番デプロイ手順ではない。
>
> **関連 spec**:
> - 公開ゲートウェイ側（apps/app）— `growi-vault-gateway`
> - 内部マイクロサービス側（apps/growi-vault-manager）— `growi-vault-manager`

---

## 前提知識（誤解しやすいポイント）

1. **clone URL は必ず apps/app 側（port 3000）**
   - `/vault.git` は `apps/app` の Express ルータ [routes/index.js](../../../apps/app/src/server/routes/index.js#L75) に mount されており、port **3000** でのみ提供される。
   - `apps/growi-vault-manager`（port 3001）が公開するのは `/internal/git/...` だけで、`/vault.git` は存在しない（404）。`Authorization: Bearer <SECRET>` 必須の内部 API のため git クライアントから直接叩けない。
2. **PAT が原則必須**
   - `/vault.git` は HTTP Basic Auth の **password** 欄に PAT を要求する（username 部は無視）。
   - 匿名でも `public` namespace へのアクセスは設計上許容されるが、認証経路の動作確認のため通常は PAT を seed する。
   - PAT には `read:features:page` スコープが必須（[vault-pat-auth.ts:112](../../../apps/app/src/features/growi-vault/server/middlewares/vault-pat-auth.ts#L112)）。
3. **bootstrap 完了が必要**
   - `vault_sync_state.bootstrapState === 'done'` かつ `vault_user_views.<viewRef>.mergedTreeOid !== '4b825dc6...'`（git の empty tree SHA）であること。
   - empty tree のままなら bootstrap は走ったが instruction が失敗している。トラブルシュート節を参照。
4. **`pnpm dev:vault-manager` は package ディレクトリで実行**
   - ルート `package.json` には alias が無い。`cd apps/growi-vault-manager && pnpm dev:vault-manager` または `pnpm --filter @growi/vault-manager dev:vault-manager` を使う。

## 起動手順

```bash
# 1. 依存インストール（初回のみ）
pnpm install --frozen-lockfile

# 2. vault-manager（port 3001）— 必ず apps/growi-vault-manager 内で
(cd apps/growi-vault-manager && pnpm dev:vault-manager) > /tmp/vault-manager.log 2>&1 &

# 3. apps/app（port 3000）
turbo run dev --filter @growi/app > /tmp/apps-app.log 2>&1 &

# 4. listen 確認（devcontainer では mongo:27017 経由で MongoDB を参照する）
until (echo > /dev/tcp/mongo/27017) 2>/dev/null; do sleep 2; done
until (echo > /dev/tcp/127.0.0.1/3001) 2>/dev/null; do sleep 2; done
until (echo > /dev/tcp/127.0.0.1/3000) 2>/dev/null; do sleep 2; done
```

apps/app の dev server は packages の vite build を待つため初回起動に 30〜60 秒かかる。`grep "Express server is listening" /tmp/apps-app.log` で起動完了を判定する。

## PAT seed

`apps/app/src/server/models/access-token.ts` は `tokenHash = sha256(token)` で保存する。Basic Auth の password 検証は `findUserIdByToken(pat, ['read:features:page'])` でスコープ込み照会するため、最低 `read:features:page` を含めること。

スクリプトは **apps/app 配下に置いて実行**（mongoose を resolve するため）:

```js
// apps/app/vault-seed-pat.mjs（一時ファイル。実行後は削除）
import crypto from 'node:crypto';
import mongoose from 'mongoose';

await mongoose.connect(
  process.env.MONGO_URI ?? 'mongodb://mongo:27017/growi?replicaSet=rs0',
);
const db = mongoose.connection.db;

const admin = await db.collection('users').findOne({ username: 'admin' });
if (admin == null) throw new Error('admin user not found');

const token = process.env.SEED_PAT ?? crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

// 冪等性: 既存の seed PAT を一旦消す
await db.collection('accesstokens').deleteMany({ description: 'vault-integ-seed' });
await db.collection('accesstokens').insertOne({
  user: admin._id,
  tokenHash,
  expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  scopes: ['read:features:page'],
  description: 'vault-integ-seed',
});

console.log(JSON.stringify({ token, userId: admin._id.toString() }, null, 2));
await mongoose.disconnect();
```

実行: `cd apps/app && node vault-seed-pat.mjs`

## 動作確認

```bash
# Basic Auth の username 部は実装上無視されるので任意（"x" など）
git clone "http://x:${TOKEN}@localhost:3000/vault.git" /tmp/mygrowirepos
ls /tmp/mygrowirepos
```

期待: ページ階層を反映したファイル群（例: `Sandbox/Markdown.md` など）が展開される。

`fatal: the remote end hung up unexpectedly` で止まった場合は次節へ。

---

## 結合試験（integ テスト）の実行

> **回帰検出は CI に集約済み**。下記の手動手順は CI が再現できない症状を**ローカルで掘り下げる**ためだけに使う。
> 「integ テストを手動で走らせて OK だった」はタスク完了の根拠にはならない。

CI で走る integ テストは以下:

- `apps/app/src/features/growi-vault/__tests__/clone-e2e.integ.ts` — 公開ゲートウェイの clone 契約
- `apps/app/src/features/growi-vault/__tests__/vault-gateway.integ.ts` — gateway の状態遷移・read-only・ACL・coalesce・null-revision regression
- `apps/growi-vault-manager/src/__tests__/*.integ.ts` — vault-manager 内部契約

これらは `apps/app/test/setup/vault-e2e/global-setup.ts` が `vault-manager` を子プロセス起動・Express にゲートウェイをマウント・ユーザー/PAT を seed する仕組みで動く。`describe.skip` は禁止。

### ローカルで integ テストを再現する

```bash
# apps/app から
pnpm vitest run --project app-integration vault
```

実行時の MongoDB は `globalSetup`（mongo-memory-server）が自動起動するので、devcontainer の `mongo:27017` には依存しない。

### CI で失敗した integ テストをデバッグする

CI のログだけでは原因が掴めないとき、ローカルで対象テストだけを反復実行する:

```bash
# 1 ファイルを 10 回繰り返してフレーキー検出
pnpm vitest run vault-gateway.integ --repeat=10
```

`globalSetup` がログを `/tmp/vault-e2e/*.log` に出すので、vault-manager の startup ログ・apps/app のリクエストログを確認できる。

---

## トラブルシュート

### `the remote end hung up unexpectedly` で clone が止まる

1. **vault-manager log** で `git upload-pack exited with code 1` を検索:
   ```bash
   grep "exited with code" /tmp/vault-manager.log
   ```
2. `vault_instructions` の失敗状況を MongoDB で確認:
   ```js
   const stuck = await db.collection('vault_instructions')
     .find({ processedAt: null }).toArray();
   stuck.forEach(i => console.log({
     op: i.op,
     ns: i.payload?.namespace,
     entries: i.payload?.entries?.length,
     attempts: i.attempts,
     lastError: i.lastError,
   }));
   ```
3. **代表的な lastError パターン**:
   - `Cast to ObjectId failed for value "" (type string) at path "_id" for model "Revision"`
     → null revision page の `revisionId: ''` が混入。**`growi-vault-gateway` タスク 18** および **`growi-vault-manager` タスク 13** が未適用の可能性。修正適用後に下記「state リセット手順」で再実行する。
4. `vault_user_views` を確認:
   ```js
   const views = await db.collection('vault_user_views').find({}).toArray();
   ```
   `mergedTreeOid` が `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（git の empty tree SHA）のままなら、当該 viewRef の materialise が一度も成功していない。

### state リセット手順

bootstrap が `failed` または instruction 残骸が残っている環境を初期化する:

```js
// apps/app から
await db.collection('vault_instructions').deleteMany({ processedAt: null });
await db.collection('vault_sync_state').updateOne(
  { _id: 'singleton' },
  {
    $set: {
      bootstrapState: 'pending',
      bootstrapCursor: null,
      bootstrapProcessed: 0,
    },
  },
);
```

その後 `apps/app/.env.development.local` に `VAULT_BOOTSTRAP_ON_START=true` を追加して apps/app を再起動するか、admin UI から bootstrap を再実行する。

### null revision ページ起因の "Cast to ObjectId failed" 修復手順（管理者向けマイグレーション）

**症状**: GROWI が自動生成する中間パスページ（`/user`、`/empty` 等、`revision` フィールドなし）が bootstrap 中に
`revisionId: ''` として instruction に積まれ、vault-manager 側で `Cast to ObjectId failed for value "" at path "_id"` が発生。
該当 instruction が `attempts >= 5` まで失敗し続け、`git clone` が `the remote end hung up unexpectedly` で停止する。

**前提条件**: 以下の修正が両サービスに適用済みであること:
- `growi-vault-gateway` タスク 18.1/18.2 — bootstrapper と dispatcher が null revision ページをスキップ
- `growi-vault-manager` タスク 13.1/13.2 — `bodyQueryByIds` が invalid ObjectId をフィルタ

**修復手順**:

1. 詰まった instruction を削除する（`attempts >= 1` かつ未処理のもの）:
   ```js
   db.vault_instructions.deleteMany({ processedAt: null, attempts: { $gte: 1 } });
   ```

2. bootstrap state をリセットする:
   ```js
   db.vault_sync_state.updateOne(
     { _id: 'singleton' },
     {
       $set: {
         bootstrapState: 'pending',
         bootstrapCursor: null,
         bootstrapProcessed: 0,
       },
     },
   );
   ```

3. `VAULT_BOOTSTRAP_ON_START=true` で apps/app を再起動するか、admin UI (`/admin/vault`) から "Prepare GROWI Vault" を実行する。

4. bootstrap 完了後、`git clone http://x:<PAT>@<host>/vault.git` が成功してファイル一覧が取得できることを確認する。
   また、`vault_user_views.<viewRef>.mergedTreeOid` が `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（empty tree SHA）以外の値になっていることを確認する:
   ```js
   db.vault_user_views.find({}, { mergedTreeOid: 1 }).toArray();
   ```

### rename / grant 一括変更の vault 伝播（MVP Stage 2 完了で自動化済み）

**背景**: タスク 21.1-A（Stage 1）および 21.1-B（Stage 2）の完了により、rename / grant 一括変更は GROWI core から vault へ自動伝播するようになった。本セクションは過去の運用回避手順を残しつつ、現在の自動伝播経路を記録する。

| 操作 | 伝播経路（実装済み） |
|---|---|
| 単一ページ rename | `pageEvent.emit('rename', { page, oldPath, newPath, user })` → vault subscriber が `rename-prefix` instruction を namespace 数ぶん発行 |
| 子孫ページ一括 rename | `pageEvent.emit('updateMany', pages, user, { oldPagePathPrefix, newPagePathPrefix })` → vault subscriber が影響 namespace 集合を de-dup して `rename-prefix` を 1 件 / namespace 発行 |
| 親ページ grant 一括変更 | `updateChildPagesGrant` 内 `Page.bulkWrite()` 直後に `pageEvent.emit('descendantsGrantChanged', { affectedPages, user })` → vault subscriber が per-page `acl-change` instruction（remove + upsert）を発行 |

**手動 bootstrap 再実行が依然必要なケース**:
- 既存 vault が Stage 2 リリース以前の状態でリレジリエンスが取れていない場合（初回マイグレーション扱い）
- vault-manager 側で instruction 処理が失敗してリトライ上限を超えた場合（`vault_instructions.attempts >= 5` のドキュメントが残っている等）

**手動回避手順**（必要時のみ）:

1. bootstrap state をリセットする:
   ```js
   db.vault_sync_state.updateOne(
     { _id: 'singleton' },
     {
       $set: {
         bootstrapState: 'pending',
         bootstrapCursor: null,
         bootstrapProcessed: 0,
       },
     },
   );
   ```

2. `VAULT_BOOTSTRAP_ON_START=true` で apps/app を再起動するか、admin UI (`/admin/vault`) から "Prepare GROWI Vault" を実行する。

3. bootstrap 完了後（`bootstrapState === 'done'`）、`git fetch` または `git clone` で最新内容が反映されることを確認する。

> **Note**: 通常運用では本手動手順は不要。rename / grant 一括変更は GROWI core からの emit によって vault 側に自動伝播される。`syncDescendantsUpdate` の WARN ログは Stage 1 で警告メッセージを出していたが、Stage 2 完了に伴い debug ログに格下げされた（`'updateMany'` で吸収済みのため）。

---

### 起動コマンドが ENOENT/script not found で失敗する

ルート `package.json` に `dev:vault-manager` の alias は無い。必ず以下のいずれかを使う:

- `cd apps/growi-vault-manager && pnpm dev:vault-manager`
- `pnpm --filter @growi/vault-manager dev:vault-manager`（リポジトリルートから）

## クリーンアップ

セッション終了時:

```bash
# 1. プロセス停止
pkill -9 -f "growi-vault|cross-env|@swc-node|@growi/app:|nodemon|turbo.*dev|vite\b"

# 2. seed PAT 削除（apps/app から）
node -e "
const m = await import('mongoose');
await m.default.connect('mongodb://mongo:27017/growi?replicaSet=rs0');
await m.default.connection.db.collection('accesstokens').deleteMany({ description: 'vault-integ-seed' });
await m.default.disconnect();
" --input-type=module

# 3. clone 結果と一時 seed スクリプトを削除
rm -rf /tmp/mygrowirepos
rm -f apps/app/vault-seed-pat.mjs apps/app/vault-mongo-inspect.mjs
```

## 関連エビデンス（過去に確認済みの事実）

- 50 ページ規模の dev fixture では、階層整合性のため自動生成される **revision を持たないページが 9 件** 存在する（例: `/user`、`/empty`、`/user/<name>/メモ/2025/12` 等）。これらが `growi-vault-gateway` タスク 18 のテスト fixture の根拠。
- vault-manager の `RevisionModel.bodyQueryByIds` は `find({_id: {$in: ids}}, {body}).cursor()` を発行する（[revision.ts:74-79](../../../apps/growi-vault-manager/src/models/revision.ts#L74-L79)）。`$in` 配列に空文字列が 1 件でも混じると配列全体のキャストが throw する。
- 検証用ベース URL は `apps/growi-vault-manager/src/__tests__/clone-e2e.integ.ts` 等のインテグレーションテストでも `http://localhost:3001` がデフォルトだが、これは vault-manager の **内部 API** に対する E2E テストである点に注意（`/internal/git/info/refs` を Bearer 認証で直接叩く）。本ドキュメントの手動 clone 手順とは別物。
