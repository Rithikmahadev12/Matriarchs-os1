# ⬡ MATRIARCHS OS
### Sovereign Edition — v1.0.0

A browser-based desktop operating system with a built-in custom proxy engine, multi-user authentication, and a full app suite. No third-party proxy libraries. Everything is built in-house.

---

## What is this?

Matriarchs OS is a web desktop environment that runs entirely in the browser. It has its own proxy engine that rewrites and relays web traffic server-side, letting you browse the open web from within the OS window. It comes with a full desktop UI, windowed apps, a taskbar, start menu, and an owner-level admin panel.

---

## Proxy Engine

The proxy is custom-built using **Fastify** and runs entirely server-side. It handles:

- Full HTML rewriting — rewrites `src`, `href`, `srcset`, `action`, and `style` attributes to route through the proxy
- CSS rewriting — rewrites `url()` references in stylesheets and inline styles
- JS interception — injects hooks for `fetch`, `XMLHttpRequest`, `history.pushState`, and click/form/keydown events so all navigation stays inside the proxy
- CSP stripping — removes Content-Security-Policy meta tags from proxied pages
- Two routes:
  - `/proxy/` — full page proxy with HTML rewrite + script injection
  - `/proxy/fetch` — asset proxy for images, scripts, stylesheets, fonts

---

## Setup

Requires **Node.js 16+**.

```bash
git clone <your-repo-url>
cd <your-repo>
npm install
npm start
```

The server runs on port `8080` by default. Set the `PORT` environment variable to override.

---

## Desktop Apps

| App | Description |
|---|---|
| Browser | Proxy browser with search engine picker, back/forward, and nav history |
| Files | Personal file system with a built-in text editor |
| Terminal | Shell-style terminal with basic commands (`help`, `ls`, `whoami`, `date`, `echo`, `clear`) |
| Calculator | Full calculator with keyboard support |
| YouTube | Browse and watch YouTube |
| TikTok | Search and browse TikTok |
| Search | Native web search with clickable result cards |
| Admin Panel | Owner-only panel to ban, kick, and delete users |

---

## Auth System

- One hardcoded **owner** account with full admin access
- Users can register and log in — accounts stored in `localStorage`
- Guest login available (no account needed)
- Owner can ban, kick, or delete any registered user from the Admin Panel
- Banned and kicked users are blocked on next login

---

## Stack

- **Runtime:** Node.js
- **Server:** Fastify + @fastify/static
- **Proxy:** Custom-built HTML/CSS/JS rewriter
- **Frontend:** Vanilla JS — no frameworks
