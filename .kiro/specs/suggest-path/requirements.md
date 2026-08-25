# Requirements Document

## Introduction

suggest-path は、AI クライアント(Claude 経由の MCP など)が GROWI にページを保存する際、内容に基づいて保存先ディレクトリパスを提案する API である。

現在のエンジンは Mastra Agent による agentic search(検索結果を元文書と照らし合わせながら検索語・条件を変えて複数回探索する挙動)で、Redmine #184610 に対応して旧ワンショット構成(キーワード抽出 → Elasticsearch 検索 1 回 → LLM 候補評価、OpenAI 直接呼び出し)から換装された。旧ワンショットエンジンは `features/openai` 全廃(2026-07-17)に伴い完全に削除されている。

エンジン選択は可用性ベース(Mastra AI 設定済み → agentic ／ 未設定 → 501)で、AI なし・Elasticsearch のみで動くフォールバックエンジンは将来計画である(Requirement 6 の Note、design.md「将来のロードマップ」参照)。

## Out of Scope

- ページの作成・保存自体(既存 `POST /_api/v3/page` が担う。本機能は「どこに」保存するかの提案のみ)
- ページタイトルの決定(AI クライアントとユーザーの対話に委ねる)
- カテゴリ提案(旧ワンショットの `category` type 提案。agentic エンジンでは生成しない設計決定。理由は research.md 参照)
- HTC によるリランク、セマンティック検索の導入(別ストーリー)
- MCP クライアント側の挙動変更、チャット機能・`growiAgent` の改修
- AI なし・Elasticsearch のみのフォールバックエンジン(将来計画。Requirement 6 の Note)

## Requirements

### Requirement 1: 複数回検索による agentic search

#### Acceptance Criteria
1. When 保存対象の文書本文を受け取ったとき, the agentic search エンジン shall 文書内容に基づいて wiki 内を検索し、検索結果を元文書と照らして保存先候補としての妥当性を判断すること。
2. If 検索結果が保存先候補として不十分または不適切と判断されたとき, then the agentic search エンジン shall 検索語・検索条件を変えて再検索すること。
3. When 候補の妥当性判断に候補ページの内容確認が必要なとき, the agentic search エンジン shall 候補ページの本文を参照して判断に反映できること。
4. When 探索が完了したとき, the agentic search エンジン shall 収集した候補に基づいて保存先パスの提案を生成すること。
5. The agentic search エンジン shall 検索・本文参照・子ページ一覧参照の対象をリクエストユーザーの閲覧権限の範囲内に限定すること。

候補親の兄弟構成を確認する子ページ一覧参照(listChildren tool)は第三の探索手段であり、AC 5 の権限限定はこの手段にも適用される(`pageListingService` の権限フィルタに委譲)。

### Requirement 2: フロー/ストック判定による探索誘導

#### Acceptance Criteria
1. When 保存対象の文書本文を受け取ったとき, the agentic search エンジン shall 文書がフロー情報(時限的・時系列的な情報)かストック情報(蓄積・参照される情報)かを判定すること。
2. While 探索を実行している間, the agentic search エンジン shall フロー/ストック判定の結果を検索の誘導(候補の妥当性判断および再検索の方向付け)に反映すること。
3. The suggest-path API shall 判定した informationType を該当する提案のレスポンスに含めること。
4. The agentic search エンジン shall フロー/ストック判定の結果および探索過程(実行した検索、再検索の判断)を、検証およびデバッグ時に確認可能な形で記録すること。

### Requirement 3: 探索の上限による制御

#### Acceptance Criteria
1. The agentic search エンジン shall 1 リクエストあたりの検索回数に上限を設けること。
2. When 検索回数が上限に達したとき, the agentic search エンジン shall その時点までに収集した情報に基づいて提案を生成して返すこと。
3. Where 運用者が検索回数上限を設定で変更したとき, the agentic search エンジン shall 変更後の上限値に従って動作すること。
4. Where 運用者が agentic search エンジンの使用する AI モデルを設定で変更したとき, the agentic search エンジン shall 変更後のモデルで動作すること。
5. Where 運用者が agentic search エンジンの推論強度を設定で変更したとき, the agentic search エンジン shall 変更後の推論強度で動作すること。
6. When 推論強度が設定で指定されていないとき, the agentic search エンジン shall 推論強度を変更しない既定の動作で提案を生成すること。

検索回数上限(AC 1〜3)とは独立に、listChildren tool の呼び出し上限(`aiTools:suggestPathAgenticChildListingLimit`、既定 5)が第二の budget として存在する。AC 4(モデル)は suggest-path 専用キーではなくアプリ全体設定 `ai:provider` / `ai:model` で決まり、AC 5(推論強度)は provider 汎用の `ai:providerOptions:suggestPathAgent`(provider 名前空間付き Record を catalog 宣言 options に deep merge)で決まる。いずれも AI 設定保存時の cache clear により再起動なしで反映される。

*残存ギャップ*: 推論強度の値の妥当性(対応モデル・許容値)はプロバイダ側の実行時エラーに委ねており、事前検証はしていない。未対応の組み合わせはエンジン失敗として memo フォールバックが受け止める(Requirement 4)。

### Requirement 4: API 契約の後方互換

#### Acceptance Criteria
1. The suggest-path API shall 既存のエンドポイント、リクエスト形式(`body` フィールド)、および認証・認可要件を維持すること。
2. The suggest-path API shall レスポンスの各提案に `type` / `path` / `label` / `description` / `grant` を含め、`path` は末尾スラッシュ付きの親ディレクトリパスであること。
3. The suggest-path API shall エンジンの選択にかかわらず memo 提案を常にレスポンスに含めること。
4. The suggest-path API shall 各提案の `grant` に親ページの grant 値(子ページに設定可能な権限の上限制約)を含めること。
5. If agentic search エンジンの実行が失敗した、または規定の時間内に完了しなかった(タイムアウトした)とき, then the suggest-path API shall memo 提案のみのレスポンスを返すこと(5xx にしない)。

### Requirement 5: パス提案 API のレスポンス契約

**Summary**: `POST /_api/v3/ai-tools/suggest-path` は `{ body: string }` を受け取り、`{ suggestions: PathSuggestion[] }` を返す。各提案は `type`(`memo` | `search`)・`path`(末尾スラッシュ付き親ディレクトリパス)・`label`・`description`・`grant`(親ページの grant 値。子ページに設定可能な権限の上限制約)を含み、`type: 'search'` の提案はさらに `informationType`(`flow` | `stock`)を含む。`memo` 提案は常にレスポンス先頭に含まれる保証されたフォールバックで、パスは `/user/{username}/memo/`(ユーザーページ有効時)または `/memo/{username}/`、grant は固定 4。エンドポイントは `/_api/v3/page/` とは独立した `ai-tools` 名前空間に置かれ、個別にアクセス制御できる。

### Requirement 6: エンジンの可用性フォールバック

**Summary**: AI 機能が有効かつ Mastra AI 基盤が設定済み(利用可能な許可モデルが 1 つ以上)のときのみ agentic search エンジンで提案を生成する。それ以外は 501(AI not ready)を `aiReadyGuard` が返す。判定はリクエスト毎に行われ、設定変化を再起動なしに反映する。

> **Note(将来計画)**: 「Mastra AI 未設定だが全文検索は利用可能」な環境向けに、AI を使わず Elasticsearch だけで提案する oneshot フォールバックエンジンを将来整備する計画がある(design.md「将来のロードマップ」・tasks.md F.1〜F.4)。実現すれば、当該環境の応答は 501 から ES-only 提案へ変わる。

### Requirement 7: 認証・認可

**Summary**: 有効な API トークンまたはログインセッションを要求する。欠落時は認証エラーを返す。認証済みユーザーの identity をユーザー固有の提案に使う。

### Requirement 8: 入力検証とエラーハンドリング

**Summary**: `body` の欠落・空・上限超過(100,000 文字)はバリデーションエラーを返す。内部エラーはシステム詳細を露出しない応答を返す。

### Requirement 9: Client LLM Independence

**Summary**: レスポンスは構造化データ(`informationType`・`type`・`grant`)と自然言語(`description`)の両方を含み、推論能力に関わらずどの LLM クライアントでも利用できるようにする。

**Design Rationale**: MCP クライアントは様々な LLM モデルで動作する。重い推論をサーバ側(GROWI AI)に集中させることで、非力なクライアントでも品質が劣化しない。

### Requirement 10: 効果測定(A/B 検証)

**Summary**: 新旧エンジンを同一条件(#183968 評価環境、6 usecases × 10 runs)で測定し比較する。測定は命中率に加えレスポンス時間・検索回数・トークン消費を記録する。

> **測定結果(実施済み)**: ベースライン(旧ワンショット)41/60 に対し、agentic エンジンは初回 4/60(instructions の「PARENT DIRECTORY」という表現がリーフページ配下への提案を妨げていたことが主因)。2 ラウンドの instructions チューニング後 52/60(ベースライン比 +11、oneshot 再測定 40/60 比 +12)まで改善し、受け入れ判断済み。運用面(p50 8.5 秒・平均 9.8k tokens/req・budget 枯渇 / timeout / error ゼロ)も確認済み。詳細は research.md 参照。
