from pathlib import Path
import re

html = Path('TKP/TKP_CORE_CLAUDE.html').read_text(encoding='utf-8')
start = html.rfind('<style id="r19-table-layout-authoritative-lock">')
assert start >= 0, 'R19 authoritative style block missing'
end = html.find('</style>', start)
block = html[start:end]

# BMB/ODB must paint the entire row, not just Y.PU+X.
assert re.search(r'tr\.real-bmb-row:not\(\.actualWinnerRow\)>td[^\{]*\{[^}]*background:#fff4c7', block, re.S), 'BMB full-row color missing'
assert re.search(r'tr\.odb-row:not\(\.actualWinnerRow\)>td[^\{]*\{[^}]*background:#e4faf6', block, re.S), 'ODB full-row color missing'

# No authoritative reset may turn BMB/ODB rows white.
assert not re.search(r'tr\.real-bmb-row:not\(\.actualWinnerRow\)[^\{]*\{[^}]*background:#fff(?:!|;)', block, re.S), 'BMB row reset to white still present'
assert not re.search(r'tr\.odb-row:not\(\.actualWinnerRow\)[^\{]*\{[^}]*background:#fff(?:!|;)', block, re.S), 'ODB row reset to white still present'

# Header labels must be readable and fit their own columns.
header_rule = re.search(r'\.proPredTable thead th\s*\{([^}]*)\}', block, re.S)
assert header_rule, 'header rule missing'
rule = header_rule.group(1)
font = re.search(r'font-size:([0-9.]+)px', rule)
assert font and float(font.group(1)) >= 9.2, f'header font too small: {font.group(1) if font else "missing"}'
assert 'text-overflow:clip' not in rule, 'header clipping still forced'
assert 'white-space:normal' in rule, 'headers are not allowed to wrap safely'

# Main table should get more space than previous 178px side panel layout.
workspace = re.search(r'\.predWorkspace\s*\{([^}]*)\}', block, re.S)
assert workspace, 'workspace rule missing'
assert '160px' in workspace.group(1), 'side panel not narrowed to 160px'

# Winner remains absolute priority.
assert 'tr.actualWinnerRow>td' in block and 'background:#dcfce7' in block, 'winner priority missing'
print('R19 row-wide/table UI contract: PASS')
