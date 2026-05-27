# 要件定義書

## はじめに

`growi-vault-manager` は GROWI Vault 機能における内部実行エンジンである。`apps/app`（gateway 側）から送られる `vault_instructions` を change stream 経由で受信し、共有ファイルシステム上の git bare repository を namespace 単位で維持する。per-user view ref の合成、`git upload-pack` によるクローン配信、および周期的なメンテナンス（squash / gc）を担う新規マイクロサービスである。GROWI のドメイン知識（ACL 評価・PAT 認証・グループ解決）を一切持たず、namespace と git protocol の 2 概念だけを扱う実行エンジンに純化される。

## 境界コンテキスト

- **スコープ内**: `vault_instructions` の change stream 購読と処理、namespace tree の構築・更新（blob/tree/commit + ref）、per-user view ref の合成とキャッシュ、`git upload-pack` spawn によるクローン/フェッチ配信、周期 squash と git gc の自走スケジューリング、shared secret による service-to-service 認証、health endpoint
- **スコープ外**: PAT 認証・ACL 評価・グループ解決・監査ログ書き込み（apps/app の責務）、bootstrap 主導・管理 UI（apps/app の責務）、bare repo の delta 圧縮・pack format 実装（git binary に委譲）、git push 受付（将来 spec）、shared secret の発行・rotation 機構
- **隣接する期待**: `apps/app` 側の `growi-vault-gateway` spec が `vault_instructions` を書き込み・`compose-view` RPC を呼び出す。`@growi/core` の DTO 型（`packages/core/src/interfaces/vault/`）が両 spec の契約基盤として機能する

---

## 要件

### 要件 1: change stream による instruction 購読と冪等処理

**目的**: システム管理者として、vault-manager が MongoDB の `vault_instructions` コレクションを change stream で購読し、各 instruction を冪等に処理してほしい。これにより at-least-once 配送保証の下で bare repo の namespace state が正確に維持される。

#### 受け入れ基準

1. vault-manager が起動したとき、VaultInstructionWatcher は `vault_sync_state` から resume token を読み込み、change stream の購読を開始する
2. vault-manager が起動したとき、VaultInstructionWatcher は `processedAt: null` の全 instruction を cursor で drain し、変更漏れを回避する
3. change stream で新規 insert イベントを受信したとき、VaultInstructionWatcher は `processedAt` フィールドを確認し、既に処理済みの instruction は再処理しない
4. instruction の処理に成功したとき、VaultInstructionWatcher は `processedAt` を現在時刻に更新し、resume token を `vault_sync_state` に保存する
5. instruction の処理に失敗したとき、VaultInstructionWatcher は `attempts` をインクリメントし `lastError` に失敗内容を記録する。`processedAt` は null のままにして次回 drain または change stream での retry を可能にする
6. resume token が期限切れになったとき、VaultInstructionWatcher は起動時 drain で未処理 instruction を全件回収することで取りこぼしを防ぐ

---

### 要件 2: 全 instruction 種別の namespace tree 更新

**目的**: システム管理者として、vault-manager が 6 種類の instruction op（upsert / bulk-upsert / remove / rename-prefix / grant-change-prefix / reset-all）を正確に実行し、namespace ref を更新してほしい。これにより GROWI のページ変更が git bare repo に正確に反映される。

#### 受け入れ基準

1. `op: 'upsert'` instruction を受信したとき、VaultNamespaceBuilder は revision body を取得し、blob を書き込み、namespace tree の該当エントリを更新し、新しい commit を作成して namespace ref を更新する
2. `op: 'bulk-upsert'` instruction を受信したとき、VaultNamespaceBuilder は `$in` で全 revisionId の body を 1 クエリで取得し、全 blob を書き込み、namespace tree を 1 度だけ rebuild し、1 件の commit で namespace ref を更新する
3. `op: 'remove'` instruction を受信したとき、VaultNamespaceBuilder は namespace tree から当該 filePath のエントリを削除し、新しい commit を作成して namespace ref を更新する
4. `op: 'rename-prefix'` instruction を受信したとき、VaultNamespaceBuilder は `oldFilePrefix` 配下の subtree を抽出して `newFilePrefix` 下に mount し、blob の再書き込みなしで namespace ref を更新する
5. `op: 'grant-change-prefix'` instruction を受信したとき、VaultNamespaceBuilder は `fromNamespace` の subtree を切り離し、`namespace`（移動先）側に mount し、両 namespace の ref を更新する
6. `op: 'reset-all'` instruction を受信したとき、VaultNamespaceBuilder は全 namespace の ref を削除し、`vault_namespace_state` と `vault_user_views` の全 doc を削除する。object pool は削除しない
7. 同一 instruction を複数回実行したとき、VaultNamespaceBuilder はいずれの op 種別においても同一の namespace ref 状態に収束する（冪等性）
8. VaultNamespaceBuilder が commit を作成したとき、commit message は `vault: <namespace> [op] <pagePath or "N entries">` の形式を持ち、op / pageId / revisionId / entryCount / issuedAt 等のメタデータを含む

---

### 要件 3: ページパスの純関数マッピング

**目的**: 開発者として、VaultPathMapper が pagePath を同一の base filePath に決定論的にマッピングしてほしい。これにより reverse-index コレクション不要で、30,000 ページ規模でも `vault_namespace_state` のドキュメントサイズが固定に保たれる。大文字小文字非区別 fs での大小衝突回避は、ACL merge 後の view 構造に依存するため、純関数 `map()` ではなく per-view の tree 正規化（要件 4）が担う。なお、子を持つページの本文はフォルダの隣の `<name>.md` に置き（`<name>.md` とフォルダ `<name>/` は別名のため衝突しない）、index 化（README.md 集約）は行わない。

#### 受け入れ基準

1. 同一の pagePath を入力したとき、VaultPathMapper は常に同一の base filePath を返す（純関数性・tree state 非依存）
2. GROWI ページパス `/A/B/C` を入力したとき、VaultPathMapper は `A/B/C.md` 形式の filePath を返し、先頭スラッシュを除去して `.md` を付与する
3. Windows 予約文字（`<>:"/\|?*`）、先頭・末尾空白、制御文字を含むページパスを入力したとき、VaultPathMapper はそれらを `%XX` パーセントエンコーディングに変換する
4. Windows 予約ファイル名（CON / PRN / AUX / NUL / COM[0-9] / LPT[0-9]）を含むページパスを入力したとき、VaultPathMapper はその名前の前に `_` プレフィックスを付加する
5. VaultPathMapper は大小衝突回避の suffix を付与しない。`map()` は suffix なしの素の `<encoded-name>.md`（base path）のみを返し、pageId 引数を取らない。大文字小文字非区別 fs での衝突解消は per-view の tree 正規化（要件 4）が担う
6. 親ページが不可視または存在しない orphan ページを入力したとき、VaultPathMapper は `_orphaned/<encoded-path>.md` の形式で filePath を返す
7. VaultPathMapper が `mapPrefix(pagePath)` を呼び出したとき、GROWI ページパスのセグメントをエンコードして `/` で結合したディレクトリ prefix を返し、末尾に `.md` を付けない

---

### 要件 4: per-user view ref の合成とキャッシュ

**目的**: git クライアントとして、`compose-view` RPC によって per-user の view ref が合成され、アクセス可能な namespace の tree が merge されてほしい。これにより各ユーザーは自身の ACL に基づいたページのみを含むリポジトリをクローンできる。

#### 受け入れ基準

1. `POST /internal/compose-view` を受信したとき、ComposeViewController は `VaultViewComposer.compose(userId, namespaces)` を呼び出し、`{ viewRef, commitOid }` を返す
2. VaultViewComposer が `compose` を呼び出したとき、現在の namespace versions を `vault_namespace_state` から読み込み、`vault_user_views` に保存された `sourceVersions` と比較する
3. `sourceVersions` が一致するとき、VaultViewComposer は再合成をスキップして既存の `viewCommitOid` を返す（キャッシュヒット）
4. `sourceVersions` が不一致のとき、VaultViewComposer は変動した namespace の subtree のみ再計算する delta merge を実行し、新しい merged tree を作成する
5. VaultViewComposer が初回 compose（`vault_user_views` に既存なし）を実行したとき、全 namespace を full merge して新しい view ref を作成する
6. 同一 path に複数 namespace からのエントリが衝突するとき、VaultViewComposer は `user-<uid>-only-me` > `group-*` > `restricted-link` > `public` の優先順位で解決する
7. `userId: null` を受信したとき、VaultViewComposer は public namespace のみで合成して `anonymous-view` ref を返す
8. VaultViewComposer が delta merge の base tree が gc により消失していることを検知したとき、full merge にフォールバックする
9. VaultViewComposer は merged tree を生成したのち、その view の最終ファイル構造を確定する **tree 正規化**（大小衝突解消）を実行する。正規化は merged tree の構造のみから決定論的に導出され、reverse-index コレクションを必要としない
10. （大小衝突解消）同一ディレクトリ直下で、小文字化して一致する名前が 2 件以上存在するとき（blob・subtree の双方を対象）、VaultViewComposer は各メンバーの名前に `__<hash8>` suffix を付与して衝突を解消する。`hash8` は当該エントリの suffix 付与前 filePath の SHA-1 先頭 8 文字とする（pagePath は GROWI 内で一意のため、衝突する各メンバーは必ず異なる suffix を得る）
11. （reactive churn）衝突していたエントリの一方が view から消え、グループのメンバーが 1 件になったとき、VaultViewComposer は残ったエントリの suffix を取り除いて素の名前に戻す。suffix 付与の有無を示す状態は永続化しない

---

### 要件 5: git smart HTTP の lower-half 提供（upload-pack spawn）

**目的**: git クライアントとして、`git clone` / `git fetch` / `git pull` を実行したとき、標準 git プロトコルに従ったレスポンスを受け取り、ページ内容を取得できる。

#### 受け入れ基準

1. `GET /internal/git/info/refs?service=git-upload-pack` を受信したとき、GitProxyController は `GIT_NAMESPACE=<viewRef>` 環境変数を設定した `git upload-pack --stateless-rpc --advertise-refs <repoPath>` を spawn し、stdout を HTTP レスポンスとして返す
2. `POST /internal/git/git-upload-pack` を受信したとき、GitProxyController は `GIT_NAMESPACE=<viewRef>` を設定した `git upload-pack --stateless-rpc <repoPath>` を spawn し、request body を stdin にパイプし、stdout を HTTP レスポンスとして返す
3. git upload-pack を spawn したとき、GitProxyController は vault-manager の Node.js プロセスがメモリを O(1) でのみ消費するよう、stdout を直接 HTTP body にストリーム転送する（フルバッファリングしない）
4. git upload-pack プロセスが起動したとき、GitProxyController は `uploadpack.allowAnySHA1InWant=false`（git のデフォルト）が維持され、namespace 外の OID が直接 fetch されないことを保証する
5. git upload-pack プロセスでエラーが発生したとき、GitProxyController はプロセスを終了させ、エラーをログに記録する

---

### 要件 6: メンテナンス自走スケジューリング（squash + gc）

**目的**: システム管理者として、vault-manager が k8s CronJob や外部スケジューラに依存せず、namespace ref の commit chain と bare repo の object pool を自律的に bounded に保ってほしい。これにより docker-compose 環境と k8s 環境で追加の cron 設定なしに同一動作する。

#### 受け入れ基準

1. vault-manager が起動したとき、VaultMaintenanceScheduler は 5 分間隔で namespace ref の commit 数と経過時間を確認する
2. namespace ref の commit 数が閾値（デフォルト 1000）を超えたとき、または最終 squash から経過時間が閾値（デフォルト 1 時間）を超えたとき、VaultMaintenanceScheduler は対象 namespace を squash する
3. squash を実行したとき、VaultMaintenanceScheduler は現在の tree OID を取得し、`parents: []` で新しい commit を作成し、namespace ref を上書きし、`vault_namespace_state.version` をインクリメントする
4. loose object 数が閾値（デフォルト 50,000）を超えたとき、または前回 gc から 24 時間が経過したとき、VaultMaintenanceScheduler は `git gc --prune=2.weeks.ago` を spawn する
5. 環境変数 `VAULT_SQUASH_COMMIT_THRESHOLD` / `VAULT_SQUASH_AGE_HOURS` / `VAULT_GC_INTERVAL_HOURS` / `VAULT_GC_LOOSE_OBJECT_THRESHOLD` を設定したとき、VaultMaintenanceScheduler はそれらの値でデフォルト閾値を上書きする
6. squash または gc の実行中に同一 namespace への upsert instruction が発生したとき、VaultMaintenanceScheduler は該当 namespace の処理を in-flight 状態として管理し、squash と instruction 処理を直列化する（他の namespace は blocking しない）
7. VaultMaintenanceScheduler が起動したとき、外部の cron job、k8s CronJob、または systemd timer なしに動作する

---

### 要件 7: shared secret による service-to-service 認証

**目的**: セキュリティ担当者として、vault-manager のすべての endpoint が `Authorization: Bearer <secret>` ヘッダによる認証を要求し、apps/app 以外からのリクエストを拒否してほしい。これにより security perimeter が apps/app に集約される。

#### 受け入れ基準

1. `Authorization: Bearer <token>` ヘッダを含むリクエストを受信したとき、SharedSecretAuth は constant-time 比較で token と環境変数 `VAULT_MANAGER_INTERNAL_SECRET` を検証する
2. token が不一致のとき、SharedSecretAuth は 401 Unauthorized を返す
3. `Authorization` ヘッダが存在しないとき、SharedSecretAuth は 401 Unauthorized を返す
4. secret は環境変数からのみ読み込まれ、MongoDB や設定 DB には保存されない
5. SharedSecretAuth の検証は timing attack を防ぐために constant-time 比較を使用する

---

### 要件 8: health endpoint による監視

**目的**: 運用担当者として、vault-manager の health endpoint が MongoDB 接続・change stream・bare repo 到達性を報告してほしい。これにより k8s liveness / readiness probe および監視システムが vault-manager の稼働状態を把握できる。

#### 受け入れ基準

1. `GET /health` を受信したとき、health endpoint は MongoDB 接続・change stream の稼働状態・bare repo ディレクトリの到達性を確認し、200 OK または 503 Service Unavailable を返す
2. MongoDB 接続が失われたとき、health endpoint は 503 を返し、エラー詳細を含む JSON を返す
3. bare repo ディレクトリが到達不能なとき、health endpoint は 503 を返す
4. 全チェックが正常のとき、health endpoint は 200 と `{ status: "ok" }` を返す

---

### 要件 9: bare repo ストレージ抽象化

**目的**: 開発者として、VaultRepoStorage が local fs / NFS / Filestore のいずれの環境でも POSIX semantics に基づいて bare repo の object I/O と ref 操作を提供してほしい。これにより dev 環境と GROWI Cloud 環境で同一のストレージ抽象が機能する。

#### 受け入れ基準

1. vault-manager が起動したとき、VaultRepoStorage はリポジトリが存在しなければ `git init --bare` を実行して初期化する（冪等）
2. blob / tree / commit の書き込み操作を実行したとき、VaultRepoStorage は isomorphic-git の `writeBlob` / `writeTree` / `writeCommit` API を使用してオブジェクトを object pool に書き込む
3. 同一 OID のオブジェクトが既に存在するとき、VaultRepoStorage は書き込みをスキップし（content-addressed no-op）、エラーを発生させない
4. ref 更新を実行したとき、VaultRepoStorage はファイルシステムの atomic rename を使用して ref を更新する（POSIX fs 前提）
5. GCSFuse 等の object storage backed FUSE（random small read 性能不足・ref atomic rename semantics 非保証）は動作保証の対象外とする

---

### 要件 10: アプリケーションスケルトンとデプロイ構成

**目的**: 開発者として、`apps/growi-vault-manager` が Ts.ED ベースで起動し、`apps/pdf-converter` と同等の Dockerfile / docker-compose 統合が提供されてほしい。これにより既存の GROWI Cloud デプロイパターンと整合した運用が可能になる。

#### 受け入れ基準

1. vault-manager アプリを起動したとき、Ts.ED サーバが指定ポート（デフォルト 3001）で HTTP リクエストを受け付ける
2. Dockerfile をビルドしたとき、node.js ランタイムと git binary（v2.30 以上）が同梱された Docker イメージが生成される
3. docker-compose でアプリを起動したとき、vault-manager と apps/app が同一の共有 volume を通じて bare repo にアクセスできる
4. pnpm workspace に `apps/growi-vault-manager` が登録され、Turborepo の `build` / `dev` / `test` タスクが機能する

---

### 要件 11: storage stats RPC（admin UI 観測用）

**目的**: GROWI 管理者として、admin UI から bare repo のストレージ使用状況（namespace 数・合計 commit 数・loose object 数・repo size）を観測できるようにしたい。これにより `vault_namespace_state` の owner 越境を発生させずに、admin UI が必要な観測情報を取得できる。

#### 受け入れ基準

1. `GET /internal/storage-stats` を受信したとき、StorageStatsController は `vault_namespace_state` を集約して `{ namespaceCount, totalCommitCount, looseObjectCount, repoSizeBytes, lastSquashAt, lastGcAt }` を返す
2. StorageStatsController は SharedSecretAuth middleware を適用し、`Authorization: Bearer <secret>` を要求する
3. `looseObjectCount` および `repoSizeBytes` の取得は bare repo ディレクトリの低コストなファイルシステム操作（`fs.stat` / `git count-objects` 相当）で行い、O(repo size) の重い処理を行わない
4. `lastSquashAt` および `lastGcAt` は `VaultMaintenanceScheduler.getStatus()` の値を返し、未実行時は null を返す
5. ストレージ統計の集計に失敗したとき、StorageStatsController は 500 を返し、エラー詳細をログに記録する
