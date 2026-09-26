# 🎟️ BULL — Autonomous AI Claim Referee

> **🏆 1st Place Winner** — Internal AI Innovation Showcase  
> Real-time claim verification, slide deck compliance auditing, and multimodal fact-checking powered by Gemini 3.8 Flash.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Online-brightgreen?style=for-the-badge)](https://ais-pre-bvq3l5weyd3cz67zijtejm-103398919002.us-west1.run.app)
[![Tech Stack](https://img.shields.io/badge/Stack-React%20%7C%20TypeScript%20%7C%20Express%20%7C%20Tailwind-blue?style=for-the-badge)](https://github.com)

---

## ⚡ Overview

**BULL** is a full-stack multimodal application designed to eliminate unverified claims, misleading statistics, and compliance liabilities in business communications, pitch decks, and internal channels.

Styled with an authentic vintage ticket dispenser aesthetic (custom physical paper animations and vintage audio feedback), BULL acts as an objective referee: users can submit raw text, paste multi-bullet slides, upload PDFs/presentations, or inspect charts and screenshots.

### Key Capabilities:
- **Multimodal Document & Slide Parsing:** Direct support for PDFs (`pdf.js`), images (OCR claim extraction & AI-generation inspection), and presentation bullet batches.
- **Dual Persona Engine:**
  - **Classic Claim Referee:** Unbiased, sharp fact-checking calibrated for office watercoolers and live meetings.
  - **Enterprise Audit (Client QA):** Compliance-focused review mode designed to identify absolute ROI promises, unhedged metrics, and regulatory exposure—generating audit-safe rewrites.
- **BYOK Multi-Provider Architecture:** Built-in engine options for Google Gemini Enterprise / Vertex AI, Anthropic Claude, and DeepSeek, with local zero-data-retention key handling.
- **Heuristic Fallback Referee:** Offline-ready rule engine that delivers instant sanity checks even if external APIs are unreachable.
- **Room / Audience Voting & Appeal System:** Interactive audience polling mode allowing team members to cast their verdict before the machine calls it, with an evidence-based appeal workflow.

---

## 🛠️ Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Canvas Confetti
- **Document Processing:** PDF.js, HTML5 Audio API, Canvas rendering
- **Backend:** Node.js, Express, TSX
- **AI Models:** Google `@google/genai` (Gemini 3.8 Flash / Flash Lite), Claude, DeepSeek
- **Design System:** Custom vintage ticket typography (`Fraunces`, `Inter`), responsive layout, paper tear mechanics

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/bull-claim-referee.git
cd bull-claim-referee
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Setup (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Add your `GEMINI_API_KEY` (or enter your key directly inside the app's settings modal at runtime).

### 4. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📄 License
MIT License. Created by AJ Arowolo.
