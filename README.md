# NEONAMP — insert3coins edition

A self-hosted, Winamp-style web music player with a cyberpunk neon deck.
No database — playlists are plain JSON in `playlists/`, local tracks
reference their original file paths, and player state lives in
`settings.json`. Full ID3 support (title/artist/album/art) via
music-metadata, falling back to `Artist - Title.ext` parsing.

## Quick start

```bash
npm install
npm start
```

- **http://localhost:3090** — player deck
- **http://localhost:3090/playlist** — playlist creation and management
- **http://localhost:3090/obs** — OBS broadcast overlay / jukebox

Create/select a playlist in `/playlist`, then **ADD FILE PATHS** (native
picker on Windows, paste-path fallback otherwise). Audio stays where it
is — NEONAMP stores references, never copies. Playback streams from
disk with HTTP Range support (instant seeking, nothing loaded whole
into memory). Formats: mp3, ogg/oga, wav, flac, m4a, aac, opus, webm.

The playlist page is also a live control surface — transport, volume,
shuffle/repeat, theme, visualizer, EQ, and DSP rack all apply
immediately to an open deck or OBS jukebox. Right-click playlists,
tracks, or empty playlist space for context actions everywhere.

## Desktop app (`desktop/`)

`neonamp-desktop.exe` — a ~520 KB native frameless window (WebView2,
no Electron/Node inside) hosting the deck.

```bash
npm run desktop:build     # cargo build --release
npm run desktop           # build and launch
```

Output: `desktop/target/release/neonamp-desktop.exe` (portable). Start
the server first or don't — it waits on a splash and reconnects either
way. The titlebar's dots are real minimize/maximize/close; edges/corners
resize; dragging the backdrop moves the window. Links to the manager,
OBS overlay, or Twitch console open in your default browser instead of
hijacking the shell. Point it elsewhere with an arg or `NEONAMP_URL`:
`neonamp-desktop.exe http://192.168.1.20:3090/`. Needs
[Rust](https://rustup.rs) + MSVC toolchain to build.

## Configuration

| Env var         | Default        | Purpose                         |
| --------------- | -------------- | -------------------------------- |
| `PORT`          | `3090`         | HTTP port                       |
| `NEONAMP_MAX_UPLOAD_MB` | `2048` | Legacy upload-API limit (MB)    |

## Settings (`settings.json`)

Auto-saves the queue, track + position, volume, EQ, DSP, normalization,
crossfade, visualizer, theme, and panel state. Position is recorded
server-side every ~2.5s (deck) / ~5s (OBS jukebox), so a hard crash
loses at most a couple seconds. Reopening resumes automatically if it
was playing (or waits for a keypress if autoplay is blocked).

## Themes

**THM** cycles fifteen palettes: NEON (default), C64, AMBER TERM,
VAPORWAVE, GREEN PHOS, CRIMSON, ICE, SUNSET, TOXIC, DEEP SPACE, MIAMI,
GOLD RUSH, BLUE PHOSPHOR, STEEL, TRON GRID. Persists, and the OBS
overlay follows automatically (or pin one with `?theme=gold rush`).

## Loudness normalization

**NORM** (on by default) evens out volume across tracks — ffmpeg's EBU
R128 meter analyzes each file once (cached, pushed live over `/ws`),
targeting −16 LUFS (`NEONAMP_LOUDNESS_TARGET` to change). A post-EQ
leveler trims up to 6dB when a boosted curve makes one track hotter
than another. Requires ffmpeg on PATH. Hover NORM for the current
track's correction.

## Crossfade / gapless playback

**XFD** cycles off → 2s → 4s → 6s → 8s → 10s → off. Runs two `<audio>`
elements sharing the EQ/DSP chain, cross-fading via Web Audio gain
automation near a track's end (or the moment you hit NEXT). Each side
gets its own normalization gain. Radio never crossfades. Persists, and
is remote-controllable from `/playlist`.

## Waveform seek bar

The strip above the seek slider is a real ffmpeg amplitude analysis
(~400 peak buckets, persisted per source track in `waveform-cache.json`
and pushed live over `/ws`), not decoration. The next few queue tracks
are warmed in the background; the same path or imported track reuses its
cache across playlists, while playlist-owned media stays playlist-scoped.
Click/drag it to seek. Radio has none; a pending analysis just leaves it
blank until the background job completes.

## Sleep timer

**SLP** — 15/30/45/60/90/120 min, END OF TRACK, END OF QUEUE, or OFF.
Fades out over 4s and pauses (not stops). END OF QUEUE ignores
repeat-all and stops at the natural end of the current pass; in
shuffle it behaves like END OF TRACK. In-memory only — reload cancels it.

## M3U export

**EXPORT M3U** (manager or deck) downloads a UTF-8 `.m3u8` with
`#EXTINF` lines.

## SHOUTcast / Icecast radio

**RADIO STREAM** on `/playlist` adds an HTTP(S) stream to the selected
playlist. NEONAMP proxies it, strips ICY metadata, and shows live
`StreamTitle`/bitrate/connection state with bounded reconnect backoff.

## Audio import (YouTube, SoundCloud, Mixcloud, Bandcamp)

**＋ IMPORT AUDIO** accepts a track/video or a whole playlist/set/album
URL. YouTube and SoundCloud are verified end-to-end; Mixcloud/Bandcamp
ride the same `yt-dlp` path but are less tested. Audio-only —
extracted into `youtube-cache/`, never touches video. The URL resolves
instantly (dialog closes right away); downloads queue in the
background one at a time, with live status two ways: an amber status
strip above the toolbar and each track's TYPE column (QUEUED /
DOWNLOADING / CONVERTING 67% / FAILED). Conversion always shows a real
percentage; the download step shows one too once yt-dlp knows the
file's real size, falling back to a live byte count (e.g. `1.2MB`)
when it doesn't — some formats never report a total up front, and
resolving the real download URL can itself take a few seconds with
nothing to show yet. Failed tracks stay FAILED — right-click for
**Retry download**, or empty space for
**Retry all failed**. A playlist/set/album source auto-checks for new
items every 6 hours (**Check for new videos** to trigger on demand).
When an approved request is appended to the live player, its duration
slot shows the same QUEUED / DOWNLOADING / CONVERTING / FAILED state
until the audio is ready.
Deleting a playlist reclaims its cache audio unless another playlist
shares it. Requires `yt-dlp` on PATH.

## Library-wide search & smart playlists

The ⌕ button (or `Ctrl+K`) searches every playlist's title/artist/album
at once — double-click a result to load and play it. Two more tabs:

- **RECENTLY ADDED** — every track, newest first (tracks added before
  this feature shipped have no timestamp).
- **MOST PLAYED** — sorted by play count (counted past half a track's
  duration, 10–30s cap; radio excluded).

## Playlist utilities

**UTIL** menu: randomize/reverse, remove duplicates or missing
sources, sort, crop to selection, build a queue from selected albums.
**SAVE** to persist the result.

## EQ presets

Classic Winamp/XMMS bank: Flat, Classical, Club, Dance, Full Bass,
Full Bass+Treble, Full Treble, Laptop/Phones, Large Hall, Live, Party,
Pop, Reggae, Rock, Ska, Soft, Soft Rock, Techno, plus NEON (I3C).
Hand-tuning flips it to CUSTOM.

## DSP rack

**DSP** in the Equalizer header builds a reorderable chain: compressor,
limiter, stereo width, mono, bass boost, convolution reverb. Presets:
CLEAN, BROADCAST, BASS CLUB, WIDE SPACE, MONO RADIO. Persists, and the
OBS jukebox loads the same chain.

## Metadata sidecars

**EDIT METADATA** on a local track writes to `<file>.neonamp.json`
(title/artist/album/genre/year/art up to 2MB) — embedded tags and
audio bytes stay untouched. Resetting removes the sidecar. Saves and
resets update a currently playing track, its artwork, the OBS feed, and
the remote now-playing display immediately without restarting playback.

Player preferences are persisted in `settings.json`: volume/balance,
shuffle/repeat, EQ, DSP effects, normalization, crossfade, theme,
visualizer, elapsed/remaining time mode, and open panels. OBS hydrates the
same persisted theme, visualizer, audio processing, and playback settings
after a server or application restart unless its URL explicitly pins an
override such as `?theme=`, `?vis=`, `?vol=`, `?shuffle`, or `?eq`.

## Visualizers

Click the canvas to cycle, or **VIS** to pick directly: BARS, SCOPE,
VU, RADIAL, WATERFALL, DOTS, PARTICLES, LISSAJOUS X-Y (true stereo
scope), WARP TUNNEL, SPIRAL SPECTRUM, SONAR PULSE, OFF. The OBS
overlay supports the same set via `?vis=` except LISSAJOUS (no true
stereo data over `/ws` — falls back to BARS).

## OBS broadcast overlay

**http://localhost:3090/obs** — a ~320px glass panel (album art,
title/artist, elapsed time, full-width visualizer). Add as a Browser
Source, enable *Control audio via OBS*.

**By default it's the jukebox**: auto-plays your saved queue and
outputs audio itself, so the main player doesn't need to stay open.
`?playlist=Name`, `?shuffle=1`, `?vol=40` (OBS mixer stacks on top).

**Mirror mode** (`?mirror=1`): stops playing and just reflects the
main deck's state/spectrum over WebSocket instead — capture audio via
your normal desktop source.

| Param        | Effect                                        |
| ------------ | --------------------------------------------- |
| `?playlist=Name` | Jukebox with a saved playlist             |
| `?shuffle=1` / `?vol=40` | Jukebox shuffle / volume          |
| `?mirror=1`  | Mirror the main deck instead of playing       |
| `?vis=...`   | Visualizer style (see Visualizers)            |
| `?demo=1` / `?keep=1` / `?novis=1` | Demo data / never auto-hide / hide visualizer |
| `?align=` / `?valign=` | Anchor (default right/bottom)         |
| `?w=380`     | Panel width (default 320)                     |
| `?eq=1`      | Pin the deck's EQ onto this overlay source    |

Jukebox follows the deck's NORM live. EQ is off by default on the
overlay (bare media path captures most reliably) — enable via **OBS**
on the deck's EQ panel or `?eq=1`. Use Desktop/Application Audio
capture whenever EQ/DSP/normalization gain is active.

## Twitch chat commands

Console at **http://localhost:3090/twitch** — config, chat toggles,
live now-playing preview, simulate/send/log test tools. One-time
setup: create an app at https://dev.twitch.tv/console/apps, redirect
`http://localhost:3090/auth` (Confidential), paste Client ID + Secret,
SAVE, **LOGIN WITH TWITCH**. Tokens live in `twitch-auth.json`,
refresh automatically.

| Command    | Who              | Effect                                |
| ---------- | ---------------- | -------------------------------------- |
| `!song`    | everyone         | Posts now-playing (30s cooldown)      |
| `!next` / `!prev` | broadcaster, mods, VIPs | Skip forward / back      |
| `!pause` / `!resume` | broadcaster, mods, VIPs | Pause / resume       |
| `!request <link>` | subs, mods, VIPs, broadcaster | Queue a video for review (off by default) |

`!request` resolves a single track/video link (no playlists) and adds
it to a review playlist (**Requests** by default, renameable) tagged
with the requester — nothing downloads or plays until you act on it.
Right-click a requested track: **Approve request…** (pick a target
playlist, starts the download, replies in chat) or **Reject request**
(just removes it). If the target is what's actively loaded on the
deck, an approved track joins the live queue immediately. Everyone but
mods/VIPs/broadcaster gets one request per cooldown (default 5 min);
capped at 40 pending at once.

Message template vars: `{title} {artist} {artistUrl} {album} {year}
{file} {idx} {count}`. Test without going live:
`curl -X POST localhost:3090/api/twitch/simulate -H "Content-Type: application/json" -d '{"text":"!song"}'`

## Playlists

- Open `/playlist` or press **EJECT**/**MANAGE**/`E`/`L` on the deck
- Create, select, delete, filter, sort, reorder, export from the
  management page
- Double-click a track to load + play it immediately
- **LOAD + PLAY** activates the selection in the running player
- Metadata/artwork editing is sidecar-based (see above)

Playlist JSON shape:

```json
{
  "version": 2,
  "name": "night-drive",
  "saved": "2026-07-21T00:00:00.000Z",
  "tracks": [
    { "storage": "path", "file": "D:\\Music\\Artist - Track.mp3", "sourceId": "…", "title": "Track", "artist": "Artist", "duration": 245 }
  ]
}
```

`file` is the original absolute path; `sourceId` is server-generated
for safe URLs. Moved/renamed source files show as missing until
re-linked.

## Controls

| Key            | Action                       |
| -------------- | ---------------------------- |
| `Z X C V B`    | Prev / Play / Pause / Stop / Next |
| `Space`        | Play / pause toggle          |
| `← →`          | Seek −5s / +5s               |
| `↑ ↓`          | Volume ±5                    |
| `S` / `R`      | Shuffle / cycle repeat (off → all → one) |
| `E` / `L`      | Open playlist manager        |
| `Delete`       | Remove selected queue track  |

Click the time readout to toggle remaining-time, double-click BAL to
re-center, drag rows to reorder.

## API (if you want to script it)

- `GET  /playlist` — playlist management UI
- `GET  /api/art?...` / `/api/loudness?...` / `/api/waveform?...` — art, normalization data, seek-bar peaks
- `GET/PUT/DELETE /api/metadata?...` — metadata sidecar
- `GET/POST /api/radio` · `PUT/DELETE /api/radio/:id` · `GET /api/radio/:id/stream|status`
- `GET  /api/playlists` — list saved playlists
- `GET  /api/search?q=...` / `/api/smart/recent?limit=...` / `/api/smart/played?limit=...`
- `GET  /api/playlists/:name` — fetch one
- `PUT  /api/playlists/:name` — save `{ "tracks": [...] }`
- `POST /api/files/pick` — native audio-file picker
- `POST /api/playlists/:name/paths` — append `{ "paths": [...] }`
- `POST /api/playlists/:name/youtube` — append `{ "url": "..." }`
- `POST /api/playlists/:name/youtube/retry` — `{ "videoId": "..." }`
- `POST /api/playlists/:name/youtube/resync` — check linked sources now
- `POST /api/playlists/:name/requests/:videoId/approve` — `{ "target": "..." }`
- `POST /api/playlists/:name/requests/:videoId/reject`
- `GET  /api/youtube/queue` — in-flight download jobs
- `GET  /path-media/:sourceId` / `/youtube-media/:file` — seekable playback
- `PUT  /api/playlists/:name/upload?name=file.mp3` — legacy direct upload
- `POST /api/playlists/:name/activate` — load into the deck/OBS jukebox
- `POST /api/playlists/:name/rename` · `DELETE /api/playlists/:name`
- `POST /api/control` — validated live transport/settings control
- `GET/PUT/POST /api/session` — full player settings
- Twitch: `GET /twitch|/api/twitch/status`, `POST /api/twitch/config|connect|disconnect|simulate|chat/send`, `GET /api/twitch/login`, `GET /auth`, `GET /api/nowplaying`
- `WS /ws` — now-playing relay: `{type:'state'|'fft'}`

---

INSERT3COINS // NEONAMP v1.0 // COIN-OPERATED AUDIO
