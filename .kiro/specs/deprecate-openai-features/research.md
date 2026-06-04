# Gap Analysis — deprecate-openai-features

調査日: 2026-06-04 / 対象コードベース: `apps/app`（Next.js Pages Router + Express + MongoDB/Mongoose）

本書は要件（WHAT）と既存実装の差分を整理し、設計フェーズの判断材料を提供する。実装の最終決定は行わず、選択肢と論点・リスクを提示する。

---

## 1. 現状調査サマリ

- AI 機能は `features/openai`（旧: アシスタント / ナレッジ・エディターアシスタント / vectorStore FileSearch）と `features/mastra`（新: Mastra ベースのチャット・エージェント検索・thread）に分かれている。
- 削除対象 `features/openai` は **app 全体から 50+ 箇所**で参照されている（route 登録、cron、レイアウト、エディター、admin、page ライフサイクル、user 削除、normalize、config、そして `features/mastra` と `features/ai-tools` の両方）。
- マイグレーション基盤は `src/migrations/` の migrate-mongo 形式（`YYYYMMDDHHMMSS-*.js`、`up(db)/down(db)`）。コレクション drop は `db.collection(...).drop()` で記述可能。
- AI 有効判定はサーバー（`isAiEnabled`）とクライアント（`aiEnabledAtom`、サーバー設定 `app:aiEnabled` から hydrate）の二系統。
- チャット起動 atom が **2 系統併存**: openai 旧 `aiAssistantSidebarAtom`（エディターアシスタント・既定アシスタントボタンが使用）と mastra `chatSidebarAtom`。mastra の `openChat` は現状 **`aiAssistantData: AiAssistantHasId` 必須**。
- i18n は **5 ロケール**（en_US / ja_JP / ko_KR / fr_FR / zh_CN）× namespace（`translation.json` / `admin.json`）。

---

## 2. Requirement → 既存アセット対応マップ（gap タグ: Missing=新規/改変必要 / Reuse=流用 / Constraint=制約 / Remove=削除）

| Req | 既存アセット（file:line 抜粋） | gap |
|-----|--------------------------------|-----|
| **1** features/openai 全廃 | `features/openai/` 全体; route 登録 `server/routes/apiv3/index.js:5,197`; alias `~/features/openai` | Remove |
| **2** ナレッジ/エディターアシスタント廃止 | knowledge-assistant.tsx, editor-assistant/*; `EditorAssistantToggleButton.tsx`; `PageEditor.tsx:30`(`useIsEnableUnifiedMergeView`) | Remove + Missing（PageEditor の unified merge view 参照解消） |
| **3** アシスタント概念廃止 | `AiAssistant/*`, `AiAssistantManagementModal/*`; `BasicLayout.tsx:18,91`; `PageControls.tsx:26,365`(`OpenDefaultAiAssistantButton`); mastra `AiAssistantList.tsx`/`AiAssistantSubstance.tsx`; CRUD routes | Remove（mastra 側の assistant 一覧 UI も対象） |
| **4** モデル削除＋マイグレーション | models: `ai-assistant.ts`/`thread-relation.ts`/`vector-store.ts`/`vector-store-file-relation.ts`; cron 登録 `crowi/index.ts:16-17,191-193,305,457,908-909`; 既存 migration `20241107172359-rename-pageId-to-page.js:3` が `VectorStoreFileRelationModel` を import | Missing（新規 migration）+ **Constraint**（過去 migration がモデルを import） |
| **5** mastra vectorStore/file-search 除去 | `mastra/.../tools/file-search-tool.ts`, `ai-sdk-modules/file-search.ts`; `post-message.ts:15-16`(`AiAssistantModel`,`getOpenaiService`) | Remove + Missing（post-message を assistant 非依存へ） |
| **6** 移設・参照整理 | mastra→openai imports（chat-sidebar.tsx:4 型, AiAssistantSubstance/List, ThreadList:7, routes index:4, post-message:15-16）; `isAiEnabled` 多数; `getLlmClientDelegator`(ai-tools) | Missing（移設先 + 再配線）+ **Constraint** |
| **7** openai 専用 i18n 削除 | `translation.json`: `modal_ai_assistant.*`,`sidebar_ai_assistant.*`,`default_ai_assistant.*`,`share_scope_warning_modal.*`; `admin.json`: `ai_integration.*`; **共有**: `ai_assistant_substance.*`(add_assistant/recent_threads/delete_modal/toaster) ×5 ロケール | Remove + Reuse（共有キー保持/移設） |
| **8** 左サイドバー→右チャット導線 | `interfaces/ui.ts:13-21`(`SidebarContentsType`); `SidebarNav/PrimaryItems.tsx:35,105-113`; `SidebarContents.tsx:26,47-52`; `chat-sidebar.tsx`(`openChat`/`openEditor`) | Missing（`openChat` を assistant 不要化 + 導線追加） |
| **9** thread 一覧存続 | mastra `ThreadList.tsx`(`useSWRxAiAssistants` 依存:7), `stores/thread.tsx`, `get-threads/delete-thread/get-messages` routes; Mastra Memory(MongoDBStore) | Reuse + Missing（assistant 依存除去） |
| **10** admin AI 連携整理 | `pages/admin/ai-integration.page.tsx:20,28`; `config-manager/config-definition.ts:8,53,78-79,265-275`(`app:aiEnabled`,`openai:*`,cron) | Reuse（mastra 用資格情報/`app:aiEnabled` 保持）+ Remove（assistant/vectorStore/cron 設定） |

---

## 3. 要件で未カバーの発見事項（要スコープ判断 / リスク）

> 要件 6 は「openai 由来コードを使う箇所を綺麗にする」と包括的に述べているが、以下は影響が大きく**設計前に方針確定が必要**。

1. **【重要】features/ai-tools/suggest-path が features/openai に依存** — `certifyAiService`(middleware), `OpenaiServiceType`, `getLlmClientDelegator`(client-delegator), `instructionsForInformationTypes` を import（`features/ai-tools/suggest-path/server/...` 5 箇所）。suggest-path（ページパス提案。product.md 記載の現行機能）は openai の LLM クライアント基盤を共有している。**openai を完全削除すると suggest-path が壊れる。** → suggest-path も mastra/ai-sdk ベースへ再配線するか、必要な LLM クライアント基盤を openai 外へ移設する必要がある。**Research Needed / 要スコープ合意。**
2. **ページライフサイクル連携** — `create-page.ts:21` / `update-page.ts:18` / `server/service/page/index.ts:34` が `isAiEnabled` を参照（旧: ページ更新時に vectorStore 同期をトリガ）。削除に伴い呼び出し除去が必要。
3. **ユーザー削除連携** — `server/routes/apiv3/users.js:11` が `deleteUserAiAssistant` を使用（ユーザー削除時にアシスタント削除）。除去が必要。
4. **起動時 normalize 処理** — `server/service/normalize-data/index.ts:1`（`normalizeExpiredAtForThreadRelations`）, `delete-vector-stores-orphaned-from-ai-assistant.ts`。除去が必要。
5. **【Constraint】過去マイグレーションがモデルを import** — `20241107172359-rename-pageId-to-page.js` が `VectorStoreFileRelationModel` を import。モデルファイル削除で**過去 migration が壊れる**ため、当該 migration を自己完結化（直接コレクション操作へ書換え）するか import を除去する必要がある。
6. **ページヘッダの起動ボタン削除** — `PageControls.tsx:365` の `OpenDefaultAiAssistantButton`（ページ右上から既定アシスタントchat起動）はアシスタント概念廃止に伴い削除。これも従来の「チャット起点」の一つ。
7. **エディターの unified merge view** — `PageEditor.tsx:30` の `useIsEnableUnifiedMergeView`（エディターアシスタントが diff 適用に使用）参照解消。
8. **チャット起動 atom の一本化** — 旧 `aiAssistantSidebarAtom` 廃止に伴い、エディターアシスタントトグル（`EditorAssistantToggleButton.tsx`）も削除。`openEditor()`（mastra）呼び出し元はこのボタンのみ → 連動して扱いを決定。
9. **generated/prisma モデル** — `vectorstores.ts`/`vectorstorefilerelations.ts`/`aiassistants.ts`/`threadrelations.ts` は生成物。Prisma schema 側の対応要否を確認（Research Needed）。

---

## 4. 実装アプローチ・オプション

### 論点 A: mastra が必要とする openai 由来資産の移設方法

- **Option A1（移設）**: `isAiEnabled` / 必要な型・i18n を `features/mastra`（または `@growi/core` / 共有 util）へ物理移設し、mastra は自前参照に切替。
  - ✅ openai を完全削除でき依存方向が綺麗 / ❌ 移設対象の見極めとテスト調整が必要
- **Option A2（暫定共存）**: openai の一部を残し段階削除。
  - ✅ 初期変更小 / ❌ 「features/openai を全廃」という Req1 に反する → **不採用推奨**
- **推奨**: A1。ただし「assistant 概念由来」UI/型（`AiAssistantHasId` 等）は移設ではなく**削除**し、mastra の chat/thread を assistant 非依存モデルへ再設計する。

### 論点 B: suggest-path（ai-tools）の LLM クライアント基盤の扱い

- **Option B1**: suggest-path を mastra の ai-sdk provider（`get-openai-provider.ts`）ベースへ移行し、openai の client-delegator 依存を断つ。
  - ✅ openai 完全削除と整合 / ❌ suggest-path のスコープ追加（工数増）
- **Option B2**: client-delegator / `certifyAiService` 等の共通 LLM 基盤を `features/openai` から中立な場所（例: `features/ai-tools` 配下 or 新 `ai-core`）へ移設し、両者が参照。
  - ✅ suggest-path のロジック改変は最小 / ❌ 「openai 由来コードを綺麗にする」観点で命名・配置の再設計が必要
- **推奨**: **要ユーザー判断**。本仕様のスコープに suggest-path 移行を含めるか、別仕様に切り出すかを設計前に確定する。含めない場合は Req1「全廃」と矛盾するため、要件側で例外を明記する必要がある。

### 論点 C: 新チャット導線と openChat シグネチャ変更

- **Option C1**: `openChat(aiAssistantData, threadId?)` を `openChat(threadId?)` 等、assistant 不要シグネチャへ変更。左サイドバー nav（`PrimaryItems`/`SidebarContents`）の AI_ASSISTANT パネルを「スレッド一覧 + 新規チャット起動ボタン」に再構成。
  - ✅ Req5/8/9 を一体で満たす / ❌ `openChat`/`openEditor` 全呼び出し元（ThreadList, AiAssistantList[削除], OpenDefaultAiAssistantButton[削除], EditorAssistantToggleButton[削除]）の同時改修が必要
- **推奨**: C1。AI_ASSISTANT という enum 名は維持しつつ、パネル内容を assistant 非依存へ。

### 論点 D: マイグレーション設計

- 新規 migration（`src/migrations/<ts>-drop-openai-collections.js`）で 4 コレクションを drop（存在しない場合も冪等に成功）。`down` はベストエフォート（再作成不要、no-op 可）。
- 過去 migration（`20241107172359-*`）のモデル import 除去（**論点 B/A と同時に対応必須**）。

---

## 5. 工数・リスク

| 区分 | Effort | Risk | 根拠 |
|------|--------|------|------|
| openai 削除 + 参照整理（mastra/layout/editor/admin/page hooks/user/normalize/route/cron） | **L (1–2週)** | Medium | 参照点が 50+、横断的だが機械的。型・i18n 移設の見極めが要点 |
| mastra の assistant/vectorStore 依存除去 + openChat 再設計 | **M** | Medium | UI と server 契約の同時変更。thread の既存データ互換に注意 |
| 新左サイドバー導線 | **S–M** | Low | 既存 SidebarContents 拡張パターンに沿う |
| suggest-path の脱 openai（論点 B 採用時） | **M–L** | **High** | LLM クライアント基盤の移設は影響範囲が読みにくい。未確定スコープ |
| i18n 削除（5 ロケール × 2 namespace、共有キー保持） | **S** | Low | 共有 `ai_assistant_substance.*` の取り違えに注意 |
| マイグレーション + 過去 migration 自己完結化 | **S–M** | Medium | 過去 migration を壊さない順序・テストが必要 |
| **全体** | **L〜XL** | **Medium〜High** | suggest-path スコープ次第で XL/High に振れる |

---

## 6. 設計フェーズへの推奨

**推奨アプローチ**: 論点 A1 + C1 + D を基本線とし、削除は「依存方向の末端（UI・route・cron）→ サービス → モデル → i18n」の順で段階的に。

**設計前に確定すべき決定**:
1. **suggest-path（features/ai-tools）の脱 openai を本仕様に含めるか**（論点 B）。含めないなら Req1「全廃」に対する明示的例外が必要。→ **要ユーザー合意**
2. 旧 `aiAssistantSidebarAtom` 廃止に伴う **エディターアシスタントトグル/`openEditor` の完全削除**確認（エディターから AI 編集導線が消えることの確認）。
3. mastra `openChat` の新シグネチャと AI_ASSISTANT 左パネルの新構成（新規チャットボタン + thread 一覧）。

**Research Needed（設計時に調査）**:
- Prisma schema における 4 モデルの定義有無と削除要否（generated 物との整合）。
- mastra thread の `metadata.aiAssistantId` を参照している箇所（`get-or-create-thread.ts` 等）の assistant 非依存化方法と既存スレッド後方互換。
- client-delegator / embeddings / `certifyAiService` のうち suggest-path 以外の隠れた利用者の有無。
- `config-definition.ts` の `openai:*` / `app:aiEnabled` / cron 設定キーのうち、mastra 継続に必要な最小集合の切り分け。
