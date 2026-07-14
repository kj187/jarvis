package fanout

import (
	"context"
	"testing"
	"time"
)

func TestNoopFanout_PublishIsNoOp(t *testing.T) {
	var f NoopFanout
	// Must not panic or block.
	f.Publish(context.Background(), []byte("x"), Ref{Type: "comment_added"})
}

func TestNoopFanout_RunBlocksUntilCancelled(t *testing.T) {
	var f NoopFanout
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		f.Run(ctx, func([]byte) { t.Error("onMessage must never be called") }, func(Ref) { t.Error("onRef must never be called") })
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("Run returned before ctx was cancelled")
	case <-time.After(100 * time.Millisecond):
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after ctx cancellation")
	}
}
