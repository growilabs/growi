# Implementation Plan

- [x] 0. 動作確認用ローカルフィードサーバーをセットアップする
  - `/tmp/feed.json` にサンプルフィードファイルを作成する。`emoji` あり・なし（未設定時は 📢 フォールバック確認）、`title`/`body` の多言語フィールド（`ja_JP`, `en_US`）、`url` あり・なし、`conditions.targetRoles`（admin のみ、全ユーザー）の両パターンを含む複数アイテムで構成する
  - devcontainer 内で `cd /tmp && python3 -m http.server 8099` を起動し、`http://localhost:8099/feed.json` でアクセスできることを確認する
  - `.env` に `NEWS_FEED_URL=http://localhost:8099/feed.json` を追加する
  - 以降のタスクで cron 動作確認が必要な場合はこのサーバーを使用する
  - _Requirements: 1.1, 1.6_

- [x] 1. データモデルを実装する
- [x] 1.1 (P) NewsItem モデルを実装する
  - `externalId`（ユニークインデックス）、多言語 `title`/`body`（Map of String）、`emoji`、`url`、`publishedAt`（インデックス）、`fetchedAt`（TTL 90日インデックス）、`conditions.targetRoles` を持つ Mongoose スキーマを定義する
  - 型インターフェース `INewsItem` と `INewsItemHasId` を定義する
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 1.2 (P) NewsReadStatus モデルを実装する
  - `userId`・`newsItemId` の複合ユニークインデックス、`readAt` を持つ Mongoose スキーマを定義する
  - 型インターフェース `INewsReadStatus` を定義する
  - _Requirements: 3.3_

- [x] 2. ニュースサービス層を実装する
- [x] 2.1 ニュース一覧取得ロジックを実装する
  - `listForUser(userId, userRoles, { limit, offset, onlyUnread })` を実装する
  - `conditions.targetRoles` が未設定または `userRoles` に一致するアイテムのみ返すロール別フィルタを適用する
  - NewsReadStatus との突き合わせにより各アイテムに `isRead: boolean` を付与する
  - 結果は `publishedAt` 降順で返す
  - _Requirements: 3.4, 4.1, 4.2_

- [x] 2.2 既読管理ロジックを実装する
  - `markRead(userId, newsItemId)` を実装する。NewsReadStatus を upsert することで冪等性を保証する
  - `markAllRead(userId, userRoles)` を実装する。ロール別フィルタに合致する全未読アイテムを一括既読にする
  - `getUnreadCount(userId, userRoles)` を実装する
  - _Requirements: 3.1, 3.2, 3.5_

- [x] 2.3 フィード同期ロジックを実装する
  - `upsertNewsItems(items)` を実装する。`externalId` をキーに upsert し、`fetchedAt` を更新する
  - `deleteNewsItemsByExternalIds(externalIds)` を実装する
  - _Requirements: 1.2, 1.3_

- [x] 3. News API エンドポイントを実装する
- [x] 3.1 (P) ニュース取得エンドポイントを実装する
  - `GET /apiv3/news/list`（`limit`, `offset`, `onlyUnread` クエリパラメータ）を実装する
  - `GET /apiv3/news/unread-count` を実装する
  - 全エンドポイントに `loginRequiredStrictly` と `accessTokenParser` を適用する
  - _Requirements: 3.4, 3.5, 4.1, 4.2_

- [x] 3.2 (P) ニュース既読操作エンドポイントを実装する
  - `POST /apiv3/news/mark-read`（`newsItemId` を受け取る）を実装する。`newsItemId` を `mongoose.isValidObjectId()` で検証する
  - `POST /apiv3/news/mark-all-read` を実装する
  - 全エンドポイントに `loginRequiredStrictly` と `accessTokenParser` を適用する
  - _Requirements: 3.1, 3.2_

- [x] 3.3 News API ルートをアプリに登録する
  - Express アプリの apiv3 ルーター定義に `news.ts` を追加する
  - _Requirements: 3.1, 3.4_

- [x] 4. NewsCronService を実装する
- [x] 4.1 (P) フィード取得・DB 同期処理を実装する
  - `CronService` を継承し `getCronSchedule()` で `'0 1 * * *'` を返す
  - `executeJob()` を実装する：`NEWS_FEED_URL` 未設定時はスキップ、HTTP GET、取得失敗時はログ記録のみ（既存データ維持）
  - 取得した各アイテムの `growiVersionRegExps` と現バージョンを照合し、不一致アイテムを除外する。不正 regex は try-catch でスキップしてログ警告する
  - フィード外のアイテムを DB から削除し、ランダムスリープ（0–5分）でリクエストを分散する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 4.2 cron をアプリ起動時に登録する
  - アプリの初期化処理で `NewsCronService.startCron()` を呼ぶ
  - _Requirements: 1.1_

- [x] 5. フロントエンド SWR フックを実装する
- [x] 5.1 (P) ニュース用 SWR フックを新設する
  - `useSWRINFxNews(limit, options)` を `useSWRInfinite` ベースで実装する。キーに `limit`, `pageIndex`, `onlyUnread` を含める
  - `useSWRxNewsUnreadCount()` を実装する
  - _Requirements: 5.4, 7.1_

- [x] 5.2 (P) InAppNotification 用の無限スクロール対応フックを追加する
  - 既存 `useSWRxInAppNotifications`（`useSWR` ベース）に加えて `useSWRINFxInAppNotifications(limit, options)` を `useSWRInfinite` ベースで新設する
  - 既存フックは `InAppNotificationPage.tsx` での利用のため維持する
  - _Requirements: 5.4_

- [x] 6. InAppNotification パネルを改修する
- [x] 6.1 フィルタタブを追加する
  - `InAppNotification.tsx` に `activeFilter: 'all' | 'news' | 'notifications'` の state（デフォルト `'all'`）を追加し、`InAppNotificationForms` と `InAppNotificationContent` へ prop として渡す
  - `InAppNotificationForms` に Bootstrap `btn-group` でフィルタボタン（「すべて」「通知」「お知らせ」）を追加する。既存「未読のみ」トグルは維持する
  - _Requirements: 5.2, 5.3_

- [x] 6.2 無限スクロールを導入する
  - `InAppNotificationContent` で `useSWRINFxNews` と `useSWRINFxInAppNotifications` を使用するよう変更する
  - 既存の `InfiniteScroll` コンポーネントをラップしてリストを表示する
  - 既存の `// TODO: Infinite scroll implemented` コメントを解消する
  - _Requirements: 5.4_

- [x] 6.3 「すべて」フィルタ時のクライアントサイドマージを実装する
  - `activeFilter === 'all'` の場合、通知（`createdAt`）とニュース（`publishedAt`）を日時降順でマージして表示する
  - `activeFilter === 'news'` の場合は NewsItem のみ、`activeFilter === 'notifications'` の場合は InAppNotification のみ表示する
  - _Requirements: 5.1, 5.2_

- [x] 7. NewsItem コンポーネントを実装する
- [x] 7.1 (P) ニュースアイテムの表示コンポーネントを実装する
  - `emoji` フィールドをタイトル前に表示する。未設定時は 📢 をフォールバックとする
  - 多言語タイトルをブラウザ言語で解決する。フォールバック順は `browserLocale → ja_JP → en_US → 最初に利用可能なキー`
  - 未読時はタイトルを `fw-bold` + 左端に `bg-primary` 8px 丸ドット、既読時は `fw-normal` + 同幅の透明スペーサーで表示する
  - _Requirements: 5.5, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2_

- [x] 7.2 (P) ニュースアイテムのクリック処理を実装する
  - クリック時に `POST /apiv3/news/mark-read` を呼び、SWR キャッシュを mutate して未読インジケータを更新する
  - `url` が設定されている場合は新しいタブで開く
  - _Requirements: 5.6, 5.7_

- [x] 8. (P) 未読バッジにニュース未読数を合算する
  - `PrimaryItemForNotification` で `useSWRxNewsUnreadCount` を呼び、既存の InAppNotification 未読カウントと合算してバッジに表示する
  - 全ニュースが既読の場合はニュース分のカウントを含めない
  - _Requirements: 7.1, 7.2_

- [x] 9. (P) i18n ロケールファイルを更新する
  - `commons.json` の `in_app_notification` 名前空間に以下のキーを全ロケール（`ja_JP`, `en_US`, `zh_CN`, `ko_KR`, `fr_FR`）に追加する：`news`（お知らせ）、`notifications`（通知）、`all`（すべて）、`no_news`（ニュースはありません）
  - _Requirements: 8.3, 8.4_

- [x] 10. サーバーサイドテストを実装する
- [x] 10.1 NewsCronService のテストを実装する
  - `executeJob()` が正常取得時に upsert・削除を行うことを確認する
  - `NEWS_FEED_URL` 未設定時にスキップすることを確認する
  - フィード取得失敗時に DB データが変更されないことを確認する
  - `growiVersionRegExps` の一致・不一致・不正 regex の各ケースをテストする
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

- [x] 10.2 NewsService のテストを実装する
  - `listForUser()` がロール別フィルタを正しく適用し `isRead` を付与することを確認する
  - `onlyUnread=true` で未読のみ返ることを確認する
  - `markRead()` の冪等性（2回呼んでもエラーなし）を確認する
  - `getUnreadCount()` が `markAllRead()` 後に 0 を返すことを確認する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

- [x] 10.3 News API 統合テストを実装する
  - `GET /apiv3/news/list` がロール別フィルタを強制することを確認する
  - `POST /apiv3/news/mark-read` が冪等であることを確認する
  - 未認証リクエストが 401 を返すことを確認する
  - _Requirements: 3.1, 3.4, 4.1_

- [x] 11. フロントエンドテストを実装する
- [x] 11.1 NewsItem コンポーネントのテストを実装する
  - `emoji` 未設定時に 📢 が表示されることをテストする
  - タイトルのロケールフォールバック（`browserLocale → ja_JP → en_US`）をテストする
  - 未読・既読の視覚表示（`fw-bold`、青ドット、スペーサー）をテストする
  - クリック時に `mark-read` が呼ばれ、`url` がある場合に新タブで開くことをテストする
  - _Requirements: 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2_

- [x]* 11.2 InAppNotification パネルのフィルタ動作をテストする
  - フィルタタブ切り替えで表示対象が変わることを確認する（5.2 の AC カバレッジ）
  - 「未読のみ」トグルとの組み合わせで2重フィルタリングが機能することを確認する（5.3 の AC カバレッジ）
  - _Requirements: 5.2, 5.3_

- [x] 12. 既存コードの不具合修正（実装後検証で発覚）
- [x] 12.1 既存通知の未読ドットを修正する
  - `InAppNotificationElm.tsx` の `grw-unopend-notification` クラスに対応する CSS 定義がコードベースに存在しないため、未読ドットが表示されない
  - NewsItem と同様に `width/height/display: inline-block` のインラインスタイルを追加する
  - _Requirements: 6.1_

- [x] 12.2 全面サイドバー（② dock/drawer モード）での通知表示エリアを拡張する
  - `InAppNotificationSubstance.tsx` の各フィルタ表示エリアに `style={{ maxHeight: '60vh' }}` が固定されており、② dock/drawer モードでもホバーパネル（①）サイズに制限される
  - `useSidebarMode()` で collapsed モードを判定し、collapsed 時のみ `maxHeight: '60vh'` を適用する。dock/drawer モードでは制約を外し、外側の SimpleBar コンテナによるスクロールに委ねる
  - _Requirements: 5.1_

- [x] 12.3 アプリ内通知の未読ドットをクリック時に即時消去する
  - `InAppNotificationSubstance.tsx` の `handleNotificationRead` で `useSWRInfinite` の `mutate(updater, { revalidate: false })` を使って既読状態をキャッシュに書き込もうとしていたが、ナビゲーション（`<a href>`）によってコンポーネントがアンマウントされた後に `useSWRInfinite` のページ単位キャッシュが古い状態に戻るため、ドットが再表示される
  - `useState<Set<string>>` でローカルに開封済み通知 ID を管理し、各 `InAppNotificationElm` のレンダリング時に `status` をその場でオーバーライドすることで、SWR キャッシュに依存せず即時反映を実現する
  - _Requirements: 6.1, 6.2_
