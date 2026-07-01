# Research & Gap Analysis: editor-slash-extended-elements

## Summary
- **Feature**: `editor-slash-extended-elements`（アンブレラ `editor-commands` の子スペック）
- **Discovery Scope**: Extension（基盤 `editor-slash-command` への定義追加）
- **Key Findings**:
  - 挿入記法は確定済み: drawio = ` ```drawio ` フェンス、plantuml = ` ```plantuml ` フェンス、lsx = `$lsx(...)`（例 `$lsx(/, num=5, depth=1)`）。
  - 既存ツールバーの drawio 挿入は**モーダル**（`useDrawioModalForEditorActions`）を開く。本スペックはプレーンフェンスを即挿入する方針（モーダルは要件で Out）。
  - **最大の制約**: 基盤 `editor-slash-command` は spec のみで**未実装**（phase: tasks-generated）。本スペックのコマンド定義/ビルダーが乗るレジストリ・補完ソース・`apply`・i18n 解決がまだコードに存在しない。実装順序として基盤の実装（少なくとも公開インタフェースの確定）が前提。

## 検証済みの事実（コードベース実機確認）
- **挿入記法**:
  - drawio: ` ```drawio ` コードフェンス（`remark-drawio`）。
  - plantuml: ` ```plantuml ` コードフェンス（`remark-simple-plantuml`、中身は `@startuml … @enduml`）。
  - lsx: `$lsx()` / `$lsx(/path, num=5, depth=1)` 等（`remark-lsx`）。引数なし `$lsx()` も有効。
- **既存 drawio 導線**: `DiagramButton.tsx` は drawio モーダルを開く（プレーンフェンス挿入ではない）。本スペックの `/drawio` は別挙動（フェンス即挿入）。
- **描画**: drawio/plantuml/lsx の描画は既存 remark/rehype プラグインが担う（本スペックは挿入のみ）。
- **基盤の状態**: `editor-slash-command` は requirements/design/tasks 完成・未実装。設計済みの `SlashCommand` 型・`buildInsertion`・データ駆動レジストリ・単一 `autocompletion()` 統合点が、本スペックの乗り先。

## Requirement-to-Asset Map（ギャップタグ: Missing / Unknown / Constraint）

| Req | 必要技術要素 | 既存/設計資産 | ギャップ |
|-----|-------------|--------------|----------|
| 1.1–1.4 | drawio/plantuml/lsx の挿入コマンドと雛形 | 挿入記法は確定。基盤の挿入ビルダー型 | **Missing**: 各要素の雛形を生成する純粋ビルダー（新規）。**Constraint**: 基盤の `SlashCommand`/`buildInsertion` 契約に従う |
| 1.5 | 未選択要素を出さない | コマンドはデータ宣言 | なし（定義に含めないだけ） |
| 2.1–2.3 | `/query`置換・単一transaction・undo・カーソル | 基盤の `apply`（設計済み・**未実装**） | **Constraint**: 基盤の `apply` をそのまま利用。基盤実装が前提 |
| 3.1–3.3 | 同一メニュー表示・絞り込み・行頭条件 | 基盤の補完ソース/レジストリ（**未実装**） | **Constraint**: 基盤レジストリへコマンドを合流させる必要。合流点の設計が要 |
| 4.1–4.2 | ラベル/説明 i18n・フォールバック | 基盤の `resolveSlashCommands`、locale JSON | **Missing**: `slash_command.*`（拡張要素分）の locale キー |
| 5.1 | 挿入のみ・描画は既存機構 | remark/rehype プラグイン（実在） | なし |
| 5.2 | 絵文字/基本コマンドと共存 | 基盤の単一 `autocompletion()` 統合 | なし（同一レジストリに合流するため自然に共存） |

## 実装アプローチ評価

- **Option A（基盤の定義ファイルに直接追記）**: 基本コマンドと同じ definitions に drawio/plantuml/lsx を足す。✅ 最小手数。❌ 子スペック（別ストーリー）の境界が基盤ファイルに溶け、レビュー/オーナーシップが曖昧化。
- **Option B（独立モジュール + 合流点で結合）＝推奨**: 本スペックは拡張コマンド定義 + ビルダーを**独立モジュール**として持ち、登録レイヤ（`use-default-extensions` 相当）で `[...BASIC, ...EXTENDED]` と結合。✅ 境界が明確で別ストーリー実装に整合。基盤の core 定義は変更不要。
- **Option C（基盤にプラグイン登録 API を新設）**: 基盤が「コマンド集合を外部から受け取る」公式 API を持つ。✅ 拡張に最も堅牢。❌ 基盤側の追加設計が必要で MVP には過剰。将来の拡張要素が増えたら検討。

→ **推奨 = Option B**。依存方向は `extended（定義/ビルダー）→ 基盤の型/ヘルパー`、結合は登録レイヤが担い、基盤 core は extended を知らない（依存逆転を回避）。

## Effort / Risk
- **Effort: S（2–3日）** — 3要素のビルダー + 定義 + locale キー + テスト。記法既知・基盤パターン踏襲で小さい。**ただし基盤 `editor-slash-command` 実装が前提**（未実装なら別途その工数）。
- **Risk: 低** — 既知記法・新規依存なし・確立パターン。唯一の注意は基盤との**実装順序依存**と、コマンド集合の**合流点**設計。

## Research Needed（設計フェーズで確定）
1. **コマンド集合の合流点**: 拡張コマンドを基盤レジストリへ合流させる方法（登録レイヤでの concat か、基盤のコマンド受け取り API か）。依存逆転を避ける形を確定（roadmap の "Shared seams to watch" と整合）。
2. **lsx 雛形の既定**: `$lsx()` のみ挿入してカーソルを括弧内に置くか、`$lsx(/)` などパス入力を促す形にするか（UX 判断）。
3. **plantuml 雛形**: 空フェンスのみか、`@startuml` / `@enduml` を含めた雛形にするか。
4. **drawio 雛形**: プレーンフェンス即挿入でよいか（既存モーダルとの役割分担の確認）。カーソルはフェンス内へ。
5. **実装順序**: 基盤 `editor-slash-command` の実装（公開インタフェース確定）が前提。並行着手する場合は基盤の `SlashCommand`/`buildInsertion`/レジストリ合流点のインタフェースを先に固定する。

## 結論
記法・描画・パターンはすべてコードベースと整合し、**新規依存ゼロ・低リスク**。本スペック固有の判断は「コマンド集合の合流点」と「各要素の雛形の具体形」の2点で、いずれも設計フェーズで確定可能。最大の前提は**基盤 `editor-slash-command` の実装**であり、別ストーリー実装時の順序として明示する。

---

# Design Synthesis（`/kiro-spec-design` で確定した決定）

Research Needed の各項目を設計で次のとおり確定した（詳細は design.md）:

1. **合流点 → Option B 採用**: 拡張コマンドは独立モジュール `slash-command/extended-elements/` に置き、有効コマンド集合 `[...SLASH_COMMANDS, ...EXTENDED_ELEMENT_COMMANDS]` を1箇所で合流させる。基盤 core は拡張を import しない（依存逆転なし）。拡張が増えたら合流を単一集約モジュールへ集約し `use-default-extensions` のロジック変更を不要に保つ。
2. **lsx 雛形**: `$lsx()`、カーソルは括弧内（オプション入力位置）。
3. **plantuml 雛形**: ` ```plantuml ` フェンス + `@startuml`/`@enduml`、カーソルは中間の空行。
4. **drawio 雛形**: ` ```drawio ` 空フェンス、カーソルはフェンス内。既存モーダル（DiagramButton）とは役割分担（本スペックはフェンス即挿入）。
5. **実装順序**: 基盤 `editor-slash-command` の公開IF（`SlashCommand` / `SlashInsertion` / 合流点）確定が前提。本スペックはこの契約のみに依存。

- **Generalization**: 拡張要素コマンドは基盤の `SlashCommand` の特殊化に過ぎず、基盤インタフェースが自然にカバーする（新抽象を足さない）。
- **Build vs Adopt**: 補完/トリガー/apply/i18n はすべて基盤を adopt。新規に作るのは雛形ビルダーと定義データのみ。
- **Simplification**: `buildInsertion(view, from)` の `view` は雛形が静的なため未使用だが、基盤契約に合わせて引数を保持（独自シグネチャを作らない）。

---

# Gap Analysis 追検証（`/kiro-validate-gap` 再実行・Issue 2 の確定）

設計レビュー（`/kiro-validate-design`）で残った確認事項「lsx 引数なし `$lsx()` の描画妥当性」を実コードで検証した。

## 検証結果: `$lsx()`（引数なし）は正常描画される
- **根拠**: `packages/remark-lsx/src/client/services/renderer/lsx.ts:134-136` — `prefix` が未指定/無効のとき `basePagePath`（**現在ページのパス**）にフォールバックする実装を確認。
  ```
  // set basePagePath when prefix is undefined or invalid
  if (prefix == null || typeof prefix !== 'string') {
    lsxElem.properties.prefix = basePagePath;
  }
  ```
- **結論**: `$lsx()` は「現在ページ配下の一覧」として正常にレンダリングされる。設計の既定雛形 `$lsx()`（カーソル括弧内）は妥当で、**`$lsx(/)` 等への変更は不要**。
- **影響**: `$lsx()`（引数なし）の描画妥当性は確認済み。

> **注（スコープ拡張後の位置づけ）**: 当初は lsx を静的ビルダー `lsxInsertion`（`$lsx()` 雛形挿入）で実装する設計だったが、スコープ拡張により **lsx は設定モーダル**へ変更された（下記「スコープ拡張に伴う追加調査」参照）。本検証結果は引き続き有効で、**lsx モーダルでオプション未指定（全空）時に出力する `$lsx()` が現在ページ配下一覧として正常描画される**ことの裏付けとなる（Req 3.4）。静的 `lsxInsertion` ビルダーは廃止。

## 状態
- 本スペックの残ギャップ・確認事項は解消。残る前提は **基盤 `editor-slash-command` のインタフェース凍結**（design.md「着手前提条件」）のみ。設計修正は不要。

---

# スコープ拡張に伴う追加調査（モーダル起動・callout 初期スコープ化・lsx 設定モーダル）

ステークホルダー要望により、本スペックのスコープを次のとおり拡張した（要望: drawio 等のモーダル起動を含める／callout を初期スコープに入れ tip・warning 等を選べるように／lsx も詳細設定可能なモーダルを作る）。これに伴い実コードを再調査した。

## 追加で検証した事実（コードベース実機確認）

### drawio モーダル（既存・再利用可）
- **トリガーフックは `@growi/editor` 側にある**: `packages/editor/src/states/modal/drawio-for-editor.ts` の `useDrawioModalForEditorActions().open(editorKey)` が atom に `{ isOpened, editorKey }` を立てるだけ。
- モーダル本体は apps/app: `apps/app/src/client/components/PageEditor/DrawioModal/DrawioModal.tsx` が atom を購読し、`useCodeMirrorEditorIsolated(editorKey)`（`packages/editor/src/client/stores/codemirror-editor.ts`）で `EditorView` を取得。
- 書き戻し: `replaceFocusedDrawioWithEditor(editor, xml)`（`apps/app/src/client/components/PageEditor/markdown-drawio-util-for-editor.ts`）が ` ```drawio ` フェンスを `editor.dispatch`。既存ブロック内なら置換、なければカーソル位置に挿入。
- **結論**: packages/editor から `open(editorKey)` を呼べばモーダルが起動し挿入もモーダルが行う。**apps/app への逆依存なし**で `/drawio` をモーダル起動にできる。ツールバー `DiagramButton` は `editorKey` を prop で受けて同フックを呼ぶ（合成点の `editorKey` 取得経路の参考）。

### lsx（設定モーダルは新規。オプション仕様は確定）
- 設定 UI は**存在しない**（記法のみ）。drawio パターンに倣い新規作成する。
- オプション（`packages/remark-lsx`）:
  - `prefix`（位置指定パス。`prefix=` 明示も可）。既定は現在ページパス（renderer フォールバック）。
  - `num`: 整数 or 範囲（`10` / `2-5`）。
  - `depth`: 範囲（`1` / `1-2`）。
  - `sort`: `path` | `createdAt` | `updatedAt`（既定 `path`）。
  - `reverse`: `true`/`false`（既定 false）。
  - `filter` / `except`: 正規表現文字列。
- 文字列形式: `$lsx(/path, num=10, depth=1-2, sort=createdAt, reverse=true, filter=^x, except=y)`。全空は `$lsx()`。
- 不正値の検出はサーバ側 list-pages のバリデーションが担う（本スペックはフォーム→文字列生成のみ）。

### callout（対応済み・初期スコープへ）
- 記法: `:::type[label]` … `:::`（remark-directive、`apps/app/src/features/callout/services/callout.ts`）。GitHub 風 `> [!NOTE]` も `remark-github-admonitions-to-directives` で同等に変換。
- 7 種: note / tip / important / info / warning / danger / caution（真実源 `apps/app/src/features/callout/services/consts.ts`）。
- 挿入は**静的テキストで足りる**（モーダル不要）。種別選択は「種別ごとのスラッシュコマンド」をデータ駆動で生成して実現（フラットな補完メニューに submenu 機構はないため）。
- 変種の真実源は apps/app だが、packages/editor は apps/app を import できない → 変種リストを packages/editor 側に宣言し drift に注意（両者更新）。

## 設計上の重要な帰結: 基盤アクションモデルの一般化（前提ゲート）
- 基盤の `SlashCommand` は `buildInsertion`（静的テキスト挿入）専用で、**モーダル起動という副作用を表現できない**。
- → 基盤のアクションを `SlashCommandAction = insert | run` の判別共用体へ一般化する必要がある（基盤の所有。本スペックの実装前提ゲート）。`run` は基盤 `apply` が `/query` 削除後に呼ぶ汎用副作用フックで、基盤は drawio/lsx を知らない。
- drawio/lsx の `run` は React フックでモーダルオープナー + `editorKey` を束縛して生成するため、コマンド集合の**合成点が静的配列から React フック合成へ変わる**（基盤の合成点も React レイヤである前提）。

## 実装アプローチの更新
- **drawio**: 既存モーダルを再利用（`run` → `open(editorKey)`）。プレーンフェンス即挿入は廃止（モーダル起動が要望）。
- **lsx**: 新規設定モーダル（`run` → 新規 `open(editorKey)`）。editor 側トリガーフック + apps/app 側 UI + `$lsx` ビルダー + 書き戻しユーティリティ。
- **plantuml**: 変更なし（`insert`、フェンス雛形）。
- **callout**: `insert`、`CALLOUT_VARIANTS` から7コマンドをデータ駆動生成（`:::type` 記法、カーソルは本文行）。

## Effort / Risk（更新）
- **Effort: M（lsx 設定モーダル新規 + 基盤アクションモデル一般化を含むため S→M）**。drawio は既存再利用で小、plantuml/callout は静的挿入で小、lsx モーダルが最大の新規。
- **Risk: 中**。基盤アクションモデル変更（基盤スペックにも反映が必要）と合成点の `editorKey` 配線が主リスク。callout 変種の真実源 drift は drift テスト/コメントで緩和。
