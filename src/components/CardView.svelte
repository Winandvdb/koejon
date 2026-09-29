<script lang="ts">
  import type { Card } from '../engine'
  import { SUIT_GLYPH } from '../lib/i18n'

  let { card = null }: { card?: Card | null } = $props()

  const red = $derived(!!card && (card.s === 'H' || card.s === 'D'))
  const court = $derived(!!card && (card.r === 'J' || card.r === 'Q' || card.r === 'K'))
</script>

{#if card}
  <div class="card-face" class:red class:black={!red} class:court>
    <span class="corner tl"><b>{card.r}</b><i>{SUIT_GLYPH[card.s]}</i></span>
    <span class="center"
      >{#if court}<span class="court-letter">{card.r}</span>{:else}{SUIT_GLYPH[card.s]}{/if}</span
    >
    {#if court}<span class="court-suit">{SUIT_GLYPH[card.s]}</span>{/if}
    <span class="corner br"><b>{card.r}</b><i>{SUIT_GLYPH[card.s]}</i></span>
  </div>
{:else}
  <div class="card-back"></div>
{/if}
