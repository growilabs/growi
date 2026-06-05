# [D2] 補足計測レポート: 脚切り解除・ES 素の上位20件における正解パスの順位

[D]（`D-suggestpath-remeasure-result.md`）の補足計測。dev container 内で実施。**自己完結**。

## 目的

[D] は suggestPath の **最終出力**（脚切り後の少数候補）で命中率を測った。本 [D2] は
**脚切りと択数制限を外し、ES 検索の素の上位20件**における正解パスの順位を測ることで、
「取りこぼしが **ES検索（retrieval）段階** なのか、**脚切り（culling）段階** なのか」を切り分ける。

## suggestPath の内部段階（前提）

`generateSuggestions` の流れ:

1. `analyzeContent(body)` … 改修後プロンプトでキーワード抽出（1st LLM、`4e157f9`）
2. `retrieveSearchCandidates(keywords)` … `searchKeyword(keywords.join(' '), {limit:20})` で **ES 上位20件**取得
3. **脚切り①** `SCORE_THRESHOLD = 5.0`（スコア5未満を除外）
4. **脚切り②** `evaluateCandidates`（2nd LLM）で判定し最終候補を数件に絞る
5. 出力 `[memo, …evaluate結果, category]`

[D2] が見るのは **手順2の素の上位20件**（手順3/4の前）。

## 計測方法

- `retrieve-search-candidates.ts` に**一時デバッグログ**を仕込み、`searchKeyword` 直後の
  `searchResult.data`（5.0フィルタ前の上位20件、path+score）と抽出キーワードを出力。
  **計測後に instrumentation は revert 済み**（ブランチに残さない。tracked 変更なし）。
- 各ケースの固定本文（[D] と同一）を `POST /_api/v3/ai-tools/suggest-path?access_token=…` に
  投げ、出力された上位20件で正解パスの順位を記録。**6ケース × 10回 = 60コール**。
- 一致判定: 末尾スラッシュ正規化後 `候補.startsWith(正解)`（[D] の (B) と同基準）。oauth2 は
  正解2つのうち上位の順位を採用。

### 指標（圏外の扱い）

正解が上位20件に入らない試行（圏外）を含むため、IR の標準に倣い **MRR を主指標**とする:

- **MRR（Mean Reciprocal Rank）** = 各試行 `1/順位`（圏外=0）の平均。恣意的なペナルティ順位を
  使わずに圏外を算入でき、上位ほど寄与が大きい。
- 併せて **ヒット率@20**（10回中 top20 に入った回数）と **ヒット試行のみの平均順位**（直感用）も併記。

## 結果サマリー

| ユースケース | ヒット率@20 | 平均順位(ヒットのみ) | MRR |
|---|---|---|---|
| opentelemetry | 10/10 | 1.00 | 1.000 |
| collaborative-editor | 10/10 | 2.00 | 0.500 |
| presentation | 10/10 | 5.20 | 0.217 |
| news-inappnotification | 10/10 | 1.50 | 0.750 |
| auto-scroll | 0/10 | −（全圏外） | 0.000 |
| oauth2-email-support | 10/10 | 2.50 | 0.708 |
| **全体** | **50/60** | **2.44** | **0.529** |

各試行の順位:
- opentelemetry: `1,1,1,1,1,1,1,1,1,1`
- collaborative-editor: `2,2,2,2,2,2,2,2,2,2`
- presentation: `3,6,8,3,4,5,5,5,9,4`
- news-inappnotification: `1,1,2,1,2,1,2,2,2,1`
- auto-scroll: `圏外×10`
- oauth2-email-support: `1,2,1,2,2,12,1,1,1,2`

## 重要な発見（取りこぼしの所在を切り分け）

- **ES検索 (retrieval) はおおむね優秀**: auto-scroll 以外は正解ページが **常に top20 入り**
  （opentelemetry 1位固定 / collaborative-editor 2位固定 / news 1〜2位 / oauth2 ほぼ1〜2位）。
  → これらのケースで [D] の最終出力が落ちた回があったのは、**脚切り（`SCORE_THRESHOLD=5.0` ＋
  evaluate の LLM判定）側で削られた**のが主因。retrieval は当てられている。**脚切りロジックに改善余地**。
- **presentation は ES でも 3〜9位と低め**: 抽出キーワードが**英語化**（`presentation slides
  implementation react marp` 等）し、英語ページ `/v7 docs修正内容/en/presentation` 等が上位を
  占めて日本語の正解ページが押し下げられる。日本語キーワード化が安定すれば改善余地。
- **auto-scroll だけ ES段階で完全な取りこぼし（0/10・全圏外）**: LLM が一貫して「**自動スクロール**」を
  抽出する一方、正解ページ名は「**アンカーによる**ページのScroll」。語彙ミスマッチで ES が正解を
  top20 に一度も出せない。→ **脚切りを外しても救えない＝キーワード抽出/検索段階の問題**。抽出語に
  「アンカー」等の別表現を含める改善が必要。
- oauth2 の命中は全て `/Tips/GoogleOAuth設定方法`（[D] と同傾向）。正解2つのうち SMTP「(ローカル環境&…)」
  側は top20 にほぼ出ず、GoogleOAuth 側が牽引。trial 6 のみ 12位に沈んだ（キーワードに固有語が薄い回）。

## [D] との対応

| ケース | [D] 最終出力 (B) | [D2] ES素のヒット率@20 / 平均順位 | 取りこぼしの所在 |
|---|---|---|---|
| opentelemetry | 9/10 | 10/10 / 1.00 | （ほぼ問題なし） |
| collaborative-editor | 8/10 | 10/10 / 2.00 | 脚切り側 |
| presentation | 8/10 | 10/10 / 5.20 | 脚切り側＋英語KW |
| news-inappnotification | 8/10 | 10/10 / 1.50 | 脚切り側 |
| auto-scroll | 0/10 | 0/10 / − | **retrieval段階**（KW語彙） |
| oauth2-email-support | 8/10 | 10/10 / 2.50 | 脚切り側 |

## 全 60 コール raw（順位・命中パス・スコア・抽出キーワード）

`top20` の全件は `apps/app/tmp/D2-results.json`（gitignore 対象）に保存。本表は各試行の要約
（命中パス＝正解に startsWith した最上位候補。圏外時は top1 を参考表示）。

### opentelemetry

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 72.5 | OpenTelemetry architecture specification metrics anonymization |
| 2 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry architecture monitoring specification layers |
| 3 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 92.6 | OpenTelemetry architecture metrics anonymization SDK |
| 4 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry specification architecture monitoring |
| 5 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry architecture monitoring specification layers |
| 6 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry architecture specification monitoring integration |
| 7 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry architecture monitoring specification layers |
| 8 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 72.5 | OpenTelemetry architecture monitoring metrics anonymization |
| 9 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 61.7 | OpenTelemetry architecture specification monitoring integration |
| 10 | 1 | /資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力 | 72.5 | OpenTelemetry architecture specification metrics anonymization |

### collaborative-editor

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 61.1 | リアルタイム編集 Yjs 協調編集 WebSocket MongoDB |
| 2 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 59.5 | リアルタイム編集 collaborative-editor Yjs WebSocket MongoDB |
| 3 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 70.3 | リアルタイム同時編集 内部実装 GROWI CRDT Yjs |
| 4 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 53.3 | リアルタイム編集 collaborative-editor Yjs WebSocket 認証 |
| 5 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 59.5 | リアルタイム編集 collaborative-editor Yjs WebSocket MongoDB |
| 6 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 61.1 | リアルタイム編集 Yjs WebSocket MongoDB 協調編集 |
| 7 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 61.1 | リアルタイム編集 Yjs 協調編集 WebSocket MongoDB |
| 8 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 59.5 | リアルタイム編集 collaborative-editor Yjs WebSocket MongoDB |
| 9 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 54.0 | リアルタイム編集 協調型エディタ Yjs WebSocket MongoDB |
| 10 | 2 | /資料/内部仕様/ビルトインエディタでの同時多人数編集 | 50.0 | リアルタイム編集 Yjs collaborative-editor 同期 MongoDB |

### presentation

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 3 | /資料/内部仕様/プレゼンテーション | 59.8 | presentation slides implementation react marp |
| 2 | 6 | /資料/内部仕様/プレゼンテーション | 50.6 | GROWI presentation スライド描画 モジュール分離 Marp |
| 3 | 8 | /資料/内部仕様/プレゼンテーション | 25.3 | presentation slide implementation rendering feature |
| 4 | 3 | /資料/内部仕様/プレゼンテーション | 25.3 | presentation slide implementation optimization ReactMarkdown |
| 5 | 4 | /資料/内部仕様/プレゼンテーション | 54.3 | presentation slides implementation reactmarkdown marp |
| 6 | 5 | /資料/内部仕様/プレゼンテーション | 27.5 | GROWI presentation slide implementation specification |
| 7 | 5 | /資料/内部仕様/プレゼンテーション | 42.8 | presentation slide implementation ReactMarkdown Marp |
| 8 | 5 | /資料/内部仕様/プレゼンテーション | 42.8 | presentation slide rendering Marp ReactMarkdown module separation |
| 9 | 9 | /資料/内部仕様/プレゼンテーション | 25.3 | presentation slide implementation feature specification |
| 10 | 4 | /資料/内部仕様/プレゼンテーション | 25.3 | presentation slide implementation Separation rendering |

### news-inappnotification

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 1 | /資料/内部仕様/InAppNotificationにニュースを配信する | 94.4 | ニュース配信 通知管理 情報表示 キャッシュ 通知フィード |
| 2 | 1 | /資料/内部仕様/InAppNotificationにニュースを配信する | 134.1 | ニュース配信 InAppNotification ニュースフィード キャッシュ 通知管理 |
| 3 | 2 | /資料/内部仕様/InAppNotificationにニュースを配信する | 98.4 | ニュース配信 InAppNotification 通知管理 キャッシュ モデル |
| 4 | 1 | /資料/内部仕様/InAppNotificationにニュースを配信する | 97.8 | ニュース配信 通知 InAppNotification システム実装 管理 |
| 5 | 2 | /資料/内部仕様/InAppNotificationにニュースを配信する | 99.2 | ニュース配信 通知システム 情報管理 定期取得 ニュース表示 |
| 6 | 1 | /資料/内部仕様/InAppNotificationにニュースを配信する | 71.4 | ニュース配信 通知 インアプ通知 情報表示 キャッシュ |
| 7 | 2 | /資料/内部仕様/InAppNotificationにニュースを配信する | 69.9 | ニュース配信 通知 スケジューリング キャッシュ ユーザー管理 |
| 8 | 2 | /資料/内部仕様/InAppNotificationにニュースを配信する | 95.6 | ニュース配信 通知 InAppNotification キャッシュ MongoDB |
| 9 | 2 | /資料/内部仕様/InAppNotificationにニュースを配信する | 125.3 | ニュース配信 通知 ニュース InAppNotification ローカルキャッシュ |
| 10 | 1 | /資料/内部仕様/InAppNotificationにニュースを配信する | 105.9 | ニュース配信 通知管理 ニュースフィード 情報表示 キャッシュ |

### auto-scroll

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 37.0 | 自動スクロール レンダリング監視 ページビュー コンテンツ ハッシュ |
| 2 | 圏外 | (圏外) top1: /開発日記/ページリスト洗い出し | 32.1 | 自動スクロール ハッシュ レンダリング ページ 補正 |
| 3 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 37.0 | 自動スクロール レンダリング監視 ページビュー コンテンツ ハッシュ |
| 4 | 圏外 | (圏外) top1: /user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ | 24.3 | 自動スクロール レンダリング監視 ハッシュリンク ページビュー レイアウト補正 |
| 5 | 圏外 | (圏外) top1: /user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ | 24.3 | 自動スクロール レンダリング検出 ページビュー ハッシュリンク レイアウト補正 |
| 6 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 45.0 | 自動スクロール レンダリング監視 コンテンツ ページ システム |
| 7 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 37.0 | 自動スクロール レンダリング監視 ページビュー コンテンツ ハッシュ |
| 8 | 圏外 | (圏外) top1: /user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ | 24.3 | 自動スクロール ハッシュリンク レンダリング監視 ページビュー レイアウト補正 |
| 9 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 37.0 | 自動スクロール レンダリング監視 ページビュー コンテンツ ハッシュ |
| 10 | 圏外 | (圏外) top1: /資料/外部仕様/コンテンツ多言語対応 | 37.0 | 自動スクロール レンダリング監視 ページビュー コンテンツ ハッシュ |

### oauth2-email-support

| # | 順位 | 命中パス(無ければtop1) | スコア | 抽出キーワード |
|---|---|---|---|---|
| 1 | 1 | /Tips/GoogleOAuth設定方法 | 51.9 | OAuth 2.0 メール送信 Google Workspace 認証 実装 |
| 2 | 2 | /Tips/GoogleOAuth設定方法 | 54.3 | OAuth 2.0 メール送信 Gmail API 認証 セキュリティ |
| 3 | 1 | /Tips/GoogleOAuth設定方法 | 58.4 | OAuth 2.0 メール送信 Google Workspace 認証 セキュリティ |
| 4 | 2 | /Tips/GoogleOAuth設定方法 | 54.3 | OAuth 2.0 メール送信 認証 セキュリティ Gmail API |
| 5 | 2 | /Tips/GoogleOAuth設定方法 | 54.3 | OAuth 2.0 メール送信 認証 Gmail API セキュリティ |
| 6 | 12 | /Tips/GoogleOAuth設定方法 | 35.0 | OAuth 2.0 メール送信 セキュリティ トークン管理 認証 |
| 7 | 1 | /Tips/GoogleOAuth設定方法 | 58.4 | OAuth 2.0 メール送信 Google Workspace 認証 セキュリティ |
| 8 | 1 | /Tips/GoogleOAuth設定方法 | 58.4 | OAuth 2.0 メール送信 Google Workspace 認証 セキュリティ |
| 9 | 1 | /Tips/GoogleOAuth設定方法 | 58.4 | OAuth 2.0 メール送信 セキュリティ Google Workspace 認証 |
| 10 | 2 | /Tips/GoogleOAuth設定方法 | 54.3 | OAuth 2.0 メール送信 認証 Gmail API セキュリティ |

## スコープ外

- プロンプト/脚切りロジックの改善実装（本 [D2] は計測のみ。改善は別タスク）
- GROWI への結果記録（[E] 系・ホスト側）
- dev wiki への書き戻し
