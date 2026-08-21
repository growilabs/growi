# Research & Design Decisions

## Summary
- **Feature**: `g2g-external-auth-conflict-detection`
- **Discovery Scope**: Extension(既存の`g2g-import-conflict-detection`が確立した検知モジュールへの拡張)
- **Key Findings**:
  - `externalaccounts`の一意制約は`{providerType, accountId}`の**複合**キー。既存の`collectConflicts`はフィールド単独一致しか判定できず、そのままでは片方だけの一致を誤って衝突と判定する。
  - `g2g-transfer-migration-mode`の「置き換え対象集合」(`deriveReplaceTargets`)は`importSettingsMap`から汎用的に導かれており、コレクション名を一切ハードコードしていない。よってこのspecの変更後もそのまま正しく動作する(amendしなくてよいという discovery 時の判断が実装で裏付けられた)。
  - `externalaccounts`のMongooseモデルはデフォルトエクスポートを持たない(Prisma移行のTODOコメントあり、スキーマはインデックス作成のためだけに残っている)。既存コードは`mongoose.model<IUser>('User')`と同じ手法で取得できる(`g2g-transfer.ts`に既存の前例あり)。
  - `externalusergrouprelations`(関係コレクション)には一意インデックスが存在しない。`usergrouprelations`と同型で、検知対象に加える必要がない。
  - `providerType`は`ldap`/`saml`/`oidc`/`google`/`github`の5種類しか値を取らない(`apps/app/src/interfaces/external-auth-provider.ts`)。既存の`findExistingCandidates`のフィールド単独`$in`方式をそのまま複合キーに使うと、この低カーディナリティなフィールドで転送先コレクションのほぼ全件を取得してしまう(2巡目の設計レビューで指摘)。複合キーはタプル単位のバッチ`$or`で候補を取得する必要がある。

## Research Log

### 拡張ポイントの特定(Extension Point Analysis)

- **Context**: `externalaccounts`/`externalusergroups`の衝突検知をどこに・どう追加するか。
- **Sources Consulted**: `apps/app/src/server/service/import/detect-unique-conflicts.ts`(433行)、`apps/app/src/server/service/import/summarize-unique-conflicts.ts`、`apps/app/src/server/service/g2g-transfer.ts`(`detectImportConflicts`, L1511-1528)、`apps/app/src/server/routes/apiv3/g2g-transfer.ts`(L622-668)。
- **Findings**:
  - 検知の中心は`detect-unique-conflicts.ts`。`collectConflicts`(純関数、フィールド単独一致)・`detectForCollection`(1コレクション分のI/O駆動)・`detectUniqueConflicts`(orchestrator、`users`/`usergroups`をハードコードした2分岐)・`UniqueConflictReport`(`userConflicts`/`groupConflicts`の2つの固定フィールド)という積み重ね。
  - `UniqueFieldConflict.collection`は`'users' | 'usergroups'`のリテラル合併型。
  - `g2g-transfer.ts`の`detectImportConflicts`(L1511-1528)は`innerFileStats`から`users`/`usergroups`のJSONパスだけを解決して`detectUniqueConflicts`に渡す。`replaceTargetCollections`は既に汎用的に受け渡されている(引っ越しモードが追加済み)。
  - `summarize-unique-conflicts.ts`の`summarizeUniqueConflicts`は`report.userConflicts`/`report.groupConflicts`を直接読む2行構成。
  - `routes/apiv3/g2g-transfer.ts`(L664-665)は`conflictReport.userConflicts.length`/`groupConflicts.length`をログに出す。
- **Implications**: 4ファイルすべてに触れる。`UniqueConflictReport`を「コレクション名→衝突配列」の汎用形へ一般化しないと、externalaccounts/externalusergroupsを追加するたびに同じ2箇所固定パターンが増殖する(coding-styleの「宣言された集合を執行側が読む」原則に反する)。

### 複合一意キーの対象範囲(Compound Unique Key Facts)

- **Context**: `externalaccounts`/`externalusergroups`の実際のスキーマと一意制約を確定する。
- **Sources Consulted**: `apps/app/src/server/models/external-account.ts`(L17-23)、`apps/app/src/features/external-user-group/server/models/external-user-group.ts`(L26-44)、`apps/app/prisma/schema.prisma`(L200-230)。
- **Findings**:
  - `ExternalAccount`: `schema.index({ providerType: 1, accountId: 1 }, { unique: true })`。フィールドはいずれも`required: true`、`sparse`指定なし。Prisma側にも`@@unique([providerType, accountId])`として同じ制約が存在する(Mongooseスキーマは索引作成のためだけに残置)。
  - `ExternalUserGroup`: 単一フィールド`externalId`(`unique: true`、`sparse`指定なし、`required: true`)と、複合`schema.index({ name: 1, provider: 1 }, { unique: true })`の**2つ**の一意制約を持つ。
  - `ExternalUserGroupRelation`: 一意インデックスなし(`parent`への非一意インデックスのみ)。`usergrouprelations`と同型。
  - どの一意制約にも`sparse`指定が無い。既存の`users.username`/`usergroups.name`と同じパターン(`sparse`なしだがフィールドが`required: true`なので実運用では欠落ドキュメントが作れず、既存specのFollow-upsが記録した「非sparse一意索引の欠落は偽陰性になるが到達不能」という既知の受容済みリスクをそのまま踏襲する)。
- **Implications**: `externalaccounts`は複合キー1つ、`externalusergroups`は単一キー1つ+複合キー1つを検知対象として宣言する必要がある。

### モデル取得方法(Model Access Patterns)

- **Context**: `detect-unique-conflicts.ts`の`toLookup`はMongooseの`Model<T>`を要求する。`ExternalAccount`/`ExternalUserGroup`をどう取得するか。
- **Findings**:
  - `ExternalAccount`: デフォルト/named exportが無い。`mongoose.model('ExternalAccount')`(グローバルなモデルレジストリ経由)で取得する。`g2g-transfer.ts`が既に`mongoose.model<IUser>('User')`と同じ手法で`User`を取得している前例がある。専用の型インターフェース(`IExternalAccount`)は存在しないため、`detect-unique-conflicts.ts`内で既存の`UserUniqueFields`/`GroupUniqueFields`と同じパターンのローカル最小型(`ExternalAccountUniqueFields`)を定義する。
  - `ExternalUserGroup`: `~/features/external-user-group/server/models/external-user-group`のデフォルトエクスポートをそのまま使える。
- **Implications**: 新規の型定義や依存追加は不要。既存のインポート経路をそのまま使う。

### ドリフト検出の実現方法

- **Context**: 要件5(宣言と実際のデータモデルの一意制約とのドリフト検出)をどう実装するか。
- **Findings**: `users`/`usergroups`/`externalaccounts`/`externalusergroups`はいずれもMongooseスキーマを保持している(`ExternalAccount`はPrisma移行後もインデックス作成のためだけに保持)。`model.schema.indexes()`は`[indexSpec, indexOptions]`のペア配列を返し、`indexOptions.unique === true`で一意インデックスだけを抽出できる。4モデルとも同じ方法で実際の一意インデックスを読めるため、宣言側の`UniqueKeySpec`一覧と機械的に突き合わせられる。
- **Implications**: スキーマ解析用の新規ライブラリは不要。既存の`Model.schema.indexes()`をそのまま使う。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 近似検知(フィールド単独のまま追加) | 複合キーの片方だけを見て衝突判定 | 変更が最小 | 複合キーの意味を正しく表現できず偽陽性が増える。ドリフト試験の宣言もその不正確さを引き継ぐ | discoveryで却下済み |
| B: 一意キー宣言の一般化(採用) | `collectConflicts`をフィールドの組(1つ以上)で判定できるよう一般化し、宣言を1箇所にまとめる | 正確な複合キー判定。単一の情報源。ドリフト試験と自然に一体化 | `detect-unique-conflicts.ts`のコア型・アルゴリズムを書き換える | 既存の`replaceTargetCollections`のような「宣言データを引数で渡す」パターンと一貫する |
| C: 別モジュール新設 | externalaccounts/externalusergroups専用の検知関数を追加 | 既存コードへの変更ゼロ | 検知ロジックが2箇所に分裂。ドリフト試験も宣言が2つに分かれる | discoveryで却下済み |

## Design Decisions

### Decision: `UniqueFieldConflict`/`collectConflicts`を「フィールドの組」(`UniqueKeySpec`)ベースに一般化する

- **Context**: `externalaccounts`(`providerType`+`accountId`)と`externalusergroups`の`name`+`provider`は、フィールドの組み合わせ全体が一致してはじめて一意制約違反になる。既存の`collectConflicts`はフィールドを独立に見るため、そのままでは複合キーの片方だけの一致を衝突と誤判定する。
- **Alternatives Considered**:
  1. フィールド単独判定のまま、複合キーの代表フィールド1つだけを見る近似(Approach A) — 不正確。
  2. 複合キー専用の別関数を新設(Approach C) — ロジック分裂。
- **Selected Approach**: `UniqueKeySpec<T> = { label: string; fields: readonly (keyof T & string)[] }`を導入し、`collectConflicts`の第4引数を`readonly UniqueField[]`から`readonly UniqueKeySpec<T>[]`へ変更する。単一フィールドの既存キー(`username`等)は`fields`が1要素の配列になるだけで、判定結果は変わらない。複合キーは、対象フィールドすべてが非空文字列のときだけ、`JSON.stringify(fields.map(f => doc[f]))`で作った合成値でMapに索引し、既存の「値一致かつ`_id`相違」判定をそのまま適用する。
- **Rationale**: 単一/複合を同じ抽象で表現でき、新しい判定アルゴリズムを増やさずに済む(generalization、simplification両方の観点で最小)。
- **却下した合成方法**: 当初は区切り文字による単純な文字列連結(例: `providerType + '|' + accountId`)を検討したが、1巡目の設計レビューで指摘された通り、フィールドの値自体に区切り文字と同じ文字列が含まれると異なる組み合わせが同じ合成値になり、要件1.2(組み合わせの一部だけの一致は非衝突)に違反する偽陽性を生む(例: `providerType="a", accountId="b|c"`と`providerType="a|b", accountId="c"`がどちらも`"a|b|c"`になる)。`JSON.stringify`による配列表現なら各要素の境界が構造的に定まるため、値の中身に依存せず安全に区別できる。
- **Trade-offs**: `UniqueFieldConflict.field`の型を、既存の閉じた合併型`UniqueField`(`'username' | 'email' | 'slackMemberId' | 'name'`)から`string`へ広げる必要がある。複合キーのラベル(`providerType+accountId`等)は`UniqueField`のいずれの要素にも該当せず、型を広げないと代入できない(コンパイルエラーになる)。プロパティ名は`field`のまま残す(呼び出し側3ファイルの不要な差分を避ける)。`summarize-unique-conflicts.ts`は`conflict.field`をテンプレートリテラルに埋め込むだけなので、型を広げても書き換えは不要であることを確認済み。
- **Follow-up**: `USER_UNIQUE_FIELDS`/`GROUP_UNIQUE_FIELDS`の型を`UniqueKeySpec<T>[]`へ変更する。当初「モジュール内でのみ使用されており外部への影響はない」と確認したが、これは`rescue-admins.ts`(実装本体)だけを見た判断で誤りだった(3巡目の設計レビューで発見)。**`rescue-admins.spec.ts`(テストファイル)が`USER_UNIQUE_FIELDS`を文字列配列として直接importし、`for (const field of USER_UNIQUE_FIELDS) { expect(rescued.user[field])... }`という形でプロパティアクセスに使っている(187-201行目)。** `USER_UNIQUE_KEYS`への変更に伴い、このテストを`USER_UNIQUE_KEYS.flatMap(key => key.fields)`のように書き換える必要がある(design.mdのFile Structure Planに反映済み)。`rescue-admins.ts`本体と`UserUniqueField`/`GroupUniqueField`(個別フィールド名の合併型、`ArchiveUserIdentity`が使用)には影響しない。

### Decision: `UniqueConflictReport`をコレクション名→衝突配列の汎用形へ一般化する

- **Context**: 現在の`{ userConflicts, groupConflicts }`という固定2フィールド構造では、コレクションを増やすたびに構造そのものを変更する必要があり、`summarize-unique-conflicts.ts`とルートのログ出力(2箇所)にも同じ固定パターンが複製されている。
- **Selected Approach**: `UniqueConflictReport`を`{ conflictsByCollection: ReadonlyMap<CollectionName, readonly UniqueFieldConflict[]> }`へ変更する。`CollectionName`は`'users' | 'usergroups' | 'externalaccounts' | 'externalusergroups'`の合併型。`hasConflicts`・`summarizeUniqueConflicts`・ルートのログ出力を、固定2フィールドを読む形からMapを走査する形へ書き換える。
- **Rationale**: 新しいコレクションを追加するときに触れるのは「宣言(`UniqueKeySpec`一覧)」だけになり、`UniqueConflictReport`の形やその消費側3か所は変更不要になる(coding-styleの「executorは宣言された集合を引数で受け取る」原則)。
- **Trade-offs**: 消費側3ファイル(`summarize-unique-conflicts.ts`、`g2g-transfer.ts`の型参照、`routes/apiv3/g2g-transfer.ts`のログ出力)を同時に更新する必要がある。いずれも同一spec内のタスクで完結する。

### Decision: ドリフト試験は`Model.schema.indexes()`を宣言と突き合わせる

- **Context**: 要件5。将来別の一意インデックスが増えたときに検知漏れが再発するのを防ぐ。
- **Selected Approach**: `users`/`usergroups`/`externalaccounts`/`externalusergroups`の4モデルそれぞれで`model.schema.indexes()`を読み、`unique: true`のインデックスのフィールド集合を抽出する。宣言側(この spec が新設する`UniqueKeySpec`一覧)のフィールド集合と、コレクションごとに集合として比較する試験を1本追加する。
- **Rationale**: 既存の`g2g-import-conflict-detection`のtasks.md Follow-upsが「スキーマ定義から索引を読んで宣言リストと突き合わせるドリフトspecを1本足す価値がある」と予告していた形そのもの。追加の依存ライブラリは不要。
- **Trade-offs**: なし(既存のMongoose APIのみで実現できる)。

### Decision: 複合キーの既存候補取得はタプル単位のバッチ`$or`にする(フィールド単独`$in`を流用しない)

- **Context**: 2巡目の設計レビューで指摘。既存の`findExistingCandidates`は、キーのフィールドごとに1本`$in`クエリを打ち、アーカイブ側が実際に使っている値に一致する既存ドキュメントだけを取得する設計になっている。これは`username`/`email`のように値の種類が非常に多いフィールドでは有効な絞り込みだが、`externalaccounts`の`providerType`は`ldap`/`saml`/`oidc`/`google`/`github`の5種類しか値を取らないため、この方式をそのまま流用すると`providerType`単体の`$in`が転送先コレクションのほぼ全件に一致してしまう。
- **Alternatives Considered**:
  1. フィールド単独`$in`をそのまま複合キーにも流用する — `externalaccounts`/`externalusergroups`のような値の種類が少ないフィールドを含む複合キーで、既存コードが守っている「既存データを一括で全部メモリに乗せない」という性能上の前提を壊す。却下。
  2. 過剰取得を許容し、性能はモニタリングで運用対応する — SSO連携を使う環境で`externalaccounts`が数万件規模になりうることを考えると、初回実装から避けられる問題を残す理由がない。却下。
- **Selected Approach**: 複合キーについては、アーカイブ側が実際に使っているキーの組み合わせ(タプル)ごとに全フィールド完全一致の条件を組み立て、バッチにまとめた`$or`クエリで既存候補を取得する。`externalaccounts`/`externalusergroups`が既に持つ複合インデックス(`{providerType, accountId}`/`{name, provider}`)をそのまま使えるため、Mongo側の負荷も抑えられる。単一フィールドキー(`username`等)は既存の`$in`方式のままでよい。
- **Rationale**: 複合キーの性質(値の種類が少ないフィールドを含みうる)に対して、単一フィールド向けの絞り込み戦略をそのまま適用しない、という判断。
- **Trade-offs**: `findExistingCandidates`のバッチ構築ロジックが、単一キー用と複合キー用の2通りになる。ただし判定そのもの(`collectConflicts`)は変わらないため、影響は候補取得の内部実装に閉じる。

### Decision: コレクションごとの一意キー宣言は、`Record`ではなく「Tを閉じ込めるヘルパー関数」で持つ

- **Context**: 4巡目の設計レビューで指摘。コレクションごとに一意キーの型`T`(`UserUniqueFields`/`GroupUniqueFields`/`ExternalAccountUniqueFields`/`ExternalUserGroupUniqueFields`)が異なるため、宣言を`Record<CollectionName, {keys, pick}>`のような連想配列で素直に持とうとすると、値の型を`T`ごとに書き分けられず、`pick`関数を`(doc: RawDocument) => RawDocument`へ広げる必要が出る。しかし`UserUniqueFields`のような具体的なインターフェースには索引シグネチャが無いため、この代入は実際にtscでエラーになることを確認した(`Index signature for type 'string' is missing in type 'UserUniqueFields'`)。型アサーション(`as`)で無理やり通すことは、`.claude/rules/coding-style.md`の型アサーション回避方針に反する。
- **Alternatives Considered**:
  1. `Record<CollectionName, {keys, pick}>`を型アサーションで通す — coding-styleの方針に反するため却下。
  2. `collection`で判別できる合併型にして、orchestratorの中でコレクションごとに`switch`分岐する — 型アサーションは避けられるが、今度はorchestratorに「コレクション名で分岐する処理」が復活し、「新しいコレクションが増えたときに宣言へ1エントリ追加するだけで済む」というRevalidation Triggerの前提を壊す。却下。
- **Selected Approach**: `declareDetector<T>(collection, keys, pick)`というジェネリックなヘルパー関数を用意し、コレクションごとに1回呼び出す。この呼び出し1回1回が独立したジェネリック呼び出しなので、その場で`T`が確定し、返り値の`CollectionDetector`(`{ collection, detect(jsonPath, lookup) }`)自体はジェネリック引数を持たない(`T`は`detect`メソッドの中に閉じ込められる)。そのため`COLLECTION_DETECTORS: readonly CollectionDetector[]`は型アサーションなしで均質な配列として持てる。
- **Rationale**: 「宣言を1箇所にまとめる」という目標と「型アサーションを避ける」という既存の規約の両方を、実装可能な形で両立させる。
- **Trade-offs**: なし(既存の`detectForCollection`をそのまま`declareDetector`の内部から呼ぶだけで、判定ロジック自体は変わらない)。

## Risks & Mitigations

- **`ExternalAccount`にモデルのexportが無い** — `mongoose.model('ExternalAccount')`で取得する(既存の`User`取得と同じ手法)。この呼び出しより前に一度でも`~/server/models/external-account`がインポートされていることが必要だが、G2G受信ルートが動く時点ではサーバ起動時に読み込まれているため到達可能(既存の`User`/`UserGroup`と同様、起動グラフに含まれるモデルファイル)。
- **`field`プロパティの意味拡張が将来の読み手に伝わらない** — 型のドキュメンテーションコメントで「単一フィールド名、または複合キーのラベル」であることを明記する。
- **`UniqueConflictReport`の形の変更が、想定より広い範囲の既存テストを壊す** — 1巡目の設計レビューで、`apps/app/src/server/service/g2g-transfer.integ.ts`が`report.userConflicts`/`report.groupConflicts`という現在の形に直接依存する`expect`を15箇所以上持っていることが判明した(このファイルはdesign.md初版のFile Structure Planに含まれていなかった)。`detect-unique-conflicts.spec.ts`/`.integ.ts`/`summarize-unique-conflicts.spec.ts`についても、単なるケース追加ではなく既存アサーションの書き換えが必要。design.mdのFile Structure Planに反映済み。
- **ドリフト試験(要件5)の「実際の一意制約」の正が、`externalaccounts`については将来Mongooseからずれる** — 5巡目の設計レビューで指摘。`external-account.ts`のMongooseスキーマは「全モデルがPrismaへ移行完了するまでの暫定コード」と明記されており(`.claude/rules/model.md`)、同じ一意制約は既に`prisma/schema.prisma`にも存在する。全モデルの移行が完了しMongooseスキーマが削除される段階になったら、ドリフト試験の参照先をPrismaスキーマへ切り替える必要がある。design.mdのRevalidation Triggersに追記済み。

## References
- `.kiro/specs/g2g-import-conflict-detection/design.md` — 検知ゲートの既存契約(port-back対象)。
- `.kiro/specs/g2g-import-conflict-detection/tasks.md` Follow-ups — ドリフト試験の予告。
- `.kiro/specs/g2g-transfer-migration-mode/design.md` — `deriveReplaceTargets`が宣言データ駆動であることの根拠。
