# Source

- **Constructed** (see `constructed-empty-pulls.json.meta.md`). Commit
  message carries no `Merge of #{N}` line, so combined with
  `constructed-empty-pulls.json` (`GET commits/{sha}/pulls` → `[]`) this is
  the genuine "no PR at all" case (Step B's "Still no PR. A direct push to
  a feature branch.").
- **Captured**: 2026-09-16 (constructed, not fetched).
