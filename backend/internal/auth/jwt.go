package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const jwtTTL = 24 * time.Hour

type jarvisClaims struct {
	jwt.RegisteredClaims
	Name     string `json:"name"`
	Role     string `json:"role"`
	Provider string `json:"provider"`
	// TV is the user's token_version at issue time; 0 for tokens that predate it.
	TV int `json:"tv"`
}

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
		TV:       user.TokenVersion,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return tok.SignedString(secretKey)
}

// ParseToken verifies signature and expiry and returns the claims as a User.
// It does not consult the database: whether the session is still valid (user
// exists, token version current) is SessionVerifier's job.
func ParseToken(secretKey []byte, tokenString string) (*User, error) {
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
	return &User{
		ID:           c.Subject,
		Username:     c.Name,
		Role:         c.Role,
		Provider:     c.Provider,
		TokenVersion: c.TV,
	}, nil
}

func newTokenID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token id: %w", err)
	}
	return hex.EncodeToString(b), nil
}
