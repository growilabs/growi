# Requirements Document

## Project Description (Input)
GROWIはPlantUML図の内容をエンコードしてGET URLに載せ、`<img>`でPlantUMLサーバへ送って描画する。各図の先頭に約14,000文字のテーマ用スタイル（`carbon-gray-*`。全図種ぶんの全部盛り）を付加するため、エンコード後URLが約2倍に肥大化し、大きい図が**URL長超過で描画に失敗する**（実測: テーマ有り約8,014字→400／テーマ無し約3,690字）。失敗しても現状は**黙って空表示**になり、利用者から「GROWIのバグだ」と受け取られる。

本specは、**GET経路（＝自前サーバを持たない公開plantuml.com/GROWI.cloud含む全ユーザー）**に対し、次の2つで大きい図の体験を改善する。

1. **テーマの軽量化**でエンコード後URLを縮め、より多くの図を描画可能にする。
2. それでも上限を超える図には、**分かりやすいエラーを表示**して「バグではなく制限」であることを伝える。

> 補完関係: 本specはGET側の改善。極端に巨大な図の**完全な描画**は別spec `plantuml-post-optin`（自前サーバ＋POST）が受け持つ。

## 決定事項（会議で確定）
- **ダークモード対応は維持**する（テーマを完全撤去はしない）。
- **図の種類に応じてCSSを切り替えない**（全図種一律の単一・静的テーマ）。
- **GET時に分かりやすいエラーを出す**（空表示のまま放置しない）。
- **エラー判定の閾値は固定値**（設定化はしない）。ただし固定値は**安全側に高め**とし、環境差による誤検知を避ける（下記 Req 8 参照）。

## 一考の余地あり（設計フェーズで決定）
- **軽量化の程度・手法**。**主レバーはテーマのミニファイ**（コメント行・行頭空白・空行の除去。着色定義は一切消さないため見た目は不変）とし、これで URL 削減効果と見た目のトレードオフを回避する。非UML系 `<style>` ブロックの削除は、追加削減が必要な場合の**副次レバー**として、ダークモード配色を損なわない範囲でのみ検討する。
- 軽量化の**効き（どこまでURLが縮むか）は実測で確認**する（Req 5）。実測（報告図・light）: ミニファイで**全体URL 8,318→6,882字（全体約17%減＝テーマ寄与では約31%減、着色維持）**、Tomcat 8192 内（余裕約1,310字）。非UML削除は効果が小さく当該図種のダーク配色を失う ── ミニファイが効果・安全性とも優る。

## Boundary Context
- **In scope（軽量化）**: 付加テーマの軽量化（単一・静的テーマ）、ダークモード配色の維持、不要定義/資産の整理。
- **In scope（エラー表示）**: GET描画失敗の検知、分かりやすい画面エラー表示、コンソール警告、メッセージのi18n。
- **Out of scope**: POST送信による根本回避（別spec `plantuml-post-optin`）、図種別のCSS切替（決定事項として不採用）、テーマの完全撤去（不採用）、サーバ/プロキシのURL長上限そのものの変更、閾値の設定化。
- **Adjacent expectations**: GET送信・`<img>`描画・auto-scroll連携など、本spec対象外の描画挙動は不変。ライト/ダーク判定は現行の仕組みを流用。

## Requirements

### Requirement 1: テーマの軽量化によるURL短縮
**Objective:** As a GROWI利用者, I want PlantUML図に付加するテーマが軽量であること, so that エンコード後URLが縮み、大きい図の描画が改善する

#### Acceptance Criteria
1. The GROWI shall PlantUML図へ付加するテーマを、現行より小さいサイズへ軽量化する。
2. While 軽量化テーマを付加する, when 従来（現行テーマ）でURL長超過により失敗していた図を表示する, the GROWI shall 当該図のエンコード後URLを短縮する。
3. The GROWI shall 公開 plantuml.com を送信先とする既定構成でも本改善を有効にする（自前サーバを要しない）。

### Requirement 2: ダークモード対応の維持
**Objective:** As a ダークモードのGROWI利用者, I want 軽量化後も図がダークモードで見やすいこと, so that 白ベースで浮くことなく閲覧できる

#### Acceptance Criteria
1. While ダークモードである, when 図を表示する, the GROWI shall ダークモードに適した配色（背景・文字・線等）で図を描画する。
2. The GROWI shall ライト／ダークのいずれでも図が判読可能な見た目を維持する。

### Requirement 3: 図種別CSS切替の不採用
**Objective:** As a 保守者, I want 図の種類ごとにCSSを切り替えないこと, so that 新しい図種が増えても保守が破綻しない

#### Acceptance Criteria
1. The GROWI shall 図の種類に応じてテーマ/スタイルを切り替えない（全図種一律の単一テーマを適用する）。

### Requirement 4: 描画機能の後方互換
**Objective:** As a GROWI利用者, I want 本spec対象以外の描画挙動が変わらないこと, so that 既存の図表示・スクロールが従来どおり動く

#### Acceptance Criteria
1. The GROWI shall GET送信・`<img>`描画・auto-scroll連携など、テーマ内容とエラー表示以外のPlantUML描画挙動を従来どおり維持する。

### Requirement 5: 軽量化の効果を実測で確認
**Objective:** As a 開発者, I want 軽量化の効き目を実測で把握すること, so that 「どこまで縮んだか」を根拠を持って判断できる

#### Acceptance Criteria
1. When 軽量化版テーマを用意する, the GROWI shall 軽量化前後のエンコード後URL長を実測して削減効果を確認する（特に、問い合わせで報告された図が描画可能になるかを検証する）。

### Requirement 6: 描画失敗の検知（onErrorを主、閾値を保険）
**Objective:** As a GROWI利用者, I want 表示できない図で原因不明の空表示が起きないこと, so that 何が起きているか分かる

#### Acceptance Criteria
1. If GET方式で図の描画（`<img>`読み込み）が失敗する, then the GROWI shall 当該箇所を空表示のまま放置せず、エラー表示に切り替える。
2. While GET方式で描画する, when エンコード後URL長が固定閾値を超える, the GROWI shall 画像リクエストを行わずエラー表示に切り替える（明らかに巨大なURLの先回り防止）。

### Requirement 7: 分かりやすいエラー表示とコンソール警告
**Objective:** As a GROWI利用者/開発者, I want 表示できない理由と対処が分かること, so that これはバグではなく制限だと理解し対応できる

#### Acceptance Criteria
1. When 固定閾値超過をプリチェックで検知する（画像リクエスト前）, the GROWI shall 「PlantUMLサーバのURL長上限により表示できない可能性が高い」旨のメッセージを表示する。
1-b. When `<img>` の onError による描画失敗を検知する, the GROWI shall 原因をURL長超過と断定せず（クライアントは `<img>` のHTTPステータスを読めないため）、「表示できない（原因: URL長上限の可能性・図の構文エラー・PlantUMLサーバ未到達 のいずれか）」旨のヘッジしたメッセージを表示する。`src.length` を目安に文言のニュアンス（"可能性が高い"／"他の原因の可能性"）を選んでよいが、判定ブロックには用いない（Req 8.2）。
2. When 上記メッセージを表示する, the GROWI shall 汎用の対処方法（図の分割・簡略化）を併記する。（POST/自前サーバの推奨は本specに含めず、別spec `plantuml-post-optin` が担う）
3. When 検知する, the GROWI shall コンソールに、原因の候補（URL長上限の可能性等）と該当を識別できる情報を含む警告を出力する。
4. If 一部の図が表示できない, then the GROWI shall 同一ページ内の他の図・本文の表示を妨げない。
5. The GROWI shall 画面メッセージを対応ロケール（en/ja/fr/ko/zh）で提供する。

### Requirement 8: 判定閾値（固定・安全側）
**Objective:** As a GROWI管理者, I want 閾値による誤検知で正常な図が隠れないこと, so that 描画できる図まで無用にエラーにしない

#### Acceptance Criteria
1. The GROWI shall URL長判定の閾値を固定値として持つ（設定化はしない）。
2. The GROWI shall 当該固定閾値を、環境差で描画可能な図を誤ってエラーにしない安全側（高め）の値とする。実際のサーバ上限に依存する失敗は Req 6.1（onError）で捕捉する。
