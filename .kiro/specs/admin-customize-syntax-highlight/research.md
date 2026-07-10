# Gap Analysis — admin-customize-syntax-highlight

対象要件: `.kiro/specs/admin-customize-syntax-highlight/requirements.md`

## 1. 現状調査(Current State)

### 対象コンポーネント(3ファイル、いずれも同構造)
- `apps/app/src/client/components/Admin/Customize/CustomizeScriptSetting.tsx`
- `apps/app/src/client/components/Admin/Customize/CustomizeCssSetting.tsx`
- `apps/app/src/client/components/Admin/Customize/CustomizeNoscriptSetting.tsx`

共通パターン:
- `useForm()` の `register()` を **プレーン `<textarea className="form-control" rows={8}>`** に適用。
- `useEffect` 内で `reset({ customizeX: container.state.currentCustomizeX || '' })` により、コンテナ状態を初期値として同期。
- `onSubmit` → `container.changeCustomizeX(value)` → `container.updateCustomizeX()`(既存保存 API)→ 成功/失敗トースト。
- `AdminUpdateButtonRow` は `disabled={container.state.retrieveError != null}`。
- Script / Noscript には折りたたみの "Example for Google Tag Manager" があり、**`react-syntax-highlighter` の `PrismAsyncLight`(oneDark)** で表示(＝これは読み取り専用サンプルで、編集入力ではない)。CSS 欄にはサンプルなし。
- 状態管理は unstated-next の `AdminCustomizeContainer`(`apps/app/src/client/services/AdminCustomizeContainer.js`)。`changeCustomizeX` / `updateCustomizeX` が各項目分存在。保存データは各項目とも **文字列**。

### v5 の実装(復元対象の参照)
- 削除コミット `af9df831dc "delete CustomScriptEditor component and use textarea instead"`(2022-07)。
- v5 `CustomScriptEditor.jsx` は `react-codemirror2`(CodeMirror 5)ベースで、`mode: javascript` / `lineNumbers: true` / `tabSize:2, indentUnit:2` / `theme: eclipse` / `matchBrackets` / `autoCloseBrackets` / `Ctrl-Space` 補完 / jquery-ui リサイズ を持っていた。
- ＝「v5 相当」= このコード編集体験(ハイライト+行番号+括弧支援)の CM6 での復元(補完・jquery リサイズはスコープ外と決定済み)。

### 既存の CodeMirror 6 資産(@growi/editor)
- `@uiw/react-codemirror@^4.23.8`(`packages/editor` の **devDependency**)。実際の利用は **`<CodeMirror>` コンポーネントではなく `useCodeMirror` フック経由**(`packages/editor/src/client/services/use-codemirror-editor/use-codemirror-editor.ts`)。
- `packages/editor` のクライアント資産は Markdown ページ編集特化(`CodeMirrorEditorMain` 等)。**言語非依存の汎用エディタ primitive は公開エクスポートされていない**(root `index.ts` は universal モジュールのみ)。apps/app は `@growi/editor/dist/client/...` の deep path で消費。
- テーマ機構は **名前ベース**(`EditorTheme` 名 → `getEditorTheme()` が動的 import)。単純な light/dark 切替ではなく、`@codemirror/theme-one-dark` 依存も無い。

### テーマ検出フック(apps/app 側の慣習)
- `apps/app/src/stores-universal/use-next-themes.tsx` の `useNextThemes()` が `resolvedTheme: 'light' | 'dark'` と `isDarkMode: boolean` を返す。
- 同ディレクトリの `CustomizeLayoutSetting.tsx` / `CustomizeSidebarSetting.tsx` が既に `useNextThemes().resolvedTheme` を使用 → **踏襲すべき慣習**。

### react-hook-form の慣習
- カスタム(非ネイティブ)入力は `Controller` で包む例あり: `apps/app/src/features/openai/client/components/AiAssistant/AiAssistantSidebar/AiAssistantSidebar.tsx`(`<Controller ... render={({field}) => <ResizableTextarea {...field}/>} />`)。
- あるいは `useController`(`apps/app/src/client/components/Admin/App/FileUploadSetting.tsx`)。
- → CodeMirror は `register()` の `ref`+ネイティブ `onChange` を受けないため、**`Controller`/`useController` への置き換えが必須**。

### テスト
- 3コンポーネントに対する `*.spec.tsx` は **存在しない**(このディレクトリにテストなし)。

## 2. 要件 → 資産マップ(ギャップ)

| 要件 | 必要な技術要素 | 既存資産 | ギャップ |
|---|---|---|---|
| Req1 ハイライト | CM6 + 言語別モード(JS/CSS/HTML) | CM6 は導入済 | **Missing**: `@codemirror/lang-javascript` / `lang-css` / `lang-html` が**未宣言**(推移的には node_modules に存在するが直接依存にない)。`@codemirror/language-data` は apps/app に宣言済(名前で遅延ロード可) |
| Req1/共通 | 再利用可能なハイライト付き入力コンポーネント | 汎用 primitive **なし**(@growi/editor は Markdown 特化) | **Missing**: 新規に作る必要あり。`@uiw/react-codemirror` を apps/app へ直接依存追加(現状 apps/app に未宣言) |
| Req2 行番号/括弧 | lineNumbers / matchBrackets / closeBrackets | CM6 標準(basicSetup / `@codemirror/language`,`commands`) | Low: `@uiw/react-codemirror` の `basicSetup` に含まれる |
| Req3 テーマ追従 | light/dark 切替 | `useNextThemes().resolvedTheme` / `isDarkMode` | **Constraint**: @growi/editor の名前ベーステーマは流用しにくい。`@uiw/react-codemirror` の `theme` prop(`'light'|'dark'`)を `resolvedTheme` で駆動が最小。one-dark 依存は無い |
| Req4 非退行 | 初期値 reset / 保存 API / トースト / retrieveError | 既存 container・`AdminUpdateButtonRow` | Low: `register`→`Controller` 置換のみ。保存経路・データ形式は不変 |
| Req5 周辺UI/一貫性 | サンプル表示・見出し・ボタン維持、3欄一貫 | 既存 UI | Low: 入力欄のみ差し替え。共通コンポーネント化で一貫性担保 |

### Research Needed(設計フェーズへ持ち越し)
- **依存分類(Turbopack)**: 新規追加する `@uiw/react-codemirror` と lang パッケージが production build で `.next/node_modules/` に外部化されるか確認し、`dependencies` か判定(`.claude/rules/package-dependencies.md` の手順)。SSR 実行される admin ページの静的 import 経路になるため `dependencies` の可能性が高い。
- **言語ロード方式の選択**: (a) `@codemirror/lang-*` を3つ直接追加(静的・確定的・tree-shake 可、3言語固定なら素直) vs (b) 既存の `@codemirror/language-data` で名前遅延ロード(依存追加ゼロだが非同期で複雑)。
- **制御コンポーネント時のカーソル維持**: `Controller` で `field.value` を制御値にした際、キーストロークごとの再レンダリングでカーソルが飛ばないか(`@uiw/react-codemirror` は内部で value 差分を扱うが、`reset()` との相互作用を design で確認)。

## 3. 実装アプローチ(Options)

### Option A: apps/app 内に専用の再利用可能エディタを新規作成(`@uiw/react-codemirror` 直載せ)
- 新規に軽量な `CodeMirrorInput`(言語を prop で受け取る)を apps/app に作り、3コンポーネントの `<textarea>` を置換。`@uiw/react-codemirror` と lang パッケージを apps/app の依存へ追加。
- **Trade-offs**: ✅ スコープに対して最小・低リスク・独立テスト容易 / ✅ @growi/editor の Markdown 特化コードに触れない ✅ apps/app 内で完結 / ❌ apps/app に CM 依存が増える(分類確認が必要) / ❌ @growi/editor の資産とは別系統になる

### Option B: @growi/editor に汎用エディタを追加してエクスポートし、apps/app から消費
- パッケージに言語非依存の再利用 primitive を新設し barrel から公開。
- **Trade-offs**: ✅ 将来他所からも再利用可・「共有ハブに置く」設計方針に合致 / ❌ パッケージ公開面の拡張・ビルド順・barrel 設計など作業量大 / ❌ 今回3箇所限定の需要に対して過剰

### Option C: @growi/editor の `useCodeMirror` フック / 内部 base を流用
- 既存の低レベルフックを再利用。
- **Trade-offs**: ✅ 車輪の再発明を避ける / ❌ 内部 base は Markdown 志向(toolbar/paste 等)で言語非依存でない・deep path 依存になり密結合 / ❌ 実質 A と同等の新規実装が必要になり旨味が薄い

## 4. Effort / Risk

- **Effort: S〜M(概ね 2〜4 日)** — 既存パターン(Controller・useNextThemes)に沿うが、共通コンポーネント新設 + 依存追加/分類確認 + 3箇所適用 + テスト新規作成を含む。
- **Risk: Low〜Medium** — 技術は既知(CM6 は社内実績)。リスク源は主に (1) Turbopack 依存分類の誤りによる本番 `ERR_MODULE_NOT_FOUND`、(2) 制御コンポーネント化に伴うカーソル/`reset` 相互作用。いずれも既知の手順・検証で低減可能。

## 5. 設計フェーズへの推奨

- **推奨アプローチ: Option A**(apps/app 内に言語 prop 付きの再利用可能 `CodeMirrorInput` を新設 → 3箇所へ適用)。スコープ(3固定フィールド)に対して過不足なく、@growi/editor の Markdown 特化資産と疎結合を保てる。
- **主要な設計判断**:
  1. 言語ロード: `@codemirror/lang-javascript`/`lang-css`/`lang-html` の直接追加を第一候補(3言語固定・静的で確定的)。
  2. テーマ: `useNextThemes().resolvedTheme` → `@uiw/react-codemirror` の `theme` prop(light/dark)。
  3. react-hook-form: `register` → `Controller`(AiAssistantSidebar パターン)。`reset()` による初期同期は維持。
  4. `basicSetup` で行番号・括弧マッチ/自動閉じを有効化、補完・リサイズは無効/非採用。
- **持ち越し検証項目**: Turbopack 依存分類(`.next/node_modules` チェック)、制御値でのカーソル維持、空文字時の挙動。
- **テスト方針**: 3コンポーネントは現状テストなし。共通コンポーネントの単体(言語別ハイライト付与・onChange 伝播・theme 追従)＋ react-hook-form 連携の非退行(初期値 reset・submit で正しい値が保存経路へ渡る)を新規に用意。

---

## 設計フェーズ 合成結果(Design Synthesis)

- **Generalization**: Req 1〜3・5.1 はいずれも「言語だけ異なる同一のコード編集体験」の変種。3 箇所ごとに CodeMirror 設定を持たせず、`language` prop を受ける単一の `AdminCodeEditor` に一般化。実装スコープは 3 言語に限定しつつ、インターフェース(`CodeEditorLanguage` の追加)で将来拡張可能に保つ。
- **Build vs. Adopt**: CodeMirror(エディタエンジン)・言語ハイライト・行番号/括弧支援・ダークテーマは `@uiw/react-codemirror` + `@codemirror/lang-*` を **Adopt**(実績・保守済み)。`@growi/editor` の既存コンポーネントは Markdown 特化で言語非依存でないため流用せず却下。**Build** するのは統合層(`AdminCodeEditor` と 3 箇所の Controller 化)のみ。
- **Simplification**: パッケージ公開面を広げる Option B、Markdown 志向 base を流用する Option C は却下。apps/app 内の 1 コンポーネント + 3 箇所差し替えに最小化。言語→拡張は分岐ではなくモジュール定数マップ(data-driven)にして consumer 側の特別扱いを排除。テーマは名前ベースの @growi/editor テーマ機構ではなく `@uiw/react-codemirror` の `theme` prop(light/dark)で単純化。

## 設計フェーズ 確定事項(Design Decisions)

- 新規コンポーネント配置: `apps/app/src/client/components/Admin/Common/AdminCodeEditor.tsx`(`AdminUpdateButtonRow` と同階層 = admin 汎用部品)。
- react-hook-form: `register`(ネイティブ input 前提) → `Controller`(制御コンポーネント前提)へ移行。`reset()` 初期同期は維持。
- 補完(autocompletion)は `basicSetup={{ autocompletion: false }}` で無効化。行番号・括弧マッチ/自動閉じは basicSetup 既定のまま有効。
- 依存追加: `@uiw/react-codemirror`, `@codemirror/lang-javascript`, `@codemirror/lang-css`, `@codemirror/lang-html` を apps/app へ。分類(dependencies/devDependencies)は実装時に `.next/node_modules/` で確定。
