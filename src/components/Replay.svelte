<script lang="ts">
  import { shownHand, teamOf, toPublic, turnedVisible, type State } from '../engine'
  import type { KjnMatch } from '../lib/kjn'
  import { downloadKjn } from '../lib/download'
  import { t } from '../lib/i18n'
  import { arrangeHand, sortMode } from '../lib/prefs'
  import type { SeatInfo } from '../lib/net-types'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'

  let {
    match,
    steps,
    kjn,
    at,
    seat: my,
    names,
    label,
    error = '',
    onopenfile,
    onclose,
  }: {
    match: KjnMatch
    /** Engine state after each recorded action (`loadKjn`). */
    steps: State[]
    /** KJN/1 text of the match, for the download. */
    kjn: string
    /** When the match finished; unknown for a file. */
    at?: Date
    /** Seat shown at the bottom. */
    seat: number
    /** Seat names; empty for a file, which has none. */
    names: string[]
    /** Where the match comes from: its date and time, or the file name. */
    label: string
    error?: string
    onopenfile: (file: File) => void
    onclose: () => void
  } = $props()

  let menuOpen = $state(false)
  let menu = $state<HTMLElement>()
  let fileInput = $state<HTMLInputElement>()

  function openFile(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0]
    // Clear so the same file can be opened again.
    e.currentTarget.value = ''
    if (file) onopenfile(file)
  }

  /** Index of the first step of each hand. */
  const starts = $derived(
    steps.flatMap((s, k) => (k === 0 || s.handNumber !== steps[k - 1].handNumber ? [k] : [])),
  )
  let i = $state(0)
  const s = $derived(steps[i])
  const pub = $derived(toPublic(s))
  const hand = $derived(s.handNumber)
  const last = $derived(steps.length - 1)

  const lvlName = $derived({ easy: $t.lvlEasy, normal: $t.lvlNormal, hard: $t.lvlHard })
  const seats: SeatInfo[] = $derived(
    [0, 1, 2, 3].map((k) => {
      const kind = match.seats[k]
      const bot = kind.startsWith('bot-')
      const fallback = bot
        ? `Bot ${k + 1} · ${lvlName[kind.slice(4) as keyof typeof lvlName]}`
        : `${$t.player} ${k + 1}`
      return { uid: '', name: names[k] || fallback, bot }
    }),
  )
  const myTeam = $derived(teamOf(my))
  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)
  const rel = (seat: number) => (seat - my + 4) % 4
  const TILT = [-4, 3, -2, 5]

  const go = (k: number) => (i = Math.max(0, Math.min(last, k)))
  const prevHand = () => go(i > starts[hand - 1] ? starts[hand - 1] : (starts[hand - 2] ?? 0))
  const nextHand = () => go(starts[hand] ?? last)

  let auto = $state(false)
  $effect(() => {
    if (!auto) return
    const id = setInterval(() => {
      if (i >= last) auto = false
      else i++
    }, 900)
    return () => clearInterval(id)
  })

  const showTurned = $derived(turnedVisible(pub))
  const playing = $derived(pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER')
  const playingTeam = $derived(pub.bidder === null ? null : teamOf(pub.bidder))
  const lingerTrick = $derived(playing && pub.trick.length === 0 ? pub.lastTrick : null)
  const showCards = $derived(pub.phase === 'PLAYING' && pub.trick.length > 0 ? pub.trick : lingerTrick)
  const handOf = (seat: number) => arrangeHand(shownHand(pub, seat, s.hands[seat]), $sortMode, [])

  /** Latest bid each seat announced this hand, read back from the log. */
  const lastBid = $derived.by(() => {
    const map = new Map<number, string>()
    for (let k = pub.log.length - 1; k >= 0; k--) {
      const ev = pub.log[k]
      if (ev.t === 'deal' || ev.t === 'all-pass' || ev.t === 'second-card' || ev.t === 'score') break
      if (ev.seat === undefined || map.has(ev.seat)) continue
      if (ev.t === 'pass' || ev.t === 'dealer-pass') map.set(ev.seat, $t.pass)
      else if (ev.t === 'play-call') map.set(ev.seat, $t.play)
    }
    return map
  })
  const showBids = $derived(
    !playing || (pub.phase === 'PLAYING' && pub.tricksPlayed === 0 && pub.trick.length === 0),
  )
</script>

{#snippet nameplate(seat: number)}
  {@const side = playingTeam !== null && playing ? (teamOf(seat) === playingTeam ? 'decl' : 'def') : null}
  <div class="nameplate" class:active={pub.actionSeats.includes(seat)} class:decl={side === 'decl'} class:def={side === 'def'}>
    <span class="avatar">{seats[seat].bot ? '🤖' : seats[seat].name.slice(0, 1).toUpperCase()}</span>
    <span class="np-name">{seats[seat].name}</span>
    {#if seat === pub.dealer}<span class="chip dealer" title={$t.dealerTag}>D</span>{/if}
    {#if pub.bidder === seat}<span class="chip bidder" title={$t.bidderTag}>★</span>{/if}
    {#if playing}<span class="chip tricks">{pub.tricksWon[teamOf(seat)]}</span>{/if}
    <div class="bubbles">
      {#if showBids && lastBid.has(seat)}<span class="bubble">{lastBid.get(seat)}</span>{/if}
      {#if pub.troefkeAsked && seat === pub.bidder && pub.tricksPlayed === 0 && pub.trick.length === 0}
        <span class="bubble troef">{$t.troefWanted}</span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet turnedAt(seat: number)}
  {#if showTurned && seat === pub.dealer && pub.turned}
    <div class="turned-at" title={$t.turnedCard}>
      <span class="mini-card"><CardView card={pub.turned.first} /></span>
      <span class="mini-card"><CardView card={pub.turned.secondUp ? pub.turned.second : null} /></span>
    </div>
  {/if}
{/snippet}

{#snippet opponent(seat: number, pos: number)}
  <div class="seat seat-p{pos}">
    {@render nameplate(seat)}
    <div class="opp-hand open" class:vertical={pos !== 2} class:horizontal={pos === 2}>
      {#each handOf(seat) as c (c.s + c.r)}
        <div class="opp-card"><CardView card={c} /></div>
      {/each}
    </div>
    {@render turnedAt(seat)}
  </div>
{/snippet}

<svelte:window
  onpointerdown={(e) => {
    if (menuOpen && !menu?.contains(e.target as Node)) menuOpen = false
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') menuOpen = false
  }}
/>

<div class="table-wrap replay">
  <div class="replay-bar">
    <span class="replay-title" title="{$t.replayOf} {label}"><b>{$t.replayOf}</b> {label}</span>
    <div class="replay-controls">
      <button class="icon-btn" title={$t.prevHand} aria-label={$t.prevHand} disabled={i === 0} onclick={prevHand}>⏮</button>
      <button class="icon-btn" title={$t.prevStep} aria-label={$t.prevStep} disabled={i === 0} onclick={() => go(i - 1)}>‹</button>
      <button
        class="icon-btn"
        title={auto ? $t.pause : $t.autoPlay}
        aria-label={auto ? $t.pause : $t.autoPlay}
        disabled={!auto && i === last}
        onclick={() => (auto = !auto)}>{auto ? '⏸' : '▶'}</button
      >
      <button class="icon-btn" title={$t.nextStep} aria-label={$t.nextStep} disabled={i === last} onclick={() => go(i + 1)}>›</button>
      <button class="icon-btn" title={$t.nextHand} aria-label={$t.nextHand} disabled={i === last} onclick={nextHand}>⏭</button>
      <span class="replay-label">{$t.hand} {hand} {$t.of} {match.hands.length}</span>
    </div>
    <div class="replay-end">
      <div class="replay-menu" bind:this={menu}>
        <button
          class="icon-btn"
          title={$t.moreActions}
          aria-label={$t.moreActions}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}>⋯</button
        >
        {#if menuOpen}
          <div class="replay-menu-pop panel" role="menu">
            <button class="btn tiny" role="menuitem" onclick={() => ((menuOpen = false), downloadKjn(kjn, at))}>
              {$t.download}
            </button>
            <button class="btn tiny" role="menuitem" onclick={() => ((menuOpen = false), fileInput?.click())}>
              {$t.openKjn}
            </button>
          </div>
        {/if}
        <input bind:this={fileInput} type="file" accept=".kjn" hidden onchange={openFile} />
      </div>
      <button class="icon-btn" title={$t.close} aria-label={$t.close} onclick={onclose}>✕</button>
    </div>
  </div>
  {#if error}<div class="alert replay-alert">{error}</div>{/if}

  <div class="table">
    <div class="felt">
      <InfoPanel {pub} {seats} {myTeam} opts={{ info: true, score: true }} />
      <Boomke marks={pub.marks} {myTeam} phase={pub.phase} />

      {@render opponent((my + 2) % 4, 2)}
      {@render opponent((my + 1) % 4, 1)}
      {@render opponent((my + 3) % 4, 3)}

      <div class="area-center">
        <div class="trick-area">
          {#if showCards}
            {#each showCards as tc, k (tc.seat)}
              <div
                class="trick-card tp{rel(tc.seat)}"
                class:done={lingerTrick !== null}
                class:won={lingerTrick !== null && tc.seat === pub.leader}
                style="rotate: {TILT[(k + showCards[0].seat) % 4]}deg; z-index: {k + 1}"
              >
                <CardView card={tc.card} />
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <div class="felt-overlay" class:lifted={showTurned && my === pub.dealer} class:scored={pub.phase === 'SCORED' || pub.phase === 'GAME_OVER'}>
        {#if pub.phase === 'CUTTING'}
          <div class="panel overlay-panel"><strong>{$t.allPassed}</strong></div>
        {:else if (pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') && pub.lastResult}
          {@const r = pub.lastResult}
          <div class="panel overlay-panel result" class:over={pub.phase === 'GAME_OVER'}>
            <div class="result-head">{pub.phase === 'GAME_OVER' ? $t.gameOver : $t.scored}</div>
            <div class="result-score">
              <span class="rs-name">{$t.wij}</span>
              <b class="rs-num">{r.points[myTeam]}–{r.points[1 - myTeam]}</b>
              <span class="rs-name">{$t.zij}</span>
            </div>
            <div class="result-flags">
              {#if r.draw}
                <span class="chip">{$t.draw}</span>
              {:else}
                <span class="chip flag-win">{teamName(r.winnerTeam)} {$t.wins}</span>
                <span class="chip">{r.erased} {$t.erased}</span>
                {#if r.kapot}<span class="chip flag-bad">{$t.kapot}</span>{/if}
                {#if r.koei}<span class="chip flag-koei">+{$t.koei}</span>{/if}
              {/if}
            </div>
            {#if pub.phase === 'GAME_OVER'}<strong>{teamName(pub.winner!)} {$t.wins}!</strong>{/if}
          </div>
        {/if}
      </div>

      <div class="area-me">
        <div class="me-anchor">
          {@render nameplate(my)}
          {@render turnedAt(my)}
        </div>
      </div>
    </div>

    <div class="my-hand-wrap">
      <div class="my-hand">
        {#each handOf(my) as c (c.s + c.r)}
          <div class="hand-card"><CardView card={c} /></div>
        {/each}
      </div>
    </div>
  </div>
</div>
