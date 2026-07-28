// ============================================================
//  NEONAMP client — insert3coins edition
//  <audio> element piped through Web Audio:
//  source → preamp → 10-band EQ → balance → analyser → out
// ============================================================
'use strict';

const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
let pl = [];             // current playlist (queue)
let cur = -1;            // index of playing track in pl (-1 = none)
let sel = -1;            // selected row in pl
let shuffle = false;
let repeat = 'off';      // 'off' | 'all' | 'one'
let playHistory = [];    // for prev while shuffling
let showRemain = false;  // time display mode
let currentName = '';    // loaded/saved playlist name
let errStreak = 0;       // consecutive playback errors (bail-out guard)
let radioRetry = 0;
let radioRetryTimer = null;
let currentRadioTitle = '';
let normalize = true;    // loudness normalization toggle
let normGain = 0;        // dB gain for the current track

const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
let eqOn = true;
let eqVals = new Array(10).fill(0);
let eqPreset = 'FLAT';       // active preset label ('CUSTOM' when hand-tuned)
let obsEq = false;           // overlay routes audio through this EQ (persisted)
let dspModules = [];
let visMode = 'bars';
const VIS_MODES = ['bars', 'scope', 'vu', 'radial', 'waterfall', 'dots', 'particles', 'off'];
const VIS_LABELS = {
  bars: 'SPECTRUM BARS', scope: 'OSCILLOSCOPE', vu: 'VU METER', radial: 'RADIAL CORE',
  waterfall: 'WATERFALL', dots: 'DOT MATRIX', particles: 'PARTICLE BURST', off: 'OFF / GRID'
};

// The classic Winamp/XMMS preset bank (dB per band, clamped ±12)
const EQ_PRESETS = {
  'FLAT':            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'NEON (I3C)':      [5, 3, 1, 0, -1, 0, 2, 4, 5, 6],
  'CLASSICAL':       [0, 0, 0, 0, 0, 0, -7, -7, -7, -9.5],
  'CLUB':            [0, 0, 8, 5.5, 5.5, 5.5, 3, 0, 0, 0],
  'DANCE':           [9.5, 7, 2.5, 0, 0, -5.5, -7, -7, 0, 0],
  'FULL BASS':       [-8, 9.5, 9.5, 5.5, 1.5, -4, -8, -10, -11, -11],
  'FULL BASS+TRB':   [7, 5.5, 0, -7, -5, 1.5, 8, 11, 12, 12],
  'FULL TREBLE':     [-9.5, -9.5, -9.5, -4, 2.5, 11, 12, 12, 12, 12],
  'LAPTOP/PHONES':   [5, 11, 5.5, -3, -2.5, 1.5, 5, 9.5, 12, 12],
  'LARGE HALL':      [10, 10, 5.5, 5.5, 0, -5, -5, -5, 0, 0],
  'LIVE':            [-5, 0, 4, 5.5, 5.5, 5.5, 4, 2.5, 2.5, 2.5],
  'PARTY':           [7, 7, 0, 0, 0, 0, 0, 0, 7, 7],
  'POP':             [-1.5, 5, 7, 8, 5.5, 0, -2.5, -2.5, -1.5, -1.5],
  'REGGAE':          [0, 0, 0, -5.5, 0, 6.5, 6.5, 0, 0, 0],
  'ROCK':            [8, 5, -5.5, -8, -3, 4, 9, 11, 11, 11],
  'SKA':             [-2.5, -5, -4, 0, 4, 5.5, 9, 9.5, 11, 9.5],
  'SOFT':            [5, 1.5, 0, -2.5, 0, 4, 8, 9.5, 11, 12],
  'SOFT ROCK':       [4, 4, 2.5, 0, -4, -5.5, -3, 0, 2.5, 9],
  'TECHNO':          [8, 5.5, 0, -5.5, -5, 0, 8, 9.5, 9.5, 9]
};


// ------------------------------------------------------------
// Theme engine — palette presets swapped via CSS variables.
// vis colors feed the canvas visualizers (they can't read CSS vars
// per-frame cheaply, so each theme carries them explicitly).
// ------------------------------------------------------------
const THEMES = {
  'NEON': {
    vars: {}, // stylesheet defaults
    vis: { c1: '#21e6c1', c2: '#7a5cff', c3: '#ff4f9a', peak: '#ffb24d', dim: '#6f6d99' }
  },
  'C64': {
    vars: {
      '--void': '#0e0a2e', '--panel': '#161040', '--panel2': '#1d1554', '--inset': '#0a0722',
      '--line': '#2f2670', '--line2': '#453994',
      '--cyan': '#8f9dff', '--mag': '#c77dff', '--amber': '#ffe08a',
      '--text': '#dcdcff', '--dim': '#7a76b8',
      '--cyan-rgb': '143, 157, 255', '--mag-rgb': '199, 125, 255', '--amber-rgb': '255, 224, 138'
    },
    vis: { c1: '#8f9dff', c2: '#a58bff', c3: '#c77dff', peak: '#ffe08a', dim: '#7a76b8' }
  },
  'AMBER TERM': {
    vars: {
      '--void': '#0d0700', '--panel': '#160c00', '--panel2': '#1e1100', '--inset': '#0a0500',
      '--line': '#4a2c05', '--line2': '#6b3d08',
      '--cyan': '#ffb000', '--mag': '#ff7a00', '--amber': '#ffd75e',
      '--text': '#ffd9a0', '--dim': '#8a5a20',
      '--cyan-rgb': '255, 176, 0', '--mag-rgb': '255, 122, 0', '--amber-rgb': '255, 215, 94'
    },
    vis: { c1: '#ffb000', c2: '#ff9020', c3: '#ff7a00', peak: '#ffd75e', dim: '#8a5a20' }
  },
  'VAPORWAVE': {
    vars: {
      '--void': '#180f2e', '--panel': '#221542', '--panel2': '#2b1b52', '--inset': '#120b24',
      '--line': '#41306b', '--line2': '#5a4390',
      '--cyan': '#7af3e0', '--mag': '#ff9de2', '--amber': '#ffd9a8',
      '--text': '#f4ecff', '--dim': '#8d84b8',
      '--cyan-rgb': '122, 243, 224', '--mag-rgb': '255, 157, 226', '--amber-rgb': '255, 217, 168'
    },
    vis: { c1: '#7af3e0', c2: '#b3a1ff', c3: '#ff9de2', peak: '#ffd9a8', dim: '#8d84b8' }
  },
  'GREEN PHOS': {
    vars: {
      '--void': '#020a04', '--panel': '#04140a', '--panel2': '#061c0e', '--inset': '#010803',
      '--line': '#0e3a20', '--line2': '#14522d',
      '--cyan': '#33ff77', '--mag': '#9dffb0', '--amber': '#d6ff5e',
      '--text': '#bdf7cf', '--dim': '#3f7a54',
      '--cyan-rgb': '51, 255, 119', '--mag-rgb': '157, 255, 176', '--amber-rgb': '214, 255, 94'
    },
    vis: { c1: '#33ff77', c2: '#6fff9a', c3: '#9dffb0', peak: '#d6ff5e', dim: '#3f7a54' }
  }
};
const THEME_NAMES = Object.keys(THEMES);
let themeName = 'NEON';
let VIS_COLORS = THEMES.NEON.vis;

function applyTheme(name, quiet = false) {
  if (!THEMES[name]) name = 'NEON';
  themeName = name;
  const root = document.documentElement.style;
  // reset to stylesheet defaults, then lay the theme on top
  for (const t of Object.values(THEMES)) for (const k of Object.keys(t.vars)) root.removeProperty(k);
  for (const [k, v] of Object.entries(THEMES[name].vars)) root.setProperty(k, v);
  VIS_COLORS = THEMES[name].vis;
  sizeVis(); // rebuild the canvas gradient in theme colors
  if (els.btnTheme) els.btnTheme.title = `Theme: ${name} (click to cycle)`;
  wsSend({ type: 'theme', name });   // live-retheme any connected overlays
  if (!quiet) toast(`THEME: ${name}`);
  scheduleSession();
}

function cycleTheme() {
  applyTheme(THEME_NAMES[(THEME_NAMES.indexOf(themeName) + 1) % THEME_NAMES.length]);
}

// ------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------
const els = {
  amp: $('#amp'), deck: $('.deck'), titlebar: $('.titlebar'), deckContextMenu: $('#deckContextMenu'),
  timeMain: $('#timeMain'), playState: $('#playState'),
  vis: $('#vis'), marquee: $('.marquee'), marqueeText: $('#marqueeText'),
  kbps: $('#kbps'), khz: $('#khz'), chan: $('#chan'),
  seek: $('#seek'), vol: $('#vol'), volVal: $('#volVal'),
  bal: $('#bal'), balVal: $('#balVal'),
  btnShuffle: $('#btnShuffle'), btnRepeat: $('#btnRepeat'), btnNorm: $('#btnNorm'), btnVis: $('#btnVis'),
  btnPrev: $('#btnPrev'), btnPlay: $('#btnPlay'), btnPause: $('#btnPause'),
  btnStop: $('#btnStop'), btnNext: $('#btnNext'), btnEject: $('#btnEject'),
  btnEqToggle: $('#btnEqToggle'), btnPlToggle: $('#btnPlToggle'), btnTheme: $('#btnTheme'),
  eqPanel: $('#eqPanel'), eqBands: $('#eqBands'),
  btnDsp: $('#btnDsp'), btnEqOn: $('#btnEqOn'), btnEqObs: $('#btnEqObs'), eqPreset: $('#eqPreset'), art: $('#art'),
  plPanel: $('#plPanel'), plList: $('#plList'), plName: $('#plName'), plTotal: $('#plTotal'),
  btnAdd: $('#btnAdd'), btnRem: $('#btnRem'), btnClr: $('#btnClr'),
  btnUtil: $('#btnUtil'), btnSave: $('#btnSave'), btnLoad: $('#btnLoad'),
  modal: $('#modal'), modalTitle: $('#modalTitle'),
  modalBody: $('#modalBody'), modalClose: $('#modalClose'), toast: $('#toast')
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}
function fmtClock(s) {  // main LCD, mm:ss padded
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.round(s);
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(msg, warn = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('warn', warn);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function closeDeckContextMenu() {
  els.deckContextMenu.classList.add('hidden');
  els.deckContextMenu.innerHTML = '';
}

function showDeckContextMenu(x, y, label, items) {
  closeDeckContextMenu();
  const heading = document.createElement('div');
  heading.className = 'ctxlabel';
  heading.textContent = label;
  els.deckContextMenu.appendChild(heading);
  for (const item of items) {
    if (!item) {
      const separator = document.createElement('div');
      separator.className = 'ctxsep';
      separator.role = 'separator';
      els.deckContextMenu.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    button.disabled = !!item.disabled;
    button.classList.toggle('active', !!item.active);
    button.classList.toggle('danger', !!item.danger);
    button.innerHTML = '<span class="ctxicon"></span><span class="ctxtext"></span><span class="ctxhint"></span>';
    button.querySelector('.ctxicon').textContent = item.icon || '›';
    button.querySelector('.ctxtext').textContent = item.label;
    button.querySelector('.ctxhint').textContent = item.hint || '';
    button.addEventListener('click', () => {
      if (button.disabled) return;
      closeDeckContextMenu();
      Promise.resolve(item.action?.()).catch((error) => toast(error.message || 'ACTION FAILED', true));
    });
    els.deckContextMenu.appendChild(button);
  }
  els.deckContextMenu.style.left = '0px';
  els.deckContextMenu.style.top = '0px';
  els.deckContextMenu.classList.remove('hidden');
  const rect = els.deckContextMenu.getBoundingClientRect();
  els.deckContextMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  els.deckContextMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  els.deckContextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

async function copyDeckText(value, message) {
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
  toast(message);
}

els.deckContextMenu.addEventListener('contextmenu', (event) => event.preventDefault());
els.deckContextMenu.addEventListener('keydown', (event) => {
  event.stopPropagation();
  const buttons = [...els.deckContextMenu.querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeDeckContextMenu();
  }
});
document.addEventListener('pointerdown', (event) => { if (!els.deckContextMenu.contains(event.target)) closeDeckContextMenu(); });
window.addEventListener('blur', closeDeckContextMenu);
window.addEventListener('resize', closeDeckContextMenu);
window.addEventListener('scroll', closeDeckContextMenu);

function trackLabel(t) {
  return t.artist ? `${t.artist} - ${t.title}` : t.title;
}
// Must match server.js's trackRef().key exactly, storage by storage — this
// is what a /ws {type:'loudness'} push's trackKey is compared against to
// apply a just-finished analysis to the track currently playing. Getting
// the scheme wrong here means live gain updates from analyzeLoudness()
// silently never match: a first-time play of a fresh track sits at unity
// gain for that session (only correct on the *next* play, once cached),
// while everything already-cached normalizes as expected — "some tracks
// play louder than others" with no apparent pattern.
function trackKey(t) {
  if (!t) return '';
  if (t.storage === 'path') return `path:${t.sourceId || ''}`;
  if (t.storage === 'youtube') return `youtube:${t.file || ''}`;
  if (t.storage === 'playlist' && t.playlist) return `playlist:${t.playlist}:${t.file || ''}`;
  if (t.storage === 'radio') return `radio:${t.stationId || t.file || ''}`;
  return t.file || ''; // library — server's key is the bare relative path
}
function encodedTrackPath(file) {
  return String(file || '').split('/').map(encodeURIComponent).join('/');
}
function trackUrl(t) {
  if (t.storage === 'radio') {
    const q = new URLSearchParams({ url: t.url || '', name: t.title || 'Internet Radio' });
    return `/api/radio/${encodeURIComponent(t.stationId || t.file)}/stream?${q}`;
  }
  if (t.storage === 'playlist' && t.playlist) {
    return `/playlist-media/${encodeURIComponent(t.playlist)}/${encodedTrackPath(t.file)}`;
  }
  if (t.storage === 'path' && t.sourceId) return `/path-media/${encodeURIComponent(t.sourceId)}`;
  if (t.storage === 'youtube') return `/youtube-media/${encodedTrackPath(t.file)}`;
  return '/music/' + encodedTrackPath(t.file);
}
function mediaApiUrl(endpoint, t) {
  const q = new URLSearchParams({
    file: t.file,
    storage: t.storage === 'playlist' ? 'playlist' : t.storage === 'path' ? 'path' : t.storage === 'youtube' ? 'youtube' : 'library'
  });
  if (t.storage === 'playlist' && t.playlist) q.set('playlist', t.playlist);
  if (t.storage === 'path' && t.sourceId) q.set('source', t.sourceId);
  return `/api/${endpoint}?${q}`;
}
function setRangeFill(input, pct) {
  input.style.setProperty('--p', `${Math.max(0, Math.min(100, pct))}%`);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const DSP_DEFS = {
  compressor: { name: 'COMPRESSOR', min: 0, max: 1, step: .05, value: .55 },
  limiter:    { name: 'LIMITER', min: 0, max: 1, step: .05, value: .75 },
  width:      { name: 'STEREO WIDTH', min: 0, max: 2, step: .05, value: 1.25 },
  mono:       { name: 'MONO', min: 0, max: 1, step: 1, value: 1 },
  bass:       { name: 'BASS BOOST', min: 0, max: 12, step: .5, value: 6 },
  reverb:     { name: 'REVERB', min: 0, max: .65, step: .05, value: .25 }
};
const DSP_PRESETS = {
  CLEAN: [],
  BROADCAST: [
    { type: 'compressor', value: .55 }, { type: 'limiter', value: .8 }
  ],
  'BASS CLUB': [
    { type: 'bass', value: 7 }, { type: 'compressor', value: .45 },
    { type: 'width', value: 1.3 }, { type: 'limiter', value: .8 }
  ],
  'WIDE SPACE': [
    { type: 'width', value: 1.55 }, { type: 'reverb', value: .3 }, { type: 'limiter', value: .7 }
  ],
  'MONO RADIO': [
    { type: 'mono', value: 1 }, { type: 'compressor', value: .65 }, { type: 'limiter', value: .85 }
  ]
};

function newDspModule(type, value) {
  const def = DSP_DEFS[type];
  return def ? { id: crypto.randomUUID(), type, enabled: true, value: Number.isFinite(value) ? value : def.value } : null;
}

function sanitizeDspModules(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 16).map((m) => {
    const def = DSP_DEFS[m?.type];
    if (!def) return null;
    const value = Math.max(def.min, Math.min(def.max, Number(m.value)));
    return { id: String(m.id || crypto.randomUUID()), type: m.type, enabled: m.enabled !== false, value: Number.isFinite(value) ? value : def.value };
  }).filter(Boolean);
}

// ------------------------------------------------------------
// Audio element + Web Audio graph (built lazily on first play,
// because AudioContext needs a user gesture)
// ------------------------------------------------------------
const audio = new Audio();
audio.preload = 'auto';

let actx = null, preamp = null, panner = null, analyser = null;
let levelMeter = null, outputGain = null, safetyLimiter = null, masterGain = null;
const filters = [];
let dspAudioNodes = [];
let levelBuffer = null, levelPower = null, levelTrimDb = 0, levelSampleAt = 0;

// Track normalization gets every source to the same integrated LUFS before
// EQ/DSP. A bright or bass-heavy EQ can add different amounts of energy to
// different songs, so this final stage gently turns only the louder results
// down. It never boosts silence or fights the dynamics of quieter passages.
const LEVEL_TARGET_DBFS = -18;
const LEVEL_FLOOR_DBFS = -48;
const LEVEL_MAX_ATTENUATION_DB = -6;

function resetOutputLeveler(resetGain = false) {
  levelPower = null;
  levelSampleAt = 0;
  if (!resetGain) return;
  levelTrimDb = 0;
  if (outputGain && actx) {
    outputGain.gain.cancelScheduledValues(actx.currentTime);
    outputGain.gain.setValueAtTime(1, actx.currentTime);
  }
}

function updateOutputLeveler() {
  if (!actx || !levelMeter || !outputGain) return;
  if (!normalize || audio.paused || actx.state !== 'running') {
    if (!normalize && Math.abs(levelTrimDb) > .02) {
      levelTrimDb = 0;
      outputGain.gain.cancelScheduledValues(actx.currentTime);
      outputGain.gain.setTargetAtTime(1, actx.currentTime, .35);
    }
    return;
  }
  if (!levelBuffer || levelBuffer.length !== levelMeter.fftSize) levelBuffer = new Float32Array(levelMeter.fftSize);
  levelMeter.getFloatTimeDomainData(levelBuffer);
  let sum = 0;
  for (let i = 0; i < levelBuffer.length; i++) sum += levelBuffer[i] * levelBuffer[i];
  const power = sum / levelBuffer.length;
  if (!(power > 0)) return;
  const instantDb = 10 * Math.log10(power);
  if (instantDb < LEVEL_FLOOR_DBFS) return;

  const now = performance.now();
  const elapsed = levelSampleAt ? Math.min(1, (now - levelSampleAt) / 1000) : .2;
  levelSampleAt = now;
  const averageAlpha = 1 - Math.exp(-elapsed / 2.5);
  levelPower = levelPower === null ? power : levelPower + (power - levelPower) * averageAlpha;
  const averageDb = 10 * Math.log10(Math.max(1e-9, levelPower));
  let wantedDb = Math.max(LEVEL_MAX_ATTENUATION_DB, Math.min(0, LEVEL_TARGET_DBFS - averageDb));
  if (Math.abs(wantedDb - levelTrimDb) < .2) wantedDb = levelTrimDb;

  // Loud material is caught quickly; attenuation releases slowly so quiet
  // intros and gaps do not make the following hit jump in volume.
  const reducing = wantedDb < levelTrimDb;
  const responseSeconds = reducing ? .55 : 5;
  const responseAlpha = 1 - Math.exp(-elapsed / responseSeconds);
  levelTrimDb += (wantedDb - levelTrimDb) * responseAlpha;
  outputGain.gain.cancelScheduledValues(actx.currentTime);
  outputGain.gain.setTargetAtTime(Math.pow(10, levelTrimDb / 20), actx.currentTime, reducing ? .12 : .8);
}

setInterval(updateOutputLeveler, 200);

function createWidthStage(width) {
  const input = actx.createGain();
  const splitter = actx.createChannelSplitter(2);
  const merger = actx.createChannelMerger(2);
  const ll = actx.createGain(), lr = actx.createGain(), rl = actx.createGain(), rr = actx.createGain();
  const direct = (1 + width) / 2;
  const cross = (1 - width) / 2;
  ll.gain.value = direct; rr.gain.value = direct;
  lr.gain.value = cross; rl.gain.value = cross;
  input.connect(splitter);
  splitter.connect(ll, 0); splitter.connect(lr, 0);
  splitter.connect(rl, 1); splitter.connect(rr, 1);
  ll.connect(merger, 0, 0); rl.connect(merger, 0, 0);
  lr.connect(merger, 0, 1); rr.connect(merger, 0, 1);
  return { input, output: merger, nodes: [input, splitter, ll, lr, rl, rr, merger] };
}

function createDspStage(module) {
  const v = Number(module.value);
  if (module.type === 'width') return createWidthStage(v);
  if (module.type === 'mono') return createWidthStage(0);
  if (module.type === 'bass') {
    const node = actx.createBiquadFilter();
    node.type = 'lowshelf'; node.frequency.value = 120; node.gain.value = v;
    return { input: node, output: node, nodes: [node] };
  }
  if (module.type === 'compressor' || module.type === 'limiter') {
    const node = actx.createDynamicsCompressor();
    if (module.type === 'limiter') {
      node.threshold.value = -1 - (1 - v) * 5; node.knee.value = 0;
      node.ratio.value = 20; node.attack.value = .001; node.release.value = .06;
    } else {
      node.threshold.value = -12 - v * 24; node.knee.value = 24;
      node.ratio.value = 2 + v * 8; node.attack.value = .006; node.release.value = .22;
    }
    return { input: node, output: node, nodes: [node] };
  }
  if (module.type === 'reverb') {
    const input = actx.createGain(), output = actx.createGain();
    const dry = actx.createGain(), wet = actx.createGain(), convolver = actx.createConvolver();
    const seconds = 1.6, length = Math.floor(actx.sampleRate * seconds);
    const impulse = actx.createBuffer(2, length, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    convolver.buffer = impulse;
    dry.gain.value = 1 - v * .35; wet.gain.value = v;
    input.connect(dry); dry.connect(output);
    input.connect(convolver); convolver.connect(wet); wet.connect(output);
    return { input, output, nodes: [input, dry, wet, convolver, output] };
  }
  return null;
}

function rebuildAudioChain() {
  if (!actx || !preamp || !analyser) return;
  for (const node of [preamp, ...filters, ...dspAudioNodes, levelMeter, outputGain, safetyLimiter, panner].filter(Boolean)) {
    try { node.disconnect(); } catch { /* disconnected */ }
  }
  dspAudioNodes = [];
  let node = preamp;
  for (const filter of filters) { node.connect(filter); node = filter; }
  for (const module of dspModules.filter((m) => m.enabled)) {
    const stage = createDspStage(module);
    if (!stage) continue;
    node.connect(stage.input);
    node = stage.output;
    dspAudioNodes.push(...stage.nodes);
  }
  node.connect(levelMeter); node = levelMeter;
  node.connect(outputGain); node = outputGain;
  node.connect(safetyLimiter); node = safetyLimiter;
  if (panner) { node.connect(panner); panner.connect(masterGain); }
  else node.connect(masterGain);
  resetOutputLeveler(false);
}

function ensureGraph() {
  if (actx) { actx.resume().catch(() => {}); return actx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // exotic browser: plain <audio> still plays, no vis/EQ
  actx = new AC();
  const src = actx.createMediaElementSource(audio);
  preamp = actx.createGain();
  preamp.gain.value = 1;
  applyNormGain();

  EQ_FREQS.forEach((f, i) => {
    const b = actx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.0;
    b.gain.value = eqOn ? eqVals[i] : 0;
    filters.push(b);
  });

  panner = actx.createStereoPanner ? actx.createStereoPanner() : null;
  levelMeter = actx.createAnalyser();
  levelMeter.fftSize = 2048;
  levelMeter.smoothingTimeConstant = 0;
  outputGain = actx.createGain();
  safetyLimiter = actx.createDynamicsCompressor();
  safetyLimiter.threshold.value = -1.5;
  safetyLimiter.knee.value = 0;
  safetyLimiter.ratio.value = 20;
  safetyLimiter.attack.value = .002;
  safetyLimiter.release.value = .08;
  masterGain = actx.createGain();
  analyser = actx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;

  src.connect(preamp);
  if (panner) panner.pan.value = Number(els.bal.value) / 100;
  masterGain.connect(analyser);
  analyser.connect(actx.destination);
  rebuildAudioChain();
  applyVolume();
  return actx;
}

// ------------------------------------------------------------
// Visualizer — log-grouped spectrum bars, amber peak caps
// ------------------------------------------------------------
const BARS = 44;
const peaks = new Float32Array(BARS);
let visBuf = null, waveBuf = null, visGrad = null, visW = 0, visH = 0;
let waterfallRows = [];
let waterfallAt = 0;
let visParticles = [];

function sizeVis() {
  const dpr = window.devicePixelRatio || 1;
  visW = els.vis.clientWidth;
  visH = els.vis.clientHeight;
  els.vis.width = Math.max(1, Math.round(visW * dpr));
  els.vis.height = Math.max(1, Math.round(visH * dpr));
  const g = els.vis.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  visGrad = g.createLinearGradient(0, visH, 0, 0);
  visGrad.addColorStop(0, VIS_COLORS.c1);
  visGrad.addColorStop(0.6, VIS_COLORS.c2);
  visGrad.addColorStop(1, VIS_COLORS.c3);
}

function drawVis() {
  requestAnimationFrame(drawVis);
  const g = els.vis.getContext('2d');
  g.clearRect(0, 0, visW, visH);
  if (visMode === 'off') { drawOffGrid(g); return; }
  if (visMode === 'scope') { drawScope(g); return; }
  if (visMode === 'vu') { drawVU(g); return; }
  if (visMode === 'radial') { drawRadial(g); return; }
  if (visMode === 'waterfall') { drawWaterfall(g); return; }
  if (visMode === 'dots') { drawDots(g); return; }
  if (visMode === 'particles') { drawParticles(g); return; }
  drawBars(g);
}

function spectrumLevels(count) {
  if (!analyser) return null;
  if (!visBuf || visBuf.length !== analyser.frequencyBinCount) visBuf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(visBuf);
  const usable = Math.floor(visBuf.length * .72);
  const levels = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const lo = Math.floor(usable * Math.pow(i / count, 1.8));
    const hi = Math.max(lo + 1, Math.floor(usable * Math.pow((i + 1) / count, 1.8)));
    let value = 0;
    for (let j = lo; j < hi; j++) value = Math.max(value, visBuf[j]);
    levels[i] = value / 255;
  }
  return levels;
}

function drawBars(g) {
  const levels = spectrumLevels(BARS);
  const gap = 2;
  const bw = Math.max(2, (visW - gap * (BARS - 1)) / BARS);
  for (let i = 0; i < BARS; i++) {
    const x = i * (bw + gap);
    const v = levels ? levels[i] : 0;
    const h = Math.max(1, v * (visH - 6));
    g.fillStyle = visGrad;
    g.globalAlpha = levels ? 0.95 : 0.18;
    g.fillRect(x, visH - h, bw, h);
    peaks[i] = Math.max(peaks[i] - 0.9, h);
    g.globalAlpha = 1;
    g.fillStyle = VIS_COLORS.peak;
    g.fillRect(x, visH - peaks[i] - 3, bw, 2);
  }
  g.globalAlpha = 1;
}

function drawScope(g) {
  if (!analyser) { drawOffGrid(g); return; }
  if (!waveBuf) waveBuf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(waveBuf);
  g.lineWidth = 2;
  g.strokeStyle = VIS_COLORS.c1;
  g.shadowColor = VIS_COLORS.c1;
  g.shadowBlur = 6;
  g.beginPath();
  const n = waveBuf.length;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * visW;
    const y = (waveBuf[i] / 255) * (visH - 4) + 2;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.shadowBlur = 0;
  // magenta echo, slightly attenuated
  g.globalAlpha = 0.35;
  g.strokeStyle = VIS_COLORS.c3;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * visW;
    const y = visH - ((waveBuf[i] / 255) * (visH - 4) + 2);
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.globalAlpha = 1;
}

let vuLevel = 0, vuPeak = 0;
function drawVU(g) {
  if (analyser) {
    if (!waveBuf) waveBuf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(waveBuf);
    let sum = 0;
    for (let i = 0; i < waveBuf.length; i++) {
      const d = (waveBuf[i] - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / waveBuf.length);
    const target = Math.min(1, rms * 2.6);
    vuLevel += (target - vuLevel) * (target > vuLevel ? 0.5 : 0.08);
  } else {
    vuLevel *= 0.9;
  }
  vuPeak = Math.max(vuPeak - 0.006, vuLevel);

  const SEGS = 26;
  const gap = 3;
  const sw = (visW - gap * (SEGS - 1)) / SEGS;
  const y = Math.round(visH * 0.28);
  const h = Math.round(visH * 0.44);
  const lit = Math.round(vuLevel * SEGS);
  const peakSeg = Math.min(SEGS - 1, Math.round(vuPeak * SEGS));
  for (let i = 0; i < SEGS; i++) {
    const x = i * (sw + gap);
    const frac = i / SEGS;
    const color = frac < 0.62 ? VIS_COLORS.c1 : frac < 0.85 ? VIS_COLORS.peak : VIS_COLORS.c3;
    g.fillStyle = color;
    g.globalAlpha = i < lit ? 0.95 : 0.14;
    g.fillRect(x, y, sw, h);
    if (i === peakSeg) {
      g.globalAlpha = 1;
      g.fillRect(x, y - 5, sw, 3);
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = VIS_COLORS.dim;
  g.font = '9px "Share Tech Mono", monospace';
  g.fillText('VU', 2, y - 6);
}

function drawRadial(g) {
  const levels = spectrumLevels(40);
  const cx = visW / 2, cy = visH / 2;
  const base = Math.min(visH * .19, 17);
  const bass = levels ? (levels[0] + levels[1] + levels[2]) / 3 : 0;
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = VIS_COLORS.c2;
  g.globalAlpha = .25;
  g.beginPath(); g.arc(0, 0, base + 3, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2 - Math.PI / 2;
    const value = levels ? levels[i] : .04;
    const inner = base + bass * 3;
    const outer = inner + 2 + value * Math.min(24, visH * .3);
    g.strokeStyle = i % 3 === 0 ? VIS_COLORS.c3 : VIS_COLORS.c1;
    g.globalAlpha = levels ? .45 + value * .55 : .15;
    g.lineWidth = i % 4 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    g.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    g.stroke();
  }
  g.fillStyle = VIS_COLORS.peak;
  g.globalAlpha = .2 + bass * .75;
  g.shadowColor = VIS_COLORS.peak; g.shadowBlur = 9;
  g.beginPath(); g.arc(0, 0, Math.max(2, base * (.28 + bass * .45)), 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawWaterfall(g) {
  const columns = 32;
  const levels = spectrumLevels(columns) || new Float32Array(columns);
  const now = performance.now();
  if (now - waterfallAt > 45) {
    waterfallRows.unshift(levels);
    waterfallRows = waterfallRows.slice(0, 18);
    waterfallAt = now;
  }
  const cw = visW / columns;
  const rh = Math.max(2, visH / 18);
  waterfallRows.forEach((row, y) => {
    row.forEach((value, x) => {
      g.fillStyle = value > .72 ? VIS_COLORS.peak : value > .38 ? VIS_COLORS.c3 : VIS_COLORS.c1;
      g.globalAlpha = Math.max(.04, value * (1 - y / 24));
      g.fillRect(x * cw, y * rh, Math.ceil(cw), Math.ceil(rh));
    });
  });
  g.globalAlpha = 1;
  g.strokeStyle = VIS_COLORS.c2; g.globalAlpha = .35;
  g.strokeRect(.5, .5, visW - 1, visH - 1);
  g.globalAlpha = 1;
}

function drawDots(g) {
  const columns = 28, rows = 9;
  const levels = spectrumLevels(columns);
  const gap = 2;
  const dotW = Math.max(2, (visW - gap * (columns - 1)) / columns);
  const dotH = Math.max(2, (visH - gap * (rows - 1)) / rows);
  for (let x = 0; x < columns; x++) {
    const lit = levels ? Math.round(levels[x] * rows) : 0;
    for (let y = 0; y < rows; y++) {
      const fromBottom = rows - y;
      const frac = fromBottom / rows;
      g.fillStyle = frac > .78 ? VIS_COLORS.c3 : frac > .55 ? VIS_COLORS.peak : VIS_COLORS.c1;
      g.globalAlpha = fromBottom <= lit ? .95 : .09;
      g.fillRect(x * (dotW + gap), y * (dotH + gap), dotW, dotH);
    }
  }
  g.globalAlpha = 1;
}

function drawParticles(g) {
  const levels = spectrumLevels(20);
  const bass = levels ? (levels[0] + levels[1] + levels[2] + levels[3]) / 4 : 0;
  const cx = visW / 2, cy = visH / 2;
  if (bass > .12 && visParticles.length < 110) {
    const count = 1 + Math.floor(bass * 4);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = .25 + bass * 2.1 + Math.random() * .7;
      visParticles.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, size: 1 + Math.random() * 2.4, color: Math.random() > .55 ? VIS_COLORS.c1 : VIS_COLORS.c3 });
    }
  }
  g.strokeStyle = VIS_COLORS.c2; g.globalAlpha = .18 + bass * .35;
  g.beginPath(); g.arc(cx, cy, 5 + bass * 12, 0, Math.PI * 2); g.stroke();
  visParticles = visParticles.filter((p) => {
    p.x += p.vx; p.y += p.vy; p.vx *= .995; p.vy *= .995; p.life -= .012;
    if (p.life <= 0 || p.x < -5 || p.x > visW + 5 || p.y < -5 || p.y > visH + 5) return false;
    g.fillStyle = p.color; g.globalAlpha = p.life;
    g.shadowColor = p.color; g.shadowBlur = 4;
    g.fillRect(p.x, p.y, p.size, p.size);
    return true;
  });
  g.shadowBlur = 0; g.globalAlpha = 1;
}

function drawOffGrid(g) {
  g.globalAlpha = 0.12;
  g.strokeStyle = VIS_COLORS.c1;
  g.lineWidth = 1;
  for (let x = 0; x <= visW; x += 22) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, visH); g.stroke();
  }
  g.beginPath(); g.moveTo(0, visH - 1); g.lineTo(visW, visH - 1); g.stroke();
  g.globalAlpha = 1;
}

function setVisualizer(mode, quiet = false) {
  if (!VIS_MODES.includes(mode)) return;
  visMode = mode;
  waterfallRows = [];
  visParticles = [];
  els.btnVis?.classList.toggle('active', mode !== 'off');
  if (els.btnVis) els.btnVis.title = `Visualizer: ${VIS_LABELS[mode]}`;
  if (!quiet) {
    toast(`VIS: ${VIS_LABELS[mode]}`);
    scheduleSession();
  }
}

function cycleVis() {
  setVisualizer(VIS_MODES[(VIS_MODES.indexOf(visMode) + 1) % VIS_MODES.length]);
}

function openVisualizerPicker() {
  const body = openModal('VISUALIZER SELECT');
  body.innerHTML = `<div class="utilgrid vispicker">${VIS_MODES.map((mode) =>
    `<button class="btn${mode === visMode ? ' active' : ''}" data-vis="${mode}">${VIS_LABELS[mode]}</button>`
  ).join('')}</div><div class="mhint">CLICK THE DECK CANVAS TO CYCLE ▸ THIS SELECTION PERSISTS ▸ OBS: ?vis=MODE</div>`;
  body.querySelector('.vispicker').addEventListener('click', (e) => {
    const mode = e.target.closest('[data-vis]')?.dataset.vis;
    if (!mode) return;
    setVisualizer(mode);
    closeModal();
  });
}

// ------------------------------------------------------------
// Marquee
// ------------------------------------------------------------
let marqueeBase = '';
function setMarquee(text) {
  marqueeBase = text;
  const span = els.marqueeText;
  els.marquee.classList.remove('scrolling');
  span.style.removeProperty('--marq-w');
  span.textContent = text;
  requestAnimationFrame(() => {
    const boxW = els.marquee.clientWidth;
    if (span.scrollWidth > boxW) {
      const sep = '  ▞▞  ';
      span.textContent = text + sep + text + sep;
      const half = span.scrollWidth / 2;
      span.style.setProperty('--marq-w', `${half}px`);
      span.style.setProperty('--marq-dur', `${Math.max(8, half / 42)}s`);
      els.marquee.classList.add('scrolling');
    }
  });
}

// ------------------------------------------------------------
// Now-playing display
// ------------------------------------------------------------
function artUrl(t) {
  return mediaApiUrl('art', t);
}
function setArt(t) {
  if (!t || t.storage === 'radio') { els.art.classList.add('hidden'); els.art.removeAttribute('src'); return; }
  els.art.src = artUrl(t);
}
els.art.addEventListener('load', () => els.art.classList.remove('hidden'));
els.art.addEventListener('error', () => els.art.classList.add('hidden'));

function updateMeta(t) {
  els.kbps.textContent = t && t.bitrate ? `${t.bitrate} KBPS` : '--- KBPS';
  els.khz.textContent = t && t.sampleRate ? `${Math.round(t.sampleRate / 1000)} KHZ` : '-- KHZ';
  els.chan.textContent = t && t.channels === 1 ? 'MONO' : 'STEREO';
  [els.kbps, els.khz, els.chan].forEach((el) => el.classList.toggle('lit', !!t));
  setArt(t);
}

function setPlayState(state) {
  const map = { play: '▶ PLAYING', pause: '❚❚ PAUSED', stop: '■ STOPPED' };
  els.playState.textContent = map[state];
  els.playState.classList.toggle('on', state === 'play');
  els.btnPlay.classList.toggle('lit', state === 'play');
  els.btnPause.classList.toggle('lit', state === 'pause');
  lastPlayState = state;
  sendState();
  scheduleSession();
}

// ------------------------------------------------------------
// Transport
// ------------------------------------------------------------

// Follow playback: keep the current row visible in the playlist.
// 'center' for big jumps (resume), 'nearest' for gentle track-to-track.
function scrollCurrentIntoView(block = 'nearest') {
  requestAnimationFrame(() => {
    const row = els.plList.querySelector('li.current');
    if (row) row.scrollIntoView({ block, behavior: 'auto' });
  });
}

function playIndex(i) {
  if (i < 0 || i >= pl.length) return;
  ensureGraph();
  cur = i;
  sel = i;
  const t = pl[i];
  clearTimeout(radioRetryTimer);
  radioRetry = 0;
  currentRadioTitle = '';
  audio.src = trackUrl(t);
  audio.play().catch(() => {});
  fetchNormGain(t);
  setMarquee(`${trackLabel(t)}  ::  NEONAMP`);
  updateMeta(t);
  document.title = `${trackLabel(t)} — NEONAMP`;
  renderPlaylist();
  scrollCurrentIntoView('nearest');
}

function doPlay() {
  if (cur >= 0 && audio.src) {
    ensureGraph();
    audio.play().catch(() => {});
  } else if (pl.length) {
    playIndex(sel >= 0 ? sel : 0);
  } else {
    toast('QUEUE IS EMPTY — ADD TRACKS FIRST', true);
  }
}

function doPause() {
  if (!audio.src) return;
  if (audio.paused) { ensureGraph(); audio.play().catch(() => {}); }
  else audio.pause();
}

function doStop() {
  clearTimeout(radioRetryTimer);
  radioRetry = 0;
  audio.pause();
  if (audio.src) audio.currentTime = 0;
  setPlayState('stop');
  els.timeMain.textContent = '00:00';
  els.seek.value = 0;
  setRangeFill(els.seek, 0);
}

function pickShuffle() {
  if (pl.length <= 1) return 0;
  let j;
  do { j = Math.floor(Math.random() * pl.length); } while (j === cur);
  return j;
}

function doNext(auto = false) {
  if (!pl.length) return;
  if (shuffle) {
    if (cur >= 0) playHistory.push(cur);
    if (playHistory.length > 100) playHistory.shift();
    playIndex(pickShuffle());
    return;
  }
  const base = cur >= 0 ? cur : (sel >= 0 ? sel - 1 : -1);
  let n = base + 1;
  if (n >= pl.length) {
    if (repeat === 'all') n = 0;
    else { if (auto) doStop(); return; }
  }
  playIndex(n);
}

function doPrev() {
  if (!pl.length) return;
  if (audio.src && audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (shuffle && playHistory.length) { playIndex(playHistory.pop()); return; }
  const base = cur >= 0 ? cur : (sel >= 0 ? sel : 0);
  let p = base - 1;
  if (p < 0) p = repeat === 'all' ? pl.length - 1 : 0;
  playIndex(p);
}

// ------------------------------------------------------------
// Playlist rendering + mutations
// ------------------------------------------------------------
function renderPlaylist() {
  const list = els.plList;
  list.innerHTML = '';
  let total = 0;
  pl.forEach((t, i) => {
    total += t.duration || 0;
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.i = i;
    if (i === cur) li.classList.add('current');
    if (i === sel) li.classList.add('selected');
    li.innerHTML =
      `<span class="num">${String(i + 1).padStart(2, '0')}.</span>` +
      `<span class="name"></span>` +
      `<span class="dur">${t.storage === 'radio' ? 'LIVE' : (t.duration ? fmtTime(t.duration) : '--:--')}</span>`;
    li.querySelector('.name').textContent = trackLabel(t);
    list.appendChild(li);
  });
  els.plTotal.textContent = `${pl.length} TRK / ${fmtTime(total)}`;
  els.plName.textContent = currentName ? `[${currentName}]` : '';
}

function addTrack(t, andPlay = false) {
  pl.push({
    file: t.file, title: t.title, artist: t.artist,
    album: t.album || '', genre: t.genre || '', year: t.year || '',
    artistUrl: t.artistUrl || '', comment: t.comment || '',
    duration: t.duration || 0, bitrate: t.bitrate || 0,
    sampleRate: t.sampleRate || 0, channels: t.channels || 2,
    storage: t.storage || 'library',
    ...(t.storage === 'radio' ? {
      stationId: t.stationId || t.file, url: t.url || '', homepage: t.homepage || ''
    } : {}),
    ...(t.storage === 'youtube' ? { videoId: t.videoId || '', sourceUrl: t.sourceUrl || '' } : {}),
    ...(t.playlist ? { playlist: t.playlist } : {}),
    ...(t.sourceId ? { sourceId: t.sourceId } : {}),
    ...(t.originalFile ? { originalFile: t.originalFile } : {})
  });
  renderPlaylist();
  scheduleSession();
  if (andPlay) playIndex(pl.length - 1);
}

function removeAt(i) {
  if (i < 0 || i >= pl.length) return;
  pl.splice(i, 1);
  if (i === cur) cur = -1;        // playing track left the queue; audio keeps rolling
  else if (i < cur) cur--;
  if (sel >= pl.length) sel = pl.length - 1;
  renderPlaylist();
  scheduleSession();
}

function moveTrack(from, to) {
  if (from === to || from < 0 || to < 0 || from >= pl.length || to >= pl.length) return;
  const [item] = pl.splice(from, 1);
  pl.splice(to, 0, item);
  const remap = (x) => {
    if (x === from) return to;
    if (from < x && to >= x) return x - 1;
    if (from > x && to <= x) return x + 1;
    return x;
  };
  cur = cur >= 0 ? remap(cur) : cur;
  sel = sel >= 0 ? remap(sel) : sel;
  renderPlaylist();
  scheduleSession();
}

function replaceQueue(next, label) {
  const currentTrack = cur >= 0 ? pl[cur] : null;
  const selectedTrack = sel >= 0 ? pl[sel] : null;
  pl = next;
  cur = currentTrack ? pl.indexOf(currentTrack) : -1;
  sel = selectedTrack ? pl.indexOf(selectedTrack) : (pl.length ? 0 : -1);
  if (sel < 0 && pl.length) sel = 0;
  playHistory = [];
  renderPlaylist();
  scheduleSession();
  toast(`${label} — ${pl.length} TRK`);
}

async function removeMissingFromQueue() {
  toast('CHECKING QUEUE SOURCES…');
  const keep = await Promise.all(pl.map(async (t) => {
    if (t.storage === 'radio') return true;
    try { return (await fetch(trackUrl(t), { method: 'HEAD' })).ok; } catch { return false; }
  }));
  const next = pl.filter((_t, i) => keep[i]);
  replaceQueue(next, `${pl.length - next.length} MISSING REMOVED`);
}

function openPlaylistUtilities() {
  const body = openModal('PLAYLIST UTILITIES');
  body.innerHTML = `
    <div class="utilgrid">
      <button class="btn" data-util="random">RANDOMIZE</button>
      <button class="btn" data-util="reverse">REVERSE</button>
      <button class="btn" data-util="dedupe">REMOVE DUPLICATES</button>
      <button class="btn" data-util="missing">REMOVE MISSING</button>
      <button class="btn" data-util="artist">SORT ARTIST</button>
      <button class="btn" data-util="title">SORT TITLE</button>
      <button class="btn" data-util="duration">SORT DURATION</button>
      <button class="btn" data-util="crop">CROP TO SELECTED</button>
      <button class="btn" data-util="albums">BUILD FROM ALBUMS</button>
    </div>
    <div class="mhint">UTILITIES UPDATE THE CURRENT QUEUE ▸ SAVE WHEN YOU WANT TO COMMIT THE RESULT AS A PLAYLIST</div>`;
  body.querySelector('.utilgrid').addEventListener('click', async (e) => {
    const action = e.target.closest('[data-util]')?.dataset.util;
    if (!action) return;
    if (!pl.length && action !== 'albums') { toast('QUEUE IS EMPTY', true); return; }
    if (action === 'random') {
      const next = pl.slice();
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      replaceQueue(next, 'QUEUE RANDOMIZED');
    } else if (action === 'reverse') replaceQueue(pl.slice().reverse(), 'QUEUE REVERSED');
    else if (action === 'dedupe') {
      const seen = new Set();
      replaceQueue(pl.filter((t) => { const k = trackKey(t); if (seen.has(k)) return false; seen.add(k); return true; }), 'DUPLICATES REMOVED');
    } else if (action === 'missing') await removeMissingFromQueue();
    else if (action === 'artist') replaceQueue(pl.slice().sort((a, b) => `${a.artist || ''} ${a.title || ''}`.localeCompare(`${b.artist || ''} ${b.title || ''}`, undefined, { sensitivity: 'base' })), 'SORTED BY ARTIST');
    else if (action === 'title') replaceQueue(pl.slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })), 'SORTED BY TITLE');
    else if (action === 'duration') replaceQueue(pl.slice().sort((a, b) => (a.duration || 0) - (b.duration || 0)), 'SORTED BY DURATION');
    else if (action === 'crop') {
      if (sel < 0 || !pl[sel]) { toast('SELECT A TRACK FIRST', true); return; }
      replaceQueue([pl[sel]], 'CROPPED TO SELECTION');
    } else if (action === 'albums') await openAlbumBuilder();
    if (action !== 'albums' && action !== 'missing') closeModal();
  });
}

async function openAlbumBuilder() {
  const groups = new Map();
  for (const t of pl.filter((item) => item.storage !== 'radio')) {
    const album = t.album || 'UNKNOWN ALBUM';
    const artist = t.artist || 'UNKNOWN ARTIST';
    const key = `${artist}\u0000${album}`;
    if (!groups.has(key)) groups.set(key, { artist, album, tracks: [] });
    groups.get(key).tracks.push(t);
  }
  const albums = [...groups.values()].sort((a, b) => `${a.artist} ${a.album}`.localeCompare(`${b.artist} ${b.album}`, undefined, { sensitivity: 'base' }));
  const body = openModal('BUILD PLAYLIST FROM ALBUMS');
  body.innerHTML = `<div class="albumlist" id="albumList"></div>
    <div class="mtools"><button class="btn" id="albumReplace">REPLACE QUEUE</button><button class="btn" id="albumAppend">APPEND</button></div>
    <div class="mhint">SELECT ONE OR MORE ALBUMS ▸ TRACK ORDER FOLLOWS THE CURRENT PLAYLIST</div>`;
  const list = $('#albumList');
  if (!albums.length) list.innerHTML = '<div class="mhint">NO ALBUM METADATA IN THE CURRENT PLAYLIST</div>';
  albums.forEach((album, i) => {
    const label = document.createElement('label');
    label.className = 'albumrow';
    label.innerHTML = `<input type="checkbox" value="${i}"><span class="name"></span><span class="sub">${album.tracks.length} TRK</span>`;
    label.querySelector('.name').textContent = `${album.artist} — ${album.album}`;
    list.appendChild(label);
  });
  const chosen = () => [...list.querySelectorAll('input:checked')].flatMap((input) => albums[Number(input.value)].tracks);
  const build = (append) => {
    const tracks = chosen();
    if (!tracks.length) { toast('SELECT AT LEAST ONE ALBUM', true); return; }
    const additions = tracks.map((t) => ({
      file: t.file, title: t.title, artist: t.artist, album: t.album || '', genre: t.genre || '', year: t.year || '',
      duration: t.duration || 0, bitrate: t.bitrate || 0, sampleRate: t.sampleRate || 0,
      channels: t.channels || 2, storage: t.storage || 'playlist',
      ...(t.playlist ? { playlist: t.playlist } : {}),
      ...(t.sourceId ? { sourceId: t.sourceId } : {}),
      ...(t.originalFile ? { originalFile: t.originalFile } : {})
    }));
    const selectedAlbums = list.querySelectorAll('input:checked').length;
    replaceQueue(append ? pl.concat(additions) : additions, `${selectedAlbums} ALBUM${selectedAlbums === 1 ? '' : 'S'} ADDED`);
    closeModal();
  };
  $('#albumReplace').addEventListener('click', () => build(false));
  $('#albumAppend').addEventListener('click', () => build(true));
}

// click select / double-click play.
// Double-click is detected manually (two clicks on the same row
// within 400ms) instead of relying on the native dblclick event —
// that survives row rebuilds, draggable rows, and jittery mice.
function paintSelection() {
  els.plList.querySelectorAll('li').forEach((li) => {
    const i = Number(li.dataset.i);
    li.classList.toggle('selected', i === sel);
    li.classList.toggle('current', i === cur);
  });
}
let plClickI = -1, plClickAt = 0;
els.plList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const i = Number(li.dataset.i);
  const now = Date.now();
  if (i === plClickI && now - plClickAt < 400) {
    plClickI = -1;
    playIndex(i);
    return;
  }
  plClickI = i;
  plClickAt = now;
  sel = i;
  paintSelection();
});
// drag to reorder
let dragFrom = -1;
els.plList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  dragFrom = Number(li.dataset.i);
  e.dataTransfer.effectAllowed = 'move';
});
els.plList.addEventListener('dragover', (e) => {
  e.preventDefault();
  const li = e.target.closest('li');
  els.plList.querySelectorAll('.dragover').forEach((n) => n.classList.remove('dragover'));
  if (li) li.classList.add('dragover');
});
els.plList.addEventListener('dragleave', (e) => {
  const li = e.target.closest('li');
  if (li) li.classList.remove('dragover');
});
els.plList.addEventListener('drop', (e) => {
  e.preventDefault();
  els.plList.querySelectorAll('.dragover').forEach((n) => n.classList.remove('dragover'));
  const li = e.target.closest('li');
  if (!li || dragFrom < 0) return;
  moveTrack(dragFrom, Number(li.dataset.i));
  dragFrom = -1;
});

// ------------------------------------------------------------
// Modal machinery
// ------------------------------------------------------------
function openModal(title) {
  closeDeckContextMenu();
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = '';
  els.modal.classList.remove('hidden');
  return els.modalBody;
}
function closeModal() { els.modal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });


// ------------------------------------------------------------
// M3U export for the queue or saved playlists.
// ------------------------------------------------------------
function buildM3U(tracks) {
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    lines.push(`#EXTINF:${t.duration || -1},${trackLabel(t)}`);
    lines.push(t.storage === 'radio' ? t.url : t.storage === 'youtube' ? (t.sourceUrl || t.file) : (t.originalFile || t.file));
  }
  return lines.join('\n') + '\n';
}

function downloadM3U(tracks, name) {
  const blob = new Blob([buildM3U(tracks)], { type: 'audio/x-mpegurl;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(name || 'neonamp-queue').replace(/[\\/:*?"<>|]/g, '_')}.m3u8`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`EXPORTED ${tracks.length} TRK → ${a.download.toUpperCase()}`);
}

function openPlaylistManager(trackIndex = null) {
  const params = new URLSearchParams();
  if (currentName) params.set('name', currentName);
  if (Number.isInteger(trackIndex) && trackIndex >= 0) params.set('track', String(trackIndex));
  const url = `/playlist${params.size ? `?${params}` : ''}`;
  const manager = window.open(url, 'neonamp-playlist');
  if (!manager) location.href = url;
}

function duplicateQueueEntry(index) {
  const track = pl[index];
  if (!track) return;
  pl.splice(index + 1, 0, { ...track });
  if (cur > index) cur++;
  sel = index + 1;
  renderPlaylist();
  scheduleSession();
  toast('TRACK ENTRY DUPLICATED');
}

function showQueueTrackContext(event, index) {
  const track = pl[index];
  if (!track) return;
  const radio = track.storage === 'radio';
  const filepath = track.storage === 'path';
  const youtube = track.storage === 'youtube';
  showDeckContextMenu(event.clientX, event.clientY, `TRACK ${String(index + 1).padStart(2, '0')} // ${track.title || 'UNKNOWN'}`, [
    { icon: '▶', label: 'Play now', hint: index === cur ? 'CURRENT' : '', action: () => playIndex(index) },
    { icon: '↗', label: 'Open in playlist manager', disabled: !currentName, action: () => openPlaylistManager(index) },
    ...(radio ? [
      { icon: '↻', label: 'Reconnect stream', action: () => playIndex(index) },
      { icon: '⧉', label: 'Copy stream URL', action: () => copyDeckText(track.url || '', 'STREAM URL COPIED') }
    ] : filepath ? [
      { icon: '⧉', label: 'Copy source filepath', action: () => copyDeckText(track.file || '', 'SOURCE FILEPATH COPIED') }
    ] : youtube ? [
      { icon: '⧉', label: 'Copy source URL', action: () => copyDeckText(track.sourceUrl || '', 'SOURCE URL COPIED') }
    ] : []),
    null,
    { icon: '↑', label: 'Move up', disabled: index <= 0, action: () => moveTrack(index, index - 1) },
    { icon: '↓', label: 'Move down', disabled: index >= pl.length - 1, action: () => moveTrack(index, index + 1) },
    { icon: '⧉', label: 'Duplicate entry', action: () => duplicateQueueEntry(index) },
    null,
    { icon: '✕', label: 'Remove from queue', danger: true, action: () => removeAt(index) }
  ]);
}

function showVisualizerContext(event) {
  showDeckContextMenu(event.clientX, event.clientY, 'VISUALIZER MODE', VIS_MODES.map((mode) => ({
    icon: mode === visMode ? '◆' : '◇', label: VIS_LABELS[mode], active: mode === visMode,
    action: () => setVisualizer(mode)
  })));
}

function showEqContext(event) {
  showDeckContextMenu(event.clientX, event.clientY, `EQUALIZER // ${eqPreset}`, [
    { icon: eqOn ? '◆' : '◇', label: eqOn ? 'Disable equalizer' : 'Enable equalizer', active: eqOn, action: () => setEqOn(!eqOn) },
    { icon: obsEq ? '◆' : '◇', label: 'Route EQ to OBS jukebox', active: obsEq, action: () => els.btnEqObs.click() },
    { icon: '▤', label: 'Open DSP rack', hint: `${dspModules.length} MOD`, action: openDspRack },
    null,
    ...['FLAT', 'NEON (I3C)', 'PARTY', 'ROCK', 'TECHNO'].map((name) => ({
      icon: eqPreset === name ? '◆' : '◇', label: `Preset: ${name}`, active: eqPreset === name, action: () => applyPreset(name)
    })),
    null,
    { icon: '−', label: 'Hide equalizer panel', action: () => els.btnEqToggle.click() }
  ]);
}

function showQueueContext(event) {
  showDeckContextMenu(event.clientX, event.clientY, `QUEUE // ${currentName || 'UNSAVED'}`, [
    { icon: '↗', label: 'Open playlist manager', action: openPlaylistManager },
    { icon: '⇧', label: 'Load saved playlist', action: openLoad },
    { icon: '✓', label: 'Save current queue', disabled: !pl.length, action: openSave },
    { icon: '▤', label: 'Playlist utilities', disabled: !pl.length, action: openPlaylistUtilities },
    { icon: '⇩', label: 'Export queue as M3U', disabled: !pl.length, action: () => downloadM3U(pl, currentName || 'neonamp-queue') },
    null,
    { icon: '✕', label: 'Clear queue', danger: true, disabled: !pl.length, action: () => els.btnClr.click() },
    { icon: '−', label: 'Hide playlist panel', action: () => els.btnPlToggle.click() }
  ]);
}

function showGeneralDeckContext(event) {
  const playing = !!audio.src && !audio.paused;
  const track = cur >= 0 ? pl[cur] : null;
  showDeckContextMenu(event.clientX, event.clientY, track ? `NOW // ${track.title}` : 'NEONAMP // PLAYER', [
    { icon: playing ? 'Ⅱ' : '▶', label: playing ? 'Pause' : 'Play / resume', action: playing ? doPause : doPlay },
    { icon: '◀', label: 'Previous track', disabled: !pl.length, action: doPrev },
    { icon: '▶', label: 'Next track', disabled: !pl.length, action: () => doNext(false) },
    { icon: '■', label: 'Stop', disabled: !audio.src, action: doStop },
    null,
    { icon: '↗', label: 'Open playlist manager', action: openPlaylistManager },
    { icon: '⇧', label: 'Load saved playlist', action: openLoad },
    null,
    { icon: '▥', label: 'Choose visualizer', hint: VIS_LABELS[visMode], action: openVisualizerPicker },
    { icon: '◈', label: 'Cycle theme', hint: themeName, action: cycleTheme },
    { icon: normalize ? '◆' : '◇', label: 'Loudness normalization', active: normalize, action: () => els.btnNorm.click() },
    { icon: shuffle ? '◆' : '◇', label: 'Shuffle', active: shuffle, action: () => els.btnShuffle.click() },
    { icon: repeat !== 'off' ? '◆' : '◇', label: 'Cycle repeat mode', hint: repeat.toUpperCase(), active: repeat !== 'off', action: () => els.btnRepeat.click() },
    null,
    { icon: els.eqPanel.classList.contains('collapsed') ? '+' : '−', label: `${els.eqPanel.classList.contains('collapsed') ? 'Show' : 'Hide'} equalizer`, action: () => els.btnEqToggle.click() },
    { icon: els.plPanel.classList.contains('collapsed') ? '+' : '−', label: `${els.plPanel.classList.contains('collapsed') ? 'Show' : 'Hide'} playlist`, action: () => els.btnPlToggle.click() }
  ]);
}

els.amp.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const row = event.target.closest('#plList li');
  if (row) {
    const index = Number(row.dataset.i);
    sel = index;
    paintSelection();
    showQueueTrackContext(event, index);
  } else if (event.target.closest('#vis')) showVisualizerContext(event);
  else if (event.target.closest('#eqPanel')) showEqContext(event);
  else if (event.target.closest('#plPanel')) showQueueContext(event);
  else showGeneralDeckContext(event);
});

// ── Load / delete playlists ──
async function openLoad() {
  const body = openModal('LOAD PLAYLIST');
  body.innerHTML = `<ul class="mlist" id="loadList"></ul>
    <div class="mhint">CLICK: LOAD ▸ M3U: EXPORT ▸ ✕: DELETE ▸ MANAGE + UPLOAD AT /PLAYLIST</div>`;
  const listEl = $('#loadList');
  const render = async () => {
    listEl.innerHTML = '';
    let data;
    try { data = await api('/api/playlists'); }
    catch (err) { toast('LOAD FAILED: ' + err.message, true); return; }
    if (!data.playlists.length) {
      listEl.innerHTML = `<li style="cursor:default"><span class="name" style="color:var(--dim)">NO SAVED PLAYLISTS YET</span></li>`;
      return;
    }
    data.playlists.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML =
        `<span class="name"></span>` +
        `<span class="sub">${p.tracks} TRK</span>` +
        `<span class="sub">${new Date(p.modified).toLocaleDateString()}</span>` +
        `<span class="x" title="Export as .m3u8" style="color:var(--amber)">M3U</span>` +
        `<span class="x" title="Delete">✕</span>`;
      li.querySelector('.name').textContent = p.name;
      li.querySelectorAll('.x')[0].addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const d = await api(`/api/playlists/${encodeURIComponent(p.name)}`);
          downloadM3U(Array.isArray(d.tracks) ? d.tracks : [], p.name);
        } catch (err) { toast('EXPORT FAILED: ' + err.message, true); }
      });
      li.addEventListener('click', async () => {
        try {
          const d = await api(`/api/playlists/${encodeURIComponent(p.name)}`);
          pl = Array.isArray(d.tracks) ? d.tracks : [];
          cur = -1; sel = pl.length ? 0 : -1;
          currentName = p.name;
          playHistory = [];
          renderPlaylist();
          scheduleSession();
          closeModal();
          toast(`LOADED "${p.name}" — ${pl.length} TRK`);
        } catch (err) { toast('LOAD FAILED: ' + err.message, true); }
      });
      li.querySelectorAll('.x')[1].addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete playlist "${p.name}"?`)) return;
        try {
          await api(`/api/playlists/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
          const removedFromQueue = pl.some((t) => t.storage === 'playlist' && t.playlist === p.name);
          if (removedFromQueue) {
            doStop();
            pl = pl.filter((t) => !(t.storage === 'playlist' && t.playlist === p.name));
            cur = -1;
            sel = pl.length ? 0 : -1;
          }
          if (currentName === p.name) {
            currentName = '';
          }
          renderPlaylist();
          scheduleSession();
          toast(`DELETED "${p.name}"`);
          render();
        } catch (err) { toast('DELETE FAILED: ' + err.message, true); }
      });
      listEl.appendChild(li);
    });
  };
  render();
}

// ── Save playlist ──
function openSave() {
  if (!pl.length) { toast('NOTHING TO SAVE — QUEUE IS EMPTY', true); return; }
  const body = openModal('SAVE PLAYLIST');
  body.innerHTML = `
    <div class="mtools">
      <input type="text" id="saveName" placeholder="PLAYLIST NAME…" maxlength="64" autocomplete="off">
      <button class="btn" id="saveGo">SAVE</button>
      <button class="btn" id="saveM3U" title="Download the current queue as .m3u8">EXPORT M3U</button>
    </div>
    <div class="mhint">SAVES PLAYLIST FILE REFERENCES ▸ EXPORT M3U DOWNLOADS THE QUEUE</div>`;
  const input = $('#saveName');
  input.value = currentName;
  $('#saveM3U').addEventListener('click', () => downloadM3U(pl, input.value.trim() || currentName || 'neonamp-queue'));
  const go = async () => {
    const name = input.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name)) {
      toast('INVALID NAME', true);
      return;
    }
    try {
      const saved = await api(`/api/playlists/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: pl })
      });
      pl = Array.isArray(saved.tracks) ? saved.tracks : pl;
      currentName = name;
      renderPlaylist();
      scheduleSession();
      closeModal();
      toast(`SAVED "${name}.json" — ${pl.length} TRK`);
    } catch (err) { toast('SAVE FAILED: ' + err.message, true); }
  };
  $('#saveGo').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  input.focus();
  input.select();
}

function openDspRack() {
  const body = openModal('DSP RACK');
  body.innerHTML = `
    <div class="mtools">
      <select id="dspPreset" class="mselect">${Object.keys(DSP_PRESETS).map((name) => `<option>${name}</option>`).join('')}</select>
      <button class="btn" id="dspApply">APPLY PRESET</button>
      <span class="spacer"></span>
      <select id="dspType" class="mselect">${Object.entries(DSP_DEFS).map(([type, d]) => `<option value="${type}">${d.name}</option>`).join('')}</select>
      <button class="btn" id="dspAdd">ADD</button>
    </div>
    <div class="dsplist" id="dspList"></div>
    <div class="mhint">SIGNAL FLOWS TOP → BOTTOM ▸ CHANGES APPLY LIVE ▸ OBS JUKEBOX LOADS THE SAME RACK FROM SETTINGS</div>`;
  const list = $('#dspList');
  const commit = () => {
    rebuildAudioChain();
    els.btnDsp.classList.toggle('active', dspModules.some((m) => m.enabled));
    sendPrefs();
    scheduleSession();
  };
  const render = () => {
    list.innerHTML = '';
    if (!dspModules.length) list.innerHTML = '<div class="mhint dspempty">RACK BYPASSED — ADD A MODULE OR APPLY A PRESET</div>';
    dspModules.forEach((module, i) => {
      const def = DSP_DEFS[module.type];
      const row = document.createElement('div');
      row.className = 'dsprow' + (module.enabled ? '' : ' bypassed');
      row.innerHTML = `
        <button class="mode toggle">${module.enabled ? 'ON' : 'OFF'}</button>
        <span class="dspname"></span>
        <input class="dspamount" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${module.value}">
        <span class="dspval lcd"></span>
        <button class="mode up" title="Move up">↑</button><button class="mode down" title="Move down">↓</button>
        <button class="mode remove" title="Remove">✕</button>`;
      row.querySelector('.dspname').textContent = def.name;
      const value = row.querySelector('.dspval');
      const amount = row.querySelector('.dspamount');
      const paintValue = () => {
        if (module.type === 'width') value.textContent = `${Number(module.value).toFixed(2)}×`;
        else if (module.type === 'bass') value.textContent = `+${Number(module.value).toFixed(1)}dB`;
        else if (module.type === 'reverb') value.textContent = `${Math.round(module.value * 100)}%`;
        else if (module.type === 'mono') value.textContent = 'SUM';
        else value.textContent = `${Math.round(module.value * 100)}%`;
      };
      paintValue();
      amount.disabled = module.type === 'mono';
      amount.addEventListener('input', () => { module.value = Number(amount.value); paintValue(); rebuildAudioChain(); });
      amount.addEventListener('change', commit);
      row.querySelector('.toggle').addEventListener('click', () => { module.enabled = !module.enabled; commit(); render(); });
      row.querySelector('.up').addEventListener('click', () => {
        if (i > 0) [dspModules[i - 1], dspModules[i]] = [dspModules[i], dspModules[i - 1]];
        commit(); render();
      });
      row.querySelector('.down').addEventListener('click', () => {
        if (i < dspModules.length - 1) [dspModules[i + 1], dspModules[i]] = [dspModules[i], dspModules[i + 1]];
        commit(); render();
      });
      row.querySelector('.remove').addEventListener('click', () => { dspModules.splice(i, 1); commit(); render(); });
      list.appendChild(row);
    });
  };
  $('#dspAdd').addEventListener('click', () => {
    const module = newDspModule($('#dspType').value);
    if (module) dspModules.push(module);
    commit(); render();
  });
  $('#dspApply').addEventListener('click', () => {
    dspModules = DSP_PRESETS[$('#dspPreset').value].map((m) => newDspModule(m.type, m.value));
    commit(); render();
    toast(`DSP PRESET: ${$('#dspPreset').value}`);
  });
  render();
}

// ------------------------------------------------------------
// Equalizer UI
// ------------------------------------------------------------
function buildEQ() {
  els.eqBands.innerHTML = '';
  EQ_LABELS.forEach((label, i) => {
    const band = document.createElement('div');
    band.className = 'band';
    band.innerHTML = `
      <span class="db">0</span>
      <div class="vwrap"><input type="range" min="-12" max="12" step="0.5" value="0" aria-label="EQ ${label} Hz"></div>
      <span class="hz">${label}</span>`;
    const input = band.querySelector('input');
    const db = band.querySelector('.db');
    const apply = () => {
      const v = Number(input.value);
      eqVals[i] = v;
      db.textContent = v > 0 ? `+${v}` : `${v}`;
      band.classList.toggle('hot', v !== 0);
      setRangeFill(input, ((v + 12) / 24) * 100);
      if (filters[i]) filters[i].gain.value = eqOn ? v : 0;
    };
    input.addEventListener('input', apply);
    input.addEventListener('input', markCustomPreset);   // hand-tuning → CUSTOM
    input.addEventListener('change', () => { sendPrefs(); scheduleSession(); });
    band.dataset.idx = i;
    els.eqBands.appendChild(band);
    apply();
  });

  // preset dropdown
  els.eqPreset.innerHTML = '';
  for (const name of Object.keys(EQ_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.eqPreset.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = 'CUSTOM';
  custom.textContent = 'CUSTOM';
  custom.hidden = true;
  els.eqPreset.appendChild(custom);
  els.eqPreset.value = eqPreset in EQ_PRESETS || eqPreset === 'CUSTOM' ? eqPreset : 'FLAT';
}

let applyingPreset = false;
function markCustomPreset() {
  if (applyingPreset || eqPreset === 'CUSTOM') return;
  eqPreset = 'CUSTOM';
  els.eqPreset.value = 'CUSTOM';
}

function applyPreset(name, quiet = false) {
  const vals = EQ_PRESETS[name];
  if (!vals) return;
  applyingPreset = true;
  setEqVals(vals.map((v) => Math.max(-12, Math.min(12, v))));
  applyingPreset = false;
  eqPreset = name;
  els.eqPreset.value = name;
  if (!quiet) toast(`EQ: ${name}`);
}

function setEqVals(vals) {
  els.eqBands.querySelectorAll('.band').forEach((band, i) => {
    const input = band.querySelector('input');
    input.value = vals[i] ?? 0;
    input.dispatchEvent(new Event('input'));
  });
  sendPrefs();
  scheduleSession();
}

function setEqOn(on) {
  eqOn = on;
  els.btnEqOn.classList.toggle('active', on);
  els.eqPanel.classList.toggle('eq-off', !on);
  filters.forEach((f, i) => { f.gain.value = on ? eqVals[i] : 0; });
  sendPrefs();
  scheduleSession();
}

// ------------------------------------------------------------
// Session persistence (server-side file, debounced)
// ------------------------------------------------------------
let sessionTimer = null;
let lastPosSaved = 0;
function scheduleSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 700);
}
function sessionPayload() {
  return {
    name: currentName,
    tracks: pl,
    sel,
    position: {
      idx: cur,
      t: Math.floor((audio.currentTime || 0) * 10) / 10,
      state: lastPlayState   // 'play' | 'pause' | 'stop'
    },
    volume: Number(els.vol.value),
    balance: Number(els.bal.value),
    shuffle,
    repeat,
    eq: { on: eqOn, bands: eqVals, preset: eqPreset },
    obsEq,
    dsp: { modules: dspModules },
    visMode,
    theme: themeName,
    normalize,
    panels: {
      eq: !els.eqPanel.classList.contains('collapsed'),
      pl: !els.plPanel.classList.contains('collapsed')
    }
  };
}
async function saveSession() {
  lastPosSaved = Date.now();
  try {
    await fetch('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionPayload())
    });
  } catch (err) {
    console.log('[neonamp] settings save failed:', err && err.message);
  }
}

// Exact position on tab close, even mid-song. The unloading flag
// stops the browser's teardown pause from flipping our saved state
// from 'play' to 'pause' — that would break auto-continue.
let unloading = false;
window.addEventListener('pagehide', () => {
  unloading = true;
  try {
    navigator.sendBeacon(
      '/api/session',
      new Blob([JSON.stringify(sessionPayload())], { type: 'application/json' })
    );
  } catch { /* best effort */ }
});


// Pure decision logic for resume-on-reopen — extracted so it can be
// unit-tested headlessly. Given the saved position and queue length,
// returns exactly what the deck should do.
function resumePlan(p, len) {
  if (!p || typeof p.idx !== 'number' || p.idx < 0 || p.idx >= len) {
    return { ok: false };
  }
  const state = p.state === 'play' || p.state === 'pause' || p.state === 'stop' ? p.state : 'stop';
  const t = typeof p.t === 'number' && isFinite(p.t) && p.t > 0 ? p.t : 0;
  return {
    ok: true,
    idx: p.idx,
    resumeAt: state === 'stop' ? 0 : t,
    wasPlaying: state === 'play',
    seedState: state
  };
}

async function restoreSession() {
  let s = {};
  try { s = await api('/api/session'); } catch { return; }
  if (Array.isArray(s.tracks)) pl = s.tracks;
  if (typeof s.name === 'string') currentName = s.name;
  if (typeof s.sel === 'number') sel = Math.min(s.sel, pl.length - 1);
  if (typeof s.volume === 'number') { els.vol.value = s.volume; applyVolume(); }
  if (typeof s.balance === 'number') { els.bal.value = s.balance; applyBalance(); }
  if (typeof s.shuffle === 'boolean') { shuffle = s.shuffle; els.btnShuffle.classList.toggle('active', shuffle); }
  if (s.repeat) { repeat = s.repeat; paintRepeat(); }
  if (s.eq) {
    if (Array.isArray(s.eq.bands)) {
      applyingPreset = true;
      setEqVals(s.eq.bands);
      applyingPreset = false;
    }
    if (typeof s.eq.on === 'boolean') setEqOn(s.eq.on);
    if (typeof s.eq.preset === 'string') {
      eqPreset = s.eq.preset;
      els.eqPreset.value = (eqPreset in EQ_PRESETS || eqPreset === 'CUSTOM') ? eqPreset : 'FLAT';
    }
  }
  if (VIS_MODES.includes(s.visMode)) setVisualizer(s.visMode, true);
  if (typeof s.theme === 'string' && THEMES[s.theme]) applyTheme(s.theme, true);
  if (typeof s.normalize === 'boolean') { normalize = s.normalize; applyNormGain(); }
  if (typeof s.obsEq === 'boolean') { obsEq = s.obsEq; els.btnEqObs.classList.toggle('active', obsEq); }
  if (s.dsp?.modules) {
    dspModules = sanitizeDspModules(s.dsp.modules);
    els.btnDsp.classList.toggle('active', dspModules.some((m) => m.enabled));
  }
  if (s.panels) {
    els.eqPanel.classList.toggle('collapsed', !s.panels.eq);
    els.btnEqToggle.classList.toggle('active', !!s.panels.eq);
    els.plPanel.classList.toggle('collapsed', !s.panels.pl);
    els.btnPlToggle.classList.toggle('active', !!s.panels.pl);
  }
  renderPlaylist();

  // Cue up where we left off. If it was PLAYING when the app closed
  // (tab close, server Ctrl+C, whatever), carry straight on.
  const plan = resumePlan(s.position, pl.length);
  console.log('[neonamp] restore:', JSON.stringify(s.position), '→ plan:', JSON.stringify(plan));
  if (plan.ok) {
    // Seed the play-state FIRST — restore fires several debounced
    // saves (EQ, theme, …); without this seed, one of them could
    // write state:'stop' back over a saved 'play' before playback
    // has confirmed, breaking the NEXT reload's auto-continue.
    lastPlayState = plan.seedState;
    cur = plan.idx;
    sel = plan.idx;
    const t = pl[cur];
    audio.src = trackUrl(t);
    fetchNormGain(t);
    setMarquee(`${trackLabel(t)}  ::  NEONAMP`);
    updateMeta(t);
    document.title = `${trackLabel(t)} — NEONAMP`;
    renderPlaylist();
    scrollCurrentIntoView('center');

    const tryResume = () => {
      // Never resume through the bare media element: that made EQ and NORM
      // look enabled while neither was actually in the signal path. If the
      // browser will not start Web Audio yet, wait for the first gesture.
      const context = ensureGraph();
      if (context && context.state !== 'running') {
        pendingAutoResume = true;
        setPlayState('pause');
        toast(`RESUME READY @ ${fmtTime(plan.resumeAt)} — PRESS ANY KEY`);
        return;
      }
      audio.play().then(() => {
        console.log('[neonamp] auto-resume playing');
        toast(`RESUMED @ ${fmtTime(plan.resumeAt)}`);
      }).catch((err) => {
        console.log('[neonamp] auto-resume blocked:', err && err.name);
        pendingAutoResume = true;
        setPlayState('pause');
        toast(`RESUME READY @ ${fmtTime(plan.resumeAt)} — PRESS ANY KEY`);
      });
    };

    if (plan.resumeAt > 0 || plan.wasPlaying) {
      audio.addEventListener('loadedmetadata', () => {
        if (plan.resumeAt > 0) {
          audio.currentTime = Math.min(plan.resumeAt, Math.max(0, (audio.duration || plan.resumeAt) - 0.5));
          audio.dispatchEvent(new Event('timeupdate'));
        }
        if (plan.wasPlaying) tryResume();
      }, { once: true });
      // Belt and braces: if metadata is slow or the event was missed,
      // one retry a few seconds in (skipped if we're already rolling
      // or waiting on a gesture).
      if (plan.wasPlaying) {
        setTimeout(() => {
          if (audio.paused && !pendingAutoResume && lastPlayState === 'play') tryResume();
        }, 4000);
      }
      if (!plan.wasPlaying) {
        setPlayState('pause');
        toast(`RESUME READY @ ${fmtTime(plan.resumeAt)} — HIT PLAY`);
      }
      return;
    }
  }
  if (pl.length) toast('SESSION RESTORED');
}

// First user gesture: attach the Web Audio graph (idempotent) and,
// if autoplay was blocked during restore, carry on playing.
let pendingAutoResume = false;
function armGestureHooks() {
  const arm = async () => {
    const context = ensureGraph();
    try { await context?.resume(); } catch { /* the play call below reports failure */ }
    if (pendingAutoResume) {
      pendingAutoResume = false;
      doPlay();
    }
  };
  window.addEventListener('pointerdown', arm, { once: true, capture: true });
  window.addEventListener('keydown', arm, { once: true, capture: true });
}

// ------------------------------------------------------------
// Mixers
// ------------------------------------------------------------
function applyVolume() {
  const v = Number(els.vol.value);
  const gain = Math.pow(Math.max(0, Math.min(100, v)) / 100, 1.6);
  if (masterGain && actx) {
    // Keep the media element at unity once Web Audio owns the signal.
    // Master volume belongs after normalization, EQ, DSP and limiting so
    // moving the slider cannot change compressor or leveler behaviour.
    audio.volume = 1;
    masterGain.gain.cancelScheduledValues(actx.currentTime);
    masterGain.gain.setValueAtTime(gain, actx.currentTime);
  } else {
    audio.volume = gain;
  }
  els.volVal.textContent = String(v);
  setRangeFill(els.vol, v);
}
function applyBalance() {
  const v = Number(els.bal.value);
  if (panner) panner.pan.value = v / 100;
  els.balVal.textContent = v === 0 ? 'CTR' : (v < 0 ? `L${-v}` : `R${v}`);
  setRangeFill(els.bal, (v + 100) / 2);
}

// ------------------------------------------------------------
// Repeat / shuffle painting
// ------------------------------------------------------------
function paintRepeat() {
  els.btnRepeat.classList.toggle('active', repeat !== 'off');
  els.btnRepeat.textContent = repeat === 'one' ? 'REP1' : 'REP';
}

// ------------------------------------------------------------
// Audio element events
// ------------------------------------------------------------
let seeking = false;

function scheduleRadioReconnect(t) {
  const delays = [2000, 5000, 10000, 20000, 30000];
  const delay = delays[Math.min(radioRetry, delays.length - 1)];
  radioRetry++;
  toast(`RADIO LOST — RECONNECT ${Math.round(delay / 1000)}S`, true);
  clearTimeout(radioRetryTimer);
  radioRetryTimer = setTimeout(() => {
    if (cur >= 0 && trackKey(pl[cur]) === trackKey(t)) {
      audio.src = trackUrl(t) + `&retry=${Date.now()}`;
      audio.play().catch(() => {});
    }
  }, delay);
}

audio.addEventListener('timeupdate', () => {
  const d = audio.duration;
  const t = audio.currentTime;
  els.timeMain.textContent = showRemain && isFinite(d) ? `-${fmtClock(d - t)}` : fmtClock(t);
  if (!seeking && isFinite(d) && d > 0) {
    const pct = (t / d) * 1000;
    els.seek.value = pct;
    setRangeFill(els.seek, pct / 10);
  }
  if (lastPlayState === 'play' && Date.now() - lastStateSent > 1000) sendState();
  if (lastPlayState === 'play' && Date.now() - lastPosSaved > 3000) scheduleSession();
});
audio.addEventListener('playing', () => {
  setPlayState('play');
  errStreak = 0;
  if (pl[cur]?.storage === 'radio') { radioRetry = 0; toast(`RADIO CONNECTED — ${pl[cur].title.toUpperCase()}`); }
});
audio.addEventListener('seeked', () => { scheduleSession(); });
audio.addEventListener('pause', () => {
  if (unloading) return; // teardown pause on tab close — keep 'play' saved
  if (audio.currentTime > 0 && !audio.ended) setPlayState('pause');
});
audio.addEventListener('ended', () => {
  if (pl[cur]?.storage === 'radio') { scheduleRadioReconnect(pl[cur]); return; }
  if (repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  doNext(true);
});
audio.addEventListener('error', () => {
  const t = cur >= 0 ? pl[cur] : null;
  if (t?.storage === 'radio') {
    scheduleRadioReconnect(t);
    return;
  }
  errStreak++;
  toast('TRACK UNREADABLE — SKIPPING', true);
  if (errStreak <= pl.length) doNext(true);
  else doStop();
});

// ------------------------------------------------------------
// Control wiring
// ------------------------------------------------------------
els.btnPlay.addEventListener('click', doPlay);
els.btnPause.addEventListener('click', doPause);
els.btnStop.addEventListener('click', doStop);
els.btnNext.addEventListener('click', () => doNext(false));
els.btnPrev.addEventListener('click', doPrev);
els.btnEject.addEventListener('click', openPlaylistManager);

els.btnShuffle.addEventListener('click', () => {
  shuffle = !shuffle;
  els.btnShuffle.classList.toggle('active', shuffle);
  if (!shuffle) playHistory = [];
  scheduleSession();
});
els.btnRepeat.addEventListener('click', () => {
  repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
  paintRepeat();
  scheduleSession();
});

els.timeMain.addEventListener('click', () => {
  showRemain = !showRemain;
  audio.dispatchEvent(new Event('timeupdate'));
});

els.vis.addEventListener('click', cycleVis);
els.btnVis.addEventListener('click', openVisualizerPicker);
els.btnTheme.addEventListener('click', cycleTheme);
els.btnNorm.addEventListener('click', () => {
  normalize = !normalize;
  applyNormGain();
  sendPrefs();
  toast(normalize ? 'NORMALIZATION ON' : 'NORMALIZATION OFF');
  if (normalize && cur >= 0 && pl[cur]) fetchNormGain(pl[cur]);
  scheduleSession();
});

els.seek.addEventListener('pointerdown', () => { seeking = true; });
els.seek.addEventListener('pointerup', () => { seeking = false; });
els.seek.addEventListener('input', () => {
  setRangeFill(els.seek, Number(els.seek.value) / 10);
  if (isFinite(audio.duration)) {
    audio.currentTime = (Number(els.seek.value) / 1000) * audio.duration;
  }
});

els.vol.addEventListener('input', () => { applyVolume(); scheduleSession(); });
els.bal.addEventListener('input', () => { applyBalance(); scheduleSession(); });
els.bal.addEventListener('dblclick', () => { els.bal.value = 0; applyBalance(); scheduleSession(); });

els.btnEqToggle.addEventListener('click', () => {
  els.eqPanel.classList.toggle('collapsed');
  els.btnEqToggle.classList.toggle('active', !els.eqPanel.classList.contains('collapsed'));
  scheduleSession();
});
els.btnPlToggle.addEventListener('click', () => {
  setTimeout(() => scrollCurrentIntoView('nearest'), 0);
  els.plPanel.classList.toggle('collapsed');
  els.btnPlToggle.classList.toggle('active', !els.plPanel.classList.contains('collapsed'));
  scheduleSession();
});
els.btnEqOn.addEventListener('click', () => setEqOn(!eqOn));
els.btnDsp.addEventListener('click', openDspRack);
els.btnEqObs.addEventListener('click', () => {
  obsEq = !obsEq;
  els.btnEqObs.classList.toggle('active', obsEq);
  sendPrefs();
  scheduleSession();
  toast(obsEq
    ? 'OVERLAY EQ ON — REFRESH THE OBS SOURCE TO APPLY'
    : 'OVERLAY EQ OFF — FLATTENS LIVE');
});
els.eqPreset.addEventListener('change', () => {
  if (els.eqPreset.value !== 'CUSTOM') applyPreset(els.eqPreset.value);
});

els.btnAdd.addEventListener('click', openPlaylistManager);
els.btnRem.addEventListener('click', () => {
  if (sel < 0) { toast('SELECT A TRACK FIRST', true); return; }
  removeAt(sel);
});
els.btnClr.addEventListener('click', () => {
  if (!pl.length) return;
  if (!confirm('Clear the whole queue?')) return;
  pl = [];
  cur = -1; sel = -1;
  playHistory = [];
  renderPlaylist();
  scheduleSession();
});
els.btnSave.addEventListener('click', openSave);
els.btnLoad.addEventListener('click', openLoad);
els.btnUtil.addEventListener('click', openPlaylistUtilities);

// ------------------------------------------------------------
// Keyboard — classic Winamp Z X C V B row + extras
// ------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  const k = e.key.toLowerCase();
  switch (k) {
    case 'z': doPrev(); break;
    case 'x': doPlay(); break;
    case 'c': doPause(); break;
    case 'v': doStop(); break;
    case 'b': doNext(false); break;
    case 'e': openPlaylistManager(); break;
    case 'l': openPlaylistManager(); break;
    case 's': els.btnShuffle.click(); break;
    case 'r': els.btnRepeat.click(); break;
    case ' ':
      e.preventDefault();
      (audio.src && !audio.paused) ? doPause() : doPlay();
      break;
    case 'arrowright':
      if (audio.src) audio.currentTime = Math.min((audio.duration || 0), audio.currentTime + 5);
      break;
    case 'arrowleft':
      if (audio.src) audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'arrowup':
      e.preventDefault();
      els.vol.value = Math.min(100, Number(els.vol.value) + 5);
      applyVolume(); scheduleSession();
      break;
    case 'arrowdown':
      e.preventDefault();
      els.vol.value = Math.max(0, Number(els.vol.value) - 5);
      applyVolume(); scheduleSession();
      break;
    case 'delete':
      if (sel >= 0) removeAt(sel);
      break;
    case 'escape': closeModal(); break;
  }
});


// ------------------------------------------------------------
// Loudness normalization — per-track gain toward the server's
// LUFS target, applied through the Web Audio preamp.
// ------------------------------------------------------------
function applyNormGain() {
  if (preamp) preamp.gain.value = normalize ? Math.pow(10, normGain / 20) : 1;
  if (!normalize) resetOutputLeveler(true);
  if (els.btnNorm) {
    els.btnNorm.classList.toggle('active', normalize);
    els.btnNorm.title = normalize
      ? `Loudness normalization ON — current track ${normGain >= 0 ? '+' : ''}${normGain.toFixed(1)} dB`
      : 'Loudness normalization OFF';
  }
}

async function fetchNormGain(t) {
  normGain = 0;
  resetOutputLeveler(false);
  applyNormGain();
  if (!t || !normalize || t.storage === 'radio') return;
  try {
    const r = await api(mediaApiUrl('loudness', t));
    if (r.status === 'ready' && typeof r.gain === 'number' && cur >= 0 && trackKey(pl[cur]) === trackKey(t)) {
      normGain = r.gain;
      applyNormGain();
    }
    // status 'pending' resolves via the /ws loudness push below
  } catch { /* silent — unity gain */ }
}


// ------------------------------------------------------------
// OBS mini feed — broadcast play state + spectrum over /ws so
// the /obs browser-source overlay can mirror the deck live.
// ------------------------------------------------------------
let bws = null;
let bwsTimer = null;
let lastPlayState = 'stop';
let lastStateSent = 0;

async function loadPlaylistCommand(msg) {
  try {
    const data = await api(`/api/playlists/${encodeURIComponent(msg.name || '')}`);
    pl = Array.isArray(data.tracks) ? data.tracks : [];
    currentName = data.name || msg.name || '';
    playHistory = [];
    cur = -1;
    sel = pl.length ? Math.max(0, Math.min(pl.length - 1, Number(msg.index) || 0)) : -1;
    renderPlaylist();
    if (msg.play !== false && sel >= 0) playIndex(sel);
    else {
      lastPlayState = 'stop';
      scheduleSession();
      sendState();
    }
    toast(`PLAYLIST CONTROL: ${currentName.toUpperCase()}${msg.play === false ? ' LOADED' : ' PLAYING'}`);
  } catch (err) { toast('PLAYLIST CONTROL FAILED: ' + err.message, true); }
}

function applyRemoteSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  if (typeof settings.volume === 'number') { els.vol.value = settings.volume; applyVolume(); }
  if (typeof settings.balance === 'number') { els.bal.value = settings.balance; applyBalance(); }
  if (typeof settings.shuffle === 'boolean') {
    shuffle = settings.shuffle;
    els.btnShuffle.classList.toggle('active', shuffle);
  }
  if (['off', 'all', 'one'].includes(settings.repeat)) { repeat = settings.repeat; paintRepeat(); }
  if (typeof settings.normalize === 'boolean') {
    normalize = settings.normalize;
    applyNormGain();
    if (normalize && cur >= 0) fetchNormGain(pl[cur]);
  }
  if (VIS_MODES.includes(settings.visMode)) setVisualizer(settings.visMode, true);
  if (typeof settings.theme === 'string' && THEMES[settings.theme]) applyTheme(settings.theme, true);
  if (settings.eq && typeof settings.eq === 'object') {
    if (Array.isArray(settings.eq.bands)) {
      applyingPreset = true;
      setEqVals(settings.eq.bands.slice(0, 10));
      applyingPreset = false;
    }
    if (typeof settings.eq.on === 'boolean') setEqOn(settings.eq.on);
    if (typeof settings.eq.preset === 'string') {
      eqPreset = settings.eq.preset;
      els.eqPreset.value = (eqPreset in EQ_PRESETS || eqPreset === 'CUSTOM') ? eqPreset : 'CUSTOM';
    }
  }
  if (typeof settings.obsEq === 'boolean') {
    obsEq = settings.obsEq;
    els.btnEqObs.classList.toggle('active', obsEq);
  }
  if (settings.dsp && Array.isArray(settings.dsp.modules)) {
    dspModules = sanitizeDspModules(settings.dsp.modules);
    els.btnDsp.classList.toggle('active', dspModules.some((module) => module.enabled));
    rebuildAudioChain();
  }
  sendPrefs();
  scheduleSession();
  toast('PLAYLIST CONTROL APPLIED');
}

function renameLoadedPlaylist({ from, to }) {
  if (!from || !to || currentName !== from) return;
  const savedState = lastPlayState;
  const seekTo = Number(audio.currentTime) || 0;
  currentName = to;
  pl = pl.map((track) => track?.storage === 'playlist' && track.playlist === from ? { ...track, playlist: to } : track);
  renderPlaylist();
  const track = cur >= 0 ? pl[cur] : null;
  if (track?.storage === 'playlist' && audio.src) {
    audio.pause();
    audio.src = trackUrl(track);
    audio.addEventListener('loadedmetadata', () => {
      if (seekTo > 0) audio.currentTime = Math.min(seekTo, Math.max(0, (audio.duration || seekTo) - .5));
      if (savedState === 'play') audio.play().catch(() => {});
      else setPlayState(savedState);
    }, { once: true });
  } else {
    lastPlayState = savedState;
    sendState();
    scheduleSession();
  }
  toast(`PLAYLIST RENAMED: ${from.toUpperCase()} → ${to.toUpperCase()}`);
}

function wsConnect() {
  clearTimeout(bwsTimer);
  let sock;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    sock = new WebSocket(`${proto}://${location.host}/ws`);
  } catch {
    bwsTimer = setTimeout(wsConnect, 4000);
    return;
  }
  sock.addEventListener('open', () => {
    bws = sock;
    sendState();
    wsSend({ type: 'theme', name: themeName });
    sendPrefs();
  });
  sock.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'radio') {
      const t = cur >= 0 ? pl[cur] : null;
      if (t?.storage === 'radio' && (t.stationId || t.file) === msg.stationId) {
        currentRadioTitle = msg.title || '';
        const label = currentRadioTitle
          ? `${currentRadioTitle}  ::  ${t.title}`
          : `${t.title}  ::  RADIO ${String(msg.state || '').toUpperCase()}`;
        setMarquee(label);
        document.title = `${currentRadioTitle || t.title} — NEONAMP`;
        if (msg.bitrate) { t.bitrate = Number(msg.bitrate) || 0; updateMeta(t); }
        sendState();
      }
      return;
    }
    if (msg.type === 'loudness') {
      if (normalize && cur >= 0 && trackKey(pl[cur]) === msg.trackKey && typeof msg.gain === 'number') {
        normGain = msg.gain;
        applyNormGain();
      }
      return;
    }
    if (msg.type !== 'cmd') return;
    if (msg.cmd === 'apply-settings') { applyRemoteSettings(msg.settings); return; }
    if (msg.cmd === 'rename-playlist') { renameLoadedPlaylist(msg); return; }
    if (msg.cmd === 'load-playlist') { loadPlaylistCommand(msg); return; }
    if (msg.cmd === 'clear-playlist' && (!msg.name || msg.name === currentName)) {
      doStop();
      pl = [];
      currentName = '';
      cur = -1;
      sel = -1;
      renderPlaylist();
      scheduleSession();
      toast('ACTIVE PLAYLIST WAS DELETED');
      return;
    }
    if (msg.cmd === 'next') doNext(false);
    else if (msg.cmd === 'prev') doPrev();
    else if (msg.cmd === 'pause') { if (audio.src && !audio.paused) audio.pause(); }
    else if (msg.cmd === 'resume') doPlay();
    else if (msg.cmd === 'stop') doStop();
    toast(`CHAT CMD: ${String(msg.cmd).toUpperCase()}`);
  });
  sock.addEventListener('close', () => {
    if (bws === sock) bws = null;
    bwsTimer = setTimeout(wsConnect, 3000);
  });
  sock.addEventListener('error', () => { try { sock.close(); } catch { /* ignore */ } });
}

function sendPrefs() {
  wsSend({
    type: 'prefs', normalize, obsEq,
    eq: { on: eqOn, bands: eqVals.slice(), preset: eqPreset },
    dsp: { modules: dspModules }
  });
}

function wsSend(obj) {
  if (bws && bws.readyState === 1) {
    try { bws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

function sendState() {
  const t = cur >= 0 ? pl[cur] : null;
  const dur = t && t.duration ? t.duration : (isFinite(audio.duration) ? Math.round(audio.duration) : 0);
  lastStateSent = Date.now();
  wsSend({
    type: 'state',
    src: 'deck',
    status: lastPlayState === 'play' ? 'playing' : lastPlayState === 'pause' ? 'paused' : 'stopped',
    title: t ? (currentRadioTitle || t.title) : '',
    artist: t ? t.artist : '',
    file: t ? t.file : '',
    storage: t ? (t.storage || 'library') : 'library',
    playlist: t?.playlist || '',
    sourceId: t?.sourceId || '',
    sourceUrl: t?.sourceUrl || '',
    queueName: currentName,
    originalFile: t?.originalFile || '',
    station: t?.storage === 'radio' ? t.title : '',
    trackKey: trackKey(t),
    bitrate: t && t.bitrate ? t.bitrate : 0,
    sampleRate: t && t.sampleRate ? t.sampleRate : 0,
    duration: dur,
    t: audio.currentTime || 0,
    ts: lastStateSent,
    idx: cur,
    count: pl.length
  });
}

// Spectrum frames at ~20fps, matching the deck's log grouping but
// downsampled to 24 bars. Runs off setInterval (not rAF) so an
// unfocused player tab keeps feeding the overlay.
const OBS_BARS = 24;
let fftBuf = null;
let obsWaveBuf = null;
setInterval(() => {
  if (!analyser || !bws || bws.readyState !== 1 || lastPlayState !== 'play') return;
  if (!fftBuf) fftBuf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(fftBuf);
  const usable = Math.floor(fftBuf.length * 0.72);
  const out = new Array(OBS_BARS);
  for (let i = 0; i < OBS_BARS; i++) {
    const lo = Math.floor(usable * Math.pow(i / OBS_BARS, 1.8));
    const hi = Math.max(lo + 1, Math.floor(usable * Math.pow((i + 1) / OBS_BARS, 1.8)));
    let v = 0;
    for (let j = lo; j < hi; j++) v = Math.max(v, fftBuf[j]);
    out[i] = v;
  }
  if (!obsWaveBuf) obsWaveBuf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(obsWaveBuf);
  const W = 48, wave = new Array(W);
  const stride = Math.floor(obsWaveBuf.length / W);
  for (let i = 0; i < W; i++) wave[i] = obsWaveBuf[i * stride];
  wsSend({ type: 'fft', b: out, w: wave });
}, 50);

// Idle heartbeat so overlays can tell "paused" from "player gone"
setInterval(() => {
  if (Date.now() - lastStateSent >= 5000) sendState();
}, 5000);

wsConnect();


// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
window.addEventListener('resize', sizeVis);

(async function init() {
  buildEQ();
  applyVolume();
  applyBalance();
  paintRepeat();
  setVisualizer(visMode, true);
  els.btnEqToggle.classList.add('active');
  els.btnPlToggle.classList.add('active');
  sizeVis();
  drawVis();
  renderPlaylist();
  setMarquee('NEONAMP READY ▞▞ PRESS EJECT FOR PLAYLIST MANAGER ▞▞ COIN-OPERATED AUDIO');
  await restoreSession();
  sendPrefs();
  armGestureHooks();
  if (new URLSearchParams(location.search).get('twitch') === 'connected') {
    toast('TWITCH LINKED — CHAT COMMANDS READY');
    history.replaceState(null, '', '/');
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setMarquee(marqueeBase));
  }
})();
