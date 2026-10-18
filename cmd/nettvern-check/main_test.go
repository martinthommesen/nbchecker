package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/martinthommesen/nettvern-check/internal/check"
)

func TestVersion(t *testing.T) {
	var out bytes.Buffer
	if code := run([]string{"--version"}, strings.NewReader(""), &out); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if !strings.HasPrefix(out.String(), "nettvern-check dev") {
		t.Errorf("got %q", out.String())
	}
}

func TestBadFlag(t *testing.T) {
	var out bytes.Buffer
	if code := run([]string{"--nope"}, strings.NewReader(""), &out); code != 2 {
		t.Errorf("exit %d, want 2", code)
	}
}

func TestExitCode(t *testing.T) {
	ok := check.Result{Checked: true, Filters: []check.FilterResult{{Filter: "Nettvern"}}}
	blocked := check.Result{Checked: true, Filters: []check.FilterResult{{Filter: "Nettvern", Verdict: check.Verdict{Blocked: true, Reason: check.ReasonNettvern}}}}
	unreachable := check.Result{Checked: true, Filters: []check.FilterResult{{Filter: "Nettvern", Err: errors.New("timeout")}}}
	ip := check.Result{IsIP: true}

	for name, tt := range map[string]struct {
		rs   []check.Result
		want int
	}{
		"nothing blocked": {[]check.Result{ok, ip}, 0},
		"one blocked":     {[]check.Result{ok, blocked}, 1},
		"unreachable":     {[]check.Result{blocked, unreachable}, 2},
	} {
		if got := exitCode(tt.rs); got != tt.want {
			t.Errorf("%s: exitCode = %d, want %d", name, got, tt.want)
		}
	}
}

func TestPrintResult(t *testing.T) {
	var out bytes.Buffer
	printResult(&out, check.Result{
		Host:    "bad.example",
		Checked: true,
		Exists:  true,
		Truth:   []string{"192.0.2.10"},
		Filters: []check.FilterResult{
			{Filter: "Nettvern"},
			{Filter: "Nettvern+", Verdict: check.Verdict{Blocked: true, Reason: check.ReasonNettvernPl, Answers: []string{"nettvernpluss-info.telenor.net", "148.123.15.2"}}},
		},
	})
	for _, want := range []string{
		"Nettvern:       not blocked",
		"Nettvern+:      blocked by Nettvern+ → nettvernpluss-info.telenor.net, 148.123.15.2",
		"Real answer:    192.0.2.10",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output missing %q:\n%s", want, out.String())
		}
	}
}

func TestPrintIPWithoutReverseName(t *testing.T) {
	var out bytes.Buffer
	printResult(&out, check.Result{Target: "http://192.0.2.1:8080/", Host: "192.0.2.1", IsIP: true, Notes: []string{"note"}})
	if strings.Contains(out.String(), "Real answer") || strings.Contains(out.String(), "This computer") {
		t.Errorf("printed DNS sections for an unchecked IP:\n%s", out.String())
	}
}

func TestJSONIncludesTruthError(t *testing.T) {
	b, err := json.Marshal(toJSON("Nettvern", []check.Result{{Host: "x.example", Checked: true, TruthErr: errors.New("doh down")}}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"real_answer_error":"doh down"`) {
		t.Errorf("JSON lacks the truth error: %s", b)
	}
}
