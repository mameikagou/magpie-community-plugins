# magpie-blaze-api

A full-fledged provider plugin for [**magpie**](https://usemagpie.ai) and [**OpenCode**](https://opencode.ai) (compatible with both OpenCode 1.x and OpenCode 2.x) supporting [**BlazeAPI**](https://blazeapi.org) (`https://api.blazeapi.org/paid/v1`).

## Features

- **Multi-protocol native routing**:
  - **Anthropic Messages** (`/paid/v1/messages` via `@ai-sdk/anthropic`) for paid/Tokens-V2 Claude models (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4.5`, etc.), with `x-api-key` + `anthropic-version: 2023-06-01` headers and SSE streaming.
  - **OpenAI Responses** (`/paid/v1/responses` via `@ai-sdk/openai`) for GPT-5+, o-series, and Codex models (`gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, etc.).
  - **OpenAI Chat Completions** (`/paid/v1/chat/completions` via `@ai-sdk/openai-compatible`) for Gemini, DeepSeek, Grok, Qwen, GLM, Kimi, MiniMax, `free/*` models, and Tavily search models (`tavily-search`, `tavily-extract`, `tavily-crawl`, `tavily-map`, `tavily-research`).
- **Live catalog discovery (`provider.models`)**:
  - Fetches your live model list from `GET /paid/v1/models` with pricing (`cost.input`, `cost.output`, `cost.cache.read`), context/output token limits, vision modalities, reasoning variants (`low` / `medium` / `high`), `free: true` badges on `free/*` models, and `rate` multipliers on `tokv2/*` models.
  - Automatically falls back to your last known per-account catalog on transient network/5xx errors without losing models, and marks `signIn: "expired"` on HTTP 401.
- **Per-model `toolcall` capability & blocklist/overrides**:
  - Automatically disables `toolcall` on search models and known non-tool-capable models (such as `free/allam-2-7b`, `llama-guard-*`, `compound-beta*`, and models marked `supports_tools: false` / `tool_call: false` by BlazeAPI), preventing HTTP `400 upstream_error` failures when agents attach `tools`.
  - Supports fine-grained `toolcallOverrides`, `disableToolcallModels`, and `enableToolcallModels` glob/exact overrides.
- **Default model, pinned favorites & prefix filters**:
  - Pin `defaultModel` (also sets OpenCode `cfg.model` when unset) and `favorites` / `pinnedModels` to the top of your catalog, optionally filter to `favoritesOnly`, and slice by prefix (`includePrefixes`, `excludePrefixes`, `includeFree`, `includeTokV2`, `includePayg`).
- **Anthropic prompt-caching & thinking budget tuning**:
  - Exposes configurable `thinking` budgets (`low` / `medium` / `high`, customizable via `anthropicThinkingBudgets` and `anthropicThinkingBudget`) for Claude models on `/paid/v1/messages`, honoring Magpie's `x-magpie-effort` header and safely clamping `budget_tokens < max_tokens`.
  - Supports automatic `cache_control: { type: "ephemeral" }` breakpoints (`anthropicCacheControl`, `anthropicCacheTTL` `"5m"` / `"1h"`, or stripping via `"off"`), plus a one-click Magpie UI switch.
- **Live diagnostics page (`magpie.page`)**:
  - Registers a **BlazeAPI** page inside Magpie showing live BlazeAPI provider health (`GET /paid/v1/providers`), endpoint latencies (`/providers`, `/models`, `/usage`), account quota/balance, and a searchable/sortable per-model pricing & capability table.
- **Usage & balance reporting (`auth.usage`)**:
  - Reads `GET /paid/v1/usage` to surface your plan, PAYG balance, daily token allowance, RPM limits, Token Vault, Tokens V2, and Credits in Magpie's UI, `magpie quota`, and `GET /v1/magpie/quotas`.
- **Sign-in flows (`auth.methods`)**:
  - **BlazeAPI Key**: quick native API key entry (`blaze-…`).
  - **BlazeAPI Key (verify & configure)**: validates your key live against BlazeAPI, identifies your account/plan, and lets you choose catalog scope (`all`, `available`, or `free`) and an optional custom Base URL.
- **Smart error & routing handling**:
  - Preserves `X-Magpie-Sign-In: kept` on HTTP `402` (`price_above_cap`), `403` (plan/model restriction), and `429` (rate/daily limit) so Magpie failover moves to the next account/model without falsely expiring your key.
  - Optional `X-Blaze-Provider` routing header (`cheapest`, `fastest`, `best`, or comma-separated provider names such as `sirius,cosmos`).
- **Magpie + OpenCode 1.x + OpenCode 2.x compatible**:
  - Exports `{ BlazeApiPlugin }` from `./opencode.mjs` (`main`) for Magpie and OpenCode 1.x, and `{ id, setup }` from `./opencode2.mjs` (`exports["."]`) for OpenCode 2.x.

## Installation

### In Magpie

From npm (searchable in Magpie's Discover → Plugins):

```sh
magpie plugin add magpie-blaze-api
magpie plugin login blazeapi
```

From GitHub:

```sh
magpie plugin add github:suwupnil/magpie-blaze-api
magpie plugin login blazeapi
```

From a local clone:

```sh
git clone https://github.com/suwupnil/magpie-blaze-api.git
magpie plugin add ./magpie-blaze-api
magpie plugin login blazeapi
```

Check status, models, and quota:

```sh
magpie plugin
magpie provider models blazeapi
magpie provider test blazeapi
magpie quota
```

### In OpenCode

Add the plugin to your `opencode.json` (project or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["magpie-blaze-api"]
}
```

Then run `opencode auth login blazeapi` (or `opencode auth login` and select **BlazeAPI**).

## Plugin Options

In Magpie (`plugins.json` or `magpie plugin options <plugin-spec> '<json>'`), you can configure:

| Option | Default | Description |
| --- | --- | --- |
| `baseURL` | `"https://api.blazeapi.org/paid/v1"` | Custom BlazeAPI-compatible base URL. |
| `scope` | `"available"` | `"available"` (only models your current balance/plan can call), `"all"` (all chat models including PAYG models with `$0` balance), or `"free"` (only `free/*` models). |
| `protocol` | `"auto"` | `"auto"` (native Anthropic for Claude, Responses for GPT-5+/o-series/Codex, Chat Completions for the rest) or `"chat"` (force Chat Completions for all models). |
| `providerRouting` | `""` | Set to `"cheapest"`, `"fastest"`, `"best"`, or provider names (e.g. `"sirius,cosmos"`) to send `X-Blaze-Provider`. |
| `defaultModel` | `""` | Default model ID (e.g. `"claude-sonnet-5-5"` or `"free/deepseek-v4.1-flash"`). Placed first in the catalog and sets `cfg.model` when unset. |
| `favorites` | `[]` | Array (or comma-separated string) of pinned model IDs or glob patterns (`["claude-sonnet-5-5", "tokv2/*"]`). Alias: `pinnedModels`. |
| `favoritesOnly` | `false` | When `true`, expose only `defaultModel` and `favorites` in the catalog. |
| `includePrefixes` | `[]` | Restrict catalog to specific prefixes (e.g. `["free/", "tokv2/", "unprefixed"]`). |
| `excludePrefixes` | `[]` | Exclude specific prefixes (e.g. `["payg/", "free/"]`). |
| `includeSearchModels` | `true` | Include Tavily search models (`tavily-*`). |
| `includeTokV2` | `true` | Include `tokv2/*` models. |
| `includePayg` | `true` | Include `payg/*` prefix models. |
| `includeFree` | `true` | Include `free/*` models. |
| `includeUnavailable` | `false` | Include models currently marked `down` or globally unavailable. |
| `toolcallOverrides` | `{}` | Per-model or glob `toolcall` overrides, e.g. `{"free/*": false, "free/deepseek-*": true}`. |
| `disableToolcallModels` | `[]` | Additional model IDs/globs to mark `toolcall: false`. |
| `enableToolcallModels` | `[]` | Model IDs/globs to force `toolcall: true` (overrides built-in blocklist). |
| `anthropicThinkingBudget` | `0` | Default `thinking.budget_tokens` (`>= 1024`) to inject on `/paid/v1/messages` when `thinking` is unset. `0` disables automatic injection. |
| `anthropicThinkingBudgets` | `{"low":4096,"medium":16384,"high":32768}` | Effort-to-budget map used for Claude `variants` and Magpie `x-magpie-effort` headers. |
| `anthropicCacheControl` | `"auto"` | `"auto"` (pass through client marks), `"ephemeral"` (or `true`, auto-inject up to 4 breakpoints on `tools`, `system`, and latest turn), or `"off"` (strip `cache_control`). |
| `anthropicCacheTTL` | `""` | Optional prompt cache TTL (`"5m"` or `"1h"`; `"1h"` adds `extended-cache-ttl-2025-04-11` beta header). |
| `diagnosticsPort` | `3489` | Local loopback port for the `magpie.page` BlazeAPI diagnostics service (`0` disables the server). |

Magpie's **Plugins / Provider Editor** UI also exposes native switches (`auth.options`) for `favorites_only`, `hide_free`, `hide_tokv2`, `hide_payg`, and `anthropic_prompt_cache`.

Example:

```sh
magpie plugin options magpie-blaze-api '{"defaultModel":"claude-sonnet-5-5","favorites":["free/deepseek-v4.1-flash"],"providerRouting":"cheapest","anthropicCacheControl":"ephemeral"}'
```

## Development & Testing

Run syntax checks and unit/integration tests with Node.js (>= 20) or Bun:

```sh
npm run lint
npm test
```

Test inside an isolated Magpie sandbox without touching your real configuration:

```sh
sb=$(mktemp -d)
m() { env HOME="$sb" XDG_CONFIG_HOME="$sb/.config" XDG_CACHE_HOME="$sb/.cache" MAGPIE_ADDR=127.0.0.1:3499 magpie "$@"; }
m plugin add . </dev/null
m plugin --json
```

## License

MIT
