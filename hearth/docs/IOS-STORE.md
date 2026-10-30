# Putting Hearth for iPhone in the App Store

This page takes you, step by step, from "the iPhone app builds on GitHub" to Hearth on **TestFlight** (you and up to
100 friends test it, no review) and then in the **App Store**. You don't need a Mac: GitHub's macOS machines build,
sign and upload the app, and everything you do yourself happens in a browser. You do need an iPhone to test it on.

The plan, in order:

1. [Join the Apple Developer Program](#1-join-the-apple-developer-program) ($99 a year).
2. [Register the app's identifiers](#2-register-the-apps-identifiers) and make the push key.
3. [Update kappachat and give it the push key](#3-update-kappachat-and-give-it-the-push-key).
4. [Let GitHub sign and upload](#4-let-github-sign-and-upload): an App Store Connect API key and four secrets.
5. [Create the app in App Store Connect](#5-create-the-app-in-app-store-connect).
6. [The first TestFlight build](#6-the-first-testflight-build).
7. [Test on your iPhone](#7-test-on-your-iphone).
8. [The store listing and App Review](#8-the-store-listing-and-app-review): privacy labels, age rating, export
   compliance, screenshots, review notes.
9. [Later](#9-later): other servers, calls with the screen locked.

What's already done in this repository:

- **The app.** `hearth/mobile/ios-native/` holds the Swift code: the app around the server's page, a notification
  extension that decrypts each notification on the phone, a share extension, and HearthKit (the shared rules, with
  their own tests). The Xcode project isn't in the repository: the workflow makes it fresh each time
  (`npx cap add ios`, then `scripts/patch-ios.rb`), the same way as Android.
- **The build.** `.github/workflows/hearth-apps.yml`:
  - the `ios` job, on every push: HearthKit's tests, the app built for the iPhone simulator and opened there once
    (its screenshot is the **hearth-ios-simulator-screenshot** artifact);
  - `ios-archive`, for `app-v*` tags and the default branch: the signed `.ipa` (artifact **hearth-ios-ipa**). It
    signs the project the `ios` job made and runs no npm code itself, since it holds the App Store Connect key;
  - `testflight-upload`: sends it to TestFlight. On the default branch the version is the server's
    (`hearth/package.json`), so once App Store Connect has approved a tag's version as high or higher it refuses
    those uploads: that's only a warning there. Tag `app-vX.Y.Z` with a higher version for the next build.
  The `.ipa` is never attached to a GitHub release or copied to your server: only Apple hands it out.
- **One server per app.** The App Store app is built for `HEARTH_SERVER` (kappachat, as `https://host`) and can't
  be switched to another server; without that variable there's no signed iPhone app, and a manual run's *server*
  never changes it. Its notifications come from Apple's push service with your team's key, which only your server
  has (section 9 says what other servers would need).
- **No way to pay in the app**, the same as the Android app (Apple's rules 3.1.1 and 3.1.3): no *Support* window,
  funding card, memberships, `/download` page or APK/EXE links, and the app refuses to open Stripe and Ko-fi pages.
  *Delete account*, *Report*, *Block* and the Terms and Privacy links all stay.

**Marked *(unverified)*:** a rule or label taken from Apple's help pages that couldn't be opened while writing this.
Check it on the real page when you get there. Apple's rules and screens change; this was written in October 2026.

**The contact email** isn't decided yet. Wherever this page says `{{CONTACT_EMAIL}}`, use the address you pick for
Hearth (App Store Connect shows the support address publicly).

---

## 1. Join the Apple Developer Program

1. On your iPhone or a computer, go to <https://developer.apple.com/programs/enroll/> and sign in with your Apple
   Account (two-factor authentication must be on).
2. Enroll as an **individual** (your own name shows as the seller) or as an **organization** (needs a D-U-N-S
   number). Individual is quicker. Pay the **$99 a year**.
3. Once it's active (usually within a day or two), open <https://developer.apple.com/account> → *Membership
   details* and write down your **Team ID**: 10 letters and digits, like `AB12CD34EF`. It isn't secret.

## 2. Register the app's identifiers

All at <https://developer.apple.com/account/resources> (*Certificates, Identifiers & Profiles*).

1. **App Group:** *Identifiers → +* → *App Groups* → description `Hearth`, identifier `group.app.hearth.mobile`.
   The app and its two extensions share their saved server, the shared link and the push keys through it.
2. **The app's ID:** *Identifiers → +* → *App IDs* → *App* → description `Hearth`, *Explicit* bundle ID
   `app.hearth.mobile`. Tick these capabilities:
   - **Push Notifications**;
   - **App Groups** (then *Configure* → tick `group.app.hearth.mobile`);
   - **Associated Domains** (invite links open the app);
   - **Time Sensitive Notifications** (call rings get through Focus).
3. **The two extensions' IDs**, the same way: `app.hearth.mobile.NotificationService` and
   `app.hearth.mobile.ShareExtension`, each with **App Groups** (and `group.app.hearth.mobile` ticked).
   If you skip steps 1 to 3, Xcode's automatic signing tries to make them itself on the first build. Doing it by hand
   means you see what's switched on.
4. **The push key** (for the server, not for GitHub): *Keys → +* → name `Hearth push`, tick **Apple Push
   Notifications service (APNs)**, *Configure* → environment *Production* (or *Sandbox & Production*), key restriction
   *Team scoped*. *Continue → Register → Download*. You get `AuthKey_XXXXXXXXXX.p8` **once**; Apple never shows it
   again. Write down its **Key ID** (the `XXXXXXXXXX`). Keep the file somewhere safe and offline until step 3.

## 3. Update kappachat and give it the push key

The app shows the pages kappachat sends, so App Review sees what kappachat runs. Before the first TestFlight build:

1. Update kappachat to **Hearth 1.43.0 or newer** (the release with iPhone notifications), the way you always do
   (see [the README](../README.md#upgrading-a-server-that-already-has-users)). Older servers still show ways to pay
   and can't send to iPhones.
2. Copy the `.p8` to the server, outside the Hearth folder, readable only by the user Hearth runs as. From your
   computer (PowerShell works): `scp AuthKey_XXXXXXXXXX.p8 you@kappachat.duckdns.org:/tmp/`, then on the server:

   ```
   sudo mkdir -p /etc/hearth
   sudo mv /tmp/AuthKey_XXXXXXXXXX.p8 /etc/hearth/
   sudo chown hearth:hearth /etc/hearth/AuthKey_XXXXXXXXXX.p8   # the user Hearth runs as
   sudo chmod 600 /etc/hearth/AuthKey_XXXXXXXXXX.p8
   ```

   With Docker, mount it read-only into the container (`- /etc/hearth/AuthKey_XXXXXXXXXX.p8:/etc/hearth/AuthKey_XXXXXXXXXX.p8:ro`
   under the service's `volumes:`). Delete your downloaded copy once the server has it, or keep it only in a
   password manager.
3. Add these lines to kappachat's `.env` (your Key ID and Team ID):

   ```
   APNS_KEY_FILE=/etc/hearth/AuthKey_XXXXXXXXXX.p8
   APNS_KEY_ID=XXXXXXXXXX
   APNS_TEAM_ID=AB12CD34EF
   APNS_TOPIC=app.hearth.mobile
   APPLE_APP_IDS=AB12CD34EF.app.hearth.mobile
   PRIVACY_URL=https://pandabear445.github.io/Hearth-chat/privacy.html
   ```

   Leave `APNS_ALLOW_SANDBOX` out. Restart Hearth (`docker compose up -d --force-recreate`, or
   `sudo systemctl restart hearth`). If a firewall limits where the server can connect, allow
   `api.push.apple.com` port 443.
4. Check: `https://kappachat.duckdns.org/api/config` shows `"apnsEnabled":true`, and
   `https://kappachat.duckdns.org/.well-known/apple-app-site-association` shows your app ID. If `apnsEnabled` is
   false, the server's log says why (`push apns_disabled why=…`; see
   [OPERATIONS.md](OPERATIONS.md#8-iphone-notifications-apns)).
5. **Two demo accounts** for App Review, on kappachat: make two accounts (for example `appreview1` and
   `appreview2`), put them in a server with a channel that has a few messages, and DM each other once. Reviewers
   use them to try messages and calls. Write the passwords down for step 8.

The kappachat certificate must be a normal public one (Caddy's Let's Encrypt certificate is): the App Store app
refuses self-signed certificates.

## 4. Let GitHub sign and upload

GitHub needs an **App Store Connect API key** (a different key from the push key) and your Team ID. The details,
and the alternative with your own certificate, are in [SIGNING.md](SIGNING.md#iphone). In short:

1. <https://appstoreconnect.apple.com/access/integrations/api> (*Users and Access → Integrations → App Store
   Connect API*). The first time, *Request Access* and accept. Then *Team Keys → +*: name `GitHub`, access
   **Admin**. *Generate*, then *Download API Key* (once only) and note the **Issuer ID** (above the list) and the
   **Key ID**.
2. On your computer, turn the file into one line of text: PowerShell
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_YYYYYYYYYY.p8"))`, or `base64 -w0 AuthKey_YYYYYYYYYY.p8`
   on Linux.
3. GitHub → your repository → *Settings → Environments → production → Environment secrets*: add
   `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8_BASE64` (that line of text). Then *Settings → Secrets and
   variables → Actions → Variables*: add `APPLE_TEAM_ID` = your Team ID. `HEARTH_SERVER` is already there
   (`https://kappachat.duckdns.org`).
4. Delete the downloaded `.p8` and the text, or keep them only in a password manager.

An Admin key can do anything in your App Store Connect account, so it lives only in the `production` environment,
which only runs for `app-v*` tags and the default branch. Give that environment *required reviewers* (you) if you
want to approve each build.

## 5. Create the app in App Store Connect

<https://appstoreconnect.apple.com/apps> → **+ → New App**:

- Platforms: **iOS**. Name: **Hearth** (if it's taken, something like *Hearth Chat*; the name on the phone stays
  *Hearth*). Primary language: English (U.S.). Bundle ID: `app.hearth.mobile`. SKU: `hearth`. User access: *Full
  Access*.

Then, in the app's pages:

- **App Information:** category *Social Networking* (secondary: *Productivity*), content rights: *No, it doesn't
  contain third-party content* (people's messages are their own; answer honestly if that changes).
- **App Privacy → Privacy Policy URL:** `https://pandabear445.github.io/Hearth-chat/privacy.html`.
- **Pricing and Availability:** *Free*. Countries: all, or leave **France** out at first (see 8.4).

## 6. The first TestFlight build

1. Push to the default branch, or tag a release (`app-v1.43.0`). GitHub → *Actions → Hearth apps*: `ios` builds
   and tests, then `ios-archive` signs and `testflight-upload` uploads. The first `ios-archive` run may take
   longer: Xcode registers whatever step 2 didn't and makes its certificate in Apple's cloud.
2. After 10 to 30 minutes Apple has processed it: App Store Connect → your app → **TestFlight** shows the build
   (version `1.43.0`, build `14300xxx`: the build number always goes up, by the same rule as Android's).
3. **Internal testing:** *TestFlight → Internal Testing → +* → group `Me`, add yourself (and anyone in your team).
   No review. Install **TestFlight** from the App Store on your iPhone, open the invite, install Hearth.
4. **Friends (external testing):** *External Testing → +* → group `Friends`, add their emails or make a public
   link. The first build for external testers goes through a short *Beta App Review* (usually a day). Fill in
   *Test Information* (what to test, the demo account from step 3, your email) first.

If `ios-archive` says *No signed iPhone app*, a secret or `APPLE_TEAM_ID` is missing (step 4). If it fails at
*Archive* with a signing message, the most common causes are a capability not ticked in step 2 or a key without
the Admin role.

## 7. Test on your iPhone

CI proves the app builds, its rules pass their tests and it opens in the simulator. It can't prove that a
notification arrives or that a call survives a locked screen. Try these on the TestFlight build, with a second
account or a friend, and write down anything that doesn't work:

1. **Basics:** sign in; send messages; upload a file and save one (it opens the share sheet: *Save to Files*).
2. **Notifications** (*Settings → Apps & devices → Notifications*, turn them on; iOS asks once):
   - with Hearth closed (swiped away), with the phone locked, and with Hearth open (then Hearth shows its own
     notice instead);
   - a DM and a mention; with *message previews* hidden and with names shown;
   - tapping one opens the right conversation;
   - an incoming call rings (the ring sound, through Focus); one older than two minutes shows *Missed call*.
3. **Calls (the biggest unknown):** start a call, lock the phone, talk for 5 minutes: does audio still go both
   ways? Also answering from the ring notification, Bluetooth headphones, and a phone call coming in during a
   Hearth call. If audio stops when the phone locks, say *keep Hearth open during calls* in the store text.
4. **Links:** an invite link as `hearth://invite/CODE` and as `https://kappachat.duckdns.org/invite/CODE` pasted
   into Notes and tapped; Share → Hearth from TikTok or Instagram (then open Hearth).
5. **No payments:** no *Support*, funding card, memberships or download links; a `ko-fi.com` link in a message
   doesn't open.
6. **Delete account** (*Settings → Security*), **Report** and **Block** work.
7. A new phone restored from a backup asks you to sign in and turn notifications on again (the keys and sign-in
   aren't in backups, on purpose).

## 8. The store listing and App Review

App Store Connect → your app → the version under **iOS App** (*1.0 Prepare for Submission*).

### 8.1 Text

- **Subtitle** (30 characters): `Private chat, calls, your server`.
- **Promotional text / Description:** reuse the Play listing
  ([`../mobile/fastlane/metadata/android/en-US/full_description.txt`](../mobile/fastlane/metadata/android/en-US/full_description.txt)),
  but leave out anything about other app stores, APKs, downloads or ways to pay. Don't promise calls with the
  screen locked unless step 7.3 worked.
- **Keywords:** `chat,messenger,encrypted,private,voice,video,group,server,community,self-hosted`.
- **Support URL:** `https://pandabear445.github.io/Hearth-chat/` (it must show a way to contact you:
  `{{CONTACT_EMAIL}}`). **Marketing URL:** optional.
- **Copyright:** `2026 <your name>`.

### 8.2 Screenshots

Apple needs screenshots for the 6.9" iPhone display (1320 × 2868 or 1290 × 2796). Take them on your iPhone in the
TestFlight build if it's a recent Pro Max; otherwise the `ios` job's simulator screenshot artifact shows how to
make them, and any iPhone's screenshots can be resized to that size. Three to five: a conversation, a server with
channels, a call, Settings → Security. Don't show other people's real messages. Hearth runs on iPad too, so App
Store Connect also asks for 13" iPad screenshots *(unverified: whether it still does when the app isn't
iPad-optimised)*.

### 8.3 App Privacy (the "nutrition label")

*App Privacy → Get Started → Yes, we collect data*, then:

| Data type | Collected? | Linked to the person | Tracking | Purpose |
|---|---|---|---|---|
| Contact info → Email address | Yes (only if they add one, for password reset) | Yes | No | App functionality |
| Contact info → Name | Yes (display name) | Yes | No | App functionality |
| Identifiers → User ID | Yes | Yes | No | App functionality |
| User content → Photos or videos, audio, other content | Yes (avatars and banners aren't end-to-end encrypted) | Yes | No | App functionality |
| User content → Emails or text messages | **No**: end-to-end encrypted, the server can't read them | | | |
| Diagnostics, location, contacts, browsing, purchases, financial info | No | | | |

Apple counts data as *not collected* only when it's end-to-end encrypted so that you can't read it
*(unverified wording)*. If anything in the privacy policy says otherwise, follow the policy and update the label.

### 8.4 Export compliance (encryption)

When TestFlight or App Store Connect asks about encryption:

- *Does your app use encryption?* **Yes.**
- *Does it qualify for any of the exemptions?* **Yes**: it only uses standard encryption (AES-GCM, ECDH, ML-KEM,
  TLS) in an app sold to the general public (Category 5 Part 2, EAR §740.17(b)(1), *mass market*).

The app already says `ITSAppUsesNonExemptEncryption = NO`, so TestFlight stops asking on every build. Since 2021 no
yearly self-classification report is needed for mass-market items. **France** may ask for a declaration to ANSSI
before distribution there: either file it, or leave France out of *Pricing and Availability* at first. This is a
risk to check, not legal advice.

### 8.5 Age rating

Answer the questionnaire honestly. Hearth has unrestricted chat with people's own content and links: tick that it
has **user-generated content** and **messaging or chat**. Expect **13+** or higher *(unverified: Apple's 2025
ratings)*.

### 8.6 App Review information

- **Sign-in required:** yes. Username and password of `appreview1` (step 3), and in the notes the second account.
- **Contact:** your name, phone and `{{CONTACT_EMAIL}}`.
- **Notes** (paste and edit):

  ```
  Hearth is an end-to-end encrypted chat app (messages, voice and video calls) for communities that run their own
  server. This build connects to the publisher's server, kappachat.duckdns.org; the interface is that server's own
  web page, shown in WKWebView.

  Demo accounts: appreview1 / <password> and appreview2 / <password>. They share a server with a channel, and a DM.
  To test a call, sign in to the second account on another device or at https://kappachat.duckdns.org.

  Native features:
  - Notifications through APNs, decrypted on the device by a Notification Service Extension: Apple's payload only
    says "New message"; who and where are end-to-end encrypted to keys the phone generated.
  - Incoming calls ring as Time Sensitive notifications with their own sound (calls only; messages are "active").
  - A Share Extension: share a TikTok or Instagram link to Hearth.
  - Invite links open the app (hearth:// and Universal Links).
  - Saving files uses the system share sheet; saved files show in the Files app.
  - Background audio is used only while a voice or video call the user joined is going on.

  Account deletion: Settings > Security > Delete account.
  Reporting: a message's menu > Report message (or a user's menu > Report); moderators review reports.
  Blocking: a user's menu > Block. The Terms (accepted at sign-up) forbid objectionable content and abusive users.
  There are no purchases or payments in the app.
  ```

### 8.7 Submit

Choose the TestFlight build under *Build*, then *Add for Review → Submit*. Review usually takes one to three days.

What reviewers tend to check, and where Hearth stands:

| Guideline | The risk | Hearth |
|---|---|---|
| 4.2 Minimum functionality | "Just a website in an app" | The native features in the notes above. If rejected, reply pointing at the notification extension and the share extension; one more native feature (a native settings screen, a Live Activity for calls) is the fallback. |
| 2.1 Completeness | Reviewers can't sign in or the server is down | Two demo accounts; kappachat up to date and running during review. |
| 5.1.1(v) Account deletion | Must be in the app | *Settings → Security → Delete account*. |
| 1.2 User-generated content | Needs terms, filtering, reporting, blocking, contact | Terms at sign-up, Report → reports inbox, Block, moderators who remove messages and suspend accounts, a contact address on the support page. The Terms must say there's zero tolerance for objectionable content and abusive users. |
| 3.1.1 / 3.1.3 Payments | Memberships or tips outside in-app purchase | All hidden in the app; payment pages blocked. |
| 2.5.2 Downloaded code | The interface comes from a server | It's the publisher's own server's UI, shown in WKWebView, not a store of apps or plugins. |
| 2.5.4 Background modes | `audio` needs a reason | Only while a call is going on. |

## 9. Later

- **Other servers.** The push key belongs to your Apple team, so only your server can notify iPhones. Other
  servers say `apnsEnabled: false`, and the App Store app is locked to kappachat for that reason. Supporting other
  servers needs a relay you run (their pushes are already encrypted to the phone, so the relay learns nothing) and
  an app that can switch servers.
- **Calls with the screen locked.** If step 7.3 shows WebKit stops the microphone in the background, the real fix
  is native calls: CallKit and PushKit with WebRTC in Swift. That's a large piece of work.
- **Each spring Apple raises the minimum Xcode and SDK for uploads.** When a new Xcode comes out, update `runs-on`
  and the Xcode line in the `ios` jobs, and check a build still goes through.
- **If a review asks for more native features**, a Live Activity for calls or a native settings screen are the
  smallest useful ones.

## Sources

- Apple: [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
  [App Privacy details](https://developer.apple.com/app-store/app-privacy-details/),
  [export compliance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations),
  [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications),
  [TestFlight](https://developer.apple.com/testflight/),
  [token-based APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
  [App Store Connect API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
