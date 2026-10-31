import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startSyncServer, type SyncServer } from "./syncServer.js";

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

let server: SyncServer | undefined;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;

async function scaffold(root: string): Promise<void> {
  const gameRoot = join(root, "game");
  await Promise.all(services.map((service) => mkdir(join(gameRoot, service), { recursive: true })));
  const projectFile = join(root, "morado.project.json");
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(projectFile));
  } catch {
    const config = {
      name: vscode.workspace.name ?? "MoradoGame",
      root: "game",
      mappings: Object.fromEntries(services.map((service) => [service, service]))
    };
    await writeFile(projectFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

async function workspaceRoot(): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error("Open a workspace folder before using Morado.");
  return root;
}

async function initialize(): Promise<string> {
  const root = await workspaceRoot();
  await scaffold(root);
  return root;
}

async function start(): Promise<void> {
  if (server) {
    vscode.window.showInformationMessage("Morado is already running.");
    return;
  }
  const root = await initialize();
  const port = vscode.workspace.getConfiguration("morado").get<number>("port", 34872);
  const projectFile = join(root, "morado.project.json");
  server = await startSyncServer(projectFile, port, (message) => output.appendLine(message));
  status.text = `$(sync) Morado :${port}`;
  status.tooltip = "Morado is connected";
  const shouldPort = await vscode.window.showInformationMessage(
    "Port existing scripts and modules from Roblox Studio into this workspace?",
    "Port assets",
    "Not now"
  );
  if (shouldPort === "Port assets") {
    vscode.window.showInformationMessage("Open the Morado Roblox Studio panel and click Export.");
  }
  vscode.window.showInformationMessage(`Morado is running on port ${port}. Connect from the Roblox Studio plugin.`);
}

async function stop(): Promise<void> {
  if (server) {
    await server.close();
    server = undefined;
  }
  status.text = "$(plug) Morado";
  status.tooltip = "Start Morado";
  vscode.window.showInformationMessage("Morado stopped.");
}

async function sync(): Promise<void> {
  if (!server) throw new Error("Morado is not running. Run Morado: Start first.");
  const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
  if (!response.ok) throw new Error(`Morado health check failed with status ${response.status}.`);
  vscode.window.showInformationMessage("Morado is ready for synchronization.");
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

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Morado");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "morado.start";
  status.text = "$(plug) Morado";
  status.tooltip = "Start Morado";
  status.show();
  context.subscriptions.push(
    vscode.commands.registerCommand("morado.start", () => runCommand(start)),
    vscode.commands.registerCommand("morado.stop", () => runCommand(stop)),
    vscode.commands.registerCommand("morado.sync", () => runCommand(sync)),
    vscode.commands.registerCommand("morado.initialize", () => runCommand(async () => {
      const root = await initialize();
      vscode.window.showInformationMessage(`Morado project initialized in ${root}.`);
    })),
    status,
    output
  );
}

export async function deactivate(): Promise<void> {
  if (server) await server.close();
}
