---
"@growi/core": patch
---

Fix page operations and v5 page migration failing for page paths that contain non-ASCII whitespace (e.g. U+3000 IDEOGRAPHIC SPACE)

Node.js 24's `RegExp.escape()` escapes non-ASCII whitespace (code points >= U+0100, such as U+3000) into `\uXXXX` form, which MongoDB's PCRE2 engine does not support (error 51091). Added `escapeStringForMongoRegex()`, which escapes only regex metacharacters and passes other characters through literally, and used it wherever the resulting pattern is sent to MongoDB.
