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

- [x] 12. 起動時プリフライトチェック
- [x] 12.1 必須環境変数の検証
  - `src/index.ts` の `bootstrap()` 呼び出し前に必須環境変数の存在チェックを行う
  - 必須変数: `VAULT_MANAGER_INTERNAL_SECRET`、`MONGODB_URI`、`VAULT_REPO_PATH`
  - いずれかが未設定または空文字の場合は `process.exit(1)` し、欠けている変数名をエラーメッセージに列挙する
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [x] 12.2 MongoDB 接続確認
  - 環境変数チェック通過後、`bootstrap()` 呼び出し前に `mongoose.connect()` + `db.command({ ping: 1 })` で MongoDB への疎通を確認する
  - タイムアウト（5 秒）以内に接続できない場合は `process.exit(1)` し、`MONGODB_URI` のホスト部とタイムアウト秒数をエラーメッセージに含める
  - 接続確認後は接続を閉じず、Ts.ED bootstrap に引き継ぐ
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [x] 12.3 プリフライトチェックの単体テスト
  - `src/preflight.ts`（または `src/index.ts` から抽出した純粋関数）として環境変数チェックと MongoDB ping ロジックを切り出し、単体テスト可能にする
  - 必須変数が1つ以上欠けている場合に欠落変数名を列挙したエラーを throw することをテストする
  - 全必須変数が揃っている場合に正常終了することをテストする
  - MongoDB ping 失敗（接続拒否）時にタイムアウトエラーを throw することをテストする（mongoose.connect をモック）
  - MongoDB ping 成功時に正常終了することをテストする
  - `pnpm vitest run preflight.spec` が全テスト通過すること
  - _Boundary: apps/growi-vault-manager/src/preflight.ts、apps/growi-vault-manager/src/preflight.spec.ts_

---

- [x] 13. invalid revisionId 防御策の追加（**P0 / 最優先・結合試験ブロッカー**）

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
  - **完了確認**: dead-letter（attempts >= 5）到達時に watcher が 1 行のエラーログを出力し、`/internal/storage-stats` から観測可能なこと
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts、apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

---

- [x] 14. ユニットテスト回帰修正（**P0 / Critical**）

  コミット `705b3257fe` で `VaultRepoStorage.ensureNamespaceHead` が追加されたが `vault-view-composer.spec.ts` の `vi.mock('./vault-repo-storage.js', ...)` が enumerate 形式のため mock に追従できておらず、`pnpm vitest run` で 10/152 ケースが `[vitest] No "ensureNamespaceHead" export is defined on the "./vault-repo-storage.js" mock` で失敗する。canonical テストスイートを緑に戻したうえで、enumerate 形式の脆性自体を partial mock パターンに置換する。

- [x] 14.1 `vault-view-composer.spec.ts` の mock に `ensureNamespaceHead` を追加して緑化（最小修正）
  - `apps/growi-vault-manager/src/services/vault-view-composer.spec.ts` の `vi.mock('./vault-repo-storage.js', () => ({ ... }))` ブロックに `ensureNamespaceHead: vi.fn()` を 1 行追加する
  - 必要に応じて beforeEach で `vi.mocked(VaultRepoStorage.ensureNamespaceHead).mockResolvedValue(undefined)` を設定する
  - **完了確認**: `pnpm vitest run vault-view-composer.spec` が 16/16 PASS、リポジトリ全体で `pnpm vitest run` の終了コードが 0 になること
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.spec.ts_

- [x] 14.2 enumerate 形式の `vi.mock` を partial mock パターンへ移行（再発防止）
  - `apps/growi-vault-manager/src/**/*.spec.ts` 配下で `vault-repo-storage.js` を mock している全 spec ファイル（vault-view-composer.spec / vault-namespace-builder.spec / vault-maintenance-scheduler.spec ほか）の `vi.mock('./vault-repo-storage.js', () => ({ ... }))` を `vi.mock(import('./vault-repo-storage.js'), async (importOriginal) => ({ ...(await importOriginal()), readRef: vi.fn(), ... }))` 形式に置換する
  - 同様に `'../models/*.js'` を mock している箇所も対象モデルに新しい export が増えても回帰しないよう partial mock 化を検討する（モデル側は class member 中心のため範囲は限定的）
  - **完了確認**: `apps/growi-vault-manager/src/services/vault-repo-storage.ts` に新規 export を試験的に追加しても全 spec が引き続き PASS することを CI で確認する（実検証は手元での dry-run でも可）
  - _Boundary: apps/growi-vault-manager/src/services/*.spec.ts、apps/growi-vault-manager/src/__tests__/*.integ.ts_

---

- [x] 15. VaultMaintenanceScheduler の production 配線（**P0 / Critical**）

  Task 10.1/10.2 で `createVaultMaintenanceScheduler()` factory は実装されたが、`apps/growi-vault-manager/src/index.ts` の bootstrap で一切起動されていない。`apps/growi-vault-manager/src/controllers/storage-stats-controller.ts:166-168` も `lastSquashAt: null` / `lastGcAt: null` をハードコードし、コメントで `// VaultMaintenanceScheduler is not yet implemented — return null` と明示している。これにより要件 6.7（外部 cron 不要での自走）と要件 11.4（lastSquashAt/lastGcAt の値を返す）が成立していない。

- [x] 15.1 `index.ts` で MaintenanceScheduler を起動し module-level singleton として保持
  - `apps/growi-vault-manager/src/index.ts` の `checkMongoConnection().then(...)` 内、`watcher.start()` の後に `const scheduler = createVaultMaintenanceScheduler(); scheduler.start();` を追加する
  - scheduler インスタンスは `apps/growi-vault-manager/src/services/vault-maintenance-scheduler-instance.ts`（または同等の module）で module-level singleton として export し、`StorageStatsController` から import 可能にする
  - SIGTERM / SIGINT 受信時に `scheduler.stop()` を呼ぶよう terminus または process listener と統合する
  - **完了確認**: 起動時に scheduler が start され、SIGTERM/SIGINT で正常停止すること
  - _Boundary: apps/growi-vault-manager/src/index.ts、apps/growi-vault-manager/src/services/vault-maintenance-scheduler-instance.ts_

- [x] 15.2 `StorageStatsController` を scheduler singleton に接続して実値を返す
  - `apps/growi-vault-manager/src/controllers/storage-stats-controller.ts` の `lastSquashAt: null` / `lastGcAt: null` ハードコードを削除し、15.1 の singleton から `getLastSquashAt()` / `getLastGcAt()` を呼んで `Date | null` → `string | null`（ISO 8601）に変換して返す
  - `// VaultMaintenanceScheduler is not yet implemented — return null` コメントも削除する
  - 起動時 5 分以内など scheduler 未実行の状態では各メソッドが `null` を返すため、要件 11.4 の「未実行時は null」を満たす
  - **完了確認**: 起動直後は null、squash 後は ISO 8601 文字列が返ること
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

- [x] 15.3 `storage-stats-controller.spec.ts` を scheduler singleton 経由のレスポンスで再構成
  - `apps/growi-vault-manager/src/controllers/storage-stats-controller.spec.ts` で 15.1 の singleton module を `vi.mock` し、`getLastSquashAt()` が `null` を返すケースと Date を返すケースの 2 シナリオでレスポンスシリアライズを検証する
  - **完了確認**: `pnpm vitest run storage-stats-controller.spec` が PASS、`lastSquashAt`/`lastGcAt` の null と ISO 文字列の双方が assertion 対象になっていること
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.spec.ts_

---

- [x] 16. インテグレーションテストの CI 実行可能化（**P1 / Important**）

  Task 11.1/11.2/11.3 で作成された `__tests__/*.integ.ts` 3 ファイルは全て `describe.skip(...)` で wrap されており CI で一切実行されない。dev-verification.md に手動手順は記載されているが、自動回帰検出の手段がない。スイート起動時の env で integration mode を有効化する形に切り替え、最低 1 シナリオを CI に組み込む。

- [x] 16.1 `describe.skip` を env 駆動の条件付き実行に置き換え
  - `apps/growi-vault-manager/src/__tests__/clone-e2e.integ.ts` / `instruction-idempotency.integ.ts` / `compose-view-maintenance.integ.ts` の `describe.skip(...)` を `(process.env.RUN_VAULT_INTEG === 'true' ? describe : describe.skip)(...)` 形式に変更する
  - 各ファイル冒頭の env 必須条件（`VAULT_MANAGER_BASE_URL` / `VAULT_MANAGER_INTERNAL_SECRET` / `MONGO_URL`）が揃っていない場合は `beforeAll` で `console.warn` して skip するガードを残す
  - **完了確認**: `RUN_VAULT_INTEG=true` 設定有無で skip / 実行が分岐すること
  - _Boundary: apps/growi-vault-manager/src/__tests__/*.integ.ts_

- [x] 16.2 CI ジョブで integration テストを最低 1 ジョブ実行可能にする
  - `package.json` の `scripts.test:integ` に `RUN_VAULT_INTEG=true vitest run src/__tests__` を追加する
  - GitHub Actions に integration ジョブを 1 つ追加し、`scripts.test:integ` を実行する
  - 本番運用は別リポジトリの growi-docker-compose、dev は devcontainer 内で直起動するため、本リポジトリ内に CI 専用の docker-compose ファイルは設けず、CI workflow 内で MongoDB（replica set 必須・change stream 前提）と vault-manager をそれぞれ起動する
  - **完了確認**: CI で integration 1 シナリオが PASS し、PR に対して回帰検出が機能すること
  - _Boundary: apps/growi-vault-manager/package.json、.github/workflows/ci-vault.yml_

---

- [x] 17. ユーザ向けドキュメント整備（umbrella spec 由来 / **P1 / Important**）

  umbrella spec [`growi-vault/design.md`](../growi-vault/design.md#L253) の "User-facing Documentation Deliverables" として宣言された 3 件（要件 2.6 path-to-filename マッピング規則、要件 2.8 `git sparse-checkout` 手順、要件 8 MVP 範囲外項目）が成果物として未配置。配置先は manager の design.md "ファイル構成" にも宣言されている `apps/growi-vault-manager/README.md` とする。

- [x] 17.1 `apps/growi-vault-manager/README.md` を新規作成し path-to-filename マッピング規則を記載
  - `apps/growi-vault-manager/README.md` を新規作成する
  - `VaultPathMapper` のエンコード規則（Windows 予約文字 `%XX`、予約ファイル名 `_` プレフィックス、大文字 suffix `__<hash8>`、orphan `_orphaned/`）をユーザが「GROWI ページパス → clone 後のファイルパス」を予測できる粒度で表形式または例示形式で記述する
  - サンプル: `/Sandbox/Markdown` → `Sandbox/Markdown__<hash8>.md`、`/CON/notes` → `_CON__<hash8>/notes.md` など
  - _Requirements: 要件 2.6 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

- [x] 17.2 README に `git sparse-checkout` で `/user` 配下を除外する手順を追記
  - 17.1 で作成した README に「`/user` 配下を除外する」セクションを追加する
  - `git clone --no-checkout`、`git sparse-checkout init --cone`、`git sparse-checkout set '/*' '!user'` の具体的なコマンド列を記載する
  - 注意点として「sparse-checkout は手元の checkout 範囲のみ制御し、サーバ側で配信される object 範囲は変わらない」旨を明記する
  - _Requirements: 要件 2.8 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

- [x] 17.3 README に MVP 範囲外項目を明示
  - 17.1 で作成した README に「MVP では非対応の項目」セクションを追加する
  - `git push`（書き込み）、添付ファイル、コメント / いいね / ブックマーク / タグ等のページ間メタデータ、機能有効化以前の revision 履歴、下書き / 未公開ページの 5 項目を箇条書きで明記する
  - 関連 spec として gateway / manager design.md と umbrella requirements 8 へのリンクを併記する
  - _Requirements: 要件 8 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

---

- [x] 18. Dockerfile を DHI 採用のモダン構成にリファクタ（**P1 / Important**）

  `apps/app/docker/Dockerfile` は最近 DHI（Docker Hardened Images）採用と turbo prune ベースの多段ビルドへリファクタされた（`dhi.io/node:24-debian13-dev` を build / `dhi.io/node:24-debian13` を runtime、`base` → `pruner` → `deps` → `builder` → `release` の 5 stage 構成、`pnpm store` の cache mount、OCI 標準 label、専用 `Dockerfile.dockerignore`）。一方 `apps/growi-vault-manager/Dockerfile` は依然として `node:24-alpine` + `apk add git` + 単一 `builder` stage という旧構成のままで、ビルドキャッシュ効率・runtime 攻撃面・monorepo subset 抽出の点で apps/app と齟齬がある。本タスクで apps/app と同じ流儀に揃え、vault-manager 固有の制約（runtime で `git upload-pack` を spawn するため git binary v2.30+ が必須）に対応する。

- [x] 18.1 release stage の git binary 取得戦略を確定（前提調査）
  - vault-manager は `VaultUploadPackSpawner` が runtime で `git upload-pack --stateless-rpc` を `child_process.spawn` するため、release stage に git v2.30+ の実行可能 binary が必須である（apps/app には存在しない制約）
  - DHI distroless 系（`dhi.io/node:24-debian13`）は shell も任意 binary も持たないため、以下の選択肢から方針を確定し design.md または本 task の備考に記録する:
    - (a) `dhi.io/node:24-debian13-dev`（git/shell を含む dev variant）を runtime に流用する
    - (b) DHI に git を含む別 variant が存在する場合はそれを採用する
    - (c) `builder` stage（debian-dev）から `/usr/bin/git` と依存共有ライブラリ（`ldd /usr/bin/git` で列挙）を release stage に `COPY --from=builder` で持ち込む static copy 戦略
  - **完了確認**: 採用方針と検証ログ（`git --version` が 2.30 以上を返し、`git upload-pack --stateless-rpc --advertise-refs <repo>` が動作することを runtime image 内で確認した記録）を design.md または tasks.md に追記すること
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/Dockerfile（または .kiro/specs/growi-vault-manager/design.md の補足記述）_

- [x] 18.2 multi-stage 構成へリファクタ（DHI base + turbo prune）
  - `apps/app/docker/Dockerfile` に倣って `base` / `pruner` / `deps` / `builder` / `release` の 5 stage 構成に書き換える
  - `base` stage は `dhi.io/node:24-debian13-dev` をベースに pnpm（standalone install script）と turbo を導入する
  - `pruner` stage で `turbo prune @growi/vault-manager --docker` を実行し monorepo subset（`out/json` / `out/full`）を生成する
  - `deps` stage は `pruner` の `out/json` のみ COPY し、`--mount=type=cache,target=$PNPM_HOME/store,sharing=locked` 付きで `pnpm install --frozen-lockfile` を実行する
  - `builder` stage は `pruner` の `out/full` を deps の上に COPY し、`tsconfig.base.json` を root から COPY したうえで `turbo run build --filter @growi/vault-manager` でビルドする
  - artifact stage では `pnpm deploy --prod --legacy --filter @growi/vault-manager` で生成した `node_modules` と `dist` のみを clean directory に集約する（apps/app の `/tmp/release/` 方式に倣う）
  - `release` stage は 18.1 で確定した git binary 戦略を適用したうえで artifact を `COPY --from=builder` する
  - **完了確認**: `docker build apps/growi-vault-manager` が成功し、`docker run --rm <image> git --version` が 2.30 以上を返すこと、最終 image size が現状（alpine ベース）から逸脱なく許容範囲内であること
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/Dockerfile_

- [x] 18.3 専用 Dockerfile.dockerignore の追加
  - `apps/growi-vault-manager/Dockerfile.dockerignore` を新規作成し、`apps/app/docker/Dockerfile.dockerignore` に倣って build artifact（`**/node_modules`, `**/.next`, `**/.turbo`, `out`）/ `.git` / test（`**/*.spec.*`, `**/__tests__/`）/ `**/*.md`（locale を除外する必要がなければ単純除外）/ `.changeset` / `.github` / IDE 設定 / `.claude` / `.kiro` を除外する
  - vault-manager 固有の調整として、ビルドに不要な他 apps（`apps/app`, `apps/pdf-converter`, `apps/slackbot-proxy`）の除外、および sparse-checkout 用 fixture 等が test 配下にある場合の追加除外を行う
  - **完了確認**: `docker build` のコンテキスト送信サイズがリファクタ前と比較して有意に減少することをログ（`Sending build context to Docker daemon`）で確認すること
  - _Requirements: 10.2_
  - _Boundary: apps/growi-vault-manager/Dockerfile.dockerignore_

- [x] 18.4 OCI 標準 label の付与
  - release stage に `org.opencontainers.image.source` / `title` / `description` / `vendor` の OCI 標準 label を追加する（apps/app と同じ vendor `WESEEK, Inc.`、source URL `https://github.com/weseek/growi` を流用、title / description は vault-manager 固有のものを設定）
  - 既存の `LABEL maintainer="Yuki Takei <yuki@weseek.co.jp>"` は `org.opencontainers.image.authors` に置き換えるか、両者併存とするかを apps/app の方針と揃える
  - **完了確認**: `docker inspect <image>` の `Config.Labels` に OCI 標準 label が出現すること
  - _Requirements: 10.2_
  - _Boundary: apps/growi-vault-manager/Dockerfile_

- [x] 18.5 既存ワークフロー / CI 互換性確認
  - 別リポジトリ `growi-docker-compose` から本 Dockerfile を参照している箇所（image build 設定）が新構成でも機能することを README または関連 spec で告知する（リポジトリ越境のため変更は別 PR）
  - `.github/workflows/ci-vault.yml` は現状 docker build を経由せず直接 `node` で起動しているため Dockerfile 変更の直接影響は受けないが、回帰確認として `docker build` を CI に追加するか検討し、追加する場合は本 task に subtask を切る
  - **完了確認**: 新 Dockerfile で build した image で `/health` が 200 を返し、image 経由の integration test も PASS すること
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/README.md（必要に応じて）、.github/workflows/ci-vault.yml（必要に応じて）_

---

## Implementation Notes

実装を経て判明した、refactor 時に押さえるべき設計上の課題・教訓を記録する。

### Resume 設計の二層構造と限界

vault-manager 側には **2 種類の resume** が同居しており、それぞれ別の目的・別の永続化を持つ:

1. **Change stream resume** ([vault-instruction-watcher.ts:217-235](../../../apps/growi-vault-manager/src/services/vault-instruction-watcher.ts#L217-L235))
   - `vault_sync_state.resumeToken` を MongoDB change stream に渡し、再起動後も未受信 instruction を漏らさず受信できる
   - 起動時に `vault_instructions.find({processedAt: null}).cursor()` で **drain** することで、resume token 期限切れにも耐性
   - これは **vault-manager の責務範囲内で完結する resume**

2. **Bootstrap resume**（apps/app 側）
   - `vault_sync_state.bootstrapCursor` を apps/app の `VaultBootstrapper` が write する
   - vault-manager は read もしない（owner 越境禁止）
   - vault-manager 側からは「`reset-all` instruction が来た = 全 namespace state を wipe する」「`bulk-upsert` instruction が来た = entries を namespace tree に反映する」というステートレスな反応しかできない

→ **真にレジリエントな resume**（gateway 側 Implementation Notes 参照）を実装する際、vault-manager 側は「冪等な op として何が来ても収束する」性質を維持する必要がある。op の意味論を変える場合は両 spec で同時に再設計が必要。

### Reconciliation 機構の不在

`VaultMaintenanceScheduler` は **squash と gc のみ**で、MongoDB のページと vault tree の差分検出・補修は一切行わない ([vault-maintenance-scheduler.ts](../../../apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts))。

- bootstrap で取りこぼされたページは、gateway 側 dispatcher の page event を受け取るまで永久に同期されない
- vault tree と revisions DB の整合性チェックを行う「drift detector」は未実装
- レジリエント resume を実装するなら、vault-manager 側にも「現在の namespace ref に含まれるべき pageId のリストを apps/app が requirement として渡せる API」を追加する設計が必要

### `reset-all` の意味論と分解可能性

現在 `reset-all` は「**全 namespace ref + state を一括 wipe する**」唯一の op として実装されている ([vault-namespace-builder.ts:632-648](../../../apps/growi-vault-manager/src/services/vault-namespace-builder.ts#L632-L648))。

- object pool（git objects）は保持されるため、`reset-all` 後の `bulk-upsert` は content-addressed で blob を再利用できる
- ただし `reset-all` 自体は途中再開不可能（atomic な全削除）
- レジリエント resume では「partial reset」（namespace 単位 / cursor 範囲単位の wipe）の op を新設する可能性がある

### Squash / GC と instruction 処理の in-flight 直列化

`VaultMaintenanceScheduler` の squash と `VaultNamespaceBuilder` の instruction 処理は **同一 namespace 上で並行してはならない**:

- 現状の実装は `inflightSquash: Set<string>` で squash 側を排他しているが、instruction 処理側からの check は **未実装** ([vault-maintenance-scheduler.ts:282-292](../../../apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts#L282-L292) のコメントで「VaultNamespaceBuilder is expected to check」と TODO 化）
- 短時間ウィンドウで競合する可能性は低いが、長時間 squash（大規模 namespace）と高頻度 upsert が重なると ref 競合の可能性
- レジリエント resume を実装する際、bulk reconciliation 処理中の squash は明示的にブロックする必要がある

### Idempotency の根拠（refactor 時の前提）

全 op の冪等性は **2 つの property** に依存している:

1. **Git object の content-addressing**: 同一内容の blob/tree/commit は同一 OID → 再書き込みは no-op
2. **VaultPathMapper の純関数性**: `map(pagePath, pageId)` が tree state に依存せず常に同 filePath を返す

→ `VaultPathMapper` の規則を変更すると過去の commit と継続性が破壊される（design.md の Revalidation Triggers）。レジリエント resume を実装する際もこの 2 property は維持必須。

### Bulk-upsert の concurrency と sequential tree rebuild

`applyBulkUpsert` は blob hash/write を **16 並列**で行うが、tree rebuild は逐次 ([vault-namespace-builder.ts:170-189](../../../apps/growi-vault-manager/src/services/vault-namespace-builder.ts#L170-L189))。これは「各 entry の subtree 書き込みが前の結果に依存して並列化不可」という制約から来る。

- 大規模 bulk reconciliation で律速になる可能性
- tree merge の並列化（disjoint subtree ごとの並列 build）は post-MVP の最適化候補

### Invalid revisionId への防御層

gateway 側で null revision page をスキップしても、防御層として vault-manager の `RevisionModel.bodyQueryByIds` も valid ObjectId のみで `$in` 検索する設計（task 13）。レジリエント resume で新規 op を追加する際も同様の防御層をかけること。

### 起動時プリフライトと idempotent init

`src/index.ts` の起動時に必須環境変数チェックと MongoDB ping を行い、いずれか失敗すれば `process.exit(1)` する（task 12）。これは k8s の crash-loop による自然な復旧を可能にする。レジリエント resume を実装する際、追加の起動時状態チェック（例: `vault_sync_state.bootstrapState === 'failed'` 検出時の自動再試行）はこのプリフライト枠で実装するのが整合的。

### Test mock の partial mock パターン採用

`vi.mock('./vault-repo-storage.js', () => ({ ... }))` の enumerate 形式は新規 export が増えた際に脆く回帰する（task 14 で表面化）。`vi.mock(import('...'), async (importOriginal) => ({ ...(await importOriginal()), ... }))` の partial mock パターンを採用済み。レジリエント resume で `VaultRepoStorage` に新 API を追加する際もこのパターンを維持すること。
