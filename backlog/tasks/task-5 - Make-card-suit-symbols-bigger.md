---
id: task-5
title: Make card suit symbols bigger
status: Done
assignee:
  - '@lab900-winand-vandenbergh'
created_date: '2026-09-30 19:45'
updated_date: '2026-10-05 10:09'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Increase the size of the suit signs (SUIT_GLYPH) shown on cards. The main rendering is in src/components/CardView.svelte (corner indices, center pip, court suit); check other places that display suit glyphs (e.g. the turned trump card, InfoPanel) and size them consistently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Suit symbols on cards are visibly larger
- [x] #2 Card layout still fits without clipping or overlap
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Enlarge corner suit, center pip and court suit in src/app.css -> check: AC1 by eye
2. Check layout at small and large card sizes -> check: AC2 by hand
3. npm test and npm run build -> check: both pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/app.css only: corner suit 0.9em -> 1.25em, center pip 0.52 -> 0.62 of card width, court suit 0.2 -> 0.24, court letter 0.44 -> 0.4 and raised so it clears the suit. CardView is reused by the turned trump card, so it follows. InfoPanel suit glyph and the dealer-choice buttons are not on cards: left unchanged. Real court art was tried and dropped. npm test and npm run build pass. Layout checked by hand: no clipping or overlap.
<!-- SECTION:NOTES:END -->
