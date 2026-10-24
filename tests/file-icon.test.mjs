import assert from 'node:assert/strict';
import test from 'node:test';
import { fileIcon } from '../src/lib/file-icon.ts';

test('file icons describe image, audio, video, archive and document MIME types', () => {
  for (const [mime, expected] of [
    ['image/png', 'image'], ['image/svg+xml', 'image'],
    ['audio/wav', 'audio_file'], ['video/mp4', 'video_file'],
    ['application/zip', 'folder_zip'], ['application/gzip', 'folder_zip'],
    ['application/x-tar', 'folder_zip'], ['application/vnd.rar', 'folder_zip'],
    ['application/x-7z-compressed', 'folder_zip'],
    ['application/pdf', 'draft'], ['text/plain', 'draft'], ['', 'draft']
  ]) assert.equal(fileIcon(mime), expected, mime);
});

test('verified engine category takes precedence over a misleading input MIME type', () => {
  assert.equal(fileIcon('image/png', 'audio'), 'audio_file');
  assert.equal(fileIcon('image/png', 'archive'), 'folder_zip');
});
