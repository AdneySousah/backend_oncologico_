import twilio from 'twilio';

// Inicializa o cliente usando as variáveis do seu .env
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// services/whatsapp.js
export async function enviarMensagemWhatsApp(numeroDestino, pacienteNome, userName, linkAcompanhamento) {
    try {
        // O WhatsApp exige DDI + DDD + Numero. 
        // Se o número no banco estiver "31999998888", precisamos que vire "+5531999998888"
        let numeroLimpo = String(numeroDestino).replace(/\D/g, ''); 
        
        // Regra para garantir o +55
        if (!numeroLimpo.startsWith('55')) {
            numeroLimpo = '55' + numeroLimpo;
        }
        const numeroFormatado = `+${numeroLimpo}`;

        const message = await client.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, // Certifique-se que é +553122980876
            to: `whatsapp:${numeroFormatado}`,
            contentSid: 'HXd1788f58346dfb10ac55cd63696c32f4', // SID do seu print
            contentVariables: JSON.stringify({
                '1': pacienteNome,
                '2': userName,
                '3': linkAcompanhamento
            })
        });

        console.log(`✅ Sucesso Twilio SID: ${message.sid}`);
        return true;
    } catch (error) {
        console.error('❌ Erro Twilio:', error.message);
        return false;
    }
}


// services/whatsapp.js
export async function enviarEnqueteNPS(numeroDestino, pacienteNome) {
    try {
        const numeroLimpo = String(numeroDestino).replace(/\D/g, '');
        const numeroFormatado = `+${numeroLimpo.startsWith('55') ? numeroLimpo : '55' + numeroLimpo}`;

        const message = await client.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${numeroFormatado}`,
            contentSid: 'HX6693f153d35b2877578501858d6af0af', // O SID do pesquisa_nps_aberta
            contentVariables: JSON.stringify({
                '1': pacienteNome
            })
        });

        return true;
    } catch (error) {
        console.error('❌ Erro Twilio NPS:', error);
        return false;
    }
}