# GROWIプロジェクト概要

## 目的
GROWIは、マークダウンを使用したチームコラボレーションソフトウェアです。Wikiとドキュメント作成ツールの機能を持ち、チーム間の情報共有とコラボレーションを促進します。

## プロジェクトの詳細
- **プロジェクト名**: GROWI
- **バージョン**: 7.3.0-RC.0
- **ライセンス**: MIT
- **作者**: Yuki Takei <yuki@weseek.co.jp>
- **リポジトリ**: https://github.com/growilabs/growi.git
- **公式サイト**: https://growi.org

## 主な特徴
- Markdownベースのドキュメント作成
- チームコラボレーション機能
- Wikiのような情報共有プラットフォーム
- ドキュメント管理とバージョン管理

## アーキテクチャ
- **モノレポ構成**: pnpm workspace + Turbo.js を使用
- **主要アプリケーション**: apps/app (メインアプリケーション)
- **追加アプリケーション**: 
  - apps/pdf-converter (PDF変換サービス)
  - apps/slackbot-proxy (Slackボットプロキシ)
- **パッケージ**: packages/ 配下に複数の共有ライブラリ