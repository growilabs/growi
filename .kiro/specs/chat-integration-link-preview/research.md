# Research & Design Decisions — chat-integration-link-preview

> このファイルは書き戻しのときに移す。決定 1〜4・Research Log・未決事項は `chat-integration-app/research.md` へ移す
> （`chat-integration-protocol` には research.md が無いので、決定 3 も app 側に置き、protocol の design.md からそこを指す）。
> umbrella の `research.md` には決定 1（公開に限る理由）の要約を置く。

## Summary

- **きっかけ**: 2026-10-26 の Slack での実機試験。ログインが必要な GROWI では、公開範囲が「公開」のページの固定リンクを貼っても
  「This page does not exist, or is not visible to everyone.」としか出なかった
- **決まったこと**: 公開範囲が「公開」のページに限り、ログインが必要な GROWI でも題名と更新日時を出す（umbrella の roadmap の 5）
- **通信契約の型は変えない**。`restricted: true` の応答に `updatedAt` を入れてよい、という意味の決まりだけを変える

## Research Log

### 今の判定がどこで決まっているか

- `buildLinkPreview`（`apps/app/src/features/chat-integration/server/content/link-preview-mapper.ts`）が、
  `isPubliclyReadablePage(page) && isGuestAllowedToRead` の 1 つの真偽で、全部出すかパスだけかを決めている
- `isGuestAllowedToRead` は `command-endpoint.ts` の `handleLinkPreview` が `crowi.aclService.isGuestAllowedToRead()` を渡す
- `isGuestAllowedToRead()`（`apps/app/src/server/service/acl.ts:50-67`）は、`security:wikiMode` が `private` なら偽、`public` なら真、
  それ以外は `security:restrictGuestMode` が `Readonly` のときだけ真。**`Deny` だけでなく未設定・空でも偽になる**。
  本 spec の「ログインが必要な GROWI」はこの関数が偽のとき全部を指す
- この扱いの根拠は app の design.md の表「リンクの展開（要件 6.2・6.3）→ パスだけにする。URL を貼った本人が中身を知っていても、チャンネルの全員がそうとは限らない」

### URL を貼った人の確認が手前にある

- `command-endpoint.ts` は、`link-preview` でも `search` と同じく、先に `resolveReadDenial(resolved, isGuestAllowedToRead())` を通す
- ログインが必要な GROWI で、貼った人が GROWI ユーザーに紐付いていなければ、`buildLinkPreview` まで届かず `account-link-required` が返る
- proxy の `previewLinks`（`apps/chat-integration-proxy/src/orchestration/command-flow.ts`）は、`link-preview` 以外の応答を黙って捨てる。
  つまり**紐付いていない人が貼った URL は、ログインが必要な GROWI では何も展開されない**。本 spec はここを変えない（未決事項 1）

### 応答の型と解析

- `@growi/chat` の `link-preview` 応答（`packages/chat/src/contract/command.ts`）は
  `{ path: string; restricted: boolean; excerpt?; updatedAt?; commentCount? }`
- 解析関数（`packages/chat/src/parse/parse-command.ts`）は、`restricted` の値に関係なく `excerpt`・`updatedAt`・`commentCount` を任意で受け付ける。
  **`restricted: true` と `updatedAt` の組は、今の解析で通る**
- proxy の `previewMarkdown` は、`restricted: true` なら `${growiLabel}: ${path}` だけを出し、他のフィールドを見ない

### 公開範囲と階層（パス全体を出してよいか）

- GROWI には、子のページを親より広く公開できないようにする正規化の仕組みがある（`apps/app/src/server/service/page-grant.ts` の `isGrantNormalized`）
- ただし正規化されていない古いページ（v4 以前から移行したページなど）は残りうるので、
  **公開範囲が「公開」のページの祖先が、公開範囲を絞ったページである可能性を否定できない**。
  パス全体を出すと、その祖先の名前が漏れる
- → 固定リンクで出すのは題名（パスの最後の部分）だけにする（決定 2）

### 題名の決め方

- 検索の結果の題名は `search-result-mapper.ts` の `titleFromPath`（`nodePath.basename(path) || path`）で決めている。ルートでは `/`
- 同じ決め方を、URL の展開でも使う。2 か所で別々に書くとずれるので、1 つの関数を共有する

## Design Decisions

### 決定 1: 題名を出すのは、公開範囲が「公開」のページに限る

- **背景**: ログインが必要な GROWI では、今は公開範囲が「公開」のページでも何も出ない。どこまで出すかを決める必要があった
- **比べた案**:
  1. 今のまま（パスだけ・固定文言だけ）— 社内向けの GROWI のほとんどで機能が使えない
  2. 公開範囲に関わらず、題名を出す（Notion に近い）— GROWI の題名はパスの最後の部分で、利用者が中身を表す言葉を書くことが多い。公開範囲を絞ったページの題名を出すと、それ自体が漏れになる
  3. **公開範囲が「公開」のページに限って題名を出す（Confluence Cloud に近い）**
- **選んだ案**: 3
- **理由**: 公開範囲が「公開」のページは、その GROWI にログインできる人なら誰でも題名を見られる。チャンネルにいる人のうち GROWI のユーザーでない人には新しく見えるが、
  題名と更新日時は「何のページか」を示すだけで、本文は出さない。公開範囲を絞ったページは、題名を出すこと自体が漏れなので、今どおり何も出さない
- **トレードオフ**: チャンネルに GROWI のユーザーでない人がいると、その人に公開ページの題名が見える。これを避けたい運用者のための設定は作らない（未決事項 3）
- **蒸し返さないための注意**: 「リンクを知っている人だけ」（`GRANT_RESTRICTED`）は「公開」に含めない。URL を知っていれば読めるページだが、
  GROWI の画面でもログインした全員に見えるわけではないので、題名も出さない

### 決定 2: 固定リンクで出すのは、パス全体ではなく題名だけ

- **背景**: 固定リンク（`/<pageId>` の形）は URL にパスを含まない。今の要件 6.6 は「誰でも閲覧できるページでなければパスを含めない」
- **比べた案**:
  1. パス全体を出す — 正規化されていない古いページでは、公開範囲を絞った祖先の名前が漏れうる
  2. **題名（パスの最後の部分）だけを出す**
- **選んだ案**: 2。roadmap の決定の文言（「題名だけ」）にも合う。要件 6.6 も書き換えずに済む
- **トレードオフ**: 同じ題名のページが多い wiki（例: 各部署の下の「議事録」）では、題名だけでは場所が分からない（未決事項 2）

### 決定 3: 通信契約の型は変えず、`restricted: true` に `updatedAt` を許す

- **背景**: 「題名と更新日時だけ」の状態を proxy へ伝える必要がある
- **比べた案**:
  1. `restricted: false` で、`excerpt`・`commentCount` を省いて送る — proxy のコードを変えずに表示できるが、`restricted` の意味が「全部出してよい」から「本文を出してよい」へずれ、次に読む人が間違える
  2. `title?: string` を新しく足す（検索の `SearchResultItem.title` が前例）— proxy は「`title` があれば `path` の代わりに出す」と分岐することになる。
     しかしパスで指す URL ではパスを出す（6.11）ので、GROWI が題名を入れる場合と入れない場合を作り分けることになり、`path` と `title` のどちらを出すかの判断が 2 か所に分かれる
  3. 状態を表す列挙（例: `visibility: 'full' | 'title-only' | 'restricted'`）に置き換える — 型の形が変わるので、protocol・proxy・app の 3 つを同時に直す必要がある
  4. **型はそのまま。`restricted: true` のとき `updatedAt` を入れてよいことにし、`path` には「場所として表示する文字列」を GROWI が入れる**（パスで指す URL なら実在のパス、固定リンクなら題名）
- **選んだ案**: 4
- **理由**: `path` は既に「表示する場所の文字列」として使われている（固定リンクで出せないとき、固定文言を入れている）。何を出すかを決めるのは GROWI の `buildLinkPreview` だけになり、proxy は受け取ったものを出すだけで済む。
  型の形が変わらないので、chat-integration がまだリリース前であることを考えなくても、古い proxy と新しい GROWI の組み合わせで壊れない（古い proxy は更新日時を出さないだけ）
- **トレードオフ**: `path` という名前と中身（題名や固定文言が入ることがある）がずれたまま残る。
  app の Revalidation Triggers の「『見つからない』を独立に表すフィールドを足したら見直す」と同じときに、名前の付け直しを考える

### 決定 4: 「題名だけ」の状態でも、コメント数は出さない

- **背景**: roadmap の決定は「題名（と更新日など最小限）」で、コメント数をどうするかは書いていない
- **選んだ案**: 更新日時だけを出し、コメント数は出さない
- **理由**: 「最小限」をいちばん狭く読んだ。コメント数を足すかは、確認フロー（roadmap の 10）を設計するときに、出す情報全体と合わせて決められる（未決事項 4）

## Risks & Mitigations

- **固定リンクの存在が分かるようになる** — 公開範囲が「公開」のページについては、固定リンクの応答が固定文言から題名に変わる。
  そのページは GROWI にログインできる人なら誰でも存在を知れるので、漏れではない。公開範囲を絞ったページと存在しないページとは、今と同じバイト列の応答のまま（要件 6.8・6.12）
- **古い proxy と新しい GROWI の組み合わせ** — 古い proxy は `restricted: true` なら `path` だけを出すので、固定リンクでは題名だけが出て更新日時が出ない。壊れはしない
- **正規化されていない古いページ** — 題名だけを出すことで、祖先の名前が漏れる経路を作らない（決定 2）

## 未決事項（repo の中からは答えを決められなかったもの）

1. **閉じた GROWI で、紐付いていない人が貼った URL** は今どおり何も展開されない。題名だけの展開は、貼った人が紐付いているときにしか出ない。
   「誰が貼っても、公開ページなら題名を出す」にするかは、本 spec では決めていない（紐付けの確認を外すと、紐付けていない人が GROWI のページの存在を探れる口が増える）
2. 固定リンクで、題名だけでは場所が分からない場合に、パス全体を出すべきか。正規化されていない古いページがどれだけ残っているかで判断が変わる
3. チャンネルに GROWI のユーザーでない人がいる場合に、題名も出したくない運用者のための設定を作るか
4. 「最小限」にコメント数（や作成者）を含めるか
