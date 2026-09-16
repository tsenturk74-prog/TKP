from pathlib import Path
import re

html = Path('TKP/TKP_CORE_CLAUDE.html').read_text(encoding='utf-8')
controller = Path('TKP/app-controller-r1681-baseline-v24.js').read_text(encoding='utf-8')
weekly = Path('TKP/weekly-model-tracker.js').read_text(encoding='utf-8')
v55 = Path('TKP/v55-live-diagnostics.js').read_text(encoding='utf-8')
ui = Path('TKP/ui-components.js').read_text(encoding='utf-8')
surprise = Path('TKP/surprise-cohort-tracker.js').read_text(encoding='utf-8')
version = Path('TKP/VERSION.txt').read_text(encoding='utf-8').strip()
freeze = Path('TKP/tkp-freeze-diagnostics.js').read_text(encoding='utf-8')

assert 'tkp-r19-integrity-runtime.js?v=r19.2-integrity' in html, 'R19.2 integrity runtime not wired'
assert 'Kupon hazırlığında hesaplanacak' not in controller, 'First Look still hides confidence behind coupon preparation'
assert 'tkpFastFirstLookConfidence' in controller, 'Fast First Look confidence helper missing'
assert '04.09 sonrasında' not in weekly, 'Weekly tracker still has hard-coded 04.09 copy'


# Future evidence must be captured before results, in background, so tracking/weekly tables advance.
assert 'function tkpSchedulePreRaceEvidenceCapture' in controller, 'Pre-race evidence scheduler missing'
assert 'tkpSchedulePreRaceEvidenceCapture(raceResults)' in controller, 'Prediction flow does not schedule pre-race evidence capture'
assert "tkpPersistCollections(['forward_tracking_log','weekly_model_log']" in controller, 'Pre-race evidence does not use targeted persistence'
assert "tkpPersistCollections(['forward_tracking_log']" in controller, 'Forward tracker still relies on whole-DB persistence'
assert 'global.__tkpBulkPipelineActive!==true' in weekly, 'Weekly sync can still trigger whole-DB save inside a bulk pipeline'
assert "tkpPersistCollections(['weekly_model_log','sidebet_ticket_log']" in weekly, 'Weekly tracker does not prefer targeted persistence'
assert "tkpPersistCollections(['surprise_cohort_tracking_log']" in surprise, 'Surprise cohort still relies on whole-DB persistence'

# Freshness must be visible and must not forge missing pre-race evidence.
assert 'Son resmî sonuç' in controller and 'Son kanıtlı yarış-öncesi takip' in controller, 'Forward tracking freshness evidence missing'
assert 'eksik yarış-öncesi snapshot sonradan üretilmez' in controller, 'Leakage-safe freshness warning missing'
assert 'Son resmî sonuç' in weekly and 'Son haftalık kanıt' in weekly, 'Weekly freshness evidence missing'

# Release identity must be one consistent R19.4 package identity while preserving R19.2 integrity runtime.
assert version == 'TKP CORE V1.1.333 · R19.4 X SHARE VIEWPORT FINAL', f'Unexpected VERSION.txt: {version}'
assert '<title>TKP CORE — V1.1.333 R19.4 X SHARE VIEWPORT FINAL</title>' in html
assert '<h1>🐎 TKP CORE V1.1.333 · R19.4 X SHARE VIEWPORT FINAL</h1>' in html
assert "const BUILD='R19.2-INTEGRITY-FINAL';" in freeze

start = html.rfind('<style id="r19-2-integrity-ui-lock">')
assert start >= 0, 'R19.2 final UI lock missing'
end = html.find('</style>', start)
block = html[start:end]

# BMB / ODB same badge geometry.
for cls in ['.bmbBadge', '.odbBadge']:
    assert cls in block, f'{cls} final geometry missing'
assert re.search(r'\.bmbBadge[^\{]*,\s*#tkpRoot[^\n]*\.odbBadge\s*\{[^}]*font-size:', block, re.S), 'BMB/ODB shared badge sizing missing'

# Y.PUAN must remain a plain value cell; signal squares/striped badges are not
# allowed to reappear in the renderer.
assert 'function ypuanSignalSquaresHTML' in ui, 'Y.PUAN renderer missing'
signal_fn = ui.split('function ypuanSignalSquaresHTML', 1)[1].split('function ypuanSourceTitle', 1)[0]
assert 'ypSignalSquare' not in signal_fn and 'ypuanSignalSquares' not in signal_fn, 'Y.PUAN signal squares still rendered'

# Supports can grow; no half clipping.
support = re.search(r'td\.supportCell \.supportBadges\s*\{([^}]*)\}', block, re.S)
assert support, 'supportBadges final rule missing'
rule = support.group(1)
assert 'overflow:visible' in rule, 'supports still clipped'
assert 'max-height:none' in rule, 'supports still capped and may be half-clipped'

# Coupon geometry: at least 4 chips per row and small TEK.
assert 'calc(25% - 3px)' in block, 'coupon chips not sized for >=4 per row'
tek = re.search(r'\.compactTek\s*\{([^}]*)\}', block, re.S)
assert tek and re.search(r'font-size:(?:7\.[0-9]|8(?:\.0)?)px', tek.group(1)), 'TEK font not compact enough'

# File action buttons are compact and no-wrap.
assert '.tkpFileActions' in block and 'flex-wrap:nowrap' in block, 'file action row fit lock missing'
assert '.fileActBtn' in block and 'white-space:nowrap' in block, 'file buttons can wrap'


# Right-side confidence card must use compact visible copy.
assert 'Tek eşiği:' not in ui, 'Right confidence panel still uses verbose TEK copy'
assert 'Kupon seçimi ham kuralla TEK; sonuç kanıtı henüz yeterli değil.' not in ui, 'Verbose low-evidence copy remains'
assert 'TEK <b style="color:#111827;">%${d.threshold}</b> · ham %${rawPct}' in ui, 'Compact confidence copy missing'
assert 'Ham TEK · kanıt yetersiz.' in ui, 'Compact low-evidence copy missing'

# Percent/TEK renderer must contain exactly a normal space before the TEK label.
assert '${pct} <small>TEK hata' in v55, 'Percent and TEK label still run together'
assert '${pct}<small>TEK hata' not in v55, 'Old no-space percent/TEK renderer still present'

# Live cumulative diagnosis must be derived from canonical coupon snapshots + official results;
# detailed rescue log may enrich it, but must not be the sole source.
assert 'tkpV55CanonicalLiveDiagnosticRows' in v55, 'Canonical live diagnosis aggregation missing'
assert 'auto_coupon_log + resmî sonuç' in v55, 'Canonical diagnosis provenance not shown'

# Diagnostic persistence must prefer collection-level persistence over whole DB save.
assert "tkpPersistCollections(['v55_diagnostic_log']" in v55, 'V55 diagnostics still force whole-DB persistence'

print('R19.4 integrity/UI contract: PASS')
