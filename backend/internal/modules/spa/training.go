package spa

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Serialize training writes so a concurrent settings edit and approval evaluate
// one coherent rule set. HRIS lifecycle writes synchronize on employee rows.
func trainingLock(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(260926,1)`)
	return err
}

func (s *Service) Trainings(ctx context.Context) ([]Training, error) {
	return s.st.trainings(ctx, s.db)
}

func (s *Service) SaveTraining(ctx context.Context, userID, id string, in Training) (*Training, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.TopicCode = strings.ToUpper(strings.TrimSpace(in.TopicCode))
	in.Period = strings.TrimSpace(in.Period)
	in.TrainerName = strings.TrimSpace(in.TrainerName)
	in.Notes = strings.TrimSpace(in.Notes)
	if in.Name == "" || len(in.Name) > 150 || in.TopicCode == "" || len(in.TopicCode) > 80 || in.Period == "" || len(in.Period) > 80 || in.TrainerName == "" || len(in.TrainerName) > 150 || len(in.Notes) > 2000 {
		return nil, httpx.BadRequest("Nama, kode materi, periode dan trainer wajib diisi sesuai batas panjang")
	}
	if _, err := time.Parse("2006-01-02", in.TrainingDate); err != nil {
		return nil, httpx.BadRequest("Tanggal training tidak valid")
	}
	err := s.tx(ctx, func(q Q) error {
		if err := trainingLock(ctx, q); err != nil {
			return err
		}
		if id == "" {
			return q.QueryRow(ctx, `INSERT INTO spa.trainings(name,topic_code,period,training_date,trainer_name,notes,created_by)
    VALUES($1,$2,$3,$4::date,$5,$6,$7::uuid) RETURNING id::text`, in.Name, in.TopicCode, in.Period, in.TrainingDate, in.TrainerName, in.Notes, userID).Scan(&id)
		}
		var participants bool
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM spa.training_participants WHERE training_id=$1)`, id).Scan(&participants); err != nil {
			return err
		}
		if participants {
			var same bool
			if err := q.QueryRow(ctx, `SELECT topic_code=$2 AND period=$3 FROM spa.trainings WHERE id=$1`, id, in.TopicCode, in.Period).Scan(&same); err != nil {
				return err
			}
			if !same {
				return httpx.Conflict("Kode materi dan periode tidak dapat diubah setelah ada peserta; buat training baru")
			}
		}
		tag, err := q.Exec(ctx, `UPDATE spa.trainings SET name=$2,topic_code=$3,period=$4,training_date=$5::date,trainer_name=$6,notes=$7,updated_at=now() WHERE id=$1`, id, in.Name, in.TopicCode, in.Period, in.TrainingDate, in.TrainerName, in.Notes)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.NotFound("Training tidak ditemukan")
		}
		return err
	})
	if database.IsUniqueViolation(err) {
		return nil, httpx.Conflict("Kode materi dan periode sudah digunakan; pilih training yang ada")
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.Trainings(ctx)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.ID == id {
			return &r, nil
		}
	}
	return nil, httpx.NotFound("Training tidak ditemukan")
}

func trainingExists(ctx context.Context, q Q, id string) error {
	var found bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM spa.trainings WHERE id=$1)`, id).Scan(&found); err != nil {
		return err
	}
	if !found {
		return httpx.NotFound("Training tidak ditemukan")
	}
	return nil
}
func (s *Service) TrainingParticipants(ctx context.Context, id string) ([]TrainingParticipant, error) {
	if err := trainingExists(ctx, s.db, id); err != nil {
		return nil, err
	}
	return s.st.trainingParticipants(ctx, s.db, id, "")
}
func (s *Service) TrainingCandidates(ctx context.Context, id string) ([]TrainingCandidate, error) {
	if err := trainingExists(ctx, s.db, id); err != nil {
		return nil, err
	}
	return s.st.trainingCandidates(ctx, s.db, id)
}

// Lock the employee before the therapist, matching the HRIS update trigger.
func lockTrainingTherapist(ctx context.Context, q Q, id string) (int, error) {
	cycle, active, err := lockTrainingTherapistState(ctx, q, id)
	if err != nil {
		return 0, err
	}
	if !active {
		return 0, httpx.Conflict("Terapis nonaktif atau resign tidak dapat mengikuti training atau menerima kelulusan")
	}
	return cycle, nil
}

func lockTrainingTherapistState(ctx context.Context, q Q, id string) (int, bool, error) {
	var emp string
	err := q.QueryRow(ctx, `SELECT employee_id::text FROM spa.therapists WHERE id=$1`, id).Scan(&emp)
	if database.IsNoRows(err) {
		return 0, false, httpx.NotFound("Terapis tidak ditemukan")
	}
	if err != nil {
		return 0, false, err
	}
	var active bool
	var status string
	if err = q.QueryRow(ctx, `SELECT COALESCE(is_active,true),employment_status FROM hris.employees WHERE id=$1 FOR UPDATE`, emp).Scan(&active, &status); err != nil {
		return 0, false, err
	}
	var cycle int
	var enabled, pending bool
	if err = q.QueryRow(ctx, `SELECT employment_cycle,is_active,rehire_pending FROM spa.therapists WHERE id=$1 FOR UPDATE`, id).Scan(&cycle, &enabled, &pending); err != nil {
		return 0, false, err
	}
	return cycle, active && enabled && !pending && status != "resigned", nil
}

func (s *Service) EnrollTraining(ctx context.Context, userID, id string, ids []string) ([]TrainingParticipant, error) {
	if len(ids) == 0 || len(ids) > 200 {
		return nil, httpx.BadRequest("Pilih 1–200 peserta")
	}
	seen := map[string]bool{}
	for _, tid := range ids {
		if !validate.IsUUID(tid) || seen[tid] {
			return nil, httpx.BadRequest("ID peserta tidak valid atau duplikat")
		}
		seen[tid] = true
	}
	err := s.tx(ctx, func(q Q) error {
		if err := trainingLock(ctx, q); err != nil {
			return err
		}
		if err := trainingExists(ctx, q, id); err != nil {
			return err
		}
		for _, tid := range ids {
			cycle, err := lockTrainingTherapist(ctx, q, tid)
			if err != nil {
				return err
			}
			var blocked bool
			if err = q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM spa.training_participants WHERE training_id=$1 AND therapist_id=$2 AND status IN ('enrolled','pending','passed'))`, id, tid).Scan(&blocked); err != nil {
				return err
			}
			if blocked {
				return httpx.Conflict("Peserta sudah terdaftar, menunggu persetujuan, atau sudah lulus training ini")
			}
			if _, err = q.Exec(ctx, `INSERT INTO spa.training_participants(training_id,therapist_id,employment_cycle,created_by) VALUES($1,$2,$3,$4)`, id, tid, cycle, userID); err != nil {
				return err
			}
		}
		return nil
	})
	if database.IsUniqueViolation(err) {
		return nil, httpx.Conflict("Peserta sudah terdaftar atau sudah lulus")
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.st.trainingParticipants(ctx, s.db, id, "")
	out := []TrainingParticipant{}
	for _, p := range rows {
		if seen[p.TherapistID] && p.Status == "enrolled" {
			out = append(out, p)
		}
	}
	return out, err
}

func (s *Service) ReviewTraining(ctx context.Context, userID, id, status, notes string) error {
	if status != "pending" && status != "passed" && status != "failed" && status != "cancelled" {
		return httpx.BadRequest("Status training tidak valid")
	}
	notes = strings.TrimSpace(notes)
	if len(notes) > 2000 {
		return httpx.BadRequest("Catatan maksimal 2000 karakter")
	}
	if (status == "passed" || status == "failed") && notes == "" {
		return httpx.BadRequest("Catatan hasil penilaian trainer wajib diisi")
	}
	return s.tx(ctx, func(q Q) error {
		if err := trainingLock(ctx, q); err != nil {
			return err
		}
		var tid string
		var enrolledCycle int
		err := q.QueryRow(ctx, `SELECT therapist_id::text,employment_cycle FROM spa.training_participants WHERE id=$1`, id).Scan(&tid, &enrolledCycle)
		if database.IsNoRows(err) {
			return httpx.NotFound("Peserta tidak ditemukan")
		}
		if err != nil {
			return err
		}
		cycle, err := lockTrainingTherapist(ctx, q, tid)
		if err != nil {
			return err
		}
		if cycle != enrolledCycle {
			return httpx.Conflict("Keikutsertaan berasal dari periode kerja sebelumnya")
		}
		var old string
		if err = q.QueryRow(ctx, `SELECT status FROM spa.training_participants WHERE id=$1 FOR UPDATE`, id).Scan(&old); err != nil {
			return err
		}
		if old == status {
			return nil
		}
		if old == "passed" || old == "failed" || old == "cancelled" {
			return httpx.Conflict("Hasil sudah final; training yang lulus tidak dapat diulang")
		}
		_, err = q.Exec(ctx, `UPDATE spa.training_participants SET status=$2,notes=$3,reviewed_by=$4,reviewed_at=clock_timestamp(),updated_at=now() WHERE id=$1`, id, status, notes, userID)
		if err != nil {
			return err
		}
		if status == "passed" {
			return s.promoteTherapist(ctx, q, tid, userID)
		}
		return nil
	})
}

func (s *Service) LevelRequirements(ctx context.Context) (LevelRequirements, error) {
	return s.st.levelRequirements(ctx, s.db)
}
func (s *Service) SaveLevelRequirements(ctx context.Context, userID string, in LevelRequirements) error {
	if in.Level1 == nil || in.Level2 == nil || len(in.Level1) > 100 || len(in.Level2) > 100 {
		return httpx.BadRequest("Kedua daftar syarat wajib dikirim (maksimal 100 training per level)")
	}
	for _, ids := range [][]string{in.Level1, in.Level2} {
		seen := map[string]bool{}
		for _, id := range ids {
			if !validate.IsUUID(id) || seen[id] {
				return httpx.BadRequest("Training syarat tidak valid atau duplikat")
			}
			seen[id] = true
		}
	}
	return s.tx(ctx, func(q Q) error {
		if err := trainingLock(ctx, q); err != nil {
			return err
		}
		for _, ids := range [][]string{in.Level1, in.Level2} {
			for _, id := range ids {
				if err := trainingExists(ctx, q, id); err != nil {
					return httpx.BadRequest("Training syarat tidak ditemukan")
				}
			}
		}
		if _, err := q.Exec(ctx, `DELETE FROM spa.level_requirements`); err != nil {
			return err
		}
		for i, ids := range [][]string{in.Level1, in.Level2} {
			for _, id := range ids {
				if _, err := q.Exec(ctx, `INSERT INTO spa.level_requirements(target_level,training_id,updated_by) VALUES($1,$2,$3)`, i+1, id, userID); err != nil {
					return err
				}
			}
		}
		// Include inactive rows: a concurrent HRIS reactivation may be uncommitted
		// when this list is read. Decide eligibility only after taking its row lock.
		ids, err := many(ctx, q, func(r pgx.Row) (string, error) { var id string; err := r.Scan(&id); return id, err }, `SELECT id::text FROM spa.therapists ORDER BY id`)
		if err != nil {
			return err
		}
		for _, id := range ids {
			_, active, err := lockTrainingTherapistState(ctx, q, id)
			if err != nil {
				return err
			}
			if !active {
				continue
			}
			if err := s.promoteTherapist(ctx, q, id, userID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) promoteTherapist(ctx context.Context, q Q, id, userID string) error {
	_, err := q.Exec(ctx, `SELECT spa.promote_therapist($1::uuid, NULLIF($2,'')::uuid)`, id, userID)
	return err
}

func (s *Service) MyTrainings(ctx context.Context, userID string) (MyTrainings, error) {
	out := MyTrainings{Participations: []TrainingParticipant{}, Progress: []LevelProgress{}, History: []LevelHistory{}}
	t, err := s.Me(ctx, userID)
	if err != nil {
		return out, err
	}
	out.Therapist = t
	if t == nil {
		return out, nil
	}
	out.Participations, err = s.st.trainingParticipants(ctx, s.db, "", t.ID)
	if err != nil {
		return out, err
	}
	out.Progress, err = s.st.levelProgress(ctx, s.db, t.ID)
	if err != nil {
		return out, err
	}
	out.History, err = s.st.levelHistory(ctx, s.db, t.ID)
	return out, err
}
