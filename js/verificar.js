(function () {
  const cfg = window.RESERVA_CONFIG || {};
  const API_URL = (cfg.API_URL || '').replace(/\/$/, '');
  const T = window.BoletaTicketUI;

  function getHash() {
    const parts = location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('verificar');
    if (idx >= 0 && parts[idx + 1]) {
      return parts[idx + 1].replace(/\.html$/i, '');
    }
    const q = new URLSearchParams(location.search).get('hash');
    if (q) return q;
    // verificar.html?hash=… or trailing fragment
    const file = parts[parts.length - 1] || '';
    if (file && file !== 'verificar.html' && /^[a-f0-9]{32}$/i.test(file)) return file;
    return '';
  }

  function money(n) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(Number(n) || 0);
  }

  function formatDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  }

  function pad(n) {
    return String(n).padStart(4, '0');
  }

  function formatNums(boleta) {
    const nums = T
      ? T.normalizeNums(
          boleta.numeros,
          boleta.numero,
          boleta.id,
          boleta.numero_principal
        )
      : Array.isArray(boleta.numeros) && boleta.numeros.length
        ? boleta.numeros
        : [boleta.numero];
    const principal = nums[0];
    const regalo = nums[1];
    return `
      <div class="verify-nums-labeled">
        <div class="verify-num-card">
          <span>Número principal</span>
          <strong>#${pad(principal)}</strong>
        </div>
        ${
          regalo != null
            ? `<div class="verify-num-card verify-num-card--gift">
                <span>🎁 Número de regalo</span>
                <strong>#${pad(regalo)}</strong>
              </div>`
            : ''
        }
      </div>
      ${
        regalo != null
          ? '<p class="verify-numbers-explanation">Son dos números independientes de 4 cifras, no un número de 8 cifras.</p>'
          : ''
      }`;
  }

  function estadoClass(estado) {
    const e = String(estado || '').toUpperCase();
    if (e === 'PAGADA' || e === 'VENDIDA' || e === 'CON_PAGO') return 'pagada';
    if (e === 'ABONADA') return 'abonada';
    if (e === 'RESERVADA') return 'reservada';
    if (e === 'ANULADA' || e === 'CANCELADA') return 'anulada';
    return 'disponible';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderError(msg) {
    const root = document.getElementById('verify-root');
    if (!root) return;
    root.innerHTML = `
      <div class="status-box is-error">
        <strong style="display:block;font-size:1.2rem;margin-bottom:0.5rem;color:#fca5a5">
          Boleta no encontrada
        </strong>
        ${escapeHtml(msg || 'El código de verificación no es válido o la boleta no existe.')}
      </div>`;
  }

  function renderData(data) {
    const { boleta, rifa, cliente, financiero, abonos, verificado_en } = data;
    const root = document.getElementById('verify-root');
    if (!root) return;

    const ec = estadoClass(boleta.estado);
    const ticketHtml =
      cliente?.nombre && T
        ? `<div class="boleta-ticket-scale verify-ticket" id="verify-ticket">
            ${T.buildTicketHtml({
              boleta: {
                ...boleta,
                saldo_pendiente: Number(financiero?.saldo_pendiente || 0),
              },
              cliente,
              rifaNombre: rifa?.nombre,
              precio: Number(rifa?.precio_boleta || 0),
            })}
          </div>
          <div style="text-align:center;margin:0.8rem 0 1.15rem">
            <button type="button" class="btn-gold cut" id="btn-guardar-boleta">
              Guardar boleta como imagen
            </button>
          </div>`
        : '';
    const abonosHtml =
      Array.isArray(abonos) && abonos.length
        ? `<div style="margin-top:1.25rem">
            <h3 style="margin:0 0 0.65rem;font-size:0.95rem;color:#fafaf9">Historial de abonos</h3>
            ${abonos
              .map(
                (a) => `
              <div class="verify-row">
                <span>${escapeHtml(a.metodo_pago || 'Pago')} · ${formatDate(a.fecha)}</span>
                <strong>${money(a.monto)} · ${escapeHtml(a.estado || '')}</strong>
              </div>`
              )
              .join('')}
          </div>`
        : '';

    root.classList.toggle('verify-card--wide', Boolean(ticketHtml));
    root.innerHTML = `
      <div style="text-align:center">
        <div class="verify-badge">
          <span style="width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block"></span>
          BOLETA VERIFICADA
        </div>
        ${formatNums(boleta)}
        <div class="verify-estado verify-estado--${ec}">${escapeHtml(boleta.estado || '—')}</div>
      </div>

      ${ticketHtml}
      <div class="verify-row"><span>Cliente</span><strong>${escapeHtml(cliente?.nombre || '—')}</strong></div>
      <div class="verify-row"><span>Identificación</span><strong>${escapeHtml(cliente?.identificacion || '—')}</strong></div>
      <div class="verify-row"><span>Proyecto</span><strong>${escapeHtml(rifa?.nombre || '—')}</strong></div>
      <div class="verify-row"><span>Premio</span><strong>${escapeHtml(rifa?.premio_principal || '—')}</strong></div>
      <div class="verify-row"><span>Sorteo</span><strong>${formatDate(rifa?.fecha_sorteo)}</strong></div>
      <div class="verify-row"><span>Valor boleta</span><strong>${money(financiero?.monto_total || rifa?.precio_boleta)}</strong></div>
      <div class="verify-row"><span>Abonado</span><strong>${money(financiero?.abono_total)}</strong></div>
      <div class="verify-row"><span>Saldo</span><strong>${money(financiero?.saldo_pendiente)}</strong></div>
      <div class="verify-row"><span>Estado pago</span><strong>${escapeHtml(financiero?.estado || '—')}</strong></div>
      <div class="verify-row"><span>Verificado</span><strong>${formatDate(verificado_en)}</strong></div>
      ${abonosHtml}
    `;

    document.getElementById('btn-guardar-boleta')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const ticket = document.querySelector('#verify-ticket .boleta-ticket');
      if (!ticket || !T) return;
      button.disabled = true;
      button.textContent = 'Generando imagen…';
      try {
        await T.downloadTicket(ticket, `boleta_${T.pad(boleta.numero)}.png`);
        button.textContent = 'Imagen guardada';
      } catch (error) {
        button.disabled = false;
        button.textContent = error?.name === 'AbortError'
          ? 'Guardar boleta como imagen'
          : 'Intentar guardar de nuevo';
      }
    });
  }

  function irAComprar(data) {
    const rifaId = String(data?.rifa?.id || '');
    const numero = Number(data?.boleta?.numero);
    if (!rifaId || !Number.isInteger(numero)) return false;
    const params = new URLSearchParams({
      rifa: rifaId,
      boleta: String(numero),
      origen: 'qr',
    });
    window.location.replace(`/?${params.toString()}#reservar`);
    return true;
  }

  async function run() {
    const hash = getHash();
    const status = document.getElementById('verify-status');
    if (!hash || !/^[a-f0-9]{32}$/i.test(hash)) {
      renderError('Falta el código de verificación en el enlace del QR.');
      return;
    }
    if (status) status.textContent = 'Validando autenticidad…';

    try {
      const res = await fetch(`${API_URL}/verificar/${encodeURIComponent(hash)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.data) {
        renderError(json.message || 'No se pudo verificar esta boleta.');
        return;
      }
      if (String(json.data.boleta?.estado || '').toUpperCase() === 'DISPONIBLE') {
        if (status) status.textContent = 'Pacha disponible. Abriendo la compra…';
        if (irAComprar(json.data)) return;
      }
      renderData(json.data);
    } catch (err) {
      renderError('Error de conexión al verificar. Intenta de nuevo.');
    }
  }

  run();
})();
