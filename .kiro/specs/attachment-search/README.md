# attachment-search/ — Reference Bundle (Not a Spec)

**このディレクトリは Kiro の spec ではなく、添付ファイル全文検索プロジェクト (3 sub-specs) のリファレンスバンドルです。**

`spec.json` は存在しません。Kiro コマンド (`/kiro-spec-*` 等) の対象ではない。

## 構成する 3 sub-specs

このプロジェクトは 3-way split で以下 3 spec として実装されます:

1. **`attachment-search-markitdown-extractor/`** — Python FastAPI 抽出サービス (`services/markitdown-extractor/`)
2. **`attachment-search-indexing/`** — apps/app サーバ側統合 (ES 連携、indexer、apiv3)
3. **`attachment-search-ui/`** — apps/app クライアント側 UI (検索結果、管理画面)

依存順序: `attachment-search-markitdown-extractor` → `attachment-search-indexing` → `attachment-search-ui`

3-way split を選択した経緯 (Tika / TS ポート等の代替案を退けた理由) は [research.md](./research.md) 参照。

## このディレクトリに残した資料

| ファイル | 内容 | 主な参照元 |
|---|---|---|
| [research.md](./research.md) | gap analysis (既存 GROWI コード調査) + design phase discovery (FastAPI-orval / markitdown PR #1263 / GROWI.cloud 制約) | 3 sub-specs の research.md / brief.md |
| [research-docker-image.md](./research-docker-image.md) | markitdown REST API Docker image 選定調査 (サードパーティ pre-built 評価、自前ビルド用 Dockerfile 提案) | `attachment-search-markitdown-extractor` |
| [design-review-fixes.md](./design-review-fixes.md) | 3-way split 後の `/kiro-validate-design` で指摘された 9 Critical/Minor Issues の解消記録 | (歴史的記録、spec からは未参照) |

## このディレクトリを開く人へ

- 「なぜ 3 spec に分割したのか」を知りたい → `design-review-fixes.md` 冒頭の「経緯」
- 「既存 GROWI のどの部分にどう統合するのか」を知りたい → `research.md` の Current State Investigation
- 「なぜ Docker image は自前ビルドなのか / markitdown TS ポートを使わないのか」を知りたい → `research-docker-image.md`
- 個別 spec の requirements / design を見たい → 上記 3 sub-specs のディレクトリへ

## Superseded artifacts (削除済み)

元は単一 spec `attachment-search` として進行していた artifacts (brief.md / requirements.md / design.md / spec.json) は、3-way split で 3 sub-specs に責務が再配分されたため削除済み。git history で追跡可能。
