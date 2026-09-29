<script lang="ts">
  import type { LogEvent } from '../engine'
  import { lang, logText } from '../lib/i18n'
  import type { SeatInfo } from '../lib/net-types'

  let {
    log,
    seats,
  }: {
    log: LogEvent[]
    seats: (SeatInfo | null)[]
  } = $props()

  const name = (seat: number) => seats[seat]?.name ?? `#${seat}`
  const items = $derived(log.slice(-14).reverse())
</script>

<div class="logpanel">
  {#each items as ev, i (log.length - i)}
    <div class="line">{logText(ev, $lang, name)}</div>
  {/each}
</div>
