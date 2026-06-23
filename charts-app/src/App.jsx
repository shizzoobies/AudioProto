import TrainingMinuteAllocator from "./components/TrainingMinuteAllocator";

// The /charts sub-page now serves a single tool: the Training minute allocator
// (ElevenLabs agent minutes + Claude Team seats + Cloudflare cost model). The
// older Cost / Budget / ROI tab components were removed.
export default function App() {
  return <TrainingMinuteAllocator />;
}
