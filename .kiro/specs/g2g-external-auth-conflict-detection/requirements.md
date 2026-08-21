# Requirements Document

## Project Description (Input)

SSO/LDAP/SAML連携を使っているGROWI間でG2G(GROWI-to-GROWI)転送を行うと、issue #10151と同一の症状(転送元でグループXに公開設定されていたページが、転送先で閲覧不能になる。転送は「成功」と表示される)が、`externalaccounts`(`{providerType, accountId}`の複合一意制約)および`externalusergroups`(`{externalId}`単体、`{name, provider}`の複合一意制約)を経由して再現する。

既存の対応(`g2g-import-conflict-detection`の衝突検知ゲート、`g2g-transfer-migration-mode`の引っ越しモード)は、いずれも`users`/`usergroups`に限定されており、`externalaccounts`/`externalusergroups`は両specとも明示的に対象外(Out of scope / Non-Goals)としている。

本specは、この対象外領域を塞ぐ。`detect-unique-conflicts.ts`の衝突検知ロジックを複合一意キー(フィールドの組)に対応するよう一般化し、`externalaccounts`/`externalusergroups`を検知対象に加える。加えて、一意キー定義の宣言と実際のデータモデルの一意制約とのドリフトを検出する試験を追加する。

本specは`g2g-import-conflict-detection`(実装完了済み)の契約を書き換えるamend spec(`.claude/rules/spec-lifecycle.md`)である。実装完了後、変更内容を`g2g-import-conflict-detection`のrequirements.md/design.mdへport-backし、本specディレクトリ自体を削除することを最終タスクとする。詳細は`brief.md`の「Amend Target」節を参照。

`g2g-transfer-migration-mode`は対象外(amendしない)。「置き換え対象集合の算出」がモード名で分岐せず宣言データから汎用的に導く設計のため、この変更の影響を受けず契約変更が不要と判断済み。

## Introduction

このドキュメントは、G2G転送における`externalaccounts`(外部連携アカウント)・`externalusergroups`(外部連携グループ)の一意制約衝突の扱いに関する要件を定義する。目的は3つある。第一に、転送元アーカイブと転送先GROWIの既存データとの間に、これら2コレクションの一意制約衝突(`externalaccounts`は`providerType`+`accountId`の組み合わせ、`externalusergroups`は`externalId`単体、または`name`+`provider`の組み合わせ)があるとき、既存の`users`/`usergroups`検知と同様に取り込み開始前に検知して操作者へ通知すること。第二に、衝突が無い転送では、転送元でSSO/LDAP/SAML連携によって外部アカウント・外部グループに結びついていたユーザーが、転送後も同じ外部識別子でログインし、そのグループ公開ページを閲覧できる状態を維持すること。第三に、検知対象の一意フィールド宣言が、将来新しい一意制約が追加されたときにも実際のデータモデルからずれないことを機械的に確認できるようにすること。

`externalaccounts`の一意制約は2フィールドの組み合わせであり、片方のフィールドだけが一致しても衝突ではない。本要件はこの点を明示的に区別する。

## Boundary Context

- **In scope**:
  - G2G転送の受信側で、`externalaccounts`・`externalusergroups`の一意制約衝突を、コレクションの書き込み開始前に検知する。
  - 複合一意制約(`providerType`+`accountId`、`name`+`provider`)を、フィールドの組み合わせとして正しく判定する(組み合わせの一部だけが一致する場合は衝突としない)。
  - 衝突が検知された場合に、既存の`users`/`usergroups`衝突と同じ経路・同じ形式で操作者へ通知する。
  - 衝突が無い場合に、SSO/LDAP/SAML連携によるログインとグループ公開ページのアクセス権が転送後も維持されること。
  - 検知対象の一意フィールド宣言(`users`/`usergroups`/`externalaccounts`/`externalusergroups`)と、実際のデータモデルに定義されている一意制約とのドリフトを検出する試験。
- **Out of scope**:
  - `g2g-transfer-migration-mode`の「置き換え対象集合の算出」ロジックの変更。宣言データから汎用的に導く既存の設計がそのまま適用されるため、変更を必要としない。
  - `externalusergrouprelations`(外部連携グループとユーザーの関係コレクション)の衝突検知。関係コレクションには一意制約が存在しない(`usergrouprelations`と同様)。
  - 管理画面からの手動GROWIアーカイブ取り込み(zipアップロード)経路への検知組み込み。`g2g-import-conflict-detection`が既に対象外としている範囲を踏襲する。
  - 一意制約以外の整合性検知(参照整合性の破損など)。
  - 取り込みモード(`insert`/`upsert`/`flushAndInsert`)の意味そのものの変更、およびデータベースの一意制約(インデックス定義)の変更。
- **Adjacent expectations**:
  - 本specの検知結果は、`g2g-import-conflict-detection`が確立した受信側の中断ゲート・通知経路にそのまま乗る。新しい通知経路や中断の仕組みは作らない。
  - 実装完了後、本specの変更内容は`g2g-import-conflict-detection`のrequirements.md/design.mdへport-backされ、本spec自身は削除される。

## Requirements

### Requirement 1: 一意制約衝突の検知範囲拡張(externalaccounts / externalusergroups)

**Objective:** SSO/LDAP/SAML連携を使うGROWI間でG2G転送を行う管理者として、`externalaccounts`と`externalusergroups`についても、取り込むアーカイブと転送先の既存データとの一意制約衝突を、取り込みが始まる前に検知してほしい。`users`/`usergroups`の衝突検知だけでは防げないアクセス不能を防ぐため。

#### Acceptance Criteria
1. When 取り込み対象アーカイブに、転送先GROWIに既に存在する外部連携アカウントと同じ`providerType`と`accountId`の組み合わせを持つ外部連携アカウントドキュメント(かつ既存ドキュメントとは異なる`_id`)が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
2. If アーカイブ側と既存側で`providerType`のみが一致し`accountId`が異なる場合、または`accountId`のみが一致し`providerType`が異なる場合, then the G2G Transfer System shall それを衝突として扱わない。
3. When 取り込み対象アーカイブに、転送先GROWIに既に存在する外部連携グループと同じ`externalId`を持つ外部連携グループドキュメント(かつ既存ドキュメントとは異なる`_id`)が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
4. When 取り込み対象アーカイブに、転送先GROWIに既に存在する外部連携グループと同じ`name`と`provider`の組み合わせを持つ外部連携グループドキュメント(かつ既存ドキュメントとは異なる`_id`)が含まれる場合, the G2G Transfer System shall それを一意制約衝突として検知する。
5. If 一意フィールド(または一意フィールドの組み合わせ)の値が一致してもアーカイブ側と既存側の`_id`が同一の場合(同一ドキュメントの再取り込み), then the G2G Transfer System shall それを衝突として扱わない。
6. Where 転送対象コレクションに`externalaccounts`または`externalusergroups`が含まれない場合, the G2G Transfer System shall そのコレクションについての衝突検知を行わず、他コレクションの転送を妨げない。

### Requirement 2: 衝突時にサイレントな破壊を起こさない(拡張コレクションにも適用)

**Objective:** 管理者として、`externalaccounts`/`externalusergroups`で一意制約衝突があるときも、`users`/`usergroups`の場合と同じく壊れたデータが作られないでほしい。転送は「成功」と表示されるのにSSO/LDAPでログインできなくなる、という状態を避けるため。

#### Acceptance Criteria
1. If `externalaccounts`または`externalusergroups`で一意制約衝突が1件以上検知された場合, then the G2G Transfer System shall 既存の`users`/`usergroups`衝突時と同様に、いずれのコレクションについても取り込み(書き込み)を開始しない。
2. If `externalaccounts`または`externalusergroups`で一意制約衝突が1件以上検知された場合, then the G2G Transfer System shall 転送を「成功」として完了させず、衝突が原因で転送が中断されたことを操作者に通知する。
3. While 衝突検知を実行している間, the G2G Transfer System shall 転送先GROWIの既存データ(`externalaccounts`/`externalusergroups`を含む)を変更しない。

### Requirement 3: 通知が実行可能である(拡張コレクションにも適用)

**Objective:** 管理者として、`externalaccounts`/`externalusergroups`の衝突が通知されたときも、何がどう衝突したのかを理解できるようにしてほしい。原因不明のまま止まるのを避けるため。

#### Acceptance Criteria
1. When `externalaccounts`または`externalusergroups`の衝突を操作者に通知する場合, the G2G Transfer System shall どのコレクションと、どの一意フィールド(またはフィールドの組み合わせ)が、どの値で衝突したかを操作者が特定できる情報を通知に含める。
2. When 拡張コレクションの衝突を通知する場合, the G2G Transfer System shall 既存の`users`/`usergroups`衝突通知と同じ通知経路・同じ形式(種別・件数・代表例)で通知する。

### Requirement 4: 衝突が無いときはSSO/LDAPログインとグループアクセスが維持される

**Objective:** 管理者として、衝突が無い正常な転送では、転送元でSSO/LDAP連携によって外部アカウント・外部グループに結びついていたユーザーが、転送後も同じ外部識別子でログインし、そのグループ公開ページを閲覧できる状態が維持されてほしい。移行の目的(認証・アクセス権ごとの移行)を満たすため。

#### Acceptance Criteria
1. When 一意制約衝突が検知されず転送が実行された場合, the G2G Transfer System shall `externalaccounts`を、取り込み後に転送元と同じ`providerType`+`accountId`の組み合わせから同じユーザーへ解決できる状態で取り込む。
2. When 一意制約衝突が検知されず転送が実行された場合, the G2G Transfer System shall `externalusergroups`を、取り込み後に転送元と同じ外部グループ識別子(`externalId`、または`name`+`provider`)から同じグループへ解決できる状態で取り込む。
3. The G2G Transfer System shall 衝突が無い転送について、`externalaccounts`/`externalusergroups`を含む対象コレクションの取り込みが完了するという従来の転送成功挙動を変更しない。

### Requirement 5: 一意制約宣言と実際のデータモデルとのドリフト検出

**Objective:** 保守者として、検知対象の一意フィールド宣言が、実際のデータモデルに定義されている一意制約から離れていないことを機械的に確認できるようにしてほしい。将来新しい一意制約が追加されたときに検知漏れが再発するのを防ぐため。

#### Acceptance Criteria
1. The G2G Transfer System shall `users`/`usergroups`/`externalaccounts`/`externalusergroups`の一意フィールド宣言と、対応するデータモデルに実際に定義されている一意制約とを突き合わせる試験を提供する。
2. If 宣言と実際の一意制約の定義が一致しない場合(宣言に無い一意制約が実在する、または宣言にあるが実在しない), then the G2G Transfer System shall その試験を失敗させ、不一致の内容(コレクション名・フィールド)を判定できる形で報告する。

### Requirement 6: 検知結果の再現可能なテスト

**Objective:** 保守者として、`externalaccounts`/`externalusergroups`の衝突検知とアクセス維持が実データベース上で検証されるようにしてほしい。モックでは表面化しない一意制約・複合キー判定の挙動を担保するため。

#### Acceptance Criteria
1. The G2G Transfer System shall `externalaccounts`の衝突検知について、転送先に既存ドキュメントを持つ実データベース上で、衝突あり・複合キーの一部一致のみ(`providerType`のみ一致/`accountId`のみ一致)・同一`_id`の再取り込みの各ケースを検証できるようにする。
2. The G2G Transfer System shall `externalusergroups`の衝突検知について、`externalId`衝突・`name`+`provider`衝突・両方無衝突・同一`_id`の再取り込みの各ケースを実データベース上で検証できるようにする。
