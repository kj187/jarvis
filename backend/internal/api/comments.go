package api

import (
	"net/http"
	"strconv"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

const (
	maxAuthorNameLen  = 100
	maxCommentBodyLen = 10_000
)

// GET /api/v1/alerts/:fingerprint/comments
func (s *Server) getComments(c echo.Context) error {
	fp, cluster, limit, offset, err := parseFingerprintClusterPagination(c)
	if err != nil {
		return err
	}
	if cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	comments, total, err := s.store.GetComments(fp, cluster, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get comments")
	}
	if comments == nil {
		comments = []models.Comment{}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"comments": comments,
		"total":    total,
	})
}

// POST /api/v1/alerts/:fingerprint/comments
func (s *Server) addComment(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")
	if cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	var body struct {
		AuthorName string `json:"authorName"`
		Body       string `json:"body"`
		EventID    *int64 `json:"eventId,omitempty"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.Body == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "body is required")
	}
	if len([]rune(body.Body)) > maxCommentBodyLen {
		return echo.NewHTTPError(http.StatusBadRequest, "body too long (max 10000 characters)")
	}

	authorName := body.AuthorName
	var userID *string
	if s.authProvider.Mode() == "none" {
		if authorName == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "authorName and body are required")
		}
	} else {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		authorName = u.Username
		userID = &u.ID
	}
	if len([]rune(authorName)) > maxAuthorNameLen {
		return echo.NewHTTPError(http.StatusBadRequest, "authorName too long (max 100 characters)")
	}

	comment, err := s.store.AddComment(fp, cluster, body.EventID, userID, authorName, body.Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to add comment")
	}

	s.broadcastAndFanout(c.Request().Context(), "comment_added", map[string]interface{}{
		"fingerprint": fp,
		"comment":     comment,
	}, fanout.Ref{Type: "comment_added", Fingerprint: fp, ClusterName: cluster, ID: strconv.FormatInt(comment.ID, 10)})

	return c.JSON(http.StatusCreated, comment)
}

// DELETE /api/v1/alerts/:fingerprint/comments/:id
func (s *Server) deleteComment(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")
	if cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comment id")
	}

	if s.authProvider.Mode() != "none" {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		comment, err := s.store.GetComment(fp, cluster, id)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to get comment")
		}
		if comment == nil {
			return echo.NewHTTPError(http.StatusNotFound, "comment not found")
		}
		// Prefer user_id comparison (robust against username changes).
		// Fall back to author_name for legacy comments that pre-date the user_id column.
		if comment.UserID != nil {
			if *comment.UserID != u.ID {
				return echo.NewHTTPError(http.StatusForbidden, "forbidden")
			}
		} else if comment.AuthorName != u.Username {
			return echo.NewHTTPError(http.StatusForbidden, "forbidden")
		}
	}

	deleted, err := s.store.DeleteComment(id, fp, cluster)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete comment")
	}
	if !deleted {
		return echo.NewHTTPError(http.StatusNotFound, "comment not found")
	}
	return c.NoContent(http.StatusNoContent)
}
