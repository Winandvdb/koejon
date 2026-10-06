---
id: task-13
title: 'Spike: personal statistics with anonymous login'
status: Done
assignee:
  - '@Winandvdb'
created_date: '2026-10-05 07:15'
updated_date: '2026-10-06 09:18'
labels:
  - spike
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Find out if we can track per-player statistics (games played, games won, bids made, bids won) with anonymous Firebase login.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A short write-up explains how long a player identity lasts across devices, sessions and cleared browsers
- [x] #2 The write-up estimates the extra Firestore cost
- [x] #3 The write-up ends with a recommendation: build it, link to a real account, or drop it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read auth, Firestore, room and engine code -> check: identity and data sources noted in the doc
2. Write identity lifetime table (AC #1) -> check: doc section 2
3. Estimate Firestore cost (AC #2) -> check: doc section 4
4. Write recommendation (AC #3) -> check: doc section 6
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Write-up in backlog/docs/doc-1 (Spike: personal statistics with anonymous login). The anonymous uid and localStorage live in the same browser storage and are lost in the same cases (cleared data, other browser/device, Safari 7-day cap). Anonymous auto clean-up (Identity Platform) deletes uids 30 days after creation. Installed PWA: iOS keeps its own storage separate from Safari; Android/desktop share it with the browser. Recommendation: keep stats in localStorage (zero Firestore cost), label 'on this device', call navigator.storage.persist(); Firestore only together with a real account (follow-up). No code changes. Check by hand: Firebase console setting for anonymous automatic clean-up.
<!-- SECTION:NOTES:END -->
