# Implementation Plan

> 本 spec は **baseline-only** spec で、コード変更は最小限。**Foundation** で barrel files を導入し、**Core** で sibling imports を barrel 経由に書き換え + `exports` field 追加 + stable contract surface test 追加、**Integration** で README に stable contract / change-review プロセスを明記、**Validation** で lint / test の green を確認、最後に downstream consumer (`memory-leak-investigation`) 側の参照 cleanup を取り込む。
>
> Critical issue 3 件への対応:
> - **Issue 1 (exports field)**: Task 3.1
> - **Issue 2 (Module Public Surface 規約整合)**: Task 1.1 / 1.2 / 1.3 + Task 2.1
> - **Issue 3 (stable contract surface test)**: Task 4.1

## 1. Foundation: Barrel files の作成

> 各サブタスクは独立した新規ファイル作成。3 つの barrel は互いに参照しないため並列実行可能。

- [x] 1.1 (P) Top-level barrel の作成
  - `bin/memory-profiling/index.ts` を新規作成。
  - design.md の Barrel Exposure Rules に従い、stable contract に該当する 5 symbol のみ named export: `runScenario`、`ScenarioRunnerOptions`、`LoadOpCounts`、`ScenarioRunnerError`、`LoadDriver`（型）。
  - **含めない** symbol: `createCdpSnapshotClient` / `createLoadDriver` / `createRssTimeSeriesLogger` / `CdpSnapshotClient` interface / `RssTimeSeriesLogger` interface / scenarios の `run*` 関数 / scenarios の `LOAD_*` 定数 / lib/* の factory（これらは internal）。
  - 観測可能な完了条件: `bin/memory-profiling/index.ts` が存在し、`import { runScenario, ScenarioRunnerOptions, LoadOpCounts, ScenarioRunnerError, LoadDriver } from './memory-profiling'` が型エラーなく動く。`createLoadDriver` 等の internal symbol は当該 import で得られない。
  - _Requirements: 6.4, 9.1, 9.2, 9.3_
  - _Boundary: bin/memory-profiling/index.ts_

- [x] 1.2 (P) scenarios sub-barrel の作成
  - `bin/memory-profiling/scenarios/index.ts` を新規作成。
  - `runBaseline`、`runLoad`、`runDrain` 関数と 7 個の `LOAD_*` 定数（`LOAD_PAGE_CREATE` 等）を named export。
  - 観測可能な完了条件: `bin/memory-profiling/scenarios/index.ts` が存在し、`run-scenario.ts` から `import { runBaseline, runLoad, runDrain, LOAD_PAGE_CREATE, ... } from './scenarios'` が型エラーなく動く。
  - _Requirements: 1.4, 8.4_
  - _Boundary: bin/memory-profiling/scenarios/index.ts_

- [x] 1.3 (P) lib sub-barrel の作成
  - `bin/memory-profiling/lib/index.ts` を新規作成。
  - `createHttpClient`、`createInstallerDriver`、`createYjsSession` factory を named export。
  - 観測可能な完了条件: `bin/memory-profiling/lib/index.ts` が存在し、`load-driver.ts` から `import { createHttpClient, createInstallerDriver, createYjsSession } from './lib'` が型エラーなく動く。
  - _Requirements: 3.2, 3.4, 8.4_
  - _Boundary: bin/memory-profiling/lib/index.ts_

## 2. Core: Sibling 間 import の barrel 経由への書き換え

- [x] 2.1 既存 sibling import を barrel path に変更
  - `run-scenario.ts` の `./scenarios/baseline` / `./scenarios/load` / `./scenarios/drain` の import を、`./scenarios` 経由（barrel 経由）に書き換える。
  - `load-driver.ts` の `./lib/installer-driver` / `./lib/http-client` / `./lib/yjs-client` の import を、`./lib` 経由（barrel 経由）に書き換える。
  - test ファイル（`scenarios.spec.ts` 等）の sibling import は今回は対象外（既存テストは internal を直接触っているケースがあり、それは internal test の自然な書き方として許容する）。
  - 観測可能な完了条件: `run-scenario.ts` と `load-driver.ts` の source 内で `./scenarios/baseline` / `./scenarios/load` / `./scenarios/drain` / `./lib/installer-driver` / `./lib/http-client` / `./lib/yjs-client` の文字列が grep で出現しない（barrel path への置換完了）。`pnpm --filter @growi/bin test` が green。
  - _Requirements: 8.1, 8.4, 9.2_
  - _Boundary: bin/memory-profiling/run-scenario.ts, bin/memory-profiling/load-driver.ts_
  - _Depends: 1.2, 1.3_

## 3. Core: Package boundary enforcement (`exports` field)

- [x] 3.1 `bin/package.json` への `exports` field 追加
  - `bin/package.json` の top-level に `"exports": { "./memory-profiling": "./memory-profiling/index.ts" }` を追加する。
  - 既存の `name`、`private`、`scripts`、`dependencies`、`devDependencies` は変更しない。
  - 追加後 `pnpm install` を再実行し、lockfile に差分が出ないことを確認する（dependency は変えていないため）。
  - 観測可能な完了条件: `bin/package.json` に `exports` field が追加されており、`@growi/bin/memory-profiling` という package-name 経由の import path が解決可能になっている。`pnpm install` 後 `pnpm-lock.yaml` に差分が発生しない。
  - _Requirements: 6.4, 7.1, 7.2, 7.4, 9.1, 9.3_
  - _Boundary: bin/package.json_
  - _Depends: 1.1_

## 4. Core: Stable contract surface test の追加

- [x] 4.1 `stable-contract.spec.ts` の新規作成
  - `bin/memory-profiling/stable-contract.spec.ts` を新規作成し、以下の 5 種類の assertion を含める:
  - **(a) Env var 名の存在検証**: `bin/memory-profiling/scenarios/load.ts` と `bin/memory-profiling/run-scenario.ts` の source を `fs.readFileSync` で読み込み、`LOAD_PAGE_CREATE` / `LOAD_PAGE_EDIT` / `LOAD_PAGE_GET` / `LOAD_PAGE_LIST` / `LOAD_PAGE_SEARCH` / `LOAD_YJS_CLEAN_CLOSE` / `LOAD_YJS_ABORT` / `BASELINE_IDLE_SECONDS` / `DRAIN_IDLE_SECONDS` の 9 個の文字列がそのまま含まれることを assertion。
  - **(b) Exit code 値の検証**: `ScenarioRunnerError` を `new ScenarioRunnerError('msg', 1)` / `new ScenarioRunnerError('msg', 2)` で構築でき、`err.exitCode === 1` / `err.exitCode === 2` であることを runtime assertion。TypeScript 上で `exitCode` の型が `1 | 2` であることを型 assertion（型関数 `Expect<Equal<T, 1 | 2>>` パターン）で検証。
  - **(c) Snapshot ファイル命名規約の検証**: fake CdpClient（`takeSnapshot` の呼び出しパスを記録するもの）を作り、`runScenario` を 1 周回した時、`takeSnapshot()` が `*/snapshot-a.heapsnapshot`、`*/snapshot-b.heapsnapshot`、`*/snapshot-c.heapsnapshot` で終わる 3 つの path で呼ばれることを assertion。
  - **(d) CSV header 文字列の検証**: `RssTimeSeriesLogger.start(path)` 後の最初の write 内容（または finalize 後のファイル先頭）が `timestamp,phase,rss,heap_used,heap_total,external\n` で始まることを assertion。
  - **(e) Top-level barrel re-export の検証**: `import * as Public from './index'` で得られる object が `runScenario`、`ScenarioRunnerOptions`（型なので runtime check は省略可、`'ScenarioRunnerOptions' in Public` 等は不可なので tsd / type assertion で確認）、`LoadOpCounts`、`ScenarioRunnerError`、`LoadDriver` の 5 symbol を含み、`createLoadDriver` / `createCdpSnapshotClient` / `createRssTimeSeriesLogger` / `runBaseline` / `runLoad` / `runDrain` / `LOAD_PAGE_CREATE` を **含まない** ことを runtime + 型 assertion で検証。
  - 観測可能な完了条件: `pnpm --filter @growi/bin test stable-contract` が green、上記 5 種類の assertion がすべて通る。assertion のどれか 1 つでも壊すと（例: `LOAD_PAGE_CREATE` を別名に変える、`exitCode` 型を `number` に拡げる、snapshot 名を変える）test が fail することを実装中に手動で確認する。
  - _Requirements: 1.4, 5.3, 6.2, 6.3, 6.4, 8.1, 8.2, 9.2, 9.3_
  - _Boundary: bin/memory-profiling/stable-contract.spec.ts_
  - _Depends: 1.1_

## 5. Integration: README への stable contract と change-review プロセス記載

- [x] 5.1 `bin/memory-profiling/README.md` の更新
  - **Stable Contract セクション** を README に追加し、以下を表で明示:
    - CLI 引数 3 個（`--baseUrl` / `--inspector` / `--outputDir`）
    - 9 個の env var 名と default 値
    - Exit code 3 値（`0` = 成功、`1` = snapshot 取得失敗、`2` = CDP 接続失敗）
    - 出力ファイル命名規約（`snapshot-a.heapsnapshot` / `snapshot-b.heapsnapshot` / `snapshot-c.heapsnapshot` / `rss-timeseries.csv`）と CSV header schema
    - Top-level barrel から re-export される 5 stable symbol（`runScenario` / `ScenarioRunnerOptions` / `LoadOpCounts` / `ScenarioRunnerError` / `LoadDriver` 型）
    - Package import path: `@growi/bin/memory-profiling`（深い path は `exports` field で block 済）
  - **Change Review Process セクション** を README に追加し、以下を明記:
    - 上記 stable contract の変更（rename / 削除 / 型変更 / exit code 体系変更）は **breaking change** として扱う
    - Breaking change を入れる際は、本 spec（`memory-profiler`）の更新と、downstream consumer（`memory-leak-investigation` 等）への影響評価を伴う change review が必須
    - Stable contract に該当しない internal symbol（factory 関数等）の変更は通常の PR レビューで足りる
  - **Output Storage Policy セクション** を更新（または追加）し、`*.heapsnapshot` をリポジトリにコミットしない方針、`.gitignore` のルール、外部共有しない運用を明記。
  - 観測可能な完了条件: README に上記 3 セクションが追加され、Stable Contract 表の内容が `bin/memory-profiling/index.ts` の re-export 一覧と完全一致する（symbol 名・順序）。
  - _Requirements: 5.2, 6.4, 6.5, 9.3, 9.4_
  - _Boundary: bin/memory-profiling/README.md_
  - _Depends: 1.1_

## 6. Validation: lint / test green の最終確認

- [ ] 6.1 `@growi/bin` 全 test と lint の green 確認
  - `pnpm --filter @growi/bin test` を実行し、既存の 5 ファイル（cdp-snapshot-client.spec / load-driver.spec / rss-time-series-logger.spec / run-scenario.spec / scenarios/scenarios.spec）+ 新規 1 ファイル（stable-contract.spec）すべてが green であることを確認。
  - workspace 全体の lint（`turbo run lint`）にて `@growi/bin` 配下のファイルが biome の対象になっており、errors / warnings がゼロであることを確認。
  - `pnpm install` 後の `pnpm-lock.yaml` に diff がないこと（dependency は本 spec で変えていない）。
  - Deep path import が block されることの確認: 試しに別ファイルから `import { createLoadDriver } from '@growi/bin/memory-profiling/load-driver'` を書いた時、TypeScript で型エラーになる（`exports` field によって解決不能）。確認後はそのテスト import は削除する（永続化しない smoke 確認）。
  - 観測可能な完了条件: `pnpm --filter @growi/bin test` が exit code 0、`turbo run lint` が exit code 0、`git status` で `pnpm-lock.yaml` に変更がない、`exports` field による deep path block が手動 smoke で確認できる。
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.4, 7.3, 8.1, 8.2, 8.3_

## 7. Integration: `memory-leak-investigation` 側の参照 cleanup の取り込み

> 直前のセッションで `memory-leak-investigation/` の 6 ファイルに対する「memory-profiler 参照化」の cleanup を `stash@{0}` に保留している（メッセージ: "WIP: memory-leak-investigation cleanup (defer until memory-profiler spec is fully generated)"）。memory-profiler が本 spec の Task 1-6 で確立した時点で、stash を pop してダウンストリーム側の参照を整える。

- [ ] 7.1 `stash@{0}` を pop して mem-leak-inv 側 cleanup を reconcile
  - `git stash list` で stash@{0} のメッセージが上記の WIP cleanup であることを確認。
  - `git stash pop stash@{0}` で `.kiro/specs/memory-leak-investigation/` 配下 6 ファイル（brief / design / requirements / research / spec.json / tasks）の変更を作業ツリーに戻す。
  - 取り込んだ変更を以下の観点で確認・必要に応じて調整:
    - mem-leak-inv が参照する path（`bin/memory-profiling/...` 等）が現状の実装と一致しているか
    - memory-profiler spec 名（`memory-profiler`）と stable contract 名（CLI 引数名 / 9 env var / 5 barrel symbol）への参照が、本 spec の最終形と一致しているか
    - mem-leak-inv の Phase 6 タスク（OTel 有効化下計測 / Yjs sustained-load / L4 retainer / dist server）の起動コマンドが、`bin/memory-profiling/README.md` の Stable Contract セクションと整合しているか
  - 不整合があれば **mem-leak-inv 側の文書のみ** を調整する（memory-profiler 側は変更しない — downstream 片方向参照の原則）。
  - Conflict が発生した場合は手動で resolve し、stash は最後に確実に消去する。
  - 観測可能な完了条件: `git stash list` から stash@{0} が消え、mem-leak-inv の 6 ファイルが memory-profiler の名前・path・stable symbol を正しく参照している（grep で `apps/app/tools/memory-profiling`、`SIGUSR2`、`HeapSnapshotSignalHandler` 等の旧表現が mem-leak-inv 内に残っていない）。`pnpm --filter @growi/bin test` が依然 green。
  - _Requirements: 9.1, 9.2_
  - _Boundary: .kiro/specs/memory-leak-investigation/_
  - _Depends: 5.1, 6.1_
