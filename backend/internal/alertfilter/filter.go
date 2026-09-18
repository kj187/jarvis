package alertfilter

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

type Matcher struct {
	Name     string `json:"name"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type compiledMatcher struct {
	matcher Matcher
	regex   *regexp.Regexp
	invalid bool
}

type Compiled struct {
	matchers []compiledMatcher
}

func Compile(matchers []Matcher) (Compiled, []int) {
	compiled := Compiled{matchers: make([]compiledMatcher, len(matchers))}
	invalid := make([]int, 0)
	for i, matcher := range matchers {
		item := compiledMatcher{matcher: matcher}
		if matcher.Operator == "=~" || matcher.Operator == "!~" {
			var err error
			item.regex, err = regexp.Compile(matcher.Value)
			item.invalid = err != nil
			if err != nil {
				invalid = append(invalid, i)
			}
		}
		compiled.matchers[i] = item
	}
	return compiled, invalid
}

func (c Compiled) Match(alert models.EnrichedAlert, now time.Time) bool {
	for _, item := range c.matchers {
		matcher := item.matcher
		if matcher.Name == "@age" {
			if !matchAge(alert.StartsAt, now, matcher) {
				return false
			}
			continue
		}
		if matcher.Operator == ">" || matcher.Operator == "<" {
			return false
		}
		value := filterValue(alert, matcher.Name)
		if matcher.Name == "receiver" || matcher.Name == "@receiver" {
			values := []string{value}
			if strings.Contains(value, ",") {
				values = strings.Split(value, ",")
			}
			for i := range values {
				values[i] = strings.TrimSpace(values[i])
			}
			if !matchValues(values, item) {
				return false
			}
			continue
		}
		if !matchValues([]string{value}, item) {
			return false
		}
	}
	return true
}

func filterValue(alert models.EnrichedAlert, name string) string {
	switch name {
	case "@receiver", "receiver":
		if len(alert.Receivers) == 0 {
			return alert.Labels["@receiver"]
		}
		names := make([]string, len(alert.Receivers))
		for i := range alert.Receivers {
			names[i] = alert.Receivers[i].Name
		}
		return strings.Join(names, ",")
	case "@cluster":
		return alert.ClusterName
	case "@claimed-by":
		return ""
	default:
		return alert.Labels[name]
	}
}

func matchValues(values []string, item compiledMatcher) bool {
	switch item.matcher.Operator {
	case "=":
		for _, value := range values {
			if value == item.matcher.Value {
				return true
			}
		}
		return false
	case "!=":
		for _, value := range values {
			if value == item.matcher.Value {
				return false
			}
		}
		return true
	case "=~":
		if item.invalid {
			return false
		}
		for _, value := range values {
			if item.regex.MatchString(value) {
				return true
			}
		}
		return false
	case "!~":
		if item.invalid {
			return true
		}
		for _, value := range values {
			if item.regex.MatchString(value) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

var agePattern = regexp.MustCompile(`^(\d+)(s|m|h|d)$`)

func matchAge(startsAt, now time.Time, matcher Matcher) bool {
	if matcher.Operator != ">" && matcher.Operator != "<" {
		return false
	}
	parts := agePattern.FindStringSubmatch(strings.TrimSpace(matcher.Value))
	if parts == nil {
		return false
	}
	amount, err := strconv.ParseFloat(parts[1], 64)
	if err != nil && !math.IsInf(amount, 1) {
		return false
	}
	multiplier := map[string]float64{"s": 1_000, "m": 60_000, "h": 3_600_000, "d": 86_400_000}[parts[2]]
	threshold := amount * multiplier
	age := float64(now.Sub(startsAt)) / float64(time.Millisecond)
	if matcher.Operator == ">" {
		return age > threshold
	}
	return age < threshold
}

func MatchesSearch(labels map[string]string, search string) bool {
	needle := strings.ToLower(search)
	if needle == "" {
		return true
	}
	for name, value := range labels {
		if name == "@receiver" || name == "@cluster" || name == "@claimed-by" || name == "@age" {
			continue
		}
		if strings.Contains(strings.ToLower(name), needle) || strings.Contains(strings.ToLower(value), needle) {
			return true
		}
	}
	return false
}
