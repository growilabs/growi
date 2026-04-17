# Brief: full-text-search-for-attachments

## Problem

GROWI 利用者は、ページ本文に対しては全文検索できるが、**ページに添付された PDF/Office ファイルの中身は検索対象外**。業務で重要な情報が添付ファイル内のテキストに含まれているケース (議事録 PDF、仕様書 docx、予算表 xlsx、提案資料 pptx 等) で、ページタイトルや本文にキーワードが書かれていないと発見できず、検索経由での情報アクセスが分断されている。

## Current State

- Elasticsearch 連携は既に存在: [apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts)
- インデックス対象は Page の `path` / `body` / `comments` のみ ([aggregate-to-index.ts](apps/app/src/server/service/search-delegator/aggregate-to-index.ts))
- [AttachmentService](apps/app/src/server/service/attachment.ts) は `addAttachHandler` / `detachHandler` の拡張点を持つが、検索インデックスへの連携は未実装
- Attachment モデル ([attachment.ts](apps/app/src/server/models/attachment.ts)) は `originalName` / `fileFormat` / `fileSize` などメタデータのみ保持、テキスト本文は持たない
- 既存マイクロサービス [apps/pdf-converter](apps/pdf-converter/) は HTML→PDF 専用 (バルクエクスポート用途)、テキスト抽出機能は持たない
- 過去の社内検討 (dev.growi.org wiki 615f9c0874b84442a6928a9a) では ES ingest-attachment (Apache Tika) 案が議論されたが未実装。検索結果表示・権限制御・有効/無効切替・再インデックスが残課題として挙げられていた

## Desired Outcome

- 以下の形式の添付ファイル内テキストが ES にインデックスされ、全文検索から発見できる:
  - **Office 系**: PDF / docx / xlsx / pptx
  - **テキスト系**: HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (`.txt`, `.log`, `.md`) / RTF
  - **その他**: EPub / Jupyter Notebook (`.ipynb`) / Outlook MSG
- 添付単位で検索ヒットを表示でき、どのページのどの添付ファイルにマッチしたかが明確
- 既存の Page / Comment 検索結果と統合された検索体験
- 既存添付に対しても再インデックスで遡って対応可能
- OSS 版 (docker-compose) / GROWI.cloud (k8s マルチテナント) の両方で現実的なリソース消費で動作
- 既存検索機能を無効化した状態と機能有効化前の挙動が完全一致 (非互換ゼロ)

## Approach

**Python 版 microsoft/markitdown を共有 HTTP マイクロサービスとして分離し、apps/app から呼び出してテキスト抽出、結果を Elasticsearch にインデックスする**。

### アーキテクチャ概要

```
 ┌────────────────── GROWI Cluster / Compose ─────────────────────┐
 │                                                                │
 │   ┌──────────────────┐    ┌──────────────────────┐             │
 │   │  apps/app (Node) │    │ apps/pdf-converter   │ (既存)      │
 │   │  Next.js+Express │    │ Ts.ED + Puppeteer    │             │
 │   └──────┬───────────┘    └──────────────────────┘             │
 │          │                                                     │
 │          │ upload attachment                                   │
 │          ├────────────────┐                                    │
 │          ▼                ▼                                    │
 │   ┌───────────┐    ┌──────────────────────┐                    │
 │   │ MongoDB   │    │ markitdown-extractor │ (NEW)              │
 │   │ (metadata)│    │ Python 3.12 +FastAPI │ shared service     │
 │   └───────────┘    │ +markitdown[pdf,docx,│ (k8s Deployment    │
 │                    │  pptx,xlsx]          │  + HPA)            │
 │                    └──────────┬───────────┘                    │
 │                               │ markdown text                  │
 │          ┌────────────────────┘                                │
 │          ▼                                                     │
 │   ┌──────────────────┐                                         │
 │   │ Elasticsearch    │                                         │
 │   │                  │                                         │
 │   └──────────────────┘                                         │
 │                                                                │
 │   Client lib: packages/markitdown-client                       │
 │   (OpenAPI → TS 自動生成, pdf-converter と同じパターン)         │
 └────────────────────────────────────────────────────────────────┘
```

### 選定理由
- markitdown は Microsoft 公式メンテ、MIT、PDF/Office を extras で絞ると**外部バイナリ不要・image ~200MB** の軽量構成
- apps/pdf-converter で確立された「マイクロサービス + OpenAPI → 自動生成 client」のパターンを踏襲可能
- pdf-converter と異なり、**FUSE によるファイルシステム共有は不要**。入力=添付バイナリ、出力=短いテキストという短命リクエスト/レスポンスのため、シンプルな HTTP multipart/form-data で完結
- **共有サービス方式 (k8s Deployment + HPA) を採用**。サイドカー方式に比べクラスタ全体のベースライン消費を大幅削減 (例: 100 テナント × idle ~120MB のサイドカー = 12GB が、共有 2 replica × ~500MB ≈ 1GB に)、バースト時のみスケール
- apps/app 側に抽出処理を載せないことで、テナント間のリソース境界維持、クラッシュ耐性、言語別ランタイムの分離を実現

### 検討した代替案と不採用理由
- **ES ingest-attachment (Apache Tika)**: GROWI.cloud のマルチテナント共有 ES クラスタに Tika の CPU/memory 負荷が集中し、他テナントの検索・インデックス更新に波及するリスク。plugin 追加の運用負担も発生
- **apps/app 内で Node ライブラリ (unpdf + officeparser) 直接抽出**: 言語増加は避けられるが、apps/app に重い処理を抱える構造的リスク (イベントループ占有、OOM 時の巻き込み)、Office 系の抽出品質は markitdown に劣る。将来的な差し替え余地としては残す
- **markitdown TS ポート (markitdown-ts / markitdown-js / markitdown-node)**: いずれも個人メンテ、markitdown-ts は PPTX 未対応、本質的に Node ライブラリの薄いラッパーで独自価値が小さい。markitdown-js/node は停滞・未成熟。プロダクション利用に不適

## Scope

### In

#### 抽出サービスと統合
- 新規マイクロサービス `apps/markitdown-extractor` (Python 3.12 + FastAPI + Uvicorn + markitdown、pure-Python extras のみ)
- **サポート形式 (初回から全て対応)**:
  - **Office 系**: PDF / docx / xlsx / pptx
  - **テキスト系**: HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF
  - **その他**: EPub / Jupyter Notebook / Outlook MSG
  - 共通特性: pure Python、外部バイナリ不要、ネットワーク egress 不要、アーキテクチャ/UI/インデックス設計への影響なし
- 形式判定と MIME whitelist は markitdown-extractor 側で一元管理

#### 位置情報トラッキング (ページ/スライド/シート単位インデックス)
検索結果の添付ヒットカードに「どのページ/スライド/シートでマッチしたか」を表示するため、抽出サービスは単一 Markdown ではなくページ単位の配列を返す。

- **抽出サービス返却形式**: `{ pages: [{ pageNumber, content, label }] }`
  - `pageNumber`: 1 始まりの序数 (nullable: 位置概念がない形式)
  - `content`: そのページ/スライド/シートの Markdown テキスト
  - `label`: 表示用ラベル (例: `p.3`, `Slide 5`, `Sheet "Budget"`, null)
- **形式別トラッキング粒度**:
  - **PPTX**: スライド単位 (markitdown 出力に埋め込まれる `<!-- Slide number: N -->` HTML コメント or `extract_pages=True` を利用)
  - **XLSX**: シート単位 (markdown 見出しをパースして分割、label にシート名)
  - **PDF**: ページ単位 (upstream PR #1263 の `extract_pages=True` が stable リリース済みなら採用、未リリースなら抽出サービス内部で pdfminer.six を直接呼ぶ薄い実装にフォールバック)
  - **DOCX / その他 (HTML/CSV/JSON 等)**: 添付ファイル単位 1 ページ (`pageNumber=null, label=null`)。DOCX のページング概念は動的レンダリング依存で仕様上取得不可能。Heading 単位化は将来 enhancement
- **ES インデックス**: 1 添付 = N 文書 (PDF=pages, PPTX=slides, XLSX=sheets、その他=1文書)。`attachmentId` / `pageNumber` / `label` / `content` をフィールドに持つ
- **検索結果 UI**:
  - 右ペインプレビュー上部の添付ヒットカード: ファイル名に加え label を表示 (例: `spec.pdf — p.3`, `deck.pptx — Slide 5`)
  - 左ペインリストのサブエントリも同様に label 付きで表示
- クライアントパッケージ `packages/markitdown-client` (OpenAPI → TS 自動生成)
- apps/app の添付アップロード・削除フックへの抽出呼び出し追加 (既存 `AttachmentService` 拡張ポイント活用)
- Elasticsearch インデックス設計の拡張 (添付専用インデックス or 既存 page index 拡張 — 設計フェーズで α/β 確定)

#### 検索結果 UI
- **検索結果リスト (左ペイン)**: **Page 単位集約 + 添付ヒットをサブエントリ表示** (Option B)
  - 1 件の Page カード内で、本文マッチに加えて「この添付にもマッチ: `spec.pdf` 『...該当行...』」をサブエントリ表示
  - 添付名・ファイル形式アイコン・マッチスニペットを含む
  - 実装は ES クエリもしくは後処理で親ページ単位に集約
- **プレビューペイン (右ペイン)**: **最上部に「ヒットした添付ファイル情報カード」を追加**
  - 該当添付のファイル名・形式アイコン・サイズ・マッチスニペット・ページ内該当箇所へのリンク (可能な範囲で)
  - 添付クリック/プレビューボタンで添付本体を開く (既存添付ビューア流用)
  - Page 本文プレビューの上に差し込む形で、添付ヒットが複数あれば最上位 1 件を表示 (複数は折りたたみ)
- **ファセットフィルタ**: 検索結果の絞り込みで「ページ / 添付ファイル」をタブ切替可能に

#### 再インデックス UI
- **管理画面 (admin rebuild)**: 既存 `rebuildIndex` を拡張し、「添付も対象にする」チェックボックスを追加 (デフォルト ON)。初回有効化時の一括取り込みをここで実施 (Option X)
- **添付ファイル一覧モーダル**: 個別添付の「再抽出」ボタンを追加。特定ファイルの抽出失敗からの復旧・トラブルシュート用 (Option Z)
- 両 UI とも機能無効時はチェックボックス/ボタンを非表示/無効化

#### 運用と保護
- admin による機能有効/無効のトグル
- 抽出失敗ログの admin 画面表示 (最小限、原因追跡用)
- リソース保護: 最大ファイルサイズ制限、抽出タイムアウト、FastAPI 側同時リクエスト制限
- docker-compose (OSS 版配布) への新サービス追加と、k8s マニフェスト例の提供
- セキュリティハードニング: 抽出サービスの readOnlyRootFilesystem, runAsNonRoot, capabilities drop, network egress 制限, tmpfs /tmp

### Out

#### 抽出・検索エンジン
- 画像 OCR (スキャン PDF 含む) — Tesseract 等の OCR バイナリ依存が発生するため
- 音声/動画の文字起こし — STT/FFmpeg 依存、image 肥大
- YouTube/外部 URL からの取り込み — 抽出サービスのネットワーク egress 遮断方針と矛盾
- Azure Document Intelligence 等の外部クラウド抽出 API 連携
- **ZIP アーカイブの再帰的抽出** — zip 爆弾等の DoS 対策設計が別途必要なため、将来 enhancement として保留
- markitdown の多言語対応拡張 (既存 ES analyzer 設定で対応する範囲のみ)
- 高精度な構造/表抽出 (Docling 等の高品質抽出は将来課題として保留)
- 非同期ジョブ基盤の大規模改造 (初期実装は同期 HTTP + best-effort。永続キュー化は enhancement とする)
- apps/pdf-converter との統合・置き換え (責務が全く異なるため分離維持)
- Elasticsearch 以外の検索バックエンド対応

#### 検索結果 UI
- 添付ファイル専用の検索画面 (admin で「添付だけを検索するページ」を追加するなどは不要)
- プレビューペインでの PDF/Office インラインビューア統合 (既存添付ビューアへの遷移で十分)
- ファイル形式別の詳細ファセット (「PDF だけ」「xlsx だけ」等の絞り込み)
- 抽出テキストの全文プレビュー表示 (スニペット範囲のみ表示)

#### 再インデックス UI
- 添付ファイル専用の分離された再インデックス画面 (既存 rebuildIndex への拡張で十分)
- 選択的再インデックス (「抽出失敗のものだけ再試行」等の細かい選択機能)
- 再インデックス進捗のリアルタイム表示 (既存の rebuildIndex と同程度の UI に留める)
- 抽出失敗の詳細分析ダッシュボード (メトリクス収集は In、可視化ダッシュボードは Out)

## Boundary Candidates

1. **抽出サービス (apps/markitdown-extractor)** — Python/FastAPI で HTTP API 公開。形式判定と markitdown 呼び出し、タイムアウト/サイズ上限の強制に責務を限定。ステートレス
2. **抽出クライアント (packages/markitdown-client)** — OpenAPI 自動生成の TS クライアント。型安全な API 呼び出し、リトライ/タイムアウトのクライアント側制御
3. **GROWI app 側の抽出統合レイヤ (apps/app)** — AttachmentService の拡張フック、抽出結果の受け取り、ES への attachment 文書作成/更新、エラー時のフォールバック (メタデータだけで index 投入)、再インデックスバッチ
4. **検索層の拡張 (apps/app server)** — SearchDelegator の拡張、ES クエリでのページ単位集約と添付ヒットのサブエントリ統合、ファセット (ページ/添付) 対応
5. **検索結果 UI (apps/app client)** — 左ペインリストの Page 集約表示、右ペインプレビュー最上部の「添付ヒットカード」、ファセットフィルタ
6. **再インデックス UI** — admin rebuildIndex への「添付も対象にする」オプション追加、添付ファイル一覧モーダルの個別「再抽出」ボタン
7. **運用層 (apps/app admin)** — admin 設定 UI (有効/無効)、サイズ上限、抽出失敗モニタリングログ表示

## Out of Boundary

- 添付ファイル自体の保管方式変更 (現行の `FileUploader` 抽象 — AWS S3/GCS/Azure/Local — は維持)
- ページ検索ロジックの基本仕様変更 (既存検索フローは互換維持)
- apps/pdf-converter の仕様変更
- Elasticsearch のバージョンサポート方針変更
- Attachment モデルの保管形式の大幅変更 (必要なら派生フィールドのみ追加、既存は据え置き)

## Upstream / Downstream

### Upstream (依存先)
- 既存 `SearchService` / `ElasticsearchDelegator` (検索インデックス管理)
- 既存 `AttachmentService` (アップロード/削除イベントフック)
- 既存 `FileUploader` 各実装 (ファイルバイト取得 API)
- apps/pdf-converter で確立された マイクロサービス運用パターン (Dockerfile, client 生成、k8s 配置の流儀)

### Downstream (影響先)
- 検索結果 UI (左ペインリストの集約表示、右ペインプレビューの添付ヒットカード、ファセット)
- 添付ファイル一覧モーダル (個別「再抽出」ボタン追加)
- 管理画面 (機能有効化、rebuildIndex への「添付も対象にする」オプション追加、抽出失敗ログ表示)
- GROWI.cloud 運用 (新サービス Deployment + HPA の追加運用、SRE 監視)
- OSS 配布 (growi-docker-compose への service 追加)
- 将来の高品質抽出エンジン差し替え余地 (Docling, Tika Server 等への移行時、抽出サービスの抽象レイヤを保つ)

## Existing Spec Touchpoints

- **Extends**: なし (添付ファイル検索は既存 spec で扱われていない)
- **Adjacent**:
  - `suggest-path` — 検索/サジェスト体験の一部として UI が近接する可能性。ただし責務は分離可能
  - (spec 化されていない) `ElasticsearchDelegator` / `aggregate-to-index` は密接に関係する既存モジュール。設計時に統合方針を詰める

## Constraints

### Upstream 依存
- **markitdown PR #1263** (page-level text extraction for PDF/PPTX/DOCX) が stable リリース済みか要確認。未リリース時は抽出サービス側で PDF ページ分割のフォールバック実装が必要 (pdfminer.six を直接呼ぶ数十行程度)
- PPTX のスライド番号 HTML コメントは現行 stable に既に含まれている

### ランタイム/言語
- Python 3.12+ を新規マイクロサービスに追加
- 結果として GROWI monorepo は Node.js (apps/app, apps/pdf-converter, 大多数の package) / Python (apps/markitdown-extractor) / Java (ES) の 3 言語運用となる
- CI/CD は Python 用の lint / test / image ビルド系統を追加

### ライセンス
- MIT / Apache-2.0 / BSD 系のみ許容 (markitdown は MIT、依存ライブラリも互換)
- GPL/AGPL 系の混入禁止

### 対応 OS / デプロイ
- apps/app は Windows/macOS/Linux 全対応必須 (既存方針)
- apps/markitdown-extractor は Linux コンテナで提供 (開発ローカルは docker 経由で OS 非依存)
- OSS 版 (docker-compose): 単一 markitdown コンテナを同居
- GROWI.cloud (k8s): 共有サービス Deployment + HPA (サイドカー方式ではない)

### 既存機能との互換性
- ES バージョン: 既存サポート範囲 (ES 7/8/9) をそのまま維持
- 機能無効化時は現在の検索挙動と完全一致 (添付インデックス関連処理はスキップ)
- 既存 Page 検索のクエリ性能・結果順序への影響を最小化

### セキュリティ
- 悪意ある添付による DoS 対策 (pdfminer.six の大 PDF ハング事例あり) — FastAPI 側でタイムアウト (例: 60s)、最大サイズ (例: 50MB)、同時実行数を強制
- 抽出サービスはコンテナで強制分離、network egress 遮断、read-only root filesystem、非 root 実行、capabilities drop を推奨

### 運用
- 抽出失敗は添付本体の保存/閲覧には影響させない (検索対象外になるだけ)
- admin が抽出失敗の原因を追跡できる構造化ログ
- 抽出メトリクス (処理時間、失敗率、サイズ分布) を Prometheus 等で収集可能にする (GROWI.cloud 運用要件)
