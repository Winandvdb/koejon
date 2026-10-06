---
id: task-20
title: Pulse the Gezien and Ik ga buttons
status: To Do
assignee: []
created_date: '2026-10-06 18:19'
labels:
  - ui
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The active player's nameplate pulses with a gold glow (`.nameplate.active`, `@keyframes glow` in src/app.css). The action buttons that wait on the player do not pulse. Give the "Gezien" button (ack) and the "Ik ga" button (bid, play: true) in src/components/Table.svelte the same pulsating effect, so the player sees that the game waits on them. Reuse the existing `glow` keyframes. The "Pas" button and the other buttons stay as they are.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Gezien button pulses with the same gold glow as the active nameplate
- [ ] #2 The Ik ga button pulses with the same gold glow
- [ ] #3 The Pas button and the other fab buttons do not pulse
- [ ] #4 With prefers-reduced-motion: reduce, the buttons show a static gold ring and no animation
- [ ] #5 The effect works in the light and dark theme and at phone width
<!-- AC:END -->
