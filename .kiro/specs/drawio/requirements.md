# Requirements Document

## Introduction

GROWI の draw.io 連携について、**今どうなっているか・なぜそうなっているか・どう検証するか**を残す flagship spec（as-built を書く保守用 spec）。draw.io 連携全体の関心マップもここで管理する。

draw.io 連携の不具合は、これまで「GROWI が draw.io 側の既定値・配色・URL の扱いに暗黙に依存していた」ことが原因で、draw.io のバージョンが上がるたびに表に出てきた（#9774 数式が描画されない / #10478 メニューの文字が読めない・`DRAWIO_URI` のパラメータが無効になる / #10726 stencil が空の四角になる / #11522 複数ページが無警告で消える）。いずれも PR #11633 と #11524 で修正済みだが、**直したときの根拠がコード中のコメント・PR 本文・`features/drawio/client/self-hosted/README.md` の 3 か所に散っている**ため、次に触る人が同じ調査を一からやり直すことになる。

そこでこの spec は 2 つを引き受ける。

1. **回帰したら不具合になる約束を、観測できる振る舞いとして書き出す**（要件 1〜8）。挙動は変えない。今あるものを、壊れたと分かる形で固定する。
2. **保守情報の所在を 1 つにし、検証の仕方を残す**（要件 9〜10）。README の内容を design へ移して README を削除し、`features/drawio/CLAUDE.md` から spec へ誘導する。単体テストで捕まらない失敗の確かめ方も spec に持たせる。

詳細な背景・調査経緯・一次情報の一覧は [brief.md](brief.md) を参照。

### Project Description (Input)

#### 誰が困っているか

draw.io 連携を次に触る開発者（および将来の自分）。自前ホスト対応の細工はとくに事情が重く、draw.io 内部の公開されていない動き（グローバル変数の初期化順、`Editor.initMath()` の判定、`mxStencilRegistry` のフォールバック経路）に頼っているので、**根拠を失うと安全に変更できない**。

#### 今どうなっているか

修正は済んでいるが、根拠が spec の体系（要件・設計・検証）に載っていない。さらに draw.io 関連のコードは `features/drawio/` に閉じておらず（`client/components/PageEditor/DrawioModal/`、`packages/remark-drawio/`、`packages/editor/`、`config-definition.ts`）、どの関心がどこにあるかを一望できる場所が無い。

#### 何が変わるべきか

spec を読めば足りる状態にする。回帰したら壊れる約束を要件として書き、既存テストに紐づける。README の内容を design へ移して README を削除し、`features/drawio/CLAUDE.md` から spec へ誘導する。関心マップを持ち、`features/drawio/` の外のコードも把握できるようにする。

## Boundary Context

- **In scope（この spec が受け持つもの）**
  - draw.io 連携の現況の振る舞いを、観測できる形で要件化すること（自前ホスト対応・ビューア・エディタ・保存形式・既定構成での無変化）。
  - 各要件を担保している既存テストとの対応づけ。担保が無いものは、無いと明記すること。
  - 検証手順（2 世代の draw.io、閉域と外部到達可能の両方、既定構成での無変化確認）。
  - 保守情報の所在（README の内容移設と削除、`features/drawio/CLAUDE.md` の追加、関心マップ）。
- **Out of scope（この spec では直さないもの）**
  - コードの挙動を変える修正・リファクタ。既知の未解決事項（CodeQL の指摘 2 件、v28 系インスタンスの stencil 未同梱、`PROXY_URL` 未対応、`offline=1` で保存／終了ボタンが消える件、`packages/remark-drawio` と `apps/app` の責務再配置）は将来課題として記録するだけ。
  - PR #11633 そのものの内容変更。この spec は #11633 の成果を記述する側で、実装をやり直す側ではない。
  - draw.io 本体（`jgraph/drawio`）側の変更や upstream への報告。
  - 図の描画以外の markdown 描画系（他の remark プラグイン、presentation、bulk-export の plugin-set）。
- **Adjacent expectations（隣接するものへの期待と、持たないもの）**
  - **draw.io インスタンスの運用者に期待すること**: `stencils/` `shapes/` を同梱するバージョン（31 系で確認）を使うこと。v28 系以前は同梱しておらず、完全な閉域ではその図形が出ない。これは draw.io のバージョン側の制約で、GROWI からは解消できない。
  - **draw.io 側の仕様として受け入れること**: `offline=1` を指定すると保存／終了ボタンが消える。GROWI 側では直さず、issue で `stealth=1` または `lockdown=1` を案内する方針。
  - **`auto-scroll` spec との関係**: ビューアは再描画の開始を「描画中」の目印で知らせており、`auto-scroll` がそれを見ている。再描画の判定を変えるときは `auto-scroll` の期待を壊していないか確かめる必要がある。この spec は `auto-scroll` の要件を持たない。
  - **`presentation` / `bulk-export-pdf-rendering` spec との関係**: 同じ描画経路（remark プラグイン）を共有する。描画結果の見え方に関わる変更はこれらにも及ぶ。この spec はそれらの要件を持たない。

## Requirements

### Requirement 1: 自前ホストの draw.io で数式が描画される

**Objective:** As a 自前ホストの draw.io を設定した GROWI の運用者, I want 図の中の数式が閲覧時に描画されること, so that 閉域や社内ネットワークでも数式入りの図が意図どおり読める

#### Acceptance Criteria

1. Where 自前ホストの draw.io が設定されている, when 数式を有効にした図を含むページを閲覧したとき, the GROWI のビューア shall その数式を描画する。
2. Where 自前ホストの draw.io が設定されている, when 図を閲覧したとき, the GROWI のビューア shall 数式描画エンジンを設定済みインスタンスから読み込み、その読み込みは 1 回だけ行う。
3. If 設定済みインスタンスが焼き込む数式エンジンの参照先が外部で到達可能である（draw.io v29 以降がこれに当たる）, then the GROWI のビューア shall それでも数式を描画する。
4. While ブラウザとサーバーの双方が外部ネットワークに出られない状態, the GROWI のビューア shall 数式を描画する。
5. Where 自前ホストの draw.io がサブパス配下に配置されている, when 数式を有効にした図を閲覧したとき, the GROWI のビューア shall その数式を描画する。
6. Where 数式を有効にしていない図, the GROWI のビューア shall 数式として組版しない（従来どおりの見え方を保つ）。

_担保しているテスト:_

- **AC 2 — 担保あり。** `adopt-mathjax.spec.ts`: `should boot MathJax from the configured instance`、`should boot MathJax exactly once, so the second boot cannot break the first`、`should repoint DRAW_MATH_URL, which the font path is derived from`、`should reuse the baked-in directory so the draw.io version needs no detecting`。ただしこれらは `viewer-static.min.js` の代役を spec 内に書いて当てているので、担保しているのは「そう振る舞う draw.io に対して GROWI 側の手当てが正しいこと」である。
- **AC 3 — 部分的。** 焼き込み先へ要求を出さないという機構は `adopt-mathjax.spec.ts` の `should stop the bundle from requesting the baked-in location at all` が担保する。**「それでも数式が描画される」ことは担保が無い。**
- **AC 5 — 部分的。** URL の組み立てだけを `relocate-math-url.spec.ts` の `should keep the sub path when draw.io is deployed under one` と `use-viewer-min-js-url.spec.ts` の `http://example.com/drawio` の行が担保する。**サブパス構成で実際に描画されることは担保が無い**（design の「未実施の手動確認」）。
- **AC 1・4 — 担保が無い。** 要件 10 の検証手順で確かめる。
- **AC 6 — 担保が無い。** 組版するかどうかは draw.io 側の判断で GROWI 側に分岐が無いため、当てるテストも無い。#11633 の実測（数式を有効にしていない図では組版されない）でのみ確認している。
- `relocate-math-url.spec.ts` は解釈できない値の扱い（`should return undefined when $reason`、`should return undefined when drawioUri cannot be parsed`）も担保する。移し替えができない経路で仮値を残さないこと（`adopt-mathjax.spec.ts` の `should put draw.io back to its own behaviour, asking for draw.io's location`、`should leave no suppression behind`、`should not throw when the bundle exposes no Editor`）は、特定の受け入れ基準ではなく design の SelfHostedEntryPoints の不変条件に対応する。
- **`index.spec.ts` が担保するのは 2 つの入口のうち読み込み前の `prepareSelfHostedDrawio` だけ**である。読み込み後の `adoptSelfHostedDrawio`（`adoptMathJax` を呼ぶ側）を呼ぶテストは 1 件も無いので、**そちらが「自前ホストのときだけ効く」ことは担保が無い**。

### Requirement 2: 自前ホストの draw.io で図形（stencil / shape）が描画される

**Objective:** As a 自前ホストの draw.io を設定した GROWI の運用者, I want AWS 図形などの標準以外の図形が閲覧時にも描画されること, so that 編集中は見えていた図形が保存後に空の四角にならない

#### Acceptance Criteria

1. Where 自前ホストの draw.io が設定されている, when 標準以外の図形を含む図を含むページを閲覧したとき, the GROWI のビューア shall その図形を描画する。
2. Where 自前ホストの draw.io が設定されている, when 図を閲覧したとき, the ブラウザ shall draw.io 本家のホストへ要求を出さない。
3. Where 共有ページを未ログインの閲覧者が開いたとき, the GROWI のビューア shall 図形を描画する。
4. If 設定済みインスタンスが該当の図形定義を同梱していない, then the GROWI shall draw.io 本家からの取得を試み、取得できたときは描画する。
5. If 設定済みインスタンスも draw.io 本家も該当の図形定義を返せない, then the GROWI のビューア shall ページの描画自体は続け、その図形のみが欠けた状態で表示する。
6. Where 自前ホストの draw.io がサブパス配下に配置されている, when 図を閲覧したとき, the GROWI のビューア shall 図形を描画する。
7. Where 自前ホストの draw.io が設定されている, when 図を拡大表示（ライトボックス）したとき, the GROWI のビューア shall 編集への導線を設定済みインスタンスへ向ける。

_担保しているテスト:_

- **AC 7 — 担保あり。** `rebase-asset-paths.spec.ts` の `should point the lightbox at the instance itself when DRAWIO_URI has $reason`（末尾スラッシュ無し・有り・2 つ・query 付きの 4 通り）。
- **AC 2 — 部分的。** 参照先を GROWI のオリジンへ向ける側は `rebase-asset-paths.spec.ts` の `should route $global through GROWI's own origin because $reason`（`STENCIL_PATH` / `SHAPES_PATH` / `STYLE_PATH`）と `should read $global straight from the instance, since <img> is not bound by the same-origin rule`（`<img>` で読む 3 つはインスタンス直）が担保し、ビューアのバンドル自体をインスタンスから読むことは `use-viewer-min-js-url.spec.ts` が担保する。**ブラウザから本家への要求が実際に 0 件であることは担保が無い。**
- **AC 6 — 部分的。** サブパスの保持は `rebase-asset-paths.spec.ts` の `should keep the sub path when draw.io is deployed under one` と `drawio-assets.spec.ts` の `should resolve against "$drawioUri"`（`https://drawio.example.com/drawio/` の行）が担保する。**実際に描画されることは担保が無い。**
- **AC 1・3 — 担保が無い。** 要件 10 の検証手順で確かめる。
- **AC 4 — 担保が無い。** 本家へ切り替える判断は配信ルータ本体にあり、それを呼ぶテストが 1 件も無い（要件 3 の前置きを参照）。`drawio-assets.spec.ts` の `should report success so a fallback read can be logged as such` は `readAsset` が成功を呼び出し元へ通知することだけを確かめており、ルータが本家へ切り替えることは確かめていない。
- **AC 5 — 担保が無い。** 両方失敗したときに図形だけが欠けてページの描画が続くことは未検証（将来課題）。
- `drawio-assets.spec.ts` はバイト列がそのまま通ること（`should hand back exactly the bytes that were served`）も担保する。stencil が壊れる回帰を捕まえる要になっている。

### Requirement 3: 図の資産を GROWI 経由で配信する経路が安全である

**Objective:** As a GROWI の運用者, I want 図形定義を GROWI 経由で配信する経路が、任意の宛先や任意のファイルへの入口にならないこと, so that 図形を表示できるようにしたことが新しい攻撃面にならない

#### Acceptance Criteria

1. The GROWI の図資産配信 shall 取得先を、GROWI の設定値から解決した先とコードに定めた draw.io 本家のいずれかに限り、リクエストに含まれる値からは決定しない。
2. If 要求されたパスが許可された図形資産の形（許可されたディレクトリと拡張子の組み合わせ）に当てはまらない, then the GROWI の図資産配信 shall 404 を返し、外部への要求を一切出さない。
3. If 要求されたパスから組み立てた取得先が、設定済みインスタンスの許可された範囲の外を指す, then the GROWI の図資産配信 shall 404 を返し、その取得を行わない。
4. When 図形資産を配信するとき, the GROWI の図資産配信 shall Content-Type を要求されたファイルの拡張子から決定し、取得先の応答が申告した値は使わない。
5. When 図形資産を配信するとき, the GROWI の図資産配信 shall 応答に、ブラウザが内容の種類を推測しないよう指示するヘッダ（`X-Content-Type-Options: nosniff`）を付ける。
6. If 取得先がリダイレクトを返す, then the GROWI の図資産配信 shall リダイレクト先を追わず、その取得を失敗として扱う。
7. If 取得先の応答が 10 秒を超える、または 64 MiB を超える, then the GROWI の図資産配信 shall その応答を配信せず、その取得を失敗として扱う。
8. If 設定済みインスタンスからの取得が失敗した, then the GROWI の図資産配信 shall コードに定めた draw.io 本家からの取得を試み、それも失敗したときに 502 を返す。
9. Where 既定の draw.io（本家のホスト）が設定されている, when この経路に要求が来たとき, the GROWI の図資産配信 shall 404 を返し、外部への要求を出さない。
10. The GROWI の図資産配信 shall 認証を求めない。共有ページの未ログイン閲覧者にも必要で、GROWI のデータを含まないため。

_担保しているテスト:_

**前置き（この要件の担保を読むときの前提）:** **配信ルータ本体（`drawioAssetsRouterFactory`）を呼ぶテストは 1 件も無い。** `drawio-assets.spec.ts` が import しているのは `proxiableAssetExtension` / `resolveAsset` / `readAsset` の 3 つだけで、ルータ本体への参照は 0 件である。したがって**応答に関する約束（状態コードとヘッダ）はどれも担保が無い**。担保があるのは、ルータがその応答を決めるために呼ぶ判定と取得の部品である。テスト追加は将来課題とする。

- **AC 6 — 担保あり。** `drawio-assets.spec.ts` の `should return undefined when $reason` のうち `following a redirect would leave the resolved origin` の行。302 の転送先は同じテストサーバー上に実在して 200 を返すのに `readAsset` が `undefined` を返すので、追っていないことと失敗として扱うことの両方が分かる。
- **AC 1 — 部分的。** リクエストに含まれる値から取得先が決まらないことは `should keep the request on the configured host even when the path is $reason`（絶対 URL・スキーム相対・バックスラッシュ始まりの 3 通り）と `should refuse a location outside it without making the request` が担保する。**取得先が設定値とコード定数の 2 つに限られること**はルータ側なので担保が無い。
- **AC 2 — 部分的。** 許可された形かどうかの判定は `should refuse $reason`（空パス・許可外ディレクトリ・`WEB-INF/web.xml`・traversal・エスケープした区切り・絶対パス・許可外拡張子・拡張子なし・別ホスト・query 混入の 11 通り）が担保する。**404 を返すことと外部要求を出さないことは担保が無い。**
- **AC 3 — 部分的。** 「その取得を行わない」ことは `should return undefined when the path climbs out of the configured subtree` と `should refuse a location outside it without making the request`（テストサーバーに要求が届かなかったことを実際に確かめている）が担保する。**404 を返すことは担保が無い。**
- **AC 9 — 部分的。** ルータのゲートに使う判定は `is-self-hosted-drawio.spec.ts` の既定オリジン 2 行が担保する。**404 を返すことと外部要求を出さないことは担保が無い。**
- **AC 4・5・8・10 — 担保が無い。** Content-Type を拡張子から決めること、`nosniff` を付けること、フォールバックと 502、認証を求めないことは、いずれもルータ本体の振る舞いである。
- **AC 7 — 担保が無い。** 10 秒・64 MiB の上限に当てるテストは無い（上限は `readAsset` の中にあるが、テストは上限に触れていない）。
- このほか `drawio-assets.spec.ts` は、到達不能なときに例外を投げないこと（`should return undefined rather than throw when the host is unreachable`）、パスを書き換えずに要求すること（`should request the asset path unchanged`）、query を落とすこと（`should drop the query DRAWIO_URI carries, which configures the editor`）を担保する。

### Requirement 4: エディタのメニューが読める

**Objective:** As a 図を編集する GROWI の利用者, I want メニューの文字が読めること, so that draw.io のバージョンが上がってもエディタを操作できる

#### Acceptance Criteria

1. Where GROWI がエディタの配色を上書きしている箇所, the GROWI のエディタ連携 shall 文字色を draw.io のテーマに委ねず、背景色と対で定める。
2. When エディタを開いたとき, the GROWI のエディタ連携 shall メニューバーとその項目の文字が背景に対して判読できる状態で表示する。
3. The GROWI のエディタ連携 shall 保存ボタンと終了ボタンの配色を上書きしない（draw.io が明るい背景に濃い文字で描くため、一括で上書きすると今度はボタンが読めなくなる）。

_担保しているテスト:_

- **AC 1 — 担保あり。** `drawio-config.spec.ts` の `should declare a foreground colour for every surface it repaints`（背景を塗った要素すべてに文字色があること）。文字色を外す／一括指定に変える の 2 パターンで RED になることを確認済み。
- **AC 3 — 担保あり。** 同ファイルの `should leave the editor buttons alone so draw.io keeps styling them`。
- **AC 2 — 担保が無い。** 「判読できる」は見え方の話で、CSS の構造からは決まらない。構造の側は `should colour the menubar entries themselves, not only their container`（メニュー項目自体にも色が当たること）が担保している。判読できることは #10478 の対応時にコントラスト比の実測（およそ 1.05 対 1 → 修正）で確認した。

### Requirement 5: `DRAWIO_URI` に書いた設定が尊重される

**Objective:** As a `DRAWIO_URI` にパラメータを書いた GROWI の運用者, I want 書いた指定が効くこと, so that 言語や表示の設定を自分で決められる

#### Acceptance Criteria

1. When エディタの URL を組み立てるとき, the GROWI のエディタ連携 shall `DRAWIO_URI` が既に持つパラメータのうち GROWI が制御しないものを保持する。
2. If `DRAWIO_URI` が GROWI も指定するキーを既に持つ, then the GROWI のエディタ連携 shall そのキーを重複させず、1 つの値に定める。
3. Where `DRAWIO_URI` がサブパスを含む, when エディタの URL を組み立てるとき, the GROWI のエディタ連携 shall そのパスを保持する。
4. If `DRAWIO_URI` が URL として解釈できない, then the GROWI のエディタ連携 shall 呼び出し元が失敗として扱える形で報告する（黙って既定値で続行しない）。

_担保しているテスト:_ 4 項目すべて担保あり。いずれも `build-drawio-editor-url.spec.ts`。

- **AC 1** — `should keep parameters DRAWIO_URI carries that GROWI does not control`。
- **AC 2** — `should not duplicate a parameter that DRAWIO_URI already sets` と `should not duplicate "%s" when DRAWIO_URI already sets it`（`spin` / `embed` / `ui` / `configure`）。
- **AC 3** — `should keep the path when draw.io is deployed under a sub path`。
- **AC 4** — `should throw when drawioUri cannot be parsed`。**ただし呼び出し元の受け方（`DrawioModal` が受けて iframe を描かないこと）に当てるテストは無い。**
- 必要なパラメータの付与そのものは `should add the parameters the embedded editor needs` が担保する。

_注記（AC 4 の現状）:_ 失敗は投げられ、呼び出し元は既定値で続行しない。ただし観測される結果は「モーダルがローディング表示のまま止まる」であり、利用者に理由は伝わらず、記録も `debug` レベルなので既定のログ設定では運用者にも見えない。**利用者へ伝えることは挙動の変更にあたるため、この spec では扱わず将来課題とする**（要件 9 の AC 6）。

### Requirement 6: 図の保存で情報が失われない

**Objective:** As a 複数ページの図を描く GROWI の利用者, I want 保存しても全ページが残ること, so that 気づかないうちにページが消えていることがない

#### Acceptance Criteria

1. When 複数ページを持つ図を保存したとき, the GROWI shall すべてのページを保存する。
2. When 保存した複数ページの図をエディタで開き直したとき, the GROWI shall すべてのページを復元する。
3. When 単一ページの図を保存したとき, the GROWI shall 従来と同一の内容を保存する（既存ページを開いて保存し直しても差分が出ない）。
4. If 保存されようとしている内容にページが 1 つも含まれない, then the GROWI shall もとの図の内容を上書きしない。
5. If エディタから届いたメッセージの発信元が設定済みの draw.io と一致しない, then the GROWI shall そのメッセージを処理しない。

_担保しているテスト:_

- **AC 1 — 担保あり。** `mxfile.spec.ts` の `preserves every page (content and name), not only the first`。
- **AC 3 — 担保あり。** 同ファイルの `returns the first diagram inner content unchanged`。
- **AC 4 — 担保あり。** 同ファイルの `returns an empty string when no diagram element is present` と、`DrawioCommunicationHelper.spec.ts` の `does NOT overwrite the diagram when no page can be extracted`。
- **AC 2 — 部分的。** 保存した形が自己完結していて検出側と食い違わないことは `mxfile.spec.ts` の `persists an <mxfile> that isMxfileData recognizes (round-trip contract)` と `a multi-page diagram persisted on save renders every page with navigation enabled`、`embed.spec.ts` の `passes the mxfile through untouched so every page survives` が担保する。**エディタへ返す経路（`onReceiveMessage` の `ready` 分岐が保存内容をそのまま返すこと）を呼ぶテストは無い。**
- **AC 5 — 担保が無い。** `DrawioCommunicationHelper.spec.ts` のテストは常に一致する発信元を渡すので、照合を消しても落ちない。
- 保存経路そのものは `saves the (single-page) diagram content and closes the modal` が担保する。ただし当てているのは `save` 分岐だけで、`configure` / `ready` / `exit` の分岐は呼ばれない。

### Requirement 7: ビューアのページ送りが機能する

**Objective:** As a 複数ページの図を閲覧する GROWI の利用者, I want ページを送った先が表示され続けること, so that 2 ページ目を見ようとして 1 ページ目に戻されない

#### Acceptance Criteria

1. When 閲覧中に図のページを送ったとき, the GROWI のビューア shall 送った先のページを表示し続ける。
2. When ページの横幅が変わる操作（ウィンドウの大きさの変更、エディタ枠の幅の変更）が起きたとき, the GROWI のビューア shall 図を描き直す。
3. While 図の高さのみが変わっている状態, the GROWI のビューア shall 図を描き直さない。
4. When 図が初めて表示されるとき, the GROWI のビューア shall 図を描画する。

_担保しているテスト:_

- **AC 2 — 担保あり。** `should-rerender-on-resize.spec.ts` の `re-renders when the available width changes (external layout change)`。
- **AC 3 — 担保あり。** 同ファイルの `does NOT re-render when only the height changes (width is stable)`。
- **AC 4 — 担保あり。** 同ファイルの `re-renders on the first observation (no previous width yet)`。
- **AC 1 — 部分的。** 1 ページ目に戻される原因（高さだけの変化でビューアを作り直すこと）を防ぐ判定は上記 AC 3 のテストが担保し、ページ送りの操作面が出ること自体は `embed.spec.ts` の `enables page navigation so the extra pages are reachable` が担保する。**送った先が実際に表示され続けることは担保が無い** — 要件 10 の検証手順で確かめる。
- 1 ピクセル未満のゆらぎを無視することは `ignores sub-pixel width jitter` が担保する。

### Requirement 8: 既定構成の挙動が変わらない

**Objective:** As a 既定の draw.io を使っている GROWI の運用者, I want 自前ホスト向けの手当てが自分の環境に影響しないこと, so that 自分に関係のない変更で壊れることがない

#### Acceptance Criteria

1. Where 既定の draw.io（本家のホスト）が設定されている, when ページを閲覧したとき, the GROWI shall 自前ホスト向けの参照先の差し替えを行わない。
2. Where 既定の draw.io が設定されている, when 図を閲覧・編集したとき, the GROWI shall 数式と図形の描画、およびエディタの表示を従来どおりに保つ。
3. If `DRAWIO_URI` が URL として解釈できない値である, then the GROWI shall 自前ホスト向けの手当てを行わず、draw.io の既定に委ねる。
4. The GROWI shall 自前ホストかどうかの判定を、ビューア側と配信側で同一の基準で行う（片方だけが自前ホストと見なす状態を作らない）。

_担保しているテスト:_

- **AC 1 — 部分的。** `index.spec.ts` の `should leave draw.io untouched when its own hosted viewer is configured` が、既定構成で参照先の差し替えも抑止も起きないことを担保する。**ただし当てているのは読み込み前の入口 `prepareSelfHostedDrawio` だけで、読み込み後の入口 `adoptSelfHostedDrawio` を呼ぶテストは無い**（要件 1 の担保も参照）。
- **AC 3 — 部分的。** `index.spec.ts` の `should leave draw.io untouched when DRAWIO_URI holds nothing usable`（空の値を渡す。`isSelfHostedDrawio` の中では解釈できない値と同じ経路に入る）と、`is-self-hosted-drawio.spec.ts` の `not-a-url` / 空値の 2 行が担保する。入口の範囲は AC 1 と同じ制限がかかる。
- **AC 2 — 担保が無い。** 「従来どおり」は要件 10 の検証手順で確かめる。
- **AC 4 — 担保が無い。** 現状は成り立っている（判定の呼び出しはビューア側の `client/self-hosted/index.ts` と配信側の `server/routes/drawio-assets.ts` の 2 か所だけで、いずれも同一の `isSelfHostedDrawio` を使う）が、**片方が独自判定に置き換わっても落ちるテストは無い**。テスト追加は将来課題とする。
- 判定の基準そのものは `is-self-hosted-drawio.spec.ts` の `should be $expected for $reason`（7 通り）が担保する。

### Requirement 9: 保守情報の所在が 1 つにまとまっている

**Objective:** As a draw.io 連携を次に触る開発者, I want 根拠が 1 か所にまとまっていて、コードから辿れること, so that PR やコミット履歴を掘り直さずに安全に変更できる

#### Acceptance Criteria

1. The drawio spec shall 現況の機構とその理由（なぜその形を採ったか、採らなかった形が何を壊すか）を design に持つ。
2. When 開発者が `features/drawio/` 配下のファイルを開いたとき, the リポジトリ shall 同じディレクトリの `CLAUDE.md` から この spec へ辿れる状態を提供する。
3. The リポジトリ shall `features/drawio/client/self-hosted/README.md` を残さない。ただし削除は内容が design に移り終わったあとに行う（先に消すと根拠が失われる）。
4. The drawio spec shall 関心マップを持ち、`features/drawio/` の外にある draw.io 関連のコード（エディタ起動、描画、保存形式、挿入操作、設定）も、どの関心がどこにあるかの形で列挙する。
5. The drawio spec shall 各要件について、担保している既存テストを対応づける。担保が無いものは「無い」と明記する。
6. The drawio spec shall 既知の未解決事項を将来課題として記録する（この spec では直さないことを含めて）。
7. The drawio spec shall 過去に否定された原因説も、否定済みであることが分かる形で残す（同じ誤りを繰り返さないため）。

_担保しているテスト:_ **AC 1〜7 の 7 項目すべて担保が無い**（文書の要件のため、当てられるテストが無い）。要件 9 の充足は spec と `CLAUDE.md` の内容確認で判断する。AC 5 の充足状況は [research.md](research.md) の「担保テストの突き合わせ（タスク 1.2）」に記録している。

### Requirement 10: 検証手順が再現できる形で残っている

**Objective:** As a draw.io 連携を変更した開発者, I want 単体テストで捕まらない失敗の確かめ方が書かれていること, so that 「テストが通ったから大丈夫」で壊れたまま出さない

#### Acceptance Criteria

1. The drawio spec shall 単体テストでは捕まらない失敗（実際に描画されるか、外部への要求が出ないか、ページ送りが保たれるか）を明示し、それぞれの確かめ方を持つ。
2. The drawio spec shall 2 世代の draw.io を使う検証手順を持つ。焼き込み先が外部で到達できない世代と、到達できる世代の両方が必要である（失敗の出方が逆になるため、片方だけでは検証にならない）。
3. The drawio spec shall 外部に出られる状態と出られない状態の両方での確認点を持つ。外部に出られる環境でだけ現れる失敗があるため、閉域だけを検証環境にすると見落とす。
4. The drawio spec shall 既定の draw.io での無変化確認を検証手順に含める。
5. The drawio spec shall 検証時に何を見れば合否が分かるかを、観測できる形で記す（描画されたかどうか、どのホストへ要求が出たか、要求が何回出たか）。

_担保しているテスト:_ **AC 1〜5 の 5 項目すべて担保が無い**（文書の要件のため、当てられるテストが無い）。要件 10 の充足は spec の内容確認で判断する。
