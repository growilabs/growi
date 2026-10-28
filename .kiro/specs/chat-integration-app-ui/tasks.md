# Implementation Plan — chat-integration-app-ui

> umbrella: [chat-integration](../chat-integration/)。要件は [requirements.md](./requirements.md)、設計は [design.md](./design.md)。
> `chat-integration-app` は実装済み。この spec は amend spec なので、**最後の第 6 章で、変更を対象の spec へ書き戻し、この spec を削除する**（`.claude/rules/spec-lifecycle.md`）。

**手を入れる範囲**: `apps/app/src/features/chat-integration/`、`apps/app/src/pages/me/`、`SavePageControls.tsx`（向きの指定の 2 行）、`apps/app/public/static/locales/` の 5 言語。proxy と `@growi/chat` には手を入れない。
**触れない部品**: `CapabilityReportTable`、`ChannelPermissionsSection`、`NotificationDestinationsSection`（ファイルも、`RelationRow` の中での並びも変えない）。

**進め方**:
- 動作を変えるタスク（★）は、**先に落ちるテストを書き**（RED）、出力を実装者の報告に残してから実装する（GREEN）。テストを書く前に `essential-test-design` と `essential-test-patterns` を読む
- 新しいキーを足すタスクの完了条件は、5 言語の訳が揃い、`pnpm run lint:i18n` が**基準値を変えずに**通ること
- 第 1〜4 章は互いに独立している。`pnpm install` は走らせない（別のビルド・テストと同時に走らせると失敗する。`.claude/rules/devcontainer.md`）

---

- [x] 1. 注文に表示名を保存し、承認画面へ返す
- [x] 1.1 ★ 注文を作るとき、チャットアカウントの表示名を保存する
  - `chat_account_link_orders` に `accountDisplayName`（任意、既定 `null`）を足す。型 `IChatAccountLinkOrder` にも足す
  - `findOrCreatePendingAccountLinkOrder` が新しい注文を作るとき `actor.displayName` を保存する（前後の空白を落とし、空なら `null`）。使い回す注文は書き換えない
  - model の `allFields` の確認に新しい列を足す
  - 観察できる完了条件: 新しい注文に表示名が保存され、使い回した注文は変わらず、空白だけの表示名は `null` になることが、`create-link-order.spec.ts` と model の spec で示される
  - _Requirements: 7.11_

- [x] 1.2 ★ 承認画面へ返す表示データに、表示名・ユーザー名・有効期限を含める
  - `getAccountLinkOrderForApproval` の `display` に `accountDisplayName` と `growiName`（承認しているユーザーの `name`）を足す。`expiresAt` は既に返しているので、`account-link-router.ts` が JSON にして返すことを確かめる
  - 観察できる完了条件: 表示名のある注文と無い注文の両方で、期待した項目が返ることが `account-link-service.spec.ts`（と、経路まで通す `account-link-router.spec.ts`）で示される
  - _Requirements: 7.10, 7.11, 7.12_
  - _Depends: 1.1_

- [ ] 2. 承認画面を作り直す
- [x] 2.1 承認画面と専用ページの文言を 5 言語で用意する
  - `translation.json` に `chat_integration.account_link.*` を足す: ページの見出し、画面の見出し、3 つの塊の見出し（この GROWI・あなた・紐付けるチャットのアカウント）、`ID`、有効期限の文、「心当たりがなければ承認せずに閉じてください」、承認ボタン、結果 3 種（成功・別のユーザーに紐付け済み・無効または期限切れ）、読み込み中
  - en_US・ja_JP・zh_CN・fr_FR・ko_KR の 5 言語すべてに訳を入れる。基準値は変えない
  - 観察できる完了条件: `pnpm run lint:i18n` が、基準値を変えずに通る
  - _Requirements: 7.9, 7.10, 7.12_

- [x] 2.2 ★ 承認画面を、3 つの塊を並べたカードに作り直す
  - 「この GROWI」（`useAppTitle()` と `useSiteUrl()` のホスト名）、「あなた」（`growiName` と `@growiUsername`）、「紐付けるチャットのアカウント」（サービス名・workspace 名・`relationLabel`・表示名があれば表示名と `accountId`）を、定義リスト（`dl`）で並べる
  - 有効期限（`expiresAt`）と「心当たりがなければ承認せずに閉じてください」を出す。表示名が無い注文は `accountId` だけを出す
  - 結果の画面（成功・別のユーザーに紐付け済み・無効または期限切れ）を同じカードの中に出す。文言は 2.1 のキーを使う
  - トークンは `router.query.token` から読む
  - 観察できる完了条件: 3 つの塊が区別して出る、表示名があるとき表示名と識別子の両方が出る、無いとき識別子だけが出る、有効期限が出る、承認の結果 3 種が出る、ことが `AccountLinkApproval.spec.tsx` で示される
  - _Requirements: 7.10, 7.11, 7.12_
  - _Depends: 1.2, 2.1_

- [ ] 2.3 ★ 承認画面を、サイドバーの無い専用ページで出す
  - `pages/me/chat-integration/account-link/[token].page.tsx` を足し、`RawLayout` で包む（`BasicLayout` と、そのための設定の取得は使わない）。`getServerSideProps` は共通のプロパティと `translation` の i18n だけを取る
  - `pages/me/[[...path]].page.tsx` から `chat-integration` の項目と `AccountLinkApproval` の dynamic import を消す。`[[...path]].page.spec.tsx` の対応するテストを、専用ページの spec へ移す
  - URL（`/me/chat-integration/account-link/:token`）と、`ACCOUNT_LINK_ACCEPT_PATH` は変えない
  - 観察できる完了条件: 専用ページの表示にサイドバー（`BasicLayout`）が含まれないこと、`router.query.token` の承認画面が描かれることが spec で示される。`[[...path]]` のほかの項目（個人設定・通知）の既存のテストが変わらず通る
  - _Requirements: 7.9_
  - _Depends: 2.2_

- [ ] 2.4 追加した page ファイルが Express の経路の一覧と食い違わないことを確かめる
  - `next-express-route-consistency` スキルの手順で、`utils/is-next-page-route.ts` の `EXPRESS_EXCLUSIVE_PATH_PATTERNS` と、`server/routes/index.js` の `/me/*`、新しい page ファイルを突き合わせる
  - 食い違いがあれば、一覧の修正を報告する（黙って直さない）。食い違いが無ければ、無かったことを報告する
  - 観察できる完了条件: スキルの手順の結果（差分の有無）が、実装者の報告に書かれている
  - _Requirements: 7.9_
  - _Depends: 2.3_

- [ ] 3. 保存時の通知先の選択部品を、高さが変わらない形にする
- [ ] 3.1 選択部品の文言を 5 言語で用意する
  - `translation.json` に `chat_integration.destination_select.*` を足す: ボタンのラベル（0 件のとき・`{{count}}` 件のとき）、`(private)`、一部の workspace を取得できなかったことの印の説明と、メニュー内の警告、ボタンの `aria-label`
  - 5 言語すべてに訳を入れる。基準値は変えない
  - 観察できる完了条件: `pnpm run lint:i18n` が、基準値を変えずに通る
  - _Requirements: 2.13, 2.14_

- [ ] 3.2 ★ 選択部品を、トグルのボタンとチェックボックスのメニューに作り直す
  - 既存の `ChatIntegrationDestinationSelect.spec.tsx` を、`listbox`・`selectOptions` から `checkbox` を使う形に書き換える。**保つ契約の 4 つ**（自由入力が無い、出力は `relationId`・`platform`・`channelId` だけ、同じ `channelId` の 2 つの workspace を取り違えない、紐づく workspace が無ければ何も描かない）を先に書いて、新しい実装でも通ることを確かめる
  - ボタンに選択件数を出す。メニューは workspace ごとの見出し + チェックボックス。`max-height: 50vh` で中をスクロールする。1 つ選んでもメニューを閉じない。取得できなかった workspace があればボタンに警告の印、メニューに詳細を出す
  - `openInModal?: boolean` を足し、メニューの向きを `GrantSelector` と同じにする（既定は上向き、`openInModal` のときは下向き）
  - reactstrap 9.2.2 で、`container="body"` のメニュー内のクリックでメニューが閉じないことを確かめる。閉じる場合は、メニューの `onClick` で伝播を止める（design.md の 1 の「開いたままにする」）
  - 観察できる完了条件: 保つ契約の 4 つが通る。チェックを 1 つ入れてもメニューが開いたままである。チャンネルを 50 件にしても、ボタンの要素の数（操作欄に並ぶ要素）が 1 件のときと同じである。件数がボタンに出る。取得できなかった workspace がメニューに出る
  - _Requirements: 2.12, 2.13, 2.14_
  - _Depends: 3.1_

- [ ] 3.3 ★ 保存の操作欄から、選択部品へ向きを渡す
  - `SavePageControls.tsx` の 2 か所の使用箇所のうち、モーダルの中の方へ `openInModal` を渡す
  - `SavePageControls.spec.tsx` の既存の 2 件を、`checkbox` を使う形に書き換える
  - 観察できる完了条件: 選んだチャンネルが `chatIntegrationDestinations` として保存に載ること、何も選ばなければ空であることが spec で示される。Gen 1 の項目（`slackChannels`・`isSlackEnabled`）が変わらない
  - _Requirements: 2.12_
  - _Depends: 3.2_

- [ ] 4. 接続が切れた関係を、管理画面が正しく示す
- [ ] 4.1 ★ proxy が署名を受け付けなかったことを、失敗の種類として分ける
  - `proxy-client.ts` の `ProxyCallFailure` に `rejected` を足し、署名付きの呼び出しで応答が 401 のとき返す。ほかの 2xx 以外は `http-error` のまま。型の説明に、理由が分からないこと（proxy は拒否の理由を返さない）を書く
  - `ProxyCallFailure` を `switch` で網羅している箇所が無いこと（足して型検査が通ること）を確かめる
  - `admin-router.spec.ts` に、`fetchConnectionStatus` が `rejected` を返したとき、502 と `rejected` の code が返ることを足す（401 を返さない）
  - 観察できる完了条件: `proxy-client.spec.ts` で 401 → `rejected`、500 → `http-error`、接続失敗 → `unreachable` が示される。`admin-router.spec.ts` で code が届くことが示される。型検査が通る
  - _Requirements: 9.9, 9.11_

- [ ] 4.2 ★ 関係のバッジを決める純粋関数を作る
  - `client/admin/relation-connection-state.ts` に `deriveRelationBadge(state, connectionStatusError)` と `isConnectionRejected(error)` を作る。入力と結果は design.md の表の 5 行
  - **`error` と古い `data` が同時にある場合を含む**（SWR は失敗しても前の成功値を返し続ける）
  - 観察できる完了条件: 5 行の組み合わせと、`apiv3` の失敗の形（配列の `errors[0].code`）の読み取りが `relation-connection-state.spec.ts` で示される
  - _Requirements: 9.9, 9.11_
  - _Depends: 4.1_

- [ ] 4.3 接続が切れたときの文言を 5 言語で用意する
  - `admin.json` に `chat_integration.connection_lost.badge` と `.detail`（原因を断定しない説明、「Disconnect」で片付けられること、再度ペアリングを試す案内）を足す。**`translation.json` ではなく `admin.json`**（管理画面は `admin` namespace だけを読み込む）
  - 5 言語すべてに訳を入れる。基準値は変えない
  - 観察できる完了条件: `pnpm run lint:i18n` が、基準値を変えずに通る
  - _Requirements: 9.10_

- [ ] 4.4 ★ 管理画面の関係の行に、接続が切れた状態を出す
  - `RelationRow` のバッジを `deriveRelationBadge` の結果で出す。「Connection」の行で、`rejected` のとき説明文を出し、古い `health` は出さない。ほかの失敗では今の「Failed to load connection status」のまま
  - `RelationRow` の中の並び、`CapabilityReportTable`・`ChannelPermissionsSection`・`NotificationDestinationsSection`・`UnpairButton` の呼び出しは変えない。`useTranslation` を足すので、`AdminChatIntegration.spec.tsx` の `next-i18next` の差し替えを確かめる
  - 観察できる完了条件: 接続の状態が `rejected` の関係に「active」でなく「接続が切れています」が出る、説明文と「Disconnect」が出る、**前に成功した `connected` が出ない**、署名の拒否以外の失敗では緑の「active」のままである、切れていない関係は今までどおり、ことが `AdminChatIntegration.spec.tsx` で示される。既存のテスト（表・権限・宛先・解除）が変わらず通る
  - _Requirements: 9.9, 9.10, 9.11, 9.12_
  - _Depends: 4.2, 4.3_

- [ ] 5. 全体を確かめる
- [ ] 5.1 検査とテストを通す
  - `apps/app` で `pnpm run lint`（型検査・Biome・`route-top-level-guard`・`lint:i18n` を含む）と、触れたファイルのテスト（`pnpm vitest run <部分名>`）を通す。`npx` は使わない
  - `tools/i18n-audit/baseline.json` が変わっていないことを `git diff` で確かめる
  - 観察できる完了条件: 検査とテストが通り、`baseline.json` の差分が無い
  - _Requirements: 2.12, 2.13, 2.14, 7.9, 7.10, 7.11, 7.12, 9.9, 9.10, 9.11, 9.12_
  - _Depends: 2.4, 3.3, 4.4_

- [ ] 5.2 開発サーバで 3 つの画面を実際に確かめる
  - 開発サーバを起動する（`apps/app/.claude/skills/app-commands/SKILL.md` の Smoke Testing の手順。devcontainer では起動できる）
  - 編集画面: チャンネルを 30 件ほど用意した状態で、保存の操作欄の高さが変わらないこと、メニューが画面からはみ出さずスクロールできること、狭い画面（モーダル）でも使えることを画面で見る
  - 管理画面: 関係を登録したあと、proxy 側の鍵を消して（チャットの `@GROWI unregister`、または proxy の関係の削除）、「接続が切れています」が出て緑の「active」が出ないことを見る。ペアリングし直して元に戻ることも見る。ペアリングに使えるチャット環境が無い場合は、できなかったことを報告に書く（できたことにしない）
  - 承認画面: 注文を 1 件作って（チャットの `link`、または注文のドキュメントを直接作る）URL を開き、サイドバーが無いこと、3 つの塊が出ること、表示名が出ること、承認で紐付くことを見る
  - 観察できる完了条件: 3 つの画面それぞれで、確かめた内容と結果（スクリーンショットか、画面の文字起こし）が報告に残っている
  - _Requirements: 2.12, 2.13, 2.14, 7.9, 7.10, 7.11, 7.12, 9.9, 9.10, 9.11, 9.12_
  - _Depends: 5.1_

- [ ] 6. Port changes into the target spec and retire this spec
  - `<target-spec>` は `chat-integration`（umbrella）と `chat-integration-app` の 2 つ。各サブタスクの中で、どちらに何を書くかを分けて書く
  - 書き戻しは、`chat-integration-agent`（roadmap 順 7）が `chat-integration-app` の design.md へ書き戻す作業と**同時に行わない**（どちらかが済んでから、もう一方を行う）
- [ ] 6.1 Rewrite the relevant section(s) of <target-spec>'s design.md / requirements.md
  - 対象は `chat-integration` の `requirements.md` と、`chat-integration-app` の `design.md`
  - `chat-integration` の `requirements.md`: 要件 2 の末尾に 2.12〜2.14、要件 7 の末尾に 7.9〜7.12、要件 9 の末尾に 9.9〜9.12 を足す（この spec の requirements.md の本文をそのまま移す。既存の番号を振り直さない）。「手を触れない文言」と「2.2 の規則を変えない」の制約は、`chat-integration-app` の design.md へ移す
  - `chat-integration-app` の `design.md`: この spec の design.md の「design.md への書き戻しの一覧」の 6 か所を、**最初からそうだったかのように**書き直す（「以前は〜だった」という経緯は書かない）。Revalidation Triggers に、proxy の署名の検査が 401 以外を返すようになったときの見直しを足す
  - 承認画面の行の「表示名を `chat_relations` から引いて添える」を直すのを忘れない
  - _Requirements: 2.12, 2.13, 2.14, 7.9, 7.10, 7.11, 7.12, 9.9, 9.10, 9.11, 9.12_
- [ ] 6.2 Move any design rationale into <target-spec>'s research.md
  - 対象は `chat-integration-app` の `research.md`
  - この spec の `research.md` の決定 1〜6 を、`chat-integration-app` の `research.md` へ移す。**この spec のディレクトリごと消えるので、消す前に移す**
  - steering や roadmap から名前で参照されているファイルが、この spec のディレクトリの中に無いことを確かめる（`grep -rn "chat-integration-app-ui" .kiro/ .claude/`）。参照があれば、移したあとの場所に書き換える
- [ ] 6.3 Update <target-spec>'s spec.json (`updated_at`; leave `phase`/`approvals` alone)
  - 対象は `chat-integration` と `chat-integration-app` の両方。`spec.json` の `updated_at` を更新する（`phase` と `approvals` は変えない）
- [ ] 6.4 Remove this spec's row/entry from roadmap.md (if listed there)
  - 対象は `chat-integration` の `roadmap.md`。「リリース前に直すもの」の表の順 4 の行と、節「4. app の見え方」を消す
  - 順 4 を参照している文（「順 4・5・6 は app だけの変更で…」ほか）を、順 4 が無くなった形に書き直す。順 5 以降の番号は他の文書から参照されているので、振り直さない
- [ ] 6.5 Delete .kiro/specs/<this amend spec>/
  - 6.1〜6.4 が済んだことを確かめてから、`.kiro/specs/chat-integration-app-ui/` を削除する
  - 観察できる完了条件: `grep -rn "chat-integration-app-ui" .kiro/ .claude/ apps/` が 0 件
