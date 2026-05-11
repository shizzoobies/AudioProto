import { listScenarioTypesForDisplay } from '../../shared/scenarios.js';

export async function onRequestGet() {
  return new Response(
    JSON.stringify({ scenario_types: listScenarioTypesForDisplay() }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}
