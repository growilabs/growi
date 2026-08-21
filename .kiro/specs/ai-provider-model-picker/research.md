# Research: ai-provider-model-picker

本ファイルは、design.md の決定に至った調査・比較検討のうち、**コードを読むだけでは再現できない部分**（検討して却下した別案とその理由、外部データソースの調査結果）を残す。実装済みのため、現状調査（Gap Analysis）やタスク分解の過程そのものは削除し、最終的な決定とその根拠だけを記載する。

---

## モデル取得元・取得方法の比較検討と決定

**決定: 取得元 = models.dev / 取得方法 = 取り込みステップでの vendoring（コミット済み静的アセットを実行時 read）。**

### 要件（再掲）
admin モデルピッカーは、(1) 実行時に外部通信しない（Req 2）、(2) プロバイダ単位、(3) chat/ツール対応モデルへ絞れるだけのメタデータ、を満たすモデルカタログ源を要する。GROWI エージェントは**ツール呼び出し必須**のため `tool_call` 情報が要件に効く。

### 選択肢の比較

| 案 | 取得元 / 方法 | 実行時通信 | フィルタ | 判定 | 却下/採択理由 |
|---|---|---|---|---|---|
| Y | `@mastra/core` `getProviderConfig`（同梱レジストリ） | なし | heuristic 止まり | 却下 | データが削ぎ落とし（id＋attachment のみ、`tool_call`/modality なし）。値 import で externalization 懸念。誤除外リスクを消せない |
| X1 | models.dev の npm ラッパーをランタイム依存 | なし | 権威的 | 却下 | 候補は**全て単独メンテ・低採用・新規**。複数が既に**サイレント陳腐化**（下記調査参照） |
| — | models.dev / OpenRouter を runtime fetch | **あり** | 権威的 | 却下 | **Req 2 違反**。OpenRouter は ToS でカタログ複製を禁止（法的リスク） |
| — | config-manager にカタログ主保管 | 方法次第 | — | 却下 | config は運用者設定用で参照データ向きでない。「運用者の選択（許可リスト）」と「上流の事実（カタログ）」を混同する（詳細は下記） |
| **採択** | **models.dev をリリース前段で vendoring → コミット成果物** | **なし** | **権威的** | **採択** | 上流の tool_call/modality を使い authoritative フィルタが可能。第三者ランタイム依存なし。鮮度は GROWI 管理・可視 |

### models.dev ラッパー調査（npm レジストリ / GitHub API / 型定義で一次検証）

models.dev（anomalyco, MIT）は公式 npm データパッケージを出していない（JSON `api.json` ＋ TOML のみ）。上流自体は活発だが、これを再スナップショットする npm ラッパーは調査時点で**「よく採用された・複数メンテの・オフライン対応」なものが存在しなかった**: 候補（ai-model-prices, ai-sdk-json-schema, pickai, models-dev-db, pi-frontier, @swoosh-dev/*, LiteLLM 同梱 JSON 等）はいずれも単独メンテナー・低採用・新規で、複数は npm 公開が停止するなど既にサイレント陳腐化していた。`tool_call`/modality を持たない候補（@pydantic/genai-prices, @plurnk/plurnk-models, tokenlens 系）は要件を満たさず除外。この結果から、ラッパーをランタイム依存にはしない（本体 devDependency としての一時利用のみ許容し、コミットするのは GROWI がレビューした成果物のみ）という方針を採った。

### GROWI 内の前例（vendoring の定石）
- **marpit**: `packages/presentation/scripts/extract-marpit-css.ts` → コミット `src/client/consts/marpit-base-css.vendor-styles.prebuilt.ts`（ヘッダ「@marp-team/* への*ランタイム依存なし*で使うため生成」）。
- **emoji**: `packages/emoji-mart-data`（`build: node bin/extract.ts`）→ 静的アセット化、実行時は vendored data を read。
- 他: prisma 生成物、orval（OpenAPI→client）、vendor CSS プリコンパイル。
- **本カタログとの違い**: marpit/emoji は**ローカル devDep から決定的に抽出**するため build 時再生成が安全。本カタログの源は**ネットワーク（models.dev）**であるため、取り込みは毎ビルドではなく**リリース前段の独立ステップ**で行い、ビルドはコミット済みを消費する（design.md「データ源選定の根拠」参照）。

## カタログの保持先: JSON ファイル vs config

**問い**: モデルカタログを「コミット済み JSON ファイル」で持つのと「config-manager で管理」するのはどちらが良いか。

### 判断の起点: 「設定」か「参照データ」か
- **設定（config 向き）**: 運用者がインストールごとに決める値（`ai:provider` / `ai:apiKey` / 許可リスト `ai:allowedModels`）。
- **参照データ（アセット向き）**: 上流（models.dev）由来で全インストールで同一・運用者が著すものではない事実。

モデルカタログ（どのモデルが存在し chat+tool 対応か）は**参照データ**の性格であり、運用者の「このモデルを許可する」選択は既に `ai:allowedModels`（config）が担う。カタログと許可リストは別レイヤ。

### config が勝つ唯一の軸とその現実
config の強みは「運用者が再デプロイなしで install ごとにカタログを差し替えられる」点（エアギャップ/独自エンドポイント向け）。しかし GROWI では「どのモデルを許可するか」の per-install キュレーションは `ai:allowedModels`（config）が既に担当し、Azure/独自/私設モデル ID は azure＝自由入力で対応済みのため、カタログ本体を config に移す動機は薄い。

### 結論
カタログ本体は JSON ファイル（コミット成果物）が適合する: 参照データ・全 install 一様・上流から再生成・PR で可視・GROWI 既存流儀（emoji/marpit）に一致・DB/シングルトンを汚さない。config は「運用者の選択」= `ai:allowedModels` に使い続ける（不変）。config の唯一の勝ち筋（per-install 動的上書き）が要件化した場合のみ、主保管を JSON に残したまま任意の override 設定キーを追加する hybrid を検討する（今回はスコープ外）。

## 追補: カタログに公式表示名 `name` を追加（2026-07-10）

UI でプロバイダー名・モデル名を正式名称で表示する改善に伴い、カタログ／DTO の shape を `provider → string[]`（bare id）から `provider → {id,name}[]` へ変更した。`name` は models.dev の `name` を生成時に `id` と**同一スナップショットから同時に取得**するため相互に drift しない（欠落時は `id` をフォールバック）。

**表示名の解決方針（design 決定）**: 許可リスト（config）は id のみを保持し、`name`（表示名）は保存しない。読み取り時に共有ヘルパー `buildModelDisplayNameResolver` が (provider, modelId) を実効カタログと join して解決する（id フォールバック）。保存しない理由は、カタログ側の表示名が将来変わった場合に許可リストのリライトが不要になるようにするため。この解決方針・DTO の最終形は design.md（Data Models）に反映済み。
