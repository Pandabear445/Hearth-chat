# TikTok and Instagram: played in place, and watched together

TikTok videos and Instagram reels (and posts) linked in a message play right in the chat, and any of them can be
watched together in a call: one at a time, in a queue that mixes both, or two side by side.

Code: `server/social.js` (which links count, the ids in them), `public/js/social.js` (the same rules in the app,
plus TikTok's player messages), `public/js/social-embed.js` (the player in a message), `public/js/watch.js`
(`tiktokAdapter`, `instagramAdapter`, the countdown and side by side), `server/linkpreview.js` (TikTok oEmbed
cards and `POST /api/social/resolve`), `server/index.js` (`parseWatchUrl`, `watch:ready`, `watch:side`, the CSP).
Tests: `test/social-embeds.test.js`, `test/outside-hardening.test.js` › xss-7, e2e › tiktok and instagram.

## What each site allows (2026)

| | TikTok | Instagram |
|---|---|---|
| Player | `https://www.tiktok.com/player/v1/<id>` (the embed player) with query options: controls, progress bar, autoplay, no "more videos" (`rel=0`), no music or description overlay | `https://www.instagram.com/reel/<code>/embed/` (or `/p/<code>/embed/`): an embed page with Instagram's own player |
| Control from outside | postMessage API. In: `play`, `pause`, `seekTo` (seconds), `mute`, `unMute`. Out: `onPlayerReady`, `onStateChange` (-1 not started, 0 ended, 1 playing, 2 paused, 3 buffering), `onCurrentTime` (`{ currentTime, duration }`), `onMute`, `onError`. Messages are objects with `'x-tiktok-player': true`. No playback rate | **None.** The embed page can't be told to play, pause or seek, and doesn't say what it's doing |
| Title and picture | oEmbed: `https://www.tiktok.com/oembed?url=…` (no token): title, author, a picture on TikTok's picture hosts (`*.tiktokcdn.com`) | oEmbed needs a Meta app access token, which a self-hosted server doesn't have, so none |
| Short links | `vm.tiktok.com/<code>`, `vt.tiktok.com/<code>`, `www.tiktok.com/t/<code>`: a redirect to the video | — |

## The rules for a link

Only links that name one video count (anything else stays a plain link):

- TikTok: `www.tiktok.com/@name/video/<id>`, `/embed/v2/<id>`, `/embed/<id>`, `/player/v1/<id>`, `m.tiktok.com/v/<id>.html`.
  The id is 15 to 21 ASCII digits.
- Instagram: `/reel/<code>`, `/reels/<code>`, `/tv/<code>`, `/p/<code>`, `/<name>/reel/<code>`, `/<name>/p/<code>`
  on `instagram.com`, `www.` or `m.`. The code is 5 to 48 of `A–Z a–z 0–9 _ -`.
- https or http, the usual port only, no user name or password in the link, nothing after the id but an optional
  `/embed/` for Instagram (query strings and `#` parts are ignored).

The player's address is then **built from the id** (`playerSrc`), never taken from the link, so no link can put an
address of its own in a frame. The app and the server have their own copy of the rules (no build step to share
one); a test runs every link form, and a list of near-misses, through both.

## In a message

- **Click to load** (the default). A TikTok or reel shows as an upright (9:16) placeholder: the picture from the
  sender's link preview when the message has one (it's inside the encrypted message, so showing it contacts
  nobody), the site's name, a **Play** button and the line "Loads from tiktok.com, which sees your IP address."
  The player loads only when tapped. A ✕ closes it again (and stops it).
- **Settings → Chat → TikTok and Instagram**: *Load when I tap* (default), *Always load*, *Just show the link*.
  Kept on the device (like the other Chat settings). *Always load* still waits for a tap on a short TikTok link,
  since opening one asks the Hearth server (below).
- A message with two or more (a TikTok and a reel) shows them side by side; each plays on its own, so both can
  play at once.
- Players follow the sender's **Embed links** permission, like link previews. A preview card for the same link is
  replaced by the player (its picture and title move onto the placeholder).
- Phones: the placeholder and player are at most 300 px wide, never wider than the message; two share a row.
  The desktop app (Electron) shows the same frames; "Open on TikTok/Instagram" and the players' own popups open
  in the system browser (`setWindowOpenHandler`), and the frames can never navigate the app.

### The frame

```
<iframe src="https://www.tiktok.com/player/v1/<id>?…" sandbox="allow-scripts allow-same-origin allow-presentation
  allow-popups allow-popups-to-escape-sandbox" allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
  referrerpolicy="no-referrer">
```

- Sandboxed: scripts and their own storage (both players need them), full screen, and popups that leave the app.
  No top navigation, forms, modals or downloads.
- No referrer: TikTok and Instagram aren't told which Hearth server or page the player is on.
- The page's CSP allows frames from exactly `https://www.tiktok.com` and `https://www.instagram.com` (nothing for
  their CDNs, which only the frames themselves load).
- TikTok's player messages are read only from that frame (`e.source`) and from `https://www.tiktok.com`
  (`e.origin`), and must carry `'x-tiktok-player': true`; commands are posted to that origin only.

### Short TikTok links

`vm.tiktok.com/…` and `tiktok.com/t/…` don't say which video they are. When someone taps one (or starts
watching one together), the app asks the Hearth server: `POST /api/social/resolve { url }`. The server asks
TikTok hop by hop through netguard (public addresses only, DNS pinned): each hop must be https, the usual port,
and one of TikTok's own names (`www.`, `m.`, `vm.`, `vt.tiktok.com`); the first redirect that names a video ends
it, so the video's page itself is never fetched; at most 4 hops, 16 KiB read per hop, 6 s in all. The answer is
just the id (checked again by the app). Signed in only; 20 a minute per account, 60 per network; nothing is
cached between accounts. It's off when the owner turned link previews off (this is the server fetching a link
for someone). **The server then sees that short link, and who asked**, as with a preview.

## Watch together

- **TikTok** is kept in step like YouTube: the shared state drives the player's `play`, `pause` and `seekTo`, and
  the player's own state and time (`onStateChange`, `onCurrentTime`) are reported back; a jump in its time is a
  seek someone made in the player. There's no speed control (TikTok's player has none).
- **Instagram can't be controlled**, so its items are `manual`, and the app says so in the bar: "Instagram doesn't
  let other apps control its player, so this one isn't kept in step: press ▶ in the video when the countdown
  ends. Pausing and jumping aren't shared." What is shared:
  - **Start together**: a 3-second countdown over everyone's video (`startAt` from the server's clock), then
    "▶ Press play now".
  - **A ready check**: *I'm ready* (`watch:ready`), and "2 ready" for everyone.
  - **Next**: the host (or anyone, when everyone may control) moves everyone on; anyone else's *I'm done* counts
    once most of the call says so (the same vote as "video ended").
  - A manual item starts paused: nothing runs until someone presses Start together.
- **A queue mixing both** (and YouTube, Vimeo…): add any of them with *+ Queue*, the **Watch together** buttons on
  a message, or **Queue all** on a message with several.
- **Side by side** (`watch:side`): a second TikTok or reel next to the one playing (TikTok and Instagram only;
  both upright). Adding it pauses the first; Play then starts a countdown for both. After that only the first is
  shared: the second starts and stops with it but isn't kept at the same moment (a reel beside it can't be
  started from outside at all: press ▶ when the countdown ends). *One video* takes it away; moving to a video
  that isn't upright drops it.
- Upright videos get a taller stage (9:16 in the middle; two of them share it), on phones and in the mini player too.

## Privacy, in short

- Nothing loads from TikTok or Instagram until a person taps (unless they chose *Always load*). Then that site
  sees their IP address, may set cookies inside its own player, and knows which video they opened. It isn't told
  which Hearth server (no referrer).
- A link preview of a TikTok link goes to TikTok's oEmbed, from the server, only when the sender asks for a preview.
- A short TikTok link is looked up by the server, only when someone taps it or watches it together.
- Watch together: the server fetches TikTok's oEmbed title (as it does YouTube's), and keeps the video's id and
  link in the call's shared state while it plays (as for every watch-together video).

## Limits

- TikTok's player API is TikTok's: if they change it, the in-step part stops (the video still plays in the frame).
- Instagram: no start, pause or seek from outside, no title, no picture (unless the sender's preview card got one);
  "together" is only as good as people pressing ▶ when told.
- TikTok photo posts (`/@name/photo/<id>`), stories, live streams, profiles and Instagram stories stay plain links.
