# Research & Design Decisions — growi-vault-gateway

> 本ファイルは、gateway が「利用者を特定できないリクエストを通さない」ことの選定根拠を記録する。umbrella spec の `.kiro/specs/growi-vault/research.md` がアーキテクチャ全体の選定根拠を持つ。起動時の片付けと ref の消し方は `.kiro/specs/growi-vault-manager/research.md` にある。

## Summary

- **Feature**: growi-vault-gateway（growi-vault・growi-vault-manager にまたがる設計判断を含む）
- **Key Findings**:
  - 以前の版は、認証情報のないリクエストを「利用者なし（`userId: null`）」として通し、ゲスト閲覧を許可したサイトでは public のページだけのビューを配っていた。このビューは全ゲストで 1 本の ref を共有し、履歴を持つため、権限を絞ったページや削除したページの内容がクローンで取り出せた。
  - 「利用者なし」は `userId: null` という 1 つの値で、middleware・namespace の計算・RPC・ビューの合成の 4 層を通っていた。入口で拒否し、型を `userId: string` にすると、この分岐はどの層にも要らない。
  - ゲストの可否は、標準の `loginRequiredFactory` に任せてある。第 2 引数を `false` にするだけで、ゲスト閲覧の設定によらず拒否になる。

---

## Research Log

### 漏れの経路

- **Context**: ゲストのクローンで、権限を絞ったページや削除したページの内容が取り出せた。
- **Findings**:
  - ビューの合成（`vault-view-composer.ts`）は、合成するたびに、前回のビューの commit を親にする。
  - ゲスト用のビュー（`anonymous-view`）はすべてのゲストで 1 本なので、その履歴には、過去のどの時点の public の内容も残る。
  - clone は履歴ごと受け取るので、新しくクローンしたゲストは、今は public でない内容も受け取る。
  - ログインユーザーのビューは 1 人に 1 本で、ビューは本人が clone / fetch したときにだけ合成される。履歴に入るのは、本人がその時点で受け取った内容だけである。
- **Implications**: 問題は「ビューを複数の相手が共有すること」と「ビューが履歴を持つこと」の組み合わせで起きる。どちらかをなくせば止まる。

### 認証の前段に session と passport が走る

- **Context**: `/vault.git` の route には express-session と passport が先に走る。
- **Findings**: セッション cookie が付いたリクエストでは、credential adapter（`vault-pat-auth.ts`）に着く前に、passport が `req.user` をセッションの利用者で埋めることがある。
- **Implications**: 「認証情報なし」と「無効な認証情報」を同じに扱って後段に流すと、無効な PAT に cookie の利用者が重なって通ってしまう。次の Decision 5 の根拠になる。

---

## Design Decisions

### Decision 1: 認証情報のないクローンを受け付けない（共有のビューを残して履歴だけを断つ方法は採らない）

- **Alternatives Considered**:
  1. 認証情報のないクローンを受け付けない
  2. ゲスト用のビューだけ、毎回親なしの commit にする
- **Selected Approach**: 1。
- **Rationale**: 2 は、クローン済みのゲストの `git pull` が「無関係な履歴」として失敗するようになる。また、利用者を特定できない相手に内容を配る経路が残り、将来ビューの持ち方を変えたときに同じ種類の漏れを作りうる。1 は経路そのものをなくす。
- **Trade-offs**: ゲスト閲覧を許可しているサイトでも、クローンには PAT（つまりアカウント）が必要になる。

### Decision 2: 入口で拒否し、その先の型から `null` を消す

- **Alternatives Considered**:
  1. middleware の引数だけを変え、`userId: string | null` の型は残す
  2. 型を `string` にして、`null` の分岐をすべて消す
- **Selected Approach**: 2。
- **Rationale**: 1 では、`null` を受け取れる関数が残る。middleware の並びを変えたり、別の呼び出し元を足したりしたときに、利用者なしの経路が黙って復活しうる。2 は、その経路を型検査で止める（`.claude/rules/coding-style.md` の「Make Invalid States Unrepresentable」）。
- **Trade-offs**: `@growi/core` の型が変わるので、changeset が要る。

### Decision 3: 既存のゲスト用ビューは vault-manager の起動時に消す

選択肢と理由は `.kiro/specs/growi-vault-manager/research.md` の「Decision F: ゲスト用ビューの片付けは vault-manager の起動時に行う」に記録してある（片付けを動かすのが vault-manager のため）。

### Decision 4: 片付けが失敗しても、vault-manager は起動を続ける

理由は同じく `.kiro/specs/growi-vault-manager/research.md` の「Decision G: 片付けが失敗しても起動を続ける」に記録してある。gateway がゲストを通さないことが、この判断の前提である。

### Decision 5: 無効な認証情報の早期拒否は credential adapter に残す

- **Context**: PAT が無く、ログイン中のセッションも無いリクエストの 401 は `loginRequiredFactory(crowi, false, …)` が返す。では、無効な認証情報のリクエストも後段に流して同じ所で拒否できるのか。
- **Alternatives Considered**:
  1. 無効な PAT のときは credential adapter が、その場で 401 を返して終わる（`next()` を呼ばない）
  2. 無効な PAT は `req.user` を設定せずに後段へ流し、`loginRequiredFactory` に拒否させる
- **Selected Approach**: 1。
- **Rationale**: 2 は、セッション cookie 付きのリクエストで、passport が先に埋めた `req.user`（cookie の利用者）が残ったまま後段に進み、無効な PAT を送ったのに cookie の利用者として通る。PAT の検証が通らなかった時点で、そのリクエストは終わらせる必要がある。
- **Trade-offs**: 拒否の経路が複数（無効な認証情報、`loginRequiredFactory` の代替応答、handler が利用者を見つけられなかった場合）になる。

### Decision 6: 401 の応答と `VAULT_AUTH_FAILURE` の監査記録は 1 か所で組み立てる

- **Alternatives Considered**:
  1. 拒否する各地点で、401 の応答と監査記録を個別に書く
  2. `createVaultAuthChallenge`（`vault-auth-challenge.ts`）で一度だけ組み立て、各地点が呼ぶ
- **Selected Approach**: 2。無効な認証情報、`loginRequiredFactory(crowi, false, …)` の代替応答、handler が利用者を見つけられなかった場合の 3 地点が同じ関数を使う。
- **Rationale**: 応答（`401` と `WWW-Authenticate: Basic realm="GROWI Vault"`、本文なし）と監査記録（総当たりの検知に使う）が、どの拒否経路でも同じになることを構造で保つ。経路ごとに書くと、片方の経路だけ監査記録が欠けるなどの差が出やすい。

### Decision 7: 検証は「ゲストを通さないこと」を直接確かめ、閲覧設定の組み合わせは試験しない

- **Context**: ゲスト閲覧の設定（`security:wikiMode`・`restrictGuestMode` など）の組み合わせごとに試験を書くか。
- **Selected Approach**: 設定を変えた試験は書かない。gateway の単体試験で、「ゲストが閲覧できるサイトで、認証情報のないリクエストが、gateway の初期化が終わっていない間でも 401 になる」ことを確かめる。通してしまうと、初期化待ちの 503 になるので、拒否が先に行われていることが分かる。
- **Rationale**: ゲストを一切通さないので、これらの設定は読まれない。設定を変える試験は、読まれない値を動かすだけで何も検証しない。

### Decision 8: 認可は標準の middleware に任せ、gateway で判定し直さない（要件 11）

- **Context**: git smart HTTP は、認証情報の渡し方（HTTP Basic の password に PAT を入れる）がブラウザと違う。この違いに合わせるために、認可の判定まで gateway の中に書き直すか。
- **Alternatives Considered**:
  1. gateway の中で、資格情報の有無やゲスト閲覧の設定を見て、通すかどうかを決める
  2. 資格情報の渡し方の違いだけを credential adapter で吸収し、通すかどうかは `loginRequiredFactory` に任せる
- **Selected Approach**: 2。
- **Rationale**: 1 は GROWI 本体の判定と食い違う。実際に、adapter が「Authorization ヘッダーが無ければ public だけを返す」と自分で決めていた実装では、`security:restrictGuestMode='Deny'` のサイトでも、認証情報のない clone が public のページを受け取れた。判定を標準の middleware に任せれば、GROWI 本体の判定の変更が、gateway のコードを変えずに clone にも及ぶ。
- **Trade-offs**: 標準の middleware の振る舞い（`/login` へのリダイレクトなど）が git に合わない所は、`fallback` と credential adapter で個別に置き換える（要件 11.2）。

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 認証情報のないクローンに頼っていた利用者（CI など）が、更新後に失敗する | 401 と `WWW-Authenticate` を返すので、git が認証情報を尋ねる。リリースノートに、PAT を発行すればよいことを書く |
| apps/app と vault-manager を別々に更新する | どちらを先に更新しても、認証情報のない要求に内容は渡らない。apps/app だけが新しいとき、gateway は 401 を返し、残った `anonymous-view` はだれにも配られない（vault-manager を更新した後の起動で消える）。vault-manager だけが新しいとき、古い gateway が送る `userId: null` を controller が 400 で拒否し、gateway はそれを 502 として返す。`anonymous-view` は起動時に消える。そのため更新の順番は問わない |
| 更新の前に、認証情報なしでクローンされた内容 | 取り消せない。リリースノートに書く |
| 将来、だれかが認証情報のないクローンを足し直す | 型が `userId: string` なので、型検査で止まる。design.md の「再検証トリガー」に、先に決めるべきことを挙げている |

---

## References

- `.claude/rules/coding-style.md` — 「Make Invalid States Unrepresentable」
- `.kiro/specs/growi-vault-manager/research.md` — ゲスト用ビューの片付け、ref の削除方法
