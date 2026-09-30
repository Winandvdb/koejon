<script lang="ts">
  import { onMount } from 'svelte'
  import { signIn } from './lib/firebase'
  import { createRoom, joinRoom, RoomSession, type SessionView } from './lib/room'
  import { HostGame } from './lib/host'
  import { lang, t } from './lib/i18n'
  import { settings } from './lib/settings'
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
  })

  function attach(s: RoomSession) {
    teardown()
    session = s
    s.view.subscribe((v) => (view = v))
  }

  function teardown() {
    session?.dispose()
    host?.dispose()
    session = null
    host = null
    hostPromise = null
    view = null
  }

  let hostPromise: Promise<HostGame> | null = null

  function ensureHost(): Promise<HostGame> {
    if (!hostPromise) {
      hostPromise = HostGame.attach(session!.code, uid).then((h) => (host = h))
    }
    return hostPromise
  }

  async function onCreate(name: string) {
    err = ''
    try {
      attach(await createRoom(uid, name))
    } catch (e) {
      err = String(e)
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
      err = String(e)
    }
  }

  async function onJoin(code: string, name: string) {
    err = ''
    try {
      attach(await joinRoom(code, uid, name))
    } catch (e) {
      const m = (e as Error).message
      err = m === 'room-not-found' ? $t.roomNotFound : m === 'room-full' ? $t.roomFull : m === 'room-started' ? $t.roomStarted : String(e)
    }
  }

  // Become host once the room says so (room creator, or reload recovery).
  $effect(() => {
    const r = view?.room
    if (session && r && !host && r.hostUid === uid) {
      ensureHost().catch((e) => (err = String(e)))
    }
  })

  const send = (a: Action) => void session?.act(a)

  async function onLeave() {
    try {
      await session?.leave()
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
    <button class="icon-btn" title={$t.settings} aria-label={$t.settings} onclick={() => (showSettings = !showSettings)}>⚙</button>
    {#if showSettings}
      <div class="settings-pop panel">
        <label><input type="checkbox" bind:checked={$settings.info} /> {$t.showInfo}</label>
        <label><input type="checkbox" bind:checked={$settings.score} /> {$t.showScore}</label>
        <label><input type="checkbox" bind:checked={$settings.lastTricks} /> {$t.showLastTricks}</label>
      </div>
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
      onshuffle={() => host?.shuffleSeats()}
      onstart={() => host?.startGame()}
    />
  {:else}
    <Table {view} {send} isHost={view.room.hostUid === uid} onnewmatch={onNewMatch} />
  {/if}
</main>

{#if showRules}<RulesDialog onclose={() => (showRules = false)} />{/if}
