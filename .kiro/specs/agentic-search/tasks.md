# Implementation Plan

- [ ] 1. Foundation: 共有型定義、リクエストスコープ化、user / searchService 伝搬の確立
- [x] 1.0 共有型定義ファイルの新設 (`services/mastra-modules/types/request-context.ts`)
  - 新規ファイル `apps/app/src/features/mastra/server/services/mastra-modules/types/request-context.ts` を作成
  - `import type { IUserHasId } from '@growi/core'` と `import type SearchService from '~/server/service/search'` を追加（`SearchService` は default export、[search.ts:673](apps/app/src/server/service/search.ts#L673) で確認済み）
  - `export type MastraRequestContextShape = { vectorStoreId: string; user: IUserHasId; searchService: SearchService }` を export
  - 短い JSDoc を付与し、「`user` は認証ミドルウェア通過後の `req.user` をそのまま載せる」「tool 側で `_id` のみ取り出す / `User.findById` 再解決は不要」を明文化
  - 型ファイル単独のため tests は不要。lint / typecheck で構文確認のみ
  - 観察可能完了: post-message.ts および各 tool ファイルが `import type { MastraRequestContextShape } from '...'` で参照可能になる。`pnpm run lint:typecheck` が通る
  - _Requirements: 3.1, 3.2, 3.3, 6.6_
  - _Boundary: Shared Types (MastraRequestContextShape)_

- [x] 1.1 post-message handler の RequestContext をリクエストスコープ化し user / searchService をセット
  - 既存のモジュールスコープ `const requestContext = new RequestContext<...>()` 定義を削除
  - `import type { MastraRequestContextShape } from '../services/mastra-modules/types/request-context'` を追加
  - ハンドラ関数内で `new RequestContext<MastraRequestContextShape>()` を生成（リクエストスコープ化、並列リクエスト干渉防止）
  - `requestContext.set('vectorStoreId', vectorStoreId)` の直後に以下 2 つの set を追加:
    - `requestContext.set('user', req.user)` ← `req.user` は `loginRequiredStrictly` 通過後 `IUserHasId` として確定済み
    - `requestContext.set('searchService', crowi.searchService)` ← route factory 引数 `crowi` から取得
  - 既存ミドルウェアチェーン（accessTokenParser / loginRequiredStrictly / validator）と AI SDK ストリーミング応答層（`toAISdkStream` / `createUIMessageStream` / `pipeUIMessageStreamToResponse`）には一切触れない
  - 観察可能完了: 認証済みリクエスト下で tool 実行時の `context.requestContext.get('user')` が `req.user` と参照同一の `IUserHasId` を返し、`get('searchService')` が `crowi.searchService` の同一インスタンスを返し、`vectorStoreId` も従来通り取得できる。ストリーミング応答に関するコードは差分に含まれない。`MastraRequestContextShape` の key を 1 つでも set 忘れすると typecheck で警告される
  - _Requirements: 3.1, 3.4, 5.4, 6.6_
  - _Boundary: Post-Message Handler_
  - _Depends: 1.0_

- [ ] 2. Core: ES 全文検索 tool の実装とテスト
- [x] 2.1 ES 全文検索 tool 本体の実装
  - `createTool` を用いて Mastra tool を新設
  - 入力 zod schema: `query: z.string().min(1)`、`limit?: z.number().int().positive().max(20).default(10)`
  - **`query.describe()` には `SearchService.parseQueryString` が解釈する全演算子を例示する**（`"phrase"` / `-word` / `-"phrase"` / `prefix:/path` / `-prefix:/path` / `tag:foo` / `-tag:foo`）。design.md「サポートするクエリ構文」の表と一致させる
  - 出力 zod schema を discriminated union（`'ok' | 'error' | 'context_error'`）で表現
  - **共有型を import**: `import type { MastraRequestContextShape } from '../types/request-context'`、`import type { RequestContext } from '@mastra/core/request-context'`
  - execute 内で `const ctx = context.requestContext as RequestContext<MastraRequestContextShape>` で型付きキャストした後、`ctx.get('user')` と `ctx.get('searchService')` を取り出す。**`crowi` を import しない**（依存方向: HTTP Layer → Tool Layer の片方向を維持）
  - 取得した値で以下のガードを順に評価し、いずれかに該当したら早期 return:
    - `user` または `searchService` が `undefined` → `result: 'context_error'`
    - `searchService.isElasticsearchEnabled === false` → `result: 'error', reason: 'elasticsearch_not_configured'`（`searchKeyword` は呼ばない）
  - ガード通過後、**`requestContext.get('user')` の戻り値（`IUserHasId`）をそのまま** `searchService.searchKeyword(query, null, user, null, { limit })` に渡す。合成 user (`{ _id: ObjectId }`) の組み立て、`User.findById` での再解決は行わない（design.md 「Implementation Notes」記載の方針）
  - **`query` を tool 層でサニタイズ・改変しない**: `prefix:` / `tag:` / `"..."` / `-` 等の演算子はそのまま `searchService.searchKeyword` の第 1 引数に渡し、`parseQueryString` に解釈させる（Plan A: design.md「サポートするクエリ構文」参照）
  - 戻り値は **タプル `[ISearchResult, delegatorName]`** として分解し、`result.data[i]` から以下のマッピングで `hits` を組み立てる: `pageId ← _id` / `pagePath ← _source.path` / `snippet ← _highlight?.body?.[0]` / `totalCount ← result.meta.total`
  - **`_source` を spread しない**: ES に index 済みの `body`（Markdown 本文）が混入しないよう、必要フィールドだけを明示的に取り出す（要件 6.5 と役割分離の維持）
  - execute からは例外を throw せず、try/catch で SearchService 例外を `result: 'error'` に変換
  - 観察可能完了: 5 ケース（空クエリ拒否 / context 欠如 / ES disabled / SearchService 成功 / SearchService 例外）すべてで対応する `result` 値が返り、`ok` 時の `hits` 配列に `pagePath` が含まれ、`body` を含むキーが一切現れない
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 3.2_
  - _Boundary: FullTextSearchTool_
  - _Depends: 1.0_

- [x] 2.2 (P) ES 全文検索 tool の unit test
  - **モック構造**: `requestContext` に `user` (`IUserHasId` 形状の最小 mock) / `searchService` (object) を任意に set/未 set できるテストハーネスを用意。`searchService` は `{ isElasticsearchEnabled: boolean, searchKeyword: vi.fn() }` の最小形を持つ
  - 以下 5 種の result を網羅:
    1. **空クエリ拒否**: `query: ''` で zod 段階拒否（execute 未到達）
    2. **context 欠如 (user)**: `user` 未 set → `result: 'context_error'`
    3. **context 欠如 (searchService)**: `searchService` 未 set → `result: 'context_error'`
    4. **ES disabled**: `searchService.isElasticsearchEnabled === false` → `result: 'error', reason: 'elasticsearch_not_configured'`、**`searchKeyword` が呼ばれないことを assert**
    5. **SearchService 例外**: `searchKeyword.mockRejectedValue(...)` → `result: 'error'`、execute が throw しない
  - 成功ケース: `searchKeyword.mockResolvedValue([{ data: [...], meta: { total } }, 'delegator'])` で戻り値マッピングを assert
  - 戻り値マッピングで `body` が削除されること、`pagePath` / `pageId` / `snippet` が正しく抽出されることを assert
  - **`user` 参照同一性の assert**: `requestContext.set('user', mockUser)` でセットした `mockUser` オブジェクトが、`searchKeyword.mock.calls[0][2]` と `===` で一致すること（合成 user に組み替えていない、`User.findById` でも置き換えていない）を確認（design.md test #8、要件 6.7 / Issue 1 C 案の回帰防止）
  - **クエリ構文の素通し**: `query` に `prefix:/docs -draft tag:meeting "release notes"` 等の演算子を含む文字列を渡した場合に、tool 層で文字列が改変されず `searchKeyword` の第 1 引数にそのまま渡ることを assert（サニタイザ不在の保証、Plan A 採用根拠の回帰防止）
  - 観察可能完了: `pnpm vitest run full-text-search-tool.spec` が緑、上記すべての挙動が assert される
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - _Boundary: FullTextSearchTool_
  - _Depends: 2.1_

- [x] 2.3 (P) ES 全文検索 tool の integration test
  - 実 MongoDB + Elasticsearch + SearchService で、`GRANT_PUBLIC` / `GRANT_OWNER` / `GRANT_USER_GROUP` の各 grant パターンを setup
  - 各パターンで認可ユーザー・非認可ユーザー（実 User ドキュメント）から tool を呼び、hits に含まれる/含まれないが期待通りであることを assert
  - ヒットなしクエリで `result: 'ok'` / `hits: []` / `totalCount: 0` を確認
  - 観察可能完了: `pnpm vitest run full-text-search-tool.integ` が緑、grant 反映が ES 経由で確認される
  - _Requirements: 6.1, 6.7_
  - _Boundary: FullTextSearchTool_
  - _Depends: 2.1_

- [ ] 3. Core: ページ本文取得 tool の実装とテスト
- [x] 3.1 ページ本文取得 tool 本体の実装
  - `createTool` を用いて Mastra tool を新設
  - 入力 zod schema を「pageId, pagePath いずれかが必須」になるよう `refine` で表現
  - 出力 zod schema を discriminated union（`'ok' | 'not_found_or_forbidden' | 'missing_input' | 'context_error'`）で表現
  - **共有型を import**: `import type { MastraRequestContextShape } from '../types/request-context'`、`import type { RequestContext } from '@mastra/core/request-context'`
  - execute 内で `const ctx = context.requestContext as RequestContext<MastraRequestContextShape>` で型付きキャストした後、`ctx.get('user')` を取り出し、**`IUserHasId` をそのまま** `Page.findByIdAndViewer` または `Page.findByPathAndViewer` の第 2 引数に渡す。合成 user (`{ _id: ObjectId }`) の組み立て、`User.findById` での再解決は行わない（design.md 「Implementation Notes」記載の方針）
  - 取得結果から revision を populate し `body`（Markdown 改変なし）/ `path` / `updatedAt` を返す
  - execute からは例外を throw せず、4 種の result すべてを戻り値で表現する
  - 観察可能完了: 入力欠如・context 欠如・取得失敗・成功の 4 ケースで、それぞれ対応する `result` 値が返り、`ok` 時のみ `page` フィールドが含まれる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 3.3, 5.3_
  - _Boundary: GetPageContentTool_
  - _Depends: 1.0_

- [x] 3.2 (P) ページ本文取得 tool の unit test
  - Page モデルをモックし、4 種の result（ok / missing_input / context_error / not_found_or_forbidden）を網羅
  - **context 欠如 (user)**: `requestContext.get('user')` が `undefined` のとき `result: 'context_error'` を返す
  - `pageId` 指定で `findByIdAndViewer` が、`pagePath` 指定で `findByPathAndViewer` が呼ばれることを assert
  - **`user` 参照同一性の assert**: `requestContext.set('user', mockUser)` でセットした `mockUser` オブジェクトが、`findByIdAndViewer` / `findByPathAndViewer` の第 2 引数と `===` で一致すること（合成 user に組み替えていない）を確認（要件 2.7 / Issue 1 C 案の回帰防止）
  - 成功ケースで `body` が改変されないことを確認
  - Mongoose の reject を mock しても execute が throw せず共通失敗戻り値を返すことを確認
  - 観察可能完了: `pnpm vitest run get-page-content-tool.spec` が緑、上記すべての挙動が assert される
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 3.3_
  - _Boundary: GetPageContentTool_
  - _Depends: 3.1_

- [x] 3.3 (P) ページ本文取得 tool の integration test
  - 実 MongoDB + 実 Page/Revision モデルで、`GRANT_PUBLIC` / `GRANT_OWNER` / `GRANT_USER_GROUP` / `GRANT_RESTRICTED` の各 grant パターンを setup
  - 各パターンで認可ユーザー・非認可ユーザー（実 User ドキュメント）から tool を呼び、期待 `result` を返すことを assert
  - 存在しない `pageId` で `not_found_or_forbidden` を返すこと（権限なしと区別されないこと）を assert
  - 既存 `page.integ.ts` の `findByIdAndViewer` テストの fixture / setup パターンを踏襲
  - 観察可能完了: `pnpm vitest run get-page-content-tool.integ` が緑、上記 grant パターンと存在しない pageId の挙動が確認される
  - _Requirements: 2.1, 2.2, 2.4, 2.7_
  - _Boundary: GetPageContentTool_
  - _Depends: 3.1_

- [x] 3.4 ページ本文取得 tool を行ベース pagination + outline 抽出に拡張 (token 消費対策, PR #11204 FB)
  - **依存追加 (実装着手の前提)**: `apps/app/package.json` の `dependencies` に `mdast-util-to-string` (`^4.0.0`) を **1 パッケージのみ** 新規追加し、root から `pnpm install` を実行して lockfile を更新。Turbopack 観点では server-side runtime import なので `dependencies` (production) として追加すること (`devDependencies` は不可、`.claude/rules/package-dependencies.md` 参照)。`mdast-util-from-markdown` は既存 direct dep、`unist-util-visit` は既存 `xsv-to-table.ts` と同様に pnpm hoist 経由で resolve させる方針 (本 PR では明示追加しない)
  - input zod schema に以下を追加: `offset: z.number().int().positive().optional()` (1-indexed 開始行)、`limit: z.number().int().positive().max(500).optional().default(200)`、`includeOutline: z.boolean().optional()`
  - output schema の `page.body` を `page.content` にリネームし、`totalLines: number`、`offset: number` (sanitize 後 echo)、`limit: number` (同)、`hasMore: boolean`、`outline?: OutlineEntry[]` (optional) を追加。`OutlineEntry = { line: number; level: 1|2|3|4|5|6; heading: string }`
  - execute 内で `String(page.revision.body).split(/\r?\n/)` → `Array.slice(offset-1, offset-1+limit)` → `join('\n')` で content 構築 (1-indexed → 0-indexed 変換)
  - `outline` 抽出は `mdast-util-from-markdown` で MDAST を構築し、`unist-util-visit` で `'heading'` ノードを訪問、`mdast-util-to-string` で text を抽出。`node.position.start.line` / `node.depth` から `OutlineEntry` を組み立てる
  - ATX heading (`# ...`) / Setext heading (`title\n===` / `title\n---`) の両方を抽出。コードブロック (fenced / indented)、HTML block 内の `#` 行は AST レベルで自動的に除外される (front matter の解釈は extension 無しで実施するため、内部の `#` 行を抽出する可能性があるが許容、design review #4 / design.md L699 注釈参照)
  - 型 narrowing: `requestContext.get('user')` の戻り値は **既存の `as TypedRequestContext` キャスト pattern を維持** する (Tasks 3.1-3.3 と同じ)。`isIUserHasId` type guard 化は本 PR の保留 task で後続対応 — Task 3.4 内では取り組まない (design review #5)
  - `outline` を含める条件: `includeOutline === true` のとき必ず含める / `includeOutline === false` のとき必ず省略 / `includeOutline` 省略時は `offset == null || offset === 1` (= ページ先頭からの初回読み出し) のとき含める。`offset: 1` 明示と省略を等価扱いすることで agent の型推論が罠にならないようにする (design review #2)
  - `hasMore` の計算は 0-indexed 等価式 `const endIdx = (offset - 1) + sliced.length; hasMore = endIdx < totalLines;` で実装。境界 3 点 (`offset === totalLines` / `offset === totalLines - limit + 1` / `offset > totalLines`) を実装中に意識する (design review #3)
  - `offset > totalLines` の場合は `result: 'ok'`、`content: ''`、`hasMore: false` を返す (エラー化しない)
  - `Page.findByIdAndViewer` / `Page.findByPathAndViewer` / `populateDataToShowRevision` 呼出経路は不変
  - 観察可能完了: 1000+ 行の long-body page に対する default 呼出で `content` の行数 ≤ 200 / `totalLines === 1000+` / `hasMore === true` / `outline` に複数 heading entry が含まれる。`offset: 500, limit: 100` 呼出で行 500-599 が `content` に返り、`outline === undefined` (auto なし)
  - _Requirements: 2.5, 2.8, 2.9, 2.10, 2.11_
  - _Boundary: GetPageContentTool_
  - _Depends: 3.1_

- [x] 3.5 (P) ページ本文取得 tool の unit test を新仕様に追従 + ケース追加
  - **既存 9 件の改修範囲を分類して網羅** (design review #6):
    - **success path 2 件** (pageId / pagePath): `body` → `content` リネーム + `totalLines` / `offset` / `limit` / `hasMore` / `outline?` の echo を assert。短い mock body の場合は `hasMore: false` / `outline: []` または auto-include 条件次第
    - **参照同一性 2 件** (`findByIdAndViewer` / `findByPathAndViewer` の 2nd 引数 `=== mockUser`): input 側の assertion なので **変更なし**
    - **例外変換 1 件** (Mongoose mock reject → `result: 'not_found_or_forbidden'`): 戻り値が failure 系で `page` フィールド不在を assert (`content` / `body` どちらも存在しないこと)
    - **null 返却 2 件** (findByIdAndViewer / findByPathAndViewer null → `not_found_or_forbidden`): 既存 assertion 維持
    - **zod refine 1 件** (pageId / pagePath 両欠如 → `missing_input`): 既存 assertion 維持
    - **context guard 1 件** (user 欠如 → `context_error`): 既存 assertion 維持
    - **`assertOk` / `assertFailure` helper の narrowing 先 type を更新** (新 `GetPageContentOkResult` = `{ result: 'ok', page: { path, updatedAt, content, totalLines, offset, limit, hasMore, outline? } }`)
  - 新規ケース: `offset` 省略時 default `1` / `limit` 省略時 default `200` (output echo で確認)
  - 新規ケース (`hasMore` 境界 3 点): `offset === totalLines` で `sliced.length === 1` + `hasMore === false`、`offset === totalLines - limit + 1` で `hasMore === false` (ちょうど末尾まで読了)、`offset > totalLines` で `content: ''` + `hasMore: false` を返し `result: 'ok'`
  - 新規ケース: `offset` 省略時 **および** `offset: 1` 明示時のいずれも default で `outline` が response に含まれる、`offset > 1` のとき default では含まれない (auto-include trap 回避の回帰防止)
  - 新規ケース: `includeOutline: true` を明示すると `offset > 1` でも outline 含む。`includeOutline: false` を明示すると `offset` 省略 / `offset: 1` でも outline は省略される
  - 新規ケース: code fence / indented code block / HTML block 内の `#` 行は outline に含まれない (mdast の AST 判定)
  - 新規ケース: `heading` text は `mdast-util-to-string` でプレーン化される (`## **Bold** [Link](url)` → `'Bold Link'`)
  - 新規ケース: Setext heading (`title\n====`) も level 1 として抽出され、`line` がテキスト行を指す
  - 新規ケース: heading 0 個のページで `outline: []` を返す
  - 新規ケース: CRLF 改行のページが正しく split され、`totalLines` / `content` が期待通り
  - 新規ケース: `limit > 500` は zod boundary で reject (Mastra validation envelope) され execute に到達しない
  - 観察可能完了: `pnpm vitest run get-page-content-tool.spec` が緑 (現状 9 件 + 新規 ~9-10 件 = 計 18-19 件)
  - _Requirements: 2.5, 2.8, 2.9, 2.10, 2.11_
  - _Boundary: GetPageContentTool_
  - _Depends: 3.4_

- [x] 3.6 (P) ページ本文取得 tool の integration test を新仕様に追従 + ケース追加
  - **既存 14 件の改修範囲を分類して網羅** (design review #6):
    - **GRANT_PUBLIC / OWNER / USER_GROUP / RESTRICTED 系 (10 件程度)** の seed body は短い (1-2 行) ため、`page.body` 期待値を `page.content` に置き換えつつ、新規フィールド `totalLines: 1 or 2` / `offset: 1` / `limit: 200` / `hasMore: false` / `outline: []` (heading 無し seed のとき) を新たに assert
    - **non-existent page 系 (2 件程度)** の failure 系: `result: 'not_found_or_forbidden'` のみ assert (`page` フィールド不在のままで OK、変更なし)
    - **pagePath grant 系 (2 件程度)** も上記 GRANT 系と同じパターンで content + 新規フィールド対応
    - **assertOk helper の narrowing 先 type を新形に更新** (spec test と同じ型定義を共有)
  - 新規ケース: 長文 seed page (300+ 行、複数 heading を含む) に対して `offset: 200, limit: 100` で行 200-299 が `content` に返る
  - 新規ケース: 同 page に対して `offset` 省略時 `outline` に複数の heading entry (`line` / `level` / `heading`) が含まれる
  - 観察可能完了: `pnpm vitest run get-page-content-tool.integ` が緑 (現状 14 件 + 新規 ~2 件 = 計 16 件、既存 14 件は output shape 拡張に追従済み)
  - _Requirements: 2.5, 2.8, 2.9, 2.10, 2.11_
  - _Boundary: GetPageContentTool_
  - _Depends: 3.4_

- [ ] 4. Integration: agent 配線と instructions 調整
- [x] 4.1 (P) growiAgent への新 tool 2 つの無条件登録と既存 fileSearchTool の暫定無効化
  - `import { fullTextSearchTool } from '../tools/full-text-search-tool'` と `import { getPageContentTool } from '../tools/get-page-content-tool'` を追加
  - `tools` オブジェクトを `{ fullTextSearchTool, getPageContentTool }` で **無条件登録**。**ES 有効/無効の判定は agent 側で行わない**（tool execute 内 `searchService.isElasticsearchEnabled` ガードに委譲、Task 2.1 参照）。`growi-agent.ts` から `crowi` を import しない
  - 既存 `fileSearchTool` の `import` 行と `tools` 登録行をコメントアウト（ソースファイル本体は削除しない）
  - `instructions` の編集（既存トーン維持、英語短文）:
    - **既存の `- Use the fileSearch tool when the question relates to the user's wiki content.` 行をコメントアウト**（即時削除しない理由: `fileSearchTool` 復活時の rollback コストを下げる、要件 4.2 と同一方針）
    - 新規追記: 「wiki コンテンツ関連の質問はまず `fullTextSearch` tool でヒット候補を集め、必要に応じて `getPageContent` tool を呼んで引用パスを回答に含めよ」
    - 新規追記: 「`fullTextSearch` の `query` には自然言語に加えて `"phrase"` / `-word` / `prefix:/path` / `tag:foo`（および `-prefix:` / `-tag:`）を必要に応じて組み合わせて良い（全て AND）。subtree / タグ絞り込み・ノイズ除去に有用な場合に使う」
  - 既存の `memory` / `model` / `name` 等の設定は変更しない
  - 観察可能完了: `growiAgent.tools` のキー一覧に `fullTextSearchTool` と `getPageContentTool` が含まれ、`fileSearchTool` は含まれない。`instructions` 文字列に「全文検索 → 本文取得 → 引用パス」の利用順序と「`"phrase"` / `-word` / `prefix:` / `tag:` 等の演算子組み合わせ可」の旨が含まれ、コメントアウトされていない `Use the fileSearch tool` 行が存在しない
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_
  - _Boundary: growiAgent_
  - _Depends: 2.1, 3.1_

- [ ] 4.2 (P) growiAgent instructions に outline → drill-down ガイダンスを追記 (PR #11204 FB)
  - 既存の `getPageContent` 利用ガイダンスを以下のフローを示す英文に書き換える: 「初回呼出 (`offset` 省略) で outline + 先頭 200 行を取得 → outline の `line` 番号を使って次回の `offset` を指定し、目的セクションに直接ジャンプ → 巨大ページ全文を 1 度に読まないこと」
  - 既存の `fullTextSearch` 利用ガイダンス・演算子説明・コメントアウトされた `fileSearch` 行は維持
  - 既存テスト (`growi-agent.spec.ts`) の instructions 文字列検査 assertion を新表現に合わせて更新 (例: `outline` / `offset` / `first call` 相当語の存在チェック)
  - 観察可能完了: `growiAgent.instructions` 文字列に「outline」「offset」を含む drill-down ガイダンスが含まれ、コメントアウトされていない `Use the fileSearch tool` 行は依然として存在しない。`pnpm vitest run growi-agent.spec` が緑
  - _Requirements: 2.9, 2.10_
  - _Boundary: growiAgent_
  - _Depends: 3.4_

- [ ] 5. Validation: 静的チェックと任意の軽量統合テスト
- [x] 5.1 lint / typecheck / build の green 確認
  - `pnpm run lint:biome` を通過させる
  - `pnpm run lint:typecheck` を通過させる
  - `pnpm run build` を通過させる
  - 既存テストスイート（`turbo run test --filter @growi/app`）に退行がないことを確認
  - 観察可能完了: 4 コマンドすべて exit 0、コメントアウトされた fileSearchTool の import が lint warn を出さない
  - _Requirements: 4.3_

- [x]* 5.2 (P) (任意) 軽量 agent integration test
  - `growiAgent.tools` のキー一覧で `fullTextSearchTool` / `getPageContentTool` の存在と `fileSearchTool` の非存在を assert
  - `growiAgent.instructions` 文字列に対し以下を assert（FB Issue 2 の回帰防止）:
    - 「fullTextSearch → getPageContent → 引用パス」の利用順序を示す英語短文が含まれる
    - `query` 演算子（`prefix:` / `tag:` / `"..."` / `-`）の組み合わせ可能性が含まれる
    - **コメントアウトされていない `Use the fileSearch tool` 行が含まれない**（コメント行内の出現は許可、行頭の `//` または `<!--` を取り除いて検出する）
  - mock model を使って 1 ターン回し、agent が両 tool を tool として参照可能であることを確認
  - 観察可能完了: 該当 spec ファイルが緑、本 spec の暫定無効化（tool 登録 + instructions）と新 tool 2 つの登録の回帰防止が成立
  - _Requirements: 4.1, 6.1_
  - _Boundary: growiAgent_
  - _Depends: 4.1_

## Implementation Notes

- Task 2.3 (integ test) detected a real bug in Task 2.1's call to `searchService.searchKeyword`: passing `null` for `userGroups` caused `GRANT_USER_GROUP` pages to be invisible to members. `SearchService` does NOT auto-resolve groups (despite the original design.md line 504 claim). Fix: resolve `userGroups` inside `fullTextSearchTool.execute` via `UserGroupRelation.findAllUserGroupIdsRelatedToUser` + `ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser`, matching the canonical pattern at `apps/app/src/server/routes/search.ts:143-151`. `getPageContentTool` (Task 3.1) does NOT need this — `Page.findByIdAndViewer` takes only `user`.
- Task 2.3 の integ test は post-impl で **dummy `SearchDelegator` パターン** に切り替えた (commit 9c7e2665f2)。理由は GitHub Actions の通常 test workflow に `elasticsearch` service が無く (定義されているのは `reusable-app-prod.yml` の production build/launch のみ)、リポジトリ初の real ES integ test を CI に導入するコストに見合わなかったため。既存の `apps/app/src/server/service/search/search-service.integ.ts` と同じ慣例 (`searchService.nqDelegators[DEFAULT]` を dummy で override) に揃えた。実 ES での grant 反映や query DSL 検証は本 spec の責任範囲外 (`SearchService` / `ElasticsearchDelegator` の責務)。詳細は `full-text-search-tool.integ.ts` ヘッダーと design.md の Testing Strategy 節を参照。
- PR #11204 の review FB を受けて `getPageContentTool` を **行ベース pagination + outline** に拡張する方針を採用 (Plan A)。`Page.findByIdAndViewer` / `populateDataToShowRevision` 経路は不変、`String.split('\n')` → `Array.slice` および `mdast-util-from-markdown` ベースの outline 抽出 (ATX / Setext 両対応、コードブロック・HTML block 内 `#` の誤認なし。front matter は extension 無しで実施するため内部の `#` 抽出を許容) を **tool execute 内 (メモリ上)** で行う。仕様詳細 (1-indexed offset, default limit 200, max 500, outline auto-include on `offset == null || offset === 1`, heading text のプレーン化, no per-request cache 等) は本 spec の requirements.md AC 2.5/2.8-2.11 と design.md GetPageContentTool セクションを参照。実装は Task 3.4 / 3.5 / 3.6 / 4.2 として追加 (本 PR 内の follow-up commit で対応)。
