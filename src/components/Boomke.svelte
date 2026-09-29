<script lang="ts">
  import { t } from '../lib/i18n'
  import type { BoomkeMark } from '../engine'

  let {
    marks,
    myTeam,
  }: {
    marks: BoomkeMark[]
    myTeam: number
  } = $props()

  const STEP = 15
  const TOP = 30
  const CX = 70
  const ARM = 30

  /** My team on the left of the trunk, the others on the right. */
  const sides = $derived([
    marks.filter((m) => m.team === myTeam),
    marks.filter((m) => m.team !== myTeam),
  ] as const)
  const n = $derived(Math.max(sides[0].length, sides[1].length, 13))
  const H = $derived(TOP + n * STEP + 14)
  const y = (i: number) => TOP + (n - 1 - i) * STEP + 8

  /** Scratch groups: consecutive marks crossed in the same hand share one stroke. */
  const scratches = $derived.by(() => {
    const out: { side: 0 | 1; lo: number; hi: number }[] = []
    for (const side of [0, 1] as const) {
      const ms = sides[side]
      let i = 0
      while (i < ms.length) {
        if (ms[i].crossed && ms[i].batch > 0) {
          let j = i
          while (j + 1 < ms.length && ms[j + 1].crossed && ms[j + 1].batch === ms[i].batch) j++
          out.push({ side, lo: i, hi: j })
          i = j + 1
        } else i++
      }
    }
    return out
  })

  const remaining = (side: 0 | 1) => sides[side].filter((m) => !m.crossed).length
</script>

<div class="boomke">
  <div class="boomke-labels">
    <span>{$t.wij} <b>{remaining(0)}</b></span>
    <span class="boomke-title">{$t.boomke}</span>
    <span>{$t.zij} <b>{remaining(1)}</b></span>
  </div>
  <svg width="140" height={H} viewBox="0 0 140 {H}" aria-hidden="true">
    <!-- one shared trunk: just a vertical line -->
    <line x1={CX} y1={H - 6} x2={CX} y2={TOP - 4} class="trunk" />
    {#each [0, 1] as side (side)}
      {@const dir = side === 0 ? -1 : 1}
      {#each sides[side] as m, i (i)}
        {@const yy = y(i)}
        {#if m.t === 'koei'}
          <!-- a cow's tail: wavy stroke with hairs at the tip -->
          <path
            d="M{CX} {yy} C{CX + dir * 10} {yy + 3} {CX + dir * 16} {yy + 7} {CX + dir * 22} {yy + 5} C{CX + dir * 26} {yy + 4} {CX + dir * 28} {yy + 1} {CX + dir * 29} {yy - 3}"
            class="koei-tail"
          />
          <path
            d="M{CX + dir * 29} {yy - 3} l{dir * -5} {-5} M{CX + dir * 29} {yy - 3} l{dir * -1} {-6} M{CX + dir * 29} {yy - 3} l{dir * 3} {-4}"
            class="koei-hair"
          />
        {:else}
          <line x1={CX} y1={yy} x2={CX + dir * ARM} y2={yy} class="mark" class:crossed={m.crossed} />
        {/if}
      {/each}
    {/each}
    <!-- one diagonal scratch per scoring batch -->
    {#each scratches as sc (sc.side + '-' + sc.lo)}
      {@const dir = sc.side === 0 ? -1 : 1}
      <line
        x1={CX + dir * (ARM + 5)}
        y1={y(sc.lo) + 6}
        x2={CX + dir * -3}
        y2={y(sc.hi) - 6}
        class="scratch"
      />
    {/each}
  </svg>
</div>
