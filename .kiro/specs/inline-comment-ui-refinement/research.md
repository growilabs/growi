# 調査と設計判断の記録: inline-comment-ui-refinement

この記録は、書き戻し時に inline-comment の `research.md` へ移す（[spec-lifecycle](../../../.claude/rules/spec-lifecycle.md)）。この spec のディレクトリは削除されるため、移す前に消してはならない。

## Summary

- **Feature**: `inline-comment-ui-refinement`
- **Discovery Scope**: Extension（既存の画面への追加）。既存コードの確認だけで足り、外部調査は行っていない
- **Key Findings**:
  - `InlineCommentItem` は `CommentCard` のスロット（見出し右・本文前・本文後）で組み立てられており、折りたたみ表示は同じスロットの中身を切り替えるだけで実現できる
  - 一括展開は全件に同時に効くため、折りたたみ状態は各行ではなく `PageComment`（一覧）が持つ必要がある
  - 三点メニューは、すでにある `MentionPickerButton` の reactstrap `Dropdown` の使い方をそのまま使える

## Research Log

### 折りたたみ状態の置き場所

- **Context**: 一括展開（Requirement 22.4）が、各行の状態を外から操作できることを要求する
- **Findings**: 各行が自分の `useState` を持つと、親からの一括展開が届かない。親が状態を持ち、各行へ props で渡す（制御された部品にする）のが最も単純
- **Implications**: `InlineCommentItem` は `collapsed` / `onExpand` / `onCollapse` を props で受け取る

### 一覧メニューの置き場所と権限

- **Context**: Requirement 22.7 は、リードオンリー利用者にもメニューを出すことを求める
- **Findings**: 一覧の他の操作（返信・編集・解決）は `NotAvailableIfReadOnlyUserNotAllowedToComment` などで包まれているが、このメニューは表示状態を変えるだけでデータに触れない
- **Implications**: メニューはこれらの権限判定で包まない

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| A. 各行が折りたたみ状態を持つ | `InlineCommentItem` 内の `useState` | 変更が1ファイルで済む | 一括展開を親から操作できない | 不採用 |
| B. 親が「展開済み id の集合」を持つ | `PageComment` が集合を持ち、行は props で受け取る | 一括展開が単純。未解決に戻したときの展開も導出で済む | `PageComment` に hook を1つ足す | **採用** |
| C. 「折りたたみ済み id の集合」を持つ | 逆向きの集合 | 見た目は対称 | 既定が「全部折りたたみ」なので、初期値に全件の id が要り、コメントが増えるたびに更新が要る | 不採用 |

## Design Decisions

### Decision: 状態を「展開済み id の集合」にし、折りたたみ中かは導いて求める

- **Context**: 既定は「解決済みは全部折りたたみ」。後から増えるコメントや、他の利用者による解決・未解決の切り替えにも追従したい
- **Alternatives Considered**:
  1. 折りたたみ済み id の集合を持つ（初期値に解決済みの全 id が必要）
  2. 展開済み id の集合を持ち、`解決済み かつ 集合にない` を折りたたみ中とする
- **Selected Approach**: 2。集合の初期値は空で、コメントが増えても更新は要らない
- **Rationale**: 未解決に戻ったコメントは「解決済みでない」ので自動的に展開して見える（Requirement 20.4 のための処理が不要）。既定の状態を集合に書き込まなくてよい
- **Trade-offs**: 展開済みの記録が古い id で残ることがあるが、集合は画面を開いている間だけの小さなもので実害がない
- **Follow-up**: なし

### Decision: 自分で未解決に戻したとき、展開済みの記録を消す

- **Context**: 展開したコメントを未解決に戻し、あとで再び解決済みにすると、記録が残っていればすぐ展開されたままになる
- **Alternatives Considered**:
  1. 記録を残す（展開したまま）
  2. 未解決に戻したときに記録を消す（再び解決済みにしたら折りたたむ）
- **Selected Approach**: 2。`PageComment` が `resolve` を包み、成功したら `forget(id)` を呼ぶ
- **Rationale**: 「解決済みにしたら片付いて見える」という既定の挙動と揃う。記録が残ると「さっき解決したのに開いたまま」という戸惑いになる
- **Trade-offs**: 他の利用者による切り替えは、自分の操作を経由しないので記録は消えない（既知の制約に記載）
- **Follow-up**: なし

### Decision: 折りたたみ中も見出しの操作は最小にし、引用文は残す

- **Context**: ユーザーの指摘「折りたたんだ状態でも引用文は見えたほうがよい。じゃないとなんの箱かわかりにくい」
- **Selected Approach**: 折りたたみ中は 投稿者・日時・札・引用文（行数を絞って省略）・展開ボタンだけを出す。履歴リンク・編集/削除・解決の切り替えは出さない
- **Rationale**: 折りたたみの目的は一覧を短くすること。操作を並べると高さも情報量も減らない。展開すれば従来どおり全部使える
- **Trade-offs**: 折りたたみ中は編集・削除・解決の切り替えができず、一度展開する必要がある

### Decision: メニュー項目は宣言（データ）で渡す

- **Context**: メニューには今後項目が増える（Requirement 22.6）
- **Selected Approach**: `InlineCommentListMenu` は項目の配列を受け取って描くだけにし、項目は別ファイルの関数で作る
- **Rationale**: 「実行部品は自分の扱う集合を持たず、外から受け取る」（`coding-style.md`）。項目を足すときに表示部品を触らなくてよい
- **Trade-offs**: 項目1つの現状ではやや過剰に見えるが、増える前提が要件にある

### Decision: 入力フォームと作成ボタンの配置（Requirement 19・23、実装済み）

- **Context**: 選択範囲の上側・カーソル側の端に出し、フォームは上方向に伸ばし、幅は内容と画面幅に合わせる
- **Selected Approach**:
  - 配置は Popper の `top` に統一し、左右の位置は「カーソル側の端の x 座標で幅0の仮想要素」を基準に取る。選択方向は `Selection` の anchor と focus から求める（`Range` は常に start <= end で方向を持たない）
  - フォームの高さが変わっても下端が動かないよう、`ResizeObserver` でサイズ変化を検知して位置を再計算する
  - 幅は `max-content`（内容に合わせる）を、最小 24rem・最大 40rem（どちらも画面幅から左右の余白を引いた値で頭打ち）で挟む
- **Rationale**: 下端の位置を Popper に任せれば、上に余白がないときの下側への切り替え（Requirement 19.4・19.7）も追加の処理なしで得られる
- **Trade-offs**: カーソル側の端の x 座標は、折り返しや複数行の選択でやや複雑（端のキャレットの矩形が選択範囲の縦幅の外にあるときは、一番外側の行の矩形にフォールバックする）

## Risks & Mitigations

- 折りたたみ中の引用文の省略が、CSS の対応状況で崩れる — 手動確認（Chromium）とテーマ切り替えで確認する
- `InlineCommentItem` の props 追加で既存の呼び出し元が壊れる — 呼び出し元は `PageComment` のみ（確認済み）。型検査で漏れを検出する
- 三点メニューが狭い画面で見切れる — reactstrap `DropdownMenu` に `end`（右端合わせ）を指定する。手動確認する

## References

- `.kiro/specs/inline-comment/design.md` — 対象 spec（書き戻し先）
- `apps/app/src/features/inline-comment/client/components/InlineCommentForm/MentionPickerButton.tsx` — `Dropdown` の使い方の手本
