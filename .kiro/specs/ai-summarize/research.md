# Gap Analysis: ai-summarize

## 1. 現状調査（コードベース）

### 1.1 features/mastra の既存構成
- `features/mastra/server/services/mastra-modules/agents/` には既に `growiAgent`（検索Q&A用、`fullTextSearchTool` + `getPageContentTool`、`memory` 接続）に加えて、**用途特化の第2エージェント `suggestPathAgent`** が存在する（`agents/suggest-path/`）。
  - `suggestPathAgent` は独自の `instructions.ts`・専用ツール（`limitedSearchTool`, `listChildrenTool`）を持ちつつ、`getPageContentTool` は `growiAgent` と同一モジュールをそのまま再利用している。
  - `suggestPathAgent` は `memory` を意図的に接続していない（ステートレス・単発呼び出し用途のため）。
  - `suggestPathAgent` の呼び出し元は `post-message.ts`（チャットスレッド経由の対話フロー）ではなく、別機能 `features/ai-tools/suggest-path/server/services/engines/agentic-engine.ts` である。
- この既存構成は「検索Q&A用の本体を変えずに、用途特化のエージェントを追加する」設計が本リポジトリで既に採用・稼働している前例であることを示す。

### 1.2 権限チェックの実体
- `getPageContentTool`（`get-page-content-tool.ts`）は `execute()` の呼び出しごとに `Page.findByIdAndViewer` / `Page.findByPathAndViewer` を呼び、閲覧権限とページ存在を都度解決している。キャッシュや結果の使い回しは一切ない。
- 存在しない／権限のないページは `not_found_or_forbidden` の一律コードで返り、存在の有無を区別しない（要件4.2の「存在を明らかにしない」と整合）。
- **このツールが「ページ本文を取得できる唯一の手段」であり続ける限り**、これを呼び出すエージェントを何個追加しても権限チェックは自動的に効く。

### 1.3 チャットスレッド・永続化の既存基盤
- `mastra-modules/memory/index.ts` の `memory`（`@mastra/memory` の `Memory` + `@mastra/mongodb` の `MongoDBStore`）は、`growiAgent` の会話スレッド永続化に**既に**使われている、既存のMongoDBバックエンドである。新規のデータストアではない。
- `post-message.ts` は `mastra.getAgent('growiAgent')` → `getOrCreateThread` → `growiAgent.stream(...)` という一本道で、エージェントの選択はハードコードされている。要約用に別エージェントを使うには、この選択ロジックへの分岐、または別ルートの追加が必要（要件からは未確定・設計事項）。

### 1.4 全文カバレッジ実現の技術的前提
- `getPageContentTool` の `limit` は1呼び出しあたり最大500行で、**複数回呼び出した場合の合計読み取り量やページ全体を読み切ったかどうかを追跡・強制する仕組みはツール側にはない**。「全文を読み切るまで読み続ける」「上限に達したら打ち切る」は、現状は完全に**エージェントのinstructions（プロンプト）依存**であり、コード側の強制力（ハードキャップ）は存在しない。
- `growiAgent.stream()` の `maxSteps: 10` は `post-message.ts`（呼び出し側）でエージェントに関係なく指定されている値。エージェント自体には紐付いていない。長いページの全文カバレッジには10ステップでは不足する可能性があり、要約専用の呼び出し経路では別の `maxSteps` 設定が必要になり得る。

### 1.5 計測基盤の既存パターン
- `features/opentelemetry/server/custom-metrics/` の既存メトリクスは全て**起点時に登録される Observable Gauge**（`addBatchObservableCallback` でポーリング収集）であり、要件6が求める「生成1件ごとにインクリメントするCounter」という**イベント駆動型**の計測は、このディレクトリに前例がない。パターン自体の追加は妥当だが、実装時にどこで（要約生成の成功パス）Counterをインクリメントするかは設計課題として残る。

### 1.6 トリガーに必要な「現在開いているページ」コンテキスト
- `features/mastra/client` 配下を検索した限り、ユーザーが明示的に `@メンション` したページ以外に、「今開いているページ」をアンビエントにチャット側へ渡す既存の仕組みは見当たらない。トリガーUIの配置は本specのスコープ外だが、「現在ページのID/パスを要約リクエストに載せる」という**データの受け渡し自体**は本spec（要件1.1, 1.3）のスコープ内であり、新規の配線が必要になる。

### 1.7 機能可否ゲートの既存基盤
- `ai-ready-guard.ts`（`aiReadyGuard`）が既に「AI未設定・無効時は501を返す」ミドルウェアとして存在し、要件5はこれをそのまま要約用ルートに適用するだけで満たせる。新規実装不要。

---

## 2. Requirement-to-Asset Map

本specのスコープは要約の**生成**（R1〜R6）に加えて、**ページへの永続化・共有表示・鮮度表示・ローカル非表示**（R7〜R9）を含む。R7〜R9 は生成側とは全く別のレイヤ（`Page` モデル・ページ取得API・ページ表示コンポーネント）に触れるため、ギャップの性質も異なる。

### 2.1 生成側（R1〜R6）

| 要件 | 対応する既存資産 | ギャップ種別 |
|---|---|---|
| R1.1/1.2 その場でのオンデマンド要約・都度生成 | `growiAgent.stream()` と同型の呼び出しパターン | Constraint（既存パターンの再利用で足りる） |
| R1.3 現在ページ非依存時は非提供 | `useCurrentPageId`（既存、7.1で判明）。リクエストに載せる配線のみ新規 | Missing（軽微。当初の「新規配線が必要」は過大評価だった） |
| R1.4 同一対話内での追質問継続 | `memory`（MongoDBStore）は既存。クロスAgentスレッド共有は本specが最初の適用例（7.6で `@mastra/core` 実装により成立条件を裏取り済み） | **Missing / 統合テスト必須** |
| R1.5 重複生成の抑止 | サーバ側の状態安全性は「要約が状態を書き換えない」構造で満たす。UI層の送信中ガードは別PR（7.5） | Constraint（サーバ側）＋ Out of scope（UI側） |
| R2.1/2.2 全文カバレッジ・上限到達時の明示 | `getPageContentTool`（無変更で流用）＋新規 `limitedGetPageContentTool`（ハード上限をコード強制）＋新規instructions | Missing（新規ラッパー。前例は `limitedSearchTool`） |
| R2.3 検索Q&A用の読み取り方針を変更しない | `growi-agent.ts`・`getPageContentTool` は不変資産として維持 | Constraint（触らないことが正しい） |
| R3.1 出力形式統一 | 新規エージェントのinstructionsで指定 | Missing（軽微） |
| R4.1/4.2 都度の権限確認・非開示 | `Page.findByIdAndViewer`（ルート層ゲート）＋ `getPageContentTool` の既存実装（TOCTOU窓の二重防護） | Constraint（変更不要、破ってはいけない） |
| R5.1 AI未設定時の利用不可 | `aiReadyGuard` | Constraint（再利用のみ） |
| R6.1/6.2 利用実績の計測 | `custom-metrics/` ディレクトリ（ただし全て Observable Gauge で、イベント駆動 Counter の前例なし） | Missing（新規パターン） |

### 2.2 永続化・共有表示側（R7〜R9）

| 要件 | 対応する既存資産 | ギャップ種別 |
|---|---|---|
| R7.1 選択時のみ永続化 | `Page` Mongooseモデル（`apps/app/src/server/models/page.ts`）はあるが、要約を保持するフィールドは存在しない。保存用のAPIルートも存在しない | **Missing**（スキーマ追加＋新規ルート） |
| R7.2 生成元revision IDの記録 | `page.revision._id` は既存資産。ただし「生成開始時点の版をストリーム応答でクライアントへ返し、保存時にそのまま受け取る」という往復の配線は存在しない。サーバ側で取り直さないことが要件なので、クライアント経由の受け渡しが必須 | **Missing**（配線が新規。取り直し禁止という制約付き） |
| R7.3 未選択時は永続化しない | 該当する既存資産は不要（保存APIを呼ばなければ書き込みは発生しない）。ただし「実際に書き込まれないこと」の検証がタスクに必要 | Constraint（構造的に満たされるが、**検証タスクが必要**） |
| R7.4 既存永続化要約の置き換え | Mongoose の `$set` による上書き（既存の一般的な更新パターン） | Constraint（既存パターンの再利用） |
| R8.1 権限ゲート経由の共有表示 | 既存のページ取得経路がそのまま使える: apiv3 のページ取得API、および初回描画時のSSR（`page-data-props.ts` の `populateDataToShowRevision()`）。両経路とも `Page.findByIdAndViewer` を経由する | Constraint（`aiSummary` を返却対象に含めるだけ。要約専用の閲覧APIは新設しない） |
| R8.2 権限なし時の非表示 | 同上。既存ゲートが `null` を返すため、`aiSummary` を含むページデータ自体が返らない | Constraint（変更不要） |
| R8.3 本文外への表示 | `apps/app/src/components/PageView/PageView.tsx`（Markdown本文の描画箇所があり、その外側に挿入できる） | Missing（軽微。挿入箇所は既存） |
| R9.1 鮮度の控えめな明示 | 該当する既存UIパターンなし。新規コンポーネント内で実装（背景色を変えない控えめな表現） | Missing |
| R9.2 追加呼び出しなしの鮮度判定 | ページ取得レスポンスに `revision._id` が既に含まれる。`aiSummary.sourceRevisionId` との比較はクライアント側の純粋計算で完結 | Constraint（既存レスポンスに乗るため追加呼び出し不要） |
| R9.3 閲覧者ごとのローカル非表示 | ブラウザ組み込みの `localStorage`。キーに `userId`（`useCurrentUser()` から取得）を含めることで、共用端末での他ユーザーへの波及を防ぐ | Missing（新規。サーバ側資産は不要） |
| R9.4 再表示機能なし | 該当なし（機能を作らないことが要件） | Constraint |

### 2.3 R7〜R9 が持ち込む横断的なギャップ（生成側には存在しなかったもの）

R7〜R9 のスコープ追加により、R1〜R6 だけを見ていた当初のギャップ分析には現れなかった以下の作業が発生する。これらは §5 の Effort 再算出の主要因である。

- **公開パッケージへの型追加と Changeset**: クライアントが `aiSummary` を読むため、`packages/core/src/interfaces/page.ts` の `IPage` に型を追加する必要がある。`@growi/core` は公開パッケージ（10+ consumers）であり、`.claude/rules/project-structure.md` により Changeset の作成が必須。これは生成側（R1〜R6）には一切なかった作業。
- **Mongoose / Prisma の二重管理**: `.claude/rules/model.md` の通り、`Page` モデルは Mongoose から Prisma への移行途上にある。スキーマ追加は Mongoose 側（`apps/app/src/server/models/page.ts`）だけでなく、Prisma スキーマ側にも追随させ、型生成が通ることを確認する必要がある。
- **書き込みAPIに伴う認可・レート制限**: R1〜R6 の生成側は `aiReadyGuard` に乗るだけだったが、R7 の永続化ルートは**共有データへの書き込み**である。ログイン必須（`loginRequiredStrictly`）・読み取り専用ユーザーの除外（`excludeReadOnlyUser`）・レート制限の適用が必要になる。
- **5ロケール分のi18n**: R8.3/R9.1/R9.3 の表示文言（見出し「AI要約」・鮮度ヒント・削除ボタンラベル）について、既存の `react-i18next` パターンに沿って5ロケール分の翻訳キーを追加する必要がある。純粋な追加作業だが、ファイル数×キー数の分だけ確実に工数が乗る。
- **統合テストの層が増える**: 生成側の統合テスト（クロスAgentスレッド再生、権限ゲート短絡、レート制限）に加えて、永続化・共有表示の統合テスト（権限のある/ないユーザーの `GET` での `aiSummary` 有無、本文更新による鮮度判定の切り替わり、未選択時に書き込まれないこと）が必要になる。

---

## 3. 重視観点別の検証（本レビューで指定された5点）

### (1) 実装コスト最小化の目的化（社長FB1）を壊していないか
**判定：現時点の requirements.md は壊していない。**

- 要件2（長いページの全文カバレッジ）は、コストの低い「先頭N行だけ読んで要約する」方式を選ばず、あえて「読み切るまで読み続ける」「上限到達時はその旨を明示する」という**コストの高い方針**を選んでいる。理由は明確に有用性側（"内容の一部だけを反映した不正確な要約を受け取らずに済む"）にあり、コスト起点で有用性の高い案を切り捨てた形跡はない。
- 要約の非キャッシュ・非永続化（都度生成）も、コスト最小化が動機ではなく、要件4（権限の都度確認、妥協不可）と表裏一体の**正当性上の要請**として書かれている。キャッシュを避ける理由が「実装が楽だから」ではなく「権限・内容の陳腐化を避けるため」である点は、フィードバックの「コストを理由に有用性の高い案を切り捨てない」という趣旨と整合する。
- 唯一注意すべき点は、非目的として列挙されている「永続化」「複数ページ横断要約」「独自パイプライン」が、**社内検討中で未確定だから今回のスコープに含めない**という理由で切られており、「コストが高いからやらない」という理由では書かれていないこと。これは望ましい書き方である。

### (2) 既存AIチャット基盤（features/mastra）にそのまま乗せ、新規の独立バックエンド・永続層を増やしていないか
**判定：設計方針として壊れていない。裏付けとなる前例あり。**

- `suggestPathAgent` の前例が示す通り、「`features/mastra/server/services/mastra-modules/agents/` 配下に用途特化の新規Agentを追加し、既存ツール（`getPageContentTool`）を再利用する」という拡張は、このリポジトリで既に確立されたパターンである。要約専用Agentの新設はこのパターンをなぞるだけで、新規の独立したバックエンド（別プロセス、別API層）を必要としない。
- スレッド永続化についても、既存の `memory`（MongoDBStore、`growiAgent` が既に使用中）をそのまま共有すれば、新規の永続データ層を増やす必要はない。要件が明示的に禁止している「要約結果の永続化」（＝要約テキストをページに紐づけて保存する機能）とは別物であり、混同しないよう設計時に明記すべき。
- ただし `suggestPathAgent` はステートレス（`memory` 非接続）だが、要約Agentは要件1.4（同一対話内での追質問継続）によりスレッド継続が必須で、`suggestPathAgent` より `growiAgent` に近い統合が要る。これは「新規バックエンドを増やす」話ではなく、「エージェント切り替えとスレッド共有をどう配線するか」という設計課題であり、Research Needed。

### (3) 閲覧権限が要約生成のたびに再チェックされる設計になっているか（妥協不可）
**判定：要件本文・既存コードの両面で担保されている。ただし設計フェーズで壊しうる典型的な近道がある。**

- `getPageContentTool` は呼び出しの都度DBへ権限解決に行くため、これを要約Agentの**唯一の**本文取得手段として使い続ける限り、権限チェックの都度実行は構造的に保証される。
- 要件のAdjacent Expectations（「本機能独自の新しいページ内容取得手段や、独自の権限モデルは導入しない」）はこの保証を明文で裏付けている。
- **設計フェーズで壊されうる典型的な近道**：全文カバレッジのために「トリガーのExpressルートで一度ページ本文を丸ごと取得し、それをシステムプロンプトやコンテキストとしてエージェントに渡す」実装は、ツール呼び出しのラウンドトリップを減らせて一見コスト最小化に見えるが、これをやると権限チェックがそのリクエストの最初の1回だけになり、要件4.1の「都度確認」が壊れる。設計書には「本文取得は必ず `getPageContentTool` 経由（＝ツール呼び出しのループ）で行い、ルート層での直接DB読み出し・事前取得は行わない」ことを明記すべき。

### (4) 全文カバレッジ対応が既存growiAgent本体の動作に影響しない設計か（instructions分離）
**判定：ファイル分離の観点では前例通りで問題ない。ツール層の共有部分に1点確認が必要。**

- `growi-agent.ts` のinstructionsは1つのテンプレートリテラルにハードコードされており、要約専用の新規Agent（新規ファイル）を追加するだけなら、このファイルには一切手を入れずに済む。`suggest-path/instructions.ts` が既にこの分離パターンの実例。
- 一方、`getPageContentTool` は両エージェントで**同一モジュールを共有**する設計になっている（`suggestPathAgent` も同じインスタンスを使用）。全文カバレッジの「上限」をツール自体の引数（`limit` の上限値など）や実装ロジックの変更で実現しようとすると、`growiAgent` 側の挙動にも影響してしまう。要件2.2/2.3が求める「要約時のみ全文カバレッジ方針を適用し、Q&A用途の読み取り方針は変えない」を満たすには、**上限や「読み切るまで続ける」判断はツールではなく要約Agent側のinstructionsとmaxSteps（呼び出し側パラメータ）でのみ制御する**必要がある。設計書ではこの分離点（ツールは不変・共有、可変なのはinstructionsと呼び出しパラメータのみ）を明記すべき。
- 加えて、`maxSteps: 10` は現状 `post-message.ts` という呼び出し元に固定されている値であり、エージェントに紐付いていない。要約専用の呼び出し経路（別ルート、または `post-message.ts` 内の分岐）で、全文カバレッジに必要なステップ数を確保しつつ、それが `growiAgent` の既存Q&A呼び出しの `maxSteps: 10` に影響しないようにする必要がある。ここは設計フェーズでの具体化が必要（Research Needed）。

### (5) 永続化方式（4.7/4.8）とトリガーUI配置は本specのスコープ外に留まっているか
**判定：現行の requirements.md には該当する番号の項目（4.7/4.8）は存在せず、スコープ外に留まっている。**

- 永続化に関する記述は Boundary Context の Out of scope に1行、「生成した要約を後から再利用するための保存・永続化、および他の閲覧者へのデフォルト表示（社内で検討中、別途決定）」とあるのみで、保存方式（ページへの手動追記／専用フィールド等）を具体的な受け入れ基準として書き込んでいる箇所はない。
- トリガーUIについても Out of scope に「要約トリガーの具体的なUI設置場所、およびトリガー後の画面遷移の確定（社内のUIレビューで検討中）」と1行あるのみで、UI要素・遷移先を先取りして仕様化した記述はない。
- 結論として、この観点では requirements.md は適切に抽象度を保っており、後続の意思決定（社内UIレビュー・永続化方式の決定）を先取りして作り込んでいる箇所は見当たらない。設計フェーズでも、この2点は「将来差し込み可能な形にしておく」程度の考慮に留め、具体的な設計を書き込まないよう注意が必要。

---

## 4. 実装アプローチの選択肢

### Option A: growiAgent を拡張（instructions分岐 or 動的ツール構成）
- **概要**：`growiAgent` 1つのまま、要約リクエストかどうかで instructions や `maxSteps` を動的に切り替える。
- **トレードオフ**：新規ファイルは増えないが、要件2.3（Q&A用途の読み取り方針を変えない）が求める分離が「1つのAgent定義内の条件分岐」に依存することになり、将来Q&A用instructionsを変更した際に要約側へ意図せず影響するリスクが高い。`growi-agent.ts` の責務が肥大化し、単一責任の原則にも反する。
- **本レビュー観点との整合**：(4)「growiAgent本体の動作に影響しない設計」という要求と最も相性が悪い。**非推奨。**

### Option B: 新規の要約専用Agentを追加（`suggestPathAgent` と同型パターン）
- **概要**：`agents/summarize/`（仮）に新規Agent・新規instructions・（必要なら）専用の薄いラッパーツールを追加。`getPageContentTool` はそのまま共有。スレッド継続のため `memory` は接続する。
- **統合点**：`post-message.ts` 相当のルート層で、リクエストが要約起点かどうかに応じて `mastra.getAgent('growiAgent')` と新Agentを出し分ける（またはトリガー用の別ルートを新設し、以降のスレッドは同一Agentで継続する）。
- **トレードオフ**：ファイルは増えるが、責務は完全に分離され、(3)(4)の観点（権限チェックの一元性、既存Agent非破壊）を両立しやすい。前例（`suggestPathAgent`）があるため実装・レビューの型が確立している。
- **本レビュー観点との整合**：(2)(3)(4)全てに最も整合。**推奨。**

### Option C: ハイブリッド（新規Agent＋既存ルートへの薄い分岐）
- **概要**：Option Bの新規Agentを、`post-message.ts` に「要約起点フラグ」で薄く分岐させて統合する形。新規ルートを増やさず、既存のUI（ChatSidebar）の対話フローにそのまま乗せる。
- **トレードオフ**：ルート新設のコストを避けられる一方、`post-message.ts` に要約Agent選択ロジックが混ざり、同ファイルがわずかに複雑化する。ただし責務追加は「どのAgentを使うか」の分岐のみで、Agent自体のロジックはOption Bと同じく完全分離されるため、影響は限定的。
- **本レビュー観点との整合**：(2)の「既存チャット基盤にそのまま乗せる」を最も体現する形。設計フェーズでの検討候補として有力。

---

## 5. Effort & Risk

当初の見積（R1〜R6 のみを対象とした **M = 3〜7日**）は、R7〜R9（永続化・共有表示・鮮度表示）が本specのスコープに入る前に算出されたものであり、**過小**である。R7〜R9 は生成側とは別レイヤ（`Page` モデル・公開パッケージの型・ページ表示コンポーネント）に触れ、Changeset・Prisma追随・5ロケールi18n・書き込みAPIの認可／レート制限・永続化側の統合テストという、生成側には存在しなかった作業を持ち込む（§2.3）。これらを含めて再算出する。

### 5.1 生成側（R1〜R6）

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| 要約専用Agent新設＋instructions | S〜M | Low | `suggestPathAgent` という直接の前例があり、パターンが確立済み |
| `limitedGetPageContentTool`（読み取り量のハード上限をコード強制） | S | Low | `limitedSearchTool` と同型のラッパー。`getPageContentTool` は無変更 |
| 現在ページコンテキストの伝搬（クライアント→リクエスト） | S | Low | `useCurrentPageId` が既存（7.1）。当初 M と見積もったが過大評価だった |
| `POST /summary` ルート（ストリーミング応答・権限ゲート短絡・`maxSteps`） | M | Medium | `post-message.ts` と同型だが、権限ゲート短絡と `sourceRevisionId`／`capturedAt` の返却が新規 |
| スレッド継続（要約Agent⇄追質問、クロスAgent再生） | M | **Medium〜High** | `@mastra/core` の実装で成立条件は裏取り済み（7.6）だが、このリポジトリに前例がなく、統合テストでの実証が必須。ここが最大の技術リスク |
| 全文カバレッジの読み取り制御（三段構え） | S〜M | Medium | ハード上限はコード強制で確実。打ち切り挙動は依然LLMの指示追従に依存 |
| 利用状況Counter計測 | S | Low | OpenTelemetryの標準的なCounter API。meterの束縛タイミング（SDK初期化後）のみ注意点 |

### 5.2 永続化・共有表示側（R7〜R9）— 当初の見積に含まれていなかった分

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| `Page` スキーマへの `aiSummary` フィールド追加（Mongoose） | S | Low | 既存スキーマへの1フィールド追加。既存のインデックス・staticsは無変更 |
| `IPage`（`@growi/core`）への型追加＋Changeset | S | Low〜Medium | 作業自体は小さいが、公開パッケージの変更であり10+ consumersに波及する。Changeset必須（`.claude/rules/project-structure.md`）。ビルド順序（`turbo`）の確認も伴う |
| Prisma スキーマへの追随＋型生成の確認 | S〜M | Medium | Mongoose→Prisma移行途上（`.claude/rules/model.md`）のため二重管理。片方だけ更新すると型不整合が後で表面化する |
| 永続化ルート（`POST /{pageId}/ai-summary`）＋バリデータ | M | Medium | 権限ゲート（`findByIdAndViewer`）・`loginRequiredStrictly`・`excludeReadOnlyUser`・レート制限・`body`長さ上限・`capturedAt` 形式検証。共有データへの書き込みであり、認可の抜けが直接の脆弱性になる |
| `PersistedSummaryView`（Markdown描画・鮮度ヒント・ローカル非表示） | M | Low〜Medium | 既存の `RevisionRenderer` ＋サニタイズ済みレンダラオプションを再利用するため描画は軽い。`localStorage` の利用不可時フォールバック・`userId` スコープの扱いが細かい |
| 5ロケール分のi18n追加 | S | Low | 純粋な追加作業。ただしロケール数×キー数の分だけ確実に工数が乗る |
| `PageView.tsx` への統合＋ページ取得経路（API/SSR両方）での `aiSummary` 返却 | S〜M | Medium | 挿入自体は数行だが、apiv3 と SSR（`page-data-props.ts`）の**両経路**で返却されることを確認する必要がある。片方の漏れは「ある人には見えて別の人には見えない」形で表面化する |

### 5.3 横断（テスト・レビュー）

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| 統合テスト（クロスAgentスレッド再生） | M | **High** | 前例がないため、テストダブルの組み方自体を確立する必要がある。LLMをモック化し tool-call/tool-result を偽データで再生する方式（`suggest-path-agentic-integration.spec.ts` を参考）を採る |
| 統合テスト（権限ゲート短絡・レート制限・501） | S〜M | Low | 既存のapiv3統合テストのパターンに沿う |
| 統合テスト（永続化: 権限あり/なしの `GET`、置き換え、未選択時に書き込まれない、鮮度切り替わり） | M | Low〜Medium | パターンは既存だがケース数が多い |
| コンポーネントテスト（Markdown描画・サニタイズ適用・鮮度・ローカル非表示） | S〜M | Low | RTL の既存パターン。`localStorage` はモックする |
| 権限チェックの一元性維持（設計ガードレール） | - | Low（ガードレールを明文化すれば） | 実装コストではなくレビュー観点。設計書に明記すれば実装時の逸脱を防げる |

### 5.4 総合判定

全体としては **L（1〜2週間相当）**。当初の **M（3〜7日）** から上方修正する。実装規模の上限は**L = 1週間内**（急行）から**L = 2週間内**（通常）の範囲。

上振れの主因は以下の4点であり、いずれも「難しい」のではなく「触るレイヤと確認すべき経路が多い」ことによる:

1. **R7〜R9 のスコープ追加**（当初見積の対象外）— `Page` スキーマ・公開パッケージの型・ページ表示コンポーネントという3つの別レイヤに触れる。
2. **公開パッケージ変更に伴う定型作業** — `IPage` への型追加、Changeset、Mongoose と Prisma の二重管理。
3. **クロスAgentスレッド再生の実証** — 技術的な成立条件は裏取り済み（7.6）だが前例がなく、テストダブルの組み方を含めて確立する必要がある。ここが唯一の High リスク。
4. **確認すべき経路の多重化** — ページ取得のAPI/SSR両経路、5ロケールのi18n、生成側と永続化側それぞれの統合テスト。

一方、アーキテクチャ上の新規性は依然として低い（既存パターンの組み合わせで実現でき、新規の独立バックエンド・独自権限モデル・新規データストアはいずれも不要）。すなわち **規模が L なのは作業量によるもので、設計難易度によるものではない**。

---

## 7. 設計フェーズでの追加調査・決定事項（`/kiro-spec-design` にて実施）

### 7.1 追加で判明した既存資産
- `~/states/page/hooks.ts` の `useCurrentPageId`（既存のJotai由来フック）が、閲覧中ページのIDをアプリ全体で既に提供している。ページ未確定時は `undefined` を返す。ギャップ分析の時点で「現在ページのコンテキスト伝搬に新規配線が必要」としていた見立ては過大評価だった — クライアント側の「現在ページを知る」部分は既存資産で完全に賄え、新規に必要なのは「そのIDを要約リクエストに載せる」配線のみ。
- `post-message.ts` は「assistant-independent」であることがコード中コメントで明示された既存の不変条件（過去の `aiAssistantId` ベース設計からの意図的な離脱）。要約用にこのエンドポイントへAgent選択ロジックを持ち込む案（研究1のOption C）は、この不変条件と衝突するため設計では採用しなかった。
- `getOrCreateThread` は「アシスタント識別子をスレッドメタデータに書き込まない」という既存方針を持つ。要約スレッドもこの方針に従い、専用メタデータを追加しない。

### 7.2 決定: 新規の単発起動ルート（`POST /summary`）で要約を開始し、完了後は既存の `/message` に合流する
- **代替案**: (a) `post-message.ts` に要約用の分岐を追加する、(b) `growiAgent` にinstructions分岐で対応する、(c) 独立の新規Agent＋新規ルートで開始し、以後は既存`/message`ルートに合流する。
- **選定**: (c)。
- **理由**: (a)は「assistant-independent」という既存不変条件に反する。(b)は要件2.3（Q&A用途への非影響）を「同一Agent内の分岐」という壊れやすい形でしか担保できない。(c)は`suggestPathAgent`という直接の前例があり、`growi-agent.ts`・`post-message.ts`のどちらも無変更のまま実現できる。
- **トレードオフ**: 新規ファイルが増える（許容範囲）。要約後の追質問は「新しいAgentが開始したスレッドを別のAgent(`growiAgent`)が引き継ぐ」形になるが、Mastraのスレッド／メッセージ永続化はAgentを区別しない汎用機構であるため技術的な障害はない。

### 7.3 決定: 全文カバレッジの上限は `limitedGetPageContentTool` のバジェットでコード強制し、instructions・`maxSteps` を併設する三段構えにする
- **背景**: `getPageContentTool` 自体には合計読み取り量を追跡・強制する仕組みがない。共有ツールである同ツールを改変すると要件2.3（既存Q&A用途への非影響）に抵触するが、`summarizeAgent` にのみ登録する新規ラッパーであれば `growiAgent` の読み取り挙動は変わらないため2.3に抵触しない（`suggestPathAgent` の `limitedSearchTool` と同型）。instructionsだけの自己申告では要件2.2の「最大読み取り量の上限」を保証できず、`maxSteps` はステップ数の上限であって読み取り量の上限ではない。
- **選定**: (1) `limitedGetPageContentTool` が `RequestContext` の `pageReadBudget`（`{ used, limit }`、`limit` は **1500行**）を読み、`used >= limit` なら委譲せず `limit_exceeded` を返す — 読み取り量のハード上限をコードで強制する。(2) instructionsは `limit_exceeded` 受領後の打ち切りと、部分的な内容に基づく旨の明示のみを規定する。(3) `/summary` ルート独自の `maxSteps`（`post-message.ts` の `maxSteps: 10` とは別の値）を、instructionsに従わずツール呼び出しを続けた場合の安全弁として設定する。`getPageContentTool` 自体は無変更。
- **実効読み取り量の算出**: バジェット判定は呼び出し**前**に行うため、`used` が `limit` 未満（例: 1499行）の状態で呼ばれた場合でも `getPageContentTool` の1回分（最大500行）が通り得る。`getPageContentTool` の `limit` は最大500行（`get-page-content-tool.ts` の `inputSchema` は `.max(500)`、既定200）であるため、実効の読み取り量は最大で `pageReadBudget.limit + 500` = **1500 + 500 = 2000行** に達しうる。この許容幅を設計書に明記する。

### 7.4 決定: 要約リクエストはクライアントの自由入力を受け取らず、`pageId`/`pagePath`からサーバ側で初期発話を組み立てる
- **理由**: 出力形式（3.1）の安定性と、全文カバレッジ方針の適用対象を「要約リクエストのみ」に限定する境界（2.3）を、プロンプト内容のばらつきに依存せず構造的に保証するため。

### 7.5 見送った案: 重複生成抑止のためのサーバ側ロック
- 要約は状態を書き換えないため、二重リクエストが発生しても不整合は起きない（無駄なリクエストが増えるのみ）。トリガーUI（別spec）側の送信中ガード（`ChatSidebar`の`handleSubmit`と同種のパターン）に委ね、本specではサーバ側の新規ロック機構を追加しない。有用性起点で見て、二重生成そのものが実害を持たない以上、コストをかけて防ぐ理由がないという判断。

### 7.6 決定: `summarizeAgent` の本文取得ツールは `growiAgent` と同じ登録キー（`getPageContentTool`）で登録する
- **背景**: 要約専用AgentとgrowiAgentは同じ `memory` インスタンス（スレッド）を共有するが、`suggestPathAgent` はmemory非接続であり、このリポジトリにクロスAgentスレッド共有の前例は無い。`lastMessages: 30` の再生時、assistantのtool-callパート／tool-resultパートは両方とも次ターンのモデル入力に含まれる。
- **`@mastra/core`（インストール済みソース）で裏取りした事実**:
  - LLMプロバイダに送られるツール名は、`Agent` の `tools` オプションに渡すレコードの**キー**である（ツールの `id` フィールドではない）。`Agent.__registerMastra` / `listAssignedTools` が `Object.entries(this.#tools)` のキーを `name` として `makeCoreTool` に渡している。
  - スレッド再生時のメッセージ変換（`aiV5UIMessagesToAIV5ModelMessages`）は、tool-call/tool-resultの**ペア整合性**（`sanitizeOrphanedToolPairs`、toolCallId単位の対応関係）のみを検査する。**ツール名が現在のAgentの登録ツールに存在するかどうかは検証・除去しない**。
  - Memoryはメッセージ／スレッドにagentIdを記録せず、Agent単位で再生をフィルタする仕組みも無い（`getOrCreateThread` の既存方針「アシスタント識別子をメタデータに書き込まない」と整合）。
- **選定**: `summarizeAgent` は本文取得ツールを `{ getPageContentTool: limitedGetPageContentTool }` というキーで登録する（ツール自身の `id` は無関係に別途持ってよい）。これにより、`growiAgent` がスレッドを引き継いだ際に再生される過去のtool-callが、`growiAgent` の現在のツールセットに実在する名前（`getPageContentTool`）と一致する。
- **トレードオフ**: `limitedGetPageContentTool` の出力スキーマは `getPageContentTool` に `limit_exceeded`/`context_error` を加えた拡張だが、スレッド再生時の過去のtool-resultはプロバイダ・SDKいずれの側でも現在のスキーマに対して再検証されないため、この差異は実害を生まない。
- **設計ガードレールとして明記すべき事項**（実装ミスを防ぐための制約）:
  - 要約Agentのページ本文取得は必ず `getPageContentTool` 経由のツール呼び出しループで行い、ルート層での事前フェッチ・直接DB参照は禁止する。
  - `getPageContentTool` 自体（共有ツール）には手を入れない。全文カバレッジの挙動差は、要約Agentのinstructions・呼び出しパラメータと、要約Agentにのみ登録する `limitedGetPageContentTool`（7.3）で実現する。
  - `growi-agent.ts` は変更対象に含めない。

### 7.7 決定: 権限なし時の応答はルート層の `Page.findByIdAndViewer` で短絡する（ストリーム内で伝えない）
- **代替案**: (a) ルート層では権限を見ず、ストリーム内で `getPageContentTool` が返す `not_found_or_forbidden` をAgentが「要約できなかった」旨として応答する。(b) ルート層の `findByIdAndViewer` が `null` を返した時点で、ストリームを開始せず 403/404 で短絡する。
- **選定**: (b)。
- **理由**: 要件7.2により `sourceRevisionId` を取得するため、ルート層は `findByIdAndViewer` を**いずれにせよ1回呼ぶ**。その結果が `null` である以上、ストリームを開始してLLMを呼ぶことに意味がない（トークンを消費して「要約できませんでした」と言わせるだけになる）。(a) は応答経路が二重化し、design.md 内でも矛盾を生んでいた。
- **非開示の担保**: `findByIdAndViewer` は不存在と権限なしを区別せず `null` を返すため、応答も **403/404 のいずれか一方に統一**し、応答本文も両ケースで同一にする。ステータスコードを出し分けるとページの存在有無が漏れる（要件4.2違反）。
- **`getPageContentTool` の都度権限チェックとの関係**: 置き換えではなく**併存**。ルート層のゲート通過後にページが削除・権限変更された競合（TOCTOU）の窓を閉じる二重防護として維持する。要件4.1の「生成のたびに毎回実行される」保証はツール層が引き続き担う。

### 7.8 決定: `aiSummary.body` は既存のページ本文Markdown描画パイプで描画する
- **代替案**: (a) プレーンテキストとして表示する。(b) 要約専用のMarkdownレンダラ・サニタイザを新設する。(c) 既存のページ本文Markdown描画パイプを再利用する。
- **選定**: (c)。
- **理由**: 要件3.1の出力形式（リード文＋箇条書き）はMarkdown記法で生成されるため、(a) では箇条書きが崩れて要件3.1の「要点をすばやく読み取れる」という目的を損なう。(b) はサニタイズロジックが二重化し、既存パイプの改善が要約表示に及ばなくなる（`.claude/rules/coding-style.md` の単一の真実の源に反する）。
- **コード調査で判明した実態（設計時の想定と異なる点）**: `PageMarkdown.tsx` というコンポーネントは**存在しない**（`features/page-markdown/` は生Markdownをhttpで配信するサーバ側機能で別物）。実際の再利用先は `apps/app/src/components/PageView/RevisionRenderer.tsx`（`rendererOptions` と `markdown: string` を受け取る）である。ページ本文用の `PageContentRenderer` は `pagePath` を前提とするため、revision本文でない任意のMarkdown文字列には `RevisionRenderer` を直接使う。任意Markdownを描画する既存の先例が複数ある（`PageComment/Comment.tsx`、`PageEditor/Preview.tsx`、`Sidebar/Custom/CustomSidebarSubstance.tsx`）。
- **サニタイズ**: `rendererOptions` の `rehypePlugins` に `rehype-sanitize` が `[sanitize, getCommonSanitizeOption(config)]` として既に含まれる。オプションは `~/stores/renderer.tsx` の `generateSimpleViewOptions` 系フックから取得し、自前で組み立てない。既存パイプには `verifySanitizePlugin` / `hasSanitizePlugin` ガードがあり、サニタイズを欠いたオプションは例外になる — これを回避する実装は禁止する。

### 7.9 決定: ローカル非表示フラグの `localStorage` キーに `userId` を含める
- **代替案**: (a) `growi.aiSummary.hidden.{pageId}`（ブラウザ単位）。(b) `growi.aiSummary.hidden.{userId}.{pageId}`（ブラウザ×ユーザー単位）。
- **選定**: (b)。
- **理由**: `localStorage` はオリジン単位でブラウザ内の全ユーザーに共有されるため、(a) では共用端末やログアウト→別ユーザーでログインした場合に、あるユーザーの非表示操作が別ユーザーの表示に波及する。これは要件9.3の「閲覧者**ごとに**自分の画面上でのみ非表示にする」に反する。
- **`userId` の取得元**: `useCurrentUser()`（`~/states/global/global`）。SWRの `{ data }` ラッパではなく `IUserHasId | undefined` を直接返すJotaiフックであり、`currentUser?._id` で取得する。
- **未ログイン時の扱い**: `undefined` が返る場合は安定したキーを与えられないため、非表示フラグの読み書きを行わず常に表示する。ローカル非表示機能はログインユーザーに限定される。

---

## 8. Recommendations（ギャップ分析時点の推奨。7章で決定・解消したものは重複掲載しない）

- **推奨アプローチ**: Option B（新規の要約専用Agentを `suggestPathAgent` と同型パターンで追加）を基本線とし、統合方法（新規ルート vs 既存ルートへの薄い分岐＝Option C）は設計フェーズでUI連携の詳細と合わせて決定する。→ 7.2 で新規ルート（`POST /summary`）に決定済み。
- **実装フェーズへの残課題（Research Needed のうち唯一残っているもの）**: クロスAgentスレッド再生（要約後に `growiAgent` が `summarizeAgent` のスレッドを引き継ぐ）は、`@mastra/core` のソース確認により成立条件を裏取り済み（7.6）だが、このリポジトリに前例がない。**統合テストでの実証が実装の必須条件**であり、テストダブルの組み方は `suggest-path-agentic-integration.spec.ts`（Mastraレジストリをモックし、偽Agentが実物のツールを呼んでループを再現する方式）を踏襲する。実物のツールはバレル経由ではなく直接ファイルからインポートする必要がある（バレル経由では `@mastra/core/agent` が引き込まれvitest下でロードできない既知の制約）。
