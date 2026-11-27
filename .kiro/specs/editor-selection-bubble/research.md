# Research & Design Decisions: editor-selection-bubble

## Summary
- **Feature**: `editor-selection-bubble`（アンブレラ `editor-commands` の子スペック）
- **Discovery Scope**: Extension（既存 CodeMirror エディタへの浮動 UI 追加 + 閲覧ページ「Comment」バブルとの見た目共有）
- **Key Findings**:
  - 「Comment」バブル（`inline-comment`）の位置合わせは Popper（placement `top` + `flip` / `preventOverflow` / `offset [0, 8]`）で、基準は選択範囲の**カーソル側の端**。CodeMirror 6.43 の tooltip は「上側優先・余白不足で反転・左右 clamp・`offset.y`・`getCoords` 差し替え」を標準で持ち、`getCoords` で基準を「head 位置を中心」にずらせば**新規依存なしで同等の配置**を得られる。
  - 「Comment」バブルの見た目は Bootstrap `btn btn-sm shadow-sm` + `SelectionActionButton.module.scss` の `--bs-btn-*` 上書き（全テーマ共通の `--bs-*` のみ参照）。`packages/editor` は `apps/app` を参照できないが、**両者とも `@growi/core-styles` に依存**しているため、上書き部分を core-styles の mixin に切り出せば単一の情報源で共有できる。
  - 書式適用は既存の基底 `toggleMarkdownSymbol` で完結し、基盤 `editor-slash-command` のレジストリには依存しない。アイコン・操作名はツールバー（`TextFormatTools.tsx`）と同じ `material-symbols-outlined` グリフと `toolbar.*` i18n キーを再利用でき、新規 locale キーは不要。

## Research Log

### 「Comment」バブルの位置合わせ
- **Context**: Req 2（「Comment」バブルと同じ位置合わせ）。
- **Sources Consulted**:
  - `apps/app/src/features/inline-comment/client/components/SelectionPopover/SelectionPopover.tsx`
  - `.../SelectionPopover/use-popper-position.ts`
  - `.../SelectionCapture/selection-cursor-edge.ts`
  - `.../SelectionPopover/selection-virtual-element.ts`
- **Findings**:
  - `cursorEdge` 指定時は placement `top`、基準は選択範囲の端（`start` = 後方向選択、`end` = 前方向選択）を中心とする仮想要素。
  - modifiers は `flip`（上に入らなければ下）、`preventOverflow`（表示領域の左右にはみ出さない）、`offset [0, 8]`（選択範囲から 8px）。
  - バブルのボタン押下では `mousedown` の `preventDefault()` で選択の解除を防いでいる。
- **Implications**: CodeMirror の選択では `selection.main.head` がそのまま「カーソル側の端」に相当し、前方向/後方向の判定が不要になる。8px は Popper オプション（TS）にしか存在しないため、エディタ側で同値の定数を持つ（後述 Decision）。

### CodeMirror tooltip の配置アルゴリズム（`@codemirror/view` 6.43.15）
- **Context**: Popper と同等の配置を CM 標準 tooltip で得られるか。
- **Sources Consulted**: `node_modules/@codemirror/view/dist/index.js` の `tooltipPlugin.readMeasure` / `writeMeasure`。
- **Findings**:
  - 基準座標は `tooltipView.getCoords(pos)` があればそれを、なければ `view.coordsAtPos(pos)` を使う（read フェーズで呼ばれる）。
  - 横位置は `pos.left + offset.x` を `space.left`〜`space.right - width` に clamp（= `preventOverflow` 相当）。基準の左端に揃えるため、中央寄せには基準座標側を `width / 2` ずらす必要がある。
  - `above: true` で上側優先。`strictSide` でなければ、上に入らず下の方が広いとき下へ反転（= `flip` 相当）。
  - 縦の間隔は `offset.y`。
  - `tooltip.clip !== false` のとき、基準がエディタの可視領域外に出ると tooltip を隠す。
  - `.cm-tooltip` には baseTheme の枠線・背景（`&light` / `&dark`）が付くため、バブル側で打ち消す必要がある。
- **Implications**: `getCoords` で「head の座標を、tooltip DOM 幅の半分だけ左にずらした矩形」を返し、`above: true`・`offset: { x: 0, y: 8 }` とすれば「Comment」バブルと同じ挙動になる。中央寄せの計算は純粋関数として切り出せる。

### 見た目の共有先
- **Context**: Req 3.1〜3.3（「Comment」バブルと同じ見た目・テーマ追随）。
- **Sources Consulted**: `SelectionActionButton.tsx` / `.module.scss`、`packages/core-styles/scss/**`、`packages/editor/package.json`、`apps/app/src/styles/vendor.scss`。
- **Findings**:
  - 見た目は Bootstrap `btn btn-sm shadow-sm` + `--bs-btn-{bg,color,border-color,hover-*,active-*}` の上書き 9 行のみ。参照する `--bs-body-bg` / `--bs-body-color` / `--bs-border-color` / `--bs-secondary-bg` / `--bs-tertiary-bg` は全 16 テーマ × ライト/ダークで出力される。
  - エディタは `@growi/core-styles/scss/bootstrap/apply` を読み込んでおり、`btn` / `btn-group` / `shadow-sm` はエディタ内でも有効。
  - `@growi/core-styles/scss/helpers/` に mixin の前例（`_modifier-keys.scss`、`@use '@growi/core-styles/scss/helpers/modifier-keys'` で利用）がある。
  - `packages/editor` は既に `.ts` から `*.module.scss` を import している（`unified-merge-view/index.ts`）。
- **Implications**: 上書き 9 行を `@growi/core-styles/scss/helpers/_selection-bubble.scss` の mixin に移し、`SelectionActionButton.module.scss` とバブルメニューの module SCSS の双方で `@include` する。`@growi/core-styles` は非公開パッケージのため changeset 不要。

### Escape とキーマップ
- **Context**: Req 5.2（Escape で閉じ選択は維持）、7.2/7.3（既存挙動不変）。
- **Findings**:
  - `defaultKeymap` は `Escape → simplifySelection`（選択を畳む）を `Prec.lowest` で登録している。バブル用 Escape を通常優先度で登録し、表示中のみ `true` を返せば `simplifySelection` より先に処理され選択が維持される。非表示時は `false` で既存挙動へ通過する。
  - `@replit/codemirror-vim` は自身の `keydown` ハンドラでキーを処理する。vim の visual モード中に Escape がバブル側で消費されると visual 終了が遅れる可能性がある。
- **Implications**: vim キーマップでの Escape の順序は実装時に実機確認する（Risk に記録）。

### フォーカス喪失の検知
- **Findings**: `EditorView.focusChangeEffect`（6.43 で利用可）でフォーカス変化時に StateEffect を発行できる。バブルのボタンで `mousedown` の `preventDefault()` を行えばクリックでエディタのフォーカスは外れない。`toggleMarkdownSymbol` は末尾で `view.focus()` を呼ぶ。
- **Implications**: 「フォーカスの有無」を StateField に持ち、表示条件に含める。dismiss（Escape）とは別の状態として扱い、フォーカスが戻れば選択が残っている限り再表示できる。

### 取り消し線の記号
- **Findings**: ツールバーは `~`、ショートカット（`make-text-strikethrough.ts`）と emacs キーマップは `~~`。
- **Implications**: GFM 標準かつキーボード操作と一致する `~~` を採用する（アイコンはツールバーと同じ `format_strikethrough`）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: CM `showTooltip` + `getCoords` 中央寄せ | StateField で Tooltip を供給し、配置は CM に任せる | 新規依存なし。スクロール追従・可視領域外での非表示を CM が担う。CM のトランザクションと同期 | Popper とは別実装のため 8px 等の定数は複製になる | **採用** |
| B: React + Popper オーバーレイ | `CodeMirrorEditor` に React コンポーネントを置き、`coordsAtPos` を仮想要素として Popper で配置 | 「Comment」バブルと同一アルゴリズム | CM の選択・スクロールを React へ橋渡しする仕組みが新たに必要。フォーカス・Escape 処理が CM 外に分散 | 不採用 |
| C: Comment バブル部品を共有パッケージへ移す | `SelectionPopover` 等を `@growi/ui` 等に移し両方で使う | 完全な単一実装 | DOM Range 前提で CM の選択モデルに合わない。完了済みの `inline-comment` に大きな変更 | 不採用 |

## Design Decisions

### Decision: MVP では基盤 `editor-slash-command` に依存しない
- **Context**: roadmap は当初「共有レジストリ」を想定していた。
- **Selected Approach**: 独立モジュール。操作 4 件を自前でデータ宣言し、`toggleMarkdownSymbol` を再利用する。
- **Trade-offs**: 将来 slash と操作定義を共有する場合は共通コマンド抽象への寄せが必要（roadmap "Shared seams to watch"）。

### Decision: 配置は CM tooltip + `getCoords` で「Comment」バブルと揃える（Option A）
- **Selected Approach**: Tooltip `pos = selection.main.head`、`above: true`、`offset.y = 8`、`getCoords` で head の座標を tooltip 幅の半分だけ左へずらす。左右 clamp と上下反転は CM 標準に任せる。
- **Rationale**: 新規依存なしで Popper の `top` + `flip` + `preventOverflow` + `offset` と同じ観測結果になる。CM のスクロール追従をそのまま得られる。
- **Trade-offs**: 間隔 8px はエディタ側の定数として複製する（TS の Popper オプションとエディタ間で共有する自然な置き場がない）。Revalidation Trigger に登録する。

### Decision: 見た目は core-styles の mixin で一元化する
- **Selected Approach**: `@growi/core-styles/scss/helpers/_selection-bubble.scss` に `selection-bubble-button` mixin を新設する。`inline-comment` の `SelectionActionButton.module.scss` は同 mixin を `@include` する形に置き換える（見た目は変えない）。バブルメニューは `btn-group shadow-sm` の中に `btn btn-sm` を 4 つ並べ、各ボタンに同 mixin を適用する。
- **Rationale**: 「Comment」バブルの見た目が変われば自動でバブルメニューも追随する（requirements の Adjacent expectations）。複製による見た目のずれを防ぐ。
- **Trade-offs**: 完了済みスペック `inline-comment` の SCSS に触れる。ただし出力 CSS は同一で、コメント機能の契約は変わらないため amend スペックは不要。

### Decision: ツールチップは `title` 属性、読み上げ名は `aria-label`
- **Context**: Req 6.1（ツールバーと同じ操作名をツールチップで表示）、6.2（支援技術向けの名前）。
- **Selected Approach**: tooltip DOM は React 外で構築するため、reactstrap の `UncontrolledTooltip` ではなく `title` と `aria-label` に `t('toolbar.*')` を設定する。
- **Trade-offs**: ツールチップの見た目はブラウザ標準になる（要件は操作名の表示のみを求める）。

### Decision: 表示状態は「選択」「dismiss」「フォーカス」の 3 要素で決める
- **Selected Approach**: StateField に `{ dismissed, focused }` を持ち、「非空選択 かつ 未 dismiss かつ フォーカスあり」のときだけ Tooltip を返す。選択が変わると dismiss を解除する。
- **Rationale**: Req 5.2（Escape 後も選択維持）と 5.3（選択変更で再表示）、5.4（フォーカス喪失で閉じる）を 1 つの純粋な状態遷移で表現できる。

## Design Synthesis
- **Generalization**: 4 つの操作は `toggleMarkdownSymbol` の (prefix, suffix) の違いだけなので、データ宣言 1 つで表現する。
- **Build vs Adopt**:
  - 配置は CM tooltip を採用。
  - 書式適用は `toggleMarkdownSymbol` を採用。
  - アイコンと操作名は既存ツールバーのものを採用。
  - 見た目は Bootstrap `btn` / `btn-group` と「Comment」バブルの上書き（mixin 化して共有）を採用。
  - 新規に作るのは「表示状態の StateField」「中央寄せの純粋関数」「バブル DOM」「Escape とフォーカス処理の合成」のみ。
- **Simplification**: Popper / React オーバーレイを持ち込まない。前方向/後方向の判定は `head` で不要になる。

## Risks & Mitigations
- **vim キーマップの Escape** — バブル側の Escape が vim の visual モード終了より先に消費されると挙動が変わる。→ 実装時に vim キーマップで確認し、問題があれば vim の処理が先に走る優先度へ下げる。
- **`.cm-tooltip` の既定スタイル** — CM baseTheme の枠線・背景がバブルの見た目に混ざる。→ バブルの tooltip 要素で枠線・背景・パディングを打ち消す。
- **中央寄せ用の幅の読み取り** — `getCoords` は read フェーズで呼ばれるため DOM 幅の取得は安全。初回測定前は幅 0 となり左揃えになるが、次の測定で補正される。
- **言語切替** — `t` は `useDefaultExtensions` の再登録で反映される（slash と同方針）。

## References
- `@codemirror/view` `showTooltip` / `Tooltip` / `TooltipView.getCoords` / `EditorView.focusChangeEffect`
- `packages/editor/src/client/services-internal/markdown-utils/toggle-markdown-symbol.ts`
- `packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/TextFormatTools.tsx`
- `apps/app/src/features/inline-comment/client/components/SelectionCapture/SelectionActionButton.{tsx,module.scss}`
- `apps/app/src/features/inline-comment/client/components/SelectionPopover/use-popper-position.ts`
- `packages/core-styles/scss/helpers/_modifier-keys.scss`（mixin の前例）
- `.kiro/specs/editor-commands/roadmap.md`
