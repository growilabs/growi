# Brief: change-proposal-ai-agent

**Parent**: umbrella spec `change-proposal`（[roadmap.md](../change-proposal/roadmap.md)、判断の理由とコード上の事実は [research.md](../change-proposal/research.md)）

## Problem

GROWI AI Agent は、検索と読み取りの結果をもとに答えることしかできない。「この会議の結果でこの手順書を直して」「この内容で新しいページを作って」「このページをあそこへ移して」と頼んでも、ユーザーが自分でページを書き換える必要がある。

AI に書き込みをそのまま任せると、次の危険がある。
- ページの本文に仕込まれた指示に従って、頼んでいないページを書き換える。
- 本人しか見られないページの内容を、全員に公開されたページに書き写す。
- 長いページの読んでいない節を落としたり、出力が途中で切れたりして、内容が消える。

## Current State

- GROWI AI Agent（Mastra の `growiAgent`、`apps/app/src/features/mastra/`）の道具は `fullTextSearchTool` と `getPageContentTool` だけで、読み取り専用。
- `getPageContentTool` は、リンクを知る人だけが見られるページも ID で読める。
- チャットの API（`post-message.ts`）は AI 用の権限だけを確かめ、読み取り専用のユーザーを弾いていない。1回の実行の段数の上限（`maxSteps`）は 10。
- suggest-path（ページの置き場所の候補を出す機能）は API として存在する。
- 外部の `@growi/mcp-server` の `editPage` は「この文字列をこう置き換える」形で、反映前に差分を確かめられる。

## Desired Outcome

- チャットでの会話から、AI が Change Proposal（編集・新規作成・移動）を作れる。
- AI が作る編集は、本文全体ではなく置き換えの指示で出させ、サーバーが本文を組み立てる。内容が消える操作は拒否する。
- AI が書き込むのは、ユーザーが指定したページだけ。AI が読んだページより閲覧範囲の広いページへの書き写しは止める。
- チャット画面で、作られた Change Proposal を確かめ、ページ単位で承認して反映できる。自動反映が有効なら反映の結果を見られる。取り消しもできる。

## Approach

- Change Proposal を作るだけの道具を足す。この道具はページやリビジョンには書き込まない。反映は `change-proposal-core` が行う。
  - 編集: 対象ページと置き換えの指示を受け取る。サーバーが元のリビジョンの本文に当てて、変更後の本文全体を作る。置き換える元の文字列が見つからない操作と、本文が一定の割合以上短くなる操作は拒否し、AI に作り直させる。
  - 新規作成: 本文と置き場所を受け取る。置き場所の候補は suggest-path を使って出す。
  - 移動: 移動元と移動先を受け取る。1つの Change Proposal につき1つまで。
- 書き込み先の制限:
  - 編集と移動の対象は、ユーザーが @メンションやパスで指定したページに限る。
  - 新規作成は、ユーザーが認めた親ページの下に限る。
  - AI が読んだ内容をもとに選んだページは「AI の提案」として表示し、自動では対象にしない。
- 閲覧範囲の確認: その実行で AI が読んだページ（検索結果と本文）を記録する。書き込み先より閲覧範囲の狭いページが含まれていれば、ページの名前を並べて止める（本人が確かめれば進められるかは設計で決める）。
- ページの本文から読んだ内容は「信頼できないデータ」として AI に渡す。ユーザーが頼んだ対象と、AI が道具で触れようとした対象が違うときは記録する。
- チャットの API に、ページの書き込み権限と読み取り専用ユーザーの確認を足す。
- チャット画面:
  - 作られた Change Proposal を、操作ごとの差分で見せる
  - ページ単位の承認と、全部反映のボタン
  - 自動反映した結果と取り消しのボタン
  - 古くなった案（元の版が変わった案）には「AI で作り直す」ボタン
- AI が書いた要約や会話は Change Proposal に結び付けて保存し、本人にだけ見せる。

## Scope

- **In**:
  - Change Proposal を作る道具（編集・新規作成・移動）
  - 置き換えの指示から本文を組み立てる処理と、内容が消える操作の拒否
  - 書き込み先の制限、閲覧範囲の確認、信頼できないデータとしての扱い
  - チャットの API の権限の確認
  - チャット画面での表示・承認・取り消し・作り直し
  - AI の指示文（いつ書き込みの道具を使うか、どう出すか）
- **Out**:
  - 反映と取り消しの実行、管理者の設定 → `change-proposal-core`
  - 反映済みの Change Proposal を他の人に見せる画面 → `change-proposal-viewer`
  - 大きな整理を計画として先に出させる機能（Notion の Plan Mode のようなもの）
  - AI が自分から始める作業

## Boundary Candidates

- 書き込みの道具と、本文を組み立てる純関数（置き換えの適用、短くなりすぎの判定）
- 書き込み先の制限と閲覧範囲の確認（実行ごとに読んだページの記録）
- チャットの API とチャット画面

## Out of Boundary

- ページを直接書き換える道具は作らない。必ず Change Proposal を通す。
- 削除、閲覧範囲の変更、公開・非公開の切り替えの道具は作らない。

## Upstream / Downstream

- **Upstream**:
  - `change-proposal-core`（Change Proposal を作る API、承認・反映・取り消しの API）
  - `suggest-path`
  - Mastra の agent と道具の仕組み
- **Downstream**:
  - 将来の `change-proposal-mcp` が、同じ「置き換えの指示から本文を組み立てる」処理を使う

## Existing Spec Touchpoints

- **Extends**: `ai-agentic-search`（同じ agent に書き込み用の道具を足す。読み取りの道具は変えない）
- **Adjacent**:
  - `ai-chat-page-mention`（@メンションしたページを書き込み先として使う）
  - `suggest-path`（新規作成の置き場所）

## Constraints

- 反映は `change-proposal-core` の API を通す。この spec の中でページを書き換えない。
- 置き換えを当てる処理は純関数にし、外部の `@growi/mcp-server` の `applyStringEdits` との共通化を検討する（置き場所は `@growi/core` など）。
- 1回の実行の段数の上限（今は 10）で、複数ページの Change Proposal を作れるかを確かめる。
- 最初に確かめること: Mastra の、道具を実行する前に承認を求める機能（`requireApproval`）を、今のチャット画面で使えるか。
