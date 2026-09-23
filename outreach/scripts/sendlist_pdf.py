"""Builds the co-worker send list from the outreach DB: every draft opener, grouped by region,
with all known links, as a PDF (reading/tracking) + a .txt (clean copy-paste).

    python3 outreach/scripts/sendlist_pdf.py      # needs: pip install reportlab; macOS Arial fonts

Writes ../../Rentivo-Host-Send-List.{pdf,txt} and data/sendlist-map.csv (list number → message id),
so a returned tracker ("sent 1, 2, 5") can be mapped back with `npm run o -- sent <message id>`.
Leads are personal data: the outputs stay out of git.
"""
import sqlite3, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUTREACH = os.path.dirname(HERE)
REPO = os.path.dirname(OUTREACH)
from xml.sax.saxutils import escape
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
                                KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf"))
pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("AI", F + "Arial Italic.ttf"))
pdfmetrics.registerFontFamily("A", normal="A", bold="AB", italic="AI", boldItalic="AB")

NAVY = colors.HexColor("#003049"); GREY = colors.HexColor("#5B6573")
LINE = colors.HexColor("#D9DEE4"); BOX = colors.HexColor("#F4F6F8"); CREAM = colors.HexColor("#FDF0D5")

H1 = ParagraphStyle("h1", fontName="AB", fontSize=20, leading=24, textColor=NAVY, spaceAfter=4)
SUB = ParagraphStyle("sub", fontName="A", fontSize=10, leading=14, textColor=GREY, spaceAfter=8)
H2 = ParagraphStyle("h2", fontName="AB", fontSize=13, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=5)
P = ParagraphStyle("p", fontName="A", fontSize=9.5, leading=13.5, spaceAfter=4)
BUL = ParagraphStyle("b", parent=P, leftIndent=12, bulletIndent=2, spaceAfter=2)
SMALL = ParagraphStyle("s", fontName="A", fontSize=8.3, leading=11, textColor=GREY)
CELL = ParagraphStyle("c", fontName="A", fontSize=8.8, leading=11.5)
HEAD = ParagraphStyle("hd", parent=CELL, fontName="AB", textColor=colors.white)
MSG = ParagraphStyle("m", fontName="A", fontSize=9.3, leading=12.8)
TITLE = ParagraphStyle("t", fontName="AB", fontSize=14, leading=17, textColor=NAVY)
META = ParagraphStyle("meta", fontName="A", fontSize=9.5, leading=13)

PLATFORM = {"fb": "Facebook", "ig": "Instagram", "tiktok": "TikTok", "web": "Website form"}
db = sqlite3.connect(os.path.join(OUTREACH, "data", "leads.db"))
db.row_factory = sqlite3.Row
rows = db.execute("""select m.id mid, m.body, l.* from messages m join leads l on l.id = m.lead_id
                     where m.status = 'draft' and m.kind = 'opener' order by m.id""").fetchall()
REGIONS = [
    ("Metro Manila", {"Quezon City", "Metro Manila"}),
    ("North & Central Luzon", {"Baguio City", "Pampanga", "Bulacan"}),
    ("South Luzon & Bicol", {"Laguna", "Cavite", "Batangas", "Lipa City", "Naga City"}),
    ("Visayas", {"Cebu City", "Iloilo City", "Bacolod City", "Dumaguete City"}),
    ("Mindanao", {"Davao City", "Cagayan de Oro", "Zamboanga City"}),
    ("Nationwide / location unknown", set()),
]
def region(r):
    for name, cities in REGIONS:
        if (r["city"] or "") in cities: return name
    return REGIONS[-1][0]
def size(r):
    n = (r["notes"] or "").lower()
    if "size: big" in n or "size: large" in n: return "Large"
    if "size: medium" in n: return "Medium"
    return ""
RANK = {"Medium": 0, "Large": 1, "": 2}
ORDER = [n for n, _ in REGIONS]
rows = sorted(rows, key=lambda r: (ORDER.index(region(r)), RANK[size(r)], r["mid"]))
NUM = {r["mid"]: i + 1 for i, r in enumerate(rows)}
# Map the list's numbers back to the tool's message ids ("sent 1, 2, 5" → sent <mid>).
import csv
with open(os.path.join(OUTREACH, "data", "sendlist-map.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["list_no", "message_id", "lead_id", "name"])
    for r in rows: w.writerow([NUM[r["mid"]], r["mid"], r["id"], r["name"]])

def link(r):
    return {"fb": r["fb_url"], "ig": r["ig_url"], "tiktok": r["tiktok_url"], "web": r["website"]}[r["channel"]]

def all_links(r):
    out = []
    for label, key in (("Facebook", "fb_url"), ("Instagram", "ig_url"), ("TikTok", "tiktok_url"), ("Website", "website")):
        if r[key]: out.append((label, r[key]))
    return out

def bullets(items):
    return [Paragraph(x, BUL, bulletText="•") for x in items]

def footer(c, doc):
    c.saveState(); c.setFont("A", 7.5); c.setFillColor(GREY)
    c.drawString(18 * mm, 10 * mm, "Rentivo · Host outreach send list · internal, do not forward")
    c.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    c.restoreState()

story = [
    Paragraph("Host Outreach: Send List", H1),
    Paragraph(f"{len(rows)} camera and phone rental businesses across the Philippines · prepared 23 September 2026 by JP. "
              "Grouped by region. Within each region: medium-size businesses first (the best fit), then large rental houses, then smaller pages. Each host page has every link we found and the exact message to send.", SUB),
    Paragraph("How to send each message", H2),
]
story += bullets([
    "Each host page says <b>Send via</b>: Facebook, Instagram or Website form. Open that link, logged in as the "
    "<b>Rentivo</b> account, not your personal one. The other links are there so you can check the business is "
    "real and active. Send the message <b>once, on one platform only</b>.",
    "<b>Website form</b>: open their website, find Contact or Book, and paste the message there.",
    "<b>Check the page is active</b>: a post in the last 2–3 months and a working Message button. "
    "If it looks dead, tick <b>Inactive</b> in the tracker and skip it.",
    "Click <b>Message</b>, paste the message, read it once, and send.",
    "Write the <b>date</b> in the tracker (page 2), then move on to the next one.",
])
story.append(Paragraph("Copying tip", H2))
story.append(Paragraph(
    "Copying from a PDF can break lines in the middle of sentences. Use the companion file "
    "<b>Rentivo-Host-Send-List.txt</b> to copy the messages. It has the same messages in the same order, numbered "
    "the same way. This PDF is for reading, checking and tracking.", P))
story.append(Paragraph("Rules", H2))
story += bullets([
    "<b>10–15 messages a day at most</b>, with 1–2 minutes between each. Sending many long messages quickly gets the "
    "page flagged as spam by Meta.",
    "<b>Only change the first line</b>, and only if it's wrong (for example, they no longer rent the camera it names). "
    "Never change the facts: the fee, payouts, deposit, insurance, payment method.",
    "<b>One message per business, ever.</b> No second message unless JP says so. JP handles follow-ups.",
    "Never post in groups or comment on posts. Only send private messages to the page.",
    "If a page says <b>no</b>, <b>stop</b> or <b>not interested</b>, reply once with \"Okay po, salamat! Hindi na po "
    "kami mag-me-message.\" and tick <b>Said no</b>. Never contact them again.",
])
story.append(Paragraph("When a host replies", H2))
story += bullets([
    "<b>Don't answer questions about fees, payouts, damage or insurance from memory.</b> Screenshot the reply and send "
    "it to JP. JP will send you the exact answer to paste.",
    "Simple replies are fine to answer yourself: \"Thank you!\", \"Here's the link: rentivo.live\", "
    "\"JP will message you shortly.\"",
    "Reply within the hour if you can. A host who replied is interested right then.",
])
story.append(Paragraph("When you're done, give JP the tracker (a photo is fine) so the sent dates can be recorded.", SMALL))

# ---- tracker
story.append(PageBreak())
story.append(Paragraph("Tracker", H2))
story.append(Paragraph("Write the date sent. Tick one box in the last column if it applies. The # matches the message pages.", SMALL))
story.append(Spacer(1, 4))
data = [[Paragraph(h, HEAD) for h in ["#", "Business", "City", "Size", "Send via", "Date sent", "Replied / No / Inactive"]]]
region_rows = []
current = None
for r in rows:
    if region(r) != current:
        current = region(r)
        region_rows.append(len(data))
        data.append([Paragraph(f"<b>{escape(current)}</b>", CELL), "", "", "", "", "", ""])
    data.append([Paragraph(str(NUM[r["mid"]]), CELL), Paragraph(escape(r["name"]), CELL), Paragraph(escape(r["city"] or ""), CELL),
                 Paragraph(size(r), CELL), Paragraph(PLATFORM.get(r["channel"], r["channel"]), CELL), Paragraph("", CELL),
                 Paragraph("[ ] Replied [ ] No [ ] Inactive", CELL)])
t = Table(data, colWidths=[9 * mm, 42 * mm, 23 * mm, 17 * mm, 19 * mm, 18 * mm, 46 * mm], repeatRows=1)
st = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
      ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 7),
      ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("BOX", (5, 1), (5, -1), 0.4, LINE)]
for i in region_rows:
    st += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), CREAM)]
t.setStyle(TableStyle(st))
story.append(t)

# ---- one page per host
for r in rows:
    story.append(PageBreak())
    url = link(r)
    head = Table([[Paragraph(f"#{NUM[r['mid']]} · {escape(r['name'])}", TITLE)]], colWidths=[174 * mm])
    head.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CREAM), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                              ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.append(head)
    story.append(Spacer(1, 6))
    tag = f" · <b>Size:</b> {size(r)}" if size(r) else ""
    story.append(Paragraph(f"<b>Send via:</b> {PLATFORM.get(r['channel'], r['channel'])} · <b>City:</b> {escape(r['city'] or '—')} · "
                           f"<b>Region:</b> {escape(region(r))}{tag}", META))
    for label, u in all_links(r):
        mark = " <b>← send here</b>" if u == url else ""
        story.append(Paragraph(f"<b>{label}:</b> <link href='{escape(u)}' color='#003049'><u>{escape(u)}</u></link>{mark}", META))
    if r["email"]:
        story.append(Paragraph(f"<b>Email:</b> {escape(r['email'])} <i>(don't email as well; JP handles email)</i>", META))
    if r["notes"]:
        note = r["notes"].splitlines()[0].replace("size: big — ", "").replace("size: large — ", "").replace("size: medium — ", "")
        story.append(Paragraph(f"<b>What we know:</b> {escape(note)}", META))
    if r["channel"] == "ig":
        story.append(Paragraph("<i>Instagram version: shorter, because Instagram limits messages to 1,000 characters.</i>", SMALL))
    if r["channel"] == "web":
        story.append(Paragraph("<i>No Facebook or Instagram page found. Use the Contact or Book form on their website.</i>", SMALL))
    story.append(Spacer(1, 8))
    body = "<br/>".join(escape(line) for line in r["body"].split("\n"))
    box = Table([[Paragraph(body, MSG)]], colWidths=[174 * mm])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BOX), ("LINEBEFORE", (0, 0), (0, -1), 3, NAVY),
                             ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                             ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    story.append(box)
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Sent on: ____________    [ ] Replied    [ ] Said no    [ ] Inactive page", META))

out = os.path.join(REPO, "Rentivo-Host-Send-List")
SimpleDocTemplate(out + ".pdf", pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm,
                  bottomMargin=16 * mm, title="Rentivo Host Outreach Send List", author="Rentivo").build(
    story, onFirstPage=footer, onLaterPages=footer)

with open(out + ".txt", "w", encoding="utf-8") as f:
    f.write("RENTIVO HOST OUTREACH, SEND LIST\n")
    f.write("Copy each message between the lines. Same numbers as the PDF.\n\n")
    for r in rows:
        f.write("=" * 60 + "\n")
        f.write(f"#{NUM[r['mid']]} · {r['name']} · {r['city'] or ''} · {region(r)} · send via {PLATFORM.get(r['channel'], r['channel'])}\n")
        for label, u in all_links(r):
            f.write(f"  {label}: {u}\n")
        f.write("-" * 60 + "\n")
        f.write(r["body"].rstrip() + "\n\n")
print(len(rows), "hosts")
