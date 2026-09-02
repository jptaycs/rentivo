# On-Device ID Upload Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject verification uploads that plainly are not an ID and a selfie, in the browser, before they reach the admin queue — and flag the ones that get through under an override.

**Architecture:** One lazy-loaded face-detection model (MediaPipe, self-hosted) behind a single shared module, `src/lib/id-validation.ts`, used by both upload call sites. A failed check blocks; a second failure offers an override that records a flag on the request, which the admin queue surfaces.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, `@mediapipe/tasks-vision@1.0.1`, hosted Supabase.

**Spec:** `docs/superpowers/specs/2026-09-02-id-upload-validation-design.md`

## Global Constraints

- **This is NOT a security control and must never be described as one.** It runs client-side; anyone crafting a raw PostgREST request bypasses it, and the `auto_check_failed` flag is client-supplied and therefore untrustworthy. It eliminates honest mistakes and gives the reviewer a triage signal. **The `/admin` human review remains the actual gate.** Any copy or comment implying otherwise is a defect.
- **The rule is "at least one face", never "exactly one".** The selfie field is labelled *"Selfie with ID"*, so a correctly-taken photo contains two faces — the holder's, plus the portrait printed on their document. An exactly-one rule rejects every properly-taken selfie.
- **Model assets are served from `'self'`.** Never fetch the WASM or `.tflite` from a CDN: this project's CSP forbids it, and a third party must not receive a request correlated with an ID upload.
- **A detector that cannot run returns `{ ok: true, degraded: true }`, never `ok: false`.** A validator that locks users out when it breaks is worse than no validator.
- Resolution floor: **600 px on the long edge**. Existing type/size checks (JPG/PNG/WebP/AVIF, 10 MB) stay.
- `#FDF0D5` is a BACKGROUND-only cream accent; never a text or icon colour. Flag UI uses amber tokens.
- This project has **no unit test suite** and this plan does not add one. Verification is live/browser, following AGENTS.md's e2e pattern. Every task writes its check first, runs it, watches it fail for the right reason, then implements.
- Scratch scripts and downloaded fixtures go in the scratchpad, never the repo.
- `npm run build` and `npm run lint` must exit 0 before every commit. One commit per task.

---

## File Structure

**Created**
- `src/lib/id-validation.ts` — the only place face-detection logic lives; both call sites import it so they cannot drift
- `public/models/` — self-hosted MediaPipe WASM + `blaze_face_short_range.tflite`
- `supabase/migrations/041_verification_auto_check.sql`

**Modified**
- `next.config.ts` — `'wasm-unsafe-eval'` in `script-src`
- `src/components/host/Step6Verify.tsx` — validate on select, inline error, override, drop `.pdf`
- `src/components/shared/VerificationCard.tsx` — same three changes
- `src/hooks/useVerification.ts` — `submit()` carries the flag
- `src/components/host/ListingWizard.tsx` — wizard's own insert carries the flag
- `src/types/index.ts` — `VerificationRequest` gains the two columns
- `src/app/admin/verifications/page.tsx` — flagged-row banner
- `AGENTS.md` — record the feature and its non-security nature

---

## Task 1: Validation module, self-hosted model, and CSP

**Files:**
- Create: `src/lib/id-validation.ts`, `public/models/`
- Modify: `next.config.ts:12`, `package.json`
- Verify: browser harness page (temporary) + scratchpad fixtures

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type ValidationCode = 'no_face' | 'too_small' | 'unreadable'
export type ValidationResult =
  | { ok: true; degraded?: boolean }
  | { ok: false; code: ValidationCode; reason: string }
export function validateIdDocument(file: File): Promise<ValidationResult>
export function validateSelfie(file: File): Promise<ValidationResult>
export const MIN_LONG_EDGE_PX = 600
```

- [ ] **Step 1: Get the real fixtures — the actual regression case**

The two Canon G7X files that caused this work are still in the `verification-docs` bucket. Download them to the scratchpad; they are the acceptance test.

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
const H={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const SC='/private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/98222d30-7b21-4625-a9be-8071f9a9496b/scratchpad/';
(async()=>{
 for (const [n,p] of [['bad-id','c38111b3-9922-4d18-9ae9-a12c8ffb9c68/id-1788280614739.png'],
                      ['bad-selfie','c38111b3-9922-4d18-9ae9-a12c8ffb9c68/selfie-1788280614739.png']]){
   const s=await (await fetch(url+'/storage/v1/object/sign/verification-docs/'+p,{method:'POST',headers:H,body:JSON.stringify({expiresIn:600})})).json();
   const b=Buffer.from(await (await fetch(url+'/storage/v1'+s.signedURL)).arrayBuffer());
   fs.writeFileSync(SC+n+'.png',b); console.log(n,b.length,'bytes');
 }
})();
"
```

You also need three more fixtures in the scratchpad. Create them however you like (a real ID photo you have rights to, or a clearly-labelled synthetic one):
- `good-id.jpg` — any photograph containing a human face, standing in for an ID portrait
- `good-selfie.jpg` — a photo containing **two** faces, standing in for a person holding an ID that bears a portrait
- `tiny.png` — any image whose long edge is under 600 px

- [ ] **Step 2: Install the detector and self-host its assets**

```bash
npm install @mediapipe/tasks-vision@1.0.1
mkdir -p public/models
```

Copy the vision WASM bundle out of the package into `public/models/`, and download the face-detector model beside it:

```bash
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js public/models/
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm public/models/
curl -L -o public/models/blaze_face_short_range.tflite \
  https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
ls -lh public/models/
```

Record the actual byte sizes in your report. If the package's `wasm/` directory has different filenames in this version, use the real ones and say so — do not guess. The download is a one-time authoring-step fetch; at runtime everything is served from `'self'`.

- [ ] **Step 3: Write the validation module**

Create `src/lib/id-validation.ts`:

```ts
'use client'

import type { FaceDetector } from '@mediapipe/tasks-vision'

/** Long-edge floor, so a thumbnail or icon can't pass on a technicality. */
export const MIN_LONG_EDGE_PX = 600

export type ValidationCode = 'no_face' | 'too_small' | 'unreadable'

export type ValidationResult =
  | { ok: true; degraded?: boolean }
  | { ok: false; code: ValidationCode; reason: string }

let detectorPromise: Promise<FaceDetector | null> | null = null

/**
 * Lazily builds the detector, once per page. Returns null (never throws) if the
 * model can't load — an old browser, a blocked asset, WASM unavailable. Callers
 * turn null into a degraded pass rather than blocking the user.
 */
async function getDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision')
        const fileset = await vision.FilesetResolver.forVisionTasks('/models')
        return await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite' },
          runningMode: 'IMAGE',
        })
      } catch (err) {
        console.error('[id-validation] detector unavailable', err)
        return null
      }
    })()
  }
  return detectorPromise
}

async function decode(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch {
    return null
  } finally {
    // Revoked after decode; the bitmap is already in memory.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

type Inspection =
  | { kind: 'counted'; faces: number }
  | { kind: 'too_small' }
  | { kind: 'unreadable' }
  | { kind: 'degraded' }

async function inspect(file: File): Promise<Inspection> {
  const img = await decode(file)
  if (!img) return { kind: 'unreadable' }
  if (Math.max(img.naturalWidth, img.naturalHeight) < MIN_LONG_EDGE_PX) {
    return { kind: 'too_small' }
  }
  const detector = await getDetector()
  if (!detector) return { kind: 'degraded' }
  try {
    return { kind: 'counted', faces: detector.detect(img).detections.length }
  } catch (err) {
    console.error('[id-validation] detect failed', err)
    return { kind: 'degraded' }
  }
}

async function requireAFace(file: File, noFaceReason: string): Promise<ValidationResult> {
  const r = await inspect(file)
  switch (r.kind) {
    case 'unreadable':
      return { ok: false, code: 'unreadable', reason: "We couldn't open that image. Try a JPG or PNG straight from your camera." }
    case 'too_small':
      return { ok: false, code: 'too_small', reason: `That image is too small to read. Please upload one at least ${MIN_LONG_EDGE_PX}px on its longest side.` }
    // The detector itself failed, so nothing was actually checked. Pass, but say
    // so — the caller flags this submission for the reviewer.
    case 'degraded':
      return { ok: true, degraded: true }
    case 'counted':
      // "At least one", never "exactly one" — a correct "selfie with ID" contains
      // the holder's face AND the portrait printed on the document.
      return r.faces >= 1 ? { ok: true } : { ok: false, code: 'no_face', reason: noFaceReason }
  }
}

export function validateIdDocument(file: File): Promise<ValidationResult> {
  return requireAFace(
    file,
    "We couldn't find a face on this document. Please photograph the ID itself — the side with your photo on it — not its case, packaging, or a screenshot."
  )
}

export function validateSelfie(file: File): Promise<ValidationResult> {
  return requireAFace(
    file,
    "We couldn't find a face in this photo. Please upload a clear photo of yourself holding your ID."
  )
}
```

- [ ] **Step 4: Add `'wasm-unsafe-eval'` to the CSP**

In `next.config.ts`, change:

```ts
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
```

to:

```ts
  // 'wasm-unsafe-eval': the on-device ID face-detector (src/lib/id-validation.ts)
  // instantiates WebAssembly. This permits WASM compilation ONLY — it does not
  // re-enable eval() of JavaScript strings, so it is materially narrower than
  // 'unsafe-eval'. Without it the detector works in dev (which grants
  // 'unsafe-eval') and silently fails in production.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
```

- [ ] **Step 5: Build a temporary browser harness and watch the fixtures fail correctly**

Create `src/app/_idcheck/page.tsx` as a throwaway page (deleted in Step 7):

```tsx
'use client'
import { useState } from 'react'
import { validateIdDocument, validateSelfie } from '@/lib/id-validation'

export default function IdCheckHarness() {
  const [out, setOut] = useState<string[]>([])
  async function run(kind: 'id' | 'selfie', file: File) {
    const r = kind === 'id' ? await validateIdDocument(file) : await validateSelfie(file)
    setOut((o) => [...o, `${kind} · ${file.name} → ${JSON.stringify(r)}`])
  }
  return (
    <div className="p-8 space-y-4">
      <input type="file" onChange={(e) => e.target.files?.[0] && run('id', e.target.files[0])} />
      <input type="file" onChange={(e) => e.target.files?.[0] && run('selfie', e.target.files[0])} />
      <pre className="text-xs">{out.join('\n')}</pre>
    </div>
  )
}
```

Run `npm run dev`, open `/_idcheck`, and feed it each fixture. Required results — **record the actual JSON for each in your report**:

| Fixture | Input as | Expected |
|---|---|---|
| `bad-id.png` (Canon G7X) | ID | `{"ok":false,"code":"no_face",...}` |
| `bad-selfie.png` (Canon G7X) | selfie | `{"ok":false,"code":"no_face",...}` |
| `good-id.jpg` | ID | `{"ok":true}` |
| `good-selfie.jpg` (two faces) | selfie | `{"ok":true}` — proves "at least one", not "exactly one" |
| `tiny.png` | ID | `{"ok":false,"code":"too_small",...}` |

If the two Canon files do not come back `no_face`, the feature has not done its job — stop and report rather than proceeding.

- [ ] **Step 6: Prove it works under the REAL production CSP**

Dev grants `'unsafe-eval'`, so dev cannot prove the CSP is right. Run a production build and repeat one passing and one failing fixture:

```bash
npm run build && npm start
```

Open `/_idcheck` on the production server, run two fixtures, and confirm in DevTools: correct results AND **zero CSP violations** in the console. Paste the console state into your report. If you see a CSP error mentioning WebAssembly, Step 4 is wrong — fix it before continuing.

- [ ] **Step 7: Confirm the model is lazy-loaded**

The spec requires the model to stay out of the main bundle — this is a one-time flow and the homepage must not pay for it. With the production server still running from Step 6, open the homepage with DevTools' Network tab cleared, and confirm that **neither `vision_wasm_internal.wasm` nor `blaze_face_short_range.tflite` is requested**. Then navigate to a page that validates and confirm they are fetched only at that point. Report the homepage's total transferred bytes before and after this change; if the model is being pulled on the homepage, the dynamic `import()` in `getDetector()` is being hoisted — fix it before continuing.

- [ ] **Step 8: Delete the harness and commit**

```bash
rm -rf src/app/_idcheck
grep -rn "_idcheck" src/ || echo "harness fully removed"
npm run build && npm run lint
git add -A && git commit -m "Add on-device ID face-detection validation module"
```

---

## Task 2: Persist and surface the flag

**Files:**
- Create: `supabase/migrations/041_verification_auto_check.sql`
- Modify: `src/types/index.ts:114-123`, `src/app/admin/verifications/page.tsx:35` and `:78-99`
- Verify: scratchpad script `verify-041.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `verification_requests.auto_check_failed boolean not null default false` and `auto_check_detail text`; `VerificationRequest` gains both fields.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-041.mjs`:

```js
import fs from 'node:fs'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const URL = g('NEXT_PUBLIC_SUPABASE_URL'), KEY = g('SUPABASE_SECRET_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const USER = 'a0000000-0000-4000-8000-0000000000fe' // demo renter

const res = await fetch(`${URL}/rest/v1/verification_requests`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: USER, id_doc_path: 'probe/id.png', selfie_path: 'probe/selfie.png',
    auto_check_failed: true, auto_check_detail: 'id:no_face',
  }),
})
const body = await res.json()
if (!res.ok) { console.error('FAIL:', JSON.stringify(body)); process.exit(1) }
const row = body[0]
let bad = 0
if (row.auto_check_failed !== true) { console.error('FAIL: auto_check_failed not stored'); bad++ }
if (row.auto_check_detail !== 'id:no_face') { console.error('FAIL: auto_check_detail not stored'); bad++ }

// Default must be false for a normal submission.
const plain = await fetch(`${URL}/rest/v1/verification_requests`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ user_id: USER, id_doc_path: 'probe/id2.png', selfie_path: 'probe/selfie2.png' }),
})
const p = (await plain.json())[0]
if (p.auto_check_failed !== false) { console.error('FAIL: default is not false'); bad++ }

for (const id of [row.id, p.id]) await fetch(`${URL}/rest/v1/verification_requests?id=eq.${id}`, { method: 'DELETE', headers: H })
console.log(bad ? `${bad} FAILURES` : 'PASS: columns store and default correctly')
process.exit(bad ? 1 : 0)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node <scratchpad>/verify-041.mjs`
Expected: PostgREST rejects the unknown column `auto_check_failed` (`PGRST204` / "column ... does not exist").

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/041_verification_auto_check.sql`:

```sql
-- ============================================================
-- 041_verification_auto_check.sql
-- A real host's verification was submitted with two Canon G7X product
-- photographs standing in for an ID and a selfie, and both were accepted:
-- the uploads only ever validated file type and size. The browser now runs
-- an on-device face check (src/lib/id-validation.ts) before submission.
--
-- These two columns record that a submission bypassed that check — either
-- via the explicit "my document is valid" override, or because the detector
-- itself could not run — so /admin/verifications can flag it for a harder
-- look.
--
-- IMPORTANT: this flag is CLIENT-SUPPLIED and therefore advisory only. The
-- check runs in the browser, so anyone crafting a raw PostgREST request can
-- bypass both the check and this flag. It is a triage signal for the
-- reviewer, never a security control — the human /admin review remains the
-- actual gate on `profiles.is_verified`.
--
-- No new table, so the project's "enable RLS in the creation migration" rule
-- is not triggered. 015 grants select+insert at table level, so both columns
-- are insertable with no grant change, and there is no update grant, so a
-- submission's flag cannot be edited after the fact.
-- ============================================================

alter table public.verification_requests
  add column if not exists auto_check_failed boolean not null default false,
  add column if not exists auto_check_detail text;

comment on column public.verification_requests.auto_check_failed is
  'Client-reported: the on-device ID/selfie face check did not pass, or could not run. Advisory only — not a security control.';
```

- [ ] **Step 4: Apply and re-run**

```bash
supabase db push --linked --yes
supabase migration list --linked   # confirm 041 shows local and remote
node <scratchpad>/verify-041.mjs
```
Expected: `PASS: columns store and default correctly`

(`supabase db push` prints pg-delta certificate noise after "Applying migration…" — expected, not a failure.)

- [ ] **Step 5: Extend the TypeScript type**

In `src/types/index.ts`, add to `VerificationRequest` after `reviewer_notes`:

```ts
  auto_check_failed: boolean
  auto_check_detail: string | null
```

- [ ] **Step 6: Select the columns in the admin query**

In `src/app/admin/verifications/page.tsx`, the select string at line 35 currently reads:

```
'id, user_id, id_doc_path, selfie_path, status, reviewer_notes, created_at, reviewed_at, profiles!verification_requests_user_id_fkey(full_name, is_host, is_verified, created_at)'
```

Change it to include the two new columns:

```
'id, user_id, id_doc_path, selfie_path, status, reviewer_notes, auto_check_failed, auto_check_detail, created_at, reviewed_at, profiles!verification_requests_user_id_fkey(full_name, is_host, is_verified, created_at)'
```

Add both fields to the page's local row type (the interface declaring `status`, `reviewer_notes`, `created_at` around lines 12-16):

```ts
  auto_check_failed: boolean
  auto_check_detail: string | null
```

- [ ] **Step 7: Render the banner**

In the same file, immediately after the closing `</div>` of the row header block (the flex container ending just before `<div className="grid gap-4 sm:grid-cols-2">`), insert:

```tsx
            {r.auto_check_failed && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Automated check failed — review this one carefully.</p>
                  <p className="text-xs">
                    The submitter&apos;s browser could not confirm a face on
                    {r.auto_check_detail ? ` ${r.auto_check_detail}` : ' one or both images'}, and submitted anyway.
                    This flag is reported by the browser and is advisory only.
                  </p>
                </div>
              </div>
            )}
```

Add `AlertTriangle` to the file's `lucide-react` import.

- [ ] **Step 8: Verify the banner renders**

Seed one flagged and one clean row, view `/admin/verifications`, confirm the banner appears on exactly the flagged one, then delete both.

Local `.env.local` does **not** include the demo host in `ADMIN_EMAILS`. Add it temporarily to reach `/admin`, then remove it and confirm the file is restored — `.env.local` must end with no demo-host email in it.

- [ ] **Step 9: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Record and surface when a verification bypassed the on-device check"
```

---

## Task 3: Wire both upload call sites

**Files:**
- Modify: `src/components/host/Step6Verify.tsx:86` and `:109`, `src/components/shared/VerificationCard.tsx:67` and `:84`, `src/hooks/useVerification.ts:52-80`, `src/components/host/ListingWizard.tsx` (verification insert)
- Verify: browser walkthrough of both flows

**Interfaces:**
- Consumes: `validateIdDocument(file)`, `validateSelfie(file)`, `ValidationResult` from Task 1; the two columns from Task 2.
- Produces: `useVerification().submit(idFile, selfieFile, autoCheck?)` where
  `autoCheck?: { failed: boolean; detail: string | null }`.

- [ ] **Step 1: Extend `submit()` to carry the flag**

In `src/hooks/useVerification.ts`, change the signature:

```ts
  async function submit(
    idFile: File,
    selfieFile: File,
    autoCheck?: { failed: boolean; detail: string | null }
  ): Promise<string | null> {
```

and the insert:

```ts
    const { error: insertError } = await supabase.from('verification_requests').insert({
      user_id: user.id,
      id_doc_path: idPath,
      selfie_path: selfiePath,
      auto_check_failed: autoCheck?.failed ?? false,
      auto_check_detail: autoCheck?.detail ?? null,
    })
```

The parameter is optional so the existing call shape keeps compiling; callers that validate pass it explicitly.

- [ ] **Step 2: Add validation state to `VerificationCard`**

In `src/components/shared/VerificationCard.tsx`, add next to the existing state:

```ts
  const [idError, setIdError] = useState('')
  const [selfieError, setSelfieError] = useState('')
  const [idAttempts, setIdAttempts] = useState(0)
  const [selfieAttempts, setSelfieAttempts] = useState(0)
  const [override, setOverride] = useState(false)
  const [checking, setChecking] = useState(false)
  // The detector could not run, so nothing was checked. Not an error the user
  // can fix, so it never blocks — but the submission must still be flagged.
  const [degraded, setDegraded] = useState(false)
```

and this handler:

```ts
  async function pick(kind: 'id' | 'selfie', file: File | null) {
    if (!file) return
    setChecking(true)
    const result = kind === 'id' ? await validateIdDocument(file) : await validateSelfie(file)
    setChecking(false)
    if (result.ok) {
      if (result.degraded) setDegraded(true)
      if (kind === 'id') { setIdFile(file); setIdError('') } else { setSelfieFile(file); setSelfieError('') }
      return
    }
    // Keep the file so the override can still submit it after a second try.
    if (kind === 'id') { setIdFile(file); setIdError(result.reason); setIdAttempts((n) => n + 1) }
    else { setSelfieFile(file); setSelfieError(result.reason); setSelfieAttempts((n) => n + 1) }
  }
```

Import at the top: `import { validateIdDocument, validateSelfie } from '@/lib/id-validation'`.

- [ ] **Step 3: Wire the inputs and drop `.pdf`**

Change line 67 from `accept="image/*,.pdf"` to `accept="image/*"`, and its `onChange` to `(e) => pick('id', e.target.files?.[0] ?? null)`.
Change line 84's `onChange` to `(e) => pick('selfie', e.target.files?.[0] ?? null)`.
Update the ID tile's helper text at line 80 from `JPG, PNG, PDF` to `JPG or PNG`.

- [ ] **Step 4: Render errors and the override**

Below the two-tile grid (after the closing `</div>` of the `grid grid-cols-1 sm:grid-cols-2` block), insert:

```tsx
          {(idError || selfieError) && (
            <div className="space-y-2">
              {idError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {idError}
                </div>
              )}
              {selfieError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {selfieError}
                </div>
              )}
            </div>
          )}

          {(idAttempts >= 2 || selfieAttempts >= 2) && (idError || selfieError) && (
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => setOverride(!override)}>
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${override ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'}`}>
                {override && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                My document is valid — submit for manual review anyway.
              </p>
            </label>
          )}
```

Note the `onClick` sits on the `<label>`, not on the 20×20 icon — this project has a documented history of putting it on the icon and leaving the text dead.

- [ ] **Step 5: Gate submit and pass the flag**

Replace the submit handler's guard and call:

```ts
  const blocked = Boolean(idError || selfieError) && !override

  async function handleSubmit() {
    if (!idFile || !selfieFile || blocked) return
    setSubmitting(true)
    setError('')
    const failed = Boolean(idError || selfieError) || degraded
    const detail =
      [idError && 'id:no_face', selfieError && 'selfie:no_face', degraded && 'detector_unavailable']
        .filter(Boolean).join(',') || null
    const err = await submit(idFile, selfieFile, { failed, detail })
    if (err) setError(err)
    else {
      setIdFile(null); setSelfieFile(null)
      setIdError(''); setSelfieError('')
      setIdAttempts(0); setSelfieAttempts(0); setOverride(false); setDegraded(false)
    }
    setSubmitting(false)
  }
```

Add `|| blocked || checking` to the submit button's existing `disabled` expression at line 110.

- [ ] **Step 6: Apply the same treatment to the wizard step**

`src/components/host/Step6Verify.tsx` holds its files in the parent's `VerifyData`, so the validation state lives locally in the step while the files continue to flow through `onChange`.

Add the same imports and this state inside `Step6Verify`:

```ts
  const [idError, setIdError] = useState('')
  const [selfieError, setSelfieError] = useState('')
  const [idAttempts, setIdAttempts] = useState(0)
  const [selfieAttempts, setSelfieAttempts] = useState(0)
  const [override, setOverride] = useState(false)
  const [checking, setChecking] = useState(false)
  const [degraded, setDegraded] = useState(false)

  async function pick(kind: 'id' | 'selfie', file: File | null) {
    if (!file) return
    setChecking(true)
    const result = kind === 'id' ? await validateIdDocument(file) : await validateSelfie(file)
    setChecking(false)
    if (result.ok && result.degraded) setDegraded(true)
    const message = result.ok ? '' : result.reason
    if (kind === 'id') { setIdError(message); if (message) setIdAttempts((n) => n + 1) }
    else { setSelfieError(message); if (message) setSelfieAttempts((n) => n + 1) }
  }
```

Change line 86's `accept="image/*,.pdf"` to `accept="image/*"`, both `onChange`s to call `pick(...)`, and the ID helper text `JPG, PNG, PDF` to `JPG or PNG`. Render the same error blocks and override checkbox after the two upload tiles, and extend `canSubmit`:

```ts
  const blocked = Boolean(idError || selfieError) && !override
  const canSubmit = alreadyHandled
    ? data.agreed
    : Boolean(data.idFile && data.selfieFile && data.agreed) && !blocked && !checking
```

`useState` must be added to the file's `react` import (it currently imports only `useRef`).

- [ ] **Step 7: Carry the flag out of the wizard**

`Step6Verify` must report its result upward so `ListingWizard`'s own insert can record it. Add to `VerifyData` in `Step6Verify.tsx`:

```ts
export interface VerifyData {
  idFile: File | null
  selfieFile: File | null
  agreed: boolean
  autoCheckFailed: boolean
  autoCheckDetail: string | null
}
```

Set them inside `pick()` whenever an error is produced or cleared:

```ts
    const idMsg = kind === 'id' ? message : idError
    const selfieMsg = kind === 'selfie' ? message : selfieError
    const degradedNow = degraded || (result.ok && Boolean(result.degraded))
    const failedNow = Boolean(idMsg) || Boolean(selfieMsg) || degradedNow
    const detailNow = [
      idMsg && 'id:no_face',
      selfieMsg && 'selfie:no_face',
      degradedNow && 'detector_unavailable',
    ].filter(Boolean).join(',') || null
    onChange({ ...data, [kind === 'id' ? 'idFile' : 'selfieFile']: file, autoCheckFailed: failedNow, autoCheckDetail: detailNow })
```

(Use this single `onChange` call instead of the `set(...)` line from Step 6 — one call, not two, because two `set()` calls each spread the same stale `data` and the second silently overwrites the first. That exact bug has been fixed twice in this codebase already.)

In `src/components/host/ListingWizard.tsx`, add `autoCheckFailed: false, autoCheckDetail: null` to `INITIAL.verify`, and extend the `verification_requests` insert inside `handleSubmit` to include:

```ts
            auto_check_failed: state.verify.autoCheckFailed,
            auto_check_detail: state.verify.autoCheckDetail,
```

- [ ] **Step 8: Walk both flows in the browser**

`npm run dev`, then as the demo host:

1. **Settings → Identity Verification.** Upload `bad-id.png` → the red "couldn't find a face on this document" error appears and submit is disabled. Upload it again → the override checkbox appears. Tick it, upload a valid selfie, submit → the request lands with `auto_check_failed = true` and `auto_check_detail` containing `id:no_face`.
2. Upload `good-id.jpg` and `good-selfie.jpg` (two faces) → no errors, no override offered, submit works, and the row has `auto_check_failed = false`. **The two-face selfie passing is the point** — it proves the rule is "at least one".
3. **Host wizard step 6.** Repeat case 1, and confirm the wizard's own insert carries the flag.
4. Confirm the ID file picker no longer offers PDFs.

Check each result with a service-role query and delete every probe row and uploaded object afterwards. Report the actual row values.

- [ ] **Step 9: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Validate ID and selfie uploads on device before submission"
```

---

## Final pass

- [ ] **Update `AGENTS.md`**

Add a Status entry in this project's house style (read several existing ones first and match their voice and depth): what was wrong (two Canon G7X product photos accepted as an ID and a selfie, caught only because a human opened the images), the design (one on-device face-detection model, "at least one face" on both uploads because a correct "selfie with ID" contains two, self-hosted assets, `'wasm-unsafe-eval'` added to the CSP), what was verified live, and — **stated plainly** — that this is not a security control: it runs client-side, the flag is client-supplied, and the `/admin` human review remains the actual gate.

Also update the Architecture note on identity verification, which currently says review is the only check, and record `041` in the migrations map line.

- [ ] **Regression walkthrough**

Production build (`npm run build && npm start`). Walk home, search, a listing detail page, the host wizard end to end, Settings, and `/admin`. Confirm zero console errors and **zero CSP violations** — the CSP changed in this plan, so this is the check that matters most.

- [ ] **Confirm the migration**

`supabase migration list --linked` — `041` must show local and remote.
