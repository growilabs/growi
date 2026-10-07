# Alerts

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

You can also use [directive syntax](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444).

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


# Quote text
- Use quoted expressions by putting `>` at the beginning of the paragraph
    - Multiple quotations can be expressed by using a sequence of `>` characters
- Lists and other elements can be used together within the blockquotes

#### Example
> - Quotation
> - Quotation
>> Multiple quotations need to insert more `>`

```markdown
> - Quotation
> - Quotation
>> Multiple quotations need to insert more `>`
```


# Code
- It is possible to express the code by adding it in three `` ` ``

#### Example

```markdown
Add codes here  

Line breaks and paragraphs can be reflected in the code as-is
```

#### Example (source code)

```javascript:mersenne-twister.js
function MersenneTwister(seed) {
  if (arguments.length == 0) {
    seed = new Date().getTime();
  }

  this._mt = new Array(624);
  this.setSeed(seed);
}
```

## Inline Code
- Enclose words in `` ` `` to make inline code

#### Example
Here is the `inline code` 



# Task List
- Insert an unchecked checkbox list by writing `[] `
    - Check the checkbox by writing `[x]`

#### Example
- [ ] Task 1
    - [x] Task 1-1
    - [ ] Task 1-2
- [x] Task 2


# Horizontal lines
- Insert the horizontal line with three or more consecutive asterisks `*` or underscores `_`

#### Example
Below is a horizontal line
***

Below is a horizontal line
___

```markdown
Below is a horizontal line
***

Below is a horizontal line
___
```


# Footnotes

You can add footnotes to your content by using this bracket syntax:

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


# emoji

You can add emojis to your text by typing the emoji name after a colon `:`.

- :+1: GOOD!
- :white_check_mark: Check
- :lock: Lock

When you type two or more characters after the colon, an emoji suggestion list will appear. This list will narrow down as you continue typing. Once you find the emoji you are looking for, press Tab or Enter to insert the highlighted emoji.

For a list of available emojis, refer to the "[Emoji Cheat Sheet](https://github.com/ikatyang/emoji-cheat-sheet/blob/master/README.md)".


# Table
### General syntax
#### Example

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

#### Example

``` tsv
Content Cell	Content Cell
Content Cell	Content Cell
```

~~~
``` csv
Content Cell,Content Cell
Content Cell,Content Cell
```
~~~

~~~
``` tsv
Content Cell	Content Cell
Content Cell	Content Cell
```
~~~


### CSV / TSV (with header)


#### Example

``` tsv-h
First Header	Second Header
Content Cell	Content Cell
Content Cell	Content Cell
```

~~~
``` csv-h
First Header,Second Header
Content Cell,Content Cell
Content Cell,Content Cell
```
~~~

~~~
``` tsv-h
First Header	Second Header
Content Cell	Content Cell
Content Cell	Content Cell
```
~~~


