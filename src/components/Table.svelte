<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import type { Action, Card } from '../engine'
  import { shownHand, teamOf, turnedVisible } from '../engine'
  import type { SessionView } from '../lib/room'
  import { DEAL_FLY, DEAL_MS, DEAL_STEP, deckStack, pairOfCard } from '../lib/deckstack'
  import type { StackPart } from '../lib/deckstack'
  import { SUIT_GLYPH, seatName, t } from '../lib/i18n'
  import { arrangeHand, cardKey, moveCard, SORT_LABEL, SORT_MODES, sortMode } from '../lib/prefs'
  import { DEFAULT_ROOM_OPTS } from '../lib/net-types'
  import { DIR, isPlaying, lastBids, lingerTrick as lingerOf, relSeat, showBids as showBidsOf, sideOf, troefkeBubble } from '../lib/table'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'
  import Nameplate from './Nameplate.svelte'
  import Opponent from './Opponent.svelte'
  import PacketLift from './PacketLift.svelte'
  import ResultPanel from './ResultPanel.svelte'
  import TrickArea from './TrickArea.svelte'
  import TurnedCards from './TurnedCards.svelte'

  let {
    view,
    send,
    isHost,
    onnewmatch,
    onkick,
  }: {
    view: SessionView
    send: (a: Action) => void
    isHost: boolean
    onnewmatch: () => void
    onkick: (seat: number) => void
  } = $props()

  const room = $derived(view.room!)
  const opts = $derived(room.opts ?? DEFAULT_ROOM_OPTS)
  const pub = $derived(room.pub!)
  const seats = $derived(room.seats)
  const my = $derived(view.mySeat)
  const myTeam = $derived(teamOf(my))
  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)
  const playingTeam = $derived(pub.bidder === null ? null : teamOf(pub.bidder))

  const name = (i: number) => seatName($t, seats[i]?.name, i)
  const rel = (seat: number) => relSeat(seat, my)
  /** Each won trick lies clearly askew on the pile, so the tricks can be counted. The skew
   *  differs per hand, team and trick, but is derived, not random: a redraw must not move
   *  a card, and every client must see the same pile. Neighbours turn opposite ways. */
  const pileSkew = (hand: number, team: number, k: number) => {
    let h = Math.imul(hand + 1, 0x9e3779b1) ^ Math.imul(team + 1, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35)
    const next = () => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      return ((h ^= h >>> 15) >>> 0) / 2 ** 32
    }
    const turn = (k % 2 ? 1 : -1) * (6 + next() * 14)
    const x = k * 0.12 + (next() - 0.5) * 0.14
    const y = -k * 0.16 + (next() - 0.5) * 0.1
    return `translate: calc(var(--cw) * ${x.toFixed(3)}) calc(var(--cw) * ${y.toFixed(3)}); rotate: ${turn.toFixed(1)}deg`
  }

  const myTurn = $derived(pub.actionSeats.includes(my))
  const legalPlays = $derived(
    new Set(view.legal.flatMap((a) => (a.type === 'play' ? [cardKey(a.card)] : []))),
  )
  const has = (type: Action['type']) => view.legal.some((a) => a.type === type)
  const chooseSuits = $derived(
    view.legal.flatMap((a) => (a.type === 'choose' && a.suit !== null ? [a.suit] : [])),
  )
  const choosePass = $derived(view.legal.some((a) => a.type === 'choose' && a.suit === null))
  /** Packet sizes I may lift now, in the dealer draw or the cut. */
  const liftSizes = $derived(
    view.legal.flatMap((a) => (a.type === 'draw' || a.type === 'cut' ? [a.n] : [])),
  )
  /** The cut of this deal, shown while the dealer deals. */
  const lastCut = $derived(pub.log.findLast((ev) => ev.t === 'cut'))

  const biddingPhase = $derived(
    pub.phase === 'BIDDING_R1' || pub.phase === 'BIDDING_R2' || pub.phase === 'DEALER_CHOICE',
  )
  const showTurned = $derived(turnedVisible(pub))

  const playing = $derived(isPlaying(pub))

  /** Seats still to confirm the current pause (start of hand or completed trick). */
  const pendingAcks = $derived(
    pub.phase === 'PLAYING' && pub.trickAcks.length < 4 ? pub.actionSeats : ([] as number[]),
  )
  const lingerTrick = $derived(lingerOf(pub))
  /** Won tricks on a team's pile. A trick still lingering on the felt joins the
   *  pile when it flies off; after the last trick it joins at once for the score. */
  const pileCount = (team: number) =>
    pub.tricksWon[team] -
    (pub.phase === 'PLAYING' && lingerTrick !== null && teamOf(pub.leader) === team ? 1 : 0)

  /** At the cut, the packets that form the next deck slide to the middle one by
   *  one, then square up. The cut panel waits for it; the deck stays until the deal. */
  const stack = $derived(deckStack(pub))
  const STACK_FLY = 380
  const STACK_STEP = 260
  const STACK_SQUARE = 200
  /** The finished deck lies alone for a moment before the cut panel covers the felt. */
  const STACK_HOLD = 600
  /** Where each trick pile lay, in card widths from the middle: beside my partner
   *  (ours) or under my left opponent (theirs). Hands come in like their cards (DIR). */
  const PILE_FROM = [
    { x: 0.6, y: -2 },
    { x: -2.1, y: 0.8 },
  ]
  // Old browsers have no matchMedia.
  const reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const stackLand = $derived(stack ? (stack.length - 1) * STACK_STEP + STACK_FLY : 0)
  /** The deck has squared up: the cut panel and the deal wait for it. */
  const stackDone = $derived(stack && !reducedMotion ? stackLand + STACK_SQUARE : 0)
  const cutDelay = $derived(stackDone && stackDone + STACK_HOLD)
  const stackFrom = (part: StackPart) => {
    if (part.from === 'hand') return `--fx: ${DIR[rel(part.seat)].x}px; --fy: ${DIR[rel(part.seat)].y}px`
    const p = PILE_FROM[part.team === myTeam ? 0 : 1]
    return `--fx: calc(var(--card) * ${p.x}); --fy: calc(var(--card) * ${p.y})`
  }
  /** Cards already on the deck below packet `i`: each card lies a hair higher. */
  const stackBelow = (i: number) => stack!.slice(0, i).reduce((n, p) => n + p.count, 0)

  /** The deal. In DEALING the deck slides to the dealer once this felt's stack
   *  has formed. When the engine has dealt (`deal` last in the log), the real
   *  hand cards fly from there straight into the hands, per two, in the order
   *  the engine dealt them (`pairOfCard`). The host waits for it before the
   *  first bid; a blind dealer gets backs, as always during the bidding. */
  const DEAL_PAUSE = 150
  /** Where each hand lies, in card widths from the middle, seen from my seat. */
  const HAND_AT = [
    { x: 0, y: 2.6 },
    { x: -2.4, y: 0 },
    { x: 0, y: -2.2 },
    { x: 2.4, y: 0 },
  ]
  /** The deck lies in front of the dealer, three quarters of the way from the middle. */
  const deckAt = $derived({ x: HAND_AT[rel(pub.dealer)].x * 0.75, y: HAND_AT[rel(pub.dealer)].y * 0.75 })
  const dealing = $derived(pub.phase === 'DEALING')
  const freshDeal = $derived(pub.phase === 'BIDDING_R1' && pub.log.at(-1)?.t === 'deal')
  /** Client clock: when the stack on this felt has formed (0: no stack). */
  let stackReadyAt = 0
  let deckOut = $state(false)
  let dealOver = $state(false)
  $effect(() => {
    if (!stack) stackReadyAt = 0
    else if (!stackReadyAt) stackReadyAt = performance.now() + stackDone
  })
  $effect(() => {
    if (!dealing) {
      deckOut = false
      return
    }
    const timer = setTimeout(
      () => (deckOut = true),
      reducedMotion ? 0 : Math.max(DEAL_PAUSE, stackReadyAt - performance.now()),
    )
    return () => clearTimeout(timer)
  })
  $effect(() => {
    if (!freshDeal) {
      dealOver = false
      return
    }
    const timer = setTimeout(() => (dealOver = true), reducedMotion ? 0 : DEAL_MS)
    return () => clearTimeout(timer)
  })
  /** The cards are still going out: the action buttons wait. */
  const dealRunning = $derived(freshDeal && !dealOver)
  /** Card `k` of `seat`'s dealt hand flies from the deck into its place when the
   *  pair that brings it leaves the deck. */
  const dealIn = (seat: number, k: number) => {
    const to = HAND_AT[rel(seat)]
    return (
      `--d: ${pairOfCard(pub.dealer, seat, k) * DEAL_STEP}ms; --fly: ${DEAL_FLY}ms; ` +
      `--fx: calc(var(--card) * ${deckAt.x - to.x}); --fy: calc(var(--card) * ${deckAt.y - to.y})`
    )
  }

  const lastBid = $derived(lastBids(pub.log))
  const showBids = $derived(showBidsOf(pub))

  const acting = (i: number) => pub.actionSeats.includes(i)

  /** Manual mode: the player's own card order, valid for one hand only. */
  let manual = $state({ hand: -1, order: [] as string[] })
  const displayHand = $derived(
    view.hand &&
      arrangeHand(
        shownHand(pub, my, view.hand),
        $sortMode,
        manual.hand === pub.handNumber ? manual.order : [],
      ),
  )
  const manualSort = $derived($sortMode === 'manual')
  /** Ask once, after the dealer is chosen and the cards are in the hand. */
  const askSort = $derived(
    $sortMode === null && !!view.hand?.length && (biddingPhase || pub.phase === 'PLAYING'),
  )
  const canPlay = (c: Card) => pub.phase === 'PLAYING' && legalPlays.has(cardKey(c))

  /** Pointer drag (mouse and touch) to reorder in manual mode. Only a move
   *  past a few pixels is a drag; a plain tap still plays the card. */
  let drag: { key: string; x: number } | null = null
  let dragKey = $state<string | null>(null)
  let justDragged = false

  function dragStart(e: PointerEvent) {
    const el = (e.target as Element).closest<HTMLElement>('[data-card]')
    if (manualSort && el) drag = { key: el.dataset.card!, x: e.clientX }
  }
  function dragMove(e: PointerEvent) {
    if (!drag || !displayHand) return
    if (dragKey === null) {
      if (Math.abs(e.clientX - drag.x) < 8) return
      dragKey = drag.key
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-card]')
    const keys = displayHand.map(cardKey)
    const from = keys.indexOf(dragKey)
    const to = over ? keys.indexOf(over.dataset.card!) : -1
    if (from < 0 || to < 0 || from === to) return
    manual = { hand: pub.handNumber, order: moveCard(keys, from, to) }
  }
  function dragEnd() {
    if (dragKey !== null) {
      // The click that follows the release must not play the card.
      justDragged = true
      setTimeout(() => (justDragged = false))
    }
    drag = null
    dragKey = null
  }

  /** One-shot confetti burst when the match ends. */
  const CONFETTI_COLORS = ['var(--gold)', 'var(--team-decl)', 'var(--team-def)', 'var(--accent)', '#fff']
  const confetti = Array.from({ length: 72 }, (_, i) => ({
    x: Math.random() * 100,
    delay: Math.random() * 900,
    dur: 2200 + Math.random() * 1800,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rot: Math.random() * 360,
  }))

  /** Short-lived table talk, one bubble per seat. The host picks the quotes;
   *  `room.quotes` makes every client show the same line at the same moment. */
  let sayings = $state<Record<number, { key: string; text: string }>>({})
  const firedQuotes = new Set<number>()
  const say = (seat: number, key: string, text: string) => {
    sayings = { ...sayings, [seat]: { key, text } }
    setTimeout(() => {
      if (sayings[seat]?.key !== key) return
      const rest = { ...sayings }
      delete rest[seat]
      sayings = rest
    }, 4000)
  }
  $effect(() => {
    const now = Date.now()
    for (const q of room.quotes ?? []) {
      if (firedQuotes.has(q.n)) continue
      firedQuotes.add(q.n)
      // A joining or reloading client may see old entries: skip them.
      if (now - q.at > 30_000) continue
      say(q.seat, `q${q.n}`, q.text)
    }
  })

  /** A bubble floats above my nameplate: the wait hint below must lift clear of it. */
  const meBubble = $derived(
    sayings[my] !== undefined || (showBids && lastBid.has(my)) || troefkeBubble(pub, my),
  )

  $effect(() => {
    document.title = myTurn ? `● ${$t.yourTurn} — ${$t.title}` : $t.title
    return () => {
      document.title = $t.title
    }
  })
</script>

{#snippet nameplateOf(seat: number)}
  {@const s = seats[seat]}
  <Nameplate
    name={name(seat)}
    bot={!!s?.bot}
    you={seat === my}
    active={acting(seat)}
    side={sideOf(pub, seat)}
    dealer={seat === pub.dealer}
    bidder={pub.bidder === seat}
    tricks={opts.score && playing ? pub.tricksWon[teamOf(seat)] : null}
    bid={showBids ? lastBid.get(seat) : undefined}
    troef={troefkeBubble(pub, seat)}
    say={sayings[seat]?.text}
    onkick={isHost && s && !s.bot && seat !== my ? () => onkick(seat) : undefined}
  />
{/snippet}

{#snippet turnedAt(seat: number)}
  <TurnedCards {pub} {seat} fresh={freshDeal} dealStyle={(k) => dealIn(seat, k)} />
{/snippet}

{#snippet trickPile(team: number)}
  {#if playing && pileCount(team) > 0}
    {@const label = `${teamName(team)} — ${$t.tricks}: ${pileCount(team)}`}
    <!-- The ring repeats the team colour of the nameplates. The wrapper has its
         own transition: a local one on the first card would not play. -->
    <div
      class="trick-pile"
      class:decl={team === playingTeam}
      class:def={team !== playingTeam}
      role="img"
      title={label}
      aria-label={label}
      in:scale={{ start: 0.6, duration: 220 }}
    >
      {#each Array(pileCount(team)) as _, k (k)}
        <div
          class="pile-card"
          style={pileSkew(pub.handNumber, team, k)}
          in:scale={{ start: 0.6, duration: 220 }}
        >
          <div class="card-back"></div>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet opponent(seat: number, pos: number)}
  <Opponent {pos}>
    {#snippet nameplate()}{@render nameplateOf(seat)}{/snippet}
    {#snippet turned()}{@render turnedAt(seat)}{/snippet}
    {#each Array(Math.max(0, pub.handCounts[seat] - (showTurned && seat === pub.dealer ? 2 : 0))) as _, k (k)}
      <div class="opp-card" class:dealt={freshDeal} style={freshDeal ? dealIn(seat, k) : undefined}>
        <div class="card-back"></div>
      </div>
    {/each}
    <!-- One pile per team, right by the hand: ours at my partner, theirs at the left opponent. -->
    {#if pos !== 3}{@render trickPile(teamOf(seat))}{/if}
  </Opponent>
{/snippet}

<div class="table-wrap">
  {#if view.hostStale}<div class="hostleft">{$t.hostLeft}</div>{/if}
  {#if view.offline}<div class="hostleft">{$t.offline}</div>{/if}
  <div class="table">
    <div class="felt">
      {#if opts.info}<InfoPanel {pub} {seats} {myTeam} {opts} />{/if}
      <Boomke marks={pub.marks} {myTeam} phase={pub.phase} />

      {@render opponent((my + 2) % 4, 2)}
      {@render opponent((my + 1) % 4, 1)}
      {@render opponent((my + 3) % 4, 3)}

      <div class="area-center">
        <TrickArea {pub} {my}>
          {#if stack && !deckOut}
            <div class="deck-stack" style="--fly: {STACK_FLY}ms; --square: {STACK_SQUARE}ms">
              {#each stack as part, i (i)}
                <div
                  class="stack-part"
                  class:decl={part.from === 'pile' && part.team === playingTeam}
                  class:def={part.from === 'pile' && part.team !== playingTeam}
                  style="{stackFrom(part)}; --d: {i * STACK_STEP}ms"
                >
                  {#each Array(part.count) as _, k (k)}
                    <div
                      class="pile-card"
                      style="{part.from === 'pile' ? `${pileSkew(pub.handNumber, part.team, k)}; ` : ''}--k: {stackBelow(i) + k}; --d: {stackLand}ms"
                    >
                      <div class="card-back"></div>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
          {#if (dealing && deckOut) || dealRunning}
            <!-- The deck at the dealer, one layer per pair, the first pair on top:
                 each layer goes when its pair leaves. A first deal has no stacked
                 deck to take over, so its deck comes in. -->
            <div
              class="deck-stack deal"
              style="--dx: calc(var(--card) * {deckAt.x}); --dy: calc(var(--card) * {deckAt.y})"
              in:scale={{ start: 0.6, duration: stack ? 0 : 220 }}
            >
              {#each Array(12) as _, j (j)}
                <div
                  class="deal-layer"
                  class:going={freshDeal}
                  style="--k: {11 - j}; --d: {j * DEAL_STEP}ms; z-index: {12 - j}"
                >
                  <div class="pile-card"><div class="card-back"></div></div>
                </div>
              {/each}
            </div>
          {/if}
        </TrickArea>
      </div>

      <div
        class="felt-overlay"
        class:lifted={showTurned && my === pub.dealer}
        class:scored={pub.phase === 'SCORED' || pub.phase === 'GAME_OVER'}
      >
        {#if pub.phase === 'DEALER_DRAW' && pub.dealerDraw}
          {@const dd = pub.dealerDraw}
          <div class="panel overlay-panel" in:scale={{ duration: 200 }}>
            <h3>{$t.drawForDealer}</h3>
            <div class="draws">
              {#each dd.draws as d (d.seat)}
                <div class="drawn" in:scale={{ duration: 250 }}>
                  <span class="drawn-card"><CardView card={d.card} /></span>
                  <span class="small">{name(d.seat)}</span>
                </div>
              {/each}
            </div>
            {#if dd.pending === 2 && !has('chooseDealer')}
              <div class="small">{name(dd.winnerSeat!)} {$t.picksDealer}</div>
            {:else if liftSizes.length > 0}
              <PacketLift
                total={dd.pending === 0 ? 24 : 24 - dd.packetA!}
                sizes={liftSizes}
                onlift={(n) => send({ type: 'draw', seat: my, n })}
              />
            {:else if dd.pending !== 2}
              <div class="small">{name(dd.drawer[dd.pending])} {$t.drawsNow}</div>
            {/if}
          </div>
        {:else if pub.phase === 'CUTTING'}
          <div class="panel overlay-panel" in:scale={{ duration: 200, delay: cutDelay }}>
            <strong>{name(pub.dealer)} {$t.isDealer}</strong>
            {#if liftSizes.length > 0}
              <h3>{$t.cutTitle}</h3>
              <PacketLift total={24} sizes={liftSizes} onlift={(n) => send({ type: 'cut', seat: my, n })} />
            {:else}
              <div class="small">{name(pub.actionSeats[0])} {$t.cutsNow}</div>
            {/if}
          </div>
        {:else if pub.phase === 'DEALING'}
          <div class="panel overlay-panel" in:scale={{ duration: 200 }}>
            <strong>{name(pub.dealer)} {$t.isDealer}</strong>
            {#if lastCut}
              <div class="small">{name(lastCut.seat!)} {$t.cutDid}</div>
            {/if}
          </div>
        {:else if (pub.phase === 'SCORED' && pub.lastResult) || pub.phase === 'GAME_OVER'}
          <ResultPanel {pub} {myTeam} />
        {/if}

        <!-- Action buttons float on the felt, raised like table buttons.
             On the first deal the sort question comes first: it holds
             back the bid buttons until the player has chosen. -->
        {#if dealRunning}
          <!-- The cards are still going out: nothing to choose yet. -->
        {:else if askSort}
          <span class="fab-caption" in:fly={{ y: 8, duration: 200 }}>{$t.sortAsk}</span>
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            {#each SORT_MODES as m (m)}
              <button
                class="fab"
                title={m === 'manual' ? $t.sortManualHint : undefined}
                onclick={() => sortMode.set(m)}>{$t[SORT_LABEL[m]]}</button
              >
            {/each}
          </div>
        {:else if has('chooseDealer')}
          <span class="fab-caption" in:fly={{ y: 8, duration: 200 }}>{$t.chooseDealer}</span>
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            {#each [0, 1, 2, 3] as d (d)}
              <button class="fab" onclick={() => send({ type: 'chooseDealer', seat: my, dealer: d })}>
                {name(d)}
              </button>
            {/each}
          </div>
        {:else if has('ack') || has('troefke')}
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            {#if has('troefke')}
              <button class="fab troef" onclick={() => send({ type: 'troefke', seat: my })}>{$t.troefkeAsk}</button>
            {/if}
            {#if has('ack')}
              <button class="fab primary pulse" onclick={() => send({ type: 'ack', seat: my })}>{$t.seen}</button>
            {/if}
          </div>
        {:else if has('bid')}
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            <button class="fab primary pulse" onclick={() => send({ type: 'bid', seat: my, play: true })}>
              {$t.play}
            </button>
            <button class="fab" onclick={() => send({ type: 'bid', seat: my, play: false })}>
              {$t.pass}
            </button>
          </div>
        {:else if has('choose')}
          <span class="fab-caption" in:fly={{ y: 8, duration: 200 }}>{$t.dealerChoice}</span>
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            {#each chooseSuits as s (s)}
              <button class="fab" onclick={() => send({ type: 'choose', seat: my, suit: s })}>
                {SUIT_GLYPH[s]}
              </button>
            {/each}
            {#if choosePass}
              <button class="fab" onclick={() => send({ type: 'choose', seat: my, suit: null })}>
                {$t.pass}
              </button>
            {/if}
          </div>
        {:else if has('next')}
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            <button class="fab primary" onclick={() => send({ type: 'next', seat: my })}>
              {$t.nextHand}
            </button>
          </div>
        {:else if pub.phase === 'GAME_OVER' && isHost}
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            <button class="fab primary" onclick={onnewmatch}>{$t.newMatch}</button>
          </div>
        {/if}

        <!-- While the game waits on confirmations, say who we're waiting on. -->
        {#if pendingAcks.length > 0 && !has('ack')}
          <span class="wait-hint" class:lifted={meBubble} in:fly={{ y: 8, duration: 200 }}>
            {$t.waitingFor} {pendingAcks.map((s) => name(s)).join(', ')}…
          </span>
        {/if}
      </div>

      <div class="area-me">
        <div class="me-anchor">
          {@render nameplateOf(my)}
          {@render turnedAt(my)}
          {#if myTurn}
            <span class="turn-hint" in:fly={{ x: -8, duration: 200 }}>{$t.yourTurnHint}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="my-hand-wrap" class:my-turn={myTurn && pub.phase === 'PLAYING'}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="my-hand"
        class:manual={manualSort}
        onpointerdown={dragStart}
        onpointermove={dragMove}
        onpointerup={dragEnd}
        onpointercancel={dragEnd}
      >
        {#if view.hand === null}
          {#each Array(Math.max(0, pub.handCounts[my] - (showTurned ? 2 : 0))) as _, k (k)}
            <div class="hand-card" class:dealt={freshDeal} style={freshDeal ? dealIn(my, k) : undefined}>
              <div class="card-back"></div>
            </div>
          {/each}
        {:else}
          {#each displayHand ?? [] as c, i (`${pub.handNumber}-${cardKey(c)}`)}
            <!-- In manual mode cards stay enabled so they can be dragged;
                 the click handler still only plays legal cards. -->
            <button
              class="hand-card"
              class:playable={canPlay(c)}
              class:dim={pub.phase === 'PLAYING' && myTurn && !canPlay(c)}
              class:dragging={dragKey === cardKey(c)}
              data-card={cardKey(c)}
              disabled={!manualSort && !canPlay(c)}
              aria-disabled={!canPlay(c)}
              class:dealt={freshDeal}
              style={freshDeal ? dealIn(my, view.hand.findIndex((h) => cardKey(h) === cardKey(c))) : undefined}
              in:fly={{ y: -160, duration: freshDeal ? 0 : 320, delay: 120 + i * 45 }}
              onclick={() => {
                if (canPlay(c) && !justDragged) send({ type: 'play', seat: my, card: c })
              }}
            >
              <CardView card={c} />
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  {#if pub.phase === 'GAME_OVER'}
    <div class="confetti" aria-hidden="true">
      {#each confetti as c, i (i)}
        <i
          style="left:{c.x}%; --cf:{c.color}; --rot:{c.rot}deg; animation-delay:{c.delay}ms; animation-duration:{c.dur}ms"
        ></i>
      {/each}
    </div>
  {/if}
</div>
