<script lang="ts">
  import { fly } from 'svelte/transition'
  import { lang, t } from '../lib/i18n'
  import { readHistory, type HistoryEntry } from '../lib/history'
  import { parseKjn } from '../lib/kjn'
  import { appUrl } from '../lib/link-p2p'
  import { CODE_LENGTH } from '../lib/room'
  import { totalStats } from '../lib/stats'
  import { safeStorage } from '../lib/storage'
  import type { Card } from '../engine'
  import { BOT_LEVELS } from '../bots/bot'
  import type { BotLevel } from '../bots/bot'
  import CardView from './CardView.svelte'

  let {
    error = '',
    oncreate,
    onjoin,
    onsolo,
    onreplay,
  }: {
    error?: string
    oncreate: (name: string) => void
    onjoin: (code: string, name: string) => void
    onsolo: (name: string, level: BotLevel) => void
    onreplay: (entry: HistoryEntry) => void
  } = $props()

  // Invite links land as ?room=CODE — show a dedicated join-only view.
  const inviteCode = new URLSearchParams(location.search).get('room') ?? ''
  let name = $state(safeStorage.getItem('koejon-name') ?? '')
  const savedLevel = safeStorage.getItem('koejon-bot-level') as BotLevel | null
  let botLevel = $state<BotLevel>(
    savedLevel && BOT_LEVELS.includes(savedLevel) ? savedLevel : 'normal',
  )
  const lvlName = $derived({ easy: $t.lvlEasy, normal: $t.lvlNormal, hard: $t.lvlHard })
  let code = $state(inviteCode.toUpperCase())
  let invited = $state(!!inviteCode)
  // Multiplayer needs Firestore; solo plays on without a network.
  let online = $state(navigator.onLine)

  function backToHome() {
    invited = false
    history.replaceState(null, '', appUrl())
  }

  const HERO: Card[] = [
    { s: 'H', r: 'A' },
    { s: 'S', r: 'K' },
    { s: 'D', r: 'Q' },
    { s: 'C', r: 'J' },
  ]

  function save() {
    safeStorage.setItem('koejon-name', name.trim())
  }

  function join(e: SubmitEvent) {
    e.preventDefault()
    if (online && name.trim() && code.trim()) onjoin(code.trim(), name.trim())
  }

  const kept = readHistory()
  const stats = totalStats(kept)
  const pct = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole))
  const avgScore = stats.score / Math.max(1, stats.played)
  const avgText = $derived(
    avgScore.toLocaleString($lang === 'nl' ? 'nl-BE' : 'en-GB', { maximumFractionDigits: 1 }),
  )

  /** The newest few; the statistics above keep the panel tall enough. */
  const LIST_ROWS = 5
  let showAll = $state(false)

  /** Newest first, with winner and final lines read from the record. */
  const matches = [...kept]
    .reverse()
    .map((e) => {
      try {
        const m = parseKjn(e.kjn)
        return { e, winner: m.winner, lines: m.lines }
      } catch {
        return { e, winner: null, lines: null }
      }
    })

  const seatName = (e: HistoryEntry, i: number) => e.names[i] || `${$t.player} ${i + 1}`
  const when = (ms: number) =>
    new Date(ms).toLocaleString($lang === 'nl' ? 'nl-BE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
</script>

{#snippet num(n: number | string, label: string, tone = '', suffix = '')}
  <div class="stat-num">
    <b class={tone}>{n}{#if suffix}<small> {suffix}</small>{/if}</b>
    <span>{label}</span>
  </div>
{/snippet}

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />

<div class="home">
  <div class="hero">
    <div class="hero-cards" aria-hidden="true">
      {#each HERO as c, i (c.s + c.r)}
        <div
          class="hero-card"
          style="rotate: {(i - 1.5) * 12}deg; z-index: {i}"
          in:fly={{ y: 40, duration: 420, delay: 100 + i * 80 }}
        >
          <CardView card={c} />
        </div>
      {/each}
    </div>
    <h1>{$t.title}</h1>
    <p class="muted">{$t.tagline}</p>
  </div>

  {#if error}<div class="alert">{error}</div>{/if}

  {#if invited}
    <div class="panel home-panel">
      <h2>{$t.joinRoom} · {inviteCode.toUpperCase()}</h2>
      <form class="invite-join" onsubmit={join}>
        <label class="field">
          <span>{$t.nickname}</span>
          <input bind:value={name} placeholder={$t.nicknamePh} maxlength="20" oninput={save} />
        </label>
        <button class="btn big primary" type="submit" disabled={!online || !name.trim()}>{$t.joinRoom}</button>
      </form>
      {#if !online}<p class="muted">{$t.offlineJoin}</p>{/if}
      <button class="link-btn" onclick={backToHome}>← {$t.title}</button>
    </div>
  {:else}
    <div class="home-cols">
    <div class="panel home-panel">
      <label class="field">
        <span>{$t.nickname}</span>
        <input bind:value={name} placeholder={$t.nicknamePh} maxlength="20" oninput={save} />
      </label>
      {#if !online}<p class="muted">{$t.offlineSolo}</p>{/if}
      <div class="home-actions">
        <button class="btn big primary" disabled={!online || !name.trim()} onclick={() => oncreate(name.trim())}>
          <span>🌐 {$t.createRoom}</span>
        </button>
        <button class="btn big" disabled={!name.trim()} onclick={() => onsolo(name.trim(), botLevel)}>
          <span>🤖 {$t.playSolo}</span>
        </button>
        <div class="lvl-seg" role="group" aria-label={$t.botLevel}>
          {#each BOT_LEVELS as l (l)}
            <button
              class="lvl-opt"
              class:on={botLevel === l}
              onclick={() => {
                botLevel = l
                safeStorage.setItem('koejon-bot-level', l)
              }}>{lvlName[l]}</button
            >
          {/each}
        </div>
      </div>
      <div class="divider"><span>{$t.or}</span></div>
      <form class="join-form" onsubmit={join}>
        <label class="field">
          <span>{$t.joinRoom}</span>
          <!-- Not maxlength: it would cut a pasted " ABCDE" to " ABCD" before the trim. -->
          <input
            class="code-input"
            bind:value={code}
            placeholder={$t.codePh}
            oninput={() => (code = code.trim().slice(0, CODE_LENGTH))}
          />
        </label>
        <button class="btn" type="submit" disabled={!online || !name.trim() || !code.trim()}>{$t.joinRoom}</button>
      </form>
    </div>

    <div class="panel home-panel">
      {#if stats.played > 0}
        <h2>{$t.statsTitle}</h2>
        {@render statCards()}
      {/if}
      <h2 class:home-sub={stats.played > 0}>{$t.playedMatches}</h2>
      {#if matches.length === 0}
        <p class="muted">{$t.noMatches}</p>
      {:else}
        <ul class="match-list">
          {#each matches as { e, winner, lines }, i (e.id)}
            <li class:extra={!showAll && i >= LIST_ROWS}>
              <div class="match-info">
                <div class="match-meta small muted">
                  <span>{when(e.finishedAt)}</span>
                  {#if lines}<span>{$t.boomke} {lines[0]}–{lines[1]}</span>{/if}
                </div>
                <div class="match-teams">
                  <span class:win={winner === 0}>{seatName(e, 0)} &amp; {seatName(e, 2)}</span>
                  <span class="muted">–</span>
                  <span class:win={winner === 1}>{seatName(e, 1)} &amp; {seatName(e, 3)}</span>
                </div>
              </div>
              <button class="icon-btn match-replay" title={$t.replay} aria-label={$t.replay} onclick={() => onreplay(e)}>▶</button>
            </li>
          {/each}
        </ul>
        {#if matches.length > LIST_ROWS}
          <button class="link-btn more-matches" onclick={() => (showAll = !showAll)}>
            {showAll ? $t.showFewerMatches : `${$t.showAllMatches} (${matches.length})`}
          </button>
        {/if}
      {/if}
    </div>
    </div>
  {/if}
</div>

{#snippet statCards()}
  <div class="stat-cards">
    <div class="stat-card">
      <div class="stat-head"><h3>{$t.statGames}</h3><span>{pct(stats.won, stats.played)}{$t.statWonPct}</span></div>
      <div class="stat-nums">
        {@render num(stats.played, $t.statPlayed)}
        {@render num(stats.won, $t.statWon, 'good')}
        {@render num(stats.played - stats.won, $t.statLost, 'bad')}
      </div>
      <div class="stat-bar lost" aria-hidden="true"><i class="good" style="width: {pct(stats.won, stats.played)}%"></i></div>
    </div>
    <div class="stat-card">
      <div class="stat-head"><h3>{$t.statScore}</h3></div>
      <div class="stat-nums">
        {@render num(stats.score, $t.statTotal)}
        {@render num(avgText, $t.statAvg, '', '/ 13')}
      </div>
      <div class="stat-bar" aria-hidden="true"><i class="gold" style="width: {pct(avgScore, 13)}%"></i></div>
    </div>
    <div class="stat-card">
      <div class="stat-head">
        <h3>{$t.statBids}</h3>
        {#if stats.bidsMade > 0}<span>{pct(stats.bidsWon, stats.bidsMade)}{$t.statWonPct}</span>{/if}
      </div>
      <div class="stat-nums">
        {@render num(stats.bidsMade, $t.statBidsMade)}
        {@render num(stats.bidsWon, $t.statBidsWon, 'good')}
      </div>
      <div class="stat-bar" aria-hidden="true"><i class="good" style="width: {pct(stats.bidsWon, stats.bidsMade)}%"></i></div>
    </div>
    <div class="stat-card">
      <div class="stat-head"><h3>{$t.statCrosses}</h3></div>
      <div class="stat-nums">
        {@render num(stats.doubles, $t.statDoubles)}
        {@render num(stats.triples, $t.statTriples)}
      </div>
    </div>
  </div>
{/snippet}
