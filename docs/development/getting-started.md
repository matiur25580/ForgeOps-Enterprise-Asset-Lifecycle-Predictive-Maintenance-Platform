# Local development setup

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker Desktop or Docker Engine with the Compose plugin

## 1. Install dependencies

From the repository root:

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## 2. Start MongoDB

```bash
docker compose up -d mongodb
```

The local database is exposed at `mongodb://localhost:27017/forgeops`.

## 3. Start the API

In a terminal at the repository root:

```bash
npm run dev:api
```

The API listens on `http://localhost:4000`.

- `GET /health/live` checks whether the process is running.
- `GET /health/ready` checks whether MongoDB is connected.
- `GET /api/v1` returns API service metadata.

## 4. Start the Angular application

In a second terminal at the repository root:

```bash
npm run dev:web
```

Open `http://localhost:4200`.

## 5. Validate the workspaces

```bash
npm run typecheck
npm run build
```

## Notes

- The overview dashboard still contains clearly labelled illustrative preview data. The Asset Registry and Facilities screens use authenticated live API endpoints.
- The web API base URL is configured in `apps/web/src/environments/environment.ts` (default: `http://localhost:4000/api/v1`). Update it for a deployed API.
- Open `http://localhost:4200/login` to sign in with an existing organization slug, email, and password, or create a workspace. The refresh session is stored in an HTTP-only cookie; the short-lived access token remains in application memory.
- For local browser access, keep the API CORS origin set to `http://localhost:4200` and use HTTPS in production.
- Do not commit `.env`, credentials, production data, or real access tokens.
- The access-token secret in `.env.example` is a placeholder, not a production-ready secret.
- MongoDB is the only container started by the current Compose file. The API and web app run through the local Node toolchain.
