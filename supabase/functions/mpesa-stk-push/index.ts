import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function fail(message: string, status = 500) {
  return json({ ok: false, message }, status);
}

/** Normalizes a Kenyan phone number to 2547XXXXXXXX / 2541XXXXXXXX format. */
function normalizePhone(input: string): string {
  const digits = String(input || '').replace(/^\+/, '').replace(/\s/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  throw new Error('Invalid Safaricom number');
}

/** Returns the current time in Africa/Nairobi as YYYYMMDDHHmmss (M-Pesa timestamp format). */
function mpesaTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

interface StkPushRequest {
  event_id: string;
  quantity: number;
  phone: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const { event_id, quantity: rawQty, phone: rawPhone } = (await req.json()) as StkPushRequest;
    const quantity = Number(rawQty);

    if (!event_id || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return fail('Invalid ticket request', 400);
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // --- Look up event ---
    const { data: event, error: eventError } = await db
      .from('events')
      .select('id,name,ticket_price,published,archived')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('EVENT LOOKUP ERROR:', eventError);
      return fail('Could not verify event.', 500);
    }
    if (!event?.published) return fail('Event unavailable.', 404);
    if (event.archived) return fail('This event is no longer accepting ticket payments.', 400);

    // --- Compute amount ---
    const amount = Math.round(Number(event.ticket_price) * quantity);
    if (!Number.isFinite(amount) || amount <= 0) return fail('Invalid ticket amount.', 400);

    const phone = normalizePhone(rawPhone);

    // --- M-Pesa environment/config ---
    const mpesaEnv = Deno.env.get('MPESA_ENV') || 'sandbox';
    const baseUrl = mpesaEnv === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');
    if (!consumerKey || !consumerSecret) throw new Error('M-Pesa credentials are not configured.');

    const shortcode = Deno.env.get('MPESA_SHORTCODE');
    if (!shortcode) throw new Error('MPESA_SHORTCODE is not configured.');

    const transactionType = Deno.env.get('MPESA_TRANSACTION_TYPE') || 'CustomerBuyGoodsOnline';

    // --- OAuth ---
    const authRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
    });
    const authJson = await authRes.json();

    if (!authRes.ok || !authJson.access_token) {
      console.error('MPESA AUTH ERROR:', authJson);
      throw new Error('M-Pesa authorization failed.');
    }

    // --- STK push password ---
    const timestamp = mpesaTimestamp();
    const password = btoa(`${shortcode}${Deno.env.get('MPESA_PASSKEY')}${timestamp}`);

    // --- Create pending payment record ---
    const { data: payment, error: insertError } = await db
      .from('payments')
      .insert({ event_id, quantity, amount, phone, status: 'pending' })
      .select('id')
      .single();

    if (insertError) {
      console.error('PAYMENT INSERT ERROR:', insertError);
      throw insertError;
    }

    // --- Send STK push ---
    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: Deno.env.get('MPESA_CALLBACK_URL'),
      AccountReference: 'SELEKTA',
      TransactionDesc: `${event.name} ticket`,
    };

    console.log('STK PUSH CONFIG:', { environment: mpesaEnv, transactionType, shortcode, amount, phone, event_id, quantity });

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authJson.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(stkBody),
    });

    // Read as text first — avoids "Unexpected end of JSON input" if
    // Safaricom returns an empty or non-JSON response.
    const rawResponse = await stkRes.text();
    console.log('STK HTTP STATUS:', stkRes.status);
    console.log('STK RAW RESPONSE:', rawResponse);

    let stkJson: any = {};
    try {
      stkJson = rawResponse ? JSON.parse(rawResponse) : {};
    } catch (parseError) {
      console.error('STK RESPONSE JSON PARSE ERROR:', parseError);
      throw new Error(`Safaricom returned an invalid response (HTTP ${stkRes.status}).`);
    }

    console.log('STK PUSH RESPONSE:', stkJson);

    if (!stkRes.ok || stkJson.ResponseCode !== '0') {
      await db.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      throw new Error(
        stkJson.errorMessage ||
        stkJson.ResponseDescription ||
        stkJson.errorCode ||
        `STK Push failed (HTTP ${stkRes.status})`
      );
    }

    // --- Save M-Pesa request IDs ---
    const { error: updateError } = await db
      .from('payments')
      .update({
        merchant_request_id: stkJson.MerchantRequestID,
        checkout_request_id: stkJson.CheckoutRequestID,
      })
      .eq('id', payment.id);

    if (updateError) console.error('PAYMENT UPDATE ERROR:', updateError);

    return json({ ok: true, payment_id: payment.id, message: 'M-Pesa payment prompt sent.' });
  } catch (e) {
    console.error('MPESA STK PUSH ERROR:', e);
    return fail(e?.message || 'Payment error', 500);
  }
});
