# Implementation Plan: ai-summarize

> **LLMテストダブルの共通方針**: 本specの全テストは実LLMを呼ばない。Agentをモック化し、tool-call / tool-result を偽の `data` で埋める方式を採る（design.md「Testing Strategy → LLM Test Double Strategy」を参照）。前例は `apps/app/src/features/ai-tools/suggest-path/server/integration-tests/suggest-path-agentic-integration.spec.ts`。各タスクの記述では、この方針に従うことを前提に固有の注意点のみを記す。

- [ ] 1. SummarizeAgent: 全文カバレッジ方針で単一ページを要約するAgentができる
- [ ] 1.1 LimitedGetPageContentTool: 読み取り行数バジェットが強制される
  - `RequestContext` の `pageReadBudget: { used: number; limit: number }` を読み、未設定時は `getPageContentTool` に委譲せず `context_error` を返す
  - `used >= limit` の場合は委譲せず `limit_exceeded` を返す（このとき `used`/`limit` は変更しない）
  - それ以外は既存の `getPageContentTool`（無変更）に委譲し、返された `content` の行数分だけ `used` を加算する
  - **`content` が `undefined` の場合は `used` に加算しない**（加算量0）。`content` が返らないのは (i) `offset` 省略かつ `totalLines > limit` のアウトラインのみ取得、(ii) `not_found_or_forbidden` 等の失敗応答 — いずれも本文行を消費していないため。`undefined` を空文字として扱う実装（実行時エラーや意図しない加算の原因）を避ける
  - 委譲結果の `hasMore` / `totalLines` は加工せずそのまま通す（Agentが段階的読み取りの判断に使う）
  - `getPageContentTool` 自体を一切変更しないことをdiffレビュー観点として明記する
  - 上記4パターン（未設定／上限到達／通常委譲＋加算／`content` undefined で非加算）をユニットテストで確認できる
  - _Requirements: 2.2, 2.3_

- [ ] 1.2 要約instructionsができる
  - **段階的な全文読み取り手順**を、`getPageContentTool` の実際の入出力契約に沿った具体手順として明文化する:
    - 初回呼び出しは `offset` を省略する。この呼び出しではアウトライン（見出し構成）と `totalLines` が返る
    - ページが1回分（`limit`、既定200行・最大500行）に収まる場合は、初回呼び出しで `content` と `hasMore`（`false`）も同時に返るため1回で読み終わる
    - ページが `limit` を超える場合、初回呼び出しは**アウトラインのみ**を返し `content` と `hasMore` はいずれも `undefined` になる。この `hasMore === undefined` を「偽だから読み終わった」と解釈してはならない（＝**まだ本文を1行も読んでいない**状態）。`totalLines` は見積り参考値として使うが、**打ち切り判定には使わない**
    - 2回目以降は `offset`（1始まりの行番号）を明示して先頭から順に読み進める。各呼び出しの結果の `hasMore` と、読み込んだ行数の累計を参考に次の `offset` を決める。**`content` が `undefined` 以外のときだけ行数を累積カウンタに加算する**
    - 打ち切り条件は3つのみ: `hasMore === false`（全文読了）／`limit_exceeded`（ハード上限到達）／`not_found_or_forbidden` 等の失敗。アウトラインだけを見て「構成が分かったので本文は読まない」と判断してはならない。`totalLines` の値で打ち切ってもいけない
    - `totalLines` はカバレッジ判定の**参考値**（残り行数の見積り・全文/部分の自己判断の材料）として使い、打ち切り条件の代替にはしない
  - 「`limitedGetPageContentTool` から `limit_exceeded` を受け取ったら打ち切り、部分的な内容に基づく旨を明示する」ことを明文化する
  - 「リード文1文＋主要ポイント3〜5個の箇条書き」という出力形式を明文化する
  - ユーザーの入力言語で応答する指示を含める
  - instructions文字列に上記4方針（段階的読み取り手順・打ち切り時の明示・出力形式・応答言語）の指示が含まれることをユニットテストで確認できる
  - _Requirements: 2.1, 3.1_

- [ ] 1.3 SummarizeAgentがMastraから取得できる
  - `limitedGetPageContentTool`（タスク1.1）のみをツールとして持ち、`memory`（既存のMongoDBStore、growiAgentと共有）に接続したAgent定義を作成する
  - ツールの登録**キー**を `getPageContentTool` にする（`tools: { getPageContentTool: limitedGetPageContentTool }`）。LLMに送られるツール名は `tools` レコードのキーであり、クロスAgentスレッド再生時に `growiAgent` の登録名と一致させるために必須
  - モデル解決は `post-message.ts` と同じ `resolveEffectiveModelKey` の丸め込みを経由し、リクエストの `modelKey` 省略時はデフォルトモデルへフォールバックする
  - Mastraインスタンスに `summarizeAgent` として登録し、`mastra.getAgent('summarizeAgent')` で取得できる
  - `growi-agent.ts` は一切変更しないことをユニットテスト（またはdiffレビュー観点の明記）で確認できる
  - _Requirements: 1.1, 2.3_
  - _Depends: 1.1, 1.2_

- [ ] 2. (P) AiSummarizeMetrics: 要約生成のたびにCounterがインクリメントされる
  - 既存の `custom-metrics/` ディレクトリのパターンに沿って、要約生成専用のCounterメトリクスを新規ファイルに実装する
  - **Counterはモジュールのトップレベルで生成しない**。`addAiSummarizeMetrics()` の内部で `metrics.getMeter()` を呼んでmeterを取得し、その中で `createCounter()` を実行してモジュールスコープの変数に束縛する。**このため、`addAiSummarizeMetrics()` が呼ばれるまで Counter は `undefined` のままであり、モジュール import だけでは `getMeter()` が実行されない**（モジュール評価時点ではOpenTelemetry SDKが未初期化のことがあり、トップレベルで取得すると no-op meter に永久に束縛されて計測が失われるため）
  - `setupCustomMetrics()` からの登録呼び出しを追加し、サーバ起動時（SDK初期化後）にCounterが初期化される
  - インクリメント用の関数を呼ぶとCounterの値が1増えることをユニットテスト（モックMeter/Counter使用）で確認できる
  - **`addAiSummarizeMetrics()` を呼んでいない状態（＝OpenTelemetry無効時）でインクリメント関数を呼んでも例外を投げず、静かに何もせずに戻ることをユニットテストで確認できる**（計測の欠落が要約機能そのものの失敗を引き起こしてはならない）
  - Counterが `addAiSummarizeMetrics()` の内部で生成されること、および`addAiSummarizeMetrics()` を呼ばずにインクリメント関数を呼んでも例外が発生しないことをユニットテストで確認できる
  - ユーザー識別情報・ページ内容を含まない属性のみを付与する
  - _Requirements: 6.1, 6.2_
  - _Boundary: AiSummarizeMetrics_

- [ ] 3. SummarizeMessageRoute: 要約を1回起動し既存の対話に合流できる
- [ ] 3.1 要約リクエストの妥当性が検証される
  - `pageId` と `pagePath` のいずれか一方が必須であることを検証するバリデータを実装する
  - `modelKey` に `post-message-validator.ts` と同じ型・長さ制約を課す
  - 両方欠落時にリクエストが400相当で拒否され、片方のみ指定時は通過することをユニットテストで確認できる
  - _Requirements: 1.3_

- [ ] 3.2 要約リクエストが新規スレッドでSummarizeAgentのストリーム応答を返せる
  - `summarizeAgent.stream()` を呼ぶ前に `Page.findByIdAndViewer`（既存、無変更）を1回呼び出す。これが**権限なし時の唯一の応答経路**であり、結果が `null` の場合は**ストリームを開始せず**、不存在と権限なしを区別しない単一の応答（403/404 のいずれか一方に統一）でその場で短絡する（検証はタスク4.1）
  - 結果が得られた場合は、その時点の `page.revision`（populate されていないため ObjectId そのもの。populate 済みの場合は `revision._id`）を `sourceRevisionId` として保持する
  - **`capturedAt` を、`sourceRevisionId` を取得するのと同じ時点（生成開始時点）に `new Date()` でサーバ側に生成する**（クライアントから受け取った日時は使わない）。ストリーム応答に含める
  - リクエストごとに新しい `threadId` を採番し、`getOrCreateThread`（既存関数、無変更）で新規スレッドを作成する（既存スレッドへの追記は行わない）
  - クライアントの自由入力を受け取らず、`pageId`/`pagePath` からサーバ側で固定形式の初期リクエストを組み立てて `summarizeAgent.stream()` に渡す
  - ストリーム応答に `threadId`・`sourceRevisionId`・**`capturedAt`** を含める
  - **`summarizeAgent.stream()` に渡す `RequestContext` をリクエスト毎に新規生成し**、その中の `pageReadBudget` も毎回 `{ used: 0, limit: 1500 }` の新規オブジェクトとする。モジュールスコープ・Agentインスタンス・シングルトンに保持したコンテキストやバジェットを再利用しない
  - `post-message.ts` の `maxSteps: 10` とは独立した `maxSteps: 15` を設定する（`pageReadBudget` 1500行 ÷ 1回最大500行 = 最小3ステップに対する安全弁）
  - `post-message.ts` と同型のUIメッセージストリーム（`createUIMessageStream`/`toAISdkStream`/`pipeUIMessageStreamToResponse`）で応答を返し、ストリームが正常終了した時点でのみタスク2のCounterをインクリメントする
  - モデル呼び出し失敗・ストリーム構築失敗時は、プロバイダ由来の一行メッセージのみを含む500を返し、スタックトレースやレスポンス本体を転送しないこと、かつこの失敗パスではタスク2のCounterをインクリメントしないことを統合テストで確認できる
  - ページ本文の取得が `limitedGetPageContentTool` 経由のツール呼び出しループのみで行われ、ルート層に本文の事前取得・直接DB参照が存在しないことをコードレビュー観点として明記する（`findByIdAndViewer` はメタデータと権限ゲートのみで、本文は読まない）
  - **統合テストのLLMモック**: `~/features/mastra/server/services/mastra-modules` を `vi.mock` し `{ mastra: { getAgent } }` を返す。偽Agentの `stream()` が `options.requestContext` を捕捉した上で**実物の `limitedGetPageContentTool.execute()` を実際に呼び**、`limit_exceeded` でループを抜ける。実物のツールは**バレル経由ではなく直接ファイルから**インポートする（バレル経由では `@mastra/core/agent` が引き込まれvitest下でロードできない）。認証ミドルウェアはデフォルトエクスポートを含めてモックし `req.user` を注入する。`Crowi` は `mock<Crowi>()` を使い型アサーションを避ける
  - 権限のあるページに対するリクエストが新規スレッドを作成しストリーム応答を返すことを統合テストで確認できる
  - **連続する2リクエストで捕捉した `requestContext` が別インスタンスであり、2回目の `pageReadBudget.used` が0から始まること（バジェット独立性）**を統合テストで確認できる
  - **応答に含まれる `capturedAt` が有効なISO Date Stringであり、リクエスト時刻の近傍であること**を統合テストで確認できる
  - _Requirements: 1.1, 1.2, 2.2, 4.1, 4.2, 7.2_
  - _Depends: 1.3, 2_

- [ ] 3.3 要約ルートがExpressに登録され、AI未設定時は既存ガードで利用不可になる
  - `routes/index.ts` の遅延ロードパターンに沿って `POST /_api/v3/mastra/summary` を追加登録する（既存の `router.use(aiReadyGuard)` の適用範囲内）
  - AI未設定・無効時に本ルートが501を返すことを統合テストで確認できる（既存の `aiReadyGuard` の回帰確認）
  - _Requirements: 5.1_

- [ ] 4. Integration & Validation（生成側）
- [ ] 4.1 権限のないページ／存在しないページへの要約要求が、ルート層で短絡し存在を明らかにしない
  - **権限のないページ・存在しないページの両方に対して要約を要求し、ルート層の `Page.findByIdAndViewer` が `null` を返した時点で 403（または404、実装で統一した側）で短絡することを統合テストで確認できる**
  - **ストリームが開始されないことを確認できる**（偽Agentの `stream()` モックが呼ばれていないこと、およびレスポンスがUIメッセージストリーム形式でないこと）
  - **2ケースで同一のステータスコード・同一の応答本文になり、ページの存在有無が判別できないことを確認できる**
  - ツール呼び出しループは権限のあるページに対してのみ到達するため、`getPageContentTool` の `not_found_or_forbidden` がストリーム内で返るのは、ゲート通過後にページが削除・権限変更された競合（TOCTOU）ケースに限られる。この二重防護は削除せず維持することをコードレビュー観点として明記する
  - _Requirements: 4.1, 4.2_
  - _Depends: 3.3_

- [ ] 4.2 要約完了後、同じスレッドで既存の対話に追質問を続けられる
  - 要約完了後に取得した `threadId` を使って既存の `POST /message` に追質問を送り、`growiAgent` がスレッド履歴（要約メッセージ）を認識して応答することを統合テストで確認できる
  - **クロスAgentスレッド再生の実証**（本リポジトリに前例がないため必須）: `summarizeAgent` のツール登録キーが `getPageContentTool` であること、および `growiAgent` が引き継いだスレッド履歴に含まれる tool-call のツール名が `growiAgent` の登録ツールセットに実在することを、偽の tool-call / tool-result `data` を使って確認できる
  - この経路で `growi-agent.ts` と `post-message.ts` の既存の挙動（`maxSteps: 10` を含む）が変化しないことを確認できる
  - _Requirements: 1.4, 2.3_
  - _Depends: 3.3_

- [ ] 4.3 長いページで読み取り量の上限に到達すると、打ち切りと部分要約である旨が明示される
  - 1500行を超える長いページのフィクスチャで、`limitedGetPageContentTool` が `pageReadBudget` の上限到達により `limit_exceeded` を返し、`maxSteps: 15` に達する前に打ち切りが発生することを確認できる
  - 実効の読み取り量が `limit` + 500 = 2000行を超えないことを確認できる（バジェット判定は呼び出し前のため、`limit` 未満の状態から1回分＝最大500行が通り得る許容幅）
  - 偽Agentが返す最終テキストに、部分的な内容に基づく旨の明示が含まれること、およびリード文1文＋主要ポイント3〜5個の箇条書き形式であることを確認できる（LLMの指示追従性そのものは検証対象とせず、ルート層・ツール層・ストリーム構築の挙動を検証する）
  - _Requirements: 2.1, 2.2, 3.1_
  - _Depends: 3.3_

- [ ] 4.4 同一ページへの同時要約リクエストが互いを破壊せず安全に処理される
  - 同一ページに対して短時間に2件の要約リクエストを送り、それぞれ独立したスレッドとして正常に処理され、状態の破壊や競合エラーが起きないことを統合テストで確認できる
  - **2件のリクエストで捕捉した `RequestContext` および `pageReadBudget` がそれぞれ新規インスタンスであり、一方の読み取りが他方の `used` を消費していないことを確認できる**（バジェット独立性。バジェットがリクエスト間で漏れない）
  - 偽Agentの `stream()` が2件の呼び出しでそれぞれ別の `requestContext` を受け取ることを、モックで捕捉した値の同一性比較で確認できる
  - 要約は状態を書き換えないため、サーバ側の新規ロック機構は追加しない設計であることを踏まえたテストとする
  - 重複生成の抑止（送信中の再送信を防ぐUX）は、要約トリガーUIコンポーネント（別PR、本specのスコープ外）側の実装に依存することをテストの説明に明記する
  - _Requirements: 1.5_
  - _Depends: 3.3_

- [ ] 5. PageAiSummaryField: Pageスキーマが要約を保持できる
  - `apps/app/src/server/models/page.ts` に `aiSummary: { body: String, sourceRevisionId: ObjectId, capturedAt: Date }`（デフォルト `null`）を追加する
  - **`apps/app/prisma/schema.prisma` の `model pages` に `aiSummary` フィールドを追加し、Prismaの型生成（出力先 `src/generated/prisma`）が成功することを確認できる**。`Page` モデルはMongooseからPrismaへの移行途上（`.claude/rules/model.md`）であり、Mongoose側だけを更新すると型不整合が後から表面化するため両方を同時に更新する。埋め込みオブジェクトの表現は同スキーマ内の既存の埋め込みフィールド（`grantedGroups` が `Json?`）と同じ扱いに揃える
  - `packages/core/src/interfaces/page.ts` の `IPage` に同じ形の型を追加する
  - **`npx changeset` で Changeset を作成する**（`@growi/core` は公開パッケージであり `.claude/rules/project-structure.md` により必須）
  - 既存のPageモデルのユニットテストが引き続き通ることを確認できる
  - _Requirements: 7.1, 7.2, 7.4, 8.1, 9.2_
  - _Boundary: PageAiSummaryField_

- [ ] 6. AiSummaryPersistenceRoute: 要約の保存ができる（削除・非表示はサーバAPIを持たず、タスク7でクライアントローカルに実現する）
- [ ] 6.1 要約保存リクエストの妥当性が検証される
  - `body` の長さ上限、`sourceRevisionId` のObjectId形式を検証するバリデータを実装する
  - **`capturedAt` が有効なISO 8601 Date Stringとしてパース可能であること（`Date` に変換して `Invalid Date` にならないこと）を検証する**。パース不能な文字列・数値・オブジェクト等は400で拒否する。値そのものが「本当に生成時刻か」は検証しない（改変された場合の影響は表示文言の日時が不正確になることに限られ、権限やデータ整合性には影響しない）。**タスク3.2で返された`capturedAt`の形式（ISO Date String）とここでの検証形式の対応を確認できる**
  - 上限超過・ObjectId形式不正・**`capturedAt` パース不能**のそれぞれで400相当で拒否され、正常値は通過することをユニットテストで確認できる
  - _Requirements: 7.1, 7.2_

- [ ] 6.2 要約が保存され、既存の永続化要約を置き換えられる
  - `Page.findByIdAndViewer` で権限確認後、クライアントから受け取った `aiSummary.body`・`aiSummary.sourceRevisionId`・`aiSummary.capturedAt` をそのまま保存する（サーバ側でrevisionや日時を導出し直さない）
  - 既に永続化済みの要約がある場合は新しい内容で置き換わることを統合テストで確認できる
  - 権限のないページ・存在しないページへの保存要求が `not_found_or_forbidden` を返すことを確認できる
  - _Requirements: 7.1, 7.2, 7.4_
  - _Depends: 5, 6.1_

- [ ] 6.3 保存ルートが書き込み権限とレート制限で保護される
  - ハンドラファクトリに以下を順に適用する: `accessTokenParser([SCOPE.WRITE.FEATURES.PAGE])` → `loginRequiredStrictly` → `excludeReadOnlyUser` → バリデータ（タスク6.1）＋ `apiV3FormValidator` → 本体ハンドラ
  - `loginRequiredStrictly` は export された名前ではなく、`import loginRequiredFactory from '~/server/middlewares/login-required';` のデフォルトエクスポートから `loginRequiredFactory(crowi)` でハンドラファクトリ内にローカル生成する（第2引数 `isGuestAllowed` の既定値 `false` が「strictly」の意味）
  - `excludeReadOnlyUser` は `~/server/middlewares/exclude-read-only-user` の named export をそのまま使う
  - `findByIdAndViewer` は**閲覧**権限しか判定しないため、これらのミドルウェアの代替にはならないことをコードレビュー観点として明記する
  - **レート制限を `apps/app/src/features/rate-limiter/config/index.ts` の `defaultConfigWithRegExp` にエントリ追加で実装する**（`pageId` を含む動的パスのため完全一致マップ `defaultConfig` ではなく正規表現マップを使う。`/_api/v3/page/[^/]+/ai-summary`、`POST`、`MAX_REQUESTS_TIER_1`）。GROWIのレート制限は `app.use(rateLimiterFactory())` として全体に1回適用される方式であり、ルートにミドルウェアを差し込む実装にはしない。独自の数値をハードコードせず既存のティア定数を使う
  - **統合テスト**: 未ログイン（ゲスト）からの保存が拒否されること、読み取り専用ユーザーからの保存が403で拒否されること、いずれの場合も `Page.aiSummary` が書き込まれていないことを確認できる
  - **統合テスト（レート制限）**: 設定した上限を超える回数の保存リクエストを短時間に送ると、上限超過分が **429** を返し、上限内のリクエストは正常に処理されることを確認できる
  - _Requirements: 7.1_
  - _Depends: 6.2_

- [ ] 6.4 要約を残さない選択が永続化を発生させない（要件7.3）
  - **`POST /_api/v3/mastra/summary` が正常に完了しても、続けて `POST /_api/v3/page/{pageId}/ai-summary` を呼ばなかった場合、対象ページの `aiSummary` が `null` のまま（＝書き込まれていない）であることをDBの状態で統合テストで確認できる**。「留める」ボタンを押さない限り永続化されないことを保証する
  - 要約の生成自体が永続化の副作用を一切持たないこと（生成ルートが `Page` への書き込みを行わないこと）をコードレビュー観点として明記する
  - _Requirements: 7.3_
  - _Depends: 5, 6.2_

- [ ] 7. PersistedSummaryView: ページ表示時に永続化要約が共有表示される
- [ ] 7.1 永続化された要約が本文の外側にMarkdownとして表示される
  - `PageView.tsx` の既存のページ取得結果から `aiSummary` を受け取り、存在する場合のみ本文の外側に描画する
  - **`aiSummary.body` をMarkdownとして描画する**。リード文＋箇条書き形式（要件3.1）を正しく表現するため。`apps/app/src/components/PageView/RevisionRenderer.tsx`（`rendererOptions` と `markdown: string` を受け取る既存コンポーネント）を再利用する。`PageContentRenderer` は `pagePath` を前提とするため、revision本文でない任意のMarkdown文字列には `RevisionRenderer` を直接使う（既存の先例: `PageComment/Comment.tsx`、`PageEditor/Preview.tsx`、`Sidebar/Custom/CustomSidebarSubstance.tsx`）
  - `rendererOptions` は `~/stores/renderer.tsx` の `generateSimpleViewOptions` 系フックから取得する。オプションを自前で組み立てない
  - **サニタイズは既存パイプに委譲する**。上記オプションの `rehypePlugins` には `rehype-sanitize` が `[sanitize, getCommonSanitizeOption(config)]` として既に含まれている。本コンポーネント側で独自のHTMLエスケープ・サニタイズ処理を追加実装しない。既存パイプの `verifySanitizePlugin` / `hasSanitizePlugin` ガードを回避する実装（ガードを外す・独自オプションを作る）は禁止する
  - マウント時に `localStorage` の **`growi.aiSummary.hidden.{userId}.{pageId}`** を読み、非表示フラグが立っている場合は描画しない
  - **`userId` は `useCurrentUser()`（`~/states/global/global`、`IUserHasId | undefined` を直接返すJotaiフック）から `currentUser?._id` として取得し、キーに含める**。`undefined`（未ログイン・取得前）の場合は非表示フラグの読み書きを行わず常に表示する。**このため、ブラウザ×ユーザー単位で非表示状態が独立され、共用端末での他ユーザーへの波及が防がれる**（要件9.3）
  - 見出し「AI要約」を含む表示文言を、既存の `react-i18next` パターンに沿って5ロケール分の翻訳キーとして追加する
  - **コンポーネントテスト**: 箇条書きを含む `body` が `<ul>`/`<li>` としてDOMに現れること（Markdownとして描画されている観察可能な帰結）、および `body` にスクリプトタグや危険な属性を含めた場合に描画結果からそれらが除去されること（既存sanitizerが適用されていること）を確認できる
  - **コンポーネントテスト**: `useCurrentUser()` をモックして異なる `userId` を返させたとき、一方のユーザーで非表示にしても他方のユーザーでは表示されること（キーに `userId` が含まれる帰結）。`useCurrentUser()` が `undefined` を返す場合は非表示機能が働かず常に表示されること
  - 権限のない閲覧者には `aiSummary` を含むページデータ自体が返らないため、表示もされないことを確認できる
  - _Requirements: 8.1, 8.2, 8.3_
  - _Depends: 5_

- [ ] 7.2 永続化された要約の鮮度が控えめに示される
  - `aiSummary.sourceRevisionId` と `page.revision._id` をクライアント側で比較し、不一致時に控えめな鮮度ヒント（背景色を変えない、`aiSummary.capturedAt` を使ったタイムスタンプ表現の文言）を表示する
  - revision IDそのものはUIに出さない
  - 追加のAPI呼び出しが発生しないことをコードレビュー観点として明記する
  - 一致/不一致それぞれの表示をコンポーネントテストで確認できる
  - _Requirements: 9.1, 9.2_
  - _Depends: 7.1_

- [ ] 7.3 閲覧者ごとに要約をローカルで非表示にできる
  - 削除ボタンのクリックで `localStorage` の **`growi.aiSummary.hidden.{userId}.{pageId}`** に非表示フラグを書き込む（サーバへのリクエストは発生しない）
  - `localStorage` の read 失敗時はフラグなしとして常に表示し、write 失敗時は画面上の非表示化のみ反映する（次回訪問時に復活しうることを容認する）
  - 非表示化後、表示から要約が消えること、ページ再訪問（再マウント）でも非表示のままであることをコンポーネントテストで確認できる（`localStorage` はテスト用にモックする）
  - `aiSummary`（Page本体の永続データ）自体は変更されないことをコードレビュー観点として明記する
  - 再表示するUIを持たないことを確認できる
  - _Requirements: 9.3, 9.4_
  - _Depends: 7.1_

- [ ] 8. AiSummarizeQuickMenuItem: ページ上部の操作メニューから要約生成を開始できる
- [ ] 8.1 要約トリガーボタンが適切に表示・非表示される
  - `AiSidebarのクイックメニューに「このページを要約」ボタンを追加する
  - 表示条件: `useAiReadyGuard() === true` AND `useCurrentPageId() !== undefined`
  - AI設定が無効・未設定時は非表示（エラーメッセージは表示しない）
  - 現在ページを開いていない場合は非表示
  - 可視性・不可視性の切り替えをコンポーネントテストで確認できる
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 8.2 ボタンクリックで要約生成を開始し、中途で二重送信を防ぐ
  - クリック直後にボタンを無効化し、ローディング状態に切り替える（`isGenerating` フラグ）
  - `POST /_api/v3/mastra/summary` をcurrentPageIdを指定して呼び出す
  - ストリーム応答から `threadId`, `sourceRevisionId`, `capturedAt` を解析する
  - 新規チャットスレッドをChatSidebarで開く
  - 生成完了時：ローディング表示を終了し、ボタンを再度有効化する。結果の要約メッセージは既存のチャット描画に任せる
  - 生成がエラーで終了時：エラー通知を表示し、ボタンを再度有効化する
  - クリック直後から生成完了まで、再クリックは受け付けない（`isGenerating` フラグで防止）
  - ボタンの無効化・有効化状態をコンポーネントテストで確認できる
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 8.3 トークン消費が明示される
  - ボタンテキスト・ツールチップ・説明文で「AIトークンを消費します」旨を明示する
  - 表現は主張を強くしすぎない見た目にする（警告ではなく、事実の低姿勢な提示）
  - テキスト内容をコンポーネントテストで確認できる
  - _Requirements: 12.1, 12.2_

- [ ] 9. AiSummarizePersistenceButtons: 生成された要約について「残す / 閉じる」を選択できる
- [ ] 9.1 保存ボタンUIが表示される
  - アシスタントメッセージの下に「残す」「閉じる」ボタンを表示する
  - 既存のChatMessageのレイアウト下に自然に配置される
  - ボタンラベルは`ai_summarize.persistence.save_button` / `ai_summarize.persistence.close_button`翻訳キーを使用
  - UIが正しく描画されることをコンポーネントテストで確認できる
  - _Requirements: 13.1, 13.2_

- [ ] 9.2 要約の保存操作が実行される
  - 「残す」ボタンをクリック後、`POST /_api/v3/page/{pageId}/ai-summary` を呼び出す
  - リクエストボディに: `body` (チャットメッセージテキスト), `sourceRevisionId` (タスク8.2で受け取った値), `capturedAt` (タスク8.2で受け取った値)を含める
  - クリック直後にボタンを無効化し、ローディング表示に切り替える
  - 保存が正常終了時：ボタンを非表示にし、保存完了を簡潔に通知する（トーストメッセージ）
  - 保存がエラーで終了時：エラー通知を表示し、ボタンを再度有効化する
  - APIの成功・失敗・ローディング状態遷移をコンポーネントテストで確認できる
  - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [ ] 9.3 既存要約の置き換え前に確認を取る
  - ページに既に永続化された要約が存在し、新しい「残す」操作が行われる場合、確認ダイアログを表示する
  - ダイアログテキスト：「既存の要約を新しい内容で置き換えますか？」
  - ユーザーが確認を取り消した場合：APIを呼び出さない
  - ユーザーが確認を進めた場合：タスク9.2の保存操作を続行する
  - 確認ダイアログの表示・キャンセル・進行をコンポーネントテストで確認できる
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 9.4 削除（非表示）導線がクライアント側で完結する
  - 永続化された要約がページに表示されている場合、要約エリア内に「非表示にする」ボタン（またはメニュー）を表示する
  - クリック時、`localStorage` の `growi.aiSummary.hidden.{userId}.{pageId}` に非表示フラグを書き込む（サーバへの呼び出しなし）
  - 「非表示にする」を選択後、以後当該ブラウザ・当該ユーザーでは表示されない
  - 再表示機能は設けない（必要な場合は要約を再生成し、改めて残すことを選択）
  - UIボタン、localStorage書き込み、表示の消失をコンポーネント・統合テストで確認できる
  - _Requirements: 15.5, 15.6_

- [ ] 10. PersistedSummaryView UI統合: 永続化要約がページに統合表示される
- [ ] 10.1 永続化要約の表示UI全体がMarkdownで描画される
  - タスク7.1のMarkdown描画が正しく、箇条書きが`<ul>`/`<li>`として見えることをテストで確認
  - タスク7.2の鮮度ヒント文言が「ページが更新されました」と表示されることを確認
  - タスク7.3の削除ボタンが表示され、クリック時に非表示になることを確認
  - _Requirements: 8.3, 9.1, 9.2, 9.3, 9.4_
  - _Depends: 7.1, 7.2, 7.3_

- [ ] 11. 多言語化: トリガー・保存・鮮度表示がサポート言語で表示される
- [ ] 11.1 翻訳キーが全ロケールで登録される
  - `apps/app/public/static/locales/{en_US, fr_FR, ja_JP, ko_KR, zh_CN}/translation.json` に以下を追加:
    - `ai_sidebar.summarize_page`: "このページを要約" (ja_JP例)
    - `ai_sidebar.summarize_tooltip`: "AIでこのページを要約します（トークンを消費します）"
    - `ai_summarize.persistence.save_button`: "残す"
    - `ai_summarize.persistence.close_button`: "閉じる"
    - `ai_summarize.persistence.hide_button`: "非表示にする"
    - `ai_summarize.persistence.confirm_title`: "要約を上書きしますか？"
    - `ai_summarize.persistence.saved`: "要約を保存しました"
    - `ai_summarize.persistence.hidden`: "非表示にしました"
    - `ai_summarize.freshness.updated`: "ページが更新されました"
    - `ai_summarize.error.network`, `ai_summarize.error.server`など
  - 既存のi18n体系（react-i18next等）に従い、対応ロケールで表示されることを統合テストで確認できる
  - _Requirements: 16.1, 16.2_

- [ ] 12. UI層エラーハンドリング: ユーザーは原因がわかる通知を受ける
- [ ] 12.1 エラーメッセージが技術詳細を含まず、簡潔である
  - ネットワークエラー・サーバエラー・レート制限等のエラー時、ユーザー向けの簡潔なメッセージを通知する（トーストメッセージ）
  - 技術的詳細（スタックトレース等）は含めない
  - 既存のエラー表示パターン（`ui/base/NotificationManager`等）に合わせる
  - エラー通知の表示をコンポーネントテストで確認できる
  - _Requirements: 17.1, 17.2_

- [ ] 13. E2E Integration Test: ページ表示 → 要約生成 → 保存の完全フロー
- [ ] 13.1 ページ表示から保存完了まで、全UIコンポーネントが協調して動作する
  - ページ表示 → ボタンクリック → ストリーム応答 → 新規スレッド作成 → メッセージ表示 → 「残す」クリック → 永続化 → ページ再読み込み → 永続化要約表示、の全フロー
  - マルチユーザーシナリオ：一方のユーザーが要約を非表示に → 別ユーザーは表示されたまま
  - 既存要約がある場合の置き換え確認ダイアログ動作
  - 多言語表示確認（複数ロケール選択時の正しい表示）
  - 権限なしユーザーが永続化要約を見ない
  - テストの全シナリオが通過することを確認できる
  - _Requirements: 1, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17_
  - _Depends: 8, 9, 10, 11, 12_

## Deferred Requirements

- **1.5**（重複・競合する生成を新たに開始しない）: タスク4.4の `_Requirements: 1.5_` は、この要件のうち「同時リクエストが状態を破壊しない・安全に処理される」という安全性の部分のみをカバーする。「送信中は新たな生成を開始させない」というUXレベルの防止そのものは、要約トリガーUIコンポーネント自体の実装（別PR、非目的として明記済み。設置場所は決定済み）に依存するため本specのタスクには含まれず、その実装側で確認される。
- **5.1**（AI未設定時の利用不可）: タスク3.3がサーバ側の利用不可化（501）をカバーする。「AI未設定・無効時にトリガー導線自体を出さない」というクライアント側の表現は、トリガーUIと同じ別PRが担う。

## Task Numbering Note

要件7.3（未選択時は永続化しない）に対応するタスクは、永続化ルートの責務であるためタスク**6.4**として配置している（既存のタスク7.3は要件9.3/9.4のローカル非表示であり、別物）。
