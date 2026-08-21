# Brief: g2g-external-auth-conflict-detection

## Amend Target

このspecは **amend spec**(`.claude/rules/spec-lifecycle.md`)である。実装完了後、変更内容を以下のtarget specへport-backし、このspecディレクトリ自体を削除することを最終タスクとする。

- **Target**: `g2g-import-conflict-detection`(実装完了・PR #11643でマージ済み)
- **書き換わる契約**:
  - `requirements.md` の Boundary Context「Out of scope」— 「`users`以外・`usergroups`以外のコレクションが持つ一意制約の網羅的な検知」および「ExternalUserGroup系コレクションの衝突検知」を対象外としている記述を、externalaccounts/externalusergroupsを対象に含める記述へ書き換える。要件番号は既存のものを変更せず、末尾に追記する形にする。
  - `design.md` の Boundary Commitments「This Spec Owns」(検知ロジックの対象範囲)・「Out of Boundary」(ExternalUserGroup系を除外している記述)・Revalidation Triggers(一意インデックス定義が変わったときの再検証条件に「宣言リストとのドリフト」を追加)。
  - `apps/app/src/server/service/import/detect-unique-conflicts.ts` の `collectConflicts` / `UniqueField` 等の型・アルゴリズム(単一フィールド一致→フィールドの組(1つ以上)一致への一般化)。
- **対象外(このamendが変えないもの)**: `g2g-transfer-migration-mode`。「置き換え対象集合の算出」はモード名で分岐せず宣言データから汎用的に導く設計(D4)のため、externalaccounts/externalusergroupsが転送対象に加わっても既存メカニズムがそのまま正しく動作し、契約変更が不要と判断した。

このセッション内での上記判断(既存specの記述を書き換えることを含む)はユーザー承認済み — port-back時に躊躇せず実施してよい。

## Problem

GROWI管理者がG2G(GROWI-to-GROWI)転送でSSO/LDAP/SAML連携を使っている環境間のデータ移行を行うと、issue #10151と同一の症状(転送元でグループXに公開設定されていたページが、転送先で閲覧不能になる。転送自体は「成功」と表示される)が再現する。

## Current State

issue #10151への対応は2段階で行われた。

1. `g2g-import-conflict-detection`(PR #11643): 取り込み開始前に`users`(username/email/slackMemberId)と`usergroups`(name)の一意制約衝突を検知し、衝突があれば書き込み前に中断するゲートを追加。
2. `g2g-transfer-migration-mode`(PR #11695/#11698): 転送に「引っ越し(移行先を置き換える)」という既定の意味を追加。置き換えでは転送元の識別子がそのまま入るため、一意制約の衝突が原理的に発生しなくなる。

この2段で、`users`/`usergroups`のusername/email等をキーにした通常のケースは解消した(issue #10151へ2026-08-20にコメント済み)。

しかし、両specとも意図的に対象外としたコレクションが残っている。

- `externalaccounts`: `{providerType, accountId}`の複合一意制約を持つ。転送UIの除外リストに無く、既定で選択され、既定モードは`insert`。
- `externalusergroups`: `{externalId}`単体、および`{name, provider}`の複合一意制約を持つ(LDAP/SAML連携グループの同期)。

両者ともusername/emailとは独立した識別子系なので、`users`/`usergroups`の衝突検知ゲートを通過しても、転送元と転送先で同じSSOアカウントID(またはLDAP/SAMLの外部グループID)を持つ場合、`externalaccounts`(または`externalusergroups`)のinsertがサイレントに失敗し、取り込まれた`usergrouprelations`が実際にログインするユーザーに紐づかず、issue #10151と同じForbiddenが再現する。

## Desired Outcome

- `externalaccounts`と`externalusergroups`の一意制約衝突も、`users`/`usergroups`と同様に取り込み開始前に検知され、書き込みを一切行わずに転送が中断される。
- 複合一意制約(`{providerType, accountId}`等)を、フィールド単独ではなく組み合わせとして正しく判定する(片方だけの一致による誤検知を起こさない)。
- 一意インデックス定義と検知対象の宣言が将来ずれたとき(新しい一意索引が追加されたとき)に、それを機械的に検出するドリフト試験がある。
- 引っ越しモード(`g2g-transfer-migration-mode`)側は変更不要で、既存の「置き換え対象集合」の仕組みがそのまま効く。

## Approach

Approach B(複合キー対応への一般化 + ドリフト試験)を採用。

`detect-unique-conflicts.ts`の`collectConflicts`を「フィールド単独一致」から「フィールドの組(1つでも複数でも)がすべて一致」で判定できるよう一般化する。コレクション→一意キー定義(単一/複合)の宣言を1箇所にまとめ、この宣言をドリフト試験(実際のMongooseスキーマの一意インデックス定義と突き合わせる)にも共有する。

検討した他の案:
- **A(片方のフィールドだけ近似的に見る)**: 変更が最小だが、複合キーの片方だけを見るのは不正確で偽陽性が増える。ドリフト試験の宣言リストも複合キーを正しく表現できないため却下。
- **C(別モジュールとして並存)**: 既存コードへの変更ゼロだが、検知ロジックが2箇所に分かれ「単一の情報源」の原則に反する。ドリフト試験も宣言リストが2つに分かれ、要望の趣旨(将来の検知漏れ防止)を弱めるため却下。

実装ファイル(`detect-unique-conflicts.ts`)を確認済み: 引っ越しモードが追加した`ArchiveUserIdentity`/`readArchiveUserIdentity`(管理者救済用、`UserUniqueField`専用の別の型)は複合キー化の影響を受けず、後方互換性の懸念は小さい。

## Scope

- **In**:
  - `externalaccounts`(`{providerType, accountId}`)の衝突検知
  - `externalusergroups`(`{externalId}`、および`{name, provider}`)の衝突検知
  - 一意キー定義の宣言を1箇所にまとめ、単一/複合の両方を表現できる形に一般化
  - 宣言と実スキーマの一意インデックスとのドリフト検出試験
  - `g2g-import-conflict-detection`のrequirements.md/design.mdへのport-back、amend spec自身の削除
- **Out**:
  - `g2g-transfer-migration-mode`への変更(契約変更不要と判断済み)
  - 一意制約以外の衝突検知(例: 参照整合性の破損)
  - 手動zip取り込み画面への検知組み込み(既存のg2g-import-conflict-detectionが既に対象外としている範囲を踏襲)

## Boundary Candidates

- **一意キー定義の一般化**: 単一/複合キーを同じ形で宣言し、`collectConflicts`がその宣言を読んで判定する。
- **externalaccounts/externalusergroups固有の抽出**: アーカイブJSONからの読み取り・既存データの照会アダプタ(既存の`users`/`usergroups`用アダプタと同じパターン)。
- **ドリフト試験**: 宣言リストと実際のMongooseスキーマの一意インデックスを突き合わせる、経路非依存の試験。
- **port-back**: `g2g-import-conflict-detection`のrequirements.md/design.mdの書き換えと、amend spec自身の削除。

## Out of Boundary

- `g2g-transfer-migration-mode`の「置き換え対象集合の算出」ロジック(変更不要)。
- 受信ルートのゲート配置・通知経路そのもの(`g2g-import-conflict-detection`が既に確立した仕組みをそのまま使う)。
- ページ閲覧可否判定、認証・認可の仕組み(いずれも既存のまま)。

## Upstream / Downstream

- **Upstream**: `g2g-import-conflict-detection`(検知ロジック・受信ゲート・通知経路を所有)。`g2g-transfer-migration-mode`(置き換え対象集合の算出方式が、この変更の影響を受けないことの前提)。
- **Downstream**: なし(既存の2specの上に乗る最終的な穴埋め)。ただしport-back後は`g2g-import-conflict-detection`のRevalidation Triggersに「宣言リストとのドリフト」が加わるため、将来別の一意索引が増えたときの参照先になる。

## Existing Spec Touchpoints

- **Extends(amend target)**: `g2g-import-conflict-detection`
- **Adjacent(変更なし)**: `g2g-transfer-migration-mode`

## Constraints

- 対象ブランチはmaster(dev/8.0.x等の中間ブランチは現在運用されていない)。
- 既存のTDD(RED→GREEN)・実DB結合試験の方針(`g2g-import-conflict-detection`のtasks.md冒頭注記)を踏襲する。
- 型安全モック(`mock<T>()`)・named export・no-extension importなど、リポジトリ共通のcoding-style規約に従う。
