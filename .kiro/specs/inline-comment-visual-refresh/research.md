# Research & Design Decisions

## Summary
- **Feature**: `inline-comment-visual-refresh`
- **Discovery Scope**: Extension（既存コンポーネント3つの見た目のみを変更する Simple Addition に近い Extension）
- **Key Findings**:
  - GROWIのBootstrapテーマ（`packages/core-styles`、Bootstrap 5.3.8）は `-subtle`／`-emphasis` トークン（`bg-warning-subtle`／`text-warning-emphasis` 等）を実際に生成しており、承認済みモックアップの「淡色バッジ」表現はこれらのクラスだけで再現できる（新しいハードコード色は不要）
  - 通常コメントの編集・削除UI（`CommentControl.tsx`）は、`btn btn-link p-2 opacity-50` ＋ `material-symbols-outlined` の `edit`／`close` グリフを、親要素 `:hover` 時に `visibility: hidden → visible` で見せる、CSSのみの実装である。ユーザーが求めた「一覧アイテムをこのパターンに寄せる」は、この既存CSS技法をそのまま流用できる
  - `CommentCard` はスロット構成（`headerEnd`／`beforeBody`／`footer`）のみを提供し、それ自体はCSS Moduleを持たない設計になっている。3コンポーネントいずれも、この設計に変更を加えずスロットの中身だけを変えれば見た目の刷新が完結する

## Research Log

### Bootstrapの `-subtle`/`-emphasis` トークンの実在確認
- **Context**: モックアップの淡色バッジ（`--unresolved-bg: #fff3d6` 等、モックアップ自身の仮の配色）を、GROWIの実テーマでどう表現するか
- **Sources Consulted**: `node_modules/.pnpm/bootstrap@5.3.8.../dist/css/bootstrap.css`（コンパイル済みCSSを直接grep）
- **Findings**: `.bg-warning-subtle`／`.bg-danger-subtle`／`.bg-success-subtle`／`.rounded-pill`／`.text-warning-emphasis`／`.text-danger-emphasis`／`.text-success-emphasis` はいずれも生成済み（Bootstrap 5.3で導入されたトークンで、GROWIのテーマ拡張済みバージョンでも生成されている）
- **Implications**: モックアップの「淡色バッジ＋濃い文字色」という2階調の表現は、ハードコード色を一切使わずBootstrapの意味付きクラスの組み合わせだけで実現できる。design.md の状態バッジのクラス指定はこの調査結果に基づく

### `CommentControl.tsx` の編集・削除UIパターン
- **Context**: 一覧アイテムの編集・削除操作を、通常コメントと同じ視覚パターンに揃える（Requirement 3.5・1.5）にあたり、既存の実装を正確に把握する必要があった
- **Sources Consulted**: `apps/app/src/features/comment/client/components/CommentControl.tsx`、`Comment.module.scss`
- **Findings**: `<div className="page-comment-control"><NotAvailableIfReadOnlyUserNotAllowedToComment><button className="btn btn-link p-2 opacity-50"><span className="material-symbols-outlined">edit</span></button>...</NotAvailableIfReadOnlyUserNotAllowedToComment></div>` という構造。`Comment.module.scss` が `.page-comment-control { position: absolute; top: 0; right: 0; visibility: hidden; } &:hover > .page-comment-control { visibility: visible; }` で表示を切り替える
- **Implications**: 一覧アイテムには通常コメントと違い、ヘッダー行にすでに状態バッジ・解決トグルボタンが存在するため、`position: absolute` の右上コーナー配置は使えない（既存要素と重なる）。「同じ視覚パターン（アイコン・ボタンクラス・ホバーでの visibility 切り替え）」は踏襲しつつ、「同じ絶対配置」は踏襲しない、という判断をした（design.md に明記）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 既存の CommentCard スロット構成を維持（採用） | 3コンポーネントとも `headerEnd`/`beforeBody`/`footer` の中身だけを変える | 新しい抽象を増やさない。既存の権限判定・状態管理に触れないため回帰リスクが低い | なし（見た目の変更のみなので新しいリスクは生まれない） | — |
| ポップオーバー・一覧アイテムの引用ブロックを共有コンポーネント化 | `.inline-comment-quote` 相当の見た目を1つの共有Reactコンポーネントに切り出す | 重複コードの削減 | 新しい抽象を1つ増やすことになり、Non-Goalの「新しいコンポーネントは追加しない」に反する。差分が数行のCSS規則にとどまるため、共有化のコストに見合わない | 不採用。design.mdの「Data Models」節でも明記 |

## Design Decisions

### Decision: 一覧アイテムの編集・削除アイコンは「視覚パターンは踏襲・配置は踏襲しない」

- **Context**: ユーザーから「編集・削除の呼び出し位置を通常コメントに揃えるべき」という指摘を受け、「InlineCommentItemを通常コメントに寄せる」方向で合意した
- **Alternatives Considered**:
  1. `CommentControl.tsx` と完全に同じ絶対配置（カード右上コーナー）にする
  2. 視覚パターン（アイコン・ボタンクラス・ホバー切り替え）だけ踏襲し、配置はヘッダー行内（バッジ・解決ボタンの隣）にする
- **Selected Approach**: (2)
- **Rationale**: 一覧アイテムのヘッダー行にはすでに状態バッジ・解決トグルボタンがあり、これは通常コメントには存在しない要素である。右上コーナーに絶対配置すると、これらの既存要素と重なるか、レイアウトが崩れる。ユーザーへの提案時にこの判断を明示し、承認を得た
- **Trade-offs**: 通常コメントとピクセル単位で同一の配置にはならないが、「操作感（ホバーで現れるアイコンのみ）」という体験の一貫性は保たれる
- **Follow-up**: 実装時、ヘッダー行の要素が多くなりすぎて窮屈にならないか、実ブラウザでの確認（Requirement 4）で確認する

### Decision: ポップオーバーの編集ボタンはホバー表示にしない

- **Context**: 一覧アイテムはホバー表示に変えるが、ポップオーバーの編集ボタンも同様にすべきか
- **Alternatives Considered**:
  1. ポップオーバーの編集ボタンもホバー表示にする（一覧アイテムと完全に統一）
  2. ポップオーバーの編集ボタンは常時表示のアイコンボタンのままにする
- **Selected Approach**: (2)
- **Rationale**: ポップオーバー自体がホバー／クリックで一時的に表示される要素であり、その中でさらにホバー待ちの操作を要求すると発見しづらくなる。承認済みモックアップ（`Popover.dc.html`）自体も編集ボタンを常時表示のアイコンボタンとして描いている
- **Trade-offs**: 一覧アイテムとポップオーバーで「編集ボタンの表示条件」が完全には統一されない（ホバー表示 vs 常時表示）が、アイコン・ボタンクラス自体は統一されている
- **Follow-up**: なし

### Decision: モックアップ忠実度は「この機能が新しく持ち込む要素」にのみ適用する

- **Context**: Critical Issue 2（`CommentCard`／共有スタイルを変更しない境界と、モックアップへの忠実度が衝突しうる問題）への対応。投稿者アイコンの大きさ（`%user-picture`＝約19px、モックアップは30px）、カードの角の丸み（Bootstrap既定6px、モックアップは12〜14px）、カード左側の吹き出し風の飾り（`%comment-section::before`、モックアップには無い）の3点で、実測により実際に差があることを確認した
- **Alternatives Considered**:
  1. `InlineCommentItem.module.scss`・新設の `InlineCommentPreviewPopover.module.scss` の中で、`@extend` の直後にこの機能専用の上書き宣言を加える（共有ファイル自体は変更しないが、この機能の見た目としては共有プレースホルダの値を上書きする）
  2. 共有プレースホルダの値をそのまま受け入れ、一切上書きしない
- **Selected Approach**: (2)。この機能が新しく持ち込む・作り直す要素（状態バッジ、引用ブロック、編集・削除アイコンボタン、削除確認帯、編集モードの入力欄、返信フォーム）はモックアップに忠実にする一方、`CommentCard`・共有スタイルがすでに決めている値（アイコンの大きさ、カードの角丸、吹き出しの飾り）は、モックアップと異なっていても既存のまま採用する
- **Rationale**: (1)は技術的には可能だが、「共有スタイルには一切手を入れない」という境界をコードの上でも判断の上でも単純に保てる(2)の方が、実装のスコープが小さく、共有コードへの影響がゼロであることを誰が見ても分かる。ユーザー自身がこの単純な切り分けを提案し、採用した
- **Trade-offs**: 投稿者アイコンはモックアップより小さく表示され、カードには吹き出しの飾りが残る。これは実装のミスではなく意図した仕様であり、`visual-acceptance-checklist.md` に「適用対象外」として明記した項目（1・24・31・34・35）で、誤って修正されないよう釘を刺している
- **Follow-up**: なし

## Risks & Mitigations
- Risk: ホバー表示への変更で、タッチデバイスでの編集・削除操作の発見しやすさが下がる — Mitigation: これは通常コメント（`CommentControl.tsx`）にすでに存在する制約であり、本スペックが新しく持ち込むものではない。別途改善するなら通常コメント側も含めた横断的な課題として扱う
- Risk: 「完了したと報告されたが実際は見た目が違った」という過去の失敗の再発 — Mitigation: Requirement 4 で実ブラウザでのスクリーンショット照合を必須の完了条件とし、tasks.md の最終検証タスクに明示的なチェック項目として組み込む

## References
- [Inline Comment Redesign (Artifact)](https://claude.ai/code/artifact/d19799da-fedc-4687-ad14-24d134bc7e89) — 承認済みデザインモックアップ
- `.kiro/specs/inline-comment/design.md` / `research.md` — 現行実装の詳細（CommentCard・スロット構成・色トークン）
