# Requirements Document

## Project Description (Input)
PlantUML図はエンコードしてGET URLに載せて描画サーバへ送るため、図が大きいとURL長がサーバの上限を超え、描画に失敗する。現状は失敗しても**黙って空表示**になるため、利用者から「GROWIのバグだ」と受け取られてしまう。

本specは、**GET方式で図が上限を超えて表示できないとき、画面上に分かりやすいエラー（理由と対処）を表示する**（併せて開発者ツールのコンソールに原因の分かる警告を出す）。これにより「バグではなく制限である」ことを利用者に正しく伝える。

### 決定事項（会議で確定）
- **GET時に分かりやすいエラーを出す**。空表示のまま放置しない。

### 位置づけ
- 対象は**全ユーザー**（公開plantuml.com含む）。テーマ軽量化（`plantuml-lighten-theme`）でURLは縮むが、極端に大きい図はなお超え得るため、その残余ケースの受け皿となる。
- 本specは**URLを縮める対応や描画方式の変更は行わない**（それらは別spec）。失敗時の「見せ方」を改善する。
- 判定は**送信前にエンコード後URL長で行う**ことを基本とする（無駄な失敗リクエストを避け、原因を明確に示せる）。

## Boundary Context
- **In scope**: GET方式での上限超過の検知（送信前URL長判定を基本）、画面上のエラー表示（画像の代わり）、コンソール警告、メッセージのi18n。
- **Out of scope**: URLを縮める対応（別spec `plantuml-lighten-theme`）、POST送信による根本回避（別spec `plantuml-post-optin`）、サーバ/プロキシのURL長上限そのものの変更。
- **Adjacent expectations**: GET描画経路（`<img>`）に対して働く。POST経路を使う構成では本メッセージは通常不要（別specの誤設定検知が担う）。

## Requirements

### Requirement 1: 上限超過の検知（送信前URL長判定）
**Objective:** As a GROWI利用者, I want 表示できない大きさの図で原因不明の空表示が起きないこと, so that 何が起きているか分かる

#### Acceptance Criteria
1. While GET方式で描画する, when 図のエンコード後URL長が既定の閾値を超える, the GROWI shall 画像リクエストを行わず、代替のエラー表示に切り替える。
2. While GET方式で描画する, when エンコード後URL長が閾値以内である, the GROWI shall 従来どおり図を描画する。

### Requirement 2: 画面上の分かりやすいエラー表示
**Objective:** As a GROWI利用者, I want 表示できない理由と対処が画面で分かること, so that これはバグではなく制限だと理解し対応できる

#### Acceptance Criteria
1. When 上限超過を検知する, the GROWI shall 画像の代わりに「PlantUMLサーバのURL長上限のため表示できない」旨を画面に表示する。
2. When 上記メッセージを表示する, the GROWI shall 対処方法（図の分割・簡略化、および管理者向けに自前PlantUMLサーバ＋POST送信の設定）を併記する。
3. If 一部の図が上限超過で表示できない, then the GROWI shall 同一ページ内の他の図・本文の表示を妨げない。

### Requirement 3: コンソール警告
**Objective:** As a 開発者/管理者, I want 開発者ツールで原因が確認できること, so that 調査や問い合わせ対応がしやすい

#### Acceptance Criteria
1. When 上限超過を検知する, the GROWI shall コンソールに、原因（URL長上限超過）と該当を識別できる情報を含む警告を出力する。

### Requirement 4: 判定閾値
**Objective:** As a GROWI管理者, I want 判定が現実のサーバ上限に即していること, so that 表示可否の判断が実挙動と食い違わない

#### Acceptance Criteria
1. The GROWI shall URL長判定の閾値を持つ（既定は一般的なサーバ/プロキシのURL長上限に基づく安全側の値）。
2. Where 閾値を構成可能にする場合, the GROWI shall 既定値を持ちつつ管理者が調整できるようにする。

### Requirement 5: メッセージのi18n
**Objective:** As a 各言語のGROWI利用者, I want メッセージが自分の言語で表示されること, so that 内容を理解できる

#### Acceptance Criteria
1. The GROWI shall 画面メッセージを対応ロケール（en/ja/fr/ko/zh）で提供する。
