export function decodeSvg(svg: string): Promise<ImageBitmap> {
	return new Promise(resolve => {
		const listener = (event: MessageEvent) => {
			if (event.data.type !== 'rasterized') return;
			self.removeEventListener('message',listener);
			resolve(event.data.bitmap);
		};
		self.addEventListener('message',listener);
		self.postMessage({type:'rasterize',svg});
	});
}
