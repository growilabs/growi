---
"@growi/core": major
---

Rename `IPage.ttlTimestamp` to `IPage.wipExpiredAt` and change its meaning

WIP page expiry is no longer enforced by a MongoDB TTL index (which deleted pages without running application code, leaving `descendantCount` inflated and empty placeholder pages orphaned). It is now application-driven, so the stored value changed meaning as well as name:

- old `ttlTimestamp` — the instant the page was made WIP; the TTL index supplied the duration via `expireAfterSeconds`.
- new `wipExpiredAt` — the absolute instant the page expires, computed up front.

BREAKING: consumers reading or writing `IPage.ttlTimestamp` must switch to `wipExpiredAt` and must not treat it as "when the page became WIP". A GROWI-side migration converts existing stored values.
