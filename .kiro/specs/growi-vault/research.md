# Research & Design Decisions

---
**Purpose**: Discovery findings, architectural investigations, and rationale for the growi-vault design.
---

## Summary

- **Feature**: `growi-vault`
- **Discovery Scope**: New Feature（Greenfield）— GROWI に git 連携コードは存在しない
- **Final Architecture**: **Option III — apps/app gateway + apps/growi-vault-manager backend executor**
- **Key Findings**:
  - 10,000+ ページ規模を MVP スコープに含めるため、in-process の isomorphic-git + memfs 仮想リポジトリ案を破棄し、**bare repo + git binary + namespace** に方針転換
  - vault-manager をエンドユーザー非公開の内部マイクロサービスとし、apps/app を唯一の security perimeter とする 2 層構造を採用
  - apps/app → vault-manager の指示伝達は MongoDB outbox + change stream で実装（Redis 不採用）
  - 共有 filesystem は環境別に local fs / NFS / GCSFuse / Filestore のいずれかを選択（pdf-converter のデプロイパターン継承）

---

## Research Log

### git ライブラリ・サーバ実装の選定

- **Context**: Node.js / TypeScript で git smart HTTP サーバーを実装する手段を選定する必要がある
- **Sources**:
  - isomorphic-git GitHub (v1.37.x)
  - nodegit GitHub (最終リリース 2020-07-28)
  - Antora Issue #264: nodegit → isomorphic-git 移行
  - Cloudflare Artifacts: git for Agents blog post
  - git protocol v2 / pack format / namespaces 公式ドキュメント
- **Findings**:
  - isomorphic-git の `packObjects` は Promise<Uint8Array> 返却でストリーミング非対応 → 10K+ ページで memory blowup
  - nodegit は 2020 年以降放棄済み、採用不可
  - **git binary `git upload-pack`**: 成熟した実装、delta 圧縮・protocol v2 自動、pack format バグリスクなし
  - git namespaces (`refs/namespaces/<ns>/...`): 単一 bare repo 内で複数 ref 集合を分離できる。`GIT_NAMESPACE` 環境変数で upload-pack 時に切り替え
- **Implications**: 10,000+ ページ MVP 要件を満たすには、git binary と bare repo の組み合わせが最適。namespace を ACL の表現に活用できる

### GROWI コードベース既存実装調査

- **Context**: feature を apps/app + 新マイクロサービスに追加する際の既存パターンと依存関係を確認
- **Findings**:
  - PAT: `apps/app/src/server/middlewares/access-token-parser/` に実装済み。SHA-256 hash + scope match。`AccessToken.findUserIdByToken` が pure 検証クエリとして利用可能
  - Page ACL: `grant` (GRANT_PUBLIC=1, GRANT_RESTRICTED=2, GRANT_OWNER=4, GRANT_USER_GROUP=5) + `grantedGroups` (`{type: 'UserGroup'|'ExternalUserGroup', item: ObjectId}`) で管理
  - ACL 評価: `generateGrantCondition()` (`page.ts` L1287) と `isUserGrantedPageAccess()` (`page-grant.ts` L1137) は既に pure
  - User group 解決: `UserGroupRelation.findAllUserGroupIdsRelatedToUser` 利用可能
  - Feature pattern: `src/features/{name}/server/{routes,services,models}` 構成
  - pdf-converter: Ts.ED ベースのマイクロサービス。GROWI Cloud では FUSE GCS マウント、dev では docker-compose で local volume
  - git 関連コードなし
  - MongoDB: replica set 必須（既存 transaction 要件）→ change stream 利用可能
  - @growi/core: IPage, IUser, IRevision, IUserGroup, IUserGroupRelation, PageGrant constants, Scope, Ref<T>, isPopulated 等が既に export 済み
- **Implications**: apps/app の既存 ACL/PAT 評価ロジックをそのまま再利用できる。vault-manager は @growi/core の DTO 型のみ依存し、ドメインロジックを持たない設計が成立する

### GROWI Cloud デプロイパターン調査

- **Context**: vault-manager の運用形態（in-process feature vs separate microservice、共有 fs の選択）
- **Findings**:
  - GROWI Cloud では pdf-converter が独立コンテナとしてデプロイされ、apps/app と GCSFuse バケットを共有
  - pdf-converter の役割: apps/app が GCSFuse に markdown を書き出し → pdf-converter が変換 → apps/app が結果を読む（sequential single-file I/O）
  - GCSFuse は sequential I/O では性能良好、small object 大量読み取りでは latency が問題
  - Filestore（GCP managed NFS）は POSIX semantics + 真の file locking + 低 latency で git ワークロードに適している
  - k8s NetworkPolicy で「apps/app から vault-manager へのみアクセス許可」が表現可能
- **Implications**: vault-manager を pdf-converter と同形のマイクロサービスとして実装することで、デプロイ・スケール・観測パターンが既存運用と整合する。bare repo は「常に packed」運用と組み合わせれば GCSFuse でも実用可

---

## Architecture Pattern Evaluation

### 主要候補比較（最終評価）

| Option | 概要 | Strengths | Risks / Limitations | 判定 |
|--------|-------------|-----------|---------------------|------|
| (旧案) `apps/app` feature + isomorphic-git + memfs | リクエスト毎に in-memory 仮想リポジトリ生成 | 単一プロセス完結、実装シンプル | **10,000 ページで 200-300MB memory / req → 破綻** | ❌ 撤回 |
| (代替案) `apps/app` feature + custom streaming pack encoder + MongoDB cursor | pack format を自前実装、blob を cursor で stream | memory O(1)、pure TS | pack format 実装リスク大、delta 圧縮なし、~1500 LOC | ❌ 不採用 |
| (代替案) per-user bare repo + git binary | per-user に repo 持つ | memory O(1)、成熟 | repo 数爆発、storage 重複 | ❌ 不採用 |
| (代替案) external git service (GitLab/Gitea) 中継 | 既存 git service を proxy | 既存基盤再利用 | per-user ACL 困難、push amplification、外部依存 | ❌ 不採用 |
| (代替案) Option II: vault-manager が apps/app の internal API を pull | vault-manager が外部公開 + 自前 auth | DTO 契約のみで domain 知識不要 | security perimeter が 2 箇所、vault-manager 認証経路必要 | ❌ 不採用 |
| **Option III: apps/app gateway + vault-manager backend** | apps/app が認証境界、vault-manager は内部実行エンジン | **single security perimeter、vault-manager に domain 知識最小、独立スケール、既存 GROWI 運用パターン整合** | apps/app に proxy ロジック追加、vault-manager は最低限 pages/revisions スキーマを知る | ✅ **採用** |

### 通信路の選定（apps/app → vault-manager）

| 案 | Strengths | Risks | 判定 |
|---|---|---|---|
| Redis Pub/Sub | 既存パターン | Redis インフラ依存、durability 弱 | ❌ 不採用（Redis なし要件） |
| MongoDB change stream（pages 直接購読） | 即時性 | vault-manager が ACL/grant フィールド変更の意味を再解釈する必要 | ❌ domain 知識増 |
| **MongoDB outbox（vault_instructions）+ change stream** | durable、real-time、apps/app と vault-manager 疎結合、replica set は既存要件 | コレクション 1 つ追加 | ✅ **採用** |
| HTTP RPC（apps/app → vault-manager 同期 push） | シンプル | vault-manager が落ちると指示喪失 | △ clone 時の compose-view にのみ採用 |

### 共有 filesystem の選定

| 環境 | 選択 | 理由 |
|---|---|---|
| dev / docker-compose | local fs（bind mount） | 単一 pod、開発体験優先 |
| selfhost（単一 pod） | local fs | シンプル |
| selfhost（multi pod） | NFS（Filestore / EFS / 自前 NFS） | POSIX semantics、ref lock 動作保証 |
| GROWI Cloud | GCSFuse（pdf-converter パターン継承）または Filestore | 既存運用ノウハウ流用、または性能優先で Filestore |

### 認証境界の選定

- **採用: single security perimeter at apps/app** — vault-manager は外部からアクセス不可、apps/app だけが Ingress に登録される
- **理由**:
  1. PAT / ACL / scope の評価が既存 apps/app に集約されているため、認証実装の重複を避ける
  2. vault-manager に外部 auth エンドポイントを設けると、shared secret や mTLS の管理が二重に必要
  3. 失敗モードがシンプル（apps/app が落ちれば全体停止、vault-manager 単体は外部から見えない）

---

## Design Decisions

### Decision 1: アプリ構成は `apps/app` + `apps/growi-vault-manager` の 2 アプリ構成

- **Context**: vault の git serving は CPU/メモリを使う heavy workload。pdf-converter のように独立サービス化するか、apps/app feature として実装するか
- **Alternatives Considered**:
  1. apps/app feature 一体型 — CPU/memory 分離なし、独立スケール不可、main app への影響リスク
  2. apps/growi-vault-manager マイクロサービス — pdf-converter と同パターン、独立スケール、CPU/memory 分離
- **Selected Approach**: マイクロサービス化（apps/growi-vault-manager）
- **Rationale**: AI agent の定期 pull など中程度負荷を想定すると、main app の SLA を侵食しないよう分離が妥当。GROWI Cloud の k8s リソース管理パターンと整合
- **Trade-offs**: dev で起動コンテナが 1 つ増える、deploy artifact が 2 つになる
- **Follow-up**: docker-compose / turbo dev での起動手順整備

### Decision 2: 認証境界は `apps/app` に集約、vault-manager は内部専用

- **Context**: vault-manager が外部公開されるべきか、apps/app 経由 proxy のみとするか
- **Alternatives Considered**:
  1. vault-manager 直接公開 + 自前 PAT 認証 — vault-manager に domain 知識が必要
  2. apps/app gateway pattern — vault-manager は内部のみ、shared secret で service-to-service 認証
- **Selected Approach**: apps/app gateway + vault-manager 内部専用
- **Rationale**: security perimeter を 1 箇所に集約することで認証実装重複を避け、vault-manager の責務を「git protocol speaker + namespace executor」に純化できる
- **Trade-offs**: apps/app に proxy ロジック追加が必要（streaming HTTP forward）

### Decision 3: bare repo + git binary + namespace モデルを採用

- **Context**: 10,000+ ページ MVP で memory O(1) を達成する手段
- **Alternatives Considered**:
  1. isomorphic-git + memfs（仮想 repo）— memory blowup
  2. Custom streaming pack encoder — pack format 実装リスク、delta 圧縮なし
  3. **bare repo + `git upload-pack` spawn** — 成熟、delta 自動、protocol v2 対応
- **Selected Approach**: 単一 bare repo + 各 ACL 種別を namespace で表現（`refs/namespaces/<public|group-*|user-*-only-me|user-*-view>/refs/heads/main`）+ `git upload-pack` を子プロセスで spawn
- **Rationale**: GROWI の ACL モデル（public + group ≤数十 + user-private）が namespace 数を小さく保てるため namespace ベース設計と相性が良い。git binary に pack format / delta / protocol を委譲することで実装リスクを最小化
- **Trade-offs**: container image に git binary 同梱（`apk add git`）、disk persistence 必要
- **Follow-up**: 「常に packed」運用の周期 `git repack` ジョブ設計

### Decision 4: per-user view ref は namespace tree merge による合成

- **Context**: ユーザー固有のクローン view を per-user repo / per-user namespace のいずれで表現するか
- **Alternatives Considered**:
  1. per-user repo（独立 repo） — repo 数爆発、object pool 重複
  2. per-user namespace ref を VaultSyncWorker が事前構築 — write amplification（1 page edit で N 影響ユーザー分の ref 更新）
  3. **per-user view ref を lazy 合成（clone 時に compose）** — write amplification なし、namespace 単位の write のみ
- **Selected Approach**: ACL 種別ごとの namespace tree を維持、clone 時に accessible namespaces を tree merge して `user-<uid>-view` ref を生成
- **Rationale**: namespace tree は content-addressed で再利用可能。compose-view は path-level の union 演算で ms オーダー。`vault_user_views.sourceVersions` キャッシュで同 versions の reuse
- **Trade-offs**: 初回 clone と namespace 変動後の clone で compose 処理が走る（ただし軽量）

### Decision 5: 通信路は MongoDB outbox + change stream（Redis 不採用）

- **Context**: apps/app から vault-manager への page 変更通知の伝送方式
- **Alternatives Considered**:
  1. Redis Pub/Sub — Redis インフラ依存、durability 弱
  2. HTTP RPC fire-and-forget — vault-manager 落下時に指示喪失
  3. MongoDB change stream on `pages` 直接 — vault-manager が ACL 変更の意味を再解釈する必要
  4. **MongoDB outbox（vault_instructions）+ change stream** — durable、real-time、責務分離
- **Selected Approach**: apps/app が `vault_instructions` に instruction を insert、vault-manager が change stream + 起動時 drain で受信
- **Rationale**: GROWI 既存の MongoDB replica set 要件と一致、追加 infra 不要、durable
- **Trade-offs**: 専用コレクション 1 つ追加、TTL index で自動 cleanup

### Decision 6: shared secret は env var only（DB 保存なし）

- **Context**: apps/app ↔ vault-manager の service-to-service 認証手段
- **Alternatives Considered**:
  1. mTLS — 証明書ローテーション運用負担
  2. shared secret in DB — admin UI 経由の誤公開リスク
  3. **shared secret in env var only** — シンプル、k8s Secret で配布
- **Selected Approach**: `config-definition.ts` に env-only 設定として定義、両 pod に同一 env var を注入
- **Rationale**: GROWI Cloud は k8s Secret 機構が前提、運用が単純化
- **Trade-offs**: secret rotation 時に rolling restart が必要（運用手順を文書化）

### Decision 7: 監査ログは既存 audit log collection を再利用

- **Context**: clone / fetch / auth-failure の監査記録の置き場所
- **Alternatives Considered**:
  1. 新規 `vault_audit_logs` コレクション — collection 1 つ増、UI 統合追加コスト
  2. **既存 GROWI audit log を再利用** — 既存 admin UI でフィルタ可能、運用一元化
- **Selected Approach**: apps/app の VaultGatewayRouter から既存 audit log infra に書く（vault-manager は監査ログを書かない）
- **Rationale**: 認証境界が apps/app なので auth event は apps/app が観測する。既存ログ基盤に統合する方が管理者体験が良い

### Decision 8: パスマッピング・ACL 規則は v1 確定後 immutable

- **Context**: パス変換規則・namespace 設計・GRANT_RESTRICTED の扱いを変更すると既存 clone 履歴が壊れる
- **Selected Approach**: v1 リリース時の規則を固定し、変更時は明示的な migration / 全 user re-clone を要求
- **Rationale**: git の content-addressing は決定的なため、変換規則の変更で OID が変わると差分検出が破綻

---

## Synthesis Outcomes

### Generalization

- ACL 評価（Req 3.1–3.5, 6.1–6.3, 4.3）は apps/app の `VaultNamespaceMapper` 1 箇所に集約できる
- freshness 関連（Req 1.2, 5.1–5.4, 6.x）は `VaultDispatcher → vault_instructions → VaultInstructionWatcher` のパイプライン 1 本に集約できる
- per-user view（Req 1.1, 3.5）は namespace tree merge による合成で表現できる

### Build vs Adopt

- **Adopt**:
  - git binary（pack 生成・upload-pack）
  - isomorphic-git（hashObject、blob/tree/commit write、ref 操作）
  - 既存 access-token-parser（PAT 検証）
  - 既存 generateGrantCondition / isUserGrantedPageAccess（ACL 評価）
  - 既存 audit log infra
  - GROWI EventEmitter（page 変更 in-process event）
  - MongoDB change stream
  - Ts.ED（vault-manager の skeleton）
- **Build**:
  - VaultGatewayRouter（apps/app 側の proxy + auth + ACL）
  - VaultNamespaceMapper（ACL → namespace 計算）
  - VaultDispatcher（event → outbox 書き込み）
  - VaultInstructionWatcher（change stream subscriber）
  - VaultNamespaceBuilder（指示実行）
  - VaultViewComposer（tree merge）
  - VaultPathMapper（パス変換）

### Simplification

- vault-manager に GROWI ドメイン知識（PAT, ACL, group resolution, scope）を **持ち込まない**
- audit log を専用コレクション化せず既存基盤に統合
- shared secret を DB に保存せず env のみ
- @growi/core への抽出は最小限（DTO 型追加のみ、pure utility 抽出は不要）

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 10,000+ ページ規模での memory blowup | git binary spawn により Node.js プロセスは O(1) memory |
| GCSFuse での git ワークロード性能 | 「常に packed」運用 + 周期的 `git repack`、または Filestore 切替 |
| ref lock 競合（multi-pod） | MVP では vault-manager は leader-elected single writer。MongoDB-based leader election |
| vault_instructions の lag / 滞留 | 未処理件数を admin 画面に surface、retry 機構 + alert |
| パスエンコーディング規則の breaking change | v1 確定後 immutable、変更時は revalidation trigger として明示 |
| isomorphic-git のメジャーバージョンアップ | object I/O のみに利用するため API 影響範囲は限定的、integration test で保護 |
| shared secret 漏洩 | env only、rotation 手順を文書化 |
| change stream resume token 期限切れ | 起動時 drain で `processedAt: null` を全件処理する保険 |

---

## Resolved Concerns

> 過去のセッションで「未解決の設計課題」として記録されていた以下の懸念は、本 spec で **Option III** を採用したことにより全て解決された。

### ✅ 旧懸念 1: 全データのオンメモリ展開

**旧問題**: isomorphic-git の `packObjects()` がストリーミング非対応で、10,000+ ページで 200-300MB memory/req 消費

**解決**: bare repo + `git upload-pack` 子プロセス spawn により、pack 生成は git binary が担当。Node.js プロセスは HTTP body の forward のみで O(1) memory。`packObjects` API そのものを採用しない方針に転換

### ✅ 旧懸念 2: pull のたびに全ページ DB I/O が走る

**旧問題**: 変更が 1 ページだけの pull でも、全 accessible pages を MongoDB から再取得する必要があった

**解決**:
- bare repo に object pool を永続化することで、pull 時に DB アクセス不要（git binary が disk から直接読む）
- VaultDispatcher が page edit 時に必要な instruction だけ発行、VaultInstructionWatcher が変更分の body のみ MongoDB から取得して bare repo に書き込む
- pull 時の DB I/O は **0**

### ✅ 旧懸念 3: 大規模インスタンスでの CPU 負荷

**旧問題**: pack 生成が CPU バウンドで apps/app の event loop を圧迫する可能性

**解決**: vault-manager マイクロサービス化により CPU/memory 分離。`git upload-pack` 子プロセスとして OS スケジューラに分散される

### 旧記載で破棄された推奨アクション

旧研究セッションの「推奨アクション」（VaultRef.treeSnapshot に revisionId を追加 / vaultMaxPages 上限 / streaming pack generator を将来スコープに）はすべて Option III 採用により無効化された。新設計では:
- per-user の treeSnapshot を VaultRef に持つ必要なし（合成時に namespace tree から都度構築）
- ページ数上限の MVP 設定は不要（streaming で 10,000+ を扱える）
- streaming pack generator も不要（git binary に委譲）

---

## References

- [git smart HTTP protocol spec](https://git-scm.com/docs/http-protocol)
- [git pack format](https://git-scm.com/docs/pack-format)
- [git namespaces](https://git-scm.com/docs/gitnamespaces)
- [git protocol v2](https://git-scm.com/docs/protocol-v2)
- [isomorphic-git GitHub](https://github.com/isomorphic-git/isomorphic-git)
- [Cloudflare Artifacts: Git for Agents](https://blog.cloudflare.com/artifacts-git-for-agents-beta/)
- [MongoDB change streams](https://www.mongodb.com/docs/manual/changeStreams/)
- [GCSFuse documentation](https://cloud.google.com/storage/docs/gcs-fuse)
- [GCP Filestore](https://cloud.google.com/filestore)
