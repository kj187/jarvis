# Migrate from SQLite

There is no built-in data migration tool, and none is planned — the
recommended path is a **fresh start on PostgreSQL**: history does not
transfer. This is a deliberate, stated trade-off, not an oversight:

- Alert history is derived from Alertmanager's own state on every poll;
  within one grace-period window after cutover, the full current alert set
  reappears exactly as if Jarvis had just been (re)installed.
- Claims, comments, and silence templates are the only truly hand-entered
  data, and in practice these don't accumulate to a volume worth building
  an export/import tool for.
- Keeping the migration path deliberately absent avoids maintaining a
  second, rarely-exercised code path (see
  [docs/scope.md](scope.md) — this mirrors the project's general bias
  against speculative tooling).

Practically: stop Jarvis, set `JARVIS_DB_DSN` to the new PostgreSQL
connection string, start it again. Migrations create the schema on first
connection; Jarvis starts recording fresh history from that point on.

See [PostgreSQL & HA](postgres-ha.md) for configuring the connection, and
[Deploy on Kubernetes](deploy-kubernetes.md) for the chart side of a
PostgreSQL deployment.
