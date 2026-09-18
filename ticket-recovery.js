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
     * OPEN THE ACTUAL DIGITAL TICKET
     *
     * The customer's existing ticket code is used.
     * No new payment is created.
     * No event checkout page is opened.
     */

    if (!ticket.ticket_code) {
      setMessage(
        "Payment confirmed, but no ticket code was found.",
        "error"
      );
      return;
    }

    const ticketUrl =
      `https://evanohstudios.vercel.app/ticket.html?code=${encodeURIComponent(ticket.ticket_code)}`;

    console.log("Opening digital ticket:", ticketUrl);

    window.location.href = ticketUrl;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const receipt = input.value.trim().toUpperCase();

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
      const config = window.SELEKTA_CONFIG || {};

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

      if (data.status === "pending") {
        setMessage(
          "Payment found, but M-Pesa confirmation has not reached us yet. Please wait a little and try again.",
          "pending"
        );
        return;
      }

      if (data.status !== "paid") {
        setMessage(
          "This payment has not been confirmed as paid.",
          "error"
        );
        return;
      }

      if (!data.ticket_code) {
        setMessage(
          "Payment is confirmed, but the ticket is still being generated. Please try again shortly.",
          "pending"
        );
        return;
      }

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
