# Requirements Document

## Project Description (Input)

### 誰が / 現状 / 変えたいこと
- **誰が**: GROWI の管理者（admin の「AI Settings」画面で LLM を設定する運用者）。
- **現状**: チャットで許可するモデルを、`AllowedModelsField` で **modelId の自由入力**として1件ずつ登録している。このため (1) 存在しない/綴り間違いの modelId を登録し得る、(2) 利用可能なモデル名を管理者が別途調べる必要がある、という課題がある。
- **変えたいこと**: この自由入力を **選択式（+ 一部は自由入力併用）** にする。選択肢は **Mastra（`@mastra/core/llm` の `getProviderConfig`）が同梱する静的レジストリ**から、現在設定中のプロバイダ（`ai:provider`）にスコープして取得する。

### 外部通信に関する前提（検証済み）
- モデル一覧の取得は **外部通信を一切行わない**。`@mastra/core@1.41.0`（インストール版）で確認済み: `getProviderConfig` / `PROVIDER_REGISTRY` は dist に埋め込まれたリテラルを返す read 専用経路で、fetch も fs 読み取りも通らない。models.dev への runtime fetch を伴う Mastra の model **router** は **使わない**。
- read は prod デフォルト（`MASTRA_DEV` 未設定、GROWI は `MASTRA_*` env を未設定）で `useDynamicLoading=false` の埋め込み分岐になる。

### スコープ / 非スコープ
- **変えるのは**「admin が modelId をどう入力するか（自由入力 → 選択）」のみ。
- **不変**: 許可リスト（`ai:allowedModels`）＝認可境界、既定モデル（`isDefault`）、chat 側の `PromptInputModelSelect`、推論の native `@ai-sdk/*` 実装。
- レジストリ read は **サーバ側のみ**で実行し、client には `string[]` のみ返す（`@mastra/core` を client バンドルに引き込まない）。

### 既知の制約（設計で扱う）
- **`azure-openai` は静的レジストリに存在しない**（Azure のモデル ID は運用者定義のデプロイ名で列挙不可）。→ azure および registry 未収録プロバイダ/新モデルは **自由入力を残す**（combobox 方式）。
- レジストリは chat 以外（embeddings 等）も含み、JSON に chat/embedding フラグが無いため、chat モデルへの絞り込みは best-effort。
- レジストリ内容は `@mastra/core` のバージョンで drift する（provider→素ID配列という shape は安定）。
- 依存分類: `@mastra/core` を型のみ import から **値 import（SSR 実行）** に変えるため、build 後に `.next/node_modules` の externalization を確認する必要がある（`package-dependencies` ルール）。

### 本 spec のスコープに含める既存 spec の更新（新 spec のタスクとして整合させる）
- **`mastra-multi-model-chat`**（`tasks-approved` / `ready_for_implementation=true`）:
  - `requirements.md` の確定判断「モデル一覧取得 API は新設しない（理由: ai-sdk 列挙不可）」の**前提を修正**（ai-sdk 単体では不可でも `@mastra/core` 静的レジストリで列挙可能）。
  - `design.md` Non-Goals「ベンダー API / レジストリからのモデル一覧自動取得。許可モデルは管理者の手入力」を、**「静的レジストリの read（オフライン）は採用、runtime fetch は依然不採用」** と整合させる。
- **`multi-llm-provider`**（`tasks-generated` / `ready_for_implementation=false`）:
  - `research.md` D-2/D-3 の Mastra model router（models.dev runtime fetch）**却下判断は維持**しつつ、**「静的レジストリの read 専用経路は別物・推論は native `@ai-sdk/*` のまま」** という反証注記を追加。

### 想定する実装の当てはめ（要件確定後に design で詳細化）
- 新規 admin GET endpoint を `admin-ai-settings` ルータ配下に追加（auth: `accessTokenParser([SCOPE.READ.ADMIN.AI])` → loginRequired → adminRequired）。provider スコープのモデル一覧を返す。
- サーバ accessor（`features/mastra/server/services/ai-sdk-modules/llm-providers/config.ts`）に `getSelectableModels(provider)` を追加（`getProviderConfig` read + chat フィルタ）。
- 共有 wire DTO を `features/mastra/interfaces/` に追加し、client は `useSWRImmutable` フックで取得。
- `AllowedModelsField.tsx` の modelId 入力を combobox 化（`<input list>` + `<datalist>`）、azure は従来 input（`ProviderCommonSettings` の provider 分岐を踏襲）。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
