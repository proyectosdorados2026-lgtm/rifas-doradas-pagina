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

    // Safari en iPhone/iPad no siempre respeta el atributo download para blobs.
    // La hoja nativa permite guardar la imagen en Fotos o Archivos.
    const isAppleMobile =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isAppleMobile && navigator.share && global.File) {
      const file = new File([blob], name, { type: 'image/png' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Boleta Sueños Dorados',
        });
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
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
