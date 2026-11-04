import { buildXlsx, type XlsxCell } from './xlsx';

// Workbooks sized around the cell limit, the Node counterpart of Python's
// `write_xlsx_cells` (tests/fixture_files.py).

/** The Python service's MAX_XLSX_CELLS default. */
export const MAX_XLSX_CELLS = 70_000;

export interface CellGrid {
  readonly name: string;
  readonly rows: number;
  readonly cols: number;
}

const gridRows = (rows: number, cols: number): XlsxCell[][] =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `r${r}c${c}`),
  );

const tailRow = (cells: number): XlsxCell[][] =>
  cells > 0 ? [Array.from({ length: cells }, (_, c) => `tail${c}`)] : [];

/**
 * Sheets with `r{row}c{col}` (0-based) in every cell; `tailCells` adds one
 * more row of `tail{col}` cells to the last sheet.
 */
export const buildXlsxCells = (
  sheets: readonly CellGrid[],
  tailCells = 0,
): Buffer =>
  buildXlsx(
    sheets.map(({ name, rows, cols }, index) => ({
      name,
      rows: [
        ...gridRows(rows, cols),
        ...(index === sheets.length - 1 ? tailRow(tailCells) : []),
      ],
    })),
  );

/** Exactly MAX_XLSX_CELLS + 1 cells, so only the cell pre-check rejects it. */
export const buildOverCellLimitXlsx = (): Buffer =>
  buildXlsxCells(
    [{ name: 'Big', rows: Math.floor((MAX_XLSX_CELLS + 1) / 10), cols: 10 }],
    (MAX_XLSX_CELLS + 1) % 10,
  );

/**
 * 5 sheets of 14,000 rows: exactly MAX_XLSX_CELLS, so it passes the pre-check
 * and reaches the converter, where a short deadline can stop it.
 */
export const buildLargeForTimeoutXlsx = (): Buffer =>
  buildXlsxCells(
    Array.from({ length: 5 }, (_, i) => ({
      name: `Sheet${i + 1}`,
      rows: MAX_XLSX_CELLS / 5,
      cols: 1,
    })),
  );

const ONE_DATA_COLUMN: readonly CellGrid[] = [
  { name: 'Data', rows: MAX_XLSX_CELLS, cols: 1 },
];

/** 70,000 cells in one sheet: the shape of Req 11.2's RSS baseline workbook. */
export const buildOneSheetAtCellLimitXlsx = (): Buffer =>
  buildXlsxCells(ONE_DATA_COLUMN);

export const buildOneSheetOverCellLimitXlsx = (): Buffer =>
  buildXlsxCells(ONE_DATA_COLUMN, 1);
