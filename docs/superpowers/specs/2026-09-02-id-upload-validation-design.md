# On-Device ID Upload Validation — Design

**Date:** 2026-09-02
**Status:** Approved for planning
**Trigger:** A real host's identity verification was submitted with two Canon G7X *product photographs* in place of an ID document and a selfie. Both uploads were accepted without complaint. The submission sat `pending` in the queue looking exactly like a legitimate one.

---

## Problem

The verification upload validates file **type** and **size** and nothing else. `Step6Verify` (host wizard) and `VerificationCard` (Settings) both accept any image. Migration `015`'s own header is candid about it:

> "Approval is manual, service-role only — there's no automated ID-checking here, just a queue."

That was an acceptable trade-off while the queue was reviewed by hand every time. It is a worse trade-off now that migration `037` gates listing publication on `profiles.is_verified`: a rubber-stamped approval publishes listings and awards a "Verified Host" badge that renters are told to trust.

The concrete failure already happened in production. It was caught only because a human opened the images.

## Goal and non-goal

**Goal:** reject submissions that plainly are not an ID and a selfie, at upload time, before they reach the queue — and mark the ones that scrape through so the reviewer knows where to look.

**Non-goal — stated first because it is the thing most likely to be misread later:** this is **not** a security control and must never be described as one. The check runs in the user's browser. Anyone willing to craft a raw PostgREST request bypasses it completely, and the `auto_check_failed` flag it writes is itself client-supplied and therefore untrustworthy. What this buys is the elimination of honest mistakes and lazy submissions, plus a triage signal. **The `/admin` human review remains the actual gate**, exactly as it was before.

A server-side or vendor KYC check was considered and deliberately rejected for now: sending government ID images to a third-party processor carries privacy and PH Data Privacy Act obligations disproportionate to a pre-launch product.

---

## What is checked

| Upload | Rule | Rationale |
|---|---|---|
| Selfie | **At least one** face | Zero faces → not a selfie. **Deliberately not "exactly one":** the field is labelled *"Selfie with ID"*, so a correctly-taken photo shows the holder beside their ID and the frame contains two faces — theirs, plus the portrait printed on the document. An exactly-one rule would reject every properly-taken selfie. |
| ID document | **At least one** face | Every Philippine ID carries a portrait — PhilID, driver's licence, passport, UMID, postal ID. A product photograph, screenshot, or landscape has none. |
| Both | Minimum **600 px** on the long edge | Stops a thumbnail or an icon from passing on a technicality. |
| Both | Existing type and size checks retained | JPG/PNG/WebP/AVIF, 10 MB ceiling — already enforced since the wizard-idempotency work. |

**The ID input drops `.pdf`.** It is currently `accept="image/*,.pdf"`. A PDF cannot be face-checked in the browser without a PDF rasteriser, and phone-camera photographs are the norm for this flow. Accepting a format the check cannot inspect would be a silent hole in the middle of the feature.

The single face-detection model does both jobs. This is the design's main simplification: OCR would need a ~10 MB language model to establish "this image contains ID-like text", while face detection establishes "this image contains a person" for both uploads with one ~230 KB model — and it is precisely the signal the observed failure lacked.

---

## Architecture

### `src/lib/id-validation.ts` (new)

The single source of truth for both call sites, so they cannot drift apart the way the province dropdown and the coordinate table did.

```ts
export type ValidationCode =
  | 'ok'
  | 'no_face'          // ID or selfie: no face found
  | 'too_small'        // below the resolution floor
  | 'unreadable'       // decode failed
  | 'detector_failed'  // model could not load or run

export type ValidationResult =
  | { ok: true; degraded?: boolean }   // degraded: the detector could not run, so nothing was actually checked
  | { ok: false; code: Exclude<ValidationCode, 'ok' | 'detector_failed'>; reason: string }

export function validateIdDocument(file: File): Promise<ValidationResult>
export function validateSelfie(file: File): Promise<ValidationResult>
```

`reason` is renter-facing copy, specific enough to act on ("We couldn't find a face on this document. Please photograph your ID itself, not its case or packaging.") rather than a generic failure.

**A detector that cannot run returns `{ ok: true, degraded: true }`, never `ok: false`.** If the model fails to load — old browser, blocked asset, WASM unavailable — the upload proceeds and the submission is flagged exactly as an override would be (`auto_check_detail` records `detector_unavailable`). This is typed rather than left to caller discipline, so neither call site can accidentally block a user because the validator itself broke. A validator that locks people out when *it* fails is worse than no validator.

### Model and assets

- `@mediapipe/tasks-vision`, pinned to **1.0.1** (verified available at authoring time).
- Assets copied into `public/models/`: the vision WASM bundle and `blaze_face_short_range.tflite`. **Served from `'self'` — never fetched from a CDN**, both because this project's CSP forbids it and because a third party should not receive a request correlated with an ID upload.
- Lazy-loaded on first validation call. It must not enter the main bundle: this is a one-time flow, and the homepage must not pay for it. Record the real transferred size during implementation.

### CSP change — load-bearing

Production `script-src` is `'self' 'unsafe-inline'`, with `'unsafe-eval'` added in dev only. WebAssembly instantiation requires `'wasm-unsafe-eval'` (or the much broader `'unsafe-eval'`).

**Without this change the feature works in `npm run dev` and silently fails in production** — the exact shape of the CSP bug this project already hit once, when dev-only `'unsafe-eval'` was missing and every form died locally.

Add `'wasm-unsafe-eval'` to `script-src`. It permits WebAssembly compilation only; it does **not** re-enable `eval()` of JavaScript strings, so it is materially narrower than `'unsafe-eval'`.

### Failure and override flow

1. A failed check shows the specific `reason` inline and blocks submit for that slot.
2. On the **second** failed attempt for the same slot, an override appears: *"My document is valid — submit for manual review."*
3. Ticking it permits submission and records the flag.

Two attempts before offering the escape is deliberate: the first failure is usually a genuinely bad photo that a retry fixes, and offering the bypass immediately would train people straight past the check.

### Persistence and admin surfacing

**Migration `041`:**

```sql
alter table public.verification_requests
  add column auto_check_failed boolean not null default false,
  add column auto_check_detail text;
```

No new table, so the project's "enable RLS in the creation migration" rule is not triggered. `015` grants `select, insert` at table level, so both columns are insertable by the submitting user with no grant change; there is no `update` grant, so a submission's flag cannot be edited after the fact.

`auto_check_detail` stores the failing codes (e.g. `id:no_face`), not free text from the client's DOM.

`/admin/verifications` renders a prominent amber **"Automated check failed — review this one carefully"** banner with the detail on flagged rows. Reviewer attention is the entire product of this feature; a flag nobody sees is worth nothing.

---

## Files

**Created**
- `src/lib/id-validation.ts`
- `supabase/migrations/041_verification_auto_check.sql`
- `public/models/` — self-hosted WASM + `.tflite`

**Modified**
- `src/components/host/Step6Verify.tsx` — validate on selection, inline errors, override, and drop `.pdf` from the ID input's `accept` (currently `image/*,.pdf` at line 86)
- `src/components/shared/VerificationCard.tsx` — the same three changes; its ID input carries the identical `image/*,.pdf` at line 67
- `src/components/host/ListingWizard.tsx` — carry the flag into the `verification_requests` insert
- `src/app/admin/verifications/page.tsx` — flagged-row banner
- `next.config.ts` — `'wasm-unsafe-eval'`
- `AGENTS.md` — record the feature **and** its non-security nature

---

## Verification plan

Live, following this project's established pattern. No unit-test suite exists.

1. **The actual regression case.** The two Canon G7X photographs from request `4f5bc1e6-2798-487b-97c6-ba5e0c35662d` are still in the `verification-docs` bucket. Both must now be rejected with `no_face`. This is the acceptance test — if it does not reject those exact two files, the feature has not done its job.
2. A genuine ID photograph and a genuine selfie must both pass.
3. A genuine *"selfie with ID"* — the holder beside their document, so two faces in frame — must **pass**, confirming the rule is "at least one" and not "exactly one".
4. A sub-600 px image must be rejected `too_small`.
5. The override path: two failures, tick, submit — the row lands with `auto_check_failed = true` and the correct `auto_check_detail`.
6. `/admin/verifications` shows the amber banner on that row and not on clean rows.
7. **Production build under the real CSP.** `npm run build && npm start`, then run a validation and confirm the model loads with zero CSP violations in the console. Dev mode cannot prove this, because dev grants `'unsafe-eval'`.
8. Confirm the model is lazy-loaded — absent from the homepage's transferred bytes.
9. `npm run build` and `npm run lint` clean.

---

## Out of scope

- **Face matching** between the ID portrait and the selfie. Meaningfully harder, far more false rejections, and a much bigger privacy story.
- **Liveness detection** — a printed photo of a face would pass. Vendor territory.
- **Document authenticity** — holograms, MRZ parsing, tamper checks. Vendor territory.
- **Re-validating the existing queue.** Only new submissions are checked; the one historical bad request has already been dealt with by hand.
