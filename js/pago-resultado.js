(function () {
  const cfg = window.RESERVA_CONFIG || {};
  const API_URL = (cfg.API_URL || '').replace(/\/$/, '');
  const API_KEY = cfg.API_KEY || '';

  const params = new URLSearchParams(location.search);
  let token = params.get('token') || '';
  let reference = params.get('reference') || params.get('id') || '';

  // Wompi a veces deja params propios; también leemos sessionStorage
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

  async function apiGet(path) {
    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      throw new Error(json.message || 'Error consultando pago');
    }
    return json.data;
  }

  function renderPending(info) {
    if (leadEl) leadEl.textContent = 'Tu pago está en proceso. Esto puede tomar unos segundos.';
    if (statusEl) {
      statusEl.className = 'status-box';
      statusEl.innerHTML = `
        <strong style="display:block;margin-bottom:0.5rem;color:#f3c45d">Pendiente de confirmación</strong>
        Estamos esperando la confirmación de Wompi.<br/>
        ${reference ? `<span style="font-size:0.8rem;opacity:0.7">Ref: ${escapeHtml(reference)}</span>` : ''}
        ${info?.monto_total != null ? `<div style="margin-top:0.75rem">${money(info.monto_total)}</div>` : ''}
      `;
    }
  }

  function renderApproved(info) {
    if (leadEl) leadEl.textContent = '¡Pago confirmado! Ya puedes descargar tus boletas.';
    const cedulaHint = '';
    if (cardEl) {
      cardEl.innerHTML = `
        <div style="text-align:center">
          <div class="verify-badge">
            <span style="width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block"></span>
            PAGO APROBADO
          </div>
          <p class="verify-nums" style="font-size:1.4rem;margin:0.75rem 0">${money(info.monto_total)}</p>
          <p style="color:#a8a29a;margin:0 0 1rem">Estado: ${escapeHtml(info.estado || 'PAGADA')}</p>
          <a class="btn-gold cut" href="./mis-boletas.html" style="display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 1.25rem;text-decoration:none">
            Descargar mis boletas
          </a>
          ${cedulaHint}
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
          ${info?.pago?.status ? `<p style="margin-top:0.75rem;font-size:0.8rem">Estado Wompi: ${escapeHtml(info.pago.status)}</p>` : ''}
        </div>
      `;
    }
  }

  async function pollOnce() {
    if (!token && !reference) {
      renderDeclined(null, 'No encontramos la referencia del pago');
      return 'stop';
    }

    let info = null;
    if (token) {
      info = await apiGet(`/ventas-online/reservas/${encodeURIComponent(token)}/estado`);
    } else if (reference) {
      const pago = await apiGet(`/ventas-online/pagos/${encodeURIComponent(reference)}`);
      info = {
        estado: pago.estado_venta,
        monto_total: pago.amount,
        puede_descargar: pago.puede_descargar,
        pago: pago,
      };
    }

    const puede = info?.puede_descargar || info?.pago?.puede_descargar;
    const estado = String(info?.estado || info?.pago?.estado_venta || '').toUpperCase();
    const pagoStatus = String(info?.pago?.status || '').toUpperCase();

    if (puede || estado === 'PAGADA') {
      renderApproved(info);
      return 'stop';
    }

    if (['DECLINED', 'VOIDED', 'ERROR'].includes(pagoStatus)) {
      renderDeclined(info, 'Pago rechazado o anulado');
      return 'stop';
    }

    renderPending(info);
    return 'continue';
  }

  async function run() {
    let attempts = 0;
    const maxAttempts = 40; // ~2 min con intervalo 3s
    while (attempts < maxAttempts) {
      try {
        const r = await pollOnce();
        if (r === 'stop') return;
      } catch (err) {
        if (statusEl) {
          statusEl.className = 'status-box is-error';
          statusEl.textContent = err.message || 'Error consultando el pago';
        }
      }
      attempts += 1;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (leadEl) {
      leadEl.textContent =
        'Aún no llega la confirmación. Si ya pagaste, revisa Mis boletas en unos minutos.';
    }
  }

  run();
})();
