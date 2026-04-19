document.querySelectorAll(".copy-btn").forEach(btn => {
  btn.addEventListener("click", (event) => copyLink(event, btn));
});

document.getElementById("uploadBtn")
  .addEventListener("click", uploadFile);

let tries = 0

async function getApiUrl() {
  const apiUrlProvider = "https://raw.githubusercontent.com/SaaranshDx/GhostDrop/main/serverurl";

  const res = await fetch(apiUrlProvider);

  if (!res.ok) {
    throw new Error("failed to fetch");
  }

  const url = await res.text();
  return url.trim();
}

const BASE = await getApiUrl();
let selectedFile = null, expiryTimer = null;

function setSelectedFile(file) {
  if (!file) {
    return;
  }

  selectedFile = file;
  const pill = document.getElementById('filePill');
  pill.style.display = 'block';
  pill.textContent = file.name + '  ·  ' + fmtBytes(file.size);
  document.getElementById('uploadBtn').disabled = false;
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
  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>uploading…';
  const fd = new FormData();
  fd.append('file', selectedFile);
  try {
    const res = await fetch(BASE + '/upload/', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'upload failed');
    const url = 'https://link.ghostdrop.qzz.io' + '/' + data.id;
    const urlNode = document.getElementById('res-url');
    urlNode.textContent = url;
    urlNode.href = url;
    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('fileInput').value = '';
    document.getElementById('filePill').style.display = 'none';
    document.getElementById('filePill').textContent = '';
    selectedFile = null;
    startExpiry(6 * 3600);
    navigator.clipboard?.writeText(url).catch(() => {});
    toast('uploaded — link copied');

    if (res.status === 400) {
      tries + 1;
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
  fill.style.width = '100%';
  lbl.textContent = fmtTime(rem);
  expiryTimer = setInterval(() => {
    rem--;
    fill.style.width = Math.max(0, rem / total * 100) + '%';
    lbl.textContent = fmtTime(rem);
    if (rem <= 0) clearInterval(expiryTimer);
  }, 1000);
}

async function fetchFile(event) {
  event?.preventDefault();
  const id = document.getElementById('fileIdInput').value.trim();
  const msg = document.getElementById('fetchMsg');
  if (!id) { toast('enter a file id'); return; }
  msg.style.display = 'none';
  try {
    const res = await fetch(BASE + "/" + id, { method: 'GET' });
    msg.style.display = 'block';
    if (res.ok) {
      msg.className = 'fetch-msg ok';
      msg.innerHTML = 'found — <a href="' + BASE + '/file/' + id + '" style="color:var(--green)" download>download</a>';
    } else if (res.status === 410) {
      msg.className = 'fetch-msg err'; msg.textContent = 'expired — file deleted';
    } else {
      msg.className = 'fetch-msg err'; msg.textContent = 'not found (404)';
    }
  } catch {
    msg.style.display = 'block';
    msg.className = 'fetch-msg err';
    msg.textContent = 'server unreachable';
  }
}

function copyLink(event, btn) {
  event?.preventDefault();
  const text = document.getElementById('res-url').href;
  navigator.clipboard?.writeText(text).then(() => {
    btn.textContent = 'copied'; setTimeout(() => btn.textContent = 'copy', 1400);
  });
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
  t.textContent = msg;
  t.style.borderColor = err ? 'rgba(255,92,92,0.2)' : 'rgba(255,255,255,0.1)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  setSelectedFile(f);
});

document.getElementById('fileIdInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchFile();
});

window.showPage = showPage;
window.showpage = showPage;
window.onFileSelect = onFileSelect;
window.fetchFile = fetchFile;
window.toggleEp = toggleEp;
window.cc = cc;
window.removeFile = removeFile;

