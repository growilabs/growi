---
"@growi/core": patch
---

Make `omitDuplicateAreaPathFromPaths` and `omitDuplicateAreaPageFromPages` treat each path literally. They used to build a regular expression from the raw path, so a path containing a character such as `+` or `(` threw a `SyntaxError`, and a `.` in a path matched any character, which could drop an unrelated path.
