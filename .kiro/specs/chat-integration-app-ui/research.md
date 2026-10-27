# Research & Design Decisions

> 書き戻しの最後のタスク（tasks.md 6.2）で、決定 1〜6 を `chat-integration-app` の `research.md` へ移してから、この spec を削除する。

## 調べたこと（2026-10-27）

| 確かめたこと | 結果 | 出どころ |
|---|---|---|
| `@GROWI unregister` が GROWI に知らせるか | 知らせない。proxy が関係と鍵を消すだけ | `chat-integration-proxy/src/orchestration/admin-flow.ts` の `unregister`（`pairing.unpair`）、roadmap 順 4 |
| 鍵が消えたあと、GROWI の署名付きの呼び出しはどうなるか | `signature-guard.ts` が拒否し、**空の 401** を返す。理由は返さない（呼び出す側が関係の有無を探れないようにするため） | `chat-integration-proxy/src/routes/signature-guard.ts` 冒頭のコメントと `refuse` |
| GROWI はその 401 をどう扱うか | `proxy-client.ts` の `sendSigned` が、2xx 以外をすべて `http-error` にする。管理画面は `ErrorV3`（502、code `http-error`）で受け、「Failed to load connection status」を赤字で出す | `proxy-client.ts`、`admin-router.ts` の `connectionStatusHandler` |
| バッジの出どころ | `relation.state`（GROWI 側の記録）をそのまま出す。`@GROWI unregister` では変わらない | `AdminChatIntegration.tsx` の `RelationRow` |
| GROWI 側の「解除」は proxy を呼ぶか | 呼ばない。`unpairRelation` は GROWI 側の関係・鍵・権限・宛先だけを消す | `pairing/pairing-service.ts` の `unpairRelation` |
| 注文を作る 2 か所は表示名を持っているか | 持っている。どちらも `ChatAccountRef`（`displayName` は必須）を `findOrCreatePendingAccountLinkOrder` に渡している | `peer/peer-router.ts:182`、`command/command-endpoint.ts:219`、`@growi/chat` の `contract/common.ts` |
| 設計は表示名を出すつもりだったか | そのつもりだった（「`workspaceName` と `platform` と表示名を `chat_relations` から引いて添える」）。だが `chat_relations` に表示名は無く、実装は出していない | `chat-integration-app/design.md`「ChatAccountLink」の承認画面の行 |
| 管理画面が読み込む namespace | `admin` だけ（`['admin']`）。`/me/*` は `translation` と `admin` | `pages/admin/_shared/get-server-side-common-props.ts`、`pages/me/[[...path]].page.tsx` |
| i18n の規則 | 新しいキーは 5 言語をその spec の中で訳す。`baseline.json` を引き上げない。`lint:i18n` は `t()` のキーを見るもので、直書きの英語は見ない | 開発者の方針（2026-09-29）、`apps/app/tools/i18n-audit/` |
| 保存時の選択部品の既存テスト | `listbox`・`selectOptions` に依存する。契約として固定されているのは「自由入力が無い」「`relationId`・`platform`・`channelId` だけを出す」「同じ `channelId` の 2 つの workspace を取り違えない」「紐づく workspace が無ければ何も描かない」 | `ChatIntegrationDestinationSelect.spec.tsx`、`SavePageControls.spec.tsx` |

## Design Decisions

### 決定 1: 保存時の通知先の選択は、トグルのボタン + チェックボックスのメニューにする
- **Context**: `<select multiple>` が選択肢の数だけ縦に伸び、`flex-nowrap` の保存の操作欄を押し広げる（要件 2.12）
- **Alternatives Considered**:
  1. `<select multiple size={1}>` や固定の高さ + スクロール: ブラウザごとに見え方が違う。複数選択に Ctrl/Cmd を押しながら選ぶ操作が要り、知らない人は 1 つしか選べない
  2. 検索つきのコンボボックス（入力欄を持つ）: チャンネルが非常に多い GROWI には便利だが、入力欄が付くと、既存の契約「自由入力が無い」（要件 2.2 の、名前でなく識別子で選ぶ）を、テストと設計の両方で見直す必要がある。今回の問題（高さ）を直すのに要らない
  3. `GrantSelector` と同じ、トグル + メニュー（採用）
- **Selected Approach**: 設計の 1 を参照
- **Rationale**: 同じ操作欄の隣の部品（公開範囲の選択）と同じ操作になる。ボタンは 1 行で、選択数に関わらず高さが変わらない
- **Trade-offs**: 取得できなかった workspace の警告は、今は選択肢の下に常に出ているが、メニューへ移すと開くまで見えない。そのため、ボタンに警告の印を付ける。検索は付けないので、チャンネルが数百件になる GROWI では、メニュー内のスクロールだけになる
- **Follow-up**: メニューが `container="body"` のとき、reactstrap 9.2.2 がメニュー内のクリックでメニューを閉じないかは、**未確認**（tasks 3.2 で確かめる。閉じる場合は、メニューの `onClick` で伝播を止める）

### 決定 2: 「接続が切れた」の信号は、新しい通信を足さず、今ある 401 を使う
- **Context**: `unregister` は GROWI に知らせない。バッジの緑を正すには、GROWI が「切れた」と知る必要がある
- **Alternatives Considered**:
  1. proxy が `unregister` のとき GROWI へ「解除した」と通知する: 閉域・接続方向の設計（proxy → GROWI の口は通知とペアリングだけ）に新しい種類の通信を足し、`@growi/chat` の契約と proxy を変える。3 つの sub-spec の再検証が要り、この spec の範囲（見え方）を超える。GROWI が落ちているときの送り直しの設計も要る
  2. GROWI が定期的に proxy へ問い合わせて、拒否されたら `state` を `unpaired` に書き換える: 一時的な拒否（時計のずれ、鍵の入れ替えの途中）で関係を壊す。GROWI 側の関係には再ペアリングの引き継ぎ（`inherit-account-links`）が絡むので、自動で状態を変えるのは危険
  3. 管理画面が既に読んでいる接続の状態の呼び出しの失敗を、種類を分けて表示するだけにする（採用）
- **Rationale**: 見た目の誤りを正すには足りる。状態は書き換えない（要件 9.12）ので、誤判定しても管理者の「Disconnect」の判断に任せられ、壊れない
- **Trade-offs**: 管理画面を開いている間（15 秒ごとの読み取り）と、開いたときにしか分からない。通知の送信失敗は、今までどおり通知の記録に残る
- **Follow-up**: GROWI に「解除された」と届ける仕組みが要るなら、別の spec（proxy と protocol を含む）で扱う

### 決定 3: `ProxyCallFailure` に `rejected`（401）を 1 種類だけ足す
- **Context**: `proxy-client.ts` は、失敗の種類を粗くしている（「それ以上細かくすると、proxy から見たネットワークの事情を呼び出し側へ流してしまう」）。401 を分けるのは、この方針に反しないか
- **Alternatives Considered**:
  1. 分けず、接続の状態の失敗はすべて「接続を確認できません」と出す（proxy-client を変えない）: 実装は最小。だが、「切れている」と「一時的に届かない」が同じ表示になり、管理者が取る行動（片付ける／待つ）が変わらないまま。今回直したい誤り（緑のまま）は、「確認できません」の表示でも直るが、`unregister` の結果として最も起きる状態を、他の失敗と区別できない
  2. 分ける（採用）
- **Rationale**: 401 は、この GROWI の署名を proxy が受け付けなかったという、**呼び出した GROWI 自身の事柄**で、proxy の内側（ほかの GROWI の有無やネットワークの形）を表さない。方針が避けたいのは後者である。proxy は拒否の理由（鍵が無い・署名が合わない・期限切れ）を返さないので、理由の細分化にはならない
- **Trade-offs**: 401 は、unregister のほか、時計が 300 秒以上ずれたとき、鍵の入れ替えの途中、鍵の不一致でも起きる。**「切れた」と断定できない**ので、文言は「可能性がある」とし、状態は自動では書き換えない（要件 9.10・9.12）。また、GROWI の前に認証つきのリバースプロキシがあると、それが返した 401 も `rejected` になる（紛らわしいが、「接続が使えない」ことは確かなので害は小さい）
- **Follow-up**: proxy が拒否のとき 401 以外を返すようになったら、この判定を見直す（Revalidation Trigger として design.md に足す）

### 決定 4: 承認画面は専用ページ + `RawLayout` にする
- **Context**: 今は `me/[[...path]].page.tsx`（`BasicLayout` = サイドバー付き）の 1 項目。サイドバーを外したい
- **Alternatives Considered**:
  1. `[[...path]]` の `getLayout` で、パスを見てレイアウトを切り替える: 変更は小さいが、1 つのページが 2 つのレイアウトを持ち、`getServerSideProps`（サイドバー用の設定の取得）も承認画面には不要なまま走る
  2. 専用ページ `me/chat-integration/account-link/[token].page.tsx`（採用）。Next.js は固定の経路を `[[...path]]` より優先する。`/me/*` の Express のログイン必須（`routes/index.js:359-360`）は変わらない
  3. `NoLoginLayout`（ログイン前の画面用）を使う: ロゴと GROWI の名前の見出しが付く利点はあるが、「ログインしていない人向け」の見た目で、承認する人がログイン済みであることと、カードの内容（3 つの塊）と二重に GROWI の名前を出す。`RawLayout` + 自前のカードのほうが、承認の画面に必要なものだけを置ける
- **Rationale**: 1 ページ 1 レイアウトで、不要な取得も無い。URL は変わらない（チャットに送られた古いリンクも動く）
- **Trade-offs**: `pages/` に新しいファイルが増える。Express が横取りする経路の一覧（`is-next-page-route.ts`）との食い違いを、tasks 2.4 で確かめる
- **Follow-up**: なし

### 決定 5: 表示名は注文を作るときに保存する（任意の項目）
- **Context**: 承認画面に出せる情報は、`platform`・`accountId`（Slack なら `U…`）・`workspaceName` で、表示名が無い。`U0123ABCD` だけでは、誰のアカウントか分からない
- **Alternatives Considered**:
  1. 保存せず、識別子だけを出す: 実装は不要。だが誤った承認を防ぐ効果が弱い
  2. 承認画面を開くとき、proxy に表示名を問い合わせる: protocol に新しい口が要る。proxy は「チャットのアカウントと GROWI ユーザーの対応表を持たない」（要件 7.8）ので、個々のアカウントの情報の問い合わせは筋が悪い
  3. 注文を作るとき `actor.displayName` を保存する（採用）
- **Rationale**: 注文を作る 2 か所が `actor.displayName` を既に持っているので、足りないのは保存だけ。protocol も proxy も変わらない。注文の寿命は 10 分（TTL 索引）なので、個人情報が長く残らず、足す前に作られた注文は `null` のまま動く
- **Trade-offs**: 表示名は本人が自由に決められる（他人の名前を名乗れる）ので、**識別の根拠にしない**。表示名を出すときも `accountId` と workspace を併記する。使い回す注文は表示名を書き換えない（同じチャットアカウントの注文で、判断への影響が無いため）
- **Follow-up**: なし

### 決定 6: 触れる画面の文言は、`t()` にして 5 言語の訳をこの spec の中で用意する
- **Context**: `chat-integration` の画面は英語の直書きで、roadmap に「i18n は未対応」とある。一方、開発者の方針（2026-09-29）は「新しいキーは 5 言語をその spec の中で訳す。基準値を引き上げない」。`lint:i18n` が見るのは `t()` のキーで、直書きの英語は見ない
- **Alternatives Considered**:
  1. 触れる文言も直書きの英語のままにする: 規則には反しない（キーを足さない）。だが承認画面は一般の利用者が見る画面で、日本語の GROWI で英語の確認画面を出すのは、承認の取り違えを防ぐ目的に反する
  2. 英語のキーだけ足し、訳は後続に回す: 方針で却下済み（基準値を緩めることになる）
  3. 手を入れる文言だけ `t()` にして、5 言語を揃える（採用）
- **Selected Approach**: 範囲は「この spec が足す・書き換える文言」だけ。承認画面全体と、保存時の選択部品の文言（`translation.json`）、管理画面の「接続が切れています」の 2 文（`admin.json`）。管理画面のほかの文言（表・権限・宛先・解除・ペアリング）は、順 8 の作り直しのときに扱う
- **Rationale**: 管理画面を丸ごと `t()` にすると、順 8 が作り直す部品の文言を先に固定してしまい、順 8 で二重に作業する。逆に承認画面と選択部品は、この spec が全体を作り直す・触るので、ここで揃えるのが自然
- **Trade-offs**: 管理画面の 1 行だけが翻訳され、周りが英語のままという、不揃いな期間ができる
- **Follow-up**: 順 8 の spec で、管理画面の残りを `admin` namespace に直す。このとき `admin.json` の `chat_integration.*` の名前の付け方（この spec の `chat_integration.connection_lost.*`）を引き継ぐ

## 未確認・リスク

- reactstrap 9.2.2 の `Dropdown` で、`container="body"` のメニュー内のチェックボックスをクリックしてもメニューが閉じないか（決定 1。tasks 3.2 の完了条件に入れてある）
- 認証つきのリバースプロキシが 401 を返す構成で、`rejected` が誤って出る可能性（決定 3。害は小さいと判断）
- 動作確認（tasks 5.2）の「proxy 側の鍵を消す」を、開発の環境だけで再現できるか。proxy とチャット環境が要る。できなければ、できなかったと報告に書く
- Slack 以外のサービス（Discord・Teams・Mattermost）で、`actor.displayName` に何が入るかは、proxy の `platform/event-mapping.ts:107` が `author.fullName`（空なら `author.userName`）を入れることまでは確かめた。サービスごとの実際の値は確かめていない。画面は表示名を「補助の情報」として出すだけなので、どの値が入っても動くが、承認画面での見え方は実機で確かめていない
- 順 7（`chat-integration-agent`）が `chat-integration-app` の design.md の別の節へ書き戻すときとの順番（tasks 第 6 章の注意）
