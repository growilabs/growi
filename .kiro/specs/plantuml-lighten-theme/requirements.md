# Requirements Document

## Project Description (Input)
GROWIはPlantUML図の描画時、各図の先頭に約14,000文字のテーマ用スタイル（`carbon-gray-*`。全図種ぶんのskinparam/styleを全部盛り）を付加してからエンコードし、GET（`<img>`）でPlantUMLサーバへ送っている。このテーマ付加がエンコード後URLを約2倍に肥大化させ、大きい図が**URL長超過で描画に失敗する**主因になっている（実測: テーマ有り約8,014字→400／テーマ無し約3,690字）。

本specは、**テーマを軽量化してエンコード後URLを縮め**、GETのままで公開plantuml.comを含む全ユーザーの大きい図の描画を改善する。

### 決定事項（会議で確定）
- **ダークモード対応は維持する**（テーマを完全撤去はしない）。ダークモードで図が見やすい配色（背景・文字・線）を保つ。
- **図の種類に応じてCSSを切り替えない**（図種は増え得るため保守が破綻する）。全図種一律の**単一・静的テーマ**とする。

### 一考の余地あり（設計フェーズで決定）
- **軽量化の程度・手法**（どの定義を残し／削るか、非UML系 `<style>` ブロックの扱い等）。ダークモードの見やすさを保てる範囲で、URL削減効果と見た目のトレードオフを設計で決める。

### 位置づけ / 前提
- テーマを残す以上、URLは完全撤去ほどは縮まない。**上限を無くす対策ではない**（極端に巨大な図はなお超え得る → 残余は `plantuml-oversize-notice`（GET時のエラー表示）と `plantuml-post-optin`（POST）で受ける）。

## Boundary Context
- **In scope**: 付加テーマの軽量化（単一・静的テーマへの置換）、ダークモード配色の維持、不要になった定義・資産の整理、既存テストの更新。
- **Out of scope**: 上限超過時のユーザー向けエラー表示（別spec `plantuml-oversize-notice`）、POST送信の追加（別spec `plantuml-post-optin`）、**図種別のCSS切替**（決定事項として不採用）、テーマの完全撤去（不採用）。
- **Adjacent expectations**: GET送信・`<img>`描画・auto-scroll連携など、テーマ以外の描画挙動は不変。ライト/ダークの判定は現行の仕組みを流用。

## Requirements

### Requirement 1: テーマの軽量化によるURL短縮
**Objective:** As a GROWI利用者, I want PlantUML図に付加するテーマが軽量であること, so that エンコード後URLが縮み、大きい図の描画が改善する

#### Acceptance Criteria
1. The GROWI shall PlantUML図へ付加するテーマを、現行より小さいサイズへ軽量化する。
2. While 軽量化テーマを付加する, when 従来（現行テーマ）でURL長超過により失敗していた図を表示する, the GROWI shall 当該図のエンコード後URLを短縮する。
3. The GROWI shall 公開 plantuml.com を送信先とする既定構成でも本改善を有効にする（自前サーバを要しない）。

### Requirement 2: ダークモード対応の維持
**Objective:** As a ダークモードのGROWI利用者, I want 軽量化後も図がダークモードで見やすいこと, so that 白ベースで浮くことなく図を閲覧できる

#### Acceptance Criteria
1. While ダークモードである, when 図を表示する, the GROWI shall ダークモードに適した配色（背景・文字・線等）で図を描画する。
2. The GROWI shall ライトモード／ダークモードのいずれでも図が判読可能な見た目を維持する。

### Requirement 3: 図種別CSS切替の不採用
**Objective:** As a 保守者, I want 図の種類ごとにCSSを切り替えないこと, so that 新しい図種が増えても保守が破綻しない

#### Acceptance Criteria
1. The GROWI shall 図の種類に応じてテーマ/スタイルを切り替えない（全図種一律の単一テーマを適用する）。

### Requirement 4: 描画機能の後方互換
**Objective:** As a GROWI利用者, I want テーマ軽量化以外の描画挙動が変わらないこと, so that 既存の図表示・スクロールが従来どおり動く

#### Acceptance Criteria
1. The GROWI shall GET送信・`<img>`描画・auto-scroll連携など、テーマ内容以外のPlantUML描画挙動を従来どおり維持する。

### Requirement 5: 不要定義・資産の整理
**Objective:** As a 保守者, I want 軽量化で不要になった定義・資産が残らないこと, so that デッドコードで混乱しない

#### Acceptance Criteria
1. When テーマを軽量化する, the GROWI shall 参照されなくなった定義・資産を除去する。
2. The GROWI shall 変更後に型チェック・リント・テストが通る状態を維持する。
