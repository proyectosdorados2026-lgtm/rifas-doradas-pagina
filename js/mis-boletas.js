(function () {
  const cfg = window.RESERVA_CONFIG || {};
  const API_URL = cfg.API_URL || '';
  const API_KEY = cfg.API_KEY || '';
  const T = window.BoletaTicketUI;

  const $ = (id) => document.getElementById(id);

  function toast(msg, type) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type || ''}`.trim();
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-visible'), 3500);
  }

  function setStatus(msg, isError) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
    el.classList.toggle('is-error', Boolean(isError));
  }

  function getCedulaFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('mis-boletas');
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
    const q = new URLSearchParams(location.search).get('cedula');
    return q || '';
  }

  async function fetchBoletas(identificacion) {
    const res = await fetch(
      `${API_URL}/public/cliente/${encodeURIComponent(identificacion)}/boletas`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'No encontramos boletas para esa cédula.');
    }
    return json.data;
  }

  function render(data) {
    const resultado = $('resultado');
    const clienteBar = $('cliente-bar');
    const container = $('rifas-container');
    if (!resultado || !clienteBar || !container) return;

    const { cliente, rifas, total_boletas } = data;
    if (!cliente || !rifas?.length) {
      resultado.classList.add('hidden');
      setStatus('No hay boletas asociadas a esta cédula.', true);
      return;
    }

    setStatus('');
    resultado.classList.remove('hidden');
    clienteBar.innerHTML = `
      <div>
        <strong>${escapeHtml(cliente.nombre)}</strong>
        <div style="color:var(--muted);font-size:0.85rem;margin-top:0.2rem">
          CC ${escapeHtml(cliente.identificacion)} · ${total_boletas || 0} pacha(s)
        </div>
      </div>
      <button type="button" class="btn-gold cut" id="btn-descargar-todas">Descargar todas</button>
    `;

    const pagadas = [];
    const pendientes = [];

    container.innerHTML = rifas
      .map((rifa) => {
        const boletasHtml = rifa.boletas
          .map((b) => {
            const puedeDescargar = puedeDescargarBoleta(b);
            if (puedeDescargar) pagadas.push(b);
            else pendientes.push(b);

            const ticket = T.buildTicketHtml({
              boleta: b,
              cliente,
              rifaNombre: rifa.rifa_nombre,
              precio: rifa.precio_boleta,
            });
            const estado = String(b.estado || '').toUpperCase();
            return `
              <div class="boleta-item" data-boleta-id="${b.id}">
                <div class="boleta-ticket-scale" id="wrap-${b.id}">${ticket}</div>
                <div class="boleta-actions">
                  ${
                    puedeDescargar
                      ? `<button type="button" class="btn-gold cut btn-dl" data-id="${b.id}" data-num="${b.numero}">
                          Descargar PNG
                        </button>`
                      : `<button type="button" class="btn-ghost cut" disabled title="Disponible al pagar">
                          ${estado === 'RESERVADA' || estado === 'ABONADA' ? 'Pendiente de pago' : escapeHtml(estado || 'Sin descarga')}
                        </button>
                        <a class="btn-gold cut" href="./index.html#reservar" style="text-decoration:none;display:inline-flex;align-items:center;padding:0.55rem 0.9rem">
                          Pagar / reservar
                        </a>`
                  }
                </div>
              </div>`;
          })
          .join('');

        return `
          <section class="rifa-block">
            <h2>${escapeHtml(rifa.rifa_nombre)}</h2>
            <p class="rifa-meta">
              ${escapeHtml(rifa.premio_principal || '')}
              ${rifa.fecha_sorteo ? ` · Sorteo ${formatDate(rifa.fecha_sorteo)}` : ''}
              · ${T.money(rifa.precio_boleta)}
            </p>
            <div class="boletas-list">${boletasHtml}</div>
          </section>`;
      })
      .join('');

    const btnAll = $('btn-descargar-todas');
    if (btnAll) {
      if (!pagadas.length) {
        btnAll.disabled = true;
        btnAll.textContent = 'Sin boletas pagadas';
      } else {
        btnAll.disabled = false;
        btnAll.textContent = `Descargar pagadas (${pagadas.length})`;
        btnAll.addEventListener('click', () =>
          descargarTodas(
            cliente,
            rifas.map((r) => ({
              ...r,
              boletas: r.boletas.filter((b) => puedeDescargarBoleta(b)),
            }))
          )
        );
      }
    }

    container.querySelectorAll('.btn-dl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const num = btn.getAttribute('data-num');
        const ticket = document.querySelector(`#wrap-${id} .boleta-ticket`);
        if (!ticket) return;
        btn.disabled = true;
        btn.textContent = 'Generando…';
        try {
          await T.downloadTicket(
            ticket,
            `boleta_${T.pad(num)}_CC_${String(cliente.identificacion).replace(/\s+/g, '_')}.png`
          );
          toast('Boleta descargada', 'ok');
        } catch (err) {
          toast(err.message || 'Error al descargar', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Descargar PNG';
        }
      });
    });
  }

  function puedeDescargarBoleta(b) {
    const estado = String(b.estado || '').toUpperCase();
    if (estado === 'PAGADA' || estado === 'VENDIDA' || estado === 'CON_PAGO') return true;
    const saldo = Number(b.saldo_pendiente);
    if (Number.isFinite(saldo) && saldo <= 0 && Number(b.total_pagado) > 0) return true;
    return false;
  }

  async function descargarTodas(cliente, rifas) {
    const btn = $('btn-descargar-todas');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Descargando…';
    }
    try {
      for (const rifa of rifas) {
        for (const b of rifa.boletas) {
          const ticket = document.querySelector(`#wrap-${b.id} .boleta-ticket`);
          if (!ticket) continue;
          await T.downloadTicket(
            ticket,
            `boleta_${T.pad(b.numero)}_CC_${String(cliente.identificacion).replace(/\s+/g, '_')}.png`
          );
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      toast('Descargas listas', 'ok');
    } catch (err) {
      toast(err.message || 'Error al descargar', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Descargar todas';
      }
    }
  }

  function formatDate(d) {
    try {
      return new Date(d).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function consultar(cedula) {
    const id = String(cedula || '').trim();
    if (!id) {
      setStatus('Ingresa tu cédula.', true);
      return;
    }
    const btn = $('btn-buscar');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Buscando…';
    }
    $('resultado')?.classList.add('hidden');
    setStatus('Cargando tus boletas…');
    try {
      const data = await fetchBoletas(id);
      render(data);
      const pathBase = location.pathname.includes('mis-boletas.html')
        ? './mis-boletas.html'
        : location.pathname.replace(/\/$/, '');
      history.replaceState(null, '', `${pathBase}?cedula=${encodeURIComponent(id)}`);
    } catch (err) {
      $('resultado')?.classList.add('hidden');
      setStatus(err.message || 'Error al consultar', true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Consultar';
      }
    }
  }

  $('form-cedula')?.addEventListener('submit', (e) => {
    e.preventDefault();
    consultar($('input-cedula')?.value);
  });

  const initial = getCedulaFromPath();
  if (initial) {
    const input = $('input-cedula');
    if (input) input.value = initial;
    consultar(initial);
  }
})();
