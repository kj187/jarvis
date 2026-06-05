# Jarvis — Architekturplan

## 1. Projektziel

Jarvis ist ein Web-Frontend für Prometheus Alertmanager. Es bietet eine interaktive, echtzeitfähige
Oberfläche zur Verwaltung und Analyse von Alerts — ähnlich wie
[Karma](https://github.com/prymitive/karma), jedoch vollständig selbst kontrollierbar und um eigene
Features erweiterbar.

---

## 2. Vollständiges Feature-Set

### 2.1 Persistenz (Herzstück)

Jarvis speichert jeden Alert-Lebenszyklus in SQLite. Der In-memory-Store hält nur den aktuellen
Poll-Snapshot — alle historischen Daten überleben Neustarts.

**Zustandsmaschine**: Jede Statusänderung wird als `alert_events`-Eintrag geschrieben:

```
firing → suppressed   (Silence aktiviert)
       → resolved     (Alert verschwunden aus AM API)

suppressed → firing   (Silence abgelaufen / gelöscht → expired-Event + neues firing-Event)
           → resolved (Problem behoben während Silence aktiv war — kein expired-Event)

resolved → firing     (Alert taucht erneut auf)
```

> **Edge Case `suppressed → resolved`**: Wenn der Alert verschwindet während eine Silence noch
> aktiv ist, gewinnt der Fix. Kein `expired`-Event — direkt auf `resolved`. Die Silence in
> Alertmanager läuft danach einfach aus (dangling silence, harmlos). Claims werden wie üblich
> auto-released mit `reason: resolved`.

**Was persistiert wird:**

| Tabelle | Inhalt |
|---|---|
| `alert_fingerprints` | Pro Alert: `alertname`, `cluster_name`, `labels` (JSON), `first_seen_at`, `last_seen_at`, `occurrence_count` |
| `alert_events` | Jede Statusänderung: `status`, `starts_at`, `ends_at` (NULL solange offen), `annotations` (JSON) |
| `alert_comments` | Freitext-Kommentare, fingerprint-gebunden — bleiben über alle Firing-Episoden erhalten |
| `alert_claims` | Vollständige Claim-Historie: wer, wann, bis wann, Freigabe-Grund |

**Besonderheiten der Recorder-Logik:**

- **Grace Period (60s)**: Wenn ein Alert nach einem resolved-Event innerhalb von 60s wieder erscheint,
  wird das alte Event wiedereröffnet statt ein neues zu erstellen. Verhindert Ghost-Resolve-Einträge
  bei transienten Poll-Misses.
- **occurrence_count**: Wird nur erhöht wenn es bereits frühere Events gab (nicht beim allerersten
  Firing). Repräsentiert wie oft ein Alert nach einem Resolve erneut aufgetrat.
- **Resolved-Retention**: Resolved Alerts bleiben 20 Minuten im In-memory-Store sichtbar
  (ausgegraut), danach automatisch entfernt. In SQLite bleiben sie dauerhaft.
- **Auto-Release von Claims**: Wenn ein Alert resolved wird, werden alle aktiven Claims automatisch
  freigegeben (`release_reason: resolved`).

**SQLite-Einstellungen**: `WAL`-Mode, `foreign_keys=ON`, `busy_timeout=5000ms`,
`SetMaxOpenConns(1)` (single writer).

---

### 2.2 Alert-Ansicht

| Feature | Detail |
|---|---|
| Live-Alerts | Alle aktiven Alerts aus allen Alertmanagern, via WebSocket-Push (kein manueller Reload) |
| Card View | Karten gruppiert nach Severity (critical → warning → info → none). Gleicher `alertname`, verschiedene Instanzen → zusammengefasste Card mit Count-Badge `×N`. Claim-Avatar-Badge (Initialen) oben rechts auf der Card. Silence-Indikatoren: ⏳-Badge bei `pending` Silence ("Silence ab HH:MM"), ⚠️-Infobox bei `expiring` (≤15 Min. vor Ablauf: "Silence läuft ab in X Min."), 🔕-Infobox bei `expired` (max. 2h nach Ablauf: "Silence expired vor X"). |
| List View | Kompakte Tabelle, sortierbar nach Severity, Alertname, Cluster, Zeit. Claim-Avatar in eigener Spalte. |
| View Toggle | ⊞ / ☰ in der Header-Toolbar. Präferenz persistent in localStorage (via Zustand-persist). |
| Resolved Alerts | Kürzlich resolved Alerts bleiben **20 Minuten** im Store sichtbar (State = `resolved`, ausgegraut). Danach automatisch entfernt. |
| Polling Pause | Play/Pause-Button im Header pausiert das periodische Refetch (TanStack Query refetchInterval). Nicht pausiert = 15s-Intervall. |
| Manueller Refresh | Refresh-Button im Header löst sofortiges Refetch aus; Icon spinnt während laufendem Request. |

### 2.3 Filter-System

| Feature | Detail |
|---|---|
| State-Filter | Dropdown: `active` / `suppressed` / `unprocessed` / `resolved` / leer (alle). Achtung: suppressed Alerts deren Silence in ≤15 Min. abläuft, werden als `active` angezeigt. |
| Label-Matcher | Mehrere Matcher kombinierbar. Operatoren: `=` (gleich), `!=` (ungleich), `=~` (Regex), `!~` (Regex negiert). Unterstützte Pseudo-Labels: `@receiver` (aus `alert.receivers`), `@cluster` (aus `alert.clusterName`). Matchers via Chip-UI hinzufügen/entfernen. |
| Suche | Freitext-Suche über `alertname` + alle Labels (JSON-Stringify). Suchfeld via Such-Button in Header ein-/ausklappbar. ESC schließt Suchfeld. |
| Filter-Serialisierung | Alle Filterzustände + ViewMode + ausgewähltes Panel werden in URL-Query-Params geschrieben: `?view=list&state=active&q=node&matchers=[...]&alert=<fp>`. Beim Laden der Seite werden URL-Params zuerst gelesen und in den Store hydratisiert (vor localStorage). Erlaubt Deep Links und Browser-Back/Forward. |
| Alert-Counter | Header zeigt `Alerts N / M` (gefiltert / gesamt). |

### 2.4 Alert-Detailpanel (Slide-over)

Klick auf Alert → Sheet öffnet von rechts. URL wird auf `?alert=<fingerprint>` aktualisiert.

Inhalt:
- **Header**: Alertname, Cluster-Badge, Severity-Badge, Status-Badge, "Seit"-Zeit
- **Links**: Alertmanager-Button (öffnet AM-UI im externen Tab). Optional: "Dashboard"-Button wenn `annotations.dashboard` gesetzt (öffnet Link in externem Tab). Optional: "Runbook"-Button wenn Label `runbook` gesetzt (URL = `JARVIS_RUNBOOK_BASE_URL` + Wert aus `labels.runbook`, öffnet in externem Tab).
- **Claiming-Sektion**: Aktiven Claim anzeigen (Name + "seit X Min.") + Freigeben-Button. Oder "Ich kümmere mich"-Button wenn kein aktiver Claim. Name wird aus localStorage vorausgefüllt (Key: `jarvis-username`).
- **Claim-Historie**: Tabelle aller vergangenen Claims (Name, Start, Ende, Dauer, Reason).
- **Labels**: Zweispaltig, gleichmäßig aufgeteilt (⌈N/2⌉ links, Rest rechts). Klick auf Label → fügt `labelname=value`-Matcher zum Filter hinzu.
- **Annotations**: Key-Value-Tabelle.
- **Alert-Historie**: Paginierte Tabelle aller Status-Events (Status, StartsAt, EndsAt, Dauer). Status-Werte: `firing` / `suppressed` / `expired` / `resolved`. "Ältere laden"-Button für Pagination.
- **Occurrence-Statistik**: Gesamt-Occurrence-Count, first_seen_at, last_seen_at (aus `alert_fingerprints`).
- **Kommentare**: Alle Kommentare chronologisch (neueste oben). Kommentar löschen via Trash-Icon. Kommentar-Formular: Name (vorausgefüllt aus localStorage) + Freitext-Textarea + Senden-Button.
- **Silence-Sektion**: Kontextabhängig — wird angezeigt wenn Alert suppressed, expiring oder expired ist:
  - `pending`: Infobox mit Silence-Details (StartsAt, EndsAt, Comment, CreatedBy). Kein Verlängern-Button (noch nicht aktiv).
  - `active`/`expiring`: Infobox mit Silence-Details (Silence-ID, StartsAt, EndsAt, verbleibende Zeit, Comment, CreatedBy) + "Silence verlängern"-Button (öffnet Formular vorausgefüllt).
  - `expired` (≤2h): Infobox mit Silence-Details + Hinweis "expired vor X" + "Silence neu erstellen"-Button (vorausgefüllt mit Matchern + Comment der letzten Silence, StartsAt = jetzt).
  - `expired` (>2h): Infobox dauerhaft sichtbar (nicht nur 2h) — letzte Silence-Info + "Silence neu erstellen"-Button. Info aus letztem `alert_events`-Eintrag mit Status `suppressed` + zugehöriger Silence.
- **Alert-Aktionen**: "Im Alertmanager anzeigen"-Button (öffnet AM-UI in externem Tab, URL aus `alertmanagerUrl`). "Alert ausblenden"-Button: entfernt Alert aus Jarvis In-Memory-Store (erscheint erneut beim nächsten Poll wenn noch aktiv in AM — kein AM-seitiges Löschen möglich via API).

### 2.5 Silences

#### 2.5.1 Silence-Zustände an Alerts

Silence-Zustände werden live aus dem Silences-Endpunkt abgeleitet (nicht aus `alert_events` persistiert). Identifikation: `alert.status.silencedBy[]` → Silence-Lookup im Cache.

| Zustand | Bedingung | Card-Indikator | Alert erscheint in Active-Alerts |
|---|---|---|---|
| `pending` | Silence erstellt, StartsAt in Zukunft | ⏳-Badge "Silence ab HH:MM" | Ja — Alert weiter `firing` |
| `suppressed` | Silence aktiv, ≥15 Min. verbleibend | Kein Indikator (Standard suppressed) | Nein |
| `expiring` | Silence aktiv, ≤15 Min. bis EndsAt | ⚠️-Infobox "Silence läuft ab in X Min." | **Ja** — wird wieder in Active-Alerts angezeigt |
| `expired` (≤2h) | EndsAt überschritten, ≤2h seit Ablauf | 🔕-Infobox "Silence expired vor X Min./Std." | Ja |
| `expired` (>2h) | EndsAt überschritten, >2h seit Ablauf | Kein Card-Indikator | Ja |

#### 2.5.2 Silence-Formular

Wird verwendet für: Silence erstellen, Silence bearbeiten, Silence verlängern, Silence aus Alert, Silence neu erstellen (aus expired).

| Feld | Detail |
|---|---|
| Matcher-Builder | Alle Labels des betroffenen Alerts als Matcher-Vorschläge. Jeder Matcher: Label-Name (Dropdown aus Alert-Labels), Operator (`=` / `!=` / `=~` / `!~`), Wert (Freitext). Matcher per Chip-UI hinzufügen/entfernen/bearbeiten. |
| Cluster-Auswahl | Checkbox-Liste aller konfigurierten Cluster. Default: Cluster des ausgewählten Alerts. Bei cross-cluster Silence: mehrere Cluster aktivierbar — pro aktivem Cluster wird `@cluster=<name>`-Matcher generiert. Deaktivierte Cluster bekommen keinen Matcher (Silence gilt nur für aktivierte). |
| Zeitkonfiguration — Modus 1 | Kalender-Picker mit Uhrzeit: StartsAt + EndsAt direkt setzen (DateTimePicker-Komponente). |
| Zeitkonfiguration — Modus 2 | Dauer-Regler/Stepper: Tage / Stunden / Minuten ab StartsAt. EndsAt = StartsAt + Dauer, wird live berechnet und angezeigt. |
| Moduswechsel | Toggle zwischen Kalender und Regler. Beide Modi setzen dieselben StartsAt/EndsAt-Felder. |
| StartsAt | Default = jetzt. Kann in Zukunft gesetzt werden → Silence ist `pending` bis StartsAt. Alert bleibt bis dahin `firing` und erscheint in Active-Alerts. |
| EndsAt | Default = StartsAt + 1h. Via Kalender oder Regler. |
| CreatedBy | Vorausgefüllt aus localStorage (`jarvis-username`). Editierbar. |
| Comment | Freitext-Textarea. Pflichtfeld. |

#### 2.5.3 Silence-Liste (Silences-Page)

| Feature | Detail |
|---|---|
| Silence-Liste | Alle Silences aus allen Clustern. Cluster-Badge pro Silence. |
| Status-Anzeige | `active` / `pending` / `expired`. Expired-Zeitstempel via `formatDistanceToNow` ("expired vor 5 Min."). Toggle: Expired ein-/ausblenden. |
| Affected Alerts | Jede Silence-Card zeigt "Affected alerts: N" (aus aktuellen Alerts berechnet). |
| Silence erstellen | Button öffnet leeres Silence-Formular. |
| Silence bearbeiten | Button auf Silence-Card, öffnet Formular vorausgefüllt. |
| Silence löschen | Confirmation-Dialog, dann DELETE an Backend. |
| Silence verlängern | Button auf Silence-Card, öffnet Formular vorausgefüllt mit Fokus auf EndsAt. |

#### 2.5.4 Silence aus Alert-Detailpanel

| Aktion | Bedingung | Detail |
|---|---|---|
| "Silence erstellen" | Immer verfügbar | Öffnet Formular mit allen Alert-Labels als Matcher vorausgefüllt. Cluster des Alerts vorausgewählt. |
| "Silence verlängern" | Alert `suppressed` oder `expiring` | Öffnet Formular vorausgefüllt mit bestehender Silence. |
| "Silence neu erstellen" | Alert `expired` (letzte Silence bekannt) | Öffnet Formular mit Matchern + Comment der letzten Silence vorausgefüllt, StartsAt = jetzt. |
| Pending-Indikator | Silence `pending` | ⏳-Badge + "Silence ab HH:MM". Kein Verlängern (noch nicht aktiv). |

### 2.6 Cluster-Übersicht

Header zeigt `Cluster X/Y` (gesund/gesamt) mit farbigen Dots. Hover-Tooltip listet alle Cluster mit Namen, URL und Alert-Count.

Backend `/api/v1/clusters` pingt jeden Alertmanager und liefert `healthy: true/false`.

### 2.7 WebSocket (Realtime)

Einzelner WS-Endpunkt `/ws`. Reconnect nach 3s automatisch. Verbindungsstatus (Wifi-Icon) im Header.

Event-Typen:

| Type | Payload | Wirkung im Frontend |
|---|---|---|
| `alerts_update` | `{ alerts: Alert[] }` | TanStack Query Cache für `['alerts']` direkt setzen (kein Refetch) |
| `claim_set` | `{ fingerprint, claim }` | Betroffenen Alert im Cache patchen; Claim-Queries invalidieren |
| `claim_released` | `{ fingerprint, releasedBy }` | `activeClaim` auf `undefined` setzen; Claim-Queries invalidieren |
| `comment_added` | `{ fingerprint, comment }` | Kommentar-Query für Fingerprint invalidieren |

---

## 3. Technologie-Stack

### 3.1 Backend

| Komponente | Technologie | Version | Hinweis |
|---|---|---|---|
| Sprache | **Go** | 1.24+ | |
| HTTP Framework | **Echo** | v4.13 | |
| WebSocket | **gorilla/websocket** | v1.5 | |
| Config / .env | **godotenv** | v1.5 | |
| Logging | **slog** (stdlib) | — | JSON-Format, Level via `JARVIS_LOG_LEVEL` |
| Datenbank | **SQLite** via `modernc.org/sqlite` | v1.34+ | Pure Go, kein CGO — Podman-freundlich |
| HTTP-Client | stdlib `net/http` | — | |

> `modernc.org/sqlite` statt `mattn/go-sqlite3` — kein C-Compiler nötig im Container-Build.

### 3.2 Frontend

| Komponente | Technologie | Version | Hinweis |
|---|---|---|---|
| Framework | **React** | 19.x | |
| Sprache | **TypeScript** | 5.7+ | |
| Build Tool | **Vite** | 6.x | |
| UI-Komponenten | **shadcn/ui** | latest | copy-paste, owned |
| Styling | **Tailwind CSS** | v4.x | CSS-first Config, `@theme` |
| State Management | **Zustand** | v5.x | mit `persist`-Middleware für localStorage |
| Data Fetching | **TanStack Query** | v5.x | WS-Events patchen den Cache direkt |
| Routing | **TanStack Router** | v1.x | `createRootRoute` + `createRoute`, kein File-based Routing nötig |
| Relative Zeit | **date-fns** | v4.x | `formatDistanceToNow` + `format` mit `de`-Locale |
| Icons | **Lucide React** | latest | |

### 3.3 Infrastruktur

| Komponente | Technologie |
|---|---|
| Containerisierung | Podman (multi-stage) + `compose.yml` / `compose.dev.yml` |

---

## 4. Systemarchitektur

```
┌──────────────────────────────────────────────────────────────┐
│                           Browser                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           React 19 Frontend (Vite 6)                 │    │
│  │                                                      │    │
│  │  Alerts Page      │  Silences Page                    │    │
│  │  Card / List      │                                   │    │
│  │               │                 │                    │    │
│  │  Alert Detail Panel (Slide-over)                     │    │
│  │  Labels · Annotations · Claims · Kommentare · Hist.  │    │
│  │                                                      │    │
│  │  Zustand v5 (uiStore: viewMode, filters, panel)      │    │
│  │  TanStack Query v5 (Cache: alerts, silences, etc.)   │    │
│  │                                                      │    │
│  │  REST API Client  │  WebSocket Client                │    │
│  └──────────┬────────┴──────────────┬───────────────────┘    │
└─────────────┼───────────────────────┼──────────────────────┘
              │ HTTP /api/v1/*        │ WS /ws
              ▼                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  Jarvis Backend (Go 1.24+)                   │
│                                                              │
│  Echo Router                    WebSocket Hub               │
│  ├─ /api/v1/alerts              (broadcast typed events)    │
│  ├─ /api/v1/silences                                        │
│  ├─ /api/v1/clusters                                        │
│  ├─ /api/v1/status                                          │
│  └─ /*  (embed.FS static)                                   │
│                                                              │
│  Service Layer                                              │
│  ├─ AlertStore (in-memory, sync.RWMutex)                    │
│  ├─ HistoryStore (SQLite reads/writes)                      │
│  └─ Recorder (Polling-Loop)                                 │
│                                                              │
│  SQLite (modernc.org/sqlite, WAL-Mode)                      │
│  ├─ alert_fingerprints                                      │
│  ├─ alert_events                                            │
│  ├─ alert_comments                                          │
│  └─ alert_claims                                            │
│                                                              │
│  Cluster Registry (aus .env)                                │
│  ├─ cluster[1]: AM Client, AM Link URL, Prometheus URL      │
│  └─ cluster[N]: ...                                         │
└─────────────────────────────────┬────────────────────────────┘
                                  │ HTTP polling (JARVIS_POLL_INTERVAL)
              ┌───────────────────┤
              ▼                   ▼
   Alertmanager 1        Alertmanager N
   Prometheus 1          Prometheus N
```

---

## 5. Konfiguration (`.env`)

Alle Werte können auch als echte Umgebungsvariablen gesetzt werden (Podman/Kubernetes).

```dotenv
# .env — Jarvis Konfiguration

# Server
JARVIS_PORT=8080
JARVIS_LOG_LEVEL=info          # info | debug
JARVIS_POLL_INTERVAL=15s
JARVIS_DB_PATH=/data/jarvis.db
# Optional: Basis-URL für Runbook-Links (Label "runbook" wird angehängt)
# Beispiel: JARVIS_RUNBOOK_BASE_URL=https://wiki.example.com/runbooks/
JARVIS_RUNBOOK_BASE_URL=
# CORS: kommaseparierte Liste erlaubter Browser-Origins (kein Wildcard *).
# Gilt auch als Origin-Whitelist für den WebSocket-Upgrade (CheckOrigin).
# Default wenn leer: gleiche Origin wie der Server (same-origin only).
JARVIS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080

# ── Cluster 1 ────────────────────────────────────────────────
JARVIS_CLUSTER_1_NAME=homelab
JARVIS_CLUSTER_1_ALERTMANAGER_URL=http://alertmanager:9093
# HOST_ALIAS: Optional — überschreibt Host/Scheme für Browser-Links
# Nützlich wenn interne API-URL ≠ Browser-URL (z.B. localhost vs. hostname)
JARVIS_CLUSTER_1_HOST_ALIAS=https://alertmanager.lan.kj187.de
JARVIS_CLUSTER_1_PROMETHEUS_URL=http://prometheus:9090

# ── Cluster 2 ────────────────────────────────────────────────
JARVIS_CLUSTER_2_NAME=production
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://prod-alertmanager:9093
JARVIS_CLUSTER_2_PROMETHEUS_URL=http://prod-prometheus:9090

# Weitere Cluster: JARVIS_CLUSTER_N_NAME, _ALERTMANAGER_URL, _PROMETHEUS_URL, _HOST_ALIAS
```

**`HOST_ALIAS`-Logik**: Das Backend pollt Alertmanager unter `ALERTMANAGER_URL`. Der Browser-Link zum
Alertmanager (im Detail-Panel und in Alert-Cards) wird aus `HOST_ALIAS` aufgebaut — also dem
extern erreichbaren Host. Wenn kein `HOST_ALIAS` gesetzt, wird `ALERTMANAGER_URL` auch als Link
verwendet.

---

## 6. Datenmodell

### 6.1 Go-Models (`internal/models/models.go`)

```go
// ── Alert ───────────────────────────────────────────────────────────────────

type AlertStatus struct {
    InhibitedBy []string `json:"inhibitedBy"`
    SilencedBy  []string `json:"silencedBy"`
    State       string   `json:"state"` // active | suppressed | unprocessed | resolved
}

type Receiver struct {
    Name string `json:"name"`
}

type EnrichedAlert struct {
    Fingerprint     string            `json:"fingerprint"`
    Status          AlertStatus       `json:"status"`
    Labels          map[string]string `json:"labels"`
    Annotations     map[string]string `json:"annotations"`
    StartsAt        time.Time         `json:"startsAt"`
    EndsAt          time.Time         `json:"endsAt"`
    UpdatedAt       time.Time         `json:"updatedAt"`
    GeneratorURL    string            `json:"generatorURL"`
    Receivers       []Receiver        `json:"receivers"`
    ClusterName     string            `json:"clusterName"`
    AlertmanagerURL string            `json:"alertmanagerUrl"` // Browser-Link-URL
    ActiveClaim     *Claim            `json:"activeClaim,omitempty"`
}

// ── Silence ─────────────────────────────────────────────────────────────────

type SilenceMatcher struct {
    IsEqual bool   `json:"isEqual"`
    IsRegex bool   `json:"isRegex"`
    Name    string `json:"name"`
    Value   string `json:"value"`
}

type SilenceStatus struct {
    State string `json:"state"` // active | pending | expired
}

type Silence struct {
    ID              string           `json:"id"`
    Matchers        []SilenceMatcher `json:"matchers"`
    StartsAt        time.Time        `json:"startsAt"`
    EndsAt          time.Time        `json:"endsAt"`
    CreatedBy       string           `json:"createdBy"`
    Comment         string           `json:"comment"`
    Status          SilenceStatus    `json:"status"`
    UpdatedAt       time.Time        `json:"updatedAt"`
    ClusterName     string           `json:"clusterName"`
    AlertmanagerURL string           `json:"alertmanagerUrl"`
}

// ── History ──────────────────────────────────────────────────────────────────

// AlertEvent — Statusänderung eines Alerts
// Status: firing | suppressed | expired | resolved
//   firing    = Alert erschienen / wieder aktiv nach Silence
//   suppressed = Alert durch Silence oder Inhibition unterdrückt
//   expired   = Silence abgelaufen oder gelöscht, Alert wieder aktiv
//   resolved  = Alert verschwunden (nicht mehr in AM API)
type AlertEvent struct {
    ID              int64      `json:"id"`
    Fingerprint     string     `json:"fingerprint"`
    ClusterName     string     `json:"clusterName"`
    AlertmanagerURL string     `json:"alertmanagerUrl"`
    Status          string     `json:"status"`
    StartsAt        time.Time  `json:"startsAt"`
    EndsAt          *time.Time `json:"endsAt"` // nil solange noch firing
    Annotations     string     `json:"annotations"` // JSON-String mit Metadaten
    RecordedAt      time.Time  `json:"recordedAt"`
}

type AlertStats struct {
    Fingerprint     string    `json:"fingerprint"`
    Alertname       string    `json:"alertname"`
    ClusterName     string    `json:"clusterName"`
    FirstSeenAt     time.Time `json:"firstSeenAt"`
    LastSeenAt      time.Time `json:"lastSeenAt"`
    OccurrenceCount int       `json:"occurrenceCount"`
}

// ── Comment ──────────────────────────────────────────────────────────────────

type Comment struct {
    ID          int64     `json:"id"`
    Fingerprint string    `json:"fingerprint"`
    EventID     *int64    `json:"eventId,omitempty"` // optionaler Bezug zur Firing-Episode
    AuthorName  string    `json:"authorName"`
    Body        string    `json:"body"`
    CreatedAt   time.Time `json:"createdAt"`
}

// ── Claim ────────────────────────────────────────────────────────────────────

type Claim struct {
    ID            int64      `json:"id"`
    Fingerprint   string     `json:"fingerprint"`
    EventID       *int64     `json:"eventId,omitempty"`
    ClaimedBy     string     `json:"claimedBy"`
    ClaimedAt     time.Time  `json:"claimedAt"`
    Note          string     `json:"note,omitempty"`
    ReleasedAt    *time.Time `json:"releasedAt,omitempty"`
    ReleasedBy    string     `json:"releasedBy,omitempty"`
    ReleaseReason string     `json:"releaseReason,omitempty"` // manual | resolved | reclaimed
}

// ── WebSocket Events ─────────────────────────────────────────────────────────

type WSEvent struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

const (
    WSTypeAlertsUpdate  = "alerts_update"   // payload: { alerts: EnrichedAlert[] }
    WSTypeClaimSet      = "claim_set"        // payload: { fingerprint, claim }
    WSTypeClaimReleased = "claim_released"   // payload: { fingerprint, releasedBy }
    WSTypeCommentAdded  = "comment_added"    // payload: { fingerprint, comment }
)

// ── Cluster ──────────────────────────────────────────────────────────────────

type ClusterInfo struct {
    Name            string `json:"name"`
    AlertmanagerURL string `json:"alertmanagerUrl"`
    PrometheusURL   string `json:"prometheusUrl"`
    Healthy         bool   `json:"healthy"`
    AlertCount      int    `json:"alertCount"`
}

// ── AlertGroup ───────────────────────────────────────────────────────────────

// AlertGroup — Alerts gruppiert nach severity + alertname (für /alerts/groups)
type AlertGroup struct {
    Alertname string          `json:"alertname"`
    Severity  string          `json:"severity"`
    Alerts    []EnrichedAlert `json:"alerts"`
    Count     int             `json:"count"`
}
```

### 6.2 SQLite-Schema (`internal/db/db.go`)

Schema wird inline via `db.Migrate()` angelegt — keine separaten Migrations-Dateien nötig:

```sql
CREATE TABLE IF NOT EXISTS alert_fingerprints (
    fingerprint      TEXT PRIMARY KEY,
    alertname        TEXT NOT NULL,
    cluster_name     TEXT NOT NULL,
    labels           TEXT NOT NULL,     -- JSON
    first_seen_at    DATETIME NOT NULL,
    last_seen_at     DATETIME NOT NULL,
    occurrence_count INTEGER DEFAULT 1
);

-- Jede Statusänderung eines Alerts
-- Status: firing | suppressed | expired | resolved
CREATE TABLE IF NOT EXISTS alert_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint      TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    cluster_name     TEXT NOT NULL,
    alertmanager_url TEXT NOT NULL,
    status           TEXT NOT NULL,
    starts_at        DATETIME NOT NULL,
    ends_at          DATETIME,          -- NULL solange firing; bei Lifecycle-Events == starts_at
    annotations      TEXT,              -- JSON (optional, für Debug-Infos)
    recorded_at      DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Kommentare — fingerprint-gebunden, bleiben über alle Firing-Episoden erhalten
CREATE TABLE IF NOT EXISTS alert_comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint  TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    event_id     INTEGER REFERENCES alert_events(id), -- optionaler Episodenbezug
    author_name  TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Claiming — vollständige Historie; aktiver Claim = released_at IS NULL
CREATE TABLE IF NOT EXISTS alert_claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint    TEXT NOT NULL REFERENCES alert_fingerprints(fingerprint),
    event_id       INTEGER REFERENCES alert_events(id),
    claimed_by     TEXT NOT NULL,
    claimed_at     DATETIME NOT NULL DEFAULT (datetime('now')),
    note           TEXT,
    released_at    DATETIME,
    released_by    TEXT,
    release_reason TEXT  -- manual | resolved | reclaimed
);

CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at   ON alert_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_comments_fingerprint ON alert_comments(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_fingerprint ON alert_claims(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_claims_active      ON alert_claims(fingerprint)
    WHERE released_at IS NULL;
```

**SQLite-Einstellungen** (beim Open):
```go
db.SetMaxOpenConns(1)                    // SQLite: single writer
PRAGMA journal_mode=WAL                  // bessere Lese-/Schreib-Parallelität
PRAGMA foreign_keys=ON
PRAGMA busy_timeout=5000
```

---

## 7. Backend — Vollständige API

```
# Alerts (aus in-memory AlertStore)
GET  /api/v1/alerts                              → []EnrichedAlert (mit activeClaim)
     ?cluster=homelab                            → Filter nach Cluster
     ?severity=critical                          → Filter nach Label
     ?state=firing|resolved                      → Filter nach Status
GET  /api/v1/alerts/groups                       → []AlertGroup (nach severity+alertname)
# Alert-Details (aus SQLite)
GET  /api/v1/alerts/:fingerprint/history         → { events: AlertEvent[], total: int }
     ?limit=20 &offset=0
GET  /api/v1/alerts/:fingerprint/stats           → AlertStats

# Kommentare
GET  /api/v1/alerts/:fingerprint/comments        → []Comment (neueste zuerst)
POST /api/v1/alerts/:fingerprint/comments        → Comment
     Body: { authorName, body, eventId? }
DEL  /api/v1/alerts/:fingerprint/comments/:id   → 204

# Claiming
GET  /api/v1/alerts/:fingerprint/claim           → Claim | 404
POST /api/v1/alerts/:fingerprint/claim           → Claim (201)
     Body: { claimedBy, note?, eventId? }
DEL  /api/v1/alerts/:fingerprint/claim           → 204
     ?by=username
GET  /api/v1/alerts/:fingerprint/claims/history  → []Claim

# Silences (proxied gegen Alertmanager)
GET  /api/v1/silences                            → []Silence
     ?cluster=homelab
POST /api/v1/silences                            → { id: string } (201)
     Body: { cluster, matchers[], startsAt, endsAt, createdBy, comment,
             id?, fingerprint?, performedBy? }
     Hinweis: Wenn id gesetzt → Update/Extend einer bestehenden Silence
     Wenn fingerprint gesetzt → Silence-Aktion in alert_events aufzeichnen
DEL  /api/v1/silences/:id                        → 204
     ?cluster=homelab &fingerprint=... &by=username

# Cluster
GET  /api/v1/clusters                            → []ClusterInfo (mit healthy + alertCount)

# System
GET  /api/v1/status                              → { status, clusters, alerts, ws_clients }
GET  /health                                     → { status: "ok" }

# WebSocket
WS   /ws                                         → Realtime Push

# Static (nur Production)
GET  /*                                          → embed.FS (Vite-Build)
```

---

## 8. Backend — Komponenten-Übersicht

### 8.1 `internal/config/config.go`

- Lädt `.env` via `godotenv.Load()` (no-op wenn nicht vorhanden)
- Parsed `JARVIS_CLUSTER_N_*` in einer Schleife von `i=1` bis `NAME` leer
- `resolveAlertmanagerLinkURL(alertmanagerURL, hostAlias)`: Wenn `HOST_ALIAS` gesetzt, ersetzt Host/Scheme in der URL für Browser-Links
- `AllowedOrigins []string`: aus `JARVIS_ALLOWED_ORIGINS` (kommasepariert) — für CORS-Middleware und WebSocket-`CheckOrigin`. Leer → same-origin only.

### 8.2 `internal/db/db.go`

- `Open(path)`: Öffnet SQLite, setzt PRAGMAs, erstellt Verzeichnis falls nötig
- `Migrate(db)`: Führt alle `CREATE TABLE IF NOT EXISTS` und `CREATE INDEX IF NOT EXISTS` aus

### 8.3 `internal/cluster/registry.go`

- Hält `[]*Cluster` und `map[string]*Cluster`
- Jedes `Cluster` hat `alertmanager.Client` für API-Calls
- `All()` und `Get(name)` für Zugriff

### 8.4 `internal/alertmanager/client.go`

Thin HTTP-Client gegen Alertmanager API v2:
- `GetAlerts(ctx)` → `GET /api/v2/alerts`
- `GetSilences(ctx)` → `GET /api/v2/silences`
- `CreateSilence(ctx, postable)` → `POST /api/v2/silences` → silence ID
- `DeleteSilence(ctx, id)` → `DELETE /api/v2/silences/{id}`
- `Ping(ctx)` → `GET /api/v2/status` (für Health-Check)

### 8.5 `internal/history/alert_store.go`

In-memory Store für den aktuellen Poll-Snapshot:
- `sync.RWMutex` für Thread-Safety
- `Set(alerts)` — ersetzt gesamten Snapshot
- `Get()` — gibt Kopie zurück
- `SetActiveClaim(fp, claim)` — patcht Claim eines Alerts in-memory
- `ClearActiveClaim(fp)` — entfernt Claim in-memory
- `MarkResolved(fp)` — setzt Status auf `resolved`, cleared Claims in-memory
- `RemoveByFingerprint(fp)` — entfernt Alert aus In-memory-Store

### 8.6 `internal/history/store.go` (SQLite)

Alle DB-Operationen:

**Fingerprint:**
- `UpsertFingerprint(fp, alertname, cluster, labels)` — INSERT OR UPDATE, updatet `last_seen_at`

**Events:**
- `GetOrCreateActiveEvent(fp, cluster, amURL, status, startsAt, annotations)` — gibt existierendes offenes Event zurück ODER erstellt neues. **Grace Period**: Wenn letztes resolved Event < 60s alt → Event wiedereröffnen (verhindert Ghost-Resolve-Einträge bei transienten Poll-Misses). **occurrence_count** nur erhöhen wenn es bereits frühere Events gab (nicht beim allerersten Firing).
- `ResolveEvents(fps, endsAt)` — setzt `ends_at` für alle offenen Events der gegebenen Fingerprints
- `GetHistory(fp, limit, offset)` — paginiert, `ORDER BY starts_at DESC`
- `GetStats(fp)` — aus `alert_fingerprints`

**Kommentare:**
- `GetComments(fp)` — ORDER BY created_at DESC
- `AddComment(fp, eventID, authorName, body)`
- `DeleteComment(id)` — mit RowsAffected-Prüfung

**Claims:**
- `GetActiveClaim(fp)` — WHERE released_at IS NULL
- `SetClaim(fp, eventID, claimedBy, note)` — released bestehende aktive Claims (reason: `reclaimed`), schreibt neuen
- `ReleaseClaim(fp, releasedBy, reason)` — mit RowsAffected-Prüfung
- `GetClaimHistory(fp)` — ORDER BY claimed_at DESC
- `ReleaseClaimsForResolved(fps)` — bulk auto-release (reason: `resolved`)

### 8.7 `internal/history/recorder.go`

Polling-Loop: Startet sofort, dann alle `JARVIS_POLL_INTERVAL`. Pro Poll: alle Cluster parallel fetchen, Alerts enrichen, UpsertFingerprint + GetOrCreateActiveEvent aufrufen. Diff zu vorherigem Snapshot → Statusübergänge als Events schreiben (`firing` / `suppressed` / `expired` / `resolved`). Resolved-Fingerprints ermitteln → ResolveEvents + ReleaseClaimsForResolved. Resolved Alerts 20 Min. im Store behalten (ausgegraut), danach entfernen. GetActiveClaim für alle Alerts → `alert.ActiveClaim` setzen. `alertStore.Set(allAlerts)` + `hub.Broadcast(alerts_update, { alerts })`.

### 8.8 `internal/ws/hub.go`

Standard-Hub-Pattern:
- `Hub` mit `register`/`unregister`/`broadcast` Channels
- `Run()` in eigenem Goroutine
- Jeder Client hat `send chan []byte` (gepuffert 64)
- Langsame Clients: Message droppen (kein Blocking)
- Ping/Pong: 60s pongWait, 54s pingPeriod
- `ClientCount()` für Status-Endpoint
- `upgrader.CheckOrigin`: validiert den `Origin`-Header gegen `cfg.AllowedOrigins` (kein blindes `return true`). Leere Liste → nur same-origin erlauben.

### 8.9 `internal/api/router.go`

`NewRouter(alertStore, historyStore, hub, registry, cfg)` → `*echo.Echo`

Middleware (in dieser Reihenfolge): `Recover()`, `Secure()` (Security-Header, siehe 20.3), `BodyLimit("1M")`, `CORS()` mit `AllowOrigins: cfg.AllowedOrigins` (kein Wildcard `*`).

**Wichtig**: Route `/api/v1/alerts/groups` muss **vor** `/api/v1/alerts/:fingerprint/*` registriert werden, damit Echo nicht `groups` als Fingerprint-Param interpretiert.

Static-Files: `embed.FS` nur wenn nicht nil (dev: nil, prod: befüllt).

---

## 9. Frontend — Komponenten-Übersicht

### 9.1 Verzeichnisstruktur

```
frontend/src/
├── main.tsx                     # ReactDOM.createRoot, QueryClient, App
├── App.tsx                      # Router + RootLayout
├── api/
│   └── client.ts                # Alle fetch-Wrapper gegen /api/v1/*
├── store/
│   └── uiStore.ts               # Zustand: viewMode, filters, selectedFp, wsConnected, pollingPaused
├── types/
│   └── index.ts                 # Alert, Silence, Claim, Comment, AlertEvent, AlertStats, etc.
├── hooks/
│   ├── useAlerts.ts             # useAlerts, useAlertGroups, useAlertHistory, useAlertStats,
│   │                            # useAlertHistory, useAlertStats
│   ├── useAlertComments.ts      # useAlertComments, useAddComment, useDeleteComment
│   ├── useAlertClaim.ts         # useClaim, useClaimHistory, useSetClaim, useReleaseClaim
│   ├── useSilences.ts           # useSilences, useUpsertSilence, useDeleteSilence
│   └── useWebSocket.ts          # WS-Verbindung + Cache-Patching via handleEvent()
├── lib/
│   └── alertUtils.ts            # getFilterableLabels, matchesLabelMatchers, safeRegex,
│                                # getEffectiveAlertState (NICHT duplizieren — einmal hier)
└── components/
    ├── ui/                      # shadcn/ui Komponenten
    ├── layout/
    │   └── Header.tsx           # Nav, Cluster-Status, WS-Indicator, Polling-Controls, Filters
    ├── alerts/
    │   ├── AlertsPage.tsx       # Routing-Outlet: lädt useWebSocket, filtert, zeigt Card/List + Panel
    │   ├── AlertCardGrid.tsx    # Severity-gruppierte Cards
    │   ├── AlertCard.tsx        # Einzelne Card mit Claim-Avatar, Count-Badge
    │   ├── AlertListView.tsx    # Tabellen-View
    │   ├── AlertListRow.tsx     # Einzelne Tabellenzeile
    │   ├── AlertDetailPanel.tsx # Slide-over: alle Sektionen
    │   ├── AlertHistoryTable.tsx# Paginierte Firing-Historie
    │   ├── AlertComments.tsx    # Kommentarliste + Eingabeformular
    │   ├── AlertClaimSection.tsx# Aktiver Claim + Claim-Historie + Claim/Release-Buttons
    │   ├── AlertBadge.tsx       # Severity-Badge
    │   ├── AlertFilters.tsx     # Label-Matcher-Chips, State-Dropdown
    │   ├── LabelFilterChip.tsx  # Einzelner Matcher-Chip mit Edit/Remove
    │   ├── ViewToggle.tsx       # ⊞ / ☰ Toggle
    │   └── alertLinks.ts        # Hilfsfunktionen für Grafana/Prometheus-Links aus Labels
    └── silences/
        ├── SilencesPage.tsx     # Silence-Liste
        ├── SilenceCard.tsx      # Einzelne Silence (Status, Matchers, Expiry)
        ├── SilenceExpiry.tsx    # "expired vor X Min." / "läuft ab in X"
        └── SilenceForm.tsx      # Silence erstellen/bearbeiten (Matcher-Builder)
```

### 9.2 `store/uiStore.ts`

```typescript
interface UIStore {
  viewMode: 'card' | 'list'
  selectedFingerprint: string | null
  filters: {
    state: string
    search: string
    labelMatchers: LabelMatcher[]
  }
  wsConnected: boolean
  pollingPaused: boolean
  // Actions: setViewMode, setSelectedFingerprint, setFilter,
  //          addLabelMatcher, updateLabelMatcher, removeLabelMatcher,
  //          clearLabelMatchers, resetFilters, setWsConnected, setPollingPaused
}

// persist: viewMode + filters (nicht: wsConnected, pollingPaused, selectedFingerprint)
```

### 9.3 URL-State-Serialisierung

URL-Params (nur nicht-Default-Werte werden gesetzt):

| Param | Wert | Default |
|---|---|---|
| `view` | `list` | `card` (Standard, nicht in URL) |
| `state` | z.B. `active` | leer |
| `q` | Suchtext | leer |
| `matchers` | JSON-Array von `{name, operator, value}` | leer |
| `alert` | fingerprint | leer |

**Hydration-Reihenfolge**: URL-Params werden beim ersten Mount gelesen und in den Store geschrieben (`hasHydratedFromUrlRef`). Danach überschreibt der Store die URL bei Änderungen (`replaceState`). localStorage-Werte aus Zustand-persist gelten als Fallback, werden aber von URL-Params überschrieben.

### 9.4 WebSocket-Handling (`hooks/useWebSocket.ts`)

Reconnect nach 3s bei close/error. `mountedRef` verhindert State-Updates nach Unmount. `handleEvent`: `alerts_update` → `queryClient.setQueryData(['alerts'], payload.alerts)`; `claim_set`/`claim_released` → alerts-Cache patchen + `['claim', fp]` und `['claim-history', fp]` invalidieren; `comment_added` → `['comments', fp]` invalidieren.

### 9.5 Filter-Logik (`lib/alertUtils.ts`)

**Geteilte Funktionen** (nicht in App.tsx UND AlertsPage.tsx duplizieren): `getFilterableLabels` ergänzt `alert.labels` um `@receiver`, `receiver` und `@cluster`. `matchesLabelMatchers` unterstützt `=` / `!=` / `=~` / `!~`. `getEffectiveAlertState` gibt `active` zurück wenn Alert `suppressed` ist und Silence in ≤15 Min. abläuft, sonst `alert.status.state`. `safeRegex` wrapped `new RegExp()` in try/catch.

### 9.6 `types/index.ts`

Vollständige TypeScript-Typen spiegeln exakt die Go-Models:

```typescript
// Alert, AlertStatus, Receiver
// Silence, SilenceMatcher, SilenceStatus
// AlertEvent (mit allen Status-Strings als Union Type)
// AlertStats
// Comment
// Claim
// ClusterInfo
// AlertGroup
// LabelMatcher (für Filter)
```

---

## 10. Datenfluss (Polling + Persistenz + Realtime)

```
.env → Cluster Registry
           │
           │  alle JARVIS_POLL_INTERVAL (parallel pro Cluster)
           ▼
  Alertmanager API v2 → GET /api/v2/alerts
           │
           ▼
  Recorder.poll():
    ├── UpsertFingerprint (labels, alertname, cluster, last_seen_at)
    ├── GetOrCreateActiveEvent (grace period: 60s Reopen)
    ├── occurrence_count++ (nur bei erneutem Firing nach Resolve)
    ├── Silence-Expire-Detektion (suppressed → active Transition)
    ├── Resolved-Fingerprints ermitteln (Diff prev/curr)
    ├── ResolveEvents (ends_at setzen)
    ├── ReleaseClaimsForResolved (auto-release)
    ├── Resolved 20 Min. im Store behalten
    └── GetActiveClaim für alle Alerts → Alert.activeClaim

           ├── alertStore.Set(allAlerts)
           └── hub.Broadcast(alerts_update, { alerts })

                    │
              WebSocket Push
                    │
              Browser:
              queryClient.setQueryData(['alerts'], alerts)
              React re-renders (nur betroffene Komponenten)
```

---

## 11. Bekannte Probleme der ersten Implementierung (beim Neuschreiben vermeiden)

| Problem | Beschreibung | Lösung |
|---|---|---|
| Duplizierter Filter-Code | `matchesLabelMatchers` + `getFilterableLabels` in `App.tsx` UND `AlertsPage.tsx` | Einmal in `lib/alertUtils.ts`, beide importieren |
| Debug-`console.log` in Produktion | `AlertsPage.tsx` und `App.tsx` haben `console.log`-Calls aus der Entwicklung | Alle entfernen |
| `occurrence_count` nicht erhöht beim ersten Polling | Korrekt by Design: `UpsertFingerprint` erhöht Zähler nicht on conflict — nur `GetOrCreateActiveEvent` erhöht wenn `hadPreviousEvent`. Beim allerersten Auftreten zählt die initiale Zeile (1). | Beibehalten. |
| `AlertsPage` importiert `useSilences` nur für `getEffectiveAlertState` | Koppelt Alert-View hart an Silences | Silences-Daten aus TanStack-Query-Cache lesen oder State-Filter-Logik ins Backend verlagern |
| `WSEvent.Payload` ist `interface{}` in Go | `json.Marshal` zweimal (einmal für Payload, einmal für Event) | Besser: `json.RawMessage` für Payload von Anfang an |
| `AlertStore.RemoveByFingerprint` erstellt neues Slice | Slice-Handling mit `[:0]` und dann `append([]T(nil), filtered...)` ist korrekt, aber verbose | Beibehalten (ist sicher) |
| Keine Typen für Alert-Event-Status | In Go ist `status` ein `string`, kein `const`-Set | Enum-like Konstanten definieren |

---

## 12. Backend — Verzeichnisstruktur

> **Go-Modulpfad**: `go.mod` deklariert `module github.com/kj187/jarvis/backend`. Alle internen Imports lauten entsprechend `github.com/kj187/jarvis/backend/internal/...`. (Platzhalter `kj187` ggf. an das tatsächliche GitHub-Repo anpassen — muss mit `<owner>` in den Release-Workflows übereinstimmen.)

```
backend/
├── cmd/jarvis/
│   └── main.go                  # Start: config → db → registry → stores → hub → recorder → server
├── internal/
│   ├── api/
│   │   ├── router.go            # NewRouter(), Middleware, alle Routes registrieren
│   │   ├── alerts.go            # getAlerts, getAlertGroups, getAlertHistory, getAlertStats
│   │   ├── comments.go          # getComments, addComment, deleteComment
│   │   ├── claims.go            # getClaim, setClaim, releaseClaim, getClaimHistory
│   │   ├── silences.go          # getSilences, createSilence (create+update+extend), deleteSilence
│   │   ├── clusters.go          # getClusters, getStatus
│   │   └── server.go            # Server-Struct mit Feldern (alertStore, historyStore, hub, registry)
│   ├── alertmanager/
│   │   ├── client.go            # HTTP-Client (GetAlerts, GetSilences, CreateSilence, DeleteSilence, Ping)
│   │   └── types.go             # AM-interne Types (GettableAlert, PostableSilence, Matcher, ...)
│   ├── cluster/
│   │   └── registry.go          # Cluster-Struct + Registry
│   ├── config/
│   │   └── config.go            # Load(), resolveAlertmanagerLinkURL()
│   ├── db/
│   │   └── db.go                # Open(), Migrate() (inline SQL)
│   ├── history/
│   │   ├── alert_store.go       # In-memory Store (sync.RWMutex)
│   │   ├── store.go             # SQLite-Operationen (alle CRUD-Methoden)
│   │   └── recorder.go          # Polling-Loop, Diff-Logik, Broadcast
│   ├── models/
│   │   └── models.go            # Alle gemeinsamen Typen + WS-Konstanten
│   ├── static/
│   │   ├── static_prod.go       # //go:build prod — //go:embed all:dist; var StaticFiles embed.FS
│   │   └── static_dev.go        # //go:build !prod — var StaticFiles embed.FS{} (leer, Vite übernimmt)
│   └── ws/
│       └── hub.go               # Hub, Client, writePump, readPump
├── go.mod
├── go.sum
└── Containerfile.dev            # Für Entwicklung mit air
```

---

## 13. Containerisierung

### 13.1 `compose.yml` (Production)

```yaml
services:
  jarvis:
    build:
      context: .
      dockerfile: Containerfile
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    env_file: .env
    restart: unless-stopped
```

### 13.2 `compose.dev.yml` (Entwicklung)

```yaml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Containerfile.dev   # Go + air
    ports:
      - "8080:8080"
    volumes:
      - ./backend:/app
      - ./data:/data
    env_file: .env
    restart: unless-stopped

  frontend:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "npm install -g pnpm && pnpm install && pnpm dev --host"
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
    environment:
      - VITE_API_BASE=http://localhost:8080
```

Vite proxied `/api` und `/ws` an Backend (vite.config.ts):
```typescript
server: {
  proxy: {
    '/api': 'http://backend:8080',
    '/ws':  { target: 'ws://backend:8080', ws: true },
  }
}
```

### 13.3 `Containerfile` (Production Multi-Stage)

```dockerfile
# Stage 1: Frontend Build
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Backend Build
FROM golang:1.24-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/dist ./internal/static/dist
RUN CGO_ENABLED=0 go build -tags prod -o /jarvis ./cmd/jarvis

# Stage 3: Final
FROM gcr.io/distroless/static-debian12
USER nonroot:nonroot
COPY --from=backend /jarvis /jarvis
ENTRYPOINT ["/jarvis"]
```

**Static-Embedding via Build-Tags** (kein nil-`embed.FS`): `//go:embed` kann ein nicht vorhandenes `dist`-Verzeichnis nicht kompilieren — daher zwei Dateien statt einer.
- `static_prod.go` (`//go:build prod`): `//go:embed all:dist` → `StaticFiles` enthält den Vite-Build. Produktions-Build nutzt `go build -tags prod`.
- `static_dev.go` (`//go:build !prod`): `var StaticFiles = embed.FS{}` (leer). Default-Build (ohne Tag) — `go test ./...` und Dev brauchen kein `dist`-Verzeichnis. Router serviert nichts; Vite übernimmt das Frontend.
- Router prüft `len(entries) == 0` (oder Build-Tag-Flag) → Static-Serving nur in Produktion aktiv.

---

## 14. Entwicklungs-Workflow

> **Kein lokales Tooling nötig.** Go, Node.js, pnpm laufen in Containern.
> Einzige Voraussetzung: **Podman** + **podman-compose** (oder Docker Compose).

```bash
# 1. .env anlegen
cp .env.example .env
# .env editieren — mindestens einen Cluster konfigurieren

# 2. Entwicklung starten (Hot-Reload)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:8080 (air auto-rebuild)

# 3. Production bauen und starten
podman compose up --build -d
# http://localhost:8080 (alles in einem Container)
```

---

## 15. Implementierungs-Phasenplan

### Phase 0 — Projekt-Setup (Git, Tests, Security-Tooling)

- [ ] `git init` mit Konfiguration: `user.name = Julian Kleinhans`, `user.email = mail@kj187.de`
- [ ] `.gitignore` anlegen (Go, Node, `.env`, `dist/`, `data/`, IDE-Dateien)
- [ ] `LICENSE` anlegen (MIT)
- [ ] `SECURITY.md` anlegen (Responsible Disclosure)
- [ ] Pre-Commit-Hooks einrichten (`.githooks/pre-commit`): Go-Unit-Tests, `gosec`, `govulncheck`, `golangci-lint`, `pnpm audit`
- [ ] `golangci-lint`-Config anlegen (`.golangci.yml`)
- [ ] Backend Test-Scaffolding: leere `*_test.go`-Dateien pro Package
- [ ] Frontend Test-Scaffolding: Playwright oder Vitest + Testing Library Setup
- [ ] `docs/TESTING.md` anlegen
- [ ] `docs/SECURITY.md` anlegen

### Phase 1 — Foundation

- [ ] Projektstruktur anlegen (backend + frontend Verzeichnisse)
- [ ] Go Backend: `config`, `db`, `models`, `cluster/registry`, `alertmanager/client`
- [ ] SQLite-Setup mit `db.Migrate()` (inline SQL)
- [ ] `history/store.go` — alle SQLite-Methoden
- [ ] `history/alert_store.go` — in-memory Store
- [ ] `history/recorder.go` — Polling-Loop mit Diff-Logik
- [ ] `ws/hub.go` — WebSocket Hub
- [ ] `api/router.go` — Echo-Setup + alle Routes
- [ ] Alle API-Handler (`alerts`, `silences`, `clusters`, `comments`, `claims`)
- [ ] `compose.dev.yml` + `Containerfile.dev` (air)
- [ ] React + Vite + Tailwind v4 + shadcn/ui Setup
- [ ] Basis-Types (`types/index.ts`)
- [ ] API-Client (`api/client.ts`)
- [ ] Zustand Store (`store/uiStore.ts`)
- [ ] WebSocket Hook (`hooks/useWebSocket.ts`)
- [ ] Alert-Hooks (`hooks/useAlerts.ts`, etc.)

### Phase 2 — Alert-Ansicht

- [ ] `lib/alertUtils.ts` (getFilterableLabels, matchesLabelMatchers, getEffectiveAlertState)
- [ ] Card View (AlertCardGrid + AlertCard)
- [ ] List View (AlertListView + AlertListRow)
- [ ] View Toggle
- [ ] State-Filter, Label-Matcher-Filter, Suche
- [ ] URL-State-Serialisierung
- [ ] Header-Layout (Nav, WS-Indicator, Polling-Controls, Cluster-Status)

### Phase 3 — Detail-Panel + Silences

- [ ] Alert-Detailpanel (Sheet: Labels, Annotations, Claim-Sektion, Historie, Kommentare)
- [ ] Alert Claiming (setzen, freigeben, Historie)
- [ ] Kommentare (Liste + Formular + Löschen)
- [ ] Paginierte Firing-Historie
- [ ] Silences-Page (Liste mit Expiry-Anzeige)
- [ ] Silence erstellen/bearbeiten/löschen
- [ ] Silence aus Alert-Detailpanel

### Phase 4 — Production

- [ ] `Containerfile` (multi-stage Production Build)
- [ ] `compose.yml` (Production)
- [ ] `static/static_prod.go` + `static_dev.go` (Build-Tags `prod` / `!prod`, `embed.FS`)
- [ ] `.env.example` dokumentieren

---

## 16. Nicht-funktionale Anforderungen

| Anforderung | Ziel |
|---|---|
| Performance | Alert-Liste < 500ms; DB-Queries paginiert |
| Concurrency | SQLite: single writer (`SetMaxOpenConns(1)`); in-memory Store: `sync.RWMutex` |
| Sicherheit | Browser kommuniziert nur mit Jarvis-Backend; kein direkter AM-Zugriff vom Browser. Security-Header via Echo-Middleware. Statische Analyse (gosec, govulncheck, golangci-lint) vor jedem Commit und in CI. Distroless-Container, non-root User, no-new-privileges. |
| Portabilität | Single Container-Image (Podman); alle Config via ENV |
| Code-Qualität | Keine duplizierten Filter-Funktionen; keine Debug-Logs in Produktion |
| Typsicherheit | Go-Models ↔ TypeScript-Types: identische Feldnamen (camelCase JSON) |
| Cursor-UX | **Alle** klickbaren Elemente zeigen `cursor: pointer` beim Hover — Links (`<a>`), Buttons, Icon-Buttons, klickbare Karten/Rows, Chips, Badges. Global in Tailwind-Config oder globalem CSS (`a, button, [role="button"] { cursor: pointer }`). Kein Element darf beim Hover den Default-Cursor behalten wenn es klickbar ist. |

---

## 18. Git-Workflow

### 18.1 Repository-Initialisierung

```bash
git init
git config user.name "Julian Kleinhans"
git config user.email "mail@kj187.de"
```

### 18.2 Pre-Commit-Hooks

Pre-Commit-Hooks liegen unter `.githooks/pre-commit` und werden aktiviert via:

```bash
git config core.hooksPath .githooks
```

Der Hook läuft automatisch vor jedem Commit:
1. Go Unit Tests (`go test ./...`)
2. `gosec ./...` — Security-Scanner
3. `govulncheck ./...` — CVE-Prüfung
4. `golangci-lint run` — Linter-Suite
5. `pnpm audit` (wenn Frontend-Dateien geändert)

Schlägt einer der Schritte fehl → Commit wird abgebrochen.

### 18.3 Commit-Konventionen

Format: [Conventional Commits](https://www.conventionalcommits.org/)

```
<type>(<scope>): <beschreibung>

[optionaler body]
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `security`

Scopes: `backend`, `frontend`, `db`, `api`, `ws`, `config`, `docker`, `docs`

Beispiele:
```
feat(backend): add claim history endpoint
fix(frontend): resolve filter state not persisting across navigation
test(backend): add unit tests for recorder grace period logic
security(backend): add gosec and govulncheck to pre-commit hooks
```

### 18.4 Commit-Strategie (automatisch durch KI)

Commits werden logisch zusammenhängend gebündelt:
- Foundation-Setup (git init, tooling, structure) → 1 Commit
- Pro Package/Modul ein Commit wenn abgeschlossen (z.B. `feat(backend): implement history store`)
- Tests werden zusammen mit dem zugehörigen Code committed (TDD: Test + Implementierung = 1 Commit)
- Security-Tooling-Änderungen als eigener `security:`-Commit
- Dokumentations-Updates als `docs:`-Commit

---

## 19. Test-Strategie (TDD)

### 19.1 Ansatz

**Test-Driven Development**: Tests werden vor oder gleichzeitig mit der Implementierung geschrieben.
Tests schlagen fehl → Implementierung macht sie grün → Refactor.

### 19.2 Backend — Unit Tests (Go)

| Package | Testdatei | Was getestet wird |
|---|---|---|
| `internal/config` | `config_test.go` | Config-Parsing, Cluster-N-Iteration, HOST_ALIAS-Logik |
| `internal/db` | `db_test.go` | Migrate idempotent, PRAGMA-Einstellungen |
| `internal/history` | `store_test.go` | UpsertFingerprint, GetOrCreateActiveEvent, Grace-Period (60s), occurrence_count-Logik |
| `internal/history` | `alert_store_test.go` | Set/Get/MarkResolved/RemoveByFingerprint (Thread-Safety via goroutines) |
| `internal/history` | `recorder_test.go` | Diff-Logik (firing/resolved/suppressed/expired Transitions) |
| `internal/alertmanager` | `client_test.go` | HTTP-Client gegen `httptest.NewServer` |
| `internal/api` | `alerts_test.go`, etc. | Handler-Tests via `echo.NewContext` |
| `internal/ws` | `hub_test.go` | Broadcast, Client-Register/Unregister, Slow-Client-Drop |

**Test-Utilities:**
- `httptest.NewServer` für AM-Client-Tests (kein Mocking des HTTP-Stacks)
- In-memory SQLite (`:memory:`) für alle DB-Tests — kein Filesystem nötig
- `testing/quick` für Property-Based-Tests der Filter-Logik

**Ausführen:**
```bash
# Alle Tests
go test ./...

# Mit Coverage
go test -cover ./...

# Verbose + Race Detector
go test -v -race ./...

# Spezifisches Package
go test ./internal/history/...
```

### 19.3 Frontend — Functional Tests

| Tool | Zweck |
|---|---|
| **Playwright** | End-to-End Functional Tests im Browser |
| **Vitest + Testing Library** | Komponenten-Unit-Tests |

**Functional Test-Szenarien (Playwright):**
- Alert-Liste laden und anzeigen
- Card View ↔ List View Toggle
- Label-Filter hinzufügen, Alert-Liste filtert sich
- URL-State-Serialisierung: Filter in URL, Reload behält Filter
- Detail-Panel öffnen via Alert-Klick
- Claim setzen und freigeben
- Kommentar hinzufügen und löschen
- Silence erstellen (Formular)
- WebSocket-Reconnect-Indikator

**Ausführen:**
```bash
# Playwright E2E Tests
pnpm test:e2e

# Vitest Komponenten-Tests
pnpm test

# Mit Coverage
pnpm test:coverage
```

### 19.4 Pre-Commit-Integration

Go-Unit-Tests laufen **zwingend** vor jedem Commit (via `.githooks/pre-commit`).
Frontend-Tests laufen in CI (zu langsam für Pre-Commit).

### 19.5 CI-Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
jobs:
  backend:
    - go test -v -race -coverprofile=coverage.out ./...
    - gosec ./...
    - govulncheck ./...
    - golangci-lint run

  frontend:
    - pnpm install
    - pnpm audit
    - pnpm test:coverage
    - pnpm build
```

### 19.6 Dokumentation

Vollständige Anleitung in `docs/TESTING.md`:
- Voraussetzungen (Podman/Docker für Integration)
- Backend-Tests ausführen (lokal + in Container)
- Frontend-Tests ausführen (Playwright Setup, Browser-Installation)
- Coverage-Reports generieren
- CI-Pipeline erklären

---

## 20. Security

### 20.1 Statische Analyse (Go)

| Tool | Zweck | Wann |
|---|---|---|
| `gosec` | Scannt auf: hardcoded credentials, SQL-Injection, path traversal, weak crypto, G-Codes | Pre-Commit + CI |
| `govulncheck` | Prüft Abhängigkeiten gegen Go Vulnerability DB (CVEs) | Pre-Commit + CI |
| `golangci-lint` | Aggregator: `errcheck` (fehlende Error-Checks), `bodyclose` (HTTP-Body-Leak), `noctx`, `staticcheck` | Pre-Commit + CI |

**`.golangci.yml` — aktivierte Security-Linter:**
```yaml
linters:
  enable:
    - gosec
    - errcheck
    - bodyclose
    - noctx
    - staticcheck
    - unused
```

### 20.2 Dependency-Sicherheit

- `go mod verify` — prüft Modul-Checksums gegen `go.sum`
- `govulncheck ./...` — CVE-Prüfung bei jedem Pre-Commit und in CI
- **Renovate** oder **Dependabot** — automatische PRs für Dependency-Updates
- `pnpm audit` — Frontend-Abhängigkeiten auf bekannte CVEs prüfen

### 20.3 HTTP-Sicherheit (Echo-Middleware)

```go
// Echo Secure Middleware — setzt folgende Header:
// X-XSS-Protection: 1; mode=block
// X-Content-Type-Options: nosniff
// X-Frame-Options: SAMEORIGIN
// Strict-Transport-Security (wenn HTTPS)
e.Use(middleware.SecureWithConfig(middleware.SecureConfig{...}))

// CORS: strikte Origin-Liste aus Config — kein Wildcard *
e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
    AllowOrigins: cfg.AllowedOrigins,
}))

// Request-Body-Limit: max. 1MB
e.Use(middleware.BodyLimit("1M"))
```

### 20.4 Input-Validierung

- **Fingerprint-Parameter**: Format-Validierung per Regex (`[a-f0-9]{16}`)
- **Pagination**: `limit` auf max. 100 begrenzen, `offset` ≥ 0
- **Silence-Felder**: `comment` Pflichtfeld, Längen-Limits
- **HTTP-Client (AM)**: Timeout auf allen ausgehenden Requests (default 10s)
- **JSON-Unmarshaling**: Unbekannte Felder nicht ignorieren (`json.Decoder.DisallowUnknownFields` wo sinnvoll)

### 20.5 Container-Sicherheit

```dockerfile
# Distroless — keine Shell, minimale Attack Surface (bereits geplant)
FROM gcr.io/distroless/static-debian12

# Non-root User
USER nonroot:nonroot

# Read-only Filesystem (außer /data)
# via compose.yml: read_only: true + tmpfs für /tmp
```

```yaml
# compose.yml
services:
  jarvis:
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

### 20.6 Secrets-Management

- `.env` in `.gitignore` — wird niemals committed
- `.env.example` enthält **ausschließlich** Platzhalter (keine echten Werte)
- Kein Secret in Source-Code (gosec G-Codes prüfen dies automatisch)
- Alle Konfiguration über Umgebungsvariablen (12-Factor-App)

### 20.7 Frontend-Sicherheit

- TypeScript `strict: true` in `tsconfig.json`
- Kein `dangerouslySetInnerHTML` — React escaped standardmäßig alle Outputs
- CSP-Header werden vom Backend gesetzt
- `pnpm audit` in CI — Frontend-Dependencies auf CVEs prüfen

### 20.8 Open-Source-Sicherheit

- **`SECURITY.md`**: Responsible Disclosure Policy — wie werden Sicherheitslücken gemeldet?
- **`LICENSE`**: MIT
- **GitHub Security Advisories**: aktiviert im Repo
- **Signed Releases** (optional, Phase 4): `cosign` für Container-Image-Signierung

### 20.9 Dokumentation

Vollständige Beschreibung in `docs/SECURITY.md`:
- Welche Tools laufen wann (Pre-Commit, CI)
- Wie Sicherheitslücken gemeldet werden sollen
- Container-Sicherheitsmaßnahmen
- Dependency-Update-Prozess
- Was bewusst **nicht** implementiert ist (z.B. Authentifizierung — Deployment hinter Reverse-Proxy erwartet)

---

## 21. Dokumentations-Übersicht

| Datei | Inhalt |
|---|---|
| `README.md` | Projekt-Überblick, Quick-Start, Screenshots |
| `CHANGELOG.md` | Vollständige Release-History (generiert via git-chglog) |
| `docs/TESTING.md` | Tests ausführen (Backend + Frontend + CI) |
| `docs/SECURITY.md` | Security-Maßnahmen, Responsible Disclosure |
| `docs/RELEASE.md` | Release-Prozess, Versionierungsschema, GHCR-Image-URL |
| `SECURITY.md` | Responsible Disclosure (Root-Level, GitHub-Standard) |
| `CONTRIBUTING.md` | Contribution-Guidelines für Open Source |
| `LICENSE` | MIT License |
| `.env.example` | Alle Konfigurationsvariablen mit Beschreibung |
| `.chglog/config.yml` | git-chglog Konfiguration |

---

## 23. Lebenszyklus dieses Dokuments + .claude/-Persistenz

### 23.1 PLAN2.md wird gelöscht

Dieses Dokument dient **ausschließlich der initialen KI-gestützten Entwicklung**.
Nach Abschluss von Phase 4 (Production-Build) wird `PLAN2.md` aus dem Repository entfernt:

```bash
# Phase 4, letzter Schritt:
git rm PLAN2.md
git commit -m "chore: remove initial development plan (superseded by docs/ + .claude/)"
```

Der Inhalt geht dabei **nicht verloren** — er wird in `CLAUDE.md` und `.claude/commands/` überführt,
sodass zukünftige KI-Sessions und Contributors vollständige Orientierung haben.

---

### 23.2 .claude/-Struktur

```
.claude/
├── commands/
│   ├── architecture.md      # Vollständige Architektur-Referenz (on-demand)
│   ├── add-feature.md       # TDD-Workflow + Checkliste für neue Features
│   ├── security-check.md    # Security-Tools ausführen + Checkliste
│   └── release.md           # Release-Workflow: Changelog, Tag, GHCR, GitHub Release
└── settings.json            # Project permissions (pre-commit hooks, Container-Befehle)
```

Zusätzlich: `CLAUDE.md` im Projekt-Root — wird von Claude Code **automatisch** bei jeder Session geladen.

---

### 23.3 CLAUDE.md (Projekt-Root) — immer aktiv

Enthält die dauerhaft relevante Kurzreferenz:

**Was rein kommt:**
- Architektur in 1 Absatz (Go Backend + React Frontend + SQLite)
- Technologie-Entscheidungen + WHY (warum `modernc.org/sqlite`? warum kein CGO?)
- Kritische nicht-offensichtliche Invarianten:
  - Grace Period 60s: Alert within 60s nach resolve → Event wiedereröffnen, kein Ghost-Resolve
  - `occurrence_count` erst beim **zweiten** Firing erhöhen (nicht beim ersten)
  - `getEffectiveAlertState`: `suppressed` + Silence ≤15 Min. → gibt `active` zurück
  - Filter-Funktionen **nur** in `lib/alertUtils.ts` — nie duplizieren
  - `cursor: pointer` auf **alle** klickbaren Elemente (global CSS)
  - Kein `console.log` in Produktionscode
  - Route `/api/v1/alerts/groups` **vor** `/api/v1/alerts/:fingerprint/*` registrieren
- Git-Workflow: `git config core.hooksPath .githooks`, Conventional Commits
- Test-Befehle: `go test -race ./...`, `pnpm test`, `pnpm test:e2e`
- Security-Tools: `gosec ./...`, `govulncheck ./...`, `golangci-lint run`, `pnpm audit`
- Pointer auf `.claude/commands/` für tiefere Referenz

**Was NICHT rein kommt** (gehört in `.claude/commands/architecture.md`):
- Vollständiges Datenmodell (Go-Structs, SQLite-Schema)
- Alle API-Endpunkte
- Frontend-Komponentenbaum

---

### 23.4 .claude/commands/architecture.md

Slash-Command: `/project:architecture`

Vollständige Architektur-Referenz für tiefe Feature-Arbeit. Enthält alles was jetzt in PLAN2.md steht:

- Vollständige Go-Models (`EnrichedAlert`, `Silence`, `AlertEvent`, `Claim`, `Comment`, `WSEvent`, ...)
- SQLite-Schema (alle 4 Tabellen + Indexes)
- Alle API-Endpunkte (Section 7)
- Frontend-Komponentenbaum (Section 9.1)
- `uiStore`-Interface + Zustand-Felder
- URL-State-Serialisierung (welche Params, Hydration-Reihenfolge)
- WebSocket-Event-Typen + Payloads
- Data-Flow (Polling → Recorder → Store → WS → Browser)
- Zustandsmaschine (firing/suppressed/expired/resolved + Edge Cases)
- Bekannte Probleme der ersten Implementierung (Section 11 — beim Refactor vermeiden)

**Wann benutzen:** Bei größeren Feature-Arbeiten, Refactoring, neuen API-Endpunkten,
wenn Kontext über Datenmodell oder Zustandsübergänge nötig ist.

---

### 23.5 .claude/commands/add-feature.md

Slash-Command: `/project:add-feature`

Schritt-für-Schritt Workflow für neue Features (TDD + Conventions):

**Backend (neuer Endpunkt):**
1. Model in `internal/models/models.go` ergänzen (Go-Struct + JSON-Tags)
2. `*_test.go` anlegen → Test schreiben → schlägt fehl
3. Handler in `internal/api/<bereich>.go` implementieren → Test grün
4. Route in `internal/api/router.go` registrieren (Reihenfolge beachten!)
5. Security: Input validieren, Fehler nicht leaken, Context mit Timeout
6. Pre-Commit-Hook läuft automatisch: Tests + gosec + govulncheck

**Frontend (neue Komponente):**
1. Typ in `types/index.ts` ergänzen (spiegelt Go-Model exakt)
2. API-Wrapper in `api/client.ts` (falls neuer Endpunkt)
3. TanStack Query Hook in `hooks/` (useXyz.ts)
4. Komponente schreiben — Checkliste:
   - Alle klickbaren Elemente: `cursor: pointer`
   - Kein `console.log`
   - Shared Utils aus `lib/alertUtils.ts` importieren, nicht duplizieren
5. Playwright-Test für Golden-Path

**Commit-Format:**
```
feat(<scope>): <beschreibung>
test(<scope>): add unit tests for <feature>
```
Tests immer im gleichen Commit wie Implementierung.

---

### 23.6 .claude/commands/security-check.md

Slash-Command: `/project:security-check`

On-demand Security-Prüfung — alles was der Pre-Commit-Hook auch macht, manuell ausführbar:

```bash
# Go Backend
gosec ./...
govulncheck ./...
golangci-lint run
go mod verify
go test -race ./...

# Frontend
pnpm audit

# Container (Containerfile prüfen)
# - USER nonroot:nonroot gesetzt?
# - FROM distroless/static-debian12?
# - Kein COPY von .env?
```

**Checkliste neuer Code:**
- [ ] Keine hardcoded Strings die wie Secrets aussehen
- [ ] HTTP-Client-Calls haben Context + Timeout
- [ ] Pfadparameter validiert (Fingerprint-Format, IDs)
- [ ] Fehler-Responses lecken keine internen Details (`c.JSON(500, "internal error")`)
- [ ] Kein `dangerouslySetInnerHTML` im Frontend
- [ ] `.env` nicht in git (`git status` prüfen)

---

### 23.7 Phase 0 — Ergänzung: .claude/-Dateien erstellen

Zu den Phase-0-Tasks (Section 15) gehört:

- [ ] `CLAUDE.md` im Projekt-Root anlegen (mit Inhalt aus 23.3)
- [ ] `.claude/commands/architecture.md` anlegen (mit Inhalt aus 23.4)
- [ ] `.claude/commands/add-feature.md` anlegen (mit Inhalt aus 23.5)
- [ ] `.claude/commands/security-check.md` anlegen (mit Inhalt aus 23.6)
- [ ] `.claude/settings.json` anlegen (Permissions für pre-commit, container-befehle)

### 23.8 Phase 4 — Ergänzung: PLAN2.md löschen

Letzter Task in Phase 4:
- [ ] Sicherstellen dass `CLAUDE.md` + `.claude/commands/` vollständig und aktuell sind
- [ ] `git rm PLAN2.md`
- [ ] Commit: `chore: remove initial development plan`

---

## 25. Release-Management

### 25.1 Versionierung

Semantic Versioning: `vMAJOR.MINOR.PATCH`

| Bump | Wann |
|---|---|
| `PATCH` | Bugfix, Security-Patch, kleinere Verbesserungen |
| `MINOR` | Neues Feature, rückwärtskompatibel |
| `MAJOR` | Breaking Change (API, Config-Format, DB-Schema-Migration nötig) |

Erstes stabiles Release: `v1.0.0`. Davor: `v0.x.y` (kein Stabilitätsversprechen).

---

### 25.2 Changelog

Basis: **Conventional Commits** (Section 18.3) → `git-chglog` generiert daraus automatisch `CHANGELOG.md`.

**Setup: `.chglog/config.yml`**
```yaml
style: github
template: CHANGELOG.tpl.md
info:
  title: CHANGELOG
  repository_url: https://github.com/<owner>/jarvis
options:
  commits:
    filters:
      Type:
        - feat
        - fix
        - security
        - perf
        - refactor
  commit_groups:
    title_maps:
      feat: Features
      fix: Bug Fixes
      security: Security
      perf: Performance
      refactor: Refactoring
  header:
    pattern: "^(\\w*)(?:\\(([\\w\\$\\.\\-\\*\\s]*)\\))?\\!?\\:\\s(.*)$"
    pattern_maps:
      - Type
      - Scope
      - Subject
  issues:
    prefix:
      - '#'
  refs:
    actions:
      - Closes
      - Fixes
  merges:
    pattern: "^Merge pull request #(\\d+) from (.*)$"
    pattern_maps:
      - Ref
      - Source
  notes:
    keywords:
      - BREAKING CHANGE
```

**`CHANGELOG.tpl.md`** — Standard-Template von git-chglog.

---

### 25.3 GitHub Actions — CI/CD Pipeline

```
.github/
├── workflows/
│   ├── ci.yml          # Auf jedem Push + PR: Tests, Linting, Security
│   └── release.yml     # Auf v*-Tags: Build, Image, GitHub Release, Changelog
```

#### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
          cache: true
      - name: Run tests
        run: go test -v -race -coverprofile=coverage.out ./...
        working-directory: backend
      - name: gosec
        uses: securego/gosec@master
        with:
          args: ./backend/...
      - name: govulncheck
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          govulncheck ./...
        working-directory: backend
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install -g pnpm && pnpm install
        working-directory: frontend
      - run: pnpm audit
        working-directory: frontend
      - run: pnpm test:coverage
        working-directory: frontend
      - run: pnpm build
        working-directory: frontend
```

#### `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write        # GitHub Release erstellen
  packages: write        # GHCR push

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # git-chglog braucht vollständige History

      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
          cache: true

      - name: Install git-chglog
        run: go install github.com/git-chglog/git-chglog/cmd/git-chglog@latest

      - name: Generate Changelog for this release
        run: git-chglog --output RELEASE_NOTES.md ${{ github.ref_name }}

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push container image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Containerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
            ghcr.io/${{ github.repository }}:latest

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: RELEASE_NOTES.md
          generate_release_notes: false
          files: |
            RELEASE_NOTES.md
```

---

### 25.4 Schritt-für-Schritt: Neues Release erstellen

```bash
# 1. Sicherstellen: main ist sauber, alle Tests grün
git checkout main
git pull
go test ./... && pnpm test

# 2. CHANGELOG.md aktualisieren (alle Versionen)
git-chglog --output CHANGELOG.md
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for v1.2.0"

# 3. Tag setzen (annotated)
git tag -a v1.2.0 -m "Release v1.2.0"

# 4. Tag pushen → löst release.yml aus
git push origin v1.2.0

# 5. GitHub Actions läuft:
#    - Changelog für v1.2.0 generieren
#    - Container-Image bauen + nach ghcr.io pushen
#    - GitHub Release erstellen (mit Release Notes)
```

**Hotfix-Release:**
```bash
# Patch-Bump: v1.2.0 → v1.2.1
git tag -a v1.2.1 -m "fix: <kurze Beschreibung>"
git push origin v1.2.1
```

---

### 25.5 Container-Image auf GHCR

Nach jedem Release verfügbar als:
```
ghcr.io/<owner>/jarvis:v1.2.0
ghcr.io/<owner>/jarvis:latest
```

Nutzer können damit direkt `compose.yml` verwenden ohne selbst zu bauen:
```yaml
services:
  jarvis:
    image: ghcr.io/<owner>/jarvis:latest
    # statt: build: .
```

---

### 25.6 Dokumentation

`docs/RELEASE.md` enthält:
- Versionierungsschema (Semver)
- Commit-Konventionen Reminder (feat/fix/security → Changelog-Sections)
- Schritt-für-Schritt Release-Guide (identisch mit 25.4)
- GHCR-Image-URL
- Wie man zwischen Versionen wechselt

---

### 25.7 .claude/commands/release.md (Release-Skill)

Slash-Command: `/project:release`

Wenn aufgerufen, fragt die KI nach der gewünschten Version oder dem Bump-Typ,
dann führt sie den vollständigen Release-Prozess durch:

**Was der Skill tut:**

```
1. Prüft: git status clean? Alle Tests grün? Auf main?
2. Fragt: Welcher Release-Typ? (major / minor / patch) oder direkte Version (z.B. v1.2.0)
3. Berechnet neue Version aus letztem Tag (git describe --tags --abbrev=0)
4. Führt aus: git-chglog --output CHANGELOG.md (vollständige History)
5. Staged und committed CHANGELOG.md
6. Erstellt annotated Tag: git tag -a vX.Y.Z -m "Release vX.Y.Z"
7. Pusht Tag: git push origin vX.Y.Z
8. Informiert: GitHub Actions läuft jetzt, Release wird unter
   https://github.com/<owner>/jarvis/releases erstellt
```

**Inhalt von `.claude/commands/release.md`:**
```markdown
Du führst einen Jarvis-Release durch. Vorgehen:

1. Prüfe `git status` — muss clean sein (keine uncommitted changes)
2. Prüfe aktuellen Branch — muss `main` sein
3. Führe `go test ./...` im backend/ aus — muss grün sein
4. Frage den User: major / minor / patch oder direkte Versionsnummer?
5. Ermittle letzte Version: `git describe --tags --abbrev=0`
6. Berechne neue Version nach Semver
7. Generiere CHANGELOG: `git-chglog --output CHANGELOG.md`
8. Zeige dem User die generierten Release Notes für diese Version
   (`git-chglog --output /dev/stdout vX.Y.Z`) — warte auf Bestätigung
9. Committe CHANGELOG: `git add CHANGELOG.md && git commit -m "docs: update CHANGELOG for vX.Y.Z"`
10. Erstelle annotated Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
11. Pushe Tag: `git push origin vX.Y.Z`
12. Gib GitHub Actions URL aus: https://github.com/<owner>/jarvis/actions

Commit-Convention Reminder: feat → MINOR, fix/security → PATCH, BREAKING CHANGE → MAJOR
```

---

### 25.8 Phase 0 / Phase 4 — Ergänzung

**Phase 0:**
- [ ] `.chglog/config.yml` + `CHANGELOG.tpl.md` anlegen
- [ ] `.github/workflows/ci.yml` anlegen
- [ ] `.github/workflows/release.yml` anlegen (Placeholder `<owner>` noch ersetzen)

**Phase 4 (Production):**
- [ ] `docs/RELEASE.md` anlegen
- [ ] `.claude/commands/release.md` anlegen (mit Inhalt aus 25.7)
- [ ] Erstes Release `v0.1.0` nach Production-Build

---

## 26. Referenzen

- [Karma](https://github.com/prymitive/karma) — Inspirationsquelle
- [Alertmanager API v2 OpenAPI](https://github.com/prometheus/alertmanager/blob/main/api/v2/openapi.yaml)
- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) — CGO-freier SQLite-Treiber
- [shadcn/ui](https://ui.shadcn.com/)
- [TanStack Query v5](https://tanstack.com/query/v5)
- [TanStack Router v1](https://tanstack.com/router/v1)
- [Zustand v5](https://zustand-demo.pmnd.rs/)
- [date-fns v4](https://date-fns.org/)
- [Gorilla WebSocket](https://github.com/gorilla/websocket)
- [Echo v4](https://echo.labstack.com/)
- [git-chglog](https://github.com/git-chglog/git-chglog) — Changelog-Generator aus Conventional Commits
- [GoReleaser](https://goreleaser.com/) — Alternative zu manuellem Release-Prozess (optional)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release) — GitHub Release Action
- [docker/build-push-action](https://github.com/docker/build-push-action) — Container-Image Build + GHCR Push
