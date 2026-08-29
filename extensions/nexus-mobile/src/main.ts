import plugin from "../plugin.json";
import { BridgeClient, NexusSnapshot, NexusService } from "./bridge";

const COMMANDS = {
  open: "nexus.mobile.open",
  refresh: "nexus.mobile.refresh",
  configure: "nexus.mobile.configureBridge",
  tests: "nexus.mobile.runTests",
  logs: "nexus.mobile.viewLogs",
  ai: "nexus.mobile.askLocalAi",
};

class NexusMobilePlugin {
  private page?: Acode.WCPage;
  private bridge = new BridgeClient();
  private container?: HTMLElement;
  private output = "";

  async init(page: Acode.WCPage): Promise<void> {
    this.page = page;
    this.registerCommands();
    this.registerSidebar();
  }

  async destroy(): Promise<void> {
    const commands = acode.require("commands");
    Object.values(COMMANDS).forEach((name) => commands.removeCommand(name));
    const sideBarApps = acode.require("sidebarApps") as any;
    try {
      sideBarApps.remove?.(plugin.id);
    } catch {
      // Older Acode versions may not expose sidebar removal.
    }
  }

  private registerCommands(): void {
    const commands = acode.require("commands");
    commands.addCommand({
      name: COMMANDS.open,
      description: "NEXUS: Open Mobile Console",
      exec: () => void this.open(),
    });
    commands.addCommand({
      name: COMMANDS.refresh,
      description: "NEXUS: Refresh Local Status",
      exec: () => void this.refresh(),
    });
    commands.addCommand({
      name: COMMANDS.configure,
      description: "NEXUS: Configure Loopback Bridge",
      exec: () => void this.configureBridge(),
    });
    commands.addCommand({
      name: COMMANDS.tests,
      description: "NEXUS: Run Tests in Termux",
      exec: () => void this.runTests(),
    });
    commands.addCommand({
      name: COMMANDS.logs,
      description: "NEXUS: View Local Logs",
      exec: () => void this.viewLogs(),
    });
    commands.addCommand({
      name: COMMANDS.ai,
      description: "NEXUS: Explain Selection with Local AI",
      exec: () => void this.askLocalAi(),
    });
  }

  private registerSidebar(): void {
    const sideBarApps = acode.require("sidebarApps") as any;
    sideBarApps.add(
      "icon-terminal",
      plugin.id,
      "NEXUS",
      (container: HTMLElement) => {
        this.container = container;
        this.renderShell();
        void this.refresh();
      },
      true,
      (container: HTMLElement) => {
        this.container = container;
        void this.refresh();
      },
    );
  }

  private async open(): Promise<void> {
    if (!this.page) return;
    this.page.innerHTML = this.pageMarkup();
    this.bindPageActions(this.page as unknown as HTMLElement);
    this.page.show();
    await this.refresh();
  }

  private renderShell(): void {
    if (!this.container) return;
    this.container.innerHTML = this.panelMarkup({
      bridge: "unknown",
      services: [],
      projects: [],
      checkedAt: "Not checked",
    });
    this.bindPanelActions(this.container);
  }

  private async refresh(): Promise<void> {
    this.setOutput("Checking local bridge…");
    try {
      const snapshot = await this.bridge.snapshot();
      if (this.container) {
        this.container.innerHTML = this.panelMarkup(snapshot);
        this.bindPanelActions(this.container);
      }
      const pageElement = this.page as unknown as HTMLElement | undefined;
      if (this.page && pageElement?.isConnected) {
        this.page.innerHTML = this.pageMarkup(snapshot);
        this.bindPageActions(pageElement);
      }
      this.setOutput(
        snapshot.bridge === "online"
          ? `Bridge online · ${snapshot.services.length} services · ${snapshot.projects.length} projects`
          : "Bridge offline. Start or repair the Termux-side bridge, then refresh.",
      );
    } catch (error) {
      this.setOutput(error instanceof Error ? error.message : String(error));
    }
  }

  private async configureBridge(): Promise<void> {
    const value = window.prompt(
      "Loopback bridge URL (localhost only)",
      this.bridge.baseUrl,
    );
    if (!value) return;
    try {
      this.bridge.baseUrl = value;
      this.setOutput(`Bridge URL saved: ${this.bridge.baseUrl}`);
      await this.refresh();
    } catch (error) {
      acode.alert("NEXUS Mobile", error instanceof Error ? error.message : String(error));
    }
  }

  private async runTests(): Promise<void> {
    this.setOutput("Requesting governed test run from Termux…");
    try {
      const summary = await this.bridge.runTests();
      this.setOutput(summary);
    } catch (error) {
      this.setOutput(this.formatError(error));
    }
  }

  private async viewLogs(): Promise<void> {
    this.setOutput("Loading local logs…");
    try {
      const logs = await this.bridge.getLogs();
      this.setOutput(logs);
    } catch (error) {
      this.setOutput(this.formatError(error));
    }
  }

  private async askLocalAi(): Promise<void> {
    const editorManager = acode.require("editorManager") as any;
    const editor = editorManager?.editor;
    let text = "";

    try {
      if (editor?.state?.selection?.main && editor?.state?.doc) {
        const { from, to } = editor.state.selection.main;
        text = editor.state.doc.sliceString(from, to).trim();
      }
    } catch {
      text = "";
    }

    if (!text) {
      text = window.prompt("Text to explain with local AI", "")?.trim() || "";
    }
    if (!text) return;

    this.setOutput("Sending selected text to the local-only AI bridge…");
    try {
      const answer = await this.bridge.explainWithLocalAi(text);
      this.setOutput(answer);
    } catch (error) {
      this.setOutput(this.formatError(error));
    }
  }

  private bindPanelActions(root: HTMLElement): void {
    root.querySelector("[data-nexus='refresh']")?.addEventListener("click", () => void this.refresh());
    root.querySelector("[data-nexus='configure']")?.addEventListener("click", () => void this.configureBridge());
    root.querySelector("[data-nexus='tests']")?.addEventListener("click", () => void this.runTests());
    root.querySelector("[data-nexus='logs']")?.addEventListener("click", () => void this.viewLogs());
    root.querySelector("[data-nexus='ai']")?.addEventListener("click", () => void this.askLocalAi());
  }

  private bindPageActions(root: HTMLElement): void {
    this.bindPanelActions(root);
  }

  private setOutput(text: string): void {
    this.output = text;
    for (const root of [this.container, this.page as unknown as HTMLElement]) {
      if (!root?.querySelector) continue;
      const out = root.querySelector("[data-nexus-output]");
      if (out) out.textContent = text;
    }
  }

  private panelMarkup(snapshot: NexusSnapshot): string {
    const services = snapshot.services.length
      ? snapshot.services.map((service) => this.serviceRow(service)).join("")
      : '<div class="nexus-empty">No service data</div>';
    const projects = snapshot.projects.length
      ? snapshot.projects
          .map(
            (project) =>
              `<div class="nexus-project"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.state || "ready")}</span></div>`,
          )
          .join("")
      : '<div class="nexus-empty">No projects reported</div>';

    return `${this.styles()}
      <section class="nexus-console">
        <header><div><strong>NEXUS Mobile</strong><small>Local developer cockpit</small></div><span class="nexus-dot ${escapeHtml(snapshot.bridge)}"></span></header>
        <div class="nexus-meta">Bridge: ${escapeHtml(snapshot.bridge)}<br><small>${escapeHtml(this.bridge.baseUrl)}</small></div>
        <h4>Services</h4>${services}
        <h4>Projects</h4>${projects}
        <div class="nexus-actions">
          <button data-nexus="refresh">Refresh</button>
          <button data-nexus="tests">Test</button>
          <button data-nexus="logs">Logs</button>
          <button data-nexus="ai">Local AI</button>
          <button data-nexus="configure">Bridge</button>
        </div>
        <pre data-nexus-output>${escapeHtml(this.output || "Ready")}</pre>
      </section>`;
  }

  private pageMarkup(snapshot?: NexusSnapshot): string {
    return this.panelMarkup(
      snapshot || {
        bridge: "unknown",
        services: [],
        projects: [],
        checkedAt: "Not checked",
      },
    );
  }

  private serviceRow(service: NexusService): string {
    return `<div class="nexus-service"><span class="nexus-dot ${escapeHtml(service.status)}"></span><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.detail || service.status)}</small></div></div>`;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private styles(): string {
    return `<style>
      .nexus-console{padding:12px;font-family:system-ui,sans-serif;display:grid;gap:10px}
      .nexus-console header{display:flex;justify-content:space-between;align-items:center}
      .nexus-console header div{display:grid;gap:2px}.nexus-console small{opacity:.72;word-break:break-all}
      .nexus-meta,.nexus-service,.nexus-project,pre[data-nexus-output]{padding:9px;border:1px solid rgba(127,127,127,.25);border-radius:9px}
      .nexus-service,.nexus-project{display:flex;align-items:center;gap:8px;justify-content:space-between}.nexus-service div{display:grid;flex:1}
      .nexus-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:#808080}.nexus-dot.online{background:#2aa745}.nexus-dot.offline{background:#c53a3a}.nexus-dot.degraded{background:#d59322}
      .nexus-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.nexus-actions button{padding:9px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit}
      pre[data-nexus-output]{white-space:pre-wrap;max-height:240px;overflow:auto;margin:0}.nexus-empty{opacity:.65;font-size:.9em}
    </style>`;
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (window.acode) {
  const instance = new NexusMobilePlugin();
  acode.setPluginInit(plugin.id, async (_baseUrl, page) => {
    await instance.init(page);
  });
  acode.setPluginUnmount(plugin.id, () => {
    void instance.destroy();
  });
}
