# 開発環境とツール

## 推奨システム要件
- **Node.js**: ^20 || ^22
- **パッケージマネージャー**: pnpm 10.4.1
- **OS**: Linux（Ubuntuベース）、macOS、Windows

## 利用可能なLinuxコマンド
基本的なLinuxコマンドが利用可能：
- `apt`, `dpkg`: パッケージ管理
- `git`: バージョン管理
- `curl`, `wget`: HTTP クライアント
- `ssh`, `scp`, `rsync`: ネットワーク関連
- `ps`, `lsof`, `netstat`, `top`: プロセス・ネットワーク監視
- `tree`, `find`, `grep`: ファイル検索・操作
- `zip`, `unzip`, `tar`, `gzip`, `bzip2`, `xz`: アーカイブ操作

## 開発用ブラウザ
```bash
# ローカルサーバーをブラウザで開く
"$BROWSER" http://localhost:3000
```

## 環境変数管理
- **dotenv-flow**: 環境ごとの設定管理
- 環境ファイル:
  - `.env.development`: 開発環境
  - `.env.production`: 本番環境
  - `.env.test`: テスト環境
  - `.env.*.local`: ローカル固有設定

## デバッグ
```bash
# デバッグモードでサーバー起動
cd apps/app && pnpm run dev  # --inspectフラグ付きでnodemon起動

# REPL（Read-Eval-Print Loop）
cd apps/app && pnpm run repl
```

## VS Code設定
`.vscode/` ディレクトリに設定ファイルが含まれており、推奨拡張機能や設定が適用される。

## Docker対応
各アプリケーションにDockerファイルが含まれており、コンテナベースでの開発も可能。