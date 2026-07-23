# Requirements Document

## Introduction

ニュース一覧ページ `/_news` にニュース画像を表示する。配信フィード(GitHub Pages 上の feed.json)に追加される画像情報(フィードからの相対パス + ロケール別代替テキスト)をアプリ側で取り込み・検証し、各ニュースアイテムの本文下に専用スロットとして描画する。

v8 リリース前の master マージを目標とした最小スコープであり、新規外部依存ゼロ・データマイグレーション不要・追加設定不要で、フィード側の対応(スキーマ v1.1)と独立してリリース可能であることを制約とする。設計判断の経緯は `tmp/news-feature-plan.md`(2026-07-14 設計決定、2026-07-23 検証強化)に記録済み。

## Boundary Context

- **In scope**: 画像情報の取込・検証・保存、`/_news` での画像表示、取得失敗時のフォールバック
- **Out of scope**: サイドバー通知パネルへのサムネイル表示 / 画像のサーバ側保存・プロキシ配信 / 画像クリックでの拡大表示 / 幅・高さ情報によるレイアウトシフト予約 / 配信側リポジトリ(growi-news-feed)のスキーマ・CI・画像配置の変更(別作業として後続)
- **Adjacent expectations**: 配信側はフィードと同じ配置場所の `images/` 配下に画像ファイルを置き、フィードからの相対パスで参照する。配信側・アプリ側のどちらが先にリリースされても他方に影響しない(旧アプリは画像情報を無視し、新アプリは画像なしフィードで従来どおり動作する)
- **親 spec**: `news-inappnotification`(ニュース基盤 Req 1–11 はそちらが正。本 spec はその上に画像表示のみを追加する)

## Requirements

### Requirement 1: 画像メタデータの取込と検証

**Objective:** As a GROWI 運営者, I want フィードに載せた画像情報が安全に検証された上で各インスタンスに取り込まれること, so that 配信内容を画像付きにしても各インスタンスの安全性が損なわれない

#### Acceptance Criteria

1. When フィードのニュースアイテムに画像情報(相対パス + 代替テキスト)が含まれる場合, the News Cron Service shall 相対パスを配信フィード基準の絶対 URL に解決し、ニュースアイテムと共に保存する
2. The News Cron Service shall 解決後の画像 URL が https であり、かつ配信フィードの配置場所配下の画像ディレクトリ(`images/`)を指す場合のみ受け入れる(配信元と同一ホスト上の別サイトを指す URL は受け入れない)
3. The News Cron Service shall 画像の相対パスとして許可する文字と形式を限定し(英数字・`.`・`_`・`-` のみのファイル名、拡張子 png/jpg/jpeg/webp)、パス 200 文字・代替テキスト各 500 文字の長さ上限を適用する
4. If 画像情報が検証に失敗した場合, then the News Cron Service shall 当該ニュースアイテムを画像なしで取り込み続け、警告ログを記録する
5. When ニュースアイテムに画像情報が無い場合, the News Cron Service shall 画像を持たないニュースとして保存する(空の画像情報を作らない)

### Requirement 2: /_news での画像表示

**Objective:** As a GROWI ユーザー, I want ニュースに添えられた画像を一覧ページで見たい, so that テキストだけでは伝わりにくいニュースの内容を視覚的に理解できる

#### Acceptance Criteria

1. Where ニュースアイテムが検証済みの画像を持つ場合, the /_news ページ shall 本文の下の専用スロットに画像を表示する
2. The /_news ページ shall 画像の代替テキストをユーザーのロケールで解決して提供する(タイトル・本文と同じフォールバック順)
3. The /_news ページ shall 画像の表示高さに上限を設け、一覧のレイアウトを崩さない
4. The /_news ページ shall 画面外の画像を表示領域に近づくまで取得しない
5. The /_news ページ shall 画像取得リクエストにおいて GROWI インスタンスの URL を配信元へ送信しない
6. If 保存済みの画像 URL が http(s) 以外を指す場合, then the /_news ページ shall 当該画像を表示しない(取込時検証に加えた表示時の再検証)

### Requirement 3: 画像取得失敗時のフォールバック

**Objective:** As a GROWI ユーザー, I want 画像が取得できない環境や状況でもニュース自体は問題なく読めること, so that ネットワーク制約や配信側の不備で機能全体が損なわれない

#### Acceptance Criteria

1. If 画像の取得に失敗した場合, then the /_news ページ shall 当該画像のみを非表示にし、ニュースのタイトル・本文・リンクの表示を維持する
2. When ページ切替等により表示対象の画像が変わった場合, the /_news ページ shall 以前の取得失敗状態を新しい画像に引き継がない

### Requirement 4: 互換性とリリース独立性

**Objective:** As a GROWI 管理者, I want この機能追加が既存環境に影響を与えず追加作業も不要であること, so that バージョンアップだけで安全に機能を受け取れる

#### Acceptance Criteria

1. When フィードに画像情報が含まれない場合, the GROWI shall 従来どおりの表示・動作を維持する
2. The 本機能 shall 既存データのマイグレーション・追加の設定項目・新規外部依存なしで動作する
3. The サイドバー通知パネル shall 本機能の追加後もテキストのみの表示を維持する
