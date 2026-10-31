# Horse win probability models and combination with market odds

Access tags: **[full text]** = I read extracted text of the paper. **[abstract]** = only an abstract or database record was visible. **[snippet]** = only a search-result excerpt was visible. **[blog]** = non-academic or marketing source, kept separate from the evidence. Benter, Bolton & Chapman and Ali were read from OCR/text-layer extraction, so displayed equations and some table columns are damaged; numbers below were kept only where the row was legible.

Target system for the inferences: about 3,700 races, 38,000 runners (mean field about 10.3), 613 meetings, TJK; model top pick wins 31.9%, market favourite 31.8%.

## Exact model forms and how fundamentals and public odds are combined

### Takeaway
The standard architecture is a conditional (multinomial) logit fundamental model, fitted on one sample, whose log probabilities enter a second conditional logit beside log public probabilities, fitted on a separate sample. Evidence that two stages beat one rests on a single 565-race betting holdout, so it is suggestive and not settled.

### Cited Findings

**Bolton & Chapman 1986 (Management Science 32(8)) [full text]**
- Horse utility is U = V + e. With i.i.d. double-exponential errors, P(horse h wins) = exp(V_h) / sum_k exp(V_k), with V linear in attributes; estimated by maximum likelihood on the observed winners — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- They rejected probit because of its numerical integration cost, and noted logistic and normal distributions differ little except at the extremes — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Rank explosion (Chapman & Staelin 1982; Luce & Suppes ranking theorem): a finish order decomposes into independent choice sets, the winner from all, the second from the rest, and so on. Standard errors fell about 28.3% from depth 1 to 2 and another 16.8% from 2 to 3 — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Depth is checked with the Watson-Westin pooling test, -2(L_pooled - [L_1 + L_2]), chi-squared with df equal to parameter count. On their data the statistics were about 11 and about 6 against a 5% critical value of 18.3, so depth 3 was accepted — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Ten variables with no odds term: LIFE%WIN, AVESPRAT, W$/RACE, LSPEDRAT, two jockey variables, jockey-missing flag, WEIGHT, POSTPOS, NEWDIST. Average speed rating had the largest standardised coefficient (0.562) — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Odds entered only at the wagering step, through expected return. Holdout returns were negative or marginal until longshots were excluded: Isaacs' strategy -27.8%, fixed-wealth Rosner -6.4%, and a positive return only with a minimum-probability constraint of about 0.07 (about 1.3% across races) — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).

**Chapman 1994 [abstract]**
- A 20-variable pure fundamental multinomial logit on 2,000 Hong Kong races, single-unit win bets, positive holdout returns; excluding horses under 0.04 estimated probability gave expected returns above 20% — [Chapman, EconPapers record](https://econpapers.repec.org/RePEc:wsi:wschap:9789812819192_0018).

**Benter 1994 [full text, OCR]**
- Stage 1 is a Bolton-Chapman multinomial logit on fundamentals. Its displayed probabilities look calibrated overall, but this hides a large bias conditional on disagreement with the public — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Bias evidence on 3,198 Hong Kong races and 32,877 horses. Where public probability exceeds model probability, bucket .050-.100 had expected .073 and actual .091 (Z = 4.7). Where public is below model, the same bucket had expected .074 and actual .058 (Z = -4.3). The second group is exactly the set a bettor would back — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Stage 2: c_i = exp(alpha f_i + beta pi_i) / sum_j exp(alpha f_j + beta pi_j), where f = log of the out-of-sample fundamental probability and pi = log of the public implied probability. Alpha and beta are fitted by maximum likelihood over past races and read roughly as relative correctness — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Out-of-sample stage 1 inputs are required, because in-sample inputs overstate the fundamental model's significance. Log probabilities were chosen because they fit better than raw probabilities — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- After stage 2 the conditional biases disappear (Tables 6-7), and the probability spread widens beyond either input, which Benter reads as more information — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Horses the model cannot rate (often first-time starters) are assigned the public probability, and the others are renormalised to sum to 1 — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Public probability is p = (1 - take) / dividend. At tracks where public odds are not well calibrated (Ali 1977), Benter says suitable corrections should be made before use — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Benter cites Asch & Quandt 1986 and White, Dattero & Flores 1992 for the technique of combining two expert judgements — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).

**Sung & Johnson 2007 (Journal of Prediction Markets 1(1)) [full text]**
- One-step: conditional logit on ln(normalised odds probability) plus the m-1 fundamentals together. Two-step: conditional logit on fundamentals, then conditional logit on a ln(p_s) + g ln(p_f) on a second set of races — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Data: Wolverhampton, 1,675 races and 16,431 horses, 1995-2000, chronological. Stage 1 used 555 races, stage 2 used 555, holdout used 565. One-step was trained on the combined 1,110 races — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Stage 2 coefficients at depth 2: ln odds 0.7798 (SE 0.0454), ln fundamental 0.1386 (SE 0.0446). At depth 1: 0.7977 (SE 0.0632) and 0.1658 (SE 0.0625). Combined LL -2,090 against odds-only LL -2,095, LR = 10, significant at 1% — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Allowed explosion depth differed by stage: depth 3 accepted for fundamentals (statistics 4.97 and 17.71, critical 18.31), only depth 2 for stage 2 (11.60 vs 5.99) and for the one-step model (29.98 vs 19.68) — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Kelly without reinvestment on the 565 holdout races: one-step +0.96%, two-step +17.53%. They offer multicollinearity with odds as a possible reason, and note that one-step coefficients flipped sign on two variables — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Trade-off they state: two-step must split the training data, so one-step may have merit with few races; one-step keeps per-variable interpretability; two-step can be refreshed in seconds near the off using late odds — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).

**Edelman 2007 (Annals of OR 151) [abstract; model form via Lessmann]**
- SVM methods adapted to stratified race outcomes, argued to generalise with many inputs relative to observations; 200 races in sample, 100 out of sample, 12 inputs, Australian data; reports promising results — [IAOR record](https://iaorifors.com/paper/56091).
- As described by Lessmann et al.: stage 1 is RBF-kernel SVR on normalised finishing position; closing odds are held back to stage 2, a conditional logit — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).

**Lessmann, Sung & Johnson series**
- 2007 [full text]: stage 1 LS-SVR on normalised finishing position (scaled to +0.5 to -0.5). Stage 2: p = exp(a y_hat + b ln q) / sum exp(a y_hat + b ln q), with q normalised odds probabilities, where q is built from 1/(1 + odds) — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).
- 2007 tuning: NDCG with weight 1/log2(rank+1), optionally zero weight after rank 3 (prize places), replaces MSE for hyperparameter selection only — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).
- 2009 EJOR [abstract]: SVM classification using only winner versus loser labels, on the argument that lower finish positions are unreliable; compares favourably with leading alternatives on a UK track — [EconPapers](https://econpapers.repec.org/RePEc:eee:ejores:v:196:y:2009:i:2:p:569-577).
- 2010 IJF [abstract]: adapted random forest for competitive events; reports it beats traditional statistical techniques and could yield substantial betting profits — [EconPapers](https://econpapers.repec.org/RePEc:eee:intfor:v:26:y::i:3:p:518-536).
- 2011 JORS [abstract]: on Hong Kong data, argues standard efficiency tests mislead through point estimates, use of information unavailable at the forecast stage, and failure to refresh models — [IDEAS](https://ideas.repec.org/a/pal/jorsoc/v62y2011i12p2120-2132.html).
- 2012 EJOR [abstract]: diverse base forecasts from surrogate outcome measures, pooled by stacking with conditional logit and log-likelihood-ratio forecast selection. Simple averaging is reported as ill-suited to competitive events — [EconPapers](https://econpapers.repec.org/RePEc:eee:ejores:v:218:y:2012:i:1:p:163-174).

**Silverman (UCLA dissertation) and Silverman & Suchard 2013 [dissertation full text; JPM abstract]**
- Conditional logit with LASSO on 186 covariates plus a term derived from the dividend, 2,944 fit races and 737 test races from 3,681 Hong Kong races. A Benter two-stage baseline gave ROI 14.2%; the modified model gave a maximum of 36.73% — [Silverman dissertation](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf); [JPM record](https://ideas.repec.org/a/buc/jpredm/v7y2013i1p43-52.html).
- The tuning parameter was chosen to maximise holdout ROI over repeated random 20% holdouts — [Silverman dissertation](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf).

**Source conflicts to keep visible**
- Sung & Johnson list Bolton & Chapman 1986 and Chapman 1994 as models with market probabilities alongside fundamentals, but the [Bolton & Chapman variable table](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf) has no odds term and the [Chapman abstract](https://econpapers.repec.org/RePEc:wsi:wschap:9789812819192_0018) says pure fundamental — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459) describes Benter's stage 1 as a linear regression of finishing position. [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf) states the model is a multinomial logit, and multiple regression appears only inside one factor (DPGA).

### Inferences
- Two-stage is the default for this system: it is cheap (one logit with two parameters at stage 2), keeps late odds out of the slow model, and gives a direct test of added information.
- With 3,700 races the split penalty that Sung & Johnson raise is small compared with their 555-race stages. Time-ordered out-of-fold stage 1 predictions would let stage 2 use most of the data. I did not find this cross-fitting tested in the racing literature, so it is my suggestion.
- The 0.96% versus 17.53% gap is one holdout path under Kelly staking with no interval reported, so its size should not be carried over. The LL improvement from odds-only to combined (5 LL units on 1,110 exploded choice sets) is the more transferable figure.
- The Silverman 36.73% is optimistically biased as reported: the parameter was picked on the same ROI it reports, on random and not chronological holdouts, and the dividend term enters the likelihood. It should not be taken as an achievable gain.
- For TJK, the market input must be the odds that exist at decision time. If the coupon is committed before late odds, stage 2 should be fitted on those earlier odds, because [Benter](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf) warns of volatile pre-post odds in small pools.

### Gaps
- Benter does not report his fitted alpha and beta, and I found no published Hong Kong value for them.
- Edelman 2007, Lessmann 2009, 2010, 2012, and Chapman 1994 full texts were not readable (paywall or HTTP 403); their sample sizes and fit figures, beyond what is stated above, are unknown.
- Benter 2003 ("Advances in mathematical modelling of horse race outcome probabilities") was located only as a [repository record](https://eprints.soton.ac.uk/51682), with no text.

## Sample sizes and how many races are needed

### Takeaway
Benter's stated floor is 500-1,000 races, with little out-of-sample gain from more development races beyond 1,000, though he also started from about 2,000 and argues for as large a sample as possible for variable selection. At 3,700 races this system has enough for a two-stage logit, and sample size is not the first explanation for a tie with the favourite. Feature quality is, on Benter's account.

### Cited Findings
| Study | Races (runners) | Split | Read as |
|---|---|---|---|
| Bolton & Chapman 1986 | 200, exploded to 600 | 4 rotations of 150 fit / 50 holdout | [full text](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf) |
| Chapman 1994 | 2,000 | holdout | [abstract](https://econpapers.repec.org/RePEc:wsi:wschap:9789812819192_0018) |
| Benter 1994 | 3,198 (32,877); also 2,313 for model comparison | about 2,000 initial development | [full text](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf) |
| Edelman 2007 | 300 | 200 / 100, 12 inputs | [abstract](https://iaorifors.com/paper/56091) |
| Sung & Johnson 2007 | 1,675 (16,431) | 555 / 555 / 565 | [full text](https://www.ubplj.org/index.php/jpm/article/download/419/450) |
| Lessmann et al. 2007 | 556 (stage 1: 2,116 runners in 200 races) | 200 / 200 / 156 | [full text](https://www.ubplj.org/index.php/jpm/article/download/427/459) |
| Silverman | 3,681 | 2,944 / 737, 186 covariates | [full text](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf) |
| Borowski & Chlebus 2021 (working paper) | 3,782 (29,377) | 2013-19 70/30, 2020 out of time | [full text, partial](https://www.wne.uw.edu.pl/files/2616/2436/3658/WNE_WP361.pdf) |

- Benter's data statement: his minimum for adequate development and testing samples is 500-1,000 races; more helps, but out-of-sample accuracy does not seem to improve dramatically beyond 1,000 development races. One race of data means full past records on all its runners — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- A closed population of horses is easiest, because collecting all races automatically gives each horse's full history — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- On overfitting: holdout partitioning avoids it, some overfitting always occurs, and trial-and-error factor addition yields a collinear mix of variables that is acceptable for prediction but calls for conservative tests on as large a sample as possible — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Simple factor specifications do not give adequately accurate probabilities. His distance factor grew into several thousand lines of code and is standardised by its standard error, so that sparse evidence shrinks the signal — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Pseudo-R2 on 3,198 races: public .1218, fundamental .1245, combined .1396, so delta = .0178 — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Out-of-sample comparison on 2,313 races (Sept 1988-June 1993): public .1237, 9-factor fundamental .1016, tipsters .1014, fundamental+public .1327, tipsters+public .1239 — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Effort and results: about 5 man-years to reach a significant edge, 5 more for high profitability. About 470 races bet per year, four of five seasons profitable, one loss of about 20% of starting capital, track take about 19%, continuous re-estimation — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Overestimating the advantage by a factor of two is easy in practice, and past simulations are more likely to overstate than understate real-time edge — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Expected ceilings: 0.25-0.5% of turnover for an unlimited bankroll, unlikely above 1.5% even at small tracks. Small-pool tracks have volatile odds that weaken the model, and may not be viable — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Explosion stretches data: with 555 races, depth 3 cut SEs by about 28% then 19% — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450). Bolton & Chapman used it to avoid the cost of collecting 600 races — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).

### Inferences
- The system's scale nearly matches Benter's 3,198 races and his mean field (32,877/3,198 is about 10.3, the same as 38,000/3,700). His benchmark deltas are therefore the most comparable external yardstick: about .009 for a 9-factor model and about .018 for his developed model.
- An approximate power calculation of my own: for nested stage 2 against market-only, LR is about 2 x N x ln(mean field) x delta. This uses ln(10.3) = 2.33 and is a rough approximation. Results:

| Test races N | delta .0005 | delta .001 | delta .0018 | delta .009 | delta .0178 |
|---|---|---|---|---|---|
| 925 | 2.2 | 4.3 | 7.8 | 38.8 | 76.7 |
| 1,850 | 4.3 | 8.6 | 15.5 | 77.6 | 153.4 |
| 3,700 | 8.6 | 17.2 | 31.0 | 155.1 | 306.8 |

- Against the chi-squared(1) critical value of 6.63 at 1%, about 925 test races would detect a Benter-size effect easily, while delta under about .001 would be hard to confirm. Races in one meeting may not be independent, so resampling by meeting (613 clusters) is the safer interval method; this is my suggestion and was not found in the cited papers.
- Sung & Johnson's depth-1 SE of about 0.063 at 555 races scales to about 0.03 at about 1,850 races, by the usual root-N rule, so stage 2 coefficients should be estimated tightly at this size.
- Because Benter's edge rose with model improvement and not primarily with more races, adding feature specification depth (form adjusted for opposition, distance and surface residuals) looks like a better route than waiting for more seasons. This is an inference from his text, not a tested result.

### Gaps
- I found no formal learning-curve study (out-of-sample pseudo-R2 against training races) on racing data; Benter's 1,000-race remark is experience, without published curves.
- I found no evidence on how many races TJK-like smaller markets need; no peer-reviewed Turkish racing model was found in this search.
- The Hong Kong market-efficiency trend (public pseudo values .1325 for 1986-93 rising to .1863 for 2016-23) appears only on a [blog](https://www.besthub.dev/articles/how-a-tiny-information-edge-beats-market-smarts-in-hong-kong-horse-racing-e65c050f579b) **[blog, primary source not named, unverified]**.

## Modern ML versus conditional logit

### Takeaway
I found no peer-reviewed head-to-head of GBM, learning-to-rank or deep nets against a two-stage conditional logit with a market log-likelihood benchmark. Peer-reviewed gains exist for SVR and random forest in stage 1 but rest mainly on betting returns over small holdouts, and the best non-peer-reviewed benchmark found has XGBoost roughly tying and not beating the market.

### Cited Findings

**Peer-reviewed (racing)**
- LS-SVR versus conditional logit in stage 1, same stage 2, Goodwood, 156 holdout races, Kelly without reinvestment: CL 1.75%, LS-SVR tuned by MSE 10.96%, LS-SVR tuned by NDCG 17.08%. With reinvestment: wealth -16.53%, +112.20%, +172.48% — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).
- In that paper the reported R2 was 0.10 for NDCG and 0.08 for MSE tuning. NDCG selected smoother, lower-complexity models, and the authors attribute MSE's weakness to fitting noise among irrelevant back-markers. The variables are only Bolton-Chapman style inputs — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).
- The authors explain the gain by nonlinear RBF interactions that linear CL misses; this is their interpretation and was not isolated experimentally — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459).
- Random forest (2010), winner-versus-loser SVM (2009), and stacking with conditional logit (2012) are all reported favourably, but only abstracts were visible — [2010](https://econpapers.repec.org/RePEc:eee:intfor:v:26:y::i:3:p:518-536); [2009](https://econpapers.repec.org/RePEc:eee:ejores:v:196:y:2009:i:2:p:569-577); [2012](https://econpapers.repec.org/RePEc:eee:ejores:v:218:y:2012:i:1:p:163-174).
- Multi-source view: Lessmann et al. call conditional logit the former gold standard, while reasons for unreliable lower ranks (no prize incentive, possible deliberate concealment) favour truncating rank targets — [Lessmann et al. 2007](https://www.ubplj.org/index.php/jpm/article/download/427/459); [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Adding squared covariates to the LASSO conditional logit lowered ROI against the main model — [Silverman dissertation](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf).
- Silverman's hierarchical Bayesian speed model at stage 1, combined with odds, still lost 12.15% on 3,323 positive-EV bets in the 2009 test — [Silverman dissertation](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf).

**Non-peer-reviewed but methodologically useful**
- Borowski & Chlebus 2021 (Warsaw working paper; closest in size to this system): 3,782 Polish races, 29,377 observations. On all-horse data the AUC order was GLMnet, neural net, LDA, XGBoost, random forest, CART, range 0.672-0.729 for the non-CART models; for Thoroughbreds alone the same order held, range 0.693-0.741 — [Borowski & Chlebus 2021](https://www.wne.uw.edu.pl/files/2616/2436/3658/WNE_WP361.pdf).
- That paper's strongest models used within-race standardised features. Odds seem absent from the inputs (they appear in its literature review and closing remarks); I did not read the whole variable table — [Borowski & Chlebus 2021](https://www.wne.uw.edu.pl/files/2616/2436/3658/WNE_WP361.pdf).
- Plackett-Luce with dynamic covariates, applied to data including horse racing, with theory on consistency; no market benchmark visible in the abstract — [Dong et al., arXiv 2406.16507](https://arxiv.org/abs/2406.16507) **[abstract]**.
- A Korean learning-to-rank paper (Chung et al. 2024) uses pairwise learning with Shapley analysis; I could not open it to confirm a market comparison — [search-visible summary](https://junhyoung-chung.github.io/2025/01/07/Horse-race-rank-prediction-using-learning-to-rank-approaches.html) **[snippet; page later returned 404]**.
- A UPenn 2025 thesis used a gradient-boosted model including market odds — [UPenn record](https://repository.upenn.edu/handle/20.500.14332/61178) **[snippet; HTTP 403 on fetch]**.
- An Aalto thesis uses a Plackett-Luce-based model with Betfair data — [Aalto record](https://aaltodoc.aalto.fi/items/32f909ee-844d-40d0-a1d8-accbaaeb5951) **[snippet; HTTP 403 on fetch]**.
- "What AI can do for horse-racing?" is a position paper, not a benchmark — [Colle, arXiv 2207.04981](https://arxiv.org/abs/2207.04981) **[snippet]**.

**Blogs and marketing, separate from the evidence**
- A GitHub project reports validation log loss per runner: market .2868, XGBoost .2871-.2878, XGBoost ensemble .2883, logistic .2930. No data size given; a market-residual model is listed with no result — [horse-racing-mlops](https://github.com/beaversliv/horse-racing-mlops) **[blog]**.
- A LightGBM plus Keras write-up found win odds among the top features, with no verifiable out-of-sample method — [Medium](https://medium.com/@cs_sg/machine-learning-for-horse-racing-c14f30a22dd5) **[blog]**.
- A practitioner note on LGBMRanker (LambdaRank) for JRA-style data used synthetic data — [issoh.co.jp](https://www.issoh.co.jp/md/tech/2321) **[blog, snippet]**.

### Inferences
- Lessmann's 156-race holdout cannot separate 1.75% from 17.08% with confidence, given how noisy short holdouts are: Bolton & Chapman saw 50-race subset returns of +18.7%, -58.6%, -32.1% and +46.4% for one strategy ([source](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf)).
- A practical order for 3,700 races: regularised conditional logit first as baseline, then GBM on within-race standardised features as a challenger in stage 1, always feeding the same stage 2 and judged by delta pseudo-R2 on the later period. GLMnet leading XGBoost on a similar sized dataset weakly supports starting linear.
- A softmax-within-race objective is preferable to independent per-runner binary loss, since conditional logit's main justification is within-race competition ([Bolton & Chapman](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf)). Ranking loss with top-3 truncation is consistent with the rank reliability concern, but the loss itself still needs converting to probabilities through stage 2.
- Deep nets have no racing evidence I could verify at this sample size. I would not prioritise them here.

### Gaps
- No peer-reviewed deep-net or GBM study with market log-likelihood benchmark was found. The search was limited, and many venues could not be opened, so this is absence of findings, not evidence of absence.
- Lessmann 2010 random-forest fit statistics, sample sizes and benchmarks were not visible.
- [Southampton](https://eprints.soton.ac.uk/343748/1/Final_PhD_thesis-David_McDonald.pdf) McDonald's PhD thesis includes conditional logit models by field size per a snippet, but the fetch returned HTTP 403.

## Ordering probabilities: Harville, Henery, Stern, Lo-Bacon-Shone

### Takeaway
Harville overstates favourites and understates longshots for second and third, and Benter says it should not be used uncorrected for betting. For practical use, discount the probabilities per finishing position with fitted exponents (Benter, Lo-Bacon-Shone); full normal (Henery) fits best in the largest test seen but remains biased. For Altılı legs only win probabilities are needed, so ordering matters mainly for finish-order pools and for how far ranks are used in training.

### Cited Findings
- Harville formula: P(i,j,k) = pi_i pi_j pi_k / [(1 - pi_i)(1 - pi_i - pi_j)] — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Family: all are independent running-time ranking models. Normal gives Thurstone/Henery, gamma with shape r gives Stern, r = 1 (exponential) gives Harville/Luce, and Luce is also the first-order Plackett model — [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Largest test seen: Ali 1998, 15,402 eight-horse New York harness races, 1970-74. Favourite finishing second: Harville .256 vs observed .192 (standardised deviation 20.2); gamma r = 20 .220 (8.75); normal .210 (5.74) — [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Same data, favourite finishing third: Harville .178 vs observed .129 (18.1); normal .147 (6.79). Ranking: normal is best and gamma approaches normal as r rises, yet all are significantly biased in the same direction — [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Ali's estimates fed win pool fractions corrected by power d (1.16 at Saratoga, 1.13 at Roosevelt and Yonkers), and he concludes none of the ranking models supports a profitable strategy — [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Earlier tests were small according to Ali: Harville 335 races, Stern 47 races — [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Harville bias on 3,198 Hong Kong races: >.400 bucket for second expected .476, actual .372 (Z -4.3); for third expected .492, actual .333 (Z -8.3). Low-probability horses beat expectation (.010-.025 for third: .018 vs .033, Z 4.3). The effect is larger for third than second — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Benter's correction: fit exponents on the win array by maximum likelihood; gamma = .81 for second and delta = .65 for third. After correction the >.400 second-place row was .456 vs .397, Z -1.6. Parameters are not universal, and other tracks gave significantly different values — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Harville's bias is less serious when applied to win probabilities that carry favourite-longshot bias, because the two tend to cancel — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Henery fits better than Harville with Hong Kong data, per later citing work and an abstract-level record of Lo & Bacon-Shone 1994 — [HKU record](https://hub.hku.hk/handle/10722/86405) **[snippet]**; [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf).
- Stern with a specific shape parameter performs best on a Japanese dataset, and Harville shows systematic bias under that assumption — [Lo, chapter 24 record](https://ideas.repec.org/h/wsi/wschap/9789812819192_0024.html) **[abstract]**.
- Lo & Bacon-Shone's simpler approximation fits about as well as Henery/Stern. Combined with the Hausch-Ziemba-Rubinstein system it gave higher profits at lower risk on US and Hong Kong data, and similar profits on Japanese data — [Lo, Bacon-Shone & Busche 1995 record](https://ideas.repec.org/a/inm/ormnsc/v41y1995i6p1048-1059.html) **[abstract]**.
- Lo & Bacon-Shone 2008 extend the normal model with correlation and variance structures, and find favourite-longshot bias is not universal — [JQAS record](https://econpapers.repec.org/RePEc:bpj:jqsprt:v:4:y:2008:i:2:n:11) **[abstract]**.
- Gu, Huang & Benter: probit fitted by MCMC stochastic approximation on about 1,000 Hong Kong races, reported to beat logit in holdout betting — [Scribd copy of abstract](https://www.scribd.com/document/519783748/gu) **[snippet, uploader-hosted]**; mentioned as a working paper by [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Benter: the more specific the bet, the higher the advantage for a bettor with accurate probabilities that differ from the public; a modest model can create pick-six advantage bets, and his example shows two sub-par win bets combining to a 16% advantage quinella — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).

**Conflict:** [Ali 1998](https://www.stat.berkeley.edu/~aldous/157/Papers/ali.pdf) reports negative profits for the HZR system across Lo et al.'s 705 Meadowlands, 905 Hong Kong and 983 Japan races, while the published [Lo, Bacon-Shone & Busche 1995 abstract](https://ideas.repec.org/a/inm/ormnsc/v41y1995i6p1048-1059.html) reports higher profits than HZR for its model. These may be compatible (absolute versus relative, or different versions), but I could not check the full paper.

### Inferences
- Choice rule:
  - Altılı/pick-six legs: only leg win probabilities, so ordering models are irrelevant, except for fitting.
  - İkili/Sıralı and similar finish-order pools: use exponent-discounted Harville with gamma and delta fitted on TJK data, since it is one line of code and Benter shows most bias removed.
  - Full Henery/Stern only if a test shows meaningful LL gain over the exponent version; the published evidence suggests little.
- Do not copy .81 and .65, since Benter explicitly warns they vary by track. Fit them, and check them with a calibration table for second and third.
- Exploded logit is Harville on utilities: an exploded choice set treats the second as winning among the rest. The Watson-Westin rejections at deeper depths and Harville's second/third bias look like the same phenomenon (rising randomness in lower places). This link is my inference. A practical consequence is that a per-depth scale parameter in training is worth testing.
- Harville on 8-horse harness and Hong Kong thoroughbred fields differ in setting, and TJK's Arabian/English split may need separate exponents. Test before pooling.

### Gaps
- Benter's displayed equations 7-9 were lost in the OCR of this copy. The text confirms a second array and a third array from pi, with exponent parameters gamma and delta. My recollection of the form is sigma_i = pi_i^gamma / sum pi_j^gamma, tau_i = pi_i^delta / sum pi_j^delta, P = pi_i x sigma_j/(1 - sigma_i) x tau_k/(1 - tau_i - tau_j), which should be checked on the scan's page 193 before use.
- Lo & Bacon-Shone 1994 and the approximation paper were not readable (HKU returned HTTP 403). I did not verify their exponents; a search did not confirm any specific value.
- Henery 1981, Stern 1990, and Harville 1973 originals were not read directly; statements come via Ali and Benter.
- No ordering-model evidence for Turkish racing was found.

## Validation: log-likelihood, pseudo-R2 against market, calibration

### Takeaway
The accepted test is whether adding the model to the market raises out-of-sample likelihood (delta pseudo-R2), not hit rate or stand-alone fit. Benter's tipster example shows why. A 31.9% versus 31.8% top-pick tie carries almost no information either way.

### Cited Findings
- McFadden measure: R2 = 1 - L(theta_hat)/L(0), where L(0) is the equal-probability model. Low values are expected because racing secretaries equalise fields; Bolton & Chapman's fit was .091, .064 and .055 at depths 1, 2, 3, so R2 should not be compared across depths — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Benter's measure: delta R2 = R2_combined - R2_public. In his experience larger delta always accompanied larger simulated wagering profit, and it can screen models without a full simulation — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Tipster example: stand-alone R2 .1016 versus .1014 looks equal, yet delta is about .0090 for the fundamental model and about .0002 for tipsters. Where tipsters and the public differ, the public is the better. A second stage would have stopped a player betting on the tipster model — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Calibration protocol: bucket predicted probabilities, compare with actual frequency and Z. Do this overall (Tables 1, 2, 5) and split by whether the public is above or below the model (Tables 3, 4, 6, 7) — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Nested test: LR of combined versus odds-only conditional logit, as Sung & Johnson did (LR = 10, significant at 1%) — [Sung & Johnson 2007](https://www.ubplj.org/index.php/jpm/article/download/419/450).
- Silverman's stage 2 reports public coefficient 6.4186 against speed 4.0541, which are not on comparable scales since speed is not a log probability — [Silverman dissertation](https://escholarship.org/content/qt9tm6w0rp/qt9tm6w0rp.pdf).
- Betting-return metrics vary heavily: four 50-race subsets ranged from -58.6% to +46.4% — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf). Race sequence alone changes return across races under wealth-updating strategies — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf).
- Long shots have the worst relative errors, so minimum-probability constraints help — [Bolton & Chapman 1986](https://www.gwern.net/doc/statistics/decision/1986-bolton.pdf); [Chapman record](https://econpapers.repec.org/RePEc:wsi:wschap:9789812819192_0018).
- Benter prefers correcting probabilities first over applying a minimum-advantage rule, since a correct margin is hard to set for exotics — [Benter 1994](https://www.gwern.net/doc/statistics/decision/1994-benter.pdf).
- Standard efficiency-test practice can mislead through point estimates, use of unavailable information, and no model refresh — [Lessmann et al. 2011](https://ideas.repec.org/a/pal/jorsoc/v62y2011i12p2120-2132.html) **[abstract]**.
- Favourite-longshot parameters drift over time and should be re-estimated — [Smith & Vaughan Williams 2010 record](https://econpapers.repec.org/RePEc:eee:intfor:v:26:y::i:3:p:543-550) **[snippet]**. Exchanges had lower bias than traditional bookmakers — [Smith, Paton & Vaughan Williams 2006](https://ideas.repec.org/a/bla/econom/v73y2006i292p673-689.html) **[snippet]**.
- Outside racing: model selection on calibration gave +34.69% average ROI versus -35.17% on accuracy, on one NBA season. This is one sport, one season, and arXiv lists it as submitted to a journal — [Walsh & Joshi, arXiv 2303.06021](https://arxiv.org/abs/2303.06021) **[abstract]**.
- [Blog] A marketing post reproduces Benter's tipster result and runs its own 176-game MLB test; it adds nothing to racing evidence — [OddsPapi](https://oddspapi.io/blog/?p=3174) **[blog]**.

### Inferences
- Reading of 31.9% versus 31.8% (my calculation): one proportion at N = 3,700 has SE about 0.77 points. For a paired difference, SE is at most sqrt(d/N), where d is the share of races in which model and favourite pick differently: about 0.9 points at d = 0.3, about 1.0 at d = 0.4. So 0.1 points is far inside noise and says nothing about added information. The actual d should be measured.
- A top-pick hit rate also ignores everything below the top pick, and those lower probabilities are what drive a multi-leg coupon's coverage. This fits the project's existing coverage framing, where probability mass and not top-pick accuracy matters.
- A sequence of checks for this system, each on a later period than fitting:
  1. Fit public pseudo-R2 and check public calibration; correct if biased, and report the odds-source used.
  2. Compute stand-alone model pseudo-R2.
  3. Fit stage 2 and report alpha, beta with intervals, and delta R2. If the model already contains odds, this test is invalid; refit on fundamentals only.
  4. Build Benter's Table 3/4 split; a large bias there means raw model probabilities must not drive decisions.
  5. Use ROI last, with intervals resampled by meeting.
- Decision yardstick, only by analogy with Hong Kong: delta about .009-.018 was linked with profit there at about 19% take. Delta near zero, with alpha near zero, is the tipster case: the system would then be right to follow the market and the model adds no value. The threshold for TJK is unknown and must also account for its own takeout and pool sizes.
- Walk-forward with periodic refit mirrors Benter's regular re-estimation and addresses the JORS critique. A frozen split is a minimum and not sufficient.
- Hyperparameter choice should use log-likelihood on the combined stage (or NDCG as a cited secondary option), not ROI, given the selection bias visible in the Silverman result.

### Gaps
- Benter's displayed pseudo-R2 equation (3) is lost in OCR; the definition is taken from the cited Bolton & Chapman form, which he cites as the source.
- Comparing two non-nested out-of-sample models (for example logit versus GBM stage 1) needs a test such as a paired per-race log-likelihood bootstrap. I found no racing paper that standardises this, so this is general statistical practice from me, uncited.
- I found no published delta R2 for any market with small pools or for Turkey, and no study linking delta R2 quantitatively to profit across tracks; Benter's link is stated from experience, without data.
- Calibration methods such as Platt or isotonic scaling were found only in blogs for racing. Benter's stage 2 is itself a two-parameter recalibration; whether extra calibration helps after it is untested in what I read.
