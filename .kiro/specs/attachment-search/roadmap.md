# attachment-search roadmap

添付ファイルの全文検索の、spec の一覧と、まだ着手していない拡張の候補。決めたことの中身と根拠は、各 spec が持つ。

## spec の一覧

| spec | 範囲 |
|---|---|
| [attachment-search-text-extractor](../attachment-search-text-extractor/) | 抽出サービス (`apps/attachment-text-extractor`) |
| [attachment-search-indexing](../attachment-search-indexing/) | apps/app のサーバ側 (抽出の呼び出し、Elasticsearch の索引、API) |
| [attachment-search-ui](../attachment-search-ui/) | apps/app のクライアント側 (検索結果、管理画面) |

## まだ着手していない拡張の候補

### 拡張子の表に無いテキストのファイルを、中身を見て抽出する

- いまの動き: 抽出サービスは、形式を拡張子と `mimeType` の表だけで決める。表に無い拡張子 (`.tf`、`.conf`、`.ini`、`.toml`、拡張子の無い `Dockerfile` など) は、中身がテキストでも `unsupported_format` になり、検索できない。
- ほしい動き: 表に無いファイルでも、中身がテキストだと判定できれば、テキストとして抽出して検索できるようにする (たとえば Terraform の `.tf`)。
- 着手するときに決めること:
  - 「テキストである」と判定する方法 (文字コードの判定の結果、制御文字の割合、先頭だけを見るか全体を見るか) と、バイナリを誤ってテキストとして索引に入れない条件
  - 判定をどちらで行うか (抽出サービスが行うのが自然である。apps/app はファイルの中身を見ない)
  - 大きさと文字数の上限 (テキスト系の形式の、いまの上限に合わせるか)
  - 応答の `mimeType` に何を返すか (`text/plain` に寄せるか)
- 関わる spec: `attachment-search-text-extractor` (形式の判定と、対応する形式の一覧の契約)、`attachment-search-indexing` (`unsupported` の扱いと失敗の記録)
