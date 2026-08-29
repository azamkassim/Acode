# NEXUS Mobile Console for Acode

A local-first developer cockpit that keeps **Acode as the editor/UI** and **Termux as the canonical runtime**.

## Boundary

This plugin does not move NEXUS services into Acode. It only talks to a loopback bridge on `localhost` / `127.0.0.1` / `::1`.

It deliberately does **not**:

- read credentials or secrets;
- call banking/internal systems;
- expose the bridge to LAN or internet hosts;
- kill or restart services;
- execute arbitrary shell commands.

The Termux-side bridge remains responsible for command allow-lists, project ownership, logs, tests and local-AI routing.

## Current capabilities

- NEXUS sidebar dashboard
- local bridge health check
- service status list
- project list
- governed test request
- local log viewer
- local-AI explanation of selected text
- command-palette entries for all actions
- configurable loopback URL

Default bridge contract:

`http://127.0.0.1:8765/nexus-mobile/v1`

Expected endpoints:

- `GET /health`
- `GET /services`
- `GET /projects`
- `GET /logs?limit=200`
- `POST /actions/test`
- `POST /ai/explain`

## Build

From Termux, with this repository available locally:

```sh
cd extensions/nexus-mobile
npm install
npm run typecheck
npm run build
```

The build writes `plugin.zip` in this directory. Install it in Acode using **Plugins → + → Local**.

For development:

```sh
npm run dev
```

Then install the plugin from the local development URL printed by the server.

## Security model

The client rejects non-loopback bridge URLs even if a user attempts to save one. Treat all bridge responses as untrusted display data; the UI escapes returned service/project text before rendering.

No background auto-send, credential capture or internal-bank automation is part of this plugin.
