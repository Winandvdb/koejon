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
  /** Bottom band for hanging koei tails; extra tails stack a bit lower. */
  const KOEI_ZONE = 34
  const KOEI_ROW = 9

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
  const H = $derived(TOP + n * STEP + 14 + (kmax > 0 ? KOEI_ZONE + (kmax - 1) * KOEI_ROW : 0))
  const y = (i: number) => TOP + (n - 1 - i) * STEP + 8
  /** Tail root on the trunk, at the foot of the line ladder. */
  const kry = (k: number) => TOP + n * STEP + 8 + k * KOEI_ROW

  /** A pen-scribble stroke from (x1,y1) to (x2,y2): a fast zigzag wave. */
  const scribble = (x1: number, y1: number, x2: number, y2: number): string => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const ux = (x2 - x1) / len
    const uy = (y2 - y1) / len
    const n = Math.max(4, Math.round(len / 5.5))
    let d = `M${x1.toFixed(1)} ${y1.toFixed(1)}`
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const off = i === n ? 0 : (i % 2 ? 1 : -1) * (2.4 + (i % 3) * 0.9)
      d += ` L${(x1 + ux * len * t - uy * off).toFixed(1)} ${(y1 + uy * len * t + ux * off).toFixed(1)}`
    }
    return d
  }

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
        {@const rootY = kry(k)}
        {@const tx = CX + dir * (18 + k * 8)}
        {@const ty = rootY + 22}
        <!-- a cow's tail: starts on the trunk, sags halfway into a 45° droop -->
        <path
          d="M{CX} {rootY} C{CX + dir * 20} {rootY} {tx - dir * 7} {ty - 7} {tx} {ty}"
          class="koei-tail"
        />
        <path
          d="M{tx} {ty} l{dir * 5} 5 M{tx} {ty} l{dir * 2} 6 M{tx} {ty} l{dir * 6} 2"
          class="koei-hair"
        />
        {#if m.crossed}
          <path d={scribble(tx + dir * 4, rootY + 2, tx - dir * 10, ty + 3)} class="scratch" />
        {/if}
      {/each}
    {/each}
    <!-- one diagonal scratch per scoring batch -->
    {#each scratches as sc (sc.side + '-' + sc.lo)}
      {@const dir = sc.side === 0 ? -1 : 1}
      <path
        d={scribble(CX + dir * (ARM + 5), y(sc.lo) + 6, CX + dir * -3, y(sc.hi) - 6)}
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
