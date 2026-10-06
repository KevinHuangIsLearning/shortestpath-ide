//@ts-check

'use strict';

/**
 * Design-preview bundle. Renders the real Judger layout components against
 * fixture data so the panel can be reviewed in a browser. Output goes to
 * `preview-dist/`, never into the shipped `dist/`.
 */
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/**@type {import('webpack').Configuration}*/
const config = {
    target: 'web',
    entry: './src/webview/frontend/preview.tsx',
    output: {
        path: path.resolve(__dirname, 'preview-dist'),
        filename: 'preview.module.js',
        libraryTarget: 'window',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    devtool: false,
    externals: {
        vscode: 'vscode',
    },
    resolve: {
        extensions: ['.ts', '.js', '.tsx'],
    },
    module: {
        rules: [
            {
                test: /(\.tsx|\.ts)\b/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
        ],
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                {
                    from: 'src/webview/frontend/preview.html',
                    to: 'index.html',
                },
                { from: 'src/webview/frontend/app.css', to: 'app.css' },
                { from: 'src/webview/frontend/tokens.css', to: 'tokens.css' },
                { from: 'src/webview/frontend/preview.css', to: 'preview.css' },
                {
                    from: 'node_modules/@vscode/codicons/dist/codicon.css',
                    to: 'codicon.css',
                },
                {
                    from: 'node_modules/@vscode/codicons/dist/codicon.ttf',
                    to: 'codicon.ttf',
                },
            ],
        }),
    ],
};
module.exports = config;
