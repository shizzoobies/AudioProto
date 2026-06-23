import TrainingMinuteAllocator from "./components/TrainingMinuteAllocator";

// The /charts sub-page now serves a single tool: the Training minute allocator
// (ElevenLabs agent minutes + Claude Team seats + Cloudflare cost model). The
// older Cost / Budget / ROI tabs were retired; their component files are kept in
// src/components for reference but are no longer mounted.
export default function App() {
  return <TrainingMinuteAllocator />;
}
