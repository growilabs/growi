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
  - **担保が無いと分かった振る舞いに自動テストを足すこと**（要件 11。2026-08-04 に範囲を拡張）。挙動は変えず、壊れたら落ちるテストを増やすだけ。
- **Out of scope（この spec では直さないもの）**
  - コードの挙動を変える修正・リファクタ（**テストの追加は挙動を変えないので対象内。要件 11**）。既知の未解決事項（CodeQL の指摘 2 件、v28 系インスタンスの stencil 未同梱、`PROXY_URL` 未対応、`offline=1` で保存／終了ボタンが消える件、`packages/remark-drawio` と `apps/app` の責務再配置）は将来課題として記録するだけ。
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
- **`index.spec.ts` は 2 つの入口の両方を呼ぶ。** 読み込み後の `adoptSelfHostedDrawio` については、自前ホストのときに MathJax の置き場所が設定済みインスタンスへ移ることを `should point MathJax at the configured instance` が担保し、2 つの入口を `DrawioViewerScript` と同じ順で走らせた結果（参照先が設定済みインスタンス（と GROWI のオリジン）を向き、MathJax もそこから起動し、仮値が残っていないこと）を `should leave the assets and MathJax on the configured instance, with no placeholder behind` が担保する。どちらも `viewer-static.min.js` の代役を spec 内に置いているので、担保しているのは AC 2 と同じく「そう振る舞う draw.io に対して GROWI 側の手当てが正しいこと」である（**mutation 確認済み**: 入口から `adoptMathJax` の呼び出しを消す / `adoptMathJax` が仮値を消さないようにする の 2 パターンで RED）。既定構成と解釈できない値で何もしないことは要件 8 の AC 1・AC 3 の担保欄を参照。

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
- **AC 4 — 担保あり。** `drawio-assets.spec.ts` の `should serve the asset from draw.io itself when the instance does not ship it`。設定済みインスタンス役の fixture がその資産を持たず（404）、本家役の fixture だけが持つ状態で叩き、200 と本家役が返したバイト列がそのまま配信されること、および**両方の fixture が要求を受けたこと**（インスタンスを飛ばして本家だけを見に行く実装ではないこと）を確かめている。インスタンスが返せたときに本家へ要求が出ないことは `should serve $assetPath as $contentType, byte for byte` が確かめているので、2 つ合わせて「インスタンスが先、本家はそれが失敗したときだけ」になる。フォールバックを消す mutation で RED を確認済み。
- **AC 2 — 部分的。** 参照先を GROWI のオリジンへ向ける側は `rebase-asset-paths.spec.ts` の `should route $global through GROWI's own origin because $reason`（`STENCIL_PATH` / `SHAPES_PATH` / `STYLE_PATH`）と `should read $global straight from the instance, since <img> is not bound by the same-origin rule`（`<img>` で読む 3 つはインスタンス直）が担保し、ビューアのバンドル自体をインスタンスから読むことは `use-viewer-min-js-url.spec.ts` が担保する。サーバー側で、インスタンスが資産を返せたときに本家へ要求を出さないことは `drawio-assets.spec.ts` の `should serve $assetPath as $contentType, byte for byte`（本家役の fixture が受けた要求が 0 件）が担保する。**ブラウザから本家への要求が実際に 0 件であることは担保が無い。**
- **AC 6 — 部分的。** サブパスの保持は `rebase-asset-paths.spec.ts` の `should keep the sub path when draw.io is deployed under one` と `drawio-assets.spec.ts` の `should resolve against "$drawioUri"`（`https://drawio.example.com/drawio/` の行）が担保する。**実際に描画されることは担保が無い。**
- **AC 1・3 — 担保が無い。** 要件 10 の検証手順で確かめる。
- **AC 5 — 部分的。** サーバー側が 502 を返すところまでは `drawio-assets.spec.ts` の `should answer 502 when neither the instance nor draw.io can serve the asset` が担保する。**502 を受けたブラウザで、その図形だけが欠けてページの描画が続くことは担保が無い**（将来課題）。
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

**前置き（この要件の担保を読むときの前提）:** **配信ルータ本体（`drawioAssetsRouterFactory`）を呼ぶテストがある。** `drawio-assets.spec.ts` の `describe('drawioAssetsRouterFactory')` が、`express()` にルータを素で mount して `supertest` で叩き、応答の状態コードとヘッダとバイト列を検証する。上流は `node:http` の fixture サーバ 2 つ（設定済みインスタンス役と draw.io 本家役）で、**受けた要求のパスを記録する**ので「外部への要求が 0 件」を状態コードとは別に確かめられる（404 だけでは、外に出てから 404 になった場合と区別できない）。コードに定めた 2 つのオリジン（`VIEWER_DIAGRAMS_NET_ORIGIN` と、既定構成かどうかの判定に使う `DEFAULT_DRAWIO_ORIGIN`）は `vi.mock` で差し替えている（`VIEWER_DIAGRAMS_NET_ORIGIN` は常に fixture、`DEFAULT_DRAWIO_ORIGIN` は既定値のまま戻され、本家への要求を観測する必要がある 1 件だけ fixture を向く。したがって自前ホスト判定は 13 件のうち 12 件で本番と同じ比較をしている）。実際の外部ホストへ要求を出さずに「そのホストへ要求が出たか」を観測する手段がこれしか無いためである。**残る未担保**は、AC 7（取得の時間とサイズの上限。タスク 4.2 が扱う）と、ルータの外側にある mount の並び（AC 10 の後半）である。AC 1 の「取得先がこの 2 つに限られる」も示し切れていない（テストが観測できるのは fixture が受けた要求だけなので。下の AC 1 の行を参照）。

- **AC 6 — 担保あり。** `drawio-assets.spec.ts` の `should return undefined when $reason` のうち `following a redirect would leave the resolved origin` の行。302 の転送先は同じテストサーバー上に実在して 200 を返すのに `readAsset` が `undefined` を返すので、追っていないことと失敗として扱うことの両方が分かる。
- **AC 2 — 担保あり。** 許可された形かどうかの判定は `should refuse $reason`（空パス・許可外ディレクトリ・`WEB-INF/web.xml`・traversal・エスケープした区切り・絶対パス・許可外拡張子・拡張子なし・別ホスト・query 混入の 11 通り）が担保する。**404 を返すことと外部要求が 0 件であること**は `should answer 404 and read nothing when the path is $reason`（許可外ディレクトリ・バンドル自体・`WEB-INF/web.xml`・エスケープした区切りの traversal・許可外拡張子の 5 通り）が担保する。どの行でも、インスタンス役の fixture にはそのパスを**配信できる状態で登録してある**ので、要求が外に出ていれば 200 か 502 になり 404 にはならない。許可リストを素通しにする mutation で RED を確認済み。
- **AC 9 — 担保あり。** 判定の基準そのものは `is-self-hosted-drawio.spec.ts` の既定オリジン 2 行が担保する。**404 を返すことと外部要求が 0 件であること**は `should answer 404 and read nothing when the configured draw.io is draw.io's own` が担保する。既定オリジンを fixture に向け替えたうえで `DRAWIO_URI` をその fixture に設定しているので、ゲートを外せばその fixture が 200 を返してしまう構図になっている（自前ホスト判定のゲートを消す mutation で RED を確認済み）。
- **AC 3 — 担保あり。** 「その取得を行わない」ことは `should return undefined when the path climbs out of the configured subtree` と `should refuse a location outside it without making the request`（テストサーバーに要求が届かなかったことを実際に確かめている）が担保し、**404 を返すこと**は `should answer 404 and read nothing when the location leaves the configured subtree` が担保する。このゲートに実際に届く入力は `user:pass@` を含む `DRAWIO_URI` である（`origin` は資格情報を落とすが `href` は保つため、組み立てた先が範囲の外になる）。traversal を含むパスは手前の許可リストで先に落ちるので、ここまで来ない。範囲の確認をしない実装（パスを `DRAWIO_URI` に連結するだけ）に変える mutation で RED を確認済み（応答が 404 でなく 502 になる）。
- **AC 4 — 担保あり。** `should serve $assetPath as $contentType, byte for byte`（`.xml` / `.png` / `.js` の 3 通り）。fixture は**わざと `text/html` を申告する**ので、上流の申告を通す実装では通らない。Content-Type を上流の値に置き換える mutation で RED を確認済み。同じテストがバイト列の一致も見ており、`.png` の本体は正しい文字列にならないバイト（0x89・0x00・0xff）を含むので、本体を再エンコードする経路では通らない。
- **AC 5 — 担保あり。** 同じテストが `X-Content-Type-Options: nosniff` と `Cache-Control: public, max-age=86400`（design の API 契約の値）を検証する。それぞれのヘッダを落とす mutation で RED を確認済み。
- **AC 8 — 担保あり。** `should serve the asset from draw.io itself when the instance does not ship it`（インスタンス役が 404、本家役が 200 のとき本家の内容を配信する）と `should answer 502 when neither the instance nor draw.io can serve the asset`（両方 404 のとき 502。両 fixture が要求を受けたことも確かめている）。フォールバックを消す mutation で両方 RED を確認済み。
- **AC 1 — 部分的。** リクエストに含まれる値から取得先が決まらないことは `should keep the request on the configured host even when the path is $reason`（絶対 URL・スキーム相対・バックスラッシュ始まりの 3 通り）と `should refuse a location outside it without making the request` が担保する。ルータ側でも、許可外の形・既定構成・範囲外のいずれでも**どの fixture にも 1 件も要求が届かないこと**を確かめている。**取得先が設定値とコード定数の 2 つに限られること**は、宛先を持たない要求を観測する手段が無いため、テストとしては「この 2 つ以外へ出ていない」まで示せていない（テストが観測できるのは fixture が受けた要求だけである）。
- **AC 10 — 部分的。** ルータ自身が認証を求めないことは `should answer a request that carries no session, since a shared page may be read by someone not logged in` が担保する（middleware を一切挟まずに mount し、session cookie も `Authorization` も持たない要求で 200 になる）。**実際の mount（`server/routes/index.js`）が認証の並びの外に置かれ続けることは担保が無い。**
- **AC 7 — 担保が無い。** 10 秒・64 MiB の上限に当てるテストは無い（上限は `readAsset` の中にあるが、テストは上限に触れていない）。タスク 4.2 が扱う。
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
- **AC 2 — 部分的。** 保存した形が自己完結していて検出側と食い違わないことは `mxfile.spec.ts` の `persists an <mxfile> that isMxfileData recognizes (round-trip contract)` と `a multi-page diagram persisted on save renders every page with navigation enabled`、`embed.spec.ts` の `passes the mxfile through untouched so every page survives` が担保する。エディタへ返す経路（`ready` を受けたときに保存内容へ手を加えずそのまま返すこと）は `DrawioCommunicationHelper.spec.ts` の `answers with the stored diagram untouched, so every page is restored` が担保する（**mutation 確認済み**: `ready` 分岐を削除する / 返す前に `<mxfile>` を剥がす の 2 パターンで RED）。**残っている未担保は、返した内容を受け取った draw.io が実際に全ページを描くことだけ**で、これはブラウザでしか確かめられないため要件 10 の手動確認に残る。
- **AC 5 — 担保あり。** `DrawioCommunicationHelper.spec.ts` の `ignores a message sent from an origin other than the configured draw.io`。一致すれば保存される内容を発信元だけ変えて渡すので、照合を無効化すると落ちる（**mutation 確認済み**）。オリジンだけを見ていること（サブパスに置いた自前ホストからのメッセージを弾かないこと）は `accepts a message from the configured instance deployed under a sub path` が担保する。
- 保存経路そのものは `saves the (single-page) diagram content and closes the modal` が担保する。`onReceiveMessage` の分岐は**発信元の照合・`configure`・`ready`・`mxfile` を含むメッセージ（保存）・空メッセージ（閉じる）・どれにも当てはまらない場合の 6 つすべてに、その分岐が消えたら落ちるテストがある**（`answers the configure request with the configuration it was given`、`closes the modal on an empty message without saving anything`、`does nothing for a message that matches none of the branches`。いずれも mutation 確認済み）。ただし当てているのは helper が返す内容までで、**エディタ側の見え方は担保していない**。

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

- **AC 1 — 担保あり（自動テストで捕まえられる範囲）。** `index.spec.ts` が 2 つの入口の両方について、既定構成では何も起きないことを担保する。読み込み前は `prepareSelfHostedDrawio` の `should leave draw.io untouched when its own hosted viewer is configured`（参照先の差し替えも抑止も起きない）、読み込み後は `adoptSelfHostedDrawio` の `should leave draw.io as the bundle left it when its own hosted viewer is configured`。後者は、抑止を置かないままバンドルが焼き込み先から MathJax を起動し終えた状態を作ってから呼び、`DRAW_MATH_URL` が動かないこと・MathJax の起動が 1 回のままであること・draw.io が書いた設定オブジェクトがそのまま（同一のオブジェクトとして）残っていることを見る。**`adoptSelfHostedDrawio` から自前ホスト判定を外す mutation で RED を確認済み**（既定構成では `DRAW_MATH_URL` の移動、解釈できない値では 2 回目の起動として現れる）。**ブラウザで実際に従来どおり見えることは AC 2 のとおり担保が無い。**
- **AC 3 — 担保あり（自動テストで捕まえられる範囲）。** `index.spec.ts` の 2 つの入口それぞれの空の値を渡すテスト（読み込み前 `should leave draw.io untouched when DRAWIO_URI holds nothing usable`、読み込み後 `should leave draw.io as the bundle left it when DRAWIO_URI holds nothing usable`。`isSelfHostedDrawio` の中では解釈できない値と同じ経路に入る）と、`is-self-hosted-drawio.spec.ts` の `not-a-url` / 空値の 2 行が担保する。読み込み後の側は AC 1 と同じ mutation で RED を確認済み。
- **AC 2 — 担保が無い。** 「従来どおり」は要件 10 の検証手順で確かめる。
- **AC 4 — 担保あり（走査した範囲について）。** `no-duplicate-self-hosted-judgement.spec.ts` が、draw.io 連携のソース 3 か所（`features/drawio/`、`client/components/PageEditor/DrawioModal/`、`components/Script/DrawioViewerScript/`）を走査し、draw.io 本家のオリジンへの言及が `consts.ts` と `is-self-hosted-drawio.ts` 以外に現れないことを検証する。言及とみなすのは、定数 `DEFAULT_DRAWIO_ORIGIN` と、`embed.diagrams.net` のようにホストを直接書いた形の両方である。**呼び出し箇所を数えるのではなく、判定の材料がどこにあるかを見る**ので、判定を別実装で書き足せば落ちる（**mutation 確認済み**: `client/self-hosted/index.ts` に `new URL(drawioUri).origin !== 'https://embed.diagrams.net'` を直接書く / `DrawioViewerScript.tsx` が `DEFAULT_DRAWIO_ORIGIN` を import する の 2 パターンで、違反した行のファイル名と行番号を挙げて RED）。走査が空になって無条件で通る状態も防いである（走査先のディレクトリと 2 つの許可ファイルが実在すること、および許可ファイルの中で実際に一致が見つかることを別のテストで確かめる。`consts.ts` を改名すると 4 件のうち 3 件が RED、走査先を存在しないディレクトリに向けると 4 件すべてが RED になることを確認済み）。
  **このテストで捕まえられないもの**（いずれも残る未担保）: 走査した 3 か所の外に書かれた判定（`server/service/config-manager/` は `DRAWIO_URI` の既定値として本家の URL を持つため走査対象から外してある）、テストファイル内に書かれた判定（本番コードの判定だけを対象にするため走査対象外）、`viewer.diagrams.net`（資産のフォールバック用の別定数）を基準にした判定、ホスト名も定数も書かずに導いた判定。また、判定の基準が 1 つであることは示すが、**その結果をビューア側と配信側が同じ向きに使うこと**（片方が反転して使わないこと）は別の話で、これは担保しない。
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

### Requirement 11: 担保が無い振る舞いに自動テストを足す

**Objective:** As a draw.io 連携を次に触る開発者, I want 壊れたら落ちるテストがあること, so that 「動くはず」ではなく「壊れたら分かる」状態で変更できる

この要件は要件 1〜8 の振る舞いを変えない。**要件 1〜8 の担保欄で「担保が無い」と判定した箇所のうち、自動テストで捕まえられるものを実際に捕まえる**ことだけを求める。ブラウザでの描画のように自動テストで捕まえられないものは対象外で、要件 10 の手動確認に残る。

#### Acceptance Criteria

1. If 許可されていない形の資産パスが要求された, then the 自動テスト shall 404 が返り外部への要求が出ないことを検証する。
2. Where 既定の draw.io が設定されている, when 配信経路に要求が来たとき, the 自動テスト shall 404 が返り外部への要求が出ないことを検証する。
3. When 資産の配信が成功したとき, the 自動テスト shall Content-Type が拡張子から決まること、`nosniff` と `Cache-Control` が付くこと、バイト列がそのまま返ることを検証する。
4. If 設定済みインスタンスが資産を返せない, then the 自動テスト shall draw.io 本家へ切り替えて配信すること、および両方失敗したときに 502 を返すことを検証する。
5. The 自動テスト shall 配信経路が認証を求めずに到達できることを検証する。
6. The 自動テスト shall 取得の時間とサイズの上限が効くことを検証する。ただし**本番コードにテスト用の縫い目を超える変更が必要になる場合は、実現できない理由を記録して繰り越す**（上限は暴走の歯止めであって、そのために本番コードの形を変える価値はない）。
7. The 自動テスト shall エディタからのメッセージのうち、発信元が一致しない場合・`configure`・`ready`（復元経路）・空メッセージ（閉じる）の各分岐を検証する。
8. The 自動テスト shall 読み込み後の入口が、自前ホストのときだけ効き、既定構成と解釈できない値では何もしないことを検証する。
9. The 自動テスト shall 自前ホスト判定が単一の関数に集約され続けることを検証する。この検証は**意図的に壊して RED になることを確認したうえで**加える（判定を別実装に置き換えても落ちないテストは、何も守らない）。

_担保しているテスト:_ この要件自体がテストを足す要件なので、充足はタスク 4.1〜4.5 の成果物（新規・追記された spec ファイル）で判断する。各項目が満たされた時点で、対応する要件 1〜8 の担保欄を「担保あり」へ更新する。
