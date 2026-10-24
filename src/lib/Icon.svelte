<script lang="ts">
	let { name, size = 20 }: { name: string; size?: number } = $props();
</script>

<img class="icon" src={`${import.meta.env.BASE_URL}icons/${name}.svg`} width={size} height={size} alt="" aria-hidden="true" draggable="false" />
