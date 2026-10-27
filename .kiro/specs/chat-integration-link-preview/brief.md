# Brief: chat-integration-link-preview

ログインしていない人の閲覧を許さない GROWI でも、公開範囲が「公開」のページなら、貼られた URL を
**題名と更新日時だけ**で展開するようにする amend spec。umbrella の roadmap「リリース前に直すもの」の 5
（URL の展開の方針）で決めた方針を、要件と設計に落とす。

## Amend target

| 対象の spec | 変わる契約 |
|---|---|
| `chat-integration`（umbrella） | 要件 6（URL の展開）に受け入れ条件 **6.9〜6.13 を末尾に足す**。既存の番号は振り直さない。**6.3 の文言は、6.9 と食い違うので、番号を変えずに「6.9 の場合を除き」を足す形で書き直す**（6.3 は「誰でも閲覧できるわけではないページはパス以外を含めない」と言っており、6.9 の更新日時と衝突する）。6.1・6.2・6.6・6.7・6.8 の文言は変えない。design.md の要件の対応表（`6.1–6.8`）を `6.1–6.13` に、担当を `app` / `proxy` のままにする |
| `chat-integration-app` | design.md「`PublicPageFilter` を呼ぶ側も、閉じた GROWI での扱いを決める」の表の **「リンクの展開 → パスだけにする」の行を撤回する**（この行がまさに今回変える契約）。`LinkPreviewMapper`（`buildLinkPreview`）の判定に新しい状態（題名と更新日時だけ）を足し、System Flow・Service Interface の不変条件（「restricted なら updatedAt を含まない」はここにある）・Requirements Traceability と、Overview の「固定リンクが見つからない場合の表示」を書き直す。Revalidation Triggers に 1 行足す（下の「Revalidation Triggers への影響」） |
| `chat-integration-protocol` | **型の形もコードも変えない。文書だけを足す。** 今の design.md は `link-preview` の応答の型を載せているだけで、`restricted: true` のときに何を含むかの決まりを書いていない（「`restricted: true` なら `excerpt`・`updatedAt`・`commentCount` を含まない」という決まりは app の design.md の不変条件にある）。型の近くに「`restricted: true` のとき `excerpt`・`commentCount` は含まない。`updatedAt` は含むことがある。`path` は場所として表示する文字列で、実在のパス・題名・固定文言のどれかが入る」を書き足す。解析関数 `parse-command.ts` は今でも `restricted: true` と `updatedAt` の組を受け付ける |
| `chat-integration-proxy` | URL の展開の表示（`orchestration/command-flow.ts` の `previewMarkdown`）。`restricted: true` でも `updatedAt` があれば「更新: …」を出す。`restricted: true` のときに本文の冒頭とコメント数を出さないことは変えない |

### Revalidation Triggers への影響

- **protocol の Revalidation Triggers「通信契約の型の形が変わったとき」には当たらない。** 型の形（フィールドの名前・型・必須かどうか）は変えず、`restricted: true` のときに `updatedAt` を入れてよいという**意味の決まり**だけを変える。ただし意味の変更でも proxy と app の両方が寄りかかっているので、両方の design を確かめ直す（本 spec の design.md で、両方を Amend target に入れている理由）
- **app の Revalidation Triggers の「`link-preview` に『見つからない』を独立に表すフィールドが足されたら見直す」は、今回は発動しない。** 固定リンクで見つからない場合の固定文言（`PERMALINK_UNAVAILABLE_MESSAGE`）はそのまま使い続ける
- app の Revalidation Triggers に足す: **「GROWI のページの階層と公開範囲の決まり（子のページは親より広く公開できない、という正規化）が変わったとき、または『公開』の意味が変わったとき、題名だけの展開が漏らすものを見直す」**
- proxy の Revalidation Triggers には当たる行が無い。`@growi/chat` の契約の意味が変わる、という一般的な行（「`@growi/chat` の契約が変わったとき」）で確かめ直す

## Problem

- 実機試験（2026-10-26、Slack）で、ログインしていない人の閲覧を許さない GROWI（`security:restrictGuestMode` が `Deny`）では、
  公開範囲が「公開」のページでも、固定リンク（`/6adf…` の形）を貼ると「存在しないか、全員には見えない」としか出ず、
  URL の展開がほぼ使えないと分かった。
- 社内向けの GROWI はほとんどがこの設定で運用されるので、この機能の主な利用者に届いていない。

## Current State

- 判定は `buildLinkPreview`（`apps/app/src/features/chat-integration/server/content/link-preview-mapper.ts`）が行う。
  本文の冒頭まで出すのは「公開範囲が『公開』」かつ「ログインしていない人も読める GROWI」（`isGuestAllowedToRead()`）の両方を満たすときだけ。
  どちらかが偽なら `restricted: true` で、パス形式の URL なら実在のパス、固定リンクなら固定文言だけを返す。
- この扱いは app の design.md の表「リンクの展開（要件 6.2・6.3）→ パスだけにする。URL を貼った本人が中身を知っていても、チャンネルの全員がそうとは限らない」で決めたもの。
- 閉じた GROWI では、URL を貼った人が GROWI ユーザーに紐付いていないと、`buildLinkPreview` まで届かず、紐付けの案内（`account-link-required`）が返る（`resolveReadDenial`）。proxy はこの応答を URL の展開では黙って捨てる。

## Desired Outcome

- 公開範囲が「公開」のページ: ログインしていない人も読める GROWI なら、今どおり題名・本文の冒頭・更新日時・コメント数。
  ログインが必要な GROWI なら、**題名と更新日時だけ**。
- 公開範囲が「本人だけ」「グループだけ」「リンクを知っている人だけ」「特定のユーザーだけ」のページ: 今どおり。
  固定リンクなら、存在しないページと見分けがつかない返し方（要件 6.8）。

## Approach

- **決定（roadmap の 5）: 題名など最小限は出す。ただし公開範囲が「公開」のページに限る。**
  GROWI の題名はパスの最後の部分なので、公開範囲を絞ったページでは題名を出すこと自体が漏れになる。
  パスの形の URL は URL 自体に題名を含むので、この変更が主に役に立つのは固定リンクのとき。
- 他製品の扱い（公式の説明で確かめた範囲）: Notion は見る権限が無い人にも題名と作成者で展開する。
  Confluence Cloud は閲覧を制限したページだけを展開せず、ログインしたユーザーなら誰でも見られるページは展開する。
- 理由の詳細と、採らなかった案は [research.md](./research.md)。

## Scope

- **In**: `buildLinkPreview` の判定と応答、proxy の表示、要件 6 への受け入れ条件の追記、protocol の design.md の意味の記述
- **Out**:
  - **投稿者に「全員に見せるか」を尋ねる確認フロー**（roadmap の 10）。`/kiro-discovery` から別に始める。要件番号は本 spec が足す 6.13 の後から振る
  - 閉じた GROWI で、URL を貼った人が紐付いていないときの扱い（今は紐付けの案内が返り、proxy はそれを黙って捨てる）。本 spec では変えない（design.md「Non-Goals」）
  - コメント数・作成者など、更新日時以外の付加情報を題名だけの展開に足すこと

## Upstream / Downstream

- **Upstream**: なし（`chat-integration-app`・`-proxy`・`-protocol` は実装済み）
- **Downstream**: roadmap の 10（確認フロー）が、本 spec で決めた「題名だけ」の状態の上に乗る

## Constraints

- **要件の番号は振り直さない**（`.claude/rules/spec-lifecycle.md`）。実装とテストが 6.3・6.6〜6.8 を名指しで参照している
- 要件 6.8（固定リンクの「存在しない」と「公開範囲を絞ったページ」を応答で見分けられない）を壊さない。2 つの応答は今と同じバイト列のまま
- amend spec なので、最後のタスクで対象の spec へ書き戻し、このディレクトリを消す
