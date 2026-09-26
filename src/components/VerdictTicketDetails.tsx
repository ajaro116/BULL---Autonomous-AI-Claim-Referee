import React, { useState } from 'react';
import { Copy, Check, MessageSquareShare, Sparkles, Scale, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { JudgmentResult } from '../types';

interface VerdictTicketDetailsProps {
  result: JudgmentResult;
  isImageMode: boolean;
  imageInspectionMode?: 'bull' | 'ai';
  personaMode: 'referee' | 'enterprise';
  onAppealSubmitted?: (evidence: string) => Promise<void>;
  isAppealing?: boolean;
}

export const VerdictTicketDetails: React.FC<VerdictTicketDetailsProps> = ({
  result,
  isImageMode,
  imageInspectionMode = 'bull',
  personaMode,
  onAppealSubmitted,
  isAppealing = false,
}) => {
  const [copiedSlack, setCopiedSlack] = useState(false);
  const [copiedRewrite, setCopiedRewrite] = useState(false);
  const [showAppealBox, setShowAppealBox] = useState(false);
  const [appealEvidence, setAppealEvidence] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(true);

  const isHigh = result.bull_percentage >= 50;

  // Generate markdown / Slack mrkdwn formatted block
  const generateSlackText = () => {
    const icon = result.bull_percentage >= 70 ? '🚨' : result.bull_percentage >= 40 ? '⚠️' : '✅';
    const modeHeader = personaMode === 'enterprise' ? '*[BULL Enterprise Pre-Flight QA Audit]*' : '*[BULL AI Referee Verdict]*';
    const claimPart = result.targeted_claim ? `\n> *Claim:* "${result.targeted_claim}"` : '';
    const metricType = isImageMode && imageInspectionMode === 'ai' ? 'AI Likelihood' : 'BULL';
    const verdictPart = `\n${icon} *Verdict:* "${result.verdict}" — *${result.bull_percentage}% ${metricType}*`;
    const flawPart = `\n🏷️ *Flaw / Call:* \`${result.flaw_type}\``;
    const explPart = `\n📝 *Finding:* ${result.explanation}`;
    const rewritePart = result.safe_rewrite ? `\n💡 *Safe Phrasing / Fix:* _"${result.safe_rewrite}"_` : '';

    return `${modeHeader}${claimPart}${verdictPart}${flawPart}${explPart}${rewritePart}\n_Audited by BULL Claim Referee_`;
  };

  const handleCopySlack = async () => {
    const text = generateSlackText();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlack(true);
      setTimeout(() => setCopiedSlack(false), 2200);
    } catch {
      // Fallback
      setCopiedSlack(true);
      setTimeout(() => setCopiedSlack(false), 2200);
    }
  };

  const handleCopyRewrite = async () => {
    if (!result.safe_rewrite) return;
    try {
      await navigator.clipboard.writeText(result.safe_rewrite);
      setCopiedRewrite(true);
      setTimeout(() => setCopiedRewrite(false), 2000);
    } catch {
      setCopiedRewrite(true);
      setTimeout(() => setCopiedRewrite(false), 2000);
    }
  };

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealEvidence.trim() || !onAppealSubmitted) return;
    await onAppealSubmitted(appealEvidence.trim());
    setAppealEvidence('');
    setShowAppealBox(false);
  };

  return (
    <div id="verdict-ticket-details" className="w-full mt-4 space-y-4">
      {/* Action Row: Copy Slack Card & Share */}
      <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
        <button
          type="button"
          id="copy-slack-card-btn"
          onClick={handleCopySlack}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#262019]/[0.07] hover:bg-[#262019]/[0.12] text-[#262019] border border-[#262019]/15 transition-all cursor-pointer shadow-xs active:scale-95"
        >
          {copiedSlack ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#3F6B4A]" />
              <span className="text-[#3F6B4A]">Slack Card Copied!</span>
            </>
          ) : (
            <>
              <MessageSquareShare className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Copy Slack Card</span>
            </>
          )}
        </button>

        {!isImageMode && onAppealSubmitted && (
          <button
            type="button"
            id="challenge-call-btn"
            onClick={() => setShowAppealBox(!showAppealBox)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#14213D]/10 hover:bg-[#14213D]/15 text-[#14213D] border border-[#14213D]/20 transition-all cursor-pointer shadow-xs active:scale-95"
          >
            <Scale className="w-3.5 h-3.5 text-[#14213D]" />
            <span>{showAppealBox ? 'Hide Appeal' : 'Appeal the Call'}</span>
          </button>
        )}
      </div>

      {/* Appeal outcome banner if already appealed */}
      {result.is_appealed && result.appeal_response && (
        <div
          id="appeal-verdict-banner"
          className="p-3 rounded-xl bg-[#E4C465]/20 border border-[#C9A227]/40 text-xs text-[#262019] text-left space-y-1 animate-fadeIn"
        >
          <div className="font-bold flex items-center gap-1.5 text-[#14213D]">
            <Scale className="w-3.5 h-3.5 text-[#14213D]" />
            <span>Adjudicated Appeal Ruling</span>
          </div>
          <p className="italic text-[#262019]/85">{result.appeal_response}</p>
        </div>
      )}

      {/* Interactive Appeal / Challenge Input Box */}
      {showAppealBox && (
        <form
          onSubmit={handleSubmitAppeal}
          id="appeal-challenge-form"
          className="p-3.5 rounded-xl bg-[#262019]/[0.04] border border-[#262019]/15 text-left space-y-2.5 animate-fadeIn"
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#262019]">
            <span className="flex items-center gap-1">
              <Scale className="w-3.5 h-3.5 text-[#9E2B25]" />
              Submit Counter-Evidence or Baseline Data
            </span>
            <span className="text-[10px] text-[#262019]/50 font-normal">Multi-Turn Adjudication</span>
          </div>
          <p className="text-[11.5px] text-[#262019]/70 leading-snug">
            Disagree with the ruling? Provide actual proof, methodology notes, or baseline testing to appeal your score.
          </p>
          <textarea
            id="appeal-evidence-input"
            value={appealEvidence}
            onChange={(e) => setAppealEvidence(e.target.value)}
            rows={2}
            placeholder='e.g. "We conducted an A/B test with 5,000 active users comparing churn against the previous cohort (p < 0.05)."'
            className="w-full text-xs p-2 rounded-lg border border-[#262019]/25 bg-white/70 text-[#262019] placeholder:text-[#262019]/40 outline-none focus:border-[#14213D]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAppealBox(false)}
              className="text-xs px-3 py-1 text-[#262019]/60 hover:text-[#262019]"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-appeal-button"
              disabled={isAppealing || !appealEvidence.trim()}
              className="px-4 py-1 rounded-full text-xs font-bold bg-[#14213D] text-[#F1E9D2] hover:bg-[#0B1526] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {isAppealing ? 'Evaluating Appeal...' : 'Submit Appeal to Referee'}
            </button>
          </div>
        </form>
      )}

      {/* Instant Executive Safe Rewrite (Solution Maker) */}
      {result.safe_rewrite && (
        <div
          id="safe-rewrite-box"
          className="p-3.5 rounded-xl bg-[#3F6B4A]/10 border border-[#3F6B4A]/25 text-left space-y-1.5 text-xs text-[#262019]"
        >
          <div className="flex items-center justify-between font-bold text-[#3F6B4A]">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {personaMode === 'enterprise' ? 'Executive Client-Safe Phrasing' : 'Honest Alternative Phrasing'}
              </span>
            </span>
            <button
              type="button"
              id="copy-safe-rewrite-btn"
              onClick={handleCopyRewrite}
              className="text-[11px] font-semibold text-[#3F6B4A] hover:underline flex items-center gap-1 cursor-pointer"
            >
              {copiedRewrite ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Phrasing</span>
                </>
              )}
            </button>
          </div>
          <p className="font-sans-body italic text-[12.5px] leading-relaxed text-[#262019]/90 bg-white/60 p-2 rounded-lg border border-[#3F6B4A]/20">
            "{result.safe_rewrite}"
          </p>
          <p className="text-[10.5px] text-[#262019]/55">
            Tip: Replace unverified guarantees with methodology-backed statements before client review.
          </p>
        </div>
      )}

      {/* Multi-Claim Slide / Doc Breakdown (if deck or doc had multiple points) */}
      {result.bullet_breakdown && result.bullet_breakdown.length > 0 && (
        <div
          id="bullet-breakdown-panel"
          className="rounded-xl border border-[#262019]/15 bg-[#262019]/[0.03] overflow-hidden text-left"
        >
          <button
            type="button"
            id="toggle-breakdown-button"
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-[#262019] hover:bg-[#262019]/[0.04] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-[#C9A227]" />
              <span>Multi-Claim Pre-Flight Breakdown ({result.bullet_breakdown.length} points analyzed)</span>
            </span>
            {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showBreakdown && (
            <div className="p-3 pt-0 space-y-2 border-t border-[#262019]/10">
              {result.bullet_breakdown.map((item, idx) => {
                const itemHigh = item.bull_percentage >= 50;
                return (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-white/75 border border-[#262019]/10 text-xs space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-[#262019] text-[12px] flex-1">
                        • {item.bullet}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${
                          itemHigh ? 'bg-[#9E2B25]/15 text-[#9E2B25]' : 'bg-[#3F6B4A]/15 text-[#3F6B4A]'
                        }`}
                      >
                        {item.bull_percentage}% {itemHigh ? 'BULL' : 'LEGIT'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10.5px] text-[#262019]/65">
                      <span className="italic">"{item.verdict}"</span>
                      <span>&bull;</span>
                      <span className="font-semibold text-[#262019]/75">{item.flaw_type}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
