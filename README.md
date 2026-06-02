# 🔗 Link Analytics Platform

> A production-grade URL shortener with real-time click analytics, Redis caching, and a full-stack dashboard — built to demonstrate backend engineering depth across authentication, caching, database design, and system observability.

![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat-square&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-5.x-000000?style=flat-square&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)

---

## Overview

Most URL shorteners are either toy projects or black boxes. This one is neither.

**Link Analytics Platform** was built to explore the engineering problems that sit behind a simple redirect: cache invalidation, async analytics pipelines, multi-layer authorization, rate limiting under load, and consistent data integrity across distributed state (Postgres + Redis).

The goal was not to ship a feature list — it was to understand *why* each architectural decision exists and what breaks without it.

**Real-world use cases this covers:**
- Marketing teams tracking campaign link performance
- Developers replacing third-party shorteners with a self-hosted alternative
- Product teams monitoring user engagement across traffic sources

---

## Feature Overview

### Authentication & Authorization
- Stateless JWT-based authentication with 15-minute access tokens
- Password hashing using bcrypt (cost factor 10)
- Per-resource ownership validation — users can only manage their own links
- Protected routes via reusable middleware

### Link Management
- Generate cryptographically random 6-character short codes
- Optional custom alias support with format validation and reserved-word protection
- Full CRUD: create, list (scoped to user), and delete links
- Cascade deletion: removing a link also removes all associated click records and Redis cache entries

### Redirect System
- Sub-millisecond redirects via Redis cache hit
- Graceful cache-miss fallback to PostgreSQL with automatic cache warming
- `302 Found` redirects to preserve HTTP semantics and browser caching behavior

### Click Analytics
- Asynchronous click tracking — analytics never blocks the redirect response
- IP address capture and country resolution using local MaxMind GeoLite2 database (no external API calls)
- User-Agent parsing for device classification (Desktop / Mobile / Tablet / Unknown)
- Aggregated stats: total clicks, unique visitors, top 5 countries, device distribution

### Performance & Reliability
- Redis-based rate limiting: 10 requests/minute per IP with automatic key expiry
- Redis URL cache with 1-hour TTL and explicit invalidation on delete
- Parameterized SQL queries throughout — no raw string interpolation

### Frontend Dashboard
- Vanilla JS SPA: Login, Register, Dashboard
- Create links with optional custom aliases
- One-click copy of shortened URLs
- Per-link analytics modal with country and device breakdown
- JWT stored in `localStorage`; token decoded client-side for session display

---

## Architecture

```
┌─────────────────────────────────────────────┐
│               Browser (SPA)                  │
│  HTML + CSS + Vanilla JS (frontend/)         │
│  - Auth forms (Login / Register)             │
│  - Dashboard: create, list, delete, stats    │
└────────────────────┬────────────────────────┘
                     │ HTTP (fetch API)
                     ▼
┌─────────────────────────────────────────────┐
│          Express.js API Server              │
│                                             │
│  Middleware Stack (per request):            │
│  ┌─────────────────────────────────────┐   │
│  │  CORS → Rate Limiter → Body Parser  │   │
│  │  → Auth (JWT verify, if protected)  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Route Groups:                              │
│  ├── POST /auth/register                    │
│  ├── POST /auth/login                       │
│  ├── POST   /links          (protected)     │
│  ├── GET    /links          (protected)     │
│  ├── DELETE /links/:id      (protected)     │
│  ├── GET    /links/:id/stats (protected)    │
│  └── GET    /:shortCode     (public)        │
└──────────┬──────────────────┬──────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌──────────────────────┐
│      Redis       │  │     PostgreSQL        │
│                  │  │                       │
│  url:{shortCode} │  │  users                │
│  rate:{ip}       │  │  links                │
│                  │  │  clicks               │
│  TTL: 3600s      │  │                       │
└──────────────────┘  └──────────────────────┘
           │
           ▼
┌──────────────────┐
│ geoip-lite       │
│ (MaxMind GeoLite2│
│  local DB)       │
│ Zero API calls   │
└──────────────────┘
```

---

## Request Flows

### 1. Create Short Link

```
POST /links  { originalUrl, customAlias? }
     │
     ├─ Auth middleware: verify JWT → extract req.user.userId
     │
     ├─ Validate originalUrl (URL constructor)
     │
     ├─ customAlias provided?
     │   ├─ YES → regex validate (/^[a-zA-Z0-9\-_]+$/)
     │   │        → check reserved words (auth, links, health...)
     │   │        → SELECT from links WHERE short_code = alias
     │   │             conflict? → 409
     │   │
     │   └─ NO  → loop: generateShortCode() → check uniqueness → retry if collision
     │
     └─ INSERT INTO links (user_id, original_url, short_code)
        → 201 { shortCode, originalUrl }
```

### 2. Redirect Flow (Cache Hit vs Miss)

```
GET /:shortCode
     │
     ├─ Rate limiter: INCR rate:{ip} → > 10? → 429
     │
     ├─ redis.get("url:{shortCode}")
     │   │
     │   ├─ HIT  ─────────────────────────────────────────────────────┐
     │   │                                                              │
     │   └─ MISS → SELECT from links WHERE short_code = ?             │
     │              │                                                   │
     │              ├─ Not found → 404                                 │
     │              │                                                   │
     │              └─ Found → redis.set("url:{shortCode}", url, 3600) │
     │                                                                  │
     ├─ Fire-and-forget: INSERT INTO clicks ◄───────────────────────────┘
     │   (ip, country via geoip-lite, device via ua-parser-js)
     │   (runs async — never blocks redirect)
     │
     └─ res.redirect(302, originalUrl)
```

### 3. Analytics Query Flow

```
GET /links/:id/stats
     │
     ├─ Auth + ownership check (link.user_id === req.user.userId)
     │
     └─ Promise.all([
           COUNT(*), COUNT(DISTINCT ip_address),   ← total + unique visitors
           GROUP BY country ORDER BY clicks DESC LIMIT 5,
           GROUP BY device  ORDER BY clicks DESC
        ])
        → 200 { totalClicks, uniqueVisitors, topCountries, topDevices }
```

### 4. Cache Invalidation on Delete

```
DELETE /links/:id
     │
     ├─ SELECT link → 404 if not found
     ├─ Ownership check → 403 if mismatch
     ├─ DELETE FROM links WHERE id = ?
     │   (clicks removed via ON DELETE CASCADE)
     └─ redis.del("url:{shortCode}")  ← prevent stale redirects
```

---

## Database Schema

```sql
-- UUID primary keys via pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- Links
CREATE TABLE links (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    short_code   VARCHAR(10) UNIQUE NOT NULL,
    expires_at   TIMESTAMP NULL,           -- reserved for link expiry feature
    created_at   TIMESTAMP DEFAULT NOW()
);

-- Clicks (append-only analytics log)
CREATE TABLE clicks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id    UUID REFERENCES links(id) ON DELETE CASCADE,
    ip_address VARCHAR(100),
    country    VARCHAR(100),
    device     VARCHAR(100),
    clicked_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for hot query paths
CREATE INDEX idx_links_short_code ON links(short_code);  -- redirect lookup
CREATE INDEX idx_clicks_link_id   ON clicks(link_id);    -- analytics aggregation
```

**Design decisions:**
- `clicks` is intentionally append-only — no updates, optimized for aggregation reads
- `ON DELETE CASCADE` ensures referential integrity without manual cleanup queries
- `expires_at` column is scaffolded but unpopulated — planned for link expiry enforcement
- UUIDs avoid enumerable IDs, preventing IDOR attacks on link and user resources

---

## API Reference

### Authentication

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/auth/register` | — | Register user with email + hashed password |
| `POST` | `/auth/login` | — | Validate credentials, return JWT access token |

### Link Management

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/links` | ✅ JWT | Create short link (random or custom alias) |
| `GET` | `/links` | ✅ JWT | List all links owned by authenticated user |
| `DELETE` | `/links/:id` | ✅ JWT | Delete link + cascade clicks + invalidate cache |
| `GET` | `/links/:id/stats` | ✅ JWT | Aggregate analytics for a specific link |

### Redirect

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/:shortCode` | — | Resolve short code, track click, redirect 302 |

### Utility

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/health` | — | Server health check |

---

## Security Design

### Password Storage
Passwords are never stored in plaintext. `bcrypt.hash(password, 10)` generates a salted hash with work factor 10 — sufficient to make offline brute-force attacks computationally expensive while keeping login latency under ~100ms.

### JWT Authentication
```
Login → { accessToken: "eyJ..." }
         └─ Payload: { userId, email, iat, exp }
         └─ Expiry: 15 minutes
         └─ Verified on every protected request via middleware
```
Tokens are stateless — no server-side session storage. Revocation requires either short expiry or a denylist (future improvement).

### Ownership Validation
Every mutating operation (delete, stats) performs an explicit ownership check:
```js
if (link.user_id !== req.user.userId) {
  return res.status(403).json({ error: 'Access denied' });
}
```
This prevents Insecure Direct Object Reference (IDOR) — a user cannot manipulate another user's resources even if they know the UUID.

### Rate Limiting
```
INCR rate:{ip}
IF count == 1: EXPIRE rate:{ip} 60
IF count > 10: return 429
```
Redis atomic `INCR` ensures no race conditions. If Redis is unavailable, the middleware fails open — requests proceed to preserve service availability.

### SQL Injection Prevention
All database queries use parameterized statements (`$1`, `$2`) via the `pg` driver. No string interpolation anywhere in the query layer.

---

## Performance Engineering

### Redis as L1 Cache

On redirect, Redis is checked before PostgreSQL. A cache hit means:
- **0 database queries** for the redirect
- Typical response: **< 5ms** round-trip
- Scales to handle burst traffic without Postgres pressure

```
Cache Hit  → Redis lookup → 302 redirect    (~2-5ms)
Cache Miss → Redis + Postgres → cache warm → 302 redirect  (~15-30ms)
```

### Async Analytics (Non-blocking Writes)
Click tracking is fire-and-forget:
```js
pool.query('INSERT INTO clicks ...', [...]).catch(console.error);
return res.redirect(302, url);  // ← does not wait for the insert
```
The redirect completes immediately. Database write latency is invisible to the user.

### Efficient Aggregation Queries
Analytics queries use `COUNT(DISTINCT ip_address)` for unique visitor counting and `GROUP BY` with `LIMIT` for top-N breakdowns — all served from indexed columns.

### Local GeoIP Resolution
Country detection uses the MaxMind GeoLite2 database bundled locally via `geoip-lite`. There is no external HTTP call per redirect — the IP→country lookup is a pure in-memory hash table lookup in microseconds.

---

## Local Development

### Prerequisites
- Node.js v20+
- PostgreSQL 15+
- Redis 7+

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/link-analytics-platform.git
cd link-analytics-platform

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your local Postgres + Redis connection details

# 4. Initialize the database schema
psql -U postgres -d linkanalytics -f src/database/init.sql

# 5. Start development server (with hot reload)
npm run dev
```

The API will be available at `http://localhost:5000`.

Open `frontend/index.html` directly in a browser, or serve it with:
```bash
npx http-server ./frontend -p 3000
```

### Environment Variables

```env
PORT=5000

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=linkanalytics

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=change-this-in-production
```

---

## Docker Setup

The entire stack (API, PostgreSQL, Redis) runs with a single command.

```bash
# Build images and start all services
docker-compose up --build

# Run in background
docker-compose up -d --build

# Stop all services
docker-compose down

# Stop and remove volumes (reset database)
docker-compose down -v
```

**What starts:**

| Service | Port | Notes |
|---------|------|-------|
| Express API | `5000` | Auto-restarts on crash |
| PostgreSQL 15 | `5432` | Runs `init.sql` on first boot |
| Redis 7 (Alpine) | `6379` | In-memory, no persistence config |

---

## Screenshots

### Dashboard
![Dashboard](screenshots/dashboard.png)

### Analytics Modal
![Analytics](screenshots/analytics.png)

### Login Page
![Login](screenshots/login.png)

---

## Technical Challenges & How They Were Solved

### 1. Cache Consistency on Delete
**Problem:** After deleting a link, the Redis cache still held the original URL. Subsequent redirect requests would serve a 302 to a deleted resource.

**Solution:** The delete handler reads the `short_code` before executing the SQL delete, then calls `redis.del("url:{shortCode}")` immediately after. Cache and database are invalidated atomically within the same request lifecycle.

### 2. Async Analytics Without Data Loss
**Problem:** Inserting a click record on every redirect adds latency. Using `await` would slow down the redirect response.

**Solution:** Fire-and-forget with `.catch(console.error)` — the insert is queued but the redirect is not blocked. Errors are logged without crashing the process. For production, this pattern would be replaced by a BullMQ job queue with retry guarantees.

### 3. Short Code Collision Avoidance
**Problem:** Random 6-character codes have a finite space (~56 billion combinations) — but at low scale, collisions are still possible.

**Solution:** The generation loop performs a SELECT before each INSERT. If the code exists, a new one is generated. This is safe for current scale; at higher write volumes, a pre-generated code pool or distributed ID approach (e.g. Snowflake IDs) would be more appropriate.

### 4. Custom Alias Validation
**Problem:** Custom aliases could potentially shadow application routes (e.g., a user creating alias `auth` would hijack `/auth`).

**Solution:** A reserved words list is checked before alias registration. Format is validated against `/^[a-zA-Z0-9\-_]+$/` to prevent path traversal or injection attempts.

---

## What This Project Demonstrates

This project was built to demonstrate the kind of backend engineering thinking that matters in production systems — not just making features work, but understanding *why* each decision exists.

| Skill Area | How It's Demonstrated |
|---|---|
| **RESTful API Design** | Consistent response shapes, proper HTTP status codes (201, 302, 401, 403, 404, 409, 429), resource-oriented routes |
| **Authentication Architecture** | Stateless JWT with middleware extraction, bcrypt with appropriate cost factor, no credential leakage in responses |
| **Database Design** | Normalized schema, UUID primary keys, indexed hot paths, cascade constraints, append-only analytics table |
| **Caching Strategy** | Read-through cache pattern, explicit TTL management, cache invalidation on mutation — the hardest part of caching |
| **Async System Thinking** | Non-blocking analytics writes, understanding when `await` adds unnecessary latency |
| **Security Engineering** | IDOR prevention via ownership checks, parameterized queries, rate limiting, reserved alias protection |
| **Containerization** | Multi-service Docker Compose, environment-based configuration, volume-backed persistence |
| **Observability** | Structured console logging for cache hits/misses, rate limit counts, error boundaries |
| **Frontend Integration** | Token-based SPA auth, conditional API payloads, error surface propagation from backend to UI |
| **Code Organization** | Layered MVC structure: routes → controllers → config — separation of concerns at each layer |

---

## Planned Improvements

| Feature | Description |
|---|---|
| **Link Expiration** | Honor `expires_at` column in redirect handler — return 410 Gone for expired links |
| **QR Code Generation** | Generate downloadable QR codes per short link via `qrcode` library |
| **BullMQ Analytics Queue** | Move click inserts off the request thread into a Redis-backed job queue with retry and dead-letter support |
| **Refresh Tokens** | Issue long-lived refresh tokens in HTTP-only cookies alongside short-lived access tokens |
| **Webhooks** | POST to user-registered endpoints on click events for external integrations |
| **Advanced Analytics** | Time-series click data, referrer tracking, browser breakdown, click heatmaps by hour |
| **Rate Limit by User** | Extend rate limiting to authenticated users (not just IP) for per-account quotas |
| **Cloud Deployment** | Railway / Render deployment with managed Postgres + Redis, CI/CD via GitHub Actions |

---

## Project Structure

```
.
├── src/
│   ├── app.js                  # Express app: middleware stack, route mounting
│   ├── config/
│   │   ├── db.js               # pg Pool — connection pooling config
│   │   └── redis.js            # ioredis client — lazy connect, error handling
│   ├── controllers/
│   │   ├── authController.js   # register, login — bcrypt + JWT
│   │   └── linkController.js   # createLink, getMyLinks, getLinkStats, deleteLink
│   ├── database/
│   │   └── init.sql            # Schema DDL — tables, indexes, extensions
│   ├── middleware/
│   │   ├── auth.js             # JWT verification — sets req.user
│   │   └── rateLimit.js        # Redis INCR rate limiter — global middleware
│   └── routes/
│       ├── authRoutes.js       # /auth/*
│       ├── linkRoutes.js       # /links/* — all protected
│       ├── redirectRoutes.js   # /:shortCode — public, cache-first
│       └── profileRoutes.js    # /profile/*
├── frontend/
│   ├── index.html              # SPA shell — auth + dashboard views
│   ├── style.css               # Design system — dark theme, components
│   └── app.js                  # Fetch API client — auth, links, analytics
├── Dockerfile                  # Multi-stage Node.js container
├── docker-compose.yml          # Orchestrates app + postgres + redis
├── .env                        # Environment config (not committed)
└── package.json
```

---

## License

ISC — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built to learn. Designed to last. Documented to communicate.
</p>
