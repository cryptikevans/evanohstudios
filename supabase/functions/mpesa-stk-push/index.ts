import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function fail(message: string, status = 500) {
  return json({ ok: false, message }, status);
}

function normalizePhone(input: string): string {
  const digits = String(input || '')
    .replace(/^\+/, '')
    .replace(/\s/g, '');

  if (/^0[17]\d{8}$/.test(digits)) {
    return '254' + digits.slice(1);
  }

  if (/^254[17]\d{8}$/.test(digits)) {
    return digits;
  }

  throw new Error('Invalid Safaricom number');
}

function mpesaTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const p = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

interface StkPushRequest {
  event_id: string;
  quantity: number;
  phone: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return fail('Method not allowed.', 405);
  }

  try {
    const {
      event_id,
      quantity: rawQty,
      phone: rawPhone,
    } = (await req.json()) as StkPushRequest;

    const quantity = Number(rawQty);

    if (
      !event_id ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 20
    ) {
      return fail('Invalid ticket request', 400);
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // --------------------------------------------------
    // EVENT
    // --------------------------------------------------

    const { data: event, error: eventError } = await db
      .from('events')
      .select('id,name,ticket_price,published,archived')
      .eq('id', event_id)
      .single();

    if (eventError) {
      console.error('EVENT LOOKUP ERROR:', eventError);
      return fail('Could not verify event.', 500);
    }

    if (!event?.published) {
      return fail('Event unavailable.', 404);
    }

    if (event.archived) {
      return fail(
        'This event is no longer accepting ticket payments.',
        400
      );
    }

    // --------------------------------------------------
    // AMOUNT
    // --------------------------------------------------

    const amount = Math.round(
      Number(event.ticket_price) * quantity
    );

    if (!Number.isFinite(amount) || amount <= 0) {
      return fail('Invalid ticket amount.', 400);
    }

    const phone = normalizePhone(rawPhone);

    // --------------------------------------------------
    // MPESA CONFIG
    // --------------------------------------------------

    const mpesaEnv =
      Deno.env.get('MPESA_ENV') || 'sandbox';

    const baseUrl =
      mpesaEnv === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';

    const consumerKey =
      Deno.env.get('MPESA_CONSUMER_KEY');

    const consumerSecret =
      Deno.env.get('MPESA_CONSUMER_SECRET');

    const passkey =
      Deno.env.get('MPESA_PASSKEY');

    const shortcode =
      Deno.env.get('MPESA_SHORTCODE');

    const callbackUrl =
      Deno.env.get('MPESA_CALLBACK_URL');

    const transactionType =
      Deno.env.get('MPESA_TRANSACTION_TYPE') ||
      'CustomerBuyGoodsOnline';

    if (!consumerKey || !consumerSecret) {
      throw new Error(
        'M-Pesa consumer credentials are not configured.'
      );
    }

    if (!shortcode) {
      throw new Error(
        'MPESA_SHORTCODE is not configured.'
      );
    }

    if (!passkey) {
      throw new Error(
        'MPESA_PASSKEY is not configured.'
      );
    }

    if (!callbackUrl) {
      throw new Error(
        'MPESA_CALLBACK_URL is not configured.'
      );
    }

    console.log('STK PUSH CONFIG:', {
      environment: mpesaEnv,
      transactionType,
      shortcode,
      amount,
      event_id,
      quantity,
      phone,
      callbackConfigured: true,
    });

    // --------------------------------------------------
    // OAUTH
    // --------------------------------------------------

    const authRes = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization:
            `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}`,
        },
      }
    );

    const authRaw = await authRes.text();

    console.log(
      'MPESA AUTH HTTP STATUS:',
      authRes.status
    );

    console.log(
      'MPESA AUTH RAW RESPONSE:',
      authRaw
    );

    let authJson: any = {};

    try {
      authJson = authRaw
        ? JSON.parse(authRaw)
        : {};
    } catch {
      throw new Error(
        `M-Pesa authorization returned invalid data (HTTP ${authRes.status}).`
      );
    }

    if (
      !authRes.ok ||
      !authJson.access_token
    ) {
      console.error(
        'MPESA AUTH ERROR:',
        authJson
      );

      throw new Error(
        'M-Pesa authorization failed.'
      );
    }

    // --------------------------------------------------
    // STK PASSWORD
    // --------------------------------------------------

    const timestamp = mpesaTimestamp();

    const password = btoa(
      `${shortcode}${passkey}${timestamp}`
    );

    // --------------------------------------------------
    // CREATE PENDING PAYMENT
    // --------------------------------------------------

    const {
      data: payment,
      error: insertError,
    } = await db
      .from('payments')
      .insert({
        event_id,
        quantity,
        amount,
        phone,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(
        'PAYMENT INSERT ERROR:',
        insertError
      );

      throw insertError;
    }

    // --------------------------------------------------
    // STK REQUEST
    // --------------------------------------------------

    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: 'SELEKTA',
      TransactionDesc: `${event.name} ticket`,
    };

    console.log(
      'STK REQUEST:',
      {
        BusinessShortCode: shortcode,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        AccountReference: 'SELEKTA',
      }
    );

    const stkRes = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${authJson.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stkBody),
      }
    );

    // IMPORTANT:
    // Read as text first instead of using .json()
    // so an empty Safaricom response does not crash
    // the function with "Unexpected end of JSON input".

    const rawResponse =
      await stkRes.text();

    console.log(
      'STK HTTP STATUS:',
      stkRes.status
    );

    console.log(
      'STK RAW RESPONSE:',
      rawResponse
    );

    let stkJson: any = {};

    try {
      stkJson = rawResponse
        ? JSON.parse(rawResponse)
        : {};
    } catch (parseError) {
      console.error(
        'STK RESPONSE JSON PARSE ERROR:',
        parseError
      );

      await db
        .from('payments')
        .update({
          status: 'failed',
        })
        .eq('id', payment.id);

      throw new Error(
        `Safaricom returned invalid data (HTTP ${stkRes.status}).`
      );
    }

    console.log(
      'STK PUSH RESPONSE:',
      stkJson
    );

    // --------------------------------------------------
    // STK FAILURE
    // --------------------------------------------------

    if (
      !stkRes.ok ||
      stkJson.ResponseCode !== '0'
    ) {
      await db
        .from('payments')
        .update({
          status: 'failed',
        })
        .eq('id', payment.id);

      throw new Error(
        stkJson.errorMessage ||
        stkJson.ResponseDescription ||
        stkJson.errorCode ||
        `STK Push failed (HTTP ${stkRes.status})`
      );
    }

    // --------------------------------------------------
    // SAVE MPESA REQUEST IDS
    // --------------------------------------------------

    const {
      error: updateError,
    } = await db
      .from('payments')
      .update({
        merchant_request_id:
          stkJson.MerchantRequestID,

        checkout_request_id:
          stkJson.CheckoutRequestID,
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error(
        'PAYMENT UPDATE ERROR:',
        updateError
      );
    }

    return json({
      ok: true,
      payment_id: payment.id,
      message:
        'M-Pesa payment prompt sent.',
    });

  } catch (e) {
    console.error(
      'MPESA STK PUSH ERROR:',
      e
    );

    return fail(
      e instanceof Error
        ? e.message
        : 'Payment error',
      500
    );
  }
});
