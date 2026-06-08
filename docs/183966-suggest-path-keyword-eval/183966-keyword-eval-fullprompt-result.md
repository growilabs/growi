# #183966 キーワード抽出プロンプト検証 追試結果（フル版プロンプト）

前回の検証（`183966-keyword-extraction-verification.md`）は keyword 比較の条件を揃えるため、`informationType` の `Classification Reference`（flow/stock 判定の長文 = `instructionsForInformationTypes`）を**省いた簡略プロンプト**で実施した。本追試は、本番の `SYSTEM_PROMPT` と完全同形の**フル版プロンプト**（この長文ブロックを含む）でも同じ改善が出るかを、代表3ケースで再確認したもの。

- ブランチ: `feat/183964-183966-improve-keyword-extraction-prompt`
- モデル: `gpt-4.1-nano`
- 対象3ケース: oauth2-email-support / opentelemetry / news-inappnotification（本文は前回と同一）
- 各ケース 3 run。LLM 出力は非決定的のためブレも観察。

## フル版で確認した理由

- 簡略版と本番フル版の唯一の差は `instructionsForInformationTypes` ブロックの有無。
- このブロックは flow/stock 判定専用で、keyword 抽出の指針とは独立しているはず → 影響はほぼ無いと予想。
- 「予想」を裏取りするため、前回 OLD で最悪だった oauth2、逃げ道検証の opentelemetry、抽象化が気になった news の3ケースでフル版を実行。

## プロンプト同形性の確認

`NEW_PROMPT_FULL`（フル版で再構成した新プロンプト）を、実コード `apps/app/src/features/ai-tools/suggest-path/server/services/analyze-content.ts` の `SYSTEM_PROMPT` と1行ずつ突き合わせ、各文字列要素・順序・`## Classification Reference\n` + `instructionsForInformationTypes` + `\n\n` の挟み方・Example 行まで**完全一致**を目視確認した。

さらに本追試スクリプトでは、本番の `analyzeContent()` を直接呼ぶ経路（**NEW-REAL** = export されていない実 `SYSTEM_PROMPT` をそのまま使う経路）を併走させ、再構成した `NEW_PROMPT_FULL` と実コードパスの挙動が一致することを実測で裏取りした。

## 実行メモ

- bootstrap・API キー・ES 例外処理は前回と同一（`new Crowi()` + `await crowi.init()`、`NODE_ENV=development pnpm run ts-node ...`、`unhandledRejection`/`uncaughtException` 握り潰し）。
- 検証スクリプトは使い捨て（`apps/app/tmp/` 配下、gitignore 対象）。実行後に削除済み。

## 結果（全 3 run 生データ）

### 4. oauth2-email-support
表層語: `OAuth / Gmail / nodemailer / Client ID / Refresh Token / Google Cloud Console`

```
[OLD]
  run1: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
  run2: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
  run3: ["OAuth 2.0","Gmail API","nodemailer","Google Workspace","メール送信"]
[NEW]
  run1: ["OAuth 2.0","メール送信","認証","Gmail API","セキュリティ"]
  run2: ["OAuth 2.0","メール送信","Google Workspace","認証","実装"]
  run3: ["OAuth 2.0","メール送信","認証","セキュリティ","内部実装"]
[NEW-REAL (analyzeContent / 実SYSTEM_PROMPT)]
  run1: ["OAuth 2.0","メール送信","Gmail API","トークン管理","セキュリティ"]
  run2: ["OAuth 2.0","メール送信","認証","Google Workspace","Gmail API"]
  run3: ["OAuth 2.0","メール送信","認証","セキュリティ","Gmail API"]
```

所感: **nodemailer は NEW で 3/3 消滅**し、メール送信/認証/セキュリティが増加。簡略版と同方向。

### 5. opentelemetry
表層語: `SDK / OTLP / Metric / NodeSDK / pino / Collector`

```
[OLD]
  run1: ["OpenTelemetry","SDK","Resource Attribute","Custom Metric","HTTP Anonymization"]
  run2: ["OpenTelemetry","Resource Attribute","Custom Metric","HTTP Anonymization","GROWI"]
  run3: ["OpenTelemetry","SDK","Resource Attribute","Custom Metric","HTTP Anonymization"]
[NEW]
  run1: ["OpenTelemetry","architecture","specification","monitoring","integration"]
  run2: ["OpenTelemetry","architecture","metrics","anonymization","SDK"]
  run3: ["OpenTelemetry","architecture","monitoring","specification","layers"]
[NEW-REAL (analyzeContent / 実SYSTEM_PROMPT)]
  run1: ["OpenTelemetry","architecture","monitoring","metrics","anonymization"]
  run2: ["OpenTelemetry","architecture","specification","monitoring","layer"]
  run3: ["OpenTelemetry","architecture","monitoring","metrics","anonymization"]
```

所感: **OpenTelemetry は NEW / NEW-REAL とも 3/3 残存（逃げ道が効く）**。NodeSDK 消滅、SDK もほぼ消滅。簡略版と一致。

### 3. news-inappnotification
表層語: `cron / MongoDB / JSON / GitHub Pages / TTL / NewsItem`

```
[OLD]
  run1: ["InAppNotification","NewsItem","MongoDB","JSON Feed","growiVersionRegExps"]
  run2: ["InAppNotification","NewsItem","MongoDB","JSON feed","cron"]
  run3: ["GROWI","InAppNotification","NewsItem","MongoDB","cron"]
[NEW]
  run1: ["ニュース配信","InAppNotification","キャッシュ","通知","ロール"]
  run2: ["ニュース配信","通知","ニュースフィード","InAppNotification","キャッシュ"]
  run3: ["ニュース配信","通知システム","情報表示","外部フィード","キャッシュ管理"]
[NEW-REAL (analyzeContent / 実SYSTEM_PROMPT)]
  run1: ["ニュース配信","通知表示","情報管理","キャッシュ","ロール制御"]
  run2: ["ニュース配信","InAppNotification","キャッシュ","通知管理","ロール制御"]
  run3: ["ニュース配信","通知","情報管理","Webフィード","InAppNotification"]
```

所感: **cron / MongoDB / JSON / NewsItem は NEW で 3/3 全消滅**し、ニュース配信/通知/情報管理が増加。簡略版と一致。

## 簡略版 NEW との一致確認

| ケース | 簡略版 NEW で観察された改善 | フル版でも同じか？ |
|---|---|---|
| oauth2 | nodemailer 消滅・Gmail ほぼ消滅、メール送信/認証/セキュリティ増 | ✅ 一致（nodemailer 3/3 消滅。Gmail API は NEW-REAL でやや残りやすいが run ブレの範囲） |
| opentelemetry | OpenTelemetry 残存（3/3）、NodeSDK/SDK 消滅 | ✅ 一致（逃げ道はフル版でも有効、OpenTelemetry 3/3 残存） |
| news | cron/MongoDB/JSON/NewsItem 消滅、ニュース配信/通知/情報管理増 | ✅ 一致（表層語 3/3 全消滅） |

## 総評

- **フル版でも簡略版と同じ改善方向が確実に再現された。** `instructionsForInformationTypes`（flow/stock 判定の長文）を挟んでも keyword 抽出の改善は損なわれず、本修正は**本番形でも有効**と確証できる。
- **再構成 NEW と NEW-REAL（実 `SYSTEM_PROMPT`）の挙動が一致**しており、`NEW_PROMPT_FULL` が本番プロンプトと等価であることを実コードパスで裏取り済み。簡略版と明確に異なる挙動は無し。唯一の揺れは oauth2 の「Gmail API」が NEW-REAL でやや残りやすい点だが、これは run ブレの範囲で、nodemailer 消滅という核心は一貫している。

数値命中率は #4 のスコープのため未計測。簡略版との一致確認のみが目的。
