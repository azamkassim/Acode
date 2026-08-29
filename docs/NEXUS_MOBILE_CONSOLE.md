# NEXUS Mobile Console Architecture

## Classification

**ENHANCE** — Acode remains an upstream-compatible Android editor. NEXUS functionality is added as an isolated plugin rather than a fork-wide rewrite.

## Canonical separation

```text
Acode                    Termux
-----                    ------
Editor / UI              Canonical Git workspace
Sidebar cockpit   <-->   Local bridge
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

The bridge should bind to loopback only. It should expose a narrow API and map requests to an explicit allow-list. It must not accept raw shell commands from Acode.

### v1 API contract

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

The bridge chooses the test command. The plugin never sends an arbitrary command string.

`POST /ai/explain`

```json
{ "text": "user-selected code or error text" }
```

This endpoint must route only to a local model unless a later policy explicitly authorizes another destination.

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
| 3. Termux bridge client | Complete on Acode side | loopback-only typed client and API contract |
| 4. Dashboard | Complete v0.1 | services, projects, logs, tests |
| 5. Local AI | Complete client v0.1 | explain-selection endpoint |
| 6. One-tap workflow | Partial | governed test action only; build/deploy stays blocked until Termux allow-list is audited |

## Next runtime dependency

The Termux-side `nexus-mobile` implementation must satisfy this API contract. Because the existing CLI was previously observed with a shell syntax error, it should be repaired/replaced independently in Termux rather than compensated for inside Acode.
