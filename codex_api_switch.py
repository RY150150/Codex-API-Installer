#!/usr/bin/env python3
"""
Switch Codex CLI/Desktop to an OpenAI-compatible API endpoint.

This mirrors the Codex++ manager "pureApi" behavior:
1. Back up ~/.codex/config.toml and ~/.codex/auth.json.
2. Write the API key to ~/.codex/auth.json as OPENAI_API_KEY.
3. Point ~/.codex/config.toml at a custom model provider.

The script intentionally does not print secrets.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import re
import shutil
import stat
import sys
import time
from pathlib import Path


PROVIDER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def toml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(value)).expanduser()


def detect_codex_home() -> Path:
    env_home = os.environ.get("CODEX_HOME")
    if env_home:
        return expand_path(env_home)

    home = Path.home()
    candidates = [home / ".codex"]
    if platform.system().lower() == "windows":
        userprofile = os.environ.get("USERPROFILE")
        appdata = os.environ.get("APPDATA")
        if userprofile:
            candidates.append(Path(userprofile) / ".codex")
        if appdata:
            candidates.append(Path(appdata) / "codex")
            candidates.append(Path(appdata) / "Codex")

    for candidate in candidates:
        if (candidate / "config.toml").exists() or (candidate / "auth.json").exists():
            return candidate
    return home / ".codex"


def split_toml_sections(text: str) -> tuple[list[str], dict[str, list[str]], list[str]]:
    preamble: list[str] = []
    sections: dict[str, list[str]] = {}
    order: list[str] = []
    current: str | None = None

    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            current = stripped
            if current not in sections:
                sections[current] = []
                order.append(current)
            sections[current].append(line)
        elif current is None:
            preamble.append(line)
        else:
            sections[current].append(line)

    return preamble, sections, order


def set_top_level_value(lines: list[str], key: str, value: str) -> None:
    prefix = f"{key} "
    replacement = f"{key} = {value}\n"
    for idx, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith(prefix) or stripped.startswith(f"{key}="):
            lines[idx] = replacement
            return
    lines.append(replacement)


def replace_section(section_lines: list[str], values: dict[str, str]) -> list[str]:
    header = section_lines[0] if section_lines else ""
    body = section_lines[1:] if section_lines else []
    seen: set[str] = set()
    out = [header]

    for line in body:
        stripped = line.lstrip()
        replaced = False
        for key, value in values.items():
            if stripped.startswith(f"{key} ") or stripped.startswith(f"{key}="):
                out.append(f"{key} = {value}\n")
                seen.add(key)
                replaced = True
                break
        if not replaced:
            out.append(line)

    if out and out[-1].strip():
        out.append("\n")
    for key, value in values.items():
        if key not in seen:
            out.append(f"{key} = {value}\n")
    return out


def update_config(
    config_path: Path,
    provider: str,
    base_url: str,
    model: str | None,
    reasoning_effort: str | None,
    wire_api: str,
) -> str:
    if not PROVIDER_NAME_RE.fullmatch(provider):
        raise ValueError("Provider name must contain only letters, numbers, underscore, or hyphen.")

    text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    preamble, sections, order = split_toml_sections(text)

    set_top_level_value(preamble, "model_provider", toml_quote(provider))
    if model:
        set_top_level_value(preamble, "model", toml_quote(model))
    if reasoning_effort:
        set_top_level_value(preamble, "model_reasoning_effort", toml_quote(reasoning_effort))

    provider_header = f"[model_providers.{provider}]"
    provider_values = {
        "name": toml_quote(provider),
        "wire_api": toml_quote(wire_api),
        "requires_openai_auth": "false",
        "base_url": toml_quote(base_url.rstrip("/")),
    }

    if provider_header in sections:
        sections[provider_header] = replace_section(sections[provider_header], provider_values)
    else:
        if "[model_providers]" not in sections:
            sections["[model_providers]"] = ["[model_providers]\n"]
            order.append("[model_providers]")
        sections[provider_header] = [f"{provider_header}\n"]
        sections[provider_header] = replace_section(sections[provider_header], provider_values)
        order.append(provider_header)

    out = "".join(preamble)
    if out and not out.endswith("\n"):
        out += "\n"
    for section in order:
        if out and not out.endswith("\n\n"):
            out += "\n"
        out += "".join(sections[section])
    return out


def backup_existing(codex_home: Path) -> Path:
    backup_dir = codex_home / "backups" / f"codex-api-live-{int(time.time() * 1000)}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    for name in ("config.toml", "auth.json"):
        src = codex_home / name
        if src.exists():
            shutil.copy2(src, backup_dir / name)
    return backup_dir


def write_private_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    tmp.write_text(text, encoding="utf-8")
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    tmp.replace(path)


def resolve_api_key(args: argparse.Namespace) -> str | None:
    if args.api_key:
        return args.api_key.strip()
    if args.api_key_stdin:
        return sys.stdin.read().strip()
    env_key = os.environ.get("OPENAI_API_KEY")
    if env_key:
        return env_key.strip()
    if sys.stdin.isatty() and not args.dry_run:
        return getpass.getpass("API key (hidden): ").strip()
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Configure Codex to use an OpenAI-compatible API endpoint on macOS, Windows, or Linux."
    )
    parser.add_argument("--base-url", help="Endpoint base URL, for example https://example.com/v1")
    parser.add_argument("--api-key", help="API key. If omitted, OPENAI_API_KEY is used.")
    parser.add_argument(
        "--api-key-stdin",
        action="store_true",
        help="Read the API key from stdin. Useful for scripts and avoids command history.",
    )
    parser.add_argument("--model", help="Optional model name to set in config.toml")
    parser.add_argument(
        "--reasoning-effort",
        choices=("minimal", "low", "medium", "high", "xhigh"),
        help="Optional model_reasoning_effort value",
    )
    parser.add_argument("--provider", default="custom", help="Provider table name. Default: custom")
    parser.add_argument("--wire-api", default="responses", choices=("responses", "chat"), help="Default: responses")
    parser.add_argument(
        "--codex-home",
        default=None,
        help="Codex home directory. Default: CODEX_HOME or the detected user Codex directory.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show target files and backup path without writing")
    parser.add_argument("--where", action="store_true", help="Print detected Codex paths and exit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    codex_home = expand_path(args.codex_home) if args.codex_home else detect_codex_home()
    config_path = codex_home / "config.toml"
    auth_path = codex_home / "auth.json"

    if args.where:
        print(f"Platform: {platform.system() or 'unknown'}")
        print(f"Codex home: {codex_home}")
        print(f"Config: {config_path}")
        print(f"Auth: {auth_path}")
        print(f"CODEX_HOME: {os.environ.get('CODEX_HOME', '') or '(not set)'}")
        return 0

    if not args.base_url:
        print("Missing --base-url. Use --where to inspect paths only.", file=sys.stderr)
        return 2

    api_key = resolve_api_key(args)
    if not api_key and not args.dry_run:
        print(
            "Missing API key: pass --api-key, set OPENAI_API_KEY, use --api-key-stdin, "
            "or run interactively.",
            file=sys.stderr,
        )
        return 2

    new_config = update_config(
        config_path=config_path,
        provider=args.provider,
        base_url=args.base_url,
        model=args.model,
        reasoning_effort=args.reasoning_effort,
        wire_api=args.wire_api,
    )
    new_auth = json.dumps({"OPENAI_API_KEY": api_key or "DRY_RUN_PLACEHOLDER"}, indent=2) + "\n"

    if args.dry_run:
        print(f"Would back up: {config_path} and {auth_path}")
        print(f"Would write provider: {args.provider}")
        print(f"Would write base_url: {args.base_url.rstrip('/')}")
        print("Would write auth.json with OPENAI_API_KEY: ***MASKED***")
        return 0

    backup_dir = backup_existing(codex_home)
    write_private_text(auth_path, new_auth)
    write_private_text(config_path, new_config)

    print(f"Backup: {backup_dir}")
    print(f"Updated: {auth_path}")
    print(f"Updated: {config_path}")
    print("API key: ***MASKED***")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
