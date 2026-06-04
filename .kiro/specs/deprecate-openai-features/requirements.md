# Requirements Document

## Project Description (Input)
features/openai ディレクトリを削除し OpenAI の FileSearch 関連機能を廃止したい。そして AI 機能は完全に features/mastra に移行したい。

- ナレッジアシスタント、エディターアシスタントの全ての機能を廃止する
- ai-assistant, thread-relation, vector-store-file-relation, vector-store モデル の廃止
- 一部 features/mastra で利用している UI コンポーネントがあるのでそれを features/mastra に移動
- 「アシスタント」という概念がなくなる。「マイアシスタント」「チームアシスタント」も廃止
- Mastra も一部 vectorStore に依存しているが、それも削除し file-search tool も削除する
- features/openai でしか使っていない i18n も全て削除
- 最終的には features/openai ディレクトリは全て消え、必要なファイルは features/mastra に移行する
- features/openai 由来のコードを使っている部分も綺麗にする
- mastra 版 AI 機能にチャットを開始するボタンがなくなるので左サイドバーに右サイドバーを開く導線を用意する
- thread 一覧機能は残す

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
