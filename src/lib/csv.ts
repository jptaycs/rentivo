/**
 * RFC4180-ish CSV. Every field is quoted and embedded quotes are doubled, so a
 * listing title containing a comma or a quote can't corrupt the file.
 *
 * NOTE: `/dashboard/earnings` has its own older toCsv() that quotes only some
 * fields and does not escape embedded quotes. That is a real (pre-existing) bug
 * in that page, deliberately left alone here rather than pulled into this
 * change's scope — but do not copy its approach.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}
