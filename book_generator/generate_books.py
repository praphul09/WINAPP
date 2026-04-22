import argparse
import io
import sqlite3
import sys
import shutil
import math
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
VENDOR_DIR = SCRIPT_DIR / "vendor"
if str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
import qrcode
import fitz


GENERATED_ROOT = Path(r"\\pixartnas\home\INTERNAL_PROCESSING\GENRATED")
BATCH_PROCESSING_ROOT = Path(r"\\pixartnas\home\INTERNAL_PROCESSING\BATCH_PROCESSING")
INNER_SOURCE_ROOT = Path(r"\\pixartnas\home\INTERNAL_PROCESSING\INNER SOURCE")
NONP_INNER_SOURCE_ROOT = INNER_SOURCE_ROOT / "NONP"
NONP_COVER_SOURCE_ROOT = Path(r"\\pixartnas\home\INTERNAL_PROCESSING\NEW SCHOOL COVERS")
MM_TO_PT = 72 / 25.4
QR_SIZE = 25 * MM_TO_PT
QR_LEFT_OF_MIDDLE = 8 * MM_TO_PT
QR_BOTTOM_MARGIN = 17 * MM_TO_PT
QR_BOTTOM_MARGIN_NEW = 12 * MM_TO_PT
SLOT_LABEL_GAP = 4 * MM_TO_PT
SLOT_LABEL_FONT_SIZE = 10
BOOK_ID_FONT_SIZE = 18
SPINE_BATCH_ID_FONT_SIZE = 18
BOOK_ID_X_MARGIN = 24
BOOK_ID_Y_MARGIN = 32
STRIPE_WIDTH = 5 * MM_TO_PT
STRIPE_HEIGHT = 15 * MM_TO_PT
STRIPE_TOP_MARGIN_NEW = 7 * MM_TO_PT
STRIPE_TOP_MARGIN =  15 * MM_TO_PT
SIDE_STRIP_WIDTH = 12 * MM_TO_PT
MEDIUM_SIDE_STRIP_HEIGHT = 290 * MM_TO_PT
BIG_SIDE_STRIP_HEIGHT = 310 * MM_TO_PT
MEDIUM_SIDE_STRIP_COLOR = colors.blue
BIG_SIDE_STRIP_COLOR = colors.red
COLOR_INDEX_MAP = {
    1: "#9A6324",
    2: "#e6194B",
    3: "#bfef45",
    4: "#a9a9a9",
    5: "#000000",
    6: "#fabed4",
    7: "#42d4f4",
    8: "#f58231",
    9: "#f032e6",
    10: "#ffe119",
    11: "#3cb44b",
    12: "#f58231",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch book generator")
    parser.add_argument("--batch-id", required=True, type=int)
    parser.add_argument("--batch-name", required=True)
    parser.add_argument("--registry-path", required=True)
    return parser.parse_args()


def should_skip_code(code: str | None) -> bool:
    value = str(code or "").strip().lower()
    return value.endswith("s") or value.endswith("b")


def endswith_code(code: str | None, suffix: str) -> bool:
    return str(code or "").strip().lower().endswith(suffix.lower())


def make_qr_image_reader(value: str) -> ImageReader:
    qr = qrcode.QRCode(border=1, box_size=8)
    qr.add_data(str(value or ""))
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return ImageReader(buffer)


def resolve_stripe_color(raw_value) -> colors.HexColor:
    try:
        index = int(str(raw_value or "").strip())
    except ValueError as error:
        raise ValueError(f"Invalid stripe colour index: {raw_value}") from error

    if index not in COLOR_INDEX_MAP:
        raise ValueError(f"Stripe colour index out of range: {index}. Allowed values are 1 to 12.")

    return colors.HexColor(COLOR_INDEX_MAP[index])

def row_int(row: sqlite3.Row, key: str) -> int:
    value = row[key]
    text = str(value).strip()
    if not text:
        raise ValueError(f"Invalid {key} value: {value}")

    try:
        return int(text)
    except (TypeError, ValueError):
        try:
            float_value = float(text)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid {key} value: {value}") from error
        if not math.isfinite(float_value) or not float_value.is_integer():
            raise ValueError(f"Invalid {key} value: {value}")
        return int(float_value)
    except Exception as error:
        raise ValueError(f"Invalid {key} value: {value}") from error


def draw_cover_stripes(c: canvas.Canvas, page_width: float, page_height: float, colour1, colour2) -> None:
    stripe_x = max((page_width - STRIPE_WIDTH) / 2, 0)
    
    if page_height > 291 * MM_TO_PT:
        top_stripe_y = max(page_height - STRIPE_TOP_MARGIN - STRIPE_HEIGHT, 0)
    else: 
        top_stripe_y = max(page_height - STRIPE_TOP_MARGIN_NEW - STRIPE_HEIGHT, 0)

    
    middle_stripe_y = max((page_height - STRIPE_HEIGHT) / 2, 0)

    c.saveState()
    c.setStrokeColor(colors.black)
    c.setLineWidth(0)
    c.setFillColor(resolve_stripe_color(colour1))
    c.rect(stripe_x, top_stripe_y, STRIPE_WIDTH, STRIPE_HEIGHT, stroke=0, fill=1)
    c.setFillColor(resolve_stripe_color(colour2))
    c.rect(stripe_x, middle_stripe_y, STRIPE_WIDTH, STRIPE_HEIGHT, stroke=0, fill=1)
    c.restoreState()


def get_cover_side_strip_spec(book_size: str) -> tuple[float, colors.Color] | None:
    normalized_size = str(book_size or "").strip().upper()
    if normalized_size == "MEDIUM":
        return MEDIUM_SIDE_STRIP_HEIGHT, MEDIUM_SIDE_STRIP_COLOR
    if normalized_size == "BIG":
        return BIG_SIDE_STRIP_HEIGHT, BIG_SIDE_STRIP_COLOR
    return None


def draw_cover_side_strips(c: canvas.Canvas, page_width: float, page_height: float, book_size: str) -> None:
    strip_spec = get_cover_side_strip_spec(book_size)
    if strip_spec is None:
        return

    strip_height, strip_color = strip_spec

    strip_y = (page_height - strip_height) / 2
    right_strip_x = max(page_width - SIDE_STRIP_WIDTH, 0)

    c.saveState()
    c.setLineWidth(0)
    c.setFillColor(strip_color)
    c.rect(0, strip_y, SIDE_STRIP_WIDTH, strip_height, stroke=0, fill=1)
    c.rect(right_strip_x, strip_y, SIDE_STRIP_WIDTH, strip_height, stroke=0, fill=1)
    c.restoreState()


def draw_cover_qr(c: canvas.Canvas, page_width: float, page_height : float, qr_value: str) -> None:
    qr_image = make_qr_image_reader(qr_value)
    qr_x = max((page_width / 2) - QR_LEFT_OF_MIDDLE - QR_SIZE, 0)
    
    if page_height > 291 * MM_TO_PT:
        qr_y = QR_BOTTOM_MARGIN
    else:
        qr_y = QR_BOTTOM_MARGIN_NEW
        
    c.drawImage(qr_image, qr_x, qr_y, width=QR_SIZE, height=QR_SIZE, preserveAspectRatio=True, mask="auto")


def assigned_number_to_slot(assigned_number) -> int | None:
    try:
        value = int(str(assigned_number or "").strip())
    except (TypeError, ValueError):
        return None

    if value <= 0:
        return None

    return ((value - 1) % 12) + 1


def draw_cover_slot_label(
    c: canvas.Canvas,
    page_width: float,
    page_height: float,
    assigned_number,
) -> None:
    slot = assigned_number_to_slot(assigned_number)
    if slot is None:
        return

    qr_x = max((page_width / 2) - QR_LEFT_OF_MIDDLE - QR_SIZE, 0)
    if page_height > 291 * MM_TO_PT:
        qr_y = QR_BOTTOM_MARGIN
    else:
        qr_y = QR_BOTTOM_MARGIN_NEW

    text_x = qr_x + (QR_SIZE / 2)
    text_y = max(qr_y - SLOT_LABEL_GAP, 0)

    c.saveState()
    c.setFont("Helvetica-Bold", SLOT_LABEL_FONT_SIZE)
    c.drawCentredString(text_x, text_y, f"SLOT {slot}")
    c.restoreState()


def draw_inner_qr(c: canvas.Canvas, page_width: float, page_height: float, qr_value: str) -> None:
    qr_image = make_qr_image_reader(qr_value)
    qr_x = max((page_width / 2) - QR_LEFT_OF_MIDDLE - QR_SIZE, 0)
    qr_y = QR_BOTTOM_MARGIN_NEW
    c.drawImage(qr_image, qr_x, qr_y, width=QR_SIZE, height=QR_SIZE, preserveAspectRatio=True, mask="auto")


def draw_cover_book_id(c: canvas.Canvas, page_width: float, page_height: float, book_id: int) -> None:
    center_x = page_width / 2 + (1 * MM_TO_PT)
    book_id_y = page_height * 0.80
    c.saveState()
    c.setFont("Helvetica-Bold", BOOK_ID_FONT_SIZE)
    c.translate(center_x, book_id_y)
    c.rotate(90)
    c.drawCentredString(0, 0, str(book_id))
    c.restoreState()


def draw_cover_batch_id(c: canvas.Canvas, page_width: float, page_height: float, batch_id: int | None) -> None:
    if batch_id is None:
        return

    center_x = page_width / 2 + (1 * MM_TO_PT)
    batch_id_y = page_height * 0.20
    c.saveState()
    c.setFont("Helvetica-Bold", SPINE_BATCH_ID_FONT_SIZE)
    c.translate(center_x, batch_id_y)
    c.rotate(90)
    c.drawCentredString(0, 0, str(batch_id))
    c.restoreState()


def draw_cover_spine_code(c: canvas.Canvas, page_width: float, page_height: float, spine_code: str) -> None:
    value = str(spine_code or "").strip()
    if not value:
        return

    center_x = page_width / 2
    spine_y = page_height * 0.30
    c.saveState()
    c.setFont("Helvetica-Bold", 14)
    c.translate(center_x, spine_y)
    c.rotate(90)
    c.drawCentredString(0, 0, value)
    c.restoreState()


def get_cover_canvas_size(page_width: float, page_height: float, book_size: str) -> tuple[float, float]:
    strip_spec = get_cover_side_strip_spec(book_size)
    if strip_spec is not None:
        strip_height, _ = strip_spec
        return page_width + (2 * SIDE_STRIP_WIDTH), max(page_height, strip_height)
    return page_width, page_height


def create_overlay_bytes(
    page_width: float,
    page_height: float,
    qr_value: str,
    book_id: int,
    include_qr: bool,
    include_book_id: bool,
    *,
    cover_mode: bool = False,
    colour1=None,
    colour2=None,
    spine_code: str = "",
    book_size: str = "",
    content_page_width: float | None = None,
    content_page_height: float | None = None,
    content_x_offset: float = 0.0,
    content_y_offset: float = 0.0,
    assigned_number=None,
    batch_id: int | None = None,
    include_batch_id: bool = False,
) -> bytes:
    packet = io.BytesIO()
    canvas_width, canvas_height = (page_width, page_height)
    c = canvas.Canvas(packet, pagesize=(canvas_width, canvas_height))
    if cover_mode:
        draw_cover_side_strips(c, canvas_width, canvas_height, book_size)
        effective_content_width = float(content_page_width) if content_page_width is not None else page_width
        effective_content_height = float(content_page_height) if content_page_height is not None else page_height
        c.saveState()
        c.translate(content_x_offset, content_y_offset)
        draw_cover_stripes(c, effective_content_width, effective_content_height, colour1, colour2)
        if include_qr:
            draw_cover_qr(c, effective_content_width, effective_content_height, qr_value)
            draw_cover_slot_label(c, effective_content_width, effective_content_height, assigned_number)
        if include_book_id:
            draw_cover_book_id(c, effective_content_width, effective_content_height, book_id)
        draw_cover_batch_id(c, effective_content_width, effective_content_height, batch_id)
        draw_cover_spine_code(c, effective_content_width, effective_content_height, spine_code)
        c.restoreState()
    else:
        if include_qr:
            draw_inner_qr(c, page_width, page_height, qr_value)

        if include_book_id:
            draw_cover_book_id(c, page_width, page_height, book_id)

        if include_book_id or include_batch_id:
            draw_cover_batch_id(c, page_width, page_height, batch_id)

    c.save()
    return packet.getvalue()


def create_text_overlay_bytes(page_width: float, page_height: float, lines: list[str]) -> bytes:
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))
    c.setFont("Helvetica-Bold", 16)

    line_height = 22
    total_height = max(len(lines) - 1, 0) * line_height
    x = max(page_width * 0.25, 24)
    y = (page_height / 2) + (total_height / 2)
    for line in lines:
        c.drawString(x, y, line)
        y -= line_height

    c.save()
    return packet.getvalue()


def create_realtime_inner_overlay_bytes(page_width: float, page_height: float, qr_value: str, spine_code: str) -> bytes:
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))

    qr_image = make_qr_image_reader(qr_value)
    qr_x = max(page_width - QR_SIZE - QR_BOTTOM_MARGIN, 0)
    qr_y = max(page_height - QR_SIZE - QR_BOTTOM_MARGIN, 0)
    c.drawImage(qr_image, qr_x, qr_y, width=QR_SIZE, height=QR_SIZE, preserveAspectRatio=True, mask="auto")

    normalized_spine_code = str(spine_code or "").strip()
    if normalized_spine_code:
        c.saveState()
        c.setFont("Helvetica-Bold", 16)
        c.translate(page_width / 2, page_height / 2)
        c.rotate(90)
        c.drawCentredString(0, 0, normalized_spine_code)
        c.restoreState()

    c.save()
    return packet.getvalue()


def merge_overlay(
    page,
    qr_value: str,
    book_id: int,
    include_qr: bool,
    include_book_id: bool,
    *,
    cover_mode: bool = False,
    colour1=None,
    colour2=None,
    spine_code: str = "",
    book_size: str = "",
    content_page_width: float | None = None,
    content_page_height: float | None = None,
    content_x_offset: float = 0.0,
    content_y_offset: float = 0.0,
    assigned_number=None,
    batch_id: int | None = None,
    include_batch_id: bool = False,
) -> None:
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    overlay_bytes = create_overlay_bytes(
        page_width,
        page_height,
        qr_value,
        book_id,
        include_qr=include_qr,
        include_book_id=include_book_id,
        cover_mode=cover_mode,
        colour1=colour1,
        colour2=colour2,
        spine_code=spine_code,
        book_size=book_size,
        content_page_width=content_page_width,
        content_page_height=content_page_height,
        content_x_offset=content_x_offset,
        content_y_offset=content_y_offset,
        assigned_number=assigned_number,
        batch_id=batch_id,
        include_batch_id=include_batch_id,
    )
    overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
    page.merge_page(overlay_reader.pages[0])


def merge_text_overlay(page, lines: list[str]) -> None:
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    overlay_bytes = create_text_overlay_bytes(page_width, page_height, lines)
    overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
    page.merge_page(overlay_reader.pages[0])


def merge_realtime_inner_overlay(page, qr_value: str, spine_code: str) -> None:
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    overlay_bytes = create_realtime_inner_overlay_bytes(page_width, page_height, qr_value, spine_code)
    overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
    page.merge_page(overlay_reader.pages[0])


def process_pdf(
    source_path: Path,
    output_path: Path,
    qr_value: str,
    book_id: int,
    place_book_id_on_last_page: bool,
    *,
    cover_mode: bool = False,
    colour1=None,
    colour2=None,
    spine_code: str = "",
    book_size: str = "",
    assigned_number=None,
    batch_id: int | None = None,
) -> None:
    if not source_path.exists():
        raise FileNotFoundError(str(source_path))

    reader = PdfReader(str(source_path))
    writer = PdfWriter()

    page_count = len(reader.pages)
    if page_count == 0:
        raise ValueError(f"PDF has no pages: {source_path}")

    for index, page in enumerate(reader.pages):
        page_already_added = False
        is_first_page = index == 0
        is_last_page = place_book_id_on_last_page and index == page_count - 1
        content_page_width = None
        content_page_height = None
        content_x_offset = 0.0
        content_y_offset = 0.0
        if is_first_page:
            original_page = page
            normalized_book_size = str(book_size or "").strip().upper()
            if cover_mode and normalized_book_size in {"MEDIUM", "BIG"}:
                original_width = float(original_page.mediabox.width)
                original_height = float(original_page.mediabox.height)
                expanded_width, expanded_height = get_cover_canvas_size(original_width, original_height, book_size)
                content_page_width = original_width
                content_page_height = original_height
                content_x_offset = (expanded_width - original_width) / 2
                content_y_offset = (expanded_height - original_height) / 2
                expanded_page = writer.add_blank_page(width=expanded_width, height=expanded_height)
                expanded_page.merge_transformed_page(
                    original_page,
                    Transformation().translate(
                        tx=content_x_offset,
                        ty=content_y_offset,
                    ),
                )
                page = expanded_page
                page_already_added = True
            merge_overlay(
                page,
                qr_value,
                book_id,
                include_qr=True,
                include_book_id=True,
                cover_mode=cover_mode,
                colour1=colour1,
                colour2=colour2,
                spine_code=spine_code,
                book_size=book_size,
                content_page_width=content_page_width,
                content_page_height=content_page_height,
                content_x_offset=content_x_offset,
                content_y_offset=content_y_offset,
                assigned_number=assigned_number,
                batch_id=batch_id,
            )
        elif is_last_page:
            merge_overlay(
                page,
                qr_value,
                book_id,
                include_qr=False,
                include_book_id=True,
                batch_id=batch_id,
            )
        
        if not page_already_added:
            writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as target:
        writer.write(target)


def process_sticker_pdf(source_path: Path, output_path: Path, lines: list[str]) -> None:
    if not source_path.exists():
        raise FileNotFoundError(str(source_path))

    reader = PdfReader(str(source_path))
    writer = PdfWriter()
    if len(reader.pages) == 0:
        raise ValueError(f"PDF has no pages: {source_path}")

    for index, page in enumerate(reader.pages):
        if index == 0:
            merge_text_overlay(page, lines)
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as target:
        writer.write(target)


def process_realtime_inner_pdf(source_path: Path, output_path: Path, qr_value: str, spine_code: str) -> None:
    if not source_path.exists():
        raise FileNotFoundError(str(source_path))

    reader = PdfReader(str(source_path))
    writer = PdfWriter()
    if len(reader.pages) == 0:
        raise ValueError(f"PDF has no pages: {source_path}")

    for index, page in enumerate(reader.pages):
        if index == 0:
            merge_realtime_inner_overlay(page, qr_value, spine_code)
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as target:
        writer.write(target)


def process_shared_inner_pdf(source_path: Path, output_path: Path, qr_value: str, batch_id: int | None) -> None:
    if not source_path.exists():
        raise FileNotFoundError(str(source_path))

    reader = PdfReader(str(source_path))
    writer = PdfWriter()
    if len(reader.pages) == 0:
        raise ValueError(f"PDF has no pages: {source_path}")

    for index, page in enumerate(reader.pages):
        if index == 0:
            merge_overlay(
                page,
                qr_value,
                book_id=0,
                include_qr=True,
                include_book_id=False,
                include_batch_id=True,
                batch_id=batch_id,
            )
        writer.add_page(page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as target:
        writer.write(target)


def resolve_cover_source(row: sqlite3.Row) -> Path:
    school_id = row_int(row, "school_id")
    product_id = row_int(row, "product_id")
    student_id = row_int(row, "student_id")
    return GENERATED_ROOT / str(school_id) / str(product_id) / "COVER" / str(student_id) / f"{row['covercode']}.pdf"


def resolve_nonp_cover_source(row: sqlite3.Row) -> Path:
    covercode = str(row["covercode"] or "").strip()
    return NONP_COVER_SOURCE_ROOT / covercode[:5] / "pdf" / f"{covercode}.pdf"


def resolve_inner_source(row: sqlite3.Row) -> Path:
    school_id = row_int(row, "school_id")
    product_id = row_int(row, "product_id")
    student_id = row_int(row, "student_id")
    return GENERATED_ROOT / str(school_id) / str(product_id) / "INNER" / str(student_id) / f"{row['innercode']}.pdf"


def resolve_static_inner_source(row: sqlite3.Row) -> Path:
    return INNER_SOURCE_ROOT / f"{row['innercode']}.pdf"


def resolve_nonp_inner_source(row: sqlite3.Row) -> Path:
    return NONP_INNER_SOURCE_ROOT / f"{row['innercode']}.pdf"


def resolve_cover_output(batch_id: int, book_id: int) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "COVER" / f"{book_id}.pdf"


def resolve_inner_output(batch_id: int, book_id: int) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "INNER" / f"{book_id}.pdf"


def resolve_shared_inner_output(batch_id: int, innercode: str) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "INNER" / f"{innercode}.pdf"


def resolve_sticker_output(batch_id: int, book_id: int) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "STICKER" / f"{book_id}.pdf"


def resolve_binders_root(batch_id: int) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "BINDERS"


def resolve_inner_binders_root(batch_id: int) -> Path:
    return BATCH_PROCESSING_ROOT / str(batch_id) / "INNER_BINDERS"


def make_safe_filename_part(value: str, fallback: str) -> str:
    sanitized = "".join(char for char in str(value or "").strip() if char.isalnum() or char in (" ", "-", "_")).strip()
    return sanitized or fallback


def collect_realtime_inner_groups(book_rows: list[sqlite3.Row]) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for row in book_rows:
        per_value = str(row["personlized"] or "").strip().upper()
        real_time_print = str(row["real_time_print"] or "").strip().upper()
        if per_value == "Y" or real_time_print != "Y":
            continue
        innercode = str(row["innercode"] or "").strip()
        if not innercode:
            continue
        group = groups.setdefault(
            innercode,
            {
                "row": row,
                "count": 0,
                "spine_code": str(row["spine_code"] or "").strip(),
                "book_size": str(row["book_size"] or "").strip().upper() or "UNSPECIFIED",
            },
        )
        group["count"] += 1
    return groups


def collect_nonp_inner_groups(book_rows: list[sqlite3.Row]) -> dict[str, dict]:
    groups: dict[str, dict] = {}
    for row in book_rows:
        if int(row["nonp_order"] or 0) != 1:
            continue
        if str(row["personlized"] or "").strip().upper() != "Y":
            continue
        innercode = str(row["innercode"] or "").strip()
        if not innercode:
            continue
        group = groups.setdefault(
            innercode,
            {
                "row": row,
                "count": 0,
                "spine_code": str(row["spine_code"] or "").strip(),
                "book_size": str(row["book_size"] or "").strip().upper() or "UNSPECIFIED",
            },
        )
        group["count"] += 1
    return groups


def copy_realtime_inner_groups_to_binders(batch_id: int, realtime_groups: dict[str, dict]) -> None:
    binders_root = resolve_inner_binders_root(batch_id)
    binders_root.mkdir(parents=True, exist_ok=True)

    #for pdf_path in binders_root.glob("* copies *.pdf"):
    #    pdf_path.unlink()

    for innercode, group in realtime_groups.items():
        source_path = resolve_shared_inner_output(batch_id, innercode)
        if not source_path.exists():
            raise FileNotFoundError(f"Shared realtime inner PDF not found for innercode {innercode}: {source_path}")

        spine_code = make_safe_filename_part(group["spine_code"], innercode)
        size_folder = str(group["book_size"] or "").strip().upper() or "UNSPECIFIED"
        output_path = binders_root / size_folder / f"{group['count']} copies {spine_code}.pdf"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, output_path)


def copy_nonp_inner_groups_to_binders(batch_id: int, nonp_groups: dict[str, dict]) -> None:
    binders_root = resolve_inner_binders_root(batch_id)
    binders_root.mkdir(parents=True, exist_ok=True)

    for innercode, group in nonp_groups.items():
        source_path = resolve_shared_inner_output(batch_id, innercode)
        if not source_path.exists():
            raise FileNotFoundError(f"Shared nonp inner PDF not found for innercode {innercode}: {source_path}")

        spine_code = make_safe_filename_part(group["spine_code"], innercode)
        size_folder = str(group["book_size"] or "").strip().upper() or "UNSPECIFIED"
        output_path = binders_root / size_folder / f"{group['count']} copies {spine_code}.pdf"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, output_path)


def get_pdf_page_count(pdf_path: Path) -> int:
    if not pdf_path.exists():
        raise FileNotFoundError(str(pdf_path))
    reader = PdfReader(str(pdf_path))
    return len(reader.pages)


def merge_pdfs(pdf_paths: list[Path], output_path: Path) -> None:
    merged = fitz.open()
    try:
        for pdf_path in pdf_paths:
            source = fitz.open(str(pdf_path))
            try:
                merged.insert_pdf(source)
            finally:
                source.close()

        output_path.parent.mkdir(parents=True, exist_ok=True)
        merged.save(str(output_path))
    finally:
        merged.close()


def add_cover_binder_number(page: fitz.Page, binder_number: int) -> None:
    page.insert_text(
        (10, page.rect.height / 2),
        str(binder_number),
        fontsize=10,
        color=(1, 1, 1),
        rotate=90,
    )


def merge_cover_binder_pdfs(pdf_paths: list[Path], output_path: Path, binder_number: int) -> None:
    merged = fitz.open()
    try:
        for pdf_path in pdf_paths:
            source = fitz.open(str(pdf_path))
            try:
                start_index = merged.page_count
                merged.insert_pdf(source)
                end_index = merged.page_count
                for page_index in range(start_index, end_index):
                    add_cover_binder_number(merged[page_index], binder_number)
            finally:
                source.close()

        output_path.parent.mkdir(parents=True, exist_ok=True)
        merged.save(str(output_path))
    finally:
        merged.close()


def build_cover_group(row: sqlite3.Row, source_path: Path, page_count: int) -> dict:
    return {
        "innercode": str(row["innercode"] or ""),
        "personlized": str(row["personlized"] or "").strip().upper(),
        "real_time_print": str(row["real_time_print"] or "").strip().upper(),
        "book_size": str(row["book_size"] or "").strip().upper(),
        "spine_code": str(row["spine_code"] or "").strip(),
        "page_count": page_count,
        "pdf_paths": [source_path],
    }


def make_cover_groups(book_rows: list[sqlite3.Row], batch_id: int) -> list[dict]:
    groups: list[dict] = []
    current_group: dict | None = None

    for row in book_rows:
        if should_skip_code(row["covercode"]):
            continue

        cover_path = resolve_cover_output(batch_id, row["book_id"])
        if not cover_path.exists():
            raise FileNotFoundError(f"Generated cover PDF not found for book_id {row['book_id']}: {cover_path}")

        page_count = get_pdf_page_count(cover_path)
        innercode = str(row["innercode"] or "")

        if current_group is None or current_group["innercode"] != innercode:
            if current_group is not None:
                groups.append(current_group)
            current_group = build_cover_group(row, cover_path, page_count)
            continue

        if current_group["page_count"] + page_count > 500:
            groups.append(current_group)
            current_group = build_cover_group(row, cover_path, page_count)
            continue

        current_group["page_count"] += page_count
        current_group["pdf_paths"].append(cover_path)

    if current_group is not None:
        groups.append(current_group)

    return groups


def make_binder_filename(binder_number: int, binder_groups: list[dict]) -> str:
    per_label = "PER" if binder_groups and binder_groups[0]["personlized"] == "Y" else "NONPER"
    spine_codes = [group["spine_code"] for group in binder_groups if group["spine_code"]]
    unique_spines: list[str] = []
    for spine_code in spine_codes:
        if spine_code not in unique_spines:
            unique_spines.append(spine_code)

    if unique_spines:
        return f"{binder_number}_{per_label}_{'-'.join(unique_spines)}.pdf"
    return f"{binder_number}_{per_label}.pdf"


def write_cover_binder(batch_id: int, binder_number: int, binder_groups: list[dict]) -> None:
    pdf_paths: list[Path] = []
    for group in binder_groups:
        pdf_paths.extend(group["pdf_paths"])

    size_folder = str(binder_groups[0]["book_size"] or "").strip().upper() or "UNSPECIFIED"
    output_path = resolve_binders_root(batch_id) / size_folder / make_cover_filename(binder_number, binder_groups)
    merge_cover_binder_pdfs(pdf_paths, output_path, binder_number)


def make_cover_filename(binder_number: int, binder_groups: list[dict]) -> str:
    return make_binder_filename(binder_number, binder_groups)


def process_cover_binders(registry_path: str, batch_id: int, book_rows: list[sqlite3.Row]) -> int:
    cover_groups = make_cover_groups(book_rows, batch_id)
    binders_root = resolve_binders_root(batch_id)
    binders_root.mkdir(parents=True, exist_ok=True)
    for existing_pdf in binders_root.glob("*.pdf"):
        existing_pdf.unlink()

    binder_groups: list[dict] = []
    binder_pages = 0
    binder_number = 1
    binder_count = 0

    for group in cover_groups:
        if not binder_groups:
            binder_groups = [group]
            binder_pages = group["page_count"]
            continue

        same_meta = (
            binder_groups[0]["personlized"] == group["personlized"]
            and binder_groups[0]["real_time_print"] == group["real_time_print"]
            and binder_groups[0]["book_size"] == group["book_size"]
        )
        combined_pages = binder_pages + group["page_count"]

        if same_meta and combined_pages <= 500:
            binder_groups.append(group)
            binder_pages = combined_pages
            continue

        write_cover_binder(batch_id, binder_number, binder_groups)
        binder_count += 1
        binder_number += 1
        binder_groups = [group]
        binder_pages = group["page_count"]

    if binder_groups:
        write_cover_binder(batch_id, binder_number, binder_groups)
        binder_count += 1

    registry_conn = sqlite3.connect(registry_path)
    try:
        registry_conn.execute(
            "UPDATE batches SET cover_binder_generated = 1 WHERE id = ?",
            (batch_id,),
        )
        registry_conn.commit()
    finally:
        registry_conn.close()

    return binder_count


def get_inner_binder_limit(binder_number: int) -> int:
    if binder_number == 1:
        return 1000
    if binder_number == 2:
        return 800
    if binder_number == 3:
        return 600
    return 500


def make_inner_binder_filename(binder_number: int, binder_rows: list[sqlite3.Row]) -> str:
    book_size = str(binder_rows[0]["book_size"] or "").strip().upper() if binder_rows else ""
    spine_codes = [str(row["spine_code"] or "").strip() for row in binder_rows if str(row["spine_code"] or "").strip()]
    unique_spines: list[str] = []
    for spine_code in spine_codes:
        if spine_code not in unique_spines:
            unique_spines.append(spine_code)

    if unique_spines:
        return f"INNER_{binder_number}_PER_{book_size}_{'-'.join(unique_spines)}.pdf"
    return f"INNER_{binder_number}_PER_{book_size}.pdf"


def write_inner_binder(batch_id: int, binder_number: int, binder_rows: list[sqlite3.Row]) -> None:
    pdf_paths = [resolve_inner_output(batch_id, row["book_id"]) for row in binder_rows]
    size_folder = str(binder_rows[0]["book_size"] or "").strip().upper() or "UNSPECIFIED"
    output_path = resolve_inner_binders_root(batch_id) / size_folder / make_inner_binder_filename(binder_number, binder_rows)
    merge_pdfs(pdf_paths, output_path)


def process_inner_binders(registry_path: str, batch_id: int, book_rows: list[sqlite3.Row]) -> int:
    eligible_rows: list[sqlite3.Row] = []
    for row in book_rows:
        if int(row["nonp_order"] or 0) == 1:
            continue
        if str(row["personlized"] or "").strip().upper() != "Y":
            continue
        if endswith_code(row["innercode"], "s") or endswith_code(row["innercode"], "b"):
            continue

        inner_path = resolve_inner_output(batch_id, row["book_id"])
        if not inner_path.exists():
            raise FileNotFoundError(f"Generated inner PDF not found for book_id {row['book_id']}: {inner_path}")
        eligible_rows.append(row)

    binders_root = resolve_inner_binders_root(batch_id)
    binders_root.mkdir(parents=True, exist_ok=True)
    for existing_pdf in binders_root.glob("*.pdf"):
        existing_pdf.unlink()

    binder_rows: list[sqlite3.Row] = []
    binder_pages = 0
    binder_number = 1
    binder_count = 0

    for row in eligible_rows:
        row_path = resolve_inner_output(batch_id, row["book_id"])
        row_pages = get_pdf_page_count(row_path)
        limit = get_inner_binder_limit(binder_number)

        if not binder_rows:
            binder_rows = [row]
            binder_pages = row_pages
            continue

        same_book_size = (
            str(binder_rows[0]["book_size"] or "").strip().upper()
            == str(row["book_size"] or "").strip().upper()
        )
        if same_book_size and binder_pages + row_pages <= limit:
            binder_rows.append(row)
            binder_pages += row_pages
            continue

        write_inner_binder(batch_id, binder_number, binder_rows)
        binder_count += 1
        binder_number += 1
        binder_rows = [row]
        binder_pages = row_pages

    if binder_rows:
        write_inner_binder(batch_id, binder_number, binder_rows)
        binder_count += 1

    registry_conn = sqlite3.connect(registry_path)
    try:
        registry_conn.execute(
            "UPDATE batches SET inner_binder_generated = 1 WHERE id = ?",
            (batch_id,),
        )
        registry_conn.commit()
    finally:
        registry_conn.close()

    return binder_count


def process_cover_rows(conn: sqlite3.Connection, batch_id: int, book_rows: list[sqlite3.Row]) -> int:
    generated = 0
    for row in book_rows:
        if bool(row["cover_generated"]) or should_skip_code(row["covercode"]):
            continue

        nonp_order = int(row["nonp_order"] or 0)
        source_path = resolve_nonp_cover_source(row) if nonp_order == 1 else resolve_cover_source(row)
        if not source_path.exists():
            raise FileNotFoundError(f"Cover PDF not found for book_id {row['book_id']}: {source_path}")

        output_path = resolve_cover_output(batch_id, row["book_id"])
        process_pdf(
            source_path,
            output_path,
            str(row["coverqr"] or ""),
            int(row["book_id"]),
            place_book_id_on_last_page=False,
            cover_mode=True,
            colour1=row["colour_1"],
            colour2=row["colour_2"],
            spine_code=str(row["spine_code"] or ""),
            book_size=str(row["book_size"] or ""),
            assigned_number=row["assigned_number"],
            batch_id=batch_id,
        )
        conn.execute(
            "UPDATE BookDetails SET cover_generated = 1 WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
        generated += 1

    return generated


def process_inner_rows(conn: sqlite3.Connection, batch_id: int, book_rows: list[sqlite3.Row]) -> int:
    generated = 0
    processed_realtime_innercodes: set[str] = set()
    processed_nonp_innercodes: set[str] = set()
    for row in book_rows:
        if bool(row["inner_generated"]) or endswith_code(row["innercode"], "b"):
            continue

        if endswith_code(row["innercode"], "s"):
            nonp_order = int(row["nonp_order"] or 0)
            
            if nonp_order == 1:
                conn.execute(
                    "UPDATE BookDetails SET inner_generated = 1 WHERE id = ?",
                    (row["id"],),
                )
                conn.commit()
                continue
            
            source_path = resolve_nonp_inner_source(row) if nonp_order == 1 else resolve_inner_source(row)
            if not source_path.exists():
                raise FileNotFoundError(f"Sticker PDF not found for book_id {row['book_id']}: {source_path}")

            
            output_path = resolve_sticker_output(batch_id, row["book_id"])
            
            if nonp_order == 1:
                lines = [
                    f"School: {row['school_name'] or ''}"
                ]
            else:
                lines = [
                    f"School: {row['school_name'] or ''} Student: {row['student_name'] or ''} {row_int(row, 'student_id')}"
                ]
            process_sticker_pdf(source_path, output_path, lines)
            conn.execute(
                "UPDATE BookDetails SET inner_generated = 1 WHERE id = ?",
                (row["id"],),
            )
            conn.commit()
            generated += 1
            continue

        per_value = str(row["personlized"] or "").strip().upper()
        real_time_print = str(row["real_time_print"] or "").strip().upper()
        nonp_order = int(row["nonp_order"] or 0)

        if per_value != "Y":
            if real_time_print == "Y":
                innercode = str(row["innercode"] or "").strip()
                if innercode in processed_realtime_innercodes:
                    continue
                source_path = resolve_static_inner_source(row)
                if not source_path.exists():
                    raise FileNotFoundError(f"Inner source PDF not found for book_id {row['book_id']}: {source_path}")
                output_path = resolve_shared_inner_output(batch_id, innercode)
                process_shared_inner_pdf(
                    source_path,
                    output_path,
                    str(row["innerqr"] or ""),
                    batch_id,
                )
                conn.execute(
                    """
                    UPDATE BookDetails
                    SET inner_generated = 1
                    WHERE innercode = ?
                      AND UPPER(TRIM(COALESCE(personlized, ''))) != 'Y'
                      AND UPPER(TRIM(COALESCE(real_time_print, ''))) = 'Y'
                    """,
                    (innercode,),
                )
                conn.commit()
                processed_realtime_innercodes.add(innercode)
                generated += 1
            else:
                conn.execute(
                    "UPDATE BookDetails SET inner_generated = 1 WHERE id = ?",
                    (row["id"],),
                )
                conn.commit()
            continue

        if nonp_order == 1:
            innercode = str(row["innercode"] or "").strip()
            source_path = resolve_nonp_inner_source(row)
            if not source_path.exists():
                raise FileNotFoundError(f"Nonp inner source PDF not found for book_id {row['book_id']}: {source_path}")
            if innercode not in processed_nonp_innercodes:
                output_path = resolve_shared_inner_output(batch_id, innercode)
                process_shared_inner_pdf(
                    source_path,
                    output_path,
                    str(row["innerqr"] or ""),
                    batch_id,
                )
                processed_nonp_innercodes.add(innercode)
                generated += 1
            conn.execute(
                """
                UPDATE BookDetails
                SET inner_generated = 1
                WHERE innercode = ?
                  AND nonp_order = 1
                """,
                (innercode,),
            )
            conn.commit()
            continue

        source_path = resolve_inner_source(row)

        if not source_path.exists():
            raise FileNotFoundError(f"Inner PDF not found for book_id {row['book_id']}: {source_path}")
        
        output_path = resolve_inner_output(batch_id, row["book_id"])
        process_pdf(
            source_path,
            output_path,
            str(row["innerqr"] or ""),
            int(row["book_id"]),
            place_book_id_on_last_page=True,
            batch_id=batch_id,
        )
        conn.execute(
            "UPDATE BookDetails SET inner_generated = 1 WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
        generated += 1

    return generated


def main() -> int:
    args = parse_args()

    registry_conn = sqlite3.connect(args.registry_path)
    registry_conn.row_factory = sqlite3.Row
    try:
        batch_row = registry_conn.execute(
            "SELECT id, batch_name, db_path FROM batches WHERE id = ?",
            (args.batch_id,),
        ).fetchone()
    finally:
        registry_conn.close()

    if batch_row is None:
        print(f"Batch {args.batch_id} not found in registry.", file=sys.stderr)
        return 1

    batch_name = batch_row["batch_name"] or args.batch_name
    batch_db_path = batch_row["db_path"]

    batch_conn = sqlite3.connect(batch_db_path)
    batch_conn.row_factory = sqlite3.Row
    try:
        book_rows = batch_conn.execute(
            """
            SELECT *
            FROM BookDetails
            ORDER BY book_id ASC, assigned_number ASC, id ASC
            """
        ).fetchall()

        if not book_rows:
            print("BookDetails is empty.", file=sys.stderr)
            return 1

        realtime_inner_groups = collect_realtime_inner_groups(book_rows)
        nonp_inner_groups = collect_nonp_inner_groups(book_rows)
        cover_generated_count = process_cover_rows(batch_conn, args.batch_id, book_rows)
        cover_binder_count = process_cover_binders(args.registry_path, args.batch_id, book_rows)
        
        inner_generated_count = process_inner_rows(batch_conn, args.batch_id, book_rows)
        inner_binder_count = process_inner_binders(args.registry_path, args.batch_id, book_rows)
        copy_realtime_inner_groups_to_binders(args.batch_id, realtime_inner_groups)
        copy_nonp_inner_groups_to_binders(args.batch_id, nonp_inner_groups)
        
        batch_conn.commit()
    except Exception as error:
        batch_conn.rollback()
        print(str(error), file=sys.stderr)
        return 1
    finally:
        batch_conn.close()

    print(
        f"Book generation completed for batch {args.batch_id} ({batch_name}). "
        f"Cover generated: {cover_generated_count}, cover binders: {cover_binder_count}, "
        f"inner generated: {inner_generated_count}, inner binders: {inner_binder_count}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
