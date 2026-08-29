# NEXUS Mobile Termux Bridge

This is the Termux-side companion for the Acode **NEXUS Mobile Console** plugin.

## Design rules

- binds to `127.0.0.1` only;
- listens on port `8766` by default, leaving KIWI Core on `8765` untouched;
- never accepts raw shell commands from Acode;
- tests run only from a `test_command` array stored in the local bridge config;
- logs are read only from file paths stored in the local config;
- local-AI calls are accepted only when the configured model endpoint is also loopback HTTP(S);
- no service stop/restart/kill endpoint exists in v0.1.

## Install in Termux

From a local checkout of this repository:

```sh
mkdir -p ~/.config/nexus-mobile
cp tools/nexus-mobile-bridge/bridge.config.example.json ~/.config/nexus-mobile/bridge.json
chmod 600 ~/.config/nexus-mobile/bridge.json
python tools/nexus-mobile-bridge/nexus_mobile_bridge.py
```

Health check:

```sh
curl http://127.0.0.1:8766/nexus-mobile/v1/health
```

Expected:

```json
{"status":"online"}
```

## Configure projects

Each project may define an allow-listed test command:

```json
{
  "id": "my-project",
  "name": "My Project",
  "path": "~/nexus-workspace/my-project",
  "test_command": ["python", "-m", "pytest", "-q"],
  "test_timeout_seconds": 180
}
```

The Acode client sends only `projectId`. It cannot substitute the command.

## Configure local AI

If a local OpenAI-compatible server is available, add this to the config using its actual loopback port:

```json
{
  "ai": {
    "url": "http://127.0.0.1:PORT",
    "model": "LOCAL_MODEL_NAME"
  }
}
```

Do not point this field at a cloud or LAN endpoint; the bridge rejects non-loopback hosts.

## Validation performed

The bridge source has been checked with `python -m py_compile`, and the `/health` and `/services` routes were exercised against a temporary local instance before commit.
