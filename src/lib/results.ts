import {releaseTemporary} from './stream-output.ts';
import { adapters, formatById } from './registry.ts';

export function outputName(name: string, formatId: string): string {
	const format = formatById(formatId);
	if (!format || !adapters.some(a=>a.outputs.includes(formatId))) throw new Error('This output format is not supported.');
	const base = (name.split(/[/\\]/).pop() ?? '').replace(/\.[^.]*$/, '').replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
	return `${base || 'converted'}.${format.extension}`;
}

export function discardResult(result:{temporaryFile?:string}) {
	if(result.temporaryFile)void releaseTemporary(result.temporaryFile).catch(()=>console.warn('Temporary output cleanup failed; clear this site’s browser storage.'));
}

export class ResultManager {
	url = '';
	private name = '';
	private temporaryFile:string|undefined;

	set(result: { blob: Blob; name: string; temporaryFile?:string }) {
		this.clear();
		try {this.url = URL.createObjectURL(result.blob);}
		catch(error){discardResult(result);throw error;}
		this.name = result.name;
		this.temporaryFile=result.temporaryFile;
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
		discardResult({temporaryFile:this.temporaryFile});this.temporaryFile=undefined;
		this.url = '';
		this.name = '';
	}
}
