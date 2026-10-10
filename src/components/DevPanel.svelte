<script lang="ts">
  import { get } from 'svelte/store'
  import { t } from '../lib/i18n'
  import { START_LINES } from '../engine'
  import { BOT_SPEEDS, devSettings, setDev } from '../lib/devsettings'

  function setTreeLength(input: HTMLInputElement) {
    setDev({ treeLength: input.valueAsNumber })
    // An invalid entry fell back to the default: show what counts.
    input.value = String(get(devSettings).treeLength)
  }
</script>

<!-- Dev builds only: test shortcuts for this browser when it hosts. -->
<div class="dev-settings">
  <strong>{$t.devSettings}</strong>
  <label>
    <input
      type="number"
      min="1"
      max={START_LINES}
      value={$devSettings.treeLength}
      onchange={(e) => setTreeLength(e.currentTarget)}
    />
    {$t.devTreeLength}
  </label>
  <span>{$t.devBotSpeed}</span>
  <div class="segmented" role="group" aria-label={$t.devBotSpeed}>
    {#each BOT_SPEEDS as s (s)}
      <button class:active={$devSettings.speed === s} onclick={() => setDev({ speed: s })}
        >{s === 'instant' ? $t.devInstant : `${s}×`}</button
      >
    {/each}
  </div>
  <label>
    <input
      type="checkbox"
      checked={$devSettings.skipSeen}
      onchange={(e) => setDev({ skipSeen: e.currentTarget.checked })}
    />
    {$t.devSkipSeen}
  </label>
  <label>
    <input
      type="checkbox"
      checked={$devSettings.interactiveDraws}
      onchange={(e) => setDev({ interactiveDraws: e.currentTarget.checked })}
    />
    {$t.devInteractiveDraws}
  </label>
  <label>
    <input
      type="checkbox"
      checked={$devSettings.autoplay}
      onchange={(e) => setDev({ autoplay: e.currentTarget.checked })}
    />
    {$t.devAutoplay}
  </label>
  <small>{$t.devHostOnly}</small>
</div>
