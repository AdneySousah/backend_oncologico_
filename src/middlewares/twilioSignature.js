import twilio from 'twilio';

// Confere se a chamada do webhook veio mesmo da Twilio (cabeçalho X-Twilio-Signature).
// Sem isso, qualquer pessoa podia enviar um POST falso e injetar mensagens no chat de um
// paciente e reabrir a janela de 24h.
//
// A assinatura é calculada sobre a URL PÚBLICA exata que está configurada no painel da
// Twilio. Atrás de proxy/HTTPS o servidor não sabe essa URL sozinho, por isso ela vem da
// variável TWILIO_WEBHOOK_URL (ex.: https://api.seudominio.com/webhooks/twilio/whatsapp).
// Enquanto a variável não estiver configurada, a checagem fica desligada (com aviso no log)
// para não derrubar o recebimento de mensagens.
let avisou = false;

export default function validarAssinaturaTwilio(req, res, next) {
    const url = process.env.TWILIO_WEBHOOK_URL;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!url || !token) {
        if (!avisou) {
            console.warn('[Twilio] TWILIO_WEBHOOK_URL não configurada: assinatura do webhook NÃO está sendo verificada.');
            avisou = true;
        }
        return next();
    }

    const assinatura = req.header('X-Twilio-Signature') || '';
    if (twilio.validateRequest(token, assinatura, url, req.body || {})) {
        return next();
    }

    console.warn('[Twilio] Webhook recusado: assinatura inválida.');
    res.set('Content-Type', 'text/xml');
    return res.status(403).send('<Response></Response>');
}
