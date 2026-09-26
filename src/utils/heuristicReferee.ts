function generateHeuristicClaimJudgment(text: string, personaMode?: string) {
  const lower = text.toLowerCase();
  let bullPct = 42;
  let verdict = "Plausible claim, needs context";
  let flawType = "Unverified assertion";
  let explanation = "The claim sounds plausible on the surface, but lacks explicit baseline comparisons or verifiable data points.";
  let safeRewrite = `Historically, observed outcomes vary depending on baseline conditions and team execution.`;

  // Fantasy football heuristics
  if (
    lower.includes("tight end") ||
    lower.includes("waiver") ||
    lower.includes("qb") ||
    lower.includes("rb") ||
    lower.includes("flex") ||
    lower.includes("fantasy") ||
    lower.includes("matchup") ||
    lower.includes("unbeatable") ||
    lower.includes("trade") ||
    lower.includes("bench") ||
    lower.includes("roster")
  ) {
    if (lower.includes("unbeatable") || lower.includes("guaranteed") || lower.includes("always") || lower.includes("never") || lower.includes("easiest")) {
      bullPct = 86;
      verdict = "Peak waiver wire delusion";
      flawType = "Small sample bias";
      explanation = "Claiming an unbeatable roster format ignores variance, weekly matchups, and target distribution unpredictability in real games.";
      safeRewrite = "Starting multiple tight ends in flex can work in specific high-target weeks, but carries high scoring volatility.";
    } else if (lower.includes("shocked") || lower.includes("fire") || lower.includes("destin")) {
      bullPct = 68;
      verdict = "Emotional overreaction";
      flawType = "Post-game tilt";
      explanation = "Reactionary sentiment based on a single week's variance rather than underlying season-long projection metrics.";
      safeRewrite = "Week-to-week scoring swings are standard; regression to the mean usually occurs across a multi-game sample.";
    } else {
      bullPct = 35;
      verdict = "Standard league discussion";
      flawType = "Subject to variance";
      explanation = "A conventional fantasy take that depends heavily on health, snap count, and red zone utilization.";
      safeRewrite = text;
    }
  } else if (
    lower.includes("guarantee") ||
    lower.includes("100%") ||
    lower.includes("never fails") ||
    lower.includes("double our") ||
    lower.includes("10x") ||
    lower.includes("500%")
  ) {
    bullPct = 92;
    verdict = personaMode === "enterprise" ? "High compliance risk guarantee" : "Certified hype train";
    flawType = "Unsubstantiated absolute";
    explanation = "Extravagant performance guarantees without verifiable baseline telemetry or controls represent classic overclaiming.";
    safeRewrite = "Initial leading indicators suggest positive trending, though sustained multi-period attribution is still being validated.";
  } else if (lower.includes("meeting") || lower.includes("efficiency") || lower.includes("agile") || lower.includes("synergy")) {
    bullPct = 64;
    verdict = "Classic office optimism";
    flawType = "Attribution overclaim";
    explanation = "Attributing team output velocity to a single operational adjustment overlooks secondary dependencies.";
    safeRewrite = "Reducing meeting cadence frees focused blocks, though overall throughput depends on project scope and execution.";
  }

  return {
    targeted_claim: text.slice(0, 140),
    bull_percentage: bullPct,
    verdict,
    flaw_type: flawType,
    explanation,
    safe_rewrite: safeRewrite,
    bullet_breakdown: [],
  };
}

export { generateHeuristicClaimJudgment };
