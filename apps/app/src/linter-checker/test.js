/*
 * VSCode の Eslint 設定チェック方法
 *
 * 1. .eslilntignore ファイル中の `/src/linter-checker/**` 行を消す
 *
 * 2. VSCode で以下のエラーが表示されていることを確認
 *   - constructor で eslint(space-before-blocks)
 *   - ファイル末尾の ";" で eslint(eol-last)
 *
 * 3. VSCode で上書き保存
 *
 * 4. 以下のように整形され、全てのエラーが消えていることを確認
 *   - "constructor() {" のように間にスペースが入る
 *   - ファイル末尾に空行が入る
 *
 */
class EslintTest {
  constructor() {
    this.i = 0;
  }
}

module.exports = EslintTest;
