# MongoDB Regex Escaping

## RegExp.escape() must not be used for MongoDB-bound regex patterns

Node.js 24's built-in `RegExp.escape()` escapes non-ASCII whitespace (code points
≥ U+0100, e.g. U+3000 IDEOGRAPHIC SPACE) into `\uXXXX` form. MongoDB's PCRE2 engine
does **not** support `\u`, so such a pattern throws:

```
Regular expression is invalid: PCRE2 does not support \L, \l, \N{name}, \U, or \u
  code: 51091
```

This breaks page creation, v5 page migration, page listing, etc. for any path that
contains those characters. (`escape-string-regexp`, used before the v7.5.0 refactor,
passed non-ASCII characters through literally and did not have this problem.)

## The Rule

When a regex is sent to **MongoDB** — used as a `$regex` value, or wrapped in
`new RegExp(...)` and assigned to a query field (`path`, `name`, …) in a Mongoose
`find` / `updateMany` / `aggregate` / `count` / `bulkWrite` — escape the dynamic part
with **`escapeStringForMongoRegex()`** from `@growi/core/dist/utils`, never `RegExp.escape()`.

`escapeStringForMongoRegex()` escapes only regex metacharacters and passes every other
character through literally (equivalent to `escape-string-regexp` v5), so its output
never contains `\u` and is safe for PCRE2.

```typescript
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';

// ❌ WRONG — pattern goes to MongoDB
Page.find({ path: new RegExp(`^${RegExp.escape(path)}`) });

// ✅ CORRECT
Page.find({ path: new RegExp(`^${escapeStringForMongoRegex(path)}`) });
```

## Exception: in-process JS regex is fine

`RegExp.escape()` is acceptable for regexes evaluated **in-process by V8** — i.e.
`.test()` / `.replace()` / `.match()` on local strings that are never sent to MongoDB.
V8 interprets `\uXXXX` correctly, so there is no need to change those call sites.

See `escapeStringForMongoRegex` (`packages/core/src/utils/escape-string-for-regex.ts`)
and issue #11235 for background.
