# [D] 結果レポート: suggestPath トップN命中率の再計測（改修後）

このファイルは指示書 [D]（`D-suggestpath-remeasure.md`）の **実施結果**。dev container 内で実施。
**自己完結**（会話履歴不要。ホスト側で [E] = ベースラインと並べて記録する際の入力になる）。

## TL;DR

- 改修後プロンプト（`analyze-content.ts` キーワード抽出、commit `4e157f9`）が乗ったローカル GROWI
  （[C] で dev wiki import 済み）に対し、**6 ケース × 10 回 = 60 コール**を
  `POST /_api/v3/ai-tools/suggest-path` に投げて (B) 正親配下出現率を再計測。
- **合計 (B): ベースライン 21/60 → 改修後 41/60（+20）**。**60/60 エラーなし**。
- ベースラインで全滅/低迷だった **news (1→8)・oauth2 (0→8)・collaborative-editor (5→8)・
  presentation (5→8)** が大きく改善。**auto-scroll は 0/10 のまま未改善**。opentelemetry は 10→9 と僅減。

## 計測条件（ベースライン #183967 と固定で一致）

| 項目 | 値 |
|---|---|
| 対象 | ローカル GROWI `http://localhost:3000`（[C] で dev wiki import + ES rebuild 済み） |
| 呼び出し | `POST /_api/v3/ai-tools/suggest-path`、body `{ "body": "<本文>" }` |
| 認証 | admin の apiToken を発行して `?access_token=`（このルートは `acceptLegacy: true`）。セッション揮発回避のため |
| 入力本文 | 指示書 [D] の6ケース固定本文を **MD から直接抽出**（改変なし。抽出長: opentelemetry 874 / collaborative-editor 829 / presentation 715 / news 855 / auto-scroll 948 / oauth2 851 文字） |
| 試行回数 | 各ケース 10 回（計 60 コール） |
| 指標 (B) | 返却候補（`type==='memo'` 除外）のいずれかの `path` が正解パス（下記）と一致 or その配下（末尾スラッシュ正規化後 `候補.startsWith(正解)`）か。10 回中 M 回 |
| 補助 (A) | 正解パスと厳密一致 |

> memo 枠（`generateMemoSuggestion` の定数枠）はベースライン同様、判定から除外。`type` が `search` /
> `category` の候補だけで (A)(B) を判定。

正解パス（[C] でローカル ES 実在確認済み）:

| ケース | 正解パス |
|---|---|
| opentelemetry | `/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/` |
| collaborative-editor | `/資料/内部仕様/ビルトインエディタでの同時多人数編集/` |
| presentation | `/資料/内部仕様/プレゼンテーション/` |
| news-inappnotification | `/資料/内部仕様/InAppNotificationにニュースを配信する/` |
| auto-scroll | `/資料/外部仕様/アンカーによるページのScroll/` |
| oauth2-email-support | `/Tips/開発用のミドルウェア追加/SMTPサーバー (ローカル環境&ローカル環境以外)/` または `/Tips/GoogleOAuth設定方法/` |

## 1. 事前確認（指示書 [D] §事前確認・3点）

| チェック | 結果 |
|---|---|
| (1) 改修後プロンプトが乗っているか | ✅ `analyze-content.ts` に `"subject and purpose of the content"` あり（`4e157f9`） |
| (2) データが残っているか | ✅ 検索 `プレゼンテーション` で total=34 hit（[C] のデータ健在、ES index 1405 docs） |
| (3) AI が有効か | ✅ probe コールが HTTP 200・`type:search` 候補を返却（`AI_ENABLED`/`AI_SERVICE_TYPE` が env 経由で有効。ダミーは未使用） |

## 2. 結果サマリー（ベースライン #183967 併記）

| ユースケース | ベース (B) | 改修後 (B) | 差分 | 改修後 (A) | 平均候補数 |
|---|---|---|---|---|---|
| opentelemetry | 10/10 | 9/10 | −1 | 9/10 | 2.4 |
| collaborative-editor | 5/10 | **8/10** | +3 | 8/10 | 3.3 |
| presentation | 5/10 | **8/10** | +3 | 8/10 | 3.5 |
| news-inappnotification | 1/10 | **8/10** | **+7** | 8/10 | 1.8 |
| auto-scroll | 0/10 | 0/10 | ±0 | 0/10 | 2.4 |
| oauth2-email-support | 0/10 | **8/10** | **+8** | 8/10 | 2.5 |
| **合計** | **21/60** | **41/60** | **+20** | 41/60 | — |

## 3. (A) 厳密一致

指示書は「(A) はほぼ常に 0」想定だったが、**今回は全ケースで (A)=(B)**。正解パスが「実在トピック
ページそのもの」で、suggestPath が `type:search` でそのページちょうどを返すため、(B) の startsWith
命中＝厳密一致になっている（親フォルダ止まりや配下の別ページで当たったケースは無い）。

## 4. 所感

- **改修の主目的（ベースラインで全滅/低迷したケースの底上げ）は達成**。news (1→8)・oauth2 (0→8)・
  collaborative-editor (5→8)・presentation (5→8) が改善。被験文の「主題・目的」を優先するプロンプト
  変更が効き、実装語（Yjs / nodemailer / Marp 等）に引っ張られず正解トピックページを拾えるようになった。
- **opentelemetry 10→9（僅減）**: 外した 1 回（trial 9）は `category:/資料/` のみで、本来の
  `OpenTelemetry 出力` ページを返せなかった。他9回は安定ヒット。LLM 非決定性の範囲で実害小。
- **auto-scroll 0/10（唯一の未改善）**: 候補は `/user/mao-t/メモ/.../自動スクロールとスタイルメモ/`・
  `/開発日記/ページリスト洗い出し/`・`/資料/外部仕様/WIP ページ/` 等に散り、正解
  `/資料/外部仕様/アンカーによるページのScroll/` は **10回中0回**。被験文が「ハッシュ自動スクロール /
  auto-scroll / useHashAutoScroll」を強調する一方、正解ページ名は「**アンカーによる**ページのScroll」で、
  抽出キーワードが「アンカー」に橋渡しできていない。改修後も未解決で、次の改善候補。
- **oauth2 のデータ補足（[E]/今後の注意）**: 命中は `/Tips/GoogleOAuth設定方法/`(9x) が牽引。加えて
  モデルは `…/SMTPサーバー (Gmail)/`・`…/SMTP サーバー (Gmail)/`（全角/半角スペース2表記）という
  **「(Gmail)」版の SMTP ページ**も候補に出している。これは oauth2-email-support の主題（Gmail OAuth
  送信）に最も近いページだが、ベースラインの正解2パス（SMTP は「(ローカル環境&…)」側）に startsWith
  しないため命中には数えていない。**正解パス定義が dev wiki の実データとややズレている可能性**があり、
  「(Gmail)」版も正解に含めるなら oauth2 はさらに高くなる。[E] でベースライン定義との整合を確認されたい。

## 5. 成功率・環境差

- **60/60 エラーなし**（`D-results.json` の `errors=0`）。
- 環境差:
  - この devcontainer の `python3.14` は標準ライブラリ `http`/`urllib` が壊れていて import 不可。
    計測スクリプトは **subprocess + curl** に切替えて対応。
  - 認証はセッション cookie の揮発（`/var/tmp` が途中で揮発する事象を [C] で確認）を避けるため、
    admin に apiToken を発行し `?access_token=` を使用。
  - [C] と同じく、dev wiki データは mongo の匿名ボリューム上にあり永続性が脆い。再計測時は
    `C-...-result.md` の復旧手順を先に確認すること。

## 6. 全 60 コール raw 候補（memo 枠除外・`type:path`）

`B`/`A` 列は各 trial の (B) 正親配下命中 / (A) 厳密一致（○/×）。
（同一データは `apps/app/tmp/D-results.json` にも保存。ただし当該ディレクトリは gitignore 対象のため
本表を正本とする。）

### opentelemetry

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / category:/資料/ |
| 2 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / search:/資料/開発ガイドライン/ADR - Architecture Decision Record/ / category:/資料/ |
| 3 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / category:/資料/ |
| 4 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / search:/資料/開発ガイドライン/ADR - Architecture Decision Record/ / category:/資料/ |
| 5 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / search:/資料/開発ガイドライン/ADR - Architecture Decision Record/ / category:/資料/ |
| 6 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / search:/資料/開発ガイドライン/ADR - Architecture Decision Record/ / category:/資料/ |
| 7 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / search:/資料/開発ガイドライン/ADR - Architecture Decision Record/ / category:/資料/ |
| 8 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / category:/資料/ |
| 9 | × | × | category:/資料/ |
| 10 | ○ | ○ | search:/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/ / category:/資料/ |

### collaborative-editor

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / category:/user/ |
| 2 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / search:/資料/外部仕様/ビルトインエディタでの同時多人数編集/ / search:/GROWI村議議事録/ / category:/user/ |
| 3 | × | × | category:/user/ |
| 4 | × | × | category:/user/ |
| 5 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / category:/user/ |
| 6 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / search:/資料/外部仕様/ビルトインエディタでの同時多人数編集/ / category:/user/ |
| 7 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / category:/user/ |
| 8 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / search:/資料/外部仕様/ビルトインエディタでの同時多人数編集/ / search:/GROWI村議議事録/20240614/ / category:/user/ |
| 9 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / search:/資料/外部仕様/ビルトインエディタでの同時多人数編集/ / search:/GROWI村議議事録/20240705/ / category:/user/ |
| 10 | ○ | ○ | search:/user/ryoji-s/yjs/ / search:/資料/内部仕様/ビルトインエディタでの同時多人数編集/ / category:/user/ |

### presentation

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | × | × | search:/v7 docs修正内容/en/presentation/ / search:/v7 docs修正内容/en/marp/ / category:/v7 docs修正内容/ |
| 2 | ○ | ○ | search:/v7 docs修正内容/en/presentation/ / search:/v7 docs修正内容/ja/presentation/ / search:/資料/内部仕様/プレゼンテーション/ / category:/v7 docs修正内容/ |
| 3 | ○ | ○ | search:/v7 docs修正内容/en/presentation/ / search:/v7 docs修正内容/en/marp/ / search:/資料/内部仕様/プレゼンテーション/ / category:/v7 docs修正内容/ |
| 4 | ○ | ○ | search:/v7 docs修正内容/ja/presentation/ / search:/v7 docs修正内容/en/presentation/ / search:/資料/内部仕様/プレゼンテーション/ / category:/v7 docs修正内容/ |
| 5 | ○ | ○ | search:/資料/内部仕様/プレゼンテーション/ / search:/開発日記/Frontmatter を使用したスライド表示/ / category:/資料/ |
| 6 | ○ | ○ | search:/資料/内部仕様/プレゼンテーション/ / search:/資料/内部仕様/ / category:/資料/ |
| 7 | ○ | ○ | search:/資料/内部仕様/プレゼンテーション/ / search:/開発日記/Frontmatter を使用したスライド表示/ / category:/資料/ |
| 8 | ○ | ○ | search:/v7 docs修正内容/ja/presentation/ / search:/資料/内部仕様/プレゼンテーション/ / category:/v7 docs修正内容/ |
| 9 | ○ | ○ | search:/v7 docs修正内容/en/presentation/ / search:/v7 docs修正内容/ja/presentation/ / search:/資料/内部仕様/プレゼンテーション/ / category:/v7 docs修正内容/ |
| 10 | × | × | search:/v7 docs修正内容/en/presentation/ / search:/v7 docs修正内容/en/marp/ / search:/v7 docs修正内容/ja/presentation/ / category:/v7 docs修正内容/ |

### news-inappnotification

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | × | × | category:/user/ |
| 2 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 3 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 4 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 5 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 6 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 7 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 8 | × | × | category:/user/ |
| 9 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |
| 10 | ○ | ○ | search:/資料/内部仕様/InAppNotificationにニュースを配信する/ / category:/資料/ |

### auto-scroll

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | × | × | search:/engineering/frontend/ / category:/資料/ |
| 2 | × | × | search:/user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ/ / search:/開発日記/bootstrap4化/棚卸しMTG/ / category:/user/ |
| 3 | × | × | search:/資料/外部仕様/WIP ページ/ / category:/資料/ |
| 4 | × | × | search:/GROWI村議議事録/ / category:/Web会議室/ |
| 5 | × | × | search:/user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ/ / category:/user/ |
| 6 | × | × | search:/資料/外部仕様/コンテンツ多言語対応/内部仕様/データモデル設計/ / category:/資料/ |
| 7 | × | × | search:/開発日記/ページリスト洗い出し/ / search:/資料/外部仕様/WIP ページ/ / search:/通貫テスト/検索&ページツリー 通貫テスト/ / category:/開発日記/ |
| 8 | × | × | search:/開発日記/ページリスト洗い出し/ / category:/開発日記/ |
| 9 | × | × | search:/user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ/ / search:/開発日記/ページリスト洗い出し/ / category:/user/ |
| 10 | × | × | search:/user/mao-t/メモ/2022/01/27/自動スクロールとスタイルメモ/ / category:/user/ |

### oauth2-email-support

| # | B | A | 候補 (type:path、memo除外) |
|---|---|---|---|
| 1 | × | × | category:/Web会議室/ |
| 2 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/開発用のミドルウェア追加/SMTP サーバー (Gmail)/ / category:/Tips/ |
| 3 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/GoogleOAuth設定方法/ / category:/Tips/ |
| 4 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / category:/Tips/ |
| 5 | × | × | search:/Tips/開発用のミドルウェア追加/SMTP サーバー (Gmail)/ / category:/Tips/ |
| 6 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / category:/Tips/ |
| 7 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/開発用のミドルウェア追加/SMTPサーバー (Gmail)/ / category:/Tips/ |
| 8 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/開発用のミドルウェア追加/SMTPサーバー (Gmail)/ / category:/Tips/ |
| 9 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/開発用のミドルウェア追加/ / category:/Web会議室/ |
| 10 | ○ | ○ | search:/Tips/GoogleOAuth設定方法/ / search:/Tips/開発用のミドルウェア追加/ / category:/Tips/ |

## 7. スコープ外（[D] では未実施）

- GROWI への結果記録（= [E]。ホスト側でベースラインページと並べて記録）
- プロンプトの追加調整（auto-scroll の「アンカー」橋渡し等、命中率を見たうえでの次の改善は別タスク）
- dev wiki への書き戻し
