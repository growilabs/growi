# Implementation Plan

> **依存**: 本スペックは MVP で基盤 `editor-slash-command` に依存しない（独立実装可）。基底ユーティリティ `toggleMarkdownSymbol`・CodeMirror `showTooltip`・既存 `toolbar.*` i18n キーを再利用する（design.md / roadmap.md 参照）。新規依存ライブラリなし。

- [ ] 1. コア: 操作データ・パレットDOM・選択駆動表示

- [ ] 1.1 パレット操作集合をデータ宣言
  - 太字・斜体・取り消し線・インラインコードの各操作を、id・既存 i18n キー（`toolbar.*`）・material-symbols アイコン名・prefix/suffix とともにデータ宣言する
  - 観測: 4 操作が公開され、各々が正しい prefix/suffix・既存 toolbar キー・アイコンを持つことを単体テストで確認
  - _Requirements: 1.4, 2.1, 2.2_
  - _Boundary: selection-palette-operations_

- [ ] 1.2 パレットDOMビルダーを実装し書式トグルに結線
  - 各操作をアイコン + ラベル（`t(labelKey)` を title/aria）でボタン化したパレット DOM を構築する
  - ボタンクリックで `toggleMarkdownSymbol(view, prefix, suffix)` を呼び、選択範囲へ書式を適用/解除する（適用後の再フォーカスは既存関数に委ねる）
  - ボタンの `mousedown` で `preventDefault()` し、クリック時にエディタが blur しないようにする
  - 観測: ボタンクリックで選択範囲が `**…**` 等にラップされ、再クリックで解除されることを単体テストで確認
  - _Requirements: 1.4, 2.1, 2.2, 4.1_
  - _Boundary: selection-palette-dom_
  - _Depends: 1.1_

- [ ] 1.3 選択駆動の tooltip StateField を実装
  - 各トランザクションで「非空選択 かつ 未 dismiss かつ フォーカスあり」のとき、選択範囲にアンカーした Tooltip（DOM はビルダーで生成、`above` 表示、アンカー位置は selection.main 基準）を返し、それ以外は null を返す StateField を実装する
  - Escape/blur 用の dismiss StateEffect を定義し、選択が変化したら dismiss をリセットする
  - 観測: 非空選択で Tooltip を返し、空選択・dismiss 効果で null を返し、選択変化で dismiss がリセットされることを単体テストで確認
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3_
  - _Boundary: selection-palette-tooltip_
  - _Depends: 1.2_

- [ ] 2. 統合: 拡張合成と登録

- [ ] 2.1 パレット拡張ファクトリを実装
  - StateField を `showTooltip` facet に供給し（位置追従）、Escape keymap（パレット表示時のみ dismiss して消費、非表示時は通過）と blur ハンドラ（`document.hasFocus()` 併用で真の喪失時のみ dismiss）を合成して 1 つの Extension を返すファクトリを実装する
  - 観測: 非空選択でパレットが表示され、Escape / 選択解除 / blur で閉じ、Escape は非表示時には消費されないことを確認
  - _Requirements: 1.3, 3.2, 3.3, 5.1, 5.2_
  - _Depends: 1.3_
  - _Boundary: selection-palette factory_

- [ ] 2.2 エディタへパレット拡張を登録
  - 登録フックで `useTranslation` により `t` を取得し、パレット拡張をエディタの既定拡張に追加する（ラベルは初期マウント時の言語で解決、未対応言語は既定言語へフォールバック）
  - 観測: エディタ起動時にパレットが有効になり、ラベル/ツールチップが表示言語で表示される
  - _Requirements: 4.1, 4.2, 5.1_
  - _Depends: 2.1_
  - _Boundary: use-default-extensions_

- [ ] 3. 検証

- [ ] 3.1 統合・スモーク検証
  - 実アプリでテキスト選択 → パレットの太字をクリック → 選択が `**…**` になり、再クリックで解除、undo 1 回で復元することを確認する
  - パレットが slash（`/`）・絵文字（`:`）補完と同時に有効でも干渉しないこと、既存キーバインド（Ctrl+B 等）が従来どおりであること、協調編集中の適用が同期されることを確認する
  - 観測: 上記シナリオが統合テスト/手動スモークで再現し、`turbo run lint/test/build --filter @growi/app` 相当が green
  - _Requirements: 2.3, 2.4, 5.1, 5.2, 5.3_
  - _Depends: 2.2_
