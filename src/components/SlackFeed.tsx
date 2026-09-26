import React, { useState, useEffect } from 'react';
import {
  Hash,
  Send,
  RefreshCw,
  MessageSquare,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Key,
  Unlink,
  CheckCircle2,
  Copy,
  Check,
  PlusCircle,
  User,
  HelpCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SlackChannel, SlackMessage, JudgmentResult, SlackConnectionStatus } from '../types';

interface SlackFeedProps {
  onJudgeClaimInTicket: (claimText: string) => void;
}

export const SlackFeed: React.FC<SlackFeedProps> = ({ onJudgeClaimInTicket }) => {
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string>('');
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<SlackConnectionStatus>({
    connected: false,
  });
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isJoiningChannel, setIsJoiningChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelErrorDetail, setChannelErrorDetail] = useState<string | null>(null);

  // In-line judging state per message
  const [judgingMessageId, setJudgingMessageId] = useState<string | null>(null);
  const [messageVerdicts, setMessageVerdicts] = useState<Record<string, JudgmentResult>>({});
  const [postingVerdictId, setPostingVerdictId] = useState<string | null>(null);
  const [postedSuccessId, setPostedSuccessId] = useState<string | null>(null);

  // Connect dialog state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [botTokenInput, setBotTokenInput] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connectWarning, setConnectWarning] = useState('');
  const [isConnectingToken, setIsConnectingToken] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  // Fetch status and channels on mount
  useEffect(() => {
    fetchSlackStatus();
    fetchChannels();

    // Listen for OAuth postMessage popup event
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchSlackStatus();
        fetchChannels();
        setShowConnectModal(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fetch messages when active channel changes
  useEffect(() => {
    if (activeChannelId) {
      fetchMessages(activeChannelId);
    }
  }, [activeChannelId]);

  const fetchSlackStatus = async () => {
    try {
      const res = await fetch('/api/slack/status');
      const data = await res.json();
      setConnectionStatus({
        connected: data.connected,
        teamName: data.teamName,
        user: data.user,
        isDemoMode: !data.connected,
        hasOAuthCreds: data.hasOAuthCreds,
      });
      if (data.callbackUrl) {
        setCallbackUrl(data.callbackUrl);
      }
    } catch (e) {
      console.error('Failed to fetch Slack status:', e);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await fetch('/api/slack/channels');
      const data = await res.json();
      if (Array.isArray(data.channels) && data.channels.length > 0) {
        setChannels(data.channels);

        // If real channels exist, prioritize switching to the first real channel
        const realChannels = data.channels.filter((c: SlackChannel) => c.isReal);
        if (realChannels.length > 0) {
          if (
            !activeChannelId ||
            activeChannelId === 'C_BS_FANTASY' ||
            activeChannelId === 'bs-fantasy-football-demo'
          ) {
            setActiveChannelId(realChannels[0].id);
          }
        } else if (!activeChannelId) {
          setActiveChannelId(data.channels[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to fetch channels:', e);
    }
  };

  const fetchMessages = async (channelId: string) => {
    setIsLoadingMessages(true);
    setChannelError(null);
    setChannelErrorDetail(null);
    try {
      const res = await fetch(`/api/slack/channels/${encodeURIComponent(channelId)}/messages`);
      const data = await res.json();

      if (data.error) {
        setChannelError(data.error);
        setChannelErrorDetail(data.errorDetail || `Slack error: ${data.error}`);
        setMessages([]);
      } else if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
    } catch (e: any) {
      console.error('Failed to fetch messages:', e);
      setChannelError('network_error');
      setChannelErrorDetail(e.message || 'Failed to fetch channel history.');
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleAutoJoinChannel = async () => {
    if (!activeChannelId) return;
    setIsJoiningChannel(true);
    try {
      const res = await fetch(`/api/slack/channels/${encodeURIComponent(activeChannelId)}/join`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setChannelError(null);
        setChannelErrorDetail(null);
        await fetchMessages(activeChannelId);
        await fetchChannels();
      } else {
        alert(
          data.error === 'method_not_supported_for_channel_type'
            ? 'This is a private channel. In Slack, invite BULL by typing /invite @bot in the channel.'
            : `Could not auto-join: ${data.error || 'Failed to join'}. In Slack, type /invite @bot in the channel.`
        );
      }
    } catch (err: any) {
      alert(err.message || 'Error auto-joining channel');
    } finally {
      setIsJoiningChannel(false);
    }
  };

  const handleOAuthConnect = async () => {
    setConnectError('');
    setConnectWarning('');
    try {
      const res = await fetch('/api/slack/auth/url');
      const data = await res.json();
      if (!res.ok || data.error) {
        setConnectError(
          data.error ||
            'SLACK_CLIENT_ID is not configured in .env. You can connect directly with a Bot Token below.'
        );
        return;
      }

      const authWindow = window.open(
        data.url,
        'slack_oauth_popup',
        'width=600,height=750,left=150,top=100'
      );

      if (!authWindow) {
        setConnectError('Please allow popups for this site to authorize Slack.');
      }
    } catch (err: any) {
      setConnectError(err.message || 'Failed to initiate Slack OAuth.');
    }
  };

  const handleTokenConnect = async () => {
    const cleanToken = botTokenInput.trim();
    if (!cleanToken) {
      setConnectError('Please paste your Slack Bot User OAuth Token (starts with xoxb-).');
      return;
    }

    if (cleanToken.startsWith('xapp-') || cleanToken.startsWith('xoxe.')) {
      setConnectError(
        '⚠️ You entered an App Configuration / App-Level Token. App Configuration tokens only manage manifests and CLI tooling, and cannot read channel chat. Please copy your "Bot User OAuth Token" (starts with xoxb-) from api.slack.com/apps > OAuth & Permissions.'
      );
      return;
    }

    setIsConnectingToken(true);
    setConnectError('');
    setConnectWarning('');
    try {
      const res = await fetch('/api/slack/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to verify token');
      }

      setConnectionStatus({
        connected: true,
        teamName: data.teamName,
        user: data.user,
        isDemoMode: false,
      });

      if (data.warning) {
        setConnectWarning(data.warning);
      } else {
        setShowConnectModal(false);
      }

      await fetchChannels();
      await fetchSlackStatus();
    } catch (e: any) {
      setConnectError(e.message || 'Invalid token or unable to connect.');
    } finally {
      setIsConnectingToken(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/slack/disconnect', { method: 'POST' });
      setConnectionStatus({ connected: false, isDemoMode: true });
      setActiveChannelId('C_BS_FANTASY');
      await fetchChannels();
      await fetchMessages('C_BS_FANTASY');
    } catch (e) {
      console.error('Failed to disconnect:', e);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newMessageText.trim() || isSendingMessage) return;

    setIsSendingMessage(true);
    try {
      const res = await fetch('/api/slack/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: activeChannelId,
          text: newMessageText.trim(),
          user: connectionStatus.user || 'You',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewMessageText('');
        fetchMessages(activeChannelId);
      } else {
        alert(`Failed to post message: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Error sending message:', e);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Judge a specific message inline via BULL
  const handleJudgeInline = async (msg: SlackMessage) => {
    setJudgingMessageId(msg.id);
    try {
      const storedKey = localStorage.getItem('bull_api_key');
      const storedProvider = localStorage.getItem('bull_api_provider');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storedKey) headers['x-api-key'] = storedKey;
      if (storedProvider) headers['x-api-provider'] = storedProvider;

      const res = await fetch('/api/judge-claim', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: msg.text }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Judging failed');
      }

      setMessageVerdicts((prev) => ({
        ...prev,
        [msg.id]: data,
      }));
    } catch (err: any) {
      console.error('Judge inline error:', err);
      alert(`BULL referee error: ${err.message || 'Could not judge message'}`);
    } finally {
      setJudgingMessageId(null);
    }
  };

  // Post the verdict back to Slack channel
  const handlePostVerdict = async (msg: SlackMessage, verdict: JudgmentResult) => {
    setPostingVerdictId(msg.id);
    try {
      const res = await fetch('/api/slack/post-verdict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: activeChannelId,
          messageId: msg.id,
          claim: msg.text,
          verdict: verdict.verdict,
          pct: verdict.bull_percentage,
          flawType: verdict.flaw_type,
          explanation: verdict.explanation,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPostedSuccessId(msg.id);
        setTimeout(() => setPostedSuccessId(null), 4000);
        fetchMessages(activeChannelId);
      } else {
        alert(`Could not post verdict to Slack: ${data.error || 'Check bot permissions'}`);
      }
    } catch (e) {
      console.error('Failed to post verdict:', e);
    } finally {
      setPostingVerdictId(null);
    }
  };

  const realChannels = channels.filter((c) => c.isReal);
  const demoChannels = channels.filter((c) => !c.isReal || c.isDemo);

  const currentChannel =
    channels.find((c) => c.id === activeChannelId) ||
    realChannels[0] ||
    demoChannels[0] || {
      id: 'C_BS_FANTASY',
      name: 'bs-fantasy-football-demo',
      topic: 'Offline simulation demo',
      isDemo: true,
    };

  const isCurrentChannelDemo = !currentChannel.isReal || currentChannel.isDemo || currentChannel.id === 'C_BS_FANTASY';

  const copyCallbackToClipboard = () => {
    if (!callbackUrl) return;
    navigator.clipboard.writeText(callbackUrl);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Slack Connection Bar */}
      <div className="p-3.5 rounded-xl bg-[#F8F5EC] border border-[#262019]/25 shadow-sm flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              connectionStatus.connected ? 'bg-[#3F6B4A] animate-pulse ring-4 ring-[#3F6B4A]/20' : 'bg-[#C9A227] ring-4 ring-[#C9A227]/25'
            }`}
          />
          <div className="font-sans-body">
            {connectionStatus.connected ? (
              <span className="text-[#262019] font-bold text-[13px]">
                Connected to{' '}
                <strong className="text-[#14213D] underline">{connectionStatus.teamName}</strong>{' '}
                <span className="text-[#262019]/70 font-normal">({connectionStatus.user})</span>
                {realChannels.length > 0 && (
                  <span className="ml-2 bg-[#3F6B4A] text-[#F1E9D2] font-black px-2 py-0.5 rounded-full text-[10.5px]">
                    {realChannels.length} Live Channel{realChannels.length === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[#262019] font-medium text-[13px] flex items-center flex-wrap gap-1.5">
                <span className="bg-[#14213D] text-[#F1E9D2] font-black px-2 py-0.5 rounded text-[11px] uppercase tracking-wider">
                  Offline Simulator
                </span>
                <span className="text-[#262019]/80 font-medium">
                  Showing demo claims for
                </span>
                <code className="bg-[#F1E9D2] text-[#14213D] border border-[#262019]/25 px-2 py-0.5 rounded-md font-mono font-bold text-xs">
                  #bs-fantasy-football
                </code>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {connectionStatus.connected ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConnectError('');
                  setConnectWarning('');
                  setShowConnectModal(true);
                }}
                className="text-[#14213D] hover:underline font-semibold cursor-pointer text-xs"
              >
                Update Token
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-[#9E2B25] hover:text-[#7D221D] flex items-center gap-1 font-semibold cursor-pointer text-xs ml-2"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConnectError('');
                setConnectWarning('');
                setShowConnectModal(true);
              }}
              className="bg-[#14213D] text-[#F1E9D2] hover:bg-[#0B1526] px-3.5 py-1.5 rounded-full font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
            >
              <Key className="w-3.5 h-3.5" />
              Connect Real Slack
            </button>
          )}
        </div>
      </div>

      {/* Short, Sweet & Genuine: How Slack Wire Works */}
      <div className="p-4 rounded-xl bg-[#F8F5EC] border border-[#262019]/25 shadow-xs transition-all">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-[#14213D] text-[#F1E9D2] flex items-center justify-center text-xs font-serif-display font-bold shadow-xs">
              ⚡
            </span>
            <div>
              <h4 className="font-serif-display font-bold text-sm text-[#262019] m-0 flex items-center gap-2">
                How Slack Wire Works
                <span className="bg-[#3F6B4A]/15 text-[#3F6B4A] border border-[#3F6B4A]/30 text-[10px] font-sans-body font-bold px-2 py-0.5 rounded-full">
                  Zero Spam
                </span>
              </h4>
              <p className="text-[11.5px] text-[#262019]/70 m-0">
                BULL only monitors channels you invite it to and never posts without your command.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="text-[#262019]/60 hover:text-[#262019] text-xs font-semibold flex items-center gap-1 cursor-pointer px-2 py-1 rounded hover:bg-[#262019]/5 transition-colors"
          >
            {showHowItWorks ? (
              <>
                <span>Hide</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Show Guide</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>

        {showHowItWorks && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3.5 pt-3 border-t border-[#262019]/15">
            {/* Step 1 */}
            <div className="p-3 rounded-lg bg-[#F1E9D2]/70 border border-[#262019]/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-xs text-[#14213D] mb-1.5">
                  <span className="w-4 h-4 rounded-full bg-[#14213D] text-[#F1E9D2] flex items-center justify-center text-[10px] font-mono">
                    1
                  </span>
                  Invite to any channel
                </div>
                <p className="text-[11.5px] text-[#262019]/80 leading-relaxed m-0">
                  In your Slack app, go to any channel (fantasy, general, debates) and type:
                </p>
                <div className="mt-1.5 bg-[#262019]/10 rounded px-2 py-1 font-mono text-[11px] font-bold text-[#14213D] inline-block">
                  /invite @BULL
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="p-3 rounded-lg bg-[#F1E9D2]/70 border border-[#262019]/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-xs text-[#14213D] mb-1.5">
                  <span className="w-4 h-4 rounded-full bg-[#14213D] text-[#F1E9D2] flex items-center justify-center text-[10px] font-mono">
                    2
                  </span>
                  Catch wild claims live
                </div>
                <p className="text-[11.5px] text-[#262019]/80 leading-relaxed m-0">
                  Select your invited channel from the dropdown above. Real-time messages, trade rumors, and hot takes flow into your feed.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-3 rounded-lg bg-[#F1E9D2]/70 border border-[#262019]/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-xs text-[#3F6B4A] mb-1.5">
                  <span className="w-4 h-4 rounded-full bg-[#3F6B4A] text-[#F1E9D2] flex items-center justify-center text-[10px] font-mono">
                    3
                  </span>
                  Call BULL in 1 click
                </div>
                <p className="text-[11.5px] text-[#262019]/80 leading-relaxed m-0">
                  Click <strong>Judge Claim</strong> on any message. BULL pulls live web facts, grades the delusion score, and can post the official referee card right back to Slack!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Demo Channel Notice Banner */}
      {isCurrentChannelDemo && connectionStatus.connected && realChannels.length > 0 && (
        <div className="p-3 rounded-xl bg-[#E4C465]/20 border border-[#E4C465]/50 flex items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2 text-[#262019]">
            <AlertTriangle className="w-4 h-4 text-[#9E2B25] shrink-0" />
            <span>
              You are currently viewing the <strong>Offline Demo simulation</strong>. Select one of your real workspace channels (e.g.{' '}
              <strong>#{realChannels[0]?.name}</strong>) to see real claims.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveChannelId(realChannels[0].id)}
            className="px-3 py-1 rounded-full bg-[#14213D] text-[#F1E9D2] font-semibold text-[11px] shrink-0 hover:bg-[#0B1526] cursor-pointer"
          >
            Switch to #{realChannels[0]?.name}
          </button>
        </div>
      )}

      {/* Channel Header and Selector */}
      <div className="ticket-container p-4 sm:p-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#262019]/15 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="bg-[#262019]/10 p-1.5 rounded-lg text-[#14213D]">
              <Hash className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif-display font-bold text-lg text-[#262019] m-0">
                  {currentChannel.name}
                </h3>
                {isCurrentChannelDemo ? (
                  <span className="bg-[#E4C465]/30 text-[#262019] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#262019]/20 uppercase tracking-wider">
                    🏈 Offline Demo
                  </span>
                ) : (
                  <span className="bg-[#3F6B4A]/15 text-[#3F6B4A] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#3F6B4A]/30 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3F6B4A]" />
                    Live Slack
                  </span>
                )}
              </div>
              <p className="text-xs text-[#262019]/65 m-0 mt-0.5">
                {currentChannel.topic ||
                  (isCurrentChannelDemo
                    ? 'Simulated fantasy hot takes & trade delusion'
                    : 'Live workspace channel claims')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={activeChannelId}
              onChange={(e) => setActiveChannelId(e.target.value)}
              className="font-sans-body text-xs py-1.5 px-3 rounded-md border border-[#262019]/25 bg-[#F1E9D2] text-[#262019] outline-none font-medium cursor-pointer"
            >
              {realChannels.length > 0 && (
                <optgroup label={`🏢 ${connectionStatus.teamName || 'Workspace'} Channels`}>
                  {realChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name} {c.is_member ? '★ (Bot in channel)' : ''} {c.is_private ? '🔒' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="🏈 Offline Simulations">
                {demoChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name} (Demo Claims)
                  </option>
                ))}
              </optgroup>
            </select>

            <button
              type="button"
              onClick={() => {
                fetchMessages(activeChannelId);
                fetchChannels();
              }}
              disabled={isLoadingMessages}
              title="Refresh messages and channels"
              className="p-1.5 rounded-md hover:bg-[#262019]/10 text-[#262019]/70 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingMessages ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Channel Error / Bot Not In Channel Banner */}
        {channelError && (
          <div className="mt-4 p-4 rounded-xl bg-[#E4C465]/20 border border-[#262019]/20 text-xs space-y-2.5 text-[#262019]">
            <div className="flex items-center gap-2 font-bold text-sm text-[#14213D]">
              <AlertTriangle className="w-4 h-4 text-[#9E2B25]" />
              {channelError === 'not_in_channel'
                ? `BULL Bot is not in #${currentChannel.name} yet`
                : channelError === 'missing_scope'
                ? 'Missing Slack Token Permission'
                : 'Slack Channel Notice'}
            </div>
            <p className="text-xs leading-relaxed text-[#262019]/85 m-0">
              {channelErrorDetail}
            </p>

            {channelError === 'not_in_channel' && (
              <div className="pt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAutoJoinChannel}
                  disabled={isJoiningChannel}
                  className="px-3.5 py-1.5 bg-[#14213D] text-[#F1E9D2] font-semibold text-xs rounded-lg hover:bg-[#0B1526] cursor-pointer disabled:opacity-50"
                >
                  {isJoiningChannel ? 'Joining...' : '⚡ Auto-Join Public Channel'}
                </button>
                <span className="text-[11px] text-[#262019]/60">
                  Or in Slack, type <code>/invite @bot</code> in this channel.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Message Stream */}
        <div className="mt-4 space-y-3 max-h-[480px] overflow-y-auto pr-1">
          {isLoadingMessages ? (
            <div className="text-center py-10 text-xs text-[#262019]/60 flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#14213D]" />
              <span>Fetching live claims from #{currentChannel.name}...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-xl bg-[#262019]/[0.02] border border-dashed border-[#262019]/20">
              <MessageSquare className="w-8 h-8 text-[#262019]/30 mx-auto mb-2" />
              <p className="font-serif-display font-bold text-sm text-[#262019] m-0">
                No claims in #{currentChannel.name} yet
              </p>
              <p className="text-xs text-[#262019]/60 m-0 mt-1">
                Post a questionable claim or hot take in Slack, or drop one in the input below to referee it!
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isJudging = judgingMessageId === msg.id;
              const verdict = messageVerdicts[msg.id];
              const isPosting = postingVerdictId === msg.id;
              const isPosted = postedSuccessId === msg.id;
              const isBotMsg = msg.user.toLowerCase().includes('bull') || (msg as any).isBot;

              return (
                <div
                  key={msg.id}
                  className={`p-3.5 rounded-lg border transition-all ${
                    isBotMsg
                      ? 'bg-[#14213D]/[0.06] border-[#14213D]/25'
                      : 'bg-[#262019]/[0.025] hover:bg-[#262019]/[0.045] border-[#262019]/15'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      {msg.avatar ? (
                        <img
                          src={msg.avatar}
                          alt={msg.user}
                          className="w-5 h-5 rounded-full object-cover border border-[#262019]/20"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[#14213D]/10 flex items-center justify-center text-[10px] font-bold text-[#14213D]">
                          <User className="w-3 h-3" />
                        </div>
                      )}
                      <span className="font-bold text-[#14213D] flex items-center gap-1.5">
                        {isBotMsg && <ShieldCheck className="w-3.5 h-3.5 text-[#3F6B4A]" />}
                        {msg.user}
                      </span>
                    </div>
                    <span className="text-[#262019]/45 text-[11px]">
                      {msg.timeFormatted || 'today'}
                    </span>
                  </div>

                  <p className="text-[13.5px] text-[#262019] leading-snug font-sans-body break-words mb-2.5 pl-7">
                    {msg.text}
                  </p>

                  {/* Verdict Display (if judged) */}
                  {verdict && (
                    <div className="mt-3 ml-2 sm:ml-7 p-3.5 rounded-xl bg-[#F8F5EC] border-2 border-[#14213D] shadow-md text-xs space-y-2 animate-fadeIn">
                      <div className="flex items-center justify-between font-bold flex-wrap gap-1.5">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11.5px] font-black uppercase tracking-wider ${
                            verdict.bull_percentage >= 50
                              ? 'bg-[#9E2B25] text-white shadow-xs'
                              : 'bg-[#3F6B4A] text-white shadow-xs'
                          }`}
                        >
                          🐂 {verdict.bull_percentage}% BULL &middot; {verdict.verdict}
                        </span>
                        <span className="text-[#14213D] font-bold text-xs bg-[#14213D]/10 px-2 py-0.5 rounded-md">
                          {verdict.flaw_type}
                        </span>
                      </div>
                      <p className="text-[#262019] text-[13px] m-0 leading-relaxed font-sans-body">
                        {verdict.explanation}
                      </p>

                      {verdict.safe_rewrite && (
                        <div className="bg-[#3F6B4A]/10 border border-[#3F6B4A]/30 rounded-lg p-2 text-[12px] text-[#262019]">
                          <span className="font-bold text-[#3F6B4A] block mb-0.5">✅ Honest Wording:</span>
                          "{verdict.safe_rewrite}"
                        </div>
                      )}

                      <div className="pt-2 flex items-center justify-between border-t border-[#262019]/15 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPosting || isPosted}
                          onClick={() => handlePostVerdict(msg, verdict)}
                          className="px-3 py-1.5 bg-[#14213D] hover:bg-[#0B1526] text-[#F1E9D2] rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60 shadow-xs"
                        >
                          {isPosting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Posting to #{currentChannel.name}...
                            </>
                          ) : isPosted ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#3F6B4A]" />
                              Official Verdict Broadcasted!
                            </>
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5" />
                              Post Call into Channel
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onJudgeClaimInTicket(msg.text)}
                          className="font-sans-body text-xs font-semibold text-[#14213D] hover:text-black px-2.5 py-1.5 rounded-lg bg-[#262019]/[0.06] hover:bg-[#262019]/10 cursor-pointer flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open on Gauge
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Actions (if not yet judged) */}
                  {!verdict && !isBotMsg && (
                    <div className="flex items-center gap-3 pt-1 border-t border-[#262019]/10 pl-7">
                      <button
                        type="button"
                        disabled={isJudging}
                        onClick={() => handleJudgeInline(msg)}
                        className="font-sans-body text-[11.5px] font-bold text-[#9E2B25] hover:text-[#7D221D] cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {isJudging ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Ref Calling BULL...
                          </>
                        ) : (
                          <>
                            <span>🐂</span> Referee this Claim
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onJudgeClaimInTicket(msg.text)}
                        className="font-sans-body text-[11px] text-[#262019]/60 hover:text-[#262019] px-2 py-1 rounded hover:bg-[#262019]/10 cursor-pointer flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open in Full Referee Ticket
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Input box to test sending hot takes */}
        <form onSubmit={handleSendMessage} className="mt-4 pt-3 border-t border-[#262019]/15">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessageText}
              onChange={(e) => setNewMessageText(e.target.value)}
              placeholder={`Drop a claim or hot take into #${currentChannel.name}...`}
              className="flex-1 font-sans-body text-xs sm:text-sm p-2.5 rounded-lg border border-[#262019]/25 bg-[#F1E9D2] text-[#262019] outline-none focus:border-[#3F6B4A]"
            />
            <button
              type="submit"
              disabled={isSendingMessage || !newMessageText.trim()}
              className="px-4 py-2 bg-[#14213D] hover:bg-[#0B1526] text-[#F1E9D2] rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Post
            </button>
          </div>
        </form>
      </div>

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#F1E9D2] border-2 border-[#262019] rounded-2xl max-w-[540px] w-full p-6 shadow-2xl animate-fadeIn text-[#262019] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#262019]/20">
              <div className="flex items-center gap-2">
                <Hash className="w-5 h-5 text-[#14213D]" />
                <h3 className="font-serif-display font-bold text-xl m-0">Connect Slack</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="text-lg font-bold cursor-pointer text-[#262019]/60 hover:text-[#262019]"
              >
                &times;
              </button>
            </div>

            {/* Crucial Notice: App Config Token vs Bot User Token */}
            <div className="mt-4 p-3.5 rounded-xl bg-[#9E2B25]/10 border border-[#9E2B25]/30 text-xs space-y-1.5 text-[#262019]">
              <div className="font-bold text-[#9E2B25] flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Notice: Use Bot User OAuth Token, NOT App Configuration Token</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-[#262019]/80 m-0">
                Slack App Configuration Tokens (or App-Level tokens starting with <code>xapp-</code>) only manage app manifests and cannot read chat history.
              </p>
              <p className="text-[11.5px] leading-relaxed text-[#262019]/80 m-0">
                To pull real claims directly from your channels, copy your <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>):
              </p>
              <ol className="list-decimal pl-4 space-y-1 text-[11px] text-[#262019]/80 m-0 pt-1">
                <li>
                  Go to{' '}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold text-[#14213D]"
                  >
                    api.slack.com/apps
                  </a>{' '}
                  and select your App.
                </li>
                <li>
                  In the left menu, click <strong>OAuth & Permissions</strong>.
                </li>
                <li>
                  Under <strong>Bot Token Scopes</strong>, ensure you have: <code>channels:history</code>,{' '}
                  <code>channels:read</code>, and <code>chat:write</code>.
                </li>
                <li>
                  Scroll up and copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>).
                </li>
              </ol>
            </div>

            {connectError && (
              <div className="mt-3 p-3 rounded-lg bg-[#9E2B25]/15 border border-[#9E2B25]/30 text-[#9E2B25] text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-snug">{connectError}</span>
              </div>
            )}

            {connectWarning && (
              <div className="mt-3 p-3 rounded-lg bg-[#E4C465]/30 border border-[#262019]/20 text-[#262019] text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#3F6B4A] mt-0.5" />
                <span className="leading-snug">{connectWarning}</span>
              </div>
            )}

            {/* Option 1: Fast Bot Token */}
            <div className="mt-4 p-4 rounded-xl bg-[#262019]/[0.04] border border-[#262019]/15">
              <span className="block font-bold text-xs text-[#14213D] mb-1">
                Connect with Bot User OAuth Token (Recommended & Instant)
              </span>
              <p className="text-[11px] text-[#262019]/65 mb-2.5">
                Paste your Slack App&apos;s <code>xoxb-...</code> Bot User OAuth Token:
              </p>
              <input
                type="password"
                value={botTokenInput}
                onChange={(e) => setBotTokenInput(e.target.value)}
                placeholder="xoxb-your-slack-bot-token"
                className="w-full font-mono text-xs p-2.5 rounded-lg border border-[#262019]/25 bg-[#F1E9D2] outline-none mb-3 focus:border-[#3F6B4A]"
              />
              <button
                type="button"
                disabled={isConnectingToken || !botTokenInput.trim()}
                onClick={handleTokenConnect}
                className="w-full py-2.5 bg-[#14213D] text-[#F1E9D2] rounded-lg font-semibold text-xs hover:bg-[#0B1526] cursor-pointer disabled:opacity-50 transition-colors shadow-sm"
              >
                {isConnectingToken ? 'Verifying with Slack API...' : 'Connect & Read Real Channels'}
              </button>
            </div>

            {/* Option 2: OAuth 2.0 Flow */}
            <div className="mt-3 p-4 rounded-xl bg-[#262019]/[0.04] border border-[#262019]/15">
              <span className="block font-bold text-xs text-[#14213D] mb-1">
                Option 2: Connect via Slack OAuth v2
              </span>
              <p className="text-[11px] text-[#262019]/65 mb-2">
                Requires <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> in environment.
              </p>
              <button
                type="button"
                onClick={handleOAuthConnect}
                className="w-full py-2 bg-[#3F6B4A] text-[#F1E9D2] rounded-lg font-semibold text-xs hover:bg-[#32563B] cursor-pointer shadow-sm"
              >
                Open Slack OAuth Authorization
              </button>

              {callbackUrl && (
                <div className="mt-3 pt-2 border-t border-[#262019]/10">
                  <span className="text-[10px] text-[#262019]/60 block mb-1">
                    Your OAuth Redirect URL (add to your Slack App settings):
                  </span>
                  <div className="flex items-center gap-1 bg-[#262019]/10 p-1.5 rounded text-[11px] font-mono break-all select-all">
                    <span className="flex-1 truncate">{callbackUrl}</span>
                    <button
                      type="button"
                      onClick={copyCallbackToClipboard}
                      className="p-1 hover:bg-[#262019]/15 rounded cursor-pointer"
                      title="Copy Redirect URL"
                    >
                      {copiedCallback ? (
                        <Check className="w-3.5 h-3.5 text-[#3F6B4A]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[#262019]/70" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="text-xs font-semibold px-4 py-1.5 rounded-full border border-[#262019]/30 hover:bg-[#262019]/10 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
