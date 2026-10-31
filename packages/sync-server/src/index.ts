import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readProject } from "@morado/project-parser";
import { protocolVersion, type ExportedScript, type ProjectConfig, type SyncMessage } from "@morado/protocol";

const port = Number(process.env.MORADO_PORT ?? 34872);
const projectFile = process.env.MORADO_PROJECT ?? "morado.project.json";
let project: ProjectConfig | undefined;
let updates: ExportedScript[] = [];
let exportedScripts: ExportedScript[] = [];

async function loadProject(): Promise<void> {
  project = JSON.parse(await readFile(projectFile, "utf8")) as ProjectConfig;
  updates = await readProject(project.root);
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
      response.end();
      return;
    }
    if (request.url === "/api/health") {
      json(response, 200, { ok: true, protocol: protocolVersion, connected: true });
      return;
    }
    if (request.url === "/api/sync" && request.method === "GET") {
      if (!project) await loadProject();
      json(response, 200, { protocol: protocolVersion, type: "sync", project, updates } satisfies SyncMessage);
      return;
    }
    if (request.url === "/api/export" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      exportedScripts = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ExportedScript[];
      if (!project) await loadProject();
      const root = resolve(project?.root ?? ".");
      for (const script of exportedScripts) {
        const destination = resolve(root, script.path);
        const pathFromRoot = relative(root, destination);
        if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith(`..${pathSeparator}`) || pathFromRoot === "..") {
          throw new Error(`Export path is outside the project root: ${script.path}`);
        }
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, script.content, "utf8");
      }
      json(response, 200, { ok: true, count: exportedScripts.length });
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
  }
});

const pathSeparator = process.platform === "win32" ? "\\" : "/";

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Morado sync server listening on http://127.0.0.1:${port}\n`);
});
