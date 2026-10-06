---
id: doc-1
title: 'Spike: personal statistics with anonymous login'
type: technical
created_date: '2026-10-06 09:06'
---

# Spike: personal statistics with anonymous login

Task: task-13. Question: can we track per-player statistics (games played, games won,
bids made, bids won) when the only identity is the anonymous Firebase uid?

Short answer: yes, and it costs almost nothing. The weak point is not cost but
identity: the uid belongs to one browser on one device, and some browsers delete it.

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

| Situation | Same uid? | Notes |
|---|---|---|
| Reload, close and open the tab, restart the browser or the device | Yes | IndexedDB stays. |
| Months of normal use in Chrome, Firefox, Edge (desktop, Android) | Yes | No expiry on the browser side. |
| Other browser on the same device | No | Each browser has its own storage. |
| Other device (phone and laptop) | No | Nothing links the two. The player has two separate stat sets. |
| Other browser profile | No | Same as another browser. |
| Private / incognito window | No | New uid each private session. Stats from it are lost when the window closes. |
| Player clears site data, cookies or history | No | The uid is lost for good. The old stats doc stays in Firestore, but nobody can reach it. |
| Safari (iOS and macOS), no visit for 7 days | No | WebKit ITP deletes script-writable storage (IndexedDB, localStorage) after 7 days without interaction with the site. A weekly card night can just miss this limit. |
| iOS app on the home screen (PWA) | Separate uid | The home screen app has its own storage, separate from Safari. Its 7-day counter counts only days of use, so in practice it keeps the uid. But it is a different uid from the Safari one. |
| Other origin (`koejon.web.app`, `koejon-3059e.firebaseapp.com`, dev channel, PR previews) | No | Storage is per origin. Dev and live stats are always separate. |
| Firebase side | Yes, by default | Anonymous accounts do not expire. **Exception:** with Identity Platform, the console can turn on "automatic clean-up", which deletes anonymous accounts 30 days after creation. That would break statistics. It must stay off. (Check the console setting before we build; I did not look.) |
| Offline start | No stats | The tab uses a `local-` id or the stored uid without a token. It cannot write. |

Summary: the identity lasts as long as the browser storage of that one origin.
On Android and desktop that is usually "until the player clears data".
On iOS Safari it can be only 7 days between visits. A player who uses two devices has two identities.

## 3. Data design (for the estimate)

One document per player: `players/{uid}`.

```
{ played: number, won: number, bidsMade: number, bidsWon: number, updated: timestamp }
```

- **Who writes:** each human client writes its own doc, with `increment()`.
  The host does not write for other players. This keeps the rule simple and needs
  no `get()` in the rule (a `get()` is a billed read):

  ```
  match /players/{uid} {
    allow read, write: if signedIn() && request.auth.uid == uid;
  }
  ```

  A player can inflate their own numbers. Only that player sees them, so this is acceptable.
- **Where the numbers come from:** the engine already knows `bidder` and
  `lastResult` (`playingTeam`, `winnerTeam`) per hand, and `winner` per match. Add
  per-seat counters to the engine state (bids made, bids won). They go into `pub`,
  so a guest that reloads mid-match still has correct numbers.
- **When to write:** once per match, when the client sees `GAME_OVER`.
  An abandoned match does not count. Write per hand only if we decide that
  abandoned matches must count (see the cost below).
- **Bots:** seats with uid `bot:` never write.
- **Solo:** solo has no Firestore traffic today. Solo stats need one write per match
  while online. Or we keep solo stats in `localStorage` only. This is an open product choice.
- **Read:** one `getDoc` when the player opens the statistics view. Not on each app start.

## 4. Extra Firestore cost

Prices (Firestore Standard, regional `europe-west1`): reads $0.03 and writes $0.09
per 100,000 documents. Spark (free) quota: 50,000 reads and 20,000 writes per day.

Per match with 4 humans:

| Operation | Count |
|---|---|
| Write `players/{uid}` at match end | 4 (1 per human) |
| Rule `get()` reads | 0 |
| Read stats when a player opens the view | 1 per open |

Example load: 200 multiplayer matches per day, all 4 seats human, and 1,000 stats views per day.

| | Per day | Share of free quota | Per month if paid |
|---|---|---|---|
| Writes | 800 | 4% of 20,000 | 24,000 × $0.09/100k ≈ $0.02 |
| Reads | 1,000 | 2% of 50,000 | 30,000 × $0.03/100k ≈ $0.01 |
| Storage | ~300 bytes per uid | — | 100,000 docs ≈ 30 MB, inside the 1 GiB free storage |

If we write per hand instead of per match, the writes go up by the number of hands
in a match. A match of 20 hands gives 80 writes instead of 4.
200 such matches per day give 16,000 writes, which is 80% of the free write quota.
That is why the design writes once per match.

Orphan docs (uids that are lost) only cost storage. That cost stays near zero.

## 5. Link to a real account (option)

Firebase can upgrade an anonymous user with `linkWithCredential` / `linkWithPopup`
(Google, or e-mail link). The uid stays the same, so the stats stay too. A linked
account also never falls under automatic clean-up. Costs and risks:

- New UI: sign-in button, signed-in state, sign-out.
- `firebase.ts` uses `initializeAuth` without a popup resolver on purpose (no
  `iframe.js` / gapi load at start). Linking needs it. We can load it only when the
  player taps "link account".
- `firebase.json` sets `Cross-Origin-Opener-Policy: same-origin`. That can break the
  Google popup flow. Use the redirect flow or e-mail link, or relax the header.
- Second device: the account is already linked to the first uid
  (`auth/credential-already-in-use`). The second device signs in to the first uid.
  Its own anonymous stats must be merged or are dropped.
- Privacy: we then store an e-mail address. We need a short privacy notice.

This is several times the work of the statistics feature itself.

## 6. Recommendation

**Build it, on the anonymous uid. Do not link a real account now.**

- The extra Firestore cost is a few writes per match: a few percent of the
  free quota at a realistic load, and cents per month on a paid plan.
- The identity is good enough for the main case: one player on one phone or
  one computer. It is weakest in iOS Safari (7-day limit) and for players with two devices.
- Show the numbers as "statistics on this device". Then a lost uid does not
  surprise the player.
- Keep "automatic clean-up of anonymous accounts" off in the Firebase console.
- Make account linking a separate follow-up task. Do it only when players ask
  for statistics across devices, or report lost statistics. Because linking keeps
  the uid, statistics collected before that stay valid.

## Sources

- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Firebase: authenticate anonymously (web), automatic clean-up](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Safari 7-day cap on script-writable storage](https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519)
- [WebKit bug 211775: home screen web apps and the 7-day cap](https://bugs.webkit.org/show_bug.cgi?id=211775)
