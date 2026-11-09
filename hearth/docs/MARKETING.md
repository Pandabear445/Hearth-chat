# Cindrly: advertising and launch plan

Written 9 November 2026 for a solo developer with roughly no budget. It builds on `hearth/docs/GROWTH.md`
(16 October 2026) and replaces its ranking where the facts have changed since. Every dated claim has a source
at the end. Anything I couldn't confirm is marked *unverified*: check the live page before you rely on it.

Every channel below has a rule against faked enthusiasm. So: no sock puppets, no upvote requests, no posts from
friends pretending to be strangers, and every post says you made Cindrly.

---

## 0. The short version

1. **Spend the next 7 days fixing things, not posting.** Three things would embarrass a launch today. The
   privacy policy, child-safety page and account-deletion page still say `{{CONTACT_EMAIL}}`. The name
   "Cindrly" hasn't had a trademark check. And the site, repo and file names are still half Hearth. Section 8 has
   the list.
2. **The Discord angle is real, but it isn't "Discord wants everyone's ID."** Discord's worldwide age checks
   began on 22–23 September 2026. Discord says over 90% of accounts are sorted automatically, and the rest are
   limited until they verify[^tnw]. Lead with this true point: Cindrly never asks for ID or a face scan, so it has
   no ID database to leak. Discord's support vendor leaked about 70,000 ID photos in October 2025[^breach].
3. **Your biggest lever is server owners, not individual users.** One person who moves a 40-person friend group
   or club is worth 40 sign-ups. The invite unfurl and "we're moving" message are built (FEATURES.md, "Invite
   links that unfurl"). Every post below aims at owners.
4. **Know which doors are shut for now:**
   - r/opensource has banned AI-assisted projects since 24 October 2026, and also requires projects to be a year
     old with several contributors[^ros]. Skip it.
   - Privacy Guides only lists tools that meet its criteria, which include forward secrecy[^pg]. Cindrly says in
     SECURITY.md that it has none for history, so don't submit.
   - awesome-selfhosted opens about 6 February 2027 (its 4-month rule).
   - r/selfhosted allows only its weekly megathread until about 6 January 2027, 3 months after the first public
     commit.
5. **Ranked by expected users per hour** (section 4):
   1. your own server owners and the "we're moving" kit;
   2. replies in Discord-alternative threads, honest and in your own voice;
   3. the r/selfhosted megathread;
   4. AlternativeTo;
   5. Show HN;
   6. short-form video;
   7. Mastodon and Lemmy;
   8. app stores and catalogs;
   9. listicle outreach;
   10. Product Hunt (last).

---

## 1. Positioning

### Who it's for (in order)

1. **Owners of small Discord servers (5–200 people) who are annoyed by Discord's direction:** friend groups,
   small gaming clans, hobby clubs, study groups at university. They decide, and their members follow.
   Cindrly's Discord template import is the hook: the same channels and roles in two minutes. It doesn't bring
   message history, so say so.
2. **Self-hosters** who want a Discord-style app they can run on one box: one Node process, SQLite, Docker.
   They bring credibility, bug reports, stars and catalog installs.
3. **Privacy-minded people** who want encrypted group chat with voice and screen share, and who find Signal too
   bare and Matrix too heavy.

Not the target: big public communities (calls have no media server, so large group video won't scale), and
anyone under 13 (the Terms and privacy policy say 13+).

### One-line pitch

> **Cindrly is a free, open-source, end-to-end-encrypted Discord alternative: servers, voice, video and screen
> share, with no ID checks and no paywalled features. Use the community server or run your own.**

A shorter version for bios and video captions:

> Discord-style servers and voice chat. Encrypted. Free. No ID.

### Proof points (all true today; keep them that way)

- Messages and files are end-to-end encrypted in the app, and the server stores ciphertext. Calls are encrypted
  between the people in them.
- Import a Discord server's structure (channels, roles) from a template.
- Watch together (YouTube, Twitch, TikTok, files), Reels tab with scrolling together, soundboards, events,
  threads, scheduled and disappearing messages.
- Every customisation is free. No Nitro equivalent.
- Apps for Windows, Mac, Linux and Android, plus an installable web app. iPhone is coming through TestFlight.
- MIT licence, self-hostable, Docker image.

### Honest limits (put these in every technical post; they win trust)

- The server sees metadata: who talks to whom, and when.
- The web app's code comes from the server, so you trust whoever runs it.
- No forward secrecy for history (SECURITY.md says so).
- No media server, so big group video calls won't scale, and people in a direct call can see each other's IP.
- No independent security audit. Much of the code is AI-assisted. Say this before anyone asks.

### The Discord angle: what you can say, and what you can't

| You can say (sourced) | Don't say |
|---|---|
| "On 9 Feb 2026 Discord announced that every account would be treated as a teen's until proven adult"[^tc1] | "Discord requires everyone's ID" (false: most accounts are sorted automatically[^tnw]) |
| "After a backlash Discord delayed it to the second half of 2026, and added more ways to verify"[^tc2] | "Discord sells your face scans" (no source) |
| "The global rollout started on 22–23 Sept 2026. Accounts it can't confirm as adults are limited until they verify, by a selfie checked on the device, an ID scan or other methods. The UK and Australia have their own process"[^tnw] | "Cindrly is the place to avoid age checks" (it attracts exactly the users you don't want, and age-check laws can apply to whoever runs a server) |
| "In Oct 2025 a Discord support vendor was breached, and about 70,000 ID photos were exposed"[^breach] | Any number about people leaving Discord for Cindrly |
| "Cindrly never asks for ID or a face scan. There's no ID database to leak." | "Unhackable", "military-grade", "fully anonymous" |

Frame it as **"your community shouldn't depend on one company's policy changes"**, not as "escape the age
checks." That framing outlasts the news cycle and doesn't invite trouble.

---

## 2. The name change announcement

Do this **after** the trademark check (section 9.1). Announcing a name and then changing it again would hurt
twice. Revolt had to become Stoat in October 2025 after a cease-and-desist[^stoat].

**Where:** a pinned message in the main server, an in-app "What's new" note (Admin → Owner → Update notes),
GitHub release notes, the README header (already there), and a banner on the landing page. Post on Mastodon too.
Don't post to Reddit or HN about the rename alone: nobody there knows the old name.

**In-app and release notes (copy):**

> **Hearth is now Cindrly.** Same app, same people, same encryption: nothing you need to do.
>
> - The community server now lives at **cindrly.com**. The old address forwards there, so old invite links keep
>   working.
> - In a browser, sign in once on cindrly.com (browsers keep sign-ins per address). Your messages are still
>   there: your keys come from your password. Turn notifications on again, and re-add any Home Screen icon.
> - Desktop and Android apps keep working as they are. To move them: *Settings → Apps & devices → Switch
>   server* → `https://cindrly.com`.
> - Why the new name? "Hearth" is used by a lot of other products, and we wanted a name people can find and
>   that's ours. 🔥 The fire stays.
>
> The only official places are cindrly.com and github.com/Pandabear445. Anything else using the name isn't us.

**Mastodon (copy):**

> Hearth, my little open-source, end-to-end-encrypted Discord alternative, is now **Cindrly**, with a real home
> at https://cindrly.com 🔥
>
> Same app: servers, voice, video, screen share, watch together, every feature free. MIT, self-hostable.
> Code: https://github.com/Pandabear445/Hearth-chat
>
> #opensource #selfhosted #privacy #discord

---

## 3. 30-day calendar (Tue 10 Nov – Wed 9 Dec 2026)

Effort is your own time. Posts go out mid-morning US Eastern on weekdays unless noted. Some timing advice comes
from blogs and is *unverified*.

| Day | Date | Do | Time |
|---|---|---|---|
| 1 | Tue 10 Nov | USPTO and EUIPO search for "Cindrly" and close marks (section 9.1). Pick the contact email and fill in `{{CONTACT_EMAIL}}` on the three site pages. | 2 h |
| 2 | Wed 11 Nov | Finish MOVE-DOMAIN.md: DNS, Caddy, redirect test from an old invite link. Claim the handles: Mastodon, Bluesky, TikTok, YouTube, Reddit u/cindrly (you), Lemmy, Product Hunt maker profile. Start the Lemmy account clock (30 days, see section 4). | 2 h |
| 3 | Thu 12 Nov | Finish the rename leftovers (section 8): file names, landing-page URLs, store text, screenshots showing "Cindrly". | 3 h |
| 4 | Fri 13 Nov | README: a "How Cindrly is built" paragraph (AI involvement, testing, no audit) and the honest limits at the top. Ask a friend to do a timed clean Docker install. | 1.5 h |
| 5 | Sat 14 Nov | Record 3 short screen videos (section 5.5): Discord import, watch together, "no ID" explainer. Raw phone or screen capture is fine. | 3 h |
| 6 | Sun 15 Nov | Rename announcement in-app and in release notes. Post on Mastodon. | 45 min |
| 7 | Mon 16 Nov | **Owner kit day:** message every server owner on cindrly.com. Thank them, and point them to the invite dialog and its moving announcement (section 5.1). Ask what stops their friends from coming over. | 1.5 h |
| 8 | Tue 17 Nov | AlternativeTo listing (alternative to Discord, TeamSpeak, Stoat, Element). selfh.st email. | 45 min |
| 9 | Wed 18 Nov | r/selfhosted **New Project Megathread** comment (copy in section 5.2). Stay in the replies all day. | 30 min + 2 h |
| 10 | Thu 19 Nov | Fix what the megathread found. Post video 1 on TikTok, YouTube Shorts and Instagram Reels. | 2 h |
| 11 | Fri 20 Nov | Search Reddit, Lemmy and Mastodon for live "Discord alternative" threads from the last 7 days. Reply in up to 5, honestly (section 5.1). | 1 h |
| 12–13 | Sat 21 – Sun 22 Nov | Rest, or fix bugs. Admin → Health check. | — |
| 14 | Mon 23 Nov | Write the Show HN text yourself (section 5.4). Have a friend proofread it for clarity only. | 1.5 h |
| 15 | Tue 24 Nov | **Show HN.** Spend the whole day in the comments, in your own words. | 1 h + all day |
| 16 | Wed 25 Nov | Answer the HN fallout. Note every question as a FAQ entry on the comparison page. | 2 h |
| 17 | Thu 26 Nov | US Thanksgiving: quiet. Post video 2. | 30 min |
| 18 | Fri 27 Nov | Weekly metrics snapshot (section 7). Discord-alternative thread replies. | 1 h |
| 19 | Sat 28 Nov | Submit to the Unraid Community Apps and CasaOS catalogs (templates exist in `deploy/catalogs/`). | 2 h |
| 20 | Sun 29 Nov | Umbrel, Coolify and Dokploy submissions. | 2 h |
| 21 | Mon 30 Nov | Email 10 listicle authors (section 5.6), each personalised. | 2 h |
| 22 | Tue 1 Dec | Google Play internal-testing invite post in your server. TestFlight link (if Apple has approved). | 1 h |
| 23 | Wed 2 Dec | New r/selfhosted megathread comment, only if there's a real update (changelog, not repetition). Post video 3. | 1 h |
| 24 | Thu 3 Dec | Reach out to university clubs or gaming groups you or your friends are actually in (section 4, #9). | 1 h |
| 25 | Fri 4 Dec | Metrics snapshot. YouTube creator emails (DB Tech, Techno Tim and similar), now that catalog installs exist. | 1 h |
| 26 | Sat 5 Dec | Write a "what I learned in a month" blog post or GitHub discussion (honest numbers). | 2 h |
| 27 | Sun 6 Dec | Rest. | — |
| 28 | Mon 7 Dec | Mastodon thread with the month's numbers and changes. | 30 min |
| 29 | Tue 8 Dec | Lemmy c/selfhosted post, if your account is now 30+ days old, with the [AIP] tag. | 30 min |
| 30 | Wed 9 Dec | Review: keep the 2–3 channels that brought people who stayed (section 7). Decide on Product Hunt for January. | 1 h |

**Later dates to put in a calendar now:**
- About 6 Jan 2027: r/selfhosted standalone posts become possible (3 months from the first public commit).
- About 6 Feb 2027: awesome-selfhosted PR, written by you (their template asks for a human submission).
- Jan 2027: F-Droid (ANDROID-STORES.md §7).

---

## 4. Channels ranked by expected users per hour of effort

The estimates are rough guesses for a project this young, not data. Treat them as a starting order, and
re-rank after the week-4 metrics review.

| # | Channel | Expected result | Users / hour (guess) | Rules to follow (with date checked) |
|---|---|---|---|---|
| 1 | **Your existing server owners + the "we're moving" kit** | Each owner who moves a group brings 5–50 people | 5–20 | Your own platform. Don't DM-spam people on Discord: unsolicited advertising breaks Discord's rules (*unverified*: check its Community Guidelines). |
| 2 | **Replies in live "Discord alternative" threads** (Reddit r/discordapp, r/privacy, r/degoogle, Lemmy, Mastodon, plus YouTube comments on alternative-roundup videos) | People searching for exactly this, right now | 2–8 | Reply only where someone asked. Say you're the developer. One reply per thread, and name the others too (Stoat, Matrix/Element, TeamSpeak). Reddit's general guidance is to keep self-promotion to a small share of your activity (a "9:1" rule of thumb[^reddit]). Check each sub's sidebar: I couldn't confirm r/discordapp's or r/privacy's current self-promotion rules (*unverified*). |
| 3 | **r/selfhosted New Project Megathread** | Tens to low hundreds of visits, first outside bug reports, stars | 1–4 | Projects under 3 months from first public presence go only in the weekly megathread; standalone posts are removed[^rss]. The suggested template includes "AI Involvement: (Please be transparent.)"[^rss2]. |
| 4 | **AlternativeTo** | Small but lasting search traffic | 2–5 | Normal listing. It covered Discord's age checks in its news[^at]. |
| 5 | **Show HN** | High variance: usually 0, sometimes thousands of visits | 0–50 | Link something people can try (the repo, not a sign-up page)[^showhn]. **No AI-generated or AI-edited comments** (guideline added March 2026[^hnai]). Write the post and every reply yourself. Don't ask for upvotes. |
| 6 | **TikTok / YouTube Shorts / Reels** | Lottery ticket, but it's where Discord's teen and young-adult users are | 0–20 | Disclose that you made it (self-promotion is fine as the creator). No Discord logo as your thumbnail, and nothing that looks like a Discord ad (section 9.2). Don't aim content at under-13s. |
| 7 | **Mastodon + Lemmy** | Small, friendly, privacy-minded | 1–3 | Hashtags on Mastodon. Lemmy c/selfhosted wants an account 30+ days old, active participation, and [CBH]/[AIP] AI tags[^lemmy]. |
| 8 | **Self-host app catalogs** (Unraid CA, CasaOS, Umbrel, Coolify, Dokploy) | Steady installs from people browsing their NAS store | 0.5–2 but compounding | Each needs a pullable image and a licence (both done). Expect 1–3 h per catalog with a test install. |
| 9 | **Clubs and groups you're actually in** (university societies, a gaming clan, a hobby group) | One "yes" = a whole server | Unpredictable but high | Talk to the person who runs it, and offer to help set it up. For schools, only adults or university groups: don't recruit minors through K-12 schools, which brings consent and safeguarding problems. |
| 10 | **Comparison listicles** ("best Discord alternatives 2026": TechCrunch[^tcalt], TechRadar[^tr], blogs) | Rarely works cold, but one inclusion lasts for months | 0–5 | A short, personal email with a test account offer. Never pay for inclusion without a "sponsored" label. |
| 11 | **SEO: `discord-alternative.html` and friends** | Slow (months) | Low now, high later | Already built. Add "Cindrly vs Stoat", "Cindrly vs Matrix/Element" and "How to move a Discord server" pages, with honest tables. |
| 12 | **Product Hunt** | Weak fit for self-hosters. Free to list[^ph] | 0–2 | Launch only once the iPhone app is out and the onboarding is smooth (January). Relaunches within about 6 months may be reviewed (*unverified*[^ph2]). |
| — | **r/opensource** | Shut | — | Since 24 Oct 2026: no AI-assisted projects; projects must be 1+ year old with multiple contributors[^ros]. An AI-tolerant r/TrueOpenSource has appeared[^ros] (*unverified* rules; read its sidebar). |
| — | **Privacy Guides** | Shut | — | Lists only tools that meet its criteria, which include forward secrecy for messengers[^pg]. Their community bars self-promotion of unlisted projects[^pgl]. Don't submit. Maybe revisit after the forward-secrecy work in ENCRYPTION-RESEARCH.md. |

---

## 5. Ready-to-post copy for the top 6 channels

Rewrite each one in your own voice before posting: people notice canned text, and HN forbids generated text
outright. Placeholders are in `<angle brackets>`.

### 5.1 Server-owner kit (channel #1) and thread replies (channel #2)

**Message to owners on cindrly.com (in-app DM or the main server's announcements):**

> Hey <name>, I'm the developer of Cindrly, and I saw you made <server>. Thanks! Two things that might help you
> bring people over:
> 1. The **invite dialog** has **Copy a moving announcement for Discord** (after an import), **Copy invite
>    message** and **Share…**. Links show a preview card on Discord, Reddit and X. To show your server's name and
>    member count in it, turn on *Server settings → Overview → Privacy → "Show this server's name and member
>    count in invite link previews"*.
> 2. If your friends are on Discord, **Add a server → Import from Discord** copies the channels and roles from a
>    Discord server template, but not the messages.
>
> What's the one thing stopping your group from moving? I'm one person, so the answer changes what I build
> next.

**The "we're moving" text owners can paste on Discord** (the app's built-in "moving announcement" starts
"We're trying Cindrly… Our channels and roles are already set up". This is a longer version for owners who
want one):

> We're trying out **Cindrly** for <server>: same channels, voice and screen share, but messages are end-to-end
> encrypted, it's free with no Nitro-style paywall, and it never asks for ID. Join here: <invite link>
> (Windows, Mac, Linux, Android, or just the browser.)

**Reply in someone's "what's a good Discord alternative?" thread:**

> Disclosure: I make one of these, so weigh that. Depends what you need:
> - **Stoat** (ex-Revolt): closest to Discord's feel, big community.
> - **Matrix/Element**: federated and mature, heavier to run.
> - **TeamSpeak**: voice first.
> - **Cindrly** (mine): Discord-style servers, voice, video and screen share. Messages are end-to-end
>   encrypted, everything's free, it never asks for ID, and you can import a Discord server's channels and roles.
>   Small and new (no audit yet, and big video calls won't scale). https://cindrly.com, code at
>   github.com/Pandabear445/Hearth-chat
>
> If your group is under ~50 people and you care about encryption, try mine. If you want a big public
> community, Stoat or Matrix is probably the better fit right now.

Naming competitors fairly is what keeps this reply from being spam, and it's more convincing.

### 5.2 r/selfhosted: New Project Megathread comment (channel #3)

Post as a top-level comment in the **current week's** megathread. Check the template pinned in that week's
thread and follow it if it differs.

> **Cindrly**: self-hosted, end-to-end-encrypted Discord alternative for friend groups and small communities
>
> - **Repo:** https://github.com/Pandabear445/Hearth-chat · **Site:** https://pandabear445.github.io/Hearth-chat/
>   · **Public instance to try:** https://cindrly.com (needs an account)
> - **License:** MIT · **Stack:** one Node.js process + SQLite, Docker image on GHCR (amd64 + arm64), no
>   outside services required
> - **What it does:** servers with text and voice channels, roles, threads, DMs and group chats; voice, video
>   and screen share with sound; watch YouTube, Twitch or files together; events, soundboards, scheduled and
>   disappearing messages; import a Discord server's channels and roles from a template. Apps for
>   Windows/Mac/Linux/Android, plus a web app.
> - **Encryption:** messages and files are E2EE in the app (the server stores ciphertext). Calls are
>   DTLS-SRTP peer to peer or through TURN.
> - **Honest limits:** the server sees metadata; you trust whoever serves the web app's JS; no forward secrecy
>   for history; no media server, so big group video won't scale; no independent audit.
> - **AI involvement:** <your true sentence, e.g. "Much of the code was written with an AI coding assistant. I
>   review and test the changes, and CI runs an automated attacker test suite. No human security audit yet.">
> - **Looking for:** people to try the Docker install and tell me what breaks. Recently renamed from Hearth.

### 5.3 AlternativeTo listing (channel #4)

- **Name:** Cindrly · **Website:** https://cindrly.com (or the landing page) · **Licence:** Open source (MIT) ·
  **Price:** Free
- **Platforms:** Windows, Mac, Linux, Android, Web, Self-Hosted (add iPhone when it's live)
- **Alternative to:** Discord, TeamSpeak, Stoat, Element, Guilded
- **Tags:** chat, voice chat, self-hosted, end-to-end encryption, screen sharing, watch together
- **Description:**

> Cindrly is a free, open-source chat app for friend groups and small communities: servers with text and
> voice channels, roles, threads, DMs and group chats, voice and video calls with screen sharing, and watch
> together for YouTube, Twitch and video files. Messages and files are end-to-end encrypted in the app. The
> server stores only encrypted data, though it still sees who talks to whom and when. It never asks for ID or a
> face scan, and every feature works for everyone, with no paid tier for profiles. You can import a Discord
> server's channels and roles from a template. Use the free community server at cindrly.com, or host your own
> with Docker (one Node.js process and SQLite).

### 5.4 Show HN (channel #5): title and outline; the text must be yours

HN's guidelines now forbid generated or AI-edited comments[^hnai], and moderators have said generated text
isn't allowed on the site. So this is an outline, not a body. Writing it yourself is also what makes it work.

**Title:** `Show HN: Cindrly – an end-to-end encrypted, self-hostable Discord alternative`

**Link:** the GitHub repo (not the sign-up page[^showhn]).

**Your text, about 150–250 words, covering:**
1. What it is and who it's for, in one sentence.
2. Why you built it: your story, two sentences.
3. How to try it: `docker compose -f deploy/compose.image.yml up -d`, or the public instance (needs an account).
4. Encryption in two lines, plus the limits: metadata, server-served JS, no forward secrecy for history.
5. Stack: Node, Express, Socket.IO, SQLite, vanilla JS, WebRTC, Electron, Capacitor.
6. How it's built: AI involvement, tests, no audit. Say it first.
7. What feedback you want.

**Answers to have ready (in your words):** why not Matrix; how it's E2EE if the server serves the JS; "was this
vibe-coded?"; what the server sees; MIT vs AGPL; why the rename.

### 5.5 Short-form video (channel #6): three scripts

There were no existing ad scripts in the repository (I searched the rename tree and the main repo), so these
are new. 20–35 seconds each, vertical, screen recording plus your voice or captions. Show the real app.
Caption every video "I made this" and link the site in your bio.

**Video 1: "Move your Discord server in 2 minutes"**
- 0–3 s, on-screen text: *"I made a Discord alternative that never asks for your ID"*
- 3–15 s: screen recording of Add a server → Import from Discord → channels and roles appear. VO: "Paste a
  Discord server template, and your channels and roles are here. Not your messages, just the structure."
- 15–25 s: hop into voice, share the screen. VO: "Voice, screen share, and messages are end-to-end encrypted."
- 25–30 s: "Free, open source, cindrly.com. I'm one developer, so tell me what's broken."

**Video 2: "Watch together"**
- 0–3 s: two phones side by side playing the same video in sync. Text: *"Watch YouTube with your friends, in
  sync, in a voice call"*
- 3–20 s: paste a link, the queue builds, someone joins late and jumps to the same moment.
- 20–30 s: "No Nitro, no paywall, every feature free. Cindrly, link in bio."

**Video 3: "Why I don't want your ID" (talking head, honest)**
- "Discord started age checks worldwide in September. Most people get sorted automatically, but if you're not,
  it's a selfie scan or your ID. And last year one of Discord's support vendors leaked about 70,000 ID photos.
  I'm building Cindrly so there's no ID database to leak: it just never asks. Messages are end-to-end
  encrypted, it's free and open source. It's small and new, so come break it."
- Pin a comment with the two sources (TheNextWeb and CyberInsider links from section 11).
- Don't pitch it as a way for kids to dodge age checks: the Terms say 13+.

### 5.6 Listicle and creator outreach email (for #10 and the YouTube channels)

> **Subject:** Cindrly for your Discord alternatives list (open source, E2EE, free)
>
> Hi <name>, I read your <article/video> on <title>. <One specific thing you liked or noticed.> I make
> **Cindrly**, a free, MIT-licensed Discord alternative: servers, voice, video and screen share, with messages
> end-to-end encrypted in the app, no ID checks, and a Discord server-template import. You can use the public
> server at cindrly.com or self-host with Docker. It's young: no audit yet, and big video calls won't scale. The
> README is upfront about that. If it's a fit for an update, I'm glad to set you up with a test server or answer
> anything. Thanks either way. <your name>

---

## 6. Assets to make once (reuse everywhere)

- 5 screenshots with the **Cindrly** name visible: server view, voice and screen share, watch together, Discord
  import, phone layout. Update `site/*.webp` and the Play screenshots in
  `mobile/fastlane/metadata/android/en-US/images/phoneScreenshots/`.
- A 30-second demo video (cut from the short videos), embedded on the landing page and in the GitHub README.
- `site/og.png` redone with the Cindrly name, so shared invite and landing links unfurl correctly.
- One FAQ list (from the HN answers) reused in the comparison pages.

---

## 7. What to measure, and how to do it privately

**The four numbers that matter, weekly:**
1. **New accounts per week** on cindrly.com.
2. **Invite joins per week:** people who joined a server through an invite. This is the owner flywheel.
3. **Week-1 and week-4 retention:** of the people who signed up in week N, how many came back a week later, and
   a month later.
4. **Servers with 3 or more active members**: the real "community moved here" signal.

Secondary: GitHub stars, clones and referrers (Insights → Traffic, kept for 14 days only, so snapshot weekly),
GHCR image pulls, release download counts per file, Play Console installs, TestFlight testers, and AlternativeTo
likes.

**What the admin dashboard already gives you** (`GET /admin/stats`, Admin → Overview): total users, new
accounts in the last 24 h and 7 d, active in the last 24 h and 7 d, servers, groups, people in voice, and a
14-day chart of messages, new accounts and active people. It counts no bots, has no third-party analytics, and
reads no content. Good.

**Gaps, and private ways to close them:**

| Gap | Why it matters | Private fix |
|---|---|---|
| The "Active people per day" chart counts users whose **last** visit fell on that day (`last_seen_at`). Anyone who came back since moves to today, so past days are undercounted. It's not true daily actives. | You'll read falling activity where there is none. | Keep a tiny daily aggregate table (`date, active_count`) written once a day from the live count. It holds a number, not who. |
| No retention or cohort view | You can't tell if launch-day sign-ups stayed. | A weekly aggregate: for each sign-up week, the count still seen in the last 7 days. Computed from `created_at` and `last_seen_at`, stored as numbers only, and shown as a small table in Overview. No per-user history needed. |
| No total of invite joins | `invites.uses` exists per invite, but there's no total, and deleted or expired invites drop out. | An aggregate counter of invite joins per day (no who, no which invite). |
| History stops at 14 days | A month-long review needs 30+ days. | Extend the series to 90 days, or snapshot the Overview numbers weekly by hand into a spreadsheet. That works today. |
| No sign-up source | You won't know whether HN or TikTok worked. | Don't add tracking (the privacy stance is the pitch). Use **separate invite links per channel** (one for the HN post's "try it" server, one for the TikTok bio, and so on), and read each link's use count. Then ask in onboarding, optionally: "Where did you hear about Cindrly?" (free text or a fixed list, stored as an aggregate count). GitHub referrers cover the repo side. |

Don't add analytics scripts to the landing site. Say publicly that you measure only counts. That's a selling
point.

**Week-4 review question:** for each channel, of the people it brought, how many are in a server with 3 or more
active members? Keep the channels where that number is positive.

---

## 8. Fix before advertising (blocking items first)

| # | Fix | Why | Where |
|---|---|---|---|
| 1 | **Fill in `{{CONTACT_EMAIL}}`** (6 places) | Privacy, child-safety and deletion pages that show a placeholder look abandoned, and Google Play rejects them. Also set the owner contact email in Admin → Owner. | `privacy.html` (2), `child-safety.html` (3), `delete-account.html` (1); ANDROID-STORES.md §4.6 |
| 2 | **Trademark check for "Cindrly"** before printing any assets | Section 9.1 | USPTO, EUIPO |
| 3 | **Finish the domain move** and test old links | Old `kappachat.duckdns.org` invites must forward. DuckDNS names get blocked by school and work filters (*unverified*). | `hearth/docs/MOVE-DOMAIN.md` |
| 4 | **Rename leftovers** | It looks unfinished or fake. The Windows installer is `Hearth-Setup-<version>.exe` while the Mac and Android files say Cindrly. ANDROID-STORES.md tells testers to tap `Hearth-<version>.apk`. The JSON-LD `alternateName` "Hearth" is fine to keep. | `index.html:306`, `hearth/docs/ANDROID-STORES.md`, the electron-builder config |
| 5 | **Repo and site URLs** say `Hearth-chat` | People search GitHub for the name. Consider renaming the repo to `Cindrly` (GitHub redirects the old URL) and moving the landing page to cindrly.com or a subpath, with redirects. | GitHub settings, `index.html` canonical and og tags, `sitemap.xml` |
| 6 | **README honesty block** | "How it's built" (AI), the honest limits, and a screenshot on the first screen. The root README is still vague ("Encrypted messaging features"). | `README.md` |
| 7 | **Store listings** | Play: the title and short description are already Cindrly. Fix the screenshots, the feature graphic and the contact email. iOS: Apple Developer ($99/yr, the only real cost here), App Privacy labels, age rating. | `mobile/fastlane/metadata/...`, IOS-STORE.md |
| 8 | **New-user path** | A first-time visitor from an ad should land on a short page with a working demo server, not a bare sign-in form. Make a public "Cindrly Lounge" server, with mods, as the default invite in all posts. | Admin → Registration & Terms → Main server |
| 9 | **Spike readiness** | Sign-up captcha on, registration can be closed instantly, reports reach you, backups tested. Watch Admin → Health on launch days. | Admin |
| 10 | **Screenshots and OG image with the new name** | Every shared link unfurls with them. | `site/` |

---

## 9. Risks

### 9.1 Trademark: "Cindrly"

- A web search on 9 Nov 2026 found **no existing product called Cindrly**. That's encouraging, but it isn't a
  clearance.
- **Nearby US filings found through third-party aggregators (*unverified*; check USPTO TSDR):** "CINDR" (serial
  99212119, a new application whose owner and goods weren't shown)[^tm1], and "CINDER" (serial 99503303,
  Cinder Coach LLC, classes 9 and 36, filed Nov 2025, pending)[^tm2]. Class 9 covers software, so that one is
  the closest. Also "CINDUR" (Cindur, Inc., mobile app software development, 2017)[^tm3].
- **Tinder's owner has a record of opposing similar "-inder" names**, for example Shinder[^tinder]. "Cindrly" is
  far enough away in spelling and field that it's probably fine, but be aware.
- **Precedent in your exact space:** Revolt renamed to Stoat in October 2025 after a cease-and-desist[^stoat].
- **To do (Day 1, free):**
  1. USPTO search (tmsearch.uspto.gov) for CINDRLY, CINDR*, CINDER* in classes 9, 38 and 42.
  2. The EUIPO and WIPO Global Brand Database for the same.
  3. App Store, Google Play and GitHub name searches.
- If it's clean, consider filing a US application yourself later (fees apply; *unverified* amounts). At least
  keep dated proof of use: the first-commit date and the domain registration in November 2026.
- I'm not a lawyer. If anything close turns up in class 9 or 38, a one-hour consult is cheaper than a second
  rename.

### 9.2 Impersonation, both ways

- **Don't look like Discord:** no Discord logo or "Blurple" mock-ups in ads or thumbnails, and no "Discord 2" or
  "Discord without ID" app names. Naming Discord to compare is fine; looking like Discord isn't. App stores
  reject look-alike listings (*unverified*: check the policy pages).
- **Others impersonating you:** once there's buzz, fake "Cindrly APK" sites can appear. Mitigations:
  - publish the APK's signing-certificate fingerprint on the site (`code-signing.html` already exists);
  - list the official sources in the README and the rename note;
  - claim the handles on Day 2;
  - add a SECURITY.md line on reporting fakes.

### 9.3 Moderation load on a public server with teens

- The Terms and privacy policy say **13+**. Advertising to Discord's audience brings teens, and the age-check
  angle can attract people trying to dodge it. That's another reason not to lead with "no age checks."
- **Before the first big post:**
  - recruit 2–3 trusted moderators for the public Lounge server, in different time zones;
  - turn on the word filter and slow mode in public channels;
  - make sure Admin → Reports alerts reach your phone;
  - write a 1-page moderator playbook: what gets a timeout, ban or account suspension, and how to handle a
    child-safety report.
- **E2EE limits moderation:** staff only see what reporters decrypt and send. Say that in the Terms (check it's
  there), and rely on reports.
- **Legal (*unverified*, check with official sources, not legal advice):**
  - US providers must report apparent child sexual abuse material they learn of to NCMEC (18 U.S.C. § 2258A).
    `child-safety.html` should name the process.
  - COPPA applies to under-13s, which is why you delete those accounts.
  - The UK Online Safety Act puts duties on user-to-user services with UK users, including risk assessments and
    child-safety measures. Ofcom's guidance says what a small service must do.
  - The EU's DSA has light duties for small hosting services, such as a contact point and notice-and-action.
  - Consider limiting promotion to the US and EU at first, and read Ofcom's small-service guidance before
    advertising in the UK.
- **Self-hosted servers are the operator's responsibility.** Say so in the docs, so a third-party instance's
  problems aren't presented as yours.

### 9.4 Other risks

- **The HN or Reddit "vibe-coded E2EE" pile-on:** disclose first, keep the limits list prominent, and thank
  critics. If a real vulnerability is reported, fix it publicly and fast. That becomes good press.
- **Load:** a front-page spike on one VPS. Close registration (one click) if needed, rather than going down.
- **Burnout:** the calendar has rest days. Keep them.

---

## 10. What not to do

- Buy upvotes, swap upvotes, or ask friends to vote or comment (HN and Reddit both detect and penalise this).
- Post Cindrly invite links in other people's Discord servers or DMs.
- Use AI to write HN comments, Reddit posts, or the awesome-selfhosted PR. Their rules forbid it, and it's
  noticeable.
- Claim user numbers you don't have, or say anyone "switched from Discord" without their permission.
- Run paid ads before week-4 retention is known. You'd pay to fill a leaky bucket.

---

## 11. Sources

Searched 9 November 2026. Several are secondary reports, so check the primary page before quoting a detail.
Some hosts (discord.com, digitalcitizen.life, gamedeveloper.com) couldn't be opened from this session, so their
claims come from search summaries.

[^tc1]: TechCrunch, "Discord to roll out age verification next month for full access to its platform", 9 Feb
    2026: https://techcrunch.com/2026/02/09/discord-to-roll-out-age-verification-next-month-for-full-access-to-its-platform/
[^tc2]: TechCrunch, "Discord delays global rollout of age verification after backlash", 24 Feb 2026:
    https://techcrunch.com/2026/02/24/discord-delays-global-rollout-of-age-verification-after-backlash/ ; NBC
    News: https://www.nbcnews.com/tech/tech-news/discord-pushes-back-age-verification-rollout-backlash-rcna260604
[^tnw]: The Next Web, "Discord rolls out global age checks that sort most users automatically" (Sept 2026):
    https://thenextweb.com/news/discord-global-age-checks-teen-default ; Discord press release, "Discord Launches
    Teen-by-Default Settings Globally": https://discord.com/press-releases/discord-launches-teen-by-default-settings-globally
    (also on PR Newswire: https://www.prnewswire.com/news-releases/discord-launches-teen-by-default-settings-globally-302681851.html).
    Reports give the start as 22 or 23 September 2026. Over 90% are sorted automatically, and the UK and
    Australia use separate processes.
[^breach]: CyberInsider, "Discord confirms 70,000 government IDs exposed in third-party breach" (Oct 2025):
    https://cyberinsider.com/discord-confirms-70000-government-ids-exposed-in-third-party-breach/
[^stoat]: Stoat (software), Wikipedia: https://en.wikipedia.org/wiki/Stoat_(software) (renamed from Revolt in
    October 2025 after a trademark cease-and-desist); Windows Central on "Discord alternative" searches:
    https://www.windowscentral.com/software-apps/discord-alternative-search-10000-percent-stoat
[^ros]: Help Net Security, "r/opensource bans AI projects, and solo devs go down with them", 26 Oct 2026:
    https://helpnetsecurity.com/2026/10/26/reddit-r-opensource-ai-ban ; Tom's Hardware:
    https://tomshardware.com/tech-industry/artificial-intelligence/reddits-r-opensource-bans-ai-made-and-ai-focused-projects-also-bans-non-english-speakers-sweeping-new-rules-spark-backlash-over-linux-kernel-contributions-and-solo-developers ;
    Linux Magazine: https://www.linux-magazine.com/Online/News/r-opensource-Bans-AI-Assisted-and-AI-Related-Projects
[^rss]: r/selfhosted wiki, Rule 6 (mirror): https://redlib.groet-infra.nl/r/selfhosted/wiki/rules ; "Rules
    update: New Project Friday here to stay" (6 Mar 2026):
    https://www.reddit.com/r/selfhosted/comments/1rmt39o/rules_update_new_project_friday_here_to_stay/ ; "New
    Project Megathread, week of 28 May 2026":
    https://www.reddit.com/r/selfhosted/comments/1tqhzoo/new_project_megathread_week_of_28_may_2026/
[^rss2]: r/selfhosted Q2 update (7 Apr 2026, mirror): https://redlib.groet-infra.nl/r/selfhosted (the
    megathread template with "AI Involvement"; there's no AI flair).
[^showhn]: Show HN guidelines: https://news.ycombinator.com/showhn.html
[^hnai]: The HN guideline against generated or AI-edited comments, March 2026, as reported:
    https://aitoolly.com/ai-news/article/2026-03-12-hacker-news-updates-guidelines-prohibits-ai-generated-or-edited-comments-to-foster-human-conversatio ;
    check https://news.ycombinator.com/newsguidelines.html
[^lemmy]: lemmy.world c/selfhosted rules (sidebar), as cited in GROWTH.md: https://lemmy.world/c/selfhosted ;
    an example [AIP]-tagged post: https://deddit.petersanchez.com/g/selfhosted@lemmy.world/p/w4639YMTBkbJyPdK9z-Torum--host-a-forum-in-your-pocket
[^pg]: Privacy Guides, real-time communication criteria (forward secrecy) and the forum discussion:
    https://discuss.privacyguides.net/t/require-perfect-forward-secrecy-for-real-time-communications/18944
[^pgl]: Privacy Guides community self-promotion rule (Lemmy, 2023–24 snapshot): https://feddit.it/comment/78500
[^at]: AlternativeTo news, Feb 2026:
    https://alternativeto.net/news/2026/2/discord-is-now-delaying-its-global-age-verification-plans-after-huge-backlash
[^reddit]: Reddit self-promotion guidance summary (2026): https://redship.io/blog/reddit-self-promotion-rules
[^tcalt]: TechCrunch, best Discord alternatives (1 Mar 2026):
    https://techcrunch.com/2026/03/01/best-discord-alternatives-age-verification-identity-privacy
[^tr]: TechRadar on Stoat and Discord alternatives:
    https://www.techradar.com/computing/social-media/so-many-discord-users-are-flocking-to-this-alternative-platform-its-making-stoat-crash
[^ph]: SaaSCity on Product Hunt (free to list, featuring is editorial): https://saascity.io/directories/product-hunt
[^ph2]: Product Hunt launch news, Oct 2026 (blog, *unverified*): https://blog.mean.ceo/?p=11616
[^tm1]: CINDR, serial 99212119: https://trademarks.justia.com/992/12/cindr-99212119.html
[^tm2]: CINDER, serial 99503303: https://trademarkdir.com/trademark/cinder-99503303
[^tm3]: Cindur, Inc. trademarks: https://trademark.justia.com/owners/cindur-inc-3611230
[^tinder]: Tinder opposing Shinder's registration: https://inventa.com/en/news/article/238/tinder-opposes-to-shinder-s-trademark-registration
