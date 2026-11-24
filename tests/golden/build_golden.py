"""Builds tests/golden/golden.xlsx: an independent, formula-only recomputation of the golden dataset.

Every expected value is an Excel formula over the blue input cells; nothing is copied from the engine
except the 'Engine value' column on the 'Engine check' sheet, which is what is being verified.
Run: <python with openpyxl> build_golden.py   (then evaluate_golden.py)
"""
import json
from datetime import date
from pathlib import Path
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

HERE = Path(__file__).parent
ENGINE = json.loads((HERE / "engine-values.json").read_text(encoding="utf-8"))

F = "Arial"
BLUE = Font(name=F, color="0000FF")
BLACK = Font(name=F, color="000000")
GREEN = Font(name=F, color="008000")
BOLD = Font(name=F, bold=True)
HEAD = Font(name=F, bold=True, color="FFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="262729")
INPUT_FILL = PatternFill("solid", fgColor="FFFF00")
THIN = Border(bottom=Side(style="thin", color="CAC6BB"))

wb = Workbook()

def header(ws, row, labels, widths=None):
    for i, label in enumerate(labels, start=1):
        c = ws.cell(row=row, column=i, value=label)
        c.font, c.fill = HEAD, HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(row=row, column=i).column_letter].width = w

# ---------------------------------------------------------------- Read me
rm = wb.active
rm.title = "Read me"
lines = [
    ("Portfolio Cockpit – golden dataset", BOLD),
    ("Purpose: recompute the cockpit's numbers with plain Excel formulas, independently of the app.", BLACK),
    ("How to use: change only blue cells (yellow fill = key assumption). Every other number is a formula.", BLACK),
    ("The 'Engine check' sheet compares each formula result with the value the app's engine produced for the same data.", BLACK),
    ("A FAIL means either the engine or the interpretation in docs/DECISIONS.md is wrong – decide which with the domain owner.", BLACK),
    ("Decisions pinned here: D2 (undated stories), D3 (linear split), D4 (T-shirt per quarter), D6/D7 (remaining work),", BLACK),
    ("D8 (quarter capacity incl. absence rate), D10 (support reserve), D11 (no-team demand), D13 (waterline status).", BLACK),
    ("Colours: blue = input, black = formula, green = link to another sheet.", BLACK),
    ("Source of inputs: tests/golden/golden.json in the repository (synthetic, realistic data).", BLACK),
]
for i, (t, f) in enumerate(lines, start=1):
    rm.cell(row=i, column=1, value=t).font = f
rm.column_dimensions["A"].width = 120

# ---------------------------------------------------------------- Inputs
inp = wb.create_sheet("Inputs")
header(inp, 1, ["Parameter", "Value", "Note"], [36, 16, 70])
inputs = [
    ("Today", date(2026, 11, 2), "Reference date of the dataset"),
    ("Q4 2026 start", date(2026, 10, 1), ""),
    ("Q4 2026 end", date(2026, 12, 31), ""),
    ("Q1 2027 start", date(2027, 1, 1), ""),
    ("Q1 2027 end", date(2027, 3, 31), ""),
    ("T-shirt S (h)", 120, "Configuration: T-shirt sizes"),
    ("T-shirt M (h)", 320, "Configuration: T-shirt sizes"),
    ("Weeks per quarter", 12, "Brief UC-11: weekly hours × 12 weeks"),
    ("Web: named weekly hours", 20, "Sum of maintained people in team Web"),
    ("Web: daily business %", 0.20, "Capacity editor, team Web"),
    ("Web: absence rate %", 0.10, "Capacity editor, team Web (D8: applied to quarters)"),
    ("Web: support reserve Q4 (h)", 60, "D10: average weekly support × 12"),
    ("Data: unnamed weekly hours", 20, "Capacity editor 'Unnamed h/wk', team Data"),
    ("Data: daily business %", 0, ""),
    ("Data: absence rate %", 0, ""),
    ("Waterline tolerance (h)", 0.01, "D13"),
]
for r, (name, val, note) in enumerate(inputs, start=2):
    inp.cell(row=r, column=1, value=name).font = BLACK
    c = inp.cell(row=r, column=2, value=val)
    c.font = BLUE
    if isinstance(val, date):
        c.number_format = "yyyy-mm-dd"
    elif isinstance(val, float) and val < 1:
        c.number_format = "0.0%"
    inp.cell(row=r, column=3, value=note).font = BLACK
for r in (11, 12, 15):
    inp.cell(row=r, column=2).fill = INPUT_FILL
TODAY, Q4S, Q4E, Q1S, Q1E = "Inputs!$B$2", "Inputs!$B$3", "Inputs!$B$4", "Inputs!$B$5", "Inputs!$B$6"

# ---------------------------------------------------------------- Stories
st = wb.create_sheet("Stories")
header(st, 1, ["Key", "Project", "Workstream", "Team", "Start", "Due", "Original Estimate (h)", "Remaining (h)", "Time Spent (h)",
               "Workstream's first open quarter (D2)", "Working days start→due", "OE in Q4 (h)", "OE in Q1 (h)", "RE in Q4 (h)", "RE in Q1 (h)"],
       [10, 10, 12, 9, 12, 12, 14, 12, 12, 18, 14, 12, 12, 12, 12])
stories = [
    ("TEL-12", "P1", "W1", "Web", date(2026, 11, 2), date(2026, 11, 27), 100, 40, 60, "Q4"),
    ("TEL-13", "P1", "W1", "", None, None, 50, 50, 0, "Q4"),
    ("TEL-22", "P2", "W2", "Web", date(2026, 11, 16), date(2026, 12, 18), 80, 80, 0, "Q4"),
    ("TEL-23", "P2", "W2", "Data", date(2027, 1, 11), date(2027, 1, 29), 40, 40, 0, "Q4"),
]
for r, s in enumerate(stories, start=2):
    for col, v in enumerate(s, start=1):
        c = st.cell(row=r, column=col, value=v)
        c.font = BLUE
        if isinstance(v, date):
            c.number_format = "yyyy-mm-dd"
    E, Fd, G, H = f"E{r}", f"F{r}", f"G{r}", f"H{r}"
    st[f"K{r}"] = f'=IF(OR({E}="",{Fd}=""),"",NETWORKDAYS({E},{Fd}))'
    # D3: OE split linearly over working days; D2: undated OE goes to the workstream's first open quarter.
    st[f"L{r}"] = f'=IF(K{r}="",IF(J{r}="Q4",{G},0),{G}*MAX(0,NETWORKDAYS(MAX({E},{Q4S}),MIN({Fd},{Q4E})))/K{r})'
    st[f"M{r}"] = f'=IF(K{r}="",IF(J{r}="Q1",{G},0),{G}*MAX(0,NETWORKDAYS(MAX({E},{Q1S}),MIN({Fd},{Q1E})))/K{r})'
    # D6/D7: remaining work from max(start, today) to due; overdue or undated remaining work counts now (Q4).
    st[f"N{r}"] = (f'=IF({Fd}="",{H},IF({Fd}<{TODAY},{H},{H}*MAX(0,NETWORKDAYS(MAX(MAX({E},{TODAY}),{Q4S}),MIN({Fd},{Q4E})))'
                   f'/NETWORKDAYS(MAX({E},{TODAY}),{Fd})))')
    st[f"O{r}"] = (f'=IF({Fd}="",0,IF({Fd}<{TODAY},0,{H}*MAX(0,NETWORKDAYS(MAX(MAX({E},{TODAY}),{Q1S}),MIN({Fd},{Q1E})))'
                   f'/NETWORKDAYS(MAX({E},{TODAY}),{Fd})))')
    for col in "KLMNO":
        st[f"{col}{r}"].font = BLACK
        st[f"{col}{r}"].number_format = "0.00"
st["J1"].comment = Comment("D2: stories without dates consume the T-shirt size of their workstream's first current/future target quarter.", "Portfolio Cockpit")

# ---------------------------------------------------------------- Projects
pj = wb.create_sheet("Projects")
header(pj, 1, ["Project", "Workstream", "T-shirt", "T-shirt (h)", "Target quarters", "Per quarter (h)", "Target Q4?", "Target Q1?", "Lead team",
               "OE consumed Q4", "OE consumed Q1", "Open T-shirt Q4", "Open T-shirt Q1", "Original Estimate", "Time Spent", "Remaining",
               "Open T-shirt total", "Progress", "Maturity", "Forecast", "Web demand Q4", "No-team demand Q4", "Data demand Q1"],
       [9, 11, 8, 10, 10, 11, 9, 9, 9, 11, 11, 11, 11, 11, 10, 10, 11, 10, 10, 10, 11, 12, 11])
projects = [("P1", "W1", "M", 2, 1, 1, "Web"), ("P2", "W2", "S", 1, 1, 0, "Web")]
for r, (p, w, size, nq, t4, t1, lead) in enumerate(projects, start=2):
    for col, v in zip("ABCEGHI", (p, w, size, nq, t4, t1, lead)):
        pj[f"{col}{r}"] = v
        pj[f"{col}{r}"].font = BLUE
    pj[f"D{r}"] = f'=IF(C{r}="M",Inputs!$B$8,IF(C{r}="S",Inputs!$B$7,0))'
    pj[f"F{r}"] = f"=D{r}/E{r}"  # D4: evenly over all target quarters
    pj[f"J{r}"] = f'=SUMIFS(Stories!$L:$L,Stories!$C:$C,B{r})'
    pj[f"K{r}"] = f'=SUMIFS(Stories!$M:$M,Stories!$C:$C,B{r})'
    pj[f"L{r}"] = f"=IF(G{r}=1,MAX(0,F{r}-J{r}),0)"
    pj[f"M{r}"] = f"=IF(H{r}=1,MAX(0,F{r}-K{r}),0)"
    pj[f"N{r}"] = f'=SUMIFS(Stories!$G:$G,Stories!$B:$B,A{r})'
    pj[f"O{r}"] = f'=SUMIFS(Stories!$I:$I,Stories!$B:$B,A{r})'
    pj[f"P{r}"] = f'=SUMIFS(Stories!$H:$H,Stories!$B:$B,A{r})'
    pj[f"Q{r}"] = f"=L{r}+M{r}"
    pj[f"R{r}"] = f"=IF(O{r}+P{r}+Q{r}=0,0,O{r}/(O{r}+P{r}+Q{r}))"
    pj[f"S{r}"] = f"=IF(N{r}+Q{r}=0,0,N{r}/(N{r}+Q{r}))"
    pj[f"T{r}"] = f"=O{r}+P{r}"
    # Demand = remaining work of the team's stories in the quarter + open T-shirt of workstreams it leads (D11).
    pj[f"U{r}"] = f'=SUMIFS(Stories!$N:$N,Stories!$B:$B,A{r},Stories!$D:$D,"Web")+IF(I{r}="Web",L{r},0)'
    pj[f"V{r}"] = f'=SUMPRODUCT((Stories!$B$2:$B$5=A{r})*(Stories!$D$2:$D$5="")*Stories!$N$2:$N$5)'
    pj[f"W{r}"] = f'=SUMIFS(Stories!$O:$O,Stories!$B:$B,A{r},Stories!$D:$D,"Data")+IF(I{r}="Data",M{r},0)'
    for col in "DFJKLMNOPQRSTUVW":
        pj[f"{col}{r}"].font = GREEN if col in "JKNOPUVW" else BLACK
        pj[f"{col}{r}"].number_format = "0.0%" if col in "RS" else "0.00"

# ---------------------------------------------------------------- Waterline
wl = wb.create_sheet("Waterline")
header(wl, 1, ["Row", "Demand (h)", "Cumulative (h)", "Capacity line (h)", "Status (D13)"], [22, 12, 14, 16, 14])
wl["A2"], wl["A3"], wl["A4"] = "Web Q4: Support (priority)", "Web Q4: #1 P1", "Web Q4: #2 P2"
wl["B2"], wl["B3"], wl["B4"] = "=Inputs!$B$13", "=Projects!U2", "=Projects!U3"
wl["D2"] = "=Inputs!$B$10*Inputs!$B$9*(1-Inputs!$B$11)*(1-Inputs!$B$12)"  # D8
wl["D3"] = wl["D4"] = "=$D$2"
wl["C2"] = "=B2"
wl["C3"] = "=C2+B3"
wl["C4"] = "=C3+B4"
wl["A6"], wl["A7"] = "Data Q1: Support (priority)", "Data Q1: #2 P2"
wl["B6"], wl["B7"] = 0, "=Projects!W3"
wl["D6"] = "=Inputs!$B$14*Inputs!$B$9*(1-Inputs!$B$15)*(1-Inputs!$B$16)"
wl["D7"] = "=$D$6"
wl["C6"], wl["C7"] = "=B6", "=C6+B7"
wl["B6"].font = BLUE
for r, prev in ((2, None), (3, "C2"), (4, "C3"), (6, None), (7, "C6")):
    prev_expr = prev if prev else "0"
    wl[f"E{r}"] = f'=IF(C{r}<=D{r}+Inputs!$B$17,"ok",IF({prev_expr}>=D{r}-Inputs!$B$17,"no","partial"))'
    for col in "BCD":
        wl[f"{col}{r}"].number_format = "0.00"

# ---------------------------------------------------------------- Engine check
ck = wb.create_sheet("Engine check")
header(ck, 1, ["Metric", "Spreadsheet (formula)", "Engine value", "Difference", "Result"], [40, 20, 16, 14, 10])
e1, e2 = ENGINE["issue:p1"], ENGINE["issue:p2"]
webq4 = ENGINE["wl"]["webQ4"]
dataq1 = ENGINE["wl"]["dataQ1"]
checks = [
    ("P1 Original Estimate", "=Projects!N2", e1["OE"]),
    ("P1 Time Spent", "=Projects!O2", e1["TS"]),
    ("P1 Remaining", "=Projects!P2", e1["RE"]),
    ("P1 open T-shirt Q4", "=Projects!L2", e1["openQ4"]),
    ("P1 open T-shirt Q1", "=Projects!M2", e1["openQ1"]),
    ("P1 progress", "=Projects!R2", e1["progress"]),
    ("P1 maturity", "=Projects!S2", e1["maturity"]),
    ("P1 forecast", "=Projects!T2", e1["forecast"]),
    ("P1 Web demand Q4", "=Projects!U2", e1["demandWebQ4"]),
    ("P1 no-team demand Q4", "=Projects!V2", e1["demandNoneQ4"]),
    ("P2 Original Estimate", "=Projects!N3", e2["OE"]),
    ("P2 open T-shirt Q4", "=Projects!L3", e2["openQ4"]),
    ("P2 progress", "=Projects!R3", e2["progress"]),
    ("P2 maturity", "=Projects!S3", e2["maturity"]),
    ("P2 Web demand Q4", "=Projects!U3", e2["demandWebQ4"]),
    ("P2 Data demand Q1", "=Projects!W3", e2["demandDataQ1"]),
    ("Web Q4 capacity", "=Waterline!D2", webq4["capacity"]),
    ("Web Q4 cumulative after #2", "=Waterline!C4", webq4["rows"][2]["cum"]),
    ("Data Q1 capacity", "=Waterline!D6", dataq1["capacity"]),
]
status_checks = [
    ("Web Q4 status #1", "=Waterline!E3", webq4["rows"][1]["status"]),
    ("Web Q4 status #2", "=Waterline!E4", webq4["rows"][2]["status"]),
    ("Data Q1 status #2", "=Waterline!E7", dataq1["rows"][1]["status"]),
]
r = 2
for name, formula, ev in checks:
    ck[f"A{r}"], ck[f"B{r}"], ck[f"C{r}"] = name, formula, ev
    ck[f"B{r}"].font, ck[f"C{r}"].font = GREEN, BLUE
    ck[f"D{r}"] = f"=B{r}-C{r}"
    ck[f"E{r}"] = f'=IF(ABS(D{r})<0.0001,"PASS","FAIL")'
    for col in "BCD":
        ck[f"{col}{r}"].number_format = "0.0000"
    r += 1
for name, formula, ev in status_checks:
    ck[f"A{r}"], ck[f"B{r}"], ck[f"C{r}"] = name, formula, ev
    ck[f"B{r}"].font, ck[f"C{r}"].font = GREEN, BLUE
    ck[f"E{r}"] = f'=IF(B{r}=C{r},"PASS","FAIL")'
    r += 1
ck[f"A{r + 1}"] = "Checks passed"
ck[f"B{r + 1}"] = f'=COUNTIF(E2:E{r - 1},"PASS")&" / "&COUNTA(E2:E{r - 1})'
ck[f"A{r + 1}"].font = ck[f"B{r + 1}"].font = BOLD
ck["C1"].comment = Comment("Engine value: produced by shared/engine.js for tests/golden/golden.json (the thing under test).", "Portfolio Cockpit")

for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if c.font and c.font.name != F:
                c.font = Font(name=F, bold=c.font.bold, color=c.font.color)
    ws.freeze_panes = "A2" if ws.title != "Read me" else None

out = HERE / "golden.xlsx"
wb.calculation.fullCalcOnLoad = True
wb.save(out)
print("written", out)
