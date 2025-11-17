import { build } from 'esbuild';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

interface ExtensionMetadata {
  name: string;
  version: string;
  uuid: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const metadataPath = resolve(currentDir, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ExtensionMetadata;

console.debug(`Building ${metadata.name} v${metadata.version}...`);

build({
  entryPoints: ['src/extension.ts'],
  outdir: 'dist',
  bundle: true,
  // Do not remove the functions `enable()`, `disable()` and `init()`
  treeShaking: false,
  // firefox60  // Since GJS 1.53.90
  // firefox68  // Since GJS 1.63.90
  // firefox78  // Since GJS 1.65.90
  // firefox91  // Since GJS 1.71.1
  // firefox102 // Since GJS 1.73.2
  target: 'firefox102',
  format: 'esm',
  external: ['gi://*', 'resource://*', 'system', 'gettext', 'cairo'],
})
  .then(() => {
    const metaDist = resolve(currentDir, 'dist/metadata.json');
    const styleSrc = resolve(currentDir, 'dist/stylesheet.css');
    const extensionSrc = resolve(currentDir, 'dist/extension.js');
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(currentDir, 'dist', zipFilename);

    copyFileSync(metadataPath, metaDist);

    const zip = new AdmZip();
    zip.addLocalFile(extensionSrc);
    zip.addLocalFile(styleSrc);
    zip.addLocalFile(metaDist);
    zip.writeZip(zipDist);

    console.debug(`Build complete. Zip file: ${zipFilename}`);
  })
  .catch((error: unknown) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
