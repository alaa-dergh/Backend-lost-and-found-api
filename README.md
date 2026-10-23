# Lost & Found API

REST API to report lost items, report found items, search/filter reports, view details, update your own reports, and mark an item as recovered.

**Stack:** Node.js, Express, SQLite (better-sqlite3), JWT auth (bcrypt password hashing).

## Run locally

```bash
npm install
JWT_SECRET=change-me npm start     # http://localhost:3000
npm test                           # end-to-end smoke test (39 checks)
```

Environment variables: `PORT` (default 3000), `JWT_SECRET` (**set this in production**), `DB_PATH` (default `./data.sqlite`).

## Endpoints

Authenticated routes need the header `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | no | Create account (`name`, `email`, `password`, optional `phone`) |
| POST | `/auth/login` | no | Get a token (`email`, `password`) |
| GET | `/auth/me` | yes | Current user |
| POST | `/items/lost` | yes | Report a lost item |
| POST | `/items/found` | yes | Report a found item |
| GET | `/items` | no | Search and filter reports |
| GET | `/items/:id` | no | Item details |
| PUT/PATCH | `/items/:id` | owner | Update your own report |
| PATCH | `/items/:id/recovered` | owner | Mark as recovered |
| DELETE | `/items/:id` | owner | Delete your own report |

### Item fields
`title` (required), `description`, `category`, `location`, `date_occurred` (e.g. `2026-10-20`), `image_url`, `contact_info`.
Server-managed: `id`, `type` (`lost`/`found`), `status` (`open`/`recovered`), `recovered_at`, `reporter`, `created_at`, `updated_at`.

### Search & filter: `GET /items`
| Param | Description |
|---|---|
| `q` | Text search in title, description, location, category |
| `type` | `lost` or `found` |
| `category` | Exact category (case-insensitive) |
| `status` | `open` or `recovered` |
| `location` | Partial match |
| `date_from`, `date_to` | Range on `date_occurred` |
| `mine=true` | Only your reports (needs token) |
| `sort` | `newest` (default), `oldest`, `date` |
| `page`, `limit` | Pagination (limit max 100) |

### Error codes
400 validation, 401 missing/invalid token, 403 not the owner, 404 not found, 409 conflict (duplicate email, already recovered).

## Example

```bash
BASE=http://localhost:3000

TOKEN=$(curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -X POST $BASE/items/lost -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Black wallet","category":"wallet","location":"Algiers","date_occurred":"2026-10-20"}'

curl "$BASE/items?type=lost&q=wallet"
curl -X PATCH $BASE/items/1/recovered -H "Authorization: Bearer $TOKEN"
```

## Deploy (free options)

**Render / Railway / Fly.io:** push this folder to GitHub, create a Web Service, build command `npm install`, start command `npm start`, set `JWT_SECRET`.
SQLite is a file: attach a persistent disk/volume and set `DB_PATH` to a path on it (e.g. `/data/data.sqlite`), otherwise data resets on redeploy.
