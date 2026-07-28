# NEONAMP — insert3coins edition

A self-hosted, Winamp-style web music player with a cyberpunk neon deck.
No database, no localStorage — playlists are the media system.
Playlist metadata is plain JSON in `playlists/`; local tracks reference
their original absolute file paths, and player state lives in
`settings.json`. Internet-radio bookmarks live in
`radio-stations.json`; custom tags and artwork use `.neonamp.json`
sidecars beside the audio and never rewrite the original file.
Existing playlist-owned files in `playlist-media/` remain supported
for backwards compatibility.

Full ID3 support via music-metadata: title, artist, album, and embedded
**album art** (ID3 APIC / FLAC pictures / MP4 covr) shown on the deck
and the OBS overlay. Files without tags fall back to
`Artist - Title.ext` filename parsing.

## Quick start

```bash
npm install
npm start
```

Then open:

- **http://localhost:3090** — player deck
- **http://localhost:3090/playlist** — playlist creation and management
- **http://localhost:3090/obs** — OBS broadcast overlay / jukebox

Create or select a playlist in `/playlist`, then use **ADD FILE PATHS**.
On Windows this opens a native server-side file picker; if a desktop
picker is unavailable, paste absolute paths into the fallback dialog.
The audio stays exactly where it is—NEONAMP stores references and never
copies those files into the project. Deleting a filepath playlist
removes only its JSON and never deletes the source audio.

The playlist page is also a live control surface: transport,
volume/balance, shuffle/repeat, normalization, theme, visualizer,
the complete 10-band EQ, OBS EQ routing, and the reorderable DSP rack
all apply immediately to an open deck or standalone OBS jukebox. Open
**EQUALIZER + DSP RACK** for the detailed sound controls (or use
`/playlist?sound=1` to open it expanded).

Right-click a saved playlist for open/play, rename, duplicate, export,
or delete actions. Right-click a track for playback, metadata/radio
editing, reordering, duplication, or removal. Right-click playlist
space to add audio or a radio stream without returning to the toolbar.

The main player also has contextual right-click controls. Use a queue
track for play/reorder/duplicate/remove actions, the visualizer or EQ
for direct mode and sound choices, the playlist panel for queue tools,
or the rest of the deck for transport and common toggles. The OBS
overlay remains display-only and has no context menus or interaction.

Playback **streams from disk** — audio is served with chunked file
reads and HTTP Range support (that's what makes seeking instant), so
tracks are never loaded whole into server memory.

Supported formats: mp3, ogg/oga, wav, flac, m4a, aac, opus, webm.

## Desktop app (`desktop/`)

`neonamp-desktop.exe` is a **~520 KB native window** for the deck — no
Electron, no bundled Chromium, no Node runtime inside it. It hosts the
page in the **WebView2 runtime that already ships with Windows 10/11**,
so every Web Audio path (EQ, DSP rack, normalization, visualizers)
behaves exactly as it does in Edge.

```bash
npm run desktop:build     # cargo build --release
npm run desktop           # build and launch
```

The output lands at `desktop/target/release/neonamp-desktop.exe` and is
free-standing — copy it anywhere, pin it to the taskbar, make a shortcut.

**Start the server first, or don't.** The window opens on a neon
*WAITING FOR SERVER* splash and polls the port until `npm start`
answers, then loads the deck on its own. If the server later goes away
it drops back to the splash and reconnects when it returns, so the two
can be started and restarted in any order.

The window is **frameless**: the deck's own titlebar is the drag
handle, and its three coloured dots are real minimize / maximize /
close buttons that retint with the active theme. Edges and corners
resize as usual, and the titlebar stays pinned when the deck scrolls.
Any bare backdrop around the deck drags the window too, so you don't
have to hit the bar exactly — but only once the pointer actually
moves, so a plain click on the background still reaches the page.
Text doesn't highlight while you shove the window around; selection is
off except in fields you can type into.

**The shell window only ever holds the deck.** MANAGE, and any other
link to the playlist manager, the OBS overlay, the Twitch console or
an outside site, opens in your **default browser** instead of taking
over the player. Those pages want room and a URL bar, and they drive
the deck over `/ws` rather than through the window that opened them —
so the manager in a browser tab is still a live control surface for
the deck in the shell, exactly as it is between two browser tabs.
Autoplay is permitted, so a saved *playing* state resumes on launch
without needing the PRESS ANY KEY nudge.

Point it somewhere other than the default `http://127.0.0.1:3090/`
with an argument or the `NEONAMP_URL` env var:

```bash
neonamp-desktop.exe http://192.168.1.20:3090/
```

Building it needs [Rust](https://rustup.rs) with the MSVC toolchain and
the Visual Studio C++ build tools. The icon is generated art — rerun
`python desktop/icon/make_icon.py` (needs Pillow) after editing it.

## Configuration

| Env var         | Default        | Purpose                         |
| --------------- | -------------- | ------------------------------- |
| `PORT`          | `3090`         | HTTP port                       |
| `NEONAMP_MAX_UPLOAD_MB` | `2048` | Legacy upload-API limit (MB)    |

## Settings (`settings.json`)

Everything about the player auto-saves (debounced) to `settings.json`
in the project root: the queue, **current track + position**, volume,
balance, EQ curve + preset name, EQ on/off, OBS routing, DSP modules,
normalization, visualizer mode, theme, shuffle/repeat, and panel
collapse state. Track position is recorded
**server-side** from the live `/ws` state stream every ~2.5s while a
player is running — no browser timing involved — so a hard stop of
any kind (Ctrl+C on the server, killed tab, crash, power cut) loses
at most a couple of seconds. The deck's own saves and the tab-close
beacon still run as backup writers.

**Reopening continues where you left off.** If the saved state was
*playing*, the deck resumes playback automatically at the saved
position; if the browser's autoplay policy blocks it, the very first
click or keypress resumes instead ("PRESS ANY KEY"). Paused stays
paused at position; stopped stays stopped — it only carries on if it
was actually playing. The OBS jukebox closes the same loop from its
side: while it plays the session queue, the server folds its position
back into `settings.json` every ~5s, so killing the server mid-stream
and relaunching picks up right where the jukebox was. Ctrl+C also
flushes the loudness cache before exit. Old installs migrate
`playlists/_session.json` automatically on first boot.

## Themes

**THM** on the deck cycles fifteen palettes: NEON (default), C64,
AMBER TERM, VAPORWAVE, GREEN PHOS, CRIMSON, ICE, SUNSET, TOXIC, DEEP
SPACE, MIAMI, GOLD RUSH, BLUE PHOSPHOR, STEEL, and TRON GRID.
Everything retints — panels, glows, sliders, and the canvas
visualizers. Your pick persists in `settings.json`, and the OBS
overlay follows it automatically (or pin one with `?theme=c64` etc.
on the overlay URL — multi-word names need the space, e.g.
`?theme=gold rush`).

## Loudness normalization

**NORM** on the deck (on by default) evens out volume across mixed
tracks. Each source file is analyzed once with ffmpeg's EBU R128 meter in
the background (results cached in `loudness-cache.json`, pushed live
over `/ws` when ready), and per-track gain toward a −16 LUFS target
(`NEONAMP_LOUDNESS_TARGET` to change) is applied through the deck's
preamp — clamped to −18…+9 dB. A slow, attenuation-only output leveler
after EQ/DSP removes up to 6 dB when a boosted frequency curve makes
one track materially hotter than another, followed by a −1.5 dBFS
safety limiter. The leveler never raises quiet passages or silence.
Requires ffmpeg on PATH; without it the feature quietly disables.
Hover NORM to see the current track's measured correction.

The 0–100 volume control uses a perceptual `value^1.6` curve and is a
true final master stage after normalization, EQ, DSP, leveling, balance,
and peak limiting. Changing volume therefore cannot alter compressor
thresholds or cause the leveler to compensate for the slider movement.
The plain media-element volume is used only as a no-Web-Audio fallback.

## M3U export

**EXPORT M3U** in the playlist manager or deck SAVE/LOAD dialogs
downloads a UTF-8 `.m3u8` with `#EXTINF` lines and each track's
original filename or stream URL.

## SHOUTcast / Icecast radio

Use **RADIO STREAM** on `/playlist` to add an HTTP(S) stream directly
to the selected playlist. Streams can be played, reordered, removed,
and exported to M3U like local tracks. NEONAMP proxies the stream
locally, requests and strips ICY
metadata, and displays the live `StreamTitle`, bitrate, connection
state, and reconnect countdown. Dropped connections retry with
bounded backoff in both the deck and OBS jukebox.

## Audio import (YouTube, SoundCloud, Mixcloud, Bandcamp)

Use **＋ IMPORT AUDIO** on `/playlist` to add a track/video or a whole
playlist/set/album URL to the selected playlist — YouTube, SoundCloud,
and Mixcloud URLs are accepted, plus any `*.bandcamp.com` link. Only
YouTube and SoundCloud have actually been exercised end-to-end;
Mixcloud and Bandcamp ride the same generic `yt-dlp` extraction path
and should work, but haven't been individually verified. NEONAMP
extracts audio only into `youtube-cache/` and never touches or
displays video; the result plays through the same deck, EQ, DSP, and
normalization pipeline as any other track, with title, artist,
duration, and thumbnail read straight from the downloaded file's
embedded tags. The TYPE column reflects the real source (YOUTUBE /
SOUNDCLOUD / MIXCLOUD / BANDCAMP) rather than a generic label. The URL
resolves immediately (so the dialog closes right away) and every
track — a single item or a whole playlist — downloads in the
background, one at a time; nothing blocks on the download itself, so
adding a multi-hour mix is exactly as responsive as adding a
three-minute song. Downloading is a two-step pipeline — `yt-dlp`
fetches the raw audio and thumbnail, then NEONAMP's own ffmpeg call
transcodes, tags, and embeds the cover art — because yt-dlp doesn't
expose progress for its own internal ffmpeg step. Both steps report a
real percentage (byte-level while downloading, `-progress`-driven
while converting), visible two ways: an amber status strip above the
toolbar (`⬇ DOWNLOADING: <title> 42% · N QUEUED · N FAILED`, or `⚙
CONVERTING: <title> 67%`) and each queued track's TYPE column, which
reads QUEUED / DOWNLOADING 42% / CONVERTING 67% / FAILED until the
file lands and reverts to the source name. Both are driven live over `/ws`,
and a (re)loaded playlist manager
fetches current progress on load too, so reopening the page mid-batch
still shows where things stand. A failed track (private/removed video,
network blip, etc.) shows FAILED and stays that way rather than silently
reverting — right-click it for **Retry download**, or right-click
empty playlist space for **Retry all failed downloads** to requeue
everything that failed at once. A playlist built from a **playlist,
set, or album URL** (not a single track) remembers that source and
checks it automatically every 6 hours (plus once shortly after boot)
for items added since — handy for an ongoing series. Right-click
empty playlist space for **Check for new videos** to trigger that
check on demand instead of waiting. Deleting a playlist also reclaims its
`youtube-cache/` audio, unless another saved playlist still uses the
same track. Requires `yt-dlp` on PATH — install it separately (`pip
install yt-dlp` or see
[github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)); without
it, adding audio fails with a clear error.

## Library-wide search & smart playlists

The ⌕ button beside PLAYLISTS on `/playlist` (or `Ctrl+K`) opens a search
across every saved playlist's title/artist/album at once — the sidebar
filter next to it only matches playlist *names*, not what's inside them.
Results show which playlist each match lives in; double-click one to load
that playlist and start playing it immediately, no need to hunt through
playlists by hand to find a track you know you added somewhere.

The same dialog has two more tabs alongside SEARCH:

- **RECENTLY ADDED** — every track, across every playlist, sorted by when
  it was added, newest first. Tracks added before this feature shipped
  have no timestamp and won't appear here; everything added from now on
  will.
- **MOST PLAYED** — tracks sorted by play count. A play counts once a
  track has been listened to past half its duration (capped between 10s
  and 30s), tallied from the same playback-state stream the deck/jukebox
  already send over `/ws` — nothing extra to configure. Internet radio
  stations aren't counted (a live stream has no meaningful "play").

Play counts persist to `play-counts.json`, saved on the same debounced
schedule as the loudness cache.

## Playlist utilities

The playlist **UTIL** menu can randomize or reverse the queue, remove
duplicates or missing sources, sort by artist/title/duration, crop to
the selected row, and build a queue from one or more selected albums.
Utilities change the working queue; use **SAVE** when the result should
become a persistent playlist.

## EQ presets

The EQ panel has the classic Winamp/XMMS preset bank in a dropdown:
Flat, Classical, Club, Dance, Full Bass, Full Bass+Treble, Full
Treble, Laptop/Phones, Large Hall, Live, Party, Pop, Reggae, Rock,
Ska, Soft, Soft Rock, Techno — plus NEON (I3C), the house curve.
Hand-tune any slider and it flips to CUSTOM; your curve and the
selected preset name both persist.

## DSP rack

Use **DSP** in the Equalizer header to build a reorderable effects
chain. Available modules are compressor, limiter, stereo width, mono,
bass boost, and convolution reverb. Every module can be bypassed,
reordered, tuned, or removed; CLEAN, BROADCAST, BASS CLUB, WIDE SPACE,
and MONO RADIO presets provide starting points. The rack persists in
`settings.json` and the OBS jukebox loads the same order and values.
Because OBS DSP routes audio through Web Audio, the same capture caveat
as OBS EQ applies.

## Metadata sidecars

Select a local track on `/playlist` and choose **EDIT METADATA** to
edit title, artist, album, genre, year, and artwork. Changes are written to
`<audio-file>.neonamp.json`; embedded tags and audio bytes remain
untouched. Artwork accepts JPEG, PNG, WebP, or GIF up to 2 MB. Resetting
the editor removes the sidecar and immediately reveals the embedded
metadata again. Saving a playlist carries the sidecar into that
playlist's private storage.

## Visualizers

Click the deck's visualizer to cycle, or press **VIS** to pick directly:
**BARS** (44-band spectrum), **SCOPE** (neon oscilloscope), **VU**
(segmented meter), **RADIAL** (circular spectrum), **WATERFALL**
(scrolling frequency history), **DOTS** (matrix spectrum), **PARTICLES**
(bass-reactive burst), and **OFF** (grid idle). Your pick is saved. The
OBS overlay supports the same modes through its `?vis=` parameter.

## OBS broadcast overlay

A dedicated broadcast HUD lives at **http://localhost:3090/obs**. It
uses a larger album-art card, separate title and artist hierarchy,
elapsed/total timing, a full-width signal visualizer, source status,
and compact KBPS/KHZ/track chips in a ~320px glass panel. Add it as a
**Browser Source** (try 360×250), enable *Control audio via OBS*, and
it anchors to the **bottom-right** of the source by default. The page
background is transparent.

**By default the overlay IS the jukebox**: it auto-plays your loaded
queue and outputs the audio itself, so OBS captures it straight from
the browser source — the main player doesn't need to stay open while
you stream. It picks up your saved queue, resumes from the saved
track + position, loops, skips unreadable files, shows title / artist
/ album art / elapsed time, and drives its visualizer from its own
analyser. If the queue is empty it says so and keeps re-checking
every few seconds. `?playlist=Name` plays a saved playlist instead;
`?shuffle=1` randomizes; `?vol=40` overrides the saved volume (OBS's
mixer works on top of that too).

### Mirror mode

Prefer to DJ from the main deck live? Add `?mirror=1` and the overlay
stops playing and instead reflects the main player over WebSocket:
same title/art/clock, with the spectrum fed by real analyser
frames from the deck (synthetic pulse fallback if the tab throttles).
The bar auto-fades when playback stops or the player goes away. In
mirror mode, capture audio with your usual desktop audio source.

URL params (combine freely):

| Param        | Effect                                        |
| ------------ | --------------------------------------------- |
| *(none)*     | Jukebox — auto-plays the session queue        |
| `?playlist=Name` | Jukebox with a saved playlist             |
| `?shuffle=1` | Shuffle (jukebox)                             |
| `?vol=40`    | Volume 0–100 (jukebox)                        |
| `?mirror=1`  | Mirror the main deck instead of playing       |
| `?vis=bars` / `scope` / `vu` / `radial` / `waterfall` / `dots` / `particles` / `off` | Visualizer style |
| `?demo=1`    | Fake data — for positioning the source in OBS |
| `?keep=1`    | Never auto-hide (mirror mode)                 |
| `?novis=1`   | Hide the visualizer                           |
| `?align=left` / `?align=center` | Horizontal anchor (default **right**) |
| `?valign=top` / `?valign=middle` | Vertical anchor (default **bottom**) |
| `?w=380`     | Panel width in px (default 320)               |

Album art shows in the mini deck's display when the track has it.

The jukebox follows the deck's **NORM** setting live and now applies
both positive and negative gain, plus the same post-EQ leveler and
safety limiter. Positive gain uses the processed Web Audio route;
negative-only corrections can still use the regular media-element
fallback. The jukebox picks up saved EQ + norm prefs at boot. The
**EQ curve** is off on the overlay by default — its
audio deliberately stays on the bare media path OBS captures most
reliably. Two ways to enable the EQ on the overlay: press **OBS** on the deck's
EQ panel (persists in `settings.json`; the overlay routes through the
deck's live-synced 10-band EQ from its next load — refresh the source
once after first enabling), or pin it per-source with `?eq=1` in the
URL. Turning the OBS toggle off flattens the overlay's filters
instantly. Whenever the processed route is active (EQ, DSP, balance,
or positive normalization gain), capture via Desktop/Application
Audio, or verify *Control audio via OBS* passes Web Audio on your OBS
version first.

## Twitch chat commands

The full settings console lives at **http://localhost:3090/twitch** —
connection config, chat toggles, live now-playing with a rendered
!song preview, and a test console (simulate commands, send a line to
chat, activity log). All Twitch setup lives on that page — the deck stays clean. One-time
setup: create an app at https://dev.twitch.tv/console/apps with OAuth
redirect `http://localhost:3090/auth` (Confidential), paste the
Client ID + Secret into the panel, SAVE, then **LOGIN WITH TWITCH**.

A localhost callback is correct and Twitch-sanctioned (`http://` is
allowed for localhost only) — the redirect just has to exactly match
a URL registered on your Twitch app. Reusing the app from an older
player? Set the redirect field to its registered URL (e.g.
`http://localhost:4000/auth`) and NEONAMP will open a listener on
that port too, so the old registration works unchanged. Do the login
once in a browser on the PC running the server; the saved tokens then
work no matter where you use the player from.
Tokens land in `twitch-auth.json`, refresh automatically, and chat
reconnects on every server boot.

Commands (via EventSub `channel.chat.message`, replies via Helix):

| Command    | Who              | Effect                                |
| ---------- | ---------------- | ------------------------------------- |
| `!song`    | everyone         | Posts the now-playing track (default 30s cooldown) |
| `!next` / `!prev` | broadcaster, mods, VIPs | Skip forward / back      |
| `!pause` / `!resume` | broadcaster, mods, VIPs | Pause / resume       |

`!song` reads the live `/ws` state, so it's correct whether the main
deck or the OBS jukebox is playing — and the jukebox obeys the
transport commands too, no Interact window needed. Optional
auto-announce posts every track change (10s min gap).

The message template supports `{title}` `{artist}` `{artistUrl}`
`{album}` `{year}` `{file}` `{idx}` `{count}`. `{artistUrl}` is read
from the audio file's own tags — artist website commons, ID3 `WOAR`,
`TXXX:website`, or `WXXX` frames — and falls back to the file's
comment tag, exactly like the old player. The default template is
`Now playing: {title} by {artist} {artistUrl}`, and lookups happen
server-side per file (cached), so it works even for tracks queued
into playlists before this feature existed.

Test without going live:
`curl -X POST localhost:3090/api/twitch/simulate -H "Content-Type: application/json" -d '{"text":"!song"}'`
(add `"badges":["moderator"]` or `"asBroadcaster":true` for transport commands).

Twitch endpoints: `GET /twitch` (console), `GET /api/twitch/status`,
`POST /api/twitch/config`, `GET /api/twitch/login`, `GET /auth`
(OAuth callback), `POST /api/twitch/connect|disconnect|simulate`,
`POST /api/twitch/chat/send`, `GET /api/nowplaying` (enriched
snapshot — handy for other overlay tools too).

## Playlists

- Open **http://localhost:3090/playlist** directly or press **EJECT**,
  **MANAGE**, `E`, or `L` on the deck
- Create, select, delete, filter, sort, randomize, reverse, deduplicate,
  reorder, or export playlists from the management page
- **ADD FILE PATHS** opens a native picker and stores references to the
  original files; no audio is uploaded or copied
- Double-click a track to load that playlist and immediately switch the
  current song in the deck or OBS jukebox
- **LOAD + PLAY** activates the selected track (or the first track) in
  the running player; the server also updates `settings.json`
- Metadata and artwork editing remains sidecar-based and is available
  from the selected playlist track
- Player state (queue, position, volume, EQ, visualizer, …) lives in
  `settings.json` at the project root — see the Settings section.

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

`file` is the original absolute source path. `sourceId` is generated by
the server and used for safe playback/artwork/metadata URLs. Moving or
renaming the source file outside NEONAMP will make that entry missing
until its path is replaced. Legacy `playlist-media/` entries continue
to play and can coexist with filepath entries.

## Controls

| Key            | Action                       |
| -------------- | ---------------------------- |
| `Z X C V B`    | Prev / Play / Pause / Stop / Next (classic Winamp row) |
| `Space`        | Play / pause toggle          |
| `← →`          | Seek −5s / +5s               |
| `↑ ↓`          | Volume ±5                    |
| `S` / `R`      | Shuffle / cycle repeat (off → all → one) |
| `E` / `L`      | Open playlist manager        |
| `Delete`       | Remove selected queue track  |

Other niceties: click the big time readout to toggle time-remaining,
double-click a queue row to play it, drag rows to reorder,
double-click the BAL slider to re-center, and the EQ/PL buttons
collapse their panels just like the original.

## API (if you want to script it)

- `GET  /playlist` — playlist management UI
- `GET  /api/art?...` — artwork for playlist or registered filepath sources
- `GET  /api/loudness?...` — normalization data for playlist or filepath sources
- `GET/PUT/DELETE /api/metadata?...` — read, save, or reset a metadata sidecar
- `GET/POST /api/radio` — list or add radio bookmarks
- `PUT/DELETE /api/radio/:id` — edit or remove a station
- `GET /api/radio/:id/stream|status` — proxied audio and live ICY status
- `GET  /api/playlists` — list saved playlists
- `GET  /api/search?q=...` — title/artist/album search across every saved playlist
- `GET  /api/smart/recent?limit=...` — most recently added tracks across every playlist
- `GET  /api/smart/played?limit=...` — most played tracks across every playlist
- `GET  /api/playlists/:name` — fetch one
- `PUT  /api/playlists/:name` — save `{ "tracks": [...] }` without copying filepath sources
- `POST /api/files/pick` — open the server computer's native audio-file picker
- `POST /api/playlists/:name/paths` — append `{ "paths": ["D:\\Music\\track.mp3"] }`
- `POST /api/playlists/:name/youtube` — append `{ "url": "..." }` (YouTube/SoundCloud/Mixcloud/Bandcamp, track or playlist)
- `POST /api/playlists/:name/youtube/retry` — re-queue one failed track: `{ "videoId": "..." }`
- `POST /api/playlists/:name/youtube/resync` — check every linked source for new items now
- `GET  /api/youtube/queue` — in-flight download jobs (status/percent/phase) for a (re)loaded manager
- `GET  /path-media/:sourceId` — seekable playback for a registered filepath source
- `GET  /youtube-media/:file` — seekable playback for downloaded audio (any import source)
- `PUT  /api/playlists/:name/upload?name=file.mp3` — legacy direct-upload compatibility
- `POST /api/playlists/:name/activate` — load a playlist/track into the deck and OBS jukebox
- `POST /api/playlists/:name/rename` — rename metadata and update live players
- `DELETE /api/playlists/:name` — delete the playlist; filepath source audio is untouched
- `POST /api/control` — validated live transport/settings control for deck and OBS
- `GET/PUT/POST /api/session` — full player settings (`settings.json`)
- `WS /ws` — now-playing relay: player sends `{type:'state'|'fft'}`, overlays listen

---

INSERT3COINS // NEONAMP v1.0 // COIN-OPERATED AUDIO
