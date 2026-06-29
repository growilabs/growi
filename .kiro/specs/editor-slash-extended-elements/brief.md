# Brief: editor-slash-extended-elements

> アンブレラ `editor-commands` の子スペック。基盤 `editor-slash-command` に依存。

## Problem
`editor-slash-command`（MVP）のスラッシュコマンドは基本 Markdown 要素（見出し・リスト・引用・コードブロック・テーブル）のみを対象とする。GROWI 固有の拡張要素（drawio 作図・plantuml・lsx 動的リスト等）は `/` から挿入できず、ユーザーはツールバーや記法の手入力に頼る必要がある。

## Current State
- 基盤 `editor-slash-command` が、補完ソース（トリガー検出・フィルタ・`apply`）、コマンドレジストリ（データ駆動・単一ソース）、挿入ビルダー、i18n 解決を提供する。
- GROWI 拡張要素は既存の remark プラグインで**描画**される（drawio / math / lsx 等）。挿入時の記法（コードフェンス、`$$ $$`、`$lsx()` 等）は確定している。
- ツールバーには drawio 用の DiagramButton があり、挿入記法の参照になる。

## Desired Outcome
- `/drawio` `/plantuml` `/lsx` で、対応する GROWI 拡張要素の雛形が `editor-slash-command` と同じ挙動（`/query` 置換 + 単一トランザクション挿入 + カーソル配置）で挿入される。
- 各コマンドのラベル/説明が多言語表示される。

## Approach
基盤のコマンドレジストリに**拡張要素コマンドの定義データ**を追加し、各要素の雛形を生成する**純粋な挿入ビルダー**を新設する。トリガー・補完ソース・`apply`・登録機構は基盤のものをそのまま利用し、新たな UI やトリガーは追加しない。これにより本スペックは「定義 + ビルダー」の追加に閉じる。

## Scope
- **In**:
  - 拡張要素の挿入コマンド定義（対象: drawio / plantuml / lsx。math / mermaid / callout 等は将来拡張）
  - 各要素の雛形を生成する純粋挿入ビルダー（カーソルは編集を続けやすい位置へ）
  - コマンドのラベル/説明の i18n キー
- **Out**:
  - 拡張要素の**描画**（既存 remark プラグインの領域）
  - drawio のモーダル作図エディタ起動（将来拡張）
  - テンプレート挿入（別構想）
  - 補完エンジン・トリガー・レジストリ機構そのもの（基盤の所有）

## Boundary Candidates
- **拡張要素コマンド定義**: 各拡張要素の id・i18n キー・キーワード・対応ビルダーを宣言したデータ。
- **拡張要素挿入ビルダー**: 各要素の雛形（記法スケルトン）とカーソル位置を返す純粋関数。

## Out of Boundary
- 基盤の補完ソース/トリガー/レジストリ機構/登録点（`editor-slash-command` が所有）。
- 拡張要素の描画・パース（remark プラグイン）。
- グローバルホットキー・キーバインド・絵文字補完。

## Upstream / Downstream
- **Upstream**: `editor-slash-command`（レジストリ・補完ソース・`apply`・i18n 解決・挿入ビルダーのパターン）、既存の GROWI 拡張要素記法、ツールバー DiagramButton（drawio 記法の参照）。
- **Downstream**: さらなる拡張要素コマンドの追加（定義データの追記で対応）。

## Existing Spec Touchpoints
- **Extends**: `editor-slash-command` のコマンドレジストリにデータを追加して機能拡張する（基盤の機構は変更しない）。
- **Adjacent**: 拡張要素の remark プラグイン（描画側、重複しない）。

## Constraints
- TypeScript strict、Biome、Vitest（co-located）。
- 挿入は単一トランザクション・通常の `view.dispatch`（undo 粒度・協調編集整合を維持）。
- ラベル/説明は既存 i18n（react-i18next + locale JSON）に乗せ、未対応言語は既定言語へフォールバック。
