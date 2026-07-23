from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "STCR-User-Manual.pdf"
RAW_DIR = ROOT / "output" / "manual-assets" / "raw"
ANNOTATED_DIR = ROOT / "output" / "manual-assets" / "annotated"
FONT_DIR = ROOT / "public" / "fonts"

PAGE_WIDTH, PAGE_HEIGHT = A4
YELLOW = colors.HexColor("#F1CE24")
ORANGE = colors.HexColor("#F07818")
RED = colors.HexColor("#E1262F")
DARK = colors.HexColor("#202733")
INK = colors.HexColor("#27313D")
MUTED = colors.HexColor("#647181")
LIGHT = colors.HexColor("#F3F5F7")
LINE = colors.HexColor("#D8DEE6")


# Each number is drawn on the exact control explained under the same screenshot.
ANNOTATIONS = {
    "01-login.png": [
        (1, (806, 338, 1205, 418)),
        (2, (806, 440, 1205, 512)),
        (3, (806, 530, 1205, 599)),
        (4, (806, 605, 1205, 663)),
    ],
    "02-dashboard.png": [
        (1, (244, 114, 1397, 198)),
        (2, (244, 211, 1397, 262)),
        (3, (821, 267, 1108, 512)),
        (4, (831, 461, 1099, 505)),
        (5, (0, 48, 230, 238)),
        (6, (858, 4, 931, 43)),
    ],
    "03-oven-realtime.png": [
        (1, (260, 132, 463, 181)),
        (2, (251, 199, 1049, 420)),
        (3, (744, 367, 1038, 411)),
        (4, (244, 421, 1397, 640)),
        (5, (245, 639, 1396, 897)),
    ],
    "04-oven-graphs.png": [
        (1, (246, 68, 1394, 477)),
        (2, (745, 145, 900, 181)),
        (3, (1250, 174, 1324, 337)),
        (4, (246, 489, 1394, 899)),
    ],
    "05-history.png": [
        (1, (358, 132, 461, 180)),
        (2, (267, 521, 484, 565)),
        (3, (267, 592, 762, 633)),
        (4, (1267, 522, 1374, 564)),
        (5, (722, 367, 1038, 412)),
    ],
    "06-alarm.png": [
        (1, (1326, 68, 1397, 99)),
        (2, (258, 151, 740, 193)),
        (3, (746, 151, 953, 193)),
        (4, (961, 151, 1168, 193)),
        (5, (1175, 151, 1384, 193)),
        (6, (1217, 253, 1320, 294)),
    ],
    "07-report.png": [
        (1, (494, 165, 787, 211)),
        (2, (793, 165, 1084, 211)),
        (3, (1090, 165, 1382, 211)),
        (4, (265, 306, 486, 352)),
        (5, (488, 312, 786, 356)),
        (6, (1160, 312, 1378, 356)),
    ],
    "08-report-form.png": [
        (1, (263, 288, 665, 417)),
        (2, (263, 429, 665, 578)),
        (3, (263, 594, 665, 682)),
        (4, (263, 698, 665, 897)),
        (5, (694, 187, 1395, 752)),
    ],
    "11-report-document.png": [
        (1, (263, 137, 663, 362)),
        (2, (263, 378, 663, 514)),
        (3, (263, 508, 663, 660)),
        (4, (263, 671, 663, 802)),
        (5, (277, 806, 652, 842)),
    ],
    "09-settings.png": [
        (1, (246, 122, 774, 264)),
        (2, (246, 278, 774, 591)),
        (3, (258, 545, 760, 584)),
        (4, (784, 122, 1422, 428)),
        (5, (796, 314, 930, 353)),
        (6, (1307, 66, 1423, 103)),
    ],
}


SECTIONS = [
    {
        "title": "1. เข้าสู่ระบบ",
        "intro": "เลือกบริษัทและใช้บัญชีที่ได้รับจากผู้ดูแลระบบ ขั้นตอนของ GR และ TTN เหมือนกัน",
        "image": "01-login.png",
        "steps": [
            (1, "เลือกบริษัท <b>GR</b> หรือ <b>TTN</b>"),
            (2, "กรอกชื่อผู้ใช้"),
            (3, "กรอกรหัสผ่าน"),
            (4, "กด <b>เข้าสู่ระบบ</b>"),
        ],
        "note": "หากขึ้น Failed to fetch ให้ตรวจว่าบริการ Node-RED API และเครือข่ายกำลังทำงาน แล้วลองใหม่",
    },
    {
        "title": "2. Dashboard และเมนูหลัก",
        "intro": "ใช้ดูภาพรวมทุกเตา ค้นหาเตา และเปิดหน้ารายละเอียดโดยไม่ต้องไล่ดูทีละหน้า",
        "image": "02-dashboard.png",
        "steps": [
            (1, "สรุปจำนวนเตาทั้งหมด กำลังอบ ปิด และขาดการเชื่อมต่อ"),
            (2, "ค้นหาเตา หรือกรองตามสถานะ"),
            (3, "การ์ดเตาแสดงสถานะ รอบ ค่าล่าสุด และเวลาอัปเดต"),
            (4, "กด <b>ดูรายละเอียดเตา</b> เพื่อเปิดกราฟของเตานั้น"),
            (5, "ใช้เมนูซ้ายเปิด Dashboard, Alarm, Report, Setting หรือเลือกเตา"),
            (6, "กด <b>คู่มือ</b> เพื่อดาวน์โหลดเอกสารฉบับนี้"),
        ],
        "note": "สถานะขาดการเชื่อมต่อหมายถึงระบบไม่ได้รับข้อมูลตามเวลาที่กำหนด ไม่ได้แปลว่าเตาปิด",
    },
    {
        "title": "3. รายละเอียดเตาและข้อมูลเรียลไทม์",
        "intro": "หน้ารายละเอียดรวมสถานะรอบ เวลาทำงาน ค่าจากเซนเซอร์ และทางลัดไปยังรายงาน",
        "image": "03-oven-realtime.png",
        "steps": [
            (1, "สลับระหว่างข้อมูล <b>ปัจจุบัน</b> และ <b>ย้อนหลัง</b>"),
            (2, "ตรวจเวลาเปิดเตา เวลาเลิกใช้งาน สถานะ และจำนวนรอบ"),
            (3, "เปิดรายงานรอบปัจจุบัน หรือส่งออกข้อมูล CSV"),
            (4, "อ่านค่าล่าสุดของเตาเผา Blower ห้องอบ และความชื้น"),
            (5, "กราฟห้องอบและความชื้นของรอบปัจจุบัน"),
        ],
        "note": "ตรวจเวลาอัปเดตใต้แต่ละมาตรวัดด้วย หากเวลาเก่าให้ตรวจการเชื่อมต่อก่อนใช้ค่าตัดสินใจ",
    },
    {
        "title": "4. การอ่านกราฟ",
        "intro": "กราฟแยกอุณหภูมิห้องอบ/ความชื้น และอุณหภูมิเตาเผา/Blower เพื่อให้อ่านง่าย",
        "image": "04-oven-graphs.png",
        "steps": [
            (1, "กราฟอุณหภูมิห้องอบและความชื้น"),
            (2, "คำอธิบายสีของแต่ละเส้น กดชื่อเพื่อซ่อนหรือแสดงเส้นได้"),
            (3, "เส้น Upper/Lower คือขอบเขตที่ตั้งไว้"),
            (4, "กราฟอุณหภูมิเตาเผาและ Blower"),
        ],
        "note": "วางเมาส์หรือแตะกราฟเพื่ออ่านวันเวลาและค่า หากข้อมูลจริงหายเกิน 30 นาที "
        "ระบบจะเชื่อมด้วยเส้นทึบแต่ไม่ระบายสีในช่วงที่ไม่มีข้อมูล",
    },
    {
        "title": "5. ดูข้อมูลย้อนหลัง",
        "intro": "เลือกข้อมูลตามรอบอบหรือตามวันที่ จากนั้นเปิดรายงานหรือส่งออกข้อมูลของช่วงที่เลือก",
        "image": "05-history.png",
        "steps": [
            (1, "กดแท็บ <b>ย้อนหลัง</b>"),
            (2, "เลือกวิธีค้นหา <b>ตามรอบอบ</b> หรือ <b>ตามวันที่</b>"),
            (3, "เลือกหมายเลขรอบจากรายการ"),
            (4, "กด <b>รอบล่าสุด</b> เพื่อกลับไปรอบย้อนหลังล่าสุด"),
            (5, "เปิดหน้ารายงานย้อนหลัง หรือส่งออก CSV"),
        ],
        "note": "เมื่อรอบปัจจุบันจบ ข้อมูลชุดเดียวกันจะถูกใช้เป็นข้อมูลย้อนหลัง",
    },
    {
        "title": "6. ตรวจและรับทราบ Alarm",
        "intro": "หน้า Alarm ใช้ค้นหา กรอง และติดตามเหตุการณ์ของทุกเตา",
        "image": "06-alarm.png",
        "steps": [
            (1, "จำนวน Alarm ที่กำลังเกิดเหตุ"),
            (2, "ค้นหาจากเตา ประเภทข้อมูล หรือรายละเอียด"),
            (3, "กรองตามระดับความรุนแรง"),
            (4, "กรองตามสถานะเหตุการณ์"),
            (5, "กรองเฉพาะเตาที่ต้องการ"),
            (6, "กด <b>รับทราบ</b> หลังตรวจสอบเหตุการณ์แล้ว"),
        ],
        "note": "การกดรับทราบเป็นการบันทึกว่ามีผู้ตรวจเหตุการณ์แล้ว ไม่ได้แก้สาเหตุหรือเปลี่ยนค่าจากเซนเซอร์",
    },
    {
        "title": "7. เลือกรายงานและดาวน์โหลดไฟล์",
        "intro": "เลือกเตาและรอบจากหน้า Report โดยตรง ก่อนดาวน์โหลดให้ตรวจชื่อไฟล์และพรีวิว",
        "image": "07-report.png",
        "steps": [
            (1, "เลือกเตา"),
            (2, "เลือก <b>รอบปัจจุบัน</b> หรือ <b>รอบย้อนหลัง</b>"),
            (3, "เลือกหมายเลขรอบ"),
            (4, "เลือก <b>PDF รอบเดียว</b> หรือ <b>ZIP หลายรอบ</b>"),
            (5, "กดดาวน์โหลด PDF/ZIP หรือส่งออก CSV แล้วตรวจกล่องยืนยัน"),
            (6, "โหลดพรีวิวใหม่ หรือซ่อน/แสดงพรีวิว"),
        ],
        "note": "ชื่อ PDF ใช้รูปแบบ บริษัท-รอบ-วันที่เริ่มรอบ เช่น TTN-89-14/07/2026 "
        "(ระบบอาจแทน / ตามข้อจำกัดของระบบปฏิบัติการ)",
    },
    {
        "title": "8. กรอกข้อมูลฟอร์มรายงาน",
        "intro": "ช่องในส่วนข้อมูลเพิ่มเติมไม่บังคับกรอก เลือกเฉพาะข้อมูลที่ต้องการให้แสดงในเอกสาร",
        "image": "08-report-form.png",
        "steps": [
            (1, "เลือกชนิดยาง"),
            (2, "เลือกผลประเมินวันรมควัน"),
            (3, "เลือกผลประเมินอุณหภูมิ"),
            (4, "เปิดเส้นความชื้นหรือค่าเป้าหมายเมื่อต้องการ"),
            (5, "ตรวจผลที่พรีวิวเอกสารด้านขวา"),
        ],
        "note": "ค่าเริ่มต้นของเส้นความชื้นเป็นปิด เมื่อเปิดจะใช้ช่วงตัวเลขเดียวกับอุณหภูมิและไม่มีแกนใหม่",
    },
    {
        "title": "9. รายละเอียดรอบและข้อมูลเอกสาร",
        "intro": "กรอกข้อมูลประกอบรายงานและแก้ Document No. เฉพาะเมื่อจำเป็น",
        "image": "11-report-document.png",
        "steps": [
            (1, "ตัวเลือกข้อมูลที่แสดงในกราฟ"),
            (2, "กรอกสาเหตุเมื่อมีเหตุการณ์ที่ต้องอธิบาย"),
            (3, "กรอกน้ำหนักยางเข้า/ออกเตา และน้ำหนักไม้ฟืน"),
            (4, "ตรวจ Document No. และวันที่เริ่มใช้"),
            (5, "กด <b>ปลดล็อก</b> เพื่อแก้ค่า แล้วบันทึกเพื่อล็อกอีกครั้ง"),
        ],
        "note": "ค่าที่กรอกจะถูกบันทึกกับรอบที่เลือก ตรวจเตาและหมายเลขรอบด้านบนก่อนแก้ข้อมูลทุกครั้ง",
    },
    {
        "title": "10. Setting",
        "intro": "ใช้แก้ข้อมูลเตาและค่า Limit ซึ่งมีผลต่อกราฟ Alarm และรายงาน",
        "image": "09-settings.png",
        "steps": [
            (1, "เลือกเตาที่ต้องการแก้ไข"),
            (2, "แก้ชื่อเตา โซน หรือไลน์ผลิต"),
            (3, "กด <b>บันทึกข้อมูลเตา</b>"),
            (4, "กำหนด Lower/Upper ของห้องอบ เตาเผา และ Blower"),
            (5, "กด <b>บันทึกค่า Limit</b>"),
            (6, "เพิ่มเตาใหม่เมื่อระบบต้นทางมีเตาและรหัสพร้อมแล้ว"),
        ],
        "note": "แก้ค่า Limit ตามเกณฑ์ที่ได้รับอนุมัติ เพราะค่าเดียวกันถูกใช้ทั้งกราฟ Alarm และรายงาน",
    },
]


def register_fonts():
    # HarfBuzz shaping keeps Thai tone marks and vowels attached to the correct
    # consonants instead of allowing them to collide with adjacent glyphs.
    pdfmetrics.registerFont(
        TTFont("Sarabun", str(FONT_DIR / "Sarabun-Regular.ttf"), shapable=True)
    )
    pdfmetrics.registerFont(
        TTFont("Sarabun-SemiBold", str(FONT_DIR / "Sarabun-SemiBold.ttf"), shapable=True)
    )
    pdfmetrics.registerFont(
        TTFont("Sarabun-Bold", str(FONT_DIR / "Sarabun-Bold.ttf"), shapable=True)
    )


def annotate_screenshots():
    ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)
    badge_font = ImageFont.truetype(str(FONT_DIR / "Sarabun-Bold.ttf"), 25)
    redact_font = ImageFont.truetype(str(FONT_DIR / "Sarabun-SemiBold.ttf"), 17)
    red = (225, 38, 47, 255)
    white = (255, 255, 255, 255)

    for filename, marks in ANNOTATIONS.items():
        source = RAW_DIR / filename
        if not source.exists():
            raise FileNotFoundError(f"Missing screenshot: {source}")

        image = PILImage.open(source).convert("RGBA")
        draw = ImageDraw.Draw(image)

        if filename == "01-login.png":
            draw.rectangle((820, 469, 1188, 500), fill=(255, 255, 255, 255))
            draw.text((826, 474), "ชื่อผู้ใช้ของคุณ", font=redact_font, fill=(69, 78, 91, 255))
        else:
            draw.rounded_rectangle(
                (1222, 6, 1358, 40),
                radius=3,
                fill=(255, 255, 255, 255),
                outline=(215, 220, 226, 255),
                width=1,
            )
            draw.text((1250, 12), "ผู้ใช้งาน", font=redact_font, fill=(90, 98, 110, 255))

        # Draw every guide rectangle first. Badges are drawn in a second pass so
        # no later rectangle can cross over a badge that was already rendered.
        for _, (x1, y1, x2, y2) in marks:
            draw.rounded_rectangle((x1, y1, x2, y2), radius=8, outline=red, width=5)

        for number, (x1, y1, _, _) in marks:
            cx, cy, radius = max(22, x1 - 12), max(22, y1 - 12), 18
            draw.ellipse(
                (cx - radius, cy - radius, cx + radius, cy + radius),
                fill=red,
                outline=white,
                width=3,
            )
            draw.text(
                (cx, cy),
                str(number),
                font=badge_font,
                fill=white,
                anchor="mm",
            )

        image.convert("RGB").save(
            ANNOTATED_DIR / filename,
            "JPEG",
            quality=88,
            optimize=True,
        )


def page_decor(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DARK)
    canvas.rect(0, PAGE_HEIGHT - 14 * mm, PAGE_WIDTH, 14 * mm, fill=1, stroke=0)
    canvas.setFillColor(YELLOW)
    canvas.rect(0, PAGE_HEIGHT - 14 * mm, 31 * mm, 2.2 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Sarabun-Bold", 10)
    canvas.drawString(15 * mm, PAGE_HEIGHT - 9 * mm, "STCR - Smoking Temperature Control")
    canvas.setStrokeColor(LINE)
    canvas.line(15 * mm, 14 * mm, PAGE_WIDTH - 15 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Sarabun", 8)
    canvas.drawString(15 * mm, 9 * mm, "คู่มือการใช้งานระบบ STCR")
    canvas.drawRightString(PAGE_WIDTH - 15 * mm, 9 * mm, f"หน้า {doc.page}")
    canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover": ParagraphStyle(
            "Cover",
            parent=base["Title"],
            fontName="Sarabun-Bold",
            fontSize=28,
            leading=37,
            textColor=DARK,
            spaceAfter=6 * mm,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Sarabun-SemiBold",
            fontSize=14,
            leading=22,
            textColor=ORANGE,
            spaceAfter=8 * mm,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Sarabun-Bold",
            fontSize=18,
            leading=24,
            textColor=DARK,
            spaceAfter=2.5 * mm,
        ),
        "intro": ParagraphStyle(
            "Intro",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=9.3,
            leading=14,
            textColor=MUTED,
            spaceAfter=3 * mm,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=9.4,
            leading=14.5,
            textColor=INK,
        ),
        "step": ParagraphStyle(
            "Step",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=8.8,
            leading=13,
            textColor=INK,
        ),
        "number": ParagraphStyle(
            "Number",
            parent=base["BodyText"],
            fontName="Sarabun-Bold",
            fontSize=10,
            leading=14,
            alignment=TA_CENTER,
            textColor=colors.white,
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=base["BodyText"],
            fontName="Sarabun-SemiBold",
            fontSize=9,
            leading=13.5,
            textColor=DARK,
            borderColor=YELLOW,
            borderWidth=1,
            borderPadding=7,
            backColor=colors.HexColor("#FFFBE8"),
            spaceBefore=2 * mm,
        ),
        "center": ParagraphStyle(
            "Center",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=10,
            leading=16,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
        "toc": ParagraphStyle(
            "Toc",
            parent=base["BodyText"],
            fontName="Sarabun-SemiBold",
            fontSize=10,
            leading=17,
            textColor=INK,
        ),
    }


def annotated_image(filename, width=176 * mm):
    path = ANNOTATED_DIR / filename
    with PILImage.open(path) as source:
        aspect = source.height / source.width
    return Image(str(path), width=width, height=width * aspect)


def number_badge(number, style):
    badge = Table(
        [[Paragraph(str(number), style)]],
        colWidths=[7 * mm],
        rowHeights=[7 * mm],
    )
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), RED),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    return badge


def steps_grid(steps, style_map):
    cells = []
    for number, text in steps:
        cells.append(
            Table(
                [[number_badge(number, style_map["number"]), Paragraph(text, style_map["step"])]],
                colWidths=[9 * mm, 74 * mm],
                style=[
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ],
            )
        )

    rows = []
    for index in range(0, len(cells), 2):
        row = cells[index : index + 2]
        if len(row) == 1:
            row.append("")
        rows.append(row)

    return Table(
        rows,
        colWidths=[88 * mm, 88 * mm],
        style=[
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ],
    )


def add_section_page(story, section, style_map):
    story.extend(
        [
            Paragraph(section["title"], style_map["h1"]),
            Paragraph(section["intro"], style_map["intro"]),
            annotated_image(section["image"]),
            Spacer(1, 3 * mm),
            steps_grid(section["steps"], style_map),
            Paragraph(section["note"], style_map["callout"]),
            PageBreak(),
        ]
    )


def build_manual():
    register_fonts()
    annotate_screenshots()
    style_map = styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=17 * mm,
        rightMargin=17 * mm,
        topMargin=21 * mm,
        bottomMargin=19 * mm,
        title="คู่มือการใช้งานระบบ STCR ฉบับเต็ม",
        author="STCR",
        subject="Smoking Temperature Control",
        pageCompression=1,
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="content",
    )
    doc.addPageTemplates([PageTemplate(id="manual", frames=[frame], onPage=page_decor)])

    story = [
        Spacer(1, 18 * mm),
        Paragraph("คู่มือการใช้งาน<br/>ระบบควบคุมอุณหภูมิเตารมควัน", style_map["cover"]),
        Paragraph("STCR - Smoking Temperature Control", style_map["subtitle"]),
        Paragraph(
            "คู่มือฉบับเต็มสำหรับผู้ใช้งานบริษัท Grand Rubber (GR) และ TTN<br/>"
            "อธิบายทุกหน้าหลักด้วยภาพจากระบบจริง พร้อมกรอบสีแดงและหมายเลขอ้างอิง",
            style_map["body"],
        ),
        Spacer(1, 10 * mm),
        Paragraph("<b>เนื้อหา</b>", style_map["h1"]),
        Paragraph(
            "1. เข้าสู่ระบบ<br/>2. Dashboard และเมนูหลัก<br/>"
            "3. รายละเอียดเตาและข้อมูลเรียลไทม์<br/>4. การอ่านกราฟ<br/>"
            "5. ข้อมูลย้อนหลัง<br/>6. Alarm<br/>"
            "7. เลือกรายงานและดาวน์โหลดไฟล์<br/>8. กรอกข้อมูลฟอร์มรายงาน<br/>"
            "9. รายละเอียดรอบและข้อมูลเอกสาร<br/>10. Setting<br/>"
            "11. การแก้ปัญหาเบื้องต้น",
            style_map["toc"],
        ),
        Spacer(1, 10 * mm),
        PageBreak(),
    ]

    for section in SECTIONS:
        add_section_page(story, section, style_map)

    troubleshooting_rows = [
        ["อาการ", "สิ่งที่ต้องตรวจ"],
        ["Failed to fetch", "ตรวจ Node-RED API, Tunnel, MySQL และเครือข่าย แล้วกดลองใหม่"],
        ["ค่าไม่เปลี่ยน", "ตรวจเวลาอัปเดตล่าสุด สถานะ MQTT และ Topic ของบริษัท/เตา"],
        ["ขาดการเชื่อมต่อ", "ตรวจว่าต้นทางยังส่งข้อมูลและเครื่องโรงงานออนไลน์"],
        ["รายงานไม่ตรงกราฟ", "ตรวจบริษัท เตา รอบ ช่วงเวลา แล้วกดโหลดพรีวิวใหม่"],
        ["ดาวน์โหลดไม่ได้", "อนุญาตการดาวน์โหลดของเบราว์เซอร์ และตรวจพื้นที่จัดเก็บ"],
        ["หน้าเว็บยังเป็นแบบเดิม", "กด Ctrl + F5 เพื่อโหลดไฟล์เว็บเวอร์ชันล่าสุด"],
    ]
    troubleshooting = Table(
        troubleshooting_rows,
        colWidths=[47 * mm, 129 * mm],
        repeatRows=1,
    )
    troubleshooting.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DARK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Sarabun-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Sarabun"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("LEADING", (0, 0), (-1, -1), 15),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    story.extend(
        [
            Paragraph("11. การแก้ปัญหาเบื้องต้น", style_map["h1"]),
            Paragraph(
                "ตรวจตามรายการนี้ก่อนแจ้งผู้ดูแลระบบ พร้อมระบุบริษัท หมายเลขเตา และเวลาที่พบปัญหา",
                style_map["intro"],
            ),
            troubleshooting,
            Spacer(1, 8 * mm),
            Paragraph(
                "<b>ข้อมูลที่ควรส่งให้ผู้ดูแลเมื่อแจ้งปัญหา</b><br/>"
                "1. บริษัท GR หรือ TTN<br/>2. หมายเลขเตาและหมายเลขรอบ<br/>"
                "3. วันเวลาที่พบปัญหา<br/>4. หน้าที่พบปัญหาและภาพหน้าจอ<br/>"
                "5. ข้อความแจ้งเตือนที่แสดง",
                style_map["callout"],
            ),
            Spacer(1, 10 * mm),
            Paragraph(
                "จบคู่มือการใช้งานระบบ STCR<br/>Smoking Temperature Control",
                style_map["center"],
            ),
        ]
    )

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build_manual()
