package leader

import "testing"

func TestStaticElector_AlwaysLeader(t *testing.T) {
	e := NewStaticElector()
	if !e.IsLeader() {
		t.Error("StaticElector must always report leader")
	}
}

func TestStaticElector_SubscribeFiresTrueImmediately(t *testing.T) {
	e := NewStaticElector()

	var called bool
	var got bool
	e.Subscribe(func(v bool) {
		called = true
		got = v
	})

	if !called {
		t.Fatal("Subscribe must call fn synchronously")
	}
	if !got {
		t.Error("Subscribe must fire fn(true) — StaticElector is always leader")
	}
}
