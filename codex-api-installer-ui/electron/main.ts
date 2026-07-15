import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";

type InstallOptions = {
  apiKey: string;
  msixPath: string;
  provider: string;
  model: string;
  baseUrl: string;
  protocol: "auto" | "responses" | "chat";
  skipApiConfiguration: boolean;
  clearWebProfile: boolean;
  removeOldShortcuts: boolean;
  skipInstall: boolean;
};

type ProtocolChoice = "auto" | "responses" | "chat";
type ManagerProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  protocol: ProtocolChoice;
  updatedAt: string;
};

let mainWindow: BrowserWindow | null = null;
let installRunning = false;
const portableName = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const managerMode = /model(?:-|\s+)source(?:-|\s+)manager/i.test(path.basename(portableName));
const originalMode = !managerMode;

function payloadDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "payload")
    : path.resolve(__dirname, "..", "..");
}

function defaultMsixPath(): string {
  if (app.isPackaged) return path.join(path.dirname(portableName), "Codex-Windows-x64.msix");
  return path.resolve(__dirname, "..", "..", "Codex-API-Windows-Delivery", "Codex-Windows-x64.msix");
}

function profileStorePath(): string {
  return path.join(process.env.LOCALAPPDATA || os.homedir(), "CodexAPI", "manager-profiles.json");
}

function loadProfiles(): ManagerProfile[] {
  const store = profileStorePath();
  if (!fs.existsSync(store)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(store, "utf8")) as unknown;
    if (!Array.isArray(payload)) return [];
    return payload.filter((item): item is ManagerProfile =>
      !!item && typeof item === "object" && typeof (item as ManagerProfile).id === "string" && typeof (item as ManagerProfile).name === "string"
    );
  } catch { return []; }
}

function saveProfiles(profiles: ManagerProfile[]): void {
  const store = profileStorePath();
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify(profiles, null, 2), { encoding: "utf8", mode: 0o600 });
}

function normalizeProfile(input: Omit<ManagerProfile, "id" | "updatedAt">, id: string = randomUUID()): ManagerProfile {
  if (!input.name.trim()) throw new Error("请输入配置档案名称。");
  if (!/^[A-Za-z0-9_-]+$/.test(input.provider.trim())) throw new Error("Provider 只能包含字母、数字、下划线和连字符。");
  if (!input.model.trim() || !input.apiKey.trim()) throw new Error("模型名称和 API Key 不能为空。");
  const url = new URL(input.baseUrl.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL 必须使用 http 或 https。");
  return { ...input, id, name: input.name.trim(), provider: input.provider.trim(), model: input.model.trim(), baseUrl: input.baseUrl.trim(), apiKey: input.apiKey.trim(), updatedAt: new Date().toISOString() };
}

function send(value: object): void {
  mainWindow?.webContents.send("install-event", value);
}

function apiEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/${endpoint}`;
}

async function detectProtocol(baseUrl: string, apiKey: string, model: string): Promise<"responses" | "chat"> {
  const endpoint = apiEndpoint(baseUrl, "responses");
  send({ type: "log", text: `正在自动识别接口兼容方式：${endpoint}\n` });
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: "Reply OK.", max_output_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`无法连接模型服务：${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.ok) {
    send({ type: "log", text: "已识别为 Responses API，将直接连接。\n" });
    return "responses";
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`API Key 验证失败（HTTP ${response.status}）。`);
  }
  if (response.status === 404 || response.status === 405) {
    send({ type: "log", text: "未检测到 Responses API，自动启用 Chat Completions 兼容转换。\n" });
    return "chat";
  }

  const detail = (await response.text()).slice(0, 500);
  send({ type: "log", text: `Responses 探测返回 HTTP ${response.status}，按 Responses API 配置。${detail ? ` ${detail}` : ""}\n` });
  return "responses";
}

async function resolveProtocol(protocol: "auto" | "responses" | "chat", baseUrl: string, apiKey: string, model: string): Promise<"responses" | "chat"> {
  if (protocol === "auto") return detectProtocol(baseUrl, apiKey, model);
  send({ type: "log", text: `已按手动设置使用 ${protocol === "responses" ? "Responses API" : "Chat Completions"}。\n` });
  return protocol;
}

ipcMain.handle("fetch-upstream-models", async (_event, options: { baseUrl: string; apiKey: string }) => {
  let parsed: URL;
  try { parsed = new URL(options.baseUrl.trim()); } catch { throw new Error("Base URL 格式无效。"); }
  if (!options.apiKey.trim()) throw new Error("请输入 API Key 后再获取模型。");
  const endpoint = apiEndpoint(parsed.toString(), "models");
  send({ type: "log", text: `正在从上游读取模型列表：${endpoint}\n` });
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${options.apiKey.trim()}` }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new Error(`无法读取模型列表：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）。`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  const models = Array.isArray(payload.data) ? payload.data.map((item) => typeof item.id === "string" ? item.id : "").filter(Boolean) : [];
  if (models.length === 0) throw new Error("上游没有返回可用模型。");
  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
});

ipcMain.handle("list-manager-profiles", () => loadProfiles().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

ipcMain.handle("save-manager-profile", (_event, input: Omit<ManagerProfile, "id" | "updatedAt"> & { id?: string }) => {
  const profiles = loadProfiles();
  const existing = input.id ? profiles.find((item) => item.id === input.id) : undefined;
  const profile = normalizeProfile(input, existing?.id);
  const next = existing ? profiles.map((item) => item.id === profile.id ? profile : item) : [profile, ...profiles];
  saveProfiles(next);
  return profile;
});

ipcMain.handle("delete-manager-profile", (_event, id: string) => {
  const next = loadProfiles().filter((profile) => profile.id !== id);
  saveProfiles(next);
  return next;
});

ipcMain.handle("export-manager-profiles", async () => {
  const target = await dialog.showSaveDialog(mainWindow!, {
    title: "导出模型来源档案",
    defaultPath: "codex-model-profiles.json",
    filters: [{ name: "JSON 文件", extensions: ["json"] }],
  });
  if (target.canceled || !target.filePath) return null;
  fs.writeFileSync(target.filePath, JSON.stringify(loadProfiles(), null, 2), { encoding: "utf8", mode: 0o600 });
  return target.filePath;
});

ipcMain.handle("import-manager-profiles", async () => {
  const source = await dialog.showOpenDialog(mainWindow!, { title: "导入模型来源档案", properties: ["openFile"], filters: [{ name: "JSON 文件", extensions: ["json"] }] });
  if (source.canceled || !source.filePaths[0]) return loadProfiles();
  const payload = JSON.parse(fs.readFileSync(source.filePaths[0], "utf8")) as unknown;
  if (!Array.isArray(payload)) throw new Error("导入文件格式无效。");
  const existing = loadProfiles();
  const imported = payload.map((item) => normalizeProfile(item as Omit<ManagerProfile, "id" | "updatedAt">));
  const names = new Set(existing.map((profile) => profile.name));
  const unique = imported.map((profile) => {
    let name = profile.name;
    let index = 2;
    while (names.has(name)) name = `${profile.name} (${index++})`;
    names.add(name);
    return { ...profile, name };
  });
  const next = [...unique, ...existing];
  saveProfiles(next);
  return next;
});

ipcMain.handle("test-upstream", async (_event, options: { baseUrl: string; apiKey: string; model: string; protocol: ProtocolChoice }) => {
  if (!options.model.trim() || !options.apiKey.trim()) throw new Error("请输入模型名称和 API Key 后再测试。");
  const protocol = await resolveProtocol(options.protocol, options.baseUrl.trim(), options.apiKey.trim(), options.model.trim());
  if (protocol === "chat") {
    const response = await fetch(apiEndpoint(options.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model.trim(), messages: [{ role: "user", content: "Reply OK." }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Chat Completions 测试失败（HTTP ${response.status}）：${(await response.text()).slice(0, 300)}`);
  } else if (options.protocol === "responses") {
    const response = await fetch(apiEndpoint(options.baseUrl, "responses"), {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model.trim(), input: "Reply OK.", max_output_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Responses API 测试失败（HTTP ${response.status}）：${(await response.text()).slice(0, 300)}`);
  }
  let count = 0;
  try {
    const response = await fetch(apiEndpoint(options.baseUrl, "models"), { headers: { Authorization: `Bearer ${options.apiKey.trim()}` }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const payload = await response.json() as { data?: unknown[] };
      count = Array.isArray(payload.data) ? payload.data.length : 0;
    }
  } catch { /* Endpoint support is optional for compatible providers. */ }
  return { protocol, modelCount: count, message: protocol === "responses" ? "Responses API 直连可用。" : "Chat Completions 将通过本地 relay 连接。" };
});

ipcMain.handle("manager-diagnostics", () => {
  const codexHome = path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  const authPath = path.join(codexHome, "auth.json");
  const relayPath = path.join(process.env.LOCALAPPDATA || "", "CodexAPI", "DeepSeekRelay", "start_deepseek_relay.cmd");
  const conflictNames = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_BASE_URL", "DEEPSEEK_API_KEY"]
    .filter((name) => Boolean(process.env[name]));
  return {
    configPath,
    configExists: fs.existsSync(configPath),
    authExists: fs.existsSync(authPath),
    relayInstalled: fs.existsSync(relayPath),
    profileCount: loadProfiles().length,
    environmentConflicts: conflictNames,
  };
});

ipcMain.handle("clear-manager-environment-conflicts", async (_event, names: string[]) => {
  if (process.platform !== "win32") throw new Error("该功能只能在 Windows 中运行。");
  const allowed = new Set(["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_BASE_URL", "DEEPSEEK_API_KEY"]);
  const targets = names.filter((name) => allowed.has(name));
  if (!targets.length) return [];
  const command = targets.map((name) => `[Environment]::SetEnvironmentVariable('${name}',$null,'User');Remove-Item Env:${name} -ErrorAction SilentlyContinue`).join(";");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`环境变量清理失败，退出代码 ${code}`)));
  });
  return targets;
});

ipcMain.handle("launch-current-codex", async () => {
  if (process.platform !== "win32") throw new Error("该功能只能在 Windows 中运行。");
  spawn("explorer.exe", ["shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return "已请求启动 Codex。";
});

ipcMain.handle("uninstall-codex-completely", async (_event, confirmation: string) => {
  if (process.platform !== "win32") throw new Error("卸载功能只能在 Windows 10/11 x64 上运行。");
  if (confirmation !== "UNINSTALL") throw new Error("确认文本不正确，已取消卸载。");
  if (installRunning) throw new Error("已有任务正在运行。");
  const script = path.join(payloadDir(), "uninstall_codex_complete.ps1");
  if (!fs.existsSync(script)) throw new Error(`缺少卸载脚本：${script}`);
  installRunning = true;
  try {
    const result = await runPowerShell(script, ["-Confirm"]);
    if (result.code !== 0) throw new Error(`卸载失败，PowerShell 退出代码 ${result.code}。`);
    return { ok: true, message: "已卸载 Codex，并清除当前用户的本机数据。" };
  } finally { installRunning = false; }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#f4f5f2",
    title: managerMode ? "Codex 模型来源管理器" : "Codex API 安装器",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://github.com/RY150150") void shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

function runPowerShell(script: string, args: string[], stdin?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
      cwd: path.dirname(script),
      windowsHide: true,
    });
    let output = "";
    const capture = (chunk: Buffer) => {
      const line = chunk.toString("utf8").replace(/sk-[A-Za-z0-9_-]+/g, "***MASKED***");
      output += line;
      send({ type: "log", text: line });
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

ipcMain.handle("select-msix", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择 Codex Windows 安装包",
    properties: ["openFile"],
    filters: [{ name: "Windows 应用安装包", extensions: ["msix", "msixbundle", "appx", "appxbundle"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("get-variant", () => managerMode ? "manager" : "original");

ipcMain.handle("read-source", () => {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const provider = text.match(/^model_provider\s*=\s*"([^"]+)"/m)?.[1] || "";
  const model = text.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || "";
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = provider ? text.match(new RegExp(`\\[model_providers\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] || "" : "";
  let baseUrl = section.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1] || "";
  const protocol = baseUrl.startsWith("http://127.0.0.1:") ? "chat" : "responses";
  if (protocol === "chat") {
    const relayCmd = path.join(process.env.LOCALAPPDATA || "", "CodexAPI", "DeepSeekRelay", "start_deepseek_relay.cmd");
    if (fs.existsSync(relayCmd)) {
      const relayText = fs.readFileSync(relayCmd, "utf8");
      baseUrl = relayText.match(/--deepseek-base\s+"([^"]+)"/i)?.[1] || baseUrl;
    }
  }
  return { provider, model, baseUrl, protocol, configPath };
});

ipcMain.handle("list-configuration-backups", () => {
  const backupRoot = path.join(os.homedir(), ".codex", "backups");
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^configuration-\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => ({ name: entry.name, createdAt: entry.name.slice("configuration-".length) }))
    .sort((a, b) => b.name.localeCompare(a.name));
});

ipcMain.handle("restore-configuration-backup", async (_event, backupName: string) => {
  if (process.platform !== "win32") throw new Error("配置工具只能在 Windows 10/11 x64 上运行。");
  if (!/^configuration-\d{8}-\d{6}$/.test(backupName)) throw new Error("备份名称无效。");
  const script = path.join(payloadDir(), "restore_codex_configuration_backup.ps1");
  if (!fs.existsSync(script)) throw new Error(`缺少恢复脚本：${script}`);
  installRunning = true;
  try {
    const result = await runPowerShell(script, ["-BackupName", backupName]);
    if (result.code !== 0) throw new Error(`恢复失败，PowerShell 退出代码 ${result.code}。`);
    return { ok: true };
  } finally { installRunning = false; }
});

ipcMain.handle("configure-source", async (_event, options: {
  provider: string; model: string; baseUrl: string; apiKey: string; protocol: "auto" | "responses" | "chat"; clearWebProfile: boolean; restart: boolean;
}) => {
  if (process.platform !== "win32") throw new Error("配置工具只能在 Windows 10/11 x64 上运行。");
  if (!/^[A-Za-z0-9_-]+$/.test(options.provider.trim())) throw new Error("Provider 只能包含字母、数字、下划线和连字符。");
  let parsed: URL;
  try { parsed = new URL(options.baseUrl.trim()); } catch { throw new Error("Base URL 格式无效。"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Base URL 必须使用 http 或 https。");
  if (!options.apiKey.trim()) throw new Error("请输入 API Key。");
  const script = path.join(payloadDir(), "configure_codex_model_source.ps1");
  if (!fs.existsSync(script)) throw new Error(`缺少配置脚本：${script}`);
  const protocol = await resolveProtocol(options.protocol, options.baseUrl.trim(), options.apiKey.trim(), options.model.trim());
  const args = ["-BaseUrl", options.baseUrl.trim(), "-Model", options.model.trim(), "-Provider", options.provider.trim(), "-Protocol", protocol, "-ApiKeyStdin"];
  if (options.clearWebProfile) args.push("-ClearWebProfile");
  if (!options.restart) args.push("-NoLaunch");
  installRunning = true;
  try {
    const result = await runPowerShell(script, args, options.apiKey.trim());
    if (result.code !== 0) throw new Error(`配置失败，PowerShell 退出代码 ${result.code}。`);
    return { ok: true };
  } finally { installRunning = false; }
});

ipcMain.handle("install", async (_event, options: InstallOptions) => {
  if (installRunning) throw new Error("安装任务正在运行。");
  if (process.platform !== "win32") throw new Error("安装功能只能在 Windows 10/11 x64 上运行。");
  if (!options.skipApiConfiguration) {
    if (!options.apiKey.trim()) throw new Error("请输入 API Key。");
    if (!/^[A-Za-z0-9_-]+$/.test(options.provider.trim())) throw new Error("Provider 只能包含字母、数字、下划线和连字符。");
    try { new URL(options.baseUrl.trim()); } catch { throw new Error("Base URL 格式无效。"); }
  }

  const root = payloadDir();
  const script = path.join(root, "setup_codex_api.ps1");
  const msix = options.msixPath || defaultMsixPath();
  if (!fs.existsSync(script)) throw new Error(`缺少安装脚本：${script}`);
  if (!options.skipInstall && !fs.existsSync(msix)) throw new Error(`找不到安装包：${msix}`);

  const args = [
    "-MsixPath", msix,
    "-ApiKeyStdin",
  ];
  let protocol: "responses" | "chat" | null = null;
  if (options.skipApiConfiguration) {
    args.push("-SkipApiConfiguration");
  } else {
    args.push("-Provider", options.provider.trim(), "-Model", options.model.trim());
    protocol = await resolveProtocol(options.protocol, options.baseUrl.trim(), options.apiKey.trim(), options.model.trim());
    if (protocol === "chat") args.push("-UseDeepSeekRelay", "-DeepSeekBase", options.baseUrl.trim());
    else args.push("-BaseUrl", options.baseUrl.trim(), "-WireApi", "responses");
  }
  args.push("-KeepOriginalCodex");
  if (options.clearWebProfile) args.push("-ClearWebProfile");
  if (options.removeOldShortcuts) args.push("-RemoveOldShortcuts");
  if (options.skipInstall) args.push("-SkipInstall");

  installRunning = true;
  send({ type: "status", status: "running" });
  try {
    const result = await runPowerShell(script, args, options.apiKey.trim());
    if (result.code !== 0) throw new Error(`安装失败，PowerShell 退出代码 ${result.code}。`);
    const verification = await verifyInstallation(options.skipApiConfiguration ? "" : options.provider.trim(), protocol === "chat", options.skipApiConfiguration);
    send({ type: "status", status: verification.ok ? "success" : "warning", verification });
    return verification;
  } finally {
    installRunning = false;
  }
});

async function verifyInstallation(expectedProvider = "", expectRelay = false, apiSkipped = false): Promise<{ ok: boolean; checks: { label: string; ok: boolean; detail: string }[] }> {
  if (process.platform !== "win32") return { ok: false, checks: [{ label: "系统", ok: false, detail: "仅支持 Windows 10/11 x64" }] };
  const command = [
    "$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "$checks=@()",
    "$pkg=Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue",
    "$checks += [pscustomobject]@{label='Codex 安装';ok=[bool]$pkg;detail=if($pkg){$pkg.PackageFullName}else{'未找到'}}",
    "$cfg=Join-Path $HOME '.codex\\config.toml'",
    apiSkipped
      ? "$cfgOk=$true"
      : expectedProvider
      ? `$cfgOk=(Test-Path $cfg) -and ((Get-Content $cfg -Raw) -match 'model_provider\\s*=\\s*"${expectedProvider}"')`
      : "$cfgOk=(Test-Path $cfg) -and ((Get-Content $cfg -Raw) -match 'model_provider\\s*=')",
    apiSkipped
      ? "$checks += [pscustomobject]@{label='模型来源配置';ok=$cfgOk;detail='已跳过，可稍后配置'}"
      : "$checks += [pscustomobject]@{label='模型来源配置';ok=$cfgOk;detail=$cfg}",
    expectRelay
      ? "try{$h=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 5;$relay=[bool]$h.ok}catch{$relay=$false};$checks += [pscustomobject]@{label='接口转换服务';ok=$relay;detail='http://127.0.0.1:8787'}"
      : "$checks += [pscustomobject]@{label='Responses 直连';ok=$true;detail='不需要本地 relay'}",
    "$checks += [pscustomobject]@{label='原版 Codex 界面';ok=$true;detail='未安装 UI 注入'}",
    "$checks += [pscustomobject]@{label='官方快捷方式';ok=[bool](Get-StartApps|Where-Object AppID -match 'OpenAI\\.Codex'|Select-Object -First 1);detail='Codex Start Menu'}",
    "$checks | ConvertTo-Json -Compress",
  ].join(";");
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        const checks = Array.isArray(parsed) ? parsed : [parsed];
        resolve({ ok: checks.every((item) => item.ok), checks });
      } catch {
        resolve({ ok: false, checks: [{ label: "自动检查", ok: false, detail: stdout.trim() || "检查命令无返回" }] });
      }
    });
  });
}

ipcMain.handle("verify", () => verifyInstallation());

app.whenReady().then(() => {
  createWindow();
});
app.on("window-all-closed", () => app.quit());
