<script lang="ts">
  import { scale } from 'svelte/transition'
  import type { PublicState } from '../engine'
  import { t } from '../lib/i18n'

  let {
    pub,
    myTeam,
    animate = true,
  }: {
    /** In SCORED (a hand) or GAME_OVER (the match). */
    pub: PublicState
    myTeam: number
    /** The replay shows the panel at once. */
    animate?: boolean
  } = $props()

  const r = $derived(pub.lastResult)
  const over = $derived(pub.phase === 'GAME_OVER')
  const teamName = (team: number) => (team === myTeam ? $t.wij : $t.zij)
</script>

<!-- global: the panel replaces the previous one, which is not a block of this component. -->
<div class="panel overlay-panel result" class:over in:scale|global={{ duration: animate ? (over ? 260 : 220) : 0 }}>
  <div class="result-head">{over ? $t.gameOver : $t.scored}</div>
  {#if r}
    <div class="result-score">
      <span class="rs-name">{$t.wij}</span>
      <b class="rs-num">{r.points[myTeam]}–{r.points[1 - myTeam]}</b>
      <span class="rs-name">{$t.zij}</span>
    </div>
    <div class="result-flags">
      {#if r.draw && !over}
        <span class="chip">{$t.draw}</span>
      {:else}
        {#if !over}<span class="chip flag-win">{teamName(r.winnerTeam)} {$t.wins}</span>{/if}
        <span class="chip">{r.erased} {$t.erased}</span>
        {#if r.kapot}<span class="chip flag-bad">{$t.kapot}</span>{/if}
        {#if r.koei}<span class="chip flag-koei">+{$t.koei}</span>{/if}
      {/if}
    </div>
  {/if}
  {#if over}<strong>{teamName(pub.winner!)} {$t.wins}!</strong>{/if}
</div>
