# Research & Design Decisions — growi-vault-manager

> umbrella spec の `.kiro/specs/growi-vault/research.md` がアーキテクチャ全体の選定根拠（Decision 1–8）を持つ。本ファイルは vault-manager 実装フェーズ以降に判明した調査結果と、この spec の範囲で下した設計判断を記録する。

## Summary

実装後の調査で、要件 5.4 が前提にしていた「`uploadpack.allowAnySHA1InWant=false`（git の既定値）を維持すればビューに広告していない object は取得できない」が **commit にしか当てはまらない**ことが実測で判明した。umbrella の Decision 3（namespace モデル採用）が「namespace 分離で per-user の可視範囲を表現する」としていた前提のうち、**読み取りの遮断は git 側が提供していない**部分に相当する。対策として、upload-pack を起動する前に要求された object を検査する層を GitProxyController に置いた（要件 5.6–5.8）。

あわせて #11595（clone の転送量を絞る手段が README 通りに動かない）の残件として、転送量を絞る方式を決めた。git の絞り込み指定のうち `sparse:oid` だけが除外をサーバ側で適用して 1 リクエストで完結するため、上記の検査を無変更で通る。他の指定は object を ID で名指しする経路を必要とするため通らず、`uploadpack.allowFilter` が種類ごとに分けられないことから、受理してしまう分は同じ検査で拒否する（要件 5.9–5.11）。

---

## Research Log

### `GIT_NAMESPACE` は読み取りの隔離にならない（2026-07-28 実測 / git 2.49.0）

**調べた動機**: #11595（clone の転送量を絞る手段が README 通りに動かない）で、`--filter=blob:none` を有効化できるかを検討する過程で、要件 5.4 の保証範囲を確認する必要が生じた。

**方法**: 2 つのビュー（`nsA` / `nsB`）を持つ bare repo を作り、`spawnUploadPack()` と同じ形（`GIT_NAMESPACE=nsA` を設定した `git upload-pack --stateless-rpc`）で起動したプロセスの標準入力に、`nsB` 側の object の ID を「これが欲しい」という要求として送った。git の通信手順を直接組み立てるクライアント（Node で約 40 行）を用いた。

| 要求した object | 結果 |
|---|---|
| `nsA` の中のファイル 1 個の中身（ref では広告されていないもの） | 受け取れる |
| **`nsB` の中のファイル 1 個の中身** | **受け取れる。中身をそのまま復元できた** |
| **`nsB` のディレクトリ 1 個分の一覧** | **受け取れる** |
| **どの履歴からも参照されなくなった、消し忘れのファイルの中身** | **受け取れる** |
| `nsB` の commit | `ERR upload-pack: not our ref <ID>` で拒否される |

ディレクトリ 1 個分の一覧が取れると、そこに並んでいるファイル名（＝ページのパス）と各ファイルの中身の ID が得られるため、同じ手順の繰り返しで部分木を丸ごと読み出せる。

**原因**: git が「広告していない object を要求されたとき、それが本当にこのビューからたどれるか」を確かめる処理は commit を前提に作られており、ファイルの中身やディレクトリの一覧を渡された場合は実質的に何も確認しない。`GIT_NAMESPACE` は ref の広告範囲を絞るだけで、object の保管領域はビュー間で共有されたままである（この共有は同一本文の重複排除という設計上の利点でもある。umbrella Decision 4）。

**上流の位置づけ**: git 側は仕様通りの動作で、`gitnamespaces(7)` に明記されている。

> namespaces on a server are not effective for read access control; you should only grant read access to a namespace to clients that you would trust with read access to the entire repository.
>
> （サーバ上の namespace は読み取りのアクセス制御には有効ではない。namespace への読み取りを許すのは、リポジトリ全体の読み取りを許してよい相手だけにすべきである。）

したがって **git の設定変更では解決できない**。

**修正前の悪用条件**: 素の git コマンドでは踏めない。サーバが「広告していない object を要求してよい」という合図（`allow-reachable-sha1-in-want`）を出していないため、git クライアントが要求を送る前に自ら諦める（`error: Server does not allow request for unadvertised object <ID>`）。git の通信手順を直接扱うクライアントが必要で、サーバ側には拒否のログも残らなかった。`VAULT_ENABLED` は既定 false なので、影響は vault を明示的に有効化した環境に限られる。object の ID を知る必要があるが、以前アクセスできたときに clone して ID を控えていた元メンバー、public から非公開へ変更したページは現実的な経路である。他のビューから参照されている object は gc でも削除されない。

### 検査 1 回のコストと、規模が増えたときの挙動（実測）

20,000 ページ・1,001 commit のビューを持つ bare repo（view ref 5,000 本を含む）で計測。

| 測ったもの | 結果 |
|---|---|
| `merge-base --is-ancestor` — 正常な clone の要求 | 1〜2 ms |
| 同 — 1,001 commit 前の祖先（祖先判定の最悪ケース） | 2 ms |
| 同 — 他ビューの commit（非祖先の確定に commit を全走査） | 2 ms |
| 同 — blob / tree / 存在しない ID（commit でないので即失敗） | 1 ms |
| view ref を 5,000 本にしたときの検査 1 回 | 1 ms（変化なし） |
| 同条件の `upload-pack --advertise-refs`（既存経路） | 1 ms（変化なし） |

**規模が増えても悪化しない理由**: `merge-base` が読むのは commit だけで、tree も blob も開かない。したがってページ数は無関係。commit chain の長さは squash で有界（既定 1 時間 or 1000 commit、要件 6）。ビューの数（＝利用者数）は ref 名の解決だけに関わり、`packed-refs` の二分探索なので 5,000 本でも変わらない。長期運用で伸びるのは object の総数だが、commit の解決は pack index の探索 1 回で済む（loose object 蓄積による劣化は既存の gc が受け持つ）。

**未計測**: 同時 clone が多数走るときのスループット、GB 規模の object store（計測に用いた pack は 1.85 MiB）。前者は追加コストが POST 1 回あたり直列 1 プロセス（約 2 ms）で、同経路の `upload-pack` 本体（clone 1 回あたり数百 ms）より小さいという推論にとどまる。

### 要求件数による処理量の増幅（実測）

検査は要求 1 件ごとに git を 1 プロセス起動するが、**要求の件数を決めるのはクライアント**である。want 区間の上限 64 KiB には want 行が約 1,310 行入り、素朴に `Promise.all` で並列化した初版は 1 リクエストで **git プロセス 1,310 個の同時起動・1.3 秒**を引き起こせた（in-process カウンタで同時ピーク 1,310 を確認）。Decision C の上限を入れた後の実測:

| リクエストの形 | 所要 | git プロセス同時ピーク |
|---|---|---|
| 正常な clone（要求 1 件） | 5 ms | 1 |
| 同一 ID を 1,310 回 | 3 ms | 1 |
| 異なる ID を 1,310 件 | 0 ms（検査せず拒否） | 0 |
| 異なる ID を 64 件（上限ぎりぎり） | 141 ms | 1 |

### 転送量を絞る手段 — git の絞り込み指定の比較（2026-07-29 実測 / git 2.49.0）

**調べた動機**: #11595 の残件。README が案内していた 2 つの手段（`--filter=blob:none` と cone mode の sparse-checkout）がどちらも動かず、長く運用した wiki の clone を小さくする手段が実質存在しなかった。

**方法**: `wiki/` 配下 15,000 ページ ＋ `user/` 配下 5,000 ページを持つビュー（squash 後と同じ親なし commit 1 個）の bare repo を作り、GitProxyController と同じ形（`GIT_NAMESPACE` を設定した `git upload-pack --stateless-rpc`）で起動する最小の HTTP サーバに実際の `git clone` を当てて、サーバが書き出したバイト数・クライアントが送った本文・要求された object の件数を数えた。

| 手段 | HTTP のやりとり | クライアントが送る本文 | 要求 object 件数 | 転送量 | 削減 |
|---|---|---|---|---|---|
| 通常の clone | 1 回 | 183 B | 1 | 6,269,214 | — |
| `--filter=blob:none` ＋ sparse-checkout | 2 回 | 210 B → **359,260 B（圧縮済み）** | 1 → **15,000** | 4,815,233 | 23.2% |
| **`--filter=sparse:oid=<blob>` ＋ sparse-checkout** | **1 回** | **252 B** | **1** | 4,815,099 | 23.2% |
| `user/` を外したビュー用ブランチを配る（採用せず） | 1 回 | 195 B | 1 | 4,690,525 | 25.2% |
| `--depth=1` | 1 回 | — | — | 削減なし | — |

**分かったこと 3 点**:

1. **`blob:none` の 2 回目のリクエストは圧縮されて届く。** git クライアントは HTTP リクエスト本文が大きいと `Content-Encoding: gzip` を付ける（750,160 B → 359,260 B）。マージ済みの `parseWantSection` に実物を通すと、圧縮された形は `malformed pkt-line length prefix`、展開した形も `want section exceeds the size a git client would send`（64 KiB 上限）で拒否される。`upload-pack` 自身も圧縮された本文は読めず `fatal: protocol error: bad line length character` で落ちるため、通すなら proxy 側での展開が前提になる。
2. **`sparse:oid` は遅延取得を発生させない。** 除外がサーバ側で適用されるため、クライアントは 1 回目の応答で checkout に必要なものを全部受け取る。要求は commit 1 件で、マージ済みの検査をそのまま通る（実物の本文 252 バイトを `parseWantSection` に通して `complete` / want 1 件を確認）。必要なサーバ設定は `uploadpack.allowFilter=true` のみで、`allowReachableSHA1InWant` は不要。
3. **`allowFilter` を有効にすると `blob:none` の失敗の仕方が悪化する。** 有効化前は `warning: filtering not recognized by server, ignoring` で全量転送になり、clone は使える状態で終わる。有効化後（かつ object を ID で名指しする経路を許さない状態）では `error: Server does not allow request for unadvertised object <ID>` が数千行続いたのち `warning: Clone succeeded, but checkout failed.` で終了コード 128・作業ツリー 0 件になる。

**副産物 2 点**:

- `--filter=sparse:oid` に他人のページの blob を指定すると応答サイズが変わる（正規のパターン 4,815,099 B / 他人のページを指定 488,217 B / 何にも一致しないパターン 488,167 B）。object の ID を知っている相手に、その内容についてのわずかな手がかりを与える。
- `sparse:path`（サーバ上のパスをクライアントが指定する形式）は git 側で削除済み（`fatal: sparse:path filters support has been dropped`）。同じ理由（クライアントがサーバ上の任意のファイルを名指しできる）による。

---

## Design Decisions

### Decision A: ビュー外 object の要求は proxy 層で拒否する

- **Context**: 上記 Research Log の通り、git の設定では blob / tree の取得を止められない。要件 3（他ユーザの非公開ページの内容や存在が leak しない）を満たす手段が必要
- **Alternatives Considered**:
  1. **GitProxyController が要求を検査する** — 要求を upload-pack に渡す前に解析し、ビューからたどれない object の要求を拒否
  2. object の保管領域の共有をやめ、ビューごとに独立させる — 確実だが保存容量がビュー数に比例し、umbrella Decision 4（content-addressed な重複排除）の前提を捨てる
  3. 制約として受け入れ、「vault の読み取り権限は bare repo 全体の読み取り権限と同じ」と明示する — 要件 3 の目的を諦めることになる
- **Selected Approach**: 案 1。要求の先頭（want 区間）のみを解析し、要求された各 object について `git merge-base --is-ancestor <要求された ID> refs/namespaces/<viewRef>/refs/heads/main` を実行、非ゼロ終了なら upload-pack を起動せず pkt-line 1 本の `ERR` を返す
- **Rationale**: この 1 コマンドで、commit でないもの（blob・tree）・他ビューの commit・存在しない ID・ビュー ref 自体が無い場合のすべてが拒否側に落ちる（閉じる方向に倒れる）。要件 5.3（pack をメモリに溜めず一定量のメモリで転送する）も、解析対象を先頭に限れば保てる（実測で 183〜345 バイト）
- **Trade-offs**: partial clone の遅延取得（ファイル単体の要求）が拒否される。`uploadpack.allowFilter` を有効にするならこの検査の拡張が前提（#11595）。protocol v2 の本文は解釈せず拒否するため、gateway が `Git-Protocol` ヘッダを転送するようになる場合も拡張が前提
- **Follow-up**: 上記 2 点は design.md の Revalidation Triggers に登録済み

### Decision B: 判定は「広告した ID と一致」ではなく「ビュー ref からたどれるか」

- **Context**: 拒否の条件として「広告した commit の ID と完全一致」を採る案があった
- **Alternatives Considered**:
  1. 広告した ID との完全一致 — 実装は最も単純
  2. **ビュー ref からの到達性（ancestry）** — 少し古い commit も許す
- **Selected Approach**: 案 2
- **Rationale**: 広告（`GET info/refs`）と本文送信（`POST git-upload-pack`）は別リクエストで、POST 側でも compose-view が走るためその間にビュー ref が動きうる。完全一致だと、この間に更新が入った正当な fetch を壊す。到達性判定なら少し古い commit も通り、squash で親なし commit に切り替わった場合は従来どおり（git 自身も拒否する状態）に一致する
- **Trade-offs**: 判定に commit chain の走査が入るが、squash により有界（Research Log の実測で最悪 2 ms）

### Decision C: 検査の作業量に上限を設ける（重複排除・64 件・直列）

- **Context**: 要求件数はクライアントが決められ、1 件ごとに git プロセスが必要（Research Log の増幅の実測）
- **Alternatives Considered**:
  1. `Promise.all` で並列実行（初版）— 1 リクエストで 1,310 プロセス
  2. 同時実行数に上限を設ける（並列度 N）
  3. **重複 ID の排除 ＋ 異なる ID の件数上限 ＋ 直列実行**
- **Selected Approach**: 案 3。同一 ID は 1 回に畳み、異なる ID が 64 件を超えるリクエストは 1 件も検査せず拒否し、残りは直列に確認する
- **Rationale**: ビューが広告するのは commit 1 個（と HEAD）で、full clone / shallow clone / 差分 fetch はいずれも実測で要求 1 件。64 は実用の 30 倍以上の余裕。直列にすれば同時に走る git プロセスは 1 個に収まり、並列度の調整パラメータも増えない
- **Trade-offs**: 上限内の最悪ケース（異なる ID 64 件）は直列で 141 ms かかる。正当な利用では起こらない形

### Decision D: 転送量削減は `sparse:oid` で行う

- **Context**: #11595。転送量を絞る手段が実質存在しない状態で、方式の選択が未決だった
- **Alternatives Considered**:
  1. `blob:none` を通す — 検査に 3 つの拡張が必要（本文の展開、want 区間 64 KiB と異なる ID 64 件の上限引き上げ、到達性の確認を「そのビューから使われている object を全列挙して照合する」形へ差し替え）。除外パスをクライアントが自由に選べる利点はあるが、マージ直後のセキュリティ経路に手を入れることになり、要件 5.3 の「一定量のメモリ」がビュー規模に比例する形（1 リクエスト 1 MB 前後）に変わる
  2. **`sparse:oid` を通す** — サーバ設定 1 行（`allowFilter`）とパターン集合の公開のみ。要件 5.6–5.8 の検査は無変更で通る
  3. `user/` を外したビュー用ブランチを配る — 削減幅は最大（25.2%）でクライアントの手順も最短（`--single-branch --branch <名前>`）だが、git の標準の仕組みではなく VaultViewComposer にブランチ生成を足す必要があり、検査も「ビュー内のどのブランチからたどれるか」に広げる必要がある
  4. 何もせず README に非対応と明記する（#11605 の当初案）
- **Selected Approach**: 案 2
- **Rationale**: git の標準の仕組みのまま成立し、セキュリティ経路（要件 5.6–5.8）に一切手を入れずに済むことを実物のリクエスト本文で確認できた。削減幅は案 3 と 2 ポイント差で、案 1 と同等
- **Trade-offs**: 除外できるのはサーバが公開したパターン集合だけ（現在 1 つ）。filter を付けた clone は partial clone として記録され、除外したページを後から取得することはできない（`allowReachableSHA1InWant` を有効にしないため、クライアントの手前で止まる）

### Decision E: 公開していない絞り込み指定は clone の時点で拒否する

- **Context**: `uploadpack.allowFilter` は指定の種類ごとに分けられないため、有効にすると `blob:none` も受理される
- **Alternatives Considered**:
  1. 放置する — clone は成功し checkout が失敗、作業ツリーは空（Research Log の 3 点目）。有効化前の「無視されるが動く」より悪化する
  2. **want 区間の `filter` 行を検査し、公開した `sparse:oid` 以外を拒否する**
- **Selected Approach**: 案 2。既存の検査と同じ場所（upload-pack 起動前）で判定し、pkt-line 1 本の `ERR` に対応している指定の形を書いて返す
- **Rationale**: clone の時点で 1 行で止まり、次に何をすればよいかが分かる。同じ判定が、公開していない object を `sparse:oid` に指定して応答サイズの差から内容を推し量る余地も塞ぐ
- **Trade-offs**: 応答の文言がサーバの対応状況を明かす。ただしこれはリポジトリの保持内容ではないため要件 2.3 には触れない

---

## 実装知見（Post-Implementation Discoveries）

### リクエスト本文の先頭を読むとき、ストリームを閉じてはいけない

検査のために本文の先頭を読む必要があるが、本文は upload-pack に**そのまま全部**渡さなければならない。`for await` で読むと、途中で抜けた時点でストリームが閉じられ、want 区間の後ろにある negotiation（`done` 等）が失われる。結果として upload-pack が入力待ちのまま応答せず、**shallow clone がハングした**（試作段階で実際に踏んだ）。

対処は、`pause()` で読み取りを止めて listener を外し、読み取った先頭を `spawnUploadPack({ stdinPrefix })` で書き戻してから残りを pipe する形。回帰試験は「読み取った先頭 ＋ 残り == 元の本文」という等式で固定した（`vault-want-guard.spec.ts`）。

### 拒否は HTTP 200 ＋ pkt-line 1 本の `ERR` で返す

upload-pack 自身が拒否時に返す形と同じなので、git クライアントは `fatal: remote error: <message>` と表示する。HTTP 4xx で返すと gateway が 502 に変換し（`proxyResult.status >= 400` の分岐）、クライアントには通信障害として見えて原因が分からなくなる。文言は「ビューに無い」と「そもそも存在しない」で共通にし、リポジトリが何を保持しているかを応答から推測できないようにする（要件 2.3）。

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 検査を通さず `spawnUploadPack` を 'rpc' で呼ぶ実装が将来追加される | spawner の冒頭コメントで検査必須を明示。要件 5.6 として受け入れ基準化 |
| `uploadpack.allowReachableSHA1InWant` を有効化して object を ID で名指しできるようにする | design.md の Revalidation Triggers に登録。要件 5.6 の検査を blob / tree の到達性まで拡張することが前提（Decision D の案 1） |
| 公開する sparse filter のパターンを変えて README を直し忘れる | パターンから object ID を計算する単体テストが README を突き合わせる（`vault-sparse-filter.spec.ts`） |
| gc が公開した filter の blob を消し、README の clone コマンドが解決できなくなる | `refs/vault/sparse-filters/<name>` から参照させ、起動ごとに再設置する。ref 経由の blob が `gc --prune=now` を越えて残ることを単体テストで固定 |
| protocol v2 を通すと本文が解釈できず全拒否になる | 同上。gateway が `Git-Protocol` を転送しない現状が前提条件であることを明記 |
| git の内部挙動（commit の到達性判定）に依存している | 到達性判定は自前の `merge-base` で行い、git 側の暗黙の挙動には依存しない。他ビューの commit 拒否は結合試験で固定 |

---

## References

- [gitnamespaces(7)](https://git-scm.com/docs/gitnamespaces) — namespace が読み取りのアクセス制御に使えないことの上流記述
- [git http-protocol](https://git-scm.com/docs/http-protocol) — want 区間を含む smart HTTP のリクエスト形式
- `.kiro/specs/growi-vault/research.md` — umbrella のアーキテクチャ選定根拠（Decision 3: namespace モデル採用 / Decision 4: view ref の合成）
- GitHub issue #11595 — 転送量削減の手段（partial clone / sparse-checkout）と本件の関係
