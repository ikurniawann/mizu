package spa

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

type TreatmentCategory struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	TreatmentCount int    `json:"treatment_count"`
}

func (store) categories(ctx context.Context, q Q) ([]TreatmentCategory, error) {
	return many(ctx, q, func(r pgx.Row) (TreatmentCategory, error) {
		var c TreatmentCategory
		err := r.Scan(&c.ID, &c.Name, &c.TreatmentCount)
		return c, err
	}, `SELECT c.id::text, c.name, count(t.id)::int
	  FROM spa.treatment_categories c LEFT JOIN spa.treatments t ON t.category = c.name
	 WHERE c.name <> '' GROUP BY c.id ORDER BY c.name`)
}

func (store) category(ctx context.Context, q Q, id string) (*TreatmentCategory, error) {
	var c TreatmentCategory
	err := q.QueryRow(ctx, `SELECT c.id::text, c.name, count(t.id)::int
	  FROM spa.treatment_categories c LEFT JOIN spa.treatments t ON t.category = c.name
	 WHERE c.id = $1 AND c.name <> '' GROUP BY c.id`, id).Scan(&c.ID, &c.Name, &c.TreatmentCount)
	return one(&c, err)
}

func (s *Service) Categories(ctx context.Context) ([]TreatmentCategory, error) {
	return s.st.categories(ctx, s.db)
}

func categoryError(err error) error {
	if database.IsUniqueViolation(err) {
		return httpx.Conflict("Nama kategori sudah dipakai")
	}
	if database.PgCode(err) == "23503" {
		return httpx.Conflict("Kategori masih dipakai oleh treatment")
	}
	return err
}

func (s *Service) CreateCategory(ctx context.Context, name string) (*TreatmentCategory, error) {
	var id string
	err := s.tx(ctx, func(q Q) error {
		return q.QueryRow(ctx, `INSERT INTO spa.treatment_categories (name) VALUES ($1) RETURNING id::text`, name).Scan(&id)
	})
	if err != nil {
		return nil, categoryError(err)
	}
	return s.st.category(ctx, s.db, id)
}

func (s *Service) UpdateCategory(ctx context.Context, id, name string) (*TreatmentCategory, error) {
	var updatedID string
	err := s.tx(ctx, func(q Q) error {
		return q.QueryRow(ctx, `UPDATE spa.treatment_categories SET name = $2, updated_at = now()
	  WHERE id = $1 AND name <> '' RETURNING id::text`, id, name).Scan(&updatedID)
	})
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Kategori tidak ditemukan")
	}
	if err != nil {
		return nil, categoryError(err)
	}
	return s.st.category(ctx, s.db, updatedID)
}

func (s *Service) DeleteCategory(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM spa.treatment_categories
	  WHERE id = $1 AND name <> '' AND NOT EXISTS
	    (SELECT 1 FROM spa.treatments WHERE category = spa.treatment_categories.name)`, id)
	if err != nil {
		return categoryError(err)
	}
	if tag.RowsAffected() != 0 {
		return nil
	}
	category, err := s.st.category(ctx, s.db, id)
	if err != nil {
		return err
	}
	if category == nil {
		return httpx.NotFound("Kategori tidak ditemukan")
	}
	return httpx.Conflict("Kategori masih dipakai oleh treatment")
}
