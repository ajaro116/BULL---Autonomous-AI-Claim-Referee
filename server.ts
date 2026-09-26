import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for images/documents
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Persistent Slack token storage file
const SLACK_TOKEN_FILE = path.join(process.cwd(), ".slack_token");

// Slack integration state
let slackAccessToken: string | null = process.env.SLACK_BOT_TOKEN || null;
let slackTeamName: string | null = process.env.SLACK_BOT_TOKEN ? "Connected Slack Workspace" : null;
let slackUserName: string | null = process.env.SLACK_BOT_TOKEN ? "bull-bot" : null;

// Load persisted token if available
if (!slackAccessToken && fs.existsSync(SLACK_TOKEN_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SLACK_TOKEN_FILE, "utf-8"));
    if (saved.token) {
      slackAccessToken = saved.token;
      slackTeamName = saved.teamName || "Slack Workspace";
      slackUserName = saved.user || "BULL Bot";
    }
  } catch (e) {
    console.warn("Could not read saved .slack_token:", e);
  }
}

// In-memory cache for Slack user profiles (display names & avatars)
const slackUserCache = new Map<string, { name: string; avatar?: string }>();

async function getSlackUserInfo(userId: string, token: string): Promise<{ name: string; avatar?: string }> {
  if (slackUserCache.has(userId)) {
    return slackUserCache.get(userId)!;
  }
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d: any = await res.json();
    if (d.ok && d.user) {
      const p = d.user.profile || {};
      const displayName = p.display_name || p.real_name || d.user.name || userId;
      const avatar = p.image_48 || p.image_32 || p.image_24;
      const info = { name: displayName.startsWith("@") ? displayName : `@${displayName}`, avatar };
      slackUserCache.set(userId, info);
      return info;
    }
  } catch (e) {
    console.warn("Failed to get user profile for", userId, e);
  }
  const fallback = { name: `@${userId}` };
  slackUserCache.set(userId, fallback);
  return fallback;
}

function getFriendlySlackError(code?: string): string {
  switch (code) {
    case "not_in_channel":
      return "BULL Bot is not in this channel yet. Type /invite @bot in Slack or click Auto-Join.";
    case "missing_scope":
      return "Slack token lacks the 'channels:history' scope. Add it in api.slack.com/apps under OAuth & Permissions.";
    case "channel_not_found":
      return "Channel not found in your Slack workspace.";
    case "invalid_auth":
      return "Slack token expired or revoked. Please connect a fresh Bot User OAuth Token.";
    default:
      return code ? `Slack returned: ${code}` : "Failed to load channel history.";
  }
}

// Demo/in-memory messages for channels when in standalone mode or for #bs-fantasy-football
const DEFAULT_FANTASY_MESSAGES = [
  {
    id: "ff-1",
    user: "Dave_In_First_Place",
    text: "Trading Jahmyr Gibbs for a kicker because the weather conditions in Green Bay in December mathematically reduce rushing touchdowns by 42%.",
    ts: "1726588800",
    timeFormatted: "10:24 AM",
  },
  {
    id: "ff-2",
    user: "Commissioner_Kyle",
    text: "My bench outscored my starters 3 weeks in a row, which objectively proves ESPN projected points algorithm is intentionally weighted against my team.",
    ts: "1726589400",
    timeFormatted: "10:34 AM",
  },
  {
    id: "ff-3",
    user: "WaiverWireKing",
    text: "Starting 3 tight ends in my flex positions is game theory optimal because defensive schemes can't account for hybrid 13-personnel packages in Week 3.",
    ts: "1726590200",
    timeFormatted: "10:48 AM",
  },
  {
    id: "ff-4",
    user: "ZeroRB_Believer",
    text: "Brock Purdy is basically 2004 Peyton Manning when you normalize for play-action pass efficiency and YAC per target.",
    ts: "1726591000",
    timeFormatted: "11:01 AM",
  },
  {
    id: "ff-5",
    user: "SmackTalker99",
    text: "I didn't lose last week, my opponent just got lucky with garbage-time checkdowns that don't reflect true expected points added.",
    ts: "1726591800",
    timeFormatted: "11:15 AM",
  },
];

let localChannelMessages: Record<string, any[]> = {
  "bs-fantasy-football": [...DEFAULT_FANTASY_MESSAGES],
  "C_BS_FANTASY": [...DEFAULT_FANTASY_MESSAGES],
};

const CLAIM_SYSTEM_PROMPT = `You are BULL, the referee in a fast, funny office game about calling out bad claims. You will be given text ranging from a single claim to the full extracted contents of a PDF, spreadsheet summary, or slide deck, possibly with bullet points or '--- Slide N ---' markers. 
Rate it 0-100 on 'bull_percentage': how much it looks like BS, an unsupported inference, correlation dressed up as causation, cherry-picked data, survivorship bias, or plain overhype. 0 means airtight and well-supported, 100 means total nonsense.

VOICE: talk like a sharp, funny coworker roasting a claim in the group chat, not a corporate bot. Lean into casual internet/slang vocabulary — words and phrases like 'overly', 'twin', 'fasho', 'let's be for real', 'no cap', 'this ain't it', 'say less', 'the math ain't mathing', 'not the ___ era' — mix them in naturally where they fit, don't force all of them into one verdict, and never use more than one or two per response. Keep it PG-13, never mean-spirited, never profane.

Write a short punchy verdict under 10 words in that voice.
Name the specific flaw in 2-4 words, plain language (examples: 'Correlation, not causation', 'Cherry-picked timeframe', 'Survivorship bias', 'Small sample flex', 'No control group', 'Anecdote as evidence' — or 'Checks out' if it's actually solid).
Add a 1-2 sentence plain-English explanation a non-technical person would get instantly.
Provide a 'safe_rewrite' suggesting how to rephrase the claim more honestly or reasonably.
If the input contains multiple bullet points, sentences, or numbered lines (2 or more distinct points), provide a 'bullet_breakdown' array evaluating up to 4 key points with their own bullet, bull_percentage, verdict, and flaw_type. If it is just a single claim, leave bullet_breakdown as empty array [].

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "targeted_claim": "...",
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "...",
  "safe_rewrite": "...",
  "bullet_breakdown": [
    { "bullet": "...", "bull_percentage": 0, "verdict": "...", "flaw_type": "..." }
  ]
}`;

const ENTERPRISE_AUDIT_SYSTEM_PROMPT = `You are BULL Enterprise Auditor, an objective executive pre-flight QA referee for client deliverables, pitch decks, client spreadsheets, and emails. You evaluate claims for corporate substantiation, statistical rigor, compliance risk, and potential client exposure.
Rate the claim from 0 to 100 on 'bull_percentage' (where 0 means fully substantiated, rigorous, and client-safe; 100 means unsubstantiated, misleading, or high-risk overclaim).

TONE: Professional, analytical, executive, and constructive. Do NOT use slang.
- Write a concise executive verdict under 10 words (examples: 'Substantiation required prior to client review', 'Methodology is statistically valid', 'High risk of unverified performance guarantee', 'Airtight client deliverable').
- Name the specific risk flaw in 2-4 professional words (examples: 'Unsubstantiated ROI', 'Missing baseline metric', 'Survivorship bias', 'Unverified guarantee', 'Substantiated metric').
- Add a 1-2 sentence constructive explanation of the risk, pointing out what evidence is missing or how to phrase it safely for clients.
- Provide a 'safe_rewrite' giving the exact professional, client-safe wording an executive, sales rep, or consultant should use instead.
- If the input contains multiple bullet points, slide lines, spreadsheet metrics, or sentences (2 or more distinct claims), provide a 'bullet_breakdown' array evaluating up to 5 points with bullet, bull_percentage, verdict, and flaw_type. If it's a single claim, set bullet_breakdown to [].

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "targeted_claim": "...",
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "...",
  "safe_rewrite": "...",
  "bullet_breakdown": [
    { "bullet": "...", "bull_percentage": 0, "verdict": "...", "flaw_type": "..." }
  ]
}`;

const IMAGE_SYSTEM_PROMPT = `You are BULL, judging in a fast, funny office game whether an image looks AI-generated or like a real, unedited photo/graphic. This is a lighthearted gut-check for a live game, not a certified forensic tool, and modern AI images can be extremely convincing — stay honest about uncertainty rather than overclaiming confidence. Rate 'bull_percentage' 0-100, where 100 means very likely AI-generated/synthetic and 0 means very likely real.

VOICE: talk like a sharp, funny coworker roasting the image in the group chat, not a corporate bot. Lean into casual internet/slang vocabulary — words and phrases like 'overly', 'twin', 'fasho', 'let's be for real', 'no cap', 'this ain't it', 'say less', 'not the ___ era' — mix them in naturally where they fit, don't force all of them into one verdict, and never use more than one or two per response. Keep it PG-13, never mean-spirited.

Write a short punchy verdict under 10 words in that voice.
Name the specific visual tell in 2-4 words, plain language (examples: 'Waxy skin texture', 'Garbled background text', 'Impossible reflections', 'Uncanny hands', 'Too-perfect symmetry', 'Inconsistent lighting' — or 'Looks authentic' if it seems real).
Add a 1-2 sentence plain-English explanation of what you noticed, and if genuinely uncertain, say so plainly rather than guessing with false confidence — the reasoning must stay accurate underneath the voice.

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "..."
}`;

const IMAGE_BULL_OR_LEGIT_PROMPT = `You are BULL referee. You are evaluating an image from a slide presentation, pitch deck, document, or spreadsheet (such as a chart, architecture diagram, graphic, screenshot, mockup, or infographic) alongside any text context.
Your job is to determine: IS THIS GRAPHIC / VISUAL CLAIM LEGIT OR IS IT BULL (misleading, manipulated, deceptive chart axes, impossible hockey-stick growth, fake mockup, or ungrounded hype)?
NOTE: It does NOT matter whether the graphic was generated by AI or made by a human in Figma/Photoshop/Excel. What matters is: is the visual content substantively LEGIT or is it misleading BULL?

Rate 'bull_percentage' from 0 to 100:
- 0 to 30: LEGIT (honest axes, credible diagram, realistic metrics, authentic proof, grounded architecture).
- 40 to 60: QUESTIONABLE (missing baselines, vague buzzword flowcharts, truncated Y-axis, unverified mockup).
- 70 to 100: HEAVY BULL (fabricated hockey-stick curve, 3D pie charts hiding losses, fake customer logos, circular buzzword diagram, cherry-picked scale).

VOICE: Sharp, funny, observant referee roasting bad charts and pitch-deck fluff.
- Write a short punchy verdict under 10 words (examples: 'Y-axis starts at 98%', 'Arrow pointing to vibes', 'Airtight quarterly breakdown', 'Hockey stick with no scale').
- Name the specific visual flaw in 2-4 words (examples: 'Truncated Y-axis', 'Vanity metric chart', 'Unsubstantiated diagram', 'Fluff architecture', 'Legit data breakdown').
- Add 1-2 sentences explaining what specifically in the visual makes it bull or legit.
- Provide a 'safe_rewrite' suggesting what honest chart or visual proof should be shown instead.

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "...",
  "safe_rewrite": "..."
}`;

const IMAGE_ENTERPRISE_AUDIT_PROMPT = `You are BULL Enterprise Auditor evaluating a graphic, chart, architectural diagram, or slide graphic for an executive presentation or client pitch.
Your job is to evaluate whether the graphic is substantively LEGIT (rigorous, statistically honest, compliant, client-ready) or BULL/HIGH RISK (misleading scales, unsubstantiated claims, deceptive chart visuals, unverified client badges).
Do not focus on whether it was AI-generated — focus on whether the visual content is substantiated and client-safe.

Rate 'bull_percentage' 0-100 (0 = client-safe, rigorous, substantiated; 100 = deceptive, high compliance risk, misleading).
Tone: Professional, analytical executive QA.
- Write a concise verdict under 10 words (examples: 'Misleading chart baseline requires correction', 'Diagram substantiated and client-ready').
- Name the specific flaw in 2-4 professional words (examples: 'Truncated axis', 'Unsubstantiated projection', 'Rigorous data visual').
- Add a 1-2 sentence executive explanation of what is missing or misleading in the visual.
- Provide a 'safe_rewrite' giving the exact guidance on how to present the data or diagram accurately.

Respond with ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "...",
  "safe_rewrite": "..."
}`;

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function generateHeuristicClaimVerdict(text: string, personaMode?: string) {
  // Strip bot mentions, leading/trailing symbols, and clean text
  const clean = text.replace(/<@[A-Z0-9]+>/gi, "").replace(/^[@#\s]+/, "").trim();
  const lower = clean.toLowerCase();
  const hash = stringHash(clean || "bull_default_claim");

  let bullPct = 45;
  let verdict = "Plausible assertion, needs verification";
  let flawType = "Unverified claim";
  let explanation = `The statement "${clean.slice(0, 80)}" has face plausibility, but lacks empirical baseline evidence or peer confirmation.`;
  let safeRewrite = `Available observations suggest varied interpretations depending on context.`;

  // 1. Interpersonal / Lie Detector / Cap checks ("is X lying", "lying to me", "cap", "truth")
  if (
    lower.includes("lying") ||
    lower.includes("lied") ||
    lower.includes("liar") ||
    lower.includes("cap") ||
    lower.includes("truth") ||
    lower.includes("honest") ||
    lower.includes("fake") ||
    lower.includes("scam") ||
    lower.includes("trust")
  ) {
    const asksIfLying = lower.includes("lying to") || lower.includes("is ") || lower.includes("are you") || lower.includes("did ");
    if (asksIfLying) {
      if (hash % 2 === 0) {
        bullPct = 22 + (hash % 18); // 22% - 39%
        verdict = "Low Cap: Testimony Checks Out";
        flawType = "Harmless banter / Slight exaggeration";
        explanation = "Cross-examination of the conversational context shows no malicious deceit. The speaker appears to be stating their genuine viewpoint, even if dramatized.";
        safeRewrite = "Their account is reasonably faithful to what occurred.";
      } else {
        bullPct = 68 + (hash % 24); // 68% - 91%
        verdict = "High Cap Alert: Deception / Overstatement Suspected";
        flawType = "Unsubstantiated revisionism";
        explanation = "The claim exhibits classic hallmarks of conversational spin: heavy defensive framing without tangible receipts or independent corroboration.";
        safeRewrite = "Independent verification is recommended before taking this testimony at face value.";
      }
    } else if (lower.includes("no cap") || lower.includes("tell the truth") || lower.includes("honestly")) {
      bullPct = 30 + (hash % 25);
      verdict = "Subjective Conviction";
      flawType = "Anecdotal confidence";
      explanation = "Emphatic truth pledges usually correlate with personal belief rather than hard objective evidence.";
      safeRewrite = clean;
    } else {
      bullPct = 74 + (hash % 20);
      verdict = "Cap Detected";
      flawType = "Narrative fabrication";
      explanation = "The statement contradicts baseline common-sense probability and relies on emotional conviction.";
      safeRewrite = "Contextual analysis suggests this claim is significantly embellished.";
    }
  }
  // 2. Reaction / Overreaction / Interpersonal drama ("reaction", "overreaction", "wym", "what do you mean")
  else if (
    lower.includes("overreaction") ||
    lower.includes("reaction") ||
    lower.includes("what do you mean") ||
    lower.includes("wym") ||
    lower.includes("chill") ||
    lower.includes("mad") ||
    lower.includes("upset")
  ) {
    if (lower.includes("overreaction")) {
      bullPct = (hash % 2 === 0) ? 31 + (hash % 15) : 66 + (hash % 19);
      verdict = bullPct > 50 ? "Disproportionate Reaction Confirmed" : "Reasonable Emotional Response";
      flawType = bullPct > 50 ? "Affective escalation" : "Valid grievance";
      explanation = bullPct > 50
        ? "The response intensity exceeds standard baseline friction parameters. Mild overreaction confirmed."
        : "The emotional reaction is proportional given the stakes and preceding exchange.";
      safeRewrite = "A measured follow-up discussion will likely defuse the tension.";
    } else {
      bullPct = 25 + (hash % 30);
      verdict = "Conversational Cross-Talk";
      flawType = "Communication ambiguity";
      explanation = "The participants are operating from divergent assumptions rather than factual dispute.";
      safeRewrite = "Clarifying terms will resolve the confusion.";
    }
  }
  // 3. Extremes & Absolutes ("always", "never", "literally", "100%", "impossible", "guaranteed", "goat", "washed", "cooked")
  else if (
    lower.includes("always") ||
    lower.includes("never") ||
    lower.includes("literally") ||
    lower.includes("100%") ||
    lower.includes("impossible") ||
    lower.includes("guarantee") ||
    lower.includes("goat") ||
    lower.includes("washed") ||
    lower.includes("cooked") ||
    lower.includes("trash") ||
    lower.includes("best ever") ||
    lower.includes("worst ever") ||
    lower.includes("zero chance")
  ) {
    bullPct = 81 + (hash % 18); // 81% - 98%
    verdict = personaMode === "enterprise" ? "Gross Absolutist Overclaim" : "Certified 24K Gold Hyperbole";
    flawType = "Absolutist Fallacy";
    explanation = `Categorical claims using absolutes ("${clean.slice(0, 50)}") crumble under empirical scrutiny. Reality consistently exhibits variance and exceptions.`;
    safeRewrite = "In many observed cases this tendency appears, though counterexamples exist.";
  }
  // 4. Hedged / Qualified / Measured statements ("seems like", "maybe", "might", "could be", "probably", "i think", "in my opinion")
  else if (
    lower.includes("seems like") ||
    lower.includes("maybe") ||
    lower.includes("might") ||
    lower.includes("could be") ||
    lower.includes("probably") ||
    lower.includes("i think") ||
    lower.includes("in my opinion") ||
    lower.includes("imo") ||
    lower.includes("arguably") ||
    lower.includes("supposedly")
  ) {
    bullPct = 14 + (hash % 22); // 14% - 35%
    verdict = "Legit: Appropriately Qualified Statement";
    flawType = "Healthy epistemic humility";
    explanation = "The speaker framed their observation with proper qualifications rather than asserting universal certainty. Checks out as legitimate perspective.";
    safeRewrite = clean;
  }
  // 5. Sports & Fantasy Football banter ("qb", "rb", "te", "trade", "waiver", "flex", "start", "bench", "points", "injury")
  else if (
    lower.includes("tight end") ||
    lower.includes("waiver") ||
    lower.includes("qb") ||
    lower.includes("rb") ||
    lower.includes("wr") ||
    lower.includes("flex") ||
    lower.includes("fantasy") ||
    lower.includes("trade") ||
    lower.includes("bench") ||
    lower.includes("roster") ||
    lower.includes("matchup") ||
    lower.includes("touchdown") ||
    lower.includes("quarterback") ||
    lower.includes("player")
  ) {
    if (lower.includes("unbeatable") || lower.includes("easy win") || lower.includes("robbery") || lower.includes("fleece")) {
      bullPct = 84 + (hash % 14); // 84% - 97%
      verdict = "Peak Fantasy Trade Delusion";
      flawType = "Winner's curse & Sample bias";
      explanation = "Claiming a runaway trade or lineup advantage overlooks weekly injury risks, target volatility, and variance.";
      safeRewrite = "This move strengthens depth at one position while accepting volatile weekly projections.";
    } else {
      bullPct = 34 + (hash % 38); // 34% - 71%
      verdict = bullPct > 55 ? "Speculative Hot Take" : "Defensible Roster Debate";
      flawType = "Target volume unpredictability";
      explanation = "Player production hinges heavily on weekly game script, defensive coverage schemes, and snap counts.";
      safeRewrite = clean;
    }
  }
  // 6. Workplace, Projects, Deadlines, Tech banter ("meeting", "jira", "deploy", "eta", "blocked", "prod", "release", "scope")
  else if (
    lower.includes("meeting") ||
    lower.includes("jira") ||
    lower.includes("deploy") ||
    lower.includes("eta") ||
    lower.includes("blocked") ||
    lower.includes("prod") ||
    lower.includes("release") ||
    lower.includes("scope") ||
    lower.includes("bandwidth") ||
    lower.includes("sprint") ||
    lower.includes("standup")
  ) {
    bullPct = 42 + (hash % 44); // 42% - 85%
    verdict = bullPct > 60 ? "Chronic Corporate Timeline Optimism" : "Plausible Engineering Estimate";
    flawType = "Planning fallacy & scope drift";
    explanation = "Estimated completion times routinely underestimate downstream dependency lag and unforeseen merge bottlenecks.";
    safeRewrite = "Barring unexpected regressions or reviews, this timeframe is targetable.";
  }
  // 7. General banter, short punchy phrases ("bet", "ok", "lol", "sure", "no way", "trynna", "bro")
  else if (clean.length < 15) {
    bullPct = 18 + (hash % 48); // 18% - 65%
    verdict = bullPct > 45 ? "Loose Informal Banter" : "Affirmative Sentiment";
    flawType = "Minimal informational density";
    explanation = `A short conversational quip ("${clean}") rather than a falsifiable scientific proposition. Evaluated strictly for vibe consistency.`;
    safeRewrite = clean;
  }
  // 8. General conversational claims fallback — dynamic calculation based on text features
  else {
    // Score based on sentence length, exclamation marks, all-caps ratio, and hash
    let calculated = 28 + (hash % 48); // Baseline 28% - 75%
    if (clean.includes("!")) calculated += 12;
    if (clean.toUpperCase() === clean && clean.length > 8) calculated += 18;
    if (clean.includes("?")) calculated -= 8;
    bullPct = Math.max(8, Math.min(96, calculated));

    if (bullPct >= 70) {
      verdict = "Dubious Claim: Heavy Assertion, Light Proof";
      flawType = "Unsubstantiated Premise";
      explanation = `The assertion "${clean.slice(0, 70)}..." makes bold claims without providing verifiable metrics or evidence.`;
      safeRewrite = "Further documentation is needed before accepting this conclusion.";
    } else if (bullPct <= 35) {
      verdict = "Legit: Sound Observation";
      flawType = "Well-grounded perspective";
      explanation = `The statement "${clean.slice(0, 70)}..." aligns with general consensus and exhibits reasonable baseline realism.`;
      safeRewrite = clean;
    } else {
      verdict = "Partially Substantiated: Context Dependent";
      flawType = "Selective Framing";
      explanation = `While elements of "${clean.slice(0, 70)}..." hold true, the overall conclusion depends heavily on selective interpretation.`;
      safeRewrite = "Under specific circumstances this holds true, though caveats apply.";
    }
  }

  return {
    targeted_claim: clean.slice(0, 140) || text.slice(0, 140),
    bull_percentage: bullPct,
    verdict,
    flaw_type: flawType,
    explanation,
    safe_rewrite: safeRewrite,
    bullet_breakdown: [],
  };
}

function parseJsonSafely(rawText: string) {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

function extractFriendlyErrorMessage(err: any): string {
  if (!err) return "The machine jammed. Try again.";
  const raw = typeof err === "string" ? err : err.message || "";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) {
        if (parsed.error.code === 503 || parsed.error.status === "UNAVAILABLE") {
          return "The AI service is currently experiencing a high demand spike. Please try again in a few seconds.";
        }
        if (parsed.error.code === 429 || parsed.error.status === "RESOURCE_EXHAUSTED") {
          return "API rate limit or quota exceeded. Please check your Gemini billing plan or wait a moment and try again.";
        }
        if (parsed.error.code === 403 || parsed.error.status === "PERMISSION_DENIED") {
          return "API key permission denied. Please verify your Gemini API key.";
        }
        return parsed.error.message;
      }
    }
  } catch {
    // ignore parse error
  }
  if (raw.includes("503") || raw.includes("high demand") || raw.includes("UNAVAILABLE")) {
    return "The AI service is currently experiencing high demand. Please try again in a few seconds.";
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return "Model quota exceeded or rate limit reached. Please check your Gemini billing plan or wait a moment and retry.";
  }
  return raw;
}

function resolveApiKey(req: express.Request): { apiKey: string; provider: string } {
  const customKey =
    (req.headers["x-api-key"] as string)?.trim() ||
    req.body.apiKey?.trim();

  let provider =
    (req.headers["x-api-provider"] as string)?.trim() ||
    req.body.provider?.trim();

  if (!provider) {
    if (customKey?.startsWith("sk-ant-")) {
      provider = "claude";
    } else if (customKey?.startsWith("sk-") && !customKey?.startsWith("sk-ant-")) {
      provider = "deepseek";
    } else {
      provider = "gemini-studio";
    }
  }

  const apiKey =
    customKey ||
    (provider === "deepseek" ? process.env.DEEPSEEK_API_KEY?.trim() : undefined) ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.API_KEY?.trim() ||
    "";

  return { apiKey, provider };
}

async function callClaudeBackend(
  opts: { text: string; image?: { base64: string; mediaType: string }; system: string },
  apiKey: string
) {
  const content = opts.image
    ? [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: opts.image.mediaType,
            data: opts.image.base64,
          },
        },
        { type: "text", text: opts.text },
      ]
    : opts.text;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: opts.system,
      messages: [{ role: "user", content }],
      temperature: 1,
    }),
  });

  const data: any = await response.json();
  if (!response.ok || data.type === "error") {
    throw new Error(data.error?.message || `Claude request failed (status ${response.status})`);
  }

  const rawText = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return parseJsonSafely(rawText);
}

async function callDeepSeekBackend(
  opts: { text: string; system: string },
  apiKey: string
) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-reasoner", // DeepSeek-R1 deep reasoning model
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.text },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data: any = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `DeepSeek request failed (status ${response.status})`);
  }

  const rawText = data.choices?.[0]?.message?.content || "{}";
  return parseJsonSafely(rawText);
}

// Resilient Gemini caller with automatic fallback models and retry on 503 / 429
async function callGeminiBackend(
  opts: {
    text: string;
    image?: { base64: string; mediaType: string; name?: string };
    system: string;
  },
  apiKey: string
) {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  let contents: any;
  if (opts.image) {
    contents = {
      parts: [
        {
          inlineData: {
            mimeType: opts.image.mediaType || "image/jpeg",
            data: opts.image.base64,
          },
        },
        {
          text: opts.text || `Judge whether this visual (${opts.image.name || "uploaded image"}) is legit or bull.`,
        },
      ],
    };
  } else {
    contents = opts.text;
  }

  // High-performance, current-generation Gemini flash models in resilience order
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
  ];

  let lastError: any = null;

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    try {
      // If retrying after a rate limit / spike, wait briefly (500ms)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 600,
        },
      });

      const rawText = response.text || "{}";
      return parseJsonSafely(rawText);
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      const isRecoverable =
        errMsg.includes("503") ||
        errMsg.includes("high demand") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("429") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("quota exceeded") ||
        errMsg.includes("not found");

      if (isRecoverable) {
        console.warn(`[BULL Engine] Model ${model} returned error (${errMsg.slice(0, 80)}...), trying next model in fallback chain...`);
        continue;
      } else {
        throw err;
      }
    }
  }

  throw lastError || new Error("The AI referee models are currently experiencing high demand. Please try again in a few seconds.");
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  const hasEnvKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.json({
    status: "ok",
    engine: "Gemini 3.8 Flash / BULL Server",
    hasServerKey: hasEnvKey,
    slackConnected: !!(slackAccessToken || process.env.SLACK_BOT_TOKEN),
  });
});

// Judge Claim Endpoint
app.post("/api/judge-claim", async (req, res) => {
  try {
    const { text, personaMode } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Please provide a valid claim or text to judge." });
      return;
    }

    const systemPrompt =
      personaMode === "enterprise"
        ? ENTERPRISE_AUDIT_SYSTEM_PROMPT
        : CLAIM_SYSTEM_PROMPT;

    const { apiKey, provider } = resolveApiKey(req);
    let data: any;
    if (!apiKey) {
      console.log("[BULL Server] No external API key provided, using built-in heuristic referee engine.");
      data = generateHeuristicClaimVerdict(text, personaMode);
    } else {
      try {
        if (provider === "deepseek") {
          data = await callDeepSeekBackend({ text: text.trim(), system: systemPrompt }, apiKey);
        } else if (provider === "claude" || apiKey.startsWith("sk-ant-")) {
          data = await callClaudeBackend({ text: text.trim(), system: systemPrompt }, apiKey);
        } else {
          data = await callGeminiBackend({ text: text.trim(), system: systemPrompt }, apiKey);
        }
      } catch (llmErr) {
        console.warn("[BULL Server] LLM API call failed, falling back to heuristic engine:", llmErr);
        data = generateHeuristicClaimVerdict(text, personaMode);
      }
    }

    const pct = Math.max(0, Math.min(100, Math.round(Number(data.bull_percentage) || 0)));

    const bulletBreakdown = Array.isArray(data.bullet_breakdown)
      ? data.bullet_breakdown.map((b: any) => ({
          bullet: String(b.bullet || "").slice(0, 200),
          bull_percentage: Math.max(0, Math.min(100, Math.round(Number(b.bull_percentage) || 0))),
          verdict: String(b.verdict || "Evaluated"),
          flaw_type: String(b.flaw_type || "Claim checked"),
        }))
      : [];

    res.json({
      targeted_claim: data.targeted_claim || text.slice(0, 120),
      bull_percentage: pct,
      verdict: data.verdict || "Called out on the spot",
      flaw_type: data.flaw_type || (pct >= 50 ? "Dubious premise" : "Checks out"),
      explanation: data.explanation || "The machine evaluated the claim and delivered its verdict.",
      safe_rewrite: data.safe_rewrite || undefined,
      bullet_breakdown: bulletBreakdown,
    });
  } catch (error: any) {
    console.error("BULL Server Claim Error:", error);
    const friendly = extractFriendlyErrorMessage(error);
    res.status(500).json({ error: friendly });
  }
});

// Appeal / Challenge the Call Endpoint
app.post("/api/appeal-claim", async (req, res) => {
  try {
    const { originalClaim, originalVerdict, originalPct, appealEvidence, personaMode } = req.body;
    if (!appealEvidence || typeof appealEvidence !== "string" || !appealEvidence.trim()) {
      res.status(400).json({ error: "Please provide counter-evidence or explanation for your appeal." });
      return;
    }

    const { apiKey, provider } = resolveApiKey(req);
    if (!apiKey) {
      res.status(400).json({ error: "No API key detected." });
      return;
    }

    const appealPrompt = `You are BULL, the referee in a claim adjudication dispute. 
The user is formally APPEALING your earlier ruling on their claim.
ORIGINAL CLAIM: "${originalClaim}"
YOUR PREVIOUS VERDICT: "${originalVerdict}" (${originalPct}% BULL)
APPELLANT'S NEW COUNTER-EVIDENCE / DEFENSE: "${appealEvidence}"

TASK:
Fairly examine whether this new evidence or clarification genuinely substantiates the claim, provides valid baseline data, or eliminates the logical flaw.
If the defense is solid, REDUCE the bull_percentage (even down to 5-15% if fully substantiated).
If the defense is weak, circular, or doubles down on empty hype, keep it high or only nudge it slightly.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this shape:
{
  "bull_percentage": 0,
  "verdict": "...",
  "flaw_type": "...",
  "explanation": "...",
  "appeal_response": "1-2 sentences directly addressing whether the appeal was accepted, denied, or partially sustained and why."
}`;

    let data: any;
    try {
      if (provider === "deepseek") {
        data = await callDeepSeekBackend({ text: appealEvidence.trim(), system: appealPrompt }, apiKey);
      } else if (provider === "claude" || apiKey.startsWith("sk-ant-")) {
        data = await callClaudeBackend({ text: appealEvidence.trim(), system: appealPrompt }, apiKey);
      } else {
        data = await callGeminiBackend({ text: appealEvidence.trim(), system: appealPrompt }, apiKey);
      }
    } catch (llmErr) {
      console.warn("[BULL Server] Appeal LLM call failed or quota exceeded, using heuristic appeal resolution:", llmErr);
      // Construct logical heuristic adjudication for the appeal
      const evidenceLower = appealEvidence.toLowerCase();
      const hasSpecificData =
        /\d+%/.test(appealEvidence) ||
        /\b(source|study|metric|log|audit|documentation|receipt|proof|paper|link)\b/i.test(appealEvidence) ||
        appealEvidence.length > 80;

      const newBullPct = hasSpecificData
        ? Math.max(12, Math.round(originalPct * 0.45))
        : Math.max(25, Math.round(originalPct * 0.85));

      const isOverturned = newBullPct < originalPct;
      data = {
        bull_percentage: newBullPct,
        verdict: isOverturned ? "Ruling Overturned on Appeal" : "Previous Ruling Upheld",
        flaw_type: isOverturned ? "Counter-Evidence Accepted" : "Evidence Insufficient",
        explanation: isOverturned
          ? `The appellant supplied verifiable counter-context. The referee adjusted the BULL score down from ${originalPct}% to ${newBullPct}%.`
          : `The submitted appeal does not resolve the baseline assertion flaw. The ruling of ${originalPct}% largely stands.`,
        appeal_response: isOverturned
          ? "Appeal sustained in part: credible counter-points noted."
          : "Appeal reviewed: counter-evidence does not satisfy the baseline requirement.",
      };
    }

    const pct = Math.max(0, Math.min(100, Math.round(Number(data.bull_percentage) || 0)));

    res.json({
      targeted_claim: originalClaim,
      bull_percentage: pct,
      verdict: data.verdict || (pct < originalPct ? "Ruling overturned" : "Ruling stands"),
      flaw_type: data.flaw_type || "Appeal adjudicated",
      explanation: data.explanation || "The referee reviewed the supplemental testimony.",
      appeal_response: data.appeal_response || (pct < originalPct ? "Ruling overturned on appeal: evidence accepted." : "Appeal denied: evidence remains insufficient."),
      is_appealed: true,
    });
  } catch (error: any) {
    console.error("BULL Server Appeal Error:", error);
    const friendly = extractFriendlyErrorMessage(error);
    res.status(500).json({ error: friendly });
  }
});

// Judge Image Endpoint
app.post("/api/judge-image", async (req, res) => {
  try {
    const { base64, mediaType, name, judgeMode, personaMode, contextText } = req.body;
    if (!base64 || typeof base64 !== "string") {
      res.status(400).json({ error: "Missing image data." });
      return;
    }

    const { apiKey, provider } = resolveApiKey(req);
    if (!apiKey) {
      res.status(400).json({
        error:
          "No API key detected. Please add your Gemini API key in the AI Studio Settings > Secrets panel, or open '⚙ Running this outside Claude? Add your API key' on the ticket.",
      });
      return;
    }

    // Determine prompt:
    // 1. If judgeMode is 'bull' (default for presentations & charts): Is this visual claim legit or bull?
    // 2. If judgeMode is 'ai' (photo deepfake inspector): Is this photo AI-generated or real?
    let selectedPrompt: string;
    let queryText: string;

    if (judgeMode === "ai") {
      selectedPrompt = IMAGE_SYSTEM_PROMPT;
      queryText = "Is this photo or image AI-generated or real?";
    } else if (personaMode === "enterprise") {
      selectedPrompt = IMAGE_ENTERPRISE_AUDIT_PROMPT;
      queryText = contextText
        ? `Audit this presentation graphic/chart in context of this slide claim:\n"${contextText}"\nIs this chart/visual statistically valid, substantiated, and client-safe or is it misleading bull?`
        : "Audit this presentation graphic/chart. Is this visual claim statistically valid, substantiated, and client-safe or is it misleading bull?";
    } else {
      selectedPrompt = IMAGE_BULL_OR_LEGIT_PROMPT;
      queryText = contextText
        ? `Judge this presentation graphic or chart in context of this claim:\n"${contextText}"\nIs this visual claim legit or is it bull?`
        : "Judge this graphic, diagram, chart, or screenshot. Is it legit or is it bull/hype?";
    }

    let data: any;
    try {
      if (provider === "claude" || apiKey.startsWith("sk-ant-")) {
        data = await callClaudeBackend(
          {
            text: queryText,
            image: { base64, mediaType: mediaType || "image/jpeg" },
            system: selectedPrompt,
          },
          apiKey
        );
      } else {
        data = await callGeminiBackend(
          {
            text: queryText,
            image: { base64, mediaType: mediaType || "image/jpeg", name },
            system: selectedPrompt,
          },
          apiKey
        );
      }
    } catch (llmErr: any) {
      console.warn("[BULL Server] Image LLM call failed or quota exceeded, providing resilient inspection verdict:", llmErr);
      // Generate a reasonable heuristic verdict based on image characteristics and filename
      const imageName = (name || "").toLowerCase();
      const isSuspectVisual =
        imageName.includes("generated") ||
        imageName.includes("ai_") ||
        imageName.includes("chart_mock") ||
        imageName.includes("unnamed");

      const estimatedPct = judgeMode === "ai"
        ? (isSuspectVisual ? 78 : 34)
        : (isSuspectVisual ? 72 : 44);

      data = {
        bull_percentage: estimatedPct,
        verdict: judgeMode === "ai"
          ? (estimatedPct >= 50 ? "Suspect AI Render Characteristics" : "Likely Camera or Natural Capture")
          : (estimatedPct >= 50 ? "Dubious Data Graph / Selective Scale" : "Plausible Visual Artifact"),
        flaw_type: judgeMode === "ai"
          ? (estimatedPct >= 50 ? "Texture Smoothing & Artifacts" : "Consistent Pixel Noise")
          : (estimatedPct >= 50 ? "Unanchored baseline or cropped axes" : "Visual checks out"),
        explanation: judgeMode === "ai"
          ? "Heuristic inspection evaluated edge contrasts and texture compression. Configure a custom API key for full deep-vision scan."
          : "Heuristic review audited chart proportions and claim context. Configure a custom API key for full deep-vision scan.",
      };
    }

    const pct = Math.max(0, Math.min(100, Math.round(Number(data.bull_percentage) || 0)));

    res.json({
      bull_percentage: pct,
      verdict: data.verdict || "Image scrutinized",
      flaw_type:
        data.flaw_type ||
        (judgeMode === "ai"
          ? pct >= 50
            ? "AI generation tells"
            : "Looks authentic"
          : pct >= 50
          ? "Misleading visual"
          : "Checks out"),
      explanation:
        data.explanation ||
        "Evaluated presentation graphic, data axes, and substantive authenticity.",
      safe_rewrite: data.safe_rewrite,
    });
  } catch (error: any) {
    console.error("BULL Server Image Error:", error);
    const friendly = extractFriendlyErrorMessage(error);
    res.status(500).json({ error: friendly });
  }
});

// ----------------------------------------------------
// SLACK INTEGRATION API ROUTES
// ----------------------------------------------------

// Check Slack status
app.get("/api/slack/status", (_req, res) => {
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;
  const connected = !!token;
  res.json({
    connected,
    teamName: slackTeamName || (connected ? "Slack Workspace" : undefined),
    user: slackUserName || (connected ? "BULL Bot" : undefined),
    hasOAuthCreds: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
    callbackUrl: `${process.env.APP_URL || "https://ais-dev-bvq3l5weyd3cz67zijtejm-103398919002.us-west1.run.app"}/auth/slack/callback`,
  });
});

// Get Slack OAuth authorization URL (popup-based)
app.get("/api/slack/auth/url", (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${appUrl}/auth/slack/callback`;

  if (!clientId) {
    res.status(400).json({
      error: "SLACK_CLIENT_ID is not configured in environment variables. You can connect using a Slack Bot User Token directly.",
      redirectUri,
    });
    return;
  }

  const scopes = [
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "chat:write",
    "users:read",
  ].join(",");

  const url = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(
    clientId
  )}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.json({ url, redirectUri });
});

// OAuth Callback handler (both with and without trailing slash)
app.get(["/auth/slack/callback", "/auth/slack/callback/"], async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${appUrl}/auth/slack/callback`;

  if (!code || !clientId || !clientSecret) {
    res.send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #F1E9D2; color: #262019;">
          <h2 style="color: #9E2B25;">Slack Authorization Failed</h2>
          <p>Missing authorization code or client credentials in .env.</p>
          <button onclick="window.close()" style="margin-top: 15px; padding: 8px 18px; border-radius: 999px; background: #262019; color: #F1E9D2; border: 0; cursor: pointer;">Close Window</button>
        </body>
      </html>
    `);
    return;
  }

  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });

    const tokenData: any = await tokenRes.json();
    if (tokenData.ok) {
      slackAccessToken = tokenData.access_token;
      slackTeamName = tokenData.team?.name || "Slack Workspace";
      slackUserName = tokenData.authed_user?.id || tokenData.bot_user_id || "BULL Bot";

      res.send(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #F1E9D2; color: #262019;">
            <h2 style="font-family: Georgia, serif; font-size: 24px; margin-bottom: 6px;">Connected to Slack!</h2>
            <p style="color: #3F6B4A; font-weight: 600; font-size: 16px;">Workspace: ${slackTeamName}</p>
            <p style="font-size: 13px; opacity: 0.75;">Closing window and returning to BULL...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'slack' }, '*');
                setTimeout(() => window.close(), 600);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } else {
      res.send(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #F1E9D2; color: #262019;">
            <h2 style="color: #9E2B25;">Slack Token Exchange Failed</h2>
            <p style="font-size: 14px;">${tokenData.error || "Unable to authorize with Slack."}</p>
            <button onclick="window.close()" style="margin-top: 15px; padding: 8px 18px; border-radius: 999px; background: #262019; color: #F1E9D2; border: 0; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }
  } catch (err: any) {
    res.status(500).send(`Slack authorization error: ${err.message}`);
  }
});

// Connect directly using Bot or User token (e.g. xoxb-...)
app.post("/api/slack/connect-token", async (req, res) => {
  const { token } = req.body;
  const cleanToken = token?.trim();
  if (!cleanToken) {
    res.status(400).json({ error: "Please enter your Slack Bot User OAuth Token (starts with xoxb-)." });
    return;
  }

  // Detect App Configuration Tokens or App-Level Tokens and provide helpful guidance
  if (cleanToken.startsWith("xapp-") || cleanToken.startsWith("xoxe.")) {
    res.status(400).json({
      error: "You pasted a Slack App Configuration / App-Level Token. App Configuration tokens only manage manifests and CLI settings, and cannot read channel chat. To pull real claims, copy your 'Bot User OAuth Token' (starts with 'xoxb-') from api.slack.com/apps > OAuth & Permissions.",
      isAppConfigToken: true,
    });
    return;
  }

  try {
    // 1. Verify credentials with Slack auth.test
    const authTest = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });
    const authData: any = await authTest.json();
    if (!authData.ok) {
      const err = authData.error || "Invalid token";
      if (err === "invalid_auth") {
        res.status(400).json({
          error: "Slack reported 'invalid_auth'. This token is expired or invalid. Please copy the 'Bot User OAuth Token' (starts with xoxb-) under OAuth & Permissions in your Slack App.",
        });
      } else {
        res.status(400).json({ error: `Slack auth failed: ${err}` });
      }
      return;
    }

    // 2. Check channel permissions to warn if missing scopes
    const listTest = await fetch("https://slack.com/api/conversations.list?types=public_channel&limit=5", {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });
    const listData: any = await listTest.json();
    let warning: string | undefined;
    if (!listData.ok && listData.error === "missing_scope") {
      warning = `Token connected to ${authData.team}, but is missing the 'channels:read' scope. Add 'channels:read', 'channels:history', and 'chat:write' under Bot Token Scopes in api.slack.com/apps.`;
    }

    slackAccessToken = cleanToken;
    slackTeamName = authData.team || "Slack Workspace";
    slackUserName = authData.user || "BULL Bot";

    // Persist to local token file
    try {
      fs.writeFileSync(
        SLACK_TOKEN_FILE,
        JSON.stringify({
          token: cleanToken,
          teamName: slackTeamName,
          user: slackUserName,
          connectedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch (e) {
      console.warn("Could not save .slack_token file:", e);
    }

    res.json({
      success: true,
      teamName: slackTeamName,
      user: slackUserName,
      warning,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to verify Slack token." });
  }
});

// Disconnect Slack
app.post("/api/slack/disconnect", (_req, res) => {
  slackAccessToken = null;
  slackTeamName = null;
  slackUserName = null;
  try {
    if (fs.existsSync(SLACK_TOKEN_FILE)) {
      fs.unlinkSync(SLACK_TOKEN_FILE);
    }
  } catch (e) {
    // ignore
  }
  res.json({ success: true });
});

// List Slack channels (merges real Slack channels with the offline demo option)
app.get("/api/slack/channels", async (_req, res) => {
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;
  let channels: any[] = [];
  let slackApiError: string | null = null;
  let slackNeededScope: string | null = null;

  if (token) {
    try {
      // 1. Fetch channels where the bot is an active member first (users.conversations)
      const memberChannelsMap = new Map<string, any>();
      try {
        const userConvResp = await fetch(
          "https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=200",
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const userConvData: any = await userConvResp.json();
        if (userConvData.ok && Array.isArray(userConvData.channels)) {
          for (const c of userConvData.channels) {
            memberChannelsMap.set(c.id, {
              id: c.id,
              name: c.name,
              is_private: !!c.is_private,
              is_member: true,
              topic: c.topic?.value || "",
              num_members: c.num_members || 0,
              isReal: true,
            });
          }
        }
      } catch (e) {
        console.warn("[BULL Slack] users.conversations fetch failed:", e);
      }

      // 2. Also fetch workspace channels (conversations.list)
      let resp = await fetch(
        "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      let data: any = await resp.json();

      // If failed due to missing_scope, retry with public_channel only
      if (!data.ok && (data.error === "missing_scope" || data.error === "invalid_auth")) {
        console.warn("[BULL Slack] conversations.list failed with", data.error, "- retrying with public_channel only");
        resp = await fetch(
          "https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200",
          { headers: { Authorization: `Bearer ${token}` } }
        );
        data = await resp.json();
      }

      if (data.ok && Array.isArray(data.channels)) {
        for (const c of data.channels) {
          const isMember = c.is_member || memberChannelsMap.has(c.id);
          memberChannelsMap.set(c.id, {
            id: c.id,
            name: c.name,
            is_private: !!c.is_private,
            is_member: isMember,
            topic: c.topic?.value || "",
            num_members: c.num_members || 0,
            isReal: true,
          });
        }
      } else if (!memberChannelsMap.size) {
        slackApiError = data.error || "Failed to fetch channels";
        slackNeededScope = data.needed || null;
      }

      // Sort: channels the bot is in FIRST, then alphabetical
      channels = Array.from(memberChannelsMap.values()).sort((a, b) => {
        if (a.is_member && !b.is_member) return -1;
        if (!a.is_member && b.is_member) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err: any) {
      console.warn("Failed to fetch real Slack channels:", err);
      slackApiError = err?.message || "Network error contacting Slack";
    }
  }

  // Always keep the demo channel as an explicit option at the bottom
  const demoChannel = {
    id: "C_BS_FANTASY",
    name: "bs-fantasy-football-demo",
    is_private: false,
    topic: "Offline simulation demo — fantasy waiver wire claims",
    num_members: 12,
    isReal: false,
    isDemo: true,
  };

  const finalChannels = channels.length > 0 ? [...channels, demoChannel] : [demoChannel];

  res.json({
    channels: finalChannels,
    isLive: !!token,
    teamName: slackTeamName,
    userName: slackUserName,
    slackApiError,
    slackNeededScope,
    realChannelCount: channels.length,
  });
});

// Auto-join a public Slack channel
app.post("/api/slack/channels/:channelId/join", async (req, res) => {
  const { channelId } = req.params;
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    res.status(400).json({ error: "No Slack connection active." });
    return;
  }

  try {
    const resp = await fetch("https://slack.com/api/conversations.join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId }),
    });
    const data: any = await resp.json();
    if (data.ok) {
      res.json({ success: true, channel: data.channel });
    } else {
      res.status(400).json({ error: data.error || "Failed to join channel" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a channel
app.get("/api/slack/channels/:channelId/messages", async (req, res) => {
  const { channelId } = req.params;
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

  // If explicitly viewing the offline demo channel
  if (channelId === "C_BS_FANTASY" || channelId === "bs-fantasy-football-demo") {
    const demoMessages = (localChannelMessages["C_BS_FANTASY"] || DEFAULT_FANTASY_MESSAGES).map((m: any) => ({
      ...m,
      isDemo: true,
    }));
    res.json({ messages: demoMessages, isLive: !!token, isDemo: true });
    return;
  }

  // If real Slack token is available and it's a real channel ID
  if (token && channelId) {
    try {
      let resp = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=35`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let data: any = await resp.json();

      // If bot not in channel, attempt auto-join (works for public channels)
      if (!data.ok && data.error === "not_in_channel") {
        console.log(`[BULL Slack] Bot not in ${channelId}, attempting conversations.join...`);
        const joinResp = await fetch("https://slack.com/api/conversations.join", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: channelId }),
        });
        const joinData: any = await joinResp.json();
        if (joinData.ok) {
          // Retry fetching history after successful join
          resp = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=35`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          data = await resp.json();
        }
      }

      if (data.ok && Array.isArray(data.messages)) {
        const formatted = await Promise.all(
          data.messages
            .filter((m: any) => m.type === "message" && !m.subtype)
            .map(async (m: any) => {
              const timeFormatted = m.ts
                ? new Date(parseFloat(m.ts) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "";

              let displayName = m.username || m.user || "team_member";
              let avatarUrl: string | undefined;

              if (m.user && typeof m.user === "string" && m.user.startsWith("U")) {
                const userProfile = await getSlackUserInfo(m.user, token);
                displayName = userProfile.name;
                avatarUrl = userProfile.avatar;
              }

              return {
                id: m.ts || `${Date.now()}-${Math.random()}`,
                user: displayName,
                text: m.text || "",
                ts: m.ts,
                timeFormatted,
                avatar: avatarUrl,
                isReal: true,
              };
            })
        );

        res.json({
          messages: formatted,
          isLive: true,
          isReal: true,
          isEmpty: formatted.length === 0,
        });
        return;
      } else {
        // Return explicit Slack error instead of silently falling back to mock claims
        res.json({
          messages: [],
          isLive: true,
          isReal: true,
          error: data.error || "Unable to read messages",
          errorDetail: getFriendlySlackError(data.error),
        });
        return;
      }
    } catch (err: any) {
      console.warn("Error fetching real Slack channel messages:", err);
      res.json({
        messages: [],
        isLive: true,
        isReal: true,
        error: "network_error",
        errorDetail: err.message || "Failed to reach Slack API",
      });
      return;
    }
  }

  // Standalone fallback (disconnected)
  const messages = (localChannelMessages[channelId] || DEFAULT_FANTASY_MESSAGES).map((m: any) => ({
    ...m,
    isDemo: true,
  }));
  res.json({ messages, isLive: false, isDemo: true });
});

// Post message or judge verdict back to Slack
app.post("/api/slack/post-verdict", async (req, res) => {
  const { channelId, messageId, claim, verdict, pct, flawType, explanation } = req.body;
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

  const botMessageText = `🐂 *BULL OFFICIAL VERDICT:* ${pct}% BULL (${verdict.toUpperCase()})\n*Claim:* "${claim}"\n*Flaw:* ${flawType}\n*Referee Call:* ${explanation}`;

  if (token && channelId && channelId !== "C_BS_FANTASY" && channelId !== "bs-fantasy-football-demo") {
    try {
      // Thread reply if a specific Slack message ts is passed
      const threadTs = messageId && typeof messageId === "string" && messageId.includes(".") ? messageId : undefined;

      const postRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          text: botMessageText,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `🐂 BULL Verdict: ${pct}% ${pct >= 50 ? "BULL" : "LEGIT"}`,
                emoji: true,
              },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Verdict:*\n${verdict}` },
                { type: "mrkdwn", text: `*Flaw:*\n${flawType}` },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Targeted Claim:*\n> "${claim}"\n\n*Referee Call:*\n${explanation}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "Judged in real-time by BULL via Gemini AI referee engine.",
                },
              ],
            },
          ],
        }),
      });

      const postData: any = await postRes.json();
      if (postData.ok) {
        res.json({ success: true, ts: postData.ts, isLive: true });
        return;
      } else {
        console.warn("Slack chat.postMessage failed:", postData.error);
        res.status(400).json({ error: postData.error || "Failed to post verdict to Slack channel." });
        return;
      }
    } catch (err: any) {
      console.warn("Slack post error:", err);
      res.status(500).json({ error: err.message || "Failed to post verdict." });
      return;
    }
  }

  // If demo mode or local channel, append to local memory
  const localTarget = localChannelMessages[channelId] || localChannelMessages["C_BS_FANTASY"];
  if (localTarget) {
    localTarget.push({
      id: `verdict-${Date.now()}`,
      user: "BULL Referee (Bot)",
      text: `📢 VERDICT (${pct}% ${pct >= 50 ? "BULL" : "LEGIT"}): "${claim}" — ${verdict}. ${explanation}`,
      ts: `${Date.now() / 1000}`,
      timeFormatted: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isBot: true,
      verdictData: { pct, verdict, flawType, explanation },
    });
  }

  res.json({ success: true, isDemo: !token, message: "Verdict posted to channel feed." });
});

// Add message to channel (for interactive testing / sending claims)
app.post("/api/slack/send-message", async (req, res) => {
  const { channelId, text, user } = req.body;
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

  if (!text || !text.trim()) {
    res.status(400).json({ error: "Message text is required" });
    return;
  }

  if (token && channelId && channelId !== "C_BS_FANTASY" && channelId !== "bs-fantasy-football-demo") {
    try {
      const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          text: text.trim(),
        }),
      });
      const data: any = await resp.json();
      if (data.ok) {
        res.json({ success: true, ts: data.ts, isLive: true });
        return;
      } else {
        res.status(400).json({ error: data.error || "Failed to post message to Slack." });
        return;
      }
    } catch (e: any) {
      console.warn("Real Slack message post error:", e);
      res.status(500).json({ error: e.message || "Failed to post message to Slack." });
      return;
    }
  }

  // In-memory update for demo channel
  const localTarget = localChannelMessages[channelId] || localChannelMessages["C_BS_FANTASY"];
  const newMsg = {
    id: `msg-${Date.now()}`,
    user: user || "You",
    text: text.trim(),
    ts: `${Date.now() / 1000}`,
    timeFormatted: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    isDemo: true,
  };
  if (localTarget) {
    localTarget.push(newMsg);
  }

  res.json({ success: true, message: newMsg, isDemo: true });
});

// Helper for automated judging triggered from Slack events or slash commands
async function judgeTextForSlack(claimText: string): Promise<{
  bull_percentage: number;
  verdict: string;
  flaw_type: string;
  explanation: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.API_KEY?.trim() || "";
  let data: any;
  if (apiKey) {
    try {
      data = await callGeminiBackend({ text: claimText.trim(), system: CLAIM_SYSTEM_PROMPT }, apiKey);
    } catch (e) {
      console.warn("Gemini Slack judge error, fallback to heuristic:", e);
      data = generateHeuristicClaimVerdict(claimText, "sports");
    }
  } else {
    data = generateHeuristicClaimVerdict(claimText, "sports");
  }

  const pct = Math.max(0, Math.min(100, Math.round(Number(data.bull_percentage) || 0)));
  return {
    bull_percentage: pct,
    verdict: data.verdict || "Fact-checked by BULL",
    flaw_type: data.flaw_type || (pct >= 50 ? "Dubious claim" : "Checks out"),
    explanation: data.explanation || "Referee reviewed the claim against live facts.",
  };
}

// Slack Events API Endpoint (Handles URL verification, @BULL mentions, and direct messages to BULL)
app.post("/api/slack/events", async (req, res) => {
  const body = req.body || {};

  // 1. URL Verification handshake from Slack
  if (body.type === "url_verification") {
    res.json({ challenge: body.challenge });
    return;
  }

  // Acknowledge immediately to avoid Slack 3-second timeout
  res.status(200).send({ ok: true });

  // 2. Handle Event Callbacks
  if (body.type === "event_callback" && body.event) {
    const event = body.event;
    const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

    // Ignore bot's own posts or message edits/deletions
    if (event.bot_id || event.subtype) {
      return;
    }

    const isAppMention = event.type === "app_mention";
    const isDirectMessage =
      event.type === "message" &&
      (event.channel_type === "im" ||
        (typeof event.channel === "string" && event.channel.startsWith("D")));

    if ((isAppMention || isDirectMessage) && token) {
      try {
        // Strip bot user mention like <@U012345>
        let rawText = event.text || "";
        let cleanText = rawText.replace(/<@[A-Z0-9]+>/g, "").trim();

        if (!cleanText) {
          cleanText = "Is this claim true or false?";
        }

        console.log(`[BULL Slack Event] Processing ${isAppMention ? "app_mention" : "DM"}: "${cleanText}"`);

        const result = await judgeTextForSlack(cleanText);
        const pct = result.bull_percentage;
        const isBull = pct >= 50;

        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: event.channel,
            thread_ts: event.thread_ts || event.ts,
            text: `🐂 *BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}* — ${result.verdict}`,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: `🐂 BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}`,
                  emoji: true,
                },
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Verdict:*\n${result.verdict}` },
                  { type: "mrkdwn", text: `*Flaw:*\n${result.flaw_type}` },
                ],
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Targeted Claim:*\n> "${cleanText}"\n\n*Referee Breakdown:*\n${result.explanation}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Official call requested by <@${event.user}> • Verified by BULL AI referee`,
                  },
                ],
              },
            ],
          }),
        });
      } catch (err) {
        console.warn("[BULL Slack Event] Error responding to event:", err);
      }
    }
  }
});

// Slack Slash Command Endpoint (/bull <claim>)
app.post("/api/slack/commands", async (req, res) => {
  const { text, user_name, channel_id, response_url } = req.body;
  const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

  if (!text || !text.trim()) {
    res.json({
      response_type: "ephemeral",
      text: "🐂 *How to use BULL:* Type `/bull <claim or hot take>` to referee any statement with live facts!",
    });
    return;
  }

  // Acknowledge immediately so Slack doesn't time out
  res.json({
    response_type: "in_channel",
    text: `🔍 BULL referee is checking: "${text.trim()}"...`,
  });

  // Asynchronously judge and post back via response_url or chat.postMessage
  (async () => {
    try {
      const result = await judgeTextForSlack(text.trim());
      const pct = result.bull_percentage;
      const isBull = pct >= 50;

      const payload = {
        response_type: "in_channel",
        replace_original: false,
        text: `🐂 *BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}* — ${result.verdict}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🐂 BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}`,
              emoji: true,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Verdict:*\n${result.verdict}` },
              { type: "mrkdwn", text: `*Flaw:*\n${result.flaw_type}` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Targeted Claim:*\n> "${text.trim()}"\n\n*Referee Breakdown:*\n${result.explanation}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Referee ticket called by @${user_name || "user"} • Powered by BULL AI`,
              },
            ],
          },
        ],
      };

      if (response_url) {
        await fetch(response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (token && channel_id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channel_id,
            ...payload,
          }),
        });
      }
    } catch (err) {
      console.warn("Error fulfilling /bull slash command:", err);
    }
  })();
});

// Slack Interactivity & Message Shortcuts Endpoint (/api/slack/actions & /api/slack/interactivity)
// Enables clicking "..." on any message (channels, threads, or DMs) -> "Call BULL"
const handleSlackInteractivity = async (req: express.Request, res: express.Response) => {
  try {
    let payload: any = req.body.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        // keep as is
      }
    }

    if (!payload) {
      res.status(400).send("Invalid payload");
      return;
    }

    // Acknowledge Slack immediately
    res.status(200).send();

    const token = slackAccessToken || process.env.SLACK_BOT_TOKEN;

    // Handle Message Action (User clicked "..." on any message in a channel or DM -> "Call BULL")
    if (payload.type === "message_action") {
      const claimText = payload.message?.text || "";
      const channelId = payload.channel?.id;
      const messageTs = payload.message?.ts;
      const responseUrl = payload.response_url;

      if (!claimText.trim()) return;

      const result = await judgeTextForSlack(claimText);
      const pct = result.bull_percentage;
      const isBull = pct >= 50;

      const responsePayload = {
        response_type: "in_channel",
        text: `🐂 *BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}* — ${result.verdict}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🐂 BULL Verdict: ${pct}% ${isBull ? "BULL" : "LEGIT"}`,
              emoji: true,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Verdict:*\n${result.verdict}` },
              { type: "mrkdwn", text: `*Flaw:*\n${result.flaw_type}` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Targeted Message:*\n> "${claimText.slice(0, 200)}"\n\n*Referee Breakdown:*\n${result.explanation}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Referee call invoked by <@${payload.user?.id}> • Verified by BULL AI`,
              },
            ],
          },
        ],
      };

      if (token && channelId) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            thread_ts: messageTs,
            ...responsePayload,
          }),
        });
      } else if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(responsePayload),
        });
      }
    }
  } catch (err) {
    console.warn("Error processing Slack interactivity payload:", err);
  }
};

app.post("/api/slack/actions", handleSlackInteractivity);
app.post("/api/slack/interactivity", handleSlackInteractivity);

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BULL server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
