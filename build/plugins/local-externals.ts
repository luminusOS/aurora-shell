import type { Plugin } from 'esbuild';
import { dirname, relative, resolve } from 'node:path';

// Externalize local .ts imports and rewrite paths to .js
export const localExternals: Plugin = {
  name: 'local-externals',
  setup(ctx) {
    ctx.onResolve({ filter: /\.ts$/ }, (args) => {
      if (args.kind === 'entry-point') return;

      if (args.path.startsWith('.')) {
        return {
          path: args.path.replace(/\.ts$/, '.js'),
          external: true,
        };
      }

      if (args.path.startsWith('~/')) {
        const projectRoot = process.cwd();
        const srcDir = resolve(projectRoot, 'src');

        const targetPath = args.path.replace(/^~\//, `${srcDir}/`);

        let relPath = relative(dirname(args.importer), targetPath);
        if (!relPath.startsWith('.')) {
          relPath = `./${relPath}`;
        }

        return {
          path: relPath.replace(/\.ts$/, '.js'),
          external: true,
        };
      }
    });
  },
};
