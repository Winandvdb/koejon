<script lang="ts">
  import { onMount } from 'svelte'
  import { getDoc } from 'firebase/firestore'
  import { signIn } from './lib/firebase'
  import {
    createRoom,
    joinRoom,
    roomRef,
    seatOf,
    RoomSession,
    type SessionView,
  } from './lib/room'
  import type { RoomDoc } from './lib/net-types'
  import { HostGame } from './lib/host'
  import { lang, t } from './lib/i18n'
  import { theme } from './lib/theme'
  import type { Action } from './engine'
  import Home from './components/Home.svelte'
  import Lobby from './components/Lobby.svelte'
  import Table from './components/Table.svelte'
  import RulesDialog from './components/RulesDialog.svelte'

  let uid = $state('')
  let session = $state<RoomSession | null>(null)
  let host = $state<HostGame | null>(null)
  let view = $state<SessionView | null>(null)
  let err = $state('')
  let showRules = $state(false)
  let showSettings = $state(false)

  onMount(async () => {
    uid = await signIn()
    const storedCode = localStorage.getItem('koejon-room')
    const name = localStorage.getItem('koejon-name') ?? ''
    try {
      if (storedCode) {
        // Return to a room in progress only when our seat is still ours.
        const snap = await getDoc(roomRef(storedCode))
        const room = snap.exists() ? (snap.data() as RoomDoc) : null
        if (room && seatOf(room, uid) >= 0) attach(await joinRoom(storedCode, uid, name))
        else localStorage.removeItem('koejon-room')
      }
    } catch {
      localStorage.removeItem('koejon-room')
    }
  })

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
    localStorage.setItem('koejon-room', s.code)
    history.replaceState(null, '', `${location.pathname}?room=${s.code}`)
  }

  // The room doc vanished (host destroyed it): leave cleanly instead of
  // dropping back onto a dead invite screen.
  $effect(() => {
    if (session && view && hadRoom && !view.room) teardown()
  })

  function teardown() {
    unsubView?.()
    unsubView = null
    session?.dispose()
    host?.dispose()
    session = null
    host = null
    hostPromise = null
    view = null
    hadRoom = false
    err = ''
    localStorage.removeItem('koejon-room')
    history.replaceState(null, '', location.pathname)
  }

  let hostPromise: Promise<HostGame> | null = null

  function ensureHost(): Promise<HostGame> {
    if (!hostPromise) {
      hostPromise = HostGame.attach(session!.code, uid)
        .then((h) => (host = h))
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
    try {
      attach(await createRoom(uid, name))
    } catch (e) {
      showErr(e, '', true)
    }
  }

  // Solo: create a room, fill it with bots and start right away.
  async function onSolo(name: string) {
    err = ''
    try {
      attach(await createRoom(uid, name))
      const h = await ensureHost()
      h.addBot(1)
      h.addBot(2)
      h.addBot(3)
      h.startGame()
    } catch (e) {
      showErr(e, '', true)
    }
  }

  async function onJoin(code: string, name: string) {
    err = ''
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

  // Become host once the room says so (room creator, or reload recovery).
  $effect(() => {
    const r = view?.room
    if (session && r && !host && r.hostUid === uid) {
      ensureHost().catch(showErr)
    }
  })

  const send = (a: Action) => {
    session?.act(a).catch((e) => {
      console.error('[act]', e)
      showErr(e)
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
  {#if session}<span class="room-chip" title={$t.roomCode}>{session.code}</span>{/if}
  <span class="spacer"></span>
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
    <div class="connecting"><span class="spinner"></span>{$t.connection}</div>
  {:else if !session || !view || !view.room}
    <Home error={err} oncreate={onCreate} onjoin={onJoin} onsolo={onSolo} />
  {:else if view.room.pub!.phase === 'LOBBY'}
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
