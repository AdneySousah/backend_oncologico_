import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  // Verificação do certificado do servidor SMTP ligada (padrão do nodemailer). Antes estava
  // desligada (rejectUnauthorized: false), o que permitia interceptar os e-mails com código
  // de senha e links de termo. Conferido em 16/11/2026: o certificado do servidor é válido.
});

class Mail {
  sendMail(message) {
    return transporter.sendMail({
      ...message,
      from: `"CicFarma" <${process.env.MAIL_USER}>`,
    });
  }
}

export default new Mail();