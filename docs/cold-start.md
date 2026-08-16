# The cold-start check, and the known react-hooks findings

> Moved out of `AGENTS.md` unchanged.

## Cold-start check (the only thing that sees a white screen)

```bash
bun run --cwd packages/frontend build          # produces dist/
bun run --cwd packages/frontend check:cold-start / /properties
bun run --cwd packages/frontend check:cold-start:test   # mutation-tests the check
```

`packages/frontend/scripts/check-cold-start.mjs` loads the exported web app in a
REAL headed browser with a fresh profile and asserts it actually **rendered**.

**Run it after touching anything in the boot path**: `app/_layout.tsx`, the
providers under `context/`, the readiness and splash gate, and after any change
the React Compiler lint rules prompt in those files.

Why it exists: nothing else here can see a white-screen boot. `tsc` passes,
`jest` passes, `expo export` succeeds, and the app still mounts nothing. A
boot-mounted component calling a suspenseful hook deadlocks the render, so the
init effect never runs and the promise never resolves: a blank page with ZERO
console output. Provider ordering fails the same silent way.

Four properties worth keeping if you edit it:

- It asserts `document.visibilityState === 'visible'` **before** any verdict and
  exits INCONCLUSIVE (3) otherwise. A backgrounded tab pauses
  `requestAnimationFrame`, which presents exactly as "blank", a false reading
  that has cost this ecosystem a debugging session.
- It asserts rendered CONTENT, not merely that nothing threw. "Nothing threw" is
  not the property.
- **It fails on any error logged during boot, because AN ERROR BOUNDARY IS
  CONTENT.** A content assertion cannot tell a booted app from a caught crash:
  React's boundary renders "Something went wrong" and logs to `console.error`,
  throwing no uncaught exception. Measured 2026-08-10 on `/explore` — an
  infinite render loop produced 33 elements, a visible error, and **exit 0**.
  The two channels differ and only one used to be gated: `pageErrors`
  (`Runtime.exceptionThrown`) is uncaught and usually means nothing mounted;
  `consoleErrors` (`Runtime.consoleAPICalled`, `type: 'error'`) is what a
  boundary produces. The allow-list of benign messages is deliberately EMPTY,
  and that is a measurement — eight routes on `main` produced zero console
  errors, so strictness costs nothing. Prefer fixing the source over adding an
  entry; a gate that reds on noise gets switched off, and an off gate is worse
  than the hole.
- It carries a mutation test **per failing condition** — a broken entry bundle
  (nothing mounts) and an injected console error (a caught crash that still
  renders) — so it can tell "ran and found nothing" from "did not run". Add a
  condition, add a mutation only it catches, and confirm the others still pass.

**Standing rule when reading its output, or any check's here: print the full
output and the exit code.** Do not ask a grep whether it matched, because an
empty match reads identically to a pass. That mistake was made three separate
times while building this.

## Known react-hooks findings (frontend)

`eslint-plugin-react-hooks` v7 runs the React Compiler's rules statically.
**This app does not enable the compiler** (there is no `experiments.reactCompiler`
in `app.config.js`), so separate the two kinds before "fixing" anything:
`set-state-in-effect` and `rules-of-hooks` are genuine either way, while
`immutability`, `refs` and `preserve-manual-memoization` reason about a
transformation that does not run here.

`react-hooks/immutability` is switched off for
`components/SindiExplanationBottomSheet.tsx` in `eslint.config.js`, with the
premise and a revisit condition written there and beside `experiments` in
`app.config.js`. Do not widen it.

**Open, deliberately deferred: `context/NotificationContext.tsx`, 2 findings.**
`loadNotifications` opens with a synchronous
`setState({ isLoading: true, error: null })` before its first `await`, called
from an effect, which is a real cascading render on mount. Unlike `ProfileContext`
(fixed by deleting dead API) this state is LIVE, since
`app/(tabs)/inbox/index.tsx` consumes `isLoading` and `error`, so the fix is to
move the notifications list to React Query, which is already the design this
file's own notifications section describes (refetch-on-focus plus invalidation);
the hand-rolled `useState` is the drift. `notifications`, `unreadCount`,
`isLoading` and `error` become query state, while `preferences`,
`hasPermission`, `badgeCount` and `scheduledNotifications` are device state and
stay.

**It was not done because it cannot be verified without an authenticated
session.** Unauthenticated, `loadNotifications` returns at its guard and the path
never executes, so the cold-start check above cannot reach it. Get a session
first; do not ship it on reasoning alone. The same applies to
`SindiExplanationBottomSheet:136`.

