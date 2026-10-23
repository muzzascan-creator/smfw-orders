# Coolibah Orders

A web app (csorders.org) where SMFW's customers sign in and place their own orders, and SMFW staff run everything from a dashboard.

- **Customers** create an account, wait for SMFW to link it to their business, then fill in an order form laid out like the supplier forms. They can save drafts and send orders, up to each delivery day's cut-off. They only see their own orders, and never see supplier names. A customer orders Organic, Conventional or Both (one location per order). They can save an order as a favourite and start a new order from it later.
- **Admins** get an Inbox of orders customers have sent, can enter orders for any customer, email suppliers, make upload CSVs, and manage customers (CID), products (each pack type has its own SID, outer multiple and availability) and suppliers. Under **Administration** they manage supplier Emails, Logins, SMS settings and order Cut-offs.
- **Managers** have the Admin dashboard without Suppliers and Administration.
- **Receivers** see every order read-only and tick off deliveries; customers are emailed about anything short. On Conventional orders for No customer, pack types ticked **Batch Code** in Products need a batch code when received; SMFW sees them on the Batch Code tab (needs migration 030). Conventional orders sent from customer logins skip the Inbox, go to the Received tab (needs migration 032). An admin ticks Upload and presses **Create upload CSV** there, which saves the file in the Condition 2 folder (Settings); the order then moves to Complete. With the **Auto CSV** switch On (Orders tab, Admin only, shared by all staff), any Admin or Manager PC with the app open and the Condition 2 folder connected saves these CSVs straight away.
- **Scale:** staff screens load unfinished orders plus the last 2 weeks (customers: their last 2 months), then only what changed. Older orders are found with **Search older orders** on the Orders tab or **Show older orders** on My orders. Migration 033 adds the indexes for this.
- **Import purchase order** (Inbox): a buyer's PDF listing several stores side by side becomes one order per store. Conventional orders go straight to the Received tab (CSV created there by hand into the Condition 2 folder); Organic ones to the Inbox. Store columns and product descriptions are matched once and remembered (migration 034).

It is a plain web page (`index.html`, `app.js`, `styles.css`) with no build step. Logins and data live in [Supabase](https://supabase.com); the access rules in `supabase/schema.sql` and `supabase/migrations/` keep each customer's data private.

## Setting it up

1. **Create the database.** In Supabase, create a new project. Open **SQL Editor**, paste in all of `supabase/schema.sql` and press **Run**. Then run each file in `supabase/migrations/` from `020` onward, in number order. Then run the `seed.sql` file Claude gave you, which loads the starting suppliers, customers and products. It is kept out of this repo because the repo is public.
2. **Connect the site to it.** In Supabase go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`.
3. **Set up the email and text service.** In Supabase go to **Edge Functions**, create a function called `quick-api` with **Verify JWT** turned off, and paste in `supabase/functions/notify-undelivered/index.ts`. Under **Edge Functions → Secrets** add `RESEND_API_KEY` (from resend.com); `FROM_EMAIL` and `REPLY_TO` are optional. SMS Broadcast details are entered in the app under **Administration › SMS**.
4. **Publish the site.** In this GitHub repo go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
5. **Tell Supabase the address.** In Supabase go to **Authentication → URL Configuration** and set **Site URL** to the site's address. This makes the links in confirmation and password-reset emails open the site.
6. **Sign up first.** Open the site and create your own account before anyone else does. The first account on a new system becomes the Admin automatically.

To check an existing system, run `supabase/checks/check_setup_step1.sql` and then `check_setup_step2.sql` in the SQL Editor.

## Adding a customer login

The customer opens the site and creates an account, giving their mobile number, and SMFW gets a text. It appears under **Administration › Logins** marked *Waiting*. Press **Approve**, choose which customer(s) it orders for, and save. The customer gets a text saying their login is active. Several logins can share one customer. Each login can be signed in on one device at a time.

To give another staff member access, approve their login with the role **Admin**, **Manager** or **Receiver**.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page shell. Bump the `?v=` on `app.js` and `styles.css` with each change so browsers fetch the new files |
| `app.js` | Everything the app does |
| `styles.css` | Look and layout, light and dark |
| `config.js` | Which Supabase project to use |
| `supabase/schema.sql` | Tables, logins and access rules (up to 019) |
| `supabase/migrations/` | Changes to run on the database, in number order |
| `supabase/functions/notify-undelivered/` | The `quick-api` function: customer, supplier and reminder emails, and texts |
| `supabase/checks/` | One-off checks and repairs to run in the SQL Editor |
