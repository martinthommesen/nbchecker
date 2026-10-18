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

Run it on a Telenor connection (home broadband or mobile data) with any work
VPN switched off. Telenor's filtering DNS servers only answer Telenor customers.

Double-click the program, or run it in a terminal without arguments, and type
domains one at a time. You can also pass domains, URLs or IP addresses
directly:

```console
$ nettvern-check tiktokvip.cyou donutbasefinder.com
Your computer's DNS filter: Nettvern

tiktokvip.cyou
  Nettvern:       blocked by Nettvern → nettvern-info.telenor.net, 148.123.15.44
  Nettvern+:      blocked by Nettvern+ → nettvernpluss-info.telenor.net, 148.123.15.2
  This computer:  blocked by Nettvern → nettvern-info.telenor.net, 148.123.15.44
  Real answer:    148.66.6.83

donutbasefinder.com
  Nettvern:       not blocked
  Nettvern+:      blocked by Nettvern+ → nettvernpluss-info.telenor.net, 148.123.15.2
  This computer:  not blocked
  Real answer:    196.251.107.204
```

| Flag | |
|---|---|
| `--json` | Print the results as JSON. With no arguments, read targets from standard input, one per line |
| `--version` | Print the version |

The exit status is 0 if nothing is blocked, 1 if anything is blocked and 2 if
Telenor's DNS servers could not be reached.

### What it checks

- **Nettvern** and **Nettvern+** are asked directly, through their DNS servers
  (`148.122.16.253`, `148.122.164.253` and `148.122.16.252`, `148.122.164.252`,
  plus their IPv6 addresses). You see both answers whichever one you have
  switched on.
- **This computer** is what your own DNS answers, which is what your browser
  sees. The first line says which Telenor filter your computer goes through.
- **Real answer** comes from unfiltered DNS-over-HTTPS (Cloudflare, then Google).

Telenor answers a blocked domain with a CNAME that names the reason:
`nettvern-info.telenor.net` (Nettvern), `nettvernpluss-info.telenor.net`
(Nettvern+) or `dns-block.telenor.net` (blocked for every customer on legal
grounds, such as a court order). It also recognises Cisco Umbrella block pages,
which many work networks use.

Nettvern and Nettvern+ only filter DNS. An IP address you connect to directly
is never blocked by them, so for an IP address the checker looks up its reverse
DNS name and checks that instead.

SafeZone support is not confirmed yet. If you have SafeZone, please
[open an issue](https://github.com/martinthommesen/nettvern-check/issues/new/choose)
with the program's `--json` output.

## Building from source

```sh
go install github.com/martinthommesen/nettvern-check/cmd/nettvern-check@latest
```

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
