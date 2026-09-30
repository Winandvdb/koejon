<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { t } from '../lib/i18n'
  import type { RoomDoc } from '../lib/net-types'

  let {
    room,
    isHost,
    mySeat,
    onaddbot,
    onremovebot,
    onkick,
    onshuffle,
    onstart,
  }: {
    room: RoomDoc
    isHost: boolean
    mySeat: number
    onaddbot: (seat: number) => void
    onremovebot: (seat: number) => void
    onkick: (seat: number) => void
    onshuffle: () => void
    onstart: () => void
  } = $props()

  const full = $derived(room.seats.every((s) => s !== null))
  const myTeam = $derived(mySeat % 2)
  const teamName = (seat: number) => (seat % 2 === myTeam ? $t.wij : $t.zij)

  const inviteUrl = $derived(`${location.origin}${location.pathname}?room=${room.code}`)
  let qr = $state('')
  let copied = $state(false)

  onMount(async () => {
    qr = await QRCode.toDataURL(inviteUrl, { margin: 1, width: 132 })
  })

  async function copy() {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Koejonnen', url: inviteUrl })
      } else {
        await navigator.clipboard.writeText(inviteUrl)
        copied = true
        setTimeout(() => (copied = false), 1800)
      }
    } catch {
      // Share sheet dismissed or clipboard unavailable.
    }
  }
</script>

<div class="lobby">
  <div class="panel invite">
    <div class="invite-code">
      <span class="muted small">{$t.roomCode}</span>
      <strong>{room.code}</strong>
    </div>
    {#if qr}<img class="qr" src={qr} alt={$t.qrAlt} />{/if}
    <div class="invite-link">
      <input readOnly value={inviteUrl} onfocus={(e) => e.currentTarget.select()} />
      <button class="btn primary" onclick={copy}>{copied ? $t.copied : $t.copy}</button>
    </div>
  </div>

  <div class="panel">
    <h2>{$t.lobby}</h2>
    <ul class="seat-list">
      {#each room.seats as seat, i (i)}
        <li class:is-bot={seat?.bot}>
          <span class="seat-name">
            {#if seat}
              <span class="avatar">{seat.bot ? '🤖' : seat.name.slice(0, 1).toUpperCase()}</span>
              {seat.name}
              {#if i === mySeat}<span class="tag">{$t.you}</span>{/if}
              {#if seat.uid === room.hostUid}<span class="tag">{$t.host}</span>{/if}
              {#if seat.bot}<span class="tag muted">{$t.bot}</span>{/if}
            {:else}
              <span class="avatar empty-avatar"></span>
              <em>{$t.empty}</em>
            {/if}
          </span>
          {#if seat && isHost && (seat.bot || i !== mySeat)}
            <button
              class="icon-btn tiny"
              title={$t.remove}
              aria-label={$t.remove}
              onclick={() => (seat.bot ? onremovebot(i) : onkick(i))}>✕</button>
          {/if}
          {#if !seat && isHost}
            <button class="btn tiny" onclick={() => onaddbot(i)}>+ {$t.bot}</button>
          {/if}
          <span class="team" class:ta={i % 2 === myTeam}>{teamName(i)}</span>
        </li>
      {/each}
    </ul>
    {#if isHost}
      <button class="btn" onclick={onshuffle}>{$t.shuffle}</button>
    {/if}
  </div>

  {#if isHost}
    <button class="btn big primary start-btn" disabled={!full} onclick={onstart}>{$t.start}</button>
    {#if !full}<p class="waiting small">{$t.needFour}</p>{/if}
  {:else}
    <p class="waiting"><span class="spinner"></span> {$t.waitingHost}</p>
  {/if}
</div>
