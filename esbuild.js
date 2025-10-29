import { build } from 'esbuild';
import { copyFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(readFileSync('./metadata.json', 'utf8'));

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
}).then(() => {
    const metaSrc = resolve(__dirname, 'metadata.json');
    const metaDist = resolve(__dirname, 'dist/metadata.json');
    const styleSrc = resolve(__dirname, 'dist/stylesheet.css');
    const extensionSrc = resolve(__dirname, 'dist/extension.js');
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(__dirname, 'dist', zipFilename);
    
    copyFileSync(metaSrc, metaDist);

    const zip = new AdmZip();
    zip.addLocalFile(extensionSrc);
    zip.addLocalFile(styleSrc);
    zip.addLocalFile(metaDist);
    zip.writeZip(zipDist);

    console.debug(`Build complete. Zip file: ${zipFilename}\n`);
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});
