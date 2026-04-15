import twilio from 'twilio';
import { Op } from 'sequelize';
import Conversation from '../app/models/Conversation.js';
import Message from '../app/models/Message.js';
// ✅ NOVO: Importando o model de Pacientes
import Pacientes from '../app/models/Pacientes.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function enviarMensagemWhatsApp(numeroDestino, pacienteNome, userName, linkAcompanhamento, userId) {
    try {
        let numeroLimpo = String(numeroDestino).replace(/\D/g, '');

        if (!numeroLimpo.startsWith('55')) {
            numeroLimpo = '55' + numeroLimpo;
        }
        const numeroFormatado = `+${numeroLimpo}`;

        const message = await client.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${numeroFormatado}`,
            contentSid: 'HXfa365bb91e965e9939e6204588222659',
            contentVariables: JSON.stringify({
                '1': pacienteNome,
                '2': userName,
                '3': linkAcompanhamento
            })
        });

        const ultimos8 = numeroLimpo.slice(-8);

        // ✅ NOVO: Busca o paciente no banco usando os últimos 8 dígitos do telefone
        const paciente = await Pacientes.findOne({
            where: {
                [Op.or]: [
                    { celular: { [Op.like]: `%${ultimos8}` } },
                    { contato_cuidador: { [Op.like]: `%${ultimos8}` } }
                ]
            }
        });

        let conversation = await Conversation.findOne({
            where: { phone_number: { [Op.like]: `%${ultimos8}` } }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                phone_number: numeroFormatado,
                assigned_user_id: userId || null,
                paciente_id: paciente ? paciente.id : null // ✅ Salva o ID do paciente na conversa!
            });
        } else if (!conversation.paciente_id && paciente) {
            // Se a conversa já existia mas estava sem o paciente, atualiza agora
            await conversation.update({ paciente_id: paciente.id });
        }

        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + 24);
        await conversation.update({ window_expires_at: expireDate });

        const textoRealDoTemplate = `Olá ${pacienteNome}, meu nome é ${userName}, estou entrando em contato em nome da CIC FARMA.\n\nAceita os termos de contato via telefone para te acompanhar no seu tratamento?\n\nPor favor, acesse o link abaixo para responder:\n${linkAcompanhamento}\n\nAgradecemos a sua atenção.`;

        await Message.create({
            conversation_id: conversation.id,
            user_id: userId || null,
            message_sid: message.sid,
            direction: 'outbound-api',
            body: textoRealDoTemplate,
            is_read: true
        });

        console.log(`✅ Sucesso Twilio SID: ${message.sid}`);
        return true;
    } catch (error) {
        console.error('❌ Erro Twilio:', error.message);
        return false;
    }
}


export async function enviarEnqueteNPS(numeroDestino, pacienteNome, userId) {
    try {
        const numeroLimpo = String(numeroDestino).replace(/\D/g, '');
        const numeroFormatado = `+${numeroLimpo.startsWith('55') ? numeroLimpo : '55' + numeroLimpo}`;

        const message = await client.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${numeroFormatado}`,
            contentSid: 'HX6693f153d35b2877578501858d6af0af',
            contentVariables: JSON.stringify({
                '1': pacienteNome
            })
        });

        const ultimos8 = numeroLimpo.slice(-8);

        // ✅ NOVO: Busca o paciente no banco usando os últimos 8 dígitos do telefone
        const paciente = await Pacientes.findOne({
            where: {
                [Op.or]: [
                    { celular: { [Op.like]: `%${ultimos8}` } },
                    { contato_cuidador: { [Op.like]: `%${ultimos8}` } }
                ]
            }
        });

        let conversation = await Conversation.findOne({
            where: { phone_number: { [Op.like]: `%${ultimos8}` } }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                phone_number: numeroFormatado,
                assigned_user_id: userId || null,
                paciente_id: paciente ? paciente.id : null // ✅ Salva o ID do paciente na conversa!
            });
        } else if (!conversation.paciente_id && paciente) {
            await conversation.update({ paciente_id: paciente.id });
        }

        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + 24);
        await conversation.update({ window_expires_at: expireDate });

        const textoRealDoTemplateNps = `Olá ${pacienteNome}, somos da CICFARMA, Gostaríamos de saber sua opinião sobre nosso atendimento.\n\nDe 0 a 10, qual seria a sua avaliação? (Sendo 0 para insatisfeito e 10 para muito satisfeito).\n\nPor favor, responda apenas com o números.`;

        await Message.create({
            conversation_id: conversation.id,
            user_id: userId || null,
            message_sid: message.sid,
            direction: 'outbound-api',
            body: textoRealDoTemplateNps,
            is_read: true
        });

        return true;
    } catch (error) {
        console.error('❌ Erro Twilio NPS:', error);
        return false;
    }
}