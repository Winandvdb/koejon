<script lang="ts">
  import type { Card } from '../engine'
  import { SUIT_GLYPH } from '../lib/i18n'

  let {
    card = null,
    small = false,
    disabled = false,
    onclick = undefined,
  }: {
    card?: Card | null
    small?: boolean
    disabled?: boolean
    onclick?: (() => void) | undefined
  } = $props()

  const red = $derived(!!card && (card.s === 'H' || card.s === 'D'))
</script>

<button
  class="card"
  class:small
  class:back={!card}
  class:red
  class:disabled
  {disabled}
  onclick={() => onclick?.()}
>
  {#if card}
    <span class="rank">{card.r}</span>
    <span class="suit">{SUIT_GLYPH[card.s]}</span>
  {/if}
</button>
