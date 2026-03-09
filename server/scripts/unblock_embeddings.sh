#!/bin/bash
# Unblock E2E test by enabling embedding generation

set -e

echo "=================================================="
echo "E2E Test Unblocking Script"
echo "=================================================="
echo ""

# Database connection
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="squadrail"
DB_USER="squadrail"
export PGPASSWORD="squadrail"

# Check current state
echo "📊 Current State:"
echo "--------------------------------------------------"
TOTAL_CHUNKS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM knowledge_chunks;")
EMBEDDED_CHUNKS=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM knowledge_chunks WHERE embedding_vector IS NOT NULL;")
echo "Total chunks: $TOTAL_CHUNKS"
echo "Embedded chunks: $EMBEDDED_CHUNKS"
echo ""

if [ "$EMBEDDED_CHUNKS" -eq "$TOTAL_CHUNKS" ] && [ "$TOTAL_CHUNKS" -gt 0 ]; then
  echo "✅ All chunks already have embeddings!"
  echo "   Nothing to do."
  exit 0
fi

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ ERROR: OPENAI_API_KEY not set"
  echo ""
  echo "Set your OpenAI API key:"
  echo "  export OPENAI_API_KEY='your-key-here'"
  exit 1
fi

echo "✅ OpenAI API key found"
echo ""

# Options
echo "📋 Unblocking Options:"
echo "--------------------------------------------------"
echo ""
echo "Option 1: Enable Automatic Backfill (Recommended)"
echo "  - Sets environment variable SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=true"
echo "  - Restarts server with backfill enabled"
echo "  - Processes 10 documents per batch every 60 seconds"
echo "  - ETA: 2-5 minutes for full generation"
echo ""
echo "Option 2: Manual API Trigger (Advanced)"
echo "  - Triggers /api/knowledge/documents/:id/reembed for each doc"
echo "  - Requires authentication token"
echo "  - Slower but more controllable"
echo "  - ETA: 5-10 minutes"
echo ""
echo "Option 3: Check Status Only"
echo "  - Shows current embedding status and exits"
echo ""

# Get user choice
read -p "Select option [1/2/3]: " choice

case $choice in
  1)
    echo ""
    echo "🚀 Enabling Automatic Backfill..."
    echo "--------------------------------------------------"

    # Kill existing server
    pkill -f "npm run dev" 2>/dev/null || true
    sleep 2

    # Start server with backfill enabled
    cd /home/taewoong/company-project/squadall/server
    export SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED=true
    export SQUADRAIL_KNOWLEDGE_BACKFILL_INTERVAL_MS=30000  # Check every 30s
    export SQUADRAIL_KNOWLEDGE_BACKFILL_BATCH_SIZE=10

    echo "Starting server with backfill enabled..."
    npm run dev > /tmp/server_backfill.log 2>&1 &
    SERVER_PID=$!

    echo "Server PID: $SERVER_PID"
    echo "Logs: /tmp/server_backfill.log"
    echo ""

    # Wait for server to start
    echo "Waiting for server to start..."
    sleep 10

    # Monitor progress
    echo ""
    echo "📊 Monitoring embedding generation..."
    echo "   (Press Ctrl+C when complete)"
    echo "--------------------------------------------------"

    LAST_COUNT=0
    while true; do
      CURRENT_COUNT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM knowledge_chunks WHERE embedding_vector IS NOT NULL;")
      PERCENT=$(echo "scale=1; $CURRENT_COUNT * 100 / $TOTAL_CHUNKS" | bc)

      if [ "$CURRENT_COUNT" != "$LAST_COUNT" ]; then
        echo "[$(date '+%H:%M:%S')] Progress: $CURRENT_COUNT / $TOTAL_CHUNKS chunks ($PERCENT%)"
        LAST_COUNT=$CURRENT_COUNT
      fi

      if [ "$CURRENT_COUNT" -eq "$TOTAL_CHUNKS" ]; then
        echo ""
        echo "✅ Complete! All $TOTAL_CHUNKS chunks have embeddings"
        break
      fi

      sleep 5
    done

    echo ""
    echo "🎉 Embedding generation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Run: python3 scripts/e2e_complete_test.py"
    echo "  2. All tests should now pass"
    echo "  3. Proceed with full E2E workflow testing"
    ;;

  2)
    echo ""
    echo "❌ Manual API trigger not implemented yet"
    echo "   (Requires authentication system)"
    echo ""
    echo "Use Option 1 instead"
    exit 1
    ;;

  3)
    echo ""
    echo "📊 Embedding Status:"
    echo "--------------------------------------------------"
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
      SELECT
        COUNT(*) as total_chunks,
        COUNT(embedding_vector) as dense_embeddings,
        COUNT(CASE WHEN embedding::text != '[]' THEN 1 END) as sparse_embeddings,
        ROUND(COUNT(embedding_vector)::numeric / COUNT(*) * 100, 2) as percent_complete
      FROM knowledge_chunks;
    "

    echo ""
    echo "To enable embedding generation, run this script and select Option 1"
    ;;

  *)
    echo "Invalid option"
    exit 1
    ;;
esac

echo ""
echo "=================================================="
