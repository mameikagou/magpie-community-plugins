# magpie-openmath-quota

Unofficial Magpie plugin for **native Open Math quota cards**. It shows actual weekly limits, spending, remaining-share/used-share switching, history, colors, and reset times—not a balance-card percentage approximation.

Each user supplies their own Team UUID and `nuc_oc_` Platform API key. This adds no models and changes no model routing.

## Install from GitHub

Install directly from this repository:

```sh
magpie plugin add github:sukuangllp/magpie-openmath-quota
magpie plugin login openmath-quota
```

Enter the Team UUID and Platform API key when prompted. Then use:

```sh
magpie quota refresh openmath-quota
```

The GitHub source travels with Magpie's WebDAV sync. It installs on the other computer; sign in there with your own credentials. Sign-ins stay on each computer unless you explicitly enable Magpie's sign-in sync.

### Find your values

- In Open Math, create a Platform API key from **Settings → API keys → Platform API**.
- Get your team UUID with `openmath-platform call account '{}'`, or from an existing team configuration. The UUID often begins with `o-`. It is not your key or a publicly shared default.

## Behavior

- Displays the weekly USD quota; the five-hour Platform window is intentionally omitted.
- Uses Magpie's native used/remaining controls and reset-time display, including minutes.
- Reads only `POST https://os.openmathmodel.org/v1/org_model_usage` with `{ "team": "<your-team-id>" }`.
- Separates the quota provider `openmath-quota` from your existing model provider.

## For maintainers

Requires Node.js 22 or later. No dependency installation is needed for tests.

```sh
npm test
```

The repository must contain neither keys nor real team UUIDs. Keep private endpoint overrides and local account metadata out of commits.

To include the backend's five-hour window for a private customization, `fromQuota` accepts `{ ignoreFiveHours: false }`; the exported default used by Magpie displays only weekly quota.

## Discovery

The **`magpie-plugin`** topic makes this public repository discoverable in Magpie's unreviewed GitHub plugins list. `package.json` includes `magpie.name`, `magpie.summary.en`, and `magpie.summary.zh`, a version, and an MIT license.

GitHub source releases are enough for Git-backed installation and synchronization. Official community inclusion additionally requires an npm publication and a pull request to `magpie-community/plugins`.

## License

MIT. Unofficial plugin; Open Math is not affiliated with or endorsing this repository.
