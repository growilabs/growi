---
"@growi/core": minor
---

Add `features:user` and `features:user_group` access-token scopes (read/write). These separate "reading other users'/groups' directory information" from the self-oriented `user_settings:info` scope, which previously over-granted such reads.
