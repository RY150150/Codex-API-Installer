export {};

declare global {
  interface Window {
    codexAPI: {
      selectMsix(): Promise<string | null>;
      getVariant(): Promise<"original" | "manager">;
      readSource(): Promise<{ provider: string; model: string; baseUrl: string; protocol: "responses" | "chat"; configPath: string }>;
      fetchUpstreamModels(options: { baseUrl: string; apiKey: string }): Promise<string[]>;
      testUpstream(options: { baseUrl: string; apiKey: string; model: string; protocol: "auto" | "responses" | "chat" }): Promise<{ protocol: "responses" | "chat"; modelCount: number; message: string }>;
      listManagerProfiles(): Promise<ManagerProfile[]>;
      saveManagerProfile(profile: Omit<ManagerProfile, "id" | "updatedAt"> & { id?: string }): Promise<ManagerProfile>;
      deleteManagerProfile(id: string): Promise<ManagerProfile[]>;
      exportManagerProfiles(): Promise<string | null>;
      importManagerProfiles(): Promise<ManagerProfile[]>;
      managerDiagnostics(): Promise<ManagerDiagnostics>;
      clearManagerEnvironmentConflicts(names: string[]): Promise<string[]>;
      launchCurrentCodex(): Promise<string>;
      uninstallCodexCompletely(confirmation: string): Promise<{ ok: boolean; message: string }>;
      listConfigurationBackups(): Promise<{ name: string; createdAt: string }[]>;
      restoreConfigurationBackup(backupName: string): Promise<{ ok: boolean }>;
      configureSource(options: { provider: string; model: string; baseUrl: string; apiKey: string; protocol: "auto" | "responses" | "chat"; clearWebProfile: boolean; restart: boolean }): Promise<{ ok: boolean }>;
      install(options: InstallOptions): Promise<Verification>;
      verify(): Promise<Verification>;
      onInstallEvent(callback: (event: InstallEvent) => void): () => void;
    };
  }
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
  type Check = { label: string; ok: boolean; detail: string };
  type ManagerProfile = { id: string; name: string; provider: string; model: string; baseUrl: string; apiKey: string; protocol: "auto" | "responses" | "chat"; updatedAt: string };
  type ManagerDiagnostics = { configPath: string; configExists: boolean; authExists: boolean; relayInstalled: boolean; profileCount: number; environmentConflicts: string[] };
  type Verification = { ok: boolean; checks: Check[] };
  type InstallEvent =
    | { type: "log"; text: string }
    | { type: "status"; status: "running" | "success" | "warning"; verification?: Verification };
}
