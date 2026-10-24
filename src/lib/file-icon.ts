export function fileIcon(mime: string, category?: 'audio' | 'archive'): string {
	if (category === 'audio') return 'audio_file';
	if (category === 'archive') return 'folder_zip';
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('audio/')) return 'audio_file';
	if (mime.startsWith('video/')) return 'video_file';
	if (['application/zip', 'application/gzip', 'application/x-gzip', 'application/x-tar',
		'application/vnd.rar', 'application/x-rar-compressed', 'application/x-7z-compressed'].includes(mime)) return 'folder_zip';
	return 'draft';
}
