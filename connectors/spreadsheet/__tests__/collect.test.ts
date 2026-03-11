import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import * as yaml from 'js-yaml';
import { loadSpreadsheet, transformToAsset, discoverSpreadsheets } from '../collect.js';

function createTestXlsx(data: any[][], sheetName = 'Sheet1'): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const tmpPath = path.join('/tmp', `test-${Date.now()}.xlsx`);
  XLSX.writeFile(wb, tmpPath);
  return tmpPath;
}

function createTestMapping(mapping: any): string {
  const tmpPath = path.join('/tmp', `test-${Date.now()}.mapping.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(mapping));
  return tmpPath;
}

describe('loadSpreadsheet', () => {
  it('should load XLSX and write YAML intermediate file', () => {
    const xlsxPath = createTestXlsx([
      ['Name', 'Type', 'Location'],
      ['Server-01', 'computer', 'DC-East'],
      ['Switch-02', 'network', 'DC-West'],
    ]);
    const mappingPath = createTestMapping({
      sheetName: 'Sheet1',
      startRow: 2,
      columnMapping: { A: 'name', B: 'type', C: 'location' },
    });
    const yamlPath = path.join('/tmp', `test-${Date.now()}.yaml`);

    const rows = loadSpreadsheet(xlsxPath, mappingPath, yamlPath);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Server-01', type: 'computer', location: 'DC-East' });
    expect(rows[1]).toEqual({ name: 'Switch-02', type: 'network', location: 'DC-West' });

    // Verify YAML intermediate file was written
    expect(fs.existsSync(yamlPath)).toBe(true);
    const yamlContent = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as any;
    expect(yamlContent.assets).toHaveLength(2);
    expect(yamlContent.assets[0].name).toBe('Server-01');

    // Cleanup
    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(mappingPath);
    fs.unlinkSync(yamlPath);
  });

  it('should apply transformers from mapping config', () => {
    const xlsxPath = createTestXlsx([
      ['Name', 'Count'],
      ['  Server-01  ', '42'],
    ]);
    const mappingPath = createTestMapping({
      startRow: 2,
      columnMapping: { A: 'name', B: 'count' },
      transformers: { name: 'trim', count: 'int' },
    });
    const yamlPath = path.join('/tmp', `test-${Date.now()}.yaml`);

    const rows = loadSpreadsheet(xlsxPath, mappingPath, yamlPath);

    expect(rows[0].name).toBe('Server-01');
    expect(rows[0].count).toBe(42);

    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(mappingPath);
    fs.unlinkSync(yamlPath);
  });

  it('should use custom rootKey in YAML output', () => {
    const xlsxPath = createTestXlsx([
      ['Name'],
      ['item-1'],
    ]);
    const mappingPath = createTestMapping({
      startRow: 2,
      columnMapping: { A: 'name' },
      rootKey: 'devices',
    });
    const yamlPath = path.join('/tmp', `test-${Date.now()}.yaml`);

    loadSpreadsheet(xlsxPath, mappingPath, yamlPath);

    const yamlContent = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as any;
    expect(yamlContent.devices).toBeDefined();
    expect(yamlContent.devices[0].name).toBe('item-1');

    fs.unlinkSync(xlsxPath);
    fs.unlinkSync(mappingPath);
    fs.unlinkSync(yamlPath);
  });
});

describe('discoverSpreadsheets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'discover-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function touch(name: string): void {
    const filePath = path.join(tmpDir, name);
    if (name.endsWith('.xlsx')) {
      // Write a minimal valid xlsx so the file exists
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['h']]), 'Sheet1');
      XLSX.writeFile(wb, filePath);
    } else {
      fs.writeFileSync(filePath, '{}');
    }
  }

  it('should match xlsx with same-name mapping', () => {
    touch('Asset Reg1.xlsx');
    touch('Asset Reg1.mapping.json');

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].xlsxPath).toContain('Asset Reg1.xlsx');
    expect(result[0].mappingPath).toContain('Asset Reg1.mapping.json');
  });

  it('should strip suffix after underscore to find mapping', () => {
    touch('Asset Lib 2_2025.xlsx');
    touch('Asset Lib 2.mapping.json');

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].xlsxPath).toContain('Asset Lib 2_2025.xlsx');
    expect(result[0].mappingPath).toContain('Asset Lib 2.mapping.json');
  });

  it('should skip xlsx files with no matching mapping', () => {
    touch('No Mapping.xlsx');

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(0);
  });

  it('should find multiple matches in a folder', () => {
    touch('File A.xlsx');
    touch('File A.mapping.json');
    touch('File B_2024.xlsx');
    touch('File B.mapping.json');
    touch('File C.xlsx'); // no mapping

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(2);
    const xlsxNames = result.map(r => path.basename(r.xlsxPath)).sort();
    expect(xlsxNames).toEqual(['File A.xlsx', 'File B_2024.xlsx']);
  });

  it('should prefer exact match over underscore-stripped match', () => {
    touch('Report_2025.xlsx');
    touch('Report_2025.mapping.json'); // exact match
    touch('Report.mapping.json');      // stripped match

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].mappingPath).toContain('Report_2025.mapping.json');
  });

  it('should ignore non-xlsx files', () => {
    touch('readme.txt');
    touch('data.csv');
    touch('Asset Reg1.mapping.json');

    const result = discoverSpreadsheets(tmpDir);

    expect(result).toHaveLength(0);
  });
});

describe('transformToAsset', () => {
  it('should transform a row to BaseAsset schema', () => {
    const row = {
      id: 'srv-001',
      name: 'Web Server 01',
      type: 'computer',
      location: 'DC-East',
      owner: 'Platform Team',
    };

    const asset = transformToAsset(row, 'spreadsheet');

    expect(asset.id).toBe('srv-001');
    expect(asset.name).toBe('Web Server 01');
    expect(asset.type).toBe('computer');
    expect(asset.source).toBe('spreadsheet');
    expect(asset.schemaVersion).toBe(1);
    expect(asset.discoveredAt).toBeDefined();
    expect(asset.location).toEqual({ building: 'DC-East' });
    expect(asset.ownership).toEqual({ owner: 'Platform Team' });
  });

  it('should generate id from name if id not present', () => {
    const row = { name: 'My Server', type: 'computer' };
    const asset = transformToAsset(row, 'spreadsheet');

    expect(asset.id).toBe('my-server');
  });

  it('should default type to "asset" when not specified', () => {
    const row = { id: 'x', name: 'Thing' };
    const asset = transformToAsset(row, 'spreadsheet');

    expect(asset.type).toBe('asset');
  });

  it('should put unmapped fields into extendedData', () => {
    const row = {
      id: 'x',
      name: 'Thing',
      type: 'computer',
      serialNumber: 'SN-123',
      manufacturer: 'Dell',
    };

    const asset = transformToAsset(row, 'spreadsheet');

    expect(asset.extendedData).toEqual({
      serialNumber: 'SN-123',
      manufacturer: 'Dell',
    });
  });

  it('should omit extendedData when no extra fields', () => {
    const row = { id: 'x', name: 'Thing', type: 'computer' };
    const asset = transformToAsset(row, 'spreadsheet');

    expect(asset.extendedData).toBeUndefined();
  });
});
