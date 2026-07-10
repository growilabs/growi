# スモークテスト記録 — mastra-multi-provider (タスク 8.2)

対象要件: 4.3 / 5.2 / 5.3 / 6.1 / 6.2 / 6.4

本書は 3 つの主要シナリオのスモーク手順と結果を記録する。各シナリオは **(A) 自動検証済み**(サーバ側ロジック・config 解決・ブート)と **(B) 人手による手動確認が必要**(ブラウザ UI 操作 + 実 API キーによるライブチャット)に分かれる。

自動検証は §2.2 の env 記述例([env-configuration-examples.md](./env-configuration-examples.md))の 2 プロバイダブロックをそのまま使用する(記述例の実例検証を兼ねる)。

---

## シナリオ 1: 2 プロバイダ構成 + プロバイダ横断のモデル切替 + 再起動なし反映

**env(§2.2 の 8.2 用ブロックそのまま。API キーはダミー):**
```bash
AI_ENABLED=true
AI_PROVIDERS='{"openai":{"enabled":true},"anthropic":{"enabled":true}}'
AI_PROVIDER_API_KEYS='{"openai":"sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx","anthropic":"sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"}'
AI_ALLOWED_MODELS='[{"provider":"openai","modelId":"gpt-5","isDefault":true},{"provider":"openai","modelId":"gpt-5-mini"},{"provider":"anthropic","modelId":"claude-sonnet-4-5"}]'
```

**(A) 自動検証済み:**
- 上記 3 つの JSON env var はパース可能(§2.2 の 21 例を JSON.parse で検証済み)。
- `getAvailableModels()` が 3 モデル(openai×2 + anthropic×1)をプロバイダ横断で返す — `provider-availability.spec` のマトリクス + 導出テスト(有効プロバイダ ≥1・許可モデル ⊆ 全許可)で担保。
- `GET /mastra/models` が provider 情報付き `ChatModelEntry[]` と `selectedModelKey`(保存キー ∈ 有効集合 ? 保存キー : 実効既定)を返す — `get-models.spec`(フィルタ + 初期選択フォールバック)で担保。
- `POST /mastra/message` が body の `modelKey` を 1 回だけ実効キー解決し、requestContext と providerOptions 双方へ同一キーを渡す(集合外は実効既定へ丸め) — `post-message*.spec` で担保(4.3/4.6)。
- チャット送信・再生成の body にライブ modelKey が毎回注入される — `chat-sidebar-helpers.spec`(regenerate 含む)で担保(4.7)。
- 管理画面保存後、`clearResolvedMastraModelCache()` + `clearAvailabilityLogDedup()` が呼ばれ再起動なしで反映 — `put-ai-settings.spec`(キャッシュ/dedup リセット)で担保。s2s `configUpdated` 伝搬は既存機構。
- サーバブート(§下記 launch-dev:ci)で新 config キーがロードされ AI 機能が構成済みと判定される。

**(B) 人手による手動確認が必要(実 API キー + ブラウザ):**
1. 実 OpenAI / Anthropic の API キーを `AI_PROVIDER_API_KEYS` に設定して dev 起動。
2. 管理画面 `/admin/ai` を開き、4 プロバイダタブが常時表示・openai/anthropic が構成済みドット表示・保存できることを確認。
3. チャットサイドバーのモデルセレクタが openai / anthropic のグループ見出し付きで両プロバイダのモデルを表示し、トリガが「provider · modelId」であることを確認。
4. openai のモデルで送信 → 応答生成、続けて anthropic のモデルへ切替えて送信 → そのプロバイダで生成されることを確認(プロバイダ横断切替 = 4.3/4.7)。
5. 管理画面で許可モデルを 1 つ追加保存 → **再起動なし**でチャットのセレクタに反映されることを確認。

## シナリオ 2: 一方のプロバイダを無効化 / 不備化 → 部分縮退

**(A) 自動検証済み:**
- `anthropic` を `enabled:false` にする、または API キーを外す → `getProviderAvailability('anthropic')` が `disabled` / `missing-api-key` を返し、`getAvailableModels()` から anthropic 行が除外される(openai のみ残る) — `provider-availability.spec`。
- 有効 ∧ 構成不備のプロバイダは `(provider, reason)` の dedup 付き warn を出力(disabled は無出力=管理者意図) — `provider-availability.spec` / `warn-dedup.spec`(6.1)。
- 既定モデルが無効プロバイダ側だった場合、`getEffectiveDefaultModelKey()` が有効エントリ先頭へ決定的フォールバック — `effective-model-key.spec`(6.4)。
- 全プロバイダ不備なら `isAiConfigured()` が false = チャット無効・アプリ継続 — `is-ai-configured.spec`(6.2/6.3)。

**(B) 人手による手動確認が必要:**
1. 管理画面で anthropic を無効トグル → 保存 → チャットのセレクタから anthropic モデルが消え、openai のみ残ることを確認。
2. サーバログに anthropic の構成不備 warn(理由付き・キー値なし)が出ること、アプリ本体は継続動作することを確認。

## シナリオ 3: env-only モード(接続設定 読み取り専用・モデル編集可)

**env 追加:** `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true`

**(A) 自動検証済み:**
- env-only 時、`ai:providers` / `ai:providerApiKeys` / `app:aiEnabled` は env のみ・DB 保存不可(`ENV_ONLY_GROUPS` targetKeys)、`ai:allowedModels` は対象外で編集可 — `config-manager.spec`(5.2/5.3)。
- `PUT /ai-settings` は `providers` / `aiEnabled` を含むと 400、`allowedModels` のみは通常検証で保存 — `env-only-mode.integ.spec` / `put-ai-settings.spec`(5.2/5.3/5.4)。
- 管理画面は env-only 時に接続設定系(有効トグル・API キー・Azure 設定)を disabled 表示し、モデル編集は活性・更新ボタンも活性 — `ProviderPanel.spec` / `AiSettings.spec`(5.2/5.3)。
- クライアントの `buildUpdateRequest` は env-only 時 `allowedModels` のみを送出 — `ai-settings-form-values.spec`。

**(B) 人手による手動確認が必要:**
1. `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true` で dev 起動、管理画面を開く。
2. env-only 通知が表示され、有効トグル / API キー / Azure 接続設定が読み取り専用(disabled)であることを確認。
3. 許可モデルの追加 / 既定変更 / provider オプション編集 → 保存 → 反映される(接続設定は変えられないがモデルは編集可)ことを確認。

---

## 自動ランタイム・スモーク結果(2026-07-04 実行)

### サーバブート・スモーク(`launch-dev:ci`, シナリオ 1 の env)
上記シナリオ 1 の 2 プロバイダ env(ダミーキー)を設定し `pnpm run launch-dev:ci`(migrate → `--exit 0` のロードオンリー起動)を実行:
- **結果: BOOT_CI_EXIT=0** — サーバが first-usable-state(`[GROWI] Server URLs: APP: http://localhost:3000`)まで到達して正常終了。
- 新 config キー `ai:providers` / `ai:providerApiKeys` がブート時にロードされ、AI 機能に起因するエラー・警告は **0 件**(`malformed` / `missing-api-key` / シャドーイング / provider-availability warn いずれも無出力)。両プロバイダがキー設定済みで available と解決される。
- `growi:features:mastra:services:model-catalog-refresh-jobs: Scheduled the periodic model-catalog refresh` — mastra feature が新設定下で初期化成功。
- ログ中の唯一のエラーは `growi:service:search: Failed to initialize search delegator`(Elasticsearch、AI 機能と無関係)。
- → ブート時 config ロード経路(design「boot-time config」懸念)を実ランタイムで検証済み。

### テストスイートによる各シナリオのサーバ側ロジック検証
- `turbo run test --filter @growi/app`: **3646 passed / 4 failed**。4 failed は `features/growi-vault/__tests__/clone-e2e.integ.ts` の git サーバ infra 失敗のみで本 feature と無結合(タスク 8.1 参照)。mastra/config-manager/user-ui-settings の全テストは green。各シナリオの (A) 自動検証済み項目(上記 §1–§3)は該当 spec で担保済み。

## 手動確認が必要な残作業(ハンドオフ)

以下は**実 OpenAI / Anthropic API キー + ブラウザ操作**が必要で、自動実行不可のため人手での確認が残る:
- シナリオ 1 (B): 管理画面での 4 タブ表示・保存、チャットセレクタのプロバイダ別グループ表示・「provider · modelId」トリガ、実 LLM でのプロバイダ横断切替送信、再起動なし反映。
- シナリオ 2 (B): anthropic 無効化保存後のセレクタからの除外・warn ログ・アプリ継続。
- シナリオ 3 (B): env-only 時の接続設定 disabled 表示・モデル編集可の目視確認。

手順は各シナリオの (B) 節を参照(env は §2.2 の記述例をそのまま使用)。
