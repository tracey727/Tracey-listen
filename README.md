# GENEVIEVE LISTENS™ — Tracey

**Canonical voice-first LISTENS repository.** The older `Genevieve-listens-` copy has the same application logic but lacks the later locked GA brand master and is retained only for integration/reference history.

A private, voice-first crisis-support and clinician-handover PWA built around Tracey's stated needs and observed patterns.

## What is working

- Elegant tap-to-record voice check-ins; no typing required.
- Audio saved locally in IndexedDB.
- Automatic browser speech transcription when available.
- Rule-based recognition of personal triggers, reactions, dissociation and suicidal-thought language.
- Spoken Genevieve response using the device voice.
- Safety check with direct 000 and Lifeline actions.
- Ninety-second settle pathway designed not to force face or torso contact.
- Voice record, pattern counts, “helped / not enough” learning feedback.
- One-tap clinician handover download.
- Voice-based promise/callback record.
- Private backup including audio data.
- Offline PWA after first successful load.
- Static GitHub + Cloudflare Pages deployment; no API keys and no server required.

## Important limits

- This is a support and documentation tool, not a psychologist or emergency service.
- The app cannot automatically contact a clinician or trusted person.
- Browser transcription availability varies. Audio recording still works when transcription does not.
- Data is stored on the device/browser. Clearing site data or using Private Browsing can remove it. Use backups.
- Backup JSON is not encrypted. Store it privately.

## Deploy

This static app uses the ON TRACK by TRACE platform direction: **GitHub + Cloudflare Pages**.

- Connect this repository to Cloudflare Pages.
- Build command: none.
- Output directory: repository root.
- No environment variables are required.
- The root `_headers` file preserves the microphone, content-type, referrer and service-worker cache headers that were previously carried by the legacy Vercel configuration.

For microphone access, use the secure Cloudflare HTTPS address and approve the browser microphone prompt.

## Locked GA brand master

- The official GA emblem supplied by Tracey on 29 July 2026 is archived unchanged as `GA-MASTER-LOCKED-2026-07-29.jpeg`.
- SHA-256: `d7962297cc049ff7a91d6df5d82c7b1a2a83dd93e65dc41d982ab4fcb86527ba`
- The app header, browser favicon and phone/PWA icons now use this master.
- `GA-BRAND-MASTER-LOCK.md` records the non-alteration rule.
