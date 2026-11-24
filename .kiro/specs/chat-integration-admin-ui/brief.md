# Brief: chat-integration-admin-ui

管理画面（`/admin/chat-integration`）を作り直す amend spec（[roadmap.md](../chat-integration/roadmap.md) の順 8）。
接続の追加から、権限と通知先の設定、切断と再接続までを、管理者が画面の案内だけで進められるようにする。
protocol と proxy の契約は変えない。app の管理画面と、その API だけを変える。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration-app` | design.md の「触れない部品」（`CapabilityReportTable`・`ChannelPermissionsSection`・`NotificationDestinationsSection`・`UnpairButton`）の取り決めを解く。管理画面の文言を英語の直書きとする取り決めを、i18n 対応に改める。管理画面の節（要件 1.3・11・12.4・12.5・9.10〜9.13 を受け持つ `client/admin/`）と、管理画面の API（チャンネル一覧、通知先の削除）を書き換える |
| `chat-integration`（umbrella） | 次の要件が、振る舞いとして変わるか、足りない。**要件フェーズで確定する**: 要件 9（ペアリングの入力、失敗の知らせ、切断 9.7、切断後の案内）、要件 11（チャンネル単位の権限。既定値の見せ方、チャンネルの選び方）、要件 2.2（通知先。削除、配信イベントの検査）、要件 1.3・1.4（機能表と接続状態の表示）。新しい要件は**末尾に足し、既存の番号は振り直さない** |
| roadmap.md | 順 8 の対象は今「チャンネルの権限と『できること』の表」だけ。この spec の範囲（上の表と Scope）に広げる。完了時にこの行を消す |

- Revalidation Triggers への影響: なし。protocol と proxy の契約は変えない（管理画面の API は app の中で完結する）。
- 前提: roadmap は「`agent`（順 7）が権限と能力表に行を足した後に作り直す」としている。`chat-integration-agent` の task 5.8（`agent` の行、DM の欄）と 6.1（`keep` の除去）は完了済みで、この前提は満たされている。agent の残りのタスクが管理画面に触れるかは、未確認。

## Problem

- 管理画面は動くが、初めての管理者が迷わず設定を終えられない（下の Current State）。
- チャンネル権限は、設定を誤ると、書き込み系コマンドがどのチャンネルで通るかに直結する。誤りやすい入力のままにしておけない。

## Current State

- **接続の追加**（`PairingForm`）: 4 項目すべてが必須の手入力で、案内がない。失敗は `toastError` の短い英語 1 行。`ownership-unverified` は原因を返さない設計（proxy の `pairing-routes.ts`）で、画面側に手がかりがない。
- **接続が 0 件のとき**: `No connection has been added yet.` のみ。
- **カード**: 接続ごとに、機能表・チャンネル権限・通知先・切断を縦に並べる。
- **チャンネル権限**（`ChannelPermissionsForm`）: `Only these channels` を選ぶとチャンネル ID の手打ち。選択肢に `Not configured (protocol default)` がある。既定の挙動は `COMMAND_TRAITS` の `writes` で決まる（書き込み系は許可されず、それ以外はすべてのチャンネルで許可）。
- **通知先**（`NotificationDestinationsSection`）: 追加はできるが、管理画面の API に削除がない（GET と POST のみ）。配信イベントが 0 件でも保存できる。
- **切断**（`UnpairButton`）: 同じカードの中の 2 回クリック。確認文は消えるものしか書かない。GROWI 側だけで完結し、proxy には伝えない。proxy の `(installation_id, growi_uri)` は一意なので、proxy 側の登録（チャットサービスの `unregister`）が残る間は、同じワークスペースへ再接続すると `already-paired` で断られる。account-link は 45 日残り、再接続で引き継がれる。
- **文言**: 関係のバッジと接続の行以外は英語の直書き。保存結果のトーストに version・proxy が出る。機能表と状態は生の値（`active`・`Level` など）。

## Desired Outcome

決まったこと（2026-11 のチーム内レビュー）:

1. **接続の追加**: 機能開発をせず、入力の手がかりで下げる。Registration code に placeholder「チャットサービスの bot が発行したコード」、Proxy URL に placeholder `https://chat-proxy.example.com`、This GROWI's URL は `useSiteUrl()` を初期値（無いときの placeholder は `https://wiki.example.com`）、Label は `useAppTitle()` を初期値にする。
2. **接続が 0 件のとき**: 「接続がありません。「接続を追加」から、チャットサービスと連携できます。」を出す。
3. **レイアウト**: PC サイズではカードを 2 枚横並びにし、Channel permissions 以降を折りたたみにする。両方同時に行う。
4. **チャンネルの選択**: モーダルでチェックして選ぶ**汎用の選択部品**にする。一覧表示と絞り込みだけの単純な仕様にし、Slack・Discord・Teams など、サービスに依存しない。一覧の表示は `#general (C0123ABCDEF)`、非公開は `- private` を付ける。ドロップダウンやタグ入力は採らない。
5. **接続の追加の失敗**: トーストではなく、モーダル内のアラートで出す。status ごとの文言は次のとおり。
   - `code-expired`: 登録コードの有効期限が切れています。チャットサービスで新しいコードを発行してください。
   - `ownership-unverified`: 接続を確認できませんでした。proxy から、この GROWI の URL にアクセスできませんでした。次を確認してください。①「This GROWI's URL」が proxy から到達できる URL になっている ②GROWI が起動していて、HTTPS の証明書が有効である ③社内ネットワークの場合、proxy の許可リストに、この GROWI のホスト名が登録されている
   - `call-failed`: proxy に接続できませんでした。「Proxy URL」が正しいこと、proxy が起動していることを確認してください。（詳細: `{{reason}}`）
   - `already-paired`: このチャットサービスのワークスペースは、すでにこの GROWI と接続されています。接続の一覧を確認してください。
   - `relation-already-known`: この接続はすでに登録されています。接続の一覧を確認してください。
   - `key-encryption-unconfigured`: 暗号化キーが設定されていないため、接続を追加できません。画面上部の案内に従ってください。
6. **権限の既定値**: 「既定値」の選択肢を残し、ラベルをコマンドの性質に合わせる。分類は `COMMAND_TRAITS` の `writes` で決め、コマンド名では分岐しない。
   - 読み取り系（`search`・`help`・`link-preview`）: 既定値（すべてのチャンネルで許可）
   - 書き込み系（`create-page`・`agent`）: 既定値（許可しない）
   - ほかの選択肢: すべてのチャンネルで使う / 指定したチャンネルのみ / 使わない
   - 保存済みの設定が無いコマンドは、初期状態で「既定値」を選び、その場合は設定を保存しない。
7. **切断**: 確認をモーダルにする。「「{{name}}」との接続を切断しますか?」。削除されるもの（チャンネル権限、通知先、署名用の鍵。元に戻せない）、残るもの（ユーザーのアカウント連携。45 日間保持され、同じワークスペースを再接続すると引き継がれる）、注意（GROWI 側だけに反映され、チャットサービス側の登録は残る。再接続するには、先にチャットサービスで `unregister` を実行する）を示す。件数は出さない。
8. **切断済み（`unpaired`）のカード**: 「再接続するには、チャットサービスで `unregister` を実行してから、新しい登録コードで接続を追加してください。」を出す。表示順は最下位にする。
9. **その他**: 通知先を削除できるようにし、配信イベントが 0 件では保存できなくする。変更がない間は保存ボタンを無効にし、未保存の変更を示す。保存結果の文言から version・proxy などの内部用語をなくす。状態バッジ・接続状態・機能表の生の値を、管理者に分かる文言にする。画面の文言を i18n 対応する。

## Scope

- **In**: 上の Desired Outcome の 1〜9。`client/admin/` と、管理画面の API（チャンネル一覧の口、通知先の削除）、`admin.json` の文言。
- **Out**:
  - Slack への bot の導入（OAuth の入口）の画面化。今は導入用の URL を手で組む必要がある。別の spec が要る大きさ。
  - GROWI の切断を proxy へ自動で伝える機能。署名付きの新しい通信と protocol の契約変更になる。将来の候補。
  - 保存時の通知先の選択部品（`ChatIntegrationDestinationSelect`）。要件 2.2 の契約を保つ。

## 未決（requirements フェーズで決める）

- 「既定値」と「すべてのチャンネルで使う」が並ぶことで、読み取り系の 2 つが同じ結果になる。この区別をどう見せるかは後回し（チームで合意済み）。
- i18n の対象言語。`chat-integration-agent` は新しい文言を 5 言語で用意する方針。ja/en だけにするか、5 言語にするか。
- 通知先の削除、配信イベントの検査、切断後の案内を、既存の要件の範囲で足りるとするか、新しい要件を足すか。
- `chat-integration-agent` の残りのタスクが、管理画面（権限の行、文言）に触れるか。

## 出典と後始末

- この spec は amend spec であり、一時的な入れ物である。実装の後、最終タスクで、変更を `chat-integration-app` の design.md と umbrella の requirements に書き戻し、この spec を削除する（[spec-lifecycle.md](../../../.claude/rules/spec-lifecycle.md)）。
