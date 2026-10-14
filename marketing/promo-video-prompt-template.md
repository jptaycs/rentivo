# Promo video prompt template (reusable for any project)

This is the same recipe that produced `host-promo-video.html` for Rentivo, generalised for any product. There are three steps, and each one is a prompt you paste into Claude chat.

1. **Script prompt.** Claude writes the voiceover script and storyboard from your product facts.
2. **Record the voiceover** (ElevenLabs or your own voice), then get its timestamps.
3. **Video prompt.** Paste it with the MP3 and logo files attached, and Claude builds the video as a single HTML file.

Fill in everything in `{{double braces}}`.

---

## Step 1: Script prompt

```
Write a voiceover script and storyboard for a {{60–80}}-second vertical (9:16) motion-graphics promo video.

Product: {{PRODUCT NAME}} — {{one-sentence description}}
Website / call-to-action link: {{URL}}
Tagline: {{TAGLINE}}
Audience: {{who the video is for, e.g. "small café owners in Cebu"}}
Goal: {{what the viewer should do after watching, e.g. "sign up free"}}
Tone: {{e.g. warm, upbeat, simple; light Taglish okay / plain English only}}

Facts you may state (use ONLY these, word them simply):
- {{fact 1}}
- {{fact 2}}
- {{fact 3}}
- {{...}}

Never say or imply: {{false or risky claims to avoid, e.g. guaranteed income, features that don't exist yet}}

Structure it as 9–12 scenes: Hook → Problem → Introduce {{PRODUCT}} → one scene per key benefit → Trust → Call to action → End card.
For each scene give: the scene name, one or two short voiceover lines (≤ 20 words, easy to say aloud, no symbols a voice would misread; write "dot" in URLs), and a one-line visual idea that can be drawn as simple flat icons.
Then give the full voiceover as one clean block of text I can paste into a text-to-speech tool.
```

---

## Step 2: Record and time the voiceover

1. Paste the clean voiceover block into ElevenLabs (or record it yourself). Export it as an MP3.
2. Get the timestamp of each line. Use whichever option is easiest:
   - **Option A:** ask Claude Code: *"Transcribe `<path to mp3>` with timestamps and give me scene start/end times and caption cues"*. It can run Whisper locally.
   - **Option B:** play the MP3 and note when each line starts, to the nearest 0.1s.
   - **Option C:** skip timing. Claude estimates the cues from word count. The sync will be looser.
3. Spell out letter-heavy words for the voice ("Q-R Ph", "rentivo dot live"). Keep the correct spelling in the captions.

---

## Step 3: Video prompt (attach the MP3 and your logo files)

```
I've attached my voiceover file, {{voiceover.mp3}} ({{DURATION}} seconds), and my logo files. Create a vertical (9:16, 1080×1920 design, scales to any screen) motion-graphics promo video for {{PRODUCT NAME}}, built as a single self-contained HTML artifact that plays this voiceover with synchronized animation, captions, background music and sound effects. Total length: about {{DURATION + 3}} seconds (voiceover plus a 3-second end card). Audience: {{AUDIENCE}}.

## Brand
- Name: {{PRODUCT NAME}}. Tagline: "{{TAGLINE}}". Website / CTA: {{URL}}
- Colors: primary {{#HEX}}, accent {{#HEX}}, background {{#HEX}}, success {{#HEX}}. {{Any contrast rule, e.g. "accent only on dark backgrounds"}}
- Font: {{FONT}} (Google Fonts) or system-ui. Bold, oversized headlines. Clean and minimal, with rounded cards (16px), soft shadows and smooth ease-in-out motion.
- {{Currency / number format if relevant}}
- Logo: I've attached {{list each file + where to use it, e.g. "logo-dark.png for light scenes, logo-light.png for dark scenes, icon.png as corner watermark"}}. Use them; don't redraw the logo in a different style. If you can't embed the attached images, recreate the logo faithfully as inline SVG: {{describe the logo shape}}.
- Signature logo animation: {{e.g. "the icon spins in, then the letters slide in from the left"}}. Use it for the product reveal and the call to action.

## Voiceover and sync (the most important part)
- Play my attached MP3 with an <audio> element, embedded as a base64 data URI so the file is fully self-contained. If you can't embed it, add a visible "Load voiceover" file picker on the start screen (URL.createObjectURL).
- The voiceover is the master clock. Drive every scene change and caption from audio.currentTime (requestAnimationFrame loop), NOT from independent timers. Pausing, resuming, seeking and restarting the audio must pause, resume, seek and restart the animation.
- Do NOT use speechSynthesis.
- Start screen: a big "▶ Play" button, because browsers block audio until the viewer taps.

### Scene timeline (seconds in the MP3)
| Scene | Start | End |
|---|---|---|
| 1 {{name}} | 0.00 | {{t}} |
| 2 {{name}} | {{t}} | {{t}} |
| ... | | |
| End card (music only) | {{DURATION}} | {{DURATION + 3}} |

### Caption cues (large animated captions near the bottom; social videos are often watched muted)
```
0.00  {{line}}
{{t}}  {{line}}
...
{{DURATION}} (clear caption)
```
Each caption stays until the next cue. Highlight the key word of each line in the accent color.

## Visuals per scene
1. {{Scene name}}: {{what to draw and animate; tie a beat to a timestamp, e.g. "a big FREE stamp at 19.6s"}}
2. ...
End card: logo, {{URL}}, {{one-line summary}}. Music fades out.

## Music and sound effects
- Generate an upbeat, warm, modern {{genre}} music bed with the Web Audio API (soft kick, claps, a bright chord progression, simple melody) at about {{BPM}} BPM. Keep it at about 20% loudness relative to the voice; let it rise in pauses and over the end card, then fade out.
- Subtle synthesized sound effects (Web Audio): a whoosh on scene transitions, a soft pop when cards appear, plus {{signature sounds tied to moments, e.g. "a ding at 31.5s, a cha-ching at 65s"}}.

## Technical requirements
- One HTML file. Animate with CSS and/or GSAP from cdnjs.cloudflare.com. No external images except the attached logos: draw every icon, device mockup and illustration in inline SVG.
- Controls: Play/Pause, Restart, Mute music (voice stays on), plus a "Record mode" toggle that hides every control and starts after a 3-second countdown, so I can screen-record a clean vertical video for Reels, TikTok and Facebook.
- Seeking or restarting jumps straight to the right scene and caption.
- 16px safe margin; keep text out of the top 12% and bottom 15% of the frame (social-app UI covers those).

## Do NOT show or say
{{Same never-say list as Step 1}}

Make it polished: staggered entrances, a subtle parallax float on the icons, kinetic typography on key words, and one consistent transition style between scenes. When you're done, tell me how to screen-record it in Record mode with sound on an iPhone, Android and a Mac.
```

---

## Turning it into an MP4

Open the HTML file in a browser and turn on **Record mode**. Screen-record with sound on one of these:

- **Mac:** QuickTime → New Screen Recording, or ⇧⌘5. Pick the internal-audio option, or use a tool like Loopback.
- **iPhone:** Control Center → Screen Recording.
- **Android:** the built-in screen recorder, set to record media sound.

Trim the recording, then post it.
