async function init() {
  const root = document.getElementById('app-root');
  const signOutBtn = document.getElementById('sign-out');

  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    if (!res.ok) {
      window.location.replace('/');
      return;
    }
  } catch {
    window.location.replace('/');
    return;
  }

  document.body.dataset.appState = 'ready';
  root.innerHTML = `
    <section class="placeholder-shell">
      <h1 class="placeholder-title">You're in.</h1>
      <p class="placeholder-text">The scenario picker and call view will land here in Phase 2.</p>
    </section>
  `;

  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true;
    try {
      await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    } finally {
      window.location.replace('/');
    }
  });
}

init();
