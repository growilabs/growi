# 実装計画

## タスク概要

本計画は `apps/growi-vault-manager` の実装タスクを依存関係順に整理したものである。アプリスケルトンの構築から始まり、データモデル、ストレージ抽象・パスユーティリティ、instruction builder、view composer、HTTP コントローラ、watcher、メンテナンスの順で実装する。`@growi/core` の Vault DTO 型は `growi-vault-gateway` spec が主導するため、本 spec は import するのみ（タスク内の境界注記に明示）。

---

- [x] 1. アプリスケルトンと開発環境構築
- [x] 1.1 `apps/growi-vault-manager` の Ts.ED + TypeScript プロジェクト scaffold (P)
  - `package.json`（Ts.ED v7.x / isomorphic-git v1.37.x / mongoose / @growi/core / @growi/logger 依存）を作成する
  - `tsconfig.json`（strict: true）を作成する
  - `src/server.ts`（Ts.ED bootstrap・DI container）を作成する
  - `pnpm install` 後に `pnpm build` が通ること
  - _Requirements: 10.1, 10.4_
  - _Boundary: apps/growi-vault-manager/package.json, tsconfig.json, src/server.ts_

- [x] 1.2 Dockerfile と docker-compose 統合 (P)
  - `Dockerfile`（node + git binary v2.30+ 同梱、`apk add git`）を作成する
  - `docker-compose.yml` に vault-manager サービスと共有 volume の定義を追加する
  - `docker build` が成功し、コンテナ内で `git --version` が `2.30` 以上を返すこと
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/Dockerfile, docker-compose.yml_

- [x] 1.3 Turborepo タスク設定と pnpm workspace 登録 (P)
  - ルート `turbo.json` に vault-manager の `build` / `dev` / `test` タスクを追加する
  - `turbo run build --filter @growi/vault-manager` が通ること
  - _Requirements: 10.4_
  - _Boundary: turbo.json, pnpm-workspace.yaml_

---

- [x] 2. Mongoose データモデル
- [x] 2.1 `vault_instructions` Mongoose model（read + processedAt 更新）
  - `src/models/vault-instruction.ts` を作成する
  - change stream watch・`processedAt` / `attempts` / `lastError` の書き込みメソッドを実装する
  - TTL index（`processedAt: 1, expireAfterSeconds: 86400`）と検索インデックス（`processedAt: 1, issuedAt: 1`）の定義を含む
  - `vault_instructions.find({ processedAt: null }).cursor()` が動作すること
  - _Requirements: 1.1–1.6_
  - _Boundary: apps/growi-vault-manager/src/models/vault-instruction.ts_

- [x] 2.2 `revisions` 読み取り専用 Mongoose model（ID lookup 専用）
  - `src/models/revision.ts` を作成する
  - `_id` と `body` フィールドのみ含む read-only schema
  - `findOne({_id: revisionId}, {body})` と `find({_id: {$in: ids}}, {body}).cursor()` が動作すること
  - _Requirements: 2.1, 2.2_
  - _Boundary: apps/growi-vault-manager/src/models/revision.ts_

- [x] 2.3 `vault_namespace_state` Mongoose model（owned）
  - `src/models/vault-namespace-state.ts` を作成する
  - `namespace` / `commitOid` / `version` / `updatedAt` フィールドと unique インデックス（`namespace: 1`）を定義する
  - `upsert({ namespace, commitOid, version: ++ })` が正しく動作すること
  - _Requirements: 2.1, 4.2_
  - _Boundary: apps/growi-vault-manager/src/models/vault-namespace-state.ts_

- [x] 2.4 `vault_user_views` Mongoose model（owned）
  - `src/models/vault-user-view.ts` を作成する
  - `userId` / `viewRef` / `viewCommitOid` / `mergedTreeOid` / `sourceVersions` / `composedAt` フィールドと sparse unique インデックス（`userId: 1`）を定義する
  - `upsert` の動作が正しいこと
  - _Requirements: 4.2–4.8_
  - _Boundary: apps/growi-vault-manager/src/models/vault-user-view.ts_

- [x] 2.5 `vault_sync_state` Mongoose model（resumeToken / watcher fields のみ書き込み）
  - `src/models/vault-sync-state.ts` を作成する
  - singleton doc（`_id: 'singleton'`）で `resumeToken` / `lastProcessedAt` / `watcherInstanceId` の書き込みと `bootstrapState` の read のみを実装する
  - `vault_sync_state.findOne({_id: 'singleton'})` が動作し `resumeToken` を返すこと
  - _Requirements: 1.1_
  - _Boundary: apps/growi-vault-manager/src/models/vault-sync-state.ts_

---

- [x] 3. ストレージ抽象とパスユーティリティ
- [x] 3.1 `VaultRepoStorage` の実装
  - `src/services/vault-repo-storage.ts` を作成する
  - `init()`（bare repo が存在しなければ `git init --bare`、冪等）を実装する
  - isomorphic-git の `writeBlob` / `writeTree` / `writeCommit` / `readTree` を薄くラップする
  - `updateRef` / `readRef` / `deleteRef` を POSIX atomic rename ベースで実装する
  - 同一 OID が既存の場合は no-op（content-addressed skip）
  - `getRepoPath()` が環境変数 `VAULT_REPO_PATH` から共有 fs の bare repo パスを返すこと
  - _Requirements: 9.1–9.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-repo-storage.ts_

- [x] 3.2 `VaultBlobHasher` の実装
  - `src/services/vault-blob-hasher.ts` を作成する
  - isomorphic-git の `hashObject({ type: 'blob', object })` を利用して 40-char SHA-1 OID を返す
  - 同一内容で同一 OID を返すこと（ユニットテストで確認）
  - _Requirements: 2.1, 2.2_
  - _Boundary: apps/growi-vault-manager/src/services/vault-blob-hasher.ts_

- [x] 3.3 `VaultPathMapper` の実装
  - `src/services/vault-path-mapper.ts` を作成する
  - `map(pagePath, pageId)` を実装する（Windows 予約文字 `%XX` エンコード・予約ファイル名 `_` プレフィックス・大文字 suffix `__<hash8>`・orphan `_orphaned/`）
  - `mapPrefix(pagePath)` を実装する（ディレクトリ prefix、末尾 `.md` なし）
  - 同一入力で常に同一出力を返すこと（純関数ユニットテスト）
  - _Requirements: 3.1–3.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-path-mapper.ts_

- [x] 3.4 VaultPathMapper のユニットテスト
  - `src/services/vault-path-mapper.spec.ts` を作成する
  - 特殊文字エンコーディング・予約ファイル名・大文字 suffix・orphan 配置の各ケースをテストする
  - `pnpm vitest run vault-path-mapper.spec` が全件 PASS すること
  - _Requirements: 3.1–3.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-path-mapper.spec.ts_

---

- [x] 4. SharedSecretAuth middleware
- [x] 4.1 `SharedSecretAuth` middleware の実装
  - `src/middlewares/shared-secret-auth.ts` を作成する
  - `Authorization: Bearer <token>` ヘッダを抽出し、`crypto.timingSafeEqual` で `VAULT_MANAGER_INTERNAL_SECRET` と定数時間比較する
  - token 不一致・ヘッダなし → 401 Unauthorized を返す
  - secret は `process.env.VAULT_MANAGER_INTERNAL_SECRET` からのみ読み込む
  - ユニットテストで正常・不一致・ヘッダなしの各ケースを検証すること
  - _Requirements: 7.1–7.5_
  - _Boundary: apps/growi-vault-manager/src/middlewares/shared-secret-auth.ts_

---

- [x] 5. VaultNamespaceBuilder の実装
- [x] 5.1 `upsert` / `remove` op の実装
  - `src/services/vault-namespace-builder.ts` を作成し、`applyInstruction(instruction: VaultInstructionDoc)` メソッドを実装する（`op` は `instruction.op` のトップレベルフィールドで参照し、ページ固有フィールドは `instruction.payload.*` でアクセスする）
  - `upsert`: `VaultPathMapper.map` → `revisions.findOne` → `VaultBlobHasher.hashBlob` → `writeBlob` → tree 更新 → `writeTree`（root まで再帰）→ `writeCommit` → `updateRef` → `vault_namespace_state.upsert` の順で実装する
  - `remove`: tree から entry 削除 → tree 再計算 → commit → updateRef → state update
  - commit message フォーマット（`vault: <namespace> [op] ...`）に準拠していること
  - 同一 instruction 再実行で同一 ref OID に収束すること（冪等性ユニットテスト）
  - _Requirements: 2.1, 2.3, 2.7, 2.8_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.2 `bulk-upsert` op の実装
  - `vault-namespace-builder.ts` に `bulk-upsert` ハンドラを追加する
  - `revisions.find({_id: {$in: revisionIds}}, {body}).cursor()` で 1 クエリ取得する
  - `Promise.all`（concurrency 16）で各 entry の `VaultPathMapper.map` + `VaultBlobHasher.hashBlob` を並列計算する
  - 全 entry の `(filePath, blobOid)` を既存 namespace tree に一括 apply し、1 回の tree rebuild・1 件の commit・1 回の ref update で完結する
  - N=1 / N=1000 / N=1001（chunk 境界）での冪等性ユニットテスト
  - _Requirements: 2.2, 2.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.3 `rename-prefix` / `grant-change-prefix` op の実装
  - `vault-namespace-builder.ts` に prefix 操作ハンドラを追加する
  - `rename-prefix`: `VaultPathMapper.mapPrefix` → oldFilePrefix 配下の subtree 抽出 → newFilePrefix 下に mount → oldFilePrefix 削除 → tree 再 hash → commit → updateRef
  - `grant-change-prefix`: fromNamespace から subtree 切り離し → namespace（移動先）に mount → 両 namespace で commit + updateRef（namespace 単位 atomic）
  - blob 再書き込みなしで subtree が移動すること（インテグレーションテストで確認）
  - _Requirements: 2.4, 2.5, 2.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.4 `reset-all` op の実装
  - `vault-namespace-builder.ts` に `reset-all` ハンドラを追加する
  - `reset-all` は `payload.namespace` が undefined であることを前提とし、全 namespace ref の一括削除を実行する（`instruction.payload.namespace` は参照しない）
  - 全 namespace の `refs/namespaces/<ns>/refs/heads/main` を `VaultRepoStorage.deleteRef` で削除する
  - `vault_namespace_state` の全 doc を削除する
  - `vault_user_views` の全 doc を削除する
  - object pool は削除しない（`git gc` で孤立 object は別途回収）
  - ユニットテストで ref 削除・state クリア・object pool 保持を検証すること
  - _Requirements: 2.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

---

- [x] 6. VaultViewComposer の実装
- [x] 6.1 full merge と cache hit の実装
  - `src/services/vault-view-composer.ts` を作成する
  - `compose(userId, namespaces)` を実装する
  - `vault_namespace_state` から各 namespace の commitOid を取得し `currentVersions` を構築する
  - `vault_user_views` の `sourceVersions` と一致する場合はキャッシュヒットを返す
  - `existing == null` の場合は全 namespace を full merge（`fullMergeTreesByPath`）する
  - `viewRef = userId ? 'user-<uid>-view' : 'anonymous-view'` として ref を更新する
  - キャッシュヒット時に recompose なしで既存 `viewCommitOid` を返すこと（ユニットテスト）
  - _Requirements: 4.1–4.3, 4.5, 4.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

- [x] 6.2 delta merge の実装
  - `vault-view-composer.ts` に delta merge（`applyNamespaceDeltas`）を追加する
  - 変動した namespace のみ subtree を再計算し、変動なし namespace の subtree OID を base から継承する
  - base tree が gc で消失している場合は full merge にフォールバックする
  - delta merge で p95 latency が cold merge の 1/10 以下になること（パフォーマンステストで確認）
  - _Requirements: 4.4, 4.8_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

- [x] 6.3 衝突解消ロジックの実装
  - 同一 path に複数 namespace からのエントリが存在する場合の優先順位を実装する
  - 優先順位: `user-<uid>-only-me` > `group-*` > `restricted-link` > `public`
  - ユニットテストで各衝突パターンの解決結果を検証すること
  - _Requirements: 4.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

---

- [x] 7. HTTP Controllers の実装
- [x] 7.1 `ComposeViewController` の実装
  - `src/controllers/compose-view-controller.ts` を作成する
  - `POST /internal/compose-view` を `@BodyParams` で `ComposeViewRequest` を受け取り、`VaultViewComposer.compose` に委譲して `ComposeViewResponse` を返す
  - `SharedSecretAuth` を middleware として適用する
  - リクエスト/レスポンスが `@growi/core` の `ComposeViewRequest` / `ComposeViewResponse` 型と一致すること
  - _Requirements: 4.1_
  - _Boundary: apps/growi-vault-manager/src/controllers/compose-view-controller.ts_

- [x] 7.2 `GitProxyController` の実装
  - `src/controllers/git-proxy-controller.ts` を作成する
  - `GET /internal/git/info/refs` を実装する（`X-Vault-View-Ref` ヘッダ → `VaultUploadPackSpawner.spawn({ mode: 'advertise', viewRef })`、stdout を HTTP body に stream）
  - `POST /internal/git/git-upload-pack` を実装する（`X-Vault-View-Ref` ヘッダ + request body stdin → `VaultUploadPackSpawner.spawn({ mode: 'rpc', viewRef, stdin: body })`、stdout を HTTP body に stream）
  - `SharedSecretAuth` を middleware として適用する
  - Node.js プロセスがフルバッファリングせず stdout を直接 HTTP body に pipe することをインテグレーションテストで確認する
  - _Requirements: 5.1–5.5_
  - _Boundary: apps/growi-vault-manager/src/controllers/git-proxy-controller.ts_

- [x] 7.3 `HealthController` の実装
  - `src/controllers/health-controller.ts` を作成する
  - `GET /health` で MongoDB 接続・change stream 稼働状態・bare repo ディレクトリ到達性を確認する
  - 全チェック正常 → 200 `{"status":"ok"}`、いずれか失敗 → 503 `{"status":"error","details":{...}}`
  - SharedSecretAuth を適用しない（k8s liveness probe はヘッダを付けない）
  - 各障害ケース（MongoDB 断・bare repo 消失）での 503 応答をユニットテストで確認すること
  - _Requirements: 8.1–8.4_
  - _Boundary: apps/growi-vault-manager/src/controllers/health-controller.ts_

- [x] 7.4 `StorageStatsController` の実装
  - `src/controllers/storage-stats-controller.ts` を作成する
  - `GET /internal/storage-stats` を実装し、`@growi/core` の `StorageStatsResponse` を返す
  - `vault_namespace_state` を集約して `namespaceCount` と `totalCommitCount` を取得する（O(repo size) の重い処理を行わない）
  - `git count-objects` を spawn して `looseObjectCount` をパース取得する
  - bare repo ディレクトリの総バイト数を `fs.stat` の集計または `du -sb` 相当の Node.js 実装で取得する
  - `VaultMaintenanceScheduler.getStatus()` から `lastSquashAt` / `lastGcAt` を取得する（未実行時は null）
  - `SharedSecretAuth` を middleware として適用する
  - 集計失敗時は 500 を返し、エラー詳細をログに記録する
  - _Requirements: 11.1–11.5_
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

---

- [x] 8. VaultUploadPackSpawner の実装
- [x] 8.1 `VaultUploadPackSpawner` の実装
  - `src/services/vault-upload-pack-spawner.ts` を作成する
  - `spawn({ mode: 'advertise', viewRef })` → `git upload-pack --stateless-rpc --advertise-refs <repoPath>` を `GIT_NAMESPACE=<viewRef>` 環境変数付きで child_process.spawn する
  - `spawn({ mode: 'rpc', viewRef, stdin })` → `git upload-pack --stateless-rpc <repoPath>` を spawn し、stdin を pipe する
  - `uploadpack.allowAnySHA1InWant=false` をデフォルト（git の動作）として依存し、特別な設定なしで OID 直接 fetch が禁止されることをインテグレーションテストで確認する
  - クライアント切断時・タイムアウト時のプロセス kill 処理を実装する
  - _Requirements: 5.1–5.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-upload-pack-spawner.ts_

---

- [x] 9. VaultInstructionWatcher の実装
- [x] 9.1 change stream 購読と起動時 drain の実装
  - `src/services/vault-instruction-watcher.ts` を作成する
  - `start()` で `vault_sync_state` から `resumeToken` を取得して change stream を開始する
  - 並行して `vault_instructions.find({ processedAt: null }).cursor()` で起動時 drain を実行する
  - change stream イベント受信時に `processedAt != null` チェックで冪等性を保証する
  - resume token を `vault_sync_state` に保存する
  - `stop()` で change stream を close し in-flight 処理を待つ
  - _Requirements: 1.1–1.4, 1.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts_

- [x] 9.2 失敗時リトライ処理の実装
  - `VaultNamespaceBuilder.applyInstruction` が失敗した場合に `attempts++` / `lastError` を書き込み、`processedAt: null` を維持する
  - 次回 drain または change stream イベントで retry される動作をユニットテストで確認する
  - 処理成功時のみ `processedAt` を更新することを確認すること
  - _Requirements: 1.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts_

---

- [x] 10. VaultMaintenanceScheduler の実装
- [x] 10.1 Squash スケジューラの実装
  - `src/services/vault-maintenance-scheduler.ts` を作成する
  - `start()` で 5 分間隔の `setInterval` を設定し、全 namespace の commit 数と最終 squash 経過時間を確認する
  - commit 数 > `VAULT_SQUASH_COMMIT_THRESHOLD`（デフォルト 1000）または経過時間 > `VAULT_SQUASH_AGE_HOURS`（デフォルト 1h）で squash を実行する
  - squash: 現 tree OID を取得 → `parents: []` の新 commit を `VaultRepoStorage.writeCommit` で作成 → `updateRef` → `vault_namespace_state.version++`
  - in-flight namespace の直列化（同 namespace の squash と upsert を直列化）を実装する
  - _Requirements: 6.1–6.3, 6.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts_

- [x] 10.2 GC スケジューラの実装
  - `vault-maintenance-scheduler.ts` に gc スケジューラを追加する
  - loose object 数 > `VAULT_GC_LOOSE_OBJECT_THRESHOLD`（デフォルト 50,000）または前回 gc から `VAULT_GC_INTERVAL_HOURS`（デフォルト 24h）経過で `git gc --prune=2.weeks.ago` を spawn する
  - `triggerGc()` が手動トリガとして動作し、before/after の object 数と実行時間を返すこと
  - env var による閾値 override をユニットテストで確認すること
  - _Requirements: 6.4, 6.5, 6.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts_

---

- [x] 11. インテグレーションテストと E2E 検証
- [x] 11.1 clone E2E インテグレーションテスト
  - docker-compose で vault-manager + MongoDB + 共有 fs を起動し、実際に `git clone` を実行してファイル一覧と内容を検証するテストを作成する
  - PAT なしの `/health` 確認 → `compose-view` RPC → `info/refs` → `git-upload-pack` の一連フローが通ること
  - _Requirements: 1.1, 5.1–5.3, 8.4_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

- [x] 11.2 instruction 冪等性インテグレーションテスト
  - 同一 `upsert` instruction を 2 回処理して namespace ref OID が同一に収束することを確認する
  - `bulk-upsert` 1000 entries で `$in` 1 クエリ・1 commit・1 ref update が成立することを確認する
  - `rename-prefix` で blob 再書き込みなしで subtree が移動することを確認する
  - _Requirements: 2.2, 2.4, 2.7_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

- [x] 11.3 compose-view キャッシュとメンテナンスのインテグレーションテスト
  - 同一 `sourceVersions` で compose-view を 2 回呼び出し、2 回目でキャッシュヒット（recompose なし）を確認する
  - 1000+ commit を namespace ref に積み上げ後に squash が自動 trigger され、ref が depth=1 に縮約されることを確認する
  - gc 実行中に clone を開始しても clone が破壊されないことを確認する
  - _Requirements: 4.3, 6.2–6.3_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

---

- [ ] 12. 起動時プリフライトチェック
- [ ] 12.1 必須環境変数の検証
  - `src/index.ts` の `bootstrap()` 呼び出し前に必須環境変数の存在チェックを行う
  - 必須変数: `VAULT_MANAGER_INTERNAL_SECRET`、`MONGODB_URI`、`VAULT_REPO_PATH`
  - いずれかが未設定または空文字の場合は `process.exit(1)` し、欠けている変数名をエラーメッセージに列挙する
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [ ] 12.2 MongoDB 接続確認
  - 環境変数チェック通過後、`bootstrap()` 呼び出し前に `mongoose.connect()` + `db.command({ ping: 1 })` で MongoDB への疎通を確認する
  - タイムアウト（5 秒）以内に接続できない場合は `process.exit(1)` し、`MONGODB_URI` のホスト部とタイムアウト秒数をエラーメッセージに含める
  - 接続確認後は接続を閉じず、Ts.ED bootstrap に引き継ぐ
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [ ] 12.3 プリフライトチェックの単体テスト
  - `src/preflight.ts`（または `src/index.ts` から抽出した純粋関数）として環境変数チェックと MongoDB ping ロジックを切り出し、単体テスト可能にする
  - 必須変数が1つ以上欠けている場合に欠落変数名を列挙したエラーを throw することをテストする
  - 全必須変数が揃っている場合に正常終了することをテストする
  - MongoDB ping 失敗（接続拒否）時にタイムアウトエラーを throw することをテストする（mongoose.connect をモック）
  - MongoDB ping 成功時に正常終了することをテストする
  - `pnpm vitest run preflight.spec` が全テスト通過すること
  - _Boundary: apps/growi-vault-manager/src/preflight.ts、apps/growi-vault-manager/src/preflight.spec.ts_

---

- [ ] 13. invalid revisionId 防御策の追加（**P0 / 最優先・結合試験ブロッカー**）

  apps/app から渡される `bulk-upsert` / `upsert` instruction の `revisionId` に空文字列または ObjectId 形式違反値が混入した場合、現状は `RevisionModel.bodyQueryByIds(['', ...])` が Mongoose の `Cast to ObjectId failed for value ""` で throw し、bulk-upsert が `attempts=5` まで失敗継続する。バグの一次責務は apps/app 側（`growi-vault-gateway` タスク 18 で修正）だが、vault-manager 側でも防御層を追加し、apps/app 側のリグレッション・将来追加されるデータソースに対して耐性を持たせる。

- [x] 13.1 RevisionModel に valid-id フィルタリングを追加（タスク 2.2 の追補）
  - `apps/growi-vault-manager/src/models/revision.ts` の `bodyQueryByIds` を「ObjectId として valid な ID のみで `$in` 検索する」実装に変更する（または `bodyQueryByValidIds` を新設して既存メソッドは deprecated JSDoc を付与する）
  - 内部で `mongoose.Types.ObjectId.isValid(id)` で filter してから `find({_id: {$in: validIds}}, {body})` を構築する
  - filter で取り除いた件数を返す or logger に warn で出力できるように、戻り値に `{ cursor, skippedIds }` を含める設計を検討する（必須ではないが 13.2 のログ出力で使う）
  - **完了確認**: `bodyQueryByIds(['', 'not-an-oid', '<valid-oid>'])` が throw せず `<valid-oid>` のみ照会する単体テストが通ること（`pnpm vitest run revision.spec`）
  - _Boundary: apps/growi-vault-manager/src/models/revision.ts_

- [x] 13.2 bulk-upsert ハンドラで invalid revisionId を skip し warn ログに残す（タスク 5.2 の追補）
  - `apps/growi-vault-manager/src/services/vault-namespace-builder.ts` の `applyBulkUpsert` で 13.1 の API を使う
  - revisionMap に hit しなかった entry は現状の `revisionMap.get(...) ?? ''` で body 空として扱われるため追加分岐は不要だが、`logger.warn` で「skipped N invalid revisionIds in instruction <id>」を構造化ログとして出力する
  - **完了確認**: 1000 entries のうち 10 件が空文字列 revisionId の fixture で bulk-upsert が成功し、`attempts: 0, processedAt != null` で完了するインテグレーションテストを追加すること
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 13.3 dead-letter 検知の強化
  - 同一 instruction の `attempts >= 5` を観測した場合、`VaultInstructionWatcher` が構造化ログで `severity: error` 相当の出力をする（現状は `recordFailure` で attempts/lastError は更新するが、上限到達時の通知はない）
  - 可能なら `StorageStatsController` のレスポンスに `stuckInstructionCount` を追加し、admin UI から観測できるようにする
  - **完了確認**: `db.vault_instructions.find({attempts: {$gte: 5}, processedAt: null})` が非空のとき、`/internal/storage-stats` レスポンスに反映されること、および watcher のログに 1 件あたり 1 行のエラーが出ること（再試行ループでログ氾濫しないよう、attempts 5 到達時のみ出力）
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts、apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_
