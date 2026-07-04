# Jarvis — Feature Request Scope Triage

Given a GitHub issue (feature request), decide whether it fits the project
scope defined in `docs/scope.md` and draft a reply the maintainer can
copy/paste into the issue. This workflow is read-only towards GitHub: it
never posts comments, sets labels, or closes issues — the maintainer does
that manually with the drafted text.

## Workflow

1. **Load the scope**: read `docs/scope.md` (definition, in/out-of-scope
   lists, litmus test).
2. **Fetch the issue**: the user passes an issue number or URL.

   ```bash
   gh issue view <number-or-url> --json number,title,body,labels,comments
   ```

   Read the body *and* the comments — requesters often sharpen their actual
   need in the discussion.
3. **Classify** against the litmus test (*"does this help someone sitting in
   front of a list of active alerts who has to decide what to do?"*):
   - **In scope** — clearly inside the alert-handling workflow
   - **Out of scope** — belongs before the alert (rules, measuring), after
     the alert (automation, ticketing, escalation), or to an adjacent tool
   - **Borderline** — partially fits, or the underlying need is unclear
4. **Report to the maintainer** (chat output, not the draft): one-line
   verdict + short rationale referencing the specific scope bullet that
   applies. If borderline, say what tips the scale in each direction.
5. **Draft the reply** in a fenced code block for copy/paste. English,
   friendly, maintainer voice, GitHub-flavored markdown. Always link the
   scope document:
   `https://github.com/kj187/jarvis/blob/main/docs/scope.md`

## Reply Guidelines per Verdict

- **In scope**: thank the requester, confirm the fit and *why* (tie it to
  the workflow it improves), mention open design questions if any. Make no
  promises about timelines.
- **Out of scope**: thank the requester, explain the boundary using the
  matching out-of-scope bullet (before/after-the-alert rule of thumb),
  suggest concrete alternatives or workarounds where they exist (e.g.
  Prometheus rule files, Alertmanager receivers, a dedicated incident tool),
  and invite them to reply if they think the need was misread. Never make
  the requester feel dismissed — the scope is the reason, not a lack of
  interest.
- **Borderline**: state which part fits and which does not, then ask 1–3
  targeted questions that would settle the verdict (usually: what problem
  are you solving *while handling an alert*?).

## Hard Rules

- Verdict is a recommendation — the maintainer decides. Never post to
  GitHub, never label, never close.
- Judge the *need* behind the request, not just the proposed solution: a
  request phrased as an out-of-scope feature may hide an in-scope need.
  If so, say that and address the need in the draft.
- If the issue is not a feature request (bug report, question), say so and
  skip the scope verdict.
