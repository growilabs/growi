# 欢迎来到 GROWI 沙盒！

> [!NOTE]
> **什么是沙盒？**
>
> 这是一个您可以自由编辑的练习页面。它是尝试新事物的绝佳场所！

## :beginner: 初学者指南

使用 GROWI，您可以使用名为“Markdown”的符号轻松创建具有视觉吸引力的页面。

通过使用 Markdown，您可以做这样的事情！

- 用**粗体**或*斜体*强调文本
- 创建项目符号或编号列表
- [插入链接](#-link)
- 创建表格
- 添加代码块

还可以使用各种其他装饰。

## 让我们尝试一下！

1. 随意编辑此页面
1. 无需担心犯错
1. 您随时可以撤销更改
1. 您还可以从其他人的编辑中学习

> [!IMPORTANT]
> **对于管理员**
>
> 沙盒是学习的重要场所：
> - 作为新成员习惯 GROWI 的第一步
> - 作为 Markdown 的练习场
> - 作为团队内部的沟通工具
> - 即使此页面变得杂乱无章，这也是积极学习的标志。定期清理是好的，但建议保持其作为自由实验空间的性质。


# :closed_book: 标题和段落
- 通过插入标题和段落，您可以使页面上的文本更易于阅读

## 标题
- 在标题文本前添加 `#` 以创建标题
- 根据 `#` 的数量，标题的字体大小在视图屏幕中显示不同
- `#` 的数量将决定层次结构级别并帮助您组织内容

```markdown
# 第一级标题
## 第二级标题
### 第三级标题
#### 第四级标题
##### 第五级标题
###### 第六级标题
```

## 换行
- 在要换行的句子末尾插入两个半角空格
    - 您也可以在设置中更改此设置以换行而不使用半角空格
        - 更改换行设置在管理页面的“Markdown 设置”部分
        
#### 示例：没有换行
第 1 段
第 2 段

#### 示例：有换行符
第 1 段  
第 2 段

## 块
- 可以通过在文本中插入空行来创建段落
- 可以将段落分成句子，使它们更易于阅读

#### 示例：没有段落
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

#### 示例：用段落
Lorem ipsum dolor sat amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut Labore et dolore magna aliqua。 Ut enim ad minim veniam, quis nostrud exeritation ullamco labouris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur。 Excepteur sint occaecat cupidatat non proident，sunt in culpa qui officia deserunt mollit anim id est laborum。


# :blue_book: 文本样式
- 可以应用各种样式来丰富句子的文本表达
    - 也可以通过选择编辑屏幕底部的工具栏图标轻松应用这些样式

| Style | 语法 | 键盘快捷键 | 示例 | 输出 |
|-------|------|------------|------|------|
| 加粗 | `** **` 或 `__ __` | (TBD) | `**这是粗体文本**` | **这是粗体文本** |
| 斜体 | `* *` 或 `_ _` | (TBD) | `_这是斜体文本_` | *这是斜体文本* |
| 删除线 | `~~ ~~` | 无 | `~~这是错误文本~~` | ~~这是错误文本~~ |
| 粗体和嵌入的斜体 | `** **` 和 `_ _` | (TBD) | `**This text is _extremely_ important**` | **This text is _extremely_ important** |
| 全部粗体和斜体 | `*** ***` | 无 | ***所有这些文本都很重要*** | ***所有这些文本都很重要*** |
| 下标 | `<sub> </sub>` | 无 | This is a <sub>subscript</sub> text | 这是<sub>下标</sub>文本 |
| 上标 | `<sup> </sup>` | 无 | This is a <sup>superscript</sup> text | 这是<sup>上标</sup>文本 |


# :green_book: 插入列表
## 项目符号列表
- 通过在行首使用连字符 `-`、加号 `+` 或星号 `*` 插入项目符号列表

#### 示例
- 本句在项目符号列表中
    - 本句在项目符号列表中
        - 本句在项目符号列表中
        - 本句在项目符号列表中
- 本句在项目符号列表中
    - 本句在项目符号列表中

## 编号列表
- 在行首使用 `Number.` 插入编号列表
- 编号自动分配

- 编号列表和项目符号列表也可组合使用

#### 示例
1. 本句在编号列表中
    1. 本句在编号列表中
    1. 此句子出现在编号列表中
    1. 此句子出现在编号列表中
        - 此句子出现在项目符号列表中
1. 此句子出现在项目符号列表中
    - 此句子出现在项目符号列表中



# :ledger: 链接

## 自动链接
只需输入 URL，链接就会自动生成。

### 示例

https://www.google.co.jp

```markdown
https://www.google.co.jp
```

## 标签和链接
通过输入 `[label](URL)` 插入链接

### 示例
- [Google](https://www.google.co.jp/)
- [Sandbox is here](/Sandbox)

```markdown
- [Google](https://www.google.co.jp/)
- [Sandbox is here](/Sandbox)
```

## 灵活的链接语法

灵活的链接语法使通过页面路径、相对页面链接和链接标签和 URL 编写链接变得容易。

- [[/Sandbox]]
- [[./Math]]
- [[如何写公式？>./Math]]

```markdown
- [[/Sandbox]]
- [[./Math]]
- [[如何写公式？>./Math]]
```


# :notebook: 更多应用
- [了解更多关于 Markdown](/Sandbox/Markdown)

- [进一步装饰你的页面 (Bootstrap5)](/Sandbox/Bootstrap5)

- [如何表示图表 (Diagrams)](/Sandbox/Diagrams)

- [如何表示数学公式 (Math)](/Sandbox/Math)