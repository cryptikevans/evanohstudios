import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { ticket_code } = await req.json();
    const code = String(ticket_code || '').trim().toUpperCase();

    if (!code) {
      return new Response(JSON.stringify({ok:false, message:'Ticket code is required.'}), {
        status:400, headers:{...CORS, 'Content-Type':'application/json'}
      });
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await db
      .from('payments')
      .select(`id,event_id,quantity,amount,mpesa_receipt,status,ticket_code,created_at,paid_at,events:event_id(name,event_type,event_date,venue,poster_path)`)
      .eq('ticket_code', code)
      .maybeSingle();

    if (error) {
      console.error('TICKET LOOKUP ERROR:', error);
      return new Response(JSON.stringify({ok:false, message:'Could not verify ticket.'}), {
        status:500, headers:{...CORS, 'Content-Type':'application/json'}
      });
    }

    if (!data || data.status !== 'paid') {
      return new Response(JSON.stringify({ok:false, message:'This ticket is not valid or has not been paid.'}), {
        status:404, headers:{...CORS, 'Content-Type':'application/json'}
      });
    }

    const event = Array.isArray(data.events) ? data.events[0] : data.events;
    const posterUrl = event?.poster_path
      ? db.storage.from('event-posters').getPublicUrl(event.poster_path).data.publicUrl
      : null;

    return new Response(JSON.stringify({
      ok:true,
      ticket:{
        ticket_code:data.ticket_code,
        quantity:data.quantity,
        amount:data.amount,
        mpesa_receipt:data.mpesa_receipt,
        created_at:data.created_at,
        paid_at:data.paid_at,
        event_name:event?.name,
        event_type:event?.event_type,
        event_date:event?.event_date,
        venue:event?.venue,
        poster_url:posterUrl
      }
    }), {headers:{...CORS, 'Content-Type':'application/json'}});
  } catch (e) {
    console.error('TICKET FUNCTION ERROR:', e);
    return new Response(JSON.stringify({ok:false, message:'Ticket verification failed.'}), {
      status:500, headers:{...CORS, 'Content-Type':'application/json'}
    });
  }
});
