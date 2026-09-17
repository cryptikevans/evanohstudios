const C = window.SELEKTA_CONFIG;
const S = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY);
const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function formatDate(x){
  return new Date(x + 'T00:00:00').toLocaleDateString('en-KE', {day:'2-digit', month:'long', year:'numeric'});
}

function money(x){
  return 'KSh ' + Number(x || 0).toLocaleString('en-KE', {minimumFractionDigits:0, maximumFractionDigits:2});
}

function setStatus(type, text){
  const el = $('ticketStatus');
  el.className = 'ticket-status ' + type;
  el.textContent = text;
}

function showError(message){
  setStatus('invalid', 'TICKET NOT FOUND');
  $('ticketContent').innerHTML = `<div class="ticket-error"><div class="ticket-error-icon">×</div><h1>Invalid or unavailable ticket</h1><p>${esc(message)}</p><a class="btn" href="index.html#events">View Events</a></div>`;
}

async function loadTicket(){
  const code = new URLSearchParams(location.search).get('code')?.trim();
  if(!code){ showError('No ticket code was provided.'); return; }

  const r = await S.functions.invoke('ticket-status', {body:{ticket_code:code}});
  if(r.error || !r.data?.ok){
    showError(r.data?.message || 'This ticket could not be verified.');
    return;
  }

  const t = r.data.ticket;
  setStatus('valid', '✓ VALID TICKET');

  $('ticketContent').innerHTML = `
    <div class="ticket-event">
      <div class="ticket-event-info">
        <small>EVENT TICKET</small>
        <h1>${esc(t.event_name)}</h1>
        <p>${esc(t.event_type || 'Event')}</p>
      </div>
      ${t.poster_url ? `<img src="${esc(t.poster_url)}" alt="${esc(t.event_name)} poster">` : ''}
    </div>

    <div class="ticket-details">
      <div><span>DATE</span><b>${esc(formatDate(t.event_date))}</b></div>
      <div><span>VENUE</span><b>${esc(t.venue)}</b></div>
      <div><span>TICKETS</span><b>${esc(t.quantity)}</b></div>
      <div><span>AMOUNT PAID</span><b>${esc(money(t.amount))}</b></div>
      <div><span>M-PESA RECEIPT</span><b>${esc(t.mpesa_receipt || 'Confirmed')}</b></div>
      <div><span>PAYMENT DATE</span><b>${esc(new Date(t.paid_at || t.created_at).toLocaleString('en-KE'))}</b></div>
    </div>

    <div class="ticket-code-row">
      <div>
        <small>UNIQUE TICKET CODE</small>
        <strong>${esc(t.ticket_code)}</strong>
      </div>
      <div id="qrcode" class="qrcode" aria-label="Ticket QR code"></div>
    </div>

    <div class="ticket-actions">
      <button class="btn" onclick="window.print()">PRINT / SAVE TICKET</button>
      <a class="btn ghost" href="index.html#events">BACK TO EVENTS</a>
    </div>
  `;

  const verifyUrl = `${location.origin}${location.pathname}?code=${encodeURIComponent(t.ticket_code)}`;
  new QRCode($('qrcode'), {
    text: verifyUrl,
    width: 150,
    height: 150,
    colorDark: '#07101b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

loadTicket();
