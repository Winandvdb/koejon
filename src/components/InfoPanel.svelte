<script lang="ts">
  import { slide } from 'svelte/transition'
  import { trickWinnerIndex, type PublicState, type TrickCard } from '../engine'
  import { SUIT_GLYPH, lang, suitName, t } from '../lib/i18n'
  import type { RoomOpts, SeatInfo } from '../lib/net-types'
  import CardView from './CardView.svelte'

  let {
    pub,
    seats,
    myTeam,
    opts,
  }: {
    pub: PublicState
    seats: (SeatInfo | null)[]
    myTeam: number
    opts: RoomOpts
  } = $props()

  let showLast = $state(false)

  const name = (i: number) => seats[i]?.name ?? `#${i}`
  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)

  const redSuit = (s: string) => s === 'H' || s === 'D'

  /** Suit currently on offer while bidding runs (round 1 = first card, else second). */
  const proposed = $derived.by(() => {
    if (pub.trump || !pub.turned) return null
    if (pub.phase !== 'BIDDING_R1' && pub.turned.secondUp && pub.turned.second) {
      return pub.turned.second.s
    }
    return pub.turned.first.s
  })

  /**
   * Table rule: only the first two completed tricks may be looked back at,
   * and only until the first card of the third trick is played.
   */
  const canReview = $derived(
    pub.phase === 'PLAYING' &&
      pub.trick.length === 0 &&
      pub.tricksPlayed >= 1 &&
      pub.tricksPlayed <= 2 &&
      pub.lastTrick !== null,
  )

  /** Reviewable tricks (oldest first), tagged with trick number and winner seat. */
  const lastTricks = $derived.by(() => {
    if (!canReview || pub.trump === null) return [] as { cards: TrickCard[]; winner: number; n: number }[]
    const out: { cards: TrickCard[]; winner: number; n: number }[] = []
    const entries: [TrickCard[] | null, number][] = [
      [pub.prevTrick, pub.tricksPlayed - 1],
      [pub.lastTrick, pub.tricksPlayed],
    ]
    for (const [tr, trn] of entries) {
      if (!tr) continue
      out.push({ cards: tr, winner: tr[trickWinnerIndex(tr, pub.trump)].seat, n: trn })
    }
    return out
  })
</script>

<div class="info-panel">
  <div class="info-head">
    <span class="info-title">
      {#if pub.trump}
        <span class="suitglyph" class:g-red={redSuit(pub.trump)}>{SUIT_GLYPH[pub.trump]}</span>
        {suitName(pub.trump, $lang)}
        <em class="lvltag">{$t[pub.level === 1 ? 'level1' : 'level2']}</em>
      {:else if proposed}
        <span class="suitglyph" class:g-red={redSuit(proposed)}>{SUIT_GLYPH[proposed]}</span>
        {suitName(proposed, $lang)}?
      {:else}
        {$t.trump}: —
      {/if}
      {#if pub.multiplier > 1}<span class="mult">×{pub.multiplier}</span>{/if}
    </span>
  </div>

  <div class="info-body">
      {#if pub.bidder !== null}
        <div class="iline">{$t.playingTeam}: <strong>{name(pub.bidder)}</strong> ({teamName(pub.bidder % 2)})</div>
      {/if}
      {#if opts.score && (pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER')}
        <div class="iline">
          {$t.tricks}: <span class="nw">{$t.wij} {pub.tricksWon[myTeam]}</span> –
          <span class="nw">{$t.zij} {pub.tricksWon[1 - myTeam]}</span>
        </div>
        <div class="iline">
          {$t.points}: <span class="nw">{$t.wij} {pub.points[myTeam]}</span> –
          <span class="nw">{$t.zij} {pub.points[1 - myTeam]}</span>
        </div>
      {/if}

      {#if lastTricks.length > 0}
        <button class="link-btn" onclick={() => (showLast = !showLast)} aria-expanded={showLast}>
          {$t.lastTricks} {showLast ? '▴' : '▾'}
        </button>
        {#if showLast}
          <div class="last-tricks" transition:slide={{ duration: 180 }}>
            {#each lastTricks as tr (tr.n)}
              <div class="lt-label small muted">{$t.trickN} {tr.n}</div>
              <div class="lt-row">
                {#each tr.cards as tc (tc.seat)}
                  <span class="mini" class:won={tc.seat === tr.winner}>
                    <CardView card={tc.card} />
                    <span>{name(tc.seat)}</span>
                  </span>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
  </div>
</div>
