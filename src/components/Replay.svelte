<script lang="ts">
  import { shownHand, teamOf, toPublic, turnedVisible, type Action, type State } from '../engine'
  import { RATING_CLASSES, sameAction, summarize, type Rating, type RatingClass } from '../bots/analysis'
  import { Analyzer } from '../lib/analysis'
  import type { KjnMatch } from '../lib/kjn'
  import { downloadKjn } from '../lib/download'
  import { lang, levelNames, RATING_GLYPH, ratingNames, seatName, SUIT_GLYPH, suitName, t } from '../lib/i18n'
  import { arrangeHand, cardKey, sortMode } from '../lib/prefs'
  import type { SeatInfo } from '../lib/net-types'
  import { isPlaying, lastBids, showBids, sideOf, troefkeBubble } from '../lib/table'
  import { replayMoves, type MoveHand, type MoveItem } from '../lib/replay'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'
  import Nameplate from './Nameplate.svelte'
  import Opponent from './Opponent.svelte'
  import ResultPanel from './ResultPanel.svelte'
  import ReplayMoves from './ReplayMoves.svelte'
  import ReplayOverview from './ReplayOverview.svelte'
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
        ? `${$t.botName} ${k + 1} · ${lvlName[kind.slice(4) as keyof typeof lvlName]}`
        : seatName($t, '', k)
      return { uid: '', name: names[k] || fallback, bot }
    }),
  )
  const myTeam = $derived(teamOf(my))

  const go = (k: number) => (i = Math.max(0, Math.min(last, k)))
  const prevHand = () => go(i > starts[hand - 1] ? starts[hand - 1] : (starts[hand - 2] ?? 0))
  const nextHand = () => go(starts[hand] ?? last)

  const moves = $derived(replayMoves(match, steps, my))
  const seatNames = $derived(seats.map((x) => x.name))

  // The overview comes first; a chosen hand or the start opens the move list.
  let tab = $state<'overview' | 'moves'>('overview')
  // Phones: the panel is a bottom sheet that can fold away for more table.
  let sheetOpen = $state(true)
  const openHand = (h: MoveHand) => (go(h.start), (tab = 'moves'), (sheetOpen = true))
  const startReplay = () => (go(0), (tab = 'moves'), (sheetOpen = true))

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

  // Move ratings: computed in a worker, only for the steps on screen.
  let analysis = $state(false)
  let analyzer: Analyzer | null = null
  let rated = $state.raw(new Map<number, Rating[]>())
  let failed = $state(false)
  function toggleAnalysis() {
    analysis = !analysis
    if (analysis && !analyzer) {
      const worker = new Worker(new URL('../lib/analysis-worker.ts', import.meta.url), { type: 'module' })
      analyzer = new Analyzer(worker, kjn)
      analyzer.results.subscribe((m) => (rated = new Map(m)))
      analyzer.failed.subscribe((f) => (failed = f))
    }
  }
  $effect(() => () => analyzer?.stop())

  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k)
  const handSteps = $derived(range(starts[hand - 1], starts[hand] ?? steps.length))
  const handEnd = $derived(i === handSteps.at(-1))
  /** Summaries to show here: the hand at its last step, and the match at the very end. */
  const summaries = $derived([
    ...(handEnd ? [{ title: $t.thisHand, steps: handSteps }] : []),
    ...(i === last ? [{ title: $t.wholeMatch, steps: range(0, steps.length) }] : []),
  ])
  $effect(() => {
    // Off stops the work too: the queue can hold every step of the match.
    // Read the state before `analyzer?.`: while it is null, `?.` skips the
    // arguments, and an effect that read no state never runs again.
    const wanted = analysis ? [i, ...(tab === 'moves' ? handSteps : []), ...summaries.flatMap((x) => x.steps)] : []
    analyzer?.want(wanted)
  })
  const ratings = $derived(analysis ? rated.get(i) : undefined)
  const ratingOf = (seat: number): RatingClass | undefined => ratings?.find((r) => r.seat === seat)?.rating
  const rateName = $derived(ratingNames($t))
  // The move list shows the class of each rated item in its rating slot.
  const ratedMoves = $derived.by((): MoveHand[] => {
    if (!analysis) return moves
    const rate = (x: MoveItem): MoveItem => {
      const c = rated.get(x.step)?.find((r) => r.seat === x.seat && sameAction(r.played, x.action))?.rating
      return c ? { ...x, rating: { cls: `rated rated-${c}`, icon: RATING_GLYPH[c], label: rateName[c] } } : x
    }
    return moves.map((h) => ({
      ...h,
      bids: h.bids.map(rate),
      tricks: h.tricks.map((tr) => ({ ...tr, items: tr.items.map(rate) })),
    }))
  })
  const kindRows = $derived([['bidding', $t.biddingLabel], ['play', $t.cardsLabel]] as const)

  function actionLabel(a: Action): string {
    switch (a.type) {
      case 'play':
        return a.card.r + SUIT_GLYPH[a.card.s]
      case 'bid':
        return a.play ? $t.play : $t.pass
      case 'choose':
        return a.suit ? `${SUIT_GLYPH[a.suit]} ${suitName(a.suit, $lang)}` : $t.pass
      case 'troefke':
        return $t.troefWanted
      case 'ack':
        return $t.noTroefke
      default:
        return a.type
    }
  }
  const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2)
  const pct = (p: number) => `${Math.round(p * 100)}%`
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
    rating={ratingOf(seat)}
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

{#snippet analysisPanel()}
  <div class="analysis-panel" aria-live="polite">
      {#if failed}
        <div class="an-muted">{$t.analysisFailed}</div>
      {:else if !ratings}
        <div class="an-muted"><span class="spinner"></span> {$t.analysing}</div>
      {:else if ratings.length === 0}
        <div class="an-muted">{$t.noChoice}</div>
      {/if}
      {#each ratings ?? [] as r (r.seat)}
        <div class="an-move">
          <span class="chip rate rate-{r.rating}">{RATING_GLYPH[r.rating]}</span>
          <b>{seats[r.seat].name}</b>: {actionLabel(r.played)} · {rateName[r.rating]}
          {#if r.loss > 0}<span class="an-muted">({signed(-r.loss)} {$t.lostLines})</span>{/if}
        </div>
        {#if r.kind === 'play'}
          <div class="an-values">
            {#each r.values as v, k}
              <span class="an-val" class:best={k === 0} class:played={sameAction(v.action, r.played)}>
                {actionLabel(v.action)} <small>{signed(v.value)}</small>
              </span>
            {/each}
          </div>
        {:else}
          <table class="an-bids">
            <thead>
              <tr><th></th><th>{$t.winChance}</th><th>{$t.expectedLines}</th></tr>
            </thead>
            <tbody>
              {#each r.values as v, k}
                <tr class:best={k === 0} class:played={sameAction(v.action, r.played)}>
                  <td>{actionLabel(v.action)}</td>
                  <td>{pct(v.win ?? 0)}</td>
                  <td>{signed(v.value)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if r.breakEven !== undefined}
            <div class="an-muted">{$t.breakEven} ({r.stake}): {pct(r.breakEven)}</div>
          {/if}
        {/if}
        {#if !sameAction(r.values[0].action, r.played)}
          <div class="an-muted">{$t.bestChoice}: {actionLabel(r.values[0].action)}</div>
        {/if}
      {/each}
      {#each summaries as sum (sum.title)}
        {@const done = sum.steps.filter((k) => rated.has(k))}
        {@const counts = summarize(done.flatMap((k) => rated.get(k)!))}
        <table class="an-sum">
          <caption>
            {sum.title}
            {#if done.length < sum.steps.length && !failed}<span class="an-muted"><span class="spinner"></span> {done.length}/{sum.steps.length}</span>{/if}
          </caption>
          <thead>
            <tr>
              <th></th><th></th>
              {#each RATING_CLASSES as c}<th title={rateName[c]}><span class="chip rate rate-{c}">{RATING_GLYPH[c]}</span></th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each [0, 1, 2, 3] as seat}
              {#each kindRows as [kind, label], row}
                <tr class:first={row === 0}>
                  {#if row === 0}<th rowspan="2" class="an-name">{seats[seat].name}</th>{/if}
                  <td class="an-muted">{label}</td>
                  {#each RATING_CLASSES as c}<td>{counts[seat][kind][c] || ''}</td>{/each}
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      {/each}
  </div>
{/snippet}

<div class="replay" class:sheet-closed={!sheetOpen}>
  <div class="table replay-board">
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

  <aside class="replay-side">
    <div class="replay-head">
      <button
        class="icon-btn replay-fold"
        title={sheetOpen ? $t.minimize : $t.expand}
        aria-label={sheetOpen ? $t.minimize : $t.expand}
        aria-expanded={sheetOpen}
        onclick={() => (sheetOpen = !sheetOpen)}>{sheetOpen ? '▾' : '▴'}</button
      >
      <span class="replay-title" title="{$t.replayOf} {label}"><b>{$t.replayOf}</b> {label}</span>
      <button class="btn tiny analysis-toggle" class:on={analysis} aria-pressed={analysis} onclick={toggleAnalysis}>
        {$t.analysis}
      </button>
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
    {#if error}<div class="alert replay-alert">{error}</div>{/if}

    <div class="replay-sheet">
      <div class="replay-tabs">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected={tab === 'overview'} class:active={tab === 'overview'} onclick={() => (tab = 'overview')}
            >{$t.overview}</button
          >
          <button role="tab" aria-selected={tab === 'moves'} class:active={tab === 'moves'} onclick={() => (tab = 'moves')}
            >{$t.moves}</button
          >
        </div>
        <span class="replay-label">{$t.hand} {hand} {$t.of} {match.hands.length}</span>
      </div>
      <div class="replay-body">
        {#if tab === 'overview'}
          <ReplayOverview
            {match}
            hands={moves}
            names={seatNames}
            {myTeam}
            {hand}
            startLines={[steps[0].lines[0], steps[0].lines[1]]}
            onhand={openHand}
            onstart={startReplay}
          />
        {:else}
          {#if analysis}{@render analysisPanel()}{/if}
          <ReplayMoves hands={ratedMoves} names={seatNames} step={i} {hand} ongo={go} />
        {/if}
      </div>
    </div>

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
    </div>
  </aside>
</div>
