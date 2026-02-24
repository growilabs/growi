# Research & Design Decisions

---
**Purpose**: Node.js v24 移行に関する調査結果、破壊的変更の分析、およびアーキテクチャ決定の記録
---

## Summary
- **Feature**: `migrate-to-node24`
- **Discovery Scope**: Extension（既存システムの構成変更）
- **Key Findings**:
  - GROWI アプリケーションコードには Node.js v24 で問題となる非推奨 API の使用がほぼ存在しない
  - 主要な変更箇所は構成ファイル（package.json、Dockerfile、CI ワークフロー）に集中している
  - Node.js v24 は OpenSSL 3.5（セキュリティレベル 2）を採用し、暗号鍵の最小ビット長が引き上げられている
  - ネイティブアドオン（@swc/core、@rollup/rollup 等）はプリビルドバイナリを使用しており、v24 対応版が利用可能

## Research Log

### Node.js v24 の破壊的変更一覧
- **Context**: Node.js v18/v20 → v24 移行時に影響する変更を特定する
- **Sources Consulted**:
  - [Node.js v22 to v24 Migration Guide](https://nodejs.org/en/blog/migrations/v22-to-v24)
  - [Node.js 24.0.0 Release Notes](https://nodejs.org/en/blog/release/v24.0.0)
  - [Node.js 24 Becomes LTS](https://nodesource.com/blog/nodejs-24-becomes-lts)
- **Findings**:
  - **OpenSSL 3.5（セキュリティレベル 2）**: RSA/DSA/DH 鍵 < 2048 bit、ECC 鍵 < 224 bit が禁止。RC4 暗号スイートも禁止
  - **V8 13.6**: NODE_MODULE_VERSION = 137。ネイティブアドオンの再ビルドが必要
  - **url.parse() ランタイム非推奨**: WHATWG URL API への移行を推奨
  - **SlowBuffer ランタイム非推奨**: Buffer.allocUnsafe() を使用すべき
  - **tls.createSecurePair() 削除**: 完全に削除済み
  - **dirent.path 削除**: dirent.parentPath を使用
  - **fs.truncate() に fd を渡す用法の削除**: fs.ftruncate() を使用
  - **HTTP OutgoingMessage._headers / _headersList 削除**: 内部プロパティへの直接アクセス不可
  - **AsyncLocalStorage のデフォルト変更**: AsyncContextFrame がデフォルトに
  - **fetch() のコンプライアンス強化**: RFC 準拠の厳格化
  - **テストランナーの変更**: t.test() がプロミスを返さなくなった
  - **Permission Model フラグ変更**: `--experimental-permission` → `--permission`
  - **C++20 が必要になる可能性**: V8 13.6 にリンクするネイティブアドオン
  - **32-bit Windows/armv7 Linux のサポート終了**
- **Implications**:
  - GROWI ソースコードには上記の非推奨/削除 API の直接使用がほぼ見られない（コード分析で確認済み）
  - 依存パッケージ経由で影響を受ける可能性があるため、install + build + test での検証が必要
  - OpenSSL 3.5 の暗号鍵制限は LDAP/SAML/OAuth 連携に影響する可能性がある

### GROWI コードベースの互換性分析
- **Context**: 既存コードが Node.js v24 で問題なく動作するか検証
- **Sources Consulted**: コードベース全体の Grep/Read 分析
- **Findings**:
  - `url.parse()` — GROWI ソースコードでは未使用
  - `Buffer()` コンストラクタ（new なし）— 未使用
  - `require('punycode')` — 未使用
  - `util.is*()` メソッド — 未使用
  - `crypto.createCipher/Decipher()` — 未使用
  - `fs.exists()` — 未使用（`fs.existsSync()` は使用されているが安全）
  - `domain` モジュール — 未使用
  - `SlowBuffer` — 未使用
  - `process.binding()` — 未使用
  - `tls.createSecurePair()` — 未使用
  - `dirent.path` — 未使用
  - `__dirname` / `__filename` — CommonJS コンテキストのみで使用（安全）
- **Implications**: アプリケーションコード自体に互換性の問題はない。変更は構成ファイルに集中する

### Docker イメージの可用性
- **Context**: `node:24-slim` イメージが Docker Hub で利用可能か確認
- **Sources Consulted**: [Docker Hub - node:24-slim](https://hub.docker.com/layers/library/node/24-slim/)
- **Findings**:
  - `node:24-slim` は Docker Hub で利用可能（bookworm-slim ベース）
  - `node:24-bookworm-slim`、`node:24-trixie-slim` 等のバリアントも利用可能
  - Node.js 24 は LTS（コードネーム "Krypton"）として 2028 年 4 月までサポート
- **Implications**: Docker イメージの変更は問題なく実施可能

### ネイティブ依存パッケージの v24 対応状況
- **Context**: ネイティブバイナリを含むパッケージが v24 で動作するか確認
- **Sources Consulted**: package.json、node_modules 構造の分析
- **Findings**:
  - `@swc/core` — プリビルドバイナリ方式。v24 対応版は新しいリリースで提供される
  - `@rollup/rollup` — プリビルドバイナリ方式。同上
  - `@next/swc` — Next.js が管理。Next.js バージョンに依存
  - `leveldown` — `ignoredBuiltDependencies` に設定済み
  - `dtrace-provider` — `ignoredBuiltDependencies` に設定済み
  - `ttf2woff2` — `ignoredBuiltDependencies` に設定済み
  - `lefthook` — `onlyBuiltDependencies` に設定（ビルド対象）
- **Implications**: `ignoredBuiltDependencies` 設定により、ほとんどのネイティブ依存はビルドをスキップする。プリビルドバイナリが v24 対応であれば問題なし

### pnpm 互換性
- **Context**: pnpm 10.4.1 が Node.js v24 をサポートするか確認
- **Sources Consulted**: pnpm リリースノート
- **Findings**: pnpm v10.x は Node.js 18+ をサポートしており、v24 との互換性に問題なし
- **Implications**: パッケージマネージャーの変更は不要

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 構成ファイル一括更新 | package.json, Dockerfile, CI を一度に v24 のみに変更 | シンプル、一貫性が高い | ロールバックが大きい | 要件に合致（v24 のみ対応） |
| 段階的移行（v20 + v24 併存） | まず v24 を追加し、後に v20 を削除 | リスクが低い | 複雑、テスト工数増 | 要件は v24 のみ対応だが、機構は残す |

**選択**: 構成ファイル一括更新（v24 のみ）。ただし CI マトリクス構造と Docker ARG パラメータを維持し、将来の v26 追加に備える。

## Design Decisions

### Decision: Dockerfile のバージョンパラメータ化
- **Context**: 現在の Dockerfile はベースイメージのバージョンがハードコードされている（`node:20-slim`）
- **Alternatives Considered**:
  1. ハードコードを `node:24-slim` に直接書き換え — シンプルだが将来の変更時に再度全ファイル編集が必要
  2. `ARG NODE_VERSION=24` で外部パラメータ化 — ビルド時に `--build-arg` でバージョン指定可能
- **Selected Approach**: Option 2（ARG によるパラメータ化）
- **Rationale**: 要件 4.3 で「ベースイメージのバージョンをビルド引数として外部から指定可能な構造」が求められている。将来の v26 対応時に Dockerfile 自体の変更なしにバージョン切り替えが可能
- **Trade-offs**: Dockerfile が若干複雑になるが、運用の柔軟性が大幅に向上
- **Follow-up**: CI/CD パイプラインでの `--build-arg` 指定方法を確認

### Decision: CI マトリクス構造の維持方針
- **Context**: `ci-app-prod.yml` では Node.js バージョンごとに個別ジョブ（`test-prod-node18`, `test-prod-node20`）が定義されている
- **Alternatives Considered**:
  1. 個別ジョブパターンを維持し、v24 のみのジョブに変更 — 将来 v26 追加時にジョブ追加で対応
  2. マトリクス strategy に変更 — `node-version: [24.x]` として将来 `[24.x, 26.x]` に拡張
- **Selected Approach**: Option 1（個別ジョブパターン維持）
- **Rationale**: 既存のパターンを踏襲し、変更量を最小化。各バージョンで E2E テストのスキップ有無など個別制御が可能な柔軟性を維持
- **Trade-offs**: ジョブ追加時の変更箇所が多いが、バージョンごとの設定差異を表現しやすい
- **Follow-up**: なし

### Decision: engines フィールドの記述形式
- **Context**: ルート `package.json` の `engines.node` をどの形式で記述するか
- **Alternatives Considered**:
  1. `"^24"` — v24.x のみを許可
  2. `">=24"` — v24 以上すべてを許可
- **Selected Approach**: Option 1（`"^24"`）
- **Rationale**: SemVer 範囲指定で明示的にメジャーバージョンを制限。将来 v26 追加時は `"^24 || ^26"` に拡張する想定。`>=24` だと未検証のメジャーバージョンまで許可してしまうリスクがある
- **Trade-offs**: v26 追加時に engines フィールドの変更が必要だが、安全性が高い
- **Follow-up**: なし

## Risks & Mitigations
- **ネイティブアドオンの v24 プリビルドバイナリ未提供リスク** — `pnpm install` 時のビルドエラー。緩和策: 依存パッケージの最新版にアップデートし、プリビルド対応を確認
- **OpenSSL 3.5 による暗号鍵制限** — LDAP/SAML 連携で 2048 bit 未満の鍵を使用している外部サービスとの接続失敗。緩和策: 事前に暗号鍵サイズを監査
- **依存パッケージの内部での非推奨 API 使用** — deprecation warning の大量出力。緩和策: `pnpm install` + `turbo run build` + テスト実行で事前検証
- **Next.js 14.x の Node.js v24 サポート状況** — 公式には Node.js 18-20 がサポート対象。緩和策: Next.js の最新パッチバージョンで v24 動作を確認、必要に応じてアップグレード

## References
- [Node.js v22 to v24 Migration Guide](https://nodejs.org/en/blog/migrations/v22-to-v24) — 公式移行ガイド
- [Node.js 24.0.0 Release Notes](https://nodejs.org/en/blog/release/v24.0.0) — 全変更一覧
- [Node.js 24 Becomes LTS](https://nodesource.com/blog/nodejs-24-becomes-lts) — LTS ステータスの詳細
- [Docker Hub - node:24-slim](https://hub.docker.com/layers/library/node/24-slim/) — Docker イメージの可用性
- [Node.js 20 End of Life Playbook](https://dev.to/matheus_releaserun/nodejs-20-end-of-life-migration-playbook-for-april-30-2026-2onh) — v20 EOL 情報
