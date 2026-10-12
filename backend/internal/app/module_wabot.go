package app

import (
	"nuhabit/backend/internal/modules/wabot"
	"nuhabit/backend/internal/platform/module"
)

// wabot: the WhatsApp booking chatbot (EPIC-053) — inbox session view,
// bot on/off per conversation and the staff simulator. The gateway
// webhook reaches the same engine through integrationsWebhookPorts.
func init() {
	Register(wabot.Name, func(d module.Deps) module.Module {
		return wabot.New(d, waBotPorts(d))
	})
}
