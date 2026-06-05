const { ipcRenderer } = require('electron');

const fetchBtn = document.getElementById('fetchBtn');
const cancelFetchBtn = document.getElementById('cancelFetchBtn');
const usernameInput = document.getElementById('username');
const cookiesInput = document.getElementById('cookies');
const statusDiv = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.querySelector('.progress-container');
const profileHeader = document.getElementById('profileHeader');
const profilePicWrap = document.getElementById('profilePicWrap');
const profileName = document.getElementById('profileName');
const privacyBadge = document.getElementById('privacyBadge');
const downloadProfilePicBtn = document.getElementById('downloadProfilePicBtn');
const profileSummary = document.getElementById('profileSummary');
const themeToggle = document.getElementById('themeToggle');
const targetSelect = document.getElementById('targetSelect');
const saveTargetBtn = document.getElementById('saveTargetBtn');
const deleteTargetBtn = document.getElementById('deleteTargetBtn');
const cookieSelect = document.getElementById('cookieSelect');
const cookieLabelInput = document.getElementById('cookieLabel');
const saveCookieBtn = document.getElementById('saveCookieBtn');
const deleteCookieBtn = document.getElementById('deleteCookieBtn');
const previewModal = document.getElementById('previewModal');
const previewTitle = document.getElementById('previewTitle');
const previewBody = document.getElementById('previewBody');
const previewDownload = document.getElementById('previewDownload');
const previewDownloadImage = document.getElementById('previewDownloadImage');
const previewMuteSound = document.getElementById('previewMuteSound');
const previewClose = document.getElementById('previewClose');

let fetchedData = { posts: [], highlights: [], stories: [] };
let isFetching = false;
let currentPreview = null;
let savedTargets = [];
let savedCookies = [];
const previewCache = new Map();
const legacyAccountStorageKey = 'cookieAccounts';
const previewMutedStorageKey = 'previewMuted';

initTheme();
initPreviewMute();
initSavedData();

cancelFetchBtn.addEventListener('click', () => {
  ipcRenderer.send('cancel-fetch');
  setFetching(false);
});

let privacyCheckTimeout = null;

usernameInput.addEventListener('input', () => {
  clearTimeout(privacyCheckTimeout);
  const username = usernameInput.value.trim();
  if (username.length < 3) {
    profileHeader.style.display = 'none';
    return;
  }

  // Visual feedback that something is happening
  profileHeader.style.display = 'grid';
  profileName.innerText = username;
  privacyBadge.innerText = 'Checking...';
  privacyBadge.style.background = 'var(--soft)';
  privacyBadge.style.color = 'var(--primary)';
  profilePicWrap.innerHTML = '<span>...</span>';
  profileSummary.innerHTML = '';

  privacyCheckTimeout = setTimeout(() => {
    ipcRenderer.send('check-privacy', { username, cookies: getProcessedCookies() });
  }, 800);
});

ipcRenderer.on('privacy-status', (event, data) => {
  if (data.error) {
    privacyBadge.innerText = data.needs_login ? 'LOGIN REQUIRED' : 'ERROR';
    privacyBadge.style.background = 'var(--danger-soft)';
    privacyBadge.style.color = '#9a6700';
    profilePicWrap.innerHTML = '<span>No Preview</span>';
    return;
  }
  
  profileHeader.style.display = 'grid';
  profileName.innerText = data.username || usernameInput.value.trim();
  
  privacyBadge.innerText = data.is_private ? 'PRIVATE' : 'PUBLIC';
  privacyBadge.style.background = data.is_private ? 'var(--danger-soft)' : 'var(--soft)';
  privacyBadge.style.color = data.is_private ? '#9a6700' : 'var(--primary)';

  if (data.counts) {
    renderSummary({
        is_private: data.is_private,
        followed_by_viewer: data.followed_by_viewer || false,
        posts: { length: data.counts.posts || 0 },
        stories: { length: data.counts.stories || 0 },
        highlights: { length: data.counts.highlights || 0 }
    });
  }

  if (data.profile_pic_url) {
    loadPreviewImage(profilePicWrap, data.profile_pic_url);
    downloadProfilePicBtn.onclick = () => downloadProfilePic(data.profile_pic_url, data.username);
    profilePicWrap.onclick = () => openPreview({
      url: data.profile_pic_url,
      title: `Profile Picture: ${data.username}`,
      label: 'profile-pic',
      type: 'image'
    });
  }
});

async function downloadProfilePic(url, username) {
  const filenameBase = `${username}-profile-pic-${Date.now()}`;
  downloadProfilePicBtn.disabled = true;
  downloadProfilePicBtn.innerText = 'Downloading...';
  
  try {
    const result = await ipcRenderer.invoke('download-preview-media', {
      url,
      cookies: getProcessedCookies(),
      filenameBase,
      targetUsername: username,
      folderType: 'gambar',
    });
    if (result?.ok) log(`Downloaded profile pic: ${result.path}`);
  } finally {
    downloadProfilePicBtn.disabled = false;
    downloadProfilePicBtn.innerText = 'Download Profile Picture';
  }
}

function log(message) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  statusDiv.innerText = `[${time}] ${message}`;
}

function updateProgressBar(percent) {
  progressBar.style.width = `${percent}%`;
}

function getProcessedCookies() {
  let cookies = cookiesInput.value.trim();
  try {
    const parsed = JSON.parse(cookies);
    if (Array.isArray(parsed)) {
      return parsed.map(c => `${c.name}=${c.value}`).join('; ');
    }
  } catch (e) {
    return cookies.replace(/\r?\n|\r/g, ' ');
  }
  return cookies;
}

fetchBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const cookies = getProcessedCookies();
  if (!username) return alert('Masukkan username dulu.');

  previewCache.clear();
  setFetching(true);
  updateProgressBar(0);
  progressContainer.style.display = 'block';
  setEmptyState('stories-list', 'Mengambil story...');
  setEmptyState('highlights-list', 'Mengambil highlight...');
  setEmptyState('posts-list', 'Mengambil post...');
  profileSummary.innerHTML = '';
  ipcRenderer.send('fetch-preview', { username, cookies });
});

ipcRenderer.on('fetch-progress', (event, percent) => {
  updateProgressBar(percent);
});

ipcRenderer.on('status-update', (event, message) => {
  log(message);
  if (/Fetch complete|error|failed|invalid|Parse error/i.test(message)) {
    setFetching(false);
    setTimeout(() => {
      progressContainer.style.display = 'none';
      updateProgressBar(0);
    }, 500);
  }
});

ipcRenderer.on('preview-data', (event, data) => {
  fetchedData = normalizePreviewData(data);
  renderSummary(fetchedData);
  
  profileHeader.style.display = 'grid';
  profileName.innerText = usernameInput.value.trim();
  
  privacyBadge.innerText = data.is_private ? 'PRIVATE' : 'PUBLIC';
  privacyBadge.style.background = data.is_private ? 'var(--danger-soft)' : 'var(--soft)';
  privacyBadge.style.color = data.is_private ? '#9a6700' : 'var(--primary)';

  if (data.profile_pic_url) {
    loadPreviewImage(profilePicWrap, data.profile_pic_url);
    downloadProfilePicBtn.onclick = () => downloadProfilePic(data.profile_pic_url, usernameInput.value.trim());
    profilePicWrap.onclick = () => openPreview({
      url: data.profile_pic_url,
      title: `Profile Picture: ${usernameInput.value.trim()}`,
      label: 'profile-pic',
      type: 'image'
    });
  }

  renderList('stories-list', fetchedData.stories, 'Story');
  renderList('highlights-list', fetchedData.highlights, 'Highlight');
  renderList('posts-list', fetchedData.posts, 'Post');
  setFetching(false);
});

function renderList(elementId, items, label) {
  const list = document.getElementById(elementId);
  list.innerHTML = '';
  if (items.length === 0) {
    setEmptyState(elementId, `${label} tidak ditemukan atau tidak bisa diakses dengan cookies ini.`);
    return;
  }

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'media-item';
    const thumb = item.url || item.cover || '';
    const slides = normalizeSlides(item);
    const previewUrl = slides[0]?.videoUrl || slides[0]?.url || item.videoUrl || item.url || item.cover || '';
    const id = String(item.id || item.shortcode || 'unknown');
    const title = item.title ? escapeHtml(item.title) : label;
    const badge = slides.length > 1 ? `${slides.length} slides` : (item.type === 'video' ? 'Video' : 'Image');

    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `Open ${label} preview`);
    div.innerHTML = `
      <div class="thumb-wrap">
        ${thumb ? '<span>Loading</span>' : '<span>No image</span>'}
      </div>
      <div class="media-info">
        <strong>${title}</strong>
        <span>${badge} &middot; ${escapeHtml(id.substring(0, 18))}${id.length > 18 ? '...' : ''}</span>
      </div>
      <div class="item-actions">
        <button class="item-download-btn" type="button">${getItemDownloadButtonLabel(slides, 'media')}</button>
        <button class="item-download-btn secondary" type="button">${getItemDownloadButtonLabel(slides, 'image')}</button>
      </div>
    `;

    div.addEventListener('click', () => openPreview({ ...item, label, title, previewUrl, slides }));
    div.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPreview({ ...item, label, title, previewUrl, slides });
      }
    });

    const [downloadBtn, downloadImageBtn] = div.querySelectorAll('.item-download-btn');
    downloadBtn.disabled = slides.length === 0;
    downloadImageBtn.disabled = !slides.some(slide => slide.url);
    downloadBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadItemSlides({ ...item, label, title, previewUrl, slides }, downloadBtn, 'media');
    });
    downloadImageBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadItemSlides({ ...item, label, title, previewUrl, slides }, downloadImageBtn, 'image');
    });

    list.appendChild(div);

    if (thumb) {
      loadPreviewImage(div.querySelector('.thumb-wrap'), thumb);
    }
  });
}

window.bulkDownload = (type) => {
  const username = usernameInput.value.trim();
  const cookies = getProcessedCookies();
  const items = fetchedData[type];
  if (!items || items.length === 0) return alert('Tidak ada item untuk di-download.');
  ipcRenderer.send('bulk-download', { type, items, username, cookies });
};

function getItemDownloadButtonLabel(slides, mode) {
  if (mode === 'image') return slides.length > 1 ? `Image ${slides.length}` : 'Image';
  return slides.length > 1 ? `Download ${slides.length}` : 'Download';
}

async function downloadItemSlides(item, button, mode = 'media') {
  const slides = normalizeSlides(item);
  if (slides.length === 0) return alert('Media tidak tersedia untuk di-download.');

  const username = usernameInput.value.trim() || 'instagram';
  const cookies = getProcessedCookies();
  const label = item.label || 'media';
  const mediaId = item.shortcode || item.id || Date.now();
  const originalText = button.innerText;
  let successCount = 0;
  let lastError = '';

  button.disabled = true;
  button.innerText = 'Downloading...';

  try {
    for (const [index, slide] of slides.entries()) {
      const isVideo = slide.type === 'video' && slide.videoUrl;
      const sourceUrl = mode === 'image' ? slide.url : (slide.videoUrl || slide.url);
      if (!sourceUrl) continue;

      button.innerText = `${index + 1}/${slides.length}`;
      const suffix = mode === 'image' ? 'image' : (isVideo ? 'video' : 'image');
      const filenameBase = `${username}-${label}-${mediaId}-slide-${index + 1}-${suffix}`;
      const result = await ipcRenderer.invoke('download-preview-media', {
        url: sourceUrl,
        cookies,
        filenameBase,
        forcedExtension: '',
        targetUsername: username,
        folderType: mode === 'media' && isVideo ? 'video' : 'gambar',
      });

      if (result?.ok) {
        successCount += 1;
      } else {
        lastError = result?.error || 'unknown error';
      }
    }

    if (successCount === 0) {
      alert(`Download gagal: ${lastError || 'media tidak tersedia'}`);
      return;
    }

    log(`Downloaded ${successCount}/${slides.length} media dari ${label} ${mediaId}.`);
    if (successCount < slides.length) {
      alert(`Sebagian media gagal di-download (${successCount}/${slides.length}). Error terakhir: ${lastError}`);
    }
  } finally {
    button.disabled = mode === 'image' ? !slides.some(slide => slide.url) : slides.length === 0;
    button.innerText = originalText;
  }
}

document.getElementById('bulkAllBtn').addEventListener('click', () => {
  ['stories', 'highlights', 'posts'].forEach(type => window.bulkDownload(type));
});

saveTargetBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) return alert('Masukkan target username dulu.');

  const targets = getSavedTargets();
  const existingIndex = targets.findIndex(target => target.username.toLowerCase() === username.toLowerCase());
  const target = {
    id: existingIndex >= 0 ? targets[existingIndex].id : `${Date.now()}`,
    username,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    targets[existingIndex] = target;
  } else {
    targets.push(target);
  }

  await saveTargets(targets);
  renderSavedTargets(target.id);
  log(`Saved target: ${username}.`);
});

targetSelect.addEventListener('change', () => {
  const target = getSavedTargets().find(item => item.id === targetSelect.value);
  if (!target) return;

  usernameInput.value = target.username;
  log(`Switched target: ${target.username}.`);
});

deleteTargetBtn.addEventListener('click', async () => {
  const selectedId = targetSelect.value;
  if (!selectedId) return alert('Pilih target yang mau dihapus.');

  const target = getSavedTargets().find(item => item.id === selectedId);
  const targets = getSavedTargets().filter(item => item.id !== selectedId);
  await saveTargets(targets);
  renderSavedTargets();
  log(`Deleted target${target ? `: ${target.username}` : ''}.`);
});

saveCookieBtn.addEventListener('click', async () => {
  const cookies = cookiesInput.value.trim();
  if (!cookies) return alert('Masukkan cookies dulu.');

  const label = cookieLabelInput.value.trim() || `Cookies ${new Date().toLocaleString()}`;
  const accounts = getSavedCookies();
  const existingIndex = accounts.findIndex(account => account.label.toLowerCase() === label.toLowerCase());
  const account = {
    id: existingIndex >= 0 ? accounts[existingIndex].id : `${Date.now()}`,
    label,
    cookies,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    accounts[existingIndex] = account;
  } else {
    accounts.push(account);
  }

  await saveCookies(accounts);
  renderSavedCookies(account.id);
  log(`Saved cookies: ${label}.`);
});

cookieSelect.addEventListener('change', () => {
  const account = getSavedCookies().find(item => item.id === cookieSelect.value);
  if (!account) return;

  cookiesInput.value = account.cookies;
  cookieLabelInput.value = account.label;
  previewCache.clear();
  log(`Switched cookies: ${account.label}.`);
});

deleteCookieBtn.addEventListener('click', async () => {
  const selectedId = cookieSelect.value;
  if (!selectedId) return alert('Pilih cookies yang mau dihapus.');

  const account = getSavedCookies().find(item => item.id === selectedId);
  const accounts = getSavedCookies().filter(item => item.id !== selectedId);
  await saveCookies(accounts);
  renderSavedCookies();
  log(`Deleted cookies${account ? `: ${account.label}` : ''}.`);
});

themeToggle.addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(nextTheme);
  localStorage.setItem('theme', nextTheme);
});

previewClose.addEventListener('click', closePreview);
previewDownload.addEventListener('click', () => downloadCurrentPreview('media'));
previewDownloadImage.addEventListener('click', () => downloadCurrentPreview('image'));
previewMuteSound.addEventListener('change', () => {
  localStorage.setItem(previewMutedStorageKey, previewMuteSound.checked ? 'true' : 'false');
  const video = previewBody.querySelector('video');
  if (video) video.muted = previewMuteSound.checked;
});

previewModal.addEventListener('click', (event) => {
  if (event.target === previewModal) {
    closePreview();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && previewModal.classList.contains('open')) {
    closePreview();
  }
  if (event.key === 'ArrowLeft' && previewModal.classList.contains('open')) {
    showPreviewSlide((currentPreview?.index || 0) - 1);
  }
  if (event.key === 'ArrowRight' && previewModal.classList.contains('open')) {
    showPreviewSlide((currentPreview?.index || 0) + 1);
  }
});

function normalizePreviewData(data) {
  return {
    ...data,
    posts: Array.isArray(data.posts) ? data.posts : [],
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    stories: Array.isArray(data.stories) ? data.stories : [],
  };
}

async function initSavedData() {
  try {
    const data = await ipcRenderer.invoke('read-saved-data');
    savedTargets = Array.isArray(data.targets) ? data.targets : [];
    savedCookies = Array.isArray(data.cookies) ? data.cookies : [];
    await migrateLegacyAccounts();
  } catch (error) {
    savedTargets = [];
    savedCookies = [];
  }

  renderSavedTargets();
  renderSavedCookies();
}

async function migrateLegacyAccounts() {
  const legacy = localStorage.getItem(legacyAccountStorageKey);
  if (!legacy || localStorage.getItem(`${legacyAccountStorageKey}:migrated`)) return;

  try {
    const accounts = JSON.parse(legacy);
    if (!Array.isArray(accounts)) return;

    accounts.forEach(account => {
      if (account.username && !savedTargets.some(target => target.username.toLowerCase() === account.username.toLowerCase())) {
        savedTargets.push({
          id: `legacy-target-${account.id || Date.now()}-${savedTargets.length}`,
          username: account.username,
          updatedAt: account.updatedAt || new Date().toISOString(),
        });
      }

      if (account.cookies && !savedCookies.some(cookie => cookie.label.toLowerCase() === account.username.toLowerCase())) {
        savedCookies.push({
          id: `legacy-cookie-${account.id || Date.now()}-${savedCookies.length}`,
          label: account.username || 'Imported cookies',
          cookies: account.cookies,
          updatedAt: account.updatedAt || new Date().toISOString(),
        });
      }
    });

    await saveTargets(savedTargets);
    await saveCookies(savedCookies);
    localStorage.setItem(`${legacyAccountStorageKey}:migrated`, 'true');
  } catch (error) {
    localStorage.setItem(`${legacyAccountStorageKey}:migrated`, 'true');
  }
}

function getSavedTargets() {
  return Array.isArray(savedTargets) ? [...savedTargets] : [];
}

async function saveTargets(targets) {
  savedTargets = Array.isArray(targets) ? targets : [];
  await ipcRenderer.invoke('save-saved-data', { type: 'targets', items: savedTargets });
}

function getSavedCookies() {
  return Array.isArray(savedCookies) ? [...savedCookies] : [];
}

async function saveCookies(accounts) {
  savedCookies = Array.isArray(accounts) ? accounts : [];
  await ipcRenderer.invoke('save-saved-data', { type: 'cookies', items: savedCookies });
}

function renderSavedTargets(selectedId = '') {
  const targets = getSavedTargets().sort((a, b) => a.username.localeCompare(b.username));
  targetSelect.innerHTML = '';

  if (targets.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.innerText = 'No saved targets';
    targetSelect.appendChild(option);
    targetSelect.disabled = true;
    deleteTargetBtn.disabled = true;
    return;
  }

  targetSelect.disabled = false;
  deleteTargetBtn.disabled = false;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.innerText = 'Select target';
  targetSelect.appendChild(placeholder);

  targets.forEach(target => {
    const option = document.createElement('option');
    option.value = target.id;
    option.innerText = target.username;
    targetSelect.appendChild(option);
  });

  targetSelect.value = selectedId || '';
}

function renderSavedCookies(selectedId = '') {
  const accounts = getSavedCookies().sort((a, b) => a.label.localeCompare(b.label));
  cookieSelect.innerHTML = '';

  if (accounts.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.innerText = 'No saved cookies';
    cookieSelect.appendChild(option);
    cookieSelect.disabled = true;
    deleteCookieBtn.disabled = true;
    return;
  }

  cookieSelect.disabled = false;
  deleteCookieBtn.disabled = false;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.innerText = 'Select cookies';
  cookieSelect.appendChild(placeholder);

  accounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.innerText = account.label;
    cookieSelect.appendChild(option);
  });

  cookieSelect.value = selectedId || '';
}

function renderSummary(data) {
  const privacy = data.is_private ? 'Private' : 'Public';
  const followed = data.followed_by_viewer ? 'Following' : 'Not following';
  profileSummary.innerHTML = `
    <div><strong>${data.posts.length}</strong><span>Posts</span></div>
    <div><strong>${data.stories.length}</strong><span>Stories</span></div>
    <div><strong>${data.highlights.length}</strong><span>Highlights</span></div>
    <div><strong>${privacy}</strong><span>${followed}</span></div>
  `;
}

function setFetching(value) {
  isFetching = value;
  fetchBtn.disabled = value;
  fetchBtn.style.display = value ? 'none' : 'block';
  cancelFetchBtn.style.display = value ? 'block' : 'none';
  if (!value) {
    progressContainer.style.display = 'none';
  }
}

function setEmptyState(elementId, message) {
  const list = document.getElementById(elementId);
  list.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

async function loadPreviewImage(container, url) {
  try {
    const dataUrl = await loadMediaDataUrl(url);
    if (!dataUrl) {
      container.innerHTML = '<span>Preview blocked</span>';
      return;
    }

    const img = document.createElement('img');
    img.src = dataUrl;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      container.innerHTML = '<span>Preview blocked</span>';
    }, { once: true });
    container.innerHTML = '';
    container.appendChild(img);
  } catch (error) {
    container.innerHTML = '<span>Preview blocked</span>';
  }
}

function normalizeSlides(item) {
  if (Array.isArray(item.slides) && item.slides.length > 0) {
    return item.slides
      .map((slide, index) => ({
        id: String(slide.id || `${item.id || 'slide'}-${index}`),
        url: slide.url || slide.cover || '',
        videoUrl: slide.videoUrl || '',
        type: slide.type || (slide.videoUrl ? 'video' : 'image'),
        index,
      }))
      .filter(slide => slide.url || slide.videoUrl);
  }

  const url = item.url || item.cover || '';
  const videoUrl = item.videoUrl || '';
  if (!url && !videoUrl) return [];
  return [{
    id: String(item.id || item.shortcode || 'preview'),
    url,
    videoUrl,
    type: item.type === 'video' ? 'video' : 'image',
    index: 0,
  }];
}

async function openPreview(item) {
  const slides = normalizeSlides(item);
  const slideLabel = slides.length > 1 ? ` - ${slides.length} slides` : '';
  previewTitle.innerText = `${item.title || item.label || 'Preview'}${slideLabel}`;
  previewBody.innerHTML = '<div>Loading preview...</div>';
  previewModal.classList.add('open');
  previewModal.setAttribute('aria-hidden', 'false');

  if (slides.length === 0) {
    previewBody.innerHTML = '<div>Preview tidak tersedia.</div>';
    return;
  }

  currentPreview = { item, slides, index: 0 };
  showPreviewSlide(0);
}

async function showPreviewSlide(index) {
  if (!currentPreview) return;

  const slideCount = currentPreview.slides.length;
  const safeIndex = Math.max(0, Math.min(index, slideCount - 1));
  currentPreview.index = safeIndex;

  const slide = currentPreview.slides[safeIndex];
  const sourceUrl = slide.videoUrl || slide.url;
  previewBody.innerHTML = '<div>Loading preview...</div>';
  updatePreviewDownloadButtons();

  const dataUrl = await loadMediaDataUrl(sourceUrl);
  if (!previewModal.classList.contains('open')) return;
  if (!currentPreview || currentPreview.index !== safeIndex) return;

  if (!dataUrl) {
    previewBody.innerHTML = '<div>Preview blocked atau cookie sudah tidak valid.</div>';
    return;
  }

  const stage = document.createElement('div');
  stage.className = 'preview-stage';

  if (slide.type === 'video' && slide.videoUrl) {
    const video = document.createElement('video');
    video.src = dataUrl;
    video.controls = true;
    video.autoplay = true;
    video.muted = previewMuteSound.checked;
    video.playsInline = true;
    stage.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = currentPreview.item.title || currentPreview.item.label || 'Preview';
    stage.appendChild(img);
  }

  previewBody.innerHTML = '';
  previewBody.appendChild(stage);

  if (slideCount > 1) {
    const prev = document.createElement('button');
    prev.className = 'slide-nav prev';
    prev.type = 'button';
    prev.innerHTML = '&lsaquo;';
    prev.disabled = safeIndex === 0;
    prev.addEventListener('click', () => showPreviewSlide(safeIndex - 1));

    const next = document.createElement('button');
    next.className = 'slide-nav next';
    next.type = 'button';
    next.innerHTML = '&rsaquo;';
    next.disabled = safeIndex === slideCount - 1;
    next.addEventListener('click', () => showPreviewSlide(safeIndex + 1));

    const count = document.createElement('div');
    count.className = 'slide-count';
    count.innerText = `${safeIndex + 1} / ${slideCount}`;

    previewBody.appendChild(prev);
    previewBody.appendChild(next);
    previewBody.appendChild(count);
  }

  updatePreviewDownloadButtons();
}

function closePreview() {
  previewModal.classList.remove('open');
  previewModal.setAttribute('aria-hidden', 'true');
  previewBody.innerHTML = 'Loading preview...';
  currentPreview = null;
  updatePreviewDownloadButtons();
}

async function downloadCurrentPreview(mode) {
  if (!currentPreview) return;

  const slide = currentPreview.slides[currentPreview.index];
  if (!slide) return;

  const isVideo = slide.type === 'video' && slide.videoUrl;
  const sourceUrl = mode === 'image' ? slide.url : (slide.videoUrl || slide.url);
  if (!sourceUrl) return alert('Media tidak tersedia untuk di-download.');

  const username = usernameInput.value.trim() || 'instagram';
  const label = currentPreview.item.label || 'media';
  const mediaId = currentPreview.item.shortcode || currentPreview.item.id || slide.id || Date.now();
  const slideNumber = currentPreview.index + 1;
  const suffix = mode === 'image' && isVideo ? 'image' : (isVideo ? 'video' : 'image');
  const filenameBase = `${username}-${label}-${mediaId}-slide-${slideNumber}-${suffix}`;
  const folderType = mode === 'media' && isVideo ? 'video' : 'gambar';

  setPreviewDownloadBusy(true);
  try {
    const result = await ipcRenderer.invoke('download-preview-media', {
      url: sourceUrl,
      cookies: getProcessedCookies(),
      filenameBase,
      forcedExtension: '',
      targetUsername: username,
      folderType,
    });

    if (!result?.ok) {
      alert(`Download gagal: ${result?.error || 'unknown error'}`);
      return;
    }

    log(`Downloaded: ${result.path}`);
  } finally {
    setPreviewDownloadBusy(false);
    updatePreviewDownloadButtons();
  }
}

function updatePreviewDownloadButtons() {
  const slide = currentPreview?.slides?.[currentPreview.index];
  const isVideo = Boolean(slide?.type === 'video' && slide.videoUrl);
  const hasMedia = Boolean(slide?.videoUrl || slide?.url);
  const hasImage = Boolean(slide?.url);

  previewDownload.disabled = !hasMedia;
  previewDownload.innerText = isVideo ? 'Download Video' : 'Download Image';
  previewDownloadImage.style.display = isVideo ? '' : 'none';
  previewDownloadImage.disabled = !isVideo || !hasImage;
}

function setPreviewDownloadBusy(value) {
  previewDownload.disabled = value;
  previewDownloadImage.disabled = value;
  previewDownload.innerText = value ? 'Downloading...' : previewDownload.innerText;
}

async function loadMediaDataUrl(url) {
  if (previewCache.has(url)) {
    return previewCache.get(url);
  }

  const dataUrl = await ipcRenderer.invoke('load-preview-image', {
    url,
    cookies: getProcessedCookies(),
  });
  previewCache.set(url, dataUrl);
  return dataUrl;
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark', isDark);
  themeToggle.innerText = isDark ? 'Light mode' : 'Dark mode';
}

function initPreviewMute() {
  const saved = localStorage.getItem(previewMutedStorageKey);
  previewMuteSound.checked = saved === null ? true : saved === 'true';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
