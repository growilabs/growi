# Research & Design Decisions

## Summary

- **Feature**: `otel-direct-import`
- **Discovery Scope**: Extension（既存 `apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts` の `buildInstrumentations` 関数を refactor）
- **Key Findings**:
  - `getNodeAutoInstrumentations({pkg: { enabled: false }})` は disable 指定された instrumentation も含め全 31 個を instantiate する仕様（auto-instrumentations-node@0.75.0 で確認、isolated benchmark で実証）。L2 fix の minimal profile は RSS 削減になっていない。
  - direct import 戦略（4 instrumentation を直接 `new HttpInstrumentation(...)` 等で構築）は isolated benchmark で sdk-only と同等の RSS（≈82 MB）を示し、auto-deny より約 11 MB 低い。
  - 4 instrumentation package（http/express/mongodb/mongoose）は既に `auto-instrumentations-node@0.75.0` の transitive dep として pnpm store に存在しており、direct dep への昇格と auto-instrumentations-node 除去で重複インストールは発生しない（pnpm が同一バージョンを共有）。
  - 既存 test (`node-sdk-configuration.spec.ts`) は `vi.mock('@opentelemetry/auto-instrumentations-node', ...)` で 1 個のモジュールをモックして deny-list config 構造を検査している。direct import 後は 4 instrumentation package を個別にモックして constructor 引数を検査する形に置き換える必要がある。

## Research Log

### Topic: auto-instrumentations-node の `enabled: false` 挙動

- **Context**: L2 fix が RSS 削減を達成できていない原因究明。
- **Sources Consulted**:
  - `apps/app/tmp/otel-import-bench/bench.js`（5 戦略比較 benchmark）と `results/` 配下の計測結果
  - `memory-leak-investigation/verification-report.md` L2 section
  - [auto-instrumentations-node@0.75.0 のソース](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node)
- **Findings**:
  - `getNodeAutoInstrumentations` は引数に関わらず全 instrumentation を import / instantiate し、結果配列の各要素の `enable` flag を後から切り替える実装。
  - その結果、`enabled: false` 指定された instrumentation のクラスもメモリに常駐し、RSS に約 11 MB のオーバーヘッドが乗る（GROWI が必要としない 27 個分の常駐コスト）。
- **Implications**: deny-list 経由では RSS 削減できないため、必要 instrumentation のみを直接 import する経路（direct import）に切り替える必要がある。

### Topic: 4 instrumentation package の direct import 方式

- **Context**: 代替戦略の妥当性確認。
- **Sources Consulted**:
  - bench.js の `direct-import` strategy 実装
  - [OpenTelemetry Node.js Instrumentation 公式 docs](https://opentelemetry.io/docs/languages/js/libraries/)
  - `node_modules/.pnpm/@opentelemetry+instrumentation-http@0.217.0/.../package.json` 等の export 検査
- **Findings**:
  - 各 instrumentation package は class export を持つ（`HttpInstrumentation`, `ExpressInstrumentation`, `MongoDBInstrumentation`, `MongooseInstrumentation`）。
  - constructor は instrumentation 個別の config object を任意で受け取り、`NodeSDK` の `instrumentations` 配列に直接渡せる。
  - HTTP instrumentation の config は GROWI 既存の `httpInstrumentationConfigForAnonymize`（`anonymization/anonymize-http-requests.ts` 由来）と同じ shape（`requestHook` / `responseHook` 等）で互換。
- **Implications**: 既存 anonymization config の合成契約は維持可能。Direct import への切り替えは破壊的変更なしで実装できる。

### Topic: 4 instrumentation package の version 整合

- **Context**: 新規 direct dependency 追加時のバージョン選択。
- **Sources Consulted**:
  - `pnpm-lock.yaml`（lockfile 内の versionsolver 結果）
  - `node_modules/.pnpm/` の installed package 列挙
- **Findings**:
  - 現在 `auto-instrumentations-node@0.75.0` 経由で以下のバージョンが既に解決されている:
    - `@opentelemetry/instrumentation-http@0.217.0`
    - `@opentelemetry/instrumentation-express@0.65.0`
    - `@opentelemetry/instrumentation-mongodb@0.70.0`
    - `@opentelemetry/instrumentation-mongoose@0.63.0`
  - 他 OTel 関連 dep（`@opentelemetry/api@1.9.0`, `sdk-node@0.217.0` 等）もこれらと整合。
- **Implications**: 新規追加する 4 package は上記のバージョンレンジ（`^` 付き）で `dependencies` に追加し、`pnpm-lock.yaml` 再生成で既存解決を維持する。

### Topic: `OTEL_AUTO_INSTRUMENTATION_PROFILE` の deprecation 方針

- **Context**: 既存 production 運用者を破壊しないための後方互換戦略。
- **Sources Consulted**:
  - `node-sdk-configuration.ts` の現実装（profile branching）
  - `node-sdk-configuration.spec.ts` の既存 test ケース
- **Findings**:
  - 既存運用者で `all` を明示設定しているケースの破壊回避が必要。
  - `minimal` は新 default と等価のため deprecation warn は不要（多くの「明示的に有効化していた」運用者が無警告で移行できる）。
  - 環境変数を全廃せず、warn ログだけで縮退 + 起動継続させることで、再起動失敗のリスクをゼロにできる。
- **Implications**: `all` だけは固有の deprecation warn を出し、unknown 値は別文言の warn を出す。両者とも minimal 同等で起動する。

### Topic: 既存 test mock の置き換え

- **Context**: `getNodeAutoInstrumentations` モックから 4 instrumentation モックへの置き換え。
- **Sources Consulted**:
  - `node-sdk-configuration.spec.ts`（既存テスト）
- **Findings**:
  - 既存 test は `vi.mock('@opentelemetry/auto-instrumentations-node', ...)` で config 引数を `__instrumentationConfig` field 経由でキャプチャ。
  - direct import 後は `vi.mock` で 4 package を個別にスタブし、各 constructor の引数（特に HTTP の anonymization config 合成）を `mock.calls[0]` 経由で検査する形に書き換える。
- **Implications**: test スイートは新規 mock pattern に置き換えるが、検証する観察対象（profile による分岐 / anonymization config 合成）は同等。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Deny-list via `getNodeAutoInstrumentations` | 現行実装。全 31 instrumentation を instantiate して `enabled: false` で disable | 設定追加が宣言的 | RSS 11 MB の浪費。L2 finding の根本原因 | Reject |
| Direct import of 4 instrumentations | 必要な 4 個を class import して直接 `new` | RSS が真に削減される。依存表面が actual usage と一致 | 新 instrumentation 追加時にコード変更が必要 | **Selected** |
| Registry pattern（map で instrumentation を動的に解決） | 設定で instrumentation セットを差し替え可能にする | 将来の拡張に強い | speculative abstraction。本 spec が要求しない | Reject（YAGNI） |

## Design Decisions

### Decision: Direct Import 方式の採用

- **Context**: L2 finding（RSS 削減未達）の根本 fix。
- **Alternatives Considered**:
  1. Deny-list 継続 — RSS 削減効果ゼロのため却下。
  2. Direct Import — 11 MB / process の削減効果が benchmark で実証済み。
  3. Dynamic registry — 拡張性メリットあるが、本 spec の scope（4 instrumentation 固定）には過剰。
- **Selected Approach**: 4 instrumentation を `new HttpInstrumentation(...)` 等で直接構築し、配列で返す。
- **Rationale**: benchmark で sdk-only と同等の RSS。OpenTelemetry 公式の推奨 pattern。実装最小限。
- **Trade-offs**: 将来 instrumentation を追加するときに `buildInstrumentations` のコード変更が必要だが、4 → 5 への変化は単純な追記で済むため、registry 化のコスト > 利得。
- **Follow-up**: 新 instrumentation 追加時は同じファイル内で direct import を追加する。

### Decision: `OTEL_AUTO_INSTRUMENTATION_PROFILE` の deprecation（削除ではなく warn + 縮退）

- **Context**: 既存 production 運用者の deployment 破壊回避。
- **Alternatives Considered**:
  1. 環境変数を即時削除 — 旧運用者が `all` 設定の状態で起動を続けると挙動が変わるが破壊はしない。ただし「変数が無視されている」ことが運用側に伝わらない。
  2. **Warn + 縮退（採用）** — `all` は固有 warn、unknown 値は別 warn、minimal / unset は無警告で 4 instrumentation 起動。
  3. 起動失敗にする — 過剰な破壊。却下。
- **Selected Approach**: 環境変数 reading を残し、`all` と unknown 値に対してそれぞれ warn を出して minimal 同等で起動継続。
- **Rationale**: 旧運用者の deployment を破壊せず、deprecation の事実がログから観察可能。CHANGESET と組み合わせて 1 マイナーバージョン後に削除可能な状態にしておく。
- **Trade-offs**: コードに deprecation branch が残る（数行）。次の major bump で削除可能。
- **Follow-up**: `@growi/app` は internal package（changeset 非対象）のため、運用者通知は起動時 warn ログのみで行う。完全削除は次マイナー以降の別 spec で扱う。

### Decision: 型注釈を `Instrumentation[]` に正規化

- **Context**: 現行コードの `ReturnType<typeof getNodeAutoInstrumentations>[]` の cast workaround は依存除去で破綻する。
- **Alternatives Considered**:
  1. **`Instrumentation[]`（採用）** — `import type { Instrumentation } from '@opentelemetry/instrumentation'` で type-only import。
  2. `unknown[]` のまま — type safety を失う。却下。
  3. ローカル型定義 — 上流型と乖離する。却下。
- **Selected Approach**: `@opentelemetry/instrumentation` から `Instrumentation` 型を `import type` で取り込み、戻り型を `Instrumentation[]` に統一。
- **Rationale**: `@opentelemetry/instrumentation` は 4 instrumentation package すべての transitive dep として既に存在（runtime dep 追加なし）。型は erased で deploy artifact に影響しない。
- **Trade-offs**: なし。
- **Follow-up**: 戻り型変更により caller（`generateNodeSDKConfiguration`）の型整合を確認。

## Risks & Mitigations

- **Risk**: pnpm 解決で新規 4 package が auto-instrumentations-node 経由のバージョンとずれる → npm の `^` レンジ重複 + lockfile 再生成で同一インスタンス共有を維持。
- **Risk**: 既存運用者の `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` 設定で挙動が「all → minimal 縮退」に変わることが事前認知されない → 起動時 warn ログでの通知に依拠（`@growi/app` は internal package のため changeset 不適用）。
- **Risk**: RSS 計測 noise（DB drift、ホスト負荷）で 5 MB 閾値が誤判定される → memory-profiler scenario runner の baseline mean（複数 sample の中央値ベース）で評価し、measurement window を 5 分 idle に固定。
- **Risk**: `.next/node_modules/` の Turbopack externalisation で 4 instrumentation が production artifact から欠落 → `dependencies` 追加と `check-next-symlinks.sh`（CI）での検出に依拠。

## References

- [memory-leak-investigation verification-report.md L2 section](../memory-leak-investigation/verification-report.md#l2-otel-auto-instrumentation-allow-list-task-22) — L2 fix が RSS 削減できなかった計測根拠
- [bench.js](../../apps/app/tmp/otel-import-bench/bench.js) — 5 戦略の isolated benchmark 実装
- [OpenTelemetry Node.js Libraries Registration](https://opentelemetry.io/docs/languages/js/libraries/) — direct import の公式 pattern
- [auto-instrumentations-node@0.75.0](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node) — `getNodeAutoInstrumentations` 実装
- [`.claude/rules/package-dependencies.md`](../../.claude/rules/package-dependencies.md) — `dependencies` vs `devDependencies` 分類ルール
