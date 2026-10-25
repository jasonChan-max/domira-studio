"""從 Domira 的 Python agents 抽出 system_prompt，生成 Worker 可 import 的 prompts.js。

為什麼用 AST 抽而不是手抄：
七個角色的提示詞加起來幾千字，手抄一定漏字或改標點；而提示詞一字之差
（例如把「不得說可以拆」寫成「不要拆」）就會改變模型的守法程度。
讓腳本抽，Python 版改了再跑一次即可。

用法：python scripts/sync-prompts.py
輸出：worker/agents/prompts.js
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOMIRA = Path(r"C:\Users\20744\Documents\deepseek-harness\default-workspace\Domira")
AGENTS = ["intake", "layout", "aging", "budget", "vendor", "schedule", "survey"]


def extract_prompt(path: Path) -> str:
    """找出 system_prompt 的最後一次賦值，支援 system_prompt = SYSTEM_PROMPT 的寫法。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))

    # 先收集模組級常量（SYSTEM_PROMPT = "..." 這類）
    consts: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if not isinstance(target, ast.Name):
                continue
            try:
                value = ast.literal_eval(node.value)
            except Exception:
                continue
            if isinstance(value, str):
                consts[target.id] = value

    def resolve(value_node) -> str | None:
        if isinstance(value_node, ast.Name):
            return consts.get(value_node.id)
        try:
            value = ast.literal_eval(value_node)
            return value if isinstance(value, str) else None
        except Exception:
            try:
                value = eval(compile(ast.Expression(value_node), "<prompt>", "eval"), {}, dict(consts))
                return value if isinstance(value, str) else None
            except Exception:
                return None

    found: list[str] = []
    for node in ast.walk(tree):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        for target in targets:
            name = None
            if isinstance(target, ast.Name):
                name = target.id
            elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self":
                name = target.attr
            if name != "system_prompt":
                continue
            value = resolve(node.value)
            if value:
                found.append(value)

    if not found:
        raise SystemExit(f"{path.name} 找不到 system_prompt")
    return found[-1]


prompts: dict[str, str] = {}
for name in AGENTS:
    path = DOMIRA / "agents" / f"{name}.py"
    prompts[name] = extract_prompt(path)
    print(f"{name}: {len(prompts[name])} 字")

dest = ROOT / "worker" / "agents" / "prompts.js"
body = (
    "// 由 scripts/sync-prompts.py 從 Domira/agents/*.py 抽出，勿手改\n"
    "export const PROMPTS = " + json.dumps(prompts, ensure_ascii=False) + ";\n"
)
dest.write_text(body, encoding="utf-8")
print(f"已寫入 {dest.relative_to(ROOT)}（{dest.stat().st_size / 1024:.1f} KB）")
