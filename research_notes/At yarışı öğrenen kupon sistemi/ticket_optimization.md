# Optimization of multi-leg pari-mutuel tickets and ticket sets (Altılı Ganyan / pick-6)

Evidence tags used throughout:
- **[RACING-MEASURED]**: results from real racing data or real pools.
- **[RACING-SIMULATED]**: racing inputs, but outcomes or the crowd are modelled.
- **[THEORY]**: a mathematical result.
- **[ANALOGY]**: measured or derived on lotteries, daily fantasy sports (DFS) or brackets, not on racing.
- **[NON-PEER-REVIEWED]**: column, blog, slides, marketing or news.

Depth of reading:
- Read in text extracted from the PDF or HTML: Hunter et al., Clair-Letscher, Moffitt-Ziemba, Kim-Skiena, the TJK bylaw, the Gramm slides.
- Read through a summarizing fetch, not line by line: Brill et al., Deza et al.
- **Abstract or listing only:** Hausch-Ziemba-Rubinstein, Hausch-Ziemba 1985, Asch-Quandt, Gramm et al. 2008, Ziemba's chapters, Kaplan-Garstka, Baker-McHale, Farrell et al.

## Published methods for pick-N: expected value, covering probability, carryover, popular combinations, dilution, consolation

### Takeaway
No peer-reviewed paper that I could read gives a closed-form optimal pick-6 ticket. The closest is Brill-Wyner-Barnett, a profit model with carryover and a crowd, solved heuristically. The other pieces (own-bet dilution, EV as a product of per-leg factors, crowd avoidance) come from single-race exotics, lotteries and bracket pools. Without a carryover the average bettor's expectation is 1 minus the takeout, so the edge must come from probabilities better than the crowd's.

### Cited Findings

**Pick-N specific**
- [RACING-SIMULATED] Brill, Wyner and Barnett state a pick-six profit model. Prize pool is T = C + (n+k)(1-α); profit is W/(W+W_opp)·T - n, where W and W_opp are own and opposing winning tickets. They use leg probabilities implied by odds for one Belmont card (21 May 2023) and an assumed crowd (not real public ticket data), with k=25,000, α=0.05, C=500,000. Tickets cost $1 in the model. — [Brill et al.](https://arxiv.org/html/2308.14339v3)
- [RACING-SIMULATED] In that model, optimal ticket entropy rises as the number of tickets n rises, and many tickets are very profitable with a large carryover. The paper gives this as figures of a lower bound on profit from a grid search, not as a backtest on payouts. — [Brill et al.](https://arxiv.org/html/2308.14339v3)
- [THEORY] Brill et al. note that optimizing over all sets of n tuples remains open and hard. Their method only picks the distribution from which independent tickets are drawn, and it assumes P and the crowd's distribution are known. — [Brill et al.](https://arxiv.org/html/2308.14339v3)
- [RACING-MEASURED, abstract only] Ziemba's chapter on the Pick 6 and Rainbow Pick 6 covers strategies for ordinary and forced-payout days. It describes how the jackpot/second-prize split changes the game: Gulfstream 60-40 gives huge carryovers, Churchill 10-90 gives nearly an ordinary Pick 6 at low prices. — [Ziemba 2022, ch. 22](https://econpapers.repec.org/RePEc:wsi:wschap:9789811250217_0022)
- [RACING-MEASURED, abstract only] Ziemba reports that merging three handicappers' picks would have done well on one muddy Belmont Pick 6 (30 May 2021). He also reports that bettors in Rainbow and standard Pick 6s appear to prefer longshots over favorites, a bias stronger than in the win market. This contradicts the common assumption that longshots are the way to be different. — [Ziemba 2022, ch. 23](https://econpapers.repec.org/RePEc:wsi:wschap:9789811250217_0023)

**The Deza-Huang-Metel paper is not a pick-N paper**
- [RACING-MEASURED] arXiv 1503.06535 studies the **superfecta (a single race)**, not Pick 4 or Pick 6. It maximizes fractional-Kelly log wealth subject to a chance constraint limiting losing streaks over a horizon τ. Own stake enters both the pool and the combination pool, so self-dilution is modelled. — [Deza, Huang, Metel](https://ar5iv.arxiv.org/html/1503.06535); [published in JORS 2018](https://ideas.repec.org/a/taf/tjorxx/v69y2018i3p319-325.html)
- [RACING-MEASURED] Data were 1,168 Flamboro Downs races, 2013-14, with a 350-race test set at 24.7% take. Out-of-sample results by streak limit: τ=∞, longest streak 52, return 7.8%; τ=40, 40, 4.5%; τ=30, 27, 4.0%; τ=20, 19, 1.0%. Tighter limits meant fewer races bet and larger stakes per race. One track and season, so a small sample. — [Deza et al.](https://ar5iv.arxiv.org/html/1503.06535)

**Efficiency of pools and carryover size**
- [RACING-MEASURED, abstract only] Hausch, Ziemba and Rubinstein find win-market biases too small for profit. Their profitable system is for place and show, comparing estimated probabilities with amounts bet and sizing by log utility, tested at Santa Anita and Exhibition Park. It is not a multi-leg result. — [HZR 1981](https://econpapers.repec.org/RePEc:inm:ormnsc:v:27:y:1981:i:12:p:1435-1452)
- [RACING-MEASURED, abstract only] Asch and Quandt find exotic markets inefficient, but not enough for simple strategies to profit consistently. — [Asch and Quandt, in Hausch-Lo-Ziemba 2008](https://econpapers.repec.org/RePEc:wsi:wschap:9789812819192_0045)
- [RACING-MEASURED, listing only] Gramm, McKinney and Owens study multi-horse exotics on 11,194 races at 35 US tracks. I did not read the findings. — [Gramm et al. 2008](https://ideas.repec.org/a/taf/applec/v40y2008i1p89-97.html)
- [RACING-MEASURED, NON-PEER-REVIEWED slides] On forced-out 20-cent Pick 6s on 27 Nov 2016: Gulfstream West $373k bet + $105k carryover, +8.3% expected return, paid $27k against a $16k parlay; Churchill $626k + $173k, +12.7%, paid $117k against $18k. Pick 5s paid on average 2.47x parlay (Saratoga, 15% take) and 2.86x parlay (Churchill, 22% take). Multi-race carryovers had spillover effects of 25-40% on betting. — [Gramm slides](https://rtip.arizona.edu/sites/rtip.arizona.edu/files/Gramm.pdf)
- [RACING-MEASURED, NON-PEER-REVIEWED] Benter's group is reported to have placed about 51,000 wagers on the Hong Kong Triple Trio on 6 Nov 2001 and won a jackpot of about $16 million, after several rollovers. Other outlets report about HK$100 million. I saw this in search excerpts of a [Bloomberg reprint](https://www.tbsnews.net/node/13271) and [Guinness](https://www.guinnessworldrecords.com/news/2025/8/a-billion-dollars-off-the-ponies-how-a-statistician-became-the-most-profitable-gambler); the SCMP article returned HTTP 403. This is an anecdote, not a study.

**Popular combinations and dilution, from lotteries [ANALOGY]**
- Moffitt and Ziemba reproduce the Ziemba et al. (1986) estimate for 6/49: expected return = $0.45 × F1 × ... × F6, where each F is the ratio of the equal-number probability to that number's betting probability. The 0.45 reflects take and consolation pools and rises with a carryover. — [Moffitt and Ziemba](https://arxiv.org/abs/1801.02958)
- The same paper reports that betting only unpopular numbers wins too rarely to be practical, and that an optimal log-wealth 6/49 strategy takes millions of years to pay with high probability (MacLean et al. 1992). — [Moffitt and Ziemba](https://arxiv.org/abs/1801.02958)
- It reproduces the Cook-Clotfelter syndicate formula for W different tickets: E = W[R + kc(W+N)](1-e^(-pN))/N, where R is carryover, N crowd bets, k the jackpot fraction, c combination cost, p win probability. I read this from PDF text extraction; check it against the PDF before coding. — [Moffitt and Ziemba](https://arxiv.org/abs/1801.02958)
- Its main result: a well-funded syndicate buying one of each ticket can get about 10-25% expected return in an equiprobable lottery with no take and no carryover. This assumes zero take, so it does not transfer to Altılı directly. — [Moffitt and Ziemba](https://arxiv.org/abs/1801.02958)
- Kim and Skiena show that collisions reduce ticket value as pools grow, and estimate positive returns for US lotteries only with jackpots between $775.2 million and $1.67 billion. — [Kim and Skiena](https://arxiv.org/pdf/2101.04242)
- Baker and McHale find that non-random number choice makes winner counts far more variable, and that players could raise expected value by choosing less-popular numbers. — [Baker and McHale 2009](https://econpapers.repec.org/RePEc:bla:jorssa:v:172:y:2009:i:4:p:813-834)
- Farrell et al. report strong evidence of conscious selection. — [Farrell et al. 2000](https://econpapers.repec.org/RePEc:bes:jnlbes:v:18:y:2000:i:2:p:228-41)

**Crowd avoidance in pools [ANALOGY]**
- Clair and Letscher separate maximizing expected score from maximizing expected return. Their strategies beat score-maximizing ones, often by orders of magnitude. — [Clair and Letscher 2007](https://www.stat.berkeley.edu/~aldous/157/Papers/clair.pdf)
- In NFL pools, optimal picks at N=9,000 had weekly expected return 16 to 74, average 41; at N=50, 2.26 to 7.17, average 3.87. At N=170,000, random picks averaged 23.4 and optimal picks were 3.4-28 times better. The authors warn that a return of 40 means winning a 9,000-person pool about once every 15-20 years. — [Clair and Letscher 2007](https://www.stat.berkeley.edu/~aldous/157/Papers/clair.pdf)
- The paper states the advantage of differentiating from the crowd for large pools, and says crowd avoidance becomes crucial once football pools get large. — [Clair and Letscher 2007](https://www.stat.berkeley.edu/~aldous/157/Papers/clair.pdf)

**Consolation and Turkish rules**
- The TJK bylaw (English PDF, undated in the part I read; amendments to 2011 visible) defines Pick 6 as naming the winners of six races. If nobody wins, the distributable amount rolls to the same game at the same hippodrome. On the last permitted rollover day or at season end it is shared by "the most successful" players. — [TJK bylaw, Art. 5, 18, 26](https://medya-cdn.tjk.org/medyaftp/pdf/BETTING.pdf)
- Under Art. 18(2), if only fractional-stake players hit, the share for one full game fee is carried forward; a single fractional ticket gets a share in proportion to its fee and the rest carries over. This matters if the system plays below the full fee. — [TJK bylaw](https://medya-cdn.tjk.org/medyaftp/pdf/BETTING.pdf)
- In the articles I read there is no routine 5/6 consolation. In the US, one patent describes Scoop 6 as a six-leg jackpot bet that may include a bonus pool and consolation prizes (search excerpt). — [US8721438](https://patentimages.storage.googleapis.com/c7/36/49/5cfa3810d275c8/US8721438.pdf)
- [NON-PEER-REVIEWED] TJK raised 6'lı and 5'li unit prices by 25-33% from 1 Jan 2022. — [Fanatik](https://www.fanatik.com.tr/at-yarisi/tjkdan-6liya-ve-5liye-2022-birim-fiyati-zammi-2257666)

**Patents (no evidence of effectiveness; a patent grant is not validation)**
- US10482717 (Reetz) takes a budget, pool data and handicapper data, computes will-pays, EV and overlays, then allocates the budget by value. The part I read covers Win, Place, Exacta and Trifecta on a single race; multi-leg and Pick 6 were not mentioned (first 100,000 of about 170,000 characters read). — [US10482717](https://patents.google.com/patent/US10482717)
- CA2904476 concerns presenting options and building wagers, not probability coverage (search excerpt). — [CA2904476](https://brevets-patents.ic.gc.ca/opic-cipo/cpd/eng/patent/2904476/summary.html)

### Inferences
- **EV per combination, by analogy with Ziemba's form:** EV per TL ≈ K × ∏(p_i/q_i), with K ≈ (1-t) + C/H. Here p_i is your leg probability, q_i the public's leg share, t the take, C carryover, H new handle. This assumes the public's combination shares are the product of its leg shares, which nobody has validated for Altılı. It also ignores own-dilution and the no-winner case.
- **Carryover check:** back-solving Gramm's two figures with this K gives implied takes of about 20% and 15%, so the simple formula reproduces his numbers. The average-bettor break-even is C/H > t.
- **Metel's streak constraint is directly usable:** to keep a streak below τ with confidence 1-α, Deza et al. require a per-event hit probability of at least 1-α^(1/τ). With α=0.05: τ=20 needs 13.9%, τ=40 needs 7.2%, τ=100 needs 3.0%. This gives a way to set a floor on 6/6 probability per meeting.
- Ziemba's longshot finding and Clair-Letscher's favorite-overbet finding point in opposite directions. Whether the extra longshot is underbet in Altılı is an empirical question to measure, not to assume.
- Payouts in Turkey on a no-consolation day are all-or-nothing, so 5/6 near misses carry no value unless it is a forced-payout day. This holds only if the bylaw text I read is current.

### Gaps
- **Hong Kong Triple Trio:** I found no academic study optimizing it, only news on Benter.
- I could not read Ziemba's chapter text (paywalled), so his forced-payout formulas are not in these notes.
- Asch-Quandt and HZR do not, as far as the abstracts show, address pick-N.
- I did not find full text for Isaacs 1953 or Rosner 1975 (single-race optimal allocation; Brill et al. cite both), or for Ziemba's "Dr. Z" books. Bayraktar-Munk returned nothing relevant in one search.
- I did not find a source for the current TJK take on Altılı, the current unit price, or any current 5/6 rule. Confirm with TJK.
- I found no published estimate of the public's combination distribution in Altılı.

## When a single (TEK) is justified versus spreading; marginal-gain allocation of widths

### Takeaway
I found no published derivation of a TEK rule for pick-6; the literature offers only general models and practitioner heuristics. For a single box, the problem reduces to a simple knapsack in log space, which I derive below (my own derivation, not a citation). A TEK is justified when the second horse's log coverage gain is below the leg's share of the log budget, and it is further supported when the public underweights that horse relative to its probability.

### Cited Findings
- [ANALOGY] Hunter et al. describe marginal-gain selection as the natural approach for an at-least-one-wins objective, choosing items one at a time for the biggest increase. — [Hunter et al.](https://arxiv.org/abs/1604.01455)
- [THEORY/RACING-SIMULATED] Brill et al.'s pick-six strategy tilts probability toward the top share φ of horses in each leg, with λ controlling how strongly. They report higher optimal entropy as tickets increase. So small budgets should concentrate more. — [Brill et al.](https://arxiv.org/html/2308.14339v3)
- [RACING-MEASURED] Deza et al. found that limiting losing streaks moved the solution to fewer races and larger per-race stakes, at the cost of total return. — [Deza et al.](https://ar5iv.arxiv.org/html/1503.06535)
- [NON-PEER-REVIEWED] Davidowitz (DRF, 2007) warns against equal widths: 4x4x4x4x4x4 costs $8,192. He suggests covering roughly 50-80% of win contenders per race, narrow where confident, wider where not, and concentrating money on sequences with a vulnerable heavy favorite. — [DRF](https://www.drf.com/news/crafting-pick-six-score)
- [NON-PEER-REVIEWED] A commercial blog says the common mistake is spreading in the wrong races, and that singles should weigh field size and price rather than confidence alone. — [Past the Wire](https://pastthewire.com/blog-posts/the-pick-6-explained-structure-ticket-building-and-bankroll-discipline/)
- [NON-PEER-REVIEWED] Eng prefers "skinny" tickets on formful results, for example one single and three horses in the other five legs. He says syndicates scale tickets as the carryover grows, using longshots as separators. — [America's Best Racing](https://www.americasbestracing.net/gambling/2019-mandatory-payouts-selective-approach-beginners-playing-pick-6)
- [NON-PEER-REVIEWED] An In the Money article treats a single as taking a stand, and advises against mixing logical and longshot horses in the same leg of one ticket. — [In the Money](https://inthemoneypodcast.com/other-side-of-the-coin-the-lsds-of-big-score-ticket-structure/)

### Inferences
**My own derivation, not from a source.** For one box with leg widths w_i and covered mass c_i(w_i), legs independent:
- P(6/6) = ∏ c_i(w_i), cost = ∏ w_i.
- Taking logs turns this into a knapsack: maximize Σ ln c_i(w_i) subject to Σ ln w_i ≤ ln B.
- Marginal rule: add the horse with the largest ln(1 + p_next/c_i) / ln(1 + 1/w_i).
- Lagrangian form: in each leg choose w maximizing ln c_i(w) - μ ln w. A TEK is chosen when ln(c_i(w)/p_1) ≤ μ ln w for every w.

Consequences:
- The first spread costs the most: going from 1 to 2 horses doubles the cost, while going from 4 to 5 adds 25%. So a leg's second horse must add a lot of mass to earn its place. This is why singles and wide legs tend to appear together, rather than a uniform 3x3x3.
- On my synthetic test the greedy rule matched the exhaustive best box exactly at 300 and 1,000 combinations, and came within 0.5% at 3,000 (see the table in the portfolio section).
- A TEK multiplies P(6/6) by the horse's probability directly. If that probability is overestimated, the whole ticket falls with it. Use calibrated, not raw, model probabilities, and test the TEK rule on them.
- For EV rather than hit rate, weight each horse by p/q as well. A TEK on a horse with p/q < 1 shrinks the payout of every combination on the ticket. A vulnerable favorite (p/q well below 1) is therefore a poor TEK even when it is the most likely winner, which agrees with Davidowitz's and Clair-Letscher's direction.
- Budget matters: low n favors concentration (Brill et al.). At 3 tickets and this budget, the optimum should sit nearer the chalky end than a syndicate's.

### Gaps
- I found no peer-reviewed empirical study of how often singles win in pick-6, by public share or probability bucket. The system's own backtest must supply this.
- The independence assumption between legs was not tested in anything I read.
- I found no published treatment of how leg-width choice should change with probability uncertainty.

## Portfolio diversification of correlated entries; does one wide ticket beat several overlapping ones?

### Takeaway
On hit probability, duplicated combinations are pure waste, and combinations within a meeting are mutually exclusive, so at combination level the probabilities simply add. The ideal is therefore the top-B combinations, and a single box is usually not that set. In my synthetic test, one well-chosen wide box beat three overlapping tickets by about 27-32%, but three **non-overlapping** core-plus-extension tickets beat the single box by about 4-5%. The observed "union covers all winners, no ticket hits" is what a leg-wise union naturally produces: it is a much larger box than the tickets actually paid for.

### Cited Findings
- [THEORY, ANALOGY in application] Hunter, Vielma and Zaman frame the problem as maximizing P(at least one entry wins). Citing Hunter and Zaman (2017): this is NP-hard even for discrete uniform distributions; the objective is non-negative, non-decreasing and submodular; greedy attains at least 1-1/e of optimum (Nemhauser et al. 1978); greedy is optimal for independent events. — [Hunter et al.](https://arxiv.org/abs/1604.01455)
- [ANALOGY] They say entries with high individual chance can be a worse set than slightly weaker entries with lower correlation, because the latter cover more outcomes. — [Hunter et al.](https://arxiv.org/abs/1604.01455)
- [ANALOGY, measured on DFS] With overlap limits on 200 lineups in real DraftKings hockey and baseball contests they reached the top ten multiple times, including a first place. A single lineup had median profit margin of -100%, and the median rose with more lineups. — [Hunter et al.](https://arxiv.org/abs/1604.01455)
- [ANALOGY, measured on DFS] The best overlap depended on the size of the outcome space. With few games, a limit of 7 players was best; on nights with more than nine games, 4 was best. Their explanation is that small spaces have few good lineups, and forcing diversity then picks poor ones. — [Hunter et al.](https://arxiv.org/abs/1604.01455)
- [THEORY/RACING-SIMULATED] Brill et al. show that the right diversity depends on objective and field: optimal entropy rises with n and with opponents' entropy, and win probability and profit are separate objectives requiring separate treatment. — [Brill et al.](https://arxiv.org/html/2308.14339v3)
- [ANALOGY] Kaplan and Garstka maximize expected points for one entry: their Markov models reached about 58% accuracy and did not beat picking the seeds on simple scoring, but did under a richer point structure. It is not a multiple-entry study. — [Kaplan and Garstka 2001](https://econpapers.repec.org/RePEc:inm:ormnsc:v:47:y:2001:i:3:p:369-382)
- [ANALOGY] Clair and Letscher optimize a single bet's expected return; the portion I read does not treat a portfolio of entries. — [Clair and Letscher 2007](https://www.stat.berkeley.edu/~aldous/157/Papers/clair.pdf)
- [RACING, abstract only] Hausch and Ziemba (1985) extend their place/show system to multiple entries and multiple wagers, and ask how much can be bet before the market turns efficient. — [Hausch and Ziemba 1985](https://econpapers.repec.org/RePEc:inm:ormnsc:v:31:y:1985:i:4:p:381-394)

### Inferences
**Mapping DFS and brackets onto Altılı (my reasoning, not from a source).**
- Each 6-horse combination is one "entry"; a ticket is a block of entries with product structure. Hunter's results apply to combinations, not to tickets.
- Within one meeting, exactly one combination wins. So combinations are mutually exclusive, U(S) = Σ P(combination), and the objective is additive rather than merely submodular. The optimal set of B combinations is simply the B most probable.
- Correlation between tickets therefore reduces to overlap (shared combinations). This differs from DFS, where correlated scores can yield several winners on one night and Gaussian covariance matters. DFS overlap tuning (4-7 players) should not be copied as a number.
- The top-B set is a "staircase", not a box. A box is one feasible set, so a well-built union can never be worse than a best box at equal paid combinations, provided overlaps are not paid for. This is the formal argument for the practitioner A/B/C structure.
- Duplicate combinations have value only under the profit objective. In Brill's formula, W/(W+W_opp) rises from 1/(1+W_opp) to 2/(2+W_opp), which matters when co-winners are likely, typically on chalky results. They add nothing to P(6/6).
- Diversifying across models may still be valuable when probabilities are uncertain, since errors would be shared between combinations. I did not find racing evidence beyond Ziemba's one-card, three-handicapper anecdote.

**Synthetic calculation (my own; invented probabilities, not TKP data; legs independent).** Six legs with 8-14 runners and geometric probabilities (top horse about 19-39%). B is the number of combinations paid for; divide the budget by the unit price to get B.

| Paid combinations B | ~300 | ~1,000 | ~3,000 |
|---|---|---|---|
| Top-B upper bound (not achievable with 3 boxes) | 4.79% | 10.40% | 19.51% |
| 3 disjoint tickets: core + 2 extensions (structured search) | 3.98% | 8.32% | 15.22% |
| Best single box (exhaustive) | 3.81% | 7.96% | 14.58% |
| Greedy log-gain single box | 3.81% | 7.96% | 14.51% |
| 3 "divergent" tickets at B/3 each: P(some ticket 6/6) | 3.13% | 6.89% | 13.29% |
| Same tickets: P(all winners within leg-wise union) | 8.16% | 17.32% | 26.69% |
| Combinations in that leg-wise union box | 1,280 | 4,800 | 10,800 |
| 3 overlapping tickets at B/3 each: P(some ticket 6/6) | 2.89% | 6.28% | 11.04% |
| Same tickets: P(all winners within leg-wise union) | 3.17% | 6.81% | 11.50% |
| Combinations in that leg-wise union box | 240 | 768 | 1,920 |

What the table shows, under these assumptions only:
- **The observed issue reproduces.** With divergent tickets, "union covers all winners" occurs 2.0-2.6 times as often as an actual 6/6. The union box holds about 3.8-4.9 times more combinations than the tickets paid for, so a union hit is not a near miss. It should not be read as evidence that the selection was right but the split was wrong, and should not be used as the system's success metric.
- **Overlapping tickets are dominated.** At about 3,000 combinations, the three overlapping tickets cost 2,880 for 11.04%, while their own leg-union box costs 1,920 and gives 11.50%: less money, more probability.
- **Answer to the fixed-budget question.** One wide box beats three overlapping tickets (+27% to +32% in hit probability) and three divergent ones (+10% to +22%).
- **Non-overlap structure is better but modest.** Core-plus-extension tickets gain +4.4% to +4.5% over the box, within a restricted family, so better structures may exist. The core often has a TEK that another ticket replaces with alternatives (at B=1,000: widths 2-3-3-1-5-3, with one extension in the TEK leg). This is a "TEK per ticket, spread per family".
- **Likely practical design:** build ticket 1 as the core, then make ticket 2 and ticket 3 each cover only *new* combinations, by swapping a leg's horses for the next ones rather than re-including the core horses. Report paid-combination overlap as a metric, and aim for it to be zero.
- These gains should be re-measured on calibrated TKP probabilities. With sharper real favorites or model error, the ranking could change, particularly the small gain over the single box.

### Gaps
- I found no peer-reviewed result that directly compares one wide pick-6 ticket with several tickets of equal total cost, on real racing pools.
- I did not read a formal result on maximizing hit probability for a union of boxes under a knapsack budget. Its complexity and any guarantee for greedy with box-shaped sets remain open to me.
- Brill et al.'s pick-six figures are lower bounds on a single-card model, and I found no replication.
- Whether profit-optimal (as opposed to hit-optimal) tickets should overlap is not settled by what I read.

## Practitioner sources on pick-6 structuring (all NON-PEER-REVIEWED)

### Takeaway
Practitioners broadly converge on tiered A/B/C tickets, singles where confident, unequal widths and playing into carryovers. These are opinions with anecdotes, and none of the sources below presents a controlled test. They agree with the structural argument above, but they do not prove it.

### Cited Findings
- **A/B/C/X tiers:** a betting guide attributes the tiers to Steve Crist (search excerpt; I did not verify the attribution against his book). — [SportsLine](https://www.sportsline.com/insiders/how-to-bet-on-horse-racing-beginners-guide-to-placing-a-bet-glossary-of-terms)
- **Ticket ladder:** a commercial builder lays out all-A tickets, A's with one B, A's with one C, then A's with two B's (search excerpt; commercial tool). — [Geegeez](https://www.geegeez.co.uk/tag/multibet-builder/)
- **Several related tickets:** Davidowitz builds several tickets around shared key horses and varies spreads in uncertain legs, for example four tickets totalling $1,968. He says serious play commonly means $1,000-$5,000 per ticket. — [DRF, 2007](https://www.drf.com/news/crafting-pick-six-score)
- **Different routes:** the "LSD" framework grades horses by how obvious they are to others (Logical, Shaker, Diverger), and varies routes across tickets so the group covers more outcomes while each ticket stays focused. — [In the Money](https://inthemoneypodcast.com/other-side-of-the-coin-the-lsds-of-big-score-ticket-structure/)
- **Carryover:** Eng plays when expectancy is clearly favorable, and describes low-minimum, high-take (about 45%) formats where much of the take feeds the carryover, with unique-ticket jackpots paid out on a mandatory day. — [America's Best Racing, 2019](https://www.americasbestracing.net/gambling/2019-mandatory-payouts-selective-approach-beginners-playing-pick-6)
- **Marketing-level:** Past the Wire calls carryovers money added by earlier losers, and suggests syndicates to buy coverage. It is a commercial blog. — [Past the Wire](https://pastthewire.com/blog-posts/the-pick-6-explained-structure-ticket-building-and-bankroll-discipline/)
- **Rule check:** Minnesota's rule shows how US pick-six carryover rules are written, and that tickets cannot be sold, exchanged or cancelled after the first leg closes. It is a primary legal text but a different jurisdiction. — [Minnesota Rules 7873.0190](https://www.revisor.mn.gov/rules/7873.0190/version/2014-01-18%2007:55:29+00:00)

### Inferences
- The "ladder" is a practical approximation to the top-B staircase. Its typical all-A, one-B-swap form is close to the non-overlap core-plus-extension structure when the B ticket replaces rather than adds A horses. Practitioners vary on this, and many tickets in practice do overlap.
- Davidowitz's and syndicate ticket sizes are far above a 2,500-3,000 TL budget in combination terms if the unit price is low, or may be comparable if it is not. Compare on the number of combinations, not on currency.
- Advice from high-budget players about "separators" may not transfer: at low n, Brill et al.'s model favors less entropy.

### Gaps
- None of the practitioner sources reports audited long-run ROI. Survivorship and selection in published anecdotes (for example a friend's $28.80 ticket cashing near $2,000 in Eng's piece) cannot be assessed.
- I found no Turkish practitioner or academic source on Altılı ticket structure of comparable depth; the one search I ran for Turkish rules returned news items only.
