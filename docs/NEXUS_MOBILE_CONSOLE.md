# NEXUS Mobile Console Architecture

## Classification

**ENHANCE** — Acode remains an upstream-compatible Android editor. NEXUS functionality is added as an isolated plugin rather than a fork-wide rewrite.

## Canonical separation

```text
Acode                    Termux
-----                    ------
Editor / UI              Canonical Git workspace
Sidebar cockpit   <-->   Local bridge :8766
Command palette          Tests
Selection context        Services
Status display           Logs
Local-AI request         Local model runtime
```

Acode must not become the canonical service runtime. Termux remains the execution environment and source of runtime truth.

## Bridge trust boundary

The Acode plugin only permits HTTP(S) URLs whose host is one of:

- `127.0.0.1`
- `localhost`
- `::1`

The bridge binds to `127.0.0.1:8766` by default. Port `8765` remains available to the existing KIWI Core service.

The bridge exposes a narrow API and maps requests to an explicit allow-list. It does not accept raw shell commands from Acode.

### v1 API contract

Base URL: `http://127.0.0.1:8766/nexus-mobile/v1`

`GET /health`

```json
{ "status": "online" }
```

`GET /services`

```json
[
  { "id": "kiwi", "name": "KIWI Core", "status": "online", "detail": "healthy" }
]
```

`GET /projects`

```json
[
  { "id": "nexus-one", "name": "NEXUS One", "state": "ready" }
]
```

`GET /logs?limit=200`

```json
{ "text": "...sanitized local log lines..." }
```

`POST /actions/test`

```json
{ "projectId": null }
```

The bridge chooses the test command from its local config. The plugin never sends an arbitrary command string.

`POST /ai/explain`

```json
{ "text": "user-selected code or error text" }
```

This endpoint routes only to a configured loopback model endpoint.

## Fork governance

1. Keep `main` aligned with `Acode-Foundation/Acode` whenever practical.
2. Put NEXUS customization under `extensions/nexus-mobile` or another isolated extension path.
3. Avoid changing upstream editor internals unless a plugin API cannot meet a proven requirement.
4. Land NEXUS work through a dedicated branch/PR so upstream synchronization remains reviewable.
5. Do not commit secrets, tokens, customer data, internal-bank credentials or private logs.

## Phase status

| Phase | Status | Result |
|---|---|---|
| 1. Fork governance | Complete | isolated branch + documented boundary |
| 2. Plugin skeleton | Complete | TypeScript Acode plugin scaffold |
| 3. Termux bridge | Complete v0.1 | loopback-only reference server + typed client |
| 4. Dashboard | Complete v0.1 | services, projects, logs, tests |
| 5. Local AI | Complete client/server path v0.1 | explain-selection to loopback OpenAI-compatible model |
| 6. One-tap workflow | Partial by design | governed test action only; build/deploy and service-control actions are withheld until explicitly allow-listed and audited |

## Runtime replacement note

The companion bridge is independent of the previously broken `nexus-mobile` shell CLI. It can replace that discovery/status transport without moving runtime ownership into Acode. Service restart/kill functionality remains intentionally absent from v0.1.
