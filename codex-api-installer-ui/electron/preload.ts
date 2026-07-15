import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codexAPI", {
  selectMsix: () => ipcRenderer.invoke("select-msix"),
  getVariant: () => ipcRenderer.invoke("get-variant"),
  readSource: () => ipcRenderer.invoke("read-source"),
  fetchUpstreamModels: (options: unknown) => ipcRenderer.invoke("fetch-upstream-models", options),
  testUpstream: (options: unknown) => ipcRenderer.invoke("test-upstream", options),
  listManagerProfiles: () => ipcRenderer.invoke("list-manager-profiles"),
  saveManagerProfile: (profile: unknown) => ipcRenderer.invoke("save-manager-profile", profile),
  deleteManagerProfile: (id: string) => ipcRenderer.invoke("delete-manager-profile", id),
  exportManagerProfiles: () => ipcRenderer.invoke("export-manager-profiles"),
  importManagerProfiles: () => ipcRenderer.invoke("import-manager-profiles"),
  managerDiagnostics: () => ipcRenderer.invoke("manager-diagnostics"),
  clearManagerEnvironmentConflicts: (names: string[]) => ipcRenderer.invoke("clear-manager-environment-conflicts", names),
  launchCurrentCodex: () => ipcRenderer.invoke("launch-current-codex"),
  uninstallCodexCompletely: (confirmation: string) => ipcRenderer.invoke("uninstall-codex-completely", confirmation),
  listConfigurationBackups: () => ipcRenderer.invoke("list-configuration-backups"),
  restoreConfigurationBackup: (backupName: string) => ipcRenderer.invoke("restore-configuration-backup", backupName),
  configureSource: (options: unknown) => ipcRenderer.invoke("configure-source", options),
  install: (options: unknown) => ipcRenderer.invoke("install", options),
  verify: () => ipcRenderer.invoke("verify"),
  onInstallEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on("install-event", listener);
    return () => ipcRenderer.removeListener("install-event", listener);
  },
});
