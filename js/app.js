(() => {
  const CONFIG = window.RESERVA_CONFIG || {};
  const API_URL = (CONFIG.API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
  const API_KEY = CONFIG.API_KEY || '';
  const BLOQUEO_MINUTOS = CONFIG.BLOQUEO_MINUTOS || 15;
  const MAX_BOLETAS = CONFIG.MAX_BOLETAS || 10;
  const GRID_SAMPLE_LIMIT = 1000;
  const STOCK = CONFIG.STOCK || {};

  const state = {
    paso: 'catalogo',
    rifas: [],
    rifa: null,
    boletas: [],
    gridSampleIds: [],
    primaryNumberById: new Map(),
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
      <strong>También puedes pagar por transferencia</strong>
      <p class="pago-destacado">💰 Llave Bre-B: ${escapeHtml(pago.llave)}</p>
      <p class="pago-destacado">💰 Bancolombia ahorros: ${escapeHtml(pago.cuentaBancolombia)}</p>
      <p>A nombre de: ${escapeHtml(pago.titular)}</p>
      <p>📲 WhatsApp: <a href="https://wa.me/${wa}" target="_blank" rel="noopener">${escapeHtml(waDisplay)}</a></p>
      <p>Si pagas por transferencia, envía el comprobante por WhatsApp ✅</p>
    `;
  }

  async function isWompiReady() {
    if (CONFIG.WOMPI_ENABLED === false) {
      return { enabled: false, reason: 'deshabilitado en config.js' };
    }
    try {
      const res = await api('/ventas-online/pagos/wompi/status');
      const data = res?.data || {};
      return {
        enabled: Boolean(data.enabled),
        missing: data.missing || [],
        env: data.env,
        reason: data.enabled
          ? null
          : (data.missing || []).length
            ? `Faltan variables: ${(data.missing || []).join(', ')}`
            : 'Wompi no configurado en el servidor',
      };
    } catch (err) {
      return {
        enabled: false,
        reason: err.message || 'No se pudo consultar estado Wompi',
      };
    }
  }

  async function setupWompiPayButton(reservaToken, montoTotal) {
    const btn = $('btn-pagar-wompi');
    const box = $('exito-wompi');
    const hint = $('wompi-pay-hint');
    if (!btn || !box) return;

    box.classList.remove('hidden');
    const status = await isWompiReady();

    if (!status.enabled || !reservaToken) {
      btn.disabled = true;
      btn.textContent = 'Pagar con Wompi (no disponible)';
      if (hint) {
        hint.textContent =
          status.reason ||
          'Wompi aún no está activo. Revisa las variables en Railway.';
        hint.style.color = '#fca5a5';
      }
      return;
    }

    btn.disabled = false;
    btn.textContent = `Pagar ${formatMoney(montoTotal)} con Wompi`;
    if (hint) {
      hint.style.color = '';
      hint.textContent =
        'Pago seguro en línea. Al confirmarse, tu boleta queda PAGADA y podrás descargarla.';
    }

    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Preparando pago…';
      try {
        const res = await api('/ventas-online/pagos/checkout', {
          method: 'POST',
          body: JSON.stringify({ reserva_token: reservaToken }),
        });
        const checkout = res.data;
        if (!checkout?.signature || !window.WompiCheckout) {
          throw new Error('No se pudo preparar el pago Wompi');
        }
        try {
          sessionStorage.setItem(
            'sd_last_pago',
            JSON.stringify({
              token: reservaToken,
              reference: checkout.reference,
              amount: checkout.amount,
            })
          );
        } catch (_) {
          /* ignore */
        }
        window.WompiCheckout.openCheckout(checkout, (result) => {
          const tx = result?.transaction;
          if (tx?.id) {
            const qs = new URLSearchParams({
              token: reservaToken,
              reference: checkout.reference || '',
              id: tx.id,
            });
            window.location.href = `./pago-resultado.html?${qs.toString()}`;
          }
        });
      } catch (err) {
        toast(err.message || 'Error al iniciar pago', 'error');
        btn.disabled = false;
        btn.textContent = `Pagar ${formatMoney(montoTotal)} con Wompi`;
      }
    };
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
      `Números: ${pachas}\n` +
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

  function orderedNumbers(boleta) {
    const nums =
      Array.isArray(boleta?.numeros) && boleta.numeros.length
        ? boleta.numeros.map(Number)
        : boleta?.numero != null
          ? [Number(boleta.numero)]
          : [];
    const chosen = Number(state.primaryNumberById.get(boleta?.id));
    if (!Number.isFinite(chosen) || !nums.includes(chosen)) return nums;
    return [chosen, ...nums.filter((n) => n !== chosen)];
  }

  function formatSelectedPair(boleta) {
    const nums = orderedNumbers(boleta);
    return nums.length ? nums.map((n) => `#${padNum(n)}`).join(' · ') : '—';
  }

  function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function groupSampleIds(ids) {
    const byId = new Map(state.boletas.map((b) => [b.id, b]));
    const groups = Array.from({ length: 10 }, () => []);
    ids.forEach((id) => {
      const boleta = byId.get(id);
      if (!boleta) return;
      const digit = Number(padNum(boleta.numero).charAt(0));
      groups[Number.isInteger(digit) ? digit : 0].push(id);
    });
    return groups.flat();
  }

  function createVisitSample() {
    const picked = shuffle(state.boletas)
      .slice(0, GRID_SAMPLE_LIMIT)
      .map((b) => b.id);
    state.gridSampleIds = groupSampleIds(picked);
  }

  function refreshVisitSample() {
    const availableIds = new Set(state.boletas.map((b) => b.id));
    const kept = state.gridSampleIds.filter((id) => availableIds.has(id));
    const keptSet = new Set(kept);
    const missing = Math.max(0, Math.min(GRID_SAMPLE_LIMIT, state.boletas.length) - kept.length);
    const replacements = shuffle(
      state.boletas.filter((b) => !keptSet.has(b.id))
    )
      .slice(0, missing)
      .map((b) => b.id);
    state.gridSampleIds = groupSampleIds([...kept, ...replacements]);
  }

  function formatPachasLabel(boletas) {
    const list = Array.isArray(boletas) ? boletas : [];
    if (!list.length) return '';
    return list.map((b) => `Números ${formatSelectedPair(b)}`).join(', ');
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
            <p>${escapeHtml(r.descripcion || r.premio_principal || 'Boleta $20.000 · Doble oportunidad · NMAX 2027 0 km + iPhone 17 Pro Max + anticipado $5.000.000')}</p>
            <ul class="featured-meta">
              <li><span>Precio boleta</span><strong>${formatMoney(r.precio_boleta)}</strong></li>
              <li><span>Premio mayor</span><strong>26 sep · NMAX 2027</strong></li>
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

  async function seleccionarRifa(rifaId, numeroDesdeQr = null) {
    showPaso('numeros');
    const list = $('numeros-grid');
    if (list) list.innerHTML = '<div class="loading">Cargando números disponibles…</div>';
    state.selectedIds = new Set();
    state.gridSampleIds = [];
    state.primaryNumberById = new Map();
    updateSelectionUI();

    try {
      const res = await api(`/ventas-online/rifas/${rifaId}/boletas`);
      state.rifa = res.data.rifa;
      state.boletas = (res.data.boletas || []).map((b) => ({
        ...b,
        numeros: Array.isArray(b.numeros) ? b.numeros.map(Number) : [Number(b.numero)],
      }));
      createVisitSample();

      $('rifa-titulo').textContent = state.rifa.nombre;
      $('rifa-desc').textContent = state.rifa.doble_oportunidad
        ? `Doble oportunidad (número elegido + número de regalo) · Mayor 26 sep · Anticipado 5 sep · ${state.boletas.length} boletas libres`
        : `Sorteo ${formatDate(state.rifa.fecha_sorteo)} · ${state.boletas.length} números libres`;
      $('rifa-precio').textContent = formatMoney(state.rifa.precio_boleta);

      const leyenda = $('leyenda-doble');
      if (leyenda) {
        leyenda.classList.toggle('hidden', !state.rifa.doble_oportunidad);
      }

      const maxEl = $('max-boletas');
      if (maxEl) maxEl.textContent = String(MAX_BOLETAS);

      // numeroDesdeQr=null → Number(null)=0; no tratar eso como QR
      if (numeroDesdeQr != null && numeroDesdeQr !== '' && Number.isInteger(Number(numeroDesdeQr))) {
        const numeroQr = Number(numeroDesdeQr);
        const pachaQr = state.boletas.find((b) => {
          const nums = Array.isArray(b.numeros) ? b.numeros.map(Number) : [Number(b.numero)];
          return nums.includes(numeroQr);
        });
        if (pachaQr) {
          state.primaryNumberById.set(pachaQr.id, numeroQr);
          state.selectedIds.add(pachaQr.id);
          showGiftNotice(pachaQr, numeroQr);
        } else {
          toast('Este número ya no está disponible.', 'error');
        }
      }

      renderGrid();
      updateSelectionUI();
      startDisponiblesRefresh();
      document.getElementById('reserva')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (list) list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      toast(err.message, 'error');
    }
  }

  function matchedNumber(boleta, term) {
    const nums = boleta.numeros || [boleta.numero];
    if (!term) return Number(boleta.numero);
    const digits = term.replace(/\D/g, '');
    if (!digits) return undefined;
    return nums.find((n) => {
      const padded = padNum(n);
      if (digits.length === 4) return padded === digits;
      return padded.includes(digits) || String(n).includes(digits);
    });
  }

  function buildCells(filter = '') {
    const term = (filter || '').replace(/^#/, '').trim();
    const byId = new Map(state.boletas.map((b) => [b.id, b]));
    const source = term
      ? state.boletas
      : state.gridSampleIds.map((id) => byId.get(id)).filter(Boolean);

    const cells = source
      .map((b) => {
        const numero = matchedNumber(b, term);
        if (numero == null) return null;
        return {
          numero: Number(numero),
          label: padNum(numero),
          boletaId: b.id,
          boleta: b,
        };
      })
      .filter(Boolean);

    // La muestra conserva grupos 0–9 y orden aleatorio interno.
    // Los resultados de búsqueda se ordenan para que sean fáciles de revisar.
    return term ? cells.sort((a, b) => a.numero - b.numero) : cells;
  }

  function renderGrid(filter = '') {
    const grid = $('numeros-grid');
    if (!grid) return;

    const term = (filter || '').replace(/^#/, '').trim();
    const cells = buildCells(term);

    if (!cells.length) {
      grid.innerHTML = '<div class="empty">No hay números para mostrar.</div>';
      return;
    }

    grid.classList.remove('num-grid-dual');

    let lastSeries = null;
    grid.innerHTML = cells
      .map((c) => {
        const isSelected = state.selectedIds.has(c.boletaId);
        const series = padNum(c.numero).charAt(0);
        const heading =
          !term && series !== lastSeries
            ? `<div class="num-series">Serie ${series}</div>`
            : '';
        lastSeries = series;
        return `${heading}<button type="button" class="num-cell ${isSelected ? 'selected' : ''}"
          data-boleta="${c.boletaId}" data-numero="${c.numero}"
          title="Seleccionar #${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`;
      })
      .join('');

    grid.querySelectorAll('.num-cell').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleBoleta(
          btn.getAttribute('data-boleta'),
          Number(btn.getAttribute('data-numero'))
        );
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
        refreshVisitSample();
        const stillAvailable = new Set(state.boletas.map((b) => b.id));
        let removed = false;
        for (const id of [...prevSelected]) {
          if (!stillAvailable.has(id)) {
            state.selectedIds.delete(id);
            state.primaryNumberById.delete(id);
            removed = true;
          }
        }
        if (removed) {
          toast('Algunos números ya no están disponibles.', 'error');
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

  let giftOverlayTimer = null;

  function hideGiftOverlay() {
    clearTimeout(giftOverlayTimer);
    giftOverlayTimer = null;
    const overlay = $('regalo-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('is-leaving');
    }, 220);
  }

  function showGiftOverlay(principal, gift) {
    const overlay = $('regalo-overlay');
    if (!overlay) return;
    const principalEl = $('regalo-principal');
    const secundarioEl = $('regalo-secundario');
    if (principalEl) principalEl.textContent = `#${padNum(principal)}`;
    if (secundarioEl) secundarioEl.textContent = `#${padNum(gift)}`;

    clearTimeout(giftOverlayTimer);
    overlay.classList.remove('hidden', 'is-leaving');
    // Reinicia las animaciones CSS en aperturas consecutivas
    const card = overlay.querySelector('.regalo-card');
    if (card) {
      card.classList.remove('is-armed');
      void card.offsetWidth;
      card.classList.add('is-armed');
    }
    giftOverlayTimer = setTimeout(hideGiftOverlay, 3200);
  }

  function showGiftNotice(boleta, principal) {
    const notice = $('regalo-notice');
    const nums = Array.isArray(boleta?.numeros) ? boleta.numeros.map(Number) : [];
    const gift = nums.find((n) => n !== Number(principal));
    const message = gift != null
      ? `Elegiste #${padNum(principal)}. ¡Te regalamos también el #${padNum(gift)}!`
      : `Elegiste #${padNum(principal)}.`;
    if (notice) {
      notice.textContent = message;
      notice.classList.remove('hidden');
    }
    if (gift != null) {
      showGiftOverlay(principal, gift);
    } else {
      toast(message, 'ok');
    }
  }

  function toggleBoleta(boletaId, displayedNumber) {
    if (state.selectedIds.has(boletaId)) {
      state.selectedIds.delete(boletaId);
      state.primaryNumberById.delete(boletaId);
    } else {
      if (state.selectedIds.size >= MAX_BOLETAS) {
        toast(`Máximo ${MAX_BOLETAS} números por reserva`, 'error');
        return;
      }
      const boleta = state.boletas.find((b) => b.id === boletaId);
      const principal = Number.isFinite(displayedNumber)
        ? displayedNumber
        : Number(boleta?.numero);
      state.primaryNumberById.set(boletaId, principal);
      state.selectedIds.add(boletaId);
      if (boleta) showGiftNotice(boleta, principal);
    }
    renderGrid($('buscar-numero')?.value || '');
    updateSelectionUI();
  }

  function removeBoleta(boletaId) {
    if (!state.selectedIds.has(boletaId)) return;
    state.selectedIds.delete(boletaId);
    state.primaryNumberById.delete(boletaId);
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
    const giftNotice = $('regalo-notice');

    if (countEl) countEl.textContent = String(count);
    if (totalEl) totalEl.textContent = `Total ${formatMoney(count * precio)}`;
    if (btn) btn.disabled = count === 0;
    if (giftNotice && count === 0) giftNotice.classList.add('hidden');

    const selected = state.boletas.filter((b) => state.selectedIds.has(b.id));
    if (numsEl) {
      numsEl.textContent = selected.length
        ? selected.map(formatSelectedPair).join('  ·  ')
        : 'Ningún número seleccionado';
    }

    if (chips) {
      if (!selected.length) {
        chips.innerHTML =
          '<p class="seleccion-empty" id="seleccion-empty">Aún no hay números en tu compra</p>';
      } else {
        chips.innerHTML = selected
          .map(
            (b) => `
          <span class="chip-removable">
            ${escapeHtml(formatSelectedPair(b))}
            <button type="button" data-remove="${b.id}" aria-label="Quitar ${escapeHtml(formatSelectedPair(b))}">×</button>
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
      toast(`Máximo ${MAX_BOLETAS} números por reserva`, 'error');
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
    $('ruleta-status').textContent = 'Gira para elegir un número al azar';
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
      display.textContent = `#${padNum(candidate.numero)}`;
      display.classList.remove('is-spinning');
      display.classList.add('is-winner');
    }
    if (status) {
      status.textContent = 'Selecciónalo y descubre el número que te regalamos.';
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
      toast(`Máximo ${MAX_BOLETAS} números por reserva`, 'error');
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
        display.textContent = `#${padNum(sample.numero)}`;
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
      toast(`Máximo ${MAX_BOLETAS} números por reserva`, 'error');
      return;
    }
    if (!disponiblesParaRuleta().some((b) => b.id === candidate.id)) {
      toast('Ese número ya no está disponible. Gira de nuevo.', 'error');
      girarRuleta();
      return;
    }
    state.primaryNumberById.set(candidate.id, Number(candidate.numero));
    state.selectedIds.add(candidate.id);
    renderGrid($('buscar-numero')?.value || '');
    updateSelectionUI();
    showGiftNotice(candidate, Number(candidate.numero));
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
      toast('Números reservados. Completa tus datos.', 'ok');
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
      .map((b) => `<span class="chip">${escapeHtml(formatSelectedPair(b))}</span>`)
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

      const tokenAntes = state.reservaToken;
      stopTimer();

      const data = res.data || {};
      // Preferir token devuelto por API (mismo del bloqueo)
      const reservaTokenFinal = data.reserva_token || tokenAntes;
      state.reservaToken = null;

      const selectedLocal = state.boletas.filter((b) => state.selectedIds.has(b.id));
      const nums =
        formatPachasLabel(data.boletas) ||
        formatPachasLabel(selectedLocal) ||
        '—';

      state.lastReserva = { ...payload, data, nums, reservaToken: reservaTokenFinal };

      $('exito-detalle').innerHTML = `
        <p><strong>Cliente:</strong> ${escapeHtml(payload.cliente.nombre)}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(payload.cliente.telefono)}</p>
        <p><strong>Números:</strong> ${escapeHtml(nums || '—')}</p>
        <p><strong>Total:</strong> ${formatMoney(data.monto_total || 0)}</p>
        <p>Estado: pendiente de pago. Paga con Wompi para descargar al instante.</p>
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

      const misBoletas = $('btn-ir-mis-boletas');
      if (misBoletas && reservaTokenFinal) {
        misBoletas.href = `./mis-boletas.html?token=${encodeURIComponent(reservaTokenFinal)}`;
      }

      showPaso('exito');
      await setupWompiPayButton(reservaTokenFinal, data.monto_total || 0);
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
  document.querySelectorAll('[data-regalo-close]').forEach((el) => {
    el.addEventListener('click', hideGiftOverlay);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.ruleta.open) closeRuleta();
    if (e.key === 'Escape') hideGiftOverlay();
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

  async function iniciarCatalogo() {
    await cargarRifas();

    const params = new URLSearchParams(location.search);
    const rifaQr = params.get('rifa') || '';
    const numeroQr = params.get('boleta');
    const uuidValido =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rifaQr);

    if (uuidValido && numeroQr != null && /^\d+$/.test(numeroQr)) {
      openReservar({ push: false });
      await seleccionarRifa(rifaQr, Number(numeroQr));
    }
  }

  renderMediosPagoEnPagina();
  showPaso('catalogo');
  applyViewFromHash();
  iniciarCatalogo();
})();
