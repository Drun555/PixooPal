import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = normalizeVersion(process.argv[2] ?? '');
const tagName = `v${version}`;

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

if (hasStagedChanges()) {
  execFileSync('git', ['commit', '-m', `Release ${tagName}`], { stdio: 'inherit' });
} else {
  console.log(`Release ${tagName} already matches tracked files; skipping commit.`);
}

ensureTag(tagName);

console.log(`Release ${tagName} prepared.`);
console.log(`Push it with: git push origin main ${tagName}`);

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

function hasStagedChanges() {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
    return false;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      return true;
    }

    throw error;
  }
}

function ensureTag(name) {
  const head = getGitOutput(['rev-parse', 'HEAD']);
  const existing = getGitOutput(['rev-parse', '--verify', `${name}^{}`], { allowFailure: true });

  if (!existing) {
    execFileSync('git', ['tag', name], { stdio: 'inherit' });
    return;
  }

  if (existing === head) {
    console.log(`Tag ${name} already exists on HEAD; skipping tag creation.`);
    return;
  }

  console.log(`Tag ${name} already exists on ${existing}; skipping tag creation.`);
  console.log(`If this is intentional, push the existing tag with: git push origin ${name}`);
}

function getGitOutput(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (allowFailure) {
      return '';
    }

    throw error;
  }
}

function updateJsonFile(path, update) {
  const value = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, `${JSON.stringify(update(value), null, 2)}\n`, 'utf-8');
}

function updateHomeAssistantConfig(nextVersion) {
  const path = 'addons/pixoopal/config.yaml';
  const current = readFileSync(path, 'utf-8');
  const versionPattern = /^version:\s*["']?.*?["']?\s*$/m;

  if (!versionPattern.test(current)) {
    throw new Error(`${path} does not contain a version field.`);
  }

  const next = current.replace(versionPattern, `version: "${nextVersion}"`);

  writeFileSync(path, next, 'utf-8');
}
