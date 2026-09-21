import { createClient } from 'npm:@supabase/supabase-js@2';

const C = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

const out = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { 'Content-Type': 'application/json', ...C } });

/* FORMAT PHONE NUMBER */
const phone = (x: string) => {
  x = String(x || '').replace(/^\+/, '').replace(/\s/g, '');
  if (/^0[17]\d{8}$/.test(x)) return '254' + x.slice(1);
  if (/^254[17]\d{8}$/.test(x)) return x;
  throw Error('Invalid Safaricom number');
};

/* KENYA TIMESTAMP */
const ts = () => {
  let p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  let o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${o.year}${o.month}${o.day}${o.hour}${o.minute}${o.second}`;
};

/* STK PUSH */
Deno.serve(async r => {

  /* CORS */
  if (r.method === 'OPTIONS') return new Response('ok', { headers: C });
  if (r.method !== 'POST') return out({ ok: false, message: 'Method not allowed.' }, 405);

  try {

    /* REQUEST */
    let { event_id, quantity, phone: raw } = await r.json();
    quantity = Number(quantity);

    if (!event_id || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return out({ ok: false, message: 'Invalid ticket request' }, 400);
    }

    /* SUPABASE */
    let db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    /* EVENT */
    let eventResult = await db.from('events').select('id,name,ticket_price,published,archived').eq('id', event_id).single();
    let ev = eventResult.data;

    if (eventResult.error) {
      console.error('EVENT LOOKUP ERROR:', eventResult.error);
      return out({ ok: false, message: 'Could not verify event.' }, 500);
    }

    if (!ev?.published) return out({ ok: false, message: 'Event unavailable.' }, 404);

    /* DO NOT ACCEPT PAYMENTS FOR ARCHIVED EVENTS */
    if (ev.archived) return out({ ok: false, message: 'This event is no longer accepting ticket payments.' }, 400);

    /* AMOUNT */
    let amount = Math.round(Number(ev.ticket_price) * quantity);
    if (!Number.isFinite(amount) || amount <= 0) return out({ ok: false, message: 'Invalid ticket amount.' }, 400);

    /* PHONE */
    let p = phone(raw);

    /* MPESA ENVIRONMENT */
    let env = Deno.env.get('MPESA_ENV') || 'sandbox';
    let base = env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

    /* DARAAJA AUTH */
    let consumerKey = Deno.env.get('MPESA_CONSUMER_KEY');
    let consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET');

    if (!consumerKey || !consumerSecret) throw Error('M-Pesa credentials are not configured.');

    let auth = btoa(`${consumerKey}:${consumerSecret}`);
    let a = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
    let aj = await a.json();

    if (!a.ok || !aj.access_token) {
      console.error('MPESA AUTH ERROR:', aj);
      throw Error('M-Pesa authorization failed.');
    }

    /* TILL CONFIGURATION */
    const shortcode = Deno.env.get('MPESA_SHORTCODE');
    if (!shortcode) throw Error('MPESA_SHORTCODE is not configured.');

    /* Your Buy Goods Till: 1592378 — keep the actual value in Supabase secrets. */

    const transactionType = Deno.env.get('MPESA_TRANSACTION_TYPE') || 'CustomerBuyGoodsOnline';

    /* STK PASSWORD */
    let t = ts();
    let pass = btoa(`${shortcode}${Deno.env.get('MPESA_PASSKEY')}${t}`);

    /* CREATE PAYMENT RECORD */
    let ins = await db.from('payments').insert({ event_id, quantity, amount, phone: p, status: 'pending' }).select('id').single();
    if (ins.error) {
      console.error('PAYMENT INSERT ERROR:', ins.error);
      throw ins.error;
    }

    /* STK PUSH BODY */
    let body = {
      BusinessShortCode: shortcode,
      Password: pass,
      Timestamp: t,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: p,
      PartyB: shortcode,
      PhoneNumber: p,
      CallBackURL: Deno.env.get('MPESA_CALLBACK_URL'),
      AccountReference: 'SELEKTA',
      TransactionDesc: `${ev.name} ticket`
    };

    console.log('STK PUSH CONFIG:', { environment: env, transactionType, shortcode, amount, phone: p, event_id, quantity });

    /* SEND STK PUSH */
    let sr = await fetch(
  `${base}/mpesa/stkpush/v1/processrequest`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aj.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
);

/*
  Read the response as text first.
  This prevents "Unexpected end of JSON input"
  when Safaricom returns an empty/non-JSON response.
*/
const rawResponse = await sr.text();

console.log('STK HTTP STATUS:', sr.status);
console.log('STK RAW RESPONSE:', rawResponse);

let sj: any = {};

try {
  sj = rawResponse
    ? JSON.parse(rawResponse)
    : {};
} catch (parseError) {
  console.error(
    'STK RESPONSE JSON PARSE ERROR:',
    parseError
  );

  throw Error(
    `Safaricom returned an invalid response (HTTP ${sr.status}).`
  );
}

console.log('STK PUSH RESPONSE:', sj);

/* HANDLE FAILURE */
if (!sr.ok || sj.ResponseCode !== '0') {

  await db
    .from('payments')
    .update({
      status: 'failed'
    })
    .eq('id', ins.data.id);

  throw Error(
    sj.errorMessage ||
    sj.ResponseDescription ||
    sj.errorCode ||
    `STK Push failed (HTTP ${sr.status})`
  );
}
      await db.from('payments').update({ status: 'failed' }).eq('id', ins.data.id);
      throw Error(sj.errorMessage || sj.ResponseDescription || 'STK Push failed');
    }

    /* SAVE MPESA REQUEST IDS */
    let update = await db.from('payments').update({ merchant_request_id: sj.MerchantRequestID, checkout_request_id: sj.CheckoutRequestID }).eq('id', ins.data.id);
    if (update.error) console.error('PAYMENT UPDATE ERROR:', update.error);

    /* SUCCESS */
    return out({ ok: true, payment_id: ins.data.id, message: 'M-Pesa payment prompt sent.' });

  } catch (e) {
    console.error('MPESA STK PUSH ERROR:', e);
    return out({ ok: false, message: e?.message || 'Payment error' }, 500);
  }
});
