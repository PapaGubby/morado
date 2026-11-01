local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

local DEFAULT_SERVER = "34872"
local connected = false
local syncing = false
local revision = 0
local statusToken = 0
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
local serviceRoots = {
    ReplicatedFirst = services.ReplicatedFirst,
    ReplicatedStorage = services.ReplicatedStorage,
    ServerScriptService = services.ServerScriptService,
    ServerStorage = services.ServerStorage,
    StarterGui = services.StarterGui,
    StarterPack = services.StarterPack,
    StarterPlayer = services.StarterPlayer,
    Workspace = services.Workspace
}

local toolbar = plugin:CreateToolbar("Morado")
local openButton = toolbar:CreateButton("Morado", "Open Morado", "")
local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 360, 340, 320, 280)
local widget = plugin:CreateDockWidgetPluginGui("MoradoDock", widgetInfo)
widget.Title = "Morado"
widget.Enabled = false

local root = Instance.new("Frame")
root.BackgroundColor3 = Color3.fromRGB(28, 29, 34)
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

local header = Instance.new("Frame")
header.BackgroundTransparency = 1
header.Size = UDim2.new(1, 0, 0, 28)
header.LayoutOrder = 1
header.Parent = root

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Size = UDim2.new(0.5, 0, 1, 0)
title.Font = Enum.Font.GothamBold
title.Text = "Morado"
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.TextSize = 20
title.TextXAlignment = Enum.TextXAlignment.Left
title.Parent = header

local connectionStatus = Instance.new("TextLabel")
connectionStatus.BackgroundTransparency = 1
connectionStatus.Position = UDim2.new(0.5, 0, 0, 0)
connectionStatus.Size = UDim2.new(0.5, 0, 1, 0)
connectionStatus.Font = Enum.Font.GothamMedium
connectionStatus.Text = "Disconnected"
connectionStatus.TextColor3 = Color3.fromRGB(220, 110, 110)
connectionStatus.TextSize = 12
connectionStatus.TextXAlignment = Enum.TextXAlignment.Right
connectionStatus.Parent = header

local addressLabel = Instance.new("TextLabel")
addressLabel.BackgroundTransparency = 1
addressLabel.Size = UDim2.new(1, 0, 0, 18)
addressLabel.Font = Enum.Font.Gotham
addressLabel.Text = "Server port"
addressLabel.TextColor3 = Color3.fromRGB(180, 182, 190)
addressLabel.TextSize = 12
addressLabel.TextXAlignment = Enum.TextXAlignment.Left
addressLabel.LayoutOrder = 2
addressLabel.Parent = root

local addressBox = Instance.new("TextBox")
addressBox.BackgroundColor3 = Color3.fromRGB(42, 43, 50)
addressBox.BorderColor3 = Color3.fromRGB(75, 76, 86)
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
connectButton.BackgroundColor3 = Color3.fromRGB(100, 72, 190)
connectButton.BorderSizePixel = 0
connectButton.Font = Enum.Font.GothamMedium
connectButton.Size = UDim2.new(1, 0, 0, 34)
connectButton.Text = "Connect"
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.TextSize = 14
connectButton.LayoutOrder = 4
connectButton.Parent = root

local reportLabel = Instance.new("TextLabel")
reportLabel.BackgroundTransparency = 1
reportLabel.Size = UDim2.new(1, 0, 0, 38)
reportLabel.Font = Enum.Font.Gotham
reportLabel.Text = "Ready"
reportLabel.TextColor3 = Color3.fromRGB(180, 182, 190)
reportLabel.TextSize = 12
reportLabel.TextWrapped = true
reportLabel.TextXAlignment = Enum.TextXAlignment.Left
reportLabel.LayoutOrder = 5
reportLabel.Parent = root

local actions = Instance.new("Frame")
actions.BackgroundTransparency = 1
actions.Size = UDim2.new(1, 0, 0, 70)
actions.LayoutOrder = 6
actions.Parent = root

local actionLayout = Instance.new("UIGridLayout")
actionLayout.CellPadding = UDim2.fromOffset(8, 8)
actionLayout.CellSize = UDim2.new(0.5, -4, 0, 30)
actionLayout.Parent = actions

local function makeAction(text, color)
    local button = Instance.new("TextButton")
    button.BackgroundColor3 = color or Color3.fromRGB(52, 53, 61)
    button.BorderSizePixel = 0
    button.Font = Enum.Font.GothamMedium
    button.Text = text
    button.TextColor3 = Color3.fromRGB(255, 255, 255)
    button.TextSize = 12
    button.Parent = actions
    return button
end

local syncButton = makeAction("Sync")
local exportButton = makeAction("Export")
local exportCurrentButton = makeAction("ExportCurrent", Color3.fromRGB(75, 58, 130))
local repairButton = makeAction("Repair Tree")

local function setConnection(text, color)
    connectionStatus.Text = text
    connectionStatus.TextColor3 = color
end

local function setReport(text, color, duration)
    statusToken += 1
    local token = statusToken
    reportLabel.Text = text
    reportLabel.TextColor3 = color or Color3.fromRGB(180, 182, 190)
    if duration then
        task.delay(duration, function()
            if statusToken == token then
                reportLabel.Text = "Ready"
                reportLabel.TextColor3 = Color3.fromRGB(180, 182, 190)
            end
        end)
    end
end

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
    local lastError
    for attempt = 1, 3 do
        local success, result = pcall(function()
            return HttpService:RequestAsync({
                Url = getBaseUrl() .. path,
                Method = method or "GET",
                Headers = { ["Content-Type"] = "application/json" },
                Body = body and HttpService:JSONEncode(body) or nil
            })
        end)
        if success and result.Success then
            return HttpService:JSONDecode(result.Body)
        end
        lastError = success and result.StatusMessage or result
        if attempt < 3 then
            task.wait(0.35 * attempt)
        end
    end
    error("Morado request failed: " .. tostring(lastError))
end

local function connect()
    local success, result = pcall(function()
        return request("/api/health")
    end)
    if not success then
        connected = false
        setConnection("Disconnected", Color3.fromRGB(220, 110, 110))
        setReport("Connection failed", Color3.fromRGB(220, 110, 110), 3)
        return
    end
    connected = true
    revision = result.revision or 0
    setConnection("Connected", Color3.fromRGB(110, 220, 140))
    setReport("Connected to protocol " .. tostring(result.protocol), Color3.fromRGB(110, 220, 140), 3)
end

local function splitPath(path)
    local parts = {}
    for part in string.gmatch(path, "[^/]+") do
        table.insert(parts, part)
    end
    return parts
end

local function instancePath(update)
    local parts = splitPath(update.path)
    if update.className == "Folder" then
        return update.path
    end
    local last = parts[#parts]
    if string.match(last, "%.morado%.json$") then
        parts[#parts] = string.gsub(last, "%.morado%.json$", "")
    elseif string.match(last, "%.module%.lua$") or string.match(last, "%.server%.lua$") or string.match(last, "%.client%.lua$") then
        if last == "init.module.lua" then
            table.remove(parts, #parts)
        else
            parts[#parts] = string.gsub(last, "%.server%.lua$", "")
            parts[#parts] = string.gsub(parts[#parts], "%.client%.lua$", "")
            parts[#parts] = string.gsub(parts[#parts], "%.module%.lua$", "")
        end
    end
    return table.concat(parts, "/")
end

local function getOrCreateParent(pathParts)
    local parent = serviceRoots[pathParts[1]]
    if not parent then
        error("Morado does not recognize service " .. tostring(pathParts[1]))
    end
    for index = 2, #pathParts do
        local child = parent:FindFirstChild(pathParts[index])
        if not child then
            child = Instance.new("Folder")
            child.Name = pathParts[index]
            child:SetAttribute("MoradoManaged", true)
            child.Parent = parent
        end
        parent = child
    end
    return parent
end

local function convertInstance(parent, name, className)
    local instance = parent:FindFirstChild(name)
    if instance and instance.ClassName == className then
        return instance, false, false
    end
    local children = {}
    if instance then
        for _, child in ipairs(instance:GetChildren()) do
            table.insert(children, child)
        end
        instance:Destroy()
    end
    instance = Instance.new(className)
    instance.Name = name
    instance:SetAttribute("MoradoManaged", true)
    instance.Parent = parent
    for _, child in ipairs(children) do
        child.Parent = instance
    end
    return instance, true, instance ~= nil
end

local function applyUpdate(update, desired, report)
    local parts = splitPath(update.path)
    if #parts < 1 then
        error("Invalid Morado path")
    end
    local path = instancePath(update)
    local pathParts = splitPath(path)
    local name = pathParts[#pathParts]
    table.remove(pathParts, #pathParts)
    local parent = getOrCreateParent(pathParts)
    local className = update.className
    if className == "Folder" then
        className = "Folder"
    elseif className == "Object" then
        local metadata = HttpService:JSONDecode(update.content)
        className = metadata.className or "Folder"
    end
    local instance, replaced = convertInstance(parent, name, className)
    instance:SetAttribute("MoradoManaged", true)
    if update.className == "Script" or update.className == "LocalScript" or update.className == "ModuleScript" then
        instance.Source = update.content
    end
    if update.className == "Object" then
        local metadata = HttpService:JSONDecode(update.content)
        for property, value in pairs(metadata.properties or {}) do
            if type(value) == "table" and value.__type == "Color3" then
                value = Color3.new(value.r, value.g, value.b)
            elseif type(value) == "table" and value.__type == "Vector3" then
                value = Vector3.new(value.x, value.y, value.z)
            elseif type(value) == "table" and value.__type == "CFrame" then
                value = CFrame.new(table.unpack(value.components))
            elseif type(value) == "table" and value.__type == "EnumItem" then
                local enumType = Enum[value.enumType]
                value = enumType and enumType[value.name]
            end
            pcall(function()
                instance[property] = value
            end)
        end
    end
    desired[path] = true
    if replaced then
        report.replaced += 1
    elseif instance:GetAttribute("MoradoSyncedRevision") == revision then
        report.updated += 1
    else
        report.created += 1
    end
    instance:SetAttribute("MoradoSyncedRevision", revision)
end

local function collectManaged(rootInstance, path, result)
    for _, child in ipairs(rootInstance:GetChildren()) do
        local childPath = path .. "/" .. child.Name
        if child:GetAttribute("MoradoManaged") then
            result[childPath] = child
        end
        collectManaged(child, childPath, result)
    end
end

local function reconcile(desired, report)
    for serviceName, service in pairs(serviceRoots) do
        local existing = {}
        collectManaged(service, serviceName, existing)
        for path, instance in pairs(existing) do
            if not desired[path] then
                instance:Destroy()
                report.deleted += 1
            end
        end
    end
end

local function sync()
    if syncing then
        return
    end
    syncing = true
    local success, report = pcall(function()
        local message = request("/api/sync")
        local updates = message.updates or {}
        local desired = {}
        local result = {
            created = 0,
            updated = 0,
            replaced = 0,
            deleted = 0,
            skipped = 0
        }
        ChangeHistoryService:SetWaypoint("Morado sync started")
        table.sort(updates, function(left, right)
            local leftDepth = #splitPath(instancePath(left))
            local rightDepth = #splitPath(instancePath(right))
            return leftDepth == rightDepth and left.path < right.path or leftDepth < rightDepth
        end)
        for _, update in ipairs(updates) do
            local updateSuccess = pcall(applyUpdate, update, desired, result)
            if not updateSuccess then
                result.skipped += 1
            end
        end
        reconcile(desired, result)
        ChangeHistoryService:SetWaypoint("Morado sync complete")
        revision = message.revision or revision
        return result
    end)
    if success then
        setConnection("Connected", Color3.fromRGB(110, 220, 140))
        setReport(
            "Synced  Created " .. tostring(report.created) ..
            "  Updated " .. tostring(report.updated) ..
            "  Replaced " .. tostring(report.replaced) ..
            "  Deleted " .. tostring(report.deleted) ..
            "  Skipped " .. tostring(report.skipped),
            report.skipped > 0 and Color3.fromRGB(235, 190, 100) or Color3.fromRGB(110, 220, 140),
            3
        )
    else
        connected = false
        setConnection("Disconnected", Color3.fromRGB(220, 110, 110))
        setReport("Sync failed", Color3.fromRGB(220, 110, 110), 3)
    end
    syncing = false
end

local function encodeValue(value)
    local valueType = typeof(value)
    if valueType == "Color3" then
        return {
            __type = "Color3",
            r = value.R,
            g = value.G,
            b = value.B
        }
    elseif valueType == "Vector3" then
        return {
            __type = "Vector3",
            x = value.X,
            y = value.Y,
            z = value.Z
        }
    elseif valueType == "CFrame" then
        local components = { value:GetComponents() }
        return {
            __type = "CFrame",
            components = components
        }
    elseif valueType == "EnumItem" then
        return {
            __type = "EnumItem",
            enumType = value.EnumType.Name,
            name = value.Name
        }
    elseif type(value) == "string" or type(value) == "number" or type(value) == "boolean" then
        return value
    end
    return nil
end

local function readProperty(instance, property)
    local success, value = pcall(function()
        return instance[property]
    end)
    if success then
        return encodeValue(value)
    end
    return nil
end

local function encodeObject(instance)
    local properties = {
        Name = instance.Name
    }
    local propertyNames = {
        "AnimationId",
        "MeshId",
        "TextureID",
        "TextureId",
        "Color",
        "Material",
        "Transparency",
        "Reflectance",
        "CastShadow",
        "DoubleSided",
        "Anchored",
        "CanCollide",
        "CanTouch",
        "CanQuery",
        "Massless",
        "Size",
        "CFrame",
        "AlphaMode",
        "ColorMap",
        "EmissiveMaskContent",
        "EmissiveTintColor",
        "MetalnessMap",
        "NormalMap",
        "RoughnessMap"
    }
    for _, property in ipairs(propertyNames) do
        local value = readProperty(instance, property)
        if value ~= nil then
            properties[property] = value
        end
    end
    return HttpService:JSONEncode({
        className = instance.ClassName,
        properties = properties
    })
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
        elseif child.ClassName ~= "Folder" then
            table.insert(result, { path = path .. ".morado.json", className = "Object", content = encodeObject(child) })
        end
        collect(child, path, result)
    end
end

local function getServicePath(instance)
    local parts = {}
    local current = instance
    while current and current ~= game do
        table.insert(parts, 1, current.Name)
        if serviceRoots[current.Name] == current then
            return table.concat(parts, "/"), current
        end
        current = current.Parent
    end
    return nil, nil
end

local function collectCurrent(instance, path, result)
    if instance:IsA("Script") then
        table.insert(result, { path = path .. ".server.lua", className = "Script", content = instance.Source })
    elseif instance:IsA("LocalScript") then
        table.insert(result, { path = path .. ".client.lua", className = "LocalScript", content = instance.Source })
    elseif instance:IsA("ModuleScript") then
        table.insert(result, { path = path .. ".module.lua", className = "ModuleScript", content = instance.Source })
    elseif instance.ClassName ~= "Folder" then
        table.insert(result, { path = path .. ".morado.json", className = "Object", content = encodeObject(instance) })
    end
    for _, child in ipairs(instance:GetChildren()) do
        collectCurrent(child, path .. "/" .. child.Name, result)
    end
end

local function export()
    local success, result = pcall(function()
        local scripts = {}
        for name, service in pairs(services) do
            collect(service, name, scripts)
        end
        return request("/api/export", "POST", scripts)
    end)
    if success then
        setReport("Exported " .. tostring(result.count or 0) .. " source objects", Color3.fromRGB(110, 220, 140), 3)
    else
        setReport("Export failed", Color3.fromRGB(220, 110, 110), 3)
    end
end

local function exportCurrent()
    local instance = Selection:Get()[1]
    if not instance then
        setReport("Select an instance first", Color3.fromRGB(235, 190, 100), 3)
        return
    end
    local rootPath, service = getServicePath(instance)
    if not rootPath or not service then
        setReport("Selection is not under a supported service", Color3.fromRGB(220, 110, 110), 3)
        return
    end
    local scripts = {}
    collectCurrent(instance, rootPath, scripts)
    local success, result = pcall(function()
        return request("/api/export-current", "POST", {
            rootPath = rootPath,
            rootName = instance.Name,
            scripts = scripts
        })
    end)
    if success then
        setReport("ExportCurrent replaced " .. tostring(result.count or 0) .. " source objects", Color3.fromRGB(110, 220, 140), 3)
    else
        setReport("ExportCurrent failed", Color3.fromRGB(220, 110, 110), 3)
    end
end

local function repair()
    sync()
end

openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

connectButton.MouseButton1Click:Connect(connect)
syncButton.MouseButton1Click:Connect(sync)
exportButton.MouseButton1Click:Connect(export)
exportCurrentButton.MouseButton1Click:Connect(exportCurrent)
repairButton.MouseButton1Click:Connect(repair)

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
                setConnection("Disconnected", Color3.fromRGB(220, 110, 110))
            end
        end
    end
end)
