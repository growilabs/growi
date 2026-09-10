# Implementation Plan

- [ ] 1. 一覧アイテム（起点コメント）のヘッダー行の見た目を刷新する
- [ ] 1.1 状態バッジ・解決トグルボタンをモックアップに合わせる
  - 状態バッジを角丸ピル形にし、未解決は警告系の淡色背景＋濃い文字色、解決済みは成功系の淡色背景＋濃い文字色にする（Bootstrapの意味付きユーティリティクラスのみを使い、ハードコードされた16進色は使わない）
  - バッジ内の状態ドット（小さな円形の装飾）をCSS Modulesで実装し、tsx側にインラインstyleを書かない
  - 解決トグルボタンを角丸ピル形にする（文言は変更しない）
  - 完了したことが分かる状態: `InlineCommentItem.spec.tsx` で、未解決・解決済みそれぞれの状態バッジのクラス名が新しいトークン（`bg-warning-subtle`/`bg-success-subtle`等）に切り替わっていることを検証するテストがgreenになる
  - _Requirements: 1.1, 1.4, 3.1, 3.2, 3.4_
  - _Boundary: InlineCommentItem, InlineCommentItem.module.scss_

- [ ] 1.2 編集・削除操作を、通常コメントと同じホバー表示アイコンボタンに変更する
  - 現在の常時表示フッターテキストリンク（編集・削除）を撤去し、`CommentControl.tsx`と同じ`material-symbols-outlined`のアイコン・ボタンクラスパターンを使ったアイコンボタンに置き換える
  - アイコンボタンをヘッダー行の状態バッジ・解決トグルボタンの隣（左側）に配置し、カード全体へのホバー時のみ表示されるようにする（`visibility`切り替え、`display`は使わない——非表示時のレイアウトシフトを避けるため）
  - `NotAvailableIfReadOnlyUserNotAllowedToComment`によるガード判定は変更しない
  - 完了したことが分かる状態: `InlineCommentItem.spec.tsx`で、投稿者本人にのみ編集・削除アイコンボタンが存在すること、リードオンリー制限下では無効化されること、ボタンがヘッダー行のバッジ・解決トグルボタンと同じコンテナ内に存在すること（DOM構造）を検証するテストがgreenになる
  - _Requirements: 1.5, 1.6, 3.3, 3.5_
  - _Boundary: InlineCommentItem, InlineCommentItem.module.scss_
  - _Depends: 1.1_

- [ ] 1.3 引用ブロックをモックアップに合わせ、削除確認をアラート形式に変更する
  - 引用ブロックに淡色背景を追加する（左罫は既存の`--grw-inline-comment-marker-bg`をそのまま使う——一覧側の既存の色付けとの統一を保つ）
  - 現在の裸のテキスト行による削除確認を、アイコン＋メッセージ＋ボタン群を横一列に並べたBootstrapの`alert`コンポーネントベースの表示に変更する（モーダルは使わない）
  - 完了したことが分かる状態: `InlineCommentItem.spec.tsx`で、削除確認が新しいマークアップ（`alert`ベースのコンテナ、アイコン・メッセージ・ボタンの存在）で表示され、確認前に`remove`が呼ばれないことを検証するテストがgreenになる
  - _Requirements: 1.3, 1.7, 3.1, 3.4_
  - _Boundary: InlineCommentItem, InlineCommentItem.module.scss_
  - _Depends: 1.1_

- [ ] 2. 返信アイテムの編集・削除操作を一覧アイテムと同じ見た目に揃える
- [ ] 2.1 返信の編集・削除アイコンボタンをヘッダー行内ホバー表示に変更する
  - `InlineCommentReplies.tsx`の返信アイテム（`InlineCommentReplyItem`）で、現在の常時表示フッターテキストリンクを撤去し、タスク1.2で`InlineCommentItem.module.scss`に定義したホバー表示アイコンボタンの規則をそのまま再利用する（返信独自の新しいSCSS規則は追加しない。`InlineCommentReplies.tsx`は`InlineCommentItem.module.scss`を新たにimportする必要はない——`InlineCommentReplyItem`は既存の構造上、常に`InlineCommentItem.tsx`の`.inline-comment-item-styles`クラスが付いたルートdivの子要素としてレンダリングされるため、CSS Modulesの`:global()`セレクタが祖先のクラスを介してそのまま効く。この祖先子関係が崩れていないことをタスク実行前に確認する）
  - 返信には状態バッジ・解決トグルボタンが無いため、アイコンボタンは`CommentCard`の`headerEnd`スロット内に新規に配置する
  - 完了したことが分かる状態: `InlineCommentReplies.spec.tsx`で、投稿者本人にのみ編集・削除アイコンボタンが存在すること、リードオンリー制限下では無効化されること、削除確認前に`removeReply`が呼ばれないことを検証するテストがgreenになる
  - _Requirements: 1.5, 1.6, 3.3, 3.5_
  - _Boundary: InlineCommentReplies_
  - _Depends: 1.2_

- [ ] 3. (P) ポップオーバーの見た目を刷新する
- [ ] 3.1 (P) ポップオーバー専用のSCSS Moduleを新設し、ヘッダー行・引用ブロックの見た目を刷新する
  - `InlineCommentPreviewPopover.module.scss`を新規作成し、`_comment-inheritance.scss`の共有プレースホルダ（`%bg-comment`／`%user-picture`／`%comment-section`）を、一覧アイテムの`InlineCommentItem.module.scss`と同じ形で`@extend`する（既存の共有ファイル自体は変更しない）
  - 状態バッジ・解決トグルボタンを一覧アイテムと同じクラス構成に変更する
  - 引用ブロックを、一覧アイテムと同じ左罫の色・背景色になるよう統一する（2行クランプの挙動は維持する）
  - 完了したことが分かる状態: `InlineCommentPreviewPopover.spec.tsx`で、状態バッジ・引用ブロックが新しいクラス構成になっていることを検証するテストがgreenになる
  - _Requirements: 1.7, 2.1, 2.3, 3.1, 3.2, 3.4_
  - _Boundary: InlineCommentPreviewPopover, InlineCommentPreviewPopover.module.scss_

- [ ] 3.2 返信スレッドと返信フォームの見た目を刷新する
  - 返信一覧に、返信同士をまとめる左側の縦線（Bootstrapのボーダーユーティリティ）を追加する
  - 返信フォームの入力欄を角丸（一行入力を想定した丸み）にする
  - 完了したことが分かる状態: `InlineCommentPreviewPopover.spec.tsx`で、返信一覧・返信フォームの新しいクラス構成を検証する既存テストが（クラス名の更新を経て）green のままであることを確認する
  - _Requirements: 2.1, 3.1, 3.4_
  - _Boundary: InlineCommentPreviewPopover, InlineCommentPreviewPopover.module.scss_
  - _Depends: 3.1_

- [ ] 3.3 編集モードの見た目を刷新する
  - 編集モードの入力欄（`MentionAwareCommentInput`）まわりの枠線・強調表示を、一覧アイテムの編集モード（タスク1.3の削除確認とは別に、編集モードは引き続き既存のまま維持されている入力欄）と揃ったアクセントカラーの縁取りにする
  - キャンセル・保存ボタンの配置（入力欄の下、右揃え）を整える
  - 削除操作は追加しない（ポップオーバーは編集のみ、削除は一覧のみという既存の境界を維持する）
  - 完了したことが分かる状態: `InlineCommentPreviewPopover.spec.tsx`で、編集モードの新しいクラス構成が検証され、削除操作が存在しないことを確認する既存テストがgreenのままである
  - _Requirements: 2.2, 2.4, 3.1, 3.4_
  - _Boundary: InlineCommentPreviewPopover, InlineCommentPreviewPopover.module.scss_
  - _Depends: 3.1_

- [ ] 4. Validation: 実ブラウザでのモックアップ照合
- [ ] 4.1 6状態のスクリーンショットを撮影し、チェックリストと突き合わせる
  - `apps/app/playwright/20-basic-features/inline-comment.spec.ts`に、一覧アイテムの4状態（通常・編集・削除確認・解決済み）とポップオーバーの2状態（通常・編集）それぞれについて、実際に起動した開発サーバー上でスクリーンショットを撮影する手順を追加する
  - `.kiro/specs/inline-comment-visual-refresh/visual-acceptance-checklist.md`の33項目（適用対象外の項目を除く）を1つずつ、撮影したスクリーンショットと対応するアートボードで突き合わせて判定する
  - 完了したことが分かる状態: 6状態すべてのスクリーンショットが存在し、チェックリストの各項目に✅／⚠️／❌のいずれかの判定が記録されている
  - _Requirements: 4.1, 4.2_
  - _Depends: 1, 2, 3_

- [ ] 4.2 ライトモード・ダークモードの両方で意味付きカラークラスの役割を確認する
  - タスク4.1の6状態を、ライトモード・ダークモードそれぞれで確認する
  - 状態バッジ（警告・成功）・削除確認のアラート（危険）が、両モードで意図した役割を保ったまま表示されていることを確認する
  - 完了したことが分かる状態: ライト・ダーク双方のスクリーンショットが存在し、色の役割が両モードで破綻していないことが確認されている
  - _Requirements: 4.4_
  - _Depends: 4.1_

- [ ]* 4.3 既存の単体・結合テストがすべてgreenであることを確認する
  - `InlineCommentItem.spec.tsx`／`InlineCommentReplies.spec.tsx`／`InlineCommentPreviewPopover.spec.tsx`を実行し、新しいマークアップ・クラス名に合わせた更新後もすべてgreenであることを確認する（各テストの更新自体はタスク1〜3で既に完了している。ここでは横断的な最終確認のみを行う）
  - 完了したことが分かる状態: 3つの`.spec.tsx`ファイルすべてが green で終了する
  - _Requirements: 4.5_
  - _Depends: 1, 2, 3_

- [ ] 4.4 独立レビューによるチェックリスト最終確認
  - タスク4.1・4.2の結果を、実装を行った本人ではない独立したレビュー（`/kiro-validate-impl`相当のゲート、Opusクラスのモデルによる実行）で再確認する
  - チェックリストの33項目のうち、⚠️・❌の判定が残っている項目がないことを確認する。残っていれば、該当するタスク（1〜3のいずれか）に差し戻して修正する
  - 完了したことが分かる状態: 独立レビューにより、チェックリストの適用対象項目すべてに✅の判定が記録され、GO判定が下されている
  - _Requirements: 4.3, 4.6_
  - _Depends: 4.1, 4.2, 4.3_
