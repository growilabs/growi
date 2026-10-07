# Source

- **Constructed.** `GET commits/{sha}/pulls` returning `[]` is the shape
  every "no PR yet found by the direct route" branch needs (merge-queue
  commit, and a genuine no-PR direct push). No search of `growilabs/growi`
  turned up either case live at capture time (the repo's branch protection
  makes a real no-PR commit rare, and no Mergify merge-queue commit
  survives long enough to fetch — `git log --all --grep='^Merge of #'`
  found 0 matches; this repo currently merges via GitHub's own squash-merge
  UI, not Mergify's merge queue, at capture time).
- **Captured**: 2026-09-16 (constructed, not fetched).
