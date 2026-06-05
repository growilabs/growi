# dev container 側 Claude への指示書 [C]: dev wiki データのローカル import と検証

このファイルは自己完結している。inner wiki / 会話履歴 / Redmine を見る必要はない。

前提: 指示書 [A]（`docs/183968-devcontainer-instructions/A-import-fix-verify.md`）で
GROWI Archive Import の `Invalid option for pages` バグ修正（`import-option-for-pages.ts`
の `declare` 化）が検証済み。**この [C] はその修正が効いている前提で、実際に dev wiki の
データをローカル GROWI に import する。**

## ゴール

dev.growi.org（公開 OSS デモ wiki）から export したアーカイブを **このローカル GROWI に
import** し、**6 ユースケースの「正解パス」がローカル Elasticsearch で検索ヒットする状態**を
作る。これは後続 [D]（suggestPath の命中率再計測）が「ベースライン #183967 と同条件」で
成立するための土台。

import が通るだけでは不十分。**ES に乗って検索で引ける**ところまでが [C] の完了条件。

## 入力（既に dev container 側にあるはず）

- **dev wiki の export zip**（ホスト側で dev.growi.org/admin/export から作成・ダウンロード
  したもの）。Page collections 全部 + `users` を含む。
- 同じ zip を展開したフォルダも投入されている場合があるが、**import に使うのは zip 本体**。
  GROWI の import サービスは zip を受け取って内部で解凍する設計で、展開済みフォルダを直接
  食わせる口は無い。zip が見当たらなければユーザーに zip の場所を確認すること。

> もし git fetch 等で `.git/objects` の permission error が出たら（[A] でも発生）、
> `sudo chown -R vscode:vscode .git` で解消してから再実行。

## ⚠ 事前に潰しておく3つの前提条件（route が弾く）

`apps/app/src/server/routes/apiv3/import.ts` を読むと、import は以下を満たさないと弾かれる：

### 1. バージョン完全一致（一番ハマりやすい）

`import.ts` の `validate()` は **`meta.version !== getGrowiVersion()` なら throw**（完全一致
判定。緩い比較ではない）。

- このローカル GROWI のバージョン: **`7.5.5-RC.0`**（`apps/app/package.json`。`getGrowiVersion()`
  はこれを返す。起動中インスタンスで `node -e "console.log(require('./apps/app/package.json').version)"`
  で再確認可）。
- dev.growi.org は**別バージョンで動いている可能性が高い**ので、zip 内 `meta.json` の `version`
  がローカルと違うと `versions-are-not-met` / "versions are not the same" で弾かれる。

**逃げ道**: zip 内の `meta.json` の `version` フィールドをローカルの値に書き換えてから import する。

```bash
# zip を一時展開して meta.json の version を確認
mkdir -p /tmp/devwiki-archive && cd /tmp/devwiki-archive
unzip -o <path-to>/<archive>.zip
cat meta.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('version'))"

# ローカル版 (7.5.5-RC.0 等) と違ったら meta.json の version を書き換えて再 zip
# （データ本体は触らない。version 文字列だけ合わせる）
python3 - <<'PY'
import json
p = 'meta.json'
m = json.load(open(p))
m['version'] = '7.5.5-RC.0'   # ← 起動中ローカル GROWI の実バージョンに合わせる
json.dump(m, open(p, 'w'), ensure_ascii=False)
print('patched meta.version ->', m['version'])
PY

# 元 zip と同じ構造（ルート直下に meta.json + 各 collection の .json）で再 zip
zip -r /tmp/devwiki-patched.zip . -x '.*'
```

> 注意: 再 zip は **元 zip と同じ内部構造**（ルート直下に `meta.json` と各コレクションの
> `<collection>.json` が並ぶ形）を保つこと。サブディレクトリに入れ子にしない。`growiBridgeService.parseZipFile`
> がこの構造を前提に innerFileStats を組む。

### 2. メンテナンスモード必須

import route は `crowi.appService.isMaintenanceMode()` が false なら
`not_maintenance_mode` で拒否する。**import 前に管理画面でメンテナンスモードを ON**
（`/admin` → アプリ設定 → メンテナンスモード開始）。import 完了後に OFF に戻す。

### 3. pages は upsert モード

v5 互換 GROWI では `pages` コレクションの import mode は **`upsert` 必須**（route が
`only_upsert_available` で弾く）。UI のコレクション設定で pages を upsert にすること。
他コレクションは insert で良いが、再実行する可能性を考えると全 upsert が無難。

## import 手順（GROWI 正規ルート）

devcontainer 上で GROWI dev server を起動した状態で：

1. `/admin` にログイン（管理者）。**メンテナンスモード ON**。
2. `/admin/import`（データインポート）→ **zip をアップロード**（`/import/upload`）。
   - バージョン不一致エラーが出たら上の「逃げ道」で meta.json を直して再 zip → 再アップロード。
3. アップロード後、コレクションごとに import 設定。**pages は upsert**。Page collections
   全部 + `users` を import 対象にチェック。
4. import 実行（`/import`）。`Invalid option for pages` が**出ないこと**を確認（出たら [A]
   の修正がこのブランチに乗っていない＝ pull 漏れ。`grep -n "declare isOverwriteAuthorWithCurrentUser"
   apps/app/src/models/admin/import-option-for-pages.ts` で確認）。
5. import 完了をログ／管理画面の進捗で確認。

## import 後: Elasticsearch インデックス再構築（必須）

import は MongoDB にデータを入れるだけ。**ES には自動で乗らない**。suggestPath は ES 検索を
使うので、ここをやらないと [D] が全件 0 ヒットになる。

- 管理画面 `/admin/search`（全文検索管理）→ **「インデックスを再構築」**（rebuild index）を実行。
- もしくは ES 再構築の CLI/スクリプトがあればそれでも可。
- 再構築完了まで待つ（ページ数が多いと時間がかかる）。

## 検証（[C] の完了条件 — 同条件担保）

**6 ユースケースの「正解パス」がローカル ES で検索ヒットすること**を確認する。これが
ズレるとローカルで測った命中率が dev wiki を代表しなくなる。

ベースライン #183967 で「正解（正親配下）」とされた実在ページのフルパス：

| ユースケース | ローカル ES で引けるべき正解ページ |
|---|---|
| opentelemetry | `/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/` |
| collaborative-editor | `/資料/内部仕様/ビルトインエディタでの同時多人数編集/`（※下記注） |
| presentation | `/資料/内部仕様/プレゼンテーション/` |
| news-inappnotification | `/資料/内部仕様/InAppNotificationにニュースを配信する/` |
| auto-scroll | `/資料/外部仕様/アンカーによるページのScroll/`（近縁。内部仕様側は存在しない可能性） |
| oauth2-email-support | `/Tips/開発用のミドルウェア追加/SMTPサーバー (Gmail)/` ほか `/Tips/GoogleOAuth設定方法/` |

> 注: 上表のパスは raw 転記。実際の dev wiki 上の正確な表記（全角/半角スペース、表記揺れ）は
> import したデータ側を正とする。検証は「このトピックの確立ページが存在し、検索で引けるか」を
> 見る趣旨。

### 検証方法

ローカル GROWI の検索 API を叩いて、各正解ページが返るか確認する（ホスト側で dev.growi.org に
使ったのと同じ public search API 形式がローカルでも使えるはず）：

```bash
# 例: presentation の正解ページが引けるか（ローカル GROWI のポートに読み替え）
curl -s "http://localhost:3000/_api/search?q=プレゼンテーション&limit=20" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(p['path']) for p in d.get('data',[])]"
```

各ユースケースについて、正解ページのパスが検索結果に現れることを確認する。**6 件中、
最低でも baseline で命中していたもの**（opentelemetry / collaborative-editor / presentation /
news）の正解ページがローカル ES で引けることは必須。引けなければ：

- import が一部失敗している（該当コレクション欠落） → import ログ確認
- ES 再構築が未完 or 失敗 → 再実行
- パス表記が想定と違う → 実データのパスを `pages` コレクションで確認して正解表を更新

## 報告フォーマット

1. **import 結果**: `Invalid option for pages` が出なかったか。各コレクションの import 件数
   （pages / revisions / users 等が何件入ったか）。
2. **バージョン整合**: meta.json の version 書き換えが必要だったか。書き換えた値。
3. **ES 再構築**: 完了したか。インデックスされたページ数。
4. **正解パス検証**: 上表 6 ケースそれぞれ、正解ページがローカル ES 検索で引けたか（引けた/
   引けない/パス表記が違った を1件ずつ）。
5. 引っかかった点・環境差。

## やらないこと（スコープ外）

- suggestPath の命中率計測そのもの（これは [D]）
- プロンプトの調整
- dev wiki への書き戻し
