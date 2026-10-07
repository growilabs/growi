# remark-growi-directive

以下の要領で replace する

なお、`$foo()` は一例であり、`$bar()`, `$baz()`, `$foo-2()` など、さまざまな directive に対応する必要がある

## 1. HTMLタグ内で `$foo()` を利用している箇所
- 置換対象文章の詳細
  - `$foo()`がHTMLタグ内かつ、当該`$foo()`記述の1行前が空行ではない場合に1行前に空行を挿入する
  - `$foo()`がHTMLタグ内かつ、`$foo()`記述行の行頭にインデントがついている場合に当該行のインデントを削除する
  - `$foo()`がHTMLタグ内かつ、当該`$foo()`記述の1行後のHTMLタグ記述行にインデントがついている場合にその行頭のインデントを削除する

## 2. `$foo()` を利用している箇所
- 置換対象文章の詳細
  - `$foo()`の引数内で `filter=` あるいは `except=` に対する値に括弧 `()` を使用している場合、括弧を削除する
    - before: `$foo()`(depth=2, filter=(AAA), except=(BBB))
    - after: `$foo()`(depth=2, filter=AAA, except=BBB)

## テストについて

以下を満たす

- input が `example.md` のとき、`example-expected.md` を出力する
- input が `example-expected.md` のとき、`example-expected.md` を出力する (変更が起こらない)

