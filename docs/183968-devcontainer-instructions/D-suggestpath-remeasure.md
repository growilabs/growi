# dev container 側 Claude への指示書 [D]: suggestPath トップN命中率の再計測（改修後）

このファイルは自己完結している。inner wiki / 会話履歴 / Redmine を見る必要はない。

前提:
- [A] import バグ修正検証済み ✅
- [C] dev wiki データをローカル GROWI に import 済み・ES 再構築済み・6 ケースの正解パスが
  ローカル ES でヒット確認済み ✅（`C-import-dev-wiki-and-verify-result.md`）。

## ゴール

**改修後プロンプト**（このブランチに含まれる `analyze-content.ts` のキーワード抽出プロンプト
変更 = commit `4e157f9`）が乗ったローカル GROWI に対し、**ベースライン #183967 と同条件**で
suggestPath を 6 ケース × 10 回叩き、**(B) 正親配下出現率**を再計測する。ベースライン値と
並べて Before/After を出すための「After」を作るのが [D]。

## なぜ API 直叩きでよいか（MCP と等価）

ベースライン #183967 は `growi_suggestPath`（MCP ツール）経由で測ったが、MCP は GROWI 本体の
`POST /_api/v3/ai-tools/suggest-path` を叩く薄いラッパーにすぎない。API は内部で
`generateSuggestions(user, body, userGroups, searchService)` を呼ぶ — **MCP が叩くのと完全に
同じ関数・同じ改修後プロンプト・同じ ES**。経路が違うだけで結果は等価。中間層を挟まない分
API 直叩きの方が条件がブレない。

## 事前確認（着手前にこの3点を必ずチェック）

1. **ブランチが最新で改修後プロンプトが乗っているか**
   ```bash
   git pull   # permission error が出たら: sudo chown -R vscode:vscode .git
   grep -n "subject and purpose of the content" apps/app/src/features/ai-tools/suggest-path/server/services/analyze-content.ts
   # → ヒットすれば改修後プロンプトが乗っている（commit 4e157f9）
   ```

2. **データが残っているか**（[C] の環境は揮発しうる — mongo は匿名ボリューム）
   ```bash
   curl -s "http://localhost:3000/_api/search?q=プレゼンテーション&limit=5" | python3 -c "import sys,json;d=json.load(sys.stdin);print('hits:',d.get('meta',{}).get('total'))"
   # → 0 や接続エラーなら [C] の環境が消えている。C-import...-result.md の手順
   #   （新規インストール → apps/app/tmp/devwiki-patched.zip を再 import → ES rebuild）で復旧してから [D] へ。
   ```

3. **AI 機能が有効か**（suggestPath は `certifyAiService` で守られている）
   - ローカル GROWI の AI 設定（OpenAI/Azure の API キー、AI 有効化）が入っていること。
   - 入っていないと suggestPath が AI 無効で弾かれる。[C] の import 前後で設定が飛んでいたら
     再設定が要る。**API キー未設定なら「計測不可」と報告して止まる**（勝手にダミーで埋めない）。

## 計測条件（ベースライン #183967 と固定で揃える）

| 項目 | 値 |
|---|---|
| 対象 | ローカル GROWI `http://localhost:3000`（dev wiki データ import 済み） |
| 呼び出し | `POST /_api/v3/ai-tools/suggest-path`、body `{ "body": "<本文>" }` |
| 認証 | admin セッション cookie（`admin` / `GrowiDevAdmin2026`）、または apiToken を発行して `?access_token=`（このルートは `acceptLegacy: true`） |
| 入力本文 | 下記6ケースの固定本文（**改変しない**。ベースライン・#183966 検証と同一） |
| 試行回数 | 各ケース **10 回**（計 6 × 10 = 60 コール）。LLM 非決定性のため |
| 指標 | **(B) 正親配下出現率** = 返却候補（**`type==='memo'` の枠は除外**）のいずれかの `path` が、正解パス（下表）と一致 **または その配下**（`startsWith`）か。10 回中 M 回で表記 |
| 補助指標 | (A) 厳密一致（正解パスと完全一致）も一応記録。ただしベースライン同様ほぼ常に 0 になる想定（suggestPath は実在ページのフルパス or top-level category を返し、親パスそのものは返さないため） |

> **memo 枠の除外**: `generateSuggestions` は常に先頭へ `type: 'memo'` の個人 memo 候補を入れる
> （`generateMemoSuggestion`）。これは内容非依存の定数枠なので、ベースライン同様 **命中判定から
> 除外**する（`type` が `search` / `category` の候補だけで (A)(B) を判定）。

## 正解パス（[C] でローカル ES 実在を確認済み・表記揺れ補正済み）

(B) 判定はこのパス（またはその配下）に候補が `startsWith` で一致するかで見る。

| ユースケース | 正解パス | ベースライン (B) |
|---|---|---|
| opentelemetry | `/資料/開発ガイドライン/ADR - Architecture Decision Record/OpenTelemetry 出力/` | 10/10 |
| collaborative-editor | `/資料/内部仕様/ビルトインエディタでの同時多人数編集/` | 5/10 |
| presentation | `/資料/内部仕様/プレゼンテーション/` | 5/10 |
| news-inappnotification | `/資料/内部仕様/InAppNotificationにニュースを配信する/` | 1/10 |
| auto-scroll | `/資料/外部仕様/アンカーによるページのScroll/` | 0/10 |
| oauth2-email-support | `/Tips/開発用のミドルウェア追加/SMTPサーバー (ローカル環境&ローカル環境以外)/` または `/Tips/GoogleOAuth設定方法/` | 0/10 |

> 判定実装の注意:
> - 正解パスは末尾スラッシュ付きの「親」表現だが、suggestPath が返す候補は末尾スラッシュ付きの
>   ことが多い。比較は両者を末尾スラッシュ正規化してから `候補.startsWith(正解)` で行う
>   （= 正解ページそのもの、または正解配下にある候補を命中とする）。ベースライン定義に忠実に。
> - oauth2 は正解候補が2つある。どちらかに `startsWith` で当たれば命中（ベースラインで両方が
>   「正親」側として扱われていたため）。

## 入力本文（6ケース・固定・改変禁止）

### 1. auto-scroll
```
GROWI のハッシュベース自動スクロール機構（auto-scroll）の実装仕様。 URL にフラグメントハッシュ（例: `#section-title`）を含めてページを開いたとき、レンダリングされたコンテンツ内の対応する要素までスクロールする仕組みを定義する。GROWI のページには遅延レンダリングされる要素（Drawio 図、Mermaid チャート、PlantUML 画像、lsx によるページリスト等）が含まれ、初回描画のあとにレイアウトシフトを引き起こすため、レンダリング中であることを検出して再スクロールで補正する必要がある。 このフックはページ種別に依存しない設計とし、Markdown コンテンツとハッシュ可能なコンテナを持つあらゆるビュー（PageView、検索結果プレビュー等）で動作する。 主な構成要素: useHashAutoScroll（PageView 向けのハッシュベース自動スクロールフック）、useKeywordRescroll（SearchResultContent 向けのキーワードハイライトスクロールフック。検索ページは URL ハッシュを持たないため、ハイライト要素へスクロールしつつ非同期レンダラのレイアウトシフトを補正する）、watchRenderingAndReScroll（レンダリングステータス属性を監視し、完了またはタイムアウトまで周期的に再スクロールする共有純関数）。レンダリングステータス属性プロトコルとして data-growi-is-content-rendering を @growi/core の共有定数で定義し、DrawioViewer / MermaidViewer / PlantUmlViewer / Lsx がライフサイクルに従って値をトグルする。設計上のポイント: ターゲット監視→レンダリング監視の2フェーズを順に実行。レンダリング監視は初回スクロール後に開始し、非同期レンダラを MutationObserver で検出する。ポーリングタイマは非リセット方式でスターベーションを防ぎ、10 秒のハードタイムアウトで自動終了する。このフィーチャーはブラウザの DOM レイヤのみで完結し、サーバ通信を持たない。
```

### 2. collaborative-editor
```
GROWI のリアルタイム同時編集機構（collaborative-editor）の内部実装仕様。 GROWI は Yjs（CRDT）を用いたリアルタイム同時編集を提供し、複数ユーザーが同一の wiki ページを同時に編集して自動的に競合解決する。トランスポート層には y-websocket をネイティブ WebSocket 上で用い、ドラフト状態を MongoDB に永続化し、awareness／presence イベントを Socket.IO 経由で非エディタ系 UI コンポーネントへ橋渡しする。 スコープ: サーバ側 Yjs ドキュメント管理（1 ページにつきサーバ側 Y.Doc を必ず 1 つに保ち、同時接続・初期化競合・再接続時の同期を保証）、WebSocket トランスポート（y-websocket と WebsocketProvider を既存 Socket.IO サーバと同一 HTTP サーバ上で共存、resyncInterval による定期再同期）、認証・認可（WebSocket 接続を既存セッション基盤で認証し閲覧権限のあるユーザーのみアクセス）、MongoDB 永続化（ドラフト状態を yjs-writings コレクションに保存）、awareness／presence（編集中ユーザーとカーソル位置を Socket.IO ルーム経由で非エディタ UI へ反映）。 非スコープ: Yjs ドキュメントモデル自体、CodeMirror 統合の詳細、ページ保存・リビジョンロジック、Yjs 以外の Socket.IO イベント基盤。 サーバ側は Express アプリ／Socket.IO サーバ／WebSocket サーバを同一 HTTP サーバに同居させ、Upgrade ハンドラで認証、Connection ハンドラで接続管理、Document Manager（getYDoc）で単一 Y.Doc を保証する構成を取る。
```

### 3. news-inappnotification
```
GROWI の InAppNotification にニュース配信・表示機能を追加する内部実装仕様。 外部の静的 JSON フィード（GitHub Pages）を GROWI 本体が cron で定期取得し、ローカル MongoDB にキャッシュした上で、InAppNotification パネルおよび通知一覧ページにニュースとして表示する。 ニュースは既存の InAppNotification とは別モデル（NewsItem）として管理する。InAppNotification はユーザーアクション起因で関係者のみに配信される per-user ドキュメント設計だが、ニュースは全ユーザー（またはロール単位）に配信されるため、1 件のニュースを全ユーザーで共有する設計が効率的である。UI ではクライアント側で両データを時系列マージして統合表示する。 主な要件: ニュースフィードの定期取得（cron で配信元 URL から JSON を取得し externalId で重複排除して upsert、フィードから消えたアイテムは削除、取得失敗時はキャッシュ維持、news:isDeliveryEnabled が false ならスキップ、growiVersionRegExps で対象バージョンを絞り込む）、ローカルキャッシュ（NewsItem は externalId ユニークインデックス、publishedAt インデックス、fetchedAt の TTL インデックス、多言語タイトル・本文）、既読／未読管理（NewsReadStatus モデル）、ロール別表示制御（admin / general）、InAppNotification パネルに「すべて／通知／お知らせ」フィルタタブと無限スクロールを追加しデータ層を useMergedInAppNotifications カスタムフックに集約。 非スコープ: 管理者によるニュース作成・編集 UI、リアルタイムプッシュ、RSS/Atom 対応。
```

### 4. oauth2-email-support
```
GROWI に OAuth 2.0 認証による Google Workspace メール送信機能を追加する内部実装仕様。 管理者は、従来の SMTP パスワード認証の代わりに OAuth 2.0 認証情報（Client ID、Client Secret、Refresh Token）を用いて、Gmail API 経由でメール送信を構成できる。トークンベース認証によりセキュリティを高め、既存の SMTP / SES 構成との後方互換性を完全に維持する。 設定パラメータ: Email Address（認可された Google アカウントのメールアドレス）、Client ID / Client Secret（Google Cloud Console で発行）、Refresh Token（認可フローで取得）。実装は nodemailer 組み込みの Gmail OAuth 2.0 サポートを用い、トークンのリフレッシュは自動で処理される。 主な要件: 設定管理（管理画面のメール設定で SMTP / SES に並ぶ送信方式として OAuth 2.0 を提供。フォームは各認証情報を持ち全項目をバリデーションしシークレットは DB 保存前に暗号化、空値送信時は既存シークレットを保持）、メール送信（OAuth 2.0 構成時は nodemailer + Gmail OAuth 2.0 トランスポートで送信、全コンテンツ種別に対応、指数バックオフのリトライ）、トークン管理（トークンリフレッシュは nodemailer が自動処理しアクセストークンはメモリキャッシュ、設定更新時は S2S メッセージング経由でサービス再初期化）、管理 UI 統合（SMTP / SES と同一の UI パターンに従い送信方式切替時も認証情報を保持）。 非スコープ: Google 以外の OAuth 2.0 プロバイダ、SMTP からの移行ツール、Refresh Token 取得の認可フロー UI、マルチアカウント。
```

### 5. opentelemetry
```
GROWI の OpenTelemetry 統合をメンテナンスするための大局的な仕様（アーキテクチャ判断記録に相当）。 SDK ライフサイクル、Resource Attribute、Custom Metric、HTTP Anonymization の 4 レイヤがそれぞれ「何を担い、何を担わないか」を明文化し、新規メトリクスや anonymization handler の追加、SDK のバージョンアップ、設定キーの追加・改名といった将来のメンテナンス時に、本 spec を 1 か所の参照点として運用できる状態を目標とする。 本 spec は新規実装仕様ではなく、既に実装・稼働している features/opentelemetry/ の現状の責務境界をスナップショットとして固定化する性格を持つ。 4 レイヤの責務: Layer 1（SDK ライフサイクル）は NodeSDK の起動・有効化制御・Resource 2 段階初期化、otel:enabled と OTEL_SDK_DISABLED の整合化、Diag Logger の pino アダプタ。Layer 2（Resource Attribute）は identity 専用の Resource Attribute 供給。Layer 3（Custom Metric）は Custom Metric の emit と合成（application / user-counts / page-counts / system の 4 モジュール）。Layer 4（HTTP Anonymization）は HTTP リクエストの best-effort anonymization。 設計判断として、Resource Attribute／設定値／観測値／span attribute の責務分離を固定する。 非スコープ: 既存メトリクスの名称変更・再構成、Log Signal の利用開始、ブラウザサイドからの telemetry 出力、OTLP Exporter の wire 仕様。
```

### 6. presentation
```
GROWI のプレゼンテーション（スライド表示）機能（@growi/presentation パッケージ）の内部実装仕様。 本機能は frontmatter フラグを用いて wiki ページをスライドとして描画する。2 つの描画モードを持つ: GrowiSlides（slide: true）は ReactMarkdown による軽量スライド描画で、Marp コンテナのスタイルを事前抽出した CSS 定数で適用し Marp ランタイム依存を読み込まない。MarpSlides（marp: true）は @marp-team/marp-core を用いた本格的な Marp 描画で、必要なときだけ動的に読み込む。 本仕様の主眼は、重い Marp 描画依存を共通のスライド描画パスから切り離し marp: true のページでのみ読み込むことにある。 主な要件: モジュール分離（GrowiSlides は marp-core / marpit を読み込まず描画、Marp 依存は動的 import 境界の背後に隔離し非 Marp スライド閲覧時の JavaScript ペイロードを削減）、ビルド時 CSS 抽出（Marp ベース CSS をビルド時に事前抽出し定数ファイルをコミット）、機能的等価性（Marp / 非 Marp いずれのスライドページもインラインビューとプレゼンテーションモーダルの両方で正しく描画され挙動差が無い）、ビルド整合性。 非スコープ: useSlidesByFrontmatter フックの最適化、アプリ側遅延ロード機構の変更、Marp 描画ロジック自体の変更、marp-core 内部のサイズ削減。
```

## 実行方法（使い捨てスクリプト推奨）

`apps/app/tmp/` 配下（永続領域。`/var/tmp` は揮発するので使わない）に使い捨てスクリプトを作り、
60 コールを回して候補（type/path）を raw 記録する。要点:

- まず admin でログインしてセッション cookie を取得（or apiToken を `?access_token=` で使用）。
- 各ケース本文を `{ body }` で `POST /_api/v3/ai-tools/suggest-path` に投げる × 10 回。
- レスポンスの `suggestions` 配列から `type !== 'memo'` の候補だけ取り出し、`{type, path}` を記録。
- 各ケースについて (A) 厳密一致回数 / (B) 正親配下出現回数を 10 回中 M 回で集計。
- **全 60 コールの raw 候補（memo 枠を除いた type/path）を必ず残す**（第三者が辿れるよう。
  ベースラインページもそうしている）。

## 報告フォーマット

1. **事前確認**: 改修後プロンプト grep ヒット / データ残存 / AI 有効、の3点の結果。
2. **結果サマリー表**（ベースラインと並べる）:

   | ユースケース | ベースライン (B) | 改修後 (B) | 差分 | 改修後 平均候補数 |
   |---|---|---|---|---|
   | opentelemetry | 10/10 | ? | | |
   | collaborative-editor | 5/10 | ? | | |
   | presentation | 5/10 | ? | | |
   | news-inappnotification | 1/10 | ? | | |
   | auto-scroll | 0/10 | ? | | |
   | oauth2-email-support | 0/10 | ? | | |

3. **(A) 厳密一致**: 改修後も基本 0 のはずだが、もし非ゼロなら特記。
4. **全 60 コールの raw 候補**（memo 枠除外、type/path）。
5. **所感**: 特にベースラインで全滅だった auto-scroll / oauth2 / news が改善後に拾えるように
   なったか（=改修の主目的）。改善した／しなかったケースそれぞれ、候補にどんなパスが出たかの傾向。
6. 成功率（60/60 でエラー無しか）、引っかかった点・環境差。

## やらないこと（スコープ外）

- GROWI への結果記録（= [E]。ホスト側で baseline ページと並べて記録する）
- プロンプトの追加調整（命中率を見たうえでの次の改善は別タスク）
- dev wiki への書き戻し
