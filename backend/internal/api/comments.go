package api

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/kj187/jarvis/backend/internal/models"
)

// GET /api/v1/alerts/:fingerprint/comments
func (s *Server) getComments(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	comments, err := s.store.GetComments(fp)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get comments")
	}
	if comments == nil {
		comments = []models.Comment{}
	}
	return c.JSON(http.StatusOK, comments)
}

// POST /api/v1/alerts/:fingerprint/comments
func (s *Server) addComment(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	var body struct {
		AuthorName string `json:"authorName"`
		Body       string `json:"body"`
		EventID    *int64 `json:"eventId,omitempty"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.AuthorName == "" || body.Body == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "authorName and body are required")
	}

	comment, err := s.store.AddComment(fp, body.EventID, body.AuthorName, body.Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to add comment")
	}

	s.hub.BroadcastJSON("comment_added", map[string]interface{}{
		"fingerprint": fp,
		"comment":     comment,
	})

	return c.JSON(http.StatusCreated, comment)
}

// DELETE /api/v1/alerts/:fingerprint/comments/:id
func (s *Server) deleteComment(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comment id")
	}

	deleted, err := s.store.DeleteComment(id)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete comment")
	}
	if !deleted {
		return echo.NewHTTPError(http.StatusNotFound, "comment not found")
	}
	return c.NoContent(http.StatusNoContent)
}
