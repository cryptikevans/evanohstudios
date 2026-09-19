const C = window.SELEKTA_CONFIG,
  S = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY),
  $ = id => document.getElementById(id),
  safe = n => n.toLowerCase().replace(/[^a-z0-9._-]/g, '-');

let editingMixId = null,
  editingEventId = null;

let currentTicketCode = null;
let qrScanner = null;


/* =========================================================
   ADMIN LOGIN
   ========================================================= */

async function start() {
  let u = (await S.auth.getUser()).data.user;

  if (!u) {
    $('login').hidden = false;
    return;
  }

  let a = await S
    .from('admin_users')
    .select('user_id')
    .eq('user_id', u.id)
    .maybeSingle();

  if (!a.data) {
    await S.auth.signOut();
    $('loginMsg').textContent = 'Not authorized.';
    return;
  }

  $('login').hidden = true;
  $('dash').hidden = false;

  refresh();
}

$('loginForm').onsubmit = async e => {
  e.preventDefault();

  let r = await S.auth.signInWithPassword({
    email: $('email').value,
    password: $('password').value
  });

  if (r.error) {
    $('loginMsg').textContent = r.error.message;
  } else {
    start();
  }
};

$('logout').onclick = async () => {
  await S.auth.signOut();
  location.reload();
};


/* =========================================================
   STORAGE UPLOAD
   ========================================================= */

async function upload(bucket, file, user, id) {
  let path = `${user.id}/${id}-${safe(file.name)}`;

  let r = await S.storage
    .from(bucket)
    .upload(path, file, {
      upsert: false
    });

  if (r.error) throw r.error;

  return path;
}


/* =========================================================
   RESET FORMS
   ========================================================= */

function resetMixForm() {
  editingMixId = null;

  $('mixForm').reset();

  $('mf').setAttribute('required', '');

  $('mixForm')
    .querySelector('button')
    .textContent = 'Publish Mix';

  $('mixCancel')?.remove();
}


function resetEventForm() {
  editingEventId = null;

  $('eventForm').reset();

  $('ef').setAttribute('required', '');

  $('eventForm')
    .querySelector('button')
    .textContent = 'Publish Event';

  $('eventCancel')?.remove();
}


/* =========================================================
   EDIT MIX
   ========================================================= */

window.editMix = async id => {

  let x = (
    await S
      .from('mixes')
      .select('*')
      .eq('id', id)
      .single()
  ).data;

  if (!x) return;

  editingMixId = id;

  $('mt').value = x.title || '';
  $('md').value = x.description || '';

  $('mf').removeAttribute('required');

  let btn = $('mixForm').querySelector('button');

  btn.textContent = 'Update Mix';

  if (!$('mixCancel')) {

    let c = document.createElement('button');

    c.type = 'button';
    c.id = 'mixCancel';
    c.className = 'btn ghost';
    c.textContent = 'Cancel edit';

    c.onclick = resetMixForm;

    btn.after(c);
  }

  $('mixForm').scrollIntoView({
    behavior: 'smooth'
  });
};


/* =========================================================
   EDIT EVENT
   ========================================================= */

window.editEvent = async id => {

  let x = (
    await S
      .from('events')
      .select('*')
      .eq('id', id)
      .single()
  ).data;

  if (!x) return;

  editingEventId = id;

  $('en').value = x.name || '';
  $('et').value = x.event_type || '';
  $('ed').value = x.event_date || '';
  $('ev').value = x.venue || '';
  $('ep').value = x.ticket_price ?? '';
  $('ex').value = x.description || '';

  $('ef').removeAttribute('required');

  let btn = $('eventForm').querySelector('button');

  btn.textContent = 'Update Event';

  if (!$('eventCancel')) {

    let c = document.createElement('button');

    c.type = 'button';
    c.id = 'eventCancel';
    c.className = 'btn ghost';
    c.textContent = 'Cancel edit';

    c.onclick = resetEventForm;

    btn.after(c);
  }

  $('eventForm').scrollIntoView({
    behavior: 'smooth'
  });
};


/* =========================================================
   MIX FORM
   ========================================================= */

$('mixForm').onsubmit = async e => {

  e.preventDefault();

  $('mixMsg').textContent =
    editingMixId ? 'Updating…' : 'Uploading…';

  try {

    let u = (await S.auth.getUser()).data.user;

    let id =
      editingMixId ||
      crypto.randomUUID();

    let patch = {
      title: $('mt').value,
      description: $('md').value
    };

    if ($('mf').files[0]) {

      patch.audio_path =
        await upload(
          'mixes',
          $('mf').files[0],
          u,
          id
        );
    }

    if ($('mc').files[0]) {

      patch.cover_path =
        await upload(
          'covers',
          $('mc').files[0],
          u,
          id
        );
    }

    let r = editingMixId
      ? await S
          .from('mixes')
          .update(patch)
          .eq('id', id)

      : await S
          .from('mixes')
          .insert({
            ...patch,
            cover_path:
              patch.cover_path || null
          });

    if (r.error) throw r.error;

    $('mixMsg').textContent =
      editingMixId
        ? 'Updated.'
        : 'Published.';

    resetMixForm();

    refresh();

  } catch (x) {

    $('mixMsg').textContent =
      x.message;
  }
};


/* =========================================================
   EVENT FORM
   ========================================================= */

$('eventForm').onsubmit = async e => {

  e.preventDefault();

  $('eventMsg').textContent =
    editingEventId ? 'Updating…' : 'Uploading…';

  try {

    let u = (await S.auth.getUser()).data.user;

    let id =
      editingEventId ||
      crypto.randomUUID();

    let patch = {
      name: $('en').value,
      event_type: $('et').value,
      event_date: $('ed').value,
      venue: $('ev').value,
      ticket_price: Number($('ep').value),
      description: $('ex').value
    };

    if ($('ef').files[0]) {

      patch.poster_path =
        await upload(
          'event-posters',
          $('ef').files[0],
          u,
          id
        );
    }

    let r = editingEventId

      ? await S
          .from('events')
          .update(patch)
          .eq('id', id)

      : await S
          .from('events')
          .insert(patch);

    if (r.error) throw r.error;

    $('eventMsg').textContent =
      editingEventId
        ? 'Updated.'
        : 'Published.';

    resetEventForm();

    refresh();

  } catch (x) {

    $('eventMsg').textContent =
      x.message;
  }
};


/* =========================================================
   REFRESH PUBLISHED CONTENT
   ========================================================= */

async function refresh() {

  let m = await S
    .from('mixes')
    .select('id,title,created_at')
    .order('created_at', {
      ascending: false
    });

  let e = await S
    .from('events')
    .select('id,name,event_date,venue')
    .order('event_date', {
      ascending: false
    });

  $('list').innerHTML =

    '<h3>Mixes</h3>' +

    (
      (m.data || [])
        .map(x => `
          <p>
            ${x.title}

            <button
              class="btn ghost"
              onclick="editMix('${x.id}')"
            >
              Edit
            </button>

            <button
              class="danger"
              onclick="delMix('${x.id}')"
            >
              Delete
            </button>
          </p>
        `)
        .join('')

      || '<p>None</p>'
    )

    +

    '<h3>Events</h3>' +

    (
      (e.data || [])
        .map(x => `
          <p>
            ${x.name} — ${x.venue}

            <button
              class="btn ghost"
              onclick="editEvent('${x.id}')"
            >
              Edit
            </button>

            <button
              class="danger"
              onclick="delEvent('${x.id}')"
            >
              Delete
            </button>
          </p>
        `)
        .join('')

      || '<p>None</p>'
    );
}


/* =========================================================
   DELETE MIX
   ========================================================= */

window.delMix = async id => {

  if (!confirm('Delete mix?')) return;

  let x = (
    await S
      .from('mixes')
      .select('audio_path,cover_path')
      .eq('id', id)
      .single()
  ).data;

  if (x?.audio_path) {

    await S.storage
      .from('mixes')
      .remove([x.audio_path]);
  }

  if (x?.cover_path) {

    await S.storage
      .from('covers')
      .remove([x.cover_path]);
  }

  await S
    .from('mixes')
    .delete()
    .eq('id', id);

  refresh();
};


/* =========================================================
   DELETE EVENT
   ========================================================= */

window.delEvent = async id => {
  if (!confirm('Delete event?')) return;

  try {
    const x = (
      await S
        .from('events')
        .select('poster_path')
        .eq('id', id)
        .single()
    ).data;

    if (x?.poster_path) {
      const storageResult = await S.storage
        .from('event-posters')
        .remove([x.poster_path]);

      if (storageResult.error) {
        console.error(
          'POSTER DELETE ERROR:',
          storageResult.error
        );
      }
    }

    const result = await S
      .from('events')
      .delete()
      .eq('id', id);

    console.log('EVENT DELETE RESULT:', result);

    if (result.error) {
      alert(
        'Could not delete event:\n\n' +
        result.error.message
      );

      console.error(
        'EVENT DELETE ERROR:',
        result.error
      );

      return;
    }

    alert('Event deleted successfully.');

    refresh();

  } catch (error) {
    console.error(
      'DELETE EVENT ERROR:',
      error
    );

    alert(
      'Delete failed:\n\n' +
      (error.message || error)
    );
  }
};


/* =========================================================
   TICKET CHECK-IN
   ========================================================= */

function ticketMessage(text, type = '') {

  const el = $('ticketCheckMessage');

  if (!el) return;

  el.textContent = text;

  el.className =
    'ticket-check-message ' + type;
}


/* =========================================================
   CLEAR TICKET RESULT
   ========================================================= */

function clearTicketResult() {

  const result =
    $('ticketCheckResult');

  if (result) {
    result.style.display = 'none';
  }

  currentTicketCode = null;

  if ($('confirmCheckin')) {
    $('confirmCheckin').style.display = 'none';
  }
}


/* =========================================================
   FORMAT DATE
   ========================================================= */

function formatTicketDate(value) {

  if (!value) return '—';

  return new Date(
    value + 'T00:00:00'
  ).toLocaleDateString(
    'en-KE',
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }
  );
}


/* =========================================================
   FORMAT MONEY
   ========================================================= */

function formatTicketMoney(value) {

  return 'KSh ' +
    Number(value || 0)
      .toLocaleString('en-KE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
}


/* =========================================================
   SHOW TICKET
   ========================================================= */

function showTicket(ticket, status) {

  const result =
    $('ticketCheckResult');

  if (!result) return;

  result.style.display = 'block';

  $('checkEventName').textContent =
    ticket.event_name ||
    'Event Ticket';

  $('checkEventDate').textContent =
    formatTicketDate(
      ticket.event_date
    );

  $('checkEventVenue').textContent =
    ticket.venue || '—';

  $('checkQuantity').textContent =
    ticket.quantity || '—';

  $('checkAmount').textContent =
    formatTicketMoney(
      ticket.amount
    );

  $('checkReceipt').textContent =
    ticket.mpesa_receipt ||
    'Confirmed';

  $('checkTicketCode').textContent =
    ticket.ticket_code ||
    '—';

  const statusEl =
    $('ticketCheckStatus');

  if (status === 'valid') {

    statusEl.textContent =
      '✓ VALID TICKET';

    statusEl.style.padding = '12px';
    statusEl.style.fontWeight = '700';

    const btn =
      $('confirmCheckin');

    btn.style.display = 'block';
    btn.disabled = false;
    btn.textContent =
      '✓ CHECK IN GUEST';

    currentTicketCode =
      ticket.ticket_code;

    ticketMessage(
      'Ticket is valid and ready for check-in.',
      'success'
    );

  } else if (
    status === 'already_checked_in'
  ) {

    statusEl.textContent =
      '⚠ ALREADY CHECKED IN';

    statusEl.style.padding = '12px';
    statusEl.style.fontWeight = '700';

    const btn =
      $('confirmCheckin');

    btn.style.display = 'none';

    currentTicketCode =
      ticket.ticket_code;

    const checkedAt =
      ticket.checked_in_at
        ? new Date(
            ticket.checked_in_at
          ).toLocaleString('en-KE')
        : 'previously';

    ticketMessage(
      `This ticket was already checked in at ${checkedAt}.`,
      'error'
    );
  }
}


/* =========================================================
   CHECK TICKET WITH SUPABASE FUNCTION
   ========================================================= */

async function checkTicket(code) {

  code = String(code || '')
    .trim()
    .toUpperCase();

  if (!code) {

    ticketMessage(
      'Please enter a ticket code.',
      'error'
    );

    return;
  }

  clearTicketResult();

  ticketMessage(
    'Checking ticket...',
    'loading'
  );

  try {

    const response =
      await fetch(
        `${C.SUPABASE_URL}/functions/v1/ticket-checkin`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${C.SUPABASE_PUBLISHABLE_KEY}`
          },

          body: JSON.stringify({
            ticket_code: code
          })
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    console.log(
      'TICKET CHECK RESPONSE:',
      data
    );

    if (!response.ok) {

      if (
        data.status ===
        'already_checked_in'
      ) {

        ticketMessage(
          data.message ||
          'This ticket has already been checked in.',
          'error'
        );

        return;
      }

      throw new Error(
        data.message ||
        'Ticket could not be verified.'
      );
    }

    if (data.status === 'valid') {

      showTicket(
        data.ticket,
        'valid'
      );

      return;
    }

    if (
      data.status ===
      'already_checked_in'
    ) {

      showTicket(
        data.ticket,
        'already_checked_in'
      );

      return;
    }

    throw new Error(
      data.message ||
      'Ticket could not be verified.'
    );

  } catch (error) {

    console.error(
      'Ticket check error:',
      error
    );

    clearTicketResult();

    ticketMessage(
      error.message ||
      'Unable to check ticket.',
      'error'
    );
  }
}


/* =========================================================
   MANUAL TICKET CHECK FORM
   ========================================================= */

if ($('ticketCheckForm')) {

  $('ticketCheckForm').onsubmit =
    async e => {

      e.preventDefault();

      const code =
        $('ticketCheckCode')
          .value
          .trim()
          .toUpperCase();

      await checkTicket(code);
    };
}


/* =========================================================
   CHECK IN GUEST
   ========================================================= */

if ($('confirmCheckin')) {

  $('confirmCheckin').onclick =
    async () => {

      if (!currentTicketCode) {

        ticketMessage(
          'No ticket selected.',
          'error'
        );

        return;
      }

      const button =
        $('confirmCheckin');

      button.disabled = true;
      button.textContent =
        'CHECKING IN...';

      ticketMessage(
        'Checking guest in...',
        'loading'
      );

      try {

        const response =
          await fetch(
            `${C.SUPABASE_URL}/functions/v1/ticket-checkin`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                Authorization:
                  `Bearer ${C.SUPABASE_PUBLISHABLE_KEY}`
              },

              body: JSON.stringify({
                ticket_code:
                  currentTicketCode,

                action:
                  'checkin'
              })
            }
          );

        const data =
          await response
            .json()
            .catch(() => ({}));

        console.log(
          'CHECK-IN RESPONSE:',
          data
        );

        if (!response.ok) {

          throw new Error(
            data.message ||
            'Could not check in guest.'
          );
        }

        if (
          data.status ===
          'checked_in'
        ) {

          const statusEl =
            $('ticketCheckStatus');

          statusEl.textContent =
            '✓ GUEST CHECKED IN';

          statusEl.style.padding =
            '12px';

          statusEl.style.fontWeight =
            '700';

          button.style.display =
            'none';

          ticketMessage(
            `Guest successfully checked in at ${new Date().toLocaleTimeString('en-KE')}.`,
            'success'
          );

          return;
        }

        if (
          data.status ===
          'already_checked_in'
        ) {

          button.style.display =
            'none';

          ticketMessage(
            data.message ||
            'This ticket has already been checked in.',
            'error'
          );

          return;
        }

        throw new Error(
          data.message ||
          'Check-in failed.'
        );

      } catch (error) {

        console.error(
          'Check-in error:',
          error
        );

        ticketMessage(
          error.message ||
          'Unable to check in guest.',
          'error'
        );

        button.disabled = false;
        button.textContent =
          '✓ CHECK IN GUEST';
      }
    };
}


/* =========================================================
   QR CODE SCANNER
   ========================================================= */

if ($('startScanner')) {

  $('startScanner').onclick =
    async () => {

      const reader =
        $('qrReader');

      const stop =
        $('stopScanner');

      if (!reader) return;

      reader.style.display =
        'block';

      stop.style.display =
        'block';

      $('startScanner').disabled =
        true;

      ticketMessage(
        'Opening camera...',
        'loading'
      );

      try {

        qrScanner =
          new Html5Qrcode(
            'qrReader'
          );

        await qrScanner.start(

          {
            facingMode: 'environment'
          },

          {
            fps: 10,

            qrbox: {
              width: 250,
              height: 250
            }
          },

          async decodedText => {

            console.log(
              'QR SCANNED:',
              decodedText
            );

            let code = '';

            try {

              const url =
                new URL(decodedText);

              code =
                url.searchParams
                  .get('code') || '';

            } catch {

              code =
                decodedText
                  .trim()
                  .toUpperCase();
            }

            if (!code) {

              ticketMessage(
                'QR code does not contain a valid ticket.',
                'error'
              );

              return;
            }

            await stopQrScanner();

            $('ticketCheckCode').value =
              code;

            await checkTicket(code);
          },

          errorMessage => {
            // Scanner continuously reports
            // frames where no QR is detected.
            // We intentionally don't display
            // those messages.
          }
        );

        ticketMessage(
          'Point the camera at the ticket QR code.',
          'loading'
        );

      } catch (error) {

        console.error(
          'QR scanner error:',
          error
        );

        reader.style.display =
          'none';

        stop.style.display =
          'none';

        $('startScanner').disabled =
          false;

        ticketMessage(
          'Could not open the camera. Check your browser camera permission.',
          'error'
        );
      }
    };
}


/* =========================================================
   STOP QR SCANNER
   ========================================================= */

async function stopQrScanner() {

  if (!qrScanner) return;

  try {

    await qrScanner.stop();

  } catch (error) {

    console.log(
      'Scanner stop:',
      error
    );
  }

  try {

    await qrScanner.clear();

  } catch (error) {

    console.log(
      'Scanner clear:',
      error
    );
  }

  qrScanner = null;

  if ($('qrReader')) {
    $('qrReader').style.display =
      'none';
  }

  if ($('stopScanner')) {
    $('stopScanner').style.display =
      'none';
  }

  if ($('startScanner')) {
    $('startScanner').disabled =
      false;
  }
}


if ($('stopScanner')) {

  $('stopScanner').onclick =
    async () => {

      await stopQrScanner();

      ticketMessage(
        'Scanner stopped.',
        ''
      );
    };
}


/* =========================================================
   START ADMIN
   ========================================================= */

start();
