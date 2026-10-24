import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileIcon } from '../src/lib/file-icon.ts';
import { imageFormats } from '../src/lib/formats.ts';

test('official icons cover media, archives and documents by extension, ignoring case', () => {
  for (const [name, expected] of [
    ['photo.PNG', 'image'], ['photo.jpe', 'image'], ['drawing.SVG', 'svg'],
    ['tone.WAV', 'audio'], ['tone.aiff', 'audio'], ['tone.OGG', 'audio'],
    ['clip.MP4', 'video'], ['clip.webm', 'video'], ['archive.ZIP', 'zip'],
    ['archive.TAR.GZ', 'zip'], ['archive.tar.bz2', 'zip'], ['archive.7z', 'zip'],
    ['notes.PDF', 'pdf'], ['notes.txt', 'document'], ['notes.docx', 'word'],
    ['table.xlsx', 'table'], ['table.csv', 'table'], ['slides.pptx', 'powerpoint'],
    ['readme.md', 'markdown'], ['book.epub', 'epub'], ['font.woff2', 'font'],
    ['drawing.psd', 'adobe-photoshop'], ['drawing.ai', 'adobe-illustrator'],
    ['unknown.XYZ', 'file'], ['unknown.tar.xyz', 'file'], ['no-extension', 'file'],
    ['.hidden', 'file'], ['trailing.', 'file'], ['', 'file']
  ]) assert.equal(fileIcon('', undefined, name), expected, name);
  for (const format of imageFormats) for (const ext of format.extensions) {
    assert.equal(fileIcon('', undefined, `photo.${ext}`), ext === 'svg' ? 'svg' : 'image');
  }
});

test('verified categories and recognized MIME override misleading names, including unknown extensions', () => {
  assert.equal(fileIcon('image/png', 'audio', 'wrong.svg'), 'audio');
  assert.equal(fileIcon('image/png', 'archive', 'wrong.mp3'), 'zip');
  assert.equal(fileIcon('image/png', undefined, 'wrong.mp3'), 'image');
  assert.equal(fileIcon('image/png', undefined, 'wrong.svg'), 'image');
  assert.equal(fileIcon('image/svg+xml', undefined, 'wrong.png'), 'svg');
  for (const [mime, expected] of [
    ['image/png', 'image'], ['image/svg+xml', 'svg'], ['audio/wav', 'audio'],
    ['video/mp4', 'video'], ['application/zip', 'zip'], ['application/gzip', 'zip'],
    ['application/x-tar', 'zip'], ['application/vnd.rar', 'zip'],
    ['application/x-7z-compressed', 'zip'], ['application/pdf', 'pdf'],
    ['text/plain', 'document'], ['application/octet-stream', 'file'], ['', 'file']
  ]) assert.equal(fileIcon(mime, undefined, 'unknown.xyz'), expected, mime);
});

test('all mapped icons are local SVGs and carry the upstream license', async () => {
  const root = new URL('../static/icons/', import.meta.url);
  const names = (await readdir(root)).filter(name => name.endsWith('.svg'));
  for (const name of names) {
    assert.match(await readFile(new URL(name, root), 'utf8'), /<svg\b/);
  }
  for (const ext of ['png', 'svg', 'wav', 'mp4', 'zip', 'pdf', 'txt', 'doc', 'xls', 'ppt', 'md', 'epub', 'woff', 'psd', 'ai', 'unknown']) {
    await access(new URL(`${fileIcon('', undefined, `file.${ext}`)}.svg`, root));
  }
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /Copyright \(c\) 2025 Material Extensions/);
});
