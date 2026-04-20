# 要件定義書

## Introduction

GROWI モノレポは現在、CJS と ESM が混在した状態で稼働している。`packages/` 配下の共有パッケージは 17 個中 12 個がすでに `"type": "module"` を宣言しているが、メインアプリケーション `apps/app` — ワークスペースルートと Express サーバビルドの両方 — は依然として既定で CommonJS として解決される。このミスマッチにより、以下の回避策を維持し続ける負担が累積している。

- `apps/app/next.config.ts` の `transpilePackages` に、ESM-only ライブラリを SSR ランタイムに橋渡しするためだけのハードコード 42 件 + プレフィックスベースの動的グループ 6 種 (`remark-` / `rehype-` / `hast-` / `mdast-` / `micromark-` / `unist-`) が積まれている。
- ルート `package.json` の `pnpm.overrides` が、サードパーティ製 CJS パッケージ `@lykmapipo/common` に追随させるために `flat` / `mime` / `parse-json` を古い CJS 互換バージョンに固定している。
- `@keycloak/keycloak-admin-client` v19+ のような ESM-only 依存は、ESM サーバビルドなしでは採用できない。

本機能は、対象範囲のモノレポをネイティブ ESM に移行する。完了すると `apps/app` の CJS 出力が排除され、`transpilePackages` の除去もしくは大幅削減が可能になり、ESM 前提の依存アップグレードの道が開かれる。

### 現状サマリ

| 範囲 | 件数 | 状態 |
|------|:---:|------|
| ESM 化済み共有パッケージ | 12 / 17 | `core`, `editor`, `emoji-mart-data`, `logger`, `pluginkit`, `presentation`, `remark-attachment-refs`, `remark-drawio`, `remark-growi-directive`, `remark-lsx`, `slack`, `ui` |
| CJS のまま残る共有パッケージ | 5 / 17 | `core-styles`, `custom-icons`, `pdf-converter-client`, `preset-templates`, `preset-themes` |
| `apps/pdf-converter` | — | ESM 化済み |
| `apps/app` クライアント (Next.js) | — | Turbopack により ESM 互換 |
| `apps/app` サーバ (Express) | — | **CommonJS** — `module.exports` を持つファイル 82、`require()` 出現箇所 176 (57 ファイル)、`__dirname` / `__filename` を使うファイル 3、`require('./x')(crowi, app)` 形式の factory DI 呼び出し 56 箇所 (`routes/index.js` に 12、`routes/apiv3/index.js` に 44) |
| `apps/slackbot-proxy` | — | **CommonJS** — 廃止予定のため対象外 |
| ワークスペースルート `package.json` | — | `"type": "module"` 未宣言 |

### プラットフォーム前提

- Node.js ^24 を実行基盤とし、`require(esm)` が安定機能として利用できる。
- `apps/app` の SSR バンドラは開発・本番の双方で Turbopack を使用する。
- `migrate-mongo` はマイグレーションファイルを CJS の `require()` で読み込み、ESM マイグレーションファイルをサポートしない。したがって `apps/app/src/migrations/` 配下の 60 本超のファイルは CJS として実行され続ける必要がある。

## Boundary Context

- **In scope**: ワークスペースルート・`apps/app`・残る CJS 共有パッケージへの `"type": "module"` 宣言付与、`apps/app` サーバビルドの ESM 出力化、サーバソースからの CJS 固有構文排除、`transpilePackages` の削減、サーバが CJS であったことのみを理由に存在する `pnpm.overrides` エントリの削除、消費側 CLI の都合で CJS のまま残す必要がある JavaScript ファイルの `.cjs` へのリネームまたはディレクトリ単位での明示的 CJS 化。
- **Out of scope**: `apps/slackbot-proxy` (廃止予定)、ESM 互換性のために必要な範囲を超える Crowi DI アーキテクチャの再設計、ESM 化によって初めて可能となる破壊的依存アップグレード (例: `@keycloak/keycloak-admin-client` メジャーバージョン更新)、`apps/app/src/migrations/*.js` の ESM 変換。
- **Adjacent expectations**: ESM-only 依存を推移的に取り込むサードパーティ CJS パッケージが実行時に解決されるよう、Node.js 24 の `require(esm)` が利用可能であり続けること。`transpilePackages` 削減後も残るパッケージに対しては Turbopack の解決・外部化が引き続き機能すること。`migrate-mongo` が明示的に CJS として扱われるディレクトリから CJS マイグレーションファイルをロードし続けること。

## Requirements

### Requirement 1: 残余共有パッケージの ESM 宣言

**Objective:** GROWI メンテナとして、`packages/` 配下のすべての共有パッケージが ESM を宣言・出力している状態にしたい。ライブラリ層がコンシューマに対して単一のモジュールシステムを露出するためである。

#### Acceptance Criteria

1. The `@growi/pdf-converter-client`, `@growi/preset-templates`, `@growi/preset-themes`, `@growi/core-styles`, `@growi/custom-icons` の各パッケージの `package.json` shall それぞれ `"type": "module"` を宣言する。
2. When 共有パッケージがコンパイル済み JavaScript を出力する場合, the ビルド shall 当該パッケージを ESM として出力する。
3. Where 共有パッケージが現時点で ESM + CJS のデュアルバンドルを出力している場合, the CJS バンドル shall すべての消費者が ESM 互換であると確認されるまで維持される。
4. When 5 パッケージすべての変換が完了した場合, `turbo run build` shall 対象パッケージに対して成功する。

### Requirement 2: apps/app サーバ層の ESM 移行

**Objective:** GROWI メンテナとして、`apps/app` の Express サーバが ESM として記述・出力されている状態にしたい。ESM-only 依存をネイティブに import でき、CJS 出力を前提とした下流の回避策が除去できるためである。

#### Acceptance Criteria

1. When 移行が完了した場合, the `apps/app` サーバビルド shall ESM を出力する。
2. The `apps/app` サーバソースツリー shall `module.exports` 代入と `exports.<name> =` 代入を一切含まない。
3. The `apps/app` サーバソースツリー shall 静的 `require()` および固定パスを引数とする動的 `require()` を一切含まない。
4. The `apps/app` サーバソースツリー shall `__dirname` および `__filename` への参照を一切含まない。
5. Where サーバが以前、実行時に決定されるパスを引数とする動的 `require()` を使用していた場合, the サーバ shall 同等の振る舞いを動的 `import()` 式で実現する。
6. When 中央ルーター群がルートモジュールを登録する場合, the 中央ルーター群 shall ES `import` と明示的なファクトリ呼び出しを通じて登録し、起動時の初期化デッドロックを引き起こさない。
7. When サーバ移行が完了した場合, `pnpm dev` shall 開発サーバを起動し、the 開発サーバ shall HTTP リクエストを処理する。
8. When サーバ移行が完了した場合, `turbo run build --filter @growi/app` shall 成功し、ビルド成果物のサーバ shall 起動して HTTP リクエストを処理する。
9. When サーバ移行が完了した場合, `turbo run test --filter @growi/app` shall 移行前のベースラインと比較して新規の失敗なく通過する。

### Requirement 3: transpilePackages の削減

**Objective:** GROWI メンテナとして、`apps/app/next.config.ts` の `transpilePackages` に CJS/ESM 互換性以外の理由で強制トランスパイルが必要なエントリのみが残っている状態にしたい。Turbopack が ESM パッケージを自然に解決し、リストが実需要を反映するためである。

#### Acceptance Criteria

1. When サーバ層が ESM を出力するようになった場合, the 移行プロセス shall `transpilePackages` 内のハードコードエントリおよびプレフィックスベースの各グループを削除候補として評価する。
2. When エントリが削除された場合, the SSR ビルドおよびサーバランタイム shall 対象パッケージを `ERR_MODULE_NOT_FOUND` / `ERR_REQUIRE_ESM` なしで解決する。
3. If エントリの削除がビルド失敗または実行時失敗を引き起こす場合, the 移行プロセス shall そのエントリを維持し、理由を記録する。
4. When 削減が完了した場合, the `transpilePackages` に残存する各エントリ shall CJS 以外の理由に基づく正当化を持つ。
5. When 削減が完了した場合, `turbo run build --filter @growi/app` shall 成功し、本番サーバ shall 起動する。

### Requirement 4: pnpm.overrides のクリーンアップ

**Objective:** GROWI メンテナとして、ESM-only の推移的依存を古いバージョンに固定している `pnpm.overrides` エントリが、ESM 移行によって不要になった時点で除去されている状態にしたい。対象の推移的依存がセキュリティ更新・機能更新を受けられるようにするためである。

#### Acceptance Criteria

1. When サーバ層が ESM を出力するようになった場合, the 移行プロセス shall 各 `@lykmapipo/common>*` override (`flat`, `mime`, `parse-json`) を削除候補として評価する。
2. When override が削除された場合, `pnpm install` および `turbo run build` shall 成功する。
3. When override が削除された場合, the サーバ shall 起動し、対象パッケージに推移的に依存するコードパスを実行時エラーなく実行する。
4. If override の削除がインストール・ビルド・実行時のいずれかの失敗を引き起こす場合, the 移行プロセス shall 該当 override を維持し、原因を記録する。
5. CJS/ESM 互換性以外の理由で存在する override (例: セキュリティピン用の `axios`) shall 本移行によって変更されない。

### Requirement 5: type: module の宣言と CJS 限定箇所の隔離

**Objective:** GROWI メンテナとして、対象範囲のすべての `package.json` が `"type": "module"` を宣言し、かつ CJS のまま残す必要のあるファイルが明示的にそれと分かる形で管理されている状態にしたい。既定のモジュール扱いを ESM に寄せ、CJS は消費側ツールが要求する箇所だけに局所化するためである。

#### Acceptance Criteria

1. The ワークスペースルート `package.json` shall `"type": "module"` を宣言する。
2. The `apps/app/package.json` shall `"type": "module"` を宣言する。
3. 対象範囲の `packages/*/package.json` すべて shall `"type": "module"` を宣言する。
4. Where 消費側 CLI が ESM をサポートしないために JavaScript ファイルを CJS のまま残す必要がある場合, the 当該ファイル shall `.cjs` 拡張子を用いるか、`"type": "commonjs"` を宣言した `package.json` を持つディレクトリに配置される。
5. The `apps/app/src/migrations/` ディレクトリ shall `migrate-mongo` がマイグレーションファイルを引き続きロード・実行できるよう CJS のまま維持される。
6. When 宣言と隔離が完了した場合, `pnpm install` および `turbo run build` shall 対象範囲のすべてのワークスペースで成功する。

### Requirement 6: ビルド・テスト・ランタイム検証

**Objective:** GROWI メンテナとして、ESM 移行がリグレッションを持ち込まないことがエンドツーエンドで検証されている状態にしたい。稼働中のアプリケーションが移行前の機能と運用性を維持するためである。

#### Acceptance Criteria

1. When 移行全体が完了した場合, `turbo run build` shall 対象範囲のすべてのワークスペースで成功する。
2. When 移行全体が完了した場合, `turbo run lint` shall 対象範囲のすべてのワークスペースで通過する。
3. When 移行全体が完了した場合, `turbo run test` shall 対象範囲のすべてのワークスペースで、移行前のベースラインと比較して新規失敗なく通過する。
4. When 移行全体が完了した場合, `assemble-prod.sh` shall 正常に起動する本番アーティファクトを生成する。
5. While 本番アーティファクト上で稼働している間, the Express API・Next.js SSR レンダリング・WebSocket 接続 shall 移行前と同様に機能する。
6. If いずれかの移行ステップが検証失敗を引き起こす場合, the 移行プロセス shall 次のステップに進む前に停止して当該失敗を是正する。

### Requirement 7: ドキュメントとコメントの整合

**Objective:** GROWI 貢献者として、移行の意思決定や移行後に残存する制約がコード近傍に文書化されている状態にしたい。将来の作業が、移行後に残る pin・override・`transpilePackages` エントリの存在理由を理解できるようにするためである。

#### Acceptance Criteria

1. When 移行が完了した場合, the `package.json` 内の `// comments for dependencies` ブロック shall すでに解消済みの CJS/ESM ピン理由を記述しない。
2. Where Requirement 3 完了後も `transpilePackages` にエントリが残る場合, the エントリ shall 近傍に正当化のコメントを持つ。
3. Where Requirement 4 完了後も `pnpm.overrides` にエントリが残る場合, the エントリ shall 近傍に正当化のコメントを持つ。
4. When 移行が完了した場合, the ステアリング文書 (`.kiro/steering/tech.md` および CJS/ESM 状態を記述する自動ロード skill) shall 新しいアーキテクチャを反映する。
