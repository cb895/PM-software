# MetabolicTrack Lab PM — Deployment Guide
## Intel N100 Mini PC · Ubuntu Server 24.04 LTS

---

## Hardware

| Component | Spec |
|---|---|
| CPU | Intel Alder Lake N100 (4-core, 3.4GHz boost) |
| RAM | 16GB DDR4 |
| Storage | 500GB PCIe 3.0 NVMe SSD |
| Network | Dual LAN (use primary port for the app) |
| OS | Ubuntu Server 24.04 LTS |

---

## Prerequisites — One-Time Server Setup

SSH into the N100 after Ubuntu Server install, then run these once.

### 1. System update

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nano ufw
```

### 2. Install Docker Engine

```bash
# Add Docker's official GPG key and repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### 3. Configure firewall

```bash
sudo ufw allow OpenSSH      # keep SSH access
sudo ufw allow 80/tcp       # HTTP for the app
# sudo ufw allow 443/tcp    # uncomment when SSL is configured
sudo ufw enable
sudo ufw status
```

### 4. (Optional) Set a static IP

Edit your Netplan config so the N100 always has the same IP on your network:

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp1s0:           # your primary LAN port — check with: ip link show
      dhcp4: no
      addresses: [192.168.1.50/24]    # choose an IP outside your router's DHCP range
      gateway4: 192.168.1.1           # your router's IP
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
```

```bash
sudo netplan apply
ip addr show enp1s0   # confirm new IP
```

---

## App Deployment

### 1. Copy files to the server

From your Mac/PC, transfer the labpm-docker folder:

```bash
scp -r labpm-docker/ user@192.168.1.50:~/labpm-docker/
```

Or clone from a private Git repo if you've pushed the code there:

```bash
git clone https://your-repo-url.git ~/labpm-docker
```

### 2. Create your .env file

```bash
cd ~/labpm-docker
cp .env.example .env
nano .env
```

Fill in all secrets — generate them on the server itself:

**DB_PASSWORD**
```bash
openssl rand -base64 24
```

**SECRET_KEY** (JWT signing key)
```bash
openssl rand -hex 32
```

**FERNET_KEY** (supplier credential encryption)
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# If python3-cryptography not installed: pip3 install cryptography --break-system-packages
```

**ANTHROPIC_API_KEY**
```
sk-ant-api03-...   (from console.anthropic.com)
```

**ALLOWED_ORIGINS**
```
ALLOWED_ORIGINS=http://localhost,http://192.168.1.50
```

Your completed `.env` should look like:
```
DB_PASSWORD=your-generated-password
SECRET_KEY=your-64-char-hex-string
FERNET_KEY=your-fernet-key=
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGINS=http://localhost,http://192.168.1.50
```

### 3. Build and start

```bash
cd ~/labpm-docker
docker compose up -d --build
```

First build takes 5–10 minutes (downloads base images, installs Python packages,
builds the React app). The N100 handles this comfortably.
Subsequent starts take under 30 seconds.

### 4. Verify everything is running

```bash
docker compose ps
```

All five services should show `Up`:

```
NAME              STATUS
labpm_db          Up (healthy)
labpm_backend     Up
labpm_frontend    Up
labpm_nginx       Up
labpm_cron        Up
```

### 5. Access the app

Open a browser on any device on the same network:
```
http://192.168.1.50
```

Log in with the ops manager account:
- **Email:** cb@metabolictrack.com
- **Password:** ChangeMe!

**Change all passwords immediately after first login** — go to sidebar → My profile.

---

## Daily Operations

```bash
# View live logs (all services)
docker compose logs -f

# View logs for one service
docker compose logs -f backend
docker compose logs -f db

# Restart a single service (e.g. after a code change)
docker compose restart backend

# Stop everything (data is preserved)
docker compose down

# Start everything
docker compose up -d

# Rebuild after a code update
docker compose up -d --build
```

---

## Database Backup

### Manual backup

```bash
docker compose exec db pg_dump -U labpm_user labpm \
  > ~/backups/labpm_$(date +%Y%m%d_%H%M%S).sql
```

### Automatic daily backup (recommended)

Create a backup script:

```bash
mkdir -p ~/backups
cat > ~/backup-labpm.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR=~/backups
mkdir -p $BACKUP_DIR
docker exec labpm_db pg_dump -U labpm_user labpm \
  > $BACKUP_DIR/labpm_$(date +%Y%m%d_%H%M%S).sql
# Keep last 30 days only
find $BACKUP_DIR -name "labpm_*.sql" -mtime +30 -delete
echo "Backup complete: $(ls -lh $BACKUP_DIR/labpm_*.sql | tail -1)"
SCRIPT
chmod +x ~/backup-labpm.sh
```

Schedule it via cron:
```bash
crontab -e
# Add this line — runs at 2am daily:
0 2 * * * ~/backup-labpm.sh >> ~/backups/backup.log 2>&1
```

### Restore from backup

```bash
# Stop the app first
docker compose down

# Start just the database
docker compose up -d db

# Restore
cat ~/backups/labpm_20260903_020000.sql \
  | docker compose exec -T db psql -U labpm_user labpm

# Restart everything
docker compose up -d
```

---

## Performance Notes — Intel N100

The N100 is well-matched to this workload:

- **PostgreSQL** — 16GB RAM means the entire database fits in memory easily. The default Docker PostgreSQL config is fine; no tuning needed for a team of 6.
- **React build** — The first `docker compose up --build` will compile the React app. The N100 completes this in ~2 minutes. Subsequent builds skip unchanged layers.
- **Idle power** — The N100 draws ~6–10W at idle, making it practical to leave running 24/7.
- **Dual LAN** — Only one port is needed for the app. The second LAN can be used for a dedicated management/backup connection if needed.
- **NVMe SSD** — PCIe 3.0 NVMe gives fast database I/O. Docker volumes are stored at `/var/lib/docker/volumes/` by default on the NVMe.

---

## Adding Remote Access

### Option A — Tailscale (recommended)

Tailscale creates a private encrypted network — no port forwarding, no open firewall ports.

```bash
# Install Tailscale on the N100
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Note your Tailscale IP (looks like 100.x.x.x)
tailscale ip -4
```

Then update `.env`:
```
ALLOWED_ORIGINS=http://localhost,http://192.168.1.50,http://100.x.x.x
```

```bash
docker compose restart backend
```

Access from anywhere via `http://100.x.x.x` on any device running Tailscale.

### Option B — Domain + SSL (Let's Encrypt)

```bash
# Install Certbot
sudo apt install -y certbot

# Obtain cert (requires port 80 forwarded from your router)
sudo certbot certonly --standalone -d yourdomain.com

# Copy certs to nginx ssl folder
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem  nginx/ssl/

# Uncomment the SSL block in nginx/nginx.conf
# Uncomment port 443 in docker-compose.yml
# Add your domain to ALLOWED_ORIGINS in .env

docker compose restart nginx
```

---

## System Monitoring

```bash
# Resource usage of all Docker containers
docker stats

# Disk usage
df -h
docker system df

# Check Docker service is set to start on boot
sudo systemctl is-enabled docker   # should say "enabled"

# N100 CPU temperature (install lm-sensors if not present)
sudo apt install -y lm-sensors
sensors
```

---

## Updating the App

```bash
cd ~/labpm-docker

# Transfer new files via scp, or pull from git:
# git pull

# Rebuild and restart (data is not affected)
docker compose up -d --build
```

---

## Troubleshooting

**Container won't start:**
```bash
docker compose logs backend   # check for Python errors
docker compose logs db        # check for DB errors
```

**Database won't initialise:**
```bash
# Force a fresh DB init (WARNING: deletes all data)
docker compose down -v
docker compose up -d --build
```

**Can't reach the app from the network:**
```bash
# Check firewall
sudo ufw status
# Check Nginx is up and listening
docker compose ps nginx
curl http://localhost   # test from the N100 itself
```

**Reset a user's password from the server:**
```bash
docker compose exec db psql -U labpm_user labpm -c \
  "UPDATE users SET hashed_password = crypt('NewPassword!', gen_salt('bf',12)) WHERE email = 'user@metabolictrack.com';"
```

---

## File Locations on the N100

| Item | Path |
|---|---|
| App files | `~/labpm-docker/` |
| Docker volumes | `/var/lib/docker/volumes/` |
| Database data | `/var/lib/docker/volumes/labpm-docker_db_data/` |
| Backups | `~/backups/` |
| Nginx config | `~/labpm-docker/nginx/nginx.conf` |
| Environment secrets | `~/labpm-docker/.env` |

---

## Project Structure

```
labpm-docker/
├── docker-compose.yml       — orchestrates all 5 services
├── .env.example             — copy to .env, fill in secrets
├── .env                     — your secrets (never commit this)
├── README.md                — this file
├── backend/
│   ├── Dockerfile
│   ├── Dockerfile.cron
│   ├── requirements.txt
│   └── (FastAPI app code)
├── frontend/
│   ├── Dockerfile
│   └── (React app code)
├── nginx/
│   ├── nginx.conf
│   └── ssl/                 — place SSL certs here when ready
└── scripts/
    └── init/                — SQL run on first DB boot
        ├── 01_schema.sql
        ├── 02_cortisol_tasks.sql
        ├── 03_suppliers.sql
        ├── 04_consumables.sql
        ├── 05_budget.sql
        └── 06_kpi.sql
```
