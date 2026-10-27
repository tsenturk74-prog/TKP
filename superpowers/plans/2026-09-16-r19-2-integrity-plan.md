# TKP R19.2 Integrity + UI Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R19.1 tabanında veri/öğrenme/snapshot/cache doğruluğunu ve son UI taleplerini tek, testli R19.2 pakette birleştirmek.

**Architecture:** Yeni `tkp-r19-integrity-runtime.js` mevcut motorları koordine eder ve eski frozen veriyi leakage üretmeden onarır. UI davranışı son authoritative CSS ve hedefli controller değişiklikleriyle düzeltilir.

**Tech Stack:** Vanilla JS/HTML/CSS, IndexedDB segmented persistence, Python static regression tests, Node syntax checks.

**Spec:** `docs/superpowers/specs/2026-09-16-r19-2-integrity-design.md`

## Global Constraints
- Windows 8.1 / eski Opera-Chromium uyumluluğu.
- Sonuçtan sonra pre-race snapshot üretme yok.
- Veri değişmedikçe tekrar ağır hesap yok.
- R19.1 winner/BMB/ODB row priority korunacak.
- Final ZIP iki tur doğrulanacak.

---

### Task 1: Regression tests first
**Files:** Create `DOGRULAMA/test_r19_2_integrity_ui.py`, `DOGRULAMA/test_r19_2_runtime_unit.cjs`.
- [ ] Failing tests: immediate first-look confidence source, no fast placeholder, two-line supports, compact coupon chips, equal BMB/ODB badge geometry, file buttons fit, `% TEK` spacing, integrity script wiring.
- [ ] Run tests and confirm RED.

### Task 2: Integrity runtime
**Files:** Create `TKP/tkp-r19-integrity-runtime.js`; modify HTML script wiring.
- [ ] Implement pure key/dedupe/audit helpers.
- [ ] Implement cooperative TKP snapshot normalization and existing-forward evaluation repair.
- [ ] Implement sidebet resolver / weekly sync coordinator on outcome changes.
- [ ] Persist only changed collections.
- [ ] Run runtime unit tests GREEN.

### Task 3: First Look and performance critical path
**Files:** Modify active `app-controller-r1681-baseline-v24.js`.
- [ ] Fast first paint reads existing confidence snapshot / precomputed winner score instead of 5-minute placeholder.
- [ ] Context-upgrade does not force a second full synchronous prediction render while heavy background preparation is active.
- [ ] Add targeted light refresh path when safe.
- [ ] Run static/runtime tests GREEN.

### Task 4: Tracking/weekly freshness and diagnosis consistency
**Files:** Modify active controller + weekly tracker + V55 diagnostics only where needed.
- [ ] Neden Kaçtı shows latest evidence date and latest official result date distinctly.
- [ ] Existing pre-race rows are re-evaluated from official results; no post-race fake snapshot.
- [ ] Weekly post-race copy removes fixed 04.09 phrasing and reports dynamic dates.
- [ ] Diagnosis rows persist from resolved canonical coupon snapshots, not rendering side effects.

### Task 5: Final authoritative UI lock
**Files:** Modify `TKP_CORE_CLAUDE.html`.
- [ ] BMB/ODB badge same size; no Y.PU+X inner patch.
- [ ] Supports max two visible lines, no half clipping.
- [ ] Prediction side panels narrower/shorter.
- [ ] Coupon TEK smaller and >=4 horse chips per row at target desktop width.
- [ ] `% TEK` spacing rule.
- [ ] File action buttons single-row fit.
- [ ] Run UI contract GREEN.

### Task 6: Two-pass verification and packaging
- [ ] Run JS syntax over active JS files and Python tests.
- [ ] Run R18 model pytest suite.
- [ ] Verify HTML local script refs exist and active controller/runtime are wired.
- [ ] Generate manifest SHA256 and release notes.
- [ ] ZIP; test CRC.
- [ ] Extract ZIP to clean directory and rerun critical tests.
- [ ] Generate final ZIP SHA256.
