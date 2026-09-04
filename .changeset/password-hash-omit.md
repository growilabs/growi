---
"@growi/core": minor
---

Omit passwordHash from serialized user output (omitInsecureAttributes) and add passwordHash to IUser. Export a shared INSECURE_USER_ATTRIBUTES list and isInsecureUserAttribute() so every user serializer (including the app's Prisma users extension) derives its omission set from one source instead of a hand-copied field list.
