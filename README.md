# WINAPP Electron Dashboard

This is a minimal Electron app for a Windows order dashboard.

## Prerequisites
- Node.js 18+ (LTS recommended)
- npm (comes with Node.js)

## Install
From `f:/workspace/WINAPP`:

```bash
npm install
```

## Book Generator Vendor Setup
`book_generator/vendor` is git-ignored. On a new system, download/install the Python packages into that folder with:

```bash
npm run setup:book-generator-vendor
```

Prerequisite: Python must be available as `python` or `py -3`.

## Run

```bash
npm start
```

On Windows, you can also double-click `WINAPP.bat` after `npm install`.

## Portable Build For Other Users

For other users, the better solution is a packaged Windows app instead of Docker.
This project is an Electron desktop app that:

- opens native Windows windows
- uses Windows network paths like `\\pixartnas\...`
- spawns Python scripts locally

Because of that, Docker is not a good fit for normal end-user running.

Build a portable `.exe` with:

```bash
npm install
npm run dist
```

Output will be created in `release/`.
You can share the generated portable `WINAPP` executable with other Windows users so they do not need to run `npm start`.

## Docker Note

Docker is possible only as a limited build/helper environment here, not as a practical way to run the full desktop app for end users.
If you want, the next step can be:

- package the Python book generator as an `.exe` too, so end users do not need Python installed
- add an installer build in addition to the portable `.exe`

## Additional Subprojects

### `SORTING_STATION`
Separate Electron app for processing-stage sorting operations.

### `PROCESSING_MONITOR_NATIVE`
React Native subproject for viewing `processing` batches directly from the batch registry, including detailed batch info and stage status.

Run from `f:/workspace/WINAPP/PROCESSING_MONITOR_NATIVE`:

```bash
npm install
npm run api
npm start
```

## API Configuration
The dashboard expects a backend API. Update endpoints in `f:/workspace/WINAPP/renderer.js`:

- `API_ENDPOINTS.orders` (GET) returns an array of orders
- Action endpoints use POST and should return JSON with optional `message` and `table`

Order shape:
```json
{
  "order_number": "12345",
  "school_name": "Green Valley High",
  "order_date": "2024-09-10",
  "order_status": "new"
}
```

Valid statuses:
`new`, `pending approval`, `processing`, `invoice`, `dispatch`, `delivered`

The UI also supports `freeze` and `approval_pending` internally for action flows.
