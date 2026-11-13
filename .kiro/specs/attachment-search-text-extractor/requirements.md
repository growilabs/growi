# Requirements Document

## Project Description (Input)

### 問題

GROWI monorepo には添付ファイル (PDF / Office / テキスト系) から構造化されたテキストを取り出す能力が存在しない。全文検索機能 (下流の `attachment-search-indexing` / `attachment-search-ui`) を実現する前提として、対応形式のバイト列を受け取ってページ / スライド / シート単位に分割した Markdown テキストを返す独立マイクロサービスが必要である。

### 現状

- GROWI monorepo には Python コードが存在せず、抽出ライブラリも未採用
- 既存マイクロサービス `apps/pdf-converter` は HTML → PDF 専用 (Puppeteer ベース) で、テキスト抽出には転用できない
- Office 系を Markdown に変換するライブラリと、PDF からページ単位でテキストを取り出すライブラリが PyPI から利用可能 (選定の理由は [research.md](./research.md) の §1「決定事項」と §2「採用理由と根拠」)
- 要件を満たす既製の抽出 REST API の image は存在しない (詳細は [../attachment-search/research-docker-image.md](../attachment-search/research-docker-image.md))

### 達成したい姿

- 添付ファイルのバイト列を HTTP multipart で受け取り、ページ / スライド / シート単位に分割した Markdown テキストを JSON で返す独立マイクロサービスが存在する
- サービスはステートレスで、k8s Deployment + HPA の共有サービス方式で運用でき、OSS docker-compose でも同梱できる
- 外部バイナリ・ネットワーク egress を要求せず、PyPI から取得できる Python パッケージ (ネイティブ拡張を含む wheel を含む) のみで完結する
- 悪意ある大容量 / 細工された / ハングを起こす添付に対するリソース保護 (最大サイズ / タイムアウト / 同時実行上限 / 展開量などの上限) が組み込まれている
- 日本語の添付を検索で見つけられる形のテキストを返す (抽出時に入る語の途中の空白・改行を残さない)
- Image サイズは 400MB 以下に収まる
- FastAPI の OpenAPI spec を下流 spec (`attachment-search-indexing`) の TS クライアント生成入力として export できる

### アプローチ

`services/attachment-text-extractor/` に Python 3.12 + FastAPI + Uvicorn の独立サービスを新設する。`services/` は本プロジェクトで新設されるトップレベルディレクトリで、**pnpm workspace / turbo pipeline の対象外** (`pnpm-workspace.yaml` / `turbo.json` は変更しない)。抽出エンジンは research.md §1「決定事項」の決定 (Office 系は firecrawl/anydoc、PPTX はスライドごとに分けてから anydoc、PDF は pypdfium2、テキスト系はサービス自身で処理) に従い、詳細は design で定める。位置情報は PPTX はスライド単位、XLSX はシート単位、PDF はページ単位、その他形式は単一要素で扱う。Dockerfile は `python:3.12-slim-bookworm` + `uv` multi-stage、非 root (uid 10001) 実行、セキュリティハードニング (read-only rootfs / capabilities drop / egress 遮断 / tmpfs `/tmp`) に対応する。

### スコープ

- **In**: `services/attachment-text-extractor/` ディレクトリ全体 (Dockerfile / pyproject.toml / uv.lock / src / tests / scripts / AGENTS.md / README.md) / FastAPI app (`POST /extract` multipart、`GET /healthz`、`GET /readyz`、`GET /openapi.json`) / 形式別 extractor と MIME whitelist / リソース保護 / 日本語テキストの正規化 / Pydantic schemas / Dockerfile / OpenAPI export script / docker-compose エントリ / k8s manifest 例 / Python 用 CI job / サービス単体テスト
- **Out**: GROWI 側統合 (AttachmentService ハンドラ登録、ES インデックス化、TS クライアントの consumer 実装、検索結果 UI、管理画面、抽出失敗ログの Mongo 永続化等) は下流 spec の責務。画像 OCR / 音声動画文字起こし / YouTube / Azure DI / ZIP 再帰展開 / Docling 等の高精度抽出 / Outlook MSG は本 spec のスコープ外

### 制約

- **ランタイム / 言語**: Python 3.12+ を新規導入。GROWI monorepo の 3 言語目 (Node / Java / Python)
- **ライセンス**: 依存は MIT / Apache-2.0 / BSD 互換のみ採用 (GPL / AGPL 系は禁止)
- **Image size 目標**: 400MB 以下
- **メモリ**: 1 件の変換の最大メモリは入力によって大きく変わる (6MB の XLSX で約 620MB)。コンテナのメモリ上限は、1 件の変換に許すメモリの上限と同時実行数から design で定める
- **セキュリティ**: 外部ネットワーク egress 遮断下で正常動作すること
- **互換性**: API 契約 (`ExtractResponse.pages[]` 構造) は破壊的変更を避ける。変更時は下流 spec (`attachment-search-indexing`) の再検証を要する
- **upstream 依存リスク**: anydoc は 0.x 系で公開から日が浅い。版を固定し、出力の契約テストで更新時の変化を検知する

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は、GROWI の添付ファイル全文検索機能 (umbrella `attachment-search`) を 3-way split した結果のうち、**添付ファイルからテキストを抽出する Python マイクロサービス**単体を対象とする。`services/attachment-text-extractor/` 配下の FastAPI アプリケーション、Dockerfile、デプロイ artifacts、OpenAPI export スクリプトを一つの閉じた成果物として完成させる。

抽出サービスは純粋に「バイト列 → `pages[]` 構造の Markdown テキスト」への変換のみを責務とする。形式判定、形式別の位置情報抽出 (PDF ページ / PPTX スライド / XLSX シート)、リソース保護 (サイズ / タイムアウト / 同時実行)、外部 egress 遮断下での動作、k8s 向けセキュリティハードニング、OpenAPI spec の export が本 spec の範囲である。

GROWI 本体 (apps/app) との統合、TS クライアント消費、Elasticsearch インデックス化、検索結果 UI、管理画面は下流 spec (`attachment-search-indexing` / `attachment-search-ui`) の責務であり、本 spec には含めない。本 spec が安定した API 契約と Docker image を提供することで、下流 spec が並行して開発可能となる。

## Boundary Context

- **In scope**:
  - `services/attachment-text-extractor/` 配下の FastAPI アプリケーション実装
  - PDF / DOCX / XLSX / PPTX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter Notebook / 旧形式 Office (DOC / XLS / PPT) / OpenDocument (ODT / ODS / ODP) に対応する形式別 extractor
  - 位置情報付き `pages[]` 構造の返却 (PDF = ページ / PPTX = スライド / XLSX = シート、その他は単一要素)
  - 返却テキストの正規化 (改行コードの統一、日本語の語の途中に入った空白・改行の除去)
  - リソース保護 (最大ファイルサイズ / タイムアウト / 同時実行上限 / 細工ファイルの上限) と、1 件の異常終了を他のリクエストに波及させない隔離
  - 外部 egress 遮断下での動作と、外部バイナリを要しない Python 依存
  - Pydantic schemas (`ExtractResponse` / `PageInfo` / `ErrorResponse` / `ErrorCode`) と API 契約
  - Dockerfile (uv multi-stage、非 root、セキュリティハードニング対応)
  - k8s manifest 例 (Deployment + Service + HPA + NetworkPolicy + securityContext)
  - docker-compose エントリ (OSS 配布向け)
  - OpenAPI export script (`scripts/export_openapi.py`) — 下流 spec への成果物インタフェース
  - Python 用 CI job (ruff lint / pytest / image build)
  - サービス単体テスト
- **Out of scope**:
  - apps/app 側の統合実装 (AttachmentService ハンドラ登録、抽出結果の ES 取り込み、失敗ログ Mongo 永続化、検索クエリの multi-index 集約、admin API、検索結果 UI、添付ファイル一覧モーダル、管理画面拡張)
  - `packages/attachment-text-extractor-client` の生成 / 配布パイプライン (OpenAPI spec の export のみ本 spec が行い、orval 設定と生成成果物の消費は下流 spec)
  - 画像 OCR / 音声動画文字起こし / YouTube 取り込み / Azure Document Intelligence / ZIP 再帰展開 / Docling 等の高精度抽出
  - Outlook MSG
  - Elasticsearch / MongoDB への直接アクセス (サービスはステートレス、DB 依存ゼロ)
- **Adjacent expectations**:
  - 採用する抽出ライブラリ (research.md §1「決定事項」) が、対象プラットフォーム (linux x64 / arm64) 向けの wheel として PyPI から取得可能である
  - Docker / Kubernetes のランタイム (cgroups / seccomp / NetworkPolicy 対応 CNI) が前提
  - 下流 spec (`attachment-search-indexing`) は本 spec が export する OpenAPI spec を入力として orval で TS クライアントを生成し、HTTP multipart で `POST /extract` を呼ぶ

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

**自動テストで検証できない残存ギャップ**: 抽出の質 (表の構造、読み順) は文字の一致でしか見ておらず、PPTX の一部で anydoc が行の順番を入れ替えることは自動では捕まえられない。anydoc の文書化されていない挙動 (PPTX の分割、XLSX の目印) は、版を固定した契約テストでしか守られていない。既知の制約: PowerPoint の自動代替テキストと同じ形 (半角空白ちょうど 2 つ + 決まり文) で作者が打った行は消える。`.csv` に `application/vnd.ms-excel` の MIME が付くと XLS として扱われ、1.11 のエラーになる。BOM のない UTF-16 は判定できない。1.2 と 1.4 の「番号表示文字列」は番号だけの文字列 (例: `"3"`) で、「スライド」「p.」などの文言は UI 側で付ける。1.7 の「外部バイナリと外向き通信なしで動く」ことは、`--network none` のコンテナでの確認 (タスク 8.1 / 8.3) が人の確認待ち。

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

**自動テストで検証できない残存ギャップ**: k8s (cgroup v2) の既定では、コンテナがメモリの上限に達すると抽出サービス全体が止まり、2.7 の「他のリクエストを継続する」は成り立たない。これは親の RSS 監視で上限の手前で止めることに頼っており、実際のクラスタでは確かめていない。2.8 の大きさの上限は早めに断るためのもので、通ることの保証ではない (小さな CSV や異常な HTML でも RSS の上限で止まる)。2.9 は、1 つの接続に 2 件続けて送ってから切断すると、先の 1 件は最後まで動く。2.4 は、外向き通信を遮断したコンテナでの確認 (8.1 / 8.3) が人の確認待ち。

### Requirement 3: デプロイメントとセキュリティハードニング

<!-- derived from umbrella Requirement 13 (AC 13.1, 13.2, 13.3, 13.5 のみ。13.4 は apps/app 側責務として attachment-search-indexing spec へ) -->

**Objective:** GROWI の配布者 (OSS / GROWI.cloud) として、抽出サービスを既存の配布の仕組み (docker-compose / k8s) に加え、セキュリティの設定を強制した形で運用したい。なぜなら、既存の運用者が導入する手間を抑えつつ、コンテナからの脱出や外部通信による情報漏洩の危険を減らすから。

#### Acceptance Criteria

1. The OSS docker-compose 配布 shall 抽出サービスを単一コンテナとして同梱し、既存の compose 体系に追加する <!-- derived from umbrella R13.1 -->
2. The GROWI.cloud (k8s) 配布 shall 抽出サービスを共有 Deployment として提供し、負荷に応じて HPA により自動スケールする <!-- derived from umbrella R13.2 -->
3. The 抽出サービスのデプロイ構成 shall read-only root filesystem、非 root 実行、capabilities drop、network egress 遮断、tmpfs ベースの一時領域を推奨設定として提供する <!-- derived from umbrella R13.3 -->
4. The 抽出サービス shall 状態を持たず (ステートレス)、任意のレプリカ数でスケール可能である <!-- derived from umbrella R13.5 -->

**自動テストで検証できない残存ギャップ**: docker-compose と k8s の manifest は YAML を読んで中身を確かめただけで、image のビルド、read-only rootfs・uid 10001 での起動、クラスタへの適用はしていない (8.1 / 8.3 が人の確認待ち)。CI の workflow は GitHub 上で一度も実行しておらず、マージの必須チェックにも入っていない。

### Requirement 4: マルチテナント隔離

<!-- derived from umbrella Requirement 14 (AC 14.2, 14.3 のみ。14.1/14.4/14.5 は apps/app / ES index 側責務として attachment-search-indexing / attachment-search-ui spec へ) -->

**Objective:** GROWI.cloud の運用者として、抽出処理が共有基盤の他のテナントに影響しないよう分離したい。なぜなら、共有の ES クラスタに抽出の負荷が集中することと、特定のテナントが他のテナントの抽出を止めてしまうことを防ぐから。

#### Acceptance Criteria

1. The 添付テキスト抽出処理 shall 共有 Elasticsearch クラスタの ingest ノード上では実行しない <!-- derived from umbrella R14.2 -->
2. While あるテナントからの抽出要求が集中している, the 抽出サービス shall 設定された全体同時実行上限により、他テナントの抽出要求を完全停止させない <!-- derived from umbrella R14.3 -->

**自動テストで検証できない残存ギャップ**: 4.1 は、抽出が独立したサービスとして配備されることを静的に確かめるだけで、振る舞いのテストは無い。4.2 は全体の同時実行の上限で守るが、ワーカーを 2 つ以上にすると OS の接続の振り分けが偏り、空きがあっても 503 が返ることがある (既定はワーカー 1 つ)。
