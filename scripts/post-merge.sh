#!/bin/bash
set -e
pnpm install --frozen-lockfile
echo "Database migrations are applied explicitly by the deployment workflow; automatic schema push is disabled."
