# Research & Design Decisions — growi-vault-manager

> umbrella spec の `.kiro/specs/growi-vault/research.md` がアーキテクチャ全体の選定根拠（Decision 1–8）を持つ。本ファイルは vault-manager 実装フェーズ以降に判明した調査結果と、この spec の範囲で下した設計判断を記録する。

## Summary

実装後の調査で、要件 5.4 が前提にしていた「`uploadpack.allowAnySHA1InWant=false`（git の既定値）を維持すればビューに広告していない object は取得できない」が **commit にしか当てはまらない**ことが実測で判明した。umbrella の Decision 3（namespace モデル採用）が「namespace 分離で per-user の可視範囲を表現する」としていた前提のうち、**読み取りの遮断は git 側が提供していない**部分に相当する。対策として、upload-pack を起動する前に要求された object を検査する層を GitProxyController に置いた（要件 5.6–5.8）。

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
| `uploadpack.allowFilter` を有効化して partial clone を通そうとする | design.md の Revalidation Triggers に登録。検査の拡張が前提であることを #11595 側にも記録 |
| protocol v2 を通すと本文が解釈できず全拒否になる | 同上。gateway が `Git-Protocol` を転送しない現状が前提条件であることを明記 |
| git の内部挙動（commit の到達性判定）に依存している | 到達性判定は自前の `merge-base` で行い、git 側の暗黙の挙動には依存しない。他ビューの commit 拒否は結合試験で固定 |

---

## References

- [gitnamespaces(7)](https://git-scm.com/docs/gitnamespaces) — namespace が読み取りのアクセス制御に使えないことの上流記述
- [git http-protocol](https://git-scm.com/docs/http-protocol) — want 区間を含む smart HTTP のリクエスト形式
- `.kiro/specs/growi-vault/research.md` — umbrella のアーキテクチャ選定根拠（Decision 3: namespace モデル採用 / Decision 4: view ref の合成）
- GitHub issue #11595 — 転送量削減の手段（partial clone / sparse-checkout）と本件の関係
