/**
 * RFC4180-ish CSV. Every field is quoted and embedded quotes are doubled, so a
 * listing title containing a comma or a quote can't corrupt the file.
 *
 * It also neutralizes spreadsheet formula injection. Excel, LibreOffice and
 * Google Sheets treat a cell whose text begins with `=`, `+`, `-` or `@` as a
 * formula, and RFC4180 quoting does NOT stop that — the quotes are stripped
 * during import and the formula still evaluates. That matters here because
 * these exports carry host-authored strings: listing titles and profile names
 * go into `/admin/reports`' CSVs verbatim, so a host who names a listing
 * `=HYPERLINK(...)` (or worse, an Excel-4 macro) is writing a live formula
 * into a file an admin opens on their own machine. Prefixing a single
 * apostrophe is the standard mitigation: spreadsheets read it as "this cell is
 * text" and don't display it, while a plain text editor shows one stray quote
 * at the front of an affected field. A leading tab/CR/LF is stripped first,
 * since a formula character after one is still treated as leading.
 *
 * Numbers are exempt — they're produced by this codebase, never by a user, and
 * a negative amount must not become the string "'-350".
 *
 * `/dashboard/earnings` used to carry its own weaker toCsv() — it quoted only
 * some fields, never escaped embedded quotes, and had no formula guard. It was
 * switched onto this module on 2026-09-04, so this is now the only CSV writer
 * in the app. Keep it that way: a second local helper is how the first one
 * ended up shipping both defects.
 */
const FORMULA_LEAD = /^[=+\-@]/

function neutralize(text: string): string {
  const trimmed = text.replace(/^[\t\r\n]+/, '')
  return FORMULA_LEAD.test(trimmed) ? `'${trimmed}` : text
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const raw = String(v ?? '')
    const safe = typeof v === 'number' ? raw : neutralize(raw)
    return `"${safe.replace(/"/g, '""')}"`
  }
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}
