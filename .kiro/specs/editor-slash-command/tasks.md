# Implementation Plan

- [x] 1. 基盤: 型とコマンド定義

- [x] 1.1 コマンドと挿入内容を表す共通型の基盤を整備
  - スラッシュコマンドと、解決済みコマンド、挿入内容（`/query` を置換するテキスト + `from` 相対カーソルオフセット）を表す型を定義する
  - コマンドのアクションを判別共用体 `SlashCommandAction = SlashInsertAction { kind:'insert'; buildInsertion } | SlashRunAction { kind:'run'; run }` で定義し、`SlashCommand` は `action` を持つ。MVP の全コマンドは `insert`。`run`（副作用起動）は子スペック `editor-slash-extended-elements`（drawio/lsx モーダル）が用いる共有 seam
  - 挿入は絶対位置を持たず「テキスト + カーソルオフセット」だけで表現できることを型で保証する
  - 観測: 型がモジュールから公開され、後続のビルダー/ソースが参照できる。`insert`/`run` の両アクションが型で表現される
  - _Requirements: 5.1_
  - _Boundary: slash-command-types_

- [x] 1.2 ブロック要素の挿入内容を生成する純粋ビルダーを実装
  - 行頭マーカー（見出し H1–H3 / 箇条書き / 番号付き / タスク / 引用）、空コードブロック、2 列の空 Markdown テーブル（ヘッダ + 区切り + 1 ボディ行）の挿入テキストとカーソル位置を生成する
  - `from` が行頭か行の途中（先行する非空白テキストあり）かを判定し、行の途中なら要素種別に応じた区切りを前置して新しい行に挿入する（先行テキストを壊さない）。区切りは描画規則に従い、テーブル/コードブロックは空行（`\n\n`）、見出し/リスト/引用は単一改行（`\n`）
  - 副作用を持たない（エディタへ直接 dispatch しない）
  - 観測: 各ビルダーが期待する挿入テキストとカーソルオフセットを返し、行中発火時は要素種別に応じた区切りが前置されること（特にテーブルは空行で表として描画されること）を単体テストで確認（jsdom + EditorState/EditorView）
  - _Requirements: 3.3, 3.4, 3.6, 5.2, 5.3_
  - _Boundary: insertion-builders_

- [x] 1.3 提供コマンド集合を単一ソースとして宣言
  - 見出し H1–H3 / 箇条書き / 番号付き / タスク / 引用 / コードブロック / テーブルを、ラベル・説明の i18n キー、絞り込みキーワード、対応する挿入ビルダーとともにデータとして宣言する
  - 拡張要素（drawio / math / lsx / テンプレート）は含めない
  - 観測: コマンド集合が公開され、9 種が定義されること・拡張要素が含まれないことをテストで確認
  - _Requirements: 5.1, 5.4_
  - _Boundary: slash-command-definitions_

- [x] 2. コア: ラベル解決と補完ソース

- [x] 2.1 (P) コマンドラベルの多言語解決とロケールキー整備
  - i18n キーを表示文字列（ラベル・説明）に解決する純粋関数を実装する
  - GROWI がサポートする全ロケール（`en_US` / `ja_JP` / `fr_FR` / `ko_KR` / `zh_CN`）に `slash_command.*` キーを追加し、未対応言語は既定言語へフォールバックする
  - 観測: 解決後に各コマンドへ label/description が付与され、未知キーで既定言語が返るテストが green。全ロケールで 9 コマンド分の label/description が揃っている
  - _Requirements: 1.3, 7.1, 7.2_
  - _Boundary: resolve-slash-commands, locale files_
  - _Depends: 1.3_

- [x] 2.2 (P) スラッシュ補完ソース（トリガー・フィルタ・適用）を実装
  - `/` の直前が行頭（先頭空白のみ）または空白文字のときに発火し、空白以外の文字の直後（単語の途中、例 `foo/`）では発火しない
  - `/` 以降の入力でラベル/キーワードを大文字小文字を無視して絞り込み、一致なしではメニューを閉じ文書を変更しない。Escape / フォーカス喪失 / 空白入力でも文書を変更しない
  - 選択時は `action.kind` で分岐する。`insert` は `/query` を置換する単一 change を 1 トランザクションで発行しカーソルを続行入力位置へ置く（直後の undo 1 回で元に戻る）。`run` は `/query` 削除の単一 change を発行後に `action.run(view, from)` を呼ぶ（副作用＝モーダル起動等。基盤は run の中身を知らない）
  - 挿入は通常の `view.dispatch` トランザクションとして発行する（協調編集の同期経路と整合）
  - 観測: トリガー判定（行頭/空白直後で発火・単語途中で非発火）、絞り込み、`insert` の apply 後の文書・選択・undo、`run` の apply 後に `/query` のみ削除され `run` が呼ばれること、空白での非挿入を検証する単体テストが green
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 6.3_
  - _Boundary: slash-command-source_
  - _Depends: 1.1, 1.2_

- [x] 3. 統合: 絵文字補完との統合と登録

- [x] 3.1 (P) 絵文字補完のソース/レンダラを再エクスポート形に切り出し
  - 絵文字補完の補完ソースと描画オプションを個別に参照できる形で公開する（ロジックは変更しない）
  - 観測: 既存の絵文字補完の挙動が従来どおりで、補完ソースと描画オプションを個別に参照できる
  - _Requirements: 6.2_
  - _Boundary: emojiAutocompletionSettings_

- [x] 3.2 スラッシュと絵文字を単一の補完設定に統合してエディタへ登録
  - 解決済みコマンドからスラッシュ補完ソースを構築し、絵文字のソース/描画オプションと合わせて 1 つの補完設定に統合して登録する
  - `/` をグローバルホットキーやキーマップにはバインドしない（エディタ入力中のみ発火）
  - 多重登録/破壊を防ぐ登録機構を採用する（ラベルは初期マウント時の言語で 1 回解決し、必要時のみ cleanup 付きで再構成）
  - 観測: エディタ起動時に `/` と `:` の両補完が独立に機能し、既存キーバインドとグローバル `/` 検索が従来どおり動作する
  - _Requirements: 6.1, 6.2, 6.4, 7.1_
  - _Depends: 2.1, 2.2, 3.1_
  - _Boundary: use-default-extensions_

- [x] 4. 検証

- [x] 4.1 統合スモークと回帰確認
  - 実アプリで `/` 入力 → 絞り込み → Enter で要素挿入（テーブル含む、カーソルが先頭セルに来る）を確認する
  - 行の途中（`あいうえお /table` 等、空白直後）で発火し、ブロック要素が新しい行に挿入され（テーブルは空行を確保して表として描画）先行テキストが壊れないことを確認する
  - Escape で `/` テキストが残りメニューが閉じること、`:` 絵文字補完が非回帰であること、協調編集中の挿入が同期されることを確認する
  - 観測: 上記シナリオが手動スモークで再現し、`turbo run lint/test/build --filter @growi/app` 相当が green
  - _Requirements: 1.1, 2.1, 3.2, 3.3, 3.6, 4.1, 6.2, 6.3_
  - _Depends: 3.2_

- [x] 5. 構造上の文脈に応じたコマンド絞り込み（試用フィードバック, Req 8）

- [x] 5.1 コマンドに文脈除外データを追加し、補完ソースで文脈判定して絞り込む
  - `SlashCommand` に `disallowedIn?: readonly ('list'|'table')[]` を追加。heading1-3/table/codeBlock は `['list','table']`、bulletList/numberedList/taskList/quote は `['table']` のみを宣言する（リスト項目内に収まらないものが前者）
  - `slash-command-source` に、`isInCodeContext` と同型の「syntax tree 親チェーンを辿る」判定（`activeContextsAt`）を追加し、`ListItem` / `Table`・`TableRow`・`TableCell`・`TableHeader` ノードの有無から現在の文脈を求める。クエリ照合の前に `disallowedIn` と現在の文脈の積が空でないコマンドを除外する
  - コードコンテキスト（メニュー自体を非表示）とは異なり、list/table 文脈は**メニューは開いたまま該当コマンドのみ除外**する
  - 観測: フィルタ機構は `disallowedIn` の形ごとの合成コマンドで検証（list+table 制限は list 内で除外、table のみ制限は list 内で残る、未宣言はどこでも残る）。実コマンドがどの形を持つかは `slash-command-definitions` の契約テストで固定（リスト内に残るのはリスト系と引用のみ）
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: slash-command-types, slash-command-definitions, slash-command-source_

- [x] 5.2 リストマーカーのみの行でコマンドが項目の内側で働くようにする（試用フィードバック, Req 9）
  - `SlashInsertion` に `replaceFromOffset`（`<= 0`、既定 `0`）を追加し、`apply` が `from + replaceFromOffset` を置換起点にする。相対オフセットのままなので position-free の原則は維持され、ChangeSpec を組むのは引き続き `apply` のみ・単一 change なので undo も 1 回
  - `insertion-builders` に「行の内容がリストマーカーのみか」を判定する `bareListMarkerOffsetAt` を追加し、該当時はマーカー開始位置への相対オフセット、非該当時は `null` を返す
  - `lineMarkerInsertion(marker, listItemBehavior?)` に振る舞いをデータで渡す。`convert`（リスト系）は既存マーカーを置換レンジに吸収して置換、`append`（引用）は区切りを前置せず同一行に付加。コードブロックはリスト固有の分岐を持たず、かつリスト文脈では候補から除外する（Req 8.1）
  - この時点では、マーカー以外の本文がある行・通常の文章中は Req 3.6 の既存挙動のまま（本文のある行はのちに 5.5 で扱う）
  - 観測: `apply` と同じ合成で結果ドキュメントを検証（`  - /`＋番号付き → `  1. `、`- /`＋引用 → `- > `、`- [ ] /`＋箇条書き → `- `）。非リスト位置の回帰も固定。ミューテーションチェック（`convert` の範囲拡張を無効化）で該当テストのみ RED になることを確認済み
  - _Requirements: 8.1, 9.1, 9.2, 9.3, 9.4_
  - _Boundary: slash-command-types, insertion-builders, slash-command-definitions, slash-command-source_
  - _Depends: 5.1_

- [x] 5.3 説明文の代わりに Markdown 記法をヒントとして表示する（試用フィードバック, Req 10）
  - `SlashCommand` に `syntaxHint?: string` を追加し、単一行マーカーで表現できる7コマンド（heading1-3 / bulletList / numberedList / taskList / quote）に宣言する。記法は表示言語によらず同一なのでロケールファイルには置かない
  - 補完の `detail` は「`syntaxHint` があればそれ、なければ説明文、どちらも無ければ未設定」の順で解決する。i18next は空値のキーで `''`、欠損キーでキー文字列自体を返すため、そのどちらも補助テキストとして表示しない
  - 全ロケールの `slash_command.*.description` は空文字にする。コードブロック・テーブルにも説明文は書かない（ラベルだけで自明であり、「説明しすぎ」という FB の主旨に反するため — Req 10 AC 3 の判断根拠を参照）。`descriptionKey` と解決経路は温存するので、必要になればロケールに文面を書くだけで表示できる
  - 観測: `syntaxHint` の宣言内容を契約テストで固定（codeBlock/table は持たないことも）。`detail` の解決順（記法ヒント優先 / 空文字で未設定 / キー文字列で未設定）を単体テストで確認
  - _Requirements: 1.3, 10.1, 10.2, 10.3, 10.4_
  - _Boundary: slash-command-types, slash-command-definitions, slash-command-source, locale files_

- [x] 5.4 コードレビュー指摘の修正（PR #11655）
  - 文脈判定の取りこぼしを修正: テーブルは行頭パイプ必須をやめ「行内にセル区切り `|` があること」に変更（GFM のパイプ省略テーブルのセルが無防備だった）。リストはマーカー行に加えて、**最も内側のリスト項目の内容カラム以上にインデントされた行**も `list` 文脈として扱う（`- foo` の次行を字下げした位置が無防備だった）
  - セルフレビューで判明した副作用も修正: 最初は「インデントされていれば `list`」としたが、Enter が `insertNewlineAndIndent` で現在行のインデントを再現するため、ネストしたリストでは Enter を何回押しても字下げが残り、見出し/テーブル/コードブロックへ到達する手段が消えていた。閾値を内容カラムにすることで、`  - b` の次行（列2 < 内容カラム4）は「項目を出た」と判定される
  - リストマーカー正規表現の二重定義を解消: `list-line-patterns.ts` に共有ソースを置き、補完ソースの「リスト行判定」とビルダーの「ベアマーカー判定」を同じ定義から導出する（片方だけ更新するとフィルタは通すのにビルダーが変換しない無音デグレになるため）
  - Req 9 のテストを本番経路へ寄せる: `apply` の dispatch を再実装していたヘルパをやめ、実際の補完ソースの `apply` を通す。これにより `replaceFromOffset` を無視する変異が検出できるようになった（従来は 81 テスト全部が素通りしていた）
  - `detail` 解決を堅牢化（上記 5.3 のキー文字列ガード）
  - 観測: 新規ガードそれぞれにミューテーションチェックを実施し、該当テストのみ RED になることを確認
  - _Requirements: 8.1, 8.2, 9.1, 10.4_
  - _Boundary: list-line-patterns（新規）, slash-command-source, insertion-builders_
  - _Depends: 5.1, 5.2, 5.3_

- [x] 5.5 本文のあるリスト行で挿入がリストを抜けないようにする（コードレビュー #7, Req 9.5）
  - `markdown-context.ts`（新規）に「囲っている `ListItem` の幾何情報」を集約する: 構文木で `ListItem` を特定し、**その項目のマーカー行**から兄弟用プレフィックス（そのまま再現）・項目内用プレフィックス（内容カラムまで空白で詰める）・内容カラムを求める。マーカー部分だけを空白化するので `> ` は保たれる。内容カラムはマーカー直後の空白すべてを含め、タブはタブストップ幅（4）で数える
  - `lineMarkerInsertion` に、ベアマーカーでもない**リスト項目内**の分岐を追加。`convert`（リスト系）は兄弟用、`append`（引用）は項目内用を使って改行後に前置する
  - 補完ソースの `isInListItem` も同じ幾何情報を使うようにし、内容カラムの計算を1箇所へ寄せる（従来はソース側が「マーカー＋空白1文字」前提で、複数空白やタブを取りこぼしていた）
  - カーソル行ではなく**項目のマーカー行**を基準にするのが要点。継続行（`- foo` の次行 `  bar /`）はマーカーを持たないため、カーソル行から導出すると列0に落ちてリストを抜ける
  - 観測: `- foo /`＋引用 → `- foo \n  > `、`  - foo /`＋番号付き → `  - foo \n  1. `、継続行 `- foo\n  bar /`＋引用 → `…\n  > `、`-   foo /`・`-\tfoo /`＋引用 → 内容カラム4、`> - foo /` で引用マーカー保持。非リスト位置は既存挙動のまま。ミューテーションチェック5種（分岐削除 / 常に兄弟用 / 常に項目内用 / 幾何をカーソル行から / タブ展開なし）で該当テストのみ RED を確認
  - ビルダーが構文木を読むようになったため、`insertion-builders.spec.ts` の `createView` に markdown 拡張を追加（本番は必ず言語が載っているので、載せない構成でのテストは本番を再現していなかった）
  - _Requirements: 9.5, 9.6_
  - _Boundary: markdown-context（新規）, list-line-patterns, insertion-builders, slash-command-source_
  - _Depends: 5.2, 5.4_

## Implementation Notes
- 3.2: `appendExtensions(args)` wraps EVERY top-level element of `args` with the SAME `Compartment` (`services/.../utils/append-extensions.ts`), and a Compartment can wrap only one extension. So the default set MUST be passed as a single nested element (`[[...all]]`); a flat multi-element array throws `RangeError: Duplicate use of compartment in extensions` at runtime (only surfaced when the editor mounts — build/typecheck/unit pass). Encoded via `buildDefaultExtensionsArg` + regression test. Found during 4.1 smoke.
- 1.2: insertion-builders decide line-start vs mid-line purely from **same-line** preceding non-whitespace text (Req 3.6 wording). The design's cross-line nuance (table on a fresh empty line directly below a non-empty paragraph → also needs a blank line) is intentionally NOT handled by the builders — the typical `/` trigger hits the mid-line path. Verified during smoke: GROWI's renderer (remark-gfm) still renders a table directly below a paragraph, so no blank line is required in practice — non-issue.
- 2.2: autocompletion filtering — the completion result must NOT set `validFor` while `filter: false`; otherwise CodeMirror keeps the initial option set without re-querying and the menu never narrows. Matching is prefix (`startsWith`) over the command **id** + localized **label** + keywords, so `/table` (English id) works in any display language and `/テ` (localized label) works too, while mid-word keyword hits (e.g. "citation" for `/ta`) are excluded. Covered by a live autocomplete-plugin integration test.

### Follow-up (deferred, minor — from code review; not blocking)
- 5: `useDefaultExtensions` memoizes the completion extension on `[t]` and registers it together with the static extensions, so a change to `t` (UI language switch) tears down and re-appends the WHOLE default set (lineWrapping/markdown/keymaps/highlighting), not just the completion. Fix: register static extensions once and the t-dependent completion separately.
- 6: the unified `autocompletion` applies `addToOptions: [emojiRenderOption]` to ALL options, so emoji's glyph renderer runs for slash options too and emits an empty `<span>` (no `type`). Fix: return `null` from the renderer when there is no emoji.
- 7: mid-line insertion does not absorb the single space before `/`, leaving a trailing space on the preceding line (`abc /h1` → `abc \n# `). Fix: include the single space immediately before `/` in the replaced range.
- Investigated and dismissed as non-issues: code-context suppression inside language-annotated fenced blocks (```js) works (parent chain reaches FencedCode); table directly below a paragraph renders (remark-gfm); fixed gray-800/gray-600 menu colors remain legible in dark mode.
- 5.1: `markdownLanguage` from `@codemirror/lang-markdown` already configures the GFM extension (`Table`/`TaskList`/etc.) by default, so `ListItem`/`Table`/`TableCell` node detection works without any extra parser config — confirmed by reading the package source, not assumed.
- 5.2: keeping `quote`/`codeBlock` offered inside a list (the 5.1 decision) was only half the story — with the original builders they still emitted an unindented block that escaped the list (`- /` + quote produced `- ` + newline + `> `). Verified empirically against the real source before changing anything. Req 9 fixes the insertion side rather than hiding the commands, so the 5.1 filtering matrix stays as-is.
- 5.2: an earlier revision DID nest the code fence inside the list item (indenting the content line and closing fence to the item's content column). That was reverted on review feedback — a fence is easier to edit as its own block, so `codeBlock` carries no list-specific branch. The `bareListMarkerOffsetAt` helper was reduced to returning just the offset once the continuation-indent it also computed became unused.
- 5.1/5.2 (order matters): once the fence stopped being nested, leaving `codeBlock` offered inside a list produced the worst of both — it broke out of the list AND left an empty `- ` marker behind, i.e. exactly the structural damage Req 8 exists to prevent. So `codeBlock` moved to `disallowedIn: ['list','table']`, joining heading/table. The rule that fell out: **a command may stay offered in a list only if it acts within the item** (list types convert the marker, quote appends to the same line).
- 5.4 (context detection, both directions): the "tree AND line must agree" rule has to be tuned per structure, and the first cut was wrong in both. Tables: GFM lets rows omit the outer pipes, so requiring a LEADING `|` left `a | b` / `--- | ---` / `c | /` cells unprotected — the line just has to contain a separator. Lists: a continuation line carries no marker of its own, so requiring one left `- foo` + newline + indented `/` unprotected — an indented line inside a `ListItem` counts too. The unindented, separator-less case stays excluded on purpose: that is how a user leaves the structure, and treating it as inside would empty the menu.
- 5.4 (why the shared pattern module): the source's "is this a list line" check and the builders' "is this a bare marker" check are different questions over the SAME grammar. Keeping two literals in sync by convention had already drifted (`[ \t]+` vs `\s`), and the failure is silent — the menu offers a conversion the builder then declines. `list-line-patterns.ts` derives both from one marker source so they cannot disagree.
- 5.4 (test through the production path): the Req 9 tests originally re-implemented `apply`'s dispatch in a local helper. That helper computed `replaceFromOffset` itself, so mutating the real `applyCommand` to ignore it left all 81 tests green — the feature's core could be deleted undetected. Driving the real completion source's `apply` instead makes that mutation fail 5 tests. Lesson: a helper that re-derives what production derives is not a test of production.
- 5.3/5.4 (empty descriptions are a scaffold, not dead data): the 45 empty `slash_command.*.description` values are kept deliberately — they mark where descriptions will be written and keep the resolution path exercised. i18next returns `''` for them today, and the `detail` resolver additionally ignores a value equal to its own key, so the popup stays clean even if `returnEmptyString` is flipped or an entry is dropped.

### Design notes (from code review)
- 5.1: in a table cell every one of the 9 commands is excluded, so the menu opens with zero options and closes immediately — observationally identical to suppressing it. Filtering (not suppression) is still the right mechanism, because the deferred inline commands (bold / link / inline code) are valid inside a table cell and will simply not declare `table` in `disallowedIn`.
- 5.2: `replaceFromOffset` intentionally stays a RELATIVE offset instead of an absolute `replaceFrom`, so `SlashInsertion` keeps the position-free invariant documented on the type and `apply` remains the only place that builds a ChangeSpec.

### Follow-up (deferred, new-command scope — from usability trial feedback; NOT this spec)
Adding this to `SLASH_COMMANDS` breaks the `toHaveLength(9)` contract test (Req 5.1) and reopens the approved base scope, so it is not implemented here. The decision was pinned down during Req 8's design discussion so a follow-up story can use it directly:
- Bold / link insertion with no active selection (cursor on an empty line, `/` typed): insert empty markers with the cursor placed between them (e.g. bold → `**` + cursor + `**`). Link should compose with `editor-slash-extended-elements`' `run` action reusing the existing `Edit Link Modal` (`useLinkEditModalActions().open(getMarkdownLink(view), onSave)`).

> **Correction**: list-type "convert" was previously listed here as deferred new-command scope. It is now **implemented as Req 9** — existing list commands behave as a conversion inside a list item, so no command is added and the 9-command contract holds. See design.md's Implementation Notes for why the "exclude the current line's own type" refinement was dropped.
