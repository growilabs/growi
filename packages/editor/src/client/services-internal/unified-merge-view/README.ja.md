# useUnifiedMergeView 実装メモ

## 背景

- 現在のエディターは y-codemirror.next を使用した collaborative editor として実装されている
- Socket.IO を介して同時多人数編集が可能
- CodeMirror 6 の `@codemirror/merge` パッケージの Unified Merge View を用いた差分機能を実現するフックとして `useUnifiedMergeView` を実装する

## 要件

### 前提条件

- Editor 1: Unified Merge View を有効化したエディター（レビューモード）
- Editor 2: 通常のエディター（通常モード）
- original: 編集開始時点のドキュメント
- diff1: Editor 1 でのローカルな変更の差分
- diff2: Editor 2 でのローカルな変更の差分

### 期待される動作

1. Editor 1（レビューモード）では:
   - diff2 が発生した場合、yjs を通じて受け取る
   - original + diff2 を基準として diff1 との差分を表示
   - diff1 に対して Accept/Reject が可能
   - Accept された時のみ diff1 が他のエディターに反映(送信)される

2. Editor 2（通常モード）では:
   - original + diff2 を表示
   - Editor 1 で Accept された時のみ original + diff1 + diff2 となる

3. collaborative editing 関連:
   - y-codemirror.next による collaborative editing 機能は維持
   - diff2（通常モードでの変更）は即座に他のエディターに反映

## 技術的な制約・検討事項

1. `@codemirror/merge` の実装:
   - `unifiedMergeView` extension を使用
   - `originalDocChangeEffect` で original document の更新が可能
   - Accept/Reject 機能が標準で実装されている

2. y-codemirror.next との統合:
   - 標準では全ての変更が即座に他のエディターに反映される
   - この機能を維持しながら、レビューモードでの変更（diff1）のみを一時的にバッファリングする必要がある

## 実装方針

1. レビューモードでの変更をバッファリング:
   - use-secondary-ydocs.ts により、secondaryDoc に変更を保持、結果的にバッファリングする挙動になる
   - リモートからの変更は通常通り処理

2. Accept 時の処理:
   - secondaryDoc にバッファリングされた変更を primaryDoc に適用することにより、他のエディターに反映される
   - バッファをクリア

3. Unified Merge View の設定:
   - original + diff2 との差分を表示
   - 標準の Accept/Reject 機能を利用

## 実装のポイント

### Accept による変更の二重適用問題

1. 問題の概要
   - Editor1 で Accept を実行すると、変更が二重に適用される症状が発生
   - 原因: Accept による変更が YJS の同期機能を通じて Editor1 に戻ってきた際、再度 originalDoc に適用されてしまう

2. 解決方法
   - YJS の transaction に origin を付与して変更の出所を追跡
   - Accept 時: `primaryDoc.transact(() => {...}, SYNC_BY_ACCEPT_CHUNK)`
   - 同期時: `if (event.transaction.origin === SYNC_BY_ACCEPT_CHUNK) return`

3. 変更の流れ
   1. Editor1 で Accept が実行される
   2. Accept で primaryDoc に同期する際に origin: 'accept' を指定
   3. primaryDoc の変更が Editor1 に戻ってきても origin をチェックしスキップ
   4. 結果として二重適用を防止

### 個別の chunk の Accept 処理

1. `@codemirror/merge` の仕組み:
   - chunk の accept 時に `updateOriginalDoc` effect が発行される
   - effect の value に accept された変更内容が ChangeSet として含まれる
   - ChangeSet には変更範囲（fromA, toA）と新しい内容（inserted）が含まれる

2. YJS への反映:
   - ChangeSet の変更内容を primaryDoc の YText に適用する
   - 処理は transact でラップし、「Accept による変更の二重適用問題」の通り origin を指定して二重適用を防止
   - `iterChanges` で得られた位置情報をそのまま使用（絶対位置）
   - delete と insert を順番に適用して変更を反映

3. 変更の流れ:
   1. Editor1 で chunk の Accept ボタンがクリックされる
   2. `@codemirror/merge` が `updateOriginalDoc` effect を発行
   3. effect から変更内容を取得し、YText の操作に変換
   4. primaryDoc に変更を適用し、他のエディターに伝播

この実装により、個々の chunk の Accept が正しく機能し、他の chunk には影響を与えません。
