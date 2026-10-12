package wabot

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// The simulator logs bot replies as outbound "bot" messages (no gateway).
func TestRecordBotMessageShowsInThread(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	phone := "6281255500123"
	var conv string
	if err := tx.QueryRow(ctx, `INSERT INTO crm.wa_conversations (phone, external_id, display_name)
	  VALUES ($1::text, $1::text, 'Tes Store') RETURNING id::text`, phone).Scan(&conv); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	var st store
	if err := st.recordBotMessage(ctx, tx, conv, phone, "Halo dari bot", at); err != nil {
		t.Fatalf("recordBotMessage: %v", err)
	}
	var direction, kind, provider, status, preview string
	err := tx.QueryRow(ctx, `SELECT m.direction, m.message_type, m.provider, m.status, v.last_message_preview
	  FROM crm.wa_messages m JOIN crm.wa_conversations v ON v.id = m.conversation_id
	  WHERE m.conversation_id = $1::uuid ORDER BY m.created_at DESC LIMIT 1`, conv).
		Scan(&direction, &kind, &provider, &status, &preview)
	if err != nil {
		t.Fatal(err)
	}
	if direction != "out" || kind != "bot" || provider != "simulasi" || status != "sent" || preview != "Halo dari bot" {
		t.Fatalf("stored %s/%s/%s/%s preview=%q", direction, kind, provider, status, preview)
	}
}
