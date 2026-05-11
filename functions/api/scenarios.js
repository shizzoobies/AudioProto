import { listScenariosForDisplay } from '../../shared/scenarios.js';

export async function onRequestGet() {
  return new Response(JSON.stringify({ scenarios: listScenariosForDisplay() }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
