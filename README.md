# Codex API Installer

面向 Windows 10/11 x64 的 Codex OpenAI 兼容 API 安装与模型来源管理工具。

本仓库只包含以下两个程序的源码：

- `Codex-API-Installer-1.0.0.exe`：保留 Codex 原名称、原快捷方式和原版界面，安装后连接自定义 OpenAI 兼容 API。
- `Codex-Model-Source-Manager-1.0.0.exe`：管理、测试、备份、恢复和切换 Codex 模型来源。

仓库不包含 Codex 官方 MSIX、预编译 exe、API Key 或用户配置。

## 致谢与引用

本项目在 Codex 配置管理与外部增强思路上同时参考和引用了 [BigPizzaV3/CodexPlusPlus](https://github.com/BigPizzaV3/CodexPlusPlus)，特别是其 `pureApi` 模型来源配置思路。感谢 CodexPlusPlus 作者及贡献者的开源工作。

CodexPlusPlus 使用 GNU AGPL-3.0 许可证。本项目以 GNU AGPL-3.0 许可证公开；详细条款见 `LICENSE`。本项目并非 OpenAI 官方项目，也不代表 CodexPlusPlus 原作者提供背书。

## 功能

- 安装或更新 Codex Windows MSIX
- 配置 Provider、Model、Base URL 与 API Key
- 自动识别 Responses API 和 Chat Completions
- 为 Chat Completions 上游安装本地兼容 relay
- 保存与切换多套模型来源档案
- 自动备份和恢复 Codex 配置
- 检查配置、认证、relay 与环境变量冲突

## 源码结构

```text
codex-api-installer-ui/            Electron + React + TypeScript 图形界面
  src/App.tsx                      Codex API 安装器界面
  src/SourceManager.tsx            模型来源管理器界面
  electron/main.ts                 Windows 安装与配置流程
  electron-builder.original.json  安装器构建配置
  electron-builder.manager.json   管理器构建配置
setup_codex_api.ps1                Codex API 安装入口
configure_codex_model_source.ps1   模型来源切换
prepare_codex_external_api.ps1     写入 Codex 配置与认证
install_codex_msix.ps1             安装或更新 MSIX
install_deepseek_relay.ps1         安装 Chat Completions 兼容 relay
restore_codex_configuration_backup.ps1  恢复历史配置
codex_api_switch.py                配置写入工具源码
deepseek_responses_proxy.py        relay 源码
```

## 构建

安装 Node.js 20 或更新版本，然后在 Windows PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows_exe.ps1
powershell -ExecutionPolicy Bypass -File .\build_gui_installer.ps1
```

图形程序也可分别构建：

```powershell
cd codex-api-installer-ui
npm install
npm run dist:original
npm run dist:manager
```

生成文件位于 `codex-api-installer-ui/release/`。

## 安全说明

- API Key 通过标准输入传给 PowerShell 子进程，日志不会主动输出密钥。
- 修改配置前会创建备份。
- 本项目不会修改或重新签名 Codex 官方 MSIX。

## 许可证

GNU Affero General Public License v3.0，详见 `LICENSE`。
