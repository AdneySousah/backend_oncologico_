import { Op } from 'sequelize';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js'; 
import NpsResponse from '../models/NpsResponse.js'; 
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

class ChatController {
  
  async receiveWebhook(req, res) {
    try {
      const { From, Body, MessageSid } = req.body;
      
      if (!From) return res.status(200).send('<Response></Response>');

      const stringFrom = String(From);
      const celularLimpo = stringFrom.replace('whatsapp:', '').replace(/\D/g, '');
      const phoneNumber = stringFrom.replace('whatsapp:', '');

      const ultimos8 = celularLimpo.slice(-8);

      const paciente = await Pacientes.findOne({
          where: { celular: { [Op.like]: `%${ultimos8}` } }
      });

      let conversation = await Conversation.findOne({
          where: { phone_number: { [Op.like]: `%${ultimos8}` } }
      });

      if (!conversation) {
          conversation = await Conversation.create({ 
              phone_number: phoneNumber,
              paciente_id: paciente ? paciente.id : null 
          });
      } else {
          await conversation.update({ 
              phone_number: phoneNumber,
              paciente_id: paciente ? paciente.id : conversation.paciente_id
          });
      }

      const expireDate = new Date();
      expireDate.setHours(expireDate.getHours() + 24);
      await conversation.update({ window_expires_at: expireDate });

      await Message.create({
        conversation_id: conversation.id,
        message_sid: MessageSid,
        direction: 'inbound',
        body: Body || '[Mídia ou Áudio recebido]',
        is_read: false,
        user_id: null 
      });

      const stringBody = Body ? String(Body) : '';
      const match = stringBody.match(/\b(10|[0-9])\b/); 
      
      if (match && paciente) {
        const notaFinal = parseInt(match[0]);
        await NpsResponse.create({ paciente_id: paciente.id, nota: notaFinal });
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>A CICFARMA agradece o seu feedback! Sua nota ${notaFinal} foi registrada com sucesso.</Message></Response>`);
      }

      res.set('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');

    } catch (error) {
      res.set('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }
  }

  async sendMessage(req, res) {
    try {
      const { conversation_id, body } = req.body;
      const loggedUserId = req.userId;

      const conversation = await Conversation.findByPk(conversation_id);
      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });

      const now = new Date();
      if (!conversation.window_expires_at || conversation.window_expires_at < now) {
        return res.status(400).json({ error: 'Janela de 24 horas expirada.' });
      }

      const twilioMsg = await client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${conversation.phone_number}`,
        body: body
      });

      if (!conversation.assigned_user_id) {
        await conversation.update({ assigned_user_id: loggedUserId });
      }

      const message = await Message.create({
        conversation_id: conversation.id,
        user_id: loggedUserId,
        message_sid: twilioMsg.sid,
        direction: 'outbound-reply',
        body: body,
        is_read: true 
      });

      const messageWithUser = await Message.findByPk(message.id, {
        include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }]
      });

      return res.json(messageWithUser);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }

  // ✅ ALTERADO: Agora retorna os dados da conversa + paciente
  async getHistory(req, res) {
    const { id } = req.params;
    
    try {
      const conversation = await Conversation.findByPk(id, {
        include: [{ model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] }]
      });

      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });

      const messages = await Message.findAll({
        where: { conversation_id: id },
        include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }],
        order: [['createdAt', 'ASC']]
      });

      await Message.update(
        { is_read: true },
        { where: { conversation_id: id, direction: 'inbound', is_read: false } }
      );

      return res.json({ conversation, messages });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  }

  // ✅ NOVO: Função para reabrir o chat disparando o template do Termo
  async reopenWindow(req, res) {
    try {
      const { conversation_id } = req.body;
      
      const conversation = await Conversation.findByPk(conversation_id, {
        include: [{ model: Pacientes, as: 'paciente' }]
      });

      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });

      // Dados para o template
      const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
      const linkAcompanhamento = conversation.paciente ? `${frontUrl}/paciente/termo/${conversation.paciente.id}` : frontUrl;
      const pacienteNome = conversation.paciente ? conversation.paciente.nome : 'Paciente';
      const userName = 'Equipe CICFARMA'; // Nome genérico para o disparo automático

      // Dispara o template via Twilio
      const twilioMsg = await client.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: `whatsapp:${conversation.phone_number}`,
          contentSid: 'HXfa365bb91e965e9939e6204588222659',
          contentVariables: JSON.stringify({
              '1': pacienteNome,
              '2': userName,
              '3': linkAcompanhamento
          })
      });

      // Template reabre a janela de 24h!
      const expireDate = new Date();
      expireDate.setHours(expireDate.getHours() + 24);
      await conversation.update({ window_expires_at: expireDate, assigned_user_id: req.userId });

      const textoRealDoTemplate = `Olá ${pacienteNome}, meu nome é ${userName}, estou entrando em contato em nome da CIC FARMA.\n\nAceita os termos de contato via telefone para te acompanhar no seu tratamento?\n\nPor favor, acesse o link abaixo para responder:\n${linkAcompanhamento}\n\nAgradecemos a sua atenção.`;

      const message = await Message.create({
          conversation_id: conversation.id,
          user_id: req.userId,
          message_sid: twilioMsg.sid,
          direction: 'outbound-api',
          body: textoRealDoTemplate,
          is_read: true 
      });

      const messageWithUser = await Message.findByPk(message.id, {
        include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }]
      });

      return res.json({ message: messageWithUser, conversation });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao reabrir janela' });
    }
  }

  async listConversations(req, res) {
    try {
      const conversations = await Conversation.findAll({
        include: [
          { model: Message, as: 'messages', limit: 1, order: [['createdAt', 'DESC']] },
          { model: User, as: 'responsavel', attributes: ['id', 'name'] },
          { model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] }
        ],
        order: [['updatedAt', 'DESC']]
      });

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0,0,0,0);

      const activeThisMonth = await Conversation.count({
        where: { updatedAt: { [Op.gte]: startOfMonth } }
      });

      return res.json({ limit_data: { used: activeThisMonth, total: 1000 }, data: conversations });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  }

  async getUnreadCounts(req, res) {
    try {
      // Busca todas as mensagens recebidas (inbound) que ainda não foram lidas
      const unreadMessages = await Message.findAll({
        where: { direction: 'inbound', is_read: false },
        attributes: ['conversation_id'],
        raw: true
      });

      const total = unreadMessages.length;
      
      // Agrupa por conversa para a Sidebar saber exatamente onde colocar a bolinha verde
      const by_conversation = {};
      unreadMessages.forEach(msg => {
        by_conversation[msg.conversation_id] = (by_conversation[msg.conversation_id] || 0) + 1;
      });

      return res.json({ total, by_conversation });
    } catch (error) {
      console.error('Erro ao contar mensagens não lidas:', error);
      return res.status(500).json({ error: 'Erro ao contar mensagens' });
    }
  }
  
}

export default new ChatController();