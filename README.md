# Morado

Morado connects Visual Studio Code and Roblox Studio through a local sync server.

## Repository layout

```text
apps/
  vscode-extension/
roblox/
  plugin/
```

## Release build

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run extension:package
```

The generated VSIX is in `apps/vscode-extension`. Install it in Visual Studio Code with `Extensions: Install from VSIX`.

After installation, open a game workspace and run `Morado: Start`. Morado creates the project folders and starts its local server inside the extension. No Node or npm command is needed after the VSIX is installed.

Enable HTTP requests in Roblox Studio, paste `roblox/plugin/MoradoPlugin.lua` into a Studio plugin, enter `34872`, and press `Connect`.

## Project layout

Scripts use Roblox naming conventions:

```text
*.server.lua  -> Script
*.client.lua  -> LocalScript
*.module.lua  -> ModuleScript
```

The generated project includes `ReplicatedFirst`, `ReplicatedStorage`, `ServerScriptService`, `ServerStorage`, `StarterGui`, `StarterPack`, `StarterPlayer`, and `Workspace`.
