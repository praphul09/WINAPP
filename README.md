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
