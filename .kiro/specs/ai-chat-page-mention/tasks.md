# Implementation Plan

## ai-chat-page-mention

> 依存方向（design.md より）: `types` → `editor-state/*`(純CM) → `useMentionController` → React UI → `ChatSidebar`。
> `(P)` は直前 peer と並行実行可。CodeMirror 6・shadcn/Tailwind・`useSWRxSearch`・Vitest/RTL は既存依存として存在する前提（新規セットアップ不要）。

- [ ] 1. Foundation: 型定義・マッピング・i18n
- [x] 1.1 型定義と検索結果マッピング
  - `PagePathCandidate` / `MentionData` / `MentionSessionState` / `MentionController` インターフェース / `PageMentionInputProps` を定義
  - `IPageWithSearchMeta`（`data.path` / `data._id`）→ `PagePathCandidate` への純マッピング関数を実装
  - 観察可能な完了条件: 型が公開バレル経由で参照でき、ユニットテストで `IPageWithSearchMeta → PagePathCandidate` 変換（path/id の写像）が検証できる
  - _Requirements: 2.1, 7.1_

- [ ] 1.2 (P) i18n キー追加
  - `pageMention.placeholder` / `pageMention.hint`（空クエリ時の案内）/ `pageMention.searching` / `pageMention.noResults` を既存ロケールリソースに追加
  - 観察可能な完了条件: 追加キーが各ロケールに存在し `useTranslation` で解決できる
  - _Requirements: 1.2, 2.5, 2.6_

- [ ] 2. Core: CodeMirror 拡張（純ロジック層・React 非依存）
- [ ] 2.1 (P) mention-session 拡張
  - `@` の語境界検出（行頭/空白直後のみ起動、メール様 `foo@` は非起動）と即起動（クエリ空でも `active=true`）
  - クエリ更新、空白入力でセッション終了、`@` シーケンス削除で終了、確定メンション内では再起動しない
  - 観察可能な完了条件: state テストで「語境界 `@`→active・query=""」「`@`+入力→query 更新」「空白→active=false」「`@` 削除→active=false」「メンション内非起動」が通る
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.7, 5.5_
  - _Boundary: mention-session_
  - _Depends: 1.1_

- [ ] 2.2 (P) mention-decoration 拡張
  - `MentionWidget`（`tw:` クラスのチップ DOM、`textContent` でパス表示）、`Decoration.replace({ inclusive:false })` の装飾 `StateField`、`addMention` 効果、`EditorView.atomicRanges` 提供、`NavCallback` Facet、`mousedown.preventDefault` によるクリック/編集区別
  - 観察可能な完了条件: state テストで「addMention→装飾範囲生成」「atomicRanges facet が当該範囲を返す」「inclusive:false で隣接挿入が通常テキスト」「隣接編集で装飾が map・独立維持」、command テストで「`deleteCharBackward` が範囲を単位削除」、widget DOM click で NavCallback 発火が通る
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: mention-decoration_
  - _Depends: 1.1_

- [ ] 2.3 (P) flatten 純関数
  - doc から送信用パス文字列を生成（`doc.toString()` ベース）。送信テキスト変換の単一の変換点
  - 観察可能な完了条件: ユニットテストで「複数メンションを位置・順序どおりパス文字列化」「ページ本文を含まない」が通る
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: flatten_
  - _Depends: 1.1_

- [ ] 3. Core: 検索コントローラ
- [ ] 3.1 useMentionController フック
  - セッション状態↔候補リストの橋渡し。`useSWRxSearch`（debounce 付き、クエリ 1 文字以上で実行）、`highlightedIndex` の `moveUp`/`moveDown`、`commit`（`addMention` を dispatch）、`close`
  - 候補は既存検索 API（権限フィルタ済み）に依拠し、閲覧可能ページのみを提示
  - 観察可能な完了条件: controller テストで「query 1 文字以上で `useSWRxSearch` 呼び出し」「`moveUp`/`moveDown` で index 変化」「`commit` で `addMention` dispatch」「`close` で非アクティブ化」が通る
  - _Requirements: 1.3, 1.4, 2.2, 2.3, 2.7, 7.1, 7.2_
  - _Boundary: useMentionController_
  - _Depends: 2.1, 2.2_

- [ ] 4. Core: 候補リスト UI とキーマップ
- [ ] 4.1 (P) MentionCandidateList コンポーネント
  - shadcn/Tailwind ドロップダウン。表示状態の出し分け（空クエリ=ヒント・検索未実行 / loading / 該当なし / 候補あり）、各候補にパス表示、行クリックで commit、`view.coordsAtPos` でキャレット座標に配置
  - 観察可能な完了条件: RTL テストで「空クエリ→ヒント表示かつ検索未実行」「1 文字以上→候補表示」「isLoading 中→loading 行」「結果空→該当なし行」「行クリック→commit コールバック発火」が通る
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.4, 2.5, 2.6_
  - _Boundary: MentionCandidateList_
  - _Depends: 3.1_

- [ ] 4.2 (P) mention-keymap 拡張
  - `Prec.highest` で `ArrowUp`/`ArrowDown`/`Enter`/`Tab`/`Escape` を bind。セッション中は controller（`moveUp`/`moveDown`/`commit`/`close`）へ委譲、非アクティブ時の `Enter` はホストフォーム `requestSubmit()`、`Shift-Enter` は改行
  - IME 合成ガード: Enter ハンドラは候補確定・送信の両方でまず `view.composing` を確認し、合成中は素通し（`return false`）
  - 観察可能な完了条件: controller モックを用いたテストで「セッション中の ↑↓/Enter/Esc が対応する controller メソッドを呼ぶ」「`view.composing=true` のとき Enter が候補確定・送信のいずれも発火しない」が通る
  - _Requirements: 2.2, 2.3, 2.4, 6.1_
  - _Boundary: mention-keymap_
  - _Depends: 3.1_

- [ ] 5. 統合: エディタ拡張合成と React アダプタ
- [ ] 5.1 createPageMentionExtensions ファクトリ
  - `mention-session` + `mention-decoration` + `mention-keymap` + `atomicRanges` を precedence 込みで合成し、`NavCallback` の注入口を提供
  - 観察可能な完了条件: 合成 state テストで「ファクトリが返す Extension を組み込んだ EditorState に全 StateField が存在し、atomicRanges が有効」になることが確認できる
  - _Requirements: 3.3_
  - _Boundary: editor-state_
  - _Depends: 2.1, 2.2, 4.2_

- [ ] 5.2 PageMentionInput アダプタと公開バレル
  - `EditorView` ライフサイクル管理、`value`↔doc 同期（外部リセット＝空文字化にのみ追従）、`MentionCandidateList` のキャレット配置、`NavCallback`→`next/router` 配線、公開バレル `index.ts`（`PageMentionInput` と公開型のみ re-export）
  - フォーム連携: 隠し `<input type="hidden" name="message">` を flatten 結果に同期、非セッション時の `Enter` でホストフォームの `requestSubmit()` を発火
  - 観察可能な完了条件: コンポーネントがマウントされ「doc 変更で `onChange(flatten)` 発火」「隠し `input[name=message]` が flatten 値を保持」「`value=''` で doc がクリア」「チップクリックで `next/router` 遷移」がテスト/動作で確認でき、バレル経由で `PageMentionInput` のみが公開される
  - _Requirements: 1.1, 4.1, 6.1_
  - _Boundary: PageMentionInput_
  - _Depends: 5.1, 4.1_

- [ ] 6. 統合: ChatSidebar 差し替え
- [ ] 6.1 ChatSidebar への組み込み
  - 入力リーフを `PromptInputTextarea` → `PageMentionInput` に差し替え、`onChange` を `(value: string) => setInput(value)` に変更、`placeholder` を i18n 化。`PromptInput`/`PromptInputBody`/`PromptInputFooter`/`PromptInputSubmit`/`handleSubmit` と送信・添付フローは維持
  - 観察可能な完了条件: 統合テストで「メンション挿入後の送信で `sendMessage` に**パス文字列を含む text**が渡る」ことを確認し、既存の送信/添付フローが回帰しない
  - _Requirements: 6.1_
  - _Boundary: ChatSidebar_
  - _Depends: 5.2_

- [ ] 7. 検証
- [ ] 7.1 手動スモーク（devcontainer）
  - アプリを起動し、`@` 入力→候補選択→チップ表示→送信の一連フローを実機確認
  - キャレットがチップ内部に入らない（境界のみ・単位削除）こと、IME 変換確定 Enter で誤って候補確定/送信が起きないこと（Issue 2）を確認。手順は `apps/app/.claude/skills/app-commands/SKILL.md` の Smoke Testing に従う
  - 観察可能な完了条件: 上記フローと 2 つの挙動が実機で再現確認できる
  - _Requirements: 1.1, 3.3, 5.1, 5.3, 6.1_
