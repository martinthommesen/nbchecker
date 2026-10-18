package check

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/miekg/dns"
)

// fakeDNS serves canned answers, keyed by query name, on 127.0.0.1.
func fakeDNS(t *testing.T, answers map[string][]string) (port string) {
	t.Helper()
	pc, err := (&net.ListenConfig{}).ListenPacket(context.Background(), "udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &dns.Server{PacketConn: pc, Handler: dns.HandlerFunc(func(w dns.ResponseWriter, req *dns.Msg) {
		m := new(dns.Msg)
		m.SetReply(req)
		q := req.Question[0]
		rrs, ok := answers[q.Name]
		if !ok {
			m.Rcode = dns.RcodeNameError
		}
		for _, s := range rrs {
			rr, err := dns.NewRR(s)
			if err != nil {
				t.Errorf("bad RR %q: %v", s, err)
				continue
			}
			// Keep CNAMEs on every query type; addresses only on their own.
			if rr.Header().Rrtype == q.Qtype || rr.Header().Rrtype == dns.TypeCNAME {
				m.Answer = append(m.Answer, rr)
			}
		}
		_ = w.WriteMsg(m)
	})}
	go func() { _ = srv.ActivateAndServe() }()
	t.Cleanup(func() { _ = srv.Shutdown() })
	_, port, _ = net.SplitHostPort(pc.LocalAddr().String())
	return port
}

// fakeDoH answers DNS-over-HTTPS queries from the same kind of table.
func fakeDoH(t *testing.T, answers map[string][]string) string {
	t.Helper()
	port := fakeDNS(t, answers)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		q := new(dns.Msg)
		if err := q.Unpack(body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp, err := dns.Exchange(q, "127.0.0.1:"+port)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		b, _ := resp.Pack()
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func resolverAt(port string) *net.Resolver {
	return &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, "127.0.0.1:"+port)
	}}
}

func TestCheck(t *testing.T) {
	real := map[string][]string{
		"bad.example.":   {"bad.example. 300 IN A 192.0.2.10"},
		"worse.example.": {"worse.example. 300 IN A 192.0.2.11"},
		"good.example.":  {"good.example. 300 IN A 192.0.2.20"},
	}
	nettvern := map[string][]string{
		"bad.example.":   {"bad.example. 300 IN A 192.0.2.10"},
		"worse.example.": {"worse.example. 5 IN CNAME nettvern-info.telenor.net.", "nettvern-info.telenor.net. 60 IN A 148.123.15.44"},
		"good.example.":  {"good.example. 300 IN A 192.0.2.20"},
	}
	plus := map[string][]string{
		"bad.example.":   {"bad.example. 5 IN CNAME nettvernpluss-info.telenor.net.", "nettvernpluss-info.telenor.net. 60 IN A 148.123.15.2"},
		"worse.example.": {"worse.example. 5 IN CNAME nettvernpluss-info.telenor.net.", "nettvernpluss-info.telenor.net. 60 IN A 148.123.15.2"},
		"good.example.":  {"good.example. 300 IN A 192.0.2.20"},
	}
	// Both fake filters listen on 127.0.0.1, so each needs its own port and
	// the checker is pointed at one filter at a time.
	nPort := fakeDNS(t, nettvern)
	pPort := fakeDNS(t, plus)

	c := New()
	c.Timeout = time.Second
	c.TruthURLs = []string{fakeDoH(t, real)}
	c.Resolver = resolverAt(pPort) // this computer is behind Nettvern+

	run := func(port string, f Filter, host string) FilterResult {
		c.Port = port
		c.Filters = []Filter{f}
		return c.Check(context.Background(), host).Filters[0]
	}
	tests := []struct {
		host       string
		port       string
		filter     string
		wantReason Reason
	}{
		{"good.example", nPort, "Nettvern", ReasonNone},
		{"good.example", pPort, "Nettvern+", ReasonNone},
		{"bad.example", nPort, "Nettvern", ReasonNone},
		{"bad.example", pPort, "Nettvern+", ReasonNettvernPl},
		{"https://worse.example/login", nPort, "Nettvern", ReasonNettvern},
		{"nope.example", nPort, "Nettvern", ReasonNone}, // NXDOMAIN everywhere
	}
	for _, tt := range tests {
		got := run(tt.port, Filter{tt.filter, []string{"127.0.0.1"}}, tt.host)
		if got.Err != nil {
			t.Errorf("%s via %s: %v", tt.host, tt.filter, got.Err)
			continue
		}
		if got.Verdict.Reason != tt.wantReason || got.Verdict.Blocked != (tt.wantReason != ReasonNone) {
			t.Errorf("%s via %s: got %+v, want reason %q", tt.host, tt.filter, got.Verdict, tt.wantReason)
		}
	}

	c.Port = pPort
	c.Filters = []Filter{{"Nettvern+", []string{"127.0.0.1"}}}
	r := c.Check(context.Background(), "bad.example")
	if !r.Exists || len(r.Truth) != 1 || r.Truth[0] != "192.0.2.10" {
		t.Errorf("truth = %v exists=%v err=%v", r.Truth, r.Exists, r.TruthErr)
	}
	if r.SysErr != nil || r.System.Reason != ReasonNettvernPl {
		t.Errorf("system verdict = %+v, err %v", r.System, r.SysErr)
	}
	if !r.Blocked() {
		t.Error("Blocked() = false")
	}
}

func TestFilterUnreachable(t *testing.T) {
	c := New()
	c.Timeout = 200 * time.Millisecond
	c.Port = "9" // discard; nothing answers DNS there
	c.Filters = []Filter{{"Nettvern", []string{"127.0.0.1"}}}
	c.TruthURLs = []string{fakeDoH(t, nil)}
	c.Resolver = resolverAt(fakeDNS(t, nil))
	r := c.Check(context.Background(), "example.com")
	if r.Filters[0].Err == nil {
		t.Fatal("expected an error when no filter server answers")
	}
	if r.Exists {
		t.Error("fake truth has no records, so the name should not exist")
	}
}

func TestStatus(t *testing.T) {
	for addr, want := range map[string]string{
		"148.123.15.38": "Nettvern",
		"148.123.15.1":  "Nettvern+",
		"148.123.15.37": "none (Telenor DNS without a filter)",
	} {
		c := New()
		c.Resolver = resolverAt(fakeDNS(t, map[string][]string{
			"nettvern.telenor.net.": {"nettvern.telenor.net. 3600 IN A " + addr},
		}))
		if got := c.Status(context.Background()); got != want {
			t.Errorf("%s: Status() = %q, want %q", addr, got, want)
		}
	}
}
