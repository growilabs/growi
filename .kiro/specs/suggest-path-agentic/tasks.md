# Implementation Plan

- [x] 1. Foundation: 設定キーとエンジン識別子の整備
- [x] 1.1 運用設定キーの追加
  - 既定エンジン・検索回数上限・agentic タイムアウト・agentic 用モデルの 4 キーを設定定義に追加する（既定値: 'oneshot' / 5 / 60000 / 'gpt-4.1-mini'）
  - 各キーに対応する環境変数を定義し、既存の設定キー命名規約（aiTools 系・openai:assistantModel 系）に整合させる
  - エンジンキーの型はインライン literal union（'oneshot' | 'agentic'）で宣言し、feature の interfaces 層からは import しない（1.2 との並列安全性および依存方向の維持）
  - 4 キーすべてが configManager から既定値で読み出せ、環境変数で上書きできる状態になっている
  - _Requirements: 3.3, 3.4, 5.2, 5.6_

- [x] 1.2 (P) エンジン識別子型の追加
  - 'oneshot' | 'agentic' のエンジン識別子（const + 型）を client-safe な共有インターフェースに追加する
  - 識別子型が server / client 双方から import 可能で型チェックが通る
  - _Requirements: 5.1, 5.2_
  - _Boundary: suggest-path interfaces（1.1 の Config Keys とは別レイヤ・別ファイル）_

- [x] 2. (P) Mastra 実機スパイク: 前提挙動の確認
  - 実行環境は devcontainer（mongo / Elasticsearch / OpenAI API キーが必要。ホスト側では実行不可）
  - @mastra/core 1.41.0 実機で、tool の複数回呼び出しと structured output 取得が両立することを確認する（既知バグ mastra-ai/mastra#3139 系統の再発検知。両立しない場合は structuredOutput.model に同一モデルを明示指定して structuring パスを分離する方針へ切り替え）
  - wrapper tool から既存の全文検索 tool への execute 委譲が成立することを確認する（不成立の場合は wrapper 内で検索サービスを直接呼ぶ代替案を採用）
  - dynamic model（関数指定）が generate 毎に評価され、モデル設定の変更が再起動なしで反映されることを確認する
  - agent 実行結果の steps / usage の実形状（トークン使用量のフィールド名）を確認し、トレースログの整形方針を確定する
  - 4 つの確認項目すべての結果と採用方針が記録されている（research.md への追記等）
  - _Requirements: 3.4_
  - _Boundary: スパイク（throwaway コード。本実装ファイルには手を入れない）_

- [x] 3. agentic 探索の実行主体（Mastra agent 層）
- [x] 3.1 検索 budget 付きリクエストコンテキストと budget 執行検索 tool
  - 共有リクエストコンテキスト shape を拡張し、検索回数 budget（上限・消費カウンタ・実行クエリ記録）を per-request で伝搬する型を定義する（共有 shape は無改変）
  - 既存全文検索 tool と同一の入力スキーマを持ち、出力 union に limit_exceeded を追加した wrapper 検索 tool を実装する
  - budget 欠落時は context_error、上限到達時は委譲せず limit_exceeded を値で返し、それ以外は消費カウンタを増やしクエリを記録してから既存 tool へ委譲する（いかなる経路でも throw しない。権限フィルタは委譲先に委ねる）
  - budget 境界のユニットテスト（残あり → 委譲 + カウント + クエリ記録 / ちょうど上限 → limit_exceeded / budget 欠落 → context_error）が green
  - _Requirements: 1.5, 2.4, 3.1, 3.2_
  - _Depends: 2_

- [x] 3.2 (P) agent instructions の作成
  - 役割（文書の保存先として妥当な末尾スラッシュ付き親ディレクトリパスを wiki 内の探索に基づき提案する）を規定する
  - フロー/ストック判定を最初に行い、判定結果を検索誘導（探索する場所の優先付け・候補妥当性判断）に反映する規則を記述する
  - 探索戦略（検索結果を元文書と照らした判断、不十分時の語彙・条件変更による再検索、必要時の候補ページ本文参照）を記述する
  - 検索上限到達（limit_exceeded）時は収集済み情報から提案を確定する手仕舞い規則を記述する
  - 出力ルール（最大 3 件、親ディレクトリパス、label / description は文書の言語に合わせる）を記述する
  - 上記の観点（役割 / 判定 / 誘導 / 探索戦略 / 本文参照 / 手仕舞い / 出力ルール）をすべて含む instructions が英語で記述されている
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.2_
  - _Boundary: SuggestPathAgent (instructions)_

- [x] 3.3 suggestPathAgent の定義と Mastra インスタンスへの登録
  - instructions・dynamic model（設定からの per-request モデル解決）・tools 構成（wrapper 検索 tool + 既存ページ本文参照 tool）で agent を定義する（memory は接続しない）
  - barrel で agent と専用リクエストコンテキスト型のみを公開する
  - Mastra インスタンスの agents マップに additive に登録する
  - ユニットテストで tools 構成・memory 不接続・model が関数（DynamicArgument）であることが検証され green
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.4_

- [x] 4. エンジン抽象と agentic エンジン（ai-tools サービス層）
- [x] 4.1 エンジン契約の定義とワンショットエンジンの移設
  - エンジン入力とエンジン関数型（SuggestPathEngine 契約）を server 専用型として定義する
  - 現行のワンショットパイプライン部分（内容分析 → 検索候補取得 → 並列の候補評価 + grant 解決・category 提案）をロジック変更なしでワンショットエンジンとして実装する
  - 既存 4 サービスは無改変のまま import して順序立てるのみとし、analyze / retrieve 失敗時の内部 degradation（空配列返却）を維持する
  - このタスクでは既存オーケストレータ（generate-suggestions）には変更を加えない（一時的なロジック重複を許容し、旧パイプラインの除去・配線替えは 5.1 が所有する）
  - 移設後のワンショットエンジンの挙動がユニットテストで検証され green。既存 4 サービスのファイルに差分がない
  - _Requirements: 5.3, 5.5_

- [x] 4.2 (P) structured output 契約（スキーマ・型・型ガード）
  - agent 出力の JSON Schema 定数（OpenAI strict mode 互換: 全レベル additionalProperties: false・全プロパティ required。informationType は flow | stock、suggestions は path / label / description で最大 3 件）を直接記述する（Zod からの変換はしない）
  - 対応する TS 型と型ガードを定義する
  - 型ガードのユニットテスト（正常系 / informationType 不正 / path 欠落 / 余剰プロパティ拒否）が green で、JSON Schema 定数と TS 型の整合（required・enum 値）が確認されている
  - _Requirements: 1.4, 2.1, 4.2_
  - _Boundary: AgenticOutputSchema_

- [x] 4.3 agentic エンジンアダプタ（コア実行パス）
  - 検索上限・タイムアウトの設定をリクエスト毎に読み出し、per-request のリクエストコンテキスト（user / 検索サービス / 検索 budget）を構築する（module-scope 共有禁止）
  - Mastra レジストリから agent を取得し、structured output スキーマ・maxSteps（2 × 検索上限 + 4）・AbortController によるタイムアウト signal を渡して実行する
  - 出力を型ガードで検証し、path 正規化（先頭・末尾スラッシュ保証、正規化不能エントリ破棄）→ 重複除去 → 最大 3 件制限 → grant 並列解決 → informationType 付与のマッピングを行う（category 提案は生成しない）
  - 検証不合格・例外・タイムアウトは reject で返す（オーケストレータの memo フォールバックに委ねる）
  - ワンショット固有 4 サービスを import しない（旧エンジン単独削除可能性の保証）
  - ユニットテスト（正常出力のマッピング / 不正出力 reject / タイムアウト reject / 設定の per-request 読み出し）が green
  - _Requirements: 1.1, 1.4, 2.3, 3.3, 4.2, 4.4, 4.5, 5.5_
  - _Depends: 3.3, 4.2_

- [x] 4.4 agentic エンジンの探索過程トレースログ
  - info サマリログ（リクエスト毎 1 行: 処理時間・検索回数・ページ参照回数・stopReason・informationType・提案件数・トークン使用量）を実装する。stopReason の判定規則（timeout / budget_exhausted / error / completed）を実装し、reject 経路でも catch してサマリを出力してから rethrow する
  - debug 詳細ログ（実行クエリ列と各ヒット概要、steps から再構成した tool 呼び出しシーケンス）を実装する
  - プライバシー制約を守る: 文書本文・本文由来の検索クエリは debug レベル限定、info にはメタ情報（件数・時間・トークン）のみ
  - トークン使用量のフィールド名はスパイク（タスク 2）で確認した実形状に合わせる
  - ロガーをモックしたユニットテストで、サマリログに必要フィールドがすべて含まれること・reject 経路でもサマリが出力されることが green
  - _Requirements: 2.4, 6.2, 6.3_
  - _Depends: 2, 4.3_

- [x] 4.5 エンジンディスパッチャ
  - engine id からエンジン実装を解決する static map（oneshot / agentic）を実装し、barrel からは実行関数のみを再エクスポートする（レジストリ等の拡張機構は作らない）
  - engine id 毎に対応する実装が実行されることがユニットテストで green
  - _Requirements: 5.1, 5.2, 5.4_

- [x] 5. オーケストレータと API の統合
- [x] 5.1 オーケストレータの再構成
  - memo 提案を常に生成してレスポンス先頭に含め、engine id（リクエスト指定 → なければ設定の既定）でディスパッチする構成に再構成する（公開シグネチャは後方互換: 既存引数列 + optional オプション）。旧パイプラインロジックの除去（ワンショットエンジンへの配線替え）はこのタスクが所有する
  - 非対称フォールバックを実装する: agentic エンジンの reject（例外・タイムアウト）は捕捉して memo のみ返す。oneshot エンジンの例外は現行どおり伝播させる
  - 既存のオーケストレータのテストが無修正で green、agentic reject 時に memo のみ返ることが新規テストで green
  - _Requirements: 4.3, 4.5, 5.2, 5.3_

- [x] 5.2 route への optional engine パラメータの追加
  - リクエストボディの optional な engine フィールドに enum validation（'oneshot' | 'agentic' のみ許可、不正値は 400）を追加し、ハンドラはオーケストレータへ受け渡すのみとする
  - 既存ミドルウェアチェーン・レスポンス形式は無変更
  - engine 未指定リクエストが現行と完全互換で動作し、不正値が 400 になる
  - _Requirements: 4.1, 5.2, 6.1_

- [x] 6. 統合検証
- [x] 6.1 route 統合テスト
  - engine: 'agentic' 指定（agent モック）で 200 + 契約準拠レスポンス、engine 不正値で 400、未指定で oneshot 経路となることを統合テストで検証する
  - 上記 3 シナリオが green
  - _Requirements: 4.1, 4.2, 5.2, 6.1_

- [x] 6.2 agentic 経路の統合テスト
  - モック agent が limit_exceeded を経て出力を返すシナリオで、レスポンスに memo 提案 + informationType 付き search 提案が含まれることを検証する
  - シナリオテストが green
  - 6.1 と同一テスト資産を触る可能性があるため並列実行しない
  - _Requirements: 1.4, 2.3, 3.2, 4.3_

- [x] 6.3 後方互換の最終確認と全体回帰
  - 既存のオーケストレータ・統合・既存 4 サービスの spec 群が一切の変更なしで green であることを確認する（5.3 の受け入れ証拠。万一モック方式起因の修正が避けられない場合もモックパスの機械的変更に限定し、アサーションには手を入れない）
  - lint / test / build が通る（実行環境は devcontainer。ホストには mongo / Elasticsearch / turbo がない）
  - _Requirements: 5.3_

- [x] 7. A/B 測定と受け入れ判断
- [x] 7.1 A/B 測定の実施とメトリクス記録
  - 実行環境は devcontainer（#183968 評価環境 = ローカル GROWI + dev wiki データはそこに構築済み）
  - 測定開始前に実機 1 リクエストのスモーク（agentic エンジン指定で実 LLM を通した end-to-end 動作確認）を行い、配線不良を測定中に発覚させない
  - #183968 評価環境（ローカル GROWI + dev wiki データ、6 ユースケース × 10 回）で、リクエストの engine フィールド切り替えにより両エンジンを同一条件で測定する
  - 指標は正解親配下出現率とし、1 リクエスト毎のレスポンス時間・実検索回数・トークン消費をサマリログから収集して記録する
  - oneshot 側の再測定値が #183968 のベースライン 41/60 から大きく乖離した場合は、エンジン比較に進む前に環境要因（ES インデックス状態・データ差分等）を調査する
  - 両エンジンの測定結果が記録され、ベースライン 41/60 との比較が示されている
  - _Requirements: 6.1, 6.2_
  - _2026-06-12 ユーザー指示により実施完了。結果: oneshot 再測定 40/60（ベースライン 41/60 を再現、環境健全）、agentic 4/60。ただし miss の 52/56 が「正解ページの親ディレクトリ」を提案する parent-level near-miss（探索到達率 56/60）で、敗因は instructions の出力規則（PARENT DIRECTORY 表現によりリーフページ配下の提案を回避）に集中。運用面は全件正常（p50 8.5s / avg 9.8k tokens/req / budget 枯渇・timeout・error ゼロ）。記録: GROWI 検証ページ群「agentic search エンジンの A/B 測定 184610」（pageId 6a2ad59e173f969dbd278f91）+ devcontainer apps/app/tmp/71-results.json_

- [x] 7.2 探索誘導の確認と受け入れ判断
  - debug トレース（クエリ列・tool シーケンス）でフロー/ストック判定が検索誘導に反映されていることをユースケース毎に確認する
  - ベースライン未達の場合は探索過程ログに基づく原因分析を記録し、改善継続 / 方針転換を判断する。改善継続の場合は agent instructions（3.2 の成果物）のチューニングを反復して再測定する。結果を既存の検証ページ群と同じ場所に記録する
  - ユースケース毎の誘導反映確認と受け入れ判断の記録が存在する
  - _Requirements: 6.3, 6.4_
  - _2026-06-12 ユーザー指示（改善継続）により実施完了。debug トレースで誘導反映を確認（Req 6.3: 全件 stock 判定 → 仕様系語彙で蓄積系を探索。6 ケース中 5 ケースで正解ページに到達済みと判明）。原因 = instructions の「PARENT DIRECTORY」表現がリーフページ配下の提案を妨げていた。チューニング 2 ラウンド（302d974819, 066d1776de）で 4/60 → 39/60 → **52/60（ベースライン 41/60 比 +11、oneshot 再測定 40/60 比 +12）**。残 8 件は過適合リスクのため R3 見送り、ユースケース拡充（#184975 系統）での汎化検証を後続とする。受け入れ判断: agentic エンジンの有効性を確認（記録: 検証ページ 6a2ad59e173f969dbd278f91 に追記済み）_

- [x] 8. 推論強度（reasoning effort）の設定化
- [x] 8.1 reasoning effort 設定キーの追加
  - `openai:reasoningEffort:suggestPathAgent`（型 `string`・既定値 `''`・環境変数 `OPENAI_SUGGEST_PATH_AGENT_REASONING_EFFORT`）を設定定義に追加する。既存の `openai:assistantModel:suggestPathAgent`（1.1 で追加）と同型・同レイヤで宣言する
  - 当該キーが configManager から既定値 `''` で読み出せ、環境変数で上書きできる
  - _Requirements: 3.5, 3.6_
  - _Depends: 1.1_
  - _Boundary: Config Keys（config-definition.ts）_
- [x] 8.2 AgenticEngine への reasoning effort 配線
  - AgenticEngine で `openai:reasoningEffort:suggestPathAgent` をリクエスト毎に `configManager.getConfig()` で読み、値が非空のときのみ `agent.generate` の `providerOptions.openai.reasoningEffort` に透過する。空文字列のときは `providerOptions` を渡さず現行挙動を維持する
  - 値の妥当性検証はエンジン層で行わず、プロバイダ側に委ねる（未対応の組み合わせは既存のエンジン失敗フォールバック 4.5 が受ける）
  - config が非空なら providerOptions に effort が乗り、空なら providerOptions が渡らないことがユニットテストで検証されている（既存 agentic-engine.spec の config 駆動ケースに追従）
  - _Requirements: 3.5, 3.6_
  - _Depends: 8.1_
  - _Boundary: AgenticEngine（agentic-engine.ts）_

## Implementation Notes

- 1.1/1.2: ホスト（Windows）でユニットテストを動かすには `packages/core` の事前ビルドが必要（`pnpm run build`）。アプリ全体の `lint:typecheck` は兄弟パッケージの dist 未ビルドで完走しない（devcontainer 専用 = 6.3 の所有）。タスクローカルの型検証は一時 tsconfig（include を変更ファイルに限定）+ `tsgo --noEmit -p` で代替可能
- 2: スパイク 4 項目すべて成立（research.md「Spike Results」参照）。フォールバック方針は一切不要。usage は AI SDK v5 命名（inputTokens/outputTokens）で `totalUsage` を採用、toolCalls は `steps[].toolCalls[].payload.{toolName,args}`
- 2: pnpm-workspace.yaml の `@mastra/core>p-map: 4.0.0` override により `@mastra/core/agent` は vitest（ESM）で import 不可（pMapSkip link エラー）。3.3 / 4.x のユニットテストは growi-agent.spec.ts の StubAgent `vi.mock('@mastra/core/agent', ...)` パターンを踏襲すること。`@mastra/core/request-context` / `tools` は影響なし
- 2: dynamic model 解決関数は 1 generate あたり約 2 回評価される — 副作用なし・軽量に保つこと
- 5.1: design の「既存テスト無修正 green」は **additive-mock-wiring の意味で充足**（アサーション・既存行は byte-identical、追加は vi.mock 配線のみ 19+/0− と 16+/0−）。engines barrel → agentic-engine → mastra-modules の静的 import チェーンが app-unit vitest でロード不能（p-map ESM）なため、`./engines/agentic-engine` のスタブ mock 追加が必須だった。レビューで HEAD spec の import 時 fail を再現済み = モック方式起因の証明。6.3 はこの解釈を前提に再検証すること（再揉めしない）
- 6.3: devcontainer（HEAD 526c3d3694）で suggest-path 17 files/297 tests + mastra-modules 7 files/83 tests 全 green。lint/test/build の非ゼロ exit はすべて feature 起因でないことを証明済み: (a) `post-message.ts` TS2769 は baseline byte-identical の pre-existing（support/mastra 系譜・chat 側 = spec 境界外。**リリース前に要修正**）、(b) full-suite の 13 fail 中 12 は負荷起因（分離再実行 green）、(c) `update-activity.spec` は mongod バイナリ SIGSEGV（コンテナ環境問題）。build:client は exit 0。devcontainer の `@growi/core` dist が stale だったため `pnpm exec turbo run build --filter "@growi/app^..."` を実施（環境修復）
