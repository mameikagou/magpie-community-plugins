# magpie-plugin-codar

> **改这个插件前先读 [AGENTS.md](./AGENTS.md)** —— 尤其是「不要重启 magpie」那一条。

A [magpie](https://github.com/yetone/magpie) plugin for **Codar (科搭)**, the research desktop app by SpeedAI. It adds Codar's models to magpie as a provider, handles the daily check-in, and reports the account's points on the usage card.

## Features

- **Provider** — registers a `codar` provider with Codar's model list (15 models as the vendor lists them today: the `auto` router plus the DeepSeek, GLM, GPT and Claude families; the count is the vendor's, not a promise). The list is embedded in `lib/catalog.mjs` and refreshed from `GET /v1/codar/models` when signed in. Chat goes from magpie straight to Codar's gateway (`https://api.claw.speedai.com/v1`) — OpenAI-compatible for most models, Anthropic Messages for the Claude ones.
- **Sign-in** — three methods: “科搭令牌（留空读本机）” (one optional token field: leave it empty and the plugin reads the desktop app's own token file itself — read-only, never written — or paste a Codar access token and that is the one used; either way the token is checked for an account name and an unexpired exp before saving), “科搭OAuth登录” (one page the plugin serves on `127.0.0.1`, with the two ways in the vendor's own login dialog offers as tabs: 扫码登录, where the plugin draws the code the vendor issued and polls its own status endpoint every two to three seconds, and 手机号登录, where you enter the phone number, solve the vendor's own Aliyun captcha and type the SMS code; every vendor call is made by the plugin, and the page never sees the token), and signing in with the Codar account's own name and password (`POST /v1/login` on `api.kuaipaper.com`; the password is sent once and kept nowhere; it sits after the page because the vendor's IP check commonly hands it on there). A sign-in is kept with the token's own expiry when the token states one (a token that states none is kept as `expires: 0`, not invented one), and magpie renews it through `POST /v1/token/refresh` before it runs out; a token that has already expired cannot be renewed (the vendor refuses it with 401) and asks to sign in again. The vendor refuses to send an SMS code without a solved captcha (measured: `{"code":400,"message":"请完成人机验证"}`), which is why the SMS tab is a page rather than a prompt. When a password sign-in comes back `code 201` / `ip_verify_required` — the vendor's IP risk check — the plugin remembers the temp token it was handed for ten minutes at most — one handover finishes at most one check, and any other sign-in attempt clears it — and “科搭OAuth登录” then opens straight on that check instead of the tabs, finishing it through `POST /v1/user/verify_ip` (code type `ip_verify`), so the account is not asked for its password a second time.
- **Daily check-in** — `POST /v1/daily-sign`, once per rolling 24 hours. The answer reports the claim (including the points it added) or that the day was already claimed. It carries `until` (magpie ≥ 0.1.1795) whenever a wait is known — always on an already-claimed answer, and on a claim when the vendor states the next window — so magpie re-asks exactly when the next claim opens.
- **Usage** — points (general + agent), today's check-in state, and any free-model activity still running. The agent pool is the one model calls spend, so it is stated as the share magpie's router ranks (`额度 · Agent 余额`): `used: 0, limit: <agent_balance>` while it holds something, and `used: 1, limit: 1` with a `resetsAt` 30 minutes ahead (magpie's `creditRest`, a ceiling — the next poll reads a refilled balance and the window is back to 0% long before it) once it is empty. The reset is not decoration: magpie marks a pool spent only when `used ≥ 98` **and** the reset is in the future, so a zero balance without one would route as though the pool were full. A spent pool ranks the account last; it is not a `停用 ·` row. The points pool is a different pot (measured: `agent_balance` 1974 beside points 0, models working), so it is `说明 · 点数余额` with `aside: true` — said, never routed, since any share there would have a working account called spent the moment the points ran out. The top line follows the agent figure: `Agent 1974 点 可用` when it has something left, `Agent 余额 0 点` without 可用 when it does not. When one balance endpoint fails the card still shows what the other answered; when both fail it is a `说明 · 额度不可读` row (with the reason), never a top-level error — that would replace the whole window area.

## The tool table, and the rename that makes it usable

Codar's turn carries 44 tool definitions — the ones the desktop client posts with every request. They live here as `lib/tools/definitions.generated.mjs`, generated from the client's captured `chat-completions.tools.json` by `scripts/gen-tool-catalog.mjs` (`npm run tools:catalog`; `npm run tools:check` says whether the file is stale, and exit 1 means stale). They are copied, not retyped: the vendor compares the shape it receives, so `test/tools.test.mjs` pins the serialised array to a sha256 taken from the capture.

**Those 44 are the only tools that may reach the vendor.** Measured 2026-11-21 on a real account, varying only the body's `tools`:

| body | answer |
| --- | --- |
| client prefix + the 44, as captured | `200` |
| client prefix + one tool the host declared | `403 client_not_supported` |
| no prefix + the 44 | `403 client_not_supported` |
| client prefix + only `read_file` | `403 client_not_supported` |

So the direct transport replaces whatever the caller declared with the client's 44 (`lib/tool-rename.mjs`, request side). The caller's own names are not lost — they are read before the replacement and are the vocabulary the answer is translated into.

**The plugin executes nothing.** The model's `tool_calls` come back as the client's names (`read_file`, `exec`, `list_dir`…), and the host that called this plugin can only run the tools it declared itself (`read`, `pwsh`, `glob`…). So each call is renamed to the host's own name before the host sees it, and the host runs it: `read_file` → `read`, `exec` → `pwsh`, `list_dir` → `glob`, and so on for the nine in `lib/tool-map.mjs`. The original is kept beside it in `function.__codarName`, and a `tool_call_id` → codar-name ledger covers a host that rebuilds the message from the fields it knows. A streamed answer is wrapped, never read: the rename touches only the `data:` lines that carry a `tool_calls` fragment, and a stream with no calls is the vendor's own bytes in the vendor's own chunks.

**The second turn is put back.** The host answers a call by sending `[assistant(tool_calls=[{id, function:{name:"read"}}]), tool(tool_call_id, content)]`. The vendor pairs a tool result with the call that asked for it, and a call named `read` is a call to a tool the client never offered — so the names are restored to the codar ones before the request goes out, leaving `[assistant(tool_calls=read_file), tool(…)…]`, self-consistent again.

A call to one of the 35 that has no host name (`literature_get_paper`, `image_gen`, the marketplace tools) keeps its codar name: the host refuses a tool it never declared, and that refusal names what the model asked for — which is the honest failure, and better than inventing a tool. `node scripts/acceptance-tools.mjs` is the acceptance run in its own process: one round with a host-shaped table, printing the status, the header list, the tool count that left, and the calls' names before and after the rename; a second round only when the first answer actually called a tool.

Nine of the 44 also have a local implementation, written from the captured behaviour rather than from the client's (private) source. A turn does not go through them — they are reached only by a caller that asks for them — but they document what the tool does and they are what the captured formats above were measured against:

| tool | what it does |
| --- | --- |
| `read_file` | numbered lines (`N\tline`), a first line saying which lines of how many, `offset`/`limit`, the client's 2000-line and 50 KB ceilings |
| `write_file` | writes, creating parent directories, and reports the byte count |
| `edit_file` | `old_text`/`new_text` (or `old_string`/`new_string`), all-or-nothing; a miss reports 没有找到 plus the nearest line |
| `list_dir` | the captured format: `📁 name (0 bytes)` for a directory, three spaces then `name (N bytes)` for a file, ordered by name |
| `apply_patch` | the `*** Begin Patch` envelope (Add / Update / Delete / Move to); validated whole before anything is written |
| `now` | `现在是 YYYY-MM-DD HH:mm:ss（CST，UTC+08:00），星期X。` |
| `exec` | `pwsh -NoProfile -NonInteractive -Command`; `stdout:` / `stderr:` / `exit code:`; a timeout kills the process tree |
| `web_fetch` | a plain HTTP GET, HTML reduced to text, long pages saved under `tool-outputs/` |
| `web_search` | says 本环境未配置搜索后端 — this plugin has no researcher endpoint, and inventing results would be worse |

The other 35 need the client (marketplace, literature library, document converters, `img2pptx`, `understand_image`, `ask_user`, the background-task tools). `runTool` answers `<name>：本环境未实现（需要科搭客户端）` with `is_error:false`, because an errored call is one a model retries until the turn is spent. `exec` with `background:true` answers 后台任务暂不支持 for the same reason: this cut has no task supervisor.

Paths resolve against the turn's `workspace`, and any `..` is refused — the client's own rule. The `codar.transport: "serve"` road still bridges to `codar.exe serve` and does not rename anything: the app's server is the one that runs the tools there.

## Install

```bash
magpie plugin add magpie-plugin-codar                  # from npm
# magpie plugin add github:MisonL/magpie-plugin-codar  # or from GitHub
# magpie plugin add "$PWD"                             # or from a checkout
magpie plugin login codar      # press Enter to read this machine's Codar login, or paste a token
```

If `magpie` is not on your `PATH`, use the app's own binary — for example
`/Applications/magpie.app/Contents/MacOS/magpie` on macOS — with the same
arguments. The plugin row also installs from magpie's Discover page (插件 →
发现), which is the same npm package.

Then select a `codar` model in magpie, and turn on its check-in under
Settings (设置) → 额度 (Quota) → 预热与签到 (warm-up & check-in) → 插件 (Plugins).

## Signing in

Codar keeps its JWT in its own config file:

- macOS / Linux: `~/.codar/config.json`
- Windows: `%USERPROFILE%\.codar\config.json`
- `$CODAR_HOME/config.json` when `CODAR_HOME` is set (the app honours it, and so does this plugin)

The value is `provider.speedai.token`. The “科搭令牌（留空读本机）” method reads it for you when its field is left empty — read-only, never written — and checks it has an account name and has not expired before saving it; a token pasted into that same field gets the same checks. To copy the value to your clipboard yourself instead:

```bash
# macOS / Linux — honours CODAR_HOME the way the app does. The config is read
# as utf-8-sig: a file Codar wrote on Windows carries a BOM, and plain UTF-8
# makes JSON refuse the whole file (the same reason the plugin strips one).
python3 -c 'import json,os,sys,subprocess;h=os.environ.get("CODAR_HOME") or os.path.expanduser("~/.codar");t=json.load(open(os.path.join(h,"config.json"), encoding="utf-8-sig"))["provider"]["speedai"]["token"];subprocess.run(["pbcopy"] if sys.platform=="darwin" else ["xclip","-selection","clipboard"],input=t,text=True)'
```

```powershell
# Windows - honours CODAR_HOME the way the app does
$p = if ($env:CODAR_HOME) { Join-Path $env:CODAR_HOME "config.json" } else { "$env:USERPROFILE\.codar\config.json" }
(Get-Content $p | ConvertFrom-Json).provider.speedai.token | Set-Clipboard
```

(The first command puts the token on the clipboard; `pbcopy` on macOS, `xclip` on Linux. Linux needs `xclip` installed and a display — on a headless box there is no clipboard to fill, so read the same value another way. If your `python3` lacks `subprocess.run` with `input`, pipe the `print(...)` output into your clipboard tool instead — the point is to avoid the token scrolling through your shell's history or visible output.)

The token carries the account name and an expiry (7 days after the app's last login). When it runs out the plugin says so instead of calling the API — open Codar once to refresh it there, then sign in again.

### Where the password goes

The account's name and password are sent in one request, `POST /v1/login {username, password}` on `api.kuaipaper.com` — the same endpoint the vendor's own client signs in through — and nowhere else. The password is not written to disk, to magpie's saved account, to the plugin's memory after that call, or to a log line: what comes back from it is the token, and the token is what is kept. If the vendor stops that sign-in with its IP check (`code 201`), the plugin keeps the temp token the refusal carried for at most ten minutes so the SMS method can finish the check without asking for the password again; that temp token, like the account's own, is held in memory only. A message about a failed sign-in is scrubbed of both the account and the password before it is shown.

## Notes

- **An installed plugin is not a listed provider until it is signed in.** `magpie plugin list` (and Plugins → Installed) shows this plugin and its models as soon as it loads, and `magpie plugin list --json` shows the `codar` provider record it registers. `magpie providers` only lists providers that can actually serve a request, so `codar` appears there after a successful sign-in, not before. If a sign-in was removed from magpie earlier, the next successful sign-in brings the provider back on its own (magpie clears the “removed” mark on sign-in); there is nothing to edit by hand.
- **Prices stay as magpie sets them.** Codar lists prices in CNY and magpie's cost column is USD, so the plugin reports no price of its own rather than inventing an exchange rate. magpie still prices models by what models.dev says their makers charge, and a per-model price you set in magpie overrides everything. What each model does carry is the vendor's own credit multiple (`rate_badge`, e.g. `0.20x`), shown by magpie beside the model; a model the vendor does not badge carries none.
- **Reasoning levels are not mapped to variants.** The vendor's `reasoning.levels` describe request-body rewrites (`set`/`omit`) the desktop app applies itself; magpie's variants only name levels, so the models carry `reasoning: true` and no variants.
- **Free-model activities are reported, and the one-time campaign is claimed.** The card shows the activities still running; beside the check-in, the plugin also claims the vendor's one-time free-model campaign (`GET`/`POST /api/codar/activities/free-model[/claim]` on the gateway) when its status is `available`, and says so in the check-in line. It is best-effort: a campaign already claimed, none open, or a refused call changes nothing about the check-in. It rides on the check-in, so it only happens for an account whose check-in is switched on in magpie.
- **The vendor fields read here are measured shapes, not a published schema.** `user_quota_limit` (an activity's total), `remaining_quota` (a null means unlimited; an unreadable value hides the activity instead of being drawn as unlimited), `free_until`, `isSigned`/`signed`/`hasSigned` and `retry_after` (check-in and status) are the spellings the app's answers have carried. If the vendor renames one, the card drops that row or field rather than inventing a value.
- **Concurrency is a queue of 3 per account** (measured 2026-10-27: a fourth request at once answered 429 `concurrent_limit_exceeded`; the vendor publishes no figure). magpie queues past it, and the provider setting can raise the queue — but the vendor's own limit is per model, so raising it trades queueing for 429s and magpie's retries. If the catalog ever states `max_concurrency`, the plugin records the smallest figure it names and magpie queues by it on the next request (it reads the figure when it builds the provider info, which is after the models hook); `package.json` states the measured 3 as the figure a fresh start begins with.
- **The check-in is a text row, not a percentage** — a check-in is not an allowance that runs out. A wait it cannot use (missing, zero, past year 9999, or over a week) falls back to a 30-minute trust floor, so a rolling 24-hour window cannot lose the next claim.
- **Fallback list.** If `GET /v1/codar/models` cannot be reached, the plugin hands back the model table magpie gave it, marked as the fallback, so magpie keeps the list it had and says it fell back; the embedded `lib/catalog.mjs` is what the provider starts from, and its sizes may trail the live list — the live list wins whenever it can be fetched. A model's reply ceiling is the vendor's own (`max_tokens.maximum` → `limit.output`), so magpie lowers over-asking requests instead of letting the vendor refuse them.
- Models you add to this provider yourself survive list refreshes; the vendor's entries follow the vendor. A provider name or `api` you set in magpie survives restarts.
- The plugin follows the vendor client's own reading rules (field spellings, body codes, the “already claimed” wording in both Chinese and English), omits times it cannot write down rather than guessing, and never prints credentials — every vendor string is cut where it echoes the token (folded, split, spelled in fullwidth, base64 or hex) or a credential shape, and an oversized vendor answer is refused while it is read, counted over the decoded body (a gzip answer is read like any other: every transport used here hands back decoded bytes).
- **The card's requests go out through the desktop's own transport when it can.** The catalog, check-in, account and activity requests are made by a small Go proxy (`native/cmd/codar-proxy`) that rebuilds the Codar desktop sidecar's provider client from the 0.3.13 binaries: the sidecar's `http.DefaultTransport.Clone()` — TLS left to net/http — with its last-known-address `DialContext`, and its direct connection to the gateway with `HTTP(S)_PROXY` ignored — built with Go 1.24.3 where the macOS and Linux sidecars are, and with Go 1.26.7 over a go 1.24 module where the Windows one is, which reproduces that sidecar's own `DefaultGODEBUG` (`tlssecpmlkem=0` among them) — so the TLS ClientHello and HTTP headers are the sidecar's rather than Bun's. The plugin talks to the proxy over a private socket in the temp directory; the proxy forwards only the four hosts the desktop's own cloud-network controller accepts, and sends only the headers the plugin listed — `Authorization` and `Content-Type` for a card request, plus `X-Api-Key` and `Anthropic-Version` for a chat one — while Host, `User-Agent` (`Go-http-client/1.1`), `Accept-Encoding` and everything else are Go's, as on the sidecar's requests. The binaries are built per platform by `node scripts/build-native.mjs` and ship as per-platform packages (see [The native proxy binaries](#the-native-proxy-binaries)). Without a binary for the platform, or if it cannot start, those requests fall back to the plugin's ordinary fetch — the old fingerprint — and nothing pretends otherwise. How the shipped binaries are made, and what a review of them can check, is in [The native proxy binaries](#the-native-proxy-binaries) below.
- **Chat goes straight to the gateway, because the 403 turned out to be about the system prompt's head.** A direct call used to be refused for every client that is not the app — `403 {"code":"client_not_supported","message":"This login credential is restricted to Codar."}` (measured 2026-11-21, with the account's own token and the app's own request shape) — and that was read as "is this the app's process". It is not. Measured by varying only the system message: its first segment (49 characters) is refused with `client_not_supported`, its first four (~1.6 KB) are answered, and so is the whole 33,577-character prompt; tools are optional (33 KB of system, no tools, one short message answers). Reproduced on a third account on this machine: one segment → `403 client_not_supported`, four → past the check. So the loader's `fetch` is now the vendor's own request (`lib/direct.mjs`): the client's seven body keys in the client's order with `reasoning_effort: "high"`, `thinking: {"type":"enabled"}` and `stream_options` on a streamed request (`lib/client-body.mjs`), the client's 44 tools in place of the caller's own (`lib/tool-rename.mjs`), every other message untouched, the client's six headers with `Go-http-client/1.1`, and the client's first four prompt segments in front of the caller's own system prompt (`lib/client-prefix.mjs`, generated from the capture by `scripts/gen-client-prefix.mjs`, pinned by its sha256). Nothing is dropped from the caller's prompt. No desktop app has to be installed, no 19 KB app prompt is paid on every session, and the answer arrives as the vendor's own Server-Sent Events, handed to the host exactly as fetch produced it — never cloned or read. `node scripts/acceptance-direct.mjs` is the acceptance run in its own process (one non-streaming and one streaming request, printing status, content, the body's top-level key order and the system message's opening). The old road is still there and is chosen by `codar.transport: "serve"`: the loader's `fetch` is a bridge to that server on `127.0.0.1:8080`: magpie's `messages` are flattened to the one `{"message": "…"}` string the server accepts (`lib/chat-bridge.mjs`: system text first, then `用户：`/`助手：` turns, the last user turn as the request itself, and tool results as `工具结果（<name>）：…`), the server's Server-Sent Events are read as they arrive (`lib/serve.mjs`), and an OpenAI client gets `chat.completion.chunk` lines while a `stream:false` client gets one `chat.completion`. The server is joined when it is running and started (`codar serve`, detached, with `CODAR_HOME`) when it is not, waiting at most 20 seconds. `CODAR_BIN` names the app's binary when it is installed somewhere other than the vendor's default, and `CODAR_SERVE_PORT` names another port. A run the server reports as failed arrives as an error on the closing chunk, and an absent server as a `502` with a sentence — never as a stream that stays open over a conversation that is already over. The card's own requests (points, check-in, activities) are unaffected: they are the account's pages, not the chat credential's, and they still leave directly through the Go proxy described above.
- **That same chat leaves on the desktop's own TLS stack, and says which one.** The request is the client's down to its headers and tools; the ClientHello was not (measured 2026-11-21: Node's fetch presents a different JA3 than curl's, and the desktop's Go client neither). The loader's direct transport is handed lib/native.mjs's chatFetch, so a conversation goes out of the same Go proxy the card's requests use (see above), and the answer carries x-magpie-codar-transport: go-proxy. A machine with no proxy build — or a proxy that did not start — is the plugin's ordinary fetch, and the answer says : node instead: chat is never failed for the transport's sake, and the header is written on the response only, never sent upstream (the capture has no custom header in it). The transport also carries the request's own stream choice, so a non-streamed chat comes back as the one JSON document it is. node scripts/acceptance-transport.mjs is the acceptance run in its own process: the proxy's address, the catalog through it, one chat through the loader, and the header each answered with.
- **On the serve road, one caller conversation is one codar session, and only what was added travels.** The server's body takes a `session_id`, and without one every request lands in its fixed `web-ui` session. The session is now the caller's own conversation: `host.js` puts `x-magpie-session` on the request the plugin's fetch receives (MAGPIE_ONLY, "for the plugin to read, never for its vendor"), and a request that arrives without it falls back to the head of the conversation — the system prompt and the first user turn, both fixed for the life of a thread. The id is derived, not random: `mw-` + the first 12 hex of `sha256(<key>:<generation>)` (`lib/session-map.mjs`), so a restarted magpie lands a conversation back in the session the server still holds instead of paying the app's 19 KB system prompt again. Measured on this machine (2026-11-21, `~/.codar/sessions/<id>/usage.log`): three requests into one session answered `cache=0`, `cache=18944` of `prompt=19527`, `cache=19456` of `prompt=19983`; the same three with a fresh session each answered `cache=0/0/0`. After the first turn only the messages the caller added are sent, rendered by the same `messagesToPrompt` so the `用户：`/`助手：` roles do not shift; the ledger keeps how many messages that session has been told and a hash of exactly those. A history that no longer starts with that prefix — a compaction, an edited turn, a shorter one — moves the conversation to its next generation (a new session) and sends everything again, and so does a conversation left idle for 30 minutes. The session is read back off the events: a reply naming another session is a `SESSION_MISMATCH` error with both ids, because both wrong spellings of the field are accepted with `200`. A session that still has an unfinished run is interrupted first (`GET /api/chat/runs` + `POST /api/chat/interrupt`, only for this bridge's own runs), an interrupt that does not take effect moves to the next generation's session rather than waiting, and an `error` event inside a stream is retried once on that next session before the person is told `已自动切新会话重试`. `codar.maxPromptChars` still lowers the message ceiling (default 200 000 characters; a longer conversation is cut in the middle and marked `……（中间已截断）……`, keeping the system prompt at the front and the last user turn at the back). The old `codar.session: "reuse"` option is gone: every conversation already keeps its own session, and "one session for everything" was the incident.
- **The model list comes from the app's server too.** The vendor's catalog route is refused for the same reason chat was, so the plugin reads the account's model from `GET /api/desktop/settings` (`provider.speedai.model`) and falls back to `GET /api/health`, laying it over the embedded `lib/catalog.mjs` — the vendor's own last catalog, kept by `node scripts/catalog.mjs`. A model the server names that the catalog does not carry is listed beside the others; a server that does not answer leaves the catalog exactly as it was, and a silent port over a lapsed sign-in does not empty the picker.
- **The client-shaped body and the prefix are the request now; the 33 KB composer is kept for reference.** `lib/client-body.mjs` (the desktop's request-body key order) and `lib/client-prefix.mjs` (its first four prompt segments, `lib/client-prefix-data.mjs` being the generated bytes) are what the direct transport sends. `lib/client-system.mjs` — the older composer that rebuilt the whole 33 KB prompt from the capture, rewriting the session's own path and dropping the sections that prescribe the desktop's tools — is imported by nothing and stays in the tree as documentation of what that prompt contains. `lib/chat-bridge.mjs` (the one `{"message": "…"}` the app's server takes) and `lib/serve.mjs` stay for the `codar.transport: "serve"` road: they are what a person falls back to when a direct request is refused on their machine, and they are how the two roads were compared.
- **A vendor-side account restriction is not a sign-in problem.** Chat can answer `403 {"detail":{"code":"account_restricted"}}` while the card is healthy: the card reads the account endpoints (points, check-in), which need no chat access. That refusal is the vendor restricting the account, so the plugin says `account_restricted` and points at Codar support instead of asking you to sign in again. A `429` with `Retry-After` is passed through with the wait the vendor named.

## Development

```bash
node --test                       # the whole suite (installs packages from a
                                  # registry served on 127.0.0.1; no vendor calls)
bun test                          # the runtime magpie actually loads plugins on
node scripts/catalog.mjs --check  # is lib/catalog.mjs still what the vendor says?
node scripts/catalog.mjs          # regenerate it from the signed-in app
node scripts/build-native.mjs     # rebuild native/bin (this machine's OS; needs Go)
node scripts/build-native.mjs --all  # ...every platform, for a release
node scripts/native-packages.mjs  # stage the platform packages (native/packages)
(cd native && go test ./...)      # the proxy's own tests
```

The proxy needs a Go toolchain to build (`scripts/build-native.mjs` fetches the 1.24.3 and 1.26.7 toolchains through `GOTOOLCHAIN`), but nothing in the suite invokes that toolchain: it runs a real built proxy in two places — one test kills the host of the checkout's own build, and the install check below starts the proxy a package manager installed from the platform packages — and everywhere else `test/native.test.mjs` drives the client against a socket of its own, `native/cmd/codar-proxy/main_test.go` pins what the proxy sends and how it decides, and the tests that need a running proxy start a scripted stand-in through `CODAR_PROXY_BIN` instead (it speaks unix sockets only, and skips where that does not exist). On Windows the proxy itself listens on loopback TCP rather than a unix socket. The built binaries are not committed (`.gitignore` keeps `native/bin` out), so a checkout without a build simply uses fetch.

`lib/catalog.mjs` is generated with the plugin's own reader (`catalogOf`), so the fallback and the live list are built by the same rules. Its exit codes keep failures apart: `0` the run succeeded (`--check`: nothing moved), `1` a record moved (`--check` only), `2` the run could not finish — the vendor's answer was a refusal or its shape had moved (no list, a record with no context window), the local file could not be read or written, or an argument was not one it knows (only `--check` is). A failed run writes nothing and never empties the fallback. It needs a signed-in app, so it is a local command, not a CI step.

The suite also pins the formatting in `.editorconfig` (LF, one final newline, no trailing whitespace, two-space indent) — `test/style.test.mjs` walks the tree for `.mjs` and `.md` files (dot-directories such as `.git` are skipped; `.github` is scanned), so a new one of those is covered the moment it lands. `CONTRIBUTING.md` has the invariants the tests defend.

CI runs the suite on Node 20–24, on Bun across Linux / macOS / Windows, and on Node on Windows and macOS — the plugin reads a file under the home directory, and that is where per-platform differences show up. A separate job tests the Go proxy on Linux with Go 1.24.3 and then cross-builds all five targets, checking each finished binary's `DefaultGODEBUG` against the platform sidecar's; the proxy's behaviour is the same code on every platform, so it is tested once rather than five times. A separate job packs the npm tarball and runs the suite inside it on both runtimes (`node scripts/tarball.mjs --require-bun`), because `files` decides what ships and a test that references something outside it only fails for users; it also installs the packed main package against the platform packages staged from the same builds with both bun and npm, and requires each install to land that machine's package and the plugin to start it — on Linux, so linux-x64 is the package that install path is proven for. The Windows job runs the same gate without `--require-bun` or `--require-builds`, where its Windows-only branches are exercised, but it has no builds to stage, so the gate says the install check was skipped there rather than checked: the Windows install path is not checked by CI. It is checked by hand (0.3.0 installs `win32-x64` under bun and npm on Windows 10 x64 and the proxy starts); the test itself leaves Windows out because npm's `.cmd` shims broke it there ("Child returned status 128").

### The native proxy binaries

Each platform's build ships in its own npm package, and the main package names
all five in `optionalDependencies`:

| package | os | cpu |
| --- | --- | --- |
| `magpie-plugin-codar-darwin-arm64` | `darwin` | `arm64` |
| `magpie-plugin-codar-darwin-x64` | `darwin` | `x64` |
| `magpie-plugin-codar-linux-arm64` | `linux` | `arm64` |
| `magpie-plugin-codar-linux-x64` | `linux` | `x64` |
| `magpie-plugin-codar-win32-x64` | `win32` | `x64` |

The proxy lives in a private (0700) directory under the temp root, made for it
by the plugin and holding its socket and ready file. The plugin removes that
directory when the proxy exits, and so does the proxy itself on its way out —
so a plugin process killed outright, whose own cleanup never runs, still
leaves nothing behind once the proxy it started sees its stdin close.

A package manager installs the one whose `os`/`cpu` match the machine and skips
the other four, so an install is one 5.8–6.6 MB build (2.4–2.8 MB of tarball,
plus the main package's 0.33 MB) instead of all five: 32.0 MB unpacked became
about 7 MB on disk and a 13.3 MB download became about 3 MB. The `cpu` field is
npm's spelling — `x64`, never Go's `amd64`, which npm refuses outright with
`EBADPLATFORM` — while the binary inside keeps the Go-flavoured file name
(`codar-proxy-darwin-amd64`), which is the name the plugin looks for.

The plugin finds the build by resolving the platform package it was given
(`lib/native.mjs`, `binaryPath`), not by computing a path from `process.arch`:
what landed was the package manager's decision, and on Apple Silicon an x64
runtime under Rosetta reports `x64` and needs the x64 build. A working tree
without those packages falls back to `native/bin`, and an install with no
platform package at all (an `npm install --omit=optional`, say) falls back to
the plugin's ordinary fetch — the old fingerprint, see [Notes](#notes).

Nothing runs at install time: there is no postinstall script. That is deliberate
— Bun blocks postinstall scripts of packages it does not trust (measured on Bun
1.4.4), so a package that placed its build in an install script would silently
have no proxy on the runtime magpie actually uses.

Where the builds come from:

- **Built locally, not in a release workflow.** `npm run native:all` (the first release step in `CONTRIBUTING.md`) builds every target on the machine running the release, with `CGO_ENABLED=0`, `GOOS`/`GOARCH` per target, and `GOTOOLCHAIN=go1.24.3` (darwin, linux) or `GOTOOLCHAIN=go1.26.7` (win32) — the exact toolchains the Codar 0.3.13 desktop sidecars use — with `-trimpath` and `-buildvcs=false`. `npm version` does not run it, and `prepublishOnly` does not build; it only refuses to publish when a build is missing (`build-native.mjs --check --strict`).
- **The binaries in the published platform packages are not byte-reproducible from the tag.** `native/bin` is not committed, so a fresh checkout of `vX.Y.Z` has no binaries, and a rebuild from the same tag gives a different file and checksum than the one that shipped. What a tag *does* fix is the source and the inputs: `native/go.mod`, `native/cmd/codar-proxy/`, and the toolchain, `GOOS`/`GOARCH`, `GOEXPERIMENT` and flags in `scripts/build-native.mjs`. The binaries that ship are the ones built from that source on the releasing machine. Since 0.2.4 each one carries no VCS stamp (`-buildvcs=false`) and no build path (`-trimpath`), so `go version -m` reports the module as `(devel)` rather than naming a commit — a stamp read from the checkout the build ran in named the wrong commit on the 0.2.0–0.2.3 builds.
- **What can be checked, and what CI checks.** Anyone can rebuild with `go run`/`npm run native:all` and run `go vet ./... && go test ./...` in `native/`, where the proxy's tests pin what it sends and how it decides (the forwarded hosts and headers, the proxy decision, the last-address dialer). Every release also ships the source in the package, so the code the binary was built from is readable side by side. CI's `native` job builds all five targets from the same source with the same toolchains and refuses a binary whose `DefaultGODEBUG` differs from its platform sidecar's; it uploads the result only for the `tarball` job to test — the binaries in CI are not the ones published, and the publish gate checks names and shapes, not bytes. The gate also installs the packed main package into a scratch project through a registry served from a local directory, and requires that install to land exactly this machine's platform package and that the plugin starts it: a bare unpack cannot show that, and the release that shipped five builds in one package shipped for two minor versions because nothing checked the install path.

What the proxy does, briefly: it listens on a private socket in the temp directory (loopback TCP on Windows) and forwards only the four vendor hosts the desktop's cloud-network controller accepts, with only the headers the plugin lists. It holds no credential of its own — the token is passed in per request — and it writes one file, the ready file in its own temp directory that tells the plugin where it is listening and, on Windows, the per-run header token that proves a request came from the plugin (mode 0600); it writes nothing else.

Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); [CHANGELOG.md](CHANGELOG.md) records every release, and the release process is described in `CONTRIBUTING.md`.

## Licence

MIT.
