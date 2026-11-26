# qwenwork-ent — QwenWork Enterprise (dedicated domain / VPC) for magpie / OpenCode

[中文说明](README.zh-CN.md)

Connects a **QwenWork Enterprise 旗舰版** account — the deployment that serves an
organisation from its own dedicated domain — as a magpie / OpenCode provider.
Sign-in uses the enterprise account's own device flow; model lists, chats and
token renewals then go to that instance's hosts, with the host agent's tools
riding along.

> Unofficial. Not reviewed by magpie or QwenWork. Read the code before installing.
> This plugin serves **dedicated-domain (VPC) deployments only**. For a personal
> account use `magpie-plugin-qwenwork` (provider `qwenwork`).

| Provider id | Service | Host rule |
|---|---|---|
| `qwenwork-ent` | QwenWork Enterprise (旗舰版) | `<instance>.vpc.qwenwork.cn` and its `-openapi` / `-gateway` hosts |

## How the hosts are built

QwenWork's desktop client moves all three services onto a dedicated domain once
an instance is configured. This plugin builds the same three hosts from the
instance prefix, which is asked once at sign-in and kept on the account:

| Purpose | Host |
|---|---|
| Sign-in page | `https://<instance>.vpc.qwenwork.cn` |
| Accounts, tokens, usage | `https://<instance>-openapi.vpc.qwenwork.cn` |
| Models, agent chats | `https://<instance>-gateway.vpc.qwenwork.cn` |

Enterprise sign-in is a `premiumIam` flow: it sends **no `redirect_uri`**, and the
OAuth client id comes from the enterprise deployment profile, not the personal
app's built-in id. After sign-in the plugin reads `account-context` once more and
records the account's organisation identity (`team_id`), so renewals are signed
as `target: "biz"` — the way the desktop client renews an enterprise account.
Without that, renewal would fail once the first token expires.

## Install

```sh
magpie plugin add github:<you>/magpie-plugin-qwenwork-enterprise
magpie plugin login qwenwork-ent
magpie claude qwenwork-ent/<model>
```

A local folder works too: `magpie plugin add /path/to/magpie-plugin-qwenwork-enterprise`.

## Set the client id first

Enterprise 旗舰版 deployments usually ship their own OAuth client id. The plugin
falls back to the personal id, which the enterprise gateway will most likely
refuse — the symptom is a failed sign-in with little detail:

```sh
export QWENWORK_ENT_CLIENT_ID='<client id from the enterprise deployment>'
```

## Sign in: the instance prefix

```sh
magpie plugin login qwenwork-ent
# enterprise instance prefix (acme -> acme.vpc.qwenwork.cn), or a full host
```

For unattended installs, skip the prompt:

```sh
export QWENWORK_ENT_VPC_INSTANCE=acme
```

`acme`, `acme.vpc.qwenwork.cn`, `https://acme.vpc.qwenwork.cn`,
`acme-openapi.vpc.qwenwork.cn` and `https://acme-gateway.vpc.qwenwork.cn/` all
name the same instance. `http://`, IPs, other domains, paths and ports are
refused, so an enterprise token is never signed for the wrong host.

## Enterprise CA / private network

Node and Bun read `NODE_EXTRA_CA_CERTS` only at process start, so export it
before launching magpie:

```sh
export NODE_EXTRA_CA_CERTS=/path/to/enterprise-root-ca.pem
```

For an outbound proxy use the runtime's `HTTPS_PROXY` / `HTTP_PROXY` support; the
plugin itself ships no proxy code.

## Usage

magpie shows the account's organisation, plan and credits beside the provider,
read from the instance's own `account-context` without an extra request:

- Organisation · plan: `organization.orgName` / `plan.name`
- Reset: `plan.next_refresh_date`, else `plan.next_due_date`
- Credits: `quota` and `organization.quota` (shared pool), as a percentage and
  `used / total credits`

A deployment with a different account path can set
`QWENWORK_ENT_ACCOUNT_CONTEXT_PATH`.

## Environment variables

All optional, all prefixed `QWENWORK_ENT_`; every one can also live in
`defaults.json`.

| Variable | Default | Meaning |
|---|---|---|
| `CLIENT_ID` | personal id | **Enterprise OAuth client id** — set it explicitly |
| `VPC_DOMAIN` | `vpc.qwenwork.cn` | Suffix of the dedicated domain |
| `VPC_INSTANCE` | empty | Instance prefix; makes sign-in non-interactive |
| `WEB` / `OPENAPI` / `API` | public gateway | Base addresses only; a VPC account uses its own three hosts |
| `REDIRECT` | empty | Enterprise sign-in sends none |
| `REFRESH_TARGET` | `c` | Fallback device-token refresh target; an organisation identity renews as `biz` |
| `TEAM_ID` | empty | Organisation team id, when `account-context` does not carry one |
| `CLIENT_TYPE` | `6` | `Cosy-ClientType` |
| `BUSINESS_PRODUCT` | `qoder_work` | `Cosy-Business-Product` |
| `SESSION_TYPE` | `qoder_work` | Session type |
| `USER_INFO_PATH` | `/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing` | User info after sign-in |
| `ACCOUNT_CONTEXT_PATH` | `/api/v1/adapter/user/account-context?include=user,plan,quota` | Usage |
| `COSY_VERSION` | `1.1.59` | COSY version header |
| `RSA_PUBLIC_KEY` | built in | RSA key wrapping the COSY AES key (PEM) |

## Safety

- Only the enterprise VPC sign-in is offered; personal sign-in is not exposed.
- An account with no instance is refused before any request, instead of falling
  back to the public gateway.
- Upstream errors are trimmed and token-redacted by the adapter before they
  reach the caller.
- Only the chat completions endpoint is served.

## Limitations

- Sign-in needs the device flow: an organisation that forces a browser SSO
  callback or disables device authorization cannot sign in here.
- Personal/organisation identity switching (`/api/v1/adapter/auth/switch`) is
  not implemented: the plugin relies on the device sign-in returning the
  organisation identity. If your account signs in without org access, switch
  identity in the desktop client first.
- No mTLS client certificates; put a proxy in front of magpie if the gateway
  requires mutual TLS.
- Models come from the instance's `qwork` scene, as the account actually sees them.
- Enterprise **standard** edition (public gateway, org billing) should use the
  `qwenwork` plugin instead.

## Verify

```sh
node check.mjs   # offline: fake account and mocked upstream, no live requests
```

14 checks: instance parsing and refusal, login URL, three-host routing, refusal
without an instance, usage/organisation, tool calls (native and inline
`<tool_call>`), streaming, lapsed refresh, error redaction. The report lands in
`verification.json` together with the SHA-256 of `vendor/qoder.mjs`.

## Credits and licence

- Provider skeleton and protocol codec from
  [harwinvoid/magpie-plugin-qwenwork](https://github.com/harwinvoid/magpie-plugin-qwenwork) (MIT).
- `vendor/qoder.mjs` is the magpie-community adapter (MIT) with one small,
  documented patch for enterprise renewal under the organisation identity; see
  `vendor/README.md`. Everything else enterprise-specific lives in `index.mjs`.
- Icon is the QwenWork app icon, used only to identify the product.
- MIT.
