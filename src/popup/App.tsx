/**
 * AirBrowse - Extension Popup Guide & Practice Arena
 * Strict 3-gesture design:
 * 1. Move: raise your hand
 * 2. Click: quick pinch
 * 3. Scroll: show 2 fingers, move hand up/down
 * Bottom banner: "Everything else: hover a button for 1 second"
 *
 * Practice tab with live detected state and interactive cursor simulation (zero real actions).
 * Automatic prefers-color-scheme (dark/light) & Arabic / French / English multilingual support.
 */

import React, { useState, useEffect } from 'react';
import { Power, Compass, Sparkles } from 'lucide-react';
import { loadConfig, saveConfig, AirBrowseConfig, DEFAULT_CONFIG, MESSAGE_TYPES } from '../core/config';
import { RecognizerState } from '../core/gestures';

type Language = 'en' | 'fr' | 'ar';
type PopupTab = 'guide' | 'practice';

/* =========================================================================
   TRANSLATION DICTIONARY
   ========================================================================= */
const I18N = {
  en: {
    title: 'AirBrowse',
    subtitle: 'Touchless Browser Control',
    guideTab: 'Guide',
    practiceTab: 'Practice',
    active: 'Active',
    paused: 'Paused',
    moveTitle: 'Move: raise your hand',
    moveDesc: 'Open, relaxed hand. Cursor tracks your palm center (Landmark 9).',
    clickTitle: 'Click: quick pinch',
    clickDesc: 'Thumb + Index quick pinch. Tap and release in under 350 ms.',
    scrollTitle: 'Scroll: show 2 fingers, move hand up/down',
    scrollDesc: 'Peace sign. Hand above neutral = scroll up, below = scroll down.',
    everythingElse: 'Everything else: hover a button for 1 second',
    practiceTitle: 'Interactive Practice Stage',
    practiceSubtitle: 'Test spatial gestures safely without triggering real browser actions.',
    detectedState: 'Detected State',
    cursorPreview: 'Cursor & Pose Simulator',
    simMove: 'Simulate Open Hand',
    simPinch: 'Simulate Quick Pinch',
    simScrollUp: 'Simulate Peace (Hand Up)',
    simScrollDown: 'Simulate Peace (Hand Down)',
    simIdle: 'Simulate Lost Tracking',
    practiceSuccess: 'Click registered! (Zero real DOM events)',
    practiceScrolling: 'Joystick scrolling active',
    neutralYInfo: 'Neutral anchor point locked.',
  },
  fr: {
    title: 'AirBrowse',
    subtitle: 'Navigation sans contact',
    guideTab: 'Guide',
    practiceTab: 'Pratique',
    active: 'Actif',
    paused: 'En pause',
    moveTitle: 'Déplacer : levez la main',
    moveDesc: 'Main ouverte et détendue. Le curseur suit le centre de votre paume.',
    clickTitle: 'Cliquer : pincement rapide',
    clickDesc: 'Pincement rapide Pouce + Index. Pincez et relâchez en moins de 350 ms.',
    scrollTitle: 'Défiler : montrez 2 doigts, bougez la main haut/bas',
    scrollDesc: 'Signe de paix. Main au-dessus = défile vers le haut, en-dessous = vers le bas.',
    everythingElse: 'Tout le reste : survolez un bouton pendant 1 seconde',
    practiceTitle: 'Zone d’entraînement',
    practiceSubtitle: 'Testez les gestes en toute sécurité sans déclencher d’actions réelles.',
    detectedState: 'État détecté',
    cursorPreview: 'Simulateur de curseur & pose',
    simMove: 'Main ouverte',
    simPinch: 'Pincement rapide',
    simScrollUp: 'Signe de paix (Vers le haut)',
    simScrollDown: 'Signe de paix (Vers le bas)',
    simIdle: 'Perte de suivi',
    practiceSuccess: 'Clic enregistré ! (Aucun événement DOM réel)',
    practiceScrolling: 'Défilement joystick actif',
    neutralYInfo: 'Point d’ancrage neutre fixé.',
  },
  ar: {
    title: 'إير براوز',
    subtitle: 'تحكم في المتصفح بحركات اليد',
    guideTab: 'الدليل',
    practiceTab: 'التدريب',
    active: 'نشط',
    paused: 'متوقف',
    moveTitle: 'التحريك: ارفع يدك',
    moveDesc: 'يد مفتوحة ومسترخية. المؤشر يتتبع مركز راحة يدك.',
    clickTitle: 'النقر: قرصة سريعة',
    clickDesc: 'قرصة سريعة بالإبهام والسبابة. انقر وافلت خلال أقل من 350 مللي ثانية.',
    scrollTitle: 'التمرير: أظهر إصبعين، حرّك يدك لأعلى/لأسفل',
    scrollDesc: 'علامة النصر. اليد لأعلى = تمرير لأعلى، اليد لأسفل = تمرير لأسفل.',
    everythingElse: 'كل شيء آخر: قف فوق أي زر لمدة ثانية واحدة',
    practiceTitle: 'ميدان التدريب التفاعلي',
    practiceSubtitle: 'اختبر حركات اليد بأمان دون التأثير على صفحات الويب الحقيقية.',
    detectedState: 'الحالة المكتشفة',
    cursorPreview: 'محاكي المؤشر وحركات اليد',
    simMove: 'يد مفتوحة',
    simPinch: 'قرصة سريعة',
    simScrollUp: 'علامة النصر (أعلى)',
    simScrollDown: 'علامة النصر (أسفل)',
    simIdle: 'فقدان التتبع',
    practiceSuccess: 'تم تسجيل النقرة! (دون إطلاق أحداث حقيقية)',
    practiceScrolling: 'التمرير التناسبي قيد التشغيل',
    neutralYInfo: 'تم تثبيت نقطة الارتكاز المحايدة.',
  },
} as const;

/* =========================================================================
   SVG HAND ILLUSTRATIONS
   ========================================================================= */

// 1. Move: Open / Relaxed Hand with glowing Palm Center (Landmark 9)
const HandSvgMove: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="32" cy="32" r="30" className="fill-blue-500/10 stroke-blue-500/30" strokeWidth="1.5" />
    {/* Relaxed open hand outline */}
    <path
      d="M20 28V38C20 44 25 49 32 49C39 49 44 44 44 38V28M24 20V34M29 16V34M35 17V34M40 22V34M17 33C17 33 19 39 25 44"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-blue-500"
    />
    {/* Landmark 9 (Palm Center) highlight */}
    <circle cx="32" cy="36" r="4.5" className="fill-blue-500 shadow-lg" />
    <circle cx="32" cy="36" r="7" className="stroke-blue-400 stroke-dasharray animate-pulse" strokeWidth="1.5" />
    <circle cx="32" cy="36" r="2" className="fill-white" />
  </svg>
);

// 2. Click: Quick Pinch (Thumb 4 + Index 8 meeting)
const HandSvgClick: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="32" cy="32" r="30" className="fill-cyan-500/10 stroke-cyan-500/30" strokeWidth="1.5" />
    {/* Pinch loop thumb + index */}
    <path
      d="M26 23C26 20 29 18 32 18C35 18 38 20 38 23V34M24 30C21 27 18 28 18 32C18 38 24 46 32 46C40 46 45 40 45 34M38 30V34"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-cyan-500"
    />
    {/* Pinch contact burst */}
    <circle cx="32" cy="18" r="5" className="fill-cyan-400/30 animate-ping" />
    <circle cx="32" cy="18" r="3.5" className="fill-cyan-400" />
    <circle cx="32" cy="18" r="1.5" className="fill-white" />
  </svg>
);

// 3. Scroll: Peace sign (Index + Middle extended, ring + pinky curled)
const HandSvgScroll: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="32" cy="32" r="30" className="fill-indigo-500/10 stroke-indigo-500/30" strokeWidth="1.5" />
    {/* Peace sign fingers */}
    <path
      d="M27 15V34M37 16V34M22 34C22 34 23 37 25 40C27 44 32 47 37 47C42 47 45 43 45 37V34"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-indigo-500"
    />
    {/* Vertical motion arrows for joystick scrolling */}
    <path d="M14 26L14 16M14 16L10 20M14 16L18 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-indigo-400" />
    <path d="M14 38L14 48M14 48L10 44M14 48L18 44" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-indigo-400" />
  </svg>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<PopupTab>('guide');
  const [lang, setLang] = useState<Language>('en');
  const [config, setConfig] = useState<AirBrowseConfig>(DEFAULT_CONFIG);

  // Practice Stage State
  const [practiceState, setPracticeState] = useState<RecognizerState>(RecognizerState.MOVE);
  const [cursorPos, setCursorPos] = useState({ x: 0.5, y: 0.5 });
  const [practiceToast, setPracticeToast] = useState<string | null>(null);
  const [scrollSpeed, setScrollSpeed] = useState(0);

  const t = I18N[lang];
  const isRTL = lang === 'ar';

  useEffect(() => {
    loadConfig().then((loaded) => setConfig(loaded));
  }, []);

  const handleToggleMaster = async () => {
    const nextState = !config.isEnabled;
    const nextConfig = { ...config, isEnabled: nextState };
    setConfig(nextConfig);
    await saveConfig({ isEnabled: nextState });

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: MESSAGE_TYPES.CONFIG_UPDATED,
              payload: nextConfig,
            }).catch(() => {});
          }
        });
      }
    } catch {}
  };

  const showSimToast = (msg: string) => {
    setPracticeToast(msg);
    setTimeout(() => setPracticeToast(null), 2000);
  };

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="w-[420px] min-h-[610px] max-h-[640px] flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans select-none antialiased"
    >
      {/* HEADER */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md shrink-0">
        <div className="flex items-center space-x-2.5 rtl:space-x-reverse">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/25">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
              <span className="text-sm font-bold tracking-tight">{t.title}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                3 GESTURES
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400">{t.subtitle}</p>
          </div>
        </div>

        {/* Controls: Language Selector & Master Power */}
        <div className="flex items-center space-x-2 rtl:space-x-reverse">
          {/* Language Switcher */}
          <div className="flex items-center bg-neutral-200/60 dark:bg-neutral-800 rounded-lg p-0.5 text-[11px] font-semibold">
            {(['en', 'fr', 'ar'] as Language[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
                  lang === l
                    ? 'bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Master Toggle Pill */}
          <button
            type="button"
            onClick={handleToggleMaster}
            className={`flex items-center space-x-1.5 rtl:space-x-reverse px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer border transition-colors ${
              config.isEnabled
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-neutral-200/50 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-500'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{config.isEnabled ? t.active : t.paused}</span>
          </button>
        </div>
      </header>

      {/* TAB NAVIGATION */}
      <nav className="flex border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-900/40 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('guide')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1.5 rtl:space-x-reverse ${
            activeTab === 'guide'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>{t.guideTab}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('practice')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1.5 rtl:space-x-reverse ${
            activeTab === 'practice'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t.practiceTab}</span>
        </button>
      </nav>

      {/* BODY CONTENT */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {activeTab === 'guide' ? (
          <>
            {/* THE 3 GESTURE CARDS */}
            <div className="space-y-3">
              {/* Card 1: MOVE */}
              <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex items-center space-x-4 rtl:space-x-reverse hover:border-blue-500/40 transition-colors">
                <div className="shrink-0">
                  <HandSvgMove />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {t.moveTitle}
                    </h3>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                    {t.moveDesc}
                  </p>
                </div>
              </div>

              {/* Card 2: CLICK */}
              <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex items-center space-x-4 rtl:space-x-reverse hover:border-cyan-500/40 transition-colors">
                <div className="shrink-0">
                  <HandSvgClick />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
                    <span className="w-2 h-2 rounded-full bg-cyan-500" />
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {t.clickTitle}
                    </h3>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                    {t.clickDesc}
                  </p>
                </div>
              </div>

              {/* Card 3: SCROLL */}
              <div className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex items-center space-x-4 rtl:space-x-reverse hover:border-indigo-500/40 transition-colors">
                <div className="shrink-0">
                  <HandSvgScroll />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {t.scrollTitle}
                    </h3>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                    {t.scrollDesc}
                  </p>
                </div>
              </div>
            </div>

            {/* CALLOUT: EVERYTHING ELSE HOVER A BUTTON FOR 1 SECOND */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md flex items-center space-x-3 rtl:space-x-reverse">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-blue-200 block">
                  On-Screen Toolbar
                </span>
                <p className="text-xs font-semibold leading-snug mt-0.5">
                  {t.everythingElse}
                </p>
              </div>
            </div>
          </>
        ) : (
          /* PRACTICE TAB */
          <div className="space-y-3.5">
            <div>
              <h2 className="text-sm font-bold text-neutral-900 dark:text-white">
                {t.practiceTitle}
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {t.practiceSubtitle}
              </p>
            </div>

            {/* Live Detected State Badge */}
            <div className="p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between shadow-xs">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t.detectedState}:
              </span>
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <span
                  className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                    practiceState === RecognizerState.MOVE
                      ? 'bg-white shadow-[0_0_8px_#ffffff]'
                      : practiceState === RecognizerState.PINCH_PENDING
                      ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]'
                      : practiceState === RecognizerState.SCROLLING
                      ? 'bg-blue-500 shadow-[0_0_8px_#3b82f6]'
                      : 'bg-neutral-400'
                  }`}
                />
                <span className="text-xs font-mono font-bold tracking-wide">
                  {practiceState}
                </span>
              </div>
            </div>

            {/* Interactive Cursor Stage Canvas */}
            <div
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setCursorPos({
                  x: (e.clientX - rect.left) / rect.width,
                  y: (e.clientY - rect.top) / rect.height,
                });
              }}
              className="relative w-full h-44 rounded-2xl bg-neutral-950 border border-neutral-800 overflow-hidden flex items-center justify-center cursor-none"
            >
              {/* Virtual Cursor element */}
              <div
                style={{
                  transform: `translate3d(${cursorPos.x * 370}px, ${cursorPos.y * 160}px, 0)`,
                }}
                className="absolute top-0 left-0 w-8 h-8 -ml-4 -mt-4 flex items-center justify-center pointer-events-none transition-transform duration-75"
              >
                <div
                  className={`rounded-full transition-all duration-150 ${
                    practiceState === RecognizerState.MOVE
                      ? 'w-3.5 h-3.5 bg-white shadow-[0_0_12px_#ffffff]'
                      : practiceState === RecognizerState.PINCH_PENDING
                      ? 'w-2 h-2 bg-cyan-300 shadow-[0_0_14px_#22d3ee]'
                      : practiceState === RecognizerState.SCROLLING
                      ? 'w-4 h-4 bg-blue-500 shadow-[0_0_18px_#3b82f6]'
                      : 'w-3 h-3 bg-neutral-500 opacity-40'
                  }`}
                />
              </div>

              {/* Status overlays inside stage */}
              <div className="absolute top-2 left-2 text-[10px] font-mono text-neutral-400">
                X: {cursorPos.x.toFixed(2)} | Y: {cursorPos.y.toFixed(2)}
              </div>

              {scrollSpeed !== 0 && (
                <div className="absolute bottom-2 text-xs font-bold text-blue-400 animate-bounce">
                  {scrollSpeed < 0 ? '▲ Page Scrolling Up' : '▼ Page Scrolling Down'}
                </div>
              )}

              {practiceToast && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full bg-cyan-500 text-neutral-950 font-bold text-xs shadow-lg animate-fade-in">
                  {practiceToast}
                </div>
              )}
            </div>

            {/* Gesture Simulator Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPracticeState(RecognizerState.MOVE);
                  setScrollSpeed(0);
                }}
                className="p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:border-blue-500 transition-colors cursor-pointer text-left rtl:text-right"
              >
                1. {t.simMove}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPracticeState(RecognizerState.PINCH_PENDING);
                  setTimeout(() => {
                    setPracticeState(RecognizerState.MOVE);
                    showSimToast(t.practiceSuccess);
                  }, 200);
                }}
                className="p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:border-cyan-500 transition-colors cursor-pointer text-left rtl:text-right"
              >
                2. {t.simPinch}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPracticeState(RecognizerState.SCROLLING);
                  setScrollSpeed(-25);
                }}
                className="p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:border-indigo-500 transition-colors cursor-pointer text-left rtl:text-right"
              >
                3. {t.simScrollUp}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPracticeState(RecognizerState.SCROLLING);
                  setScrollSpeed(25);
                }}
                className="p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:border-indigo-500 transition-colors cursor-pointer text-left rtl:text-right"
              >
                4. {t.simScrollDown}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
