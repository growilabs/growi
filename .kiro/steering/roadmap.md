# Roadmap

リポジトリ全体のロードマップ。プロジェクト横断的なマイルストーンや方針をここに記す。

現在、リポジトリ全体に共通する公式な roadmap は確立されていない。プロジェクト横断的な方針が定まり次第ここに追記する。

## Active Umbrella Specs

実装中 / 完了直後の大型イニシアチブは umbrella spec 内に自身の sub-spec roadmap を持つ。詳細は各 umbrella の `roadmap.md` を参照すること。

| Umbrella spec | Status | Sub-spec roadmap |
|---|---|---|
| [growi-vault](../specs/growi-vault/) | resilience / reconcile 完了、ha は brief 段階 | [.kiro/specs/growi-vault/roadmap.md](../specs/growi-vault/roadmap.md) |

## Spec Family: activity log（監査ログ改善）

activity log サブシステムを責務ごとに分割したファミリー。flagship の `activity-log` が「何を記録するか（記録ゲート）」と全体の関心マップを持つ。`activity-log`（≒監査ログ）という最も本流の名前は、最も基本的な概念である記録ゲートに充てている。

分割の経緯: 旧 `activity-log` spec は snapshot を対象とした保守用 spec だった。名前と実体を一致させるため、その中身を `activity-log-snapshot` へ改名移設し、`activity-log` の名前を記録ゲート（flagship）に明け渡した。

### Specs（依存順）

- [x] `activity-log-snapshot` — snapshot の型付け＋添付削除ログ（実装済み / PR #11393。旧 `activity-log` を改名）。**次の増分**: 添付系 action 全て（ADD 等）への snapshot capture 拡張 → `/kiro-spec-requirements activity-log-snapshot`。依存: なし
- [ ] `activity-log`（flagship / 記録ゲート） — 対象外 action を今後保存しない。直し方（defer-create / delete-at-settle）は design で比較。既存残骸の掃除は対象外。依存: なし（並行可）
- [ ] `activity-log-snapshot-viewer` — 監査ログ画面での snapshot 表示（生表示＋添付系整形）。依存: `activity-log-snapshot`（添付 ADD 整形は capture 拡張後）

### 将来課題（未割当）

`target × targetModel` の全面的型安全化 / 保持期間・TTL / 大量カスケード削除時のボリューム制御。整理先は flagship `activity-log` の関心マップ（`.kiro/specs/activity-log/brief.md`）で管理する。
