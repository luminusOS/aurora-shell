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
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(__dirname, zipFilename);
    
    // Copy metadata
    copyFileSync(metaSrc, metaDist);

    // Create zip
    const zip = new AdmZip();
    zip.addLocalFolder(resolve(__dirname, 'dist'));
    zip.writeZip(zipDist);

    console.log(`✅ Build complete. Zip file: ${zipFilename}\n`);
    console.log(`📦 Install with: gnome-extensions install ${zipFilename}`);
    console.log(`🔄 Update with: gnome-extensions install --force ${zipFilename}`);
    console.log(`🔌 Enable with: gnome-extensions enable ${metadata.uuid}`);
    console.log('');
    console.log(`⛔ Disable with: gnome-extensions disable ${metadata.uuid}`);
    console.log(`🗑️  Remove with: gnome-extensions uninstall ${metadata.uuid}`);
    console.log('');
    console.log('💡 To check if the extension has been recognized: gnome-extensions list');
    console.log(`   If ${metadata.uuid} is listed, you can activate it.`);
    console.log('   Otherwise, restart GNOME Shell (logout/login on Wayland).');
}).catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
});
