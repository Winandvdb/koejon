<script lang="ts">
  import { t } from '../lib/i18n'
  import type { BoomkeMark } from '../engine'

  let {
    marks,
    myTeam,
    phase,
  }: {
    marks: BoomkeMark[]
    myTeam: number
    phase: string
  } = $props()

  /** Collapsed during play; opens automatically when a hand is scored. */
  let open = $state(false)
  const expanded = $derived(open || phase === 'SCORED' || phase === 'GAME_OVER')

  const STEP = 15
  const TOP = 30
  const CX = 70
  const ARM = 30
  /** Bottom band for hanging koei tails; each koei gets a horizontal slot. */
  const KOEI_ZONE = 40
  const KOEI_DX = 16

  /** My team on the left of the trunk, the others on the right. */
  const sides = $derived([
    marks.filter((m) => m.team === myTeam),
    marks.filter((m) => m.team !== myTeam),
  ] as const)
  /** Lines climb the ladder; koeis hang as tails at the bottom of the boom. */
  const lines = $derived(sides.map((ms) => ms.filter((m) => m.t === 'line')))
  const koeis = $derived(sides.map((ms) => ms.filter((m) => m.t === 'koei')))
  const n = $derived(Math.max(lines[0].length, lines[1].length, 13))
  const kmax = $derived(Math.max(koeis[0].length, koeis[1].length))
  const H = $derived(TOP + n * STEP + 14 + (kmax > 0 ? KOEI_ZONE : 0))
  const y = (i: number) => TOP + (n - 1 - i) * STEP + 8
  /** Tail root: just below the trunk foot, each extra koei a bit further out. */
  const kx = (dir: number, k: number) => CX + dir * (10 + k * KOEI_DX)
  const ky = () => TOP + n * STEP + 8

  /** Scratch groups: consecutive marks crossed in the same hand share one stroke. */
  const scratches = $derived.by(() => {
    const out: { side: 0 | 1; lo: number; hi: number }[] = []
    for (const side of [0, 1] as const) {
      const ms = lines[side]
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

<div class="boomke-wrap">
  {#if expanded}
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
      {#each lines[side] as m, i (i)}
        {@const yy = y(i)}
        <line x1={CX} y1={yy} x2={CX + dir * ARM} y2={yy} class="mark" class:crossed={m.crossed} />
      {/each}
      {#each koeis[side] as m, k (k)}
        {@const rx = kx(dir, k)}
        {@const ry = ky()}
        <!-- a cow's tail hanging down from the boom, hair tuft at the tip -->
        <path
          d="M{rx} {ry} C{rx} {ry + 12} {rx + dir * 3} {ry + 18} {rx} {ry + 26}"
          class="koei-tail"
        />
        <path
          d="M{rx} {ry + 26} l-4 4 M{rx} {ry + 26} l0 5 M{rx} {ry + 26} l4 4"
          class="koei-hair"
        />
        {#if m.crossed}
          <line x1={rx - 7} y1={ry + 22} x2={rx + 7} y2={ry + 4} class="scratch" />
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
  {/if}
  <button class="boomke-chip" onclick={() => (open = !open)} aria-expanded={expanded}>
    {$t.boomke} · {$t.wij} {remaining(0)} – {$t.zij} {remaining(1)}
  </button>
</div>
