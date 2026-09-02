# Research & Design Decisions

## Summary
- **Feature**: `inline-comment-selection-ux`
- **Discovery Scope**: Extension（既存 `inline-comment` feature の UI 層のみを差し替える）
- **Key Findings**:
  - `SelectionCapture.tsx`/`InlineCommentForm.tsx`には位置決めロジックが一切なく、`PageView.tsx`内で本文コンテナの兄弟要素として通常のドキュメントフローに配置されている。選択範囲近傍への浮動配置は今回新規に作る必要がある。
  - 「選択範囲近傍に浮動表示するUI」「メンション相手を選ぶボタン」は、GROWIのコードベース内に既存の再利用可能な部品が存在しない（調査済み・0件）。
  - `@growi/editor`の`useCodeMirrorEditorIsolated`が返す`codeMirrorEditor`オブジェクトは既に`insertText(text: string): void`を公開しており、`EmojiButton.tsx`が同じAPIでカーソル位置へ絵文字ショートコードを挿入している。メンションボタンはこの既存APIをそのまま使える。
  - `@popperjs/core`はモノレポ内に既に存在する（`apps/app/package.json`では`devDependencies`、`packages/editor`等では`dependencies`）。「仮想要素（virtual element）」を`getBoundingClientRect()`だけ実装したプレーンオブジェクトとして渡せる公式パターンがあり、DOM `Selection`/`Range`のような「実体を持たない対象」へのポップオーバー配置に使うための標準機能が揃っている。ビューポート端での自動反転（`flip`）・はみ出し防止（`preventOverflow`）もデフォルトで有効なため、自前でクランプ計算を書く必要がない。

## Research Log

### 選択範囲近傍への浮動配置手段
- **Context**: Requirement 4.1（作成の起点・入力フォームを選択範囲の近くに表示する）をどう実現するか。
- **Sources Consulted**: `apps/app/src/features/inline-comment/client/**`、`packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/EmojiButton.tsx`、`apps/app/package.json`
- **Findings**:
  - コードベース内に「テキスト選択のRangeにポップオーバーを追随させる」既存パターンは無い。`EmojiButton.tsx`は同種の問題（カーソル位置にポップアップを出す）を`view.coordsAtPos(...)`で解いているが、これはCodeMirrorのカーソル座標専用でDOM `Selection`には使えない。
  - `@popperjs/core`は既にモノレポの複数パッケージで使われており（`reactstrap`が内部で使う分の再エクスポート版とは別に、GROWI側でも直接依存として持っている箇所がある）、ライセンス・保守状況ともに問題ない。
- **Implications**: 自前でビューポート端のクランプ・スクロール追随を実装するのではなく、`@popperjs/core`の`createPopper`に「`getBoundingClientRect()`だけを実装した仮想要素」を渡すアダプタを1つ書けば済む。DOM `Range`はクローンしても生きたDOMを参照し続けるため（`range.cloneRange()`はデタッチされない限りドキュメント内の位置を追跡し続ける）、フォーム展開後もそのクローンの`getBoundingClientRect()`を呼び続けるだけでスクロール追随が自然に実現できる——スクロールイベントリスナーを自前で書く必要がない。

### メンション挿入の手段
- **Context**: Requirement 3.1〜3.3（明示的なボタンでメンション相手を選び、本文に挿入する）をどう実現するか。
- **Sources Consulted**: `packages/editor/src/client/services/use-codemirror-editor/utils/insert-text.ts`、`packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/EmojiButton.tsx`
- **Findings**: `useCodeMirrorEditorIsolated(editorKey)`が返すオブジェクトは`insertText: (text: string) => void`を既に公開しており、`InlineCommentForm.tsx`は既にこのフックを使っている。`EmojiButton.tsx`が絵文字ショートコードの挿入に使っているのと同じAPIで、選ばれたユーザー名を`@username `の形で挿入できる。
- **Implications**: 新しいテキスト挿入APIを`@growi/editor`側に追加する必要はない。既存の`codeMirrorEditor.insertText`をそのまま呼び出すだけでよい。

### メンション候補取得の重複
- **Context**: `InlineCommentForm.tsx`は既に`fetchUsers`をコンポーネント内ローカル関数として持ち、`createMentionCompletionExtension(fetchUsers)`（`@`タイプ補完）に渡している。新設するメンションボタンの一覧表示にも同じ`/users/`検索が要る。
- **Findings**: `CommentEditor.tsx`側にも同種のローカル`fetchUsers`があるが、既存タスク境界（4.2）の判断により「`CommentEditor.tsx`は変更しない」という制約のもとで意図的に共通化されていない。今回のスコープは`inline-comment`機能内部（`CommentEditor.tsx`は対象外）なので、この制約には抵触しない。
- **Implications**: `inline-comment`機能の中だけで見れば、同じ`/users/`検索ロジックを2箇所（自動補完・メンションボタン一覧）で使うことになるため、`inline-comment`機能内のサービスとして1箇所に切り出す（`CommentEditor.tsx`側とは共通化しない、独立したまま）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 自前でgetBoundingClientRect+固定値計算 | Selectionの矩形を都度計算し、CSSのtop/leftを自前で算出 | 依存追加なし | ビューポート端でのはみ出し防止・反転・スクロール追随をすべて自前実装する必要がある | 採用せず |
| `@popperjs/core`＋仮想要素 | `getBoundingClientRect()`のみ実装したオブジェクトを`createPopper`の参照要素として渡す | はみ出し防止・反転・スクロール追随が標準機能、モノレポに既存 | `apps/app`では現状`devDependencies`のため`dependencies`への格上げが要る（`package-dependencies.md`の分類手順に従う） | **採用** |
| reactstrap `Popover`（`target`にrefを渡す） | 既存UIライブラリのポップオーバーをそのまま使う | 追加依存なし、他画面と見た目が揃う | `target`は永続的なDOM要素/refを要求し、テキスト選択のような「実体を持たない対象」を直接指定できない。ダミー要素を選択位置に都度生成して`target`にする迂回策も検討したが、結局`@popperjs/core`相当の矩形計算を自前で行うことになり複雑化する | 不採用 |

## Design Decisions

### Decision: 選択範囲へのポップオーバー配置に `@popperjs/core` を採用する
- **Context**: 作成の起点ボタン・入力フォームを選択範囲の近くに表示し、ビューポート端でのはみ出しやスクロールにもある程度追随させたい（Requirement 4.1）
- **Alternatives Considered**:
  1. 自前でのビューポート矩形計算・クランプ実装
  2. reactstrap `Popover`をダミーDOM要素経由で流用
  3. `@popperjs/core`に仮想要素を渡す
- **Selected Approach**: `@popperjs/core`の`createPopper(virtualElement, popperDomElement, options)`に、`getBoundingClientRect()`だけを実装したプレーンオブジェクト（DOM `Range`または`Range.cloneRange()`をラップ）を渡す。`flip`・`preventOverflow`・`offset`の標準modifierのみを使い、カスタムmodifierは書かない。
- **Rationale**: モノレポに既存の依存であり、ビューポート境界処理を車輪の再発明せずに済む。DOM `Range`をクローンして保持するだけでスクロール追随が自然に実現できる点も、実装量を大きく減らす。
- **Trade-offs**: `apps/app`の`package.json`で`@popperjs/core`を`devDependencies`から`dependencies`へ移す変更が発生する（`.claude/rules/package-dependencies.md`の分類手順で検証する）。
- **Follow-up**: 実装時に`turbo run build --filter @growi/app`後、`.next/node_modules/`に`@popperjs/core`が現れることを確認し、分類が正しいことを裏付ける。

### Decision: メンション候補取得ロジックを`inline-comment`機能内で1箇所に切り出す
- **Context**: 既存の自動補完（`@`タイプ）と新設のメンションボタン一覧が同じ`/users/`検索を必要とする
- **Selected Approach**: `apps/app/src/features/inline-comment/client/services/fetch-mention-users.ts`に`fetchMentionUsers: FetchUsersFn`を新設し、`InlineCommentForm.tsx`のローカル`fetchUsers`実装をこれに置き換える。新設する`MentionPickerButton.tsx`も同じ関数を使う。
- **Rationale**: `inline-comment`機能の内部だけで重複を避けられる。`CommentEditor.tsx`側の重複は既存タスク境界の判断（4.2 Implementation Notes）で意図的にそのままにされているため、そちらには手を入れない。
- **Trade-offs**: なし（機能内クローズドな整理のため既存境界を侵さない）

## Risks & Mitigations
- DOM `Range`のクローンが指す本文ノードが、ページ内容の更新（別ユーザーの編集反映やタブ非アクティブ復帰時の再取得など）で入れ替わると、`getBoundingClientRect()`がゼロ矩形または不正な位置を返す可能性がある — フォーム展開中は本文が再レンダリングされない前提（既存`inline-comment`設計が`useMemo`化した本文サブツリーを不用意に再マウントしない対策済み）なので実害は限定的だが、`SelectionPopover`側でゼロ矩形を検知した場合は最後に有効だった位置を保持するフォールバックを入れる
- `@popperjs/core`を`dependencies`へ格上げする際、Turbopackの外部化判定が期待通りか未検証 — 実装時に`package-dependencies.md`の手順（ビルド後の`.next/node_modules/`確認）で検証する

## References
- [Popper.js — Virtual Elements](https://popper.js.org/docs/v2/virtual-elements/) — `getBoundingClientRect()`のみを実装したオブジェクトを参照要素として使う公式パターン
