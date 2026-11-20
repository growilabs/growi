# Brief: growi-vault-manager

## Problem

GROWI Vault 機能において、共有 filesystem 上の bare git repository を維持し、`vault_instructions` 経由で受け取った指示に従って namespace tree を構築・更新し、per-user view ref を合成し、`git upload-pack` を spawn して clone / fetch トラフィックを処理する **内部実行エンジン** が必要である。GROWI ドメイン知識(ACL / PAT / group)を一切持たずに git protocol と namespace 操作だけに集中する独立 service として、新規アプリ `apps/growi-vault-manager` を追加する。

## Current State

- `apps/growi-vault-manager` ディレクトリは未作成
- 既存 `growi-vault` umbrella spec の design.md に各コンポーネント定義・データモデル・file structure は定義済み(`apps/growi-vault-manager/src/` 配下)
- `apps/pdf-converter`(Ts.ED + Puppeteer + 共有 volume)が同種の skeleton を提供しており、デプロイパターンを継承可能
- `.kiro/specs/growi-vault-manager/` ディレクトリは作成済み(空)

## Desired Outcome

- 新規アプリ `apps/growi-vault-manager` が Ts.ED ベースで起動し、apps/app からの内部 RPC のみを受け付ける(security perimeter 外)
- `vault_instructions` コレクションの change stream を購読し、指示種別ごとに namespace tree を更新する
- `compose-view` RPC で per-user view ref を合成し、git upload-pack の対象 ref として提示する
- git smart HTTP の lower-half(info/refs / git-upload-pack)を `git` binary spawn で処理する
- 周期 squash と `git gc` を自走スケジュールで実行する

## Approach

`apps/pdf-converter` の Ts.ED + 共有 volume + Dockerfile スケルトンを継承。bare repo I/O は `isomorphic-git` v1.37.x(blob/tree/commit の write のみ)で実装、ref atomic update と clone 配信は OS の `git` binary v2.30+ に委譲する。共有 fs は dev: local volume / GROWI Cloud: Filestore(POSIX NFS)。MongoDB は `revisions` の **body フィールドのみ ID 指定 lookup** + `vault_instructions` の change stream + `vault_namespace_state` / `vault_user_views` / `vault_sync_state` の RW。

## Scope

- **In**:
  - `ComposeViewController` — `POST /internal/compose-view` の RPC handler
  - `GitProxyController` — `GET /internal/git/info/refs` / `POST /internal/git/git-upload-pack` の handler
  - `VaultInstructionWatcher` — change stream subscriber + 起動時 drain + processedAt 更新 + retry/lastError 記録
  - `VaultNamespaceBuilder` — instruction → blob/tree/commit 構築 + namespace ref 更新(冪等性)
  - `VaultViewComposer` — 複数 namespace tree merge → user view ref 合成(キャッシュキーは sourceVersions)
  - `VaultRepoStorage` — bare repo 操作の抽象(git object I/O)
  - `VaultPathMapper` — ページパス → ファイルパスの純関数(エンコード・衝突解消・orphan 配置)
  - `VaultBlobHasher` — `isomorphic-git` の hashObject による blob 生成
  - `VaultUploadPackSpawner` — `git upload-pack` 子プロセス起動 + stdin/stdout を HTTP body にパイプ
  - `VaultMaintenanceScheduler` — squash + 周期 `git gc` の自走スケジューラ(外部 cron 不要)
  - `SharedSecretAuth` middleware — `Authorization: Bearer <secret>` 検証
  - `revision.ts` model — read-only subset(`_id`, `body` のみ・ID lookup 用)
  - `vault_instruction.ts` model — change stream watch + processedAt 更新
  - `vault_namespace_state.ts` / `vault_user_views.ts` model(owned)
  - `vault_sync_state.ts` model — resume token / lastProcessedAt / watcherInstanceId の write
  - Dockerfile(node + git binary v2.30+ 同梱)+ `package.json` + `tsconfig.json` + `server.ts`
  - Health endpoint(`/health`):MongoDB / change stream / bare repo 到達性チェック

- **Out**:
  - 外部認証(PAT / GROWI session)— `apps/app` 側の責務
  - GROWI ACL 評価ロジック — `apps/app` 側の責務
  - audit log 書き込み — `apps/app` 側の責務(本 spec は `@growi/logger`(pino)による pod ローカルログのみ)
  - admin UI — `apps/app` 側の責務
  - bootstrap 主導 — `apps/app` 側の `VaultBootstrapper` が pages cursor を回す。本 spec は `reset-all` / `bulk-upsert` instruction を steady state と同一パスで処理するだけ
  - shared secret の発行・rotation 機構

## Boundary Candidates

- **instruction processing 境界**: change stream 購読 → op dispatch → 冪等な ref 更新
- **namespace ref 境界**: namespace 単位の単一 main branch + commit 履歴
- **view composition 境界**: namespace 集合 → tree merge アルゴリズム + キャッシュ判定(sourceVersions snapshot)
- **repo I/O 境界**: bare repo 上の object write + ref atomic update
- **path mapping 境界**: ページパス・pageId に対する純関数(エンコード・衝突解消・orphan)
- **upload-pack 境界**: HTTP body ↔ git binary stdin/stdout の双方向 stream pipe
- **maintenance 境界**: squash 周期と `git gc` 周期の自走スケジューリング

## Out of Boundary

- 外部公開 endpoint(本 service は internal only、`apps/app` 経由のみアクセス可)
- bare repo の delta 圧縮・pack format 実装(成熟した `git` binary に委譲)
- pages コレクションの直接 read(page → namespace 判定は `apps/app` に集約)
- 監査ログ専用コレクションの新設(既存 audit log collection に統合済み)
- leader election 機構の自前実装(StatefulSet replicas=1 で物理保証)
- git push / 書き込み受付(将来 spec)

## Upstream / Downstream

- **Upstream**:
  - `vault_instructions` コレクション(`apps/app` が write、本 service が read + processedAt 更新)
  - `revisions` コレクション(read-only, body フィールドのみ ID 指定 lookup)
  - `vault_sync_state` の `bootstrap*` フィールド(`apps/app` owned, 本 service は read のみ)
  - `isomorphic-git` v1.37.x
  - `git` binary v2.30+ (container image 同梱)
  - 共有 filesystem(local / NFS / Filestore)
  - `@growi/core` の DTO 型(`packages/core/src/interfaces/vault/`)

- **Downstream**:
  - `apps/app`(`compose-view` RPC レスポンス + git proxy レスポンス経由)
  - 共有 fs 上の bare repo state(squash / gc を含む)

## Existing Spec Touchpoints

- **Extends**: `growi-vault`(umbrella)の Req 1〜8 のうち、vault-manager に責務が落ちる部分(主に Req 2 のパスマッピング・Req 5 の freshness 反映・Req 6 の ACL 変更伝播の合成側)を実装
- **Adjacent**: `growi-vault-gateway`(同時並列開発、契約共有先)
- **Reference skeleton**: `apps/pdf-converter`(Ts.ED + 共有 volume + Dockerfile パターンの継承元、ただしストレージ層は別選定)

## Constraints

- **GROWI ドメイン知識を持たない**: ACL 評価 / PAT / group の概念を本 service に持ち込まない。namespace 名は不透明な識別子として扱う
- **冪等性**: `vault_instructions` の同一 instruction が複数回処理されても同じ ref 状態に収束すること(at-least-once 配送)
- **memory O(1)**: 30K ページ規模で pack 生成を pack-stream 化する(`git upload-pack` の出力を直接 HTTP body へパイプ)
- **ストレージ**: GROWI Cloud では Filestore(POSIX NFS)必須。GCSFuse は random small object I/O + ref atomic rename をサポートしないため不適。dev は local volume で十分
- **writer 単一化**: `VaultInstructionWatcher` は StatefulSet replicas=1 で物理的に単一化する(leader election なし)。多重起動は `vault_sync_state.watcherInstanceId` で検出のみ可能
- **shared secret 検証**: `Authorization: Bearer <secret>` ヘッダの constant-time 比較。secret は env var only(DB 保存禁止)
- **VaultPathMapper の純関数性**: pagePath / pageId に対する純関数として実装し、reverse-index コレクションを持たない(`vault_namespace_state` の固定サイズ性を保つ)
- **path mapping immutability**: v1 確定後の規則変更は既存 clone 履歴との互換破壊となるため revalidation trigger
