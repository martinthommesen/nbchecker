# nbchecker

[![CI](https://github.com/martinthommesen/nbchecker/actions/workflows/ci.yml/badge.svg)](https://github.com/martinthommesen/nbchecker/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/martinthommesen/nbchecker/badge)](https://scorecard.dev/viewer/?uri=github.com/martinthommesen/nbchecker)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Network blocker checker.** Check whether DNS filters block a domain or IP
address: Telenor Nettvern and Nettvern+, Cloudflare, Quad9, OpenDNS, AdGuard,
CleanBrowsing, and your own computer's DNS.

> **Status:** early development.

## Install

With [Homebrew](https://brew.sh) on macOS or Linux:

```sh
brew install --cask martinthommesen/tap/nbchecker
```

Or download the archive for your computer from the
[latest release](https://github.com/martinthommesen/nbchecker/releases/latest):
macOS (Apple silicon or Intel) or Linux (x64 or arm64). It holds a single
program with nothing else to install. The macOS programs are signed and
notarized by Apple, so they open without a security warning.

Each release includes a `checksums.txt` file and a signed build provenance
attestation, so you can check that a download was built from this repository:

```sh
gh attestation verify <downloaded-file> --repo martinthommesen/nbchecker
```

## Usage

Run `nbchecker` in a terminal to open its interactive screen. Type a domain,
URL or IP address and press enter. Every filter is asked at once, and the
table fills in as the answers arrive.

| Key | |
|---|---|
| `enter` | Check what you typed |
| `↑` `↓` | Select a row and see its details: the server asked, the raw answer and why it counts as blocked or not |
| `/` | Type a new check |
| `r` | Check the same target again |
| `c` | Show which filter your computer's DNS uses |
| `y` | Copy the result as text |
| `e` | Save the result as JSON in the current folder |
| `?` | Help |
| `q` | Quit (`ctrl+c` works anywhere) |

Pass targets as arguments to print the result instead. For example:

```console
$ nbchecker blocked.example
DNS filter on this computer: none detected

blocked.example  ✗ blocked by 4 of 8 filters

REFERENCE
  ✓ Your DNS                not blocked
  ✓ Real answer             203.0.113.42

SECURITY · MALWARE, PHISHING
  ? Telenor Nettvern        no answer (it only answers Telenor customers)
  ✗ Cloudflare Security     blocked with an Extended DNS Error (Censored)
  ✗ Quad9                   blocked: says the domain doesn't exist
  ✓ CleanBrowsing Security  not blocked
  ...
```

| Flag | |
|---|---|
| `--json` | Print the results as JSON |
| `--version` | Print the version |
| `--help` | Show all options |

Without arguments, and when standard input isn't a terminal, nbchecker reads
targets from it, one per line.

"Blocked by 4 of 8 filters" counts the filters that answered. When the real
answer can't be fetched, a filter saying the domain doesn't exist could be a
block or not, so the result says it couldn't tell.

When it checks targets from arguments or standard input, the exit status is 1
if anything is blocked, even when a check was incomplete. Otherwise it is 2 if
a check was incomplete, for example because a filter, your own DNS or the real
answer could not be reached, and 0 if nothing is blocked. A filter that only
answers some networks, such as Telenor's, doesn't make a check incomplete when
you are elsewhere; when nbchecker detects Nettvern or Nettvern+ on your DNS,
it expects them to answer. The interactive app always exits with 0, since one
session can check many targets.

## What it checks

Each filter's DNS servers are asked for the name's A and AAAA records, over
IPv4 and IPv6 at once, and the first server to answer is used.

| Category | Filters |
|---|---|
| Security: malware and phishing | Telenor Nettvern, Cloudflare Security (1.1.1.2), Quad9 (9.9.9.9), CleanBrowsing Security |
| Family: security plus adult content | Telenor Nettvern+, Cloudflare Family (1.1.1.3), OpenDNS FamilyShield, AdGuard Family, CleanBrowsing Family |
| Ads and trackers | AdGuard DNS |

Two reference rows come first. **Your DNS** is what your own computer's
resolver answers, which is usually what your browser sees. **Real answer**
comes from unfiltered DNS over HTTPS (Cloudflare, then Google), so no filter
on your network can change it.

An answer counts as blocked when it is one of the block answers filters are
known to give:

- a CNAME to a Telenor block page: `nettvern-info.telenor.net` (Nettvern),
  `nettvernpluss-info.telenor.net` (Nettvern+), `dns-block.telenor.net`
  (blocked for every Telenor customer on legal grounds, such as a court order)
  or `kid.telenor.net` (the police's child sexual abuse block list)
- `0.0.0.0` or `::`
- a Cisco Umbrella block page, or AdGuard Family's block page `94.140.14.35`
- an Extended DNS Error saying the name was blocked, censored or filtered,
  whatever the response code
- "this domain doesn't exist" while the real answer says it does

An address the real answer also has is the domain's own, so it never counts
as a block, even when it is `0.0.0.0`. Your own computer's resolver can't
tell a name that doesn't exist from one without an address it can use, so the
Your DNS row only counts "no address on this computer" as a block when the
real answer has an IPv4 address.

An answer pointing to Cisco Umbrella's inspection proxy is shown as
**inspected**, not blocked: the site is sent through Cisco's proxy, which may
still block some of its URLs.

The block answers of the public filters come from their documentation and
haven't all been confirmed on a live network yet. If a result looks wrong,
please [report it](https://github.com/martinthommesen/nbchecker/issues/new/choose).

### Things to know

- **Telenor's filters only answer Telenor customers.** Elsewhere they show as
  "no answer". Their answers still show in the Your DNS row if your computer
  goes through them.
- **Your connection.** nbchecker detects Nettvern and Nettvern+ on your own
  DNS from Telenor's test page. The public filters publish no such page, so
  for them only the Your DNS row tells you what your computer gets.
- **DNS filters block names, not IP addresses.** For an IP address, nbchecker
  checks its reverse DNS name instead.
- **SafeZone**, Telenor's mobile protection, filters inside Telenor's mobile
  network and has no public DNS server to ask. It only shows up in the Your
  DNS row, when the computer is online through a SafeZone phone's hotspot or
  the SafeZone VPN. SafeZone can also block IP addresses, which nbchecker
  doesn't test.
- **Browsers can differ.** A browser with secure DNS turned on asks its own
  server, so a site can open there even when your computer's DNS blocks it.
  A VPN can change the answers too.

## Building from source

You need [Bun](https://bun.sh) 1.4 or later.

```sh
git clone https://github.com/martinthommesen/nbchecker.git
cd nbchecker
bun install
bun run start            # run it
bun run build            # build a standalone binary in dist/
```

## Contributing

Bug reports, wrong results and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get started, and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

To report a security problem, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Disclaimer

This is an independent project. It is not made, endorsed or supported by
Telenor or any of the other DNS providers it checks. Product names belong to
their owners. Results are a best-effort check and can be wrong; if you think
one is, please
[report it](https://github.com/martinthommesen/nbchecker/issues/new/choose).

## License

[MIT](LICENSE)
