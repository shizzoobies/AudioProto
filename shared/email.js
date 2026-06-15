// Shared email helper. Sends invite emails via Resend.
//
// sendInviteEmail(env, { to, name, url, expiresAt })
//   -> { ok: true, id }          on success
//   -> { ok: false, error, detail? }  on any failure
//
// Never throws. Degrades cleanly if RESEND_API_KEY is absent.

const RESEND_API = 'https://api.resend.com/emails';

export async function sendInviteEmail(env, { to, name, url, expiresAt }) {
  const apiKey = env?.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  // Default matches the verified root domain in Resend. Override via env
  // INVITE_FROM_ADDRESS if you've also verified a sending subdomain.
  const from = env?.INVITE_FROM_ADDRESS || 'Meridian Simulations <training@ka-testing.com>';
  const subject = 'Your Meridian simulation is ready';
  const displayName = name || to;

  const expiryLine = expiresAt
    ? `<p style="margin:0 0 0 0;font-size:13px;color:#6b7280;">This link is active until ${fmtExpiry(expiresAt)}.</p>`
    : '';
  const expiryText = expiresAt ? `\nThis link is active until ${fmtExpiry(expiresAt)}.` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header strip -->
          <tr>
            <td style="background:#8c1d2b;padding:20px 36px;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f9c8cc;">CALL SIMULATOR</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">Your simulation is ready${displayName && displayName !== to ? ', ' + escapeHtml(displayName) : ''}.</h1>
              <p style="margin:0 0 28px 0;font-size:15px;color:#4b5563;line-height:1.6;">
                You've been invited to practice sales conversations on Meridian's call simulator. Click the button below to get started. No account needed.
              </p>

              <!-- CTA button — real <a> so Outlook renders it -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="border-radius:8px;background:#8c1d2b;">
                    <a href="${escapeAttr(url)}"
                       target="_blank"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:#8c1d2b;">
                      Take the call
                    </a>
                  </td>
                </tr>
              </table>

              ${expiryLine}

              <!-- Plain-URL fallback -->
              <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
                If the button doesn't work, copy this link into your browser:<br>
                <a href="${escapeAttr(url)}" style="color:#8c1d2b;word-break:break-all;">${escapeHtml(url)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 36px 24px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Meridian Simulations. This email was sent by your simulation administrator.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Your Meridian simulation is ready${displayName && displayName !== to ? ', ' + displayName : ''}.

You've been invited to practice sales conversations on Meridian's call simulator. Follow the link below to get started. No account needed.

${url}
${expiryText}

---
Meridian Simulations. This email was sent by your simulation administrator.`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `resend_${res.status}`, detail: body.slice(0, 500) };
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    return { ok: true, id: parsed.id || null };
  } catch (e) {
    return { ok: false, error: 'network', detail: String(e) };
  }
}

// Sends the "you've been granted admin access" email to a named admin. Mirrors
// sendInviteEmail: same inline-styled HTML, maroon CTA, never throws, degrades
// to { ok:false, error:'no_api_key' } when RESEND_API_KEY is absent.
//
// sendAdminInviteEmail(env, { to, name, url })
//   -> { ok: true, id }              on success
//   -> { ok: false, error, detail? } on any failure
export async function sendAdminInviteEmail(env, { to, name, url }) {
  const apiKey = env?.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const from = env?.INVITE_FROM_ADDRESS || 'Meridian Simulations <training@ka-testing.com>';
  const subject = "You've been given admin access to the Call Simulator";
  const displayName = name || to;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header strip -->
          <tr>
            <td style="background:#8c1d2b;padding:20px 36px;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f9c8cc;">CALL SIMULATOR</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">You've been given admin access${displayName && displayName !== to ? ', ' + escapeHtml(displayName) : ''}.</h1>
              <p style="margin:0 0 28px 0;font-size:15px;color:#4b5563;line-height:1.6;">
                You can now manage simulation invites on Meridian's call simulator: send invites, pick scenarios, and track usage. Click the button below to open the admin dashboard. No password needed; this link signs you in.
              </p>

              <!-- CTA button — real <a> so Outlook renders it -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="border-radius:8px;background:#8c1d2b;">
                    <a href="${escapeAttr(url)}"
                       target="_blank"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:#8c1d2b;">
                      Open the admin dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain-URL fallback -->
              <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
                If the button doesn't work, copy this link into your browser:<br>
                <a href="${escapeAttr(url)}" style="color:#8c1d2b;word-break:break-all;">${escapeHtml(url)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 36px 24px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Meridian Simulations. This email was sent by a call simulator administrator.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `You've been given admin access${displayName && displayName !== to ? ', ' + displayName : ''}.

You can now manage simulation invites on Meridian's call simulator: send invites, pick scenarios, and track usage. Follow the link below to open the admin dashboard. No password needed; this link signs you in.

${url}

---
Meridian Simulations. This email was sent by a call simulator administrator.`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `resend_${res.status}`, detail: body.slice(0, 500) };
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    return { ok: true, id: parsed.id || null };
  } catch (e) {
    return { ok: false, error: 'network', detail: String(e) };
  }
}

// Sends the "you can author coaching scenarios" email to a per-person scenario
// editor. Mirrors the others: inline-styled HTML, maroon CTA, never throws,
// degrades to { ok:false, error:'no_api_key' } when RESEND_API_KEY is absent.
//
// sendCoachingEditorEmail(env, { to, name, url })
//   -> { ok: true, id }              on success
//   -> { ok: false, error, detail? } on any failure
export async function sendCoachingEditorEmail(env, { to, name, url }) {
  const apiKey = env?.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const from = env?.INVITE_FROM_ADDRESS || 'Meridian Simulations <training@ka-testing.com>';
  const subject = "You've been invited to author coaching scenarios";
  const displayName = name || to;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#8c1d2b;padding:20px 36px;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#f9c8cc;">COACHING SCENARIOS</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">You can now author coaching scenarios${displayName && displayName !== to ? ', ' + escapeHtml(displayName) : ''}.</h1>
              <p style="margin:0 0 28px 0;font-size:15px;color:#4b5563;line-height:1.6;">
                You've been given access to the Scenarios editor. Create and manage the coachable employee personas managers practice on. Click below to open it. No password needed; this link signs you in. It opens ONLY the Scenarios editor, nothing else.
              </p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="border-radius:8px;background:#8c1d2b;">
                    <a href="${escapeAttr(url)}"
                       target="_blank"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:#8c1d2b;">
                      Open the Scenarios editor
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
                If the button doesn't work, copy this link into your browser:<br>
                <a href="${escapeAttr(url)}" style="color:#8c1d2b;word-break:break-all;">${escapeHtml(url)}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 24px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Meridian Simulations. This email was sent by a simulation administrator.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `You can now author coaching scenarios${displayName && displayName !== to ? ', ' + displayName : ''}.

You've been given access to the Scenarios editor. Create and manage the coachable employee personas managers practice on. Follow the link below to open it. No password needed; this link signs you in. It opens ONLY the Scenarios editor.

${url}

---
Meridian Simulations. This email was sent by a simulation administrator.`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `resend_${res.status}`, detail: body.slice(0, 500) };
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    return { ok: true, id: parsed.id || null };
  } catch (e) {
    return { ok: false, error: 'network', detail: String(e) };
  }
}

// ---- helpers ----------------------------------------------------------------

function fmtExpiry(ts) {
  try {
    return new Date(ts * 1000).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return String(ts);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function escapeAttr(s) {
  return escapeHtml(s);
}
