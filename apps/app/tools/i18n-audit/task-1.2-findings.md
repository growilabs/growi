# Task 1.2 の確定リスト（後続タスクがそのまま使う対象一覧）

このファイルは spec `i18n-key-audit` の task 1.2 の成果物である。task 3.1 / 4.1 / 5.1 / 6.1 /
7.1 / 7.2 は `_Depends: 1.2_` と書かれており、それぞれ別のサブエージェントが実装する。
**その担当者はこの調査の記憶を持たないため、ここに書かれた一覧をそのまま対象として扱ってよい。**

計測日: 2026-08-20 / ブランチ: `spec/i18n-key-audit` / `i18next-cli` 1.71.0
計測コマンド（すべて `apps/app` ディレクトリから、読み取り専用）:

```
npx i18next-cli status
npx i18next-cli status en_US --hide-translated
npx i18next-cli status --unused
```

---

## 0. まず結論（research.md からのずれ）

research.md は生の報告 182 件を「31 / 23 / 119 / 5」に分けていた。今回、同じ実在チェックを
やり直したうえで **research.md が使っていなかった3種類の照合を追加** したところ、内訳が変わった。
追加した照合は次の3つで、いずれも「翻訳ファイルに実在しないように見えるが、実行時には
正しく解決される」ケースを分離するためのものである。

| 追加した照合 | 何を見分けるか |
|---|---|
| `:` を `.` に置き換えた形での実在確認 | `t('admin:g2g:transfer_success')` のように区切り文字に `:` を重ねて書いた呼び出し |
| キー名に `.` を literal（そのまま1つのキー名）として含む形での実在確認 | `GROWI.5.0_new_schema` のような、階層ではなく1つのキー名として JSON に書かれているもの |
| 複数形サフィックス（`_one` / `_other` / `_plural`）を外した形での実在確認 | `t('page_page.notice.stale', { count })` のような複数形付きの呼び出し |

**この3種類は推測で片付けず、実際に i18next を起動して `t()` の戻り値を確認した**（下記 §5）。

### 内訳（`preservePatterns` / `status.ignoreKeys` を入れる前、生の 182 件）

| 分類 | 件数 | 担当 |
|---|---:|---|
| A. 3つの namespace ファイルのどこにも存在しない（真の Bug 1） | 24 | task 3.1 |
| B. 完全な動的キー（CLI が union 型を展開して報告しているだけ） | 6 | 本タスクで `status.ignoreKeys` に宣言済み |
| C. `admin.json` に実在するのに `translation` の不在として報告される（Group 1/2/3） | 119 | task 4.1 / 5.1 / 6.1 |
| D. `translation.json` にのみ実在し、管理画面から参照されている（Bug 2 共有ラベル） | 18 | task 7.1 / 7.2 |
| E. `commons.json` にのみ実在し、管理画面外から参照されている | 5 | **担当なし（下記 §6）** |
| F. `:` を重ねた書き方のため CLI が解決できないだけ（実行時は正常） | 4 | **担当なし（下記 §6）** |
| G. キー名に `.` を含む literal キーのため CLI が解決できないだけ（実行時は正常） | 2 | **担当なし（下記 §6）** |
| H. 複数形サフィックスの照合が合わないだけ（実行時は正常） | 4 | **担当なし（下記 §6）** |
| 合計 | 182 | |

本タスクで `i18next.config.ts` に宣言を追加した後の実測は次のとおり。

| 指標 | 前 | 後 |
|---|---:|---:|
| `status` の「en_US に無いキー」 | 182 | 176 |
| `status --unused` の未使用キー | 3176 | 1992 |

---

## 1. A: どの namespace ファイルにも存在しないキー参照 24 件（task 3.1 の対象）

「参照修正」= 意図に合う既存キーが見つかったので呼び出し文字列を差し替える（翻訳ファイルは触らない）。
「新規キー追加」= 意図に合う既存キーが無いので5言語すべてに追加し、必要なら呼び出し文字列も直す。

修正先候補は `en_US` の3ファイルを全キー平坦化して総当たり検索した結果である。**「判断要」と
書いた行は、候補が複数あるか意味の一致が微妙なため、task 3.1 の実装者が call site を読んで
決める必要がある。**

| # | キー文字列 | call site | 方針 | 修正先 / 備考 |
|---:|---|---|---|---|
| 1 | `Something went wrong. Please try again.` | `src/client/components/Admin/UserGroupDetail/UserGroupDetailPage.tsx:285` | 新規キー追加 | 同義の既存キーは無い |
| 2 | `Page` | `src/client/components/Admin/UserGroupDetail/UserGroupDetailPage.tsx:662` | 判断要 | `admin.json` にも `commons.json` にも `Page` は無い。共有ラベル（§2）とは別物なので task 7.x で吸収しないこと |
| 3 | `admin:customize_settings.presentation_options.marp_in_gorwi_link` | `src/client/components/Admin/Customize/CustomizePresentationSetting.tsx:64` | 参照修正 | `admin:customize_settings.presentation_options.marp_in_growi_link`（`gorwi` は綴り間違い。正しい方は5言語に実在） |
| 4 | `Execute` | `src/features/external-user-group/client/components/ExternalUserGroup/SyncExecution.tsx:183` | 判断要 | 近い既存キーは `admin:external_user_group.execute_sync`（"Execute Sync"）。文言が変わってよいかは call site 次第 |
| 5 | `ExternalUserGroup` | `src/features/external-user-group/client/components/ExternalUserGroup/ExternalUserGroupManagement.tsx:116` | 判断要 | 近い既存キーは `admin:external_user_group.management`（"External Group Management"） |
| 6 | `common:failed_to_copy` | `src/client/components/PageEditor/EditorGuideModal/components/GuideRow.tsx:37` | 新規キー追加 | `common` という namespace ファイル自体が存在しない。design.md の指定どおり `editor_guide.textstyle.copy_failed` を新設し、**呼び出し文字列も書き換える** |
| 7 | `common:failed_to_copy` | `src/client/components/PageEditor/EditorGuideModal/contents/TextStyleTab.tsx:28` | 新規キー追加 | 同上 |
| 8 | `View` | `src/client/components/Navbar/PageEditorModeManager.tsx:100` | 判断要 | この file は `useTranslation('commons')`（55行目）。`translation.json` に `view` = "View" が実在するので、`commons.json` へ複製するか `t('translation:view')` にするかの判断が必要 |
| 9 | `Clear` | `src/client/components/Admin/UserManagement.tsx:163`（`t('commons:Clear')`） | 判断要 | `admin.json` に `audit_log_management.clear` = "Clear" が実在。`commons.json` に `Clear` を新設するのが素直 |
| 10 | `Send` | `src/client/components/Admin/Users/PasswordResetModal.jsx:67`（`t('commons:Send')`） | 判断要 | `translation.json` に `forgot_password.send` = "Send" が実在。`commons.json` に `Send` を新設するのが素直 |
| 11 | `User Settings` | `src/pages/me/[[...path]].page.tsx:63` | 新規キー追加 | 同義の既存キーは無い |
| 12 | `My Drafts` | `src/pages/me/[[...path]].page.tsx:67` | 判断要 | `translation.json` に `List Drafts` = "Drafts" が実在（意味は近いが文言が異なる） |
| 13 | `Not available for read only user` | `src/client/components/NotAvailableForReadOnlyUser.tsx:17` | 新規キー追加 | 同義の既存キーは無い |
| 14 | `Forbidden` | `src/client/components/ForbiddenPage.tsx:19` | 新規キー追加 | 同義の既存キーは無い |
| 15 | `Browsing of this page is restricted` | `src/client/components/ForbiddenPage.tsx:32` | 参照修正 | `page_page.notice.restricted` = "Access to this page is restricted"（5言語に実在） |
| 16 | `Browsing of this page is restricted` | `src/components/PageView/PageAlerts/PageGrantAlert.tsx:52` | 参照修正 | 同上 |
| 17 | `page_tree.move_blocked` | `src/features/page-tree/components/ItemsTree.tsx:106` | 新規キー追加 | `page_tree` という階層自体が3ファイルのどこにも無い |
| 18 | `page_tree.move_failed` | `src/features/page-tree/components/ItemsTree.tsx:108` | 新規キー追加 | 同上 |
| 19 | `Select template` | `src/client/components/TemplateModal/TemplateModal.tsx:305` | 参照修正 | `template.modal_label.Select template` = "Select template"（5言語に実在） |
| 20 | `Slack Member ID` | `src/client/components/Me/BasicInfoSettings.tsx:207` | 新規キー追加 | 同義の既存キーは無い |
| 21 | `Successfully updated` | `src/components/PageView/PageAlerts/FixPageGrantAlert/FixPageGrantModal.tsx:96` | 新規キー追加 | design.md の指定どおり。キー名が呼び出し文字列と同じなので call site の書き換えは不要 |
| 22 | `Failed to update` | `src/components/PageView/PageAlerts/FixPageGrantAlert/FixPageGrantModal.tsx:100` | 新規キー追加 | 同上 |
| 23 | `fix_page_grant.modal.alert_message` | `src/components/PageView/PageAlerts/FixPageGrantAlert/FixPageGrantModal.tsx:271` | 参照修正 | `fix_page_grant.modal.alert_message_select_group` = "No group selected"（design.md の指定どおり。現在どこからも参照されていないため未使用キーが1件減る） |
| 24 | `Copied!` | `src/client/components/Admin/Users/PasswordResetModal.jsx:179` | 判断要 | `admin.json` に `slack_integration.copied_to_clipboard` = "Copied to clipboard"、`growi-vault.admin-settings.clone-url.copied-tooltip` = "Copied!" が実在 |
| 25 | `Enable` | `src/client/components/Admin/Notification/GlobalNotificationList.jsx:109` | 新規キー追加 | 単語1つの既存キーは無い |
| 26 | `editor_guide.decoration.alert_block` | `src/client/components/PageEditor/EditorGuideModal/contents/DecorationTab.tsx:125` | 新規キー追加 | 同じ階層に `alert` / `alert_with_custom_title` / `docs_alert` はあるが `alert_block` は無い。125行目は `` t(`${i18nKey}.alert_block`) `` という**固定**の書き方（`i18nKey` はローカル定数なので CLI が正しく畳んでいる）＝動的キーではなく本物の欠落 |

行数は 26 行だが、**キー文字列としては 24 件**（`common:failed_to_copy` と
`Browsing of this page is restricted` がそれぞれ2箇所から参照されている）。`status` が数える
のはキー単位なので 24 が正しい。

### research.md の「31件」との差

research.md が 31 と数えたのは、上の 24 件に、実行時には正しく解決される 7 件（§5 の F/G/H
のうち6件と、動的キー由来の1件）を足した数である。今回のほうが照合が細かいので 24 を採る。
「31件が28件に減った」という話ではなく、**分類の粒度が変わった**という理解が正しい。

---

## 2. D: Bug 2 の共有ラベルと、参照している管理画面コンポーネント（task 7.1 / 7.2 の対象）

### Bug 2 が起きる仕組み（確認済み）

管理画面の SSR は `src/pages/admin/_shared/get-server-side-common-props.ts:44` で
`getServerSideI18nProps(context, ['admin'], options)` を呼び、
`src/pages/common-props/i18n.ts:22-27` が先頭に `commons` を足す。つまり**管理画面に配られる
のは `commons` と `admin` の2つだけで、`translation` は配られない**。
`fallbackNS` は設定されていない（`config/i18next.config.mjs` を確認）ので、
`useTranslation('admin')` した file が `t('Name')` を呼ぶと、`admin.json` に `Name` が無い時点で
生キーが表示される。`commons.json` に値があっても、namespace が違うので拾われない。

### 対象キー 23 件

「管理画面のコード配下で、`t('...')` の固定文字列として呼ばれており、その file が宣言した
namespace（`useTranslation(...)`）では解決できず、`translation.json` には実在する」ものを
機械的に洗い出した結果（`t` を props で受け取る file は親と同じ `admin` とみなした）。

| キー | 参照箇所数 |
|---|---:|
| `Cancel` | 4 |
| `Close` | 1 |
| `Confirm` | 2 |
| `Create` | 2 |
| `Created` | 5 |
| `Delete` | 5 |
| `Description` | 5 |
| `Edit` | 1 |
| `Email` | 4 |
| `Error occurred` | 4 |
| `Help` | 4 |
| `Name` | 6 |
| `Password` | 2 |
| `Update` | 17 |
| `User` | 1 |
| `UserGroup` | 7 |
| `V5 Page Migration` | 1 |
| `Warning` | 1 |
| `add` | 1 |
| `eg` | 4 |
| `toaster.remove_share_link` | 1 |
| `toaster.remove_share_link_success` | 1 |
| `username` | 4 |

### 23 件のうち3件は `commons.json` に既に値がある（複製不要）

`en_US/commons.json` に対して 23 件すべての実在を確認した結果:

| キー | task 7.x でやること |
|---|---|
| `Delete` | **`commons:` の前置のみ**。`commons.json` に既に値がある |
| `toaster.remove_share_link` | **前置のみ**（call site は既に `{ ns: 'commons' }` を渡しているので、実際には変更不要な可能性が高い。実装時に確認すること） |
| `toaster.remove_share_link_success` | **前置のみ**（同上） |
| 上記以外の 20 件 | `translation.json` から `commons.json` へ5言語分を複製し、そのうえで `commons:` を前置 |

したがって §7 で design.md が求めている「複製ペアの5言語一致を検証するテスト」の対象は
**20 件**であり、23 件ではない。既に `commons.json` にある3件を複製対象に入れると、
値の出どころが2つある状態を無意味に増やしてしまう。

**23 件は research.md / design.md の「約20〜23件」と一致する。** 一方 `status` の生の報告
（分類 D）に現れるのは 18 件だけである。差の5件（`Confirm` / `Help` / `Password` / `Warning` /
`add`）は、その file が `useTranslation()` を引数なしで呼んでいるため CLI が「`translation`
namespace で解決できている」と判定し、報告に出てこない。しかし実行時には `translation` が
配られていないので生キーになる。**task 7.x の対象は 23 件であって 18 件ではない。**
`status` の報告件数だけを見て対象を狭めないこと。

### 対象コンポーネント 36 ファイル

design.md は「約43コンポーネント」と書いているが、上の定義で実際に洗い出せたのは 36 ファイル
である。43 との差は数え方の違い（call site 数、または `admin.json` にも実在するキーを含めた
数え方）と考えられ、7ファイルの取りこぼしではない。念のため、この一覧の作り方（宣言 namespace
で解決できないものだけを残す）を task 7.x に引き継ぐ。

| ファイル | このファイルが持つ共有ラベル |
|---|---|
| `src/client/components/Admin/App/AppSettingsPageContents.tsx` | V5 Page Migration |
| `src/client/components/Admin/App/AwsSetting.tsx` | eg |
| `src/client/components/Admin/App/ConfirmModal.tsx` | Warning, Cancel, Confirm |
| `src/client/components/Admin/App/MailSetting.tsx` | eg, Update |
| `src/client/components/Admin/App/SmtpSetting.tsx` | Password |
| `src/client/components/Admin/AuditLog/AuditLogSettings.tsx` | Help |
| `src/client/components/Admin/Common/AdminUpdateButtonRow.tsx` | Update |
| `src/client/components/Admin/Customize/CustomizeLayoutSetting.tsx` | Update |
| `src/client/components/Admin/Customize/CustomizeSidebarSetting.tsx` | Update |
| `src/client/components/Admin/Security/GitHubSecuritySettingContents.tsx` | Error occurred, Update |
| `src/client/components/Admin/Security/GoogleSecuritySettingContents.tsx` | Error occurred, Update |
| `src/client/components/Admin/Security/LdapAuthTest.tsx` | username, Password |
| `src/client/components/Admin/Security/LdapSecuritySettingContents.tsx` | username, Email, Name, Update |
| `src/client/components/Admin/Security/LocalSecuritySettingContents.tsx` | Error occurred, Update |
| `src/client/components/Admin/Security/OidcSecuritySettingContents.tsx` | username, Name, Email, Update |
| `src/client/components/Admin/Security/SamlSecuritySettingContents.tsx` | Update |
| `src/client/components/Admin/Security/SecuritySetting/index.tsx` | Error occurred, Update |
| `src/client/components/Admin/Security/ShareLinkSetting.tsx` | toaster.remove_share_link, toaster.remove_share_link_success |
| `src/client/components/Admin/SlackIntegration/DeleteSlackBotSettingsModal.tsx` | Cancel |
| `src/client/components/Admin/UserGroup/UserGroupDeleteModal.tsx` | Delete |
| `src/client/components/Admin/UserGroup/UserGroupForm.tsx` | Created, Description |
| `src/client/components/Admin/UserGroup/UserGroupModal.tsx` | Description |
| `src/client/components/Admin/UserGroup/UserGroupPage.tsx` | UserGroup, Create, Update |
| `src/client/components/Admin/UserGroup/UserGroupTable.tsx` | Name, Description, User, Created, Edit, Delete |
| `src/client/components/Admin/UserGroupDetail/UpdateParentConfirmModal.tsx` | Confirm, Cancel |
| `src/client/components/Admin/UserGroupDetail/UserGroupDetailPage.tsx` | UserGroup, Update, Create |
| `src/client/components/Admin/UserGroupDetail/UserGroupUserFormByInput.tsx` | add |
| `src/client/components/Admin/UserGroupDetail/UserGroupUserTable.tsx` | username, Name, Created |
| `src/client/components/Admin/Users/ExternalAccountTable.tsx` | Created, Delete |
| `src/client/components/Admin/Users/UserInviteModal.tsx` | Cancel, Close |
| `src/client/components/Admin/Users/UserTable.tsx` | Name, Email, Created |
| `src/features/external-user-group/client/components/ExternalUserGroup/ExternalUserGroupManagement.tsx` | Update |
| `src/features/external-user-group/client/components/ExternalUserGroup/KeycloakGroupSyncSettingsForm.tsx` | Description, Update |
| `src/features/external-user-group/client/components/ExternalUserGroup/LdapGroupSyncSettingsForm.tsx` | Name, Description, Update |
| `src/features/growi-plugin/client/Admin/components/PluginsExtensionPageContents/PluginCard.tsx` | Delete |
| `src/features/growi-plugin/client/Admin/components/PluginsExtensionPageContents/PluginDeleteModal.tsx` | Delete |

---

## 3. 重複していないことの確認

**§1 の 24 件と §2 の 23 件は、定義そのものから重ならない。** §1 は「`translation.json`・
`admin.json`・`commons.json` のどこにも存在しないキー」であり、§2 は「`translation.json` に
存在するキー」である。この2つの集合は排他なので、grep で突き合わせる以上に強い保証がある。

ただし §1 には `Page` / `Execute` / `ExternalUserGroup` / `Delete` 風の単語1つのキーが並んで
おり、**見た目が共有ラベルとよく似ている**。`Page`（#2）、`Execute`（#4）、
`ExternalUserGroup`（#5）、`Something went wrong. Please try again.`（#1）は、どの namespace
ファイルにも値が無いので `commons.json` に複製する対象ではない。**task 7.x はこの4件を
共有ラベルとして吸収してはいけない**（複製元の値が存在しないので、複製しても生キーのまま
になる）。この4件は task 3.1 が新規キー追加または参照修正で直す。

Group 1（`SecuritySetting/` 配下7ファイル）と共有ラベルの重複が無いことも再確認した。7ファイル
が参照しているキーは `security_settings.*` 配下と grant 表示用の4件（`public` /
`anyone_with_the_link` / `only_me` / `only_inside_the_group`）で、いずれも `admin.json` に
実在する（＝分類 C に入る）。`translation.json` にのみ存在する共有ラベルとは集合が異なる。

---

## 4. Call-site Remediation の対象ファイル（task 4.1 / 5.1 / 6.1 の対象）

### Group 1 — `t` を props で受け取る7ファイル（task 4.1）

`src/client/components/Admin/Security/SecuritySetting/` 配下。7ファイルすべてが
`t: (key: string, options?: Record<string, unknown>) => string` という形の prop を持つ。

1. `CommentManageRightsSettings.tsx`
2. `PageAccessRightsSettings.tsx`
3. `PageDeleteRightsSettings.tsx`
4. `PageListDisplaySettings.tsx`
5. `SessionMaxAgeSettings.tsx`
6. `UserHomepageDeletionSettings.tsx`
7. `UserPageVisibilitySettings.tsx`

親は `SecuritySetting/index.tsx:29` の `useTranslation('admin')`。したがって各コンポーネントが
自前で呼ぶ場合も `useTranslation('admin')` を使う（namespace を取り違えないための根拠）。

### Group 2 — `createAdminPageLayout` の `title` callback（task 5.1）

`grep -rl 'createAdminPageLayout' src/pages/admin --include='*.page.tsx'` は **23 ファイル**。
うち4ファイルは対象外（design.md の記述どおりであることを実際の `title` 行で確認済み）。

対象外4ファイル:

| ファイル | 理由（実際の行） |
|---|---|
| `src/pages/admin/[...path].page.tsx` | `title: () => 'Not Found'`（21行目）— キー参照が無い固定文字列 |
| `src/pages/admin/vault.page.tsx` | `title: () => 'GROWI Vault'`（25行目）— 同上 |
| `src/pages/admin/app.page.tsx` | `title: (_p, t) => t('headers.app_settings', { ns: 'commons' })`（38行目）— options 引数形式で明示済み |
| `src/pages/admin/data-transfer.page.tsx` | `title: (_p, t) => t('g2g_data_transfer.data_transfer', { ns: 'commons' })`（24行目）— 同上 |

対象 19 ファイル（`admin:` を前置する。行番号は `title:` の行）:

| ファイル | 行 | 現在のキー |
|---|---:|---|
| `src/pages/admin/ai.page.tsx` | 23 | `ai_settings.ai_settings` |
| `src/pages/admin/audit-log.page.tsx` | 54 | `audit_log_management.audit_log` |
| `src/pages/admin/customize.page.tsx` | 41 | `customize_settings.customize_settings` |
| `src/pages/admin/export.page.tsx` | 24 | `export_management.export_archive_data` |
| `src/pages/admin/global-notification/[globalNotificationId].page.tsx` | 57 | `external_notification.external_notification` |
| `src/pages/admin/global-notification/new.page.tsx` | 25 | `external_notification.external_notification` |
| `src/pages/admin/importer.page.tsx` | 24 | `importer_management.import_data` |
| `src/pages/admin/index.page.tsx` | 46 | `wiki_management_homepage` |
| `src/pages/admin/markdown.page.tsx` | 25 | `markdown_settings.markdown_settings` |
| `src/pages/admin/notification.page.tsx` | 24 | `external_notification.external_notification` |
| `src/pages/admin/plugins.page.tsx` | 27 | `plugins.plugins` |
| `src/pages/admin/search.page.tsx` | 65 | `elasticsearch_management` |
| `src/pages/admin/security.page.tsx` | 43 | `security_settings.security_settings` |
| `src/pages/admin/slack-integration-legacy.page.tsx` | 26 | `slack_integration_legacy.slack_integration_legacy` |
| `src/pages/admin/slack-integration.page.tsx` | 36 | `slack_integration.slack_integration` |
| `src/pages/admin/user-group-detail/[userGroupId].page.tsx` | 48 | `user_group_management.user_group_management` |
| `src/pages/admin/user-groups.page.tsx` | 38 | `user_group_management.user_group_management` |
| `src/pages/admin/users/external-accounts.page.tsx` | 23 | `user_management.external_account` |
| `src/pages/admin/users/index.page.tsx` | 41 | `user_management.user_management` |

サブディレクトリ配下の5ファイル（`global-notification/` 2件、`user-group-detail/` 1件、
`users/` 2件）が含まれていることを確認した。

### Group 3 — `getTranslation({ ns: [...] })` を使うサーバー側（task 6.1）

`grep -rn "getTranslation(" src` の結果は7箇所（うち1つは定義本体
`src/server/service/i18next.ts:48`）。**`ns:` の配列を渡しているのは `saml.ts` 1ファイルだけ**
であることを確認した。research.md が「`saml.ts` 以外に同様の書き方が無いか確認する」と
書いていた点への答えは「無い」。

| ファイル / 行 | 呼び方 | 対象か |
|---|---|---|
| `src/server/routes/apiv3/security-settings/saml.ts:179-182` | `getTranslation({ lang, ns: ['translation', 'admin'] })` | **対象** |
| `src/server/routes/apiv3/user-activation.ts:132` | `getTranslation()`（ns 指定なし） | 対象外 |
| `src/server/routes/apiv3/app-settings/file-upload-setting.ts:77` | `getTranslation()` | 対象外 |
| `src/server/routes/apiv3/app-settings/file-upload-setting.ts:87` | `getTranslation()` | 対象外 |
| `src/server/routes/apiv3/app-settings/index.ts:870` | `getTranslation({ lang })` | 対象外 |
| `src/server/routes/apiv3/page/create-page.ts:67` | `getTranslation()` | 対象外 |

### 重要: 分類 C の 119 件は Group 1 / 2 / 3 で覆いきれない（62 件が担当なし）

design.md は分類 C（`admin.json` に実在するのに `translation` の不在として報告される 119 件）
を Group 1 / 2 / 3 の書き換えで解消する前提で書かれている。**この前提が成り立つかを実際に
測ったところ、成り立たなかった。**

やった確認: 119 件のキーそれぞれについて、`t('固定文字列')` の形で呼んでいるファイルを
リポジトリ全体から洗い出し、Group 1（`SecuritySetting/` 配下7ファイル）・
Group 2（`pages/admin/**/*.page.tsx`）・Group 3（`saml.ts`）に属するかどうかで振り分けた。

結果:

- 119 件のうち **78 件**は、Group 1 / 2 / 3 の外にも呼び出し箇所がある
- そのうち **62 件**は、Group 1 / 2 / 3 に呼び出し箇所が**1つも無い**。つまり3グループを
  すべて書き換えても報告は残る

62 件の出どころ（ファイル別）:

| ファイル | 件数 | `t` の受け取り方 |
|---|---:|---|
| `src/client/components/Admin/LegacySlackIntegration/SlackConfiguration.jsx` | 14 | props 経由 |
| `src/client/components/Admin/ElasticsearchManagement/StatusTable.jsx` | 9 | props 経由（`this.props` から取り出す class component） |
| `src/client/components/Admin/ImportData/GrowiArchiveSection.jsx` | 6 | props 経由 |
| `src/client/components/Admin/MarkdownSetting/XssForm.jsx` | 6 | props 経由 |
| `src/client/components/Admin/Users/PasswordResetModal.jsx` | 6 | props 経由 |
| `src/client/components/Admin/Notification/UserTriggerNotification.jsx` | 6 | props 経由 |
| `src/client/components/Admin/MarkdownSetting/LineBreakForm.jsx` | 5 | props 経由 |
| `src/client/components/Admin/Notification/GlobalNotificationList.jsx` | 2 | props 経由 |
| `src/client/components/Admin/Notification/NotificationDeleteModal.jsx` | 2 | props 経由 |
| `src/client/components/Admin/Security/DeleteAllShareLinksModal.jsx` | 2 | props 経由 |
| `src/client/components/Admin/Users/StatusActivateButton.jsx` | 2 | props 経由 |
| `src/client/components/Admin/MarkdownSetting/WhitelistInput.tsx` | 2 | 自前の `useTranslation('admin')` |
| `src/client/components/Admin/MarkdownSetting/MarkDownSettingContents.tsx` | 2 | 自前の `useTranslation('admin')` |
| `src/client/components/Admin/Notification/ManageGlobalNotification.tsx` | 1 | 自前 |
| `src/client/components/Admin/Security/ShareLinkSetting.tsx` | 1 | 自前 |
| `src/client/components/Admin/Security/LocalSecuritySettingContents.tsx` | 1 | 自前 |
| `src/client/components/Admin/Users/UserMenu.tsx` | 1 | 自前 |
| `src/client/components/Admin/Users/UserRemoveButton.jsx` | 1 | props 経由 |
| `src/client/components/Me/AssociateModal.tsx` | 1 | 自前（管理画面外） |
| `src/client/components/Me/DisassociateModal.tsx` | 1 | 自前（管理画面外） |

（1つのキーを複数ファイルが共有しているため、件数の合計は 62 を超える。）

**Group 1 の「7ファイル」は測定結果ではなく design.md の仮定である。** props で `t` を受け取る
という同じ書き方は `SecuritySetting/` の外にも広くあり、上表の「props 経由」と書いた 11 ファイル
がそれに当たる。`SecuritySetting/` 配下の7ファイルだけが型注釈（`t: (key: string) => string`）を
持っているため `grep` で見つかりやすく、`.jsx` 側は型注釈が無いので今まで見落とされていた。
実際の書き方は次のとおりで、Group 1 とまったく同じ構造である。

```
// StatusTable.jsx
class StatusTable extends React.PureComponent {   // 5行目
  ...
  const { t } = this.props;                       // 11, 52, 162行目
}
const StatusTableWrapperFC = (props) => {
  const { t } = useTranslation('admin');          // 203行目
  return <StatusTable t={t} {...props} />;
};
```

**この 62 件をどのタスクが直すかは決まっていない。** Group 1 の対象ファイル一覧を増やすのか、
新しい Group を起こすのかは design.md 側の判断であり、本タスクの boundary（`i18next.config.ts`
と本ファイル）を超えるので、ここでは記録だけ行う。実装に入る前に受け皿を決める必要がある。

なお、Group 2 が担当するページタイトルのキー（例 `security_settings.security_settings`）は、
`src/components/Admin/Common/AdminNavigation.tsx` からも呼ばれている。ただし
`AdminNavigation.tsx` は自前で `useTranslation(['admin', 'commons'])`（14行目）／
`useTranslation('admin')`（197行目）を呼んでおり、CLI もそこは正しく解決できる。したがって
これらのキーの報告元は `*.page.tsx` の `title` callback（`t` が callback 引数として渡ってくる）
であり、Group 2 の書き換えで報告が消える。この点は research.md iteration 3 の
「`AdminNavigation.tsx` は誤検出しない」という結論と一致する。

### `saml.ts` の書き換え対象

`saml.ts` の中で書き換えが必要な固定キーは1つだけ:

- `src/server/routes/apiv3/security-settings/saml.ts:220` — `t('security_settings.form_item_name.ABLCRule')` → `admin:` を前置
  - 同じキーはクライアント側 `src/client/components/Admin/Security/SamlSecuritySettingContents.tsx:685` からも呼ばれており、そちらも `status` に報告されている。task 6.1 の範囲に含めるかは実装者が design.md の Group 分けに照らして判断すること
- 同ファイル 197行目の `` t(`security_settings.form_item_name.${key}`) `` は完全な動的キーなので書き換え対象ではなく、`preservePatterns` で扱う（§7 に宣言済み）
- `input_validation.message.required` / `input_validation.message.error_message` は `translation.json` に実在し `status` に報告されていないので、前置は不要（フォールバック順を変えるリスクを取らない）

---

## 5. F / G / H — 実行時には正しく解決されることを i18next を起動して確認した10件

**JSON を直読みする照合では判定できない**ため、`i18next` 本体を `en_US` の3ファイルを
`resources` に載せて `init()` し、実際に `t()` を呼んで戻り値を確認した。
（GROWI の実行時設定は `config/i18next.config.mjs`。`compatibilityJSON` / `keySeparator` /
`nsSeparator` / `pluralSeparator` はいずれも未指定＝既定値。）

| 呼び出し | 戻り値 | 判定 |
|---|---|---|
| `t('admin:g2g:transfer_success')` | "Completed GROWI to GROWI transfer successfully" | 解決する |
| `t('admin:admin_top:submit_bug_report')` | "Submit your issue to GitHub." | 解決する |
| `t('admin:admin_top:copy_prefilled_host_information:default')` | "Copy prefilled host information" | 解決する |
| `t('admin:admin_top:copy_prefilled_host_information:done')` | "Copied to clipboard!" | 解決する |
| `t('GROWI.5.0_new_schema')` | "GROWI.5.0 new schema" | 解決する |
| `t('No users have liked this yet.')` | "No users have liked this yet." | **要注意（下記）** |
| `t('page_page.notice.stale', { count: 1 })` | "More than 1 year has passed since last update." | 解決する |
| `t('page_page.notice.stale', { count: 3 })` | "More than 3 year has passed since last update." | 解決する（ただし英語の複数形が崩れている、下記） |
| `t('commons:toaster.remove_share_link', { count: 1 })` | "Succeeded to remove 1 share links" | 解決する |
| `t('commons:toaster.remove_share_link', { count: 3 })` | "Succeeded to remove 3 share links" | 解決する |

### F: `:` を重ねた書き方 4 件（実行時は正常）

i18next は `t('admin:g2g:transfer_success')` を「最初の `:` の前を namespace、残りを
`keySeparator`（`.`）で繋ぎ直したキー」として解釈するため `admin` / `g2g.transfer_success`
になり、正しく解決する。`i18next-cli` はこの繋ぎ直しをしないので `g2g:transfer_success`
という存在しないキーとして報告する。

- `src/client/components/Admin/G2GDataTransfer.tsx:110` — `t('admin:g2g:transfer_success')`
- `src/client/components/Admin/AdminHome/AdminHome.tsx:138` — `t('admin:admin_top:copy_prefilled_host_information:default')`
- `src/client/components/Admin/AdminHome/AdminHome.tsx:147` — `t('admin:admin_top:copy_prefilled_host_information:done')`
- `src/client/components/Admin/AdminHome/AdminHome.tsx:158` — `t('admin:admin_top:submit_bug_report')`

### G: キー名に `.` を literal で含む 2 件

- `src/client/components/IdenticalPathPage.tsx:52` — `t('GROWI.5.0_new_schema')`。`translation.json` は `"GROWI.5.0_new_schema"` を1つのキー名として持つ。実行時は解決する
- `src/client/components/PageControls/LikeButtons.tsx:87` — `t('No users have liked this yet.')`。**これは実質的な不具合である。** `en_US` には末尾に `.` がある版と無い版が両方あり、`.` がある版は値が英語のまま（`"No users have liked this yet."`）。一方 `ja_JP` などには `.` の無い版（`"いいねをしているユーザーはいません"`）しかない。つまり call site が末尾 `.` 付きを呼んでいるため、日本語などでは en_US へフォールバックして英語が出る。**呼び出しを `t('No users have liked this yet')`（末尾 `.` なし）に直すと、4言語の翻訳が効くようになり、同時に `status` の報告も1件減る。** task 3.1 の参照修正に含めることを推奨する

### H: 複数形サフィックス 4 件（実行時は正常、ただし別の課題を含む）

`i18next-cli` は `t(key, { count })` に対して `key_one` / `key_other` の実在を求めるが、
i18next 本体はサフィックス無しのキーでも解決する。

- `src/components/PageView/PageAlerts/PageStaleAlert.tsx:51` — `t('page_page.notice.stale', { count })`。`translation.json` は `stale` と `stale_plural` を持つ。`stale_plural` は i18next v3 時代の書き方で、v4（既定）では読まれない。**表示は出るが、英語の複数形（"More than 3 year"）が崩れている。** 本 spec の対象（存在しないキー参照）ではないので task 3.1 に入れず、別課題として記録する
- `src/client/components/PageAccessoriesModal/ShareLink/ShareLink.tsx:32` および `src/client/components/Admin/Security/ShareLinkSetting.tsx:74` — `t('toaster.remove_share_link', { count, ns: 'commons' })`。`commons.json` は `remove_share_link` のみを持つ。同様に表示は出るが単数形／複数形の作り分けが無い

**この F / G / H の計10件は、実行時に壊れていないにもかかわらず `status` の報告には残る。**
`preservePatterns` は未使用判定にしか効かないため（§7）、Requirement 1 の「0件」に到達する
には、いずれかの手当てが必要である。手当ての方針は design.md に記述が無いので、
**§6 の「担当が決まっていない項目」として残す。**

---

## 6. 担当が決まっていない項目（design.md にも tasks.md にも受け皿が無い）

Requirement 1 の「0件」は `status` の生の報告件数に対する条件である。したがって、実行時には
正常でも報告に残るものは、すべて何らかの手当てが必要になる。以下は現時点で担当タスクが
無いため、実装を始める前に spec 側で受け皿を決める必要がある。

| 項目 | 件数 | 内容 |
|---|---:|---|
| **C の取りこぼし** | **62** | §4 の「分類 C の 119 件は Group 1/2/3 で覆いきれない」を参照。**この表のいちばん大きい項目であり、実装開始前に受け皿を決める必要がある** |
| E: `commons.json` にのみ実在するキーを管理画面外から参照 | 5 | 下表。Group 1/2/3 はいずれも管理画面／サーバー側が対象なので、この5件はどのグループにも入らない |
| F: `:` を重ねた書き方 | 4 | §5 の一覧。`admin:g2g:foo` を `admin:g2g.foo` に直せば CLI も解決できるが、`g2g-error-keys-locale-drift.spec.ts` がこの書き方を前提にしている（同 spec の 38〜42行目のコメント）ため、影響範囲の確認が必要 |
| G: literal `.` を含むキー | 2 | §5 の一覧。うち `No users have liked this yet.` は task 3.1 の参照修正で解消できる。`GROWI.5.0_new_schema` はキー名を変えるか `status.ignoreKeys` に足すかの判断が必要 |
| H: 複数形サフィックス | 4 | §5 の一覧。翻訳ファイル側を i18next v4 形式（`_one` / `_other`）に直すのが本筋だが、それは Non-Goals の「namespace 構成の再編」とは別の、複数形形式の移行という新しい作業になる |

E の内訳:

| キー | call site | 備考 |
|---|---|---|
| `not_found_page.page_not_exist` | `src/client/components/RevisionComparer/RevisionComparer.tsx:79`, `src/client/components/Admin/NotFoundPage.tsx:7` | `commons.json` に実在 |
| `Show` | `src/client/components/Me/BasicInfoSettings.tsx:142` | 同上 |
| `Hide` | `src/client/components/Me/BasicInfoSettings.tsx:160` | 同上 |
| `New` | `src/client/components/Me/AccessTokenSettings.tsx:152`, `src/client/components/PageAccessoriesModal/ShareLink/ShareLink.tsx:81` | 同上 |
| `toaster.create_failed` | `src/client/components/Hotkeys/Subscribers/EditPage.tsx:68`, `src/client/components/CreateTemplateModal/CreateTemplateModal.tsx:74`, `src/client/components/Navbar/PageEditorModeManager.tsx:68`, `src/client/services/use-toastr-on-error.tsx:16` | 同上 |

---

## 7. 動的キーの宣言（本タスクで `i18next.config.ts` に追加した内容）

### 判定の基準

「テンプレートリテラルを使っている」だけでは動的とは言えない。`i18next-cli` は
`const i18nKey = 'editor_guide.decoration'` のようなローカル定数や `as const` 配列・
union 型を静的に畳めるため、それらは動的として宣言してはいけない（宣言すると、本当の
typo を見逃す穴になる）。実際に `EditorGuideModal/contents/DecorationTab.tsx:125` の
`` t(`${i18nKey}.alert_block`) `` は畳まれて「存在しないキー」として正しく報告されており、
§1 の #26 として修正対象に入れている。

宣言したのは、**変わる部分が React state・保存済み設定値・API の応答・`Record` の反復から
来る**もののみ。

| 宣言したパターン | call site | 変わる部分の出どころ |
|---|---|---|
| `editor_guide.decoration.{primary,secondary,info,success,warning,danger}_text`（※列挙） | `DecorationTab.tsx:63,67,72,76,82,86` | `currentStyle`（`useState<BOOTSTRAP_STYLES>`、47行目） |
| `editor_guide.decoration.docs_*` | `DecorationTab.tsx:206` | マップの反復キー |
| `admin:security_settings.form_item_name.{entryPoint,issuer,cert,attrMapId,attrMapUsername,attrMapMail}`（※列挙） | `saml.ts:197`, `SamlSecuritySettingContents.tsx:188` | SAML の設定キー名（`security:passport-saml:` を除いた残り）。取りうる値は `passport.ts:111-118` の `mandatoryConfigKeysForSaml` の6件だけ |
| `admin:audit_log_action.*` | `SelectActionDropdown.tsx:178`, `ActivityTableRow.tsx:90`, `AuditLogSettings.tsx:87` | 保存済み activity の `action` 値 |
| `admin:audit_log_action_category.*` | `SelectActionDropdown.tsx:158` | 同上のカテゴリ値 |
| `admin:app_setting.*_label` | `FileUploadSetting.tsx:132,143`, `MailSetting.tsx:151` | 設定されているアップローダ種別／メール送信方式 |
| `template.*.label` | `CreateTemplateModal.tsx:28` | prop の `target` |
| `template.*.desc` | `CreateTemplateModal.tsx:34` | 同上 |
| `search_result.sort_axis.*` | `SortControl.tsx:41,57` | 選択中のソート軸 |
| `page_edit.paste.{both,text,file}`（※列挙） | `OptionsSelector.tsx:255,452` | 保存済みの貼り付けモード。取りうる値は `packages/editor/src/consts/paste-mode.ts` の `AllPasteMode` の3件だけ |
| `input_validation.target.*` | `use-input-validator.ts:51` | 検証対象の種別 |
| `ai_sidebar.incomplete.*` | `IncompleteResponseNotice.tsx:36` | AI の応答に含まれる理由コード |
| `commons:accesstoken_scopes_desc.*` | `AccessTokenScopeList.tsx:92` | スコープ id（`:` を `.` に置換して使う） |

Requirement 4.3 は「discovery で判明した50件の動的キー参照をカバーする」としている。上の13
パターンが実際にカバーしている翻訳キーの実数は `status --unused` の減少分で測れる:
**3176 → 1992（1184件）**。50件という見積りは、パターン単位ではなくキー単位で数えた場合に
大きく上回る（`admin:audit_log_action.*` だけで数百件ある）。

### 重要: `preservePatterns` は「存在しないキー参照」の報告には効かない

research.md 22行目は「`preservePatterns` は `status` の欠損判定にも効く」と記録しているが、
**今回の実測ではそうならなかった。**

| 実行 | `status` の「en_US に無いキー」 | `status --unused` |
|---|---:|---:|
| `preservePatterns` 追加前 | 182 | 3176 |
| `preservePatterns` 追加後 | 182（一覧も完全に一致） | 1992 |
| さらに `status.ignoreKeys` 追加後 | 176 | 1992 |

`i18next-cli` の README も、`extract.preservePatterns` を「既存のキーを（extract の削除対象
から）残す」機能、`status.ignoreKeys` を「`status` が報告しないキー」の機能として別々に
説明している。Requirement 4.2 は Requirement 1（欠損）と Requirement 2（未使用）の両方から
除外することを求めているので、**両方に宣言が必要**である。そのため本タスクでは
`status.ignoreKeys` に `editor_guide.decoration.{primary,secondary,info,success,warning,danger}_text`
（実行時は `defaultValue` で `editor_guide.decoration.placeholder` に落ちるため、キーが存在しない
のが正しい設計）を追加した。
他のパターンは `status` の報告に現れないので `ignoreKeys` には入れていない（必要以上に
報告を止めないため）。

`status.ignoreKeys` の追加は design.md に書かれていない設計上の追加である。Requirement 4.2 が
Requirement 1 と Requirement 2 の両方からの除外を求めており、`preservePatterns` だけでは
Requirement 2 しか満たせないため、この一手を足さないと Requirement 1 の「0件」に到達する道が
無い。**design.md にこの追加を取り込むかどうかはレビューで判断してもらう必要がある。**

補足: `preservePatterns` に書いた `editor_guide.decoration.*_text`（現在は6キーの列挙）は、
実際には何も抑制しない（この6キーは3つの JSON のどこにも存在しないので、そもそも「未使用」
として報告されえない）。害は無いが、「動的キーの一覧」として1箇所にまとまっている方が
読みやすいので残している。宣言したファミリは13個で、そのうち実際に未使用報告を抑制して
いるのは11ファミリである（`editor_guide.decoration.*_text` と、下記の
`admin:security_settings.form_item_name.*` の2つが抑制ゼロ）。

`admin:security_settings.form_item_name.*` も同様に抑制ゼロだった。この6キーは
`SamlSecuritySettingContents.tsx:216,246,276,345,377,416` から `admin:` 接頭辞なしで静的に
呼ばれていて、その呼び出しを CLI は admin.json のキーとして解決している（`status en_US` が
`security_settings.form_item_name.*` の9キーすべてを ✓ と報告する）。実測: この6行を config
から丸ごと消しても `status --unused` は 1992 のまま、`form_item_name` のキーは1件も未使用と
して報告されない。宣言としての意味（実行時に組み立てられる呼び出しがここにある）を残すため
config には置いてあるが、いま何かを抑えているわけではない。
対照的に `page_edit.paste.{both,text,file}` は抑制に効いていて、3行を消すと未使用は
1992 → 2007（3キー × 5ロケール）に増える。

### ワイルドカードで書くか、具体キーを並べるか

3つのファミリ（`editor_guide.decoration.*_text`、`admin:security_settings.form_item_name.*`、
`page_edit.paste.*`）は、当初ワイルドカードで宣言していたが、**具体キーの列挙に置き換えた**。
理由は、これらのファミリには同じ接頭辞を共有する **静的な `t('…')` 呼び出しが混ざっている**
ためである。

| ファミリ | 同じ接頭辞を持つ静的呼び出し |
|---|---|
| `editor_guide.decoration.*_text` | `.alert_with_custom_title_text`（`DecorationTab.tsx:82`。`i18nKey` はローカル定数なので静的に解決できる） |
| `admin:security_settings.form_item_name.*` | `.entryPoint`, `.issuer`, `.cert`, `.attrMapId`, `.attrMapUsername`, `.attrMapMail`, `.attrMapFirstName`, `.attrMapLastName`, `.ABLCRule` |
| `page_edit.paste.*` | `.title`（`OptionsSelector.tsx:267,449`） |

ワイルドカードはこれらの静的キーまで一緒に対象に含めてしまうが、影響する側は宣言する場所に
よって違う。`preservePatterns`（`extract` 側）のワイルドカードが隠すのは**未使用キーの報告
だけ**で、欠損キーの報告には影響しない（実測で確認済み）。実際、`page_edit.paste.title` を
JSON 側で `titleXX` に書き換えたとき、ワイルドカードのままだと未使用件数は 1992 のまま
（`titleXX` が未使用として報告されない＝気づけない）で、列挙にすると 1993 になり
`page_edit.paste.titleXX` が報告された。

一方、`status.ignoreKeys` のワイルドカードは**欠損キーの報告**を隠す。こちらで同じ確認を
`alert_with_custom_title_text` について行い、ワイルドカードのままだと欠損件数が 176 のまま
（気づけない）で、列挙にすると 177 に増えて `alert_with_custom_title_text` が報告される
ことを確かめた。どちらの場合も、あとで名前を打ち間違えたり存在しないキーに書き換えたり
しても監査が永久に気づけなくなる、という同じ種類の死角が生じる。`preservePatterns` は
Requirement 2（未使用キー）側の、`status.ignoreKeys` は Requirement 1（欠損キー）側の
「恒久的な死角を作らない」（Requirement 1 AC5 の趣旨）という要求に、それぞれ対応する。

13ファミリのうち、以上の3つを具体キーの列挙に置き換え、残りの10ファミリはワイルドカードの
ままにしてある。変わる部分の取りうる値がこのファイルの
外（保存済み activity の `action` 値、スコープ id、設定されたアップローダ種別など）で決まり、
将来増えることもあるうえ、同じ接頭辞に静的呼び出しが混ざっていないためである。

`status` の報告が 182 から 176 に減ったのは、リポジトリの内容が変わったからではなく、
**本タスクで `status.ignoreKeys` を追加したため**である。research.md が記録した 182 という
数字は今日の実測でも 182 で再現した（§0 の表を参照）。

---

## 8. 再現手順

```bash
cd apps/app
npx i18next-cli status                      # 総数と言語ごとの進捗
npx i18next-cli status en_US --hide-translated   # 欠損キーの一覧（namespace 別）
npx i18next-cli status --unused             # 未使用キーの一覧
```

分類のやり直しは「`status en_US --hide-translated` の `✗ <key> (absent)` 行を namespace ごとに
拾い、`public/static/locales/en_US/{translation,admin,commons}.json` に対して、
(1) そのままの形、(2) `:` を `.` に置換した形、(3) `_one`/`_other`/`_plural` を外した形の
3通りで実在を確認する」という手順で行う。実行時の挙動が疑わしい場合は、JSON の直読みでは
判定できないので `i18next` を `init()` して `t()` の戻り値を確認する。
