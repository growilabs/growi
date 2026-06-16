# Phase 5 Gate Evidence — pnpm.overrides 削除評価

Phase 5 (5.1–5.3) は `pnpm-workspace.yaml` の `@lykmapipo/common>{flat,mime,parse-json}`
CJS ピン override を 1 件ずつ削除し、`install → build → mongoose-gridfs file-upload smoke
→ pnpm audit diff` のプロトコルで評価する (design.md「Overrides Reducer」/ task 5.1)。

## 評価環境

- devcontainer (mongo `mongo:27017` rs0 / Node v24.15.0 / pnpm 11) — Phase 0.4/0.5 baseline と同一ホスト
- smoke harness: `apps/app/tmp/phase5-smoke/smoke.cjs` (gitignored)。本ファイルに全文と出力を転記

## smoke harness が検証する内容

`@growi/app → mongoose-gridfs → @lykmapipo/mongoose-common → @lykmapipo/env →
@lykmapipo/common (CJS) → require('flat'|'mime')` の実経路を再現する。

`@lykmapipo/common` は CommonJS で、flat/mime を `require()` する。ESM-only の新メジャーは
Node 24 の `require(esm)` 経由で解決されるが、これは **module 名前空間オブジェクト**を返す
(CJS の default export ではない)。そのため:

- `flat$1.flatten()` / `flat$1.unflatten()` (named アクセス) → 名前空間にも存在するので動作する想定
- `mime.getType` / `mime.getExtension` (default 上のメソッド) → 名前空間では `undefined` になり壊れる想定

harness は実際にインストールされたバージョンに対して以下を検証する:
1. `@lykmapipo/common` 経由で解決される flat / mime / parse-json のバージョン
2. `common.flat` / `common.unflat` / `common.mimeTypeOf` / `common.mimeExtensionOf` の戻り値契約
3. 実 mongo に対する mongoose-gridfs の write → readback → unlink round-trip

## 事前調査の確定事項

- `@lykmapipo/common@0.44.5` は CommonJS (`main: lib/index.js`)。依存は `flat: >=5.0.2`,
  `mime: >=2.6.0`。**`parse-json` には依存しない** → `@lykmapipo/common>parse-json` override は
  実エッジを持たない **no-op**。
- flat 使用箇所: `flat$1.flatten(...)` (line 1308) / `flat$1.unflatten(...)` (line 1332)
- mime 使用箇所: `mimeExtensionOf`→`mime.getExtension` (line 1608) / `mimeTypeOf`→`mime.getType` (line 1612)
- `mimeTypeOf` / `mimeExtensionOf` は GROWI・mongoose-gridfs・@lykmapipo チェーンの**どこからも
  呼ばれていない** (grep 0 件)。→ mime override 削除は gridfs file-upload smoke では検出できない
  ため、harness で `@lykmapipo/common` の mime API を直接 exercise する。
- 隔離実験 (Node 24, 別 tmp dir で `require()`):
  - flat 6.0.1: `require()` は名前空間。`f.flatten`/`f.unflatten` は関数だが `f` 自体は呼び出し不可
  - mime 4.1.0: `m.getType`/`m.getExtension` は **undefined** (`m.default.getType` に存在)
  - parse-json 8.3.0: `.default` が関数

## Baseline (overrides 有効, flat 5.0.2 / mime 3.0.0) — `node smoke.cjs`

```
@lykmapipo/common: .../@lykmapipo+common@0.44.5/.../lib/index.js
  flat      : 5.0.2
  mime      : 3.0.0
  parse-json: (not resolvable from @lykmapipo/common)   ← 依存なしを実証
  PASS common.flat({a:{b:1}}) => {"a.b":1}
  PASS common.unflat({"a.b":1}) => {"a":{"b":1}}
  PASS common.mimeTypeOf("photo.png") => "image/png"
  PASS common.mimeExtensionOf("image/png") => "png"
--- mongoose-gridfs round-trip ---
  wrote file _id: ... length: 91
  readback OK: bytes match ( 91 bytes )
  cleanup OK
@lykmapipo/common contract: PASS / mongoose-gridfs round-trip: PASS / OVERALL: PASS (exit 0)
```

---

## 5.1 `@lykmapipo/common>flat` — 削除可 ✅ (flat 6.0.1 採用)

**評価手順と結果**:

1. **resolution の sticky 問題**: override を単純に削除しただけでは `pnpm install` は
   「Already up to date」となり flat は 5.0.2 のまま。pnpm は lockfile の既存バージョンが
   range (`@lykmapipo/common` の `flat: >=5.0.2`) を満たす限り維持する。`pnpm update flat -r
   --latest` も flat に直接依存元が無いため 5.0.2 のまま。→ override の実効は「fresh resolve で
   6.x が選ばれるのを防ぐガード」。
2. **最新 ESM 版の強制検証**: override を一時的に `^6.0.0` にして `pnpm install` → `pnpm why
   flat` = **6.0.1**。smoke (`node smoke.cjs`) = **OVERALL PASS**:
   - `common.flat({a:{b:1}})` => `{"a.b":1}` / `common.unflat` => `{"a":{"b":1}}` (flat 6.0.1 の
     `.flatten`/`.unflatten` named export が require(esm) 名前空間に存在し動作)
   - mongoose-gridfs round-trip (実 mongo) write→readback→unlink すべて成功
3. **最終状態**: override を完全削除して `pnpm install`。sticky 解決で flat は **6.0.1 を維持**
   (6.0.1 は `>=5.0.2` を満たす)。`pnpm why flat` = 6.0.1 / lockfile overrides から flat 消失。
4. **build**: `turbo run build --filter @growi/app` = **21/21 成功** (17 cached)。
5. **最終 smoke** (flat 6.0.1, override 削除済): **OVERALL PASS**。
6. **audit diff** (`pnpm audit --audit-level=moderate`):
   - **flat advisories: (none)** — flat 6.0.1 は新規 advisory を導入しない。
   - lockfile の変更は **flat 5.0.2→6.0.1 のみ** (`git diff pnpm-lock.yaml` で他パッケージの
     version 行に変化なしを確認)。よって audit に現れた新規 high/critical (axios / tmp / esbuild /
     ws / form-data / vite / protobufjs) は **baseline 捕捉 (2026-06-12) 以降の advisory DB
     ドリフト**であり、flat 削除とは因果関係なし。新規 HIGH/CRITICAL の中に flat 関連は 0 件。

**結論**: flat の CJS ピン override は **不要**。`@lykmapipo/common` (CJS) は `flat$1.flatten` /
`flat$1.unflatten` という named プロパティ経由で flat を使うため、ESM-only な flat 6.0.1 を Node 24
`require(esm)` で読み込んでも名前空間に同名関数が存在し動作する。override 削除 + flat 6.0.1 採用。

> harness の version probe が `flat: (not resolvable from @lykmapipo/common)` と表示するのは、
> override 撤去後に flat 6.0.1 が別の .pnpm パスへ hoist され probe の commonDir 起点 resolve が
> 外したため (表示上の制限)。実 `require('flat')` は動作している (contract PASS が証左)。
> バージョンは `pnpm why flat` = 6.0.1 が authoritative。

## 5.2 `@lykmapipo/common>mime` — 削除不可 ❌ (override 維持・3.0.0)

**評価手順と結果**:

1. **最新 ESM 版の強制検証**: override を一時的に `^4.0.0` にして `pnpm install` → `pnpm why
   mime` に **4.1.0** が出現 (@lykmapipo/common 経由)。smoke = **OVERALL FAIL**:
   - `common.mimeTypeOf("photo.png")` => `THREW: common.mimeTypeOf is not a function`
   - `common.mimeExtensionOf("image/png")` => `THREW: common.mimeExtensionOf is not a function`
   - flat/unflat は PASS、mongoose-gridfs round-trip も **PASS**
2. **根本原因**: `@lykmapipo/common` は `mimeTypeOf`/`mimeExtensionOf` を
   `Object.defineProperty(exports, 'mimeTypeOf', { get: () => mime.getType })` で公開する
   (lib/index.js:1606-1613)。mime v4 は ESM-only (`require` export 無し) なので Node 24
   `require(esm)` は名前空間オブジェクトを返し、`getType`/`getExtension` は `.default` 側に
   存在する → 名前空間 top-level の `mime.getType` は **undefined** → getter が undefined を
   返し、呼び出すと "is not a function"。mime v3 は `module.exports` が Mime インスタンス
   そのものなので `mime.getType` が直接引ける。
3. **smoke カバレッジの重要点**: GROWI・mongoose-gridfs・@lykmapipo チェーンは
   `mimeTypeOf`/`mimeExtensionOf` を**どこからも呼ばない** (grep 0 件)。そのため
   build・gridfs round-trip だけの検証では mime 4 の破壊を **false-pass** する。
   @lykmapipo/common の mime API を直接 exercise する harness のみが検出できた。
4. **最終状態**: override を `3.0.0` に**復元** + コメントを実発見に基づき精緻化。
   `pnpm install` 後 `pnpm why mime` は baseline の 4 バージョン (1.4.1/1.6.0/2.6.0/3.0.0) に
   戻り、`git diff pnpm-lock.yaml` は**空** (= 5.1 コミット状態と完全一致)。復元後 smoke =
   **OVERALL PASS**。
5. **build / audit**: 最終状態の依存グラフは 5.1 コミット時と同一 (lockfile diff 空) のため
   5.1 で取得した `turbo run build` 21/21 がそのまま有効。mime の破壊は runtime getter の
   問題で型/ビルドには出ない (mime は transitive・型検査対象外) ため、build はこの override の
   ゲートとして無意味。

**結論**: mime の CJS ピン (3.0.0) override は **依然必要**。これは GROWI 自身の CJS/ESM 状態
とは無関係で、第三者 CJS パッケージ `@lykmapipo/common` が mime を CJS default-export 形状で
読む実装に依存するため。Req 4.4 に従い override を維持しコメントで正当化。

## 5.3 `@lykmapipo/common>parse-json` — 削除可 ✅ (dead no-op override)

**評価手順と結果**:

1. **前提の確定**: `@lykmapipo/common@0.44.5` の `dependencies` に **parse-json は存在しない**
   (auto-parse / browser-or-node / flat / inflection / lodash / mime / moment / object-hash /
   randomcolor / statuses / string-template / striptags / uuid)。baseline smoke でも
   `parse-json: (not resolvable from @lykmapipo/common)` を確認済み。pnpm の `parent>child`
   override は `parent` の**直接**依存エッジにのみ適用されるため、`@lykmapipo/common>parse-json`
   は適用先が存在しない **no-op (dead) override**。
2. **削除と検証**: override を削除して `pnpm install`。
   - `pnpm why parse-json` = **5.2.0 + 8.3.0 (2 versions) で削除前と完全に不変**
   - `git diff pnpm-lock.yaml` = **override 行 `'@lykmapipo/common>parse-json': 5.2.0` の削除のみ**。
     パッケージの resolution / version 行は**一切変化なし**。
   - `axios: ^1.15.0` override は**不変** (Req 4.5 — 対象外を確認)
   - 累積最終状態 (flat 6.0.1 / mime 3.0.0 / parse-json override 削除) の smoke = **OVERALL PASS**
3. **audit / build**: resolved version が一切変わらないため security/build への影響なし
   (5.1 の build 21/21 が有効、audit も不変)。

**結論**: `@lykmapipo/common>parse-json` は適用先のない dead override だったため**削除**。
解決グラフに一切影響しない (cleanup)。

---

## Phase 5.1–5.3 最終状態サマリ

| override | 判定 | 最終状態 |
|----------|------|----------|
| `@lykmapipo/common>flat` | 削除可 ✅ | **削除** (flat 6.0.1 ESM 採用、require(esm) で named export 動作) |
| `@lykmapipo/common>mime` | 削除不可 ❌ | **維持 (3.0.0)** + コメント精緻化 (mime v4 で mimeTypeOf/mimeExtensionOf 破綻) |
| `@lykmapipo/common>parse-json` | 削除可 ✅ | **削除** (dead no-op override、@lykmapipo/common は parse-json 非依存) |
| `axios` (対象外) | 変更なし | `^1.15.0` 維持 (Req 4.5) |
| `@codemirror/commands` (対象外) | 変更なし | `^6.10.3` 維持 (#11093 / CJS 無関係) |

最終 smoke: `@lykmapipo/common contract: PASS / mongoose-gridfs round-trip: PASS / OVERALL: PASS`

## 5.4 dependency コメント・インライン理由整理 — 検証完了 (ソース変更なし)

**(1) `package.json` の `// comments for dependencies` から解消済み CJS/ESM ピン記述を削除**:
削除対象は **0 件**だった。理由:
- flat / mime / parse-json のピンは元々 `package.json` ではなく `pnpm-workspace.yaml` の
  overrides にあり、5.1–5.3 で処理済み (`package.json` には存在しなかった)。
- `apps/app/package.json` の `// comments for dependencies` には
  `@keycloak/keycloak-admin-client` (= "19.0.0+ は ESM-only / API 破壊で別マイグレーション要")
  のみ。これは **現役の pin** (`@keycloak/keycloak-admin-client: ^18.0.0`) の理由説明であり、
  19 系へ上げない残存理由 (API 破壊) は GROWI の ESM 化とは独立に有効。「解消済み CJS/ESM ピン」
  ではないため**削除しない** (keycloak 19 系移行は本 spec のスコープ外)。
- `apps/slackbot-proxy/package.json` の `read-pkg-up` コメントも別アプリの現役 pin (スコープ外)。

**(2) 残存 `transpilePackages` / overrides のすべてのエントリに理由コメントが存在することを確認**:
- `transpilePackages`: Phase 4 で**空配列化**。`apps/app/next.config.ts:45-49` に「全エントリは
  ESM 化で不要になり削除、CJS/ESM 非互換起因の残存 0」を説明する英語コメントが既設 (Req 3.1-3.4/7.2)。
- `pnpm-workspace.yaml` の overrides (3 件) すべてに理由コメントあり:
  - `@lykmapipo/common>mime: 3.0.0` — 5.2 で精緻化した詳細コメント
  - `axios: ^1.15.0` — CVE-2026-40175 / GHSA-fvcv-3m26-pcqx
  - `@codemirror/commands: ^6.10.3` — growilabs/growi#11093 (CJS/ESM 無関係・対象外)
  - (参考) packageExtensions / patchedDependencies / allowBuilds も各々コメントあり。

**(3) `axios` CVE コメント**: Phase R.1 で実 advisory を記載済み。現状 `pnpm-workspace.yaml:15-19`
に CVE-2026-40175 / GHSA-fvcv-3m26-pcqx + GHSA URL が**無傷**で存在することを確認。

**結論**: 5.4 は検証タスクとして完了。削除すべき stale な CJS/ESM ピン記述は無く、残存する
すべての override / transpilePackages 状態に正当化コメントが揃っている。ソース変更は不要。
