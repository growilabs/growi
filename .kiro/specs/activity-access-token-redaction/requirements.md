# Requirements Document

## Project Description (Input)
**activity-log の amend spec**（完了済みの `activity-log` spec の約束を変える一時的な spec。最後に変更を activity-log へ書き戻して自分を削除する。`.claude/rules/spec-lifecycle.md` に従う）。

- **誰が困っているか**: 監査ログ（activity）を保管・閲覧する GROWI の管理者と運用者。activity の `endpoint` に access_token が平文で残ると、DB を読める人や監査ログのエクスポートを受け取った人にトークンが漏れる。
- **今の状況**:
  - 記録用の middleware（`add-activity.ts` → `redact-access-token-from-endpoint.ts`）で endpoint の access_token を伏せ字にしているが、activity-log spec には書かれていない。
  - `ActivityService.createActivity` を直接呼ぶ経路（ログイン、検索、添付ファイルのダウンロード、ページ閲覧、growi-vault、各種エクスポートの cron など）は middleware を通らないので、生の URL が保存される。
  - 伏せ字処理が入る前に保存された activity には、トークンが平文で残っている。
- **何を変えるか**:
  - 伏せ字処理を middleware からモデル側の保存処理（`models/activity.ts` の書き込み口）に移し、どの経路で記録しても endpoint の access_token が伏せ字になるようにする。
  - 既存の activity の endpoint を伏せ字にする migration を追加する。
  - activity-log spec の design.md / requirements.md に伏せ字の約束を書き戻す。

範囲外: endpoint 検索まわりの変更（別 spec）。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
