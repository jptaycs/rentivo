// Verifies migration 084 (Phase C whole-branch review fixes):
//   1. reverse_payout_statement clears statement_emailed_at, so a reversal whose
//      email fails shows "Email not sent — Resend" instead of the issue email's
//      date.
//   2. issue_payout_statement's idempotent same-reference return refuses a
//      different transfer date, and still returns the row for the same date.
//
// ⚠️ Every lifecycle call runs against the REAL legacy statement PS-2026-000001
// inside a rolled-back probe: a `do $$ … $$` block that ends by raising
// `VERIFY <json>`, so the transaction aborts and nothing persists. Nothing here
// can consume a statement number (issue on an already-issued row takes the
// idempotent path, before the counter). The harness is proven first — a
// sentinel write inside a probe must not survive — and the legacy row, the
// counter and admin_actions are re-read afterwards to prove it.
//
// Usage: node --experimental-strip-types scripts/verify/084-payout-statement-review-fixes.mjs
import { execFileSync } from 'node:child_process'
import { admin, check, done } from './env.mjs'

const LEGACY = 'a6194f2f-5599-4824-8e38-f4cc81af4d5f'
const LEGACY_REF = 'QA-GCASH-REF-001'
const E = "'verify-084@example.com'"
const TRANSPORT_RE = /Failed to connect|ConnectTempRoleError|GOAWAY|ECONNRESET|Timeout while shutting down PostHog/i

function runQuery(body) {
  for (let i = 0; i < 4; i++) {
    try {
      const out = execFileSync('supabase', ['db', 'query', '--linked', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { raised: false, out }
    } catch (e) {
      const text = `${e.stdout ?? ''}${e.stderr ?? ''}`
      if (TRANSPORT_RE.test(text) && !/"message"/.test(e.stdout ?? '')) continue
      return { raised: true, out: e.stdout ?? '', text }
    }
  }
  throw new Error('supabase db query kept failing to connect')
}

/** Postgres error message from a failed `supabase db query`. */
function pgMessage(stdout) {
  try {
    const outer = JSON.parse(stdout)
    const msg = (outer?.error?.message ?? '').replace(/^unexpected status \d+: /, '')
    return JSON.parse(msg)?.message ?? msg
  } catch {
    return stdout
  }
}

/** Run plpgsql that must end with `raise exception 'VERIFY %', <json>`. */
function probe(bodySql) {
  const r = runQuery(`do $$\ndeclare r public.payout_requests; v jsonb := '{}'::jsonb;\nbegin\n${bodySql}\nend $$;`)
  if (!r.raised) return { ok: false, message: 'probe did not raise — it may have COMMITTED' }
  const message = pgMessage(r.out)
  // The CLI reports a raise either as JSON or as plain text
  // ("Failed to run sql query: ERROR:  P0001: VERIFY {…}\nCONTEXT: …"), so
  // find the marker rather than anchoring on it.
  const m = message.match(/(?:^|P0001: )VERIFY ([\s\S]*?)(?:\nCONTEXT|$)/)
  return m ? { ok: true, payload: JSON.parse(m[1]) } : { ok: false, message }
}

function rows(query) {
  const r = runQuery(query)
  if (r.raised) throw new Error(pgMessage(r.out))
  return JSON.parse(r.out.slice(r.out.indexOf('{'))).rows
}

const legacyRow = () =>
  rows(`select status::text, statement_number, reference, transferred_on::text, reversed_at, reversal_reason, statement_emailed_at
        from public.payout_requests where id = '${LEGACY}'`)[0]
const counter = () => rows(`select last_number from public.payout_statement_counters where year = 2026`)[0]?.last_number
const auditCount = async () => (await admin('admin_actions?select=id')).body?.length ?? -1

const before = { row: JSON.stringify(legacyRow()), counter: counter(), audit: await auditCount() }
console.log('BASELINE', JSON.stringify(before))
check('0. legacy statement is issued, unreversed, with the expected reference', /"status":"paid"/.test(before.row) && before.row.includes(LEGACY_REF) && /"reversed_at":null/.test(before.row), before.row)

try {
  // ── 0. Harness: a write inside a probe does not survive ─────────────────
  {
    const p = probe(`
      update public.payout_requests set notes = 'HARNESS-SENTINEL-084' where id = '${LEGACY}';
      raise exception 'VERIFY %', jsonb_build_object('wrote', (select notes from public.payout_requests where id = '${LEGACY}'));`)
    check('0. harness: probe saw its own sentinel write', p.ok && p.payload.wrote === 'HARNESS-SENTINEL-084', JSON.stringify(p))
    const [{ notes }] = rows(`select notes from public.payout_requests where id = '${LEGACY}'`)
    check('0. harness: the sentinel did NOT survive the rollback', notes !== 'HARNESS-SENTINEL-084', String(notes))
  }

  // ── 1. Reverse clears statement_emailed_at ───────────────────────────────
  {
    const p = probe(`
      update public.payout_requests set statement_emailed_at = now() where id = '${LEGACY}';
      v := v || jsonb_build_object('emailed_before', (select statement_emailed_at is not null from public.payout_requests where id = '${LEGACY}'));
      r := public.reverse_payout_statement('${LEGACY}', 'probe 084', ${E});
      raise exception 'VERIFY %', v || jsonb_build_object(
        'emailed_after', r.statement_emailed_at, 'reversed', r.reversed_at is not null,
        'status', r.status, 'number', r.statement_number, 'reason', r.reversal_reason);`)
    check('1. CONTROL: statement_emailed_at was set before reversing (the issue email "went out")', p.ok && p.payload.emailed_before === true, JSON.stringify(p))
    check('1. reverse_payout_statement cleared statement_emailed_at', p.ok && p.payload.emailed_after === null, JSON.stringify(p))
    check('1. …and still reversed normally (failed, reversed_at set, number kept, reason stored)',
      p.ok && p.payload.reversed === true && p.payload.status === 'failed' && p.payload.number === 'PS-2026-000001' && p.payload.reason === 'probe 084',
      JSON.stringify(p))
  }

  // ── 2. Idempotent re-issue: same reference, different date → refused ─────
  {
    const [{ transferred_on: legacyDate }] = rows(`select transferred_on::text from public.payout_requests where id = '${LEGACY}'`)
    const other = rows(`select ('${legacyDate}'::date - 1)::text as d`)[0].d

    const refused = probe(`
      r := public.issue_payout_statement('${LEGACY}', '${LEGACY_REF}', '${other}'::date, ${E});
      raise exception 'VERIFY %', jsonb_build_object('returned', r.statement_number);`)
    check(`2. same reference, different date (${other}) → refused naming the recorded date`,
      !refused.ok && /already issued with reference QA-GCASH-REF-001 on 2026-09-01/.test(refused.message ?? ''),
      JSON.stringify(refused))

    const same = probe(`
      r := public.issue_payout_statement('${LEGACY}', '${LEGACY_REF}', '${legacyDate}'::date, ${E});
      raise exception 'VERIFY %', jsonb_build_object('number', r.statement_number, 'date', r.transferred_on);`)
    check('2. CONTROL: same reference, same date → idempotent return of the issued row',
      same.ok && same.payload.number === 'PS-2026-000001' && same.payload.date === legacyDate, JSON.stringify(same))

    const diffRef = probe(`
      r := public.issue_payout_statement('${LEGACY}', 'SOME-OTHER-REF', '${legacyDate}'::date, ${E});
      raise exception 'VERIFY %', jsonb_build_object('number', r.statement_number);`)
    check('2. CONTROL: a different reference is still refused (082 behaviour unchanged)',
      !diffRef.ok && /already issued with reference QA-GCASH-REF-001\./.test(diffRef.message ?? ''), JSON.stringify(diffRef))
  }

  // ── 3. Grants/identity unchanged by CREATE OR REPLACE ────────────────────
  {
    const fns = rows(`select p.proname, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname in ('issue_payout_statement', 'reverse_payout_statement')`)
    for (const f of fns) {
      check(`3. ${f.proname} still service_role-only`, /service_role=X/.test(f.acl) && !/authenticated=X|anon=X|=X\/postgres,|^\{=X/.test(f.acl.replace('postgres=X/postgres,', '')), f.acl)
    }
    check('3. both functions present', fns.length === 2, JSON.stringify(fns))
  }
} catch (e) {
  check('SCRIPT completed without throwing', false, String(e?.stack ?? e))
} finally {
  const after = { row: JSON.stringify(legacyRow()), counter: counter(), audit: await auditCount() }
  check('BASELINE legacy statement byte-identical after every probe', after.row === before.row, `${before.row} -> ${after.row}`)
  check('BASELINE statement counter unchanged (no number consumed)', after.counter === before.counter, `${before.counter} -> ${after.counter}`)
  check('BASELINE admin_actions unchanged (every audit insert rolled back)', after.audit === before.audit, `${before.audit} -> ${after.audit}`)
  done()
}
