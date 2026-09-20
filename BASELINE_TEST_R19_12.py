from pathlib import Path
import re, sys, shutil, subprocess

ROOT=Path(__file__).resolve().parent
TKP=ROOT/'TKP'
HTML=TKP/'TKP_CORE_CLAUDE.html'
fail=[]
checks=0

def ck(cond,msg):
    global checks
    checks+=1
    if not cond: fail.append(msg)

def text(path): return path.read_text(encoding='utf-8',errors='replace')

html=text(HTML)
version=text(TKP/'VERSION.txt').strip()
ck('R19.12 BASELINE FINAL' in version,'VERSION identity')
ck('<title>TKP CORE — V1.1.333 R19.12 BASELINE FINAL</title>' in html,'HTML title identity')
ck('TKP CORE V1.1.333 · R19.12 BASELINE FINAL' in html,'visible H1 identity')
ck('id="r19-12-baseline-final-lock"' in html,'final UI cascade lock')
ck('compactTek{font-size:7.6px!important' in html,'small TEK label')
ck('background:#22c55e!important' in html,'vivid coupon green')
ck('border-left:0!important;border-right:0!important' in html,'continuous BMB/ODB row seams')

# Every active script src in HTML must exist.
for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']',html,re.I):
    rel=src.split('?',1)[0]
    ck((TKP/rel).is_file(),f'active script exists: {rel}')

race=text(TKP/'race-data.js')
ck(bool(re.search(r'if\(requested>=2\s*&&\s*count>6\)\s*return\s+lastSixStart',race)),'7+ race / 2nd six => last 6 invariant')
core=text(TKP/'core-utils.js')
ck('if(confirmed===rows.length) return \'🟢 OK\'' in core,'winner-complete file status invariant')

pred=text(TKP/'prediction-engine.js').lower()
coupon=text(TKP/'coupon-builder-r1681-baseline-v2.js').lower()
prob=text(TKP/'tkp-probability-portfolio-engine.js').lower()
for sig in ('bmb','ypuan','g800','jbyg','agf'):
    ck(sig in pred and sig in coupon,f'{sig} participates in prediction+coupon path')
for sig in ('bmb','odb','ypuan','g800','jbyg'):
    ck(sig in prob,f'{sig} participates in probability path')
ck('tr_ganyan' in pred and 'tr_ganyan' in coupon and 'gc_tr' in prob,'TR/GC-TR signal participates')

# Duplicate literal ids are a common silent UI-table failure source.
ids=re.findall(r'\bid=["\']([^"\']+)["\']',html,re.I)
seen=set(); dup=[]
for i in ids:
    if i in seen: dup.append(i)
    seen.add(i)
# TKP intentionally creates no duplicate static IDs in baseline shell.
ck(not dup,'no duplicate literal HTML ids'+(f' ({sorted(set(dup))[:8]})' if dup else ''))

# Optional JS parser check when Node is installed.
node=shutil.which('node')
if node:
    for js in sorted(TKP.glob('*.js')):
        p=subprocess.run([node,'--check',str(js)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        ck(p.returncode==0,f'JS syntax: {js.name}')

if fail:
    print(f'BASELINE FAIL: {len(fail)} / {checks} checks failed')
    for item in fail: print(' -',item)
    sys.exit(1)
print(f'BASELINE PASS: {checks}/{checks} checks')
