---
id: task-8
title: Add and adjust table quotes
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 06:48'
labels:
  - quotes
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New table-talk sayings from player feedback, plus one condition fix. Quotes live in src/lib/quotes.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 'Dan zullen we dat nog eens proberen' fires when a player wins a trick with a suit and then leads that suit again
- [ ] #2 'Hier ben ik helemaal van slag van' and 'Dat is een slag in het gezicht' fire when the player's team loses a trick
- [ ] #3 'Wij zijn er nog denk' and ''T is nog van ons, telt maar na' fire when a team reaches 21 points on the last trick
- [ ] #4 'Wanneer gaan de kaarten draaien?' (or similar) fires when a team has not crossed off any mark (meetje vegen) yet
- [ ] #5 'We zijn er al se' fires at 21 points instead of 20
<!-- AC:END -->
