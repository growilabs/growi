# Brief: otel-anonymization-coverage

## Amend target

| 対象 spec | 変わる契約 |
|---|---|
| `.kiro/specs/opentelemetry/` | requirements.md 要件 6（匿名化の対象 URL とその扱い。一覧表を追加し、対象を広げる） |
| 同上 | design.md Layer 4（handler の URL 判定を宣言的な一覧に寄せる）、Extension Templates「新規 Anonymization Handler の追加」、Revalidation Triggers「新規 anonymization 対象パス／パラメータ追加要望」 |
| 同上 | research.md「Anonymization Handler の登録順とパターン」（「複数 module が同一 URL を匿名化することは現状無い」という記述は誤り。途中に `_search` を含む URL では page access の handler が search の handler の結果を上書きする） |

Revalidation Triggers の「新規 anonymization 対象パス／パラメータ追加要望」の条件そのものが変わる（一覧表との突き合わせが手順に加わる）。

## 背景

- 2026-10-27 の PR #12123（issue #11688）レビューで、匿名化されていない経路を洗い出した。結果は requirements.md の Project Description を参照。
- `http.url` などに元の URL が残る問題は PR #12151 で修正済み。本 spec は「どの URL を対象にするか」を扱う。

## 完了条件

- 最終タスクで変更内容を `opentelemetry` spec に書き戻し、本ディレクトリを削除する。
