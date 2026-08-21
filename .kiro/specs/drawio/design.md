# Design Document: drawio

## Overview

**この文書の役割**: draw.io 連携の**設計上の判断を保つ場所**である。仕様を変えるときは、まずここを直してから実装を追従させる（[仕様を変えるときの手順](#仕様を変えるときの手順)）。過去の実装を記録する台帳ではない。

**読み手**: draw.io 連携を変更する人。この連携は draw.io 内部の公開されていない動き（グローバル変数の初期化順、`Editor.initMath()` の判定、`mxStencilRegistry` のフォールバック経路）に頼っているため、**なぜ今の形なのかを知らずに触ると、一度否定された形に戻してしまう**。

### この文書に書くこと・書かないこと

| 書く | 書かない |
|---|---|
| 調べるのに時間がかかった事実（コードをさらっと読んでも分からない draw.io 側の挙動） | 関数の signature、ファイル構成、どのファイルに何があるか（コードを読むほうが確実） |
| 変わった形を採っている箇所の、そうした理由と経緯 | 素直な実装の説明 |
| 一度試して否定した形と、その理由 | テスト名の列挙（spec ファイルを読むほうが確実） |
| 自動テストで**捕まえられない**こと | 自動テストで捕まえられることの網羅 |
| 検証の手順（実インスタンスの立て方、見るべき点） | 差分の有無や実装時期などの経緯 |

**迷ったら書かない。** コードを読めば分かることをここに置くと、コードが変わったときに黙って古くなり、この文書の信頼を落とす。

### Goals

- 変更する人が、否定済みの形に戻さずに済むこと。
- 仕様変更のときに、この文書 → 実装 → 検証の順で進められること。
- 自動テストで捕まえられない範囲がはっきりしていること（「テストが通ったから大丈夫」を防ぐ）。
- draw.io のバージョンが上がったときに、何を再検証すべきかが分かること。

### Non-Goals

- draw.io 本体（`jgraph/drawio`）の変更や upstream への報告。
- 図の描画以外の markdown 描画系（他の remark プラグイン、presentation、bulk-export の plugin-set）。
- `packages/remark-drawio` と `packages/editor` の内部設計。この文書は[関心マップ](#関心マップ)でその所在を指すが、設計の所有権は持たない。

## Boundary Commitments

### This Spec Owns

- **自前ホストの draw.io に対する手当て** — 資産の参照先、MathJax の置き場所、図資産の配信経路、エディタへ注入する配色と URL パラメータ。ここを変えるときはこの文書を直す。
- **draw.io との受け渡しの契約** — postMessage の分岐と、保存形式（単一ページ / 複数ページ）。
- **自前ホストかどうかの判定** — 判定の基準と、それが 1 か所に留まること。
- **検証の手順** — 自動テストで捕まえられない範囲と、その確かめ方。

### Out of Boundary

- **draw.io 側の仕様**。`offline=1` で保存／終了ボタンが消える件は draw.io の仕様なので GROWI 側では直さず、issue で `stealth=1` を案内する。
- **v28 系以前のインスタンスが `stencils/` `shapes/` を同梱しない件**。draw.io のバージョン側の制約。
- **`packages/remark-drawio` / `packages/editor` の内部設計**（上記 Non-Goals のとおり）。

### Allowed Dependencies

- 設定 `app:drawioUri`（env `DRAWIO_URI`）。
- `packages/remark-drawio`（描画と保存形式）、`packages/editor`（挿入操作）。公開 API を通して使う。
- `apps/app/AGENTS.md` — 関心マップへの導線を 1 行置く先。

**依存の制約**: この文書はコードを参照するが、**コード側からこの文書を指すコメントは足さない**（コメントと文書の二重管理になる）。導線は `features/drawio/CLAUDE.md` と `apps/app/AGENTS.md` の 2 か所だけに置く。

### Revalidation Triggers

| 変更 | 再検証すべきこと |
|---|---|
| draw.io のメジャーバージョンが上がる | `math4/es5` の配置、`atlas.css` の不在、`stencils/` の同梱、`Editor.initMath()` の判定が今も成り立つか。[手動確認](#手動確認の手順)を 2 世代で回す |
| `DRAWIO_URI` の設定の形が変わる | 自前ホスト判定の基準（[判定を 1 か所に保つ](#判定を-1-か所に保つ)） |
| `/_drawio-assets` の経路や許可リストが変わる | 配信経路の判断（[設計上の判断](#設計上の判断)） |
| `packages/remark-drawio` の公開 API が変わる | 保存形式と再描画の判定 |
| draw.io 関連のファイルが増減・移動する | [関心マップ](#関心マップ) |

## 関心マップ

draw.io の関心は `features/drawio/` に閉じていない。**変更の影響範囲をここだけで判断しないこと。**

| 関心 | 置き場所 |
|---|---|
| 自前ホスト判定・参照先の定数 | `features/drawio/is-self-hosted-drawio.ts`, `consts.ts` |
| 読み込み前後の 2 つの入口と自前ホスト対応 | `features/drawio/client/self-hosted/` |
| 図資産の配信 | `features/drawio/server/routes/drawio-assets.ts`（mount は `server/routes/index.js`） |
| ビューアのスクリプト挿入と起動順 | `components/Script/DrawioViewerScript/` |
| ビューア本体・再描画の判定・保存形式・markdown からの変換 | `packages/remark-drawio/src/`（`components/`, `utils/mxfile.ts`, `utils/embed.ts`, `services/renderer/`） |
| エディタ URL・注入 CSS・postMessage | `client/components/PageEditor/DrawioModal/` |
| markdown への書き戻し | `client/components/Page/markdown-drawio-util-for-view.ts`, `client/components/PageEditor/markdown-drawio-util-for-editor.ts` |
| 挿入操作・折りたたみ | `packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/DiagramButton.tsx`, `packages/editor/src/client/services/use-codemirror-editor/utils/fold-drawio.ts`, `packages/editor/src/states/modal/drawio-for-editor.ts` |
| 設定 | `server/service/config-manager/config-definition.ts` の `app:drawioUri`（既定 `https://embed.diagrams.net/`） |

## Architecture

GROWI は draw.io の中を書き換えられないので、前提を渡す手段は 3 つに限られる。

| 渡し方 | 使う場面 | 制約 |
|---|---|---|
| **読み込み前のグローバル変数** | ビューアの参照先すべて | `viewer-static.min.js` の評価前でなければ効かない |
| **URL パラメータ** | エディタの起動 | draw.io は query を順に代入するので、同じキーの重複は後勝ち |
| **postMessage（`configure`）** | エディタの配色・フォント | draw.io がテーマで塗る箇所は、上書きしない限り draw.io 任せ |

1 つ目が自前ホスト対応の骨格である。`viewer-static.min.js` が焼き込む参照先は、すべて次の形で初期化される。

```js
window.STENCIL_PATH  = window.STENCIL_PATH  || "https://viewer.diagrams.net/stencils";
window.DRAW_MATH_URL = window.DRAW_MATH_URL || "https://viewer.diagrams.net/math4/es5";
```

つまり **読み込み前に書いた値が生き残る**。「後から直す」のをやめて「先に決めておく」形に統一しているのは、次の節の理由による。

### なぜ後から直せないのか

**この節がこの文書の中心である。** どちらも「読み込み後に直す」実装を一度書いてから、実測で否定したものである。

#### 1. MathJax — 到達不能な script を取り除くだけでは直らない

対応する issue は **#9774**。`adopt-mathjax.ts` と `relocate-math-url.ts` の `refs:` コメントが指す先。

`Editor.initMath()` は `viewer-static.min.js` の末尾で実行され、焼き込み先の `startup.js` を指す `<script>` を追加する。**動的に挿入した classic script は、取得が完了すれば実行される。DOM から外しても実行は取り消されない。** そのため焼き込み先が実際に到達可能なとき（v29 以降が焼き込む `viewer.diagrams.net/math4/es5` は現在も生きている）、MathJax が 2 回起動し、2 回目が 1 回目の初期化を壊して次で死ぬ。

```
MathJax(?): Input Jax "tex" is not defined (has it been loaded?)
```

`MathJax.version` は返るのに `typeset` が関数にならず、`Editor.mathJaxQueue` に溜まったまま描画されない。**外に出られる環境でだけ壊れる**ため、閉域だけを見ていると気づけない。実測では v31.1.5 で 4〜6 回に 2〜5 回の頻度で数式が落ちた。

v28 で問題が出なかったのは、焼き込み先の `math/es5` が upstream で 404 で実行に至らなかったからで、**その 404 に助けられていただけ**だった。

**採っている形**: 何も取り除かない。読み込み前に `window.MathJax` を定義して `Editor.initMath()` の `typeof window.MathJax === 'undefined'` 判定を外し、**焼き込み先のスクリプトをそもそも作らせない**。そのうえで `onLoad` で `DRAW_MATH_URL` を直してから `Editor.initMath()` を呼び直す。起動は 1 回だけ。

#### 2. stencil — `libraries` の書き換えは効かない

`mxStencilRegistry.libraries` を書き換える形（`patchStencilRegistryUrls()`、削除済み）では**取得先が変わらない**。XHR の呼び出し元を記録して確認した実際の経路は次のとおり。

```
mxStencilRegistry.loadStencilSet → loadStencil → mxUtils.load → XHR
  URL: https://viewer.diagrams.net/stencils/aws4.xml   ← upstream のまま
```

理由は 2 つある。

- `libraries` の各項目は `SHAPES_PATH` / `STENCIL_PATH` から**バンドル評価時に組み立てられる**ので、後から書き換えるのは遅すぎる。
- `mxStencilRegistry.getStencil()` は `libraries` に該当が無いとき `STENCIL_PATH` を直接読むフォールバックを持つ。`libraries` だけ書き換えてもこの経路は素通しである。

**さらに、参照先を直すだけでも足りない（CORS）**。`STENCIL_PATH` を自前インスタンスへ向けると CORS で止まる。

```
Access to XMLHttpRequest at 'http://<instance>/stencils/aws4.xml' from origin '<growi>'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

`viewer.diagrams.net` は `access-control-allow-origin: *` を返すが、**`jgraph/drawio` の Tomcat は返さない**。stencil はスクリプトではなく XHR で取得されるため CORS の対象になる。これが「編集中は図形が出るのに、保存して閲覧に戻ると空の四角になる」（#10726 の症状）の正体である。エディタは iframe 内が同一オリジンなので影響を受けない。

**採っている形**: XHR で取得される 3 つ（`STENCIL_PATH` / `SHAPES_PATH` / `STYLE_PATH`）は GROWI 自身のオリジン経由にする。`<img>` で読まれる画像系は CORS の対象外なので、インスタンスへ直接向ける。

### 2 つの入口

```
prepareSelfHostedDrawio(drawioUri)   // viewer-static.min.js を挿す前
adoptSelfHostedDrawio(drawioUri)     // onLoad 内、最初の描画より前
```

分かれている理由は 1 つだけ: **MathJax の置き場所は事前に決められない**。draw.io は v28 以前が `math/es5`、v29 以降が `math4/es5` を同梱し、インスタンスは片方しか持たない。焼き込まれたパスはそのインスタンスの同梱配置と必ず一致するので、**それを読み取って再利用すればバージョン判定も追加の通信も要らない**。ただし読み取れるのはバンドルの評価後である。

**順序の制約は 2 つあり、どちらも守らないと静かに壊れる。**

- `prepareSelfHostedDrawio` は render 中に呼ぶ（effect ではない）。書き込む値はバンドルの評価中に読まれる。
- `adoptSelfHostedDrawio` は最初の描画より前。`initMath()` は組版を要求するリスナーも設置するので、これより前に作られた図は永久に組版されない。

### `window.MathJax` を触ってよい理由

グローバル変数を触るのは影響範囲が広く見えるので、根拠を残す。

- GROWI 自身のページ内数式は remark-math + rehype-katex で、**KaTeX は `window.MathJax` を見ない**。
- `viewer-static.min.js` は図の無いページでも読み込まれるので、**draw.io は既にすべてのページで `window.MathJax` を設定している**。このコードはグローバル変数を持ち込むのではなく、そこに何が入るかを決めているだけ。
- `adoptSelfHostedDrawio` が走った後の値は draw.io 自身の設定オブジェクトで、従来と同じ。

**唯一の注意点**: 2 つの入口の間、この変数は仮の `{}` を保持する。`typeof window.MathJax !== 'undefined'` を「MathJax がある」と解釈するもの（自前の MathJax を読み込むカスタムスクリプトやプラグイン）は、この間だけ誤解する。そのため**移し替えができない経路でも必ず仮の値を消す**。

### 配信経路が要る条件と、要らない条件

配信ルータは `DRAWIO_URI` が自前ホストを指しているときだけ答える。既定構成では 404 を返し、外部への要求も出さない。`viewer.diagrams.net` は `Access-Control-Allow-Origin: *` を送るので、ブラウザが直接読めるためである。`DRAWIO_URI` が解釈できない値のときも同じ扱いになる。

必要なのは **クロスオリジンの自前ホストがそのヘッダを送らない**からで、次の 2 つはどちらもこの必要をなくす。**使えるなら proxy より望ましい**。

- draw.io を GROWI と同じオリジンにリバースプロキシで載せる
- インスタンスに `Access-Control-Allow-Origin` を返させる

どちらも GROWI 単独では手配できない。だから配信ルータが存在する。

### 判定を 1 か所に保つ

参照先を差し替えるのは自前ホストのときだけで、配信ルータもそのときだけ答える。**両者が別の基準で判断すると「誰も要求しない経路が開いている」または「差し替えたのに配信が 404」という食い違いが起きる。** だから判定は `isSelfHostedDrawio` 1 つに集約し、client と server の両方がそれを呼ぶ。

解釈できない値は「自前ホストでない」とする。差し替える先が無く、draw.io の既定に委ねるのがましな失敗だからである。

依存の向きは `consts` → `isSelfHostedDrawio` → { client 側, server 側 } → { 呼び出し側 } の一方向で、**client と server は互いを import しない**。この形が、判定を 1 つに保ちながら両者を分けられている理由である。

## 設計上の判断

コードを読んでも「なぜそうしているのか」が分かりにくいものだけを挙げる。

| 判断 | 理由 |
|---|---|
| **配信ルータの取得先ホストは、検査ではなく構造で固定する** | `resolveAsset` が `new URL(assetPath, subtree)` ではなく `target.pathname` への代入を使うのはこのため。前者だと `//elsewhere/x` や `http://elsewhere/x` が authority として解釈され、別ホストへ移る。代入ならホストは `assetPath` から読まれないので、**どんな値でもホストを動かせない**。ただし代入でも `..` は解決されるため、範囲内かの確認は別途必要 |
| **範囲内の確認を 2 か所で行う** | 組み立て時（`resolveAsset`）と、要求の直前（`readAsset`）。後者があるのは、前者に穴があっても要求が範囲外へ出ないようにするため |
| **`Content-Type` は上流の申告を使わない** | 応答は GROWI のオリジンから返るので、上流の `text/html` を通すと同一オリジン文書になる。拡張子から決めて `nosniff` を付ける |
| **取得の上限は「暴走の歯止め」で、予算ではない** | `stencils/aws4.xml` が 6.5 MB あるため、実在のライブラリが超えうる値に**下げる**と図形が黙って出なくなる。上げる変更より下げる変更のほうが危険 |
| **配信ルータに認証を付けない** | 共有ページの未ログイン閲覧者にも必要で、GROWI のデータは通らない。宛先は設定で固定され、通るのは draw.io 自身のライブラリファイルのみ |
| **上流の取得に `~/utils/axios` を使わない** | 共有ラッパーは `transformResponse` に `convertStringsToDates` を挟み、配列でないオブジェクトをキーごとに走査するため、**Buffer が素のオブジェクトになってバイト列が失われる**。`fetch` を使う理由がこれ（`routes/ogp.ts` も同じ理由でこのラッパーを避けている） |
| **単一ページの保存表現を変えない** | 複数ページを保存できるようにしたとき（#11522）、単一ページは従来どおり最初の `<diagram>` の innerHTML のままにした。既存ページを開いて保存し直しても markdown に差分が出ないようにするため。複数ページのときだけ全体を `<mxfile>` で包む |
| **保存形式の生成と検出を同じファイルに置く** | 離れていると片方だけ変わって食い違う。`packages/remark-drawio/src/utils/mxfile.ts` に同居させ、往復をテストで固定している |
| **ビューアの再描画は幅の変化だけで行う** | ページ送りでは図の高さだけが変わる。高さでも再描画すると新しいインスタンスが先頭ページから描き直し、送ったページに留まれない（#11524） |
| **エディタ URL のパラメータは `append` ではなく `set`** | draw.io は query を順に代入して `urlParams` を作るので、同じキーが重複すると後勝ちになり、`DRAWIO_URI` 側の指定が黙って無効になる |
| **注入 CSS は背景と文字色を対で指定し、保存／終了ボタンには当てない** | draw.io v26 で `styles/atlas.css` が削除され、配色は `grapheditor.css` の `.geAtlas` 配下（body に `geAtlas` が付いたときだけ有効）へ移った。自前ホストでは `ui=atlas` が `Editor.themes` に無く黙って `kennedy` にフォールバックするので `geAtlas` が付かず、既定の文字色 `#3f3f3f` が背景 `#334455` に乗る（実測コントラスト比 約 1.05:1）。一方ボタンは draw.io が明るい背景に濃い文字で描くので、一括指定すると今度はボタンが読めなくなる |

**失敗時の方針**: どの失敗も例外を上へ投げない。図が 1 つ壊れてもページは表示される。**代わりに、失敗が利用者に伝わらないという弱さがある** — 最も顕著なのは `DRAWIO_URI` が解釈できないとき、エディタのモーダルがローディング表示のまま止まり、記録も `debug` なので運用者にも見えない（[将来課題](#将来課題)）。運用時の手がかりは配信ルータの `warn`（許可しなかったパス、範囲外の location、サイズ超過）である。

## 仕様を変えるときの手順

この連携に仕様変更を加えるときは、次の順で進める。**実装を先に変えてこの文書を後回しにすると、次の人が否定済みの形に戻す。**

1. **この文書の該当節を先に直す。** とくに [なぜ後から直せないのか](#なぜ後から直せないのか) と [設計上の判断](#設計上の判断) に反する変更をしようとしていないか確かめる。反するなら、その判断が今も有効かを実測で確かめてから書き換える（過去の判断はすべて実測に基づく）。
2. **[否定済みの原因説](#否定済みの原因説)を確認する。** これから採ろうとしている形が、既に否定されたものでないか。
3. requirements.md の該当する受け入れ基準を直す。振る舞いが変わるなら基準も変わる。
4. 実装を変える。落ちるはずのテストが落ちることを確認する（落ちないなら、そのテストは守っていない）。
5. **[自動テストで担保していないこと](#自動テストで担保していないこと)に該当する変更なら、[手動確認](#手動確認の手順)を回す。** ここが最も飛ばされやすい。
6. [Revalidation Triggers](#revalidation-triggers) に当てはまるなら、指定された再検証を行う。

## 検証

### 自動テストで担保していないこと

**この一覧が「テストが通ったから大丈夫」を防ぐための本体である。** 自動テストで捕まえられる範囲は spec ファイルを読めば分かるので、ここには**捕まえられないもの**だけを挙げる。

| 担保されていないこと | 確かめ方 |
|---|---|
| 実際に数式が描画される | 下記の手動確認。焼き込み先へ要求を出さない機構の側は担保あり |
| 実際に図形が描画される、ブラウザから draw.io 本家へ要求が出ない | 下記の手動確認。参照先を GROWI のオリジンへ向けることの側は担保あり |
| 数式を有効にしていない図が組版されない | draw.io 側の判断で GROWI に分岐が無い。実測でのみ確認 |
| メニューの文字が実際に判読できる | 実測（コントラスト比）。自動テストは「背景を塗った要素に文字色があるか」という構造だけ |
| 保存した図がエディタで**実際に**全ページ復元される | 下記の手動確認。GROWI 側が保存内容に手を加えず返すことは担保あり |
| ページ送りが実際に保たれる | 下記の手動確認。再描画の判定自体は担保あり |
| 既定構成が従来どおり | 下記の手動確認 |
| 資産の取得が両方失敗したとき、図形だけが空になりページの描画は続く | 未検証。サーバが 502 を返すことは担保あり |
| 取得の**時間**の上限（10 秒） | 繰り越し。理由は[将来課題](#将来課題) |

### 手動確認の手順

**自前ホストのインスタンスを実際に立てる必要がある**。ここで扱う失敗はどちらも既定の `embed.diagrams.net` では現れない。

**2 世代を並べる**。失敗の出方が逆になるため、片方だけでは検証にならない。

```bash
docker run -d --name drawio-31 -p 8080:8080 jgraph/drawio:latest      # math4/es5 を焼き込む
docker run -d --name drawio-28 -p 8081:8080 jgraph/drawio:28.2.9      # math/es5 を焼き込む
```

| 世代 | 何を捕まえるか |
|---|---|
| **v28 系** | 参照先の付け替え。焼き込み先の MathJax パスが upstream で 404 なので、付け替えが効いていなければ数式が出ない |
| **v31 系** | 二重起動。焼き込み先が生きているので、抑止が効いていなければ MathJax が 2 回起動して壊れる |

`DRAWIO_URI` をどちらかに向け、**数式（Mathematical Typesetting を有効化）と AWS 図形の両方を含む図**を置いたページを閲覧する。1 回の描画で両方を通せる。

**見るべきもの**:

- `document.querySelectorAll('mjx-container').length` が 0 より大きい
- `stencils/` と `shapes/` への要求がすべて GROWI のオリジンへ行き、`viewer.diagrams.net` へは 1 件も行かない
- `startup.js` の取得が**ちょうど 1 回**、設定済みインスタンスから
- メニューバーの文字が読める（エディタを開く）

**外に出られる状態と出られない状態の両方で行う。** 二重起動は外に出られる環境でだけ現れるため、閉域だけを検証環境にすると見落とす。閉域はブラウザとサーバーの両方を遮断する。

**既定構成での無変化確認**: `DRAWIO_URI` を既定に戻し、ビューアの数式とエディタのメニュー表示が変わっていないことを確認する。

**基準値**（この手順で得た実測。再検証時の比較対象）:

| ケース | 数式 | stencil | ブラウザからの外部通信 |
|---|---|---|---|
| v31.1.5（MathJax 4）× 4 回 | OK | OK | 0 |
| v28.2.9（MathJax 3） | OK | OK | 0 |
| v31.1.5 閉域（ブラウザ・サーバー両方遮断） | OK | OK | 0 |
| v28.2.9 閉域 | OK | 出ない（v28 は同梱していない） | 0 |
| v31.1.5 サブパス `/draw/` | OK | OK | 0 |
| v31.1.5 数式無効の図 | 正しく出ない | OK | 0 |

配信経路は実サーバーでも確認済み: `stencils/aws4.xml`（6.5 MB）がインスタンス直の取得と md5 一致、`WEB-INF/web.xml` と `index.html` は許可リストにより 404。

**未実施**: サブパスを含む構成（`http://example.com/drawio` など）での実ブラウザ確認。単体テストはサブパスの保持を確認しているが、実際の描画は未確認。

### テストを書くときに効いた型

この領域でテストを足すときに、素直に書くと「落ちないテスト」になった箇所。

- **「404 が返った」と「外部要求が出ていない」は別々に検証する。** fixture サーバに要求パスを記録させ、**拒否されるはずのパスも fixture に登録しておく**（登録しないと「要求が届いていれば 200 だった」ことが示せず、拒否と上流 404 を区別できない）。
- **上限のテストは上下から挟む。** 「超過を拒否する」だけでは上限を**下げる**変更で落ちない。実在する最大のライブラリと同じ大きさが通ることも固定する。
- **判定の単一性は、呼び出し箇所を数えても守れない**（別実装を足しても呼び出し箇所は減らない）。判定の材料（既定オリジンの定数とホストの直書き）がどのファイルに現れるかを走査する。走査先の実在も併せて検証する（改名で空走査になり無条件 green になるのを防ぐ）。
- **`configManager.getConfig` の mock は `mockReturnValue` にしない。** 全キーに同じ値を返すと、本番が読むキー名を rename しても green のままになる。キーで分岐させる。
- **vitest の fake timer は `AbortSignal.timeout` を動かせない**（実測）。打ち切りのテストは実時間待ちしか書けない。

## 将来課題

| 課題 | 種類 | メモ |
|---|---|---|
| 取得の**時間**の上限（10 秒）のテスト | テストの穴 | vitest の fake timer は `AbortSignal.timeout` を動かせない（上限の 10 倍まで進めても `aborted` は false。Node は `node:timers` 経由で予約し、vitest 内では橋渡しも呼ばれない）。残る手段は実時間 10 秒待ちで、当該ファイルが 0.47 秒 → 約 10.5 秒になる。`AbortSignal.timeout` を spy する形は実装方法を見るテストになる。上限を注入できる縫い目を本番コードに入れれば書けるが、上限は暴走の歯止めなので取引として割に合わないと判断した |
| 資産の取得が両方失敗したときのビューア側の見え方 | 未検証 | サーバが 502 を返すことは担保済み |
| サブパス構成での実ブラウザ確認 | 未検証 | |
| `DRAWIO_URI` が不正なとき利用者に理由が伝わらない | 挙動 | モーダルがローディング表示のまま止まり、記録も `debug` |
| `DRAWIO_URI` に `user:pass@host` 形式を設定すると図資産が全て 404 | 挙動 | 範囲確認が `target.href`（userinfo を含む）を `target.origin` から組んだ範囲（含まない）と比べるため。閉じる方向なので安全側だが、`warn` は userinfo が原因だと書かない |
| CodeQL の指摘 2 件 | 静的解析 | `drawio-assets.ts` の SSRF（上記の 2 段の防御で守っているが、静的解析からは「リクエスト由来の値が URL に入る」形に見える）、`adopt-mathjax.spec.ts` の URL 部分文字列判定 |
| `client/self-hosted/index.ts` が `isSelfHostedDrawio` を再公開しているが import 元が無い | 設計 | barrel は外部の利用者が必要とするものだけを再公開する規約（`.claude/rules/coding-style.md`）に照らすと 1 行削れる |
| `PROXY_URL`（図の中から参照する外部画像の取得口）が未対応 | 外部制約 | 自前ホストのイメージに該当のサーブレットが無く（`/proxy` が 404）、向ける先が無い。ビューアの経路では使われない |
| `packages/remark-drawio` と `apps/app` の責務再配置 | 設計 | 保存形式の生成と検出は同居させたが、描画側と生成側の分担は未整理 |
| `packages/*` から spec への入口 | 文書 | 入口を増やすと「置き場所を 1 つにする」目的と逆になるため置いていない。drift が起きたら再検討 |

## 否定済みの原因説

同じ誤りを繰り返さないために残す。**いずれも調査済みで否定されている。** 新しい説を採る前にここを見ること。

| 説 | なぜ違うか |
|---|---|
| `viewer-static.min.js` の二重実行で `initMath` がスキップされる | 二重実行は 7.5.0（`next/head` → `next/script`）で解消済み。ただし「`Editor.initMath` が `typeof window.MathJax === 'undefined'` でガードされている」という観察自体は正しく、それが**現在の抑止の仕組みに使われている** |
| `getLayout` 内でコンポーネントを定義していることが原因 / `next/script` のキャッシュが原因 | どちらも無関係。誤った調査コメントを issue に投稿し、後に訂正済み |
| `mxStencilRegistry.libraries` を書き換えれば stencil の参照先は直る | 直らない。書き換えは遅すぎ、かつ `getStencil()` のフォールバックを素通しする（[なぜ後から直せないのか](#なぜ後から直せないのか)） |
| 参照先を設定済みインスタンスへ直接向ければ stencil は読める（配信経路は要らない） | 読めない。XHR で読まれるので CORS で止まる（[配信経路が要る条件と、要らない条件](#配信経路が要る条件と要らない条件)） |
| 焼き込み先の `<script>` を取り除けば MathJax は直る | 直らない。取り除いても実行は取り消されない。外に出られる環境でだけ二重起動して壊れる（同上） |
| `atlas.css` は draw.io にまだある | v26 で削除された（[設計上の判断](#設計上の判断)の注入 CSS の行） |

## 参照

- issue: #9774（数式）、#10478（メニュー配色・URL パラメータ・`offline=1`）、#10726（stencil）、#11522（複数ページ）
- 調査の経過と、この文書に載せなかった一次資料: [research.md](research.md)
