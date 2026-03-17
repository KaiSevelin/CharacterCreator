# Reward Monte Carlo Report

Date: 2026-03-16

## Scope

This report estimates the number and type of rewards added during a `14`-step run starting from the real character-generation entry point:

- `Birth - Horoscope (3d6)`

It follows the authored rolltable routing from horoscope into humors and onward.

## Assumptions

- `4000` runs
- one result is selected per step by rolling the table's `3d6` ranges directly
- routing follows the selected effect row's `NextTable`
- effect rows are resolved using their authored weights from `Effects1`, `Effects2`, and `Effects3`
- baseline package is excluded
  - no automatic starting `+1` to all stats
  - no automatic grant of min-level-0 skills
- story-thread rewards are excluded

Important note:

- this is a simulation of the authored `3d6` table graph
- it is not a simulation of the current UI card-offer behavior, because `_rollCards()` still offers results uniformly rather than by `3d6` table range

## Results

### Horoscope start

- start table: `Birth - Horoscope (3d6)`
- runs: `4000`
- average completed steps: `11.42`
- chance to reach full `14` steps: `41.15%`
- chance to end early: `58.85%`
- average total rewards added: `21.472`

Average rewards by type per run:

- `stat`: `6.164`
- `skill`: `5.808`
- `bio`: `3.864`
- `item`: `1.741`
- `drive`: `1.338`
- `social`: `0.686`
- `money`: `0.632`
- `contact`: `0.553`
- `language`: `0.253`
- `luck`: `0.250`
- `body`: `0.131`
- `maneuver`: `0.052`

## Main Findings

- Starting from the real entry point changes the reward picture substantially.
- `stat` is now the dominant reward lane, not a minor one, because horoscope and humors contribute a large early burst of stat outcomes.
- `skill` remains the second major lane.
- `bio` remains strong, but it sits behind `stat` and `skill`.
- `item` and `drive` form the next visible band.
- `maneuver` is still nearly absent.
- `body` remains rare.
- `language` and `luck` remain uncommon.

## Reading The Economy

Under the real start sequence, the generator is best described as:

- heavy on `stat`
- heavy on `skill`
- still quite strong on `bio`
- light on `maneuver`
- light on `body`
- modest on `contact`, `money`, and `social`

So the corrected simulation says the current system is not merely skill-forward. It is:

- birth-phase stat heavy
- then skill heavy
- then bio rich

## Practical Interpretation

If your intended design is:

- a few stats
- many skills and bios
- sparse maneuvers

then the actual full-run generator is currently too stat-dense.

If your intended design is:

- horoscope and humors should matter strongly

then the present result is coherent, but you should understand that those two tables dominate the early-life reward economy.

## Superseded Earlier Draft

An earlier version of this report used `Birth - Origin` and `Adolescence - Turning Point` as start points. That was not the real entry flow and should be treated as superseded by this version.
