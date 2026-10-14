I've attached my voiceover file, rentivo_voiceover_jessica.mp3 (80.6 seconds, mono). Create a vertical (9:16, 1080×1920 design, scales to any screen) motion-graphics promo video for my startup Rentivo, built as a single self-contained HTML artifact that plays this voiceover with synchronized animation, captions, background music and sound effects. Total length: about 84 seconds (80.6s of voiceover plus a 3-second end card). Audience: Filipino camera, lens and smartphone owners whom we're inviting to become hosts.

## Brand
- Name: Rentivo. Tagline: "Rent Smarter. Create More."
- Website: rentivo.live. Host signup: rentivo.live/host/new
- Colors: primary navy #003049, cream accent #FDF0D5, white #FFFFFF, success green #22C55E. Use cream only on navy backgrounds, never as text on white.
- Font: Inter (Google Fonts) or system-ui. Bold, oversized headlines. Clean and minimal, with rounded cards (16px), soft shadows and smooth ease-in-out motion.
- Currency: Philippine Peso, e.g. "₱2,500/day".
- Logo: I've attached three files. Use them; don't redraw the logo in a different style.
  - rentivo-logo.png: navy "RENTIVO" wordmark on white, where the final "O" is a camera aperture/shutter icon. Use it on white or light scenes.
  - rentivo-logo-beige.png: the same wordmark in cream (#FDF0D5) on a transparent background. Use it on navy scenes (scene 3 reveal, scene 11, end card).
  - rentivo-mark.png: the aperture icon alone, cream on a navy rounded square. Use it as a small corner watermark and as the opening element.
  - If you can't embed the attached images, recreate the wordmark faithfully: "RENTIV" in a bold, wide geometric sans-serif (uppercase, generous letter spacing), followed by a circle containing a six-blade camera aperture as the "O", drawn in inline SVG.
- Signature logo animation: the aperture "O" spins open like a camera shutter, then the letters R-E-N-T-I-V slide in from the left. Use this for the scene 3 reveal (13.55s) and again in scene 11.

## Voiceover and sync (the most important part)
- Play my attached MP3 with an <audio> element. If you can't embed the attached file directly, add a visible "Load voiceover" file picker on the start screen that loads it with URL.createObjectURL, so I can pick the MP3 from my device.
- The voiceover is the master clock. Drive every scene change and caption from audio.currentTime (requestAnimationFrame loop or timeupdate), NOT from independent timers, so the visuals can never drift from the voice. Pausing, resuming and restarting the audio must pause, resume and restart the animation.
- Do NOT use speechSynthesis. The voice is the MP3.
- Start screen: a big "▶ Play" button, because browsers block audio until the viewer taps.

### Scene timeline (seconds in the MP3)
| Scene | Start | End |
|---|---|---|
| 1 Hook | 0.00 | 6.10 |
| 2 Problem | 6.10 | 13.55 |
| 3 Introducing Rentivo | 13.55 | 19.70 |
| 4 Free to list | 19.70 | 29.60 |
| 5 You're in control | 29.60 | 34.25 |
| 6 Secure payment | 34.25 | 43.95 |
| 7 No double bookings | 43.95 | 48.90 |
| 8 Keep your full rate | 48.90 | 54.45 |
| 9 Trust and safety | 54.45 | 63.60 |
| 10 Get paid | 63.60 | 72.00 |
| 11 Call to action | 72.00 | 80.60 |
| End card (music only) | 80.60 | 83.60 |

### Caption cues (show each as a large animated caption near the bottom; social videos are often watched muted)
```
0.00  Your camera is sitting in a drawer right now.
2.84  What if it could earn for you while you're not using it?
6.00  Renting out gear through chats and group posts is hard.
9.48  Endless messages, payment screenshots, and double bookings.
13.48 Meet Rentivo, the Philippine marketplace
16.16 made only for renting cameras, lenses, and smartphones.
19.60 Listing is free.
21.04 No listing fee, no monthly fee.
24.12 Add your photos, set your own daily rate,
26.60 and add weekly or monthly rates if you like.
29.60 You approve or decline every booking request.
32.48 Instant Book is optional.
34.24 Renters pay online through QR Ph, using GCash, Maya,
38.60 or any bank app, before the booking is confirmed.
41.96 No more chasing screenshots.
43.92 Confirmed bookings block your calendar automatically,
46.64 so the same dates are never booked twice.
48.84 You keep 100% of the rate you set.
51.76 The renter pays a small service fee on top.
54.44 Every host is verified with a government ID.
57.44 Your exact pickup point is shown
59.08 only after you confirm a booking,
60.96 and reviews go both ways.
63.64 After the rental is done,
65.00 Rentivo sends your earnings to your GCash, Maya,
68.36 or bank account, with a payout statement by email.
72.00 Turn idle gear into income.
74.24 List your camera free today at rentivo.live.
77.48 Rentivo. Rent smarter, create more.
80.60 (clear caption)
```
Each caption stays on screen until the next cue. Highlight the key word in cream on navy or navy on white ("FREE", "approve", "QR Ph", "automatically", "100%", "verified", "earnings", "rentivo.live").

## Visuals per scene
1. Hook: navy background; a camera with a shutter flash at 0.0s; a lens and a phone float in.
2. Problem: gear icons with a dusty "unused" tag; a messy stack of chat bubbles piles up as "endless messages" is said (≈9.5s).
3. Introducing Rentivo: logo reveal at 13.5s, tagline, soft cream glow; three icons (camera, lens, phone) pop in at 16.2s.
4. Free to list: phone mockup; a big "FREE" stamp at 19.6s, then the screen fills in: photos (24.1s) → price field "₱2,500/day" → weekly/monthly chips (26.6s).
5. You're in control: a booking-request card with Accept / Decline; Accept glows green with a "ding" at ≈31.5s; an "Instant Book: optional" toggle at 32.5s.
6. Secure payment: a renter's phone scans a QR Ph code; GCash, Maya and bank-app chips appear at 34.2–38.6s; a green check at ≈41s; crossed-out screenshot icons at 42s.
7. No double bookings: a calendar where booked dates lock with a padlock one after another.
8. Keep your full rate: a price card "Your rate ₱2,500 → You receive ₱2,500" with a big "100%" at 48.9s; a small note "Renter pays a small service fee on top" at 51.8s.
9. Trust and safety: an ID card plus selfie with a "VERIFIED" badge (54.4s); a map with a soft approximate-area circle that turns into an exact pin only after a "Confirmed" tag appears (57.4–61s); stars and two-way review bubbles (61s).
10. Get paid: gear returned (63.6s) → peso coins flow into a phone wallet with a "cha-ching" (65s) → a "Payout statement" email/document slides in (68.4s).
11. Call to action: navy background, big logo, "rentivo.live/host/new" in large type and a cream button "List your gear free" (74.2s); tagline at 77.5s.
End card (80.6–83.6s): Rentivo logo, "rentivo.live", "Cameras · Lenses · Smartphones · Nationwide PH". Music fades out.

## Music and sound effects
- Generate an upbeat, warm, modern lo-fi/pop music bed with the Web Audio API (soft kick, claps, a bright chord progression, simple melody) at about 110 BPM. Keep it low under the voice (about 20% loudness relative to the voiceover) so every word stays clear. Let it rise slightly during the gaps around 62.6–63.6s and over the end card, then fade out by 83.6s.
- Synthesized sound effects (Web Audio), kept subtle: a whoosh on each scene transition, a soft "pop" when cards appear, a camera-shutter click at 0.0s, a "ding" at the Accept moment (≈31.5s), and a coin "cha-ching" at 65s.

## Technical requirements
- One HTML file. Animate with CSS and/or GSAP from cdnjs.cloudflare.com. No external images: draw cameras, lenses, phones, calendar, QR code, map, ID card, chat bubbles, peso coins and a phone mockup in inline SVG.
- Controls: Play/Pause, Restart, Mute music (voice stays on), plus a "Record mode" toggle that hides every control and starts the video after a 3-second countdown, so I can screen-record a clean vertical video for Instagram Reels, TikTok and Facebook.
- Seeking: if I scrub or restart, jump to the scene and caption for that timestamp immediately.
- Respect a 16px safe margin and keep text away from the top 12% and bottom 15% of the frame (social-app UI covers those).

## Do NOT show or say
Insurance, damage protection, or any claim that Rentivo covers loss or theft; guaranteed bookings, renter counts or earnings figures; instant payouts or a payout schedule; card checkout; drones, laptops or anything that isn't a camera, lens or smartphone.

Make it polished: staggered entrances, a subtle parallax float on the gear icons, kinetic typography on key words, and one consistent transition style between scenes. When you're done, tell me how to screen-record it in Record mode with sound on an iPhone, Android and a Mac.
