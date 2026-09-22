# MetabolicTrack Lab PM — IT Deployment Instructions
## Version 1.9.10 — Final Release

---

## What's in this package

```
MetabolicTrack_LabPM_v1.9.10/
├── app/                        ← Full application (extract to ~/labpm-docker/)
├── sql_patches/
│   ├── 01_fix_users.sql        ← Fix user accounts
│   ├── 02_fix_kpi.sql          ← Fix KPI tracking page
│   ├── 03_apply_hr_schema.sql  ← Add HR portal tables
│   ├── 04_v1.9_additions.sql   ← Templates, overhead, PO trigger, auto-reorder
│   └── 05_apply_overhead_po.sql ← Overhead PO support
├── MASTER_CREDENTIALS.md       ← All login details (keep secure, do not put on server)
├── PERMISSIONS.md              ← Full role permissions reference
└── DEPLOY_INSTRUCTIONS.md      ← This file
```

---

## Server details

| | |
|---|---|
| **Hardware** | Intel N100 Mini PC |
| **OS** | Ubuntu Server 24.04 LTS |
| **App URL** | http://192.168.1.50 |
| **SSH** | ssh user@192.168.1.50 |
| **App directory** | ~/labpm-docker/ |

---

## Step 1 — Transfer all files to the server

Run from your local machine:

```bash
scp -r MetabolicTrack_LabPM_v1.9.10/ user@192.168.1.50:~/
```

Then SSH in for all remaining steps:

```bash
ssh user@192.168.1.50
```

---

## Step 2 — Extract app code

```bash
# Backup existing app (recommended)
cp -r ~/labpm-docker ~/labpm-docker-backup-$(date +%Y%m%d)

# Extract new version
cp -r ~/MetabolicTrack_LabPM_v1.9.10/app ~/labpm-docker

# Verify your .env file is still in place
cat ~/labpm-docker/.env
```

> ⚠ If .env is empty or missing, re-populate it before continuing.
> See the Environment Variables section below.

---

## Step 3 — Run all SQL patches in order

```bash
# Copy patches to DB container
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/01_fix_users.sql         labpm_db:/01.sql
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/02_fix_kpi.sql           labpm_db:/02.sql
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/03_apply_hr_schema.sql   labpm_db:/03.sql
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/04_v1.9_additions.sql    labpm_db:/04.sql
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/05_apply_overhead_po.sql labpm_db:/05.sql
docker cp ~/MetabolicTrack_LabPM_v1.9.10/sql_patches/06_fix_staff_status_sync.sql labpm_db:/06.sql

# Run them in order
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /01.sql
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /02.sql
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /03.sql
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /04.sql
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /05.sql
docker compose -f ~/labpm-docker/docker-compose.yml exec db psql -U labpm_user labpm -f /06.sql
```

Each patch is safe to re-run if needed (uses IF NOT EXISTS).

---

## Step 4 — Rebuild and restart

```bash
cd ~/labpm-docker
docker compose up -d --build
```

Build takes 3–5 minutes. The app is unavailable during this time.

---

## Step 5 — Verify

```bash
docker compose ps
```

All 5 services must show **Up**:

```
labpm_db          Up (healthy)
labpm_backend     Up
labpm_frontend    Up
labpm_nginx       Up
labpm_cron        Up
```

Then open http://192.168.1.50 in a browser and log in:

```
Email:    cb@metabolictrack.com
Password: ChangeMe!
```

---

## Environment variables (.env)

The file `~/labpm-docker/.env` must contain:

```
DB_PASSWORD=          # PostgreSQL password
SECRET_KEY=           # JWT signing key — openssl rand -hex 32
FERNET_KEY=           # Encryption key — python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ANTHROPIC_API_KEY=    # sk-ant-api03-...
ALLOWED_ORIGINS=      # http://localhost,http://192.168.1.50
GMAIL_SENDER=         # cb@metabolictrack.com
GMAIL_APP_PASSWORD=   # 16-char Gmail App Password (not regular password)
```

---

## Troubleshooting

**Container won't start:**
```bash
docker compose logs backend | tail -50
```

**HR portal blank / not loading:**
```bash
docker compose exec db psql -U labpm_user labpm -c "\dt" | grep staff_status
```
If not listed, re-run patch 03.

**Login says incorrect password:**
```bash
docker compose exec db psql -U labpm_user labpm -c "SELECT email, role FROM users ORDER BY id;"
```
If no rows, re-run patch 01. If rows exist:
```bash
docker compose exec db psql -U labpm_user labpm -c \
  "UPDATE users SET hashed_password = crypt('ChangeMe!', gen_salt('bf',12)) WHERE email = 'cb@metabolictrack.com';"
```

**Check disk space:**
```bash
df -h && docker system df
```

---

## Notify when complete

Once all 5 containers are Up and login is confirmed, notify **cb@metabolictrack.com**.
Chris Bagley will distribute login credentials to the team.
