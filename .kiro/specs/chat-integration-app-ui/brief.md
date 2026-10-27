# Brief: chat-integration-app-ui

`chat-integration-app` が作った 3 つの画面の見え方と使い勝手を直す amend spec。
動作そのものは正しい（実機試験 2026-10-23・10-26、Slack）。直すのは次の 3 点だけである。

1. ページの編集画面の「Chat notification channels」（保存時の通知先の選択）が縦に長く、編集画面の配置を崩す
2. チャット側で `@GROWI unregister` を実行したあとも、管理画面のバッジが緑の「active」のまま残る
3. アカウントの紐付けの承認画面（`/me/chat-integration/account-link/:token`）が素っ気なく、何を承認するのか分かりにくい

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella）の `requirements.md` | 要件 2・7・9 に受け入れ条件を**末尾へ足す**（既存の番号は振り直さない）。2.12〜2.14（保存時の通知先の選択部品）、7.9〜7.12（承認画面）、9.9〜9.12（接続が切れた関係の表示）。次の番号は、並行する amend spec が予約している分を避けた: 要件 2 は `chat-integration-notification-load` が 2.7〜2.11、要件 9 は同 spec が 9.8、要件 15 は `chat-integration-agent` が予約している。書き戻しの順が入れ替わっても番号が重ならない |
| `chat-integration` の `roadmap.md` | 「リリース前に直すもの」の表の順 4 の行と、節「4. app の見え方」を、書き戻したあとに消す |
| `chat-integration-app` の `design.md` | ① ChatAccountLink の「承認画面」の行（今は「表示名を `chat_relations` から引いて添える」と書くが、`chat_relations` に表示名は無く、実装は表示名を出していない。注文に表示名を保存する形に直す）。② `chat_account_link_orders` の項目（`accountDisplayName` を足す）。③ Modified Files / 新規ファイルのうち承認画面の置き場所（`pages/me/chat-integration/account-link/[token].page.tsx`）。④ 保存時の通知先の選択部品の記述（複数選択の `<select>` ではなくドロップダウン）。⑤ ProxyClient の失敗の種類に「proxy が署名を受け付けなかった」を足す。⑥ 管理画面の関係の状態の出し方 |
| `chat-integration-app` の `research.md` | この spec の `research.md` の決定を書き戻す |

- **Revalidation Triggers への影響: 既存の項目には触れない。** `@growi/chat` の契約は変えない（`account-link-start` の `actor.displayName` は今も送られている。足すのは GROWI 側の保存だけ）。proxy も変えない。
- **足す Revalidation Trigger が 1 つある**（書き戻しのとき `chat-integration-app` の design.md に足す）: proxy の署名の検査が、拒否したときに 401 以外を返すようになったら、「接続が切れている」の判定（`ProxyCallFailure` の `rejected`）を見直す。proxy 側の `signature-guard.ts` が根拠である。
- **触れない範囲**: 管理画面の「できること」の表と、チャンネルの権限・通知の宛先の節。`chat-integration-agent` がコマンドを変えたあとに別の spec（roadmap の順 8）で作り直す。この spec はそれらの部品の構造に手を入れない。

## Problem

- **編集画面**: 保存時の通知先は、複数選択できる `<select multiple>` で出している。ブラウザは選択肢の数だけ縦に伸ばすので、チャンネルが多いと、1 行で並ぶはずの保存の操作欄（公開範囲の選択・Slack 通知・保存ボタン）の配置が崩れる。
- **管理画面**: `@GROWI unregister` は proxy 側の関係と鍵だけを消し、GROWI には知らせない。GROWI から接続の状態を問い合わせると、proxy は署名を受け付けず（空の 401）、画面は赤字で読めないことを示す。ところが右上のバッジは GROWI 側の関係の記録（`state`）をそのまま出すので、緑の「active」のまま残る。画面が「使える」と「使えない」を同時に言っている。
- **承認画面**: 文言は英語の直書きで、見た目は素の HTML である。サイドバー付きの `BasicLayout` で出る。承認する人が「どの GROWI の」「どのログイン中ユーザーとして」「どのチャットのどのアカウントを」結び付けるのかを読み取りにくく、取り違えたまま承認しても気付けない。設計（`chat-integration-app` の design.md）は表示名を出すつもりだったが、注文に表示名を保存していないので出せていない。

## Current State

- `client/notification/ChatIntegrationDestinationSelect.tsx`: `<select multiple>`。`SavePageControls.tsx` が横並びの欄と、狭い画面用のモーダルの 2 か所に置く。選んだ結果は `{ relationId, platform, channelId }` の配列で返す（名前は返さない）。チャンネルが 1 つも無ければ何も描かない。
- `client/admin/AdminChatIntegration.tsx`: 関係ごとの行 `RelationRow`。バッジは `relation.state`。接続の状態は `GET /relations/:id/connection-status` で 15 秒ごとに読む。失敗すると「Failed to load connection status」だけを出す。
- `server/proxy-client.ts`: 署名付きの呼び出しは、2xx 以外をすべて `http-error` にまとめる。proxy の署名の検査は、拒否の理由を問わず空の 401 を返す（`signature-guard.ts`）。
- `client/components/AccountLinkApproval.tsx`: 経路は `pages/me/[[...path]].page.tsx` の `chat-integration` の項目（`BasicLayout`）。出せる情報は `platform`・`accountId`・`workspaceName`・`relationLabel`・`growiUsername`。サーバは `expiresAt` も返すが、画面は使っていない。
- `chat_account_link_orders` に、チャットアカウントの表示名は無い。ただし注文を作る 2 か所（`peer-router.ts` の `account-link-start`、`command-endpoint.ts`）は、どちらも `actor.displayName` を持っている。

## Desired Outcome

- 編集画面の通知先の選択は、選択肢が何件あっても保存の操作欄の高さと配置を変えない。1 つのボタン（選択件数を表示）を押すと、チェックボックスの一覧が開く。
- 管理画面は、proxy が署名を受け付けなくなった関係に、赤い「接続が切れています」を出し、緑の「active」を出さない。理由は断定せず（チャット側で解除された可能性が高い、と案内する）、GROWI 側の「解除」で片付けられると示す。
- 承認画面は、サイドバーの無い承認専用の画面で、「この GROWI」「あなた（ログイン中の GROWI ユーザー）」「紐付けるチャットのアカウント（サービス・workspace・表示名と識別子）」を分けて並べる。承認前に有効期限を示す。
- 新しく画面に出す文言は 5 言語（en_US・ja_JP・zh_CN・fr_FR・ko_KR）で用意する。

## Approach

決定の理由と、採らなかった案は [research.md](./research.md)。

1. **選択部品**: `GrantSelector` と同じ形（トグルのボタン + メニュー）で作り直す。メニューの中は workspace ごとに見出しを付けたチェックボックス。メニューは高さに上限を付けてスクロールする。
2. **接続が切れた状態**: 新しい信号は作らない。GROWI が proxy へ出す署名付きの呼び出しが 401 で断られたとき、それを `ProxyCallFailure` の新しい種類 `rejected` に分ける。管理画面は、接続の状態の呼び出しが `rejected` だった関係に「接続が切れています」を出す。401 は時計のずれや鍵の不一致でも起きるので、文言は「可能性がある」と書く。自動で解除はしない。
3. **表示名**: 注文を作るとき `actor.displayName` を保存する（任意の項目。無い注文は識別子だけを出す）。表示名は本人が自由に決められるので、識別子と workspace を必ず併記し、表示名だけで承認を判断させない。
4. **承認画面の経路**: `pages/me/chat-integration/account-link/[token].page.tsx` を専用のページとして足し、`RawLayout` で出す。`me/[[...path]].page.tsx` の `chat-integration` の項目は消す。URL は変えない。
5. **文言**: 手を入れる 3 画面の文言は `t()` に直し、5 言語の翻訳をこの spec の中で用意する。`lint:i18n` の基準値は引き上げない。

## Scope

- **In**: 上の 3 画面。注文の保存項目の追加。`proxy-client.ts` の失敗の種類の追加。手を入れた文言の 5 言語化。
- **Out**:
  - 管理画面の「できること」の表と、チャンネルの権限・通知の宛先の節（順 8）。これらの文言も英語の直書きのまま残す
  - 紐付けの解除済みの関係を GROWI に知らせる仕組み（proxy → GROWI の新しい通知）。proxy と `@growi/chat` の契約を変えるので別の話
  - 承認画面の「別の GROWI ユーザーでやり直す」導線、「承認しない」の取り消し口
  - 個人設定の紐付けの一覧（`MyChatAccountLinks`）の見た目
  - Gen 1 の `SlackNotification`

## Boundary Candidates

- **app（server）**: 注文の保存項目、承認画面へ返す表示データ、`proxy-client.ts`
- **app（client）**: 選択部品、管理画面の関係の行のうちバッジと接続の行、承認画面
- **app（pages / 既存ファイル）**: `pages/me/` の新しいページと、`SavePageControls.tsx` への小さな変更（部品に渡す向きの指定）
- **locale**: 5 言語の翻訳ファイル

## Upstream / Downstream

- **Upstream**: なし（`chat-integration-app` は実装済み）
- **Downstream**:
  - `chat-integration-agent`（順 7）は、`chat-integration-app` の design.md の「権限」「能力表」の節を書き換える。この spec が触るのは別の節（承認画面・保存時の選択・関係の状態）なので、同時に進めてよい。ただし両方が `design.md` へ書き戻すので、書き戻しは 1 本ずつ行う
  - 管理画面の作り直し（順 8）は、この spec が足す「接続が切れています」の表示を引き継ぐ。関係の行の構造を変えるときは、この表示を残すこと
