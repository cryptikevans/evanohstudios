# SELEKTA EVANOH — GitHub + Supabase

This version removes the need to edit HTML whenever you add a mix or event.

## Architecture
GitHub Pages hosts `index.html` and `admin.html`. Supabase provides Auth, Postgres, Storage and Edge Functions. Safaricom Daraja is called from the Edge Function, not from the browser.

## Setup
1. Create a Supabase project.
2. Run `supabase/schema.sql` in SQL Editor.
3. In Authentication > Users create your admin email/password account.
4. Insert its UUID: `insert into public.admin_users(user_id) values ('YOUR-USER-UUID');`
5. Copy `config.example.js` to `config.js` and add your Supabase URL + publishable key.
6. Upload frontend files to GitHub and enable GitHub Pages.
7. Deploy the two Edge Functions.
8. Add M-Pesa secrets in Supabase, never in GitHub.

## M-Pesa secrets
Set: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_ENV` (`sandbox` or `production`), `MPESA_TRANSACTION_TYPE`, and `MPESA_CALLBACK_URL`.

Callback URL: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/mpesa-callback`

## Admin workflow
Login at `/admin.html` → upload mix → publish. Or upload event poster + name + About Event + date + venue + ticket price → publish. The public site reads the database and updates automatically.

## Payment workflow
Visitor opens event → chooses ticket quantity → enters M-Pesa number → STK Push → callback → verification query → payment marked paid → ticket code created.

Do not commit M-Pesa secrets or a Supabase service-role/secret key to GitHub.

### Payment status
The frontend uses the `payment-status` Edge Function to poll the private payment record. Payment rows are not exposed publicly through RLS.
