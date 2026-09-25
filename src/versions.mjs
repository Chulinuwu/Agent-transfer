export const TESTED = {
  claude: { min: '2.1.209', max: '2.1.281' },
  codex: { min: '0.144.0', max: '0.155.0' },
};

const parts = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);

export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function versionWarning(tool, version) {
  const range = TESTED[tool];
  if (!version) return `${tool} version unknown; tested ${range.min} to ${range.max}`;
  if (compareVersions(version, range.min) < 0 || compareVersions(version, range.max) > 0) {
    return `${tool} ${version} is outside the tested range ${range.min} to ${range.max}; output may be incomplete`;
  }
}