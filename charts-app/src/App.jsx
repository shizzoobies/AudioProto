import { useState } from "react";
import CostCalculator from "./components/CostCalculator";
import BudgetSimulator from "./components/BudgetSimulator";
import ROIModel from "./components/ROIModel";

const TABS = [
  { id: "cost", label: "Cost calculator", component: CostCalculator },
  { id: "budget", label: "Budget tiering", component: BudgetSimulator },
  { id: "roi", label: "Performance ROI", component: ROIModel },
];

export default function App() {
  const [active, setActive] = useState("cost");
  const Active = TABS.find((t) => t.id === active).component;
  return (
    <div style={{ background: "#FAF8F3", minHeight: "100vh" }}>
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#FAF8F3",
          borderBottom: "1px solid #E5E0D5",
          display: "flex",
          gap: 0,
          padding: "0 2rem",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: "1.25rem 1.5rem",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
              color: active === t.id ? "#1A2332" : "#6B6256",
              borderBottom:
                active === t.id ? "2px solid #B8865B" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <Active />
    </div>
  );
}
