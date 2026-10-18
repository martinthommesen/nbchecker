# Contributing to nettvern-check

Thanks for helping. Bug reports, wrong results, documentation fixes and code
are all welcome.

## Reporting problems

Use the [issue forms](https://github.com/martinthommesen/nettvern-check/issues/new/choose).
For wrong results, the most useful details are the domain or IP you checked,
which Telenor filter you have (Nettvern, Nettvern+ or SafeZone), and the full
output of the program.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

You need [Go](https://go.dev/dl/) (the version in `go.mod`) and, optionally,
[golangci-lint](https://golangci-lint.run/welcome/install/) v2.

```sh
git clone https://github.com/martinthommesen/nettvern-check.git
cd nettvern-check
go build ./...
go test ./...
```

Before opening a pull request, run the same checks CI runs:

```sh
gofmt -l .          # should print nothing
go vet ./...
go test -race ./...
golangci-lint run
```

Most of the checker's behaviour depends on being on a Telenor connection with a
filter turned on. Tests should not need that: put network access behind an
interface and test the logic with recorded or fake responses. If you verified a
change on a real Telenor connection, say so in the pull request.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, and add or update tests.
3. Write commit messages in the imperative ("Add SafeZone check", not "Added").
4. Fill in the pull request template. CI must pass before a review.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).

## Releases

Maintainers release by pushing a tag such as `v1.2.3` to `main`. The release
workflow builds the binaries with GoReleaser, publishes them with checksums and
build provenance attestations, and writes the release notes from merged pull
requests.
