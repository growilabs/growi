# Implementation Plan

- [x] 1. 検索結果パスの表示パーツを算出する純粋関数を実装しユニットテストを追加する
  - `DevidedPagePath`（`evalDatePath` 有効）でページ名（末尾日付 `/YYYY[/MM[/DD]]` は 1 単位に束ねる現行規則）を決定し、祖先は `former` を正規化して `/` 分割・空要素除去で得る
  - 表示単位数（祖先数 + 1）で分岐: `<= 3` は全単位表示、`>= 4` は「先頭 + 省略記号 + 親 + ページ名」、ちょうど 4 は中間の祖先 1 個のみ省略、ルートは表示パーツを空にする
  - ツールチップ用の正規化フルパスを併せて返す
  - ユニットテスト: ルート（`/`・空文字）/ 単位 1〜3 / ちょうど 4 / 深い階層 / 日付パス（`/notes/2024/01/01`＝省略なし・ページ名 `2024/01/01`、`/Projects/team/notes/2024/01/01`＝先頭 `Projects` / … / 親 `notes` / ページ名 `2024/01/01`）/ 長い CJK セグメント / 末尾・先頭スラッシュ正規化
  - 完了条件: 上記全ケースで期待する表示パーツ列とフルパスを返すユニットテストが green
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 5.3_
  - _Boundary: formatTruncatedPagePath_

- [x] 2. パス表示コンポーネントと 1 行安全網 CSS を実装しコンポーネントテストを追加する
  - 純粋関数の結果を、先頭 `/` + `/` 区切りのパーツ列として 1 行描画する。ページ名は太字（`strong`）、省略記号 `…` は中間省略と分かる独立の muted 要素、ルートは `/` を表示
  - ルート要素に `title={フルパス}` を常時付与する
  - 同居の CSS module で 1 行固定（`white-space: nowrap; overflow: hidden`）+ 各セグメントの `text-overflow: ellipsis; min-width: 0` を適用。`flex-shrink` の優先度で祖先セグメントを先に縮め、ページ名は最後に縮める。区切り `/` と `…` は縮小・折り返し不可にする
  - コンポーネントは props（`path`）のみで内部状態を持たない。ハイライト HTML は扱わずプレーンテキストで描画する
  - RTL テスト: 4 単位以上でページ名が `strong`・`…` が独立要素として描画される / ルート要素に `title` としてフルパスが付与される / ルートパスで `/` が描画される / 1 行制御のクラス構造が適用されている（essential-test-design に従い実装詳細のスパイではなく可観測構造を検証）
  - 完了条件: 上記描画・`title`・構造を検証するコンポーネントテストが green（実機での「1 行に収まる」目視はタスク 4 で確認）
  - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.2, 3.3, 4.1, 4.2_
  - _Boundary: SearchResultPagePath, SearchResultPagePath.module.scss_
  - _Depends: 1_

- [x] 3. 検索モーダルの結果行に新パス表示を統合する
  - `SearchResultMenuItem` の既存パス表示（`text-break text-wrap` の span + `PagePathLabel`）を新コンポーネントに差し替え、不要になった `PagePathLabel` の import を削除する
  - 行が正しく縮むよう flex を調整する（パス要素に `flex-grow` + `min-width: 0`、footprint〈既読数〉に縮小防止を付与）
  - 統合の非破壊を可観測にする: 結果を描画したとき新パス表示が使われ、footprint（既読数）が現行どおり表示され、行クリックの遷移導線（`getItemProps`）が現行どおり働くことを RTL で確認する
  - 完了条件: 結果行が新パス表示でレンダリングされ、既読数表示とクリック遷移導線が維持されることを検証するテストが green
  - _Requirements: 5.1, 5.2_
  - _Depends: 2_
  - _Boundary: SearchResultMenuItem_

- [ ] 4. 実機でのビジュアル/回帰検証を行う（自動テストで担保できない横幅制御の確認）
  - 検索モーダルで深い階層・長い CJK セグメント・日付パスの結果を表示し、**ライト/ダーク両テーマ**で折り返さず 1 行に収まりモーダルが崩れないことを確認する（`flex-shrink` 優先度でページ名が最後に縮むことを含む）
  - 省略された行のホバーで `title` のフルパスが表示されること、結果クリックで該当ページへ遷移することを確認する
  - 完了条件: 上記を開発サーバの検索モーダルで確認し、両テーマのスクリーンショット等で記録する
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 5.1_
  - _Depends: 3_
  - _Boundary: SearchResultMenuItem, SearchResultPagePath_

## Implementation Notes
- `normalizePath` は `@growi/core/dist/utils` の barrel からは export されていない。`@growi/core/dist/utils/path-utils` から import する（apps/app の既存慣例）。`DevidedPagePath` は `@growi/core/dist/models`。
- `DevidedPagePath` の日付束ね（`evalDatePath`）は「日付より前に祖先 2 セグメント以上」でのみ発動する（正規表現 `(.+\/[^/]+)\/(date)$` の group1 が 2 セグメント以上を要求するため）。`/notes/2024/01/01` は束ねられずページ名 `01`、`/team/notes/2024/01/01` は束ねられページ名 `2024/01/01`。requirements/design の例示をこの実挙動に合わせて修正済み。
- タスク4（実機ビジュアル検証）: runtime smoke boot は PASS（`turbo run dev` でアプリ起動・コンパイル成功、クライアント変更による crash なし）。ただし当 devcontainer は全文検索が無効（ELASTICSEARCH_URI 未設定）・root 302・Playwright ブラウザ未キャッシュのため、実データでの検索モーダル目視（1行表示・ライト/ダーク・ホバー・クリック遷移）はこの環境では実施不可。ES 有効＋深いパスをシードした実インスタンスでユーザーが目視確認する必要がある。→ 目視部分は未完了のためチェックボックスは未チェックのまま。
