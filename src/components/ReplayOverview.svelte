<script lang="ts">
  import { teamOf } from '../engine'
  import type { KjnMatch } from '../lib/kjn'
  import { SUIT_GLYPH, t } from '../lib/i18n'
  import type { MoveHand } from '../lib/replay'

  let {
    match,
    hands,
    names,
    myTeam,
    hand,
    startLines,
    onhand,
    onstart,
  }: {
    match: KjnMatch
    hands: MoveHand[]
    names: string[]
    myTeam: number
    /** The hand shown on the table. */
    hand: number
    /** Lines of both teams before the first hand. */
    startLines: [number, number]
    onhand: (h: MoveHand) => void
    onstart: () => void
  } = $props()

  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)
  const won = $derived(match.winner === myTeam)

  // Score graph: lines left of both teams before hand 1 and after each hand.
  const W = 300
  const H = 120
  const PAD = 10
  const series = $derived([startLines, ...hands.map((h) => h.lines)])
  const top = $derived(Math.max(1, ...series.flat()))
  const x = (k: number) => PAD + (k / Math.max(1, hands.length)) * (W - 2 * PAD)
  const y = (v: number) => PAD + (1 - v / top) * (H - 2 * PAD)
  const path = (team: number) => series.map((l, k) => `${x(k)},${y(l[team])}`).join(' ')

  function resultText(h: MoveHand): string {
    const r = h.result
    if (!r) return $t.allPassed
    const parts: string[] = []
    for (const team of [myTeam, 1 - myTeam]) if (r.crossed[team] > 0) parts.push(`${teamName(team)} −${r.crossed[team]}`)
    if (r.koei) parts.push(`${$t.koei} ${teamName(r.playing)}`)
    if (r.kapot) parts.push($t.kapot)
    return parts.join(' · ') || $t.draw
  }
</script>

<div class="rv-overview">
  <div class="rv-result" class:won>
    <strong>{won ? $t.matchWon : $t.matchLost}</strong>
    {#if match.lines}
      <span>
        {$t.wij} {match.lines[myTeam]} – {$t.zij} {match.lines[1 - myTeam]}
        <span class="muted">{$t.linesLeft}</span>
      </span>
    {/if}
  </div>

  <figure class="rv-graph">
    <figcaption class="muted small">
      {$t.linesPerHand}
      <span class="rv-key us">{$t.wij}</span>
      <span class="rv-key them">{$t.zij}</span>
    </figcaption>
    <svg viewBox="0 0 {W} {H}" role="group" aria-label={$t.linesPerHand}>
      <line class="rv-axis" x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} />
      {#if hand > 0}
        <rect class="rv-now" x={x(hand - 1)} y={PAD} width={x(hand) - x(hand - 1)} height={H - 2 * PAD} />
      {/if}
      <polyline class="rv-line them" points={path(1 - myTeam)} />
      <polyline class="rv-line us" points={path(myTeam)} />
      {#each hands as h, k (h.n)}
        <rect
          class="rv-hit"
          x={x(k)}
          y="0"
          width={x(k + 1) - x(k)}
          height={H}
          role="button"
          tabindex="0"
          aria-label="{$t.hand} {h.n}"
          onclick={() => onhand(h)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onhand(h))}
        ><title>{$t.hand} {h.n}: {resultText(h)}</title></rect>
      {/each}
    </svg>
  </figure>

  <button class="btn primary rv-start" onclick={onstart}>▶ {$t.replayStart}</button>

  <ol class="rv-hands">
    {#each hands as h (h.n)}
      <li>
        <button class="rv-hand" class:current={h.n === hand} onclick={() => onhand(h)}>
          <span class="rv-n">{h.n}</span>
          {#if h.contract}
            <span class="rv-who" class:own={teamOf(h.contract.bidder) === myTeam}>{names[h.contract.bidder]}</span>
            <span class="rv-trump" class:red={h.contract.trump === 'H' || h.contract.trump === 'D'}
              >{SUIT_GLYPH[h.contract.trump]}</span
            >
            <span class="rv-tricks" title={$t.tricks}>{h.tricksWon[myTeam]}–{h.tricksWon[1 - myTeam]}</span>
          {:else}
            <span class="rv-who muted">—</span>
            <span class="rv-trump"></span>
            <span class="rv-tricks"></span>
          {/if}
          <span class="rv-res">{resultText(h)}</span>
        </button>
      </li>
    {/each}
  </ol>
</div>
