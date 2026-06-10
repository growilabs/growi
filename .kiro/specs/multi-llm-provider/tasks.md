# Implementation Plan

- [ ] 1. Foundation: 依存・型・設定
- [x] 1.1 LLM ベンダー SDK 依存の追加
  - `@ai-sdk/anthropic` と `@ai-sdk/google` を `^3.x`（既存 `@ai-sdk/openai ^3` と同じ provider IF）で `apps/app/package.json` の `dependencies` に追加し、ルートで `turbo run bootstrap` を実行して依存解決・lockfile を更新する
  - 観測可能: 両パッケージが `dependencies` に存在し `turbo run bootstrap` がエラーなく完了。`createAnthropic`（`@ai-sdk/anthropic`）/ `createGoogleGenerativeAI`（`@ai-sdk/google`）が型解決する
  - _Requirements: 1.1, 1.2_
  - _Boundary: package.json_

- [ ] 1.2 (P) ベンダー識別子の型と型ガード
  - サポートするベンダー集合（openai/anthropic/google）を単一の配列として定義し、そこからベンダー型を導出する
  - 任意の文字列が有効なベンダーかを判定する型ガードを提供する（env 由来の不正値検知の基盤。型は `string` を受けて絞り込む）
  - co-located unit test: 3 値を受理し、未知文字列・非文字列を拒否する
  - 観測可能: 型ガードのユニットテストが green（未知文字列・非文字列で false を返す）
  - _Requirements: 1.1, 1.4_
  - _Boundary: llm-vendor interface_

- [ ] 1.3 (P) ベンダー設定キーの定義
  - ベンダーセレクタ（`string | undefined`、env 由来、既定なし）と、Anthropic/Google の API キー（secret）・モデル（ベンダー既定値あり）の設定キーを追加する。OpenAI は既存キーを再利用する
  - 設定キー一覧の配列と定義オブジェクトの両方に登録する（キー型・値型は自動導出）。env-only グループには登録せず、既存 API キーと同じ DB+env フォールバックで統一する（管理 UI は追加しない）
  - 観測可能: 新 env（`MASTRA_LLM_VENDOR` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MASTRA_AGENT_MODEL` / `GOOGLE_API_KEY` / `GOOGLE_MASTRA_AGENT_MODEL`）が設定として解決でき、モデル未指定時はベンダー既定値が返る。API キーは secret 扱いになる
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: config-definition_

- [ ] 2. Core: プロバイダー生成とモデル解決
- [ ] 2.1 ベンダー別 native provider ファクトリ
  - 各ベンダーの native provider を**明示的な API キー注入**（env 自動検出に依存しない）で生成し、Mastra 互換の言語モデルを返す薄いアダプタを実装する（OpenAI / Anthropic / Google）
  - ベンダー→ファクトリの map を barrel で公開し、consumer がベンダー名で分岐しない構造にする
  - co-located unit test: 各ファクトリが対応する provider 生成関数を API キー付きで呼び、モデル名を適用することを確認（provider 生成関数を mock）
  - 観測可能: 3 ベンダーそれぞれで言語モデルが生成され、生成関数が `{ apiKey }` とモデル名で呼ばれることをテストで確認できる
  - _Requirements: 1.2, 2.1, 2.2_
  - _Boundary: llm-providers_
  - _Depends: 1.1, 1.2_

- [ ] 2.2 モデルリゾルバ（判別共用体）
  - セレクタ取得 → 妥当性検証 → API キー/モデル取得 → ファクトリ呼び出しを 1 関数に集約し、`ok` / `disabled`（理由: 未指定 / 不正ベンダー / API キー欠落）の判別共用体を返す。`ok` は memoize する
  - 選択ベンダーに対応するキーのみ参照する（複数キー併存でも 1 つのみ使用）。理由オブジェクトに API キー値を一切含めない
  - co-located unit test: 未指定→vendor-unset、不正→vendor-invalid、キー欠落→api-key-missing、各ベンダー正常→ok、モデル未指定→既定使用、理由に API キー非混入、memoize の各分岐
  - 観測可能: 上記分岐がすべてテストで green になり、`disabled` の理由に API キー文字列が現れない
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 2.5, 3.1, 3.2, 4.1_
  - _Boundary: resolve-mastra-model_
  - _Depends: 1.2, 1.3, 2.1_

- [ ] 3. Integration: エージェントと可用性ゲート
- [ ] 3.1 growiAgent のモデル供給を dynamic function 化
  - エージェントの `model` をリゾルバ経由の dynamic function に置換し、`disabled` 時は使用時に throw（理由 type のみ・API キー非出力）する。import 時には解決せず、構築時に例外を投げない
  - 旧 OpenAI 固定プロバイダー生成（`get-openai-provider`）を削除し、唯一の参照元を更新する。spec を dynamic model / 無効時 throw / 構築 no-throw に合わせて更新する
  - 観測可能: throw する設定でもエージェント構築（import）が例外を投げず、`ok` 設定で `model()` が言語モデルを返し、`disabled` 設定で `model()` が throw することをテストで確認できる
  - _Requirements: 3.3, 4.1, 4.3, 5.1_
  - _Boundary: growi-agent_
  - _Depends: 2.2_

- [ ] 3.2 起動時可用性ゲートとログ
  - ルート登録時に「AI 有効 かつ リゾルバ=ok」を判定する。不備時は原因（type）をログ出力（API キー非出力）し、汎用メッセージのエラー応答（503）を返す catch-all を実ルートより先に登録する。AI 無効時は既存 501 を維持し、アプリ本体・他 AI 機能の起動は継続させる
  - integration test: AI 無効→501、AI 有効＋vendor 未指定→503 かつ原因ログ（キー非出力）かつ実ルート shadow、AI 有効＋正常→実ルート有効
  - 観測可能: 上記 3 ケースのステータスコード／ログがテストで確認でき、設定不備でもサーバ起動が継続する
  - _Requirements: 2.5, 4.2, 4.3, 4.4_
  - _Boundary: routes/index_
  - _Depends: 2.2, 3.1_

- [ ] 4. Validation: 回帰と本番成果物確認
- [ ] 4.1 (P) suggest-path 非影響の回帰確認
  - mastra のベンダー選択（anthropic/google を含む）に関わらず、ページパス提案が現行の OpenAI 経路で動作することをテスト／検証で確認する
  - 観測可能: ベンダーを非 OpenAI に設定しても suggest-path が従来どおり動作する回帰テストが green になる
  - _Requirements: 5.2_
  - _Boundary: suggest-path（参照のみ・変更なし）_
  - _Depends: 3.1, 3.2_

- [ ] 4.2 (P) 依存分類の本番成果物検証
  - 本番ビルドを実行し、新規 `@ai-sdk/anthropic` / `@ai-sdk/google` が `apps/app/.next/node_modules` に externalise されることを確認し、`dependencies` 分類の妥当性を検証する（package-dependencies ルール）
  - 観測可能: ビルド後に両パッケージが `.next/node_modules` に出現し、`dependencies` 配置で本番起動時の `ERR_MODULE_NOT_FOUND` が発生しないことを確認できる
  - _Requirements: 1.1, 1.2_
  - _Boundary: build artifact（.next/node_modules）, package.json_
  - _Depends: 1.1, 2.1_
