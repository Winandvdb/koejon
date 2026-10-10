<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'
  import type { PublicState } from '../engine'
  import { DIR, lingerTrick, relSeat, shownTrick, TILT } from '../lib/table'
  import CardView from './CardView.svelte'

  let {
    pub,
    my,
    animate = true,
    children,
  }: {
    pub: PublicState
    /** Seat at the bottom. */
    my: number
    /** The replay shows the cards at once. */
    animate?: boolean
    /** Extra layers on the felt (the live table's decks). */
    children?: Snippet
  } = $props()

  const linger = $derived(lingerTrick(pub))
  const cards = $derived(shownTrick(pub))
  /** Lingered cards fly out towards the seat that won the trick. */
  const exit = $derived(DIR[relSeat(pub.leader, my)])
</script>

<div class="trick-area">
  <!-- One keyed list across trick → linger: cards already on the felt
       stay put, only the newly played card flies in. -->
  {#if cards}
    {#each cards as tc, i ((linger ? pub.tricksPlayed - 1 : pub.tricksPlayed) + '-' + tc.seat)}
      {@const from = DIR[relSeat(tc.seat, my)]}
      <div
        class="trick-card tp{relSeat(tc.seat, my)}"
        class:done={linger !== null}
        class:won={linger !== null && tc.seat === pub.leader}
        style="rotate: {TILT[(i + cards[0].seat) % 4]}deg; z-index: {i + 1}"
        in:fly={{ x: from.x * 0.8, y: from.y * 0.8, duration: animate ? 240 : 0 }}
        out:fly={{ x: exit.x * 1.6, y: exit.y * 1.6, duration: animate ? 420 : 0 }}
      >
        <CardView card={tc.card} />
      </div>
    {/each}
  {/if}
  {@render children?.()}
</div>
