<script lang="ts">
  import { t } from '../lib/i18n'
  import type { RoomDoc } from '../lib/net-types'

  let {
    room,
    isHost,
    mySeat,
    onaddbot,
    onremovebot,
    onshuffle,
    onstart,
    onleave,
  }: {
    room: RoomDoc
    isHost: boolean
    mySeat: number
    onaddbot: () => void
    onremovebot: (seat: number) => void
    onshuffle: () => void
    onstart: () => void
    onleave: () => void
  } = $props()

  const full = $derived(room.seats.every((s) => s !== null))
  const teamName = (seat: number) => (seat % 2 === 0 ? $t.teamA : $t.teamB)
</script>

<div class="lobby">
  <h2>{$t.lobby}</h2>
  <div class="code">
    {$t.roomCode}: <strong>{room.code}</strong>
  </div>
  <div class="seats">
    {#each room.seats as seat, i (i)}
      <div class="seat" class:me={i === mySeat}>
        <span class="snum">{i}</span>
        {#if seat}
          <span class="sname">
            {seat.name}
            {#if seat.bot}<em>({$t.bot})</em>{/if}
            {#if i === mySeat}<em>({$t.you})</em>{/if}
          </span>
          {#if isHost && seat.bot}
            <button class="btn tiny" onclick={() => onremovebot(i)}>{$t.remove}</button>
          {/if}
        {:else}
          <span class="sname empty">{$t.empty}</span>
          {#if isHost}<button class="btn tiny" onclick={onaddbot}>+ {$t.bot}</button>{/if}
        {/if}
        <span class="team" class:ta={i % 2 === 0}>{teamName(i)}</span>
      </div>
    {/each}
  </div>
  <div class="actions">
    {#if isHost}
      <button class="btn" onclick={onshuffle}>{$t.shuffle}</button>
      <button class="btn primary" disabled={!full} onclick={onstart}>{$t.start}</button>
      {#if !full}<span class="hint">{$t.needFour}</span>{/if}
    {:else}
      <span class="hint">{$t.waitingHost}</span>
    {/if}
    <button class="btn" onclick={onleave}>{$t.leave}</button>
  </div>
</div>
