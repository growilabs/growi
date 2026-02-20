# Implementation Plan

> **タスク順序の設計方針**:
> - **Phase 1（本フェーズ）**: DHI ベースイメージ + TypeScript entrypoint で、現行と同一仕様のイメージを再現する。ビルドパイプライン（`COPY . .` による 3 ステージ構成）は現行を維持し、**runtime の安全な移行を優先**する。
> - **Phase 2（次フェーズ）**: `turbo prune --docker` パターンの導入によるビルド最適化。Phase 1 で runtime が安定してから実施する。pruner/deps ステージの追加で 5 ステージ化。
>
> **実装ディレクトリ**: `apps/app/docker-new/` に新規作成する。現行の `apps/app/docker/` は一切変更しない。並行して比較・検証可能な状態を維持する。
>
> ディレクトリ権限周りは最優先で実装・テストし、デグレを早期に検出する。entrypoint（TypeScript）と Dockerfile は独立したファイルのため、一部タスクは並行実行可能。

## Phase 1: DHI + TypeScript entrypoint（現行ビルドパターン維持）

- [ ] 1. (P) ビルドコンテキストフィルタの強化
  - 現行の除外ルールに `.git`、`.env*`（production 以外）、テストファイル、IDE 設定ファイル等を追加する
  - セキュリティ上の機密ファイル（シークレット、認証情報）がコンテキストに含まれないことを確認する
  - 現行の除外ルール（`node_modules`、`.next`、`.turbo`、`apps/slackbot-proxy` 等）は維持する
  - _Requirements: 4.3_

- [ ] 2. TypeScript entrypoint のディレクトリ初期化と権限管理
- [ ] 2.1 (P) entrypoint スケルトンと再帰 chown ヘルパーの作成
  - Node.js 24 の type stripping で直接実行可能な TypeScript ファイルを新規作成する（enum 不使用、erasable syntax のみ）
  - メインの実行フローを `main()` 関数として構造化し、エラーハンドリングのトップレベル try-catch を設ける
  - ディレクトリ内のファイル・サブディレクトリを再帰的に所有者変更するヘルパー関数を実装する
  - ヘルパー関数のユニットテストを作成する（ネストされたディレクトリ構造での再帰動作を検証）
  - _Requirements: 6.8_

- [ ] 2.2 ディレクトリ初期化処理の実装
  - `/data/uploads` の作成、`./public/uploads` へのシンボリックリンク作成、再帰的な所有者変更を実装する
  - `/tmp/page-bulk-export` の作成、再帰的な所有者変更、パーミッション 700 の設定を実装する
  - 冪等性を確保する（`recursive: true` による mkdir、既存シンボリックリンクの重複作成防止）
  - **現行 `docker-entrypoint.sh` と同一の振る舞い**を保証するユニットテストを作成する（fs モック使用、ディレクトリ・シンボリックリンク・所有者・パーミッションの各状態を検証）
  - 失敗時（ボリュームマウント未設定等）にプロセス終了（exit code 1）することを検証する
  - _Requirements: 6.3, 6.4_

- [ ] 2.3 権限ドロップの実装
  - root から node ユーザー（UID 1000, GID 1000）への降格処理を実装する
  - supplementary groups の初期化を行い、setgid → setuid の順序を厳守する（逆順だと setgid が失敗する）
  - 権限ドロップ失敗時にエラーメッセージを出力してプロセスを終了する
  - _Requirements: 4.1, 6.2_

- [ ] 3. ヒープサイズ算出とノードフラグ組み立て
- [ ] 3.1 (P) cgroup メモリリミット検出の実装
  - cgroup v2 ファイルの読み取りと数値パースを実装する（`"max"` 文字列は unlimited として扱う）
  - cgroup v1 ファイルへのフォールバックを実装する（64GB 超は unlimited として扱う）
  - メモリリミットの 60% をヒープサイズ（MB 単位）として算出する
  - ファイル読み取り失敗時は警告ログを出力し、フラグなし（V8 デフォルト）で続行する
  - 各パターン（v2 正常検出、v2 unlimited、v1 フォールバック、v1 unlimited、検出不可）のユニットテストを作成する
  - _Requirements: 2.2, 2.3_

- [ ] 3.2 (P) 環境変数によるヒープサイズ指定の実装
  - `GROWI_HEAP_SIZE` 環境変数のパースとバリデーションを実装する（正の整数、MB 単位）
  - 不正値（NaN、負数、空文字列）の場合は警告ログを出力してフラグなしにフォールバックする
  - 環境変数指定が cgroup 自動算出より優先されることをテストで確認する
  - _Requirements: 2.1_

- [ ] 3.3 ノードフラグの組み立てとログ出力の実装
  - 3 段フォールバック（環境変数 → cgroup 算出 → V8 デフォルト）の統合ロジックを実装する
  - `--expose_gc` フラグを常時付与する
  - `GROWI_OPTIMIZE_MEMORY=true` で `--optimize-for-size`、`GROWI_LITE_MODE=true` で `--lite-mode` を追加する
  - `--max-heap-size` を spawn 引数として直接渡す構造にする（`--max_old_space_size` は不使用、`NODE_OPTIONS` には含めない）
  - 適用されたフラグの内容を標準出力にログ出力する（どの段で決定されたかを含む）
  - 環境変数の各組み合わせパターン（全未設定、HEAP_SIZE のみ、全有効等）のユニットテストを作成する
  - _Requirements: 2.4, 2.5, 2.6, 2.7, 6.1, 6.6, 6.7_

- [ ] 4. マイグレーション実行とアプリプロセス管理
- [ ] 4.1 マイグレーションの直接実行
  - node バイナリを直接呼び出して migrate-mongo を実行する（npm run を使用しない、シェルを介さない）
  - 標準入出力を inherit して migration のログを表示する
  - migration 失敗時は例外をキャッチしてプロセスを終了し、コンテナオーケストレーターによる再起動を促す
  - _Requirements: 6.5_

- [ ] 4.2 アプリプロセスの起動とシグナル管理
  - 算出済みノードフラグを引数に含めた子プロセスとしてアプリケーションを起動する
  - SIGTERM、SIGINT、SIGHUP を子プロセスにフォワードする
  - 子プロセスの終了コード（またはシグナル）を entrypoint の終了コードとして伝播する
  - PID 1 としての責務（シグナルフォワーディング、子プロセス reap、graceful shutdown）を検証するテストを作成する
  - _Requirements: 6.2, 6.5_

- [ ] 5. Dockerfile の再構築（現行 3 ステージパターン + DHI）
- [ ] 5.1 (P) base ステージの構築
  - DHI dev イメージをベースに設定し、syntax ディレクティブを最新安定版自動追従に更新する
  - wget スタンドアロンスクリプトで pnpm をインストールする（バージョンのハードコードを排除する）
  - turbo をグローバルにインストールする
  - ビルドに必要なパッケージを `--no-install-recommends` 付きでインストールし、apt キャッシュマウントを適用する
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 3.3, 4.4_

- [ ] 5.2 builder ステージの構築
  - 現行の `COPY . .` パターンを維持してモノレポ全体をコピーし、依存インストール・ビルド・本番依存抽出を行う
  - `--frozen-lockfile` の typo（ダッシュ3つ → 2つ）を修正する
  - pnpm store のキャッシュマウントを設定してリビルド時間を短縮する
  - 本番依存のみを抽出し、tar.gz にパッケージングする（`apps/app/tmp` ディレクトリを含む）
  - `.next/cache` がアーティファクトに含まれないことを保証する
  - _Requirements: 1.4, 3.2, 3.4_

- [ ] 5.3 release ステージの構築
  - DHI ランタイムイメージをベースに設定し、追加バイナリのコピーを一切行わない
  - ビルドステージのアーティファクトをバインドマウント経由で展開する
  - TypeScript entrypoint ファイルを COPY し、ENTRYPOINT に node 経由の直接実行を設定する
  - リリースステージにビルドツール（turbo、pnpm、node-gyp 等）やビルド用パッケージ（wget、curl 等）が含まれないことを確認する
  - _Requirements: 1.1, 3.5, 4.2, 4.5_

- [ ] 5.4 (P) OCI ラベルとポート・ボリューム宣言の設定
  - OCI 標準ラベル（source、title、description、vendor）を設定する
  - `EXPOSE 3000` と `VOLUME /data` を維持する
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 6. 統合検証と後方互換性の確認
- [ ] 6.1 Docker ビルドの E2E 検証
  - 3 ステージ全てが正常完了する Docker ビルドを実行し、ビルドエラーがないことを確認する
  - リリースイメージにシェル、apt、ビルドツールが含まれていないことを確認する
  - _Requirements: 1.1, 4.2, 4.5_

- [ ] 6.2 ランタイム動作と後方互換性の検証
  - 環境変数（`MONGO_URI`、`FILE_UPLOAD` 等）が従来通りアプリケーションに透過されることを確認する
  - `/data` ボリュームマウントとの互換性およびファイルアップロード動作を確認する
  - ポート 3000 でのリッスン動作を確認する
  - メモリ管理環境変数が未設定の場合に V8 デフォルト動作となることを確認する
  - `docker compose up` での起動と SIGTERM による graceful shutdown を確認する
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

## Phase 2: turbo prune --docker ビルド最適化（次フェーズ）

> Phase 1 で runtime が安定した後に実施する。現行の `COPY . .` + 3 ステージ構成を `turbo prune --docker` + 5 ステージ構成に移行し、ビルドキャッシュ効率を向上させる。

- [ ] 7. turbo prune --docker パターンの導入
- [ ] 7.1 pruner ステージの新設
  - base ステージの直後に pruner ステージを追加し、`turbo prune @growi/app --docker` でモノレポを Docker 用に最小化する
  - pnpm workspace との互換性を検証する（非互換の場合は Phase 1 の `COPY . .` パターンを維持）
  - 出力（json ディレクトリ、lockfile、full ディレクトリ）が正しく生成されることを確認する
  - _Requirements: 3.1_

- [ ] 7.2 deps ステージの分離と builder の再構成
  - builder ステージから依存インストールを分離し、deps ステージとして独立させる
  - pruner の出力から package.json 群と lockfile のみをコピーして依存をインストールする（レイヤーキャッシュ効率化）
  - builder ステージは deps をベースにソースコードをコピーしてビルドのみを行う構成に変更する
  - 依存変更なし・ソースコードのみ変更の場合に、依存インストールレイヤーがキャッシュされることを検証する
  - _Requirements: 3.1, 3.2_

- [ ] 7.3 5 ステージ構成の統合検証
  - base → pruner → deps → builder → release の 5 ステージ全てが正常完了することを確認する
  - Phase 1 の 3 ステージ構成と同等の runtime 動作を維持していることを確認する
  - ビルドキャッシュの効率改善（ソースコード変更時に依存インストールがスキップされること）を検証する
  - _Requirements: 3.1, 3.2, 3.4_
