# -*- coding: utf-8 -*-
"""
TKP marjinal-kazanc genislik optimizasyonu — zaman-sirali (walk-forward) A/B backtest.

Amac: Kupon maliyetini (kolon carpimi butcesi) artirmadan 6/6 oranini yukseltmek.
Yontem:
  1) Her at icin yaris-oncesi ham sinyal: prediction_score_snapshot (dondurulmus
     yaris-oncesi model skoru; yoksa pre_result_score) + AGF yuzdesi.
     SONUC SIZINTISI YOK: kalibrasyon yalnizca test tarihinden ONCEKI yarislara
     fit edilir (walk-forward / strict chronology).
  2) Isotonic (PAVA) kalibrasyon: skor -> ampirik kazanma orani; AGF -> ampirik
     kazanma orani. Iki egri harmanlanir, yaris icinde normalize edilir.
  3) Politika: arsiv kuponunun kolon carpimi butcesi sabit tutulur. Greedy
     marjinal-kazanc (fractional knapsack, log-olasilik / log-maliyet orani)
     ile genislikler yeniden dagitilir.
     Varyantlar:
       - fixed_singles: TEK (genislik=1) ayaklar kilitli, digerleri taban 2.
       - conservative : fixed_singles + marjinal hamle esigi (ratio >= 0.30).
       - keep_picks   : fixed_singles + arsivdeki atlar korunur; bos slotlar
                        kalibre sirayla dolar (en az bozucu varyant).
       - pure         : kilit yok, butce tamamen yeniden dagitilir.
  4) Rapor: optimizer KAPALI (arsiv kuponu) vs ACIK -> 6/6, 5/6, ort. maliyet,
     donusturulen 5/6 sayisi, bozulan 6/6 sayisi, Wilson alt guven sinirlari.

Kullanim: python tools/tkp_marginal_gain_backtest.py [pkl_yolu]
"""
import pickle, sys, io, collections, math

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

PKL = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\beyha\AppData\Local\Temp\tkp_data.pkl"
MAX_WIDTH = 10
MIN_TEST_SHARE = 0.60  # son %40'lik dilim holdout; kalibrasyon her zaman gecmise fit


# ---------- yardimcilar ----------

def norm_no(no):
    return str(no).split("-")[0].strip()


def winner_nos(race):
    out = set()
    for h in race.get("horses", []):
        if h.get("winner") == 1 or h.get("finish_position") == 1:
            out.add(norm_no(h.get("horse_no")))
    return out


def raw_score(h):
    v = h.get("prediction_score_snapshot")
    if v is None:
        v = h.get("pre_result_score")
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def wilson_lower(hits, total, z=1.96):
    if total <= 0:
        return 0.0
    p = hits / total
    z2 = z * z
    return max(0.0, (p + z2 / (2 * total) - z * math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total))


# ---------- isotonic kalibrasyon (PAVA) ----------

def fit_isotonic(pairs):
    """pairs: [(x, y)] -> monoton non-decreasing blok listesi [(x0, x1, deger)]."""
    pts = sorted((x, y) for x, y in pairs if x is not None and y is not None)
    if not pts:
        return []
    agg = collections.defaultdict(lambda: [0.0, 0])
    for x, y in pts:
        agg[x][0] += y
        agg[x][1] += 1
    xs = sorted(agg)
    ys = [agg[x][0] / agg[x][1] for x in xs]
    ws = [float(agg[x][1]) for x in xs]
    stack_v, stack_w, stack_c = [], [], []
    for v, w in zip(ys, ws):
        stack_v.append(v)
        stack_w.append(w)
        stack_c.append(1)
        while len(stack_v) >= 2 and stack_v[-2] > stack_v[-1]:
            w2 = stack_w.pop() + stack_w[-1]
            v2 = (stack_v.pop() * (w2 - stack_w[-1]) + stack_v[-1] * stack_w[-1]) / w2
            stack_v[-1] = v2
            stack_w[-1] = w2
            c2 = stack_c.pop()
            stack_c[-1] += c2
    blocks = []
    xi = 0
    for v, c in zip(stack_v, stack_c):
        seg = xs[xi:xi + c]
        blocks.append((seg[0], seg[-1], v))
        xi += c
    return blocks


def isotonic_predict(blocks, x):
    if not blocks or x is None:
        return None
    if x <= blocks[0][0]:
        return blocks[0][2]
    if x >= blocks[-1][1]:
        return blocks[-1][2]
    for (x0, x1, v) in blocks:
        if x0 <= x <= x1:
            return v
    for i in range(len(blocks) - 1):
        a, b = blocks[i], blocks[i + 1]
        if a[1] < x < b[0]:
            t = (x - a[1]) / (b[0] - a[1])
            return a[2] + t * (b[2] - a[2])
    return blocks[-1][2]


# ---------- veri yukleme ----------

data = pickle.load(open(PKL, "rb"))
acl = data["auto_coupon_log"]
races = data["races"]

by_meeting = collections.defaultdict(dict)
for r in races:
    key = (r.get("race_date"), (r.get("hippodrome") or "").upper(), r.get("altili_no"))
    if r.get("leg"):
        by_meeting[key][r["leg"]] = r

calib_rows = []
for r in races:
    d = r.get("race_date")
    if not d:
        continue
    for h in r.get("horses", []):
        s = raw_score(h)
        if s is None:
            continue
        win = 1 if (h.get("winner") == 1 or h.get("finish_position") == 1) else 0
        try:
            agf = float(h.get("agf")) if h.get("agf") is not None else None
        except (TypeError, ValueError):
            agf = None
        calib_rows.append((d, s, agf, win))
calib_rows.sort(key=lambda t: t[0])

cases = []
for e in acl:
    key = (e.get("race_date"), (e.get("hippodrome") or "").upper(), e.get("altili_no"))
    lm = by_meeting.get(key)
    if not lm or len(lm) < 6:
        continue
    W, H = {}, {}
    ok = True
    for leg in range(1, 7):
        race = lm.get(leg)
        if not race:
            ok = False
            break
        w = winner_nos(race)
        hs = [h for h in race.get("horses", []) if raw_score(h) is not None]
        if not w or not hs:
            ok = False
            break
        W[leg] = w
        H[leg] = hs
    if not ok:
        continue
    for cname, coupon in (e.get("coupons") or {}).items():
        legs = coupon.get("legs") or []
        if len(legs) != 6:
            continue
        picks = [[norm_no(p) for p in lg.get("picks", [])] for lg in legs]
        if any(len(p) == 0 for p in picks):
            continue
        unit = float(coupon.get("unit") or 0)
        cases.append(dict(date=key[0], key=key, cname=cname, picks=picks,
                          unit=unit, cost=float(coupon.get("cost") or 0),
                          W=W, H=H))

cases.sort(key=lambda c: c["date"])
all_dates = sorted({c["date"] for c in cases})
cut_idx = max(1, int(len(all_dates) * MIN_TEST_SHARE))
test_start = all_dates[cut_idx]
print(f"toplanti tarihi: {len(all_dates)} | kupon: {len(cases)} | kalibrasyon gozlemi: {len(calib_rows)}")
print(f"walk-forward holdout baslangici: {test_start} (son %{int((1-MIN_TEST_SHARE)*100)} dilim)")


def hits_of(picks, W):
    return sum(1 for i in range(6) if set(picks[i]) & W[i + 1])


def product(widths):
    x = 1
    for w in widths:
        x *= w
    return x


# ---------- kalibre olasilik + greedy genislik optimizasyonu ----------

def build_calibrators(before_date):
    past = [r for r in calib_rows if r[0] < before_date]
    score_blocks = fit_isotonic([(s, w) for _, s, _, w in past])
    agf_blocks = fit_isotonic([(a, w) for _, _, a, w in past if a is not None])
    return score_blocks, agf_blocks


def calibrated_probs(horses, score_blocks, agf_blocks):
    raw = []
    for h in horses:
        ps = isotonic_predict(score_blocks, raw_score(h))
        agf = h.get("agf")
        try:
            agf = float(agf) if agf is not None else None
        except (TypeError, ValueError):
            agf = None
        pa = isotonic_predict(agf_blocks, agf) if agf is not None else None
        if ps is None and pa is None:
            p = 1.0 / max(1, len(horses))
        elif pa is None:
            p = ps
        elif ps is None:
            p = pa
        else:
            p = 0.5 * ps + 0.5 * pa
        raw.append((norm_no(h.get("horse_no")), max(1e-6, p)))
    total = sum(p for _, p in raw) or 1.0
    return {no: p / total for no, p in raw}


def greedy_widths(prob_orders, budget_combos, floors, caps, tau=0.0):
    widths = list(floors)

    def cov(i, w):
        return sum(p for _, p in prob_orders[i][:w])

    while True:
        cur = product(widths)
        best_i, best_ratio = -1, -1e18
        for i in range(6):
            w = widths[i]
            if w >= caps[i] or w >= len(prob_orders[i]):
                continue
            if cur // w * (w + 1) > budget_combos:
                continue
            gain = math.log(cov(i, w + 1)) - math.log(cov(i, w))
            cost = math.log((w + 1) / w)
            ratio = gain / cost
            # tau>0: yalniz kazanc/maliyet orani belirgin yuksek hamleler uygulanir
            if ratio < tau:
                continue
            if ratio > best_ratio + 1e-12:
                best_ratio, best_i = ratio, i
        if best_i < 0:
            break
        widths[best_i] += 1
    return widths


def run_policy(case, score_blocks, agf_blocks, mode):
    picks, W, H = case["picks"], case["W"], case["H"]
    base_widths = [len(p) for p in picks]
    budget = product(base_widths)
    prob_orders = []
    for leg in range(1, 7):
        pr = calibrated_probs(H[leg], score_blocks, agf_blocks)
        prob_orders.append(sorted(pr.items(), key=lambda kv: -kv[1]))
    tau = 0.0
    if mode == "fixed_singles":
        floors = [1 if base_widths[i] == 1 else 2 for i in range(6)]
    elif mode == "conservative":
        floors = [1 if base_widths[i] == 1 else 2 for i in range(6)]
        tau = 0.30
    elif mode == "keep_picks":
        floors = [1 if base_widths[i] == 1 else 2 for i in range(6)]
    else:  # pure
        floors = [1] * 6
    caps = [min(MAX_WIDTH, len(prob_orders[i])) for i in range(6)]
    if product(floors) > budget:
        return picks, base_widths
    widths = greedy_widths(prob_orders, budget, floors, caps, tau=tau)
    new_picks = []
    for i in range(6):
        w = widths[i]
        order = [no for no, _ in prob_orders[i]]
        if mode == "keep_picks":
            kept = [no for no in picks[i] if no in set(order)]
            kept.sort(key=lambda no: order.index(no))
            fill = [no for no in order if no not in set(kept)]
            new_picks.append((kept + fill)[:w])
        else:
            new_picks.append(order[:w])
    return new_picks, widths


def evaluate(subset, label):
    out = {}
    for mode in ("fixed_singles", "conservative", "keep_picks", "pure"):
        by_date = collections.defaultdict(list)
        for c in subset:
            by_date[c["date"]].append(c)
        conv = lost = opt6 = opt5 = 0
        base_cost = opt_cost = 0.0
        n = 0
        for d in sorted(by_date):
            sb, ab = build_calibrators(d)
            for c in by_date[d]:
                h0 = hits_of(c["picks"], c["W"])
                np_, widths = run_policy(c, sb, ab, mode)
                h1 = hits_of(np_, c["W"])
                if h0 == 5 and h1 == 6:
                    conv += 1
                if h0 == 6 and h1 < 6:
                    lost += 1
                opt6 += 1 if h1 == 6 else 0
                opt5 += 1 if h1 == 5 else 0
                base_cost += c["cost"] or 0
                opt_cost += (c["unit"] or 1) * product(widths)
                n += 1
        out[mode] = dict(n=n, hit6=opt6, hit5=opt5, conv=conv, lost=lost,
                         avg_base_cost=base_cost / max(1, n), avg_opt_cost=opt_cost / max(1, n))
    base6 = sum(1 for c in subset if hits_of(c["picks"], c["W"]) == 6)
    base5 = sum(1 for c in subset if hits_of(c["picks"], c["W"]) == 5)
    n = len(subset)
    print(f"\n=== {label} (n={n} kupon) ===")
    print(f"BASELINE  6/6: {base6} (%{100*base6/n:.1f}, WilsonLB %{100*wilson_lower(base6,n):.1f})  5/6: {base5} (%{100*base5/n:.1f})")
    for mode, r in out.items():
        wl = wilson_lower(r["hit6"], r["n"])
        print(f"OPT[{mode:13s}] 6/6: {r['hit6']} (%{100*r['hit6']/r['n']:.1f}, WilsonLB %{100*wl:.1f})  5/6: {r['hit5']} (%{100*r['hit5']/r['n']:.1f})"
              f"  5/6->6/6: {r['conv']}  bozulan 6/6: {r['lost']}  net: {r['conv']-r['lost']:+d}"
              f"  ort maliyet base {r['avg_base_cost']:.1f} -> opt {r['avg_opt_cost']:.1f}")
    return out


evaluate(cases, "TUM ARSIV (kalibrasyon walk-forward, sizintisiz)")
evaluate([c for c in cases if c["date"] >= test_start], "HOLDOUT (son %40)")
