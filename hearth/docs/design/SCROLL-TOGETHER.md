# The Reels tab, and scrolling together

Every text channel, DM, group chat and voice channel chat has a **Reels** tab next to **Chat** (**Call** on a voice
channel's page). It's a full-height, upright feed of every TikTok video and Instagram reel or post shared in that
conversation, newest first, that you swipe through like TikTok, on your own or **together** with everyone else
looking at it.

![The Reels tab on a desktop and a phone](../scroll-together.png)

Code: `public/js/reels.js` (the feed and the rules, no page), `public/js/reels-ui.js` (the tab), `server/reels.js`
(the `reels:*` events), `public/js/app.js` (`convTabs`, `reelsHost`, `REELS`). It reuses `social.js` (which links
count; [SOCIAL-EMBEDS.md](SOCIAL-EMBEDS.md)) and watch together's TikTok and Instagram players (`watch.js`).
Tests: `test/scroll-together.test.js`, e2e › reels tab.

## What it can't be

**TikTok's For You feed and Instagram's Reels feed can't be shown.** Neither offers a way to embed them, and their
terms forbid copying them. The tab says so, and its feed is only the videos people share in the conversation.

## The feed

- Made on each device from the **decrypted** messages: the server can't read them and never learns which links
  they hold. First the messages the chat already has, then older pages (`GET …/messages?before=`), decrypted here,
  asked for as you get within 4 videos of the end (a few pages at a time).
- Each video once (from its newest share), at most 4 from one message, never from thread replies, code or spoilers.
  Left out like in the chat: messages you can't read, gone ones, from people you blocked, ones the word filter hides
  or blurs, and from someone without the Embed links permission.
- Live: a new link goes on top, an edit or delete updates it, reactions update in place.
- Each card: who shared it and when, the sender's preview title if there is one, the message's reactions (tap to
  react, or pick an emoji), **Jump to message** (back to the chat, at the message), and **Open on TikTok/Instagram**.
- **Add a link** (the + on a phone, the side column on a desktop): it's sent as an ordinary message in the
  conversation, encrypted like any other, so it shows in the chat too. A preview card is added if you tick it (your
  server fetches the link, as with any preview); ticked by default when Settings → Chat → "When I send a link" is
  Always. People who can't post there see why instead.

## Swiping

- One video per screen, snapping (`scroll-snap-type: y mandatory`): swipe, the mouse wheel, ↑/↓ (or j/k, Page Up/Down)
  and the side column's arrows.
- The video on screen plays straight away, **without sound** until a tap on its **Tap for sound** button (or m);
  from then on the tab plays with sound. Instagram's player can't be started from outside: its card says to press ▶.
- **Memory:** only the video on screen and one on each side have a player; a player that leaves that window is
  destroyed (its frame removed) and its card goes back to a placeholder. Short TikTok links are looked up (by your
  server) only for the video on screen.
- On a phone (the phone layout) the tab covers the whole screen, with ← back to the chat, the together bar and + at
  the top, and the actions on the right of the video. On a desktop it fills the main column, with a side column.
  The tab is one fixed layer laid over its place, never moved, so the app redrawing around it doesn't reload players.

## Privacy

Settings → Chat → TikTok and Instagram applies:

- **Load when I tap** (default): a cover says the videos load from TikTok and Instagram, which see your IP address,
  and that short links are looked up by your server. **A tap on that cover** lets every video in the tab, and in
  other Reels tabs, load **until you close or reload Hearth**: you don't tap each video. Nothing else counts as
  that tap (not Back, +, or starting a swipe).
- **Always load**: no cover.
- **Just show the link**: cards with the link only, never a player.

Players are `social.js`'s: built from a checked id, on `www.tiktok.com` or `www.instagram.com` only, sandboxed, no
referrer.

## Scroll together

**Scroll together** starts a session for everyone viewing that conversation's Reels tab. Everyone in the
conversation's call who isn't on the tab is told ("alice started scrolling together in …").

- Whoever is following moves everyone: when one person swipes, everyone's tab moves to the same video, and the others
  see "alice swiped to the next ↓". The bar shows "Scrolling with alice, bob" with their pictures.
- **Everyone controls** (default) or **Only I control** (the starter's choice). With Only I control, scrolling away
  means scrolling on your own ("You're scrolling on your own now").
- **Leave** to scroll on your own (kept through a dropped connection); **Rejoin** snaps back to where everyone is.
  Opening the tab during a session joins it; leaving the tab leaves it. The last person following ends it, and so
  does **Stop**. If the starter of an "Only I control" session leaves, everyone controls it from then on.
- Moves are at most one every 0.7 s per conversation (a flood of swipes would reload everyone's players), and the
  "who swiped" note shows at most every 2 s.
- A video shared again is the same card (and player): a session on its older share still finds it.
- The chat isn't on screen on the Reels tab, so messages arriving there stay unread (and notify as usual) until you
  go back to **Chat**.
- **TikTok** stays in step with watch together's sync: play, pause and seeks in the player go to everyone, and each
  player is kept where everyone is (a jump over 1.6 s is corrected).
- **Instagram** can't be controlled: **Start together** shows a 3-second countdown on everyone's screen, then
  "▶ Press play now", with **I'm ready** and a ready count, as in watch together.

### What the server sees

The events carry only **the message id** (a message of that conversation, checked; not a thread reply, and not one
from before your history starts) and **which link in it** (0 to 3), plus play/pause/time. Never a link or any text:
the links stay inside the encrypted messages. So the server learns which message the group is looking at, and when,
but not what it links to (watch together, by contrast, sends the link itself).

| Event | Who | Carries |
|---|---|---|
| `reels:join` `{ key }` | anyone who can read the conversation (a channel they can view, a DM they're in and haven't blocked) | `c:<channelId>` or `d:<dmId>` |
| `reels:leave` | | |
| `reels:start` `{ key, mid, i, hostOnly }` | a viewer, when there's no session | message id, link index |
| `reels:go` `{ key, mid, i, dir }` | someone following who may control | message id, link index, direction |
| `reels:control` `{ key, mid, i, action, position, together }` | the same | play / pause / seek, seconds (capped at 24 h) |
| `reels:ready` `{ key, mid, i, ready }` | someone following | |
| `reels:follow` `{ key, on }` | someone viewing | leave / rejoin |
| `reels:mode` `{ key, hostOnly }` | the starter (or staff) | |
| `reels:brainrot` `{ key, on }` | the same | a boolean: Brainrot mode for everyone following ([BRAINROT.md](BRAINROT.md)) |
| `reels:stop` `{ key }` | the starter, staff, or anyone following when everyone controls | |

The server answers with `reels:state` to the viewers: `{ key, viewers: [user ids], session: { by, hostOnly, mid, i,
playing, position, updatedAt, startAt, seq, lastBy, lastAction, dir, brainrot, brainrotBy, following, ready }, serverNow }`. Access is
checked on every event, and again for every viewer before each update goes out: someone who loses access (removed,
a channel made private) stops hearing and is let go. Someone for whom the shared message is from before their
history starts isn't sent the session at all. One tab per connection, 200 viewers per conversation, updates
merged to at most 4 a second, and every event counts against the realtime flood limits. Nothing is stored.

## Limits

- The feed is only what's been shared; videos from long ago appear as you scroll back (each page is decrypted on
  the device).
- Instagram: no play, pause or time from outside.
- Someone whose feed differs (they blocked the sharer, or the message is hidden for them) is told "Everyone moved to
  a video that isn't here for you".
- Leaving the tab (going to the chat or elsewhere) leaves the session; there's no mini player for it.
