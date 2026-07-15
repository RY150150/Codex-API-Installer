import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Eye, EyeOff, FileUp, FlaskConical, LoaderCircle, Play, Plus, RefreshCw, Save, ServerCog, Trash2, Undo2, XCircle } from "lucide-react";

type SourceConfig = { provider: string; model: string; baseUrl: string; protocol: "responses" | "chat"; configPath: string };
type Backup = { name: string; createdAt: string };

export default function SourceManager() {
  const [provider, setProvider] = useState("custom");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [protocol, setProtocol] = useState<"auto" | "responses" | "chat">("auto");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [clearWebProfile, setClearWebProfile] = useState(false);
  const [restart, setRestart] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState<SourceConfig | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [profiles, setProfiles] = useState<ManagerProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [diagnostics, setDiagnostics] = useState<ManagerDiagnostics | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallConfirmation, setUninstallConfirmation] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const loadCurrent = async () => {
    const value = await window.codexAPI.readSource();
    setCurrent(value);
    if (value.provider) setProvider(value.provider);
    if (value.model) setModel(value.model);
    if (value.baseUrl) setBaseUrl(value.baseUrl);
    setProtocol(value.protocol);
  };

  const loadBackups = async () => {
    const next = await window.codexAPI.listConfigurationBackups();
    setBackups(next);
    setSelectedBackup((selected) => next.some((item) => item.name === selected) ? selected : next[0]?.name || "");
  };

  const loadProfiles = async () => {
    const next = await window.codexAPI.listManagerProfiles();
    setProfiles(next);
    setSelectedProfile((selected) => next.some((item) => item.id === selected) ? selected : "");
  };

  const loadDiagnostics = async () => setDiagnostics(await window.codexAPI.managerDiagnostics());

  useEffect(() => { void loadCurrent(); void loadBackups(); void loadProfiles(); void loadDiagnostics(); }, []);
  useEffect(() => window.codexAPI.onInstallEvent((event) => {
    if (event.type === "log") setLogs((items) => [...items, event.text]);
  }), []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);

  const apply = async () => {
    setRunning(true); setLogs([]); setMessage(null);
    try {
      await window.codexAPI.configureSource({ provider, model, baseUrl, apiKey, protocol, clearWebProfile, restart });
      setApiKey("");
      setMessage({ ok: true, text: "模型来源已更新。" });
      await loadCurrent();
      await loadBackups();
      await loadDiagnostics();
    } catch (value) {
      setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) });
    } finally { setRunning(false); }
  };

  const selectProfile = (id: string) => {
    setSelectedProfile(id);
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setProvider(profile.provider); setModel(profile.model); setBaseUrl(profile.baseUrl); setApiKey(profile.apiKey); setProtocol(profile.protocol);
    setMessage({ ok: true, text: `已载入档案“${profile.name}”。` });
  };

  const saveProfile = async () => {
    const existing = profiles.find((item) => item.id === selectedProfile);
    const name = window.prompt("配置档案名称", existing?.name || `${provider}-${model}`);
    if (!name?.trim()) return;
    try {
      const saved = await window.codexAPI.saveManagerProfile({ id: existing?.id, name, provider, model, baseUrl, apiKey, protocol });
      await loadProfiles(); setSelectedProfile(saved.id); setMessage({ ok: true, text: `已保存档案“${saved.name}”。` });
    } catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const deleteProfile = async () => {
    const profile = profiles.find((item) => item.id === selectedProfile);
    if (!profile || !window.confirm(`删除档案“${profile.name}”？`)) return;
    try { await window.codexAPI.deleteManagerProfile(profile.id); await loadProfiles(); setMessage({ ok: true, text: "已删除配置档案。" }); }
    catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const testUpstream = async () => {
    setRunning(true); setLogs([]); setMessage(null);
    try {
      const result = await window.codexAPI.testUpstream({ baseUrl, apiKey, model, protocol });
      setMessage({ ok: true, text: `${result.message}${result.modelCount ? ` 已读取 ${result.modelCount} 个模型。` : ""}` });
    } catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
    finally { setRunning(false); }
  };

  const exportProfiles = async () => {
    try { const file = await window.codexAPI.exportManagerProfiles(); if (file) setMessage({ ok: true, text: "配置档案已导出。" }); }
    catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const importProfiles = async () => {
    try { await window.codexAPI.importManagerProfiles(); await loadProfiles(); setMessage({ ok: true, text: "配置档案已导入。" }); }
    catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const clearConflicts = async () => {
    if (!diagnostics?.environmentConflicts.length || !window.confirm("清理当前用户环境变量中的 API 配置？")) return;
    try { await window.codexAPI.clearManagerEnvironmentConflicts(diagnostics.environmentConflicts); await loadDiagnostics(); setMessage({ ok: true, text: "已清理环境变量冲突。" }); }
    catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const launchCurrent = async () => {
    try { setMessage({ ok: true, text: await window.codexAPI.launchCurrentCodex() }); }
    catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
  };

  const uninstallCompletely = async () => {
    if (uninstallConfirmation !== "UNINSTALL") return;
    setRunning(true); setLogs([]); setMessage(null);
    try {
      const result = await window.codexAPI.uninstallCodexCompletely(uninstallConfirmation);
      setMessage({ ok: result.ok, text: result.message });
      setUninstallOpen(false); setUninstallConfirmation("");
      await loadDiagnostics(); await loadProfiles(); await loadBackups();
    } catch (value) { setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) }); }
    finally { setRunning(false); }
  };

  const fetchModels = async () => {
    setLoadingModels(true); setMessage(null);
    try {
      const models = await window.codexAPI.fetchUpstreamModels({ baseUrl, apiKey });
      setModelOptions(models);
      if (!models.includes(model)) setModel(models[0]);
    } catch (value) {
      setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) });
    } finally { setLoadingModels(false); }
  };

  const restore = async () => {
    if (!selectedBackup) return;
    if (!window.confirm("恢复后将覆盖当前模型来源配置，并重新启动应用。是否继续？")) return;
    setRunning(true); setLogs([]); setMessage(null);
    try {
      await window.codexAPI.restoreConfigurationBackup(selectedBackup);
      setMessage({ ok: true, text: "已恢复所选历史配置，并重新启动应用。" });
      await loadCurrent();
      await loadBackups();
      await loadDiagnostics();
    } catch (value) {
      setMessage({ ok: false, text: value instanceof Error ? value.message : String(value) });
    } finally { setRunning(false); }
  };

  return <main>
    <header>
      <div className="mark"><ServerCog size={25} /></div>
      <div><h1>Codex 模型来源管理器</h1><p>修改当前用户的 Codex API 配置<br /><span className="signature">01出品，必属精品 · <a href="https://github.com/RY150150" target="_blank" rel="noreferrer">github.com/RY150150</a></span></p></div>
      <button className="icon-button header-action" onClick={() => { void loadCurrent(); void loadBackups(); void loadProfiles(); void loadDiagnostics(); }} title="重新读取管理器状态"><RefreshCw /></button>
    </header>

    <section>
      <div className="section-title"><span>1</span><div><h2>配置档案</h2><p>保存常用模型来源，随时切换。</p></div></div>
      <div className="input-action profile-picker">
        <select value={selectedProfile} onChange={(event) => selectProfile(event.target.value)}>
          <option value="">选择已保存的档案</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
        </select>
        <div className="icon-actions">
          <button className="icon-button" onClick={saveProfile} title="保存当前配置为档案"><Plus /></button>
          <button className="icon-button" onClick={deleteProfile} disabled={!selectedProfile} title="删除所选档案"><Trash2 /></button>
          <button className="icon-button" onClick={exportProfiles} title="导出档案"><Download /></button>
          <button className="icon-button" onClick={importProfiles} title="导入档案"><FileUp /></button>
        </div>
      </div>
    </section>

    <section>
      <div className="section-title"><span>2</span><div><h2>模型来源</h2><p>{current ? `当前：${current.provider || "未配置"} · ${current.model || "未设置模型"}` : "正在读取当前配置"}</p></div></div>
      <div className="field-grid">
        <label>Provider 标识<input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="custom" /></label>
        <label>模型名称<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如 gpt-4.1、qwen-plus" /></label>
      </div>
      <label>Base URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com/v1" /></label>
      <label>API Key</label>
      <div className="input-action">
        <input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="输入该来源的 API Key" autoComplete="off" />
        <button className="icon-button" onClick={() => setShowKey(!showKey)} title={showKey ? "隐藏密钥" : "显示密钥"}>{showKey ? <EyeOff /> : <Eye />}</button>
      </div>
      <div className="input-action">
        <select value="" onChange={(event) => { if (event.target.value) setModel(event.target.value); }} disabled={modelOptions.length === 0}>
          <option value="">{modelOptions.length ? "从上游列表选择模型" : "尚未读取上游模型列表"}</option>
          {modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="icon-button" disabled={loadingModels || !baseUrl.trim() || !apiKey.trim()} onClick={fetchModels} title="从上游获取模型"><Download /></button>
      </div>
    </section>

    <section>
      <div className="section-title"><span>3</span><div><h2>上游协议</h2><p>默认自动识别；特殊中转可手动指定。</p></div></div>
      <div className="segmented">
        <button className={protocol === "auto" ? "active" : ""} onClick={() => setProtocol("auto")}>自动识别</button>
        <button className={protocol === "responses" ? "active" : ""} onClick={() => setProtocol("responses")}>Responses API</button>
        <button className={protocol === "chat" ? "active" : ""} onClick={() => setProtocol("chat")}>Chat Completions</button>
      </div>
      <div className="advanced manager-options">
        <label className="check"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />配置后重新启动 Codex</label>
        <label className="check"><input type="checkbox" checked={clearWebProfile} onChange={(e) => setClearWebProfile(e.target.checked)} />清理旧网页配置</label>
      </div>
    </section>

    <section>
      <div className="section-title"><span>4</span><div><h2>历史配置</h2><p>每次保存前会自动备份，可随时恢复。</p></div></div>
      <div className="input-action">
        <select value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)} disabled={running || backups.length === 0}>
          {backups.length === 0 ? <option value="">暂无历史配置</option> : backups.map((backup) => <option key={backup.name} value={backup.name}>{backup.createdAt.slice(0, 8)} {backup.createdAt.slice(9, 11)}:{backup.createdAt.slice(11, 13)}:{backup.createdAt.slice(13, 15)}</option>)}
        </select>
        <button className="icon-button" disabled={running || !selectedBackup} onClick={restore} title="恢复所选历史配置"><Undo2 /></button>
      </div>
    </section>

    <section>
      <div className="section-title"><span>5</span><div><h2>应用配置</h2><p>保存前会自动创建可恢复的历史配置。</p></div></div>
      {(running || logs.length > 0) && <div className="console" ref={logRef}>{logs.join("") || "准备更新..."}</div>}
      {message && <div className={`message ${message.ok ? "success" : "error"}`}>{message.ok ? <CheckCircle2 /> : <XCircle />}{message.text}</div>}
      <div className="actions"><button className="secondary" disabled={running || !provider.trim() || !model.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={testUpstream}><FlaskConical />测试连接</button><button className="primary" disabled={running || !provider.trim() || !model.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={apply}>{running ? <LoaderCircle className="spin" /> : <Save />}{running ? "正在应用" : "保存并应用"}</button></div>
    </section>

    <section>
      <div className="section-title"><span>6</span><div><h2>维护与诊断</h2><p>检查本机配置和潜在环境变量冲突。</p></div></div>
      <div className="checks">
        <div className="check-row"><CheckCircle2 className={diagnostics?.configExists ? "ok" : "bad"} /><div><strong>Codex 配置</strong><small>{diagnostics?.configExists ? diagnostics.configPath : "未找到 config.toml"}</small></div></div>
        <div className="check-row"><CheckCircle2 className={diagnostics?.authExists ? "ok" : "bad"} /><div><strong>API 认证</strong><small>{diagnostics?.authExists ? "已配置 auth.json" : "未找到 auth.json"}</small></div></div>
        <div className="check-row"><CheckCircle2 className={diagnostics?.relayInstalled ? "ok" : "bad"} /><div><strong>本地 Relay</strong><small>{diagnostics?.relayInstalled ? "已安装 Chat Completions 转换服务" : "未安装或当前使用直连"}</small></div></div>
      </div>
      {diagnostics?.environmentConflicts.length ? <div className="message error"><XCircle />检测到环境变量可能覆盖当前配置：{diagnostics.environmentConflicts.join("、")}</div> : null}
      <div className="actions"><button className="secondary" onClick={() => void loadDiagnostics()}><RefreshCw />重新检查</button>{diagnostics?.environmentConflicts.length ? <button className="secondary" onClick={clearConflicts}>清理环境变量</button> : null}<button className="primary" onClick={launchCurrent}><Play />启动当前应用</button></div>
      <div className="actions danger-actions"><button className="danger" disabled={running} onClick={() => setUninstallOpen(true)}><Trash2 />彻底卸载 Codex</button></div>
    </section>
    {uninstallOpen && <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="uninstall-title"><h2 id="uninstall-title">彻底卸载 Codex</h2><p>将删除当前 Windows 用户的 Codex、配置、认证、备份、relay、网页数据、启动项和快捷方式。</p><label>输入 UNINSTALL 确认<input autoFocus value={uninstallConfirmation} onChange={(event) => setUninstallConfirmation(event.target.value)} /></label><div className="actions"><button className="secondary" onClick={() => { setUninstallOpen(false); setUninstallConfirmation(""); }}>取消</button><button className="danger" disabled={uninstallConfirmation !== "UNINSTALL" || running} onClick={uninstallCompletely}><Trash2 />确认卸载</button></div></div></div>}
  </main>;
}
