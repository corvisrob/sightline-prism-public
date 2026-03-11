# Spreadsheet Connector

Imports asset data from Excel (`.xlsx`) files using a JSON mapping configuration, with a YAML intermediate file for inspection.

## Data Flow

```
XLSX File + Mapping JSON
        ↓
  ExcelLoader (parse & transform)
        ↓
  YAML Intermediate File (human-readable, editable)
        ↓
  BaseAsset Transformation
        ↓
  Schema Validation (Zod)
        ↓
  MongoDB Snapshot
```

## Usage

```bash
# Via CLI arguments
npm run collect:spreadsheet -- path/to/assets.xlsx path/to/assets.mapping.json

# Via environment variables
SPREADSHEET_FILE=path/to/assets.xlsx \
SPREADSHEET_MAPPING=path/to/assets.mapping.json \
npm run collect:spreadsheet
```

### Auto-Detection

If no mapping file is provided, the connector looks for `<basename>.mapping.json` in the same directory as the XLSX file, where `<basename>` is the filename up to the first non-alphabet character.

```bash
# assets_2025.xlsx → looks for assets.mapping.json
npm run collect:spreadsheet -- data/assets_2025.xlsx
```

The YAML intermediate file is written alongside the XLSX file with a `.yaml` extension (e.g., `assets_2025.yaml`).

## Mapping Configuration

The mapping file is a JSON file that describes how to read the spreadsheet:

```json
{
  "sheetName": "Sheet1",
  "startRow": 2,
  "columnMapping": {
    "A": "id",
    "B": "name",
    "C": "type",
    "D": "location",
    "E": "owner"
  },
  "transformers": {
    "name": "trim",
    "type": "lowercase"
  },
  "rootKey": "assets"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `sheetName` | No | Worksheet name (defaults to first sheet) |
| `startRow` | No | First data row, 1-indexed (default: 2, skips header) |
| `columnMapping` | Yes | Maps Excel columns (A, B, C...) to field names |
| `transformers` | No | Named transformers to apply per field |
| `rootKey` | No | Top-level key in YAML output (default: "assets") |

### Available Transformers

| Name | Effect |
|------|--------|
| `trim` | Strip leading/trailing whitespace |
| `uppercase` | Convert to uppercase |
| `lowercase` | Convert to lowercase |
| `number` | Parse as number |
| `int` | Parse as integer |
| `float` | Parse as float |
| `boolean` | Parse as boolean (`true/yes/1` → `true`) |
| `date` | Parse as Date object |

## Field Mapping to BaseAsset

The connector recognises these field names and maps them to the BaseAsset schema:

| Mapped Field | BaseAsset Property |
|--------------|-------------------|
| `id` | `id` (auto-generated from `name` if missing) |
| `name` | `name` |
| `type` | `type` (defaults to `"asset"`) |
| `description` | `description` |
| `tags` | `tags` |
| `location` | `location.building` |
| `owner` | `ownership.owner` |

Any additional fields (e.g., `serialNumber`, `manufacturer`) are placed in `extendedData`.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SPREADSHEET_FILE` | Yes* | Path to .xlsx file |
| `SPREADSHEET_MAPPING` | No | Path to mapping JSON (auto-detected if omitted) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `MONGODB_DB` | No | Database name (default: `prism`) |

\* Can also be passed as CLI argument.

## Example

See `example.mapping.json` in this directory for a sample mapping configuration.
