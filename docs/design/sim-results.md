Scenario: 10 entities (6 AI), 200 guessers, 1 chip per guess, 3000 rounds, 2000 chips staked per round

## Model A: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right guessers | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 20 | 180 | 1 + 0.08 | 4.0 |
| A2 | ai | 30% | 60 | 140 | 1 + 0.30 | 12.0 |
| A3 | ai | 50% | 100 | 100 | 1 + 0.71 | 20.0 |
| A4 | ai | 60% | 120 | 80 | 1 + 1.07 | 24.0 |
| A5 | ai | 70% | 140 | 60 | 1 + 1.67 | 28.0 |
| A6 | ai | 85% | 170 | 30 | 1 + 4.11 | 34.0 |
| H1 | human | 90% | 20 | 180 | 1 + 0.08 | 4.0 |
| H2 | human | 75% | 50 | 150 | 1 + 0.24 | 10.0 |
| H3 | human | 55% | 90 | 110 | 1 + 0.58 | 18.0 |
| H4 | human | 40% | 120 | 80 | 1 + 1.07 | 24.0 |

Totals per round: house 89 chips, entities 178, guessers net -267 (of 2000 staked)

## Model B: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right guessers | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 20 | 180 | 1 + 0.00 | 20.1 |
| A2 | ai | 30% | 60 | 140 | 1 + 0.00 | 60.2 |
| A3 | ai | 50% | 100 | 100 | 1 + 0.00 | 100.0 |
| A4 | ai | 60% | 120 | 80 | 1 + 0.00 | 120.1 |
| A5 | ai | 70% | 140 | 60 | 1 + 0.00 | 140.2 |
| A6 | ai | 85% | 170 | 30 | 1 + 0.00 | 170.0 |
| H1 | human | 90% | 20 | 180 | 1 + 0.11 | 0.0 |
| H2 | human | 75% | 50 | 150 | 1 + 0.34 | 0.0 |
| H3 | human | 55% | 90 | 110 | 1 + 0.83 | 0.0 |
| H4 | human | 40% | 120 | 80 | 1 + 1.52 | 0.0 |

Totals per round: house 0 chips, entities 611, guessers net -611 (of 2000 staked)

## Model D: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right guessers | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 20 | 180 | 1 + 1.00 | 4.0 |
| A2 | ai | 30% | 60 | 140 | 1 + 1.00 | 12.0 |
| A3 | ai | 50% | 100 | 100 | 1 + 1.00 | 20.0 |
| A4 | ai | 60% | 120 | 80 | 1 + 1.00 | 24.0 |
| A5 | ai | 70% | 140 | 60 | 1 + 1.00 | 28.0 |
| A6 | ai | 85% | 170 | 30 | 1 + 1.00 | 34.0 |
| H1 | human | 90% | 20 | 180 | 1 + 1.00 | 4.0 |
| H2 | human | 75% | 50 | 150 | 1 + 1.00 | 10.0 |
| H3 | human | 55% | 90 | 110 | 1 + 1.00 | 18.0 |
| H4 | human | 40% | 120 | 80 | 1 + 1.00 | 24.0 |

Totals per round: house -396 chips, entities 178, guessers net 218 (of 2000 staked)

## Model C (one common pot): every right chip earns the same 1 + 0.56 regardless of the entity; house 89, entities 178

## Closed form, model A. Against a crowd of which share h (by stake) says "human", on an entity you believe is AI with probability q:
profit per chip, guess ai    = q * 0.7 * h/(1-h)   - (1-q)
profit per chip, guess human = (1-q) * 0.7 * (1-h)/h - q
  h=0.3: guessing "ai" is +EV once your own confidence q > 77%
  h=0.5: guessing "ai" is +EV once your own confidence q > 59%
  h=0.7: guessing "ai" is +EV once your own confidence q > 38%
  h=0.85: guessing "ai" is +EV once your own confidence q > 20%

---

Scenario: 10 entities (6 AI), 200 guessers, stakes of 1, 3 or 10 chips, 3000 rounds, 5002 chips staked per round

## Model A: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right chips of stake | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 50 | 450 | 1 + 0.08 | 10.0 |
| A2 | ai | 30% | 150 | 350 | 1 + 0.31 | 30.1 |
| A3 | ai | 50% | 251 | 249 | 1 + 0.72 | 50.1 |
| A4 | ai | 60% | 301 | 200 | 1 + 1.08 | 60.1 |
| A5 | ai | 70% | 350 | 150 | 1 + 1.69 | 70.0 |
| A6 | ai | 85% | 425 | 75 | 1 + 4.26 | 85.0 |
| H1 | human | 90% | 51 | 449 | 1 + 0.08 | 10.1 |
| H2 | human | 75% | 125 | 375 | 1 + 0.24 | 25.0 |
| H3 | human | 55% | 226 | 274 | 1 + 0.59 | 45.2 |
| H4 | human | 40% | 300 | 200 | 1 + 1.08 | 60.0 |

Totals per round: house 223 chips, entities 446, guessers net -668 (of 5002 staked)

## Model B: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right chips of stake | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 50 | 450 | 1 + 0.00 | 50.2 |
| A2 | ai | 30% | 150 | 350 | 1 + 0.00 | 150.4 |
| A3 | ai | 50% | 251 | 249 | 1 + 0.00 | 250.5 |
| A4 | ai | 60% | 301 | 200 | 1 + 0.00 | 300.6 |
| A5 | ai | 70% | 350 | 150 | 1 + 0.00 | 350.0 |
| A6 | ai | 85% | 425 | 75 | 1 + 0.00 | 425.2 |
| H1 | human | 90% | 51 | 449 | 1 + 0.11 | 0.0 |
| H2 | human | 75% | 125 | 375 | 1 + 0.34 | 0.0 |
| H3 | human | 55% | 226 | 274 | 1 + 0.84 | 0.0 |
| H4 | human | 40% | 300 | 200 | 1 + 1.54 | 0.0 |

Totals per round: house 0 chips, entities 1527, guessers net -1527 (of 5002 staked)

## Model D: per entity, averages per round
| entity | kind | crowd says human | wrong stake (pool) | right chips of stake | payout per right chip | entity earns |
|---|---|---|---|---|---|---|
| A1 | ai | 10% | 50 | 450 | 1 + 1.00 | 10.0 |
| A2 | ai | 30% | 150 | 350 | 1 + 1.00 | 30.1 |
| A3 | ai | 50% | 251 | 249 | 1 + 1.00 | 50.1 |
| A4 | ai | 60% | 301 | 200 | 1 + 1.00 | 60.1 |
| A5 | ai | 70% | 350 | 150 | 1 + 1.00 | 70.0 |
| A6 | ai | 85% | 425 | 75 | 1 + 1.00 | 85.0 |
| H1 | human | 90% | 51 | 449 | 1 + 1.00 | 10.1 |
| H2 | human | 75% | 125 | 375 | 1 + 1.00 | 25.0 |
| H3 | human | 55% | 226 | 274 | 1 + 1.00 | 45.2 |
| H4 | human | 40% | 300 | 200 | 1 + 1.00 | 60.0 |

Totals per round: house -991 chips, entities 446, guessers net 545 (of 5002 staked)

## Model C (one common pot): every right chip earns the same 1 + 0.56 regardless of the entity; house 223, entities 446

## Closed form, model A. Against a crowd of which share h (by stake) says "human", on an entity you believe is AI with probability q:
profit per chip, guess ai    = q * 0.7 * h/(1-h)   - (1-q)
profit per chip, guess human = (1-q) * 0.7 * (1-h)/h - q
  h=0.3: guessing "ai" is +EV once your own confidence q > 77%
  h=0.5: guessing "ai" is +EV once your own confidence q > 59%
  h=0.7: guessing "ai" is +EV once your own confidence q > 38%
  h=0.85: guessing "ai" is +EV once your own confidence q > 20%
