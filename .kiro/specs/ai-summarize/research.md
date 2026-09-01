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

| 要件 | 対応する既存資産 | ギャップ種別 |
|---|---|---|
| R1.1/1.2 その場でのオンデマンド要約・都度生成 | `growiAgent.stream()` と同型の呼び出しパターン | Constraint（既存パターンの再利用で足りる） |
| R1.3 現在ページ非依存時は非提供 | なし（現在ページのコンテキスト伝搬自体が未実装） | **Missing** |
| R1.4 同一対話内での追質問継続 | `memory`（MongoDBStore）はあるが、要約エージェントとgrowiAgentのスレッド共有方式は未確定 | **Missing / Research Needed** |
| R1.5 重複生成の抑止 | 既存の会話フローに同等機構なし（クライアント側の多重送信防止のみ想定されるが未確認） | **Missing / Research Needed** |
| R2.1/2.2 全文カバレッジ・上限到達時の明示 | `getPageContentTool`（そのまま再利用可）＋新規instructions | Constraint（ツール流用＋新規エージェント） |
| R2.3 検索Q&A用の読み取り方針を変更しない | `growi-agent.ts` は不変資産として維持 | Constraint（触らないことが正しい） |
| R3.1 出力形式統一 | 新規エージェントのinstructionsで指定 | Missing（軽微） |
| R4.1/4.2 都度の権限確認・非開示 | `getPageContentTool` の既存実装がそのまま満たす | Constraint（変更不要、破ってはいけない） |
| R5.1 AI未設定時の利用不可 | `aiReadyGuard` | Constraint（再利用のみ） |
| R6.1/6.2 利用実績の計測 | `custom-metrics/` ディレクトリ（ただしCounterパターンは前例なし） | Missing（新規パターン） |

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

| 項目 | Effort | Risk | 根拠 |
|---|---|---|---|
| 要約専用Agent新設＋instructions | S〜M | Low | `suggestPathAgent` という直接の前例があり、パターンが確立済み |
| 現在ページコンテキストの伝搬（クライアント→リクエスト） | M | Medium | 新規配線。トリガーUI未確定のため、汎用的なインターフェース設計が必要 |
| スレッド継続（要約Agent⇄追質問）の設計 | M | Medium | `memory` 自体は既存だが、Agent切り替えとスレッド共有の組み合わせ方に前例がない |
| 全文カバレッジの上限制御（instructions＋呼び出しパラメータ） | S〜M | Medium | ツール非変更の制約下でどこまで確実性を担保できるか（LLMの指示追従に依存する部分が残る） |
| 利用状況Counter計測 | S | Low | OpenTelemetryの標準的なCounter APIで実現可能。パターンは新規だが技術的難度は低い |
| 権限チェックの一元性維持（設計ガードレール） | - | Low（ガードレールを明文化すれば） | 実装コストではなくレビュー観点。設計書に明記すれば実装時の逸脱を防げる |

全体としては **M（3〜7日相当）** 感の機能規模。既存資産の再利用度が高く、アーキテクチャ上の大きな新規性はない。

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
- **選定**: (1) `limitedGetPageContentTool` が `RequestContext` の `pageReadBudget`（`{ used, limit }`、`limit` は1500行）を読み、`used >= limit` なら委譲せず `limit_exceeded` を返す — 読み取り量のハード上限をコードで強制する。(2) instructionsは `limit_exceeded` 受領後の打ち切りと、部分的な内容に基づく旨の明示のみを規定する。(3) `/summary` ルート独自の `maxSteps`（`post-message.ts` の `maxSteps: 10` とは別の値）を、instructionsに従わずツール呼び出しを続けた場合の安全弁として設定する。`getPageContentTool` 自体は無変更。
- **フォローアップ**: バジェット判定は呼び出し**前**に行い、`getPageContentTool` の `limit` は最大500行（`get-page-content-tool.ts` の `inputSchema`）であるため、実効の読み取り量は最大で `limit + 500` 行（約2000行）に達しうる。この許容幅を design.md に明記する。

### 7.4 決定: 要約リクエストはクライアントの自由入力を受け取らず、`pageId`/`pagePath`からサーバ側で初期発話を組み立てる
- **理由**: 出力形式（3.1）の安定性と、全文カバレッジ方針の適用対象を「要約リクエストのみ」に限定する境界（2.3）を、プロンプト内容のばらつきに依存せず構造的に保証するため。

### 7.5 見送った案: 重複生成抑止のためのサーバ側ロック
- 要約は状態を書き換えないため、二重リクエストが発生しても不整合は起きない（無駄なリクエストが増えるのみ）。トリガーUI（別spec）側の送信中ガード（`ChatSidebar`の`handleSubmit`と同種のパターン）に委ね、本specではサーバ側の新規ロック機構を追加しない。有用性起点で見て、二重生成そのものが実害を持たない以上、コストをかけて防ぐ理由がないという判断。

---

## 8. Recommendations / Research Needed（ギャップ分析時点で持ち越した事項。7章で決定・解消したものは重複掲載しない）

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
- **推奨アプローチ**: Option B（新規の要約専用Agentを `suggestPathAgent` と同型パターンで追加）を基本線とし、統合方法（新規ルート vs 既存ルートへの薄い分岐＝Option C）は設計フェーズでUI連携の詳細と合わせて決定する。
