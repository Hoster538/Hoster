# THE DEV HOSTER PRO

A white-label, full-stack hosting dashboard. Your users sign in with GitHub — and that's the entire onboarding. They see their repositories, click **Deploy**, get a live URL, and uptime monitoring attaches itself automatically. No API keys, no third-party accounts, no infrastructure branding anywhere in the UI.

---

## Important: how the "no API key" magic actually works

The original brief asked for the backend to *automatically create a Render account* with the user's GitHub credentials. That is **not technically or legally possible**, and this project deliberately does not attempt it:

- **Render has no account-creation API.** Accounts are created by humans at render.com.
- **A GitHub OAuth token can't sign someone up elsewhere.** OAuth authorizes your app against GitHub's API only — it never hands you the user's password or the power to act on third-party sites as them.
- **Scripting account creation** (headless browsers, credential reuse) violates Render's and GitHub's Terms of Service and is a serious security malpractice.

**The legitimate architecture that delivers the identical user-visible outcome** is the classic white-label pattern used by real hosting resellers:

```
┌─────────────┐   GitHub OAuth    ┌──────────────────────┐
│  End user   │ ────────────────► │  THE DEV HOSTER PRO  │
│ (browser)   │ ◄──── repos ───── │  (this app)          │
└─────────────┘   live URL+status └──────────┬───────────┘
                                             │
                       ┌─────────────────────┼──────────────────────┐
                       ▼                                          ▼
              ┌─────────────────┐                        ┌─────────────────┐
              │  Render API v1  │                        │ UptimeRobot API │
              │  OWNER's key    │                        │  OWNER's key    │
              │  (env var)      │                        │  (env var)      │
              └─────────────────┘                        └─────────────────┘
```

Your users never hear the words "Render" or "UptimeRobot". Both keys live only in server-side environment variables. From the user's perspective: *sign in with GitHub → click → live site → monitored.*

---

## Feature checklist

| Requirement | Status |
|---|---|
| Sign in exclusively via GitHub OAuth | Done — session-based, CSRF-state protected |
| No API key ever requested from users | Done — owner's keys run the backend |
| Render invisible in the UI | Done — provider is abstracted behind `lib/render.js`; UI labels are generic ("Building", "Live", "Monitored") |
| Dashboard lists GitHub repositories | Done — owner/collaborator/org repos, private repos flagged |
| One-click deployments | Done — with zero-config runtime detection |
| Auto-register live URL with UptimeRobot | Done — background pipeline registers the monitor the moment the deploy goes live |
| Extras included | Deploy caps per user, collaborator-verification before deploy, redeploy, full teardown (app + monitor), live Up/Down chips in the dashboard |

## Stack

- **Backend:** Node.js 18+, Express, better-sqlite3 (users, sessions, deployments)
- **Frontend:** zero-build vanilla JS + CSS, served by the same server
- **Integrations:** GitHub OAuth + REST, Render API v1, UptimeRobot API v2 — all via native `fetch`

## Quick start

### 0. Try it with no keys at all (demo mode)

```bash
npm install
DEMO_MODE=true npm start
# open http://localhost:3000 → "Explore the live demo"
```

Demo mode mocks repos, deploys, and monitors so you can evaluate the whole UX.

### 1. Create the GitHub OAuth app

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|---|---|
| Homepage URL | `https://your-domain.com` |
| Authorization callback URL | `https://your-domain.com/auth/github/callback` |

Copy the **Client ID** and generate a **Client Secret**.

### 2. Get the owner's Render API key

Render dashboard → **Account Settings → API Keys → Create API Key**.
Every user deployment is provisioned inside **your** Render workspace — users never see this. For private-repo support and one less config step, also install Render's GitHub app on your own accounts once (internal to you, never user-facing).

### 3. Get the owner's UptimeRobot API key

UptimeRobot → **My Settings → API Settings → Main API key**.

### 4. Configure and run

```bash
cp .env.example .env     # fill in the four keys + BASE_URL + SESSION_SECRET
npm install
npm start                # http://localhost:3000
```

Production notes: set `BASE_URL` to your public HTTPS origin, `COOKIE_SECURE=true` behind your TLS-terminating proxy, and pick a long random `SESSION_SECRET`.

## How a deploy flows

1. **User clicks Deploy** on `/api/deploy`.
2. Server verifies via GitHub that the user actually **owns or collaborates** on the repo (prevents anyone hosting arbitrary repos on your bill).
3. Runtime is **auto-detected** from the repo root (`package.json` → Node, `requirements.txt` → Python, `go.mod` → Go, `Dockerfile` → Docker, `index.html` → static site, …).
4. A service is created on the hidden provider with a unique name under your workspace; first build starts automatically.
5. A **background poller** tracks the build. The moment it is `live`, the service URL is registered as an **UptimeRobot HTTP monitor** (5-minute checks).
6. The dashboard shows: `Building → Live`, the URL, and a `Monitored · Up/Down` chip. **Delete** removes the service *and* the monitor and frees the plan slot.

## API surface (all cookie-auth'd, JSON)

| Route | Purpose |
|---|---|
| `GET /auth/github` · `GET /auth/github/callback` · `POST /auth/logout` | OAuth session lifecycle |
| `GET /api/me` · `GET /api/config` | Session user / public config |
| `GET /api/repos` | The user's repositories (via their token, server-side only) |
| `POST /api/deploy` `{owner, repo}` | One-click deploy (validated, capped, collaborator-checked) |
| `GET /api/deployments` | Apps + live statuses + monitor states |
| `POST /api/deployments/:id/redeploy` · `DELETE /api/deployments/:id` | Lifecycle |

## Security model

- User GitHub tokens live only in the SQLite DB on the server; never sent to the browser, never used to modify the user's GitHub account.
- Owner keys (`RENDER_API_KEY`, `UPTIMEROBOT_API_KEY`) are read from env at call time; routes never return provider payloads unfiltered.
- OAuth uses a short-lived `state` cookie; sessions are `HttpOnly`, `SameSite=Lax`, (optionally) `Secure` random tokens stored server-side.
- Deployment authorization is DB-scoped (`user_id` on every query) plus the GitHub collaborator check at creation.
- Per-user deploy cap (`MAX_DEPLOYMENTS_PER_USER`) protects your provider bill.

## Costs & compliance (read before charging users)

- **You** are Render's and UptimeRobot's customer — every user app bills to *your* workspace. Free tiers are limited; set `RENDER_PLAN`, keep `MAX_DEPLOYMENTS_PER_USER` low, and upgrade deliberately.
- Reselling hosting under your own accounts is a normal agency/reseller pattern — but you are the operator of record: acceptable-use enforcement, takedowns, and abuse response are your responsibility.
- The live URL host is `*.onrender.com` — invisible in your UI, but visible in the address bar. For full white-labeling of the URL itself, point a wildcard subdomain of your own domain at Render and attach a custom domain per service via their `customDomains` API (noted in the roadmap below).

## Roadmap hooks (code is structured for these)

- **Custom domains per app** — provider adapter already isolates Render; add a `customDomains` call + your wildcard DNS.
- **Private repos** — supported the moment you install Render's GitHub app on your workspace, or by adding a build-push path to a container registry.
- **Deploy logs / build streaming** — poll Render's `deploys` endpoint and stream to the UI.
- **Paid plans** — raise `MAX_DEPLOYMENTS_PER_USER` per user after a Stripe webhook.

## Project layout

```
dev-hoster-pro/
├── server.js          # Express app: OAuth, API, deploy→monitor pipeline
├── lib/
│   ├── db.js          # SQLite: users, sessions, deployments
│   ├── github.js      # OAuth + repo APIs + collaborator check
│   ├── render.js      # deployment provider adapter (hidden, swappable)
│   ├── uptime.js      # monitoring adapter (hidden)
│   └── detect.js      # zero-config runtime detection
├── public/            # dashboard UI (no build step)
├── data/              # SQLite database (auto-created)
└── .env.example       # all configuration, documented
```
