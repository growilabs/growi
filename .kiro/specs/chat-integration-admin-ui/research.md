# Research & Design Decisions: chat-integration-admin-ui

## Summary

- **Feature**: `chat-integration-admin-ui`
- **Discovery Scope**: Extension（既存の管理画面の作り直し。light discovery）
- **調査日**: 2026-11-24。突き合わせ先: `brief.md`・`requirements.md` と、現行コード（`packages/chat`、`apps/app/src/features/chat-integration`、`apps/chat-integration-proxy`）。
- **Key Findings**:
  - 方向性は brief.md の決定と一致し、`@growi/chat` と proxy の契約を変えずに収まる。
  - brief.md の記述と現行コードの食い違いが 2 つある（通知先の配信イベント 0 件、`keep`）。どちらも、要件・design は現行コードに合わせてある。
  - 要件 2.16 の「以降」には、outbox に書き留め済みの通知が絡む。解釈を design に明記した。
  - `chat-integration-agent` の残りのタスク（6.3 と 7）のうち、7.1 が `chat-integration-app` の design.md の管理画面の項を書き換える。書き戻しの順番に制約がある。

## Research Log

### 通知先の配信イベントが 0 件のとき（要件 2.17）

- **Context**: brief.md は「配信イベントが 0 件でも保存できる」と書く。
- **Findings**: サーバー（`notification-destinations.ts` の `parseDestinationInput`）は、`triggerEvents` が空の保存を `400`（`invalid-destination`）で拒む。画面の追加フォームは 0 件でも送れるので、管理者に見えるのは、英語のトーストのサーバーのメッセージ。「保存できてしまう」のではなく、「送ってから、分かりにくく断られる」が実際。
- **Implications**: サーバーの検査は変えない。画面の側で、0 件のあいだ追加を押せなくし、理由を自分の言語で示す。

### `already-paired` と、GROWI 側だけの切断（要件 9.21）

- **Findings**: proxy の `already-paired` は `(installation_id, growi_uri)` の一意制約で返る。有効な接続が既にある場合のほか、GROWI で切断（`unpairRelation`。`state: 'unpaired'` にして鍵・権限・通知先を消すだけで、proxy は呼ばない）してから同じワークスペースへ再接続しようとした場合にも返る。後者では、一覧に有効な接続が無いので、「一覧を確認してください」だけでは行き止まりになる。
- **Implications**: 要件 9.21 は、一覧に有効な接続が無いときに、`unregister` の手順を足す。`relation-already-known`（proxy が返した識別子を GROWI が既に持っていた）は、一覧の確認だけで正しい（9.22）。

### 現行のコマンドの語彙

- **Findings**: `COMMAND_NAMES` は `search`・`create-page`・`agent`・`link-preview`・`help`。`keep` は `chat-integration-agent` のタスク 6.1 で除かれた。書き込み系は `create-page` と `agent`。`CommandTraits` は `writes`・`targeting`・`directMessagePolicy`・`mayCreatePages` を持つ。`judge()` の既定は、行が無ければ書き込み系を拒否、それ以外を許可。
- **Implications**: 「既定値」の表示は `COMMAND_TRAITS[c].writes` から決め、コマンド名で分岐しない。

### 通知の送出と、通知先の削除（要件 2.16）

- **Findings**: 通知は、ページの保存時に宛先を引いて `chat_notification_outbox` に書き留める（`targets` に宛先の写しを持つ）。`drain` がそこから送る。
- **Implications**: 通知先を消しても、削除の前に書き留められた通知は送られる（書き留めてから送るまで、およそ 15 分以内）。「以降」を、削除より後に起きるイベントと解釈する。outbox の書き換えは範囲外。

### チャンネルの一覧の取得口

- **Findings**: `loadChannelInventory`（`server/channel-inventory.ts`）が、proxy から一覧を取り、保存済みの宛先の名前を最新に直す。通知先の画面は、一覧・宛先・重複の警告を 1 つの口（`GET …/notification-destinations`）で返し、proxy に届かないときも `200` で `channelsUnavailable` に理由を入れる。権限の画面には、一覧だけを返す口が無い。
- **Implications**: 権限の画面のために、一覧だけを返す口を足す。通知先の口の `channels` を流用しない（権限が、通知先の取得に結び付き、宛先の重複の計算まで走るため）。届かないときの返し方は、通知先と同じく `200` と `unavailable`。

### 画面を開いたときの proxy への問い合わせ

- **Findings**: 通知先の取得は、接続ごとに proxy へチャンネルの一覧を問い合わせる。接続が多いと、画面を開いただけで、その数だけ proxy への問い合わせが走る。
- **Implications**: 折りたたみの中を、初めて開くまで描かない設計にする。問い合わせは、開いたカードの分だけになる。

### 機能表の `substitute`

- **Findings**: `CapabilityReport` の `substitute` は、proxy が持つ英語の文（`CAPABILITY_SUBSTITUTE`）をそのまま返す。機能の名前は 15 個（`CapabilityName`）、対応の程度は 4 つ（`CapabilityLevel`）、サービスは 4 つ。`ConnectionHealth` は 4 つ。
- **Implications**: 名前・程度・サービス・健全性は、画面で言葉に置き換える（知らない値は生のまま）。`substitute` は proxy の文をそのまま出す。翻訳には、proxy の契約の変更が要る。

### i18n の検査

- **Findings**: `pnpm run lint:i18n`（`tools/i18n-audit`）は `i18next-cli status` を使い、未訳と未使用のキーの数を `baseline.json` と比べる。`chat-integration-agent` は新しいキーを 5 言語に同時に足し、基準値を上げていない。
- **Findings（namespace）**: i18next-cli 1.71 は、キーの namespace を「`t()` の `ns` の指定 > `ns:key` の前置き > 同じ関数のスコープの `useTranslation('…')` > `defaultNS`」の順で決める。`apps/app/i18next.config.ts` は `defaultNS` を持たないので、既定は `translation`。scratchpad で `extract` を試した結果、`useTranslation('admin')` を呼ぶ hook が返す関数（closure）の中の `t('…')` は `admin.json` に、`t: TFunction` を引数で受ける関数の中の `t('…')` は `translation.json` に振り分けられた。apps/app の client には、`t` を引数で渡す書き方の前例が無い。管理画面の部品（`useTranslation('admin')` を呼ぶもの 87 ファイル）は、どれも部品の中で `t('…')` を呼ぶ。
- **Implications**: キーは 5 言語に同時に足す。動的に組み立てたキー（`` t(`prefix.${value}`) ``）は、未使用として数えられるおそれがあるので、既知の値は `switch` の各 `case` に、文字列リテラルの `t()` を書く。例外は、Gen 1 が既に使っている `notification_settings.event_<値>`（既存のキーの再利用）。`t()` は、`useTranslation('admin')` を呼ぶ部品か文言の hook の中にだけ書く（下の決定）。実装のタスクで、`lint:i18n` を実際に回して確かめる。

### 画面幅の区切り

- **Findings**: 管理画面は、左のサイドバーの分だけ、内容の幅が狭い。Bootstrap 5 の `xl` は 1200px 以上。
- **Implications**: 2 列は `col-xl-6`（1200px 以上）にする。権限の行を含むカードが、半分の幅で崩れないことは、実装の最後に画面で確かめる（design の Manual / Smoke）。

### `useSiteUrl` と `useAppTitle`

- **Findings**: どちらも `~/states/global`。`siteUrl`・`appTitle` は、管理画面の共通の props（`getServerSideAdminCommonProps` → `getServerSideCommonInitialProps`）から atom に載る。管理画面の別の機能が `useSiteUrl` を使っている。
- **Implications**: 追加の取得は要らない。

### `chat-integration-agent` の残りのタスクとの干渉

- **Findings**: 残りは 6.3（実機の確認と能力表・導入ドキュメントの合わせ）と 7（書き戻し）。7.1 は、`chat-integration-app` の design.md の管理画面の項に、権限の行の 2 つの性質（コマンドの注意書きと DM の欄）と、DM だけを許す行が `allowedChannels: 'none'` で保存されることを書く。6.3 は、実機の確認の結果、能力表の値を合わせる可能性がある。
- **Implications**: 本 spec の書き戻しは、agent の 7 が済んでから行う。能力表の値が変わっても、本 spec の画面は、知らない値を生のまま出し、既知の値を言葉に置き換えるだけなので壊れない（言葉が未登録になるだけ）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 既存の構成を割る（採用） | 素の hook と SWR を保ち、肥大した 1 ファイルを責務ごとに割る。ロジックは純粋な関数へ | 差分が読める。この feature の決まりに合う | ファイルが増える | `coding-style.md` の純粋な関数の抽出に合う |
| Jotai / `~/stores/*` へ移す | 画面の状態を共有の store に置く | 画面をまたぐ共有 | この feature の決まりと合わない。共有する状態が無い | 不採用 |
| タグ入力（typeahead） | チャンネル名を打ちながら候補から選ぶ | 入力が速い | 非公開・同名・大量の候補の扱いが難しい。チームが採らないと決めた | 不採用 |
| ドロップダウン | 一覧から 1 件ずつ選ぶ | 実装が小さい | 複数選択に向かない。チームが採らないと決めた | 不採用 |
| チェックのモーダル（採用） | 一覧から絞り込んでチェックする | 複数選択と絞り込みができ、サービスに依存しない | モーダルの部品が要る | 汎用の部品として切り出す |

## Design Decisions

### Decision: 1 つのカードに 1 つの折りたたみ。初回に開くまで描かない。開いたあとは描いたままにする

- **Context**: 要件 16.2 は、チャンネル権限・通知先・切断を、開くまで閉じた状態にする。
- **Alternatives Considered**:
  1. セクションごとに 3 つの折りたたみ
  2. カードごとに 1 つ。閉じるたびに中身を捨てる
  3. カードごとに 1 つ。初回に開くまで描かず、そのあとは描いたままにする
- **Selected Approach**: 3。
- **Rationale**: 3 つの操作は、どれも「この接続の設定」で、一緒に開く方が見通せる。閉じるたびに捨てると、編集中の権限を失う。初回まで描かなければ、開かれないカードの proxy への問い合わせが無くなる。
- **Trade-offs**: 編集中に閉じても、「保存していない変更があります」はカードの内側にしか出ない。
- **Follow-up**: 閉じた状態でも未保存を知らせたくなったら、フォームの状態をカードへ持ち上げる。

### Decision: 文言は、`useTranslation('admin')` を呼ぶ hook で引く。`t` を引数で渡す純粋な関数にしない

- **Context**: 状態・機能表・ペアリングの失敗・保存の結果・チャンネルの表示は、値を文言に変える対応を持つ。複数の部品が同じ対応を使う。
- **Alternatives Considered**:
  1. `t: TFunction` を引数に取る純粋な関数（`describeX(t, value)`）
  2. 同じ関数で、引数の型を `TFunction<'admin'>` にする（i18next-cli はこの型を読み、`admin` に振り分ける）
  3. 中で `useTranslation('admin')` を呼び、文を返す関数を返す hook（`useXLabels()`）
- **Selected Approach**: 3。
- **Rationale**: 1 は、`lint:i18n` がキーを `translation` として数え、基準値が上がる（上の「i18n の検査」）。2 は動くが、apps/app で前例のない書き方になる。3 は、ほかの管理画面と同じく「`useTranslation('admin')` を呼ぶ場所で `t()` を書く」形に収まる。文言を引く対応は `switch` で `t()` を選ぶだけなので、純粋な関数に出してもテストのしやすさはほとんど変わらない。hook は `renderHook` と、キーをそのまま返す `t` の差し替えで試せる。
- **Trade-offs**: 文言の対応は React の外から呼べない。今、React の外で使う予定は無い。
- **Follow-up**: 既定値の分類・フォームの変換・行の組み立て・並び順のように、文言を引かない処理は、純粋な関数のまま置く。

### Decision: チャンネルの一覧の口を、通知先の口とは別に足す

- **Context**: 権限の画面にチャンネルの一覧が要る。通知先の口は一覧を含むが、宛先と重複の警告も計算する。
- **Alternatives Considered**:
  1. 通知先の口の `channels` を流用する
  2. 一覧だけを返す口を足す
- **Selected Approach**: 2。届かないときは `200` と `unavailable`（通知先と同じ）。
- **Rationale**: 権限の画面を、通知先の取得と、重複の計算に結び付けない。
- **Trade-offs**: カードを開くと、一覧の問い合わせが 2 回走る。通知先の側は範囲外なので、そのまま。
- **Follow-up**: proxy の取得が遅いと分かったら、取得を 1 つにまとめる。

### Decision: 通知先の削除は query で識別し、見つからなければ 404

- **Context**: 識別は `(relationId, channelId, pathPattern)`。`pathPattern` は `/` を含む。
- **Alternatives Considered**: パスに入れる／本文に入れる（`DELETE` の本文は扱いが不安定）／query に入れる。
- **Selected Approach**: query。`apiv3Delete(path, params)` が query にする。見つからなければ `404`（`destination-not-found`）。クライアントは `404` も「すでに無い」として読み直す。
- **Rationale**: 既存の管理画面の API の流儀（期待される結果は値、誤りは `ErrorV3`）に合う。

### Decision: 「指定したチャンネルのみ」で 0 件の検査は画面だけで行う

- **Context**: 要件 11.20。
- **Selected Approach**: 画面（`permission-form`）で検査し、サーバーの `saveRelationSettings` は変えない。
- **Rationale**: 保存の形と、proxy との契約（空の一覧は、有効な値）を変えない。保存済みの行に空の一覧があっても、サーバーは読める。
- **Trade-offs**: 保存済みの空の一覧を持つ接続では、ほかのコマンドの変更を保存するときも、その行を直すまで保存できない。
- **Follow-up**: 実際に空の行が見つかるなら、読み込み時に「指定したチャンネルのみ（0 件）」を警告つきで示すことを検討する。

### Decision: DM だけを許す行は、既定の挙動に等しい `allowedChannels` で書く

- **Context**: `chat-integration-agent` は、`separate-flag` のコマンドの DM の許可を、行の中に置く。要件 11.13 は、「既定値」では行を保存しないとする。
- **要件との関係**: design レビューで、この例外が承認済みの 11.13 に書かれていないことが分かった。代わりに「『既定値』のあいだは DM の欄を無効にする」（例外そのものを無くす）も検討したが、DM の欄は `chat-integration-agent` の範囲で、この spec が振る舞いを変えるべきでないため採らず、11.13 にただし書きを足した。
- **Selected Approach**: `default` のコマンドで DM を許したときだけ、行を書く。`allowedChannels` は、そのコマンドの既定の挙動（`deny` → `'none'`、`allow` → `'all'`）。
- **Rationale**: 今の実装は `'none'` を固定で書く。`agent`（書き込み系）では同じ結果。読み取り系に `separate-flag` が足されても、チャンネルでの挙動が変わらない。
- **Follow-up**: 書き戻しで、agent の 7.1 が書く「DM だけを許す行は `'none'`」の記述に、この一般化を合わせる。

### Decision: 変更の検出は、保存の形に正規化した結果どうしで比べる

- **Context**: 要件 16.4・16.5。フォームは、選択肢が `listed` でない間も `channelIds` を保つ（戻したときに失わないため）。
- **Alternatives Considered**:
  1. フォームの欄ごとに比べ、「`listed` 以外では `channelIds` を比べない」などの例外を足す
  2. 両側を `normalizeForm`（検査をしない、保存の形への変換）に通して比べる
- **Selected Approach**: 2。`toChannelPermissions` は「検査 ＋ `normalizeForm`」にする。
- **Rationale**: 「変更あり」を「保存すると送る内容が違う」と同じ意味にでき、判定の基準が 1 つで済む。1 は、保存の形に出ない欄（`separate-flag` でないコマンドの DM の値など）や、今後増える欄のたびに例外を足すことになる。`toChannelPermissions` をそのまま使わないのは、`listed` で 0 件のときに比べる値が無くなるため。
- **Trade-offs**: 変換の関数が 1 つ増える。

### Decision: 一覧が取れないあいだも、「指定したチャンネルのみ」は選べるままにする

- **Context**: 要件 11.17。当初の要件は、「指定したチャンネルのみ」への変更を受け付けないとしていた。
- **Alternatives Considered**:
  1. `<select>` の `listed` の項目を無効にする（保存済みが `listed` の行だけは選べるままにする）
  2. 項目は選べるままにし、「チャンネルを選ぶ」だけを無効にして、行の中に理由を示す
- **Selected Approach**: 2。design レビューで 11.17 を書き換えた。
- **Rationale**: 無効の `<option>` には、なぜ選べないかを示せない（ツールチップもほぼ出ない）。2 でも、新しく `listed` にした行は 0 件のままで、11.20 の検査で保存が止まるので、誤った設定は保存されない。保存済みの `listed` の行は、別の選択から戻せる。1 にあった「保存済みの選択で項目の有効・無効を変える」分岐も要らない。
- **Trade-offs**: 保存を押すまで、新しい `listed` の行が保存できないことは、行の中の案内でしか分からない。保存時のエラーの文は、一覧が取れないときは「選べない」理由を示す（「選んでください」と言わない）。

### Decision: ラベルは `switch` の文字列リテラルの `t()`。知らない値は生のまま

- **Context**: 要件 1.24・9.29 は、知らない値を欠落させず、そのまま示す。i18n の検査は、動的なキーを未使用と数えるおそれがある。
- **Selected Approach**: 既知の値ごとに `case` を書き、`default` は値を返す。`t` を引数に取る純粋な関数にし、テストでは偽の `t` を渡す。
- **Trade-offs**: `case` の数だけ書く（機能の名前が 15、程度が 4）。proxy が値を足すたびに `case` を足す。足さなくても壊れない。

### Decision: `already-paired` の `unregister` の手順は、常に出す

- **Context**: 要件 9.21 は、一覧に有効な接続が無い場合の手順を求める。
- **Alternatives Considered**:
  1. 一覧に有効な接続が無いときだけ出す（一覧の `state === 'active'` の有無から出し分ける）
  2. 常に出す。文の中で「一覧に有効な接続が無い場合は」と条件を述べる
- **Selected Approach**: 2。
- **Rationale**: proxy の `already-paired` の `detail` は、GROWI の表示名しか含まず、どのワークスペースかを特定できない（`relation/pairing-service.ts`）。1 は、別のワークスペースの有効な接続が 1 つでもあると、GROWI 側だけで切断したワークスペースの再接続で、手順が出なくなる。2 は、どの場合も要件を満たし、出し分けのための引数と配線を持たない。
- **Trade-offs**: 有効な接続があるのに、`unregister` の文が出る場合がある。文が自分で条件を述べるので、誤解は小さい。

### Decision: 接続が切れているカードの説明の文を、折りたたみに合わせて直す

- **Context**: 既存の `chat_integration.connection_lost.detail` は「下の「Disconnect」を押す」と案内する。切断の操作は、折りたたみの中に入る（要件 16.2）。
- **Alternatives Considered**: 接続が切れたら、折りたたみを自動で開く／文を直す。
- **Selected Approach**: 5 言語の文を直し、「この接続の設定を開き、「切断」を押す」と案内する。
- **Rationale**: 開閉の状態を、接続の状態の取得（非同期）の結果に結び付けない方が、状態が少ない。

### Decision: 通知先の追加フォームには、変更の検出と未保存の表示を設けない

- **Context**: 要件 16.4・16.5 の「編集中の設定」。
- **Selected Approach**: 保存済みの全体を編集するのは、権限のフォームだけ。通知先は「1 行を足す／消す」なので、追加ボタンを、足すものが揃うまで押せなくする（チャンネルの選択と、配信イベント 1 つ以上）。
- **Rationale**: 追加フォームには、比べる「保存済みの内容」が無い。

## Synthesis

- **Generalization**: チャンネルを選ぶ部品は、権限という用途とサービスに依存しない平らなデータの部品にした。通知先の追加の側は今の `<select>` のままだが、チャンネルの表示（`describeChannel`）は、同じ関数に揃える。「既知の値は言葉に、知らない値は生のまま」の型は、機能表・状態・サービス名で同じにした。
- **Build vs. Adopt**: 折りたたみとモーダルは、reactstrap の既存の部品を使う。チャンネルの選択は、`react-bootstrap-typeahead`（既に依存にある）を検討したが、チームが採らないと決めた。新しい依存は足さない。
- **Simplification**: 画面の状態を、共有の store に置かない。変更の検出は、保存済みから作ったフォームとの比較だけ。通知先の削除に確認を設けない。outbox の書き換えを足さない。

## Risks & Mitigations

- **書き戻しの衝突**（agent の 7.1 と同じ節を書き換える）— 書き戻しの順番を守る。tasks.md の最終タスクに、先に agent の 7 が済んでいることの確認を置く。
- **i18n の基準値**（未使用・未訳の数が増える）— キーは 5 言語に同時に足し、文字列リテラルの `t()` で書く。実装の途中と最後に `lint:i18n` を回す。
- **zh_CN・fr_FR・ko_KR の訳の質** — en・ja を正とし、ほかの 3 言語は初稿として足す。母語の確認が望ましい。
- **2 列のカードで権限の行が崩れる** — 権限の行は、半分の幅でも読める縦積みにする。実装の最後に画面で確かめる。
- **カードを開くと、チャンネルの一覧の問い合わせが 2 回走る** — 通知先の側が範囲外のため、そのまま。遅いと分かったら、1 つにまとめる。
- **保存済みの空の一覧が、ほかの変更の保存を止める** — 上の決定のフォローアップを参照。
- **既存の `AdminChatIntegration.spec.tsx`（1,092 行）の作り直し** — 部品の分割と同じタスクで、部品ごとの spec に割る。`data-testid` は維持する。

## References

- [chat-integration-app の design.md](../chat-integration-app/design.md) — 「管理画面の関係の状態」「触れない部品」
- [chat-integration の requirements.md](../chat-integration/requirements.md) — 要件 1・2・9・11
- [chat-integration-agent の tasks.md](../chat-integration-agent/tasks.md) — タスク 6.3・7
- [spec-lifecycle.md](../../../.claude/rules/spec-lifecycle.md) — amend spec の扱い
