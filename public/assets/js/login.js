(function () {
  const form = document.getElementById('auth-form');
  const errorEl = document.getElementById('auth-error');
  const passwordEl = document.getElementById('password');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';

    const password = passwordEl.value;
    if (!password) {
      errorEl.textContent = 'Please enter the password.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking...';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });

      if (res.ok) {
        window.location.href = '/app';
        return;
      }

      if (res.status === 401) {
        errorEl.textContent = 'That password did not match. Try again.';
        passwordEl.select();
      } else {
        errorEl.textContent = 'Something went wrong. Please retry.';
      }
    } catch (err) {
      errorEl.textContent = 'Network error. Check your connection and retry.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue';
    }
  });
})();
