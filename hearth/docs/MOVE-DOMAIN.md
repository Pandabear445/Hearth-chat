# Moving the community server to cindrly.com

kappachat moves from `kappachat.duckdns.org` to **`cindrly.com`** (registered at Porkbun, November 2026). It's the
same server on the same machine: only the address changes. The old address keeps working for the apps already
installed, and browsers that open it are sent to the new one, so no link, invite or install breaks.

What changes for people:

- **In a browser:** the old address forwards to `cindrly.com`. They sign in once more there (a browser keeps
  sign-ins and the unlocked keys per address). Nothing is lost: keys come from their password. Notifications have to
  be turned on again, and a "Home Screen" icon from the old address should be added again from the new one.
- **Android and desktop apps already installed:** they keep using the old address, which keeps serving them. To
  move, *Settings → Apps & devices → Switch server* and enter `https://cindrly.com` (the announcement in step 6 says
  so). New installs open `cindrly.com` by themselves.
- **Invite links:** old `kappachat.duckdns.org/invite/…` links forward to the same invite on `cindrly.com`.

## 1. DNS at Porkbun

Porkbun → *Domain Management* → cindrly.com → **DNS**.

1. **Delete** the records Porkbun put there for its parking page (an `ALIAS` or `CNAME` to `pixie.porkbun.com`, and
   any `*` wildcard).
2. Find your server's address: the IP that DuckDNS shows for `kappachat` on duckdns.org (or run
   `ping kappachat.duckdns.org` on your computer).
3. Add:

   | Type | Host | Answer |
   |---|---|---|
   | A | *(blank)* | your server's IPv4 address |
   | A | `www` | the same address |
   | AAAA | *(blank)* and `www` | its IPv6 address, only if it has one (DuckDNS shows it too) |
   | TXT | *(blank)* | `v=spf1 -all` |
   | TXT | `_dmarc` | `v=DMARC1; p=reject;` |

   The two TXT records say "no mail is ever sent from cindrly.com" (Hearth's emails come from the Gmail address),
   which fixes the SPF and DMARC warnings. Keep **WHOIS privacy** on.
4. Wait a few minutes, then check on your computer: `nslookup cindrly.com` should answer with your server's address.

## 2. Caddy (HTTPS for the new name, forwarding from the old one)

On the server, in the Hearth folder, edit `deploy/Caddyfile`. Your file has a block that starts with
`kappachat.duckdns.org {`. Change that first line to `cindrly.com {` and keep everything inside it as it is. Then add
these two blocks at the end of the file:

```
www.cindrly.com {
	redir https://cindrly.com{uri} permanent
}

# The old address: the installed apps keep using it as before; a browser opening a page is sent to cindrly.com.
kappachat.duckdns.org {
	@browserPage {
		header Sec-Fetch-Mode navigate
		not header User-Agent *HearthAndroid*
		not header User-Agent *HearthiOS*
		not header User-Agent *Electron*
	}
	redir @browserPage https://cindrly.com{uri} permanent
	header {
		-Server
		-Via
	}
	reverse_proxy hearth:3000 {
		lb_try_duration 30s
		lb_try_interval 250ms
	}
}
```

(If Hearth runs without Docker, use `localhost:3000` instead of `hearth:3000`, as in your existing block.)

Reload Caddy: `docker compose restart caddy` (or `sudo systemctl reload caddy` without Docker). It gets a free
Let's Encrypt certificate for `cindrly.com` and `www.cindrly.com` within a minute. Check: open
`https://cindrly.com` (padlock, Hearth's sign-in page) and `https://kappachat.duckdns.org` in a browser (it should
land on `cindrly.com`).

## 3. Hearth's settings

1. In `.env` in the Hearth folder: `PUBLIC_URL=https://cindrly.com`. If there's a `TURN_URL` with the old name you can
   leave it (same machine) or change it to `turn:cindrly.com:3478`. Then `docker compose up -d` (or
   `sudo systemctl restart hearth`).
2. **Admin → Owner → Email (password resets) → Your server's address:** `https://cindrly.com`, Save, and send a test
   email (reset links now point to the new address).
3. If `PRIVACY_URL` points at the GitHub Pages site, it doesn't change.

## 4. The apps

GitHub → the repository → *Settings → Secrets and variables → Actions → Variables*: set **`HEARTH_SERVER`** to
`https://cindrly.com`. The next builds open `cindrly.com`, and on Android open `https://cindrly.com/invite/…` links in
the app (App Links), as will the iPhone app (Universal Links). The committed config files already say `cindrly.com`.

## 5. Stores and pages

- The landing page, privacy policy, account deletion and child safety pages already say `cindrly.com` (the privacy
  policy notes the old name); they publish when this is merged into `main`.
- Google Play / App Store: website `https://cindrly.com` in the listing; the review account's instructions say
  `cindrly.com` (docs/ANDROID-STORES.md, docs/IOS-STORE.md).

## 6. Tell everyone

Admin → Security → Broadcast → **Announcement banner** (shown at the top for everyone):

> We've moved to **cindrly.com**. In a browser, sign in there once. In the Android or desktop app: Settings → Apps &
> devices → Switch server → `https://cindrly.com`.

## 7. Keep the old name alive

Keep `kappachat.duckdns.org` pointing at the server (DuckDNS keeps it as long as your account exists; log in to
duckdns.org now and then). Apps installed before the move use it until their owners switch.
