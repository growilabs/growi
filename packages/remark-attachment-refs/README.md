# remark-attachment-refs

Examples
-------

### List attachments

![refs](https://user-images.githubusercontent.com/1638767/64986526-1b23be00-d902-11e9-9e33-65ad15767920.gif)

### Extract image attachments

![refsimg](https://user-images.githubusercontent.com/1638767/64986528-1c54eb00-d902-11e9-95dc-2784fa15746c.gif)

<!-- ### Image Carousel

![lightbox](https://user-images.githubusercontent.com/1638767/64986530-1e1eae80-d902-11e9-8711-b5df3572769c.gif) -->


Usage
------

### `$ref` tag

#### Syntax

```
$ref(file.txt)
$ref(file.txt, page=/somewhere/page)
$ref(5f17286fd7fbb1104fdbd111, page=/somewhere/page)
```

#### Options

- **`file`** : File name of reference file (default: the first argument)
- **`id`** : Attachment ID of reference file (default: the first argument)
- *`page`* : Target page path of reference file (default: current page)


### `$refs` tag

#### Syntax

```
$refs(/somewhere/page, regexp=/^file.*\.txt$/)
```

#### Options

- *`page`* : Target page path to search attachments (default: the first argument || current page)
- *`prefix`* : Page prefix to search attachments
- *`depth`* : page depth to search attachments
- *`regexp`* : Regular Expression to retrieve
- (TBD) *`format`* : File format filtering


### `$refimg` tag

#### Syntax

```
$refimg(pict.png, width=50%, alt=Pic)
$refimg(5f17286fd7fbb1104fdbd111, width=50%, alt=Pic)
```

#### Options

- **`file`** : File name of reference file (default: the first argument)
- **`id`** : Attachment ID of reference file (default: the first argument)
- *`width`* : width
- *`height`* : height
- *`max-width`* : max-width
- *`max-height`* : max-height
- *`alt`* : alt text


### `$refsimg` tag

#### Syntax

```
$refsimg(/somewhere/page, regexp=/^.*\.png$/, max-width=200)
$refsimg(prefix=/somewhere, grid=autofill, grid-gap=1px)
```

#### Options

- *`page`* : Target page path to search attachments (default: the first argument || current page)
- *`prefix`* : Page prefix to search attachments
- *`depth`* : page depth to search attachments
- *`regexp`* : Regular Expression to retrieve
- (TBD) *`format`* : File format filtering
- *`width`* : width
  - e.g. `width=200px`, `width=50%`
- *`height`* : height
  - e.g. `height=100px`
- *`max-width`* : max-width
  - e.g. `max-width=200px`, `max-width=50%`
- *`max-height`* : max-height
  - e.g. `max-height=100px`
- *`display`* : `display` property for image (use `display: block` when undefined)
  - This option is disabled when `grid` option is set.
- *`grid`* : Grid layout settings
  - `autofill` : Grid layout with auto filling with 64px tracks
  - `autofill-xs` : Grid layout with auto filling with 32px tracks
  - `autofill-sm` : Grid layout with auto filling with 48px tracks
  - `autofill-md` : Grid layout with auto filling with 64px tracks
  - `autofill-lg` : Grid layout with auto filling with 128px tracks
  - `autofill-xl` : Grid layout with auto filling with 192px tracks
  - `col-2` : Grid layout with 2 columns
  - `col-3` : Grid layout with 3 columns
  - `col-4` : Grid layout with 4 columns
  - `col-5` : Grid layout with 5 columns
  - `col-6` : Grid layout with 6 columns
- *`grid-gap`* : Grid gap
  - e.g. `grid-gap=1px`
<!-- - *`no-carousel`* : Omit carousel function and just show images -->


### `$gallery` tag

![gallery](https://user-images.githubusercontent.com/1638767/64987263-d00aaa80-d903-11e9-83f6-7669e9945015.png)

Short-hand for `$refsimg(grid=col4, grid-gap=1px)`.

#### Syntax

```
$gallery(prefix=/somewhere/page)
```

#### Options

See the options of `refsimg`


TODO
-----

- [ ] `format` option

[GROWI]: https://github.com/growilabs/growi
