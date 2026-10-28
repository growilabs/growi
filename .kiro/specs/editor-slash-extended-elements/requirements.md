# Requirements Document

## Introduction

アンブレラ `editor-commands` の子スペック。基盤 `editor-slash-command` のスラッシュコマンド機構の上に、GROWI 固有の拡張要素、および基盤が意図的に対象外とした要素（リンク・テーブルビルダー）を `/` から挿入・起動できるコマンドを追加する。初期リリースの対象は **drawio（作図モーダル起動）・plantuml（フェンス静的挿入）・lsx（`$lsx()` 静的挿入）・callout（種別選択して静的挿入）・リンク（既存 Edit Link Modal 起動）・テーブルビルダー（既存 Handsontable Modal 起動）** とする。

> リンク・テーブルビルダーは試用フィードバック起点（`editor-slash-command` の完成形との比較で要望された）。基盤の Out of scope「テーブル挿入時の表ビルダー起動（将来拡張）」に対応する実装として、本スペックに位置づける。画像アップロードも同時に要望されたが、既存の添付ボタンが `onUpload`/`acceptedUploadFileType` を React props として apps/app 側から受け取る構成のため、`run(view, from)` だけでは起動を完結できない。設計課題として Out of scope に記録し、実装は対象外とする。

拡張要素には「静的テキストを挿入すれば足りるもの（plantuml / callout / lsx）」と「専用 UI（モーダル）での設定・編集が要るもの（drawio / リンク / テーブルビルダー）」の2系統がある。後者を扱うための、基盤のコマンドアクションの **「静的挿入（insert）」と「副作用起動（run）」の2種**への一般化は、**実装済み基盤が既に提供**している（`SlashRunAction`）。本スペックはその `run` 契約を消費するのみで、基盤の型・`apply` は変更しない。起動・絞り込み・`/query` 置換・i18n 解決・単一トランザクション挿入・コンテキスト除外（`disallowedIn`）は基盤の挙動を踏襲する。

背景・スコープ・依存関係の詳細は [brief.md](./brief.md)、アンブレラ全体は [roadmap.md](../editor-commands/roadmap.md) を参照。

## Boundary Context

- **In scope**:
  - drawio を挿入するスラッシュコマンド → **既存 drawio モーダルを起動**し、作図結果をフェンスとして挿入（モーダル本体は再利用）
  - lsx を挿入するスラッシュコマンド → `$lsx()` を静的挿入し、カーソルをカッコ内に置く（オプションはユーザーが記法で入力する。専用モーダルは設けない）
  - plantuml を挿入するスラッシュコマンド → フェンス雛形を静的挿入
  - callout を挿入するスラッシュコマンド → 7 バリアント（note / tip / important / info / warning / danger / caution）を**種別を選んで**静的挿入
  - リンクを挿入するスラッシュコマンド → **既存 Edit Link Modal（`useLinkEditModalActions`）を起動**し、確定したリンクをカーソル位置に挿入（モーダル本体は再利用）
  - テーブルを構成するスラッシュコマンド → **既存 Handsontable Modal（`useHandsontableModalForEditorActions`）を起動**し、行列を編集してから表を挿入（基盤の `table` コマンドがプレーンな2列テーブルを即挿入するのに対し、本コマンドは行列数を編集できるビルダー）
  - 実装済み基盤のアクションモデル `insert | run` の `run` 契約を用いた、モーダル起動コマンドの追加（基盤の型・`apply` は変更しない。合成点への注入配線のみ）
  - 基盤のスラッシュコマンドメニュー・絞り込みへの統合（drawio/リンク/テーブルビルダーは React 合成点でモーダルオープナーを束縛）
  - コマンドのラベル・説明の多言語表示
- **Out of scope**:
  - 拡張要素の**描画・プレビュー**（既存の描画機構＝remark/rehype プラグインの領域）
  - 既存 drawio モーダル**本体の改修**（起動導線の追加のみ）
  - 既存 Edit Link Modal / Handsontable Modal **本体の改修**（起動導線の追加のみ。モーダル自体の洗練は別構想）
  - lsx の**サーバ側 list-pages ロジック**（既存。本スペックは `$lsx()` 記法の静的挿入のみ）
  - math（KaTeX）・mermaid 等、今回未選択の要素（将来拡張）
  - テンプレート挿入（別構想）
  - **画像アップロード**（設計課題。既存の添付ボタンは `onUpload`/`acceptedUploadFileType` を apps/app 側の React props として受け取る構成で、`run(view, from)` という editor 側 state だけでは起動を完結できない。別途、コンポーネントレイヤでの合成方法を検討してから改めてスコープ化する）
  - 基盤のトリガー検出・補完ソース・アクションモデル（`insert | run`）・レジストリ機構そのもの（基盤 `editor-slash-command` の所有・実装済み。本スペックは合成点への注入配線のみ行う）
- **Adjacent expectations**:
  - 基盤 `editor-slash-command` のスラッシュコマンド機構（起動・絞り込み・`apply`・i18n 解決）に乗る。基盤の起動条件（行頭または空白直後の `/`、単語の途中は除外）に従う。
  - 既存の絵文字オートコンプリート（`:`）および基本スラッシュコマンドと同時に機能し、互いに干渉しない。
  - 挿入された要素の描画は既存の描画機構が担う（本スペックは記法テキストの挿入／モーダル起動のみ）。
  - packages/editor は apps/app に逆依存しない（モーダルは editor 側トリガーフック経由で起動、UI 本体は apps/app）。

## Requirements

### Requirement 1: 拡張要素の挿入・起動コマンド提供

**Objective:** As an エディタで執筆するユーザー, I want GROWI 固有の要素、および基盤が対象外とした要素（リンク・テーブルビルダー）も `/` から挿入・起動したい, so that 記法を手入力せず作図・UML・動的一覧・callout・リンク・表の構成を素早く扱える

#### Acceptance Criteria

1. The 拡張要素コマンド shall 次のコマンドを提供する: drawio、plantuml、lsx、callout（種別別）、リンク、テーブルビルダー
2. When ユーザーが drawio コマンドを選択する, the 拡張要素コマンド shall 既存の drawio 作図モーダルを起動する
3. When ユーザーが plantuml コマンドを選択する, the 拡張要素コマンド shall 内容を記述できる plantuml コードフェンス雛形を挿入する
4. When ユーザーが lsx コマンドを選択する, the 拡張要素コマンド shall `$lsx()` を挿入し、カーソルをカッコ内（`(` の直後）に置く
5. When ユーザーが callout コマンド（いずれかの種別）を選択する, the 拡張要素コマンド shall 対応する種別の callout ディレクティブ（`:::<type>` … `:::`）を挿入する
6. When ユーザーがリンクコマンドを選択する, the 拡張要素コマンド shall 既存の Edit Link Modal を起動する
7. When ユーザーがテーブルビルダーコマンドを選択する, the 拡張要素コマンド shall 既存の Handsontable Modal を起動する
8. Where 今回未選択の拡張要素（math、mermaid 等）、および画像アップロード, the 拡張要素コマンド shall 本リリースではコマンドを提供しない

### Requirement 2: drawio モーダルの起動と書き戻し

**Objective:** As an ユーザー, I want `/drawio` から作図エディタを開いて図を作りたい, so that 記法を意識せず図を挿入・編集できる

#### Acceptance Criteria

1. When ユーザーが drawio コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで、現在の `editorKey` を対象に drawio モーダルを起動する
2. When ユーザーが drawio モーダルで作図を保存する, the drawio モーダル shall 作図結果を ` ```drawio ` フェンスとしてカーソル位置に挿入する（既存の書き戻し機構を利用）
3. When ユーザーが drawio モーダルをキャンセルする, the 拡張要素コマンド shall エディタへ要素を挿入しない（`/query` 削除のみが残る）
4. The 拡張要素コマンド shall drawio モーダルの起動を packages/editor 側のトリガー機構（atom）経由で行い、apps/app への逆依存を持たない

### Requirement 3: lsx の静的挿入

**Objective:** As an ユーザー, I want `/lsx`（または `/ls`）で `$lsx()` を素早く挿入し、カッコ内にオプションを直接書きたい, so that 記法を手入力する手間なく動的一覧の起点を置ける

#### Acceptance Criteria

1. When ユーザーが lsx コマンド（`/lsx` または `/ls`）を選択する, the 拡張要素コマンド shall `$lsx()` を挿入し、カーソルをカッコ内（`(` の直後）に置く
2. When lsx コマンドが適用される, the 拡張要素コマンド shall 挿入を単一トランザクションで行い、undo 1 回で元の状態に戻す
3. The 拡張要素コマンド shall lsx を**インライン挿入**として扱い、行頭正規化・`disallowedIn` を行わず、テーブルセル内・リスト項目内でも挿入できるようにする

### Requirement 4: callout の種別選択挿入

**Objective:** As an ユーザー, I want `/` から callout を種別（note / tip / warning 等）を選んで挿入したい, so that 注意書きや補足を素早く適切な見た目で挿入できる

#### Acceptance Criteria

1. The 拡張要素コマンド shall callout の各種別（note / tip / important / info / warning / danger / caution）をそれぞれ選択可能なコマンドとして提供する
2. When ユーザーがある種別の callout コマンドを選択する, the 拡張要素コマンド shall その種別の callout ディレクティブ（`:::<type>` + 改行 + 本文行 + 改行 + `:::`）を挿入し、本文入力位置にカーソルを置く
3. The 拡張要素コマンド shall callout コマンド群を種別の**単一の真実源**からデータ駆動で生成し、種別の追加・削除がその1箇所の編集で（描画側・コマンド側の両方へ）完結するようにする（種別リストを重複管理しない）
4. While ユーザーが `/callout` と入力する, the 拡張要素コマンド shall 全種別の callout コマンドを絞り込み候補として表示する（種別名・別名でも絞り込める）

### Requirement 5: 基盤と一貫した挿入・適用挙動

**Objective:** As an ユーザー, I want 拡張要素も基本コマンドと同じ操作感で扱いたい, so that 挙動の差異に戸惑わない

#### Acceptance Criteria

1. When ユーザーが拡張要素コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除する
2. When 静的挿入コマンド（plantuml / callout）が適用される, the 拡張要素コマンド shall ユーザーが続けて入力できる位置にカーソルを配置し、挿入を単一トランザクションで行い、undo 1 回で元の状態に戻す
3. When 起動コマンド（drawio / リンク / テーブルビルダー）が適用される, the 拡張要素コマンド shall `/query` の削除を単一トランザクションで行ったうえで、対応するモーダルを起動する
4. When ブロック要素の起動コマンド（drawio / テーブルビルダー）が行の途中（`/` の直前に非空白テキストがある、例 `図: /drawio`）で適用される, the 拡張要素コマンド shall モーダルが挿入するブロック要素（` ```drawio ` フェンス / Markdown テーブル）が独立した行に置かれるよう、起動前に挿入位置を行頭へ正規化する（先行テキストと同一行に連結して描画が壊れることを防ぐ）。インライン要素のリンクはこの正規化の対象外（Req 9.1 参照）

### Requirement 6: 基盤メニューへの統合と絞り込み

**Objective:** As an ユーザー, I want 拡張要素コマンドも同じメニューから絞り込んで選びたい, so that 基本コマンドと拡張要素を区別なく素早く呼び出せる

#### Acceptance Criteria

1. The 拡張要素コマンド shall 基盤のスラッシュコマンドメニューに、基本コマンドと同じ候補一覧として表示される
2. When ユーザーが `/` に続けて文字を入力する, the 拡張要素コマンド shall 基盤の照合規則（英語の id とキーワードに対する前方一致。ローカライズ済みラベルは照合しない）に従う絞り込み対象に含まれる
3. While 基盤の起動条件（行頭または空白直後の `/`）を満たさない, the 拡張要素コマンド shall 候補として表示されない
4. Where カーソルがリスト項目内またはテーブルセル内にある, the 拡張要素コマンド shall ブロック要素コマンド（drawio / plantuml / callout / テーブルビルダー）を基盤のコンテキスト除外（`disallowedIn: ['list','table']`）により候補として表示しない。インライン要素（リンク / lsx）はこの制限を受けない

### Requirement 7: コマンド表示の多言語対応

**Objective:** As an 異なる表示言語を使うユーザー, I want 拡張要素コマンドのラベルと説明が自分の言語で表示されてほしい, so that 内容を理解して選べる

#### Acceptance Criteria

1. The 拡張要素コマンド shall コマンドのラベルと説明を、ユーザーの表示言語設定に従って表示する
2. If あるコマンドのラベルまたは説明が現在の表示言語向けに用意されていない, then the 拡張要素コマンド shall 既定言語のテキストを表示する

### Requirement 8: 既存機能・描画との境界

**Objective:** As an ユーザーおよび運用者, I want 拡張要素の挿入・起動が描画や既存補完を壊さないでほしい, so that 追加による回帰が起きない

#### Acceptance Criteria

1. The 拡張要素コマンド shall 記法テキストの挿入またはモーダル起動のみを担い、挿入された要素の描画・プレビューは既存の描画機構に委ねる
2. The 拡張要素コマンド shall 既存の絵文字オートコンプリート（`:`）および基本スラッシュコマンドと同時に有効であっても、互いの表示・動作を妨げない
3. The 拡張要素コマンド shall 既存 drawio モーダルの挙動（ツールバーからの起動・描画・書き戻し）を変更しない
4. The 拡張要素コマンド shall 既存 Edit Link Modal / Handsontable Modal の挙動（ツールバーからの起動・編集・書き戻し）を変更しない

### Requirement 9: リンクモーダルの起動と書き戻し

**Objective:** As an ユーザー, I want `/link` から既存のリンク編集モーダルを開いてリンクを挿入したい, so that リンク記法を意識せず挿入・編集できる

#### Acceptance Criteria

1. When ユーザーがリンクコマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで、カーソル位置に既存の Markdown リンクがあればそれを初期値として Edit Link Modal を起動する
2. When ユーザーが Edit Link Modal でリンクを確定する, the Edit Link Modal shall 確定したリンク記法をカーソル位置に挿入する（既存の書き戻し機構を利用）
3. When ユーザーが Edit Link Modal をキャンセルする, the 拡張要素コマンド shall エディタへ要素を挿入しない（`/query` 削除のみが残る）
4. The 拡張要素コマンド shall Edit Link Modal の起動を packages/editor 側の既存ユーティリティ（`getMarkdownLink` / `replaceFocusedMarkdownLinkWithEditor`）経由で行い、apps/app への逆依存を持たない

### Requirement 10: テーブルビルダーモーダルの起動と書き戻し

**Objective:** As an ユーザー, I want `/table-builder`（仮称）から行列数を編集できるテーブルビルダーを開きたい, so that プレーンな2列テーブルではなく必要な行列数の表を直接構成できる

#### Acceptance Criteria

1. When ユーザーがテーブルビルダーコマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで、現在の `EditorView` を対象に Handsontable Modal を起動する
2. When ユーザーが Handsontable Modal で表を確定する, the Handsontable Modal shall 確定した表を Markdown テーブル記法としてカーソル位置に挿入する（既存の書き戻し機構を利用）
3. When ユーザーが Handsontable Modal をキャンセルする, the 拡張要素コマンド shall エディタへ要素を挿入しない（`/query` 削除のみが残る）
4. The 拡張要素コマンド shall Handsontable Modal の起動を packages/editor 側のトリガー機構（atom、`useHandsontableModalForEditorActions`）経由で行い、apps/app への逆依存を持たない
5. The 拡張要素コマンド shall 基盤の `table` コマンド（プレーンな2列テーブルの即挿入）を置き換えない。両者は別コマンドとして共存する
