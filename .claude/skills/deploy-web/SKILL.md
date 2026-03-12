---
name: deploy-web
description: Deploy the frontend to Vercel (openlegalcodes.org). Use when frontend code changes need to go live.
argument-hint:
user-invocable: true
---

# Deploy Frontend to Vercel

Deploy the Next.js frontend to Vercel at openlegalcodes.org.

## Project Details
- **Vercel project**: openlegalcodes (team: tidydotcom)
- **GitHub repo**: TIDYAPP/open-legal-codes
- **Custom domains**: openlegalcodes.org, www.openlegalcodes.org
- **Env vars**: API_URL=https://api.openlegalcodes.org (production)

## Steps

1. **Deploy from the web/ directory**:
```bash
cd web && npx vercel --prod
```

2. **Verify**:
```bash
curl -sI "https://openlegalcodes.org/" | head -5
curl -s "https://openlegalcodes.org/api/v1/lookup?slug=mountain-view&state=CA" | head -100
```

## Notes
- The Vercel project is linked in `web/.vercel/`
- Next.js rewrites in `web/next.config.ts` proxy `/api/v1/*` to the backend using the `API_URL` env var
- Client-side code uses relative URLs (empty API_BASE) which go through the rewrite
- Server-side code (SSR) uses `API_URL` directly to reach the backend
- Deployment protection is set to `all_except_custom_domains` — the custom domain is publicly accessible
- DNS is managed by Vercel (domain purchased through Vercel)
- To add/update env vars: `npx vercel env add VAR_NAME production`
