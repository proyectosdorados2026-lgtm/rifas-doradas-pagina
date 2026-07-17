(function () {
  const cfg = window.RESERVA_CONFIG || {};
  const API_URL = (cfg.API_URL || '').replace(/\/$/, '');
  const API_KEY = cfg.API_KEY || '';

  const params = new URLSearchParams(location.search);
  let token = params.get('token') || '';
  // Wompi redirect: ?id=<transaction_id>  |  nosotros: ?reference=SD-...
  let reference = params.get('reference') || '';
  let transactionId = params.get('id') || params.get('transaction_id') || '';

  // Si alguien confundió id con reference (legacy), detectar formato SD-
  if (!reference && transactionId && String(transactionId).startsWith('SD-')) {
    reference = transactionId;
    transactionId = '';
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem('sd_last_pago') || 'null');
    if (saved) {
      if (!token && saved.token) token = saved.token;
      if (!reference && saved.reference) reference = saved.reference;
    }
  } catch (_) {
    /* ignore */
  }

  const statusEl = document.getElementById('pago-status');
  const cardEl = document.getElementById('pago-card');
  const leadEl = document.getElementById('pago-lead');

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    return Number(n || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const err = new Error(json.message || 'Demasiadas consultas');
      err.status = 429;
      throw err;
    }
    if (!res.ok || json.success === false) {
      throw new Error(json.message || 'Error consultando pago');
    }
    return json.data;
  }

  function renderPending(info, extraMsg) {
    if (leadEl) leadEl.textContent = 'Tu pago está en proceso. Esto puede tomar unos segundos.';
    if (statusEl) {
      statusEl.className = 'status-box';
      statusEl.innerHTML = `
        <strong style="display:block;margin-bottom:0.5rem;color:#f3c45d">Confirmando pago…</strong>
        ${escapeHtml(extraMsg || 'Estamos verificando con Wompi.')}<br/>
        ${reference ? `<span style="font-size:0.8rem;opacity:0.7">Ref: ${escapeHtml(reference)}</span>` : ''}
        ${transactionId ? `<div style="font-size:0.75rem;opacity:0.55;margin-top:0.35rem">Tx: ${escapeHtml(transactionId)}</div>` : ''}
        ${info?.amount != null || info?.monto_total != null ? `<div style="margin-top:0.75rem">${money(info.amount ?? info.monto_total)}</div>` : ''}
      `;
    }
  }

  function renderApproved(info) {
    if (leadEl) leadEl.textContent = '¡Pago confirmado! Ya puedes descargar tus boletas.';
    if (cardEl) {
      cardEl.innerHTML = `
        <div style="text-align:center">
          <div class="verify-badge">
            <span style="width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block"></span>
            PAGO APROBADO
          </div>
          <p class="verify-nums" style="font-size:1.4rem;margin:0.75rem 0">${money(info.amount ?? info.monto_total)}</p>
          <p style="color:#a8a29a;margin:0 0 1rem">Estado: ${escapeHtml(info.estado_venta || info.estado || 'PAGADA')}</p>
          <a class="btn-gold cut" href="./mis-boletas.html" style="display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 1.25rem;text-decoration:none">
            Descargar mis boletas
          </a>
          <p style="margin-top:1rem;font-size:0.8rem;color:#78716c">
            ${reference ? `Referencia: ${escapeHtml(reference)}` : ''}
          </p>
        </div>
      `;
    }
  }

  function renderDeclined(info, label) {
    if (leadEl) leadEl.textContent = 'No se pudo completar el pago.';
    if (cardEl) {
      cardEl.innerHTML = `
        <div class="status-box is-error">
          <strong style="display:block;margin-bottom:0.5rem">${escapeHtml(label || 'Pago no aprobado')}</strong>
          Puedes intentar de nuevo o pagar por transferencia y enviar el comprobante por WhatsApp.
          <div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.6rem;justify-content:center">
            <a class="btn-gold cut" href="./index.html#reservar" style="display:inline-flex;min-height:44px;align-items:center;padding:0 1rem;text-decoration:none">Volver a participar</a>
            <a class="btn-ghost cut" href="./mis-boletas.html" style="display:inline-flex;min-height:44px;align-items:center;padding:0 1rem;text-decoration:none">Mis boletas</a>
          </div>
        </div>
      `;
    }
  }

  function isApproved(info) {
    if (!info) return false;
    if (info.puede_descargar) return true;
    const estado = String(info.estado_venta || info.estado || '').toUpperCase();
    const status = String(info.status || info.pago?.status || '').toUpperCase();
    return estado === 'PAGADA' || status === 'APPROVED';
  }

  function isRejected(info) {
    const status = String(info?.status || info?.pago?.status || '').toUpperCase();
    return ['DECLINED', 'VOIDED', 'ERROR'].includes(status);
  }

  async function syncOnce() {
    if (!reference && !transactionId && !token) {
      throw new Error('No encontramos la referencia del pago');
    }
    return api('/ventas-online/pagos/sincronizar', {
      method: 'POST',
      body: JSON.stringify({
        reference: reference || null,
        transaction_id: transactionId || null,
        reserva_token: token || null,
      }),
    });
  }

  async function pollEstado() {
    if (token) {
      return api(`/ventas-online/reservas/${encodeURIComponent(token)}/estado`);
    }
    if (reference) {
      return api(`/ventas-online/pagos/${encodeURIComponent(reference)}?refresh=1`);
    }
    return null;
  }

  async function run() {
    if (!token && !reference && !transactionId) {
      renderDeclined(null, 'No encontramos la referencia del pago');
      return;
    }

    renderPending(null, 'Sincronizando con Wompi…');

    // 1) Intentar sincronizar ya (respaldo del webhook)
    try {
      const synced = await syncOnce();
      if (synced?.reference && !reference) reference = synced.reference;
      if (isApproved(synced)) {
        renderApproved(synced);
        return;
      }
      if (isRejected(synced)) {
        renderDeclined(synced, 'Pago no aprobado');
        return;
      }
    } catch (err) {
      if (err.status === 429) {
        renderPending(null, 'Esperando… (límite de consultas). Reintentando…');
      } else {
        renderPending(null, err.message || 'Aún confirmando…');
      }
    }

    // 2) Polling suave
    let attempts = 0;
    const maxAttempts = 24; // ~2 min a 5s
    while (attempts < maxAttempts) {
      attempts += 1;
      await new Promise((r) => setTimeout(r, 5000));
      try {
        // Cada 3 intentos vuelve a sincronizar
        if (attempts % 3 === 0 && (reference || transactionId || token)) {
          const synced = await syncOnce();
          if (synced?.reference && !reference) reference = synced.reference;
          if (isApproved(synced)) {
            renderApproved(synced);
            return;
          }
          if (isRejected(synced)) {
            renderDeclined(synced, 'Pago no aprobado');
            return;
          }
        }

        const info = await pollEstado();
        if (isApproved(info)) {
          renderApproved({
            ...info,
            amount: info.amount ?? info.monto_total,
            estado_venta: info.estado_venta || info.estado,
          });
          return;
        }
        if (isRejected(info)) {
          renderDeclined(info, 'Pago no aprobado');
          return;
        }
        renderPending(info);
      } catch (err) {
        if (err.status === 429) {
          renderPending(null, 'Esperando para no saturar…');
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          renderPending(null, err.message || 'Reintentando…');
        }
      }
    }

    if (leadEl) {
      leadEl.textContent =
        'Aún no llega la confirmación automática. Si ya pagaste, entra a Mis boletas o contáctanos por WhatsApp con tu comprobante.';
    }
  }

  run();
})();
