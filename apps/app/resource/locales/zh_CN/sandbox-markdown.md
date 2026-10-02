# Alert

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

您还可以使用[directive 语法](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444)。

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


# 引用
- 在段落开头放置 `>` 即可使用带引号的表达式
    - 可以使用一系列 `>` 字符来表示多个引号
- 列表和其他元素可以在区块引用中一起使用

#### 示例
> - 引号
> - 引号
>> 多个引号需要插入更多 `>`

```markdown
> - 引号
> - 引号
>> 多个引号需要插入更多 `>`
```


# 代码
- 可以通过在三个 `` ` `` 中添加代码来表示代码

####示例

```markdown
在此处添加代码

换行符和段落可以按原样反映在代码中
```

#### 示例（源代码）

```javascript:mersenne-twister.js
function MersenneTwister(seed) {
  if (arguments.length == 0) {
    seed = new Date().getTime();
  }

  this._mt = new Array(624);
  this.setSeed(seed);
}
```

## 内联代码
- 将单词括在 `` ` `` 中以制作内联代码

#### 示例
以下是 `内联代码`



# 任务列表
- 通过写入 `[] ` 插入未选中的复选框列表
    - 通过写入 `[x]` 选中复选框

#### 示例
- [ ] 任务 1
    - [x] 任务 1-1
    - [ ] 任务 1-2
- [x] 任务 2


# 水平线
- 用三个或更多连续的星号 `*` 或下划线 `_` 插入水平线

#### 示例
下面是一条水平线
***
下面是一条水平线
___

```markdown
下面是一条水平线
***
下面是一条水平线
___
```


# 脚注

您可以使用此括号语法为您的内容添加脚注：

Here is a simple footnote[^1].

A footnote can also have multiple lines[^2].

[^1]: My reference.
[^2]: To add line breaks within a footnote, prefix new lines with 2 spaces.
  This is a second line.

```markdown
Here is a simple footnote[^1].

A footnote can also have multiple lines[^2].

[^1]: My reference.
[^2]: To add line breaks within a footnote, prefix new lines with 2 spaces.
  This is a second line.
```


# 表情符号

您可以通过在冒号 `:` 后输入表情符号名称来添加表情符号。

- :+1: 好！
- :white_check_mark: 检查
- :lock: 锁定

当您在冒号后输入两个或更多字符时，会出现一个表情符号建议列表。随着您继续输入，这个列表会逐渐缩小范围。一旦找到您要查找的表情符号，按 Tab 或 Enter 键插入高亮显示的表情符号。

有关可用表情符号的列表，请参阅 "[Emoji Cheat Sheet](https://github.com/ikatyang/emoji-cheat-sheet/blob/master/README.md)"。



# 表格

### 通用语法

#### 示例

| Left align | Right align | Center align |
|:-----------|------------:|:------------:|
| This       | This        | This         |
| column     | column      | column       |
| will       | will        | will         |
| be         | be          | be           |
| left       | right       | center       |
| aligned    | aligned     | aligned      |

```markdown
| Left align | Right align | Center align |
|:-----------|------------:|:------------:|
| This       | This        | This         |
| column     | column      | column       |
| will       | will        | will         |
| be         | be          | be           |
| left       | right       | center       |
| aligned    | aligned     | aligned      |
```

### CSV / TSV

#### 示例

``` tsv
内容单元格 内容单元格
内容单元格 内容单元格
```

~~~
``` csv
内容单元格,内容单元格
内容单元格,内容单元格
```
~~~

~~~
``` tsv
内容单元格 内容单元格
内容单元格 内容单元格
```
~~~

### CSV / TSV (带标题)

#### 示例

``` tsv-h
第一个标题 第二个标题
内容单元格 内容单元格
内容单元格 内容单元格
```

~~~
``` csv-h
第一个标题,第二个标题
内容单元格,内容单元格
内容单元格,内容单元格
```
~~~

~~~
``` tsv-h
第一个标题 第二个标题
内容单元格 内容单元格
内容单元格 内容单元格
```
~~~

