# SMFW Orders

A web app where SMFW's customers sign in and place their own orders, and SMFW staff manage everything from an admin dashboard.

- **Customers** create an account, wait for SMFW to link it to their business, then fill in an order form laid out like the supplier forms. They can save drafts and send orders. They only ever see their own orders, and never see supplier names.
- **Admins** get an Inbox of orders customers have sent, can enter orders for any customer, and manage customers (CID), products (each pack type has its own SID, outer multiple and availability), suppliers and logins.

It is a plain web page (`index.html`, `app.js`, `styles.css`) with no build step. Logins and data live in [Supabase](https://supabase.com); the access rules in `supabase/schema.sql` keep each customer's data private.

## Setting it up

1. **Create the database.** In Supabase, create a new project. Open **SQL Editor**, paste in all of `supabase/schema.sql` and press **Run**. Then do the same with the `seed.sql` file Claude gave you, which loads the starting suppliers, customers and products. It is kept out of this repo because the repo is public.
2. **Connect the site to it.** In Supabase go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`.
3. **Publish the site.** In this GitHub repo go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. GitHub shows the site's address after a minute or two.
4. **Tell Supabase the address.** In Supabase go to **Authentication → URL Configuration** and set **Site URL** to the GitHub Pages address. This makes the links in confirmation and password-reset emails open the site.
5. **Sign up first.** Open the site and create your own account before anyone else does. The first account becomes the admin automatically.

## Adding a customer login

The customer opens the site and creates an account. It appears under **Logins** marked *Waiting*. Press **Approve**, choose which customer it orders for, and save. Several logins can share one customer.

To give another staff member full access, approve their login with the role **Admin**.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page shell |
| `app.js` | Everything the app does |
| `styles.css` | Look and layout, light and dark |
| `config.js` | Which Supabase project to use |
| `supabase/schema.sql` | Tables, logins and access rules |
| `supabase/migrations/` | Changes to run on an existing database, in number order |
