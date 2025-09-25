[English 🇺🇸](./README.md)

# このアプリについて
GROWI には、ページを PDF 形式で一括エクスポートする機能があり、ページメニューから実行できます。
このアプリ（PDF-Converter）は、そのプロセスの中で Markdown ページを PDF に変換するために必要です。

# 開発
## 内部仕様
[/資料/内部仕様/Page Bulk Export/PDF エクスポート](https://dev.growi.org/66ee8495830566b31e02c953)

## Devcontainer 内での開発
1. VSCode を開く
1. `.devcontainer/compose.extend.template.yml` と同様の内容で `.devcontainer/compose.extend.yml` を作成
1. コマンドパレットを開く（Windows: `Ctrl + Shift + P`、Mac: `Cmd + Shift + P`）
1. `Dev Containers: Open folder in Container...` を選択
1. [https://github.com/growilabs/growi](https://github.com/growilabs/growi) からクローンした GROWI のルートディレクトリを選択
   - **PDF-Converter のディレクトリ（growi/apps/pdf-converter）ではなく、GROWI のルートディレクトリを選択すること**
1. `GROWI-PDF-Converter` をコンテナとして選択
1. `cd apps/pdf-converter && turbo dev:pdf-converter` を実行し、PDF-Converter アプリを起動
1. `apps/pdf-converter` 内のファイルを編集して開発を行う

## GROWI から PDF-Converter へのリクエストを実行（両方とも devcontainer 内で起動）
1. VSCode を開き、GROWI の devcontainer を開く
   - `GROWI-Dev` をコンテナとして選択
1. `apps/app/.env.development.local` に `BULK_EXPORT_PDF_CONVERTER_URI=http://pdf-converter:3010` を追記
1. 新しい VSCode ウィンドウを開き、PDF-Converter の devcontainer を開く
   - [Devcontainer 内での開発](#devcontainer-内での開発) の手順に従う
1. 両方のアプリを起動
1. GROWI アプリのページメニューから PDF の一括エクスポートをリクエスト
   - GROWI の設定によっては、処理に数分かかる場合があります

### 備考
二つのコンテナを初めて作成する時や、コンテナを rebuild する時、**必ず GROWI-Dev を先に選択して作成してください**。
GROWI-Dev は devcontainer features を使用して node を有効化していますが、[features は最初に作成したコンテナにしか有効になりません](https://github.com/devcontainers/spec/issues/546)。

## PDF-Converter クライアントライブラリ
[pdf-converter-client](../../packages/pdf-converter-client) は、PDF-Converter へのリクエストを行うクライアントライブラリであり、GROWI 内部で使用されています。このコードは PDF-Converter のコードから自動生成されます。

PDF-Converter API を更新した際は、必ずクライアントライブラリも更新してください。

クライアントライブラリは以下のいずれかの方法で更新可能です:
- `cd ${growi_root_path}/packages/pdf-converter-client && pnpm gen:client-code` を実行
- GROWI アプリを起動
    - GROWI の devcontainer 内 **(PDF-Converter の devcontainer ではない)** で
      `cd ${growi_root_path}/apps/app && turbo dev` を実行
