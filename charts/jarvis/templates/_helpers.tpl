{{/*
Expand the name of the chart.
*/}}
{{- define "jarvis.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited.
*/}}
{{- define "jarvis.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label.
*/}}
{{- define "jarvis.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "jarvis.labels" -}}
helm.sh/chart: {{ include "jarvis.chart" . }}
{{ include "jarvis.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "jarvis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jarvis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "jarvis.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "jarvis.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return true when SQLite is in use (DSN does not start with postgres://).
*/}}
{{- define "jarvis.isSQLite" -}}
{{- if and (not .Values.database.existingSecret) (not (hasPrefix "postgres://" .Values.database.dsn)) (not (hasPrefix "postgresql://" .Values.database.dsn)) }}
{{- true }}
{{- end }}
{{- end }}

{{/*
Validate that SQLite is never combined with multiple replicas.
SQLite requires a single writer (SetMaxOpenConns(1)) and has no leader
election across pods, so every replica would poll Alertmanager
independently and keep its own divergent history — regardless of whether
persistence.enabled uses a PVC or the default emptyDir. This must fire
whenever SQLite is in use, not only when a PVC is configured: the default
persistence.enabled=false (emptyDir) combination is exactly as broken, and
is the configuration most deployments start from.
*/}}
{{- define "jarvis.validateReplicas" -}}
{{- if include "jarvis.isSQLite" . }}
{{-   $replicas := int .Values.replicaCount }}
{{-   if .Values.autoscaling.enabled }}
{{-     fail "Invalid configuration: SQLite (database.dsn is a file path) is incompatible with autoscaling. HPA may schedule multiple pods, and every pod would poll Alertmanager independently and keep its own divergent history. Use PostgreSQL (database.dsn=postgres://...) for scalable deployments." }}
{{-   end }}
{{-   if gt $replicas 1 }}
{{-     fail "Invalid configuration: SQLite (database.dsn is a file path) requires replicaCount=1. Every pod would poll Alertmanager independently and keep its own divergent history. Use PostgreSQL (database.dsn=postgres://...) for multi-replica deployments." }}
{{-   end }}
{{- end }}
{{- end }}

{{/*
Validate that auth.provider has the secret material it needs to actually
start. Without this, an unset auth.secretKey renders a Secret without the
key the Deployment references via secretKeyRef, and the pod only fails at
container-start time with CreateContainerConfigError — a class of error
neither `helm lint` nor `helm template` surfaces.
*/}}
{{- define "jarvis.validateAuth" -}}
{{- if ne .Values.auth.provider "none" }}
{{-   if not (or .Values.auth.existingSecret .Values.auth.secretKey) }}
{{-     fail "Invalid configuration: auth.provider is not 'none' — set auth.secretKey (openssl rand -hex 32) or auth.existingSecret." }}
{{-   end }}
{{-   if eq .Values.auth.provider "oidc" }}
{{-     if or (not .Values.auth.oidc.issuer) (not .Values.auth.oidc.clientId) (not .Values.auth.oidc.redirectUrl) }}
{{-       fail "Invalid configuration: auth.provider=oidc requires auth.oidc.issuer, auth.oidc.clientId and auth.oidc.redirectUrl." }}
{{-     end }}
{{-   end }}
{{- end }}
{{- end }}
