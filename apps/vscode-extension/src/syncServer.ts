import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { watch } from "node:fs";

type ScriptClass = "Script" | "LocalScript" | "ModuleScript";

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

function scriptName(path: string): string {
  return path
    .replace(/\.server\.lua$/, "")
    .replace(/\.client\.lua$/, "")
    .replace(/\.module\.lua$/, "");
}

function normalizeModulePaths(scripts: ScriptUpdate[]): ScriptUpdate[] {
  const paths = new Set(scripts.map((script) => script.path));
  return scripts.map((script) => {
    if (script.className !== "ModuleScript") return script;
    const parts = script.path.split("/");
    const file = parts[parts.length - 1];
    const name = scriptName(file);
    if (name === "init") return script;
    if (parts.length > 1 && parts[parts.length - 2] === name) {
      return { ...script, path: `${parts.slice(0, -1).join("/")}/init.module.lua` };
    }
    const base = scriptName(script.path);
    if ([...paths].some((path) => path.startsWith(`${base}/`))) {
      return { ...script, path: `${base}/init.module.lua` };
    }
    return script;
  });
}

function normalizeExportPaths(scripts: ScriptUpdate[]): ScriptUpdate[] {
  scripts = normalizeModulePaths(scripts);
  const modulePathsWithChildren = new Set(
    scripts
      .filter((script) => script.className === "ModuleScript")
      .filter((script) => scripts.some((child) => child.path.startsWith(`${scriptName(script.path)}/`)))
      .map((script) => script.path)
  );

  return scripts.map((script) => {
    if (!modulePathsWithChildren.has(script.path)) return script;
    const path = scriptName(script.path);
    return {
      ...script,
      path: `${path}/init.module.lua`
    };
  });
}

const scriptTypes: Record<string, ScriptClass> = {
  ".server.lua": "Script",
  ".client.lua": "LocalScript",
  ".module.lua": "ModuleScript"
};

const protocolVersion = 1;

async function readProject(root: string): Promise<ScriptUpdate[]> {
  const updates: ScriptUpdate[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const suffix = Object.keys(scriptTypes).find((value) => entry.name.endsWith(value));
      if (!suffix) continue;
      updates.push({
        path: relative(root, path).replaceAll("\\", "/"),
        className: scriptTypes[suffix],
        content: await readFile(path, "utf8")
      });
    }
  }

  await visit(root);
  return normalizeModulePaths(updates).sort((left, right) => left.path.localeCompare(right.path));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<string> {
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
        continue;
      }
      if (entry.name.toLowerCase() === `${exactName}.module.lua`) {
        candidates.add(join(directory, ".."));
      }
    }
  }

  await visit(root);
  if (candidates.size === 0) {
    const normalized = exactName.replace(/[^a-z0-9]/g, "");
    async function findSimilar(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const name = entry.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (entry.isDirectory()) {
          if (name.includes(normalized) || normalized.includes(name)) candidates.add(path);
          await findSimilar(path);
        }
      }
    }
    await findSimilar(root);
  }
  if (candidates.size === 0) candidates.add(expected);
  return [...candidates].filter((path, index, all) => all.indexOf(path) === index);
}

async function replaceCurrent(root: string, payload: CurrentExport): Promise<number> {
  const scripts = normalizeExportPaths(payload.scripts);
  const targets = await findMatchingTargets(root, payload.rootPath, payload.rootName);
  const normalizedRoot = payload.rootPath.replaceAll("\\", "/").replace(/\/+$/, "");
  for (const target of targets) {
    const relativeTarget = relative(root, target);
    if (isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("Export target is outside the project root");
    }
    await rm(target, { recursive: true, force: true });
    for (const script of scripts) {
      const normalizedPath = script.path.replaceAll("\\", "/");
      const prefix = `${normalizedRoot}/`;
      const scriptPath = normalizedPath === `${normalizedRoot}.server.lua`
        ? `${payload.rootName}.server.lua`
        : normalizedPath === `${normalizedRoot}.client.lua`
          ? `${payload.rootName}.client.lua`
          : normalizedPath === `${normalizedRoot}.module.lua`
            ? `${payload.rootName}.module.lua`
            : normalizedPath.startsWith(prefix)
        ? normalizedPath.slice(prefix.length)
        : normalizedPath;
      const destination = resolve(target, scriptPath);
      const pathFromRoot = relative(root, destination);
      if (isAbsolute(pathFromRoot) || pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        throw new Error("Export script is outside the project root");
      }
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, script.content, "utf8");
    }
  }
  return scripts.length;
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
        const scripts = normalizeExportPaths(JSON.parse(await body(request)) as ScriptUpdate[]);
        for (const script of scripts) {
          const destination = resolve(root, script.path);
          const pathFromRoot = relative(root, destination);
          if (isAbsolute(pathFromRoot) || pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
            throw new Error(`Export path is outside the project root: ${script.path}`);
          }
          await mkdir(resolve(destination, ".."), { recursive: true });
          await writeFile(destination, script.content, "utf8");
        }
        await refresh();
        send(response, 200, { ok: true, count: scripts.length, revision });
        return;
      }
      if (request.method === "POST" && request.url === "/api/export-current") {
        const payload = JSON.parse(await body(request)) as CurrentExport;
        const count = await replaceCurrent(root, payload);
        await refresh();
        send(response, 200, { ok: true, count, revision });
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
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
