<script lang="ts">
  let { name, bot }: { name: string; bot: boolean } = $props()
</script>

<span class="avatar">{bot ? '🤖' : name.slice(0, 1).toUpperCase()}</span>
