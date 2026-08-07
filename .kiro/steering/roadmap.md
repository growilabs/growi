# Roadmap

リポジトリ全体のロードマップ。プロジェクト横断的なマイルストーンや方針をここに記す。

現在、リポジトリ全体に共通する公式な roadmap は確立されていない。プロジェクト横断的な方針が定まり次第ここに追記する。

## Active Umbrella Specs

実装中 / 完了直後の大型イニシアチブは umbrella spec 内に自身の sub-spec roadmap を持つ。詳細は各 umbrella の `roadmap.md` を参照すること。

| Umbrella spec | Status | Sub-spec roadmap |
|---|---|---|
| [growi-vault](../specs/growi-vault/) | resilience / reconcile 完了、ha は brief 段階 | [.kiro/specs/growi-vault/roadmap.md](../specs/growi-vault/roadmap.md) |
| [i18n](../specs/i18n/) | discovery 完了、sub-spec 2 本とも brief 段階。翻訳ファイル構成の整理方式は未決 | [.kiro/specs/i18n/roadmap.md](../specs/i18n/roadmap.md) |

## Spec Family: activity log（監査ログ改善）

activity log サブシステムを責務ごとに分割したファミリー。flagship の `activity-log` が「何を記録するか（記録ゲート）」と全体の関心マップを持つ。`activity-log`（≒監査ログ）という最も本流の名前は、最も基本的な概念である記録ゲートに充てている。

分割の経緯: 旧 `activity-log` spec は snapshot を対象とした保守用 spec だった。名前と実体を一致させるため、その中身を `activity-log-snapshot` へ改名移設し、`activity-log` の名前を記録ゲート（flagship）に明け渡した。

### Specs（依存順）

3 spec すべてサブタスク完了。実装は master に入っている（下記 PR はいずれもマージ済み）。

- [x] `activity-log-snapshot` — snapshot の型付け＋添付削除ログ（REMOVE: PR #11393）＋添付系 action（ADD/DOWNLOAD）への capture 拡張、および builder / recorder を `server/service/attachment/` へ移して `service/activity` を機構のみに収束させる配置リファクタ（挙動不変・PR #11433）。旧 `activity-log` を改名。依存: なし
- [x] `activity-log`（flagship / 記録ゲート） — 対象外 action を今後保存しない（PR #11421）。失敗・中断時の記録経路は `recordFailsafeAttempt` / `registerFailsafeFinalizer`（`server/service/activity/`）。既存残骸の掃除は当初から対象外。ファミリー全体の関心マップは引き続きこの spec が持つ。依存: なし
- [x] `activity-log-snapshot-viewer` — 監査ログ画面での snapshot 表示（生表示＋添付系整形・PR #11440）。UI は `client/components/Admin/AuditLog/snapshot-detail/`。残っているのは翻訳のみ（タスク 6.1: ja / ko / zh / fr のラベル）で、英語ファーストの方針により後続扱い・実施要否は別途判断。依存: `activity-log-snapshot`

### 将来課題（未割当）

`target × targetModel` の全面的型安全化 / 保持期間・TTL / 大量カスケード削除時のボリューム制御。整理先は flagship `activity-log` の関心マップ（`.kiro/specs/activity-log/brief.md`）で管理する。

---
_Updated: 2026-08-06. umbrella spec `i18n` を追加（`apps/app` の多言語化アーキテクチャ改善。discovery による分解、sub-spec 2 本）。詳細な経緯・決定事項・未決の論点はすべて [.kiro/specs/i18n/roadmap.md](../specs/i18n/roadmap.md) 側に置き、ここには表の 1 行だけを持つ。同日: activity log ファミリー 3 spec の状態を実装実績に合わせて更新（3 件とも master にマージ済みを確認、残タスクは snapshot-viewer の翻訳のみ）。単発で完了した spec（`drawio`、`g2g-import-conflict-detection` など）はファミリーでも umbrella でもないため、ここには列挙せず各 spec 側に残す。_
