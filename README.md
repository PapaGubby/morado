# Morado

Morado connects Visual Studio Code and Roblox Studio through a local sync server.

## Repository layout

```text
apps/
  vscode-extension/
packages/
  protocol/
  project-parser/
  sync-server/
roblox/
  plugin/
examples/
  basic-game/
```

## Development

```powershell
npm install
npm run build
```

Open the repository in Visual Studio Code and run `Morado: Start`.

The extension creates a `morado.project.json` file and the standard Roblox service folders. Enable HTTP requests in Roblox Studio, paste `roblox/plugin/MoradoPlugin.lua` into a plugin script, and press `Connect`.

## Project layout

Scripts use Roblox naming conventions:

```text
*.server.lua  -> Script
*.client.lua  -> LocalScript
*.module.lua  -> ModuleScript
```

The generated project includes `ReplicatedFirst`, `ReplicatedStorage`, `ServerScriptService`, `ServerStorage`, `StarterGui`, `StarterPack`, `StarterPlayer`, and `Workspace`.
