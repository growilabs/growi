# Gap Analysis: ai-chat-page-mention

_対象要件: requirements.md (R1〜R7) / 実施日: 2026-06-06_

## 分析サマリ

- **中核の課題**: AI チャット入力欄は現状プレーンな `<textarea>`（フラットな string state）であり、要件が求める「原子的・クリック可能・文字単位編集不可の rich text トークン（メンション）」を表現できない。これが本フィーチャー最大のギャップ。
- **既存資産で再利用できるもの（低リスク）**: ① ページパス検索（`useSWRxSearch` → `/search`、Elasticsearch 権限フィルタ済み）、② debounce 付き typeahead パターン、③ ページ遷移ヘルパ（`LinkedPagePath` + `next/link`）。要件 R7・R1 の検索基盤・R4 の遷移はほぼ揃っている。
- **最大の意思決定ポイント**: 入力欄の rich text 化をどの技術で実現するか。**CodeMirror 6 が既に apps/app の直接依存**（`@codemirror/autocomplete` / `view` / `state`）であり、`Decoration.replace` + `EditorView.atomicRanges` + autocomplete で要件 R1〜R5 をほぼ過不足なく満たせる。新規リッチエディタ（Lexical 等）の導入は不要と判断できる。
- **送信モデルのギャップ**: メッセージは Vercel AI SDK の `UIMessage`（フラットな text）として送信される。要件 R6（パス文字列のみ送信・本文非付与）は、送信時にメンショントークンをパス文字列へ flatten することで満たせる。サーバ側変更は原則不要。
- **テスト/i18n のギャップ**: `ChatSidebar` にはクライアントテストが存在せず、i18n も未適用（ハードコード文字列）。本フィーチャーで新規 UI を足すため、テスト・i18n を新たに用意する必要がある。

---

## 1. 現状調査（Current State）

### 1.1 入力欄コンポーネント（中核の制約）
- `apps/app/src/components/ai-elements/prompt-input.tsx`（自前所有・編集可、Vercel 由来の vendored ではない）
  - `PromptInputTextarea`（876–890 行）が `InputGroupTextarea`（`apps/app/src/components/ui/input-group.tsx:154–168`）= 素の HTML `<textarea>` をラップ。
  - 値は `useState<string>`、`onChange` → `controller.textInput.setInput()`、送信は `handleSubmit`（700–755 行）が `onSubmit({ text, files })` を呼ぶ。
- `apps/app/src/features/mastra/client/components/ChatSidebar/ChatSidebar.tsx`
  - 50–117 行: `input` string state → `sendMessage({ text }, { body: { aiAssistantId, threadId } })`（`@ai-sdk/react` の `useChat`）。
- **制約 (Constraint)**: `<textarea>` は子要素・インラインのインタラクティブ要素・原子的キャレット挙動を持てない。R3/R4/R5 は textarea のままでは実現不可。

### 1.2 メッセージデータモデル / サーバルート
- `apps/app/src/features/mastra/server/routes/post-message.ts:29–33`: `ReqBody = { threadId, aiAssistantId, messages: UIMessage[] }`。
- 57–59 行で `validateUIMessages` による検証、121 行で `growiAgent.stream(messages, ...)`。
- メッセージ内容はフラット text。構造化された「mention part」は現状存在しない。
- **含意**: メンションは送信前にクライアントでパス文字列へ flatten する設計が素直（R6）。サーバ側で特別な参照解決は不要。

### 1.3 検索 API（typeahead）
- `apps/app/src/stores/search.tsx:79–91`: `useSWRxSearch(keyword, nqName, configurations)` → `apiGet('/search', { q, limit, offset, sort, order })`（レガシ v1）。
- レスポンス: `IFormattedSearchResult { data: IPageWithSearchMeta[] }`、各要素に `data.path` / `data._id`。
- **権限フィルタ済み (Asset)**: `apps/app/src/server/service/search-delegator/elasticsearch.ts:995–1039` で grant level（PUBLIC/SPECIFIED/OWNER/USER_GROUP）による `bool.should` フィルタを適用。ログインユーザーの閲覧可能ページのみ返る → R7 を既存挙動で充足。
- debounce 前例: `apps/app/src/client/components/SearchTypeahead.tsx:289`（`AsyncTypeahead delay={400}`）。

### 1.4 既存のメンション / autocomplete / 原子トークン UI
- `@mention` 相当・contenteditable・ProseMirror/Lexical/Slate は **コードベースに存在しない (Missing)**。
- typeahead は `SearchTypeahead.tsx`（`react-bootstrap-typeahead`）と `downshift`（SearchModal 系）が存在するが、いずれもプレーン input 用で原子トークンは扱わない。
- **CodeMirror 6 が直接依存として既存 (Asset)**: `@codemirror/autocomplete ^6.18`, `@codemirror/view ^6.42`, `@codemirror/state ^6.6`（`apps/app/package.json` と `packages/editor` 双方）。マークダウンエディタで利用中だが、`@` トリガ補完やページリンク補完の既存実装は無い（Missing）。

### 1.5 ページ遷移ヘルパ
- `apps/app/src/models/linked-page-path.ts`（`LinkedPagePath.href`）+ `next/link` / `useRouter().push()`。
- 例: `apps/app/src/components/Common/PagePathHierarchicalLink/PagePathHierarchicalLink.tsx:103`。R4 の遷移はこれで充足。

### 1.6 テスト / i18n
- テスト基盤: Vitest + RTL（`*.spec.tsx` 同居）。mastra はサーバ側ツールのテストのみ（例: `full-text-search-tool.spec.ts`）。`ChatSidebar` のクライアントテストは **無し (Missing)**。
- i18n: mastra 他コンポーネントは `useTranslation` 利用（`AiAssistantSubstance.tsx`）。`ChatSidebar` は未適用でハードコード文字列（"AI Assistant" 等）。

---

## 2. 要件 → 資産マップ（Requirement-to-Asset Map）

| 要件 | 必要技術 | 既存資産 | タグ |
|------|----------|----------|------|
| R1 `@` 起動・インクリメンタル検索 | `@` トリガ検出 + 検索呼び出し | `useSWRxSearch` 検索は有／`@` トリガ検出は無 | Asset + **Missing**（トリガ検出） |
| R2 候補リスト UI（キーボード/マウス・loading・該当なし・debounce） | typeahead UI | CodeMirror autocomplete or downshift パターン有／チャット用 UI は無 | Asset + **Missing**（チャット用組込） |
| R3 rich text メンション挿入・視覚区別・原子性 | 原子的インライン widget | CodeMirror `Decoration.replace`+`atomicRanges` で可／既存実装は無 | Constraint + **Missing** |
| R4 クリックでページ遷移 | リンク/遷移 | `LinkedPagePath`+`next/link` | **Asset** |
| R5 編集不可・キャレット境界・削除は単位 | 原子トークン挙動 | CodeMirror `atomicRanges` で可（textarea では不可） | **Constraint** |
| R6 送信はパス文字列のみ・本文非付与 | 送信時 flatten | `UIMessage` フラット text／flatten 実装は無 | Asset + **Missing**（flatten） |
| R7 閲覧権限内ページのみ | 権限フィルタ検索 | Elasticsearch 権限フィルタ済み | **Asset** |

---

## 3. 実装アプローチ案

中核の意思決定は「入力欄の rich text 化技術」。以下は主にその軸での比較。

### Option A: 既存 textarea を維持し、オーバーレイで装飾
- 概要: `<textarea>` の上に同期したハイライト層を重ね、`@xxx` 範囲を装飾表示。
- ✅ 変更が局所的、依存追加なし。
- ❌ **R3/R4/R5 を満たせない**: textarea 内に clickable な子要素を置けず、原子的キャレット境界（R5 AC3）も再現不可。視覚装飾止まりで「独立した原子トークン」要件に不適合。
- 判定: **要件未達のため非推奨**。

### Option B: 専用リッチテキストエディタ導入（Lexical / Tiptap / ProseMirror）
- 概要: チャット入力を contenteditable ベースのエディタへ置換し、mention ノードで実装。
- ✅ メンション体験の表現力は最も高い。
- ❌ 新規の重量級依存を追加（バンドル/SSR 外部化ルール `tech.md` への影響、保守コスト）。GROWI のエディタ技術（CodeMirror）と二重化し構造ルールに反する。
- 判定: 表現力は高いが**コスト過大・既存方針と不整合**。

### Option C（推奨・Hybrid）: CodeMirror 6 ベースのチャット入力に置換
- 概要: `PromptInputTextarea` を CodeMirror 6 ベースの小型入力へ置換（または mastra 配下に新規入力コンポーネントを作成）。
  - **R1/R2**: `@codemirror/autocomplete` の completion source で `@` トリガを検出し、`useSWRxSearch` の結果を候補化（debounce 適用）。キーボード/マウス操作・loading・該当なしは autocomplete 標準挙動＋カスタムレンダリングで対応。
  - **R3/R5**: 確定時に `@query` レンジを `Decoration.replace({ widget })`（メンション widget）へ置換し、`EditorView.atomicRanges` で原子化 → 文字単位編集不可・キャレットは境界のみ・削除は単位、を満たす。視覚区別は widget の CSS。
  - **R4**: widget 内に `next/link`/`router.push` 相当のクリックハンドラ（`LinkedPagePath` でパス→href）。
  - **R6**: 送信時に doc を走査し、メンション widget を対象ページの**パス文字列**へ flatten して `sendMessage({ text })`。本文取得・注入はしない。
- ✅ **新規依存ゼロ**（CodeMirror は既存直接依存）。GROWI エディタ規約に整合。原子トークン要件に最も適合。`packages/editor` の CodeMirror 拡張パターンを参照可能。
- ❌ 小さなチャット欄に CodeMirror を載せる初期実装コスト・autocomplete のスタイリング調整が必要。`prompt-input.tsx` 既存機能（ファイル添付等）との統合に配慮が要る。
- 判定: **推奨**。要件適合度・依存方針・保守性のバランスが最良。

---

## 4. 工数・リスク

| 項目 | 評価 | 根拠 |
|------|------|------|
| 検索/候補（R1・R2・R7） | **S** | `useSWRxSearch`・権限フィルタ・debounce 前例が揃い、CodeMirror autocomplete に接続するだけ。 |
| 原子トークン入力（R3・R5） | **M** | CodeMirror の `Decoration.replace`+`atomicRanges`+widget は確立パターンだが、GROWI 内に前例が無く新規実装。 |
| 送信 flatten（R6） | **S** | doc 走査でトークン→パス文字列化するのみ。サーバ変更不要。 |
| 入力欄置換と既存統合（prompt-input） | **M** | 既存の送信/添付フローとの統合と回帰回避が必要。 |
| **全体** | **M（3〜7 日）／リスク: Medium** | 個々は既知パターンだが「CodeMirror をチャット入力として使う」前例がコードベースに無く、autocomplete の UX/スタイル調整に不確実性。 |

---

## 5. 設計フェーズへの申し送り

### 推奨アプローチと主要な決定事項
- **Option C（CodeMirror 6 ベース入力）を推奨**。設計では以下を確定する:
  1. **入力欄の置換単位**: `PromptInputTextarea` を CodeMirror へ丸ごと置換するか、mastra 配下に専用入力を新設して `ChatSidebar` 側を差し替えるか（既存の添付/送信制御 `controller` との接続方法を含む）。
  2. **メンションのデータ表現**: widget が保持する参照情報（`path` のみか `path`+`_id` か）と、doc ↔ 送信テキストの相互変換規約（R6 の flatten 仕様）。
  3. **autocomplete の起動規則**: `@` の語境界判定（R1 AC4: メールアドレス様の途中 `@` では起動しない）と、空クエリ時の挙動。
  4. **メンション widget の操作性**: クリック遷移とテキスト編集の区別（R4 AC2）、複数メンション（R3 AC4）、削除単位（R5 AC1）の具体実装。

### 持ち越し研究項目（Research Needed）
- CodeMirror を小型・単一行〜数行のチャット入力として使う際のレイアウト/フォーカス/Enter 送信ハンドリング（既存 `handleSubmit` の Enter 制御との整合）。
- `@codemirror/autocomplete` の候補メニューを GROWI のデザイン（loading/該当なし表示・キーボード操作）に合わせるためのカスタマイズ範囲。
- ファイル添付など `prompt-input.tsx` の既存機能を維持したまま入力本体だけを置換できるか（コンポーネント境界の確認）。
- `ChatSidebar` への i18n 導入とクライアントテスト（RTL）の新設方針。

---

## 設計シンセシス（Design Synthesis） — 2026-06-06

### 1. 一般化（Generalization）
- R1〜R5 は「`@` 起動 → 検索 → 選択 → 原子トークン挿入」という**単一の合成ワークフロー**の側面。インターフェースは「メンションセッション（過渡状態）」と「メンション装飾（確定状態）」の2状態に一般化し、両者を `MentionController` で疎結合に橋渡しする。実装スコープは本要件（ページメンション）に限定し、汎用メンション（ユーザー等）へは広げない（インターフェースのみ拡張余地を残す）。
- 送信時変換は `getMentionFlattenedText()` という**単一の変換点**に集約。チップ表現を将来変えても送信仕様（6.x）はこの関数だけで担保。

### 2. Build vs Adopt
- **Adopt**: 原子トークン挙動（3.3/5.x）は CodeMirror 6 の `Decoration.replace` + `EditorView.atomicRanges` を採用（既存直接依存・実績あり）。検索（7.x）は `useSWRxSearch` を採用。遷移（4.1）は `LinkedPagePath` を採用。→ 新規依存ゼロ。
- **Build（理由付き）**: 候補ドロップダウン UI は**自前 React/shadcn 実装**を採用。`@codemirror/autocomplete` 単独だと (a) loading 表示（2.5）/該当なし表示（2.6）が困難、(b) shadcn/Tailwind スタイル統一が困難、のため却下。CM autocomplete は起動補助・キーマップ基盤としてのみ部分利用。
- **Reject**: Lexical/ProseMirror 等の新規リッチエディタは、重量級依存追加・SSR 外部化ルール（tech.md）への影響・CodeMirror との技術二重化により却下。

### 3. 簡素化（Simplification）
- 当初検討した「imperative な `search-page-paths.ts` フェッチャ」は不要と判断し削除（候補検索は React 側 `useSWRxSearch` に集約）。
- メンションのデータ表現は `MentionData { path; pageId? }` に最小化。送信・表示・遷移はすべて `path` から導出可能で、`pageId` は任意。
- doc 本文に**パス文字列そのもの**を保持する設計により、別途「メンション→テキスト」の直列化レイヤを持たず、`doc.toString()` で送信テキストを得る（変換層を1つ削減）。

### 主要リスク（実装順への影響）
- 最大リスクは「CM 高優先度キーマップ ↔ React ドロップダウンのキー委譲」。実装初期にこの橋渡しのプロトタイプ検証を先行させる（タスク順序で前倒し）。
