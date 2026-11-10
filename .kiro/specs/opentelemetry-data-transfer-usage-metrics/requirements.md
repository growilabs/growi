# Requirements Document

## Project Description (Input)

**誰が困っているか**: GROWI の機能の利用状況をもとに開発・サポートの優先度を判断したい WESEEK（GROWI 開発チーム）。

**現状**:
- 管理画面のデータアーカイブ（GROWI アーカイブファイルの作成・ダウンロード・アップロード・インポート）と、お引越し機能（G2G 転送）が、各インスタンスでどの程度使われているかを WESEEK 側で把握する手段がない。
- データアーカイブの操作は監査ログのアクションとして定義されているが、監査ログは初期状態で無効（`app:auditLogEnabled` = false）で、有効にしても既定の Small グループには含まれず（Large グループのみ）、多くのインスタンスで記録が残らない。また監査ログは各インスタンスの DB に保存されるだけで外部には集計されない。
- お引越し機能には監査ログのアクション自体が存在しない。
- OpenTelemetry で送信している独自メトリクスはユーザー数・ページ数・メモリ・設定情報などの状態値（ObservableGauge）のみで、機能の利用回数は含まれない。トレースは本番で 1% サンプリングのため利用回数の集計には使えない。

**何を変えるか**:
- データアーカイブとお引越し機能の操作が実行されるたびに、OpenTelemetry の Counter メトリクスとして記録・送信し、監査ログの設定に依存せずにインスタンス単位で「利用の有無」「利用しているインスタンスの割合」「利用頻度」を把握できるようにする。
- お引越し機能は送信側・受信側の双方で記録し、区別できるようにする。
- 送信するのは操作の種類・成否などの回数情報のみとし、ページ内容・ユーザー・ファイル名などは含めない。
- ページの一括エクスポートはスコープ外とする。

**Amend 対象**: 本 spec は実装完了済みの `opentelemetry` spec の Layer 3（Custom Metric）の実装規約（ObservableGauge のみ）と Extension Templates を拡張する amend spec である。詳細は `brief.md` を参照。

## Introduction

GROWI の管理者向け機能である「データアーカイブ」（GROWI アーカイブファイルの作成・ダウンロード・アップロード・インポート）と「お引越し」（GROWI 間のデータ転送）について、各インスタンスでの利用回数を既存の OpenTelemetry テレメトリ経路で送信する。これにより WESEEK は、受信側の集計によって「利用しているインスタンスが存在するか」「全インスタンスのうちどの程度が利用しているか」「インスタンスごとにどの程度の頻度で利用されているか」を把握できるようになる。記録は監査ログの有効化設定とは独立して行い、個人やコンテンツを特定できる情報は送信しない。

## Boundary Context

- **In scope**:
  - データアーカイブの作成・ダウンロード・アップロード・インポートの各操作の回数
  - お引越しの送信側（転送の実行）と受信側（データの受け取りと取り込み）それぞれの回数
  - 各操作の成否の区別
  - 上記を記録するための、`opentelemetry` spec の Custom Metric 規約と追加手順の拡張
- **Out of scope**:
  - ページの一括エクスポート（監査ログの必須グループで常時記録されているため）
  - データアーカイブの削除、アップロード済みアーカイブの破棄、お引越しの事前確認（preflight）や転送キーの発行など、データの持ち出し・取り込みそのものではない操作
  - 本機能のリリースより前の利用実績の遡及
  - 受信側（コレクター・ダッシュボード・クエリ）の設定と集計方法
  - 監査ログの記録対象やアクショングループの変更
- **Adjacent expectations**:
  - 送信の有効・無効と送信先は、既存の OpenTelemetry 有効化設定（`opentelemetry` spec Requirement 1）にそのまま従う。本機能独自の有効化設定は設けない。
  - インスタンスの識別は既存の Resource Attribute（`service.instance.id` 等）に依存し、本機能では新たな識別情報を追加しない。

## Requirements

### Requirement 1: データアーカイブ操作の利用回数記録

**Objective:** As a WESEEK の GROWI 開発チーム, I want 各インスタンスでデータアーカイブの各操作が何回行われたかを知りたい, so that データアーカイブ機能の利用の有無と頻度を把握できる

#### Acceptance Criteria

1. When 管理者が要求した GROWI アーカイブファイルの作成処理が完了した, the GROWI server shall 操作種別「作成」・結果「成功」として利用回数を 1 加算する
2. If GROWI アーカイブファイルの作成処理が失敗した, the GROWI server shall 操作種別「作成」・結果「失敗」として利用回数を 1 加算する
3. When 管理者が GROWI アーカイブファイルをダウンロードした, the GROWI server shall 操作種別「ダウンロード」として利用回数を 1 加算する
4. When 管理者が GROWI アーカイブファイルのアップロードを完了した, the GROWI server shall 操作種別「アップロード」・結果「成功」として利用回数を 1 加算する
5. If GROWI アーカイブファイルのアップロードが失敗した, the GROWI server shall 操作種別「アップロード」・結果「失敗」として利用回数を 1 加算する
6. When アップロードされた GROWI アーカイブファイルのインポートが完了した, the GROWI server shall 操作種別「インポート」・結果「成功」として利用回数を 1 加算する
7. If アップロードされた GROWI アーカイブファイルのインポートが失敗した, the GROWI server shall 操作種別「インポート」・結果「失敗」として利用回数を 1 加算する
8. The GROWI server shall 監査ログの有効・無効およびアクショングループの設定にかかわらず、本 Requirement および Requirement 2 の記録を行う
9. The GROWI server shall 1 回の操作につき利用回数を 1 回だけ加算し、同じ操作を重複して加算しない
10. If GROWI アーカイブファイルのインポートが一部のデータを取り込めずに終了した, the GROWI server shall 管理画面にエラーとして通知される条件と同じ条件で、結果「失敗」として利用回数を 1 加算する
11. When 失敗した操作を管理者がやり直した, the GROWI server shall やり直しを独立した 1 回の操作として、その結果に応じて利用回数を加算する

### Requirement 2: お引越し（GROWI 間転送）の利用回数記録

**Objective:** As a WESEEK の GROWI 開発チーム, I want 各インスタンスでお引越し機能が送信側・受信側として何回使われたかを知りたい, so that お引越し機能の利用の有無と頻度を、移行元・移行先の双方から把握できる

#### Acceptance Criteria

1. When 移行元の GROWI でお引越しの転送処理が完了した, the GROWI server shall 役割「送信側」・結果「成功」として利用回数を 1 加算する
2. If 移行元の GROWI で開始したお引越しの転送処理が失敗した, the GROWI server shall 役割「送信側」・結果「失敗」として利用回数を 1 加算する
3. When 移行先の GROWI でお引越しにより受け取ったデータの取り込みが完了した, the GROWI server shall 役割「受信側」・結果「成功」として利用回数を 1 加算する
4. If 移行先の GROWI でお引越しにより受け取ったデータの取り込みが失敗した, the GROWI server shall 役割「受信側」・結果「失敗」として利用回数を 1 加算する
5. If お引越しの転送開始前の確認（転送先との接続確認・転送可否の判定）で中止された, the GROWI server shall 利用回数を加算しない
6. The GROWI server shall お引越しの利用回数を、データアーカイブ（Requirement 1）の利用回数と区別できる形で記録する
7. If お引越しの転送または取り込みが一部のデータを取り込めずに終了した, the GROWI server shall 管理画面にエラーとして通知される条件と同じ条件で、送信側・受信側それぞれ結果「失敗」として利用回数を 1 加算する
8. When 失敗したお引越しを管理者がやり直した, the GROWI server shall やり直しを独立した 1 回の転送として、その結果に応じて利用回数を加算する

### Requirement 3: 利用回数の送信と集計可能性

**Objective:** As a WESEEK の GROWI 開発チーム, I want 記録された利用回数が既存のテレメトリ送信に含まれて届くようにしたい, so that 受信側で利用インスタンス数・割合・頻度を集計できる

#### Acceptance Criteria

1. While OpenTelemetry による送信が有効である, the GROWI server shall Requirement 1・2 で記録した利用回数を、既存のメトリクス送信の周期で送信する
2. While OpenTelemetry による送信が無効である, the GROWI server shall 利用回数を送信しない
3. The GROWI server shall 受信側がインスタンスごとに任意の期間内の利用回数の増加分を算出できる形で、利用回数を送信する
4. The GROWI server shall 送信する利用回数に、操作種別（作成・ダウンロード・アップロード・インポート）、お引越しの役割（送信側・受信側）、結果（成功・失敗）を区別できる情報を付与する
5. If GROWI server のプロセスが再起動した, the GROWI server shall 利用回数を 0 から数え直し、受信側が再起動による数え直しを判別して増加分の算出を誤らない形で送信を再開する

### Requirement 4: プライバシーと既存動作への非干渉

**Objective:** As a GROWI を運用する管理者, I want 利用回数の送信によって機密情報が外部に出たり、データアーカイブやお引越しの動作が変わったりしないことを保証してほしい, so that 安心してテレメトリを有効にしておける

#### Acceptance Criteria

1. The GROWI server shall 利用回数に付与する情報を Requirement 3.4 の区別に限定し、ページ内容・ページパス・ユーザー名やユーザー ID・メールアドレス・ファイル名・コレクション名・転送先の URL を含めない
2. If 利用回数の記録または送信が失敗した, the GROWI server shall データアーカイブおよびお引越しの処理を中断せず、その結果を変えず、サーバーログにエラーを記録する
3. The GROWI server shall 利用回数の記録の有無によって、データアーカイブおよびお引越しの画面表示・応答内容・所要時間に利用者が認識できる差を生じさせない

### Requirement 5: イベント型メトリクスの追加手順の整備

**Objective:** As a GROWI に新しいテレメトリを追加する開発者, I want 状態値ではなく「発生回数」を数えるメトリクスの追加方法が既存の手順と同じ場所に定められていてほしい, so that 次にイベント型のメトリクスを追加するときに迷わず、境界を守って実装できる

#### Acceptance Criteria

1. The `opentelemetry` spec shall 状態値を観測するメトリクスに加えて、発生回数を数えるメトリクスの実装規約を Custom Metric の責務として定める
2. The `opentelemetry` spec shall テレメトリ機能の外にある機能のコードから発生回数を記録するときの手順と境界を、追加手順（Extension Templates）として定める
3. The `opentelemetry` spec shall 本 spec で追加したメトリクスを、Custom Metric が所有するメトリクスの一覧に含める
