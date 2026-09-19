import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: CORS
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, message: "Method not allowed." }, 405);
  }

  try {
    const { ticket_code, action } = await req.json();

    const code = String(ticket_code || "")
      .trim()
      .toUpperCase();

    if (!code) {
      return json({
        ok: false,
        message: "Ticket code is required."
      }, 400);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: payment, error } = await db
      .from("payments")
      .select(`
        id,
        event_id,
        quantity,
        amount,
        phone,
        status,
        mpesa_receipt,
        ticket_code,
        created_at,
        paid_at,
        checked_in,
        checked_in_at,
        events:event_id(
          name,
          event_type,
          event_date,
          venue,
          poster_path
        )
      `)
      .eq("ticket_code", code)
      .maybeSingle();

    if (error) {
      console.error("TICKET LOOKUP ERROR:", error);

      return json({
        ok: false,
        message: "Could not check the ticket."
      }, 500);
    }

    if (!payment) {
      return json({
        ok: false,
        status: "not_found",
        message: "Ticket not found."
      }, 404);
    }

    if (payment.status !== "paid") {
      return json({
        ok: false,
        status: "unpaid",
        message: "This ticket has not been confirmed as paid."
      }, 400);
    }

    const event = Array.isArray(payment.events)
      ? payment.events[0]
      : payment.events;

    // Checking a ticket without checking it in.
    if (action !== "checkin") {
      if (payment.checked_in) {
        return json({
          ok: true,
          status: "already_checked_in",
          message: "This ticket has already been checked in.",
          ticket: {
            ticket_code: payment.ticket_code,
            quantity: payment.quantity,
            amount: payment.amount,
            mpesa_receipt: payment.mpesa_receipt,
            checked_in: true,
            checked_in_at: payment.checked_in_at,
            event_name: event?.name,
            event_type: event?.event_type,
            event_date: event?.event_date,
            venue: event?.venue
          }
        });
      }

      return json({
        ok: true,
        status: "valid",
        message: "Valid ticket.",
        ticket: {
          ticket_code: payment.ticket_code,
          quantity: payment.quantity,
          amount: payment.amount,
          mpesa_receipt: payment.mpesa_receipt,
          checked_in: false,
          checked_in_at: null,
          event_name: event?.name,
          event_type: event?.event_type,
          event_date: event?.event_date,
          venue: event?.venue
        }
      });
    }

    // Prevent double check-in.
    if (payment.checked_in) {
      return json({
        ok: false,
        status: "already_checked_in",
        message: "This ticket has already been checked in.",
        checked_in_at: payment.checked_in_at,
        ticket_code: payment.ticket_code
      }, 409);
    }

    const checkedInAt = new Date().toISOString();

    const { data: updated, error: updateError } = await db
      .from("payments")
      .update({
        checked_in: true,
        checked_in_at: checkedInAt
      })
      .eq("id", payment.id)
      .eq("checked_in", false)
      .select("id,checked_in,checked_in_at,ticket_code")
      .maybeSingle();

    if (updateError) {
      console.error("CHECK-IN UPDATE ERROR:", updateError);

      return json({
        ok: false,
        message: "Could not check in this ticket."
      }, 500);
    }

    if (!updated) {
      return json({
        ok: false,
        status: "already_checked_in",
        message: "This ticket has already been checked in."
      }, 409);
    }

    return json({
      ok: true,
      status: "checked_in",
      message: "Guest checked in successfully.",
      ticket: {
        ticket_code: payment.ticket_code,
        quantity: payment.quantity,
        amount: payment.amount,
        mpesa_receipt: payment.mpesa_receipt,
        checked_in: true,
        checked_in_at: checkedInAt,
        event_name: event?.name,
        event_type: event?.event_type,
        event_date: event?.event_date,
        venue: event?.venue
      }
    });

  } catch (error) {
    console.error("TICKET CHECK-IN ERROR:", error);

    return json({
      ok: false,
      message: "Unable to process ticket."
    }, 500);
  }
});
