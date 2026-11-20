# ASSENT Fasteners Store Visual WMS: Cloud Edition (mockup round)

The same app as before, but data is saved in the cloud so every tester sees the same stock, and the AI document scan works outside claude.ai.

| Part | Service | What it does |
| --- | --- | --- |
| Website | GitHub Pages (free) | Serves `index.html`, `app.jsx`, `cloud.js`, `config.js` |
| Data + sign-in + files | Supabase (free tier) | Database table `kv_store`, user accounts, private bucket `scans` for the original PDFs |
| AI scan | Supabase Edge Function `scan` + your Claude API key | Reads each page of a delivery note / packing list / MTC |

No build step: the files are used as they are.

## Files

```
index.html                         page shell, sign-in screen, status bar
app.jsx                            the whole WMS app (React)
cloud.js                           cloud layer: save/load, file storage, AI call
config.js                          YOUR Supabase URL and key (edit this)
logo.jpg                           Assent logo
supabase/schema.sql                database tables, rules and file bucket
supabase/functions/scan/index.ts   AI scan function
supabase/config.toml               function setting
.github/workflows/pages.yml        publishes the site on every push
```

## Setup (about 30 minutes)

### 1. Supabase project
1. Go to supabase.com, sign in, **New project**. Choose a region near you (for example Middle East or Frankfurt). Save the database password.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, click **Run**.
3. Open **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up" (so only people you add can enter).
4. Open **Authentication > Users > Add user**, create one account per tester (email + password, tick "Auto Confirm User").

### 2. AI scan function
1. Get a Claude API key at console.anthropic.com (**API keys**). Scanning costs a small amount per page; set a monthly spend limit there.
2. Install the Supabase CLI (supabase.com/docs/guides/cli), then in this folder run:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy scan --no-verify-jwt
   ```
   `YOUR_PROJECT_REF` is the part of your project URL before `.supabase.co`.
   Without the CLI: **Edge Functions > Deploy a new function**, name it `scan`, paste `supabase/functions/scan/index.ts`, turn off "Verify JWT", then add the secret under **Edge Functions > Secrets**.
3. Optional: set `ANTHROPIC_MODEL` as a secret to choose another Claude model. The default is `claude-sonnet-5-5`.

### 3. Fill in `config.js`
In Supabase open **Project Settings > API**. Copy the **Project URL** and the **anon / publishable key** into `config.js`. Never use the `service_role` key here.

### 4. GitHub
1. On github.com create a new repository (private is fine) and upload all files of this folder, keeping the folder structure. Include the hidden `.github` folder.
2. In the repository open **Settings > Pages > Build and deployment > Source** and choose **GitHub Actions**.
3. Open the **Actions** tab, wait for "Deploy to GitHub Pages" to finish (green). The site address is shown there, normally `https://YOUR-NAME.github.io/REPO-NAME/`.
4. Private repositories need a GitHub plan that allows Pages. If not, make the repository public. This is safe: the data stays behind sign-in, and the anon key is meant to be public.

### 5. Trial
Open the site, sign in, and run this check:
1. The first sign-in shows the demo stock. Move a pallet, then reload: it stays.
2. Open the site on another device or browser, sign in with a second account: the same data appears.
3. Stock In: upload a supplier PDF, review, approve, place. Open the original page from the review screen.
4. Extract the weekly report, export the DRR, export the CSV.
5. Change something in one browser; the other shows "Another user changed the data. Refresh".

## How data is saved
- Four collections (inventory, transactions, receipts, delivery notes) are stored as one JSON row each in `kv_store`, about 0.7 seconds after each change.
- Every row has a version number. If two people save from old data, the second save is refused and a red banner asks for a reload. Nothing is silently overwritten, but the refused change is lost, so testers should refresh when they see the amber banner.
- Original scanned PDFs go to the private `scans` bucket.
- The grey bar at the bottom left shows saving status, the signed-in user and Sign out.
- **Reset Factory Data** (Storage & Reliability screen) resets the shared data for everyone.

## Known limits of this mockup edition
- One shared workspace, no roles: any signed-in user can change or reset everything.
- Last-save protection is per collection, not per pallet. For heavy simultaneous use, move to one table row per pallet in the next phase.
- Transaction times are placeholders, relocations count as inbound in the weekly report, and inbound weight is estimated (pieces x 0.3 kg). See the specification document.
- It was tested with a simulated Supabase and a build check. It has not been run against your live project, so report anything unexpected from the first trial.

## Changing the app
Edit `app.jsx`, commit, and the site updates in about a minute. Browsers may cache for a short time: use a hard refresh.
