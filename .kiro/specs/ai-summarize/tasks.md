# Implementation Plan: ai-summarize

- [ ] 1. SummarizeAgent: 全文カバレッジ方針で単一ページを要約するAgentができる
- [ ] 1.1 要約instructionsができる
  - 「hasMoreが真である限り読み取りを続ける」「読み取り済み行数がソフト上限に達したら打ち切り、部分的な内容に基づく旨を明示する」という全文カバレッジの方針を明文化する
  - 「リード文1文＋主要ポイント3〜5個の箇条書き」という出力形式を明文化する
  - ユーザーの入力言語で応答する指示を含める
  - instructions文字列に上記4点の指示が含まれることをユニットテストで確認できる
  - _Requirements: 2.1, 2.2, 3.1_

- [ ] 1.2 SummarizeAgentがMastraから取得できる
  - `getPageContentTool` のみをツールとして持ち、`memory`（既存のMongoDBStore、growiAgentと共有）に接続したAgent定義を作成する
  - モデル解決は `post-message.ts` と同じ `resolveEffectiveModelKey` の丸め込みを経由し、リクエストの `modelKey` 省略時はデフォルトモデルへフォールバックする
  - Mastraインスタンスに `summarizeAgent` として登録し、`mastra.getAgent('summarizeAgent')` で取得できる
  - `growi-agent.ts` は一切変更しないことをユニットテスト（またはdiffレビュー観点の明記）で確認できる
  - _Requirements: 1.1, 2.3_

- [ ] 2. (P) AiSummarizeMetrics: 要約生成のたびにCounterがインクリメントされる
  - 既存の `custom-metrics/` ディレクトリのパターンに沿って、要約生成専用のCounterメトリクスを新規ファイルに実装する
  - `setupCustomMetrics()` からの登録呼び出しを追加し、サーバ起動時にCounterが初期化される
  - インクリメント用の関数を呼ぶとCounterの値が1増えることをユニットテスト（モックMeter/Counter使用）で確認できる
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
  - リクエストごとに新しい `threadId` を採番し、`getOrCreateThread`（既存関数、無変更）で新規スレッドを作成する（既存スレッドへの追記は行わない）
  - クライアントの自由入力を受け取らず、`pageId`/`pagePath` からサーバ側で固定形式の初期リクエストを組み立てて `summarizeAgent.stream()` に渡す
  - `post-message.ts` の `maxSteps: 10` とは独立した、全文カバレッジのソフト上限に確実に到達できるだけの `maxSteps` を設定する
  - `post-message.ts` と同型のUIメッセージストリーム（`createUIMessageStream`/`toAISdkStream`/`pipeUIMessageStreamToResponse`）で応答を返し、ストリームが正常終了した時点でのみタスク2のCounterをインクリメントする
  - モデル呼び出し失敗・ストリーム構築失敗時は、プロバイダ由来の一行メッセージのみを含む500を返し、スタックトレースやレスポンス本体を転送しないこと、かつこの失敗パスではタスク2のCounterをインクリメントしないことを統合テストで確認できる
  - ページ本文の取得が `getPageContentTool` 経由のツール呼び出しループのみで行われ、ルート層に本文の事前取得・直接DB参照が存在しないことをコードレビュー観点として明記する
  - 権限のあるページに対するリクエストが新規スレッドを作成しストリーム応答を返すことを統合テストで確認できる
  - _Requirements: 1.1, 1.2, 4.1_
  - _Depends: 1.2, 2_

- [ ] 3.3 要約ルートがExpressに登録され、AI未設定時は既存ガードで利用不可になる
  - `routes/index.ts` の遅延ロードパターンに沿って `POST /_api/v3/mastra/summary` を追加登録する（既存の `router.use(aiReadyGuard)` の適用範囲内）
  - AI未設定・無効時に本ルートが501を返すことを統合テストで確認できる（既存の `aiReadyGuard` の回帰確認）
  - _Requirements: 5.1_

- [ ] 4. Integration & Validation
- [ ] 4.1 閲覧権限のないページ／存在しないページへの要約要求が、存在を明らかにせず失敗を伝える
  - 権限のないページ・存在しないページの両方に対して要約を要求し、`getPageContentTool` の `not_found_or_forbidden` が同一の応答文言でクライアントに伝播することを統合テストで確認できる
  - 応答にページの存在有無を判別できる情報が含まれないことを確認できる
  - _Requirements: 4.1, 4.2_
  - _Depends: 3.3_

- [ ] 4.2 要約完了後、同じスレッドで既存の対話に追質問を続けられる
  - 要約完了後に取得した `threadId` を使って既存の `POST /message` に追質問を送り、`growiAgent` がスレッド履歴（要約メッセージ）を認識して応答することを統合テストで確認できる
  - この経路で `growi-agent.ts` と `post-message.ts` の既存の挙動（`maxSteps: 10` を含む）が変化しないことを確認できる
  - _Requirements: 1.4, 2.3_
  - _Depends: 3.3_

- [ ] 4.3 長いページでソフト上限に到達すると、打ち切りと部分要約である旨が明示される
  - 数千行規模の長いページのフィクスチャで、`getPageContentTool` の呼び出しがソフト上限相当で打ち切られ、`maxSteps` のハード上限に達する前に部分要約が生成されることを確認できる
  - 生成された要約に、部分的な内容に基づく旨の明示が含まれることを確認できる
  - 出力がリード文1文＋主要ポイント3〜5個の箇条書き形式であることを確認できる
  - _Requirements: 2.1, 2.2, 3.1_
  - _Depends: 3.3_

- [ ] 4.4 同一ページへの同時要約リクエストが互いを破壊せず安全に処理される
  - 同一ページに対して短時間に2件の要約リクエストを送り、それぞれ独立したスレッドとして正常に処理され、状態の破壊や競合エラーが起きないことを統合テストで確認できる
  - 要約は状態を書き換えないため、サーバ側の新規ロック機構は追加しない設計であることを踏まえたテストとする
  - 重複生成の抑止（送信中の再送信を防ぐUX）は、要約トリガーUI（別spec、本specのスコープ外）側の実装に依存することをテストの説明に明記する
  - _Requirements: 1.5_
  - _Depends: 3.3_

## Deferred Requirements

- **1.5**（重複・競合する生成を新たに開始しない）: タスク4.4の `_Requirements: 1.5_` は、この要件のうち「同時リクエストが状態を破壊しない・安全に処理される」という安全性の部分のみをカバーする。「送信中は新たな生成を開始させない」というUXレベルの防止そのものは、要約トリガーUIの具体的な実装（社内UIレビュー中、別spec、非目的として明記済み）に依存するため本specのタスクには含まれず、その実装側で確認される。
