<script lang="ts">
  import type { Action, Card, Suit } from '../engine'
  import type { SessionView } from '../lib/room'
  import { SUIT_GLYPH, t, suitName, lang } from '../lib/i18n'
  import type { SeatInfo } from '../lib/net-types'
  import CardView from './CardView.svelte'
  import Boomke from './Boomke.svelte'
  import LogPanel from './LogPanel.svelte'

  let {
    view,
    send,
    isHost,
    onleave,
    onnewmatch,
  }: {
    view: SessionView
    send: (a: Action) => void
    isHost: boolean
    onleave: () => void
    onnewmatch: () => void
  } = $props()

  const room = $derived(view.room!)
  const pub = $derived(room.pub!)
  const seats = $derived(room.seats)
  const my = $derived(view.mySeat)

  const name = (i: number) => seats[i]?.name ?? `#${i}`
  /** Relative position: 0 bottom (me), 1 left, 2 top, 3 right. */
  const rel = (seat: number) => (seat - my + 4) % 4

  const myTurn = $derived(pub.actionSeats.includes(my))
  const legalPlays = $derived(
    new Set(
      view.legal.filter((a) => a.type === 'play').map((a) => (a as { card: Card }).card.s + (a as { card: Card }).card.r),
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

  const backs = (seat: number) => {
    let n = pub.handCounts[seat]
    if (biddingPhase && seat === pub.dealer && n > 0) n -= 1 // upturned card lies on the table
    return n
  }

  const bidderSeat = (i: number) => pub.bidder === i
  const acting = (i: number) => pub.actionSeats.includes(i)

  const teamTag = (i: number) => (i % 2 === 0 ? 'A' : 'B')
</script>

{#snippet seatBox(seat: number)}
  {@const s: SeatInfo | null = seats[seat]}
  <div class="seatbox" class:acting={acting(seat)} class:me={seat === my}>
    <div class="sname">
      {name(seat)}
      {#if s?.bot}<em class="tag">{$t.bot}</em>{/if}
      {#if seat === my}<em class="tag">{$t.you}</em>{/if}
      {#if seat === pub.dealer}<span class="chip dealer">D</span>{/if}
      {#if bidderSeat(seat)}<span class="chip bidder">★</span>{/if}
    </div>
    <div class="steam">{$t[`team${teamTag(seat)}` as 'teamA' | 'teamB']}</div>
    {#if seat !== my}
      <div class="backs">
        {#each Array(Math.max(0, backs(seat))) as _, k (k)}
          <div class="mini-back"></div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="table-wrap">
  {#if view.hostStale}<div class="hostleft">{$t.hostLeft}</div>{/if}

  <div class="table">
    <!-- top: partner -->
    <div class="pos top">{@render seatBox((my + 2) % 4)}</div>
    <!-- left / right opponents -->
    <div class="pos left">{@render seatBox((my + 1) % 4)}</div>
    <div class="pos right">{@render seatBox((my + 3) % 4)}</div>

    <!-- center -->
    <div class="center">
      {#if pub.phase === 'DEALER_DRAW' && pub.dealerDraw}
        {@const dd = pub.dealerDraw}
        <div class="drawpanel">
          <h3>{$t.drawForDealer}</h3>
          <div class="draws">
            {#each dd.draws as d (d.seat)}
              <div class="drawn">
                <CardView card={d.card} small />
                <span>{name(d.seat)}</span>
              </div>
            {/each}
          </div>
          {#if dd.pending === 2}
            {#if has('chooseDealer')}
              <div>{$t.chooseDealer}:</div>
              <div class="btnrow">
                {#each [0, 1, 2, 3] as d (d)}
                  <button class="btn" onclick={() => send({ type: 'chooseDealer', seat: my, dealer: d })}>
                    {name(d)}
                  </button>
                {/each}
              </div>
            {:else}
              <div>{$t.chooseDealer}: {name(dd.winnerSeat!)}</div>
            {/if}
          {:else if has('draw')}
            <button class="btn primary" onclick={() => send({ type: 'draw', seat: my })}>{$t.draw}</button>
          {:else}
            <div>{name(dd.drawer[dd.pending])} {$t.drawsNow}</div>
          {/if}
        </div>
      {:else if pub.phase === 'DEALING'}
        <div class="drawpanel">
          {#if has('deal')}
            <button class="btn primary" onclick={() => send({ type: 'deal', seat: my })}>{$t.deal}</button>
          {:else}
            <div>{$t.dealWait} ({name(pub.dealer)})</div>
          {/if}
        </div>
      {:else}
        <!-- turned cards -->
        {#if pub.turned}
          <div class="turned">
            <div class="tcard">
              <CardView card={pub.turned.first} small />
              <span class="cap">{$t.turnedCard}</span>
            </div>
            <div class="tcard">
              <CardView card={pub.turned.secondUp ? pub.turned.second : null} small />
              <span class="cap">{$t.secondCard}</span>
            </div>
          </div>
        {/if}

        {#if pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER'}
          <div class="trick">
            {#each pub.trick as tc (tc.seat)}
              <div class="tpos p{rel(tc.seat)}"><CardView card={tc.card} /></div>
            {/each}
            {#if pub.trick.length === 0 && pub.lastTrick}
              {#each pub.lastTrick as tc (tc.seat)}
                <div class="tpos p{rel(tc.seat)} dim"><CardView card={tc.card} small /></div>
              {/each}
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <!-- side info -->
    <div class="side">
      <Boomke lines={pub.lines} koeien={pub.koeien} />
      <div class="scoreinfo">
        {#if pub.trump}<div>{$t.trump}: {SUIT_GLYPH[pub.trump]} {suitName(pub.trump, $lang)}</div>{/if}
        {#if pub.multiplier > 1}<div>{$t.stake}: ×{pub.multiplier}</div>{/if}
        <div>{$t.tricks}: {pub.tricksWon[0]}–{pub.tricksWon[1]}</div>
        <div>{$t.points}: {pub.points[0]}–{pub.points[1]}</div>
        {#if pub.bidder !== null}<div>{$t.playingTeam}: {name(pub.bidder)} ({teamTag(pub.bidder)})</div>{/if}
      </div>
      <LogPanel log={pub.log} {seats} />
    </div>

    <!-- bottom: me -->
    <div class="pos bottom">
      {@render seatBox(my)}

      {#if pub.phase === 'SCORED' && pub.lastResult}
        {@const r = pub.lastResult}
        <div class="result">
          <strong>{$t.scored}:</strong>
          {r.points[0]}–{r.points[1]} →
          {r.winnerTeam === 0 ? $t.teamA : $t.teamB}
          {r.erased} {$t.erased}{r.kapot ? ` (${$t.kapot})` : ''}{r.koei ? ` +${$t.koei}` : ''}
        </div>
      {/if}
      {#if pub.phase === 'GAME_OVER'}
        <div class="result over">
          {$t.gameOver}: {pub.winner === 0 ? $t.teamA : $t.teamB} {$t.wins}!
          {#if isHost}<button class="btn" onclick={onnewmatch}>{$t.newMatch}</button>{/if}
        </div>
      {/if}

      <!-- action controls -->
      <div class="controls">
        {#if has('bid')}
          <button class="btn primary" onclick={() => send({ type: 'bid', seat: my, play: true })}>{$t.play}</button>
          <button class="btn" onclick={() => send({ type: 'bid', seat: my, play: false })}>{$t.pass}</button>
        {:else if has('choose')}
          <span>{$t.dealerChoice}:</span>
          {#each chooseSuits as s (s)}
            <button class="btn primary" onclick={() => send({ type: 'choose', seat: my, suit: s })}>
              {SUIT_GLYPH[s]}
            </button>
          {/each}
          {#if choosePass}<button class="btn" onclick={() => send({ type: 'choose', seat: my, suit: null })}>{$t.pass}</button>{/if}
        {:else if has('next')}
          <button class="btn primary" onclick={() => send({ type: 'next', seat: my })}>{$t.nextHand}</button>
        {/if}
        {#if biddingPhase && my === pub.dealer}<span class="hint">{$t.handHidden}</span>{/if}
      </div>

      <!-- own hand -->
      <div class="hand">
        {#if view.hand === null}
          {#each Array(Math.max(0, pub.handCounts[my] - (pub.turned ? 1 : 0))) as _, k (k)}
            <CardView card={null} />
          {/each}
        {:else}
          {#each view.hand ?? [] as c (c.s + c.r)}
            <CardView
              card={c}
              disabled={pub.phase !== 'PLAYING' || !legalPlays.has(c.s + c.r)}
              onclick={legalPlays.has(c.s + c.r) ? () => send({ type: 'play', seat: my, card: c }) : undefined}
            />
          {/each}
        {/if}
      </div>
    </div>
  </div>
  <div class="leavebar"><button class="btn tiny" onclick={onleave}>{$t.leave}</button></div>
</div>
