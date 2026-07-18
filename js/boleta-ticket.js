/** Render + descarga de boletas (mismo layout que el sistema admin). */
(function (global) {
  const LEFT = 210;
  const RIGHT = 590;
  const WIDTH = LEFT + RIGHT;
  const DEFAULT_HEIGHT = Math.round(RIGHT * (1417 / 2504));

  function pad(n) {
    return String(n).padStart(4, '0');
  }

  function money(n) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(Number(n) || 0);
  }

  function normalizeNums(numeros, numero, boletaId, numeroPrincipal) {
    const nums =
      Array.isArray(numeros) && numeros.length
        ? numeros.map(Number).filter(Number.isFinite)
        : numero != null && Number.isFinite(Number(numero))
          ? [Number(numero)]
          : [];
    if (nums.length < 2) return nums;

    const fromApi = Number(numeroPrincipal);
    if (Number.isFinite(fromApi) && nums.includes(fromApi)) {
      return [fromApi, ...nums.filter((n) => n !== fromApi)];
    }

    if (boletaId) {
      try {
        const saved = JSON.parse(localStorage.getItem('sd_primary_numbers') || '{}');
        const chosen = Number(saved[String(boletaId)]);
        if (Number.isFinite(chosen) && nums.includes(chosen)) {
          return [chosen, ...nums.filter((n) => n !== chosen)];
        }
      } catch (_) {
        /* Usa el orden oficial si localStorage no está disponible. */
      }
    }
    return nums;
  }

  function qrSrc(qrUrl, fallbackData) {
    if (!qrUrl) {
      return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fallbackData || 'boleta')}`;
    }
    if (/create-qr-code|qrserver|chart\.googleapis|data:image/i.test(qrUrl)) {
      return qrUrl;
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`;
  }

  function badgeClass(estado) {
    const e = String(estado || '').toUpperCase();
    if (e === 'PAGADA' || e === 'VENDIDA' || e === 'CON_PAGO') return 'pagada';
    if (e === 'ABONADA') return 'abonada';
    if (e === 'RESERVADA') return 'reservada';
    if (e === 'ANULADA' || e === 'CANCELADA') return 'cancelada';
    return 'disponible';
  }

  function badgeLabel(estado) {
    const e = String(estado || '').toUpperCase();
    if (e === 'PAGADA' || e === 'VENDIDA' || e === 'CON_PAGO') return 'Pagada';
    if (e === 'ABONADA') return 'Abonada';
    if (e === 'RESERVADA') return 'Reservada';
    if (e === 'ANULADA' || e === 'CANCELADA') return 'Cancelada';
    return e || 'Disponible';
  }

  function buildTicketHtml({ boleta, cliente, rifaNombre, precio }) {
    const nums = normalizeNums(
      boleta.numeros,
      boleta.numero,
      boleta.id,
      boleta.numero_principal
    );
    const principal = nums[0];
    const regalo = nums[1];
    const height = DEFAULT_HEIGHT;
    const deuda = boleta.saldo_pendiente;
    const estado = boleta.estado;
    const bc = badgeClass(estado);
    const img = boleta.imagen_url || '';
    const qr = qrSrc(boleta.qr_url, boleta.id);

    const deudaHtml =
      typeof deuda === 'number' && deuda > 0
        ? `<p class="boleta-ticket__deuda">Deuda: ${money(deuda)}</p>`
        : '';

    const right = img
      ? `<div class="boleta-ticket__right" style="width:${RIGHT}px"><img src="${img}" alt="" crossorigin="anonymous" /></div>`
      : `<div class="boleta-ticket__right" style="width:${RIGHT}px"><div class="boleta-ticket__right-fallback"><div><p>${escapeHtml(rifaNombre || 'Sueños Dorados')}</p><div class="boleta-ticket__fallback-numbers"><strong>Tu número: #${pad(principal)}</strong>${regalo != null ? `<span>Regalo: #${pad(regalo)}</span>` : ''}</div></div></div></div>`;

    return `
      <div class="boleta-ticket" style="width:${WIDTH}px;height:${height}px;min-width:${WIDTH}px">
        <div class="boleta-ticket__left" style="width:${LEFT}px;height:${height}px">
          <div class="boleta-ticket__content">
            <div class="boleta-ticket__body">
              <div class="boleta-ticket__badge boleta-ticket__badge--${bc}">${badgeLabel(estado)}</div>
              ${deudaHtml}
              <p class="boleta-ticket__label">A nombre de</p>
              <p class="boleta-ticket__name">${escapeHtml(cliente?.nombre || '—')}</p>
              <p class="boleta-ticket__id">CC. ${escapeHtml(cliente?.identificacion || '—')}</p>
            </div>
          </div>
          <div class="boleta-ticket__qr-wrap">
            <img class="boleta-ticket__qr" src="${qr}" alt="QR" crossorigin="anonymous" />
          </div>
          <div class="boleta-ticket__footer">
            <div class="boleta-ticket__numeros">
              <div class="boleta-ticket__numero-block boleta-ticket__numero-block--principal">
                <span class="boleta-ticket__numero-label">Número principal</span>
                <strong class="boleta-ticket__numero-value">#${pad(principal)}</strong>
              </div>
              ${
                regalo != null
                  ? `<div class="boleta-ticket__numero-separator" aria-hidden="true">+</div>
                    <div class="boleta-ticket__numero-block boleta-ticket__numero-block--regalo">
                      <span class="boleta-ticket__numero-label">🎁 Número de regalo</span>
                      <strong class="boleta-ticket__numero-value">#${pad(regalo)}</strong>
                      <span class="boleta-ticket__regalo-note">Incluido gratis · otro número de 4 cifras</span>
                    </div>`
                  : ''
              }
            </div>
            ${precio > 0 ? `<div class="boleta-ticket__precio">${money(precio)}</div>` : ''}
          </div>
        </div>
        ${right}
      </div>`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function waitImages(el) {
    const imgs = Array.from(el.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 8000);
          })
      )
    );
  }

  function isAppleMobile() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  function isShareCancelled(err) {
    if (!err) return false;
    const name = String(err.name || '');
    const msg = String(err.message || '');
    return (
      name === 'AbortError' ||
      /cancel/i.test(msg) ||
      /share.*cancel/i.test(msg)
    );
  }

  function isShareNotAllowed(err) {
    if (!err) return false;
    const name = String(err.name || '');
    const msg = String(err.message || '');
    return (
      name === 'NotAllowedError' ||
      /not allowed by the user agent/i.test(msg) ||
      /denied permission/i.test(msg) ||
      /user gesture/i.test(msg)
    );
  }

  async function tryNativeShare(blob, name) {
    if (!navigator.share || !global.File) return { ok: false, reason: 'unsupported' };
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      return { ok: false, reason: 'unsupported' };
    }
    try {
      await navigator.share({
        files: [file],
        title: 'Boleta Sueños Dorados',
      });
      return { ok: true, method: 'share' };
    } catch (err) {
      if (isShareCancelled(err)) return { ok: true, method: 'cancelled' };
      if (isShareNotAllowed(err)) return { ok: false, reason: 'not-allowed', error: err };
      return { ok: false, reason: 'error', error: err };
    }
  }

  function triggerAnchorDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, method: 'download' };
  }

  /**
   * Tras html2canvas el gesto del usuario ya expiró en iOS/Safari,
   * así que navigator.share falla con NotAllowedError.
   * Esta hoja pide un nuevo toque para compartir o guardar.
   */
  function showMobileSaveSheet(blob, name) {
    return new Promise((resolve) => {
      const prev = document.getElementById('boleta-save-sheet');
      if (prev) prev.remove();

      const url = URL.createObjectURL(blob);
      const sheet = document.createElement('div');
      sheet.id = 'boleta-save-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.innerHTML = `
        <div class="boleta-save-sheet__backdrop" data-close="1"></div>
        <div class="boleta-save-sheet__card">
          <p class="boleta-save-sheet__title">Tu boleta está lista</p>
          <p class="boleta-save-sheet__hint">Toca <strong>Compartir</strong> y elige “Guardar en Fotos”, o mantén pulsada la imagen.</p>
          <img class="boleta-save-sheet__preview" src="${url}" alt="Vista previa de la boleta" />
          <div class="boleta-save-sheet__actions">
            <button type="button" class="boleta-save-sheet__btn boleta-save-sheet__btn--primary" data-share="1">Compartir / Guardar</button>
            <button type="button" class="boleta-save-sheet__btn" data-close="1">Cerrar</button>
          </div>
        </div>
      `;

      if (!document.getElementById('boleta-save-sheet-style')) {
        const style = document.createElement('style');
        style.id = 'boleta-save-sheet-style';
        style.textContent = `
          #boleta-save-sheet{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:1rem;padding-bottom:max(1rem,env(safe-area-inset-bottom));box-sizing:border-box}
          .boleta-save-sheet__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72)}
          .boleta-save-sheet__card{position:relative;width:min(420px,100%);background:#141414;color:#f5f2ea;border:1px solid rgba(243,196,93,.45);border-radius:18px 18px 12px 12px;padding:1rem 1rem 1.15rem;box-shadow:0 -12px 40px rgba(0,0,0,.45)}
          .boleta-save-sheet__title{margin:0 0 .35rem;font-size:1.05rem;font-weight:800}
          .boleta-save-sheet__hint{margin:0 0 .85rem;font-size:.82rem;line-height:1.35;color:rgba(245,242,234,.75)}
          .boleta-save-sheet__preview{display:block;width:100%;max-height:42vh;object-fit:contain;border-radius:10px;background:#0c0c0c;margin-bottom:.9rem;-webkit-touch-callout:default;user-select:none}
          .boleta-save-sheet__actions{display:grid;gap:.55rem}
          .boleta-save-sheet__btn{appearance:none;border:1px solid rgba(245,242,234,.2);background:rgba(255,255,255,.06);color:#f5f2ea;border-radius:10px;padding:.85rem 1rem;font-weight:700;font-size:.92rem;cursor:pointer}
          .boleta-save-sheet__btn--primary{background:linear-gradient(135deg,#d4a017,#f3c45d);color:#1a1205;border-color:transparent}
        `;
        document.head.appendChild(style);
      }

      const finish = (result) => {
        sheet.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        resolve(result);
      };

      sheet.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t instanceof Element)) return;
        if (t.closest('[data-close]')) {
          finish({ ok: true, method: 'closed' });
          return;
        }
        const shareBtn = t.closest('[data-share]');
        if (!shareBtn) return;
        shareBtn.setAttribute('disabled', 'true');
        shareBtn.textContent = 'Abriendo…';
        const shared = await tryNativeShare(blob, name);
        if (shared.ok) {
          finish(shared);
          return;
        }
        // Si aún falla el share, la imagen ya está visible para long-press.
        shareBtn.removeAttribute('disabled');
        shareBtn.textContent = 'Compartir / Guardar';
        const hint = sheet.querySelector('.boleta-save-sheet__hint');
        if (hint) {
          hint.innerHTML =
            'Si no aparece compartir, <strong>mantén pulsada la imagen</strong> y elige “Guardar en Fotos”.';
        }
      });

      document.body.appendChild(sheet);
    });
  }

  /**
   * @returns {Promise<{ok:boolean, method?:string}>}
   */
  async function downloadTicket(ticketEl, fileName) {
    if (!global.html2canvas) throw new Error('html2canvas no cargado');
    await waitImages(ticketEl);
    const canvas = await global.html2canvas(ticketEl, {
      width: WIDTH,
      height: ticketEl.offsetHeight || DEFAULT_HEIGHT,
      scale: /Mobile/i.test(navigator.userAgent) ? 2 : 3,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#0c0c0c',
      logging: false,
    });
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('No se pudo generar la imagen');
    const name = fileName.endsWith('.png') ? fileName : `${fileName}.png`;

    // iPhone/iPad: tras generar la imagen el gesto ya expiró → share directo falla.
    // Intentamos share; si Safari lo bloquea, pedimos un nuevo toque.
    if (isAppleMobile()) {
      const shared = await tryNativeShare(blob, name);
      if (shared.ok) return shared;
      return showMobileSaveSheet(blob, name);
    }

    // Android u otros con Web Share usable en el mismo gesto residual
    if (navigator.share && global.File) {
      const shared = await tryNativeShare(blob, name);
      if (shared.ok) return shared;
      if (shared.reason === 'not-allowed') {
        return showMobileSaveSheet(blob, name);
      }
    }

    return triggerAnchorDownload(blob, name);
  }

  global.BoletaTicketUI = {
    WIDTH,
    buildTicketHtml,
    downloadTicket,
    normalizeNums,
    pad,
    money,
  };
})(window);
