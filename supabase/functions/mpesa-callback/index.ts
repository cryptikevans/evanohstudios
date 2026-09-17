import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const body = await req.json();

    console.log("M-PESA CALLBACK RECEIVED");
    console.log(JSON.stringify(body));

    const callback = body?.Body?.stkCallback;

    if (!callback) {
      console.log("No stkCallback found");
      return new Response("OK", { status: 200 });
    }

    const checkoutRequestId = String(callback.CheckoutRequestID || "");
    const resultCode = Number(callback.ResultCode);

    console.log("CheckoutRequestID:", checkoutRequestId);
    console.log("ResultCode:", resultCode);

    if (!checkoutRequestId) {
      console.log("Missing CheckoutRequestID");
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the payment created when the STK Push was initiated
    const { data: payment, error: findError } = await supabase
      .from("payments")
      .select("*")
      .eq("checkout_request_id", checkoutRequestId)
      .maybeSingle();

    if (findError) {
      console.error("PAYMENT LOOKUP ERROR:", findError);
      return new Response("OK", { status: 200 });
    }

    if (!payment) {
      console.error(
        "NO PAYMENT FOUND FOR CHECKOUT REQUEST:",
        checkoutRequestId
      );

      return new Response("OK", { status: 200 });
    }

    console.log("Payment found:", payment.id);
    console.log("Current payment status:", payment.status);

    // Prevent duplicate callbacks from generating another ticket
    if (payment.status === "paid") {
      console.log("Payment already marked as paid");
      return new Response("OK", { status: 200 });
    }

    // Payment failed / cancelled / timed out
    if (resultCode !== 0) {
      console.log("M-PESA PAYMENT NOT SUCCESSFUL:", resultCode);

      const { error: failedError } = await supabase
        .from("payments")
        .update({
          status: "cancelled"
        })
        .eq("id", payment.id);

      if (failedError) {
        console.error("FAILED PAYMENT UPDATE ERROR:", failedError);
      } else {
        console.log("Payment marked as cancelled");
      }

      return new Response("OK", { status: 200 });
    }

    // Successful payment
    const items = callback.CallbackMetadata?.Item || [];

    console.log("Callback metadata:", JSON.stringify(items));

    const receipt =
      items.find(
        (item: any) => item.Name === "MpesaReceiptNumber"
      )?.Value ?? null;

    const amount =
      items.find(
        (item: any) => item.Name === "Amount"
      )?.Value ?? null;

    const phone =
      items.find(
        (item: any) => item.Name === "PhoneNumber"
      )?.Value ?? null;

    console.log("M-PESA RECEIPT:", receipt);
    console.log("AMOUNT:", amount);
    console.log("PHONE:", phone);

    const ticketCode =
      "EVN-" +
      crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 10)
        .toUpperCase();

    const { data: updatedPayment, error: updateError } = await supabase
      .from("payments")
      .update({
        status: "paid",
        mpesa_receipt: receipt,
        ticket_code: ticketCode,
        paid_at: new Date().toISOString()
      })
      .eq("id", payment.id)
      .select()
      .single();

    if (updateError) {
      console.error("PAYMENT UPDATE ERROR:", updateError);
      return new Response("OK", { status: 200 });
    }

    console.log("================================");
    console.log("PAYMENT SUCCESSFULLY UPDATED");
    console.log("Payment ID:", updatedPayment.id);
    console.log("Receipt:", receipt);
    console.log("Ticket:", ticketCode);
    console.log("================================");

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("CALLBACK ERROR:", error);

    // Always acknowledge Safaricom's callback
    return new Response("OK", { status: 200 });
  }
});
