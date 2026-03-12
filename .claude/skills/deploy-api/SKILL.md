---
name: deploy-api
description: Deploy the backend API to the Hetzner server (api.openlegalcodes.org). Use when backend code changes need to go live.
argument-hint:
user-invocable: true
---

# Deploy API to Hetzner

Deploy the backend API server to the Hetzner VPS at api.openlegalcodes.org.

## Server Details
- **IP**: 5.161.76.23 (Ashburn, VA)
- **SSH key**: /tmp/hetzner-openlegalcodes (generate new one if missing)
- **Docker containers**: `openlegalcodes-api` (app) + `caddy` (reverse proxy/SSL)
- **Codes volume**: /root/codes on host, mounted to /app/codes in container

## Steps

1. **Build and upload** — create a tarball of backend source (exclude web/, codes/, node_modules/, .git/) and scp to server:
```bash
tar czf /tmp/olc-deploy.tar.gz \
  --exclude='node_modules' --exclude='web' --exclude='codes' \
  --exclude='.git' --exclude='dist' --exclude='.next' --exclude='.context' \
  Dockerfile package*.json tsconfig.json src/ data/
scp -i /tmp/hetzner-openlegalcodes /tmp/olc-deploy.tar.gz root@5.161.76.23:/root/olc-deploy.tar.gz
```

2. **Build and restart on server**:
```bash
ssh -i /tmp/hetzner-openlegalcodes root@5.161.76.23 '
cd /root/app && tar xzf /root/olc-deploy.tar.gz 2>/dev/null &&
docker build -t openlegalcodes-api . &&
docker stop openlegalcodes-api && docker rm openlegalcodes-api &&
docker run -d --name openlegalcodes-api --restart unless-stopped \
  --network host \
  -v /root/codes:/app/codes \
  openlegalcodes-api'
```

3. **Verify**:
```bash
ssh -i /tmp/hetzner-openlegalcodes root@5.161.76.23 'docker logs openlegalcodes-api 2>&1 | tail -5'
curl -s "https://api.openlegalcodes.org/api/v1/lookup?slug=mountain-view&state=CA"
```

## Notes
- The `--network host` flag is required so Caddy can reach the API on localhost:3100
- The /root/codes volume persists cached legal codes across container restarts
- Caddy auto-manages SSL certs via Let's Encrypt
- If SSH key is missing, check hcloud or generate a new one and add it to the server
