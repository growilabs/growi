---
"@growi/core": patch
---

Make `isCreatablePage` run in linear time. The page depth limit (130 levels) is now checked by counting path segments instead of a regular expression whose time grew exponentially with the number of slashes, and the trailing `/edit` / `.md` and spaces-around-slash checks no longer slow down quadratically on long paths. The depth check is exported from `page-path-utils` as `exceedsMaxPageDepth`.
