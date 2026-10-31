import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  return updates.sort((left, right) => left.path.localeCompare(right.path));
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
        const scripts = JSON.parse(await body(request)) as ScriptUpdate[];
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
