---
marp: true
---

Marp
===

![h:250](https://avatars1.githubusercontent.com/u/20685754?v=4)

##### Markdown presentation ecosystem

###### by Marp Team ([@marp-team][marp-team])

[marp-team]: https://github.com/marp-team
[marpit]: https://github.com/marp-team/marpit
[marp-core]: https://github.com/marp-team/marp-core
[marp-cli]: https://github.com/marp-team/marp-cli
[marp-vscode]: https://github.com/marp-team/marp-vscode

---

# Features

- :memo: **Write slide deck with plain Markdown** (CommonMark)
- :factory: Built on [Marpit framework][marpit]: A brand-new skinny framework for creating slide deck
- :gear: [Marp Core][marp-core]: Easy to start using the core engine and built-in themes via npm
- :tv: [Marp CLI][marp-cli]: Convert Markdown into HTML, PDF, PPTX, and images
- :vs: [Marp for VS Code][marp-vscode]: Live-preview your deck while editting
- and more...

---

# How to write slides?

Split pages by horizontal ruler (e.g. `---`). It's very simple.

```markdown
# Slide 1

foobar

---

# Slide 2

foobar
```

---

# Directives

Marp has extended syntax called **"Directives"** to support creating beautiful slides.

Insert front-matter to the top of Markdown:

```
---
theme: default
---
```

or HTML comment to anywhere:

```html
<!-- theme: default -->
```

https://marpit.marp.app/directives

---

## [Global directives](https://marpit.marp.app/directives?id=global-directives)

- `theme`: Choose theme
- `size`: Choose slide size from `16:9` and `4:3` *(except Marpit framework)*
- [`headingDivider`](https://marpit.marp.app/directives?id=heading-divider): Instruct to divide slide pages at before of specified heading levels

```
---
theme: gaia
size: 4:3
---

# Content
```

> Marp can use [built-in themes in Marp Core](https://github.com/marp-team/marp-core/tree/master/themes#readme): `default`, `gaia`, and `uncover`.

---

## [Local directives](https://marpit.marp.app/directives?id=local-directives)

These are the setting value per slide pages.

- `paginate`: Show pagination by set `true`
- `header`: Specify the contents for header
- `footer`: Specify the contents for footer
- `class`: Set HTML class for current slide
- `color`: Set text color
- `backgroundColor`: Set background color

---

### Spot directives

Local directives would apply to **defined page and following pages**.

They can apply to single page by using underscore prefix such as `_class`.

![bg right 95%](https://marpit.marp.app/assets/directives.png)

---

### Example

This page is using invert color scheme [defined in Marp built-in theme](https://github.com/marp-team/marp-core/tree/master/themes#readme).

<!-- _class: invert -->

```html
<!-- _class: invert -->
```

---

# [Image syntax](https://marpit.marp.app/image-syntax)

You can resize image size and apply filters through keywords: `width` (`w`), `height` (`h`), and filter CSS keywords.

```markdown
![width:100px height:100px](image.png)
```

```markdown
![blur sepia:50%](filters.png)
```

Please refer [resizing image syntax](https://marpit.marp.app/image-syntax?id=resizing-image) and [a list of CSS filters](https://marpit.marp.app/image-syntax?id=image-filters).

![w:100px h:100px](https://avatars1.githubusercontent.com/u/20685754?v=4) ![w:100 h:100 blur sepia:50%](https://avatars1.githubusercontent.com/u/20685754?v=4)

---

# [Background image](https://marpit.marp.app/image-syntax?id=slide-backgrounds)

You can set background image for a slide by using `bg` keyword.

```markdown
![bg opacity](https://yhatt-marp-cli-example.netlify.com/assets/gradient.jpg)
```

![bg opacity](https://yhatt-marp-cli-example.netlify.com/assets/gradient.jpg)

---

## Multiple backgrounds ([Marpit's advanced backgrounds](https://marpit.marp.app/image-syntax?id=advanced-backgrounds))

Marp can use multiple background images.

```markdown
![bg blur:3px](https://fakeimg.pl/800x600/fff/ccc/?text=A)
![bg blur:3px](https://fakeimg.pl/800x600/eee/ccc/?text=B)
![bg blur:3px](https://fakeimg.pl/800x600/ddd/ccc/?text=C)
```

Also can change alignment direction by including `vertical` keyword.

![bg blur:3px](https://fakeimg.pl/800x600/fff/ccc/?text=A)
![bg blur:3px](https://fakeimg.pl/800x600/eee/ccc/?text=B)
![bg blur:3px](https://fakeimg.pl/800x600/ddd/ccc/?text=C)

---

## [Split background](https://marpit.marp.app/image-syntax?id=split-backgrounds)

Marp can use [Deckset](https://docs.deckset.com/English.lproj/Media/01-background-images.html#split-slides) style split background(s).

Make a space for background by `bg` + `left` / `right` keywords.

```markdown
![bg right](image.jpg)
```

![bg right](https://images.unsplash.com/photo-1568488789544-e37edf90eb67?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&h=720&ixlib=rb-1.2.1&q=80&w=640)

<!-- _footer: "*Photo by [Mohamed Nohassi](https://unsplash.com/@coopery?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText) on [Unsplash](https://unsplash.com/?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText)*" -->

---

## [Fragmented list](https://marpit.marp.app/fragmented-list)

Marp will parse a list with asterisk marker as the fragmented list for appearing contents one by one. (_**Only for exported HTML** by [Marp CLI][marp-cli] / [Marp for VS Code][marp-vscode]_)

```markdown
# Bullet list

- One
- Two
- Three

---

# Fragmented list

* One
* Two
* Three
```

---

## Math typesetting (only for [Marp Core][marp-core])

[KaTeX](https://katex.org/) math typesetting such as $ax^2+bc+c$ can use with [Pandoc's math syntax](https://pandoc.org/MANUAL.html#math).

$$I_{xx}=\int\int_Ry^2f(x,y)\cdot{}dydx$$

```tex
$ax^2+bc+c$
```
```tex
$$I_{xx}=\int\int_Ry^2f(x,y)\cdot{}dydx$$
```

---

## Auto-scaling (only for [Marp Core][marp-core])

*Several built-in themes* are supported auto-scaling for code blocks and math typesettings.

```text
Too long code block will be scaled-down automatically. ------------>
```
```text
Too long code block will be scaled-down automatically. ------------------------>
```
```text
Too long code block will be scaled-down automatically. ------------------------------------------------>
```

---

##### <!--fit--> Auto-fitting header (only for [Marp Core][marp-core])
##### <!--fit--> is available by annotating `<!--fit-->` in headings.

<br />

```html
## <!--fit--> Auto-fitting header (only for Marp Core)
```

---

## [Theme CSS](https://marpit.marp.app/theme-css)

Marp uses `<section>` as the container of each slide. And others are same as styling for plain Markdown. The customized theme can use in [Marp CLI][marp-cli] and [Marp for VS Code][marp-vscode].

```css
/* @theme your-theme */

@import 'default';

section {
  /* Specify slide size */
  width: 960px;
  height: 720px;
}

h1 {
  font-size: 30px;
  color: #c33;
}
```

---

## [Tweak style in Markdown](https://marpit.marp.app/theme-css?id=tweak-style-through-markdown)

`<style>` tag in Markdown will work in the context of theme CSS.

```markdown
---
theme: default
---

<style>
section {
  background: yellow;
}
</style>

Re-painted yellow background, ha-ha.
```

> You can also add custom styling by class like `section.custom-class { ... }`.
> Apply style through `<!-- _class: custom-class -->`.

---

## [Scoped style](https://marpit.marp.app/theme-css?id=scoped-style)

If you want one-shot styling for current page, you can use `<style scoped>`.

```markdown
<style scoped>
a {
  color: green;
}
</style>

![Green link!](https://marp.app/)
```

<style scoped>
a { color: green; }
</style>

---

# Enjoy writing slides! :v: <!--fit-->

##### ![w:1em h:1em](https://avatars1.githubusercontent.com/u/20685754?v=4)  Marp: Markdown presentation ecosystem — https://marp.app/

###### by Marp Team ([@marp-team][marp-team])