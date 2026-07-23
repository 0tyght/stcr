from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "STCR-User-Manual.pdf"
REGULAR_FONT = ROOT / "public" / "fonts" / "Sarabun-Regular.ttf"
SEMIBOLD_FONT = ROOT / "public" / "fonts" / "Sarabun-SemiBold.ttf"
BOLD_FONT = ROOT / "public" / "fonts" / "Sarabun-Bold.ttf"

PAGE_WIDTH, PAGE_HEIGHT = A4
ORANGE = colors.HexColor("#F07818")
YELLOW = colors.HexColor("#F1CE24")
DARK = colors.HexColor("#202733")
INK = colors.HexColor("#27313D")
MUTED = colors.HexColor("#647181")
LIGHT = colors.HexColor("#F3F5F7")
LINE = colors.HexColor("#D8DEE6")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Sarabun", str(REGULAR_FONT)))
    pdfmetrics.registerFont(TTFont("Sarabun-SemiBold", str(SEMIBOLD_FONT)))
    pdfmetrics.registerFont(TTFont("Sarabun-Bold", str(BOLD_FONT)))


def draw_page(canvas, doc) -> None:
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


def build_styles():
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="Sarabun-Bold",
            fontSize=29,
            leading=38,
            textColor=DARK,
            alignment=TA_LEFT,
            spaceAfter=6 * mm,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base["Normal"],
            fontName="Sarabun-SemiBold",
            fontSize=14,
            leading=22,
            textColor=ORANGE,
            spaceAfter=8 * mm,
        ),
        "h1": ParagraphStyle(
            "Heading1Thai",
            parent=base["Heading1"],
            fontName="Sarabun-Bold",
            fontSize=20,
            leading=27,
            textColor=DARK,
            spaceBefore=1 * mm,
            spaceAfter=5 * mm,
        ),
        "h2": ParagraphStyle(
            "Heading2Thai",
            parent=base["Heading2"],
            fontName="Sarabun-Bold",
            fontSize=13,
            leading=19,
            textColor=ORANGE,
            spaceBefore=4 * mm,
            spaceAfter=2 * mm,
        ),
        "body": ParagraphStyle(
            "BodyThai",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=10.2,
            leading=16.5,
            textColor=INK,
            spaceAfter=2.4 * mm,
        ),
        "small": ParagraphStyle(
            "SmallThai",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=8.6,
            leading=13,
            textColor=MUTED,
        ),
        "step": ParagraphStyle(
            "StepThai",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=10,
            leading=16,
            leftIndent=6 * mm,
            firstLineIndent=-5 * mm,
            textColor=INK,
            spaceAfter=2.2 * mm,
        ),
        "callout": ParagraphStyle(
            "CalloutThai",
            parent=base["BodyText"],
            fontName="Sarabun-SemiBold",
            fontSize=10,
            leading=16,
            textColor=DARK,
            borderColor=YELLOW,
            borderWidth=1,
            borderPadding=9,
            backColor=colors.HexColor("#FFFBE8"),
            spaceBefore=3 * mm,
            spaceAfter=4 * mm,
        ),
        "center": ParagraphStyle(
            "CenterThai",
            parent=base["BodyText"],
            fontName="Sarabun",
            fontSize=10,
            leading=16,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
    }


def section_table(rows, widths):
    table = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DARK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Sarabun-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Sarabun"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("LEADING", (0, 0), (-1, -1), 14),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def create_manual() -> None:
    register_fonts()
    styles = build_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=17 * mm,
        rightMargin=17 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title="คู่มือการใช้งานระบบ STCR",
        author="STCR",
        subject="Smoking Temperature Control",
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="content",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="manual", frames=[frame], onPage=draw_page)])

    story = []

    story.extend(
        [
            Spacer(1, 22 * mm),
            Paragraph("คู่มือการใช้งาน<br/>ระบบควบคุมอุณหภูมิเตารมควัน", styles["cover_title"]),
            Paragraph("STCR - Smoking Temperature Control", styles["cover_subtitle"]),
            Paragraph(
                "สำหรับผู้ใช้งานบริษัท Grand Rubber (GR) และ TTN<br/>"
                "ครอบคลุมการดูสถานะเตา กราฟ ข้อมูลย้อนหลัง Alarm และรายงาน PDF",
                styles["body"],
            ),
            Spacer(1, 16 * mm),
            Paragraph(
                "<b>เริ่มใช้งานอย่างรวดเร็ว</b><br/>"
                "1. เลือกบริษัทบนหน้าเข้าสู่ระบบ<br/>"
                "2. กรอกชื่อผู้ใช้และรหัสผ่านของบริษัท<br/>"
                "3. ตรวจสถานะการเชื่อมต่อและเวลาอัปเดตล่าสุด<br/>"
                "4. เลือกเตาจาก Dashboard หรือเมนูด้านซ้าย<br/>"
                "5. เปิดหน้า Report เมื่อต้องการตรวจหรือดาวน์โหลดเอกสาร",
                styles["callout"],
            ),
            Spacer(1, 18 * mm),
            Paragraph("ฉบับสำหรับการใช้งานบนคอมพิวเตอร์และ iPad", styles["center"]),
            Paragraph("ปรับปรุงล่าสุด: 23 กรกฎาคม 2569", styles["center"]),
            PageBreak(),
        ]
    )

    story.extend(
        [
            Paragraph("1. การเข้าสู่ระบบและหน้าหลัก", styles["h1"]),
            Paragraph("การเข้าสู่ระบบ", styles["h2"]),
            Paragraph("1. เลือกบริษัท GR หรือ TTN ให้ตรงกับบัญชีที่จะใช้งาน", styles["step"]),
            Paragraph("2. กรอกชื่อผู้ใช้และรหัสผ่าน แล้วกดปุ่มเข้าสู่ระบบ", styles["step"]),
            Paragraph(
                "3. หากขึ้นข้อความ Failed to fetch ให้ตรวจว่า Node-RED API, Tunnel และฐานข้อมูลกำลังทำงาน ก่อนลองใหม่",
                styles["step"],
            ),
            Paragraph(
                "ห้ามใช้บัญชีของอีกบริษัท เพราะระบบแยกข้อมูล เตา รายงาน และสิทธิ์ตามบริษัทที่เลือก",
                styles["callout"],
            ),
            Paragraph("ส่วนประกอบหลักของระบบ", styles["h2"]),
            section_table(
                [
                    ["เมนู", "ใช้สำหรับ"],
                    ["Dashboard", "ดูภาพรวมทุกเตา สถานะ และค่าล่าสุด"],
                    ["Alarm", "ตรวจเหตุการณ์ผิดปกติและเวลาที่เกิด"],
                    ["Report", "เลือกเตา/รอบ กรอกข้อมูลฟอร์ม และดาวน์โหลดเอกสาร"],
                    ["Setting", "ตรวจหรือปรับค่าที่ระบบอนุญาต"],
                    ["รายชื่อเตา", "เปิดหน้ารายละเอียดของเตาที่เลือกโดยตรง"],
                ],
                [42 * mm, 128 * mm],
            ),
            Paragraph("การอ่านสถานะข้อมูล", styles["h2"]),
            Paragraph(
                "ให้ดูเวลาอัปเดตล่าสุดควบคู่กับสถานะเตาเสมอ ถ้าข้อมูลหยุดเกินเวลาที่กำหนด "
                "ระบบจะแสดงสถานะขาดการเชื่อมต่อ แทนการสร้างค่าทดแทน",
                styles["body"],
            ),
            Paragraph(
                "กราฟเรียลไทม์อาจอัปเดตบ่อยกว่าข้อมูลที่บันทึกลงฐานข้อมูล "
                "จึงควรใช้รายงานย้อนหลังเป็นข้อมูลอ้างอิงของรอบผลิต",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            Paragraph("2. หน้ารายละเอียดเตาและกราฟ", styles["h1"]),
            Paragraph("ข้อมูลปัจจุบัน", styles["h2"]),
            Paragraph(
                "หน้ารายละเอียดเตาแสดงอุณหภูมิเตาเผา อุณหภูมิ Blower อุณหภูมิห้องอบ "
                "และความชื้น ค่าบนมาตรวัดเป็นค่าล่าสุดที่ระบบได้รับจาก MQTT ผ่าน Node-RED",
                styles["body"],
            ),
            Paragraph(
                "ถ้าเตาเปิด ระบบจะเริ่มจัดการรอบตามสถานะจริงจากต้นทาง "
                "ไม่ควรเปิดหรือปิดรอบด้วยการคาดเดาจากอุณหภูมิเพียงอย่างเดียว",
                styles["callout"],
            ),
            Paragraph("การใช้กราฟ", styles["h2"]),
            Paragraph("1. วางเมาส์หรือแตะบนกราฟเพื่ออ่านวันเวลาและค่าของแต่ละเซนเซอร์", styles["step"]),
            Paragraph("2. ใช้ตัวเลือกปัจจุบัน/ย้อนหลังเพื่อเปลี่ยนช่วงข้อมูล", styles["step"]),
            Paragraph("3. ในข้อมูลย้อนหลัง เลือกรอบหรือวันที่ให้ตรงกับงานที่ต้องการตรวจ", styles["step"]),
            Paragraph(
                "4. หากข้อมูลจริงหายเกิน 30 นาที กราฟจะเชื่อมด้วยเส้นทึบแต่ไม่ระบายสีในช่วงนั้น "
                "เพื่อบอกว่าไม่มีข้อมูลจริงระหว่างสองจุด",
                styles["step"],
            ),
            Paragraph("ความหมายของค่าที่แสดง", styles["h2"]),
            section_table(
                [
                    ["รายการ", "หน่วย", "คำอธิบาย"],
                    ["อุณหภูมิห้องอบ", "°C", "ค่าหลักสำหรับติดตามและจัดทำรายงาน"],
                    ["ความชื้นห้องอบ", "%RH", "ความชื้นสัมพัทธ์ภายในห้องอบ"],
                    ["อุณหภูมิเตาเผา", "°C", "อุณหภูมิบริเวณแหล่งความร้อน"],
                    ["อุณหภูมิ Blower", "°C", "อุณหภูมิบริเวณระบบเป่าลม"],
                ],
                [52 * mm, 24 * mm, 94 * mm],
            ),
            Paragraph("เมื่อพบค่าผิดปกติ", styles["h2"]),
            Paragraph(
                "ตรวจเวลาอัปเดตล่าสุด เปรียบเทียบกับอุปกรณ์หน้างาน และดู Alarm "
                "หากพบค่ากระโดดผิดธรรมชาติหรือค้างนาน ให้แจ้งผู้ดูแลระบบพร้อมชื่อบริษัท หมายเลขเตา และเวลาเกิดเหตุ",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            Paragraph("3. รายงาน การดาวน์โหลด และการแก้ปัญหา", styles["h1"]),
            Paragraph("การสร้างรายงาน", styles["h2"]),
            Paragraph("1. เปิดเมนู Report แล้วเลือกเตา ประเภทรอบ และหมายเลขรอบ", styles["step"]),
            Paragraph(
                "2. ตรวจข้อมูลเพิ่มเติมสำหรับฟอร์ม เช่น ชนิดยาง ผลประเมิน น้ำหนักยาง Document No. และวันที่เริ่มใช้",
                styles["step"],
            ),
            Paragraph(
                "3. เปิดตัวเลือกเส้นความชื้นหรือเส้นเป้าหมายเมื่อจำเป็น แล้วตรวจพรีวิวก่อนดาวน์โหลด",
                styles["step"],
            ),
            Paragraph(
                "4. กดดาวน์โหลด PDF, ZIP หรือ CSV ระบบจะแสดงกล่องยืนยันพร้อมชื่อไฟล์ "
                "ตรวจรายละเอียดแล้วจึงกดยืนยัน",
                styles["step"],
            ),
            Paragraph(
                "Document No. และวันที่เริ่มใช้จะถูกล็อกไว้เพื่อป้องกันการแก้ไขโดยไม่ตั้งใจ "
                "ให้ปลดล็อกเฉพาะเมื่อได้รับอนุญาตและตรวจค่าก่อนบันทึก",
                styles["callout"],
            ),
            Paragraph("รูปแบบไฟล์รายงาน", styles["h2"]),
            Paragraph(
                "ไฟล์ PDF ใช้รูปแบบชื่อ บริษัท-รอบ-วันที่เริ่มรอบ เช่น TTN-89-14/07/2026 "
                "(ระบบอาจแทนเครื่องหมาย / ตามข้อจำกัดของระบบปฏิบัติการขณะบันทึกไฟล์)",
                styles["body"],
            ),
            Paragraph("แนวทางแก้ปัญหาเบื้องต้น", styles["h2"]),
            section_table(
                [
                    ["อาการ", "วิธีตรวจ"],
                    ["Failed to fetch", "ตรวจ Node-RED, API URL, Tunnel, MySQL และอินเทอร์เน็ต"],
                    ["ค่าไม่เปลี่ยน", "ตรวจเวลาอัปเดตล่าสุดและ MQTT Topic ของบริษัท/เตา"],
                    ["รายงานไม่ตรงกราฟ", "ตรวจบริษัท เตา รอบ ช่วงเวลา และโหลดพรีวิวใหม่"],
                    ["ดาวน์โหลดไม่ได้", "อนุญาตการดาวน์โหลดของเบราว์เซอร์ แล้วลองใหม่"],
                    ["หน้าเว็บยังเป็นแบบเดิม", "กด Ctrl + F5 เพื่อโหลดไฟล์เว็บเวอร์ชันล่าสุด"],
                ],
                [52 * mm, 118 * mm],
            ),
            Paragraph("ความปลอดภัย", styles["h2"]),
            Paragraph(
                "ไม่เปิดเผยรหัสผ่าน ไม่แชร์บัญชีข้ามบริษัท ออกจากระบบเมื่อเลิกใช้งาน "
                "และไม่แก้ข้อมูลเอกสารหรือค่าตั้งต้นโดยไม่ได้รับอนุญาต",
                styles["body"],
            ),
        ]
    )

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    create_manual()
