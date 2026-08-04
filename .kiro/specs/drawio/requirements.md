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

_担保しているテスト:_ `adopt-mathjax.spec.ts`（読み込みが 1 回だけであること、参照先の付け替え、フォントの参照先が連動すること、参照先が読めないときに後始末が残らないこと）、`relocate-math-url.spec.ts`（サブパス、解釈できない値）、`index.spec.ts`（自前ホストのときだけ効くこと）。**AC 1・3・4 の「実際に描画される」ことは単体テストでは担保できない** — 要件 10 の検証手順で確かめる。

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

_担保しているテスト:_ `rebase-asset-paths.spec.ts`（参照先の差し替え、サブパスの保持、繰り返し適用しても安全なこと）、`drawio-assets.spec.ts`（バイト列がそのまま通ること、フォールバックが成功として記録されること）。**AC 1・2・3 の「実際に描画される」「外部要求が出ない」ことは単体テストでは担保できない** — 要件 10 の検証手順で確かめる。

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

_担保しているテスト:_ `drawio-assets.spec.ts` は**判定と取得の部品だけ**を検証している（許可された形の判定、取得先の解決と範囲外の拒否、要求時点での範囲の再確認、到達不能なときに例外を投げないこと、パスを書き換えずに要求すること、バイト列がそのまま通ること）。**配信ルータ本体（`drawioAssetsRouterFactory`）を呼ぶテストは 1 件も無い** — したがって「実際に 404 が返る」「Content-Type が拡張子から決まる」「`nosniff` が付く」「リダイレクトを追わない」「上限で打ち切る」「フォールバックを試みる」「既定構成で 404 になる」「認証を通らずに到達できる」はいずれも自動で担保されていない。要件 9 でこの事実を記録し、テスト追加は将来課題とする。

### Requirement 4: エディタのメニューが読める

**Objective:** As a 図を編集する GROWI の利用者, I want メニューの文字が読めること, so that draw.io のバージョンが上がってもエディタを操作できる

#### Acceptance Criteria

1. Where GROWI がエディタの配色を上書きしている箇所, the GROWI のエディタ連携 shall 文字色を draw.io のテーマに委ねず、背景色と対で定める。
2. When エディタを開いたとき, the GROWI のエディタ連携 shall メニューバーとその項目の文字が背景に対して判読できる状態で表示する。
3. The GROWI のエディタ連携 shall 保存ボタンと終了ボタンの配色を上書きしない（draw.io が明るい背景に濃い文字で描くため、一括で上書きすると今度はボタンが読めなくなる）。

_担保しているテスト:_ `drawio-config.spec.ts`（背景を塗った要素すべてに文字色があること、メニュー項目自体にも色が当たること、ボタンには当てないこと。文字色を外す／一括指定に変える の 2 パターンで RED になることを確認済み）。

### Requirement 5: `DRAWIO_URI` に書いた設定が尊重される

**Objective:** As a `DRAWIO_URI` にパラメータを書いた GROWI の運用者, I want 書いた指定が効くこと, so that 言語や表示の設定を自分で決められる

#### Acceptance Criteria

1. When エディタの URL を組み立てるとき, the GROWI のエディタ連携 shall `DRAWIO_URI` が既に持つパラメータのうち GROWI が制御しないものを保持する。
2. If `DRAWIO_URI` が GROWI も指定するキーを既に持つ, then the GROWI のエディタ連携 shall そのキーを重複させず、1 つの値に定める。
3. Where `DRAWIO_URI` がサブパスを含む, when エディタの URL を組み立てるとき, the GROWI のエディタ連携 shall そのパスを保持する。
4. If `DRAWIO_URI` が URL として解釈できない, then the GROWI のエディタ連携 shall 呼び出し元が失敗として扱える形で報告する（黙って既定値で続行しない）。

_担保しているテスト:_ `build-drawio-editor-url.spec.ts`（必要なパラメータの付与、GROWI が制御しないパラメータの保持、サブパスの保持、重複させないこと、解釈できない値で失敗すること）。

_注記（AC 4 の現状）:_ 失敗は投げられ、呼び出し元は既定値で続行しない。ただし観測される結果は「モーダルがローディング表示のまま止まる」であり、利用者に理由は伝わらず、記録も `debug` レベルなので既定のログ設定では運用者にも見えない。**利用者へ伝えることは挙動の変更にあたるため、この spec では扱わず将来課題とする**（要件 9 の AC 6）。

### Requirement 6: 図の保存で情報が失われない

**Objective:** As a 複数ページの図を描く GROWI の利用者, I want 保存しても全ページが残ること, so that 気づかないうちにページが消えていることがない

#### Acceptance Criteria

1. When 複数ページを持つ図を保存したとき, the GROWI shall すべてのページを保存する。
2. When 保存した複数ページの図をエディタで開き直したとき, the GROWI shall すべてのページを復元する。
3. When 単一ページの図を保存したとき, the GROWI shall 従来と同一の内容を保存する（既存ページを開いて保存し直しても差分が出ない）。
4. If 保存されようとしている内容にページが 1 つも含まれない, then the GROWI shall もとの図の内容を上書きしない。
5. If エディタから届いたメッセージの発信元が設定済みの draw.io と一致しない, then the GROWI shall そのメッセージを処理しない。

_担保しているテスト:_ `mxfile.spec.ts`（単一ページの後方互換、複数ページの全ページ保持、保存と検出の往復、ページが無いときの扱い、保存した複数ページがページ送り可能な形で描画されること）、`DrawioCommunicationHelper.spec.ts`（保存経路、内容が取れないときに上書きしないこと）。**AC 5（発信元の照合）に対応するテストは無い** — 要件 9 でその事実を記録する。

### Requirement 7: ビューアのページ送りが機能する

**Objective:** As a 複数ページの図を閲覧する GROWI の利用者, I want ページを送った先が表示され続けること, so that 2 ページ目を見ようとして 1 ページ目に戻されない

#### Acceptance Criteria

1. When 閲覧中に図のページを送ったとき, the GROWI のビューア shall 送った先のページを表示し続ける。
2. When ページの横幅が変わる操作（ウィンドウの大きさの変更、エディタ枠の幅の変更）が起きたとき, the GROWI のビューア shall 図を描き直す。
3. While 図の高さのみが変わっている状態, the GROWI のビューア shall 図を描き直さない。
4. When 図が初めて表示されるとき, the GROWI のビューア shall 図を描画する。

_担保しているテスト:_ `should-rerender-on-resize.spec.ts`（初回の描画、幅が変わったときの再描画、高さのみの変化で再描画しないこと、1 ピクセル未満のゆらぎを無視すること）。**AC 1 の「実際にページ送りが保たれる」ことは単体テストでは担保できない** — 要件 10 の検証手順で確かめる。

### Requirement 8: 既定構成の挙動が変わらない

**Objective:** As a 既定の draw.io を使っている GROWI の運用者, I want 自前ホスト向けの手当てが自分の環境に影響しないこと, so that 自分に関係のない変更で壊れることがない

#### Acceptance Criteria

1. Where 既定の draw.io（本家のホスト）が設定されている, when ページを閲覧したとき, the GROWI shall 自前ホスト向けの参照先の差し替えを行わない。
2. Where 既定の draw.io が設定されている, when 図を閲覧・編集したとき, the GROWI shall 数式と図形の描画、およびエディタの表示を従来どおりに保つ。
3. If `DRAWIO_URI` が URL として解釈できない値である, then the GROWI shall 自前ホスト向けの手当てを行わず、draw.io の既定に委ねる。
4. The GROWI shall 自前ホストかどうかの判定を、ビューア側と配信側で同一の基準で行う（片方だけが自前ホストと見なす状態を作らない）。

_担保しているテスト:_ `is-self-hosted-drawio.spec.ts`（判定の基準、解釈できない値の扱い）、`index.spec.ts`（既定のとき・解釈できない値のときに何もしないこと）。**AC 2 の「従来どおり」は単体テストでは担保できない** — 要件 10 の検証手順で確かめる。**AC 4（同一基準）は現状成り立っている**（判定の呼び出しはビューア側と配信側の 2 か所だけで、いずれも同一の関数を使う）**が、片方が独自判定に置き換わっても落ちるテストは無い** — テスト追加は将来課題とする。

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

_担保しているテスト:_ なし（文書の要件のため）。要件 9 の充足は spec と `CLAUDE.md` の内容確認で判断する。

### Requirement 10: 検証手順が再現できる形で残っている

**Objective:** As a draw.io 連携を変更した開発者, I want 単体テストで捕まらない失敗の確かめ方が書かれていること, so that 「テストが通ったから大丈夫」で壊れたまま出さない

#### Acceptance Criteria

1. The drawio spec shall 単体テストでは捕まらない失敗（実際に描画されるか、外部への要求が出ないか、ページ送りが保たれるか）を明示し、それぞれの確かめ方を持つ。
2. The drawio spec shall 2 世代の draw.io を使う検証手順を持つ。焼き込み先が外部で到達できない世代と、到達できる世代の両方が必要である（失敗の出方が逆になるため、片方だけでは検証にならない）。
3. The drawio spec shall 外部に出られる状態と出られない状態の両方での確認点を持つ。外部に出られる環境でだけ現れる失敗があるため、閉域だけを検証環境にすると見落とす。
4. The drawio spec shall 既定の draw.io での無変化確認を検証手順に含める。
5. The drawio spec shall 検証時に何を見れば合否が分かるかを、観測できる形で記す（描画されたかどうか、どのホストへ要求が出たか、要求が何回出たか）。

_担保しているテスト:_ なし（文書の要件のため）。要件 10 の充足は spec の内容確認で判断する。
