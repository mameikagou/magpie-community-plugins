<p align="center">
<a href="https://opc.fish" title="OPC.FISH Project."><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YE4IM/readme/main/project/assets/opc-fish-project-signature-web-dark.svg"><img src="https://raw.githubusercontent.com/YE4IM/readme/main/project/assets/opc-fish-project-signature.svg" alt="OPC.FISH Project" width="720"></picture></a>
</p>

# magpie-ducoro

[**English**](./README.md) | [中文](./README-zh-CN.md)

A Magpie plugin that syncs models, connectors, skills, and instructions to Ducoro Bots.

[![License: MIT](./assets/badges/license.svg)](./LICENSE) [![Version: 0.4.11](./assets/badges/version.svg)](./package.json) [![Language: JavaScript](./assets/badges/language.svg)](./lib/)

[Go to Quick Start](#quick-start)

<img src="./assets/ducoro-plugin.png" alt="Ducoro in Magpie, showing sync switches for the gateway connection, Bot models, connectors, skills, and instructions" width="640">

[Requirements](#requirements) · [Installation](#installation) · [Usage](#usage) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting) · [Changelog](#changelog)

## Overview

Let Bots share Magpie’s default model or choose a model for each Bot. Before syncing, review which settings and resources Ducoro will receive or remove.

## Requirements

- A Magpie installation with support for plugin agents and page services. [Magpie](https://usemagpie.ai)
- Ducoro installed and signed in, with its background service running and access to the device and Bots you want to manage. [Ducoro](https://ducoro.ai)
- `ducoro-cli` available on the `PATH` Magpie uses. [Ducoro CLI download](https://ducoro.ai/download/cli)

## Installation

In Magpie, open **Plugins → Add a plugin** and enter `github:YE4IM/magpie-ducoro#v0.4.11`. From a terminal, you can use the Magpie CLI.

```bash
magpie plugin add github:YE4IM/magpie-ducoro#v0.4.11
```

To install from an archive, extract the release source and add the extracted folder by absolute path. Stop the current plugin host before switching versions. [Release v0.4.11](https://github.com/YE4IM/magpie-ducoro/releases/tag/v0.4.11)

## Quick Start

1. In Magpie’s **Agent** page, connect Ducoro and choose a model. Open **Ducoro** in Magpie’s sidebar.
2. In **Sync settings**, review the connection slug, enabled resource types, and target Bots. For individual assignments, open **Bot resources**.
3. Select **Preview changes** to review additions, removals, and first-time gateway connection creation. If you changed any settings, select **Preview and save** and confirm to start syncing.
4. Open **Sync status** to check writes and readback verification. If you kept the current settings and need to start another sync, select **Retry sync** there. To confirm the configuration in use, start a new Ducoro session with a target Bot and check the synced settings there.

> [!NOTE]
> Plugin installation and the first sync were unverified in the documentation environment. The read-only diagnostics command ran, but the plugin’s live service was unreachable there.

## Usage

| To | In Ducoro’s plugin page |
| --- | --- |
| Choose a model | Follow Magpie’s default or assign a model per Bot. Override the automatic capability match when needed. |
| Assign connectors and skills | Choose global or per-Bot assignments. An empty per-Bot list clears the plugin’s assignments for that resource type. To assign tools from a Ducoro account connector, connect the account in Ducoro first. |
| Sync instructions and subagents | Select the target Bots. The plugin updates its managed instruction block and syncs explicitly selected subagents. |
| Share settings across Bots | Use a plan for models, connectors, skills, and instructions. Individual Bot choices take precedence. In the save preview, select **Try with one Bot** to verify a change before rolling it out. |
| Audit assignments | Use **Find Bots by resource** to trace a skill or library connector. Use **Compare two Bots** to review differences in model routes, resources, account tool permissions, and verification. |
| Restore saved records | Open **Backup and restore**. After restoring management records, select **Preview impact and resume sync** to review the changes and resume synchronization. |

The plugin follows Magpie’s language setting. Simplified and Traditional Chinese use the Chinese interface. Other languages use English.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `connectionSlug` | `magpie-ducoro` | Ducoro model connection ID |
| `servicePort` | `3487` | Plugin page-service port on `127.0.0.1` |
| `modelScope`, `mcpScope`, `skillsScope` | `global` | Set to `agents` for per-Bot assignments |
| `targetAgents` | `[]` | Limit models, instructions, subagents, and per-Bot library assignments to selected Bots |

Management records default to `~/.config/magpie/ducoro-bridge/state.json`. `DUCORO_BRIDGE_STATE_DIR` takes precedence when set. Otherwise, the plugin uses `magpie/ducoro-bridge` under `XDG_CONFIG_HOME` when available.

## Troubleshooting

If the plugin page fails to load, check that Magpie can find `ducoro-cli`, the Ducoro background service is running, and the configured `servicePort` is available. Run this read-only diagnostic from a checkout or an extracted release directory. Add `--lang zh` for Chinese or `--json` for structured output.

```bash
node diagnostics-cli.mjs --doctor
```

If unreadable management records pause sync, keep the original `state.json` and its journal. Review a valid backup in **Backup and restore**, then preview the impact before resuming.

If a sync lock remains after shutdown, stop all plugin hosts before inspecting the lock.

```bash
npm run lock:inspect -- /absolute/path/to/ducoro-bridge
```

To downgrade, stop the current host and compact the existing state journal using the current version before loading the older version.

```bash
npm run state:compact -- /absolute/path/to/state.json
```

## Changelog

[Version history](./docs/CHANGELOG.md) · [Latest release notes](./docs/RELEASE-NOTES.md) · [GitHub Releases](https://github.com/YE4IM/magpie-ducoro/releases)

## License

[MIT License](./LICENSE).
