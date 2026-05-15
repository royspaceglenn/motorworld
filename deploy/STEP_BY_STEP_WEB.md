# Step-by-step: Motor World on the web + your domain

Follow these steps **in order**. This path uses **Render** for the API (SQLite, always-on Node) and **Vercel** for the website. You avoid Neon, serverless cold starts, and confusing split secrets—there is **one app password secret** and **one browser-origins list**.

---

## Part A — GitHub (code)

1. Create a **new empty** repository on GitHub (no README if you will push this project).
2. On your computer, in the Motor World project folder:

```bash
git remote remove origin
git remote add origin https://github.com/YOUR_USER/YOUR_NEW_REPO.git
git branch -M main
git push -u origin main
```

---

## Part B — Render (API + database file)

1. Go to [render.com](https://render.com) and sign in.
2. **New → Blueprint** → connect the same GitHub repo. Render reads **`render.yaml`** from the repo root.
3. After the first deploy opens, go to the **Web Service → Environment** and add:

| Name | What to paste |
|------|----------------|
| `MOTOR_WORLD_APP_SECRET` | Any **random string at least 32 characters** (example: run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` once on your PC and paste the output). |
| `MOTOR_WORLD_ORIGINS` | For now put `https://placeholder.example` — you will **replace** this in Part D with your real Vercel + domain URLs. |

4. Click **Save** and let the service redeploy.
5. Copy the public URL of the API, e.g. `https://motorworld-api-xxxx.onrender.com` — you need it in Part C.

**Optional (real shop data that survives restarts):** in Render, add a **Disk**, mount it at `/data`, set `SQLITE_DB_PATH=/data/motorworld.sqlite`, redeploy. Without a disk, SQLite still works for testing but data may reset when Render restarts the free instance.

---

## Part C — Vercel (website only)

1. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import the **same** GitHub repo.
2. **Root directory:** leave as repo root (where the main `package.json` is).
3. Replace the project’s **`vercel.json`** with the contents of **`config/vercel.frontend-only.example.json`** from this repo (copy/paste the whole file so Vercel **does not** try to host `/api` itself—the API lives on Render).

4. In **Vercel → Settings → Environment Variables**, add for **Production** (not Preview only—Vite reads Production for your main site):

| Name | Value |
|------|--------|
| `VITE_API_BASE_URL` | Your Render API URL, e.g. `https://motorworld-api-xxxx.onrender.com` (no trailing slash) |

   Optional but recommended so the app always talks to your API: set **`VITE_DATA_BACKEND=rest`** (or leave unset; default is REST). If **`VITE_DATA_BACKEND=firebase`** and all Firebase web keys are present, login goes through **Firebase**, not your Render API.

5. Trigger a **new deployment** (Redeploy). When it finishes, open the `.vercel.app` URL and try logging in.

**First login (SQLite on Render, default seed user):**

- Email: `admin@motorworldcorp.com`  
- Password: `maoningpassword`  

Then use **Change password** inside the app.

---

## Part D — Point Render at your real Vercel URL (CORS)

1. Copy your production site URL from Vercel, e.g. `https://something.vercel.app`.
2. In **Render → your API → Environment**, set **`MOTOR_WORLD_ORIGINS`** to that URL exactly (include `https://`, no trailing slash). If you use Preview deployments too, add more URLs separated by commas.
3. Save and redeploy the API.

Until this matches the browser address **exactly**, the browser will block login with a CORS error.

---

## Part E — Your purchased domain

1. In **Vercel → your project → Settings → Domains**, click **Add** and enter your domain (e.g. `motorworld.com` and `www.motorworld.com`).
2. Vercel will show **DNS records** (usually `A` or `CNAME`). Log in to your **domain registrar** (where you bought the domain) and create those records exactly as Vercel shows.
3. Wait until Vercel shows the domain as **Valid** (can take a few minutes to a few hours).
4. Go back to **Render → Environment** and update **`MOTOR_WORLD_ORIGINS`** to include **every** URL people use in the browser, for example:

`https://motorworld.com,https://www.motorworld.com,https://something.vercel.app`

5. Redeploy the API on Render.

**HTTPS:** Vercel issues SSL for your domain automatically. You do not buy a separate SSL certificate for the site.

---

## Part F — Checklist if something fails

| Symptom | Fix |
|---------|-----|
| Login never finishes | Confirm `VITE_API_BASE_URL` on Vercel matches the Render URL and you redeployed **after** setting it. |
| Red error: “non-JSON” or “Cannot reach” or 404 | Usually **missing or wrong `VITE_API_BASE_URL`**: Vite bakes it in at **build** time—set the var under **Production**, then **Redeploy** (not only “rebuild” from an old deployment). |
| Amber box: “API URL is not set” (after next deploy) | Same: add `VITE_API_BASE_URL` on Vercel Production and redeploy. |
| Browser says CORS | `MOTOR_WORLD_ORIGINS` must list the **exact** origin shown in the address bar (scheme + host, optional port). Include both `https://www…` and `https://…` if you use both. |
| “Invalid credentials” on a **new** Render API | Use seeded admin: `admin@motorworldcorp.com` / `maoningpassword`, then change password. |
| 404 on `/api` on Vercel | You are still using the old `vercel.json` with API routes—switch to **`config/vercel.frontend-only.example.json`**. |
| Render sleeps (free tier) | First request after idle can be slow; upgrade plan or use a cron ping to `/api/health`. |
| Firebase login instead of your API | If `VITE_DATA_BACKEND=firebase` and all Firebase web vars are set, the app uses **Firebase Auth**, not Render. For this guide, use **`VITE_DATA_BACKEND=rest`** (or unset). |

---

## Names you actually type in dashboards

| Where | Variable |
|-------|----------|
| Render (API) | `MOTOR_WORLD_APP_SECRET`, `MOTOR_WORLD_ORIGINS`, optional `SQLITE_DB_PATH` |
| Vercel (site build) | `VITE_API_BASE_URL` |

Older docs may say `JWT_SECRET` or `CORS_ORIGINS` — those still work as **aliases**, but you do **not** need to use those names anymore.

---

## Emergency (database completely broken)

See **`server/README.md`** section *Emergency access* — only for temporary access with no saved data.
