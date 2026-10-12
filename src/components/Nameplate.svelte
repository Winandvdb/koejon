<script lang="ts">
  import { scale } from 'svelte/transition'
  import { t } from '../lib/i18n'
  import Avatar from './Avatar.svelte'

  let {
    name,
    bot,
    you = false,
    active,
    side,
    dealer,
    bidder,
    tricks = null,
    bid,
    troef,
    say,
    animate = true,
    onkick,
  }: {
    name: string
    bot: boolean
    /** Marks the own seat with "(jij)". */
    you?: boolean
    /** The seat has something to do. */
    active: boolean
    /** Team colour while playing. */
    side: 'decl' | 'def' | null
    dealer: boolean
    bidder: boolean
    /** Tricks the seat's team won; null hides the chip. */
    tricks?: number | null
    /** Bid bubble; undefined shows none. */
    bid?: 'play' | 'pass'
    troef: boolean
    /** Table talk bubble. */
    say?: string
    /** The replay shows the bubbles at once. */
    animate?: boolean
    /** Shows a remove button. */
    onkick?: () => void
  } = $props()

  const pop = $derived({ start: 0.6, duration: animate ? 180 : 0 })
</script>

<div class="nameplate" class:active class:decl={side === 'decl'} class:def={side === 'def'}>
  <Avatar {name} {bot} />
  <span class="np-name">
    {name}{#if you}<span class="np-muted"> ({$t.you})</span>{/if}
  </span>
  {#if dealer}<span class="chip dealer" title={$t.dealerTag}>D</span>{/if}
  {#if bidder}<span class="chip bidder" title={$t.bidderTag}>★</span>{/if}
  {#if tricks !== null}<span class="chip tricks">{tricks}</span>{/if}
  <div class="bubbles" class:has-say={!!say}>
    {#if bid}<span class="bubble" in:scale={pop}>{bid === 'pass' ? $t.pass : $t.play}</span>{/if}
    {#if troef}<span class="bubble troef" in:scale={pop}>{$t.troefWanted}</span>{/if}
    {#if say}<span class="bubble say" in:scale={pop}>{say}</span>{/if}
  </div>
  {#if onkick}
    <button class="icon-btn tiny kick" title={$t.remove} aria-label={$t.remove} onclick={onkick}>✕</button>
  {/if}
</div>
