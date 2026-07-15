import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Download, Eye, EyeOff, FolderOpen, LoaderCircle, Play, ShieldCheck, Trash2, XCircle } from "lucide-react";
import SourceManager from "./SourceManager";

const sourcePresets = {
  deepseek: { label: "DeepSeek", provider: "deepseek", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1" },
  qwen: { label: "Qwen（阿里云百炼）", provider: "qwen", model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  openrouter: { label: "OpenRouter", provider: "openrouter", model: "openai/gpt-4.1-mini", baseUrl: "https://openrouter.ai/api/v1" },
  custom: { label: "自定义 / 中转 API", provider: "custom", model: "", baseUrl: "" },
};
type PresetId = keyof typeof sourcePresets;

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [msixPath, setMsixPath] = useState("");
  const [preset, setPreset] = useState<PresetId>("deepseek");
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [protocol, setProtocol] = useState<"auto" | "responses" | "chat">("auto");
  const [skipApiConfiguration, setSkipApiConfiguration] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [clearWebProfile, setClearWebProfile] = useState(true);
  const [skipInstall, setSkipInstall] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallConfirmation, setUninstallConfirmation] = useState("");
  const [variant, setVariant] = useState<"original" | "manager" | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.codexAPI.onInstallEvent((event) => {
    if (event.type === "log") setLogs((current) => [...current, event.text]);
  }), []);
  useEffect(() => {
    void window.codexAPI.getVariant().then((nextVariant) => {
      setVariant(nextVariant);
      document.title = nextVariant === "manager" ? "Codex 模型来源管理器" : "Codex API 安装器";
      setClearWebProfile(false);
    });
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);
  if (!variant) return <main><header><div className="mark"><ShieldCheck size={25} /></div><div><h1>正在加载</h1><p>读取工具模式</p></div></header></main>;
  if (variant === "manager") return <SourceManager />;

  const install = async () => {
    setRunning(true); setError(""); setResult(null); setLogs([]);
    try {
      setResult(await window.codexAPI.install({ apiKey, msixPath, provider, model, baseUrl, protocol, skipApiConfiguration, clearWebProfile, removeOldShortcuts: false, skipInstall }));
      setApiKey("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setRunning(false); }
  };

  const choosePreset = (id: PresetId) => {
    const next = sourcePresets[id];
    setPreset(id); setProvider(next.provider); setModel(next.model); setBaseUrl(next.baseUrl); setProtocol("auto");
  };

  const verify = async () => {
    setError("");
    try { setResult(await window.codexAPI.verify()); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  };

  const uninstallCompletely = async () => {
    if (uninstallConfirmation !== "UNINSTALL") return;
    setRunning(true); setError(""); setResult(null); setLogs([]);
    try {
      const result = await window.codexAPI.uninstallCodexCompletely(uninstallConfirmation);
      setResult({ ok: result.ok, checks: [{ label: "彻底卸载", ok: result.ok, detail: result.message }] });
      setUninstallOpen(false); setUninstallConfirmation("");
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setRunning(false); }
  };

  const fetchModels = async () => {
    setLoadingModels(true); setError("");
    try {
      const models = await window.codexAPI.fetchUpstreamModels({ baseUrl, apiKey });
      setModelOptions(models);
      if (!models.includes(model)) setModel(models[0]);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setLoadingModels(false); }
  };

  return <main>
    <header>
      <div className="mark"><ShieldCheck size={25} /></div>
      <div><h1>Codex API 安装器</h1><p>Windows 10/11 x64 · OpenAI 兼容 API<br /><span className="signature">01出品，必属精品 · <a href="https://github.com/RY150150" target="_blank" rel="noreferrer">github.com/RY150150</a></span></p></div>
      <span className="provider">CUSTOM API</span>
    </header>

    <section className="form-section">
      <div className="section-title"><span>1</span><div><h2>选择模型来源</h2><p>可选择常用服务商，也可填写自定义中转 API。</p></div></div>
      <label className="check"><input type="checkbox" checked={skipApiConfiguration} onChange={(event) => setSkipApiConfiguration(event.target.checked)} />暂不配置 API，先完成安装</label>
      <label>服务商</label>
      <select value={preset} disabled={skipApiConfiguration} onChange={(e) => choosePreset(e.target.value as PresetId)}>{Object.entries(sourcePresets).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select>
      <div className="field-grid">
        <label>Provider 标识<input disabled={skipApiConfiguration} value={provider} onChange={(e) => setProvider(e.target.value)} /></label>
        <label>模型名称<input disabled={skipApiConfiguration} value={model} onChange={(e) => setModel(e.target.value)} placeholder="输入服务商支持的模型名称" /></label>
      </div>
      <label>Base URL<input disabled={skipApiConfiguration} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com/v1" /></label>
      <label>API Key</label>
      <div className="input-action">
        <input disabled={skipApiConfiguration} type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="输入该来源的 API Key" autoComplete="off" />
        <button className="icon-button" disabled={skipApiConfiguration} onClick={() => setShowKey(!showKey)} title={showKey ? "隐藏密钥" : "显示密钥"}>{showKey ? <EyeOff /> : <Eye />}</button>
      </div>
      <div className="segmented installer-protocol">
        <button disabled={skipApiConfiguration} className={protocol === "auto" ? "active" : ""} onClick={() => setProtocol("auto")}>自动识别</button>
        <button disabled={skipApiConfiguration} className={protocol === "responses" ? "active" : ""} onClick={() => setProtocol("responses")}>Responses API</button>
        <button disabled={skipApiConfiguration} className={protocol === "chat" ? "active" : ""} onClick={() => setProtocol("chat")}>Chat Completions</button>
      </div>
      <div className="input-action">
        <select value="" onChange={(event) => { if (event.target.value) setModel(event.target.value); }} disabled={skipApiConfiguration || modelOptions.length === 0}>
          <option value="">{modelOptions.length ? "从上游列表选择模型" : "尚未读取上游模型列表"}</option>
          {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="icon-button" disabled={skipApiConfiguration || loadingModels || !baseUrl.trim() || !apiKey.trim()} onClick={fetchModels} title="从上游获取模型"><Download /></button>
      </div>
    </section>

    <section className="form-section">
      <div className="section-title"><span>2</span><div><h2>安装设置</h2><p>保留 Codex 原名称、原快捷方式和原界面。</p></div></div>
      <label>Codex Windows 安装包</label>
      <div className="input-action">
        <input value={msixPath} readOnly placeholder="使用同目录的 Codex-Windows-x64.msix，或手动选择" />
        <button className="icon-button" onClick={async () => { const file = await window.codexAPI.selectMsix(); if (file) setMsixPath(file); }} title="选择安装包"><FolderOpen /></button>
      </div>
      <details>
        <summary><ChevronDown size={17} />高级设置</summary>
        <div className="advanced">
          <label className="check"><input type="checkbox" checked={clearWebProfile} onChange={(e) => setClearWebProfile(e.target.checked)} />清理旧网页配置</label>
          <label className="check"><input type="checkbox" checked={skipInstall} onChange={(e) => setSkipInstall(e.target.checked)} />Codex 已安装，仅重新配置</label>
        </div>
      </details>
    </section>

    <section className="progress-section">
      <div className="section-title"><span>3</span><div><h2>安装与检查</h2><p>{running ? "正在安装，请不要关闭窗口。" : "安装完成后会自动检查关键组件。"}</p></div></div>
      {(running || logs.length > 0) && <div className="console" ref={logRef}>{logs.join("") || "准备安装..."}</div>}
      {error && <div className="message error"><XCircle />{error}</div>}
      {result && <div className="checks">{result.checks.map((item) => <div className="check-row" key={item.label}>{item.ok ? <CheckCircle2 className="ok" /> : <XCircle className="bad" />}<div><strong>{item.label}</strong><small>{item.detail}</small></div></div>)}</div>}
      <div className="actions">
        <button className="secondary" disabled={running} onClick={verify}>仅检查当前安装</button>
        <button className="primary" disabled={running || (!skipApiConfiguration && (!apiKey.trim() || !provider.trim() || !model.trim() || !baseUrl.trim()))} onClick={install}>{running ? <LoaderCircle className="spin" /> : <Play />} {running ? "安装中" : "开始安装"}</button>
      </div>
      <div className="actions danger-actions"><button className="danger" disabled={running} onClick={() => setUninstallOpen(true)}><Trash2 />彻底卸载 Codex</button></div>
    </section>
    {uninstallOpen && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="uninstall-title"><h2 id="uninstall-title">彻底卸载 Codex</h2><p>将删除当前 Windows 用户的 Codex、配置、认证、备份、relay、网页数据、启动项和快捷方式。</p><label>输入 UNINSTALL 确认<input autoFocus value={uninstallConfirmation} onChange={(event) => setUninstallConfirmation(event.target.value)} /></label><div className="actions"><button className="secondary" onClick={() => { setUninstallOpen(false); setUninstallConfirmation(""); }}>取消</button><button className="danger" disabled={uninstallConfirmation !== "UNINSTALL" || running} onClick={uninstallCompletely}><Trash2 />确认卸载</button></div></div></div>}
  </main>;
}
