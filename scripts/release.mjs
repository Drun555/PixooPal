import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = normalizeVersion(process.argv[2] ?? '');

if (!version) {
  console.error('Usage: npm run release -- <version>');
  process.exit(1);
}

ensureCleanWorkingTree();
updateJsonFile('package.json', (pkg) => {
  pkg.version = version;
  return pkg;
});
updateJsonFile('package-lock.json', (lockfile) => {
  lockfile.version = version;

  if (lockfile.packages?.['']) {
    lockfile.packages[''].version = version;
  }

  return lockfile;
});
updateHomeAssistantConfig(version);

execFileSync('git', ['add', 'package.json', 'package-lock.json', 'addons/pixoopal/config.yaml'], {
  stdio: 'inherit'
});
execFileSync('git', ['commit', '-m', `Release v${version}`], { stdio: 'inherit' });
execFileSync('git', ['tag', `v${version}`], { stdio: 'inherit' });

console.log(`Release v${version} prepared.`);
console.log('Push it with: git push --follow-tags');

function normalizeVersion(value) {
  const version = value.trim().replace(/^v/i, '');

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return '';
  }

  return version;
}

function ensureCleanWorkingTree() {
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim();

  if (status) {
    console.error('Working tree must be clean before preparing a release.');
    console.error(status);
    process.exit(1);
  }
}

function updateJsonFile(path, update) {
  const value = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, `${JSON.stringify(update(value), null, 2)}\n`, 'utf-8');
}

function updateHomeAssistantConfig(nextVersion) {
  const path = 'addons/pixoopal/config.yaml';
  const current = readFileSync(path, 'utf-8');
  const next = current.replace(/^version:\s*["']?.*?["']?\s*$/m, `version: "${nextVersion}"`);

  if (next === current) {
    throw new Error(`${path} does not contain a version field.`);
  }

  writeFileSync(path, next, 'utf-8');
}
