import React, { useState } from "react";
import { Users, Clock, Gauge, TriangleAlert, Phone, RotateCcw, Printer, Server, Layers, Sparkles, TrendingUp, BookOpen, ShieldCheck, Wand2, MousePointerClick, Newspaper, Bot, Wrench, FolderSearch, Workflow } from "lucide-react";

const CAPABILITIES = [
  { icon: BookOpen, tag: "build + audit: days → hours", title: "Faster course lifecycle", desc: "Create, update, and audit courses an order of magnitude faster, at higher quality, with native HTML and AI built in where it earns its place." },
  { icon: ShieldCheck, tag: "live system → safe replica", title: "Risk-free sandbox", desc: "A full working replica of the POS and the reservation flow, so trainees rehearse the real process without ever touching customer trust." },
  { icon: Wand2, tag: "hours/days → minutes", title: "Adobe Creative Suite on tap", desc: "Wired into Creative Suite, production that took hours or days drops to minutes for an Adobe user who knows what to ask for." },
  { icon: MousePointerClick, tag: "completion → behavior", title: "Click-level analytics", desc: "Past completions and scores: see where people click, how often, and which parts of a page they actually engage with." },
  { icon: Newspaper, tag: "static doc → interactive", title: "Interactive publications", desc: "Customer Journey, UnBoxed, and the rest as full interactive HTML with instant and AI search, a quality the Microsoft stack cannot reach." },
  { icon: Bot, tag: "bolt-on → built-in", title: "AI woven in", desc: "Voice agents, chat agents, and assistive AI dropped into almost anything the team builds, not stapled on after." },
  { icon: Wrench, tag: "meetings → working tool", title: "Purpose-built tools", desc: "Custom apps for a single manager, instructor, or admin to kill repetitive work. Sit with anyone for a day, ship their tool by week's end." },
  { icon: FolderSearch, tag: "ask around → find in seconds", title: "Team asset memory", desc: "A searchable repository of everything Creative Services has made, so anyone can pull a teammate's asset in seconds, even when that teammate is out." },
  { icon: Workflow, tag: "schedule a meeting → instant brief", title: "Automated intake + storyboard", desc: "A director messages in Teams, Power Automate routes it, and Claude Opus returns a started storyboard against your ruleset with requester contact info, asking the clarifying questions a CS member would. No kickoff meeting, scaffolding from minute one." },
];

const PLANS = [
  { key: "pro", name: "Pro", base: 99, included: 1100 },
  { key: "scale", name: "Scale", base: 330, included: 3600 },
  { key: "business", name: "Business", base: 990, included: 13750 },
];

// Claude Team seat rates ($/seat/mo). 5-seat minimum, mix and match.
const SEAT = {
  standard: { monthly: 25, annual: 20 },
  premium: { monthly: 125, annual: 100 },
};

const DEFAULTS = {
  headcount: 150,
  activePct: 100,
  minutesPerPerson: 10,
  sessionLength: 10,
  llmRate: 0.0083,
  overageRate: 0.08,
  elBilling: "monthly",
  freeMonths: 2,
  stdSeats: 5,
  premSeats: 0,
  cfDomainAnnual: 11,
};

const usd = (n, dp = 2) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (n, dp = 0) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function TrainingMinuteAllocator() {
  const [headcount, setHeadcount] = useState(DEFAULTS.headcount);
  const [activePct, setActivePct] = useState(DEFAULTS.activePct);
  const [minutesPerPerson, setMinutesPerPerson] = useState(DEFAULTS.minutesPerPerson);
  const [sessionLength, setSessionLength] = useState(DEFAULTS.sessionLength);
  const [llmRate, setLlmRate] = useState(DEFAULTS.llmRate);
  const [overageRate, setOverageRate] = useState(DEFAULTS.overageRate);
  const [elBilling, setElBilling] = useState(DEFAULTS.elBilling);
  const [freeMonths, setFreeMonths] = useState(DEFAULTS.freeMonths);
  const [stdSeats, setStdSeats] = useState(DEFAULTS.stdSeats);
  const [premSeats, setPremSeats] = useState(DEFAULTS.premSeats);
  const [cfDomainAnnual, setCfDomainAnnual] = useState(DEFAULTS.cfDomainAnnual);
  const [viewPlan, setViewPlan] = useState("pro");
  const [showAdv, setShowAdv] = useState(false);

  const n = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);

  const activeUsers = Math.max(0, Math.round((n(headcount) * n(activePct)) / 100));
  const totalMinutes = Math.max(0, activeUsers * n(minutesPerPerson));

  const annual = elBilling === "annual";
  const billingFactor = annual ? Math.max(0, (12 - n(freeMonths)) / 12) : 1;

  const compute = (plan) => {
    const effBase = plan.base * billingFactor;
    const overageMin = Math.max(0, totalMinutes - plan.included);
    const voiceCost = overageMin * n(overageRate);
    const llmCost = totalMinutes * n(llmRate);
    const total = effBase + voiceCost + llmCost;
    return { ...plan, effBase, overageMin, voiceCost, llmCost, total };
  };

  const results = PLANS.map(compute);
  const cheapest = results.reduce((a, b) => (b.total < a.total ? b : a), results[0]);
  const view = results.find((r) => r.key === viewPlan) || results[0];

  const perUser = activeUsers > 0 ? view.total / activeUsers : view.total;
  const perMinAll = totalMinutes > 0 ? view.total / totalMinutes : 0;
  const inBundle = totalMinutes <= view.included;
  const marginalPerMin = inBundle ? n(llmRate) : n(overageRate) + n(llmRate);
  const sessionsPerPerson = n(sessionLength) > 0 ? n(minutesPerPerson) / n(sessionLength) : 0;
  const bundleMinPerHead = activeUsers > 0 ? view.included / activeUsers : 0;

  const elSavingsPerYear = annual ? view.base * n(freeMonths) : 0;

  // ---- rest of the stack ----
  const stdRate = annual ? SEAT.standard.annual : SEAT.standard.monthly;
  const premRate = annual ? SEAT.premium.annual : SEAT.premium.monthly;
  const totalSeats = n(stdSeats) + n(premSeats);
  const claudeMonthly = n(stdSeats) * stdRate + n(premSeats) * premRate;
  const seatsBelowMin = totalSeats < 5;

  const domainMonthly = n(cfDomainAnnual) / 12;
  const infraMonthly = claudeMonthly + domainMonthly;
  const audioMonthly = view.total;
  const grandMonthly = audioMonthly + infraMonthly;
  const grandAnnual = grandMonthly * 12;
  const audioShare = grandMonthly > 0 ? (audioMonthly / grandMonthly) * 100 : 0;

  const trackMax = Math.max(view.included, totalMinutes, 1);
  const withinPct = (Math.min(totalMinutes, view.included) / trackMax) * 100;
  const overPct = (Math.max(0, totalMinutes - view.included) / trackMax) * 100;
  const redlinePos = (view.included / trackMax) * 100;

  const reset = () => {
    setHeadcount(DEFAULTS.headcount);
    setActivePct(DEFAULTS.activePct);
    setMinutesPerPerson(DEFAULTS.minutesPerPerson);
    setSessionLength(DEFAULTS.sessionLength);
    setLlmRate(DEFAULTS.llmRate);
    setOverageRate(DEFAULTS.overageRate);
    setElBilling(DEFAULTS.elBilling);
    setFreeMonths(DEFAULTS.freeMonths);
    setStdSeats(DEFAULTS.stdSeats);
    setPremSeats(DEFAULTS.premSeats);
    setCfDomainAnnual(DEFAULTS.cfDomainAnnual);
    setViewPlan("pro");
  };

  const Field = ({ label, suffix, value, onChange, step = 1, min = 0 }) => (
    <label className="block">
      <span className="block text-xs uppercase tracking-widest text-slate-400 mb-1.5">{label}</span>
      <div className="flex items-stretch">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-l px-3 py-2 font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400 [appearance:textfield]"
        />
        {suffix ? (
          <span className="inline-flex items-center px-3 bg-slate-900 border border-l-0 border-slate-700 rounded-r text-xs text-slate-400 font-mono">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        {/* header */}
        <div className="flex items-end justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 text-teal-400">
              <Phone size={14} />
              <span className="text-xs uppercase tracking-[0.25em]">ElevenLabs Agents</span>
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
              Training minute allocator
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              How much voice-agent practice you can hand out before the meter turns red.
            </p>
          </div>
          <div className="no-print shrink-0 flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded border border-teal-500/40 bg-teal-400/10 px-3 py-2 text-xs text-teal-200 hover:bg-teal-400/20"
            >
              <Printer size={13} /> Save as PDF
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* controls */}
          <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 mb-4">Your cohort</h2>
            <div className="space-y-4">
              <Field label="People this month" suffix="heads" value={headcount} onChange={setHeadcount} />
              <Field label="Share that actually use the tool" suffix="%" value={activePct} onChange={setActivePct} min={0} />

              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-widest text-slate-400">Minutes per active person</span>
                  <span className="font-mono text-teal-400 text-sm">{num(minutesPerPerson, 1)} min / mo</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={0.5}
                  value={minutesPerPerson}
                  onChange={(e) => setMinutesPerPerson(+e.target.value)}
                  className="mt-2 w-full accent-teal-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0</span><span>180</span><span>360</span>
                </div>
              </div>

              <Field label="Avg session length" suffix="min" value={sessionLength} onChange={setSessionLength} min={0} />
            </div>

            <button
              onClick={() => setShowAdv((s) => !s)}
              className="mt-5 text-xs text-slate-400 hover:text-slate-200 underline underline-offset-4"
            >
              {showAdv ? "Hide rates" : "Edit rates (LLM / overage / annual)"}
            </button>
            {showAdv && (
              <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                <Field label="LLM passthrough, Qwen (all minutes)" suffix="$/min" value={llmRate} step={0.0001} onChange={setLlmRate} />
                <Field label="Voice overage (past bundle)" suffix="$/min" value={overageRate} step={0.01} onChange={setOverageRate} />
                <Field label="Annual billing = months free" suffix="mo" value={freeMonths} step={1} onChange={setFreeMonths} />
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Annual discount applies to the ElevenLabs base only. Overage and LLM are usage and are never discounted. LLM is charged on every minute; set it to 0 if it draws from prepaid credits instead.
                </p>
              </div>
            )}
          </div>

          {/* readout */}
          <div className="lg:col-span-3 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xs uppercase tracking-widest text-slate-400">
                ElevenLabs cost · {view.name}
              </h2>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded border border-slate-700 p-0.5 bg-slate-800">
                  {["monthly", "annual"].map((b) => (
                    <button
                      key={b}
                      onClick={() => setElBilling(b)}
                      className={
                        "px-2.5 py-1 text-[11px] rounded capitalize " +
                        (elBilling === b ? "bg-teal-400 text-slate-900 font-medium" : "text-slate-300")
                      }
                    >
                      {b}
                    </button>
                  ))}
                </div>
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium " +
                    (inBundle ? "bg-teal-400/10 text-teal-300" : "bg-amber-400/10 text-amber-300")
                  }
                >
                  {inBundle ? <Gauge size={12} /> : <TriangleAlert size={12} />}
                  {inBundle ? "Within bundle" : "In overage"}
                </span>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Monthly / Annual toggle also sets the Claude Team seat rate below.</p>

            <div className="mt-2 flex items-end gap-3">
              <span className="font-mono text-5xl sm:text-6xl font-semibold tracking-tight tabular-nums">
                {usd(view.total, view.total >= 1000 ? 0 : 2)}
              </span>
              <span className="mb-2 text-sm text-slate-400">/ mo</span>
            </div>
            {annual ? (
              <p className="mt-1 text-[12px] text-teal-300/90 font-mono">
                {usd(view.effBase * 12, 0)}/yr billed up front · saves {usd(elSavingsPerYear, 0)}/yr on base
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-slate-500 font-mono">
                {usd(view.total * 12, 0)}/yr at this usage · switch to annual to cut the base
              </p>
            )}

            {/* meter */}
            <div className="mt-6">
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1.5">
                <span>{num(totalMinutes)} min allocated</span>
                <span>{num(view.included)} included</span>
              </div>
              <div className="relative h-6 w-full rounded bg-slate-800 overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-teal-400/80" style={{ width: withinPct + "%" }} />
                <div className="absolute inset-y-0 bg-amber-500" style={{ left: withinPct + "%", width: overPct + "%" }} />
                {redlinePos < 100 && (
                  <div className="absolute inset-y-0 w-px bg-slate-200/70" style={{ left: redlinePos + "%" }} />
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-4 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-teal-400/80" /> included</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-500" /> overage ({num(view.overageMin)} min)</span>
              </div>
            </div>

            {/* stats */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat icon={<Users size={13} />} label="Per active user" value={usd(perUser, perUser >= 100 ? 0 : 2)} sub={`${num(activeUsers)} users`} />
              <Stat icon={<Clock size={13} />} label="All-in / minute" value={usd(perMinAll, 3)} sub={`marginal ${usd(marginalPerMin, 4)}`} />
              <Stat icon={<Gauge size={13} />} label="Free min / head" value={num(bundleMinPerHead, 1)} sub={`≈ ${num(sessionsPerPerson, 1)} sessions ea.`} />
            </div>

            <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
              {inBundle ? (
                <>The bundle covers everyone. You have <span className="text-teal-300 font-mono">{num(view.included - totalMinutes)}</span> minutes of headroom, or <span className="text-teal-300 font-mono">{num(activeUsers > 0 ? (view.included - totalMinutes) / activeUsers : 0, 1)}</span> more minutes per active user, before any overage.</>
              ) : (
                <>You are <span className="text-amber-300 font-mono">{num(view.overageMin)}</span> minutes over. Every extra minute across all heads costs <span className="text-amber-300 font-mono">{usd(n(overageRate) + n(llmRate), 4)}</span>. Pulling each person back by one minute saves about <span className="text-amber-300 font-mono">{usd(activeUsers * (n(overageRate) + n(llmRate)), 2)}</span>/mo.</>
              )}
            </p>
          </div>
        </div>

        {/* plan comparison */}
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 mb-4">
            Same usage, every tier {annual ? "(annual billing)" : "(monthly billing)"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {results.map((r) => {
              const selected = r.key === viewPlan;
              const best = r.key === cheapest.key;
              return (
                <button
                  key={r.key}
                  onClick={() => setViewPlan(r.key)}
                  className={
                    "text-left rounded-lg border p-4 transition " +
                    (selected ? "border-teal-400 bg-slate-800/80 ring-1 ring-teal-400" : "border-slate-700 bg-slate-800/40 hover:border-slate-500")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.name}</span>
                    {best && (
                      <span className="rounded-full bg-teal-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-teal-300">
                        Lowest cost
                      </span>
                    )}
                  </div>
                  <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                    {usd(r.total, r.total >= 1000 ? 0 : 2)}<span className="text-xs text-slate-500"> /mo</span>
                  </div>
                  <dl className="mt-3 space-y-1 text-[11px] font-mono text-slate-400">
                    <Row k={annual ? "base (annual eq.)" : "base"} v={usd(r.effBase, 2)} />
                    <Row k={`voice overage (${num(r.overageMin)}m)`} v={usd(r.voiceCost, 2)} />
                    <Row k="llm" v={usd(r.llmCost, 2)} />
                    <Row k="included min" v={num(r.included)} />
                  </dl>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-slate-400">
            At a flat {usd(n(overageRate), 2)}/min overage, buying minutes through Pro overage stays cheaper than jumping a tier. Move up to Scale or Business only for more concurrent calls, more seats, or a bigger credit pool, not to save on minutes.
          </p>
        </div>

        {/* ---- below the audio stack: rest of the stack ---- */}
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Server size={14} className="text-slate-400" />
            <h2 className="text-xs uppercase tracking-widest text-slate-400">Rest of the stack</h2>
          </div>
          <p className="text-[12px] text-slate-500 mb-4">
            Everything outside the agent. Independent of minutes used. Qwen stays above with the agent; Claude Team seats are the people building and running the tool.
          </p>

          {/* Claude Team seats */}
          <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-teal-400" />
                <span className="text-xs uppercase tracking-widest text-slate-300">Claude Team seats</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {annual ? "annual rate" : "monthly rate"} · {usd(premRate, 0)} prem / {usd(stdRate, 0)} std
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Premium seats (≈5x usage)" suffix="seats" value={premSeats} onChange={setPremSeats} />
              <Field label="Standard seats" suffix="seats" value={stdSeats} onChange={setStdSeats} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-sm">
              <span className={"font-mono text-[12px] " + (seatsBelowMin ? "text-amber-300" : "text-slate-400")}>
                {num(totalSeats)} seats {seatsBelowMin ? "· below 5-seat minimum" : ""}
              </span>
              <span className="font-mono tabular-nums">
                {usd(claudeMonthly, 2)}<span className="text-xs text-slate-500"> /mo</span>
                <span className="text-slate-600"> · </span>
                {usd(claudeMonthly * 12, 0)}<span className="text-xs text-slate-500"> /yr</span>
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Both seat types include Claude Code and Cowork. Premium adds ~5x usage, worth it for whoever is building/running this all day; Standard covers reviewers and occasional users. 5-seat minimum, mix freely.
            </p>
          </div>

          {/* Cloudflare */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Cloudflare domain" suffix="$/yr" value={cfDomainAnnual} step={1} onChange={setCfDomainAnnual} />
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-sm">
            <span className="text-slate-400">Infra subtotal</span>
            <span className="font-mono tabular-nums">
              {usd(infraMonthly, 2)}<span className="text-xs text-slate-500"> /mo</span>
              <span className="text-slate-600"> · </span>
              {usd(infraMonthly * 12, 0)}<span className="text-xs text-slate-500"> /yr</span>
            </span>
          </div>
        </div>

        {/* ---- all-in total ---- */}
        <div className="mt-6 rounded-lg border border-teal-400/30 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers size={14} className="text-teal-400" />
            <h2 className="text-xs uppercase tracking-widest text-slate-300">All-in total</h2>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums">
                {usd(grandMonthly, grandMonthly >= 1000 ? 0 : 2)}<span className="text-base text-slate-400"> /mo</span>
              </div>
              <div className="mt-1 font-mono text-sm text-slate-400">
                {usd(grandAnnual, 0)} / yr {annual ? "· subscriptions billed annually" : "· subscriptions billed monthly"}
              </div>
            </div>
            <div className="text-right text-[12px] font-mono text-slate-400 space-y-0.5">
              <div>audio (agent) <span className="text-slate-200">{usd(audioMonthly, 2)}</span></div>
              <div>infra <span className="text-slate-200">{usd(infraMonthly, 2)}</span></div>
            </div>
          </div>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded bg-slate-800">
            <div className="bg-teal-400/80" style={{ width: audioShare + "%" }} />
            <div className="bg-slate-500" style={{ width: 100 - audioShare + "%" }} />
          </div>
          <div className="mt-1.5 flex items-center gap-4 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-teal-400/80" /> audio {num(audioShare, 0)}%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-slate-500" /> infra {num(100 - audioShare, 0)}%</span>
          </div>
        </div>

        {/* ---- what the seats unlock (capabilities) ---- */}
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-teal-400" />
            <h2 className="text-xs uppercase tracking-widest text-slate-300">The other side of the ledger</h2>
          </div>
          <p className="text-[12px] text-slate-500 mb-4">
            The seats are not just infrastructure for one training tool. They are a productivity multiplier for the whole Creative Services team. Here is what they unlock, and what it takes to pay for them.
          </p>

          {/* capability cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CAPABILITIES.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.title} className="rounded-lg border border-slate-800 bg-slate-800/30 p-4">
                  <div className="flex items-center gap-2 text-teal-400">
                    <Icon size={14} />
                    <span className="text-[10px] uppercase tracking-wider text-teal-300/80 font-mono">{c.tag}</span>
                  </div>
                  <h3 className="mt-2 text-sm font-medium text-slate-100">{c.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{c.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
          ElevenLabs Agents post-Nov-2025 model: bundled minutes per plan, ~{usd(n(overageRate), 2)}/min overage past the bundle, LLM (Qwen ~{usd(n(llmRate), 4)}/min) on every minute, voice included in the agent minute. Annual applies {num(freeMonths)} free months to the ElevenLabs base. Claude Team: Standard {usd(SEAT.standard.monthly, 0)}/mo ({usd(SEAT.standard.annual, 0)} annual), Premium {usd(SEAT.premium.monthly, 0)}/mo ({usd(SEAT.premium.annual, 0)} annual), 5-seat minimum. Verify live rates in the ElevenLabs and Claude dashboards.
        </p>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] font-mono text-slate-500">{sub}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-300">{v}</dd>
    </div>
  );
}
