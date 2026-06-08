# dev container 側 Claude への追試指示書: #183966 フル版プロンプトでの再確認

前回の検証（`183966-keyword-extraction-verification.md`）お疲れさま。結果は十分良かった。
一点だけ詰めたい。前回は keyword 比較の条件を揃えるため `informationType` の `Classification Reference`（flow/stock 判定の長文 = `instructionsForInformationTypes`）を**省いた簡略プロンプト**で回した。本番の `SYSTEM_PROMPT` はこの長文を含む**フル版**。

簡略版で見えた改善が**フル版でも同じように出るか**を、代表3ケースだけで追試してほしい。

## なぜ確認するか

- 簡略版と本番フル版の唯一の差は `instructionsForInformationTypes` ブロックの有無。
- このブロックは flow/stock 判定専用で、keyword 抽出の指針とは独立しているはず。だから影響はほぼ無いと予想している。
- ただ「予想」なので、フル版で念のため裏取りする。前回 OLD で最悪だった oauth2、逃げ道検証の opentelemetry、抽象化が気になった news の 3 ケースで足りる。

## 手順

前回とほぼ同じ。違いは **OLD/NEW プロンプトの両方に `instructionsForInformationTypes` を挟んだフル版**を使うこと。これで本番の `SYSTEM_PROMPT` と完全に同形になる。

スクリプト雛形（前回のものを流用、プロンプト定義だけ差し替え）:

```ts
// apps/app/tmp/183966-keyword-eval-fullprompt.ts
import Crowi from '~/server/crowi';
import { callLlmForJson } from '~/features/ai-tools/suggest-path/server/services/call-llm-for-json';
import { instructionsForInformationTypes } from '~/features/openai/server/services/assistant/instructions/commons';

// 本番と同形のフル版 OLD（master 相当）
const OLD_PROMPT_FULL = [
  'You are a content analysis assistant. Analyze the following content and return a JSON object with two fields:\n',
  '1. "keywords": An array of 1 to 5 search keywords extracted from the content. ',
  'Prioritize proper nouns and technical terms over generic or common words.\n',
  '2. "informationType": Classify the content as either "flow" or "stock".\n\n',
  '## Classification Reference\n',
  instructionsForInformationTypes,
  '\n\n',
  'Return only the JSON object, no other text.\n',
  'Example: {"keywords": ["React", "useState", "hooks"], "informationType": "stock"}',
].join('');

// 本番と同形のフル版 NEW（このブランチ相当 = 実コードの SYSTEM_PROMPT と一致）
const NEW_PROMPT_FULL = [
  'You are a content analysis assistant. Analyze the following content and return a JSON object with two fields:\n',
  '1. "keywords": An array of 1 to 5 search keywords extracted from the content. ',
  'Prioritize words that express the subject and purpose of the content — what it is fundamentally about — ',
  'over terms that merely name the specific means of implementation (such as libraries, tools, APIs, protocols, or product names) used to realize it. ',
  'Choose such an implementation-specific term as a keyword only when that term is itself the subject of the content.\n',
  '2. "informationType": Classify the content as either "flow" or "stock".\n\n',
  '## Classification Reference\n',
  instructionsForInformationTypes,
  '\n\n',
  'Return only the JSON object, no other text.\n',
  'Example: {"keywords": ["keyword1", "keyword2", "keyword3"], "informationType": "stock"}',
].join('');
```

NEW_PROMPT_FULL は `analyze-content.ts` の実 `SYSTEM_PROMPT` と一致するはず。**念のため実コードと突き合わせて、文字列が完全一致するか確認してほしい**（実コードを import して `=== SYSTEM_PROMPT` で比較するのが確実だが、`SYSTEM_PROMPT` は export されていないので目視でよい）。

bootstrap・実行・API キー周りは前回と同じ（`new Crowi()` + `await crowi.init()`、`NODE_ENV=development pnpm run ts-node ...`、ES 例外は握り潰し）。各ケース 3 run。

## 対象3ケース（本文は前回と同一・改変しない）

前回の指示書から oauth2-email-support / opentelemetry / news-inappnotification の3本の「本文」をそのまま使う。前回スクリプトの USECASES 配列から該当3件を流用すればよい。
（本文は前回検証で使ったものと完全に同一。変える必要はない）

## 見たいこと

前回（簡略版）の NEW 結果との **一致**を確認したい:

| ケース | 簡略版 NEW で観察された改善 | フル版でも同じか？ |
|---|---|---|
| oauth2 | nodemailer 消滅・Gmail ほぼ消滅、メール送信/認証/セキュリティ増 | ← 確認 |
| opentelemetry | OpenTelemetry 残存（3/3）、NodeSDK/SDK 消滅 | ← 確認（逃げ道がフル版でも効くか） |
| news | cron/MongoDB/JSON/NewsItem 消滅、ニュース配信/通知/情報管理増 | ← 確認 |

## 報告フォーマット

各ケース OLD/NEW の 3 run 生データ + 1 行所感。最後に総評1〜2行:
- **フル版でも簡略版と同じ改善方向が出たか（出た = この修正は本番形でも有効と確証できる）**
- 簡略版と明確に違う挙動があれば、その差分

数値命中率は不要（#4 のスコープ）。簡略版との一致確認だけが目的。