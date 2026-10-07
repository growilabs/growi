# アラート

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.


```markdown
> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.
```

[directive](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444) を使って記述することもできます。

:::note
Useful information that users should know, even when skimming content.
:::

:::tip[Custom Label]
Useful information that users should know, even when skimming content.
:::

```markdown
:::note
Useful information that users should know, even when skimming content.
:::

:::tip[Custom Label]
Useful information that users should know, even when skimming content.
:::
```


# テキストの引用
- 行頭に `>` を記述することで引用表現を記述できます
    - 多重引用の際は `>` を複数個連続で記述することで表現できます

#### 例
> - 引用符
> - 引用符
>> 複数の引用符にはさらに `>` を挿入する必要があります

```markdown
> - 引用する文章が入ります
> - 引用する文章が入ります
>> 多重引用を表現するにはさらに `>` を挿入します
```


# コード
- `` ` `` 3つで囲むことでコードの表現をすることが可能です

#### 例

```markdown
ここにコードを追加

改行と段落はそのまま反映されます
```
#### 例 (ソースコード)

```javascript:mersenne-twister.js
function MersenneTwister(seed) {
  if (arguments.length == 0) {
    seed = new Date().getTime();
  }

  this._mt = new Array(624);
  this.setSeed(seed);
}
```

## インライン コード
- `` ` `` で単語を囲むとインラインコードになります

#### 例
こちらは `インラインコード` です


# タスク リスト
- `[] ` を記述することでリストに対して未チェックのチェックボックスを挿入することができます
    - `[x] ` を記述することでチェック済みのチェックボックスを挿入することができます

#### 例
- [ ] タスク 1
    - [x] タスク 1-1
    - [ ] タスク 1-2
- [x] タスク2


# 水平線
- 3 つ以上の連続したアスタリスク `*` またはアンダースコア `_` で水平線を挿入します

#### 例
以下は水平線です
***

以下は水平線です
___

```markdown
以下は水平線です
***

以下は水平線です
___
```


# 脚注
角かっこ構文を使用して、コンテンツに脚注を追加できます。

シンプルな脚注[^1].

複数行にわたる脚注も追加できます[^myfootnote2].

[^1]: 注記はこのように書きます.
[^myfootnote2]: 注記を改行するには、新しい行頭にで2つの連続したスペースをいれます。
  こちらが2行目です。


```markdown
シンプルな脚注[^1].

複数行にわたる脚注も追加できます[^myfootnote2].

[^1]: 注記はこのように書きます.
[^myfootnote2]: 注記を改行するには、新しい行頭にで2つの連続したスペースをいれます。
  こちらが2行目です。
```


# 絵文字

`:EMOJICODE:` とコロンの後に絵文字の名前を入力することで、文章に絵文字を追加できます。

- :+1: GOOD!
- :white_check_mark: チェック
- :lock: 鍵マーク

`:` に続いて2文字以上入力すると、絵文字のサジェストリストが表示されます。このリストは、入力を進めるにつれて絞り込まれていくので、探している絵文字が見つかり次第、Tab または Enter を押して、ハイライトされているものを入力してください。

使用可能な絵文字の一覧は、「[絵文字チートシート](https://github.com/ikatyang/emoji-cheat-sheet/blob/master/README.md)」を参照してください。


# 表
### Markdown 標準
- Markdown で記載できる標準的な形式の表です

#### 例
| 左揃え               |               右揃え |        中央揃え        |
| :------------------- | -------------------: | :--------------------: |
| この列は             |             この列は |        この列は        |
| 左揃えで表示されます | 右揃えで表示されます | 中央揃えで表示されます |

```markdown
| 左揃え               |               右揃え |        中央揃え        |
| :------------------- | -------------------: | :--------------------: |
| この列は             |             この列は |        この列は        |
| 左揃えで表示されます | 右揃えで表示されます | 中央揃えで表示されます |
```

### CSV / TSV
#### 例

``` tsv
10:00	集合
10:20	移動
```

~~~
``` csv
11:00,MTG
12:00,昼食
```
~~~

~~~
``` tsv
10:00	集合
10:20	移動
```
~~~

### CSV / TSV（ヘッダー付き）
#### 例
``` tsv-h
時間	行動
10:00	集合
10:20	移動
```

~~~
``` csv-h
時間,行動
11:00,MTG
12:00,昼食
```
~~~

~~~
``` tsv-h
時間	行動
10:00	集合
10:20	移動
```
~~~




