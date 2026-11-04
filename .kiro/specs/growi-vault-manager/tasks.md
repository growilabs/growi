# 実装計画

## タスク概要

本計画は `apps/growi-vault-manager` の実装タスクを依存関係順に整理したものである。アプリスケルトンの構築から始まり、データモデル、ストレージ抽象・パスユーティリティ、instruction builder、view composer、HTTP コントローラ、watcher、メンテナンスの順で実装する。`@growi/core` の Vault DTO 型は `growi-vault-gateway` spec が主導するため、本 spec は import するのみ（タスク内の境界注記に明示）。

---

- [x] 1. アプリスケルトンと開発環境構築
- [x] 1.1 `apps/growi-vault-manager` の Ts.ED + TypeScript プロジェクト scaffold (P)
  - _Requirements: 10.1, 10.4_
  - _Boundary: apps/growi-vault-manager/package.json, tsconfig.json, src/server.ts_

- [x] 1.2 Dockerfile と docker-compose 統合 (P)
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/docker/Dockerfile, docker-compose.yml_

- [x] 1.3 Turborepo タスク設定と pnpm workspace 登録 (P)
  - _Requirements: 10.4_
  - _Boundary: turbo.json, pnpm-workspace.yaml_

---

- [x] 2. Mongoose データモデル
- [x] 2.1 `vault_instructions` Mongoose model（read + processedAt 更新）
  - _Requirements: 1.1–1.6_
  - _Boundary: apps/growi-vault-manager/src/models/vault-instruction.ts_

- [x] 2.2 `revisions` 読み取り専用 Mongoose model（ID lookup 専用）
  - _Requirements: 2.1, 2.2_
  - _Boundary: apps/growi-vault-manager/src/models/revision.ts_

- [x] 2.3 `vault_namespace_state` Mongoose model（owned）
  - _Requirements: 2.1, 4.2_
  - _Boundary: apps/growi-vault-manager/src/models/vault-namespace-state.ts_

- [x] 2.4 `vault_user_views` Mongoose model（owned）
  - _Requirements: 4.2–4.8_
  - _Boundary: apps/growi-vault-manager/src/models/vault-user-view.ts_

- [x] 2.5 `vault_sync_state` Mongoose model（resumeToken / watcher fields のみ書き込み）
  - bootstrap* フィールドは apps/app owned のため read のみ（owner 越境禁止）。
  - _Requirements: 1.1_
  - _Boundary: apps/growi-vault-manager/src/models/vault-sync-state.ts_

---

- [x] 3. ストレージ抽象とパスユーティリティ
- [x] 3.1 `VaultRepoStorage` の実装
  - ref 操作は POSIX atomic rename ベース。同一 OID 既存時は content-addressed で no-op。
  - _Requirements: 9.1–9.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-repo-storage.ts_

- [x] 3.2 `VaultBlobHasher` の実装
  - _Requirements: 2.1, 2.2_
  - _Boundary: apps/growi-vault-manager/src/services/vault-blob-hasher.ts_

- [x] 3.3 `VaultPathMapper` の実装
  - _Requirements: 3.1–3.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-path-mapper.ts_

- [x] 3.4 VaultPathMapper のユニットテスト
  - _Requirements: 3.1–3.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-path-mapper.spec.ts_

---

- [x] 4. SharedSecretAuth middleware
- [x] 4.1 `SharedSecretAuth` middleware の実装
  - secret は `process.env.VAULT_MANAGER_INTERNAL_SECRET` のみ。`crypto.timingSafeEqual` で定数時間比較（timing attack 防止）。
  - _Requirements: 7.1–7.5_
  - _Boundary: apps/growi-vault-manager/src/middlewares/shared-secret-auth.ts_

---

- [x] 5. VaultNamespaceBuilder の実装
- [x] 5.1 `upsert` / `remove` op の実装
  - `op` は `instruction.op`（トップレベル）、ページ固有フィールドは `instruction.payload.*` でアクセスする。
  - _Requirements: 2.1, 2.3, 2.7, 2.8_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.2 `bulk-upsert` op の実装
  - revisions を `$in` 1 クエリ取得し、1 回の tree rebuild・1 commit・1 ref update で完結（N entries でも 1 step）。
  - _Requirements: 2.2, 2.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.3 `rename-prefix` / `grant-change-prefix` op の実装
  - subtree の mount/移動のみで blob 再書き込み不要（content-addressing で OID 不変）。
  - _Requirements: 2.4, 2.5, 2.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 5.4 `reset-all` op の実装
  - `payload.namespace` は undefined 前提（全 namespace 対象）。object pool は保持し後続 upsert で再利用。
  - _Requirements: 2.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

---

- [x] 6. VaultViewComposer の実装
- [x] 6.1 full merge と cache hit の実装
  - `sourceVersions` 一致時は recompose せず既存 `viewCommitOid` を返す（キャッシュヒット）。
  - _Requirements: 4.1–4.3, 4.5, 4.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

- [x] 6.2 delta merge の実装
  - 変動 namespace のみ再計算し他は base の subtree OID を継承。base が gc 消失なら full merge にフォールバック。
  - _Requirements: 4.4, 4.8_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

- [x] 6.3 衝突解消ロジックの実装
  - 同一 path に複数 namespace のエントリがある場合の優先順位: `user-<uid>-only-me` > `group-*` > `restricted-link` > `public`。
  - _Requirements: 4.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

---

- [x] 7. HTTP Controllers の実装
- [x] 7.1 `ComposeViewController` の実装
  - _Requirements: 4.1_
  - _Boundary: apps/growi-vault-manager/src/controllers/compose-view-controller.ts_

- [x] 7.2 `GitProxyController` の実装
  - stdout をフルバッファリングせず HTTP body に直接 pipe（メモリ O(1)）。
  - _Requirements: 5.1–5.5_
  - _Boundary: apps/growi-vault-manager/src/controllers/git-proxy-controller.ts_

- [x] 7.3 `HealthController` の実装
  - SharedSecretAuth を適用しない（k8s liveness probe はヘッダを付けないため）。
  - _Requirements: 8.1–8.4_
  - _Boundary: apps/growi-vault-manager/src/controllers/health-controller.ts_

- [x] 7.4 `StorageStatsController` の実装
  - `vault_namespace_state` 集約で O(repo size) の重い処理を避ける。owner 越境回避の専用 RPC。
  - _Requirements: 11.1–11.5_
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

---

- [x] 8. VaultUploadPackSpawner の実装
- [x] 8.1 `VaultUploadPackSpawner` の実装
  - `GIT_NAMESPACE=<viewRef>` と `uploadpack.allowAnySHA1InWant=false`（git デフォルト）で namespace 外 OID の直接 fetch を禁止。
  - _Requirements: 5.1–5.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-upload-pack-spawner.ts_

---

- [x] 9. VaultInstructionWatcher の実装
- [x] 9.1 change stream 購読と起動時 drain の実装
  - resumeToken による resume と起動時 drain を併用し、`processedAt != null` チェックで at-least-once 配送の冪等性を保証する。
  - _Requirements: 1.1–1.4, 1.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts_

- [x] 9.2 失敗時リトライ処理の実装
  - 失敗時は `attempts++` / `lastError` を記録し `processedAt: null` を維持、成功時のみ `processedAt` を更新する。
  - _Requirements: 1.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts_

---

- [x] 10. VaultMaintenanceScheduler の実装
- [x] 10.1 Squash スケジューラの実装
  - 同 namespace の squash と upsert を直列化（ref 競合防止）。
  - _Requirements: 6.1–6.3, 6.6_
  - _Boundary: apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts_

- [x] 10.2 GC スケジューラの実装
  - _Requirements: 6.4, 6.5, 6.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts_

---

- [x] 11. インテグレーションテストと E2E 検証
- [x] 11.1 clone E2E インテグレーションテスト
  - _Requirements: 1.1, 5.1–5.3, 8.4_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

- [x] 11.2 instruction 冪等性インテグレーションテスト
  - _Requirements: 2.2, 2.4, 2.7_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

- [x] 11.3 compose-view キャッシュとメンテナンスのインテグレーションテスト
  - gc 実行中に clone を開始しても clone が破壊されないことを含む。
  - _Requirements: 4.3, 6.2–6.3_
  - _Boundary: apps/growi-vault-manager/src/**/*.integ.ts_

---

- [x] 12. 起動時プリフライトチェック
- [x] 12.1 必須環境変数の検証
  - 欠落時は欠けた変数名を列挙して `process.exit(1)`（k8s crash-loop で自然復旧）。
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [x] 12.2 MongoDB 接続確認
  - 接続確認後は接続を閉じず Ts.ED bootstrap に引き継ぐ。
  - _Boundary: apps/growi-vault-manager/src/index.ts_

- [x] 12.3 プリフライトチェックの単体テスト
  - 環境変数チェックと MongoDB ping を純粋関数として切り出し単体テスト可能にする。
  - _Boundary: apps/growi-vault-manager/src/preflight.ts、apps/growi-vault-manager/src/preflight.spec.ts_

---

- [x] 13. invalid revisionId 防御策の追加（**P0 / 最優先・結合試験ブロッカー**）

  apps/app から渡される `revisionId` に空文字列や ObjectId 形式違反値が混入すると `RevisionModel.bodyQueryByIds` が `Cast to ObjectId failed` で throw し bulk-upsert が失敗継続する。一次責務は apps/app 側（gateway タスク 18）だが、vault-manager 側にも防御層を設けリグレッション・将来のデータソースに耐性を持たせる。

- [x] 13.1 RevisionModel に valid-id フィルタリングを追加（タスク 2.2 の追補）
  - `mongoose.Types.ObjectId.isValid(id)` で filter してから `$in` 検索する。
  - _Boundary: apps/growi-vault-manager/src/models/revision.ts_

- [x] 13.2 bulk-upsert ハンドラで invalid revisionId を skip し warn ログに残す（タスク 5.2 の追補）
  - revisionMap に hit しない entry は body 空扱いとし、skip 件数を構造化 warn ログに出力する。
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 13.3 dead-letter 検知の強化
  - `attempts >= 5` 到達時に watcher が error ログを出し、`/internal/storage-stats` から `stuckInstructionCount` を観測可能にする。
  - _Boundary: apps/growi-vault-manager/src/services/vault-instruction-watcher.ts、apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

---

- [x] 14. ユニットテスト回帰修正（**P0 / Critical**）

  コミット `705b3257fe` で追加された `VaultRepoStorage.ensureNamespaceHead` に `vault-view-composer.spec.ts` の enumerate 形式 `vi.mock` が追従できず、`No "ensureNamespaceHead" export is defined on the mock` で 10/152 ケースが失敗した。緑化したうえで enumerate 形式の脆性自体を partial mock パターンへ置換する。

- [x] 14.1 `vault-view-composer.spec.ts` の mock に `ensureNamespaceHead` を追加して緑化（最小修正）
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.spec.ts_

- [x] 14.2 enumerate 形式の `vi.mock` を partial mock パターンへ移行（再発防止）
  - `vi.mock(import('...'), async (importOriginal) => ({ ...(await importOriginal()), ... }))` 形式に置換し、新 export 追加時の回帰を防ぐ。
  - _Boundary: apps/growi-vault-manager/src/services/*.spec.ts、apps/growi-vault-manager/src/__tests__/*.integ.ts_

---

- [x] 15. VaultMaintenanceScheduler の production 配線（**P0 / Critical**）

  Task 10.1/10.2 で factory は実装されたが `index.ts` の bootstrap で起動されておらず、`storage-stats-controller.ts` も `lastSquashAt`/`lastGcAt` を null ハードコードしていた。これにより要件 6.7（外部 cron 不要の自走）と 11.4（lastSquashAt/lastGcAt の値返却）が未成立だった。

- [x] 15.1 `index.ts` で MaintenanceScheduler を起動し module-level singleton として保持
  - StorageStatsController から import 可能にし、SIGTERM/SIGINT で `scheduler.stop()` を呼ぶ。
  - _Boundary: apps/growi-vault-manager/src/index.ts、apps/growi-vault-manager/src/services/vault-maintenance-scheduler-instance.ts_

- [x] 15.2 `StorageStatsController` を scheduler singleton に接続して実値を返す
  - `getLastSquashAt()` / `getLastGcAt()` を `Date | null` → ISO 8601 文字列に変換。未実行時は null（要件 11.4）。
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.ts_

- [x] 15.3 `storage-stats-controller.spec.ts` を scheduler singleton 経由のレスポンスで再構成
  - _Boundary: apps/growi-vault-manager/src/controllers/storage-stats-controller.spec.ts_

---

- [x] 16. インテグレーションテストの CI 実行可能化（**P1 / Important**）

  Task 11.1/11.2/11.3 の `__tests__/*.integ.ts` 3 ファイルは全て `describe.skip` で wrap され CI で実行されず自動回帰検出がなかった。env 駆動の条件付き実行に切り替え、最低 1 シナリオを CI に組み込む。

- [x] 16.1 `describe.skip` を env 駆動の条件付き実行に置き換え
  - `(process.env.RUN_VAULT_INTEG === 'true' ? describe : describe.skip)(...)` 形式に変更する。
  - _Boundary: apps/growi-vault-manager/src/__tests__/*.integ.ts_

- [x] 16.2 CI ジョブで integration テストを最低 1 ジョブ実行可能にする
  - 本番は別リポジトリの growi-docker-compose、dev は devcontainer 直起動のため、本リポジトリには CI 専用 docker-compose を設けず CI workflow 内で MongoDB（replica set 必須）と vault-manager を起動する。
  - _Boundary: apps/growi-vault-manager/package.json、.github/workflows/ci-vault.yml_

---

- [x] 17. ユーザ向けドキュメント整備（umbrella spec 由来 / **P1 / Important**）

  umbrella spec の "User-facing Documentation Deliverables" 3 件（path-to-filename マッピング規則、`git sparse-checkout` 手順、MVP 範囲外項目）が未配置だった。配置先は manager design.md でも宣言済みの `apps/growi-vault-manager/README.md`。

- [x] 17.1 `apps/growi-vault-manager/README.md` を新規作成し path-to-filename マッピング規則を記載
  - _Requirements: 要件 2.6 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

- [x] 17.2 README に `git sparse-checkout` で `/user` 配下を除外する手順を追記
  - sparse-checkout は手元 checkout 範囲のみ制御し、サーバ側で配信される object 範囲は変わらない旨を明記する。
  - _Requirements: 要件 2.8 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

- [x] 17.3 README に MVP 範囲外項目を明示
  - _Requirements: 要件 8 (umbrella)_
  - _Boundary: apps/growi-vault-manager/README.md_

---

- [x] 18. Dockerfile を DHI 採用のモダン構成にリファクタ（**P1 / Important**）

  `apps/app/docker/Dockerfile` は DHI（Docker Hardened Images）+ turbo prune の多段ビルドへ移行済みだが、vault-manager は `node:24-alpine` + `apk add git` の旧構成のままでキャッシュ効率・runtime 攻撃面・monorepo subset 抽出で齟齬がある。apps/app と同じ流儀に揃え、vault-manager 固有の制約（runtime で `git upload-pack` を spawn するため git binary v2.30+ 必須）に対応する。

- [x] 18.1 release stage の git binary 取得戦略を確定（前提調査）
  - DHI distroless は shell も binary も持たないため、git v2.30+ を runtime に持ち込む方針を確定し記録する。採用方針: design.md「Dockerfile 構成戦略」参照。
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/docker/Dockerfile（または .kiro/specs/growi-vault-manager/design.md の補足記述）_

- [x] 18.2 multi-stage 構成へリファクタ（DHI base + turbo prune）
  - `base` / `pruner` / `deps` / `builder` / `release` の 5 stage 構成に書き換える。
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/docker/Dockerfile_

- [x] 18.3 専用 Dockerfile.dockerignore の追加
  - _Requirements: 10.2_
  - _Boundary: apps/growi-vault-manager/docker/Dockerfile.dockerignore_

- [x] 18.4 OCI 標準 label の付与
  - _Requirements: 10.2_
  - _Boundary: apps/growi-vault-manager/docker/Dockerfile_

- [x] 18.5 既存ワークフロー / CI 互換性確認
  - 別リポジトリ growi-docker-compose からの参照は越境のため別 PR で告知。
  - _Requirements: 10.2, 10.3_
  - _Boundary: apps/growi-vault-manager/README.md（必要に応じて）、.github/workflows/ci-vault.yml（必要に応じて）_

---

- [x] 19. markdown ファイル化ルールの見直し（collision-only・section-index 不採用）（**設計変更 / タスク 3.3・3.4・17.1 を supersede**）

  当初の「大文字を含むパスに `pageId.slice(0,8)` の suffix を常時付与」ルール（3.3/3.4）には 2 つの問題があった。(a) ObjectId の先頭 8 文字は作成時刻（秒）であり、同一秒に作成されたページで suffix が衝突して一意性が成立しない実装バグ。(b) 大文字を含むほぼ全ページに `__hash` が付き clone が雑然とする。requirements 3.5 / 4.9–4.11 の改訂に従い、`map()` から suffix と pageId を除去し、大小衝突の解消のみを compose 時の per-view tree 正規化（collision-only・reactive）へ移す。section-index（子を持つページの本文を README.md へ集約）は、子の増減で親ファイルが rename される churn を理由に採用しない（子を持つページも `<name>.md` のままフォルダ `<name>/` の隣に置く）。

- [x] 19.1 VaultPathMapper から大文字 suffix と pageId 引数を除去（TDD）
  - _Requirements: 3.1, 3.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-path-mapper.ts, vault-path-mapper.spec.ts_

- [x] 19.2 map() 呼び出し側を新シグネチャに追従
  - pageId は commit メタデータ用途では引き続き保持する。
  - _Depends: 19.1_
  - _Requirements: 3.5_
  - _Boundary: apps/growi-vault-manager/src/services/vault-namespace-builder.ts_

- [x] 19.3 (P) VaultTreeNormalizer（compose 時の大小衝突 suffix・reactive）を新規実装（TDD）
  - 純関数（merged tree → normalized tree）。hash は付与前 filePath の SHA-1 先頭 8 文字。付与有無の状態は永続化しない。
  - _Requirements: 4.9, 4.10, 4.11_
  - _Boundary: apps/growi-vault-manager/src/services/vault-tree-normalizer.ts, vault-tree-normalizer.spec.ts_

- [x] 19.4 VaultViewComposer に normalizer を配線（full / delta 双方）
  - ACL 優先順位衝突解消（6.3）とは別レイヤー。適用順序は ACL merge → tree 正規化。キャッシュヒット時は normalizer ごとスキップ。
  - _Depends: 19.3_
  - _Requirements: 4.9, 4.10, 4.11_
  - _Boundary: apps/growi-vault-manager/src/services/vault-view-composer.ts_

- [x] 19.5 (P) README のファイル名マッピング規則を新ルールに更新（タスク 17.1 の改訂）
  - _Depends: 19.1_
  - _Requirements: 3.5, 4.10_
  - _Boundary: apps/growi-vault-manager/README.md_

- [x] 19.6 clone E2E インテグレーションテストを新ルールで検証（タスク 11.1 の追補）
  - _Depends: 19.4_
  - _Requirements: 4.10, 4.11_
  - _Boundary: apps/growi-vault-manager/src/__tests__/clone-e2e.integ.ts_

---

- [x] 20. ビュー外 object の要求の拒否（**要件 5.6–5.8 の追加 / 要件 5.4 の保証範囲の訂正**）

  実装後の調査で、要件 5.4 が前提にしていた「`uploadpack.allowAnySHA1InWant=false`（git の既定値）を維持すればビューに広告していない object は取得できない」が commit にしか当てはまらないと実測で判明した（git 2.49.0）。ファイルの中身（blob）とディレクトリの一覧（tree）はビューを越えて取得でき、`gitnamespaces(7)` も namespace が読み取りのアクセス制御に使えないと明記しているため git の設定では解決できない。upload-pack を起動する前に要求 object のビュー ref からの到達性を検査する層を追加する。実測・3 案の比較・性能実測は research.md、検査の位置と内容は design.md「ビュー外 object の要求の拒否」を参照。

- [x] 20.1 (P) want 区間の pkt-line 解析を純関数として実装（TDD）
  - flush までを解析し want の object ID を返す。protocol v2 の delimiter・壊れた長さ・終わらない want 区間（64 KiB 超）は invalid として拒否する。
  - _Requirements: 5.6, 5.7_
  - _Boundary: apps/growi-vault-manager/src/services/vault-pkt-line.ts, vault-pkt-line.spec.ts_

- [x] 20.2 本文先頭の peek と到達性確認を実装（TDD）
  - peek はストリームを閉じない（`for await` は negotiation を失わせ upload-pack がハングする）。到達性は `git merge-base --is-ancestor <要求 ID> refs/namespaces/<viewRef>/refs/heads/main` の 1 コマンドで判定し、非ゼロ終了はすべて拒否とする。重複 ID の排除・異なる ID 64 件の上限・直列実行で作業量を縛る。
  - _Depends: 20.1_
  - _Requirements: 5.6, 5.8_
  - _Boundary: apps/growi-vault-manager/src/services/vault-want-guard.ts, vault-want-guard.spec.ts_

- [x] 20.3 GitProxyController に検査を配線し、拒否応答を実装
  - 拒否は HTTP 200 ＋ pkt-line 1 本の `ERR`。「ビューに無い」と「そもそも存在しない」で文言を共通にする（要件 2.3）。検査済みの先頭は `spawnUploadPack({ stdinPrefix })` で書き戻す。
  - _Depends: 20.2_
  - _Requirements: 5.6, 5.7_
  - _Boundary: apps/growi-vault-manager/src/controllers/git-proxy-controller.ts, apps/growi-vault-manager/src/services/vault-upload-pack-spawner.ts_

- [x] 20.4 漏えいの再現と回帰を結合テストで固定
  - 修正前に「他 namespace のページ本文に対して pack が返る」ことを再現したうえで green に転じることを確認する。full clone / shallow clone / 差分 fetch が従来どおり通ることも同時に固定する。
  - _Depends: 20.3_
  - _Requirements: 5.6_
  - _Boundary: apps/growi-vault-manager/src/__tests__/clone-e2e.integ.ts_

---

- [x] 21. 転送量を絞る手段（**要件 5.9–5.11 の追加** — #11595）

  clone はビューに含まれる object を全量転送し、sparse-checkout も shallow clone も転送量を実質減らせない。git の絞り込み指定のうち、除外をサーバ側で適用して 1 リクエストで完結するのは `sparse:oid` だけで、これは要件 5.6–5.8 の検査を無変更で通る。他の指定は object を ID で名指しする経路を必要とするため必ず拒否されるが、`uploadpack.allowFilter` を種類ごとに分けられない以上、受理してしまう分は明示的に拒否しないと「clone だけ成功して checkout が失敗する」状態になる。実測と案の比較は research.md、設計は design.md「転送量を絞る手段」を参照。

- [x] 21.1 (P) 公開するパターン集合と絞り込み指定の判定を実装（TDD）
  - パターン集合を単一の宣言として持ち、object ID は内容から計算する（repo の状態に依存させない）。判定は公開した `sparse:oid` 以外をすべて拒否側に落とす。README に載せた ID との突き合わせをドリフト検出テストで固定する。
  - _Requirements: 5.9, 5.10_
  - _Boundary: apps/growi-vault-manager/src/services/vault-sparse-filter.ts, vault-sparse-filter.spec.ts_

- [x] 21.2 want 区間の解析に `filter` 行の収集を足す（TDD）
  - `want` の capability 列に現れる `filter` という語（能力の宣言）と、`filter <指定>` 行（実際の要求）を混同しないこと。本文は一切書き換えずに upload-pack へ渡す性質を保つ。
  - _Depends: 21.1_
  - _Requirements: 5.9_
  - _Boundary: apps/growi-vault-manager/src/services/vault-pkt-line.ts, vault-want-guard.ts, および各 spec_

- [x] 21.3 GitProxyController に判定を配線し、`allowFilter` を有効化して起動時にパターン集合を設置
  - 判定は到達性の確認より前に置く（安く済み、`blob:none` を渡した利用者に最も有用な文言を返せる）。拒否応答には対応している指定の形を含める。パターン集合は `refs/vault/sparse-filters/<name>` から参照させ、起動ごとに再設置する。
  - _Depends: 21.2_
  - _Requirements: 5.9, 5.10, 5.11_
  - _Boundary: apps/growi-vault-manager/src/controllers/git-proxy-controller.ts, vault-upload-pack-spawner.ts, server-runtime.ts_

- [x] 21.4 clone の end-to-end を結合テストで固定
  - `--filter=sparse:oid=<公開 ID>` ＋ sparse-checkout で `user/` 配下が作業ツリーに現れず、その中身が clone の object 置き場にも存在しないこと（＝転送されていないこと）を確認する。`--filter=blob:none` が clone の時点で拒否されることも同時に固定する。
  - _Depends: 21.3_
  - _Requirements: 5.9_
  - _Boundary: apps/growi-vault-manager/src/__tests__/clone-e2e.integ.ts_

- [x] 21.5 README を実際に動く手順に直す
  - `--no-cone` ＋ `--stdin` の sparse-checkout 手順、`--filter=sparse:oid=<公開 ID>` の手順、filter 付き clone の以後の制約（除外したページは取得できない）、他の指定が拒否されること、`--depth=1` の削減幅が小さい理由を書く。
  - _Depends: 21.4_
  - _Requirements: 5.9, 5.11_
  - _Boundary: apps/growi-vault-manager/README.md_

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

### リクエスト本文を検査するときストリームを閉じてはいけない

want の検査には本文の先頭が必要だが、本文は upload-pack にそのまま全部渡さなければならない。`for await` で読むと抜けた時点でストリームが閉じ、want 区間の後ろにある negotiation（`done` 等）が失われて upload-pack が入力待ちのまま応答しなくなる（shallow clone のハングとして顕在化した）。`pause()` で止めて listener を外し、読み取った先頭を `stdinPrefix` で書き戻す形にしている。回帰は「読み取った先頭 ＋ 残り == 元の本文」という等式で固定した。同じ経路に手を入れるときはこの等式を壊さないこと。

### 検査の作業量はクライアントに決めさせない

要求 1 件ごとに git プロセスが必要なため、`Promise.all` で素朴に並列化すると 1 リクエストで大量のプロセスを起動できる（want 区間 64 KiB に want 行は約 1,310 行入り、実測で同時 1,310 プロセス・1.3 秒）。重複 ID の排除・異なる ID 64 件の上限・直列実行の 3 点で縛っている。外部が件数を決められる入力に対してプロセスを起動する実装を足すときは同じ縛りを検討すること。

### 絞り込み指定は種類ごとに有効化できない

`uploadpack.allowFilter` は「絞り込みに対応している」という 1 つの合図で、指定の種類を選べない。したがって「1 種類だけ対応する」は、サーバ設定ではなく**リクエストの検査**で実現するしかない。有効化しただけの状態は、対応していない指定を渡した利用者にとって有効化前より悪い（clone は成功し checkout が空のまま失敗する）ので、有効化と検査は必ず同じ変更で入れる。

### Test mock の partial mock パターン採用

`vi.mock('./vault-repo-storage.js', () => ({ ... }))` の enumerate 形式は新規 export が増えた際に脆く回帰する（task 14 で表面化）。`vi.mock(import('...'), async (importOriginal) => ({ ...(await importOriginal()), ... }))` の partial mock パターンを採用済み。レジリエント resume で `VaultRepoStorage` に新 API を追加する際もこのパターンを維持すること。
