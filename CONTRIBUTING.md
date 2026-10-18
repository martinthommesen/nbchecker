# Contributing to nbchecker

Thanks for helping. Bug reports, wrong results, documentation fixes and code
are all welcome.

## Reporting problems

Use the [issue forms](https://github.com/martinthommesen/nbchecker/issues/new/choose).
For wrong results, the most useful details are the domain or IP you checked,
which DNS filter you use, and the output of `nbchecker --json <domain>`.
Leave out anything you consider private, such as your home IP address.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

You need [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/martinthommesen/nbchecker.git
cd nbchecker
bun install
bun run start
```

Before opening a pull request, run the same checks CI runs:

```sh
bun run check    # TypeScript, Ultracite (Biome) and the tests
bun run fix      # fixes formatting and the lint problems it can
```

The code is TypeScript with [Effect](https://effect.website) and
[OpenTUI](https://github.com/sst/opentui):

- `src/cli` is the command: it prints results for scripts, with an exit
  status, or opens the interactive screen.
- `src/dns` sends DNS queries and reads the answers.
- `src/check` asks every filter and works out what each answer means.
- `src/report` turns a result into text and JSON.
- `src/tui` is the interactive screen.

Tests don't touch the network. The DNS transport and this computer's resolver
are Effect services, so tests swap in the fakes in `src/testing`, and the
screen is tested in OpenTUI's virtual terminal. `src/testing/fake-cli.ts` runs
the command on the fake network, so tests can run it as a real process with
real pipes. If you verified a change on a
real network with a filter, say which filter in the pull request.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, and add or update tests.
3. Write commit messages in the imperative ("Add SafeZone check", not "Added").
4. Fill in the pull request template. CI must pass before a review.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).

## Releases

Maintainers release by pushing a tag such as `v1.2.3` to `main`. The release
workflow builds standalone macOS and Linux binaries with GoReleaser's Bun
builder, signs and notarizes the macOS ones, publishes them with checksums and build provenance attestations,
updates the Homebrew cask in
[martinthommesen/homebrew-tap](https://github.com/martinthommesen/homebrew-tap),
and writes the release notes from merged pull requests. It stops before
publishing anything if the tagged commit isn't on `main`, if CI hasn't passed
on it, if types, lint or tests fail, or if the macOS signing secrets are
missing.

To try the release build locally, run
`goreleaser release --snapshot --clean --skip=publish`. Without the signing
secrets the macOS binaries are left unsigned.
