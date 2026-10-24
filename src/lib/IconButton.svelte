<script lang="ts">
	import Icon from './Icon.svelte';
	let { icon, label, tooltip = label, onclick, primary = false, expanded, controls, below = false }: {
		icon: string; label: string; tooltip?: string; onclick: () => void; primary?: boolean;
		expanded?: boolean; controls?: string; below?: boolean;
	} = $props();
	const id = $props.id();
	let dismissed = $state(false);
</script>

<span class="icon-control" class:below class:dismissed>
	<button type="button" class="icon-button" class:primary aria-label={label} aria-describedby={id}
		aria-expanded={expanded} aria-controls={controls} {onclick}
		onkeydown={(event) => { if (event.key === 'Escape') dismissed = true; }}
		onblur={() => { dismissed = false; }} onpointerleave={() => { dismissed = false; }}>
		<Icon name={icon} />
	</button>
	<span class="tooltip" role="tooltip" {id}>{tooltip}</span>
</span>
