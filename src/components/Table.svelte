<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import type { Action, Card } from '../engine'
  import { shownHand, teamOf, turnedVisible } from '../engine'
  import type { SessionView } from '../lib/room'
  import { SUIT_GLYPH, t } from '../lib/i18n'
  import { arrangeHand, cardKey, moveCard, SORT_LABEL, SORT_MODES, sortMode } from '../lib/prefs'
  import type { SeatInfo } from '../lib/net-types'
  import { DEFAULT_ROOM_OPTS } from '../lib/net-types'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'
  import PacketLift from './PacketLift.svelte'

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

  const name = (i: number) => seats[i]?.name ?? `#${i}`
  /** Relative position: 0 bottom (me), 1 left, 2 top, 3 right. */
  const rel = (seat: number) => (seat - my + 4) % 4
  /** Fly direction from each screen position toward the centre. */
  const DIR = [
    { x: 0, y: 160 },
    { x: -180, y: 0 },
    { x: 0, y: -160 },
    { x: 180, y: 0 },
  ]
  const TILT = [-4, 3, -2, 5]
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
    new Set(view.legal.flatMap((a) => (a.type === 'play' ? [a.card.s + a.card.r] : []))),
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

  const playing = $derived(
    pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER',
  )

  /** Seats still to confirm the current pause (start of hand or completed trick). */
  const pendingAcks = $derived(
    pub.phase === 'PLAYING' && pub.trickAcks.length < 4
      ? [0, 1, 2, 3].filter((s) => !pub.trickAcks.includes(s))
      : ([] as number[]),
  )
  /** A completed trick lingers on the felt until the winner leads again. */
  const lingerTrick = $derived(
    playing && pub.trick.length === 0 && pub.lastTrick !== null ? pub.lastTrick : null,
  )
  /** Trick cards to render: the trick in progress, or the lingering last one. */
  const showCards = $derived(
    pub.phase === 'PLAYING' && pub.trick.length > 0 ? pub.trick : lingerTrick,
  )
  /** Lingered cards fly out towards the seat that won the trick. */
  const lingerExit = $derived(DIR[rel(pub.leader)])
  /** Won tricks on a team's pile. A trick still lingering on the felt joins the
   *  pile when it flies off; after the last trick it joins at once for the score. */
  const pileCount = (team: number) =>
    pub.tricksWon[team] -
    (pub.phase === 'PLAYING' && lingerTrick !== null && teamOf(pub.leader) === team ? 1 : 0)

  /** Latest bid ("Ik ga"/"Pas") each seat announced this hand, read back from the log. */
  const lastBid = $derived.by(() => {
    const map = new Map<number, string>()
    for (let i = pub.log.length - 1; i >= 0; i--) {
      const ev = pub.log[i]
      if (
        ev.t === 'deal' ||
        ev.t === 'first-dealer' ||
        ev.t === 'all-pass' ||
        ev.t === 'second-card' ||
        ev.t === 'score' ||
        ev.t === 'tied'
      )
        break
      if (ev.seat === undefined || map.has(ev.seat)) continue
      if (ev.t === 'pass' || ev.t === 'dealer-pass') map.set(ev.seat, $t.pass)
      else if (ev.t === 'play-call') map.set(ev.seat, $t.play)
    }
    return map
  })

  /** Bubbles stay up during bidding, the dealer announce and until the first card falls. */
  const showBids = $derived(
    biddingPhase ||
      pub.phase === 'DEALING' ||
      (pub.phase === 'PLAYING' && pub.tricksPlayed === 0 && pub.trick.length === 0),
  )

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
    sayings[my] !== undefined ||
      (showBids && lastBid.has(my)) ||
      (pub.troefkeAsked && my === pub.bidder && pub.tricksPlayed === 0 && pub.trick.length === 0),
  )

  $effect(() => {
    document.title = myTurn ? `● ${$t.yourTurn} — ${$t.title}` : $t.title
    return () => {
      document.title = $t.title
    }
  })
</script>

{#snippet nameplate(seat: number)}
  {@const s: SeatInfo | null = seats[seat]}
  {@const side = playingTeam !== null && playing ? (teamOf(seat) === playingTeam ? 'decl' : 'def') : null}
  <div class="nameplate" class:active={acting(seat)} class:decl={side === 'decl'} class:def={side === 'def'}>
    <span class="avatar">{s?.bot ? '🤖' : name(seat).slice(0, 1).toUpperCase()}</span>
    <span class="np-name">
      {name(seat)}{#if seat === my}<span class="np-muted"> ({$t.you})</span>{/if}
    </span>
    {#if seat === pub.dealer}<span class="chip dealer" title={$t.dealerTag}>D</span>{/if}
    {#if pub.bidder === seat}<span class="chip bidder" title={$t.bidderTag}>★</span>{/if}
    {#if opts.score && playing}<span class="chip tricks">{pub.tricksWon[teamOf(seat)]}</span>{/if}
    <div class="bubbles" class:has-say={!!sayings[seat]}>
      {#if showBids && lastBid.has(seat)}<span class="bubble" in:scale={{ start: 0.6, duration: 180 }}>{lastBid.get(seat)}</span>{/if}
      {#if pub.troefkeAsked && seat === pub.bidder && pub.tricksPlayed === 0 && pub.trick.length === 0}
        <span class="bubble troef" in:scale={{ start: 0.6, duration: 180 }}>{$t.troefWanted}</span>
      {/if}
      {#if sayings[seat]}<span class="bubble say" in:scale={{ start: 0.6, duration: 180 }}>{sayings[seat].text}</span>{/if}
    </div>
    {#if isHost && s && !s.bot && seat !== my}
      <button
        class="icon-btn tiny kick"
        title={$t.remove}
        aria-label={$t.remove}
        onclick={() => onkick(seat)}>✕</button>
    {/if}
  </div>
{/snippet}

{#snippet turnedAt(seat: number)}
  {#if showTurned && seat === pub.dealer && pub.turned}
    <div class="turned-at" title={$t.turnedCard}>
      <span class="mini-card"><CardView card={pub.turned.first} /></span>
      <span class="mini-card" in:scale={{ duration: 250 }}>
        <CardView card={pub.turned.secondUp ? pub.turned.second : null} />
      </span>
    </div>
  {/if}
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
  <div class="seat seat-p{pos}">
    {@render nameplate(seat)}
    <div class="opp-hand" class:vertical={pos !== 2} class:horizontal={pos === 2}>
      {#each Array(Math.max(0, pub.handCounts[seat] - (showTurned && seat === pub.dealer ? 2 : 0))) as _, k (k)}
        <div class="opp-card"><div class="card-back"></div></div>
      {/each}
      <!-- One pile per team, right by the hand: ours at my partner, theirs at the left opponent. -->
      {#if pos !== 3}{@render trickPile(teamOf(seat))}{/if}
    </div>
    {@render turnedAt(seat)}
  </div>
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
        <div class="trick-area">
          <!-- One keyed list across trick → linger: cards already on the felt
               stay put, only the newly played card flies in. -->
          {#if showCards}
            {#each showCards as tc, i ((lingerTrick ? pub.tricksPlayed - 1 : pub.tricksPlayed) + '-' + tc.seat)}
              <div
                class="trick-card tp{rel(tc.seat)}"
                class:done={lingerTrick !== null}
                class:won={lingerTrick !== null && tc.seat === pub.leader}
                style="rotate: {TILT[(i + showCards[0].seat) % 4]}deg; z-index: {i + 1}"
                in:fly={{
                  x: DIR[rel(tc.seat)].x * 0.8,
                  y: DIR[rel(tc.seat)].y * 0.8,
                  duration: 240,
                }}
                out:fly={{ x: lingerExit.x * 1.6, y: lingerExit.y * 1.6, duration: 420 }}
              >
                <CardView card={tc.card} />
              </div>
            {/each}
          {/if}
        </div>
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
          <div class="panel overlay-panel" in:scale={{ duration: 200 }}>
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
        {:else if pub.phase === 'SCORED' && pub.lastResult}
          {@const r = pub.lastResult}
          <div class="panel overlay-panel result" in:scale={{ duration: 220 }}>
            <div class="result-head">{$t.scored}</div>
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
          </div>
        {:else if pub.phase === 'GAME_OVER'}
          {@const r = pub.lastResult}
          <div class="panel overlay-panel result over" in:scale={{ duration: 260 }}>
            <div class="result-head">{$t.gameOver}</div>
            {#if r}
              <div class="result-score">
                <span class="rs-name">{$t.wij}</span>
                <b class="rs-num">{r.points[myTeam]}–{r.points[1 - myTeam]}</b>
                <span class="rs-name">{$t.zij}</span>
              </div>
              <div class="result-flags">
                <span class="chip">{r.erased} {$t.erased}</span>
                {#if r.kapot}<span class="chip flag-bad">{$t.kapot}</span>{/if}
                {#if r.koei}<span class="chip flag-koei">+{$t.koei}</span>{/if}
              </div>
            {/if}
            <strong>{teamName(pub.winner!)} {$t.wins}!</strong>
          </div>
        {/if}

        <!-- Action buttons float on the felt, raised like table buttons.
             On the first deal the sort question comes first: it holds
             back the bid buttons until the player has chosen. -->
        {#if askSort}
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
          {@render nameplate(my)}
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
            <div class="hand-card"><div class="card-back"></div></div>
          {/each}
        {:else}
          {#each displayHand ?? [] as c, i (`${pub.handNumber}-${c.s}${c.r}`)}
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
              in:fly={{ y: -160, duration: 320, delay: 120 + i * 45 }}
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
