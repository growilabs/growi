# 開発時動作確認手順（Claude 自律実行用）

> **目的**: GROWI Vault の結合動作（apps/app + vault-manager + git clone）を Claude が単独で再現・検証するための運用手順。`/kiro-debug` 等で再診断・回帰確認する際にこのファイルを参照する。
>
> **対象**: 開発環境（devcontainer + 既存の docker-compose mongo）。本番デプロイ手順ではない。
>
> **関連 spec**:
> - 公開ゲートウェイ側（apps/app）— `growi-vault-gateway`
> - 内部マイクロサービス側（apps/growi-vault-manager）— `growi-vault-manager`

---

## 前提知識（誤解しやすいポイント）

1. **clone URL は必ず apps/app 側（port 3000）**
   - `/_vault/repo.git` は `apps/app` の Express ルータ [routes/index.js](../../../apps/app/src/server/routes/index.js#L75) に mount されており、port **3000** でのみ提供される。
   - `apps/growi-vault-manager`（port 3001）が公開するのは `/internal/git/...` だけで、`/_vault/repo.git` は存在しない（404）。`Authorization: Bearer <SECRET>` 必須の内部 API のため git クライアントから直接叩けない。
2. **PAT が原則必須**
   - `/_vault/repo.git` は HTTP Basic Auth の **password** 欄に PAT を要求する（username 部は無視）。
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
git clone "http://x:${TOKEN}@localhost:3000/_vault/repo.git" /tmp/mygrowirepos
ls /tmp/mygrowirepos
```

期待: ページ階層を反映したファイル群（例: `Sandbox/Markdown.md` など）が展開される。

`fatal: the remote end hung up unexpectedly` で止まった場合は次節へ。

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
