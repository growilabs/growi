# Requirements Document

## Introduction

`apps/app` の翻訳キーには、壊れていることを誰も検知できない状態が続いている。i18n 関連の lint ルールや CI ステップは存在せず、安全網は手書きの vitest 2 本だけである。結果として、どのキーが使われていないか、どの言語でどのキーが欠けているか、tsx に書いたキーが typo かどうかが分からず、実際にユーザーに見える不具合が 2 件生じている（存在しないキーへの参照が 27 箇所、管理画面が本番でだけ翻訳できず生キーを表示する）。

本スペックは、翻訳キーの整合性を継続的に検出する仕組みを既存の CI パイプラインに組み込み、上記の実バグ 2 件を解消することを目的とする。翻訳ファイルの構成整理（namespace 再編やコンパイラ方式への移行）や、未使用キーの一括削除、欠損翻訳を埋める作業は対象外とする。

## Boundary Context

- **In scope**:
  - コードから存在しない翻訳キーへ参照している箇所の検出（ゼロ件まで解消）
  - 未使用キーの検出（現在の件数を基準線とし、悪化のみを失敗条件とする）
  - 言語間の翻訳欠損の検出（言語ごとに現在の件数を基準線とし、悪化のみを失敗条件とする）
  - 動的に構築される翻訳キー参照を、上記の検出から除外するための宣言手段
  - 静的には解決可能なキー参照が、間接的な受け渡し（`t` 関数を props 経由で受け取る、複数 namespace を配列で試す helper 経由で呼ぶ等）によって検出ツールから追跡できなくなっている箇所を、検出可能な形に書き換えること（namespace 構成自体の変更ではない）
  - 検出処理が翻訳ファイルを書き換えないことの保証
  - 既存の CI パイプラインへの検出処理の統合
  - 管理画面が本番でのみ翻訳できず生キーを表示する不具合の解消（対象は共有ラベル約 20 件に限定）
  - 既存の手書きドリフトテスト（`i18n-reconcile.spec.ts`、`g2g-error-keys-locale-drift.spec.ts`）と新設する検出処理の重複整理
- **Out of scope**:
  - 未使用キーの一括削除（検出と削除の判断は別。動的キーを含む上限値のため機械的な削除は危険）
  - 欠損している翻訳そのものを埋める作業（コミュニティ翻訳の導線に委ねる）
  - `admin` namespace 1,166 キーを含む翻訳ファイル構成全体の再編（方式が未決のため）
  - キーの型付けによる compile-time 検証
  - 翻訳管理システムとの連携
- **Adjacent expectations**:
  - 言語間の翻訳欠損の基準線は、翻訳が追加されるにつれて下がっていくことが期待されるが、翻訳を埋める作業自体は別の取り組みが担う
  - 検出処理が失敗ステータスを報告した結果として実際にマージを止めるかどうかは、リポジトリ側のブランチ保護設定によって決まり、本スペックの管轄ではない
  - 翻訳ファイル構成の再編方式やコンパイラ方式への移行の採否は、上位の roadmap が保持する未決事項であり、本スペックでは解決しない

## Requirements

### Requirement 1: 存在しない翻訳キーへの参照の検出とゼロ化

**Objective**: GROWI 開発者として、コードから参照している翻訳キーがすべて既定言語の翻訳ファイルに実在することを知りたい。存在しないキーへの参照によってユーザーに生キーが見えてしまう不具合を防ぐため。

#### Acceptance Criteria
1. When Translation Key Audit を実行した場合, the Translation Key Audit shall コード中の静的に解決可能な翻訳キー参照のうち、既定言語の翻訳ファイルに存在しないものをすべて報告する。
2. Where あるキー参照が動的に構築されるものとして宣言されている場合（Requirement 4）, the Translation Key Audit shall そのキー参照を本チェックの対象から除外する。
3. If 存在しない翻訳キーへの参照が 1 件以上見つかった場合, then the Translation Key Audit shall 非ゼロの結果で終了する。
4. When 本機能の提供後に Translation Key Audit を実行した場合, the Translation Key Audit shall discovery および実測で判明した、どの namespace ファイルにも存在しないキー参照（例: `common:failed_to_copy`、`Successfully updated`、`fix_page_grant.modal.alert_message`）を含め、存在しない翻訳キーへの参照を 0 件として報告する。
5. If 本要件のゼロ件化を、静的に解決可能なキー参照の一部を検出対象から除外することによって達成する場合, then the Translation Key Audit shall その除外によって、当該キー参照が将来存在しないキーへの参照に書き換えられても検出されなくなる状態を作らない。
6. When GROWI 開発者が本要件を満たすためにコードの記述を変更した場合, GROWI 開発者 shall 変更前後で実際に表示される翻訳文言が変わらないことを確認する。

### Requirement 2: 未使用キーの検出（基準線・悪化防止）

**Objective**: GROWI 開発者として、翻訳キーの未使用が新たに増えたことを知りたい。既存の大量の未使用キーの一括削除は別判断に委ねつつ、これ以上の悪化だけは早期に検知したいため。

#### Acceptance Criteria
1. When Translation Key Audit を実行した場合, the Translation Key Audit shall コード中の静的な参照が一件も無い翻訳キーの件数を集計する（Requirement 4 で動的キーとして宣言されたキーを除く）。
2. The Translation Key Audit shall 本機能の提供時点で集計した件数を、本チェックの基準線として記録する。
3. While 集計した件数が基準線以下である場合, the Translation Key Audit shall 本チェックを合格とする。
4. If 集計した件数が基準線を超える場合, then the Translation Key Audit shall 本チェックを不合格とする。
5. Where 開発者が未使用キーを実際に削減した場合, the Translation Key Audit shall 基準線をより小さい件数へ更新できるようにする。

### Requirement 3: 言語間の翻訳欠損の検出（基準線・悪化防止）

**Objective**: GROWI 開発者として、既定言語には存在するが他言語に欠けているキーが新たに増えたことを知りたい。既存の欠損（例: `ko_KR` の 92 件）を今すぐ埋める判断は別の取り組みに委ねつつ、これ以上の悪化だけは早期に検知したいため。

#### Acceptance Criteria
1. When Translation Key Audit を実行した場合, the Translation Key Audit shall 既定言語以外の各言語について、既定言語の翻訳ファイルに存在するが当該言語の翻訳ファイルに存在しないキーの件数を言語ごとに集計する。
2. The Translation Key Audit shall 本機能の提供時点で言語ごとに集計した件数を、当該言語の基準線として記録する。
3. While ある言語の集計件数がその言語の基準線以下である場合, the Translation Key Audit shall 当該言語について本チェックを合格とする。
4. If ある言語の集計件数がその言語の基準線を超える場合, then the Translation Key Audit shall 当該言語について本チェックを不合格とする。
5. Where 翻訳の追加により、ある言語の欠損件数が減少した場合, the Translation Key Audit shall 当該言語の基準線をより小さい件数へ更新できるようにする。

### Requirement 4: 動的キー参照の誤検出防止

**Objective**: GROWI 開発者として、実行時に動的に構築される翻訳キー参照を、未使用キー検出および存在しないキー参照検出の誤検出対象から外したい。静的解析では解決できないキーが毎回誤って報告され続ける状態を避けるため。

#### Acceptance Criteria
1. The Translation Key Audit shall 翻訳キー参照が実行時に動的に構築されるものであることを、開発者が編集可能な形で宣言する手段を提供する。
2. When あるキー参照が宣言済みの動的パターンに一致する場合, the Translation Key Audit shall そのキー参照を Requirement 1（存在しないキー参照の検出）および Requirement 2（未使用キーの検出）の対象から除外する。
3. The Translation Key Audit shall discovery で判明した 50 件の動的キー参照を、宣言済みの動的パターンでカバーする。

### Requirement 5: 翻訳ファイルの不変性

**Objective**: GROWI 開発者として、検出処理が CI 上で実行されても翻訳ファイルの内容が意図せず書き換わらないことを保証したい。コミュニティによる既存の翻訳が検出処理によって黙って失われる事態を防ぐため。

#### Acceptance Criteria
1. When Translation Key Audit が CI パイプラインの一部として実行された場合, the Translation Key Audit shall いかなる翻訳ファイルも変更しない。
2. If 検出処理が用いる仕組みが翻訳ファイルを書き換える機能を持つ場合, then CI 上の実行設定は、その書き換え機能を無効化した状態で検出処理を呼び出す。

### Requirement 6: 既存 CI パイプラインへの統合

**Objective**: GROWI へのコントリビューターとして、翻訳キーの整合性チェックを既存の Pull Request のチェック結果として確認したい。別途手動で確認する手順を増やさないため。

#### Acceptance Criteria
1. When Pull Request が作成または更新された場合, the CI Pipeline shall 既存の自動チェックの一部として Translation Key Audit を実行する。
2. If Translation Key Audit が Requirement 1 のゼロ件条件、または Requirement 2 / Requirement 3 の基準線超過を報告した場合, then the CI Pipeline shall 当該 Pull Request に対応するチェックを失敗として報告する。

### Requirement 7: 管理画面の生キー表示の解消

**Objective**: GROWI 管理者として、本番環境の管理画面で表示されるラベルが常に翻訳された文言として表示されることを期待したい。開発環境では再現せず本番でのみ生キーが見える不具合によって、管理画面の見た目が損なわれることを防ぐため。

#### Acceptance Criteria
1. When 管理者が本番ビルドの管理画面を閲覧した場合, the Admin UI shall discovery で判明した共有ラベル（例: Created、Cancel、Close、Name、Email、Update、Description、User、Edit、UserGroup、Create）を、選択言語に翻訳された文言として表示する。
2. If ある管理画面のコンポーネントが必要とする翻訳データが、サーバーサイドの応答に含まれていない場合, then the Admin UI shall 実行時にクライアント側から翻訳データを取得することによってその欠落を補おうとしない（本番環境にはその取得手段が存在しないため）。

**Note:** 対応は discovery で判明した共有ラベル約 20 件の解決に限定し、`admin` namespace 1,166 キー全体の再構成には踏み込まない。

### Requirement 8: 既存の手書きドリフトテストの整理

**Objective**: GROWI 開発者として、新設する検出処理と既存の手書きテストが同じ内容を二重にチェックし続ける状態を避けたい。片方を更新し忘れて食い違う、または不要な保守コストが発生することを防ぐため。

#### Acceptance Criteria
1. Where 既存の手書きテスト（`i18n-reconcile.spec.ts`、`g2g-error-keys-locale-drift.spec.ts`）が検出している内容が Translation Key Audit の対象範囲に完全に含まれる場合, GROWI 開発者 shall 当該テストを削除または縮小し、同じ内容を 2 つの独立した仕組みで検査しない状態にする。
2. If 既存の手書きテストが Translation Key Audit の対象範囲に含まれない内容を検査している場合, then GROWI 開発者 shall そのテストを維持する。
