package spa

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Training struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	TopicCode        string `json:"topic_code"`
	Period           string `json:"period"`
	TrainingDate     string `json:"training_date"`
	TrainerName      string `json:"trainer_name"`
	Notes            string `json:"notes"`
	ParticipantCount int    `json:"participant_count"`
	PassedCount      int    `json:"passed_count"`
}

type TrainingParticipant struct {
	ID              string     `json:"id"`
	TrainingID      string     `json:"training_id"`
	TrainingName    string     `json:"training_name"`
	TopicCode       string     `json:"topic_code"`
	Period          string     `json:"period"`
	TrainingDate    string     `json:"training_date"`
	TrainerName     string     `json:"trainer_name"`
	TherapistID     string     `json:"therapist_id"`
	TherapistName   string     `json:"therapist_name"`
	EmploymentCycle int        `json:"employment_cycle"`
	Status          string     `json:"status"`
	Notes           string     `json:"notes"`
	ReviewedBy      *string    `json:"reviewed_by"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
}

type SimilarPass struct {
	Name   string `json:"name"`
	Period string `json:"period"`
}
type TrainingCandidate struct {
	TherapistID      string        `json:"therapist_id"`
	FullName         string        `json:"full_name"`
	BranchID         string        `json:"branch_id"`
	BranchName       string        `json:"branch_name"`
	Level            int           `json:"level"`
	EmploymentStatus string        `json:"employment_status"`
	IsActive         bool          `json:"is_active"`
	Status           string        `json:"status"`
	ReviewedAt       *time.Time    `json:"reviewed_at"`
	SimilarPasses    []SimilarPass `json:"similar_passes"`
	MissingTrainings []string      `json:"missing_trainings"`
	CanEnroll        bool          `json:"can_enroll"`
	Reason           string        `json:"reason"`
}

type LevelRequirements struct {
	Level1 []string `json:"level_1"`
	Level2 []string `json:"level_2"`
}
type LevelProgress struct {
	TargetLevel  int    `json:"target_level"`
	TrainingID   string `json:"training_id"`
	TrainingName string `json:"training_name"`
	Period       string `json:"period"`
	Passed       bool   `json:"passed"`
}
type LevelHistory struct {
	FromLevel       int       `json:"from_level"`
	ToLevel         int       `json:"to_level"`
	EmploymentCycle int       `json:"employment_cycle"`
	Reason          string    `json:"reason"`
	CreatedAt       time.Time `json:"created_at"`
}
type MyTrainings struct {
	Therapist      *Therapist            `json:"therapist"`
	Participations []TrainingParticipant `json:"participations"`
	Progress       []LevelProgress       `json:"progress"`
	History        []LevelHistory        `json:"history"`
}

func (store) trainings(ctx context.Context, q Q) ([]Training, error) {
	return many(ctx, q, func(r pgx.Row) (Training, error) {
		var x Training
		err := r.Scan(&x.ID, &x.Name, &x.TopicCode, &x.Period, &x.TrainingDate, &x.TrainerName, &x.Notes, &x.ParticipantCount, &x.PassedCount)
		return x, err
	}, `SELECT tr.id::text,tr.name,tr.topic_code,tr.period,tr.training_date::text,tr.trainer_name,tr.notes,
   count(DISTINCT p.therapist_id) FILTER(WHERE p.status<>'cancelled'),count(*) FILTER(WHERE p.status='passed')
   FROM spa.trainings tr LEFT JOIN spa.training_participants p ON p.training_id=tr.id
   GROUP BY tr.id ORDER BY tr.training_date DESC,tr.name,tr.period`)
}

func (store) trainingParticipants(ctx context.Context, q Q, trainingID, therapistID string) ([]TrainingParticipant, error) {
	return many(ctx, q, func(r pgx.Row) (TrainingParticipant, error) {
		var x TrainingParticipant
		err := r.Scan(&x.ID, &x.TrainingID, &x.TrainingName, &x.TopicCode, &x.Period, &x.TrainingDate, &x.TrainerName,
			&x.TherapistID, &x.TherapistName, &x.EmploymentCycle, &x.Status, &x.Notes, &x.ReviewedBy, &x.ReviewedAt)
		return x, err
	}, `SELECT p.id::text,tr.id::text,tr.name,tr.topic_code,tr.period,tr.training_date::text,tr.trainer_name,
   t.id::text,e.full_name,p.employment_cycle,p.status,p.notes,u.full_name,p.reviewed_at
   FROM spa.training_participants p JOIN spa.trainings tr ON tr.id=p.training_id
   JOIN spa.therapists t ON t.id=p.therapist_id JOIN hris.employees e ON e.id=t.employee_id
   LEFT JOIN configuration.users u ON u.id=p.reviewed_by
   WHERE ($1='' OR p.training_id=NULLIF($1,'')::uuid) AND ($2='' OR p.therapist_id=NULLIF($2,'')::uuid)
   ORDER BY tr.training_date DESC,e.full_name,p.created_at DESC`, trainingID, therapistID)
}

func (store) trainingCandidates(ctx context.Context, q Q, id string) ([]TrainingCandidate, error) {
	list, err := many(ctx, q, func(r pgx.Row) (TrainingCandidate, error) {
		var x TrainingCandidate
		err := r.Scan(&x.TherapistID, &x.FullName, &x.BranchID, &x.BranchName, &x.Level, &x.EmploymentStatus, &x.IsActive,
			&x.Status, &x.ReviewedAt, &x.SimilarPasses, &x.MissingTrainings)
		x.CanEnroll = x.IsActive && x.EmploymentStatus != "resigned" && x.Status != "passed" && x.Status != "enrolled" && x.Status != "pending"
		switch {
		case x.Status == "passed":
			x.Reason = "Sudah lulus"
		case x.EmploymentStatus == "resigned":
			x.Reason = "Resign"
		case !x.IsActive:
			x.Reason = "Nonaktif"
		case x.Status == "enrolled":
			x.Reason = "Sudah terdaftar"
		case x.Status == "pending":
			x.Reason = "Menunggu persetujuan"
		}
		return x, err
	}, `SELECT t.id::text,e.full_name,b.id::text,b.name,t.level,e.employment_status,
   t.is_active AND COALESCE(e.is_active,true) AND NOT t.rehire_pending,
   COALESCE(latest.status,''),latest.reviewed_at,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('name',tr.name,'period',tr.period))
     FROM spa.training_participants p JOIN spa.trainings tr ON tr.id=p.training_id
     WHERE p.therapist_id=t.id AND p.status='passed' AND tr.topic_code=selected.topic_code AND tr.id<>selected.id),'[]'::jsonb),
   ARRAY(SELECT tr.name||' ('||tr.period||')' FROM spa.level_requirements req JOIN spa.trainings tr ON tr.id=req.training_id
     WHERE req.target_level=t.level+1 AND NOT EXISTS(SELECT 1 FROM spa.training_participants p
       WHERE p.therapist_id=t.id AND p.training_id=req.training_id AND p.employment_cycle=t.employment_cycle AND p.status='passed') ORDER BY tr.name)
   FROM spa.therapists t JOIN hris.employees e ON e.id=t.employee_id
   JOIN configuration.branches b ON b.id=t.home_branch_id CROSS JOIN spa.trainings selected
   LEFT JOIN LATERAL(SELECT p.status,p.reviewed_at FROM spa.training_participants p WHERE p.training_id=selected.id AND p.therapist_id=t.id
     ORDER BY CASE p.status WHEN 'passed' THEN 0 WHEN 'enrolled' THEN 1 WHEN 'pending' THEN 1 ELSE 2 END,p.created_at DESC LIMIT 1) latest ON true
   WHERE selected.id=$1 ORDER BY e.full_name`, id)
	return list, err
}

func (store) levelRequirements(ctx context.Context, q Q) (LevelRequirements, error) {
	out := LevelRequirements{Level1: []string{}, Level2: []string{}}
	rows, err := q.Query(ctx, `SELECT target_level,training_id::text FROM spa.level_requirements ORDER BY target_level,training_id`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var target int
		var id string
		if err := rows.Scan(&target, &id); err != nil {
			return out, err
		}
		if target == 1 {
			out.Level1 = append(out.Level1, id)
		} else {
			out.Level2 = append(out.Level2, id)
		}
	}
	return out, rows.Err()
}

func (store) levelProgress(ctx context.Context, q Q, id string) ([]LevelProgress, error) {
	return many(ctx, q, func(r pgx.Row) (LevelProgress, error) {
		var x LevelProgress
		err := r.Scan(&x.TargetLevel, &x.TrainingID, &x.TrainingName, &x.Period, &x.Passed)
		return x, err
	}, `SELECT req.target_level,tr.id::text,tr.name,tr.period,EXISTS(SELECT 1 FROM spa.training_participants p
   WHERE p.therapist_id=t.id AND p.training_id=tr.id AND p.status='passed' AND p.employment_cycle=t.employment_cycle)
   FROM spa.level_requirements req JOIN spa.trainings tr ON tr.id=req.training_id CROSS JOIN spa.therapists t
   WHERE t.id=$1 ORDER BY req.target_level,tr.name`, id)
}

func (store) levelHistory(ctx context.Context, q Q, id string) ([]LevelHistory, error) {
	return many(ctx, q, func(r pgx.Row) (LevelHistory, error) {
		var x LevelHistory
		err := r.Scan(&x.FromLevel, &x.ToLevel, &x.EmploymentCycle, &x.Reason, &x.CreatedAt)
		return x, err
	}, `SELECT from_level,to_level,employment_cycle,reason,created_at FROM spa.therapist_level_history WHERE therapist_id=$1 ORDER BY created_at DESC`, id)
}
