# ai-usage Sub-spec Roadmap

> 本ファイルは umbrella spec `ai-usage` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

GROWI.cloud が GROWI AI Agent を有料オプション（Owned / Hosted）として提供するために、GROWI 本体へ AI の利用量を計測・公開する機構を追加する。

- **Owned**: 顧客が自分のプロバイダ・API キーを設定する形態。
- **Hosted**: GROWI.cloud が発行した API キーで動かす形態。GROWI.cloud が LLM の実費を負担し、月額定額で売る。

Hosted で原価を守るため、GROWI.cloud は組織に属する複数の GrowiApp の消費量を集計し、上限を超えたら `AI_ENABLED=false` を注入して止める。GROWI 本体が受け持つのは次の 3 つである。

- GrowiApp 単位の消費量を記録し、GROWI.cloud が読める形で公開する。
- 止まったときに理由を表示する。
- GROWI.cloud が管理する組織単位のゲージを画面に表示する。

出典: 社内 wiki「/Projects/GROWI/GROWI.cloud/会議室/20260911 GROWI AI Agent オプションサービススペック検討」（https://growi.weseek.co.jp/6aa3b4807dde6add1a2c9a47、2026-09-29 更新版）の §6.3・§6.4・§6.5-a・§7.1。以下「設計書」と呼ぶ。設計書は GROWI.cloud チームが書いたもので、GROWI 本体の実装については提案の位置づけである。

## 前提の訂正（設計書とコードの照合）

設計書の前提をコードと突き合わせた結果、次の点が設計書と異なる、または設計書に書かれていない（2026-10-09 確認）。

1. **LLM を呼ぶ箇所は post-message だけではない。** 設計書は `post-message.ts` の `growiAgent.stream()` だけを記録対象としている。実際には次の 2 か所でも LLM を呼んでいる。
   - suggest-path のエージェント（`features/ai-tools/suggest-path/server/services/engines/agentic-engine.ts` の `agent.generate()`）
   - Mastra Memory のスレッドタイトル自動生成（`mastra-modules/memory/index.ts` の `generateTitle: true`。新しいスレッドを作るたびに裏で 1 回呼ぶ）

   Hosted でこれらを記録し損ねると、その分は GROWI.cloud の原価保護から漏れる。
2. **キャッシュ内訳（設計書の論点 R）は、AI SDK の更新なしで取れる見込み。** `@mastra/core` 1.41.0 の `stream.usage` は全ステップの合計で、`cachedInputTokens` と `cacheCreationInputTokens` を含む（`MastraModelOutput.updateUsageCount` で確認）。ただし、各プロバイダで実際に値が入るかは実行して確かめていない。
3. **AI が止まっていると、停止理由を画面に届ける経路がない。** `aiReadyGuard` は AI が無効なとき、mastra と ai-tools のルートをすべて 501 で返す。設計書の「停止理由を UI に表示する」には、このガードを通らない経路が要る。
4. **設定名の違い。** 設計書 §6.3 項 8 の `app:growiAppIdForGrowiCloud` は、実際には `app:growiAppIdForCloud`（env 名は `GROWI_APP_ID_FOR_GROWI_CLOUD`）。
5. **「消費量を読み取る API」には前例がない。** 設計書はストレージオプションを手本にしているが、ストレージの仕組みは逆向きである。GROWI.cloud が上限値を `FILE_UPLOAD_TOTAL_LIMIT` として注入し、GROWI 本体がアップロードのたびに自分で合計を出して判定する（`file-uploader.ts` の `checkLimit()`）。使用量を外から読める API は、転送キーで認証される G2G の growi-info だけである。そのため、今回の公開 API の認証方式は前例に倣えず、新しく決める必要があった（D6 で決定）。
6. **「カタログが古い」という理由で止めると、二度と復旧しない。** カタログの自動リフレッシュ（起動時と毎日 04:00）は、`app:aiEnabled` が true のときしか動かない（`model-catalog-refresh-jobs.ts`）。GROWI.cloud が `catalog_stale` を理由に `AI_ENABLED=false` を注入すると、Pod が再起動したあとはリフレッシュが動かず、カタログがいつまでも新しくならない（D8 で対応）。
7. **カタログの「鮮度」は、取得日時で測る必要がある。** 設計書 §6.4-h の `catalog.generatedAt` を同梱カタログの生成日時と読むと、毎日リフレッシュしている健全な Hosted の app でも、リリースから数日たてば一斉に「古い」と判定されてしまう。リフレッシュしても、その日時は動かないためである。リフレッシュ済みカタログは、models.dev から取得した日時を `fetchedAt` としてすでに持っている（`refreshed-model-catalog.ts`。サーバーの時計の値）。鮮度は「実効カタログの中身を最後に取得した日時」とし、リフレッシュ済みなら `fetchedAt`、同梱なら `_generatedAt` を返す（`ai-usage-metering` の要件 4.2）。新しいフィールドを足す必要はない。

## Amend target（完了済み spec の約束を変える部分）

この umbrella の一部は、完了済みの spec が決めた約束を変える。spec-lifecycle のルールに従い、該当する sub-spec は最後のタスクで、変えた内容を対象の spec へ書き戻す。sub-spec 自体は新しい機能なので、削除はしない。

- `aiReadyGuard` の振る舞いを変える場合（停止理由を届ける経路、未決 2）は、`ai-usage-growi-cloud` の設計で対象 spec を特定して、ここに追記する。

## 決定事項

- **D1. GrowiApp を止めるときは、既存の env 固定の仕組みを使う。** 基本オプションを契約していない app、または解約・未払いの app には、GROWI.cloud が `AI_ENABLED=false` と `AI_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS=true` を一緒に注入する。こうすると、管理画面のトグルで AI を有効に戻せなくなる。
  - 契約中の Owned の app は env で固定しない。顧客は鍵とトグルを自由に編集できる。
  - Hosted の app は契約中も env で固定する（GROWI.cloud が鍵を注入するため）。
  - 固定している間も DB の鍵設定は消えずに残るので、固定を外せば元の設定で再開できる。
  - `app:aiEnabled` だけを固定する新しいグループは作らない。

  **理由**: 止めたいのは「AI を使う権利がない app」だけで、そうした app では鍵まで編集できなくなっても困らない。現行のゲーティング（`isAiLockedToEnvVars = !aiEnabled`）も同じ形をとっている。
- **D2. 新しく追加する env は `config-definition.ts` に登録し、`env:useOnlyEnvVars:ai` グループの固定対象に加える。** 対象は、基準モデル・停止理由・ゲージ API の URL・ゲージ API のトークン。設計書の「`process.env` から直接読む」方針は採らない。
  - 管理画面の UI は作らない。
  - 固定対象に加えるのは、「この値は env でしか設定しない」という意図をコードに残すためである。
- **D3. LLM を呼ぶすべての箇所を記録対象にする。** 対象は post-message・suggest-path・スレッドタイトル生成の 3 つ（前提の訂正 1）。
- **D4. 管理者向けゲージとユーザー単位の fair-use 上限も、このイニシアチブに含める。** ゲージ API の呼び出しと表示、ユーザー単位の時間／月次上限の両方を扱う。
- **D5. 集計の区切りは呼び出し側が決める。** 公開 API は「指定された開始時刻以降の合計」を返し、GROWI 本体は時間／月次の区切りやタイムゾーンを持たない。次回リセット時刻を出す GROWI.cloud と、区切りが食い違わないようにするためである。
- **D6. 公開 API は認証なしにする（設計書 §6.4-h どおり）。** 返すのはこの GrowiApp 自身の合計値とカタログ鮮度だけで、ユーザー単位の内訳・ドル建ての値・契約情報は含めない。
- **D7. 倍率が分からない使用量は、推測で埋めない。** 基準モデルが未設定、またはモデルの単価が不明のときは、生のトークン数だけを記録して倍率を「不明」とする。公開 API は、倍率の合計とは別に「倍率が不明な分の生トークン数」を返し、扱いは GROWI.cloud が決める。
- **D8. 停止中のカタログリフレッシュは、停止理由で切り替える。** GROWI.cloud が注入する停止理由が「カタログが古い」のときだけ、AI が無効でもリフレッシュを動かす。停止理由がない普通の AI 無効（セルフホストの既定）では、今までどおり外部と通信しない。
- **D9. 公開 API は、送信元ごとの回数制限で守る。** 認証なしの API なので、送信元ごとに一定時間あたりのリクエスト数を絞り、超えたら 429 を返す。上限は、GROWI.cloud の問い合わせ（下書きでは 5 分ごと）が収まる範囲で小さくする。既存の `features/rate-limiter`（エンドポイントごとに env で上限を変えられる）を使う想定。
- **D10. 公開 API はメンテナンスモード中も応答させる。** GROWI.cloud の下書きは、組織内の 1 つの app でも応答しないと、その組織の判定をまるごと見送る。1 つの app のメンテナンスで、組織全体の停止・再開の判定を止めないためである。`/_api/v3` はメンテナンスモード中は応答しないので、マウント位置は設計で決める。
- **D11. 定期リフレッシュの取得時刻を GROWI ごとにばらす。** 既定のスケジュール（毎日 04:00）のままだと、AI を有効にした GROWI がすべて同じ時刻に models.dev へアクセスする。このイニシアチブで Hosted の app が AI を有効にすると、その数だけ一斉アクセスが増える。さらに、取得に失敗し続けると `catalog_stale` で止まる原因になる。スケジュール時刻からランダムに遅らせて取得する。前例は news の定期取得（`news-cron-service.ts` が `randomSleep` で最大 5 時間遅らせる）。手動リフレッシュは遅らせない。
- **D12. 段階料金も反映する。** models.dev の `cost.tiers`（入力トークン数が境目を超えると、その呼び出し全体に高い単価がかかる）を取り込み、LLM の呼び出し 1 回ごとに単価を選ぶ。基本の単価だけだと、長い入力の呼び出しを最大 2 倍ほど少なく数える。
- **D13. 起動時のリフレッシュを既定で ON にする。** 起動した時点でカタログが古いことがある。上限超過などで止まっていた app の再開、新しいリリースへの更新、「カタログが古い」での停止のどれも当てはまる（リリースに上げると、newer-wins の比較で同梱カタログが選ばれ、取得日時がリリース時の生成日時に戻る）。起動時のリフレッシュが既定で OFF だと、次の取得は翌日の定期リフレッシュになり、その間に「古い」と判定されて止められうる。そこで、リフレッシュが許されている GROWI は起動するたびにすぐ取得する。起動の時刻は GROWI ごとにばらばらなので、ずらさない。外部と通信させたくない環境は、設定で OFF にできる。
- **D14. 使用量は、エージェントに渡すモデルを包んで捕まえる。** AI SDK の `wrapLanguageModel` で包むと、チャット・suggest-path・スレッドタイトル生成の 3 か所を 1 つの仕組みで覆える。エラーで終わった応答も、それまでに完了した呼び出しの使用量は取れる。途中で失敗した呼び出しの使用量は、プロバイダが報告しないので取れない。いずれも模擬モデルと実物の Mastra で実測した（`ai-usage-metering` の research.md）。

## Approach Decision

- **Chosen**: 3 つの sub-spec に分ける。分け方は「どこに向けた機能か」である。
  1. 計測の中核（`ai-usage-metering`）: 自分自身の消費量を記録し、公開する。GROWI.cloud に依存せず、セルフホストでも意味がある。
  2. GROWI.cloud 連携（`ai-usage-growi-cloud`）: GROWI.cloud から注入される値を受け取り、GROWI.cloud の API を呼ぶ。
  3. fair-use 上限（`ai-usage-fair-use`）: GrowiApp 内でユーザー間の公平性を保つ。Owned・Hosted・セルフホストのどれでも使える。
- **Why**: 中核の記録（使用量ログ）を残りの 2 つが読む関係なので、中核を先に固めれば、残りの 2 つは互いに独立して進められる。GROWI.cloud 固有の部分を 1 つの spec に閉じ込めておくと、セルフホスト向けの汎用機能（中核と fair-use）に GROWI.cloud の事情が混ざらない。
- **Rejected alternatives**:
  - 1 本の spec にまとめる案: カタログ・記録・公開 API・停止理由の表示・ゲージ・fair-use と、ふれる層（サーバー・管理画面・一般ユーザー向けの画面）が広すぎて、1 本の tasks.md が大きくなりすぎる。
  - fair-use を中核に含める案: 中核は「記録して公開する」だけにしておくと、判定ロジックを持たずに済み、単純になる。

## Scope

- **In**:
  - モデルカタログに models.dev の cost（input / output / cache_read / cache_write）を取り込む
  - LLM を呼ぶたびに使用量を記録する（D3 の 3 か所）。基準モデル換算の倍率は記録時点の単価で確定させ、記録は TTL で自動削除する
  - GrowiApp 単位の時間／月次の消費量とカタログ鮮度を返す API
  - 停止理由の表示（AI が止まっていても届く経路で）
  - GROWI.cloud のゲージ API の呼び出しと表示（管理者向けの消費量ゲージ、一般ユーザー向けの次回リセット時刻）
  - ユーザー単位の fair-use 上限（管理画面で設定、超えたら 429）
- **Out**:
  - 組織単位の合計消費量の集計、上限の判定、`AI_ENABLED` による停止指示（growi-cloud-next 側の責務）
  - brigade-gateway / growi-brigade / Helm への新しい env の配線（GROWI.cloud 側の作業）
  - `ai:allowedModels` を env 固定の対象に加えること（設計書 §7.3 で見送り済み）
  - 常に表示される進捗バーやリアルタイムに更新される使用量メーターなど、作り込んだ UI（設計書 §7.2 で保留済み）
  - 長期の利用傾向を分析するための集計テーブル

## Constraints

- **AI を使わない GROWI ではメモリを増やさない。** 重量級の AI パッケージ（約 140MB RSS）は、`aiReadyGuard` を通った最初のリクエストで初めて読み込まれる（`no-eager-ai-imports.spec.ts` で強制）。使用量ログ、公開 API、停止理由の表示経路を、この重いパッケージに依存させてはいけない。
- **記録の失敗でチャットの応答を壊さない。** 使用量の記録はストリームを返した後に行う。記録に失敗しても、ユーザーへの応答には影響させない。
- **ウィンドウの集計は、ジョブに頼らず問い合わせのたびに計算する。** 時間／月次のリセット処理は作らず、「今の時刻からウィンドウの開始時刻まで遡った合計」をその都度求める（設計書 §6.3 項 5）。
- **ドル建ての値は外に出さない。** API や画面に出す値は、常に基準モデルに対する倍率にする（設計書 §6.4-a）。ドル建ての値は内部の計算と監査用の記録だけに使う。
- **新しいモデルの保存先**: model rule（`apps/app/src/server/models/**`）に従う。TTL もインデックスの一種なので、作成は Mongoose 側が担う。

## Boundary Strategy

- **Why this split**: 使用量ログの書き込みは `ai-usage-metering` だけが行う。ほかの 2 つの spec はログを読むだけにする。
- **Shared seams to watch**:
  - 使用量ログの形（ユーザー ID、モデル、生のトークン数、倍率）: fair-use は生のトークン数をユーザー単位で合計する。そのため、ユーザー ID と生のトークン数の両方を持つことを metering の要件に入れる。
  - 停止理由の表示と `aiReadyGuard`: growi-cloud が表示経路を足すとき、mastra 系の完了済み spec（`ai-provider-*`）が決めたガードの振る舞いを変えるなら、spec-lifecycle の amend ルールに従う。
  - 基準モデルの env: metering が倍率の計算で読み、growi-cloud が注入される値として扱う。env の定義（D2）は metering が持つ。

## Specs (dependency order)

- [x] ai-usage-metering -- 計測の中核。カタログへの cost 取り込み、使用量の記録（D3 の 3 か所）、消費量・カタログ鮮度の公開 API。Dependencies: none。Status: 2026-10-20 実装完了（最終検証 GO。実キーでの確認は OpenAI・Anthropic まで、Google は未確認）
- [ ] ai-usage-growi-cloud -- GROWI.cloud 連携。停止理由の表示、ゲージ API の呼び出しと表示。Dependencies: ai-usage-metering（基準モデルの env と使用量の公開 API）。Status: 未着手
- [ ] ai-usage-fair-use -- ユーザー単位の時間／月次上限（管理画面で設定、超えたら 429）。Dependencies: ai-usage-metering（使用量ログ）。Status: 未着手

## 未決

sub-spec の要件・設計で決める。結論が出たら決定事項へ移す。

1. **停止理由を届ける経路。** `aiReadyGuard` の外に、停止中でも読める経路をどう設けるか（前提の訂正 3）。`ai-usage-growi-cloud` で決める。
2. **キャッシュ内訳の実際の値。** 各プロバイダで、キャッシュ読み取り・書き込みのトークン数に実際に値が入るか（前提の訂正 2）。コードを読んだ限りでは、読み取りは 3 社とも、書き込みは Anthropic だけが返す。`ai-usage-metering` の実装後に、実際のキーで手作業で確かめる。
   - 確かめた結果（2026-10-20、実際のキーで、長い同じ入力を 2 回送り、記録の中身を見た）:
     - OpenAI（`gpt-5-mini`）: 読み取りは記録に入る（2 回目のチャットで 3,456 トークン、suggest-path で 27,904 トークン）。書き込みは返らないので null のまま。
     - Anthropic（`claude-sonnet-4-5`）: GROWI のチャット経由では読み取り・書き込みとも 0 で入る。Mastra 経由の呼び出しにキャッシュの指定（`cache_control`）が付かず、プロバイダ側でキャッシュが使われないため。記録の経路自体は、指定を付けた実リクエストをミドルウェアに通して確かめた（1 回目は書き込み 3,202、2 回目は読み取り 3,202 が、記録に渡される使用量の値になった（DB への保存まで通した確認ではない））。
     - Google: キーがなく未確認。
3. **公開 API の回数制限を、第三者に使い切られないか。** 制限は IP ごとなので、ingress の後ろでは外部からのリクエストがすべて同じ IP に見え、第三者が GROWI.cloud の問い合わせの枠を使い切れる。方針: GROWI.cloud は、この API を外部から呼べないようにする（2026-10-10 方針）。GROWI.cloud 自身がどの経路（ingress 経由か、クラスタ内から直接か）で問い合わせるかは GROWI.cloud が決める。外部の第三者が呼べなければ枠を使い切られることはなく、trust proxy の設定も要らない。GROWI は、パスの大文字・小文字の違い（`/_API/V3/AI-Usage`）、末尾のスラッシュ、途中の二重スラッシュ（`/_api/v3//ai-usage`）があっても同じ API に届く（Express 4.21 で実測）。遮断の規則は、大文字・小文字を区別しない前方一致で書く。遮断の具体的な方法を `ai-usage-growi-cloud` で決める。（2026-10-10、wiki のスペック検討ページのコメントで GROWI.cloud 側に伝えた）
4. **再起動の直後の「カタログが古い」をどう扱うか。** 起動してから起動時のリフレッシュ（D13）が終わるまでの数秒間は、公開 API が古い取得日時を返しうる。この間の 1 回の問い合わせだけで止めると、D13 の目的が果たせない。連続して古いときだけ止める、または再起動の直後は猶予を置く、などを `ai-usage-growi-cloud` で決める。（2026-10-10、wiki のスペック検討ページのコメントで GROWI.cloud 側に伝えた）
