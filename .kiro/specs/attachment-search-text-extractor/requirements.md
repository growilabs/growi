# Requirements Document

## Project Description (Input)

### 問題

GROWI monorepo には添付ファイル (PDF / Office / テキスト系) から構造化されたテキストを取り出す能力が存在しない。全文検索機能 (下流の `attachment-search-indexing` / `attachment-search-ui`) を実現する前提として、対応形式のバイト列を受け取ってページ / スライド / シート単位に分割した Markdown テキストを返す独立マイクロサービスが必要である。

### 現状

- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない。ただし「`apps/` に置く Node のマイクロサービス + OpenAPI から orval で作る生成クライアント」という形の前例になる
- Office 系を Markdown に変換するライブラリ (`@firecrawl/anydoc`。Rust の核を npm のビルド済みネイティブ部品として配る) と、PDF からページ単位でテキストを取り出す部品 (PDFium を WebAssembly にした `@embedpdf/pdfium`) が npm から利用可能 (選定の理由は [research.md](./research.md) の §1「決定事項」と §2「採用理由と根拠」)
- 要件を満たす既製の抽出 REST API の image は存在しない (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

### 達成したい姿

- 添付ファイルのバイト列を HTTP multipart で受け取り、ページ / スライド / シート単位に分割した Markdown テキストを JSON で返す独立マイクロサービスが存在する
- サービスはステートレスで、k8s の共有 Deployment として運用でき、OSS docker-compose でも同梱できる
- 外部バイナリ・ネットワーク egress を要求せず、npm から取得できる部品 (ビルド済みのネイティブ部品と WebAssembly を含む) だけで完結する
- 悪意ある大容量 / 細工された / ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限 / 展開量などの上限) が組み込まれている
- 日本語の添付を検索で見つけられる形のテキストを返す (抽出時に入る語の途中の空白・改行を残さない)
- Image サイズは 400MB 以下に収まる
- 経路の定義から作る OpenAPI の文書を、下流の生成クライアント (`packages/attachment-text-extractor-client`) の入力として書き出せる
- monorepo のほかの部分と同じ言語 (TypeScript) と道具 (pnpm / turbo / vitest / biome) で保守できる

### アプローチ

`apps/attachment-text-extractor/` (`@growi/attachment-text-extractor`) に Node.js 24 + Hono (`@hono/node-server`) の独立サービスを置く。`apps/pdf-converter` と同じく pnpm workspace の一員とし、専用の CI workflow と、`pnpm deploy --prod` で本番の依存だけを取り出す multi-stage の Dockerfile を持つ。抽出エンジンは research.md §1「決定事項」の決定 (Office 系は anydoc、PPTX はスライドごとに分けてから anydoc、PDF は `@embedpdf/pdfium`、テキスト系はサービス自身で処理) に従い、詳細は design で定める。位置情報は PPTX はスライド単位、XLSX はシート単位、PDF はページ単位、その他形式は単一要素で扱う。変換はリクエストごとの子プロセスで行い、子には util-linux の `prlimit` で上限を掛ける。Dockerfile は `node:24-slim` 系の multi-stage、非 root (uid 10001) 実行、セキュリティハードニング (read-only rootfs / capabilities drop / egress 遮断) に対応する。

### スコープ

- **In**: `apps/attachment-text-extractor/` ディレクトリ全体 (package 設定 / src / テスト / scripts / ベンチマーク / Dockerfile / 運用者向けの文書 `docker/README.md` / `AGENTS.md`) / Hono アプリ (`POST /extract` multipart、`GET /healthz`、`GET /readyz`、`GET /openapi.json`) / 形式別の変換と形式の対応表 / リソース保護 / 日本語テキストの正規化 / API のスキーマ / 経路の定義から作る OpenAPI の文書とその書き出し / docker-compose エントリ / 専用 CI workflow (`.github/workflows/ci-attachment-text-extractor.yml`) / サービス単体テスト
- **Out**: GROWI 側統合 (AttachmentService ハンドラ登録、ES インデックス化、生成クライアントを使う側の実装、検索結果 UI、管理画面、抽出失敗ログの Mongo 永続化等) は下流 spec の責務。k8s の manifest の例は持たない (動かすときに守る条件は `docker/README.md` に文章で書く)。画像 OCR / 音声動画文字起こし / YouTube / Azure DI / ZIP 再帰展開 / Docling 等の高精度抽出 / Outlook MSG は本 spec のスコープ外

### 制約

- **ランタイム / 言語**: Node.js 24 + TypeScript。monorepo のほかの部分と同じ
- **ライセンス**: 依存は MIT / Apache-2.0 / BSD / ISC などの許容的なライセンスのみ採用 (GPL / AGPL / LGPL 系は禁止)
- **Image size 目標**: 400MB 以下
- **メモリ**: 1 件の変換の最大メモリは入力によって大きく変わる。コンテナのメモリ上限 (2Gi) は、1 件の変換に許すメモリの上限と同時実行数から design で定める
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること
- **互換性**: API 契約 (`ExtractResponse.pages[]` 構造) は破壊的変更を避ける。変更時は下流 spec (`attachment-search-indexing`) の再検証を要する
- **upstream 依存リスク**: anydoc は 0.x 系で公開から日が浅い。版を固定し、出力の契約テストで更新時の変化を検知する

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は、GROWI の添付ファイル全文検索機能 (umbrella `attachment-search`) を 3-way split した結果のうち、**添付ファイルからテキストを抽出する Node.js マイクロサービス**単体を対象とする。`apps/attachment-text-extractor/` 配下の Hono アプリケーション、Dockerfile、運用者向けの文書、OpenAPI の書き出し、CI を一つの閉じた成果物として完成させる。

抽出サービスは純粋に「バイト列 → `pages[]` 構造の Markdown テキスト」への変換のみを責務とする。形式判定、形式別の位置情報抽出 (PDF ページ / PPTX スライド / XLSX シート)、リソース保護 (サイズ / タイムアウト / 同時実行)、外部 egress 遮断下での動作、コンテナのセキュリティハードニング、OpenAPI の文書の書き出し、コードの構成が本 spec の範囲である。

GROWI 本体 (apps/app) との統合、生成クライアントの利用、Elasticsearch インデックス化、検索結果 UI、管理画面は下流 spec (`attachment-search-indexing` / `attachment-search-ui`) の責務であり、本 spec には含めない。本 spec が安定した API 契約と Docker image を提供することで、下流 spec が並行して開発可能となる。

**技術名を要件に書いている理由**: Req 5〜7 は実行基盤 (Node.js、Hono、`@firecrawl/anydoc`)、コードの構成、OpenAPI の作り方を要件として定める。monorepo と同じ言語と道具で保守できることが、このサービスの形を決めた理由そのものだからである。後のレビューでこれらを「実装の詳細」として取り除かないこと。

## Boundary Context

- **In scope**:
  - `apps/attachment-text-extractor/` 配下の Hono アプリケーション実装
  - PDF / DOCX / XLSX / PPTX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter Notebook / 旧形式 Office (DOC / XLS / PPT) / OpenDocument (ODT / ODS / ODP) に対応する形式別の変換
  - 位置情報付き `pages[]` 構造の返却 (PDF = ページ / PPTX = スライド / XLSX = シート、その他は単一要素)
  - 返却テキストの正規化 (改行コードの統一、日本語の語の途中に入った空白・改行の除去)
  - リソース保護 (最大ファイルサイズ / タイムアウト / 同時実行上限 / 細工ファイルの上限) と、1 件の異常終了を他のリクエストに波及させない隔離
  - 外部 egress 遮断下での動作と、外部バイナリを要しない依存 (例外は util-linux の `prlimit`。AC 1.7 の注記)
  - API のスキーマ (`ExtractResponse` / `PageInfo` / `ErrorResponse` / `ErrorCode`) と API 契約
  - Dockerfile (multi-stage、非 root、セキュリティハードニング対応) と、動かすときに守る条件を理由つきで書いた運用者向けの文書 (`docker/README.md`)
  - docker-compose エントリ (OSS 配布向け)
  - 経路の定義から作る OpenAPI の文書と、その書き出し (`scripts/export-openapi.ts` → `packages/attachment-text-extractor-client/openapi.json`)、書き出した文書と commit 済みの文書の食い違いの検査。文書が変わったときの生成クライアントの作り直しと、それに合わせる apps/app の呼び出し側の名前と型の書き方の修正 (Req 7)
  - 専用 CI workflow (lint / 型の検査 / vitest / image の確認)
  - サービス単体テストと、検索の品質のベンチマーク
- **Out of scope**:
  - apps/app 側の統合実装 (AttachmentService ハンドラ登録、抽出結果の ES 取り込み、失敗ログ Mongo 永続化、検索クエリの multi-index 集約、admin API、検索結果 UI、添付ファイル一覧モーダル、管理画面拡張)。例外は Req 7.4 の呼び出し側の名前と型の書き方の修正
  - `packages/attachment-text-extractor-client` の orval の設定 (`orval.config.js`) と、生成クライアントを使う側の振る舞い
  - k8s の manifest の例と、本番の環境への適用
  - 画像 OCR / 音声動画文字起こし / YouTube 取り込み / Azure Document Intelligence / ZIP 再帰展開 / Docling 等の高精度抽出
  - Outlook MSG
  - Elasticsearch / MongoDB への直接アクセス (サービスはステートレス、DB 依存ゼロ)
- **Adjacent expectations**:
  - 採用する部品 (research.md §1「決定事項」) が、対象プラットフォーム (linux x64 / arm64) 向けのビルド済みのネイティブ部品、または WebAssembly として npm から取得可能である
  - 実行用の image (`node:24-slim` 系、Debian の util-linux) に `/usr/bin/prlimit` が入っている
  - Docker / Kubernetes のランタイム (cgroups v2 / seccomp / NetworkPolicy 対応 CNI) が前提
  - 下流 spec (`attachment-search-indexing`) は本 spec が書き出す OpenAPI の文書を入力として orval で生成クライアントを作り、HTTP multipart で `POST /extract` を呼ぶ

## Requirements

### Requirement 1: 添付ファイルからのテキスト抽出

<!-- derived from umbrella Requirement 1 -->

**Objective:** 抽出サービスの利用者 (下流の GROWI apps/app と将来のクライアント) として、対応形式の添付ファイルから構造化されたテキストを取り出したい。なぜなら、全文検索のインデックスへの投入と、ページ / スライド / シート単位の位置の表示を可能にするから。

#### Acceptance Criteria

1. When 対応形式の添付ファイルが抽出サービスに渡される, the 抽出サービス shall 抽出結果を `pages` 配列 (各要素は `pageNumber` / `content` / `label`) として返却する <!-- derived from umbrella R1.1 -->
2. When PPTX ファイルが抽出サービスに渡される, the 抽出サービス shall スライド単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にスライド番号表示文字列を設定する <!-- derived from umbrella R1.2 -->
3. When XLSX ファイルが抽出サービスに渡される, the 抽出サービス shall シート単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にシート名を設定する <!-- derived from umbrella R1.3 -->
4. When PDF ファイルが抽出サービスに渡される, the 抽出サービス shall ページ単位で `pages` 配列を返却し、各要素の `pageNumber` にページ番号を、`label` にページ番号表示文字列を設定する <!-- derived from umbrella R1.4 -->
5. When DOCX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (`.txt`, `.log`, `.md`) / RTF / EPub / Jupyter Notebook のいずれかが抽出サービスに渡される, the 抽出サービス shall 単一要素の `pages` 配列を返却し、`pageNumber` と `label` を null とする <!-- derived from umbrella R1.5 -->
6. If サポート対象外の形式が抽出サービスに渡される, the 抽出サービス shall 抽出を行わず、サポート対象外を示すエラーコードを返却する <!-- derived from umbrella R1.6 -->
7. The 抽出サービス shall 運用環境で外部バイナリおよびネットワーク egress を要求せずに動作する <!-- derived from umbrella R1.7 -->
8. When 旧形式 Office (DOC / XLS / PPT) または OpenDocument (ODT / ODS / ODP) のファイルが抽出サービスに渡される, the 抽出サービス shall 単一要素の `pages` 配列を返却し、`pageNumber` と `label` を null とする
9. The 抽出サービス shall 返却する各 `content` の改行コードを LF に揃え、抽出処理によって日本語の文字 (ひらがな・カタカナ・漢字) の間に入った 1 文字分の空白または改行を取り除く
10. If 暗号化またはパスワード保護されたファイルが抽出サービスに渡される, the 抽出サービス shall 抽出を行わず、暗号化を示すエラーコードを返却する
11. If 構造が壊れていて意味のあるテキストを取り出せないファイルが抽出サービスに渡される, the 抽出サービス shall 抽出失敗を示すエラーコードを返却する
12. When 編集や印刷の権限だけが制限され、開くのにパスワードを必要としない PDF (オーナーパスワードのみ設定された PDF) が抽出サービスに渡される, the 抽出サービス shall これを 1.10 の暗号化ファイルとして扱わず、1.4 のとおりページ単位で抽出する

**1.7 の「外部バイナリ」の読み方**: 1.7 が防ぐのは、ffmpeg や exiftool のような変換用の外部ツールを image に足すことである。子プロセスに上限を掛けるために util-linux の標準コマンド `prlimit` で子を包むことは、外部バイナリを要求することに当たらない (ユーザー承認済み。5.8)。`prlimit` が元の image に入っていることは、image のビルド・CI・起動時の `/readyz` の 3 か所で確かめる (design.md §配布物と CI)。

**自動テストで検証できない残存ギャップ**: 抽出の質 (表の構造、読み順) は文字の一致と検索の品質のベンチマーク (research.md §4.1) でしか見ておらず、PPTX の一部で anydoc が行の順番を入れ替えることは自動では捕まえられない。anydoc の文書化されていない挙動 (PPTX の分割、XLSX の目印) は、版を固定した契約テストでしか守られていない。ベンチマークは 23 文書の小さな作ったコーパスで、Word や PowerPoint から書き出した PDF、スキャンした PDF、フォントを埋め込んでいない PDF は入っていない。既知の制約: PowerPoint の自動代替テキストと同じ形 (半角空白ちょうど 2 つ + 決まり文) で作者が打った行は消える。`.csv` に `application/vnd.ms-excel` の MIME が付くと XLS として扱われ、1.11 のエラーになる。BOM のない UTF-16 は判定できない。1.2 と 1.4 の「番号表示文字列」は番号だけの文字列 (例: `"3"`) で、「スライド」「p.」などの文言は UI 側で付ける。1.7 の「外部バイナリと外向き通信なしで動く」ことは、CI が image を `--network none` で起動して PDF と DOCX を抽出することで確かめている (research.md §4.13)。

### Requirement 2: 抽出処理のリソース保護と隔離

<!-- derived from umbrella Requirement 2 (AC 2.1, 2.2, 2.3, 2.6 のみ。2.4/2.5 は apps/app 側責務として attachment-search-indexing spec へ) -->

**Objective:** SRE / 抽出サービスの運用者として、悪意ある大容量の添付や壊れたファイルが抽出サービスを不安定にしないよう、抽出処理に上限と隔離を設けたい。なぜなら、サービス全体の可用性と、テナント間の公平さを保つから。

#### Acceptance Criteria

1. If 添付ファイルサイズが設定された上限を超える, the 抽出サービス shall 抽出を行わず、ファイルサイズ超過を示すエラーコードを返却する <!-- derived from umbrella R2.1 -->
2. If 抽出処理が設定されたタイムアウトを超える, the 抽出サービス shall 当該リクエストを打ち切り、タイムアウトを示すエラーコードを返却する <!-- derived from umbrella R2.2 -->
3. While 抽出サービスが設定された同時リクエスト上限に達している, the 抽出サービス shall 以降のリクエストを受理せず、サービスビジーを示すエラーコードを返却する <!-- derived from umbrella R2.3 -->
4. The 抽出サービス Pod / コンテナ shall 外部ネットワーク egress が遮断された状態で正常動作する <!-- derived from umbrella R2.6 -->
5. When 抽出処理がタイムアウトにより打ち切られる, the 抽出サービス shall 当該抽出処理の実行そのものを停止し、その処理が使っていた同時実行の枠とメモリを解放する (応答だけ返して処理を継続させない)
6. If 展開後のサイズ、XML の入れ子の深さ、要素数などが設定された上限を超えるファイルが渡される, the 抽出サービス shall 抽出を打ち切り、上限超過を示すエラーコードを返却する
7. If 1 件の抽出処理が異常終了する (ライブラリ内部の想定外エラーやプロセスの異常終了を含む), the 抽出サービス shall そのリクエストにエラーコードを返却し、他のリクエストの処理を継続する
8. If CSV / TSV または HTML のファイルサイズが、形式ごとに設定された上限を超える, the 抽出サービス shall 変換用の子プロセスを起動せず、上限超過を示すエラーコードを返却する
9. When 呼び出し側が抽出処理の途中で接続を切る, the 抽出サービス shall 当該抽出処理の実行そのものを停止し、使っていた同時実行の枠とメモリを解放する

**自動テストで検証できない残存ギャップ**: k8s (cgroup v2) の既定では、コンテナがメモリの上限に達すると抽出サービス全体が止まり、2.7 の「他のリクエストを継続する」は成り立たない。これは親の RSS 監視で上限の手前で止めることに頼っており、実際のクラスタでは確かめていない。2.8 の大きさの上限は早めに断るためのもので、通ることの保証ではない (小さな CSV や異常な HTML でも RSS の上限で止まる)。同じく `MAX_XLSX_CELLS` のセル数の検査も早めに断るためのもので、すり抜ける形があり、守りの境界は RSS の上限である (research.md §4.11)。2.3 は、1 つの接続に 2 件続けて送ると、1 件目の変換中に 2 件目が枠を取りに行くので、枠が 1 つのときは 2 件目が 503 になる (apps/app はこの送り方をしない)。2.4 は、CI が外向き通信を遮断したコンテナで抽出を確かめている (research.md §4.13)。

### Requirement 3: デプロイメントとセキュリティハードニング

<!-- derived from umbrella Requirement 13 (AC 13.1, 13.2, 13.3, 13.5 のみ。13.4 は apps/app 側責務として attachment-search-indexing spec へ) -->

**Objective:** GROWI の配布者 (OSS / GROWI.cloud) として、抽出サービスを既存の配布の仕組み (docker-compose / k8s) に加え、セキュリティの設定を強制した形で運用したい。なぜなら、既存の運用者が導入する手間を抑えつつ、コンテナからの脱出や外部通信による情報漏洩の危険を減らすから。

#### Acceptance Criteria

1. The OSS docker-compose 配布 shall 抽出サービスを単一コンテナとして同梱し、既存の compose 体系に追加する <!-- derived from umbrella R13.1 -->
2. The GROWI.cloud (k8s) 配布 shall 抽出サービスを共有 Deployment として提供し、負荷に応じて HPA により自動スケールする <!-- derived from umbrella R13.2 -->
3. The 抽出サービスの運用者向けの文書 (`apps/attachment-text-extractor/docker/README.md`) shall read-only root filesystem、非 root 実行、capabilities drop、network egress 遮断、tmpfs ベースの一時領域 (必要な場合) を推奨設定として、それぞれ理由を付けて提供する <!-- derived from umbrella R13.3 -->
4. The 抽出サービス shall 状態を持たず (ステートレス)、任意のレプリカ数でスケール可能である <!-- derived from umbrella R13.5 -->

**自動テストで検証できない残存ギャップ**: k8s の manifest は持たないので、3.2 の共有 Deployment と自動スケールの設定は、運用者が `docker/README.md` の条件から書く。そこにある CPU の requests / limits と自動スケールの値は出発点で、測った値ではない。CI は image のビルド、大きさ、read-only rootfs・uid 10001・ネットワークなしでの起動、`/readyz`、PDF と DOCX の抽出を確かめている (research.md §4.13)。確かめていないのは、`docker compose build` と `up` (compose の healthcheck、`/tmp` の tmpfs、`pids_limit` を含む)、linux-arm64 の image、展開した image の大きさ、本物のオーケストレーターの下での動き (確認、入れ替え、停止の猶予) である。

### Requirement 4: マルチテナント隔離

<!-- derived from umbrella Requirement 14 (AC 14.2, 14.3 のみ。14.1/14.4/14.5 は apps/app / ES index 側責務として attachment-search-indexing / attachment-search-ui spec へ) -->

**Objective:** GROWI.cloud の運用者として、抽出処理が共有基盤の他のテナントに影響しないよう分離したい。なぜなら、共有の ES クラスタに抽出の負荷が集中することと、特定のテナントが他のテナントの抽出を止めてしまうことを防ぐから。

#### Acceptance Criteria

1. The 添付テキスト抽出処理 shall 共有 Elasticsearch クラスタの ingest ノード上では実行しない <!-- derived from umbrella R14.2 -->
2. While あるテナントからの抽出要求が集中している, the 抽出サービス shall 設定された全体同時実行上限により、他テナントの抽出要求を完全停止させない <!-- derived from umbrella R14.3 -->

**自動テストで検証できない残存ギャップ**: 4.1 は、抽出が独立したサービスとして配備されることを静的に確かめるだけで、振る舞いのテストは無い。4.2 は 1 つのコンテナにつき `MAX_CONCURRENCY` の枠で守る。テナントごとの公平さ (特定のテナントが枠を使い続けること) は扱わない。

### Requirement 5: 実行基盤の制約

**Objective:** 抽出サービスの保守担当として、サービスが monorepo のほかの部分と同じ言語と道具で書かれていてほしい。なぜなら、言語を揃えると、別の道具と別の CI を保守し続ける手間が無くなるから。

#### Acceptance Criteria

1. The 抽出サービス shall Node.js 上で動き、HTTP の受け口に Hono (`@hono/node-server`) を使う
2. The 抽出サービス shall Office 系の変換に npm の `@firecrawl/anydoc` を版 0.2.4 に固定して使い、版を上げるときは版を固定した契約テスト (PPTX の分割、XLSX の目印、XLS の形式名、例外の分類) が通ることを条件にする
3. The 抽出サービス shall apps/app のプロセスの中では動かず、独立したコンテナとして動く
4. The 抽出サービス shall 依存を MIT / Apache-2.0 / BSD / ISC などの許容的なライセンスのものだけにし、GPL / AGPL / LGPL のものを含めない
5. The 抽出サービス shall anydoc の OCR を使わず (文書を外部に送る `hosted` を指定しない)、外向き通信なしで動く
6. The 抽出サービス shall Node.js 以外の言語の実行環境を含まない
7. The 抽出サービス shall Bun / Deno では動かすことを前提にしない (Node.js だけを対応する実行環境とする)
8. The 抽出サービス shall 子プロセスに上限を掛けるために、util-linux の標準コマンド `prlimit` を使ってよい。それ以外の外部コマンドは使わない (AC 1.7 の読み方)

### Requirement 6: コードの構成

**Objective:** 抽出サービスを次に変える開発者として、各ファイルの役割が 1 つで、どこに何があるかがすぐ分かってほしい。なぜなら、同じ言語に揃えた目的は保守しやすくすることであり、構成が悪ければその目的が果たせないから。

#### Acceptance Criteria

1. The 抽出サービスのソースコード shall 1 つのファイルに 1 つの責務だけを持たせ、`.claude/rules/coding-style.md` の上限 (1 ファイル 800 行、1 関数 50 行の目安) に収める
2. The 抽出サービスのソースコード shall 変換と正規化の処理を、HTTP と子プロセスの仕組みを知らない純関数として切り出し、子プロセスを使わずに単体テストできるようにする
3. The 抽出サービスのソースコード shall 層の依存を一方向にする (変換の層は、子プロセスを管理する層と HTTP の層を import しない。子プロセスを管理する層は HTTP の層を import しない)
4. The 抽出サービスのソースコード shall 層の外から呼ばれるディレクトリにだけ barrel (`index.ts`) を置き、そこから外の呼び出し元が使うものだけを export する。barrel を置くと要らない部品まで読み込まれるディレクトリには、barrel を置かない (理由は design.md §層の分け方の判断 6)
5. The 抽出サービスのソースコード shall 失敗の種類から `ErrorCode` と HTTP ステータスへの対応を 1 か所の表にまとめ、失敗の種類の追加漏れを型の検査で見つけられるようにする
6. The 抽出サービスのソースコード shall named export を使い、ログには `console.log` ではなくロガーを使う

### Requirement 7: OpenAPI の文書と生成クライアント

**Objective:** 抽出サービスと下流の apps/app の開発者として、OpenAPI の文書が経路の定義から自動で作られ、文書のための設定や書き写しを持たずに済んでほしい。なぜなら、文書を作る仕組みが単純で、書く設定が少ないほど、経路と文書が食い違いにくく、保守しやすいから。

#### Acceptance Criteria

1. The 抽出サービス shall `GET /openapi.json` と書き出しの手順で出す OpenAPI の文書を、経路の定義と、その横に書いたスキーマから作る。文書そのものを手で書いたファイルとして持たない。操作の名前 (`operationId`) とスキーマの名前は、文書を作る道具の既定に従う。文書は、操作 (`POST /extract`、`GET /healthz`、`GET /readyz`)、`POST /extract` に渡す項目 (`file` は必須、`mimeType` は任意)、`POST /extract` の成功とエラーの応答の項目と型、`ErrorCode` の 8 つの値を載せる
2. When 文書から orval で生成クライアントを作り直す, the 生成クライアント shall `POST /extract` に渡す項目の名前と必須かどうか、成功とエラーの応答の型、`ErrorCode` の値を、文書のとおりに持つ。関数名と型名は文書の名前から決まる
3. The CI shall 抽出サービスが出力する OpenAPI の文書と、commit 済みの `openapi.json` が JSON として食い違ったら失敗する
4. When 経路の定義かスキーマの変更で文書が変わる, the 変更作業 shall commit 済みの `openapi.json` と生成クライアントを同じ変更で作り直し、apps/app の呼び出し側 (`attachment-text-extractor.ts` とそのテスト) を、名前の置き換えと項目の型に合わせる型の書き方の修正の範囲で直す。`POST /extract` に渡す項目の名前、応答の型、`ErrorCode` の値が変わる場合は、下流 spec (`attachment-search-indexing`) の見直しを要する (design.md §Revalidation Triggers)
5. When 生成クライアントの関数名と型名が変わる, the 変更作業 shall 変わる前と変わった後の名前の対応を research.md に記録する
6. The 文書を作る仕組み shall 名前や並び順をほかの文書に合わせるための指定と、作った文書を後から書き換える処理を持たない。文書のためだけに書く設定は、文書の題名・説明・版と、OpenAPI が必須にしている応答の説明にとどめる
