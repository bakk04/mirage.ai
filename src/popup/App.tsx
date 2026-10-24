import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  Hand,
  Keyboard,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import {
  AirBrowseConfig,
  DEFAULT_CONFIG,
  MESSAGE_TYPES,
  loadConfig,
  loadGeminiApiKey,
  saveConfig,
  saveGeminiApiKey,
  RuntimeStatus,
} from '../core/config';

type View = 'control' | 'guide' | 'settings';

interface RuntimeResponse {
  success?: boolean;
  active?: boolean;
  error?: string;
}

type Compatibility =
  | { kind: 'ordinary'; message: string }
  | { kind: 'restricted'; message: string }
  | { kind: 'unknown'; message: string };

function getCompatibility(url?: string): Compatibility {
  if (!url) return { kind: 'unknown', message: 'The active tab URL is unavailable.' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { kind: 'ordinary', message: 'Air Control is ready for this website.' };
    }
    return { kind: 'restricted', message: 'Chrome restricts extensions on this browser page.' };
  } catch {
    return { kind: 'unknown', message: 'The active tab cannot be identified.' };
  }
}

const gestureGuide = [
  { icon: MousePointer2, title: 'Move', instruction: 'Point with your index finger.', action: 'Move the pointer' },
  { icon: Hand, title: 'Click', instruction: 'Pinch thumb and index, then release.', action: 'Activate the target' },
  { icon: ArrowUp, title: 'Scroll', instruction: 'Raise two fingers and move vertically.', action: 'Scroll the page' },
  { icon: RefreshCw, title: 'Refresh', instruction: 'Hold three fingers steadily.', action: 'Refresh the page' },
  { icon: ArrowUp, title: 'Zoom', instruction: 'Move four fingers up or down.', action: 'Zoom in or out' },
  { icon: Hand, title: 'Keyboard', instruction: 'Move an open five-finger hand sideways.', action: 'Toggle the virtual keyboard' },
  { icon: Keyboard, title: 'Type', instruction: 'Open the keyboard, point, then pinch.', action: 'Enter text in a focused field' },
];

export default function App() {
  const [view, setView] = useState<View>('control');
  const [config, setConfig] = useState<AirBrowseConfig>(DEFAULT_CONFIG);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [compatibility, setCompatibility] = useState<Compatibility>({
    kind: 'unknown',
    message: 'Checking the active page…',
  });
  const [geminiKey, setGeminiKey] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let statusPort: chrome.runtime.Port | null = null;
    Promise.all([loadConfig(), loadGeminiApiKey()])
      .then(([loaded, key]) => {
        setConfig(loaded);
        setGeminiKey(key);
      })
      .catch(() => {
        setRuntimeError('Unable to load AirBrowse settings. Default settings are active.');
      });
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const activeCompatibility = getCompatibility(tab?.url);
      setCompatibility(activeCompatibility);
      if (tab?.id !== undefined && activeCompatibility.kind === 'ordinary') {
        chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.GET_RUNTIME_STATUS })
          .then((status) => setRuntimeStatus(status as RuntimeStatus))
          .catch(() => setRuntimeStatus(null));
        try {
          statusPort = chrome.tabs.connect(tab.id, { name: 'airbrowse-runtime-status' });
          statusPort.onMessage.addListener((status: RuntimeStatus) => setRuntimeStatus(status));
          statusPort.onDisconnect.addListener(() => {
            statusPort = null;
          });
        } catch {
          statusPort = null;
        }
      }
    }).catch(() => {
      setCompatibility({ kind: 'unknown', message: 'The active tab cannot be identified.' });
    });
    return () => {
      statusPort?.disconnect();
      statusPort = null;
    };
  }, []);

  const sendConfig = async (nextConfig: AirBrowseConfig): Promise<RuntimeResponse> => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const tabId = tab?.id;
    if (tabId === undefined) {
      return { success: false, error: 'No active tab is available.' };
    }
    const compatibility = getCompatibility(tab.url);
    if (compatibility.kind === 'restricted') return { success: false, error: compatibility.message };
    if (compatibility.kind === 'unknown') return { success: false, error: compatibility.message };
    try {
      return (await chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.CONFIG_UPDATED,
        payload: nextConfig,
      })) as RuntimeResponse;
    } catch {
      return {
        success: false,
        error: 'Air Control could not connect to this page. Reload the tab and try again.',
      };
    }
  };

  const toggleControl = async () => {
    setIsStarting(true);
    setRuntimeError(null);
    try {
      const nextConfig = { ...config, isEnabled: !config.isEnabled };
      await saveConfig({ isEnabled: nextConfig.isEnabled });
      const response = await sendConfig(nextConfig);
      if (!response.success && nextConfig.isEnabled) {
        setRuntimeError(response.error ?? 'Unable to start camera control.');
        setConfig({ ...nextConfig, isEnabled: false });
        await saveConfig({ isEnabled: false });
      } else {
        setConfig(nextConfig);
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Unable to update Air Control.');
    }
    setIsStarting(false);
  };

  const updateSetting = async (updates: Partial<AirBrowseConfig>) => {
    try {
      const nextConfig = await saveConfig(updates);
      setConfig(nextConfig);
      if (nextConfig.isEnabled) {
        const response = await sendConfig(nextConfig);
        if (!response.success) setRuntimeError(response.error ?? 'Unable to update control settings.');
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'Unable to update control settings.');
    }
  };

  const toggleKeyboard = async () => {
    try {
      const tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabId === undefined) {
        setRuntimeError('No active tab is available.');
        return;
      }
      await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_KEYBOARD' });
    } catch {
      setRuntimeError('Start Air Control before opening the keyboard.');
    }
  };

  const summarizePage = async () => {
    setIsSummarizing(true);
    setSummary('');
    setSummaryError(null);
    try {
      if (!geminiKey.trim()) throw new Error('Enter a Gemini API key first.');
      await saveGeminiApiKey(geminiKey);
      const response = (await chrome.runtime.sendMessage({
        type: 'SUMMARIZE_PAGE',
        apiKey: geminiKey,
      })) as { success?: boolean; summary?: string; error?: string };
      if (!response.success || !response.summary) throw new Error(response.error ?? 'No summary was returned.');
      setSummary(response.summary);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSummarizing(false);
    }
  };

  const statusLabel = config.isEnabled ? 'Air control active' : 'Ready when you are';

  return (
    <div className="air-app">
      <header className="air-header">
        <div className="brand">
          <div className={`brand-mark ${config.isEnabled ? 'is-active' : ''}`}><Sparkles size={16} /></div>
          <div><strong>AirBrowse</strong><span>Natural browser control</span></div>
        </div>
        <button className={`power-button ${config.isEnabled ? 'is-active' : ''}`} onClick={toggleControl} disabled={isStarting} aria-label={config.isEnabled ? 'Stop air control' : 'Start air control'}>
          {config.isEnabled ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </header>

      <nav className="air-nav" aria-label="AirBrowse sections">
        {(['control', 'guide', 'settings'] as View[]).map((item) => (
          <button key={item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>
            {item === 'control' ? 'Control' : item === 'guide' ? 'Guide' : 'Settings'}
          </button>
        ))}
      </nav>

      <main className="air-main">
        {view === 'control' && (
          <>
            <section className={`control-hero ${config.isEnabled ? 'running' : ''}`}>
              <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
              <div className="hero-icon"><Activity size={25} /></div>
              <p className="eyebrow">{config.isEnabled ? 'LIVE SESSION' : 'AIR MOUSE'}</p>
              <h1>{statusLabel}</h1>
              <p className="hero-copy">{config.isEnabled ? 'Point with your index finger. Pinch to select.' : 'Move, click, and scroll without touching the page.'}</p>
              <button className="start-button" onClick={toggleControl} disabled={isStarting}>
                {isStarting ? 'Starting camera…' : config.isEnabled ? 'Stop air control' : 'Start air control'}
                <ChevronRight size={17} />
              </button>
            </section>

            <section className="status-row" aria-live="polite">
              <StatusDot active={runtimeStatus?.running ?? config.isEnabled} label={runtimeStatus?.running ? 'Camera and MediaPipe active' : 'Camera off'} />
              <StatusDot active={compatibility.kind === 'ordinary'} label={compatibility.message} muted={compatibility.kind !== 'ordinary'} />
            </section>

            {runtimeError && <div className="error-banner" role="alert"><X size={15} />{runtimeError}</div>}

            <section className="intelligence-panel" aria-label="Live Intelligence">
              <div className="intelligence-heading">
                <div>
                  <p className="eyebrow">LIVE INTELLIGENCE</p>
                  <h2>{runtimeStatus?.gesture ?? 'IDLE'}</h2>
                </div>
                <div className={`telemetry-badge ${runtimeStatus?.running ? 'is-live' : ''}`}>
                  <span />{runtimeStatus?.running ? 'LIVE' : 'OFF'}
                </div>
              </div>
              <div className="telemetry-grid">
                <Metric label="Hands" value={runtimeStatus ? String(runtimeStatus.hands) : '—'} />
                <Metric label="Inference" value={runtimeStatus?.inferenceMs != null ? `${runtimeStatus.inferenceMs.toFixed(1)} ms` : '—'} />
                <Metric label="Processing" value={runtimeStatus?.processingFps != null ? `${runtimeStatus.processingFps.toFixed(0)} fps` : '—'} />
                <Metric label="Landmarks" value={runtimeStatus?.landmarks ?? '—'} />
              </div>
              <div className="intelligence-footer">
                <span>{runtimeStatus?.lastCommand && runtimeStatus.lastCommand !== 'none' ? `${runtimeStatus.lastCommand} · ${runtimeStatus.commandResult}` : 'No command executed'}</span>
                <button className="diagnostics-toggle" onClick={() => setShowDiagnostics((value) => !value)} aria-expanded={showDiagnostics}>
                  {showDiagnostics ? 'Hide details' : 'Details'}
                </button>
              </div>
              {showDiagnostics && <div className="diagnostics-detail">
                <span>Model: MediaPipe Hand Landmarker 1.1.1</span>
                <span>Classifier: MIRAGE custom FSM</span>
                <span>Confidence: {runtimeStatus ? runtimeStatus.confidence.toFixed(2) : '—'} · Stability: {runtimeStatus?.stabilityFrames ?? '—'}</span>
                <span>FSM: {runtimeStatus?.fsmMs != null ? `${runtimeStatus.fsmMs.toFixed(3)} ms` : '—'} · Dispatch: {runtimeStatus?.commandDispatchMs != null ? `${runtimeStatus.commandDispatchMs.toFixed(1)} ms` : '—'}</span>
                {runtimeStatus?.error && <span className="inline-error">{runtimeStatus.error}</span>}
              </div>}
            </section>

            <div className="quick-actions">
              <button onClick={toggleKeyboard} disabled={!config.isEnabled}><Keyboard size={18} /><span>Open keyboard<small>Point and pinch to type</small></span><ChevronRight size={15} /></button>
              <button onClick={() => setView('guide')}><Hand size={18} /><span>Learn gestures<small>Five simple controls</small></span><ChevronRight size={15} /></button>
            </div>
          </>
        )}

        {view === 'guide' && (
          <section className="guide-view">
            <div className="section-heading"><div><p className="eyebrow">GET STARTED</p><h2>Move like a mouse.</h2></div><Hand size={23} /></div>
            <p className="section-copy">Keep your hand relaxed and use your index fingertip as the pointer. Every action needs a clear, deliberate movement.</p>
            <div className="gesture-list">
              {gestureGuide.map(({ icon: Icon, title, instruction, action }) => <div className="gesture-item" key={title}><div className="gesture-icon"><Icon size={18} /></div><div><strong>{title}</strong><p>{title === 'Click' && config.clickMode === 'double' ? 'Pinch and release twice as one deliberate action.' : instruction}</p><small>{action}</small></div><Check size={15} /></div>)}
            </div>
            <button className="text-button" onClick={() => setView('settings')}>Configure gestures <ChevronRight size={15} /></button>
          </section>
        )}

        {view === 'settings' && (
          <section className="settings-view">
            <div className="section-heading"><div><p className="eyebrow">PREFERENCES</p><h2>Make it yours.</h2></div><Settings2 size={23} /></div>
            <SettingRow label="Scroll sensitivity" value={config.scrollSensitivity.toFixed(1)}><input aria-label="Scroll sensitivity" type="range" min="0.5" max="5" step="0.1" value={config.scrollSensitivity} onChange={(e) => updateSetting({ scrollSensitivity: Number(e.target.value) })} /></SettingRow>
            <SettingRow label="Cursor smoothing"><select aria-label="Cursor smoothing" value={config.cursorSmoothing} onChange={(e) => updateSetting({ cursorSmoothing: e.target.value as AirBrowseConfig['cursorSmoothing'] })}><option value="low">Responsive</option><option value="med">Balanced</option><option value="high">Steady</option></select></SettingRow>
            <SettingRow label="Click mode"><select aria-label="Click mode" value={config.clickMode} onChange={(e) => updateSetting({ clickMode: e.target.value as AirBrowseConfig['clickMode'] })}><option value="single">Single click</option><option value="double">Double click</option></select></SettingRow>
            <SettingRow label="Left-handed mode"><input aria-label="Left-handed mode" type="checkbox" checked={config.leftHandedMode} onChange={(e) => updateSetting({ leftHandedMode: e.target.checked })} /></SettingRow>
            <SettingRow label="Three-finger refresh"><input aria-label="Three-finger refresh" type="checkbox" checked={config.enableRefreshGesture} onChange={(e) => updateSetting({ enableRefreshGesture: e.target.checked })} /></SettingRow>
            <SettingRow label="Five-finger window close"><input aria-label="Five-finger window close" type="checkbox" checked={config.enableDangerousGestures} onChange={(e) => updateSetting({ enableDangerousGestures: e.target.checked })} /></SettingRow>
            <SettingRow label="New tab action"><select aria-label="New tab action" value={config.openMode} onChange={(e) => updateSetting({ openMode: e.target.value as AirBrowseConfig['openMode'] })}><option value="tab">New tab</option><option value="window">New window</option></select></SettingRow>
            <div className="gemini-panel"><div className="panel-title"><Brain size={17} /><strong>Page summary</strong></div><p>Use Gemini to summarize the active page.</p><input aria-label="Gemini API key" type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} onBlur={() => saveGeminiApiKey(geminiKey)} placeholder="Gemini API key" /><button className="summary-button" onClick={summarizePage} disabled={isSummarizing}>{isSummarizing ? 'Summarizing…' : 'Summarize page'}</button>{summaryError && <p className="inline-error" role="alert">{summaryError}</p>}{summary && <div className="summary-output">{summary}</div>}</div>
          </section>
        )}
      </main>
      <footer className="air-footer"><span><Undo2 size={13} />Stop anytime with the button above</span><span>v1.0</span></footer>
    </div>
  );
}

function StatusDot({ active, label, muted = false }: { active: boolean; label: string; muted?: boolean }) {
  return <div className={`status-item ${muted ? 'muted' : ''}`}><span className={`status-dot ${active ? 'active' : ''}`} />{label}</div>;
}

function SettingRow({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{label}</strong>{value && <small>{value}</small>}</div><div className="setting-control">{children}</div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}
