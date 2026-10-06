---
id: doc-1
title: 'Spike: personal statistics with anonymous login'
type: technical
created_date: '2026-10-06 09:06'
---

# Spike: personal statistics with anonymous login

Task: task-13. Question: can we track per-player statistics (games played, games won,
bids made, bids won) when the only identity is the anonymous Firebase uid?

Short answer: yes, but the anonymous uid gives no advantage over `localStorage`.
Both live in the same browser storage and are lost in the same cases. The uid adds
cost and one more way to lose the data. Keep personal statistics in `localStorage`.
Put them in Firestore only together with a real account.

## 1. How the identity works today

- `src/lib/firebase.ts` calls `signInAnonymously` with
  `indexedDBLocalPersistence` (fallback `browserLocalPersistence`). Firebase keeps
  the signed-in user in IndexedDB of the page origin. On the next visit the SDK
  restores that user, so `signInAnonymously` gives the **same uid** again.
- The ID token expires every hour, but the SDK refreshes it. The uid does not change.
- `App.svelte` copies the uid into `localStorage['koejon-uid']`. When sign-in fails
  (offline start), it uses that copy, or a new `local-<uuid>` id. A `local-` id has
  no Firebase account and cannot write to Firestore.

## 2. How long a player identity lasts

The anonymous uid and `localStorage` are both script-writable storage of one origin.
The table applies to both, except the "Firebase side" row, which applies only to the uid.

| Situation | Kept? | Notes |
|---|---|---|
| Reload, close and open the tab, restart the browser or the device | Yes | |
| Months of normal use in Chrome, Firefox, Edge (desktop, Android) | Yes | No expiry on the browser side. |
| Other browser on the same device | No | Each browser has its own storage. |
| Other device (phone and laptop) | No | Nothing links the two. The player has two separate stat sets. |
| Other browser profile | No | Same as another browser. |
| Private / incognito window | No | New storage each private session. It is lost when the window closes. |
| Player clears site data, cookies or history | No | Lost for good. A Firestore doc under the old uid stays, but nobody can reach it. |
| Safari tab (iOS and macOS), no visit for 7 days | No | WebKit ITP deletes script-writable storage (IndexedDB, localStorage) after 7 days without interaction with the site. A weekly card night can just miss this limit. |
| Device low on disk space | Maybe not | The browser can evict site data. Rare. `navigator.storage.persist()` asks the browser to keep it (see section 3). |
| Other origin (`koejon.web.app`, `koejon-3059e.firebaseapp.com`, dev channel, PR previews) | No | Storage is per origin. Dev and live data are always separate. |
| Offline start | uid: no / localStorage: yes | Without a token the tab cannot write to Firestore. `localStorage` works offline. |
| Firebase side (uid only) | Yes, by default | See below. |

### Installed app (PWA)

| Platform | Storage of the installed app | Effect |
|---|---|---|
| iOS, home screen app | Own storage, **separate from Safari**. Its 7-day counter counts only days of use, so in practice the data stays. | Kept well. But the Safari tab and the app keep two different stat sets. An invite link opens in Safari, not in the app, so a game joined by link counts in Safari, where the 7-day limit applies. Removing the app from the home screen deletes its data. |
| Android, Chrome | Same storage as Chrome for the origin. | One stat set for tab and app. Clearing site data in Chrome also clears the app. |
| Desktop, Chrome or Edge | Same storage as the browser profile. | Same as Android. |

### Anonymous account clean-up (Firebase side)

Anonymous accounts do not expire by default. **Exception:** in a project upgraded
to Identity Platform, the console can turn on "automatic clean-up". It deletes
anonymous accounts 30 days after **creation**, not after the last visit, so an
active player also loses the account. The browser then gets a new uid on the next
sign-in. Projects turn it on because, with Identity Platform, anonymous users
count as monthly active users (free up to 50,000 per month). A small card game
stays far below that. Check the console setting; I did not look.

Statistics in `localStorage` do not depend on the Firebase account, so clean-up has no effect on them.

### Summary

The data lasts as long as the browser storage of one origin on one device.
On Android and desktop that is usually "until the player clears data".
In an iOS Safari tab it can be only 7 days between visits; the iOS home screen app keeps it.
A player who uses two devices, or Safari and the iOS app, has two stat sets.

## 3. Data design

Keep the statistics in `localStorage`, in the style of `src/lib/prefs.ts`:

```
localStorage['koejon-stats'] = { played, won, bidsMade, bidsWon }
```

- **Where the numbers come from:** the engine already knows `bidder` and
  `lastResult` (`playingTeam`, `winnerTeam`) per hand, and `winner` per match. Add
  per-seat counters to the engine state (bids made, bids won). They go into `pub`,
  so a guest that reloads mid-match still has correct numbers.
- **When to write:** once per match, when the client sees `GAME_OVER`. Store the
  match seed (or room code + match number) with it, so a reload on the end screen
  does not count the same match twice. An abandoned match does not count.
- **Bots:** only the human client writes, and only for its own seat.
- **Solo:** works the same way, also offline.
- **Keep the data:** call `navigator.storage.persist()` once, for example when the
  first match ends. Chrome usually grants it for an installed app. Wrap
  `localStorage` in try/catch (AGENTS.md rule).
- **Cheating:** the player can edit their own numbers. Only that player sees them, so this is acceptable.

### Why not Firestore under the anonymous uid

| | `localStorage` | Firestore + anonymous uid |
|---|---|---|
| Lost when storage is cleared, Safari 7 days, other device | Yes | Yes (same storage holds the uid) |
| Lost by account clean-up | No | Yes, if clean-up is on |
| Works offline and in solo | Yes | No |
| Firestore cost, security rule | None | Writes per match + a rule |
| Others can see the numbers (leaderboard) | No | Possible |
| Ready for account linking | Upload once at link time (1 write) | Already there |

Firestore only helps when other players must see the numbers. The task asks for
personal statistics only.

## 4. Extra Firestore cost

**With `localStorage`: zero.** No reads, no writes, no storage.

For the later account option (section 5), the data moves to `players/{uid}`,
written with `increment()` by each human client for its own uid. The rule needs
no `get()`, so it adds no billed reads:

```
match /players/{uid} {
  allow read, write: if signedIn() && request.auth.uid == uid;
}
```

Prices (Firestore Standard, regional `europe-west1`): reads $0.03 and writes $0.09
per 100,000 documents. Spark (free) quota: 50,000 reads and 20,000 writes per day.

Example load: 200 multiplayer matches per day, all 4 seats human, and 1,000 stats views per day.

| | Per day | Share of free quota | Per month if paid |
|---|---|---|---|
| Writes (1 per human per match) | 800 | 4% of 20,000 | 24,000 × $0.09/100k ≈ $0.02 |
| Reads (1 per stats view) | 1,000 | 2% of 50,000 | 30,000 × $0.03/100k ≈ $0.01 |
| Storage | ~300 bytes per player | — | 100,000 docs ≈ 30 MB, inside the 1 GiB free storage |

If we write per hand instead of per match, the writes go up by the number of hands
in a match. A match of 20 hands gives 80 writes instead of 4.
200 such matches per day give 16,000 writes, which is 80% of the free write quota.
So write once per match.

## 5. Link to a real account (later option)

Firebase can upgrade the anonymous user with `linkWithCredential` / `linkWithPopup`
(Google, or e-mail link). The uid stays the same, and clean-up never deletes a
linked account. This is the only option that gives statistics across devices and
browsers. At link time, the client writes its `localStorage` numbers to
`players/{uid}` once. Costs and risks:

- New UI: sign-in button, signed-in state, sign-out.
- `firebase.ts` uses `initializeAuth` without a popup resolver on purpose (no
  `iframe.js` / gapi load at start). Linking needs it. We can load it only when the
  player taps "link account".
- `firebase.json` sets `Cross-Origin-Opener-Policy: same-origin`. That can break the
  Google popup flow. Use the redirect flow or e-mail link, or relax the header.
- Second device: the account is already linked to the first uid
  (`auth/credential-already-in-use`). The second device signs in to the first uid.
  Add its local numbers to the account doc, or drop them.
- Privacy: we then store an e-mail address. We need a short privacy notice.

This is several times the work of the statistics feature itself.

## 6. Recommendation

**Build it, in `localStorage`. Do not use Firestore under the anonymous uid. Do not link a real account now.**

- Cost: zero. No Firestore reads or writes, no new security rule.
- Durability: the same as the anonymous uid, and clean-up cannot delete it. The
  installed app keeps it well, also on iOS. It is weakest in an iOS Safari tab
  (7-day limit) and for players with two devices.
- Show the numbers as "statistics on this device". Then a loss does not surprise the player.
- Call `navigator.storage.persist()` so the browser keeps the data.
- Make account linking a separate follow-up task. Do it only when players ask
  for statistics across devices, or for statistics that other players can see.
  Then upload the local numbers once to `players/{uid}`.

## Sources

- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Firebase: authenticate anonymously (web), automatic clean-up](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Safari 7-day cap on script-writable storage](https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519)
- [WebKit bug 211775: home screen web apps and the 7-day cap](https://bugs.webkit.org/show_bug.cgi?id=211775)
