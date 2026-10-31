# Learning safely from small, drifting data and validating a betting model before deployment

Scope: notes for a self-improving 6/6 coupon system with about 613 meetings and about 100 stored 6/6 events, many on reconstructed coupons. Items under "Inferences" are mine. Every number there is either a calculation shown in place or is labelled as an assumption. All calculations use the planning rate 100/613 = 16.3%, which is not a measured live hit rate, because many of those events are on reconstructed coupons. Replace it, and the payout dispersion, with real TKP values before using any result as a gate.

## Calibration versus accuracy for model selection; scoring rules and calibration methods

### Takeaway
Select on strictly proper scores and calibration rather than accuracy, but the claim "calibration beats accuracy" rests on one NBA season with no significance test. For a parimutuel bettor the better criterion is the gain over the public's probabilities, because a calibrated model can still add no edge.

### Cited Findings
**Walsh & Joshi (primary)**
- Calibration-driven selection returned +34.69% average ROI against -35.17% for accuracy-driven selection; best cases were +36.93% and +5.56% — [arXiv 2303.06021](https://arxiv.org/abs/2303.06021). Published in Machine Learning with Applications, June 2024 — [DOAJ record](https://doaj.org/article/2e36e6f3ec6a46b7b54308dee2d11c23).
- The averages are over only two betting rules. Calibration-driven: +32.45% fixed stake, +36.93% eighth-Kelly. Accuracy-driven: +5.56% fixed stake, and the eighth-Kelly system lost over 75% of its wealth — [full text](https://arxiv.org/pdf/2303.06021).
- Design: training data from 2014/15 to 2017/18, with 2017/18 as the selection test set and one betting season, 2018/19. Both final models were SVMs. Classwise-ECE used 20 bins — [full text](https://arxiv.org/pdf/2303.06021).
- The authors name their own weaknesses: a single betting season gives no guarantee for other seasons, and the requirement that at least 80% of bins be non-empty was "somewhat arbitrary" — [full text](https://arxiv.org/pdf/2303.06021).
- The accuracy-driven model bet on 89.89% of games — [full text](https://arxiv.org/pdf/2303.06021).
- An earlier version reported very different figures: 110.42% vs 2.98% on average, 902.01% vs 222.84% in the best case — [earlier version summary, DeepAI](https://api.deepai.org/publication/machine-learning-for-sports-betting-should-forecasting-models-be-optimised-for-accuracy-or-calibration).

**Critics and adjacent evidence (primary)**
- I found no published direct rebuttal or replication of Walsh & Joshi (see Gaps). The nearest counterweights are below.
- Calibration can score well on overly cautious predictions. Guthrie & Franck treat boldness as the spread of predictions and report that relaxing calibration probability from 0.99 to 0.95 widened hockey predictions from roughly .25–.75 to .10–.90 — [arXiv 2305.03780](https://arxiv.org/abs/2305.03780v3).
- Decorrelating from the bookmaker while keeping accuracy allowed better profit generation — [Hubáček, Šourek & Železný, IJF 2019](https://econpapers.repec.org/RePEc:eee:intfor:v:35:y:2019:i:2:p:783-796).
- Benter's example is the closest to our setting. A fundamental model (R² .1016) and a tipster model (R² .1014) looked equivalent alone, on 2,313 races. Combined with the public (R² .1237), the fundamental model reached .1327 and the tipster model only .1239 — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- Benter states that a larger gain over the public was invariably associated with greater simulated wagering profit, so it can compare models without a full wagering simulation. This is his experience, not a test — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- Prediction bias can be satisfied by a null model that predicts the average, so calibration of that kind is a diagnostic and not proof of skill — [Sculley et al., NeurIPS 2015](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).

**Scoring rules and calibration methods (primary)**
- Strictly proper scoring rules encourage careful and honest assessment; the logarithmic and quadratic scores are among the examples, and maximum likelihood is a special case of optimum-score estimation — [Gneiting & Raftery, JASA 2007 (tech report)](https://apps.dtic.mil/sti/pdfs/ADA459827.pdf).
- The paradigm is to maximise sharpness subject to calibration — [Gneiting, Balabdaoui & Raftery, JRSS-B 2007](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jrssb.pdf). Disputed: Mitchell argues the motivating example is unrealistic and that sharpness is not needed as a subsidiary criterion — [NIESR discussion paper](https://econpapers.repec.org/paper/nsrniesrd/320.htm).
- The Brier score splits into reliability, resolution and uncertainty, and a constant forecaster has zero resolution — [Murphy 1973 as implemented in SpecsVerification](https://www.rdocumentation.org/packages/SpecsVerification/versions/0.3-0/topics/BrierScoreDecomposition); [Variance estimation for the decomposition, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182). The 1973 original was not opened.
- Isotonic regression overfits more readily than Platt scaling when data is scarce — [Niculescu-Mizil & Caruana, ICML 2005 record](https://mlanthology.org/icml/2005/niculescumizil2005icml-predicting). The wording was read on an [unofficial mirror of the paper](https://www.bdi.enhance.weon.website/www.cs.cornell.edu/_alexn/papers/calibration.icml05.crc.rev3.pdf), not on Cornell's server.
- Temperature scaling, a one-parameter variant of Platt scaling, was effective on most datasets tested. Those were image and document tasks, not betting — [Guo et al., ICML 2017](https://arxiv.org/abs/1706.04599).
- Benter's second stage fits two weights by maximum likelihood on the log of the model's probability and the log of the public's. It requires out-of-sample model estimates to avoid overstating the model's significance — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).

### Inferences
- Selection metric for TKP: leg-level log loss, plus the gain against AGF/odds-only probabilities. Brier and reliability diagrams are diagnostics. Stand-alone accuracy or stand-alone calibration should not be gates.
- Walsh & Joshi supports "do not select on accuracy". It does not support any ROI expectation, since the effective sample is one season and two rules, and my text search of the paper found no significance test or confidence interval.
- Calibrator choice: low-parameter first (Benter's two weights, or one temperature). Isotonic only when the calibration set is large. This follows from the two sources above; no source gives a size cut-off for our case.
- Benter's two-weight form behaves like a temperature when the public weight is fixed. That is my reading, not his statement.

### Gaps
- No independent replication or published critique of Walsh & Joshi was found. "Critics" above are adjacent work, not responses to that paper.
- No source found that compares log loss and Brier specifically for exotic betting selection.
- No source gives a calibration-set size threshold for choosing Platt versus isotonic.

## Walk-forward validation, leakage, backtest overfitting and multiple testing

### Takeaway
Walk-forward is necessary but not sufficient: a hold-out does not account for how many configurations were tried. The system must log every trial, freeze the candidate, and judge it on data that did not exist when it was frozen.

### Cited Findings
**Time-series validation (primary or author text)**
- Rolling-origin evaluation improves the efficiency and reliability of out-of-sample tests — [Tashman 2000, IJF record](https://iaorifors.com/paper/33593).
- In a rolling forecasting origin, each training set holds only earlier observations, and the earliest observations are not used as test sets because a small training set cannot give a reliable forecast — [Hyndman & Athanasopoulos, FPP3](https://otexts.com/fpp3/tscv.html).
- Theoretical problems undermine standard cross-validation for series, though an empirical study found no practical consequences, and a blocked form was suggested — [Bergmeir & Benítez 2012](https://research.monash.edu/en/publications/on-the-use-of-cross-validation-for-time-series-predictor-evaluati/).
- K-fold is valid for purely autoregressive models with uncorrelated errors — [Bergmeir, Hyndman & Koo 2018](https://econpapers.repec.org/RePEc:eee:csdana:v:120:y:2018:i:c:p:70-83). This qualifies the blanket rule "never use CV", but the conditions are specific.
- In parimutuel betting, bets must be computed from odds available minutes before post, and that inaccuracy reduces model effectiveness, especially with small volatile pools — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- A realistic parimutuel simulation adjusts the published payout for one's own wagers and breakage — [Deza, Huang & Metel](https://arxiv.org/pdf/1503.06535).
- Replay evaluation is unbiased under i.i.d. events and a uniformly random logging policy, and retains about 1/K of logged events — [Li, Chu, Langford & Wang](https://ar5iv.labs.arxiv.org/html/1003.5956).

**Backtest overfitting (primary)**
- Minimum backtest length: with 5 years of data, no more than 45 independent configurations should be tried, or a strategy with in-sample annualised Sharpe of 1 and expected out-of-sample Sharpe of zero is almost guaranteed. The upper bound is MinBTL < 2 ln(N) / E[max]². It is necessary, not sufficient — [Bailey, Borwein, López de Prado & Zhu, Notices AMS 2014](https://carmamaths.org/jon/backtest.pdf).
- The same paper notes that independent trials give a conservative estimate, and that N can be derived from correlated trials using a method such as PCA — [same paper](https://carmamaths.org/jon/backtest.pdf).
- A hold-out does not account for the number of trials attempted. "Model sequestration", announcing a strategy and later publishing results on truly unseen data, is cited as a meritorious extreme form — [same paper](https://carmamaths.org/jon/backtest.pdf).
- Conflict: Benter says the hold-out technique avoids the danger of overfitting past data — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf). Bailey et al. show this fails when many variants are tried on the same data — [Bailey et al. 2016](https://www.davidhbailey.com/dhbpapers/overfit-tools-at.pdf).
- With memory in performance series, optimising in-sample can be actively harmful out-of-sample, not merely useless — [Bailey et al. 2014](https://carmamaths.org/jon/backtest.pdf).
- Probability of Backtest Overfitting, estimated with the model-free, nonparametric CSCV procedure — [Bailey, Borwein, López de Prado & Zhu, J. Computational Finance 2017](https://escholarship.org/content/qt4w1110bb/qt4w1110bb.pdf); [abstract record](https://scholarworks.wmich.edu/math_pubs/42).
- The Deflated Sharpe Ratio corrects for selection bias under multiple testing and for non-normal returns — [Bailey & López de Prado 2014](https://papers.ssrn.com/abstract=2460551).

**Multiple testing (primary)**
- White's Reality Check tests whether the best model from a specification search has no superiority over a benchmark — [White 2000, Econometrica](https://users.ssc.wisc.edu/~bhansen/718/White2000.pdf).
- Hansen's SPA test is more powerful than the Reality Check and less sensitive to poor and irrelevant alternatives — [Hansen 2005 (JBES)](https://typeset.io/pdf/a-test-for-superior-predictive-ability-1fbgz05jht.pdf); [earlier working paper](https://economics.brown.edu/sites/g/files/dprerj726/files/papers/2003-9_paper.pdf).
- A new factor should clear t > 3.0, not 2.0, given extensive data mining — [Harvey, Liu & Zhu, NBER / RFS 2016](https://www.nber.org/papers/w20592). This threshold comes from the equity-factor literature; it is not a betting result.

**Secondary (not primary, marked separately)**
- Purging and embargo remove overlapping observations and add a buffer after the test set, attributed to López de Prado's 2018 book, which I did not reach — [Wikipedia](https://en.wikipedia.org/wiki/Purged_cross-validation); [purgedcv package](https://pypi.org/project/purgedcv/).

### Inferences
**Selection-bias size (calculation).** Using the expected-maximum expression in Bailey et al. and a normal approximation, the best of K zero-edge configurations shows an expected ROI of Emax(K) × σ / √613.
- Per-meeting return R = Y·M − 1 at break-even, with hit rate h and payout coefficient of variation c, has variance (1+c²)/h − 1.
- At h = 0.163, c = 0 gives σ = 2.27 and c = 2 gives σ = 5.45. The value c = 2 is an assumption; measure the real one.

| K tried | Emax | Spurious ROI, σ=2.27 | Spurious ROI, σ=5.45 |
|---|---|---|---|
| 10 | 1.57 | +14% | +35% |
| 50 | 2.28 | +21% | +50% |
| 200 | 2.77 | +25% | +61% |

Heavy-tailed payouts weaken the normal approximation, so treat these as orders of magnitude. The conclusion is that a backtest gain of tens of ROI points on 613 meetings is compatible with no edge at all, once a modest parameter search has been done.

**Bailey check (calculation).** The formula gives Emax(45)² = 2.236² = 5.0 years, matching the paper's example.

**Validation rules that follow:**
- Blocks by meeting date, never random splits of horses or legs within a meeting.
- Features computed as-of the bet time, including AGF/odds as seen at the bet time rather than final values. Benter's point about pre-post odds is the source of this rule.
- Any stacking layer fitted only on out-of-sample base predictions, which is Benter's rule.
- A trial ledger that counts every configuration, threshold and feature set, so that N is known.
- A sequestered forward period: freeze, record the prediction before the result, then score.

**Reconstructed coupons.** A coupon rebuilt today by today's logic is not a logged decision. The Li et al. guarantee requires uniformly random logging, which the reconstruction does not have, so those coupons carry no replay guarantee. They can test "what would this rule have produced on past legs" only if the rule and its inputs are as-of. Report them apart from coupons stored before the race, and do not count them as forward evidence.

**Payouts on reconstructed coupons.** A historical payout may include stake effects that the simulation ignores. Deza et al.'s adjustment for own wagers and breakage is the pattern to follow.

### Gaps
- Harvey & Liu's "Backtesting" (Sharpe haircut) was not retrieved; only the 2016 multiple-testing paper is cited.
- The full CSCV procedure was not read, so I give no value for the number of blocks. No source consulted gives a PBO pass threshold.
- White and Hansen require a loss series for every candidate, and their small-sample behaviour on heavy-tailed, 16%-hit returns was not established by the material read.
- No source found on validating models with reconstructed coupons in pools.

## Concept drift, retraining, champion-challenger, shadow deployment and monitoring

### Takeaway
Drift detection on 6/6 hits will be too slow, so monitor per-leg probabilistic error, inputs and calibration by slice. Treat retraining as a new challenger that must pass the same gate, with hard action limits that no learner can change.

### Cited Findings
**Drift (primary)**
- Concept drift is a change over time in the relation between inputs and target — [Gama et al., ACM Computing Surveys 2014](https://repositorio.inesctec.pt/handle/123456789/5370).
- A review of over 130 publications organises the field into detection, understanding and adaptation — [Lu et al., IEEE TKDE](https://arxiv.org/abs/2004.05785).
- Prequential error with forgetting gives reliable estimates; sliding windows or fading factors were needed for fast detection, and fading factors are faster and memoryless. In stationary data with consistent learners, the estimators converge to the Bayes error — [Gama, Sebastião & Rodrigues, Machine Learning 2013](https://repositorio.inesctec.pt/handle/123456789/5355).
- DDM signals a warning near 2σ and drift near 3σ above the minimum error level — [Lu et al. review](https://arxiv.org/pdf/2004.05785); implementation form p_min + 2·s_min and p_min + 3·s_min in [scikit-multiflow docs](https://scikit-multiflow.readthedocs.io/en/stable/api/generated/skmultiflow.drift_detection.DDM.html). DDM's premise is that error falls with more samples under a stationary distribution.
- ADWIN recomputes window size online and flags a difference between sub-windows, with parameter δ controlling false positives — [Bifet & Gavaldà, SDM 2007](https://researchportal.ip-paris.fr/en/publications/learning-from-time-changing-data-with-adaptive-windowing/); [docs](https://scikit-multiflow.readthedocs.io/en/stable/api/generated/skmultiflow.drift_detection.ADWIN.html).
- Sources of real-world decay at a track include a more skilful public, more dishonest racing, or another computer handicapper starting, and there is no guarantee that the future matches past simulations — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- Benter's practice was continuing model improvements and regular re-estimations that incorporated new data — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).

**System risks (primary)**
- CACE: Changing Anything Changes Everything, which also covers hyperparameters, sampling, thresholds and data selection — [Sculley et al.](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).
- Direct feedback loops: a model can influence the selection of its own future training data. Mitigations are some randomisation or isolating parts of the data — [same paper](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).
- Manually set thresholds may become invalid when the model updates, so learn them on held-out validation data — [same paper](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).
- What to monitor: prediction bias, sliced by dimension; action limits that trigger alerts and manual investigation; and upstream data producers — [same paper](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).
- A correction model stacked on another creates new dependencies and can harden into a cascade — [same paper](https://papers.nips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf).
- The ML Test Score offers 28 specific tests and monitoring needs for production readiness — [Breck et al., IEEE Big Data 2017](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**Blogs and vendor documents (practice descriptions, not evidence)**
- Shadow: the new model receives production traffic in parallel with the champion but does not serve its output — [Atlan guide](https://atlan.com/know/shadow-deployment-for-ml-models/).
- Real-world vetting can surface issues that hold-out data misses — [Microsoft Tech Community post by Wallaroo](https://techcommunity.microsoft.com/t5/startups-at-microsoft/optimizing-ml-models-in-production-in-the-cloud-or-at-the-edge/ba-p/4050704).
- Compare champion and candidate on the same data, with humans making the final promotion call — [Dataiku blog](https://blog.dataiku.com/mlops-champion-challenger-model-evaluation).
- Start the challenger in shadow mode, then gradually raise its traffic share before promotion — [Pega Academy](https://academy.pega.com/node/62616).
- A/B routes requests randomly between models, which differs from shadow — [Wallaroo tutorial](https://docs.wallaroo.ai/wallaroo-use-case-tutorials/wallaroo-use-case-classification/use-case-classification-cybersecurity/02-classification-financial-services-model-experiments).

### Inferences
- A pool bettor can shadow cheaply: the challenger produces a coupon before each race, it is stored with a timestamp, and no money is placed. A/B traffic splitting is not needed, and it would waste power. Both models can be scored on the same meetings as paired data.
- Shadow payouts must still be adjusted for the challenger's stake and for pool impact, since a paper coupon does not move the pool.
- Applying DDM-style detection directly to 6/6 hits is weak. A meeting is one Bernoulli trial at about 16%, so one standard deviation of a 50-meeting window is √(.163×.837/50) = 5.2 points, and a 3σ alert needs about a 15.6-point drop on that window. Run detectors on per-leg log loss, on the gain against AGF, and on feature distributions.
- The 2σ/3σ values are method defaults from DDM, not validated cut-offs for this data. Test false-alarm rates by replaying history first.
- Under CACE, an automatic retrain, a threshold change and a new feature each count as a new model and enter the trial ledger. Thresholds (for example akıllı BH trigger or OYNA/PAS) must be re-validated when the model behind them changes.
- Hard budget ceilings map directly onto Sculley's action limits. They belong outside the learner, cannot be changed by it, and should alert when hit.
- Feedback-loop risk: if storage or analysis keeps only coupons the current model favoured, the training data inherits the model's choices. Train horse probabilities on all runners and all legs, not only on those covered by coupons. Sculley's remedies, random exploration or an isolated data slice, are the alternatives.
- Default on detected drift: reduce stake or fall back to market-anchored probabilities and flag for review, rather than retraining and promoting automatically. Benter's fallback for unratable horses, assigning the public's probability, shows this type of behaviour. Extending it to drift is my suggestion.

### Gaps
- No peer-reviewed study found on champion-challenger in betting; the practice sources are vendors and blogs.
- No source gives a retraining cadence or a drift threshold for parimutuel data. Benter says only "regular".
- The Breck rubric's list of test categories was not read in full, only its abstract page.

## Rare events: horse-level learning, sample size, power and sequential testing

### Takeaway
100 six-of-six events cannot support learning or verifying a coupon-level model, while about 3,678 leg outcomes can support a small horse-level model. On 613 meetings, ROI differences below tens of points are undetectable, so promotion should be gated first on leg-level scoring and treat ROI as a safety check.

### Cited Findings
**Why horse level (primary)**
- Benter builds probabilities at horse level from conditional logit and combines them with the public. Bolton & Chapman's multinomial logit is the base — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- His experience: 500 to 1,000 races is the minimum for adequate development and testing; out-of-sample accuracy does not improve dramatically beyond 1,000 races in the development sample. His definition of a race's data includes full past data on all runners — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- His live operation started from about 2,000 races, bet about 470 races per year, and had four of five seasons in net profit, with a losing season of about 20% of starting capital. Reaching a significant advantage took about five man-years — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- In ultra-exotic bets such as the pick-six, even a modest model can produce advantage bets, summarised as "the more exotic the bet, the higher the advantage". He reports higher returns in exotic pools than in simple pools, but says a precise significance calculation was not made — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).
- Logistic regression can sharply underestimate rare-event probabilities, and coefficient bias in small samples is documented — [King & Zeng, Political Analysis 2001](https://dash.harvard.edu/handle/1/4125045).
- Required events depend on the setting: EPV is not an appropriate criterion alone — [van Smeden et al. 2019](https://dspace.library.uu.nl/bitstream/1874/387109/1/vansmeden.pdf).
- Riley's criteria: shrinkage S ≥ 0.9, difference of at most 0.05 between apparent and adjusted Nagelkerke R², and about 0.05 margin on overall risk. The formula is n = p / [(S−1)·ln(1 − R²cs/S)]. Examples needed about 4.8 and 23 events per parameter, so a flat 10 is too simplistic — [Riley et al., Statistics in Medicine 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6519266/).
- Deza et al. derive exotic probabilities from win models on 1,168 races (70/30 split), so 350 races out of sample, and assume independence between races for the streak constraint — [Deza, Huang & Metel](https://arxiv.org/pdf/1503.06535).

**Sequential testing (primary)**
- Among tests with the same power, SPRT requires on average the fewest observations — [Wald & Wolfowitz 1948](https://www.projecteuclid.org/euclid.aoms/1177730197). The result concerns simple hypotheses.
- Standard p-values are unreliable when a user keeps monitoring and stops on the result — [Johari, Koomen, Pekelis & Walsh, arXiv 1512.04922](https://arxiv.org/abs/1512.04922); [Operations Research 2022 record](https://econpapers.repec.org/RePEc:inm:oropre:v:70:y:2022:i:3:p:1806-1821).
- Always-valid p-values built on mSPRT allow stopping at any data-dependent time while controlling Type I error, with an efficient power and run-time tradeoff, and FDR control under monitoring — [arXiv 1512.04922 PDF](https://arxiv.org/pdf/1512.04922).
- Confidence sequences give intervals valid over an unbounded horizon with finite-sample coverage under nonparametric conditions, including sub-Gaussian and Bernstein settings — [Howard, Ramdas, McAuliffe & Sekhon, Annals of Statistics 2021](https://arxiv.org/abs/1810.08240).
- Even large differences take long to show: at coin-toss edges of 1.0% vs 1.1%, about two million trials give an 84% chance that one game dominates the other — [MacLean, Thorp & Ziemba, citing Thorp 2006](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).

### Inferences
All figures below are my calculations: normal approximation, two-sided α = .05 unless stated, and 80% power.

**Data counts.** 613 meetings × 6 legs = 3,678 leg outcomes if all legs are complete, against 100 coupon-level events. That is about 37 times more events, and it is above Benter's 500–1,000 race minimum in count. The match holds only if full runner histories exist for those races, which needs checking. The legs of a meeting are also not fully independent, so the effective count is lower.

**How much a direct 6/6 model can hold.** Inverting Riley's formula gives p = n·(S−1)·ln(1 − R²cs/S), with n = 613, S = 0.9. Here max R²cs = 0.589 at a 16.3% event rate. These R² values are assumptions, not measurements.

| Assumed Nagelkerke R² | R²cs | Max parameters |
|---|---|---|
| .05 | .029 | 2.0 |
| .10 | .059 | 4.2 |
| .15 | .088 | 6.3 |

So a coupon-level learner gets about 2 to 6 parameters. Its target also depends on coupon construction, so a change in the builder invalidates old labels. This is the strongest reason for learning at horse level, then composing to 6/6.

**Caveat on composition.** Multiplying leg probabilities assumes independence, as Deza et al. do. Leg-level dependence (track condition within a meeting) should be checked by comparing predicted against realised 6/6 rates. The 100 events are useful for this check on a low-parameter calibration, but not for learning horse-level weights.

**Precision of the current hit rate.** 100/613 has Wilson 95% interval 13.6% to 19.5%, so standard error 1.5 points. Because many events are on reconstructed coupons, this describes the stored mix and is not a live estimate.

**Comparing hit rates (from 16.3%).**

| Target hit rate | n per arm, unpaired | Against 613 meetings |
|---|---|---|
| 18.3% | 5,614 | About 9 times more |
| 20.0% | 1,702 | About 2.8 times more |
| 25.0% | 339 | Available |

**Paired comparison on the same meetings (McNemar approximation).** Only meetings where exactly one model hits count. If the challenger wins 60%, 65%, 70% or 75% of those discordant meetings, 194, 85, 47 or 29 discordant meetings are needed. Pairing is why shadow on the same meetings beats split traffic.

**ROI power.** n = ((z_α + z_β)·σ/δ)², one-sided α = .05, using the σ above. SE of ROI at 613 meetings is 9.2 points (c = 0) or 22 points (c = 2).

| ROI effect δ | n, σ=2.27 | n, σ=5.45 |
|---|---|---|
| 50 points | 127 | 734 |
| 20 points | 794 | 4,587 |
| 10 points | 3,175 | 18,347 |
| 5 points | 12,699 | 73,387 |

A paired test multiplies these by 2(1−ρ). With an assumed ρ = .8 that is 0.4, so the 10-point row becomes 1,270 or 7,339. Measure ρ between champion and challenger returns.

**SPRT example (Wald approximation, ignoring overshoot).** Testing hit rate 16.3% vs 25%, with α = .05, β = .20: log boundaries are +2.77 and −1.56. Expected n is about 61 under the null and 77 under the alternative, against 125 for a fixed one-sample test. This only works for a pre-specified simple alternative and i.i.d. meetings. It is a poor match for ROI, whose payouts are heavy-tailed and non-binary; for ROI use confidence sequences or always-valid methods with a bound suited to the tails.

**Suggested gate order (design proposal, thresholds to be set from TKP data, not sourced):**
1. Leg-level log loss on walk-forward data, compared with the market-only baseline and the champion, as a paired per-race or per-meeting series, using a sequential valid test.
2. Calibration by slice (field size, favourite odds, coverage bucket).
3. Composed 6/6 predicted vs realised rate, on stored forward coupons only.
4. ROI and drawdown as a guardrail: block on clear harm; do not require proof of ROI gain, because the tables show it takes years.

### Gaps
- Number of meetings per year for TKP was not part of the task, so calendar durations are not given.
- Real payout dispersion c and champion-challenger correlation ρ are unknown; both drive the ROI rows.
- Wald's boundary approximation (A ≈ (1−β)/α, B ≈ β/(1−α)) was used from standard knowledge. I verified the optimality paper's abstract but did not open Wald's 1945 text.
- No source found measuring between-leg dependence in pick-six style pools, or a power analysis for pick-six ROI.
- Benter's numbers come from a very large Hong Kong market and are his experience, not controlled results. Whether his minimum carries over to Turkish racing is not established.
- I did not verify a direct source for a leg-level paired log-loss test design in betting; the proposal above is a design inference.

## Kelly, fractional Kelly, estimation error and losing-streak control

### Takeaway
With overestimated edge, full Kelly turns harmful, and overestimation by a factor of two is easy. Size from shrunk or uncertainty-aware probabilities, keep a hard budget, and treat losing-streak limits as a real constraint that costs return.

### Cited Findings
**Kelly and fractional Kelly (primary)**
- Kelly maximises long-run growth, but wagers may be very large and short-term risk is high — [MacLean, Thorp & Ziemba 2010](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- Errors in means vs variances vs covariances are about 20:2:1 in importance, measured by cash-equivalent final wealth, for portfolio allocation — [same, citing Chopra & Ziemba 1993](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- Betting exactly twice the Kelly wager brings growth to zero for processes well approximated in continuous time — [same](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- For blackjack at a 2% advantage: half-Kelly has about 89% probability of doubling before halving, with 0.75 of full growth; full Kelly has 67% and 1.00; 1.5× has 56% and 0.75; 2× has 50% and zero — [same; table partly garbled in extraction, values checked against the closed form](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- Kelly can still go badly: 700 wagers, all with 14% advantage and at least 19% chance of winning, can turn $1,000 into $18. Half-Kelly can still produce $145 — [same](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- Because of the extreme sensitivity to errors in means, wager sizes should be reduced to be safe. Practitioners protecting capital sharply cut risk as drawdown grows — [same](https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf).
- Benter's reasons for fractional Kelly: overestimating advantage by more than a factor of two gives negative growth; many factors can make real-time advantage smaller than simulation, few can make it larger; full Kelly downswings above 50% are common. He suggests fractions such as 1/2 or 1/3 — [Benter 1994](https://www.Gwern.net/doc/statistics/decision/1994-benter.pdf).

**Estimation error (Metel, primary)**
- Metel argues that unbiased errors do not cancel under Kelly, since overestimated outcomes consistently get bigger wagers — [arXiv 1701.02814](https://arxiv.org/pdf/1701.02814).
- Models account for multinomial-logit parameter uncertainty, for example by the expected probabilities under the estimated parameter distribution, or by chance constraints on positive expected return — [same](https://arxiv.org/pdf/1701.02814).
- Results below are simulated, total expected returns summed over four experiments — [same](https://arxiv.org/pdf/1701.02814).

| Method | Sum of expected returns |
|---|---|
| True probabilities (upper limit) | 27.463 |
| Expected-log with chance constraint, level 0.40 (best) | 18.484 |
| Monte Carlo expected probabilities | 18.471 |
| Standard Kelly on point estimates | 18.134 |
| Half Kelly | 13.268 |
| Chance constraint, level 0.10 | 12.158 |

- Strict chance constraints dampen growth and need calibrating per application — [same](https://arxiv.org/pdf/1701.02814).
- Metel's parameters are simulated so that coefficients are significant at p ≤ .05, with n = 2, 10 or 30 outcomes. This setting may be kinder than a real model — [same](https://arxiv.org/pdf/1701.02814).

**Losing-streak control (Deza et al., primary)**
- The model maximises Kelly subject to a constraint that keeps losing streaks within the gambler's horizon with high probability, as a mixed-integer non-linear program — [arXiv 1503.06535](https://arxiv.org/abs/1503.06535).
- Case study: superfecta on 350 out-of-sample races at Flamboro Downs 2013–14, take 24.7%, half Kelly, $5,000 start, with confidence level 0.05 — [full text](https://arxiv.org/pdf/1503.06535).

| Horizon | Longest streak | Total return | Races bet | Average bet |
|---|---|---|---|---|
| None | 52 | 7.8% | 224 | $10.8 |
| 40 | 40 | 4.5% | 163 | $14.4 |
| 30 | 27 | 4.0% | 123 | $20.5 |
| 20 | 19 | 1.0% | 61 | $37.9 |

- The streaks were limited as intended, with a clear tradeoff: more selection, a larger average bet per race and less profit — [full text](https://arxiv.org/pdf/1503.06535).

**Kelly on a poorly selected model (Walsh & Joshi, primary)**
- Eighth-Kelly on the accuracy-selected model lost over 75%, while the calibration-selected one made +36.93%, which the authors take as showing the danger of Kelly without calibration. This comes from one season — [full text](https://arxiv.org/pdf/2303.06021).

### Inferences
**Growth under overestimation (calculation).** With log growth approximated as g(f) ≈ f·e − f²·v/2, the Kelly fraction is f* = e/v. Staking k·f* gives g/g* = 2k − k².

| k | .25 | .33 | .5 | 1 | 1.5 | 2 | 2.5 |
|---|---|---|---|---|---|---|---|
| g/g* | .44 | .55 | .75 | 1 | .75 | 0 | −1.25 |

If the true edge is half of the estimate, a "full Kelly" bet is effectively k = 2, which gives zero growth. This matches both Benter and MacLean et al. The approximation fits small, frequent edges and is poor for pick-six-like long shots, where the exact log objective should be used.

**Half Kelly is not automatically better.** In Metel's simulation half Kelly earned less than full Kelly on point estimates (13.27 vs 18.13), and uncertainty-aware models earned most. The choice depends on how much overbetting actually exists, which simulation sets by construction. Metel's result does not show that the methods work on real races.

**TKP implication.** TKP has a fixed coupon budget range, so it is already a capped-fraction regime, not pure Kelly. From memory notes the budget is 2,500–3,000; Kelly here is most useful as a PAS/OYNA signal and a sanity bound. Uncertainty-aware edge (lower bound after shrinkage) should drive whether to play, and the hard cap stays regardless.

**Losing streaks at TKP scale (calculation, exact DP, i.i.d. hits over 613 meetings).**

| Hit rate h | P(run ≥ 20 misses) | P(run ≥ 30) | P(run ≥ 40) | P(run ≥ 60) |
|---|---|---|---|---|
| 16.3% | .954 | .377 | .074 | .002 |
| 10% | >.999 | .946 | .600 | .097 |
| 5% | >.999 | >.999 | .996 | .786 |

- At 16.3%, a 20-meeting dry spell is expected across this history, so it is not on its own evidence of drift or a broken model. Any drawdown alarm must be calibrated against this table.
- A dry run of 17 from a given start occurs with about 5% probability: ln(.05)/ln(.837) = 16.8.
- Deza-style target: for horizon τ and confidence .05, the per-play hit probability must be at least 1 − .05^(1/τ). This is 13.9% for τ = 20, 9.5% for τ = 30 and 7.2% for τ = 40. A bankroll rule can therefore be stated as "survive N budgets at the current hit rate", and N must exceed the matching dry-run length.
- This also tests a bankroll target: with 3,000 per meeting and h = 16.3%, 20 misses cost 60,000 before any hit. Budget per meeting is taken from memory notes and should be checked. Deza et al. end a streak only on a win above a minimum profit, so a small consolation payout need not reset the count.
- Non-stationary hit rates, or falling hit rates within a drift episode, make these streaks longer than the i.i.d. table shows.

### Gaps
- MacLean, Thorp, Zhao & Ziemba's simulations and MacLean, Ziemba & Blazenko 1992 were not read directly, so their fraction-vs-risk tables are not cited beyond the summary paper.
- Blackjack table values do not transfer to Altılı, as they assume small edges and frequent bets. No source found gives a safe Kelly fraction for pick-six pools.
- Metel's results are simulated only. I found no real-race replication.
- Deza et al. is one season at one harness track with superfecta, not pick-six, and the source reports no significance test for the differences in return among horizons.
- Symbols in Metel's and Deza's tables were lost in text extraction. I identify the chance-constraint level from surrounding text ("tested using … 0.4, 0.25, and 0.1").
