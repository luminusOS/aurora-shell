import { build } from 'esbuild';
import {
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { format } from 'prettier';

import { localExternals } from './build/plugins/local-externals.ts';
import { createGirsResolver } from './build/plugins/girs-resolver.ts';
import { gobjectDecorator } from './build/plugins/gobject-decorator.ts';
import { addBlankLinesBetweenMembers } from './build/formatting.ts';

interface ExtensionMetadata {
  name: string;
  version: string;
  uuid: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const metadataPath = resolve(currentDir, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ExtensionMetadata;

const srcDir = resolve(currentDir, 'src');
const entryPoints = (readdirSync(srcDir, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => join('src', file));

console.debug(`Building ${metadata.name} v${metadata.version}...`);

const sharedOptions = {
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  plugins: [gobjectDecorator, localExternals, createGirsResolver(currentDir)],
  // Do not remove the functions `enable()`, `disable()` and `init()`
  treeShaking: false,
  // firefox60  // Since GJS 1.53.90
  // firefox68  // Since GJS 1.63.90
  // firefox78  // Since GJS 1.65.90
  // firefox91  // Since GJS 1.71.1
  // firefox102 // Since GJS 1.73.2
  target: 'firefox102' as const,
  format: 'esm' as const,
  external: ['gi://*', 'resource://*', 'system', 'gettext', 'cairo'],
};

Promise.all(
  entryPoints.map((entryPoint) =>
    build({ ...sharedOptions, entryPoints: [entryPoint] }),
  ),
)
  .then(async () => {
    const distDir = resolve(currentDir, 'dist');
    const metaDist = resolve(distDir, 'metadata.json');
    const schemasSrc = resolve(currentDir, 'schemas');
    const styleFiles = [
      'stylesheet.css',
      'stylesheet-light.css',
      'stylesheet-dark.css',
    ];
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(distDir, zipFilename);

    // Format output files with prettier
    const jsFiles = (readdirSync(distDir, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.js'));

    for (const file of jsFiles) {
      const filePath = resolve(distDir, file);
      const content = readFileSync(filePath, 'utf8');
      const formatted = await format(content, { parser: 'babel', filepath: filePath });
      writeFileSync(filePath, addBlankLinesBetweenMembers(formatted));
    }

    copyFileSync(metadataPath, metaDist);

    const zip: AdmZip = new AdmZip();

    for (const file of jsFiles) {
      const filePath = resolve(distDir, file);
      const dir = dirname(file);
      zip.addLocalFile(filePath, dir === '.' ? '' : dir);
    }

    styleFiles.forEach((styleFile) => {
      const stylePath = resolve(distDir, styleFile);
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
