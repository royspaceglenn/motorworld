import { execSync, spawn } from 'node:child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

const APP_DISPLAY_NAME = 'Motor World Auto Services & Sales Corporation';
const APP_USER_DATA_DIR = 'Motor World Auto Services & Sales Corporation';
const LEGACY_APP_USER_DATA_DIR = 'EFCP Motor Parts and Trading';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preloadPath = path.join(__dirname, 'preload.cjs');
const backendPort = 3001;

/** Same default as Vite (`VITE_DEV_SERVER_PORT` in project-root `.env` / `.env.local`). */
function getViteDevServerPort() {
  const fallback = 5174;
  const root = path.resolve(__dirname, '..');
  const envFiles = [path.join(root, '.env'), path.join(root, '.env.local')];
  let fromFile = null;
  for (const envPath of envFiles) {
    try {
      const text = fs.readFileSync(envPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = /^VITE_DEV_SERVER_PORT=(\d+)\s*$/.exec(trimmed);
        if (m) fromFile = Number(m[1]) || null;
      }
    } catch {
      // ignore missing file
    }
  }
  if (fromFile && Number.isFinite(fromFile) && fromFile > 0) return fromFile;
  const fromProc = Number(process.env.VITE_DEV_SERVER_PORT);
  if (Number.isFinite(fromProc) && fromProc > 0) return fromProc;
  return fallback;
}

let adminWindow = null;
let viewerWindow = null;
let stopBackend = null;
let backendChild = null;

function trimExecutableEnv(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/^["']+|["']+$/g, '');
}

/** Ensure System32 is on PATH so where.exe / node resolution works from packaged Electron. */
function ensureWindowsPathForChild(env) {
  if (process.platform !== 'win32') {
    return env;
  }
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const p = env.PATH || '';
  const parts = p.split(path.delimiter).filter(Boolean);
  if (parts.some((dir) => dir.toLowerCase() === sys32.toLowerCase())) {
    return env;
  }
  return { ...env, PATH: `${sys32}${path.delimiter}${p}` };
}

/** System Node for the SQLite API (not Electron's runtime). */
function resolveNodeExecutable(env = process.env) {
  const fromEnv = trimExecutableEnv(env.MOTOR_WORLD_NODE_EXECUTABLE || env.EFCP_NODE_EXECUTABLE);
  if (fromEnv) {
    const normalized = path.normalize(fromEnv);
    if (fs.existsSync(normalized)) {
      return normalized;
    }
    appendStartupLog(`MOTOR_WORLD_NODE_EXECUTABLE not found on disk: ${normalized}`);
  }

  if (process.platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = [
      path.join(pf, 'nodejs', 'node.exe'),
      path.join(pf86, 'nodejs', 'node.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    try {
      const out = execSync('where.exe node', {
        encoding: 'utf8',
        windowsHide: true,
        env,
      }).trim();
      const firstLine = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      if (firstLine) {
        const resolved = path.normalize(firstLine);
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      }
    } catch {
      // where.exe failed — fall through
    }
  }

  return 'node';
}

function waitForTcpPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for backend on ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function isDevelopment() {
  return !app.isPackaged;
}

function viewerUrl() {
  const p = getViteDevServerPort();
  return isDevelopment() ? `http://127.0.0.1:${p}/viewer.html` : null;
}

function adminUrl() {
  const p = getViteDevServerPort();
  return `http://127.0.0.1:${p}/aiosystem`;
}

function getDesktopDataRoot() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = process.env.LOCALAPPDATA;
    const nextPath = path.join(base, APP_USER_DATA_DIR);
    const legacyPath = path.join(base, LEGACY_APP_USER_DATA_DIR);
    try {
      const legacyData = path.join(legacyPath, 'data');
      if (!fs.existsSync(nextPath) && fs.existsSync(legacyData)) {
        return legacyPath;
      }
    } catch {
      // ignore
    }
    return nextPath;
  }

  return app.getPath('userData');
}

function normalizeApiBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\/$/, '');
}

function isRemoteApiBaseUrl(url) {
  const u = normalizeApiBaseUrl(url).toLowerCase();
  if (!u) return false;
  try {
    const withScheme = u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}`;
    const { hostname } = new URL(withScheme);
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

/** Baked into packaged installers only — dev (`electron .`) always uses the local embedded API. */
function tryLoadBundledApiBaseUrl() {
  if (!app.isPackaged) return;
  if (process.env.MOTOR_WORLD_API_BASE_URL || process.env.EFCP_API_BASE_URL) return;
  try {
    const filePath = path.join(__dirname, 'bundled-api.json');
    if (!fs.existsSync(filePath)) return;
    const cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const url = normalizeApiBaseUrl(cfg.apiBaseUrl);
    if (!url) return;
    process.env.MOTOR_WORLD_API_BASE_URL = url;
    appendStartupLog(`bundled-api.json: MOTOR_WORLD_API_BASE_URL=${url}`);
  } catch (err) {
    appendStartupLog(`bundled-api.json read failed: ${err?.message || err}`);
  }
}

/** Optional override: %LOCALAPPDATA%/<app data dir>/api-settings.json */
function tryLoadApiBaseUrlFromDisk() {
  try {
    const base = getDesktopDataRoot();
    const filePath = path.join(base, 'api-settings.json');
    if (!fs.existsSync(filePath)) return;
    const cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const fromFile = normalizeApiBaseUrl(cfg.apiBaseUrl);
    if (fromFile) {
      process.env.MOTOR_WORLD_API_BASE_URL = fromFile;
      appendStartupLog(`api-settings.json: MOTOR_WORLD_API_BASE_URL=${fromFile}`);
    }
  } catch (err) {
    appendStartupLog(`api-settings.json read failed: ${err?.message || err}`);
  }
}

function getProjectRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }

  return path.resolve(__dirname, '..');
}

/** Directory that contains `server/` for spawning external Node (must be real disk, not inside app.asar). */
function getServerProjectRoot() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '..');
  }
  const asarRoot = app.getAppPath();
  const resourcesDir = path.dirname(asarRoot);
  const unpackedRoot = path.join(resourcesDir, 'app.asar.unpacked');
  const unpackedEntry = path.join(unpackedRoot, 'server', 'index.js');
  if (fs.existsSync(unpackedEntry)) {
    return unpackedRoot;
  }
  return asarRoot;
}

function getDistDir() {
  return path.join(getProjectRoot(), 'dist');
}

function appendStartupLog(line) {
  try {
    const base = getDesktopDataRoot();
    const logDir = path.join(base, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString();
    fs.appendFileSync(path.join(logDir, 'startup.log'), `[${stamp}] ${line}\n`);
  } catch {
    // ignore logging failures
  }
}

function showFatalStartupError(title, err) {
  const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  appendStartupLog(`${title}: ${message}`);
  try {
    dialog.showErrorBox(title, message.slice(0, 4000));
  } catch {
    // ignore
  }
}

async function startEmbeddedBackend() {
  const remoteApi = normalizeApiBaseUrl(
    process.env.MOTOR_WORLD_API_BASE_URL || process.env.EFCP_API_BASE_URL,
  );
  if (isRemoteApiBaseUrl(remoteApi)) {
    appendStartupLog(`remote API mode (${remoteApi}); skipping embedded SQLite backend`);
    stopBackend = async () => {};
    return;
  }

  const appDataDir = getDesktopDataRoot();
  const dataDir = path.join(appDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const syncSettingsPath =
    process.env.MOTOR_WORLD_SYNC_SETTINGS_PATH ||
    process.env.EFCP_SYNC_SETTINGS_PATH ||
    path.join(appDataDir, 'sync-settings.json');
  const sqlitePath =
    process.env.SQLITE_DB_PATH ||
    (() => {
      const motor = path.join(dataDir, 'motorworld.sqlite');
      const legacy = path.join(dataDir, 'efcp.sqlite');
      if (fs.existsSync(motor)) return motor;
      if (fs.existsSync(legacy)) return legacy;
      return motor;
    })();

  const backendEnv = ensureWindowsPathForChild({
    ...process.env,
    MOTOR_WORLD_APP_DATA_DIR: appDataDir,
    MOTOR_WORLD_SYNC_SETTINGS_PATH: syncSettingsPath,
    EFCP_APP_DATA_DIR: appDataDir,
    EFCP_SYNC_SETTINGS_PATH: syncSettingsPath,
    PORT: String(backendPort),
    SQLITE_DB_PATH: sqlitePath,
  });

  const serverRoot = getServerProjectRoot();
  const serverEntry = path.join(serverRoot, 'server', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }

  // Run the API in external Node (dev and packaged). Keeps Electron's runtime separate from the API process.
  const nodeBin = resolveNodeExecutable(backendEnv);
  appendStartupLog(`spawning API with Node: ${nodeBin}`);
  let backendLogBuf = '';
  const cap = 24000;
  const collect = (chunk) => {
    backendLogBuf += chunk.toString();
    if (backendLogBuf.length > cap) backendLogBuf = backendLogBuf.slice(-cap);
  };

  backendChild = spawn(nodeBin, [serverEntry], {
    cwd: serverRoot,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  backendChild.stdout?.on('data', collect);
  backendChild.stderr?.on('data', collect);

  backendChild.on('error', (err) => {
    appendStartupLog(`backend spawn error: ${err}`);
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onExit = (code, signal) => {
      cleanup();
      const tail = backendLogBuf.trim();
      if (tail) {
        appendStartupLog(`backend process output (tail):\n${tail}`);
      }
      appendStartupLog(`backend process exited (code ${code}, signal ${signal ?? 'none'})`);
      reject(
        new Error(
          `Backend exited before listening (code ${code}, signal ${signal ?? 'none'}). ` +
            `Install Node.js (https://nodejs.org). If Node is installed, sign out of Windows once after changing ` +
            `environment variables, or set MOTOR_WORLD_NODE_EXECUTABLE (or EFCP_NODE_EXECUTABLE) to the full path of node.exe (no quotes). ` +
            `If the log shows a crash in the API process, open the log path below for stderr details. ` +
            `From the project folder you can run: npm run rebuild:server-sqlite then npm run desktop:pack. ` +
            `Details: %LOCALAPPDATA%\\${APP_USER_DATA_DIR}\\logs\\startup.log`,
        ),
      );
    };
    const cleanup = () => {
      backendChild.off('error', onError);
      backendChild.off('exit', onExit);
    };
    backendChild.once('error', onError);
    backendChild.once('exit', onExit);
    waitForTcpPort(backendPort)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });

  stopBackend = async () => {
    if (!backendChild) {
      return;
    }
    const child = backendChild;
    backendChild = null;
    child.kill();
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
    });
  };
}

async function loadAdminWindow(window) {
  if (isDevelopment()) {
    await window.webContents.session.clearCache();
    await window.loadURL(adminUrl());
    return;
  }

  await window.loadFile(path.join(getDistDir(), 'index.html'), { hash: '/aiosystem' });
}

async function loadViewerWindow(window) {
  if (isDevelopment()) {
    await window.webContents.session.clearCache();
    await window.loadURL(viewerUrl());
    return;
  }

  await window.loadFile(path.join(getDistDir(), 'viewer.html'));
}

async function createAdminWindow() {
  if (adminWindow) {
    adminWindow.focus();
    return adminWindow;
  }

  adminWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: isDevelopment()
      ? `${APP_DISPLAY_NAME} — dev (Vite :${getViteDevServerPort()})`
      : APP_DISPLAY_NAME,
    autoHideMenuBar: !isDevelopment(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  adminWindow.on('closed', () => {
    adminWindow = null;
  });

  adminWindow.webContents.setWindowOpenHandler(({ url }) => {
    const raw = url || '';
    const lower = raw.toLowerCase();
    // In-app print helpers use blank / about / data / blob windows — never hand those to the OS.
    if (
      raw === '' ||
      lower === 'about:blank' ||
      lower === 'about:srcdoc' ||
      lower.startsWith('about:') ||
      lower.startsWith('data:') ||
      lower.startsWith('blob:')
    ) {
      return { action: 'allow' };
    }
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      void shell.openExternal(raw);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  adminWindow.once('ready-to-show', () => adminWindow?.show());
  await loadAdminWindow(adminWindow);
  if (!adminWindow.isVisible()) {
    adminWindow.show();
  }

  return adminWindow;
}

async function createViewerWindow() {
  if (viewerWindow) {
    viewerWindow.focus();
    return viewerWindow;
  }

  viewerWindow = new BrowserWindow({
    width: 430,
    height: 860,
    minWidth: 380,
    minHeight: 720,
    show: false,
    title: isDevelopment()
      ? `${APP_DISPLAY_NAME} — Viewer (dev :${getViteDevServerPort()})`
      : `${APP_DISPLAY_NAME} — Viewer`,
    autoHideMenuBar: !isDevelopment(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  viewerWindow.on('closed', () => {
    viewerWindow = null;
  });

  viewerWindow.once('ready-to-show', () => viewerWindow?.show());
  await loadViewerWindow(viewerWindow);
  if (!viewerWindow.isVisible()) {
    viewerWindow.show();
  }

  return viewerWindow;
}

function installMenu() {
  const viewSubmenu = isDevelopment()
    ? [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
    : [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ];

  const template = [
    {
      label: 'App',
      submenu: [
        {
          label: 'Open Admin',
          click: () => {
            void createAdminWindow();
          },
        },
        {
          label: 'Open Viewer',
          click: () => {
            void createViewerWindow();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: viewSubmenu,
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('desktop:open-viewer', async () => {
  await createViewerWindow();
  return true;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (adminWindow) {
      adminWindow.focus();
    } else {
      void createAdminWindow();
    }
  });

  process.on('uncaughtException', (err) => {
    showFatalStartupError(`${APP_DISPLAY_NAME} — uncaught error`, err);
  });

  process.on('unhandledRejection', (reason) => {
    showFatalStartupError(`${APP_DISPLAY_NAME} — unhandled rejection`, reason);
  });

  app.whenReady().then(async () => {
    try {
      appendStartupLog(`starting packaged=${app.isPackaged} appPath=${app.getAppPath()}`);
      app.setName(APP_DISPLAY_NAME);
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.motorworld.desktop');
      }
      tryLoadBundledApiBaseUrl();
      tryLoadApiBaseUrlFromDisk();
      await startEmbeddedBackend();
      installMenu();
      await createAdminWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void createAdminWindow();
        }
      });
    } catch (err) {
      showFatalStartupError(`${APP_DISPLAY_NAME} failed to start`, err);
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (stopBackend) {
    void stopBackend();
  }
});
