# Research & Design Decisions

## Summary
- **Feature**: `i18n-key-audit`
- **Discovery Scope**: Extension（既存 CI パイプラインへの検出ステップ追加 + 実バグ2件の修正）。ただし採用ツール `i18next-cli` は公開1年未満の若いツールのため、ツール契約の検証は Full Discovery 相当（サンドボックス実行による実測）で行った。
- **Key Findings**:
  - brief が想定していたツールの使い方（`extract --ci --dry-run` で未使用キーを検出）は誤り。実際に未使用キー検出を担うのは `status --unused` であり、`extract` は既定で書き込む・削除するコマンドなので CI では一切使わない方針にした。
  - 実リポジトリに対する実測で、既定言語（en_US）で「コードから参照されているが存在しないキー」は 182 件検出されたが、詳細分類の結果、実際に「どの namespace ファイルにも存在しない」真の壊れた参照は 31 件（brief の 27 件という見積りに近い）。残り約 151 件は別カテゴリ（既知の Bug 2 系23件、および新たに見つかった「props 経由で渡される `t` 関数のため tool が namespace を追跡できない」151件中119件の見せかけの不在）。
  - 「props 経由の `t` 関数」「複数 namespace 配列 helper」問題は Requirement 4（動的キーの宣言）では扱えない。当初「検出対象から除外するアローリスト」を検討したが、それでは将来同じ経路に混入する本物の壊れた参照を検出できなくなる恒久的な盲点が残るという指摘を受けて撤回し、call site へ namespace を明示前置する書き換え（挙動を変えず検出可能にする）に変更した。新しい除外機構は作らない。

## Research Log

### i18next-cli のコマンド契約（brief の想定との相違）
- **Context**: brief は `status`（欠損検出）と `extract --ci --dry-run`（未使用キー検出）の2ステップ構成を想定していた。若いツールなので、実装前にこの契約を検証する必要があった。
- **Sources Consulted**: npm registry（`i18next-cli@1.69.0` の README・型定義）、サンドボックス実行（`npx i18next-cli --help` / `status --help` / `extract --help` / `sync --help`）、実際の入出力を伴う手動実験（2言語・1 namespace の最小プロジェクトを都度作成して実行）
- **Findings**:
  - `status`（引数なし）: 全 locale の翻訳進捗（絶対数・パーセント）と、既定言語で「コードにあるがキーが存在しない」件数を1回の実行でまとめて表示する。読み取り専用。問題があれば exit code 1。
  - `status --unused`: JSON にあってコードから参照されていないキーだけを読み取り専用で報告する専用フラグ。「ファイルは変更されません」と明記されており、見つかれば exit code 1。
  - `status <locale>`: 指定した1言語のキー単位の詳細（欠損・未翻訳を個別に列挙）。
  - `extract`: 既定で JSON ファイルを書き換える（コードにあるキーの追加、`removeUnusedKeys: true` の場合は未使用キーの削除も行う）。`--dry-run` を付けた場合のみ書き込まない。`--ci` は「このコマンドの実行結果としてファイルに変更が生じる場合に exit code 1」という意味であり、「未使用キーだけ」を意味しない。
  - `sync`: 2次言語ファイルを既定言語に同期するコマンドで、そもそも `--dry-run` 相当のオプションが無い（書き込み専用）。CI では使わない。
  - `preservePatterns`（`extract` 設定内）は `status` / `status --unused` にも効き、動的に構築されるキー（テンプレートリテラルの変数セグメント）を「未使用」判定・「欠損」判定の両方から正しく除外することをサンドボックスで確認済み。
    - **訂正（task 1.2 の実測、2026-08-20）**: この記述のうち「欠損」判定にも効くという部分は**誤り**だった。実リポジトリでの A/B 実測では、`preservePatterns` を追加しても `status` の「en_US に無いキー」は 182 件のまま（一覧も完全に一致）で、変わったのは `status --unused` だけ（3176 → 1992）である。欠損側の除外には別のフィールド `status.ignoreKeys` が必要で、これを足して初めて 182 → 176 になった（`i18next-cli` 1.71.0 の型定義 `node_modules/i18next-cli/types/types.d.ts` にも別々のフィールドとして定義されている）。Requirement 4.2 は Requirement 1（欠損）と Requirement 2（未使用）の両方からの除外を求めているので、**2つのフィールドの両方に宣言が必要**である。詳細は下記 Decision「動的キーの宣言は `preservePatterns` と `status.ignoreKeys` の2箇所に書く」を参照。
  - 設定ファイル名は `i18next.config.ts`（`i18next-cli.config.ts` ではない）。除外パターンは `extract.input` に `!` を前置しても無視される（サイレントに効かない、実際に踏んだ罠）。正しいフィールドは `extract.ignore`（別配列）。
  - `i18next-cli` は自分自身の `i18next`/`react-i18next` を devDependency として内包しており、ホスト側の `i18next ^23.16.5` / `react-i18next ^15.1.1` とバージョン競合しない。
  - ライセンスは MIT（GROWI と両立）。
  - JSON 等の機械可読出力オプションは存在しない（人間向けテキストのみ）。基準線比較のラッパーは stdout のテキストを正規表現で解析する必要がある。
- **Implications**:
  - CI の検出コマンドは `status`（既定言語の欠損参照＋言語間ドリフト）と `status --unused`（未使用キー）の2つだけで足り、`extract`・`sync` は一切呼ばない。Requirement 5（翻訳ファイルの不変性）は設計上「書き込み系コマンドを呼ばない」ことで機構的に満たされる。
  - stdout 解析に依存するため、バージョンを厳密固定し、パーサーの単体テストを持つ（後述リスク）。

### 実リポジトリでの実測（既定言語の欠損参照 182 件の内訳）
- **Context**: Requirement 1 の AC4 は「discovery で判明した27件を含め0件」と書かれているが、これはサンドボックスでの検証だけでは裏付けられない。実際のコードベースに対してツールを走らせて確かめる必要があった。
- **Sources Consulted**: `npx i18next-cli@1.69.0 status` / `status en_US --hide-translated` / `status --unused` を実際の `apps/app/src` と `public/static/locales` に対して実行（一時的な `i18next.config.ts` を作成して検証、検証後は削除）
- **Findings**:
  - 最初の実行では `extract.input` に `src/**/*.{ts,tsx,js,jsx}` を指定し、テストファイルを除外しなかったため、コメント中に書かれた説明用のコード例（`g2g-error-keys-locale-drift.spec.ts` の JSDoc コメント内 `` `t('admin:g2g:foo')` ``）まで実使用として誤検出された。`extract.ignore` で `*.spec.*` 等を除外して再実行し、この誤検出は解消した（ただし全体件数への影響は軽微、184→182件）。
  - 既定言語で「コードにあるが存在しない」182件を namespace ごとに分類し、さらに各キーが実際に他の namespace ファイルには存在するかを機械的に照合した結果:
    | 内訳 | 件数 | 実体 |
    |---|---|---|
    | どの namespace ファイルにも存在しない（真の Bug 1 類） | 31 | discovery の27件相当。ここに含まれる `common:failed_to_copy` は存在しない namespace `common` への参照という brief の旗艦例そのもの |
    | `translation.json` にのみ存在し、admin/commons 文脈から参照（既知の Bug 2） | 23 | discovery が独自に洗い出した「共有ラベル約20件」と、別の機械的スクリプトで再現した23件が完全一致 |
    | `admin.json` に実在するが、`translation` namespace の不在として報告される | 119 | 新たな発見。原因は下記 |
    | `commons.json` にのみ存在するが同様の理由で報告される | 5 | 上と同種の少数派 |
  - 119件（と5件）の原因を1件（`security_settings.max_age` / `SessionMaxAgeSettings.tsx`）で特定: この種のコンポーネントは `useTranslation()` を自分では呼ばず、親コンポーネントから **`t` 関数を props で受け取る**（`t: (key: string, options?: Record<string, unknown>) => string` という型のプロパティ）。`i18next-cli` の静的解析はファイル内の `useTranslation()` 呼び出しからしか namespace を追跡できないため、props 経由で渡された `t` の実際の namespace 束縛（親の `useTranslation(['admin', ...])`）を追跡できず、既定 namespace（`translation`）への参照として誤って分類する。実行時には親のフックが正しく `admin` を含むため、これらは高い確度で本物の不具合ではない。
  - 同種の誤検出パターンとして、`AdminNavigation.tsx`（`useTranslation(['admin', 'commons'])` を使い、21箇所の `t()` 呼び出しを持つ switch 文コンポーネント）由来のキーも一部含まれると当初記録したが、`/kiro-validate-design` 3回目のレビューで実際に `i18next-cli` にこのファイルと実際の `admin.json`/`commons.json` を通して確認したところ、21キーすべてが100%解決し誤検出は無かった。**この記述は誤りだった。** クライアント側の `useTranslation([ns1, ns2])` という配列指定は `i18next-cli` が正しく追跡できるパターンであり、Group 3 をサーバー側の `getTranslation({ ns: [...] })` だけに絞った design.md の判断（クライアント側の配列指定は対象外）を裏付ける結果である。
- **Implications**:
  - Requirement 1 の「27件」という数字は実測でおおむね裏付けられた（31件、+4件は discovery の見積り誤差として妥当な範囲）。ただし要件文に固定の件数を書き込むのは適切でない（後述の Design Decision）。
  - Requirement 7（Bug 2）の対象範囲「共有ラベル約20件」は実測でも23件で裏付けられ、大きく拡大する必要はない。
  - 一方で「props 経由の `t`」による119+5件の誤検出は、Requirement 4（動的キーの宣言）が想定する原因（キーが実行時に動的に構築される）とは別物であり、新しい除外の軸が要件として必要になる。これは design.md で対処するのではなく、requirements.md に一段上げて記録する。

### 調査を打ち切った理由
- 179件全部の個別フォレンジックは、サードパーティ製ツールの内部ヒューリスティックを完全解明する労力に対して得られる設計上の価値が小さいと判断し、「namespace ファイルに実在するか」という製品的に意味のある軸での分類（上表）が取れた時点で打ち切った。`AdminNavigation.tsx` の switch 文内での挙動の詳細な原因究明は行っていない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `status` + `status --unused` のみ（採用） | 読み取り専用の2コマンドだけを CI から呼ぶ | Requirement 5（不変性）を機構的に満たす。書き込み系コマンドを呼ぶ経路が存在しないため、将来の変更でも安全 | stdout のテキスト解析が必要（JSON 出力が無い） | brief の想定（`extract --ci --dry-run`）から変更 |
| `extract --ci --dry-run` を未使用キー検出に使う（brief の原案、不採用） | brief が最初に想定していた構成 | 追加設定が要らない | 実際は「抽出した結果ファイルが変わるか」を見るコマンドで、未使用キー専用ではない。かつ `--dry-run` を忘れると本番相当で書き込みが発生する経路が常に存在する | 実測で `--unused` の方が意図に一致すると判明 |

## Design Decisions

### Decision: 未使用キー検出は `extract --ci --dry-run` ではなく `status --unused` を使う
- **Context**: brief は `extract --ci --dry-run` を未使用キー検出の手段として想定していた
- **Alternatives Considered**:
  1. `extract --ci --dry-run` — brief の原案
  2. `status --unused` — 実測で確認した、意図に一致する専用コマンド
- **Selected Approach**: `status --unused` のみを使う。`extract`/`sync` は CI から一度も呼ばない
- **Rationale**: `status --unused` は名前通り未使用キーだけを読み取り専用で報告し、`extract` が持つ「既定で書き込む」危険性を構造的に排除できる
- **Trade-offs**: brief の想定より1コマンド少ない、シンプルな構成になった。デメリットは無い
- **Follow-up**: なし

### Decision: 既定言語の「存在しないキー参照」ゼロ件化の対象は、namespace ファイルへの実在チェックで判定する
- **Context**: `status`（既定言語チェック）の生の報告件数（182件）は、大部分が「別の namespace ファイルには実在する」誤検出（namespace 追跡の限界）であり、そのまま「0件」を目指すと本物のバグではないものまで潰しにいく作業になる
- **Alternatives Considered**:
  1. ツールの生の報告件数をそのまま0件化の対象にする — 誤検出も含めて全部「解消」しようとすることになり、本来不要な作業（コンポーネントの構造変更）を要求してしまう
  2. 「3つの namespace ファイルのどこにも実在しないキー」だけを0件化の対象にし、それ以外（他の namespace には実在する）は別の除外機構で扱う — 採用
- **Selected Approach**: 2を採用。Requirement 1 の対象は「3 namespace のどこにも存在しない」ケースに絞る
- **Rationale**: 実測で「どこにも存在しない」ケースは31件で discovery の27件と近い値であり、これが本来の Bug 1 の実体に近い。119+5件の「他の namespace には実在する」ケースは Bug 2 か、`t` の props 経由渡しによる検出限界であり、ゼロ件化の対象としては不適切
- **Trade-offs**: 「他の namespace には実在するが誤った namespace から参照されている」ケースを検出から除外する分だけ、検出の網は狭くなる。ただしこの分類は Requirement 7（Bug 2）または新設する除外機構でカバーする
- **Follow-up**: 解決済み。下記「props 経由の `t` / 複数 namespace helper の誤検出は、除外機構でなく call site の書き換えで解消する」を参照

### Decision: 「props 経由の `t`」「複数 namespace 配列の helper」による誤検出は、除外機構（アローリスト）ではなく call site への明示 namespace 前置で解消する
- **Context**: 上記の119+5件の誤検出は、当初「この2パターンを信頼済みとして検出対象から除外する」で解消する方針を提案した。しかしユーザーから「その除外は、今後この経路に本当に存在しないキー参照が混入しても二度と検出できなくなる、恒久的な検出の盲点を作らないか」という指摘を受けた。指摘は正しく、当初案は Requirement 1 の趣旨（検出の網を狭めない）と矛盾する
- **Alternatives Considered**:
  1. グループ2（`createAdminPageLayout` の title callback、19ファイル）とグループ3（`getTranslation({ ns: [...] })` を使うサーバー側、代表例 `saml.ts`）を、パターンとして検出対象から除外するアローリストを新設する — 当初案。実装は軽いが、将来同じ経路に typo が入っても検出できない恒久的な盲点になる。かつアローリストという新しい維持対象が増える
  2. 各 call site のキー文字列に namespace を明示前置する（`t('user_group_management...')` → `t('admin:user_group_management...')`）— 採用。サンドボックス実測で、`t` を props 経由で受け取るコンポーネントでも `t('admin:menu_title')` という明示前置であれば `i18next-cli status` が正しく解決し、誤検出が消えることを確認した（namespace の判定は文字列そのものから行われ、`t` の出自を追跡する必要が無いため）
- **Selected Approach**: 2 を採用。新しい除外機構は作らない
- **Rationale**: 前置は既存の実行時解決（グループ2は `useTranslation('admin')` に、グループ3は既に `admin` namespace で解決している大半のキーに）と一致させるだけの書き換えであり、挙動を変えずに検出可能にできる。アローリストのような「宣言し忘れると誤検出が積み重なる／盲点が残る」新しい維持対象を増やさずに済む
- **Trade-offs**: 26ファイル程度（グループ1の hook 化7件＋グループ2の前置19件＋グループ3の前置N件）の call site 書き換えが必要になる。かつ以下2点の回帰リスクがある（詳細は Risks & Mitigations）:
  - グループ1（prop 経由の `t` を自前の `useTranslation()` に置き換える）: 親が実際にどの namespace で `t` を束縛していたかを確認しないまま書き換えると、既定 namespace（`translation`）に紐づいてしまい、今まで表示できていたラベルが表示できなくなる
  - グループ3（`ns: ['translation', 'admin']` のような複数 namespace 配列に前置を加える）: 今は「先に試した namespace が優先」というフォールバック順で解決している。あるキーが両方の namespace に存在する場合、前置によって採用される値が変わる可能性がある
- **Follow-up**: 書き換え対象の各キーについて、書き換え前後で実際に解決される翻訳文言が変わらないことを確認する検証手順を design.md のテスト戦略に含める（Requirement 1 AC5・AC6 として要件化済み）

## Risks & Mitigations
- **stdout のテキスト解析が壊れる** — `i18next-cli` のバージョンアップで出力フォーマットが変わると、基準線比較の正規表現が壊れて誤って0を返す可能性がある。ミティゲーション: バージョンを`^`なしで固定し、既知の出力サンプルに対するパーサーの単体テストを持ち、パースに失敗したら「失敗」として扱う（0扱いにしない）
- **グループ1（prop 経由の `t` を自前の `useTranslation()` に置き換える）で namespace を取り違える** — 親コンポーネントが実際にどの namespace で `t` を束縛していたかを確認せずに置き換えると、既定 namespace（`translation`）に紐づいてしまい、今まで表示できていたラベルが表示できなくなる。ミティゲーション: 置き換え前に親の `useTranslation()` の namespace を確認し、書き換え前後で実際に解決される翻訳文言を比較する（信頼して進めるのではなく、値の一致を確認する）
- **グループ3（`ns: ['translation', 'admin']` 等の複数 namespace 配列に前置を加える）でフォールバック順が変わる** — 前置無しでは「先に試した namespace が優先」という順で解決している。あるキーが両方の namespace に存在する場合、前置によって採用される値が変わりうる。ミティゲーション: 前置対象の各キーについて、両方の namespace ファイルに重複が無いことを機械的に確認してから書き換える
- **Bug 2 の重複修正がドリフトの盲点になる**（`commons.json` に複製する場合、`translation.json` 側の値を更新し忘れると2つの値が食い違う）— ミティゲーション: 複製した約23件のペアが全5言語で一致することを検証する専用テストを設ける

### Decision: `/kiro-validate-design` の指摘を受け、Bug 2 の方式を「移動」から「複製」に戻す
- **Context**: design.md の初版では、共有ラベル約20〜23件を `translation.json` から削除して `commons.json` へ移動する方式を採った。ところがこの方式は、本セクション冒頭の「未使用キー182件の内訳」調査より前、brief.md 起草時点で既に検討されていた「複製」案（`translation.json` は変更せず `commons.json` に複製する）から外れており、上記 Risks & Mitigations の「Bug 2 の重複修正がドリフトの盲点になる」という記述は複製案を前提に書かれていた。design.md 執筆時にこの前提を踏襲せず「移動」を選んだのは、他言語版から見て取り違えたためで、意図的な変更ではない
- **Sources Consulted**: サブエージェントによる `/kiro-validate-design i18n-key-audit` の実行（Critical Issue 1）。指摘を受けて `apps/app/src` を実際に grep し、`Cancel`/`Close`/`Created`/`Name`/`Email`/`Update`/`Edit`/`Create`/`add` の少なくとも9キーが、discovery で数えた管理画面43コンポーネント以外に、`Me`/`PageEditor`/`LoginForm`/`InstallerForm`/`external-user-group` 配下など約25ファイルから、namespace 指定無し（既定の `translation`）で参照されていることを確認した
- **Alternatives Considered**:
  1. 移動（design.md 初版）— 管理画面外の約25ファイル（および未確認の残りキーの消費者）を新たに壊す
  2. 複製（brief.md 時点の想定に戻す）— `translation.json` は変更しないため、管理画面外の消費者は無傷。複製ペアのドリフトは専用テストで検知する
- **Selected Approach**: 2（複製）を採用
- **Rationale**: 「移動」が要求する「リポジトリ全体から消費者を洗い出す」という未調査タスクを無くせる。複製という単一の真実源からの逸脱は、対象が約20〜23件と限定されており、かつこのリポジトリには `i18n-reconcile.spec.ts` という同種の前例が既にある
- **Trade-offs**: 2ファイルの同期維持という保守コストが継続的に発生する。専用テストでドリフトを機械的に検知することで軽減する
- **Follow-up**: なし。design.md に反映済み

### Decision: baseline 更新に改悪方向への書き込みガードを追加する
- **Context**: `/kiro-validate-design` の Critical Issue 2 で、`--update-baseline` が改悪方向（悪化した測定値）でもそのまま上書きできてしまう点を指摘された。「PRのdiffでレビュアーが気づく」という当初の安全策は、数値1〜2個の変化がレビュー時に見落とされやすいという理由で不十分と判断された
- **Selected Approach**: `--update-baseline` は測定値が既存の基準線より大きい場合は既定で拒否し、`--allow-regression` を明示的に渡した場合のみ許可する。実行時は常に増減を標準出力に明示する
- **Rationale**: レビュアーの見落としに依存せず、「基準線は改善方向にしか動かせない」という要件2.5/3.5の意図をツール自身が機構的に守る
- **Follow-up**: なし。design.md の Baseline Store に反映済み

### Decision: `g2g-error-keys-locale-drift.spec.ts` は全削除ではなく縮小する
- **Context**: `/kiro-validate-design` の Critical Issue 3 で、このテストが「`admin:g2g:*` キーが en_US に実在すること」（新ゲートと重複）と「`KEYS_WITH_DETAIL_MESSAGE` がパーサー側の発生キー集合からはみ出していないこと」（翻訳ファイルとは無関係な、アプリケーション内部の整合性チェック）という性質の異なる2つの検査を持つことが指摘された。実ファイルを読んで確認し、指摘が正しいことを確認した
- **Selected Approach**: 前者の検査（新ゲートと重複する部分）だけを削除し、後者（`KEYS_WITH_DETAIL_MESSAGE` の整合性チェック）は維持する
- **Rationale**: ファイル単位で全部削除か全部維持かの二択ではなく、要件8.2が想定する「重複しない部分は維持する」という粒度で判断する
- **Follow-up**: なし。design.md の Existing Spec Disposition に反映済み

### Decision: baseline.json の初回作成手順と、言語未記録時の扱いを明文化する
- **Context**: `/kiro-validate-design` の2回目のレビュー（回帰リスクを重点的に検証する回として実施）で、Error Handling 節の「基準線ファイルが読めない場合は即座に失敗する」という記述と、Baseline Store 節の「悪化防止ガード」が、baseline.json をまだ作っていない最初の実行（本機能の初回導入時）にどちらが優先されるのか矛盾していると指摘された。同時に、`missingByLocale` にまだ記録が無い言語をどう扱うか（0件扱いか、無条件合格か）も未規定だった
- **Sources Consulted**: サブエージェントによる `/kiro-validate-design i18n-key-audit` 2回目の実行。実際のコード（`SecuritySetting/index.tsx`、`saml.ts`、`i18n-reconcile.spec.ts`、`g2g-error-keys-locale-drift.spec.ts`、`getServerSideAdminCommonProps`）を読み直し、1回目の3件の修正が正しく機能することも合わせて再確認済み
- **Selected Approach**: `--update-baseline` はファイル未存在時のみ悪化防止ガードの対象外とし、基準線0件からの更新として書き込みを許可する。`missingByLocale` に言語が無い場合は基準線0件として扱う（無条件合格にはしない）
- **Rationale**: 前者は初回導入という一度きりの状況を明示的な例外として切り出すことで、通常実行時の「読めなければ即座に失敗」という原則を壊さない。後者は要件3.2の「提供時点で言語ごとに集計した件数を基準線とする」という原則を、後から言語を追加した場合にも一貫させる
- **Follow-up**: なし。design.md の Baseline Store・Error Handling に反映済み

### Decision: Group 2（`createAdminPageLayout` 前置対象19ファイル）の除外4ファイルを明記する
- **Context**: `/kiro-validate-design` 2回目のレビューで、`createAdminPageLayout` を使うファイルは実際には23個あり、design.md の「19ファイル」という数字がどの4ファイルを除外した結果なのか記述が無いと指摘された
- **Sources Consulted**: `grep -rl 'createAdminPageLayout' pages/admin/` で23ファイルを確認し、うち `[...path].page.tsx` / `vault.page.tsx` の2個は `title` がキー参照を持たない固定文字列、`app.page.tsx` / `data-transfer.page.tsx` の2個は既に `t(key, { ns: 'commons' })` という options 引数形式で namespace を明示済みであることを実際に読んで確認した。さらに、この options 引数形式が `ns:key` という文字列前置と同様に `i18next-cli` の静的解析から正しく認識されることをサンドボックスで確認した（`t('menu_title', { ns: 'admin' })` が missing 0件・100%で解決）
- **Selected Approach**: design.md に4ファイルの名前と除外理由を明記し、23−4=19という数字の出典を明示する
- **Rationale**: 実装時にパターン検索だけで対象ファイルを洗い出し直すと、この4ファイル（特に options 引数形式の2ファイル）を誤って書き換え対象に含めてしまうリスクを防ぐ
- **Follow-up**: なし。design.md の Call-site Remediation Group 2 に反映済み

### Decision: 「31件の真の Bug 1」を修正する担当コンポーネントを design.md に追加する
- **Context**: `/kiro-validate-design` 3回目のレビュー（回帰リスクを重点的に検証する回として実施）で、design.md の Components が「119+5件の誤検出」（Call-site Remediation）と「共有ラベル約20〜23件」（Bug 2 Remediation）しか担当しておらず、要件1.4が名前まで挙げて0件化を約束している「本当に存在しない31件のキー参照」を直す担当が丸ごと欠けていると指摘された
- **Sources Consulted**: 指摘を受けて実際にコードと翻訳ファイルを確認した。`common:failed_to_copy`（`GuideRow.tsx`、`TextStyleTab.tsx`）は `common` という namespace ファイル自体が存在せず `commons.json`/`translation.json` にも `failed_to_copy` は無い。`fix_page_grant.modal.alert_message`（`FixPageGrantModal.tsx`）は存在しない。当初は同じ `fix_page_grant.modal` 配下の `need_to_fix_grant` を修正先としたが、これは誤りだった（次項の Decision 参照）。`Successfully updated`/`Failed to update`（同ファイル）は `translation.json` に該当キーが無く、意味の一致する既存キーも見つからなかった
- **Selected Approach**: 「Non-Existent Key Reference Fix」という新しい Component を design.md に追加する。修正はキーごとに「既存キーへの参照修正」（翻訳ファイル変更なし、基準線に影響しない）か「新規キー追加」（5言語すべてに同時追加、追加が終わるまで基準線を記録しない）のいずれかで行う。3つの具体例の disposition は上記の実測結果どおりに確定させた
- **Rationale**: 要件1.4が個別のキー名まで挙げて約束している内容である以上、design.md のどこかにその修正を担当する記述が無ければ実装可能な設計とは言えない。「新規キー追加」と「基準線を記録するタイミング」を明確に結びつけたのは、この機能の導入自身が iteration 1/2 で追加した悪化防止ガードに引っかかるという具体的な詰みシナリオが実測で見えたため
- **Follow-up**: 残り28件の call site の完全な一覧は `/kiro-spec-tasks` 実行時に、本セクション「既定言語の欠損参照182件の内訳」で使った実在チェックの手順を再実行して確定させる

### Decision: `fix_page_grant.modal.alert_message` の修正先を `need_to_fix_grant` から `alert_message_select_group` へ訂正する
- **Context**: `/kiro-validate-design` 4回目のレビューで、iteration 3 が確定させた修正先 `need_to_fix_grant` が、実際の表示条件と食い違っていると指摘された
- **Sources Consulted**: `FixPageGrantModal.tsx` を実際に読んだ。`need_to_fix_grant` は192行目で常時表示される案内文として既に使用中。`alert_message` は269〜272行で `shouldShowModalAlert` が true のときだけ表示され、この state は69〜73行の `submit` 関数内で「グループ指定を選んだのに1つも選ばず送信した」場合にのみ true になる、入力エラー専用の警告だった。`translation.json` の893行に、まさにこの内容の `alert_message_select_group`（「選択されたグループがありません」）が既に存在し、現在どこからも参照されていない（未使用キーの一部）ことも確認した
- **Selected Approach**: 修正先を `alert_message_select_group` に変更する
- **Rationale**: `need_to_fix_grant` に差し替えると、常時表示の案内文が警告枠の中に重複表示されるだけで、「グループが選択されていません」という本来伝えるべき入力エラーが利用者に伝わらない。生キー表示という分かりやすい不具合を、意味の合わない文言という分かりにくい不具合に置き換えてしまう。`alert_message_select_group` は意味が完全に一致し、かつ未使用キーが1件減る副次効果もある
- **Follow-up**: なし。design.md の Non-Existent Key Reference Fix と File Structure Plan に反映済み

### Decision: 新規追加キーの5言語存在確認を、基準線記録前の実行可能なチェックポイントにする
- **Context**: `/kiro-validate-design` 4回目のレビューで、「新規キー追加がすべて終わってから基準線を記録する」という順序ルールが、design.md の文章上の注意書きだけで、実装が守らなくても検知できない状態だと指摘された
- **Selected Approach**: Non-Existent Key Reference Fix が新規追加するキーについて、5言語すべてに値が存在し空でないことを検証する専用テストを Testing Strategy に追加する。このテストが緑であることを、`--update-baseline` を初めて実行する前提条件として運用する
- **Rationale**: 「注意書きを守る」という運用上の期待に頼らず、「テストが通っているか」という機械的に確認できる状態にする。Bug 2 Remediation の複製ペア同期テストと同じ考え方の再利用であり、新しい仕組みを増やしていない
- **Follow-up**: なし。design.md の Testing Strategy に反映済み

### Decision: 新規キー追加時は call site の書き換えも明記する
- **Context**: `/kiro-validate-design` 5回目のレビューで、`common:failed_to_copy` の直し方が「新しいキーを追加する」としか書かれておらず、`GuideRow.tsx`/`TextStyleTab.tsx` の呼び出し文字列自体を新しいキー名に書き換えるという一文が無いと指摘された。要件1にはRequirement 2/3のような基準線による救済が無いため、この記載漏れをそのまま実装すると `t('common:failed_to_copy')` という存在しない参照がゼロ件化されずに残ってしまう
- **Selected Approach**: design.md に「新規キー追加時は call site の呼び出し文字列も新しいキー名に書き換える」ことを明記し、`common:failed_to_copy` → `editor_guide.textstyle.copy_failed` への書き換えを具体的に記述する。`Successfully updated`/`Failed to update` のように、追加するキー名が呼び出し文字列と一致する場合は書き換え不要であることも区別して明記する
- **Follow-up**: なし。design.md の Non-Existent Key Reference Fix に反映済み

### Decision: Group 2 の対象範囲の書き方を、サブディレクトリを含む再帰的な対象だと明記する
- **Context**: `/kiro-validate-design` 5回目のレビューで、File Structure Plan の「`apps/app/src/pages/admin/*.page.tsx`」という書き方が、`global-notification/`・`user-group-detail/`・`users/` などサブディレクトリ配下の5ファイルを取り落とすと指摘された。件数（19ファイル）自体は正しく、Components 側の記述（23ファイル・4件除外の内訳）とも一致していたが、File Structure Plan の glob 表記だけが不正確だった
- **Sources Consulted**: `grep -rl 'createAdminPageLayout' apps/app/src/pages/admin --include='*.page.tsx'` で23ファイルを再確認し、うち5ファイルがサブディレクトリ配下にあることを確認した
- **Selected Approach**: File Structure Plan の記述を「`pages/admin/` 以下（サブディレクトリを含む、再帰的な対象）」に直し、取り落とされていた5ファイルの名前を明記する
- **Follow-up**: なし。design.md の Modified Files に反映済み

### Decision: `g2g-error-keys-locale-drift.spec.ts` は縮小せず全面維持する（iteration 1/3 の「縮小」判断を撤回）
- **Context**: `/kiro-validate-design` 6回目のレビューで、「`admin:g2g:*` キーが en_US に実在することを確認する検査は、新設ゲートが同じ範囲を完全にカバーするため削除できる」という iteration 1・3 の判断の前提そのものが誤りだと指摘された
- **Sources Consulted**: `server/service/g2g-transfer.ts` を実際に読み、`admin:g2g:*` というキー文字列が `t()` の固定引数としては一度も書かれておらず、ソケット通信で送るデータの値（`key: 'admin:g2g:error_data_conflict'` 等）として埋め込まれていることを確認した。翻訳する側の唯一の呼び出しはクライアント側 `G2GDataTransfer.tsx` の `t(key)` で、`key` は実行時の変数であり、コード中に固定文字列として現れない
- **Selected Approach**: `g2g-error-keys-locale-drift.spec.ts` の2つの検査（en_US への実在確認、`KEYS_WITH_DETAIL_MESSAGE` の整合性確認）を両方維持する。ファイルは変更しない
- **Rationale**: 新設ゲート（`i18next-cli`）はコード中の `t('固定文字列')` という形しか静的に追跡できない。今回のキーはこの形で一度も書かれていないため、そもそも新設ゲートの検査対象に入らない。Requirement 4 の `preservePatterns` に宣言しても「誤検出として報告しない」という除外設定にしかならず、「翻訳ファイルに実在する」ことを確認する仕組みにはならない。したがって既存テストのこの部分を削除すると、新しいエラーキーが追加されたのに翻訳が用意されていない、という不具合（このテストのコメントが記録している `error_upload_attachment` の実例）を検知する手段が丸ごと失われる
- **Trade-offs**: 手書きテストを1本、要件8が期待する「重複整理」の対象から外すことになるが、これは「重複が無いから維持する」という要件8.2の趣旨そのものであり、要件からの逸脱ではない
- **Follow-up**: なし。design.md の Existing Spec Disposition・Modified Files に反映済み

### 追加検証: 変数だけの `t(key)` 呼び出しが `i18next-cli` から正しく無視されることの実測
- **Context**: `/kiro-validate-design` 7回目のレビューで、g2gのドリフトテスト全面維持（前項の Decision）の前提である「固定部分すら無い、変数一つだけの `t(key)` という呼び出しは新設ゲートから見えない」という主張が、それまでのサンドボックス検証（テンプレートリテラルの変数セグメントの扱い）では直接確認されていないと指摘された
- **Sources Consulted**: サンドボックスで `t(key)`（`key` は関数引数の変数）と `t('real_key_one')`（固定文字列）を両方含むファイルに `i18next-cli status` を実行
- **Findings**: 検出されたキーは固定文字列の1件のみ。変数だけの呼び出しは、存在しないキーとして誤って報告されることも、`"key"` という見せかけのキーが作られることも無く、単純に無視された
- **Implications**: g2gのドリフトテスト全面維持の判断（前項）は、コードの構造面の確認だけでなくツールの実際の挙動としても裏付けられた

### Decision: 動的キーの宣言は `preservePatterns` と `status.ignoreKeys` の2箇所に書く
- **Context**: task 1.2 で実際に `i18next.config.ts` に動的キーを宣言してみたところ、`status --unused` の件数は大きく減ったのに、`status`（存在しないキー参照）の件数と一覧がまったく変わらなかった。research.md 22行目の「`preservePatterns` は欠損判定にも効く」というサンドボックスでの結論は、実リポジトリでは再現しなかった（上記の訂正を参照）
- **Sources Consulted**: `apps/app` に対する A/B 実測（宣言の前後で `status` / `status --unused` を実行）。`i18next-cli` 1.71.0 の型定義 `node_modules/i18next-cli/types/types.d.ts`（`extract.preservePatterns` と `status.ignoreKeys` は別のフィールド）。README の記述（前者は「extract の削除対象から残す」機能、後者は「`status` が報告しないキー」の機能）
- **Alternatives Considered**:
  1. `preservePatterns` だけで両方の要件を満たす（design.md 初版の前提）— 実測で成り立たないことが判明した
  2. `status.ignoreKeys` を設計に加え、両方に宣言する — 採用
- **Selected Approach**: 2。`status.ignoreKeys` を design.md の Technology Stack / Boundary Commitments / Requirements Traceability に一級の構成要素として書き、`i18next.config.ts` のコメントにも「どちらの報告に効くか」を残す
- **Rationale**: Requirement 4.2 は Requirement 1 と Requirement 2 の両方からの除外を求めており、`preservePatterns` だけでは Requirement 2 しか満たせない。この一手が無いと Requirement 1 の「0件」に到達する道が無い
- **Trade-offs**: 宣言する場所が2つに増え、編集者が「どちらに書くか」を知っている必要がある。design.md の Revalidation Triggers にその判断の仕方を書いて軽減した
- **Follow-up**: なし。`i18next.config.ts` には task 1.2 で実装済み

### Decision: 宣言はワイルドカードではなく具体キーの列挙を既定とする（同じ接頭辞に静的呼び出しが混ざる場合）
- **Context**: 宣言した13のキーファミリのうち3つ（`editor_guide.decoration.*_text`、`admin:security_settings.form_item_name.*`、`page_edit.paste.*`）は、同じ接頭辞を静的な `t('…')` 呼び出しと共有していた
- **Sources Consulted**: 実測。`page_edit.paste.title` を JSON 側で `titleXX` に書き換えたとき、ワイルドカードのままだと未使用件数は 1992 のままで気づけず、具体キーの列挙にすると 1993 に増えて報告された。`status.ignoreKeys` 側でも同じ確認を `alert_with_custom_title_text` について行い、ワイルドカードでは 176 のまま、列挙では 177 に増えて報告されることを確かめた
- **Selected Approach**: 同じ接頭辞に静的呼び出しが混ざるファミリは具体キーを列挙する。変わる部分の取りうる値がこのファイルの外（保存済みの値、スコープ id、設定されたアップローダ種別など）で決まり将来増えうるファミリは、ワイルドカードのままにする（13ファミリのうち10）
- **Rationale**: ワイルドカードは、あとでキー名を打ち間違えたり存在しないキーに書き換えたりしても監査が永久に気づけない死角を作る。これは Requirement 1 AC5 が禁じている状態そのものである
- **Follow-up**: なし。判断の仕方を design.md の Revalidation Triggers に残した

### Decision: task 1.2 の実測に合わせて、担当が決まっていなかった報告をすべて受け皿のあるタスクに割り当てる
- **Context**: task 1.2 は design.md の前提を実測で確かめ直し、複数のずれを報告した。うち3点は「どのタスクも担当していない報告」であり、実装に入る前に受け皿を決める必要があった: (a) 分類 C の 119 件のうち 62 件が Group 1 / 2 / 3 のどのファイルからも参照されていない、(b) 既存のどの分類にも入らない15件（E 5件 / F 4件 / G 2件 / H 4件）、(c) `preservePatterns` だけでは Requirement 1 側の除外ができない（上記の別 Decision）
- **Sources Consulted**: `apps/app/tools/i18n-audit/task-1.2-findings.md`（task 1.2 の成果物、実測の一次記録）。加えて本改訂で検算として、`npx i18next-cli status en_US --hide-translated` の報告176件それぞれについて、リポジトリ全体から静的な call site を洗い出し、Group 1 / 2 / 3 に属するかで振り分け直した
- **Findings（本改訂の検算で新たに分かったこと）**:
  - 「Group 1 / 2 / 3 のどこからも参照されていない」件数は 62 で、findings.md の実測と一致した（検算の途中で `slack-integration` を含むパスを誤って除外し 64 と出たが、除外を直すと 62 になった）
  - その 62 件の報告元は、**61 件が `t` を props で受け取る12ファイル**、**残り1件（`security_settings.updated_general_security_setting`）は `Me/AssociateModal.tsx` / `Me/DisassociateModal.tsx` の2ファイルだけ**だった。この 61 / 1 の切り分けは findings.md には無い情報で、Group 1b と Group 4 を別のタスクに分ける根拠になっている
  - Me の2ファイルは自分で `useTranslation()`（引数なし）を呼んでおり、キーは `admin.json` にしか無いため、**実行時にも生キーが表示される実在の不具合**である。E の5キーも同様に、`commons.json` にしか無いキーを既定 namespace のまま参照しているため実行時に生キーになる（`en_US/translation.json` に `Show` / `Hide` / `New` / `not_found_page` が無いことを確認済み）
- **Alternatives Considered**:
  1. 62件の受け皿として Group 1（hook 化）の対象ファイル一覧を12ファイル分増やす — `StatusTable.jsx` が `React.PureComponent` を継承した class component で hook を呼べず、関数コンポーネントへの書き換えという、検出のために必要な変更量を大きく超える作業になる
  2. 12ファイルは Group 2 と同じ「キー文字列への `admin:` 前置」で直し、Group 1b として別タスクにする — 採用
- **Selected Approach**: 2。あわせて、15件の内訳ごとに受け皿を決めた:
  - E（5キー / 9ファイル）と Me の2ファイル（1キー）→ 新しい Group 4（明示 namespace の前置）。実行時の不具合も同時に直る
  - F（4キー / 2ファイル、区切り `:` の重ね書き）→ 新しい Group 5（区切りを `.` に直す）。`g2g-error-keys-locale-drift.spec.ts` がキーを抽出しているのは `server/service/g2g-transfer.ts` だけで、書き換える `G2GDataTransfer.tsx` は読んでいないため、「既存テスト2本は変更しない」という結論と両立する（実ファイルを読んで確認した）。`status.ignoreKeys` で隠す案は採らなかった。区切りを直せば報告も実行時の解決も両方成り立つのに、除外だけで済ませると死角が残るため
  - G の `LikeButtons.tsx`（`No users have liked this yet.`）→ 真の Bug 1 の一覧に畳む（参照修正）。ja_JP などで英語が表示される実在の不具合
  - G の `GROWI.5.0_new_schema` と H の4キー → `status.ignoreKeys` に具体キーとして列挙（新タスク 3.3）
- **Rationale**: Requirement 1 の「0件」は生の報告件数に対する条件なので、実行時に壊れていない報告も含めて1件残らず受け皿が必要になる。除外で済ませるのは「直せば報告も実行時も良くなる」経路が無い場合に限り、その場合もワイルドカードを使わず具体キーだけを列挙して死角を最小にする
- **Trade-offs**: タスクが3本増える（3.3 / 4.2 / 4.3 / 4.4 のうち 4.1 以外の3本＋3.3 で計4本）。ただしいずれも独立して並列実行でき、依存は 1.2 だけである
- **Follow-up**: 下記「複数形形式の移行」を別作業として記録した

### Decision: 真の Bug 1 の件数は 25 件とする（research.md の「31件」からの粒度変更）
- **Context**: research.md は 31 件、task 1.2 は 24 件と数えていた。同じ対象を数えているのに数字が違う
- **Sources Consulted**: `task-1.2-findings.md` §0 / §1 / §5。task 1.2 は research.md が行っていなかった3種類の照合（`:` を `.` に置換した形での実在確認、キー名に `.` を literal で含む形での実在確認、複数形サフィックスを外した形での実在確認）を追加し、疑わしいものは i18next を実際に `init()` して `t()` の戻り値まで確認している
- **Selected Approach**: 24 件（`status` が数えるキー単位。call site は26箇所）に、`LikeButtons.tsx` の `No users have liked this yet.` 1件を加えた **25 件**を design.md / tasks.md の確定値とする
- **Rationale**: research.md の 31 は、この24件に「実行時には正しく解決されるが CLI が解決できないだけ」の7件を足した数である。件数が減ったのではなく分類の粒度が変わった。照合が細かい後者を採る
- **Trade-offs**: requirements.md の Requirement 1 AC4 が「31件」という固定の数字を持っていたため、この数字を落として「discovery および実測で判明した、どの namespace ファイルにも存在しないキー参照」という書き方に直した。上記「実リポジトリでの実測」節の Implications が既に「要件文に固定の件数を書き込むのは適切でない」と記録しており、その方針の踏襲である
- **Follow-up**: なし

### Decision: Bug 2 の確定値は 20キー / 36コンポーネントとし、`Done` 1件は実装時の確認事項として残す
- **Context**: design.md 初版は「約20〜23件 / 約43コンポーネント」と書いていた。task 1.2 の実測では、対象の共有ラベルは23件、そのうち `commons.json` に既に値がある3件を除いた複製対象が20件、参照している管理画面コンポーネントは36ファイルだった
- **Sources Consulted**: `task-1.2-findings.md` §2（23件のキー一覧、`commons.json` 既存3件の内訳、36ファイルの一覧）。43との差は数え方の違い（call site 数、または `admin.json` にも実在するキーを含めた数え方）で、7ファイルの取りこぼしではないと同ファイルが記録している
- **Selected Approach**: design.md / tasks.md の確定値を 20キー / 36コンポーネントにする
- **未決として残した1件**: 本改訂の検算で、`Done`（`en_US/translation.json` に実在し `commons.json` には無い。`Admin/Users/PasswordResetModal.jsx:67` が `t('commons:Done')` として呼んでいる）が23件と同じ条件を満たすのに task 1.2 の一覧に入っていないことが分かった。`status` の報告（commons namespace の欠損として `Done` が挙がっている）には現れているので、task 1.2 の 182 / 176 の分類自体は崩れておらず、抜けているのは「複製する23件」の洗い出しの側だけである。**件数を独断で 21 に書き換えることはせず**、tasks.md 7.1 に「1.2 と同じ洗い出し手順を再実行して `Done` を含めるか確認する」という手順を足し、design.md にも未確定の追加候補として明記した。最終的に含めるかどうかは実装時の確認結果（または人の判断）で決める
- **Follow-up**: 上記の確認を 7.1 で行う

### Follow-up（本 spec の対象外として記録）: 複数形形式を i18next v4 に移行する
- `translation.json` の `page_page.notice.stale` は `stale` と `stale_plural` を持つ。`stale_plural` は i18next v3 時代の書き方で、v4（GROWI の既定）では読まれないため、英語の複数形が崩れている（`count: 3` でも "More than 3 year has passed…" と表示される。i18next を起動して確認済み）。`commons.json` の `toaster.remove_share_link` も単数形／複数形の作り分けが無い
- 本 spec では `status.ignoreKeys` による除外に留めた。5言語それぞれの複数形規則（言語ごとに必要なサフィックスが違う）を扱う作業であり、Requirement 1 の「存在しないキー参照」とは別の課題で、Non-Goals の「翻訳ファイル構成の再編」に隣接するため
- 移行する場合は、`status.ignoreKeys` から該当4キーを外すことがそのまま完了条件になる

## References
- [i18next-cli (npm)](https://www.npmjs.com/package/i18next-cli) — バージョン 1.69.0、MIT ライセンス、コマンド仕様の一次情報
- サンドボックス実行ログ（本セッション内、`/tmp` 配下、恒久的な保存はしていない）— `status` / `status --unused` / `extract --ci --dry-run` / `sync --help` の実測結果
