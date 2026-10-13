#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const failures = [];

if (packageJson.name !== '@xumoses/sentry-miniapp-replay-taro') {
  failures.push(
    `package name must be @xumoses/sentry-miniapp-replay-taro, got ${packageJson.name}`,
  );
}
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(packageJson.version)) {
  failures.push(`version must match x.y.z-beta.N, got ${packageJson.version}`);
}
if (packageJson.publishConfig?.access !== 'public') {
  failures.push('publishConfig.access must be public');
}
if (packageJson.publishConfig?.tag !== 'beta') {
  failures.push('publishConfig.tag must be beta');
}
if (packageJson.publishConfig?.registry !== 'https://registry.npmjs.org/') {
  failures.push('publishConfig.registry must be https://registry.npmjs.org/');
}
if (
  process.env.GITHUB_REF_TYPE === 'tag' &&
  process.env.GITHUB_REF_NAME !== `v${packageJson.version}`
) {
  failures.push(
    `tag must match package version v${packageJson.version}, got ${process.env.GITHUB_REF_NAME}`,
  );
}
if (process.env.npm_config_tag && process.env.npm_config_tag !== 'beta') {
  failures.push(`publish tag must be beta, got ${process.env.npm_config_tag}`);
}

if (failures.length) {
  console.error(`[beta-release] ${failures.join('\n[beta-release] ')}`);
  process.exit(1);
}

console.log(`[beta-release] verified ${packageJson.name}@${packageJson.version}`);
