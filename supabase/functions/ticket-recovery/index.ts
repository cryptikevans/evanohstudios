import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const receipt = String(body?.mpesa_receipt || "").trim().toUpperCase();

    if (!receipt || receipt.length < 5 || receipt.length > 30) {
      return json({ error: "Enter a valid M-Pesa transaction code." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Server configuration error." }, 500);

    const db = createClient(url, key);

    const { data: payment, error } = await db
      .from("payments")
      .select("id,event_id,quantity,amount,status,mpesa_receipt,ticket_code,paid_at")
      .eq("mpesa_receipt", receipt)
      .maybeSingle();

    if (error) {
      console.error("Payment lookup error:", error);
      return json({ error: "Could not check the payment right now." }, 500);
    }

    if (!payment) {
      return json({ error: "We couldn't find a payment with that M-Pesa code. Check the code and try again." }, 404);
    }

    if (payment.status !== "paid") {
      return json({
        status: payment.status || "pending",
        message: "Payment found, but it has not yet been confirmed."
      });
    }

    if (!payment.ticket_code) {
      return json({
        status: "paid",
        message: "Payment confirmed, but the ticket code is still being generated."
      });
    }

    let event = null;
    if (payment.event_id) {
      const { data } = await db
        .from("events")
        .select("name,event_date,venue")
        .eq("id", payment.event_id)
        .maybeSingle();
      event = data;
    }

    return json({
      status: "paid",
      payment_id: payment.id,
      ticket_code: payment.ticket_code,
      mpesa_receipt: payment.mpesa_receipt,
      quantity: payment.quantity,
      amount: payment.amount,
      paid_at: payment.paid_at,
      event_name: event?.name || "Event Ticket",
      event_date: event?.event_date || null,
      venue: event?.venue || null
    });
  } catch (error) {
    console.error("Ticket recovery error:", error);
    return json({ error: "Unable to process the request." }, 500);
  }
});
