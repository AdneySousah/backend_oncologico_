import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: process.env.MAIL_SECURE === 'true', // true para 465, false para outras portas
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});

class Mail {
  sendMail(message) {
    return transporter.sendMail({
      ...message,
      from: `"Onco Navegador" <${process.env.MAIL_USER}>`,
    });
  }
}

export default new Mail();