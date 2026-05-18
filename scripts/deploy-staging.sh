#!/usr/bin/env bash
# Deploy to staging environment
# Usage: ./scripts/deploy-staging.sh
set -e

echo "🚀 Deploying Elevate Dental OS to STAGING"
echo "----------------------------------------"

# 1. Run database migrations on staging Supabase
echo "[1/4] Running database migrations..."
cd db
supabase db push --project-ref ${SUPABASE_STAGING_REF}
cd ..

# 2. Deploy backend to Railway staging
echo "[2/4] Deploying backend to Railway..."
cd backend
railway up --environment staging --service api
cd ..

# 3. Deploy frontend to Railway staging
echo "[3/4] Deploying frontend to Railway staging..."
cd frontend
railway up --environment staging --service web
cd ..

# 4. Run smoke tests
echo "[4/4] Running smoke tests..."
curl -f https://staging-api.elevate.app/healthcheck

echo "✅ Staging deployment complete"
echo "   Frontend: https://staging.elevate.app"
echo "   Backend:  https://staging-api.elevate.app"
