# Requirements Document

## Introduction

アンブレラ `editor-commands` の子スペック。基盤 `editor-slash-command` のスラッシュコマンド機構の上に、GROWI 固有の拡張要素を `/` から挿入できるコマンドを追加する。初期リリースでは **drawio（作図）・plantuml（UML）・lsx（動的ページ一覧）** を対象とする。挿入の起動・絞り込み・適用（`/query` 置換・単一トランザクション・カーソル配置）は基盤の挙動を踏襲し、本スペックは「コマンド定義の追加」と「各要素の雛形挿入」に閉じる。

背景・スコープ・依存関係の詳細は [brief.md](./brief.md)、アンブレラ全体は [roadmap.md](../editor-commands/roadmap.md) を参照。

## Boundary Context

- **In scope**:
  - drawio / plantuml / lsx を挿入するスラッシュコマンドの提供
  - 各要素の雛形（drawio・plantuml は空のコードフェンス、lsx は記法雛形）の挿入とカーソル配置
  - 基盤のスラッシュコマンドメニュー・絞り込みへの統合
  - コマンドのラベル・説明の多言語表示
- **Out of scope**:
  - 拡張要素の**描画・プレビュー**（既存の描画機構＝remark/rehype プラグインの領域）
  - drawio のモーダル作図エディタ起動（将来拡張）
  - math（KaTeX）・mermaid・callout 等、今回未選択の要素（将来拡張）
  - 基盤のトリガー検出・補完ソース・レジストリ機構そのもの（基盤 `editor-slash-command` の所有）
  - テンプレート挿入（別構想）
- **Adjacent expectations**:
  - 基盤 `editor-slash-command` のスラッシュコマンド機構（起動・絞り込み・`apply`・i18n 解決）に乗る。基盤の起動条件（行頭または空白直後の `/`、単語の途中は除外）に従う。
  - 既存の絵文字オートコンプリート（`:`）および基本スラッシュコマンドと同時に機能し、互いに干渉しない。
  - 挿入された要素の描画は既存の描画機構が担う（本スペックは記法テキストの挿入のみ）。

## Requirements

### Requirement 1: 拡張要素の挿入コマンド提供

**Objective:** As an エディタで執筆するユーザー, I want GROWI 固有の要素も `/` から挿入したい, so that 記法を手入力せず作図・UML・動的一覧を素早く挿入できる

#### Acceptance Criteria

1. The 拡張要素コマンド shall 次の要素を挿入するコマンドを提供する: drawio、plantuml、lsx
2. When ユーザーが drawio コマンドを選択する, the 拡張要素コマンド shall 内容を記述できる空の drawio コードフェンスを挿入する
3. When ユーザーが plantuml コマンドを選択する, the 拡張要素コマンド shall 内容を記述できる空の plantuml コードフェンスを挿入する
4. When ユーザーが lsx コマンドを選択する, the 拡張要素コマンド shall lsx の記法雛形を挿入する
5. Where 今回未選択の拡張要素（math、mermaid、callout 等）, the 拡張要素コマンド shall 本リリースではコマンドを提供しない

### Requirement 2: 基盤と一貫した挿入挙動

**Objective:** As an ユーザー, I want 拡張要素も基本コマンドと同じ操作感で挿入したい, so that 挙動の差異に戸惑わない

#### Acceptance Criteria

1. When ユーザーが拡張要素コマンドを選択する, the 拡張要素コマンド shall 入力した `/` とそれに続くクエリ文字列を削除したうえで要素を挿入する
2. When 拡張要素が挿入される, the 拡張要素コマンド shall ユーザーが続けて入力できる位置にカーソルを配置する
3. When 拡張要素が挿入された直後にユーザーが取り消し（undo）操作を行う, the 拡張要素コマンド shall 挿入された要素を 1 回の操作で元の状態に戻す

### Requirement 3: 基盤メニューへの統合と絞り込み

**Objective:** As an ユーザー, I want 拡張要素コマンドも同じメニューから絞り込んで選びたい, so that 基本コマンドと拡張要素を区別なく素早く呼び出せる

#### Acceptance Criteria

1. The 拡張要素コマンド shall 基盤のスラッシュコマンドメニューに、基本コマンドと同じ候補一覧として表示される
2. When ユーザーが `/` に続けて文字を入力する, the 拡張要素コマンド shall ラベルおよびキーワードに対する絞り込み対象に含まれる
3. While 基盤の起動条件（行頭または空白直後の `/`）を満たさない, the 拡張要素コマンド shall 候補として表示されない

### Requirement 4: コマンド表示の多言語対応

**Objective:** As an 異なる表示言語を使うユーザー, I want 拡張要素コマンドのラベルと説明が自分の言語で表示されてほしい, so that 内容を理解して選べる

#### Acceptance Criteria

1. The 拡張要素コマンド shall コマンドのラベルと説明を、ユーザーの表示言語設定に従って表示する
2. If あるコマンドのラベルまたは説明が現在の表示言語向けに用意されていない, then the 拡張要素コマンド shall 既定言語のテキストを表示する

### Requirement 5: 既存機能・描画との境界

**Objective:** As an ユーザーおよび運用者, I want 拡張要素の挿入が描画や既存補完を壊さないでほしい, so that 追加による回帰が起きない

#### Acceptance Criteria

1. The 拡張要素コマンド shall 記法テキストの挿入のみを担い、挿入された要素の描画・プレビューは既存の描画機構に委ねる
2. The 拡張要素コマンド shall 既存の絵文字オートコンプリート（`:`）および基本スラッシュコマンドと同時に有効であっても、互いの表示・動作を妨げない
