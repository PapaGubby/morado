export const protocolVersion = 1;

export type MessageType =
  | "hello"
  | "sync"
  | "export"
  | "sync-complete"
  | "error";

export interface ProjectConfig {
  name: string;
  root: string;
  mappings: Record<string, string>;
}

export interface ScriptUpdate {
  path: string;
  className: "Script" | "LocalScript" | "ModuleScript";
  content: string;
}

export interface SyncMessage {
  protocol: number;
  type: MessageType;
  project?: ProjectConfig;
  updates?: ScriptUpdate[];
  payload?: unknown;
}

export interface ExportedScript {
  path: string;
  className: ScriptUpdate["className"];
  content: string;
}
