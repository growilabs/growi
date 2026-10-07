# Welcome to the GROWI Sandbox!

> [!NOTE]
> **What is a Sandbox?**
> 
> This is a practice page that you can freely edit. It's the perfect place to try new things!


## :beginner: For Beginners

With GROWI, you can easily create visually appealing pages using a notation called "Markdown".  
By using Markdown, you can do things like this!

- Emphasize text with **bold** or *italic*
- Create bulleted or numbered lists
- [Insert links](#-link)
- Create tables
- Add code blocks

Various other decorations are also possible.

## Let's Try It!

1. Feel free to edit this page
1. There's no need to fear making mistakes
1. You can always revert changes
1. You can also learn from others' edits

> [!IMPORTANT]
> **For Administrators**
> 
> The sandbox is an important place for learning:
> - As a first step for new members to get used to GROWI
> - As a practice ground for Markdown
> - As a communication tool within the team
>     - Even if this page becomes cluttered, it is a sign of active learning. Regular cleanups are good, but it is recommended to maintain its nature as a free experimentation space.


# :closed_book: Headings & Paragraphs
- By inserting headings and paragraphs, you can make the text on the page easier to read

## Headers
- Add `#` before the heading text to create a heading 
    - Depending on the number of `#`, the typeface size of headings would be different shown in the View screen 
- The number of `#` will decide the hierarchy level and help you to organize the contents

```markdown
# First-level heading
## Second-level heading
### Third-level heading
#### Forth-level heading
##### Fifth-level heading
###### Sixth-level heading
```

## Break
- Insert two half-width spaces at the end of the sentence you want to break
    - You can also change this in the Setting to break the line without half-width spaces
        - Change the line break setting in the `Markdown Settings` sector of the admin page

#### Example: Without line break
Paragraph 1
Paragraph 2

#### Example: With line break
Paragraph 1  
Paragraph 2

## Block
- Paragraphs can be created by inserting a blank line in the text
- Passage can be broken into sentences and make them easier to read

#### Example: Without paragraph
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

#### Example: With paragraph
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.


# :blue_book: Styling Text

- Various styles can be applied to enrich the textual expression of a sentence
    - These styles can also be easily applied by selecting the toolbar icon at the bottom of the Edit screen

| Style                     | Syntax                 | Keyboard Shortcut | Example                                   | Output                                 |
| ------------------------- | ---------------------- | ----------------- | ----------------------------------------- | -------------------------------------- |
| Bold                      | `** **` or `__ __`     | (TBD)             | `**This is bold text**`                   | **This is bold text**                  |
| Italic                    | `* *` or `_ _`         | (TBD)             | `_This text is italicized_`               | *This text is italicized*              |
| Strikethrough             | `~~ ~~`                | (TBD)             | `~~This was mistaken text~~`             | ~~This was  mistaken text~~            |
| Bold and nested italic | `** **` and `_ _`     | None              | `**This text is _extremely_ important**`  | **This text is _extremely_ important** |
| All Bold and Italic   | `*** ***`              | None              | `***All this text is important***`       | ***All this text is important***      |
| Subscript                 | `<sub> </sub>`         | None              | `This is a <sub>subscript</sub> text`       | This is a <sub>subscript</sub> text      |
| Superscript               | `<sup> </sup>`         | None              | `This is a <sup>superscript</sup> text`     | This is a <sup>superscript</sup> text    |


# :green_book: Insert Lists
## Bulleted List
- Insert a bulleted list by starting a line with a hyphen `-`, a plus `+`, or an asterisk `*`

#### Example
- This sentence is present in the bulleted list
    - This sentence is present in the bulleted list
        - This sentence is present in the bulleted list
        - This sentence is present in the bulleted list
- This sentence is present in the bulleted list
    - This sentence is present in the bulleted list

## Numbered List
- `Number.` at the beginning of a line to insert a numbered list
    - Numbers are automatically assigned

- Numbered list and bulleted list can also be combined for use

#### Example
1. This sentence is present in the numbered list
    1. This sentence is present in the numbered list
    1. This sentence is present in the numbered list
    1. This sentence is present in the numbered list
        - This sentence is present in the bulleted list 
1. This sentence is present in the bulleted list
    - This sentence is present in the bulleted list


# :ledger: Link

## Auto link
Just write the URL and the link will be generated automatically.

### Example

https://www.google.co.jp

```markdown
https://www.google.co.jp
```

## Label and link
Insert a link by writing `[label](URL)`

### Example
- [Google](https://www.google.co.jp/)
- [Sandbox is here](/Sandbox)

```markdown
- [Google](https://www.google.co.jp/)
- [Sandbox is here](/Sandbox)
```

## Flexible link syntax

Flexible link syntax make it easy to write a link by page path, a relative page link and link label and URL.

- [[/Sandbox]]
- [[./Math]]
- [[How to write formulas?>./Math]]

```markdown
- [[/Sandbox]]
- [[./Math]]
- [[How to write formulas?>./Math]]
```


# :notebook: More Applications

- [Learn more about Markdown](/Sandbox/Markdown)

- [Further decorate your page (Bootstrap5)](/Sandbox/Bootstrap5)

- [How to represent diagrams (Diagrams)](/Sandbox/Diagrams)

- [How to represent mathematical formulas (Math)](/Sandbox/Math)



