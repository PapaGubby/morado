import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ScriptUpdate } from "@morado/protocol";

const scriptTypes: Record<string, ScriptUpdate["className"]> = {
  ".server.lua": "Script",
  ".client.lua": "LocalScript",
  ".module.lua": "ModuleScript"
};

export async function readProject(root: string): Promise<ScriptUpdate[]> {
  const updates: ScriptUpdate[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
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
