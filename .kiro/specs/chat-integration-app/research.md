# Research & Design Decisions

## Design Decisions

### Decision: 固定リンクの `restricted: true` 応答は、実在パスではなく固定文言を `path` に入れる
- **Context**: 固定リンク（ページIDでのURL指定）の展開結果として、非公開ページであることをチャンネルに伝える際、応答の `path` フィールドに何を入れるかを決める必要がある。「非公開ならパスを含めない」という要求と、「固定リンクが見つからない場合と区別できない応答にする」という要求を、`@growi/chat` の契約変更なしで両立させる必要があった
- **Alternatives Considered**:
  1. 契約に `path?: string`（省略可）を追加し、無いときは proxy 側で行を省く案。「情報が無いことを持たない」という表現ができるが、`@growi/chat`・`chat-integration-proxy` 双方の変更が要り、両方とも `/kiro-validate-impl` 済みの sub-spec の再検証が要るため、範囲が広がりすぎる
  2. 固定リンクは常に `errorResponse('invalid')` に倒し、`link-preview` を返さない案。実装は最も単純だが、非公開ページを開いた場合と「そもそも固定リンク機能を使うな」という区別が付かなくなる
  3. `path` に「URL から読み取った pathname（固定リンクの ID を含む文字列）」を流用する案。投稿者はこの文字列を既に知っているため新しい情報の開示にはならないが、レビューで「テストで2つの応答を比べるとき、渡す ID が違えば `path` の値も違ってしまい、比較が成り立たない」という指摘を受けた。ユーザー確認の結果、そもそも「ページの状態を一切反映しない固定文言」にする方が単純で確実と判断し、この案は不採用
- **Selected Approach**: `resolvePageFromUrl` が返す情報に「固定リンクかどうか」を追加する（元の pathname 自体は応答に使わないため運ばない）。`buildLinkPreview` は、固定リンクで非公開（または見つからない）と判定したとき、`path` に固定文言 `PERMALINK_UNAVAILABLE_MESSAGE`（`'This page does not exist, or is not visible to everyone.'`）を入れる。この定数はどの呼び出しからも同じ値なので、「見つからない」と「見つかったが非公開」の応答は必ず完全に一致する
- **Rationale**: 固定文言はページの状態にもリクエストの中身にも依存しないため、「区別できない」という要求を、テスト側の工夫（同じ ID を使う等）なしに構造的に満たせる。パス形式 URL では従来どおり実在パスを返すので、既存の挙動は文字どおり無変更のまま保たれる
- **Trade-offs**: 固定リンクで非公開ページを開いたとき、これまでの「本文は隠すがパスは見せる」という体験が失われ、代わりに常に同じ文言が出るだけになる。ただしこれはパスを含めないという要求がまさに求めていることであり、副作用ではなく目的そのもの
- **Follow-up**: なし

### Decision: 固定リンクが見つからない場合もチャンネルへの表示が新しく出るようになることを受け入れる
- **Context**: `chat-integration-proxy` は、`kind: 'error'` の応答（今の「固定リンクが見つからない」の扱い）に対しては何も投稿しない。固定リンクが見つからない場合も `kind: 'link-preview'` を返すようになると、実在しないページでも表示が付くようになる。レビューでこの変化が設計のどこにも書かれていないと指摘された
- **Alternatives Considered**: 「見つからない」と「見つかったが非公開」の区別を、応答の中身ではなく「チャンネルへ投稿するかどうか」で定義し直す案（両方とも何も投稿しない、に倒す）
- **Selected Approach**: 応答の中身で区別できないようにする現行の設計を維持する。チャンネルへの表示が新しく出るようになる点は、設計ドキュメントの Overview に明記し、受け入れる
- **Rationale**: ユーザーに確認し、この変化（実在しないページでも同じ固定文言が表示されるようになること）を受け入れる方針で合意した。「投稿するかどうか」で区別しない設計にすると、`chat-integration-proxy` 側の変更が必要になり、`chat-integration-app` 内で完結させたい範囲を超える
- **Trade-offs**: 固定リンクを含むメッセージには、実在するかどうかに関わらず必ず何らかの表示が付くようになる。ユーザー体験としては「毎回何か言われる」側に倒すが、非公開ページの情報を漏らさないという目的には合っている
- **Follow-up**: なし

### Decision: 通知本文の 1 行目の書式と、差分の印の置き場所は Gen 1 から意図して変える

- **決めたこと**: 1 行目を `**Page edited** · [/path](url) · by alice` の形にし、差分の `:lower_left_fountain_pen:` の印は追加した文の末尾と同じ行に置き、本文の末尾に改行を付けない。
- **理由**: 実機試験（2026-10-27、Slack）で、変更の種類・操作した人・ページが区切られておらず読みにくいこと、印が改行のあとの別の行に落ちることが分かった。差分の作り方（行ごとの比較、追加行に印を付ける、2 行以上の削除を要約にまとめる）は Gen 1 と同じで、変えたのは見た目だけである。
- **契約への影響**: `NotificationRequest` は変えない。文面は GROWI が組み立てた markdown をそのまま proxy が投稿するだけなので、proxy 側の変更は要らない。

### Decision: URL の展開で題名を出すのは、公開範囲が「公開」のページに限る

- **Context**: ログインが必要な GROWI（`aclService.isGuestAllowedToRead()` が偽）では、公開範囲が「公開」のページでも、展開がパスだけ（固定リンクでは固定文言だけ）になり、機能がほぼ使えなかった（2026-10-26 の Slack での実機試験。固定リンクを貼っても「This page does not exist, or is not visible to everyone.」としか出なかった）。社内向けの GROWI はほとんどがこの設定なので、どこまで出すかを決める必要があった（要件 6.9〜6.12）
- **Alternatives Considered**:
  1. パスだけ・固定文言だけのままにする — 社内向けの GROWI のほとんどで機能が使えない
  2. 公開範囲に関わらず題名を出す（Notion に近い。Notion は見る権限が無い人にも題名と作成者で展開する）— GROWI の題名はパスの最後の部分で、利用者が中身を表す言葉を書くことが多い（例: `/人事/2027年の組織変更`）。公開範囲を絞ったページの題名を出すと、それ自体が漏れになる
  3. 公開範囲が「公開」のページに限って題名を出す（Confluence Cloud に近い。閲覧を制限したページだけを展開せず、ログインしたユーザーなら誰でも見られるページは展開する）
- **Selected Approach**: 3
- **Rationale**: 公開範囲が「公開」のページは、その GROWI にログインできる人なら誰でも題名と更新日時を見られる。新しく見えるのは、チャンネルにいる GROWI のユーザーでない人に対してだけで、見えるのは「何のページか」を示す題名と更新日時に限る。本文・コメント数・作成者は出さない。パスで指す URL は URL 自体に題名を含むので、この判断が新しく情報を足すのは主に固定リンクのとき
- **Trade-offs**: チャンネルに GROWI のユーザーでない人がいると、その人に公開ページの題名が見える。これを避けたい運用者のための設定は作っていない（下の「URL の展開の未決事項」3）

### Decision: 「リンクを知っている人だけ」（`GRANT_RESTRICTED`）は「公開」に含めない

- **Context**: `GRANT_RESTRICTED` のページは URL を知っていれば読めるので、URL を貼った時点で「公開」と同じに扱えるようにも見える
- **Selected Approach**: 含めない。`isPubliclyReadablePage` が偽を返すので、公開範囲を絞ったページと同じく、固定リンクなら固定文言、パスで指す URL ならパスだけになる。題名も更新日時も出さない
- **Rationale**: GROWI の画面でも、ログインした全員に見えるページではない（一覧や検索に出ない）。チャンネルに貼られた URL は、貼った人が意図した相手より広く届くことがある。「ログインできる人なら誰でも見られる」という、題名を出してよい理由が成り立たない

### Decision: 固定リンクで出すのは、パス全体ではなく題名だけ

- **Context**: 固定リンク（`/<pageId>` の形）は URL にパスを含まない。公開範囲が「公開」のページで、ログインが必要な GROWI のとき、場所として何を出すかを決める必要があった
- **Alternatives Considered**:
  1. パス全体を出す — GROWI には子のページを親より広く公開できないようにする正規化の仕組み（`apps/app/src/server/service/page-grant.ts` の `isGrantNormalized`）があるが、正規化されていない古いページ（v4 以前から移行したページなど）は残りうる。公開範囲が「公開」のページの祖先が公開範囲を絞ったページである可能性を否定できず、パス全体を出すとその祖先の名前が漏れる
  2. 題名（パスの最後の部分）だけを出す
- **Selected Approach**: 2。題名は `content/title-from-path.ts` の `titleFromPath`（`nodePath.basename(path) || path`。ルートでは `/`）で作り、検索の結果の題名（要件 3.9）と同じ関数を使う。2 か所で別々に書くと決め方がずれるため
- **Rationale**: パス全体より狭く、要件 6.6（固定リンクで、誰でも閲覧できるページでなければパスを含めない）と食い違わない
- **Trade-offs**: 同じ題名のページが多い wiki（例: 各部署の下の「議事録」）では、題名だけでは場所が分からない（下の「URL の展開の未決事項」2）
- **Follow-up**: 固定リンクでパス全体を出すように変える提案が出たときは、この決定を先に読む

### Decision: 通信契約の型は変えず、`restricted: true` の応答に `updatedAt` を入れてよいことにする

- **Context**: 「題名と更新日時だけ」の状態を proxy へ伝える必要があった。`@growi/chat` の `link-preview` 応答は `{ path; restricted; excerpt?; updatedAt?; commentCount? }`
- **Alternatives Considered**:
  1. `restricted: false` で、`excerpt`・`commentCount` を省いて送る — proxy のコードを変えずに表示できるが、`restricted` の意味が「全部出してよい」から「本文を出してよい」へずれ、次に読む人が間違える
  2. `title?: string` を新しく足す（検索の `SearchResultItem.title` が前例）— パスで指す URL ではパスを出す（要件 6.11）ので、GROWI が題名を入れる場合と入れない場合を作り分けることになり、`path` と `title` のどちらを出すかの判断が GROWI と proxy の 2 か所に分かれる
  3. 状態を表す列挙（例: `visibility: 'full' | 'title-only' | 'restricted'`）に置き換える — 型の形が変わるので、protocol・proxy・app の 3 つを同時に直す必要がある
  4. 型はそのまま。`restricted: true` のとき `updatedAt` を入れてよいことにし、`path` には「場所として表示する文字列」を GROWI が入れる（パスで指す URL なら実在のパス、固定リンクなら題名か固定文言）
- **Selected Approach**: 4
- **Rationale**: `path` は既に「表示する場所の文字列」として使われていた（固定リンクで出せないとき、固定文言を入れている）。何を出すかを決めるのは GROWI の `buildLinkPreview` だけになり、proxy は受け取ったものを出すだけで済む。解析関数（`packages/chat/src/parse/parse-command.ts`）は `restricted` の値に関係なく `excerpt`・`updatedAt`・`commentCount` を任意で受け付けるので、コードも変えずに済む。型の形が変わらないので、古い proxy と新しい GROWI を組み合わせても壊れない（古い proxy は `restricted: true` なら `path` だけを出すので、更新日時が出ないだけ）
- **Trade-offs**: `path` という名前と中身（題名や固定文言が入ることがある）がずれたまま残る。design.md の Revalidation Triggers の「`link-preview` に『見つからない』を独立に表すフィールドが足されたとき」に、名前の付け直しもあわせて考える

### Decision: 「題名と更新日時だけ」の状態では、コメント数を出さない

- **Context**: 出すものを「題名（と更新日など最小限）」と決めたが、コメント数をどうするかは決めていなかった
- **Selected Approach**: 更新日時だけを出し、コメント数は出さない
- **Rationale**: 「最小限」をいちばん狭く読んだ。コメント数や作成者を足すかは、URL の展開の確認フロー（umbrella の roadmap の 10）を設計するときに、出す情報全体と合わせて決められる（下の「URL の展開の未決事項」4）

### Decision: ゴミ箱に入ったページも、同じ扱いのままにする

- **Context**: `resolvePageFromUrl` はゴミ箱に入ったページを除かない（`Page.findOne` にゴミ箱の条件が無い）。ログインが必要な GROWI で、ゴミ箱に入った公開ページの固定リンクを貼ると、その題名と更新日時が出る。実装のレビューで、これを除くべきかを確かめた
- **Selected Approach**: そのままにする（除かない）
- **Rationale**: GROWI は、ゴミ箱に入った公開範囲が「公開」のページを、ログインした人には見せている（ページの markdown の取得や、ページツリー）。ログインが必要な GROWI で題名とパスを出しても、ログインした人が既に見られる以上のことは明かさない。これは「公開範囲が『公開』に限る」決定と同じ理由である

## Research Log — URL の展開（要件 6.9〜6.13）

- **判定の材料**: `isGuestAllowedToRead()`（`apps/app/src/server/service/acl.ts`）は、`security:wikiMode` が `private` なら偽、`public` なら真、それ以外は `security:restrictGuestMode` が `Readonly` のときだけ真。`Deny` だけでなく未設定・空でも偽になる。要件 6 の「ログインが必要な GROWI」は、この関数が偽のとき全部を指す。`command-endpoint.ts` の `handleLinkPreview` がこの値を `buildLinkPreview` へ渡す
- **貼った人の確認が手前にある**: `command-endpoint.ts` は、`link-preview` でも `search` と同じく、先に `resolveReadDenial(resolved, isGuestAllowedToRead())` を通す。ログインが必要な GROWI で、貼った人が GROWI ユーザーに紐付いていなければ、`buildLinkPreview` まで届かず `account-link-required` が返る。proxy の `previewLinks`（`apps/chat-integration-proxy/src/orchestration/command-flow.ts`）は `link-preview` 以外の応答を黙って捨てるので、紐付いていない人が貼った URL は、ログインが必要な GROWI では何も展開されない（下の「URL の展開の未決事項」1）
- **他製品の扱い（公式の説明で確かめた範囲）**: Notion は Slack に貼られたリンクを、ページを見る権限が無い人にも題名と作成者で展開し、見る権限が無い人がいれば貼った本人に権限を与えるかを尋ねる。Confluence Cloud は閲覧を制限したページだけを展開せず、ログインしたユーザーなら誰でも見られるページは展開する

## Risks & Mitigations — URL の展開（要件 6.9〜6.13）

- **公開ページの固定リンクの存在が分かる**: 公開範囲が「公開」のページは、固定リンクの応答が題名になるので存在が分かる。そのページは GROWI にログインできる人なら誰でも存在を知れるので、漏れではない。公開範囲を絞ったページと存在しないページとは、同じバイト列の応答（`PERMALINK_UNAVAILABLE_MESSAGE`）のまま見分けられない（要件 6.8・6.12）。`link-preview-mapper.spec.ts` が、`GRANT_OWNER`・`GRANT_USER_GROUP`・`GRANT_RESTRICTED`・`GRANT_SPECIFIED` のそれぞれで、開いた GROWI・閉じた GROWI の両方について `toStrictEqual` で確かめる
- **古い proxy と新しい GROWI の組み合わせ**: 古い proxy は `restricted: true` なら `path` だけを出すので、固定リンクでは題名だけが出て更新日時が出ない。壊れはしない
- **正規化されていない古いページ**: 固定リンクで題名だけを出すことで、祖先の名前が漏れる経路を作らない（「固定リンクで出すのは、パス全体ではなく題名だけ」）

## URL の展開の未決事項（repo の中からは答えを決められなかったもの）

1. ログインが必要な GROWI で、紐付いていない人が貼った URL は何も展開されない。題名だけの展開は、貼った人が紐付いているときにしか出ない。「誰が貼っても、公開ページなら題名を出す」にするかは決めていない（紐付けの確認を外すと、紐付けていない人が GROWI のページの存在を探れる口が増える）
2. 固定リンクで、題名だけでは場所が分からない場合に、パス全体を出すべきか。正規化されていない古いページがどれだけ残っているかで判断が変わる
3. チャンネルに GROWI のユーザーでない人がいる場合に、題名も出したくない運用者のための設定を作るか
4. 「最小限」にコメント数（や作成者）を含めるか
