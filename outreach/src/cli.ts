// Rentivo host outreach CLI.  Run from outreach/:  npm run o -- <command> [options]
//
//   paste     [--city QC]           page URLs from clipboard/stdin: "url" or "Name | url | notes"
//   add       --name "X Rentals" [--fb URL] [--ig URL] [--email] [--phone] [--city] [--notes]
//   find      --city Naga [--query "camera rental"] [--max 40]   Google Maps (storefront shops only)
//   import    file.csv   (header: name,city,fb_url,ig_url,tiktok_url,email,phone,website,notes)
//   enrich    [--limit 50]          scan websites for email + social links
//   draft     [--limit 20]          Claude writes openers (and screens out non-fits)
//   queue     [--limit 30]          DMs: copy text, open the page, you paste + send (real terminal)
//   next      [n]                   same, one at a time, no keypresses: then `sent <message id>`
//   email     [--limit N] [--live]  send email drafts (dry run unless --live)
//   followups                       close leads that never replied (follow-ups off unless OUTREACH_MAX_FOLLOWUPS)
//   reply     <id> [--text "..."]   log their reply; Claude triages + drafts our answer
//   set       <id> <status>         signed_up | listed | closed | not_a_fit | …
//   dnc       <id>                  never contact again (every identifier they have)
//   list      [--status s] [--q name] [--limit 50]
//   show      <id>
//   stats                           funnel + reply buckets
//   questions                       every question hosts asked, verbatim
//   export                          CSV of all leads to stdout
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import {
  db, STATUSES, upsertLead, getLead, updateLead, messagesFor, addMessage, markSent,
  addDnc, type Lead, type Message, type NewLead, type Status,
} from './db.ts'
import { searchPlaces, scanWebsite, pickChannel, classifyUrl } from './sources.ts'
import { draftMessage, triageReply } from './claude.ts'
import { liveServiceFeeBps } from './facts.ts'
import { emailConfig, footer, sendEmail } from './email.ts'

const [command, ...rest] = process.argv.slice(2)
const { values: opt, positionals: pos } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    city: { type: 'string' }, query: { type: 'string' }, max: { type: 'string' }, limit: { type: 'string' },
    name: { type: 'string' }, fb: { type: 'string' }, ig: { type: 'string' }, tiktok: { type: 'string' },
    email: { type: 'string' }, phone: { type: 'string' }, website: { type: 'string' }, notes: { type: 'string' },
    status: { type: 'string' }, q: { type: 'string' }, text: { type: 'string' }, live: { type: 'boolean' },
  },
})
const limit = (d: number) => Number(opt.limit ?? d)

// ---------- helpers ----------
const copy = (text: string) => spawnSync('pbcopy', { input: text })
const openUrl = (url: string) => spawnSync('open', [url])
const pageUrl = (l: Lead) =>
  ({ fb: l.fb_url, ig: l.ig_url, tiktok: l.tiktok_url, email: null, phone: null })[l.channel as string] ?? l.maps_url

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
  }))
}

function editInEditor(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'outreach-')), 'message.txt')
  writeFileSync(file, text)
  spawnSync(process.env.EDITOR ?? 'nano', [file], { stdio: 'inherit' })
  return readFileSync(file, 'utf8').trim()
}

function oneLine(l: Lead) {
  const via = l.channel ? `${l.channel}` : 'no contact'
  return `#${String(l.id).padEnd(4)} ${l.status.padEnd(10)} ${via.padEnd(7)} ${l.name}${l.city ? ` · ${l.city}` : ''}`
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()))
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), (r[i] ?? '').trim()])))
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // Neutralise spreadsheet formulas, same rule as the app's src/lib/csv.ts.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** "facebook.com/p/Piktyur-MNL-Camera-Rental-615635…" → "Piktyur MNL Camera Rental"; "instagram.com/rj.camrental" → "rj.camrental". */
function nameFromUrl(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  const seg = path.split('/').filter((s) => s && s !== 'p' && s !== 'pages').pop() ?? path
  return seg.replace(/^@/, '').replace(/-\d{6,}$/, '').replace(/-/g, ' ') || url
}

function saveLead(input: NewLead): string {
  // A social URL typed into --website belongs in its own column.
  if (input.website && classifyUrl(input.website)) {
    const kind = classifyUrl(input.website)!
    input = { ...input, [`${kind === 'fb' ? 'fb' : kind === 'ig' ? 'ig' : 'tiktok'}_url`]: input.website, website: null }
  }
  const res = upsertLead(input)
  if (!res) return `skipped (do-not-contact): ${input.name}`
  // Re-pick the channel while we haven't reached out yet (a merge may have added an email).
  if (['new', 'enriched'].includes(res.lead.status)) updateLead(res.lead.id, { channel: pickChannel(res.lead) })
  return `${res.created ? 'added  ' : 'merged '} ${oneLine(getLead(res.lead.id)!)}`
}

/** Drafts a human sends: DMs on any channel, plus replies to email threads (sent from your own inbox). */
function handDrafts(n: number): Message[] {
  return db
    .prepare(`select m.* from messages m join leads l on l.id = m.lead_id
              where m.status = 'draft' and l.status not in ('dnc','closed','not_a_fit')
                and (m.channel != 'email' or m.kind = 'reply')
              order by case m.kind when 'reply' then 0 when 'followup2' then 1 when 'followup1' then 2 else 3 end, m.id
              limit ?`)
    .all(n) as Message[]
}

function showDraft(m: Message, position: string) {
  const l = getLead(m.lead_id)!
  const url = pageUrl(l)
  console.log(`── ${position} · message ${m.id} · #${l.id} ${l.name} · ${m.kind} via ${m.channel}`)
  if (m.channel === 'phone') console.log(`   Viber/SMS: ${l.phone}`)
  else if (m.channel === 'email') console.log(`   Reply in your inbox to: ${l.email}`)
  else if (url) console.log(`   ${url}`)
  console.log(`\n${m.body}\n`)
  copy(m.body)
  if (url && m.channel !== 'email' && m.channel !== 'phone') openUrl(url)
}

// ---------- commands ----------
const commands: Record<string, () => Promise<void> | void> = {
  async find() {
    if (!opt.city) throw new Error('--city is required, e.g. --city "Quezon City"')
    const query = opt.query ?? 'camera rental'
    const found = await searchPlaces(query, opt.city, Number(opt.max ?? 40))
    console.log(`${found.length} places for "${query}" in ${opt.city}`)
    for (const p of found) console.log(saveLead(p))
    console.log('\nNext: npm run o -- enrich')
  },

  add() {
    if (!opt.name) throw new Error('--name is required')
    console.log(saveLead({
      source: 'manual', name: opt.name, city: opt.city, fb_url: opt.fb, ig_url: opt.ig, tiktok_url: opt.tiktok,
      email: opt.email?.toLowerCase(), phone: opt.phone, website: opt.website, notes: opt.notes,
    }))
  },

  paste() {
    // One lead per line, from stdin or (if nothing is piped) the clipboard:
    //   https://facebook.com/somepage
    //   Name | https://instagram.com/handle | rents A7IV, FX3
    const raw = process.stdin.isTTY ? spawnSync('pbpaste').stdout.toString() : readFileSync(0, 'utf8')
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (!lines.length) throw new Error('Nothing to paste. Copy page URLs (one per line) or pipe them in.')
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim())
      const urlIdx = parts.findIndex((p) => /^https?:\/\//i.test(p) || /^(www\.)?(facebook|instagram|tiktok)\.com\//i.test(p))
      if (urlIdx < 0) { console.log(`skipped (no URL): ${line}`); continue }
      const url = parts[urlIdx].startsWith('http') ? parts[urlIdx] : `https://${parts[urlIdx]}`
      if (/facebook\.com\/(groups|marketplace)\//i.test(url)) {
        console.log(`skipped (a group or Marketplace, not a page you can DM): ${url}`)
        continue
      }
      const kind = classifyUrl(url)
      const name = (urlIdx > 0 ? parts[0] : '') || nameFromUrl(url)
      const notes = parts.slice(urlIdx + 1).join(' | ') || null
      console.log(saveLead({
        source: 'social', name, city: opt.city ?? null, notes,
        fb_url: kind === 'fb' ? url : null, ig_url: kind === 'ig' ? url : null,
        tiktok_url: kind === 'tiktok' ? url : null, website: kind ? null : url,
      }))
    }
  },

  import() {
    if (!pos[0]) throw new Error('usage: import leads.csv')
    const rows = parseCsv(readFileSync(pos[0], 'utf8'))
    for (const r of rows) {
      if (!r.name) continue
      console.log(saveLead({
        source: 'csv', name: r.name, city: r.city || null, fb_url: r.fb_url || null, ig_url: r.ig_url || null,
        tiktok_url: r.tiktok_url || null, email: r.email?.toLowerCase() || null, phone: r.phone || null,
        website: r.website || null, notes: r.notes || null,
      }))
    }
  },

  async enrich() {
    const leads = db
      .prepare("select * from leads where status = 'new' and website is not null order by id limit ?")
      .all(limit(50)) as Lead[]
    console.log(`scanning ${leads.length} websites…`)
    await pool(leads, 5, async (l) => {
      const info = await scanWebsite(l.website!)
      const fields: Partial<Lead> = { status: 'enriched' }
      if (!l.email && info.emails[0]) fields.email = info.emails[0]
      if (!l.fb_url && info.fb) fields.fb_url = info.fb
      if (!l.ig_url && info.ig) fields.ig_url = info.ig
      if (!l.tiktok_url && info.tiktok) fields.tiktok_url = info.tiktok
      if (info.summary) fields.notes = [l.notes, `Website: ${info.summary}`].filter(Boolean).join('\n')
      fields.channel = pickChannel({ ...l, ...fields } as Lead)
      updateLead(l.id, fields)
      console.log(`${oneLine(getLead(l.id)!)}${info.emails[0] ? `  ✉ ${info.emails[0]}` : ''}`)
    })
    // Leads without a website still move on if they already have a channel.
    db.prepare("update leads set status = 'enriched' where status = 'new' and website is null and channel is not null").run()
  },

  async draft() {
    const leads = db
      .prepare(`select * from leads where status in ('new','enriched') and channel is not null
                and not exists (select 1 from messages m where m.lead_id = leads.id and m.status = 'draft')
                order by coalesce(rating_count,0) desc, id limit ?`)
      .all(limit(20)) as Lead[]
    const skipped = (db.prepare("select count(*) n from leads where status in ('new','enriched') and channel is null").get() as { n: number }).n
    if (skipped) console.log(`(${skipped} leads have no way to contact them — add a page URL with \`add\`)`)
    const bps = await liveServiceFeeBps()
    console.log(`drafting ${leads.length} openers · live service fee ${bps == null ? 'unavailable' : `${bps / 100}%`}`)
    await pool(leads, 4, async (l) => {
      try {
        const d = await draftMessage(l, 'opener', [], bps)
        if (d.fit === 'no') {
          updateLead(l.id, { status: 'not_a_fit', fit: d.fit, fit_reason: d.fit_reason })
          console.log(`✗ #${l.id} ${l.name}: ${d.fit_reason}`)
          return
        }
        addMessage({
          lead_id: l.id, direction: 'out', channel: l.channel, kind: 'opener',
          subject: l.channel === 'email' ? d.subject : null, body: d.message, status: 'draft',
        })
        updateLead(l.id, { status: 'drafted', fit: d.fit, fit_reason: d.fit_reason })
        console.log(`✓ #${l.id} ${l.name} [${l.channel}${d.fit === 'unsure' ? ', unsure fit' : ''}]\n  ${d.message.replace(/\n/g, '\n  ')}\n`)
      } catch (e) {
        console.error(`! #${l.id} ${l.name}: ${(e as Error).message}`)
      }
    })
    console.log('Next: npm run o -- queue   (DMs)   ·   npm run o -- email   (email, dry run)')
  },

  async queue() {
    // Everything a human sends: DM drafts on any channel, plus replies to email
    // threads (those go out from your own inbox so they stay in-thread).
    const drafts = handDrafts(limit(30))
    if (!drafts.length) return console.log('Queue is empty.')
    if (!process.stdin.isTTY) {
      throw new Error('queue needs a real terminal for keypresses. Use `next` + `sent <id>` instead (works anywhere).')
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const recent = () => (db.prepare(
      "select count(*) n from messages where direction='out' and channel != 'email' and status='sent' and sent_at > datetime('now','-1 hour')",
    ).get() as { n: number }).n
    console.log(`${drafts.length} to send. Keys: s sent · k skip · e edit · r redraft · n not a fit · x do-not-contact · q quit\n`)
    for (let i = 0; i < drafts.length; i++) {
      let m = drafts[i]
      const l = getLead(m.lead_id)!
      if (recent() >= 25) console.log('⚠ 25+ DMs in the last hour. Meta limits pages that blast — take a break.')
      const url = pageUrl(l)
      console.log(`── ${i + 1}/${drafts.length} · #${l.id} ${l.name} · ${m.kind} via ${m.channel}`)
      if (m.channel === 'phone') console.log(`   Viber/SMS: ${l.phone}`)
      else if (m.channel === 'email') console.log(`   Reply in your inbox to: ${l.email}`)
      else if (url) console.log(`   ${url}`)
      console.log(`\n${m.body}\n`)
      copy(m.body)
      if (url && m.channel !== 'email' && m.channel !== 'phone') openUrl(url)
      for (;;) {
        const k = (await rl.question('[s/k/e/r/n/x/q] (copied) > ')).trim().toLowerCase()
        if (k === 's') { markSent(m.id); console.log('   sent ✓\n'); break }
        if (k === 'k') { console.log(''); break }
        if (k === 'q') { rl.close(); return }
        if (k === 'n') {
          db.prepare("update messages set status='skipped' where id=?").run(m.id)
          updateLead(l.id, { status: 'not_a_fit' }); break
        }
        if (k === 'x') {
          db.prepare("update messages set status='skipped' where lead_id=? and status='draft'").run(l.id)
          addDnc(l, 'manual'); updateLead(l.id, { status: 'dnc' }); break
        }
        if (k === 'e') {
          const body = editInEditor(m.body)
          db.prepare('update messages set body=? where id=?').run(body, m.id)
          m = { ...m, body }; copy(body); console.log(`\n${body}\n(copied)`)
        }
        if (k === 'r') {
          const kind = m.kind === 'reply' ? null : (m.kind as 'opener' | 'followup1' | 'followup2')
          if (!kind) { console.log('Redraft replies with `reply <id>`.'); continue }
          const d = await draftMessage(l, kind, messagesFor(l.id).filter((x) => x.id !== m.id), await liveServiceFeeBps())
          db.prepare('update messages set body=? where id=?').run(d.message, m.id)
          m = { ...m, body: d.message }; copy(d.message); console.log(`\n${d.message}\n(copied)`)
        }
      }
    }
    rl.close()
  },

  next() {
    // Non-interactive queue: shows the Nth waiting draft, copies it, opens the page.
    const n = Number(pos[0] ?? 1)
    const drafts = handDrafts(n)
    const m = drafts[n - 1]
    if (!m) return console.log(drafts.length ? `Only ${drafts.length} waiting.` : 'Queue is empty.')
    showDraft(m, `${n} of ${handDrafts(1000).length} waiting`)
    console.log(`(copied) After you send it: npm run o -- sent ${m.id}   ·   see the one after: npm run o -- next ${n + 1}`)
  },

  sent() {
    const m = db.prepare("select * from messages where id = ? and status = 'draft'").get(Number(pos[0])) as Message | undefined
    if (!m) throw new Error('usage: sent <message id>  (the id shown by `next`; it must still be a draft)')
    markSent(m.id)
    console.log(`message ${m.id} marked sent · ${oneLine(getLead(m.lead_id)!)}`)
  },

  async email() {
    const cfg = emailConfig()
    const sentToday = (db.prepare(
      "select count(*) n from messages where channel='email' and direction='out' and status='sent' and sent_at >= date('now')",
    ).get() as { n: number }).n
    const room = Math.max(0, cfg.cap - sentToday)
    const drafts = db
      .prepare(`select m.* from messages m join leads l on l.id = m.lead_id
                where m.status='draft' and m.channel='email' and m.kind != 'reply'
                  and l.status not in ('dnc','closed','not_a_fit','replied','signed_up','listed')
                order by m.id limit ?`)
      .all(Math.min(limit(room), room)) as Message[]
    console.log(`${drafts.length} emails · ${sentToday}/${cfg.cap} sent today · ${opt.live ? 'LIVE' : 'dry run (add --live to send)'}`)
    if (opt.live && cfg.problems.length) throw new Error(cfg.problems.join('\n'))
    for (const m of drafts) {
      const l = getLead(m.lead_id)!
      // Follow-ups reply under the opener's subject so they land in the same thread.
      const opener = messagesFor(l.id).find((x) => x.kind === 'opener' && x.channel === 'email')
      const subject = m.kind === 'opener'
        ? m.subject || 'listing your gear on Rentivo'
        : `Re: ${opener?.subject || 'listing your gear on Rentivo'}`
      const text = m.body + footer(l.name)
      if (!opt.live) {
        console.log(`\n── #${l.id} → ${l.email}\nSubject: ${subject}\n\n${text}`)
        continue
      }
      try {
        await sendEmail(l.email!, subject, text)
        markSent(m.id)
        console.log(`✓ #${l.id} ${l.email}`)
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 3000)) // don't send in a burst
      } catch (e) {
        console.error(`! #${l.id} ${l.email}: ${(e as Error).message}`)
      }
    }
  },

  async followups() {
    // Owner's rule (2026-09-24): message each host ONCE. OUTREACH_MAX_FOLLOWUPS defaults to 0,
    // so this only closes leads that never answered (after 14 days). Set it to 1 or 2 to re-enable.
    const max = Math.min(2, Math.max(0, Number(process.env.OUTREACH_MAX_FOLLOWUPS ?? 0)))
    const quietDays = max === 0 ? 14 : 7
    const closed = db.prepare(`update leads set status='closed', updated_at=datetime('now')
      where status='contacted' and followups >= ? and last_contacted_at < datetime('now', ?)`).run(max, `-${quietDays} days`)
    const due = db
      .prepare(`select * from leads l where status='contacted' and followups < ?
                and not exists (select 1 from messages m where m.lead_id=l.id and m.status='draft')
                and ((followups = 0 and last_contacted_at < datetime('now','-4 days'))
                  or (followups = 1 and first_contacted_at < datetime('now','-10 days') and last_contacted_at < datetime('now','-3 days')))
                order by last_contacted_at`)
      .all(max) as Lead[]
    console.log(`${closed.changes} quiet leads closed · ${max === 0 ? 'follow-ups are off (one message per host)' : `${due.length} follow-ups due`}`)
    const bps = await liveServiceFeeBps()
    await pool(due, 4, async (l) => {
      const kind = l.followups === 0 ? 'followup1' : 'followup2'
      try {
        const d = await draftMessage(l, kind, messagesFor(l.id), bps)
        addMessage({
          lead_id: l.id, direction: 'out', channel: l.channel, kind,
          subject: l.channel === 'email' ? d.subject : null, body: d.message, status: 'draft',
        })
        console.log(`✓ #${l.id} ${l.name} ${kind} [${l.channel}]`)
      } catch (e) {
        console.error(`! #${l.id}: ${(e as Error).message}`)
      }
    })
    if (due.length) console.log('Next: queue (DMs) and email --live (email)')
  },

  async reply() {
    const l = getLead(Number(pos[0]))
    if (!l) throw new Error('usage: reply <lead id> [--text "their message"]  (or pipe it on stdin)')
    let text = opt.text
    if (!text) {
      if (process.stdin.isTTY) console.log('Paste their reply, then Ctrl-D:')
      text = readFileSync(0, 'utf8')
    }
    text = text.trim()
    if (!text) throw new Error('empty reply')
    // Triage before writing anything, so a failed API call can simply be re-run.
    const t = await triageReply(l, messagesFor(l.id), text, await liveServiceFeeBps())
    addMessage({
      lead_id: l.id, direction: 'in', channel: l.channel, kind: 'inbound', subject: null, body: text,
      status: 'received', bucket: t.bucket, question: t.question || null, sent_at: null,
    })
    // They answered, so pending follow-ups (and any older reply draft) are moot.
    db.prepare("update messages set status='skipped' where lead_id=? and status='draft'").run(l.id)
    let status: Status = 'replied'
    if (t.signed_up) status = 'signed_up'
    if (t.bucket === 'closed') status = 'closed'
    if (t.opt_out) { status = 'dnc'; addDnc(l, 'asked to stop') }
    updateLead(l.id, { status })
    addMessage({ lead_id: l.id, direction: 'out', channel: l.channel, kind: 'reply', subject: null, body: t.suggested_reply, status: 'draft' })
    copy(t.suggested_reply)
    console.log(`\nBucket: ${t.bucket}${t.opt_out ? ' · OPT-OUT recorded, never contacted again' : ''} · status → ${status}`)
    if (t.question) console.log(`Their question: "${t.question}"`)
    console.log(`Note: ${t.note_for_founder}\n\n${t.suggested_reply}\n\n(copied — send it, then mark it sent in \`queue\`)`)
  },

  set() {
    const [id, status] = pos
    if (!getLead(Number(id)) || !STATUSES.includes(status as Status)) {
      throw new Error(`usage: set <id> <${STATUSES.join('|')}>`)
    }
    if (status === 'dnc') return commands.dnc()
    updateLead(Number(id), { status: status as Status })
    console.log(oneLine(getLead(Number(id))!))
  },

  dnc() {
    const l = getLead(Number(pos[0]))
    if (!l) throw new Error('usage: dnc <id>')
    addDnc(l, 'manual')
    db.prepare("update messages set status='skipped' where lead_id=? and status='draft'").run(l.id)
    updateLead(l.id, { status: 'dnc' })
    console.log(`#${l.id} ${l.name} will never be contacted again.`)
  },

  list() {
    const where: string[] = []
    const args: string[] = []
    if (opt.status) { where.push('status = ?'); args.push(opt.status) }
    if (opt.q) { where.push('name like ?'); args.push(`%${opt.q}%`) }
    if (opt.city) { where.push('city like ?'); args.push(`%${opt.city}%`) }
    const rows = db
      .prepare(`select * from leads ${where.length ? `where ${where.join(' and ')}` : ''} order by updated_at desc limit ${limit(50)}`)
      .all(...args) as Lead[]
    for (const l of rows) console.log(oneLine(l))
  },

  show() {
    const l = getLead(Number(pos[0]))
    if (!l) throw new Error('usage: show <id>')
    for (const [k, v] of Object.entries(l)) if (v != null && v !== '') console.log(`${k.padEnd(19)} ${v}`)
    for (const m of messagesFor(l.id)) {
      console.log(`\n[${m.direction === 'out' ? '→' : '←'} ${m.kind} · ${m.status}${m.bucket ? ` · ${m.bucket}` : ''} · ${m.sent_at ?? m.created_at}]`)
      if (m.subject) console.log(`Subject: ${m.subject}`)
      console.log(m.body)
    }
  },

  stats() {
    const by = Object.fromEntries(
      (db.prepare('select status, count(*) n from leads group by status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
    )
    const n = (s: string) => by[s] ?? 0
    const total = Object.values(by).reduce((a, b) => a + b, 0)
    const contacted = (db.prepare('select count(*) n from leads where first_contacted_at is not null').get() as { n: number }).n
    const replied = (db.prepare("select count(distinct lead_id) n from messages where direction='in'").get() as { n: number }).n
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
    console.log(`leads            ${total}`)
    for (const s of STATUSES) if (n(s)) console.log(`  ${s.padEnd(14)} ${n(s)}`)
    console.log(`contacted        ${contacted}`)
    console.log(`replied          ${replied}  (${pct(replied, contacted)} of contacted)`)
    console.log(`signed up        ${n('signed_up') + n('listed')}  (${pct(n('signed_up') + n('listed'), contacted)})`)
    console.log(`listed           ${n('listed')}`)
    const buckets = db.prepare("select bucket, count(*) n from messages where direction='in' and bucket is not null group by bucket order by n desc").all() as { bucket: string; n: number }[]
    if (buckets.length) console.log(`reply buckets    ${buckets.map((b) => `${b.bucket} ${b.n}`).join(' · ')}`)
    const byChannel = db.prepare(`select l.channel, count(distinct l.id) sent,
        count(distinct case when m2.id is not null then l.id end) replied
      from leads l join messages m on m.lead_id=l.id and m.direction='out' and m.status='sent'
      left join messages m2 on m2.lead_id=l.id and m2.direction='in'
      group by l.channel`).all() as { channel: string; sent: number; replied: number }[]
    for (const c of byChannel) console.log(`  via ${String(c.channel).padEnd(8)} ${c.replied}/${c.sent} replied (${pct(c.replied, c.sent)})`)
  },

  questions() {
    const rows = db
      .prepare(`select m.question, m.bucket, l.name from messages m join leads l on l.id=m.lead_id
                where m.direction='in' and m.question is not null order by m.bucket, m.id`)
      .all() as { question: string; bucket: string; name: string }[]
    if (!rows.length) return console.log('No questions logged yet.')
    for (const r of rows) console.log(`[${r.bucket}] "${r.question}" — ${r.name}`)
  },

  export() {
    const rows = db.prepare('select * from leads order by id').all() as Record<string, unknown>[]
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    console.log(cols.join(','))
    for (const r of rows) console.log(cols.map((c) => csvCell(r[c])).join(','))
  },
}

const run = command ? commands[command] : undefined
if (!run) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 21).map((l) => l.slice(3)).join('\n'))
  process.exit(command ? 1 : 0)
}
try {
  await run()
} catch (e) {
  console.error(`error: ${(e as Error).message}`)
  process.exit(1)
}
