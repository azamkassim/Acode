export type ServiceState = "online" | "offline" | "degraded" | "unknown";

export interface NexusService {
  id: string;
  name: string;
  status: ServiceState;
  detail?: string;
}

export interface NexusProject {
  id: string;
  name: string;
  path?: string;
  state?: string;
}

export interface NexusSnapshot {
  bridge: ServiceState;
  services: NexusService[];
  projects: NexusProject[];
  checkedAt: string;
}

const STORAGE_KEY = "nexus.mobile.bridgeUrl";
const DEFAULT_URL = "http://127.0.0.1:8766/nexus-mobile/v1";

export class BridgeClient {
  get baseUrl(): string {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
  }

  set baseUrl(value: string) {
    const normalized = normalizeLoopbackUrl(value);
    localStorage.setItem(STORAGE_KEY, normalized);
  }

  async snapshot(): Promise<NexusSnapshot> {
    const [health, services, projects] = await Promise.allSettled([
      this.get<{ status?: ServiceState }>("/health"),
      this.get<NexusService[]>("/services"),
      this.get<NexusProject[]>("/projects"),
    ]);

    return {
      bridge:
        health.status === "fulfilled"
          ? health.value.status || "online"
          : "offline",
      services: services.status === "fulfilled" ? services.value : [],
      projects: projects.status === "fulfilled" ? projects.value : [],
      checkedAt: new Date().toISOString(),
    };
  }

  async getLogs(limit = 200): Promise<string> {
    const result = await this.get<{ text?: string } | string>(`/logs?limit=${limit}`);
    return typeof result === "string" ? result : result.text || "No logs returned.";
  }

  async runTests(projectId?: string): Promise<string> {
    const result = await this.post<{ summary?: string }>("/actions/test", {
      projectId: projectId || null,
    });
    return result.summary || "Test request accepted by the local bridge.";
  }

  async explainWithLocalAi(text: string): Promise<string> {
    const result = await this.post<{ answer?: string }>("/ai/explain", { text });
    return result.answer || "No answer returned by the local AI bridge.";
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const base = normalizeLoopbackUrl(this.baseUrl);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Bridge HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }
      return (await response.text()) as T;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export function normalizeLoopbackUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]";
  if (!allowed) {
    throw new Error("NEXUS Mobile only permits loopback bridge URLs.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bridge URL must use HTTP or HTTPS.");
  }
  return trimmed;
}
