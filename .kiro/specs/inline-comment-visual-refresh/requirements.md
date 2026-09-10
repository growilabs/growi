# Requirements Document

## Project Description (Input)

**Who has the problem:** インラインコメント機能（画面最下部の一覧・本文中プレビューポップオーバー）を利用するすべてのページ閲覧者・投稿者。開発側では、実装完了の報告と実際にブラウザで見た結果が食い違うことに繰り返し悩まされている。

**Current situation:** `InlineCommentItem.tsx`／`InlineCommentReplies.tsx`（一覧アイテム）と `InlineCommentPreviewPopover.tsx`（本文中ポップオーバー）は、機能的には `inline-comment-edit-delete` で完成しているが、見た目は素の Bootstrap ボタン・バッジのままで統一感がなく、削除確認も裸のテキスト行にすぎない。この見た目を改善するため、承認済みのデザインモックアップ（Claude Design キャンバス、Artifact として公開: https://claude.ai/code/artifact/d19799da-fedc-4687-ad14-24d134bc7e89 — `Main.dc.html` が一覧アイテムの4状態（通常/未解決・編集モード・削除確認・解決済み）、`Popover.dc.html` がポップオーバーの2状態（通常表示＋返信＋返信フォーム・編集モード）を示す）をすでに作成し、ユーザーの承認を得た。

**What should change:** 上記モックアップに忠実な見た目へ実装を変更する。機能・データフロー・API契約・サーバー側の挙動は一切変更しない。過去に「見た目の修正が完了したと報告されたが、実際に開発環境で確認すると全く違う見た目になっていた（崩れていた）」という失敗が繰り返されているため、本スペックの受け入れ基準・検証方法は、コードのコンパイルや単体テストのクラス名アサーションだけでなく、実際にレンダリングされた見た目を実ブラウザ（Playwright）でモックアップと突き合わせて確認することを必須とする。

## Amend Target

このスペックは、既に実装完了（`phase: implementation-complete`）している `.kiro/specs/inline-comment` の契約を変更する **amend spec** である。

- **対象スペック**: `.kiro/specs/inline-comment`
- **変更される契約**: `design.md` における `InlineCommentItem`／`InlineCommentReplies`／`InlineCommentPreviewPopover` の見た目・マークアップ・CSS構成の記述（Requirement 18・15 の受け入れ基準そのものは変更しない — 「何ができるか」は変わらず「どう見えるか」だけが変わる）
- 実装完了後、変更点を `.kiro/specs/inline-comment` の design.md／research.md へ port back し、このスペック自身を削除する（`.claude/rules/spec-lifecycle.md` 準拠）

## Boundary Context

- **In scope**:
  - `InlineCommentItem.tsx`／`InlineCommentReplies.tsx`（画面最下部の一覧アイテム）の見た目変更（通常表示・編集モード・削除確認・解決済みの4状態）
  - `InlineCommentPreviewPopover.tsx`（本文中プレビューポップオーバー）の見た目変更（通常表示＋返信＋返信フォーム・編集モードの2状態）
  - 一覧アイテムにおける編集・削除操作の呼び出し位置の変更（下記参照）
  - 対応する `.module.scss` の新規追加・変更
- **Out of scope**:
  - 通常コメント（`Comment.tsx`／`CommentControl.tsx`／`DeleteCommentModal`）の変更 — 参照・パターン踏襲のためだけに読む。`.kiro/specs/inline-comment` の既存の Out of Boundary 方針を継承する
  - API・サービス・データモデルの変更（`InlineCommentService`、apiv3ルート、DTO はすべて変更しない）
  - 新しい機能・受け入れ基準の追加（「何ができるか」は変えない）
  - 解決トグルの仕組み自体の変更（モックアップの2案のうち、現行実装と同じ「バッジ＋別ボタン」案をそのまま踏襲する。「ピル自体をクリックしてトグルする」案は不採用）
- **Adjacent expectations**:
  - 一覧アイテムの編集・削除ボタンは、現在の「常時表示のフッターテキストリンク」から、通常コメント（`CommentControl.tsx`）と同じ「ホバーで現れるアイコンのみ」の操作感に変える。ただし配置場所は通常コメントの右上絶対配置そのままではなく、既存のヘッダー行（未解決／解決済みバッジ＋解決トグルボタンの隣）に収める——通常コメントには無い要素がヘッダー行にすでに存在するため
  - ダークモードでもモックアップの意図（配色の役割・階層）が破綻しないこと（GROWIのBootstrapテーマは意味付きクラスでライト/ダーク双方に自動追従する。ハードコードされた16進色はモックアップ自身の仮の配色であり、実装に持ち込まない）
  - **モックアップ忠実度の適用範囲**: この機能が新しく持ち込む・作り直す要素（状態バッジ、引用ブロック、編集・削除アイコンボタン、削除確認帯、編集モードの入力欄、返信フォーム）は、モックアップに忠実にする。一方、`CommentCard`・共有スタイル（`_comment-inheritance.scss` の `%user-picture`／`%comment-section`／`%bg-comment`、およびBootstrap既定のカード角丸）がすでに決めている見た目（投稿者アイコンの大きさ、カード左側の吹き出し風の飾り、カードの角の丸みの度合いなど）は、モックアップの値と異なっていても、既存の値をそのまま採用する。これらの要素についてモックアップとの一致を求めない（Out of Boundaryの`CommentCard`／共有スタイルを変更しないという方針の直接の帰結）

## Requirements

### Requirement 1: 一覧アイテムの見た目をモックアップに合わせる

**Objective:** As a インラインコメントを一覧で見る利用者, I want 洗練された見た目で一覧アイテムを見たい, so that 情報の階層（投稿者・引用・本文・状態・操作）が把握しやすくなる

#### Acceptance Criteria
1. The インラインコメント機能 shall 一覧アイテムの通常表示（未解決状態）を、Artifact `Main.dc.html` の「通常表示」アートボードに忠実な見た目で描画する
2. The インラインコメント機能 shall 一覧アイテムの編集モードを、Artifact `Main.dc.html` の「編集モード」アートボードに忠実な見た目で描画する
3. The インラインコメント機能 shall 一覧アイテムの削除確認状態を、Artifact `Main.dc.html` の「削除確認」アートボードに忠実な見た目で描画する（インラインの警告帯として表示し、モーダルは使わない——既存の `.kiro/specs/inline-comment` の設計判断を維持する）
4. The インラインコメント機能 shall 一覧アイテムの解決済み状態を、Artifact `Main.dc.html` の「解決済み」アートボードに忠実な見た目で描画する
5. When 投稿者本人が一覧アイテムにマウスカーソルを重ねた, the インラインコメント機能 shall 編集・削除操作をアイコンのみのボタンとして、既存のヘッダー行（状態バッジ・解決トグルボタンの隣）に表示する
6. When マウスカーソルが一覧アイテムから離れた, the インラインコメント機能 shall 編集・削除アイコンボタンを非表示に戻す（投稿者本人以外・リードオンリー制限下では、ホバーしても表示しない——既存の権限判定はそのまま維持する）
7. The インラインコメント機能 shall 引用ブロックの見た目を一覧アイテムとポップオーバーの間で統一する（アクセントカラーの左罫＋淡色背景）

### Requirement 2: ポップオーバーの見た目をモックアップに合わせる

**Objective:** As a 本文中でインラインコメントを確認する利用者, I want 洗練された見た目でポップオーバーを見たい, so that 一覧アイテムと一貫した体験になる

#### Acceptance Criteria
1. The インラインコメント機能 shall ポップオーバーの通常表示（起点コメント・返信一覧・返信フォームを含む）を、Artifact `Popover.dc.html` の「通常表示」アートボードに忠実な見た目で描画する
2. The インラインコメント機能 shall ポップオーバーの編集モードを、Artifact `Popover.dc.html` の「編集モード」アートボードに忠実な見た目で描画する
3. The インラインコメント機能 shall 解決トグルを、現行実装と同じ「状態バッジ＋別ボタン」の形のまま維持する（モックアップが示すもう一方の案「ピル自体をクリックしてトグルする」は採用しない）
4. The インラインコメント機能 shall ポップオーバーに削除操作を追加しない（既存の境界方針どおり、削除は一覧アイテムのみから提供する）

### Requirement 3: 実装がBootstrapテーマとGROWIの既存規約に従う

**Objective:** As a このコードベースを保守する開発者, I want 新しい見た目がGROWIの既存のスタイリング規約に従っていてほしい, so that ライト/ダーク双方のテーマで壊れず、保守しやすい

#### Acceptance Criteria
1. The インラインコメント機能 shall 色の指定に、GROWIのBootstrapテーマが提供する意味付きユーティリティクラス（`text-danger`／`btn-outline-secondary`／`bg-warning-subtle` 等、実際に存在するクラスに限る）を用いる。ハードコードされた16進数カラーコードを新規のtsx/scssに追加しない
2. The インラインコメント機能 shall フォントファミリーを指定しない（アプリのデフォルトフォントスタックをそのまま使う）。モックアップが使用した IBM Plex Sans/Mono は実装に持ち込まない
3. The インラインコメント機能 shall tsx内のインラインstyle属性の使用を、既存のBootstrapユーティリティクラスやCSS Modulesで表現できない場合に限定する
4. The インラインコメント機能 shall レイアウト・余白の指定に、可能な限りBootstrapのユーティリティクラス（`gap-*`／`mb-*`／`p-*`／flexユーティリティ等）を用いる。CSS Modulesは、ユーティリティクラスで表現できない規則（ホバー時の表示切り替え、引用ブロックの左罫アクセント色等）に限定して追加する
5. The インラインコメント機能 shall 一覧アイテムの編集・削除アイコンボタンに、通常コメント（`CommentControl.tsx`）と同じアイコン・視覚的パターンを踏襲する（参照のみで、`CommentControl.tsx` 自体は変更しない）

### Requirement 4: 実装が実ブラウザでモックアップと一致することを検証する

**Objective:** As a プロダクトオーナー, I want 「実装完了」の報告が実際の見た目と食い違わないことを保証したい, so that 過去に繰り返された「完了したが実際は崩れていた」という失敗を避けられる

#### Acceptance Criteria
1. The インラインコメント機能 shall 実装完了の判定に、実際に起動した開発サーバー上でPlaywrightにより各状態（一覧アイテム4状態、ポップオーバー2状態）をスクリーンショット撮影し、モックアップの対応するアートボードと突き合わせる手順を含める
2. The インラインコメント機能 shall この突き合わせを、`.kiro/specs/inline-comment-visual-refresh/visual-acceptance-checklist.md` に列挙された33項目（各項目は「特定の要素について、位置・大きさ・余白がモックアップ通りか」という単位でまとめられている）を1つずつ判定する形で行う。「大きく崩れていないか」という粗い確認では代替しない
3. If チェックリストのいずれかの項目が⚠️（近いが要確認）または❌（明らかに異なる）と判定された, then インラインコメント機能 shall 「完了」を報告する前に修正し、再度その項目を確認する
4. The インラインコメント機能 shall ライトモード・ダークモードの両方で、意味付きカラークラスが意図した役割（警告・危険・成功等）を保ったまま表示されることを確認する
5. The インラインコメント機能 shall 既存の単体・結合テスト（`InlineCommentItem.spec.tsx`／`InlineCommentReplies.spec.tsx`／`InlineCommentPreviewPopover.spec.tsx` 等）が、新しいマークアップ・クラス名に合わせて更新された上で、引き続きすべてgreenであることを確認する（テストが検証するのは操作の呼び出し・権限判定などの機能面であり、見た目の忠実性そのものは本要件のチェックリスト照合が担う）
6. The インラインコメント機能 shall この33項目すべての最終確認を、実装したエージェント自身ではなく、独立した別のレビュー（Opusクラスの強いモデルによる `/kiro-validate-impl` 相当のゲート）で行う
