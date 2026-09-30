<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import type { Action, Card, Suit } from '../engine'
  import type { SessionView } from '../lib/room'
  import { SUIT_GLYPH, t } from '../lib/i18n'
  import type { SeatInfo } from '../lib/net-types'
  import { DEFAULT_ROOM_OPTS } from '../lib/net-types'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import InfoPanel from './InfoPanel.svelte'

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
  const myTeam = $derived(my % 2)
  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)
  const playingTeam = $derived(pub.bidder === null ? null : pub.bidder % 2)

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

  const myTurn = $derived(pub.actionSeats.includes(my))
  const legalPlays = $derived(
    new Set(
      view.legal
        .filter((a) => a.type === 'play')
        .map((a) => (a as { card: Card }).card.s + (a as { card: Card }).card.r),
    ),
  )
  const has = (type: Action['type']) => view.legal.some((a) => a.type === type)
  const chooseSuits = $derived(
    view.legal.filter((a) => a.type === 'choose' && a.suit !== null).map((a) => (a as { suit: Suit }).suit),
  )
  const choosePass = $derived(view.legal.some((a) => a.type === 'choose' && a.suit === null))

  const biddingPhase = $derived(
    pub.phase === 'BIDDING_R1' || pub.phase === 'BIDDING_R2' || pub.phase === 'DEALER_CHOICE',
  )
  const dealerBlind = $derived(biddingPhase && my === pub.dealer)
  /** The turned cards sit at the dealer's seat while bidding runs. */
  // Turned cards stay at the dealer until all seats confirmed them at play start.
  const showTurned = $derived(
    pub.turned !== null &&
      (biddingPhase ||
        (pub.phase === 'PLAYING' && pub.tricksPlayed === 0 && pub.trickAcks.length < 4)),
  )

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

  /** Latest bid ("Ik ga"/"Pas") each seat announced this hand, read back from the log. */
  const lastBid = $derived.by(() => {
    const map = new Map<number, string>()
    for (let i = pub.log.length - 1; i >= 0; i--) {
      const ev = pub.log[i]
      if (ev.t === 'deal' || ev.t === 'first-dealer' || ev.t === 'all-pass') break
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

  $effect(() => {
    document.title = myTurn ? `● ${$t.yourTurn} — ${$t.title}` : $t.title
    return () => {
      document.title = $t.title
    }
  })
</script>

{#snippet nameplate(seat: number)}
  {@const s: SeatInfo | null = seats[seat]}
  {@const side = playingTeam !== null && playing ? (seat % 2 === playingTeam ? 'decl' : 'def') : null}
  <div class="nameplate" class:active={acting(seat)} class:decl={side === 'decl'} class:def={side === 'def'}>
    <span class="avatar">{s?.bot ? '🤖' : name(seat).slice(0, 1).toUpperCase()}</span>
    <span class="np-name">
      {name(seat)}{#if seat === my}<span class="np-muted"> ({$t.you})</span>{/if}
    </span>
    {#if seat === pub.dealer}<span class="chip dealer" title={$t.dealerTag}>D</span>{/if}
    {#if pub.bidder === seat}<span class="chip bidder" title={$t.bidderTag}>★</span>{/if}
    {#if opts.score && playing}<span class="chip tricks">{pub.tricksWon[seat % 2]}</span>{/if}
    {#if showBids && lastBid.has(seat)}<span class="bubble" in:scale={{ start: 0.6, duration: 180 }}>{lastBid.get(seat)}</span>{/if}
    {#if pub.troefkeAsked && seat === pub.turn && pub.tricksPlayed === 0 && pub.trick.length === 0}
      <span class="bubble troef" in:scale={{ start: 0.6, duration: 180 }}>{$t.troefWanted}</span>
    {/if}
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

{#snippet opponent(seat: number, pos: number)}
  <div class="seat seat-p{pos}">
    {@render nameplate(seat)}
    <div class="opp-hand" class:vertical={pos !== 2} class:horizontal={pos === 2}>
      {#each Array(Math.max(0, pub.handCounts[seat] - (showTurned && seat === pub.dealer ? 2 : 0))) as _, k (k)}
        <div class="opp-card"><div class="card-back"></div></div>
      {/each}
    </div>
    {@render turnedAt(seat)}
  </div>
{/snippet}

<div class="table-wrap">
  {#if view.hostStale}<div class="hostleft">{$t.hostLeft}</div>{/if}
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
            {:else if dd.pending !== 2}
              <div class="small">{name(dd.drawer[dd.pending])} {$t.drawsNow}</div>
            {/if}
          </div>
        {:else if pub.phase === 'DEALING'}
          <div class="panel overlay-panel" in:scale={{ duration: 200 }}>
            <strong>{name(pub.dealer)} {$t.isDealer}</strong>
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
          <div class="panel overlay-panel result over" in:scale={{ duration: 260 }}>
            <strong>{$t.gameOver}</strong>
            <span>{teamName(pub.winner!)} {$t.wins}!</span>
          </div>
        {/if}

        <!-- Action buttons float on the felt, raised like table buttons. -->
        {#if has('chooseDealer')}
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
              <button class="fab primary" onclick={() => send({ type: 'ack', seat: my })}>{$t.seen}</button>
            {/if}
          </div>
        {:else if has('bid')}
          <div class="fab-row" in:fly={{ y: 10, duration: 200 }}>
            <button class="fab primary" onclick={() => send({ type: 'bid', seat: my, play: true })}>
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
          <span class="wait-hint" in:fly={{ y: 8, duration: 200 }}>
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
      {#if dealerBlind}<div class="blind-hint">{$t.handHidden}</div>{/if}
      <div class="my-hand">
        {#if view.hand === null}
          {#each Array(Math.max(0, pub.handCounts[my] - (showTurned ? 2 : 0))) as _, k (k)}
            <div class="hand-card"><div class="card-back"></div></div>
          {/each}
        {:else}
          {#each view.hand ?? [] as c, i (`${pub.handNumber}-${c.s}${c.r}`)}
            <button
              class="hand-card"
              class:playable={pub.phase === 'PLAYING' && legalPlays.has(c.s + c.r)}
              class:dim={pub.phase === 'PLAYING' && myTurn && !legalPlays.has(c.s + c.r)}
              disabled={pub.phase !== 'PLAYING' || !legalPlays.has(c.s + c.r)}
              in:fly={{ y: -160, duration: 320, delay: 120 + i * 45 }}
              onclick={() => send({ type: 'play', seat: my, card: c })}
            >
              <CardView card={c} />
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>
