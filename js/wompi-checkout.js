/** Helpers públicos para pagar con Wompi (Web Checkout). Sin secretos. */
(function (global) {
  function submitWebCheckout(checkout) {
    if (!checkout || !checkout.public_key || !checkout.reference) {
      throw new Error('Datos de checkout incompletos');
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = checkout.checkout_url || 'https://checkout.wompi.co/p/';
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';

    const fields = {
      'public-key': checkout.public_key,
      currency: checkout.currency || 'COP',
      'amount-in-cents': String(checkout.amount_in_cents),
      reference: checkout.reference,
      'signature:integrity': checkout.signature,
      'redirect-url': checkout.redirect_url,
    };

    const cliente = checkout.cliente || {};
    if (cliente.email) fields['customer-data:email'] = cliente.email;
    if (cliente.full_name) fields['customer-data:full-name'] = cliente.full_name;
    if (cliente.phone_number) fields['customer-data:phone-number'] = cliente.phone_number;
    if (cliente.legal_id) {
      fields['customer-data:legal-id'] = cliente.legal_id;
      fields['customer-data:legal-id-type'] = cliente.legal_id_type || 'CC';
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

  global.WompiCheckout = { submitWebCheckout };
})(window);
