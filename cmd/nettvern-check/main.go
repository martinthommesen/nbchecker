// Command nettvern-check tells you whether Telenor's Nettvern or Nettvern+
// DNS filters block a domain, URL or IP address.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"

	"github.com/martinthommesen/nettvern-check/internal/check"
)

// Set by the release build with -ldflags "-X main.version=...".
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout))
}

func run(args []string, stdin io.Reader, stdout io.Writer) int {
	fs := flag.NewFlagSet("nettvern-check", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "print results as JSON")
	showVersion := fs.Bool("version", false, "print the version and exit")
	fs.Usage = func() {
		out{fs.Output()}.f(`Usage: nettvern-check [--json] <domain|url|ip> ...

Checks whether Telenor's Nettvern or Nettvern+ blocks each target, by asking
their DNS servers directly. Run it on a Telenor connection.

Run without arguments to type targets one at a time. With --json and no
arguments, targets are read from standard input, one per line.

Exit status: 0 if nothing is blocked, 1 if anything is blocked, 2 if a
filter could not be checked or on other errors.

`)
		fs.PrintDefaults()
	}
	o := out{stdout}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *showVersion {
		o.f("nettvern-check %s (%s, %s)\n", version, commit, date)
		return 0
	}

	ctx := context.Background()
	c := check.New()

	targets := fs.Args()
	if len(targets) == 0 {
		if !*asJSON {
			return interactive(ctx, c, stdin, stdout)
		}
		// With --json and no arguments, read targets from stdin, one per
		// line, so the output stays machine-readable.
		sc := bufio.NewScanner(stdin)
		for sc.Scan() {
			if t := strings.TrimSpace(sc.Text()); t != "" {
				targets = append(targets, t)
			}
		}
		if err := sc.Err(); err != nil {
			o.f("reading targets: %v\n", err)
			return 2
		}
	}

	var results []check.Result
	for _, t := range targets {
		results = append(results, c.Check(ctx, t))
	}
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(toJSON(c.Status(ctx), results)); err != nil {
			return 2
		}
	} else {
		o.f("Your computer's DNS filter: %s\n", c.Status(ctx))
		for _, r := range results {
			o.ln()
			printResult(stdout, r)
		}
	}
	return exitCode(results)
}

func interactive(ctx context.Context, c *check.Checker, stdin io.Reader, stdout io.Writer) int {
	o := out{stdout}
	o.f("nettvern-check %s\n", version)
	o.f("Your computer's DNS filter: %s\n\n", c.Status(ctx))
	sc := bufio.NewScanner(stdin)
	var results []check.Result
	for {
		o.f("Domain, URL or IP to check (empty line to quit): ")
		if !sc.Scan() {
			o.ln()
			if sc.Err() != nil {
				return 2
			}
			return exitCode(results)
		}
		t := strings.TrimSpace(sc.Text())
		if t == "" {
			return exitCode(results)
		}
		r := c.Check(ctx, t)
		results = append(results, r)
		o.ln()
		printResult(stdout, r)
		o.ln()
	}
}

func exitCode(results []check.Result) int {
	code := 0
	for _, r := range results {
		if r.Blocked() {
			code = 1
		}
	}
	for _, r := range results {
		if r.Checked && anyFilterFailed(r) {
			return 2 // an incomplete check must not pass as clean
		}
	}
	return code
}

func anyFilterFailed(r check.Result) bool {
	for _, f := range r.Filters {
		if f.Err != nil {
			return true
		}
	}
	return false
}

func allFiltersFailed(r check.Result) bool {
	for _, f := range r.Filters {
		if f.Err == nil {
			return false
		}
	}
	return len(r.Filters) > 0
}

// out writes to the terminal. A failed write to stdout has no useful
// recovery, so errors are dropped here once instead of at every call.
type out struct{ w io.Writer }

func (o out) f(format string, a ...any) { _, _ = fmt.Fprintf(o.w, format, a...) }
func (o out) ln(a ...any)               { _, _ = fmt.Fprintln(o.w, a...) }

func printResult(w io.Writer, r check.Result) {
	o := out{w}
	o.ln(r.Host)
	for _, n := range r.Notes {
		o.ln("  " + n)
	}
	if !r.Checked {
		return
	}
	for _, f := range r.Filters {
		o.f("  %-15s %s\n", f.Filter+":", filterLine(f))
	}
	sys := "could not look it up"
	if r.SysErr == nil {
		sys = r.System.Describe() + answers(r.System)
	}
	o.f("  %-15s %s\n", "This computer:", sys)
	switch {
	case r.TruthErr != nil:
		o.f("  %-15s could not reach an unfiltered resolver (%v)\n", "Real answer:", r.TruthErr)
	case !r.Exists:
		o.f("  %-15s the domain does not exist\n", "Real answer:")
	default:
		o.f("  %-15s %s\n", "Real answer:", shortList(r.Truth, 4))
	}
	if allFiltersFailed(r) {
		o.ln("  Telenor's DNS servers did not answer. They only answer Telenor customers, so run this on a Telenor connection, with any work VPN switched off.")
	}
}

// shortList joins the first n items and counts the rest, so big CDN
// answers stay on one line.
func shortList(items []string, n int) string {
	if len(items) <= n {
		return strings.Join(items, ", ")
	}
	return fmt.Sprintf("%s and %d more", strings.Join(items[:n], ", "), len(items)-n)
}

func filterLine(f check.FilterResult) string {
	if f.Err != nil {
		return "no answer from its servers"
	}
	return f.Verdict.Describe() + answers(f.Verdict)
}

func answers(v check.Verdict) string {
	if !v.Blocked || len(v.Answers) == 0 {
		return ""
	}
	return " → " + strings.Join(v.Answers, ", ")
}

type jsonFilter struct {
	Filter  string   `json:"filter"`
	Server  string   `json:"server,omitempty"`
	Blocked bool     `json:"blocked"`
	Reason  string   `json:"reason,omitempty"`
	Detail  string   `json:"detail,omitempty"`
	Answers []string `json:"answers,omitempty"`
	Error   string   `json:"error,omitempty"`
}

type jsonResult struct {
	Target   string       `json:"target"`
	Host     string       `json:"host"`
	IsIP     bool         `json:"is_ip"`
	Blocked  bool         `json:"blocked"`
	Exists   bool         `json:"exists"`
	Truth    []string     `json:"real_answer,omitempty"`
	TruthErr string       `json:"real_answer_error,omitempty"`
	Filters  []jsonFilter `json:"filters,omitempty"`
	System   *jsonFilter  `json:"this_computer,omitempty"`
	Notes    []string     `json:"notes,omitempty"`
}

func toJSON(status string, rs []check.Result) any {
	out := struct {
		Version string       `json:"version"`
		OS      string       `json:"os"`
		Status  string       `json:"computer_dns_filter"`
		Results []jsonResult `json:"results"`
	}{Version: version, OS: runtime.GOOS + "/" + runtime.GOARCH, Status: status}
	for _, r := range rs {
		jr := jsonResult{Target: r.Target, Host: r.Host, IsIP: r.IsIP, Blocked: r.Blocked(), Exists: r.Exists, Truth: r.Truth, Notes: r.Notes}
		if r.TruthErr != nil {
			jr.TruthErr = r.TruthErr.Error()
		}
		for _, f := range r.Filters {
			jr.Filters = append(jr.Filters, verdictJSON(f.Filter, f.Server, f.Verdict, f.Err))
		}
		if r.Checked { // an IP with no reverse name was never looked up
			sys := verdictJSON("this computer", "", r.System, r.SysErr)
			jr.System = &sys
		}
		out.Results = append(out.Results, jr)
	}
	return out
}

func verdictJSON(name, server string, v check.Verdict, err error) jsonFilter {
	j := jsonFilter{Filter: name, Server: server, Blocked: v.Blocked, Reason: string(v.Reason), Detail: v.Detail, Answers: v.Answers}
	if err != nil {
		j.Error = err.Error()
	}
	return j
}
