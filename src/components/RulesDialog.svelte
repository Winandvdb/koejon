<script lang="ts">
  import rulesNl from '../../rules/rules-nl.md?raw'
  import rulesEn from '../../rules/rules-en.md?raw'
  import { lang, t } from '../lib/i18n'

  let { onclose }: { onclose: () => void } = $props()

  // marked is only needed here, so keep it out of the start bundle.
  let html = $state('')
  $effect(() => {
    const src = $lang === 'nl' ? rulesNl : rulesEn
    import('../lib/md').then(({ renderMd }) => (html = renderMd(src)))
  })
</script>

<div
  class="modal-backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onclose()}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={$t.rules} tabindex="-1">
    <div class="modal-header">
      <h2>{$t.rules}</h2>
      <button class="icon-btn" onclick={onclose} aria-label={$t.close}>✕</button>
    </div>
    <div class="modal-body">{@html html}</div>
  </div>
</div>
