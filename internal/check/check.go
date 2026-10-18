package check

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
	"golang.org/x/net/idna"
)

// Filter is one of Telenor's filtering DNS services. Each is reachable over
// IPv4 and IPv6; we ask all of its addresses and use the first answer,
// because a VPN or firewall often blocks one address family.
type Filter struct {
	Name    string
	Servers []string
}

var Filters = []Filter{
	{"Nettvern", []string{"148.122.16.253", "148.122.164.253", "2001:4600:4:fff::253", "2001:4600:4:1fff::253"}},
	{"Nettvern+", []string{"148.122.16.252", "148.122.164.252", "2001:4600:4:fff::252", "2001:4600:4:1fff::252"}},
}

// Unfiltered DNS-over-HTTPS resolvers give the true answer, and work from
// any network.
var truthResolvers = []string{
	"https://cloudflare-dns.com/dns-query",
	"https://dns.google/dns-query",
}

// FilterResult is the answer from one filter.
type FilterResult struct {
	Filter  string
	Server  string // which address answered
	Verdict Verdict
	Err     error // set when no address answered
}

// Result is everything known about one target.
type Result struct {
	Target   string
	Host     string // the name looked up (from a URL, or a PTR for an IP)
	IsIP     bool
	Checked  bool     // DNS was checked; false for an IP with no reverse name
	Exists   bool     // an unfiltered resolver found the name
	Truth    []string // unfiltered answers
	TruthErr error
	Filters  []FilterResult
	System   Verdict // what this computer's own DNS says
	SysErr   error
	Notes    []string
}

// Blocked reports whether any filter blocks the target.
func (r Result) Blocked() bool {
	for _, f := range r.Filters {
		if f.Verdict.Blocked {
			return true
		}
	}
	return r.System.Blocked
}

type Checker struct {
	Timeout   time.Duration
	HTTP      *http.Client
	Filters   []Filter
	TruthURLs []string
	Resolver  *net.Resolver // this computer's resolver
	Port      string        // DNS port on filter servers; tests change it
}

func New() *Checker {
	return &Checker{
		Timeout:   2 * time.Second,
		HTTP:      &http.Client{Timeout: 5 * time.Second},
		Filters:   Filters,
		TruthURLs: truthResolvers,
		Resolver:  net.DefaultResolver,
		Port:      "53",
	}
}

// Normalize accepts a domain, a URL or an IP address.
func Normalize(s string) (host string, isIP bool) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, "@"); i >= 0 {
		s = s[i+1:]
	}
	if h, _, err := net.SplitHostPort(s); err == nil {
		s = h
	}
	s = strings.Trim(s, "[]")
	if _, err := netip.ParseAddr(s); err == nil {
		return s, true
	}
	s = strings.TrimSuffix(strings.ToLower(s), ".")
	// Internationalised names (blåbær.no) are looked up by their ASCII
	// form (xn--blbr-roah.no). Leave the name as typed if it isn't valid.
	if a, err := idna.Lookup.ToASCII(s); err == nil {
		s = a
	}
	return s, false
}

// Check looks up one target everywhere.
func (c *Checker) Check(ctx context.Context, target string) Result {
	host, isIP := Normalize(target)
	r := Result{Target: target, Host: host, IsIP: isIP}
	if isIP {
		r.Notes = append(r.Notes, "Nettvern and Nettvern+ filter DNS names, not IP addresses, so an IP address you connect to directly is not blocked by them.")
		names, err := c.Resolver.LookupAddr(ctx, host)
		if err != nil || len(names) == 0 {
			r.Notes = append(r.Notes, "The address has no reverse DNS name, so there is nothing else to check.")
			return r
		}
		r.Host = strings.TrimSuffix(strings.ToLower(names[0]), ".")
		r.Notes = append(r.Notes, fmt.Sprintf("Checking its reverse DNS name %s instead.", r.Host))
	}

	r.Checked = true
	var wg sync.WaitGroup
	wg.Add(2 + len(c.Filters))
	go func() { defer wg.Done(); r.Truth, r.Exists, r.TruthErr = c.truth(ctx, r.Host) }()
	var sysMsg *dns.Msg
	go func() { defer wg.Done(); sysMsg, r.SysErr = c.system(ctx, r.Host) }()
	r.Filters = make([]FilterResult, len(c.Filters))
	raw := make([][2]*dns.Msg, len(c.Filters))
	for i, f := range c.Filters {
		go func(i int, f Filter) {
			defer wg.Done()
			r.Filters[i].Filter = f.Name
			r.Filters[i].Server, raw[i], r.Filters[i].Err = c.askFilter(ctx, f, r.Host)
		}(i, f)
	}
	wg.Wait()

	// Classify once the truth is known, so NXDOMAIN can be judged. If the
	// truth is unknown, a missing name is not counted as a block.
	if r.SysErr == nil {
		r.System = Classify(sysMsg, r.Exists)
	}
	for i := range r.Filters {
		if r.Filters[i].Err == nil {
			r.Filters[i].Verdict = Merge(Classify(raw[i][0], r.Exists), Classify(raw[i][1], r.Exists))
		}
	}
	return r
}

// askFilter sends A and AAAA queries to every server of a filter at once
// and returns the first server that answers both.
func (c *Checker) askFilter(ctx context.Context, f Filter, host string) (string, [2]*dns.Msg, error) {
	type answer struct {
		server string
		msgs   [2]*dns.Msg
		err    error
	}
	ch := make(chan answer, len(f.Servers))
	for _, s := range f.Servers {
		go func(s string) {
			var a answer
			a.server = s
			for i, qt := range []uint16{dns.TypeA, dns.TypeAAAA} {
				a.msgs[i], a.err = c.udp(ctx, net.JoinHostPort(s, c.Port), host, qt)
				if a.err != nil {
					break
				}
			}
			ch <- a
		}(s)
	}
	var lastErr error
	for range f.Servers {
		a := <-ch
		if a.err == nil {
			return a.server, a.msgs, nil
		}
		lastErr = a.err
	}
	return "", [2]*dns.Msg{}, fmt.Errorf("no %s server answered: %w", f.Name, lastErr)
}

func (c *Checker) udp(ctx context.Context, addr, host string, qt uint16) (*dns.Msg, error) {
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(host), qt)
	cl := dns.Client{Timeout: c.Timeout}
	resp, _, err := cl.ExchangeContext(ctx, m, addr)
	if err == nil && resp.Truncated {
		cl.Net = "tcp"
		resp, _, err = cl.ExchangeContext(ctx, m, addr)
	}
	if err == nil {
		err = rcodeErr(resp)
	}
	return resp, err
}

// rcodeErr turns a server failure (SERVFAIL, REFUSED, ...) into an error,
// so the next server is tried. NXDOMAIN is an answer, not a failure.
func rcodeErr(m *dns.Msg) error {
	if m.Rcode == dns.RcodeSuccess || m.Rcode == dns.RcodeNameError {
		return nil
	}
	return fmt.Errorf("server answered %s", dns.RcodeToString[m.Rcode])
}

// truth asks the DoH resolvers, returning the first good answer.
func (c *Checker) truth(ctx context.Context, host string) ([]string, bool, error) {
	var lastErr error
	for _, u := range c.TruthURLs {
		var answers []string
		exists := false
		ok := true
		for _, qt := range []uint16{dns.TypeA, dns.TypeAAAA} {
			m, err := c.doh(ctx, u, host, qt)
			if err == nil {
				err = rcodeErr(m)
			}
			if err != nil {
				lastErr, ok = err, false
				break
			}
			if m.Rcode == dns.RcodeSuccess {
				exists = true
			}
			answers = append(answers, Classify(m, true).Answers...)
		}
		if ok {
			return dedupe(answers), exists, nil
		}
	}
	return nil, false, lastErr
}

func (c *Checker) doh(ctx context.Context, endpoint, host string, qt uint16) (*dns.Msg, error) {
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(host), qt)
	m.Id = 0
	wire, err := m.Pack()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(wire)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered HTTP %d", endpoint, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 65535))
	if err != nil {
		return nil, err
	}
	out := new(dns.Msg)
	return out, out.Unpack(b)
}

// system asks this computer's own resolver, which is what browsers use,
// and returns its answer as a DNS message so it can be classified like the
// others.
func (c *Checker) system(ctx context.Context, host string) (*dns.Msg, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	m := new(dns.Msg)
	if cname, err := c.Resolver.LookupCNAME(ctx, host); err == nil && !strings.EqualFold(dns.Fqdn(cname), dns.Fqdn(host)) {
		m.Answer = append(m.Answer, &dns.CNAME{Hdr: dns.RR_Header{Name: dns.Fqdn(host), Rrtype: dns.TypeCNAME}, Target: dns.Fqdn(strings.ToLower(cname))})
	}
	addrs, err := c.Resolver.LookupNetIP(ctx, "ip", host)
	for _, a := range addrs {
		if a.Is4() || a.Is4In6() {
			m.Answer = append(m.Answer, &dns.A{Hdr: dns.RR_Header{Rrtype: dns.TypeA}, A: a.Unmap().AsSlice()})
		} else {
			m.Answer = append(m.Answer, &dns.AAAA{Hdr: dns.RR_Header{Rrtype: dns.TypeAAAA}, AAAA: a.AsSlice()})
		}
	}
	if err != nil && len(m.Answer) == 0 {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
			m.Rcode = dns.RcodeNameError
			return m, nil
		}
		return nil, err
	}
	return m, nil
}

// Status says which Telenor filter, if any, this computer's DNS goes
// through. Telenor answers nettvern.telenor.net differently per filter.
func (c *Checker) Status(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addrs, err := c.Resolver.LookupHost(ctx, "nettvern.telenor.net")
	if err != nil {
		return "unknown (could not look up nettvern.telenor.net)"
	}
	for _, a := range addrs {
		switch a {
		case "148.123.15.38":
			return "Nettvern"
		case "148.123.15.1":
			return "Nettvern+"
		case "148.123.15.37":
			return "none (Telenor DNS without a filter)"
		}
	}
	return "not Telenor's DNS (" + strings.Join(addrs, ", ") + ")"
}
