# 🚀 TripBng — Complete VPS Production Deployment Guide

This guide details the end-to-end steps to deploy the **TripBng — Enterprise B2B Travel Distribution Platform** onto a fresh VPS running **Ubuntu (22.04 LTS / 24.04 LTS)**.

---

## 🏗️ Architecture Overview

The system consists of the following components:
*   **Database & Cache**: MongoDB (6.0) & Redis (7.0) run inside lightweight Docker containers managed by Docker Compose.
*   **Backend API**: Express server (`@tripbng/api`) running on port `4000` (managed by PM2).
*   **Frontend Client**: Next.js client (`@tripbng/web`) running on port `3000` (managed by PM2).
*   **Web Server / Proxy**: Nginx routing external traffic (HTTP/HTTPS) to ports `3000` and `4000` with Let's Encrypt SSL.

---

## 🛠️ Step 1: Initial Server Update & Tools Setup

First, log into your VPS via SSH:
```bash
ssh root@your_vps_ip
```

Update the system packages to the latest versions:
```bash
sudo apt update && sudo apt upgrade -y
```

Install essential system utilities:
```bash
sudo apt install -y curl git ufw build-essential
```

---

## 📦 Step 2: Install Node.js 22 & PNPM

The project requires Node.js version **22+** and **pnpm** (>=10) as the package manager.

1.  **Install Node.js 22 using NodeSource**:
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
    ```
    Verify the installations:
    ```bash
    node -v  # Should be v22.x.x
    npm -v
    ```

2.  **Install PNPM**:
    ```bash
    sudo npm install -y -g pnpm
    ```
    Verify PNPM:
    ```bash
    pnpm -v  # Should be 10.x.x
    ```

3.  **Install PM2 (Process Manager)**:
    We will use PM2 to keep both the Express backend and Next.js frontend running persistently in the background.
    ```bash
    sudo npm install -y -g pm2
    ```

---

## 🐳 Step 3: Install Docker & Docker Compose (For MongoDB & Redis)

Instead of manually installing MongoDB and Redis on the OS (which is complex and harder to maintain), we will run them using the project's official Docker Compose file.

1.  **Install Docker**:
    ```bash
    # Add Docker's official GPG key:
    sudo apt-get update
    sudo apt-get install ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc

    # Add the repository to Apt sources:
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ```

2.  **Verify Docker**:
    ```bash
    sudo docker --version
    sudo docker compose version
    ```

---

## 📥 Step 4: Clone the Repository & Configure Databases

1.  **Clone the project**:
    Let's clone the repository into the `/var/www/` folder (a standard directory for web apps):
    ```bash
    cd /var/www
    git clone https://github.com/krish1124007/Tripbng-Fullstack.git tripbng-b2b
    cd tripbng-b2b
    ```

2.  **Start MongoDB & Redis containers**:
    Run the docker-compose file in the background (detached mode):
    ```bash
    sudo docker compose -f infra/docker/docker-compose.yml up -d
    ```

3.  **Initialize MongoDB Replica Set (CRITICAL for wallet/booking transactions)**:
    Since production transaction processing requires a replica set, run this command to initialize a single-node replica set in the MongoDB container:
    ```bash
    sudo docker exec -it tripbng-mongodb mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"
    ```

4.  **Verify databases are running**:
    ```bash
    sudo docker ps
    ```
    You should see both `tripbng-mongodb` (port 27017) and `tripbng-redis` (port 6379) marked as **Up**.

---

## 📝 Step 5: Configure Environment Variables (`.env`)

You need to create `.env` files for both the API backend and the Next.js frontend.

### 1. API Backend Configuration (`apps/api/.env`)

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```
Update the variables to match production settings (replace dummy secrets with strong, random 64-character values):
```env
NODE_ENV=production
API_PORT=4000
API_HOST=0.0.0.0
API_BASE_URL=https://api.yourdomain.com  # Change to your backend sub-domain

# Database (connects to the local Docker MongoDB container with replica set)
MONGO_URI=mongodb://localhost:27017/tripbng_b2b?replicaSet=rs0
MONGO_POOL_SIZE=10

# Redis (connects to the local Docker Redis container)
REDIS_URL=redis://localhost:6379

# Auth Secrets (GENERATE SECURE STRINGS FOR THESE)
JWT_ACCESS_SECRET=your-super-long-secure-64-character-jwt-access-secret-key-goes-here
JWT_REFRESH_SECRET=your-different-super-long-secure-64-character-jwt-refresh-secret-key-goes-here
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
BCRYPT_COST=12

# CORS — comma-separated allowlist
CORS_ORIGINS=https://yourdomain.com      # Change to your frontend domain

LOG_LEVEL=info
TOTP_ISSUER=TripBng
```

### 2. Frontend Configuration (`apps/web/.env`)

```bash
cp apps/web/.env.example apps/web/.env
nano apps/web/.env
```
Update the variables:
```env
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com   # Points to your backend domain
NEXT_PUBLIC_APP_NAME=TripBng
```

---

## 🚀 Step 6: Install Dependencies & Build the Monorepo

Since this is a Turborepo-managed workspace, we can build everything using single root commands.

1.  **Install dependencies**:
    ```bash
    pnpm install
    ```

2.  **Build the projects**:
    ```bash
    pnpm run build
    ```

3.  **Seed the Database (Optional)**:
    If your project has seed scripts to populate initial data, run:
    ```bash
    pnpm run seed
    ```

---

## 🔄 Step 7: Launch the App using PM2

We will run both applications using PM2 to ensure they run in the background and automatically restart if they crash or the server reboots.

Let's create a PM2 configuration file in the project root to manage both apps easily:
```bash
nano ecosystem.config.cjs
```

Paste the following configuration:
```javascript
module.exports = {
  apps: [
    {
      name: 'tripbng-api',
      script: 'pnpm',
      args: '--filter @tripbng/api start',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    },
    {
      name: 'tripbng-web',
      script: 'pnpm',
      args: '--filter @tripbng/web start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
```

Launch both applications:
```bash
pm2 start ecosystem.config.cjs
```

Save the process list and configure PM2 to start on system boot:
```bash
pm2 save
pm2 startup
```
*(Copy and run the custom `sudo env PATH=...` command shown on your terminal after running `pm2 startup` to complete the auto-start registration).*

Verify that both applications are active:
```bash
pm2 status
```

---

## 🌐 Step 8: Setup Nginx Web Server (Reverse Proxy)

Nginx will intercept incoming web requests on port `80` (HTTP) and `443` (HTTPS) and proxy them to our internal ports (`3000` for Web, `4000` for API).

1.  **Install Nginx**:
    ```bash
    sudo apt install -y nginx
    ```

2.  **Create an Nginx configuration file**:
    ```bash
    sudo nano /etc/nginx/sites-available/tripbng
    ```

    Paste the following server block, substituting `yourdomain.com` and `api.yourdomain.com` with your actual domain names:
    ```nginx
    # ----------------------------------------------------
    # 1. FRONTEND SERVER (yourdomain.com)
    # ----------------------------------------------------
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;

        # Frontend Next.js app
        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # ----------------------------------------------------
    # 2. BACKEND API SERVER (api.yourdomain.com)
    # ----------------------------------------------------
    server {
        listen 80;
        server_name api.yourdomain.com;

        # Backend API
        location / {
            proxy_pass http://127.0.0.1:4000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    ```

3.  **Enable the configuration**:
    ```bash
    sudo ln -s /etc/nginx/sites-available/tripbng /etc/nginx/sites-enabled/
    # Remove the default nginx config to prevent conflicts
    sudo rm /etc/nginx/sites-enabled/default
    ```

4.  **Test Nginx config & restart**:
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```

---

## 🔒 Step 9: Install Let's Encrypt SSL (HTTPS)

Let's encrypt our traffic using free SSL certificates from Certbot.

1.  **Install Let's Encrypt / Certbot**:
    ```bash
    sudo apt install -y certbot python3-certbot-nginx
    ```

2.  **Generate Certificates & Configure Nginx automatically**:
    ```bash
    sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d api.yourdomain.com
    ```
    *   Follow the prompts (enter email, accept terms).
    *   Select **2** (Redirect all HTTP traffic to HTTPS) to secure your app fully.

3.  **Verify automatic SSL renewal**:
    ```bash
    sudo certbot renew --dry-run
    ```

---

## 🛡️ Step 10: Configure Firewall (UFW)

Secure your VPS by allowing only required ports:
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Verify firewall status:
```bash
sudo ufw status
```

---

## 🎉 Deploy Complete!

Your Enterprise B2B platform is now live and fully secure!
*   **Frontend**: `https://yourdomain.com`
*   **Backend API**: `https://api.yourdomain.com`
*   **Databases**: MongoDB & Redis are running securely inside Docker behind closed ports.

---

## 🪵 Useful Commands for Maintenance

| Action | Command |
| :--- | :--- |
| **Check App Logs** | `pm2 logs` |
| **Check DB Status** | `sudo docker ps` |
| **Restart Application** | `pm2 restart ecosystem.config.cjs` |
| **Re-pull Code & Redeploy** | `git pull && pnpm install && pnpm run build && pm2 restart all` |
| **View Docker DB Logs** | `sudo docker compose -f infra/docker/docker-compose.yml logs -f` |
