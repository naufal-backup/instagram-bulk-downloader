const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs-extra');
const os = require('os');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const { execFile } = require('child_process');

const resourceBase = app.isPackaged ? process.resourcesPath : __dirname;
const writableBase = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const pythonExe = path.join(resourceBase, 'python-portable', 'python.exe');
const bridgePath = path.join(resourceBase, 'downloader.py');
const dataDir = path.join(writableBase, 'data');
const targetsPath = path.join(dataDir, 'targets.json');
const cookiesPath = path.join(dataDir, 'cookies.json');

// IPC: Fetch Preview Data
ipcMain.on('fetch-preview', async (event, { username, cookies }) => {
  const log = (msg) => event.reply('status-update', msg);
  log(`Fetching preview for ${username} via Instaloader...`);

  execFile(pythonExe, [bridgePath, 'fetch', username, cookies], (error, stdout, stderr) => {
    if (error) {
      log(`Bridge error: ${error.message}`);
      return;
    }
    try {
      const data = JSON.parse(stdout);
      if (data.error) {
        log(`Instaloader error: ${data.error}`);
      } else {
        event.reply('preview-data', data);
        const postCount = Array.isArray(data.posts) ? data.posts.length : 0;
        const storyCount = Array.isArray(data.stories) ? data.stories.length : 0;
        const highlightCount = Array.isArray(data.highlights) ? data.highlights.length : 0;
        log(`Fetch complete. Posts: ${postCount}, Stories: ${storyCount}, Highlights: ${highlightCount}. Account: ${data.is_private ? 'PRIVATE' : 'PUBLIC'}, Followed: ${data.followed_by_viewer ? 'YES' : 'NO'}`);
      }
    } catch (e) {
      log(`Parse error: ${stdout}`);
    }
  });
});

// IPC: Bulk Download
ipcMain.on('bulk-download', async (event, { type, username, cookies }) => {
  const log = (msg) => event.reply('status-update', msg);
  log(`Starting Instaloader bulk download for ${type}...`);

  execFile(pythonExe, [bridgePath, 'download', username, cookies, type], (error, stdout, stderr) => {
    if (error) {
      log(`Download error: ${error.message}`);
      return;
    }
    try {
      const data = JSON.parse(stdout);
      if (data.error) {
        log(`Instaloader error: ${data.error}`);
      } else {
        log(`Download finished: ${type}`);
      }
    } catch (e) {
      log(`Finished. Logs: ${stdout}`);
    }
  });
});

ipcMain.handle('load-preview-image', async (event, { url, cookies }) => {
  if (!url) return null;

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: getHeaders(cookies || ''),
      timeout: 20000,
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const encoded = Buffer.from(response.data).toString('base64');
    return `data:${contentType};base64,${encoded}`;
  } catch (error) {
    return null;
  }
});

ipcMain.handle('download-preview-media', async (event, { url, cookies, filenameBase, forcedExtension, targetUsername, folderType }) => {
  if (!url) return { ok: false, error: 'Missing media URL' };

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: getHeaders(cookies || ''),
      timeout: 60000,
    });

    const contentType = response.headers['content-type'] || '';
    const extension = forcedExtension || extensionFromContentType(contentType) || extensionFromUrl(url) || 'bin';
    const safeBase = sanitizeFilename(filenameBase || `instagram-${Date.now()}`);
    const safeTarget = sanitizeFilename(targetUsername || 'unknown-target');
    const safeFolderType = folderType === 'video' ? 'video' : 'gambar';
    const outputDir = path.join(writableBase, 'downloads', safeTarget, safeFolderType);
    await fs.ensureDir(outputDir);

    const outputPath = await getAvailablePath(outputDir, `${safeBase}.${extension}`);
    await fs.writeFile(outputPath, Buffer.from(response.data));
    return { ok: true, path: outputPath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('read-saved-data', async () => {
  await fs.ensureDir(dataDir);
  await ensureJsonArrayFile(targetsPath);
  await ensureJsonArrayFile(cookiesPath);
  return {
    targets: await readJsonArray(targetsPath),
    cookies: await readJsonArray(cookiesPath),
  };
});

ipcMain.handle('save-saved-data', async (event, { type, items }) => {
  await fs.ensureDir(dataDir);
  const filePath = type === 'targets' ? targetsPath : cookiesPath;
  await fs.writeJson(filePath, Array.isArray(items) ? items : [], { spaces: 2 });
  return { ok: true };
});


function getHeaders(cookies) {
  const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': cookies,
    'X-Ig-App-Id': '936619743392459',
    'X-Csrftoken': csrfMatch ? csrfMatch[1] : '',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Asbd-Id': '129477',
    'Accept': '*/*',
    'Referer': 'https://www.instagram.com/',
  };
}

function extensionFromContentType(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('quicktime')) return 'mov';
  return '';
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace('.', '').toLowerCase();
    return ext && ext.length <= 5 ? ext : '';
  } catch (error) {
    return '';
  }
}

function sanitizeFilename(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 140) || `instagram-${Date.now()}`;
}

async function getAvailablePath(directory, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(directory, filename);
  let index = 1;

  while (await fs.pathExists(candidate)) {
    candidate = path.join(directory, `${base}-${index}${ext}`);
    index += 1;
  }

  return candidate;
}

async function readJsonArray(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return [];
    const data = await fs.readJson(filePath);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

async function ensureJsonArrayFile(filePath) {
  if (!(await fs.pathExists(filePath))) {
    await fs.writeJson(filePath, [], { spaces: 2 });
  }
}

async function downloadFile(url, dest) {
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}
