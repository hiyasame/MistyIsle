package utils

import (
	"bytes"
	"fmt"
	"html/template"
	"mime"
	"net/smtp"
	"strings"

	"misty-isle/cfg"
)

// EmailClient 邮件客户端
type EmailClient struct {
	cfg *cfg.Config
}

// NewEmailClient 创建邮件客户端
func NewEmailClient(cfg *cfg.Config) *EmailClient {
	return &EmailClient{cfg: cfg}
}

// SendEmail 发送纯文本邮件
func (e *EmailClient) SendEmail(to []string, subject, body string) error {
	if !e.IsConfigured() {
		return fmt.Errorf("email not configured")
	}

	from := e.cfg.SMTPUsername
	fromHeader := from
	if e.cfg.SMTPFrom != "" {
		// MIME 编码显示名称，符合 RFC5322/RFC2047
		encodedName := mime.QEncoding.Encode("UTF-8", e.cfg.SMTPFrom)
		fromHeader = fmt.Sprintf("%s <%s>", encodedName, from)
	}

	// 构建邮件内容
	msg := []byte(fmt.Sprintf(
		"To: %s\r\n"+
			"From: %s\r\n"+
			"Subject: %s\r\n"+
			"Content-Type: text/plain; charset=UTF-8\r\n"+
			"\r\n"+
			"%s",
		strings.Join(to, ","),
		fromHeader,
		subject,
		body,
	))

	addr := fmt.Sprintf("%s:%d", e.cfg.SMTPHost, e.cfg.SMTPPort)
	auth := smtp.PlainAuth("", e.cfg.SMTPUsername, e.cfg.SMTPPassword, e.cfg.SMTPHost)

	return smtp.SendMail(addr, auth, e.cfg.SMTPUsername, to, msg)
}

// SendHTMLEmail 发送 HTML 邮件
func (e *EmailClient) SendHTMLEmail(to []string, subject, htmlBody string) error {
	if !e.IsConfigured() {
		return fmt.Errorf("email not configured")
	}

	from := e.cfg.SMTPUsername
	fromHeader := from
	if e.cfg.SMTPFrom != "" {
		// MIME 编码显示名称，符合 RFC5322/RFC2047
		encodedName := mime.QEncoding.Encode("UTF-8", e.cfg.SMTPFrom)
		fromHeader = fmt.Sprintf("%s <%s>", encodedName, from)
	}

	// 构建邮件内容
	msg := []byte(fmt.Sprintf(
		"To: %s\r\n"+
			"From: %s\r\n"+
			"Subject: %s\r\n"+
			"Content-Type: text/html; charset=UTF-8\r\n"+
			"\r\n"+
			"%s",
		strings.Join(to, ","),
		fromHeader,
		subject,
		htmlBody,
	))

	addr := fmt.Sprintf("%s:%d", e.cfg.SMTPHost, e.cfg.SMTPPort)
	auth := smtp.PlainAuth("", e.cfg.SMTPUsername, e.cfg.SMTPPassword, e.cfg.SMTPHost)

	return smtp.SendMail(addr, auth, e.cfg.SMTPUsername, to, msg)
}

// SendTemplateEmail 使用模板发送邮件
func (e *EmailClient) SendTemplateEmail(to []string, subject, tmpl string, data interface{}) error {
	t, err := template.New("email").Parse(tmpl)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	return e.SendHTMLEmail(to, subject, buf.String())
}

// IsConfigured 检查邮件是否已配置
func (e *EmailClient) IsConfigured() bool {
	return e.cfg.SMTPUsername != "" && e.cfg.SMTPPassword != ""
}

// ============ 常用邮件模板 ============

// VerificationCodeTemplate 验证码邮件模板
const VerificationCodeTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
        .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .code { font-size: 32px; font-weight: bold; color: #4CAF50; text-align: center; padding: 20px; letter-spacing: 5px; }
        .footer { padding: 20px; text-align: center; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{.AppName}}</h1>
        </div>
        <div class="content">
            <p>您好，</p>
            <p>您的验证码是：</p>
            <div class="code">{{.Code}}</div>
            <p>验证码将在 {{.ExpireMinutes}} 分钟后过期，请勿泄露给他人。</p>
        </div>
        <div class="footer">
            <p>如非本人操作，请忽略此邮件。</p>
        </div>
    </div>
</body>
</html>`

// SendVerificationCode 发送验证码邮件
func (e *EmailClient) SendVerificationCode(to, code string, expireMinutes int) error {
	data := struct {
		AppName       string
		Code          string
		ExpireMinutes int
	}{
		AppName:       "Misty Isle",
		Code:          code,
		ExpireMinutes: expireMinutes,
	}

	return e.SendTemplateEmail(
		[]string{to},
		"【Misty Isle】验证码",
		VerificationCodeTemplate,
		data,
	)
}

// PasswordResetTemplate 密码重置邮件模板
const PasswordResetTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
        .header { background: #2196F3; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { display: inline-block; padding: 12px 30px; background: #2196F3; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; color: #999; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>密码重置</h1>
        </div>
        <div class="content">
            <p>您好，</p>
            <p>您申请了密码重置，请点击下方按钮完成操作：</p>
            <p style="text-align: center;">
                <a href="{{.ResetURL}}" class="button">重置密码</a>
            </p>
            <p>或复制链接到浏览器打开：</p>
            <p style="word-break: break-all; color: #666;">{{.ResetURL}}</p>
            <p>链接将在 {{.ExpireHours}} 小时后过期。</p>
        </div>
        <div class="footer">
            <p>如非本人操作，请忽略此邮件。</p>
        </div>
    </div>
</body>
</html>`

// SendPasswordReset 发送密码重置邮件
func (e *EmailClient) SendPasswordReset(to, resetURL string, expireHours int) error {
	data := struct {
		ResetURL    string
		ExpireHours int
	}{
		ResetURL:    resetURL,
		ExpireHours: expireHours,
	}

	return e.SendTemplateEmail(
		[]string{to},
		"【Misty Isle】密码重置",
		PasswordResetTemplate,
		data,
	)
}
