# Backup and restore

Back up the database before every upgrade. Jarvis migrations are forward-only,
so a database restored for rollback must come from the same Jarvis version as
the binary you are returning to. A backup from an older version can be opened
by the same or a newer Jarvis version; do not open a newer database with an
older binary.

Backups contain alert history, occurrence counts, claims, comments, silence
templates, and user accounts and settings. Current alerts are rebuilt from
Alertmanager after startup.

## SQLite

Jarvis uses SQLite in WAL mode. **Do not copy a live `jarvis.db` file on its
own**: recent transactions may still be in `jarvis.db-wal`, so that copy can be
stale or inconsistent without reporting an error.

Use one of these methods:

1. Keep Jarvis running and use SQLite's online backup command:

   ```bash
   sqlite3 /data/jarvis.db ".backup '/backup/jarvis-$(date +%Y%m%d).db'"
   ```

2. Stop Jarvis completely, verify that no process has the database open, and
   then copy the database file. Stopping first lets SQLite checkpoint the WAL.

Validate the backup before relying on it:

```bash
sqlite3 /backup/jarvis-YYYYMMDD.db "PRAGMA integrity_check;"
```

The result must be `ok`.

To restore, stop Jarvis, replace the configured `JARVIS_DB_DSN` file with the
validated backup, ensure the file is writable by the container's non-root user,
and then start the matching Jarvis version. Restore into an empty location so
stale `-wal` or `-shm` files cannot be mixed with the backup.

## PostgreSQL

Create a custom-format dump with the PostgreSQL client version matching or
newer than the server:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --file=jarvis-$(date +%Y%m%d).dump "$JARVIS_DB_DSN"
```

Test that the archive can be read:

```bash
pg_restore --list jarvis-YYYYMMDD.dump >/dev/null
```

To restore, stop every Jarvis replica first so no pod can run migrations or
write history during the restore. Restore into an empty database owned by the
Jarvis database user:

```bash
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="$JARVIS_DB_DSN" jarvis-YYYYMMDD.dump
```

Then start the Jarvis version that created the dump. For PostgreSQL HA, bring
the deployment back only after the restore has completed; one pod will become
leader and followers will repopulate their in-memory snapshots normally.

## Before an upgrade

Record the running app and chart versions beside the backup, validate the
backup, and keep the old image and chart version available. The complete order
for reverting an unsuccessful deployment is in
[Upgrade and rollback](upgrade.md#rolling-back-an-upgrade).
