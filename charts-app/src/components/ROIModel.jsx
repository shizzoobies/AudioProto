import React, { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from "recharts";
import { TrendingUp, RotateCcw, Calculator, Target, Info } from "lucide-react";
import { storage } from "../lib/storage";

const STORE_KEY = "uhaul:roi:v1";

const PRESETS = {
  custom: {
    label: "Custom",
    desc: "Enter your own figures",
    annualInteractions: 500000,
    avgValue: 50,
    baselineRate: 60,
  },
  truckRental: {
    label: "Truck rental conversion",
    desc: "Inbound rental inquiries closing to booking",
    annualInteractions: 2000000,
    avgValue: 85,
    baselineRate: 55,
  },
  ubox: {
    label: "U-Box conversion",
    desc: "Storage inquiries closing to contract",
    annualInteractions: 400000,
    avgValue: 320,
    baselineRate: 28,
  },
  retention: {
    label: "Storage retention save",
    desc: "Cancellation calls converted to renewal",
    annualInteractions: 120000,
    avgValue: 180,
    baselineRate: 35,
  },
};

const DEFAULT = {
  preset: "truckRental",
  annualInteractions: PRESETS.truckRental.annualInteractions,
  avgValue: PRESETS.truckRental.avgValue,
  baselineRate: PRESETS.truckRental.baselineRate,
  platformCost: 24000,
};

const LIFT_LEVELS = [0.5, 1, 2, 3, 5, 7];

function fmtUSD(n) {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return "$" + Math.round(n / 1000).toLocaleString() + "K";
  return "$" + Math.round(n).toLocaleString();
}
function fmtUSDFull(n) {
  return "$" + Math.round(n).toLocaleString();
}

export default function ROIModel() {
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

  function applyPreset(key) {
    const p = PRESETS[key];
    if (key === "custom") {
      setState({ ...state, preset: key });
    } else {
      setState({
        ...state,
        preset: key,
        annualInteractions: p.annualInteractions,
        avgValue: p.avgValue,
        baselineRate: p.baselineRate,
      });
    }
  }

  const calc = useMemo(() => {
    const baselineSuccesses = state.annualInteractions * (state.baselineRate / 100);
    const baselineRevenue = baselineSuccesses * state.avgValue;
    const results = LIFT_LEVELS.map((lift) => {
      const newRate = state.baselineRate + lift;
      const newSuccesses = state.annualInteractions * (newRate / 100);
      const incrementalSuccesses = newSuccesses - baselineSuccesses;
      const incrementalRevenue = incrementalSuccesses * state.avgValue;
      const netReturn = incrementalRevenue - state.platformCost;
      const roiMultiple = incrementalRevenue / state.platformCost;
      return { lift, incrementalSuccesses, incrementalRevenue, netReturn, roiMultiple };
    });
    // Break-even: what lift % covers platform cost exactly?
    // platformCost = (annualInteractions * (breakEvenLift/100) * avgValue)
    const breakEvenLift = (state.platformCost / (state.annualInteractions * state.avgValue)) * 100;
    return { baselineSuccesses, baselineRevenue, results, breakEvenLift };
  }, [state]);

  // Chart data
  const chartData = calc.results.map((r) => ({
    name: r.lift + "% lift",
    revenue: Math.round(r.incrementalRevenue),
    roi: r.roiMultiple,
  }));

  return (
    <div className="min-h-screen" style={{ background: "#FAF8F3", color: "#1A2332", fontFamily: "'Geist', -apple-system, system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; letter-spacing: -0.02em; }
        .mono { font-family: 'Geist Mono', 'SF Mono', monospace; font-variant-numeric: tabular-nums; }
        input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; height: 24px; }
        input[type="range"]::-webkit-slider-runnable-track { background: #E5E0D5; height: 2px; border-radius: 1px; }
        input[type="range"]::-moz-range-track { background: #E5E0D5; height: 2px; border-radius: 1px; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; background: #1A2332; border-radius: 50%; margin-top: -7px; cursor: grab; }
        input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; background: #1A2332; border-radius: 50%; cursor: grab; border: none; }
        input[type="range"]:active::-webkit-slider-thumb { cursor: grabbing; background: #B8865B; }
        input[type="number"] { background: transparent; border: none; border-bottom: 1px solid #E5E0D5; padding: 4px 0; font-family: 'Geist Mono', monospace; font-size: 18px; color: #1A2332; width: 100%; }
        input[type="number"]:focus { outline: none; border-bottom-color: #1A2332; }
      `}</style>

      <div className="max-w-6xl mx-auto px-8 py-12">

        <div className="mb-10 pb-8 border-b flex items-end justify-between flex-wrap gap-4" style={{ borderColor: "#E5E0D5" }}>
          <div>
            <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#B8865B" }}>
              Creative Services / Performance ROI
            </div>
            <h1 className="display text-5xl font-medium mb-2">Performance Impact Model</h1>
            <p className="text-sm" style={{ color: "#6B6256" }}>
              Plug in your transaction figures. See what a measurable lift in field performance is worth.
            </p>
          </div>
          <button
            onClick={() => { setState(DEFAULT); }}
            className="mono text-xs uppercase tracking-wider px-4 py-2 border flex items-center gap-2 hover:bg-white transition-colors"
            style={{ borderColor: "#E5E0D5", color: "#6B6256" }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        {/* Scenario presets */}
        <div className="mb-8">
          <div className="mono text-xs uppercase tracking-widest mb-3" style={{ color: "#6B6256" }}>Use case</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="text-left p-4 border transition-colors"
                style={{
                  borderColor: state.preset === key ? "#1A2332" : "#E5E0D5",
                  background: state.preset === key ? "#FAF6EE" : "white",
                }}
              >
                <div className="text-sm font-medium mb-1">{preset.label}</div>
                <div className="text-xs leading-relaxed" style={{ color: "#6B6256" }}>{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Input section */}
        <div className="bg-white p-7 border mb-8" style={{ borderColor: "#E5E0D5" }}>
          <div className="flex items-center gap-2 mb-6">
            <Calculator size={16} style={{ color: "#B8865B" }} />
            <h2 className="mono text-xs tracking-widest uppercase">Inputs</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-6">
            <div>
              <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>
                Annual customer interactions
              </label>
              <input
                type="number"
                value={state.annualInteractions}
                onChange={(e) => setState({ ...state, annualInteractions: Math.max(0, +e.target.value || 0), preset: "custom" })}
                step="10000"
              />
              <div className="text-xs mt-2" style={{ color: "#6B6256" }}>
                Total qualifying customer-touch events per year
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>
                Average value per success ($)
              </label>
              <input
                type="number"
                value={state.avgValue}
                onChange={(e) => setState({ ...state, avgValue: Math.max(0, +e.target.value || 0), preset: "custom" })}
                step="5"
              />
              <div className="text-xs mt-2" style={{ color: "#6B6256" }}>
                Revenue, margin, or attach value per successful outcome
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "#6B6256" }}>
                Current baseline conversion (%)
              </label>
              <input
                type="number"
                value={state.baselineRate}
                onChange={(e) => setState({ ...state, baselineRate: Math.max(0, Math.min(100, +e.target.value || 0)), preset: "custom" })}
                step="1"
                min="0"
                max="100"
              />
              <div className="text-xs mt-2" style={{ color: "#6B6256" }}>
                Current % of interactions that succeed today
              </div>
            </div>
          </div>

          <div className="pt-6 border-t" style={{ borderColor: "#E5E0D5" }}>
            <div className="flex justify-between items-baseline mb-3">
              <label className="text-sm" style={{ color: "#6B6256" }}>Annual platform cost</label>
              <span className="mono text-2xl font-medium">{fmtUSDFull(state.platformCost)}</span>
            </div>
            <input
              type="range" min="5000" max="60000" step="1000"
              value={state.platformCost}
              onChange={(e) => setState({ ...state, platformCost: +e.target.value })}
              className="w-full"
            />
            <div className="flex justify-between mono text-xs mt-2" style={{ color: "#6B6256" }}>
              <span>$5K</span><span>Recommended envelope $24K-$36K</span><span>$60K</span>
            </div>
          </div>
        </div>

        {/* Baseline summary */}
        <div className="bg-white p-7 border mb-8" style={{ borderColor: "#E5E0D5" }}>
          <div className="mono text-xs tracking-widest uppercase mb-4" style={{ color: "#6B6256" }}>
            Today, without the platform
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Successful outcomes/year</div>
              <div className="mono text-2xl font-medium">{Math.round(calc.baselineSuccesses).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Annual revenue (baseline)</div>
              <div className="mono text-2xl font-medium">{fmtUSDFull(calc.baselineRevenue)}</div>
            </div>
            <div>
              <div className="text-xs mb-2" style={{ color: "#6B6256" }}>Conversion rate</div>
              <div className="mono text-2xl font-medium">{state.baselineRate}%</div>
            </div>
          </div>
        </div>

        {/* Break-even callout */}
        <div className="p-7 border-2 mb-10" style={{ borderColor: "#1A2332", background: "white" }}>
          <div className="flex items-start gap-3">
            <Target size={20} style={{ color: "#B8865B", flexShrink: 0, marginTop: 2 }} />
            <div className="flex-1">
              <div className="mono text-xs tracking-widest uppercase mb-2" style={{ color: "#B8865B" }}>
                Break-even threshold
              </div>
              <div className="display text-3xl font-medium mb-2" style={{ color: "#1A2332" }}>
                A {calc.breakEvenLift.toFixed(3)}% lift covers the entire platform cost
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "#6B6256" }}>
                Any performance improvement above this threshold is pure net return to U-Haul.
                Published research on interactive scenario-based training shows lifts of 5 to 15% over passive document-based learning. The bar to win is exceptionally low.
              </p>
            </div>
          </div>
        </div>

        {/* Results table */}
        <h2 className="display text-2xl font-medium mb-5">Revenue impact by performance lift</h2>
        <div className="bg-white border mb-8" style={{ borderColor: "#E5E0D5" }}>
          <div className="grid grid-cols-5 px-6 py-3 mono text-xs uppercase tracking-wider border-b" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
            <div>Lift</div>
            <div className="text-right">Extra successes/yr</div>
            <div className="text-right">Incremental revenue</div>
            <div className="text-right">Net (after platform)</div>
            <div className="text-right">ROI multiple</div>
          </div>
          {calc.results.map((r, i) => {
            const isHighlight = r.lift === 3;
            return (
              <div
                key={i}
                className="grid grid-cols-5 px-6 py-4 border-b last:border-b-0 items-baseline"
                style={{
                  borderColor: "#E5E0D5",
                  background: isHighlight ? "#FAF6EE" : "white",
                }}
              >
                <div className="mono text-lg font-medium">{r.lift}%</div>
                <div className="mono text-base text-right">{Math.round(r.incrementalSuccesses).toLocaleString()}</div>
                <div className="mono text-lg font-medium text-right">{fmtUSDFull(r.incrementalRevenue)}</div>
                <div className="mono text-base text-right" style={{ color: r.netReturn > 0 ? "#1E7A46" : "#9B2D2D" }}>
                  {r.netReturn >= 0 ? "+" : ""}{fmtUSDFull(r.netReturn)}
                </div>
                <div className="mono text-base text-right">{r.roiMultiple < 1 ? r.roiMultiple.toFixed(2) + "x" : Math.round(r.roiMultiple).toLocaleString() + "x"}</div>
              </div>
            );
          })}
        </div>

        {/* Chart */}
        <h2 className="display text-2xl font-medium mb-5">Incremental revenue by lift scenario</h2>
        <div className="bg-white p-6 border mb-10" style={{ borderColor: "#E5E0D5" }}>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="#F0EBE0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fontFamily: "Geist Mono", fill: "#6B6256" }}
                  axisLine={{ stroke: "#E5E0D5" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: "Geist Mono", fill: "#6B6256" }}
                  axisLine={{ stroke: "#E5E0D5" }}
                  tickLine={false}
                  tickFormatter={(v) => fmtUSD(v)}
                />
                <Tooltip
                  contentStyle={{ background: "#1A2332", border: "none", borderRadius: 4, color: "#FAF8F3", fontSize: 12, fontFamily: "Geist Mono" }}
                  formatter={(v) => [fmtUSDFull(v), "Incremental revenue"]}
                  cursor={{ fill: "rgba(184, 134, 91, 0.06)" }}
                />
                <ReferenceLine
                  y={state.platformCost}
                  stroke="#9B2D2D"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  label={{ value: `Platform cost: ${fmtUSDFull(state.platformCost)}`, position: "insideTopLeft", fill: "#9B2D2D", fontSize: 11, fontFamily: "Geist Mono" }}
                />
                <Bar dataKey="revenue" fill="#1A2332" radius={[2, 2, 0, 0]} maxBarSize={64} isAnimationActive={false}>
                  <LabelList dataKey="revenue" position="top" formatter={(v) => fmtUSD(v)} style={{ fontSize: 11, fontFamily: "Geist Mono", fill: "#1A2332" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Footnotes */}
        <div className="pt-6 border-t text-xs leading-relaxed" style={{ borderColor: "#E5E0D5", color: "#6B6256" }}>
          <div className="mono text-xs tracking-widest uppercase mb-3" style={{ color: "#1A2332" }}>Methodology notes</div>
          <p className="mb-2">
            Preset values for interaction volume, average value, and baseline conversion are illustrative starting points. Replace them with U-Haul's actual figures for a precise model. The platform cost slider reflects the recommended annual envelope.
          </p>
          <p className="mb-2">
            Performance lift is shown as additional percentage points on the baseline conversion rate. A 3% lift on a 55% baseline means the new rate is 58%, not 56.65%.
          </p>
          <p>
            ROI multiple is incremental revenue divided by platform cost. Net return subtracts platform cost from incremental revenue. The platform is not modeled to consume any portion of the lift it produces.
          </p>
        </div>

      </div>
    </div>
  );
}
