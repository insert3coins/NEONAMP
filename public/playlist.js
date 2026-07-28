'use strict';

const $ = (selector) => document.querySelector(selector);
const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const EQ_PRESETS = {
  FLAT: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'NEON (I3C)': [5, 3, 1, 0, -1, 0, 2, 4, 5, 6],
  CLASSICAL: [0, 0, 0, 0, 0, 0, -7, -7, -7, -9.5], CLUB: [0, 0, 8, 5.5, 5.5, 5.5, 3, 0, 0, 0],
  DANCE: [9.5, 7, 2.5, 0, 0, -5.5, -7, -7, 0, 0], 'FULL BASS': [-8, 9.5, 9.5, 5.5, 1.5, -4, -8, -10, -11, -11],
  'FULL BASS+TRB': [7, 5.5, 0, -7, -5, 1.5, 8, 11, 12, 12], 'FULL TREBLE': [-9.5, -9.5, -9.5, -4, 2.5, 11, 12, 12, 12, 12],
  'LAPTOP/PHONES': [5, 11, 5.5, -3, -2.5, 1.5, 5, 9.5, 12, 12], 'LARGE HALL': [10, 10, 5.5, 5.5, 0, -5, -5, -5, 0, 0],
  LIVE: [-5, 0, 4, 5.5, 5.5, 5.5, 4, 2.5, 2.5, 2.5], PARTY: [7, 7, 0, 0, 0, 0, 0, 0, 7, 7],
  POP: [-1.5, 5, 7, 8, 5.5, 0, -2.5, -2.5, -1.5, -1.5], REGGAE: [0, 0, 0, -5.5, 0, 6.5, 6.5, 0, 0, 0],
  ROCK: [8, 5, -5.5, -8, -3, 4, 9, 11, 11, 11], SKA: [-2.5, -5, -4, 0, 4, 5.5, 9, 9.5, 11, 9.5],
  SOFT: [5, 1.5, 0, -2.5, 0, 4, 8, 9.5, 11, 12], 'SOFT ROCK': [4, 4, 2.5, 0, -4, -5.5, -3, 0, 2.5, 9],
  TECHNO: [8, 5.5, 0, -5.5, -5, 0, 8, 9.5, 9.5, 9]
};
const DSP_DEFS = {
  compressor: { name: 'COMPRESSOR', min: 0, max: 1, step: .05, value: .55 },
  limiter: { name: 'LIMITER', min: 0, max: 1, step: .05, value: .75 },
  width: { name: 'STEREO WIDTH', min: 0, max: 2, step: .05, value: 1.25 },
  mono: { name: 'MONO', min: 0, max: 1, step: 1, value: 1 },
  bass: { name: 'BASS BOOST', min: 0, max: 12, step: .5, value: 6 },
  reverb: { name: 'REVERB', min: 0, max: .65, step: .05, value: .25 }
};
const DSP_PRESETS = {
  CLEAN: [], BROADCAST: [{ type: 'compressor', value: .55 }, { type: 'limiter', value: .8 }],
  'BASS CLUB': [{ type: 'bass', value: 7 }, { type: 'compressor', value: .45 }, { type: 'width', value: 1.3 }, { type: 'limiter', value: .8 }],
  'WIDE SPACE': [{ type: 'width', value: 1.55 }, { type: 'reverb', value: .3 }, { type: 'limiter', value: .7 }],
  'MONO RADIO': [{ type: 'mono', value: 1 }, { type: 'compressor', value: .65 }, { type: 'limiter', value: .85 }]
};

const els = {
  connection: $('#connection'), playlistList: $('#playlistList'), playlistCount: $('#playlistCount'),
  playlistFilter: $('#playlistFilter'), refreshPlaylists: $('#refreshPlaylists'), newPlaylist: $('#newPlaylist'), searchLibrary: $('#searchLibrary'),
  activeName: $('#activeName'), dirty: $('#dirty'), trackCount: $('#trackCount'), totalTime: $('#totalTime'),
  trackList: $('#trackList'), emptyState: $('#emptyState'), loadPlay: $('#loadPlay'), saveChanges: $('#saveChanges'),
  ytProgress: $('#ytProgress'),
  addFiles: $('#addFiles'), addStream: $('#addStream'), addYoutube: $('#addYoutube'), editTrack: $('#editTrack'), removeTrack: $('#removeTrack'),
  moveUp: $('#moveUp'), moveDown: $('#moveDown'), sortTracks: $('#sortTracks'), exportM3U: $('#exportM3U'),
  deletePlaylist: $('#deletePlaylist'),
  modal: $('#modal'), modalTitle: $('#modalTitle'), modalBody: $('#modalBody'), modalClose: $('#modalClose'), contextMenu: $('#contextMenu'), trackTable: $('.tracktable'),
  toast: $('#toast'), liveState: $('#liveState'), nowTitle: $('#nowTitle'), nowMeta: $('#nowMeta'), nowTime: $('#nowTime'),
  controlStatus: $('#controlStatus'), soundDetails: $('#soundDetails'), ctlPrev: $('#ctlPrev'), ctlPlay: $('#ctlPlay'), ctlPause: $('#ctlPause'), ctlStop: $('#ctlStop'), ctlNext: $('#ctlNext'),
  ctlVol: $('#ctlVol'), ctlVolVal: $('#ctlVolVal'), ctlBal: $('#ctlBal'), ctlBalVal: $('#ctlBalVal'),
  ctlNorm: $('#ctlNorm'), ctlShuffle: $('#ctlShuffle'), ctlRepeat: $('#ctlRepeat'), ctlXfade: $('#ctlXfade'), ctlVis: $('#ctlVis'), ctlTheme: $('#ctlTheme'),
  ctlEqOn: $('#ctlEqOn'), ctlObsEq: $('#ctlObsEq'), ctlEqPreset: $('#ctlEqPreset'), ctlEqBands: $('#ctlEqBands'),
  ctlDspPreset: $('#ctlDspPreset'), ctlDspType: $('#ctlDspType'), ctlDspAdd: $('#ctlDspAdd'), ctlDspList: $('#ctlDspList')
};

let playlists = [];
let currentName = '';
let tracks = [];
let selected = -1;
let dirty = false;
let addingPaths = false;
let ytJobs = new Map(); // videoId -> { status: 'queued'|'downloading'|'error', playlist, title, error }
let youtubeSources = []; // YouTube playlist URLs the current playlist was ever built from
let liveState = null;
let dragFrom = -1;
let toastTimer = null;
let lastPlaylistClick = '', lastPlaylistClickAt = 0;
let lastTrackClick = -1, lastTrackClickAt = 0;
const XFADE_STEPS = [0, 2, 4, 6, 8, 10];
let controlSettings = {
  volume: 80, balance: 0, shuffle: false, repeat: 'off', normalize: true, xfade: 0,
  visMode: 'bars', theme: 'NEON', obsEq: false,
  eq: { on: true, bands: new Array(10).fill(0), preset: 'FLAT' }, dsp: { modules: [] }
};
let controlTimer = null;
let pendingControl = {};

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function fmtTime(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function trackLabel(track) {
  return track?.artist ? `${track.artist} — ${track.title || 'Unknown'}` : (track?.title || 'Unknown track');
}

// Must match server.js's trackRef().key exactly, storage by storage — see
// the same function in app.js for why (loudness /ws pushes compare against
// this; a mismatched scheme means live gain updates silently never apply).
function trackKey(track) {
  if (!track) return '';
  if (track.trackKey) return track.trackKey;
  if (track.storage === 'path') return `path:${track.sourceId || ''}`;
  if (track.storage === 'youtube') return `youtube:${track.file || ''}`;
  if (track.storage === 'playlist' && track.playlist) return `playlist:${track.playlist}:${track.file || ''}`;
  if (track.storage === 'radio') return `radio:${track.stationId || track.file || ''}`;
  return track.file || '';
}

function mediaApiUrl(endpoint, track) {
  const params = new URLSearchParams({
    file: track.file,
    storage: track.storage === 'playlist' ? 'playlist' : track.storage === 'path' ? 'path' : track.storage === 'youtube' ? 'youtube' : 'library'
  });
  if (track.storage === 'playlist' && track.playlist) params.set('playlist', track.playlist);
  if (track.storage === 'path' && track.sourceId) params.set('source', track.sourceId);
  return `/api/${endpoint}?${params}`;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function openModal(title, content) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = content;
  els.modal.classList.remove('hidden');
  return els.modalBody;
}

function closeModal() { els.modal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', (event) => { if (event.target === els.modal) closeModal(); });

function closeContextMenu() {
  els.contextMenu.classList.add('hidden');
  els.contextMenu.innerHTML = '';
}

function showContextMenu(x, y, label, items) {
  closeContextMenu();
  const heading = document.createElement('div');
  heading.className = 'ctxlabel';
  heading.textContent = label;
  els.contextMenu.appendChild(heading);
  for (const item of items) {
    if (!item) {
      const separator = document.createElement('div');
      separator.className = 'ctxsep';
      separator.setAttribute('role', 'separator');
      els.contextMenu.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    button.disabled = !!item.disabled;
    button.classList.toggle('danger', !!item.danger);
    button.innerHTML = '<span class="ctxicon"></span><span class="ctxtext"></span><span class="ctxhint"></span>';
    button.querySelector('.ctxicon').textContent = item.icon || '›';
    button.querySelector('.ctxtext').textContent = item.label;
    button.querySelector('.ctxhint').textContent = item.hint || '';
    button.addEventListener('click', () => {
      if (button.disabled) return;
      closeContextMenu();
      Promise.resolve(item.action?.()).catch((error) => toast(error.message || 'ACTION FAILED', true));
    });
    els.contextMenu.appendChild(button);
  }
  els.contextMenu.style.left = '0px';
  els.contextMenu.style.top = '0px';
  els.contextMenu.classList.remove('hidden');
  const rect = els.contextMenu.getBoundingClientRect();
  els.contextMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  els.contextMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  els.contextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

els.contextMenu.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('pointerdown', (event) => { if (!els.contextMenu.contains(event.target)) closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
document.addEventListener('scroll', closeContextMenu, true);
els.contextMenu.addEventListener('keydown', (event) => {
  const buttons = [...els.contextMenu.querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeContextMenu();
  }
});

function setDirty(value = true) {
  dirty = value;
  els.dirty.classList.toggle('hidden', !dirty);
  els.saveChanges.disabled = !currentName || !dirty;
}

function currentLivePlaylist() {
  return liveState?.queueName || liveState?.playlist || '';
}

function setControls() {
  const hasPlaylist = !!currentName;
  const hasSelection = hasPlaylist && selected >= 0 && !!tracks[selected];
  els.loadPlay.disabled = !hasPlaylist || !tracks.length;
  els.addFiles.disabled = !hasPlaylist || addingPaths;
  els.addStream.disabled = !hasPlaylist;
  els.addYoutube.disabled = !hasPlaylist;
  els.deletePlaylist.disabled = !hasPlaylist;
  els.sortTracks.disabled = !hasPlaylist || tracks.length < 2;
  els.exportM3U.disabled = !hasPlaylist || !tracks.length;
  els.editTrack.disabled = !hasSelection || tracks[selected]?.storage === 'radio';
  els.removeTrack.disabled = !hasSelection;
  els.moveUp.disabled = !hasSelection || selected <= 0;
  els.moveDown.disabled = !hasSelection || selected >= tracks.length - 1;
  els.saveChanges.disabled = !hasPlaylist || !dirty;
}

function renderPlaylists() {
  const query = els.playlistFilter.value.trim().toLowerCase();
  const view = playlists.filter((playlist) => !query || playlist.name.toLowerCase().includes(query));
  els.playlistList.innerHTML = '';
  for (const playlist of view) {
    const item = document.createElement('li');
    item.classList.toggle('active', playlist.name === currentName);
    item.innerHTML = '<strong></strong><small></small><small class="date"></small>';
    item.querySelector('strong').textContent = playlist.name;
    item.querySelector('small').textContent = `${playlist.tracks} TRACK${playlist.tracks === 1 ? '' : 'S'}`;
    item.querySelector('.date').textContent = new Date(playlist.modified).toLocaleString();
    item.addEventListener('click', async () => {
      const now = Date.now();
      const twice = lastPlaylistClick === playlist.name && now - lastPlaylistClickAt < 400;
      lastPlaylistClick = twice ? '' : playlist.name;
      lastPlaylistClickAt = now;
      await loadPlaylist(playlist.name);
      if (twice && tracks.length) activateTrack(0);
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPlaylistContext(event, playlist.name);
    });
    els.playlistList.appendChild(item);
  }
  if (!view.length) {
    const item = document.createElement('li');
    item.style.cursor = 'default';
    item.innerHTML = `<strong>${playlists.length ? 'NO MATCHES' : 'NO PLAYLISTS YET'}</strong>`;
    els.playlistList.appendChild(item);
  }
  els.playlistCount.textContent = `${playlists.length} PLAYLIST${playlists.length === 1 ? '' : 'S'}`;
}

function renderTracks() {
  els.activeName.textContent = currentName || 'SELECT A PLAYLIST';
  els.trackCount.textContent = `${tracks.length} TRACK${tracks.length === 1 ? '' : 'S'}`;
  els.totalTime.textContent = `${fmtTime(tracks.reduce((sum, track) => sum + (track.duration || 0), 0))} TOTAL`;
  els.trackList.innerHTML = '';
  const livePlaylist = currentLivePlaylist();
  tracks.forEach((track, index) => {
    const item = document.createElement('li');
    item.draggable = true;
    item.dataset.index = index;
    item.classList.toggle('selected', index === selected);
    const isCurrent = (livePlaylist === currentName && liveState?.idx === index) ||
      (!!liveState?.trackKey && liveState.trackKey === trackKey(track));
    item.classList.toggle('current', isCurrent);
    const ytJob = track.storage === 'youtube' ? ytJobs.get(track.videoId) : null;
    const kindClass = track.storage === 'radio' ? ' radio'
      : track.storage === 'youtube' ? ` youtube${ytJob?.status === 'error' ? ' error' : ytJob ? ' pending' : ''}` : '';
    item.innerHTML = `
      <span class="trackname"><strong></strong><small></small></span>
      <span class="album"></span>
      <span class="kind${kindClass}"></span>
      <span class="duration"></span>`;
    item.querySelector('.trackname strong').textContent = track.title || 'Unknown track';
    item.querySelector('.trackname small').textContent = track.artist || 'Unknown artist';
    item.querySelector('.album').textContent = track.album || '—';
    item.querySelector('.kind').textContent = track.storage === 'radio' ? 'RADIO'
      : track.storage === 'youtube' ? youtubeKindText(ytJob, track)
      : (track.originalFile?.split('.').pop() || track.file?.split('.').pop() || 'AUDIO').toUpperCase();
    item.querySelector('.duration').textContent = track.storage === 'radio' ? 'LIVE' : fmtTime(track.duration);
    if (track.storage === 'path') item.title = track.file;
    if (track.storage === 'youtube') item.title = track.sourceUrl || '';
    item.addEventListener('click', () => {
      const now = Date.now();
      const twice = lastTrackClick === index && now - lastTrackClickAt < 400;
      lastTrackClick = twice ? -1 : index;
      lastTrackClickAt = now;
      selected = index;
      renderTracks();
      if (twice) activateTrack(index);
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selected = index;
      renderTracks();
      showTrackContext(event, index);
    });
    item.addEventListener('dragstart', (event) => {
      dragFrom = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });
    item.addEventListener('dragover', (event) => { event.preventDefault(); item.classList.add('dragover'); });
    item.addEventListener('dragleave', () => item.classList.remove('dragover'));
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      item.classList.remove('dragover');
      moveTrack(dragFrom, index);
      dragFrom = -1;
    });
    els.trackList.appendChild(item);
  });
  els.emptyState.classList.toggle('hidden', tracks.length > 0);
  if (!tracks.length) {
    els.emptyState.querySelector('strong').textContent = currentName ? 'THIS PLAYLIST IS EMPTY' : 'NO PLAYLIST SELECTED';
    els.emptyState.querySelector('span').textContent = currentName ? 'ADD AUDIO FILES OR A RADIO STREAM' : 'CHOOSE ONE ON THE LEFT OR CREATE A NEW PLAYLIST';
  }
  setControls();
}

async function refreshPlaylists(preferred = currentName) {
  try {
    const data = await api('/api/playlists');
    playlists = data.playlists || [];
    renderPlaylists();
    if (preferred && playlists.some((playlist) => playlist.name === preferred) && preferred !== currentName) {
      await loadPlaylist(preferred, true);
    }
  } catch (error) { toast('PLAYLIST LIST FAILED: ' + error.message, true); }
}

async function loadPlaylist(name, quiet = false) {
  if (name === currentName && !quiet) return;
  if (dirty && !confirm(`Discard unsaved changes to "${currentName}"?`)) return;
  try {
    const data = await api(`/api/playlists/${encodeURIComponent(name)}`);
    currentName = data.name || name;
    tracks = Array.isArray(data.tracks) ? data.tracks : [];
    youtubeSources = Array.isArray(data.youtubeSources) ? data.youtubeSources : [];
    selected = tracks.length ? 0 : -1;
    setDirty(false);
    renderPlaylists();
    renderTracks();
    document.title = `${currentName} — NEONAMP PLAYLIST CONTROL`;
    if (!quiet) toast(`OPENED "${currentName}"`);
  } catch (error) { toast('OPEN FAILED: ' + error.message, true); }
}

async function savePlaylist(quiet = false) {
  if (!currentName) return false;
  try {
    const data = await api(`/api/playlists/${encodeURIComponent(currentName)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks })
    });
    tracks = Array.isArray(data.tracks) ? data.tracks : tracks;
    selected = Math.min(selected, tracks.length - 1);
    setDirty(false);
    renderTracks();
    await refreshPlaylists();
    if (!quiet) toast(`SAVED "${currentName}"`);
    return true;
  } catch (error) {
    toast('SAVE FAILED: ' + error.message, true);
    return false;
  }
}

let searchDebounce = null;

function fmtAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'JUST NOW';
  const m = s / 60;
  if (m < 90) return `${Math.round(m)}M AGO`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)}H AGO`;
  const d = h / 24;
  if (d < 45) return `${Math.round(d)}D AGO`;
  return `${Math.round(d / 30)}MO AGO`;
}

function searchLibraryDialog() {
  const body = openModal('SEARCH ALL PLAYLISTS', `
    <div class="searchtabs">
      <button class="searchtab active" data-tab="search">SEARCH</button>
      <button class="searchtab" data-tab="recent">RECENTLY ADDED</button>
      <button class="searchtab" data-tab="played">MOST PLAYED</button>
    </div>
    <label class="field full" id="searchQueryField">TITLE, ARTIST, OR ALBUM<input id="searchQuery" type="search" placeholder="Start typing…" autocomplete="off"></label>
    <div class="searchresults" id="searchResults"><div class="searchempty">TYPE AT LEAST 2 CHARACTERS</div></div>`);
  const input = body.querySelector('#searchQuery');
  const queryField = body.querySelector('#searchQueryField');
  const resultsEl = body.querySelector('#searchResults');
  const tabs = [...body.querySelectorAll('.searchtab')];
  let mode = 'search';
  const runSearch = async () => {
    const q = input.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = '<div class="searchempty">TYPE AT LEAST 2 CHARACTERS</div>'; return; }
    resultsEl.innerHTML = '<div class="searchempty">SEARCHING…</div>';
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      renderSearchResults(resultsEl, data.results || [], 'search');
    } catch (error) {
      resultsEl.innerHTML = `<div class="searchempty">SEARCH FAILED: ${error.message}</div>`;
    }
  };
  const runSmart = async (which) => {
    resultsEl.innerHTML = '<div class="searchempty">LOADING…</div>';
    try {
      const data = await api(`/api/smart/${which}?limit=100`);
      renderSearchResults(resultsEl, data.results || [], which);
    } catch (error) {
      resultsEl.innerHTML = `<div class="searchempty">LOAD FAILED: ${error.message}</div>`;
    }
  };
  const activateTab = (which) => {
    mode = which;
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === which);
    if (which === 'search') {
      queryField.style.display = '';
      input.focus();
      if (input.value.trim().length >= 2) runSearch();
      else resultsEl.innerHTML = '<div class="searchempty">TYPE AT LEAST 2 CHARACTERS</div>';
    } else {
      queryField.style.display = 'none';
      runSmart(which);
    }
  };
  for (const tab of tabs) tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 250);
  });
  input.focus();
}

function renderSearchResults(container, results, mode = 'search') {
  if (!results.length) { container.innerHTML = '<div class="searchempty">NO MATCHES</div>'; return; }
  container.innerHTML = '';
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'searchrow';
    row.title = 'Double-click to load this playlist and play this track';
    row.innerHTML = `
      <span class="srtitle"></span>
      <span class="srartist"></span>
      <span class="srplaylist"></span>
      <span class="srdur"></span>`;
    row.querySelector('.srtitle').textContent = r.title || 'Unknown track';
    row.querySelector('.srartist').textContent = r.artist || '';
    row.querySelector('.srplaylist').textContent = r.playlist;
    const durEl = row.querySelector('.srdur');
    durEl.textContent = mode === 'recent' ? fmtAgo(r.addedAt)
      : mode === 'played' ? `${r.count}×`
      : r.storage === 'radio' ? 'LIVE' : fmtTime(r.duration);
    row.addEventListener('dblclick', () => activateSearchResult(r));
    container.appendChild(row);
  }
}

async function activateSearchResult(result) {
  closeModal();
  try {
    if (currentName !== result.playlist) await loadPlaylist(result.playlist, true);
    await activateTrack(result.index);
  } catch (error) { toast('PLAY FAILED: ' + error.message, true); }
}

function newPlaylistDialog() {
  const body = openModal('CREATE PLAYLIST', `
    <label class="field full">PLAYLIST NAME<input id="newName" maxlength="64" autocomplete="off" placeholder="Night drive"></label>
    <div class="modalactions"><button class="button primary" id="createPlaylist">CREATE</button></div>
    <div class="microcopy">LETTERS, NUMBERS, SPACES, DASHES AND UNDERSCORES · MAX 64 CHARACTERS</div>`);
  const input = body.querySelector('#newName');
  const create = async () => {
    const name = input.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name)) { toast('INVALID PLAYLIST NAME', true); return; }
    if (playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) { toast('PLAYLIST NAME ALREADY EXISTS', true); return; }
    try {
      await api(`/api/playlists/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks: [] })
      });
      closeModal();
      await refreshPlaylists();
      await loadPlaylist(name);
      toast(`CREATED "${name}"`);
    } catch (error) { toast('CREATE FAILED: ' + error.message, true); }
  };
  body.querySelector('#createPlaylist').addEventListener('click', create);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') create(); });
  input.focus();
}

function suggestedCopyName(name) {
  const taken = new Set(playlists.map((playlist) => playlist.name.toLowerCase()));
  const stem = `${name} Copy`.slice(0, 64).trim();
  if (!taken.has(stem.toLowerCase())) return stem;
  for (let number = 2; number < 1000; number++) {
    const suffix = ` Copy ${number}`;
    const candidate = `${name.slice(0, 64 - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `Playlist ${Date.now()}`.slice(0, 64);
}

function updateRenamedReferences(from, to) {
  if (liveState?.queueName === from) liveState = { ...liveState, queueName: to };
  if (currentName !== from) return false;
  currentName = to;
  tracks = tracks.map((track) => track?.storage === 'playlist' && track.playlist === from ? { ...track, playlist: to } : track);
  document.title = `${to} — NEONAMP PLAYLIST CONTROL`;
  renderTracks();
  return true;
}

function renamePlaylistDialog(from) {
  const body = openModal('RENAME PLAYLIST', `
    <label class="field full">NEW PLAYLIST NAME<input id="renameName" maxlength="64" autocomplete="off"></label>
    <div class="modalactions"><button class="button primary" id="renamePlaylist">RENAME</button></div>
    <div class="microcopy">FILE REFERENCES AND THE ACTIVE PLAYER QUEUE WILL FOLLOW THE NEW NAME</div>`);
  const input = body.querySelector('#renameName');
  input.value = from;
  input.select();
  const rename = async () => {
    const to = input.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(to)) { toast('INVALID PLAYLIST NAME', true); return; }
    if (to.toLowerCase() === from.toLowerCase()) { toast('CHOOSE A DIFFERENT NAME', true); return; }
    const wasCurrent = currentName === from;
    if (wasCurrent && dirty && !(await savePlaylist(true))) return;
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(from)}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: to })
      });
      if (wasCurrent) {
        currentName = to;
        tracks = result.playlist?.tracks || tracks.map((track) => track?.storage === 'playlist' ? { ...track, playlist: to } : track);
        setDirty(false);
        document.title = `${to} — NEONAMP PLAYLIST CONTROL`;
      }
      closeModal();
      await refreshPlaylists(wasCurrent ? to : currentName);
      renderTracks();
      toast(`RENAMED "${from}" TO "${to}"`);
    } catch (error) { toast('RENAME FAILED: ' + error.message, true); }
  };
  body.querySelector('#renamePlaylist').addEventListener('click', rename);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') rename(); });
}

function duplicatePlaylistDialog(from) {
  const body = openModal('DUPLICATE PLAYLIST', `
    <label class="field full">NEW PLAYLIST NAME<input id="duplicateName" maxlength="64" autocomplete="off"></label>
    <div class="modalactions"><button class="button primary" id="duplicatePlaylist">DUPLICATE</button></div>
    <div class="microcopy">THE NEW PLAYLIST REFERENCES THE SAME SOURCE AUDIO · FILES ARE NOT COPIED</div>`);
  const input = body.querySelector('#duplicateName');
  input.value = suggestedCopyName(from);
  input.select();
  const duplicate = async () => {
    const to = input.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(to)) { toast('INVALID PLAYLIST NAME', true); return; }
    if (playlists.some((playlist) => playlist.name.toLowerCase() === to.toLowerCase())) { toast('PLAYLIST NAME ALREADY EXISTS', true); return; }
    try {
      const wasCurrent = currentName === from;
      const source = wasCurrent ? tracks : (await api(`/api/playlists/${encodeURIComponent(from)}`)).tracks;
      const result = await api(`/api/playlists/${encodeURIComponent(to)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks: source })
      });
      closeModal();
      await refreshPlaylists();
      if (wasCurrent || !dirty) {
        currentName = to;
        tracks = result.tracks || [];
        selected = tracks.length ? 0 : -1;
        setDirty(false);
        renderPlaylists();
        renderTracks();
        document.title = `${to} — NEONAMP PLAYLIST CONTROL`;
      }
      toast(`DUPLICATED "${from}" AS "${to}"`);
    } catch (error) { toast('DUPLICATE FAILED: ' + error.message, true); }
  };
  body.querySelector('#duplicatePlaylist').addEventListener('click', duplicate);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') duplicate(); });
}

async function deletePlaylistByName(name) {
  if (!name || !confirm(`Delete playlist "${name}" and its private audio?\nThis cannot be undone.`)) return;
  const doomed = name;
  try {
    await api(`/api/playlists/${encodeURIComponent(doomed)}`, { method: 'DELETE' });
    if (currentName === doomed) {
      currentName = '';
      tracks = [];
      selected = -1;
      setDirty(false);
      renderTracks();
    }
    await refreshPlaylists('');
    toast(`DELETED "${doomed}"`);
  } catch (error) { toast('DELETE FAILED: ' + error.message, true); }
}

async function deleteCurrentPlaylist() { return deletePlaylistByName(currentName); }

async function activateTrack(index = selected) {
  if (!currentName || !tracks.length) return;
  index = Math.max(0, Math.min(tracks.length - 1, Number(index) || 0));
  if (dirty && !(await savePlaylist(true))) return;
  try {
    await api(`/api/playlists/${encodeURIComponent(currentName)}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index, play: true })
    });
    selected = index;
    toast(`PLAYING ${String(index + 1).padStart(2, '0')} FROM "${currentName}"`);
    renderTracks();
  } catch (error) { toast('PLAYER CONTROL FAILED: ' + error.message, true); }
}

function moveTrack(from, to) {
  if (from < 0 || to < 0 || from >= tracks.length || to >= tracks.length || from === to) return;
  const [track] = tracks.splice(from, 1);
  tracks.splice(to, 0, track);
  selected = to;
  setDirty();
  renderTracks();
}

async function addFilePaths(paths) {
  if (!currentName) { toast('SELECT OR CREATE A PLAYLIST FIRST', true); return; }
  if (!Array.isArray(paths) || !paths.length) return;
  if (addingPaths) { toast('FILES ARE ALREADY BEING ADDED', true); return; }
  if (dirty && !(await savePlaylist(true))) return;
  addingPaths = true;
  setControls();
  toast(`INDEXING ${paths.length} SOURCE FILE${paths.length === 1 ? '' : 'S'}…`);
  try {
    const result = await api(`/api/playlists/${encodeURIComponent(currentName)}/paths`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths })
    });
    tracks = Array.isArray(result.tracks) ? result.tracks : tracks;
    selected = Math.max(0, tracks.length - (result.added?.length || paths.length));
    setDirty(false);
    renderTracks();
    await refreshPlaylists();
    toast(`${result.added?.length || paths.length} FILE PATH${(result.added?.length || paths.length) === 1 ? '' : 'S'} ADDED — NO AUDIO COPIED`);
  } catch (error) { toast('ADD PATHS FAILED: ' + error.message, true); }
  finally { addingPaths = false; setControls(); }
}

function manualPathDialog(message = '') {
  const body = openModal('ADD FILE PATHS', `
    <label class="field full">ABSOLUTE AUDIO PATHS — ONE PER LINE<textarea id="manualPaths" rows="9" placeholder="D:\\Music\\Artist\\Track.mp3"></textarea></label>
    <div class="modalactions"><button class="button primary" id="addManualPaths">ADD PATHS</button></div>
    <div class="microcopy">${message ? 'NATIVE PICKER UNAVAILABLE · ' : ''}FILES STAY IN THEIR ORIGINAL LOCATION · NOTHING IS COPIED</div>`);
  const input = body.querySelector('#manualPaths');
  body.querySelector('#addManualPaths').addEventListener('click', async () => {
    const paths = input.value.split(/\r?\n/).map((value) => value.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
    if (!paths.length) { toast('PASTE AT LEAST ONE ABSOLUTE FILE PATH', true); return; }
    closeModal();
    await addFilePaths(paths);
  });
  input.focus();
}

async function selectLocalFiles() {
  if (!currentName) { toast('SELECT OR CREATE A PLAYLIST FIRST', true); return; }
  if (addingPaths) return;
  if (dirty && !(await savePlaylist(true))) return;
  toast('OPENING SERVER FILE PICKER…');
  try {
    const result = await api('/api/files/pick', { method: 'POST' });
    if (result.paths?.length) await addFilePaths(result.paths);
    else toast('FILE PICKER CANCELLED');
  } catch (error) {
    manualPathDialog(error.message);
  }
}

function streamDialog() {
  if (!currentName) return;
  const body = openModal('ADD RADIO STREAM', `
    <div class="formgrid">
      <label class="field full">STATION NAME<input id="streamName" maxlength="100" autocomplete="off"></label>
      <label class="field full">SHOUTCAST / ICECAST URL<input id="streamUrl" type="url" placeholder="https://station.example/stream" autocomplete="off"></label>
      <label class="field">GENRE<input id="streamGenre" maxlength="80"></label>
      <label class="field">HOMEPAGE<input id="streamHome" type="url"></label>
    </div>
    <div class="modalactions"><button class="button primary" id="saveStream">ADD TO PLAYLIST</button></div>`);
  body.querySelector('#saveStream').addEventListener('click', async () => {
    try {
      const result = await api('/api/radio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: body.querySelector('#streamName').value.trim(),
          url: body.querySelector('#streamUrl').value.trim(),
          genre: body.querySelector('#streamGenre').value.trim(),
          homepage: body.querySelector('#streamHome').value.trim()
        })
      });
      tracks.push(result.track);
      setDirty();
      if (await savePlaylist(true)) {
        closeModal();
        selected = tracks.length - 1;
        renderTracks();
        toast('RADIO STREAM ADDED');
      }
    } catch (error) { toast('STREAM FAILED: ' + error.message, true); }
  });
  body.querySelector('#streamName').focus();
}

function youtubeDialog() {
  if (!currentName) return;
  const body = openModal('ADD AUDIO FROM URL', `
    <div class="formgrid">
      <label class="field full">TRACK, VIDEO, OR PLAYLIST/SET URL<input id="ytUrl" type="url" placeholder="YouTube, SoundCloud, Mixcloud, or Bandcamp URL…" autocomplete="off"></label>
    </div>
    <div class="modalactions"><button class="button primary" id="saveYoutube">ADD TO PLAYLIST</button></div>
    <div class="microcopy">YOUTUBE, SOUNDCLOUD, MIXCLOUD, OR BANDCAMP · AUDIO ONLY, NO VIDEO · TRACKS DOWNLOAD IN THE BACKGROUND — WATCH PROGRESS ABOVE THE TOOLBAR · THIS CLOSES AS SOON AS THE URL RESOLVES, NOT WHEN THE DOWNLOAD FINISHES</div>`);
  const button = body.querySelector('#saveYoutube');
  const input = body.querySelector('#ytUrl');
  const submit = async () => {
    const url = input.value.trim();
    if (!url) { toast('PASTE A URL', true); return; }
    button.disabled = true;
    toast('RESOLVING URL…');
    try {
      const result = await api(`/api/playlists/${encodeURIComponent(currentName)}/youtube`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
      });
      tracks = Array.isArray(result.tracks) ? result.tracks : tracks;
      youtubeSources = Array.isArray(result.youtubeSources) ? result.youtubeSources : youtubeSources;
      selected = Math.max(0, tracks.length - (result.added?.length || 1));
      setDirty(false);
      // Don't optimistically write 'queued' here: the server processes the
      // queue as soon as it's enqueued (synchronously, ahead of this fetch
      // response for anything already cached), so a /ws 'ready' can beat
      // this handler back to the browser. Writing 'queued' after that would
      // stomp a correct, already-resolved state. Rely on the /ws push (and
      // the reconcileYoutubeQueue() safety net) as the single writer instead.
      reconcileYoutubeQueue();
      renderTracks();
      await refreshPlaylists();
      closeModal();
      toast(`${result.added.length} TRACK${result.added.length === 1 ? '' : 'S'} QUEUED — DOWNLOADING IN BACKGROUND`);
    } catch (error) {
      toast('ADD FAILED: ' + error.message, true);
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
  input.focus();
}

function editRadioDialog(index = selected) {
  const track = tracks[index];
  if (!track || track.storage !== 'radio') return;
  const body = openModal('EDIT RADIO STATION', `
    <div class="formgrid">
      <label class="field full">STATION NAME<input id="streamName" maxlength="100" autocomplete="off"></label>
      <label class="field full">SHOUTCAST / ICECAST URL<input id="streamUrl" type="url" autocomplete="off"></label>
      <label class="field">GENRE<input id="streamGenre" maxlength="80"></label>
      <label class="field">HOMEPAGE<input id="streamHome" type="url"></label>
    </div>
    <div class="modalactions"><button class="button primary" id="saveStation">SAVE STATION</button></div>
    <div class="microcopy">THE SHARED STATION BOOKMARK AND THIS PLAYLIST ENTRY WILL BE UPDATED</div>`);
  body.querySelector('#streamName').value = track.title || '';
  body.querySelector('#streamUrl').value = track.url || '';
  body.querySelector('#streamGenre').value = track.genre || track.album || '';
  body.querySelector('#streamHome').value = track.homepage || '';
  body.querySelector('#saveStation').addEventListener('click', async () => {
    try {
      const result = await api(`/api/radio/${encodeURIComponent(track.stationId || track.file)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: body.querySelector('#streamName').value.trim(),
          url: body.querySelector('#streamUrl').value.trim(),
          genre: body.querySelector('#streamGenre').value.trim(),
          homepage: body.querySelector('#streamHome').value.trim()
        })
      });
      const stationId = track.stationId || track.file;
      tracks = tracks.map((item) => item.storage === 'radio' && (item.stationId || item.file) === stationId ? { ...item, ...result.track } : item);
      setDirty();
      if (!(await savePlaylist(true))) return;
      closeModal();
      renderTracks();
      toast('RADIO STATION UPDATED');
    } catch (error) { toast('STATION UPDATE FAILED: ' + error.message, true); }
  });
  body.querySelector('#streamName').focus();
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast(successMessage);
}

function removeTrackAt(index = selected) {
  if (index < 0 || index >= tracks.length) return;
  tracks.splice(index, 1);
  selected = Math.min(index, tracks.length - 1);
  setDirty();
  renderTracks();
}

function duplicateTrackAt(index = selected) {
  const track = tracks[index];
  if (!track) return;
  tracks.splice(index + 1, 0, { ...track });
  selected = index + 1;
  setDirty();
  renderTracks();
  toast('TRACK ENTRY DUPLICATED');
}

function readArtwork(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(undefined);
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Artwork must be 2 MB or less'));
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(new Error('Artwork could not be read')));
    reader.addEventListener('load', () => {
      const [header, data] = String(reader.result).split(',', 2);
      resolve({ mime: (header.match(/^data:([^;]+)/) || [])[1] || file.type, data });
    });
    reader.readAsDataURL(file);
  });
}

async function metadataDialog() {
  const index = selected;
  const track = tracks[index];
  if (!track || track.storage === 'radio') return;
  let sidecar = {};
  try { sidecar = (await api(mediaApiUrl('metadata', track))).metadata || {}; }
  catch (error) { toast('METADATA LOAD FAILED: ' + error.message, true); return; }
  const body = openModal('EDIT TRACK METADATA', `
    <div class="artedit">
      <img id="artPreview" alt="Artwork preview">
      <div class="artbuttons">
        <input id="artFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
        <button class="button" id="chooseArt">CHOOSE ARTWORK</button>
        <button class="button" id="removeArt">REMOVE CUSTOM ART</button>
      </div>
    </div>
    <div class="formgrid">
      <label class="field full">TITLE<input id="metaTitle" maxlength="300"></label>
      <label class="field full">ARTIST<input id="metaArtist" maxlength="300"></label>
      <label class="field">ALBUM<input id="metaAlbum" maxlength="300"></label>
      <label class="field">GENRE<input id="metaGenre" maxlength="300"></label>
      <label class="field">YEAR<input id="metaYear" maxlength="16"></label>
    </div>
    <div class="modalactions"><button class="button danger" id="resetMeta">RESET CUSTOM DATA</button><button class="button primary" id="saveMeta">SAVE METADATA</button></div>
    <div class="microcopy">SIDECAR METADATA ONLY · ORIGINAL AUDIO BYTES ARE NEVER REWRITTEN</div>`);
  body.querySelector('#metaTitle').value = sidecar.title ?? track.title ?? '';
  body.querySelector('#metaArtist').value = sidecar.artist ?? track.artist ?? '';
  body.querySelector('#metaAlbum').value = sidecar.album ?? track.album ?? '';
  body.querySelector('#metaGenre').value = sidecar.genre ?? track.genre ?? '';
  body.querySelector('#metaYear').value = sidecar.year ?? track.year ?? '';
  const preview = body.querySelector('#artPreview');
  preview.src = mediaApiUrl('art', track) + `&v=${Date.now()}`;
  let artworkChange;
  body.querySelector('#chooseArt').addEventListener('click', () => body.querySelector('#artFile').click());
  body.querySelector('#artFile').addEventListener('change', async () => {
    try {
      artworkChange = await readArtwork(body.querySelector('#artFile').files[0]);
      preview.src = URL.createObjectURL(body.querySelector('#artFile').files[0]);
    } catch (error) { toast(error.message, true); }
  });
  body.querySelector('#removeArt').addEventListener('click', () => { artworkChange = null; preview.removeAttribute('src'); });
  body.querySelector('#saveMeta').addEventListener('click', async () => {
    const payload = {
      title: body.querySelector('#metaTitle').value,
      artist: body.querySelector('#metaArtist').value,
      album: body.querySelector('#metaAlbum').value,
      genre: body.querySelector('#metaGenre').value,
      year: body.querySelector('#metaYear').value
    };
    if (artworkChange !== undefined) payload.artwork = artworkChange;
    try {
      const result = await api(mediaApiUrl('metadata', track), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      tracks[index] = { ...track, ...result.track };
      setDirty();
      await savePlaylist(true);
      closeModal();
      renderTracks();
      toast('METADATA SAVED');
    } catch (error) { toast('METADATA SAVE FAILED: ' + error.message, true); }
  });
  body.querySelector('#resetMeta').addEventListener('click', async () => {
    if (!confirm('Remove all custom metadata and artwork for this track?')) return;
    try {
      const result = await api(mediaApiUrl('metadata', track), { method: 'DELETE' });
      tracks[index] = { ...track, ...result.track };
      setDirty();
      await savePlaylist(true);
      closeModal();
      renderTracks();
      toast('CUSTOM METADATA RESET');
    } catch (error) { toast('RESET FAILED: ' + error.message, true); }
  });
}

function downloadM3U(name, playlistTracks) {
  if (!name || !playlistTracks.length) return;
  const lines = ['#EXTM3U'];
  for (const track of playlistTracks) {
    lines.push(`#EXTINF:${track.duration || -1},${trackLabel(track)}`);
    lines.push(track.storage === 'radio' ? track.url : track.storage === 'youtube' ? (track.sourceUrl || track.file) : (track.originalFile || track.file));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'audio/x-mpegurl;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  toast(`EXPORTED ${playlistTracks.length} TRACKS`);
}

function exportM3U() {
  downloadM3U(currentName, tracks);
}

async function exportPlaylistByName(name) {
  if (!name) return;
  try {
    const playlistTracks = name === currentName ? tracks : (await api(`/api/playlists/${encodeURIComponent(name)}`)).tracks;
    downloadM3U(name, playlistTracks || []);
  } catch (error) { toast('EXPORT FAILED: ' + error.message, true); }
}

function applySort(action) {
  if (!action || tracks.length < 2) return;
  if (action === 'random') {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
  } else if (action === 'reverse') tracks.reverse();
  else if (action === 'dedupe') {
    const seen = new Set();
    tracks = tracks.filter((track) => { const key = trackKey(track); if (seen.has(key)) return false; seen.add(key); return true; });
  } else {
    tracks.sort((a, b) => {
      if (action === 'duration') return (a.duration || 0) - (b.duration || 0);
      return String(a[action] || '').localeCompare(String(b[action] || ''), undefined, { sensitivity: 'base' });
    });
  }
  selected = tracks.length ? 0 : -1;
  setDirty();
  renderTracks();
}

async function openAndPlayPlaylist(name) {
  if (name !== currentName) await loadPlaylist(name);
  if (currentName === name && tracks.length) await activateTrack(0);
}

function showPlaylistContext(event, name) {
  const info = playlists.find((playlist) => playlist.name === name);
  showContextMenu(event.clientX, event.clientY, `PLAYLIST // ${name}`, [
    { icon: '↗', label: 'Open for editing', hint: name === currentName ? 'OPEN' : '', action: () => loadPlaylist(name) },
    { icon: '▶', label: 'Load + play', hint: `${info?.tracks || 0} TRK`, disabled: !info?.tracks, action: () => openAndPlayPlaylist(name) },
    null,
    { icon: '✎', label: 'Rename playlist', action: () => renamePlaylistDialog(name) },
    { icon: '⧉', label: 'Duplicate playlist', action: () => duplicatePlaylistDialog(name) },
    { icon: '⇩', label: 'Export M3U', disabled: !info?.tracks, action: () => exportPlaylistByName(name) },
    null,
    { icon: '✕', label: 'Delete playlist', danger: true, action: () => deletePlaylistByName(name) }
  ]);
}

async function retryYoutubeDownload(track, { silent = false } = {}) {
  try {
    await api(`/api/playlists/${encodeURIComponent(currentName)}/youtube/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: track.videoId })
    });
    if (!silent) { reconcileYoutubeQueue(); toast(`RETRYING: ${trackLabel(track).toUpperCase()}`); }
    return true;
  } catch (error) {
    if (!silent) toast('RETRY FAILED: ' + error.message, true);
    return false;
  }
}

function failedYoutubeTracks() {
  return tracks.filter((t) => t.storage === 'youtube' && ytJobs.get(t.videoId)?.status === 'error');
}

async function retryAllFailedYoutube() {
  const failed = failedYoutubeTracks();
  if (!failed.length) return;
  const results = await Promise.all(failed.map((t) => retryYoutubeDownload(t, { silent: true })));
  reconcileYoutubeQueue();
  const ok = results.filter(Boolean).length;
  toast(`RETRYING ${ok} OF ${failed.length} FAILED DOWNLOAD${failed.length === 1 ? '' : 'S'}`);
}

async function checkForNewYoutubeVideos() {
  if (!currentName || !youtubeSources.length) return;
  toast('CHECKING FOR NEW VIDEOS…');
  try {
    const result = await api(`/api/playlists/${encodeURIComponent(currentName)}/youtube/resync`, { method: 'POST' });
    if (Array.isArray(result.tracks)) tracks = result.tracks;
    renderTracks();
    reconcileYoutubeQueue();
    const count = result.added?.length || 0;
    toast(count ? `${count} NEW VIDEO${count === 1 ? '' : 'S'} QUEUED` : 'NO NEW VIDEOS FOUND');
  } catch (error) { toast('CHECK FAILED: ' + error.message, true); }
}

function showTrackContext(event, index) {
  const track = tracks[index];
  if (!track) return;
  const radio = track.storage === 'radio';
  const youtube = track.storage === 'youtube';
  const ytFailed = youtube && ytJobs.get(track.videoId)?.status === 'error';
  const items = [
    { icon: '▶', label: 'Play now', hint: String(index + 1).padStart(2, '0'), action: () => activateTrack(index) },
    ...(radio ? [
      { icon: '↻', label: 'Reconnect stream', action: () => activateTrack(index) },
      { icon: '✎', label: 'Edit radio station', action: () => editRadioDialog(index) },
      { icon: '⧉', label: 'Copy stream URL', action: () => copyText(track.url || '', 'STREAM URL COPIED') }
    ] : youtube ? [
      ...(ytFailed ? [{ icon: '↻', label: 'Retry download', action: () => retryYoutubeDownload(track) }] : []),
      { icon: '✎', label: 'Edit metadata + artwork', action: () => metadataDialog() },
      { icon: '⧉', label: 'Copy source URL', action: () => copyText(track.sourceUrl || '', 'SOURCE URL COPIED') }
    ] : [
      { icon: '✎', label: 'Edit metadata + artwork', action: () => metadataDialog() }
    ]),
    null,
    { icon: '↑', label: 'Move up', disabled: index <= 0, action: () => moveTrack(index, index - 1) },
    { icon: '↓', label: 'Move down', disabled: index >= tracks.length - 1, action: () => moveTrack(index, index + 1) },
    { icon: '⧉', label: 'Duplicate entry', action: () => duplicateTrackAt(index) },
    null,
    { icon: '✕', label: 'Remove from playlist', danger: true, action: () => removeTrackAt(index) }
  ];
  showContextMenu(event.clientX, event.clientY, `${radio ? 'RADIO' : youtube ? importSiteLabel(track) : 'TRACK'} ${String(index + 1).padStart(2, '0')} // ${track.title || 'UNKNOWN'}`, items);
}

function showPlaylistSpaceContext(event) {
  const failedCount = currentName ? failedYoutubeTracks().length : 0;
  const items = currentName ? [
    { icon: '+', label: 'Add file paths', action: selectLocalFiles },
    { icon: '◉', label: 'Add radio stream', action: streamDialog },
    { icon: '▶', label: 'Add audio from URL', action: youtubeDialog },
    { icon: '↻', label: 'Retry all failed downloads', hint: `${failedCount} FAILED`, disabled: !failedCount, action: retryAllFailedYoutube },
    { icon: '⟳', label: 'Check for new videos', hint: `${youtubeSources.length} SOURCE${youtubeSources.length === 1 ? '' : 'S'}`, disabled: !youtubeSources.length, action: checkForNewYoutubeVideos },
    null,
    { icon: '▶', label: 'Load + play playlist', disabled: !tracks.length, action: () => activateTrack(selected >= 0 ? selected : 0) },
    { icon: '✓', label: 'Save changes', hint: dirty ? 'UNSAVED' : '', disabled: !dirty, action: () => savePlaylist() },
    { icon: '⇩', label: 'Export M3U', disabled: !tracks.length, action: exportM3U }
  ] : [
    { icon: '+', label: 'Create playlist', action: newPlaylistDialog },
    { icon: '↻', label: 'Refresh playlists', action: () => refreshPlaylists() }
  ];
  showContextMenu(event.clientX, event.clientY, currentName ? `PLAYLIST SPACE // ${currentName}` : 'PLAYLIST SPACE', items);
}

function showPlaylistListContext(event) {
  showContextMenu(event.clientX, event.clientY, 'SAVED PLAYLISTS', [
    { icon: '+', label: 'Create playlist', action: newPlaylistDialog },
    { icon: '↻', label: 'Refresh playlists', action: () => refreshPlaylists() }
  ]);
}

function dspId() {
  return globalThis.crypto?.randomUUID?.() || `dsp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newDspModule(type, value) {
  const def = DSP_DEFS[type];
  if (!def) return null;
  return { id: dspId(), type, enabled: true, value: Number.isFinite(value) ? value : def.value };
}

function balanceLabel(value) {
  const n = Math.round(Number(value) || 0);
  return n === 0 ? 'C' : n < 0 ? `L${Math.abs(n)}` : `R${n}`;
}

function updateControlStatus(label = 'SYNCED') {
  els.controlStatus.textContent = `${label} // ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function applyControlSettings(next, render = true) {
  if (!next || typeof next !== 'object') return;
  const eq = next.eq && typeof next.eq === 'object'
    ? { ...controlSettings.eq, ...next.eq, bands: Array.isArray(next.eq.bands) ? next.eq.bands.slice(0, 10) : controlSettings.eq.bands }
    : controlSettings.eq;
  const dsp = next.dsp && Array.isArray(next.dsp.modules)
    ? { modules: next.dsp.modules.filter((module) => DSP_DEFS[module?.type]).slice(0, 16).map((module) => ({
        id: module.id || dspId(), type: module.type, enabled: module.enabled !== false,
        value: Number.isFinite(Number(module.value)) ? Number(module.value) : DSP_DEFS[module.type].value
      })) }
    : controlSettings.dsp;
  controlSettings = { ...controlSettings, ...next, eq, dsp };
  if (render) renderControlSettings();
}

function renderControlSettings() {
  els.ctlVol.value = controlSettings.volume;
  els.ctlVolVal.textContent = Math.round(controlSettings.volume);
  els.ctlBal.value = controlSettings.balance;
  els.ctlBalVal.textContent = balanceLabel(controlSettings.balance);
  els.ctlNorm.classList.toggle('active', !!controlSettings.normalize);
  els.ctlShuffle.classList.toggle('active', !!controlSettings.shuffle);
  els.ctlRepeat.classList.toggle('active', controlSettings.repeat !== 'off');
  els.ctlRepeat.textContent = `REP: ${String(controlSettings.repeat || 'off').toUpperCase()}`;
  const xfade = Number(controlSettings.xfade) || 0;
  els.ctlXfade.classList.toggle('active', xfade > 0);
  els.ctlXfade.textContent = xfade > 0 ? `XFD: ${xfade}S` : 'XFD: OFF';
  els.ctlVis.value = controlSettings.visMode || 'bars';
  els.ctlTheme.value = controlSettings.theme || 'NEON';
  els.ctlEqOn.classList.toggle('active', controlSettings.eq.on !== false);
  els.ctlObsEq.classList.toggle('active', !!controlSettings.obsEq);
  els.ctlEqPreset.value = EQ_PRESETS[controlSettings.eq.preset] ? controlSettings.eq.preset : 'CUSTOM';
  els.ctlEqBands.querySelectorAll('.eqband').forEach((band, index) => {
    const value = Number(controlSettings.eq.bands[index]) || 0;
    band.querySelector('input').value = value;
    band.querySelector('output').textContent = value > 0 ? `+${value}` : String(value);
  });
  renderDspModules();
}

async function sendControl(settings = null, cmd = '') {
  try {
    await api('/api/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(cmd ? { cmd } : {}), ...(settings ? { settings } : {}) })
    });
    updateControlStatus(cmd ? `SENT ${cmd.toUpperCase()}` : 'SETTINGS SYNCED');
  } catch (error) {
    updateControlStatus('CONTROL ERROR');
    toast('PLAYER CONTROL FAILED: ' + error.message, true);
  }
}

function queueControl(patch) {
  pendingControl = { ...pendingControl, ...patch };
  clearTimeout(controlTimer);
  els.controlStatus.textContent = 'APPLYING…';
  controlTimer = setTimeout(() => {
    const update = pendingControl;
    pendingControl = {};
    sendControl(update);
  }, 90);
}

function setDspCustom() { els.ctlDspPreset.value = 'CUSTOM'; }

function matchingDspPreset(modules) {
  for (const [name, preset] of Object.entries(DSP_PRESETS)) {
    if (preset.length !== modules.length) continue;
    if (preset.every((item, index) => modules[index]?.enabled !== false && modules[index]?.type === item.type && Math.abs(Number(modules[index].value) - item.value) < .001)) return name;
  }
  return 'CUSTOM';
}

function renderDspModules() {
  const modules = controlSettings.dsp.modules;
  els.ctlDspPreset.value = matchingDspPreset(modules);
  els.ctlDspList.innerHTML = '';
  if (!modules.length) {
    els.ctlDspList.innerHTML = '<div class="dspempty">CLEAN SIGNAL — NO DSP MODULES</div>';
    return;
  }
  modules.forEach((module, index) => {
    const def = DSP_DEFS[module.type];
    const row = document.createElement('div');
    row.className = 'dspmodule';
    row.innerHTML = `<button class="minitoggle" data-action="toggle" title="Enable module">ON</button><strong></strong><input type="range"><output></output><button class="minitoggle" data-action="up" title="Move up">↑</button><button class="minitoggle" data-action="down" title="Move down">↓</button><button class="minitoggle" data-action="remove" title="Remove">✕</button>`;
    row.dataset.index = index;
    row.querySelector('strong').textContent = def.name;
    const toggle = row.querySelector('[data-action="toggle"]');
    toggle.classList.toggle('active', module.enabled !== false);
    toggle.textContent = module.enabled !== false ? 'ON' : 'OFF';
    const slider = row.querySelector('input');
    slider.min = def.min; slider.max = def.max; slider.step = def.step; slider.value = module.value;
    const output = row.querySelector('output');
    output.textContent = Number(module.value).toFixed(def.step < 1 ? 2 : 0).replace(/\.00$/, '');
    slider.addEventListener('input', () => {
      module.value = Number(slider.value);
      output.textContent = Number(module.value).toFixed(def.step < 1 ? 2 : 0).replace(/\.00$/, '');
      setDspCustom();
      queueControl({ dsp: { modules: controlSettings.dsp.modules } });
    });
    els.ctlDspList.appendChild(row);
  });
}

function initSoundControls() {
  if (new URLSearchParams(location.search).has('sound')) els.soundDetails.open = true;
  els.ctlEqPreset.innerHTML = [...Object.keys(EQ_PRESETS), 'CUSTOM'].map((name) => `<option>${name}</option>`).join('');
  els.ctlDspPreset.innerHTML = [...Object.keys(DSP_PRESETS), 'CUSTOM'].map((name) => `<option>${name}</option>`).join('');
  els.ctlDspType.innerHTML = Object.entries(DSP_DEFS).map(([type, def]) => `<option value="${type}">${def.name}</option>`).join('');
  els.ctlEqBands.innerHTML = EQ_LABELS.map((label, index) => `<label class="eqband"><input type="range" min="-12" max="12" step="0.5" value="0" data-index="${index}"><output>0</output><span>${label}</span></label>`).join('');

  const commands = [[els.ctlPrev, 'prev'], [els.ctlPlay, 'resume'], [els.ctlPause, 'pause'], [els.ctlStop, 'stop'], [els.ctlNext, 'next']];
  commands.forEach(([button, cmd]) => button.addEventListener('click', () => sendControl(null, cmd)));
  els.ctlVol.addEventListener('input', () => {
    controlSettings.volume = Number(els.ctlVol.value); els.ctlVolVal.textContent = els.ctlVol.value;
    queueControl({ volume: controlSettings.volume });
  });
  els.ctlBal.addEventListener('input', () => {
    controlSettings.balance = Number(els.ctlBal.value); els.ctlBalVal.textContent = balanceLabel(controlSettings.balance);
    queueControl({ balance: controlSettings.balance });
  });
  els.ctlNorm.addEventListener('click', () => { controlSettings.normalize = !controlSettings.normalize; renderControlSettings(); queueControl({ normalize: controlSettings.normalize }); });
  els.ctlShuffle.addEventListener('click', () => { controlSettings.shuffle = !controlSettings.shuffle; renderControlSettings(); queueControl({ shuffle: controlSettings.shuffle }); });
  els.ctlRepeat.addEventListener('click', () => {
    controlSettings.repeat = ({ off: 'all', all: 'one', one: 'off' })[controlSettings.repeat] || 'off';
    renderControlSettings(); queueControl({ repeat: controlSettings.repeat });
  });
  els.ctlXfade.addEventListener('click', () => {
    const cur = Number(controlSettings.xfade) || 0;
    controlSettings.xfade = XFADE_STEPS[(XFADE_STEPS.indexOf(cur) + 1) % XFADE_STEPS.length];
    renderControlSettings(); queueControl({ xfade: controlSettings.xfade });
  });
  els.ctlVis.addEventListener('change', () => { controlSettings.visMode = els.ctlVis.value; queueControl({ visMode: controlSettings.visMode }); });
  els.ctlTheme.addEventListener('change', () => { controlSettings.theme = els.ctlTheme.value; queueControl({ theme: controlSettings.theme }); });
  els.ctlEqOn.addEventListener('click', () => { controlSettings.eq.on = !controlSettings.eq.on; renderControlSettings(); queueControl({ eq: controlSettings.eq }); });
  els.ctlObsEq.addEventListener('click', () => { controlSettings.obsEq = !controlSettings.obsEq; renderControlSettings(); queueControl({ obsEq: controlSettings.obsEq }); });
  els.ctlEqPreset.addEventListener('change', () => {
    const preset = EQ_PRESETS[els.ctlEqPreset.value];
    if (!preset) return;
    controlSettings.eq = { ...controlSettings.eq, preset: els.ctlEqPreset.value, bands: preset.slice() };
    renderControlSettings(); queueControl({ eq: controlSettings.eq });
  });
  els.ctlEqBands.addEventListener('input', (event) => {
    if (!event.target.matches('input')) return;
    const index = Number(event.target.dataset.index);
    controlSettings.eq.bands[index] = Number(event.target.value);
    controlSettings.eq.preset = 'CUSTOM';
    event.target.parentElement.querySelector('output').textContent = Number(event.target.value) > 0 ? `+${event.target.value}` : event.target.value;
    els.ctlEqPreset.value = 'CUSTOM';
    queueControl({ eq: controlSettings.eq });
  });
  els.ctlDspPreset.addEventListener('change', () => {
    const preset = DSP_PRESETS[els.ctlDspPreset.value];
    if (!preset) return;
    controlSettings.dsp.modules = preset.map((module) => newDspModule(module.type, module.value));
    renderDspModules(); queueControl({ dsp: controlSettings.dsp });
  });
  els.ctlDspAdd.addEventListener('click', () => {
    const module = newDspModule(els.ctlDspType.value);
    if (!module || controlSettings.dsp.modules.length >= 16) return;
    controlSettings.dsp.modules.push(module); setDspCustom(); renderDspModules(); queueControl({ dsp: controlSettings.dsp });
  });
  els.ctlDspList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('.dspmodule');
    if (!button || !row) return;
    const index = Number(row.dataset.index); const modules = controlSettings.dsp.modules; const action = button.dataset.action;
    if (action === 'toggle') modules[index].enabled = modules[index].enabled === false;
    else if (action === 'remove') modules.splice(index, 1);
    else if (action === 'up' && index > 0) [modules[index - 1], modules[index]] = [modules[index], modules[index - 1]];
    else if (action === 'down' && index < modules.length - 1) [modules[index + 1], modules[index]] = [modules[index], modules[index + 1]];
    else return;
    setDspCustom(); renderDspModules(); queueControl({ dsp: controlSettings.dsp });
  });
  renderControlSettings();
}

function connectWebSocket() {
  let socket;
  try {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  } catch { setTimeout(connectWebSocket, 3000); return; }
  socket.addEventListener('open', () => {
    els.connection.classList.add('online');
    els.connection.querySelector('span').textContent = 'CONTROL ONLINE';
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'state') {
      liveState = message;
      paintLiveState();
      renderTracks();
    } else if (message.type === 'prefs') {
      applyControlSettings(message);
      updateControlStatus('DECK SYNCED');
    } else if (message.type === 'theme' && message.name) {
      applyControlSettings({ theme: message.name });
    } else if (message.type === 'cmd' && message.cmd === 'apply-settings') {
      applyControlSettings(message.settings);
      updateControlStatus('LIVE APPLIED');
    } else if (message.type === 'cmd' && message.cmd === 'rename-playlist') {
      updateRenamedReferences(message.from, message.to);
      refreshPlaylists(currentName);
    } else if (message.type === 'cmd' && message.cmd === 'youtube-resync') {
      toast(`${message.added} NEW VIDEO${message.added === 1 ? '' : 'S'} FOUND IN "${message.playlist}"`);
      // Don't force-reload over unsaved local edits — the toast already
      // told them; they'll see the new tracks next time they open it.
      if (message.playlist === currentName && !dirty) loadPlaylist(currentName, true);
      else refreshPlaylists(currentName);
    } else if (message.type === 'youtube') {
      handleYoutubeEvent(message);
    }
  });
  socket.addEventListener('close', () => {
    els.connection.classList.remove('online');
    els.connection.querySelector('span').textContent = 'RECONNECTING';
    setTimeout(connectWebSocket, 3000);
  });
  socket.addEventListener('error', () => { try { socket.close(); } catch {} });
}

function renderYtProgress() {
  const jobs = [...ytJobs.values()];
  const downloading = jobs.find((j) => j.status === 'downloading');
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const failedCount = jobs.filter((j) => j.status === 'error').length;
  if (!downloading && !queuedCount && !failedCount) {
    els.ytProgress.classList.add('hidden');
    els.ytProgress.textContent = '';
    return;
  }
  const parts = [];
  if (downloading) {
    const icon = downloading.phase === 'converting' ? '⚙' : '⬇';
    const label = downloading.phase === 'converting' ? 'CONVERTING' : 'DOWNLOADING';
    const pct = Number.isFinite(downloading.percent) ? ` ${downloading.percent}%` : '';
    parts.push(`${icon} ${label}: ${(downloading.title || 'UNTITLED').toUpperCase()}${pct}`);
  }
  if (queuedCount) parts.push(`${queuedCount} QUEUED`);
  if (failedCount) parts.push(`${failedCount} FAILED`);
  els.ytProgress.textContent = parts.join('  ·  ');
  els.ytProgress.classList.remove('hidden');
}

// storage stays 'youtube' internally for every site (see server.js) so
// existing playlists never break, but the badge should say what it
// actually is — derived from the real source URL, not the storage tag.
function importSiteLabel(track) {
  try {
    const host = new URL(track?.sourceUrl || '').hostname.replace(/^(www|m|music|on)\./, '');
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YOUTUBE';
    if (host.endsWith('soundcloud.com')) return 'SOUNDCLOUD';
    if (host.endsWith('mixcloud.com')) return 'MIXCLOUD';
    if (host.endsWith('bandcamp.com')) return 'BANDCAMP';
  } catch { /* no/invalid sourceUrl */ }
  return 'YOUTUBE';
}

function youtubeKindText(job, track) {
  const site = importSiteLabel(track);
  if (!job) return site;
  if (job.status === 'downloading') {
    const label = job.phase === 'converting' ? 'CONVERTING' : 'DOWNLOADING';
    return `${label}${Number.isFinite(job.percent) ? ` ${job.percent}%` : ''}`;
  }
  if (job.status === 'queued') return 'QUEUED';
  if (job.status === 'error') return 'FAILED';
  return site;
}

// A percent tick fires up to ~100 times over one download. Patching just
// the affected row's badge text (instead of a full renderTracks()) keeps
// that smooth instead of rebuilding the whole list on every tick.
function updateYoutubeRowBadge(videoId) {
  const index = tracks.findIndex((t) => t.storage === 'youtube' && t.videoId === videoId);
  if (index < 0) return;
  const kind = els.trackList.querySelector(`li[data-index="${index}"] .kind`);
  if (kind) kind.textContent = youtubeKindText(ytJobs.get(videoId), tracks[index]);
}

function handleYoutubeEvent(message) {
  const { event, videoId, playlist, title, error, percent, phase, meta } = message;
  if (event === 'ready') {
    ytJobs.delete(videoId);
  } else if (event === 'progress') {
    // A progress tick doesn't carry a status of its own — it's always
    // mid-download — so patch the percent/phase onto whatever's already
    // there rather than replacing the job.
    ytJobs.set(videoId, { ...(ytJobs.get(videoId) || { status: 'downloading', playlist, title }), percent, phase });
  } else {
    ytJobs.set(videoId, { status: event, playlist, title, error });
  }
  renderYtProgress();
  if (playlist !== currentName) return;
  if (event === 'progress') { updateYoutubeRowBadge(videoId); return; }
  if (event === 'ready' && meta) {
    // A batch/set add only had sparse placeholder metadata for some sites —
    // the server corrects the persisted entry post-download and sends the
    // real values along with 'ready', so the open manager doesn't keep
    // showing "Untitled" until the next full reload.
    const idx = tracks.findIndex((t) => t.storage === 'youtube' && t.videoId === videoId);
    if (idx >= 0) tracks[idx] = { ...tracks[idx], title: meta.title, artist: meta.artist, duration: meta.duration };
  }
  renderTracks();
  const track = tracks.find((t) => t.storage === 'youtube' && t.videoId === videoId);
  if (!track) return;
  if (event === 'ready') toast(`DOWNLOADED: ${trackLabel(track).toUpperCase()}`);
  else if (event === 'error') toast(`DOWNLOAD FAILED: ${trackLabel(track).toUpperCase()}`, true);
}

// The strip/badges above are driven by live /ws pushes, but a push can be
// missed — e.g. a cached video resolves 'queued'→'ready' server-side within
// milliseconds, faster than this tab's fetch() for the add request even
// returns — leaving a job stuck (or never shown) with nothing to correct
// it. Reconcile against the server's authoritative queue as a safety net:
// on a short timer, and once right after adding, so newly queued jobs show
// up immediately instead of waiting for the next tick.
let ytReconcileBusy = false;
async function reconcileYoutubeQueue() {
  if (ytReconcileBusy) return;
  ytReconcileBusy = true;
  try {
    const queue = await api('/api/youtube/queue');
    const serverJobs = new Map((queue.jobs || []).map((job) => [job.videoId, job]));
    let changed = false;
    for (const [videoId, job] of serverJobs) {
      if (ytJobs.get(videoId)?.status !== job.status) changed = true;
      ytJobs.set(videoId, job);
    }
    for (const [videoId, job] of [...ytJobs]) {
      if (job.status !== 'error' && !serverJobs.has(videoId)) { ytJobs.delete(videoId); changed = true; }
    }
    renderYtProgress();
    if (changed) renderTracks();
  } catch { /* try again on the next tick */ }
  finally { ytReconcileBusy = false; }
}
setInterval(reconcileYoutubeQueue, 4000);

function paintLiveState() {
  const status = liveState?.status || 'stopped';
  els.liveState.parentElement.className = 'signal ' + status;
  els.liveState.textContent = status === 'playing' ? 'LIVE PLAYBACK' : status === 'paused' ? 'PLAYBACK PAUSED' : 'SIGNAL STANDBY';
  els.nowTitle.textContent = (liveState?.title || 'WAITING FOR PLAYER…').toUpperCase();
  els.nowMeta.textContent = (liveState?.artist || currentLivePlaylist() || 'OPEN THE PLAYER OR OBS JUKEBOX').toUpperCase();
}

setInterval(() => {
  if (!liveState) { els.nowTime.textContent = '00:00'; return; }
  let elapsed = Number(liveState.t) || 0;
  if (liveState.status === 'playing') elapsed += (Date.now() - Number(liveState.ts || Date.now())) / 1000;
  els.nowTime.textContent = fmtTime(liveState.duration ? Math.min(elapsed, liveState.duration) : elapsed);
}, 250);

els.refreshPlaylists.addEventListener('click', () => refreshPlaylists());
els.playlistFilter.addEventListener('input', renderPlaylists);
els.playlistList.addEventListener('contextmenu', (event) => {
  if (event.target.closest('li')) return;
  event.preventDefault();
  showPlaylistListContext(event);
});
els.trackTable.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tracklist li')) return;
  event.preventDefault();
  showPlaylistSpaceContext(event);
});
els.newPlaylist.addEventListener('click', newPlaylistDialog);
els.searchLibrary.addEventListener('click', searchLibraryDialog);
els.saveChanges.addEventListener('click', () => savePlaylist());
els.deletePlaylist.addEventListener('click', deleteCurrentPlaylist);
els.loadPlay.addEventListener('click', () => activateTrack(selected >= 0 ? selected : 0));
els.addFiles.addEventListener('click', selectLocalFiles);
els.addStream.addEventListener('click', streamDialog);
els.addYoutube.addEventListener('click', youtubeDialog);
els.editTrack.addEventListener('click', metadataDialog);
els.removeTrack.addEventListener('click', () => removeTrackAt(selected));
els.moveUp.addEventListener('click', () => moveTrack(selected, selected - 1));
els.moveDown.addEventListener('click', () => moveTrack(selected, selected + 1));
els.sortTracks.addEventListener('change', () => { applySort(els.sortTracks.value); els.sortTracks.value = ''; });
els.exportM3U.addEventListener('click', exportM3U);

const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
window.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  toast('BROWSERS HIDE ORIGINAL FILE PATHS — USE ADD FILE PATHS', true);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    savePlaylist();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchLibraryDialog();
  }
  if (event.key === 'Delete' && !event.target.matches('input')) els.removeTrack.click();
});
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

async function boot() {
  initSoundControls();
  renderTracks();
  const query = new URLSearchParams(location.search);
  let preferred = query.get('name') || '';
  const trackParam = query.get('track');
  const requestedTrack = trackParam === null ? NaN : Number(trackParam);
  try {
    const session = await api('/api/session');
    applyControlSettings(session);
    updateControlStatus('SESSION LOADED');
    if (!preferred && typeof session.name === 'string') preferred = session.name;
  } catch { /* playlist editing still works without session state */ }
  await refreshPlaylists(preferred);
  if (!currentName && playlists.length) await loadPlaylist(playlists[0].name, true);
  if (Number.isInteger(requestedTrack) && requestedTrack >= 0 && requestedTrack < tracks.length) {
    selected = requestedTrack;
    renderTracks();
    requestAnimationFrame(() => els.trackList.querySelector(`li[data-index="${requestedTrack}"]`)?.scrollIntoView({ block: 'center' }));
  }
  await reconcileYoutubeQueue();
  connectWebSocket();
}

boot();
