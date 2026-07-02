## Type

- [ ] `feat` — New feature
- [ ] `fix` — Bug fix
- [ ] `refactor` — Refactoring (no feature/fix)
- [ ] `test` — Tests
- [ ] `chore` — No production code (deps, tooling, config)
- [ ] `security` — Security fix

## Description

<!-- What changed and why? -->

## Related Issues

Closes #

## Testing

- [ ] `go test ./...` passes
- [ ] `make test-frontend` passes
- [ ] Manually tested in browser (for frontend changes)
- [ ] No `console.log` in code
- [ ] `cursor: pointer` set on new clickable elements

## Checklist

- [ ] Conventional Commit format (`feat(alerts): ...`)
- [ ] Go model change → TypeScript types mirrored (`frontend/src/types/index.ts`)
- [ ] New API route registered before `/:fingerprint/*` (if applicable)
- [ ] AI context files updated (`AGENTS.md` / `.agents/*.md` / `docs/testing-e2e.md`) — or nothing they document was touched
