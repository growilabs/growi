# Requirements Document

## Project Description (Input)
## 概要
- AI チャット欄にて "@/{page path 名}" を入力すると GROWI に保存されているページパスを検索して参照先ページとして指定できる機能を実装したい。
- 検索は既存の ElasticSearch の機能を使う。内部ロジックは SearchModal などが参考になると思う
- Claude Code に標準的に搭載されている機能が参考になる

## 挙動のイメージ
1. "@" の後に文字列を入力するとインクリメンタルサーチが行われ検索結果のページパス候補リストが表示される
2. ユーザーが候補リストの中でに任意のパスを選択するとチャット画面のテキストインプットに選択されたページパスが、rich text として表示される

### rich text
- 入力された他の文字列とは独立しており、clickable
- クリックすると対象のページに遷移できる
- 他の文字列と視覚的に区別できるようにする

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
