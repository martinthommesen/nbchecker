# nettvern-check

[![CI](https://github.com/martinthommesen/nettvern-check/actions/workflows/ci.yml/badge.svg)](https://github.com/martinthommesen/nettvern-check/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/martinthommesen/nettvern-check/badge)](https://scorecard.dev/viewer/?uri=github.com/martinthommesen/nettvern-check)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Check whether Telenor's Nettvern, Nettvern+ or SafeZone is blocking a domain or IP address.

> **Status:** early development. There is no release yet.

## Install

Download the file for your platform (Windows, macOS or Linux) from the
[latest release](https://github.com/martinthommesen/nettvern-check/releases/latest).
It is a single program with nothing else to install.

Each release includes a `checksums.txt` file and a signed build provenance
attestation, so you can check that the file you downloaded was built from this
repository:

```sh
gh attestation verify <downloaded-file> --repo martinthommesen/nettvern-check
```

## Usage

Coming soon.

## Contributing

Bug reports, wrong results and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get started, and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

To report a security problem, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Disclaimer

This is an independent project. It is not made, endorsed or supported by
Telenor. Nettvern, Nettvern+ and SafeZone are names used by Telenor. Results are
a best-effort check and can be wrong; if you think one is, please
[report it](https://github.com/martinthommesen/nettvern-check/issues/new/choose).

## License

[MIT](LICENSE)
