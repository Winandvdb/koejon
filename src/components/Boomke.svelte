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
  /** Player closed the auto-opened boomke; resets when play continues. */
  let dismissed = $state(false)
  const scoring = $derived(phase === 'SCORED' || phase === 'GAME_OVER')
  const expanded = $derived(open || (scoring && !dismissed))

  $effect(() => {
    if (!scoring) {
      open = false
      dismissed = false
    }
  })

  const toggle = () => {
    if (expanded) {
      open = false
      dismissed = scoring
    } else {
      open = true
      dismissed = false
    }
  }

  const STEP = 15
  const TOP = 30
  const CX = 70
  const ARM = 30
  /** Bottom band for hanging koei tails; extra tails stack a bit lower. */
  const KOEI_ZONE = 24
  /** Root spacing must exceed one tail's drop+tuft so tails never touch. */
  const KOEI_ROW = 20

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

  /** Zigzag that lies along a line, like scribbling over it with a pen. */
  const wave = (x1: number, y: number, x2: number, amp = 3.4): string => {
    const dir = Math.sign(x2 - x1) || 1
    const len = Math.abs(x2 - x1)
    const step = 6
    let d = `M${x1} ${y}`
    let flip = 1
    for (let t = step; ; t += step, flip = -flip) {
      if (t >= len) {
        d += ` L${x2} ${y}`
        break
      }
      d += ` L${(x1 + dir * t).toFixed(1)} ${(y + amp * flip).toFixed(1)}`
    }
    return d
  }

  /** Scratch groups: consecutive marks crossed in the same hand share one
   *  big scribble that spans their combined height. */
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

<div class="boomke-wrap" class:scored={scoring && expanded}>
  {#if expanded}
    <div class="boomke">
      <div class="boomke-labels">
        <span>{$t.wij} <b>{remaining(0)}</b></span>
        <span class="boomke-title">{$t.boomke}</span>
        <span>{$t.zij} <b>{remaining(1)}</b></span>
        {#if scoring}
          <!-- the auto-opened boomke floats away from its corner chip, so it
               gets its own close button -->
          <button class="icon-btn tiny boomke-close" onclick={toggle} aria-label={$t.close}>✕</button>
        {/if}
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
        {@const tx = CX + dir * 34}
        {@const ty = rootY + 11}
        <!-- a cow's tail: straight out to the middle, then a smooth slight droop.
             Every koei is the same shape, offset down the trunk. -->
        <path
          d="M{CX} {rootY} L{CX + dir * 18} {rootY} Q{CX + dir * 28} {rootY} {tx} {ty}"
          class="koei-tail"
        />
        <path
          d="M{tx} {ty} l{dir * 6} 4 M{tx} {ty} l{dir * 3} 5 M{tx} {ty} l{dir * 8} 2"
          class="koei-hair"
        />
        {#if m.crossed}
          <path d={wave(CX + dir * 4, rootY + 2, CX + dir * 24)} class="scratch" />
        {/if}
      {/each}
    {/each}
    <!-- one big scribble per scoring batch, tall enough to cover its lines -->
    {#each scratches as sc (sc.side + '-' + sc.lo)}
      {@const dir = sc.side === 0 ? -1 : 1}
      {@const amp = ((sc.hi - sc.lo) * STEP) / 2 + 4}
      <path
        d={wave(CX + dir * -2, (y(sc.lo) + y(sc.hi)) / 2, CX + dir * (ARM + 4), amp)}
        class="scratch"
      />
    {/each}
      </svg>
    </div>
  {/if}
  {#if !(scoring && expanded)}
    <button class="boomke-chip" onclick={toggle} aria-expanded={expanded}>
      {$t.boomke} · {$t.wij} {remaining(0)} – {$t.zij} {remaining(1)}
    </button>
  {/if}
</div>
