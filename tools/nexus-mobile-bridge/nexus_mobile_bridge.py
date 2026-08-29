#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import urllib.request
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

API_PREFIX = "/nexus-mobile/v1"
DEFAULT_PORT = 8766
DEFAULT_CONFIG = Path("~/.config/nexus-mobile/bridge.json").expanduser()
MAX_BODY_BYTES = 256 * 1024
MAX_AI_TEXT = 16_000


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(value))).resolve()


def is_loopback_host(host: str) -> bool:
    return host.lower() in {"127.0.0.1", "localhost", "::1", "[::1]"}


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"services": [], "projects": [], "logs": [], "ai": None}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Bridge config must be a JSON object")
    return data


def service_state(service: dict[str, Any]) -> dict[str, str]:
    host = str(service.get("host", "127.0.0.1"))
    port = int(service.get("port", 0))
    state = "unknown"
    detail = "no port configured"
    if port > 0 and is_loopback_host(host):
        try:
            with socket.create_connection((host.strip("[]"), port), timeout=0.4):
                state = "online"
                detail = f"listening on {host}:{port}"
        except OSError:
            state = "offline"
            detail = f"not reachable on {host}:{port}"
    elif not is_loopback_host(host):
        state = "degraded"
        detail = "non-loopback service target rejected"
    return {
        "id": str(service.get("id", service.get("name", "service"))),
        "name": str(service.get("name", service.get("id", "Service"))),
        "status": state,
        "detail": detail,
    }


def project_view(project: dict[str, Any]) -> dict[str, str]:
    result = {
        "id": str(project.get("id", project.get("name", "project"))),
        "name": str(project.get("name", project.get("id", "Project"))),
        "state": "configured",
    }
    path_value = project.get("path")
    if path_value:
        path = expand_path(str(path_value))
        result["path"] = str(path)
        result["state"] = "ready" if path.is_dir() else "missing"
    return result


def tail_file(path: Path, limit: int) -> list[str]:
    if not path.is_file():
        return [f"[missing] {path}"]
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return list(deque(handle, maxlen=limit))


def collect_logs(config: dict[str, Any], limit: int) -> str:
    chunks: list[str] = []
    remaining = max(1, min(limit, 1000))
    for entry in config.get("logs", []):
        if remaining <= 0:
            break
        path = expand_path(str(entry))
        lines = tail_file(path, remaining)
        chunks.append(f"=== {path.name} ===\n" + "".join(lines).rstrip())
        remaining -= len(lines)
    return "\n\n".join(chunks) if chunks else "No log files configured."


def find_project(config: dict[str, Any], project_id: str | None) -> dict[str, Any]:
    projects = config.get("projects", [])
    if project_id:
        for project in projects:
            if str(project.get("id")) == project_id:
                return project
        raise KeyError(f"Unknown project: {project_id}")
    if len(projects) == 1:
        return projects[0]
    raise KeyError("projectId is required when multiple/no projects are configured")


def run_project_tests(config: dict[str, Any], project_id: str | None) -> str:
    project = find_project(config, project_id)
    command = project.get("test_command")
    if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
        raise ValueError("Selected project has no allow-listed test_command array")
    cwd = expand_path(str(project.get("path", "~")))
    if not cwd.is_dir():
        raise FileNotFoundError(f"Project directory missing: {cwd}")
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=int(project.get("test_timeout_seconds", 180)),
        env={**os.environ, "NEXUS_MOBILE_BRIDGE": "1"},
        check=False,
    )
    output = completed.stdout[-12000:] if completed.stdout else ""
    return f"exit={completed.returncode}\n{output}".rstrip()


def local_ai_explain(config: dict[str, Any], text: str) -> str:
    ai = config.get("ai")
    if not isinstance(ai, dict):
        raise ValueError("Local AI endpoint is not configured")
    endpoint = str(ai.get("url", "")).rstrip("/")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not is_loopback_host(parsed.hostname or ""):
        raise ValueError("AI endpoint must be loopback HTTP(S)")
    model = str(ai.get("model", "local-model"))
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "Explain the supplied code or error concisely. Do not invent missing facts.",
                },
                {"role": "user", "content": text[:MAX_AI_TEXT]},
            ],
            "temperature": 0.2,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{endpoint}/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    try:
        return str(payload["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Unexpected local AI response shape") from exc


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "NexusMobileBridge/0.1"

    @property
    def config(self) -> dict[str, Any]:
        return self.server.config  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[nexus-mobile] " + (fmt % args) + "\n")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        if route == f"{API_PREFIX}/health":
            self.json_response({"status": "online"})
            return
        if route == f"{API_PREFIX}/services":
            self.json_response([service_state(item) for item in self.config.get("services", [])])
            return
        if route == f"{API_PREFIX}/projects":
            self.json_response([project_view(item) for item in self.config.get("projects", [])])
            return
        if route == f"{API_PREFIX}/logs":
            limit = int(parse_qs(parsed.query).get("limit", ["200"])[0])
            self.json_response({"text": collect_logs(self.config, limit)})
            return
        self.error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        try:
            payload = self.read_json_body()
            if route == f"{API_PREFIX}/actions/test":
                summary = run_project_tests(self.config, payload.get("projectId"))
                self.json_response({"summary": summary})
                return
            if route == f"{API_PREFIX}/ai/explain":
                text = str(payload.get("text", "")).strip()
                if not text:
                    self.error_response(HTTPStatus.BAD_REQUEST, "text is required")
                    return
                self.json_response({"answer": local_ai_explain(self.config, text)})
                return
            self.error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")
        except subprocess.TimeoutExpired:
            self.error_response(HTTPStatus.GATEWAY_TIMEOUT, "Test command timed out")
        except (ValueError, KeyError, FileNotFoundError) as exc:
            self.error_response(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self.error_response(HTTPStatus.INTERNAL_SERVER_ERROR, f"Bridge error: {type(exc).__name__}")

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Invalid request body size")
        raw = self.rfile.read(length)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def json_response(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error_response(self, status: HTTPStatus, message: str) -> None:
        self.json_response({"error": message}, status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Loopback-only NEXUS Mobile bridge for Termux")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not (1024 <= args.port <= 65535):
        raise SystemExit("Port must be between 1024 and 65535")
    config = load_config(args.config.expanduser())
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BridgeHandler)
    server.config = config  # type: ignore[attr-defined]
    print(f"NEXUS Mobile bridge listening on http://127.0.0.1:{args.port}{API_PREFIX}")
    print(f"Config: {args.config.expanduser()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
