const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/backend'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        "./src/assets",
        // backend-core's transliteration tables ride along as a bundle asset —
        // the service resolves them next to the compiled output (§11 keeps the
        // lib itself ignorant of this app's tree).
        {
          input: "libs/backend-core/src/lib/transliteration-tables",
          glob: "**/*.json",
          output: "assets/transliteration-tables",
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    })
  ],
};
