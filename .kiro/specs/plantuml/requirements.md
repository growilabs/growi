# Requirements Document

## Introduction
GROWI は Markdown 中の PlantUML 図を PlantUML サーバーへ送って SVG を受け取り、ページに表示する。図の送り方は2通りある。

- **GET**: 図のソース（先頭に GROWI のテーマを付けたもの）を圧縮して URL に入れ、`<img>` で取得する。URL には長さの上限があり、大きい図は上限を超えて描画に失敗する。失敗しても画面は空のままで、利用者からは「GROWI のバグ」に見える。
- **POST**: 図のソースをリクエストの本文に入れて送る。URL の長さの上限を受けない。ただし公開 plantuml.com は POST の本文を無視して見本の図へリダイレクトするため使えない（2026-11 実測）。

本 spec は次の4点で、大きい図を描けるようにし、描けないときは理由が分かるようにする。

1. 送信方式を送信先で自動的に選ぶ。公開 plantuml.com には GET、それ以外（自前の PlantUML サーバー）には POST で送る。管理者は GET を明示的に指定することもできる。
2. POST は閲覧者のブラウザから PlantUML サーバーへ直接送る（GROWI サーバーは中継しない）。
3. テーマを軽量化し、GET で送る URL を短くする。
4. 描画に失敗した図は、空のままにせず、図ごとに分かりやすいエラーを表示する。

## Boundary Context
- **In scope**: 送信方式の自動選択と GET の明示指定、ブラウザからの POST 描画、テーマの軽量化（ライト／ダークとも）、描画失敗の検知とエラー表示（GET／POST とも）、エラーメッセージの5ロケール翻訳、自動スクロールとの連携の維持。
- **Out of scope**: GROWI サーバーによる PlantUML への中継、PlantUML サーバーや手前のリバースプロキシ（nginx 等）の上限設定、公開 plantuml.com での POST、SSR・印刷・PDF 一括エクスポートでの図の描画（現状 GET でも描画していない）、図の種類ごとのテーマ切り替え、テーマの完全撤去、管理画面への設定 UI 追加、PlantUML サーバーの構築手順の提供。
- **Adjacent expectations**: PlantUML サーバーの送信先は既存設定 `PLANTUML_URI`（`app:plantumlUri`）に従う。POST で描画するには、送信先のサーバーが POST での描画と CORS（ブラウザから別サイトの応答を読むための許可ヘッダ）に対応している必要がある。公式の plantuml-server は両方に対応している。

## Requirements

### Requirement 1: 送信方式の自動選択
**Objective:** As a GROWI 管理者, I want 送信先に合った送信方式が自動で選ばれること, so that 設定をしなくても使える方式で図が描画される

#### Acceptance Criteria
1. Where 送信方式が明示的に指定されていない, when 送信先のホスト名が `plantuml.com` またはそのサブドメインである, the GROWI shall GET 方式で図を送る。
2. Where 送信方式が明示的に指定されていない, when 送信先が公開 plantuml.com 以外である, the GROWI shall POST 方式で図を送る。
3. If 送信先の URL を解釈できない, then the GROWI shall GET 方式で図を送る。
4. Where 送信先が設定されていない（空文字）, the GROWI shall 現行どおり PlantUML 図を描画しない。

### Requirement 2: GET の明示指定
**Objective:** As a GROWI 管理者, I want GET 方式を明示的に指定できること, so that POST に対応していないサーバーやネットワーク構成でも従来どおり描画できる

#### Acceptance Criteria
1. When 管理者が送信方式として GET を指定する（大文字・小文字は区別しない）, the GROWI shall 送信先に関わらず GET 方式で図を送る。
2. If 送信方式の設定値が GET 以外の値である, then the GROWI shall その値を無視して自動選択（Req 1）に従う。
3. The GROWI shall 送信方式の設定を環境変数で変更できる構成項目として提供する。

### Requirement 3: POST 方式での描画
**Objective:** As a 大きな PlantUML 図を書く利用者, I want GET では URL が長すぎて描けない図も描画されること, so that 図の分割や名前の変更をせずに閲覧できる

#### Acceptance Criteria
1. While POST 方式である, when 図を表示する, the GROWI shall 図のソースをリクエストの本文に入れ、閲覧者のブラウザから送信先の PlantUML サーバーへ直接送る。
2. While POST 方式である, the GROWI shall 図の描画可否を、図のソースの文字数や名前の付け方に依存させない。
3. While POST 方式である, the GROWI shall 日本語などの非 ASCII 文字を含む図を文字化けさせずに描画する。
4. While POST 方式である, the GROWI shall 送信先を GROWI の設定値だけから決め、ページ本文の記述によって送信先を変えられないようにする。
5. While POST 方式である, when PlantUML サーバーが図の構文エラーを描いた画像を返す, the GROWI shall その画像を図として表示する。

### Requirement 4: 受け取った画像の安全な表示
**Objective:** As a GROWI 利用者, I want PlantUML サーバーから受け取った画像を安全に表示してほしい, so that 画像に埋め込まれたスクリプトの被害を受けない

#### Acceptance Criteria
1. When PlantUML サーバーから受け取った SVG を表示する, the GROWI shall SVG 内のスクリプトが実行されない形で表示する。

### Requirement 5: テーマの軽量化
**Objective:** As a GROWI 利用者, I want 図に付けるテーマが小さいこと, so that GET で送る URL が短くなり、より大きい図まで描画できる

#### Acceptance Criteria
1. The GROWI shall 図に付けるテーマを、見た目を変えずに現行より小さくする。
2. The GROWI shall 図の種類に応じてテーマを切り替えない（全図種に同じテーマを付ける）。
3. While ダークモードである, when 図を表示する, the GROWI shall ダークモードに適した配色で図を描画する。
4. The GROWI shall ライト／ダークのいずれでも、全図種を判読できる見た目に保つ。
5. When テーマを軽量化する, the GROWI shall 軽量化の前後で、問い合わせで報告された図の GET 用 URL の長さを実測し、公開 plantuml.com の上限内に収まるかを確認する。

### Requirement 6: 描画失敗時のエラー表示
**Objective:** As a GROWI 利用者, I want 描画できない図で何が起きているか分かること, so that バグではなく制限や設定の問題だと理解して対処できる

#### Acceptance Criteria
1. If 図の描画に失敗する, then the GROWI shall その図を空のままにせず、エラー表示に切り替える。
2. If GET 方式で描画に失敗し、かつ URL が上限を超えている可能性が高い長さである, then the GROWI shall 「図が大きすぎて PlantUML サーバーの URL 長の上限を超えた可能性が高い」旨と、図の分割・簡略化という対処を表示する。
3. If POST 方式で送った結果、応答を受け取れない（接続できない・CORS の許可が無い）、または PlantUML サーバーがリダイレクトを返す, then the GROWI shall 「PlantUML サーバーが POST に対応していないか、ブラウザから接続できない可能性がある」旨と、管理者は GET を明示指定すれば従来の方式に戻せることを表示する。
4. If 描画に失敗し、Req 6.2 にも Req 6.3 にも当たらない, then the GROWI shall 「PlantUML サーバーで図を描画できなかった（サーバーに接続できない、またはサーバーのエラー）」旨を表示する。
5. When 描画の失敗を検知する, the GROWI shall 原因の候補・送信方式・図の大きさ（GET は URL の長さ、POST はソースの長さ）をブラウザのコンソールに警告として出力する。
6. If 一部の図が描画できない, then the GROWI shall 同じページの他の図と本文の表示を妨げない。
7. The GROWI shall エラーメッセージを対応ロケール（en_US / ja_JP / fr_FR / ko_KR / zh_CN）で提供する。

### Requirement 7: 自動スクロールとの連携の維持
**Objective:** As a GROWI 利用者, I want 図の読み込みでアンカー位置へのスクロールがずれないこと, so that リンク先の見出しへ正しく移動できる

#### Acceptance Criteria
1. When 図の読み込みが成功・失敗のいずれかで終わる, the GROWI shall 描画中を示す状態を完了に切り替え、自動スクロールの補正が働くようにする。
2. If POST 方式の取得が画像を表示する前に失敗する, then the GROWI shall 描画中を示す状態を完了に切り替え、自動スクロールの監視が無駄な再スクロールを続けないようにする。

### Requirement 8: 再表示時の重複送信の抑制
**Objective:** As a GROWI 利用者, I want 同じ図を何度も表示しても待たされないこと, so that ページを行き来しても快適に閲覧できる

#### Acceptance Criteria
1. While POST 方式である, when 同じブラウザの同じ閲覧中に、以前取得したものと同じソース・同じテーマの図を表示する, the GROWI should PlantUML サーバーへ送り直さずに表示する。
2. The GROWI shall 再利用のために保持する図の数に上限を設け、閲覧が長く続いてもメモリを使い続けないようにする。

### Requirement 9: 公開 plantuml.com を使う環境の互換性
**Objective:** As a 公開 plantuml.com を既定のまま使う管理者, I want 本変更で描画の仕組みが変わらないこと, so that 既存の環境がそのまま動き続ける

#### Acceptance Criteria
1. Where 送信先が公開 plantuml.com である, the GROWI shall 現行と同じ GET 方式・`<img>` での取得で図を描画する（テーマの軽量化とエラー表示を除き、挙動を変えない）。
2. Where 送信先が自前の PlantUML サーバーで、送信方式が GET に明示指定されている, the GROWI shall 現行と同じ GET 方式・`<img>` での取得で図を描画する（テーマの軽量化とエラー表示を除き、挙動を変えない）。
