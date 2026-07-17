# Requirements Document

> **現状（実装完了 / PR #11293）**: パス提案は agentic search 単一エンジン。エンジン選択は可用性ベース（Mastra AI 設定済み → agentic / 未設定 → route の `aiReadyGuard` が 501）。当初あった 2 エンジンの明示切り替え（`engine` フィールド・`aiTools:suggestPathEngine`・`SuggestPathEngineId`）は撤去済み。旧 oneshot は `features/openai` の LLM に依存していたため features/openai 全廃に伴い撤去した。AI なし・Elasticsearch のみのフォールバックは将来計画（Requirement 5 の Note）。A/B 測定は完了済み。

## Introduction

suggest-path API のパス提案エンジンを、ワンショット検索構成から agentic search（検索結果を元文書と照らして検索語・条件を変えながら複数回探索する挙動）に換装する。API の外部契約は維持したまま、既存の評価環境でベースラインとの A/B 比較により効果を実証した。Redmine #184610 のストーリーに対応する。

## Project Description (Input)

suggest-path のエンジンを Mastra の agentic search に換装する（Redmine #184610）。

現行の suggest-path API（`apps/app/src/features/ai-tools/suggest-path/`）は「キーワード抽出 → ES 全文検索 1 回 → LLM 候補評価」のワンショット構成で OpenAI を直接呼んでおり、最初の検索が外れると回復手段がない（語彙ミスマッチ起因の全滅ケースが #183968 の評価で確認済み。ベースライン 41/60）。

これを support/mastra ブランチの Mastra 基盤（`fullTextSearchTool` / `getPageContentTool`）を使う suggest-path 専用 Agent に置き換え、検索結果を元文書と照らして検索語・条件を変えながら複数回探索する agentic search 的挙動を実現する。文書のフロー/ストック判定を検索誘導に使い、検索回数上限（3〜5 回）でレスポンス時間と精度のトレードオフを取る。

API 契約（レスポンス型・trailing-slash 親パス規約・grant 解決・memo フォールバック）は維持し、新旧エンジンは切り替え式で並存させて #183968 のローカル評価環境（6 usecases × 10 runs）で A/B 測定する。

詳細な背景・スコープ境界・上下流依存・技術的制約（Mastra 既知バグの回避方針を含む）は [brief.md](./brief.md) を参照。

## Boundary Context

- **In scope**:
  - agentic search エンジン（複数回検索の試行錯誤により保存先候補に辿り着くエンジン）の新設
  - 文書のフロー/ストック判定を探索の誘導に反映すること
  - 検索回数上限によるレスポンス時間と精度のトレードオフ制御
  - 既存評価環境でのベースライン比較（A/B 測定、完了済み）
- **Out of scope**:
  - HTC によるリランク（別ストーリー）
  - セマンティック検索の導入
  - クライアント側（MCP クライアント）の挙動変更
  - チャット機能・チャット向けエージェントの挙動変更
  - AI なし・Elasticsearch のみのフォールバックエンジンの実装（将来計画。Requirement 5 の Note）
- **Adjacent expectations**:
  - 全文検索基盤が、リクエストユーザーの閲覧権限を反映したヒット結果を返せる状態であること
  - ページ本文を閲覧権限に準拠して取得できる手段が存在すること
  - 既存 suggest-path API の契約（エンドポイント、レスポンス型、認証、memo フォールバック、grant 制約）が suggest-path spec に定義済みであること
  - #183964/#183967/#183968 で構築した評価器・代表ユースケース・ベースライン測定値が利用可能であること

## Requirements

### Requirement 1: 複数回検索による保存先提案

**Objective:** As a MCP クライアントの利用者, I want suggest-path が一度の検索で適切な候補が得られない場合も検索を試行錯誤して妥当な保存先に辿り着くこと, so that クライアント側で検索を肩代わりさせることなく API 単体で適切な保存先提案を得られる

#### Acceptance Criteria

1. When 保存対象の文書本文を受け取ったとき、the agentic search エンジン shall 文書内容に基づいて wiki 内を検索し、検索結果を元文書と照らして保存先候補としての妥当性を判断すること。
2. If 検索結果が保存先候補として不十分または不適切と判断されたとき、the agentic search エンジン shall 検索語・検索条件を変えて再検索すること。
3. When 候補の妥当性判断に候補ページの内容確認が必要なとき、the agentic search エンジン shall 候補ページの本文を参照して判断に反映できること。
4. When 探索が完了したとき、the agentic search エンジン shall 収集した候補に基づいて保存先パスの提案を生成すること。
5. The agentic search エンジン shall 検索・本文参照・子ページ一覧参照の対象をリクエストユーザーの閲覧権限の範囲内に限定すること。

> **Note（実態追従 2026-07-06）**: 実装後のチューニング（#185213）で、候補親の兄弟構成を確認する**子ページ一覧参照**（listChildren tool）が第三の探索手段として追加された。AC 5 の権限限定はこの手段にも適用される（`pageListingService` の権限フィルタに委譲）。

### Requirement 2: フロー/ストック判定による検索誘導

**Objective:** As a 利用者, I want 文書の性質（フロー情報/ストック情報）が保存先の探索に反映されること, so that 「議事録なら時系列系の場所、仕様なら蓄積系の場所」のような人間的な絞り込みが行われる

#### Acceptance Criteria

1. When 保存対象の文書本文を受け取ったとき、the agentic search エンジン shall 文書がフロー情報（時限的・時系列的な情報）かストック情報（蓄積・参照される情報）かを判定すること。
2. While 探索を実行している間、the agentic search エンジン shall フロー/ストック判定の結果を検索の誘導（候補の妥当性判断および再検索の方向付け）に反映すること。
3. The suggest-path API shall 判定した informationType を該当する提案のレスポンスに含めること。
4. The agentic search エンジン shall フロー/ストック判定の結果および探索過程（実行した検索、再検索の判断）を、検証およびデバッグ時に確認可能な形で記録すること。

### Requirement 3: 検索回数上限による制御

**Objective:** As a API の利用者および運用者, I want 探索の試行錯誤が無制限に続かず一定の範囲で応答が返ること, so that レスポンス時間と運用コストが許容範囲に収まる

#### Acceptance Criteria

1. The agentic search エンジン shall 1 リクエストあたりの検索回数に上限を設けること。
2. When 検索回数が上限に達したとき、the agentic search エンジン shall その時点までに収集した情報に基づいて提案を生成して返すこと。
3. Where 運用者が検索回数上限を設定で変更したとき、the agentic search エンジン shall 変更後の上限値に従って動作すること。
4. Where 運用者が agentic search エンジンの使用する AI モデルを設定で変更したとき、the agentic search エンジン shall 変更後のモデルで動作すること。
5. Where 運用者が agentic search エンジンの推論強度を設定で変更したとき、the agentic search エンジン shall 変更後の推論強度で動作すること。
6. When 推論強度が設定で指定されていないとき、the agentic search エンジン shall 推論強度を変更しない既定の動作で提案を生成すること。

> **Note**: レスポンス時間の絶対上限値は Redmine #184610 上も「別途合意」とされている。本 spec では Requirement 6 の測定によりレスポンス時間の実測値を記録し、上限値の合意と既定の検索回数上限（3〜5 回の範囲を想定）の確定は design および検証フェーズで行う。

> **Note**: AC 5・6（推論強度の設定化）は AC 4（モデルの設定化）と同種の、レスポンス時間と精度のトレードオフを運用者が再起動なしに調整するための制御である。既定は未指定（現行挙動と同一）とし、設定可能な値の範囲・推奨値・対象モデルの制約は design および検証フェーズで確定する。

> **Note（実態追従 2026-07-06）**:
> - 検索回数上限（AC 1〜3）とは独立に、listChildren tool の呼び出し上限（`aiTools:suggestPathAgenticChildListingLimit`、既定 5、#185213）が第二の budget として存在する。
> - AC 4（モデルの設定化）の実現形態は support/mastra マージで変更された: モデルは suggest-path 専用キーではなく**アプリ全体設定 `ai:provider` / `ai:model`** で決まり、AI 設定保存時の cache clear により再起動なしで反映される（要求自体は充足）。旧専用キー `openai:assistantModel:suggestPathAgent` は読み手のいない dead key だったため削除済み（2026-07-09、PR #11293 レビュー対応）。
> - AC 5（推論強度）の設定は当初 `openai:reasoningEffort:suggestPathAgent`（OpenAI 名前空間固定）だったが、provider 汎用の `ai:providerOptions:suggestPathAgent`（provider 名前空間付き Record を catalog 宣言 options に deep merge）へ移行した（2026-07-13、PR #11293 再レビュー B-1・案 A。design の Config Keys 参照）。

### Requirement 4: API 契約の後方互換

**Objective:** As a 既存 MCP クライアントの開発者, I want suggest-path API の外部契約が変わらないこと, so that クライアント側を変更せずにエンジン改善の恩恵を受けられる

#### Acceptance Criteria

1. The suggest-path API shall 既存のエンドポイント、リクエスト形式（`body` フィールド）、および認証・認可要件を維持すること。
2. The suggest-path API shall レスポンスの各提案に `type` / `path` / `label` / `description` / `grant` を含め、`path` は末尾スラッシュ付きの親ディレクトリパスであること。
3. The suggest-path API shall エンジンの選択にかかわらず memo 提案を常にレスポンスに含めること。
4. The suggest-path API shall 各提案の `grant` に親ページの grant 値（子ページに設定可能な権限の上限制約）を含めること。
5. If agentic search エンジンの実行が失敗した、または規定の時間内に完了しなかった（タイムアウトした）とき、the suggest-path API shall memo 提案のみのレスポンスを返すこと。

> **Note**: タイムアウトの規定値は design フェーズで確定する。検索回数上限（Requirement 3）が反復の回数を抑え、タイムアウトが個々の処理の遅延を含めた総時間のセーフティネットとして機能する。

### Requirement 5: エンジンの可用性フォールバック

**Objective:** As a GROWI 運用者, I want suggest-path が実行環境で利用可能な基盤に応じて自動的に最善のエンジンで動作すること, so that エンジンの手動切り替え設定なしに、どの構成の GROWI でも suggest-path が機能する

#### Acceptance Criteria

1. When AI 機能が有効（`app:aiEnabled`）かつ Mastra AI 基盤が利用可能（利用可能なプロバイダ配下の許可モデルが 1 つ以上存在）なとき、the suggest-path API shall agentic search エンジンで提案を生成すること。
2. When AI 機能が無効、または Mastra AI 基盤が未設定なとき、the suggest-path API shall route の `aiReadyGuard` により 501（AI not ready）を返すこと。
3. The suggest-path API shall エンジンの選択をリクエスト毎の可用性評価で行い、AI 設定の状態変化を再起動なしに反映すること。
4. The agentic search エンジン shall エンジン非依存の共通基盤（API ルート、レスポンス型、memo 提案、grant 解決）以外の、将来の Elasticsearch-only フォールバック用に温存したサービス（`retrieve-search-candidates` / `generate-category-suggestion`）に依存せずに動作すること。

> **Note（将来計画）**: 「Mastra AI 未設定だが全文検索は利用可能」な環境向けに、AI を使わず Elasticsearch だけで提案する oneshot フォールバックエンジンを将来整備する（design.md「将来のロードマップ」・tasks.md F.1〜F.4）。それが入ると、当該環境の応答は 501 から ES-only 提案へ変わり、AC 2 は「AI 機能無効・かつ全文検索も利用不可のとき 501／memo のみ」に更新される。旧 oneshot は `features/openai` の LLM（キーワード抽出・候補評価）に依存していたため、`features/openai` 全廃に伴い撤去した（`analyze-content` / `evaluate-candidates` / `call-llm-for-json` / `oneshot-engine` を削除。`engine` リクエストフィールド・`aiTools:suggestPathEngine` 設定キー・`SuggestPathEngineId` 型も撤去済み）。
> **Note**: category 提案（既存 spec Requirement 4、Under Review）は agentic search エンジンでは生成しない（検索由来の `search` 提案に一本化。実装時決定）。

### Requirement 6: 効果測定（A/B 検証）

**Objective:** As a 開発チーム, I want 新旧エンジンを同一条件で測定して比較すること, so that 換装の効果を定量的に判断し受け入れ可否を決められる

#### Acceptance Criteria

1. When agentic search エンジンを #183968 と同一条件の評価環境（6 ユースケース × 10 回）で測定したとき、the 開発チーム shall トップN命中率（正解親配下出現率）を記録し、ベースライン（41/60）と比較すること。
2. The 測定 shall 命中率と合わせて、1 リクエストあたりのレスポンス時間、実際の検索回数、およびトークン消費量を記録すること。
3. When 測定を実施したとき、the 開発チーム shall 探索過程の記録（Requirement 2 AC 4）によりフロー/ストック判定が検索誘導に反映されていることを確認すること。
4. When 測定結果がベースラインの命中率を上回らなかったとき、the 開発チーム shall 原因分析を記録し、受け入れ判断（改善継続/方針転換）を行うこと。

> **Note（実態追従 2026-07-06）**: AC 1 の 6 ユースケース × 10 回測定は実施済み（tasks.md 7.1/7.2: 初回 4/60 → 原因分析 → instructions チューニング 2 ラウンドで 52/60、ベースライン 41/60 超えで受け入れ確認）。その後の精度検証の主軸は 50 ケースのミス率プロトコル（実本文入力・評価器 judge 方式）へ移行しており、6×10 / 41/60 の枠組みは受け入れ判断時点の物差しである。
