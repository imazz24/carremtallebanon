"""PDF generation for the Car Rental rental report.

Uses reportlab for layout, arabic-reshaper + python-bidi for Arabic
shaping and right-to-left ordering. The Amiri font (which has full
Arabic glyphs) is downloaded once on first use and cached on disk.
"""
from __future__ import annotations

import os
import urllib.request
from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

import arabic_reshaper
from bidi.algorithm import get_display


# ---------- font setup -----------------------------------------------------
FONT_DIR  = os.path.join(os.path.dirname(__file__), "fonts")
FONT_NAME = "Amiri"
FONT_FILE = "Amiri-Regular.ttf"
# Pinned to the 1.000 release tag (stable, ~700 KB)
FONT_URL  = (
    "https://github.com/aliftype/amiri/raw/1.000/fonts/Amiri-Regular.ttf"
)

_font_ready = False


def _ensure_font() -> None:
    """Download Amiri once, register with reportlab. No-op on subsequent calls."""
    global _font_ready
    if _font_ready:
        return
    os.makedirs(FONT_DIR, exist_ok=True)
    path = os.path.join(FONT_DIR, FONT_FILE)
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(FONT_URL, path)
        except Exception as e:
            print(f"[pdf_gen] Could not download {FONT_URL}: {e}")
            return
    try:
        pdfmetrics.registerFont(TTFont(FONT_NAME, path))
        _font_ready = True
    except Exception as e:
        print(f"[pdf_gen] Could not register Amiri font: {e}")


def _font() -> str:
    return FONT_NAME if _font_ready else "Helvetica"


def _shape(s) -> str:
    """Reshape Arabic + apply BiDi so Arabic strings render correctly."""
    if s is None:
        return ""
    s = str(s)
    if any("؀" <= c <= "ۿ" for c in s):
        return get_display(arabic_reshaper.reshape(s))
    return s


# ---------- localized labels ---------------------------------------------
LABELS = {
    "en": {
        "title.report":   "Rental Report",
        "title.detail":   "Rental detail",
        "subtitle":       "Every client with their rented cars and company",
        "client":         "Client",
        "father":         "Father",
        "mother":         "Mother",
        "personid":       "Person ID",
        "phone":          "Phone",
        "license":        "License",
        "company":        "Company",
        "cphone":         "Co. phone",
        "location":       "Location",
        "coords":         "Coordinates",
        "car":            "Car",
        "vin":            "VIN",
        "plate":          "Plate",
        "color":          "Color",
        "gps":            "GPS",
        "yes":            "Yes",
        "no":             "No",
        "start":          "Start",
        "end":            "End",
    },
    "ar": {
        "title.report":   "تقرير الإيجار",
        "title.detail":   "تفاصيل الإيجار",
        "subtitle":       "كلّ عميل مع السيارات والشركات التي استأجر منها",
        "client":         "العميل",
        "father":         "اسم الأب",
        "mother":         "اسم الأم",
        "personid":       "رقم الهوية",
        "phone":          "الهاتف",
        "license":        "الرخصة",
        "company":        "الشركة",
        "cphone":         "هاتف الشركة",
        "location":       "الموقع",
        "coords":         "الإحداثيات",
        "car":            "السيارة",
        "vin":            "رقم الهيكل",
        "plate":          "اللوحة",
        "color":          "اللون",
        "gps":            "GPS",
        "yes":            "نعم",
        "no":             "لا",
        "start":          "البدء",
        "end":            "الانتهاء",
    },
}


def _L(lang: str, key: str) -> str:
    table = LABELS.get(lang, LABELS["en"])
    return table.get(key, LABELS["en"].get(key, key))


# ---------- builders -------------------------------------------------------
def _grid_style(font: str, font_size: int = 8) -> TableStyle:
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONT",       (0, 0), (-1, -1), font, font_size),
        ("ALIGN",      (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",     (0, 0), (-1, -1), "TOP"),
        ("GRID",       (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8fafc")]),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ])


def report_pdf(rows: list[dict], lang: str = "en") -> BytesIO:
    """Render the full rental report table to a BytesIO PDF."""
    _ensure_font()
    L = lambda k: _L(lang, k)        # noqa: E731

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=10*mm, rightMargin=10*mm,
        topMargin=12*mm,  bottomMargin=12*mm,
    )

    align = "RIGHT" if lang == "ar" else "LEFT"

    title_style = ParagraphStyle(
        "title", fontName=_font(), fontSize=16,
        textColor=colors.HexColor("#0f172a"), spaceAfter=4,
        alignment={"LEFT": 0, "RIGHT": 2}[align],
    )
    sub_style = ParagraphStyle(
        "sub", fontName=_font(), fontSize=9,
        textColor=colors.grey, spaceAfter=10,
        alignment={"LEFT": 0, "RIGHT": 2}[align],
    )

    elements = [
        Paragraph(_shape(L("title.report")), title_style),
        Paragraph(_shape(f"{L('subtitle')}  ·  {datetime.now():%Y-%m-%d %H:%M}"),
                  sub_style),
        Spacer(1, 4),
    ]

    headers = [L("client"), L("father"), L("phone"), L("license"),
               L("company"), L("cphone"), L("location"),
               L("car"), L("plate"), L("gps"), L("start"), L("end")]
    data = [[_shape(h) for h in headers]]
    for r in rows:
        data.append([
            _shape(r.get("client_name")),
            _shape(r.get("client_father")),
            _shape(r.get("client_phone")),
            _shape(r.get("client_licenseid")),
            _shape(r.get("company_name")),
            _shape(r.get("company_phone") or "—"),
            _shape(r.get("company_location")),
            _shape(f"{r.get('car_model','')} ({r.get('car_type','')})"),
            _shape(r.get("car_plate")),
            L("yes") if r.get("car_has_gps") else L("no"),
            str(r.get("start_date") or "—"),
            str(r.get("end_date")   or "—"),
        ])

    t = Table(data, repeatRows=1)
    style = _grid_style(_font(), 8)
    style.add("ALIGN", (0, 0), (-1, -1), align)
    t.setStyle(style)
    elements.append(t)

    doc.build(elements)
    buf.seek(0)
    return buf


def single_pdf(r: dict, lang: str = "en") -> BytesIO:
    """Render a single rental as a key/value PDF."""
    _ensure_font()
    L = lambda k: _L(lang, k)        # noqa: E731

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=14*mm, rightMargin=14*mm,
        topMargin=14*mm,  bottomMargin=14*mm,
    )

    align = "RIGHT" if lang == "ar" else "LEFT"

    title_style = ParagraphStyle(
        "t", fontName=_font(), fontSize=16,
        textColor=colors.HexColor("#0f172a"),
        alignment={"LEFT": 0, "RIGHT": 2}[align],
    )
    sub_style = ParagraphStyle(
        "s", fontName=_font(), fontSize=9, textColor=colors.grey,
        alignment={"LEFT": 0, "RIGHT": 2}[align],
    )

    elements = [
        Paragraph(_shape(L("title.detail")), title_style),
        Paragraph(_shape(f"{datetime.now():%Y-%m-%d %H:%M}"), sub_style),
        Spacer(1, 8),
    ]

    coords = "—"
    if r.get("company_x") is not None and r.get("company_y") is not None:
        coords = f"{float(r['company_y']):.5f}, {float(r['company_x']):.5f}"

    rows = [
        (L("client"),     r.get("client_name")),
        (L("father"),     r.get("client_father")),
        (L("mother"),     r.get("client_mother")),
        (L("personid"),   r.get("client_personid")),
        (L("phone"),      r.get("client_phone")),
        (L("license"),    r.get("client_licenseid")),
        (L("company"),    f"{r.get('company_name') or ''} ({r.get('company_code') or ''})"),
        (L("cphone"),     r.get("company_phone") or "—"),
        (L("location"),   r.get("company_location")),
        (L("coords"),     coords),
        (L("car"),        f"{r.get('car_model') or ''} ({r.get('car_type') or ''})"),
        (L("vin"),        r.get("car_vin")),
        (L("plate"),      r.get("car_plate")),
        (L("color"),      r.get("car_color")),
        (L("gps"),        L("yes") if r.get("car_has_gps") else L("no")),
        (L("start"),      str(r.get("start_date") or "—")),
        (L("end"),        str(r.get("end_date")   or "—")),
    ]
    data = [[_shape(k), _shape(v)] for k, v in rows]

    t = Table(data, colWidths=[55*mm, None])
    t.setStyle(TableStyle([
        ("FONT",          (0, 0), (-1, -1), _font(), 10),
        ("BACKGROUND",    (0, 0), (0, -1),  colors.HexColor("#f1f5f9")),
        ("TEXTCOLOR",     (0, 0), (0, -1),  colors.HexColor("#3c3c3c")),
        ("ALIGN",         (0, 0), (-1, -1), align),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("GRID",          (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t)

    doc.build(elements)
    buf.seek(0)
    return buf
