<script lang="ts">
  import rulesNl from '../../rules/rules-nl.md?raw'
  import rulesEn from '../../rules/rules-en.md?raw'
  import { lang, t } from '../lib/i18n'
  import { renderMd } from '../lib/md'

  let { onclose }: { onclose: () => void } = $props()

  const html = $derived(renderMd($lang === 'nl' ? rulesNl : rulesEn))
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onclose()}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <div class="dialog" role="dialog" aria-modal="true" tabindex="-1">
    <div class="content">{@html html}</div>
    <button class="btn" onclick={onclose}>{$t.close}</button>
  </div>
</div>
