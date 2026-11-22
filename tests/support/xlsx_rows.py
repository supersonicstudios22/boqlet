"""Prints one sheet of a workbook as JSON rows (values only), for the suites' checks of exported files.
Usage: xlsx_rows.py <file.xlsx> <sheet>"""
import json
import sys

from openpyxl import load_workbook

book = load_workbook(sys.argv[1], read_only=True, data_only=False)
rows = [list(row) for row in book[sys.argv[2]].iter_rows(values_only=True)]
print(json.dumps(rows, default=str, ensure_ascii=False))
