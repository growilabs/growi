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

- [x] 13. PR レビュー FB 対応によるコード品質改善
- [x] 13.1 型アサーションを排除する（FB ①）
  - `interfaces/in-app-notification.ts` に `IInAppNotificationHasId = IInAppNotification & HasObjectId` を追加
  - `stores/in-app-notification.ts` で `apiv3Get<InAppNotificationPaginateResult>()` にジェネリクスを注入し、`response.data as ...` を削除
  - `InAppNotificationSubstance.tsx` の `allModeSWRResponse` を `SWRInfiniteResponse<PaginateResult<INewsItemWithReadStatus>, Error>` として明示的に宣言し、`as unknown as Parameters<typeof InfiniteScroll>[0]...` を撤去
  - `notificationResponse.data.flatMap(...) as (IInAppNotification & HasObjectId)[]` の cast を削除（型情報が自然に流れる）
  - _Requirements: 品質改善_
- [x] 13.2 SWR state-less による未読ドット即時消去へ差し替える（FB ②）
  - 12.3 で採用した `useState<Set<string>>` を撤去し、`notificationResponse.mutate((pages) => ..., { revalidate: false })` による SWR ネイティブの楽観更新に置換
  - `SWRConfig` プロバイダのキャッシュ Map がアンマウント／リマウントを跨いで保持されるため、再マウント時もドットは消えたまま（実機検証済み）
  - SWR のキャッシュ・hook の利点を損なわない実装とする
  - _Requirements: 品質改善, 6.1, 6.2_
- [x] 13.3 NewsItem の言語ユーティリティと Bootstrap クラスを既存パターンに統一する（FB ③）
  - `navigator.language` の独自ロジックを撤去し、`useTranslation()` の `i18n.language` を使用（`ActivityListItem` と同パターン）
  - 日付表示を `date-fns` `format` + `getLocale(i18n.language)` に統一
  - button のインラインスタイル（`cursor/width/textAlign/background`）を Bootstrap クラス `w-100 text-start bg-transparent` に置換
  - emoji span の `fontSize/lineHeight` を `fs-5 lh-1` に置換
  - 未読ドットのインラインスタイルを `UnreadDot.module.scss` の共通 CSS Module に抽出し、`NewsItem.tsx` と `InAppNotificationElm.tsx` の両者から参照して見た目を統一
  - `browserLanguage` prop を廃止し、テストも i18n モックへ合わせて更新
  - _Requirements: 品質改善_

- [x] 14. 管理画面からの配信トグルと取込の堅牢化（実装済み・タスク後追い記録。requirements/design は反映済みだった範囲）
- [x] 14.1 配信トグルを実装する
  - `news:isDeliveryEnabled`（`defaultValue: true`、envVarName なし）を config-definition に追加し、cron 発火時に false ならスキップする
  - admin 用エンドポイント（GET は READ scope）と `/admin/app` の UI トグルを実装する
  - フィード URL を env 設定からコード内蔵（ハードコード）へ変更する
  - _Requirements: 9.1–9.7_
- [x] 14.2 フィード取込を堅牢化する
  - フィード JSON を zod で検証する（アイテム単位の fail-soft、http(s) 以外の url を ingest 時に排除）
  - フィード応答サイズを 5 MiB、list API の limit を 100 に制限する
  - フィードから外れたアイテムを DB から削除する
  - upsert を `bulkWrite`（ordered: false）にバッチ化し、取得を夜間 5 時間ウィンドウにランダム分散する
  - アクセストークン scope `features.in_app_notification` を導入する
  - _Requirements: 1.2, 1.3, 1.4, 2.1_

- [x] 15. ニュース一覧ページ /_news を実装する（マージ済み: PR #11317, #11373 ほか）
- [x] 15.1 NewsFeed ページを実装する
  - 予約システムパス `/_news` に一覧ページを追加する（emoji/タイトル/日付/body/「詳細を見る」）
  - body はプレーンテキスト + `pre-wrap` で描画し、url は `isSafeHttpUrl` で描画時再検証する
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8_
- [x] 15.2 サイドバー NewsItem のクリック挙動を変更する
  - 「詳細 URL を新タブで開く」を「既読化して `/_news#news-<id>` へ遷移」に置き換える（Requirement 5.6 改訂）
  - _Requirements: 5.6, 5.7, 10.6_
- [x] 15.3 アンカーの sticky ヘッダーオフセットを実装する
  - `scroll-margin-top: $grw-scroll-margin-top-in-view` を news-item セクションに適用する
  - _Requirements: 10.6_

- [x] 16. /_news をページネーションに置き換える（PR #11416、レビュー中）
- [x] 16.1 単一ページ取得とページャを実装する
  - `useSWRxNewsPage`（`keepPreviousData`）+ `PaginationWrapper` で無限スクロールを置換する
  - `parsePageQuery` を純関数として抽出し境界テストを併設する
  - `NEWS_PER_PAGE` を `consts.ts` に集約し3箇所（サイドバー news ストリーム / NewsFeed / use-news）で共有する
  - _Requirements: 11.1, 11.2, 11.3, 11.6_
- [x] 16.2 サイドバーからのページ直接遷移を実装する
  - news id → SWRInfinite ページ index マップから `?page=N` を導出して遷移する
  - 未読フィルタ ON 時はページ対応が成立しないため `?page` を省略する（レビュー指摘 High の対応）
  - _Requirements: 11.4, 11.7_
- [x] 16.3 アンカースクロールを once-per-navigation 化する
  - トリガーを `data` 参照 + `asPath` にし、`scrolledForPathRef` でナビゲーションごと 1 回を保証する（`keepPreviousData` 下で新旧ページ同数のとき再発火しない退行の修正）
  - _Requirements: 11.5_
- [x] 16.4 テストを整備する
  - `NewsFeed.spec.tsx`（9件、アンカー退行ガードは旧実装で fail することを実証）、`parse-page-query.spec.ts`（10件）、`NewsItem.spec.tsx` へ非ゼロ pageIndex / pageIndex 未指定ケースを追加
  - _Requirements: 10.7, 10.8, 11.1–11.7_
