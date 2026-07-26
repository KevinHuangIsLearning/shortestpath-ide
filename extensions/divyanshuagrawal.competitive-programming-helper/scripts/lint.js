const { spawnSync } = require('child_process');
const path = require('path');

const eslintCli = path.resolve(require.resolve('eslint'), '../../bin/eslint.js');

const result = spawnSync(
    process.execPath,
    [eslintCli, '.', '--ext', '.ts,.tsx'],
    {
        stdio: 'inherit',
        env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'false' },
    },
);

process.exit(result.status ?? 1);
