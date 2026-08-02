#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
echo "=================================================="
echo " Starting 2-Player Split-Screen Monster Truck Race "
echo "=================================================="
echo "Launching browser..."
echo ""

# Vite --open opens exactly 1 browser tab when the dev server starts
npm run dev -- --open
