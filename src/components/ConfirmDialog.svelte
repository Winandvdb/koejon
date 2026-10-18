<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '../lib/i18n'

  let {
    title,
    text,
    confirmLabel,
    onanswer,
  }: {
    title: string
    text: string
    confirmLabel: string
    onanswer: (ok: boolean) => void
  } = $props()

  let dialog: HTMLDialogElement
  let answered = false

  function answer(ok: boolean) {
    if (answered) return
    answered = true
    dialog.close()
    onanswer(ok)
  }

  // showModal: focus stays inside and Escape cancels, as with the browser's own
  // confirm. Focus starts on Cancel: Enter must never end a game by accident.
  onMount(() => dialog.showModal())
</script>

<dialog
  bind:this={dialog}
  class="modal confirm"
  aria-labelledby="confirm-title"
  aria-describedby="confirm-text"
  oncancel={(e) => (e.preventDefault(), answer(false))}
  onclick={(e) => e.target === dialog && answer(false)}
>
  <h2 id="confirm-title">{title}</h2>
  <p id="confirm-text" class="muted">{text}</p>
  <div class="confirm-actions">
    <!-- svelte-ignore a11y_autofocus -->
    <button class="btn" autofocus onclick={() => answer(false)}>{$t.cancel}</button>
    <button class="btn danger" onclick={() => answer(true)}>{confirmLabel}</button>
  </div>
</dialog>
