package wabot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/safehttp"
)

// OpenAIExtractor reads a free-text WhatsApp message into an Extraction
// with one JSON-mode chat completion. Key, base URL and model come from
// configuration.app_settings (openai_api_key, openai_base_url,
// openai_model) with env OPENAI_API_KEY as the fallback — the same source
// the "Do" assistant uses. The model never writes customer-facing text.
type OpenAIExtractor struct {
	Getenv func(string) string
	Client *http.Client
}

var _ Extractor = OpenAIExtractor{}

// Configured reports whether an API key is available.
func (o OpenAIExtractor) Configured(ctx context.Context, q database.Querier) bool {
	s, err := appSettings(ctx, q, "openai_api_key")
	if err != nil {
		return false
	}
	return strings.TrimSpace(firstSet(s["openai_api_key"], o.Getenv("OPENAI_API_KEY"))) != ""
}

const extractPrompt = `Kamu membaca pesan WhatsApp dari calon pelanggan spa/massage Mizu (bisa berbahasa Indonesia atau Inggris) dan mengisi JSON. Jangan menjawab pelanggan; hanya ekstrak.
Keluarkan JSON dengan kunci (kosongkan "" / 0 / false / [] bila tidak disebut):
- outlet: nama outlet persis dari daftar OUTLET bila disebut atau jelas dimaksud
- people: jumlah orang (angka)
- treatments: daftar label treatment persis dari daftar TREATMENT, urut per orang bila disebut per orang
- date: tanggal kunjungan "YYYY-MM-DD" (hari ini = TODAY; "besok", "sabtu", "15 okt" dihitung dari TODAY, zona WIB)
- time: jam mulai "HH:MM" 24 jam bila disebut spesifik ("jam 3 sore" = "15:00")
- period: "pagi"/"siang"/"sore"/"malam" bila hanya disebut waktu umum
- therapist: nama terapis persis dari daftar TERAPIS bila disebut
- gender_pref: "male"/"female" bila minta terapis pria/wanita
- system_pick: true bila minta dipilihkan/terserah
- confirm: "yes"/"no" HANYA bila STEP = confirm dan pelanggan mengiyakan/menolak ringkasan
- payment: "outlet"/"online" HANYA bila STEP = payment
- name: nama pelanggan HANYA bila STEP = name
- want_admin: true bila minta bicara dengan admin/manusia/CS
- off_topic: true bila pesan tidak ada hubungannya dengan booking spa
ATURAN: isi sebuah field HANYA bila pelanggan menyebutnya secara eksplisit di PESAN ini; jangan menebak outlet, tanggal, jam, atau jumlah orang dari konteks. "saya dan istri" = 2 orang; "berdua" = 2; "sendiri" = 1.`

// Extract runs one completion; errors fall back to menu mode.
func (o OpenAIExtractor) Extract(ctx context.Context, q database.Querier, text string, ec ExtractContext) (*Extraction, error) {
	stored, err := appSettings(ctx, q, "openai_api_key", "openai_base_url", "openai_model")
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(firstSet(stored["openai_api_key"], o.Getenv("OPENAI_API_KEY")))
	if apiKey == "" {
		return nil, errors.New("API key OpenAI belum tersedia")
	}
	model := strings.TrimPrefix(firstSet(stored["openai_model"], "gpt-4o-mini"), "openai:")
	baseURL := strings.TrimSuffix(firstSet(stored["openai_base_url"], "https://api.openai.com/v1"), "/")
	client := o.Client
	if client == nil {
		client = safehttp.FromEnv(o.Getenv).Client(0)
	}
	ctxText := fmt.Sprintf("TODAY: %s\nSTEP: %s\nOUTLET: %s\nTREATMENT: %s\nTERAPIS: %s\nORANG: %d",
		ec.Today, ec.Step, strings.Join(ec.Outlets, " | "), strings.Join(ec.Treatments, " | "), strings.Join(ec.Therapists, " | "), ec.People)
	body := map[string]any{
		"model":           model,
		"temperature":     0,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []map[string]string{
			{"role": "system", "content": extractPrompt},
			{"role": "user", "content": ctxText + "\n\nPESAN: " + strings.TrimSpace(text)},
		},
	}
	if strings.HasPrefix(model, "gpt-5") {
		delete(body, "temperature")
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("OpenAI HTTP %d: %s", res.StatusCode, truncate(string(payload), 200))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, errors.New("jawaban OpenAI kosong")
	}
	var x Extraction
	if err := json.Unmarshal([]byte(out.Choices[0].Message.Content), &x); err != nil {
		return nil, fmt.Errorf("JSON ekstraksi tidak valid: %w", err)
	}
	return &x, nil
}

func appSettings(ctx context.Context, q database.Querier, keys ...string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k string
		var v *string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if v != nil {
			out[k] = *v
		}
	}
	return out, rows.Err()
}

func firstSet(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

const answerPrompt = `Kamu asisten WhatsApp spa Mizu. Jawab pertanyaan pelanggan dengan ramah dan singkat (maksimal 3 kalimat, boleh emoji seperlunya) dalam bahasa yang disebut di BAHASA JAWABAN, HANYA berdasarkan FAKTA di bawah. Jangan mengarang harga, jam, alamat, promo, atau kebijakan. Jika jawabannya tidak ada di FAKTA, balas persis: TIDAK_TAHU`

var _ Answerer = OpenAIExtractor{}

// Answer runs one short completion grounded on facts; "" when the model
// does not know (or on any error, so the bot falls back to "ask admin").
func (o OpenAIExtractor) Answer(ctx context.Context, q database.Querier, question, facts string) (string, error) {
	stored, err := appSettings(ctx, q, "openai_api_key", "openai_base_url", "openai_model")
	if err != nil {
		return "", err
	}
	apiKey := strings.TrimSpace(firstSet(stored["openai_api_key"], o.Getenv("OPENAI_API_KEY")))
	if apiKey == "" {
		return "", errors.New("API key OpenAI belum tersedia")
	}
	model := strings.TrimPrefix(firstSet(stored["openai_model"], "gpt-4o-mini"), "openai:")
	baseURL := strings.TrimSuffix(firstSet(stored["openai_base_url"], "https://api.openai.com/v1"), "/")
	client := o.Client
	if client == nil {
		client = safehttp.FromEnv(o.Getenv).Client(0)
	}
	body := map[string]any{
		"model": model, "temperature": 0.2, "max_tokens": 220,
		"messages": []map[string]string{
			{"role": "system", "content": answerPrompt},
			{"role": "user", "content": "FAKTA:\n" + facts + "\n\nPERTANYAAN: " + strings.TrimSpace(question)},
		},
	}
	if strings.HasPrefix(model, "gpt-5") {
		delete(body, "temperature")
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("OpenAI HTTP %d: %s", res.StatusCode, truncate(string(payload), 200))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &out); err != nil || len(out.Choices) == 0 {
		return "", errors.New("jawaban OpenAI kosong")
	}
	answer := strings.TrimSpace(out.Choices[0].Message.Content)
	if answer == "" || strings.Contains(strings.ToUpper(answer), "TIDAK_TAHU") {
		return "", nil
	}
	return answer, nil
}
