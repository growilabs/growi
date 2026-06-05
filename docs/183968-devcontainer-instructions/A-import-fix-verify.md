# dev container 側 Claude への指示書 [A]: GROWI Archive Import バグ修正の検証

このファイルは自己完結している。inner wiki / 会話履歴 / Redmine を見る必要はない。
**コードを新たに書く作業はほぼ無い。既に当たっている1ファイルの修正を検証するのが主目的。**

## ひとことで言うと

GROWI 管理画面の「データインポート（GROWI Archive Import）」で `pages` コレクションを
import すると `Error: Invalid option for pages` で必ず失敗するバグがある。その修正が
1ファイルに既に当たっている。この修正が **devcontainer 上で build / typecheck を通る**
ことを確認し、可能なら **import が壊れていた根本原因が解消したことを単体レベルで裏取り**
してほしい。

実際の管理画面 import の実行（メンテナンスモード ON → アーカイブ投入）は **このタスクの
範囲外**。ここでは「修正がコードとして正しく、型・ビルドが通る」ところまでを固める。

## 背景（最小限）

- `target: "ESNext"` により TypeScript の `useDefineForClassFields: true`（ES2022 クラス
  フィールド意味論）が有効。
- `ImportOptionForPages`（`apps/app/src/models/admin/import-option-for-pages.ts`）は、基底
  `GrowiArchiveImportOption` のコンストラクタが `initProps`（`DEFAULT_PROPS`）を
  `this[key] = value` で代入する設計。
- ところがサブクラスに **初期化子なしの bare フィールド宣言**
  （`isOverwriteAuthorWithCurrentUser;` など5本）があると、`useDefineForClassFields: true`
  下では `super()` 復帰後に `this.x = undefined` が走り、基底が入れた値を **undefined で上書き**
  してしまう。
- `JSON.stringify` は値が `undefined` のキーを出力しないため、クライアントが
  `POST /_api/v3/import` の body に送る際にこれら5キーが丸ごと欠落する。
- サーバ側の型ガード `isImportOptionForPages`（`'isOverwriteAuthorWithCurrentUser' in opt`）
  が false になり、`overwrite-params/index.ts` が `throw new Error('Invalid option for pages')`。
- 対照的に `ImportOptionForRevisions` は bare 宣言を持たないため壊れない。これが「pages だけ
  落ちる」理由。

## 既に当たっている修正（確認対象）

`apps/app/src/models/admin/import-option-for-pages.ts` の5本の bare フィールド宣言に
`declare` 修飾子を付与済み（型情報のみ・ランタイム出力なしにして、undefined 上書きを止める）：

```ts
export class ImportOptionForPages extends GrowiArchiveImportOption {
  // `declare` keeps these type-only (no runtime field emit). ...
  declare isOverwriteAuthorWithCurrentUser: boolean;
  declare makePublicForGrant2: boolean;
  declare makePublicForGrant4: boolean;
  declare makePublicForGrant5: boolean;
  declare initPageMetadatas: boolean;

  constructor(collectionName, mode = ImportMode.insert, initProps = DEFAULT_PROPS) {
    super(collectionName, mode, initProps);
  }
}
```

この修正は miya さんのレビュー指摘に沿った採用案（対象1ファイルのみ・最小差分）。

## diff の状態（前提）

この修正は**ブランチにコミット済み**で、この指示書もそのブランチに同梱されている
（`docs/183968-devcontainer-instructions/` 配下）。devcontainer 側はこのブランチを
pull した時点で、修正・指示書ともに手元にある状態。最初に修正が乗っているか確認：

```bash
cd /workspace/growi   # ← devcontainer 上の git ルートに読み替え
git log --oneline -3   # import 修正コミットが乗っているか
grep -n "declare isOverwriteAuthorWithCurrentUser" apps/app/src/models/admin/import-option-for-pages.ts
# → 行がヒットすれば修正は手元にある
```

> 注意: ホスト側と devcontainer 側はワークツリーを共有していない（**git push/pull で同期**
> する構成）。なので「ホスト側で当てた修正」は push → pull を経て初めて devcontainer 側に
> 届く。このブランチを pull した時点で届いているはずだが、もし `grep` がヒットしなければ
> pull が済んでいない。`git pull` してから再確認すること。

## 検証手順

### 1. typecheck（必須）

```bash
cd /workspace/growi
pnpm turbo run build --filter=@growi/core --filter=@growi/logger --filter=@growi/editor
# ↑ workspace 依存の dist を用意（無いと @growi/core 系の TS2307 が大量に出るが、それは
#   今回の修正とは無関係のノイズ。dist を建ててから typecheck するのが正しい）

cd apps/app
pnpm run lint:typecheck 2>&1 | tee /tmp/183968A-typecheck.log
```

- **期待**: `import-option-for-pages.ts` に関するエラーが **0 件**。
- `@growi/*` の TS2307（モジュール解決失敗）が残る場合は、依存パッケージの build が
  足りていない。必要な package を追加で build してから再実行する。
- **判定**: 「`import-option-for-pages.ts` 起因のエラーが無いこと」を確認できれば OK。
  他パッケージ起因のノイズは本タスクの対象外（その旨ログに明記して報告）。

### 2. lint:biome（必須）

```bash
cd apps/app
pnpm run lint:biome 2>&1 | tee /tmp/183968A-biome.log
```

- 対象ファイルが biome で怒られていないこと（`declare` は許容構文）。

### 3. 根本原因の解消を単体で裏取り（強く推奨）

「`new ImportOptionForPages('pages', 'upsert')` が5つのオプションを own property として
保持し、`JSON.stringify` に含まれ、型ガードを通過する」ことを直接確かめる。
**使い捨てスクリプト**（`apps/app/tmp/` 配下・実行後削除する。コミットしない）で確認する：

```ts
// apps/app/tmp/183968A-import-option-check.ts
import { ImportOptionForPages, isImportOptionForPages } from '~/models/admin/import-option-for-pages';

const opt = new ImportOptionForPages('pages', 'upsert' as any);

// (a) own property として5キーが存在し、undefined でないこと
const keys = ['isOverwriteAuthorWithCurrentUser','makePublicForGrant2','makePublicForGrant4','makePublicForGrant5','initPageMetadatas'] as const;
const ownState = keys.map(k => ({ key: k, hasOwn: Object.prototype.hasOwnProperty.call(opt, k), value: (opt as any)[k] }));
console.log('own props:', JSON.stringify(ownState, null, 2));

// (b) JSON.stringify に5キーが残ること（クライアントが body に載せる経路の再現）
const serialized = JSON.parse(JSON.stringify(opt));
console.log('serialized keys present:', keys.map(k => ({ key: k, inJson: k in serialized })));

// (c) サーバ側型ガードを通過すること（これが false だと Invalid option for pages になる）
console.log('isImportOptionForPages(serialized as option):', isImportOptionForPages(serialized));
```

実行（ts-node 経由。bootstrap 不要 — このスクリプトは DB も ES も触らない純粋なクラス検証）：

```bash
cd apps/app
pnpm run ts-node tmp/183968A-import-option-check.ts
```

**期待される出力（修正が効いている証拠）**:
- (a) 5キーすべて `hasOwn: true` かつ `value: false`（undefined ではない）
- (b) 5キーすべて `inJson: true`
- (c) `isImportOptionForPages(...)` が `true`

> もし ts-node 実行が環境都合（ローダー等）で動かない場合は、同等の確認を vitest の単体
> テストとして書いてもよい（`*.spec.ts`、co-locate）。ただし**本番挙動の契約**（own property
> + JSON 残存 + 型ガード通過）を検証する形にすること。assertion 無しの「throw しなければ OK」
> なテストにはしない。テストを追加する場合は essential-test-design / essential-test-patterns
> スキルに必ず目を通してから書く。

## 報告フォーマット

1. **修正の存在確認**: `grep` がヒットしたか（= ブランチ pull 済みで修正が手元にある）。
2. **typecheck**: `import-option-for-pages.ts` 起因のエラー有無。ノイズ（他パッケージ起因）
   があればその旨。
3. **biome**: 対象ファイルが clean か。
4. **根本原因の裏取り**: 上記 (a)(b)(c) の結果。特に **(c) が true** であること（= もう
   `Invalid option for pages` を踏まない）。
5. やってみて引っかかった点・環境差があれば書く。

## やらないこと（スコープ外）

- 実際の管理画面からの archive import 実行（メンテナンスモード操作）
- dev wiki データの export / import
- suggestPath の計測
- 他の import option クラスの横展開点検（miya さんメモにある「再発防止の横展開」は別途）
