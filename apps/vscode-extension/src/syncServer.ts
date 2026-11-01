import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { watch } from "node:fs";

type ScriptClass = "Script" | "LocalScript" | "ModuleScript" | "Folder" | "Object";

interface ScriptUpdate {
  path: string;
  className: ScriptClass;
  content: string;
}

interface ProjectConfig {
  name: string;
  root: string;
  mappings: Record<string, string>;
}

function stripSuffix(path: string): string {
  return path
    .replace(/\.server\.lua$/, "")
    .replace(/\.client\.lua$/, "")
    .replace(/\.module\.lua$/, "")
    .replace(/\.morado\.json$/, "");
}

function normalizeModulePath(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  const name = stripSuffix(file);
  if (name === "init" && parts.length > 1) return path;
  if (parts.length > 1 && parts[parts.length - 2] === name) {
    return `${parts.slice(0, -1).join("/")}/init.module.lua`;
  }
  return path;
}

function normalizeUpdates(updates: ScriptUpdate[]): ScriptUpdate[] {
  return updates.map((update) => update.className === "ModuleScript"
    ? { ...update, path: normalizeModulePath(update.path) }
    : update);
}

const sourceTypes: Record<string, ScriptClass> = {
  ".server.lua": "Script",
  ".client.lua": "LocalScript",
  ".module.lua": "ModuleScript",
  ".morado.json": "Object"
};

const protocolVersion = 2;

async function readProject(root: string): Promise<ScriptUpdate[]> {
  const updates: ScriptUpdate[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const hasLegacyModule = entries.some((candidate) =>
          candidate.isFile() &&
          candidate.name === `${entry.name}.module.lua`
        );
        if (!hasLegacyModule) {
          updates.push({
            path: relative(root, path).replaceAll("\\", "/"),
            className: "Folder",
            content: ""
          });
        }
        await visit(path);
        continue;
      }
      const suffix = Object.keys(sourceTypes).find((value) => entry.name.endsWith(value));
      if (!suffix) continue;
      updates.push({
        path: relative(root, path).replaceAll("\\", "/"),
        className: sourceTypes[suffix],
        content: await readFile(path, "utf8")
      });
    }
  }

  await visit(root);
  return normalizeUpdates(updates).sort((left, right) => {
    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    return leftDepth - rightDepth || left.path.localeCompare(right.path);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

interface CurrentExport {
  rootPath: string;
  rootName: string;
  scripts: ScriptUpdate[];
}

async function findMatchingTargets(root: string, rootPath: string, rootName: string): Promise<string[]> {
  const expected = resolve(root, rootPath);
  const candidates = new Set<string>();
  const exactName = rootName.toLowerCase();

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === exactName) candidates.add(path);
        await visit(path);
      } else if (entry.name.toLowerCase() === `${exactName}.module.lua`) {
        candidates.add(join(directory, ".."));
      }
    }
  }

  await visit(root);
  if (candidates.size === 0) candidates.add(expected);
  return [...candidates];
}

function inside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function exportPath(rootPath: string, rootName: string, path: string): string {
  const normalizedRoot = rootPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath === `${normalizedRoot}.server.lua`) return `${rootName}.server.lua`;
  if (normalizedPath === `${normalizedRoot}.client.lua`) return `${rootName}.client.lua`;
  if (normalizedPath === `${normalizedRoot}.module.lua`) return `${rootName}/init.module.lua`;
  const prefix = `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : normalizedPath;
}

async function replaceCurrent(root: string, payload: CurrentExport): Promise<number> {
  const scripts = normalizeUpdates(payload.scripts);
  const targets = await findMatchingTargets(root, payload.rootPath, payload.rootName);
  let count = 0;
  for (const target of targets) {
    if (!inside(root, target)) throw new Error("Export target is outside the project root");
    await rm(target, { recursive: true, force: true });
    for (const script of scripts) {
      const destination = resolve(target, exportPath(payload.rootPath, payload.rootName, script.path));
      if (!inside(root, destination)) throw new Error("Export script is outside the project root");
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, script.content, "utf8");
      count += 1;
    }
  }
  return count;
}

export interface SyncServer {
  port: number;
  close(): Promise<void>;
}

export async function startSyncServer(projectFile: string, port: number, onLog: (message: string) => void): Promise<SyncServer> {
  let project: ProjectConfig = JSON.parse(await readFile(projectFile, "utf8")) as ProjectConfig;
  let root = resolve(projectFile, "..", project.root);
  let updates = await readProject(root);
  let revision = 1;
  let refreshTimer: NodeJS.Timeout | undefined;

  const refresh = async (): Promise<void> => {
    try {
      project = JSON.parse(await readFile(projectFile, "utf8")) as ProjectConfig;
      root = resolve(projectFile, "..", project.root);
      updates = await readProject(root);
      revision += 1;
    } catch (error) {
      onLog(`Refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const watcher = watch(root, { recursive: true }, () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 120);
  });

  const server: Server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type"
        });
        response.end();
        return;
      }
      if (request.method === "GET" && request.url === "/api/health") {
        send(response, 200, { ok: true, protocol: protocolVersion, revision });
        return;
      }
      if (request.method === "GET" && request.url === "/api/sync") {
        send(response, 200, { protocol: protocolVersion, type: "sync", project, revision, updates });
        return;
      }
      if (request.method === "POST" && request.url === "/api/export") {
        const scripts = normalizeUpdates(JSON.parse(await requestBody(request)) as ScriptUpdate[]);
        for (const script of scripts) {
          const destination = resolve(root, script.path);
          if (!inside(root, destination)) throw new Error(`Export path is outside the project root: ${script.path}`);
          await mkdir(resolve(destination, ".."), { recursive: true });
          await writeFile(destination, script.content, "utf8");
        }
        await refresh();
        send(response, 200, { ok: true, count: scripts.length, revision });
        return;
      }
      if (request.method === "POST" && request.url === "/api/export-current") {
        const count = await replaceCurrent(root, JSON.parse(await requestBody(request)) as CurrentExport);
        await refresh();
        send(response, 200, { ok: true, count, revision });
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });

  return {
    port,
    close: async () => {
      watcher.close();
      if (refreshTimer) clearTimeout(refreshTimer);
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise());
      });
    }
  };
}
