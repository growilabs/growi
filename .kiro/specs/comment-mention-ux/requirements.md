# Requirements Document

## Introduction

本機能はGROWIのページコメントにおけるメンションのユーザー体験を改善する。現状、`@username` のビジュアルフィードバックや入力補完がなく、ユーザー体験が不十分な状態にある。本スペックはコメント本文内のメンションの視覚的強調表示と、コメント入力時のオートコンプリート機能を実装する。

## Requirements

### Requirement 2: メンションのビジュアルフィードバック

**Objective:** コメント閲覧者として、コメント本文内のメンション（`@username`）が視覚的に区別できるようにしてほしい。そうすることで、メンションが正しく機能しているかどうかをすぐに確認できる。

#### Acceptance Criteria

1. When コメントが表示される, the GROWI shall コメント本文内の `@username` パターンを通常テキストと異なるスタイル（強調色・ハイライト等）で描画する
2. The GROWI shall すべての `@username` パターンに一致する文字列を同一スタイルで強調表示する
3. The GROWI shall メンション表示スタイルをコメントのプレビューと投稿後の表示の両方に適用する

---

### Requirement 3: メンション入力補完

**Objective:** コメント入力者として、`@` を入力したときにユーザー候補がサジェストされてほしい。そうすることで、正確なユーザー名を入力しやすくなる。

#### Acceptance Criteria

1. When ユーザーがコメントエディタで `@` に続けて1文字以上入力した, the GROWI shall `username` が前方一致するユーザー候補リストを表示する
2. When ユーザーが候補リストからユーザーを選択した, the GROWI shall 入力中の `@文字列` を選択されたユーザーの `@username` に置換する
3. If 候補リストに表示するユーザーが存在しない, the GROWI shall 候補リストを表示しない
4. When ユーザーが `Escape` キーを押した, the GROWI shall 候補リストを閉じる
5. The GROWI shall 候補リストに表示するユーザー数の上限を10件とする
