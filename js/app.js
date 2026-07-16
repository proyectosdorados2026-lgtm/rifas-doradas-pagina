(() => {
  const CONFIG = window.RESERVA_CONFIG || {};
  const API_URL = (CONFIG.API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
  const API_KEY = CONFIG.API_KEY || '';
  const BLOQUEO_MINUTOS = CONFIG.BLOQUEO_MINUTOS || 15;
  const MAX_BOLETAS = CONFIG.MAX_BOLETAS || 10;
  const STOCK = CONFIG.STOCK || {};

  const state = {
    paso: 'catalogo',
    rifas: [],
    rifa: null,
    boletas: [],
    selectedIds: new Set(),
    reservaToken: null,
    bloqueoHasta: null,
    timerId: null,
    lastReserva: null,
    ruleta: {
      open: false,
      spinning: false,
      candidate: null,
      timer: null,
    },
  };

  const $ = (id) => document.getElementById(id);

  function getWhatsAppWaMe() {
    return CONFIG.WHATSAPP_WA_ME || '573137343527';
  }

  function getWhatsAppDisplay() {
    return CONFIG.WHATSAPP_DISPLAY || '313 734 3527';
  }

  function getPagoConfig() {
    return CONFIG.PAGO || {
      cuentaBancolombia: '58332955789',
      llave: '@mauricio5796',
      titular: 'Sueños Dorados',
    };
  }

  /** Bloque HTML de medios de pago (siempre visible en footer y al confirmar reserva) */
  function htmlMediosPago() {
    const pago = getPagoConfig();
    const wa = getWhatsAppWaMe();
    const waDisplay = getWhatsAppDisplay();
    return `
      <strong>Cómo pagar · Sueños Dorados</strong>
      <p class="pago-destacado">💰 Llave Bre-B: ${escapeHtml(pago.llave)}</p>
      <p class="pago-destacado">💰 Bancolombia ahorros: ${escapeHtml(pago.cuentaBancolombia)}</p>
      <p>A nombre de: ${escapeHtml(pago.titular)}</p>
      <p>📲 WhatsApp: <a href="https://wa.me/${wa}" target="_blank" rel="noopener">${escapeHtml(waDisplay)}</a></p>
      <p>Cuando pagues, envía el comprobante por WhatsApp ✅</p>
    `;
  }

  function renderMediosPagoEnPagina() {
    const html = htmlMediosPago();
    const footer = $('footer-pago');
    if (footer) footer.innerHTML = html;
    const formPago = $('form-pago');
    if (formPago) formPago.innerHTML = html;
  }

  function buildWhatsAppReservaUrl(nombre, telefono, pachas, total) {
    const msg =
      `Hola, soy ${nombre}. Confirmé mi reserva en *Sueños Dorados*.\n` +
      `Tel: ${telefono}\n` +
      `Pachas: ${pachas}\n` +
      `Total: ${total}\n\n` +
      `Adjunto comprobante de pago.`;
    return `https://wa.me/${getWhatsAppWaMe()}?text=${encodeURIComponent(msg)}`;
  }

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function padNum(n) {
    return String(n).padStart(4, '0');
  }

  function formatPair(boleta) {
    const nums = Array.isArray(boleta.numeros) && boleta.numeros.length
      ? boleta.numeros
      : [boleta.numero];
    return nums.map((x) => `#${padNum(x)}`).join(' · ');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, type = '') {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type}`.trim();
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-visible'), 3800);
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.message || data.error || `Error ${res.status}`);
    }
    return data;
  }

  const PASOS = {
    catalogo: 'paso-catalogo',
    numeros: 'paso-numeros',
    formulario: 'paso-formulario',
    exito: 'paso-exito',
  };

  function showPaso(paso) {
    state.paso = paso;
    Object.entries(PASOS).forEach(([key, id]) => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', key !== paso);
    });
    if (paso === 'exito' && typeof window.celebrateSuccess === 'function') {
      window.celebrateSuccess();
    }
  }

  // ── Proyectos ──────────────────────────────────────────
  async function cargarRifas() {
    const grid = $('rifas-grid');
    const loading = $('loading-rifas');
    const empty = $('empty-rifas');
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (grid) grid.innerHTML = '';

    try {
      const res = await api('/ventas-online/rifas');
      state.rifas = res.data || [];
      if (loading) loading.classList.add('hidden');

      if (!state.rifas.length) {
        if (empty) empty.classList.remove('hidden');
        return;
      }

      // Landing enfocada en NMAX: prioriza rifas que coincidan con el proyecto
      const prefer = (r) => {
        const hay = `${r.nombre || ''} ${r.premio_principal || ''} ${r.descripcion || ''}`.toLowerCase();
        return hay.includes('nmax') ? 0 : 1;
      };
      const list = [...state.rifas].sort((a, b) => prefer(a) - prefer(b));
      const featured = list.slice(0, 1);

      const fallback = './assets/nmax/web/DSC00558.jpg';
      grid.innerHTML = featured
        .map((r) => {
          const img = r.imagen_url || fallback;
          return `
        <article class="featured-card">
          <div class="featured-media">
            <img src="${escapeHtml(img)}" alt="${escapeHtml(r.nombre)}" data-stock loading="lazy"
              onerror="this.src='${escapeHtml(fallback)}'" />
            <img class="featured-silueta" src="./nmax-silueta.png" alt="" aria-hidden="true" />
          </div>
          <div class="featured-body">
            <div class="featured-brand"><img src="./logo.png" alt="" /><img src="./titulo.png" alt="" /></div>
            ${r.doble_oportunidad ? '<span class="badge-doble">Doble oportunidad</span>' : ''}
            <h3>${escapeHtml(r.nombre || 'Proyecto NMAX')}</h3>
            <p>${escapeHtml(r.descripcion || r.premio_principal || 'Boleta $20.000 · Doble oportunidad · NMAX 2026 0 km + iPhone 17 Pro Max + anticipado $5.000.000')}</p>
            <ul class="featured-meta">
              <li><span>Precio boleta</span><strong>${formatMoney(r.precio_boleta)}</strong></li>
              <li><span>Premio mayor</span><strong>26 sep · NMAX 2026</strong></li>
              <li><span>Anticipado</span><strong>5 sep · $5.000.000</strong></li>
              <li><span>Disponibles</span><strong>${Number(r.boletas_disponibles || 0).toLocaleString('es-CO')}</strong></li>
            </ul>
            <button type="button" class="btn-gold" data-rifa="${r.id}">Elegir mis números</button>
          </div>
        </article>`;
        })
        .join('');

      grid.querySelectorAll('[data-rifa]').forEach((btn) => {
        btn.addEventListener('click', () => seleccionarRifa(btn.getAttribute('data-rifa')));
      });
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (grid) {
        grid.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      }
    }
  }

  async function seleccionarRifa(rifaId) {
    showPaso('numeros');
    const list = $('numeros-grid');
    if (list) list.innerHTML = '<div class="loading">Cargando números disponibles…</div>';
    state.selectedIds = new Set();
    updateSelectionUI();

    try {
      const res = await api(`/ventas-online/rifas/${rifaId}/boletas`);
      state.rifa = res.data.rifa;
      state.boletas = (res.data.boletas || []).map((b) => ({
        ...b,
        numeros: Array.isArray(b.numeros) ? b.numeros.map(Number) : [Number(b.numero)],
      }));

      $('rifa-titulo').textContent = state.rifa.nombre;
      $('rifa-desc').textContent = state.rifa.doble_oportunidad
        ? `Doble oportunidad (número + otro al azar) · Mayor 26 sep · Anticipado 5 sep · ${state.boletas.length} boletas libres`
        : `Sorteo ${formatDate(state.rifa.fecha_sorteo)} · ${state.boletas.length} números libres`;
      $('rifa-precio').textContent = formatMoney(state.rifa.precio_boleta);

      const leyenda = $('leyenda-doble');
      if (leyenda) {
        leyenda.classList.toggle('hidden', !state.rifa.doble_oportunidad);
        if (state.rifa.doble_oportunidad && state.boletas[0]) {
          const ej = $('ejemplo-pacha');
          if (ej) ej.textContent = `(ej. ${formatPair(state.boletas[0])})`;
        }
      }

      const maxEl = $('max-boletas');
      if (maxEl) maxEl.textContent = String(MAX_BOLETAS);

      renderGrid();
      startDisponiblesRefresh();
      document.getElementById('reserva')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (list) list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      toast(err.message, 'error');
    }
  }

  function buildCells() {
    return state.boletas
      .map((b) => ({
        numero: b.numero,
        label: state.rifa?.doble_oportunidad ? formatPair(b) : padNum(b.numero),
        boletaId: b.id,
        boleta: b,
      }))
      .sort((a, b) => a.numero - b.numero);
  }

  function renderGrid(filter = '') {
    const grid = $('numeros-grid');
    if (!grid) return;

    const term = (filter || '').replace(/^#/, '').trim();
    let cells = buildCells();
    if (term) {
      cells = cells.filter((c) => {
        const nums = c.boleta.numeros || [c.numero];
        return nums.some((n) => {
          const padded = padNum(n);
          const clean = term.replace(/^0+/, '') || '0';
          return padded.includes(term) || String(n).includes(clean);
        });
      });
    }

    if (!cells.length) {
      grid.innerHTML = '<div class="empty">No hay números para mostrar.</div>';
      return;
    }

    const dual = Boolean(state.rifa?.doble_oportunidad);
    grid.classList.toggle('num-grid-dual', dual);

    grid.innerHTML = cells
      .map((c) => {
        const isSelected = state.selectedIds.has(c.boletaId);
        return `<button type="button" class="num-cell ${dual ? 'num-cell-dual' : ''} ${isSelected ? 'selected' : ''}"
          data-boleta="${c.boletaId}" data-numero="${c.numero}"
          title="${escapeHtml(formatPair(c.boleta))}">${escapeHtml(c.label)}</button>`;
      })
      .join('');

    grid.querySelectorAll('.num-cell').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleBoleta(btn.getAttribute('data-boleta'));
        if (typeof window.pulseNumCell === 'function') {
          window.pulseNumCell(btn);
        }
      });
    });
  }

  let refreshTimer = null;
  function startDisponiblesRefresh() {
    stopDisponiblesRefresh();
    refreshTimer = setInterval(async () => {
      if (state.paso !== 'numeros' || !state.rifa || state.reservaToken) return;
      try {
        const res = await api(`/ventas-online/rifas/${state.rifa.id}/boletas`);
        const prevSelected = new Set(state.selectedIds);
        state.boletas = (res.data.boletas || []).map((b) => ({
          ...b,
          numeros: Array.isArray(b.numeros) ? b.numeros.map(Number) : [Number(b.numero)],
        }));
        const stillAvailable = new Set(state.boletas.map((b) => b.id));
        let removed = false;
        for (const id of [...prevSelected]) {
          if (!stillAvailable.has(id)) {
            state.selectedIds.delete(id);
            removed = true;
          }
        }
        if (removed) {
          toast('Algunas pachas ya no están disponibles.', 'error');
        }
        renderGrid($('buscar-numero')?.value || '');
        updateSelectionUI();
      } catch {
        /* ignore */
      }
    }, 5000);
  }

  function stopDisponiblesRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function toggleBoleta(boletaId) {
    if (state.selectedIds.has(boletaId)) {
      state.selectedIds.delete(boletaId);
    } else {
      if (state.selectedIds.size >= MAX_BOLETAS) {
        toast(`Máximo ${MAX_BOLETAS} pachas por reserva`, 'error');
        return;
      }
      state.selectedIds.add(boletaId);
    }
    renderGrid($('buscar-numero')?.value || '');
    updateSelectionUI();
  }

  function removeBoleta(boletaId) {
    if (!state.selectedIds.has(boletaId)) return;
    state.selectedIds.delete(boletaId);
    renderGrid($('buscar-numero')?.value || '');
    updateSelectionUI();
    toast('Número quitado de tu compra');
  }

  function updateSelectionUI() {
    const count = state.selectedIds.size;
    const precio = Number(state.rifa?.precio_boleta || 0);
    const countEl = $('seleccion-count');
    const totalEl = $('total-seleccion');
    const numsEl = $('nums-seleccionados');
    const btn = $('btn-continuar');
    const chips = $('seleccion-chips');
    const empty = $('seleccion-empty');

    if (countEl) countEl.textContent = String(count);
    if (totalEl) totalEl.textContent = `Total ${formatMoney(count * precio)}`;
    if (btn) btn.disabled = count === 0;

    const selected = state.boletas.filter((b) => state.selectedIds.has(b.id));
    if (numsEl) {
      numsEl.textContent = selected.length
        ? selected.map(formatPair).join('  ·  ')
        : 'Ninguna pacha seleccionada';
    }

    if (chips) {
      if (!selected.length) {
        chips.innerHTML =
          '<p class="seleccion-empty" id="seleccion-empty">Aún no hay pachas en tu compra</p>';
      } else {
        chips.innerHTML = selected
          .map(
            (b) => `
          <span class="chip-removable">
            ${escapeHtml(formatPair(b))}
            <button type="button" data-remove="${b.id}" aria-label="Quitar ${escapeHtml(formatPair(b))}">×</button>
          </span>`
          )
          .join('');
        chips.querySelectorAll('[data-remove]').forEach((btnEl) => {
          btnEl.addEventListener('click', () => removeBoleta(btnEl.getAttribute('data-remove')));
        });
      }
    } else if (empty) {
      empty.classList.toggle('hidden', selected.length > 0);
    }
  }

  // ── Ruleta al azar ─────────────────────────────────────
  function disponiblesParaRuleta() {
    return state.boletas.filter((b) => !state.selectedIds.has(b.id));
  }

  function openRuleta() {
    if (!state.boletas.length) {
      toast('Todavía no hay números cargados.', 'error');
      return;
    }
    if (state.selectedIds.size >= MAX_BOLETAS) {
      toast(`Máximo ${MAX_BOLETAS} pachas por reserva`, 'error');
      return;
    }
    if (!disponiblesParaRuleta().length) {
      toast('No quedan números disponibles para girar.', 'error');
      return;
    }

    state.ruleta.open = true;
    state.ruleta.candidate = null;
    const modal = $('ruleta-modal');
    modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('ruleta-display').textContent = '————';
    $('ruleta-display')?.classList.remove('is-spinning', 'is-winner');
    $('ruleta-status').textContent = 'Gira para elegir una pacha al azar';
    $('ruleta-actions-spin')?.classList.remove('hidden');
    $('ruleta-actions-result')?.classList.add('hidden');

    if (typeof window.pulseRuletaOpen === 'function') {
      window.pulseRuletaOpen();
    }
  }

  function closeRuleta() {
    if (state.ruleta.spinning) return;
    clearTimeout(state.ruleta.timer);
    state.ruleta.timer = null;
    state.ruleta.open = false;
    state.ruleta.candidate = null;
    state.ruleta.spinning = false;
    $('ruleta-modal')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function setRuletaResultUI(candidate) {
    const display = $('ruleta-display');
    const status = $('ruleta-status');
    if (display) {
      display.textContent = formatPair(candidate);
      display.classList.remove('is-spinning');
      display.classList.add('is-winner');
    }
    if (status) {
      status.textContent = `Resultado: ${formatPair(candidate)}`;
    }
    $('ruleta-actions-spin')?.classList.add('hidden');
    $('ruleta-actions-result')?.classList.remove('hidden');
  }

  function girarRuleta() {
    if (state.ruleta.spinning) return;
    const pool = disponiblesParaRuleta();
    if (!pool.length) {
      toast('No quedan números disponibles.', 'error');
      closeRuleta();
      return;
    }
    if (state.selectedIds.size >= MAX_BOLETAS) {
      toast(`Máximo ${MAX_BOLETAS} pachas por reserva`, 'error');
      return;
    }

    clearTimeout(state.ruleta.timer);
    state.ruleta.timer = null;
    state.ruleta.spinning = true;
    state.ruleta.candidate = null;

    const display = $('ruleta-display');
    const status = $('ruleta-status');
    const winner = pool[Math.floor(Math.random() * pool.length)];
    const totalTicks = 30 + Math.floor(Math.random() * 12);
    let ticks = 0;
    let delay = 40;

    display?.classList.add('is-spinning');
    display?.classList.remove('is-winner');
    if (status) status.textContent = 'Girando…';
    $('ruleta-actions-spin')?.classList.add('hidden');
    $('ruleta-actions-result')?.classList.add('hidden');

    const tick = () => {
      ticks += 1;
      const sample = pool[Math.floor(Math.random() * pool.length)];
      if (display) {
        display.textContent = formatPair(sample);
        display.style.transform = `translateY(${ticks % 2 === 0 ? -5 : 5}px) scale(${1 + (ticks % 3) * 0.01})`;
      }

      if (ticks >= totalTicks) {
        state.ruleta.timer = null;
        state.ruleta.spinning = false;
        state.ruleta.candidate = winner;
        if (display) display.style.transform = '';
        setRuletaResultUI(winner);
        if (typeof window.celebrateRuletaWin === 'function') {
          window.celebrateRuletaWin();
        }
        return;
      }

      delay = Math.min(170, delay + (ticks > totalTicks - 10 ? 14 : 3));
      state.ruleta.timer = setTimeout(tick, delay);
    };

    tick();
  }

  function seleccionarRuleta() {
    const candidate = state.ruleta.candidate;
    if (!candidate || state.ruleta.spinning) return;
    if (state.selectedIds.size >= MAX_BOLETAS) {
      toast(`Máximo ${MAX_BOLETAS} pachas por reserva`, 'error');
      return;
    }
    if (!disponiblesParaRuleta().some((b) => b.id === candidate.id)) {
      toast('Ese número ya no está disponible. Gira de nuevo.', 'error');
      girarRuleta();
      return;
    }
    state.selectedIds.add(candidate.id);
    renderGrid($('buscar-numero')?.value || '');
    updateSelectionUI();
    toast(`Seleccionado: ${formatPair(candidate)}`, 'ok');
    closeRuleta();
  }

  // ── Bloqueo ────────────────────────────────────────────
  async function bloquearSeleccion() {
    const ids = [...state.selectedIds];
    if (!ids.length || !state.rifa) return;

    const btn = $('btn-continuar');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Bloqueando…';
    }

    try {
      const res = await api('/ventas-online/boletas/bloquear', {
        method: 'POST',
        body: JSON.stringify({
          rifa_id: state.rifa.id,
          boleta_ids: ids,
          tiempo_bloqueo_minutos: BLOQUEO_MINUTOS,
        }),
      });

      state.reservaToken = res.data.reserva_token;
      state.bloqueoHasta = new Date(res.data.bloqueo_hasta);
      const blocked = res.data.boletas || [];
      state.selectedIds = new Set(blocked.map((b) => b.id));

      stopDisponiblesRefresh();
      startTimer();
      showPaso('formulario');
      renderChips(blocked);
      toast('Pachas bloqueadas. Completa tus datos.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
      await seleccionarRifa(state.rifa.id);
    } finally {
      if (btn) {
        btn.textContent = 'Reservar';
        updateSelectionUI();
      }
    }
  }

  function renderChips(boletas) {
    const box = $('resumen-numeros');
    if (!box) return;
    const list = boletas.length
      ? boletas
      : state.boletas.filter((b) => state.selectedIds.has(b.id));
    box.innerHTML = list
      .map((b) => `<span class="chip">${escapeHtml(formatPair(b))}</span>`)
      .join('');
  }

  function startTimer() {
    clearInterval(state.timerId);
    const box = $('bloqueo-timer');
    if (box) box.classList.add('is-visible');

    const tick = () => {
      if (!state.bloqueoHasta) return;
      const ms = state.bloqueoHasta.getTime() - Date.now();
      if (ms <= 0) {
        const t = $('timer-text');
        if (t) t.textContent = '00:00';
        clearInterval(state.timerId);
        toast('El bloqueo expiró. Vuelve a seleccionar.', 'error');
        liberarSilencioso().then(() => {
          if (state.rifa) seleccionarRifa(state.rifa.id);
          else showPaso('catalogo');
        });
        return;
      }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const t = $('timer-text');
      if (t) t.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    tick();
    state.timerId = setInterval(tick, 1000);
  }

  function stopTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
    state.bloqueoHasta = null;
    const box = $('bloqueo-timer');
    if (box) box.classList.remove('is-visible');
  }

  async function liberarSilencioso() {
    if (!state.reservaToken) return;
    const token = state.reservaToken;
    state.reservaToken = null;
    stopTimer();
    try {
      await api('/ventas-online/boletas/liberar', {
        method: 'POST',
        body: JSON.stringify({ reserva_token: token }),
      });
    } catch {
      /* ignore */
    }
  }

  async function cancelarYLiberar() {
    await liberarSilencioso();
    state.selectedIds = new Set();
    if (state.rifa) await seleccionarRifa(state.rifa.id);
    else showPaso('catalogo');
    toast('Números liberados');
  }

  async function confirmarReserva(e) {
    e.preventDefault();
    if (!state.reservaToken) {
      toast('No hay bloqueo activo. Vuelve a seleccionar números.', 'error');
      return;
    }
    const form = e.target;
    const fd = new FormData(form);
    const payload = {
      reserva_token: state.reservaToken,
      cliente: {
        nombre: String(fd.get('nombre') || '').trim(),
        telefono: String(fd.get('telefono') || '').trim(),
        email: String(fd.get('email') || '').trim() || null,
        identificacion: String(fd.get('cedula') || '').trim() || null,
        direccion: null,
      },
      medio_pago_id: null,
      notas: null,
    };

    if (!payload.cliente.nombre || !payload.cliente.telefono) {
      toast('Nombre y teléfono son obligatorios.', 'error');
      return;
    }

    const btn = $('btn-confirmar');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando…';
    }

    try {
      const res = await api('/ventas-online/reservas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      state.reservaToken = null;
      stopTimer();

      const data = res.data || {};
      const nums = (data.boletas || [])
        .map((b) => `Pacha ${formatPair({ numero: b.numero, numeros: b.numeros || [b.numero] })}`)
        .join(', ');

      state.lastReserva = { ...payload, data, nums };

      $('exito-detalle').innerHTML = `
        <p><strong>Cliente:</strong> ${escapeHtml(payload.cliente.nombre)}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(payload.cliente.telefono)}</p>
        <p><strong>Pachas:</strong> ${escapeHtml(nums || '—')}</p>
        <p><strong>Total:</strong> ${formatMoney(data.monto_total || 0)}</p>
        <p>Estado: pendiente de pago. Envíanos el comprobante por WhatsApp para confirmar.</p>
      `;

      const exitoPago = $('exito-pago');
      if (exitoPago) exitoPago.innerHTML = htmlMediosPago();

      const wa = $('btn-whatsapp');
      if (wa) {
        wa.href = buildWhatsAppReservaUrl(
          payload.cliente.nombre,
          payload.cliente.telefono,
          nums,
          formatMoney(data.monto_total || 0)
        );
      }

      showPaso('exito');
      toast('Reserva creada correctamente', 'ok');
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirmar reserva';
      }
    }
  }

  // ── Events ─────────────────────────────────────────────
  $('btn-volver-catalogo')?.addEventListener('click', async () => {
    stopDisponiblesRefresh();
    await liberarSilencioso();
    state.selectedIds = new Set();
    showPaso('catalogo');
  });

  $('btn-volver-numeros')?.addEventListener('click', async () => {
    await liberarSilencioso();
    if (state.rifa) await seleccionarRifa(state.rifa.id);
  });

  $('btn-continuar')?.addEventListener('click', bloquearSeleccion);
  $('btn-cancelar-reserva')?.addEventListener('click', cancelarYLiberar);
  $('form-reserva')?.addEventListener('submit', confirmarReserva);
  $('btn-nueva-reserva')?.addEventListener('click', () => {
    state.selectedIds = new Set();
    state.rifa = null;
    showPaso('catalogo');
    cargarRifas();
  });

  $('buscar-numero')?.addEventListener('input', (e) => renderGrid(e.target.value));

  $('btn-al-azar')?.addEventListener('click', openRuleta);
  $('btn-ruleta-girar')?.addEventListener('click', girarRuleta);
  $('btn-ruleta-regirar')?.addEventListener('click', girarRuleta);
  $('btn-ruleta-seleccionar')?.addEventListener('click', seleccionarRuleta);
  document.querySelectorAll('[data-ruleta-close]').forEach((el) => {
    el.addEventListener('click', closeRuleta);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.ruleta.open) closeRuleta();
  });

  window.addEventListener('beforeunload', () => {
    if (!state.reservaToken) return;
    const body = JSON.stringify({ reserva_token: state.reservaToken });
    try {
      fetch(`${API_URL}/ventas-online/boletas/liberar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body,
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  });

  // Prefer local hero if stock URL fails — try nmax after load
  const viewLanding = $('view-landing') || document.getElementById('view-landing');
  const viewReservar = $('view-reservar') || document.getElementById('view-reservar');

  function getCurrentView() {
    return document.body.classList.contains('is-reservar') ? 'reservar' : 'landing';
  }

  function setNavActive(view, hash) {
    document.querySelectorAll('.desktop-nav a, .mobile-menu nav a').forEach((a) => {
      const v = a.getAttribute('data-view');
      const href = a.getAttribute('href') || '';
      let active = false;
      if (view === 'reservar') {
        active = v === 'reservar';
      } else if (hash && href === hash) {
        active = true;
      } else if (!hash && (href === '#inicio' || v === 'landing') && href === '#inicio') {
        active = true;
      }
      a.classList.toggle('active', active);
    });
  }

  function openReservar({ push = true } = {}) {
    document.body.classList.add('is-reservar');
    if (viewReservar) viewReservar.hidden = false;
    window.scrollTo(0, 0);
    setNavActive('reservar');
    if (push && location.hash !== '#reservar') {
      history.pushState({ view: 'reservar' }, '', '#reservar');
    }
  }

  function openLanding({ push = true, hash = '#inicio' } = {}) {
    document.body.classList.remove('is-reservar');
    if (viewReservar) viewReservar.hidden = true;
    setNavActive('landing', hash);
    if (push) {
      const next = hash || '#inicio';
      if (location.hash !== next) history.pushState({ view: 'landing' }, '', next);
    }
    if (hash && hash !== '#reservar') {
      const el = document.querySelector(hash);
      if (el) {
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function applyViewFromHash() {
    const hash = location.hash || '#inicio';
    if (hash === '#reservar' || hash === '#reserva') {
      openReservar({ push: false });
      return;
    }
    openLanding({ push: false, hash });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view]');
    if (!link) return;
    const view = link.getAttribute('data-view');
    const href = link.getAttribute('href') || '';
    if (view === 'reservar') {
      e.preventDefault();
      openReservar({ push: true });
      return;
    }
    if (view === 'landing') {
      e.preventDefault();
      const hash = href.startsWith('#') ? href : '#inicio';
      openLanding({ push: true, hash });
    }
  });

  window.addEventListener('popstate', () => applyViewFromHash());
  window.addEventListener('hashchange', () => applyViewFromHash());

  renderMediosPagoEnPagina();
  showPaso('catalogo');
  applyViewFromHash();
  cargarRifas();
})();
