#!/usr/bin/env bash
# Deploy to PRODUCTION — requires manual confirmation
# Usage: ./scripts/deploy-prod.sh
set -e

echo "⚠️  PRODUCTION DEPLOYMENT"
echo "========================"
echo "This will deploy to https://app.elevate.app"
read -p "Are you sure? (type YES): " confirm
if [ "$confirm" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

# Verify on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ Must deploy from 'main' branch. Currently on: $BRANCH"
  exit 1
fi

# Verify clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Uncommitted changes. Commit or stash first."
  exit 1
fi

echo "[1/5] Running tests..."
cd backend && npm test && cd ..
cd frontend && npm run typecheck && cd ..

echo "[2/5] Running production database migrations..."
cd db
supabase db push --project-ref ${SUPABASE_PROD_REF}
cd ..

echo "[3/5] Deploying backend to Railway production..."
cd backend
railway up --environment production --service api
cd ..

echo "[4/5] Deploying frontend to Railway production..."
cd frontend
railway up --environment production --service web
cd ..

echo "[5/5] Running smoke tests..."
sleep 10
curl -f https://api.elevate.app/healthcheck
curl -f https://app.elevate.app

# Tag release
TAG=$(date +%Y%m%d-%H%M)
git tag -a "release-$TAG" -m "Production release $TAG"
git push origin "release-$TAG"

echo "✅ Production deployment complete"
echo "   Tag: release-$TAG"
echo "   Sentry: https://sentry.io/organizations/elevate"
