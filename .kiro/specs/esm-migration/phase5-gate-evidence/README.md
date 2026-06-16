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
