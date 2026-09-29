<script lang="ts">
  import { t } from '../lib/i18n'

  let {
    lines,
    koeien,
  }: {
    lines: [number, number]
    koeien: [number, number]
  } = $props()

  // Trunk height grows if koeien push the count above 13.
  const maxLines = $derived(Math.max(13, lines[0], lines[1]))
  const H = $derived(maxLines * 12 + 30)
</script>

<div class="boomke">
  <h3>{$t.boomke}</h3>
  <div class="trunks">
    {#each [0, 1] as team (team)}
      <div class="trunk-wrap">
        <svg width="90" height={H} viewBox="0 0 90 {H}">
          <!-- vertical trunk -->
          <line x1="45" y1="8" x2="45" y2={H - 8} stroke="#7b4a1f" stroke-width="4" />
          <!-- remaining lines: normal strokes -->
          {#each Array(lines[team]) as _, i (i)}
            {@const y = H - 18 - i * 12}
            {@const isKoei = i >= lines[team] - koeien[team] && koeien[team] > 0}
            {#if isKoei}
              <!-- crooked koei stroke with hairs -->
              <line x1="14" y1={y + 3} x2="74" y2={y - 4} stroke="#8b0000" stroke-width="2.6" />
              <line x1="70" y1={y - 4} x2="77" y2={y - 9} stroke="#8b0000" stroke-width="1.4" />
              <line x1="72" y1={y - 3} x2="79" y2={y - 5} stroke="#8b0000" stroke-width="1.4" />
            {:else}
              <line x1="14" y1={y} x2="76" y2={y} stroke="#333" stroke-width="2.6" />
            {/if}
          {/each}
        </svg>
        <div class="tlabel">{team === 0 ? $t.teamA : $t.teamB}</div>
        <div class="count">
          {lines[team]}
          {#if koeien[team] > 0}<span class="koei">+{koeien[team]} {$t.koei}</span>{/if}
        </div>
      </div>
    {/each}
  </div>
</div>
