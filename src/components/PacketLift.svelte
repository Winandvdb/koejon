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

  /** Pointer drag over the deck (mouse and touch): relative to where the drag
   *  started, one card per card edge, so it moves at once in either direction. */
  let stack: HTMLElement
  let drag: { y: number; n: number; step: number } | null = null
  function down(e: PointerEvent) {
    stack.setPointerCapture(e.pointerId)
    drag = { y: e.clientY, n, step: stack.querySelector<HTMLElement>('.lift-edge')!.offsetHeight }
  }
  function move(e: PointerEvent) {
    if (!drag) return
    const next = drag.n + Math.round((e.clientY - drag.y) / drag.step)
    picked = Math.min(max, Math.max(min, next))
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
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
    aria-hidden="true"
  >
    {#each [n, total - n] as count, p (p)}
      <div class="lift-pack" class:up={p === 0}>
        <div class="lift-top"><div class="card-back"></div></div>
        {#each Array(count) as _, i (i)}
          <div class="lift-edge"></div>
        {/each}
      </div>
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
  <button class="fab primary" onclick={() => onlift(n)}>{$t.liftDo}</button>
</div>
