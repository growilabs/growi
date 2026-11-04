# Research Log: drawio

**現況は [design.md](design.md) にある。** この文書は、そこに至るまでに調べたことと、**調べ方・実測値・そこで得た再利用できる知見**を残す。設計の結論は design.md 側が正で、ここは重複させない。

## draw.io 側の挙動で、調べるのに時間がかかったもの

結論は design.md にある。ここには**どう確かめたか**を残す（同じことを再確認する必要が出たときのため）。

| 事実 | どう確かめたか |
|---|---|
| `mxStencilRegistry.libraries` を書き換えても取得先が変わらない | XHR の呼び出し元を記録して実際の経路を出した（`loadStencilSet → loadStencil → mxUtils.load → XHR`）。URL は upstream のままだった。`getStencil()` のフォールバックはソースで確認 |
| 自前ホストの Tomcat は `Access-Control-Allow-Origin` を返さない | 実インスタンスに XHR を投げてブラウザのエラーを確認。`viewer.diagrams.net` は `*` を返すことも同時に確認 |
| 焼き込み先の `<script>` を取り除いても MathJax は 2 回起動する | v31.1.5 で繰り返し実行。**4〜6 回のうち 2〜5 回**の頻度で数式が落ちた（タイミング次第で揺れる）。`MathJax.version` は返るのに `typeset` が関数にならず `Editor.mathJaxQueue` に溜まる、という中間状態も観測 |
| v28 は焼き込み先が 404 で助かっていただけ | v28 の焼き込み先（`math/es5`）を直接叩いて 404 を確認。v29 以降の `math4/es5` は現在も生存 |
| `ui=atlas` が黙って `kennedy` にフォールバックする | 自前ホストの `Editor.themes` に `atlas` が無いことを確認。body に `geAtlas` が付かないことを DOM で確認 |
| v26 で `styles/atlas.css` が削除された | v24 と v26 の配布物を比較。配色が `grapheditor.css` の `.geAtlas` 配下へ移っていることも確認 |
| メニューが読めない状態のコントラスト比 | 実測 **およそ 1.05 対 1**（`#3f3f3f` on `#334455`）。文字色を足して解消することも実測 |
| `offline=1` で保存／終了ボタンが消えるのは draw.io の仕様 | `isStandaloneApp()` が真のとき `App.updateButtonContainer()` が置き場を `display: none` にする経路をソースで確認。**`stealth=1`（または `lockdown=1`）なら表示される**ことを v26.2.15 で実測。v24 で問題にならなかったのは、当時ボタンが別の div にあって対象外だったため |

### 再現環境の作り方

実インスタンスを立てるのが最短。docker を使えないときは、`jgraph/drawio` のリリースから `draw.war` を取得して unzip し、ローカルの静的サーバで配信して Playwright から GROWI と同じ `configure` のやりとりを再現すれば足りる。

**注意点**: 報告者の環境は `PreConfig.js` の `DRAWIO_PUBLIC_BUILD` が false 相当であり、**これを再現しないと v24 と v26 の挙動差が出ない**。

## 設計上の選択と、却下した案

| 選んだ形 | 却下した案とその理由 |
|---|---|
| design.md 1 ファイルに集約 | design と research に分ける案 / 検証手順を別ファイルにする案 → どちらも「根拠の置き場所を 1 つにする」目的と逆になる。README が 1 ファイルで成立していたことも根拠 |
| `features/drawio/CLAUDE.md` と `apps/app/AGENTS.md` の 2 か所だけに導線を置く | `packages/remark-drawio` / `packages/editor` にも置く案 → 届くようにはなるが入口が 3 つに増える。関心マップから外側を辿れれば足りると判断。drift が起きたら再検討 |
| `CLAUDE.md` は指すだけにして根拠を書かない | 要点を要約して書く案 → design.md と二重管理になり、必ずどちらかが古くなる |
| 「後から直せない」2 件を 1 節に統合 | 要件ごとに分けて書く案 → MathJax と stencil は issue も症状も別だが**構造は同じ**（バンドル評価前に決まるものを後から直そうとして失敗）。分けて書くと、次のバージョンで同じ罠に別の形で落ちる |
| コード側から spec を指すコメントを足さない | 各ファイルに「詳細は spec を見よ」を書く案 → コメントと spec の二重管理。既存の `refs:` issue リンクはそのまま残す |

## spec を書く過程で見つかった、spec 自身の誤り

**この節が再発防止の本体である。** 「書いたものは正しい」という前提が実際に崩れた記録。

- **担保していると書いていたテストが、実際には担保していなかった（3 件）**。フォールバックを `readAsset` のテストで担保済みとしていた（そのテストは `onSuccess` が呼ばれることしか見ていない）／`index.spec.ts` を「2 つの入口」の担保として扱っていた（実際は読み込み前だけ）／リダイレクトを未検証としていた（実際はテストがあった）。**過大申告のほうが危険**で、テストを消しても誰も気づかない。
- **実装がしていることが要件に無かった**。`rebaseDrawioAssetPaths` は 7 つのグローバルを書き換えるのに要件は 6 つしか書いていなかった（漏れていたのは `DRAWIO_LIGHTBOX_URL`）。
- **design.md がコードとずれていた（6 件）**。barrel が 3 つ公開しているのに「2 つだけ」と書いていた／関心マップのパスが `src/` 抜けで辿れなかった／API 契約の許可条件が実装より緩かった／`DRAWIO_URI` に `user:pass@` を入れると全 404 になる経路が未記載 など。**独立に突き合わせないと静かにずれる。**
- **他エージェントの報告を検証せずに反映して、正しかった記述を誤りに書き換えた**。「空メッセージの分岐は実装に無い」という報告をそのまま反映したが、実際は `exit` 分岐など存在せず、空メッセージ分岐は `DrawioCommunicationHelper.ts:100` に実在した（報告者が別の行を取り違えていた）。**「A は無い」という否定形の報告はとくに疑う** — 肯定形は追試が容易だが、否定形は探し方が甘いだけの可能性が常にある。

## テストを足すときに効いた型（実測値つき）

要約は [design.md](design.md#テストを書くときに効いた型) にある。ここには数値と手順を残す。

- **vitest の fake timer は `AbortSignal.timeout` を動かせない。** `vi.useFakeTimers()` の後、上限の 10 倍まで `vi.advanceTimersByTimeAsync` で進めても `signal.aborted` は `false` のまま（`toFake` を明示しても同じ）。Node は `AbortSignal.timeout` → `setWeakAbortSignalTimeout` で **`node:timers` モジュールの `setTimeout` を call time に引く**（`globalThis` は使わない）。素の node スクリプトなら `node:timers` を patch すれば観測できるが、**vitest の runtime の中では橋渡ししても呼ばれない**。実時間なら効く（打ち切りは 10,006 ms で観測）。
- **64 MiB の Buffer を `expect(x).toBeUndefined()` に直接渡すと V8 が OOM する**（vitest が diff を作ろうとして heap 4 GB）。`x?.byteLength` を経由させると失敗が読める形で出る。サイズ上限のテスト自体は安価（64 MiB の確保 23 ms + 読み取り 128 ms、worker RSS ピーク約 380 MiB、ファイル全体で +155 ms）。
- **上限のテストは上下から挟む。** 「超過を拒否する」だけでは上限を**下げる**変更で落ちない。実在する最大のライブラリ（`stencils/aws4.xml` は draw.io 31.1.5 で 6.5 MB）と同じ大きさが通ることも固定する。
- **「404 が返った」と「外部要求が出ていない」は別々に検証する。** fixture に要求パスを記録させ、**拒否されるはずのパスも fixture に登録しておく**（登録しないと「要求が届いていれば 200 だった」ことが示せない）。「取得してから 404 を返す」mutation では、状態コードは 404 のまま要求件数の assertion だけが落ちる。
- **`configManager.getConfig` の mock は `mockReturnValue` にしない。** 全キーに同じ値を返すと、本番が読むキー名を rename しても green のまま。キーで分岐させると rename で 6 件 RED になった。
- **drift spec は走査対象の実在も検証する。** `consts.ts` を改名すると 4 件のうち 3 件が RED、走査先を存在しないディレクトリに向けると 4 件すべてが RED になることを確認済み。これが無いと、改名で走査が空になり無条件 green になる。

## 一次資料

- issue: #9774（数式）、#10478（メニュー配色・URL パラメータ・`offline=1`）、#10726（stencil）、#11522（複数ページ）
- PR: #11633（自前ホスト対応）、#11524（複数ページ保存とページ送り）

## 過去の記録について

この文書は当初、gap 分析・設計時の discovery・タスクごとの突き合わせ表を時系列で追記した形だった（README 147 行の移設対応表 37 行、受け入れ基準 55 件ごとの担保判定表など）。**それらは一度きりの証跡で、役目を終えたので落とした。**

- README の移設は完了し、内容は design.md にある（37 単位を突き合わせ、欠落 3 件を追記したうえで削除した）。
- 受け入れ基準ごとの担保判定は、requirements.md の各要件末尾の `_未担保:_` に蒸留した。**担保されている側を列挙する形はやめた** — spec ファイルを読むほうが確実で、列挙は古くなるだけである。
- 検討の過程で挙げた案の比較・工数見積り・フェーズ間の申し送りも、結論が上の節に入ったので落とした。

必要なら git 履歴（`.kiro/specs/drawio/research.md`）から辿れる。
