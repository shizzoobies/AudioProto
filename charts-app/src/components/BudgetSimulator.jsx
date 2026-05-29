import React, { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Area, ComposedChart } from "recharts";
import { Activity, AlertTriangle, CheckCircle2, RotateCcw, Zap, Gauge } from "lucide-react";
import { storage } from "../lib/storage";

const DAYS = 30;
const STORE_KEY = "uhaul:burndown:v1";

// Cost multipliers normalized to Opus = 1.0 (from verified pricing)
const PROVIDERS = {
  anthropic: {
    label: "Anthropic Claude",
    tiers: {
      premium: { name: "Opus 4.8",    multiplier: 1.00, color: "#534AB7" },
      mid:     { name: "Sonnet 4.6",  multiplier: 0.58, color: "#1E7A46" },
      budget:  { name: "Haiku 4.5",   multiplier: 0.19, color: "#B8865B" },
    },
  },
  openai: {
    label: "OpenAI",
    tiers: {
      premium: { name: "GPT-5.5",      multiplier: 1.00, color: "#534AB7" },
      mid:     { name: "GPT-5.4",      multiplier: 0.50, color: "#1E7A46" },
      budget:  { name: "GPT-5.4 Nano", multiplier: 0.05, color: "#B8865B" },
    },
  },
};
const FALLBACK = { name: "FAQ only", multiplier: 0, color: "#6B6256" };

const PRESETS = {
  light:  { label: "Quiet month",   demand: 70,  desc: "Light usage, budget unused" },
  normal: { label: "Typical month", demand: 115, desc: "Demand slightly above budget" },
  spike:  { label: "Training surge", demand: 165, desc: "Rollout or campaign drives heavy use" },
  crisis: { label: "Runaway demand", demand: 220, desc: "Tests the FAQ fallback" },
};

const DEFAULT = {
  budget: 2500,
  demand: 115,
  t1: 40,
  t2: 75,
  t3: 95,
  provider: "anthropic",
};

function fmtUSD(n) {
  return "$" + Math.round(n).toLocaleString();
}

function simulate(budget, demandPct, t1, t2, t3, providerKey) {
  const baseDaily = (budget / DAYS) * (demandPct / 100);
  const tiers = PROVIDERS[providerKey].tiers;
  let cum = 0;
  const data = [];
  const switches = [];
  let lastTier = null;
  for (let d = 1; d <= DAYS; d++) {
    const usedPct = (cum / budget) * 100;
    let key, mult, color;
    if (usedPct < t1)       { key = "premium";  mult = tiers.premium.multiplier; color = tiers.premium.color; }
    else if (usedPct < t2)  { key = "mid";      mult = tiers.mid.multiplier;     color = tiers.mid.color; }
    else if (usedPct < t3)  { key = "budget";   mult = tiers.budget.multiplier;  color = tiers.budget.color; }
    else                    { key = "fallback"; mult = FALLBACK.multiplier;      color = FALLBACK.color; }
    if (lastTier !== null && key !== lastTier) switches.push({ day: d, fromTier: lastTier, toTier: key });
    lastTier = key;
    const dayCost = baseDaily * mult;
    cum += dayCost;
    data.push({ day: d, spend: Math.round(cum * 100) / 100, tier: key, color });
  }
  return { data, switches, projected: cum, finalTier: lastTier };
}

export default function BudgetSimulator() {
  const [state, setState] = useState(DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const result = storage.get(STORE_KEY);
      if (result && result.value) {
        setState({ ...DEFAULT, ...JSON.parse(result.value) });
      }
    } catch (e) {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { storage.set(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state, loaded]);

  // Enforce slider ordering: t1 < t2 < t3
  function setThreshold(key, value) {
    const next = { ...state, [key]: value };
    if (next.t2 <= next.t1) next.t2 = Math.min(99, next.t1 + 5);
    if (next.t3 <= next.t2) next.t3 = Math.min(99, next.t2 + 5);
    setState(next);
  }

  const sim = useMemo(
    () => simulate(state.budget, state.demand, state.t1, state.t2, state.t3, state.provider),
    [state]
  );

  const underBudget = sim.projected <= state.budget;
  const usedPct = Math.round((sim.projected / state.budget) * 100);
  const tiers = PROVIDERS[state.provider].tiers;
  const finalTierName = sim.finalTier === "fallback" ? FALLBACK.name : tiers[sim.finalTier].name;
  const finalTierColor = sim.finalTier === "fallback" ? FALLBACK.color : tiers[sim.finalTier].color;

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

        <div className="mb-10 pb-8 border-b flex items-end justify-between flex-wrap gap-4" style={{ borderColor: "#E5E0D5" }}>
          <div>
            <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#B8865B" }}>
              Creative Services / Cost Control
            </div>
            <h1 className="display text-5xl font-medium mb-2">Budget Tiering Simulator</h1>
            <p className="text-sm" style={{ color: "#6B6256" }}>
              Watch the platform downshift through model tiers as cumulative spend approaches the monthly ceiling.
            </p>
          </div>
          <button
            onClick={() => setState(DEFAULT)}
            className="mono text-xs uppercase tracking-wider px-4 py-2 border flex items-center gap-2 hover:bg-white transition-colors"
            style={{ borderColor: "#E5E0D5", color: "#6B6256" }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        {/* Metric strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="bg-white p-5 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>Monthly budget</div>
            <div className="mono text-3xl font-medium">{fmtUSD(state.budget)}</div>
          </div>
          <div className="bg-white p-5 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>Projected month-end</div>
            <div className="mono text-3xl font-medium">{fmtUSD(sim.projected)}</div>
          </div>
          <div className="bg-white p-5 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>Budget used</div>
            <div className="mono text-3xl font-medium" style={{ color: usedPct > 100 ? "#9B2D2D" : usedPct > 85 ? "#B8865B" : "#1A2332" }}>
              {usedPct}%
            </div>
          </div>
          <div className="bg-white p-5 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>Active tier (day 30)</div>
            <div className="text-xl font-medium flex items-center gap-2">
              <span style={{ width: 10, height: 10, background: finalTierColor, borderRadius: 2, display: "inline-block" }} />
              {finalTierName}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white p-6 border mb-6" style={{ borderColor: "#E5E0D5" }}>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <ComposedChart data={sim.data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="#F0EBE0" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#6B6256" }}
                  axisLine={{ stroke: "#E5E0D5" }}
                  tickLine={false}
                  label={{ value: "Day of month", position: "insideBottom", offset: -2, style: { fontSize: 11, fill: "#6B6256", fontFamily: "JetBrains Mono" } }}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#6B6256" }}
                  axisLine={{ stroke: "#E5E0D5" }}
                  tickLine={false}
                  tickFormatter={(v) => "$" + v.toLocaleString()}
                  domain={[0, Math.max(state.budget, sim.projected) * 1.15]}
                />
                <Tooltip
                  contentStyle={{ background: "#1A2332", border: "none", borderRadius: 4, color: "#FAF8F3", fontSize: 12, fontFamily: "JetBrains Mono" }}
                  formatter={(v, name) => {
                    if (name === "spend") return [fmtUSD(v), "Spend"];
                    if (name === "budget") return [fmtUSD(v), "Ceiling"];
                    return [v, name];
                  }}
                  labelFormatter={(d) => `Day ${d}`}
                />
                <ReferenceLine y={state.budget} stroke="#9B2D2D" strokeWidth={2} strokeDasharray="6 4" />
                {sim.switches.map((s, i) => (
                  <ReferenceLine key={i} x={s.day} stroke="#6B6256" strokeWidth={1} strokeDasharray="3 3" />
                ))}
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#1A2332"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Chart legend */}
          <div className="flex flex-wrap gap-5 mt-4 mono text-xs" style={{ color: "#6B6256" }}>
            <span className="flex items-center gap-2">
              <span style={{ width: 14, height: 2, background: "#1A2332", display: "inline-block" }} /> Cumulative spend
            </span>
            <span className="flex items-center gap-2">
              <span style={{ width: 14, height: 2, background: "#9B2D2D", display: "inline-block", borderTop: "2px dashed #9B2D2D" }} /> Budget ceiling
            </span>
            <span className="flex items-center gap-2">
              <span style={{ width: 14, height: 2, background: "#6B6256", display: "inline-block" }} /> Tier switch
            </span>
          </div>
        </div>

        {/* Status banner */}
        <div
          className="p-4 mb-8 flex items-start gap-3 border-l-4"
          style={{
            background: underBudget ? "#F1F8F3" : "#FFF8E8",
            borderColor: underBudget ? "#1E7A46" : "#B8865B",
            color: underBudget ? "#0F4D2C" : "#7A5A1F",
          }}
        >
          {underBudget ? <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />}
          <div className="text-sm leading-relaxed">
            {underBudget
              ? <>Within budget. Projected {fmtUSD(sim.projected)} of {fmtUSD(state.budget)} ({usedPct}% used). The system stepped down through {sim.switches.length} tier {sim.switches.length === 1 ? "switch" : "switches"} to stay under the ceiling.</>
              : <>Demand exceeds what tiering alone absorbs. Projected {fmtUSD(sim.projected)} of {fmtUSD(state.budget)} ({usedPct}% used). Lower the Haiku threshold so the FAQ fallback engages sooner, or raise the budget.</>}
          </div>
        </div>

        {/* Scenario presets */}
        <div className="mb-8">
          <div className="mono text-xs uppercase tracking-widest mb-3" style={{ color: "#6B6256" }}>Scenario presets</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => setState({ ...state, demand: preset.demand })}
                className="text-left p-4 border transition-colors hover:border-current"
                style={{
                  borderColor: state.demand === preset.demand ? "#1A2332" : "#E5E0D5",
                  background: state.demand === preset.demand ? "#FAF6EE" : "white",
                }}
              >
                <div className="text-sm font-medium mb-1">{preset.label}</div>
                <div className="mono text-xs mb-2" style={{ color: "#B8865B" }}>{preset.demand}% demand</div>
                <div className="text-xs leading-relaxed" style={{ color: "#6B6256" }}>{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">

          <div className="bg-white p-7 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="flex items-center gap-2 mb-6">
              <Gauge size={16} style={{ color: "#B8865B" }} />
              <h2 className="mono text-xs tracking-widest uppercase">Conditions</h2>
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>Monthly budget</label>
                <span className="mono text-2xl font-medium">{fmtUSD(state.budget)}</span>
              </div>
              <input
                type="range" min="1000" max="5000" step="100"
                value={state.budget}
                onChange={(e) => setState({ ...state, budget: +e.target.value })}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm" style={{ color: "#6B6256" }}>Demand intensity</label>
                <span className="mono text-2xl font-medium">{state.demand}%</span>
              </div>
              <input
                type="range" min="40" max="250" step="5"
                value={state.demand}
                onChange={(e) => setState({ ...state, demand: +e.target.value })}
                className="w-full"
              />
              <div className="flex justify-between mono text-xs mt-2" style={{ color: "#6B6256" }}>
                <span>Low</span><span>Normal</span><span>Spike</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-7 border" style={{ borderColor: "#E5E0D5" }}>
            <div className="flex items-center gap-2 mb-6">
              <Activity size={16} style={{ color: "#B8865B" }} />
              <h2 className="mono text-xs tracking-widest uppercase">Tier switch thresholds</h2>
            </div>

            {[
              { key: "t1", label: tiers.premium.name + " until", color: tiers.premium.color, min: 10, max: 70 },
              { key: "t2", label: tiers.mid.name + " until", color: tiers.mid.color, min: 40, max: 90 },
              { key: "t3", label: tiers.budget.name + " until", color: tiers.budget.color, min: 70, max: 99 },
            ].map(({ key, label, color, min, max }) => (
              <div key={key} className="mb-5 last:mb-0">
                <div className="flex justify-between items-baseline mb-2">
                  <label className="text-sm flex items-center gap-2" style={{ color: "#6B6256" }}>
                    <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: "inline-block" }} />
                    {label}
                  </label>
                  <span className="mono text-lg font-medium">{state[key]}%</span>
                </div>
                <input
                  type="range" min={min} max={max} step="1"
                  value={state[key]}
                  onChange={(e) => setThreshold(key, +e.target.value)}
                  className="w-full"
                />
              </div>
            ))}
            <div className="mt-4 pt-4 text-xs leading-relaxed border-t" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
              Past the {state.t3}% mark, the platform serves curated FAQ content with no API cost until the next billing cycle resets.
            </div>
          </div>
        </div>

        {/* Provider toggle */}
        <div className="bg-white p-7 border mb-8" style={{ borderColor: "#E5E0D5" }}>
          <div className="mono text-xs uppercase tracking-widest mb-4" style={{ color: "#6B6256" }}>Provider routing</div>
          <div className="flex gap-3">
            {Object.entries(PROVIDERS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => setState({ ...state, provider: key })}
                className="flex-1 p-4 border text-left transition-colors"
                style={{
                  borderColor: state.provider === key ? "#1A2332" : "#E5E0D5",
                  background: state.provider === key ? "#FAF6EE" : "white",
                }}
              >
                <div className="text-sm font-medium mb-2">{p.label}</div>
                <div className="mono text-xs" style={{ color: "#6B6256" }}>
                  {p.tiers.premium.name} / {p.tiers.mid.name} / {p.tiers.budget.name}
                </div>
              </button>
            ))}
          </div>
          <div className="text-xs mt-4 leading-relaxed" style={{ color: "#6B6256" }}>
            The platform routes between both providers in production. This toggle shows how either looks under the same budget rules. Switching providers does not change behavior, only which model names appear in the tiers.
          </div>
        </div>

        {/* Tier reference */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {[
            { ...tiers.premium, key: "premium", desc: "Highest reasoning quality" },
            { ...tiers.mid,     key: "mid",     desc: "Near-premium, ~58% cost" },
            { ...tiers.budget,  key: "budget",  desc: "Budget tier, ~19% cost" },
            { ...FALLBACK,      key: "fallback", desc: "Zero API cost, curated FAQ" },
          ].map((t) => (
            <div key={t.key} className="p-4 border bg-white" style={{ borderColor: "#E5E0D5" }}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ width: 10, height: 10, background: t.color, borderRadius: 2 }} />
                <div className="text-sm font-medium">{t.name}</div>
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "#6B6256" }}>{t.desc}</div>
            </div>
          ))}
        </div>

        <div className="pt-6 border-t text-xs leading-relaxed" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
          <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#1A2332" }}>How to read this</div>
          <p className="mb-2">
            Each day adds spend to the running total. The system checks the percentage of the monthly budget consumed and selects which model tier to use for new requests. As cumulative spend climbs through the thresholds, it downshifts: premium first, then mid, then budget, then the zero-cost FAQ fallback.
          </p>
          <p>
            The flattening of the line at each tier switch is the budget protection happening automatically. No human intervention required.
          </p>
        </div>

      </div>
    </div>
  );
}
