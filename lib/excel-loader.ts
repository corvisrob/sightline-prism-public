import * as XLSX from 'xlsx';

/**
 * Configuration for loading a list of items from Excel
 */
export interface ExcelMappingConfig {
  worksheet?: string;
  columns: Record<string, string>;
  startRow?: number;
  endRow?: number;
  mappers?: Record<string, (value: any) => any>;
}

/**
 * ExcelLoader class for loading and mapping Excel data using SheetJS (xlsx)
 *
 * Example usage:
 * ```typescript
 * const loader = new ExcelLoader(arrayBuffer);
 *
 * const config = {
 *   worksheet: 'Sheet1',
 *   columns: { A: 'name', B: 'type', C: 'location' },
 *   startRow: 2  // Skip header row
 * };
 *
 * const assets = loader.loadList(config);
 * ```
 */
export class ExcelLoader {
  private workbook: XLSX.WorkBook;

  constructor(arrayBuffer: ArrayBuffer) {
    this.workbook = XLSX.read(arrayBuffer, { type: 'array' });
  }

  /**
   * Load a list of items from a worksheet.
   * Returns an array of objects keyed by the column names in config.columns.
   */
  loadList<T = any>(config: ExcelMappingConfig): T[] {
    const sheetName = config.worksheet || this.workbook.SheetNames[0];
    const sheet = this.workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error(`Worksheet "${sheetName}" not found`);
    }

    const startRow = config.startRow || 1;
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const endRow = config.endRow || range.e.r + 1;

    const items: any[] = [];

    for (let rowIndex = startRow - 1; rowIndex < endRow; rowIndex++) {
      const item: any = {};
      let hasData = false;

      for (const [col, key] of Object.entries(config.columns)) {
        const cellAddress = `${col}${rowIndex + 1}`;
        const cell = sheet[cellAddress];
        let value = cell ? cell.v : undefined;

        if (value !== undefined && value !== null && value !== '') {
          hasData = true;
        }

        if (config.mappers && config.mappers[key]) {
          value = config.mappers[key](value);
        }

        item[key] = value;
      }

      if (hasData) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Get all sheet names in the workbook
   */
  getSheetNames(): string[] {
    return this.workbook.SheetNames;
  }
}

/**
 * Helper mappers for data transformation
 */
export const Mappers = {
  trim: (value: any) => (typeof value === 'string' ? value.trim() : value),

  uppercase: (value: any) => (typeof value === 'string' ? value.toUpperCase() : value),

  lowercase: (value: any) => (typeof value === 'string' ? value.toLowerCase() : value),

  number: (value: any) => {
    const num = Number(value);
    return isNaN(num) ? null : num;
  },

  int: (value: any) => {
    const num = Number.parseInt(value);
    return isNaN(num) ? null : num;
  },

  float: (value: any) => {
    const num = Number.parseFloat(value);
    return isNaN(num) ? null : num;
  },

  boolean: (value: any) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === 'yes' || lower === '1';
    }
    return Boolean(value);
  },

  date: (value: any) => {
    if (value instanceof Date) return value;
    return new Date(value);
  },

  defaultValue: (defaultVal: any) => (value: any) => (value == null ? defaultVal : value),

  chain: (...mappers: Array<(value: any) => any>) => (value: any) => {
    return mappers.reduce((acc, mapper) => mapper(acc), value);
  },
};
