# Roadmap

リポジトリ全体のロードマップ。プロジェクト横断的なマイルストーンや方針をここに記す。リポジトリ全体に共通する公式な roadmap はまだ確立されていないため、現時点の中身は**複数 spec にまたがるイニシアチブの索引**である。

## ここに書くもの / 書かないもの

- **書く**: **進行中の**、複数 spec にまたがるイニシアチブ（umbrella spec、または flagship spec を持つファミリー）を 1 行だけ。
- **書かない**: 決定事項・未決の論点・実測値・PR 番号・実装ファイルパス。これらは各イニシアチブ側（umbrella の `roadmap.md`、flagship の `brief.md`、各 spec の `spec.json`）が一次情報源として持つ。ここに写すと二重管理になり、必ず片方が古くなる。
- **書かない**: 完了したイニシアチブ。**完了した時点でここから消す。** 何をやったかの記録は各 spec 側（`spec.json` の `increment_note`、flagship の `brief.md`）に残るので、roadmap に完了済みの行を積む理由が無い。
- **書かない**: 単発の spec（`drawio`、`g2g-import-conflict-detection` など）。完了・未完了を問わずイニシアチブではないので、状態は各 spec 側に残す。

## Umbrella Specs

大型イニシアチブは umbrella spec 内に自身の sub-spec roadmap を持つ。詳細は各 umbrella の `roadmap.md` を参照すること。

| Umbrella spec | Status | Sub-spec roadmap |
|---|---|---|
| [growi-vault](../specs/growi-vault/) | resilience / reconcile 完了、ha は brief 段階 | [roadmap.md](../specs/growi-vault/roadmap.md) |
| [editor-commands](../specs/editor-commands/) | spec 整備中（slash-command は tasks 生成済み、extended-elements / selection-palette は WIP） | [roadmap.md](../specs/editor-commands/roadmap.md) |
| [i18n](../specs/i18n/) | discovery 完了、sub-spec 2 本とも brief 段階。翻訳ファイル構成の整理方式は未決 | [roadmap.md](../specs/i18n/roadmap.md) |

---
_Updated: 2026-08-07. 完了済みの activity log ファミリー（`activity-log` / `activity-log-snapshot` / `activity-log-snapshot-viewer`、3 spec とも master にマージ済み）の節を削除した。PR 番号・実装ファイルパス・将来課題は各 `spec.json` の `increment_note` と flagship の `brief.md`（関心マップ）に既にあり、そこにしか無かった「spec 分割・改名の経緯」は削除前に flagship の brief へ移設済み。あわせて footer に溜まっていた編集履歴を落とし、「ここに書くもの / 書かないもの」を本文の方針として明示した。_
