#!/usr/bin/env python3
"""Turn a clean checkout of main into a side-by-side development build.

Renames the Home Assistant integration domain, the app slug, the Supervisor
discovery service and the gateway port, so this build can run next to the
stable Eufy Mega Security release in the same Home Assistant instance.

Run from the repository root on a branch freshly created from main. If it
stops with an error, reset that branch with: git reset --hard && git clean -fd
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

OLD, NEW = "eufy_event_gateway", "eufy_mega_dev"
NEW_PORT = "3219"
PORT = re.compile(r"\b3218\b")
NAME = "Eufy Mega Security"
DEV_NAME = f"{NAME} (Dev)"

ROOT = pathlib.Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
OLD_INT = ROOT / "custom_components" / OLD
NEW_INT = ROOT / "custom_components" / NEW
APP = ROOT / OLD  # the app folder keeps its name; only its slug changes


def fail(message: str) -> None:
    sys.exit(f"ERROR: {message}\nReset this branch with: git reset --hard && git clean -fd")


def read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def replace(path: pathlib.Path, pattern, repl, label: str, *, minimum: int = 1, exact: int | None = None) -> None:
    regex = pattern if isinstance(pattern, re.Pattern) else re.compile(pattern, re.MULTILINE)
    new, count = regex.subn(repl, read(path))
    if count < minimum or (exact is not None and count != exact):
        fail(f"{label}: {count} match(es) in {path.relative_to(ROOT)}.")
    if count:
        write(path, new)
    print(f"  {path.relative_to(ROOT)}: {label} ({count})")


def rename_json_name(path: pathlib.Path, key: str, version_suffix: bool = False) -> None:
    data = json.loads(read(path))
    if data.get(key) == NAME:
        data[key] = DEV_NAME
    if version_suffix and not str(data.get("version", "")).endswith("-dev"):
        data["version"] = f"{data['version']}-dev"
    write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"  {path.relative_to(ROOT)}: {key}")


# Pre-flight checks
if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT, text=True).strip():
    fail("Tracked files have uncommitted changes.")
if not OLD_INT.is_dir() or NEW_INT.exists():
    fail("Integration folder not in its original state (already converted?).")

# 1) Integration: move the folder, then rename the domain and default port inside it
subprocess.run(["git", "mv", str(OLD_INT), str(NEW_INT)], cwd=ROOT, check=True)
for path in sorted(NEW_INT.rglob("*")):
    if path.is_file() and path.suffix in {".py", ".json", ".yaml", ".yml", ".md"}:
        text = read(path)
        new = PORT.sub(NEW_PORT, text.replace(OLD, NEW))
        if new != text:
            write(path, new)
print(f"  custom_components/{NEW}: domain and default port")
rename_json_name(NEW_INT / "manifest.json", "name", version_suffix=True)
for path in [NEW_INT / "strings.json", *sorted((NEW_INT / "translations").glob("*.json"))]:
    if path.exists():
        rename_json_name(path, "title")
for path in sorted((NEW_INT / "translation_sources").glob("*.yaml")):
    replace(path, rf"^title: {re.escape(NAME)}$", f"title: {DEV_NAME}", "title", minimum=0)
replace(NEW_INT / "config_flow.py", rf'title="{re.escape(NAME)}"', f'title="{DEV_NAME}"', "entry title")

# 2) Repository-wide path references to the integration folder
for rel in subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines():
    path = ROOT / rel
    if not path.is_file() or NEW_INT in path.parents:
        continue
    try:
        text = read(path)
    except UnicodeDecodeError:
        continue
    new = text.replace(f"custom_components/{OLD}", f"custom_components/{NEW}") \
              .replace(f"custom_components.{OLD}", f"custom_components.{NEW}")
    if new != text:
        write(path, new)
        print(f"  {rel}: integration path")

# 3) App: name, slug, discovery service, port and version
cfg = APP / "config.yaml"
replace(cfg, rf"^name: {re.escape(NAME)}$", f"name: {DEV_NAME}", "app name", exact=1)
replace(cfg, rf"^slug: {OLD}$", f"slug: {NEW}", "slug", exact=1)
replace(cfg, rf"^(\s+- ){OLD}$", rf"\g<1>{NEW}", "discovery service", exact=1)
replace(cfg, PORT, NEW_PORT, "port", minimum=4)
replace(cfg, r'^version: "?([^"\n]+?)"?$', lambda m: f'version: "{m.group(1)}-dev"', "version", exact=1)
for path in sorted((APP / "translations").glob("*.yaml")):
    replace(path, PORT, NEW_PORT, "port description", minimum=0)
run_sh = APP / "run.sh"
replace(run_sh, rf"--arg service {OLD}\b", f"--arg service {NEW}", "discovery service", exact=1)
replace(run_sh, PORT, NEW_PORT, "port", minimum=3)
replace(APP / "src/server.ts", f"/config/integrations/integration/{OLD}",
        f"/config/integrations/integration/{NEW}", "integration link", exact=1)

# 4) Store names
replace(ROOT / "repository.yaml", rf"^name: {re.escape(NAME)}$", f"name: {DEV_NAME}", "repository name", exact=1)
rename_json_name(ROOT / "hacs.json", "name")

# 5) Sanity checks
for path in NEW_INT.rglob("*.py"):
    compile(read(path), str(path), "exec")
leftovers = [f"{p.relative_to(ROOT)}:{i}" for p in [cfg, run_sh] + list(NEW_INT.rglob("*.py"))
             for i, line in enumerate(read(p).splitlines(), 1) if OLD in line]
if leftovers:
    print("WARNING: old name still present:", ", ".join(leftovers))
print(f"Done: {DEV_NAME}, domain {NEW}, port {NEW_PORT}.")