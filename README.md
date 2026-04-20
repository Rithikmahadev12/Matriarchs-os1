# ⬡ MATRIARCHS OS
### Sovereign Edition — Powered by Scramjet

A fully featured web operating system with a built-in proxy engine, desktop environment, multi-user auth, and app suite. Built on top of [Scramjet](https://github.com/MercuryWorkshop/scramjet) — the most advanced interception-based web proxy available.

---

## What is this?

Matriarchs OS is a browser-based desktop environment that routes web traffic through a sovereign proxy layer. It bypasses arbitrary network restrictions and internet censorship while delivering a full desktop experience — complete with a browser, file manager, terminal, calculator, YouTube, TikTok, and an admin panel.

---

## Proxy Engine

This project uses **[Scramjet](https://github.com/MercuryWorkshop/scramjet)** under the hood — an experimental interception-based proxy with CAPTCHA support and broad site compatibility.

**Supported sites include:**
- Google, YouTube, Reddit
- Twitter / X, Instagram, Discord
- Spotify, GeForce NOW
- And most of the open web

> **Note:** For CAPTCHA-dependent sites and YouTube to work reliably, avoid hosting on datacenter IPs. Heavy traffic on a single IP may degrade some sites — consider rotating IPs or routing through Wireguard via [wireproxy](https://github.com/whyvl/wireproxy).

---

## Setup

Requires **Node.js 16+** and **Git**.

### Quick start (Debian / Ubuntu)

```bash
sudo apt update && sudo apt upgrade
sudo apt install curl git nginx

# Install nvm + Node 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20 && nvm use 20

# Clone and install
git clone https://github.com/MercuryWorkshop/Scramjet-App
cd Scramjet-App
pnpm install
pnpm start
```

The server will start on port `8080` by default. Set the `PORT` environment variable to change it.

---

## Transport Layer

The proxy uses [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) to fetch proxied data over an encrypted channel. You can swap this for [epoxy-transport](https://github.com/MercuryWorkshop/epoxy-transport) depending on your needs.

The Wisp server uses [@mercuryworkshop/wisp-js](https://www.npmjs.com/package/@mercuryworkshop/wisp-js). For production deployments, [wisp-server-python](https://github.com/MercuryWorkshop/wisp-server-python) is recommended for better performance and stability.

See [bare-mux](https://github.com/MercuryWorkshop/bare-mux) docs for full transport configuration options.

---

## Self-Hosting Resources

- [nvm — Node version manager](https://github.com/nvm-sh/nvm)
- [Nginx setup guide](https://docs.titaniumnetwork.org/guides/nginx/)
- [VPS hosting guide](https://docs.titaniumnetwork.org/guides/vps-hosting/)
- [DNS setup guide](https://docs.titaniumnetwork.org/guides/dns-setup/)

---

## Desktop Apps

| App | Description |
|---|---|
| Browser | Full proxy browser with search engine picker and nav history |
| Files | Personal file system with text editor |
| Terminal | Command-line interface with basic shell commands |
| Calculator | Keyboard-supported calculator |
| YouTube | Browse and watch YouTube via proxy |
| TikTok | Search and browse TikTok content |
| Search | Native search with result cards |
| Admin Panel | Owner-only user management (ban, kick, delete) |

---

## Auth System

- Owner account with hardcoded credentials (set in `public/index.js`)
- User registration and login stored in `localStorage`
- Guest access available
- Owner can ban, kick, or delete any registered user

---

## Built by Mercury Workshop

> Scramjet updates and future development: [browser.js](https://github.com/HeyPuter/browser.js)
