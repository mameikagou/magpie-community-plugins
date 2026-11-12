# Tabbit for magpie

[Tabbit](https://web.tabbit.com) as a provider in [magpie](https://usemagpie.ai)
(and OpenCode). It signs in with the Tabbit account already on this
computer, lists the account's real model catalog, and answers turns through
Tabbit's own chat API — so an agent behind magpie can pick `tabbit/Default`,
`tabbit/DeepSeek-V4.1-Flash`, `tabbit/GLM-5.3-Flash` and the rest like any
other provider, with the account's allowance, fallbacks and usage card.

## Install

```sh
magpie plugin add @magpie-community/opencode-tabbit-auth   # from the community list
# from this source tree instead:   magpie plugin add .
magpie plugin login tabbit                                 # pick “Read the Tabbit app's sign-in (macOS)”
magpie provider test tabbit                                # ✓ chat · Default
```

Then pick `tabbit/<model>` in any agent's model row on magpie's Agents page —
or route to it from a group:

```sh
magpie group add tabbit-pool models=tabbit/Default,tabbit/DeepSeek-V4.1-Flash routing=cheap
```

**每日自动签到**：装好并登录后，magpie → 设置 →「窗口重置时预热 / 每日自动签到」→
标签条最右的 **插件** → 「Tabbit · 每日自动签到」打开开关（还有「立即签到」按钮）。
Tabbit 的签到就是桌面宠物那个活动，结果会画在用量卡片上。

**OpenCode**：`opencode.json` 里加 `{ "plugin": ["@magpie-community/opencode-tabbit-auth"] }`，
再 `opencode auth login`。

**Provider id:** `tabbit`

This is not Tabbit's official API. It uses the endpoints Tabbit's own web app
calls, with the sign-in that app keeps, for one person on their own machine.

## Sign-in

Tabbit's sign-in is a `token` cookie: an RS256 JWT issued by
`web.tab-browser.com` with a **7-day** life. Two ways in:

| Method | What it does |
|---|---|
| **Read the Tabbit app's sign-in** (macOS) | Finds the cookie store Tabbit keeps, reads the `token` cookie, and decrypts it with the password in the login keychain. The international build (Tabbit.app) keeps its store in `~/Library/Application Support/Tabbit` and the password under `Tabbit Safe Storage`; the China build (Tabbit Browser.app) in `~/Library/Application Support/Tabbit Browser`, under `Tabbit Browser Safe Storage`. Each store is read with its own build's item first, then the other's. macOS asks once for Keychain access: click Allow (or Always Allow). Nothing is copied by hand; the browser does not have to be closed — the database is copied before it is read. |
| **Paste Tabbit token** | For anything the first method can't reach (Windows or Linux, a browser profile kept somewhere else). In Tabbit Browser, open `web.tabbit.com` (or `web.tabbit.ai` for an international account) and read the `token` cookie from the developer tools; paste it whole. |

A pasted value may be the bare JWT or a whole `name=value; name=value` cookie
string. The account id is read out of the token itself, so nothing else has to
be pasted.

**Two sites.** Tabbit runs `web.tabbit.com` and, for international accounts,
`web.tabbit.ai`: the same API, but a token from one is refused on the other
(#833). Nothing is set by hand. The desktop method records the site whose
cookie it found. A pasted token goes to `web.tabbit.com` first; when that
refuses it, `web.tabbit.ai` is asked once, and the site that accepts it serves
that token from then on (a token both refuse is an expired sign-in, as
before). A `web.tabbit.com` token never asks `web.tabbit.ai` anything.

> **International site, chat turns:** `web.tabbit.ai` answers a turn's
> `runs` call with `429`, code `492` ("Welcome to Tabbit Browser...") unless
> the request carries a `unique-uuid` header — the browser sends a fresh
> one on every API call (a net-export capture of Tabbit Browser's own
> traffic showed the header on `runs`, `join` and `usage`). The plugin sends
> one per call (#834), built the way the web app builds it: the time in
> seconds at fixed positions, and digit 5 — the web app's "Tabbit is the
> default browser" marker, which Tabbit counts toward Pro — set from the
> computer's real answer, as the browser does: the `https` handler in the
> Windows registry (also from WSL, through `reg.exe`) or macOS
> LaunchServices. `TABBIT_DEFAULT_BROWSER=1` or `0` overrides it.

There is no refresh endpoint. When the token runs out (7 days), magpie shows
the account as needing a sign-in again and the first method takes one more
click.

> **macOS only.** Reading the desktop's cookie is implemented for macOS. On
> Windows the store is DPAPI-encrypted and on Linux it uses a different store
> key; neither is done here. On those platforms the method refuses and names
> the platform, and the paste method is the one to use.

## Models

The catalog comes from the account:
`GET /proxy/v1/model_config/models?a=0&scene=chat` — the same call the Tabbit
app makes. A model's **id is the catalog's `display_name`, verbatim**
(`DeepSeek-V4.1-Flash`, `GLM-5.3-Flash`…), because that is the name a turn has
to be asked with.

| Catalog field | Becomes |
|---|---|
| `display_name` | the model id and name |
| `supports_images` | image input on the row |
| `support_thinking` | the reasoning flag (thinking arrives as `reasoning_content`) |
| `model_access_type` | `free_unlimited` / `free_metered` / `premium_only` |
| `hidden` | left out, as the app leaves it out |

**Client tools are bridged via `<tool_call>` prompt protocol** (`toolcall: true`).
The catalog's `supports_tools` means Tabbit's *own* server-side tools, so this
plugin serializes OpenAI `tools` / `tool_choice` into the initial prompt, holds
streaming `<tool_call>` blocks back from plain text deltas, parses single or
parallel calls into OpenAI `tool_calls` (`finish_reason: "tool_calls"`), and
continues the same Tabbit room with `[tool result ...]` deltas on subsequent
steps.

**Model filtering & limits.** By default `DEFAULT_ONLY_MODELS` exposes
`Gemini-4-Carbon` (`1M` context / `64k` output on `web.tabbit.ai`). Set
`TABBIT_MODELS=all` (or a comma-separated list of `display_name`s) to expose
additional models from the account's live catalog (`TABBIT_CONTEXT`,
`TABBIT_OUTPUT` default to 128k / 32k for unlisted models).

**Premium models** answer `403` with code `492` on a free account. The
**Free models only** switch in the provider's options leaves them out of the
list instead of letting them fail at the turn.

## Daily check-in (签到)

Tabbit's check-in is the desktop pet's activity, and it runs on
`/api/commerce/activity/v1/sign-in` — the same two calls the browser makes:

```
GET  /api/commerce/activity/v1/sign-in/status?scene_codes=desktop_pet
POST /api/commerce/activity/v1/sign-in   {request_no, scene_codes:["desktop_pet"]}
```

The plugin implements magpie's `auth.checkin` hook, so it appears where
WorkBuddy's does: **Settings → Usage → Plugins → Tabbit**, on by default after
you flip it, and magpie then runs it once a day per account and draws the
outcome on the account's card.

It reads the status first — free, and it says whether the activity is open —
and only claims when the day is actually unsigned. What Tabbit's answers
become:

| Tabbit says | The card shows |
|---|---|
| `signed_today: true` | **done** (no claim is sent at all) |
| `sign_in_result: "signed"` | **claimed**, with the usage it granted and the day count |
| `sign_in_result: "already_signed"` | **done** (a race, not a failure) |
| `activity_open: false` | **inactive** |
| no result for the scene | **ineligible** |
| any other word | **failed**, carrying Tabbit's own word for it |

`desktop_pet` is the only scene the service accepts — every other name comes
back `SIGN_IN_SCENE_UNSUPPORTED`. The pet itself needs `required_days` (3)
before it can be adopted, so a signed day also reports the streak
(`1/3 days`).

A `sign_in_result` this plugin hasn't seen is reported as a failure rather
than guessed as a claim: a wrong "claimed" is worse than a failure you can
read.

## Usage

`GET /api/commerce/quota/v1/usage` gives the cycle's allowance, which the
Usage card shows as **Cycle usage** — a percentage, with when the cycle resets
(Tabbit's cycles are weekly, named in Beijing time).

## How a turn is sent

`loader()` hands magpie a `fetch` that rewrites `chat/completions` into the
three calls Tabbit's app makes:

```
POST /api/v3/chat/rooms                      → a room (the conversation)
POST /api/v3/chat/rooms/<room>/runs          → the turn: { content, selected_model }
POST /api/v3/chat/rooms/<room>/join          → text/event-stream
```

The stream is written back as OpenAI chunks: `assistant_message_delta` →
`choices[].delta.content`, `event_message_chunk(thinking)` →
`reasoning_content`, `run_completed` → `finish_reason: "stop"`. A turn that
ends without `run_completed` or `run_failed` — the stream cut, the turn timing
out — comes back as an error event, not as a short answer: an agent would
otherwise take a half or empty reply as the answer. A turn that times out also
sends `chat/stop`, so it stops spending the account's allowance.

**Conversation history** lives in the room, and a session keeps its room.
Each magpie session (`chat.headers` carries the session id) gets one room for
the agent's requests (the ones with client tools) and one for its side
requests (a title, a summary). A follow-up sends only the new messages, hung
off the previous answer's id; the room is not replayed into the prompt.

A Tabbit room is linear: measured, the model sees every earlier turn of the
room whatever `parent_message_id` says, so a room can't be rewound. So when a
request doesn't simply continue the room, it is still sent there, with a note:

- the same request again (the answer didn't arrive): "answer it again";
- an answer that was cut before it reached the caller: "disregard it";
- a rewritten history (compacted, edited): "the transcript was rewritten",
  then the whole transcript, flattened;
- a changed tool list: only the tools added, changed or removed.

A new room is opened only for a new session, after a week, when a room has
been given 800,000 characters in all (`TABBIT_ROOM_CHARS`, 50,000 to
2,000,000), or when Tabbit refuses the room (reset, gone, or still busy after
a `chat/stop`). DeepSeek Harness's per-step "Time sampled …" messages are
ignored when matching a transcript.

The move to a fresh room happens by itself, in the middle of a session: the
turn that would have gone past the limit goes to a new room with the whole
transcript, and the caller sees an ordinary answer. Once the new room has
answered, the old one is archived in the Tabbit sidebar — Tabbit has no
archive of its own, so its title gets an `[归档] ` prefix (the web app's own
rename, `PUT /proxy/v0/chat/sessions/<id>`); it is not deleted.

The record of which room carries which session is kept in
`$XDG_STATE_HOME/magpie/tabbit-rooms.json` (or `~/.local/state/…`;
`TABBIT_ROOMS_FILE` moves it, `off` turns it off), so a restart of magpie keeps
a session in its room. It holds hashes, not text: a chain hash of the
transcript sent, a hash per tool, the room and answer ids.

**Concurrency.** A room answers one turn at a time (a second run is refused
with 409), while separate rooms of one account answer side by side (20 at
once, measured). Requests for the same room therefore wait in the plugin, in
order, and the plugin answers up to **4** turns at once across rooms
(`maxConcurrency`; `TABBIT_CONCURRENCY=1..16` changes it).

**The 20,000-character turn cap.** Tabbit refuses a turn whose `content` is
longer than 20,000 characters. The web app checks it before sending
(`plainText.length > 2e4` → "too-long"), and the server enforces the same line:
on `web.tabbit.ai` a turn of 19,970 characters is queued, while one of 20,900
comes back as `429`, code `492` ("Welcome to Tabbit Browser..."), which is the
same answer the sign-in gate gives. The cap counts characters, not bytes:
19,800 CJK characters (about 59 KB of JSON) were accepted. An agent's first
request (system prompt plus a few dozen tools) is well past it, so the plugin
handles it in two ways:

- **Compact tool signatures.** Each tool's arguments go into the prompt as a
  TypeScript-style object type (`path: string // Path to read.`, `limit?: number`),
  not as stringified JSON Schema. Every description, enum, default and bound is
  kept; JSON punctuation and keywords such as `$schema` and
  `additionalProperties: false` are dropped.
- **Long prompts sent in parts.** A prompt that is still past the cap is cut on
  paragraph or line breaks into parts of at most 18,000 characters
  (`TABBIT_PART_CHARS` changes this). The parts are sent as consecutive turns of
  the same room, each one hung off the previous answer. Every part except the
  last asks the model to reply only `ACK`, and the last part asks for the
  answer. In a live test, three parts of about 18k characters went into one
  room, and the last turn answered with facts that appeared only in parts 1 and 2.
  Each earlier part is read to its end because a room takes one run at a time:
  stopping a part early made the next one fail with `409` "already has an active
  room run". Each part costs one short turn, roughly 10 seconds. Follow-ups in
  the same session only send the new messages, so the parts are sent once per
  room.

## Working on this package

From a checkout of this source tree, or from the published package:

```sh
magpie plugin add .        # this checkout; the community list has the package
magpie plugin login tabbit # or: pick the provider in the app
magpie provider test tabbit
magpie models tabbit
```

In OpenCode, add `@magpie-community/opencode-tabbit-auth` under `plugin` and
sign in with `opencode auth login`.

## Development

```sh
node --test tests/*.test.mjs   # Bun: `bun test`. Every hook, a synthetic
                               # cookie store, a replayed SSE turn
node scripts/check.mjs         # loads the hooks the way magpie and OpenCode do
```

The tests never touch the network. `tests/plugin.test.mjs` stubs Tabbit's four
endpoints; `tests/sse.test.mjs` replays a recorded turn, including a rejoin's
snapshot and a turn cut short; `tests/cookie.test.mjs` seals and unseals a
synthetic Chromium `v10` blob.

## Limits worth knowing

- A turn is a web-app turn: first text takes seconds, and a room runs one
  turn at a time.
- Tabbit keeps the room's own history, so a flattened prompt is sent only to a
  new room or after a rewrite, not on every turn. A flattened prompt past the 20,000-character turn
  cap is sent in parts (see above); a transcript past the model's own context
  limit is Tabbit's call, and Tabbit answers with its own error.
- The catalog call answers without a valid token; a token that has really
  expired shows up at the first turn (`401 请先登录`), which marks the account.