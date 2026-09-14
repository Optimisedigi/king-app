# OptiMate Image Editor

<p align="center">
  <img src="https://raw.githubusercontent.com/Optimisedigi/king-app/main/build/icon.png" alt="OptiMate Image Editor" width="200">
</p>

<p align="center">
  <strong>The desktop app that runs your e-commerce creative.</strong>
</p>

<p align="center">
  <a href="https://github.com/Optimisedigi/king-app/releases/latest"><img src="https://img.shields.io/github/v/release/Optimisedigi/king-app?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="AGPL-3.0-or-later License"></a>
  <a href="https://youtube.com/@kenkaidoesai"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://skool.com/kenkai"><img src="https://img.shields.io/badge/Skool-Community-7C3AED?style=for-the-badge" alt="Skool"></a>
</p>

**OptiMate Image Editor** is where e-commerce sellers generate product shots, run their stores, and manage their ads — all in one desktop app.

160+ proven prompts. Reusable products and characters. Shopify, Amazon, Shopee connections. Facebook Ads, Google Ads, TikTok Shop dashboards. One app. Your whole creative stack.

---

## Why this exists

E-commerce runs on volume. Ten new creatives a week. Three new hero shots per launch. A/B variants for every ad set. Different aspect ratios for every platform. And you're supposed to do all of it while also managing inventory, answering DMs, and actually running the business.

Most AI tools treat product generation like a toy — upload once, generate once, pay per shot. Every other tool in your stack lives in a different browser tab. Your prompts live in a Notes doc. Your product photos live in iCloud. Your ad creatives live in Canva. Your stores live in six different admin panels.

OptiMate Image Editor pulls it all together. Your products, your characters, your prompts, your stores, your ads — one native app that holds everything and gets faster the longer you use it.

---

## What it actually does

### 160+ production-ready prompts

Every prompt in OptiMate Image Editor has been tested. Packshot, lifestyle, beauty, health, food & drink, fashion, home, pet, social & ads, cinematic, nature — eleven categories covering every e-commerce product type you'll ever sell.

Preview image for every prompt. Click, insert, generate. Stop rewriting "cinematic product shot on marble, soft shadows, 4:5 aspect ratio" for the fortieth time.

OptiMate Image Editor tracks what you use. The prompts you actually click rise to the top — your personal library builds itself.

### Generate product shots with reference images

Upload your actual product. OptiMate Image Editor uses it as visual reference and generates new shots — different angles, scenes, lighting, backdrops. Marble flat lay. Held in hand. Pastel gradient. Lifestyle context. Editorial hero. Amazon packshot. Any aspect ratio — 1:1, 4:5, 9:16, 16:9, 3:4, 5:4, 3:2 — all the marketplace and ad formats.

Runs directly on OpenAI's GPT Image models for generation and multi-image editing — `gpt-image-2`, plus GPT Image 2.5 Flare (faster) and Sunburst (higher quality), selectable in Settings.

### Products library

Save every SKU once. Reference images, product type (13 types covering beauty, skincare, health, supplements, fashion, apparel, footwear, food, beverage, home, pet, tech, other), thumbnail. Pick any product from the grid and generate instantly — no re-uploading, no re-describing.

Build out your full catalog, keep it in the app, never touch a file picker again.

### Characters

Same idea, for people. Models, brand mascots, customer archetypes, UGC faces, recurring talent. Upload once, use forever. Consistent look across every shot.

Stack them with a product prompt and generate "this model holding this product in this scene" — consistently, at scale.

### Stores and ad platforms, one app

API key vault for every platform that matters:

- **OpenAI** — GPT Image generation and editing
- **Shopify** — product and order sync
- **Amazon** — listing data
- **Shopee** — product data from Shopee stores
- **Facebook Ads** — campaign management
- **Google Ads** — campaign management
- **Telegram** — messaging / notifications

Dashboards in-app for Facebook Ads, Google Ads, TikTok Shop, Shopee — your campaigns, creatives, and store metrics without flipping between six browser tabs.

### Everything stays local

Your products, your reference images, your generated shots, your prompts — all stored on your machine. Not a cloud service. Not your competitors' next training run. API keys stored in the OS keychain. You own your library.

### Native Mac + Windows

Proper desktop app. Not a browser tab. Not an Electron wrapper around a web login. Offline access to everything you've ever made. Virtualized grid that scrolls through thousands of images without stuttering.

### Auto-updates

New models, new prompt packs, new integrations — pushed through GitHub releases. Settings → check for updates → download → restart. Done.

---

## Getting started

### Download

| Platform                          | Link                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| Mac — Apple Silicon (M1/M2/M3/M4) | [Download](https://github.com/Optimisedigi/king-app/releases/latest) |
| Mac — Intel                       | [Download](https://github.com/Optimisedigi/king-app/releases/latest) |
| Windows                           | [Download](https://github.com/Optimisedigi/king-app/releases/latest) |

### Setup

1. Install it
2. Open the APIs page → paste your [OpenAI API key](https://platform.openai.com/api-keys)
3. Add a product — upload 2-3 reference images
4. Pick a prompt from the library, generate

Add your other integrations (Shopify, Facebook Ads, etc.) from the same APIs page whenever you're ready.

---

## Privacy

- Everything stored locally on your machine
- Image prompts and reference images are sent directly to OpenAI for generation
- API keys stored in the OS keychain, not a cloud server
- No analytics, no telemetry, no tracking

---

## For developers

```bash
git clone https://github.com/Optimisedigi/king-app.git
cd king-app
npm install
npm run dev
```

Stack: Electron + React 19 + Tailwind v4 + OpenAI Images API

---

## Community

- [YouTube @kenkaidoesai](https://youtube.com/@kenkaidoesai) — tutorials and demos
- [Skool community](https://skool.com/kenkai) — come hang out

---

## License

**[GNU Affero General Public License v3.0 or later](LICENSE)** (AGPL-3.0-or-later).

In plain English: you can use it, modify it, fork it, and run it. If you
distribute a modified version — including running it as a hosted service
you let other people use — you must publish your changes under AGPL too.
No closed-source forks, no "take the code, slap a logo on it, sell it as
your own" without giving back. See `LICENSE` and `NOTICE` for the full
legal text.

---

<p align="center">
  <strong>Your products. Your prompts. Your stores. Your ads. One app.</strong>
</p>

<p align="center">
  <a href="https://github.com/KenKaiii/king/releases/latest"><img src="https://img.shields.io/badge/Download-Latest%20Release-blue?style=for-the-badge" alt="Download"></a>
</p>
