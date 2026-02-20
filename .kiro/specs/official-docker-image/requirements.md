# Requirements Document

## Introduction

GROWI 公式 Docker イメージの Dockerfile (`apps/app/docker/Dockerfile`) および `docker-entrypoint.sh` を、2025-2026 年のベストプラクティスに基づきモダナイズ・最適化する。Node.js 24 をターゲットとし、メモリレポート (`apps/app/tmp/memory-results/REPORT.md`) の知見を反映してメモリ管理を改善する。

### 現状分析の要約

**現行 Dockerfile の構成:**
- 3 ステージ構成: `base` → `builder` → `release`（node:20-slim ベース）
- pnpm + turbo によるモノレポビルド、`pnpm deploy` による本番依存抽出
- gosu を使った root → node ユーザーへの権限ドロップ（entrypoint でディレクトリ作成後）
- `COPY . .` でコンテキスト全体をビルダーにコピー
- CMD 内で `npm run migrate` 実行後にアプリ起動

**GROWI 固有の設計意図（維持すべき事項）:**
- 権限ドロップパターン: entrypoint が root 権限で `/data/uploads` や `/tmp/page-bulk-export` を作成・権限設定した後、node ユーザーに降格して実行する必要がある
- `pnpm deploy --prod`: pnpm モノレポから本番依存のみを抽出するための公式手法
- tar.gz によるステージ間アーティファクト受け渡し: ビルド成果物を cleanly に release ステージに転送
- `apps/app/tmp` ディレクトリ: 運用中にファイルが配置されるため本番イメージに必要
- `--expose_gc` フラグ: バッチ処理（ES rebuild、import 等）で明示的に `gc()` を呼び出すために必要
- CMD 内の `npm run migrate`: Docker image ユーザーの利便性のため、起動時にマイグレーションを自動実行

**参考資料:**
- [Future Architect: 2024年版 Dockerfile ベストプラクティス](https://future-architect.github.io/articles/20240726a/)
- [Snyk: 10 best practices to containerize Node.js](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/)
- [ByteScrum: Dockerfile Best Practices 2025](https://blog.bytescrum.com/dockerfile-best-practices-2025-secure-fast-and-modern)
- [OneUptime: Docker Health Check Best Practices 2026](https://oneuptime.com/blog/post/2026-01-30-docker-health-check-best-practices/view)
- [Docker: Introduction to heredocs in Dockerfiles](https://www.docker.com/blog/introduction-to-heredocs-in-dockerfiles/)
- [Docker Hardened Images: Node.js 移行ガイド](https://docs.docker.com/dhi/migration/examples/node/)
- [Docker Hardened Images カタログ: Node.js](https://hub.docker.com/hardened-images/catalog/dhi/node)
- GROWI メモリ使用量調査レポート (`apps/app/tmp/memory-results/REPORT.md`)

## Requirements

### Requirement 1: ベースイメージとビルド環境のモダナイズ

**Objective:** As an インフラ管理者, I want Dockerfile のベースイメージと構文が最新のベストプラクティスに準拠していること, so that セキュリティパッチの適用・パフォーマンス向上・メンテナンス性の改善が得られる

#### Acceptance Criteria

1. The Dockerfile shall ベースイメージとして Docker Hardened Images（DHI）を使用する。ビルドステージには `dhi.io/node:24-debian13-dev`、リリースステージには `dhi.io/node:24-debian13` を使用する（glibc ベースでパフォーマンス維持、CVE 最大 95% 削減）
2. The Dockerfile shall syntax ディレクティブを `# syntax=docker/dockerfile:1`（最新安定版を自動追従）に更新する
3. The Dockerfile shall pnpm のインストールに wget スタンドアロンスクリプト方式を維持する（corepack は Node.js 25 以降で同梱廃止のため不採用）
4. The Dockerfile shall `pnpm install ---frozen-lockfile`（ダッシュ3つ）の typo を `--frozen-lockfile`（ダッシュ2つ）に修正する
5. The Dockerfile shall pnpm バージョンのハードコードを避け、`package.json` の `packageManager` フィールドまたはインストールスクリプトの最新版取得を活用する

### Requirement 2: メモリ管理の最適化

**Objective:** As a GROWI 運用者, I want コンテナのメモリ制約に応じて Node.js のヒープサイズが適切に制御されること, so that OOMKilled のリスクが低減し、マルチテナント環境でのメモリ効率が向上する

#### Acceptance Criteria

1. The docker-entrypoint.ts shall `GROWI_HEAP_SIZE` 環境変数が設定されている場合、その値を `--max-heap-size` フラグとして node プロセスに渡す
2. While `GROWI_HEAP_SIZE` 環境変数が未設定の場合, the docker-entrypoint.ts shall cgroup メモリリミット（v2: `/sys/fs/cgroup/memory.max`、v1: `/sys/fs/cgroup/memory/memory.limit_in_bytes`）を読み取り、その 60% を `--max-heap-size` として自動算出する
3. While cgroup メモリリミットが検出できない（ベアメタル等）かつ `GROWI_HEAP_SIZE` が未設定の場合, the docker-entrypoint.ts shall `--max-heap-size` フラグを付与せず、V8 のデフォルト動作に委ねる
4. When `GROWI_OPTIMIZE_MEMORY` 環境変数が `true` に設定された場合, the docker-entrypoint.ts shall `--optimize-for-size` フラグを node プロセスに追加する
5. When `GROWI_LITE_MODE` 環境変数が `true` に設定された場合, the docker-entrypoint.ts shall `--lite-mode` フラグを node プロセスに追加する（TurboFan 無効化により RSS を v20 同等まで削減。OOMKilled 頻発時の最終手段として使用）
6. The docker-entrypoint.ts shall `--max-heap-size` を使用し、`--max_old_space_size` は使用しない（Node.js 24 の trusted_space overhead 問題を回避するため）
7. The docker-entrypoint.ts shall `--max-heap-size` を `NODE_OPTIONS` ではなく node コマンドの直接引数として渡す（Node.js の制約）

### Requirement 3: ビルド効率とキャッシュの最適化

**Objective:** As a 開発者, I want Docker ビルドが高速かつ効率的であること, so that CI/CD パイプラインのビルド時間が短縮され、イメージサイズが最小化される

#### Acceptance Criteria

1. The Dockerfile shall builder ステージで `COPY . .` の代わりに `--mount=type=bind` を使用し、ソースコードをレイヤーに含めない
2. The Dockerfile shall pnpm store のキャッシュマウント (`--mount=type=cache,target=...`) を維持する
3. The Dockerfile shall ビルドステージで apt-get のキャッシュマウントを維持する
4. The Dockerfile shall release ステージで `.next/cache` が含まれないことを保証する
5. The Dockerfile shall ビルドステージからリリースステージへのアーティファクト転送に `--mount=type=bind,from=builder` パターンを使用する

### Requirement 4: セキュリティ強化

**Objective:** As a セキュリティ担当者, I want Docker イメージがセキュリティベストプラクティスに準拠していること, so that 攻撃面が最小化され、本番環境の安全性が向上する

#### Acceptance Criteria

1. The Dockerfile shall 非 root ユーザー（node）でアプリケーションを実行する（Node.js entrypoint で `process.setuid/setgid` を使用）
2. The Dockerfile shall release ステージに不要なパッケージ（wget、curl 等のビルドツール）をインストールしない
3. The Dockerfile shall `.dockerignore` により、`.git`、`node_modules`、テストファイル、シークレットファイル等がビルドコンテキストに含まれないことを保証する
4. The Dockerfile shall `apt-get install` で `--no-install-recommends` を使用して不要な推奨パッケージのインストールを防ぐ
5. The Dockerfile shall release ステージのイメージに、ビルド時にのみ必要なツール（turbo、node-gyp、pnpm 等）を含めない

### Requirement 5: 運用性・可観測性の向上

**Objective:** As a 運用担当者, I want Docker イメージに適切なメタデータが設定されていること, so that コンテナオーケストレーターによる管理が容易になる

#### Acceptance Criteria

1. The Dockerfile shall OCI 標準の LABEL アノテーション（`org.opencontainers.image.source`、`org.opencontainers.image.title`、`org.opencontainers.image.description`、`org.opencontainers.image.vendor`）を含める
2. The Dockerfile shall `EXPOSE 3000` を維持してポートをドキュメント化する
3. The Dockerfile shall `VOLUME /data` を維持してデータ永続化ポイントをドキュメント化する

### Requirement 6: entrypoint と CMD のリファクタリング

**Objective:** As a 開発者, I want entrypoint スクリプトと CMD が明確で保守しやすい構造であること, so that メモリフラグの動的組み立てや将来の拡張が容易になる

#### Acceptance Criteria

1. The docker-entrypoint.ts shall ヒープサイズ算出ロジック（Requirement 2 の 3 段フォールバック）を含める
2. The docker-entrypoint.ts shall 算出されたフラグを node コマンドの引数として組み立て、`process.setgid` + `process.setuid` で権限ドロップ後に `child_process.spawn` で実行する
3. The docker-entrypoint.ts shall `/data/uploads` のディレクトリ作成・シンボリックリンク・権限設定（FILE_UPLOAD=local サポート）を維持する
4. The docker-entrypoint.ts shall `/tmp/page-bulk-export` のディレクトリ作成・権限設定を維持する
5. The docker-entrypoint.ts shall マイグレーション実行後にアプリケーションを起動する現行動作を維持する
6. The docker-entrypoint.ts shall `--expose_gc` フラグを維持する（バッチ処理での明示的 GC 呼び出しに必要）
7. When `GROWI_HEAP_SIZE`、cgroup 算出値、または各種最適化フラグが設定された場合, the docker-entrypoint.ts shall 適用されたフラグの内容を標準出力にログ出力する
8. The docker-entrypoint.ts shall TypeScript で記述し、Node.js 24 のネイティブ TypeScript 実行機能（type stripping）で直接実行する

### Requirement 7: 後方互換性

**Objective:** As a 既存の Docker image ユーザー, I want 新しい Dockerfile に移行しても既存の運用が壊れないこと, so that アップグレード時のリスクが最小化される

#### Acceptance Criteria

1. The Docker イメージ shall 環境変数によるアプリケーション設定（`MONGO_URI`、`FILE_UPLOAD` 等）を従来通りサポートする
2. The Docker イメージ shall `VOLUME /data` を維持し、既存のデータボリュームマウントとの互換性を保つ
3. The Docker イメージ shall ポート 3000 でリッスンする現行動作を維持する
4. While メモリ管理の環境変数（`GROWI_HEAP_SIZE`、`GROWI_OPTIMIZE_MEMORY`、`GROWI_LITE_MODE`）が未設定の場合, the Docker イメージ shall 既存の動作（Node.js 24 のデフォルト）と実質的に同等に動作する
5. The Docker イメージ shall `docker-compose.yml` / `compose.yaml` からの利用パターンを維持する

### Requirement 8: 本番置換と CI/CD 対応

**Objective:** As an インフラ管理者, I want docker-new ディレクトリの成果物が既存の docker ディレクトリを正式に置き換え、CI/CD パイプラインが新しい Dockerfile で動作すること, so that 本番ビルドで DHI ベースのイメージが使用される

#### Acceptance Criteria

1. The Docker ビルド構成 shall `apps/app/docker-new/` の全ファイル（`Dockerfile`、`docker-entrypoint.ts`、`docker-entrypoint.spec.ts`、`Dockerfile.dockerignore`）を `apps/app/docker/` に移動し、旧ファイル（旧 `Dockerfile`、`docker-entrypoint.sh`、旧 `Dockerfile.dockerignore`）を削除する。`codebuild/` ディレクトリと `README.md` は維持する
2. The Dockerfile shall ファイル内の自己参照パス `apps/app/docker-new/docker-entrypoint.ts` を `apps/app/docker/docker-entrypoint.ts` に更新する
3. The buildspec.yml shall DHI レジストリ（`dhi.io`）へのログインコマンドを pre_build フェーズに追加する。DHI は Docker Hub 認証情報を使用するため、既存の `DOCKER_REGISTRY_PASSWORD` シークレットを再利用する
4. The buildspec.yml shall 新しい Dockerfile のパス（`./apps/app/docker/Dockerfile`）を正しく参照する（現行パスと同一のため変更不要であることを確認する）
