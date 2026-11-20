# magpie-jev-context

A magpie decision-provider plugin that wraps Jev and replaces its System One
prompt with a prompt template of your own. One provider can expose several
model suffixes, each with its own prompt, JavaScript scripts, data, and
timezone.

```text
jev-context/jev-latest
jev-context/jev-latest:repo
jev-context/jev-latest:release
```

The suffix is the profile. The request's model selects the profile, the
profile's scripts run, its prompt template is rendered, and the result goes to
the built-in Jev model you picked.

## Install

```sh
magpie plugin add github:4fuu/magpie-jev-context
magpie plugin login jev-context
```

Sign in with a TypeSafe API key. Then use a profile as a routing group's
classifier:

```sh
magpie group set <group> classifier=jev-context/jev-latest:repo effort=auto
```

`effort=auto` is optional. Without it, the plugin still handles intent
classification.

## Editor

Open `Plugins` → `Jev Context`, or right-click the Jev Context provider and
choose **Edit Jev context**.

The page is two levels. The editor holds the base-model selector
(`jev-latest` or `jev-preview`), the profile list keyed by suffix, the prompt
tabs (Default, Intent, Level, Effort) and the named JavaScript scripts.
**Preview** opens a dialog on top of the editor with a sample message, a Run
button and the final `state.context` plus the rendered `questions` exactly as
they will be sent; Close, Escape or clicking the scrim dismisses it.

`data` and `timezone` are not edited in the page; they stay in
`jev-context.json` (see below) and are still used by templates and scripts.

The page saves into the plugin's own options (`options.config`). Those settings
override `jev-context.json`; **Use config file** removes the override. Saving
restarts the plugin host.

magpie does not render `magpie.panels` provider panels in a plugin provider's
account editor, so this uses a page and a provider-row action rather than a
panel.

## Profiles

A profile is one model suffix:

```json
{
  "suffix": "repo",
  "time": true,
  "timezone": "Asia/Hong_Kong",
  "prompt": {
    "intent": "The message is a request to a coding assistant. Judge it with this repository state:\n{{repo}}",
    "effort": "How much reasoning does the message need? The repository state is:\n{{repo}}"
  },
  "scripts": [
    {
      "name": "repo",
      "js": "return await sh('git status --short --branch')"
    }
  ],
  "data": {
    "project": "demo"
  }
}
```

The empty suffix is the default profile. Suffixes are custom, but magpie's
reasoning-effort names (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
`max`) are refused because magpie would read them as an effort.

`prompt` can be a string (used for every question) or an object:

| Key | Used for |
| --- | --- |
| `default` | Every question without its own template |
| `intent` | The intent choice question |
| `level` | The level choice question |
| `effort` | The effort score question |

An empty or missing template keeps magpie's built-in instructions for that
question. A non-empty template replaces them.

## Template placeholders

```text
{{message}}
{{now}}
{{current_time}}
{{local_time}}
{{date}}
{{timezone}}
{{utc_offset}}
{{weekday}}
{{unix_time}}
{{data.project}}
{{scriptName}}
{{scripts.scriptName}}
{{question}}
```

`{{scriptName}}` is the result of that profile's script. `{{question}}` is
`intent`, `level`, or `effort` in the question being rendered.

The built-in names (`message`, `now`, `data`, `state`, `questions`, `context`,
`scripts`, `sh`, and the other time names) are reserved; a script cannot take
one of those names.

## Scripts

Scripts are JavaScript function bodies. They run once for the selected
profile before the prompt is rendered.

```js
return await sh("git status --short --branch");
```

The script scope has:

- `message`, `now`, `timezone`, `local_time`, `date`, `unix_time`, `weekday`;
- `data`, `state`, `questions`, `context`;
- `scripts` (results of scripts already run);
- `sh(command, options)` for a shell command;
- `fetch`.

A returned object or array is serialized as JSON. `null`/`undefined` become an
empty string. A failed script appears in `context.script_errors` and does not
fail the whole classification.

Shell commands are still accepted as a legacy form:

```json
{ "name": "legacy", "command": "git status --short" }
```

New profiles should use `js`.

## Configuration file

The plugin reads `jev-context.json` from magpie's config folder by default.
Set `JEV_CONTEXT_CONFIG` to use another path.

```json
{
  "upstream": "https://api.typesafe.ai/v1",
  "baseModel": "jev-latest",
  "timezone": "Asia/Hong_Kong",
  "profiles": [
    {
      "suffix": "",
      "time": true,
      "prompt": {
        "default": "The message is what a user asked a coding assistant. Which kind of request fits it best?"
      },
      "scripts": []
    },
    {
      "suffix": "repo",
      "time": true,
      "prompt": {
        "intent": "Judge this request with the repository state:\n{{repo}}"
      },
      "scripts": [
        { "name": "repo", "js": "return await sh('git status --short --branch')" }
      ]
    }
  ]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `upstream` | `https://api.typesafe.ai/v1` | TypeSafe base URL; `/systemone` is appended |
| `baseModel` | `jev-latest` | Jev model sent upstream |
| `timezone` | system zone | Default IANA zone for profiles |
| `profiles` | one default | Model-suffix profiles |
| `cwd` | magpie config folder | Default working directory for scripts |
| `env` | `{}` | Extra environment variables for scripts |
| `timeoutMs` | `7000` | Upstream timeout and default script timeout |
| `maxOutputBytes` | `4000` | Default script output limit |
| `controlFile` | `jev-context.control.json` | Per-machine overrides; `false` disables |
| `contextKey` | `context` | State field the context is written to |

`upstream` is read when the plugin host loads the account. Restart magpie
after changing it. Profile settings are read on every request.

## Per-call overrides

A direct `/v1/systemone` caller can add `state.jev_context`:

```json
{
  "now": "2026-11-21T06:00:00Z",
  "timezone": "Asia/Shanghai",
  "data": { "release": "2026.11.21" },
  "scripts": ["repo"],
  "prompt": "Replace the selected profile's prompt for this call",
  "prompt_append": "Appended after that prompt"
}
```

Precedence is config, control file, then `state.jev_context`. `replace: true`
drops the profile's data and scripts for the call.

## Preview service

The preview dialog first calls a local service on `127.0.0.1:3488` that runs
the selected profile's scripts with the same code as the plugin, so shell
(`sh`) scripts show real output. The dialog header reports which path answered
(`via service-css`, `via service-js` or `via local`).

magpie serves plugin pages in a sandboxed iframe whose CSP blocks network
fetches. When the service subresource cannot load (for example behind a remote
portal that re-authenticates subresources), the dialog falls back to running
pure-JavaScript scripts in the page itself (`via local`); `sh` scripts then
report that they run only in the plugin host. On a local magpie the service
path is used and shell scripts preview normally. If the service cannot start
at all, classification still works.

## Development

```sh
bun test
bun run check
```

## Limits

- Only requests that name one of the plugin's models go through it.
- A profile's `sh()` script runs on the plugin host with your user
  permissions. Only configure trusted commands.
- Data and script output are sent to the configured upstream. Do not put
  secrets in them unless that upstream may see them.
- `upstream` changes require a host restart; profile edits do not.
