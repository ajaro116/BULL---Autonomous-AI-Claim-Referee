export interface BulletClaimResult {
  bullet: string;
  bull_percentage: number;
  verdict: string;
  flaw_type: string;
}

export interface JudgmentResult {
  targeted_claim?: string;
  bull_percentage: number;
  verdict: string;
  flaw_type: string;
  explanation: string;
  safe_rewrite?: string;
  bullet_breakdown?: BulletClaimResult[];
  appeal_response?: string;
  is_appealed?: boolean;
}

export interface HistoryEntry {
  id: string;
  claim: string;
  pct: number;
  isHigh: boolean;
  date: string;
  timestamp?: string;
  verdict?: string;
  flawType?: string;
  explanation?: string;
  safeRewrite?: string;
  type?: 'claim' | 'image';
}

export interface PresentationImage {
  id: string;
  name: string;
  slideNumber?: number;
  previewUrl: string;
  base64: string;
  mediaType: string;
}

export interface ExtractedPresentation {
  text: string;
  images: PresentationImage[];
}

export type ImageInspectionMode = 'bull' | 'ai';

export interface PendingImage {
  base64: string;
  mediaType: string;
  name: string;
  previewUrl: string;
  isPresentationGraphic?: boolean;
  slideNumber?: number;
}

export type JudgeMode = 'text' | 'image';

export interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  num_members?: number;
  topic?: string;
  isReal?: boolean;
  isDemo?: boolean;
  is_member?: boolean;
}

export interface SlackMessage {
  id: string;
  user: string;
  text: string;
  ts: string;
  timeFormatted?: string;
  avatar?: string;
  judged?: boolean;
  verdict?: JudgmentResult;
  isBot?: boolean;
  isDemo?: boolean;
}

export interface SlackConnectionStatus {
  connected: boolean;
  teamName?: string;
  user?: string;
  isDemoMode?: boolean;
  slackApiError?: string;
  slackNeededScope?: string;
  realChannelCount?: number;
  hasOAuthCreds?: boolean;
}

export type AppViewTab = 'personal' | 'slack';
