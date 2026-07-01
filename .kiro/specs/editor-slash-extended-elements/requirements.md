# Requirements Document

## Introduction

アンブレラ `editor-commands` の子スペック。基盤 `editor-slash-command` のスラッシュコマンド機構の上に、GROWI 固有の拡張要素を `/` から挿入・起動できるコマンドを追加する。初期リリースの対象は **drawio（作図モーダル起動）・plantuml（フェンス静的挿入）・lsx（設定モーダル起動）・callout（種別選択して静的挿入）** とする。

拡張要素には「静的テキストを挿入すれば足りるもの（plantuml / callout）」と「専用 UI（モーダル）での設定・編集が要るもの（drawio / lsx）」の2系統がある。後者を扱うため、基盤のコマンドアクションを **「静的挿入（insert）」と「副作用起動（run）」の2種**に一般化する（基盤の所有・本スペックの前提ゲート）。起動・絞り込み・`/query` 置換・i18n 解決・単一トランザクション挿入は基盤の挙動を踏襲する。

背景・スコープ・依存関係の詳細は [brief.md](./brief.md)、アンブレラ全体は [roadmap.md](../editor-commands/roadmap.md) を参照。

## Boundary Context

- **In scope**:
  - drawio を挿入するスラッシュコマンド → **既存 drawio モーダルを起動**し、作図結果をフェンスとして挿入（モーダル本体は再利用）
  - lsx を挿入するスラッシュコマンド → **新規 lsx 設定モーダルを起動**し、フォームで組み立てた `$lsx(...)` を挿入
  - plantuml を挿入するスラッシュコマンド → フェンス雛形を静的挿入
  - callout を挿入するスラッシュコマンド → 7 バリアント（note / tip / important / info / warning / danger / caution）を**種別を選んで**静的挿入
  - 基盤のアクションモデルを `insert | run` に一般化すること（基盤への変更要求＝前提ゲート）
  - 基盤のスラッシュコマンドメニュー・絞り込みへの統合（drawio/lsx は React 合成点でモーダルオープナーを束縛）
  - コマンドのラベル・説明の多言語表示
- **Out of scope**:
  - 拡張要素の**描画・プレビュー**（既存の描画機構＝remark/rehype プラグインの領域）
  - 既存 drawio モーダル**本体の改修**（起動導線の追加のみ）
  - lsx の**サーバ側 list-pages ロジック**（既存。本スペックはフォーム→記法文字列生成と挿入のみ）
  - math（KaTeX）・mermaid 等、今回未選択の要素（将来拡張）
  - テンプレート挿入（別構想）
  - 基盤のトリガー検出・補完ソース・レジストリ機構そのもの（基盤 `editor-slash-command` の所有。アクションモデルの一般化を除く）
- **Adjacent expectations**:
  - 基盤 `editor-slash-command` のスラッシュコマンド機構（起動・絞り込み・`apply`・i18n 解決）に乗る。基盤の起動条件（行頭または空白直後の `/`、単語の途中は除外）に従う。
  - 既存の絵文字オートコンプリート（`:`）および基本スラッシュコマンドと同時に機能し、互いに干渉しない。
  - 挿入された要素の描画は既存の描画機構が担う（本スペックは記法テキストの挿入／モーダル起動のみ）。
  - packages/editor は apps/app に逆依存しない（モーダルは editor 側トリガーフック経由で起動、UI 本体は apps/app）。

## Requirements

### Requirement 1: 拡張要素の挿入・起動コマンド提供

**Objective:** As an エディタで執筆するユーザー, I want GROWI 固有の要素も `/` から挿入・起動したい, so that 記法を手入力せず作図・UML・動的一覧・callout を素早く扱える

#### Acceptance Criteria

1. The 拡張要素コマンド shall 次のコマンドを提供する: drawio、plantuml、lsx、callout（種別別）
2. When ユーザーが drawio コマンドを選択する, the 拡張要素コマンド shall 既存の drawio 作図モーダルを起動する
3. When ユーザーが plantuml コマンドを選択する, the 拡張要素コマンド shall 内容を記述できる plantuml コードフェンス雛形を挿入する
4. When ユーザーが lsx コマンドを選択する, the 拡張要素コマンド shall lsx 設定モーダルを起動する
5. When ユーザーが callout コマンド（いずれかの種別）を選択する, the 拡張要素コマンド shall 対応する種別の callout ディレクティブ（`:::<type>` … `:::`）を挿入する
6. Where 今回未選択の拡張要素（math、mermaid 等）, the 拡張要素コマンド shall 本リリースではコマンドを提供しない

### Requirement 2: drawio モーダルの起動と書き戻し

**Objective:** As an ユーザー, I want `/drawio` から作図エディタを開いて図を作りたい, so that 記法を意識せず図を挿入・編集できる

#### Acceptance Criteria

1. When ユーザーが drawio コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで、現在の `editorKey` を対象に drawio モーダルを起動する
2. When ユーザーが drawio モーダルで作図を保存する, the drawio モーダル shall 作図結果を ` ```drawio ` フェンスとしてカーソル位置に挿入する（既存の書き戻し機構を利用）
3. When ユーザーが drawio モーダルをキャンセルする, the 拡張要素コマンド shall エディタへ要素を挿入しない（`/query` 削除のみが残る）
4. The 拡張要素コマンド shall drawio モーダルの起動を packages/editor 側のトリガー機構（atom）経由で行い、apps/app への逆依存を持たない

### Requirement 3: lsx 設定モーダルによるオプション組み立て

**Objective:** As an ユーザー, I want `/lsx` からフォームでオプションを設定して一覧を挿入したい, so that lsx の記法やオプション名を覚えなくても動的一覧を構成できる

#### Acceptance Criteria

1. When ユーザーが lsx コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで lsx 設定モーダルを起動する
2. The lsx 設定モーダル shall 次のオプションを設定できる: prefix（パス）、num、depth、sort、reverse、filter、except
3. When ユーザーが lsx 設定モーダルで確定する, the lsx 設定モーダル shall 入力値から妥当な `$lsx(...)` 文字列を組み立ててカーソル位置に挿入する
4. Where ユーザーがオプションを何も指定しない, the lsx 設定モーダル shall `$lsx()` を挿入する（現在ページ配下一覧として描画される）
5. When ユーザーが lsx 設定モーダルをキャンセルする, the 拡張要素コマンド shall エディタへ要素を挿入しない
6. The lsx 設定モーダル shall 起動を packages/editor 側のトリガー機構（atom）経由で行い、UI 本体は apps/app に置く

### Requirement 4: callout の種別選択挿入

**Objective:** As an ユーザー, I want `/` から callout を種別（note / tip / warning 等）を選んで挿入したい, so that 注意書きや補足を素早く適切な見た目で挿入できる

#### Acceptance Criteria

1. The 拡張要素コマンド shall callout の各種別（note / tip / important / info / warning / danger / caution）をそれぞれ選択可能なコマンドとして提供する
2. When ユーザーがある種別の callout コマンドを選択する, the 拡張要素コマンド shall その種別の callout ディレクティブ（`:::<type>` + 改行 + 本文行 + 改行 + `:::`）を挿入し、本文入力位置にカーソルを置く
3. The 拡張要素コマンド shall callout コマンド群を変種の宣言リストからデータ駆動で生成し、種別の追加・削除が宣言リストの編集で完結するようにする
4. While ユーザーが `/callout` と入力する, the 拡張要素コマンド shall 全種別の callout コマンドを絞り込み候補として表示する（種別名・別名でも絞り込める）

### Requirement 5: 基盤と一貫した挿入・適用挙動

**Objective:** As an ユーザー, I want 拡張要素も基本コマンドと同じ操作感で扱いたい, so that 挙動の差異に戸惑わない

#### Acceptance Criteria

1. When ユーザーが拡張要素コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除する
2. When 静的挿入コマンド（plantuml / callout）が適用される, the 拡張要素コマンド shall ユーザーが続けて入力できる位置にカーソルを配置し、挿入を単一トランザクションで行い、undo 1 回で元の状態に戻す
3. When 起動コマンド（drawio / lsx）が適用される, the 拡張要素コマンド shall `/query` の削除を単一トランザクションで行ったうえで、対応するモーダルを起動する

### Requirement 6: 基盤メニューへの統合と絞り込み

**Objective:** As an ユーザー, I want 拡張要素コマンドも同じメニューから絞り込んで選びたい, so that 基本コマンドと拡張要素を区別なく素早く呼び出せる

#### Acceptance Criteria

1. The 拡張要素コマンド shall 基盤のスラッシュコマンドメニューに、基本コマンドと同じ候補一覧として表示される
2. When ユーザーが `/` に続けて文字を入力する, the 拡張要素コマンド shall ラベルおよびキーワードに対する絞り込み対象に含まれる
3. While 基盤の起動条件（行頭または空白直後の `/`）を満たさない, the 拡張要素コマンド shall 候補として表示されない

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
