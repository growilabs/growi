# Brief: inline-comment-ui-refinement

## Amend target

この spec は、完了済みの [inline-comment](../inline-comment/) の契約を変更する **amend spec（一時的な作業場所）** である。実装が終わったら変更内容を `inline-comment` へ書き戻し、この spec は最終タスクで自分自身を削除する（[spec-lifecycle](../../../.claude/rules/spec-lifecycle.md)）。

| 対象 spec | 変わる契約 | 種別 |
|---|---|---|
| inline-comment | Requirement 7 / 10（作成の起点の表示位置）に、上側・カーソル側の端という具体的な位置を追加する（Requirement 19 として追記） | 追記 |
| inline-comment | Requirement 2.5-2.6 / 4.4（一覧での解決済みコメントの見せ方）に、既定で折りたたむ挙動を追加する（Requirement 20-22 として追記） | 追記 |
| inline-comment | design.md の `SelectionPopover` / `InlineCommentItem` / 一覧まわりの記述、`Revalidation Triggers` の確認 | 書き戻し時に更新 |

既存の Requirement 1〜18 の番号は変えない。この spec の要件は 19 から続けて振る。

## Problem

インラインコメントを日常的に使うと、次の2点が使いにくい。

1. テキストを選択したときに出る「コメント」ボタンが選択範囲の**下側・範囲の中央**に出る。ドラッグを終えたカーソルの位置から離れているので、ボタンまでマウスを動かす距離が長く、下側にあるため後続の本文に重なる。
2. 一覧に解決済みのコメントが積み上がると、対応が必要な未解決のコメントが埋もれる。解決済みも常に全文が開いているため、一覧が長くなる。

## Current State

- 作成の起点（`SelectionActionButton`）は `SelectionPopover` が `bottom` の配置で、`Range` 全体の矩形の中央に置いている。
- 一覧（`PageComment.tsx` → `InlineCommentItem`）は、解決済みでも未解決と同じ大きさで全文を表示する。違いは札の色と、`opacity-75` による薄い表示だけ。

## Desired Outcome

1. 作成の起点が選択範囲の**上側**に出る。左右の位置は、ユーザーのカーソルがある側の端（左から右へ選択したら右端、右から左へ選択したら左端）。
2. 一覧では、解決済みのコメントが既定で折りたたまれている。各コメントごとに展開できる。一覧エリア右端の三点メニューから「全ての解決済みのコメントを展開する」を選ぶと、全部が展開される。このメニューは今後項目が増えることを前提にする。

## Scope

- **In**: 上記1・2。
- **Out**:
  - 入力フォーム（`InlineCommentForm`）の表示位置は変えない。
  - 本文中のハイライト・その場での内容確認（Requirement 15）は変えない。解決済みは元から本文には出ない（Requirement 2.7）。
  - 折りたたみ状態をサーバーやブラウザに保存することはしない（ページを開き直したら既定に戻る）。
  - 通常コメントの表示は変えない。

## Constraints

- 実装は TDD で進める。
- 翻訳キーは英語を先に追加し、他言語の翻訳は後続タスクにする（[i18n を完成のゲートにしない方針](../i18n/) に従う）。
- 文書は `spec.json.language: ja` で書く。
