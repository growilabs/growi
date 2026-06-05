# [C] 結果レポート: dev wiki データのローカル import と検証

このファイルは指示書 [C]（`C-import-dev-wiki-and-verify.md`）の **実施結果** をまとめたもの。
dev container 内で実施。**自己完結**（会話履歴を見なくても [D] を設計できるように書いてある）。

## TL;DR

- **[C] の完了条件（dev wiki を import → ES 再構築 → 6 ユースケースの正解パスがローカル ES で
  検索ヒット）を達成。6 ケース全て HIT。**
- import 中に **`Invalid option for pages` / `Invalid option for revisions` は一度も発生せず**、
  [A] の `declare` 修正が end-to-end で機能していることを実地で確認。
- ただし途中で **3 つの想定外**（ES コンテナのクラッシュループ / mongo データのリセットによる
  未インストール化 / `/var/tmp` の揮発）があり、いずれも解消済み。**特に mongo データ消失に伴い
  GROWI を新規インストールし直している**（元の 555 pages + admin `tomoyuki-t` は消失）。詳細は後述。

## 結論（[C] 完了条件の達成状況）

| 項目 | 結果 |
|---|---|
| import が `Invalid option for pages` 無しで完走 | ✅ |
| Page collections 全部 + users を import | ✅ |
| ES インデックス再構築 | ✅（1405 docs, errors=false） |
| 6 ユースケースの正解パスがローカル ES で検索ヒット | ✅ 6/6（rank 1〜2） |

## 環境の最終状態（[D] が前提にできる）

- **GROWI dev サーバは起動したまま**: `http://localhost:3000`（`pnpm run dev`、ts-node + nodemon）。
- **メンテナンスモード OFF**（`isMaintenanceMode: false`）。
- **Elasticsearch**: `elasticsearch:9200`、ローカル GROWI から疎通 OK、`analysis-kuromoji` +
  `analysis-icu`（共に 9.3.3）インストール済み。`growi` インデックスに **1405 docs**。
  cluster status は **yellow**（単一ノードでレプリカ未割当のため＝正常。検索・indexing は完全動作）。
- **MongoDB**: `mongodb://mongo:27017/growi`。pages 1618 / revisions 13571 / users 161 / comments 271 ほか。
- **admin 資格情報（新規インストールで作成）**: username `admin` / email `admin@example.com` /
  password `GrowiDevAdmin2026`。**apiToken は未生成**（必要なら管理画面 or Mongo で発行）。
- import に使った patched zip: `apps/app/tmp/devwiki-patched.zip`（gitignore 対象、再 import 用に残置）。

## 1. import 結果

- **`Invalid option for pages` は一度も発生せず**（route → `generateOverwriteParams` →
  `isImportOptionForPages` を通過）。revisions の option にも5キーを付与したため
  `Invalid option for revisions`（`overwrite-params/index.ts` の revisions 分岐）も発生せず。
- 経路は **GROWI 正規 HTTP ルート**（管理画面 UI と同じ API）を admin セッションで駆動:
  メンテナンス ON → `POST /_api/v3/import/upload`（zip）→ `POST /_api/v3/import` → 完了 → メンテナンス OFF。
- import 件数（取込後・seed/admin 含む）:

| collection | mode | 取込後件数 | 備考 |
|---|---|---|---|
| pages | upsert | 1618 | ソースの全 1610 ユニークパスが存在（パス欠落 **0**）。+ seed 8 / v5 移行の自動生成親 |
| revisions | upsert | 13571 | 失敗 **0** |
| users | upsert | 161 | dev wiki 160 全取込 + admin 1 |
| comments | insert | 271 | |
| tags / pagetagrelations / pageredirects / sharelinks | insert | 74 / 23 / 76 / 5 | |

- import 後の v5 ページ正規化（descendantCount 再計算・親生成）も完走。
- ログ上「Importing pages ... Failed: 計4」が出たが、**ソースの全ユニークパスは Mongo に存在**
  （`pages.json` のパス集合と DB のパス集合を比較して差分 0）。重複パス / _id 由来のバッチ失敗で、
  **実ページの欠落・6 ケース対象への影響は無し**。

## 2. バージョン整合

- **書き換えが必要だった**。zip 内 `meta.json` の `version` = **`8.0.0-RC.0`**（dev.growi.org 側）
  ≠ ローカル GROWI `7.5.5-RC.0`。
- `meta.json` の `version` のみ **`7.5.5-RC.0`** に書き換え、元 zip の内部構造（ルート直下に
  `meta.json` + 各 collection の `.json`）を保ったまま meta.json エントリだけ更新して再 zip。
  → `/import/upload` の version 検証を通過。データ本体は無改変。

## 3. ES 再構築

- `PUT /_api/v3/search/indices` body `{"operation":"rebuild"}`（**メンテナンス OFF 必須**。ON のままだと
  503 `GROWI is under maintenance.`）で実行 → **完了**（`Adding pages has completed: totalCount=1405,
  errors=false` → `Normalize indices`）。
- **インデックス済み 1405 docs**。Mongo の pages 1618 との差は、ES が空ページ（v5 移行で自動生成
  された親）・非インデックス対象を除外するためで正常。

## 4. 正解パス検証（6 ケース — 全ヒット）

各ケースで `GET /_api/search?q=<クエリ>&limit=20`（admin セッション）を叩き、結果配列
（ES 関連度スコア降順）の中で正解パスが最初に現れた位置を `rank` とした。

| ユースケース | ローカル ES 実パス（正） | rank | total |
|---|---|---|---|
| opentelemetry | `/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力` | 1 | 119 |
| collaborative-editor | `/資料/内部仕様/ビルトインエディタでの同時多人数編集` | 2 | 352 |
| presentation | `/資料/内部仕様/プレゼンテーション` | 1 | 34 |
| news-inappnotification | `/資料/内部仕様/InAppNotificationにニュースを配信する` | 2 | 137 |
| auto-scroll | `/資料/外部仕様/アンカーによるページのScroll` | 1 | 624 |
| oauth2/SMTP | `/Tips/開発用のミドルウェア追加/SMTPサーバー (ローカル環境&ローカル環境以外)` | 2 | 214 |
| oauth2/GoogleOAuth | `/Tips/GoogleOAuth設定方法` | 1 | 532 |

> 表記揺れ補正（実データを正とした）:
> - SMTP のタイトルは指示書の `(Gmail)` ではなく実データの `(ローカル環境&ローカル環境以外)`。
> - auto-scroll は内部仕様側が存在せず、外部仕様側 `/資料/外部仕様/アンカーによるページのScroll` を採用（指示書想定どおり）。

### ⚠️ rank の意味と [D] への重要な注意

- この `rank` は **「正解ページのタイトル語をそのまま入れた素直なクエリ」での順位**であり、
  **suggest-path の命中率ではない**。
- [C] の趣旨は「正解ページが ES に乗っていて検索で引ける」土台確認まで。**suggest-path が LLM で
  抽出する（もっと曖昧/間接的な）キーワードでの命中率は別物**で、それを測るのが [D]。
- したがって本表の rank 1〜2 を「suggest-path の精度が高い」と解釈しないこと。

## 5. [D] への申し送り（重要）

[D]（suggestPath 命中率の再計測）を「ベースライン #183967 と同条件」で回すための土台は整った。
使える材料:

- **検索 API**: `GET http://localhost:3000/_api/search?q=...&limit=N`。レスポンスは
  `{ meta:{total,took,hitsCount}, data:[{ data:{...page, path}, meta }] , ok }`。
  正解パスは `data[i].data.path`。
- **認証**: 管理系/検索 API は admin セッション cookie（`connect.sid`）で駆動。
  上記 admin 資格情報でログインしてセッションを取得するか、管理画面で apiToken を発行して
  `?access_token=` でも可（import/maintenance/search 各ルートは `acceptLegacy: true`）。
- **6 ケースの「正解パス」は上表の実データ値が正**（指示書 [C] の raw 転記から表記揺れを補正済み）。
- **正解の定義**: ベースライン #183967 で「正親配下の実在ページ」とされたフルパス。suggest-path の
  出力（推定親パス or 候補一覧）がこの正解パス（またはその正親）に一致するかで命中判定する想定。
- 環境前提: dev wiki 全 1610 ユニークパスが Mongo + ES に存在、ES に kuromoji/icu 入り、status は
  単一ノードのため yellow（機能影響なし）。

## 6. 想定外と対処（環境差）

実施中に 3 件の想定外があり、いずれも解消済み。**[D] 着手前に再確認すべき注意点**でもある。

### (A) ES コンテナがクラッシュループしていた → 復旧済み（恒久対処）

- devcontainer の compose（`.devcontainer/compose.yml`）は stock ES image に対し
  `elasticsearch-plugins.yml` を**ファイルとして** bind mount する設計だが、参照先
  `growi-docker-compose/elasticsearch/v9/config/elasticsearch-plugins.yml` が**存在しなかった**。
  → Docker がマウント元に**空ディレクトリを自動生成** → ES が設定ファイルを読めず起動失敗を反復。
- **対処**: `/workspace/growi-docker-compose/elasticsearch/v9/config/elasticsearch-plugins.yml` を
  正しい内容（`analysis-kuromoji` + `analysis-icu` を宣言）で新規作成し、ES コンテナを再作成。
  → 両プラグインが入り status green で安定。GROWI の ES9 マッピング（`kuromoji_tokenizer` +
  `icu_normalizer`、`mappings/mappings-es9.ts`）がこの2プラグインを必須とするため不可欠。
- **このファイルは `growi-docker-compose` リポジトリ側の変更**（growi 本体リポジトリ外）で、
  本コミットには含まれない。消すと再発するので残置している。恒久化するなら growi-docker-compose
  側で別途コミットが必要。

### (B) mongo データがリセットされ未インストール状態に → 新規インストールで再構築

- ES 復旧作業中に mongo コンテナが作り直された際、**匿名ボリューム**（compose で named volume 化
  されていない `mongo: volumes: - /data/db`）の DB が空に差し替わり、`mongo-init` が空 DB に
  replica set を再初期化。結果ローカル GROWI が未インストール化（configs/users/pages 全消失）。
  → 元の 555 pages + admin `tomoyuki-t` は消失。
- **対処**: ユーザー承認のもと `POST /_api/v3/installer` で新規 admin を作成して再インストール。
  その後 dev wiki を import。
- **注意（[D] でも該当）**: mongo データは匿名ボリュームに乗っており**永続性が脆い**。devcontainer
  やスタックを作り直すと再び消える可能性がある。[D] 実施前に Mongo/ES にデータが残っているか確認し、
  消えていたら本レポートの手順（新規インストール → patched zip を再 import → rebuild）で再構築すること。

### (C) `/var/tmp` が揮発した

- patched zip（68MB）を `/var/tmp` に置いたら数分で消えた（クリーンアップ）。
  → ワークスペース永続領域（`apps/app/tmp/`）に作り直して対応。作業ファイルは永続領域に置くこと。

## 7. スコープ外（[C] では未実施）

- suggestPath の命中率計測そのもの（= [D]）
- プロンプト調整
- dev wiki への書き戻し
- 失敗 4 件（重複パス/_id 由来）の個別追跡（パス欠落 0 のため実害なしと判断）
