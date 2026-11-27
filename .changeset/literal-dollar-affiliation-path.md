---
'@growi/core': patch
---

`convertToNewAffiliationPath` now keeps `$&`, `$$`, `` $` `` and `$'` in the new path as written, instead of expanding them as `String.prototype.replace` patterns.
