# Requirements Document

## Introduction

GROWI の InAppNotification にニュース配信・表示機能を追加する。外部の静的 JSON フィード（GitHub Pages）を GROWI 本体が cron で定期取得し、ローカル MongoDB にキャッシュした上で、InAppNotification の各 UI（ドロップダウン、サイドバー、通知ページ）にニュースとして表示する。ユーザーごとの既読/未読管理、ロール別の表示制御、多言語対応を含む。

## Requirements

### Requirement 1: ニュースフィードの定期取得

**Objective:** As a GROWI 運営者, I want GROWI が外部フィードからニュースを自動取得する, so that 各 GROWI インスタンスに最新のニュースが配信される

#### Acceptance Criteria

1. When cron スケジュールの実行時刻に達した場合, the News Cron Service shall 設定された URL から JSON フィードを HTTP GET で取得する
2. When フィードの取得に成功した場合, the News Cron Service shall 取得したニュースアイテムをローカル MongoDB に upsert（`externalId` で重複排除）する
3. When フィードに含まれなくなったニュースアイテムがある場合, the News Cron Service shall 該当アイテムをローカル DB から削除する
4. When 複数の GROWI インスタンスが同時に取得を試みる場合, the News Cron Service shall ランダムスリープにより配信元へのリクエストを時間分散する
5. If フィードの取得に失敗した場合, then the News Cron Service shall エラーをログに記録し、既存のキャッシュデータを維持する
6. Where `NEWS_FEED_URL` が未設定または空の場合, the News Cron Service shall フィード取得をスキップしエラーなく動作する
7. When ニュースアイテムに `growiVersionRegExps` 条件が設定されている場合, the News Cron Service shall 現在の GROWI バージョンと照合し、一致しないアイテムを除外する

### Requirement 2: ニュースアイテムのローカルキャッシュ

**Objective:** As a GROWI システム, I want 取得したニュースをローカル DB にキャッシュする, so that フィード配信元に障害が起きてもニュースを表示できる

#### Acceptance Criteria

1. The NewsItem モデル shall `externalId` にユニークインデックスを持ち、重複登録を防止する
2. The NewsItem モデル shall `publishedAt` にインデックスを持ち、公開日時順のソートを効率的に行う
3. The NewsItem モデル shall `fetchedAt` に TTL インデックス（90日）を持ち、古いニュースを自動削除する
4. The NewsItem モデル shall 多言語対応のタイトル・本文（`ja_JP`, `en_US`）を格納できる

### Requirement 3: 既読/未読管理

**Objective:** As a GROWI ユーザー, I want ニュースの既読/未読状態を管理したい, so that 新しいニュースを見逃さない

#### Acceptance Criteria

1. When ユーザーがニュースアイテムをクリックした場合, the News API shall 該当ユーザーとニュースアイテムの組み合わせで `NewsReadStatus` レコードを作成する
2. While `NewsReadStatus` レコードが存在しない場合, the News API shall 該当ニュースを未読として扱う
3. The NewsReadStatus モデル shall `userId + newsItemId` の複合ユニークインデックスにより重複登録を防止する
4. When ニュース一覧を取得する場合, the News API shall 各ニュースアイテムに `isRead: true/false` を付与して返却する
5. The News API shall ログインユーザーの未読ニュース数を返却するエンドポイントを提供する

### Requirement 4: ロール別表示制御

**Objective:** As a GROWI 管理者, I want ニュースの表示対象をロールで制御したい, so that 管理者向け情報を一般ユーザーに見せない

#### Acceptance Criteria

1. When ニュースアイテムに `conditions.targetRoles` が設定されている場合, the News API shall ユーザーのロール（admin/general）に基づいてフィルタリングする
2. Where GROWI の設定で `app:newsTargetRole` が `admin_only` に設定されている場合, the News API shall 管理者以外のユーザーにはニュースを返却しない
3. When ニュースアイテムに `conditions.targetRoles` が未設定の場合, the News API shall 全ユーザーにニュースを表示する

### Requirement 5: InAppNotification UI 統合

**Objective:** As a GROWI ユーザー, I want 既存の InAppNotification UI でニュースを確認したい, so that 通知と同じ導線でニュースにアクセスできる

#### Acceptance Criteria

1. The InAppNotification ドロップダウン shall ニュースセクションを通知リストと区別して表示する
2. The InAppNotification サイドバー shall ニュースセクションを通知リストの上部に表示する
3. The InAppNotification ページ (/me/all-in-app-notifications) shall 「ニュース」タブを提供し、全ニュースアイテムを一覧表示する
4. When ユーザーがニュースアイテムをクリックした場合, the InAppNotification UI shall ニュースの詳細 URL を新しいタブで開く
5. When ユーザーがニュースアイテムをクリックした場合, the InAppNotification UI shall 該当ニュースを既読としてマークし、未読インジケータを更新する

### Requirement 6: 未読バッジ表示

**Objective:** As a GROWI ユーザー, I want 未読ニュースの存在をバッジで把握したい, so that 新しいニュースがあることに気づける

#### Acceptance Criteria

1. The サイドバー通知アイコン shall 通知の未読数とニュースの未読数を合算してバッジに表示する
2. The ヘッダードロップダウンの通知アイコン shall 通知の未読数とニュースの未読数を合算してバッジに表示する
3. When 全てのニュースが既読の場合, the バッジ shall ニュース分のカウントを含めない

### Requirement 7: 多言語対応

**Objective:** As a GROWI ユーザー, I want ニュースを自分の言語で読みたい, so that 内容を正しく理解できる

#### Acceptance Criteria

1. When ニュースアイテムに複数言語のテキストが含まれる場合, the NewsItem コンポーネント shall ブラウザの言語設定に応じたテキストを表示する
2. If ブラウザの言語に対応するテキストが存在しない場合, then the NewsItem コンポーネント shall `en_US` → `ja_JP` の順にフォールバックする
3. The UI ラベル（「ニュース」「ニュースはありません。」等） shall `ja_JP` と `en_US` の i18n ロケールファイルで提供する
