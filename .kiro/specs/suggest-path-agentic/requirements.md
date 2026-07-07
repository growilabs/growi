# Requirements Document

> **実態追従改訂（2026-07-06）**: 実装完了・受け入れ後の実態に合わせ、AC 1.5 の本文更新と各 Requirement への Note 追記を行った（listChildren tool の追加 #185213、support/mastra マージによるモデル解決方式の変更）。要求の意図自体は変更していない。

## Introduction

suggest-path API のパス提案エンジンを、ワンショット検索構成から agentic search（検索結果を元文書と照らして検索語・条件を変えながら複数回探索する挙動）に換装する。API の外部契約は維持したまま、新旧エンジンを切り替え式で並存させ、既存の評価環境でベースラインとの A/B 比較により効果を実証する。Redmine #184610 のストーリーに対応する。

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
  - 従来エンジンとの切り替え式並存、および既存評価環境でのベースライン比較（A/B 測定）
- **Out of scope**:
  - HTC によるリランク（別ストーリー）
  - セマンティック検索の導入
  - クライアント側（MCP クライアント）の挙動変更
  - チャット機能・チャット向けエージェントの挙動変更
  - 従来エンジン（ワンショット構成）の削除（検証結果を踏まえ別途判断）
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
> - AC 4（モデルの設定化）の実現形態は support/mastra マージで変更された: モデルは suggest-path 専用キーではなく**アプリ全体設定 `ai:provider` / `ai:model`** で決まり、AI 設定保存時の cache clear により再起動なしで反映される（要求自体は充足）。旧専用キー `openai:assistantModel:suggestPathAgent` は読み手のいない dead key として残存中（design の Config Keys 参照・扱い要判断）。
> - AC 5（推論強度）の設定値は `providerOptions.openai.*` 名前空間に固定で渡るため、`ai:provider` が OpenAI 系以外のときはサイレントに無効（design 参照・扱い要判断）。

### Requirement 4: API 契約の後方互換

**Objective:** As a 既存 MCP クライアントの開発者, I want suggest-path API の外部契約が変わらないこと, so that クライアント側を変更せずにエンジン改善の恩恵を受けられる

#### Acceptance Criteria

1. The suggest-path API shall 既存のエンドポイント、リクエスト形式（`body` フィールド）、および認証・認可要件を維持すること。
2. The suggest-path API shall レスポンスの各提案に `type` / `path` / `label` / `description` / `grant` を含め、`path` は末尾スラッシュ付きの親ディレクトリパスであること。
3. The suggest-path API shall エンジンの選択にかかわらず memo 提案を常にレスポンスに含めること。
4. The suggest-path API shall 各提案の `grant` に親ページの grant 値（子ページに設定可能な権限の上限制約）を含めること。
5. If agentic search エンジンの実行が失敗した、または規定の時間内に完了しなかった（タイムアウトした）とき、the suggest-path API shall memo 提案のみのレスポンスを返すこと。

> **Note**: タイムアウトの規定値は design フェーズで確定する。検索回数上限（Requirement 3）が反復の回数を抑え、タイムアウトが個々の処理の遅延を含めた総時間のセーフティネットとして機能する。

### Requirement 5: エンジンの切り替えと並存

**Objective:** As a 開発者および検証者, I want 新旧エンジンを切り替えて同一条件で動作させられること, so that 効果測定と安全なロールバックが可能になる

#### Acceptance Criteria

1. The suggest-path API shall 従来エンジン（ワンショット構成）と agentic search エンジンを切り替え可能な形で並存させること。
2. When エンジンが明示的に指定されないとき、the suggest-path API shall 既定のエンジンで提案を生成すること。
3. The suggest-path API shall 従来エンジンの提案生成挙動を変更しないこと。
4. Where agentic search エンジンが選択されているとき、the suggest-path API shall Requirement 1〜3 に定める挙動で提案を生成すること。
5. The agentic search エンジン shall 従来エンジン固有の構成要素（キーワード抽出・一発検索・候補評価などのワンショットパイプラインを構成するモジュール）に依存せずに動作すること。エンジン非依存の共通基盤（API ルート、レスポンス型、memo 提案、grant 解決）への依存はこの限りではない。
6. While Requirement 6 の検証により agentic search エンジンの有効性が確認されていない間、the suggest-path API shall 従来エンジンを既定エンジンとすること。

> **Note**: AC 5 は、検証完了後に従来エンジンを単独で削除可能とするための制約である（削除の実施自体は本 spec のスコープ外）。AC 6 により、検証完了前に本ブランチが上流へマージされた場合でも既存挙動が維持される。検証完了後に既定を agentic search エンジンへ切り替えるかは検証結果を踏まえて別途判断する。
> **Note**: category 提案（既存 spec Requirement 4、Under Review）は現状、従来エンジンの検索結果から生成されている。agentic search エンジンが category 相当の提案をどう扱うか（agent が生成する/対象外とする）は design フェーズで確定する。

### Requirement 6: 効果測定（A/B 検証）

**Objective:** As a 開発チーム, I want 新旧エンジンを同一条件で測定して比較すること, so that 換装の効果を定量的に判断し受け入れ可否を決められる

#### Acceptance Criteria

1. When agentic search エンジンを #183968 と同一条件の評価環境（6 ユースケース × 10 回）で測定したとき、the 開発チーム shall トップN命中率（正解親配下出現率）を記録し、ベースライン（41/60）と比較すること。
2. The 測定 shall 命中率と合わせて、1 リクエストあたりのレスポンス時間、実際の検索回数、およびトークン消費量を記録すること。
3. When 測定を実施したとき、the 開発チーム shall 探索過程の記録（Requirement 2 AC 4）によりフロー/ストック判定が検索誘導に反映されていることを確認すること。
4. When 測定結果がベースラインの命中率を上回らなかったとき、the 開発チーム shall 原因分析を記録し、受け入れ判断（改善継続/方針転換）を行うこと。

> **Note（実態追従 2026-07-06）**: AC 1 の 6 ユースケース × 10 回測定は実施済み（tasks.md 7.1/7.2: 初回 4/60 → 原因分析 → instructions チューニング 2 ラウンドで 52/60、ベースライン 41/60 超えで受け入れ確認）。その後の精度検証の主軸は 50 ケースのミス率プロトコル（実本文入力・評価器 judge 方式）へ移行しており、6×10 / 41/60 の枠組みは受け入れ判断時点の物差しである。
