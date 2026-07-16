---
"@growi/core": minor
---

Rename and prune AI-related access token scopes

- Renamed the user-feature scope `features:ai_assistant` → `features:ai` (read/write). The constants `SCOPE.READ/WRITE.FEATURES.AI_ASSISTANT` are now `SCOPE.READ/WRITE.FEATURES.AI`, and the scope strings are `read:features:ai` / `write:features:ai`.
- Removed the now-unused admin scope `admin:ai_integration` (read/write); the admin AI integration screen has been removed.

BREAKING: access tokens previously granted `read|write:features:ai_assistant` no longer match the renamed scope and will lose access to AI endpoints until re-granted (or remapped via migration). Tokens carrying `read|write:admin:ai_integration` retain a now-meaningless scope string.
