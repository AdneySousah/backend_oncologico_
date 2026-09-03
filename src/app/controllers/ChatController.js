import { Op } from 'sequelize';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Pacientes from '../models/Pacientes.js';
import MonitoramentoMedicamento from '../models/MonitoramentoMedicamento.js';
import twilio from 'twilio';
import AuditService from '../../services/AuditService.js';
import { enviarMensagemWhatsApp, enviarLinkNPS } from '../../services/whatsapp.js';

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

      // 👇 REMOVIDO: detecção de nota de NPS por regex num dígito solto na
      // mensagem (`/\b(10|[0-9])\b/`). Era resquício de uma versão anterior
      // do fluxo, de quando o paciente respondia a nota digitando direto no
      // WhatsApp. O fluxo atual é 100% por link (TelaNpsPaciente / answerNps)
      // — o próprio texto do template de WhatsApp só pede pra clicar no
      // link, nunca pra responder com número. Além de redundante, esse
      // código criava um NpsResponse incompleto (sem monitoramento_id) se
      // disparasse, e teria capturado qualquer dígito solto de uma
      // conversa de chat normal (ex: "vou tomar 2 comprimidos") como se
      // fosse nota de NPS.

      res.set('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');

    } catch (error) {
      console.error('❌ [ERRO TWILIO WEBHOOK]:', error); // PARE DE ENGOLIR O ERRO AQUI
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

      if (conversation.paciente_id) {
        const pacienteDaConversa = await Pacientes.findByPk(conversation.paciente_id, { attributes: ['id', 'tratamento_pausado'] });
        if (pacienteDaConversa?.tratamento_pausado) {
          return res.status(400).json({ error: 'Este paciente está com o tratamento pausado. Retome o tratamento antes de enviar mensagens.' });
        }
      }

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

      await AuditService.log(loggedUserId, 'Envio', 'Chat', conversation.id, `Mensagem enviada na conversa #${conversation.id} (paciente_id: ${conversation.paciente_id || 'N/A'}).`);

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
      const { conversation_id, tipo_template = 'termo' } = req.body;

      const conversation = await Conversation.findByPk(conversation_id, {
        include: [{ model: Pacientes, as: 'paciente', include: ['operadoras'] }]
      });

      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });

      const numeroDestino = conversation.phone_number;
      const pacienteNome = conversation.paciente ? conversation.paciente.nome : 'Paciente';
      const operadoraNome = conversation.paciente?.operadoras?.nome || 'sua operadora';
      const usuarioAtual = await User.findByPk(req.userId);
      const userName = usuarioAtual?.name || 'Equipe';

      const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';

      let enviado;
      let tipoTemplateLabel;

      // 👇 Reabre a janela usando EXATAMENTE o mesmo template/layout já usado
      // nos disparos reais de Termo e NPS — não duplica a lógica de envio
      // aqui, reaproveita as mesmas funções (services/whatsapp.js) usadas
      // pelos controllers de Termo e NPS.
      if (tipo_template === 'nps') {
        if (!conversation.paciente) {
          return res.status(400).json({ error: 'Esta conversa não está vinculada a um paciente cadastrado — não é possível montar o link de NPS.' });
        }
        const ultimoMonitoramento = await MonitoramentoMedicamento.findOne({
          where: { paciente_id: conversation.paciente.id },
          order: [['createdAt', 'DESC']]
        });
        if (!ultimoMonitoramento) {
          return res.status(400).json({ error: 'Este paciente não possui nenhum ciclo de acompanhamento registrado — não é possível montar o link de NPS.' });
        }
        const linkNps = `${frontUrl}/paciente/nps/${conversation.paciente.id}/${ultimoMonitoramento.id}`;
        enviado = await enviarLinkNPS(numeroDestino, pacienteNome, operadoraNome, req.userId, linkNps);
        tipoTemplateLabel = 'NPS';
      } else {
        if (!conversation.paciente) {
          return res.status(400).json({ error: 'Esta conversa não está vinculada a um paciente cadastrado — não é possível montar o link do termo.' });
        }
        const linkTermo = `${frontUrl}/paciente/termo/${conversation.paciente.id}`;
        enviado = await enviarMensagemWhatsApp(numeroDestino, pacienteNome, operadoraNome, userName, linkTermo, req.userId);
        tipoTemplateLabel = 'Termo';
      }

      if (!enviado) {
        return res.status(500).json({ error: `Falha ao reabrir a janela com o template de ${tipoTemplateLabel}.` });
      }

      await AuditService.log(req.userId, 'Edição', 'Chat', conversation.id, `Janela de 24h reaberta na conversa #${conversation.id} usando o template de ${tipoTemplateLabel} (paciente_id: ${conversation.paciente_id || 'N/A'}).`);

      // Os envios acima (enviarMensagemWhatsApp/enviarLinkNPS) já atualizaram
      // window_expires_at e criaram a Message — só busca de volta pra devolver
      // pro front com os dados atualizados.
      const conversationAtualizada = await Conversation.findByPk(conversation.id);
      const ultimaMensagem = await Message.findOne({
        where: { conversation_id: conversation.id },
        order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }]
      });

      return res.json({ message: ultimaMensagem, conversation: conversationAtualizada });
    } catch (error) {
      console.error('Erro ao reabrir janela:', error);
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
      startOfMonth.setHours(0, 0, 0, 0);

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

      // Agrupa por conversa para a Sidebar saber exatamente onde colocar a bolinha verde
      const by_conversation = {};
      unreadMessages.forEach(msg => {
        by_conversation[msg.conversation_id] = (by_conversation[msg.conversation_id] || 0) + 1;
      });

      // 👇 CORREÇÃO: "total" precisa contar CONVERSAS com pendência, não
      // mensagens soltas — uma conversa com 5 mensagens não lidas ainda é
      // só 1 conversa pra revisar. Antes contava mensagem por mensagem, o
      // que fazia o número do balão (ex: 72) não bater com o número da aba
      // "Não lidas" dentro do chat (ex: 41), que já contava certo.
      const total = Object.keys(by_conversation).length;

      return res.json({ total, by_conversation });
    } catch (error) {
      console.error('Erro ao contar mensagens não lidas:', error);
      return res.status(500).json({ error: 'Erro ao contar mensagens' });
    }
  }

  // Apaga uma conversa (e todo o histórico de mensagens dela). Não há
  // CASCADE configurado no banco entre messages -> conversations, então
  // apaga as mensagens primeiro, numa transação, pra nunca deixar mensagem
  // órfã nem a conversa presa por causa da FK.
  async deleteConversation(req, res) {
    const { id } = req.params;
    try {
      const conversation = await Conversation.findByPk(id, {
        include: [{ model: Pacientes, as: 'paciente', attributes: ['id', 'nome', 'sobrenome'] }]
      });
      if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });

      const nomeReferencia = conversation.paciente
        ? `${conversation.paciente.nome} ${conversation.paciente.sobrenome}`
        : conversation.phone_number;

      await Conversation.sequelize.transaction(async (transaction) => {
        await Message.destroy({ where: { conversation_id: id }, transaction });
        await conversation.destroy({ transaction });
      });

      await AuditService.log(req.userId, 'Exclusão', 'Chat', Number(id), `Conversa com ${nomeReferencia} (${conversation.phone_number}) apagada, junto com todo o histórico de mensagens.`);

      return res.json({ message: 'Conversa apagada com sucesso.' });
    } catch (error) {
      console.error('Erro ao apagar conversa:', error);
      return res.status(500).json({ error: 'Erro ao apagar conversa.' });
    }
  }

}

export default new ChatController();