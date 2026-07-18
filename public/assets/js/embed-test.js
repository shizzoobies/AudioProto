// Harness logic for /embed-test.html (external file because the site-wide CSP
// is script-src 'self' with no inline allowance).

const log = (m) => {
  document.getElementById('log').textContent += '\n' + new Date().toISOString().slice(11, 19) + ' ' + m;
};

document.getElementById('load').addEventListener('click', () => {
  const ct = document.getElementById('ct').value.trim();
  const sid = document.getElementById('sid').value.trim() || 'demo_sales';
  const learner = document.getElementById('learner').value.trim();
  const url = '/embed/call?ct=' + encodeURIComponent(ct)
    + '&sid=' + encodeURIComponent(sid)
    + '&learner=' + encodeURIComponent(learner);
  document.getElementById('frame').src = url;
  log('loading ' + (ct ? url.replace(ct, ct.slice(0, 6) + '...') : url));
});

window.addEventListener('message', (e) => {
  log('message from ' + e.origin + ': ' + JSON.stringify(e.data));
});
