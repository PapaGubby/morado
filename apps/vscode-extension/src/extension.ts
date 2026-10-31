import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const services = [
  "ReplicatedFirst",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPack",
  "StarterPlayer/StarterCharacterScripts",
  "StarterPlayer/StarterPlayerScripts",
  "Workspace"
];
let server: ChildProcess | undefined;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;

async function scaffold(root: string): Promise<void> {
  const gameRoot = join(root, "game");
  await Promise.all(services.map((service) => mkdir(join(gameRoot, service), { recursive: true })));
  const config = {
    name: vscode.workspace.name ?? "MoradoGame",
    root: "game",
    mappings: Object.fromEntries(services.map((service) => [service, service]))
  };
  await writeFile(join(root, "morado.project.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function initialize(): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error("Open a workspace before starting Morado.");
  await scaffold(root);
  return root;
}

async function start(context: vscode.ExtensionContext): Promise<void> {
  if (server) {
    vscode.window.showInformationMessage("Morado is already running.");
    return;
  }
  const root = await initialize();
  const port = vscode.workspace.getConfiguration("morado").get<number>("port", 34872);
  const serverPaths = [
    resolve(context.extensionPath, "packages", "sync-server", "dist", "index.js"),
    resolve(context.extensionPath, "..", "..", "packages", "sync-server", "dist", "index.js")
  ];
  const serverPath = serverPaths.find((path) => existsSync(path));
  if (!serverPath) {
    throw new Error("Morado sync server build not found. Run npm.cmd run build from the repository root.");
  }
  const shouldPort = await vscode.window.showInformationMessage("Port scripts and modules from Roblox Studio into this workspace?", "Port assets", "Not now");
  server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: { ...process.env, MORADO_PORT: String(port), MORADO_PROJECT: join(root, "morado.project.json") },
    stdio: "pipe"
  });
  server.stdout?.on("data", (data) => output.append(String(data)));
  server.stderr?.on("data", (data) => output.appendLine(String(data)));
  server.on("error", (error) => {
    output.appendLine(error.message);
    status.text = "$(error) Morado";
    void vscode.window.showErrorMessage(`Morado could not start: ${error.message}`);
  });
  server.on("exit", () => {
    server = undefined;
    status.text = "$(plug) Morado";
  });
  status.text = `$(sync~spin) Morado :${port}`;
  if (shouldPort === "Port assets") {
    vscode.window.showInformationMessage("Click Export in the Morado Roblox Studio panel to port scripts.");
  }
  vscode.window.showInformationMessage(`Morado server started on port ${port}.`);
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Morado");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "morado.start";
  status.text = "$(plug) Morado";
  status.tooltip = "Start Morado";
  status.show();
  context.subscriptions.push(
    vscode.commands.registerCommand("morado.start", () => runCommand(() => start(context))),
    vscode.commands.registerCommand("morado.initialize", () => runCommand(async () => {
      const root = await initialize();
      vscode.window.showInformationMessage(`Morado project initialized in ${root}.`);
    })),
    vscode.commands.registerCommand("morado.stop", () => {
      server?.kill();
      server = undefined;
      status.text = "$(plug) Morado";
      vscode.window.showInformationMessage("Morado sync server stopped.");
    }),
    vscode.commands.registerCommand("morado.sync", () => runCommand(async () => {
      const port = vscode.workspace.getConfiguration("morado").get<number>("port", 34872);
      const response = await fetch(`http://127.0.0.1:${port}/api/sync`);
      if (!response.ok) throw new Error(`Sync failed with status ${response.status}`);
      vscode.window.showInformationMessage("Morado sync is ready.");
    })),
    status,
    output
  );
}

async function runCommand(command: () => Promise<void>): Promise<void> {
  try {
    await command();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Morado error";
    output.appendLine(message);
    void vscode.window.showErrorMessage(`Morado: ${message}`);
  }
}

export function deactivate(): void {
  if (server) server.kill();
}
