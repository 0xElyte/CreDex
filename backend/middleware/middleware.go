package middleware

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start  := time.Now()
		path   := c.Request.URL.Path
		method := c.Request.Method
		c.Next()
		status  := c.Writer.Status()
		latency := time.Since(start)

		color := "\033[32m"
		if status >= 500 { color = "\033[31m" } else if status >= 400 { color = "\033[33m" }

		fmt.Printf("[CreDex] %s | %s%d\033[0m | %10v | %-6s %s\n",
			time.Now().Format("2006/01/02 15:04:05"), color, status, latency, method, path)
	}
}
