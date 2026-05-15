# Gap Analysis: agentic-search

_Generated: 2026-05-15_

本レポートは [requirements.md](./requirements.md) と既存コードベースの実装差分を明らかにし、design フェーズの方針決めに資することを目的とする。

---

## 1. 現状調査（Current State）

### 1.1 既存アセット（再利用候補）

| アセット | 場所 | 役割 |
|---|---|---|
| `growiAgent` | [agents/growi-agent.ts](apps/app/src/features/mastra/server/services/mastra-modules/agents/growi-agent.ts) | Mastra `Agent`。現状の `tools` は `fileSearchTool` 1 個のみ。本 spec で tool を増減 |
| `fileSearchTool` | [tools/file-search-tool.ts](apps/app/src/features/mastra/server/services/mastra-modules/tools/file-search-tool.ts) | OpenAI Files API ベースのベクトル検索 tool。本 spec で暫定無効化対象 |
| `post-message.ts` | [routes/post-message.ts](apps/app/src/features/mastra/server/routes/post-message.ts) | エンドポイント。`RequestContext<{ vectorStoreId }>` を構築し agent に渡す |
| `Page.findByIdAndViewer` | [server/models/page.ts:829-851](apps/app/src/server/models/page.ts#L829) | grant 込みでページ取得。`null` が返り得る |
| `Page.findByPathAndViewer` | [server/models/page.ts:695-718](apps/app/src/server/models/page.ts#L695) | 同上、path 指定版。オーバーロードあり |
| `addViewerCondition()` | server/models/page.ts:525-550 | grant 条件を MongoDB クエリに付加する内部ヘルパー |
| `populateDataToShowRevision()` | server/models/page.ts:666-667 | ページから revision を populate するヘルパー |
| Revision モデル | server/models/revision.ts | `body: { type: String, format: 'markdown' }` |
| `find-page-and-meta-data-by-viewer.ts` | server/service/page/find-page-and-meta-data-by-viewer.ts:89-98 | 「権限なし」を別途 `count()` クエリで判定する参考実装 |
| `page.integ.ts` | apps/app/src/server/models/page.integ.ts | `findByIdAndViewer` の grant 込みテスト例 |

### 1.2 既存パターン / 規約

- **Mastra tool 定義**: `createTool({ id, description, inputSchema (zod), outputSchema (zod), execute })`。`execute(inputData, context)` で `context.requestContext.get(key)` を取得
- **requestContext の型拡張**: 現状は `RequestContext<{ vectorStoreId: string }>` をモジュールスコープのシングルトンとして保持（[post-message.ts:40](apps/app/src/features/mastra/server/routes/post-message.ts#L40)）
- **テスト規約** ([vitest.workspace.mts](vitest.workspace.mts)): `*.spec.ts` = unit（環境 `node`）、`*.integ.ts` = integration（MongoDB globalSetup + migrate-mongo）
- **Mastra 配下にテストファイル 0 件**: 本 spec で初の test を書くことになる
- **Coding Style**: 名前付き export 推奨、kebab-case ファイル名、co-locate test

### 1.3 統合面

- 認証: `accessTokenParser` → `loginRequiredStrictly` → `apiV3FormValidator` ([post-message.ts:63-69](apps/app/src/features/mastra/server/routes/post-message.ts#L63-L69))。`req.user: IUserHasId` がここまでで保証されている
- ストリーミング: `toAISdkStream` → `createUIMessageStream` → `pipeUIMessageStreamToResponse`（変更不要）
- Memory: `growiAgent.getMemory()` + `getOrCreateThread()`（変更不要）

---

## 2. 要件-アセット対応マップ

| 要件 | 既存資産 / 必要アクション | ステータス |
|---|---|---|
| R1 #1-3 反復ループ（検索 → 本文 → 再検索） | Mastra agent の標準挙動。instructions で誘導 | **Constraint**: instructions の文言調整が必要 |
| R1 #4 想定プロンプト類型サポート | LLM の自律判断 + 既存全文検索 tool（前提） + 新本文取得 tool | **Missing**: 全文検索 tool 自体は別ブランチ前提だが、本 spec の検証には必要 |
| R2 #1-2 `pageId` / `pagePath` で本文取得 | `Page.findByIdAndViewer` / `Page.findByPathAndViewer` | **Constraint**: revision が populate されないため別途 populate 必要 |
| R2 #3 入力エラー（id/path どちらもなし） | zod schema の refine か execute 内で判定 | **Missing**: 新規実装 |
| R2 #4 存在しない / 閲覧不可で共通戻り値 | ⚠️ 既存メソッドは **「存在しない」と「閲覧不可」を区別不可**（両者とも `null`） | **Constraint かつ要件と合致**: 共通戻り値を返すのは自然 |
| R2 #5 Markdown 改変なし | revision.body は markdown 文字列で保存 | **Available**: そのまま返せる |
| R2 #6 ページパス必須 | findBy* の戻り値に `path` フィールドあり | **Available** |
| R2 #7 grant 自前実装禁止 | 既存メソッドへ委譲する設計のみで満たせる | **Constraint**: tool 内で MongoDB クエリを直書きしない |
| R3 #1-2 user 識別情報の伝搬 | `RequestContext<{ vectorStoreId; userId }>` 型拡張 + post-message.ts で `req.user._id.toString()` セット | **Missing**: 新規実装（小） |
| R3 #3 user 取得不可で本文返さない | tool 内 guard | **Missing**: 新規実装 |
| R3 #4 認証通過済みのみ tool 実行 | 既存ミドルウェア (`loginRequiredStrictly`) で達成済み | **Available** |
| R4 #1-3 `fileSearchTool` 暫定無効化 | `growi-agent.ts` の `tools` から外す（コメントアウト） | **Missing**: 1 行差分 |
| R5 #1-2 Markdown / 入力言語追従 | 既存 instructions で達成済み | **Available** |
| R5 #3 引用パス必須（`should`） | instructions 追記 | **Missing**: 文言調整 |
| R5 #4 ストリーミング応答 | `toAISdkStream` ですでに達成 | **Available** |

### 2.1 既知の落とし穴 / 制約

- ⚠️ **`findByIdAndViewer` / `findByPathAndViewer` は「権限なし」と「存在しない」を `null` 一本で表現する** — R2 #4 が「共通の戻り値」を求めているため要件には合致するが、運用観測上どちらか分かりたい場面が将来出る可能性あり（design で判断）。
- ⚠️ **`findByIdAndViewer` は `includeAnyoneWithTheLink: true` を内部固定** ([page.ts:715](apps/app/src/server/models/page.ts#L715)) — GRANT_RESTRICTED（リンクを知っている人）も取得可能。RAG 用途で agent に渡る範囲が広がる可能性を要件側で許容するか design で確認。
- ⚠️ **`requestContext` がモジュールスコープのシングルトン** ([post-message.ts:40](apps/app/src/features/mastra/server/routes/post-message.ts#L40)) — 同時並列リクエスト時に `set` が干渉する設計に見える。本 spec で「修正対象とするか / 既存挙動を踏襲するか」を design で決める必要あり。
- **revision の populate**: `Page.findByIdAndViewer` 直後では `revision` は ObjectId 参照のみ。`populateDataToShowRevision()` または `.populate('revision')` の追加コール必要。
- **Mastra 配下に既存テストが 0 件**: 本 spec で初の `.spec.ts` / `.integ.ts` を導入する。integration test は `page.integ.ts` のパターンを踏襲。
- **ゲストユーザー（`user = null`）の挙動**: 認証必須ミドルウェアで弾かれるため tool に到達することはない（R3 #4）。tool 内では `userId` 必須として扱える。

### 2.2 複雑度シグナル

- アルゴリズム的に複雑な処理は **なし**（既存メソッドへの委譲が主）
- 外部統合は **なし**（OpenAI / ES への直接呼び出しは tool 内に閉じる、または既存資産再利用）
- 主たる新規実装は: 新 tool 1 ファイル + agent 設定差分 + requestContext 型拡張 + post-message ハンドラ差分 + テスト数本

---

## 3. 実装アプローチ案

### Option A: 既存 file-search-tool.ts のパターンをそのまま踏襲（推奨）

**やり方**:
- `tools/get-page-content-tool.ts` を新規作成、`createTool` を使い `file-search-tool.ts` と同じ書式
- `growi-agent.ts` の `tools` に新 tool を追加、`fileSearchTool` をコメントアウト、instructions に 1-2 行追記
- `post-message.ts` の `RequestContext<>` ジェネリクスに `userId` を追加、`req.user._id.toString()` をセット
- テストは `.spec.ts`（zod 入出力 / モック）と `.integ.ts`（実 PageModel で grant 反映確認）の 2 本

**Trade-offs**:
- ✅ 既存パターンと完全一致、PR レビュー負荷小
- ✅ 既存 `fileSearchTool` と並列に置けるため将来削除/復活が容易
- ✅ 新規ファイル 1 つで責務が明確
- ❌ なし（特筆すべきデメリットなし）

### Option B: tool 共通基盤を抽出してから新設

**やり方**:
- `requestContext` の `userId` アクセスを共通ユーティリティ化 (`getUserIdFromContext()` 等)
- `createPageContentTool` ファクトリ関数を切り出し、テスト可能性を高める

**Trade-offs**:
- ✅ 将来 tool 数が増えた時に統一感
- ❌ 現時点で tool は 2 個（本文取得 + 全文検索）。共通化の費用対効果が薄い
- ❌ design / tasks のスコープが膨らみ、本 spec の本筋（agentic ループの確立）から離れる

### Option C: ハイブリッド（最小実装 + 後続リファクタ）

**やり方**:
- まず Option A で実装、動作確認後にフォローアップ別タスクで `fileSearchTool` 削除と共通基盤抽出を同時に検討
- フォローアップは本 spec のスコープ外

**Trade-offs**:
- ✅ 動作確認の安定後に共通化判断ができる
- ✅ 本 spec を小さく保てる
- ❌ Option A と実質同一（フォローアップを区別する意味付け以外の差はない）

---

## 4. 工数とリスク

- **Effort: S (1〜3 日)** — 既存パターン踏襲、新規ファイル 1 本+設定差分+テスト数本。アーキ的変更なし
- **Risk: Low** — 使用技術はすべて既知（Mastra `createTool`, Page モデル, vitest）。grant ロジックは既存メソッドに委譲するため新規セキュリティ面の不確実性低

主要な未確認点はあるが、いずれも局所的:
- requestContext のシングルトン挙動（並列リクエスト時の干渉）— 既存実装が許容している以上、本 spec で深掘りせず design でメモを残す程度
- revision populate のコスト（小） — ページ単位の取得なのでパフォーマンス的問題は出にくい

---

## 5. Design フェーズへの推奨事項

### 5.1 採用候補アプローチ

**Option A 推奨**。既存パターン踏襲・最小差分・テスト容易。

### 5.2 Design で確定すべき主要決定

1. **tool 出力スキーマの確定**: `{ path, body, updatedAt }` + 失敗時 `{ error: 'not_found_or_forbidden' }` のような形式か、`{ accessible: boolean, page?: {...} }` の判別共用体か
2. **入力スキーマ**: `z.object({ pageId, pagePath }).refine(...)` で「少なくとも一方必須」を表現するか、execute 内で判定するか
3. **revision populate の方法**: `populateDataToShowRevision()` を呼ぶか、`.populate('revision')` を直接書くか
4. **agent instructions の文言**: 全文検索 → 本文取得 → 引用、を促す英語短文（既存 instructions は短い）
5. **`fileSearchTool` 暫定無効化の見せ方**: 単純コメントアウト v.s. import は残して `tools: { /* fileSearchTool */ }` のみコメントアウト
6. **requestContext シングルトン問題の扱い**: 本 spec で修正するか、既存挙動を踏襲して別タスクに送るか（要件には現れないが design 上の選択）

### 5.3 Research Needed（design 中に確認）

- **R-1**: `findByIdAndViewer(null user)` の挙動（理論上到達しないが防御的に確認）
- **R-2**: Mastra ランタイムで `execute` が throw した場合、UI ストリームに何が流れるか（agent が再試行するか、エラーチャンクとして流れるか）
- **R-3**: GRANT_RESTRICTED（リンク共有）のページが agent の RAG コンテキストに混入することの是非（要件側の合意取得 or design で許容を明文化）
- **R-4**: `fileSearchTool` コメントアウト後、未使用 import / 未使用 dependency による lint / build エラーが出ないか

### 5.4 テスト戦略案

- **unit (`get-page-content-tool.spec.ts`)**: zod 入出力、execute の guard（id/path 不在 → エラー戻り値、userId 不在 → 失敗戻り値）、Page モデルをモックして戻り値変換確認
- **integration (`get-page-content-tool.integ.ts`)**: 実 PageModel と Revision を使い、GRANT_PUBLIC / GRANT_OWNER / GRANT_USER_GROUP / GRANT_RESTRICTED 各パターンで取得可否を確認。`page.integ.ts` の `findByIdAndViewer` テストを参考
