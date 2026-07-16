/** Helpers públicos para pagar con Wompi. Sin secretos. */
(function (global) {
  const WIDGET_SRC = 'https://checkout.wompi.co/widget.js';

  function loadWidgetScript() {
    return new Promise((resolve, reject) => {
      if (global.WidgetCheckout) {
        resolve(global.WidgetCheckout);
        return;
      }
      const existing = document.querySelector(`script[src="${WIDGET_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(global.WidgetCheckout));
        existing.addEventListener('error', () =>
          reject(new Error('No se pudo cargar el widget de Wompi'))
        );
        // Si ya cargó
        if (global.WidgetCheckout) resolve(global.WidgetCheckout);
        return;
      }
      const script = document.createElement('script');
      script.src = WIDGET_SRC;
      script.async = true;
      script.onload = () => resolve(global.WidgetCheckout);
      script.onerror = () => reject(new Error('No se pudo cargar el widget de Wompi'));
      document.head.appendChild(script);
    });
  }

  function normalizeCheckout(checkout) {
    if (!checkout) return null;
    return {
      publicKey: checkout.public_key || checkout.publicKey,
      currency: checkout.currency || 'COP',
      amountInCents: Number(checkout.amount_in_cents || checkout.amountInCents),
      reference: checkout.reference,
      signature: checkout.signature,
      redirectUrl: checkout.redirect_url || checkout.redirectUrl,
      checkoutUrl: checkout.checkout_url || checkout.checkoutUrl || 'https://checkout.wompi.co/p/',
      cliente: checkout.cliente || checkout.customerData || {},
    };
  }

  /**
   * Web Checkout oficial: formulario method=GET (Wompi no usa POST).
   */
  function submitWebCheckout(raw) {
    const checkout = normalizeCheckout(raw);
    if (
      !checkout?.publicKey ||
      !checkout?.reference ||
      !checkout?.amountInCents ||
      !checkout?.signature
    ) {
      throw new Error('Datos de checkout incompletos');
    }

    const form = document.createElement('form');
    form.method = 'GET';
    form.action = checkout.checkoutUrl;
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const fields = {
      'public-key': checkout.publicKey,
      currency: checkout.currency,
      'amount-in-cents': String(checkout.amountInCents),
      reference: checkout.reference,
      'signature:integrity': checkout.signature,
    };

    if (checkout.redirectUrl) fields['redirect-url'] = checkout.redirectUrl;

    const cliente = checkout.cliente || {};
    if (cliente.email) fields['customer-data:email'] = cliente.email;
    if (cliente.full_name || cliente.fullName) {
      fields['customer-data:full-name'] = cliente.full_name || cliente.fullName;
    }
    if (cliente.phone_number || cliente.phoneNumber) {
      fields['customer-data:phone-number'] =
        cliente.phone_number || cliente.phoneNumber;
      fields['customer-data:phone-number-prefix'] =
        cliente.phone_number_prefix || cliente.phoneNumberPrefix || '+57';
    }
    if (cliente.legal_id || cliente.legalId) {
      fields['customer-data:legal-id'] = cliente.legal_id || cliente.legalId;
      fields['customer-data:legal-id-type'] =
        cliente.legal_id_type || cliente.legalIdType || 'CC';
    }

    Object.entries(fields).forEach(([name, value]) => {
      if (value == null || value === '') return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value);
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }

  /**
   * Widget (preferido): abre modal en la misma página.
   * Si falla la carga del script, cae a Web Checkout GET.
   */
  async function openCheckout(raw, onResult) {
    const checkout = normalizeCheckout(raw);
    if (
      !checkout?.publicKey ||
      !checkout?.reference ||
      !checkout?.amountInCents ||
      !checkout?.signature
    ) {
      throw new Error('Datos de checkout incompletos');
    }

    try {
      await loadWidgetScript();
      if (!global.WidgetCheckout) throw new Error('WidgetCheckout no disponible');

      const cliente = checkout.cliente || {};
      const cfg = {
        currency: checkout.currency,
        amountInCents: checkout.amountInCents,
        reference: checkout.reference,
        publicKey: checkout.publicKey,
        signature: { integrity: checkout.signature },
      };
      if (checkout.redirectUrl) cfg.redirectUrl = checkout.redirectUrl;

      const customerData = {};
      if (cliente.email) customerData.email = cliente.email;
      if (cliente.full_name || cliente.fullName) {
        customerData.fullName = cliente.full_name || cliente.fullName;
      }
      if (cliente.phone_number || cliente.phoneNumber) {
        customerData.phoneNumber = cliente.phone_number || cliente.phoneNumber;
        customerData.phoneNumberPrefix =
          cliente.phone_number_prefix || cliente.phoneNumberPrefix || '+57';
      }
      if (cliente.legal_id || cliente.legalId) {
        customerData.legalId = cliente.legal_id || cliente.legalId;
        customerData.legalIdType =
          cliente.legal_id_type || cliente.legalIdType || 'CC';
      }
      if (Object.keys(customerData).length) cfg.customerData = customerData;

      const widget = new global.WidgetCheckout(cfg);
      widget.open(function (result) {
        if (typeof onResult === 'function') onResult(result);
      });
      return { mode: 'widget' };
    } catch (err) {
      console.warn('[Wompi] Widget falló, usando Web Checkout GET:', err);
      submitWebCheckout(raw);
      return { mode: 'redirect' };
    }
  }

  global.WompiCheckout = {
    submitWebCheckout,
    openCheckout,
  };
})(window);
