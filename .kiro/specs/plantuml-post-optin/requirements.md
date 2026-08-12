# Requirements Document

## Introduction
GROWIはPlantUML図の内容をエンコードしてURLに載せ、GET（`<img>`）でPlantUMLサーバから画像を取得している。図が大きいとエンコード後URLがサーバのURL長上限を超え、描画に失敗する（実測: GET=414、命名のリネームで一時回避可）。本機能は、図ソースをリクエストボディに載せて送信する経路を**opt-inで追加**し、URL長超過による描画失敗を根本解消する。既定は現行のGETを維持するため、既存ユーザーへの影響はない。POST方式は自前PlantUMLサーバの運用を前提とする（公開 plantuml.com はPOST非対応であることを実測で確認済み）。

## Boundary Context
- **In scope**: 送信方式（GET/POST）の設定による切替、POST送信経路の追加、受信SVGの安全な表示、描画経路の悪用・過負荷対策、描画失敗時のエラー処理、ライト/ダークのテーマ表示維持、既存の遅延描画（auto-scroll補正）との非退行。
- **Out of scope**: GET方式のテーマの軽量化（別spec `plantuml-lighten-theme`）、上限超過時のユーザー向け表示（別spec `plantuml-oversize-notice`）、公開 plantuml.com でのPOST対応（サーバ側が非対応のため実現不可）、PlantUMLサーバ自体の構築・運用手順の提供。
- **Adjacent expectations**: POSTモードは、管理者が用意したPOST対応のPlantUMLサーバ（送信先設定が指す先）に依存する。本機能は既存の自動スクロール補正機構と連携して動作する。

## Requirements

### Requirement 1: 送信方式の設定（opt-in 切替）
**Objective:** As a GROWI管理者, I want PlantUMLの送信方式（GET/POST）を設定で選択できること, so that 自環境のPlantUMLサーバ構成に応じてURL長超過を回避できる

#### Acceptance Criteria
1. Where 送信方式が設定されていない, the GROWI shall 既定として GET 方式でPlantUML図を送信する。
2. When 管理者が送信方式を POST に設定する, the GROWI shall 以降のPlantUML図の描画を POST 方式で行う。
3. The GROWI shall 送信方式を管理者が変更可能な構成項目として提供する。

### Requirement 2: POSTモードでの大きい図の描画
**Objective:** As a 大きなPlantUML図を書く利用者, I want GET方式ではURL長超過で失敗する図でも描画されること, so that 図をリネームや分割せずに閲覧できる

#### Acceptance Criteria
1. While 送信方式が POST に設定されている, when GROWIがPlantUMLサーバへ図を要求する, the GROWI shall 図ソースをリクエストボディに載せて送信する。
2. While 送信方式が POST に設定されている, when GET方式ではURL長超過で失敗する大きさの図を表示する, the GROWI shall 当該図を正しく描画する。
3. While 送信方式が POST に設定されている, the GROWI shall PlantUML図の描画可否を、図ソースの文字数や命名（ネームスペース名・クラス名）に依存させない。

### Requirement 3: 既定（GET）の後方互換
**Objective:** As a 公開plantuml.comを既定のまま使う既存利用者, I want 本機能の追加によって現行の描画が変化しないこと, so that 既存環境が影響を受けずに動作し続ける

#### Acceptance Criteria
1. Where 送信方式が GET（既定）である, the GROWI shall 現行と同一の送信方式・キャッシュ挙動でPlantUML図を描画する。
2. When 送信方式設定を導入する, the GROWI shall 送信方式が既定（GET）である環境の描画結果と応答性を変化させない。

### Requirement 4: 受信SVGの安全な表示と送信先の限定
**Objective:** As a GROWI利用者/管理者, I want 図の描画が安全に行われ、意図しない送信先へ要求が飛ばないこと, so that XSSやSSRFの被害を受けない

#### Acceptance Criteria
1. When PlantUMLサーバから受け取ったSVGを表示する, the GROWI shall 埋め込まれたスクリプトが実行されない形で当該SVGを描画する。
2. While 送信方式が POST に設定されている, the GROWI shall 図の生成要求を、管理者が設定した単一のPlantUMLサーバ以外へ送信しない。

### Requirement 5: POST方式のパフォーマンス（非機能・推奨）
**Objective:** As a 図が多いページを閲覧する利用者, I want POST方式でも表示が実用的な速度であること, so that GET方式からの体感的な劣化を抑えられる

<!-- 非機能要件（SHOULD）。主価値（Req 2）に対する最適化であり、v1のブロッカーではない。推奨設計（サーバ側でのハッシュ配信）により大部分が自然充足される想定。 -->

#### Acceptance Criteria
1. While 送信方式が POST に設定されている, when 同一内容の図を再表示する, the GROWI should 初回描画より速く表示する（都度の再生成に依存しない）。
2. While 送信方式が POST に設定されている, when 同一内容の図を再表示する, the GROWI should PlantUMLサーバへの重複した描画要求を発生させない。

### Requirement 6: 描画失敗時のエラー処理
**Objective:** As a GROWI利用者, I want 一部の図の描画に失敗してもページが壊れないこと, so that ページ内の他の内容を引き続き閲覧できる

#### Acceptance Criteria
1. If PlantUMLサーバが図の生成に失敗する, then the GROWI shall 当該図の箇所にエラー状態を表示し、ページ全体の表示を妨げない。
2. If 同一ページ内の一部の図の描画が失敗する, then the GROWI shall 他の図の描画を継続する。

### Requirement 7: テーマ表示の維持
**Objective:** As a GROWI利用者, I want POST方式でもライト/ダークのテーマが図に反映されること, so that GET方式と同じ見た目で図を閲覧できる

#### Acceptance Criteria
1. While 送信方式が POST に設定されている, when ライトモードで図を表示する, the GROWI shall ライトテーマの見た目で図を描画する。
2. While 送信方式が POST に設定されている, when ダークモードで図を表示する, the GROWI shall ダークテーマの見た目で図を描画する。

### Requirement 8: 非同期描画と自動スクロールの非退行
**Objective:** As a アンカー付きリンクでページ内を移動する利用者, I want 図の遅延読み込みで移動先がずれないこと, so that 目的の位置へ正しくスクロールできる

<!-- 新機能というより既存 auto-scroll 補正の非退行制約。<img> を維持する設計ならほぼ無改修で満たせる。 -->

#### Acceptance Criteria
1. While 送信方式が POST に設定されている, when 図が非同期に読み込まれて表示される, the GROWI shall 図の読み込みによるレイアウトのずれを補正し、アンカー位置への自動スクロールを機能させる。

### Requirement 9: 運用境界の明示と誤設定時の扱い（自前サーバ前提）
**Objective:** As a GROWI管理者, I want POST方式の前提条件が明確に示され、誤設定が黙って壊れないこと, so that 誤設定による原因不明の描画不良を避けられる

#### Acceptance Criteria
1. Where 送信方式が POST に設定されている, the GROWI shall 図の描画を、設定されたPlantUMLサーバがPOST送信に対応していることに依存する。
2. The GROWI shall 公開 plantuml.com がPOST非対応であり本機能の対象外であることを、送信方式設定の説明で管理者に明示する。
3. If 送信方式が POST でありながら送信先がPOST描画に対応していない, then the GROWI should 誤った図を黙って表示せず、検知可能な失敗として扱う。

### Requirement 10: 描画経路の悪用・過負荷対策
**Objective:** As a GROWI管理者, I want 描画経路が外部からの踏み台や過負荷に使われないこと, so that 自環境のリソースと安全性を守れる

#### Acceptance Criteria
1. The GROWI shall 描画経路へのアクセスを、ページ内容の閲覧と同等のアクセス制御下に置く。
2. While 送信方式が POST に設定されている, when 図ソースが規定の上限を超える、または生成が規定の制限時間を超える, the GROWI shall 当該描画を中止し、エラー状態を返す。
