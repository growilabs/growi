# Implementation Plan

- [x] 1. メンバー DTO 型定義を作成する
  - `IUserGroupMember`(username/name)、`RelatedGroupsMembers`(groupId → メンバー配列)、`IResRelatedGroupsMembers`(API レスポンス型)の3つの型を `apps/app/src/interfaces/user-group-member.ts` に定義する
  - TypeScript コンパイルが通ることを確認する
  - _Requirements: 1.2, 3.4_

- [ ] 2. Core: バックエンドサービスとフロントエンドフック
- [x] 2.1 (P) グループ別アクティブメンバーを取得するサービスを実装しユニットテストを書く
  - internal/external 両種別のグループ集合を受け取り、各グループの直接所属メンバーをアクティブユーザーのみ・氏名とユーザー名のみを射影して取得するサービス関数を `apps/app/src/server/service/user-group/fetch-active-members-by-group.ts` に作成する
  - 入力グループの relation のみを参照し、親・子孫グループのメンバーを含めない
  - ユニットテスト(`fetch-active-members-by-group.spec.ts`): internal+external 混在グループで両種別メンバーが groupId 別に正しく束ねられること、非アクティブユーザーが除外されること、返却フィールドが name/username のみ(email 等を含まない)であること、メンバー不在グループは空配列であること
  - `pnpm vitest run fetch-active-members` がグリーンになること
  - _Requirements: 1.2, 1.3, 2.2, 2.3, 3.4_
  - _Boundary: Backend/Service_

- [x] 2.2 (P) モーダル表示時のみメンバー写像を遅延取得するフロントエンドフックを追加する
  - `apps/app/src/stores/user.tsx` の既存グループ関連フックの隣に新フックを追加する
  - 引数が false の間はリクエストを送らず、true になった時点でメンバー取得エンドポイント(`/user/related-groups/members`)を呼び出す
  - 戻り値は `RelatedGroupsMembers` の SWR レスポンス型
  - TypeScript コンパイルが通り、ファイルからエクスポートされていること
  - _Requirements: 1.1_
  - _Boundary: Frontend/Store_

- [ ] 3. Integration: API ルートと GrantSelector UI の統合
- [x] 3.1 (P) セッションユーザーの所属グループメンバー一覧を返す API エンドポイントを実装しインテグレーションテストを書く
  - 兄弟エンドポイント(`get-related-groups.ts`)と同じ factory パターン・同じ認可(`accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true })` + `loginRequiredStrictly`)で `apps/app/src/server/routes/apiv3/user/get-related-groups-members.ts` を作成する
  - サーバ側でセッションからグループ集合を導出し(`getUserRelatedGroups(req.user)`)、サービスを呼び出して `res.apiv3({ membersByGroupId })` を返す
  - `apps/app/src/server/routes/apiv3/user/index.ts` に `/related-groups/members` ルートを登録する
  - インテグレーションテスト: 未ログインで 401、ログイン済み一般ユーザーで 200 かつ自分の所属グループのみが写像に含まれること
  - _Requirements: 1.1, 2.1, 3.1, 3.2, 3.3, 3.5_
  - _Boundary: Backend/API_
  - _Depends: 2.1_

- [x] 3.2 (P) GrantSelector にグループ別メンバー一覧表示と i18n ラベルを実装する
  - `apps/app/src/client/components/PageEditor/EditorNavbarBottom/GrantSelector.tsx` の L338 TODO を置き換え、モーダルの開閉状態(`isSelectGroupModalShown`)をフックの有効化条件として使用する
  - 自分が所属するグループ(`userRelatedGroups`)それぞれに、groupId に対応するメンバーの氏名・ユーザー名リストを描画する
  - `<button>` 要素内ではインライン/インラインブロック要素(`<span>`, `<small>` 等)のみを使用し、ブロック要素・インタラクティブ要素は追加しない
  - メンバーが現在ユーザー(`username` 一致)のみの場合は「自分のみ」を示す i18n テキストを表示する
  - 未所属グループ(`nonUserRelatedGrantedGroups`)セクションには何も追加しない
  - `apps/app/public/static/locales/en_US/translation.json` および `ja_JP/translation.json` の `user_group` セクションに必要な翻訳キーを追加する
  - モーダルを開いた際に各グループ下にメンバーが表示され、自分のみグループでは「自分のみ」表示になること
  - _Requirements: 1.1, 1.2, 1.4, 3.2_
  - _Boundary: Frontend/UI, i18n_
  - _Depends: 2.2_

- [ ]* 4.1 GrantSelector でのメンバー表示を手動 E2E 検証する(任意)
  - 開発サーバーを起動し、グループ限定ページのエディタで GrantSelector モーダルを開く
  - 所属グループ下にメンバー(氏名・ユーザー名)が表示されること
  - 自分のみのグループで「自分のみ」表示になること
  - `nonUserRelatedGrantedGroups` のグループにメンバーが表示されないこと
  - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.2_
