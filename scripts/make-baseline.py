"""產生報價引擎的 Python 基準輸出，供 JS 版做 parity 對照。

為什麼要這一步：JS 版重寫後，如果只靠「看起來對」就上線，總有一天會出現
「Python 版 551,527、JS 版 551,530」這種差三元的數字，客戶拿計算機一按就
發現了。所以先讓 Python 版吐出基準，JS 版逐欄位比對。

用法：python scripts/make-baseline.py
輸出：tests/fixtures/pricing-baseline.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOMIRA = Path(r"C:\Users\20744\Documents\deepseek-harness\default-workspace\Domira")
sys.path.insert(0, str(DOMIRA))

from core import hk_rules, pricing, schedule, schema  # noqa: E402

project = json.loads((DOMIRA / "data" / "sample_project.json").read_text(encoding="utf-8"))

def sched(has_elderly, needs_subsidy, exclude=()):
    """把一組排程條件的 compute 結果做成可序列化快照。"""
    tasks = schedule.build_tasks(
        has_elderly=has_elderly,
        needs_subsidy=needs_subsidy,
        exclude_trades=frozenset(exclude),
    )
    return schedule.compute(tasks)

out = {
    "project": project,
    "standard": pricing.estimate(project),
    "economy": pricing.estimate(project, profile="economy"),
    "essential": pricing.estimate(project, profile="essential"),
    "retrofit": pricing.estimate(project, profile="retrofit"),
    "retrofit_items": pricing.retrofit_line_items(project),
    "mode_comparison": pricing.mode_comparison(project),
    "scenarios": pricing.scenario_comparison(project),
    "schedule": {
        "full_elderly": sched(True, True),
        "full_elderly_no_subsidy": sched(True, False),
        "full_young": sched(False, True),
        "essential": sched(True, True, ("木工", "油漆", "門窗")),
        "retrofit": schedule.compute(schedule.build_retrofit_tasks()),
    },
    "hk": {
        "restricted": len(hk_rules.restricted_fixtures()),
        "free": len(hk_rules.free_to_change_fixtures()),
        "approval": len(hk_rules.approval_required_fixtures()),
        "subsidy": len(hk_rules.subsidy_items()),
        "direct": len(hk_rules.direct_subsidy_items()),
        "dimension": len(hk_rules.dimension_params()),
        "dim_categories": hk_rules.dimension_categories(),
        "compare": len(hk_rules.key_params_compare()),
        "sources": len(hk_rules.sources()),
        "compliance": len(hk_rules.compliance_documents()),
        "subsidy_rule_keys": list(hk_rules.subsidy_rules().keys()),
        "first_dimension": hk_rules.dimension_params()[0],
        "briefing_keys": list(hk_rules.briefing_for_prompt().keys()),
    },
    "schema_cases": {
        "缺欄位": schema.normalize("intake", {"summary": "ok"}),
        "型別錯": schema.normalize("layout", {
            "layout_strategy": ["不該是陣列"],
            "zones": "分區A、分區B",
            "storage_plan": [{"a": 1}],
            "circulation": "不是物件",
        }),
        "包裝清單": schema.normalize("aging", {
            "measures": {"items": [{"code": "handrail_bath"}]},
            "subsidy_plan": {"plan": "x"},
        }),
        "多餘欄位": schema.normalize("budget", {
            "verdict": "ok",
            "extra_note": "模型多給的",
        }),
        "頂層非物件": schema.normalize("vendor", ["not", "an", "object"]),
    },
}

dest = ROOT / "tests" / "fixtures"
dest.mkdir(parents=True, exist_ok=True)
file = dest / "pricing-baseline.json"
file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"已寫入 {file.relative_to(ROOT)}（{file.stat().st_size / 1024:.1f} KB）")
print(f"標準方案總額：{out['standard']['total']:,} HKD，{len(out['standard']['lines'])} 行")
print(f"改造方案總額：{out['retrofit']['total']:,} HKD")
