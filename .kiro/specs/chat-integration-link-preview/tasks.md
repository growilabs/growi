# Implementation Plan — chat-integration-link-preview

> amend spec。対象は umbrella `chat-integration` の要件 6 と、`chat-integration-app`・`-proxy`・`-protocol` の design.md（[design.md](./design.md)「Amend target」）。
> **最後のタスク（4）で対象の spec へ書き戻し、このディレクトリを消すまでが完了。** 実装が入っただけでは完了ではない。

- [ ] 1. 題名の決め方を 1 つの関数にまとめる
- [ ] 1.1 `titleFromPath` を共有のファイルへ移す
  - `apps/app/src/features/chat-integration/server/content/search-result-mapper.ts` の `titleFromPath` を `content/title-from-path.ts` へ移し、`search-result-mapper.ts` はそこから読む
  - 動きは変えない（振る舞いを変えない整理なので、先に失敗するテストは要らない）
  - 完了の条件: `search-result-mapper.spec.ts` が変更なしで通る
  - _Requirements: 6.10_

- [ ] 2. GROWI 側の判定に「題名と更新日時だけ」の状態を足す
- [ ] 2.1 `buildLinkPreview` に、公開範囲が「公開」でログインが必要な GROWI の場合の応答を足す（振る舞いを変えるタスク）
  - 先に `link-preview-mapper.spec.ts` に design.md「Testing Strategy」の 1〜4 のテストを足し、失敗することを確かめる
  - 既存のテストのうち 2 つを直す（design.md「Testing Strategy」の 7）: 「gives path-only for a GRANT_PUBLIC page in a CLOSED GROWI」を新しい状態のテストに置き換え、「never includes excerpt/updatedAt/commentCount when restricted」の名前を「公開範囲を絞ったページでは含まない」に変える
  - `command-endpoint.spec.ts` に、閉じた GROWI・紐付いた人・公開ページの固定リンクのテストを 1 つ足す（今の `link-preview` のテストはどれも開いた GROWI なので変えない）
  - `link-preview-mapper.ts` の判定を、design.md「LinkPreviewMapper」の 4 つの状態の形にする。固定リンクの題名は 1.1 の `titleFromPath` で作る
  - `link-preview-mapper.ts` の冒頭のコメント（「2 つの状態」「閉じた GROWI ではパスだけ」）と、`public-page-filter.ts` の冒頭のコメント（要件 6.3 の説明）を、新しい状態に合わせて書き直す。理由の詳しい説明は書かず、spec を指す
  - 完了の条件: 1〜4 と受け口のテストが通り、上で挙げた 2 つ以外の既存のテストは変更なしで通る
  - _Requirements: 6.9, 6.10, 6.11_
- [ ] 2.2 公開範囲を絞ったページの応答が今と同じバイト列のままであることをテストで固める（振る舞いを守るタスク）
  - design.md「Testing Strategy」の 5・6 を足す。`GRANT_OWNER`・`GRANT_USER_GROUP`・`GRANT_RESTRICTED`・`GRANT_SPECIFIED` のそれぞれで、閉じた GROWI・開いた GROWI の両方について、固定リンクの応答が「存在しない固定リンク」の応答と `toStrictEqual` で一致すること
  - 2.1 の変更を一時的に壊して（例: 状態 4 の条件から `isPubliclyReadablePage` を外す）テストが失敗することを確かめ、戻す。戻した後に `git status` で元に戻ったことを確かめる
  - 完了の条件: 5・6 のテストが通り、壊したときに失敗することを確かめた記録がある
  - _Requirements: 6.12_

- [ ] 3. proxy の表示で更新日時を出す
- [ ] 3.1 `previewMarkdown` の `restricted: true` の分岐で `updatedAt` を出す（振る舞いを変えるタスク）
  - 先に `apps/chat-integration-proxy/src/orchestration/command-flow.spec.ts` に design.md「Testing Strategy」の 8・9 を足し、8 が失敗することを確かめる
  - `apps/chat-integration-proxy/src/orchestration/command-flow.ts` の `previewMarkdown` を、design.md「proxy の previewMarkdown」の形にする。`restricted: true` のときに本文の冒頭とコメント数を出さないことは保つ
  - 完了の条件: 8〜10 のテストが通る（10 は既存の `{ restricted: true, path }` のテスト）
  - _Requirements: 6.13_

- [ ] 4. 変更を対象の spec へ書き戻し、この spec を消す
  - [ ] 4.1 対象の spec の design.md / requirements.md の該当箇所を書き直す
    - umbrella `chat-integration/requirements.md` の要件 6 に、本 spec の requirements.md の 6.9〜6.13 を末尾に足す（既存の番号は振り直さない）。「この要件で使う言葉」の定義も要件 6 の中へ移す
    - 同じく 6.3 を、番号を変えずに「6.9 の場合を除き」の形へ書き直す。他の 6.x の文言は変えない
    - umbrella `chat-integration/design.md` の要件の対応表の `6.1–6.8` を `6.1–6.13` にする
    - `chat-integration-app/design.md` の「`PublicPageFilter` を呼ぶ側も、閉じた GROWI での扱いを決める」の表の「リンクの展開」の行と、「LinkPreviewMapper（固定リンクの応答）」の System Flow・Service Interface の不変条件・Requirements Traceability を、本 spec の design.md の形に置き換える。Overview の「固定リンクが見つからない場合の表示」の説明も、本 spec の design.md「Amend target」の表のとおりに直す。Components の表の `LinkPreviewMapper` の要件の列に 6.9〜6.12 を足す。Revalidation Triggers に、本 spec の design.md「Revalidation Triggers」の「書き戻しで app の design.md に足す行」を足す
    - `chat-integration-protocol/design.md` の `link-preview` の応答の型の近くに、`restricted: true` のときに含むもの・含まないものと、`path` の意味を書き足す（型は変えない）
    - `chat-integration-proxy/design.md` には URL の展開の表示の決まりを書いた節が無いので、`CommandFlow.previewLinks` を説明している近くに短い節を足し、`restricted: true` でも `updatedAt` を出すこと・本文の冒頭とコメント数は出さないことを書く。Components の表の要件の列に 6.13 を足す
    - どの文書にも「以前は〜だった」という経緯を書かず、今の事実だけを書く
  - [ ] 4.2 設計の理由を対象の spec の research.md へ移す
    - 本 spec の research.md の決定 1〜4・Research Log・未決事項を `chat-integration-app/research.md` へ移す（`chat-integration-protocol` には research.md が無いので、決定 3 も app 側に置き、4.1 で protocol の design.md からそこを指す）
    - umbrella `chat-integration/research.md` に、決定 1（公開範囲が「公開」に限る理由）の要約を置く
  - [ ] 4.3 対象の spec の spec.json の `updated_at` を更新する（`phase` と `approvals` は変えない）
    - `chat-integration`・`chat-integration-app`・`chat-integration-protocol`・`chat-integration-proxy` の 4 つ
  - [ ] 4.4 roadmap.md からこの spec の項目を消す
    - `chat-integration/roadmap.md` の「リリース前に直すもの」の「5. URL の展開の方針」を消す。後に残す価値のあることは 4.1・4.2 で移し終えていること
    - 「10. URL の展開の確認フロー」の「要件 6 の受け入れ条件の追記」に、番号は 6.14 から振ることを書く
  - [ ] 4.5 `.kiro/specs/chat-integration-link-preview/` を消す
    - 消す前に、steering と roadmap.md からこのディレクトリの中のファイルを名前で指している箇所が無いことを確かめる
  - _Requirements: 6.9, 6.10, 6.11, 6.12, 6.13_
