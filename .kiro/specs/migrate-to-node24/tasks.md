# Implementation Plan

- [x] 1. package.json のエンジン制約を Node.js v24 に更新
- [x] 1.1 (P) ルート package.json の engines.node フィールドを v24 のみ許可に変更する
  - `engines.node` を `"^18 || ^20"` から `"^24"` に変更する
  - SemVer 範囲指定形式（`^24`）を使用し、将来 `"^24 || ^26"` への拡張が容易な形式を維持する
  - ワークスペース内の各 package.json に独自の engines フィールドが存在しないことを確認する（存在する場合は `^24` に統一）
  - _Requirements: 1.1, 1.2, 1.3, 4.2_

- [x] 2. 全 Dockerfile のベースイメージを node:24-slim に更新し ARG でパラメータ化
- [x] 2.1 (P) app の Dockerfile を node:24-slim に変更し、NODE_VERSION ARG を導入する
  - `apps/app/docker/Dockerfile` の base ステージと release ステージの両方でベースイメージを変更する
  - `ARG NODE_VERSION=24` をグローバル ARG として導入し、`FROM node:${NODE_VERSION}-slim` で参照する
  - マルチステージビルドの各 FROM 前に ARG を再宣言する（Docker の仕様に従う）
  - pnpm バージョン（10.4.1）のピン留めは変更しない
  - _Requirements: 2.1, 2.4, 4.3_

- [x] 2.2 (P) pdf-converter の Dockerfile を node:24-slim に変更し、NODE_VERSION ARG を導入する
  - `apps/pdf-converter/docker/Dockerfile` の base ステージと release ステージの両方でベースイメージを変更する
  - app と同じパターンで `ARG NODE_VERSION=24` を導入する
  - Puppeteer/Chromium 関連の設定は変更しない
  - _Requirements: 2.2, 2.4, 4.3_

- [x] 2.3 (P) slackbot-proxy の Dockerfile を node:24-slim に変更し、NODE_VERSION ARG を導入する
  - `apps/slackbot-proxy/docker/Dockerfile` の base ステージと release ステージの両方でベースイメージを変更する
  - app と同じパターンで `ARG NODE_VERSION=24` を導入する
  - _Requirements: 2.3, 2.4, 4.3_

- [x] 3. CI/CD ワークフローの Node.js バージョンを v24 に更新
- [x] 3.1 (P) 開発 CI ワークフロー 3 ファイルの node-version マトリクスを 24.x に変更する
  - `ci-app.yml` の全マトリクス箇所で `node-version: [20.x]` を `node-version: [24.x]` に変更する
  - `ci-pdf-converter.yml` の全マトリクス箇所で同様に変更する
  - `ci-slackbot-proxy.yml` の全マトリクス箇所で同様に変更する
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3.2 (P) 本番 CI ワークフローの Node.js バージョンジョブを v24 に統合する
  - `ci-app-prod.yml` の `test-prod-node18` と `test-prod-node20` の 2 ジョブを `test-prod-node24` の 1 ジョブに統合する
  - E2E テスト（skip-e2e-test）の制御は既存の node20 ジョブのロジックを引き継ぐ
  - 個別ジョブパターンの構造を維持し、将来 v26 追加時にジョブをコピーして追加できる形式を保つ
  - _Requirements: 3.4, 4.1_

- [x] 3.3 (P) reusable ワークフローとリリースワークフローの node-version を更新する
  - `reusable-app-prod.yml` の `workflow_dispatch.inputs.node-version.default` を `22.x` から `24.x` に変更する
  - `release-subpackages.yml` の全箇所で `node-version: '20'` を `node-version: '24'` に変更する
  - _Requirements: 3.5, 3.6_

- [x] 4. (P) ドキュメントの Node.js バージョン記載を v24 に更新する
  - `README.md` の Node.js バージョン記載を `v24.x` に更新する
  - `README_JP.md` の Node.js バージョン記載を `v24.x` に更新する
  - プロジェクト内に他の Node.js バージョンを参照するドキュメントが存在する場合はそれらも v24 に更新する
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Node.js v24 環境での互換性検証と問題解消
- [x] 5.1 v24 環境で依存パッケージのインストールとビルドが成功することを確認する
  - Node.js v24 環境で `pnpm install --frozen-lockfile` を実行し、エラーや互換性警告がないことを確認する
  - `turbo run build --filter @growi/app` を実行し、全ワークスペースでビルドが成功することを確認する
  - `turbo run lint:typecheck --filter @growi/app` を実行し、型チェックが通ることを確認する
  - 非互換パッケージが発見された場合はバージョンアップまたは代替パッケージへの置換で解消する
  - _Requirements: 6.1, 6.2, 6.4_

- [x] 5.2 v24 環境で既存テストスイートが全て合格することを確認する
  - `turbo run test --filter @growi/app` を実行し、全テストが合格することを確認する
  - テスト失敗が v24 の動作変更（AsyncLocalStorage、fetch() の strictness 等）に起因する場合は、テストコードまたはアプリケーションコードを修正する
  - _Requirements: 6.3_

- [x] 5.3 v24 起動時に deprecation warning が出力されないことを確認する
  - Node.js v24 でアプリケーションを起動し、コンソール出力に deprecation warning が含まれないことを確認する
  - GROWI ソースコード内で v24 非推奨 API（url.parse, SlowBuffer, dirent.path 等）が使用されていないことを再確認する
  - 依存パッケージ由来の deprecation warning が存在する場合は、パッケージのアップデートで解消する
  - _Requirements: 7.1, 7.2, 7.3_
