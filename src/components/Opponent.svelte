<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    pos,
    open = false,
    nameplate,
    turned,
    children,
  }: {
    /** Screen position: 1 left, 2 top, 3 right. */
    pos: number
    /** The cards lie face up (replay). */
    open?: boolean
    nameplate: Snippet
    turned: Snippet
    /** The hand cards. */
    children: Snippet
  } = $props()
</script>

<div class="seat seat-p{pos}">
  {@render nameplate()}
  <div class="opp-hand" class:open class:vertical={pos !== 2} class:horizontal={pos === 2}>
    {@render children()}
  </div>
  {@render turned()}
</div>
