<script lang="ts">
  import { scale } from 'svelte/transition'
  import { turnedVisible, type PublicState } from '../engine'
  import { t } from '../lib/i18n'
  import CardView from './CardView.svelte'

  let {
    pub,
    seat,
    fresh = false,
    dealStyle,
    animate = true,
  }: {
    pub: PublicState
    seat: number
    /** The cards are being dealt: they fly in from the deck. */
    fresh?: boolean
    /** Style that flies dealt card `k` of the dealer's hand in. */
    dealStyle?: (k: number) => string
    animate?: boolean
  } = $props()
</script>

{#if turnedVisible(pub) && seat === pub.dealer && pub.turned}
  <!-- The dealer's last pair: dealt card 6 lies face up, card 5 face down. -->
  <div class="turned-at" title={$t.turnedCard}>
    <span class="mini-card" class:dealt={fresh} style={fresh ? dealStyle?.(5) : undefined}>
      <CardView card={pub.turned.first} />
    </span>
    <span
      class="mini-card"
      class:dealt={fresh}
      style={fresh ? dealStyle?.(4) : undefined}
      in:scale={{ duration: animate && !fresh ? 250 : 0 }}
    >
      <CardView card={pub.turned.secondUp ? pub.turned.second : null} />
    </span>
  </div>
{/if}
