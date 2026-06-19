const text = (value) => String(value ?? '').trim();

const matrixKey = (prefix) => `${prefix}_matrices`;
const tabsKey = (prefix) => `${prefix}_openTabs`;

const rowSource = (row = {}) => (
  text(row['NIOS Filename']) ||
  text(row['Source File']) ||
  text(row['Subject Name']) ||
  text(row['Subject Code'])
).toLowerCase();

const workspaceRows = (workspace = {}, prefix) => (
  Object.values(workspace[matrixKey(prefix)] || {}).flatMap((rows) => (
    Array.isArray(rows) ? rows : []
  ))
);

const workspaceJobIds = (workspace = {}, prefix) => {
  const ids = new Set();
  for (const tab of workspace[tabsKey(prefix)] || []) {
    if (tab?.jobId) ids.add(String(tab.jobId));
  }
  for (const tabId of Object.keys(workspace[matrixKey(prefix)] || {})) {
    const match = String(tabId).match(/engine-([0-9a-f-]{12,})-/i);
    if (match) ids.add(match[1]);
  }
  return ids;
};

const workspaceSources = (workspace = {}, prefix) => {
  const sources = new Set();
  for (const tab of workspace[tabsKey(prefix)] || []) {
    const source = text(tab?.qpName || tab?.label).toLowerCase();
    if (source) sources.add(source);
  }
  for (const row of workspaceRows(workspace, prefix)) {
    const source = rowSource(row);
    if (source) sources.add(source);
  }
  return sources;
};

const setsOverlap = (left, right) => {
  for (const value of left) {
    if (right.has(value)) return true;
    for (const other of right) {
      if (value && other && (value.includes(other) || other.includes(value))) return true;
    }
  }
  return false;
};

export const workspaceRowCount = (workspace = {}, prefix) => (
  workspaceRows(workspace, prefix).length
);

export const readWorkspaceBackup = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const shouldUseWorkspaceBackup = (candidateWorkspace = {}, backupWorkspace = {}, prefix) => {
  const candidateRows = workspaceRowCount(candidateWorkspace, prefix);
  const backupRows = workspaceRowCount(backupWorkspace, prefix);
  if (backupRows === 0) return false;
  if (candidateRows === 0) return true;
  if (backupRows <= candidateRows) return false;

  const candidateJobs = workspaceJobIds(candidateWorkspace, prefix);
  const backupJobs = workspaceJobIds(backupWorkspace, prefix);
  if (setsOverlap(candidateJobs, backupJobs) && candidateRows >= Math.floor(backupRows * 0.75)) {
    return false;
  }

  const candidateSources = workspaceSources(candidateWorkspace, prefix);
  const backupSources = workspaceSources(backupWorkspace, prefix);
  return setsOverlap(candidateSources, backupSources) || backupRows >= candidateRows + 5;
};

export const saveWorkspaceBackup = (storageKey, workspace, prefix) => {
  const existing = readWorkspaceBackup(storageKey);
  if (existing && shouldUseWorkspaceBackup(workspace, existing, prefix)) {
    return { saved: false, skipped: true, backupRows: workspaceRowCount(existing, prefix) };
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
    return { saved: true, skipped: false, backupRows: workspaceRowCount(workspace, prefix) };
  } catch {
    return { saved: false, skipped: false, backupRows: 0 };
  }
};

export const clearWorkspaceBackup = (storageKey) => {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures; the server workspace is still the source of truth.
  }
};
