import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  matchesPreviewImageType,
  previewImageType,
} from '../../../src/clipboard/linkPreviewImageFormat.ts';
import { parsePreviewMetadata } from '../../../src/clipboard/linkPreviewMetadata.ts';

test('cross-origin image requests retain the endpoint validation and redirect guards', () => {
  const source = readFileSync('src/clipboard/linkPreview.ts', 'utf8');
  assert.doesNotMatch(source, /sameOriginImage/);
  assert.match(source, /resolveEndpoint\(imageHost, stageCancel\)/);
  assert.match(source, /requestPreview\(\s*image,\s*imageEndpoint,/);
  assert.match(source, /RESERVED_NETWORKS\.some\(\(network\) => network\.matches\(address\)\)/);
  assert.match(source, /Soup\.MessageFlags\.NO_REDIRECT/);
  assert.match(source, /remote_connectable: endpoint/);
});

test('reads Open Graph and Twitter image candidates without applying text truncation', () => {
  const image = `/cover.png?token=${'a'.repeat(512)}&amp;size=large`;
  assert.deepEqual(
    parsePreviewMetadata(`
      <head><title>Catalog</title>
      <meta name="twitter:image" content="/twitter.jpg">
      <meta property="og:image" content="${image}">
      <meta property="og:image" content="/duplicate.jpg">
      </head>`),
    {
      title: 'Catalog',
      description: '',
      imageCandidates: [image.replace('&amp;', '&'), '/twitter.jpg'],
    },
  );
});

test('does not use image metadata inside comments, scripts, attributes or after head', () => {
  assert.equal(
    parsePreviewMetadata(`
      <head>
        <!-- <meta property="og:image" content="/comment.jpg"> -->
        <script>const x = '<meta property="og:image" content="/script.jpg">';</script>
        <noscript><meta property="og:image" content="/noscript.jpg"></noscript>
        <link title='<meta property="og:image" content="/attribute.jpg">'>
      </head>
      <meta name="twitter:image" content="/body.jpg">
    `),
    null,
  );
});

test('accepts an image without title or description', () => {
  assert.deepEqual(parsePreviewMetadata('<meta name="twitter:image" content="/cover.jpg">'), {
    title: '',
    description: '',
    imageCandidates: ['/cover.jpg'],
  });
});

test('permits only explicitly supported raster MIME types', () => {
  assert.equal(previewImageType('IMAGE/WEBP; quality=80'), 'image/webp');
  assert.equal(previewImageType('image/jpeg, image/png'), null);
  assert.equal(previewImageType('image/svg+xml'), null);
  assert.equal(previewImageType('application/octet-stream'), null);
});

test('rejects image bodies whose signatures do not match the declared format', () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(matchesPreviewImageType(png, 'image/png'), true);
  assert.equal(matchesPreviewImageType(png, 'image/jpeg'), false);
  assert.equal(matchesPreviewImageType(png.subarray(0, 4), 'image/png'), false);
  assert.equal(
    matchesPreviewImageType(new TextEncoder().encode('RIFF0123WEBP'), 'image/webp'),
    true,
  );
});
