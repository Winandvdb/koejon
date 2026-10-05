---
id: task-5
title: Make card suit symbols bigger
status: In Progress
assignee:
  - '@lab900-winand-vandenbergh'
created_date: '2026-09-30 19:45'
updated_date: '2026-10-05 09:40'
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
- [ ] #1 Suit symbols on cards are visibly larger
- [ ] #2 Card layout still fits without clipping or overlap
<!-- AC:END -->
