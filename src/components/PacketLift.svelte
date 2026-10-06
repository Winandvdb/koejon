<script lang="ts">
  import { t } from '../lib/i18n'

  /** Lift a packet off a deck of `total` cards; `sizes` are the allowed packet sizes. */
  let {
    total,
    sizes,
    onlift,
  }: {
    total: number
    sizes: number[]
    onlift: (n: number) => void
  } = $props()

  const min = $derived(sizes[0])
  const max = $derived(sizes[sizes.length - 1])
  let picked = $state<number | null>(null)
  const n = $derived(Math.min(max, Math.max(min, picked ?? Math.round((min + max) / 2))))

  /** Pointer drag over the deck (mouse and touch): the card under the pointer
   *  is the bottom card of the packet. */
  let stack: HTMLElement
  let dragging = false
  function pick(e: PointerEvent) {
    const r = stack.getBoundingClientRect()
    picked = Math.ceil(((e.clientY - r.top) / r.height) * total)
  }
  function down(e: PointerEvent) {
    dragging = true
    stack.setPointerCapture(e.pointerId)
    pick(e)
  }
  function move(e: PointerEvent) {
    if (dragging) pick(e)
  }
</script>

<div class="lift">
  <!-- The slider below is the accessible control; the deck is a drag shortcut. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="lift-stack"
    bind:this={stack}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
    aria-hidden="true"
  >
    {#each Array(total) as _, i (i)}
      <div class="lift-layer" class:up={i < n}></div>
    {/each}
  </div>
  <input
    class="lift-range"
    type="range"
    {min}
    {max}
    step="1"
    value={n}
    oninput={(e) => (picked = Number(e.currentTarget.value))}
    aria-label={$t.liftHint}
  />
  <div class="lift-count"><b>{n}</b> {$t.liftUp} · {total - n} {$t.liftStay}</div>
  <button class="fab primary" onclick={() => onlift(n)}>{$t.liftDo}</button>
</div>
