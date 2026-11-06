# Research & Design Decisions

## Summary
- **Feature**: `ai-chat-sidebar-resize`
- **Discovery Scope**: Extension（既存の左サイドバー用リサイズ機構を、Mastra feature の AI チャットサイドバーへ拡張する）
- **Key Findings**:
  - 左サイドバーのリサイズは `ResizableArea`（ドラッグ UI）＋ Jotai の幅 atom（`scheduleToPut` で debounce PUT）＋ `UserUISettings.currentProductNavWidth`（SSR props → `useHydrateSidebarAtoms`）の 3 層で、そのまま踏襲できる。
  - `ResizableArea` は `Sidebar/` の内部実装（バレル非公開）で、ハンドル位置と幅計算が左アンカー前提（`left: 100%`、幅 = `pageX`）。右端固定パネルで使うには anchor の抽象化が必要。
  - AI チャットサイドバーは `position: fixed` のオーバーレイで本文を押し広げない。幅は SCSS 固定（sm 未満 100% / sm 以上 500px）。外側コンテナの `overflow-hidden` がパネル外に出るハンドルをクリップする。
  - `UserUISettings` は Mongoose モデルのまま。`prisma/schema.prisma` の `useruisettings` は introspection 由来で `currentProductNavWidth` / `aiChatSelectedModelKey` も未宣言のため、今回の追加フィールドでも Prisma 側は更新しない（既存の `aiChatSelectedModelKey` 追加と同じ扱い）。

## Research Log

### 左サイドバーのリサイズ機構
- **Context**: 「既存の左サイドバーと同じような感じで」という要望に対し、再利用できる部品と経路を特定する。
- **Sources Consulted**: `apps/app/src/client/components/Sidebar/ResizableArea/*`、`Sidebar.tsx`、`apps/app/src/states/ui/sidebar/{sidebar,hydrate}.ts`、`apps/app/src/client/services/user-ui-settings.ts`、`apps/app/src/server/routes/apiv3/user-ui-settings.ts`、`apps/app/src/server/models/user-ui-settings.ts`。
- **Findings**:
  - `ResizableArea` は mousedown で document に mousemove/mouseup を登録し、move 中は `Math.max(pageX, minWidth)` を `onResize` に通知、mouseup で `pageX < minWidth / 2` なら `onCollapsed`、それ以外は `clientWidth` を `onResizeDone` に通知する。ドラッグ中は `dragging` クラスで width トランジションを止める。
  - `Sidebar.tsx` は `ResizableArea` を `dynamic({ ssr: false })` ＋ `withLoadingProps` で読み込み、SSR/初回描画は `ResizableAreaFallback` で幅だけ再現する（描画後に幅が飛ばない）。
  - 幅 atom は base atom と「書き込み時に `scheduleToPut` を呼ぶ派生 atom」の 2 段構成。base atom は `useHydrateSidebarAtoms` で `userUISettings.currentProductNavWidth ?? 320` に hydrate される。
  - `PUT /user-ui-settings` はバリデータ（`isNumeric()`）と、ハンドラ内の **ハードコードされた `updateData` allow-list** の両方を通らないと永続化されない。ゲストは `req.session.uiSettings` に保存され、`getServerSideUserUISettingsProps` が同じ形で返す。
- **Implications**: 幅の状態・永続化・hydrate は既存パターンをそのまま複製できる。`ResizableArea` だけが左アンカー前提の改修対象。

### AI チャットサイドバーの構造
- **Context**: リサイズ部品を差し込む位置と、既存の表示制約（z-index、スクロールバー補正、remount）を確認する。
- **Sources Consulted**: `apps/app/src/features/mastra/client/components/ChatSidebar/{ChatSidebar.tsx,ChatSidebar.module.scss,dynamic.tsx}`、`apps/app/src/features/mastra/client/status/chat-sidebar.tsx`、`apps/app/src/components/Layout/BasicLayout.tsx`。
- **Findings**:
  - 外側 `div` が `position-fixed top-0 end-0 h-100 ... overflow-hidden` ＋ `.grw-chat-sidebar`（z-index `$zindex-fixed + 2`、`margin-right: var(--removed-body-scroll-bar-size)` によるスクロールバー補正、幅 100% / 500px）。
  - `dynamic.tsx` が `threadId ?? new-${openSeq}` を key に ChatSidebar を remount する。幅をコンポーネントローカル state だけに持つと remount で消えるため、グローバル atom が必要。
  - 本文は `tw:max-w-4xl`（896px）で中央寄せ。これ以上の幅は余白になるため最大幅の根拠になる。
  - `close()` は `threadId` を `undefined` に戻す。ドラッグで閉じると会話を見失う。
- **Implications**: ResizableArea は外側 fixed コンテナの内側に置き、`overflow-hidden` は ResizableArea 側（内側）に移す。幅はグローバル atom に持つ。

### Biome の import 制限
- **Context**: Mastra feature から `~/client/components/...` を import してよいか。
- **Sources Consulted**: `biome.json`（`noRestrictedImports` の `includes` 範囲）、`features/mastra/client/admin/*.tsx` の既存 import。
- **Findings**: client 配下 import の制限対象は `stores-universal / utils / models / services / pages / server / components` で、`features/**` は対象外。Mastra は既に `~/client/components/Admin/App/ConfirmModal` などを import している。
- **Implications**: `~/client/components/Common/ResizableArea` を feature から import してもリントは通る。

### デバイス判定
- **Sources Consulted**: `apps/app/src/states/ui/device.ts`。
- **Findings**: `useDeviceLargerThanSm()` が `[isLargerThanSm, set]` を返し、`matchMedia` で sm（576px）境界を監視する。初期値は `false`（SSR 安全）。
- **Implications**: sm 未満で `disabled` にする（ハンドルを出さない）判定に流用できる。ただし初期 `false` が `true` に確定するのは mount 後の effect で、atom を確定させる既存の呼び出し元は編集画面の `PageHeader` だけなので、閲覧画面ではチャットのマウント時点では未確定のまま。これを全幅/可変幅の切替に使うと、デスクトップで初回描画が全幅になり、続く width トランジションで縮むのが見える（実機で再現）。全幅の切替は CSS のメディアクエリで行い、JS の判定はハンドルの有無だけに使う。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. `ResizableArea` を `Common/` に移設して anchor 抽象化（採用） | 1 部品を左右両アンカーで共有 | ドラッグ処理が単一実装。Sidebar の内部ディレクトリへの reach-in を避ける | 移設で import パスが変わる | 移設のみのコミットを先行させ、diff を読みやすくする |
| B. 現位置のまま feature から import | `~/client/components/Sidebar/ResizableArea` を直接参照 | 変更量最小 | Sidebar バレル非公開の内部実装への依存。Sidebar 整理時に壊れやすい | 不採用 |
| C. チャット専用リサイザーを新設 | Mastra 内に右アンカー版を別実装 | Sidebar に触らない | ドラッグ処理の二重管理 | 不採用 |

## Design Decisions

### Decision: 幅の計算を純関数に切り出し、anchor をデータで表現する
- **Context**: 右アンカーでは幅 = ビューポート幅 − ポインタ X で、左アンカー（幅 = ポインタ X）と式が異なる。
- **Alternatives Considered**:
  1. コンポーネント内で `if (anchor === 'right')` 分岐
  2. 純関数 `computeWidthFromPointer({ anchor, pointerX, viewportWidth, minWidth, maxWidth })` に集約し、コンポーネントは薄いアダプタにする
- **Selected Approach**: 2。折りたたみジェスチャ判定（生の幅 < minWidth / 2）も同じモジュールの純関数にする。
- **Rationale**: coding-style の「純関数抽出」「データ駆動」に沿い、ドラッグイベントを起こさずに幅計算を単体テストできる。
- **Trade-offs**: 既存の `pageX` 参照を `clientX` に変える（fixed/sticky 要素の幅はビューポート基準が正しい。横スクロールが無い通常時は同値）。
- **Follow-up**: 左サイドバーの手動スモークで差異が無いことを確認する。

### Decision: 確定幅は最後の mousemove で計算した幅とし、移動なしの mouseup では通知しない
- **Context**: 既存実装は mouseup 時の `clientWidth`（実描画幅）を `onResizeDone` に渡していた。チャットサイドバーは保存幅がビューポート上限を超えると描画幅だけを上限に収める。
- **Alternatives Considered**: (1) 従来どおり mouseup で `clientWidth` を通知、(2) 最後に `onResize` へ通知した幅を確定値とし、一度も動かしていなければ通知しない
- **Selected Approach**: 2。
- **Rationale**: (1) ではハンドルをクリックしただけで、上限に収められた描画幅（例: 保存 900 → 描画 680）が保存値を上書きしてしまう。(2) なら確定値は利用者がドラッグで指定した幅だけになる。
- **Trade-offs**: 左サイドバーでもクリックのみ（移動なし）のときの保存が行われなくなるが、従来も同じ幅を再保存していただけなので観測可能な差は無く、Req 6.1 の「確定幅の保存」は維持される。

### Decision: 折りたたみジェスチャは `onCollapsed` が渡されたときだけ有効
- **Context**: チャットサイドバーには折りたたみ状態が無く、`close()` はスレッド離脱を意味する。
- **Alternatives Considered**: (1) 常に発火し呼び出し側で無視、(2) `onCollapsed` 未指定なら判定自体を行わず最小幅にクランプ、(3) ドラッグで閉じる
- **Selected Approach**: 2。
- **Rationale**: 誤操作で会話を見失わない。既存の左サイドバー（`onCollapsed` を渡す）には影響しない。
- **Trade-offs**: 左右で「最小幅を割ったときの挙動」が異なるが、閉じる操作はヘッダーの × に一本化されており一貫している。

### Decision: 幅の永続化は `UserUISettings.aiChatSidebarWidth`、範囲の責務はクライアント
- **Context**: 最大幅はビューポート依存で、サーバーは知り得ない。
- **Alternatives Considered**: (1) サーバーで固定範囲（360〜960）を強制、(2) サーバーは `isInt({ min: 1 })` で形式のみ、クライアントが hydrate 時と描画時にクランプ
- **Selected Approach**: 2。
- **Rationale**: `currentProductNavWidth`（`isNumeric()` のみ）と整合しつつ、非整数・負数による document 汚染は防ぐ。古い永続値はクライアントのクランプで吸収する。
- **Follow-up**: hydrate はビューポートを知らない SSR（ページの `useHydrateAtoms`）でも走り、また狭い画面で開いただけで保存値を書き換えたくないため、hydrate 時のクランプは固定範囲（360〜960）だけを使い、ビューポート上限は描画・ドラッグ時に適用する（保存値はそのまま、描画幅だけを収める）。

### Decision: 幅 atom と hydrate フックは Mastra feature 内に置き、`basic-layout-page/hydrate.ts` から合成する
- **Context**: `userUISettings` は BasicLayout 系ページの SSR props として既に渡っている。
- **Alternatives Considered**: (1) `~/states/ui/sidebar` に atom を追加し `useHydrateSidebarAtoms` で hydrate（states → feature の import 方向になる、または feature の知識が states に漏れる）、(2) feature 内に `useHydrateChatSidebarAtoms(userUISettings)` を置き、`useHydrateBasicLayoutConfigurationAtoms` から呼ぶ、(3) 開くたびに API で取得
- **Selected Approach**: 2。
- **Rationale**: 既存の `useHydrateSidebarAtoms` も同じ場所から呼ばれており、合成点として自然。feature の atom を汎用 states が知る必要が無い。

### Decision: 最小 360px / 最大 min(960, viewport − 320) / 初期 500px、sm 未満は全幅・無効
- **Context**: 入力欄（モデル選択トリガー＋送信）が実用下限を決め、`max-w-4xl`（896px）が有効上限を決める。元ページを完全に覆わないためにビューポート基準の上限も必要。
- **Selected Approach**: 上記。viewport − 320 が 360 を下回る狭い画面では実効最大 = 360（最小以上を保証）。
- **Trade-offs**: 576〜680px の画面では実質リサイズ不可（360 固定）だが、その幅帯で可変にする価値は低い。

### Synthesis
- **Generalization**: 「幅をドラッグで変える」機能を anchor 付きの 1 部品に一般化。実装スコープは左右アンカーのみ（上下は要求に無い）。
- **Build vs Adopt**: 既存 `ResizableArea` を拡張（Adopt）。外部ライブラリ（react-resizable 等）は、既存部品で十分かつ依存追加を避けるため不採用。
- **Simplification**: リサイズ用の専用 Context/Provider や、幅の永続化用の新 API は作らない。既存の `scheduleToPut` と `PUT /user-ui-settings` に相乗りする。

## Risks & Mitigations
- 移設と機能追加を同一コミットにすると rename 検出が効かない — 移設のみのコミットを先行させる。
- 外側 fixed コンテナの `overflow-hidden` がハンドルを隠す — overflow 制御を ResizableArea 側（内側）へ移し、外側は shrink-to-fit にする。
- `useDeviceLargerThanSm` の初期値 `false` による初回描画の全幅 — 全幅の切替を CSS メディアクエリ（`media-breakpoint-down(sm)` で inline width を `!important` 上書き）に任せ、JS の判定に依存させない。テストでは hook をモックし、判定が `false` のままでも初回から保存幅で描画されることを検証する。
- 既存の `pageX` → `clientX` 変更 — 横スクロール無しでは同値。左サイドバーの手動スモークで確認。

## References
- `apps/app/src/client/components/Sidebar/ResizableArea/` — 既存ドラッグ実装
- `apps/app/src/states/ui/sidebar/sidebar.ts` — 幅 atom と `scheduleToPut` の 2 段構成
- `apps/app/src/server/routes/apiv3/user-ui-settings.ts` — allow-list とバリデータ
- `.kiro/specs/ai-provider-model-picker/` — `aiChatSelectedModelKey` を `UserUISettings` に追加した先行例
