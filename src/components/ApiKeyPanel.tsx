import React, { useState, useEffect } from 'react';

interface ApiKeyPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onKeySaved: (key: string, provider: string) => void;
  hasStoredKey: boolean;
}

export const ApiKeyPanel: React.FC<ApiKeyPanelProps> = ({
  isOpen,
  onToggle,
  onKeySaved,
  hasStoredKey,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('gemini-studio');
  const [note, setNote] = useState(
    'Stored only in this browser. Treat it like a password — don\'t share this file with the key filled in.'
  );

  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('bull_api_key');
      const storedProvider = localStorage.getItem('bull_api_provider');
      if (storedKey) {
        setApiKey(storedKey);
        setNote('Using a saved key from this browser.');
      }
      if (storedProvider) {
        setProvider(storedProvider);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleInputChange = (val: string) => {
    setApiKey(val);
    const trimmed = val.trim();
    if (trimmed.startsWith('sk-ant-')) {
      setProvider('claude');
    } else if (trimmed.startsWith('AIza')) {
      setProvider('gemini-studio');
    } else if (trimmed.startsWith('sk-') && !trimmed.startsWith('sk-ant-')) {
      setProvider('deepseek');
    }
  };

  const handleSave = () => {
    const trimmed = apiKey.trim();
    try {
      if (trimmed) {
        localStorage.setItem('bull_api_key', trimmed);
        localStorage.setItem('bull_api_provider', provider);
      } else {
        localStorage.removeItem('bull_api_key');
        localStorage.removeItem('bull_api_provider');
      }
    } catch {
      // ignore
    }

    onKeySaved(trimmed, provider);

    const providerLabels: Record<string, string> = {
      claude: 'Anthropic (Claude)',
      'gemini-studio': 'Google AI Studio (Gemini)',
      'gemini-enterprise': 'Gemini Enterprise / Vertex AI',
      deepseek: 'DeepSeek-R1 Reasoning Engine',
      'vertex-express': 'Google Cloud Agent Platform / Vertex AI',
    };

    setNote(
      trimmed
        ? `Key saved — requests will go to ${providerLabels[provider] || provider}.`
        : 'Key cleared — requests will rely on server environment keys.'
    );
  };

  const handleClear = () => {
    setApiKey('');
    try {
      localStorage.removeItem('bull_api_key');
      localStorage.removeItem('bull_api_provider');
    } catch {
      // ignore
    }
    onKeySaved('', provider);
    setNote('Key cleared.');
  };

  return (
    <div className="mb-4">
      <button
        type="button"
        id="apiKeyToggle"
        onClick={onToggle}
        className="block w-full text-left bg-transparent border-0 font-sans-body text-[11.5px] text-[#262019]/60 hover:text-[#262019]/90 cursor-pointer pb-2.5 underline decoration-[#262019]/25 transition-colors"
      >
        ⚙ AI Engine & API Provider Settings {hasStoredKey ? '(✓ custom key active)' : '(using server default)'}
      </button>

      {isOpen && (
        <div
          id="apiKeyPanel"
          className="mb-4 p-3.5 sm:p-4 rounded-lg bg-[#262019]/[0.04] border border-[#262019]/15 animate-fadeIn text-[#262019]"
        >
          <label
            htmlFor="apiProviderSelect"
            className="block text-xs text-[#262019]/70 mb-1 leading-normal"
          >
            Select Reasoning Engine / Model Provider:
          </label>
          <select
            id="apiProviderSelect"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full font-sans-body text-[13.5px] p-2 border border-[#262019]/25 rounded-md bg-[#F1E9D2] text-[#262019] mt-1 outline-none focus:border-[#3F6B4A]"
          >
            <option value="gemini-studio">Google AI Studio — Gemini 3.8 Flash (Default / Ultra-fast, starts AIza...)</option>
            <option value="gemini-enterprise">Google Gemini Enterprise & Vertex AI (Zero-Retention Enterprise Privacy)</option>
            <option value="deepseek">DeepSeek-R1 (Deep Chain-of-Thought Reasoning Model, starts sk-...)</option>
            <option value="claude">Anthropic — Claude (sk-ant-...)</option>
            <option value="vertex-express">Google Cloud Agent Platform / Vertex AI (console.cloud.google.com)</option>
          </select>

          <label
            htmlFor="apiKeyInput"
            className="block text-xs text-[#262019]/70 mt-3 mb-1 leading-normal"
          >
            Custom API Key (optional — leave empty to use server default environment key)
          </label>
          <input
            type="password"
            id="apiKeyInput"
            value={apiKey}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            placeholder="Paste your key here (e.g. AIzaSy... or sk-ant-...)"
            className="w-full font-sans-body text-sm p-2 border border-[#262019]/25 rounded-md bg-[#F1E9D2] text-[#262019] mt-1 outline-none focus:border-[#3F6B4A]"
          />

          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              id="saveApiKeyBtn"
              onClick={handleSave}
              className="font-sans-body text-xs font-semibold px-3.5 py-1.5 rounded-full border-[1.5px] border-[#262019] bg-[#262019] text-[#F1E9D2] hover:opacity-85 cursor-pointer transition-opacity"
            >
              Save key
            </button>
            <button
              type="button"
              id="clearApiKeyBtn"
              onClick={handleClear}
              className="font-sans-body text-xs font-semibold px-3.5 py-1.5 rounded-full border-[1.5px] border-[#262019] bg-transparent text-[#262019] hover:bg-[#262019]/[0.05] cursor-pointer transition-colors"
            >
              Clear
            </button>
          </div>

          <div id="apiKeyNote" className="text-[11.5px] text-[#262019]/70 mt-2.5 leading-relaxed bg-[#262019]/[0.03] p-2.5 rounded-lg border border-[#262019]/10">
            <div className="font-semibold text-[#14213D] mb-1">💡 Facing a 429 Quota Exceeded error?</div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#262019]/65">
              <li>
                <strong>Option A (Free Gemini Key):</strong> Create a fresh free API key at{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-[#9E2B25] hover:text-[#14213D]"
                >
                  aistudio.google.com/app/apikey
                </a>{' '}
                and paste it above.
              </li>
              <li>
                <strong>Option B (Switch Engine):</strong> Select Anthropic Claude (<code className="font-mono text-[10px]">sk-ant-...</code>) or DeepSeek (<code className="font-mono text-[10px]">sk-...</code>) in the dropdown.
              </li>
              <li>
                <strong>Option C (Built-in Referee Engine):</strong> Leave the input blank or click &ldquo;Clear&rdquo; — BULL automatically falls back to its built-in heuristic referee rules if external models hit rate limits.
              </li>
            </ul>
            <div className="mt-2 text-[10.5px] text-[#262019]/50 italic">{note}</div>
          </div>
        </div>
      )}
    </div>
  );
};
