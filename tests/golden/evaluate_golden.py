"""Evaluates golden.xlsx with an independent formula engine (`formulas`) and writes expected.json.

expected.json holds the spreadsheet's results; tests/golden.test.js asserts the app engine matches them.
"""
import json
from pathlib import Path
import formulas

HERE = Path(__file__).parent
xl = formulas.ExcelModel().loads(str(HERE / "golden.xlsx")).finish()
sol = xl.calculate()

def val(sheet, cell):
    for k, v in sol.items():
        if k.upper().endswith(f"[GOLDEN.XLSX]{sheet.upper()}'!{cell}") or k.upper().endswith(f"]{sheet.upper()}!{cell}"):
            x = v.value[0, 0]
            return x.item() if hasattr(x, "item") else x
    raise KeyError(f"{sheet}!{cell}")

results, fails = [], 0
for r in range(2, 40):
    try:
        name = val("Engine check", f"A{r}")
    except KeyError:
        continue
    if not isinstance(name, str) or not name:
        continue
    try:
        res = val("Engine check", f"E{r}")
    except KeyError:
        continue
    results.append({"metric": name, "spreadsheet": val("Engine check", f"B{r}"), "engine": val("Engine check", f"C{r}"), "result": res})
    fails += res != "PASS"
(HERE / "expected.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
for x in results:
    print(f"{x['result']:5} {x['metric']:32} sheet={x['spreadsheet']!s:>12} engine={x['engine']!s:>12}")
print(f"{len(results) - fails}/{len(results)} PASS")
