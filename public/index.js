let tries = 0;
let BASE = '';
let selectedFile = null;
let expiryTimer = null;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;


async function getApiUrl() {
  const apiUrlProvider = "https://raw.githubusercontent.com/SaaranshDx/GhostDrop/main/serverurl";

  const res = await fetch(apiUrlProvider);

  if (!res.ok) {
    throw new Error("failed to fetch");
  }

  const url = await res.text();
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
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    selectedFile = null;
    pill.style.display = 'none';
    pill.textContent = '';
    uploadBtn.disabled = true;
    toast('file too large (max 100MB)', true);
    return;
  }

  selectedFile = file;

  pill.style.display = 'block';
  pill.textContent = file.name + '  ·  ' + fmtBytes(file.size);
  uploadBtn.disabled = false;
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const sn = document.getElementById('snav-' + id);
  if (sn) sn.classList.add('active');
  window.scrollTo(0, 0);
}

function onFileSelect() {
  const f = document.getElementById('fileInput').files[0];
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
  if (!selectedFile) return;
  if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
    toast('file too large (max 100MB)', true);
    setSelectedFile(null);
    return;
  }
  if (!BASE) {
    toast('server url not ready yet', true);
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

    if (res.status === 400) {
      tries += 1;
      reupload();
    }

    if (res.status === 413) {
      toast('file too large (max 100MB)', true);
    }

  } catch(e) {
    toast('error: ' + e.message, true);
  } finally {
    btn.disabled = !selectedFile;
    btn.textContent = 'upload';
  }
}

async function reupload() {
  if (tries >= 3) {
    toast('upload failed after multiple attempts', true);
    tries = 0;
    return;
  }

  await uploadFile();

}

async function removeFile(id, password) {
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
  } catch (e) {
    toast('error: ' + e.message, true);
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
  expiryTimer = setInterval(() => {
    rem--;
    fill.style.width = Math.max(0, rem / total * 100) + '%';
    lbl.textContent = fmtTime(rem);
    if (rem <= 0) clearInterval(expiryTimer);
  }, 1000);
}

function copyLink(event, btn) {
  event?.preventDefault();
  const text = document.getElementById('res-url').href;
  navigator.clipboard?.writeText(text).then(() => {
    btn.textContent = 'copied'; setTimeout(() => btn.textContent = 'copy', 1400);
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
}

async function shareFile(url) {
  if (!url) {
    console.info('share skipped: missing file url');
    return;
  }

  const goNativeShare = getGoNativeShare();
  if (goNativeShare) {
    try {
      goNativeShare({
        url,
        text: "Here’s your file",
      });
    } catch (error) {
      console.info('GoNative share failed', error);
    }
    return;
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'GhostDrop file',
        text: "Here’s your file",
        url,
      });
    } catch (error) {
      console.info('share cancelled or failed', error);
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
  const open = body.classList.toggle('open');
  chev.classList.toggle('open', open);
}

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  if (!t) {
    return;
  }
  t.textContent = msg;
  t.style.borderColor = err ? 'rgba(255,92,92,0.2)' : 'rgba(255,255,255,0.1)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

async function initializePage() {
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
      setSelectedFile(f);
    });
  }

  try {
    BASE = await getApiUrl();
  } catch (error) {
    toast('failed to load server url', true);
    console.error(error);
  }
}

initializePage();

window.median_library_ready = updateShareButtonVisibility;
window.gonative_library_ready = updateShareButtonVisibility;

window.showPage = showPage;
window.showpage = showPage;
window.onFileSelect = onFileSelect;
window.toggleEp = toggleEp;
window.cc = cc;
window.removeFile = removeFile;
