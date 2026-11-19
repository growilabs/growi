# Research & Design Decisions: attachment-search-text-extractor-ops-1-1

この文書は、design.md の判断の理由と、2026-11-19 に手元で行った実験の記録である。取り込みのときに、対象 spec (`attachment-search-text-extractor` と `attachment-search-indexing`) の research.md に移す。

## Summary

- **Feature**: `attachment-search-text-extractor-ops-1-1` (抽出サービス 1.1.0)
- **Discovery Scope**: Extension (既存のサービスへの追加と、不具合の修正)
- **Key Findings**:
  - PPTX / XLSX の「ファイル全体を anydoc に渡す」経路で、ZIP の 3 つの上限を通らずに変換できることを実験で確かめた。10 万セルの XLSX が、必要な部品を 2 つ入れるか、変な形のエントリを 1 つ足すだけで変換された (§3)
  - `prlimit` を通して抽出サービスと同じ形で起動した子が、親の `/proc/<pid>/environ` から仮のトークンを読めた。親のメモリ (`/proc/<pid>/mem`) は開けなかった (手元の dev container、Yama の `ptrace_scope` が 1。§5)
  - orval 7.2 は、OpenAPI の文書のヘッダーの parameter から関数の引数も型も作らない。生成クライアントは変わらない (§2.2)
  - 設定 `app:growiAppIdForCloud` は、型の宣言は `number | undefined` だが、実際には環境変数の文字列がそのまま入る (§2.3)

## 1. `/metrics` の部品: `prom-client` を使う

### Decision: `prom-client` を本番の依存に加える

- **Context**: Req 3 は、gauge・ラベル付きのカウンタ・ヒストグラムと、プロセスの CPU・メモリ・イベントループの遅れを、Prometheus のテキスト形式で出すことを求める。
- **Alternatives Considered**:
  1. `prom-client` を使う
  2. テキスト形式を自分で書く (`process.cpuUsage()`、`process.memoryUsage()`、`perf_hooks.monitorEventLoopDelay()` を読み、形式の決まり (エスケープ、`# HELP`・`# TYPE` の行、ヒストグラムの `_bucket`・`_sum`・`_count` と `le="+Inf"`) を自分で守る)
  3. OpenTelemetry の SDK と Prometheus の exporter (apps/app は `@opentelemetry/exporter-prometheus` を使っている)
- **Selected Approach**: 1。
- **Rationale**:
  - プロセスの既定の指標の名前 (`process_cpu_seconds_total`、`process_resident_memory_bytes`、`nodejs_eventloop_lag_seconds` など) は、Node のサービスで広く使われている名前で、運用者の既存のダッシュボードと警報の設定がそのまま使える。2 で同じ名前と意味を再現すると、保守するコードが増え、意味のずれを確かめる手段も無い
  - 2 は依存を増やさないが、形式の決まりを守るコードとテストを自分で持つことになる。小さくはならない
  - 3 は部品が多く、このサービスの小さな image と少ない依存の方針に合わない
- **Trade-offs**: 本番の依存が 11 個から 12 個になる。`prom-client` は HTTP の層だけで使い、変換の子は読み込まない (`test/layers/layer-rules.ts` に足す)。
- **Follow-up (実装のタスクで確かめること)**: `prom-client` は、いまの `pnpm-lock.yaml` にも、手元の pnpm の store にも無い。この spec を書いた環境はネットワークに出られないので、版、依存の木、ライセンスは確かめていない。入れるときに次を確かめ、対象 spec の research.md §1.4 の形で記録する: 版を固定する範囲 (ほかの依存と同じく `^`)、依存のすべてが許容的なライセンス (MIT / Apache-2.0 / BSD / ISC) であること、install のときにスクリプトを動かさないこと (`pnpm-workspace.yaml` の `allowBuilds` を広げない)、image の大きさ (いまは展開して amd64 で 259,258,880 バイト、arm64 で 277,116,416 バイト。上限 400,000,000 バイト) が大きく変わらないこと。

### 本番の依存を増やすときに一緒に直す場所 (確かめた)

- `test/deploy/production-dependencies.spec.ts`: 本番の依存の一覧を完全一致で固定している (いまは 11 個)。`prom-client` を足し、テスト名とコメントの「eleven」を直す
- `test/layers/layer-rules.ts` の `PACKAGE_RULES`: いまは `{ packages: ['zod', 'hono-openapi'], onlyLayers: ['http'] }`。`prom-client` を足す
- `docker/Dockerfile`: 変えなくてよい。build の段の `pnpm deploy out --prod --legacy` が本番の依存を取り出すので、`package.json` と `pnpm-lock.yaml` を直せば image に入る
- `pnpm-lock.yaml`: `pnpm install` で更新する (ほかの pnpm の実行と同時に動かさない。`.claude/rules/devcontainer.md`)。`ci-attachment-text-extractor.yml` は `pnpm-lock.yaml` の変更でも動く

## 2. 呼び出し元の app の ID

### 2.1 ヘッダーの名前と形 (ユーザーと lead の決定)

- 名前は `X-Growi-App-Id`。値は設定 `app:growiAppIdForCloud` (環境変数 `GROWI_APP_ID_FOR_GROWI_CLOUD`) の値。
- 形は `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`。ログの行は空白で区切った `key=value` の並びなので、空白・`=`・改行などを通さない。英数字で始めるので、`-` と `(invalid)` は本物の値と取り違えない。
- 値は自己申告で認証されていない。負荷の内訳を見るためだけに使い、認可・上限・判断には使わない。悪い値で要求を失敗させない (負荷の内訳のためのラベルにすぎないため)。
- メトリクスのラベルには使わない。自己申告の値は種類が際限なく増えうる (ラベルの値の種類が増えると、監視システムの記憶と計算の量が増える)。

### 2.2 orval はヘッダーの parameter から何も作らない (実験)

- **やったこと**: `packages/attachment-text-extractor-client` の `openapi.json` を `/tmp/orval-header-exp/` に写し、`POST /extract` に `{"in":"header","name":"X-Growi-App-Id","required":false,"schema":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"}}` を足した文書と、足さない文書から、それぞれ orval (`v7.2.0`、main checkout の node_modules のもの、設定は `input` と `output.target` だけ) でクライアントを作り、`diff` で比べた。
- **結果**: 2 つの出力は 1 バイトも違わなかった。`postExtract(postExtractBody, options?: AxiosRequestConfig)` のままで、ヘッダーの型も作られない。
- **意味**: OpenAPI の文書にはヘッダーが載るが、生成クライアントは変わらない。apps/app は今と同じく axios の `options.headers` で渡す。対象 spec の AC 7.2 (生成クライアントは文書のとおりに項目を持つ) は、ヘッダーについては成り立たない。これは orval の既定 (ヘッダーの引数は `headers: true` を指定したときだけ作る) によるもので、AC 7.6 (文書のための指定を書かない) を守るために、この設定は足さない。取り込みのときに、対象 spec の research.md §5.6 にこの事実を足す。
- **`info.version` を 1.1.0 にすると**: 生成クライアントの先頭のコメントに `OpenAPI spec version: 1.0.0` の行がある。この行だけが変わる。`ci-app.yml` は生成クライアントを作り直して commit 済みのものと比べるので、作り直したものを commit する。
- **`describeRoute` が `parameters` を受け付けること**: `hono-openapi` の型 (`DescribeRouteOptions` は OpenAPI 3.1 の `OperationObject` から `requestBody`・`responses`・`operationId` を除いたもの) で確かめた。文書に実際に出ることは、実装のときに書き出しの手順の出力で確かめる。

### 2.3 設定の値は、実際には文字列で入る

- `config-definition.ts` は `'app:growiAppIdForCloud': defineConfig<number | undefined>({ envVarName: 'GROWI_APP_ID_FOR_GROWI_CLOUD', defaultValue: undefined })` と宣言している。
- `config-loader.ts` の `parseEnvValue(value, typeof metadata.defaultValue)` は、既定値の型で読み方を選ぶ。既定値が `undefined` なので型は `'undefined'` になり、`default` の分岐で文字列をそのまま返す。つまり値は数ではなく、環境変数の文字列そのものである (`parseInt` は通らないので `NaN` にもならない)。
- 送る側は `String(value)` で扱い、数であることを前提にしない。値の形の検査は抽出サービスが行う。

### 2.4 apps/app がヘッダーに入れる前に確かめること

- Node は、ヘッダーの値に使えない文字があると、要求を作る時点で例外を投げる。手元で `http.request(url, { headers: { 'X-Growi-App-Id': 'a\nb' } })` は `ERR_INVALID_CHAR` を投げ、`'日本'` も同じだった。このまま渡すと、ラベルのための値のせいで抽出そのものが失敗する (Req 2.3 に反する)。
- **決定**: apps/app は、文字列が空でなく、表示できる ASCII 文字 (0x21〜0x7E) だけでできているときだけ付ける。形 (`^[A-Za-z0-9]…`) の検査は抽出サービスだけで行う。
- **理由**: apps/app の検査は「自分の要求を壊さない」ためで、抽出サービスの検査は「ログの行を壊させない」ためである。目的が違う。形の決まりを 2 か所に書くと、片方だけ変わったときに食い違う。形に合わない値は抽出サービスのログで `(invalid)` と分かるので、運用者は設定の誤りに気づける。
- **採らなかった案**: apps/app でも同じ形で検査して、合わなければ付けない。ログには `-` と出て、ヘッダーが無い app と区別できなくなる。

### 2.5 ヘッダーを読む場所

- 認証の後、route の最初 (宣言された `Content-Length` の確かめと、枠を取るより前) で読む。ヘッダーは本文より先に届いているので、本文を読む前に断る行にも値を出せる。
- 認証より前には読まない。401 の要求は行を出さない (§8) ので、読んでも使い道が無い。
- Node は、同じ名前の未知のヘッダーが 2 つ以上あると、`, ` でつないだ 1 つの値にする (`c.env.incoming.headers`)。その値は形に合わないので `(invalid)` になる。2 つのうちどちらかを選ぶ規則を足さない。

## 3. ZIP の上限を回避する経路

### 3.1 実験

- **やったこと**: 一時的なテストのファイル (`src/conversion/zz-*.spec.ts`。実験の後に消した) で、変換の層の入口 `convert` に、既定の上限 (`MAX_XLSX_CELLS` 70,000、`MAX_ARCHIVE_ENTRIES` 10,000、`MAX_ARCHIVE_UNCOMPRESSED_MB` 512) で次のファイルを渡した。XLSX は `test/fixtures/xlsx.ts` の `xlsxParts` で、1 シートに 50,000 行 × 2 列 (10 万セル) を作った。ZIP は `test/fixtures/zip.ts` の `buildZip` で作り、中央の一覧の値を直接書き換えた。
- **結果**:

| 入力 (名前は `a.xlsx`) | `inspectArchive` の結果 | 変換の結果 |
|---|---|---|
| 10 万セルの XLSX (対照) | 一覧を返す | `limit_exceeded` (セル数) |
| 同じ XLSX に `xl/workbook.xml` をもう 1 つ足す | `null` (必要な部品が 2 つ) | **成功** (1 要素、1,077,794 字) |
| 先頭に `versionNeeded` を 100 にしたエントリを 1 つ足す | `null` (一覧を読み切れない) | **成功** (1,077,794 字) |
| 先頭に、UTF-8 の印があるのに名前が UTF-8 でないエントリを 1 つ足す | `null` (一覧を読み切れない) | **成功** (1,077,794 字) |
| 上の XLSX に 12,000 個のエントリを足す (対照) | — | `limit_exceeded` (エントリ数) |
| 12,000 個のエントリを足し、先頭に `versionNeeded` 100 のエントリ | `null` | **成功** (1,077,794 字) |
| `xl/workbook.xml` を `xl/wbook.xml` に変え、参照も書き換える | `null` (必要な部品が無い) | 成功するが 0 字 |
| 全部の名前の前に `/`、`./`、`\` の区切り、大文字、`xl/Workbook.xml` | `null` (必要な部品が無い) | `malformed` |
| DOCX を `.pptx` / `.xlsx` として、XLSX を `.pptx` として、ただの ZIP を `.xlsx` として | `null` (必要な部品が無い) | `malformed` |
| 中央の一覧の無い XLSX (ZIP の終わりの記録も無い) | `null` (ZIP でない) | `malformed` |
| 終わりの記録の中央の一覧の位置を 3 バイトずらした XLSX | `null` (yauzl が開けない) | `malformed` |
| 暗号化された XLSX (中身は CFB) | `null` (ZIP でない) | `encrypted` |
| 旧形式の XLS を `.xlsx` として | `null` (ZIP でない) | 成功 (19 字) |

- **読み取れること**: `null` の 4 つの場合のうち、
  - **ZIP でない**: 正しく通す必要がある (暗号化された OOXML が `encrypted` になり、旧形式の XLS が読める)。
  - **一覧を読み切れない**: 3 つの上限 (エントリ数、展開後の大きさ、セル数) をすべて通らない。
  - **必要な部品が 2 つ以上**: エントリ数と展開後の大きさは確かめた後なので、セル数の上限だけを通らない。
  - **必要な部品が無い**: 試したどの形でも、anydoc は何も取り出さないか `malformed` を返した。上限を通らずに中身が変換される形は見つからなかった。
- anydoc には組み込みの展開量の上限 (512MiB) があるが、エントリ数の上限は試した範囲では無かった (12,000 エントリが通った)。セル数の上限は anydoc に無い。

### 3.2 Decision: ファイル全体を anydoc に渡すのは「ZIP でない」ときだけにする

- **Selected Approach**: `inspectArchive` の `null` を「ZIP の終わりの記録が見つからない」だけの意味にする。終わりの記録が見つかったのに yauzl が開けない、一覧を読み切れない、必要な部品が無い、2 つ以上ある、の 4 つはすべて `malformed` にする。
- **Rationale**:
  - 実際に上限を回避できたのは 2 つの場合だが、「ZIP なのに検査を通せない」形をまとめて断るほうが規則が単純で、`null` の意味が 1 つになり、分岐が減る。別の検査を並べて足す形より、穴をふさぐ場所が 1 か所で済む。
  - 必要な部品が無い場合と yauzl が開けない場合は、実験では anydoc も `malformed` か 0 字だった。断っても、呼び出し側から見た結果はほぼ同じである (0 字の成功が `extraction_failed` に変わる形はある)。
  - ZIP でない形 (暗号化された OOXML、旧形式) の扱いは変わらない。
- **応答**: `malformed` は既存の `extraction_failed` (422)。`ErrorCode`、ステータス、OpenAPI の文書は変わらない。
- **Follow-up**: yauzl が開けない ZIP は、実験では 1 つの形 (一覧の位置のずれ) しか試していない。zip64 の形のうち yauzl が開けないものがあれば、いままで anydoc が読めていたものが断られる。既存の「zip64 の大きさで書いた部品を受け付ける」テストは残す。

### 3.3 以前の動きとの違い (対象 spec の research.md §5.4 と同じ形の記録)

- **以前の動き**: CPython の `zipfile` が開けない ZIP (扱えない版の印、UTF-8 の印と合わない名前) と、必要な部品が無いか 2 つある ZIP は、ファイル全体を anydoc に渡していた。以前の Python の実装と同じ扱いで、`archive-guard.spec.ts` の「passes … through」のテストがこれを固定している。
- **いまの動き**: 上のどれも `malformed` (422 `extraction_failed`) で断る。
- **合わせない理由**: 以前の扱いでは、ZIP の上限とセル数の上限が回避できる (§3.1)。上限は細工したファイルから子を守るためのもので、以前の実装に合わせることより優先する。

### 3.4 この spec で扱わないもの

- `office` の経路 (DOCX、ODT など) は、もともと `inspectArchive` を通らない。エントリ数の上限は anydoc 任せで、守りの境界は RSS の上限である。この spec の範囲 (PPTX / XLSX の fallback) の外なので、変えない。

## 4. `/readyz` の結果を覚える期間: 10 秒

- **Context**: いまは呼ぶたびに確認用の子を起動する (1 回約 0.24〜0.4 秒の CPU)。同時の呼び出しは 1 回の確認を共有するが、終わった後は覚えないので、トークンなしで休みなく呼ばれると最大で約 1 コアを使う。覚えないのは、固まった部品を検知できなくならないため、準備未完了から戻れるようにするため、だった。
- **前提**: `docker/README.md` が勧める確認の設定は、間隔 20 秒、期限 15 秒、3 回の失敗。確認用の子の期限は 10 秒。
- **Selected Approach**: 確認を終えた時点から 10 秒間、結果を覚える。準備完了と未完了のどちらも覚える。
- **理由**:
  - 10 秒は確認の間隔 (20 秒) より短い。kubelet の確認の前の確認は、普通は 20 秒前に終わっているので、kubelet は毎回新しい確認の結果を受け取る。kubelet から見た振る舞いは、普段は変わらない。
  - トークンなしの呼び出しで起動される確認は、10 秒 (+ 確認そのものの時間) に 1 回までになる。CPU は最大で 0.4 秒 / 10 秒、1 コアの約 4% に下がる。
  - 部品が固まってから気づくまでの時間: 確認の結果が最大 10 秒古いので、いまの「3 回の失敗 × 20 秒」に最大 10 秒足した、約 70 秒以内になる。
  - 準備未完了から戻るまでの時間: 覚えた未完了の結果は 10 秒で消えるので、部品が直ってから最大で「10 秒 + 次の確認の間隔」で戻る。
  - 未完了も覚えるのは、未完了の結果だけを覚えないと、固まった部品のある Pod で、トークンなしの呼び出しが 10 秒の期限の確認を続けて起こせるからである。
- **終えた時点から数える理由**: 確認は最大 10 秒かかる。始めた時点から数えると、遅い確認の結果は覚えた瞬間に古くなり、覚える意味が無くなる。
- **環境変数にしない理由**: 運用者が変える値ではなく、確認の間隔との関係 (間隔より短いこと) をコードの側で守るため。`docker/README.md` には値と、確認の間隔を 10 秒以下にしないことを書く。
- **採らなかった案**: 準備完了だけを長く覚える (固まった部品を見落とす時間が延びる)。トークンなしの `/readyz` を断る (k8s の確認はトークンを送れない)。

## 5. 変換の子が親の環境変数を読めるか (実験)

### 5.1 やったこと

リポジトリの外の `/tmp/extractor-child-env-exp/` に、使い捨てのスクリプトを 2 つ書いた。

- `parent.mjs`: 自分の環境変数に仮のトークン `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=fake-secret-for-experiment-0123` を持って起動し、抽出サービスの `src/runner/child-run.ts` と同じ形で子を起動する。すなわち `spawn('/usr/bin/prlimit', ['--as=2751463424', '--cpu=60:65', '--core=1', '--', process.execPath, '--wasm-max-mem-pages=8192', '--max-semi-space-size=4', 'child.mjs'], { stdio: ['pipe','pipe','pipe','pipe','pipe'], env: { RAYON_NUM_THREADS: '1', MALLOC_ARENA_MAX: '2' } })`。`--as` の値は `MAX_CHILD_RSS_MB` 320 + 2,304MiB、`--cpu` は `TIMEOUT_S` 55 からの値で、`prlimit-args.ts` と `conversion-runner.ts` の作り方に合わせた (親の hard の上限は無制限だったので切り詰めは起きない)。`env` は `child-env.ts` の 2 つだけ。
- `child.mjs`: `process.ppid` を親とみなし、自分の環境変数、自分の上限 (`/proc/self/limits`)、親の `/proc/<ppid>/cmdline`、親の `/proc/<ppid>/environ` を読み、親の `/proc/<ppid>/mem` を開こうとする。
- 実行したコマンド: `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=fake-secret-for-experiment-0123 node parent.mjs`

さらに `sibling-parent.mjs` で、同じ形の子を 2 つ起動し、2 つ目の子から 1 つ目の子の `/proc/<pid>/fd` の一覧、`fd/0` の行き先、`fd/0` を開くこと、`mem` を開くことを試した。

### 5.2 結果 (出力そのまま)

```
parent pid=2435003 child pid=2435010 secret_in_parent_env=true
child pid / ppid: 2435010 / 2435003
own environ: RAYON_NUM_THREADS=1 MALLOC_ARENA_MAX=2
parent cmdline: node parent.mjs
own limits (as, cpu, core): Max cpu time 60 65 seconds  | Max core file size 1 1 bytes  | Max address space 2751463424 2751463424 bytes
parent environ has token: YES (ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=fake-secret-for-experiment-0123)
open parent /proc/<ppid>/mem (ptrace attach mode): ERROR EACCES
child exit=0
```

兄弟の子の試し:

```
sibling fd list: 0,1,10,11,12,13,14,15,16,2,3,4,5,6,7,8,9
sibling fd/0 target: socket:[90237994]
open sibling fd/0: ERROR ENXIO
open sibling mem: ERROR EACCES
```

- 子自身の環境変数は 2 つだけで、トークンは渡っていない (設計どおり)。`prlimit` は上限を掛けてから node を exec するので、子の親は抽出サービスの親そのものである。
- 子は、親の `/proc/<ppid>/environ` から仮のトークンを読めた。
- 親と兄弟の `/proc/<pid>/mem` は開けなかった (`EACCES`)。兄弟の入力の管 (`fd/0`) は socket で、`/proc` から開き直せなかった (`ENXIO`)。

### 5.3 確かめた環境

| 項目 | 値 |
|---|---|
| カーネル (`uname -r`) | `6.8.0-149-generic` |
| `/proc/sys/kernel/yama/ptrace_scope` | `1` |
| uid | 1000 (`vscode`)。親と子は同じ uid |
| 有効な capabilities (`CapEff`) | `0000000000000000` |
| `NoNewPrivs` | `0` |
| seccomp | `Seccomp: 2` (filter が 1 つ) |
| Node | v24.22.2 |
| `core_pattern` | `|/usr/share/apport/apport …` |

**本物の image と GROWI.cloud とは違う点**: これは開発用の dev container で、Docker は入っていないので、抽出サービスの image の中では試していない。image では uid が 10001、親が PID 1、root のファイルシステムが読み取り専用、`no-new-privileges` が付く。**GROWI.cloud の k8s のノードでは試していない** (そのノードのカーネルと `ptrace_scope` の値も分からない)。

### 5.4 ここから言えること (文書に書く強さ)

- 言えること: 抽出サービスと同じ形で起動した子は、同じ uid の親の環境変数を `/proc` から読める。少なくとも Yama の `ptrace_scope` が 1 の Linux 6.8 では読めた。作業者の理解では、`/proc/<pid>/environ` を読む許可は「同じ uid で、相手が dump できるプロセスである」ことで決まり、Yama の制限 (ptrace で取り付くことへの制限) の対象ではない。この理解はカーネルの資料での知識で、この実験では確かめていない (確かめたのは `ptrace_scope` が 1 の 1 つの環境だけ)。そのため、ほかのノードでも読める見込みが高いと考えるが、試してはいない。
- 言えないこと: GROWI.cloud のノードで読めること。親のメモリ (処理中のほかの要求のファイルを含む) が読めないこと。`ptrace_scope` が 0 のノードでは、同じ uid のプロセスのメモリを読める可能性があるが、試していない。
- `docker/README.md` には、「子は親と同じ uid で動き、トークンは子に渡さないが、乗っ取られた子は親の環境変数をトークンを含めて `/proc` から読める (Linux 6.8、`ptrace_scope` 1 の環境で確かめた。GROWI.cloud のノードと image の中では試していない)。親のメモリが読めるかはノードの ptrace の設定による (試していない)。対策は決めていない」の範囲で書く。
- 対策 (`MAX_CONCURRENCY=1`、顧客ごとのサービス、OS による隔離) は roadmap の (h) に残す。

### 5.5 一緒に直す記述

いまの記述のうち、「トークンは子に渡らない」だけを書いていて、読める事実に触れていない場所。

- `apps/attachment-text-extractor/AGENTS.md` の Invariants の「The token never reaches a child or a log.」 (同じ PR で直す)
- 対象 spec の design.md §Security Considerations の「トークンの受け渡し」(645 行)、§Testing Strategy の「トークンが子に渡らないこと (`/proc/<pid>/environ`)」(577 行。子自身の環境を確かめるテストで、正しいが、親から読めることとは別だと書き添える) (取り込みで直す)
- 対象 spec の design.md §ConversionRunner の子の `env` (337 行。「親の `process.env` からトークンを消す方法は採らない」の理由と並べて、読める事実を書く) (取り込みで直す)

## 6. 古い要件番号を引くコメント

- **数えた結果** (2026-11-19 の master): `apps/attachment-text-extractor/` の `src`・`scripts`・`test`・`benchmark` に、`Req N.M` の形が 108 か所 (68 ファイル)。ほかに `.github/workflows/ci-attachment-text-extractor.yml` の 122 行目のコメント (`# Req 3.14 and 11.2: …`)。
- **なぜ古いか**: これらは、削除した作業用の spec (`attachment-search-text-extractor-node-rewrite`) の要件の番号である。対象 spec の research.md §8.2 が読み替えの表を持っているが、表を引かないと読めず、いまの requirements.md の同じ番号は別の要件を指す (例: `request-log.ts` の「Req 1.7」はログの行のことだが、いまの AC 1.7 は外部バイナリの要件。`Req 3.8`、`Req 3.11`、`Req 8.8` はいまの requirements.md に無い)。
- **Decision**: 番号を引く部分を消す。コードから読み取れない理由を述べているコメントは、番号なしの文として残す。理由を述べていない (何をしているかを言い直しているだけの) コメントは、行ごと消す (`.claude/rules/coding-style.md` のコメントの規則)。コメントだけを変える 1 つの commit にして、レビューしやすくする。
- **検査のテストは足さない**: 足すなら、`test/layers/layer-dependencies.spec.ts` の `listSourceFiles` と同じファイルの一覧を作る処理を複製するか、共有の場所に移す必要がある (約 20 行)。lead の目安 (既存の形で 10 行程度なら足す) を超える。コメントの規則は `.claude/rules/coding-style.md` にすでにあり、番号が古くなる原因 (作業用の spec を消して番号を付け直したこと) はこの片づけで無くなる。
- **扱わないもの**: `research.md 15.4` のような節の番号 (約 174 か所)、`(16.3)` のような裸の番号 (約 12 か所)、`D1`〜`D5` (約 18 か所)。これらも作業用の spec の番号だが、対象 spec の research.md §8.1 の表で読める。範囲を広げると、この版の差分が大きくなる。
- **取り込みのときに直すもの**: 対象 spec の research.md §8 の前書きと §8.2 の表 (コメントが `Req N.M` を引かなくなるので、§8.2 は要らなくなる)。

## 7. 結果の大きさの数え方

- `assemblePages` は、改行を LF に揃えた `content` の UTF-8 のバイト数を足し、`MAX_RESULT_BYTES` を超えたら `result_too_large` を投げる。`label` は数えない。
- PPTX の `content` は、anydoc の出力の掃除 (`cleanSlideText`) の後で、まだ CR を含みうる。揃える前のバイト数で数えると、最後の確かめでは通る結果を途中で止めてしまう。
- **Decision**: 数え方を `result-budget.ts` の 1 か所に置き、PDF の繰り返し、PPTX の繰り返し、`assemblePages` が同じものを使う。改行の揃えは PDF の経路ではすでに済んでいるが、同じ関数を通しても結果は変わらない (揃える処理は 2 回かけても同じ)。
- 空の要素は 0 バイトなので、数えても数えなくても同じになる。
- 親の受け取りの上限 (`2 × MAX_RESULT_BYTES + 約 1MiB`) は変えない。

## 8. `/metrics` の数え方と、公開の手順

### 8.1 応答をどこで数えるか

- **Alternatives Considered**:
  1. Hono の middleware (`app.use('*', …)`) を `bearerAuth` より前に置き、`await next()` の後の `c.res.status` を数える
  2. Node の `server.on('request')` と `response.once('close')` (`start-server.ts` の `trackRequests` と同じ場所) で数える
- **Selected Approach**: 1。
- **理由**: HTTP の層の中で完結し、`app.request()` でテストできる。`trackRequests` は停止のための仕組みで、指標を混ぜると責務が 2 つになる。2 にしても、Node が自分で返す答え (400、408、417、431) は `'request'` の前に返されるので数えられず、違いは「読み手のいない答え」の扱いくらいである。
- **数えないもの** (design.md の表): Node の HTTP の層が自分で返す答え (壊れた要求と `Host` の無い要求の 400、431、`Expect` が `100-continue` 以外の 417、ヘッダーと要求の期限切れの 408)、答える前に閉じた接続、`100 Continue`。
- **401 と 404 はログの行を出さない** (対象 spec の research.md §5.7 の決定のまま)。数は `/metrics` で分かる。

### 8.2 版と公開

- `apps/attachment-text-extractor/package.json` は `"version": "1.0.0"`、`"private": true`。この package の changeset は、これまで 1 つも無い (`git log` で確かめた)。
- `.changeset/config.json` の `ignore` に `@growi/attachment-text-extractor` は無い。`private: true` の app が changesets で版を上げる前例は `apps/growi-vault-manager` (`CHANGELOG.md` があり、版は 1.1.7)。
- ルートの `package.json` の `version-subpackages` は `changeset version && pnpm update "@growi/*" -r && pnpm dedupe`、`release-subpackages` は `@growi/core` と `@growi/pluginkit` を build して `changeset publish` (private の package は npm に出さない)。`release-subpackages.yml` の `changesets/action` が「Release Subpackages」の PR を作り、それを master にマージすると `apps/attachment-text-extractor/package.json` の版が変わり、`release-attachment-text-extractor.yml` が image を公開する。
- 生成クライアントの package (`@growi/attachment-text-extractor-client`、1.0.0、`private: true`) は changeset を書かない。npm に出さず、apps/app は workspace の中で使うので、版を上げて伝える相手がいない。生成コードの変化は先頭のコメントの版の行だけである (§2.2)。
- メモリの計測 (`ci-attachment-text-extractor.yml` の `Measure memory in the image`) は `workflow_dispatch` のときだけ動く。計測の道具は、ログの `/extract` の行を `\bextract format=(\S+) .*\bresult=(\S+) child_peak_rss_mb=(\S+)` で読む (`scripts/image-check/memory/report.ts`)。`app=` を行の最後に足しても、この正規表現は読める (`child_peak_rss_mb=` の値の後ろの空白で `\S+` が止まる)。ただし、計測は手で起動しないと動かないので、公開の前に手で起動する。

## 9. 調べた前提のうち、違っていたもの

- 「生成クライアントの作り直しで、apps/app はヘッダーを生成クライアントの axios の `headers` で渡す」: そのとおりだが、生成クライアントそのものはヘッダーの parameter で変わらない (§2.2)。変わるのは `info.version` を上げたときの先頭のコメントだけ。
- 「`app:growiAppIdForCloud` は `number | undefined`」: 宣言の型はそうだが、実際の値は環境変数の文字列 (§2.3)。
- 「`inspectArchive` の `null` の 4 つの場合」: `openZip` の `null` には、ZIP の終わりの記録が見つからない場合と、見つかったのに yauzl が開けない場合の 2 つが含まれる。後者は「ZIP なのに読めない」側に入れた (§3.2)。
- 対象 spec の research.md §8 が、コメントの番号の読み替えの表を持っている。コメントを消すと §8.2 が要らなくなるので、取り込みで消す (§6)。
- `docker/README.md` には「security」という名前の節は無い。子の環境変数の記述は「Conditions the service is designed for」の中の「Non-root, read-only, no privileges.」の段落の後に、独立した段落として置く。

## Risks & Mitigations

- `prom-client` の依存とライセンスを、この spec を書いた時点では確かめていない — 入れるタスクで確かめ、許容的でなければ人に諮る (§1)
- ZIP を断る範囲を広げたことで、いままで anydoc が読めた変な形の PPTX / XLSX が `extraction_failed` になる — 実験では、上限を回避する形以外は anydoc も読めなかった。zip64 の既存のテストは残す (§3.2)
- `/readyz` の結果が最大 10 秒古い — 確認の間隔 (20 秒) より短く、kubelet の確認は普段は新しい結果を受け取る (§4)
- `/metrics` がトークンなしで開いている — 中身に利用者のデータは無い。内向きの通信の制限で守る (design.md §Security Considerations)
- 子が親の環境変数を読める事実を文書に書くことで、攻撃の手がかりを示す — 事実はコードと Linux の仕組みから分かることで、運用者が判断するために要る。対策は (h) で決める

## References

- `.claude/rules/spec-lifecycle.md` — amend spec の扱い
- `.claude/rules/coding-style.md` — コメントの規則
- `.kiro/specs/attachment-search/roadmap.md` — (f)、(h)
- `.kiro/specs/attachment-search-text-extractor/research.md` §5.4 (以前の動きとの違いの記録の形)、§5.6 (生成クライアントの名前)、§5.7 (ログ)、§8 (コメントの番号の対応表)
- Prometheus のテキスト形式 (exposition format) — `prom-client` の `registry.contentType` が返す `text/plain; version=0.0.4` の形
