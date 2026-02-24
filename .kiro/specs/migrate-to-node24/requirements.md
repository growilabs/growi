# Requirements Document

## Introduction
GROWI プロジェクトの Node.js 対応バージョンを v18/v20 から v24 のみに移行する。ただし、将来的に v24 と v26 の両対応を見据え、複数バージョン対応に必要な機構（CI マトリクス、engines フィールドの範囲指定パターンなど）は維持する。

## Project Description (Input)
migrate-to-node24 Node.js v24 に対応させる

- 現状: Node.js v18 と v20 対応
- 対応後: Node.js v24 のみ対応 (ただし、将来的に v24, v26 両対応できるように、複数対応に必要な機構は残す

## Requirements

### Requirement 1: エンジン制約の更新
**Objective:** As a 開発者, I want package.json の engines フィールドが Node.js v24 のみを許可する, so that 非対応バージョンでのインストール・実行を防止できる

#### Acceptance Criteria
1. The GROWI build system shall ルート `package.json` の `engines.node` フィールドを `^24` に設定する
2. When `npm install` または `pnpm install` を Node.js v24 未満の環境で実行した場合, the GROWI build system shall エンジン互換性エラーを返す
3. The GROWI build system shall 各ワークスペース（apps/*, packages/*）の `package.json` に独自の `engines` フィールドが存在する場合、それらも `^24` に統一する

### Requirement 2: Docker イメージの更新
**Objective:** As a デプロイ担当者, I want Docker ビルドが Node.js v24 ベースイメージを使用する, so that 本番環境で Node.js v24 が確実に使用される

#### Acceptance Criteria
1. The Dockerfile shall `apps/app/docker/Dockerfile` のベースイメージを `node:24-slim` に変更する
2. The Dockerfile shall `apps/pdf-converter/docker/Dockerfile` のベースイメージを `node:24-slim` に変更する
3. The Dockerfile shall `apps/slackbot-proxy/docker/Dockerfile` のベースイメージを `node:24-slim` に変更する
4. When Docker イメージをビルドした場合, the Dockerfile shall 全ステージ（ビルド用・ランタイム用）で `node:24-slim` を使用する

### Requirement 3: CI/CD パイプラインの更新
**Objective:** As a 開発者, I want CI/CD パイプラインが Node.js v24 でテスト・ビルドを実行する, so that v24 環境での動作が継続的に検証される

#### Acceptance Criteria
1. The CI pipeline shall `ci-app.yml` のテストマトリクスで `node-version: [24.x]` を使用する
2. The CI pipeline shall `ci-pdf-converter.yml` のテストマトリクスで `node-version: [24.x]` を使用する
3. The CI pipeline shall `ci-slackbot-proxy.yml` のテストマトリクスで `node-version: [24.x]` を使用する
4. The CI pipeline shall `ci-app-prod.yml` の本番テストジョブで Node.js v24 のみを対象とする（v18/v20 ジョブを v24 に置換する）
5. The CI pipeline shall `reusable-app-prod.yml` のデフォルト node-version を `24.x` に変更する
6. The CI pipeline shall `release-subpackages.yml` の node-version を `24` に変更する

### Requirement 4: 複数バージョン対応機構の維持
**Objective:** As a メンテナー, I want 将来の Node.js v26 追加対応に備えて複数バージョン対応の仕組みを残す, so that 最小限の変更で v24/v26 両対応に移行できる

#### Acceptance Criteria
1. The CI pipeline shall `ci-app-prod.yml` にて Node.js バージョンのマトリクス構造（複数ジョブ定義パターン）を維持する（現時点では v24 のみだが、ジョブ追加で拡張可能な形式を保つ）
2. The GROWI build system shall ルート `package.json` の `engines.node` を SemVer 範囲指定形式（`^24`）で記述し、将来 `^24 || ^26` への拡張が容易な形式を維持する
3. The Dockerfile shall ベースイメージのバージョンをビルド引数（`ARG`）として外部から指定可能な構造を維持または導入する

### Requirement 5: ドキュメントの更新
**Objective:** As a 利用者・貢献者, I want ドキュメントが Node.js v24 対応を正確に反映する, so that 環境構築時に正しいバージョンを使用できる

#### Acceptance Criteria
1. The documentation shall `README.md` の Node.js バージョン記載を `v24.x` に更新する
2. The documentation shall `README_JP.md` の Node.js バージョン記載を `v24.x` に更新する
3. Where プロジェクト内に他の Node.js バージョンを参照するドキュメントが存在する場合, the documentation shall それらも v24 に更新する

### Requirement 6: 依存パッケージの互換性確認
**Objective:** As a 開発者, I want 全ての依存パッケージが Node.js v24 で動作することを確認する, so that ランタイムエラーや非互換の問題を事前に検出できる

#### Acceptance Criteria
1. The GROWI build system shall Node.js v24 環境で `pnpm install` が警告なく完了する
2. The GROWI build system shall Node.js v24 環境で `turbo run build` が全ワークスペースで成功する
3. The GROWI test suite shall Node.js v24 環境で既存のテストスイートが全て合格する
4. If 依存パッケージが Node.js v24 と非互換である場合, the GROWI build system shall 代替パッケージへの置換またはバージョンアップで解消する

### Requirement 7: Node.js v24 の新機能・破壊的変更への対応
**Objective:** As a 開発者, I want Node.js v18/v20 から v24 への破壊的変更に対応する, so that 非推奨 API の使用やランタイムエラーを排除できる

#### Acceptance Criteria
1. The GROWI application shall Node.js v24 で非推奨（deprecated）となった API を使用しない
2. If Node.js v24 でデフォルト動作が変更された機能（例: ESM ローダー、パーミッションモデルなど）がある場合, the GROWI application shall 新しいデフォルト動作に適合するか、明示的なオプトアウト設定を行う
3. The GROWI application shall Node.js v24 起動時に deprecation warning が出力されない状態を達成する

