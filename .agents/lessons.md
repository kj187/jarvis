# Jarvis — Lessons Learned (index)

Durable, non-obvious insights from past debugging, split by area. Every entry
is headed by its symptom and reads symptom → cause → rule. **Before
re-deriving a gotcha, search the headings, then open only the matching file:**

```bash
grep -n '^## ' .agents/lessons/*.md     # all symptoms, one line each
grep -rni '<keyword>' .agents/lessons/  # a specific term
```

| Area | File |
|---|---|
| History, recorder, grace period, PostgreSQL HA, DB pools, poll load | `.agents/lessons/history-and-ha.md` |
| API, auth, WebSocket, alert ordering | `.agents/lessons/api-auth-ws.md` |
| Silences and the settings store | `.agents/lessons/silences-and-settings.md` |
| Tests, E2E, screenshots | `.agents/lessons/testing-and-e2e.md` |
| Release video and media | `.agents/lessons/media-and-video.md` |
| Dev environment, toolchain, CI, AI tooling | `.agents/lessons/dev-env-and-tooling.md` |

Adding a lesson (`AGENTS.md` → Workflow Rule 6): put a new entry at the top of
the matching file (newest first) with a heading that names the symptom, in the
same commit. Keep entries short; link the file that owns the full detail
instead of duplicating it. A new area is a new file plus a row above.
