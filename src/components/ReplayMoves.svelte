<script lang="ts">
  import { isRedSuit } from '../engine'
  import { SUIT_GLYPH, t } from '../lib/i18n'
  import type { MoveHand, MoveItem } from '../lib/replay'

  let {
    hands,
    names,
    step,
    hand,
    ongo,
  }: {
    hands: MoveHand[]
    names: string[]
    /** The step shown on the table. */
    step: number
    /** The hand shown on the table. */
    hand: number
    ongo: (step: number) => void
  } = $props()

  let list = $state<HTMLElement>()

  // Keep the current item in view while stepping.
  $effect(() => {
    list?.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  function bidText(x: MoveItem): string {
    const a = x.action
    if (a.type === 'bid') return a.play ? $t.play : $t.pass
    if (a.type === 'choose') return a.suit ? `${$t.dealerChoice} ${SUIT_GLYPH[a.suit]}` : `${$t.dealerChoice}: ${$t.pass}`
    return $t.troefWanted
  }
</script>

{#snippet rating(x: MoveItem)}
  {#if x.rating}<span class="mv-rate" title={x.rating.label}>{x.rating.icon}</span>{/if}
{/snippet}

<div class="mv-list" bind:this={list}>
  {#each hands as h (h.n)}
    <section class="mv-hand" class:open={h.n === hand}>
      <button class="mv-head" class:current={step === h.start} data-step={h.start} onclick={() => ongo(h.start)}>
        <b>{$t.hand} {h.n}</b>
        <span class="muted">
          {#if h.contract}
            {names[h.contract.bidder]}
            <span class:red={isRedSuit(h.contract.trump)}>{SUIT_GLYPH[h.contract.trump]}</span>
          {:else}
            {$t.allPassed}
          {/if}
        </span>
      </button>
      {#if h.n === hand}
        <div class="mv-sub muted small">{$t.biddingLabel}</div>
        <div class="mv-bids">
          {#each h.bids as x (x.step)}
            <button
              class="mv-item mv-bid {x.rating?.cls ?? ''}"
              class:own={x.own}
              class:current={step === x.step}
              data-step={x.step}
              onclick={() => ongo(x.step)}
            >
              <span class="mv-seat">{names[x.seat]}</span>
              <span>{bidText(x)}</span>
              {@render rating(x)}
            </button>
          {/each}
        </div>
        {#each h.tricks as tr, j (j)}
          <div class="mv-trick">
            <span class="mv-sub muted small">{j + 1}</span>
            {#each tr.items as x (x.step)}
              {#if x.action.type === 'play'}
                {@const c = x.action.card}
                <button
                  class="mv-item mv-card {x.rating?.cls ?? ''}"
                  class:own={x.own}
                  class:win={x.winner}
                  class:current={step === x.step}
                  class:red={isRedSuit(c.s)}
                  data-step={x.step}
                  title="{names[x.seat]}{x.winner ? ` · ${$t.trickWon}` : ''}"
                  onclick={() => ongo(x.step)}
                >
                  <span class="mv-c">{c.r}{SUIT_GLYPH[c.s]}</span>
                  {#if x.winner}<span class="mv-win" aria-label={$t.trickWon}>✓</span>{/if}
                  <span class="mv-seat">{names[x.seat]}</span>
                  {@render rating(x)}
                </button>
              {/if}
            {/each}
          </div>
        {/each}
      {/if}
    </section>
  {/each}
</div>
