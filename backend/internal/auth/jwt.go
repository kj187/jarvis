package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const jwtTTL = 24 * time.Hour

type jarvisClaims struct {
	jwt.RegisteredClaims
	Name     string `json:"name"`
	Role     string `json:"role"`
	Provider string `json:"provider"`
}

var (
	revokedMu     sync.Mutex
	revokedTokens = make(map[string]time.Time)
)

// CreateToken signs a JWT for the given user.
func CreateToken(secretKey []byte, user *User) (string, error) {
	now := time.Now()
	tokenID, err := newTokenID()
	if err != nil {
		return "", err
	}
	c := jarvisClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(jwtTTL)),
			ID:        tokenID,
		},
		Name:     user.Username,
		Role:     user.Role,
		Provider: user.Provider,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return tok.SignedString(secretKey)
}

// ValidateToken parses and validates a JWT, returning the embedded User.
func ValidateToken(secretKey []byte, tokenString string) (*User, error) {
	var c jarvisClaims
	tok, err := jwt.ParseWithClaims(tokenString, &c, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secretKey, nil
	})
	if err != nil {
		return nil, err
	}
	if !tok.Valid {
		return nil, errors.New("invalid token")
	}
	if isTokenRevoked(c.ID) {
		return nil, errors.New("token revoked")
	}
	return &User{
		ID:       c.Subject,
		Username: c.Name,
		Role:     c.Role,
		Provider: c.Provider,
	}, nil
}

// RevokeToken marks a signed JWT as revoked until its expiry time.
func RevokeToken(secretKey []byte, tokenString string) error {
	var c jarvisClaims
	tok, err := jwt.ParseWithClaims(tokenString, &c, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secretKey, nil
	})
	if err != nil {
		return err
	}
	if !tok.Valid {
		return errors.New("invalid token")
	}
	if c.ID == "" || c.ExpiresAt == nil {
		return errors.New("token missing id or expiry")
	}

	revokedMu.Lock()
	defer revokedMu.Unlock()
	cleanupExpiredRevocationsLocked(time.Now())
	revokedTokens[c.ID] = c.ExpiresAt.Time
	return nil
}

func isTokenRevoked(tokenID string) bool {
	if tokenID == "" {
		return false
	}
	revokedMu.Lock()
	defer revokedMu.Unlock()
	now := time.Now()
	cleanupExpiredRevocationsLocked(now)
	expiresAt, ok := revokedTokens[tokenID]
	return ok && now.Before(expiresAt)
}

func cleanupExpiredRevocationsLocked(now time.Time) {
	for tokenID, expiresAt := range revokedTokens {
		if !now.Before(expiresAt) {
			delete(revokedTokens, tokenID)
		}
	}
}

func newTokenID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token id: %w", err)
	}
	return hex.EncodeToString(b), nil
}
