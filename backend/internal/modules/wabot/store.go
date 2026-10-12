package wabot

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/wabot/domain"
	"nuhabit/backend/internal/platform/database"
)

type store struct{}

// settings reads the bot_* keys (jsonb values).
func (store) settings(ctx context.Context, q database.Querier) (Settings, error) {
	s := Settings{Name: "Mizu Assistant", HandoverKeywords: []string{"admin", "cs", "manusia", "operator"}}
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key LIKE 'bot_%'`)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return s, err
		}
		var v any
		_ = json.Unmarshal(raw, &v)
		switch key {
		case "bot_enabled":
			switch x := v.(type) {
			case bool:
				s.Enabled = x
			case string:
				s.Enabled = x == "true"
			}
		case "bot_name":
			if text, ok := v.(string); ok && strings.TrimSpace(text) != "" {
				s.Name = strings.TrimSpace(text)
			}
		case "bot_greeting":
			if text, ok := v.(string); ok {
				s.Greeting = strings.TrimSpace(text)
			}
		case "bot_handover_keywords":
			if text, ok := v.(string); ok && strings.TrimSpace(text) != "" {
				s.HandoverKeywords = nil
				for _, k := range strings.Split(text, ",") {
					if k = strings.TrimSpace(k); k != "" {
						s.HandoverKeywords = append(s.HandoverKeywords, k)
					}
				}
			}
		}
	}
	return s, rows.Err()
}

func (store) conversation(ctx context.Context, q database.Querier, id string) (*Conversation, error) {
	var c Conversation
	var phone, name, reason *string
	err := q.QueryRow(ctx, `SELECT id::text, phone, display_name, bot_active, bot_handover_at, bot_handover_reason
	  FROM crm.wa_conversations WHERE id = $1::uuid`, id).Scan(&c.ID, &phone, &name, &c.BotActive, &c.HandoverAt, &reason)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if phone != nil {
		c.Phone = *phone
	}
	if name != nil {
		c.DisplayName = strings.TrimSpace(*name)
	}
	if reason != nil {
		c.HandoverReason = *reason
	}
	return &c, nil
}

// activate turns the bot on for a conversation that no agent has taken over.
func (store) activate(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_conversations SET bot_active = true
	  WHERE id = $1::uuid AND bot_handover_at IS NULL AND NOT bot_active`, id)
	return err
}

// handover stops the bot on a conversation and records why.
func (store) handover(ctx context.Context, q database.Querier, id, reason string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_conversations
	  SET bot_active = false, bot_handover_at = $2, bot_handover_reason = $3 WHERE id = $1::uuid`, id, at, reason)
	return err
}

// resume lets the bot answer again (an agent switched it back on).
func (store) resume(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_conversations
	  SET bot_active = true, bot_handover_at = NULL, bot_handover_reason = NULL WHERE id = $1::uuid`, id)
	return err
}

type sessionRow struct {
	Session   *domain.Session
	LastBotAt *time.Time
	LatencyMs *int
}

func (store) session(ctx context.Context, q database.Querier, conversationID string) (*sessionRow, error) {
	var raw []byte
	var row sessionRow
	err := q.QueryRow(ctx, `SELECT state, last_bot_at, last_latency_ms FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, conversationID).
		Scan(&raw, &row.LastBotAt, &row.LatencyMs)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s := domain.NewSession()
	if err := json.Unmarshal(raw, s); err != nil {
		return nil, err
	}
	if s.Step == "" {
		s.Step = domain.StepOutlet
	}
	if s.Pref == "" {
		s.Pref = "any"
	}
	row.Session = s
	return &row, nil
}

func (store) saveSession(ctx context.Context, q database.Querier, conversationID, phone string, s *domain.Session, customerAt, botAt time.Time, latency time.Duration) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO crm.wa_bot_sessions (conversation_id, phone, step, state, misses, last_customer_at, last_bot_at, last_latency_ms)
	  VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
	  ON CONFLICT (conversation_id) DO UPDATE SET phone = EXCLUDED.phone, step = EXCLUDED.step, state = EXCLUDED.state,
	    misses = EXCLUDED.misses, last_customer_at = EXCLUDED.last_customer_at, last_bot_at = EXCLUDED.last_bot_at,
	    last_latency_ms = EXCLUDED.last_latency_ms, updated_at = now()`,
		conversationID, phone, s.NextStep(), raw, s.Misses, customerAt, botAt, int(latency/time.Millisecond))
	return err
}

func (store) deleteSession(ctx context.Context, q database.Querier, conversationID string) error {
	_, err := q.Exec(ctx, `DELETE FROM crm.wa_bot_sessions WHERE conversation_id = $1::uuid`, conversationID)
	return err
}

// recordBotMessage logs a bot reply the simulator did not send.
func (store) recordBotMessage(ctx context.Context, q database.Querier, conversationID, phone, text string, at time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO crm.wa_messages (conversation_id, direction, message_type, channel, external_id, phone, body, status, provider, created_at)
	  VALUES ($1::uuid, 'out', 'bot', 'whatsapp', $2::text, $3::text, $4::text, 'sent', 'simulasi', $5)`, conversationID, phone, phone, text, at)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE crm.wa_conversations SET last_message_at = $2, last_message_preview = left($3, 80), awaiting_since = NULL
	  WHERE id = $1::uuid`, conversationID, at, text)
	return err
}

// afterBotReply clears the SLA clock: the customer got an answer.
func (store) afterBotReply(ctx context.Context, q database.Querier, conversationID string) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_conversations SET awaiting_since = NULL WHERE id = $1::uuid`, conversationID)
	return err
}
