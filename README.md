# Brandon Clone 🔥

> **AI-Powered WhatsApp Chat Roast & Group Dynamics Analyzer**  
> Unfiltered, hilarious, and brutally honest chat insights with Aura scoring, group dynamics, running jokes, and deep member breakdowns.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1_Database-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Preact](https://img.shields.io/badge/Preact-TSX-673AB8?logo=preact&logoColor=white)](https://preactjs.com/)
[![Vite](https://img.shields.io/badge/Vite-Bundler-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)

---

## ⚡ Features

- 🎭 **Brandon Persona**: A witty, uncensored, and hilarious AI critic that reads between the lines of your WhatsApp group chat and dishes out savage roasts, verdicts, running jokes, and group gossip.
- 🔮 **Aura Leaderboard & Podium**: Tracks who carries the conversation and who is in severe aura debt. Features an interactive podium (1st, 2nd, 3rd) and a highlighted "Aura Bankrupt" debt card.
- 👥 **Individual Member Analysis**: Profiles each member with personalized nicknames, peak aura moments, biggest aura losses, quote highlights, and recurring tropes.
- 🔒 **Privacy First Architecture**: Parsing and heavy statistical calculations happen directly in your browser. Raw chat logs are chunked, analyzed, and cleaned.
- 📲 **One-Click Sharing**: Share full reports directly to WhatsApp or generate expiring public share links.
- 🌐 **Bilingual (Hebrew & English)**: Native support for RTL (Right-to-Left) Hebrew chat formats and English translations.

---

## 🛠️ Tech Stack

- **Runtime & Backend**: [Cloudflare Workers](https://workers.cloudflare.com/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite)
- **Frontend**: [Preact](https://preactjs.com/) + TypeScript + Vite
- **LLM Pipeline**: Dual-engine support via OpenRouter (e.g. `nvidia/nemotron-70b-instruct`) and Google Gemini (e.g. `gemini-2.5-flash`)
- **Testing**: Vitest (45+ test suites, 400+ unit tests)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- Cloudflare Wrangler CLI (`npm i -g wrangler`)
- OpenRouter or Google Gemini API key

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/amitamit10/brandon-clone.git
   cd brandon-clone
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure local environment variables:
   Create a `.dev.vars` file in the root directory:
   ```env
   OPENROUTER_API_KEY=your_openrouter_api_key
   GEMINI_API_KEY=your_gemini_api_key
   ADMIN_TOKEN=your_random_admin_token
   VISITOR_SECRET=your_random_visitor_secret
   ```

4. Run tests:
   ```bash
   npm test
   ```

5. Start the Vite development server:
   ```bash
   npm run dev
   ```

---

## 🚢 Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md) for full deployment instructions to Cloudflare Workers and D1.

```bash
# Build frontend assets
npm run build

# Deploy to Cloudflare Workers
npx wrangler deploy
```

---

## 📄 License

MIT
