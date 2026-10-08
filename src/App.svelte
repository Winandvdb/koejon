<script lang="ts">
  import { onMount } from 'svelte'
  import { getDoc, resetUsage, usage } from './lib/fs'
  import { signIn } from './lib/firebase'
  import {
    createRoom,
    joinRoom,
    newRoomDoc,
    seatOf,
    RoomSession,
    type SessionView,
  } from './lib/room'
  import { roomRef, saveGame } from './lib/link-firestore'
  import { localLinks, SOLO_CODE } from './lib/link-local'
  import { appUrl, P2P_ENABLED } from './lib/link-p2p'
  import type { RoomDoc } from './lib/net-types'
  import type { BotLevel } from './bots/bot'
  import { HostGame } from './lib/host'
  import { demoSeed, hostRand, SEED_ALLOWED } from './lib/seed'
  import { lang, t } from './lib/i18n'
  import { SORT_LABEL, SORT_MODES, sortMode } from './lib/prefs'
  import { safeStorage } from './lib/storage'
  import { theme } from './lib/theme'
  import type { Action } from './engine'
  import Home from './components/Home.svelte'
  import Lobby from './components/Lobby.svelte'
  import Table from './components/Table.svelte'
  import RulesDialog from './components/RulesDialog.svelte'

  /** Dev builds (the vite dev server, or VITE_APP_VARIANT=dev: the dev
   *  channel and previews of PRs into develop) show a DEV chip and this
   *  tab's Firestore reads/writes in the top bar. */
  const viteEnv = (import.meta as { env?: { DEV?: boolean; VITE_APP_VARIANT?: string } }).env
  const DEV = !!viteEnv?.DEV || viteEnv?.VITE_APP_VARIANT === 'dev'

  /** `?seed=` of a dev or review build (src/lib/seed.ts). Read now: attach()
   *  clears the URL. It seeds the first new solo game of this page load only —
   *  never a resumed game, a later game, or a multiplayer room. */
  let seed = SEED_ALLOWED ? demoSeed(location.search, true) : null
  /** The random source for the next host attach; ensureHost() takes it. */
  let soloRand: (() => number) | undefined

  let uid = $state('')
  let session = $state<RoomSession | null>(null)
  let host = $state<HostGame | null>(null)
  let view = $state<SessionView | null>(null)
  let err = $state('')
  let showRules = $state(false)
  let showSettings = $state(false)

  let authed = false

  // Multiplayer needs a Firebase uid; solo does not. Retried on the
  // multiplayer buttons when startup was offline.
  async function ensureAuth(): Promise<boolean> {
    if (authed) return true
    try {
      uid = await signIn()
      authed = true
      safeStorage.setItem('koejon-uid', uid)
      return true
    } catch {
      return false
    }
  }

  // Offline start: solo still works. Reuse the last signed-in uid so a solo
  // game saved online resumes offline.
  function offlineUid(): string {
    const saved = safeStorage.getItem('koejon-uid')
    if (saved) return saved
    const id = `local-${crypto.randomUUID()}`
    safeStorage.setItem('koejon-uid', id)
    return id
  }

  onMount(async () => {
    if (!(await ensureAuth())) uid = offlineUid()
    const name = safeStorage.getItem('koejon-name') ?? ''
    // This tab's URL decides first: it survives a refresh and, unlike
    // localStorage, no other tab can change it. The stored code is the
    // fallback for a fresh tab.
    const urlCode = new URLSearchParams(location.search).get('room')?.trim().toUpperCase()
    const code = urlCode || safeStorage.getItem('koejon-room')
    try {
      if (code === SOLO_CODE) {
        // Offline solo: resume from this browser's storage; Firestore only
        // receives the finished match.
        const links = localLinks(uid, safeStorage)
        if (links) attach(new RoomSession(SOLO_CODE, uid, links.guest, { ...links.host, saveGame }))
        else forgetRoom()
      } else if (code && authed) {
        // Return to a room in progress only when our seat is still ours.
        const snap = await getDoc(roomRef(code))
        const room = snap.exists() ? (snap.data() as RoomDoc) : null
        if (room && seatOf(room, uid) >= 0) attach(await joinRoom(code, uid, name))
        // An invite to a room we are not in yet: Home shows its join view.
        else if (!urlCode) forgetRoom()
      }
    } catch {
      forgetRoom()
    }
  })

  // Drop a stale room session: clear the stored code AND the invite URL so
  // the home screen doesn't fall back to a dead join page.
  function forgetRoom() {
    safeStorage.removeItem('koejon-room')
    history.replaceState(null, '', appUrl())
  }

  let unsubView: (() => void) | null = null
  let hadRoom = $state(false)

  function attach(s: RoomSession) {
    teardown()
    session = s
    unsubView = s.view.subscribe((v) => {
      view = v
      if (v.room) hadRoom = true
    })
    err = ''
    safeStorage.setItem('koejon-room', s.code)
    // A solo room has nothing to invite to.
    if (s.code !== SOLO_CODE) history.replaceState(null, '', appUrl(s.code))
    // The host tab's own view is fed by the host, so attach it right away
    // (room creator, or reload recovery). Without a host it would only show a
    // spinner: leave, and say why.
    if (s.hostLink) {
      ensureHost().catch((e) => {
        if (session !== s) return
        teardown()
        showErr(e, hostErrText(e))
      })
    }
  }

  function hostErrText(e: unknown): string {
    const m = (e as Error)?.message
    return m === 'host-elsewhere' ? $t.hostElsewhere : m === 'room-not-found' ? $t.roomNotFound : ''
  }

  // The room doc vanished (host destroyed it): leave cleanly instead of
  // dropping back onto a dead invite screen. While attaching (room not yet
  // loaded) wait a moment, then give up so nobody is stuck on a spinner.
  $effect(() => {
    if (!session || !view || view.room) return
    if (hadRoom) {
      teardown()
      return
    }
    const t = setTimeout(() => {
      if (view && !view.room) teardown()
    }, 5000)
    return () => clearTimeout(t)
  })

  function teardown() {
    unsubView?.()
    unsubView = null
    // All tabs share localStorage: clear the stored room only if it is ours,
    // never a room another tab is in.
    if (session && safeStorage.getItem('koejon-room') === session.code) safeStorage.removeItem('koejon-room')
    session?.dispose()
    host?.dispose()
    session = null
    host = null
    hostPromise = null
    view = null
    hadRoom = false
    soloStarting = false
    err = ''
    history.replaceState(null, '', appUrl())
  }

  let hostPromise: Promise<HostGame> | null = null

  function ensureHost(): Promise<HostGame> {
    if (!hostPromise) {
      const s = session!
      const rand = soloRand
      soloRand = undefined
      hostPromise = HostGame.attach(s.code, uid, s.hostLink!, { rand })
        .then((h) => {
          // The user left while attaching: never keep hosting a room behind
          // their back (it would answer that room's guests forever).
          if (session !== s) {
            h.dispose()
            throw new Error('session-gone')
          }
          return (host = h)
        })
        .catch((e) => {
          // A failed attach must not block retries.
          hostPromise = null
          throw e
        })
    }
    return hostPromise
  }

  // Transient Firestore failures (offline reconnects, timeouts): on a
  // user-initiated click show a friendly offline hint; in-game sends are
  // logged only since the SDK retries them itself.
  const TRANSIENT = new Set(['unavailable', 'cancelled', 'deadline-exceeded'])

  function showErr(e: unknown, friendly = '', interactive = false): void {
    const code = (e as { code?: string })?.code ?? ''
    if (TRANSIENT.has(code)) {
      console.warn('[transient]', e)
      if (interactive) err = $t.offline
      return
    }
    err = friendly || (e instanceof Error ? e.message : String(e))
  }

  async function onCreate(name: string) {
    err = ''
    if (!(await ensureAuth())) return void (err = $t.offline)
    try {
      attach(await createRoom(uid, name))
    } catch (e) {
      showErr(e, '', true)
    }
  }

  // Solo: an offline room in this tab, filled with bots and started right away.
  // soloStarting hides the lobby flash until the first deal starts.
  let soloStarting = $state(false)

  async function onSolo(name: string, level: BotLevel) {
    err = ''
    try {
      const links = localLinks(uid, safeStorage, newRoomDoc(SOLO_CODE, uid, name))!
      if (seed !== null) {
        soloRand = hostRand(seed, SOLO_CODE)
        seed = null
      }
      // attach() runs teardown() which resets soloStarting — set it after.
      // Play stays offline; only the finished match is uploaded, when online.
      attach(new RoomSession(SOLO_CODE, uid, links.guest, { ...links.host, saveGame }))
      soloStarting = true
      const h = await ensureHost()
      h.addBot(1, level)
      h.addBot(2, level)
      h.addBot(3, level)
      h.startGame()
    } catch (e) {
      soloStarting = false
      // attach() already showed this failure; do not overwrite it with the raw message.
      showErr(e, hostErrText(e), true)
    }
  }

  $effect(() => {
    const ph = view?.room?.pub?.phase
    if (soloStarting && ph && ph !== 'LOBBY') soloStarting = false
  })

  async function onJoin(code: string, name: string) {
    err = ''
    if (!(await ensureAuth())) return void (err = $t.offline)
    try {
      attach(await joinRoom(code, uid, name))
    } catch (e) {
      const m = (e as Error).message
      const friendly =
        m === 'room-not-found'
          ? $t.roomNotFound
          : m === 'room-full'
            ? $t.roomFull
            : m === 'room-started'
              ? $t.roomStarted
              : ''
      showErr(e, friendly, true)
    }
  }

  const send = (a: Action) => {
    // The host applies its own actions in place: no intent doc round trip.
    if (host) return host.submit({ kind: 'act', action: a })
    err = ''
    session?.act(a).catch((e) => {
      console.error('[act]', e)
      showErr(e, (e as Error).message === 'act-lost' ? $t.actLost : '', true)
    })
  }

  async function onLeave() {
    try {
      if (host) {
        // The host's room dies with the host: delete it instead of
        // leaving a zombie room the others cannot continue.
        await host.destroyRoom().catch(() => {})
      } else {
        // Never let a dead Firestore path trap the user in the room.
        await Promise.race([
          session?.leave(),
          new Promise((r) => setTimeout(r, 2500)),
        ])
      }
    } finally {
      teardown()
    }
  }

  function onNewMatch() {
    host?.newMatch()
  }
</script>

<header class="topbar">
  <div class="brand">
    <span class="brand-suits" aria-hidden="true">♠<i>♥</i></span>
    <span class="brand-name">{$t.title}</span>
  </div>
  {#if DEV}<span class="room-chip dev">DEV</span>{/if}
  {#if session && session.code !== SOLO_CODE}<span class="room-chip" title={$t.roomCode}>{session.code}</span>{/if}
  <span class="spacer"></span>
  {#if DEV}
    <button
      class="room-chip usage"
      title="Firestore reads / writes from this tab since load (click to reset). Excludes the rules' isHost reads on the server: about 1 per host write."
      onclick={resetUsage}>R {$usage.reads} · W {$usage.writes}{P2P_ENABLED ? '' : ' · P2P off'}</button
    >
  {/if}
  <div class="settings-anchor">
    {#if view?.room}
      {@const r = view.room}
      {@const hostCtl = r.hostUid !== uid}
      <button class="icon-btn" title={$t.settings} aria-label={$t.settings} onclick={() => (showSettings = !showSettings)}>⚙</button>
      {#if showSettings}
        <div class="settings-pop panel">
          <label>
            <input
              type="checkbox"
              checked={r.opts?.info ?? true}
              disabled={hostCtl}
              onchange={(e) => host?.setOption('info', e.currentTarget.checked)}
            />
            {$t.showInfo}
          </label>
          <label>
            <input
              type="checkbox"
              checked={r.opts?.score ?? false}
              disabled={hostCtl}
              onchange={(e) => host?.setOption('score', e.currentTarget.checked)}
            />
            {$t.showScore}
          </label>
          <span>{$t.sortHand}</span>
          <div class="segmented" role="group" aria-label={$t.sortHand}>
            {#each SORT_MODES as m (m)}
              <button class:active={$sortMode === m} onclick={() => sortMode.set(m)}>{$t[SORT_LABEL[m]]}</button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
  <button class="icon-btn" title={$t.rules} aria-label={$t.rules} onclick={() => (showRules = true)}>📖</button>
  <div class="segmented lang" role="group" aria-label="Language">
    <button class:active={$lang === 'nl'} onclick={() => ($lang = 'nl')}>NL</button>
    <button class:active={$lang === 'en'} onclick={() => ($lang = 'en')}>EN</button>
  </div>
  <button
    class="icon-btn"
    title={$theme === 'dark' ? $t.lightMode : $t.darkMode}
    aria-label={$theme === 'dark' ? $t.lightMode : $t.darkMode}
    onclick={() => ($theme = $theme === 'dark' ? 'light' : 'dark')}
  >{$theme === 'dark' ? '☀' : '🌙'}</button>
  {#if session}
    <button class="icon-btn" title={$t.leave} aria-label={$t.leave} onclick={onLeave}>⎋</button>
  {/if}
</header>

<main class="main">
  {#if !uid}
    <div class="connecting">
      {#if err}{err}{:else}<span class="spinner"></span>{$t.connection}{/if}
    </div>
  {:else if !session}
    <Home error={err} oncreate={onCreate} onjoin={onJoin} onsolo={onSolo} />
  {:else if !view || !view.room}
    <!-- Attaching, or the room doc just vanished — teardown runs in the
         effect; never mount Home here or the invite view flashes. -->
    <div class="connecting"><span class="spinner"></span>{$t.connection}</div>
  {:else if soloStarting && view.room.pub!.phase === 'LOBBY'}
    <div class="connecting"><span class="spinner"></span>{$t.connection}</div>
  {:else if view.room.pub!.phase === 'LOBBY'}
    {#if view.hostStale}<div class="alert">{$t.hostLeft}</div>{/if}
    <Lobby
      room={view.room}
      isHost={view.room.hostUid === uid}
      mySeat={view.mySeat}
      onaddbot={(i) => host?.addBot(i)}
      onremovebot={(i) => host?.removeBot(i)}
      onbotlevel={(i) => host?.cycleBotLevel(i)}
      onkick={(i) => host?.kickSeat(i)}
      onshuffle={() => host?.shuffleSeats()}
      onswap={(a, b) => host?.swapSeats(a, b)}
      onstart={() => host?.startGame()}
    />
  {:else if view.mySeat < 0}
    <div class="alert">{$t.kicked}</div>
  {:else}
    {#if err}<div class="alert">{err}</div>{/if}
    <Table {view} {send} isHost={view.room.hostUid === uid} onnewmatch={onNewMatch} onkick={(i) => host?.kickSeat(i)} />
  {/if}
</main>

{#if showRules}<RulesDialog onclose={() => (showRules = false)} />{/if}
