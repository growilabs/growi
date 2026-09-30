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

### Decision: 自分で解決／未解決を切り替えたら、展開済みの記録を消す

- **Context**: 展開したコメントを未解決に戻し、あとで再び解決済みにすると、記録が残っていればすぐ展開されたままになる
- **Alternatives Considered**:
  1. 記録を残す（展開したまま）
  2. 切り替えが成功するたびに記録を消す（再び解決済みにしたら折りたたむ）
- **Selected Approach**: 2。`use-resolved-collapse` hook が `resolve` を包み、成功したら（どちら向きの切り替えでも）`collapse(id)`（展開済み集合から消す）を呼ぶ。ストアの `resolve` はデータの再取得を待ってから返るので、`collapse` が動く時点では新しいデータが届いている
- **Rationale**: 「解決済みにしたら片付いて見える」という既定の挙動と揃う。記録が残ると「さっき解決したのに開いたまま」という戸惑いになる
- **Trade-offs**: 他の利用者による切り替えは、自分の操作を経由しないので記録は消えない（既知の制約に記載）
- **Follow-up**: なし

### Decision: 折りたたみ中も見出しの操作は最小にし、引用文は残す

- **Context**: ユーザーの指摘「折りたたんだ状態でも引用文は見えたほうがよい。じゃないとなんの箱かわかりにくい」
- **Selected Approach**: 折りたたみ中は 投稿者・日時・札・引用文（行数を絞って省略）・展開ボタンだけを出す。履歴リンク・編集/削除・解決の切り替えは出さない
- **Rationale**: 折りたたみの目的は一覧を短くすること。操作を並べると高さも情報量も減らない。展開すれば従来どおり全部使える
- **Trade-offs**: 折りたたみ中は編集・削除・解決の切り替えができず、一度展開する必要がある

### Decision: 翻訳は全言語ぶんをこの spec の範囲で用意する

- **Context**: `lint:i18n` は言語ごとの「翻訳が抜けているキーの数」が `baseline.json` の基準値以下かを確かめる。他の4言語には `inline_comment` のキーがまだないため、英語だけに4キーを足すと各言語の抜けが4件増え、基準値を超えて lint が止まる
- **Alternatives Considered**:
  1. 英語だけ足し、`--update-baseline --allow-regression` で基準値を引き上げる（翻訳は後続タスク）
  2. 5言語すべてに4キーを足す。基準値は変えない
- **Selected Approach**: 2（ユーザーの指示）
- **Rationale**: 基準値は「抜けを増やさない」ための歯止めであり、機能を足すたびに緩めると意味を失う。翻訳はその機能を出す時点で用意するのが、抜けを溜めない唯一の方法
- **Trade-offs**: 翻訳の作成がこの spec の作業に加わる。ただし4キーだけで量は小さい

### Decision: メニュー項目は配列（データ）で渡し、hook の中で組み立てる

- **Context**: メニューには今後項目が増える（Requirement 22.6）
- **Alternatives Considered**:
  1. 項目を別ファイルの関数で作る。ただし関数の引数が「解決済みの有無」「一括展開の処理」など現在の1項目専用になり、項目を足すたびにその関数の引数も増える。「宣言を変えるだけで足せる」という利点が成り立たない
  2. 項目の配列を、処理を持つ hook が組み立てて返す。メニュー部品は配列を受け取って描くだけにする
- **Selected Approach**: 2。項目の型（`InlineCommentListMenuItem`）はメニュー部品のファイルに置く
- **Rationale**: 項目の処理は折りたたみ状態そのものを操作するので、状態を持つ hook が組み立てるのが最も自然。項目を足すときは hook の配列に要素を足すだけで、メニュー部品と一覧は変わらない
- **Trade-offs**: 別ファイルの宣言に切り出さない分、hook が項目の名前と処理を知る。項目が増えて hook が大きくなったら、そのとき切り出す

### Decision: 折りたたみ中の表示は別部品にし、判定の関数は hook と同じファイルに置く

- **Context**: 折りたたみ中の表示を `InlineCommentItem`（約300行）の中で場合分けすると、返信・編集・削除などの状態を持つ部品が、折りたたみ中は使わない状態まで抱える。一方、判定関数・状態・`resolve` の包み・メニュー項目を別ファイルに分けると、どれも同じ集合を触るのにファイルをまたいで追う必要がある
- **Selected Approach**:
  - 折りたたみ中の表示は `CollapsedInlineCommentItem` に切り出す。`InlineCommentItem` は hook を呼んだ後、折りたたみ中ならそれを返す分岐を1回だけ置く。引用文と札は `InlineCommentQuote`・`InlineCommentStatusBadge` として共有し、2つの表示で食い違わないようにする
  - 判定関数 `isCollapsed` は状態を持つ hook と同じ `use-resolved-collapse.ts` に置き、export して単体で試せるようにする
- **Rationale**: 責務は「折りたたみ中の見え方」と「折りたたみの状態」で分かれ、どちらも1つのまとまりとして読める。判定の規則と状態の持ち方は一緒に変わるので同じファイルが凝集度が高い
- **Trade-offs**: 小さな共有部品が2つ増える。ただし引用文・札の見た目を1か所で直せる

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
