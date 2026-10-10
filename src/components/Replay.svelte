<script lang="ts">
  import { shownHand, teamOf, toPublic, turnedVisible, type State } from '../engine'
  import type { KjnMatch } from '../lib/kjn'
  import { downloadKjn } from '../lib/download'
  import { levelNames, seatName, t } from '../lib/i18n'
  import { arrangeHand, cardKey, sortMode } from '../lib/prefs'
  import type { SeatInfo } from '../lib/net-types'
  import { isPlaying, lastBids, showBids, sideOf, troefkeBubble } from '../lib/table'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'
  import Nameplate from './Nameplate.svelte'
  import Opponent from './Opponent.svelte'
  import ResultPanel from './ResultPanel.svelte'
  import TrickArea from './TrickArea.svelte'
  import TurnedCards from './TurnedCards.svelte'

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

  const lvlName = $derived(levelNames($t))
  const seats: SeatInfo[] = $derived(
    [0, 1, 2, 3].map((k) => {
      const kind = match.seats[k]
      const bot = kind.startsWith('bot-')
      const fallback = bot
        ? `Bot ${k + 1} · ${lvlName[kind.slice(4) as keyof typeof lvlName]}`
        : seatName($t, '', k)
      return { uid: '', name: names[k] || fallback, bot }
    }),
  )
  const myTeam = $derived(teamOf(my))

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
  const handOf = (seat: number) => arrangeHand(shownHand(pub, seat, s.hands[seat]), $sortMode, [])

  const lastBid = $derived(lastBids(pub.log))
  const bidsShown = $derived(showBids(pub))
</script>

{#snippet nameplateOf(seat: number)}
  <Nameplate
    name={seats[seat].name}
    bot={seats[seat].bot}
    active={pub.actionSeats.includes(seat)}
    side={sideOf(pub, seat)}
    dealer={seat === pub.dealer}
    bidder={pub.bidder === seat}
    tricks={isPlaying(pub) ? pub.tricksWon[teamOf(seat)] : null}
    bid={bidsShown ? lastBid.get(seat) : undefined}
    troef={troefkeBubble(pub, seat)}
    animate={false}
  />
{/snippet}

{#snippet opponent(seat: number, pos: number)}
  <Opponent {pos} open>
    {#snippet nameplate()}{@render nameplateOf(seat)}{/snippet}
    {#snippet turned()}<TurnedCards {pub} {seat} animate={false} />{/snippet}
    {#each handOf(seat) as c (cardKey(c))}
      <div class="opp-card"><CardView card={c} /></div>
    {/each}
  </Opponent>
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
        <TrickArea {pub} {my} animate={false} />
      </div>

      <div class="felt-overlay" class:lifted={showTurned && my === pub.dealer} class:scored={pub.phase === 'SCORED' || pub.phase === 'GAME_OVER'}>
        {#if pub.phase === 'CUTTING'}
          <div class="panel overlay-panel"><strong>{$t.allPassed}</strong></div>
        {:else if (pub.phase === 'SCORED' || pub.phase === 'GAME_OVER') && pub.lastResult}
          <ResultPanel {pub} {myTeam} animate={false} />
        {/if}
      </div>

      <div class="area-me">
        <div class="me-anchor">
          {@render nameplateOf(my)}
          <TurnedCards {pub} seat={my} animate={false} />
        </div>
      </div>
    </div>

    <div class="my-hand-wrap">
      <div class="my-hand">
        {#each handOf(my) as c (cardKey(c))}
          <div class="hand-card"><CardView card={c} /></div>
        {/each}
      </div>
    </div>
  </div>
</div>
