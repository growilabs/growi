# @growi/vault-manager

## 1.1.0

### Minor Changes

- A clone can now be made smaller. `git clone --filter=sparse:oid=<published spec>` makes the server apply a published sparse-checkout pattern set before it builds the pack, so the excluded page bodies are never sent — measured 6.3 MB → 4.8 MB on a 20,000-page view with a quarter of the pages under `user/`, in a single request. One pattern set is published in this release: exclude `user/`. Any other filter (`blob:none`, `blob:limit`, `tree:<n>`, `object:type`, `combine:`, or a `sparse:oid` naming some other object) is refused when the clone starts, because each of them leaves the client fetching objects by name afterwards and the server does not serve those requests. See the README for the exact commands and for the limitation that a filtered clone cannot obtain the excluded pages later.

### Patch Changes

- Objects outside the requester's view are no longer served. `GIT_NAMESPACE` scopes ref advertisement but not the shared object store, and git's own reachability check for an unadvertised request assumes the requested object is a commit — so page bodies and directory listings were handed to any authenticated client that named them by object ID, whether or not that client's view contained them. Requests are now authorised against the view ref before `git upload-pack` runs, and the work a single request can demand is bounded.
- Pages whose name maps to a tree entry longer than 255 bytes no longer break the checkout of a clone.
- The documented way to exclude `user/` from a checkout now works. The previous recipe was rejected by git (cone mode cannot express an exclusion) and left an empty working tree.

## 1.0.0

### Major Changes

- First stable release, published alongside GROWI v8.0.0. GROWI Vault is generally available: users can `git clone` a GROWI wiki and receive the pages they are allowed to read as a tree of Markdown files. The vault stays read-only in this release — `git push` is rejected, and attachments, per-page metadata and history from before the feature was enabled are not exported.

## 0.1.1

### Patch Changes

- Updated dependencies [[`659c93d`](https://github.com/growilabs/growi/commit/659c93d31d24fe90b0edc777c2e586f9efdd0195), [`e2375eb`](https://github.com/growilabs/growi/commit/e2375ebb787062ad20f4f982d94a2768fb9a3ec1)]:
  - @growi/core@2.5.0
