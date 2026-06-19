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
Validate that SQLite + PVC is not combined with multiple replicas.
SQLite requires a single writer; RWO volumes (e.g. EBS) cannot be mounted by more than one node.
*/}}
{{- define "jarvis.validateReplicas" -}}
{{- if and .Values.persistence.enabled (include "jarvis.isSQLite" .) }}
{{-   $replicas := int .Values.replicaCount }}
{{-   if and (not .Values.autoscaling.enabled) (gt $replicas 1) }}
{{-     fail "Invalid configuration: persistence.enabled=true with SQLite requires replicaCount=1. RWO volumes (e.g. EBS) support only one node mount and SQLite is single-writer. Use PostgreSQL (database.dsn=postgres://...) for multi-replica deployments." }}
{{-   end }}
{{-   if .Values.autoscaling.enabled }}
{{-     fail "Invalid configuration: persistence.enabled=true with SQLite is incompatible with autoscaling. HPA may schedule multiple pods which cannot share a RWO volume or SQLite. Use PostgreSQL (database.dsn=postgres://...) for scalable deployments." }}
{{-   end }}
{{- end }}
{{- end }}
