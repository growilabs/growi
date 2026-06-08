# #183966 キーワード抽出プロンプト検証結果

suggest-path 機能の「キーワード抽出」プロンプト（`apps/app/src/features/ai-tools/suggest-path/server/services/analyze-content.ts` の `SYSTEM_PROMPT`）を、表層語（ライブラリ名・ツール名・API 名などの実装手段の固有名）に引っ張られにくくする修正（Redmine #183966）の検証記録。

- ブランチ: `feat/183964-183966-improve-keyword-extraction-prompt`
- モデル: `gpt-4.1-nano`（`callLlmForJson` 内で固定）
- 各ユースケース × OLD/NEW × **3 run**（LLM 出力は非決定的なためブレも観察）
- 目的: 表層語バイアスが軽減される方向に動いているかの質的確認。命中率の数値計測は後続 #183967/#4 のスコープのため対象外。

## プロンプト差分

- **旧プロンプト**: "Prioritize proper nouns and technical terms over generic or common words."
- **新プロンプト**: "Prioritize words that express the subject and purpose of the content … over terms that merely name the specific means of implementation (such as libraries, tools, APIs, protocols, or product names) … Choose such an implementation-specific term as a keyword only when that term is itself the subject of the content."

## 実行メモ（再現手順）

- `analyzeContent` → `callLlmForJson` は `configManager`（DB 設定）と OpenAI クライアントに依存するため、`new Crowi()` + `await crowi.init()` で bootstrap してから呼ぶ。
- OpenAI API キーは `apps/app/.env.development.local`（`OPENAI_API_KEY` / `AI_ENABLED=true`）にある。このファイルは dotenv-flow が **`NODE_ENV=development` のときだけ**ロードするため、ts-node 実行時は `NODE_ENV=development pnpm run ts-node ...` で起動する（未設定だとキーが読まれず "Environment variables required to use OpenAI's API are not set" になる）。
- `crowi.init()` は Elasticsearch へ接続するバックグラウンドサービスを起動する。ES は LLM 呼び出しに不要なため、`unhandledRejection` / `uncaughtException` を握り潰してプロセス継続させた。
- 検証スクリプトは使い捨て（`apps/app/tmp/` 配下、gitignore 対象）。実行後に削除済み。

## 結果一覧

| ユースケース | OLD keywords（3run 代表） | NEW keywords（3run 代表） | 表層語が減ったか | 主題語が増えたか |
|---|---|---|---|---|
| 1. auto-scroll | GROWI / auto-scroll / **MutationObserver** / **Mermaid Viewer** / **data-growi-…** | 自動スクロール / ハッシュ移動 / レンダリング監視 / レイアウトシフト | ✅ 大幅減（Mermaid / MutationObserver 消滅） | ✅ 自動スクロール・ハッシュ・レンダリング補正が前面に |
| 2. collaborative-editor | GROWI / **Yjs** / **CRDT** / **MongoDB** / **Socket.IO** / **WebSocket** | リアルタイム協調編集 / 協調編集 / Yjs / WebSocket / 永続化 | △ 一部減（CRDT / Socket.IO 消、Yjs / WebSocket は残存） | ✅ 「リアルタイム協調編集」が必ず先頭に |
| 3. news-inappnotification | GROWI / InAppNotification / **NewsItem** / **MongoDB** / **cron** / **JSON** | ニュース配信 / 通知管理 / 情報管理 / キャッシュ / InAppNotification | ✅ 大幅減（cron / MongoDB / JSON / NewsItem 消滅） | ✅ ニュース配信・通知・情報管理が前面に |
| 4. oauth2-email-support | OAuth 2.0 / **Gmail API** / **nodemailer** / Google Workspace / メール送信 | OAuth 2.0 / メール送信 / 認証 / セキュリティ（Gmail は 3run 中 1 回のみ） | ✅ 減（nodemailer 消滅、Gmail ほぼ消滅） | ✅ メール送信・認証・セキュリティが増加 |
| 5. opentelemetry | OpenTelemetry / **NodeSDK** / **SDK** / Resource Attribute / Custom Metric | **OpenTelemetry** / monitoring / observability / architecture / metrics | ✅ 減（NodeSDK / SDK 消滅） | ✅ 監視 / 可観測性。**OpenTelemetry は残存** |
| 6. presentation | GROWI / **ReactMarkdown** / **marp-core** / **frontmatter** / **MarpSlides** | プレゼンテーション / スライド表示 / モジュール分離 / 実装仕様（Marp は残存） | ✅ 減（ReactMarkdown / marp-core / frontmatter 消滅） | ✅ プレゼン・スライド表示が前面に |

太字は「新プロンプトで減ってほしい表層語」。

### 生データ（全 3 run）

```
======== 1. auto-scroll ========
  [OLD]
    run1: ["GROWI","auto-scroll","hash","Renderinga","MutationObserver"]
    run2: ["GROWI","auto-scroll","Hash","MutationObserver","RenderStatus"]
    run3: ["GROWI","useHashAutoScroll","Mermaid Viewer","MutationObserver","data-growi-is-content-rendering"]
  [NEW]
    run1: ["自動スクロール","ハッシュリンク","レンダリング監視","レイアウトシフト","ページビュー"]
    run2: ["auto-scroll","hash","rendering","layout shift","scroll"]
    run3: ["auto-scroll","hash navigation","rendering correction","page rendering","layout shift"]

======== 2. collaborative-editor ========
  [OLD]
    run1: ["GROWI","Yjs","WebSocket","MongoDB","Socket.IO"]
    run2: ["GROWI","Yjs","collaborative-editor","MongoDB","Socket.IO"]
    run3: ["GROWI","Yjs","CRDT","Socket.IO","MongoDB"]
  [NEW]
    run1: ["リアルタイム協調編集","Yjs","WebSocket","MongoDB","認証"]
    run2: ["リアルタイム編集","協調編集","Yjs","WebSocket","永続化"]
    run3: ["リアルタイム編集","Yjs","WebSocket","協調編集","MongoDB"]

======== 3. news-inappnotification ========
  [OLD]
    run1: ["GROWI","InAppNotification","NewsItem","MongoDB","cron"]
    run2: ["GROWI","InAppNotification","NewsFeed","MongoDB","JSON"]
    run3: ["GROWI","InAppNotification","NewsItem","MongoDB","cron"]
  [NEW]
    run1: ["ニュース配信","通知","情報管理","表示","キャッシュ"]
    run2: ["ニュース配信","InAppNotification","キャッシュ","通知管理","情報表示"]
    run3: ["ニュース配信","InAppNotification","通知表示","情報管理","キャッシュ"]

======== 4. oauth2-email-support ========
  [OLD]
    run1: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
    run2: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
    run3: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
  [NEW]
    run1: ["OAuth 2.0","メール送信","認証","セキュリティ","Google Workspace"]
    run2: ["OAuth 2.0","メール送信","認証","セキュリティ","実装"]
    run3: ["OAuth 2.0","メール送信","Gmail API","認証","セキュリティ"]

======== 5. opentelemetry ========
  [OLD]
    run1: ["OpenTelemetry","NodeSDK","Resource Attribute","Custom Metric","HTTP Anonymization"]
    run2: ["OpenTelemetry","SDK","Resource Attribute","Custom Metric","HTTP Anonymization"]
    run3: ["OpenTelemetry","NodeSDK","Resource Attribute","Custom Metric","HTTP Anonymization"]
  [NEW]
    run1: ["OpenTelemetry","architecture","metrics","anonymization","monitoring"]
    run2: ["OpenTelemetry","monitoring","architecture","metrics","anonymization"]
    run3: ["OpenTelemetry","architecture","monitoring","observability","specification"]

======== 6. presentation ========
  [OLD]
    run1: ["GROWI","ReactMarkdown","Marp","marp-core","marp: true"]
    run2: ["GROWI","Marp","ReactMarkdown","GrowiSlides","MarpSlides"]
    run3: ["GROWI","ReactMarkdown","Marp","marp-core","frontmatter"]
  [NEW]
    run1: ["プレゼンテーション","スライド表示","内部実装","モジュール分離","Marp"]
    run2: ["プレゼンテーション","スライド表示","実装仕様","Marp","モジュール分離"]
    run3: ["presentation","slide rendering","implementation","module separation","CSS extraction"]
```

## 総評

- **表層語バイアスは明確に軽減方向。** 全 6 ケースで実装手段の固有名（MutationObserver, cron, MongoDB, JSON, nodemailer, NodeSDK, ReactMarkdown, marp-core 等）が NEW で減り、機能・主題語（自動スクロール / 協調編集 / ニュース配信 / メール送信 / 可観測性 / スライド表示）が増えた。#183966 の完了目安「表層語バイアスが軽減される方向に動いていること」を満たしている。
- **opentelemetry の逃げ道は機能。** 主題そのものである OpenTelemetry は NEW でも 3/3 残存し、周辺の SDK / NodeSDK 等の表層語だけが落ちた。"only when that term is itself the subject" が意図どおり効いている。
- **想定内の副作用**:
  - NEW は主題語が日本語化＋やや抽象寄り（「情報管理」「実装仕様」等）になりがち。検索ヒット率の実測は #183967/#4 で確認が必要。
  - collaborative-editor では Yjs / WebSocket が主題級と判定され残るが、CRDT / Socket.IO は落ちており方向性は正しい。
  - 形式崩れ（JSON パース失敗・件数違反）は 36 run で 0 件。

数値命中率は #4 のスコープのため未計測。本検証では keywords の質的変化のみを評価した。
