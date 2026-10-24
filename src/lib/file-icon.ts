// Official Material Icon Theme associations; source and license: static/icons/README.md.
const extensionGroups: Record<string, string> = {
	image: 'png jpeg jpg jpe gif ico tif tiff ami apx avif bmp bpg brk cur dds exr fpx gbr img jbig2 jb2 jng jxl jxr pgf pic raw webp eps afphoto ase aseprite clip cpt heif heic kra mdp ora pdn reb sai tga xcf jfif ppm pbm pgm pnm icns 3fr ari arw bay braw crw cr2 cr3 cap data dcs dcr dng drf eip erf fff gpr iiq k25 kdc mdc mef mos mrw nef nrw obm orf pef ptx pxn r3d raf rwl rw2 rwz sr2 srf srw x3f ktx ktx2',
	svg: 'svg',
	audio: '8svx aa aac aax ac3 aif aiff alac amr ape caf cda cdr dss ec3 efs enc flac flp gsm it m3u m3u8 m4a m4b m4p m4r mid mka mmf mod mp3 mpc mscz mtm mui musx mxl nsa ogg opus pkf qcp ra rf64 rip sdt sesx sf2 stap tg voc vqf wav weba wfp wma wpl wproj wv',
	video: 'webm mkv flv vob ogv gifv avi mov qt wmv yuv rm rmvb mp4 m4v mpg mp2 mpeg mpe mpv m2v',
	zip: 'zip z tar gz xz lz liz lzma lzma2 lz4 lz5 lzh lha br bz2 bzip2 gzip brotli 7z 001 rar far tz taz tlz txz tgz tpz tbz tbz2 zst zstd tzst tzstd cab cpio rpm deb arj wim swm esd fat xar ntfs hfs squashfs apfs',
	pdf: 'pdf',
	document: 'txt',
	word: 'doc docx rtf odt',
	table: 'xlsx xlsm xls csv tsv psv ods',
	powerpoint: 'pptx ppt pptm potx potm ppsx ppsm pps ppam ppa odp',
	markdown: 'md markdown rst copilotmd litcoffee markdn mdown mdtext mdtxt mdwn mkd mkdn ronn workbook',
	epub: 'epub',
	font: 'woff woff2 ttf eot suit otf bmap fnt odttf ttc font fonts sui ntf mrf',
	'adobe-photoshop': 'psd psb psdt',
	'adobe-illustrator': 'ai ait'
};
const extensionIcons = new Map(Object.entries(extensionGroups).flatMap(([icon, extensions]) =>
	extensions.split(' ').map(extension => [extension, icon] as const)));
const mimeIcons: Record<string, string> = {
	'image/svg+xml': 'svg', 'image/vnd.adobe.photoshop': 'adobe-photoshop',
	'application/zip': 'zip', 'application/gzip': 'zip', 'application/x-gzip': 'zip',
	'application/x-tar': 'zip', 'application/vnd.rar': 'zip', 'application/x-rar-compressed': 'zip',
	'application/x-7z-compressed': 'zip', 'application/pdf': 'pdf', 'text/plain': 'document',
	'text/markdown': 'markdown', 'text/csv': 'table', 'application/epub+zip': 'epub',
	'application/msword': 'word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
	'application/vnd.ms-excel': 'table', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'table',
	'application/vnd.ms-powerpoint': 'powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint'
};

export function fileIcon(mime: string, category?: 'audio' | 'archive', filename = ''): string {
	if (category === 'audio') return 'audio';
	if (category === 'archive') return 'zip';
	if (Object.hasOwn(mimeIcons, mime)) return mimeIcons[mime];
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('video/')) return 'video';
	const dot = filename.lastIndexOf('.');
	return (dot > 0 ? extensionIcons.get(filename.slice(dot + 1).toLowerCase()) : undefined) ?? 'file';
}
