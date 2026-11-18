# Research & Design Decisions

## Summary

- **Feature**: `ai-usage-metering`
- **Discovery Scope**: Extension（既存の AI 機能・モデルカタログ・apiv3・rate-limit への追加。新しい外部依存はない）
- **Key Findings**:
  1. LLM の呼び出しは、エージェントの `model` 関数で返すモデルを AI SDK の `wrapLanguageModel` で包めば、チャット・suggest-path・スレッドタイトル生成の 3 か所すべてを 1 つの仕組みで捕まえられる。模擬モデルと実物の Mastra で実測して確かめた（下記「実測」）。
  2. models.dev の単価には、基本の 4 項目のほかに、入力が長いと単価が上がる段階料金（`cost.tiers`）がある。段階は呼び出し 1 回の入力トークン数で決まるので、費用は応答全体ではなく呼び出しごとに計算する必要がある。
  3. 公開 API は、healthcheck と同じ `routerForAdmin` に載せると、メンテナンスモードの判定より前に応答できる。このルーターは、重い AI パッケージを起動時に読み込んでいないかを調べるテスト（`no-eager-ai-imports.spec.ts`）の対象にも入っている。

## Research Log

### 使用量をどこで捕まえるか（実測）

- **Context**: 記録対象は 3 か所（post-message のチャット、suggest-path の `agent.generate`、Mastra Memory の `generateTitle`）。タイトル生成は Mastra の内部で動くので、外から使用量を取れるかが未決だった（umbrella の未決 4）。中断・エラー時に、それまでの使用量を取れるかも未決だった（未決 1）。
- **Sources Consulted**: `@mastra/core` 1.41.0 のソース（同梱の sourcemap）、`ai` 6.0.197 の `wrapLanguageModel` と `ai/test` の `MockLanguageModelV3`、`@mastra/memory` 1.20.2。scratchpad に試験コードを書き、実物の `Agent` と `Memory`（`InMemoryStore`）に模擬モデルを渡して動かした。
- **Findings**（すべて 2026-10-10 に実測）:
  - エージェントの `model: ({ requestContext }) => …` で包んだモデルは、`agent.stream` では `doStream` で、`agent.generate` では `doGenerate` で、ステップごとに 1 回ずつ呼ばれる。どちらの経路でも、包んだ側から `requestContext` のユーザーが見える。
  - `generateTitle: { model: ({ requestContext }) => … }` に渡したモデルも、タイトル生成のときに `doGenerate` で呼ばれ、チャットと同じ `requestContext` が渡る。
  - 2 ステップ目でエラーになった場合も、1 ステップ目の使用量は包んだ側で取れる（stream・generate の両方）。エラーになったステップの使用量はない（プロバイダが終わりの合図を送らないため）。
  - `stream.totalUsage` は、エラーで終わった場合も拒否されずに、完了したステップの合計で解決した。`onStepFinish` も完了したステップには使用量付きで呼ばれ、エラーのステップには空の使用量で呼ばれた。
- **Implications**: 包む方式 1 つで 3 か所すべてを覆える。呼び出し 1 回ごとの使用量（入力トークン数を含む）が手に入るので、段階料金を呼び出しごとに選べる。

### プロバイダごとのトークン数の意味

- **Context**: 推定費用の式を決めるため、各項目に何が含まれるかを確かめた。
- **Sources Consulted**: `@ai-sdk/openai` 3.0.69、`@ai-sdk/anthropic` 3.0.82、`@ai-sdk/google` 3.0.80、`@ai-sdk/azure` 3.0.72 の変換処理。
- **Findings**:
  - AI SDK v3 の使用量は `inputTokens: { total, noCache, cacheRead, cacheWrite }`、`outputTokens: { total, text, reasoning }` の入れ子になっている。
  - `inputTokens.total` は、どのプロバイダでもキャッシュ分を含む合計である。キャッシュに書き込んだ数（`cacheWrite`）を返すのは Anthropic だけで、OpenAI・Azure・Google は常に値なし。
  - 推論トークンは、3 社とも出力トークンの合計にすでに含まれる（Google は `candidates + thoughts`、Anthropic は思考を出力に数える）。
- **Implications**: キャッシュでない入力 = `inputTokens.total − cacheRead − cacheWrite`（値なしは 0 とみなす）。推論トークンを費用に足すと二重に数えるので、記録はするが費用には使わない。

### models.dev の単価の形

- **Context**: カタログに取り込む項目を決めるため、実データを数えた（2026-10-10）。
- **Sources Consulted**: `https://models.dev/api.json` をそのまま取得し、カタログの絞り込み（ツール呼び出しができ、テキストを出力するモデル）を通ったものを数えた。
- **Findings**:
  - 対象モデル数と単価の有無: OpenAI 44（全部あり）、Anthropic 17（全部あり）、Google 22（Gemma 2 モデルだけ単価なし）。
  - `cache_read` は OpenAI 35・Anthropic 17・Google 17、`cache_write` は OpenAI 10・Anthropic 17。
  - 段階料金: `tiers: [{ input, output, cache_read?, cache_write?, tier: { type: 'context', size } }]`。OpenAI 13・Google 6・Anthropic 1 モデルが持つ。`type` は `context` しか見つからなかった。旧形式の `context_over_200k` も並んでいるが、`tiers` と同じ内容である。
  - 例: `gpt-4o-mini` は `{ input: 0.15, output: 0.6, cache_read: 0.075 }`。`gpt-5.4` は基本 `{ input: 2.5, output: 15 }`、入力 272,000 トークン超で `{ input: 5, output: 22.5 }`。
- **Implications**: 単価は項目ごとに欠けうるので、すべて省略可能にする。段階は `type: 'context'` だけを取り込み、知らない種類は無視する。

### カタログの保存と読み込み

- **Context**: 単価を足すと、既存のカタログ処理のどこが変わるかを調べた。
- **Sources Consulted**: `build-model-catalog.ts`、`refreshed-model-catalog.ts`、`effective-model-catalog.ts`、`get-available-models.ts`、`resource/model-catalog-data.json`、`bin/vendor-model-catalog.ts`。
- **Findings**:
  - 同梱カタログ（`resource/model-catalog-data.json`）は `{id, name}` だけで、単価は変換の時点で捨てている。
  - リフレッシュ済みカタログを読むときの検証（zod 4 の `z.object`）は、知らないキーを黙って取り除く。単価を検証の定義に足さないと、保存した単価が読み込み時に消える。
  - `GET /_api/v3/ai-settings/available-models` は、カタログの要素をそのまま返している。要素に単価を足すと、クライアントへ単価が漏れる。
  - 新しい方のカタログを選ぶ処理は `getEffectiveModelPicker` の中に埋まっていて、どちらを選んだかと、その日時は外に出ていない。
  - 管理画面からの手動リフレッシュは、もともと AI の有効・無効を見ていない。
- **Implications**: 単価は省略可能な項目として読み込み時の検証に足す。モデル一覧の応答は `{id, name}` に詰め直す。「どちらのカタログを採用したか」を返す関数を 1 つ切り出し、既存の選択処理もその上に載せ替える（比較処理を 2 か所に書かない）。

### 保存先の前例

- **Context**: 90 日で消える新しいコレクションを、今のデータ層の方針（Mongoose から Prisma へ移行中）に沿って置く方法を調べた。
- **Sources Consulted**: `.claude/rules/model.md`、`mongoose-to-prisma` スキル、`server/models/page-redirect.ts`、`features/news/server/models/news-item.ts`、`utils/prisma.ts`、`non-transferable-collections.ts`。
- **Findings**:
  - コレクションとインデックスを作るのは、移行が終わるまで Mongoose の役目である。Prisma のスキーマの `@@index` は今は効かない。
  - `page-redirect.ts` は、同じファイルに Mongoose のスキーマ（インデックスの定義）と Prisma の拡張（問い合わせ）を置き、`utils/prisma.ts` から拡張を読み込んでいる。`utils/prisma.ts` は起動時に読まれるので、インデックスは起動時に作られる。
  - 90 日の TTL の前例は news の `fetchedAt: { index: { expireAfterSeconds } }`。
  - Prisma から集計するときは `aggregateRaw` と `toRawDate` を使う（`aggregate-contributions.ts` など）。
  - DB にあるコレクションはすべて、G2G で移すかどうかの分類が必要である（`non-transferable-collections.integ.ts` が分類漏れで失敗する）。
- **Implications**: `page-redirect.ts` と同じ形にする。使用量の記録は、その GrowiApp 自身の運用の記録なので、G2G では移さない側に分類する。

### 公開 API の置き場所と守り方

- **Context**: 認証なし、メンテナンスモード中も応答、AI が無効でも応答、重い AI パッケージを読み込まない、送信元ごとの回数制限、の 5 つを同時に満たす置き場所を探した。
- **Sources Consulted**: `server/routes/index.js`、`server/routes/apiv3/index.js`、`healthcheck.ts`、`staffs/index.ts`、`features/rate-limiter/**`、`avoid-session-routes.js`、`no-eager-ai-imports.spec.ts`。
- **Findings**:
  - `/_api/v3` のうち、`routerForAdmin` は `unavailableWhenMaintenanceModeForApi` より前に載っている。healthcheck はここにあり、メンテナンスモード中も応答する。`router`（`/mastra` や `/ai-tools` を含む）はメンテナンスモード中は 503 を返す。
  - `/mastra` と `/ai-tools` には、ルーター全体に `aiReadyGuard`（AI が無効なら 501）が付いている。
  - rate-limit はアプリ全体に掛かっていて、`/_api/v3` より前に動く。エンドポイントごとの既定値は `features/rate-limiter/config/index.ts` の `defaultConfig` に書き、env で上書きできる。キーは、ログインしていなければ IP。上限を超えると 429 を返す。
  - Cookie のないリクエストは、そのたびにセッションを 1 件書き込む（`saveUninitialized: true`）。healthcheck は、`genid` で固定のセッション ID を返すことで、問い合わせが何回来てもセッションを 1 件に抑えている（`crowi/index.ts`）。`avoid-session-routes.js` でセッションを飛ばすと、後ろの csurf と `passport.session()` が `req.session` を必要とするのでエラーになる（今のリストの `/api-docs/` はどのルートにも当たっていない）。
  - `no-eager-ai-imports.spec.ts` は `apiv3/index.js` から静的な import をたどり、`@mastra/*`・`@ai-sdk/*`・`ai` などを見つけたら失敗する。
  - OpenAPI の生成対象は glob で列挙されていて、新しい機能ディレクトリのルートは足さないと載らない。
- **Implications**: `routerForAdmin` に載せ、rate-limit の既定値と、固定のセッション ID を足す。メンテナンスモード中の応答は、ミドルウェアの一覧（`route-middleware.json`）では確かめられないので、専用のテストを書く。

### 定期リフレッシュの時刻をずらす方法

- **Context**: 要件 6.4〜6.6。遅らせた取得が次の定期リフレッシュの時刻を越えないようにする必要がある。
- **Sources Consulted**: `server/service/cron.ts`、node-cron 3.0.3、`server/util/random-sleep.ts` とその利用箇所。
- **Findings**: `CronService` は実行が重なるのを防いでいない。node-cron 3 には次の実行時刻を求める公開の手段がない（`TimeMatcher` は内部のファイル）。既存のテストは `Math.random` を固定して待ち時間を 0 にしている。
- **Implications**: スケジュールを解釈せずに 6.5 を守るため、「遅らせている途中で次の契機が来たら、待ちを打ち切ってすぐ取得する」形にする。依存は増やさない。

## Architecture Pattern Evaluation

| 方式 | 内容 | 長所 | 短所・制約 | 判断 |
|---|---|---|---|---|
| モデルを包む（採用） | エージェントの `model` 関数と `generateTitle.model` で、返すモデルを `wrapLanguageModel` で包み、呼び出しごとの使用量をリクエスト単位の集計器へ渡す | 3 か所を 1 つの仕組みで覆える。呼び出しごとの入力トークン数が分かるので段階料金を選べる。エラー前に完了したステップも取れる | Mastra が `model` 関数を呼び出しごとに評価することに依存する（実測で確認） | 採用 |
| 呼び出し側でコールバック | `onStepFinish` で集計し、`finally` で記録する | Mastra の公開 API だけで済む | タイトル生成には使えるコールバックがない。タイトル用に別の仕組みが要り、2 系統になる | 不採用 |
| Mastra の観測機能 | `@mastra/observability` の span から使用量を集める | 1 か所で全部を見られる | 依存が増える。非同期でサンプリングに左右される。ユーザー ID を span に載せる仕組みが要る | 不採用 |
| タイトルを自前で生成 | `generateTitle: false` にして、post-message の成功時に自分で生成する | 使用量を確実に取れる | タイトル生成の再試行など、Mastra の振る舞いを作り直すことになる | 不採用（包む方式で取れたため不要） |

## Design Decisions

### Decision: 使用量はモデルを包んで捕まえ、リクエスト単位で 1 件にまとめる

- **Context**: 要件 2.1〜2.3・2.6・3.7。
- **Alternatives Considered**: 上の表のとおり。
- **Selected Approach**: エージェントの `model` 関数で、解決したモデルを包む。包んだモデルは、呼び出しが終わるたびに使用量を `requestContext` の集計器（UsageMeter）へ渡す。チャットと suggest-path は、応答が終わった時点（成功・失敗とも）で集計器を閉じ、1 件の記録として書く。タイトル生成は 1 回の呼び出しなので、集計器を通さずに 1 件として書く。集計器を閉じたあとに届いた呼び出しや、集計器がない場合の呼び出しは、それぞれ 1 件として書く（記録漏れを防ぐ）。
- **Rationale**: 1 つの仕組みで 3 か所を覆え、段階料金のために必要な「呼び出しごとの入力トークン数」も手に入る。
- **Trade-offs**: タイトル生成の分だけ、包み方が 2 通りになる（集計器へ渡すか、直接書くか）。チャットの `requestContext` はタイトル生成にもそのまま渡るので、タイトル用の `model` 関数はチャットの集計器を使ってはいけない。
- **Follow-up**: 実際のプロバイダ（OpenAI・Anthropic・Google）で、キャッシュの項目に値が入るかを手で確かめる（umbrella の未決 2）。

### Decision: 推定費用は呼び出しごとに計算して合計する

- **Context**: 要件 3.1〜3.4・3.7。段階料金は、その呼び出しの入力トークン数で決まる。
- **Selected Approach**: 集計器は呼び出しごとの使用量を持ったまま閉じる。記録するときに、呼び出しごとに段階を選んで推定費用を出し、合計する。重み付き消費量 = 推定費用の合計 ÷ 基準モデルの基本の出力単価（1 トークンあたり）。基準モデルの段階料金は使わない。
- **Rationale**: 応答の合計トークン数で段階を選ぶと、短い呼び出しを何回も重ねただけで高い段階に入ってしまう。
- **Trade-offs**: どの呼び出しかの内訳は記録に残さない（記録 1 件に合計だけを持つ）。

### Decision: 単価はカタログの要素に省略可能な `pricing` として持たせる

- **Context**: 要件 1.1〜1.6。
- **Selected Approach**: `ModelCatalogEntry` に `pricing?` を足す。中身の 4 項目と段階はすべて省略可能にする。読み込み時の検証では、単価の部分が壊れていてもその要素だけ単価を「不明」として扱い、カタログ全体は捨てない。モデル一覧の応答は `{id, name}` に詰め直す。
- **Rationale**: 古いカタログ（単価なし）と新しいカタログが混ざっても動き続けるようにするため。

### Decision: 公開 API は `routerForAdmin` に置き、rate-limit と固定のセッション ID を足す

- **Context**: 要件 4.4・4.6・4.7・4.10・4.11。
- **Selected Approach**: `GET /_api/v3/ai-usage` を `routerForAdmin` に載せる（healthcheck と同じ）。rate-limit の既定値は IP ごとに 1 分 5 回。セッションは固定の ID で 1 件に抑える。正しいパスへの GET 以外は、集計の前に 404 か 405 で断る。開始時刻は 1〜10 個に制限する。集計は、いちばん古い開始時刻から 1 回だけ記録を読み、開始時刻ごとの合計を同時に出す。
- **Rationale**: GROWI.cloud の問い合わせは 5 分に 1 回の見込みなので、1 分 5 回で足りる。
- **入口の検査**: Express はパスの大文字・小文字の違いや余分なスラッシュを同じルートに届けるが、回数制限は `req.path` の文字列そのままで設定を探し、枠を分ける。書き方を変えると制限をすり抜けられるので、ルートの入口で正しい書き方以外を 404 にする（Express 4.21 で実測）。メソッドも同じで、Express は GET の処理を HEAD でも呼ぶが、回数制限は HEAD を別の枠（既定値）で数える。そのため GET 以外は 405 にする。
- **Trade-offs**: IP ごとの制限なので、ingress の後ろでは外部からのリクエストがすべて同じ IP に見える。GROWI.cloud では外部からのアクセスを遮断するので問題にならない。下の「Risks」を参照。

### Decision: 停止理由と基準モデルは env だけから読む

- **Context**: 要件 5.1〜5.4、umbrella の D2。
- **Selected Approach**: `config-definition.ts` に登録し、`env:useOnlyEnvVars:ai` グループの固定対象に入れる（D2）。読むときは `ConfigSource.env` を指定し、DB の値が混ざらないようにする（`vault-settings-service.ts` の前例）。設定画面は作らない。管理画面のホームには、既存の仕組み（`getManagedEnvVars`）で、設定されている env の一覧として値が出る。値は秘密ではないので、隠さない。

### Decision: 定期リフレッシュは最大 1 時間遅らせ、次の契機で待ちを打ち切る

- **Context**: 要件 6.4〜6.7。
- **Selected Approach**: 定期リフレッシュは、契機のたびに 0〜1 時間のランダムな時間だけ待ってから取得する。待っている間に次の契機が来たら、前の待ちを打ち切ってすぐ取得し、新しい契機はまた待ち始める。起動時のリフレッシュは既定で ON にし、ずらさずにすぐ取得する（6.7）。起動の時刻は GROWI ごとにばらばらなので、集中しない。
- **Rationale**: 1 時間あれば、多数の GROWI のアクセスを十分に分散できる。止まった app の復旧を遅らせすぎないよう、上限を news（5 時間）より短くした。
- **Trade-offs**: 1 時間より短い間隔のスケジュールでは、前の契機の取得と新しい契機の取得が近い時刻に重なることがある。

## Risks & Mitigations

- **外部から呼べると、回数制限を他人に使い切られる** — ingress の後ろでは、外部からのリクエストがすべて ingress の IP に見え、同じ枠を共有する。悪意のある第三者が枠を使い切ると、GROWI.cloud の問い合わせも 429 になり、組織の判定が見送られる。
  - 対策: GROWI.cloud は、この API を外部から呼べないようにする（2026-10-10 方針）。GROWI.cloud 自身がどの経路（ingress 経由か、クラスタ内から直接か）で問い合わせるかは GROWI.cloud が決める。外部の第三者が呼べなければ枠を使い切られることはなく、trust proxy の設定も要らない。
  - 遮断の注意点: GROWI は、パスの大文字・小文字の違い（`/_API/V3/AI-Usage`）、末尾のスラッシュ、途中の二重スラッシュ（`/_api/v3//ai-usage`）があっても同じ API に届く（Express 4.21 で実測）。遮断の規則は、大文字・小文字を区別しない前方一致で書く。
  - 不採用: trust proxy で本当の送信元 IP を読ませる案。設定を誤る余地がある（`TRUST_PROXY_BOOL=true` だと `X-Forwarded-For` のいちばん左、つまり送り手が自由に書ける値を送信元とみなすので、他人の IP を名乗れる）うえ、正しく設定しても第三者が API を呼べること自体は変わらない。
- **リリース直後に、カタログが古いと判定されうる** — 新しいリリースに上げると、newer-wins の比較（両側とも同梱カタログの生成日時で比べる）で同梱カタログが選ばれ、取得日時がリリース時の生成日時に戻る。毎日のリフレッシュ済みカタログの方が中身は新しくても同じである。AI を有効にして初めて起動したときも、保存済みのカタログがないので同じになる。リリースから 3 日以上たってから上げた app は、上げた直後から「古い」と判定され、停止と再開で 2 回再起動しうる。
  - 上限超過などで止まっていた app も、再開したときに同じことが起きる。止まっている間はリフレッシュしないので、保存済みのカタログが止めた時点のまま古くなる。
  - 対策（2026-10-10 決定、要件 6.7）: 起動時のリフレッシュ（`ai:modelCatalogRefreshOnStartup`）を既定で ON にし、リフレッシュが許されていれば、起動するたびにすぐ取得する。比較の仕方（newer-wins）は変えない。サーバーの時計のずれに強いという、比較の仕方を選んだ理由が残っているためである。
  - 不採用: 「同梱カタログが使われているとき」や「取得日時が 24 時間より古いとき」だけ取りに行く案。条件が増えるわりに、毎回取りに行くのと比べて得るものが小さい（起動は頻繁ではない）。
  - 残る問題: 起動してから取得し終えるまでの数秒間は、公開 API が古い取得日時を返しうる。GROWI.cloud 側で、再起動の直後の 1 回の判定だけで止めないようにしてもらう。`ai-usage-growi-cloud` に引き継ぐ。
- **Azure OpenAI の使用量は倍率が常に「不明」になる** — Azure はカタログを持たず、モデル ID も配備名である。Hosted では使わない前提とし、生トークン数として返す（要件 3.4 の扱い）。
- **カタログにないモデル ID を管理者が許可した場合も倍率は「不明」** — 同上。
- **キャッシュの項目が実際には入らない可能性** — 実プロバイダでの確認は手作業の確認項目にする。入らない場合は、キャッシュ分を通常の入力単価で数えるので、費用を多めに見積もる側に倒れる。
- **集計器を閉じる前にプロセスが落ちると、その応答の記録は失われる** — 記録の失敗をユーザーに見せない方針（要件 2.8）と同じ扱いにする。

## References

- `https://models.dev/api.json` — 単価と段階料金の出典（MIT）
- `.kiro/specs/ai-usage/roadmap.md` — 決定事項 D1〜D14、Amend target
- `.kiro/specs/ai-provider-model-picker/design.md` — カタログの元の設計（Amend target）
- 社内 wiki「/Projects/GROWI/GROWI.cloud/会議室/20260911 GROWI AI Agent オプションサービススペック検討」§6.3・§6.4・§7.1
