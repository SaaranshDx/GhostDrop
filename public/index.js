let tries = 0;
let BASE = '';
let selectedFile = null;
let expiryTimer = null;
let pageTransitionTimer = null;
let currentPageId = null;
let pendingPageId = null;
let sidebarDragState = null;
let sidebarSettleCleanup = null;
let sidebarMotionIdleTimer = null;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const PAGE_IDS = ['main', 'client', 'api', 'changelog', 'tos', 'privacy'];
const PAGE_TRANSITION_MS = 220;
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const SIDEBAR_SETTLE_VELOCITY_THRESHOLD = 0.55;
const mobileNavQuery = window.matchMedia('(max-width: 600px)');
const DEBUG_UI_ENABLED = window.GHOSTDROP_DEBUG_UI === true;
// app or browser check
const isApp =
  navigator.userAgent.toLowerCase().includes("median");
  
function logFrontend(eventName, detail) {
  if (!DEBUG_UI_ENABLED) {
    return;
  }

  if (detail === undefined) {
    console.info('[frontend]', eventName);
    return;
  }

  console.info('[frontend]', eventName, detail);
}


async function getApiUrl() {
  const apiUrlProvider = "https://raw.githubusercontent.com/SaaranshDx/GhostDrop/main/serverurl";
  logFrontend('api-url:request', { source: apiUrlProvider });

  const res = await fetch(apiUrlProvider);

  if (!res.ok) {
    logFrontend('api-url:failed', { status: res.status, statusText: res.statusText });
    throw new Error("failed to fetch");
  }

  const url = await res.text();
  logFrontend('api-url:ready', { url: url.trim() });
  return url.trim();
}

function setSelectedFile(file) {
  const pill = document.getElementById('filePill');
  const uploadBtn = document.getElementById('uploadBtn');

  if (!pill || !uploadBtn) {
    return;
  }

  if (!file) {
    selectedFile = null;
    pill.style.display = 'none';
    pill.textContent = '';
    uploadBtn.disabled = true;
    logFrontend('file:cleared');
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    selectedFile = null;
    pill.style.display = 'none';
    pill.textContent = '';
    uploadBtn.disabled = true;
    toast('file too large (max 100MB)', true);
    logFrontend('file:rejected', { name: file.name, size: file.size, reason: 'too-large' });
    return;
  }

  selectedFile = file;

  pill.style.display = 'block';
  pill.textContent = file.name + '  ·  ' + fmtBytes(file.size);
  uploadBtn.disabled = false;
  logFrontend('file:selected', { name: file.name, size: file.size, type: file.type || 'unknown' });
}

function normalizePageId(id) {
  return PAGE_IDS.includes(id) ? id : 'main';
}

function getPageDirection(fromId, toId) {
  if (!PAGE_IDS.includes(fromId) || !PAGE_IDS.includes(toId)) {
    return 'page-forward';
  }

  return PAGE_IDS.indexOf(toId) >= PAGE_IDS.indexOf(fromId) ? 'page-forward' : 'page-backward';
}

function setActiveSidebarLink(id, animate = true) {
  document.querySelectorAll('.sidebar a').forEach((link) => link.classList.remove('active'));
  const link = document.getElementById('snav-' + id);
  if (link) {
    link.classList.add('active');
  }
  moveSidebarIndicator(link, animate && !isMobileNavLayout());
}

function moveSidebarIndicator(link, animate = true) {
  const indicator = document.getElementById('sidebarIndicator');
  const sidebar = document.querySelector('.sidebar');
  if (!indicator || !sidebar || !link) {
    return;
  }

  const inset = isMobileNavLayout() ? 2 : 0;
  indicator.classList.toggle('no-animate', !animate);
  indicator.style.width = Math.max(0, link.offsetWidth - (inset * 2)) + 'px';
  indicator.style.height = Math.max(0, link.offsetHeight - (inset * 2)) + 'px';
  indicator.style.transform = 'translate3d(' + (link.offsetLeft + inset) + 'px, ' + (link.offsetTop + inset) + 'px, 0)';
  indicator.style.opacity = '1';
}

function clampSidebarPosition(left, top, width, height) {
  const margin = 12;
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - width - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - height - margin)),
  };
}

function setSidebarPosition(left, top) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  const bounds = clampSidebarPosition(left, top, sidebar.offsetWidth, sidebar.offsetHeight);
  sidebar.style.left = bounds.left + 'px';
  sidebar.style.top = bounds.top + 'px';
  sidebar.style.transform = 'none';
  sidebar.dataset.dragged = 'true';
}

function triggerSidebarSettle(velocityX) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || reduceMotionQuery.matches) {
    return;
  }

  const speed = Math.abs(velocityX);
  if (speed < SIDEBAR_SETTLE_VELOCITY_THRESHOLD) {
    return;
  }

  if (sidebarSettleCleanup) {
    sidebar.removeEventListener('animationend', sidebarSettleCleanup);
    sidebarSettleCleanup = null;
  }

  const direction = velocityX > 0 ? 1 : -1;
  const settleAngle = Math.min(8, Math.max(3.4, speed * 5.5));

  sidebar.classList.remove('is-settling');
  sidebar.style.setProperty('--sidebar-settle-angle', settleAngle + 'deg');
  sidebar.style.setProperty('--sidebar-settle-direction', String(direction));
  void sidebar.offsetWidth;
  sidebar.classList.add('is-settling');

  sidebarSettleCleanup = () => {
    sidebar.classList.remove('is-settling');
    sidebar.style.removeProperty('--sidebar-settle-angle');
    sidebar.style.removeProperty('--sidebar-settle-direction');
    sidebar.removeEventListener('animationend', sidebarSettleCleanup);
    sidebarSettleCleanup = null;
  };

  sidebar.addEventListener('animationend', sidebarSettleCleanup);
}

function setSidebarMotionActive(active) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  sidebar.classList.toggle('is-drag-moving', active);
}

function setSidebarIdleActive(active) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  sidebar.classList.toggle('is-drag-idle', active);
}

function setSidebarDragDirection(direction) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  sidebar.dataset.dragDirection = direction > 0 ? 'right' : 'left';
}

function isMobileNavLayout() {
  return mobileNavQuery.matches;
}

function resetSidebarForMobile() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  sidebarDragState = null;
  if (sidebarMotionIdleTimer) {
    clearTimeout(sidebarMotionIdleTimer);
    sidebarMotionIdleTimer = null;
  }
  if (sidebarSettleCleanup) {
    sidebar.removeEventListener('animationend', sidebarSettleCleanup);
    sidebarSettleCleanup = null;
  }

  sidebar.classList.remove('is-dragging', 'is-drag-moving', 'is-drag-idle', 'is-settling');
  sidebar.style.removeProperty('left');
  sidebar.style.removeProperty('top');
  sidebar.style.removeProperty('transform');
  sidebar.style.removeProperty('--sidebar-settle-angle');
  sidebar.style.removeProperty('--sidebar-settle-direction');
  delete sidebar.dataset.dragged;
}

function setupSidebarDrag() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('sidebarDragHandle');
  if (!sidebar || !handle) {
    return;
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isMobileNavLayout()) {
      return;
    }

    const rect = sidebar.getBoundingClientRect();
    sidebarDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityX: 0,
      directionX: 1,
    };

    if (sidebarSettleCleanup) {
      sidebar.removeEventListener('animationend', sidebarSettleCleanup);
      sidebarSettleCleanup = null;
    }

    sidebar.classList.remove('is-settling');
    sidebar.style.removeProperty('--sidebar-settle-angle');
    sidebar.style.removeProperty('--sidebar-settle-direction');
    sidebar.classList.add('is-dragging');
    setSidebarMotionActive(false);
    setSidebarIdleActive(false);
    setSidebarDragDirection(1);
    setSidebarPosition(rect.left, rect.top);
    logFrontend('sidebar:drag-start', { left: rect.left, top: rect.top });
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!sidebarDragState || event.pointerId !== sidebarDragState.pointerId || isMobileNavLayout()) {
      return;
    }

    const deltaX = event.clientX - sidebarDragState.lastX;
    const deltaY = event.clientY - sidebarDragState.lastY;
    const deltaTime = Math.max(1, event.timeStamp - sidebarDragState.lastTime);
    const nextVelocityX = deltaX / deltaTime;
    sidebarDragState.velocityX = (sidebarDragState.velocityX * 0.35) + (nextVelocityX * 0.65);
    sidebarDragState.lastX = event.clientX;
    sidebarDragState.lastY = event.clientY;
    sidebarDragState.lastTime = event.timeStamp;

    if (Math.abs(deltaX) > 0.2 || Math.abs(deltaY) > 0.2) {
      if (Math.abs(deltaX) > 0.2) {
        sidebarDragState.directionX = deltaX > 0 ? 1 : -1;
        setSidebarDragDirection(sidebarDragState.directionX);
      }

      setSidebarMotionActive(true);
      setSidebarIdleActive(false);
      if (sidebarMotionIdleTimer) {
        clearTimeout(sidebarMotionIdleTimer);
      }
      sidebarMotionIdleTimer = window.setTimeout(() => {
        setSidebarMotionActive(false);
        setSidebarIdleActive(true);
        sidebarMotionIdleTimer = null;
      }, 90);
    }

    setSidebarPosition(event.clientX - sidebarDragState.offsetX, event.clientY - sidebarDragState.offsetY);
  });

  function endSidebarDrag(event) {
    if (!sidebarDragState || event.pointerId !== sidebarDragState.pointerId) {
      return;
    }

    const releaseVelocityX = sidebarDragState.velocityX;
    sidebarDragState = null;
    if (sidebarMotionIdleTimer) {
      clearTimeout(sidebarMotionIdleTimer);
      sidebarMotionIdleTimer = null;
    }
    setSidebarMotionActive(false);
    setSidebarIdleActive(false);
    sidebar.classList.remove('is-dragging');
    triggerSidebarSettle(releaseVelocityX);
    logFrontend('sidebar:drag-end', { velocityX: releaseVelocityX });
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  handle.addEventListener('pointerup', endSidebarDrag);
  handle.addEventListener('pointercancel', endSidebarDrag);
}

function clearPageTransitionClasses() {
  document.querySelectorAll('.page').forEach((page) => {
    page.classList.remove('page-enter', 'page-leave', 'page-forward', 'page-backward');
  });
}

function activatePage(id, direction, animate = true) {
  const nextPage = document.getElementById('page-' + id);
  if (!nextPage) {
    return;
  }

  document.querySelectorAll('.page').forEach((page) => {
    page.classList.remove('active', 'page-enter', 'page-leave', 'page-forward', 'page-backward');
  });

  nextPage.classList.add('active', direction);

  if (animate) {
    void nextPage.offsetWidth;
    nextPage.classList.add('page-enter');
  }

  currentPageId = id;
  pendingPageId = null;
  setActiveSidebarLink(id, animate);
  window.scrollTo(0, 0);
  logFrontend('page:activated', { id, direction, animate });
}

function getPageIdFromHash() {
  return normalizePageId(window.location.hash.replace(/^#/, ''));
}

function showPage(id, options = {}) {
  const { updateHash = true, immediate = false } = options;
  const nextId = normalizePageId(id);
  const nextPage = document.getElementById('page-' + nextId);
  const previousPageId = currentPageId;
  if (!nextPage) {
    return;
  }

  if (pageTransitionTimer) {
    clearTimeout(pageTransitionTimer);
    pageTransitionTimer = null;
  }

  clearPageTransitionClasses();

  const activePage = currentPageId ? document.getElementById('page-' + currentPageId) : document.querySelector('.page.active');
  if (currentPageId === nextId && activePage?.classList.contains('active')) {
    pendingPageId = null;
    setActiveSidebarLink(nextId, false);
    if (updateHash && window.location.hash !== '#' + nextId) {
      window.location.hash = nextId;
    }
    logFrontend('page:noop', { id: nextId });
    return;
  }

  const shouldAnimate = !immediate
    && !reduceMotionQuery.matches
    && currentPageId
    && currentPageId !== nextId
    && activePage
    && activePage.classList.contains('active');
  const direction = getPageDirection(currentPageId, nextId);

  pendingPageId = nextId;

  if (shouldAnimate) {
    activePage.classList.add('page-leave', direction);
    setActiveSidebarLink(nextId);
    pageTransitionTimer = window.setTimeout(() => {
      activatePage(nextId, direction, true);
      pageTransitionTimer = null;
    }, PAGE_TRANSITION_MS);
  } else {
    activatePage(nextId, direction, !immediate && !reduceMotionQuery.matches);
  }

  if (updateHash && window.location.hash !== '#' + nextId) {
    window.location.hash = nextId;
  }

  logFrontend('page:transition', {
    from: previousPageId,
    to: nextId,
    immediate,
    animate: shouldAnimate,
    updateHash,
  });
}

function onFileSelect() {
  const f = document.getElementById('fileInput').files[0];
  logFrontend('file:input-change', { hasFile: Boolean(f) });
  setSelectedFile(f);
}

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function fmtTime(s) {
  if (s <= 0) return 'expired';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

async function uploadFile(event) {
  event?.preventDefault();
  if (!selectedFile) {
    logFrontend('upload:skipped', { reason: 'no-file' });
    return;
  }
  if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
    const oversizedFile = selectedFile;
    toast('file too large (max 100MB)', true);
    setSelectedFile(null);
    logFrontend('upload:blocked', { reason: 'too-large', size: oversizedFile.size, name: oversizedFile.name });
    return;
  }
  if (!BASE) {
    toast('server url not ready yet', true);
    logFrontend('upload:blocked', { reason: 'base-url-missing' });
    return;
  }
  const btn = document.getElementById('uploadBtn');
  if (!btn) {
    return;
  }
  const passwordInput = document.getElementById('uploadPasswordInput');
  const password = passwordInput?.value ?? '';
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>uploading…';
  const fd = new FormData();
  fd.append('file', selectedFile);
  logFrontend('upload:start', {
    name: selectedFile.name,
    size: selectedFile.size,
    hasPassword: Boolean(password),
  });
  try {
    const res = await fetch(BASE + '/upload/', {
      method: 'POST',
      headers: {
        password,
      },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'upload failed');
    const url = 'https://link.ghostdrop.qzz.io' + '/' + data.id;
    const urlNode = document.getElementById('res-url');
    urlNode.textContent = url;
    urlNode.href = url;
    updateShareButtonVisibility();
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('fileInput').value = '';
    document.getElementById('filePill').style.display = 'none';
    document.getElementById('filePill').textContent = '';
    if (passwordInput) {
      passwordInput.value = '';
    }
    selectedFile = null;
    startExpiry(6 * 3600);
    navigator.clipboard?.writeText(url).catch(() => {});
    toast('uploaded — link copied');
    logFrontend('upload:success', {
      id: data.id,
      status: res.status,
      originalName: data.original_name,
      expiresInHours: data.expires_in_hours,
    });

    if (res.status === 400) {
      tries += 1;
      logFrontend('upload:retry-requested', { tries });
      reupload();
    }

    if (res.status === 413) {
      toast('file too large (max 100MB)', true);
      logFrontend('upload:server-rejected', { status: res.status });
    }

  } catch(e) {
    toast('error: ' + e.message, true);
    logFrontend('upload:error', { message: e.message });
  } finally {
    btn.disabled = !selectedFile;
    btn.textContent = 'upload';
    logFrontend('upload:complete', { pendingFile: Boolean(selectedFile) });
  }
}

async function reupload() {
  if (tries >= 3) {
    toast('upload failed after multiple attempts', true);
    tries = 0;
    logFrontend('upload:retry-aborted');
    return;
  }

  logFrontend('upload:retry', { tries });
  await uploadFile();

}

async function removeFile(id, password) {
  logFrontend('delete:start', { id, hasPassword: Boolean(password) });
  try {
    const res = await fetch(BASE + '/delete/' + id, {
      method: 'DELETE',
      headers: {
        'password': String(password)
      }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Delete failed');
    }

    toast('File deleted');
    logFrontend('delete:success', { id });
  } catch (e) {
    toast('error: ' + e.message, true);
    logFrontend('delete:error', { id, message: e.message });
  }
}

function startExpiry(total) {
  if (expiryTimer) clearInterval(expiryTimer);
  let rem = total;
  const fill = document.getElementById('expiryFill');
  const lbl = document.getElementById('expiryTime');
  if (!fill || !lbl) {
    return;
  }
  fill.style.width = '100%';
  lbl.textContent = fmtTime(rem);
  logFrontend('expiry:start', { totalSeconds: total });
  expiryTimer = setInterval(() => {
    rem--;
    fill.style.width = Math.max(0, rem / total * 100) + '%';
    lbl.textContent = fmtTime(rem);
    if (rem <= 0) {
      clearInterval(expiryTimer);
      logFrontend('expiry:ended');
    }
  }, 1000);
}

function copyLink(event, btn) {
  event?.preventDefault();
  const text = document.getElementById('res-url').href;
  logFrontend('clipboard:copy-link', { text });
  navigator.clipboard?.writeText(text).then(() => {
    btn.textContent = 'copied'; setTimeout(() => btn.textContent = 'copy', 1400);
    logFrontend('clipboard:copy-link-success');
  });
}

function getGoNativeShare() {
  return window.gonative?.share?.sharePage || window.median?.share?.sharePage || null;
}

function isMobileShareEnvironment() {
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function canShareFile() {
  return Boolean(getGoNativeShare() || (isMobileShareEnvironment() && typeof navigator.share === 'function'));
}

function updateShareButtonVisibility() {
  const shareBtn = document.getElementById('shareBtn');
  if (!shareBtn) {
    return;
  }

  if (!canShareFile()) {
    shareBtn.style.display = 'none';
    shareBtn.disabled = true;
    return;
  }

  shareBtn.style.display = '';
  shareBtn.disabled = !document.getElementById('res-url')?.href;
  logFrontend('share:button-state', {
    visible: true,
    disabled: shareBtn.disabled,
  });
}

async function shareFile(url) {
  if (!url) {
    console.info('share skipped: missing file url');
    return;
  }

  const goNativeShare = getGoNativeShare();
  if (goNativeShare) {
    try {
      logFrontend('share:native-start', { provider: 'gonative', url });
      goNativeShare({
        url,
        text: "Here’s your file",
      });
      logFrontend('share:native-success', { provider: 'gonative' });
    } catch (error) {
      console.info('GoNative share failed', error);
      logFrontend('share:native-failed', { provider: 'gonative', message: error.message });
    }
    return;
  }

  if (typeof navigator.share === 'function') {
    try {
      logFrontend('share:native-start', { provider: 'web-share', url });
      await navigator.share({
        title: 'GhostDrop file',
        text: "Here’s your file",
        url,
      });
      logFrontend('share:native-success', { provider: 'web-share' });
    } catch (error) {
      console.info('share cancelled or failed', error);
      logFrontend('share:native-failed', { provider: 'web-share', message: error.message });
    }
    return;
  }

  updateShareButtonVisibility();
  console.info('share unavailable: button hidden');
}

function cc(btn) {
  const txt = btn.parentElement.innerText.replace(/^copy\n/, '').trim();
  navigator.clipboard?.writeText(txt).then(() => {
    btn.textContent = 'copied'; setTimeout(() => btn.textContent = 'copy', 1400);
  });
}

function toggleEp(head) {
  const body = head.nextElementSibling;
  const chev = head.querySelector('.chev');
  const open = !body.classList.contains('open');
  logFrontend('accordion:toggle', {
    path: head.querySelector('.ep-path')?.textContent?.trim() || 'unknown',
    open,
  });

  if (body._epTransitionCleanup) {
    body.removeEventListener('transitionend', body._epTransitionCleanup);
    body._epTransitionCleanup = null;
  }

  if (reduceMotionQuery.matches) {
    body.classList.toggle('open', open);
    body.style.height = open ? 'auto' : '0px';
  } else if (open) {
    body.style.height = '0px';
    body.classList.add('open');
    void body.offsetHeight;
    body.style.height = body.scrollHeight + 'px';

    body._epTransitionCleanup = (event) => {
      if (event.propertyName !== 'height') {
        return;
      }

      body.style.height = 'auto';
      body.removeEventListener('transitionend', body._epTransitionCleanup);
      body._epTransitionCleanup = null;
    };
    body.addEventListener('transitionend', body._epTransitionCleanup);
  } else {
    body.style.height = body.scrollHeight + 'px';
    void body.offsetHeight;
    body.classList.remove('open');
    body.style.height = '0px';

    body._epTransitionCleanup = (event) => {
      if (event.propertyName !== 'height') {
        return;
      }

      body.removeEventListener('transitionend', body._epTransitionCleanup);
      body._epTransitionCleanup = null;
    };
    body.addEventListener('transitionend', body._epTransitionCleanup);
  }

  head.classList.toggle('open', open);
  chev.classList.toggle('open', open);
}

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  if (!t) {
    return;
  }
  logFrontend('toast', { message: msg, error: err });
  t.textContent = msg;
  t.style.borderColor = err ? 'rgba(255,92,92,0.2)' : 'rgba(255,255,255,0.1)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function initializePage() {
  logFrontend('init:start');
  currentPageId = normalizePageId(document.querySelector('.page.active')?.id?.replace('page-', ''));
  showPage(getPageIdFromHash(), { updateHash: false, immediate: true });
  setupSidebarDrag();
  if (isMobileNavLayout()) {
    resetSidebarForMobile();
  }

  updateShareButtonVisibility();

  document.querySelectorAll('[data-copy-link="true"]').forEach((btn) => {
    btn.addEventListener('click', (event) => copyLink(event, btn));
  });

  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const url = document.getElementById('res-url')?.href;
      shareFile(url);
    });
  }

  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadFile);
  }

  const dz = document.getElementById('dropZone');
  if (dz) {
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      logFrontend('dropzone:drop', { hasFile: Boolean(f) });
      setSelectedFile(f);
    });
  }

  try {
    BASE = await getApiUrl();
    logFrontend('init:base-ready', { base: BASE });
  } catch (error) {
    toast('failed to load server url', true);
    console.error(error);
    logFrontend('init:base-failed', { message: error.message });
  }

  logFrontend('init:complete');
}

initializePage();

window.addEventListener('hashchange', () => {
  const nextId = getPageIdFromHash();
  logFrontend('hashchange', { nextId, currentPageId, pendingPageId });
  if (nextId === currentPageId || nextId === pendingPageId) {
    return;
  }

  showPage(nextId, { updateHash: false });
});

window.addEventListener('resize', () => {
  logFrontend('resize', {
    width: window.innerWidth,
    height: window.innerHeight,
    mobileLayout: isMobileNavLayout(),
  });
  if (isMobileNavLayout()) {
    resetSidebarForMobile();
  }

  const activeId = pendingPageId || currentPageId;
  if (!activeId) {
    return;
  }

  const activeLink = document.getElementById('snav-' + activeId);
  moveSidebarIndicator(activeLink, false);

  const sidebar = document.querySelector('.sidebar');
  if (sidebar?.dataset.dragged === 'true') {
    setSidebarPosition(sidebar.offsetLeft, sidebar.offsetTop);
  }
});

window.median_library_ready = updateShareButtonVisibility;
window.gonative_library_ready = updateShareButtonVisibility;

window.showPage = showPage;
window.showpage = showPage;
window.onFileSelect = onFileSelect;
window.toggleEp = toggleEp;
window.cc = cc;
window.removeFile = removeFile;
