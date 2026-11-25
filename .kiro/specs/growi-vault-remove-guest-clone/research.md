# Research & Design Decisions: growi-vault-remove-guest-clone

## Summary

- **Feature**: growi-vault-remove-guest-clone（growi-vault-gateway・growi-vault・growi-vault-manager への amend）
- **Discovery Scope**: Extension（既存の実装の読み取りが中心）
- **Key Findings**:
  - 「利用者なし」は `userId: null` という 1 つの値で、middleware・namespace の計算・RPC・ビューの合成の 4 層を通っている。入口で拒否して型から `null` を消せば、残りの層の分岐はすべて消せる。
  - ゲストの可否は、すでに標準の `loginRequiredFactory` に任せてある。第 2 引数を `false` にするだけで、ゲスト閲覧の設定によらず拒否になる。
  - 今の master では、過去の gc が ref を `packed-refs` にまとめていることがある（#12334 が直す不具合）。`anonymous-view` の ref をファイルの削除だけで消すと、`packed-refs` の中に残る。

## Research Log

### 漏れの経路

- **Context**: ゲストのクローンで、権限を絞ったページや削除したページの内容が取り出せる（別のセッションで再現済み）。
- **Findings**:
  - `vault-view-composer.ts` は、ビューを合成するたびに、前回のビューの commit を親にする。
  - `anonymous-view` はすべてのゲストで 1 本なので、その履歴には、過去のどの時点の public の内容も残る。
  - clone は履歴ごと受け取るので、新しくクローンしたゲストは、今は public でない内容も受け取る。
  - ログインユーザーのビューは 1 人に 1 本で、ビューは本人が clone / fetch したときにだけ合成される。履歴に入るのは、本人がその時点で受け取った内容だけである。
- **Implications**: 問題は「ビューを複数の相手が共有すること」と「ビューが履歴を持つこと」の組み合わせで起きる。どちらかをなくせば止まる。

### `anonymous-view` の ref の消し方

- **Context**: 起動時に ref を確実に消したい。
- **Findings**:
  - `VaultRepoStorage` は ref を loose ファイルとして直接読み書きし、`packed-refs` を見ない。
  - `git gc` は既定で ref を `packed-refs` にまとめる。#12334 より前の版で gc が動いた環境では、`anonymous-view` の ref が `packed-refs` の中にある。
  - `git update-ref -d` は、loose の ref も `packed-refs` の中の ref も消す。vault-manager は gc と upload-pack のためにすでに git を起動している。
- **Implications**: ref の削除には `git update-ref -d` を使う。#12334 が先に入っても後に入っても、同じ処理で消える。

## Design Decisions

### Decision 1: ゲストのクローンを廃止する（共有のビューを残して履歴だけを断つ方法は採らない）

- **Alternatives Considered**:
  1. ゲストのクローンを廃止する
  2. `anonymous-view` だけ、毎回親なしの commit にする
- **Selected Approach**: 1。
- **Rationale**: 2 は、クローン済みのゲストの `git pull` が「無関係な履歴」として失敗するようになる。また、利用者を特定できない相手に内容を配る経路が残り、将来ビューの持ち方を変えたときに同じ種類の漏れを作りうる。1 は経路そのものをなくす。
- **Trade-offs**: ゲスト閲覧を許可しているサイトでも、クローンには PAT（つまりアカウント）が必要になる。
- **備考**: この決定はユーザーが下したもので、この spec の前提である。

### Decision 2: 入口で拒否し、その先の型から `null` を消す

- **Alternatives Considered**:
  1. middleware の引数だけを変え、`userId: string | null` の型は残す
  2. 型を `string` にして、`null` の分岐をすべて消す
- **Selected Approach**: 2。
- **Rationale**: 1 では、`null` を受け取れる関数が残る。middleware の並びを変えたり、別の呼び出し元を足したりしたときに、利用者なしの経路が黙って復活しうる。2 は、その経路を型検査で止める（coding-style.md の「Make Invalid States Unrepresentable」）。
- **Trade-offs**: `@growi/core` の型が変わるので、changeset が要る。

### Decision 3: 既存の `anonymous-view` は、vault-manager の起動時に消す

- **Alternatives Considered**:
  1. 起動のたびに消す（なければ何もしない）
  2. 管理者が Vault を再構築したときに消す
  3. migrate-mongo の migration で消す
- **Selected Approach**: 1。
- **Rationale**: 2 は、再構築するまで古いビューが残る。3 は、migration が apps/app の側で動くので、vault-manager の持つ bare repo に手が届かない。1 は、更新した時点で消え、管理者の操作が要らない。
- **Trade-offs**: 更新が行き渡った後は何もしない処理が、起動のたびに動く。git の起動 1 回とファイルの削除 1 回なので、負担は小さい。次のメジャー版で削除できる。

### Decision 4: 片付けが失敗しても、起動を続ける

- **Rationale**: gateway がゲストを通さないので、ref が残っていても内容は配られない。一方、vault-manager が起動しないと、ログインユーザーのクローンが止まる。失敗は error ログに残し、次の起動でやり直す。

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ゲストのクローンに頼っていた利用者（CI など）が、更新後に失敗する | 401 と `WWW-Authenticate` を返すので、git が認証情報を尋ねる。リリースノートに、PAT を発行すればよいことを書く |
| 古い apps/app が `userId: null` を送り続ける | vault-manager の controller が 400 を返す。内容は渡らない |
| 将来、だれかが認証情報のないクローンを足し直す | 型が `userId: string` なので、型検査で止まる。Revalidation Triggers に、先に決めるべきことを書いた |

## References

- `.claude/rules/spec-lifecycle.md` — amend spec の扱い
- `.claude/rules/coding-style.md` — 「Make Invalid States Unrepresentable」
- PR #12334 — `packed-refs` と ref の読み取りの不具合
