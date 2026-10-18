package check

import (
	"testing"

	"github.com/miekg/dns"
)

func msg(t *testing.T, rcode int, rrs ...string) *dns.Msg {
	t.Helper()
	m := new(dns.Msg)
	m.Rcode = rcode
	for _, s := range rrs {
		rr, err := dns.NewRR(s)
		if err != nil {
			t.Fatalf("bad RR %q: %v", s, err)
		}
		m.Answer = append(m.Answer, rr)
	}
	return m
}

// The answers below are copied from a real probe run on Telenor fiber.
func TestClassify(t *testing.T) {
	tests := []struct {
		name        string
		m           *dns.Msg
		truthExists bool
		blocked     bool
		reason      Reason
		detail      string
	}{
		{"nettvern", msg(t, dns.RcodeSuccess,
			"www.roblox.ly. 5 IN CNAME nettvern-info.telenor.net.",
			"nettvern-info.telenor.net. 160 IN A 148.123.15.44"), true, true, ReasonNettvern, ""},
		{"nettvern+", msg(t, dns.RcodeSuccess,
			"donutbasefinder.com. 5 IN CNAME nettvernpluss-info.telenor.net.",
			"nettvernpluss-info.telenor.net. 145 IN A 148.123.15.2"), true, true, ReasonNettvernPl, ""},
		{"legal block, AAAA query with no address", msg(t, dns.RcodeSuccess,
			"thepiratebay.org. 5 IN CNAME dns-block.telenor.net."), true, true, ReasonLegal, ""},
		{"case-insensitive target", msg(t, dns.RcodeSuccess,
			"x.example. 5 IN CNAME Nettvern-Info.Telenor.NET."), true, true, ReasonNettvern, ""},
		{"umbrella phishing", msg(t, dns.RcodeSuccess,
			"internetbadguys.com. 0 IN A 146.112.61.108"), true, true, ReasonUmbrella, "phishing"},
		{"umbrella mapped AAAA", msg(t, dns.RcodeSuccess,
			"www.roblox.ly. 0 IN AAAA ::ffff:146.112.61.107"), true, true, ReasonUmbrella, "malware"},
		{"umbrella proxy", msg(t, dns.RcodeSuccess,
			"frame97.com. 5 IN A 146.112.56.167"), true, true, ReasonProxied, ""},
		{"ordinary CNAME", msg(t, dns.RcodeSuccess,
			"www.roblox.ly. 300 IN CNAME roblox.ly.",
			"roblox.ly. 300 IN A 202.170.75.201"), true, false, ReasonNone, ""},
		{"ordinary A", msg(t, dns.RcodeSuccess,
			"example.com. 300 IN A 104.20.23.154"), true, false, ReasonNone, ""},
		{"filter-only NXDOMAIN", msg(t, dns.RcodeNameError), true, true, ReasonNXDomain, ""},
		{"real NXDOMAIN", msg(t, dns.RcodeNameError), false, false, ReasonNone, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := Classify(tt.m, tt.truthExists)
			if v.Blocked != tt.blocked || v.Reason != tt.reason || v.Detail != tt.detail {
				t.Errorf("got blocked=%v reason=%q detail=%q, want %v %q %q",
					v.Blocked, v.Reason, v.Detail, tt.blocked, tt.reason, tt.detail)
			}
		})
	}
}

func TestMerge(t *testing.T) {
	a := Verdict{Answers: []string{"1.2.3.4"}}
	b := Verdict{Blocked: true, Reason: ReasonNettvern, Answers: []string{"nettvern-info.telenor.net", "1.2.3.4"}}
	got := Merge(a, b)
	if !got.Blocked || got.Reason != ReasonNettvern {
		t.Fatalf("Merge lost the block: %+v", got)
	}
	if len(got.Answers) != 2 {
		t.Errorf("answers not deduplicated: %v", got.Answers)
	}
}

func TestNormalize(t *testing.T) {
	tests := []struct {
		in   string
		host string
		ip   bool
	}{
		{"Example.COM.", "example.com", false},
		{"https://user@www.vg.no:8443/path?q=1", "www.vg.no", false},
		{"vg.no/nyheter", "vg.no", false},
		{"1.2.3.4", "1.2.3.4", true},
		{"[2001:db8::1]:443", "2001:db8::1", true},
		{"http://[2001:db8::1]/", "2001:db8::1", true},
		{"https://Blåbær.no/", "xn--blbr-roah.no", false},
	}
	for _, tt := range tests {
		host, ip := Normalize(tt.in)
		if host != tt.host || ip != tt.ip {
			t.Errorf("Normalize(%q) = %q, %v; want %q, %v", tt.in, host, ip, tt.host, tt.ip)
		}
	}
}
