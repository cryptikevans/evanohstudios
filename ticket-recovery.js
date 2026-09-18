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

  // Extract the M-Pesa transaction code from either:
  // UIIB971WAU
  // OR a full M-Pesa confirmation message.
  const extractMpesaCode = (value) => {
    const text = String(value || "").trim().toUpperCase();

    // Look for the first standalone 10-character
    // letters/numbers transaction code.
    const match = text.match(/\b[A-Z0-9]{10}\b/);

    return match ? match[0] : "";
  };

  // When user pastes/types a full M-Pesa message,
  // automatically replace it with just the transaction code.
  input.addEventListener("input", () => {
    const code = extractMpesaCode(input.value);

    if (code) {
      input.value = code;
      console.log("EXTRACTED M-PESA CODE:", code);
    }
  });

  // Extra protection specifically for paste.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      const code = extractMpesaCode(input.value);

      if (code) {
        input.value = code;
        console.log("PASTED M-PESA MESSAGE:");
        console.log("EXTRACTED CODE:", code);
      }
    }, 50);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Even if the user manually enters a full message,
    // extract only the transaction code.
    const receipt = extractMpesaCode(input.value);

    console.log("FINAL RECEIPT SENT TO SERVER:", receipt);

    if (!receipt) {
      setMessage(
        "Please paste a valid M-Pesa confirmation message or enter the 10-character transaction code.",
        "error"
      );
      return;
    }

    // Make sure the field visibly contains only the code.
    input.value = receipt;

    button.disabled = true;
    button.textContent = "CHECKING...";

    if (result) {
      result.hidden = true;
    }

    setMessage("Checking your payment and ticket...", "loading");

    try {
      const config = window.SELEKTA_CONFIG || {};

      if (!config.SUPABASE_URL) {
        throw new Error("Supabase URL is not configured.");
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

      const data = await response.json().catch(() => ({}));

      console.log("RECOVERY RESPONSE:", data);

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
