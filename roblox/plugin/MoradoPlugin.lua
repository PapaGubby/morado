local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local DEFAULT_SERVER = "34872"
local connected = false
local syncing = false
local revision = 0
local services = {
    ReplicatedFirst = game:GetService("ReplicatedFirst"),
    ReplicatedStorage = game:GetService("ReplicatedStorage"),
    ServerScriptService = game:GetService("ServerScriptService"),
    ServerStorage = game:GetService("ServerStorage"),
    StarterGui = game:GetService("StarterGui"),
    StarterPack = game:GetService("StarterPack"),
    StarterPlayer = game:GetService("StarterPlayer"),
    Workspace = workspace
}

local toolbar = plugin:CreateToolbar("Morado")
local openButton = toolbar:CreateButton("Morado", "Open Morado", "")
local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Float,
    false,
    false,
    320,
    260,
    280,
    220
)
local widget = plugin:CreateDockWidgetPluginGui("MoradoDock", widgetInfo)
widget.Title = "Morado"
widget.Enabled = false

local root = Instance.new("Frame")
root.BackgroundColor3 = Color3.fromRGB(32, 32, 32)
root.BorderSizePixel = 0
root.Size = UDim2.fromScale(1, 1)
root.Parent = widget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 12)
padding.PaddingRight = UDim.new(0, 12)
padding.Parent = root

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = root

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Size = UDim2.new(1, 0, 0, 28)
title.Font = Enum.Font.GothamBold
title.Text = "Morado"
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.TextSize = 20
title.TextXAlignment = Enum.TextXAlignment.Left
title.LayoutOrder = 1
title.Parent = root

local addressLabel = Instance.new("TextLabel")
addressLabel.BackgroundTransparency = 1
addressLabel.Size = UDim2.new(1, 0, 0, 18)
addressLabel.Font = Enum.Font.Gotham
addressLabel.Text = "Server address"
addressLabel.TextColor3 = Color3.fromRGB(190, 190, 190)
addressLabel.TextSize = 12
addressLabel.TextXAlignment = Enum.TextXAlignment.Left
addressLabel.LayoutOrder = 2
addressLabel.Parent = root

local addressBox = Instance.new("TextBox")
addressBox.BackgroundColor3 = Color3.fromRGB(45, 45, 45)
addressBox.BorderColor3 = Color3.fromRGB(80, 80, 80)
addressBox.ClearTextOnFocus = false
addressBox.Font = Enum.Font.Code
addressBox.PlaceholderText = DEFAULT_SERVER
addressBox.Size = UDim2.new(1, 0, 0, 32)
addressBox.Text = DEFAULT_SERVER
addressBox.TextColor3 = Color3.fromRGB(255, 255, 255)
addressBox.TextSize = 14
addressBox.TextXAlignment = Enum.TextXAlignment.Left
addressBox.LayoutOrder = 3
addressBox.Parent = root

local connectButton = Instance.new("TextButton")
connectButton.BackgroundColor3 = Color3.fromRGB(98, 70, 180)
connectButton.BorderSizePixel = 0
connectButton.Font = Enum.Font.GothamMedium
connectButton.Size = UDim2.new(1, 0, 0, 34)
connectButton.Text = "Connect"
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.TextSize = 14
connectButton.LayoutOrder = 4
connectButton.Parent = root

local statusLabel = Instance.new("TextLabel")
statusLabel.BackgroundTransparency = 1
statusLabel.Size = UDim2.new(1, 0, 0, 22)
statusLabel.Font = Enum.Font.Gotham
statusLabel.Text = "Disconnected"
statusLabel.TextColor3 = Color3.fromRGB(220, 110, 110)
statusLabel.TextSize = 12
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.LayoutOrder = 5
statusLabel.Parent = root

local actions = Instance.new("Frame")
actions.BackgroundTransparency = 1
actions.Size = UDim2.new(1, 0, 0, 34)
actions.LayoutOrder = 6
actions.Parent = root

local actionLayout = Instance.new("UIListLayout")
actionLayout.FillDirection = Enum.FillDirection.Horizontal
actionLayout.Padding = UDim.new(0, 8)
actionLayout.Parent = actions

local syncButton = Instance.new("TextButton")
syncButton.BackgroundColor3 = Color3.fromRGB(55, 55, 55)
syncButton.BorderSizePixel = 0
syncButton.Font = Enum.Font.GothamMedium
syncButton.Size = UDim2.new(0.5, -4, 1, 0)
syncButton.Text = "Sync"
syncButton.TextColor3 = Color3.fromRGB(255, 255, 255)
syncButton.TextSize = 13
syncButton.Parent = actions

local exportButton = Instance.new("TextButton")
exportButton.BackgroundColor3 = Color3.fromRGB(55, 55, 55)
exportButton.BorderSizePixel = 0
exportButton.Font = Enum.Font.GothamMedium
exportButton.Size = UDim2.new(0.5, -4, 1, 0)
exportButton.Text = "Export"
exportButton.TextColor3 = Color3.fromRGB(255, 255, 255)
exportButton.TextSize = 13
exportButton.Parent = actions

local function getBaseUrl()
    local address = string.gsub(addressBox.Text, "^%s*(.-)%s*$", "%1")
    if address == "" then
        address = DEFAULT_SERVER
        addressBox.Text = address
    end
    local port = tonumber(address)
    if port then
        if port < 1 or port > 65535 or port % 1 ~= 0 then
            error("Morado port must be an integer from 1 to 65535")
        end
        return "http://127.0.0.1:" .. tostring(port)
    end
    if not string.match(address, "^https?://") then
        address = "http://" .. address
    end
    return string.gsub(address, "/+$", "")
end

local function request(path, method, body)
    local result = HttpService:RequestAsync({
        Url = getBaseUrl() .. path,
        Method = method or "GET",
        Headers = { ["Content-Type"] = "application/json" },
        Body = body and HttpService:JSONEncode(body) or nil
    })
    if not result.Success then
        error("Morado request failed: " .. result.StatusMessage)
    end
    return HttpService:JSONDecode(result.Body)
end

local function setStatus(text, color)
    statusLabel.Text = text
    statusLabel.TextColor3 = color
end

local function connect()
    local success, result = pcall(function()
        return request("/api/health")
    end)
    if not success then
        connected = false
        setStatus("Connection failed", Color3.fromRGB(220, 110, 110))
        return
    end
    connected = true
    revision = result.revision or 0
    setStatus("Connected - protocol " .. tostring(result.protocol), Color3.fromRGB(110, 220, 140))
end

local function getOrCreateParent(pathParts)
    local parent = game
    for index = 1, #pathParts do
        local child = parent:FindFirstChild(pathParts[index])
        if not child then
            child = Instance.new("Folder")
            child.Name = pathParts[index]
            child.Parent = parent
        end
        parent = child
    end
    return parent
end

local function applyUpdate(update)
    local pieces = {}
    for part in string.gmatch(update.path, "[^/]+") do
        table.insert(pieces, part)
    end
    local fileName = pieces[#pieces]
    local parent = getOrCreateParent({ table.unpack(pieces, 1, #pieces - 1) })
    local name = string.gsub(fileName, "%.server%.lua$", "")
    name = string.gsub(name, "%.client%.lua$", "")
    name = string.gsub(name, "%.module%.lua$", "")
    local instance = parent:FindFirstChild(name)
    if not instance or instance.ClassName ~= update.className then
        if instance then
            instance:Destroy()
        end
        instance = Instance.new(update.className)
        instance.Name = name
        instance.Parent = parent
    end
    instance.Source = update.content
end

local function sync()
    if syncing then
        return
    end
    syncing = true
    local success, result = pcall(function()
        local message = request("/api/sync")
        ChangeHistoryService:SetWaypoint("Morado sync started")
        for _, update in ipairs(message.updates or {}) do
            applyUpdate(update)
        end
        ChangeHistoryService:SetWaypoint("Morado sync complete")
        revision = message.revision or revision
        return #message.updates
    end)
    if success then
        setStatus("Synced " .. tostring(result) .. " scripts", Color3.fromRGB(110, 220, 140))
    else
        connected = false
        setStatus("Sync failed", Color3.fromRGB(220, 110, 110))
    end
    syncing = false
end

local function collect(container, prefix, result)
    for _, child in ipairs(container:GetChildren()) do
        local path = prefix .. "/" .. child.Name
        if child:IsA("Script") then
            table.insert(result, { path = path .. ".server.lua", className = "Script", content = child.Source })
        elseif child:IsA("LocalScript") then
            table.insert(result, { path = path .. ".client.lua", className = "LocalScript", content = child.Source })
        elseif child:IsA("ModuleScript") then
            table.insert(result, { path = path .. ".module.lua", className = "ModuleScript", content = child.Source })
        end
        collect(child, path, result)
    end
end

local function export()
    local success, result = pcall(function()
        local scripts = {}
        for name, service in pairs(services) do
            collect(service, name, scripts)
        end
        request("/api/export", "POST", scripts)
        return #scripts
    end)
    if success then
        setStatus("Exported " .. tostring(result) .. " scripts", Color3.fromRGB(110, 220, 140))
    else
        connected = false
        setStatus("Export failed", Color3.fromRGB(220, 110, 110))
    end
end

task.spawn(function()
    while true do
        task.wait(1)
        if connected and not syncing then
            local success, result = pcall(function()
                return request("/api/health")
            end)
            if success and result.revision and result.revision > revision then
                sync()
            elseif not success then
                connected = false
                setStatus("Connection lost", Color3.fromRGB(220, 110, 110))
            end
        end
    end
end)

openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

connectButton.MouseButton1Click:Connect(connect)
syncButton.MouseButton1Click:Connect(sync)
exportButton.MouseButton1Click:Connect(export)
