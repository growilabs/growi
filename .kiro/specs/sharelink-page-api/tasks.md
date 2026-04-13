# Implementation Plan

- [ ] 1. (P) ShareLink バリデーションサービスの実装とテスト
- [ ] 1.1 (P) ShareLink のデータベースバリデーション関数を実装する
  - share link ID とページ ID の両方を照合条件とした単一クエリで ShareLink を取得し、ミドルウェアで行っていた二重クエリを解消する
  - 照合成功・リンク未存在/pageId 不一致・期限切れの 3 パターンを判別可能な結果型（discriminated union）で返す
  - `disableLinkSharing` 設定の確認はハンドラー層に委ねて関数の責務を DB バリデーションのみに限定する
  - `server/service/share-link/` ディレクトリを新規作成してこのサービスを配置し、将来的に他ルートからも再利用できる構造にする
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 1.2 (P) バリデーション関数のユニットテストを実装する
  - 有効なリンク（ShareLink が存在・relatedPage が一致・期限内）のとき成功結果を返すことを確認する
  - ShareLink が存在しない、または relatedPage が pageId と不一致のとき "not-found" 結果を返すことを確認する
  - `isExpired()` が true のとき "expired" 結果を返すことを確認する
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 2. (P) ページレスポンスユーティリティの抽出とテスト
- [ ] 2.1 (P) 既存ページ取得ハンドラー内のレスポンス生成ロジックを共有ユーティリティとして抽出する
  - `GET /page` ハンドラー内のインライン関数（ページデータ・meta を受け取って API レスポンスを返す処理）を独立したモジュール関数に変換する
  - レスポンスオブジェクト・ページデータ・オプション（revisionId・disableUserPages）を引数として受け取るよう設計する
  - 既存の `GET /page` ハンドラーがこのユーティリティを import して使用するよう書き換え、動作が変わらないことを確認する
  - _Requirements: 5.3_

- [ ] 2.2 (P) レスポンスユーティリティのユニットテストを実装する
  - ページが forbidden（`isForbidden: true`）のとき 403 が返ることを確認する
  - ページが見つからない（`isNotFound: true`）のとき 404 が返ることを確認する
  - `disableUserPages` が有効なユーザーページで 403 が返ることを確認する
  - 正常ページで `{ page, meta }` を含むレスポンスが返ることを確認する
  - _Requirements: 1.4, 3.1, 3.2, 3.3, 3.4_

- [ ] 3. share link 専用エンドポイントの実装・登録・テスト
- [ ] 3.1 `GET /page/shared` ハンドラーを実装してルーターに登録する
  - `shareLinkId` と `pageId` の両方を MongoId 形式の必須パラメータとして受け取る（`optional()` を使用しない）
  - リクエスト処理の最初のゲートとして `disableLinkSharing` 設定を確認し、無効時は 403 を返す
  - Task 1 のバリデーション関数を呼び出し、"not-found" 結果には 404、"expired" 結果には 403 を返す
  - バリデーション成功後に `isSharedPage: true` オプションでページデータを取得し、Task 2 のレスポンスユーティリティで返す
  - 認証ミドルウェア（`accessTokenParser`・`loginRequired`・`certifySharedPage`）を一切使用しない公開エンドポイントとする
  - ページルーターに `GET /shared` として登録し、`getPageInfoHandlerFactory` と同じパターンで組み込む
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5, 3.1, 4.1, 4.2, 4.3, 5.1, 5.4_

- [ ] 3.2 エンドポイントの統合テストを実装する
  - 有効な shareLinkId と pageId を指定したリクエストが 200 で `{ page, meta }` を返し、`isMovable: false` であることを確認する
  - 期限切れリンクで 403 `share-link-expired` が返ることを確認する
  - 存在しない shareLinkId または pageId 不一致で 404 `share-link-not-found` が返ることを確認する
  - `disableLinkSharing=true` の状態で 403 `link-sharing-disabled` が返ることを確認する
  - `shareLinkId` または `pageId` を省略したリクエストで 400 が返ることを確認する
  - _Requirements: 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 4.1_

- [ ] 4. クライアント更新と既存ルートのクリーンアップ
- [ ] 4.1 share link アクセス時のページ取得 API 呼び出しを新エンドポイントに切り替える
  - `shareLinkId` が存在するかどうかで呼び出し先を `/page/shared` と `/page` に条件分岐させる
  - パラメータ構造（`shareLinkId` + `pageId`）は既存の `buildApiParams` の出力をそのまま使用できるため変更不要であることを確認する
  - _Requirements: 1.1, 1.3_

- [ ] 4.2 `GET /page` ルートから share link 関連コードを除去してシンプル化する
  - `certifySharedPage` をミドルウェアチェーンから除去する
  - `isSharedPage` 条件分岐をハンドラーから除去する
  - `shareLinkId` パラメータバリデーターをバリデーター定義から除去する
  - **必須**: Task 4.1 のクライアント更新と同一デプロイで実施すること。先に除去すると未移行クライアントが share link アクセス時に `loginRequired` によりブロックされる
  - _Requirements: 5.2, 5.3_
