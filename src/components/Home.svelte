<script lang="ts">
  import { fly } from 'svelte/transition'
  import { t } from '../lib/i18n'
  import type { Card } from '../engine'
  import { BOT_LEVELS } from '../bots/bot'
  import type { BotLevel } from '../bots/bot'
  import CardView from './CardView.svelte'

  let {
    error = '',
    oncreate,
    onjoin,
    onsolo,
  }: {
    error?: string
    oncreate: (name: string) => void
    onjoin: (code: string, name: string) => void
    onsolo: (name: string, level: BotLevel) => void
  } = $props()

  // Invite links land as ?room=CODE — show a dedicated join-only view.
  const inviteCode = new URLSearchParams(location.search).get('room') ?? ''
  let name = $state(localStorage.getItem('koejon-name') ?? '')
  const savedLevel = localStorage.getItem('koejon-bot-level') as BotLevel | null
  let botLevel = $state<BotLevel>(
    savedLevel && BOT_LEVELS.includes(savedLevel) ? savedLevel : 'normal',
  )
  const lvlName = $derived({ easy: $t.lvlEasy, normal: $t.lvlNormal, hard: $t.lvlHard })
  let code = $state(inviteCode.toUpperCase())
  let invited = $state(!!inviteCode)

  function backToHome() {
    invited = false
    history.replaceState(null, '', location.pathname)
  }

  const HERO: Card[] = [
    { s: 'H', r: 'A' },
    { s: 'S', r: 'K' },
    { s: 'D', r: 'Q' },
    { s: 'C', r: 'J' },
  ]

  function save() {
    localStorage.setItem('koejon-name', name.trim())
  }

  function join(e: SubmitEvent) {
    e.preventDefault()
    if (name.trim() && code.trim()) onjoin(code.trim(), name.trim())
  }
</script>

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
        <button class="btn big primary" type="submit" disabled={!name.trim()}>{$t.joinRoom}</button>
      </form>
      <button class="link-btn" onclick={backToHome}>← {$t.title}</button>
    </div>
  {:else}
    <div class="panel home-panel">
      <label class="field">
        <span>{$t.nickname}</span>
        <input bind:value={name} placeholder={$t.nicknamePh} maxlength="20" oninput={save} />
      </label>
      <div class="home-actions">
        <button class="btn big primary" disabled={!name.trim()} onclick={() => oncreate(name.trim())}>
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
                localStorage.setItem('koejon-bot-level', l)
              }}>{lvlName[l]}</button
            >
          {/each}
        </div>
      </div>
      <div class="divider"><span>{$t.or}</span></div>
      <form class="join-form" onsubmit={join}>
        <label class="field">
          <span>{$t.joinRoom}</span>
          <input class="code-input" bind:value={code} placeholder={$t.codePh} maxlength="6" />
        </label>
        <button class="btn" type="submit" disabled={!name.trim() || !code.trim()}>{$t.joinRoom}</button>
      </form>
    </div>
  {/if}
</div>
