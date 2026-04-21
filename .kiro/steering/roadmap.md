# Roadmap

## Overview

GROWI に添付ファイル全文検索機能を追加するプロジェクト。ページにアップロードされた PDF / Office / テキスト系ファイル (PDF / docx / xlsx / pptx / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter Notebook / Outlook MSG) の中身を Elasticsearch にインデックスし、既存のページ検索と統合された形で検索・発見できるようにする。抽出処理は Python 版 microsoft/markitdown をマイクロサービス化した `markitdown-extractor` に委譲し、apps/app 本体の負荷と GROWI.cloud 共有 ES クラスタの負荷を同時に回避する。

当初は単一 spec (`attachment-search`) として進めていたが、要件 14 件 / 想定タスク 20+ でスコープが広く、実装時の品質劣化リスクが高いと判断。言語境界 (Python vs TS/Node) とアーキテクチャ層境界 (サーバ vs UI) を活かして **3 spec に分割**する。分割後、umbrella spec の brief/requirements/design は完全 superseded のため削除。research 系 (gap analysis / Docker image 調査 / 9 Issues 解消記録) のみ参照資料として `.kiro/specs/attachment-search/` に残置。

## Approach Decision

- **Chosen**: 3-way split by language + layer boundary
  - `attachment-search-markitdown-extractor`: Python FastAPI マイクロサービス本体 (`services/markitdown-extractor/`)
  - `attachment-search-indexing`: apps/app サーバ側統合 (TS クライアント、ES 連携、indexer、admin API)
  - `attachment-search-ui`: apps/app クライアント側 UI (検索結果 / 添付モーダル / 管理画面)
- **Why**:
  - Python/TS の言語境界がクリーン
  - 各 spec が単一ドメイン (インフラ / サーバ / UI) に収まりレビュー負荷が適正化
  - 並行開発可能 (Python, バックエンド, フロントエンドで担当分離)
  - extractor は GROWI 統合なしでも単体で有用な microservice として完成
- **Rejected alternatives**:
  - 単一 spec 維持: 20+ タスクで関心事が混ざり品質リスク
  - 2-way split (extractor + 統合全部): 統合 spec が 22 タスク超で依然大きい
  - ES ingest-attachment (Tika): GROWI.cloud 共有 ES 負荷リスクで不採用 (詳細は `attachment-search/research.md`)
  - apps/app 内 Node ライブラリ直接抽出: apps/app 負荷と Office 抽出品質で不採用
  - markitdown TS ポート: 個人メンテ・未成熟で不採用

## Scope

- **In**:
  - PDF / docx / xlsx / pptx / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter / MSG からのテキスト抽出と検索
  - 位置情報トラッキング (PDF=ページ / PPTX=スライド / XLSX=シート単位)
  - 検索結果 UI 統合 (左ペイン集約、右ペイン添付ヒットカード、ファセット)
  - 管理画面 (有効化、一括再インデックス、失敗可視化)
  - 添付ファイル一覧モーダル個別再抽出
  - OSS docker-compose 配布と k8s 共有 Deployment + HPA 運用
- **Out**:
  - 画像 OCR / 音声動画文字起こし / YouTube 等外部 URL 取り込み / Azure DI 連携
  - ZIP 再帰展開 (将来 enhancement)
  - 高精度構造/表抽出 (Docling 等)
  - 永続ジョブキュー化
  - apps/pdf-converter との統合

## Constraints

- ライセンス: MIT / Apache-2.0 / BSD 系のみ
- 対応 OS: apps/app は Windows/macOS/Linux 全対応、マイクロサービスは Linux コンテナ
- Elasticsearch: 既存サポート範囲 (ES 7/8/9) を維持
- マルチテナント隔離: GROWI.cloud 共有 ES クラスタに抽出負荷を寄せない
- 非互換ゼロ: 機能無効時は既存検索挙動と完全一致
- `services/` ディレクトリは本プロジェクトで新設される Python サービス用トップレベル。**pnpm workspace / turbo pipeline の対象外**

## Boundary Strategy

- **Why this split**:
  - 言語境界 (Python vs Node) が extractor と integration の間に自然に存在する
  - サーバ層 (indexing / API) と UI 層 (search result / admin) の責務分離が明確
  - 各 spec が 10-15 タスクに収まりレビュー粒度が適正
- **Shared seams to watch**:
  - `attachment-search-markitdown-extractor` → `attachment-search-indexing`: FastAPI OpenAPI spec 契約 → `packages/markitdown-client` の orval 生成。API の breaking change は下流 spec の回帰を要する
  - `attachment-search-indexing` → `attachment-search-ui`: `IPageWithSearchMeta.attachmentHits[]` 応答型、apiv3 エンドポイントの request/response shape、Config キー名
  - 共通参照: `attachment-search/` 配下の research.md / research-docker-image.md / design-review-fixes.md は 3 spec の背景資料として参照可能 (superseded な brief/requirements/design は削除済み)。contradiction 発生時は **新 spec の個別設計が正とする**

## Specs (dependency order)

- [ ] attachment-search-markitdown-extractor — Python FastAPI マイクロサービス (`services/markitdown-extractor/`) で添付ファイルからテキスト抽出 (PDF/Office/テキスト系 全 15 形式)。位置情報保持 (pages[] 構造)、リソース保護 (size/timeout/concurrency)、セキュリティハードニング、Dockerfile、k8s manifest、OpenAPI エクスポート。Dependencies: none
- [ ] attachment-search-indexing — apps/app サーバ側の統合層。`packages/markitdown-client` (orval 生成)、添付専用 ES index の mapping と CRUD、AttachmentService ハンドラ登録、ページ権限変更連動、一括再インデックスと進捗、失敗ログ model、個別再抽出 API、admin API、検索クエリの multi-index 集約と viewer フィルタ。Dependencies: attachment-search-markitdown-extractor
- [ ] attachment-search-ui — apps/app クライアント側の UI。検索結果左ペインの Page 集約 + 添付サブエントリ、右ペイン添付ヒットカード、ファセットタブ、添付ファイル一覧モーダル個別再抽出ボタン、admin 画面 (設定セクション、rebuild チェックボックス、失敗ログパネル)。Dependencies: attachment-search-indexing

## Related Artifacts

- Reference documents (superseded brief/requirements/design 削除後、research 系のみ残置): [.kiro/specs/attachment-search/](../specs/attachment-search/)
  - `research.md` — gap analysis と設計時調査 (既存コード拡張ポイント / FastAPI-orval / markitdown PR #1263 状況 / GROWI.cloud 制約)
  - `research-docker-image.md` — markitdown Docker image 選定調査
  - `design-review-fixes.md` — 9 Issues (分割後の design review 指摘) の解消記録
