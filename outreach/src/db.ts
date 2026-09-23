// Local SQLite store. Leads are personal data (names, phone numbers, emails),
// so they live in data/leads.db on this machine only — gitignored, never
// pushed to the app's Supabase project.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.OUTREACH_DB ?? join(here, '..', 'data', 'leads.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')

db.exec(`
create table if not exists leads (
  id                 integer primary key,
  source             text not null,            -- places | manual | csv
  place_id           text unique,
  name               text not null,
  city               text,
  address            text,
  phone              text,
  website            text,
  email              text,
  fb_url             text,
  ig_url             text,
  tiktok_url         text,
  maps_url           text,
  rating             real,
  rating_count       integer,
  channel            text,                     -- email | fb | ig | tiktok | phone
  status             text not null default 'new',
  fit                text,                     -- yes | no | unsure (from the drafter)
  fit_reason         text,
  notes              text,
  first_contacted_at text,
  last_contacted_at  text,
  followups          integer not null default 0,
  created_at         text not null default (datetime('now')),
  updated_at         text not null default (datetime('now'))
);
create table if not exists messages (
  id          integer primary key,
  lead_id     integer not null references leads(id) on delete cascade,
  direction   text not null,                   -- out | in
  channel     text,
  kind        text not null,                   -- opener | followup1 | followup2 | reply | inbound
  subject     text,
  body        text not null,
  status      text not null,                   -- draft | sent | skipped | received
  bucket      text,                            -- triage bucket for inbound
  question    text,                            -- their question, verbatim (inbound only)
  created_at  text not null default (datetime('now')),
  sent_at     text
);
-- Do-not-contact: any identifier (email, url, place id, phone). Checked on
-- every import and every send, so a re-found business is never re-contacted.
create table if not exists dnc (
  value      text primary key,
  reason     text,
  created_at text not null default (datetime('now'))
);
create index if not exists messages_lead_idx on messages(lead_id);
`)

export const STATUSES = [
  'new', 'enriched', 'drafted', 'contacted', 'replied',
  'signed_up', 'listed', 'closed', 'not_a_fit', 'dnc',
] as const
export type Status = (typeof STATUSES)[number]

export type Lead = {
  id: number
  source: string
  place_id: string | null
  name: string
  city: string | null
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  fb_url: string | null
  ig_url: string | null
  tiktok_url: string | null
  maps_url: string | null
  rating: number | null
  rating_count: number | null
  channel: string | null
  status: Status
  fit: string | null
  fit_reason: string | null
  notes: string | null
  first_contacted_at: string | null
  last_contacted_at: string | null
  followups: number
  created_at: string
}

export type Message = {
  id: number
  lead_id: number
  direction: 'out' | 'in'
  channel: string | null
  kind: string
  subject: string | null
  body: string
  status: string
  bucket: string | null
  question: string | null
  created_at: string
  sent_at: string | null
}

export function normalizeId(value: string): string {
  // Keep the path (a social URL's page handle); drop scheme, www./m., query, hash, trailing slash.
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.|m\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

export function identifiers(l: Partial<Lead>): string[] {
  return [l.place_id, l.email, l.website, l.fb_url, l.ig_url, l.tiktok_url, l.phone]
    .filter((v): v is string => !!v)
    .map(normalizeId)
}

export function isDnc(l: Partial<Lead>): boolean {
  const ids = identifiers(l)
  if (!ids.length) return false
  const q = db.prepare(`select 1 from dnc where value in (${ids.map(() => '?').join(',')}) limit 1`)
  return !!q.get(...ids)
}

export function addDnc(l: Partial<Lead>, reason: string) {
  const ins = db.prepare('insert or ignore into dnc (value, reason) values (?, ?)')
  for (const id of identifiers(l)) ins.run(id, reason)
}

/** Existing lead sharing any identifier — so a Places hit and a manual add of the same FB page merge. */
export function findExisting(l: Partial<Lead>): Lead | undefined {
  if (l.place_id) {
    const hit = db.prepare('select * from leads where place_id = ?').get(l.place_id) as Lead | undefined
    if (hit) return hit
  }
  for (const col of ['email', 'website', 'fb_url', 'ig_url', 'tiktok_url'] as const) {
    const v = l[col]
    if (!v) continue
    const rows = db.prepare(`select * from leads where ${col} is not null`).all() as Lead[]
    const hit = rows.find((r) => r[col] && normalizeId(r[col]!) === normalizeId(v))
    if (hit) return hit
  }
  return undefined
}

const LEAD_COLS = [
  'source', 'place_id', 'name', 'city', 'address', 'phone', 'website', 'email', 'fb_url',
  'ig_url', 'tiktok_url', 'maps_url', 'rating', 'rating_count', 'channel', 'notes',
] as const

export type NewLead = Partial<Pick<Lead, (typeof LEAD_COLS)[number]>> & { name: string; source: string }

/** Insert, or fill blanks on an existing match. Returns null when the lead is on the DNC list. */
export function upsertLead(l: NewLead): { lead: Lead; created: boolean } | null {
  if (isDnc(l)) return null
  const existing = findExisting(l)
  if (existing) {
    const sets: string[] = []
    const vals: (string | number | null)[] = []
    for (const c of LEAD_COLS) {
      if (c === 'source') continue
      const v = l[c]
      if (v != null && v !== '' && existing[c] == null) {
        sets.push(`${c} = ?`)
        vals.push(v)
      }
    }
    if (sets.length) {
      db.prepare(`update leads set ${sets.join(', ')}, updated_at = datetime('now') where id = ?`).run(...vals, existing.id)
    }
    return { lead: getLead(existing.id)!, created: false }
  }
  const cols = LEAD_COLS.filter((c) => l[c] != null && l[c] !== '')
  const res = db
    .prepare(`insert into leads (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => l[c] as string | number))
  return { lead: getLead(Number(res.lastInsertRowid))!, created: true }
}

export function getLead(id: number): Lead | undefined {
  return db.prepare('select * from leads where id = ?').get(id) as Lead | undefined
}

export function updateLead(id: number, fields: Partial<Lead>) {
  const keys = Object.keys(fields) as (keyof Lead)[]
  if (!keys.length) return
  db.prepare(`update leads set ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') where id = ?`).run(
    ...keys.map((k) => fields[k] as string | number | null),
    id,
  )
}

export function messagesFor(leadId: number): Message[] {
  return db.prepare('select * from messages where lead_id = ? order by id').all(leadId) as Message[]
}

export function addMessage(
  m: Omit<Message, 'id' | 'created_at' | 'sent_at' | 'bucket' | 'question'> & {
    bucket?: string | null
    question?: string | null
    sent_at?: string | null
  },
): number {
  const res = db
    .prepare(
      `insert into messages (lead_id, direction, channel, kind, subject, body, status, bucket, question, sent_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.lead_id, m.direction, m.channel, m.kind, m.subject, m.body, m.status, m.bucket ?? null, m.question ?? null, m.sent_at ?? null)
  return Number(res.lastInsertRowid)
}

/** Record an outbound message as sent and move the lead's contact clock. */
export function markSent(messageId: number) {
  const m = db.prepare('select * from messages where id = ?').get(messageId) as Message
  db.prepare("update messages set status = 'sent', sent_at = datetime('now') where id = ?").run(messageId)
  const lead = getLead(m.lead_id)!
  const fields: Partial<Lead> = { last_contacted_at: sqlNow() }
  if (!lead.first_contacted_at) fields.first_contacted_at = sqlNow()
  if (m.kind === 'followup1' || m.kind === 'followup2') fields.followups = lead.followups + 1
  if (['new', 'enriched', 'drafted'].includes(lead.status)) fields.status = 'contacted'
  updateLead(lead.id, fields)
}

export function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}
