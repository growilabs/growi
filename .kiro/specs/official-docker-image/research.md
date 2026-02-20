# Research & Design Decisions

---
**Purpose**: Discovery findings and design decision rationale for the official Docker image modernization.
---

## Summary
- **Feature**: `official-docker-image`
- **Discovery Scope**: Extension（既存 Dockerfile の大幅な改善）
- **Key Findings**:
  - DHI runtime image (`dhi.io/node:24-debian13`) はシェル・パッケージマネージャ・coreutils を含まない極小構成。Node.js entrypoint（TypeScript）を採用し、シェル・追加バイナリ一切不要の構成を実現
  - `--mount=type=bind` はモノレポのマルチステップビルドでは非実用的。`turbo prune --docker` が Turborepo 公式推奨のDocker最適化手法
  - gosu は Node.js ネイティブの `process.setuid/setgid` で置き換え。外部バイナリ（gosu/setpriv/busybox）が完全に不要
  - HEALTHCHECK は不採用（k8s は独自 probe を使用。Docker Compose ユーザーは自前で設定可能）
  - Node.js 24 は TypeScript ネイティブ実行（type stripping）をサポート。entrypoint を TypeScript で記述可能

## Research Log

### DHI Runtime Image の構成

- **Context**: `dhi.io/node:24-debian13` をリリースステージのベースイメージとして採用する際の制約調査
- **Sources Consulted**:
  - [DHI Catalog GitHub](https://github.com/docker-hardened-images/catalog) — `image/node/debian-13/` ディレクトリ
  - [DHI Documentation](https://docs.docker.com/dhi/)
  - [DHI Use an Image](https://docs.docker.com/dhi/how-to/use/)
- **Findings**:
  - Runtime image のプリインストールパッケージ: `base-files`, `ca-certificates`, `libc6`, `libgomp1`, `libstdc++6`, `netbase`, `tzdata` のみ
  - **シェルなし**、**apt なし**、**coreutils なし**、**curl/wget なし**
  - デフォルトユーザー: `node` (UID 1000, GID 1000)
  - Dev image (`-dev`): `apt`, `bash`, `git`, `util-linux`, `coreutils` 等がプリインストール
  - 利用可能タグ: `dhi.io/node:24-debian13`, `dhi.io/node:24-debian13-dev`
  - プラットフォーム: `linux/amd64`, `linux/arm64`
- **Implications**:
  - entrypoint を Node.js（TypeScript）で記述することで、シェルも追加バイナリも完全に不要
  - gosu/setpriv は Node.js ネイティブの `process.setuid/setgid` で代替。外部バイナリのコピーが不要
  - HEALTHCHECK は不採用（k8s は独自 probe を使用）。curl/Node.js http モジュールによるヘルスチェックは不要

### `--mount=type=bind` のモノレポビルドでの適用性

- **Context**: Requirement 3.1「builder ステージで `COPY . .` の代わりに `--mount=type=bind` を使用」の実現可能性調査
- **Sources Consulted**:
  - [Docker Build Cache Optimization](https://docs.docker.com/build/cache/optimize/)
  - [Dockerfile Reference - RUN --mount](https://docs.docker.com/reference/dockerfile/)
  - [pnpm Docker Documentation](https://pnpm.io/docker)
  - [Turborepo Docker Guide](https://turbo.build/repo/docs/handbook/deploying-with-docker)
- **Findings**:
  - `--mount=type=bind` は **RUN 命令の実行中のみ有効** で、次の RUN 命令には引き継がれない
  - モノレポビルドの multi-step プロセス（install → build → deploy）では、各ステップが前のステップの成果物に依存するため、bind mount だけでは実現困難
  - 全ステップを単一 RUN にまとめることは可能だが、レイヤーキャッシュの利点が失われる
  - **Turborepo 公式推奨**: `turbo prune --docker` で Docker 用にモノレポを最小化
    - `out/json/` — dependency install に必要な package.json のみ
    - `out/pnpm-lock.yaml` — lockfile
    - `out/full/` — ビルドに必要なソースコード
  - この方式により `COPY . .` を回避しつつ、レイヤーキャッシュを活用可能
- **Implications**:
  - Requirement 3.1 は `--mount=type=bind` ではなく `turbo prune --docker` パターンで実現すべき
  - 目標（ソースコードのレイヤー最小化・キャッシュ効率向上）は同等に達成可能
  - **ただし** `turbo prune --docker` の pnpm workspace との互換性は実装時に検証が必要

### gosu の代替手段

- **Context**: DHI runtime image で gosu が利用できないため、代替手段を調査
- **Sources Consulted**:
  - [gosu GitHub](https://github.com/tianon/gosu) — 代替ツール一覧
  - [Debian Packages - gosu in trixie](https://packages.debian.org/trixie/admin/gosu)
  - [PhotoPrism: Switch from gosu to setpriv](https://github.com/photoprism/photoprism/pull/2730)
  - [MongoDB Docker: Replace gosu by setpriv](https://github.com/docker-library/mongo/pull/714)
  - Node.js `process.setuid/setgid` documentation
- **Findings**:
  - `setpriv` は `util-linux` の一部で、DHI dev image にプリインストール済み
  - `gosu node command` → `setpriv --reuid=node --regid=node --init-groups -- command` に置換可能
  - PhotoPrism、MongoDB 公式 Docker image が gosu → setpriv に移行済み
  - **Node.js ネイティブ**: `process.setgid(1000)` + `process.setuid(1000)` + `process.initgroups('node', 1000)` で完全に代替可能
  - Node.js entrypoint を採用する場合、外部バイナリ（gosu/setpriv/busybox）が一切不要
- **Implications**:
  - **最終決定**: Node.js ネイティブの `process.setuid/setgid` を採用（setpriv も不要）
  - gosu/setpriv バイナリのコピーが不要になり、release ステージに追加バイナリなし
  - DHI runtime の攻撃面最小化をそのまま維持

### HEALTHCHECK の実装方式（不採用）

- **Context**: DHI runtime image に curl がないため、HEALTHCHECK の実装方式を調査
- **Sources Consulted**:
  - [Docker Healthchecks in Distroless Node.js](https://www.mattknight.io/blog/docker-healthchecks-in-distroless-node-js)
  - [Docker Healthchecks: Why Not to Use curl](https://blog.sixeyed.com/docker-healthchecks-why-not-to-use-curl-or-iwr/)
  - GROWI healthcheck endpoint: `apps/app/src/server/routes/apiv3/healthcheck.ts`
- **Findings**:
  - Node.js の `http` モジュールで十分（curl は不要）
  - GROWI の `/_api/v3/healthcheck` エンドポイントはパラメータなしで `{ status: 'OK' }` を返す
  - Docker HEALTHCHECK は Docker Compose の `depends_on: service_healthy` 依存順序制御に有用
  - k8s 環境では独自 probe（liveness/readiness）を使用するため Dockerfile の HEALTHCHECK は不要
- **Implications**:
  - **最終決定: 不採用**。k8s は独自 probe を使用し、Docker Compose ユーザーは compose.yaml で自前設定可能
  - Dockerfile に HEALTHCHECK を含めないことで、シンプルさを維持

### npm run migrate のシェル依存性

- **Context**: CMD 内の `npm run migrate` が shell を必要とするかの調査
- **Sources Consulted**:
  - GROWI `apps/app/package.json` の `migrate` スクリプト
- **Findings**:
  - `migrate` スクリプトの実態: `node -r dotenv-flow/config node_modules/migrate-mongo/bin/migrate-mongo up -f config/migrate-mongo-config.js`
  - `npm run` は内部で `sh -c` を使用するため、shell が必要
  - 代替: スクリプトの中身を直接 node で実行すれば npm/sh は不要
  - ただし、npm run を使用する方が保守性が高い（package.json の変更に追従可能）
- **Implications**:
  - **最終決定**: Node.js entrypoint で `child_process.execFileSync` を使用し、migration コマンドを直接実行（npm run 不使用、シェル不要）
  - package.json の `migrate` スクリプトの中身を entrypoint 内で直接記述する方式を採用
  - package.json の変更時は entrypoint の更新も必要だが、DHI runtime の完全シェルレスを優先

### Node.js 24 TypeScript ネイティブ実行

- **Context**: entrypoint を TypeScript で記述する場合、Node.js 24 のネイティブ TypeScript 実行機能を利用可能か調査
- **Sources Consulted**:
  - [Node.js 23 Release Notes](https://nodejs.org/en/blog/release/v23.0.0) — `--experimental-strip-types` が unflag
  - [Node.js Type Stripping Documentation](https://nodejs.org/docs/latest/api/typescript.html)
- **Findings**:
  - Node.js 23 から type stripping がデフォルト有効（`--experimental-strip-types` フラグ不要）
  - Node.js 24 では安定機能として利用可能
  - **制約**: enum、namespace 等の「非 erasable syntax」は使用不可。`--experimental-transform-types` が必要
  - interface、type alias、type annotation（`: string`、`: number` 等）は問題なく使用可能
  - `ENTRYPOINT ["node", "docker-entrypoint.ts"]` で直接実行可能
- **Implications**:
  - entrypoint を TypeScript で記述し、型安全な実装が可能
  - enum は使用せず、union type (`type Foo = 'a' | 'b'`) で代替
  - tsconfig.json は不要（type stripping は独立動作）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| DHI runtime + busybox-static | busybox-static をコピーして sh/coreutils を提供 | 最小限の追加（~1MB）で全機能動作 | DHI 採用の本来の意図（攻撃面最小化）と矛盾。追加バイナリは攻撃ベクター | 却下 |
| DHI runtime + bash/coreutils コピー | dev stage から bash と各種バイナリを個別コピー | bash の全機能が使える | 共有ライブラリ依存が複雑、コピー対象が多い | 却下 |
| DHI dev image を runtime に使用 | dev image をそのまま本番利用 | 設定変更最小 | apt/git 等が含まれ攻撃面が増大、DHI の意味が薄れる | 却下 |
| Node.js entrypoint（TypeScript、シェルレス） | entrypoint を TypeScript で記述。Node.js 24 のネイティブ TypeScript 実行で動作 | 完全にシェル不要、DHI runtime の攻撃面をそのまま維持、型安全 | migration コマンドを直接記述（npm run 不使用）、package.json 変更時に更新必要 | **採用** |

## Design Decisions

### Decision: Node.js TypeScript entrypoint（シェル完全不要）

- **Context**: DHI runtime image にはシェルも coreutils も含まれない。busybox-static のコピーは DHI 採用の意図（攻撃面最小化）と矛盾する
- **Alternatives Considered**:
  1. busybox-static をコピーして shell + coreutils を提供 — DHI の攻撃面最小化と矛盾
  2. bash + coreutils を個別コピー — 依存関係が複雑
  3. Node.js TypeScript entrypoint — `fs`、`child_process`、`process.setuid/setgid` で全て完結
- **Selected Approach**: entrypoint を TypeScript で記述（`docker-entrypoint.ts`）。Node.js 24 のネイティブ TypeScript 実行（type stripping）で直接実行
- **Rationale**: DHI runtime に追加バイナリ一切不要。fs module でディレクトリ操作、process.setuid/setgid で権限ドロップ、execFileSync で migration、spawn でアプリ起動。型安全による保守性向上
- **Trade-offs**: migration コマンドを直接記述（npm run 不使用）。package.json の migrate スクリプト変更時に entrypoint の更新も必要
- **Follow-up**: Node.js 24 の type stripping が entrypoint の import 文なしの単一ファイルで正常動作することを検証

### Decision: Node.js ネイティブの process.setuid/setgid による権限ドロップ

- **Context**: gosu は DHI runtime にインストールできない。busybox-static/setpriv も不採用（追加バイナリ排除方針）
- **Alternatives Considered**:
  1. gosu バイナリをコピー — 動作するが、業界トレンドに逆行
  2. setpriv バイナリをコピー — 動作するが、追加バイナリ排除方針に反する
  3. Node.js `process.setuid/setgid` — Node.js の標準 API
  4. Docker `--user` フラグ — entrypoint の動的処理に対応できない
- **Selected Approach**: `process.initgroups('node', 1000)` + `process.setgid(1000)` + `process.setuid(1000)` で権限ドロップ
- **Rationale**: 外部バイナリ完全不要。Node.js entrypoint 内で直接呼び出し可能。setgid → setuid の順序で安全に権限ドロップ
- **Trade-offs**: entrypoint が Node.js プロセスとして root で起動し、アプリもその子プロセスとなる（gosu のような exec ではない）。ただし spawn でアプリプロセスを分離し、シグナルフォワーディングで PID 1 の責務を果たす
- **Follow-up**: なし

### Decision: turbo prune --docker パターン

- **Context**: Requirement 3.1 で `COPY . .` の廃止が求められているが、`--mount=type=bind` はモノレポビルドで非実用的
- **Alternatives Considered**:
  1. `--mount=type=bind` — RUN 間で永続化しないため multi-step ビルドに不向き
  2. 単一 RUN に全ステップをまとめる — キャッシュ効率が悪い
  3. `turbo prune --docker` — Turborepo 公式推奨
- **Selected Approach**: `turbo prune --docker` で Docker 用にモノレポを最小化し、最適化された COPY パターンを使用
- **Rationale**: Turborepo 公式推奨。dependency install と source copy を分離してレイヤーキャッシュを最大活用。`COPY . .` を排除しつつ実用的
- **Trade-offs**: ビルドステージが 1 つ増える（pruner ステージ）が、キャッシュ効率の改善で相殺
- **Follow-up**: `turbo prune --docker` の pnpm workspace 互換性を実装時に検証

### Decision: spawn 引数によるフラグ注入

- **Context**: `--max-heap-size` は `NODE_OPTIONS` では使用不可。node コマンドの直接引数として渡す必要がある
- **Alternatives Considered**:
  1. 環境変数 `GROWI_NODE_FLAGS` を export し、CMD 内の shell 変数展開で注入 — shell が必要
  2. entrypoint 内で CMD 文字列を sed で書き換え — fragile
  3. Node.js entrypoint で `child_process.spawn` の引数として直接渡す — シェル不要
- **Selected Approach**: entrypoint 内でフラグ配列を組み立て、`spawn(process.execPath, [...nodeFlags, ...appArgs])` で直接渡す
- **Rationale**: シェル変数展開不要。配列として直接渡すためシェルインジェクションのリスクゼロ。Node.js entrypoint との自然な統合
- **Trade-offs**: CMD が不要になる（entrypoint が全ての起動処理を行う）。docker run でのコマンド上書きが entrypoint 内のロジックには影響しない
- **Follow-up**: なし

### DHI レジストリ認証と CI/CD 統合

- **Context**: DHI ベースイメージの pull に必要な認証方式と、既存 CodeBuild パイプラインへの統合方法を調査
- **Sources Consulted**:
  - [DHI How to Use an Image](https://docs.docker.com/dhi/how-to/use/) — DHI の利用手順
  - 既存 `apps/app/docker/codebuild/buildspec.yml` — 現行の CodeBuild ビルド定義
  - 既存 `apps/app/docker/codebuild/secretsmanager.tf` — AWS Secrets Manager 設定
- **Findings**:
  - DHI は Docker Hub 認証情報を使用（DHI は Docker Business/Team サブスクリプションの機能）
  - `docker login dhi.io --username <dockerhub-user> --password-stdin` で認証可能
  - 既存 buildspec.yml は `DOCKER_REGISTRY_PASSWORD` シークレットで docker.io にログイン済み
  - 同じ認証情報で `dhi.io` にもログイン可能（追加シークレットは不要）
  - CodeBuild の `reusable-app-build-image.yml` → CodeBuild Project → buildspec.yml の流れは変更不要
- **Implications**:
  - buildspec.yml の pre_build に `docker login dhi.io` を 1 行追加するだけで対応可能
  - `secretsmanager.tf` の変更は不要
  - Docker Hub と DHI の両方にログインが必要（docker.io は push 用、dhi.io は pull 用）

### ディレクトリ置換の影響範囲（コードベース調査）

- **Context**: `apps/app/docker-new/` → `apps/app/docker/` への置換時に、既存の参照が壊れないことを確認
- **Sources Consulted**: コードベース全体を `apps/app/docker` キーワードで grep 調査
- **Findings**:
  - `buildspec.yml`: `-f ./apps/app/docker/Dockerfile` — 置換後も同一パス（変更不要）
  - `codebuild.tf`: `buildspec = "apps/app/docker/codebuild/buildspec.yml"` — 同一（変更不要）
  - `.github/workflows/release.yml`: `readme-filepath: ./apps/app/docker/README.md` — 同一（変更不要）
  - `.github/workflows/ci-app.yml` / `ci-app-prod.yml`: `!apps/app/docker/**` 除外パターン — 同一（変更不要）
  - `apps/app/bin/github-actions/update-readme.sh`: `cd docker` + sed — 同一（変更不要）
  - Dockerfile 内: line 122 `apps/app/docker-new/docker-entrypoint.ts` — **要更新**（自己参照パス）
  - `package.json` や `vitest.config` に docker 関連の参照 — なし
  - `lefthook.yml` に docker 関連フック — なし
- **Implications**:
  - 置換時に更新が必要なのは Dockerfile 内の自己参照パス 1 箇所のみ
  - 外部参照（CI/CD、GitHub Actions）は全て `apps/app/docker/` パスを使用しており変更不要
  - `codebuild/` ディレクトリと `README.md` は `docker/` 内にそのまま維持

## Risks & Mitigations

- **Node.js 24 TypeScript ネイティブ実行の安定性**: type stripping は Node.js 23 で unflag 済み。Node.js 24 では安定機能。ただし enum 等の非 erasable syntax は使用不可 → interface/type のみ使用
- **migration コマンドの直接記述**: package.json の `migrate` スクリプトを entrypoint 内に直接記述するため、変更時に同期が必要 → 実装時にコメントで明記
- **turbo prune の pnpm workspace 互換性**: 実装時に検証。非互換の場合は最適化された COPY パターンにフォールバック
- **process.setuid/setgid の制限**: supplementary groups の初期化に `process.initgroups` が必要。setgid → setuid の順序厳守
- **DHI イメージの docker login 要件**: CI/CD で `docker login dhi.io` が必要。認証情報管理のセキュリティ考慮が必要

## References

- [Docker Hardened Images Documentation](https://docs.docker.com/dhi/) — DHI の全体像と利用方法
- [DHI Catalog GitHub](https://github.com/docker-hardened-images/catalog) — イメージ定義とタグ一覧
- [Turborepo Docker Guide](https://turbo.build/repo/docs/handbook/deploying-with-docker) — turbo prune --docker パターン
- [pnpm Docker Documentation](https://pnpm.io/docker) — pnpm のDockerビルド推奨
- [Future Architect: 2024年版 Dockerfile ベストプラクティス](https://future-architect.github.io/articles/20240726a/) — モダンな Dockerfile 構文
- [MongoDB Docker: gosu → setpriv](https://github.com/docker-library/mongo/pull/714) — setpriv 移行の先行事例
- [Docker Healthchecks in Distroless](https://www.mattknight.io/blog/docker-healthchecks-in-distroless-node-js) — curl なしのヘルスチェック
- GROWI メモリ使用量調査レポート (`apps/app/tmp/memory-results/REPORT.md`) — ヒープサイズ制御の根拠
