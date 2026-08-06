# kiro-impl Orchestration Policy

This layers on top of the `kiro-impl` skill (`.claude/skills/kiro-impl/SKILL.md`).
It does **not** replace that skill's TDD gate (RED → GREEN) or its per-task
reviewer / debug loop — it only sets *how the work is distributed across models*
when the cc-sdd workflow runs here.

"Opus / Fable / Sonnet tier" is written by tier on purpose, not pinned to a
version id, so it survives model releases.

## 1. On a strong main-loop model, orchestrate first

When the session's main-loop model is an **Opus** or **Fable** tier model and
`/kiro-impl` is invoked, treat orchestration — not typing implementation — as the
primary duty:

- Run `kiro-impl` in **autonomous mode** (a fresh implementer subagent per task)
  rather than implementing in the main context, even when the argument list would
  otherwise select manual mode, unless the user explicitly asked for manual mode.
- Spend the strong main-loop model on planning, task dispatch, review synthesis,
  and GO/NO-GO judgement — the work that benefits most from the stronger model —
  and delegate the mechanical implementation to subagents.

On a lighter main-loop model, in-context (manual-mode) implementation is fine;
this rule does not force subagent dispatch there.

## 2. Match the implementer subagent's model to task difficulty

Choose each implementer subagent's model from the task's difficulty (consistent
with the tiers in `.claude/rules/performance.md`):

- **Opus** — architectural tasks, tricky debugging, subtle correctness, anything
  where a wrong shape is expensive to unwind.
- **Sonnet** — straightforward, mechanical, well-specified tasks.

## 3. Final review runs adversarially on Opus

After all tasks are implemented, the feature-level review/validation gate
(`/kiro-validate-impl`, applying the `kiro-review` protocol) must run on an
**Opus** tier model, as a **fresh** subagent — never the implementer reviewing
its own work. This sits on top of the per-task reviewer, not instead of it: the
per-task gate catches local defects; this final adversarial pass is where a
strong, independent model looks at the whole feature.
