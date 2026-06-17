# Phase 6 Gate Evidence — 外部プラグイン導入 smoke (Requirement 6.7 / 6.8)

実施日: 2026-06-17
対象アーティファクト: `apps/app` 本番ビルド (`NODE_ENV=production node --import dotenv-flow/config.js dist/server/app.js`)
DB: `mongodb://mongo:27017/growi?replicaSet=rs0` (devcontainer)

## 目的

ESM 移行後の本番ビルドで、**外部プラグインの導入経路が壊れていないこと**を確認する。
本移行は `features/growi-plugin/server` のルートファクトリ・ルーター登録・動的 import 変換に
手を入れている (task 3.3.g 他) が、これらは build / boot の検証では実行されないため、
公式リリース済みプラグインを各種別 1 つずつ実際にインストールして経路全体を通す。

> 確認するのは「GROWI 側の導入経路」のみ。プラグイン側コードはロード・ビルドしない
> (GROWI はプラグインの prebuilt `dist/` をそのまま静的配信 / サーバ走査する設計)。

## テスト対象プラグイン (growi.org/plugins 公開・growilabs org)

| 種別 | リポジトリ | schemaVersion | マニフェスト形式 |
|------|-----------|:---:|------|
| script | `growilabs/growi-plugin-datatables` (main) | 4 | Vite4 `dist/manifest.json` |
| theme | `growilabs/growi-plugin-theme-vivid-internet` (main) | 4 | Vite5 `dist/.vite/manifest.json` |
| template | `growilabs/growi-plugin-templates-for-marketing` (main) | 4 | (走査・dist 不要) |

script は Vite4 形式、theme は Vite5 形式のマニフェストで、`retrievePluginManifest()` の両分岐を同時にカバーする。

## 手順と結果

### 認可 (task 3.3.g で変更されたルートファクトリの実行経路)

管理者ユーザーに `write:admin:plugin` / `read:admin:plugin` スコープのアクセストークンを発行
(`accesstokens` に sha256 ハッシュで格納)。

```
GET /_api/v3/plugins   (Bearer あり) → HTTP 200  {"plugins":[]}
GET /_api/v3/plugins   (Bearer なし) → HTTP 403
```

→ `export const setup` 化されたルートファクトリ + accessTokenParser/loginRequired/adminRequired チェーンが本番出力で機能。

### インストール (POST /_api/v3/plugins)

```
POST .../plugins {pluginInstallerForm:{url:".../growi-plugin-datatables", ghBranch:"main"}}
  → HTTP 200  {"pluginName":"growi-plugin-datatables"}
POST .../plugins {pluginInstallerForm:{url:".../growi-plugin-theme-vivid-internet", ...}}
  → HTTP 200  {"pluginName":"growi-plugin-theme-vivid-internet"}
POST .../plugins {pluginInstallerForm:{url:".../growi-plugin-templates-for-marketing", ...}}
  → HTTP 200  {"pluginName":"growi-plugin-templates-for-marketing"}
```

GitHub アーカイブ zip をダウンロード → 展開 → `growiPlugin` ディレクティブ検証 (`@growi/pluginkit` `.cjs`) → メタデータ保存、まで本番出力で成功。

### 永続化と種別判定 (GET /_api/v3/plugins + `growiplugins` collection)

| プラグイン | meta.types | isEnabled | サーバ側生成物 |
|------|------|:---:|------|
| growi-plugin-datatables | `["script"]` | true | — |
| growi-plugin-theme-vivid-internet | `["theme"]` | true | `themes:[{name:"vivid-internet", manifestKey:"src/styles/style.scss", schemeType:"light", ...}]` |
| growi-plugin-templates-for-marketing | `["template"]` | true | `templateSummaries:[{id:"article-seo-strategy-plan", locale:"en_US", isValid:true, ...}]` |

→ template はサーバ側でテンプレートが走査され summary 化、theme はテーマメタデータが生成される。

### クライアント読み込み経路

`_document.getInitialProps` が呼ぶ `retrieveAllPluginResourceEntries()` を in-process で実行:

```
ENTRIES_COUNT 2
<script type="module"> growilabs/growi-plugin-datatables -> /static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.2331ca5e.js
<link rel="stylesheet">  growilabs/growi-plugin-datatables -> /static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.db426607.css
```

SSR レンダリング済み HTML (`GET /login` → HTTP 200) に実際に注入されていることを確認:

```html
<script type="module" src="/static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.2331ca5e.js"></script>
<link rel="stylesheet" href="/static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.db426607.css"/>
```

(theme は選択中テーマのみ `themeHref` として注入される別経路。template はクライアント資産なし。設計どおり。)

### 静的配信 (express.static `/static/plugins`) — ブラウザが実際に取得する資産

```
GET /static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.2331ca5e.js
  → HTTP 200 | application/javascript; charset=UTF-8 | 511393 bytes
GET /static/plugins/growilabs/growi-plugin-datatables/dist/assets/client-entry.db426607.css
  → HTTP 200 | text/css; charset=UTF-8 | 42772 bytes
GET /static/plugins/growilabs/growi-plugin-theme-vivid-internet/dist/assets/style-F9B3H2Cc.css
  → HTTP 200 | text/css; charset=UTF-8 | 5814 bytes
GET .../does-not-exist.js → 存在しない資産はフォールスルー (静的配信は実ファイルのみ返す)
```

## 判定: PASS

インストール → 永続化/種別判定 → サーバ側走査 (template) / メタデータ生成 (theme) →
SSR 注入 (script) → 静的配信 → ブラウザ取得、の全経路が本番 ESM 出力で機能する。
ESM 移行は外部プラグインの導入経路を退行させていない。

## 後片付け

- smoke 用アクセストークン (`description:"esm-plugin-smoke"`) は削除済み。
- in-process プローブファイルは削除済み。ソースツリー変更なし。
- インストールした 3 プラグイン (`growiplugins` 3 件 + `apps/app/tmp/plugins/growilabs/*`) は
  結果確認用に残置。除去する場合は管理 API の DELETE もしくは
  `growiplugins` ドキュメント + `tmp/plugins/growilabs/{datatables,theme-vivid-internet,templates-for-marketing}` を削除。
