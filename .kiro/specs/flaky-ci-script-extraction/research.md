# Research & Design Decisions

## Summary
- **Feature**: `flaky-ci-script-extraction`（`ci-flaky-test-detection` の amend spec）
- **Discovery Scope**: Extension（既存の手順書 3 本と測定 workflow から、判断を通らない処理を切り出す）
- **Key Findings**:
  - 3 本の手順書は文章整理後で 4,312 行 / 227 KiB。実行シェル行は 12.5%。スクリプト化で減る散文は監査の見立てで正味約 18 KiB だが、価値の中心は容量ではなく **環境差による事故の根絶と単体検証**にある
  - Bash ツール内と bash スクリプト内では **別のプログラムが動く**（`grep` はツール内が ugrep 7.8、スクリプト内は GNU grep 3.12。`date`/`head`/`sort`/`cut` は uutils coreutils 0.8、`awk` は mawk、シェルは zsh 5.9）。手順書の注意書きの多くはこの差が原因。シェルで書く限り差は消えず、TypeScript に寄せれば消える
  - `.claude/` 配下に置くと **vitest・turbo・biome・CI のどれからも見えない**（`vitest.workspace.mts` は `apps/*`・`bin`・`packages/*` のみ、`biome.json` は `!.claude`、workflow の path filter に `.claude` は無い）。一方 `bin/` は `@growi/bin` として全部配線済み
  - Node は v24.20.0、`node file.ts` がそのまま動く（型除去。`enum`・パラメータプロパティ・namespace は実行時 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。cloud 側の Node 版は間接証拠のみ（`engines: ^24`、全 workflow が 24.x）— Requirement 3.5 のとおり実装の最初に実測する
  - cloud routine のログ取得は MCP ツール呼び出しで、結果は本文としてモデルに返る。ジョブログは MB 単位（実物 1.4 MB）なので、手順書は「結果をファイルに書いてスクリプトに流し込む」と書く以外に無い。取得経路の分岐（1 回だけ判定して固定）は Markdown に残る

## Research Log

### 前例: `.claude/skills/*/scripts/` の `.ts`
- **Context**: 監査が提案した置き場が前例に沿うか
- **Sources Consulted**: `.claude/skills/suggest-path-evaluator/scripts/{aggregate,reconcile-digests}.ts`、同 `package.json`、`.kiro/steering/tech.md:9,14`
- **Findings**: `#!/usr/bin/env node` の `.ts` を `node` で直接実行。`package.json` は `{"type":"module"}` のみで workspace 非参加。テスト無し。SKILL.md はパスを名指しするだけで呼び出し行は書いていない。root `package.json` も `"type":"module"` なので、`.claude/` 直下の `.ts` は追加設定なしで動く（実測）
- **Implications**: 実行手段は確立済み。ただし**テストと lint が無い前例**なので、Requirement 4 を満たすには置き場を変えるか配線を足す必要がある

### テストを `turbo run test` に乗せる最小構成
- **Context**: Requirement 4.2（通常のテスト実行で検証される）
- **Sources Consulted**: `pnpm-workspace.yaml`、`vitest.workspace.mts`、`turbo.json:82-84`、`bin/package.json`、`bin/vitest.config.ts`、`.github/workflows/ci-bin.yml`、`biome.json`、`.claude/settings.json`（PostToolUse hook）
- **Findings**:
  | 案 | turbo で走る | 追加配線 | lint/CI |
  |---|---|---|---|
  | A `.claude/` に package を 1 つ | 走る | workspace 名指し・vitest.workspace・package.json・vitest.config・`pnpm install` | biome は `!.claude` で見ない、CI の path filter に無い → 両方足す必要 |
  | B skill ごとに package | 走る | A×3 | 同上 |
  | C root に vitest config | **走らない**（root に test script も `//#test` も無い） | — | — |
  | D `bin/`（`@growi/bin`） | **走る** | **無し** | `biome check bin`、`ci-bin.yml`（`paths: bin/**`）が既に有る |
  `apps/app/.claude/skills/esm-merge-coverage/tool-manifest.spec.ts` は `app-unit` の `include: ['**/*.spec.{ts,js}']` に偶然拾われているだけで、root の `.claude/` には効かない
- **Implications**: D を採る。監査が「契約をスクリプトの近くに」の観点で D を退けたが、Requirement 4.4 は「スクリプトの近くに文書化し手順書はそれを参照する」であり、スキルディレクトリとの同居は求めていない

### シェルと道具の実態（devcontainer）
- **Context**: Requirement 3.1（両環境で同じ結果）
- **Sources Consulted**: Bash ツール内で `$0`, `type grep`, `date --version` 等を実測
- **Findings**: Bash ツールは **zsh 5.9**。`grep` はシェル関数で **ugrep 7.8.4** に転送（bash スクリプト内では GNU grep 3.12）。`date`/`head`/`sort`/`cut`/`tr`/`wc` は **uutils coreutils 0.8.0**（`date -d ""` が今日 0 時 UTC を返して終了コード 0 — 手順書の注意書き「今から 120 秒前が返る」とは症状が違い、別の `date` 実装を前提に書かれていた）。`awk` は mawk 1.3.4。`sed` は GNU 4.9。`jq` 1.8.1、`gh` 2.100.0（cloud は 2.45.0 の記録あり）。`bash -n` は使えるが `shellcheck`/`bats` は無い
- **Implications**: シェルスクリプトにしても「手順書の `grep` とスクリプトの `grep` が別物」という新しい差が生まれる。日時計算・文字列処理・ページングを JS に寄せれば、`date`/`awk`/`grep`/`sort` への依存が消え、両環境の差は Node の版だけになる

### ログ取得の二分岐
- **Context**: Requirement 3.2（ログ本文を入力に取り、取得手段に依存しない）
- **Sources Consulted**: `detect-flaky-ci/SKILL.md:555-563, 636, 663-664`、`flaky-ci-routine.md:211-219`、cloud 実行記録（2026-09-14 16:10Z、`mcp__github__get_job_logs` の結果が巨大でファイルに退避された事例）
- **Findings**: 手順書は MCP 結果を「返ってきた本文を同じように grep せよ」と書き、ファイルに書く指示は無い。ジョブログは 1.4 MB 級。取得経路は環境の性質として 1 回だけ決める
- **Implications**: 手順書に「ツール結果を Write でファイルに保存 → `node … < file`」の 1 段を足す。detect の `allowed-tools` に `Write` と `mcp__github__get_job_logs` が無い食い違いも同時に直す

### 14 候補の現在位置と「事実／判断」の境目
- **Context**: Requirement 2（判断は手順書に残す）
- **Sources Consulted**: 3 本の手順書の現行行番号（監査の行番号は文章整理で全部ずれている）
- **Findings**: 境界が clean: #1 #2 #3 #5 #6 #7 #11 #12（条件 1・2）#13。曖昧で線を引き直すもの: **#4**（監査の「判断無し」は誤り — 「件数が増えても再選択しない」「最終行を読む」「窓内の行に警告を付けない」が節に埋まっている）、**#8**（解析は機械的、戻り値の 3 分類後の扱いは判断）、**#9/#10**（実装が 3 か所に散り ANSI 除去の正規表現が 2 種類ある）、**#14**（決まり文句 3 つ・65536 字の規則・「節を落とすな」は規則、描画だけが機械）。#2 の `- Per-run:` は現在どこからも読まれていない。#12 の `ci_not_success` は「1 件も無い」を検出できないので `ci_total` も返す必要がある
- **Implications**: スクリプトの出力は「事実」に限定し、上の判断文は手順書に残す。#9 と #10 は 1 つのパーサに統合する

### 手順書内の食い違い（設計で決める）
- ANSI 除去の正規表現が 2 種類（`[0-9;]*m` と `[0-9;]*[A-Za-z]`）→ 後者を正とする（色以外の制御列も落とす）
- 一時ファイルの置き場が `/tmp/` 直書きと `${TMPDIR:-/tmp}` の 2 種類 → スクリプトは一時ファイルを使わない（stdin/stdout）ので消える
- 同着の並び順が未規定（`sort_by(.started_at) | last`、同一 commit の `### Repro result` が 2 件のとき `last`）→ `started_at`→`id` の順で決定的に解く。コメントは `created_at`→`id`

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| シェルスクリプト群 | 手順書のシェル片をそのまま `.sh` に | 移植が直接的 | 環境差（ugrep/uutils/mawk/zsh）が残り、`bash -n` 以外の検証手段が無い | 却下 |
| TypeScript スクリプト群（`node file.ts`） | 事実を返す CLI を `.ts` で書き、`gh api` は子プロセスで呼ぶ | 環境差が Node 版だけになる、vitest でテストできる、前例あり | Node 24 が cloud に無い可能性（実測待ち） | **採用** |
| 単一の大きな CLI（サブコマンド） | 1 本の `flaky-ci.ts` に全機能 | 呼び出しが統一 | 手順書からの参照が「サブコマンド名」に増え、境界が見えにくい | 却下（スクリプト 1 本 = 1 事実群の方が手順書と 1:1 に対応） |

## Design Decisions

### Decision: 置き場は `bin/flaky-ci/`（既存 package `@growi/bin`）
- **Context**: テスト・lint・CI を追加配線なしで効かせる
- **Alternatives Considered**: `.claude/skills/<skill>/scripts/`（監査案）／`.claude/` 直下の新 package／root vitest
- **Selected Approach**: `bin/flaky-ci/{scripts,lib,fixtures}/` を `@growi/bin` の一部として置く。手順書は `node bin/flaky-ci/scripts/<name>.ts` で呼ぶ（リポジトリ root が cwd）
- **Rationale**: `vitest.workspace.mts`・`ci-bin.yml`・`biome check bin` が既に効く。`.claude/` は 3 系統すべてから除外されている
- **Trade-offs**: スキルディレクトリとスクリプトが離れる。契約は `bin/flaky-ci/README.md` と各スクリプト先頭の説明で補い、手順書はそこを指す
- **Follow-up**: `bin/package.json` の `test` script と `ci-bin.yml` の実行内容を実装時に確認

### Decision: 実装言語は TypeScript のみ、`node` 直接実行
- **Context**: 両環境で同じ結果（3.1）と単体テスト（4.1）
- **Alternatives Considered**: bash / bash+jq / TypeScript
- **Selected Approach**: `#!/usr/bin/env node` の `.ts`。`erasableSyntaxOnly` 相当の制約を守る（`enum`・パラメータプロパティ・namespace 禁止）。外部依存なし（Node 標準ライブラリのみ）
- **Rationale**: 日時・文字列・JSON をすべて JS で処理すれば `date`/`awk`/`grep`/`sort`/`jq` への依存が消える。前例と steering（tech.md）に一致
- **Trade-offs**: cloud の Node 版が 24 未満なら動かない → 実装の最初に `node --version` を cloud で実測（3.5）。24 未満なら `--experimental-strip-types` 付きの呼び出しに切り替える設計余地を残す
- **Follow-up**: 型除去で落ちる構文を lint で捕まえる（`biome check bin` は構文を見ない — 各スクリプトの spec が `node script.ts --help` を実行して起動を検証する）

### Decision: スクリプトは事実だけを返し、書き込まない。失敗は終了コード 2
- **Context**: Requirement 2.1・2.2・3.3
- **Selected Approach**: stdout に JSON 1 個（`{ "ok": true, ...facts }`）、終了コード 0。前提を満たせないときは stdout 空・stderr に理由・終了コード 2。終了コード 1 は想定外の例外
- **Rationale**: 手順書側は「0 なら事実を読む、2 なら『測定・取得できなかった』の既存経路へ」の 2 分岐で済む。空配列や 0 件が「成功」に見える事故（監査 D7・4-E の空値）を構造的に防ぐ
- **Trade-offs**: 「0 件で正常」と「取れなかった」を区別する責任がスクリプトに移る。各スクリプトの契約で `ok:true` かつ空配列の意味を明記する

### Decision: GitHub 読み取りは `gh api -X GET` を子プロセスで呼ぶアダプタ 1 つに集約
- **Context**: REST 専用・GraphQL 遮断・`--paginate -q` の落とし穴・`gh` 版差
- **Alternatives Considered**: Node の `fetch` で api.github.com を直接叩く（トークンの取り回しと egress proxy の扱いが `gh` と別になる）／`gh api --paginate`
- **Selected Approach**: `lib/gh.ts` の `GhApi` インターフェース（`get(path, params) → JSON`、`getAll(path, params) → JSON[]` はページ番号を自分で回す）。実装は `execFile('gh', ['api','-X','GET',…])`。テストでは記録済み応答を返す偽物を注入
- **Rationale**: 認証と proxy は `gh` に任せたまま、ページ結合を JS で行う。`--paginate -q` がページごとに効く問題と `--slurp` 非互換が消える
- **Trade-offs**: `gh` 起動のオーバーヘッド（数十 ms/回）。許容範囲

### Decision: ログ解析は stdin 1 本のパーサ `parse-job-log.ts`（vitest と Playwright を同時に扱う）
- **Context**: 3.2、監査 #9/#10、実装が 3 か所に散っていた
- **Selected Approach**: 生ログ（タイムスタンプ前置き・ANSI 混じり）を stdin で受け、ANSI を 1 つの正規表現で除去し、`{ vitest: { failBlocks[] }, playwright: { annotations[], summary: { failed, flaky, passed, skipped } | null }, denylistHits[] }` を返す。段位（tier）の決定や denylist の拡張は行わない
- **Rationale**: 事実の取り出しと判断を 1 か所で切り離す。`summary: null` を「集計行が取れなかった＝不明」として明示的に返し、0 と区別する（監査 I5）
- **Trade-offs**: denylist の**一覧**はデータとしてスクリプト側（`lib/denylist.ts`）に置く。一覧を広げる判断は手順書に残る

### Decision: 固定文字列は `lib/constants.ts` を機械可読な定義とし、手順書の Shared constants との一致をテストで検証
- **Context**: `### Repro result`・`### Additional observation`・`**Fix PR**: `・ラベル名などを手順書とスクリプトの両方が使う
- **Selected Approach**: `constants.ts` に定義。`constants.spec.ts` が `.claude/commands/flaky-ci-routine.md` の Shared constants 節を読み、コードブロック内の文字列が定義と一致することを検証する（ドリフト検知）
- **Rationale**: 「定義は 1 か所」を機械と人の両方に対して保ちつつ、二重定義のずれをテストで捕まえる
- **Trade-offs**: 手順書の節構造に spec が依存する。節見出しが変われば spec も直す（Revalidation Trigger に記載）

### Decision: 導入は 1 本ずつ、手順書の置き換えと同じコミットで
- **Context**: Requirement 5
- **Selected Approach**: スクリプト＋spec＋手順書の該当節の置き換えを 1 タスク＝1 コミットにする。上位 4 本 → 残り → 任意の workflow 分割
- **Rationale**: 旧手順と新手順が同時に存在する中間状態を作らない

### Decision: `flaky-repro.yml` の分割は任意タスクとし、bash のまま `.github/scripts/flaky-repro/` へ移す
- **Context**: Requirement 6（Where 条件）。routine のトークンには効かない
- **Selected Approach**: `run:` の中身を `parse-request.sh` / `run-repro.sh` / `render-result.sh` に**そのまま**移し、workflow は `bash .github/scripts/flaky-repro/<name>.sh` を呼ぶ。workflow 自身の最初のステップで `bash -n` を掛ける
- **Rationale**: Actions runner は GNU bash であり環境差の問題が無い。TypeScript に書き直すと振る舞い同一性の検証が重くなる
- **Trade-offs**: 分割しても測定中の依頼が push 済みブランチ上のファイルに依存する前提は変わらない

## Risks & Mitigations
- cloud の Node が 24 未満 — 実装の最初に cloud routine の run now で `node --version` を実測（3.5）。24 未満なら `node --experimental-strip-types`（22.x）を呼び出し行に足す
- `bin/flaky-ci/` の spec が偶然 `apps/app` の vitest に拾われる/二重に走る — `vitest.workspace.mts` の `bin` 設定の `include` を確認する
- スクリプトの JSON 契約が変わったのに手順書が古いまま — 各スクリプトの spec に「手順書が参照する欄名」の存在チェックを入れ、README の契約表を唯一の一覧にする
- MCP 結果をファイルに落とす手順が cloud で使えない（Write ツールが無い等）— detect の `allowed-tools` に `Write` を明記し、6.3 と同じ要領で run now 検証する
- スクリプト化で「モデルがその場で環境差を回避する粘り」が失われる — 判断を通らない処理に限定し、失敗は終了コード 2 で手順書の既存経路へ返す（黙って続行しない）

## References
- `.kiro/steering/tech.md` — Module System（Node 24 型除去、`tsx` 不採用の理由）
- `.kiro/specs/ci-flaky-test-detection/research.md` §5 — 検出のスクリプト化に関する当初の論点と、判断が必要な 3 点
- `bin/package.json`, `bin/vitest.config.ts`, `.github/workflows/ci-bin.yml` — 採用する既存配線
- `.kiro/specs/flaky-ci-script-extraction/brief.md` — 肥大化監査（14 候補の表）
