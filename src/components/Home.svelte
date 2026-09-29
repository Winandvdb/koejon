<script lang="ts">
  import { t } from '../lib/i18n'

  let {
    error = '',
    oncreate,
    onjoin,
  }: {
    error?: string
    oncreate: (name: string) => void
    onjoin: (code: string, name: string) => void
  } = $props()

  let name = $state(localStorage.getItem('koejon-name') ?? '')
  let code = $state('')

  function save() {
    localStorage.setItem('koejon-name', name.trim())
  }
</script>

<div class="home">
  <h1>{$t.title}</h1>
  <div class="panel">
    <label>
      {$t.nickname}
      <input bind:value={name} placeholder={$t.nicknamePh} maxlength="20" oninput={save} />
    </label>
    <button class="btn primary" disabled={!name.trim()} onclick={() => oncreate(name.trim())}>
      {$t.createRoom}
    </button>
    <div class="joinrow">
      <input
        bind:value={code}
        placeholder={$t.codePh}
        maxlength="6"
        onkeydown={(e) => e.key === 'Enter' && code.trim() && name.trim() && onjoin(code, name.trim())}
      />
      <button class="btn" disabled={!name.trim() || !code.trim()} onclick={() => onjoin(code, name.trim())}>
        {$t.joinRoom}
      </button>
    </div>
    {#if error}<div class="error">{error}</div>{/if}
  </div>
</div>
