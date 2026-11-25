# Brief: growi-vault-remove-guest-clone

承認済みの spec の契約を変えるための amend spec。実装が入ったら、最後のタスクで変更を元の spec に書き戻し、この spec を削除する（`.claude/rules/spec-lifecycle.md`）。

## 問題

- GROWI 管理者とページの作成者が困っている。ゲスト閲覧を許可しているサイトで、ページの権限を絞ったり、ページを削除したりしても、その内容が Vault のゲスト向けクローンから取り出せる。
- 現状、認証情報のない `git clone` は `userId: null` として扱われ、すべてのゲストで 1 本の `anonymous-view` を共有する。
- ビューの合成は、前回のビューの commit を親にしてつなぐ。そのため `anonymous-view` の履歴には、過去に public だったすべての内容が残る。新しくクローンしたゲストは、今の public ページだけでなく、履歴に残った過去の内容も受け取る。
- ログインユーザーのビューは 1 人に 1 本で、履歴に入るのは本人が過去に受け取った内容だけなので、この問題の対象外。

## 方針

ゲストのクローンそのものを廃止する。ゲスト閲覧の設定によらず、認証情報のないクローンは 401 を返して PAT を求める。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| growi-vault-gateway | 要件 2.4（認証ヘッダーなし・ゲスト許可のとき匿名として続行する）、要件 2.4a（認証ヘッダーなし・ゲスト拒否のとき 401）、要件 3.2（匿名の namespace は `['public']`）、要件 11 のうちゲストの可否を標準 middleware に委ねる部分、design.md の匿名の分岐 |
| growi-vault | 要件 3.4（匿名アクセスには public のページだけを返す） |
| growi-vault-manager | 要件 4.7（`userId: null` を受け取ったら `anonymous-view` を返す）、design.md の `anonymous-view` と `vault_user_views` の匿名の記録 |

Revalidation Triggers への影響: growi-vault-gateway の design.md は `security:restrictGuestMode` / `security:wikiMode` の仕様変更を再検証の条件に挙げている。この amend の後は、クローンの可否がこれらの設定に左右されなくなるので、設計の段階でこの条件を見直す。
