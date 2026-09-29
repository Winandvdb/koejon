<script lang="ts">
  import { onMount } from 'svelte'
  import { signIn } from './lib/firebase'
  import { createRoom, joinRoom, RoomSession, type SessionView } from './lib/room'
  import { HostGame } from './lib/host'
  import { lang, t } from './lib/i18n'
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
    view = null
  }

  async function onCreate(name: string) {
    err = ''
    try {
      attach(await createRoom(uid, name))
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
      HostGame.attach(session.code, uid).then((h) => (host = h)).catch((e) => (err = String(e)))
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

<header>
  <span class="brand">{$t.title}</span>
  <span class="spacer"></span>
  <button class="btn tiny" onclick={() => (showRules = true)}>{$t.rules}</button>
  <button class="btn tiny" onclick={() => ($lang = $lang === 'nl' ? 'en' : 'nl')}>{$lang === 'nl' ? 'EN' : 'NL'}</button>
</header>

{#if !uid}
  <div class="loading">{$t.connection}</div>
{:else if !session || !view || !view.room}
  <Home error={err} oncreate={onCreate} onjoin={onJoin} />
{:else if view.room.pub!.phase === 'LOBBY'}
  <Lobby
    room={view.room}
    isHost={view.room.hostUid === uid}
    mySeat={view.mySeat}
    onaddbot={() => host?.addBot()}
    onremovebot={(i) => host?.removeBot(i)}
    onshuffle={() => host?.shuffleSeats()}
    onstart={() => host?.startGame()}
    onleave={onLeave}
  />
{:else}
  <Table {view} {send} isHost={view.room.hostUid === uid} onleave={onLeave} onnewmatch={onNewMatch} />
{/if}

{#if showRules}<RulesDialog onclose={() => (showRules = false)} />{/if}
