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

  /** Pointer drag over the deck (mouse and touch): the card edge under the
   *  pointer is the bottom card of the packet. */
  let stack: HTMLElement
  let dragging = false
  function pick(e: PointerEvent) {
    const [lifted, rest] = stack.querySelectorAll<HTMLElement>('.lift-pack')
    const first = lifted.querySelector<HTMLElement>('.lift-edge')!
    const eh = first.offsetHeight
    const y = e.clientY - first.getBoundingClientRect().top
    if (y <= n * eh) {
      picked = Math.ceil(y / eh)
      return
    }
    // Below the gap and the top card of the rest: count on from the packet.
    const y2 = e.clientY - rest.querySelector<HTMLElement>('.lift-edge')!.getBoundingClientRect().top
    if (y2 > 0) picked = n + Math.ceil(y2 / eh)
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
  <div class="lift-count"><b>{n}</b> {$t.liftUp} · {total - n} {$t.liftStay}</div>
  <button class="fab primary" onclick={() => onlift(n)}>{$t.liftDo}</button>
</div>
