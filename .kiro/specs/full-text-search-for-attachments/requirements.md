# Requirements Document

## Project Description (Input)

### 背景と問題
GROWI 利用者は、ページ本文に対しては全文検索できるが、**ページに添付された PDF/Office ファイルの中身は検索対象外**。議事録 PDF、仕様書 docx、予算表 xlsx、提案資料 pptx 等、重要情報が添付ファイル内のテキストに含まれるケースで、ページタイトルや本文にキーワードが無いと発見できず、検索経由の情報アクセスが分断されている。

### 現状
- Elasticsearch 連携は既に存在 ([apps/app/src/server/service/search-delegator/elasticsearch.ts](apps/app/src/server/service/search-delegator/elasticsearch.ts))、インデックス対象は Page の `path` / `body` / `comments` のみ
- `AttachmentService` は `addAttachHandler` / `detachHandler` の拡張点を持つが、検索インデックスへの連携は未実装
- Attachment モデルはメタデータのみ保持、テキスト本文は持たない
- 過去の社内検討 (dev.growi.org wiki) では ES ingest-attachment (Apache Tika) 案が議論されたが、マルチテナント共有 ES クラスタへの負荷懸念があり未実装

### あるべき姿
- 以下の形式の添付ファイル内テキストが ES にインデックスされ、全文検索から発見できる:
  - Office 系: PDF / docx / xlsx / pptx
  - テキスト系: HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (`.txt`, `.log`, `.md`) / RTF
  - その他: EPub / Jupyter Notebook (`.ipynb`) / Outlook MSG
  - いずれも pure Python で処理でき、外部バイナリ・ネットワーク egress 不要で追加アーキテクチャ影響が無いもの
- **位置情報トラッキング**: 検索結果の添付ヒットカードに「どのページ/スライド/シートでマッチしたか」を表示可能
  - PPTX はスライド単位、XLSX はシート単位、PDF はページ単位でインデックス (1 添付 = N ES 文書)
  - DOCX と その他テキスト系は動的ページング仕様 or 位置概念の欠如により添付単位 1 文書で扱う

### 採用アプローチ
**Python 版 microsoft/markitdown を共有 HTTP マイクロサービスとして分離** (新規 `apps/markitdown-extractor`)、apps/app から呼び出してテキスト抽出、結果を Elasticsearch にインデックス。既存 `apps/pdf-converter` のマイクロサービス運用パターン (Dockerfile, `packages/*-client` の OpenAPI → TS 自動生成) を踏襲するが、pdf-converter と異なり **FUSE は不要**、HTTP multipart/form-data で完結。デプロイは **k8s Deployment + HPA の共有サービス方式** (サイドカー方式ではない)。

### 検討した代替案と不採用理由
- ES ingest-attachment (Apache Tika): 共有 ES への負荷集中リスク → 不採用
- apps/app 内で Node ライブラリ (unpdf + officeparser) 直接抽出: apps/app のリソース圧迫、Office 抽出品質が劣る → 不採用
- markitdown TS ポート (markitdown-ts 等): 個人メンテ・未成熟・Node ライブラリの薄いラッパーで独自価値が小さい → 不採用

### スコープ
- **In**: 新規 `apps/markitdown-extractor` / `packages/markitdown-client` / 上記対応形式の一括サポート / AttachmentService 統合 / ES インデックス拡張 / 検索結果 UI (左ペイン Page 集約 + 右ペインプレビュー上部の添付ヒットカード + ファセットフィルタ) / 再インデックス (admin rebuild 拡張 + 添付一覧モーダル個別再抽出) / admin 有効化トグル / リソース保護 / OSS docker-compose 配布対応 / セキュリティハードニング
- **Out**: 画像 OCR / 音声動画文字起こし / YouTube/外部 URL 取り込み / Azure DI 等外部抽出 API / ZIP 再帰展開 (DoS 対策設計要、将来 enhancement) / 高精度構造抽出 (Docling 等) / 非同期ジョブ基盤の大改造 / pdf-converter との統合 / 添付専用検索画面 / PDF インラインプレビュー / 形式別詳細ファセット / 選択的再インデックス

### 制約
- ライセンス: MIT / Apache-2.0 / BSD 系のみ
- 対応 OS: apps/app は Windows/macOS/Linux 全対応 (マイクロサービスは Linux コンテナで可)
- ES バージョン: 既存サポート範囲 (7/8/9) を維持
- マルチテナント分離: GROWI.cloud の共有 ES クラスタに重い処理を寄せない
- 非互換ゼロ: 機能無効時は既存検索挙動と完全一致
- セキュリティ: DoS 対策 (タイムアウト、最大サイズ、同時実行数制限)、コンテナ強制分離

詳細は [brief.md](./brief.md) を参照。

## Introduction

GROWI に添付ファイル全文検索機能を追加する。利用者がページにアップロードした PDF/Office/テキスト系のファイル内容を Elasticsearch にインデックスし、既存のページ検索と統合された形で検索・発見できるようにする。抽出処理は Python 版 microsoft/markitdown をマイクロサービス化した `markitdown-extractor` に委譲し、apps/app 本体の負荷と GROWI.cloud 共有 ES クラスタの負荷を同時に回避する。位置情報 (ページ番号/スライド番号/シート名) を可能な形式で保持し、検索結果 UI (左ペイン集約表示 + 右ペインプレビュー上部の添付ヒットカード + ファセット) によりユーザがマッチ箇所を素早く特定できる。管理者は機能の有効化、既存添付の一括再インデックス、個別添付の再抽出を操作できる。

## Boundary Context

- **In scope (feature responsibility)**:
  - 対応形式の添付ファイルからのテキスト抽出サービスとクライアント
  - 抽出結果の ES インデックス化 (添付アップロード/削除/親ページ権限変更に連動)
  - 検索結果の添付ヒット表示 (左ペインリスト・右ペインプレビュー・ファセット)
  - 管理画面の有効化トグル・一括再インデックス・抽出失敗可視化
  - 添付ファイル一覧モーダルからの個別再抽出
  - リソース保護 (最大サイズ / タイムアウト / 同時実行制限) とマルチテナント隔離
- **Out of scope (explicitly not owned)**:
  - 画像 OCR / 音声動画文字起こし / YouTube 等外部 URL 取り込み / Azure DI 等外部 API / ZIP 再帰展開 / 高精度構造抽出 (Docling) — 将来 enhancement
  - 添付専用の検索画面、PDF インラインプレビュー、形式別詳細ファセット、選択的再インデックス
  - 添付ファイル自体の保管方式変更、apps/pdf-converter の責務変更、Elasticsearch 以外のバックエンド対応
- **Adjacent expectations (this feature relies on these)**:
  - Elasticsearch が構成済みで利用可能である (ES 連携は本機能の前提)
  - 既存 `AttachmentService` の `addAttachHandler` / `detachHandler` がアップロード・削除イベントを発火する
  - 既存 `FileUploader` 実装 (S3 / GCS / Azure / Local) から添付バイナリを取得できる
  - 既存 Page 検索の権限モデル (grant 種別 / granted users / granted groups) を継承できる
  - 既存の rebuildIndex 管理画面 UI が拡張可能な形で存在する
  - 既存の添付ファイル一覧モーダルが拡張可能な形で存在する

## Requirements

### Requirement 1: 添付ファイルからのテキスト抽出

**Objective:** GROWI 配布/運用者として、対応形式の添付ファイルから構造化されたテキスト抽出結果を取得したい、全文検索インデックスへの投入と位置情報表示を可能にするため

#### Acceptance Criteria

1. When 対応形式の添付ファイルが抽出サービスに渡される, the 抽出サービス shall 抽出結果を `pages` 配列 (各要素は `pageNumber` / `content` / `label`) として返却する
2. When PPTX ファイルが抽出サービスに渡される, the 抽出サービス shall スライド単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にスライド番号表示文字列を設定する
3. When XLSX ファイルが抽出サービスに渡される, the 抽出サービス shall シート単位で `pages` 配列を返却し、各要素の `pageNumber` に 1 始まりの序数を、`label` にシート名を設定する
4. When PDF ファイルが抽出サービスに渡される, the 抽出サービス shall ページ単位で `pages` 配列を返却し、各要素の `pageNumber` にページ番号を、`label` にページ番号表示文字列を設定する
5. When DOCX / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト (`.txt`, `.log`, `.md`) / RTF / EPub / Jupyter Notebook / Outlook MSG のいずれかが抽出サービスに渡される, the 抽出サービス shall 単一要素の `pages` 配列を返却し、`pageNumber` と `label` を null とする
6. If サポート対象外の形式が抽出サービスに渡される, the 抽出サービス shall 抽出を行わず、サポート対象外を示すエラーコードを返却する
7. The 抽出サービス shall 運用環境で外部バイナリおよびネットワーク egress を要求せずに動作する

### Requirement 2: 抽出処理のリソース保護と障害隔離

**Objective:** SRE として、悪意ある大容量添付や破損ファイルが検索基盤や本体機能を不安定化させないよう、抽出処理に上限と隔離を設けたい

#### Acceptance Criteria

1. If 添付ファイルサイズが設定された上限を超える, the 抽出サービス shall 抽出を行わず、ファイルサイズ超過を示すエラーコードを返却する
2. If 抽出処理が設定されたタイムアウトを超える, the 抽出サービス shall 当該リクエストを打ち切り、タイムアウトを示すエラーコードを返却する
3. While 抽出サービスが設定された同時リクエスト上限に達している, the 抽出サービス shall 以降のリクエストを受理せず、サービスビジーを示すエラーコードを返却する
4. If 抽出サービスへの呼び出しが失敗またはタイムアウトする, the apps/app shall 添付本体の保存処理を成功させ、当該添付を検索対象外として扱う
5. The apps/app shall 抽出成功・失敗・スキップ・再試行の各イベントを構造化ログに記録する
6. The 抽出サービス Pod/コンテナ shall 外部ネットワーク egress が遮断された状態で正常動作する

### Requirement 3: 添付アップロード時の自動インデックス化

**Objective:** GROWI 利用者として、添付ファイルをアップロードしたら自動で検索対象になってほしい、検索のための追加操作を不要にするため

#### Acceptance Criteria

1. When 機能が有効かつ対応形式の添付ファイルがページにアップロードされる, the apps/app shall 抽出サービスを呼び出してテキストを取得し、抽出結果を Elasticsearch にインデックスする
2. When 添付ファイルの抽出結果が複数の pages 要素を含む, the apps/app shall 各要素を個別の ES 文書としてインデックスする (1 添付 = N 文書)
3. Where 機能が無効化されている, the apps/app shall 抽出サービスを呼び出さず、添付アップロードフロー全体の挙動を機能導入前と完全に一致させる
4. If 抽出呼び出しが失敗するか、対象がサポート対象外形式か、ファイルサイズ上限を超える, the apps/app shall 添付メタデータのみの ES 文書を作成し、コンテンツを空として登録する
5. The ES 添付文書 shall 少なくとも添付ファイル識別子、親ページ識別子、`pageNumber`、`label`、抽出コンテンツ、ファイル名、ファイル形式、および親ページの権限情報 (grant 種別と granted users/groups) を含む

### Requirement 4: 添付削除および親ページ変更へのインデックス追従

**Objective:** GROWI 管理者として、削除された添付や閲覧不可になった添付の検索ヒットが残らないようにしたい、情報漏洩と混乱を防ぐため

#### Acceptance Criteria

1. When 添付ファイルが削除される, the apps/app shall 該当添付に紐づく全 ES 文書を削除する
2. When 親ページが削除される, the apps/app shall 該当ページに紐づく全添付の ES 文書を削除する
3. When 親ページの権限 (grant 種別 / granted users / granted groups) が変更される, the apps/app shall 該当ページに紐づく全添付 ES 文書の権限情報を更新する
4. If 削除または権限更新処理が失敗する, the apps/app shall 失敗を構造化ログに記録し、管理者が追跡可能にする

### Requirement 5: 検索結果リスト (左ペイン) の表示

**Objective:** GROWI 利用者として、検索結果で添付ヒットがどのページに属するかわかる形で見たい、ページ中心のナビゲーションを維持するため

#### Acceptance Criteria

1. When 検索クエリが実行される, the 検索 UI shall 結果を親ページ単位に集約し、各ページを 1 枚の Page カードとして左ペインに表示する
2. When Page 本文ヒットに加えて添付ヒットが当該ページに存在する, the 検索 UI shall Page カード内に「この添付にもマッチ」サブエントリを表示し、添付ファイル名・ファイル形式アイコン・`label`・マッチスニペットを含める
3. When 添付サブエントリがクリックされる, the 検索 UI shall 対象ページを選択状態にし、右ペインに当該添付ヒットを反映したプレビューを表示する
4. Where 同一ページに添付ヒットが複数存在する, the 検索 UI shall 関連度最上位の 1 件を展開表示し、残りを折りたたみで切替可能にする
5. Where 本文がヒットせず添付のみがヒットしたページが存在する, the 検索 UI shall 当該ページを Page カードとして結果に含め、添付サブエントリを展開表示する

### Requirement 6: 検索結果プレビュー (右ペイン) の添付ヒットカード

**Objective:** GROWI 利用者として、ページを選んだ際にどの添付ファイルでマッチしたかを即座に把握したい、マッチ箇所への遷移を素早く行うため

#### Acceptance Criteria

1. When 左ペインで添付ヒットを持つページが選択される, the 検索 UI shall 右ペインプレビュー最上部に「添付ヒットカード」を表示する
2. The 添付ヒットカード shall 添付ファイル名、ファイル形式アイコン、ファイルサイズ、`label`、マッチスニペット、および添付本体を開くためのリンクまたはボタンを含む
3. When 添付ヒットカードの添付本体リンクがクリックされる, the 検索 UI shall 既存の添付ビューアで当該添付本体を開く
4. Where 選択ページに添付ヒットが複数存在する, the 検索 UI shall 関連度最上位 1 件をカードとして展開表示し、残りを折りたたみで切替可能にする
5. Where 選択ページに添付ヒットが存在しない, the 検索 UI shall 添付ヒットカードを表示しない

### Requirement 7: 検索結果のファセットフィルタ

**Objective:** GROWI 利用者として、検索結果を「ページだけ」「添付だけ」に絞り込みたい、目的に応じた絞り込み軸を切り替えるため

#### Acceptance Criteria

1. The 検索 UI shall 「全体」「ページ」「添付ファイル」の 3 つを切り替えるファセットタブを表示する
2. The 検索 UI shall 「全体」をデフォルトのファセットとして選択状態にする
3. When 「ページ」ファセットが選択される, the 検索 UI shall 本文がヒット根拠である結果のみを表示する
4. When 「添付ファイル」ファセットが選択される, the 検索 UI shall 添付ヒットのみを、親ページ情報と `label` 付きで表示する
5. Where 機能が無効化されている, the 検索 UI shall 「添付ファイル」ファセットタブを非表示または無効化する

### Requirement 8: 添付検索結果の権限制御

**Objective:** GROWI 利用者として、自分が閲覧権限を持たないページの添付内容が検索結果に漏れないことを保証したい、既存の権限モデルとの整合のため

#### Acceptance Criteria

1. When 検索クエリが実行される, the 検索 UI shall 実行ユーザが閲覧可能な親ページに紐づく添付ヒットのみを返却する
2. When 親ページの権限が変更された後に検索クエリが実行される, the 検索 UI shall 更新後の権限に基づいて添付ヒットの可視性を制御する
3. The 添付検索の権限判定 shall 既存 Page 検索と同一の権限モデル (grant 種別・granted users・granted groups) に従う
4. If 親ページが既に削除されている添付が ES に残存する, the 検索 UI shall 当該添付ヒットを検索結果から除外する

### Requirement 9: 管理画面での機能有効化トグル

**Objective:** GROWI 管理者として、添付全文検索機能を自社環境の都合で有効/無効にしたい、リソース状況や運用方針に応じて切り替えるため

#### Acceptance Criteria

1. The 管理画面 shall 「添付ファイル全文検索」機能の有効/無効トグルを提供する
2. The 管理画面 shall 抽出サービスの接続先 URL、最大ファイルサイズ、抽出タイムアウト、同時実行上限を管理者が設定可能にする
3. When 機能が無効から有効に切り替えられる, the 管理画面 shall 既存添付の一括再インデックスを別途実行する必要がある旨を管理者に明示する
4. Where 機能が無効化されている, the apps/app shall 添付ヒットを検索結果に表示せず、抽出サービスへの新規呼び出しを行わない
5. When 機能無効化中に新規添付がアップロードされる, the apps/app shall 添付の保存を継続し、機能再有効化後の一括再インデックスで取り込めるようにする

### Requirement 10: 管理画面での一括再インデックス

**Objective:** GROWI 管理者として、機能有効化後に既存添付を検索対象として取り込みたい、機能が過去添付にも有効になるようにするため

#### Acceptance Criteria

1. The 管理画面の既存 rebuildIndex 機能 shall 「添付も対象にする」チェックボックスを追加し、機能が有効な場合はデフォルト ON とする
2. When 「添付も対象にする」が有効な状態で rebuildIndex が実行される, the apps/app shall Page/Comment の再インデックスに加えて全添付の再抽出とインデックス化を実施する
3. While 一括再インデックスが実行中, the 管理画面 shall 処理進捗 (処理済み件数 / 総件数) を管理者に表示する
4. If 一括再インデックス中に特定の添付で抽出が失敗する, the apps/app shall 当該添付をスキップして処理を継続し、失敗を構造化ログに記録する
5. Where 機能が無効化されている, the 管理画面 shall 「添付も対象にする」チェックボックスを非表示または無効化する

### Requirement 11: 添付ファイル一覧モーダルでの個別再抽出

**Objective:** GROWI 管理者 (または権限を持つユーザ) として、特定添付の抽出失敗やフォーマット更新に対処したい、全体再インデックスを回さずに個別修正するため

#### Acceptance Criteria

1. Where 機能が有効化されている, the 添付ファイル一覧モーダル shall 各添付行に「再抽出」ボタンを表示する
2. When 「再抽出」ボタンがクリックされる, the apps/app shall 当該添付を抽出サービスに再送し、成功した場合は ES 文書を更新する
3. When 再抽出が完了する, the 添付ファイル一覧モーダル shall 成功または失敗の結果をユーザにフィードバック表示する
4. If 再抽出が失敗する, the 添付ファイル一覧モーダル shall エラー概要を表示し、管理者が原因を推測できる最低限の情報を含める
5. Where 機能が無効化されている, the 添付ファイル一覧モーダル shall 「再抽出」ボタンを表示しない

### Requirement 12: 抽出失敗の可視化

**Objective:** GROWI 管理者として、抽出失敗が発生している添付を特定したい、問題の原因追跡と対策を行うため

#### Acceptance Criteria

1. When 抽出処理が失敗する, the apps/app shall 対象添付の識別子、ファイル形式、ファイルサイズ、失敗理由コードを構造化ログに記録する
2. The 管理画面 shall 直近の抽出失敗件数と、直近の失敗サンプル (数件) の概要を管理者が閲覧できるようにする
3. Where 機能が無効化されている, the 管理画面 shall 抽出失敗情報を非表示にする
4. The apps/app shall 抽出処理の成功/失敗件数およびレイテンシを監視システムが収集できる形で公開する

### Requirement 13: デプロイメントとセキュリティハードニング

**Objective:** GROWI 配布者 (OSS / GROWI.cloud) として、本機能を既存の配布体系に合流させたい、既存運用者の導入負担を抑えるため

#### Acceptance Criteria

1. The OSS docker-compose 配布 shall 抽出サービスを単一コンテナとして同梱し、既存の compose 体系に追加する
2. The GROWI.cloud (k8s) 配布 shall 抽出サービスを共有 Deployment として提供し、負荷に応じて HPA により自動スケールする
3. The 抽出サービスのデプロイ構成 shall read-only root filesystem、非 root 実行、capabilities drop、network egress 遮断、tmpfs ベースの一時領域を推奨設定として提供する
4. Where 抽出サービスが到達不可能または機能が無効化されている, the apps/app shall 添付アップロードと既存検索を従来どおり動作させる
5. The 抽出サービス shall 状態を持たず (ステートレス)、任意のレプリカ数でスケール可能である

### Requirement 14: 既存機能との互換性およびマルチテナント隔離

**Objective:** GROWI.cloud 運用者として、新機能が既存テナントの検索品質や応答性を悪化させないことを保証したい、共有 ES クラスタへの波及を防ぐため

#### Acceptance Criteria

1. Where 機能が無効化されている, the apps/app shall 既存検索 (ページ本文・コメント) のレイテンシ、結果順序、API 応答形式を機能導入前と同一にする
2. The 添付テキスト抽出処理 shall 共有 Elasticsearch クラスタの ingest ノード上では実行しない
3. While あるテナントからの抽出要求が集中している, the 抽出サービス shall 設定された全体同時実行上限により、他テナントの抽出要求を完全停止させない
4. The 添付 ES インデックス構成 shall 既存 Page インデックスの検索クエリ応答時間を、機能有効化前と比べて意味ある程度に劣化させない
5. When 機能有効化前後で検索 API が呼ばれる, the 検索 UI shall 既存クライアントが破壊的変更なしに応答を解釈できるよう API の後方互換を保つ
