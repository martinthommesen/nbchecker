# nbchecker

nbchecker is a TypeScript terminal app built with Bun, Effect, and OpenTUI. It
compares DNS filters with the computer's resolver and an unfiltered DoH reference.

## Working in the repository

- `src/cli/`: the command, batch checks of arguments or standard input, flushed
  output, and exit statuses.
- `src/dns/`: DNS wire format and UDP, TCP, and DoH transports.
- `src/check/`: target normalization, provider queries, and verdicts.
- `src/report/`: text and JSON output. `src/tui/`: interactive terminal UI.
- `src/testing/`: fake Effect services and terminal fixtures. Tests should be
  deterministic and must not depend on live DNS providers.
- Use the Bun version in CI. Install with `bun install --frozen-lockfile`, then run
  `bun run check` (types, lint, tests). Review helper changes also need
  `python3 -I -B -m unittest discover -s .github/scripts -p '*_test.py'`.
- Keep commits focused. GitHub Actions must use full commit SHAs. Do not put
  credentials, private environment files, or live DNS results in commits or logs.

## Code Review Rules

1. **Verdicts need evidence.** A timeout, unavailable provider, malformed reply,
   or missing reference is not evidence of an unblocked name. NXDOMAIN indicates
   blocking only when the reference establishes that the name exists. Preserve
   the distinction between a known block signal, a clear answer, and uncertainty;
   Telenor's network-only availability is expected outside its customer network.
2. **Bound network work and release resources.** Check cancellation, deadlines,
   response identity, and socket cleanup across success, failure, and parallel
   query races. Unrelated or truncated packets must not become valid answers.
   Prefer the existing Effect services and scoped resource lifetimes.
3. **Preserve the observable contract.** Check stdout/stderr, JSON shape, batch
   exit statuses, complete output before exit, and TUI cleanup/recheck behavior.
   Intentional contract changes must agree with tests and user documentation.

For pull requests, also follow `REVIEW.md`. Report concrete introduced problems
with a triggering case and practical impact; leave mechanical style checks to CI.
