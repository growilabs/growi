# Technical Design: ai-chat-page-mention

## Overview

**Purpose**: AI チャット利用者が、入力欄で `@` に続けて文字列を入力するとページパスをインクリメンタル検索し、候補から選択したページを「原子的な rich text トークン（メンションチップ）」として挿入できる機能を提供する。チップはクリックで対象ページへ遷移でき、送信時には対象ページの**パス文字列**として AI に渡る。

**Users**: GROWI の AI チャット（mastra ChatSidebar）利用者。会話の中で特定ページを参照先として素早く指定するワークフローで使用する。

**Impact**: 現状プレーン `<textarea>`（フラットな string state）であるチャット入力欄を、CodeMirror 6 ベースの入力に置換する。shadcn の `PromptInput` 合成シェル（フォーム・送信ボタン・添付機能）は温存し、入力リーフのみを差し替える。サーバ（mastra ルート）の変更は行わない。

### Goals
- `@` 起動のインクリメンタル検索と候補リスト表示（キーボード/マウス操作・loading・該当なし表示）
- ページメンションを視覚的に区別された原子トークンとして挿入し、文字単位編集不可・キャレット境界・単位削除を保証する
- メンションのクリックで対象ページへ遷移する
- 送信メッセージにメンションを**パス文字列としてのみ**反映する（本文は付与しない）
- 既存 shadcn `PromptInput` シェルと mastra 送信フローを壊さない

### Non-Goals
- 参照先ページの**本文（コンテンツ）取得・AI コンテキストへの注入**（送信はパス文字列のみ）
- ユーザー/タグ等、ページ以外のメンション
- mastra サーバ側ルート・エージェント推論ロジックの変更
- 新規の検索 API・新規の権限フィルタの実装（既存 `/search` の権限挙動に依拠）
- 新規リッチテキストエディタライブラリ（Lexical / ProseMirror 等）の導入

## Boundary Commitments

### This Spec Owns
- `features/mastra/client/components/PageMentionInput/` 配下の新規入力コンポーネント一式（CodeMirror エディタ adapter、メンション装飾拡張、メンションセッション拡張、ナビゲーションキーマップ、候補リスト UI、メンションチップ表示）
- ChatSidebar 入力リーフの差し替え（`PromptInputTextarea` → `PageMentionInput`）と、それに伴う `onChange` シグネチャ・Enter 送信配線の変更
- ドキュメント文字列 ↔ メンション装飾の相互規約（doc 本文にパス文字列を保持し、装飾で原子チップ表示する方式）
- メンション関連の新規 i18n キー

### Out of Boundary
- 共有 shadcn コンポーネント `~/components/ai-elements/prompt-input.tsx` の内部実装（無改修・温存）
- 検索バックエンド（Elasticsearch delegator）と `/search` エンドポイント、その権限フィルタ
- mastra サーバルート `post-message.ts` と `UIMessage` スキーマ
- ChatSidebar の送信処理 `handleSubmit` / `sendMessage` の本体ロジック（入力値の供給形式のみ整合させる）

### Allowed Dependencies
- 既存検索フック `useSWRxSearch`（`~/stores/search`）と検索結果型 `IPageWithSearchMeta`
- 既存 CodeMirror 6 直接依存（`@codemirror/state` `^6.6`, `@codemirror/view` `^6.42`, `@codemirror/autocomplete` `^6.18`, `@codemirror/commands` `^6.8`）
- ページ遷移ヘルパ `LinkedPagePath`（`~/models/linked-page-path`）+ `next/router`
- shadcn UI プリミティブ（`~/components/ui/*`）と `cn`（`~/utils/shadcn-ui`）、Tailwind（`tw:` 接頭辞）
- `react-i18next` の `useTranslation`

### Revalidation Triggers
- `PromptInput` の合成 API（children 受け渡し・`onSubmit` 契約・`InputGroup` ラップ）が変更された場合
- `useSWRxSearch` の戻り値型・`/search` のレスポンス構造（`data[].data.path` / `._id`）が変更された場合
- `UIMessage` 送信形式（`message.text`）が変更された場合
- ページ URL の組み立て規約（`LinkedPagePath.href`）が変更された場合

## Architecture

### Existing Architecture Analysis
- 入力欄は shadcn コンパウンドコンポーネント `PromptInput`（`<InputGroup>{children}</InputGroup>` を描画、`prompt-input.tsx:776`）の子として `PromptInputTextarea`（素の `<textarea>`）を配置する構成。ChatSidebar は controller context を使わず `value`/`onChange` で制御している（`ChatSidebar.tsx:255-271`）。
- 送信は `PromptInput` の `<form onSubmit>` → `handleSubmit(message)` → `sendMessage({ text })`。入力値はフラット string。
- AI チャット UI は **shadcn + Tailwind 4**（`components.json`, `tw:` 接頭辞）。Bootstrap/reactstrap はレガシ領域用で本機能では不使用。
- 検索は `useSWRxSearch` → `apiGet('/search', { q, limit, ... })`。権限フィルタは Elasticsearch delegator（`elasticsearch.ts:995-1039`）で適用済みで、ログインユーザーが閲覧可能なページのみ返る。

### Architecture Pattern & Boundary Map

CodeMirror が「編集・原子トークン・メンションセッション検出」を担い、React/shadcn が「候補リスト UI・検索（SWR）」を担うハイブリッド構成。両者は **MentionController**（共有コントローラ）を介して疎結合に連携する。

```mermaid
graph TB
    ChatSidebar --> PageMentionInput
    PageMentionInput --> EditorView
    PageMentionInput --> MentionCandidateList
    PageMentionInput --> MentionController

    subgraph CodeMirror
        EditorView --> MentionSessionField
        EditorView --> MentionDecorationField
        EditorView --> MentionKeymap
        MentionDecorationField --> AtomicRanges
    end

    MentionSessionField --> MentionController
    MentionKeymap --> MentionController
    MentionController --> MentionCandidateList
    MentionController --> useSWRxSearch
    useSWRxSearch --> SearchApi

    MentionWidget --> NavCallback
    NavCallback --> NextRouter
```

**Architecture Integration**:
- **Selected pattern**: Thin React adapter + pure CodeMirror extensions + shared controller bridge。フレームワーク adapter（React/CM）から純粋ロジックを分離する coding-style 原則に準拠。
- **Boundaries**: 検索＝既存 `useSWRxSearch`／編集・原子化＝CM 拡張／候補表示＝shadcn UI／遷移＝`LinkedPagePath`+router。共有所有なし。
- **Preserved patterns**: shadcn `PromptInput` 合成シェル、`useSWRxSearch`、`LinkedPagePath`、feature-based 配置。
- **New components rationale**: textarea ではメンションの「視覚区別・原子性・clickable」を満たせないため、CM ベースの入力リーフと装飾拡張が必須。候補 UI は loading/該当なし（2.5/2.6）と shadcn スタイル要件を満たすため React 側で持つ。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend (editor) | `@codemirror/state` `^6.6`, `@codemirror/view` `^6.42` | エディタ・装飾・原子レンジ | 既存依存。新規追加なし |
| Frontend (mention session) | `@codemirror/autocomplete` `^6.18`（補助）, `@codemirror/commands` | 起動規則の補助・キーマップ基盤 | 候補 UI は自前 React 実装、CM autocomplete のツールチップ描画は不使用 |
| Frontend (UI) | React + shadcn (`~/components/ui/*`) + Tailwind 4 (`tw:`) | 候補リスト・チップ・配置 | Bootstrap 不使用 |
| Data | `useSWRxSearch`（`/search`） | ページパス検索（権限フィルタ済み） | 既存。無改修 |
| Navigation | `LinkedPagePath` + `next/router` | チップクリック遷移 | 既存ヘルパ |
| i18n | `react-i18next` | 新規 UI 文言 | ChatSidebar に新規導入 |

## File Structure Plan

### Directory Structure
```
apps/app/src/features/mastra/client/components/PageMentionInput/
├── index.ts                          # 公開バレル: PageMentionInput と公開型のみ re-export
├── PageMentionInput.tsx              # React adapter: EditorView ライフサイクル / value 同期 / 隠しinput[name=message] / requestSubmit / 候補リスト配置
├── MentionCandidateList.tsx          # shadcn 候補ドロップダウン(loading/該当なし/行レンダリング/ハイライト)
├── use-mention-controller.ts         # セッション状態↔候補リストの橋渡しフック(検索・選択中index・commit/close)
├── types.ts                          # PagePathCandidate / MentionData / MentionSessionState / 公開Props
└── editor-state/
    ├── index.ts                      # サブバレル: 拡張ファクトリ createPageMentionExtensions() を公開
    ├── mention-decoration.ts         # MentionWidget(WidgetType) + 装飾StateField + addMention効果 + atomicRanges
    ├── mention-session.ts            # @トリガ検出・セッションStateField・起動規則(1.5)・終了(1.6/1.7)
    ├── mention-keymap.ts             # 高優先度キーマップ: セッション中はNav鍵をcontrollerへ委譲 / Enter送信・Shift+Enter改行
    └── flatten.ts                    # doc → 送信用パス文字列の取得(純関数, 6.1-6.3)
```

### Modified Files
- `apps/app/src/features/mastra/client/components/ChatSidebar/ChatSidebar.tsx` — 入力リーフを `PromptInputTextarea` → `PageMentionInput` に差し替え。`onChange` を `(value: string) => setInput(value)` に変更（`PageMentionInput` は文字列を直接返す）。送信は従来どおり `PromptInput` の `onSubmit={handleSubmit}` 経路を維持（`PageMentionInput` の Enter が `requestSubmit()` を発火するため ChatSidebar 側の送信配線は変更不要）。新規文言を i18n 化。`PromptInput`/`PromptInputBody`/`PromptInputFooter`/`PromptInputSubmit`/`handleSubmit` は維持。
- GROWI i18n ロケールリソース — `pageMention.placeholder` / `pageMention.searching` / `pageMention.noResults` 等のキーを追加（既存ロケール配置規約に従う）。

> 依存方向: `types` → `editor-state/*`(純CM) → `use-mention-controller` → `PageMentionInput`/`MentionCandidateList`(React) → `ChatSidebar`。左方向のみ import。`editor-state/*` は React/SWR に依存しない。

## System Flows

### メンション挿入フロー（@入力 → 選択 → チップ化 → 送信）

```mermaid
sequenceDiagram
    participant User
    participant Editor as CodeMirror EditorView
    participant Session as MentionSessionField
    participant Controller as MentionController
    participant List as MentionCandidateList
    participant Search as useSWRxSearch
    participant Doc as Document

    User->>Editor: 語境界で "@" を入力
    Editor->>Session: トランザクション解析
    Session->>Session: 起動判定(直前が空白/行頭か)
    Session->>Controller: active=true, query="", coords
    Controller->>List: パネル即時オープン(空クエリ=ヒント表示)
    User->>Editor: "foo" を追記
    Session->>Controller: query="foo"
    Controller->>Search: useSWRxSearch("foo")
    Search-->>List: 候補(権限フィルタ済) / loading / 空
    Note over Session: 空白入力 or "@"削除でセッション終了(パネル閉)
    User->>Editor: ArrowDown / Enter
    Editor->>Controller: keymap がNav鍵を委譲
    Controller->>List: ハイライト移動 / commit
    Controller->>Editor: dispatch(replace @foo → "/path" + addMention効果)
    Editor->>Doc: 本文に "/path" 挿入 + 原子装飾登録
    Note over Editor: atomicRanges によりチップは原子化
    Note over Editor: doc変更ごとに flatten を隠しinput[name=message]へ同期
    User->>Editor: メッセージ送信(Enter, セッション非アクティブ)
    Editor->>Editor: form.requestSubmit()
    Editor->>ChatSidebar: PromptInput.handleSubmit が formData[message] を読取
    ChatSidebar->>ChatSidebar: sendMessage({ text }) + setInput('')
```

**主要な決定**:
- メンションは **doc 本文にパス文字列そのものを保持**し、その範囲に `Decoration.replace({ widget })` を重ねてチップ表示する。これにより flatten 用テキストは `doc.toString()` で得られ、パス文字列のみが自然に反映される（6.1/6.2）。
- 送信テキストは **隠し `input[name=message]`** を介して既存フォーム経路に渡す。CodeMirror はネイティブフォーム要素でないため、flatten 結果をこの隠し input に同期させて `formData.get('message')` で読めるようにする（Issue 1 対応）。
- セッション中の Nav 鍵（↑↓/Enter/Tab/Esc）は高優先度キーマップが横取りして候補リスト操作へ委譲し、非セッション時の Enter は `requestSubmit()` で送信に割り当てる。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | `@`起動・候補パネル即時オープン | mention-session, PageMentionInput | MentionSessionState | 挿入フロー |
| 1.2 | 空クエリ時はヒント表示 | MentionCandidateList | — | — |
| 1.3 | `@`後入力で逐次検索 | mention-session, use-mention-controller | useSWRxSearch | 挿入フロー |
| 1.4 | 1文字以上で候補表示 | use-mention-controller, MentionCandidateList | — | 挿入フロー |
| 1.5 | 語境界以外では非起動 | mention-session | isMentionTriggerBoundary() | — |
| 1.6 | 空白でセッション終了 | mention-session | — | — |
| 1.7 | `@`削除でセッション終了 | mention-session | — | 挿入フロー |
| 2.1 | 候補にパス表示 | MentionCandidateList | PagePathCandidate | — |
| 2.2, 2.3 | ↑↓選択・Enter/クリック確定 | mention-keymap, use-mention-controller | MentionController | 挿入フロー |
| 2.4 | Esc/外クリックで閉じる | mention-keymap, MentionCandidateList | MentionController.close | — |
| 2.5, 2.6 | loading/該当なし表示 | MentionCandidateList, use-mention-controller | MentionController(isLoading/candidates) | — |
| 2.7 | 過剰検索抑制(debounce) | use-mention-controller | activateOnTypingDelay/debounce | — |
| 3.1 | 検索文字列をチップに置換 | mention-decoration, use-mention-controller | addMention 効果 | 挿入フロー |
| 3.2 | 視覚的区別 | mention-decoration(MentionWidget) | Tailwind チップ | — |
| 3.3 | 原子的単位として保持 | mention-decoration | EditorView.atomicRanges | — |
| 3.4 | 複数メンション | mention-decoration | DecorationSet | — |
| 4.1 | クリックで遷移 | mention-decoration(MentionWidget) | NavCallback Facet + LinkedPagePath | — |
| 4.2 | クリックと編集の区別 | mention-decoration | widget click handler | — |
| 5.1 | 単位削除 | mention-decoration | atomicRanges | — |
| 5.2 | 編集中も独立維持 | mention-decoration | DecorationSet.map | — |
| 5.3 | 文字単位編集不可・境界キャレット | mention-decoration | atomicRanges | — |
| 5.4 | 隣接入力は外側テキスト | mention-decoration | replace 非 inclusive | — |
| 5.5 | 部分編集手段を提供しない | mention-decoration, mention-session | — | — |
| 6.1, 6.3 | パス文字列を該当位置・順序で送信 | flatten | getMentionFlattenedText() | 挿入フロー |
| 6.2 | 本文非付与 | flatten | doc.toString()のみ | — |
| 7.1, 7.2 | 既存検索・権限内ページのみ | use-mention-controller | useSWRxSearch | — |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|-----------|--------------|--------|--------------|------------------|-----------|
| PageMentionInput | UI adapter | CM 入力リーフ・value 同期・Enter送信・候補配置 | 1.x–6.x | EditorView (P0), useMentionController (P0) | State |
| MentionCandidateList | UI | 候補表示・loading/該当なし・ハイライト（純表示） | 1.2,2.1,2.4–2.6 | useMentionController (P0) | — |
| useMentionController | Logic hook | セッション↔候補の橋渡し・検索・確定 | 1.3,1.4,2.2,2.3,2.7,7.x | useSWRxSearch (P0), MentionSessionState (P0) | State |
| mention-decoration | CM extension | 原子チップ装飾・atomicRanges・クリック遷移 | 3.x,4.x,5.x | @codemirror/view (P0), LinkedPagePath (P1) | State |
| mention-session | CM extension | `@`起動規則・セッション追跡 | 1.1,1.5,1.6,1.7,5.5 | @codemirror/state (P0) | State |
| mention-keymap | CM extension | Nav鍵委譲・Enter送信 | 2.2,2.3,2.4 | @codemirror/view (P0), MentionController (P0) | — |
| flatten | Pure util | doc→送信パス文字列 | 6.1–6.3 | @codemirror/state (P0) | Service |

### UI Layer

#### PageMentionInput

| Field | Detail |
|-------|--------|
| Intent | CodeMirror エディタを React に橋渡しする薄い adapter。エディタが入力の source of truth |
| Requirements | 1.1–6.3（統合点） |

**Responsibilities & Constraints**
- EditorView の生成・破棄、拡張の組み立て（`createPageMentionExtensions`）。
- エディタ変更を購読し、`onChange(getMentionFlattenedText(state))` を発火（フラットなパス文字列を親へ）。
- **隠しフォーム値の同期（Issue 1 対応）**: ネイティブな `<input type="hidden" name="message">` を描画し、その `value` を flatten 済みパス文字列に同期する。`PromptInput.handleSubmit` は非provider経路で `formData.get('message')` から送信テキストを読み、`form.reset()` で消す（[prompt-input.tsx:704-715](apps/app/src/components/ai-elements/prompt-input.tsx#L704-L715)）。CodeMirror はネイティブフォーム要素ではないため、この隠し input が無いと送信テキストが空になる。
- **Enter 送信は既存 textarea と同じ機構を踏襲**: セッション非アクティブ時の Enter で、ホストフォームの `requestSubmit()` を呼ぶ（[prompt-input.tsx:819](apps/app/src/components/ai-elements/prompt-input.tsx#L819) の `form?.requestSubmit()` と同一）。これにより blob 変換・添付処理・clear を含む既存送信パイプラインをそのまま再利用する。`onSubmit` コールバック prop は持たない。
- 親 `value` は **外部リセット（空文字化＝送信後 clear）にのみ追従**し、文字列からメンションを再構築しない（widget の正本はエディタ doc）。
- `value` が空でエディタが空でない場合に doc をリセット。それ以外は一方向（editor→parent）。
- 候補リスト（`MentionCandidateList`）をキャレット座標に配置。

**Dependencies**
- Inbound: ChatSidebar — value/onChange/placeholder/disabled (P0)
- Outbound: useMentionController (P0), createPageMentionExtensions (P0)
- External: ホスト `<form>`（`PromptInput` が描画）— `requestSubmit()` と `name="message"` 経由の送信（P0）

**Contracts**: State [x]

```typescript
export interface PageMentionInputProps {
  value: string;                       // フラット済みパス文字列(送信/空判定用)
  onChange: (value: string) => void;   // doc変更ごとにflatten結果を返す
  placeholder?: string;
  disabled?: boolean;
}
```
- Preconditions: `~/components/ai-elements/prompt-input` の `PromptInputBody` 子（=ホスト `<form>` の内側）として配置される。
- Postconditions: `value` および隠し `input[name=message]` は常に doc のフラット表現と一致（既存フォーム送信経路で送出可能）。
- Invariants: メンション widget はエディタ doc に対応するパス文字列範囲が正本。`value` 経由で widget を再構築しない。送信テキストの単一の出所は隠し `input[name=message]`（= flatten 結果）。

#### MentionCandidateList

| Field | Detail |
|-------|--------|
| Intent | アクティブセッションの query に対する候補ドロップダウン（shadcn/Tailwind） |
| Requirements | 1.2, 2.1, 2.4, 2.5, 2.6 |

**Implementation Notes**
- Integration: **純表示コンポーネント**。検索は行わず、`useMentionController` から `isOpen`・`query`・`candidates`・`isLoading`・`highlightedIndex`・`coords` を読むだけ。各候補（既に `PagePathCandidate` にマップ済み）のパスを表示。確定/閉じる/ハイライト移動は controller のメソッド（`commit`/`close`/`moveUp`/`moveDown`）を呼ぶ。`useSWRxSearch` は直接呼ばない（検索の所有者は controller・単一所有）。
- Validation（表示状態の出し分け）:
  - `query` 空（`@` 直後）→ **ヒント行**（例「ページ名を入力して検索」）を表示し検索は実行しない（1.2）。`@` 起動と同時にパネルは開く（1.1）。
  - `query` 1文字以上 + `isLoading` 中 → loading 行（2.5）。
  - `query` 1文字以上 + 結果空 → 該当なし行（2.6）。
  - `query` 1文字以上 + 結果あり → 候補リスト（1.4/2.1）。
- Risks: キャレット座標追従（スクロール/折返し時）の再計算が必要。`view.coordsAtPos` を使用。

#### useMentionController

| Field | Detail |
|-------|--------|
| Intent | CodeMirror（命令的）と React 候補 UI（宣言的）を繋ぐ双方向ブリッジ。検索・ハイライト・確定の単一の窓口 |
| Requirements | 1.3, 1.4, 2.2, 2.3, 2.7, 7.1, 7.2 |

**Responsibilities & Constraints**
- セッション state（query/範囲/coords）を React 側に取り込み、`useSWRxSearch(query)`（debounce・クエリ1文字以上で実行）で候補を取得（1.3/1.4/2.7/7.x）。
- `highlightedIndex` を保持し `moveUp`/`moveDown` で移動（2.2）、`commit` で選択候補を `addMention` として dispatch（2.3）、`close` でセッションを閉じる（2.4 の一部）。
- **このフックがブリッジの所有者**であり、CM↔React 間の状態同期と呼び出し方向を一手に引き受ける。keymap・候補リスト・PageMentionInput は本フックの契約のみに依存する。

**Dependencies**
- Inbound: PageMentionInput（EditorView を注入）、MentionCandidateList（state 購読）、mention-keymap（メソッド呼び出し）
- Outbound: useSWRxSearch (P0), addMention 効果（mention-decoration, P0）, mentionSessionField（mention-session, P0）

**Contracts**: State [x]

```typescript
export interface MentionController {
  // --- 状態（候補リストが購読） ---
  readonly isOpen: boolean;
  readonly query: string;
  readonly highlightedIndex: number;
  readonly coords: { left: number; top: number; bottom: number } | null;
  readonly candidates: readonly PagePathCandidate[];
  readonly isLoading: boolean;
  // --- 操作（keymap / 候補リスト行クリックが呼ぶ） ---
  moveUp(): void;
  moveDown(): void;
  commit(index?: number): void;  // 省略時は highlightedIndex
  close(): void;
}
export const useMentionController: (view: EditorView | null) => MentionController;
```

##### State Management（双方向ブリッジ機構）
- **CM → React（状態の取り込み）**: `PageMentionInput` が `createPageMentionExtensions` に `EditorView.updateListener` を組み込み、各トランザクションで `mentionSessionField` の値（active/from/to/query）と `view.coordsAtPos(from)` を React state へ push する。`useMentionController` はこの session state を入力に `query` を `useSWRxSearch` へ渡す。CM の doc/selection が**正本**、React state は派生。
- **React → CM（操作の呼び出し）**: `commit`/`moveUp` 等は最新の controller を参照する必要があるため、controller のメソッドを **stable ref**（`useRef` で保持し毎レンダー更新）に格納する。`mention-keymap` は値ではなく **ref を保持する Facet** 経由で呼び出すことで、エディタ生成時に固定された stale クロージャを避ける（Issue 1）。
- **coords の所有権（Issue 2）**: `coordsAtPos` は `EditorView` を持つ `PageMentionInput`/updateListener 側で算出し、controller の `coords` として一元的に公開する。`MentionCandidateList` は `coords` を読むだけで自前計算しない（二重所有の回避）。
- Concurrency: 検索は SWR がキャッシュ/重複排除。`highlightedIndex` は候補数変化時に範囲内へクランプ。

**Implementation Notes**
- Integration: `useSWRxSearch` は React フック内でのみ呼べるため、検索は本フック（React 側）に集約し、CM 拡張からは呼ばない。
- Risks: stale ref/Facet の取り回しが本機能最大の実装リスク。タスク着手初期に CM↔React 往復のプロトタイプ検証を先行する（research.md のリスク項に合致）。

### CodeMirror Extension Layer

#### mention-session

| Field | Detail |
|-------|--------|
| Intent | `@` トリガの検出とメンションセッション状態の追跡 |
| Requirements | 1.1, 1.5, 1.6, 1.7, 5.5 |

**Responsibilities & Constraints**
- 各トランザクションで、キャレット直前のテキストを走査し `@` + 後続クエリ範囲を判定。
- **起動規則（1.1/1.5）**: `@` の直前が行頭または空白文字のときのみセッション開始（`active=true`）。直前が非空白文字（メールアドレス様）では開始しない。起動と同時に候補パネルを開く（クエリ空でも `active=true`）。
- **クエリ規約**: `query = doc.sliceString(from+1, to)`。クエリは空白を含まない連続文字列。**空白文字の入力でセッション終了**（`active=false`、入力テキストは通常テキストとして残置、1.6）。
- セッション状態 `{ active, from, to, query }` を `StateField` で保持。`@`〜クエリの削除（1.7）、空白入力（1.6）、確定/Esc/範囲外移動で `active=false`。
- 確定済みメンション内には新規セッションを張らない（5.5 の一貫性）。

**Contracts**: State [x]

```typescript
export interface MentionSessionState {
  readonly active: boolean;
  readonly from: number;   // "@" の位置
  readonly to: number;     // クエリ末尾(=キャレット)
  readonly query: string;  // "@" 直後の検索文字列(空文字可)
}
export const mentionSessionField: StateField<MentionSessionState>;
export const isMentionTriggerBoundary: (textBefore: string) => boolean; // 1.5 の純判定
```
- Invariants: `active` のとき `from < to` または `from+1 === to`（クエリ空）。`query === doc.sliceString(from+1, to)` かつ `query` は空白を含まない。

#### mention-decoration

| Field | Detail |
|-------|--------|
| Intent | 確定メンションを原子的・clickable・視覚区別されたチップとして描画 |
| Requirements | 3.1–3.4, 4.1, 4.2, 5.1–5.4 |

**Responsibilities & Constraints**
- `addMention` 効果でパス範囲に `Decoration.replace({ widget: new MentionWidget(data), inclusive: false })` を登録。`inclusive:false` により隣接入力は装飾外＝通常テキスト（5.4）。
- 装飾 `StateField<DecorationSet>` は変更を `map` して位置追従（5.2）。装飾範囲が編集で破壊された場合は装飾を破棄（チップ→消滅）。
- `EditorView.atomicRanges` を装飾範囲から提供し、キャレットは境界のみ・文字単位編集不可・削除は単位（3.3/5.1/5.3）。
- `MentionWidget.toDOM` は `tw:` クラスのチップ DOM を生成し、クリックで NavCallback（Facet 経由）を呼ぶ。`mousedown` の `preventDefault` で編集キャレット移動と区別（4.2）。

**Contracts**: State [x]

```typescript
export interface MentionData {
  readonly path: string;     // 送信・表示・遷移に使用
  readonly pageId?: string;  // 任意(遷移はpathから導出可能)
}
export const addMention: StateEffectType<{ from: number; to: number; data: MentionData }>;
export const mentionDecorationField: StateField<DecorationSet>;
export const mentionNavCallback: Facet<(data: MentionData) => void>;  // クリック遷移(4.1)
```
- Preconditions: `addMention` の `from..to` は挿入直後のパス文字列範囲。
- Invariants: 各装飾範囲は doc 上のパス文字列と一致し、atomicRanges に含まれる。

#### mention-keymap

| Field | Detail |
|-------|--------|
| Intent | セッション中のナビゲーション鍵委譲と Enter 送信制御（IME 合成安全） |
| Requirements | 2.2, 2.3, 2.4, 6.1 |

**Implementation Notes**
- Integration: `Prec.highest` で `ArrowUp/ArrowDown/Enter/Tab/Escape` を bind。`mentionSessionField.active` のときは `MentionController` の `moveUp/moveDown/commit/close` を呼んで `true`（消費）を返す。非アクティブ時の `Enter` はホストフォームの `requestSubmit()` を呼んで `true`、`Shift-Enter` は改行（既定）。
- **IME 合成ガード（Issue 2 対応・必須）**: `Enter` ハンドラは **候補確定（commit）・メッセージ送信（requestSubmit）の両方**で、まず CodeMirror の合成状態 `view.composing`（IME 変換中）を確認し、合成中は何も処理せず鍵を素通しする（`return false`）。これは既存 textarea の `isComposing`/`nativeEvent.isComposing` ガード（[prompt-input.tsx:813-815](apps/app/src/components/ai-elements/prompt-input.tsx#L813-L815)）と等価で、日本語変換確定の Enter が誤って候補確定/送信を誘発するのを防ぐ。GROWI は日本語第一のため必須。
- Risks: CM 既定キーマップ・autocomplete との競合。`Prec.highest` と早期 return で回避。`view.composing` は CodeMirror が IME 合成を追跡するため、`compositionstart`/`compositionend` の自前管理は不要。

#### flatten

| Field | Detail |
|-------|--------|
| Intent | エディタ doc から送信用テキストを生成 |
| Requirements | 6.1, 6.2, 6.3 |

**Contracts**: Service [x]
```typescript
export const getMentionFlattenedText: (state: EditorState) => string; // = doc.toString()
```
- Postconditions: 出力は doc 中のメンション（パス文字列）を**該当位置・順序どおり**に含み、ページ本文は一切含まない（6.1–6.3）。doc 本文がパス文字列正本のため実装は `state.doc.toString()`。将来チップ表現を変える場合もこの関数を単一の変換点とする。

## Data Models

### Domain Model
- **PagePathCandidate**（検索候補の表示用 VO）: `{ pageId: string; path: string }`。`IPageWithSearchMeta` から `data._id`/`data.path` をマップ。
- **MentionData**（確定メンションの値オブジェクト）: `{ path: string; pageId?: string }`。エディタ装飾と送信テキストの双方の正本はエディタ doc 上のパス文字列。
- **MentionSessionState**（過渡状態）: アクティブな `@` クエリの範囲・文字列。永続化しない。

### Data Contracts & Integration
- **検索（入力）**: `useSWRxSearch(query, ...)` → `IFormattedSearchResult.data: IPageWithSearchMeta[]`。`query` は `@` 直後の文字列。権限フィルタは `/search` 側で適用済み（7.x）。
- **送信（出力）**: ChatSidebar の `input`(string) = `getMentionFlattenedText(state)`。`handleSubmit` → `sendMessage({ text: input })`。新規スキーマなし。

## Error Handling

### Error Strategy
- **検索失敗/タイムアウト**: `useSWRxSearch` の `error` 時は候補リストに「該当なし」相当（または静かに閉じる）でデグレード。入力は継続可能。送信機能には影響させない。
- **遷移失敗（4.1）**: `LinkedPagePath` から無効 href の場合はクリックを無効化（チップ表示は維持）。
- **装飾整合崩れ**: 編集で装飾範囲が破壊された場合はチップを破棄し通常テキスト化（フェイルセーフ、5.2 の境界）。

### Monitoring
- 既存のクライアントロギング規約（`@growi/logger`/console 禁止）に従う。本機能固有の新規メトリクスは追加しない。

## Testing Strategy

**テスト層の方針（Issue 3 対応）**: CodeMirror のキャレット挙動は `EditorView` の DOM レイアウト計測（`coordsAtPos`・縦方向移動）に依存し、jsdom では信頼性が低い。本機能では **Playwright E2E を採用しない**ため、検証は以下の原則で層別する:
- **state / command レベルに寄せて jsdom（Vitest）で検証する** — 我々が**著述するロジック**（session field、decoration field の内容、`atomicRanges` facet の出力、flatten、コマンド実行後の doc/selection）はレイアウト非依存で安定して検証できる。
- **ピクセル単位のキャレット表示そのものは検証しない** — 「キャレットが境界のみで内部に入らない」(3.3/5.3) は CodeMirror が `atomicRanges` 設定から保証する**ライブラリ挙動**であり、我々は *atomicRanges に当該範囲が登録されていること*（facet 出力＝state レベル）を代理検証する。レンダリング後の実挙動は devcontainer 手動スモークで確認（自動ゲートにはしない）。

### Unit Tests（Vitest / jsdom, state・command レベル）
- `isMentionTriggerBoundary`: 行頭/空白後の `@` は起動、非空白後（`foo@`, メール様）は非起動（1.5）。
- `mention-session`: 語境界 `@` で `active=true`・`query=""`（即起動、1.1）、`@`+入力で `query` 更新（1.3）、**空白入力で `active=false`**（1.6）、`@` 削除で `active=false`（1.7）、確定メンション内で再起動しない（5.5）。
- `mention-decoration`（state レベル）: `addMention` 後に decoration 範囲が生成される（3.1/3.4）、`EditorView.atomicRanges` facet が当該範囲を返す（3.3/5.3 の代理検証）、`inclusive:false` で隣接挿入が装飾外＝通常テキスト（5.4）、隣接編集で装飾が `map` され独立維持（5.2）。
- `mention-decoration`（command レベル）: `EditorView` を jsdom で生成し `deleteCharBackward` 等のコマンドを dispatch、メンション範囲が**単位で消滅**し doc/selection が期待どおりになることを検証（5.1）。レイアウト計測に依存しない範囲に限定。
- `flatten`: 複数メンションを位置・順序どおりパス文字列化し、ページ本文を含まない（6.1–6.3）。

### Component Tests（RTL / jsdom）
- `MentionCandidateList`: `@` 起動直後の空クエリでヒント行表示・検索未実行（1.1/1.2）、query 1文字以上で候補表示（1.4/2.1）、`isLoading` 中 loading 表示（2.5）、空結果で該当なし表示（2.6）、行クリックで commit コールバック発火（2.3）。
- `useMentionController` / `PageMentionInput`（DOM 非依存部）: controller の `moveUp/moveDown` で `highlightedIndex` が変化（2.2 のロジック）、`commit` で `addMention` を dispatch しチップ挿入（2.3/3.1）、`close` で候補が閉じる（2.4）、チップ DOM の click で NavCallback 発火（4.1）。
- `ChatSidebar` 統合: メンション挿入後、隠し `input[name=message]` が flatten 値を保持し、送信で `sendMessage` に**パス文字列を含む text**が渡る（6.1）。

> ↑↓ハイライト移動（2.2）は「キー入力→`coordsAtPos`」ではなく **controller のメソッド呼び出し→state 変化** として検証する（キーマップが鍵を controller へ委譲する設計のため、ロジックは DOM 非依存）。実際のキー伝播はスモークで確認。

### 手動スモーク（devcontainer, 自動ゲート外）
- `@`入力 → 候補選択 → チップ表示 → 送信、の一連フロー（1.1→3.1→6.1）と、キャレットがチップ内部に入らない・IME 変換確定 Enter で誤送信しない（Issue 2）ことを実機確認。手順は `apps/app/.claude/skills/app-commands/SKILL.md` の Smoke Testing に従う。

> 権限スコープ（7.x）は既存 `/search` の権限フィルタに委譲。本機能では候補取得が当該エンドポイント経由であることを確認するのみで、権限フィルタ自体の再テストは行わない。

## Security Considerations
- 候補に表示されるページは `useSWRxSearch` → `/search` の既存権限フィルタにより**ログインユーザーの閲覧可能ページのみ**（7.x）。本機能で独自の権限判定・フィルタは新設しない。
- メンションのパス文字列は既存検索結果由来であり、ユーザーが本来アクセスできない情報を露出しない。
- チップ DOM はパス文字列を `textContent` として設定し、HTML 挿入は行わない（XSS 回避）。

## Open Questions / Risks
- **候補 UI のキー委譲**: CM キーマップ（`Prec.highest`）と React ドロップダウンの連携が最大のリスク。代替として `@codemirror/autocomplete` 単独実装も可能だが、loading/該当なし表示（2.5/2.6）と shadcn スタイル要件で本設計（自前ドロップダウン）を採用。実装初期に委譲方式のプロトタイプ検証を推奨。
- **遷移時の下書き保全（4.1）**: 同タブ遷移は書きかけを失う。`LinkedPagePath` href を新規タブ（`target=_blank` 相当）で開く案を既定とするか、実装時に UX 確認。要件 4.1 は「遷移する手段の提供」までを要求しており、開き方は実装選択。
- **パスの区切り**: 空白を含むページパスを送信テキストに含めた際の AI 側可読性。要件 6 は「パス文字列」を要求するため本設計では区切り装飾を付けない（将来拡張余地）。
