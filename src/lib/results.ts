import { formatById } from './registry.ts';

export function outputName(name: string, formatId: string): string {
	const format = formatById(formatId);
	if (!format) throw new Error('This output format is not supported.');
	const base = (name.split(/[/\\]/).pop() ?? '').replace(/\.[^.]*$/, '').replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
	return `${base || 'converted'}.${format.extension}`;
}

export class ResultManager {
	url = '';
	private name = '';

	set(result: { blob: Blob; name: string }) {
		this.clear();
		this.url = URL.createObjectURL(result.blob);
		this.name = result.name;
	}

	download() {
		if (!this.url) return;
		const link = document.createElement('a');
		link.href = this.url;
		link.download = this.name;
		document.body.append(link);
		link.click();
		link.remove();
	}

	clear() {
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = '';
		this.name = '';
	}
}
