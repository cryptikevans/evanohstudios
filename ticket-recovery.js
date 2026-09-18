(() => {
  const form = document.getElementById("ticketRecoveryForm");
  if (!form) return;

  const input = document.getElementById("mpesaReceiptInput");
  const button = document.getElementById("ticketRecoveryBtn");
  const message = document.getElementById("ticketRecoveryMessage");
  const result = document.getElementById("ticketRecoveryResult");

  const setMessage = (text, type = "") => {
    message.textContent = text;
    message.className = `ticket-recovery-message ${type}`;
  };

  const formatDate = (value) => {
    if (!value) return "—";

    const d = new Date(`${value}T00:00:00`);

    return Number.isNaN(d.getTime())
      ? value
      : d.toLocaleDateString("en-KE", {
          day: "numeric",
          month: "long",
          year: "numeric"
        });
  };

  const showResult = (ticket) => {

    document.getElementById("recoveredEventName").textContent =
      ticket.event_name || "Event Ticket";

    document.getElementById("recoveredEventDate").textContent =
      formatDate(ticket.event_date);

    document.getElementById("recoveredEventVenue").textContent =
      ticket.venue || "—";

    document.getElementById("recoveredQuantity").textContent =
      ticket.quantity ?? "—";

    document.getElementById("recoveredAmount").textContent =
      ticket.amount != null
        ? `KSh ${Number(ticket.amount).toLocaleString()}`
        : "—";

    document.getElementById("recoveredReceipt").textContent =
      ticket.mpesa_receipt || "—";

    document.getElementById("recoveredTicketCode").textContent =
      ticket.ticket_code || "—";


    /*
     * =====================================================
     * IMPORTANT TICKET REDIRECT
     * =====================================================
     *
     * Build the ticket URL from the CURRENT website address.
     *
     * This works correctly whether the website is:
     *
     * https://yourdomain.com/
     *
     * or:
     *
     * https://username.github.io/repository/
     *
     * We are NOT going to the event page.
     * We are NOT creating another payment.
     *
     * We are opening the EXISTING ticket.
     */

    if (!ticket.ticket_code) {
      setMessage(
        "Payment confirmed, but no ticket code was found.",
        "error"
      );
      return;
    }

    const ticketUrl = new URL(
      "ticket.html",
      window.location.href
    );

    ticketUrl.searchParams.set(
      "code",
      ticket.ticket_code
    );

    console.log("OPENING DIGITAL TICKET:", ticketUrl.href);

    // Open the actual digital ticket.
    window.location.assign(ticketUrl.href);
  };


  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const receipt = input.value
      .trim()
      .toUpperCase();

    if (!receipt) {
      setMessage(
        "Please enter your M-Pesa transaction code.",
        "error"
      );
      return;
    }

    button.disabled = true;
    button.textContent = "CHECKING...";

    if (result) {
      result.hidden = true;
    }

    setMessage(
      "Checking your payment and ticket...",
      "loading"
    );


    try {

      const config =
        window.SELEKTA_CONFIG || {};

      if (!config.SUPABASE_URL) {
        throw new Error(
          "Supabase URL is not configured."
        );
      }


      const response = await fetch(
        `${config.SUPABASE_URL}/functions/v1/ticket-recovery`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            mpesa_receipt: receipt
          })
        }
      );


      const data =
        await response.json().catch(() => ({}));


      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to find the ticket."
        );
      }


      /*
       * Payment exists but is still pending.
       */
      if (data.status === "pending") {

        setMessage(
          "Payment found, but M-Pesa confirmation has not reached us yet. Please wait a little and try again.",
          "pending"
        );

        return;
      }


      /*
       * Payment exists but isn't paid.
       */
      if (data.status !== "paid") {

        setMessage(
          "This payment has not been confirmed as paid.",
          "error"
        );

        return;
      }


      /*
       * Payment is paid but ticket hasn't
       * been generated yet.
       */
      if (!data.ticket_code) {

        setMessage(
          "Payment is confirmed, but the ticket is still being generated. Please try again shortly.",
          "pending"
        );

        return;
      }


      /*
       * Everything is confirmed.
       *
       * Open the EXISTING digital ticket.
       */
      setMessage(
        "Payment confirmed. Opening your digital ticket...",
        "success"
      );

      showResult(data);


    } catch (err) {

      console.error(
        "Ticket recovery error:",
        err
      );

      setMessage(
        err.message ||
        "Something went wrong. Please try again.",
        "error"
      );

    } finally {

      button.disabled = false;
      button.textContent = "FIND MY TICKET";

    }
  });

})();
