import type { Plugin } from 'esbuild';

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
    });
  },
};
