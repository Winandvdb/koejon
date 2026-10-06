---
id: task-10
title: 'Table UI fixes: button colours, troefke bubble, waiting text overlap'
status: In Progress
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:14'
updated_date: '2026-10-06 07:22'
labels:
  - ui
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Small visual issues on the table screen from player feedback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The 'Ik ga' button has a colour that stands out from the table background
- [x] #2 All other buttons that used the same colour (e.g. 'Gezien') get the same new colour, so button colours stay consistent
- [x] #3 The troefke bubble shows on the bidder who asks, not on the partner who must play (today it shows on seat === pub.turn in Table.svelte)
- [x] #4 The troefke bubble text reads 'Troefke' instead of 'Troef?'
- [ ] #5 The 'Wachten op …' text does not overlap the quote bubbles
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add --cta/--cta-contrast tokens (light+dark) in app.css and point .fab.primary at them -> check: Ik ga, Gezien, next-hand and new-match buttons share one colour that contrasts the green felt; build passes
2. Table.svelte: troefke bubble condition seat === pub.turn -> seat === pub.bidder -> check: engine sets turn=(bidder+2)%4, so bubble rides on the bidder nameplate; svelte-check passes
3. i18n troefWanted: nl "Troefke", en "Trump!" -> check: both locales updated
4. Lift .wait-hint above my nameplate bubbles: conditional class when sayings/bid/troefke bubble shows on my seat -> check: CSS-only lift, no overlap; visual check by hand
5. npm test + npm run build -> check: both green
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changed: new --cta/--cta-contrast tokens (light + dark) in app.css; .fab.primary now uses them so Ik ga/Gezien/next-hand/new-match share one colour that contrasts the felt. Table.svelte: troefke bubble now shows on pub.bidder (engine sets turn=(bidder+2)%4). i18n troefWanted: nl 'Troefke', en 'Trump!'. wait-hint gets class 'lifted' (+96px margin) when any bubble shows on my nameplate. Verified: npm test (113 pass), npm run build (svelte-check 0 errors). Check by hand: button colour stands out on the felt in both themes; wait-hint clears quote bubbles; troefke bubble rides on the bidder.

Extra fix (player feedback): nameplate bubbles are now one .bubbles flex stack instead of fixed slots — a quote bubble drops next to the nameplate when no bid/troefke bubble is present. Only the lowest bubble keeps a tail; side-seat phone anchoring moved to the stack.
<!-- SECTION:NOTES:END -->
