import User from '../models/User.js';
import bcrypt from 'bcrypt';
import Mail from '../../services/Mail.js';
import AuditService from '../../services/AuditService.js';
import crypto from 'node:crypto';

// Resposta igual para e-mail cadastrado ou não: antes o 404 revelava quais e-mails existem.
const MENSAGEM_ENVIO = 'Se o e-mail estiver cadastrado e ativo, enviamos um código de recuperação.';
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

class PasswordResetController {

    // Passo 1: Solicita o código
    async forgotPassword(req, res) {
        const email = texto(req.body?.email);
        if (!email) {
            return res.status(400).json({ error: 'Informe o e-mail.' });
        }

        const user = await User.findOne({ where: { email, active: true } });

        if (!user) {
            return res.json({ message: MENSAGEM_ENVIO });
        }

        // Código de 6 dígitos com gerador criptográfico (Math.random é previsível)
        const resetToken = String(crypto.randomInt(100000, 1000000));

        // Expira em 1 hora
        const now = new Date();
        now.setHours(now.getHours() + 1);

        await user.update({
            reset_password_token: resetToken,
            reset_password_expires: now,
        });

        try {
            await Mail.sendMail({
                to: `${user.name} <${user.email}>`,
                subject: 'Código de Recuperação de Senha - CIC Oncologia Oral',
                html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; padding: 40px 20px; margin: 0;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
              
              <div style="background-color: #005b96; padding: 25px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Recuperação de Senha</h1>
              </div>
              
              <div style="padding: 40px 30px; color: #333333; line-height: 1.6;">
                <p style="font-size: 16px; margin-top: 0;">Olá, <strong>${user.name}</strong>,</p>
                <p style="font-size: 16px;">Você solicitou a recuperação de senha no sistema <strong>CIC Oncologia Oral</strong>.</p>
                <p style="font-size: 16px;">Utilize o código de verificação abaixo para criar sua nova senha:</p>
                
                <div style="text-align: center; margin: 35px 0;">
                  <span style="display: inline-block; background-color: #f0f7fb; color: #005b96; font-size: 36px; font-weight: bold; padding: 15px 40px; border-radius: 8px; border: 2px dashed #005b96; letter-spacing: 8px;">
                    ${resetToken}
                  </span>
                </div>
                
                <p style="font-size: 14px; color: #666666;">Este código é válido por <strong>1 hora</strong>.</p>
                <p style="font-size: 14px; color: #666666; margin-bottom: 0;">Se você não solicitou essa alteração, nenhuma ação é necessária. Sua senha continuará a mesma.</p>
              </div>
              
              <div style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #eeeeee;">
                
                <p style="margin: 0; font-size: 16px; color: #333333; font-weight: bold;">Suporte CIC Oncologia Oral</p>
                <p style="margin: 5px 0 0 0; font-size: 13px; color: #888888;">
                  Precisa de ajuda? <a href="mailto:suporte@doutoragora.com" style="color: #005b96; text-decoration: none;">suporte@doutoragora.com</a>
                </p>
              </div>
              
            </div>
          </div>
        `,
            });

            return res.json({ message: MENSAGEM_ENVIO });
        } catch (err) {
            console.error('Erro ao enviar e-mail:', err);
            return res.status(500).json({ error: 'Erro ao enviar e-mail de recuperação.' });
        }
    }

    // Passo 2: Valida o código digitado
    async verifyCode(req, res) {
        const email = texto(req.body?.email);
        const code = texto(req.body?.code);
        if (!email || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Código inválido.' });
        }

        const user = await User.findOne({
            where: {
                email,
                reset_password_token: code
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'Código inválido.' });
        }

        const now = new Date();
        if (now > user.reset_password_expires) {
            return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
        }

        return res.json({ message: 'Código validado com sucesso.', ok: true });
    }

    // Passo 3: Reseta a senha
    async resetPassword(req, res) {
        const email = texto(req.body?.email);
        const code = texto(req.body?.code);
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        if (!email || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Código inválido.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }

        const user = await User.findOne({
            where: {
                email,
                reset_password_token: code
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'Código inválido.' });
        }

        const now = new Date();
        if (now > user.reset_password_expires) {
            return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
        }

        const password_hash = await bcrypt.hash(newPassword, 8);

        await user.update({
            password_hash,
            reset_password_token: null,
            reset_password_expires: null,
        });

        await AuditService.log(user.id, 'Edição', 'Usuário', user.id, `Senha redefinida via "esqueci minha senha" (${user.email}).`);

        return res.json({ message: 'Senha alterada com sucesso.' });
    }
}

export default new PasswordResetController();