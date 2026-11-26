# dao

A QianDao gateway built into Magpie. Shared concurrency, bounded retries, and Fast mode run inside one plugin, with an editable upstream URL and a settings page.

## Install

```sh
magpie plugin add github:xinxinxiaoxin/dao
```

You can also find **dao** under **Plugins → Discover → Unofficial plugins · GitHub** after the catalog refreshes. Updates are installed from **Plugins → Installed → dao**.

To install a local checkout or an extracted release archive:

```sh
magpie plugin add /path/to/dao
```

Keep Magpie's Middleware feature enabled. Magpie manages the plugin runtime.

## Set up

1. Open the **dao** page in Magpie. Enter your QianDao Base URL and concurrency limit, then save. The manual model field is optional.
2. Open the **dao** provider and sign in with **dao API Key**.
3. In the **dao** provider editor, click **Fetch models** (or **Fetch models again**), select the models you want, and save.
4. Enable Fast with the model picker's lightning button. Codex does not need its own Fast control.

A bare origin receives the `/v1` suffix automatically. An explicit path prefix is preserved. The address is editable; new requests use the saved address while requests already in progress keep their original destination.

The default shared concurrency limit is **5**, across conversations, models, and accounts. Saving a new limit takes effect without restarting the plugin host. Lowering the limit lets existing requests finish and queues new ones until capacity is available.

The native **Fetch models** button reads QianDao's current `/v1/models` list using the saved API key. dao supplies candidates; your selections stay in Magpie's provider editor. Magpie may also request the list when signing in or starting its plugin host. dao does not poll for models. The provider ID remains `qiandao-gateway`.

You can still add models by hand in the settings page or provider editor. Refresh the list to load their Fast capabilities. Manually added names remain available even when absent from the upstream list. Clear the optional settings field if you want candidates to follow only the upstream list. Removing a settings model takes effect on the next refresh, unless it remains explicitly configured elsewhere. Existing saved settings are preserved during updates.

## Balance and availability

The provider account's usage information shows QianDao's balance, or its key/subscription allowance where applicable. It reads `/v1/usage` with the existing API key; no separate management token is required. The same information is available through `magpie quota qiandao-gateway --json`.

QianDao may close its gateway between availability periods. A failed or empty model-list response preserves the last successful list and existing selections. A failed balance query reports that it is unavailable; Magpie can retain the previous balance beside a read-error notice. That value is historical, not a fresh balance, and an unavailable query is never converted to zero or an expired login.

Model and balance queries each make one request with an eight-second timeout. Chat can still use configured models when these queries are unavailable. HTML closure pages are treated as temporary upstream failures under the normal bounded chat retry policy. After reopening, use **Fetch models again** to get the currently offered models; Magpie manages removal and restoration of previously selected upstream models.

## Request handling

The plugin buffers a complete upstream response before delivering it. Temporary failures can be retried without exposing discarded partial output or tool calls to the client.

| Policy | Default |
| --- | --- |
| Maximum upstream attempts | 7, including the first request |
| Rate-limit retry delays | 3, 6, 10, 20, 40, 60 seconds |
| Other transient-error delays | 0.75, 1.5, 3, 3, 3, 3 seconds |
| Admission window for new attempts | 300 seconds |
| Timeout for an attempt already in progress | 900 seconds |

A longer valid `Retry-After` takes precedence. Concurrency and cooldown state are shared, including during overlapping plugin-host generations. Queueing and backoff do not occupy an upstream execution slot. Client cancellation stops queued work, backoff, and the active upstream request.

Magpie calls belonging to the same client request share one attempt budget and final result. Repeated host calls do not start a fresh round of upstream retries. Calls without a middleware request marker make at most one upstream attempt.

Explicit terminal errors retain their meaning. A `response.failed` event with `context_length_exceeded` reaches the client so Codex can compact its context; authentication failures are not retried as temporary outages.

The plugin preserves the selected model, reasoning effort, cache-related fields, client identity headers, and the request's service tier. Enabling Fast in Magpie sends `service_tier: "priority"`, even when Codex supplies no tier. Retries keep that choice. An explicit rejection of Fast is not silently retried as Standard.

## Settings and storage

Magpie stores the API key. dao stores settings, scheduling metadata, manually added model IDs, and the last successful model list per account under `qiandao-gateway/` in Magpie's data directory. These files contain neither conversation bodies nor API keys. Model caches are scoped to the configured Base URL. The settings page shows active requests, queued requests, cooldown, and the current host's latest 20 results.

The plugin configures header forwarding and disables additional patience waiting and rate-limit rests for its own provider. Codex's default timeout and unrelated providers are left unchanged.

The settings page uses loopback port **38418**. It serves configuration only; model traffic goes directly from the provider plugin to QianDao. If the port is occupied, chat remains available with the saved settings; change `settingsPort` in the plugin options to restore the page. Unlike routine URL and concurrency edits, changing that plugin option reloads Magpie's shared plugin host.

## Development

Use Node.js 24 or later:

```sh
npm test
node tests/magpie-host.mjs /path/to/magpie /path/to/bun
npm pack
```

Pass a release archive as the final argument to test its contents:

```sh
node tests/magpie-host.mjs /path/to/magpie /path/to/bun dao-0.1.0-rc.4.tgz
```

For comparison with the original gateway:

```sh
git clone https://github.com/xinxinxiaoxin/qiandao.git docs/research/qiandao-source
npm run test:parity
```

You can also pass the original gateway file to `node tests/parity.mjs /path/to/gateway.mjs`.

Validation covers 25 core and contract tests, six old/new gateway comparisons, and an isolated Magpie 0.1.4823 host. Host checks include native model refresh and selection, balance queries, closures and reopening, manually added models, native Fast controls, request-field preservation, live settings changes, shared concurrency during host reload, terminal errors, bounded 429 recovery, and cancellation. Browser checks exercise the settings page inside Magpie's `allow-scripts` iframe: clicking Save writes the URL and concurrency, invalid values remain unsaved, Enter saves, and the provider successfully uses the saved URL.

For the browser regression, `node tests/settings-browser-fixture.mjs` serves the actual settings page in an `allow-scripts` iframe and writes its test URL and settings path to `.sandbox/settings-browser-session.json`. Open that URL with the Ego browser SDK and run the exported `checkSettingsSave(page, { settings, baseURL: "https://example.invalid" })` from `tests/settings-browser.mjs`. It checks the persisted file as well as the visible success message. Stop the fixture with Ctrl+C when finished.

Set `QIANDAO_UI_MODE=1` when running the isolated Magpie host test to exercise the complete embedded-page flow. Read `.sandbox/ui-session.json`, open its authenticated test URL, enter the **dao** page, and run `checkSettingsSave` using its `settings` and `upstreamURL` fields. Write `.sandbox/ui-done` after the browser check; the host test then verifies a request reaches that saved upstream.

Host tests use isolated configuration, fake credentials, and a local upstream. They shorten delays and use a three-attempt limit to detect retry multiplication; core tests verify the production defaults.

## Limitations

- Complete-response buffering delays visible output. A long response can hit the client's default idle timeout before the gateway's own budget ends.
- A client reconnect or a manually resent request receives a new budget, while still sharing the global plugin concurrency limit and cooldown.
- Magpie may still process a plugin's final error. dao bounds actual upstream sends; it cannot disable every host error-handling behavior.
- During a shared-host reload, Magpie allows the retiring host up to ten minutes to finish. Longer requests may be interrupted by the host.
- Live QianDao model-list and balance queries have been verified; live chat has not been tested. Requesting Priority does not guarantee the upstream grants that service tier or a cache hit.

## Related projects

- [Original QianDao gateway](https://github.com/xinxinxiaoxin/qiandao)
- [AG Relay for Magpie](https://github.com/xinxinxiaoxin/magpie-agentrouter-relay)
- [Magpie plugin development guide](https://usemagpie.ai/docs/plugins)

## License

[MIT](LICENSE). See [attribution](THIRD_PARTY_NOTICES.md) for related project credits.
