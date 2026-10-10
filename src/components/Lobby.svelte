<script lang="ts">
  import { onMount } from 'svelte'
  import { teamOf } from '../engine'
  import { t } from '../lib/i18n'
  import type { RoomDoc } from '../lib/net-types'

  let {
    room,
    isHost,
    mySeat,
    onaddbot,
    onremovebot,
    onbotlevel,
    onkick,
    onshuffle,
    onswap,
    onstart,
  }: {
    room: RoomDoc
    isHost: boolean
    mySeat: number
    onaddbot: (seat: number) => void
    onremovebot: (seat: number) => void
    onbotlevel: (seat: number) => void
    onkick: (seat: number) => void
    onshuffle: () => void
    onswap: (a: number, b: number) => void
    onstart: () => void
  } = $props()

  /** Picked seat index for manual moves (host only): tap a player, tap a seat. */
  let picked = $state(-1)

  function pickSeat(i: number) {
    if (!isHost) return
    if (picked === i) {
      picked = -1
    } else if (picked >= 0) {
      onswap(picked, i)
      picked = -1
    } else if (room.seats[i]) {
      picked = i
    }
  }

  const full = $derived(room.seats.every((s) => s !== null))
  const lvlName = $derived({ easy: $t.lvlEasy, normal: $t.lvlNormal, hard: $t.lvlHard })
  const myTeam = $derived(teamOf(mySeat))
  const teamName = (seat: number) => (teamOf(seat) === myTeam ? $t.wij : $t.zij)

  const inviteUrl = $derived(`${location.origin}${location.pathname}?room=${room.code}`)
  let qr = $state('')
  let copied = $state(false)

  onMount(async () => {
    // Loaded on demand: qrcode is only needed in the lobby.
    const QRCode = (await import('qrcode')).default
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
        <li class:is-bot={seat?.bot} class:picked={picked === i}>
          <button
            class="seat-name row-pick"
            disabled={!isHost || (!seat && picked < 0)}
            onclick={() => pickSeat(i)}
          >
            {#if seat}
              {@const nm = seat.name || `${$t.player} ${i + 1}`}
              <span class="avatar">{seat.bot ? '🤖' : nm.slice(0, 1).toUpperCase()}</span>
              <span class="seat-nm">{nm}</span>
              {#if i === mySeat}<span class="tag">{$t.you}</span>{/if}
              {#if seat.uid === room.hostUid}<span class="tag">{$t.host}</span>{/if}
              {#if seat.bot}<span class="tag muted">{$t.bot}</span>{/if}
            {:else}
              <span class="avatar empty-avatar"></span>
              <em>{$t.empty}</em>
            {/if}
          </button>
          {#if seat?.bot && isHost}
            <button
              class="tag lvl-btn"
              title={$t.botLevel}
              onclick={(e) => {
                e.stopPropagation()
                onbotlevel(i)
              }}>{lvlName[seat.botLevel ?? 'normal']}</button>
          {/if}
          {#if seat && isHost && (seat.bot || i !== mySeat)}
            <button
              class="icon-btn tiny"
              title={$t.remove}
              aria-label={$t.remove}
              onclick={(e) => {
                e.stopPropagation()
                seat.bot ? onremovebot(i) : onkick(i)
              }}>✕</button>
          {/if}
          {#if !seat && isHost}
            <button
              class="btn tiny"
              onclick={(e) => {
                e.stopPropagation()
                onaddbot(i)
              }}>+ {$t.bot}</button>
          {/if}
          <span class="team" class:ta={teamOf(i) === myTeam}>{teamName(i)}</span>
        </li>
      {/each}
    </ul>
    {#if isHost}
      <p class="move-hint small muted">{$t.moveHint}</p>
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
