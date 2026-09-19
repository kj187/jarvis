# Connect Alertmanager

Jarvis needs at least one Alertmanager cluster and refuses to start without
one. In Jarvis, a *cluster* is one configured Alertmanager service; that
service may have one member or several members in an Alertmanager HA gossip
group. It is not a Kubernetes cluster.

Set the cluster's display name and the URL Jarvis uses to reach Alertmanager:

```env
JARVIS_CLUSTER_1_NAME=dev
JARVIS_CLUSTER_1_ALERTMANAGER_URL=http://am-dev.example.com:9093
JARVIS_CLUSTER_1_PROMETHEUS_URL=http://prom-dev.example.com:9090
```

Repeat the block with `_2_`, `_3_`, and so on to connect more clusters. The
numbering must be contiguous; Jarvis stops reading at the first gap. The full
variable definitions and stable anchors remain in the
[configuration reference](configuration.md#clusters).

## Alertmanager HA clusters

Alertmanager HA runs two or more instances in a gossip group. Prometheus sends
every alert to all members, and silences replicate between them. Configure all
members as one comma-separated URL list:

```env
JARVIS_CLUSTER_2_NAME=prod
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://am1.prod:9093,http://am2.prod:9093,http://am3.prod:9093
JARVIS_CLUSTER_2_PROMETHEUS_URL=http://prom.prod:9090
```

Jarvis polls every member, deduplicates alerts by fingerprint (the freshest
`updatedAt` wins), and considers the cluster available while at least one
member answers.

What to know:

- **Authentication is per cluster, not per member.** Jarvis fetches one OAuth2
  token and presents it to every member. All members must accept the same
  credentials. Otherwise configure the member as a separate Jarvis cluster,
  which means duplicate alerts are no longer deduplicated.
- **`HOST_ALIAS` accepts one value or exactly one value per member.** A single
  value applies to every member; a list is matched by position. Any other
  count is a startup error.
- **Silences are written to the first healthy member** in configuration order,
  with one retry against the next member after a transport failure. Gossip
  performs replication; writing to every member would create duplicates.
- A member is identified by `host:port` in the UI, metrics, and an alert's
  `seenOn` list. Duplicate member URLs in one cluster are rejected at startup.

Example browser aliases for members exposed on separate local ports:

```env
JARVIS_CLUSTER_2_ALERTMANAGER_URL=http://test-alertmanager:9093,http://test-alertmanager-2:9093
JARVIS_CLUSTER_2_HOST_ALIAS=http://localhost:9094,http://localhost:9095
```

If Alertmanager requires credentials, continue with
[Connect a protected Alertmanager](authentication-alertmanager.md). If the
browser uses a different public hostname, configure `HOST_ALIAS` as described
above and review [Running behind a proxy](reverse-proxy.md).
