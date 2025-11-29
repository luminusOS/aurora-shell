import { build } from 'esbuild';
import { copyFileSync, readFileSync, existsSync } from 'node:fs';
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
  entryPoints: ['src/extension.ts', 'src/prefs.ts'],
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
    const extensionSrc = resolve(currentDir, 'dist/extension.js');
    const prefsSrc = resolve(currentDir, 'dist/prefs.js');
    const schemasSrc = resolve(currentDir, 'schemas');
    const styleFiles = [
      'dist/stylesheet.css',
      'dist/stylesheet-light.css',
      'dist/stylesheet-dark.css',
    ].map((file) => resolve(currentDir, file));
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(currentDir, 'dist', zipFilename);

    copyFileSync(metadataPath, metaDist);

    const zip: AdmZip = new AdmZip();
    zip.addLocalFile(extensionSrc);
    if (existsSync(prefsSrc)) {
      zip.addLocalFile(prefsSrc);
    }
    styleFiles.forEach((stylePath) => {
      if (existsSync(stylePath)) {
        zip.addLocalFile(stylePath);
      }
    });
    zip.addLocalFile(metaDist);
    if (existsSync(schemasSrc)) {
      zip.addLocalFolder(schemasSrc, 'schemas');
    }
    zip.writeZip(zipDist);

    console.debug(`Build complete. Zip file: ${zipFilename}`);
  })
  .catch((error: unknown) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
