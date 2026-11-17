# Notifications

> **Jarvis does not send notifications.** Paging, mail, and push are
> [out of scope](scope.md#out-of-scope) and stay with Alertmanager and its
> receivers. This page is not a Jarvis feature: it shows how to configure an
> Alertmanager receiver that runs *next to* Jarvis, so the people who work
> with alerts in Jarvis also get notified when one fires. Jarvis needs no
> configuration for it and never talks to the receiver.

Alertmanager documents its built-in receivers in the
[receiver integration settings](https://prometheus.io/docs/alerting/latest/configuration/#receiver-integration-settings)
of its configuration reference. Not every service is listed there, but there
are good alternatives beyond the built-in receivers. This page documents one
of them, anynear, which works through Alertmanager's generic webhook
receiver.

Alertmanager decides who is told about an alert and how. Jarvis is the
surface where you handle the alert afterwards. The two meet at the same
Alertmanager: whatever you configure in `alertmanager.yml` is delivered
regardless of whether Jarvis is running. Keep your receivers configured as if
Jarvis did not exist. See [Does Jarvis send notifications?](faq.md#does-jarvis-send-notifications)

## anynear

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/anynear-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/anynear-logo-light.svg">
  <img src="assets/anynear-logo-light.svg" alt="anynear" align="right">
</picture>

[anynear](https://anynear.app/) is a decentralized messenger service. It receives
Alertmanager's standard webhook and recognizes it on its own, so no
adapter or template is needed.

### 1. Create an address in anynear

1. In anynear, open **Meldungen** (notifications) and create a channel, or
   pick an existing one.
2. Open the channel, expand **Erweitert** (advanced), and under
   **Adressen für Geräte** (device addresses) choose **Adresse anlegen**
   (create address).
3. Name it, for example `Jarvis` or `Alertmanager`, and copy the address. It
   looks like `https://alerts.anynear.app/<secret part>`.

> **The address is a secret.** Anyone who knows it can send messages into
> your channel (but not read anything). Do not put it in a file others can
> read or in version control. If it leaks, **revoke** it in anynear
> (*Widerrufen*) and create a new one. Give each sender its own address so
> you only have to replace one.

### 2. Configure Alertmanager

Store the address in a file only Alertmanager can read, and point the webhook
at it with `url_file`:

```bash
install -m 600 /dev/null /etc/alertmanager/secrets/anynear-url
printf '%s' 'https://alerts.anynear.app/<secret part>' \
  > /etc/alertmanager/secrets/anynear-url
```

```yaml
route:
  receiver: anynear

receivers:
  - name: anynear
    webhook_configs:
      - url_file: /etc/alertmanager/secrets/anynear-url
        send_resolved: true
```

- `url_file` keeps the secret out of `alertmanager.yml`. Use `url` instead
  only if your Alertmanager version does not support `url_file`.
- `send_resolved: true` also sends the all-clear when an alert resolves.
- Use a sub-route with `matchers` if only some alerts should go to anynear
  instead of making it the default receiver.

On Kubernetes, mount the file from a `Secret`. With the Prometheus Operator,
reference the Secret from the `AlertmanagerConfig` instead of writing the
address into the manifest.

Reload Alertmanager after changing the configuration
(`curl -X POST http://<alertmanager>:9093/-/reload`, or send `SIGHUP`).

### 3. Test it

Send a test alert to Alertmanager:

```bash
amtool alert add NotificationTest severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://<alertmanager>:9093
```

The message should arrive in your anynear channel within the group wait, and
the alert shows up in Jarvis as usual.

### Limits

Per the anynear documentation, each address accepts up to 60 messages per
hour and 10 at once, and answers `429` with a `Retry-After` header beyond
that. To stay below the limit during an alert storm, group alerts in the
route (`group_by`, `group_interval`, `repeat_interval`) rather than
sending one notification per alert.

For all fields, response codes, and privacy details, see the
[anynear documentation](https://anynear.app/).

## Related

- [Connect Alertmanager](deploy-alertmanager.md): how Jarvis reads from
  Alertmanager
- [Project scope](scope.md): what Jarvis does and does not do
