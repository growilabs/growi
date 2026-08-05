# Brief: drawio（flagship / 関心マップ）

> この spec は draw.io 連携の flagship である。担う責務は「**今どうなっているか・なぜそうなっているか・どう検証するか**」を残すこと（as-built を書く保守用 spec）。加えて、draw.io 連携の関心マップ（どの関心がどのコードにあるか）をここで管理する。

> **これは discovery 時点（2026-08-04）の記録である。現況は [design.md](design.md) と [requirements.md](requirements.md) が正。**
> この時点では「実装は変えず記録だけを残す spec」として起こしたが、その後**仕様変更の起点として使う**方向に広げ、テストの追加も範囲に入れた。
> 下記の「Out of Boundary」等はこの時点の線引きなので、現在の境界は design.md の Boundary Commitments を見ること。

## Problem

draw.io 連携の不具合は、これまで **GROWI が draw.io 側の既定値・配色・URL の扱いに暗黙に依存していた**ことが原因で、draw.io のバージョンが上がるたびに表に出てきた。#9774（数式が描画されない）・#10478（メニューの文字が読めない／`DRAWIO_URI` のパラメータが無効になる）・#10726（stencil が空の四角になる）・#11522（複数ページが無警告で消える）はいずれもこの形である。

直したときの根拠は、いま次の 3 か所に散っている。

- コード中のコメント（`refs:` 付きで issue を指してはいるが、断片的）
- PR の本文（#11633、#11524。GitHub 上にしか無く、コードからは辿れない）
- `features/drawio/client/self-hosted/README.md`（#11633 で追加。最も詳しいが、spec の体系＝要件・設計・検証に載っていない）

そのため次に触る人は同じ調査を一からやり直すことになる。自前ホスト対応の細工はとくに事情が重く、**draw.io 内部の公開されていない動き**（グローバル変数の初期化順、`Editor.initMath()` の判定、`mxStencilRegistry` のフォールバック経路）に頼っているので、根拠を失うと安全に変更できない。

さらに、draw.io 関連のコードは `features/drawio/` に閉じていない。エディタ起動は `client/components/PageEditor/DrawioModal/`、描画と保存形式は `packages/remark-drawio/`、挿入ボタンと折りたたみは `packages/editor/`、設定は `config-definition.ts` にある。**どの関心がどこにあるかを一望できる場所が無い**。

## Current State

### 関心マップ（現況）

| 関心 | 置き場所 | 備考 |
|---|---|---|
| 自前ホスト判定 | `features/drawio/is-self-hosted-drawio.ts` | client / server の両方が同じ関数を使う。判定できない値は「自前ホストでない」扱い |
| 参照先・proxy 経路の定数 | `features/drawio/consts.ts` | `DEFAULT_DRAWIO_ORIGIN` / `VIEWER_DIAGRAMS_NET_ORIGIN` / `DRAWIO_ASSET_PROXY_PATH` = `/_drawio-assets` / `PROXIED_ASSET_DIRS` = stencils・shapes・styles |
| 読み込み前の参照先差し替え | `features/drawio/client/self-hosted/rebase-asset-paths.ts` | XHR で読まれるものは GROWI のオリジン経由、`<img>` で読まれるものはインスタンス直 |
| MathJax の置き場所の付け替え | `features/drawio/client/self-hosted/adopt-mathjax.ts` / `relocate-math-url.ts` | 焼き込み先の起動を抑止し、正しい場所で `Editor.initMath()` をやり直す |
| 触る draw.io グローバルの型 | `features/drawio/client/self-hosted/drawio-globals.ts` | 1 か所に集約 |
| stencil / shape / style の配信 | `features/drawio/server/routes/drawio-assets.ts` | 接続先は設定からのみ決定。許可リスト・拡張子由来の Content-Type・リダイレクト追随なし・上限あり。認証なし（共有ページの未ログイン閲覧者にも必要） |
| route の mount | `server/routes/index.js`（`DRAWIO_ASSET_PROXY_PATH`） | |
| ビューアのスクリプト挿入と起動順 | `components/Script/DrawioViewerScript/` | `prepareSelfHostedDrawio` は render 中（スクリプト挿入前）、`adoptSelfHostedDrawio` は `onLoad` 内（最初の描画前）。`GraphViewer` の resize 検知はここで無効化 |
| ビューア本体・再描画の判定 | `packages/remark-drawio/src/components/DrawioViewer.tsx` / `should-rerender-on-resize.ts` | 幅が変わったときだけ再描画。高さのみの変化（ページ送り）は無視（#11524） |
| markdown → 図の変換 | `packages/remark-drawio/src/services/renderer/remark-drawio.ts` / `utils/embed.ts` | 圧縮／非圧縮データの判定と mxgraph データ生成 |
| 保存形式（複数ページ） | `packages/remark-drawio/src/utils/mxfile.ts` | 生成（`extractDrawioData`）と検出（`isMxfileData`）を同じファイルに置いて食い違いを防ぐ（#11522） |
| エディタ URL の組み立て | `client/components/PageEditor/DrawioModal/build-drawio-editor-url.ts` | `append` ではなく `set`。`DRAWIO_URI` 側の同じキーを上書きしない（#10478） |
| エディタへ注入する設定・CSS | `client/components/PageEditor/DrawioModal/drawio-config.ts` | メニューバーとその項目に文字色を明示。Save / Exit ボタンには当てない |
| エディタとの postMessage | `client/components/PageEditor/DrawioModal/DrawioCommunicationHelper.ts` | origin 照合、`configure` / `save` / `exit` の受け渡し |
| markdown への書き戻し | `client/components/Page/markdown-drawio-util-for-view.ts` / `PageEditor/markdown-drawio-util-for-editor.ts` | 行範囲を ```drawio ブロックで置き換える |
| 挿入ボタン・折りたたみ | `packages/editor/`（`DiagramButton.tsx` / `fold-drawio.ts` / `states/modal/drawio-for-editor.ts`） | |
| 設定 | `server/service/config-manager/config-definition.ts` の `app:drawioUri`（env `DRAWIO_URI`、既定 `https://embed.diagrams.net/`） | |

### 分かっていて、まだ spec に書かれていないこと

- **共通の仕組み**: `viewer-static.min.js` が焼き込む参照先はすべて `window.X = window.X || "https://viewer.diagrams.net/..."` の形で初期化される。つまり**読み込み前に書いた値が生き残る**。「後から直す」のをやめて「先に決めておく」形にしたのが #11633 の骨格。
- **MathJax の二重起動**: 到達不能な `<script>` を取り除くだけでは直らない。動的に挿入した classic script は、取得が完了すれば実行され、DOM から外しても実行は取り消されない。焼き込み先が生きている draw.io v29 以降では MathJax が 2 回起動し、2 回目が 1 回目を壊す（`Input Jax "tex" is not defined`）。**外に出られる環境でだけ壊れる**ので閉域だけ見ていると気づけない。
- **stencil が空の四角になる真因**: `mxStencilRegistry.libraries` の後からの書き換えは効かない（各項目はバンドル評価時に組み立てられ、`getStencil()` は `STENCIL_PATH` を直接読むフォールバックも持つ）。さらに参照先を直しても、自前ホストの Tomcat は `Access-Control-Allow-Origin` を返さないので XHR が CORS で止まる。だから stencil / shape / style だけ GROWI のオリジン経由にしている。
- **メニューが読めない真因**: draw.io v26 で `styles/atlas.css` が削除され、atlas 相当の配色は `grapheditor.css` の `.geAtlas` 配下に移った。自前ホストでは `atlas` が `Editor.themes` に無いため `ui=atlas` が黙って `kennedy` にフォールバックし、`geAtlas` が付かない。結果、既定の文字色 `#3f3f3f` が背景 `#334455` に乗り、コントラスト比およそ 1.05 対 1 になる。
- **`window.MathJax` を触ってよい理由**: GROWI のページ内数式は remark-math + rehype-katex で、KaTeX は `window.MathJax` を見ない。`viewer-static.min.js` は図の無いページでも読み込まれるので、draw.io は既にすべてのページで `window.MathJax` を設定している。
- **検証方法**: 2 世代の draw.io を並べる必要がある。v28 系（焼き込み先の MathJax パスが upstream で 404）は参照先の付け替えを確かめる側、v31 系（焼き込み先が生きている）は二重起動を捕まえる側。`jgraph/drawio` の docker イメージ、または `draw.war` をリリースから取って静的配信する形で再現できる。後者では `PreConfig.js` の `DRAWIO_PUBLIC_BUILD` を報告者の環境に合わせないと v24 と v26 の挙動差が出ない。
- **既定の `embed.diagrams.net` では再現しない**: 自前ホスト対応の不具合はどれも既定構成では出ない。unit テストだけでは捕まらない。

### 未解決のまま残っていること

- v28 系以前のインスタンスは `stencils/` `shapes/` を同梱していない（28.2.9 に無く、31.1.5 にはある）。完全な閉域ではこれらの図形が出ない。draw.io のバージョン側の制約。
- `PROXY_URL`（図の中から参照する外部画像の取得口）は対象外。自前ホストのイメージに該当のサーブレットが無く、向ける先がない。
- `offline=1` を付けると保存／終了ボタンが消える（#10478 のもう 1 つの症状）。draw.io 側の仕様で、`stealth=1` または `lockdown=1` に変えれば表示される。**GROWI 側では直さない方針**で、issue で案内している。
- CodeQL の指摘 2 件が PR #11633 に付いている（`drawio-assets.ts` の SSRF、`adopt-mathjax.spec.ts` の URL 部分文字列判定）。

## Desired Outcome

- draw.io 連携を次に触る人が、**spec を読めば足りる**状態になっている。根拠を探して PR やコミット履歴を掘り直す必要がない。
- 回帰したときに壊れる不変条件が要件として書かれ、それぞれ既存のテストに紐づいている（紐づく先が無いものは、その事実が書かれている）。
- `features/drawio/client/self-hosted/README.md` の内容が design.md に移り、README は削除されている。根拠の置き場所が 2 つに分かれていない。
- `features/drawio/CLAUDE.md` があり、この spec を読むよう誘導している。関心マップに載っているコードを触るとき（`features/drawio/` の外を含む）に spec へ行き着く。
- 関心マップがあり、`features/drawio/` の外にある draw.io 関連コードも把握できる。

## Approach

**as-built を書く保守用 spec**（実装の変更は伴わない）。

- **requirements.md** — 現行の不変条件を EARS で書く。「これから作る機能」ではなく「壊れたら不具合になる約束」を列挙する。既存テストが担保している項目はそれを明記し、担保が無い項目は無いと書く。
- **design.md** — README の内容（機構と理由）を移し、関心マップと検証手順を加える。#11633 の本文にある根本原因の説明もここに集約する。
- **tasks.md** — README の削除と `features/drawio/CLAUDE.md` の追加のみ。コードの挙動は変えない。

**順序の制約**: README の削除は、内容が design.md に移り終わったあとに行う。先に消すと根拠が失われる。

`README.md` は PR #11633 のブランチ（`fix/9774-10478-drawio-selfhosted`）で追加されたものなので、その削除と `CLAUDE.md` の追加は同じブランチに乗せる。

## Scope

- **In**:
  - draw.io 連携全体の as-built 記述（自前ホスト対応・ビューア・エディタ・保存形式・設定）。自前ホスト対応を最も詳しく書く。
  - 関心マップ（どの関心がどのコードにあるか）の管理。`features/drawio/` の外も含む。
  - 現行の不変条件の要件化と、それを担保しているテストの対応づけ。
  - 検証手順（2 世代の draw.io、閉域、既定構成での無変化確認）。
  - `features/drawio/client/self-hosted/README.md` の内容移設と削除。
  - `features/drawio/CLAUDE.md` の作成（spec への誘導）。
- **Out**:
  - コードの挙動を変える修正・リファクタ。既知の未解決事項（CodeQL 2 件、v28 系の stencil 未同梱、`PROXY_URL`、`offline=1`）は「将来課題」として記録するだけで、この spec では直さない。
  - PR #11633 そのものの内容変更。この spec は #11633 の成果を記述する側で、実装をやり直す側ではない。
  - `packages/remark-drawio` と `apps/app` の間の責務再配置。
  - draw.io 本体（`jgraph/drawio`）側の変更や upstream への報告。
  - 図の描画以外の markdown 描画系（`renderer.tsx` の他プラグイン、presentation、bulk-export の plugin-set）。

## Boundary Candidates

要件として書き出す候補となる不変条件（責務の切れ目）。

- **起動順**: `prepareSelfHostedDrawio` は `viewer-static.min.js` の挿入前、`adoptSelfHostedDrawio` は最初の描画前。
- **MathJax は 1 回だけ起動する**: 焼き込み先を指す `<script>` をそもそも作らせない。
- **参照先の振り分け**: XHR で読まれるもの（stencils / shapes / styles）は GROWI のオリジン経由、`<img>` で読まれるものはインスタンス直。
- **proxy の接続先は設定からのみ決める**: リクエストの値から決めない。許可リスト・拡張子由来の Content-Type・リダイレクト追随なし・上限あり。
- **自前ホスト判定は単一の関数**: client と server が同じ答えを出す。
- **注入 CSS は背景と文字色を必ず対で指定する**: Save / Exit ボタンには当てない。
- **GROWI が付ける URL パラメータは `set`**: `DRAWIO_URI` 側の同じキーを黙って壊さない。
- **ビューアの再描画は幅の変化のみ**: 高さのみの変化（ページ送り）では再描画しない。
- **保存形式は単一ページの表現を変えない**: 複数ページのときだけ `mxfile` で包む。
- **既定の `embed.diagrams.net` の挙動は変えない**: 自前ホスト向けの細工は自前ホストのときだけ効く。

## Out of Boundary

- 挙動を変える修正（別 spec / 別 PR で扱う）。
- `packages/remark-drawio` の責務再配置。
- draw.io 本体への変更。
- `features/drawio/` 配下以外のコードの所有権。この spec は関心マップとして**指す**が、それらのコードの設計判断を奪わない。

## Upstream / Downstream

- **Upstream**: PR #11633（自前ホスト対応の実装。この spec が記述する対象）、PR #11524（複数ページ保存とページ送り）、設定 `app:drawioUri`、`packages/remark-drawio`、`packages/editor`。
- **Downstream**: `features/drawio/CLAUDE.md`（この spec へ誘導する）。今後の draw.io 関連の修正 spec（未起票。将来課題を参照）。

## Existing Spec Touchpoints

- **Extends**: なし（新規）。
- **Adjacent**:
  - `auto-scroll` — `DrawioViewer` が `GROWI_IS_CONTENT_RENDERING_ATTR` を立てて描画中を知らせる。再描画の判定を変えるとこちらに影響する。
  - `bulk-export-pdf-rendering` — bulk-export の plugin-set が remark-drawio を含む。描画経路を共有する。
  - `presentation` — 同じく描画経路を共有する。

## Constraints

- **既定構成では再現しない**: 自前ホスト対応の不具合は `embed.diagrams.net` では出ない。検証には実インスタンスが必要で、unit テストだけでは足りない。
- **2 世代が必要**: v28 系（焼き込み先が 404）と v31 系（焼き込み先が生きている）で失敗の出方が逆になるため、片方だけでは検証にならない。
- **外に出られる環境でだけ壊れる問題がある**: MathJax の二重起動は閉域では出ない。閉域だけを検証環境にすると見落とす。
- **draw.io 内部の未公開な動きに依存している**: グローバル変数の初期化順、`Editor.initMath()` の判定、`mxStencilRegistry` のフォールバック経路。draw.io のバージョンが上がると前提が変わりうる。だから「なぜ」を残すこと自体がこの spec の目的である。
- **spec の記述言語は日本語**（既存 spec に合わせる）。コード内のコメントは英語のまま。

## Source Material

この spec を書くときの一次情報。

- **PR #11633** `fix(drawio): Stop depending on draw.io defaults for self-hosted instances`（master 宛て、OPEN、+1436/-208）— 4 つの不具合の根本原因、採った対策、検証結果（実ブラウザでの 6 ケース表）、既知の制約が本文に揃っている。**design.md の主材料**。
- **`features/drawio/client/self-hosted/README.md`** — 機構と理由、`window.MathJax` を触ってよい理由、proxy が要る条件と要らない条件、検証手順。**design.md へ移設して削除する対象**。
- **PR #11524** — 複数ページ保存（#11522）とページ送りの幅ゲート。保存形式と再描画判定の根拠。
- **関連 issue** — #9774（数式）、#10478（メニュー配色・URL パラメータ・`offline=1`）、#10726（stencil）、#11522（複数ページ）。
- **CodeQL の指摘 2 件** — `drawio-assets.ts:152`（SSRF）、`adopt-mathjax.spec.ts:86`（URL 部分文字列判定）。将来課題として記録する。
- **PrimaVista の記録** — 真因の調査過程、`ui=atlas` の kennedy フォールバック、`draw.war` を使った再現手順と `DRAWIO_PUBLIC_BUILD` の罠、`offline=1` を GROWI 側で直さない方針、以前の誤った原因説（`getLayout` 内のコンポーネント定義と `next/script` のキャッシュ。スクリプトの二重実行自体は v7.5.0 で解消済み）。**誤った原因説も「そこは既に否定済み」として残す価値がある**。

## 将来課題（未割当）

この spec では直さないが、記録しておく。着手時に要件を足すか、別 spec を立てる。

- CodeQL の指摘 2 件への対応。
- v28 系以前のインスタンスで stencil / shape が同梱されていない場合の扱い。
- `PROXY_URL`（図の中の外部画像）を対象にするかどうか。
- `offline=1` の扱い（現状は issue で `stealth=1` を案内する方針）。
- `packages/remark-drawio` と `apps/app` の責務再配置。
