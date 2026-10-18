// Package check asks Telenor's filtering DNS resolvers about a name and
// works out from their answers whether, and why, the name is blocked.
package check

import (
	"net/netip"
	"strings"

	"github.com/miekg/dns"
)

// Reason says why a resolver blocked a name.
type Reason string

const (
	ReasonNone       Reason = ""
	ReasonNettvern   Reason = "nettvern"       // CNAME nettvern-info.telenor.net
	ReasonNettvernPl Reason = "nettvern+"      // CNAME nettvernpluss-info.telenor.net
	ReasonLegal      Reason = "legal"          // CNAME dns-block.telenor.net (court order or regulator)
	ReasonKripos     Reason = "kripos"         // kid.telenor.net stop page
	ReasonUmbrella   Reason = "umbrella"       // Cisco Umbrella block page (work VPNs, possibly SafeZone)
	ReasonProxied    Reason = "umbrella-proxy" // Cisco Umbrella intelligent proxy, i.e. greylisted
	ReasonNXDomain   Reason = "nxdomain"       // filter says the name doesn't exist, but it does
)

// Telenor answers a blocked name with a CNAME to one of these landing hosts.
var telenorTargets = map[string]Reason{
	"nettvern-info.telenor.net.":      ReasonNettvern,
	"nettvernpluss-info.telenor.net.": ReasonNettvernPl,
	"dns-block.telenor.net.":          ReasonLegal,
	"kid.telenor.net.":                ReasonKripos,
}

// Cisco Umbrella block-page addresses and what each one means.
var umbrellaBlockPages = map[netip.Addr]string{
	netip.MustParseAddr("146.112.61.104"): "domain list",
	netip.MustParseAddr("146.112.61.105"): "command and control",
	netip.MustParseAddr("146.112.61.106"): "content category",
	netip.MustParseAddr("146.112.61.107"): "malware",
	netip.MustParseAddr("146.112.61.108"): "phishing",
	netip.MustParseAddr("146.112.61.109"): "blocked",
	netip.MustParseAddr("146.112.61.110"): "security",
}

var umbrellaProxy = netip.MustParsePrefix("146.112.56.0/24")

// Verdict is what one resolver's answer means for one name.
type Verdict struct {
	Blocked bool
	Reason  Reason
	Detail  string   // e.g. the Umbrella category
	Answers []string // addresses and CNAME targets, for display
	Missing bool     // the resolver said the name doesn't exist
}

// Classify reads a resolver response. truthExists says whether an
// unfiltered resolver found the name, so an NXDOMAIN from a filter can be
// told apart from a name that simply doesn't exist.
func Classify(m *dns.Msg, truthExists bool) Verdict {
	var v Verdict
	if m == nil {
		return v
	}
	for _, rr := range m.Answer {
		switch r := rr.(type) {
		case *dns.CNAME:
			target := strings.ToLower(r.Target)
			v.Answers = append(v.Answers, strings.TrimSuffix(target, "."))
			if reason, ok := telenorTargets[target]; ok && !v.Blocked {
				v.Blocked, v.Reason = true, reason
			}
		case *dns.A:
			v.addAddr(r.A.String())
		case *dns.AAAA:
			v.addAddr(r.AAAA.String())
		}
	}
	if m.Rcode == dns.RcodeNameError {
		v.Missing = true
		if !v.Blocked && truthExists {
			v.Blocked, v.Reason = true, ReasonNXDomain
		}
	}
	return v
}

func (v *Verdict) addAddr(s string) {
	v.Answers = append(v.Answers, s)
	if v.Blocked {
		return
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return
	}
	a = a.Unmap() // Umbrella answers AAAA queries with ::ffff:146.112.61.x
	if cat, ok := umbrellaBlockPages[a]; ok {
		v.Blocked, v.Reason, v.Detail = true, ReasonUmbrella, cat
	} else if umbrellaProxy.Contains(a) {
		v.Blocked, v.Reason = true, ReasonProxied
	}
}

// Merge combines the A and AAAA verdicts for one resolver; a block in
// either counts.
func Merge(vs ...Verdict) Verdict {
	out := Verdict{Missing: len(vs) > 0}
	for _, v := range vs {
		out.Answers = append(out.Answers, v.Answers...)
		out.Missing = out.Missing && v.Missing
		if v.Blocked && !out.Blocked {
			out.Blocked, out.Reason, out.Detail = true, v.Reason, v.Detail
		}
	}
	out.Answers = dedupe(out.Answers)
	return out
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// Describe says what the verdict means, in a sentence for people.
func (v Verdict) Describe() string {
	if !v.Blocked && v.Missing {
		return "not found (the domain doesn't exist)"
	}
	s := v.Reason.Describe()
	if v.Detail != "" {
		s += " (" + v.Detail + ")"
	}
	return s
}

// Describe turns a reason into a sentence for people.
func (r Reason) Describe() string {
	switch r {
	case ReasonNettvern:
		return "blocked by Nettvern"
	case ReasonNettvernPl:
		return "blocked by Nettvern+"
	case ReasonLegal:
		return "blocked by Telenor on legal grounds (court order or regulator), for every Telenor customer"
	case ReasonKripos:
		return "blocked by the Kripos child-abuse filter"
	case ReasonUmbrella:
		return "blocked by Cisco Umbrella (used by many work networks and VPNs)"
	case ReasonProxied:
		return "sent through Cisco Umbrella's inspection proxy as suspicious"
	case ReasonNXDomain:
		return "hidden: the filter says the domain doesn't exist"
	}
	return "not blocked"
}
