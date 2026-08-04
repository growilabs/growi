# Gap Analysis: drawio

実施日: 2026-08-04 / 対象: `.kiro/specs/drawio/requirements.md`（要件 10 件）

## この gap 分析の位置づけ

この spec は **as-built**（今あるものを記述する保守用 spec）なので、通常の gap 分析とは向きが逆になる。要件を満たす実装はほぼ既に存在し、探すべき差は次の 3 種類である。

| 差の種類 | 意味 | 直し方 |
|---|---|---|
| **要件の書き間違い** | 要件が実装と違うことを書いている | 要件を直す（実装は変えない） |
| **テストの穴** | 実装はあるが、壊れても落ちるテストが無い | 要件 9 の AC 5 に従って記録する。テスト追加は将来課題 |
| **未作成** | 実装・文書がまだ無い | この spec の tasks で作る |

**書き間違いを 3 件、テストの穴を 1 件（当初の想定より大きい）、未作成を 3 件**見つけた。以下に詳細を記す。

## 1. 現況の調査

### 既にある資産

| 資産 | 場所 | 行数 |
|---|---|---|
| 自前ホスト判定 | `features/drawio/is-self-hosted-drawio.ts` | 19 |
| 参照先・proxy 経路の定数 | `features/drawio/consts.ts` | 41 |
| 公開 API（2 つの入口） | `features/drawio/client/self-hosted/index.ts` | 36 |
| 読み込み前の参照先差し替え | `.../rebase-asset-paths.ts` | 48 |
| MathJax の付け替え | `.../adopt-mathjax.ts` / `.../relocate-math-url.ts` | 59 / 25 |
| draw.io グローバルの型 | `.../drawio-globals.ts` | 46 |
| 図資産の配信 | `features/drawio/server/routes/drawio-assets.ts` | 258 |
| 保守情報 | `.../self-hosted/README.md` | 147 |
| ビューアのスクリプト挿入 | `components/Script/DrawioViewerScript/` | — |
| ビューア本体・再描画の判定 | `packages/remark-drawio/src/components/` | — |
| 保存形式 | `packages/remark-drawio/src/utils/mxfile.ts` | — |
| エディタ URL / 注入 CSS / postMessage | `client/components/PageEditor/DrawioModal/` | — |

### 確認できた構造上の性質

- **自前ホスト判定の呼び出しは 2 か所だけ** — `features/drawio/client/self-hosted/index.ts`（2 箇所の早期 return）と `features/drawio/server/routes/drawio-assets.ts`（1 箇所）。どちらも同じ `isSelfHostedDrawio` を使っており、要件 8 の AC 4 は現状成り立っている。
- **ビューアのスクリプトは共有ページにも入る** — `pages/[[...path]]`、`pages/share/[[...path]]`、`pages/_private-legacy-pages`、`pages/_search` の 4 か所が `DrawioViewerScript` を描いている。要件 2 の AC 3（未ログイン閲覧者）は経路として成り立っている。
- **図資産の配信は認証を通らない** — `server/routes/index.js` で `app.use(DRAWIO_ASSET_PROXY_PATH, drawioAssetsRouterFactory())` としてマウントされ、認証系の middleware を挟んでいない。要件 3 の AC 9 のとおり。
- **配信は許可リストを 2 段で持つ** — ディレクトリ（`stencils` / `shapes` / `styles`）と拡張子（`.xml` / `.js` / `.css` / `.png` / `.ttf`）の組み合わせを正規表現で判定し、そのうえで `readAsset` が要求の直前に「渡された範囲の内側か」を再確認する。範囲の確認が 2 か所にあるのは意図的（コメントに理由が書かれている）。

## 2. 要件と実装の対応（Requirement-to-Asset Map）

凡例: **○** 実装あり・テストあり / **△** 実装あり・テストなし / **×** 未作成 / **!** 要件の書き間違い

| 要件 | 判定 | 実装 | テスト |
|---|---|---|---|
| 1. 数式の描画 | ○△ | `adopt-mathjax.ts` / `relocate-math-url.ts` | 単体は充実。「実際に描画される」（AC 1・3・4）は手動確認のみ |
| 2. 図形の描画 | ○△ | `rebase-asset-paths.ts` + 配信ルート | 単体は参照先の差し替えのみ。「実際に描画される」「外部要求が出ない」（AC 1・2・3）は手動確認のみ。AC 5（両方失敗時に描画を続ける）は未検証 |
| 3. 配信経路の安全性 | ○△! | `drawio-assets.ts` | **判定関数のみテスト済み。ルータの応答は 1 件もテストが無い**（下記 2.1）。AC 1・6・7 は書き間違い（下記 3） |
| 4. メニューが読める | ○△ | `drawio-config.ts` | 構造の不変条件はテスト済み（mutation 確認済み）。AC 2 の「判読できる」は実測（コントラスト比 1.05 → 修正後）で確認したが自動テストは無い |
| 5. `DRAWIO_URI` の尊重 | ○! | `build-drawio-editor-url.ts` | 4 件すべてテスト済み。ただし AC 4 は実装の振る舞いに注意点あり（下記 3.3） |
| 6. 保存で情報が失われない | ○△ | `mxfile.ts` / `DrawioCommunicationHelper.ts` | AC 1〜4 テスト済み。AC 5（発信元照合）はテスト無し |
| 7. ページ送り | ○△ | `should-rerender-on-resize.ts` | 判定関数はテスト済み。AC 1（実際に送った先が保たれる）は手動確認に回っている |
| 8. 既定構成の無変化 | ○△ | `is-self-hosted-drawio.ts` + 各早期 return | AC 1・3 テスト済み。AC 2 は手動確認。AC 4（同一基準）は現状成立だが drift を防ぐテストが無い |
| 9. 保守情報の所在 | × | — | `design.md` 未作成 / `features/drawio/CLAUDE.md` 未作成 / README（147 行）が残っている |
| 10. 検証手順 | × | — | README に検証手順はあるが spec に無い |

### 2.1 テストの穴（当初の想定より大きい）

> **この節は 2 つの点で古い。正は「担保テストの突き合わせ（タスク 1.2）」（この文書の末尾）である。**
>
> 1. **下の表の「リダイレクトを追わないこと」は誤り** — 実際にはテストが存在する（`drawio-assets.spec.ts` の `readAsset` に 302 を返す fixture があり、`redirect: 'manual'` を `follow` に変えると落ちる）。タスク 1.2 の突き合わせで判明した。この行を根拠に「リダイレクトは未検証」と書き直さないこと。
> 2. **下の表の AC 番号は要件 3 の再採番前のもの** — この節を書いたあとにフォールバックの AC を独立させたため、番号が 1 つずれている（表の AC 6→3.6、AC 7→3.7、AC 8→3.9、AC 9→3.10）。番号での突き合わせには使えない。
>
> ルータ本体を呼ぶテストが 1 件も無いという主旨そのものは変わらない。

要件を書いた時点では「要件 3 の AC 5〜8 にテストが無い」と記録したが、実際に spec ファイルを確認したところ **`drawioAssetsRouterFactory` を呼ぶテストは 1 件も存在しない**（`drawio-assets.spec.ts` の import は `proxiableAssetExtension` / `resolveAsset` / `readAsset` の 3 つのみ、ルータ本体の参照は 0 件）。

つまり、テストされているのは「どのパスを許すか」「どの取得先に解決するか」「バイト列がそのまま通るか」という**判定と取得の部品**だけで、**ルータの応答そのもの**は一切検証されていない。

| 検証されていること | 検証されていないこと |
|---|---|
| 許可された形の判定（`proxiableAssetExtension`） | 許可外パスで実際に 404 が返り、外部要求が出ないこと（AC 2） |
| 取得先の解決と範囲外の拒否（`resolveAsset`） | 範囲外で実際に 404 が返ること（AC 3） |
| 要求時点での範囲の再確認（`readAsset`） | 応答の Content-Type が拡張子から決まること（AC 4） |
| バイト列がそのまま通ること（`readAsset`） | `X-Content-Type-Options: nosniff` が付くこと（AC 5） |
| 到達不能なときに例外を投げないこと | リダイレクトを追わないこと（AC 6） |
| — | 時間・サイズの上限（AC 7） |
| — | 既定構成で 404 になり外部要求が出ないこと（AC 8） |
| — | 認証を通らずに到達できること（AC 9） |

要件 3 の担保テスト行はこの実態に合わせて直す必要がある（要件 9 の AC 5 が「担保が無いものは無いと明記する」ことを求めているため、過小申告は要件違反になる）。

## 3. 見つかった要件の書き間違い（要件を直す）

### 3.1 要件 3 AC 1 — 取得先は設定値だけではない

**要件の記述**: 「取得先のホストを GROWI の設定値からのみ決定し、リクエストに含まれる値からは決定しない」

**実装**: 取得先は 2 つある。設定値 `app:drawioUri` から解決した先（`onInstance`）と、コードに定数として書いた draw.io 本家（`VIEWER_DIAGRAMS_NET_ORIGIN`、`onDrawio`）。前者が資産を返せないときに後者を試す。どちらもリクエストからは決まらないので**守りたい性質は成り立っている**が、「設定値からのみ」という書き方は後者を落としている。

**直し方（案）**: 「取得先は GROWI の設定値から解決した先、またはコードに定めた draw.io 本家のいずれかに限られ、リクエストに含まれる値からは決まらない」

### 3.2 要件 3 AC 6・AC 7 — リダイレクト・上限超過でも「配信しない」とは限らない

**要件の記述**: AC 6「リダイレクトを返す → 追随せず、その資産を配信しない」/ AC 7「時間・サイズの上限を超える → その資産を配信しない」

**実装**: 設定済みインスタンスからの取得が失敗（3xx を含む・時間切れ・サイズ超過のいずれでも）したとき、**続いて draw.io 本家へのフォールバックを試みる**。本家から取れれば資産は配信される。両方が失敗したときにはじめて 502 を返す。

つまり守られている性質は「リダイレクト先を追いに行かない」「上限を超えた応答をそのまま流さない」であって、「その資産を配信しない」ではない。

**直し方（案）**: AC 6「リダイレクト先を追わず、その取得を失敗として扱う」/ AC 7「その応答を配信せず、その取得を失敗として扱う」。加えて「設定済みインスタンスからの取得が失敗したときは、コードに定めた draw.io 本家からの取得を試み、それも失敗したときに 502 を返す」を AC として独立させる（現状の要件 2 AC 4・AC 5 と重ならないよう、要件 2 は「利用者に何が見えるか」、要件 3 は「配信経路が何をするか」で切り分ける）。

### 3.3 要件 5 AC 4 — 失敗するが、利用者には何も伝わらない

**要件の記述**: 「`DRAWIO_URI` が URL として解釈できない → 呼び出し元が失敗として扱える形で報告する（黙って既定値で続行しない）」

**実装**: `buildDrawioEditorUrl` は投げる（テスト済み）。`DrawioModal` はそれを `try`/`catch` で受け、`logger.debug(err)` を残して `undefined` を返す。結果、iframe は描かれず、**モーダルはローディング表示のまま止まる**。

要件の字面（既定値で続行しない）は満たしている。ただし観測される結果は次のとおりで、要件が意図した水準に届いているか判断が必要。

- 利用者には「読み込み中」に見えたまま、理由が伝わらない
- `debug` レベルなので、既定のログ設定では運用者のログにも出ない

**判断が必要な点**: これは挙動を変える話（利用者への通知を追加する）なので、**この spec の対象外**（Out of scope に「コードの挙動を変える修正」と明記済み）。取り得る扱いは 2 つ。

- (a) 要件 5 AC 4 は現状の実装を正しく記述しているものとして残し、**「失敗が利用者に伝わらない」ことを要件 9 AC 6 の将来課題に加える**（推奨）。
- (b) 要件 5 AC 4 を「利用者に理由が伝わる形で示す」に強め、この spec を挙動変更込みにする（性格の変更にあたるため、ユーザーの判断が必要）。

### 3.4 要件 8 AC 4 — 成り立っているが、崩れても気づけない

**要件の記述**: 「自前ホストかどうかの判定を、ビューア側と配信側で同一の基準で行う」

**実装**: 呼び出しは 2 か所だけで、いずれも同じ `isSelfHostedDrawio` を使う。現状は成立。

**穴**: 片方が独自判定に置き換わっても落ちるテストが無い。これは書き間違いではなく**テストの穴**なので、要件の担保テスト行にその旨を書き、テスト追加は将来課題とする（この種の drift テストの書き方は `apps/app/.claude/rules/server-boot-imports.md` に前例がある）。

## 4. 未作成のもの（この spec の tasks になる部分）

| 成果物 | 現状 | 内容 |
|---|---|---|
| `.kiro/specs/drawio/design.md` | 無い | README（147 行）の内容 + PR #11633 本文の根本原因 + 関心マップ + 検証手順 |
| `apps/app/src/features/drawio/CLAUDE.md` | 無い | spec への誘導。`features/drawio/` の外のコードも spec の関心マップで辿れることを書く |
| `README.md` の削除 | 147 行が残っている | design.md への移設が済んだあとに削除 |

**順序の制約**: design.md への移設 → README 削除。逆順にすると根拠が失われる。tasks でこの順序を固定する必要がある。

## 5. 実装アプローチの選択肢

未作成の 3 点をどう作るかについて。

### Option A: design.md に全部集約する（README の内容 + PR 本文 + 関心マップ + 検証手順）

- **どう作るか**: design.md を 1 本の文書とし、`## 関心マップ` `## 機構と理由` `## 検証手順` `## 将来課題` の節を持たせる。`CLAUDE.md` は 20〜30 行の誘導だけにする。
- ✅ 探し先が 1 つ。README が 1 ファイルで完結していた性質をそのまま引き継げる
- ✅ spec の標準の並び（requirements / design / tasks）から外れない
- ❌ design.md が長くなる（README 147 行 + PR 本文相当 + 関心マップで 400 行超の見込み）
- **規模**: S

### Option B: design.md と research.md に分ける（設計判断と調査記録を分離）

- **どう作るか**: design.md は「今どういう形か」に絞り、「なぜ他の形を採らなかったか」（MathJax の二重起動、`libraries` 書き換えが効かない理由、CORS）は research.md（この文書）に追記して残す。
- ✅ design.md が読みやすい長さに収まる
- ❌ **この spec の目的に反する。** 根拠が 2 ファイルに分かれるのは、いま README と PR 本文に分かれているのと同じ問題の作り直しになる
- ❌ `CLAUDE.md` からの誘導先が 2 つになる
- **規模**: S

### Option C: design.md を主とし、検証手順だけ別ファイルに切り出す

- **どう作るか**: design.md に機構・理由・関心マップを置き、検証手順は実行できる形（docker のコマンド、見るべき箇所）で `verification.md` に切り出す。
- ✅ 検証手順は「読む」ではなく「なぞる」文書なので、性質が違うものを分けられる
- ✅ design.md の長さが抑えられる
- ❌ spec の標準の並びに無いファイルが増える。他 spec に前例が無い
- ❌ 要件 10 は検証手順を「spec が持つ」ことを求めており、どちらでも満たすが、探し先が増える
- **規模**: S

### 推奨

**Option A**。この spec の目的が「根拠の置き場所を 1 つにする」ことなので、分けることそれ自体が目的に反する。design.md が長くなるのは、節見出しと関心マップの表で辿れるようにすれば受け入れられる。README が 147 行で成立していたことも、1 ファイルで足りる根拠になる。

## 6. 規模と危険度

| 項目 | 評価 | 理由 |
|---|---|---|
| **規模** | **S**（1〜3 日） | 文書の作成と 1 ファイルの削除のみ。コードの変更が無い。一次情報（README・PR 本文・PrimaVista の記録）は揃っており、調べ直しが不要 |
| **危険度** | **Low** | 挙動を変えないため回帰の余地が無い。唯一の危険は「README を消したのに内容が design に移っていない」で、tasks の順序で防げる |

要件の書き間違い 3 件の修正も含めて S / Low。

## 7. Research Needed（設計フェーズへ持ち越す）

- **要件 3 の再構成**: 3.1 と 3.2 の直し方を要件に反映するとき、要件 2（利用者に何が見えるか）と要件 3（配信経路が何をするか）の切り分けを崩さないこと。フォールバックの記述が両方に重複しやすい。
- **関心マップの粒度**: brief.md の 17 行の表をそのまま design に持ち込むか、`features/drawio/` の内と外で分けるか。`CLAUDE.md` から辿る導線として使えることが条件。
- **`CLAUDE.md` の配置**: `features/drawio/CLAUDE.md` に置くと、Claude Code は `features/drawio/` 配下のファイルを触るときに読む。しかし関心マップが指す先の半分は `features/drawio/` の外（`DrawioModal`、`packages/remark-drawio`、`packages/editor`）にあり、そこを触るときには読まれない。**外側にも導線が必要かどうか**は設計で決める（例: `packages/remark-drawio` 側にも 1 行の誘導を置く、あるいは `apps/app/AGENTS.md` の表に 1 行足す）。
- **検証手順の粒度**: PR #11633 の検証表（6 ケース）をそのまま持ち込むか、再現手順（`docker run` の 2 行 + 見るべき 3 点）に圧縮するか。要件 10 の AC 5 は「何を見れば合否が分かるか」を求めている。
- **未チェックの手動確認**: PR #11633 の「手動確認をお願いしたい点」に **サブパス構成（`http://example.com/drawio` など）での描画**が未チェックで残っている。要件 1 AC 5 と要件 2 AC 6 がこれに対応する。単体テストはサブパスの保持を確認しているが、実ブラウザでの確認は済んでいない。

## 8. 設計フェーズへの申し送り

1. **先に要件を直す**。3.1・3.2 は実装の記述として誤っているので、design を書く前に requirements を修正する。3.3 は将来課題行き（推奨は (a)）、3.4 は担保テスト行の修正。
2. **要件 3 の担保テスト行を実態に合わせる**。「AC 5〜8 にテストが無い」ではなく「ルータの応答を検証するテストが 1 件も無い（判定関数のみテスト済み）」が正しい。
3. **design は Option A（1 本に集約）**。
4. **tasks は 2 つ + 順序の固定**。design.md への移設 → README 削除 → `CLAUDE.md` 追加。README 削除を先にしない。
5. **将来課題に積むもの**（この spec では直さない）: 配信ルータの応答テスト、発信元照合のテスト、自前ホスト判定の drift テスト、`DRAWIO_URI` 不正時に利用者へ伝わらないこと、サブパス構成での手動確認、既に brief に記録済みの 5 件（CodeQL 2 件、v28 系の stencil、`PROXY_URL`、`offline=1`、責務再配置）。

---

# Design Discovery & Synthesis: drawio

実施日: 2026-08-04 / 対象: `design.md` の生成

## Discovery の種類と範囲

**light（既存システムへの追加）** を適用した。理由: 記述対象の実装はすべて既にリポジトリ内にあり、外部技術の選定が無い。gap 分析（この文書の前半）でコード側の調査は済んでいたため、design 生成時の追加調査は「契約を正確に書くためのソース読み」に限った。

追加で読んだもの: `client/self-hosted/` の全 5 ファイル（`index.ts` / `rebase-asset-paths.ts` / `adopt-mathjax.ts` / `relocate-math-url.ts` / `drawio-globals.ts`）、`drawio-assets.ts` の全体、`DrawioModal.tsx`。

## Discovery で新たに判明したこと

### 要件に無い挙動が 1 つあった（要件へ追加）

`rebaseDrawioAssetPaths` は 7 つのグローバルを書き換えているが、要件が触れていたのは 6 つだった。**`DRAWIO_LIGHTBOX_URL`**（図を拡大表示したときの「編集」導線の宛先）が漏れていた。

as-built spec で実装の挙動が要件に無いのは、そのまま「記述の穴」になる。要件 2 に AC 7 として追加した（`Where 自前ホストの draw.io が設定されている, when 図を拡大表示（ライトボックス）したとき, the GROWI のビューア shall 編集への導線を設定済みインスタンスへ向ける`）。

### 依存の向きが設計上の要点だった

`consts` → `isSelfHostedDrawio` → { client, server } → { 呼び出し側 } の一方向で、**client と server は互いを import しない**。この形が「判定を 1 つに保ちながら client と server を分ける」ことを可能にしている（要件 8.4 の実現手段）。design の Architecture 節に依存の向きとして明記した。

### ホストは検査ではなく構造で固定されている

`resolveAsset` が `new URL(assetPath, subtree)` ではなく `target.pathname` への代入を使っているのは、前者だと `//elsewhere/x` や `http://elsewhere/x` が authority として解釈されて別ホストへ移るためである。代入ならホストは `assetPath` から読まれないので、**どんな値でもホストを動かせない**。コード中のコメントにあった判断で、SSRF 対策の核心なので design の Security Considerations に上げた。

## Synthesis の結果

### 一般化: 「後から直せない」を 1 つの節にまとめた

MathJax の二重起動と stencil の `libraries` 書き換えは、issue も症状も別（#9774 と #10726）だが、**構造は同じ**である。どちらも「バンドルが評価される前に決まってしまうものを、後から直そうとして失敗した」話であり、どちらも一度実装してから実測で否定している。

当初は要件ごとに分けて書こうとしたが、共通の構造を 1 つの節（`なぜ後から直せないのか`）にまとめた。理由: 次に draw.io のバージョンが上がったとき、開発者が学ぶべきは個別の症状ではなく**この構造**である。分けて書くと同じ罠に別の形で落ちる。

### 採用: 1 ファイル集約（gap 分析の Option A）

gap 分析で挙げた 3 案のうち Option A を採用。決め手は「この spec の目的が根拠の置き場所を 1 つにすることなので、分けること自体が目的に反する」。結果 773 行になったが、節見出しと関心マップの表で辿れるため許容と判断した（README が 147 行で成立していたことも根拠）。

### 判断: `packages/*` に spec への入口を置かない

gap 分析で「Research Needed」として残していた論点の結論。

`features/drawio/CLAUDE.md` は `features/drawio/` 配下を触るときにしか読まれず、関心マップの指す先の約半分（`DrawioModal`、`packages/remark-drawio`、`packages/editor`）には届かない。取った手当ては次の 2 つ。

- **apps/app 側**: `apps/app/AGENTS.md` の `## Key Features` 表に 1 行追加。apps/app のセッションでは常に読まれるので、`DrawioModal` や `DrawioViewerScript` を触るときにも届く。追加コストは 1 行。
- **`packages/*` 側**: **手当てしない。** 置けば届くが入口が 3 つになり、「置き場所を 1 つにする」目的と逆方向の取引になる。加えて `packages/remark-drawio` の draw.io 固有の知識（保存形式・再描画の判定）は当該ファイルのコメントと同居するテストで既に説明されており、そこだけを見て変更しても壊れにくい。**関心マップから外側を辿れることは満たしたうえで、外側から内側への導線は張らない**。drift が起きたら将来課題として再検討する。

### 簡素化: `CLAUDE.md` に根拠を書かない

`CLAUDE.md` は「指すだけ」に絞った（機構の説明・コード例・issue の経緯を含めない）。根拠を書くと design.md と二重管理になり、いま README と PR 本文で起きている問題の作り直しになる。含めるのは 4 点だけ: spec の所在、変更前に読むべき節の名指し、コードが `features/drawio/` に閉じていないこと、単体テストだけでは足りないこと。

## 設計判断の記録

| 判断 | 採った形 | 却下した形とその理由 |
|---|---|---|
| 根拠の置き場所 | design.md 1 本 | design + research に分割 → 入口が 2 つになり目的に反する / 検証手順を別ファイル → spec の標準の並びに無く前例も無い |
| `packages/*` への導線 | 張らない（関心マップから辿れれば足りる） | `packages/remark-drawio/CLAUDE.md` を置く → 入口が 3 つになる |
| apps/app 外側への導線 | `AGENTS.md` に 1 行 | 各ディレクトリに `CLAUDE.md` → 維持対象が増える |
| 「後から直せない」の書き方 | 構造を 1 節に統合 | 要件ごとに分散 → 同じ罠に別の形で落ちる |
| コードから spec への参照 | 追加しない（既存の `refs:` issue リンクは残す） | 各ファイルに「詳細は spec を見よ」を追記 → コメントと spec の二重管理 |

## Risks

| Risk | 影響 | 手当て |
|---|---|---|
| design.md が draw.io のバージョン更新で古くなる | 記述が現況と食い違う | Revalidation Triggers に「draw.io のメジャーバージョンが上がる」を明記し、確認すべき要件を指定した |
| README 削除を先にやってしまう | 根拠が失われる | tasks で順序を固定（design への移設 → 削除）。design の File Structure Plan にも移設済みであることを明記 |
| 将来課題が積まれたまま忘れられる | テストの穴が残り続ける | design に将来課題の表を置き、種類（テストの穴 / 挙動 / 外部制約）で分類した。着手時は対応する要件を書き換える旨も記載 |

---

# README 移設の対応表（タスク 1.1）

実施日: 2026-08-04 / 対象: `apps/app/src/features/drawio/client/self-hosted/README.md`（147 行）→ `design.md`

## この表の役割

README を削除する（タスク 3）前に、**README にしか書かれていない記述が 1 つも残っていないこと**を節単位で確かめた記録である。README は 1 ファイルで完結していたので、消す前にこの突き合わせを済ませないと根拠が失われる（要件 9.3 が「削除は内容が design に移り終わったあとに行う」ことを求めている理由）。

分け方は README の見出しを基本にしつつ、1 つの見出しに独立した主張が複数入っている段落はさらに分けた。見出しだけで区切ると「なぜその形なのか」を運んでいる文が塊の中に埋まり、移っているかどうかを 1 件ずつ確かめられなくなるためである。**全 37 単位**。

分類の意味:

- **移設済み** — design.md に同じ内容が書かれている
- **移設済み（言い換え）** — 文面は違うが同じことを design.md が（多くの場合より詳しく）書いている。重複させないため design.md には何も足していない
- **移設済み（本タスクで追記）** — 突き合わせで欠落が見つかり、この作業で design.md に足した

## 対応表

| README の単位 | 分類 | design.md の移設先（節名） | 根拠となる design.md の記述 |
|---|---|---|---|
| L1-4 表題と目的（`DRAWIO_URI` が自前インスタンスを指すとき `viewer-static.min.js` を動かすのに必要なもの一式） | 移設済み（言い換え） | Overview / Architecture > 関心マップ | 「draw.io 連携について「今どうなっているか・なぜそうなっているか・どう検証するか」を 1 か所に残す」。既定値は関心マップの「設定」の行が `app:drawioUri`（env `DRAWIO_URI`、既定 `https://embed.diagrams.net/`）として持つ |
| L6-8 バンドルは draw.io 自身のホスティング向けに作られ `viewer.diagrams.net` を焼き込む。支援された API では変えられない | 移設済み（言い換え） | Architecture > Existing Architecture Analysis | 「GROWI は draw.io の中を書き換えられないので、渡し方は 3 つに限られる」。表の 1 行目が「読み込み前のグローバル変数 / ビューアの参照先すべて / `viewer-static.min.js` の評価前でなければ効かない」。焼き込み先は `window.STENCIL_PATH = window.STENCIL_PATH \|\| "https://viewer.diagrams.net/stencils";` のコード例で示している |
| L8-9 細工を 1 か所に集め、ほかのコードが知らずに済むようにしている | 移設済み | Architecture > Architecture Pattern & Boundary Map | 「公開するのは 2 つの関数だけ — 呼び出し側（`DrawioViewerScript`）が draw.io のグローバル変数を知らずに済む。細工はすべて `features/drawio/` の内側に閉じる。」 |
| L13-16 2 つの入口のシグネチャと、それぞれを呼ぶ位置 | 移設済み | Architecture > 2 つの入口 | 同じコードブロックがある。「`prepareSelfHostedDrawio(drawioUri)   // viewer-static.min.js を挿す前`」「`adoptSelfHostedDrawio(drawioUri)     // onLoad 内、最初の描画より前`」 |
| L18-24 `window.X = window.X \|\| "..."` の初期化形。先に書いた値が生き残る | 移設済み | Architecture > Existing Architecture Analysis | 「つまり **読み込み前に書いた値が生き残る**。#11633 の骨格は「後から直す」のをやめて「先に決めておく」形に統一したことである。」 |
| L24-26 `prepareSelfHostedDrawio` を後回しにできない理由（読み込み後には値が読まれ、派生状態の組み立てに使われ終わっている） | 移設済み（言い換え） | System Flows > ビューアの起動順「この順序が守るもの」／Architecture > なぜ後から直せないのか #2 | 「`prepareSelfHostedDrawio` は render 中に呼ぶ（effect ではない）。書き込む値はバンドルの評価中に読まれ、`<Script>` はこの render で挿入されるためである。」／派生状態の実体は「`libraries` の各項目は `SHAPES_PATH` / `STENCIL_PATH` から**バンドル評価時に組み立てられる**ので、後から書き換えるのは遅すぎる。」 |
| L28-29 `adoptSelfHostedDrawio` は事前に決められない 1 点のためにある | 移設済み | Architecture > 2 つの入口 | 「分かれている理由は 1 つだけ: **MathJax の置き場所は事前に決められない**。」 |
| L31 「What each file handles」＝ファイルごとの役割 | 移設済み（言い換え） | File Structure Plan > Directory Structure | ディレクトリ図の各行が役割を持つ（`rebase-asset-paths.ts` = 読み込み前の参照先差し替え、`adopt-mathjax.ts` = 焼き込み先の抑止と再起動、`relocate-math-url.ts` = 焼き込みパスから移し替え先を組む純関数、`drawio-globals.ts` = 触る draw.io グローバルの型） |
| L35 別々の 2 つの問題があり、それが行き先の違う理由 | 移設済み | Architecture > なぜ後から直せないのか #2 ／ Components > RebaseAssetPaths | 「参照先を、CORS の対象かどうかで振り分けて差し替える」。#2 が「参照先が違う」問題と「CORS」問題を順に扱う |
| L37-42 参照先の誤り: `libraries` は評価時に `STENCIL_PATH` / `SHAPES_PATH` から組まれる。後からの書き換えは遅く、かつ不完全（`getStencil()` が `STENCIL_PATH` を直読みするフォールバックを持つ）。先に決めれば両方の経路が一度に直る | 移設済み | Architecture > なぜ後から直せないのか #2 | 「`mxStencilRegistry.getStencil()` は `libraries` に該当が無いとき `STENCIL_PATH` を直接読むフォールバックを持つ。`libraries` だけ書き換えてもこの経路は素通しである。」＋ XHR の呼び出し元を記録した実測経路（`URL: https://viewer.diagrams.net/stencils/aws4.xml   ← upstream のまま`） |
| L44-47 同一オリジン規則: stencil と shape は `XMLHttpRequest` で読まれる。自前ホストは `Access-Control-Allow-Origin` を返さない。`viewer.diagrams.net` は `*` を返すので `DRAWIO_URI` を動かすまで誰も踏まない | 移設済み | Architecture > なぜ後から直せないのか #2「さらに、参照先を直すだけでも足りない（CORS）」／配信経路が要る条件と、要らない条件 | 「`viewer.diagrams.net` は `access-control-allow-origin: *` を返すが、**`jgraph/drawio` の Tomcat は返さない**。stencil はスクリプトではなく XHR で取得されるため CORS の対象になる。」／踏まない理由は「`viewer.diagrams.net` は `Access-Control-Allow-Origin: *` を送るので、ブラウザが直接読めるためである」 |
| L47-49 XHR で読む 3 つの subtree は GROWI のオリジン経由（配信ルート `server/routes/drawio-assets.ts`）。画像は `<img>` なので規則の対象外でインスタンス直 | 移設済み | Architecture > なぜ後から直せないのか #2「採った形」／関心マップ | 「XHR で取得される 3 つ（`STENCIL_PATH` / `SHAPES_PATH` / `STYLE_PATH`）は GROWI 自身のオリジン経由にする。`<img>` で読まれる画像系（`GRAPH_IMAGE_PATH` / `mxImageBasePath` / `mxBasePath`）は CORS の対象外なので、インスタンスへ直接向ける（要件 2.1）。」／配信の置き場所は関心マップの「図資産の配信」の行が `features/drawio/server/routes/drawio-assets.ts` を指す |
| L51 refs #10726 | 移設済み | Architecture > なぜ後から直せないのか #2 ／ 否定済みの原因説 | 「これが「編集中は図形が出るのに、保存して閲覧に戻ると空の四角になる」（#10726 の症状）の正体である」。否定済みの原因説にも「#10726 の `patchStencilRegistryUrls()` で stencil の参照先は直っていた」の行がある |
| L55-56 `Editor.initMath()` はバンドル末尾で走り、焼き込み先を指す `<script>` を追加する | 移設済み | Architecture > なぜ後から直せないのか #1 | 「`Editor.initMath()` は `viewer-static.min.js` の末尾で実行され、焼き込み先の `startup.js` を指す `<script>` を追加する。」 |
| L57 後から要素を取り除いても止まらない（動的挿入した classic script は取得完了で実行される） | 移設済み | Architecture > なぜ後から直せないのか #1 | 「**動的に挿入した classic script は、取得が完了すれば実行される。DOM から外しても実行は取り消されない。**」 |
| L58-61 焼き込み先が到達可能なとき（v29 以降の `viewer.diagrams.net/math4/es5`）二重起動し、2 回目が 1 回目を壊して `Input Jax "tex" is not defined` で死ぬ | 移設済み | Architecture > なぜ後から直せないのか #1 | 「そのため焼き込み先が実際に到達可能なとき（v29 以降が焼き込む `viewer.diagrams.net/math4/es5` は現在も生きている）、MathJax が 2 回起動し、2 回目が 1 回目の初期化を壊して次で死ぬ。」＋ エラー文 `MathJax(?): Input Jax "tex" is not defined (has it been loaded?)` |
| L63-66 採った形: 先に `window.MathJax` を定義して `initMath()` を no-op にし、焼き込み先の script を作らせない。`onLoad` で `DRAW_MATH_URL` を直して `initMath()` を呼び直す。起動は 1 回 | 移設済み | Architecture > なぜ後から直せないのか #1「採った形」 | 「何も取り除かない。読み込み前に `window.MathJax` を定義して `Editor.initMath()` の `typeof window.MathJax === 'undefined'` 判定を外し、**焼き込み先のスクリプトをそもそも作らせない**。そのうえで `onLoad` で `DRAW_MATH_URL` を直してから `Editor.initMath()` を呼び直す。起動は 1 回だけ（要件 1.2, 1.3）。」 |
| L68-70 置き場所は焼き込み値から読む。v29 で `math/es5` → `math4/es5` に移り、インスタンスは片方しか持たない。再利用すればバージョン判定が要らない | 移設済み | Architecture > 2 つの入口 ／ Boundary Commitments > Revalidation Triggers | 「draw.io は v28 以前が `math/es5`、v29 以降が `math4/es5` を同梱し、インスタンスは片方しか持たない。焼き込まれたパスはそのインスタンスの同梱配置と必ず一致するので、**それを読み取って再利用すればバージョン判定も追加の通信も要らない**。」／前提が崩れる条件は Revalidation Triggers の「draw.io のメジャーバージョンが上がる」の行（再検証すべきこととして `math4/es5` の配置を名指ししている） |
| L72-73 `initMath()` は組版を要求するリスナーも設置する。だから最初の描画より前に走らせる | 移設済み | Architecture > 2 つの入口 ／ System Flows「この順序が守るもの」 | 「`initMath()` は組版を要求するリスナーも設置するので、これより前に作られた図は永久に組版されない。」 |
| L75 refs #9774 | **移設済み（本タスクで追記）** | Architecture > なぜ後から直せないのか #1 | 追記した文: 「対応する issue は **#9774**（自前ホストで数式が描画されない）。`adopt-mathjax.ts` と `relocate-math-url.ts` の `refs:` コメントが指す先であり、コードからこの節へ辿る手がかりになる。」 |
| L79-82 GROWI 自身の数式は remark-math + rehype-katex で、KaTeX は `window.MathJax` を見ない。アプリに MathJax 依存は無い | 移設済み | Architecture > `window.MathJax` を触ってよい理由（1 点目） | 「GROWI 自身のページ内数式は remark-math + rehype-katex で、**KaTeX は `window.MathJax` を見ない**。アプリに MathJax への依存は無い。」 |
| L84-87 `viewer-static.min.js` は図の無いページでも読み込まれるので draw.io は既に全ページで設定済み。このコードは中身を決めているだけ。`adoptSelfHostedDrawio` 後の値は draw.io 自身の設定オブジェクト | 移設済み | Architecture > `window.MathJax` を触ってよい理由（2・3 点目） | 「`viewer-static.min.js` は図の無いページでも読み込まれるので、**draw.io は既にすべてのページで `window.MathJax` を設定している**。このコードはグローバル変数を持ち込むのではなく、そこに何が入るかを決めているだけである。」／「`adoptSelfHostedDrawio` が走った後の値は draw.io 自身の設定オブジェクトで、従来と同じである。」 |
| L89-93 唯一の注意点: 2 つの入口の間だけ仮の `{}` が入る。`typeof window.MathJax !== 'undefined'` を「ある」と解釈するもの（自前の MathJax を読むカスタムスクリプトやプラグイン）が誤解する。だから移し替えできない経路でも必ず消し、`onLoad` で隙間が閉じる | 移設済み | Architecture > `window.MathJax` を触ってよい理由「唯一の注意点」／Components > SelfHostedEntryPoints の不変条件／Security Considerations | 「2 つの入口の間、この変数は仮の `{}` を保持する。…そのため `adoptMathJax` は**移し替えができない経路でも必ず仮の値を消す**。`onLoad` が走った時点でこの隙間は閉じる。」／不変条件として「`adoptSelfHostedDrawio` は、移し替えができない経路でも `window.MathJax` の仮値を必ず消す」／Security Considerations に「仮値の期間は `onLoad` までに限られ、必ず消される」 |
| L97-99 古い draw.io イメージは `stencils/` `shapes/` を同梱しない（28.2.9 に無く 31.1.5 にある）。その場合はインスタンスが 404 を返すので本家へフォールバックする | 移設済み | Components > DrawioAssetsRoute > Implementation Notes ／ System Flows > 図資産の配信 | 「古い draw.io イメージは `stencils/` `shapes/` をそもそも同梱していない（28.2.9 に無く、31.1.5 にはある）。その場合のみ本家から読む。」／フロー図が「インスタンスから取得 →（失敗）→ draw io 本家から取得」の順を示す |
| L99-100 ブラウザは常に GROWI のオリジンしか見ない。外向きの要求はサーバーのもの | 移設済み | Components > DrawioAssetsRoute > Implementation Notes | 「**ブラウザは常に GROWI のオリジンしか見ない**（外向きの要求はサーバーのもの）。」 |
| L101-103 外に route が無い環境ではフォールバックも失敗し図形が空になる。以前と同じ結果で、このコードではなく draw.io のバージョン側の制約。インスタンスを上げれば直る | 移設済み | Components > DrawioAssetsRoute > Implementation Notes ／ 将来課題 | 「外に route が無い環境ではこのフォールバックも失敗し、図形は空になる。これは以前と同じ結果で、draw.io のバージョン側の制約である（要件 2.5）。」／将来課題に「v28 系以前で `stencils/` `shapes/` が同梱されない」を外部制約として置き「インスタンスを上げれば解消」と書いている |
| L107-108 ルータが答えるのは `DRAWIO_URI` が自前ホストのときだけ。client が参照先を差し替えるのと同じ条件で、共有の `isSelfHostedDrawio` を使う | 移設済み | Architecture > 配信経路が要る条件と、要らない条件 ／ Architecture Pattern & Boundary Map「選んだ形と理由」 | 「配信ルータは `DRAWIO_URI` が自前ホストを指しているときだけ答える。」／「参照先を差し替えるのは自前ホストのときだけで、配信ルータもそのときだけ答える。両者が別の基準で判断すると「誰も要求しない経路が開いている」または「差し替えたのに配信が 404」という食い違いが起きる。だから `isSelfHostedDrawio` を 1 つ置き、client と server の両方がそれを呼ぶ。」 |
| L108-111 既定構成では 404 で外部要求なし。`DRAWIO_URI` に使える値が入っていないときも同じ。理由は `viewer.diagrams.net` が `Access-Control-Allow-Origin: *` を送りブラウザが直接読めるから | **移設済み（本タスクで追記）** | Architecture > 配信経路が要る条件と、要らない条件 | 既定構成の側は既にあった（「既定構成では 404 を返し、外部への要求も出さない（要件 3.9）。`viewer.diagrams.net` は `Access-Control-Allow-Origin: *` を送るので、ブラウザが直接読めるためである。」）。追記した文: 「`DRAWIO_URI` が URL として解釈できない値のときも同じ扱いで、判定が「自前ホストでない」を返すため 404 になる。ビューア側が参照先を差し替えないのと足並みが揃う（要件 8.3）。」 |
| L113-117 必要なのはクロスオリジンの自前ホストがヘッダを送らないから。これをなくす 2 つのデプロイ選択（GROWI と同一オリジンへのリバースプロキシ / インスタンスに `Access-Control-Allow-Origin` を返させる）は、使えるなら proxy より望ましい。どちらも GROWI 単独では手配できないのでルータがある | 移設済み | Architecture > 配信経路が要る条件と、要らない条件 | 「必要なのは **クロスオリジンの自前ホストがそのヘッダを送らない**からで、次の 2 つはどちらもこの必要をなくす。**使えるなら proxy より望ましい**。」＋箇条書き「draw.io を GROWI と同じオリジンにリバースプロキシで載せる」「インスタンスに `Access-Control-Allow-Origin` を返させる」＋「どちらも GROWI 単独では手配できない。だから配信ルータが存在する。」 |
| L121-123 残っているギャップ: `PROXY_URL`（図の中から参照する画像の取得口）は手を付けていない。自前ホストのイメージに該当サーブレットが無く `/proxy` が 404 なので向ける先が無い。ビューアの経路では使われない | 移設済み | 将来課題 | 「`PROXY_URL`（図の中から参照する外部画像の取得口）が未対応 / 外部制約 / 自前ホストのイメージに該当のサーブレットが無く（`/proxy` が 404）、向ける先が無い。ビューアの経路では使われない」 |
| L127 どちらの問題も `embed.diagrams.net` に対しては現れない | **移設済み（本タスクで追記）** | Testing Strategy > 手動確認の手順 | 追記した文: 「**自前ホストのインスタンスを実際に立てる必要がある**。ここで扱う 2 つの失敗はどちらも既定の `embed.diagrams.net` では現れないため、既定構成のままでは再現できない。」 |
| L127-128 MathJax の方は外に出られる機械でだけ現れるので、単体テストだけでは捕まらない | 移設済み | Architecture > なぜ後から直せないのか #1 ／ Testing Strategy > 自動テストで担保していないこと・手動確認の手順 | 「**外に出られる環境でだけ壊れる**ため、閉域だけを見ていると気づけない。」／「**外に出られる状態と出られない状態の両方で行う**（要件 10.3）。二重起動は外に出られる環境でだけ現れるため、閉域だけを検証環境にすると見落とす。」／担保していないことの表が「実際に数式が描画される」を手動確認に回している |
| L129-130 実インスタンスを立て、2 世代の draw.io を両方見る（2 つの失敗が互いに鏡像なので） | 移設済み | Testing Strategy > 手動確認の手順 ／ Boundary Commitments > Revalidation Triggers | 「**2 世代を並べる必要がある**（要件 10.2）。失敗の出方が逆になるため、片方だけでは検証にならない。」／再検証が必要になる条件としては Revalidation Triggers の「draw.io のメジャーバージョンが上がる」の行、および AdoptMathJax の Risks「**バージョンを上げたら要件 1.3 の確認（外に出られる状態で数式が出るか）を必ず行う**」 |
| L132-135 `docker run` 2 行（`jgraph/drawio:latest` = 8080、`jgraph/drawio:28.2.9` = 8081）と、それぞれが焼き込むディレクトリ | 移設済み | Testing Strategy > 手動確認の手順 | 同じ 2 行がある。「`docker run -d --name drawio-31 -p 8080:8080 jgraph/drawio:latest      # math4/es5 を焼き込む`」「`docker run -d --name drawio-28 -p 8081:8080 jgraph/drawio:28.2.9      # math/es5 を焼き込む`」 |
| L137-138 `DRAWIO_URI` をどちらかに向け、Mathematical Typesetting を有効にした数式と AWS 図形を含む図のページを閲覧する | 移設済み | Testing Strategy > 手動確認の手順 | 「`DRAWIO_URI` をどちらかに向け、**数式（Mathematical Typesetting を有効化）と AWS 図形の両方を含む図**を置いたページを閲覧する。1 回の描画で両方の修正を通せる。」 |
| L140-143 見るべき 3 点（`stencils/` `shapes/` の要求が全て GROWI のオリジンへ行き `viewer.diagrams.net` へは 0 件 / `startup.js` の取得がちょうど 1 回で設定済みインスタンスから / `mjx-container` の個数が 0 より大きい） | 移設済み | Testing Strategy > 手動確認の手順「見るべきもの」 | 3 点がそのままある（「`document.querySelectorAll('mjx-container').length` が 0 より大きい」「`stencils/` と `shapes/` への要求がすべて GROWI のオリジンへ行き、`viewer.diagrams.net` へは 1 件も行かない」「`startup.js` の取得が**ちょうど 1 回**、設定済みインスタンスから」）。design.md 側は要件 4.2 に対応する 4 点目（メニューバーの文字が読める）を追加している |
| L145-147 v28 は参照先の付け替えを捕まえる側（焼き込み先が upstream で 404）。v31 は二重起動を捕まえる側（焼き込み先が生きている） | 移設済み | Testing Strategy > 手動確認の手順（世代の表） | 表の 2 行がそのまま持つ。「**v28 系** / 参照先の付け替え。焼き込み先の MathJax パスが upstream で 404 なので、付け替えが効いていなければ数式が出ない」「**v31 系** / 二重起動。焼き込み先が生きているので、抑止が効いていなければ MathJax が 2 回起動して壊れる」。#1 の本文にも「v28 で問題が出なかったのは、焼き込み先の `math/es5` が upstream で 404 で実行に至らなかったからで、**その 404 に助けられていただけ**だった」がある |

## 集計

| 分類 | 件数 |
|---|---|
| 移設済み | 30 |
| 移設済み（言い換え） | 4 |
| 移設済み（本タスクで追記） | 3 |
| **未移設** | **0** |
| **部分的** | **0** |
| 合計 | 37 |

## design.md に足した 3 か所

突き合わせで見つかった欠落。いずれも README にしか無かった記述で、これを足したことで README を消しても失われる記述が無くなった。

| 足した場所 | 何が欠けていたか | なぜ必要か |
|---|---|---|
| Architecture > なぜ後から直せないのか #1 | issue 番号 **#9774** | 同じ節の #2 は `#10726` を本文に持っているのに #1 は issue を指していなかった。コード側（`adopt-mathjax.ts` / `relocate-math-url.ts`）の `refs:` コメントは #9774 を指すので、番号が無いと **コードのコメントから design.md のどの節に来ればよいかが繋がらない** |
| Architecture > 配信経路が要る条件と、要らない条件 | `DRAWIO_URI` が URL として解釈できない値のときも 404 になること | 「要らない条件」として README が挙げていたのは既定構成と**使える値が入っていない場合**の 2 つで、design.md は前者だけを書いていた。ほかの節（IsSelfHostedDrawio、Error Handling の表）から導ける内容だが、配信ルータの条件を確かめたい読者が 1 か所で読み切れない |
| Testing Strategy > 手動確認の手順 | 既定の `embed.diagrams.net` ではどちらの失敗も現れないこと | 「なぜ実インスタンスを立てる必要があるのか」の理由。これが無いと手順が「2 世代の docker を立てる」から始まり、既定構成で確かめようとして「再現しないから直っている」と誤解する余地が残る |

## この作業で触っていない範囲

Testing Strategy 節のうち「自動テストで担保していること」「自動テストで担保していないこと（要件 10.1）」の 2 つの表は**タスク 1.2 の担当**なので触っていない。この作業が同節で変更したのは「手動確認の手順」の冒頭 1 文だけである。

---

# 担保テストの突き合わせ（タスク 1.2）

実施日: 2026-08-04 / 対象: requirements.md の `_担保しているテスト:_` 行、design.md の Testing Strategy の 2 つの表・将来課題・否定済みの原因説

## この記録の役割

as-built spec の担保欄は、**書いた本人が「たぶんこのテストで守られている」と思ったこと**が入りやすい。要件 9.5 は「担保が無いものは無いと明記する」ことを求めているので、担保を多く見せる記述はそれ自体が要件違反になる。この節は、受け入れ基準 55 件を 1 件ずつ実在するテストと突き合わせた結果である。

**突き合わせ方**: draw.io 関連の spec ファイル 13 個をすべて読み、(1) import している対象、(2) `describe` / `it` の題、(3) 実際の assert を確認した。そのうえで受け入れ基準ごとに「その振る舞いが壊れたとき、このテストは落ちるか」を判断した。部品（helper 関数）に当てたテストは、それを組み合わせた全体の振る舞いの担保には数えていない。構造への assert（例: この CSS は文字色を宣言している）は、見え方の約束（例: 文字が読める）の担保には数えていない。

**確認に使ったテストの実行結果**: `apps/app` 10 ファイル 97 件、`packages/remark-drawio` 3 ファイル 16 件、いずれも pass（合計 113 件）。

**判定の意味**:

- **担保あり** — その振る舞いが壊れたら落ちるテストが実在する
- **部分的** — 振る舞いを支える部品や機構には担保があるが、受け入れ基準が言っている観測できる結果そのものには担保が無い
- **担保なし** — 当たっているテストが 1 件も無い

## 対応表

| 受け入れ基準 | 実在するテスト | 判定 | 根拠（spec ファイルと `describe` / `it`） |
|---|---|---|---|
| 1.1 数式が描画される | — | 担保なし | 該当なし。要件 10 の手動確認 |
| 1.2 インスタンスから読み、1 回だけ | あり | 担保あり | `adopt-mathjax.spec.ts` > `adoptMathJax` > `should boot MathJax from the configured instance` / `should boot MathJax exactly once, so the second boot cannot break the first` / `should repoint DRAW_MATH_URL, which the font path is derived from` |
| 1.3 焼き込み先が生きていても描画される | 一部 | 部分的 | `adopt-mathjax.spec.ts` > `suppressBakedMathJax` > `should stop the bundle from requesting the baked-in location at all`（機構）。描画は該当なし |
| 1.4 閉域でも描画される | — | 担保なし | 該当なし。要件 10 の手動確認 |
| 1.5 サブパスでも描画される | 一部 | 部分的 | `relocate-math-url.spec.ts` > `should keep the sub path when draw.io is deployed under one`、`use-viewer-min-js-url.spec.ts` > `generateViewerMinJsUrl`（`http://example.com/drawio` の行）。描画は該当なし |
| 1.6 数式無効の図は組版しない | — | 担保なし | 該当なし。draw.io 側の判断で GROWI に分岐が無い |
| 2.1 図形が描画される | — | 担保なし | 該当なし。要件 10 の手動確認 |
| 2.2 本家へ要求を出さない | 一部 | 部分的 | `rebase-asset-paths.spec.ts` > `should route $global through GROWI's own origin because $reason` / `should read $global straight from the instance, since <img> is not bound by the same-origin rule`、`use-viewer-min-js-url.spec.ts`。外部要求が 0 件であることは該当なし |
| 2.3 未ログインの共有ページで描画される | — | 担保なし | 該当なし |
| 2.4 同梱していないとき本家から取得を試みる | — | 担保なし | 該当なし。ルータのフォールバックを呼ぶテストが無い |
| 2.5 両方失敗時に図形のみ欠ける | — | 担保なし | 該当なし |
| 2.6 サブパスでも図形が描画される | 一部 | 部分的 | `rebase-asset-paths.spec.ts` > `should keep the sub path when draw.io is deployed under one`、`drawio-assets.spec.ts` > `resolveAsset` > `should resolve against "$drawioUri"`。描画は該当なし |
| 2.7 ライトボックスの編集導線 | あり | 担保あり | `rebase-asset-paths.spec.ts` > `should point the lightbox at the instance itself when DRAWIO_URI has $reason`（4 通り） |
| 3.1 取得先はリクエストから決まらない | 一部 | 部分的 | `drawio-assets.spec.ts` > `resolveAsset` > `should keep the request on the configured host even when the path is $reason`、`readAsset — the subtree it was given` > `should refuse a location outside it without making the request`。取得先が 2 つに限られることは該当なし |
| 3.2 許可外パスは 404・外部要求なし | 一部 | 部分的 | `drawio-assets.spec.ts` > `proxiableAssetExtension` > `should refuse $reason`（11 通り）。応答は該当なし |
| 3.3 範囲外は 404・取得しない | 一部 | 部分的 | `resolveAsset` > `should return undefined when the path climbs out of the configured subtree`、`readAsset — the subtree it was given` > `should refuse a location outside it without making the request`。404 は該当なし |
| 3.4 Content-Type は拡張子から | — | 担保なし | 該当なし |
| 3.5 `nosniff` を付ける | — | 担保なし | 該当なし |
| 3.6 リダイレクトを追わない | あり | 担保あり | `drawio-assets.spec.ts` > `readAsset` > `should return undefined when $reason`（`following a redirect would leave the resolved origin` の行）。302 の転送先は実在して 200 を返すのに `undefined` になる |
| 3.7 10 秒 / 64 MiB で打ち切る | — | 担保なし | 該当なし |
| 3.8 フォールバックと 502 | — | 担保なし | 該当なし |
| 3.9 既定構成は 404・外部要求なし | 一部 | 部分的 | `is-self-hosted-drawio.spec.ts` > `should be $expected for $reason`（既定オリジン 2 行、ゲートの判定）。応答は該当なし |
| 3.10 認証を求めない | — | 担保なし | 該当なし |
| 4.1 文字色を背景色と対で定める | あり | 担保あり | `drawio-config.spec.ts` > `should declare a foreground colour for every surface it repaints` |
| 4.2 メニューの文字が判読できる | 構造のみ | 担保なし | 見え方の担保は該当なし。構造は `should colour the menubar entries themselves, not only their container` |
| 4.3 ボタンを上書きしない | あり | 担保あり | `drawio-config.spec.ts` > `should leave the editor buttons alone so draw.io keeps styling them` |
| 5.1 制御しないパラメータを保持 | あり | 担保あり | `build-drawio-editor-url.spec.ts` > `should keep parameters DRAWIO_URI carries that GROWI does not control` |
| 5.2 キーを重複させない | あり | 担保あり | 同 > `should not duplicate a parameter that DRAWIO_URI already sets` / `should not duplicate "%s" when DRAWIO_URI already sets it` |
| 5.3 サブパスを保持 | あり | 担保あり | 同 > `should keep the path when draw.io is deployed under a sub path` |
| 5.4 失敗として報告する | あり | 担保あり | 同 > `should throw when drawioUri cannot be parsed`。呼び出し元の受け方は該当なし |
| 6.1 全ページを保存する | あり | 担保あり | `mxfile.spec.ts` > `preserves every page (content and name), not only the first` |
| 6.2 開き直すと全ページ復元 | 一部 | 部分的 | `mxfile.spec.ts` > `persists an <mxfile> that isMxfileData recognizes (round-trip contract)` / `a multi-page diagram persisted on save renders every page with navigation enabled`、`embed.spec.ts` > `passes the mxfile through untouched so every page survives`。復元経路（`ready` 分岐）は該当なし |
| 6.3 単一ページは従来と同一 | あり | 担保あり | `mxfile.spec.ts` > `returns the first diagram inner content unchanged` |
| 6.4 ページが無いとき上書きしない | あり | 担保あり | `mxfile.spec.ts` > `returns an empty string when no diagram element is present`、`DrawioCommunicationHelper.spec.ts` > `does NOT overwrite the diagram when no page can be extracted` |
| 6.5 発信元が一致しないメッセージ | — | 担保なし | 該当なし。既存のテストは常に一致する発信元を渡す |
| 7.1 ページ送りが保たれる | 一部 | 部分的 | `should-rerender-on-resize.spec.ts` > `does NOT re-render when only the height changes (width is stable)`（1 ページ目に戻る原因を防ぐ判定）、`embed.spec.ts` > `enables page navigation so the extra pages are reachable`。保たれること自体は該当なし |
| 7.2 幅が変わったら再描画 | あり | 担保あり | `should-rerender-on-resize.spec.ts` > `re-renders when the available width changes (external layout change)` |
| 7.3 高さのみでは再描画しない | あり | 担保あり | 同 > `does NOT re-render when only the height changes (width is stable)` |
| 7.4 初回は描画する | あり | 担保あり | 同 > `re-renders on the first observation (no previous width yet)` |
| 8.1 既定構成では差し替えない | 一部 | 部分的 | `index.spec.ts` > `should leave draw.io untouched when its own hosted viewer is configured`。読み込み後の入口 `adoptSelfHostedDrawio` は該当なし |
| 8.2 既定構成は従来どおり | — | 担保なし | 該当なし。要件 10 の手動確認 |
| 8.3 解釈できない値では手当てしない | 一部 | 部分的 | `index.spec.ts` > `should leave draw.io untouched when DRAWIO_URI holds nothing usable`、`is-self-hosted-drawio.spec.ts`（`not-a-url` / 空値の行）。読み込み後の入口は該当なし |
| 8.4 判定が 2 か所で同一 | — | 担保なし | 該当なし。drift テストが無い |
| 9.1 現況の機構と理由を design に持つ | — | 担保なし（文書） | 該当なし |
| 9.2 `CLAUDE.md` から spec へ辿れる | — | 担保なし（文書） | 該当なし |
| 9.3 README を残さない | — | 担保なし（文書） | 該当なし |
| 9.4 関心マップを持つ | — | 担保なし（文書） | 該当なし |
| 9.5 担保テストを対応づける | — | 担保なし（文書） | 該当なし。この節がその成果物 |
| 9.6 未解決事項を将来課題に記録 | — | 担保なし（文書） | 該当なし |
| 9.7 否定済みの原因説を残す | — | 担保なし（文書） | 該当なし |
| 10.1 担保が無いことと確かめ方 | — | 担保なし（文書） | 該当なし |
| 10.2 2 世代の draw.io | — | 担保なし（文書） | 該当なし |
| 10.3 外部に出られる／出られない両方 | — | 担保なし（文書） | 該当なし |
| 10.4 既定構成での無変化確認 | — | 担保なし（文書） | 該当なし |
| 10.5 何を見れば合否が分かるか | — | 担保なし（文書） | 該当なし |

**集計**: 担保あり 15 / 部分的 12 / 担保なし 28（うち文書の要件 12）＝ 55。

## 直した記述と、直す前が何を誤らせていたか

### 担保を多く見せていた 3 か所（危険な向き）

| 場所 | 直す前 | 実態 | なぜ誤りか |
|---|---|---|---|
| requirements.md 要件 2 | `drawio-assets.spec.ts`（…フォールバックが成功として記録されること）を要件 2 の担保として挙げていた | AC 2.4 は担保なし | 挙げていたテスト（`should report success so a fallback read can be logged as such`）が確かめているのは `readAsset` が成功を呼び出し元へ通知することだけで、**ルータが本家へ切り替えることは確かめていない**。フォールバックを壊しても落ちない |
| requirements.md 要件 1 / design.md の表 | `index.spec.ts` が「自前ホストのときだけ効くこと」「2 つの入口」を担保している、と読める書き方だった | `index.spec.ts` が呼ぶのは `prepareSelfHostedDrawio` だけ。`adoptSelfHostedDrawio` を呼ぶテストは 0 件 | design.md 自身が「2 つの入口」を `prepareSelfHostedDrawio` と `adoptSelfHostedDrawio` と定義しているため、表の「2 つの入口」という行名が**両方の入口にテストがあるように読める**。実際は読み込み後の入口のゲート（既定構成なら何もしない）が無防備 |
| design.md「担保していないこと」の表 | 配信ルータの行に 3.6（リダイレクトを追わない）を含めていた | 3.6 は `readAsset` で担保あり | 実在する強いテストを「無い」側に置くと、テストを消しても気づけない。将来課題の見積りも狂う |

### 担保が無いのに何も書いていなかった 4 か所（要件 9.5 違反）

| 場所 | 抜けていた受け入れ基準 | 足した内容 |
|---|---|---|
| requirements.md 要件 1 | AC 1.6（数式を有効にしていない図は組版しない） | 担保なしと明記。組版の判断は draw.io 側で GROWI に分岐が無いため当てるテストが無いこと、#11633 の実測でのみ確認していることを添えた |
| requirements.md 要件 2 | AC 2.5（両方失敗時に図形だけが欠ける）が担保欄で触れられていなかった | 担保なしと明記（design の「担保していないこと」の表には元からあった） |
| requirements.md 要件 4 | AC 4.2（判読できる）が担保欄で触れられていなかった | 担保なしと明記し、構造の側だけ担保があることを書き分けた |
| requirements.md 要件 6 | AC 6.2 の復元経路 | 保存形式の担保と復元経路の担保なしを書き分けた。`onReceiveMessage` の `ready` 分岐を呼ぶテストが 0 件 |

### 挙げられていなかった実在のテスト 3 件

| テスト | どの受け入れ基準を担保するか | どこにも挙がっていなかった理由 |
|---|---|---|
| `rebase-asset-paths.spec.ts` > `should point the lightbox at the instance itself when DRAWIO_URI has $reason` | 2.7 | AC 2.7 は design discovery で後から足した受け入れ基準（この文書の「要件に無い挙動が 1 つあった」）。**要件は足したが担保欄を更新していなかった** |
| `embed.spec.ts` の 5 件 | 6.2 の描画側、7.1 のページ送りの操作面 | ファイル名が draw.io を含まないため、担保欄・design の表のどちらにも一度も現れていなかった |
| `use-viewer-min-js-url.spec.ts` の 4 件 | 1.5・2.2・2.6 のサブパスとインスタンス直読み | 同上。design の関心マップには実装ファイルとして載っているが、テストとしては載っていなかった |

## 将来課題と否定済みの原因説の突き合わせ

- **将来課題**: 担保なしの発見に対応する行が揃っているかを確認し、4 行を足した（取得の時間・サイズの上限 / 復元経路 / 読み込み後の入口 / 本家へのフォールバックは既存行の由来に追記）。逆向き（将来課題の行が要件か design のどこかに根拠を持つか）も確認し、根拠の無い行は無かった。
- **`DRAWIO_URI` が不正なとき利用者に理由が伝わらない**: requirements.md（要件 5 AC 4 の注記）と design.md（Error Handling の表、将来課題の表）の両方に載っていることを確認した。追記は不要。
- **否定済みの原因説**: brief.md の「分かっていて、まだ spec に書かれていないこと」「未解決のまま残っていること」と、この文書の gap 分析・design discovery を突き合わせた。既存の 6 行はすべて出所を辿れる。**1 行足りなかった**ので足した — 「参照先を設定済みインスタンスへ直接向ければ stencil は読める（配信経路は要らない）」。brief.md には CORS で止まることが書かれているが、否定済みの一覧には入っていなかった。配信ルータを消す提案の形で再発しやすい。
- gap 分析が否定した「要件 3 のテストの穴は AC 5〜8 だけ」は**原因説ではなく担保の見積り違い**なので、否定済みの原因説の表には入れず、この節に記録した（同種の誤りが今回さらに 3 件見つかっている）。
