# Auto-deploy to the DigitalOcean droplet

Every push to `main` runs **Check & deploy** (`.github/workflows/deploy.yml`):

1. **Check:** install, syntax-check every file, start the server and hit `/readyz`, `/api/menu`, `/kitchen`.
2. **Deploy** (only if checks pass): SSH into the droplet as the `deploy` user and run `deploy/deploy.sh`. It checks out the new commit, installs, restarts the service and waits for `/readyz`. **If the new version isn't healthy within 30 s, it rolls back to the previous version automatically.**

Deploys stay **off** until you finish the steps below and set `DEPLOY_ENABLED=true`. Until then, pushes only run the checks.

Server layout:

```
/opt/pos/app     ← git checkout (deploys replace this; never edit by hand)
/opt/pos/data    ← orders + dish photos (survives every deploy)
/opt/pos/.env    ← production settings and secrets (never in git)
```

---

## Step 1 — Prepare the server (once, as root)

SSH into the droplet: `ssh root@206.189.152.139`

**1a. Check what's already running.** The droplet already hosts other things, so pick a free port (this guide uses **3100**) and check memory:

```bash
ss -ltnp | grep -E ':(80|443|3000|3100)\b'
free -h
```

If something already listens on 3100, choose another port and use it everywhere below.

**1b. Install Node.js 22 and git:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git
node -v   # should print v22.x
```

**1c. Create the `deploy` user and folders:**

```bash
adduser --system --group --home /opt/pos --shell /bin/bash deploy
mkdir -p /opt/pos/data
git clone https://github.com/baishitongg/pos.git /opt/pos/app
chown -R deploy:deploy /opt/pos
```

**1d. Create the production settings file** (`/opt/pos/.env`). The first two commands print random secrets; paste their output into the file:

```bash
openssl rand -base64 48   # → QR_SECRET
openssl rand -base64 18   # → run 2 more times for the two passwords
nano /opt/pos/.env
```

```ini
NODE_ENV=production
PORT=3100
HOST=127.0.0.1
PUBLIC_URL=http://206.189.152.139:3100
TRUST_PROXY=0
QR_SECRET=<paste long random string>
ADMIN_PASSWORD=<paste random password>
KITCHEN_PASSWORD=<paste random password>
DATA_FILE=/opt/pos/data/db.json
RESTAURANT_NAME=Hai Kitchen
LOG_REQUESTS=1
```

```bash
chown deploy:deploy /opt/pos/.env && chmod 600 /opt/pos/.env
```

> Keep the passwords somewhere safe (a password manager). They are the admin and kitchen logins.
> `HOST=127.0.0.1` keeps the app private until nginx/HTTPS is set up in Step 5. For a quick test before that, set `HOST=0.0.0.0` and open port 3100 in the firewall.

**1e. Install the service and the restart permission:**

```bash
cp /opt/pos/app/deploy/pos.service /etc/systemd/system/pos.service
install -m 440 /opt/pos/app/deploy/sudoers-pos /etc/sudoers.d/pos
visudo -c                      # must say: parsed OK
sudo -u deploy bash -c 'cd /opt/pos/app && npm ci --omit=dev'
systemctl daemon-reload
systemctl enable --now pos
curl -s http://127.0.0.1:3100/readyz   # → {"ready":true}
```

If it's not ready: `journalctl -u pos -n 50`

---

## Step 2 — Create a deploy key (on your Mac)

This key is used **only** by GitHub to log in as `deploy`. It doesn't touch your personal SSH key.

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f ~/.ssh/pos_deploy
```

Copy the **public** key to the server:

```bash
cat ~/.ssh/pos_deploy.pub
```

On the server (as root), paste it in:

```bash
mkdir -p /opt/pos/.ssh && nano /opt/pos/.ssh/authorized_keys
chown -R deploy:deploy /opt/pos/.ssh && chmod 700 /opt/pos/.ssh && chmod 600 /opt/pos/.ssh/authorized_keys
```

Test from your Mac (should print `deploy`):

```bash
ssh -i ~/.ssh/pos_deploy deploy@206.189.152.139 whoami
```

Get the server's fingerprint for GitHub (used to make sure GitHub only ever talks to *your* server):

```bash
ssh-keyscan -t ed25519 206.189.152.139
```

---

## Step 3 — Add the secrets in GitHub

Repo → **Settings → Secrets and variables → Actions**.

**Secrets** tab → *New repository secret*, four times:

| Name | Value |
|---|---|
| `DEPLOY_HOST` | `206.189.152.139` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | the whole output of `cat ~/.ssh/pos_deploy` (the **private** key, including the BEGIN/END lines) |
| `DEPLOY_KNOWN_HOSTS` | the line printed by `ssh-keyscan` |

**Variables** tab → *New repository variable*: `DEPLOY_ENABLED` = `true`

> Optional: **Settings → Environments → production → Required reviewers** makes every deploy wait for your approval click.

---

## Step 4 — Deploy

Push anything to `main`, or open **Actions → Check & deploy → Run workflow**. Watch it in the **Actions** tab; the last line shows `Deployed <commit> — healthy`.

---

## Step 5 — Domain and HTTPS (when you have the domain)

1. Add a DNS **A record**, e.g. `order.yourdomain.com → 206.189.152.139`.
2. On the server:
   ```bash
   apt-get install -y nginx certbot python3-certbot-nginx   # skip if nginx already runs the spa site
   cp /opt/pos/app/deploy/nginx-pos.conf /etc/nginx/sites-available/pos
   nano /etc/nginx/sites-available/pos        # replace order.example.com with your domain,
                                              # and 3100 with the PORT in /opt/pos/.env
   ln -s /etc/nginx/sites-available/pos /etc/nginx/sites-enabled/pos
   nginx -t && systemctl reload nginx
   certbot --nginx -d order.yourdomain.com
   ```
3. In `/opt/pos/.env` set `PUBLIC_URL=https://order.yourdomain.com` and `TRUST_PROXY=1`, then `systemctl restart pos`.
4. **Re-print the table QR codes** from Admin → Tables & QR (they contain the URL).

This adds a new site to nginx without touching the existing spa website.

---

## Everyday commands (on the server)

| What | Command |
|---|---|
| Status | `systemctl status pos` |
| Live logs | `journalctl -u pos -f` |
| Restart | `systemctl restart pos` |
| Manual deploy of latest main | `sudo -u deploy bash /opt/pos/app/deploy/deploy.sh` |
| Change staff passwords | edit `ADMIN_PASSWORD` / `KITCHEN_PASSWORD` in `/opt/pos/.env`, then `systemctl restart pos` |
| Back up data | `tar czf ~/pos-backup-$(date +%F).tgz /opt/pos/data` |

## Notes
- A deploy restarts the app (~1–2 s). Guests' screens reconnect automatically and a retried order is never duplicated. For zero-downtime deploys later, run two instances behind nginx.
- The service is capped at 400 MB of memory (`MemoryMax` in `pos.service`) so it can't starve the spa website.
- Turn on DigitalOcean **droplet backups**: `/opt/pos/data` holds all orders and photos until we move to PostgreSQL.
