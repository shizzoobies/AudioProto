import React, { useState, useEffect, useMemo } from "react";
import { Users, Zap, Mic, RotateCcw, Info } from "lucide-react";
import { storage } from "../lib/storage";

// ===== Verified pricing (May 2026) =====
const ANTHROPIC = {
  "Opus 4.8":   { in: 5.00, out: 25.00, cached: 0.50 },
  "Sonnet 4.6": { in: 3.00, out: 15.00, cached: 0.30 },
  "Haiku 4.5":  { in: 1.00, out: 5.00,  cached: 0.10 },
};
const OPENAI = {
  "GPT-5.5":      { in: 5.00, out: 30.00, cached: 0.50 },
  "GPT-5.4":      { in: 2.50, out: 15.00, cached: 0.25 },
  "GPT-5.4 Nano": { in: 0.20, out: 1.25,  cached: 0.02 },
};
const ELEVENLABS = {
  "Creator":   { fee: 22,   rate: 0.30 },
  "Pro":       { fee: 99,   rate: 0.24 },
  "Scale":     { fee: 330,  rate: 0.18 },
  "Business":  { fee: 1320, rate: 0.12 },
};
const OPENAI_TTS = {
  "Standard": 0.015,
  "HD":       0.030,
};

const TOKENS = { cachedIn: 1200, freshIn: 300, out: 500 };
const STORE_KEY = "uhaul:cost-calc:v1";

const DEFAULT = {
  eligible: 1150,
  activePct: 40,
  interactions: 30,
  voiceScenarios: 800,
  voiceChars: 3000,
};

function fmtUSD(n) {
  return "$" + Math.round(n).toLocaleString();
}
function fmtUSD2(n) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthlyTextCost(price, activeUsers, interactionsPerUser) {
  const total = activeUsers * interactionsPerUser;
  const cachedCost = (TOKENS.cachedIn * total / 1_000_000) * price.cached;
  const freshCost = (TOKENS.freshIn * total / 1_000_000) * price.in;
  const outCost = (TOKENS.out * total / 1_000_000) * price.out;
  return cachedCost + freshCost + outCost;
}

export default function CostCalculator() {
  const [state, setState] = useState(DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const result = storage.get(STORE_KEY);
      if (result && result.value) {
        const parsed = JSON.parse(result.value);
        setState({ ...DEFAULT, ...parsed });
      }
    } catch (e) { /* no prior state */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { storage.set(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state, loaded]);

  const activeUsers = Math.round(state.eligible * (state.activePct / 100));

  const anthropicAnnual = useMemo(() => {
    const out = {};
    for (const [m, p] of Object.entries(ANTHROPIC)) {
      out[m] = monthlyTextCost(p, activeUsers, state.interactions) * 12;
    }
    return out;
  }, [activeUsers, state.interactions]);

  const openaiAnnual = useMemo(() => {
    const out = {};
    for (const [m, p] of Object.entries(OPENAI)) {
      out[m] = monthlyTextCost(p, activeUsers, state.interactions) * 12;
    }
    return out;
  }, [activeUsers, state.interactions]);

  const voiceAnnual = useMemo(() => {
    const out = { elevenlabs: {}, openai: {} };
    const charsPerYear = state.voiceScenarios * state.voiceChars * 12;
    for (const [plan, p] of Object.entries(ELEVENLABS)) {
      const usage = (charsPerYear / 1000) * p.rate;
      const sub = p.fee * 12;
      out.elevenlabs[plan] = { usage, sub, total: usage + sub };
    }
    for (const [tier, rate] of Object.entries(OPENAI_TTS)) {
      out.openai[tier] = (charsPerYear / 1000) * rate;
    }
    return out;
  }, [state.voiceScenarios, state.voiceChars]);

  // Recommended combined: Sonnet 4.6 + ElevenLabs Scale
  const recommendedAnnual = anthropicAnnual["Sonnet 4.6"] + voiceAnnual.elevenlabs["Scale"].total;
  const recommendedPerUserMonthly = recommendedAnnual / 12 / activeUsers;

  function reset() {
    setState(DEFAULT);
  }

  return (
    <div className="min-h-screen" style={{ background: "#FAF8F3", color: "#1A2332", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .display { font-family: 'Playfair Display', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.02em; }
        .mono { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-variant-numeric: tabular-nums; }
        input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; height: 24px; }
        input[type="range"]::-webkit-slider-runnable-track { background: #E5E0D5; height: 2px; border-radius: 1px; }
        input[type="range"]::-moz-range-track { background: #E5E0D5; height: 2px; border-radius: 1px; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; background: #1A2332; border-radius: 50%; margin-top: -7px; cursor: grab; }
        input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; background: #1A2332; border-radius: 50%; cursor: grab; border: none; }
        input[type="range"]:active::-webkit-slider-thumb { cursor: grabbing; background: #B8865B; }
      `}</style>

      <div className="max-w-6xl mx-auto px-8 py-12">

        {/* Header */}
        <div className="mb-12 pb-8 border-b" style={{ borderColor: "#E5E0D5" }}>
          <div className="flex items-baseline justify-between flex-wrap gap-4">
            <div>
              <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#B8865B" }}>
                Creative Services / Training Platform
              </div>
              <h1 className="display text-5xl font-medium mb-2" style={{ color: "#1A2332" }}>
                AI Cost Calculator
              </h1>
              <p className="text-sm" style={{ color: "#6B6256" }}>
                Adjust the levers below. All annual costs are computed live across providers and tiers.
              </p>
            </div>
            <button
              onClick={reset}
              className="mono text-xs uppercase tracking-wider px-4 py-2 border flex items-center gap-2 hover:bg-white transition-colors"
              style={{ borderColor: "#E5E0D5", color: "#6B6256" }}
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>

        {/* Levers */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">

          <div className="bg-white p-7 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="flex items-center gap-2 mb-6">
              <Users size={16} style={{ color: "#B8865B" }} />
              <h2 className="mono text-xs tracking-widest uppercase" style={{ color: "#1A2332" }}>Population</h2>
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>Eligible population</label>
                <span className="mono text-2xl font-medium">{state.eligible.toLocaleString()}</span>
              </div>
              <input
                type="range" min="100" max="5000" step="50"
                value={state.eligible}
                onChange={(e) => setState({ ...state, eligible: +e.target.value })}
                className="w-full"
              />
            </div>

            <div className="mb-2">
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>Active monthly</label>
                <span className="mono text-2xl font-medium">{state.activePct}%</span>
              </div>
              <input
                type="range" min="10" max="100" step="5"
                value={state.activePct}
                onChange={(e) => setState({ ...state, activePct: +e.target.value })}
                className="w-full"
              />
              <div className="mono text-xs mt-2" style={{ color: "#B8865B" }}>
                = {activeUsers.toLocaleString()} active users
              </div>
            </div>
          </div>

          <div className="bg-white p-7 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="flex items-center gap-2 mb-6">
              <Zap size={16} style={{ color: "#B8865B" }} />
              <h2 className="mono text-xs tracking-widest uppercase" style={{ color: "#1A2332" }}>Usage intensity</h2>
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>AI interactions per user / month</label>
                <span className="mono text-2xl font-medium">{state.interactions}</span>
              </div>
              <input
                type="range" min="5" max="150" step="5"
                value={state.interactions}
                onChange={(e) => setState({ ...state, interactions: +e.target.value })}
                className="w-full"
              />
              <div className="flex justify-between mono text-xs mt-2" style={{ color: "#6B6256" }}>
                <span>Light (10)</span><span>Mid (30)</span><span>Heavy (75+)</span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>Voice scenarios / month (org-wide)</label>
                <span className="mono text-2xl font-medium">{state.voiceScenarios.toLocaleString()}</span>
              </div>
              <input
                type="range" min="0" max="5000" step="50"
                value={state.voiceScenarios}
                onChange={(e) => setState({ ...state, voiceScenarios: +e.target.value })}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Recommended combo */}
        <div className="mb-10 p-8 border-2" style={{ borderColor: "#1A2332", background: "#FFFFFF" }}>
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-2">
            <div className="mono text-xs tracking-widest uppercase" style={{ color: "#B8865B" }}>
              Recommended configuration
            </div>
            <div className="text-sm" style={{ color: "#6B6256" }}>Sonnet 4.6 + ElevenLabs Scale</div>
          </div>
          <div className="grid grid-cols-3 gap-8 mt-4">
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Annual platform cost</div>
              <div className="display text-4xl font-medium mono">{fmtUSD(recommendedAnnual)}</div>
            </div>
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Per active user / month</div>
              <div className="display text-4xl font-medium mono">{fmtUSD2(recommendedPerUserMonthly)}</div>
            </div>
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Per active user / year</div>
              <div className="display text-4xl font-medium mono">{fmtUSD(recommendedAnnual / activeUsers)}</div>
            </div>
          </div>
        </div>

        {/* Text AI Comparison */}
        <h2 className="display text-2xl font-medium mb-5 mt-12" style={{ color: "#1A2332" }}>
          Text guidance · annual cost by provider and tier
        </h2>
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white border" style={{ borderColor: "#E5E0D5" }}>
            <div className="px-6 py-4 border-b mono text-xs tracking-widest uppercase" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
              Anthropic Claude
            </div>
            <div>
              {Object.entries(anthropicAnnual).map(([model, cost], i) => (
                <div key={model}
                  className="flex justify-between items-baseline px-6 py-4 border-b last:border-b-0"
                  style={{
                    borderColor: "#E5E0D5",
                    background: model === "Sonnet 4.6" ? "#FAF6EE" : "transparent",
                  }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: "#1A2332" }}>{model}</div>
                    <div className="mono text-xs mt-1" style={{ color: "#6B6256" }}>
                      ${ANTHROPIC[model].in.toFixed(2)} in / ${ANTHROPIC[model].out.toFixed(2)} out per 1M tokens
                    </div>
                  </div>
                  <div className="mono text-2xl font-medium">{fmtUSD(cost)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border" style={{ borderColor: "#E5E0D5" }}>
            <div className="px-6 py-4 border-b mono text-xs tracking-widest uppercase" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
              OpenAI
            </div>
            <div>
              {Object.entries(openaiAnnual).map(([model, cost], i) => (
                <div key={model}
                  className="flex justify-between items-baseline px-6 py-4 border-b last:border-b-0"
                  style={{
                    borderColor: "#E5E0D5",
                    background: model === "GPT-5.4" ? "#FAF6EE" : "transparent",
                  }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: "#1A2332" }}>{model}</div>
                    <div className="mono text-xs mt-1" style={{ color: "#6B6256" }}>
                      ${OPENAI[model].in.toFixed(2)} in / ${OPENAI[model].out.toFixed(2)} out per 1M tokens
                    </div>
                  </div>
                  <div className="mono text-2xl font-medium">{fmtUSD(cost)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Voice */}
        <h2 className="display text-2xl font-medium mb-5" style={{ color: "#1A2332" }}>
          Voice scenarios · annual cost
        </h2>
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white border" style={{ borderColor: "#E5E0D5" }}>
            <div className="px-6 py-4 border-b mono text-xs tracking-widest uppercase" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
              ElevenLabs
            </div>
            {Object.entries(voiceAnnual.elevenlabs).map(([plan, costs]) => (
              <div key={plan}
                className="flex justify-between items-baseline px-6 py-4 border-b last:border-b-0"
                style={{
                  borderColor: "#E5E0D5",
                  background: plan === "Scale" ? "#FAF6EE" : "transparent",
                }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#1A2332" }}>{plan}</div>
                  <div className="mono text-xs mt-1" style={{ color: "#6B6256" }}>
                    ${ELEVENLABS[plan].rate.toFixed(2)} / 1k chars · ${ELEVENLABS[plan].fee}/mo sub
                  </div>
                </div>
                <div className="mono text-2xl font-medium">{fmtUSD(costs.total)}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border" style={{ borderColor: "#E5E0D5" }}>
            <div className="px-6 py-4 border-b mono text-xs tracking-widest uppercase" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
              OpenAI TTS (budget fallback)
            </div>
            {Object.entries(voiceAnnual.openai).map(([tier, cost]) => (
              <div key={tier}
                className="flex justify-between items-baseline px-6 py-4 border-b last:border-b-0"
                style={{ borderColor: "#E5E0D5" }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#1A2332" }}>{tier}</div>
                  <div className="mono text-xs mt-1" style={{ color: "#6B6256" }}>
                    ${OPENAI_TTS[tier].toFixed(3)} / 1k chars
                  </div>
                </div>
                <div className="mono text-2xl font-medium">{fmtUSD(cost)}</div>
              </div>
            ))}
            <div className="px-6 py-5 text-xs" style={{ color: "#6B6256", background: "#FAF6EE", borderTop: "1px solid #E5E0D5" }}>
              <Info size={12} style={{ display: "inline", verticalAlign: "-1px", marginRight: "6px" }} />
              ElevenLabs delivers far more realistic voice. OpenAI TTS serves as the automatic budget fallback inside graceful degradation.
            </div>
          </div>
        </div>

        {/* Assumptions footer */}
        <div className="mt-12 pt-6 border-t text-xs leading-relaxed" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
          <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#1A2332" }}>Modeling assumptions</div>
          <p>
            Per interaction: {TOKENS.cachedIn} cached input tokens (system prompt + training context, billed at 10% rate), {TOKENS.freshIn} fresh input tokens (user question), {TOKENS.out} output tokens.
            Per voice scenario: {state.voiceChars.toLocaleString()} characters of spoken audio.
            All pricing verified May 2026 from official vendor sources. Prompt caching assumed active across all providers.
          </p>
        </div>

      </div>
    </div>
  );
}
