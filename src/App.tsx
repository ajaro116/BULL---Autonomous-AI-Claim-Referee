import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, MessageSquare, Ticket, Hash, Search, X, Filter } from 'lucide-react';
import { JudgmentResult, HistoryEntry, PendingImage, PresentationImage, JudgeMode, AppViewTab, ImageInspectionMode } from './types';
import { Gauge } from './components/Gauge';
import { Stamp } from './components/Stamp';
import { VerdictTicketDetails } from './components/VerdictTicketDetails';
import { HistoryList } from './components/HistoryList';
import { ApiKeyPanel } from './components/ApiKeyPanel';
import { SlackFeed } from './components/SlackFeed';
import { exportCombinedHistoryToCSV } from './utils/csvExport';
import {
  extractPdf,
  extractPptxWithImages,
  extractDocx,
  extractTxt,
  fileToBase64,
  resizeImageBase64,
  truncateText,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
} from './utils/fileExtractor';

function cleanErrorMessage(raw: string): string {
  if (!raw) return 'The machine jammed. Try again.';
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) {
        if (parsed.error.code === 503 || parsed.error.status === 'UNAVAILABLE') {
          return 'The AI referee is experiencing high demand. Please try again in a moment.';
        }
        if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
          return 'Model rate limit reached. Please wait a moment and try again.';
        }
        if (parsed.error.code === 403 || parsed.error.status === 'PERMISSION_DENIED') {
          return 'Invalid API key or permission denied. Please verify your API key.';
        }
        return parsed.error.message;
      }
    }
  } catch {
    // ignore
  }
  if (raw.includes('503') || raw.includes('high demand') || raw.includes('UNAVAILABLE')) {
    return 'The AI referee is experiencing high demand. Please try again in a moment.';
  }
  return raw;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppViewTab>('personal');
  const [claimText, setClaimText] = useState('');
  const [isJudging, setIsJudging] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [extractNote, setExtractNote] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [presentationImages, setPresentationImages] = useState<PresentationImage[]>([]);
  const [imageInspectionMode, setImageInspectionMode] = useState<ImageInspectionMode>('bull');

  // API Key state
  const [isApiKeyPanelOpen, setIsApiKeyPanelOpen] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem('bull_api_key');
    } catch {
      return false;
    }
  });

  // Results state
  const [currentResult, setCurrentResult] = useState<JudgmentResult | null>(null);
  const [gaugePercentage, setGaugePercentage] = useState<number | null>(null);
  const [stampLabel, setStampLabel] = useState<string | null>(null);
  const [stampIsHigh, setStampIsHigh] = useState(false);
  const [currentMode, setCurrentMode] = useState<JudgeMode>('text');
  const [personaMode, setPersonaMode] = useState<'referee' | 'enterprise'>('referee');
  const [isAppealing, setIsAppealing] = useState(false);

  // Reveal mode state
  const [revealMode, setRevealMode] = useState(false);
  const [crowdGuessIsHigh, setCrowdGuessIsHigh] = useState<boolean | null>(null);
  const [crowdNote, setCrowdNote] = useState<{ text: string; isMatch: boolean } | null>(null);

  // History state (persisted in localStorage)
  const [claimHistory, setClaimHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('bull_claim_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [imageHistory, setImageHistory] = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('bull_image_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // History search and category filtering
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyFilterType, setHistoryFilterType] = useState<'all' | 'claims' | 'images' | 'bull' | 'legit'>('all');

  // Filtered lists for real-time keyword search
  const filteredClaimHistory = useMemo(() => {
    if (historyFilterType === 'images') return [];
    let list = claimHistory;
    if (historyFilterType === 'bull') list = list.filter((item) => item.pct >= 50);
    if (historyFilterType === 'legit') list = list.filter((item) => item.pct < 50);

    const q = historySearchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((item) => {
      return (
        item.claim.toLowerCase().includes(q) ||
        (item.verdict && item.verdict.toLowerCase().includes(q)) ||
        (item.flawType && item.flawType.toLowerCase().includes(q)) ||
        (item.explanation && item.explanation.toLowerCase().includes(q)) ||
        (item.safeRewrite && item.safeRewrite.toLowerCase().includes(q)) ||
        (item.date && item.date.toLowerCase().includes(q))
      );
    });
  }, [claimHistory, historySearchQuery, historyFilterType]);

  const filteredImageHistory = useMemo(() => {
    if (historyFilterType === 'claims') return [];
    let list = imageHistory;
    if (historyFilterType === 'bull') list = list.filter((item) => item.pct >= 50);
    if (historyFilterType === 'legit') list = list.filter((item) => item.pct < 50);

    const q = historySearchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((item) => {
      return (
        item.claim.toLowerCase().includes(q) ||
        (item.verdict && item.verdict.toLowerCase().includes(q)) ||
        (item.flawType && item.flawType.toLowerCase().includes(q)) ||
        (item.explanation && item.explanation.toLowerCase().includes(q)) ||
        (item.safeRewrite && item.safeRewrite.toLowerCase().includes(q)) ||
        (item.date && item.date.toLowerCase().includes(q))
      );
    });
  }, [imageHistory, historySearchQuery, historyFilterType]);

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save history on change
  useEffect(() => {
    try {
      localStorage.setItem('bull_claim_history', JSON.stringify(claimHistory));
    } catch (e) {
      console.error('Failed to save claim history:', e);
    }
  }, [claimHistory]);

  useEffect(() => {
    try {
      localStorage.setItem('bull_image_history', JSON.stringify(imageHistory));
    } catch (e) {
      console.error('Failed to save image history:', e);
    }
  }, [imageHistory]);

  const leftLabel = pendingImage && imageInspectionMode === 'ai' ? 'REAL' : 'LEGIT';
  const rightLabel = pendingImage && imageInspectionMode === 'ai' ? 'AI' : 'BULL';

  // Handle file selection
  const handleFile = async (file: File) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setFileName(file.name);
    setClaimText('');
    resetResult();

    // Image handling
    if (IMAGE_EXTENSIONS[ext]) {
      if (file.size > MAX_IMAGE_BYTES) {
        setExtractNote('That image is a bit large — try one under 4MB.');
        return;
      }
      setExtractNote(`Loading ${file.name}...`);
      try {
        const rawBase64 = await fileToBase64(file);
        const resized = await resizeImageBase64(rawBase64, IMAGE_EXTENSIONS[ext], 1280, 0.85);
        setPendingImage({
          base64: resized.base64,
          mediaType: resized.mediaType,
          name: file.name,
          previewUrl: `data:${resized.mediaType};base64,${resized.base64}`,
        });
        setCurrentMode('image');
        setExtractNote(`${file.name} loaded. Click "Judge it" to see real vs. AI.`);
      } catch (err) {
        console.error('Image load error:', err);
        setExtractNote('Could not load that image. Try a different file.');
      }
      return;
    }

    // Document handling
    setPendingImage(null);
    setPresentationImages([]);
    setCurrentMode('text');
    setExtractNote(`Reading ${file.name}...`);

    try {
      let text = '';
      let slideImages: PresentationImage[] = [];
      const arrayBuffer = ['pdf', 'pptx', 'docx'].includes(ext)
        ? await file.arrayBuffer()
        : null;

      if (ext === 'pdf' && arrayBuffer) {
        text = await extractPdf(arrayBuffer);
      } else if (ext === 'pptx' && arrayBuffer) {
        const pptxResult = await extractPptxWithImages(arrayBuffer);
        text = pptxResult.text;
        slideImages = pptxResult.images;
      } else if (ext === 'docx' && arrayBuffer) {
        text = await extractDocx(arrayBuffer);
      } else if (['txt', 'md', 'json', 'csv'].includes(ext)) {
        text = await extractTxt(file);
      } else {
        setExtractNote("Can't read that file type — try PDF, PPTX, DOCX, TXT, or an image.");
        return;
      }

      setPresentationImages(slideImages);

      if (!text || !text.trim()) {
        if (slideImages.length > 0) {
          setExtractNote(`Found ${slideImages.length} images inside ${file.name}, but no text. Select an image below to judge real vs. AI.`);
          return;
        }
        setExtractNote('Found no readable text in that file — it may be scanned images rather than text.');
        return;
      }

      const formatted = truncateText(text.trim());
      setClaimText(formatted);
      if (slideImages.length > 0) {
        setExtractNote(
          `Extracted ${text.length.toLocaleString()} characters and ${slideImages.length} embedded images from ${file.name}. Review slide claims or click an image below to audit.`
        );
      } else {
        setExtractNote(
          `Extracted ${text.length.toLocaleString()} characters from ${file.name}. Review below, then judge it.`
        );
      }
    } catch (err: any) {
      console.error('File extraction error:', err);
      setExtractNote('Could not read that file. Try exporting it as PDF or TXT and uploading again.');
    }
  };

  const clearCurrentFile = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileName(null);
    setPendingImage(null);
    setPresentationImages([]);
    setExtractNote('');
    setClaimText('');
    setCurrentMode('text');
    resetResult();
  };

  const resetResult = () => {
    setCurrentResult(null);
    setGaugePercentage(null);
    setStampLabel(null);
    setCrowdNote(null);
    setStatusMessage('');
  };

  const getRequestHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      const storedKey = localStorage.getItem('bull_api_key');
      const storedProvider = localStorage.getItem('bull_api_provider');
      if (storedKey) {
        headers['x-api-key'] = storedKey;
      }
      if (storedProvider) {
        headers['x-api-provider'] = storedProvider;
      }
    } catch {
      // ignore
    }
    return headers;
  };

  const handleJudge = async () => {
    const textToJudge = claimText.trim();
    if (!pendingImage && !textToJudge) {
      setStatusMessage('Type something, or upload a file or image, for the machine to chew on.');
      return;
    }

    setIsJudging(true);
    resetResult();
    setStatusMessage(
      pendingImage
        ? 'Inspecting pixels & visual artifacts...'
        : personaMode === 'enterprise'
        ? 'Auditing substantiation, statistics & compliance...'
        : 'Examining claim & logic...'
    );

    const headers = getRequestHeaders();

    try {
      if (pendingImage) {
        const response = await fetch('/api/judge-image', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base64: pendingImage.base64,
            mediaType: pendingImage.mediaType,
            name: pendingImage.name,
            judgeMode: imageInspectionMode,
            personaMode,
            contextText: claimText.trim() || undefined,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
          if (response.status === 400 || (data.error && data.error.includes('API key'))) {
            setIsApiKeyPanelOpen(true);
          }
          throw new Error(data.error || `Server returned ${response.status}`);
        }

        renderJudgment(data, 'image', pendingImage.name);
      } else {
        const response = await fetch('/api/judge-claim', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: textToJudge, personaMode }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
          if (response.status === 400 || (data.error && data.error.includes('API key'))) {
            setIsApiKeyPanelOpen(true);
          }
          throw new Error(data.error || `Server returned ${response.status}`);
        }

        renderJudgment(data, 'text', textToJudge);
      }
    } catch (err: any) {
      console.error('Judge error:', err);
      setStatusMessage(cleanErrorMessage(err?.message || 'The machine jammed. Try again.'));
      setGaugePercentage(0);
    } finally {
      setIsJudging(false);
    }
  };

  const renderJudgment = (result: JudgmentResult, mode: JudgeMode, sourceLabel: string) => {
    const pct = Math.max(0, Math.min(100, Math.round(result.bull_percentage)));
    const isHigh = pct >= 50;

    setStatusMessage('');
    setCurrentResult(result);
    setGaugePercentage(pct);
    setStampIsHigh(isHigh);

    const stampText =
      mode === 'image' && imageInspectionMode === 'ai'
        ? isHigh
          ? 'AI'
          : 'REAL'
        : isHigh
        ? 'BULL'
        : 'LEGIT';
    setStampLabel(stampText);

    if (revealMode && crowdGuessIsHigh !== null) {
      const match = crowdGuessIsHigh === isHigh;
      const guessLabel = crowdGuessIsHigh ? rightLabel : leftLabel;
      setCrowdNote({
        text: `Room said ${guessLabel} — BULL ${
          match ? 'agrees, fasho. Room takes the round.' : 'disagrees. Room whiffed on this one.'
        }`,
        isMatch: match,
      });
    }

    const entryLabel = mode === 'image' ? sourceLabel : result.targeted_claim || sourceLabel;
    const newEntry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      claim: entryLabel,
      pct,
      isHigh,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date().toISOString(),
      verdict: result.verdict,
      flawType: result.flaw_type,
      explanation: result.explanation,
      safeRewrite: result.safe_rewrite,
      type: mode === 'image' ? 'image' : 'claim',
    };

    if (mode === 'image') {
      setImageHistory((prev) => [newEntry, ...prev]);
    } else {
      setClaimHistory((prev) => [newEntry, ...prev]);
    }
  };

  // Helper when user appeals / challenges the referee call with new evidence
  const handleAppealSubmitted = async (evidence: string) => {
    if (!currentResult) return;
    setIsAppealing(true);
    setStatusMessage('Reviewing supplemental testimony & baseline evidence...');
    try {
      const headers = getRequestHeaders();
      const response = await fetch('/api/appeal-claim', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          originalClaim: currentResult.targeted_claim || claimText,
          originalVerdict: currentResult.verdict,
          originalPct: currentResult.bull_percentage,
          appealEvidence: evidence,
          personaMode,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Appeal deliberation failed.');
      }

      const newPct = Math.max(0, Math.min(100, Math.round(data.bull_percentage)));
      setGaugePercentage(newPct);
      setStampIsHigh(newPct >= 50);
      setStampLabel(newPct >= 50 ? 'BULL' : 'LEGIT');
      setCurrentResult({
        ...currentResult,
        bull_percentage: newPct,
        verdict: data.verdict,
        flaw_type: data.flaw_type,
        explanation: data.explanation,
        appeal_response: data.appeal_response,
        is_appealed: true,
      });
      setStatusMessage('Appeal adjudicated.');
    } catch (err: any) {
      console.error('Appeal error:', err);
      setStatusMessage(cleanErrorMessage(err?.message || 'Deliberation error.'));
    } finally {
      setIsAppealing(false);
    }
  };

  // Helper when clicking "Open in Full Referee Ticket" from Slack message
  const handleTransferClaimFromSlack = (claim: string) => {
    setPendingImage(null);
    setFileName(null);
    setExtractNote('Loaded from live Slack channel');
    setClaimText(claim);
    setCurrentMode('text');
    resetResult();
    setActiveTab('personal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      id="bull-app"
      className="min-h-screen text-[#262019] selection:bg-[#C9A227]/30 font-sans-body px-4 py-8 md:py-14"
    >
      <div className="max-w-[560px] mx-auto">
        {/* Marquee Header */}
        <header className="text-center mb-6">
          <h1
            id="brand-title"
            className="font-serif-display font-black text-6xl sm:text-7xl md:text-[86px] tracking-tight text-[#E4C465] m-0 leading-none drop-shadow-[0_2px_0_rgba(0,0,0,0.35)] select-none"
          >
            BULL
          </h1>
          <p
            id="brand-tagline"
            className="font-serif-display italic font-medium text-[#E6DCBE] text-base md:text-[17px] mt-2.5 opacity-85"
          >
            step up, say the claim, let the machine decide
          </p>
        </header>

        {/* Dual Mode Switcher (Personal Demo vs Slack Channel Wire) */}
        <nav aria-label="Mode Selection" className="flex justify-center mb-6">
          <div className="bg-[#262019]/25 p-1 rounded-full border border-[#E6DCBE]/25 flex items-center gap-1 shadow-inner backdrop-blur-xs">
            <button
              type="button"
              id="mode-personal-tab"
              onClick={() => setActiveTab('personal')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'personal'
                  ? 'bg-[#E4C465] text-[#262019] shadow-sm'
                  : 'text-[#E6DCBE] hover:text-white'
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              Solo Ticket Demo
            </button>

            <button
              type="button"
              id="mode-slack-tab"
              onClick={() => setActiveTab('slack')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'slack'
                  ? 'bg-[#E4C465] text-[#262019] shadow-sm'
                  : 'text-[#E6DCBE] hover:text-white'
              }`}
            >
              <Hash className="w-3.5 h-3.5" />
              Slack Wire
            </button>
          </div>
        </nav>

        {/* VIEW 1: Solo Referee Ticket Demo */}
        {activeTab === 'personal' && (
          <div>
            <div
              id="ticket-card"
              className={`ticket-container p-6 sm:p-8 transition-all ${
                isDragOver ? 'ring-2 ring-[#C9A227] ring-offset-[-6px]' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) handleFile(dropped);
              }}
            >
              {/* Animated Stamp */}
              <Stamp
                show={stampLabel !== null}
                label={stampLabel || ''}
                isHigh={stampIsHigh}
              />

              {/* Original API Key Accordion */}
              <ApiKeyPanel
                isOpen={isApiKeyPanelOpen}
                onToggle={() => setIsApiKeyPanelOpen(!isApiKeyPanelOpen)}
                onKeySaved={(key) => setHasStoredKey(!!key)}
                hasStoredKey={hasStoredKey}
              />

              {/* Operating Mode Switcher: Referee Mode vs Enterprise Pre-Flight Audit */}
              <div className="mb-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#262019]/60 mb-1.5 flex items-center justify-between">
                  <span>Operating Mode</span>
                  <span className="text-[10px] font-normal text-[#262019]/45">
                    {personaMode === 'enterprise' ? 'Executive Pre-Flight QA' : 'Slack & Team Banter'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#262019]/[0.05] rounded-xl border border-[#262019]/15">
                  <button
                    type="button"
                    id="mode-referee-btn"
                    onClick={() => setPersonaMode('referee')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      personaMode === 'referee'
                        ? 'bg-[#262019] text-[#F1E9D2] shadow-sm'
                        : 'bg-transparent text-[#262019]/70 hover:text-[#262019] hover:bg-[#262019]/[0.04]'
                    }`}
                  >
                    <span>📯</span>
                    <span className="truncate">Referee Mode (Slack/Fun)</span>
                  </button>
                  <button
                    type="button"
                    id="mode-enterprise-btn"
                    onClick={() => setPersonaMode('enterprise')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      personaMode === 'enterprise'
                        ? 'bg-[#14213D] text-[#F1E9D2] shadow-sm'
                        : 'bg-transparent text-[#262019]/70 hover:text-[#262019] hover:bg-[#262019]/[0.04]'
                    }`}
                  >
                    <span>🛡️</span>
                    <span className="truncate">Enterprise Audit (Client QA)</span>
                  </button>
                </div>
              </div>

              {/* Input Field Area */}
              <div className="space-y-2">
                <label
                  htmlFor="claim-input"
                  className="block text-[13px] text-[#262019]/70 leading-relaxed font-normal"
                >
                  {personaMode === 'enterprise'
                    ? 'Executive Pre-Flight Audit: Paste slide bullet points, spreadsheet summaries, or email drafts to detect compliance risks and unverified claims.'
                    : 'Type a claim, paste a whole slide of bullet points, or upload a PDF, deck, doc, or image — BULL will call it.'}
                </label>

                <textarea
                  id="claim-input"
                  value={claimText}
                  onChange={(e) => {
                    setClaimText(e.target.value);
                    if (pendingImage) {
                      setPendingImage(null);
                      setFileName(null);
                      setExtractNote('');
                      setCurrentMode('text');
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      handleJudge();
                    }
                  }}
                  placeholder={
                    personaMode === 'enterprise'
                      ? 'e.g. "Our AI workflow provides 450% guaranteed ROI within 30 days without changing team processes."'
                      : 'e.g. "Churn dropped 12% because of the new onboarding flow"'
                  }
                  rows={3}
                  className="w-full min-h-[96px] resize-y border-0 border-b-2 border-[#262019] bg-transparent font-sans-body text-base md:text-[17px] text-[#262019] placeholder:text-[#262019]/40 py-2 px-0.5 outline-none focus-visible:outline-2 focus-visible:outline-[#3F6B4A] focus-visible:outline-offset-4"
                />

                {/* 1-Click Preset Pills for Pitch Demonstration */}
                <div className="pt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-[#262019]/50 tracking-wide uppercase mr-1">
                    Try Sample:
                  </span>
                  {personaMode === 'enterprise' ? (
                    <>
                      <button
                        type="button"
                        id="preset-pitch-deck-btn"
                        onClick={() => {
                          setPendingImage(null);
                          setFileName(null);
                          setExtractNote('Loaded sample client slide deck claims');
                          setClaimText(
                            "• Our enterprise engine delivers a guaranteed 400% ROI in 30 days.\n• Machine conversion increases by 180% without any model retraining.\n• Platform integrates natively with all legacy systems with zero security risk."
                          );
                          resetResult();
                        }}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#14213D]/[0.08] hover:bg-[#14213D]/15 text-[#14213D] border border-[#14213D]/20 transition-colors cursor-pointer"
                      >
                        📑 Client Pitch Slide
                      </button>
                      <button
                        type="button"
                        id="preset-spreadsheet-btn"
                        onClick={() => {
                          setPendingImage(null);
                          setFileName(null);
                          setExtractNote('Loaded spreadsheet claim');
                          setClaimText(
                            "Q3 operating margin expanded by 55% YoY strictly due to our software automation rollout, with zero impact from headcount reduction."
                          );
                          resetResult();
                        }}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#14213D]/[0.08] hover:bg-[#14213D]/15 text-[#14213D] border border-[#14213D]/20 transition-colors cursor-pointer"
                      >
                        📊 Spreadsheet Claim
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        id="preset-fantasy-football-btn"
                        onClick={() => {
                          setPendingImage(null);
                          setFileName(null);
                          setExtractNote('Loaded fantasy football claim');
                          setClaimText(
                            "Starting 3 tight ends in flex is mathematically unbeatable this season because of red-zone target share regression."
                          );
                          resetResult();
                        }}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#262019]/[0.06] hover:bg-[#262019]/15 text-[#262019] border border-[#262019]/15 transition-colors cursor-pointer"
                      >
                        🏈 Fantasy Flex Claim
                      </button>
                      <button
                        type="button"
                        id="preset-pipeline-btn"
                        onClick={() => {
                          setPendingImage(null);
                          setFileName(null);
                          setExtractNote('Loaded office pipeline claim');
                          setClaimText(
                            "This new cold email sequence will 10x our qualified sales pipeline by next Friday without any extra ad spend."
                          );
                          resetResult();
                        }}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#262019]/[0.06] hover:bg-[#262019]/15 text-[#262019] border border-[#262019]/15 transition-colors cursor-pointer"
                      >
                        🚀 10x Pipeline Claim
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Upload Row */}
              <div id="upload-action-row" className="mt-3.5 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  id="upload-button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-sans-body text-xs font-semibold text-[#14213D] bg-transparent border-[1.5px] border-dashed border-[#262019]/40 hover:border-[#14213D] hover:bg-[#262019]/[0.04] rounded-full px-4 py-2 transition-all cursor-pointer flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[#3F6B4A]"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload a file or image
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  id="file-input-element"
                  accept=".pdf,.pptx,.docx,.txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />

                {fileName && (
                  <span
                    id="file-chip"
                    className="inline-flex items-center gap-1.5 text-xs text-[#262019]/75 bg-[#262019]/[0.06] border border-[#262019]/15 px-3 py-1 rounded-full"
                  >
                    <span className="max-w-[180px] truncate">{fileName}</span>
                    <button
                      type="button"
                      id="clear-file-button"
                      onClick={clearCurrentFile}
                      aria-label="Remove uploaded file"
                      className="text-[#262019]/50 hover:text-[#9E2B25] transition-colors cursor-pointer text-sm leading-none"
                    >
                      &times;
                    </button>
                  </span>
                )}
              </div>

              {/* Image Preview & Inspection Mode Controls */}
              {pendingImage && (
                <div id="image-preview-wrapper" className="mt-3.5 p-3 rounded-xl bg-[#262019]/[0.03] border border-[#262019]/15 flex flex-col items-center gap-3">
                  <div className="relative group">
                    <img
                      id="image-preview"
                      src={pendingImage.previewUrl}
                      alt="Uploaded visual for analysis"
                      className="max-w-full max-h-[220px] rounded-md border-[2px] border-[#262019] shadow-[0_6px_16px_rgba(0,0,0,0.18)] object-contain bg-white"
                    />
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-[#14213D] text-[#F1E9D2] text-[10px] font-bold tracking-wide">
                      {imageInspectionMode === 'bull' ? 'VISUAL CLAIM AUDIT' : 'DEEPFAKE CHECK'}
                    </div>
                  </div>

                  {/* Mode selector: Is it Bull or Legit (Chart/Claim validity) vs AI or Real (Deepfake check) */}
                  <div className="flex items-center gap-2 p-1 bg-[#262019]/[0.06] rounded-lg border border-[#262019]/15">
                    <button
                      type="button"
                      id="image-mode-bull-btn"
                      onClick={() => {
                        setImageInspectionMode('bull');
                        resetResult();
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                        imageInspectionMode === 'bull'
                          ? 'bg-[#14213D] text-[#F1E9D2] shadow-xs'
                          : 'text-[#262019]/70 hover:text-[#262019]'
                      }`}
                    >
                      <span>🎯</span>
                      <span>Bull vs. Legit (Chart/Claim)</span>
                    </button>
                    <button
                      type="button"
                      id="image-mode-ai-btn"
                      onClick={() => {
                        setImageInspectionMode('ai');
                        resetResult();
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                        imageInspectionMode === 'ai'
                          ? 'bg-[#14213D] text-[#F1E9D2] shadow-xs'
                          : 'text-[#262019]/70 hover:text-[#262019]'
                      }`}
                    >
                      <span>🤖</span>
                      <span>AI vs. Real (Deepfake)</span>
                    </button>
                  </div>

                  <p className="text-[11px] text-[#262019]/65 text-center max-w-[440px] leading-tight">
                    {imageInspectionMode === 'bull'
                      ? 'BULL inspects whether this slide chart, metric, mockup, or graphic is substantively honest or misleading hype (regardless of whether it was made with AI or human design).'
                      : 'BULL inspects visual artifacts, pixel distortion, and synthetic textures to assess if the photo is AI-generated.'}
                  </p>
                </div>
              )}

              {/* Extraction & Guidance Notes */}
              {extractNote && (
                <div id="extract-note" className="text-xs text-[#262019]/60 mt-2 italic min-h-4">
                  {extractNote}
                </div>
              )}

              {/* Embedded Presentation Images Carousel / Picker */}
              {presentationImages.length > 0 && (
                <div id="presentation-images-strip" className="mt-3 p-3 bg-[#262019]/[0.04] border border-[#262019]/15 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#14213D] flex items-center gap-1.5">
                      🖼️ Presentation Slide Graphics & Charts ({presentationImages.length} found):
                    </span>
                    <span className="text-[11px] text-[#262019]/60">
                      Click any graphic to audit Bull vs. Legit
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 overflow-x-auto py-1">
                    {presentationImages.map((img, idx) => {
                      const isSelected = pendingImage?.name === img.name;
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setPendingImage(null);
                              setCurrentMode('text');
                              resetResult();
                            } else {
                              setPendingImage({
                                base64: img.base64,
                                mediaType: img.mediaType,
                                name: img.name,
                                previewUrl: img.previewUrl,
                                isPresentationGraphic: true,
                              });
                              setImageInspectionMode('bull');
                              setCurrentMode('image');
                              resetResult();
                            }
                          }}
                          className={`flex-shrink-0 group relative rounded-lg border-2 overflow-hidden transition-all cursor-pointer p-0.5 ${
                            isSelected
                              ? 'border-[#9E2B25] ring-2 ring-[#9E2B25]/30 bg-white shadow-md'
                              : 'border-[#262019]/25 hover:border-[#14213D] bg-white/70'
                          }`}
                        >
                          <img
                            src={img.previewUrl}
                            alt={img.name}
                            className="w-16 h-16 object-cover rounded"
                          />
                          <div className="absolute inset-x-0 bottom-0 bg-[#262019]/80 text-[#F1E9D2] text-[9.5px] px-1 py-0.5 text-center truncate">
                            {isSelected ? '✓ Auditing' : `Slide ${img.slideNumber || idx + 1}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {pendingImage && (
                    <div className="flex items-center justify-between text-[11px] text-[#14213D] pt-1">
                      <span>Currently auditing graphic: <strong>{pendingImage.name}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingImage(null);
                          setCurrentMode('text');
                          resetResult();
                        }}
                        className="text-[#9E2B25] hover:underline font-semibold cursor-pointer"
                      >
                        Switch back to slide claims text
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div
                id="google-docs-help-note"
                className="text-[11.5px] text-[#262019]/50 mt-1 leading-snug"
              >
                From Google Slides or Docs: File &rarr; Download &rarr; PowerPoint (.pptx) or PDF, then upload that here. Images: a fun gut-check, not a forensic detector.
              </div>

              {/* Reveal Mode Toggle */}
              <div
                id="reveal-mode-container"
                className="mt-4 pt-3.5 border-t border-dashed border-[#262019]/15"
              >
                <label className="flex items-center gap-2 text-[13.5px] text-[#262019]/75 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    id="reveal-mode-toggle"
                    checked={revealMode}
                    onChange={(e) => {
                      setRevealMode(e.target.checked);
                      setCrowdGuessIsHigh(null);
                      setCrowdNote(null);
                    }}
                    className="w-4 h-4 accent-[#3F6B4A] rounded cursor-pointer"
                  />
                  Reveal mode — let the room guess before BULL does
                </label>
              </div>

              {/* Crowd Guess Buttons (when Reveal Mode is active) */}
              {revealMode && (
                <div
                  id="crowd-guess-row"
                  className="flex items-center justify-center gap-2.5 mt-3.5 transition-all"
                >
                  <span className="text-xs text-[#262019]/60 font-medium">Room says:</span>
                  <button
                    type="button"
                    id="crowd-guess-legit-btn"
                    onClick={() => setCrowdGuessIsHigh(false)}
                    className={`font-sans-body font-semibold text-xs tracking-wide px-4 py-1.5 rounded-full border-[1.5px] border-[#262019] cursor-pointer transition-all ${
                      crowdGuessIsHigh === false
                        ? 'bg-[#262019] text-[#F1E9D2]'
                        : 'bg-transparent text-[#262019] hover:bg-[#262019]/[0.06]'
                    }`}
                  >
                    {leftLabel}
                  </button>
                  <button
                    type="button"
                    id="crowd-guess-bull-btn"
                    onClick={() => setCrowdGuessIsHigh(true)}
                    className={`font-sans-body font-semibold text-xs tracking-wide px-4 py-1.5 rounded-full border-[1.5px] border-[#262019] cursor-pointer transition-all ${
                      crowdGuessIsHigh === true
                        ? 'bg-[#262019] text-[#F1E9D2]'
                        : 'bg-transparent text-[#262019] hover:bg-[#262019]/[0.06]'
                    }`}
                  >
                    {rightLabel}
                  </button>
                </div>
              )}

              {/* Judge Action Button */}
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  id="judge-button"
                  onClick={handleJudge}
                  disabled={isJudging}
                  className="font-serif-display font-bold text-lg tracking-wide text-[#F1E9D2] bg-[#14213D] hover:bg-[#0B1526] active:translate-y-px hover:-translate-y-0.5 rounded-full px-10 py-3.5 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed transition-all focus-visible:outline-3 focus-visible:outline-[#C9A227] focus-visible:outline-offset-2 flex items-center gap-2"
                >
                  {isJudging
                    ? personaMode === 'enterprise'
                      ? 'Auditing...'
                      : 'Calling It...'
                    : personaMode === 'enterprise'
                    ? '🛡️ Audit Deliverable'
                    : 'Judge it'}
                </button>
              </div>

              {/* Crowd Outcome Note */}
              {crowdNote && (
                <div
                  id="crowd-note-feedback"
                  className={`text-center text-[13.5px] mt-2.5 min-h-[18px] font-semibold ${
                    crowdNote.isMatch ? 'text-[#3F6B4A]' : 'text-[#9E2B25]'
                  }`}
                >
                  {crowdNote.text}
                </div>
              )}

              {/* Gauge Readout & Verdict */}
              <Gauge
                percentage={gaugePercentage}
                leftLabel={leftLabel}
                rightLabel={rightLabel}
                result={currentResult}
                statusText={statusMessage}
                isImageMode={currentMode === 'image'}
              />

              {/* Enhanced Details: Slack Card Export, Safe Phrasing, Multi-Claim Breakdown, Interactive Appeal */}
              {currentResult && (
                <VerdictTicketDetails
                  result={currentResult}
                  isImageMode={currentMode === 'image'}
                  imageInspectionMode={imageInspectionMode}
                  personaMode={personaMode}
                  onAppealSubmitted={handleAppealSubmitted}
                  isAppealing={isAppealing}
                />
              )}
            </div>

            {/* History Section Header & Combined Export */}
            {(claimHistory.length > 0 || imageHistory.length > 0) && (
              <div className="mt-8 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#F1E9D2]/80">
                      Referee Session History
                    </h3>
                    <p className="text-[11px] text-[#F1E9D2]/45">
                      {claimHistory.length + imageHistory.length} total rulings recorded in this session
                    </p>
                  </div>
                  {(filteredClaimHistory.length > 0 || filteredImageHistory.length > 0) && (
                    <button
                      type="button"
                      onClick={() => exportCombinedHistoryToCSV(filteredClaimHistory, filteredImageHistory)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#14213D] bg-[#C9A227] hover:bg-[#dcb535] transition-all cursor-pointer shadow-sm hover:shadow-md"
                      title="Export all matching records to a CSV spreadsheet"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>
                        {historySearchQuery.trim() || historyFilterType !== 'all'
                          ? `Export Filtered (${filteredClaimHistory.length + filteredImageHistory.length}) CSV`
                          : 'Export All (CSV)'}
                      </span>
                    </button>
                  )}
                </div>

                {/* History Search Bar & Quick Filter Chips */}
                <div className="bg-[#14213D]/30 border border-[#F1E9D2]/15 rounded-xl p-3 backdrop-blur-xs space-y-2.5">
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 text-[#F1E9D2]/40 absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      value={historySearchQuery}
                      onChange={(e) => setHistorySearchQuery(e.target.value)}
                      placeholder="Search past judged claims, images, verdicts, flaws, dates..."
                      className="w-full bg-[#262019]/40 border border-[#F1E9D2]/15 rounded-lg pl-9 pr-8 py-2 text-xs text-[#F1E9D2] placeholder-[#F1E9D2]/35 focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227] transition-all font-sans-body"
                    />
                    {historySearchQuery && (
                      <button
                        type="button"
                        onClick={() => setHistorySearchQuery('')}
                        className="absolute right-2.5 p-1 rounded-md text-[#F1E9D2]/40 hover:text-[#F1E9D2] hover:bg-[#F1E9D2]/10 transition-colors cursor-pointer"
                        title="Clear search filter"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filter Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-[#F1E9D2]/40 font-semibold uppercase tracking-wider mr-1">
                      Filter:
                    </span>
                    {(
                      [
                        { id: 'all', label: `All (${claimHistory.length + imageHistory.length})` },
                        { id: 'claims', label: `Claims (${claimHistory.length})` },
                        { id: 'images', label: `Images (${imageHistory.length})` },
                        { id: 'bull', label: 'BULL (≥50%)' },
                        { id: 'legit', label: 'Legit (<50%)' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setHistoryFilterType(f.id)}
                        className={`text-[11px] px-2.5 py-0.5 rounded-md font-medium transition-all cursor-pointer border ${
                          historyFilterType === f.id
                            ? 'bg-[#C9A227] text-[#14213D] border-[#C9A227] shadow-xs'
                            : 'bg-[#F1E9D2]/5 text-[#F1E9D2]/60 hover:text-[#F1E9D2] border-[#F1E9D2]/10'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Live Search Stats / Clear helper */}
                  {(historySearchQuery.trim() || historyFilterType !== 'all') && (
                    <div className="flex items-center justify-between text-[11px] text-[#F1E9D2]/50 pt-1 border-t border-[#F1E9D2]/10">
                      <span>
                        Showing{' '}
                        <strong className="text-[#C9A227]">
                          {filteredClaimHistory.length + filteredImageHistory.length}
                        </strong>{' '}
                        of {claimHistory.length + imageHistory.length} past rulings
                        {historySearchQuery.trim() && (
                          <> for &ldquo;{historySearchQuery}&rdquo;</>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setHistorySearchQuery('');
                          setHistoryFilterType('all');
                        }}
                        className="text-[#C9A227] hover:underline cursor-pointer font-medium"
                      >
                        Reset filters
                      </button>
                    </div>
                  )}
                </div>

                {/* Empty Search Result State */}
                {historySearchQuery.trim() &&
                  filteredClaimHistory.length === 0 &&
                  filteredImageHistory.length === 0 && (
                    <div className="text-center py-6 px-4 bg-[#14213D]/20 border border-dashed border-[#F1E9D2]/15 rounded-xl">
                      <p className="text-xs text-[#F1E9D2]/60">
                        No past judged claims or images match &ldquo;{historySearchQuery}&rdquo;
                      </p>
                      <button
                        type="button"
                        onClick={() => setHistorySearchQuery('')}
                        className="mt-2 text-xs font-semibold text-[#C9A227] hover:underline cursor-pointer"
                      >
                        Clear search query
                      </button>
                    </div>
                  )}
              </div>
            )}

            {/* History Lists */}
            <HistoryList
              title="Claims judged"
              items={filteredClaimHistory}
              totalUnfilteredCount={claimHistory.length}
              searchQuery={historySearchQuery}
              onClear={() => setClaimHistory([])}
            />

            <HistoryList
              title="Images judged"
              items={filteredImageHistory}
              totalUnfilteredCount={imageHistory.length}
              searchQuery={historySearchQuery}
              onClear={() => setImageHistory([])}
            />
          </div>
        )}

        {/* VIEW 2: Slack Channel Wire */}
        {activeTab === 'slack' && (
          <SlackFeed onJudgeClaimInTicket={handleTransferClaimFromSlack} />
        )}
      </div>
    </div>
  );
}
