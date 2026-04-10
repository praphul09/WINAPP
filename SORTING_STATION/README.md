# SORTING STATION

Separate Electron subproject for dual-station book sorting.

## What it does
- 2 independent stations in one app.
- Each station can select:
  - Active batch from `processing` stage batches.
  - Active bucket (1-12) and basket (1-12).
- Reads QR scan value and Arduino slot (1-12), then validates against `school_student_books`:
  - QR batch id must match selected batch.
  - `colour_1` -> selected bucket.
  - `colour_2` -> selected basket.
  - `assigned_number` -> expected slot (1-12) must match Arduino slot.
- On correct placement it sets `sorting_status = 1`.
- Shows final 12-slot grid with `sorted/total`.
  - Green when slot is fully sorted.
  - Yellow when not fully sorted.
- Scanner sync by scan:
  - Click `Sync Scanner (next scan)` on a station.
  - Next scan value becomes that station's scanner ID.
- Arduino sync by message:
  - Click `Sync Arduino ID (next msg)`.
  - Next incoming Arduino line becomes station Arduino ID.

## Expected data sources
- Batch registry: `\\pixartnas\home\INTERNAL_PROCESSING\BATCHES\batch-registry.db`
- Batch DB path comes from registry (`db_path` column).
- Color palettes are read from `../colour codes.txt` when available.

## QR format support
- Native 43-digit project QR (`buildBookQrCode` format):
  - Batch id: digits 24-26 (1-based)
  - Book id: digits 27-31 (1-based)
- Fallback labeled format also supported (example):
  - `BATCH:12 BOOK:4567`

## Arduino slot message formats supported
- `5`
- `slot:5`
- `S=5`
- `{"slot":5}`

## Run
```powershell
cd F:\workspace\WINAPP\SORTING_STATION
npm install
npm start
```

## Notes
- Keyboard scanner mode: scan into station input and press Enter.
- Serial scanner mode: connect scanner COM to that station.
- Two stations can run in parallel with independent batch/selection/device mappings.
