(() => {
  const form = document.getElementById("ticketRecoveryForm");

  if (!form) {
    console.log("Ticket recovery form not found.");
    return;
  }

  const input = document.getElementById("mpesaReceiptInput");
  const button = document.getElementById("ticketRecoveryBtn");
  const message = document.getElementById("ticketRecoveryMessage");
  const result = document.getElementById("ticketRecoveryResult");

  const setMessage = (text, type = "") => {
    if (!message) return;
    message.textContent = text;
    message.className = `ticket-recovery-message ${type}`;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const rawInput = input.value.trim().toUpperCase();

    /*
     * Extract a 10-character M-Pesa transaction code
     * from either:
     *
     * UIHB971XDO
     *
     * or a full pasted M-Pesa message containing
     * UIHB971XDO somewhere inside it.
     */
    const match = rawInput.match(/\b[A-Z0-9]{10}\b/);

    const receipt = match ? match[0] : "";

    console.log("RAW M-PESA INPUT:", rawInput);
    console.log("EXTRACTED RECEIPT:", receipt);

    if (!receipt) {
      setMessage(
        "We couldn't detect a 10-character M-Pesa transaction code. Please check the message and try again.",
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
      `M-Pesa code detected: ${receipt}. Checking your ticket...`,
      "loading"
    );

    try {
      const config = window.SELEKTA_CONFIG || {};

      if (!config.SUPABASE_URL) {
        throw new Error("Supabase URL is not configured.");
      }

      console.log("Checking receipt:", receipt);

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

      const data = await response.json().catch(() => ({}));

      console.log("Recovery response:", data);

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to find the ticket."
        );
      }

      if (data.status === "pending") {
        setMessage(
          "Payment found, but confirmation has not reached us yet. Please wait a little and try again.",
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
          "Payment confirmed, but your ticket is still being generated. Please try again shortly.",
          "pending"
        );
        return;
      }

      /*
       * Open the existing ticket using its unique ticket code.
       */
      const ticketUrl =
        "https://evanohstudios.vercel.app/ticket.html?code=" +
        encodeURIComponent(data.ticket_code);

      console.log("REDIRECTING TO:", ticketUrl);

      setMessage(
        "Payment confirmed. Opening your digital ticket...",
        "success"
      );

      setTimeout(() => {
        window.location.replace(ticketUrl);
      }, 300);

    } catch (err) {
      console.error("Ticket recovery error:", err);

      setMessage(
        err.message || "Something went wrong. Please try again.",
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = "FIND MY TICKET";
    }
  });

})();
