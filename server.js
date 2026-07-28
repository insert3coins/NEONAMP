// ============================================================
//  NEONAMP server — insert3coins edition
//  Serves the player UI and persists filepath-based playlists in
//  ./playlists. ./playlist-media remains for legacy compatibility.
//  No database, no localStorage — just files on disk.
// ============================================================

import express from 'express';
import path from 'path';
import { promises as fs, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import { parseFile, selectCover } from 'music-metadata';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3090;
const MUSIC_DIR = process.env.NEONAMP_MUSIC || path.join(__dirname, 'music');
const PLAYLIST_DIR = path.join(__dirname, 'playlists');
const PLAYLIST_MEDIA_DIR = path.join(__dirname, 'playlist-media');
const YOUTUBE_DIR = path.join(__dirname, 'youtube-cache');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const RADIO_FILE = path.join(__dirname, 'radio-stations.json');

const AUDIO_EXT = new Set([
  '.mp3', '.ogg', '.oga', '.wav', '.flac', '.m4a', '.aac', '.opus', '.webm'
]);

// child_process.execFile('ffmpeg', ...) resolves a bare command name via
// the PATH env var only — it does NOT get the "search the current
// directory" behavior that cmd.exe's `where` (and CreateProcess when the
// OS itself launches a process) gets. So a project-root ffmpeg.exe next
// to server.js is invisible to execFile, and to yt-dlp's own PATH lookup,
// unless we point at it explicitly. Resolved once, reused everywhere.
let ffmpegBinCache; // undefined = not checked yet
async function ffmpegBin() {
  if (ffmpegBinCache === undefined) {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const local = path.join(__dirname, exeName);
    try { await fs.access(local); ffmpegBinCache = local; }
    catch { ffmpegBinCache = 'ffmpeg'; } // not bundled — rely on PATH
  }
  return ffmpegBinCache;
}
await fs.mkdir(MUSIC_DIR, { recursive: true });
await fs.mkdir(PLAYLIST_DIR, { recursive: true });
await fs.mkdir(PLAYLIST_MEDIA_DIR, { recursive: true });
await fs.mkdir(YOUTUBE_DIR, { recursive: true });

// One-time migration: sessions used to live in playlists/_session.json
try {
  await fs.access(SETTINGS_FILE);
} catch {
  try {
    await fs.rename(path.join(PLAYLIST_DIR, '_session.json'), SETTINGS_FILE);
    console.log('  migrated playlists/_session.json → settings.json');
  } catch { /* nothing to migrate */ }
}

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Filepath sources use /path-media/:sourceId. These static mounts remain
// read-only so old sessions/playlists continue without data migration.
app.use('/music', express.static(MUSIC_DIR));
app.use('/playlist-media', express.static(PLAYLIST_MEDIA_DIR));
app.use('/youtube-media', express.static(YOUTUBE_DIR));

function safeName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\.json$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(n)) return null;
  return n;
}

function safeAudioRel(value) {
  if (typeof value !== 'string') return null;
  const rel = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  if (!AUDIO_EXT.has(path.extname(rel).toLowerCase())) return null;
  return rel;
}

const PATH_SOURCES = new Map();

function safeAudioPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) return null;
  const full = path.resolve(value.trim());
  if (!AUDIO_EXT.has(path.extname(full).toLowerCase())) return null;
  return full;
}

function pathSourceId(full) {
  const identity = process.platform === 'win32' ? full.toLowerCase() : full;
  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

function registerPathSource(value) {
  const full = safeAudioPath(value);
  if (!full) return null;
  const sourceId = pathSourceId(full);
  PATH_SOURCES.set(sourceId, full);
  return { full, sourceId };
}

function trackRef(track) {
  if (track?.storage === 'path') {
    const registered = registerPathSource(track.file);
    if (!registered || (track.sourceId && track.sourceId !== registered.sourceId)) return null;
    return {
      storage: 'path', playlist: '', rel: registered.full, full: registered.full,
      sourceId: registered.sourceId, key: `path:${registered.sourceId}`
    };
  }
  const rel = safeAudioRel(track?.file);
  if (!rel) return null;
  if (track?.storage === 'playlist') {
    const playlist = safeName(track.playlist);
    if (!playlist) return null;
    const root = path.resolve(PLAYLIST_MEDIA_DIR, playlist);
    const full = path.resolve(root, ...rel.split('/'));
    if (!full.startsWith(root + path.sep)) return null;
    return { storage: 'playlist', playlist, rel, full, key: `playlist:${playlist}:${rel}` };
  }
  if (track?.storage === 'youtube') {
    const root = path.resolve(YOUTUBE_DIR);
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) return null;
    return { storage: 'youtube', playlist: '', rel, full, key: `youtube:${rel}` };
  }
  const root = path.resolve(MUSIC_DIR);
  const full = path.resolve(root, ...rel.split('/'));
  if (!full.startsWith(root + path.sep)) return null;
  return { storage: 'library', playlist: '', rel, full, key: rel };
}

function requestTrackRef(req) {
  if (req.query.storage === 'path') {
    const sourceId = String(req.query.source || '');
    const full = PATH_SOURCES.get(sourceId);
    if (!full) return null;
    return { storage: 'path', playlist: '', rel: full, full, sourceId, key: `path:${sourceId}` };
  }
  return trackRef({
    file: req.query.file,
    storage: req.query.storage === 'playlist' ? 'playlist' : req.query.storage === 'youtube' ? 'youtube' : 'library',
    playlist: req.query.playlist
  });
}

app.get('/path-media/:sourceId', (req, res) => {
  const sourceId = String(req.params.sourceId || '');
  const full = PATH_SOURCES.get(sourceId);
  if (!full) return res.status(404).end();
  res.set('Cache-Control', 'private, no-cache');
  res.type(path.extname(full));
  return res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(err.statusCode || 404).end();
  });
});

// ------------------------------------------------------------
// Internet radio bookmarks + ICY proxy. The proxy requests ICY
// metadata, strips it from the audio bytes for browser playback,
// and exposes the current StreamTitle through a lightweight status
// endpoint and the existing WebSocket relay.
// ------------------------------------------------------------
const radioRuntime = new Map();

function safeStationUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value.trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

function sanitizeStation(input, old = {}) {
  const url = safeStationUrl(input?.url ?? old.url);
  const name = String(input?.name ?? old.name ?? '').trim().slice(0, 100);
  if (!url || !name) return null;
  return {
    id: old.id || randomUUID(), name, url,
    genre: String(input?.genre ?? old.genre ?? '').trim().slice(0, 80),
    homepage: safeStationUrl(input?.homepage ?? old.homepage) || '',
    added: old.added || new Date().toISOString()
  };
}

async function readStations() {
  const data = await readJsonFile(RADIO_FILE, { stations: [] });
  return Array.isArray(data?.stations) ? data.stations : [];
}

async function writeStations(stations) {
  await writeJsonFile(RADIO_FILE, { version: 1, stations });
}

function stationTrack(station) {
  const live = radioRuntime.get(station.id) || {};
  return {
    storage: 'radio', file: station.id, stationId: station.id,
    title: station.name, artist: 'INTERNET RADIO', album: station.genre || '',
    genre: station.genre || '', url: station.url, homepage: station.homepage || '',
    duration: 0, bitrate: Number(live.bitrate) || 0, sampleRate: 0, channels: 2,
    radioStatus: live.state || 'idle', streamTitle: live.title || ''
  };
}

app.get('/api/radio', async (_req, res) => {
  try {
    const stations = (await readStations()).map((s) => ({ ...s, runtime: radioRuntime.get(s.id) || { state: 'idle' } }));
    res.json({ stations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/radio', async (req, res) => {
  try {
    const station = sanitizeStation(req.body);
    if (!station) return res.status(400).json({ error: 'Name and a valid HTTP(S) stream URL are required' });
    const stations = await readStations();
    stations.push(station);
    await writeStations(stations);
    res.json({ ok: true, station, track: stationTrack(station) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/radio/:id', async (req, res) => {
  try {
    const stations = await readStations();
    const i = stations.findIndex((s) => s.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Station not found' });
    const station = sanitizeStation(req.body, stations[i]);
    if (!station) return res.status(400).json({ error: 'Name and a valid HTTP(S) stream URL are required' });
    stations[i] = station;
    await writeStations(stations);
    res.json({ ok: true, station, track: stationTrack(station) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/radio/:id', async (req, res) => {
  try {
    const stations = await readStations();
    const next = stations.filter((s) => s.id !== req.params.id);
    if (next.length === stations.length) return res.status(404).json({ error: 'Station not found' });
    await writeStations(next);
    radioRuntime.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/radio/:id/status', async (req, res) => {
  const stations = await readStations();
  const station = stations.find((s) => s.id === req.params.id);
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json({ station: { id: station.id, name: station.name }, ...(radioRuntime.get(station.id) || { state: 'idle' }) });
});

function setRadioRuntime(id, patch) {
  const value = { ...(radioRuntime.get(id) || {}), ...patch, updatedAt: Date.now() };
  radioRuntime.set(id, value);
  if (typeof wssRef !== 'undefined') {
    const data = JSON.stringify({ type: 'radio', stationId: id, ...value });
    for (const client of wssRef.clients) {
      if (client.readyState === WebSocket.OPEN) { try { client.send(data); } catch { /* ignore */ } }
    }
  }
}

function openRadioUrl(rawUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = request(url, {
      headers: {
        'User-Agent': 'NEONAMP/1.0', 'Icy-MetaData': '1',
        Accept: 'audio/mpeg,audio/aac,audio/ogg,*/*'
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 5) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        openRadioUrl(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Station returned HTTP ${response.statusCode}`));
        return;
      }
      resolve({ response, finalUrl: url.toString() });
    });
    upstream.setTimeout(15000, () => upstream.destroy(new Error('Station connection timed out')));
    upstream.on('error', reject);
    upstream.end();
  });
}

class IcyStripper extends Transform {
  constructor(metaInt, onMetadata) {
    super();
    this.metaInt = metaInt;
    this.audioLeft = metaInt;
    this.metaLeft = -1;
    this.pending = Buffer.alloc(0);
    this.onMetadata = onMetadata;
  }
  _transform(chunk, _encoding, done) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length) {
      if (this.audioLeft > 0) {
        const n = Math.min(this.audioLeft, this.pending.length);
        this.push(this.pending.subarray(0, n));
        this.pending = this.pending.subarray(n);
        this.audioLeft -= n;
        if (this.audioLeft > 0) break;
      }
      if (this.metaLeft < 0) {
        if (!this.pending.length) break;
        this.metaLeft = this.pending[0] * 16;
        this.pending = this.pending.subarray(1);
        if (this.metaLeft === 0) { this.audioLeft = this.metaInt; this.metaLeft = -1; }
      }
      if (this.metaLeft >= 0) {
        if (this.pending.length < this.metaLeft) break;
        const metadata = this.pending.subarray(0, this.metaLeft).toString('utf8').replace(/\0+$/g, '');
        this.pending = this.pending.subarray(this.metaLeft);
        const match = metadata.match(/StreamTitle='([^']*)'/i);
        if (match) this.onMetadata(match[1].trim());
        this.audioLeft = this.metaInt;
        this.metaLeft = -1;
      }
    }
    done();
  }
}

app.get('/api/radio/:id/stream', async (req, res) => {
  const stations = await readStations();
  const station = stations.find((s) => s.id === req.params.id) || (
    safeStationUrl(req.query.url)
      ? { id: req.params.id, name: String(req.query.name || 'Internet Radio').slice(0, 100), url: safeStationUrl(req.query.url), genre: '' }
      : null
  );
  if (!station) return res.status(404).json({ error: 'Station not found' });
  try {
    setRadioRuntime(station.id, { state: 'connecting', title: '', error: '' });
    const { response, finalUrl } = await openRadioUrl(station.url);
    const metaInt = Number(response.headers['icy-metaint']) || 0;
    const contentType = response.headers['content-type'] || 'audio/mpeg';
    const bitrate = Number(response.headers['icy-br']) || 0;
    setRadioRuntime(station.id, {
      state: 'connected', title: '', error: '', finalUrl, bitrate,
      icyName: String(response.headers['icy-name'] || station.name),
      icyGenre: String(response.headers['icy-genre'] || station.genre || ''),
      connectedAt: Date.now()
    });
    res.status(200);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    const source = metaInt
      ? response.pipe(new IcyStripper(metaInt, (title) => setRadioRuntime(station.id, { state: 'connected', title })))
      : response;
    source.pipe(res);
    res.on('close', () => response.destroy());
    response.on('end', () => setRadioRuntime(station.id, { state: 'disconnected' }));
    response.on('error', (err) => setRadioRuntime(station.id, { state: 'error', error: err.message }));
  } catch (err) {
    setRadioRuntime(station.id, { state: 'error', error: err.message });
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.end();
  }
});

// ------------------------------------------------------------
// Audio import — video/track/playlist URLs from YouTube, SoundCloud,
// Mixcloud, or Bandcamp are resolved and the audio extracted via yt-dlp
// (+ffmpeg) into ./youtube-cache, tagged and thumbnailed on the way in
// so the existing metadata/art/loudness pipeline picks them up exactly
// like any other library file. Only YouTube and SoundCloud have been
// exercised end-to-end here; Mixcloud/Bandcamp ride the same generic
// yt-dlp path and should work, but haven't been individually verified.
// Single items download inline (instantly playable); playlist/set/album
// URLs enqueue a background, one-at-a-time download queue with progress
// pushed over /ws, same shape as the loudness analysis queue below.
// Storage type stays 'youtube' internally (and the field is still called
// videoId) even for other sites — renaming either would break every
// existing playlist that already has YouTube tracks saved.
// ------------------------------------------------------------
const IMPORT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be',
  'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com',
  'mixcloud.com', 'www.mixcloud.com'
]);
let ytDlpOk = null;

function ytDlpAvailable() {
  if (ytDlpOk !== null) return Promise.resolve(ytDlpOk);
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], { timeout: 5000 }, (err) => {
      ytDlpOk = !err;
      if (!ytDlpOk) console.log('  [youtube] yt-dlp not found — audio import disabled (install yt-dlp and ensure it is on PATH)');
      resolve(ytDlpOk);
    });
  });
}

function safeYoutubeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const u = new URL(value.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (!IMPORT_HOSTS.has(host) && host !== 'bandcamp.com' && !host.endsWith('.bandcamp.com')) return null;
    return u.toString();
  } catch { return null; }
}

// Was "YouTube video ID" (11 chars) shaped; SoundCloud/Mixcloud/Bandcamp
// ids are numeric or slug-like and don't fit that pattern, so this now
// just guards what becomes a filename component: safe characters, sane
// length, nothing that could path-traverse or collide across sites.
function safeVideoId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_.-]{1,64}$/.test(id) && id !== '.' && id !== '..' ? id : null;
}

function lastErrorLine(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || 'yt-dlp failed';
}

function resolveYoutube(url) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', url], {
      timeout: 45000, maxBuffer: 32 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(lastErrorLine(stderr) || err.message));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('yt-dlp returned an unexpected response')); }
    });
  });
}

// One line per progress tick, in a format cheap to parse: raw byte counts,
// not yt-dlp's human-formatted strings. total_bytes is empty ("NA") until
// yt-dlp knows the real size, in which case total_bytes_estimate fills in.
const YT_DOWNLOAD_TEMPLATE =
  'download:NEONAMP-DL %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s';
const YT_DOWNLOAD_RE = /^NEONAMP-DL (\d+|NA)\|(\d+|NA)\|(\d+|NA)$/;

// Deletes anything from a previous (interrupted or completed) attempt for
// this video: "<id>.src.webm", "<id>.src.webp", yt-dlp's own ".part"/".ytdl"
// resume sidecars, etc. — anything sharing the "<id>.src" stem.
async function cleanupYoutubeRawFiles(rawStem) {
  const dir = path.dirname(rawStem);
  const stem = path.basename(rawStem);
  let entries = [];
  try { entries = await fs.readdir(dir); } catch { return; }
  for (const name of entries) {
    if (name === stem || name.startsWith(`${stem}.`)) await fs.unlink(path.join(dir, name)).catch(() => {});
  }
}

// yt-dlp's own audio extraction runs ffmpeg as an internal subprocess it
// doesn't expose progress for (--progress-template only reports per-stage
// start/finish, not how far into a stage it is — confirmed by testing;
// --postprocessor-args to inject ffmpeg's own -progress into that internal
// call didn't work either, it broke yt-dlp's ffmpeg version-check). So we
// do the conversion ourselves: yt-dlp downloads the raw audio + thumbnail
// only (no -x/--embed-*), then our own ffmpeg call — driven with
// -progress pipe:1, which yt-dlp never gets in the way of — does the
// transcode + metadata + thumbnail embed with a real percentage the whole way.
const YT_META_RE = /^NEONAMP-META (.*)$/;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Finds the files yt-dlp just wrote by their shared "<rawStem>.*" prefix,
// rather than parsing which filename it chose out of console output.
// That log-parsing approach turned out to be unreliable: yt-dlp's
// human-readable info lines ("[download] Destination: ...", "Writing
// video thumbnail ... to: ...") silently don't reach stdout at all when
// spawned as a non-tty child process on Windows — confirmed by testing —
// even though the files are written correctly. --print/--progress-template
// output is unconditional and unaffected; only those log lines vanish.
async function findDownloadedFiles(rawStem) {
  const dir = path.dirname(rawStem);
  const stem = path.basename(rawStem);
  let entries = [];
  try { entries = await fs.readdir(dir); } catch { /* nothing written */ }
  let audioPath = null;
  let thumbPath = null;
  for (const name of entries) {
    if (name !== stem && !name.startsWith(`${stem}.`)) continue;
    const full = path.join(dir, name);
    if (IMAGE_EXT.has(path.extname(name).toLowerCase())) thumbPath = full;
    else audioPath = full;
  }
  return { audioPath, thumbPath };
}

async function downloadRawAudio(sourceUrl, rawStem, onUpdate) {
  const args = [
    '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', '--newline',
    '--write-thumbnail', '--force-overwrites',
    '--progress-template', YT_DOWNLOAD_TEMPLATE,
    // A playlist/set's flat listing is fast but sparse — YouTube's includes
    // title/duration per entry, SoundCloud's (confirmed by testing) only
    // gives id + url. This resolves the real values as a side effect of
    // the download that's happening anyway, no extra yt-dlp call needed.
    // Stage prefix matters: bare/"video:" --print implicitly enables
    // --simulate and silently skips the actual download entirely (confirmed
    // by testing against an HLS-fragmented SoundCloud track — no error, no
    // file at all). "before_dl:" fires per-item right before its download
    // starts and doesn't carry that implication.
    '--print', 'before_dl:NEONAMP-META %(title)s|||%(uploader,channel,artist)s|||%(duration)s',
    '-o', `${rawStem}.%(ext)s`,
    sourceUrl
  ];
  return await new Promise((resolve, reject) => {
    // Without a TTY, Python's stdout is block-buffered by default — progress
    // lines would all arrive in one burst at exit instead of streaming.
    // PYTHONUNBUFFERED forces line-by-line flushing so onUpdate fires live.
    const child = spawn('yt-dlp', args, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stderr = '';
    let buf = '';
    let lastPercent = -1;
    let realMeta = null;
    const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const dl = YT_DOWNLOAD_RE.exec(line);
        if (dl) {
          const downloaded = Number(dl[1]);
          const total = dl[2] !== 'NA' ? Number(dl[2]) : (dl[3] !== 'NA' ? Number(dl[3]) : 0);
          const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
          if (percent !== null && percent !== lastPercent) {
            lastPercent = percent;
            onUpdate?.({ phase: 'downloading', percent });
          }
          continue;
        }
        const m = YT_META_RE.exec(line);
        if (m) {
          const [title, artist, durationStr] = m[1].split('|||');
          realMeta = {
            title: title && title !== 'NA' ? title : '', artist: artist && artist !== 'NA' ? artist : '',
            duration: Math.round(Number(durationStr)) || 0
          };
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(lastErrorLine(stderr) || `yt-dlp exited with code ${code}`));
      resolve(realMeta);
    });
  }).then(async (realMeta) => {
    const { audioPath, thumbPath } = await findDownloadedFiles(rawStem);
    if (!audioPath) throw new Error('Could not determine the downloaded audio filename');
    return { audioPath, thumbPath, realMeta };
  });
}

async function convertToM4a(audioPath, thumbPath, dest, meta, onUpdate) {
  const ffBin = await ffmpegBin();
  const durationSeconds = Number(meta?.duration) || 0;
  const args = [
    '-y', '-i', audioPath,
    ...(thumbPath ? ['-i', thumbPath] : []),
    '-map', '0:a',
    ...(thumbPath ? ['-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic'] : []),
    '-c:a', 'aac', '-b:a', '192k',
    ...(meta?.title ? ['-metadata', `title=${meta.title}`] : []),
    ...(meta?.artist ? ['-metadata', `artist=${meta.artist}`] : []),
    ...(meta?.album ? ['-metadata', `album=${meta.album}`] : []),
    '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    '-f', 'mp4', dest
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffBin, args, { windowsHide: true });
    let stderr = '';
    let buf = '';
    let lastPercent = -1;
    const timer = setTimeout(() => child.kill(), 30 * 60 * 1000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        // out_time_ms is a long-standing ffmpeg misnomer: it's actually
        // microseconds (identical to out_time_us) — confirmed by testing,
        // not documentation. Dividing by 1000 instead of 1e6 would read
        // 1000x too fast.
        const m = /^out_time_us=(-?\d+)$/.exec(line);
        if (m && durationSeconds > 0) {
          const seconds = Math.max(0, Number(m[1])) / 1_000_000;
          const percent = Math.max(0, Math.min(100, Math.round((seconds / durationSeconds) * 100)));
          if (percent !== lastPercent) {
            lastPercent = percent;
            onUpdate?.({ phase: 'converting', percent });
          }
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(lastErrorLine(stderr) || `ffmpeg exited with code ${code}`));
      resolve();
    });
  });
}

// Returns the metadata actually embedded, when a fresh download happened —
// real values from the individual resolve, filled in over whatever sparse
// placeholder the caller had — so pumpYoutube can correct the persisted
// track entry if a batch/set add only had "Untitled" to go on. Returns
// nothing for the already-cached fast path: nothing changed, nothing to fix.
async function downloadYoutubeAudio(videoId, meta, onUpdate) {
  const dest = path.join(YOUTUBE_DIR, `${videoId}.m4a`);
  try { await fs.access(dest); return; } catch { /* not cached yet */ }
  const sourceUrl = safeYoutubeUrl(meta?.sourceUrl);
  if (!sourceUrl) throw new Error('No valid source URL recorded for this track');
  const rawStem = path.join(YOUTUBE_DIR, `${videoId}.src`);
  await cleanupYoutubeRawFiles(rawStem);
  try {
    const { audioPath, thumbPath, realMeta } = await downloadRawAudio(sourceUrl, rawStem, onUpdate);
    const finalMeta = {
      title: realMeta?.title || meta?.title || 'Untitled',
      artist: realMeta?.artist || meta?.artist || 'Unknown',
      album: meta?.album || '',
      duration: realMeta?.duration || meta?.duration || 0
    };
    await convertToM4a(audioPath, thumbPath, dest, finalMeta, onUpdate);
    return finalMeta;
  } finally {
    await cleanupYoutubeRawFiles(rawStem);
  }
}

const ytQueue = [];
const ytQueued = new Set();
// videoId -> { videoId, playlist, title, status: 'queued'|'downloading'|'error', error? }
// Holds every job that isn't finished yet, plus failed ones (until retried),
// so a freshly (re)loaded playlist manager can ask "what's still in flight
// / what failed" instead of only learning about it from a /ws event it
// happened to be connected for.
const ytJobs = new Map();
let ytBusy = false;

function enqueueYoutube(videoId, playlist, meta) {
  if (ytQueued.has(videoId)) return;
  ytQueued.add(videoId);
  const job = { videoId, playlist, title: meta?.title || '', meta, status: 'queued' };
  ytJobs.set(videoId, job);
  ytQueue.push(job);
  broadcastYoutube('queued', job);
  pumpYoutube();
}

function broadcastYoutube(event, job, error) {
  const remaining = ytQueue.length + (ytBusy ? 1 : 0);
  const data = JSON.stringify({
    type: 'youtube', event, videoId: job.videoId, playlist: job.playlist, title: job.title,
    percent: Number.isFinite(job.percent) ? job.percent : null, phase: job.phase || null,
    remaining, ...(job.correctedMeta ? { meta: job.correctedMeta } : {}), ...(error ? { error } : {})
  });
  for (const c of wssRef.clients) {
    if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch { /* ignore */ } }
  }
}

// A batch/set add only had sparse placeholder metadata for some sites
// (SoundCloud's flat listing, confirmed by testing, has no title/duration
// per entry) — once the real values are known post-download, fix the
// persisted entry so it doesn't say "Untitled" forever.
async function patchYoutubeTrackMeta(playlistName, videoId, finalMeta) {
  const file = path.join(PLAYLIST_DIR, `${playlistName}.json`);
  let data;
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return false; }
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const idx = tracks.findIndex((t) => t?.storage === 'youtube' && t.videoId === videoId);
  if (idx < 0) return false;
  const track = tracks[idx];
  if (track.title === finalMeta.title && track.artist === finalMeta.artist && track.duration === finalMeta.duration) return false;
  tracks[idx] = { ...track, title: finalMeta.title, artist: finalMeta.artist, duration: finalMeta.duration };
  await writeJsonFile(file, { ...data, tracks, saved: new Date().toISOString() });
  return true;
}

async function pumpYoutube() {
  if (ytBusy) return;
  const job = ytQueue.shift();
  if (!job) return;
  ytBusy = true;
  job.status = 'downloading';
  job.phase = 'downloading';
  broadcastYoutube('downloading', job);
  try {
    const finalMeta = await downloadYoutubeAudio(job.videoId, job.meta, (update) => {
      job.phase = update.phase;
      job.percent = update.percent;
      broadcastYoutube('progress', job);
    });
    if (finalMeta) {
      job.title = finalMeta.title;
      if (await patchYoutubeTrackMeta(job.playlist, job.videoId, finalMeta)) job.correctedMeta = finalMeta;
    }
    enqueueLoudness(trackRef({ storage: 'youtube', file: `${job.videoId}.m4a` }), true);
    job.status = 'ready';
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  }
  ytQueued.delete(job.videoId);
  if (job.status === 'ready') ytJobs.delete(job.videoId);
  ytBusy = false;
  broadcastYoutube(job.status, job, job.error);
  if (ytQueue.length) setTimeout(pumpYoutube, 250);
}

// youtube-cache is a shared cache keyed by videoId (like the music library
// or a registered filepath source) — the same download can be referenced
// by more than one playlist. Deleting a playlist should reclaim the disk
// space for videos it uniquely owned, but never remove one another saved
// playlist still points at.
async function youtubeIdsStillInUse(excludeName) {
  const inUse = new Set();
  let files = [];
  try { files = (await fs.readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')); } catch { return inUse; }
  for (const file of files) {
    if (file.replace(/\.json$/i, '') === excludeName) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, file), 'utf8'));
      for (const t of (Array.isArray(data.tracks) ? data.tracks : [])) {
        if (t?.storage === 'youtube' && t.videoId) inUse.add(t.videoId);
      }
    } catch { /* skip corrupt files */ }
  }
  return inUse;
}

async function pruneYoutubeCache(tracks, excludeName) {
  const videoIds = [...new Set((tracks || []).filter((t) => t?.storage === 'youtube' && t.videoId).map((t) => t.videoId))];
  if (!videoIds.length) return;
  const inUse = await youtubeIdsStillInUse(excludeName);
  const cache = await loadLoudCache();
  let cacheChanged = false;
  for (const id of videoIds) {
    if (inUse.has(id)) continue;
    const full = path.join(YOUTUBE_DIR, `${id}.m4a`);
    await fs.unlink(full).catch(() => {});
    await fs.unlink(sidecarPath(full)).catch(() => {});
    if (cache[`youtube:${id}.m4a`]) { delete cache[`youtube:${id}.m4a`]; cacheChanged = true; }
  }
  if (cacheChanged) loudDirty = true;
}

// ------------------------------------------------------------
// Audio metadata (cached by path/mtime/size)
// ------------------------------------------------------------
const metaCache = new Map();

function sidecarPath(full) { return `${full}.neonamp.json`; }

async function readSidecar(full) {
  try {
    const data = JSON.parse(await fs.readFile(sidecarPath(full), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}

async function applySidecar(info, full) {
  const sidecar = await readSidecar(full);
  const out = { ...info };
  for (const field of ['title', 'artist', 'album', 'genre', 'year']) {
    if (typeof sidecar[field] === 'string') out[field] = sidecar[field];
  }
  out.hasCustomArtwork = !!sidecar.artwork?.data;
  return out;
}

async function walk(dir, base = '') {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name; // always forward slashes for URLs
    if (e.isDirectory()) {
      out.push(...(await walk(full, rel)));
    } else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push({ full, rel });
    }
  }
  return out;
}

function guessFromName(rel) {
  const bn = path.basename(rel).replace(/\.[^.]+$/, '');
  const parts = bn.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: bn };
}


// ── artist URL + comment extraction (parity with the old player) ──
// ID3v2.3 uses "/" as a multi-value separator, so parsers can split
// URLs into fragments ("https:", "www.youtube.com", "watch?v=x").
// joinTagParts reassembles them — same logic as the old player.
function extractAllTextParts(input) {
  if (typeof input === 'string') {
    const t = input.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(input)) return input.flatMap((v) => extractAllTextParts(v));
  if (input && typeof input === 'object') {
    let out = [];
    for (const k of ['text', 'url', 'value', 'data']) {
      if (k in input) out = out.concat(extractAllTextParts(input[k]));
    }
    return out;
  }
  return [];
}

function joinTagParts(parts) {
  const clean = (Array.isArray(parts) ? parts : []).map((v) => String(v || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  let out = '';
  for (const part of clean) {
    if (/^https?:$/i.test(part)) { out = part.toLowerCase() + '//'; continue; }
    if (!out) { out = part; continue; }
    if (out.endsWith('//')) { out += part.replace(/^\/+/, ''); continue; }
    if (/^[/?#]/.test(part)) { out += part; continue; }
    out += (out.endsWith('/') ? '' : '/') + part.replace(/^\/+/, '');
  }
  return out;
}

function extractFirstText(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) {
    for (const v of input) { const t = extractFirstText(v); if (t) return t; }
    return '';
  }
  if (input && typeof input === 'object') {
    for (const k of ['text', 'value', 'data']) {
      if (k in input) { const t = extractFirstText(input[k]); if (t) return t; }
    }
  }
  return '';
}

function extractFirstUrl(input) {
  if (typeof input === 'string') {
    const m = input.match(/https?:\/\/[^\s"'<>]+/i);
    return m ? m[0] : '';
  }
  if (Array.isArray(input)) {
    for (const v of input) { const u = extractFirstUrl(v); if (u) return u; }
    return '';
  }
  if (input && typeof input === 'object') {
    for (const k of ['text', 'url', 'value', 'data']) {
      if (k in input) { const u = extractFirstUrl(input[k]); if (u) return u; }
    }
  }
  return '';
}

function normalizeUrl(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return extractFirstUrl(t);
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(t)) return `https://${t}`;
  return '';
}

// URL from any tag value, reassembling split fragments if needed
function urlFromTagValue(v) {
  const direct = extractFirstUrl(v);
  const joined = joinTagParts(extractAllTextParts(v));
  const fromJoined = extractFirstUrl(joined) || normalizeUrl(joined);
  // prefer the longer reconstruction when one is a prefix of the other
  if (direct && fromJoined && fromJoined.startsWith(direct)) return fromJoined;
  return direct || fromJoined || '';
}

function extractTxxxValue(meta, keys) {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const native = meta?.native && typeof meta.native === 'object' ? meta.native : {};
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue;
    const byKey = new Map();
    for (const tag of tagList) {
      const rawId = String(tag?.id || tag?.name || '').trim();
      if (!rawId.toUpperCase().startsWith('TXXX')) continue;
      const m = rawId.match(/^TXXX:(.+)$/i);
      const key = String(m ? m[1] : (tag?.value?.description ?? '')).trim().toLowerCase();
      if (!wanted.has(key)) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(...extractAllTextParts(tag?.value?.text ?? tag?.value));
    }
    for (const key of keys.map((k) => k.toLowerCase())) {
      const parts = byKey.get(key);
      if (!parts || !parts.length) continue;
      const joined = joinTagParts(parts);
      if (joined) return joined;
    }
  }
  return '';
}

function extractOfficialArtistUrl(meta) {
  const common = meta?.common || {};
  for (const v of [common.artistwebsite, common.artistwebpage, common.website, common.url, common.podcasturl]) {
    const u = urlFromTagValue(v);
    if (u) return u;
  }
  // W-frames: WOAR (artist page), WOAS (audio source — yt-dlp rips), WOAF (file page)
  const native = meta?.native && typeof meta.native === 'object' ? meta.native : {};
  for (const wanted of ['WOAR', 'WOAS', 'WOAF']) {
    for (const tagList of Object.values(native)) {
      if (!Array.isArray(tagList)) continue;
      for (const tag of tagList) {
        if (String(tag?.id || '').trim().toUpperCase() !== wanted) continue;
        const u = urlFromTagValue(tag?.value);
        if (u) return u;
      }
    }
  }
  const txxx = extractTxxxValue(meta, ['purl', 'webpage_url', 'website', 'artistwebsite', 'url', 'link', 'source', 'songurl']);
  {
    const u = extractFirstUrl(txxx) || normalizeUrl(txxx);
    if (u) return u;
  }
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue;
    for (const tag of tagList) {
      if (!String(tag?.id || '').trim().toUpperCase().startsWith('WXXX')) continue;
      const u = urlFromTagValue(tag?.value);
      if (u) return u;
    }
  }
  return '';
}

function extractCommentText(meta) {
  const direct = joinTagParts(extractAllTextParts(meta?.common?.comment)) || extractFirstText(meta?.common?.comment);
  if (direct) return direct;
  const native = meta?.native && typeof meta.native === 'object' ? meta.native : {};
  for (const tagList of Object.values(native)) {
    if (!Array.isArray(tagList)) continue;
    for (const tag of tagList) {
      if (!String(tag?.id || '').trim().toUpperCase().startsWith('COMM')) continue;
      const text = joinTagParts(extractAllTextParts(tag?.value)) || extractFirstText(tag?.value);
      if (text) return text;
    }
  }
  return extractTxxxValue(meta, ['comment', 'comments', 'description', 'desc']);
}

async function trackInfo(full, rel) {
  const st = await fs.stat(full);
  const key = `${path.resolve(full)}:${st.mtimeMs}:${st.size}`;
  if (metaCache.has(key)) return applySidecar(metaCache.get(key), full);

  const g = guessFromName(rel);
  const info = {
    file: rel,
    title: g.title,
    artist: g.artist,
    album: '',
    genre: '',
    year: '',
    artistUrl: '',
    comment: '',
    duration: 0,
    bitrate: 0,       // kbps
    sampleRate: 0,    // Hz
    channels: 2,
    size: st.size
  };

  try {
    const meta = await parseFile(full, { duration: true, skipCovers: true });
    if (meta.common.title) info.title = meta.common.title;
    if (meta.common.artist) info.artist = meta.common.artist;
    if (meta.common.album) info.album = meta.common.album;
    if (Array.isArray(meta.common.genre) && meta.common.genre[0]) info.genre = meta.common.genre[0];
    if (meta.common.year) info.year = String(meta.common.year);
    info.artistUrl = extractOfficialArtistUrl(meta);
    info.comment = extractCommentText(meta);
    if (meta.format.duration) info.duration = Math.round(meta.format.duration);
    if (meta.format.bitrate) info.bitrate = Math.round(meta.format.bitrate / 1000);
    if (meta.format.sampleRate) info.sampleRate = meta.format.sampleRate;
    if (meta.format.numberOfChannels) info.channels = meta.format.numberOfChannels;
  } catch {
    // Unreadable tags — filename fallback already in place.
  }

  metaCache.set(key, info);
  return applySidecar(info, full);
}

app.get('/api/metadata', async (req, res) => {
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).json({ error: 'Invalid track source' });
  try {
    await fs.access(ref.full);
    res.json({ metadata: await readSidecar(ref.full) });
  } catch { res.status(404).json({ error: 'Track not found' }); }
});

app.put('/api/metadata', async (req, res) => {
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).json({ error: 'Invalid track source' });
  try { await fs.access(ref.full); } catch { return res.status(404).json({ error: 'Track not found' }); }
  const previous = await readSidecar(ref.full);
  const next = { ...previous, version: 1, updated: new Date().toISOString() };
  for (const field of ['title', 'artist', 'album', 'genre', 'year']) {
    if (field in (req.body || {})) next[field] = String(req.body[field] ?? '').trim().slice(0, field === 'year' ? 16 : 300);
  }
  if ('artwork' in (req.body || {})) {
    if (req.body.artwork === null) delete next.artwork;
    else {
      const mime = String(req.body.artwork?.mime || '').toLowerCase();
      const data = String(req.body.artwork?.data || '').replace(/\s/g, '');
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) || !/^[a-z0-9+/]*={0,2}$/i.test(data)) {
        return res.status(400).json({ error: 'Artwork must be JPEG, PNG, WebP, or GIF' });
      }
      if (Buffer.byteLength(data, 'base64') > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'Artwork exceeds the 2 MB limit' });
      }
      next.artwork = { mime, data };
    }
  }
  try {
    await fs.writeFile(sidecarPath(ref.full), JSON.stringify(next, null, 2), 'utf8');
    const info = await trackInfo(ref.full, ref.rel);
    res.json({ ok: true, track: { ...info, storage: ref.storage, ...(ref.playlist ? { playlist: ref.playlist } : {}), ...(ref.sourceId ? { sourceId: ref.sourceId } : {}) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metadata', async (req, res) => {
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).json({ error: 'Invalid track source' });
  try {
    await fs.unlink(sidecarPath(ref.full));
    const info = await trackInfo(ref.full, ref.rel);
    res.json({ ok: true, track: { ...info, storage: ref.storage, ...(ref.playlist ? { playlist: ref.playlist } : {}), ...(ref.sourceId ? { sourceId: ref.sourceId } : {}) } });
  } catch { res.status(404).json({ error: 'No custom metadata exists for this track' }); }
});

// ------------------------------------------------------------
// Legacy direct uploads are streamed to disk, never buffered in RAM.
// ------------------------------------------------------------
const MAX_UPLOAD = Number(process.env.NEONAMP_MAX_UPLOAD_MB || 2048) * 1024 * 1024;

function safeFileName(raw) {
  if (typeof raw !== 'string') return null;
  const n = path.basename(raw.trim())
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^[.\s]+/, '')
    .trim();
  if (!n || !AUDIO_EXT.has(path.extname(n).toLowerCase())) return null;
  return n;
}

// ------------------------------------------------------------
// Loudness normalization — EBU R128 analysis via ffmpeg, cached
// in ./loudness-cache.json. Gain toward a target LUFS is applied
// client-side (deck preamp / jukebox volume). Analysis runs one
// file at a time in the background; results push over /ws.
// ------------------------------------------------------------
const LOUDNESS_CACHE_FILE = path.join(__dirname, 'loudness-cache.json');
const LOUDNESS_TARGET = Number(process.env.NEONAMP_LOUDNESS_TARGET || -16); // LUFS
let ffmpegOk = null; // null = unknown, then true/false
let loudCache = null;
let loudDirty = false;
const loudQueue = [];      // source-aware track refs, front = priority
const loudQueued = new Set();
let loudBusy = false;

function ffmpegAvailable() {
  if (ffmpegOk !== null) return Promise.resolve(ffmpegOk);
  return new Promise((resolve) => {
    ffmpegBin().then((bin) => {
      execFile(bin, ['-version'], { timeout: 5000 }, (err) => {
        ffmpegOk = !err;
        if (!ffmpegOk) console.log('  [loudness] ffmpeg not found — normalization disabled (install ffmpeg to enable)');
        resolve(ffmpegOk);
      });
    });
  });
}

async function loadLoudCache() {
  if (loudCache) return loudCache;
  loudCache = await readJsonFile(LOUDNESS_CACHE_FILE, {});
  return loudCache;
}
setInterval(() => {
  if (!loudDirty || !loudCache) return;
  loudDirty = false;
  writeJsonFile(LOUDNESS_CACHE_FILE, loudCache).catch(() => {});
}, 3000);

function loudKey(st) { return `${st.mtimeMs}:${st.size}`; }

// ------------------------------------------------------------
// Play-count tracking — "most played" smart view. Counted from
// the same {type:'state'} stream the deck/jukebox already push
// over /ws (see persistJukePosition above); no separate report
// call from the client. A track counts once per listening
// session once playback crosses half its duration (10-30s).
// ------------------------------------------------------------
const PLAY_COUNTS_FILE = path.join(__dirname, 'play-counts.json');
let playCounts = new Map();
let playCountsDirty = false;
const playCountProgress = new Map(); // src -> { key, counted }

async function loadPlayCounts() {
  const raw = await readJsonFile(PLAY_COUNTS_FILE, {});
  playCounts = new Map(Object.entries(raw).filter(([, v]) => Number(v) > 0));
}
setInterval(() => {
  if (!playCountsDirty) return;
  playCountsDirty = false;
  writeJsonFile(PLAY_COUNTS_FILE, Object.fromEntries(playCounts)).catch(() => {});
}, 3000);

function maybeCountPlay(s) {
  try {
    if (!s || s.status !== 'playing' || s.storage === 'radio') return;
    const key = s.trackKey || '';
    if (!key) return;
    let entry = playCountProgress.get(s.src);
    if (!entry || entry.key !== key) {
      entry = { key, counted: false };
      playCountProgress.set(s.src, entry);
    }
    if (entry.counted) return;
    const threshold = Math.max(10, Math.min(30, (Number(s.duration) || 0) * 0.5));
    if (Number(s.t) < threshold) return;
    entry.counted = true;
    playCounts.set(key, (playCounts.get(key) || 0) + 1);
    playCountsDirty = true;
  } catch { /* never break playback */ }
}

function gainFromLufs(lufs) {
  if (typeof lufs !== 'number' || !isFinite(lufs)) return null;
  const g = LOUDNESS_TARGET - lufs;
  return Math.round(Math.max(-18, Math.min(9, g)) * 10) / 10;
}

function measureLufs(full) {
  return new Promise((resolve) => {
    ffmpegBin().then((bin) => {
      execFile(bin, [
        '-hide_banner', '-nostats', '-i', full,
        '-map', 'a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'
      ], { timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        const m = String(stderr || '').match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/);
        resolve(m ? Number(m[1]) : null);
      });
    });
  });
}

async function analyzeLoudness(ref) {
  if (!ref) return null;
  let st;
  try { st = await fs.stat(ref.full); } catch { return null; }
  const cache = await loadLoudCache();
  const hit = cache[ref.key];
  if (hit && hit.key === loudKey(st)) return hit;
  if (!(await ffmpegAvailable())) return null;
  const lufs = await measureLufs(ref.full);
  const entry = { key: loudKey(st), lufs, gain: gainFromLufs(lufs), at: Date.now() };
  cache[ref.key] = entry;
  loudDirty = true;
  return entry;
}

function enqueueLoudness(ref, priority = false) {
  if (!ref || loudQueued.has(ref.key)) return;
  loudQueued.add(ref.key);
  if (priority) loudQueue.unshift(ref);
  else loudQueue.push(ref);
  pumpLoudness();
}

async function pumpLoudness() {
  if (loudBusy) return;
  const ref = loudQueue.shift();
  if (!ref) return;
  loudBusy = true;
  try {
    const entry = await analyzeLoudness(ref);
    if (entry && entry.gain !== null) {
      const data = JSON.stringify({
        type: 'loudness', trackKey: ref.key, file: ref.rel,
        storage: ref.storage, playlist: ref.playlist,
        gain: entry.gain, lufs: entry.lufs
      });
      for (const c of wssRef.clients) {
        if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch { /* ignore */ } }
      }
    }
  } catch { /* keep pumping */ }
  loudQueued.delete(ref.key);
  loudBusy = false;
  if (loudQueue.length) setTimeout(pumpLoudness, 250);
}

app.get('/api/loudness/*', async (req, res) => {
  const rel = decodeURIComponent(req.params[0] || '');
  req.query.file = rel;
  return serveLoudness(req, res);
});

app.get('/api/loudness', serveLoudness);

async function serveLoudness(req, res) {
  if (!(await ffmpegAvailable())) return res.json({ status: 'unavailable' });
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).json({ error: 'Invalid track source' });
  let st;
  try { st = await fs.stat(ref.full); } catch { return res.status(404).json({ error: 'Not found' }); }
  const cache = await loadLoudCache();
  const hit = cache[ref.key];
  if (hit && hit.key === loudKey(st)) {
    return res.json({ status: 'ready', gain: hit.gain, lufs: hit.lufs, target: LOUDNESS_TARGET });
  }
  enqueueLoudness(ref, true); // result arrives over /ws
  res.json({ status: 'pending', target: LOUDNESS_TARGET });
}

// ------------------------------------------------------------
// Waveform seek bar — amplitude envelope via ffmpeg, cached in
// ./waveform-cache.json exactly like the loudness cache above (same
// key scheme, same background queue/WS-push shape). Decoded to a low
// fixed sample rate so even an hours-long YouTube podcast stays a
// modest buffer (mono, 1kHz ~= 7MB/hour) instead of needing the whole
// file decoded at full quality just to draw ~400 bars.
// ------------------------------------------------------------
const WAVEFORM_CACHE_FILE = path.join(__dirname, 'waveform-cache.json');
const WAVEFORM_BUCKETS = 400;
const WAVEFORM_SAMPLE_RATE = 1000;
let waveCache = null;
let waveDirty = false;
const waveQueue = [];
const waveQueued = new Set();
let waveBusy = false;

async function loadWaveCache() {
  if (waveCache) return waveCache;
  waveCache = await readJsonFile(WAVEFORM_CACHE_FILE, {});
  return waveCache;
}
setInterval(() => {
  if (!waveDirty || !waveCache) return;
  waveDirty = false;
  writeJsonFile(WAVEFORM_CACHE_FILE, waveCache).catch(() => {});
}, 3000);

function extractPeaks(full) {
  return new Promise((resolve) => {
    ffmpegBin().then((bin) => {
      const args = [
        '-hide_banner', '-nostats', '-i', full,
        '-map', 'a:0', '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE),
        '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'
      ];
      const child = spawn(bin, args, { windowsHide: true });
      const chunks = [];
      const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
      child.stdout.on('data', (d) => chunks.push(d));
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        const sampleCount = Math.floor(buf.length / 2);
        if (sampleCount < 1) return resolve(null);
        const peaks = new Array(WAVEFORM_BUCKETS).fill(0);
        const perBucket = sampleCount / WAVEFORM_BUCKETS;
        let maxAbs = 1;
        for (let b = 0; b < WAVEFORM_BUCKETS; b++) {
          const start = Math.floor(b * perBucket);
          const end = Math.max(start + 1, Math.floor((b + 1) * perBucket));
          let peak = 0;
          for (let i = start; i < end && i < sampleCount; i++) {
            const v = Math.abs(buf.readInt16LE(i * 2));
            if (v > peak) peak = v;
          }
          peaks[b] = peak;
          if (peak > maxAbs) maxAbs = peak;
        }
        resolve(peaks.map((v) => Math.round((v / maxAbs) * 1000) / 1000));
      });
    });
  });
}

async function analyzeWaveform(ref) {
  if (!ref) return null;
  let st;
  try { st = await fs.stat(ref.full); } catch { return null; }
  const cache = await loadWaveCache();
  const hit = cache[ref.key];
  if (hit && hit.key === loudKey(st)) return hit;
  if (!(await ffmpegAvailable())) return null;
  const peaks = await extractPeaks(ref.full);
  if (!peaks) return null;
  const entry = { key: loudKey(st), peaks, at: Date.now() };
  cache[ref.key] = entry;
  waveDirty = true;
  return entry;
}

function enqueueWaveform(ref) {
  if (!ref || waveQueued.has(ref.key)) return;
  waveQueued.add(ref.key);
  waveQueue.push(ref);
  pumpWaveform();
}

async function pumpWaveform() {
  if (waveBusy) return;
  const ref = waveQueue.shift();
  if (!ref) return;
  waveBusy = true;
  try {
    const entry = await analyzeWaveform(ref);
    if (entry) {
      const data = JSON.stringify({
        type: 'waveform', trackKey: ref.key, file: ref.rel,
        storage: ref.storage, playlist: ref.playlist, peaks: entry.peaks
      });
      for (const c of wssRef.clients) {
        if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch { /* ignore */ } }
      }
    }
  } catch { /* keep pumping */ }
  waveQueued.delete(ref.key);
  waveBusy = false;
  if (waveQueue.length) setTimeout(pumpWaveform, 250);
}

app.get('/api/waveform', async (req, res) => {
  if (!(await ffmpegAvailable())) return res.json({ status: 'unavailable' });
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).json({ error: 'Invalid track source' });
  let st;
  try { st = await fs.stat(ref.full); } catch { return res.status(404).json({ error: 'Not found' }); }
  const cache = await loadWaveCache();
  const hit = cache[ref.key];
  if (hit && hit.key === loudKey(st)) {
    return res.json({ status: 'ready', peaks: hit.peaks });
  }
  enqueueWaveform(ref); // result arrives over /ws
  res.json({ status: 'pending' });
});

// ------------------------------------------------------------
// Playlists — metadata in ./playlists. New local tracks retain absolute
// source paths. Private revisions remain supported for older playlists.
// ------------------------------------------------------------
function playlistTrack(track, name) {
  return { ...track, storage: 'playlist', playlist: name };
}

function filepathTrack(track) {
  const registered = registerPathSource(track?.file);
  if (!registered) return { ...track, storage: 'path' };
  return {
    ...track, storage: 'path', file: registered.full,
    originalFile: track.originalFile || registered.full, sourceId: registered.sourceId
  };
}

function exposedPlaylist(data, name) {
  const owned = data?.version === 2;
  return {
    ...data,
    name,
    tracks: (Array.isArray(data?.tracks) ? data.tracks : []).map((t) =>
      t?.storage === 'radio' ? { ...t, storage: 'radio' }
        : t?.storage === 'youtube' ? { ...t, storage: 'youtube' }
        : t?.storage === 'path' ? filepathTrack(t)
        : owned ? playlistTrack(t, name) : { ...t, storage: 'library' }
    )
  };
}

async function linkOrCopy(source, dest) {
  try {
    await fs.link(source, dest);
  } catch (err) {
    if (err?.code === 'EEXIST') return;
    await fs.copyFile(source, dest);
  }
}

async function prunePlaylistMedia(name, tracks) {
  const root = path.resolve(PLAYLIST_MEDIA_DIR, name);
  if (!root.startsWith(path.resolve(PLAYLIST_MEDIA_DIR) + path.sep)) return;
  const keep = new Set((tracks || []).filter((t) => t?.storage !== 'radio' && t?.storage !== 'path' && t?.storage !== 'youtube')
    .map((t) => safeAudioRel(t?.file)).filter(Boolean));
  const files = await walk(root);
  for (const file of files) {
    if (keep.has(file.rel)) continue;
    await fs.unlink(file.full).catch(() => {});
    await fs.unlink(sidecarPath(file.full)).catch(() => {});
  }
  const prune = async (dir) => {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (entry.isDirectory()) await prune(path.join(dir, entry.name));
    if (dir !== root) {
      try { if (!(await fs.readdir(dir)).length) await fs.rmdir(dir); } catch { /* in use or non-empty */ }
    }
  };
  await prune(root);
}

async function writeOwnedPlaylist(name, inputTracks) {
  if (inputTracks.length > 5000) throw new Error('A playlist can contain at most 5000 tracks');
  // Carry forward the linked YouTube source(s), if any — this rebuilds the
  // saved file from scratch and would otherwise silently drop them on the
  // very next unrelated save (reorder, remove a track, whatever).
  const previous = await readJsonFile(path.join(PLAYLIST_DIR, `${name}.json`), {});
  const youtubeSources = Array.isArray(previous.youtubeSources) ? previous.youtubeSources : [];
  const tracks = [];
  for (const input of inputTracks) {
    if (input?.storage === 'path') {
      const ref = trackRef(input);
      if (!ref) {
        const err = new Error(`Invalid file path: ${input?.file || 'unknown'}`);
        err.status = 409;
        throw err;
      }
      try { await fs.access(ref.full); } catch {
        const err = new Error(`Source file is missing: ${input?.file || 'unknown'}`);
        err.status = 409;
        throw err;
      }
      const { playlist: _playlist, available: _available, ...metadata } = input;
      tracks.push({
        ...metadata, storage: 'path', file: ref.full, sourceId: ref.sourceId,
        originalFile: input.originalFile || ref.full
      });
      continue;
    }
    if (input?.storage === 'radio') {
      const stationId = String(input.stationId || input.file || '').trim();
      const url = safeStationUrl(input.url);
      if (!stationId || !url) {
        const err = new Error(`Invalid radio station: ${input?.title || 'unknown'}`);
        err.status = 409;
        throw err;
      }
      tracks.push({
        storage: 'radio', file: stationId, stationId, url,
        title: String(input.title || 'Internet Radio'), artist: String(input.artist || 'INTERNET RADIO'),
        album: String(input.album || ''), genre: String(input.genre || ''),
        homepage: safeStationUrl(input.homepage) || '', duration: 0,
        bitrate: Number(input.bitrate) || 0, sampleRate: 0, channels: 2,
        addedAt: input.addedAt || Date.now()
      });
      continue;
    }
    if (input?.storage === 'youtube') {
      const id = safeVideoId(input.videoId);
      if (!id) {
        const err = new Error(`Invalid YouTube track: ${input?.title || 'unknown'}`);
        err.status = 409;
        throw err;
      }
      tracks.push({
        storage: 'youtube', file: `${id}.m4a`, videoId: id,
        // No blind reconstruction here — a bare id can't be turned back into
        // a correct URL now that it might be YouTube, SoundCloud, Mixcloud,
        // or Bandcamp. A client round-tripping its own track data always
        // has the real sourceUrl anyway; this only degrades for malformed input.
        sourceUrl: safeYoutubeUrl(input.sourceUrl) || '',
        title: String(input.title || 'Untitled').slice(0, 300),
        artist: String(input.artist || 'YouTube').slice(0, 300),
        album: String(input.album || '').slice(0, 300), genre: String(input.genre || '').slice(0, 300),
        year: String(input.year || '').slice(0, 16),
        duration: Math.max(0, Math.round(Number(input.duration)) || 0),
        bitrate: Number(input.bitrate) || 0, sampleRate: Number(input.sampleRate) || 0, channels: Number(input.channels) || 2,
        addedAt: input.addedAt || Date.now()
      });
      continue;
    }
    const ref = trackRef(input);
    if (!ref || ref.storage !== 'playlist' || ref.playlist !== name) {
      const err = new Error('Playlist update contains media owned by another source');
      err.status = 409;
      throw err;
    }
    try { await fs.access(ref.full); } catch {
      const err = new Error(`Track is missing: ${input?.title || input?.file || 'unknown'}`);
      err.status = 409;
      throw err;
    }
    const { storage: _storage, playlist: _playlist, available: _available, ...metadata } = input;
    tracks.push({ ...metadata, file: ref.rel, originalFile: input.originalFile || ref.rel });
  }
  const data = {
    version: 2, name, saved: new Date().toISOString(), tracks,
    ...(youtubeSources.length ? { youtubeSources } : {})
  };
  await writeJsonFile(path.join(PLAYLIST_DIR, `${name}.json`), data);
  await prunePlaylistMedia(name, tracks);
  return exposedPlaylist(data, name);
}

async function materializePlaylist(name, inputTracks, saved = new Date().toISOString()) {
  if (inputTracks.length > 5000) throw new Error('A playlist can contain at most 5000 tracks');
  // Only carries forward if `name` is the same playlist being resaved (a
  // duplicate target has no existing file yet, so it starts unlinked —
  // it wasn't the one anyone pointed a YouTube playlist URL at).
  const previous = await readJsonFile(path.join(PLAYLIST_DIR, `${name}.json`), {});
  const youtubeSources = Array.isArray(previous.youtubeSources) ? previous.youtubeSources : [];
  const revision = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const revisionDir = path.join(PLAYLIST_MEDIA_DIR, name, revision);
  const usedNames = new Map();
  const copied = new Map();
  const tracks = [];
  await fs.mkdir(revisionDir, { recursive: true });

  try {
    for (const input of inputTracks) {
      if (input?.storage === 'path') {
        const ref = trackRef(input);
        if (!ref) throw new Error(`Invalid file path: ${input?.file || 'unknown'}`);
        try { await fs.access(ref.full); } catch {
          const err = new Error(`Cannot find source file: ${input?.file || 'unknown'}`);
          err.status = 409;
          throw err;
        }
        const {
          playlist: _playlist, available: _available,
          file: _file, originalFile: previousOriginal, ...metadata
        } = input;
        tracks.push({
          ...metadata, storage: 'path', file: ref.full, sourceId: ref.sourceId,
          originalFile: previousOriginal || ref.full
        });
        continue;
      }
      if (input?.storage === 'radio') {
        const stationId = String(input.stationId || input.file || '').trim();
        const url = safeStationUrl(input.url);
        if (!stationId || !url) {
          const err = new Error(`Cannot save invalid radio station: ${input?.title || 'unknown'}`);
          err.status = 409;
          throw err;
        }
        tracks.push({
          storage: 'radio', file: stationId, stationId, url,
          title: String(input.title || 'Internet Radio'),
          artist: String(input.artist || 'INTERNET RADIO'),
          album: String(input.album || ''), genre: String(input.genre || ''),
          homepage: safeStationUrl(input.homepage) || '', duration: 0,
          bitrate: Number(input.bitrate) || 0, sampleRate: 0, channels: 2,
          addedAt: input.addedAt || Date.now()
        });
        continue;
      }
      if (input?.storage === 'youtube') {
        const id = safeVideoId(input.videoId);
        if (!id) {
          const err = new Error(`Cannot save invalid YouTube track: ${input?.title || 'unknown'}`);
          err.status = 409;
          throw err;
        }
        tracks.push({
          storage: 'youtube', file: `${id}.m4a`, videoId: id,
          // No blind reconstruction here — a bare id can't be turned back into
        // a correct URL now that it might be YouTube, SoundCloud, Mixcloud,
        // or Bandcamp. A client round-tripping its own track data always
        // has the real sourceUrl anyway; this only degrades for malformed input.
        sourceUrl: safeYoutubeUrl(input.sourceUrl) || '',
          title: String(input.title || 'Untitled').slice(0, 300),
          artist: String(input.artist || 'YouTube').slice(0, 300),
          album: String(input.album || '').slice(0, 300), genre: String(input.genre || '').slice(0, 300),
          year: String(input.year || '').slice(0, 16),
          duration: Math.max(0, Math.round(Number(input.duration)) || 0),
          bitrate: Number(input.bitrate) || 0, sampleRate: Number(input.sampleRate) || 0, channels: Number(input.channels) || 2,
          addedAt: input.addedAt || Date.now()
        });
        continue;
      }
      const ref = trackRef(input);
      if (!ref) throw new Error('Playlist contains an invalid track source');
      try { await fs.access(ref.full); } catch {
        const err = new Error(`Cannot save missing track: ${input?.title || input?.file || 'unknown'}`);
        err.status = 409;
        throw err;
      }

      let destRel = copied.get(ref.key);
      if (!destRel) {
        const original = safeFileName(input.originalFile || path.basename(ref.rel)) || path.basename(ref.rel);
        const ext = path.extname(original);
        const stem = original.slice(0, original.length - ext.length);
        let fileName = original;
        for (let i = 2; usedNames.has(fileName.toLowerCase()); i++) fileName = `${stem} (${i})${ext}`;
        usedNames.set(fileName.toLowerCase(), ref.key);
        destRel = `${revision}/${fileName}`;
        const destFull = path.join(revisionDir, fileName);
        await linkOrCopy(ref.full, destFull);
        await fs.copyFile(sidecarPath(ref.full), sidecarPath(destFull)).catch(() => {});
        copied.set(ref.key, destRel);
      }

      const {
        storage: _storage, playlist: _playlist, available: _available,
        file: _file, originalFile: previousOriginal, ...metadata
      } = input;
      tracks.push({
        ...metadata,
        file: destRel,
        originalFile: previousOriginal || ref.rel
      });
    }

    const data = { version: 2, name, saved, tracks, ...(youtubeSources.length ? { youtubeSources } : {}) };
    await fs.writeFile(path.join(PLAYLIST_DIR, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
    await prunePlaylistMedia(name, tracks);
    return exposedPlaylist(data, name);
  } catch (err) {
    await fs.rm(revisionDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function migrateLegacyPlaylists() {
  let files = [];
  try {
    files = (await fs.readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  } catch { return; }
  for (const file of files) {
    const name = safeName(file.replace(/\.json$/i, ''));
    if (!name) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, file), 'utf8'));
      if (data?.version === 2) continue;
      const oldTracks = Array.isArray(data?.tracks) ? data.tracks : [];
      const migrated = await materializePlaylist(name, oldTracks, data.saved);
      const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8').catch(() => '{}'));
      if (settings.name === name && Array.isArray(settings.tracks) &&
          settings.tracks.length === oldTracks.length &&
          settings.tracks.every((t, i) => t?.file === oldTracks[i]?.file)) {
        settings.tracks = migrated.tracks;
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
      }
      console.log(`  migrated playlist "${name}" to private media storage`);
    } catch (err) {
      console.warn(`  playlist "${name}" could not be migrated: ${err.message}`);
    }
  }
}

await migrateLegacyPlaylists();
await loadPlayCounts();

app.get('/api/playlists', async (req, res) => {
  try {
    const files = (await fs.readdir(PLAYLIST_DIR))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    const playlists = [];
    for (const f of files) {
      try {
        const p = path.join(PLAYLIST_DIR, f);
        const st = await fs.stat(p);
        const data = JSON.parse(await fs.readFile(p, 'utf8'));
        playlists.push({
          name: f.replace(/\.json$/, ''),
          tracks: Array.isArray(data.tracks) ? data.tracks.length : 0,
          independent: data.version === 2,
          modified: st.mtime
        });
      } catch {
        // Skip corrupt files rather than failing the whole listing.
      }
    }
    playlists.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared by /api/search and the smart-playlist endpoints below — reads every
// saved playlist JSON fresh on every call (no database) and runs tracks
// through exposedPlaylist() so `storage` is properly annotated (owned media
// resolves to 'playlist', matching what the client/trackRef() expect) rather
// than whatever raw, possibly-absent value sits in the file on disk.
async function scanAllTracks() {
  let files = [];
  try { files = (await fs.readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')); }
  catch { return []; }
  const all = [];
  for (const file of files) {
    const name = safeName(file.replace(/\.json$/i, ''));
    if (!name) continue;
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, file), 'utf8')); } catch { continue; }
    const { tracks } = exposedPlaylist(data, name);
    for (let index = 0; index < tracks.length; index++) {
      all.push({ playlist: name, index, track: tracks[index] });
    }
  }
  return all;
}

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const all = await scanAllTracks();
  const results = [];
  for (const e of all) {
    const t = e.track;
    const haystack = `${t?.title || ''} ${t?.artist || ''} ${t?.album || ''}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    results.push({
      playlist: e.playlist, index: e.index,
      title: t?.title || '', artist: t?.artist || '', album: t?.album || '',
      duration: Number(t?.duration) || 0, storage: t?.storage || 'library'
    });
    if (results.length >= 500) break;
  }
  results.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  res.json({ results: results.slice(0, 200) });
});

app.get('/api/smart/recent', async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const all = await scanAllTracks();
  const results = all
    .filter((e) => Number(e.track?.addedAt) > 0)
    .sort((a, b) => Number(b.track.addedAt) - Number(a.track.addedAt))
    .slice(0, limit)
    .map((e) => ({
      playlist: e.playlist, index: e.index,
      title: e.track?.title || '', artist: e.track?.artist || '', album: e.track?.album || '',
      duration: Number(e.track?.duration) || 0, storage: e.track?.storage || 'library',
      addedAt: Number(e.track.addedAt)
    }));
  res.json({ results });
});

app.get('/api/smart/played', async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const all = await scanAllTracks();
  const results = all
    .map((e) => ({ ...e, count: playCounts.get(trackRef(e.track)?.key || '') || 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => ({
      playlist: e.playlist, index: e.index,
      title: e.track?.title || '', artist: e.track?.artist || '', album: e.track?.album || '',
      duration: Number(e.track?.duration) || 0, storage: e.track?.storage || 'library',
      count: e.count
    }));
  res.json({ results });
});

app.get('/api/playlists/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  try {
    const raw = await fs.readFile(path.join(PLAYLIST_DIR, `${name}.json`), 'utf8');
    res.json(exposedPlaylist(JSON.parse(raw), name));
  } catch {
    res.status(404).json({ error: 'Playlist not found' });
  }
});

app.put('/api/playlists/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) {
    return res.status(400).json({
      error: 'Invalid name — use letters, numbers, spaces, - or _ (max 64 chars)'
    });
  }
  const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : null;
  if (!tracks) return res.status(400).json({ error: 'Body must include a tracks array' });

  try {
    const alreadyOwned = tracks.every((t) => t?.storage === 'radio' || t?.storage === 'path' || t?.storage === 'youtube' ||
      (t?.storage === 'playlist' && safeName(t.playlist) === name));
    const data = alreadyOwned
      ? await writeOwnedPlaylist(name, tracks)
      : await materializePlaylist(name, tracks);
    res.json({ ok: true, name, count: data.tracks.length, tracks: data.tracks });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function pickServerAudioFiles() {
  if (process.platform !== 'win32') {
    const err = new Error('Native file picking is currently available on Windows; paste absolute paths instead');
    err.status = 501;
    return Promise.reject(err);
  }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Multiselect = $true',
    "$dialog.Title = 'Add audio files to NEONAMP'",
    "$dialog.Filter = 'Audio Files|*.mp3;*.ogg;*.oga;*.wav;*.flac;*.m4a;*.aac;*.opus;*.webm|All Files|*.*'",
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  ConvertTo-Json -Compress -InputObject @($dialog.FileNames)',
    '} else { Write-Output "[]" }'
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const parsed = JSON.parse(String(stdout || '[]').replace(/^\uFEFF/, '').trim() || '[]');
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch { reject(new Error('The native file picker returned an invalid result')); }
    });
  });
}

app.post('/api/files/pick', async (_req, res) => {
  try {
    const paths = await pickServerAudioFiles();
    res.json({ paths });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.post('/api/playlists/:name/paths', async (req, res) => {
  const name = safeName(req.params.name);
  const requested = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, 250) : null;
  if (!name || !requested) return res.status(400).json({ error: 'A valid playlist and paths array are required' });
  const unique = [...new Set(requested.map((value) => safeAudioPath(value)).filter(Boolean))];
  if (!unique.length) return res.status(400).json({ error: 'No valid absolute audio file paths were provided' });
  try {
    const playlistFile = path.join(PLAYLIST_DIR, `${name}.json`);
    const data = JSON.parse(await fs.readFile(playlistFile, 'utf8'));
    const existing = Array.isArray(data.tracks) ? data.tracks : [];
    if (existing.length + unique.length > 5000) return res.status(409).json({ error: 'A playlist can contain at most 5000 tracks' });
    const added = [];
    for (const full of unique) {
      const stat = await fs.stat(full);
      if (!stat.isFile()) throw new Error(`Not a file: ${full}`);
      const registered = registerPathSource(full);
      const info = await trackInfo(full, path.basename(full));
      const track = {
        ...info, storage: 'path', file: registered.full, sourceId: registered.sourceId,
        originalFile: registered.full, addedAt: Date.now()
      };
      existing.push(track);
      added.push(filepathTrack(track));
      enqueueLoudness(trackRef(track), true);
    }
    const next = { ...data, version: 2, name, saved: new Date().toISOString(), tracks: existing };
    await writeJsonFile(playlistFile, next);
    const playlist = exposedPlaylist(next, name);
    res.json({ ok: true, name, count: playlist.tracks.length, added, tracks: playlist.tracks });
  } catch (err) {
    res.status(err?.code === 'ENOENT' ? 404 : 500).json({ error: err?.code === 'ENOENT' ? 'Playlist or source file not found' : err.message });
  }
});

function buildYoutubeStubs(rawEntries, info, isPlaylist, existingIds) {
  const playlistTitle = isPlaylist ? String(info.title || '').trim().slice(0, 300) : '';
  const seenIds = new Set(existingIds);
  const stubs = [];
  for (const e of rawEntries) {
    const id = safeVideoId(e?.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    // webpage_url/url point at the actual source page regardless of site —
    // reconstructing a youtube.com URL from just the id (the old approach)
    // silently pointed non-YouTube tracks at the wrong site entirely.
    const sourceUrl = safeYoutubeUrl(e?.webpage_url || e?.url) || safeYoutubeUrl(info.webpage_url) || '';
    stubs.push({
      storage: 'youtube', file: `${id}.m4a`, videoId: id, sourceUrl,
      title: String(e.title || 'Untitled').trim().slice(0, 300),
      artist: String(e.uploader || e.channel || info.uploader || info.channel || 'Unknown').trim().slice(0, 300),
      album: playlistTitle, genre: '', year: '',
      duration: Math.max(0, Math.round(Number(e.duration)) || 0),
      bitrate: 0, sampleRate: 0, channels: 2, addedAt: Date.now()
    });
  }
  return stubs;
}

function queueYoutubeStubs(stubs, playlistName) {
  for (const stub of stubs) {
    enqueueYoutube(stub.videoId, playlistName, {
      title: stub.title, artist: stub.artist, album: stub.album, duration: stub.duration, sourceUrl: stub.sourceUrl
    });
  }
}

// A single video downloads inline so it is instantly playable; a playlist
// URL is resolved (fast — no audio fetched yet) and its videos queued for
// background download, one at a time, with progress over /ws.
app.post('/api/playlists/:name/youtube', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  const url = safeYoutubeUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'A valid YouTube video or playlist URL is required' });
  if (!(await ytDlpAvailable())) {
    return res.status(503).json({ error: 'yt-dlp was not found on PATH — install yt-dlp to add YouTube audio' });
  }

  const playlistFile = path.join(PLAYLIST_DIR, `${name}.json`);
  let data;
  try { data = JSON.parse(await fs.readFile(playlistFile, 'utf8')); }
  catch { return res.status(404).json({ error: 'Create or select a playlist before adding YouTube audio' }); }

  let info;
  try { info = await resolveYoutube(url); }
  catch (err) { return res.status(502).json({ error: `Could not resolve YouTube URL: ${err.message}` }); }

  const isPlaylist = Array.isArray(info.entries);
  const rawEntries = isPlaylist ? info.entries.slice(0, 300) : [info];
  const existing = Array.isArray(data.tracks) ? data.tracks : [];
  const existingIds = existing.filter((t) => t?.storage === 'youtube').map((t) => t.videoId);
  const stubs = buildYoutubeStubs(rawEntries, info, isPlaylist, existingIds);

  if (!stubs.length) {
    return res.status(400).json({ error: isPlaylist ? 'No new videos found in that playlist' : 'That video is already in this playlist' });
  }
  if (existing.length + stubs.length > 5000) return res.status(409).json({ error: 'A playlist can contain at most 5000 tracks' });

  // A playlist URL is remembered so this NEONAMP playlist can be checked
  // later for videos added to the source since — a single video URL isn't,
  // there's nothing to "check again" for one fixed video.
  const youtubeSources = isPlaylist
    ? [...new Set([...(Array.isArray(data.youtubeSources) ? data.youtubeSources : []), url])]
    : (Array.isArray(data.youtubeSources) ? data.youtubeSources : []);

  const next = { ...data, version: 2, name, saved: new Date().toISOString(), tracks: [...existing, ...stubs], youtubeSources };
  await writeJsonFile(playlistFile, next);
  const playlist = exposedPlaylist(next, name);

  // Always queue — never block this request on the actual download. A
  // "short song, ready the instant the dialog closes" fast path sounds
  // nice until someone adds a multi-hour mix: the request (and the modal)
  // would hang for as long as the download takes, with no progress shown.
  queueYoutubeStubs(stubs, name);

  res.json({ ok: true, name, count: playlist.tracks.length, added: stubs, queued: true, tracks: playlist.tracks, youtubeSources: playlist.youtubeSources });
});

// Re-resolves every YouTube playlist URL this NEONAMP playlist was ever
// built from and queues anything new. Never removes tracks whose source
// video vanished from the upstream list — the local download is still
// good, and silently deleting someone's queue entry is exactly the kind
// of surprise this app avoids everywhere else.
async function resyncYoutubePlaylist(name) {
  const playlistFile = path.join(PLAYLIST_DIR, `${name}.json`);
  let data;
  try { data = JSON.parse(await fs.readFile(playlistFile, 'utf8')); } catch { return { added: [] }; }
  const sources = Array.isArray(data.youtubeSources) ? data.youtubeSources : [];
  if (!sources.length) return { added: [] };

  let existing = Array.isArray(data.tracks) ? data.tracks : [];
  const added = [];
  for (const url of sources) {
    let info;
    try { info = await resolveYoutube(url); } catch { continue; }
    const isPlaylist = Array.isArray(info.entries);
    const rawEntries = isPlaylist ? info.entries.slice(0, 300) : [info];
    const existingIds = existing.filter((t) => t?.storage === 'youtube').map((t) => t.videoId);
    const stubs = buildYoutubeStubs(rawEntries, info, isPlaylist, existingIds);
    if (!stubs.length) continue;
    existing = [...existing, ...stubs];
    added.push(...stubs);
  }
  if (!added.length) return { added: [] };
  if (existing.length > 5000) return { added: [] };

  const next = { ...data, version: 2, name, saved: new Date().toISOString(), tracks: existing };
  await writeJsonFile(playlistFile, next);
  queueYoutubeStubs(added, name);
  return { added, playlist: exposedPlaylist(next, name) };
}

app.post('/api/playlists/:name/youtube/resync', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  if (!(await ytDlpAvailable())) {
    return res.status(503).json({ error: 'yt-dlp was not found on PATH — install yt-dlp to add YouTube audio' });
  }
  try {
    const { added, playlist } = await resyncYoutubePlaylist(name);
    res.json({
      ok: true, added: added.map((s) => ({ videoId: s.videoId, title: s.title })),
      tracks: playlist?.tracks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Re-queues a track that previously failed to download. The track entry
// itself already carries everything needed (title/artist/album/duration),
// so this is just enqueueYoutube() again — ytQueued no longer blocks it
// once a job has resolved to 'error'.
app.post('/api/playlists/:name/youtube/retry', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  const videoId = safeVideoId(req.body?.videoId);
  if (!videoId) return res.status(400).json({ error: 'A valid videoId is required' });
  if (!(await ytDlpAvailable())) {
    return res.status(503).json({ error: 'yt-dlp was not found on PATH — install yt-dlp to add YouTube audio' });
  }
  let data;
  try { data = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, `${name}.json`), 'utf8')); }
  catch { return res.status(404).json({ error: 'Playlist not found' }); }
  const track = (Array.isArray(data.tracks) ? data.tracks : []).find((t) => t?.storage === 'youtube' && t.videoId === videoId);
  if (!track) return res.status(404).json({ error: 'That track is not in this playlist' });
  enqueueYoutube(videoId, name, {
    title: track.title, artist: track.artist, album: track.album, duration: track.duration, sourceUrl: track.sourceUrl
  });
  res.json({ ok: true });
});

// Snapshot of in-flight downloads, so a (re)loaded playlist manager can show
// current progress immediately instead of waiting on the next /ws event.
app.get('/api/youtube/queue', (req, res) => {
  res.json({ jobs: [...ytJobs.values()].map(({ videoId, playlist, title, status, error, percent, phase }) => ({ videoId, playlist, title, status, error, percent, phase })) });
});

async function unusedPlaylistUploadName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; ; i++) {
    try {
      await fs.access(path.join(dir, candidate));
      candidate = `${stem} (${i})${ext}`;
    } catch { return candidate; }
  }
}

app.put('/api/playlists/:name/upload', async (req, res) => {
  const playlist = safeName(req.params.name);
  const uploadName = safeFileName(req.query.name);
  if (!playlist || !uploadName) {
    return res.status(400).json({ error: 'Valid playlist and audio file names are required' });
  }
  const playlistFile = path.join(PLAYLIST_DIR, `${playlist}.json`);
  let data;
  try { data = JSON.parse(await fs.readFile(playlistFile, 'utf8')); }
  catch { return res.status(404).json({ error: 'Create or select a playlist before uploading' }); }

  const uploadDir = path.join(PLAYLIST_MEDIA_DIR, playlist, 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  const fileName = await unusedPlaylistUploadName(uploadDir, uploadName);
  const rel = `uploads/${fileName}`;
  const dest = path.join(uploadDir, fileName);
  const ws = createWriteStream(dest, { flags: 'wx' });
  let bytes = 0;
  let failed = false;
  const fail = (code, message) => {
    if (failed) return;
    failed = true;
    ws.destroy();
    fs.unlink(dest).catch(() => {});
    if (!res.headersSent) res.status(code).json({ error: message });
  };
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD) {
      fail(413, `File exceeds ${Math.round(MAX_UPLOAD / 1048576)} MB limit`);
      req.destroy();
    }
  });
  req.on('aborted', () => fail(400, 'Upload aborted'));
  req.on('error', () => fail(400, 'Upload interrupted'));
  ws.on('error', (err) => fail(500, err.message));
  ws.on('finish', async () => {
    if (failed) return;
    if (!bytes) return fail(400, 'Empty upload');
    try {
      const info = await trackInfo(dest, rel);
      const rawTrack = { ...info, originalFile: uploadName, addedAt: Date.now() };
      data = { ...data, version: 2, name: playlist, saved: new Date().toISOString() };
      data.tracks = Array.isArray(data.tracks) ? data.tracks : [];
      data.tracks.push(rawTrack);
      await writeJsonFile(playlistFile, data);
      const track = playlistTrack(rawTrack, playlist);
      enqueueLoudness(trackRef(track), true);
      res.json({ ok: true, name: playlist, count: data.tracks.length, track });
    } catch (err) {
      await fs.unlink(dest).catch(() => {});
      fail(500, err.message);
    }
  });
  req.pipe(ws);
});

app.post('/api/playlists/:name/activate', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  try {
    const raw = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, `${name}.json`), 'utf8'));
    const data = exposedPlaylist(raw, name);
    if (!data.tracks.length) return res.status(409).json({ error: 'Playlist is empty' });
    const index = Math.max(0, Math.min(data.tracks.length - 1, Number(req.body?.index) || 0));
    const play = req.body?.play !== false;
    const settings = await readJsonFile(SETTINGS_FILE, {});
    settings.name = name;
    settings.tracks = data.tracks;
    settings.sel = index;
    settings.position = { idx: index, t: 0, state: play ? 'play' : 'stop' };
    await writeJsonFile(SETTINGS_FILE, settings);
    broadcastCmd('load-playlist', { name, index, play });
    res.json({ ok: true, name, index, play, count: data.tracks.length });
  } catch (err) {
    res.status(err?.code === 'ENOENT' ? 404 : 500).json({ error: err?.code === 'ENOENT' ? 'Playlist not found' : err.message });
  }
});

app.post('/api/playlists/:name/rename', async (req, res) => {
  const from = safeName(req.params.name);
  const to = safeName(req.body?.name);
  if (!from || !to) return res.status(400).json({ error: 'A valid new playlist name is required' });
  if (from.toLowerCase() === to.toLowerCase()) return res.status(409).json({ error: 'Choose a different playlist name' });
  const fromFile = path.join(PLAYLIST_DIR, `${from}.json`);
  const toFile = path.join(PLAYLIST_DIR, `${to}.json`);
  const fromMedia = path.join(PLAYLIST_MEDIA_DIR, from);
  const toMedia = path.join(PLAYLIST_MEDIA_DIR, to);
  let mediaMoved = false;
  let destinationWritten = false;
  let sourceRemoved = false;
  try {
    const raw = JSON.parse(await fs.readFile(fromFile, 'utf8'));
    try {
      await fs.access(toFile);
      return res.status(409).json({ error: 'A playlist with that name already exists' });
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
    try {
      await fs.rename(fromMedia, toMedia);
      mediaMoved = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err; // radio-only playlists may have no media directory
    }
    const data = { ...raw, version: 2, name: to, saved: new Date().toISOString() };
    await writeJsonFile(toFile, data);
    destinationWritten = true;
    await fs.unlink(fromFile);
    sourceRemoved = true;

    try {
      const settings = await readJsonFile(SETTINGS_FILE, {});
      if (settings.name === from) {
        settings.name = to;
        if (Array.isArray(settings.tracks)) {
          settings.tracks = settings.tracks.map((track) =>
            track?.storage === 'playlist' && track.playlist === from ? { ...track, playlist: to } : track
          );
        }
        await writeJsonFile(SETTINGS_FILE, settings);
      }
    } catch (err) { console.warn(`  renamed playlist but could not update active session: ${err.message}`); }
    broadcastCmd('rename-playlist', { from, to });
    res.json({ ok: true, from, to, playlist: exposedPlaylist(data, to) });
  } catch (err) {
    if (!sourceRemoved && destinationWritten) await fs.unlink(toFile).catch(() => {});
    if (!sourceRemoved && mediaMoved) await fs.rename(toMedia, fromMedia).catch(() => {});
    res.status(err?.code === 'ENOENT' ? 404 : 500).json({ error: err?.code === 'ENOENT' ? 'Playlist not found' : err.message });
  }
});

app.delete('/api/playlists/:name', async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid playlist name' });
  try {
    const raw = await fs.readFile(path.join(PLAYLIST_DIR, `${name}.json`), 'utf8');
    let doomed = null;
    try { doomed = JSON.parse(raw); } catch { /* corrupt playlist file — still deletable, nothing to prune */ }
    await fs.rm(path.join(PLAYLIST_MEDIA_DIR, name), { recursive: true, force: true });
    await fs.unlink(path.join(PLAYLIST_DIR, `${name}.json`));
    await pruneYoutubeCache(doomed?.tracks, name).catch(() => {});
    const settings = await readJsonFile(SETTINGS_FILE, {});
    if (settings.name === name) {
      settings.name = '';
      settings.tracks = [];
      settings.sel = -1;
      settings.position = { idx: -1, t: 0, state: 'stop' };
      await writeJsonFile(SETTINGS_FILE, settings);
      broadcastCmd('clear-playlist', { name });
    }
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Playlist not found' });
  }
});

// ------------------------------------------------------------
// Settings — the player's full state (queue, track position,
// volume, EQ, visualizer, panels) lives in ./settings.json so
// a reload puts you exactly where you left off.
// ------------------------------------------------------------
async function readSettings(req, res) {
  try {
    const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    if (Array.isArray(settings.tracks)) {
      settings.tracks = settings.tracks.map((track) => track?.storage === 'path' ? filepathTrack(track) : track);
    }
    res.json(settings);
  } catch {
    res.json({});
  }
}
async function writeSettings(req, res) {
  try {
    const settings = req.body ?? {};
    if (Array.isArray(settings.tracks)) {
      settings.tracks = settings.tracks.map((track) => track?.storage === 'path' ? filepathTrack(track) : track);
    }
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.get('/api/session', readSettings);
app.put('/api/session', writeSettings);
app.post('/api/session', writeSettings); // navigator.sendBeacon on tab close

// A deliberately narrow remote-control endpoint for the playlist manager.
// It updates only player preferences (never the queue/position) and relays the
// same patch to every open deck/OBS jukebox for immediate application.
const CONTROL_COMMANDS = new Set(['next', 'prev', 'pause', 'resume', 'stop']);
const CONTROL_VIS = new Set([
  'bars', 'scope', 'vu', 'radial', 'waterfall', 'dots', 'particles',
  'lissajous', 'tunnel', 'spiral', 'pulse', 'off'
]);
const CONTROL_THEMES = new Set([
  'NEON', 'C64', 'AMBER TERM', 'VAPORWAVE', 'GREEN PHOS',
  'CRIMSON', 'ICE', 'SUNSET', 'TOXIC', 'DEEP SPACE', 'MIAMI', 'GOLD RUSH', 'BLUE PHOSPHOR', 'STEEL', 'TRON GRID'
]);
const CONTROL_XFADE = new Set([0, 2, 4, 6, 8, 10]);
const CONTROL_DSP = {
  compressor: [0, 1], limiter: [0, 1], width: [0, 2], mono: [0, 1],
  bass: [0, 12], reverb: [0, .65]
};
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

function sanitizedControlSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const clean = {};
  if (Number.isFinite(Number(input.volume))) clean.volume = clampNumber(input.volume, 0, 100);
  if (Number.isFinite(Number(input.balance))) clean.balance = clampNumber(input.balance, -100, 100);
  if (typeof input.shuffle === 'boolean') clean.shuffle = input.shuffle;
  if (['off', 'all', 'one'].includes(input.repeat)) clean.repeat = input.repeat;
  if (typeof input.normalize === 'boolean') clean.normalize = input.normalize;
  if (CONTROL_XFADE.has(Number(input.xfade))) clean.xfade = Number(input.xfade);
  if (typeof input.obsEq === 'boolean') clean.obsEq = input.obsEq;
  if (CONTROL_VIS.has(input.visMode)) clean.visMode = input.visMode;
  if (CONTROL_THEMES.has(input.theme)) clean.theme = input.theme;
  if (input.eq && typeof input.eq === 'object' && !Array.isArray(input.eq)) {
    const eq = {};
    if (typeof input.eq.on === 'boolean') eq.on = input.eq.on;
    if (typeof input.eq.preset === 'string') eq.preset = input.eq.preset.slice(0, 32);
    if (Array.isArray(input.eq.bands)) {
      eq.bands = input.eq.bands.slice(0, 10).map((value) =>
        Number.isFinite(Number(value)) ? clampNumber(value, -12, 12) : 0
      );
      while (eq.bands.length < 10) eq.bands.push(0);
    }
    if (Object.keys(eq).length) clean.eq = eq;
  }
  if (input.dsp && Array.isArray(input.dsp.modules)) {
    clean.dsp = {
      modules: input.dsp.modules.slice(0, 16).map((module) => {
        const range = CONTROL_DSP[module?.type];
        if (!range) return null;
        const raw = Number(module.value);
        return {
          id: typeof module.id === 'string' && module.id.length <= 80 ? module.id : randomUUID(),
          type: module.type,
          enabled: module.enabled !== false,
          value: Number.isFinite(raw) ? clampNumber(raw, range[0], range[1]) : range[0]
        };
      }).filter(Boolean)
    };
  }
  return clean;
}

app.post('/api/control', async (req, res) => {
  const cmd = typeof req.body?.cmd === 'string' ? req.body.cmd : '';
  if (cmd && !CONTROL_COMMANDS.has(cmd)) return res.status(400).json({ error: 'Invalid control command' });
  const update = sanitizedControlSettings(req.body?.settings);
  if (!cmd && !Object.keys(update).length) return res.status(400).json({ error: 'No valid control changes' });
  try {
    if (Object.keys(update).length) {
      const settings = await readJsonFile(SETTINGS_FILE, {});
      Object.assign(settings, update);
      await writeJsonFile(SETTINGS_FILE, settings);
      broadcastCmd('apply-settings', { settings: update });
    }
    if (cmd) broadcastCmd(cmd);
    res.json({ ok: true, settings: update, cmd: cmd || undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Album art — extracts embedded cover art (ID3 APIC, FLAC
// pictures, MP4 covr, …) on demand. Cached, including misses.
// ------------------------------------------------------------
const ART_CACHE = new Map(); // key → { mime, buf } | { none: true }
const ART_CACHE_MAX = 60;

app.get('/api/art', serveArt);
app.get('/api/art/*', (req, res) => {
  const rel = decodeURIComponent(req.params[0] || '');
  req.query.file = rel;
  return serveArt(req, res);
});

async function serveArt(req, res) {
  const ref = requestTrackRef(req);
  if (!ref) return res.status(400).end();
  let st;
  try { st = await fs.stat(ref.full); } catch { return res.status(404).end(); }

  const sidecar = await readSidecar(ref.full);
  if (sidecar.artwork?.mime && sidecar.artwork?.data) {
    try {
      const artwork = Buffer.from(sidecar.artwork.data, 'base64');
      res.set('Content-Type', sidecar.artwork.mime);
      res.set('Cache-Control', 'no-cache');
      return res.send(artwork);
    } catch { /* fall through to embedded art */ }
  }

  const key = `${ref.key}:${st.mtimeMs}:${st.size}`;
  let hit = ART_CACHE.get(key);
  if (!hit) {
    hit = { none: true };
    try {
      const meta = await parseFile(ref.full, { skipCovers: false, duration: false });
      const cover = selectCover(meta.common.picture);
      if (cover && cover.data && cover.data.length) {
        hit = { mime: cover.format || 'image/jpeg', buf: Buffer.from(cover.data) };
      }
    } catch { /* unreadable — negative-cache it */ }
    ART_CACHE.set(key, hit);
    if (ART_CACHE.size > ART_CACHE_MAX) {
      ART_CACHE.delete(ART_CACHE.keys().next().value);
    }
  }
  if (hit.none) return res.status(404).end();
  res.set('Content-Type', hit.mime);
  res.set('Cache-Control', 'max-age=3600');
  res.send(hit.buf);
}


// ------------------------------------------------------------
// Twitch chat integration — !song and mod transport commands.
// Same architecture as the old player: OAuth code flow, EventSub
// WebSocket for channel.chat.message, Helix /chat/messages to
// reply. Now-playing truth comes from the /ws state relay, so it
// works whether the main deck or the OBS jukebox is playing.
// Config: ./twitch-config.json   Tokens: ./twitch-auth.json
// ------------------------------------------------------------
const TWITCH_CONFIG_FILE = path.join(__dirname, 'twitch-config.json');
const TWITCH_AUTH_FILE = path.join(__dirname, 'twitch-auth.json');
const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_HELIX_BASE = 'https://api.twitch.tv/helix';
const TWITCH_EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

const oauthStates = new Map();
const twitchState = {
  ws: null, status: 'idle', connecting: false, connected: false,
  sessionId: null, reconnectUrl: null, reconnectTimer: null, lastError: null
};
let lastSongCommandAt = 0;
let songCommandInFlight = false;
let lastAnnouncedFile = '';
let lastAnnouncedAt = 0;

async function readJsonFile(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonFile(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function defaultTwitchConfig() {
  return {
    clientId: '',
    clientSecret: '',
    redirectUrl: `http://localhost:${PORT}/auth`,
    broadcasterUserId: '',
    scopes: ['user:read:chat', 'user:write:chat'],
    autoConnect: true,
    chat: {
      songCommandEnabled: true,
      commandsEnabled: false,           // !next/!prev/!pause/!resume (broadcaster/mod/VIP)
      nowPlayingEnabled: false,         // auto-announce track changes
      nowPlayingTemplate: 'Now playing: {title} by {artist} {artistUrl}',
      songCommandCooldownSec: 30
    }
  };
}

function sanitizeTwitchConfig(input) {
  const d = defaultTwitchConfig();
  const src = (input && typeof input === 'object') ? input : {};
  const c = (src.chat && typeof src.chat === 'object') ? src.chat : {};
  return {
    clientId: typeof src.clientId === 'string' ? src.clientId.trim() : d.clientId,
    clientSecret: typeof src.clientSecret === 'string' ? src.clientSecret.trim() : d.clientSecret,
    redirectUrl: (typeof src.redirectUrl === 'string' && /^https?:\/\//i.test(src.redirectUrl))
      ? src.redirectUrl.trim() : d.redirectUrl,
    broadcasterUserId: typeof src.broadcasterUserId === 'string' ? src.broadcasterUserId.trim() : d.broadcasterUserId,
    scopes: d.scopes,
    autoConnect: src.autoConnect !== false,
    chat: {
      songCommandEnabled: c.songCommandEnabled !== false,
      commandsEnabled: !!c.commandsEnabled,
      nowPlayingEnabled: !!c.nowPlayingEnabled,
      nowPlayingTemplate: (typeof c.nowPlayingTemplate === 'string' && c.nowPlayingTemplate.trim())
        ? c.nowPlayingTemplate.trim().slice(0, 300) : d.chat.nowPlayingTemplate,
      songCommandCooldownSec: Number.isFinite(c.songCommandCooldownSec)
        ? Math.max(0, Math.min(3600, Math.floor(c.songCommandCooldownSec)))
        : d.chat.songCommandCooldownSec
    }
  };
}

const readTwitchConfig = async () => sanitizeTwitchConfig(await readJsonFile(TWITCH_CONFIG_FILE, null));
const readTwitchAuth = async () => {
  const a = await readJsonFile(TWITCH_AUTH_FILE, {});
  return {
    accessToken: a.accessToken || '', refreshToken: a.refreshToken || '',
    expiresAt: a.expiresAt || 0, scope: Array.isArray(a.scope) ? a.scope : [],
    user: a.user || null, connectedAt: a.connectedAt || null
  };
};

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.message || data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function refreshTwitchToken() {
  const cfg = await readTwitchConfig();
  const auth = await readTwitchAuth();
  if (!auth.refreshToken) throw new Error('No refresh token — log in with Twitch again');
  const data = await fetchJson(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      grant_type: 'refresh_token', refresh_token: auth.refreshToken
    }).toString()
  });
  const next = {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    scope: Array.isArray(data.scope) ? data.scope : auth.scope,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : auth.expiresAt
  };
  await writeJsonFile(TWITCH_AUTH_FILE, next);
  return next;
}

async function getUsableTwitchAuth() {
  let auth = await readTwitchAuth();
  if (!auth.accessToken) throw new Error('No Twitch token saved — log in first');
  if (auth.expiresAt && auth.expiresAt - Date.now() < 2 * 60 * 1000) auth = await refreshTwitchToken();
  return auth;
}

async function twitchApi(pathname, { method = 'GET', body } = {}) {
  const cfg = await readTwitchConfig();
  const auth = await getUsableTwitchAuth();
  return fetchJson(`${TWITCH_HELIX_BASE}${pathname}`, {
    method,
    headers: {
      'Client-Id': cfg.clientId,
      Authorization: `Bearer ${auth.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function sendChat(message) {
  const cfg = await readTwitchConfig();
  const auth = await readTwitchAuth();
  const broadcaster = cfg.broadcasterUserId || auth.user?.id;
  if (!broadcaster) throw new Error('Missing broadcaster — log in with Twitch');
  await twitchApi('/chat/messages', {
    method: 'POST',
    body: { broadcaster_id: broadcaster, sender_id: auth.user?.id || broadcaster, message: String(message).slice(0, 450) }
  });
}


async function enrichNowPlaying(s) {
  if (!s || !s.file) return s;
  // yt-dlp's --embed-metadata doesn't map the source URL into any tag
  // trackInfo()/extractOfficialArtistUrl() would find, so for a YouTube
  // track the reliable link is the one already recorded on the track
  // itself, not something worth reading the file for.
  if (s.storage === 'youtube' && s.sourceUrl && !s.artistUrl) return { ...s, artistUrl: s.sourceUrl };
  if (s.artistUrl || s.comment) return s;
  try {
    const ref = trackRef(s);
    if (!ref) return s;
    const info = await trackInfo(ref.full, s.originalFile || ref.rel);
    return {
      ...s,
      title: s.title || info.title,
      artist: s.artist || info.artist,
      album: s.album || info.album,
      year: s.year || info.year,
      artistUrl: info.artistUrl || '',
      comment: info.comment || ''
    };
  } catch {
    return s;
  }
}

function buildNowPlayingMessage(cfg, s) {
  if (!s || !s.title) return '';
  return cfg.chat.nowPlayingTemplate
    .replace('{title}', s.title)
    .replace('{artist}', s.artist || 'Unknown')
    .replace('{artistUrl}', s.artistUrl || extractFirstUrl(s.comment || '') || s.comment || '')
    .replace('{album}', s.album || '')
    .replace('{year}', s.year || '')
    .replace('{file}', s.file || '')
    .replace('{idx}', typeof s.idx === 'number' && s.idx >= 0 ? String(s.idx + 1) : '?')
    .replace('{count}', s.count ? String(s.count) : '?')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function broadcastCmd(cmd, detail = {}) {
  const data = JSON.stringify({ type: 'cmd', cmd, ...detail });
  for (const c of wssRef.clients) {
    if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch { /* ignore */ } }
  }
}

async function handleChatCommand(event) {
  const cfg = await readTwitchConfig();
  const text = String(event?.message?.text || '').trim().toLowerCase();
  const cmd = text.split(/\s+/).filter(Boolean)[0] || '';

  if (cmd === '!song') {
    if (!cfg.chat.songCommandEnabled) return { action: 'song', skipped: 'disabled' };
    const cooldownMs = cfg.chat.songCommandCooldownSec * 1000;
    if (Date.now() - lastSongCommandAt < cooldownMs) return { action: 'song', skipped: 'cooldown' };
    if (songCommandInFlight) return { action: 'song', skipped: 'in-flight' };
    songCommandInFlight = true;
    try {
      const s = await enrichNowPlaying(lastState);
      const message = (s && s.title && s.status !== 'stopped')
        ? buildNowPlayingMessage(cfg, s)
        : 'Nothing on the deck right now — the jukebox is quiet.';
      let sent = false, error = null;
      try { await sendChat(message); sent = true; lastSongCommandAt = Date.now(); }
      catch (err) { error = err.message; }
      return { action: 'song', message, sent, ...(error ? { error } : {}) };
    } finally {
      songCommandInFlight = false;
    }
  }

  const TRANSPORT = { '!next': 'next', '!prev': 'prev', '!pause': 'pause', '!resume': 'resume', '!play': 'resume' };
  if (TRANSPORT[cmd]) {
    if (!cfg.chat.commandsEnabled) return { action: TRANSPORT[cmd], skipped: 'disabled' };
    const isBroadcaster = event.chatter_user_id && event.chatter_user_id === event.broadcaster_user_id;
    const privileged = Array.isArray(event.badges)
      && event.badges.some((b) => b.set_id === 'moderator' || b.set_id === 'vip' || b.set_id === 'broadcaster');
    if (!isBroadcaster && !privileged) return { action: TRANSPORT[cmd], skipped: 'not privileged' };
    broadcastCmd(TRANSPORT[cmd]);
    return { action: TRANSPORT[cmd], sent: true };
  }
  return null;
}

async function maybeAnnounceTrack(s) {
  try {
    const identity = s?.trackKey || `${s?.storage || 'library'}:${s?.playlist || ''}:${s?.file || ''}`;
    if (!s || s.status !== 'playing' || !s.file || identity === lastAnnouncedFile) return;
    const cfg = await readTwitchConfig();
    if (!cfg.chat.nowPlayingEnabled || !twitchState.connected) { lastAnnouncedFile = identity; return; }
    if (Date.now() - lastAnnouncedAt < 10000) return;
    lastAnnouncedFile = identity;
    lastAnnouncedAt = Date.now();
    await sendChat(buildNowPlayingMessage(cfg, await enrichNowPlaying(s)));
  } catch { /* chat hiccup — never break playback */ }
}

// ── EventSub WebSocket ──
function clearTwitchReconnect() {
  if (twitchState.reconnectTimer) { clearTimeout(twitchState.reconnectTimer); twitchState.reconnectTimer = null; }
}
function scheduleTwitchReconnect(ms = 3000) {
  clearTwitchReconnect();
  twitchState.reconnectTimer = setTimeout(() => {
    twitchState.reconnectTimer = null;
    connectTwitchEventSub().catch((err) => {
      twitchState.status = 'error';
      twitchState.lastError = err.message;
    });
  }, ms);
}
function disconnectTwitchEventSub(reason = 'manual') {
  clearTwitchReconnect();
  twitchState.connected = false;
  twitchState.connecting = false;
  twitchState.sessionId = null;
  twitchState.status = reason === 'manual' ? 'idle' : 'disconnected';
  if (twitchState.ws) { try { twitchState.ws.close(); } catch { /* ignore */ } twitchState.ws = null; }
}

async function connectTwitchEventSub() {
  if (twitchState.connecting || twitchState.connected) return;
  await getUsableTwitchAuth(); // fail fast with a clear error
  twitchState.connecting = true;
  twitchState.status = 'connecting';
  twitchState.lastError = null;

  const ws = new WebSocket(twitchState.reconnectUrl || TWITCH_EVENTSUB_WS_URL);
  twitchState.ws = ws;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const type = msg.metadata?.message_type;
    if (type === 'session_welcome') {
      twitchState.connecting = false;
      twitchState.connected = true;
      twitchState.status = 'connected';
      twitchState.sessionId = msg.payload?.session?.id || null;
      twitchState.reconnectUrl = null;
      if (twitchState.sessionId) {
        try {
          const cfg = await readTwitchConfig();
          const auth = await readTwitchAuth();
          const broadcaster = cfg.broadcasterUserId || auth.user?.id;
          if (!broadcaster) throw new Error('Missing broadcasterUserId');
          await twitchApi('/eventsub/subscriptions', {
            method: 'POST',
            body: {
              type: 'channel.chat.message', version: '1',
              condition: { broadcaster_user_id: broadcaster, user_id: broadcaster },
              transport: { method: 'websocket', session_id: twitchState.sessionId }
            }
          });
          console.log('  [twitch] chat connected — !song is live');
        } catch (err) {
          twitchState.status = 'error';
          twitchState.lastError = err.message;
        }
      }
      return;
    }
    if (type === 'session_keepalive') return;
    if (type === 'session_reconnect') {
      twitchState.reconnectUrl = msg.payload?.session?.reconnect_url || null;
      twitchState.connected = false;
      twitchState.connecting = false;
      twitchState.status = 'reconnecting';
      try { ws.close(); } catch { /* ignore */ }
      scheduleTwitchReconnect(250);
      return;
    }
    if (type === 'revocation') {
      twitchState.status = 'revoked';
      twitchState.lastError = 'subscription revoked — reauthorize';
      return;
    }
    if (type === 'notification' && msg.payload?.subscription?.type === 'channel.chat.message') {
      handleChatCommand(msg.payload.event || {}).catch(() => {});
    }
  });

  ws.on('close', () => {
    const retry = twitchState.status !== 'idle' && twitchState.status !== 'revoked';
    twitchState.ws = null;
    twitchState.connected = false;
    twitchState.connecting = false;
    twitchState.sessionId = null;
    if (retry) { twitchState.status = 'disconnected'; scheduleTwitchReconnect(3000); }
  });
  ws.on('error', (err) => {
    twitchState.lastError = err.message || String(err);
    twitchState.status = 'error';
  });
}


// ── auxiliary OAuth callback listener ──
// The redirect URL must EXACTLY match one registered on the Twitch
// app. If yours points at a different localhost port (e.g. the old
// player's http://localhost:4000/auth), we listen there too, so the
// existing app registration keeps working without changes.
let authAuxServer = null;
let authAuxPort = 0;

function callbackTarget(cfg) {
  try {
    const u = new URL(cfg.redirectUrl);
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return { local, port };
  } catch {
    return { local: false, port: 0 };
  }
}

async function ensureAuthCallbackListener() {
  try {
    const cfg = await readTwitchConfig();
    const { local, port } = callbackTarget(cfg);
    const want = local && port !== Number(PORT) ? port : 0;
    if (want === authAuxPort) return true;
    if (authAuxServer) {
      try { authAuxServer.close(); } catch { /* ignore */ }
      authAuxServer = null;
      authAuxPort = 0;
    }
    if (!want) return true;
    return await new Promise((resolve) => {
      const aux = createServer(app); // same express app, second port
      aux.once('error', (err) => {
        console.log(`  [twitch] callback port ${want} unavailable (${err.code || err.message}) — is the old player still running there?`);
        if (authAuxServer === aux) { authAuxServer = null; authAuxPort = 0; }
        resolve(false);
      });
      aux.listen(want, () => {
        authAuxPort = want;
        console.log(`  [twitch] OAuth callback also listening on http://localhost:${want}/auth`);
        resolve(true);
      });
      authAuxServer = aux;
    });
  } catch {
    return false;
  }
}

// Is whatever answers on the callback port actually THIS NEONAMP?
async function probeCallbackPort(port) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 900);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/twitch/ping`, { signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    return data && data.neonamp === true ? 'neonamp' : 'foreign';
  } catch {
    return 'nothing';
  } finally {
    clearTimeout(timer);
  }
}

// ── HTTP endpoints ──
app.get('/api/twitch/status', async (req, res) => {
  const cfg = await readTwitchConfig();
  const auth = await readTwitchAuth();
  res.json({
    config: {
      clientId: cfg.clientId,
      hasClientSecret: !!cfg.clientSecret,
      redirectUrl: cfg.redirectUrl,
      broadcasterUserId: cfg.broadcasterUserId,
      autoConnect: cfg.autoConnect,
      chat: cfg.chat
    },
    auth: { loggedIn: !!auth.accessToken, user: auth.user, connectedAt: auth.connectedAt },
    eventsub: { status: twitchState.status, connected: twitchState.connected, lastError: twitchState.lastError }
  });
});

app.post('/api/twitch/config', async (req, res) => {
  try {
    const current = await readTwitchConfig();
    const src = req.body || {};
    const merged = sanitizeTwitchConfig({
      ...current,
      ...src,
      // empty secret in the form means "keep the saved one"
      clientSecret: typeof src.clientSecret === 'string' && src.clientSecret.trim()
        ? src.clientSecret : current.clientSecret,
      chat: { ...current.chat, ...(src.chat || {}) }
    });
    await writeJsonFile(TWITCH_CONFIG_FILE, merged);
    ensureAuthCallbackListener();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/twitch/ping', (req, res) => res.json({ neonamp: true }));

const ERR_PAGE = (title, body) => `<!doctype html><html><body style="background:#0d0820;color:#eae6ff;font-family:Consolas,monospace;padding:28px;line-height:1.6"><h2 style="color:#ff4f9a;letter-spacing:2px">${title}</h2>${body}</body></html>`;

app.get('/api/twitch/login', async (req, res) => {
  const cfg = await readTwitchConfig();
  if (!cfg.clientId) return res.status(400).send(ERR_PAGE('MISSING CLIENT ID', '<p>Set your Twitch Client ID first — TW button on the deck or <a style="color:#21e6c1" href="/twitch">/twitch</a>.</p>'));

  // Pre-flight: make sure THIS server will receive the callback.
  // Twitch skips the consent screen for already-authorized apps and
  // bounces back instantly — if another app (the old player?) owns
  // the callback port, IT gets the code and the login silently fails.
  const { local, port } = callbackTarget(cfg);
  if (local && port !== Number(PORT)) {
    await ensureAuthCallbackListener();
    const owner = await probeCallbackPort(port);
    if (owner !== 'neonamp') {
      const reason = owner === 'foreign'
        ? `Another application is answering on port ${port} — almost certainly your old player still running. Twitch's redirect would land there instead of NEONAMP.`
        : `Nothing is listening on port ${port}, and NEONAMP couldn't bind it. Twitch's redirect would dead-end.`;
      return res.status(409).send(ERR_PAGE('CALLBACK PORT CONFLICT', `
        <p>${reason}</p>
        <p>Fix one of these ways, then log in again:</p>
        <p>1. Close the old player, or<br>
           2. Set the redirect URL to <b style="color:#ffb24d">http://localhost:${PORT}/auth</b> on the
           <a style="color:#21e6c1" href="/twitch">/twitch console</a> and add that same URL to your app at
           <b>dev.twitch.tv/console/apps</b>.</p>`));
    }
  }

  const state = randomUUID();
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  for (const [k, exp] of oauthStates) if (exp < Date.now()) oauthStates.delete(k);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUrl,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state
  });
  res.redirect(`${TWITCH_AUTHORIZE_URL}?${params}`);
});

app.get('/auth', async (req, res) => {
  const { code, state, error, error_description: desc } = req.query || {};
  if (error) return res.status(400).send(`<pre>Twitch auth error: ${error}\n${desc || ''}</pre>`);
  if (!code || typeof code !== 'string') return res.status(400).send('<pre>Missing OAuth code</pre>');
  if (!state || !oauthStates.has(state)) {
    return res.status(400).send(ERR_PAGE('OAUTH STATE NOT RECOGNIZED', `
      <p>This login attempt wasn't started by this NEONAMP instance.</p>
      <p>Usual causes: the old player (or a second NEONAMP) is also running and answered the callback,
      or the server restarted mid-login. Close other apps on this port and start the login again
      from the <a style="color:#21e6c1" href="http://localhost:${PORT}/twitch">/twitch console</a>.</p>`));
  }
  oauthStates.delete(state);
  try {
    const cfg = await readTwitchConfig();
    const token = await fetchJson(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUrl
      }).toString()
    });
    const v = await fetchJson(TWITCH_VALIDATE_URL, { headers: { Authorization: `OAuth ${token.access_token}` } });
    await writeJsonFile(TWITCH_AUTH_FILE, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : 0,
      scope: Array.isArray(token.scope) ? token.scope : (v.scopes || []),
      user: { id: v.user_id || '', login: v.login || '' },
      connectedAt: Date.now()
    });
    if (!cfg.broadcasterUserId && v.user_id) {
      cfg.broadcasterUserId = v.user_id;
      await writeJsonFile(TWITCH_CONFIG_FILE, cfg);
    }
    if (cfg.autoConnect) connectTwitchEventSub().catch(() => {});
    res.redirect(`http://localhost:${PORT}/?twitch=connected`);
  } catch (err) {
    res.status(500).send(`<pre>Twitch callback failed:\n${err.message}</pre>`);
  }
});

app.post('/api/twitch/connect', async (req, res) => {
  try {
    await connectTwitchEventSub();
    res.json({ ok: true });
  } catch (err) {
    twitchState.status = 'error';
    twitchState.lastError = err.message;
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/twitch/disconnect', (req, res) => {
  disconnectTwitchEventSub('manual');
  res.json({ ok: true });
});

// Local testing without going live: simulate a chat line.
// e.g. curl -X POST /api/twitch/simulate -d '{"text":"!song"}'
app.post('/api/twitch/simulate', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const badges = Array.isArray(req.body?.badges) ? req.body.badges.map((b) => ({ set_id: String(b) })) : [];
  const result = await handleChatCommand({
    message: { text },
    badges,
    chatter_user_id: req.body?.asBroadcaster ? 'b1' : 'u1',
    broadcaster_user_id: 'b1'
  }).catch((err) => ({ error: err.message }));
  res.json({ ok: true, result });
});


// ── Twitch settings page + supporting endpoints ──
app.get('/twitch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'twitch.html'));
});

// Live now-playing snapshot (enriched from tags) — handy for other tools too
app.get('/api/nowplaying', async (req, res) => {
  res.json(await enrichNowPlaying(lastState) || {});
});

// Send an arbitrary line to chat (parity with the old player)
app.post('/api/twitch/chat/send', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ ok: false, error: 'Empty message' });
    await sendChat(message);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});


// ------------------------------------------------------------
// OBS broadcast overlay — served at /obs, fed over /ws.
// The main player broadcasts {type:'state'} and {type:'fft'}
// messages; the server relays them to every other client and
// replays the last known state to new connections.
// ------------------------------------------------------------
app.get('/obs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'obs.html'));
});

app.get('/playlist', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playlist.html'));
});

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   N E O N A M P   //  insert3coins edition    ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log(`   ▸ player     http://localhost:${PORT}`);
  console.log(`   ▸ obs overlay  http://localhost:${PORT}/obs   (browser source)`);
  console.log(`   ▸ playlists  http://localhost:${PORT}/playlist`);
  console.log(`   ▸ twitch     http://localhost:${PORT}/twitch`);
  console.log(`   ▸ playlist data   ${PLAYLIST_DIR}`);
  console.log(`   ▸ playlist audio  ${PLAYLIST_MEDIA_DIR}`);
  console.log(`   ▸ settings   ${SETTINGS_FILE}`);
  console.log('');
});


// When the OBS jukebox is the player, the deck isn't around to save
// position — so the server folds the jukebox's position into
// settings.json itself (session-queue mode only; a named ?playlist=
// doesn't map onto the session queue). Ctrl+C safe: last write is at
// most ~5s old.
// The SERVER is the position recorder. Players (deck and jukebox)
// stream their state over /ws at least every few seconds anyway, so
// the server folds {idx, t, state} into settings.json from that
// stream — throttled, immediate on track/status change. This makes
// persistence immune to every browser timing problem (debounce
// windows, tab teardown, beacons): the file is never more than
// ~2.5s stale, even on a hard Ctrl+C.
let posSavedAt = 0;
let posKey = '';
let lastDeckStateAt = 0;
const DECK_AUTHORITY_MS = 15000;

async function writePositionFromState(s, throttleMs) {
  const key = `${s.src}:${s.idx}:${s.status}`;
  const now = Date.now();
  if (key === posKey && now - posSavedAt < throttleMs) return;
  posKey = key;
  posSavedAt = now;
  try {
    const cur = await readJsonFile(SETTINGS_FILE, {});
    cur.position = {
      idx: typeof s.idx === 'number' ? s.idx : -1,
      t: Math.floor((s.t || 0) * 10) / 10,
      state: s.status === 'playing' ? 'play' : s.status === 'paused' ? 'pause' : 'stop'
    };
    await writeJsonFile(SETTINGS_FILE, cur);
  } catch { /* next tick */ }
}

async function persistJukePosition(s) {
  if (!s) return;
  if (s.src === 'deck') {
    lastDeckStateAt = Date.now();
    await writePositionFromState(s, 2500);
    return;
  }
  if (s.src !== 'juke-q') return;
  // Jukebox writes only when no deck has reported recently.
  if (Date.now() - lastDeckStateAt < DECK_AUTHORITY_MS) return;
  await writePositionFromState(s, 5000);
}

// Graceful Ctrl+C: flush the loudness cache before exit
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    try {
      if (loudDirty && loudCache) await writeJsonFile(LOUDNESS_CACHE_FILE, loudCache);
      if (playCountsDirty) await writeJsonFile(PLAY_COUNTS_FILE, Object.fromEntries(playCounts));
    } catch { /* best effort */ }
    process.exit(0);
  });
}

const wss = new WebSocketServer({ server, path: '/ws' });
const wssRef = wss;
let lastState = null;
let lastTheme = null;
let lastPrefs = null;

wss.on('connection', (sock) => {
  sock.isAlive = true;
  sock.on('pong', () => { sock.isAlive = true; });
  if (lastState) {
    try { sock.send(JSON.stringify(lastState)); } catch { /* ignore */ }
  }
  if (lastTheme) {
    try { sock.send(JSON.stringify(lastTheme)); } catch { /* ignore */ }
  }
  if (lastPrefs) {
    try { sock.send(JSON.stringify(lastPrefs)); } catch { /* ignore */ }
  }
  sock.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'state') { lastState = msg; maybeAnnounceTrack(msg); persistJukePosition(msg); maybeCountPlay(msg); }
    else if (msg.type === 'theme') { lastTheme = msg; }
    else if (msg.type === 'prefs') { lastPrefs = msg; }
    else if (msg.type !== 'fft') return;
    const data = JSON.stringify(msg);
    for (const c of wss.clients) {
      if (c !== sock && c.readyState === WebSocket.OPEN) c.send(data);
    }
  });
});

// Reconnect Twitch chat on boot when a login is already saved
(async () => {
  const cfg = await readTwitchConfig();
  const auth = await readTwitchAuth();
  ensureAuthCallbackListener();
  if (cfg.autoConnect && auth.accessToken) {
    connectTwitchEventSub().catch((err) => {
      twitchState.status = 'error';
      twitchState.lastError = err.message;
    });
  }
})();

// Sweep dead connections (OBS sources can sit open for days)
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.isAlive) { c.terminate(); continue; }
    c.isAlive = false;
    try { c.ping(); } catch { /* ignore */ }
  }
}, 30000);

// Playlists built from a YouTube playlist URL remember it (data.youtubeSources)
// so a running series — new episodes added to the same source over time —
// gets picked up without the user having to notice and re-paste the URL.
const YT_RESYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function resyncAllYoutubePlaylists() {
  let files = [];
  try { files = (await fs.readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')); } catch { return; }
  for (const file of files) {
    const name = safeName(file.replace(/\.json$/i, ''));
    if (!name) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(PLAYLIST_DIR, file), 'utf8'));
      if (!Array.isArray(data.youtubeSources) || !data.youtubeSources.length) continue;
    } catch { continue; }
    try {
      const { added } = await resyncYoutubePlaylist(name);
      if (added.length) {
        console.log(`  [youtube] resync found ${added.length} new video(s) for playlist "${name}"`);
        broadcastCmd('youtube-resync', { playlist: name, added: added.length });
      }
    } catch (err) {
      console.warn(`  [youtube] resync failed for playlist "${name}": ${err.message}`);
    }
  }
}

setTimeout(() => { resyncAllYoutubePlaylists().catch(() => {}); }, 2 * 60 * 1000);
setInterval(() => { resyncAllYoutubePlaylists().catch(() => {}); }, YT_RESYNC_INTERVAL_MS);
