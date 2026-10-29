"""ROBer COP Docling worker.

Converts one PDF with Docling and writes, into the output directory:
  document.json  - the full DoclingDocument (structured JSON, kept for provenance)
  document.md    - Markdown with <!-- page N --> markers (readable model context)
  blocks.json    - flat list of text blocks with page, kind, section, bbox (top-left origin, PDF points) and OCR flag
  result.json    - summary: status, versions, coverage, warnings

Progress is reported as JSON lines on stdout: {"event": "progress", "stage": "...", "fraction": 0.5}.
Exit code 0 on success or partial success, 2 on failure.

Usage: python docling_worker.py --input file.pdf --output outdir [--ocr auto|on|off] [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path


def emit(event: str, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


def check_environment() -> int:
    try:
        import docling  # noqa: F401
        from importlib.metadata import version

        emit("ok", docling=version("docling"), python=sys.version.split()[0])
        return 0
    except Exception as exc:  # pragma: no cover - environment dependent
        emit("missing", error=str(exc))
        return 3


def native_text_pages(path: Path) -> set[int] | None:
    """Pages (1-based) that have a native text layer, or None if pypdfium2 is unavailable."""
    try:
        import pypdfium2 as pdfium
    except Exception:
        return None
    pages: set[int] = set()
    pdf = pdfium.PdfDocument(str(path))
    try:
        for i in range(len(pdf)):
            text = pdf[i].get_textpage().get_text_range()
            if len(text.strip()) >= 20:
                pages.add(i + 1)
    finally:
        pdf.close()
    return pages


def page_count(path: Path) -> int | None:
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(str(path))
        try:
            return len(pdf)
        finally:
            pdf.close()
    except Exception:
        return None


KIND_MAP = {
    "title": "heading",
    "section_header": "heading",
    "text": "text",
    "paragraph": "text",
    "list_item": "list_item",
    "caption": "caption",
    "footnote": "footnote",
    "table": "table",
    "page_header": "page_header",
    "page_footer": "page_footer",
    "formula": "formula",
    "reference": "reference",
    "code": "code",
}


def convert(input_path: Path, out_dir: Path, ocr_mode: str) -> int:
    from importlib.metadata import version

    from docling.datamodel.base_models import ConversionStatus, InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    out_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    native = native_text_pages(input_path)

    total = page_count(input_path)
    options = PdfPipelineOptions()
    options.do_table_structure = True
    if ocr_mode == "on":
        options.do_ocr = True
    elif ocr_mode == "off":
        options.do_ocr = False
    else:
        # OCR only when some pages lack a native text layer, or when that cannot be determined.
        options.do_ocr = native is None or total is None or len(native) < total
    emit("progress", stage="loading models", fraction=0.05)
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})

    emit("progress", stage="converting", fraction=0.15)
    started = time.time()

    def on_progress(ev):
        done = getattr(ev, "completed_pages", None)
        total_pages = getattr(ev, "total_pages", None)
        if done is not None and total_pages:
            emit("progress", stage=f"page {done} of {total_pages}", fraction=0.15 + 0.7 * done / total_pages)

    try:
        result = converter.convert(str(input_path), raises_on_error=False, progress_callback=on_progress)
    except TypeError:  # Docling versions without progress callbacks
        result = converter.convert(str(input_path), raises_on_error=False)
    status = result.status
    for err in getattr(result, "errors", []) or []:
        warnings.append(f"{getattr(err, 'component_type', 'docling')}: {getattr(err, 'error_message', err)}")
    if status == ConversionStatus.FAILURE:
        (out_dir / "result.json").write_text(json.dumps({"status": "failure", "warnings": warnings}))
        emit("error", message="Docling conversion failed", warnings=warnings)
        return 2
    if status == ConversionStatus.PARTIAL_SUCCESS:
        warnings.append("Docling reported a partial conversion; some pages may be missing.")

    doc = result.document
    emit("progress", stage="exporting", fraction=0.85)
    (out_dir / "document.json").write_text(json.dumps(doc.export_to_dict()))

    page_heights = {}
    for page_no, page in (doc.pages or {}).items():
        try:
            page_heights[int(page_no)] = float(page.size.height)
        except Exception:
            pass
    total_pages = len(page_heights) or (max(page_heights) if page_heights else 0)

    blocks = []
    section = ""
    tables = 0
    pages_with_text: set[int] = set()
    for item, _level in doc.iterate_items():
        label = str(getattr(item, "label", "text")).split(".")[-1].lower()
        kind = KIND_MAP.get(label, "text")
        if kind == "table":
            tables += 1
            try:
                text = item.export_to_markdown(doc=doc)
            except TypeError:
                text = item.export_to_markdown()
        else:
            text = getattr(item, "text", "") or ""
        text = text.strip()
        if not text:
            continue
        provs = getattr(item, "prov", None) or []
        page = int(provs[0].page_no) if provs else 0
        bbox = None
        if provs:
            try:
                b = provs[0].bbox
                height = page_heights.get(page)
                if height is not None:
                    b = b.to_top_left_origin(page_height=height)
                bbox = [float(b.l), float(b.t), float(b.r), float(b.b)]
            except Exception:
                bbox = None
        if kind == "heading":
            section = text
        pages_with_text.add(page)
        blocks.append(
            {
                "page": page,
                "kind": kind,
                "text": text,
                "section": "" if kind == "heading" else section,
                "bbox": bbox,
                "ocr": bool(options.do_ocr and native is not None and page not in native),
            }
        )

    md_parts = []
    last_page = None
    for b in blocks:
        if b["kind"] in ("page_header", "page_footer"):
            continue
        if b["page"] != last_page:
            md_parts.append(f"<!-- page {b['page']} -->")
            last_page = b["page"]
        md_parts.append(f"## {b['text']}" if b["kind"] == "heading" else b["text"])
    (out_dir / "document.md").write_text("\n\n".join(md_parts) + "\n")
    (out_dir / "blocks.json").write_text(json.dumps(blocks))

    all_pages = set(page_heights) if page_heights else set(range(1, total_pages + 1))
    empty = sorted(p for p in all_pages if p not in pages_with_text)
    ocr_pages = sorted(p for p in all_pages if native is not None and options.do_ocr and p not in native)
    if empty:
        warnings.append(f"No text extracted on page(s) {', '.join(map(str, empty))}.")
    summary = {
        "status": "partial" if status == ConversionStatus.PARTIAL_SUCCESS else "success",
        "parser_version": f"docling {version('docling')}",
        "settings": {"do_ocr": bool(options.do_ocr), "do_table_structure": True, "ocr_mode": ocr_mode},
        "coverage": {
            "pages": len(all_pages),
            "pagesWithText": len(all_pages) - len(empty),
            "emptyPages": empty,
            "ocrPages": ocr_pages,
            "tables": tables,
            "blocks": len(blocks),
        },
        "warnings": warnings,
        "seconds": round(time.time() - started, 1),
    }
    (out_dir / "result.json").write_text(json.dumps(summary))
    emit("done", **summary)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--ocr", default="auto", choices=["auto", "on", "off"])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        return check_environment()
    if not args.input or not args.output:
        parser.error("--input and --output are required")
    try:
        return convert(Path(args.input), Path(args.output), args.ocr)
    except Exception as exc:
        message = str(exc)
        text = traceback.format_exc()
        if "huggingface" in text.lower() or "403" in message or "ConnectError" in text or "LocalEntryNotFoundError" in text:
            message = (
                "Docling could not load its layout models (download failed: " + message + "). "
                "Run the launcher with --setup-docling while online; models are cached after the first download."
            )
        emit("error", message=message, trace=traceback.format_exc(limit=5))
        return 2


if __name__ == "__main__":
    sys.exit(main())
