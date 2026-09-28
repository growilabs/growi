# Research & Design Decisions

## Summary
- **Feature**: `editor-slash-command`
- **Discovery Scope**: Extension（既存 CodeMirror 6 エディタ `packages/editor/` への機能追加）
- **Key Findings**:
  - 既存の絵文字オートコンプリート（`emojiAutocompletionSettings.ts`）が `@codemirror/autocomplete` の `autocompletion({ override: [...] })` を使っており、スラッシュコマンドを共存させるには**補完ソースを1つの `autocompletion()` 設定に統合**する必要がある。
  - 既存の挿入系 pure 関数（`toggleMarkdownSymbol` / `insertLinePrefix` / `makeTextCodeBlock` / `insertNewRowToMarkdownTable`）はいずれも内部で `view.dispatch` を行い、現在の選択範囲に対して動作する。スラッシュコマンドは「`/query` 削除 → 要素挿入」を**単一トランザクション**で行う必要があり、これらをそのまま流用すると複数トランザクション化して undo の粒度が崩れる。
  - 「空のテーブルを新規挿入する」ヘルパーは未実装（既存 table ユーティリティは行追加/整形のみ）。新規の純粋ビルダーが必要。

## Research Log

### CodeMirror autocomplete の共存（emoji と slash）
- **Context**: 既存の絵文字補完が稼働中。スラッシュコマンドを追加しても両方が機能する必要がある（Req 6.2）。
- **Sources Consulted**: `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts`、`stores/use-default-extensions.ts`、`@codemirror/autocomplete` API。
- **Findings**:
  - emoji は `autocompletion({ override: [emojiAutocompletion], addToOptions: [render], icons: false })` をそのまま Extension としてエクスポートし、`defaultExtensions` 配列に追加している。
  - `autocompletion` の `override` は補完ソースの固定リスト。`autocompletion()` を二重に登録すると override 同士が競合し得る。
- **Implications**: emoji 補完ソースを単独関数として切り出し、`use-default-extensions.ts` 側で `autocompletion({ override: [slashSource, emojiSource], addToOptions: [emojiRender] })` として**1つに統合**する。これにより両ソースが同一補完エンジンに登録され共存する。

### 挿入の単一トランザクション化（undo 粒度）
- **Context**: Req 3.2（`/query` を削除して要素挿入）と Req 3.5（直後の undo で復元）を両立する必要がある。
- **Findings**:
  - 既存 pure 関数は各々 `view.dispatch` する。`apply` 内で「削除 dispatch → pure 関数 dispatch」とすると 2 つ以上の履歴イベントになり、undo を複数回要する。
  - CodeMirror の `view.dispatch({ changes, selection })` で削除と挿入を 1 トランザクションにまとめれば、undo 1 回で元に戻る。
- **Implications**: スラッシュコマンドは、各コマンドが「カーソル位置に対する挿入内容（`SlashInsertion`）」を返す**純粋ビルダー**を持ち、補完の `apply` がその挿入と `/query` 削除を**単一の `view.dispatch`** に合成する。既存の toggle 系関数（選択範囲トグル/複数行対応）は流用せず、ブロック要素を新規挿入する専用ビルダーを新設する。

### トリガー条件
- **Context**: Req 1.1「行頭または空白直後の `/`」、Req 1.2「単語途中では発火しない」。
- **Findings**: MVP のコマンドは全てブロックレベル要素（見出し・リスト・引用・コードブロック・テーブル）。行中（mid-line）の空白直後で発火させても、挿入時にブロック要素を改行して新しい行に置けば行頭プレフィックスは壊れない。
- **Implications（更新済み）**: **`/` の直前が行頭（先頭空白のみ）または空白文字のときに発火**し、空白以外の文字の直後（単語の途中）では発火しない（Req 1.1/1.2）。行の途中で発火した場合、挿入ビルダーが `from` の行頭判定を行い、**先行する非空白テキストがあればブロック要素の前に改行を付与**して新しい行に挿入する（Req 3.6）。インライン要素の挿入は将来拡張。
  - ※当初は「行頭のみ」に絞っていたが、ユーザー要望（`あいうえお /command` でもパレットを出したい）により空白直後発火 + 行中は改行挿入に拡張。

### i18n（多言語ラベル）
- **Context**: Req 7。コマンドのラベル/説明をユーザー言語で表示。
- **Findings**: エディタの UI コンポーネントは `react-i18next` の `useTranslation('translation')` を使用。キーは `apps/app/public/static/locales/{locale}/translation.json`。CodeMirror 拡張は React 外で構築されるため、フック内でラベルを解決して拡張へ渡す必要がある。
- **Implications**: コマンド定義は i18n **キー**を保持し、登録フック（`use-default-extensions.ts`）で `useTranslation` を使って表示文字列に解決（`resolveSlashCommands(t)`）してから補完ソースを構築する。未対応言語は i18next の `fallbackLng` により既定言語へフォールバック（Req 7.2）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `@codemirror/autocomplete` 補完ソース統合（採用） | emoji と同じ補完エンジンに slash ソースを統合 | フィルタ/キーボード操作/ポップアップ/閉じる挙動が標準で得られる。emoji と確実に共存 | 既存 emoji 拡張のエクスポート形を refactor する必要 | 既存実績パターンに整合 |
| 独立カスタムウィジェット | 自前のポップアップ UI と入力監視 | UI を自由に制御 | 実装/保守コスト大、emoji との干渉やキーボード操作の再実装が必要 | 不採用 |

## Design Decisions

### Decision: 補完ソースを単一 `autocompletion()` に統合する
- **Context**: emoji と slash の共存（Req 6.2）。
- **Alternatives Considered**:
  1. slash を別の `autocompletion()` として追加 — override 競合のリスク。
  2. 両ソースを 1 つの `autocompletion({ override: [...] })` に統合 — 確実に共存。
- **Selected Approach**: emoji 補完ソース/レンダラを切り出し、`use-default-extensions.ts` で slash ソースと合わせて 1 つの `autocompletion()` に登録する。
- **Rationale**: CodeMirror の補完は単一設定での複数ソース運用が前提。
- **Trade-offs**: `emojiAutocompletionSettings.ts` の公開形を変更する（後方互換のため source/render を named export として追加）。
- **Follow-up**: emoji 補完の既存挙動が回帰しないことを確認（テスト/スモーク）。

### Decision: コマンドをデータ駆動のレジストリで宣言し、executor は集合を入力として受け取る
- **Context**: coding-style「Executors take their work-set as input」「Data-Driven Control」。
- **Selected Approach**: `slash-command-definitions.ts` をコマンド集合の単一ソースとし、補完ソース（executor）は解決済みコマンド配列を引数で受け取る。コマンド追加は定義ファイルへのデータ追加のみで完結。
- **Rationale**: 将来の拡張要素追加が executor を変更せずに済む。ドリフトテストも同じ定義を読める。
- **Trade-offs**: なし（小さな間接化のみ）。

### Decision: 挿入は純粋ビルダー + 単一トランザクション
- **Context**: undo 粒度（Req 3.5）と挿入の決定性（Req 3.2/3.3/3.4）。
- **Selected Approach**: 各コマンドが `buildInsertion(view, from) => SlashInsertion`（`{ insert, cursorOffset }`）を提供。`apply` が `/query` 置換（削除+挿入）を単一の change `{ from, to, insert }` として 1 トランザクションで発行。
- **Trade-offs**: 既存 toggle 系 pure 関数の直接流用はしない（プレフィックス文字列の知識はツールバーと概念的に共有）。将来、共有ビルダーへ統合する余地あり。

## Risks & Mitigations
- **emoji 補完の回帰** — emoji ソース切り出しの refactor で既存挙動を壊す恐れ。→ emoji の既存テスト維持＋統合後のスモーク確認。
- **協調編集との整合** — 挿入が Yjs 同期と齟齬を起こす恐れ。→ 通常の `view.dispatch` トランザクションとして実行し、特別な DOM 直接操作を避ける（Req 6.3）。
- **言語の実行時切替** — フックでラベル解決するため、表示言語を実行中に切り替えると再構築が要る。→ MVP では初期化時の言語で解決。実行時切替は再マウントで反映（許容）。

## References
- `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts` — 参照パターン
- `packages/editor/src/client/stores/use-default-extensions.ts` — 拡張登録点
- `packages/editor/src/client/services-internal/markdown-utils/` — プレフィックス挿入の既存実装（概念参照）
- `@codemirror/autocomplete` — `autocompletion`, `CompletionSource`, `Completion.apply`

---

# Gap Analysis（`/kiro-validate-gap`、設計後の整合検証）

> 設計（design.md）確定後に実行。既存コードとの統合前提を事実確認し、残ギャップ・リスクを明示する。

## 検証済みの事実（コードベース実機確認）
- **emoji 実装の現状形**: `emojiAutocompletionSettings.ts` は `autocompletion({ addToOptions:[{render,position}], icons:false, override:[emojiAutocompletion] })` を**完成済み Extension としてエクスポート**。補完ソース関数 `emojiAutocompletion` と `render` は**モジュール内で非公開**。
- **登録点の現状形**: `use-default-extensions.ts` の `defaultExtensions` は**モジュールレベル const 配列**で、`emojiAutocompletionSettings` を要素に含み、`useDefaultExtensions(editor)` が `appendExtensions([defaultExtensions])` を1回呼ぶだけ。`useTranslation` は未使用。
- **トリガー検出の既存手法**: emoji は `syntaxTree(state).resolveInner(pos,-1)` で直前ノードを取り、`textBefore` を正規表現照合し `from = node.from + match.index`。スラッシュの行頭判定はこれと異なる（行頭からの相対位置を見る）必要がある。
- **挿入 pure 関数の所在**: `markdown-utils/insert-line-prefix.ts`・`toggle-markdown-symbol.ts`、`table/insert-new-row-to-table-markdown.ts`、`services/.../editor-shortcuts/make-text-code-block.ts` いずれも実在（ただし「空テーブル新規挿入」関数は無し）。
- **i18n リソース**: `apps/app/public/static/locales/en_US/translation.json` と `ja_JP/translation.json` が実在（ディレクトリ名は `en_US`/`ja_JP`）。
- **依存バージョン**: `@codemirror/autocomplete ^6.18.4` が `packages/editor` と `apps/app` 双方に存在 → **新規依存ゼロ**。
- **テスト規約**: `insert-line-prefix.spec.ts`/`toggle-markdown-symbol.spec.ts` が `@vitest-environment jsdom` + `EditorState`/`EditorSelection`/`EditorView` 構築 + `view.state.doc.toString()` 検証の規約を確立済み。

## Requirement-to-Asset Map（ギャップタグ: Missing / Unknown / Constraint）

| Req | 必要技術要素 | 既存資産 | ギャップ |
|-----|-------------|----------|----------|
| 1.1, 1.2 | 行頭/空白直後 `/` トリガー検出 | emoji の CompletionContext パターン | **Missing**: 直前が行頭/空白かの判定（単語途中は除外）。行中発火時はブロックを改行挿入（3.6） |
| 1.3, 7.1, 7.2 | ラベル/説明の i18n 解決 | react-i18next、locale JSON | **Missing**: `slash_command.*` キー、解決関数。**Constraint**: 拡張は非React→フックで解決し注入 |
| 1.4, 3.1, 4.1, 4.2 | ハイライト/矢印/Escape/blur | `@codemirror/autocomplete` 標準 | なし（標準挙動で充足） |
| 2.1–2.4 | query フィルタ（label+keyword, 大小無視） | autocomplete の filter | **Constraint**: keyword 照合のため `filter:false`+自前照合 |
| 3.2, 3.5 | `/query` 削除+挿入を単一transaction | 既存 pure 関数は各自 dispatch | **Missing**: 単一transaction合成（`apply`）と純粋ビルダー |
| 3.3, 5.2, 5.3 | 行頭マーカー/コードブロック/空テーブル挿入 | prefix/codeblock の既存ロジック | **Missing**: 空テーブル生成。既存 toggle 関数は意味論差で非流用 |
| 5.1, 5.4 | コマンド集合の宣言 | なし | **Missing**: 定義レジストリ（単一ソース） |
| 6.2 | emoji と共存 | emoji 単独 Extension | **Constraint**: 単一 `autocompletion()` へ統合（emoji refactor） |
| 6.1, 6.4 | グローバル `/`・キーバインド不変 | hotkeys / editor-keymaps | なし（`/` をグローバル/keymap にバインドしない方針で充足） |
| 6.3 | 協調編集整合 | Yjs collab（既存） | **Unknown→低**: 通常 transaction なら同期されるが要スモーク確認 |

## 実装アプローチ評価

- **Option A（既存 emoji 拡張を拡張）**: emoji ファイル内に slash も同居。❌ 単一責務崩れ・境界不明瞭・emoji へ影響大。非推奨。
- **Option B（新規 `slash-command/` モジュール + 登録点のみ統合）**: slash のロジックは新規モジュールに分離し、`use-default-extensions.ts` で emoji ソースと統合。✅ 関心分離・テスト容易・境界明確。**design.md はこれを採用**。
- **Option C（ハイブリッド）**: 上記 B に加え、将来 emoji/slash 共通の「補完統合レイヤ」を抽出。MVP では過剰 → 将来拡張で検討。

→ **推奨 = Option B**（設計と一致）。emoji への変更は「source/render を named export に切り出す」最小 refactor に限定する。

## Effort / Risk
- **Effort: M（3–7日）** — 新規モジュール一式 + emoji refactor + i18n キー + テスト。既存パターン踏襲だが統合点が複数。
- **Risk: 低〜中**
  - 低: ライブラリ既存・テスト規約確立・新規依存なし。
  - 中: emoji 統合 refactor の回帰リスク、登録フックへの i18n 導入（再 append 挙動）。

## Research Needed（実装/設計で確認）
1. **i18n 注入と再 append 挙動**: `useDefaultExtensions` に `useTranslation` を入れ `t` 依存の slash 拡張を構築する際、`t` 変化や再レンダーで `appendExtensions` が多重登録/破壊されないか（`Compartment` 再構成 or `useMemo` 安定化が必要か）を確認。
2. **行頭判定の境界**: リストネスト/引用内/インデント行での「行頭」定義（先頭空白のみ許容）の挙動確認。
3. **emoji 共存スモーク**: 統合後に `:` 補完が回帰しないこと、`/` と同時に独立発火することを実機確認（Req 6.2）。
4. **協調編集**: 挿入 transaction が Yjs 経由で正しく同期することのスモーク確認（Req 6.3）。

## 結論
design.md の前提（Option B・単一 `autocompletion` 統合・単一transaction挿入・データ駆動レジストリ・新規依存ゼロ）は**コードベースと整合**。残ギャップは上記4点の確認事項のみで、いずれも実装/検証フェーズで解消可能。設計の修正は不要。

---

# Gap Analysis 差分更新（`/kiro-validate-design` 反映後）

`/kiro-validate-design` の指摘2点を design.md に反映したため、上記 Research Needed の状態を更新する。コードベースの追加調査は発生していない（事実は前回検証分のまま有効）。

## Research Needed の更新状態
1. **i18n 注入と再 append 挙動** → **設計で解消方針確定**。`use-default-extensions（変更）`に「登録機構（多重 append / 破壊の防止）」を追加。MVP は**初期マウント時の言語で1回解決**し再登録を回避、必要時のみ `useMemo([t])` 安定化 + `useEffect` cleanup（`Compartment.reconfigure([])`）で再構成。→ 実装時は採用方針の最終確認とスモークのみ。
2. **行頭判定の境界**（リスト/引用/インデント行） → 未確定。要件確定（行頭=先頭空白を除く行の先頭）に合わせ、リストマーカー/引用記号の直後は MVP では非トリガー。実装時に単体テストで境界を固定。
3. **emoji 共存スモーク** → 変わらず実装/検証時に確認（Req 6.2）。
4. **協調編集の Yjs 同期** → 変わらず検証時にスモーク（Req 6.3）。

## 設計修正による影響（リスク低減）
- **`SlashInsertion` 契約の単純化**（`{ insert, cursorOffset }` + 単一 `{ from, to, insert }` dispatch）により、削除レンジと挿入の重なり/競合リスクが**原理的に消失**。undo 1回復元（Req 3.5）の実装も自明化。
- i18n は初期1回解決方針により、登録フックの複雑性と多重登録リスクが低減。

## Effort / Risk（再評価）
- **Effort: M（3–7日）** — 変更なし。
- **Risk: 低**（前回「低〜中」から低下）— 主要懸念（挿入合成・i18n 再登録）が設計で具体化され、残りはスモーク確認のみ。

## 結論（更新）
設計は検証済み・コードベースと整合し、**実装着手可能**。新たなブロッカーなし。
