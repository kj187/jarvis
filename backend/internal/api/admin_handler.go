package api

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/users"
)

// adminUser is the JSON representation of a user for the admin API.
type adminUser struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	Email       *string `json:"email"`
	Role        string  `json:"role"`
	Provider    string  `json:"provider"`
	CreatedAt   string  `json:"createdAt"`
	LastLoginAt *string `json:"lastLoginAt"`
}

func toAdminUser(u *users.User) adminUser {
	var email *string
	if u.Email != "" {
		e := u.Email
		email = &e
	}
	var lastLogin *string
	if u.LastLoginAt != nil {
		s := u.LastLoginAt.Format("2006-01-02T15:04:05Z07:00")
		lastLogin = &s
	}
	return adminUser{
		ID:          u.ID,
		Username:    u.Username,
		Email:       email,
		Role:        u.Role,
		Provider:    u.Provider,
		CreatedAt:   u.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		LastLoginAt: lastLogin,
	}
}

// GET /api/v1/admin/users
func (s *Server) listUsers(c echo.Context) error {
	list, err := s.userStore.List(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	out := make([]adminUser, 0, len(list))
	for _, u := range list {
		out = append(out, toAdminUser(u))
	}
	return c.JSON(http.StatusOK, out)
}

// createUserRequest is the body for POST /api/v1/admin/users.
type createUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// POST /api/v1/admin/users
func (s *Server) createUser(c echo.Context) error {
	var req createUserRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	if !usernameRe.MatchString(req.Username) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid username")
	}
	if len(req.Password) < 12 {
		return echo.NewHTTPError(http.StatusBadRequest, "password must be at least 12 characters")
	}
	if req.Role != "user" && req.Role != "admin" {
		req.Role = "user"
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}

	u, err := s.userStore.Create(c.Request().Context(), &users.CreateUser{
		Username:     req.Username,
		Role:         req.Role,
		Provider:     "internal",
		PasswordHash: hash,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusConflict, "username already exists")
	}
	return c.JSON(http.StatusCreated, toAdminUser(u))
}

// patchUserRequest is the body for PATCH /api/v1/admin/users/:id.
type patchUserRequest struct {
	Role string `json:"role"`
}

// PATCH /api/v1/admin/users/:id
func (s *Server) updateUser(c echo.Context) error {
	id := c.Param("id")
	if !isValidUUID(id) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid user id")
	}

	caller := auth.UserFromContext(c)
	if caller != nil && caller.ID == id {
		return echo.NewHTTPError(http.StatusForbidden, "cannot update your own role")
	}

	var req patchUserRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	if req.Role != "user" && req.Role != "admin" {
		return echo.NewHTTPError(http.StatusBadRequest, "role must be 'user' or 'admin'")
	}

	if err := s.userStore.UpdateRole(c.Request().Context(), id, req.Role); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	u, _ := s.userStore.GetByID(c.Request().Context(), id)
	if u == nil {
		return echo.NewHTTPError(http.StatusNotFound)
	}
	return c.JSON(http.StatusOK, toAdminUser(u))
}

// DELETE /api/v1/admin/users/:id
func (s *Server) deleteUser(c echo.Context) error {
	id := c.Param("id")
	if !isValidUUID(id) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid user id")
	}

	caller := auth.UserFromContext(c)
	if caller != nil && caller.ID == id {
		return echo.NewHTTPError(http.StatusForbidden, "cannot delete yourself")
	}

	if err := s.userStore.Delete(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError)
	}
	return c.NoContent(http.StatusNoContent)
}

func isValidUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}
