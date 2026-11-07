"""Read spreadsheet files into plain row tuples, whatever Excel format the instrument wrote."""
from __future__ import annotations

import os
import zipfile
from pathlib import Path
from typing import Any, BinaryIO

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

SheetRows = list[tuple[str, list[tuple[Any, ...]]]]

_ZIP_SIGNATURE = b"PK\x03\x04"
_OLE2_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def read_xlsx(source: Path | BinaryIO) -> SheetRows:
    try:
        workbook = load_workbook(source, read_only=True, data_only=True)
    # A file that is not a zip archive, or a zip without workbook parts (cut off, renamed from another format).
    except (zipfile.BadZipFile, InvalidFileException, KeyError) as error:
        raise ValueError("This file could not be read as an Excel file; it may be damaged or saved in another format. Export the results again, or save them as .xlsx or .csv.") from error
    try:
        return [(sheet.title, [tuple(row) for row in sheet.iter_rows(values_only=True)]) for sheet in workbook.worksheets]
    finally:
        workbook.close()


def read_xls(path: Path) -> SheetRows:
    """Legacy .xls files: real BIFF workbooks, or newer workbooks that were given the old extension."""
    with path.open("rb") as file:
        signature = file.read(len(_OLE2_SIGNATURE))
        if signature.startswith(_ZIP_SIGNATURE):
            # openpyxl refuses the .xls extension by name, so hand it the open file instead.
            file.seek(0)
            return read_xlsx(file)
    if signature != _OLE2_SIGNATURE:
        raise ValueError("This file could not be read as an Excel file. Export the results again, or save them as .xlsx or .csv.")
    return _read_biff(path)


def _read_biff(path: Path) -> SheetRows:
    try:
        import xlrd
    except ImportError as error:
        raise ValueError("Reading .xls files needs the xlrd package, which is missing from this installation. The window where the workbench runs shows the command that updates it. Or save the file as .xlsx.") from error
    # Damaged files make xlrd fail in many ways (IndexError, struct.error, ...); all mean the same to the user.
    try:
        with open(os.devnull, "w") as quiet:
            book = xlrd.open_workbook(str(path), on_demand=True, logfile=quiet)
            try:
                sheets: SheetRows = []
                for name in book.sheet_names():
                    sheet = book.sheet_by_name(name)
                    sheets.append((name, [tuple(_biff_value(cell, book.datemode) for cell in sheet.row(index)) for index in range(sheet.nrows)]))
                    book.unload_sheet(name)
                return sheets
            finally:
                book.release_resources()
    except Exception as error:
        raise ValueError("This file could not be read as an Excel file; it may be damaged or incomplete. Export the results again, or save them as .xlsx or .csv.") from error


def _biff_value(cell: Any, datemode: int) -> Any:
    """Match openpyxl's values: blanks are None, whole numbers are int, dates are datetimes."""
    import xlrd
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return None
    if cell.ctype == xlrd.XL_CELL_TEXT:
        return cell.value if cell.value.strip() else None
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        return int(cell.value) if float(cell.value).is_integer() else cell.value
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            return xlrd.xldate.xldate_as_datetime(cell.value, datemode)
        except (ValueError, OverflowError):
            return cell.value
    if cell.ctype == xlrd.XL_CELL_ERROR:
        return xlrd.error_text_from_code.get(cell.value, "#ERROR")
    return cell.value
