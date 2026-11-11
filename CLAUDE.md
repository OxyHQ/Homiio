@AGENTS.md

## Claude Code

- Use plan mode before any change touching ownership or auth, migrations, the ADR contracts (`docs/adr/`) or the deploy workflow.
- Read the relevant ADR and `docs/agent-rules.md` section before designing; do not restate their rules in code comments or new docs.
- Do your work in a git worktree (`git worktree add`), never in a shared checkout, and never `git stash`: other agents edit this repo.
- Put design notes and per-issue write-ups in `docs/`, not in `AGENTS.md`; `bun run validate:agents-md` enforces its budget.
