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

---

## 結合試験（integ テスト）の手動実行手順

`apps/app/src/features/growi-vault/__tests__/` 配下の integ テストは `describe.skip` のまま運用する。
Vitest CI では何も実行されない（正式承認済み — `growi-vault-gateway` タスク 23.2 選択肢 B）。
以下の手動手順がタスク 14.1 / 14.2 / 18.3 の完了基準に相当する。

### clone-e2e.integ.ts の手動確認（タスク 14.1 / 18.3）

**前提**: 起動手順に従って apps/app + vault-manager + MongoDB を起動済みで、PAT が seed 済みであること。

```bash
# describe.skip を一時的に describe に変更して実行
# または GROWI_TEST_PAT / GROWI_TEST_URL をエクスポートした上で vitest run を使用
export GROWI_TEST_URL="http://localhost:3000"
export GROWI_TEST_PAT="${TOKEN}"   # PAT seed で得たトークン
cd /workspace/growi-vault/apps/app
pnpm vitest run clone-e2e.integ --reporter verbose
```

**確認項目**:
- 有効 PAT で `git clone` が成功し、クローンディレクトリに `.md` ファイルが 1 件以上存在すること
- 無効 PAT で clone が失敗（認証エラー）すること
- null-revision ページ（中間パス自動生成）がクローン結果に含まれないこと（タスク 18.3）

### vault-gateway.integ.ts の手動確認（タスク 14.2 / 18.3）

**前提**: `GROWI_ADMIN_TOKEN` が設定済みであること。

```bash
export GROWI_TEST_URL="http://localhost:3000"
export GROWI_TEST_PAT="${TOKEN}"
export GROWI_ADMIN_TOKEN="${ADMIN_TOKEN}"
cd /workspace/growi-vault/apps/app
pnpm vitest run vault-gateway.integ --reporter verbose
```

**手動補完が必要なシナリオ**:

**Scenario 2（bootstrapState=running）**: このシナリオは自動化できない。以下の手順で手動検証する:

1. MongoDB で bootstrapState を強制的に `'running'` に設定:
   ```js
   db.vault_sync_state.updateOne(
     { _id: 'singleton' },
     { $set: { bootstrapState: 'running' } },
     { upsert: true }
   );
   ```
2. `/_vault/repo.git/info/refs?service=git-upload-pack` にリクエストを送り、503 + `Retry-After` ヘッダーが返ることを確認
3. `git clone http://x:${TOKEN}@localhost:3000/_vault/repo.git /tmp/test` が失敗することを確認
4. bootstrapState を `'done'` に戻す:
   ```js
   db.vault_sync_state.updateOne({ _id: 'singleton' }, { $set: { bootstrapState: 'done' } });
   ```

**Scenario 6（coalesce behaviour）**: vault_instructions の検証は MongoDB 直接読み取りで行う:

1. 150 ページを `/test-coalesce` 配下に一括作成:
   ```bash
   for i in $(seq 0 149); do
     curl -s -X POST "${BASE_URL}/_api/v3/page" \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer ${ADMIN_TOKEN}" \
       -d "{\"path\": \"/test-coalesce/page-${i}\", \"body\": \"# Page ${i}\"}" > /dev/null
   done
   ```
2. 1.5 秒待機後、MongoDB で bulk-upsert instruction の存在を確認:
   ```js
   db.vault_instructions
     .find({ 'payload.namespace': '/test-coalesce' })
     .sort({ issuedAt: -1 })
     .limit(10)
     .toArray();
   ```
   期待: `op === 'bulk-upsert'` のドキュメントが 1 件以上、`op === 'upsert'` が 0 件。

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

4. bootstrap 完了後、`git clone http://x:<PAT>@<host>/_vault/repo.git` が成功してファイル一覧が取得できることを確認する。
   また、`vault_user_views.<viewRef>.mergedTreeOid` が `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（empty tree SHA）以外の値になっていることを確認する:
   ```js
   db.vault_user_views.find({}, { mergedTreeOid: 1 }).toArray();
   ```

### rename / grant 一括変更後に vault の内容が古くなる（MVP 既知制限）

**背景**: MVP では親ページの rename および grant 一括変更の伝播が未実装（`growi-vault-gateway` タスク 21.2 / P1 future work）。

- **rename 操作**: `pageEvent.emit('syncDescendantsUpdate')` が発火されるが、vault-dispatcher は旧パス prefix を取得できないため `rename-prefix` instruction を発行せず WARN ログを出力する（no-op）。
- **grant 一括変更**: `grant-change-prefix` instruction を発行するイベント経路が存在しない（no-op）。

**症状**: rename または grant 一括変更後、`git fetch` を実行しても変更が反映されない（または古い namespace で参照される）。

**回避手順**: 以下の手順で vault を再初期化する。

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

> **Note**: rename / grant 一括変更の自動伝播は P1 フューチャーワーク（`growi-vault-gateway` タスク 21.1）として追跡される。実装完了後は本手動手順は不要になる。

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
